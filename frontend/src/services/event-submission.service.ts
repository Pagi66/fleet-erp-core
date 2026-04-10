import { submitEvent } from "../api/events";

export interface EventSubmissionInput {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface EventSubmissionOutcome {
  message: string;
}

export async function submitEngineEvent(
  input: EventSubmissionInput,
): Promise<EventSubmissionOutcome> {
  const result = await submitEvent(input);

  return {
    message: result.duplicate
      ? "Duplicate event ignored by API."
      : "Event accepted successfully.",
  };
}
