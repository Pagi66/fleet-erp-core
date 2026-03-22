import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class NotifyPmsSupervisorAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("NOTIFY_PMS_SUPERVISOR command is missing taskId");
    }

    store.updateTask(command.taskId, {
      lastNotifiedAt: command.issuedAt,
    });
  }
}
