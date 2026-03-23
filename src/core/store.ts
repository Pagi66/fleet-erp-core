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
import { logger } from "./logger";
import {
  DailyComplianceState,
  EscalationState,
  LogRecord,
  LogType,
  REQUIRED_DAILY_LOGS,
  RoleId,
  StoreSnapshot,
  Task,
  TaskHistoryEntry,
  TaskHistoryType,
  TaskSnapshot,
  TaskStateSnapshot,
} from "./types";

const STORE_STATE_VERSION = 1;

interface PersistedStoreState {
  version: number;
  tasks: Task[];
  taskHistory: Array<[string, TaskHistoryEntry[]]>;
  escalationState: Array<[string, EscalationState]>;
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
  lastPersistenceTimestamp: string | null;
}

export class InMemoryStore {
  private readonly logsByDate = new Map<string, LogRecord[]>();

  private readonly complianceByDate = new Map<string, DailyComplianceState>();

  private readonly escalationByDate = new Map<string, EscalationState>();

  private readonly tasksById = new Map<string, Task>();

  private readonly taskHistoryById = new Map<string, TaskHistoryEntry[]>();

  private readonly persistenceFilePath: string;

  private readonly backupFilePath: string;

  private readonly tempFilePath: string;

  private lastPersistenceTimestamp: string | null = null;

  constructor(persistenceFilePath = resolve(process.cwd(), "data", "store-state.json")) {
    this.persistenceFilePath = persistenceFilePath;
    this.backupFilePath = `${persistenceFilePath}.bak`;
    this.tempFilePath = `${persistenceFilePath}.tmp`;
    this.loadPersistedState();
  }

  saveLog(record: LogRecord): void {
    const existing = this.logsByDate.get(record.businessDate) ?? [];
    const withoutSameType = existing.filter(
      (entry) => entry.logType !== record.logType,
    );
    withoutSameType.push(record);
    this.logsByDate.set(record.businessDate, withoutSameType);
    logger.stateChange({
      eventType: "LOG_RECORDED",
      status: "UPDATED",
    });
  }

  getLogsForDate(businessDate: string): LogRecord[] {
    return [...(this.logsByDate.get(businessDate) ?? [])];
  }

  getOrCreateComplianceState(businessDate: string): DailyComplianceState {
    const existing = this.complianceByDate.get(businessDate);
    if (existing) {
      return existing;
    }

    const initialState: DailyComplianceState = {
      businessDate,
      requiredLogs: [...REQUIRED_DAILY_LOGS],
      presentLogs: [],
      missingLogs: [...REQUIRED_DAILY_LOGS],
      status: "PENDING",
      lastEvaluatedAt: null,
      meoNotifiedAt: null,
    };

    this.complianceByDate.set(businessDate, initialState);
    return initialState;
  }

  updateComplianceState(
    businessDate: string,
    update: Partial<DailyComplianceState>,
  ): DailyComplianceState {
    const current = this.getOrCreateComplianceState(businessDate);
    const next: DailyComplianceState = {
      ...current,
      ...update,
    };
    this.complianceByDate.set(businessDate, next);
    logger.stateChange({
      eventType: "COMPLIANCE_STATE_UPDATED",
      status: next.status,
    });
    return next;
  }

  getOrCreateEscalationState(businessDate: string): EscalationState {
    const existing = this.escalationByDate.get(businessDate);
    if (existing) {
      return existing;
    }

    const initialState: EscalationState = {
      businessDate,
      status: "NOT_ESCALATED",
      reason: null,
      missingLogsAtEscalation: [],
      escalatedAt: null,
      targetRole: null,
    };

    this.escalationByDate.set(businessDate, initialState);
    return initialState;
  }

  updateEscalationState(
    businessDate: string,
    update: Partial<EscalationState>,
  ): EscalationState {
    const current = this.getOrCreateEscalationState(businessDate);
    const next: EscalationState = {
      ...current,
      ...update,
    };
    this.escalationByDate.set(businessDate, next);
    logger.stateChange({
      eventType: "ESCALATION_STATE_UPDATED",
      status: next.status,
    });
    this.persistState();
    return next;
  }

  getSnapshot(businessDate: string): StoreSnapshot {
    return {
      logs: this.getLogsForDate(businessDate),
      complianceState: this.getOrCreateComplianceState(businessDate),
      escalationState: this.getOrCreateEscalationState(businessDate),
    };
  }

  createTask(task: Task, actor: RoleId | "SYSTEM" = "SYSTEM"): Task {
    const existing = this.getTask(task.id);
    if (existing) {
      return existing;
    }

    this.tasksById.set(task.id, task);
    const state = this.createStateSnapshot(task);
    this.appendTaskHistory(
      task.id,
      "CREATED",
      state,
      state,
      task.businessDate,
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

  completeTask(taskId: string, occurredAt: string): Task {
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
    );
  }

  recordTaskCheck(taskId: string, occurredAt: string): Task {
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
    );
  }

