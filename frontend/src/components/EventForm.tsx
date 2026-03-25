import { useState } from "react";
import { submitEvent } from "../api/client";

const starterPayload = JSON.stringify(
  {
    businessDate: "2026-03-25",
    occurredAt: new Date().toISOString(),
    shipId: "SHIP-001",
  },
  null,
  2,
);

type SubmissionState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function EventForm() {
  const [type, setType] = useState("");
  const [payload, setPayload] = useState(starterPayload);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [status, setStatus] = useState<SubmissionState>({ kind: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "idle" });

    let parsedPayload: Record<string, unknown>;
    try {
      const candidate = JSON.parse(payload) as unknown;
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        throw new Error("Payload must be a JSON object");
      }
      parsedPayload = candidate as Record<string, unknown>;
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Invalid JSON payload",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitEvent({
        type,
        payload: parsedPayload,
        idempotencyKey: idempotencyKey.trim() || undefined,
      });

      setStatus({
        kind: "success",
        message: result.duplicate ? "Duplicate event ignored by API." : "Event accepted successfully.",
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

  return (
    <form className="event-form" onSubmit={handleSubmit}>
      <label>
        <span>Type</span>
        <input
          value={type}
          onChange={(event) => setType(event.target.value)}
          placeholder="PMS_TASK_CHECK"
          required
        />
      </label>

      <label>
        <span>Payload (JSON)</span>
        <textarea
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          rows={10}
          required
        />
      </label>

      <label>
        <span>Idempotency-Key</span>
        <input
          value={idempotencyKey}
          onChange={(event) => setIdempotencyKey(event.target.value)}
          placeholder="Optional"
        />
      </label>

      <div className="form-actions">
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Submitting..." : "Send Event"}
        </button>
        {status.kind !== "idle" ? (
          <p className={status.kind === "error" ? "status-error" : "status-success"}>{status.message}</p>
        ) : null}
      </div>
    </form>
  );
}
