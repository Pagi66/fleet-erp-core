import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canManageApprovalRecord } from "../core/rbac";

export class RejectApprovalRecordAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.recordId) {
      throw new Error("REJECT_APPROVAL_RECORD command is missing shipId or recordId");
    }
    if (!command.actor) {
      throw new Error("REJECT_APPROVAL_RECORD command is missing actor");
    }

    const record = store.getApprovalRecordInShip(command.recordId, command.shipId);
    if (!record) {
      logger.warn("ship_context_rejected_action", {
        actionType: command.type,
        status: command.shipId,
      });
      throw new Error("Approval record does not exist in the provided ship context");
    }

    if (!canManageApprovalRecord(command.actor, command, record)) {
      store.recordApprovalInvalidAttempt(
        command.recordId,
        command.shipId,
        command.issuedAt,
        command.actor,
        command.transitionId ?? null,
        "Actor is not authorized to reject this approval record",
        command.note ?? null,
      );
      logger.warn("rbac_rejected_action", {
        actionType: command.type,
        status: command.actor,
      });
      throw new Error("Actor is not authorized to reject approval records");
    }

    store.rejectApprovalRecord(
      command.recordId,
      command.shipId,
      command.issuedAt,
      command.actor,
      command.transitionId ?? `${command.type}:${command.recordId}:${command.issuedAt}`,
      command.reason ?? null,
      command.note ?? null,
    );
  }
}
