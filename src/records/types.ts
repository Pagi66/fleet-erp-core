// Record domain types: approval records, record registry, and related models

import type {
  AssignedRoleId,
  RoleId,
  SystemGroupId,
  LineageSourceType,
  AwarenessBucket,
  AttentionSignal,
} from "../shared/types";

export type ApprovalStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export type FleetRecordKind = "MAINTENANCE_LOG" | "DEFECT" | "WORK_REQUEST";

export type RecordAuthorityMode = "PAPER_AUTHORITATIVE" | "DIGITAL_AUTHORITATIVE";

export type RecordSourceKind = "SCANNED_PAPER" | "DIGITAL_ENTRY" | "IMPORTED_DOCUMENT";

export type RecordDigitizationStage = "INDEXED" | "PARTIALLY_STRUCTURED" | "FULLY_STRUCTURED";

export type ApprovalHistoryType =
  | "CREATED"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "INVALID_ATTEMPT"
  | "STALE_REMINDER_SENT";

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
  referenceNumber: string;
  shipId: string;
  kind: FleetRecordKind;
  systemGroup: SystemGroupId;
  title: string;
  description: string | null;
  businessDate: string;
  createdAt: string;
  originRole: AssignedRoleId;
  authorityMode: RecordAuthorityMode;
  sourceKind: RecordSourceKind;
  digitizationStage: RecordDigitizationStage;
  originDirectiveId?: string | null;
  originRecordId?: string | null;
  derivedFromType?: LineageSourceType | null;
  derivedFromId?: string | null;
  visibleTo: AssignedRoleId[];
  approval: ApprovalFlow;
}

export interface ApprovalRecordSnapshot {
  shipId: string;
  referenceNumber: string;
  kind: FleetRecordKind;
  systemGroup: SystemGroupId;
  title: string;
  businessDate: string;
  originRole: AssignedRoleId;
  authorityMode: RecordAuthorityMode;
  sourceKind: RecordSourceKind;
  digitizationStage: RecordDigitizationStage;
  originDirectiveId?: string | null;
  originRecordId?: string | null;
  derivedFromType?: LineageSourceType | null;
  derivedFromId?: string | null;
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

export interface ApprovalAwarenessComputed {
  isStale: boolean;
  isPendingTooLong: boolean;
}

export interface ApprovalAwarenessRecord {
  recordId: string;
  referenceNumber: string;
  shipId: string;
  shipName: string;
  shipClass: string;
  kind: FleetRecordKind;
  systemGroup: SystemGroupId;
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

export interface ApprovalRecordView {
  record: FleetRecord | null;
  history: ApprovalHistoryEntry[];
}

export interface LogRecord {
  shipId: string;
  businessDate: string;
  logType: string;
  submittedAt: string;
  submittedByRole: RoleId;
}

export interface DailyComplianceState {
  shipId: string;
  businessDate: string;
  requiredLogs: string[];
  presentLogs: string[];
  missingLogs: string[];
  status: "PENDING" | "COMPLIANT" | "NON_COMPLIANT";
  lastEvaluatedAt: string | null;
  meoNotifiedAt: string | null;
}

export interface EscalationState {
  shipId: string;
  businessDate: string;
  status: "NOT_ESCALATED" | "ESCALATED_TO_CO";
  reason: "MISSING_DAILY_LOGS" | null;
  missingLogsAtEscalation: string[];
  escalatedAt: string | null;
  targetRole: RoleId | null;
}
