import { fetchJson } from "./client";

export interface ComplianceSignal {
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  shipId?: string;
  taskId?: string;
  defectId?: string;
}

export async function getComplianceSignals(limit = 50): Promise<ComplianceSignal[]> {
  const response = await fetchJson<ComplianceSignal[]>(`/compliance?limit=${limit}`);
  return response.data ?? [];
}
