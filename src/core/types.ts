// Core types module - maintains backward compatibility during modular migration
// Gradually being split into context-specific modules:
// - src/shared - shared primitives and IDs
// - src/records - record domain models
// - src/maintenance - task and PMS domain models
// - src/defects - defect domain models

// Re-export all types from modular domains for backward compatibility
export * from "../shared";
export * from "../records";
export * from "../maintenance";
export * from "../defects";

// Domain-agnostic orchestration types (engine-level types that span multiple domains)

export interface EngineEvent {
  id?: string;
  type: import("../shared/types").EngineEventType;
  businessDate: string;
  occurredAt: string;
  actor?: import("../shared/types").RoleId;
  shipId?: string;
  iss?: string;
  equipment?: string;
  taskId?: string;
  taskTitle?: string;
  dueDate?: string;
  assignedRole?: import("../shared/types").AssignedRoleId;
  taskKind?: import("../maintenance/types").TaskKind;
  ettrDays?: number;
  severity?: import("../maintenance/types").TaskSeverity;
  recordId?: string;
  recordKind?: import("../records/types").FleetRecordKind;
  recordTitle?: string;
  systemGroup?: import("../shared/types").SystemGroupId;
  referenceNumber?: string;
  description?: string;
  authorityMode?: import("../records/types").RecordAuthorityMode;
  sourceKind?: import("../records/types").RecordSourceKind;
  digitizationStage?: import("../records/types").RecordDigitizationStage;
  originDirectiveId?: string;
  originRecordId?: string;
  derivedFromType?: import("../shared/types").LineageSourceType;
  derivedFromId?: string;
  transitionId?: string;
  reason?: string;
  note?: string;
  staleThresholdHours?: number;
}

export interface ActionCommand {
  type: import("../shared/types").ActionType;
  businessDate: string;
  issuedAt: string;
  missingLogs: import("../shared/types").LogType[];
  targetRole?: import("../shared/types").RoleId;
  actor?: import("../shared/types").RoleId;
  shipId?: string;
  iss?: string;
  equipment?: string;
  defectId?: string;
  defectDescription?: string;
  defectClassification?: import("../defects/types").Defect["classification"];
  operationalImpact?: string;
  reportedBy?: string;
  repairLevel?: import("../defects/types").Defect["repairLevel"];
  taskId?: string;
  parentTaskId?: string;
  taskTitle?: string;
  dueDate?: string;
  assignedRole?: import("../shared/types").AssignedRoleId;
  taskKind?: import("../maintenance/types").TaskKind;
  systemGroup?: import("../shared/types").SystemGroupId;
  ettrDays?: number;
  severity?: import("../maintenance/types").TaskSeverity;
  recordId?: string;
  referenceNumber?: string;
  recordKind?: import("../records/types").FleetRecordKind;
  recordTitle?: string;
  description?: string;
  authorityMode?: import("../records/types").RecordAuthorityMode;
  sourceKind?: import("../records/types").RecordSourceKind;
  digitizationStage?: import("../records/types").RecordDigitizationStage;
  originRole?: import("../shared/types").AssignedRoleId;
  originDirectiveId?: string;
  originRecordId?: string;
  derivedFromType?: import("../shared/types").LineageSourceType;
  derivedFromId?: string;
  transitionId?: string;
  reason?: string;
  note?: string;
  currentOwner?: import("../shared/types").AssignedRoleId;
  notificationType?: string;
}

export interface RuleDecision {
  eventType: import("../shared/types").EngineEventType;
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
  missingLogs: import("../shared/types").LogType[];
  commands: ActionCommand[];
}

export interface StoreSnapshot {
  logs: import("../records/types").LogRecord[];
  complianceState: import("../records/types").DailyComplianceState;
  escalationState: import("../records/types").EscalationState;
}

export interface Notification {
  id: string;
  type: string;
  dedupeKey?: string;
  shipId: string;
  taskId: string | null;
  recordId?: string | null;
  message: string;
  targetRole: import("../shared/types").RoleId;
  timestamp: string;
  read: boolean;
}
