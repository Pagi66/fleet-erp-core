import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class NotifyMeoAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
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

    store.updateComplianceState(command.businessDate, {
      meoNotifiedAt: command.issuedAt,
    });
  }
}
