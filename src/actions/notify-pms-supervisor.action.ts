import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class NotifyPmsSupervisorAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.taskId) {
      throw new Error("NOTIFY_PMS_SUPERVISOR command is missing shipId or taskId");
    }
    if (!command.actor) {
      throw new Error("NOTIFY_PMS_SUPERVISOR command is missing actor");
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
    if (
      task.lastNotifiedAt !== null &&
      (task.lastOverdueAt === null || task.lastNotifiedAt >= task.lastOverdueAt)
    ) {
      return;
    }
    if (!canExecuteAction(actor, command, task)) {
      logger.warn("rbac_rejected_action", {
        taskId: command.taskId,
        actionType: command.type,
        status: actor,
      });
      throw new Error("Actor is not authorized to notify on PMS tasks");
    }

    store.recordTaskNotification(command.taskId, command.issuedAt, actor);
  }
}
