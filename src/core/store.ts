import {
  DailyComplianceState,
  EscalationState,
  LogRecord,
  LogType,
  REQUIRED_DAILY_LOGS,
  StoreSnapshot,
  Task,
  TaskHistoryEntry,
  TaskSnapshot,
} from "./types";

export class InMemoryStore {
  private readonly logsByDate = new Map<string, LogRecord[]>();

  private readonly complianceByDate = new Map<string, DailyComplianceState>();

  private readonly escalationByDate = new Map<string, EscalationState>();

  private readonly tasksById = new Map<string, Task>();

  private readonly taskHistoryById = new Map<string, TaskHistoryEntry[]>();

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
    return next;
  }

  getSnapshot(businessDate: string): StoreSnapshot {
    return {
      logs: this.getLogsForDate(businessDate),
      complianceState: this.getOrCreateComplianceState(businessDate),
      escalationState: this.getOrCreateEscalationState(businessDate),
    };
  }

  saveTask(task: Task): void {
    this.tasksById.set(task.id, task);
    this.appendTaskHistory(task.id, {
      taskId: task.id,
      type: "CREATED",
      occurredAt: task.businessDate,
      status: task.status,
      note: `Task created for ${task.kind}`,
    });
  }

  getTask(taskId: string): Task | null {
    return this.tasksById.get(taskId) ?? null;
  }

  completeTask(taskId: string, occurredAt: string): Task {
    const current = this.requireTask(taskId);
    if (current.status === "COMPLETED") {
      return current;
    }

    const next = this.updateTask(taskId, {
      status: "COMPLETED",
      completedAt: occurredAt,
      lastCheckedAt: occurredAt,
    });

    this.appendTaskHistory(taskId, {
      taskId,
      type: "COMPLETED",
      occurredAt,
      status: next.status,
      note: "Task marked completed",
    });

    return next;
  }

  markTaskChecked(taskId: string, occurredAt: string): Task {
    const next = this.updateTask(taskId, {
      lastCheckedAt: occurredAt,
    });

    this.appendTaskHistory(taskId, {
      taskId,
      type: "CHECKED",
      occurredAt,
      status: next.status,
      note: "Task evaluated by rule engine",
    });

    return next;
  }

  markTaskOverdue(taskId: string, occurredAt: string): Task {
    const current = this.requireTask(taskId);
    if (current.status === "COMPLETED") {
      return current;
    }

    const next = this.updateTask(taskId, {
      status: "OVERDUE",
      lastCheckedAt: occurredAt,
      lastOverdueAt: occurredAt,
    });

    this.appendTaskHistory(taskId, {
      taskId,
      type: "STATUS_CHANGED",
      occurredAt,
      status: next.status,
      note: "Task marked overdue",
    });

    return next;
  }

  replanTask(taskId: string, nextDueDate: string, occurredAt: string): Task {
    const current = this.requireTask(taskId);
    const next = this.updateTask(taskId, {
      dueDate: nextDueDate,
      replannedFromDueDate: current.dueDate,
      replannedToDueDate: nextDueDate,
      status: current.status === "COMPLETED" ? "COMPLETED" : "PENDING",
    });

    this.appendTaskHistory(taskId, {
      taskId,
      type: "REPLANNED",
      occurredAt,
      status: next.status,
      note: `Task replanned from ${current.dueDate} to ${nextDueDate}`,
    });

    return next;
  }

  recordTaskNotification(taskId: string, occurredAt: string): Task {
    const next = this.updateTask(taskId, {
      lastNotifiedAt: occurredAt,
    });

    this.appendTaskHistory(taskId, {
      taskId,
      type: "NOTIFIED",
      occurredAt,
      status: next.status,
      note: "Task notification recorded",
    });

    return next;
  }

  updateTask(taskId: string, update: Partial<Task>): Task {
    const current = this.requireTask(taskId);

    const next: Task = {
      ...current,
      ...update,
    };

    this.tasksById.set(taskId, next);
    return next;
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
    entry: TaskHistoryEntry,
  ): void {
    const current = this.taskHistoryById.get(taskId) ?? [];
    current.push(entry);
    this.taskHistoryById.set(taskId, current);
  }
}
