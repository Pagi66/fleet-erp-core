import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";
import type { ComplianceSignal } from "./compliance-engine";
import { config } from "./config";
import {
  cleanupOldEvents,
  isDuplicateEvent,
  markEventProcessed as registerProcessedEvent,
  type EventIntegrityState,
} from "./event-integrity";
import { logger } from "./logger";
import {
  ActorContext,
  ApprovalAwarenessQueryOptions,
  ApprovalAwarenessRecord,
  ApprovalHistoryEntry,
  ApprovalHistoryType,
  ApprovalStatus,
  ApprovalRecordSnapshot,
  ApprovalRecordView,
  AssignedRoleId,
  AttentionSignal,
  AwarenessBucket,
  DailyComplianceState,
  Defect,
  Equipment,
  EscalationState,
  FleetRecord,
  FleetRecordKind,
  LogRecord,
  LogType,
  Notification,
  REQUIRED_DAILY_LOGS,
  RoleDashboardSummary,
  RoleId,
  Ship,
  StoreSnapshot,
  Task,
  TaskHistoryEntry,
  TaskHistoryType,
  TaskSnapshot,
  TaskStateSnapshot,
} from "./types";

const STORE_STATE_VERSION = 13;
const DEFAULT_AWARENESS_STALE_THRESHOLD_HOURS = 24;
const DEFAULT_AWARENESS_PENDING_THRESHOLD_HOURS = 48;
const DEFAULT_AWARENESS_REJECTED_WINDOW_HOURS = 72;
const DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT = 5;

interface NormalizedAwarenessOptions {
  shipId?: string;
  now: string;
  nowMs: number;
  staleThresholdHours: number;
  pendingThresholdHours: number;
  recentlyRejectedWindowHours: number;
  topActionableLimit: number;
}

interface ProcessedApprovalTransition {
  recordId: string;
  actionType: ApprovalHistoryType;
}

export interface FailedEventRecord {
  eventId: string;
  reason: string;
  timestamp: number;
}

interface PersistedStoreState {
  version: number;
  ships: Ship[];
  equipment: Equipment[];
  tasks: Task[];
  defects: Defect[];
  taskHistory: Array<[string, TaskHistoryEntry[]]>;
  records: FleetRecord[];
  approvalHistory: Array<[string, ApprovalHistoryEntry[]]>;
  processedTransitions: Array<[string, ProcessedApprovalTransition]>;
  processedEvents: Record<string, number>;
  failedEvents: Record<string, { reason: string; timestamp: number }>;
  escalationState: Array<[string, EscalationState]>;
  notifications: Notification[];
  complianceSignals: ComplianceSignal[];
}

export interface StoreHealthCheck {
  running: boolean;
  totalTasks: number;
  overdueTasks: number;
  escalationCounts: {
    none: number;
    mcc: number;
    logComd: number;
  };
  perShip: Record<string, {
    totalTasks: number;
    overdueTasks: number;
    escalationCounts: {
      none: number;
      mcc: number;
      logComd: number;
    };
  }>;
  lastPersistenceTimestamp: string | null;
}

export class InMemoryStore {
  private readonly shipsById = new Map<string, Ship>();

  private readonly equipmentByIss = new Map<string, Equipment>();

  private readonly logsByDate = new Map<string, LogRecord[]>();

  private readonly complianceByDate = new Map<string, DailyComplianceState>();

  private readonly escalationByDate = new Map<string, EscalationState>();

  private readonly tasksById = new Map<string, Task>();

  private readonly defectsById = new Map<string, Defect>();

  private readonly taskHistoryById = new Map<string, TaskHistoryEntry[]>();

  private readonly recordsById = new Map<string, FleetRecord>();

  private readonly approvalHistoryById = new Map<string, ApprovalHistoryEntry[]>();

  private readonly processedTransitions = new Map<string, ProcessedApprovalTransition>();

  private readonly processedEventsById = new Map<string, number>();

  private readonly failedEventsById = new Map<string, { reason: string; timestamp: number }>();

  private readonly notificationsById = new Map<string, Notification>();

  private readonly complianceSignalsByKey = new Map<string, ComplianceSignal>();

  private readonly persistenceFilePath: string;

  private readonly backupFilePath: string;

  private readonly tempFilePath: string;

  private lastPersistenceTimestamp: string | null = null;

  constructor(persistenceFilePath = config.persistenceFilePath) {
    this.persistenceFilePath = persistenceFilePath;
    this.backupFilePath = `${persistenceFilePath}.bak`;
    this.tempFilePath = `${persistenceFilePath}.tmp`;
    this.loadPersistedState();
  }

  saveLog(record: LogRecord): void {
    this.assertValidShipId(record.shipId);
    this.assertShipExists(record.shipId);
    const stateKey = this.getDailyStateKey(record.shipId, record.businessDate);
    const existing = this.logsByDate.get(stateKey) ?? [];
    const withoutSameType = existing.filter(
      (entry) => entry.logType !== record.logType,
    );
    withoutSameType.push(record);
    this.logsByDate.set(stateKey, withoutSameType);
    logger.stateChange({
      eventType: "LOG_RECORDED",
      status: "UPDATED",
    });
  }

  saveEquipment(equipment: Equipment): Equipment {
    this.assertValidEquipment(equipment);
    this.equipmentByIss.set(equipment.iss, equipment);
    this.persistState();
    return equipment;
  }

  getEquipment(iss: string): Equipment | null {
    return this.equipmentByIss.get(iss) ?? null;
  }

  getAllEquipment(): Equipment[] {
    return [...this.equipmentByIss.values()];
  }

  getLogsForDate(shipId: string, businessDate: string): LogRecord[] {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    return [...(this.logsByDate.get(stateKey) ?? [])];
  }

  getOrCreateComplianceState(
    shipId: string,
    businessDate: string,
  ): DailyComplianceState {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    const existing = this.complianceByDate.get(stateKey);
    if (existing) {
      return existing;
    }

    const initialState: DailyComplianceState = {
      shipId,
      businessDate,
      requiredLogs: [...REQUIRED_DAILY_LOGS],
      presentLogs: [],
      missingLogs: [...REQUIRED_DAILY_LOGS],
      status: "PENDING",
      lastEvaluatedAt: null,
      meoNotifiedAt: null,
    };

    this.complianceByDate.set(stateKey, initialState);
    return initialState;
  }

  updateComplianceState(
    shipId: string,
    businessDate: string,
    update: Partial<DailyComplianceState>,
  ): DailyComplianceState {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    const current = this.getOrCreateComplianceState(shipId, businessDate);
    const next: DailyComplianceState = {
      ...current,
      ...update,
    };
    this.complianceByDate.set(stateKey, next);
    logger.stateChange({
      eventType: "COMPLIANCE_STATE_UPDATED",
      status: next.status,
    });
    return next;
  }

  getOrCreateEscalationState(shipId: string, businessDate: string): EscalationState {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    const existing = this.escalationByDate.get(stateKey);
    if (existing) {
      return existing;
    }

    const initialState: EscalationState = {
      shipId,
      businessDate,
      status: "NOT_ESCALATED",
      reason: null,
      missingLogsAtEscalation: [],
      escalatedAt: null,
      targetRole: null,
    };

    this.escalationByDate.set(stateKey, initialState);
    return initialState;
  }

  updateEscalationState(
    shipId: string,
    businessDate: string,
    update: Partial<EscalationState>,
  ): EscalationState {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    const current = this.getOrCreateEscalationState(shipId, businessDate);
    const next: EscalationState = {
      ...current,
      ...update,
    };
    this.escalationByDate.set(stateKey, next);
    logger.stateChange({
      eventType: "ESCALATION_STATE_UPDATED",
      status: next.status,
    });
    this.persistState();
    return next;
  }

  getSnapshot(shipId: string, businessDate: string): StoreSnapshot {
    return {
      logs: this.getLogsForDate(shipId, businessDate),
      complianceState: this.getOrCreateComplianceState(shipId, businessDate),
      escalationState: this.getOrCreateEscalationState(shipId, businessDate),
    };
  }

  createTask(task: Task, occurredAt: string, actor: RoleId): Task {
    this.assertValidShipId(task.shipId);
    this.assertShipExists(task.shipId);
    this.assertValidAssignedRole(task.assignedRole, "assignedRole");
    this.assertValidRole(actor, "actor");
    this.assertTaskEquipmentLinkage(task);
    if (task.kind === "DEFECT") {
      if (!task.defectId) {
        throw new Error(`Defect task ${task.id} requires defectId`);
      }
      if (!this.defectsById.has(task.defectId)) {
        throw new Error(`Defect task ${task.id} references unknown defect: ${task.defectId}`);
      }
    }
    const existing = this.getTask(task.id);
    if (existing) {
      if (existing.shipId !== task.shipId) {
        logger.error("cross_ship_task_id_conflict", new Error("Task ID already used by another ship"), {
          taskId: task.id,
          status: `${existing.shipId}->${task.shipId}`,
        });
        throw new Error(`Task ID already exists in another ship: ${task.id}`);
      }
      return existing;
    }

    this.tasksById.set(task.id, task);
    const state = this.createStateSnapshot(task);
    this.appendTaskHistory(
      task.id,
      task.shipId,
      "CREATED",
      state,
      state,
      occurredAt,
      actor,
    );
    logger.stateChange({
      taskId: task.id,
      actionType: "CREATED",
      status: task.status,
    });
    this.persistState();
    return task;
  }

  createDefect(defect: Defect): Defect {
    this.assertValidDefect(defect);
    this.assertShipExists(defect.shipId);
    const existing = this.defectsById.get(defect.id);
    if (existing) {
      return existing;
    }

    this.defectsById.set(defect.id, defect);
    this.persistState();
    return defect;
  }

  getDefect(defectId: string): Defect | null {
    return this.defectsById.get(defectId) ?? null;
  }

  getAllDefects(): Defect[] {
    return [...this.defectsById.values()];
  }

  getTasksByDefectId(defectId: string): Task[] {
    return this.getAllTasks().filter((task) => task.defectId === defectId);
  }

  getFailedEvents(): FailedEventRecord[] {
    return [...this.failedEventsById.entries()]
      .map(([eventId, failure]) => ({
        eventId,
        reason: failure.reason,
        timestamp: failure.timestamp,
      }))
      .sort((left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.timestamp - right.timestamp ||
        left.reason.localeCompare(right.reason),
      );
  }

  getFailedEventById(eventId: string): FailedEventRecord | null {
    const failure = this.failedEventsById.get(eventId);
    if (!failure) {
      return null;
    }

    return {
      eventId,
      reason: failure.reason,
      timestamp: failure.timestamp,
    };
  }

  updateDefectStatus(defectId: string, status: Defect["status"]): Defect {
    const current = this.getDefect(defectId);
    if (!current) {
      throw new Error(`Defect not found: ${defectId}`);
    }

    const next: Defect = {
      ...current,
      status,
    };
    this.defectsById.set(defectId, next);
    this.persistState();
    return next;
  }

  getTask(taskId: string): Task | null {
    return this.tasksById.get(taskId) ?? null;
  }

  getTaskInShip(taskId: string, shipId: string): Task | null {
    this.assertValidShipId(shipId);
    const task = this.getTask(taskId);
    if (!task || task.shipId !== shipId) {
      return null;
    }
    return task;
  }

  completeTask(taskId: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.status === "COMPLETED") {
      return current;
    }

    this.assertTaskStatusTransition(current.status, "COMPLETED");
    const completedAtMs = Date.parse(occurredAt);
    const nextDueAt = this.deriveNextDueAt(current, completedAtMs);
    return this.applyTaskUpdate(
      taskId,
      {
        status: "COMPLETED",
        executionStatus: "COMPLETED",
        completedAt: occurredAt,
        verificationBy: actor,
        verificationAt: completedAtMs,
        lastCheckedAt: occurredAt,
        lastCompletedAt: completedAtMs,
        requiresReplan: false,
        ...(typeof nextDueAt === "number" ? { nextDueAt } : {}),
      },
      "COMPLETED",
      occurredAt,
      actor,
    );
  }

  recordTaskCheck(taskId: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.lastCheckedAt === occurredAt) {
      return current;
    }

