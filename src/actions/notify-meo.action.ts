import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class NotifyMeoAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId) {
      throw new Error("NOTIFY_MEO command is missing shipId");
    }
    if (!command.actor) {
      throw new Error("NOTIFY_MEO command is missing actor");
    }
    if (!canExecuteAction(command.actor, command, null)) {
      logger.warn("rbac_rejected_action", {
        actionType: command.type,
        status: command.actor,
      });
      throw new Error("Actor is not authorized to notify MEO");
    }

    const currentState = store.getOrCreateComplianceState(
      command.shipId,
      command.businessDate,
    );
    if (currentState.meoNotifiedAt !== null) {
      return;
    }

    store.updateComplianceState(command.shipId, command.businessDate, {
      meoNotifiedAt: command.issuedAt,
    });
    store.createNotification({
      type: "MISSING_DAILY_LOG",
      shipId: command.shipId,
      taskId: null,
      message: `Missing daily logs for ${command.businessDate}`,
      targetRole: "MARINE_ENGINEERING_OFFICER",
      timestamp: command.issuedAt,
    });
  }
}
