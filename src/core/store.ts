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
import { config } from "./config";
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

const STORE_STATE_VERSION = 8;
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

interface PersistedStoreState {
  version: number;
  ships: Ship[];
  tasks: Task[];
  taskHistory: Array<[string, TaskHistoryEntry[]]>;
  records: FleetRecord[];
  approvalHistory: Array<[string, ApprovalHistoryEntry[]]>;
  processedTransitions: Array<[string, ProcessedApprovalTransition]>;
  escalationState: Array<[string, EscalationState]>;
  notifications: Notification[];
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

  private readonly logsByDate = new Map<string, LogRecord[]>();

  private readonly complianceByDate = new Map<string, DailyComplianceState>();

  private readonly escalationByDate = new Map<string, EscalationState>();

  private readonly tasksById = new Map<string, Task>();

  private readonly taskHistoryById = new Map<string, TaskHistoryEntry[]>();

  private readonly recordsById = new Map<string, FleetRecord>();

  private readonly approvalHistoryById = new Map<string, ApprovalHistoryEntry[]>();

  private readonly processedTransitions = new Map<string, ProcessedApprovalTransition>();

  private readonly notificationsById = new Map<string, Notification>();

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
    return this.applyTaskUpdate(
      taskId,
      {
        status: "COMPLETED",
        completedAt: occurredAt,
        lastCheckedAt: occurredAt,
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
      shipId: record.shipId,
      shipName: ship.name,
      shipClass: ship.classType,
      kind: record.kind,
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
      assignedRole: task.assignedRole,
      status: task.status,
      completedAt: task.completedAt,
      lastCheckedAt: task.lastCheckedAt,
      lastOverdueAt: task.lastOverdueAt,
      replannedFromDueDate: task.replannedFromDueDate,
      replannedToDueDate: task.replannedToDueDate,
      escalationLevel: task.escalationLevel,
      dueDate: task.dueDate,
      lastNotifiedAt: task.lastNotifiedAt,
      ettrDays: task.ettrDays,
      severity: task.severity,
      escalatedAt: task.escalatedAt,
    };
  }

  private createApprovalSnapshot(record: FleetRecord): ApprovalRecordSnapshot {
    return {
      shipId: record.shipId,
      kind: record.kind,
      title: record.title,
      businessDate: record.businessDate,
      originRole: record.originRole,
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
      left.assignedRole === right.assignedRole &&
      left.status === right.status &&
      left.completedAt === right.completedAt &&
      left.lastCheckedAt === right.lastCheckedAt &&
      left.lastOverdueAt === right.lastOverdueAt &&
      left.replannedFromDueDate === right.replannedFromDueDate &&
      left.replannedToDueDate === right.replannedToDueDate &&
      left.escalationLevel === right.escalationLevel &&
      left.dueDate === right.dueDate &&
      left.lastNotifiedAt === right.lastNotifiedAt &&
      left.ettrDays === right.ettrDays &&
      left.severity === right.severity &&
      left.escalatedAt === right.escalatedAt
    );
  }

  private isSameApprovalState(
    left: ApprovalRecordSnapshot,
    right: ApprovalRecordSnapshot,
  ): boolean {
    return (
      left.shipId === right.shipId &&
      left.kind === right.kind &&
      left.title === right.title &&
      left.businessDate === right.businessDate &&
      left.originRole === right.originRole &&
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

    for (const task of persisted.tasks) {
      this.tasksById.set(task.id, task);
    }

    this.taskHistoryById.clear();
    for (const [taskId, history] of persisted.taskHistory) {
      this.taskHistoryById.set(taskId, history);
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

    this.escalationByDate.clear();
    for (const [businessDate, escalationState] of persisted.escalationState) {
      this.escalationByDate.set(businessDate, escalationState);
    }

    this.notificationsById.clear();
    for (const notification of persisted.notifications) {
      this.notificationsById.set(notification.id, notification);
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
      typeof value.title === "string" &&
      typeof value.businessDate === "string" &&
      typeof value.dueDate === "string" &&
      this.isAssignedRoleId(value.assignedRole) &&
      (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
      isNullableString(value.completedAt) &&
      isNullableString(value.lastCheckedAt) &&
      isNullableString(value.lastOverdueAt) &&
      isNullableString(value.replannedFromDueDate) &&
      isNullableString(value.replannedToDueDate) &&
      isNullableString(value.lastNotifiedAt) &&
      (typeof value.ettrDays === "number" || value.ettrDays === null) &&
      (value.severity === "ROUTINE" ||
        value.severity === "URGENT" ||
        value.severity === "CRITICAL" ||
        value.severity === null) &&
      (value.escalationLevel === "NONE" ||
        value.escalationLevel === "MCC" ||
        value.escalationLevel === "LOG_COMD") &&
      isNullableString(value.escalatedAt)
    );
  }

  private isFleetRecord(value: unknown): value is FleetRecord {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.id === "string" &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      this.isFleetRecordKind(value.kind) &&
      typeof value.title === "string" &&
      value.title.trim() !== "" &&
      (typeof value.description === "string" || value.description === null) &&
      typeof value.businessDate === "string" &&
      typeof value.createdAt === "string" &&
      this.isAssignedRoleId(value.originRole) &&
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
      (value.assignedRole === "COMMANDING_OFFICER" ||
        value.assignedRole === "MARINE_ENGINEERING_OFFICER" ||
        value.assignedRole === "WEAPON_ELECTRICAL_OFFICER" ||
        value.assignedRole === "FLEET_SUPPORT_GROUP" ||
        value.assignedRole === "LOGISTICS_COMMAND") &&
      (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
      isNullableString(value.completedAt) &&
      isNullableString(value.lastCheckedAt) &&
      isNullableString(value.lastOverdueAt) &&
      isNullableString(value.replannedFromDueDate) &&
      isNullableString(value.replannedToDueDate) &&
      (value.escalationLevel === "NONE" ||
        value.escalationLevel === "MCC" ||
        value.escalationLevel === "LOG_COMD") &&
      typeof value.dueDate === "string" &&
      isNullableString(value.lastNotifiedAt) &&
      (typeof value.ettrDays === "number" || value.ettrDays === null) &&
      (value.severity === "ROUTINE" ||
        value.severity === "URGENT" ||
        value.severity === "CRITICAL" ||
        value.severity === null) &&
      isNullableString(value.escalatedAt)
    );
  }

  private isApprovalRecordSnapshot(value: unknown): value is ApprovalRecordSnapshot {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      this.isFleetRecordKind(value.kind) &&
      typeof value.title === "string" &&
      typeof value.businessDate === "string" &&
      this.isAssignedRoleId(value.originRole) &&
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

  private resetPersistedState(): void {
    this.shipsById.clear();
    this.tasksById.clear();
    this.taskHistoryById.clear();
    this.recordsById.clear();
    this.approvalHistoryById.clear();
    this.processedTransitions.clear();
    this.escalationByDate.clear();
    this.notificationsById.clear();
  }

  private persistState(): void {
    const payload: PersistedStoreState = {
      version: STORE_STATE_VERSION,
      ships: [...this.shipsById.values()],
      tasks: [...this.tasksById.values()],
      taskHistory: [...this.taskHistoryById.entries()],
      records: [...this.recordsById.values()],
      approvalHistory: [...this.approvalHistoryById.entries()],
      processedTransitions: [...this.processedTransitions.entries()],
      escalationState: [...this.escalationByDate.entries()],
      notifications: [...this.notificationsById.values()],
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
