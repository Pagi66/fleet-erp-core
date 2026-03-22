import { InMemoryStore } from "../core/store";
import { ActionCommand, Task } from "../core/types";

export class CreatePmsTaskAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId || !command.taskTitle || !command.dueDate || !command.assignedRole) {
      throw new Error("CREATE_PMS_TASK command is missing required task fields");
    }

    const task: Task = {
      id: command.taskId,
      kind: "PMS",
      title: command.taskTitle,
      businessDate: command.businessDate,
      dueDate: command.dueDate,
      assignedRole: command.assignedRole,
      status: "PENDING",
      completedAt: null,
      lastCheckedAt: null,
      lastOverdueAt: null,
      replannedFromDueDate: null,
      replannedToDueDate: null,
      lastNotifiedAt: null,
    };

    store.saveTask(task);
  }
}
