import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class EscalateDefectToMccAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("ESCALATE_DEFECT_TO_MCC command is missing taskId");
    }
    if (!command.actor) {
      throw new Error("ESCALATE_DEFECT_TO_MCC command is missing actor");
    }
    const actor = command.actor;
    const task = store.getTask(command.taskId);
    if (!task || task.escalationLevel !== "NONE") {
      return;
    }
    if (!canExecuteAction(actor, command, task)) {
      logger.warn("rbac_rejected_action", {
        taskId: command.taskId,
        actionType: command.type,
        status: actor,
      });
      throw new Error("Actor is not authorized to escalate defect to FLEET_SUPPORT_GROUP");
    }

    store.escalateTask(command.taskId, "MCC", command.issuedAt, actor);
  }
}
