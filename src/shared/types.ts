// Shared primitive types and enums used across domains

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

export type SystemGroupId =
  | "PROPULSION"
  | "AUXILIARIES"
  | "ELECTRICAL_POWER"
  | "WEAPONS"
  | "SENSORS_AND_NAVIGATION"
  | "COMMUNICATIONS"
  | "HULL_AND_SEAKEEPING"
  | "DAMAGE_CONTROL_AND_SAFETY"
  | "SUPPLY_AND_SUPPORT"
  | "GENERAL_ENGINEERING";

export type LineageSourceType = "DIRECTIVE" | "RECORD" | "TASK" | "DEFECT";

export type AwarenessBucket =
  | "OWNED"
  | "PENDING_MY_ACTION"
  | "RECENTLY_REJECTED"
  | "VISIBLE_NOT_OWNED";

export type AttentionSignal =
  | "STALE"
  | "BLOCKED_BY_REJECTION"
  | "PENDING_TOO_LONG";

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

export type ScheduleSource = "MPP" | "CYCLE" | "QUARTERLY" | "WEEKLY";

export type IntervalType = "CALENDAR" | "USAGE";

export type IntervalUnit = "DAYS" | "HOURS";

export interface Ship {
  id: string;
  name: string;
  classType: string;
  jurisdictions: AssignedRoleId[];
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

export const REQUIRED_DAILY_LOGS: LogType[] = [
  "ENGINE_ROOM_REGISTER",
  "EQUIPMENT_OPERATION_RECORD",
];
