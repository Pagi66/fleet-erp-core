import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class MarkPmsTaskOverdueAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("MARK_PMS_TASK_OVERDUE command is missing taskId");
    }
    if (!command.actor) {
      throw new Error("MARK_PMS_TASK_OVERDUE command is missing actor");
    }
    const actor = command.actor;
    const task = store.getTask(command.taskId);
    if (!task || task.status !== "PENDING") {
      return;
    }
    if (!canExecuteAction(actor, command, task)) {
      logger.warn("rbac_rejected_action", {
        taskId: command.taskId,
        actionType: command.type,
        status: actor,
      });
      throw new Error("Actor is not authorized to mark PMS tasks overdue");
    }

    store.markTaskOverdue(command.taskId, command.issuedAt, actor);
  }
}
