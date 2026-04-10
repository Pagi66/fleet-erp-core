import { fetchJson } from "./client";
import type { DashboardRole } from "../types/roles";

export type TaskStatus = "PENDING" | "COMPLETED" | "OVERDUE";
export type TaskExecutionStatus = "PENDING" | "COMPLETED" | "MISSED";
export type TaskSeverity = "ROUTINE" | "URGENT" | "CRITICAL" | null;
export type TaskEscalationLevel = "NONE" | "MCC" | "LOG_COMD";
export type TaskKind = "PMS" | "DEFECT";

export interface TaskRecord {
  id: string;
  shipId: string;
  kind: TaskKind;
  title: string;
  equipment: string;
  dueDate: string;
  assignedRole: DashboardRole;
  status: TaskStatus;
  executionStatus: TaskExecutionStatus;
  severity: TaskSeverity;
  escalationLevel: TaskEscalationLevel;
}

export async function getTasks(shipId: string): Promise<TaskRecord[]> {
  const response = await fetchJson<TaskRecord[]>(
    `/tasks?shipId=${encodeURIComponent(shipId)}`,
  );
  return response.data ?? [];
}

export async function getOverdueTasks(shipId: string): Promise<TaskRecord[]> {
  const response = await fetchJson<TaskRecord[]>(
    `/tasks/overdue?shipId=${encodeURIComponent(shipId)}`,
  );
  return response.data ?? [];
}
