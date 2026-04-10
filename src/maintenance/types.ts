// Maintenance domain types: tasks, PMSs, and related models

import type {
  AssignedRoleId,
  RoleId,
  SystemGroupId,
  ScheduleSource,
  MaintenanceInterval,
  UsageTracking,
  LineageSourceType,
} from "../shared/types";

export type TaskKind = "PMS" | "DEFECT";

export type TaskStatus = "PENDING" | "COMPLETED" | "OVERDUE";

export type TaskExecutionStatus = "PENDING" | "COMPLETED" | "MISSED";

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

export interface Task {
  id: string;
  shipId: string;
  parentTaskId: string | null;
  kind: TaskKind;
  systemGroup: SystemGroupId;
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
  originDirectiveId?: string | null;
  originRecordId?: string | null;
  derivedFromType?: LineageSourceType | null;
  derivedFromId?: string | null;
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
  systemGroup: SystemGroupId;
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
  originDirectiveId?: string | null;
  originRecordId?: string | null;
  derivedFromType?: LineageSourceType | null;
  derivedFromId?: string | null;
  ettrDays: number | null;
  severity: TaskSeverity;
  escalatedAt: string | null;
  sectionVerifiedBy?: string | null;
  sectionVerifiedAt?: number | null;
  departmentVerifiedBy?: string | null;
  departmentVerifiedAt?: number | null;
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

export interface TaskSnapshot {
  task: Task | null;
  history: TaskHistoryEntry[];
}