    return this.applyTaskUpdate(
      taskId,
      {
        lastCheckedAt: occurredAt,
      },
      "CHECKED",
      occurredAt,
      actor,
    );
  }

  markTaskOverdue(taskId: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.status === "COMPLETED" || current.status === "OVERDUE") {
      return current;
    }

    this.assertTaskStatusTransition(current.status, "OVERDUE");
    return this.applyTaskUpdate(
      taskId,
      {
        status: "OVERDUE",
        lastCheckedAt: occurredAt,
        lastOverdueAt: occurredAt,
      },
      "STATUS_CHANGED",
      occurredAt,
      actor,
    );
  }

  escalateTask(
    taskId: string,
    escalationLevel: "MCC" | "LOG_COMD",
    occurredAt: string,
    actor: RoleId,
  ): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.escalationLevel === escalationLevel) {
      return current;
    }

    this.assertEscalationTransition(current.escalationLevel, escalationLevel);
    return this.applyTaskUpdate(
      taskId,
      {
        escalationLevel,
        escalatedAt: occurredAt,
        lastNotifiedAt: occurredAt,
      },
      "ESCALATED",
      occurredAt,
      actor,
    );
  }

  replanTask(taskId: string, nextDueDate: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.dueDate === nextDueDate) {
      return current;
    }

    return this.applyTaskUpdate(
      taskId,
      {
        dueDate: nextDueDate,
        parentTaskId: current.parentTaskId ?? current.id,
        replannedFromDueDate: current.dueDate,
        replannedToDueDate: nextDueDate,
        executionStatus: current.executionStatus === "COMPLETED" ? "COMPLETED" : "MISSED",
        nextDueAt: this.computeMinimalNextDueAt(current, occurredAt, nextDueDate),
        requiresReplan: true,
      },
      "REPLANNED",
      occurredAt,
      actor,
    );
  }

  recordTaskNotification(taskId: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (
      current.lastNotifiedAt !== null &&
      (current.lastOverdueAt === null || current.lastNotifiedAt >= current.lastOverdueAt)
    ) {
      return current;
    }

    return this.applyTaskUpdate(
      taskId,
      {
        lastNotifiedAt: occurredAt,
      },
      "NOTIFIED",
      occurredAt,
      actor,
    );
  }

  getTaskSnapshot(taskId: string): TaskSnapshot {
    return {
      task: this.getTask(taskId),
      history: [...(this.taskHistoryById.get(taskId) ?? [])],
    };
  }

  getTaskSnapshotInShip(taskId: string, shipId: string): TaskSnapshot {
    const task = this.getTaskInShip(taskId, shipId);
    return {
      task,
      history: task ? [...(this.taskHistoryById.get(taskId) ?? [])] : [],
    };
  }

  createApprovalRecord(record: FleetRecord, occurredAt: string, actor: RoleId): FleetRecord {
    this.assertValidShipId(record.shipId);
    this.assertShipExists(record.shipId);
    this.assertValidFleetRecord(record);
    this.assertValidRole(actor, "actor");
    const existing = this.getApprovalRecord(record.id);
    if (existing) {
      if (existing.shipId !== record.shipId) {
        logger.error("cross_ship_record_id_conflict", new Error("Record ID already used by another ship"), {
          status: `${existing.shipId}->${record.shipId}`,
        });
        throw new Error(`Record ID already exists in another ship: ${record.id}`);
      }
      return existing;
    }

    this.recordsById.set(record.id, record);
    const state = this.createApprovalSnapshot(record);
    this.appendApprovalHistory(
      record.id,
      record.shipId,
      "CREATED",
      state,
      state,
      occurredAt,
      actor,
      null,
      null,
      null,
    );
    this.persistState();
    return record;
  }

  getApprovalRecord(recordId: string): FleetRecord | null {
    return this.recordsById.get(recordId) ?? null;
  }

  getApprovalRecordInShip(recordId: string, shipId: string): FleetRecord | null {
    this.assertValidShipId(shipId);
    const record = this.getApprovalRecord(recordId);
    if (!record || record.shipId !== shipId) {
      return null;
    }
    return record;
  }

  getApprovalRecordViewInShip(recordId: string, shipId: string): ApprovalRecordView {
    const record = this.getApprovalRecordInShip(recordId, shipId);
    return {
      record,
      history: record ? [...(this.approvalHistoryById.get(recordId) ?? [])] : [],
    };
  }

  getProcessedApprovalTransition(transitionId: string): ProcessedApprovalTransition | null {
    return this.processedTransitions.get(transitionId) ?? null;
  }

  isEventProcessed(eventId: string): boolean {
    return isDuplicateEvent(eventId, this.getEventIntegrityState());
  }

  markEventProcessed(eventId: string, processedAt: number): void {
    const nextState = registerProcessedEvent(
      eventId,
      this.getEventIntegrityState(),
      processedAt,
    );
    this.replaceProcessedEvents(nextState.processedEvents);
    this.failedEventsById.delete(eventId);
    this.persistState();
  }

  recordFailedEvent(eventId: string, reason: string, timestamp: number): void {
    this.failedEventsById.set(eventId, { reason, timestamp });
    this.persistState();
  }

  clearFailedEvent(eventId: string): void {
    if (this.failedEventsById.delete(eventId)) {
      this.persistState();
    }
  }

  cleanupFailedEvents(now: number, ttlMs: number): void {
    for (const [eventId, failure] of this.failedEventsById.entries()) {
      if (now - failure.timestamp > ttlMs) {
        this.failedEventsById.delete(eventId);
      }
    }
    this.persistState();
  }

  cleanupProcessedEvents(now: number, ttlMs: number): void {
    const nextState = cleanupOldEvents(this.getEventIntegrityState(), now, ttlMs);
    this.replaceProcessedEvents(nextState.processedEvents);
    this.persistState();
  }

  getPreviousApprovalOwnerInShip(recordId: string, shipId: string): AssignedRoleId {
    const record = this.getApprovalRecordInShip(recordId, shipId);
    if (!record) {
      throw new Error("Approval record does not exist in the provided ship context");
    }
    return this.getPreviousApprovalOwner(recordId, record);
  }

  getApprovalRecordsByShip(shipId: string): FleetRecord[] {
    this.assertValidShipId(shipId);
    return [...this.recordsById.values()].filter((record) => record.shipId === shipId);
  }

  getApprovalRecordsVisibleToRole(shipId: string, role: AssignedRoleId): FleetRecord[] {
    this.assertValidShipId(shipId);
    this.assertValidAssignedRole(role, "role");
    return this.getApprovalRecordsByShip(shipId).filter((record) => record.visibleTo.includes(role));
  }

  getApprovalRecordViewVisibleToRole(
    recordId: string,
    shipId: string,
    role: AssignedRoleId,
  ): ApprovalRecordView {
    this.assertValidAssignedRole(role, "role");
    const view = this.getApprovalRecordViewInShip(recordId, shipId);
    if (!view.record || !view.record.visibleTo.includes(role)) {
      return {
        record: null,
        history: [],
      };
    }
    return view;
  }

  getApprovalRecordViewForActor(
    recordId: string,
    actor: ActorContext,
  ): ApprovalRecordView {
    const normalizedActor = this.normalizeActorContext(actor);
    const record = this.getApprovalRecord(recordId);
    if (!record) {
      return {
        record: null,
        history: [],
      };
    }

    if (!this.isRecordVisibleToActor(record, normalizedActor)) {
      return {
        record: null,
        history: [],
      };
    }

    return {
      record,
      history: [...(this.approvalHistoryById.get(recordId) ?? [])],
    };
  }

  getApprovalAwarenessRecords(
    actor: ActorContext,
    options: ApprovalAwarenessQueryOptions = {},
  ): ApprovalAwarenessRecord[] {
    const normalizedActor = this.normalizeActorContext(actor);
    const normalized = this.normalizeAwarenessOptions(options);
    const visibleRecords = this.getVisibleApprovalRecordsForAwareness(normalizedActor, normalized);
    const projected = visibleRecords.map((record) =>
      this.projectApprovalAwarenessRecord(record, normalizedActor.role, normalized),
    );
    const sorted = projected.sort((left, right) =>
      this.compareAwarenessRecords(left, right),
    );
    this.assertApprovalAwarenessRecords(normalizedActor, sorted);
    return sorted;
  }

  getApprovalDashboardSummary(
    actor: ActorContext,
    options: ApprovalAwarenessQueryOptions = {},
  ): RoleDashboardSummary {
    const normalizedActor = this.normalizeActorContext(actor);
    const normalized = this.normalizeAwarenessOptions(options);
    const records = this.getApprovalAwarenessRecords(normalizedActor, normalized);
    const scopedShipId = this.resolveActorScopedShipId(normalizedActor, normalized);
    const countsByStatus: Record<ApprovalStatus, number> = {
      DRAFT: 0,
      SUBMITTED: 0,
      APPROVED: 0,
      REJECTED: 0,
    };
    const countsByRole: Record<AssignedRoleId, number> = {
      COMMANDING_OFFICER: 0,
      MARINE_ENGINEERING_OFFICER: 0,
      WEAPON_ELECTRICAL_OFFICER: 0,
      FLEET_SUPPORT_GROUP: 0,
      LOGISTICS_COMMAND: 0,
    };
    const countsByShip: Record<string, number> = {};

    for (const record of records) {
      countsByStatus[record.status] += 1;
      countsByRole[record.currentOwner] += 1;
      countsByShip[record.shipId] = (countsByShip[record.shipId] ?? 0) + 1;
    }

    const summary: RoleDashboardSummary = {
      role: normalizedActor.role,
      ...(scopedShipId ? { shipId: scopedShipId } : {}),
      generatedAt: normalized.now,
      totals: {
        visible: records.length,
        owned: records.filter((record) => record.bucket === "OWNED").length,
        needingMyAction: records.filter((record) => record.bucket === "PENDING_MY_ACTION").length,
        recentlyRejected: records.filter((record) => record.bucket === "RECENTLY_REJECTED").length,
        visibleNotOwned: records.filter((record) => record.bucket === "VISIBLE_NOT_OWNED").length,
        stale: records.filter((record) => record.computed.isStale).length,
        blockedByRejection: records.filter((record) =>
          record.attentionSignals.includes("BLOCKED_BY_REJECTION")).length,
        pendingTooLong: records.filter((record) => record.computed.isPendingTooLong).length,
      },
      countsByStatus,
      countsByRole,
      countsByShip,
      topActionableRecords: records
        .filter((record) => record.bucket === "PENDING_MY_ACTION")
        .slice(0, normalized.topActionableLimit),
      records,
    };

    this.assertApprovalAwarenessSummary(summary, normalizedActor);
    return summary;
  }

  getTopActionableRecords(
    actor: ActorContext,
    limit = DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT,
  ): ApprovalAwarenessRecord[] {
    const records = this.getApprovalAwarenessRecords(actor, {
      topActionableLimit: limit,
    });
    return records
      .filter((record) => record.bucket === "PENDING_MY_ACTION")
      .slice(0, limit);
  }

  getTopStaleRecords(
    actor: ActorContext,
    limit = DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT,
  ): ApprovalAwarenessRecord[] {
    const records = this.getApprovalAwarenessRecords(actor, {
      topActionableLimit: limit,
    });
    return [...records]
      .filter((record) => record.computed.isStale)
      .sort((left, right) => this.compareByAgeThenCreatedAt(left, right))
      .slice(0, limit);
  }

  getRecentRejections(
    actor: ActorContext,
    limit = DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT,
  ): ApprovalAwarenessRecord[] {
    const records = this.getApprovalAwarenessRecords(actor, {
      topActionableLimit: limit,
    });
    return records
      .filter((record) => record.bucket === "RECENTLY_REJECTED")
      .slice(0, limit);
  }

  getStaleApprovalRecordsByShip(
    shipId: string,
    occurredAt: string,
    thresholdHours: number,
  ): FleetRecord[] {
    this.assertValidShipId(shipId);
    if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
      throw new Error("thresholdHours must be a positive number");
    }

    const thresholdMs = thresholdHours * 60 * 60 * 1000;
    const nowMs = new Date(occurredAt).getTime();
    if (Number.isNaN(nowMs)) {
      throw new Error(`Invalid occurredAt timestamp: ${occurredAt}`);
    }

    return this.getApprovalRecordsByShip(shipId).filter((record) => {
      if (record.approval.status === "APPROVED" || record.approval.status === "REJECTED") {
        return false;
      }

      const lastActionMs = record.approval.lastActionAt ? new Date(record.approval.lastActionAt).getTime() : NaN;
      if (Number.isNaN(lastActionMs) || nowMs - lastActionMs < thresholdMs) {
        return false;
      }

      const lastReminderMs = record.approval.lastStaleNotificationAt
        ? new Date(record.approval.lastStaleNotificationAt).getTime()
        : Number.NEGATIVE_INFINITY;

      return lastReminderMs < lastActionMs;
    });
  }

  submitApprovalRecord(
    recordId: string,
    shipId: string,
    occurredAt: string,
    actor: RoleId,
    transitionId: string,
    reason: string | null,
    note: string | null,
  ): FleetRecord {
    this.assertValidRole(actor, "actor");
    return this.applyApprovalTransition(
      recordId,
      shipId,
      actor,
      occurredAt,
      transitionId,
      "SUBMITTED",
      reason,
      note,
      (current) => {
        if (current.approval.status !== "DRAFT") {
          throw new Error(`Invalid approval status transition: ${current.approval.status} -> SUBMITTED`);
        }
        const nextIndex = current.approval.currentStepIndex + 1;
        if (nextIndex >= current.approval.chain.length) {
          throw new Error("Approval chain has no next owner for submit");
        }
        const nextOwner = this.getApprovalChainRole(current.approval.chain, nextIndex);
        return {
          approval: {
            ...current.approval,
            currentStepIndex: nextIndex,
            approvalLevel: nextIndex,
            currentOwner: nextOwner,
            status: "SUBMITTED",
            submittedAt: occurredAt,
            rejectedAt: null,
            lastActionBy: actor,
            lastActionAt: occurredAt,
            lastActionReason: reason,
            lastActionNote: note,
            version: current.approval.version + 1,
          },
        };
      },
    );
  }

  approveApprovalRecord(
    recordId: string,
    shipId: string,
    occurredAt: string,
    actor: RoleId,
    transitionId: string,
    reason: string | null,
    note: string | null,
  ): FleetRecord {
    this.assertValidRole(actor, "actor");
    return this.applyApprovalTransition(
      recordId,
      shipId,
      actor,
      occurredAt,
      transitionId,
      "APPROVED",
      reason,
      note,
      (current) => {
        if (current.approval.status !== "SUBMITTED") {
          throw new Error(`Invalid approval status transition: ${current.approval.status} -> APPROVED`);
        }
        if (current.approval.currentOwner !== actor) {
          throw new Error("Only the current owner may approve the record");
        }
        const isFinalStep = current.approval.currentStepIndex === current.approval.chain.length - 1;
        if (isFinalStep) {
          return {
            approval: {
              ...current.approval,
              status: "APPROVED",
              approvedAt: occurredAt,
              lastActionBy: actor,
              lastActionAt: occurredAt,
              lastActionReason: reason,
              lastActionNote: note,
              version: current.approval.version + 1,
            },
          };
        }

        const nextIndex = current.approval.currentStepIndex + 1;
        const nextOwner = this.getApprovalChainRole(current.approval.chain, nextIndex);
        return {
          approval: {
            ...current.approval,
            currentStepIndex: nextIndex,
            approvalLevel: nextIndex,
            currentOwner: nextOwner,
            status: "SUBMITTED",
            approvedAt: null,
            lastActionBy: actor,
            lastActionAt: occurredAt,
            lastActionReason: reason,
            lastActionNote: note,
            version: current.approval.version + 1,
          },
        };
      },
    );
  }

  rejectApprovalRecord(
    recordId: string,
    shipId: string,
    occurredAt: string,
    actor: RoleId,
    transitionId: string,
    reason: string | null,
    note: string | null,
  ): FleetRecord {
    this.assertValidRole(actor, "actor");
    return this.applyApprovalTransition(
      recordId,
      shipId,
      actor,
      occurredAt,
      transitionId,
      "REJECTED",
      reason,
      note,
      (current) => {
        if (current.approval.status !== "SUBMITTED") {
          throw new Error(`Invalid approval status transition: ${current.approval.status} -> REJECTED`);
        }
        if (current.approval.currentOwner !== actor) {
          throw new Error("Only the current owner may reject the record");
        }
        const previousOwner = this.getPreviousApprovalOwner(recordId, current);
        const previousIndex = current.approval.chain.indexOf(previousOwner);
        if (previousIndex < 0 || previousIndex >= current.approval.currentStepIndex) {
          throw new Error("Approval rejection could not resolve a valid previous owner");
        }
        return {
          approval: {
            ...current.approval,
            currentStepIndex: previousIndex,
            approvalLevel: previousIndex,
            currentOwner: previousOwner,
            status: "REJECTED",
            rejectedAt: occurredAt,
            approvedAt: null,
            lastActionBy: actor,
            lastActionAt: occurredAt,
            lastActionReason: reason,
            lastActionNote: note,
            version: current.approval.version + 1,
          },
        };
      },
    );
  }

  getAllTasks(): Task[] {
    return [...this.tasksById.values()];
  }

  getTasksByShip(shipId: string): Task[] {
    this.assertValidShipId(shipId);
    return this.getAllTasks().filter((task) => task.shipId === shipId);
  }

  getOverdueTasks(): Task[] {
    return this.getAllTasks().filter((task) => task.status === "OVERDUE");
  }

  getOverdueTasksByShip(shipId: string): Task[] {
    this.assertValidShipId(shipId);
    return this.getOverdueTasks().filter((task) => task.shipId === shipId);
  }

  saveShip(ship: Ship): Ship {
    this.assertValidShip(ship);
    this.shipsById.set(ship.id, ship);
    this.persistState();
    return ship;
  }

  getShip(shipId: string): Ship | null {
    return this.shipsById.get(shipId) ?? null;
  }

  getAllShips(): Ship[] {
    return [...this.shipsById.values()];
  }

  createNotification(
    input: Omit<Notification, "id" | "read">,
  ): Notification {
    this.assertValidShipId(input.shipId);
    this.assertShipExists(input.shipId);
    this.assertValidRole(input.targetRole, "targetRole");
    const dedupeKey = this.buildNotificationDedupeKey(input);
    const existing = [...this.notificationsById.values()].find(
      (notification) => notification.dedupeKey === dedupeKey,
    );
    if (existing) {
      logger.warn("duplicate_notification_skipped", {
        ...(input.taskId ? { taskId: input.taskId } : {}),
        status: dedupeKey,
      });
      return existing;
    }

    const notification: Notification = {
      ...input,
      id: `notification_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dedupeKey,
      read: false,
    };

    this.notificationsById.set(notification.id, notification);
    this.persistState();
    return notification;
  }

  getNotifications(shipId: string, role: RoleId): Notification[] {
    this.assertValidShipId(shipId);
    this.assertValidRole(role, "role");
    return [...this.notificationsById.values()].filter(
      (notification) =>
        notification.shipId === shipId && notification.targetRole === role,
    );
  }

  addComplianceSignals(signals: ComplianceSignal[]): void {
    for (const signal of signals) {
      this.assertValidComplianceSignal(signal);
      this.complianceSignalsByKey.set(
        this.buildComplianceSignalKey(signal),
        signal,
      );
    }

    this.persistState();
  }

  getComplianceSignalsByShip(shipId: string): ComplianceSignal[] {
    this.assertValidShipId(shipId);
    return this.getAllComplianceSignals().filter((signal) => signal.shipId === shipId);
  }

  getAllComplianceSignals(): ComplianceSignal[] {
    return [...this.complianceSignalsByKey.values()].sort((left, right) =>
      this.compareComplianceSignals(left, right),
    );
  }

  clearComplianceSignals(): void {
    this.complianceSignalsByKey.clear();
    this.persistState();
  }

  markNotificationRead(notificationId: string): Notification {
    const notification = this.notificationsById.get(notificationId);
    if (!notification) {
      throw new Error(`Notification not found: ${notificationId}`);
    }
    if (notification.read) {
      return notification;
    }

    const next: Notification = {
      ...notification,
      read: true,
    };
    this.notificationsById.set(notificationId, next);
    this.persistState();
    return next;
  }

  flush(): void {
    this.persistState();
  }

  getHealthCheck(): StoreHealthCheck {
    const tasks = [...this.tasksById.values()];
    const perShip = Object.fromEntries(
      [...this.shipsById.keys()].map((shipId) => {
        const shipTasks = tasks.filter((task) => task.shipId === shipId);
        return [
          shipId,
          {
            totalTasks: shipTasks.length,
            overdueTasks: shipTasks.filter((task) => task.status === "OVERDUE").length,
            escalationCounts: {
              none: shipTasks.filter((task) => task.escalationLevel === "NONE").length,
              mcc: shipTasks.filter((task) => task.escalationLevel === "MCC").length,
              logComd: shipTasks.filter((task) => task.escalationLevel === "LOG_COMD").length,
            },
          },
        ];
      }),
    );

    return {
      running: true,
      totalTasks: tasks.length,
      overdueTasks: tasks.filter((task) => task.status === "OVERDUE").length,
      escalationCounts: {
        none: tasks.filter((task) => task.escalationLevel === "NONE").length,
        mcc: tasks.filter((task) => task.escalationLevel === "MCC").length,
        logComd: tasks.filter((task) => task.escalationLevel === "LOG_COMD").length,
      },
      perShip,
      lastPersistenceTimestamp: this.lastPersistenceTimestamp,
    };
  }

  seedDailyLogs(
    shipId: string,
    businessDate: string,
    logTypes: LogType[],
    submittedByRole: "MARINE_ENGINEERING_OFFICER" = "MARINE_ENGINEERING_OFFICER",
  ): void {
    const submittedAt = new Date().toISOString();
    for (const logType of logTypes) {
      this.saveLog({
        shipId,
        businessDate,
        logType,
        submittedAt,
        submittedByRole,
      });
    }
  }

  private normalizeAwarenessOptions(
    options: ApprovalAwarenessQueryOptions,
  ): NormalizedAwarenessOptions {
    if (typeof options.shipId === "string") {
      this.assertValidShipId(options.shipId);
    }

    const now = options.now ?? new Date().toISOString();
    const nowMs = new Date(now).getTime();
    if (Number.isNaN(nowMs)) {
      throw new Error(`Invalid awareness timestamp: ${now}`);
    }

    const staleThresholdHours = options.staleThresholdHours ?? DEFAULT_AWARENESS_STALE_THRESHOLD_HOURS;
    const pendingThresholdHours = options.pendingThresholdHours ?? DEFAULT_AWARENESS_PENDING_THRESHOLD_HOURS;
    const recentlyRejectedWindowHours =
      options.recentlyRejectedWindowHours ?? DEFAULT_AWARENESS_REJECTED_WINDOW_HOURS;
    const topActionableLimit = options.topActionableLimit ?? DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT;

    this.assertPositiveNumber(staleThresholdHours, "staleThresholdHours");
    this.assertPositiveNumber(pendingThresholdHours, "pendingThresholdHours");
    this.assertPositiveNumber(recentlyRejectedWindowHours, "recentlyRejectedWindowHours");
    this.assertPositiveInteger(topActionableLimit, "topActionableLimit");

    return {
      ...(typeof options.shipId === "string" ? { shipId: options.shipId } : {}),
      now,
      nowMs,
      staleThresholdHours,
      pendingThresholdHours,
      recentlyRejectedWindowHours,
      topActionableLimit,
    };
  }

  private normalizeActorContext(actor: ActorContext): Required<Pick<ActorContext, "role">> & Pick<ActorContext, "shipId"> {
    this.assertValidAssignedRole(actor.role, "actor.role");

    if (typeof actor.shipId === "string") {
      this.assertValidShipId(actor.shipId);
    }

    if (this.requiresShipScopedVisibility(actor.role)) {
      if (!actor.shipId) {
        throw new Error(`shipId is required for role ${actor.role}`);
      }
      return {
        role: actor.role,
        shipId: actor.shipId,
      };
    }

    return {
      role: actor.role,
      ...(actor.shipId ? { shipId: actor.shipId } : {}),
    };
  }

  private requiresShipScopedVisibility(role: AssignedRoleId): boolean {
    return (
      role === "MARINE_ENGINEERING_OFFICER" ||
      role === "WEAPON_ELECTRICAL_OFFICER" ||
      role === "COMMANDING_OFFICER"
    );
  }

  private resolveActorScopedShipId(
    actor: Required<Pick<ActorContext, "role">> & Pick<ActorContext, "shipId">,
    options: NormalizedAwarenessOptions,
  ): string | undefined {
    if (this.requiresShipScopedVisibility(actor.role)) {
      return actor.shipId;
    }

    if (actor.shipId && options.shipId && actor.shipId !== options.shipId) {
      throw new Error(`shipId mismatch for actor ${actor.role}: ${actor.shipId} != ${options.shipId}`);
    }

    return options.shipId ?? actor.shipId;
  }

  private getVisibleApprovalRecordsForAwareness(
    actor: Required<Pick<ActorContext, "role">> & Pick<ActorContext, "shipId">,
    options: NormalizedAwarenessOptions,
  ): FleetRecord[] {
    const scopedShipId = this.resolveActorScopedShipId(actor, options);
    const records = scopedShipId
      ? this.getApprovalRecordsVisibleToRole(scopedShipId, actor.role)
      : [...this.recordsById.values()].filter((record) => record.visibleTo.includes(actor.role));

    if (this.requiresShipScopedVisibility(actor.role)) {
      return records.filter((record) => record.shipId === actor.shipId);
    }

    return scopedShipId ? records.filter((record) => record.shipId === scopedShipId) : records;
  }

  private isRecordVisibleToActor(
    record: FleetRecord,
    actor: Required<Pick<ActorContext, "role">> & Pick<ActorContext, "shipId">,
  ): boolean {
    if (!record.visibleTo.includes(actor.role)) {
      return false;
    }

    if (this.requiresShipScopedVisibility(actor.role)) {
      return record.shipId === actor.shipId;
    }

    if (actor.shipId) {
      return record.shipId === actor.shipId;
    }

    return true;
  }

  private projectApprovalAwarenessRecord(
    record: FleetRecord,
    role: AssignedRoleId,
    options: NormalizedAwarenessOptions,
  ): ApprovalAwarenessRecord {
    if (!record.visibleTo.includes(role)) {
      throw new Error(`Awareness projection cannot include invisible record: ${record.id}`);
    }

    const ship = this.getShip(record.shipId);
    if (!ship) {
      throw new Error(`Ship not found for awareness projection: ${record.shipId}`);
    }

    const history = [...(this.approvalHistoryById.get(record.id) ?? [])];
    const lastHistory = history.length > 0 ? history[history.length - 1] : null;
    const ageHoursSinceLastAction = this.getElapsedHours(options.nowMs, record.approval.lastActionAt);
    const ageHoursSinceSubmission = this.getElapsedHours(options.nowMs, record.approval.submittedAt);
    const isStale = this.isAwarenessRecordStale(record, options.nowMs, options.staleThresholdHours);
    const isPendingTooLong = this.isAwarenessRecordPendingTooLong(
      record,
      options.nowMs,
      options.pendingThresholdHours,
    );
    const attentionSignals = this.resolveAwarenessAttentionSignals(
      record,
      isStale,
      isPendingTooLong,
    );
    const bucket = this.resolveAwarenessBucket(record, role, options.nowMs, options.recentlyRejectedWindowHours);

    return {
      recordId: record.id,
      referenceNumber: record.referenceNumber,
      shipId: record.shipId,
      shipName: ship.name,
      shipClass: ship.classType,
      kind: record.kind,
      systemGroup: record.systemGroup,
      title: record.title,
      businessDate: record.businessDate,
      originRole: record.originRole,
      status: record.approval.status,
      currentOwner: record.approval.currentOwner,
      approvalLevel: record.approval.approvalLevel,
      currentStepIndex: record.approval.currentStepIndex,
      chain: [...record.approval.chain],
      visibleTo: [...record.visibleTo],
      createdAt: record.createdAt,
      submittedAt: record.approval.submittedAt,
      approvedAt: record.approval.approvedAt,
      rejectedAt: record.approval.rejectedAt,
      lastActionAt: record.approval.lastActionAt,
      lastActionBy: record.approval.lastActionBy,
      lastActionReason: record.approval.lastActionReason,
      lastActionNote: record.approval.lastActionNote,
      lastHistoryAction: lastHistory?.actionType ?? null,
      lastHistoryAt: lastHistory?.timestamp ?? null,
      previousOwner: this.resolveAwarenessPreviousOwner(record.approval.currentOwner, history),
      bucket,
      attentionSignals,
      ageHoursSinceLastAction,
      ageHoursSinceSubmission,
      computed: {
        isStale,
        isPendingTooLong,
      },
    };
  }

  private resolveAwarenessBucket(
    record: FleetRecord,
    role: AssignedRoleId,
    nowMs: number,
    recentlyRejectedWindowHours: number,
  ): AwarenessBucket {
    if (record.approval.currentOwner === role && record.approval.status === "SUBMITTED") {
      return "PENDING_MY_ACTION";
    }

    if (this.isRecentlyRejected(record, nowMs, recentlyRejectedWindowHours)) {
      return "RECENTLY_REJECTED";
    }

    if (record.approval.currentOwner === role) {
      return "OWNED";
    }

    return "VISIBLE_NOT_OWNED";
  }

  private resolveAwarenessAttentionSignals(
    record: FleetRecord,
    isStale: boolean,
    isPendingTooLong: boolean,
  ): AttentionSignal[] {
    const signals: AttentionSignal[] = [];

    if (isStale) {
      signals.push("STALE");
    }

    if (record.approval.status === "REJECTED") {
      signals.push("BLOCKED_BY_REJECTION");
    }

    if (isPendingTooLong) {
      signals.push("PENDING_TOO_LONG");
    }

    return signals;
  }

  private isAwarenessRecordPendingTooLong(
    record: FleetRecord,
    nowMs: number,
    pendingThresholdHours: number,
  ): boolean {
    if (record.approval.status !== "SUBMITTED" || record.approval.submittedAt === null) {
      return false;
    }

    const ageHoursSinceSubmission = this.getElapsedHours(nowMs, record.approval.submittedAt);
    return ageHoursSinceSubmission !== null && ageHoursSinceSubmission >= pendingThresholdHours;
  }

  private isAwarenessRecordStale(
    record: FleetRecord,
    nowMs: number,
    staleThresholdHours: number,
  ): boolean {
    if (record.approval.status === "APPROVED" || record.approval.status === "REJECTED") {
      return false;
    }

    if (record.approval.lastActionAt === null) {
      return false;
    }

    const ageHoursSinceLastAction = this.getElapsedHours(nowMs, record.approval.lastActionAt);
    return ageHoursSinceLastAction !== null && ageHoursSinceLastAction >= staleThresholdHours;
  }

  private isRecentlyRejected(
    record: FleetRecord,
    nowMs: number,
    recentlyRejectedWindowHours: number,
  ): boolean {
    if (record.approval.status !== "REJECTED" || record.approval.rejectedAt === null) {
      return false;
    }

    const ageHoursSinceRejection = this.getElapsedHours(nowMs, record.approval.rejectedAt);
    return ageHoursSinceRejection !== null && ageHoursSinceRejection <= recentlyRejectedWindowHours;
  }

  private resolveAwarenessPreviousOwner(
    currentOwner: AssignedRoleId,
    history: ApprovalHistoryEntry[],
  ): AssignedRoleId | null {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const entry = history[index];
      if (!entry) {
        continue;
      }

      if (entry.actionType === "INVALID_ATTEMPT" || entry.actionType === "STALE_REMINDER_SENT") {
        continue;
      }

      if (entry.actionType !== "SUBMITTED" && entry.actionType !== "APPROVED") {
        continue;
      }

      if (entry.previousState.currentOwner === entry.newState.currentOwner) {
        continue;
      }

      if (entry.previousState.currentOwner === currentOwner) {
        return entry.newState.currentOwner;
      }

      if (entry.newState.currentOwner === currentOwner) {
        return entry.previousState.currentOwner;
      }
    }

    return null;
  }

  private compareAwarenessRecords(
    left: ApprovalAwarenessRecord,
    right: ApprovalAwarenessRecord,
  ): number {
    const priorityDifference = this.getAwarenessSortPriority(left) - this.getAwarenessSortPriority(right);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return this.compareByAgeThenCreatedAt(left, right);
  }

  private compareByAgeThenCreatedAt(
    left: Pick<ApprovalAwarenessRecord, "ageHoursSinceLastAction" | "createdAt">,
    right: Pick<ApprovalAwarenessRecord, "ageHoursSinceLastAction" | "createdAt">,
  ): number {
    const leftAge = left.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
    const rightAge = right.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
    if (leftAge !== rightAge) {
      return rightAge - leftAge;
    }

    return left.createdAt.localeCompare(right.createdAt);
  }

  private getAwarenessSortPriority(record: ApprovalAwarenessRecord): number {
    if (record.bucket === "PENDING_MY_ACTION" && record.attentionSignals.length > 0) {
      return 0;
    }

    switch (record.bucket) {
      case "PENDING_MY_ACTION":
        return 1;
      case "RECENTLY_REJECTED":
        return 2;
      case "OWNED":
        return 3;
      case "VISIBLE_NOT_OWNED":
        return 4;
      default:
        return 5;
    }
  }

  private getElapsedHours(nowMs: number, timestamp: string | null): number | null {
    if (timestamp === null) {
      return null;
    }

    const timestampMs = new Date(timestamp).getTime();
    if (Number.isNaN(timestampMs)) {
      return null;
    }

    return Math.max(0, Math.floor((nowMs - timestampMs) / (60 * 60 * 1000)));
  }

  private assertApprovalAwarenessRecords(
    actor: Required<Pick<ActorContext, "role">> & Pick<ActorContext, "shipId">,
    records: ApprovalAwarenessRecord[],
  ): void {
    const seenRecordIds = new Set<string>();

    for (const record of records) {
      if (!record.visibleTo.includes(actor.role)) {
        throw new Error(`Awareness record leaked outside visibility scope: ${record.recordId}`);
      }
      if (this.requiresShipScopedVisibility(actor.role) && record.shipId !== actor.shipId) {
        throw new Error(`Awareness record leaked outside actor ship scope: ${record.recordId}`);
      }

      if (seenRecordIds.has(record.recordId)) {
        throw new Error(`Duplicate awareness record detected: ${record.recordId}`);
      }
      seenRecordIds.add(record.recordId);

      const resolvedBucket = (() => {
        switch (record.bucket) {
          case "PENDING_MY_ACTION":
            return record.currentOwner === actor.role && record.status === "SUBMITTED";
          case "RECENTLY_REJECTED":
            return record.status === "REJECTED" && record.rejectedAt !== null;
          case "OWNED":
            return record.currentOwner === actor.role;
          case "VISIBLE_NOT_OWNED":
            return record.currentOwner !== actor.role;
          default:
            return false;
        }
      })();

      if (!resolvedBucket) {
        throw new Error(`Awareness bucket integrity check failed: ${record.recordId}`);
      }

      if (record.computed.isPendingTooLong !== record.attentionSignals.includes("PENDING_TOO_LONG")) {
        throw new Error(`Pending-too-long mismatch in awareness record: ${record.recordId}`);
      }

      if (record.computed.isStale !== record.attentionSignals.includes("STALE")) {
        throw new Error(`Stale mismatch in awareness record: ${record.recordId}`);
      }
    }
  }

  private assertApprovalAwarenessSummary(
    summary: RoleDashboardSummary,
    actor: Required<Pick<ActorContext, "role">> & Pick<ActorContext, "shipId">,
  ): void {
    const records = summary.records;
    const byStatus = Object.values(summary.countsByStatus).reduce((sum, count) => sum + count, 0);
    const byRole = Object.values(summary.countsByRole).reduce((sum, count) => sum + count, 0);
    const byShip = Object.values(summary.countsByShip).reduce((sum, count) => sum + count, 0);

    if (summary.totals.visible !== records.length) {
      throw new Error("Awareness summary visible total does not match records length");
    }

    if (byStatus !== records.length || byRole !== records.length || byShip !== records.length) {
      throw new Error("Awareness summary aggregates do not match filtered dataset");
    }

    for (const record of summary.topActionableRecords) {
      if (record.bucket !== "PENDING_MY_ACTION") {
        throw new Error(`Top actionable awareness record is not actionable: ${record.recordId}`);
      }
      if (!record.visibleTo.includes(actor.role)) {
        throw new Error(`Top actionable awareness record leaked visibility: ${record.recordId}`);
      }
      if (this.requiresShipScopedVisibility(actor.role) && record.shipId !== actor.shipId) {
        throw new Error(`Top actionable awareness record leaked ship scope: ${record.recordId}`);
      }
    }
  }

  private assertPositiveNumber(value: number, fieldName: string): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${fieldName} must be a positive number`);
    }
  }

  private assertPositiveInteger(value: number, fieldName: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${fieldName} must be a positive integer`);
    }
  }

  private requireTask(taskId: string): Task {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private getDailyStateKey(shipId: string, businessDate: string): string {
    this.assertValidShipId(shipId);
    return `${shipId}:${businessDate}`;
  }

  private appendTaskHistory(
    taskId: string,
    shipId: string,
    actionType: TaskHistoryType,
    previousState: TaskStateSnapshot,
    newState: TaskStateSnapshot,
    timestamp: string,
    actor: RoleId,
  ): void {
    const current = this.taskHistoryById.get(taskId) ?? [];
    current.push({
      taskId,
      shipId,
      timestamp,
      actionType,
      previousState,
      newState,
      actor,
    });
    this.taskHistoryById.set(taskId, current);
    logger.stateChange({
      taskId,
      actionType,
      status: newState.status,
      result: `${previousState.status}->${newState.status}`,
    });
  }

  private appendApprovalHistory(
    recordId: string,
    shipId: string,
    actionType: ApprovalHistoryType,
    previousState: ApprovalRecordSnapshot,
    newState: ApprovalRecordSnapshot,
    timestamp: string,
    actor: RoleId,
    transitionId: string | null,
    reason: string | null,
    note: string | null,
  ): void {
    const current = this.approvalHistoryById.get(recordId) ?? [];
    current.push({
      recordId,
      shipId,
      timestamp,
      actionType,
      previousState,
      newState,
      actor,
      transitionId,
      reason,
      note,
    });
    this.approvalHistoryById.set(recordId, current);
    logger.stateChange({
      actionType,
      status: newState.status,
      result: `${previousState.status}->${newState.status}`,
    });
  }

  recordApprovalInvalidAttempt(
    recordId: string,
    shipId: string,
    occurredAt: string,
    actor: RoleId,
    transitionId: string | null,
    reason: string,
    note: string | null,
  ): void {
    const record = this.getApprovalRecordInShip(recordId, shipId);
    if (!record) {
      return;
    }

    const state = this.createApprovalSnapshot(record);
    this.appendApprovalHistory(
      recordId,
      shipId,
      "INVALID_ATTEMPT",
      state,
      state,
      occurredAt,
      actor,
      transitionId,
      reason,
      note,
    );
    this.persistState();
  }

  recordApprovalStaleNotification(
    recordId: string,
    shipId: string,
    occurredAt: string,
    actor: RoleId,
  ): FleetRecord {
    const record = this.getApprovalRecordInShip(recordId, shipId);
    if (!record) {
      throw new Error("Approval record does not exist in the provided ship context");
    }
    this.assertApprovalRecordMutable(record, "stale reminder");

    const previousState = this.createApprovalSnapshot(record);
    const next: FleetRecord = {
      ...record,
      approval: {
        ...record.approval,
        lastStaleNotificationAt: occurredAt,
      },
    };
    this.recordsById.set(recordId, next);
    const newState = this.createApprovalSnapshot(next);
    this.appendApprovalHistory(
      recordId,
      shipId,
      "STALE_REMINDER_SENT",
      previousState,
      newState,
      occurredAt,
      actor,
      null,
      "Stale approval reminder sent",
      null,
    );
    this.persistState();
    return next;
  }

  private applyTaskUpdate(
    taskId: string,
    update: Partial<Task>,
    actionType: TaskHistoryType,
    occurredAt: string,
    actor: RoleId,
  ): Task {
    const current = this.requireTask(taskId);
    const previousState = this.createStateSnapshot(current);
    const next: Task = {
      ...current,
      ...update,
    };

    this.tasksById.set(taskId, next);

    const newState = this.createStateSnapshot(next);
    if (!this.isSameState(previousState, newState)) {
      this.appendTaskHistory(
        taskId,
        next.shipId,
        actionType,
        previousState,
        newState,
        occurredAt,
        actor,
      );
    }

    this.persistState();
    return next;
  }

  private createStateSnapshot(task: Task): TaskStateSnapshot {
    return {
      shipId: task.shipId,
      parentTaskId: task.parentTaskId,
      kind: task.kind,
      systemGroup: task.systemGroup,
      mic: task.mic,
      iss: task.iss,
      equipment: task.equipment,
      cycleCode: task.cycleCode,
      scheduleSource: task.scheduleSource,
      assignedRole: task.assignedRole,
      status: task.status,
      executionStatus: task.executionStatus,
      completedAt: task.completedAt,
      verificationBy: task.verificationBy,
      verificationAt: task.verificationAt,
      lastCheckedAt: task.lastCheckedAt,
      lastOverdueAt: task.lastOverdueAt,
      replannedFromDueDate: task.replannedFromDueDate,
      replannedToDueDate: task.replannedToDueDate,
      escalationLevel: task.escalationLevel,
      dueDate: task.dueDate,
      lastNotifiedAt: task.lastNotifiedAt,
      ...(typeof task.lastCompletedAt === "number" ? { lastCompletedAt: task.lastCompletedAt } : {}),
      ...(typeof task.nextDueAt === "number" ? { nextDueAt: task.nextDueAt } : {}),
      ...(task.interval ? { interval: task.interval } : {}),
      ...(task.calendarInterval ? { calendarInterval: task.calendarInterval } : {}),
      ...(task.usageInterval ? { usageInterval: task.usageInterval } : {}),
      ...(task.usageTracking ? { usageTracking: task.usageTracking } : {}),
      ...(typeof task.requiresReplan !== "undefined" ? { requiresReplan: task.requiresReplan } : {}),
      ...(typeof task.defectId !== "undefined" ? { defectId: task.defectId } : {}),
      ...(typeof task.originDirectiveId !== "undefined"
        ? { originDirectiveId: task.originDirectiveId }
        : {}),
      ...(typeof task.originRecordId !== "undefined"
        ? { originRecordId: task.originRecordId }
        : {}),
      ...(typeof task.derivedFromType !== "undefined"
        ? { derivedFromType: task.derivedFromType }
        : {}),
      ...(typeof task.derivedFromId !== "undefined"
        ? { derivedFromId: task.derivedFromId }
        : {}),
      ettrDays: task.ettrDays,
      severity: task.severity,
      escalatedAt: task.escalatedAt,
      ...(typeof task.sectionVerifiedBy !== "undefined"
        ? { sectionVerifiedBy: task.sectionVerifiedBy }
        : {}),
      ...(typeof task.sectionVerifiedAt !== "undefined"
        ? { sectionVerifiedAt: task.sectionVerifiedAt }
        : {}),
      ...(typeof task.departmentVerifiedBy !== "undefined"
        ? { departmentVerifiedBy: task.departmentVerifiedBy }
        : {}),
      ...(typeof task.departmentVerifiedAt !== "undefined"
        ? { departmentVerifiedAt: task.departmentVerifiedAt }
        : {}),
    };
  }

  private createApprovalSnapshot(record: FleetRecord): ApprovalRecordSnapshot {
    return {
      shipId: record.shipId,
      referenceNumber: record.referenceNumber,
      kind: record.kind,
      systemGroup: record.systemGroup,
      title: record.title,
      businessDate: record.businessDate,
      originRole: record.originRole,
      authorityMode: record.authorityMode,
      sourceKind: record.sourceKind,
      digitizationStage: record.digitizationStage,
      ...(typeof record.originDirectiveId !== "undefined"
        ? { originDirectiveId: record.originDirectiveId }
        : {}),
      ...(typeof record.originRecordId !== "undefined"
        ? { originRecordId: record.originRecordId }
        : {}),
      ...(typeof record.derivedFromType !== "undefined"
        ? { derivedFromType: record.derivedFromType }
        : {}),
      ...(typeof record.derivedFromId !== "undefined"
        ? { derivedFromId: record.derivedFromId }
        : {}),
      chain: [...record.approval.chain],
      currentStepIndex: record.approval.currentStepIndex,
      approvalLevel: record.approval.approvalLevel,
      currentOwner: record.approval.currentOwner,
      status: record.approval.status,
      submittedAt: record.approval.submittedAt,
      approvedAt: record.approval.approvedAt,
      rejectedAt: record.approval.rejectedAt,
      lastActionBy: record.approval.lastActionBy,
      lastActionAt: record.approval.lastActionAt,
      lastActionReason: record.approval.lastActionReason,
      lastActionNote: record.approval.lastActionNote,
      lastStaleNotificationAt: record.approval.lastStaleNotificationAt,
      version: record.approval.version,
    };
  }

  private isSameState(
    left: TaskStateSnapshot,
    right: TaskStateSnapshot,
  ): boolean {
    return (
      left.shipId === right.shipId &&
      left.parentTaskId === right.parentTaskId &&
      left.kind === right.kind &&
      left.systemGroup === right.systemGroup &&
      left.mic === right.mic &&
      left.iss === right.iss &&
      left.equipment === right.equipment &&
      left.cycleCode === right.cycleCode &&
      left.scheduleSource === right.scheduleSource &&
      left.assignedRole === right.assignedRole &&
      left.status === right.status &&
      left.executionStatus === right.executionStatus &&
      left.completedAt === right.completedAt &&
      left.verificationBy === right.verificationBy &&
      left.verificationAt === right.verificationAt &&
      left.lastCheckedAt === right.lastCheckedAt &&
      left.lastOverdueAt === right.lastOverdueAt &&
      left.replannedFromDueDate === right.replannedFromDueDate &&
      left.replannedToDueDate === right.replannedToDueDate &&
      left.escalationLevel === right.escalationLevel &&
      left.dueDate === right.dueDate &&
      left.lastNotifiedAt === right.lastNotifiedAt &&
      left.lastCompletedAt === right.lastCompletedAt &&
      left.nextDueAt === right.nextDueAt &&
      this.isSameInterval(left.interval, right.interval) &&
      this.isSameInterval(left.calendarInterval, right.calendarInterval) &&
      this.isSameInterval(left.usageInterval, right.usageInterval) &&
      this.isSameUsageTracking(left.usageTracking, right.usageTracking) &&
      left.requiresReplan === right.requiresReplan &&
      left.defectId === right.defectId &&
      left.originDirectiveId === right.originDirectiveId &&
      left.originRecordId === right.originRecordId &&
      left.derivedFromType === right.derivedFromType &&
      left.derivedFromId === right.derivedFromId &&
      left.ettrDays === right.ettrDays &&
      left.severity === right.severity &&
      left.escalatedAt === right.escalatedAt &&
      left.sectionVerifiedBy === right.sectionVerifiedBy &&
      left.sectionVerifiedAt === right.sectionVerifiedAt &&
      left.departmentVerifiedBy === right.departmentVerifiedBy &&
      left.departmentVerifiedAt === right.departmentVerifiedAt
    );
  }

  private isSameApprovalState(
    left: ApprovalRecordSnapshot,
    right: ApprovalRecordSnapshot,
  ): boolean {
    return (
      left.shipId === right.shipId &&
      left.referenceNumber === right.referenceNumber &&
      left.kind === right.kind &&
      left.systemGroup === right.systemGroup &&
      left.title === right.title &&
      left.businessDate === right.businessDate &&
      left.originRole === right.originRole &&
      left.authorityMode === right.authorityMode &&
      left.sourceKind === right.sourceKind &&
      left.digitizationStage === right.digitizationStage &&
      left.originDirectiveId === right.originDirectiveId &&
      left.originRecordId === right.originRecordId &&
      left.derivedFromType === right.derivedFromType &&
      left.derivedFromId === right.derivedFromId &&
      left.chain.length === right.chain.length &&
      left.chain.every((role, index) => role === right.chain[index]) &&
      left.currentStepIndex === right.currentStepIndex &&
      left.approvalLevel === right.approvalLevel &&
      left.currentOwner === right.currentOwner &&
      left.status === right.status &&
      left.submittedAt === right.submittedAt &&
      left.approvedAt === right.approvedAt &&
      left.rejectedAt === right.rejectedAt &&
      left.lastActionBy === right.lastActionBy &&
      left.lastActionAt === right.lastActionAt &&
      left.lastActionReason === right.lastActionReason &&
      left.lastActionNote === right.lastActionNote &&
      left.lastStaleNotificationAt === right.lastStaleNotificationAt &&
      left.version === right.version
    );
  }

  private isSameInterval(left?: Task["interval"], right?: Task["interval"]): boolean {
    if (!left && !right) {
      return true;
    }

    if (!left || !right) {
      return false;
    }

    return (
      left.type === right.type &&
      left.value === right.value &&
      left.unit === right.unit
    );
  }

  private isSameUsageTracking(
    left?: Task["usageTracking"],
    right?: Task["usageTracking"],
  ): boolean {
    if (!left && !right) {
      return true;
    }

    if (!left || !right) {
      return false;
    }

    return (
      left.hoursRun === right.hoursRun &&
      left.shotsFired === right.shotsFired
    );
  }

  private deriveNextDueAt(task: Task, completedAt: number): number | undefined {
    if (!Number.isFinite(completedAt)) {
      return task.nextDueAt;
    }

    const triggerCandidates = [
      this.deriveIntervalDueAt(task.interval, completedAt),
      this.deriveIntervalDueAt(task.calendarInterval, completedAt),
      typeof task.nextDueAt === "number" && Number.isFinite(task.nextDueAt)
        ? task.nextDueAt
        : undefined,
    ].filter((candidate): candidate is number => typeof candidate === "number");

    if (triggerCandidates.length === 0) {
      return undefined;
    }

    return Math.min(...triggerCandidates);
  }

  private deriveIntervalDueAt(
    interval: Task["interval"] | Task["calendarInterval"],
    completedAt: number,
  ): number | undefined {
    if (!interval || interval.type !== "CALENDAR") {
      return undefined;
    }

    return completedAt + this.convertIntervalToMs(interval);
  }

  private computeMinimalNextDueAt(
    task: Task,
    occurredAt: string,
    nextDueDate: string,
  ): number {
    const occurredAtMs = Date.parse(occurredAt);
    const fallbackDueAt = Date.parse(nextDueDate);
    const minimalIntervalMs = this.getMinimalIntervalMs(task);
    if (Number.isFinite(occurredAtMs) && Number.isFinite(minimalIntervalMs)) {
      return occurredAtMs + minimalIntervalMs;
    }

    if (Number.isFinite(fallbackDueAt)) {
      return fallbackDueAt;
    }

    return Date.now() + 24 * 60 * 60 * 1000;
  }

  private getMinimalIntervalMs(task: Task): number {
    const intervals = [task.interval, task.calendarInterval, task.usageInterval]
      .filter((interval): interval is NonNullable<Task["interval"]> => Boolean(interval))
      .map((interval) => this.convertIntervalToMs(interval))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (intervals.length === 0) {
      return 24 * 60 * 60 * 1000;
    }

    return Math.min(...intervals);
  }

  private convertIntervalToMs(interval: NonNullable<Task["interval"]>): number {
    const unitMs = interval.unit === "HOURS" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return interval.value * unitMs;
  }

  private applyApprovalTransition(
    recordId: string,
    shipId: string,
    actor: RoleId,
    occurredAt: string,
    transitionId: string,
    actionType: ApprovalHistoryType,
    reason: string | null,
    note: string | null,
    mutator: (record: FleetRecord) => Partial<FleetRecord>,
  ): FleetRecord {
    this.assertValidShipId(shipId);
    const current = this.getApprovalRecordInShip(recordId, shipId);
    if (!current) {
      throw new Error("Approval record does not exist in the provided ship context");
    }

    const processedRecordId = this.processedTransitions.get(transitionId);
    if (processedRecordId) {
      if (processedRecordId.recordId !== recordId || processedRecordId.actionType !== actionType) {
        throw new Error(`Transition ID already used for another record: ${transitionId}`);
      }
      return current;
    }

    if (this.isTerminalApprovalStatus(current.approval.status)) {
      this.recordApprovalInvalidAttempt(
        recordId,
        shipId,
        occurredAt,
        actor,
        transitionId,
        `Transition blocked in terminal state: ${current.approval.status}`,
        note,
      );
      throw new Error(`Approval record is in terminal state: ${current.approval.status}`);
    }

    const previousState = this.createApprovalSnapshot(current);
    let next: FleetRecord;
    try {
      next = {
        ...current,
        ...mutator(current),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid approval transition";
      this.recordApprovalInvalidAttempt(
        recordId,
        shipId,
        occurredAt,
        actor,
        transitionId,
        reason,
        note,
      );
      throw error;
    }
    this.assertValidFleetRecord(next);
    this.recordsById.set(recordId, next);
    const newState = this.createApprovalSnapshot(next);

    if (!this.isSameApprovalState(previousState, newState)) {
      this.appendApprovalHistory(
        recordId,
        shipId,
        actionType,
        previousState,
        newState,
        occurredAt,
        actor,
        transitionId,
        reason,
        note,
      );
    }

    this.processedTransitions.set(transitionId, {
      recordId,
      actionType,
    });
    this.persistState();
    return next;
  }

  private assertTaskStatusTransition(
    current: Task["status"],
    next: Task["status"],
  ): void {
    if (current === next) {
      return;
    }

    const allowedTransitions: Record<Task["status"], Task["status"][]> = {
      PENDING: ["COMPLETED", "OVERDUE"],
      OVERDUE: ["COMPLETED"],
      COMPLETED: [],
    };

    if (!allowedTransitions[current].includes(next)) {
      throw new Error(`Invalid task status transition: ${current} -> ${next}`);
    }
  }

  private assertEscalationTransition(
    current: Task["escalationLevel"],
    next: Task["escalationLevel"],
  ): void {
    const allowedTransitions: Record<Task["escalationLevel"], Task["escalationLevel"][]> = {
      NONE: ["MCC", "LOG_COMD"],
      MCC: ["LOG_COMD"],
      LOG_COMD: [],
    };

    if (current === next) {
      return;
    }

    if (!allowedTransitions[current].includes(next)) {
      throw new Error(`Invalid escalation transition: ${current} -> ${next}`);
    }
  }

  private isTerminalApprovalStatus(status: ApprovalStatus): boolean {
    return status === "APPROVED" || status === "REJECTED";
  }

  private assertApprovalRecordMutable(record: FleetRecord, operation: string): void {
    if (this.isTerminalApprovalStatus(record.approval.status)) {
      throw new Error(`Approval record is immutable in terminal state during ${operation}: ${record.approval.status}`);
    }
  }

  private assertValidRole(role: RoleId, fieldName: string): void {
    if (!this.isRoleId(role)) {
      logger.error("role_validation_failed", new Error(`Invalid ${fieldName}`), {
        actionType: fieldName,
        status: String(role),
      });
      throw new Error(`Invalid ${fieldName}: ${String(role)}`);
    }
  }

  private assertValidAssignedRole(role: AssignedRoleId, fieldName: string): void {
    if (!this.isAssignedRoleId(role)) {
      logger.error("assigned_role_validation_failed", new Error(`Invalid ${fieldName}`), {
        actionType: fieldName,
        status: String(role),
      });
      throw new Error(`Invalid ${fieldName}: ${String(role)}`);
    }
  }

  private assertValidShipId(shipId: string): void {
    if (typeof shipId !== "string" || shipId.trim() === "") {
      logger.error("ship_id_validation_failed", new Error("Invalid shipId"), {
        actionType: "shipId",
        status: String(shipId),
      });
      throw new Error(`Invalid shipId: ${String(shipId)}`);
    }
  }

  private assertValidShip(ship: Ship): void {
    if (
      typeof ship.id !== "string" ||
      ship.id.trim() === "" ||
      typeof ship.name !== "string" ||
      ship.name.trim() === "" ||
      typeof ship.classType !== "string" ||
      ship.classType.trim() === ""
    ) {
      logger.error("ship_validation_failed", new Error("Invalid ship"), {
        actionType: "ship",
        status: ship.id ?? "UNKNOWN",
      });
      throw new Error("Invalid ship");
    }
  }

  private assertShipExists(shipId: string): void {
    if (!this.shipsById.has(shipId)) {
      logger.error("ship_not_found", new Error("Unknown ship"), {
        actionType: "shipId",
        status: shipId,
      });
      throw new Error(`Unknown shipId: ${shipId}`);
    }
  }

  private assertTaskEquipmentLinkage(task: Task): void {
    if (typeof task.iss !== "string" || task.iss.trim() === "") {
      throw new Error(`Task ${task.id} requires iss`);
    }

    if (typeof task.equipment !== "string" || task.equipment.trim() === "") {
      throw new Error(`Task ${task.id} requires equipment`);
    }
  }

  private assertValidEquipment(equipment: Equipment): void {
    if (!this.isEquipment(equipment)) {
      throw new Error("Invalid equipment");
    }
  }

  private assertValidDefect(defect: Defect): void {
    if (!this.isDefect(defect)) {
      throw new Error("Invalid defect");
    }
  }

  private loadPersistedState(): void {
    const loaded =
      this.tryLoadFromPath(this.persistenceFilePath)
      ?? this.tryLoadFromPath(this.backupFilePath);

    if (!loaded) {
      this.resetPersistedState();
      return;
    }

    const { state: persisted, path } = loaded;

    this.tasksById.clear();
    this.shipsById.clear();
    for (const ship of persisted.ships) {
      this.shipsById.set(ship.id, ship);
    }

    this.equipmentByIss.clear();
    for (const equipment of persisted.equipment) {
      this.equipmentByIss.set(equipment.iss, equipment);
    }

    for (const task of persisted.tasks) {
      const hydratedTask = this.hydrateTask(task);
      this.tasksById.set(hydratedTask.id, hydratedTask);
    }

    this.defectsById.clear();
    for (const defect of persisted.defects) {
      this.defectsById.set(defect.id, defect);
    }

    this.taskHistoryById.clear();
    for (const [taskId, history] of persisted.taskHistory) {
      this.taskHistoryById.set(
        taskId,
        history.map((entry) => this.hydrateTaskHistoryEntry(entry)),
      );
    }

    this.recordsById.clear();
    for (const record of persisted.records) {
      this.recordsById.set(record.id, record);
    }

    this.approvalHistoryById.clear();
    for (const [recordId, history] of persisted.approvalHistory) {
      this.approvalHistoryById.set(recordId, history);
    }

    this.processedTransitions.clear();
    for (const [transitionId, transition] of persisted.processedTransitions) {
      this.processedTransitions.set(transitionId, transition);
    }

    this.processedEventsById.clear();
    for (const [eventId, processedAt] of Object.entries(persisted.processedEvents)) {
      this.processedEventsById.set(eventId, processedAt);
    }

    this.failedEventsById.clear();
    for (const [eventId, failedEvent] of Object.entries(persisted.failedEvents)) {
      this.failedEventsById.set(eventId, failedEvent);
    }

    this.escalationByDate.clear();
    for (const [businessDate, escalationState] of persisted.escalationState) {
      this.escalationByDate.set(businessDate, escalationState);
    }

    this.notificationsById.clear();
    for (const notification of persisted.notifications) {
      this.notificationsById.set(notification.id, notification);
    }

    this.complianceSignalsByKey.clear();
    for (const signal of persisted.complianceSignals) {
      this.complianceSignalsByKey.set(this.buildComplianceSignalKey(signal), signal);
    }

    try {
      this.lastPersistenceTimestamp = statSync(path).mtime.toISOString();
    } catch (error) {
      logger.error("persisted_state_stat_failed", error, {
        result: path,
        status: "STAT_FAILED",
      });
      this.lastPersistenceTimestamp = null;
    }
  }

  private hydrateTask(task: Task): Task {
    return {
      ...task,
      systemGroup: task.systemGroup ?? "GENERAL_ENGINEERING",
      mic: task.mic ?? "UNSPECIFIED-MIC",
      iss: task.iss ?? "0000",
      equipment: task.equipment ?? task.title,
      cycleCode: task.cycleCode ?? "D",
      scheduleSource: task.scheduleSource ?? "CYCLE",
      executionStatus: task.executionStatus ?? this.deriveExecutionStatus(task.status),
      verificationBy: task.verificationBy ?? null,
      verificationAt: task.verificationAt ?? null,
      ...(typeof task.lastCompletedAt === "number" ? { lastCompletedAt: task.lastCompletedAt } : {}),
      ...(() => {
        const nextDueAt =
          typeof task.nextDueAt === "number"
            ? task.nextDueAt
            : this.parseOptionalTimestamp(task.dueDate);
        return typeof nextDueAt === "number" ? { nextDueAt } : {};
      })(),
      ...(task.interval ? { interval: task.interval } : {}),
      ...(task.calendarInterval ? { calendarInterval: task.calendarInterval } : {}),
      ...(task.usageInterval ? { usageInterval: task.usageInterval } : {}),
      ...(task.usageTracking ? { usageTracking: task.usageTracking } : {}),
      ...(typeof task.requiresReplan !== "undefined" ? { requiresReplan: task.requiresReplan } : {}),
      ...(typeof task.defectId !== "undefined"
        ? { defectId: task.defectId }
        : task.kind === "DEFECT"
          ? { defectId: task.id }
          : {}),
      ...(typeof task.originDirectiveId !== "undefined"
        ? { originDirectiveId: task.originDirectiveId }
        : {}),
      ...(typeof task.originRecordId !== "undefined"
        ? { originRecordId: task.originRecordId }
        : {}),
      ...(typeof task.derivedFromType !== "undefined"
        ? { derivedFromType: task.derivedFromType }
        : {}),
      ...(typeof task.derivedFromId !== "undefined"
        ? { derivedFromId: task.derivedFromId }
        : {}),
      ...(typeof task.sectionVerifiedBy !== "undefined"
        ? { sectionVerifiedBy: task.sectionVerifiedBy }
        : {}),
      ...(typeof task.sectionVerifiedAt !== "undefined"
        ? { sectionVerifiedAt: task.sectionVerifiedAt }
        : {}),
      ...(typeof task.departmentVerifiedBy !== "undefined"
        ? { departmentVerifiedBy: task.departmentVerifiedBy }
        : {}),
      ...(typeof task.departmentVerifiedAt !== "undefined"
        ? { departmentVerifiedAt: task.departmentVerifiedAt }
        : {}),
    };
  }

  private hydrateTaskHistoryEntry(entry: TaskHistoryEntry): TaskHistoryEntry {
    return {
      ...entry,
      previousState: this.hydrateTaskStateSnapshot(entry.previousState),
      newState: this.hydrateTaskStateSnapshot(entry.newState),
    };
  }

  private hydrateTaskStateSnapshot(snapshot: TaskStateSnapshot): TaskStateSnapshot {
    return {
      ...snapshot,
      systemGroup: snapshot.systemGroup ?? "GENERAL_ENGINEERING",
      mic: snapshot.mic ?? "UNSPECIFIED-MIC",
      iss: snapshot.iss ?? "0000",
      equipment: snapshot.equipment ?? "Unspecified Equipment",
      cycleCode: snapshot.cycleCode ?? "D",
      scheduleSource: snapshot.scheduleSource ?? "CYCLE",
      executionStatus: snapshot.executionStatus ?? this.deriveExecutionStatus(snapshot.status),
      verificationBy: snapshot.verificationBy ?? null,
      verificationAt: snapshot.verificationAt ?? null,
      ...(typeof snapshot.lastCompletedAt === "number"
        ? { lastCompletedAt: snapshot.lastCompletedAt }
        : {}),
      ...(() => {
        const nextDueAt =
          typeof snapshot.nextDueAt === "number"
            ? snapshot.nextDueAt
            : this.parseOptionalTimestamp(snapshot.dueDate);
        return typeof nextDueAt === "number" ? { nextDueAt } : {};
      })(),
      ...(snapshot.interval ? { interval: snapshot.interval } : {}),
      ...(snapshot.calendarInterval ? { calendarInterval: snapshot.calendarInterval } : {}),
      ...(snapshot.usageInterval ? { usageInterval: snapshot.usageInterval } : {}),
      ...(snapshot.usageTracking ? { usageTracking: snapshot.usageTracking } : {}),
      ...(typeof snapshot.requiresReplan !== "undefined" ? { requiresReplan: snapshot.requiresReplan } : {}),
      ...(typeof snapshot.defectId !== "undefined" ? { defectId: snapshot.defectId } : {}),
      ...(typeof snapshot.originDirectiveId !== "undefined"
        ? { originDirectiveId: snapshot.originDirectiveId }
        : {}),
      ...(typeof snapshot.originRecordId !== "undefined"
        ? { originRecordId: snapshot.originRecordId }
        : {}),
      ...(typeof snapshot.derivedFromType !== "undefined"
        ? { derivedFromType: snapshot.derivedFromType }
        : {}),
      ...(typeof snapshot.derivedFromId !== "undefined"
        ? { derivedFromId: snapshot.derivedFromId }
        : {}),
      ...(typeof snapshot.sectionVerifiedBy !== "undefined"
        ? { sectionVerifiedBy: snapshot.sectionVerifiedBy }
        : {}),
      ...(typeof snapshot.sectionVerifiedAt !== "undefined"
        ? { sectionVerifiedAt: snapshot.sectionVerifiedAt }
        : {}),
      ...(typeof snapshot.departmentVerifiedBy !== "undefined"
        ? { departmentVerifiedBy: snapshot.departmentVerifiedBy }
        : {}),
      ...(typeof snapshot.departmentVerifiedAt !== "undefined"
        ? { departmentVerifiedAt: snapshot.departmentVerifiedAt }
        : {}),
    };
  }

  private hydrateFleetRecord(record: FleetRecord): FleetRecord {
    return {
      ...record,
      referenceNumber:
        record.referenceNumber
        ?? `NN-FLT-${this.getFleetRecordKindCode(record.kind)}-${record.shipId.toUpperCase()}-${record.id.toUpperCase()}`,
      systemGroup: record.systemGroup ?? "GENERAL_ENGINEERING",
      authorityMode: record.authorityMode ?? "PAPER_AUTHORITATIVE",
      sourceKind: record.sourceKind ?? "DIGITAL_ENTRY",
      digitizationStage: record.digitizationStage ?? "INDEXED",
      ...(typeof record.originDirectiveId !== "undefined"
        ? { originDirectiveId: record.originDirectiveId }
        : {}),
      ...(typeof record.originRecordId !== "undefined"
        ? { originRecordId: record.originRecordId }
        : {}),
      ...(typeof record.derivedFromType !== "undefined"
        ? { derivedFromType: record.derivedFromType }
        : {}),
      ...(typeof record.derivedFromId !== "undefined"
        ? { derivedFromId: record.derivedFromId }
        : {}),
    };
  }

  private hydrateApprovalHistoryEntry(entry: ApprovalHistoryEntry): ApprovalHistoryEntry {
    return {
      ...entry,
      previousState: this.hydrateApprovalRecordSnapshot(entry.previousState),
      newState: this.hydrateApprovalRecordSnapshot(entry.newState),
    };
  }

  private hydrateApprovalRecordSnapshot(snapshot: ApprovalRecordSnapshot): ApprovalRecordSnapshot {
    return {
      ...snapshot,
      referenceNumber: snapshot.referenceNumber ?? "UNKNOWN-REFERENCE",
      systemGroup: snapshot.systemGroup ?? "GENERAL_ENGINEERING",
      authorityMode: snapshot.authorityMode ?? "PAPER_AUTHORITATIVE",
      sourceKind: snapshot.sourceKind ?? "DIGITAL_ENTRY",
      digitizationStage: snapshot.digitizationStage ?? "INDEXED",
      ...(typeof snapshot.originDirectiveId !== "undefined"
        ? { originDirectiveId: snapshot.originDirectiveId }
        : {}),
      ...(typeof snapshot.originRecordId !== "undefined"
        ? { originRecordId: snapshot.originRecordId }
        : {}),
      ...(typeof snapshot.derivedFromType !== "undefined"
        ? { derivedFromType: snapshot.derivedFromType }
        : {}),
      ...(typeof snapshot.derivedFromId !== "undefined"
        ? { derivedFromId: snapshot.derivedFromId }
        : {}),
    };
  }

  private migrateTasks(value: unknown): Task[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is Task => isRecord(item))
      .map((task) => this.hydrateTask(task as Task));
  }

  private migrateTaskHistory(value: unknown): Array<[string, TaskHistoryEntry[]]> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry): entry is [string, TaskHistoryEntry[]] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        Array.isArray(entry[1]),
      )
      .map(([taskId, history]) => [
        taskId,
        history.map((entry) => this.hydrateTaskHistoryEntry(entry)),
      ]);
  }

  private migrateEquipment(value: unknown): Equipment[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is Equipment => this.isEquipment(item));
  }

  private migrateDefects(value: unknown, taskValue: unknown): Defect[] {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is Defect => isRecord(item))
        .map((item) => ({
          ...(item as Defect),
          systemGroup:
            this.isSystemGroupId(item.systemGroup)
            ? item.systemGroup
            : "GENERAL_ENGINEERING",
        }))
        .filter((item): item is Defect => this.isDefect(item));
    }

    return [];
  }

  private deriveExecutionStatus(status: Task["status"]): Task["executionStatus"] {
    switch (status) {
      case "COMPLETED":
        return "COMPLETED";
      case "OVERDUE":
        return "MISSED";
      default:
        return "PENDING";
    }
  }

  private parseOptionalTimestamp(value: string): number | undefined {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private tryLoadFromPath(path: string): { state: PersistedStoreState; path: string } | null {
    if (!existsSync(path)) {
      return null;
    }

    try {
      const raw = readFileSync(path, "utf8");
      if (raw.trim() === "") {
        logger.warn("persisted_state_empty", { result: path, status: "EMPTY" });
        return null;
      }

      const parsed = JSON.parse(raw);
      const migrated = this.tryMigratePersistedState(parsed, path);
      if (!migrated) {
        logger.warn("persisted_state_invalid", { result: path, status: "INVALID" });
        return null;
      }
      if (!this.validatePersistedState(migrated)) {
        logger.warn("persisted_state_invalid", { result: path, status: "INVALID" });
        return null;
      }
      return { state: migrated, path };
    } catch (error) {
      logger.error("persisted_state_load_failed", error, {
        result: path,
        status: "LOAD_FAILED",
      });
      return null;
    }
  }

  private validatePersistedState(value: unknown): value is PersistedStoreState {
    if (!isRecord(value)) {
      return false;
    }

    if (value.version !== STORE_STATE_VERSION) {
      return false;
    }

    if (!Array.isArray(value.tasks) || !value.tasks.every((item) => this.isTask(item))) {
      return false;
    }

    if (!Array.isArray(value.ships) || !value.ships.every((item) => this.isShip(item))) {
      return false;
    }

    if (!Array.isArray(value.equipment) || !value.equipment.every((item) => this.isEquipment(item))) {
      return false;
    }

    if (!Array.isArray(value.defects) || !value.defects.every((item) => this.isDefect(item))) {
      return false;
    }

    if (
      !Array.isArray(value.taskHistory) ||
      !value.taskHistory.every((entry) => this.isTaskHistoryTuple(entry))
    ) {
      return false;
    }

    if (!Array.isArray(value.records) || !value.records.every((item) => this.isFleetRecord(item))) {
      return false;
    }

    if (
      !Array.isArray(value.approvalHistory) ||
      !value.approvalHistory.every((entry) => this.isApprovalHistoryTuple(entry))
    ) {
      return false;
    }

    if (
      !Array.isArray(value.processedTransitions) ||
      !value.processedTransitions.every((entry) => this.isProcessedTransitionTuple(entry))
    ) {
      return false;
    }

    if (
      !isRecord(value.processedEvents) ||
      !Object.entries(value.processedEvents).every(
        ([eventId, processedAt]) =>
          typeof eventId === "string" &&
          eventId.trim() !== "" &&
          typeof processedAt === "number" &&
          Number.isFinite(processedAt),
      )
    ) {
      return false;
    }

    if (
      !isRecord(value.failedEvents) ||
      !Object.entries(value.failedEvents).every(
        ([eventId, failedEvent]) =>
          typeof eventId === "string" &&
          eventId.trim() !== "" &&
          isRecord(failedEvent) &&
          typeof failedEvent.reason === "string" &&
          failedEvent.reason.trim() !== "" &&
          typeof failedEvent.timestamp === "number" &&
          Number.isFinite(failedEvent.timestamp),
      )
    ) {
      return false;
    }

    if (
      !Array.isArray(value.escalationState) ||
      !value.escalationState.every((entry) => this.isEscalationStateTuple(entry))
    ) {
      return false;
    }

    if (
      !Array.isArray(value.notifications) ||
      !value.notifications.every((entry) => this.isNotification(entry))
    ) {
      return false;
    }

    if (
      !Array.isArray(value.complianceSignals) ||
      !value.complianceSignals.every((entry) => this.isComplianceSignal(entry))
    ) {
      return false;
    }

    return true;
  }

  private tryMigratePersistedState(
    value: unknown,
    path: string,
  ): PersistedStoreState | null {
    if (!isRecord(value)) {
      return null;
    }

    if (value.version === STORE_STATE_VERSION) {
      return value as unknown as PersistedStoreState;
    }

    const baseState = {
      version: STORE_STATE_VERSION,
      ships: (value.ships as Ship[]) ?? [],
      equipment: this.migrateEquipment(value.equipment),
      tasks: this.migrateTasks(value.tasks),
      defects: this.migrateDefects(value.defects, value.tasks),
      taskHistory: this.migrateTaskHistory(value.taskHistory),
      records: Array.isArray(value.records)
        ? value.records
            .filter((item): item is FleetRecord => isRecord(item))
            .map((item) => this.hydrateFleetRecord(item as FleetRecord))
        : [],
      approvalHistory: Array.isArray(value.approvalHistory)
        ? value.approvalHistory
            .filter((entry): entry is [string, ApprovalHistoryEntry[]] =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              typeof entry[0] === "string" &&
              Array.isArray(entry[1]),
            )
            .map(
              ([recordId, history]): [string, ApprovalHistoryEntry[]] => [
                recordId,
                history.map((entry) => this.hydrateApprovalHistoryEntry(entry)),
              ],
            )
        : [],
      processedTransitions:
        (value.processedTransitions as Array<[string, ProcessedApprovalTransition]>) ?? [],
      escalationState: (value.escalationState as Array<[string, EscalationState]>) ?? [],
      notifications: (value.notifications as Notification[]) ?? [],
    };

      if (value.version === 12) {
        return {
          ...baseState,
          processedEvents: (value.processedEvents as Record<string, number>) ?? {},
          failedEvents: (value.failedEvents as Record<string, { reason: string; timestamp: number }>) ?? {},
          complianceSignals: (value.complianceSignals as ComplianceSignal[]) ?? [],
        };
      }

      if (value.version === 9) {
        return {
          ...baseState,
          processedEvents: {},
          failedEvents: {},
          complianceSignals: (value.complianceSignals as ComplianceSignal[]) ?? [],
        };
      }

      if (value.version === 10) {
        return {
          ...baseState,
          processedEvents: (value.processedEvents as Record<string, number>) ?? {},
          failedEvents: {},
          complianceSignals: (value.complianceSignals as ComplianceSignal[]) ?? [],
        };
      }

      if (value.version === 11) {
        return {
          ...baseState,
          processedEvents: (value.processedEvents as Record<string, number>) ?? {},
          failedEvents: {},
          complianceSignals: (value.complianceSignals as ComplianceSignal[]) ?? [],
        };
      }

      if (value.version === 8) {
        return {
          ...baseState,
          processedEvents: {},
          failedEvents: {},
          complianceSignals: [],
        };
      }

    logger.warn("persisted_state_version_mismatch", {
      result: path,
      status: `EXPECTED_${STORE_STATE_VERSION}_RECEIVED_${String(value.version ?? "UNKNOWN")}`,
    });
    logger.warn("persisted_state_migration_unavailable", {
      result: path,
      status: "NO_MIGRATION_PATH_CONFIGURED",
    });
    return null;
  }

  private isTask(value: unknown): value is Task {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.id === "string" &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      isNullableString(value.parentTaskId) &&
      (value.kind === "PMS" || value.kind === "DEFECT") &&
      this.isSystemGroupId(value.systemGroup) &&
      typeof value.title === "string" &&
      typeof value.mic === "string" &&
      typeof value.iss === "string" &&
      value.iss.trim() !== "" &&
      typeof value.equipment === "string" &&
      typeof value.cycleCode === "string" &&
      (value.scheduleSource === "MPP" ||
        value.scheduleSource === "CYCLE" ||
        value.scheduleSource === "QUARTERLY" ||
        value.scheduleSource === "WEEKLY") &&
      typeof value.businessDate === "string" &&
      typeof value.dueDate === "string" &&
      this.isAssignedRoleId(value.assignedRole) &&
      (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
      (value.executionStatus === "PENDING" ||
        value.executionStatus === "COMPLETED" ||
        value.executionStatus === "MISSED") &&
      isNullableString(value.completedAt) &&
      isNullableString(value.verificationBy) &&
      isNullableNumber(value.verificationAt) &&
      isNullableString(value.lastCheckedAt) &&
      isNullableString(value.lastOverdueAt) &&
      isNullableString(value.replannedFromDueDate) &&
      isNullableString(value.replannedToDueDate) &&
      isNullableString(value.lastNotifiedAt) &&
      isOptionalNumber(value.lastCompletedAt) &&
      isOptionalNumber(value.nextDueAt) &&
      isOptionalMaintenanceInterval(value.interval) &&
        isOptionalMaintenanceInterval(value.calendarInterval) &&
        isOptionalMaintenanceInterval(value.usageInterval) &&
        isOptionalUsageTracking(value.usageTracking) &&
      (typeof value.requiresReplan === "undefined" || typeof value.requiresReplan === "boolean") &&
      isOptionalNullableString(value.defectId) &&
      isOptionalNullableString(value.originDirectiveId) &&
      isOptionalNullableString(value.originRecordId) &&
      (typeof value.derivedFromType === "undefined" ||
        value.derivedFromType === null ||
        this.isLineageSourceType(value.derivedFromType)) &&
      isOptionalNullableString(value.derivedFromId) &&
      (typeof value.ettrDays === "number" || value.ettrDays === null) &&
      (value.severity === "ROUTINE" ||
        value.severity === "URGENT" ||
        value.severity === "CRITICAL" ||
        value.severity === null) &&
      (value.escalationLevel === "NONE" ||
        value.escalationLevel === "MCC" ||
        value.escalationLevel === "LOG_COMD") &&
      isNullableString(value.escalatedAt) &&
      isOptionalNullableString(value.sectionVerifiedBy) &&
      isOptionalNullableNumber(value.sectionVerifiedAt) &&
      isOptionalNullableString(value.departmentVerifiedBy) &&
      isOptionalNullableNumber(value.departmentVerifiedAt)
    );
  }

  private isEquipment(value: unknown): value is Equipment {
    return (
      isRecord(value) &&
      typeof value.iss === "string" &&
      value.iss.trim() !== "" &&
      typeof value.name === "string" &&
      value.name.trim() !== "" &&
      typeof value.system === "string" &&
      value.system.trim() !== "" &&
      isOptionalString(value.manufacturer) &&
      isOptionalString(value.serialNumber) &&
      isOptionalString(value.location)
    );
  }

  private isDefect(value: unknown): value is Defect {
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      value.id.trim() !== "" &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      this.isSystemGroupId(value.systemGroup) &&
      typeof value.iss === "string" &&
      value.iss.trim() !== "" &&
      typeof value.equipment === "string" &&
      value.equipment.trim() !== "" &&
      typeof value.description === "string" &&
      value.description.trim() !== "" &&
      (value.classification === "IMMEDIATE" ||
        value.classification === "UNSCHEDULED" ||
        value.classification === "DELAYED") &&
      typeof value.operationalImpact === "string" &&
      typeof value.reportedBy === "string" &&
      (value.status === "OPEN" ||
        value.status === "IN_PROGRESS" ||
        value.status === "RESOLVED") &&
      (typeof value.ettr === "undefined" ||
        (typeof value.ettr === "number" && Number.isFinite(value.ettr))) &&
      (typeof value.repairLevel === "undefined" ||
        value.repairLevel === "OLM" ||
        value.repairLevel === "ILM" ||
        value.repairLevel === "DLM")
    );
  }

  private isFleetRecord(value: unknown): value is FleetRecord {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.id === "string" &&
      typeof value.referenceNumber === "string" &&
      value.referenceNumber.trim() !== "" &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      this.isFleetRecordKind(value.kind) &&
      this.isSystemGroupId(value.systemGroup) &&
      typeof value.title === "string" &&
      value.title.trim() !== "" &&
      (typeof value.description === "string" || value.description === null) &&
      typeof value.businessDate === "string" &&
      typeof value.createdAt === "string" &&
      this.isAssignedRoleId(value.originRole) &&
      this.isRecordAuthorityMode(value.authorityMode) &&
      this.isRecordSourceKind(value.sourceKind) &&
      this.isRecordDigitizationStage(value.digitizationStage) &&
      isOptionalNullableString(value.originDirectiveId) &&
      isOptionalNullableString(value.originRecordId) &&
      (typeof value.derivedFromType === "undefined" ||
        value.derivedFromType === null ||
        this.isLineageSourceType(value.derivedFromType)) &&
      isOptionalNullableString(value.derivedFromId) &&
      Array.isArray(value.visibleTo) &&
      value.visibleTo.length >= 1 &&
      value.visibleTo.every((role) => this.isAssignedRoleId(role)) &&
      this.isApprovalFlow(value.approval)
    );
  }

  private isShip(value: unknown): value is Ship {
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      value.id.trim() !== "" &&
      typeof value.name === "string" &&
      value.name.trim() !== "" &&
      typeof value.classType === "string" &&
      value.classType.trim() !== ""
    );
  }

  private isTaskHistoryTuple(value: unknown): value is [string, TaskHistoryEntry[]] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      Array.isArray(value[1]) &&
      value[1].every((entry) => this.isTaskHistoryEntry(entry))
    );
  }

  private isTaskHistoryEntry(value: unknown): value is TaskHistoryEntry {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.taskId === "string" &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      typeof value.timestamp === "string" &&
      this.isTaskHistoryType(value.actionType) &&
      this.isTaskStateSnapshot(value.previousState) &&
      this.isTaskStateSnapshot(value.newState) &&
      (value.actor === "SYSTEM" || this.isRoleId(value.actor))
    );
  }

  private isApprovalHistoryTuple(value: unknown): value is [string, ApprovalHistoryEntry[]] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      Array.isArray(value[1]) &&
      value[1].every((entry) => this.isApprovalHistoryEntry(entry))
    );
  }

  private isApprovalHistoryEntry(value: unknown): value is ApprovalHistoryEntry {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.recordId === "string" &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      typeof value.timestamp === "string" &&
      this.isApprovalHistoryType(value.actionType) &&
      this.isApprovalRecordSnapshot(value.previousState) &&
      this.isApprovalRecordSnapshot(value.newState) &&
      (value.actor === "SYSTEM" || this.isRoleId(value.actor)) &&
      (typeof value.transitionId === "string" || value.transitionId === null) &&
      (typeof value.reason === "string" || value.reason === null) &&
      (typeof value.note === "string" || value.note === null)
    );
  }

  private isTaskStateSnapshot(value: unknown): value is TaskStateSnapshot {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      isNullableString(value.parentTaskId) &&
      (value.kind === "PMS" || value.kind === "DEFECT") &&
      this.isSystemGroupId(value.systemGroup) &&
      typeof value.mic === "string" &&
      typeof value.iss === "string" &&
      value.iss.trim() !== "" &&
      typeof value.equipment === "string" &&
      typeof value.cycleCode === "string" &&
      (value.scheduleSource === "MPP" ||
        value.scheduleSource === "CYCLE" ||
        value.scheduleSource === "QUARTERLY" ||
        value.scheduleSource === "WEEKLY") &&
      (value.assignedRole === "COMMANDING_OFFICER" ||
        value.assignedRole === "MARINE_ENGINEERING_OFFICER" ||
        value.assignedRole === "WEAPON_ELECTRICAL_OFFICER" ||
        value.assignedRole === "FLEET_SUPPORT_GROUP" ||
        value.assignedRole === "LOGISTICS_COMMAND") &&
      (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
      (value.executionStatus === "PENDING" ||
        value.executionStatus === "COMPLETED" ||
        value.executionStatus === "MISSED") &&
      isNullableString(value.completedAt) &&
      isNullableString(value.verificationBy) &&
      isNullableNumber(value.verificationAt) &&
      isNullableString(value.lastCheckedAt) &&
      isNullableString(value.lastOverdueAt) &&
      isNullableString(value.replannedFromDueDate) &&
      isNullableString(value.replannedToDueDate) &&
      (value.escalationLevel === "NONE" ||
        value.escalationLevel === "MCC" ||
        value.escalationLevel === "LOG_COMD") &&
      typeof value.dueDate === "string" &&
      isNullableString(value.lastNotifiedAt) &&
      isOptionalNumber(value.lastCompletedAt) &&
      isOptionalNumber(value.nextDueAt) &&
      isOptionalMaintenanceInterval(value.interval) &&
      isOptionalMaintenanceInterval(value.calendarInterval) &&
      isOptionalMaintenanceInterval(value.usageInterval) &&
      isOptionalUsageTracking(value.usageTracking) &&
      (typeof value.requiresReplan === "undefined" || typeof value.requiresReplan === "boolean") &&
      isOptionalNullableString(value.defectId) &&
      isOptionalNullableString(value.originDirectiveId) &&
      isOptionalNullableString(value.originRecordId) &&
      (typeof value.derivedFromType === "undefined" ||
        value.derivedFromType === null ||
        this.isLineageSourceType(value.derivedFromType)) &&
      isOptionalNullableString(value.derivedFromId) &&
      (typeof value.ettrDays === "number" || value.ettrDays === null) &&
      (value.severity === "ROUTINE" ||
        value.severity === "URGENT" ||
        value.severity === "CRITICAL" ||
        value.severity === null) &&
      isNullableString(value.escalatedAt) &&
      isOptionalNullableString(value.sectionVerifiedBy) &&
      isOptionalNullableNumber(value.sectionVerifiedAt) &&
      isOptionalNullableString(value.departmentVerifiedBy) &&
      isOptionalNullableNumber(value.departmentVerifiedAt)
    );
  }

  private isApprovalRecordSnapshot(value: unknown): value is ApprovalRecordSnapshot {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      typeof value.referenceNumber === "string" &&
      value.referenceNumber.trim() !== "" &&
      this.isFleetRecordKind(value.kind) &&
      this.isSystemGroupId(value.systemGroup) &&
      typeof value.title === "string" &&
      typeof value.businessDate === "string" &&
      this.isAssignedRoleId(value.originRole) &&
      this.isRecordAuthorityMode(value.authorityMode) &&
      this.isRecordSourceKind(value.sourceKind) &&
      this.isRecordDigitizationStage(value.digitizationStage) &&
      isOptionalNullableString(value.originDirectiveId) &&
      isOptionalNullableString(value.originRecordId) &&
      (typeof value.derivedFromType === "undefined" ||
        value.derivedFromType === null ||
        this.isLineageSourceType(value.derivedFromType)) &&
      isOptionalNullableString(value.derivedFromId) &&
      Array.isArray(value.chain) &&
      value.chain.length >= 2 &&
      value.chain.every((role) => this.isAssignedRoleId(role)) &&
      typeof value.currentStepIndex === "number" &&
      typeof value.approvalLevel === "number" &&
      this.isAssignedRoleId(value.currentOwner) &&
      this.isApprovalStatus(value.status) &&
      isNullableString(value.submittedAt) &&
      isNullableString(value.approvedAt) &&
      isNullableString(value.rejectedAt) &&
      (value.lastActionBy === null || value.lastActionBy === "SYSTEM" || this.isRoleId(value.lastActionBy)) &&
      isNullableString(value.lastActionAt) &&
      isNullableString(value.lastActionReason) &&
      isNullableString(value.lastActionNote) &&
      isNullableString(value.lastStaleNotificationAt) &&
      typeof value.version === "number"
    );
  }

  private isEscalationStateTuple(value: unknown): value is [string, EscalationState] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      this.isEscalationState(value[1])
    );
  }

  private isEscalationState(value: unknown): value is EscalationState {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      typeof value.businessDate === "string" &&
      (value.status === "NOT_ESCALATED" || value.status === "ESCALATED_TO_CO") &&
      (value.reason === "MISSING_DAILY_LOGS" || value.reason === null) &&
      Array.isArray(value.missingLogsAtEscalation) &&
      value.missingLogsAtEscalation.every(
        (item) =>
          item === "ENGINE_ROOM_REGISTER" || item === "EQUIPMENT_OPERATION_RECORD",
      ) &&
      isNullableString(value.escalatedAt) &&
      (value.targetRole === null || this.isRoleId(value.targetRole))
    );
  }

  private isNotification(value: unknown): value is Notification {
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.type === "string" &&
      value.type.trim() !== "" &&
      (typeof value.dedupeKey === "undefined" ||
        (typeof value.dedupeKey === "string" && value.dedupeKey.trim() !== "")) &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      isNullableString(value.taskId) &&
      (typeof value.recordId === "undefined" || isNullableString(value.recordId)) &&
      typeof value.message === "string" &&
      this.isRoleId(value.targetRole) &&
      typeof value.timestamp === "string" &&
      typeof value.read === "boolean"
    );
  }

  private isComplianceSignal(value: unknown): value is ComplianceSignal {
    return (
      isRecord(value) &&
      typeof value.type === "string" &&
      value.type.trim() !== "" &&
      (value.severity === "INFO" ||
        value.severity === "WARNING" ||
        value.severity === "CRITICAL") &&
      typeof value.message === "string" &&
      value.message.trim() !== "" &&
      (typeof value.shipId === "undefined" ||
        (typeof value.shipId === "string" && value.shipId.trim() !== "")) &&
      (typeof value.taskId === "undefined" ||
        (typeof value.taskId === "string" && value.taskId.trim() !== "")) &&
      (typeof value.defectId === "undefined" ||
        (typeof value.defectId === "string" && value.defectId.trim() !== ""))
    );
  }

  private isProcessedTransitionTuple(value: unknown): value is [string, ProcessedApprovalTransition] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      this.isProcessedApprovalTransition(value[1])
    );
  }

  private isProcessedApprovalTransition(value: unknown): value is ProcessedApprovalTransition {
    return (
      isRecord(value) &&
      typeof value.recordId === "string" &&
      this.isApprovalHistoryType(value.actionType)
    );
  }

  private buildNotificationDedupeKey(
    input: Omit<Notification, "id" | "read">,
  ): string {
    return [
      input.shipId,
      input.type,
      input.taskId ?? "NO_TASK",
      input.recordId ?? "NO_RECORD",
      input.targetRole,
    ].join("|");
  }

  private isRoleId(value: unknown): value is RoleId {
    return (
      value === "COMMANDING_OFFICER" ||
      value === "MARINE_ENGINEERING_OFFICER" ||
      value === "WEAPON_ELECTRICAL_OFFICER" ||
      value === "FLEET_SUPPORT_GROUP" ||
      value === "LOGISTICS_COMMAND" ||
      value === "SYSTEM"
    );
  }

  private isAssignedRoleId(value: unknown): value is AssignedRoleId {
    return (
      value === "COMMANDING_OFFICER" ||
      value === "MARINE_ENGINEERING_OFFICER" ||
      value === "WEAPON_ELECTRICAL_OFFICER" ||
      value === "FLEET_SUPPORT_GROUP" ||
      value === "LOGISTICS_COMMAND"
    );
  }

  private isApprovalStatus(value: unknown): value is ApprovalStatus {
    return (
      value === "DRAFT" ||
      value === "SUBMITTED" ||
      value === "APPROVED" ||
      value === "REJECTED"
    );
  }

  private isFleetRecordKind(value: unknown): value is FleetRecordKind {
    return (
      value === "MAINTENANCE_LOG" ||
      value === "DEFECT" ||
      value === "WORK_REQUEST"
    );
  }

  private isSystemGroupId(value: unknown): value is Task["systemGroup"] {
    return (
      value === "PROPULSION" ||
      value === "AUXILIARIES" ||
      value === "ELECTRICAL_POWER" ||
      value === "WEAPONS" ||
      value === "SENSORS_AND_NAVIGATION" ||
      value === "COMMUNICATIONS" ||
      value === "HULL_AND_SEAKEEPING" ||
      value === "DAMAGE_CONTROL_AND_SAFETY" ||
      value === "SUPPLY_AND_SUPPORT" ||
      value === "GENERAL_ENGINEERING"
    );
  }

  private isRecordAuthorityMode(value: unknown): value is FleetRecord["authorityMode"] {
    return value === "PAPER_AUTHORITATIVE" || value === "DIGITAL_AUTHORITATIVE";
  }

  private isRecordSourceKind(value: unknown): value is FleetRecord["sourceKind"] {
    return value === "SCANNED_PAPER" || value === "DIGITAL_ENTRY" || value === "IMPORTED_DOCUMENT";
  }

  private isRecordDigitizationStage(value: unknown): value is FleetRecord["digitizationStage"] {
    return value === "INDEXED" || value === "PARTIALLY_STRUCTURED" || value === "FULLY_STRUCTURED";
  }

  private isLineageSourceType(value: unknown): value is NonNullable<Task["derivedFromType"]> {
    return value === "DIRECTIVE" || value === "RECORD" || value === "TASK" || value === "DEFECT";
  }

  private isTaskHistoryType(value: unknown): value is TaskHistoryType {
    return (
      value === "CREATED" ||
      value === "CHECKED" ||
      value === "STATUS_CHANGED" ||
      value === "REPLANNED" ||
      value === "NOTIFIED" ||
      value === "COMPLETED" ||
      value === "ESCALATED"
    );
  }

  private isApprovalHistoryType(value: unknown): value is ApprovalHistoryType {
    return (
      value === "CREATED" ||
      value === "SUBMITTED" ||
      value === "APPROVED" ||
      value === "REJECTED" ||
      value === "INVALID_ATTEMPT" ||
      value === "STALE_REMINDER_SENT"
    );
  }

  private isApprovalFlow(value: unknown): value is FleetRecord["approval"] {
    if (!isRecord(value)) {
      return false;
    }

    return (
      Array.isArray(value.chain) &&
      value.chain.length >= 2 &&
      value.chain.every((role) => this.isAssignedRoleId(role)) &&
      typeof value.currentStepIndex === "number" &&
      typeof value.approvalLevel === "number" &&
      this.isAssignedRoleId(value.currentOwner) &&
      this.isApprovalStatus(value.status) &&
      isNullableString(value.submittedAt) &&
      isNullableString(value.approvedAt) &&
      isNullableString(value.rejectedAt) &&
      (value.lastActionBy === null || value.lastActionBy === "SYSTEM" || this.isRoleId(value.lastActionBy)) &&
      isNullableString(value.lastActionAt) &&
      isNullableString(value.lastActionReason) &&
      isNullableString(value.lastActionNote) &&
      isNullableString(value.lastStaleNotificationAt) &&
      typeof value.version === "number"
    );
  }

  private assertValidFleetRecord(record: FleetRecord): void {
    if (!this.isFleetRecord(record)) {
      throw new Error("Invalid approval record");
    }

    if (record.approval.chain[0] !== record.originRole) {
      throw new Error("Approval chain must begin with the origin role");
    }

    if (!record.visibleTo.includes(record.originRole)) {
      throw new Error("Approval visibleTo must include the origin role");
    }

    if (!record.visibleTo.includes(record.approval.currentOwner)) {
      throw new Error("Approval visibleTo must include the current owner");
    }

    if (record.approval.currentStepIndex < 0 || record.approval.currentStepIndex >= record.approval.chain.length) {
      throw new Error("Approval currentStepIndex is out of bounds");
    }

    if (record.approval.approvalLevel !== record.approval.currentStepIndex) {
      throw new Error("Approval level must match the current step index");
    }

    if (record.approval.chain[record.approval.currentStepIndex] !== record.approval.currentOwner) {
      throw new Error("Approval currentOwner must match the current chain step");
    }
  }

  private getFleetRecordKindCode(kind: FleetRecordKind): string {
    switch (kind) {
      case "MAINTENANCE_LOG":
        return "ML";
      case "DEFECT":
        return "DR";
      case "WORK_REQUEST":
        return "WR";
      default: {
        const exhaustiveCheck: never = kind;
        return exhaustiveCheck;
      }
    }
  }

  private getApprovalChainRole(chain: AssignedRoleId[], index: number): AssignedRoleId {
    const role = chain[index];
    if (!role) {
      throw new Error(`Approval chain role missing at index ${index}`);
    }
    return role;
  }

  private getPreviousApprovalOwner(recordId: string, current: FleetRecord): AssignedRoleId {
    const history = this.approvalHistoryById.get(recordId) ?? [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const entry = history[index];
      if (!entry) {
        continue;
      }
      if (
        (entry.actionType === "SUBMITTED" || entry.actionType === "APPROVED") &&
        entry.newState.currentOwner === current.approval.currentOwner &&
        entry.previousState.currentOwner !== entry.newState.currentOwner
      ) {
        return entry.previousState.currentOwner;
      }
    }

    throw new Error("Approval rejection could not determine a previous owner from history");
  }

  private assertValidComplianceSignal(signal: ComplianceSignal): void {
    if (!this.isComplianceSignal(signal)) {
      throw new Error("Invalid compliance signal");
    }

    if (signal.shipId) {
      this.assertValidShipId(signal.shipId);
    }
  }

  private buildComplianceSignalKey(signal: ComplianceSignal): string {
    return [
      signal.type,
      signal.shipId ?? "NO_SHIP",
      signal.taskId ?? "NO_TASK",
      signal.defectId ?? "NO_DEFECT",
    ].join("::");
  }

  private compareComplianceSignals(
    left: ComplianceSignal,
    right: ComplianceSignal,
  ): number {
    return (
      this.compareOptionalString(left.shipId, right.shipId) ||
      this.compareComplianceSeverity(left.severity, right.severity) ||
      left.type.localeCompare(right.type) ||
      this.compareOptionalString(left.taskId, right.taskId) ||
      this.compareOptionalString(left.defectId, right.defectId) ||
      left.message.localeCompare(right.message)
    );
  }

  private compareComplianceSeverity(
    left: ComplianceSignal["severity"],
    right: ComplianceSignal["severity"],
  ): number {
    return this.getComplianceSeverityRank(right) - this.getComplianceSeverityRank(left);
  }

  private getComplianceSeverityRank(
    severity: ComplianceSignal["severity"],
  ): number {
    switch (severity) {
      case "CRITICAL":
        return 3;
      case "WARNING":
        return 2;
      case "INFO":
        return 1;
      default:
        return 0;
    }
  }

  private compareOptionalString(left?: string, right?: string): number {
    return (left ?? "").localeCompare(right ?? "");
  }

  private getEventIntegrityState(): EventIntegrityState {
    return {
      processedEvents: Object.fromEntries(this.processedEventsById.entries()),
    };
  }

  private replaceProcessedEvents(processedEvents: Record<string, number>): void {
    this.processedEventsById.clear();
    for (const [eventId, processedAt] of Object.entries(processedEvents)) {
      this.processedEventsById.set(eventId, processedAt);
    }
  }

  private resetPersistedState(): void {
    this.shipsById.clear();
    this.equipmentByIss.clear();
    this.tasksById.clear();
    this.defectsById.clear();
    this.taskHistoryById.clear();
    this.recordsById.clear();
    this.approvalHistoryById.clear();
    this.processedTransitions.clear();
    this.processedEventsById.clear();
    this.failedEventsById.clear();
    this.escalationByDate.clear();
    this.notificationsById.clear();
    this.complianceSignalsByKey.clear();
  }

  private persistState(): void {
    const payload: PersistedStoreState = {
      version: STORE_STATE_VERSION,
      ships: [...this.shipsById.values()],
      equipment: [...this.equipmentByIss.values()],
      tasks: [...this.tasksById.values()],
      defects: [...this.defectsById.values()],
      taskHistory: [...this.taskHistoryById.entries()],
      records: [...this.recordsById.values()],
      approvalHistory: [...this.approvalHistoryById.entries()],
      processedTransitions: [...this.processedTransitions.entries()],
        processedEvents: Object.fromEntries(
          [...this.processedEventsById.entries()].sort(([leftId], [rightId]) =>
            leftId.localeCompare(rightId),
          ),
        ),
        failedEvents: Object.fromEntries(
          [...this.failedEventsById.entries()].sort(([leftId], [rightId]) =>
            leftId.localeCompare(rightId),
          ),
        ),
        escalationState: [...this.escalationByDate.entries()],
      notifications: [...this.notificationsById.values()],
      complianceSignals: this.getAllComplianceSignals(),
    };

    const serialized = JSON.stringify(payload, null, 2);
    mkdirSync(dirname(this.persistenceFilePath), { recursive: true });

    try {
      writeFileSync(this.tempFilePath, serialized, "utf8");

      if (existsSync(this.backupFilePath)) {
        rmSync(this.backupFilePath);
      }

      if (existsSync(this.persistenceFilePath)) {
        renameSync(this.persistenceFilePath, this.backupFilePath);
      }

      renameSync(this.tempFilePath, this.persistenceFilePath);
      this.lastPersistenceTimestamp = new Date().toISOString();
    } catch (error) {
      if (existsSync(this.tempFilePath)) {
        rmSync(this.tempFilePath);
      }
      logger.error("persistence_write_failed", error, {
        result: this.persistenceFilePath,
        status: "WRITE_FAILED",
      });
      throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return typeof value === "undefined" || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return (typeof value === "number" && Number.isFinite(value)) || value === null;
}

function isOptionalNullableNumber(value: unknown): value is number | null | undefined {
  return typeof value === "undefined" || isNullableNumber(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return typeof value === "undefined" || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return typeof value === "undefined" || typeof value === "string" || value === null;
}

function isOptionalMaintenanceInterval(
  value: unknown,
): value is Task["interval"] {
  return (
    typeof value === "undefined" ||
    (isRecord(value) &&
      (value.type === "CALENDAR" || value.type === "USAGE") &&
      typeof value.value === "number" &&
      Number.isFinite(value.value) &&
      value.value > 0 &&
      (value.unit === "DAYS" || value.unit === "HOURS"))
  );
}

function isOptionalUsageTracking(value: unknown): value is Task["usageTracking"] {
  return (
    typeof value === "undefined" ||
    (isRecord(value) &&
      isOptionalNumber(value.hoursRun) &&
      isOptionalNumber(value.shotsFired))
  );
}
