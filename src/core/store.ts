import {
  DailyComplianceState,
  EscalationState,
  LogRecord,
  LogType,
  REQUIRED_DAILY_LOGS,
  StoreSnapshot,
  Task,
  TaskSnapshot,
} from "./types";

export class InMemoryStore {
  private readonly logsByDate = new Map<string, LogRecord[]>();

  private readonly complianceByDate = new Map<string, DailyComplianceState>();

  private readonly escalationByDate = new Map<string, EscalationState>();

  private readonly tasksById = new Map<string, Task>();

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
  }

  getTask(taskId: string): Task | null {
    return this.tasksById.get(taskId) ?? null;
  }

  updateTask(taskId: string, update: Partial<Task>): Task {
    const current = this.getTask(taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }

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
}
