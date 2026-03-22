import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class NotifyPmsSupervisorAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("NOTIFY_PMS_SUPERVISOR command is missing taskId");
    }
    const task = store.getTask(command.taskId);
    if (!task) {
      return;
    }
    if (
      task.lastNotifiedAt !== null &&
      (task.lastOverdueAt === null || task.lastNotifiedAt >= task.lastOverdueAt)
    ) {
      return;
    }

    store.recordTaskNotification(command.taskId, command.issuedAt);
  }
}
