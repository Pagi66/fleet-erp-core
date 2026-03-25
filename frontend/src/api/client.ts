const DEFAULT_BASE_URL = "http://localhost:3000";

export type ApiEnvelope<T> =
  | {
      success: true;
      data?: T;
      duplicate?: boolean;
      meta?: {
        limit: number;
        offset: number;
        total: number;
      };
    }
  | {
      success: false;
      error:
        | string
        | {
            code?: string;
            message: string;
          };
    };

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

export interface ComplianceSignal {
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  shipId?: string;
  taskId?: string;
  defectId?: string;
}

export interface FailedEvent {
  eventId: string;
  reason: string;
  timestamp: number;
}

export interface EventSubmissionPayload {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface EventSubmissionResult {
  duplicate: boolean;
}

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || DEFAULT_BASE_URL;

export async function fetchJson<T>(path: string, options?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  const json = (await response.json()) as ApiEnvelope<T>;

  if (!json.success) {
    const message = typeof json.error === "string" ? json.error : json.error.message;
    throw new Error(message);
  }

  return json;
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

export async function getComplianceSignals(limit = 50): Promise<ComplianceSignal[]> {
  const response = await fetchJson<ComplianceSignal[]>(`/compliance?limit=${limit}`);
  return response.data ?? [];
}

export async function getFailedEvents(): Promise<FailedEvent[]> {
  const response = await fetchJson<FailedEvent[]>("/failed-events");
  return response.data ?? [];
}

export async function submitEvent(payload: EventSubmissionPayload): Promise<EventSubmissionResult> {
  const response = await fetchJson<unknown>("/events", {
    method: "POST",
    headers: payload.idempotencyKey
      ? {
          "Idempotency-Key": payload.idempotencyKey,
        }
      : undefined,
    body: JSON.stringify({
      type: payload.type,
      payload: payload.payload,
    }),
  });

  return {
    duplicate: response.duplicate ?? false,
  };
}