  markTaskOverdue(taskId: string, occurredAt: string): Task {
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
    );
  }

  escalateTask(
    taskId: string,
    escalationLevel: "MCC" | "LOG_COMD",
    occurredAt: string,
  ): Task {
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
    );
  }

  replanTask(taskId: string, nextDueDate: string, occurredAt: string): Task {
    const current = this.requireTask(taskId);
    if (current.dueDate === nextDueDate) {
      return current;
    }

    return this.applyTaskUpdate(
      taskId,
      {
        dueDate: nextDueDate,
        replannedFromDueDate: current.dueDate,
        replannedToDueDate: nextDueDate,
      },
      "REPLANNED",
      occurredAt,
    );
  }

  recordTaskNotification(taskId: string, occurredAt: string): Task {
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
    );
  }

  getTaskSnapshot(taskId: string): TaskSnapshot {
    return {
      task: this.getTask(taskId),
      history: [...(this.taskHistoryById.get(taskId) ?? [])],
    };
  }

  getAllTasks(): Task[] {
    return [...this.tasksById.values()];
  }

  getOverdueTasks(): Task[] {
    return this.getAllTasks().filter((task) => task.status === "OVERDUE");
  }

  flush(): void {
    this.persistState();
  }

  getHealthCheck(): StoreHealthCheck {
    const tasks = [...this.tasksById.values()];
    return {
      running: true,
      totalTasks: tasks.length,
      overdueTasks: tasks.filter((task) => task.status === "OVERDUE").length,
      escalationCounts: {
        none: tasks.filter((task) => task.escalationLevel === "NONE").length,
        mcc: tasks.filter((task) => task.escalationLevel === "MCC").length,
        logComd: tasks.filter((task) => task.escalationLevel === "LOG_COMD").length,
      },
      lastPersistenceTimestamp: this.lastPersistenceTimestamp,
    };
  }

  seedDailyLogs(
    businessDate: string,
    logTypes: LogType[],
    submittedByRole: "MEO" = "MEO",
  ): void {
    const submittedAt = new Date().toISOString();
    for (const logType of logTypes) {
      this.saveLog({
        businessDate,
        logType,
        submittedAt,
        submittedByRole,
      });
    }
  }

  private requireTask(taskId: string): Task {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private appendTaskHistory(
    taskId: string,
    actionType: TaskHistoryType,
    previousState: TaskStateSnapshot,
    newState: TaskStateSnapshot,
    timestamp: string,
    actor: RoleId | "SYSTEM",
  ): void {
    const current = this.taskHistoryById.get(taskId) ?? [];
    current.push({
      taskId,
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

  private applyTaskUpdate(
    taskId: string,
    update: Partial<Task>,
    actionType: TaskHistoryType,
    occurredAt: string,
    actor: RoleId | "SYSTEM" = "SYSTEM",
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
      status: task.status,
      escalationLevel: task.escalationLevel,
      dueDate: task.dueDate,
      lastNotifiedAt: task.lastNotifiedAt,
    };
  }

  private isSameState(
    left: TaskStateSnapshot,
    right: TaskStateSnapshot,
  ): boolean {
    return (
      left.status === right.status &&
      left.escalationLevel === right.escalationLevel &&
      left.dueDate === right.dueDate &&
      left.lastNotifiedAt === right.lastNotifiedAt
    );
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
    for (const task of persisted.tasks) {
      this.tasksById.set(task.id, task);
    }

    this.taskHistoryById.clear();
    for (const [taskId, history] of persisted.taskHistory) {
      this.taskHistoryById.set(taskId, history);
    }

    this.escalationByDate.clear();
    for (const [businessDate, escalationState] of persisted.escalationState) {
      this.escalationByDate.set(businessDate, escalationState);
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
      if (!this.validatePersistedState(parsed)) {
        logger.warn("persisted_state_invalid", { result: path, status: "INVALID" });
        return null;
      }
      return { state: parsed, path };
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

    if (
      !Array.isArray(value.taskHistory) ||
      !value.taskHistory.every((entry) => this.isTaskHistoryTuple(entry))
    ) {
      return false;
    }

    if (
      !Array.isArray(value.escalationState) ||
      !value.escalationState.every((entry) => this.isEscalationStateTuple(entry))
    ) {
      return false;
    }

    return true;
  }

  private isTask(value: unknown): value is Task {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.id === "string" &&
      (value.kind === "PMS" || value.kind === "DEFECT") &&
      typeof value.title === "string" &&
      typeof value.businessDate === "string" &&
      typeof value.dueDate === "string" &&
      this.isRoleId(value.assignedRole) &&
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
      typeof value.timestamp === "string" &&
      this.isTaskHistoryType(value.actionType) &&
      this.isTaskStateSnapshot(value.previousState) &&
      this.isTaskStateSnapshot(value.newState) &&
      (value.actor === "SYSTEM" || this.isRoleId(value.actor))
    );
  }

  private isTaskStateSnapshot(value: unknown): value is TaskStateSnapshot {
    if (!isRecord(value)) {
      return false;
    }

    return (
      (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
      (value.escalationLevel === "NONE" ||
        value.escalationLevel === "MCC" ||
        value.escalationLevel === "LOG_COMD") &&
      typeof value.dueDate === "string" &&
      isNullableString(value.lastNotifiedAt)
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

  private isRoleId(value: unknown): value is RoleId {
    return (
      value === "MEO" ||
      value === "CO" ||
      value === "MCC" ||
      value === "LOG_COMD"
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

  private resetPersistedState(): void {
    this.tasksById.clear();
    this.taskHistoryById.clear();
    this.escalationByDate.clear();
  }

  private persistState(): void {
    const payload: PersistedStoreState = {
      version: STORE_STATE_VERSION,
      tasks: [...this.tasksById.values()],
      taskHistory: [...this.taskHistoryById.entries()],
      escalationState: [...this.escalationByDate.entries()],
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
