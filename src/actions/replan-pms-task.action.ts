import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class ReplanPmsTaskAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.taskId) {
      throw new Error("REPLAN_PMS_TASK command is missing shipId or taskId");
    }
    if (!command.actor) {
      throw new Error("REPLAN_PMS_TASK command is missing actor");
    }
    const actor = command.actor;

    const task = store.getTaskInShip(command.taskId, command.shipId);
    if (!task) {
      logger.warn("ship_context_rejected_action", {
        taskId: command.taskId,
        actionType: command.type,
        status: command.shipId,
      });
      throw new Error(`Task not found in ship context: ${command.taskId}`);
    }
    if (!canExecuteAction(actor, command, task)) {
      logger.warn("rbac_rejected_action", {
        taskId: command.taskId,
        actionType: command.type,
        status: actor,
      });
      throw new Error("Actor is not authorized to replan PMS tasks");
    }

    const nextDueDate = addOneDay(task.dueDate);
    if (task.dueDate === nextDueDate) {
      return;
    }

    store.replanTask(command.taskId, nextDueDate, command.issuedAt, actor);
  }
}

function addOneDay(isoDate: string): string {
  const next = new Date(isoDate);
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}
