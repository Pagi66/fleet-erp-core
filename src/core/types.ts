export type LogType = "ENGINE_ROOM_REGISTER" | "EQUIPMENT_OPERATION_RECORD";

export type RoleId = "MEO" | "CO" | "MCC";

export type EngineEventType =
  | "DAILY_LOG_CHECK_DUE"
  | "DAILY_LOG_ESCALATION_DUE"
  | "PMS_TASK_GENERATE"
  | "PMS_TASK_CHECK";

export type ActionType =
  | "MARK_COMPLIANT"
  | "MARK_NON_COMPLIANT"
  | "NOTIFY_MEO"
  | "ESCALATE_TO_CO"
  | "CREATE_PMS_TASK"
  | "MARK_PMS_TASK_OVERDUE"
  | "REPLAN_PMS_TASK"
  | "NOTIFY_PMS_SUPERVISOR";

export type TaskKind = "PMS";

export type TaskStatus = "PENDING" | "COMPLETED" | "OVERDUE";

export type TaskHistoryType =
  | "CREATED"
  | "CHECKED"
  | "STATUS_CHANGED"
  | "REPLANNED"
  | "NOTIFIED"
  | "COMPLETED";

export interface LogRecord {
  businessDate: string;
  logType: LogType;
  submittedAt: string;
  submittedByRole: RoleId;
}

export interface DailyComplianceState {
  businessDate: string;
  requiredLogs: LogType[];
  presentLogs: LogType[];
  missingLogs: LogType[];
  status: "PENDING" | "COMPLIANT" | "NON_COMPLIANT";
  lastEvaluatedAt: string | null;
  meoNotifiedAt: string | null;
}

export interface EscalationState {
  businessDate: string;
  status: "NOT_ESCALATED" | "ESCALATED_TO_CO";
  reason: "MISSING_DAILY_LOGS" | null;
  missingLogsAtEscalation: LogType[];
  escalatedAt: string | null;
  targetRole: RoleId | null;
}

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  businessDate: string;
  dueDate: string;
  assignedRole: RoleId;
  status: TaskStatus;
  completedAt: string | null;
  lastCheckedAt: string | null;
  lastOverdueAt: string | null;
  replannedFromDueDate: string | null;
  replannedToDueDate: string | null;
  lastNotifiedAt: string | null;
}

export interface TaskHistoryEntry {
  taskId: string;
  type: TaskHistoryType;
  occurredAt: string;
  status: TaskStatus;
  note: string;
}

export interface EngineEvent {
  type: EngineEventType;
  businessDate: string;
  occurredAt: string;
  taskId?: string;
  taskTitle?: string;
  dueDate?: string;
  assignedRole?: RoleId;
}

export interface ActionCommand {
  type: ActionType;
  businessDate: string;
  issuedAt: string;
  missingLogs: LogType[];
  targetRole?: RoleId;
  taskId?: string;
  taskTitle?: string;
  dueDate?: string;
  assignedRole?: RoleId;
}

export interface RuleDecision {
  eventType: EngineEventType;
  businessDate: string;
  result:
    | "COMPLIANT"
    | "NON_COMPLIANT"
    | "ESCALATE"
    | "NO_CHANGE"
    | "TASK_CREATED"
    | "TASK_COMPLETED"
    | "TASK_OVERDUE";
  missingLogs: LogType[];
  commands: ActionCommand[];
}

export interface StoreSnapshot {
  logs: LogRecord[];
  complianceState: DailyComplianceState;
  escalationState: EscalationState;
}

export interface TaskSnapshot {
  task: Task | null;
  history: TaskHistoryEntry[];
}

export const REQUIRED_DAILY_LOGS: LogType[] = [
  "ENGINE_ROOM_REGISTER",
  "EQUIPMENT_OPERATION_RECORD",
];
