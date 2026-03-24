export type LogType = "ENGINE_ROOM_REGISTER" | "EQUIPMENT_OPERATION_RECORD";

export type RoleId =
  | "COMMANDING_OFFICER"
  | "MARINE_ENGINEERING_OFFICER"
  | "WEAPON_ELECTRICAL_OFFICER"
  | "FLEET_SUPPORT_GROUP"
  | "LOGISTICS_COMMAND"
  | "SYSTEM";

export type AssignedRoleId = Exclude<RoleId, "SYSTEM">;

export type EngineEventType =
  | "DAILY_LOG_CHECK_DUE"
  | "DAILY_LOG_ESCALATION_DUE"
  | "PMS_TASK_GENERATE"
  | "PMS_TASK_CHECK"
  | "DEFECT_REPORTED"
  | "DEFECT_EVALUATION"
  | "APPROVAL_RECORD_CREATE"
  | "APPROVAL_RECORD_SUBMIT"
  | "APPROVAL_RECORD_APPROVE"
  | "APPROVAL_RECORD_REJECT"
  | "APPROVAL_RECORD_STALE_CHECK";

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
  | "ESCALATE_DEFECT_TO_LOG_COMD"
  | "CREATE_APPROVAL_RECORD"
  | "SUBMIT_APPROVAL_RECORD"
  | "APPROVE_APPROVAL_RECORD"
  | "REJECT_APPROVAL_RECORD"
  | "NOTIFY_APPROVAL_OWNER"
  | "AUDIT_APPROVAL_INVALID_ATTEMPT";

export type TaskKind = "PMS" | "DEFECT";

export type TaskStatus = "PENDING" | "COMPLETED" | "OVERDUE";

export type TaskSeverity = "ROUTINE" | "URGENT" | "CRITICAL" | null;

export type EscalationLevel = "NONE" | "MCC" | "LOG_COMD";

export type ApprovalStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export type FleetRecordKind = "MAINTENANCE_LOG" | "DEFECT" | "WORK_REQUEST";

export type TaskHistoryType =
  | "CREATED"
  | "CHECKED"
  | "STATUS_CHANGED"
  | "REPLANNED"
  | "NOTIFIED"
  | "COMPLETED"
  | "ESCALATED";

export type ApprovalHistoryType =
  | "CREATED"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "INVALID_ATTEMPT"
  | "STALE_REMINDER_SENT";

export interface Ship {
  id: string;
  name: string;
  classType: string;
}

export interface Notification {
  id: string;
  type: string;
  dedupeKey?: string;
  shipId: string;
  taskId: string | null;
  recordId?: string | null;
  message: string;
  targetRole: RoleId;
  timestamp: string;
  read: boolean;
}

export interface ApprovalFlow {
  chain: AssignedRoleId[];
  currentStepIndex: number;
  approvalLevel: number;
  currentOwner: AssignedRoleId;
  status: ApprovalStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  lastActionBy: RoleId | null;
  lastActionAt: string | null;
  lastActionReason: string | null;
  lastActionNote: string | null;
  lastStaleNotificationAt: string | null;
  version: number;
}

export interface FleetRecord {
  id: string;
  shipId: string;
  kind: FleetRecordKind;
  title: string;
  description: string | null;
  businessDate: string;
  createdAt: string;
  originRole: AssignedRoleId;
  visibleTo: AssignedRoleId[];
  approval: ApprovalFlow;
}

export interface LogRecord {
  shipId: string;
  businessDate: string;
  logType: LogType;
  submittedAt: string;
  submittedByRole: RoleId;
}

export interface DailyComplianceState {
  shipId: string;
  businessDate: string;
  requiredLogs: LogType[];
  presentLogs: LogType[];
  missingLogs: LogType[];
  status: "PENDING" | "COMPLIANT" | "NON_COMPLIANT";
  lastEvaluatedAt: string | null;
  meoNotifiedAt: string | null;
}

