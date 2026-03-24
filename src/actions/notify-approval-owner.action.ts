import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canManageApprovalRecord } from "../core/rbac";

export class NotifyApprovalOwnerAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.recordId || !command.currentOwner) {
      throw new Error("NOTIFY_APPROVAL_OWNER command is missing shipId, recordId, or currentOwner");
    }
    if (!command.actor) {
      throw new Error("NOTIFY_APPROVAL_OWNER command is missing actor");
    }

    if (!canManageApprovalRecord(command.actor, command, null)) {
      logger.warn("rbac_rejected_action", {
        actionType: command.type,
        status: command.actor,
      });
      throw new Error("Actor is not authorized to notify approval owners");
    }

    const record = store.getApprovalRecordInShip(command.recordId, command.shipId);
    if (!record) {
      logger.warn("ship_context_rejected_action", {
        actionType: command.type,
        status: command.shipId,
      });
      throw new Error("Approval record does not exist in the provided ship context");
    }

    const notificationType = command.notificationType ?? "APPROVAL_PENDING";
    const message =
      notificationType === "APPROVAL_STALE"
        ? `Approval record is awaiting your action: ${record.title}`
        : record.approval.status === "REJECTED"
          ? `Approval record returned to ${command.currentOwner}: ${record.title}`
          : record.approval.status === "APPROVED"
            ? `Approval record finally approved: ${record.title}`
            : `Approval action pending for ${command.currentOwner}: ${record.title}`;

    if (notificationType === "APPROVAL_STALE") {
      store.recordApprovalStaleNotification(
        command.recordId,
        command.shipId,
        command.issuedAt,
        command.actor,
      );
    }

    store.createNotification({
      type: notificationType,
      shipId: command.shipId,
      taskId: null,
      recordId: command.recordId,
      message,
      targetRole: command.currentOwner,
      timestamp: command.issuedAt,
    });
  }
}
