import { useState } from "react";
import { useEventSubmissionStore } from "../state/event-submission-store";

const starterPayload = JSON.stringify(
  {
    businessDate: "2026-03-25",
    occurredAt: new Date().toISOString(),
    shipId: "SHIP-001",
  },
  null,
  2,
);

export function EventForm() {
  const [type, setType] = useState("");
  const [payload, setPayload] = useState(starterPayload);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const submission = useEventSubmissionStore();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    submission.reset();

    let parsedPayload: Record<string, unknown>;
    try {
      const candidate = JSON.parse(payload) as unknown;
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        throw new Error("Payload must be a JSON object");
      }
      parsedPayload = candidate as Record<string, unknown>;
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Invalid JSON payload");
      return;
    }

    if (type.trim() === "") {
      setValidationError("Type is required");
      return;
    }

    await submission.submit({
      type,
      payload: parsedPayload,
      idempotencyKey: idempotencyKey.trim() || undefined,
    });
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
        <button type="submit" disabled={submission.isSubmitting}>
          {submission.isSubmitting ? "Submitting..." : "Send Event"}
        </button>
        {validationError ? <p className="status-error">{validationError}</p> : null}
        {!validationError && submission.status.kind !== "idle" ? (
          <p
            className={
              submission.status.kind === "error" ? "status-error" : "status-success"
            }
          >
            {submission.status.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
