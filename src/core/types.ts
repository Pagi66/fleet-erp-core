export type LogType = "ENGINE_ROOM_REGISTER" | "EQUIPMENT_OPERATION_RECORD";

export type RoleId =
  | "COMMANDING_OFFICER"
  | "MARINE_ENGINEERING_OFFICER"
  | "WEAPON_ELECTRICAL_OFFICER"
  | "FLEET_SUPPORT_GROUP"
  | "LOGISTICS_COMMAND"
  | "SYSTEM";

export type EngineEventType =
  | "DAILY_LOG_CHECK_DUE"
  | "DAILY_LOG_ESCALATION_DUE"
  | "PMS_TASK_GENERATE"
  | "PMS_TASK_CHECK"
  | "DEFECT_REPORTED"
  | "DEFECT_EVALUATION";

export type ActionType =
  | "MARK_COMPLIANT"
  | "MARK_NON_COMPLIANT"
  | "NOTIFY_MEO"
  | "ESCALATE_TO_CO"
  | "CHECK_TASK"
  | "CREATE_PMS_TASK"
  | "MARK_PMS_TASK_OVERDUE"
  | "REPLAN_PMS_TASK"
  | "NOTIFY_PMS_SUPERVISOR"
  | "CREATE_DEFECT_TASK"
  | "ESCALATE_DEFECT_TO_MCC"
  | "ESCALATE_DEFECT_TO_LOG_COMD";

export type TaskKind = "PMS" | "DEFECT";

export type TaskStatus = "PENDING" | "COMPLETED" | "OVERDUE";

export type TaskSeverity = "ROUTINE" | "URGENT" | "CRITICAL" | null;

export type EscalationLevel = "NONE" | "MCC" | "LOG_COMD";

export type TaskHistoryType =
  | "CREATED"
  | "CHECKED"
  | "STATUS_CHANGED"
  | "REPLANNED"
  | "NOTIFIED"
  | "COMPLETED"
  | "ESCALATED";

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
  ettrDays: number | null;
  severity: TaskSeverity;
  escalationLevel: EscalationLevel;
  escalatedAt: string | null;
}

export interface TaskStateSnapshot {
  status: TaskStatus;
  escalationLevel: EscalationLevel;
  dueDate: string;
  lastNotifiedAt: string | null;
}

export interface TaskHistoryEntry {
  taskId: string;
  timestamp: string;
  actionType: TaskHistoryType;
  previousState: TaskStateSnapshot;
  newState: TaskStateSnapshot;
  actor: RoleId | "SYSTEM";
}

export interface EngineEvent {
  type: EngineEventType;
  businessDate: string;
  occurredAt: string;
  actor?: RoleId;
  taskId?: string;
  taskTitle?: string;
  dueDate?: string;
  assignedRole?: RoleId;
  taskKind?: TaskKind;
  ettrDays?: number;
  severity?: TaskSeverity;
}

export interface ActionCommand {
  type: ActionType;
  businessDate: string;
  issuedAt: string;
  missingLogs: LogType[];
  targetRole?: RoleId;
  actor?: RoleId;
  taskId?: string;
  taskTitle?: string;
  dueDate?: string;
  assignedRole?: RoleId;
  taskKind?: TaskKind;
  ettrDays?: number;
  severity?: TaskSeverity;
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
    | "TASK_OVERDUE"
    | "TASK_ESCALATED";
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