export interface EscalationState {
  shipId: string;
  businessDate: string;
  status: "NOT_ESCALATED" | "ESCALATED_TO_CO";
  reason: "MISSING_DAILY_LOGS" | null;
  missingLogsAtEscalation: LogType[];
  escalatedAt: string | null;
  targetRole: RoleId | null;
}

export interface Task {
  id: string;
  shipId: string;
  parentTaskId: string | null;
  kind: TaskKind;
  title: string;
  businessDate: string;
  dueDate: string;
  assignedRole: AssignedRoleId;
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
  shipId: string;
  parentTaskId: string | null;
  kind: TaskKind;
  assignedRole: AssignedRoleId;
  status: TaskStatus;
  completedAt: string | null;
  lastCheckedAt: string | null;
  lastOverdueAt: string | null;
  replannedFromDueDate: string | null;
  replannedToDueDate: string | null;
  escalationLevel: EscalationLevel;
  dueDate: string;
  lastNotifiedAt: string | null;
  ettrDays: number | null;
  severity: TaskSeverity;
  escalatedAt: string | null;
}

export interface ApprovalRecordSnapshot {
  shipId: string;
  kind: FleetRecordKind;
  title: string;
  businessDate: string;
  originRole: AssignedRoleId;
  chain: AssignedRoleId[];
  currentStepIndex: number;
  approvalLevel: number;
  currentOwner: AssignedRoleId;
  status: ApprovalStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  lastActionBy: RoleId | null;
  lastActionAt: string | null;
  lastActionReason: string | null;
  lastActionNote: string | null;
  lastStaleNotificationAt: string | null;
  version: number;
}

export interface TaskHistoryEntry {
  taskId: string;
  shipId: string;
  timestamp: string;
  actionType: TaskHistoryType;
  previousState: TaskStateSnapshot;
  newState: TaskStateSnapshot;
  actor: RoleId | "SYSTEM";
}

export interface ApprovalHistoryEntry {
  recordId: string;
  shipId: string;
  timestamp: string;
  actionType: ApprovalHistoryType;
  previousState: ApprovalRecordSnapshot;
  newState: ApprovalRecordSnapshot;
  actor: RoleId | "SYSTEM";
  transitionId: string | null;
  reason: string | null;
  note: string | null;
}

export interface EngineEvent {
  type: EngineEventType;
  businessDate: string;
  occurredAt: string;
  actor?: RoleId;
  shipId?: string;
  taskId?: string;
  taskTitle?: string;
  dueDate?: string;
  assignedRole?: AssignedRoleId;
  taskKind?: TaskKind;
  ettrDays?: number;
  severity?: TaskSeverity;
  recordId?: string;
  recordKind?: FleetRecordKind;
  recordTitle?: string;
  description?: string;
  transitionId?: string;
  reason?: string;
  note?: string;
  staleThresholdHours?: number;
}

export interface ActionCommand {
  type: ActionType;
  businessDate: string;
  issuedAt: string;
  missingLogs: LogType[];
  targetRole?: RoleId;
  actor?: RoleId;
  shipId?: string;
  taskId?: string;
  parentTaskId?: string;
  taskTitle?: string;
  dueDate?: string;
  assignedRole?: AssignedRoleId;
  taskKind?: TaskKind;
  ettrDays?: number;
  severity?: TaskSeverity;
  recordId?: string;
  recordKind?: FleetRecordKind;
  recordTitle?: string;
  description?: string;
  originRole?: AssignedRoleId;
  transitionId?: string;
  reason?: string;
  note?: string;
  currentOwner?: AssignedRoleId;
  notificationType?: string;
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
    | "TASK_ESCALATED"
    | "RECORD_CREATED"
    | "RECORD_SUBMITTED"
    | "RECORD_APPROVED"
    | "RECORD_REJECTED"
    | "RECORD_NOTIFIED";
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

export interface ApprovalRecordView {
  record: FleetRecord | null;
  history: ApprovalHistoryEntry[];
}

export const REQUIRED_DAILY_LOGS: LogType[] = [
  "ENGINE_ROOM_REGISTER",
  "EQUIPMENT_OPERATION_RECORD",
];
