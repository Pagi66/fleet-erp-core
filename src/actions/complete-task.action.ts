import { logger } from "../core/logger";
import { canCompleteTask } from "../core/rbac";
import { InMemoryStore } from "../core/store";
import { RoleId } from "../core/types";

export class CompleteTaskAction {
  execute(taskId: string, actor: RoleId, store: InMemoryStore) {
    const task = store.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (!canCompleteTask(actor, task)) {
      logger.warn("rbac_rejected_action", {
        taskId,
        actionType: "COMPLETE_TASK",
        status: actor,
      });
      throw new Error("Actor is not authorized to complete this task");
    }

    const completed = store.completeTask(taskId, new Date().toISOString(), actor);
    store.createNotification({
      type: "TASK_COMPLETED",
      shipId: completed.shipId,
      taskId: completed.id,
      message: `Task completed: ${completed.title}`,
      targetRole: completed.assignedRole,
      timestamp: completed.completedAt ?? new Date().toISOString(),
    });
    return completed;
  }
}
