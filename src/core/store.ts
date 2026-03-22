import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
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
  TaskStateSnapshot,
  TaskSnapshot,
} from "./types";

interface PersistedStoreState {
  tasks: Task[];
  taskHistory: Array<[string, TaskHistoryEntry[]]>;
  escalationState: Array<[string, EscalationState]>;
}

export class InMemoryStore {
  private readonly logsByDate = new Map<string, LogRecord[]>();

  private readonly complianceByDate = new Map<string, DailyComplianceState>();

  private readonly escalationByDate = new Map<string, EscalationState>();

  private readonly tasksById = new Map<string, Task>();

  private readonly taskHistoryById = new Map<string, TaskHistoryEntry[]>();

  private readonly persistenceFilePath: string;

  constructor(persistenceFilePath = resolve(process.cwd(), "data", "store-state.json")) {
    this.persistenceFilePath = persistenceFilePath;
    this.loadPersistedState();
  }

  saveLog(record: LogRecord): void {
    const existing = this.logsByDate.get(record.businessDate) ?? [];
    const withoutSameType = existing.filter(
      (entry) => entry.logType !== record.logType,
    );
    withoutSameType.push(record);
    this.logsByDate.set(record.businessDate, withoutSameType);
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
    if (current.status === "COMPLETED") {
      return current;
    }
    if (current.status === "OVERDUE") {
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

  escalateTask(taskId: string, escalationLevel: "MCC" | "LOG_COMD", occurredAt: string): Task {
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

  private formatRole(roleId: RoleId): string {
    switch (roleId) {
      case "LOG_COMD":
        return "Log Comd";
      default:
        return roleId;
    }
  }

  private loadPersistedState(): void {
    if (!existsSync(this.persistenceFilePath)) {
      return;
    }

    const raw = readFileSync(this.persistenceFilePath, "utf8");
    if (raw.trim() === "") {
      return;
    }

    const parsed = JSON.parse(raw) as PersistedStoreState;

    this.tasksById.clear();
    for (const task of parsed.tasks ?? []) {
      this.tasksById.set(task.id, task);
    }

    this.taskHistoryById.clear();
    for (const [taskId, history] of parsed.taskHistory ?? []) {
      this.taskHistoryById.set(taskId, history);
    }

    this.escalationByDate.clear();
    for (const [businessDate, escalationState] of parsed.escalationState ?? []) {
      this.escalationByDate.set(businessDate, escalationState);
    }
  }

  private persistState(): void {
    const payload: PersistedStoreState = {
      tasks: [...this.tasksById.values()],
      taskHistory: [...this.taskHistoryById.entries()],
      escalationState: [...this.escalationByDate.entries()],
    };

    mkdirSync(dirname(this.persistenceFilePath), { recursive: true });
    writeFileSync(
      this.persistenceFilePath,
      JSON.stringify(payload, null, 2),
      "utf8",
    );
  }
}
