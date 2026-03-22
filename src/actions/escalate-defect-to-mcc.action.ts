import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class EscalateDefectToMccAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("ESCALATE_DEFECT_TO_MCC command is missing taskId");
    }
    const task = store.getTask(command.taskId);
    if (!task || task.escalationLevel !== "NONE") {
      return;
    }

    store.escalateTask(command.taskId, "MCC", command.issuedAt);
  }
}
