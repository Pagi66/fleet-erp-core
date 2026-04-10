import { fetchJson } from "./client";
import type { DashboardRole } from "../types/roles";

export interface NotificationRecord {
  id: string;
  type: string;
  shipId: string;
  taskId: string | null;
  recordId?: string | null;
  message: string;
  targetRole: DashboardRole | "SYSTEM";
  timestamp: string;
  read: boolean;
}

export async function getNotifications(
  shipId: string,
  role: DashboardRole,
): Promise<NotificationRecord[]> {
  const response = await fetchJson<NotificationRecord[]>(
    `/notifications?shipId=${encodeURIComponent(shipId)}&role=${encodeURIComponent(role)}`,
  );
  return response.data ?? [];
}
