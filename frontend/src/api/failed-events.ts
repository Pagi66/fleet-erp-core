import { fetchJson } from "./client";

export interface FailedEvent {
  eventId: string;
  reason: string;
  timestamp: number;
}

export async function getFailedEvents(): Promise<FailedEvent[]> {
  const response = await fetchJson<FailedEvent[]>("/failed-events");
  return response.data ?? [];
}
