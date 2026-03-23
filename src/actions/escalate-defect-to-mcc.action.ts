import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class EscalateDefectToMccAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.taskId) {
      throw new Error("ESCALATE_DEFECT_TO_MCC command is missing shipId or taskId");
    }
    if (!command.actor) {
      throw new Error("ESCALATE_DEFECT_TO_MCC command is missing actor");
    }
    const actor = command.actor;
    const task = store.getTaskInShip(command.taskId, command.shipId);
    if (!task) {
      logger.warn("ship_context_rejected_action", {
        taskId: command.taskId,
        actionType: command.type,
        status: command.shipId,
      });
      throw new Error("Task does not exist in the provided ship context");
    }
    if (task.escalationLevel !== "NONE") {
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
    store.createNotification({
      type: "ESCALATION",
      shipId: command.shipId,
      taskId: command.taskId,
      message: `Defect escalated to FLEET_SUPPORT_GROUP: ${task.title}`,
      targetRole: "FLEET_SUPPORT_GROUP",
      timestamp: command.issuedAt,
    });
  }
}
