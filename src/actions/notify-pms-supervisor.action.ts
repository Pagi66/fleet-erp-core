import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class NotifyPmsSupervisorAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("NOTIFY_PMS_SUPERVISOR command is missing taskId");
    }

    store.recordTaskNotification(command.taskId, command.issuedAt);
  }
}
