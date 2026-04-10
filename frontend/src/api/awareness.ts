import { fetchJson } from "./client";
import type { DashboardRole } from "../types/roles";

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

export interface ApprovalAwarenessRecord {
  recordId: string;
  shipId: string;
  shipName: string;
  shipClass: string;
  kind: FleetRecordKind;
  title: string;
  businessDate: string;
  originRole: DashboardRole;
  status: ApprovalStatus;
  currentOwner: DashboardRole;
  approvalLevel: number;
  currentStepIndex: number;
  chain: DashboardRole[];
  visibleTo: DashboardRole[];
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  lastActionAt: string | null;
  lastActionBy: DashboardRole | "SYSTEM" | null;
  lastActionReason: string | null;
  lastActionNote: string | null;
  previousOwner: DashboardRole | null;
  bucket: AwarenessBucket;
  attentionSignals: AttentionSignal[];
  ageHoursSinceLastAction: number | null;
  ageHoursSinceSubmission: number | null;
  computed: {
    isStale: boolean;
    isPendingTooLong: boolean;
  };
}

export interface ApprovalDashboardSummary {
  role: DashboardRole;
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
  countsByRole: Record<DashboardRole, number>;
  countsByShip: Record<string, number>;
  topActionableRecords: ApprovalAwarenessRecord[];
}

function buildAwarenessQuery(role: DashboardRole, options?: { limit?: number; shipId?: string }): string {
  const params = new URLSearchParams({ role });

  if (options?.limit) {
    params.set("limit", String(options.limit));
  }

  if (options?.shipId) {
    params.set("shipId", options.shipId);
  }

  return params.toString();
}

export async function getAwarenessSummary(
  role: DashboardRole,
  options?: { shipId?: string },
): Promise<ApprovalDashboardSummary> {
  const response = await fetchJson<ApprovalDashboardSummary>(
    `/awareness/records/summary?${buildAwarenessQuery(role, options)}`,
  );
  if (!response.data) {
    throw new Error("Awareness summary is unavailable");
  }
  return response.data;
}

export async function getVisibleAwarenessRecords(
  role: DashboardRole,
  options?: { shipId?: string },
): Promise<ApprovalAwarenessRecord[]> {
  const response = await fetchJson<ApprovalAwarenessRecord[]>(
    `/awareness/records/visible?${buildAwarenessQuery(role, options)}`,
  );
  return response.data ?? [];
}

export async function getActionableAwarenessRecords(
  role: DashboardRole,
  options?: { limit?: number; shipId?: string },
): Promise<ApprovalAwarenessRecord[]> {
  const response = await fetchJson<ApprovalAwarenessRecord[]>(
    `/awareness/records/actionable?${buildAwarenessQuery(role, options)}`,
  );
  return response.data ?? [];
}

export async function getStaleAwarenessRecords(
  role: DashboardRole,
  options?: { limit?: number; shipId?: string },
): Promise<ApprovalAwarenessRecord[]> {
  const response = await fetchJson<ApprovalAwarenessRecord[]>(
    `/awareness/records/stale?${buildAwarenessQuery(role, options)}`,
  );
  return response.data ?? [];
}

export async function getRejectedAwarenessRecords(
  role: DashboardRole,
  options?: { limit?: number; shipId?: string },
): Promise<ApprovalAwarenessRecord[]> {
  const response = await fetchJson<ApprovalAwarenessRecord[]>(
    `/awareness/records/rejected?${buildAwarenessQuery(role, options)}`,
  );
  return response.data ?? [];
}
