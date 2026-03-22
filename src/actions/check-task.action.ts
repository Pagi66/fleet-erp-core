import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class CheckTaskAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("CHECK_TASK command is missing taskId");
    }

    store.recordTaskCheck(command.taskId, command.issuedAt);
  }
}
