import { InMemoryStore } from "../core/store";
import { ActionCommand, Task } from "../core/types";

export class CreateDefectTaskAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.taskId || !command.taskTitle) {
      throw new Error("CREATE_DEFECT_TASK command is missing required task fields");
    }
    if (store.getTask(command.taskId)) {
      return;
    }

    const task: Task = {
      id: command.taskId,
      kind: "DEFECT",
      title: command.taskTitle,
      businessDate: command.businessDate,
      dueDate: command.businessDate,
      assignedRole: command.assignedRole ?? "MEO",
      status: "PENDING",
      completedAt: null,
      lastCheckedAt: null,
      lastOverdueAt: null,
      replannedFromDueDate: null,
      replannedToDueDate: null,
      lastNotifiedAt: null,
      ettrDays: command.ettrDays ?? null,
      severity: command.severity ?? "ROUTINE",
      escalationLevel: "NONE",
      escalatedAt: null,
    };

    store.createTask(task);
  }
}
