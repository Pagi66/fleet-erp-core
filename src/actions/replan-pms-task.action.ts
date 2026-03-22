import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class ReplanPmsTaskAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId) {
      throw new Error("REPLAN_PMS_TASK command is missing taskId");
    }

    const task = store.getTask(command.taskId);
    if (!task) {
      throw new Error(`Task not found: ${command.taskId}`);
    }

    const nextDueDate = addOneDay(task.dueDate);
    if (task.dueDate === nextDueDate) {
      return;
    }

    store.replanTask(command.taskId, nextDueDate, command.issuedAt);
  }
}

function addOneDay(isoDate: string): string {
  const next = new Date(isoDate);
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}
