import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class AuditApprovalInvalidAttemptAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.recordId || !command.actor || !command.reason) {
      throw new Error("AUDIT_APPROVAL_INVALID_ATTEMPT command is missing required fields");
    }

    store.recordApprovalInvalidAttempt(
      command.recordId,
      command.shipId,
      command.issuedAt,
      command.actor,
      command.transitionId ?? null,
      command.reason,
      command.note ?? null,
    );
  }
}
