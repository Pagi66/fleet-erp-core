import { fetchJson } from "./client";
import type {
  ApprovalStatus,
  FleetRecordKind,
} from "./awareness";
import type { DashboardRole } from "../types/roles";

export interface ApprovalRecordDetail {
  record: {
    id: string;
    shipId: string;
    kind: FleetRecordKind;
    title: string;
    description: string | null;
    businessDate: string;
    createdAt: string;
    originRole: DashboardRole;
    visibleTo: DashboardRole[];
    approval: {
      chain: DashboardRole[];
      currentStepIndex: number;
      approvalLevel: number;
      currentOwner: DashboardRole;
      status: ApprovalStatus;
      submittedAt: string | null;
      approvedAt: string | null;
      rejectedAt: string | null;
      lastActionBy: DashboardRole | "SYSTEM" | null;
      lastActionAt: string | null;
      lastActionReason: string | null;
      lastActionNote: string | null;
      lastStaleNotificationAt: string | null;
      version: number;
    };
  } | null;
  history: Array<{
    timestamp: string;
    actionType: string;
    actor: DashboardRole | "SYSTEM";
    reason: string | null;
    note: string | null;
  }>;
}

export async function getRecordDetail(
  recordId: string,
  role: DashboardRole,
): Promise<ApprovalRecordDetail> {
  const response = await fetchJson<ApprovalRecordDetail>(
    `/records/${encodeURIComponent(recordId)}?role=${encodeURIComponent(role)}`,
  );
  if (!response.data) {
    throw new Error("Record detail is unavailable");
  }
  return response.data;
}
