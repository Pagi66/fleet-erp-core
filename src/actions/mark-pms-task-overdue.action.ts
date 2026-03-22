import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class MarkPmsTaskOverdueAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("MARK_PMS_TASK_OVERDUE command is missing taskId");
    }

    store.updateTask(command.taskId, {
      status: "OVERDUE",
      lastCheckedAt: command.issuedAt,
      lastOverdueAt: command.issuedAt,
    });
  }
}
