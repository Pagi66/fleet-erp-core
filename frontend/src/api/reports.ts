import { fetchJson } from "./client";

export type OperationalStatus = "STABLE" | "ATTENTION" | "CRITICAL";

export interface CoShipReport {
  shipId: string;
  overdueCount: number;
  criticalCount: number;
  status: OperationalStatus;
}

export interface CoReport {
  ships: CoShipReport[];
}

export interface MeoReport {
  shipId: string;
  pendingCount: number;
  overdueCount: number;
  warningCount: number;
  criticalCount: number;
}

export interface WeoReport {
  shipId: string;
  totalTasks: number;
  overdueCount: number;
  criticalCount: number;
  status: OperationalStatus;
}

export async function getCoReport(): Promise<CoReport> {
  const response = await fetchJson<CoReport>("/reports/co");
  return response.data ?? { ships: [] };
}

export async function getMeoReport(shipId: string): Promise<MeoReport> {
  const response = await fetchJson<MeoReport>(`/reports/meo/${encodeURIComponent(shipId)}`);
  if (!response.data) {
    throw new Error("MEO report is unavailable");
  }
  return response.data;
}

export async function getWeoReport(shipId: string): Promise<WeoReport> {
  const response = await fetchJson<WeoReport>(`/reports/weo/${encodeURIComponent(shipId)}`);
  if (!response.data) {
    throw new Error("WEO report is unavailable");
  }
  return response.data;
}
