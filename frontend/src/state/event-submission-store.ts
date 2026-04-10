import { useState } from "react";
import {
  submitEngineEvent,
  type EventSubmissionInput,
} from "../services/event-submission.service";

type SubmissionState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export interface EventSubmissionStore {
  status: SubmissionState;
  isSubmitting: boolean;
  submit: (input: EventSubmissionInput) => Promise<void>;
  reset: () => void;
}

export function useEventSubmissionStore(): EventSubmissionStore {
  const [status, setStatus] = useState<SubmissionState>({ kind: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(input: EventSubmissionInput): Promise<void> {
    setStatus({ kind: "idle" });
    setIsSubmitting(true);

    try {
      const outcome = await submitEngineEvent(input);
      setStatus({
        kind: "success",
        message: outcome.message,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to submit event",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function reset(): void {
    setStatus({ kind: "idle" });
  }

  return {
    status,
    isSubmitting,
    submit,
    reset,
  };
}
