import { fetchJson } from "./client";

export interface EventSubmissionPayload {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface EventSubmissionResult {
  duplicate: boolean;
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
