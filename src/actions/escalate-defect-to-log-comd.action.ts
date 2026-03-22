import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class EscalateDefectToLogComdAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("ESCALATE_DEFECT_TO_LOG_COMD command is missing taskId");
    }
    const task = store.getTask(command.taskId);
    if (!task || task.escalationLevel === "LOG_COMD") {
      return;
    }

    store.escalateTask(command.taskId, "LOG_COMD", command.issuedAt);
  }
}
