export type LogType = "ENGINE_ROOM_REGISTER" | "EQUIPMENT_OPERATION_RECORD";

export type RoleId =
  | "COMMANDING_OFFICER"
  | "MARINE_ENGINEERING_OFFICER"
  | "WEAPON_ELECTRICAL_OFFICER"
  | "FLEET_SUPPORT_GROUP"
  | "LOGISTICS_COMMAND"
  | "SYSTEM";

export type AssignedRoleId = Exclude<RoleId, "SYSTEM">;

export interface ActorContext {
  role: AssignedRoleId;
  shipId?: string;
}

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
  | "CREATE_DEFECT"
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

export type TaskExecutionStatus = "PENDING" | "COMPLETED" | "MISSED";

export type TaskSeverity = "ROUTINE" | "URGENT" | "CRITICAL" | null;

export type EscalationLevel = "NONE" | "MCC" | "LOG_COMD";

export type ScheduleSource = "MPP" | "CYCLE" | "QUARTERLY" | "WEEKLY";

export type IntervalType = "CALENDAR" | "USAGE";

export type IntervalUnit = "DAYS" | "HOURS";

export type ApprovalStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export type FleetRecordKind = "MAINTENANCE_LOG" | "DEFECT" | "WORK_REQUEST";

export type AwarenessBucket =
  | "OWNED"
  | "PENDING_MY_ACTION"
  | "RECENTLY_REJECTED"
  | "VISIBLE_NOT_OWNED";

export type AttentionSignal =
  | "STALE"
  | "BLOCKED_BY_REJECTION"
  | "PENDING_TOO_LONG";

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

export interface Equipment {
  iss: string;
  name: string;
  system: string;
  manufacturer?: string;
  serialNumber?: string;
  location?: string;
}

export interface MaintenanceInterval {
  type: IntervalType;
  value: number;
  unit: IntervalUnit;
}

export interface UsageTracking {
  hoursRun?: number;
  shotsFired?: number;
}

export interface Defect {
  id: string;
  shipId: string;
  iss: string;
  equipment: string;
  description: string;
  classification: "IMMEDIATE" | "UNSCHEDULED" | "DELAYED";
  operationalImpact: string;
  reportedBy: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  ettr?: number;
  repairLevel?: "OLM" | "ILM" | "DLM";
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
  mic: string;
  iss: string;
  equipment: string;
  cycleCode: string;
  scheduleSource: ScheduleSource;
  businessDate: string;
  dueDate: string;
  assignedRole: AssignedRoleId;
  status: TaskStatus;
  executionStatus: TaskExecutionStatus;
  completedAt: string | null;
  verificationBy: string | null;
  verificationAt: number | null;
  lastCheckedAt: string | null;
  lastOverdueAt: string | null;
  replannedFromDueDate: string | null;
  replannedToDueDate: string | null;
  lastNotifiedAt: string | null;
  lastCompletedAt?: number;
  nextDueAt?: number;
  interval?: MaintenanceInterval;
  calendarInterval?: MaintenanceInterval;
  usageInterval?: MaintenanceInterval;
  usageTracking?: UsageTracking;
  requiresReplan?: boolean;
  defectId?: string | null;
  ettrDays: number | null;
  severity: TaskSeverity;
  escalationLevel: EscalationLevel;
  escalatedAt: string | null;
  sectionVerifiedBy?: string | null;
  sectionVerifiedAt?: number | null;
  departmentVerifiedBy?: string | null;
  departmentVerifiedAt?: number | null;
}

export interface TaskStateSnapshot {
  shipId: string;
  parentTaskId: string | null;
  kind: TaskKind;
  mic: string;
  iss: string;
  equipment: string;
  cycleCode: string;
  scheduleSource: ScheduleSource;
  assignedRole: AssignedRoleId;
  status: TaskStatus;
  executionStatus: TaskExecutionStatus;
  completedAt: string | null;
  verificationBy: string | null;
  verificationAt: number | null;
  lastCheckedAt: string | null;
  lastOverdueAt: string | null;
  replannedFromDueDate: string | null;
  replannedToDueDate: string | null;
  escalationLevel: EscalationLevel;
  dueDate: string;
  lastNotifiedAt: string | null;
  lastCompletedAt?: number;
  nextDueAt?: number;
  interval?: MaintenanceInterval;
  calendarInterval?: MaintenanceInterval;
  usageInterval?: MaintenanceInterval;
  usageTracking?: UsageTracking;
  requiresReplan?: boolean;
  defectId?: string | null;
  ettrDays: number | null;
  severity: TaskSeverity;
  escalatedAt: string | null;
  sectionVerifiedBy?: string | null;
  sectionVerifiedAt?: number | null;
  departmentVerifiedBy?: string | null;
  departmentVerifiedAt?: number | null;
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
  id?: string;
  type: EngineEventType;
  businessDate: string;
  occurredAt: string;
  actor?: RoleId;
  shipId?: string;
  iss?: string;
  equipment?: string;
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
  iss?: string;
  equipment?: string;
  defectId?: string;
  defectDescription?: string;
  defectClassification?: Defect["classification"];
  operationalImpact?: string;
  reportedBy?: string;
  repairLevel?: Defect["repairLevel"];
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

export interface ApprovalAwarenessComputed {
  isStale: boolean;
  isPendingTooLong: boolean;
}

export interface ApprovalAwarenessRecord {
  recordId: string;
  shipId: string;
  shipName: string;
  shipClass: string;
  kind: FleetRecordKind;
  title: string;
  businessDate: string;
  originRole: AssignedRoleId;
  status: ApprovalStatus;
  currentOwner: AssignedRoleId;
  approvalLevel: number;
  currentStepIndex: number;
  chain: AssignedRoleId[];
  visibleTo: AssignedRoleId[];
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  lastActionAt: string | null;
  lastActionBy: RoleId | null;
  lastActionReason: string | null;
  lastActionNote: string | null;
  lastHistoryAction: ApprovalHistoryType | null;
  lastHistoryAt: string | null;
  previousOwner: AssignedRoleId | null;
  bucket: AwarenessBucket;
  attentionSignals: AttentionSignal[];
  ageHoursSinceLastAction: number | null;
  ageHoursSinceSubmission: number | null;
  computed: ApprovalAwarenessComputed;
}

export interface ApprovalAwarenessQueryOptions {
  shipId?: string;
  now?: string;
  staleThresholdHours?: number;
  pendingThresholdHours?: number;
  recentlyRejectedWindowHours?: number;
  topActionableLimit?: number;
}

export interface RoleDashboardSummary {
  role: AssignedRoleId;
  shipId?: string;
  generatedAt: string;
  totals: {
    visible: number;
    owned: number;
    needingMyAction: number;
    recentlyRejected: number;
    visibleNotOwned: number;
    stale: number;
    blockedByRejection: number;
    pendingTooLong: number;
  };
  countsByStatus: Record<ApprovalStatus, number>;
  countsByRole: Record<AssignedRoleId, number>;
  countsByShip: Record<string, number>;
  topActionableRecords: ApprovalAwarenessRecord[];
  records: ApprovalAwarenessRecord[];
}

export const REQUIRED_DAILY_LOGS: LogType[] = [
  "ENGINE_ROOM_REGISTER",
  "EQUIPMENT_OPERATION_RECORD",
];
