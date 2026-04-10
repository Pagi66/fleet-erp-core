"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompleteTaskAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class CompleteTaskAction {
    execute(taskId, actor, store) {
        const task = store.getTask(taskId);
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }
        if (task.departmentVerifiedBy && !task.sectionVerifiedBy) {
            throw new Error("Department verification requires prior section verification");
        }
        if (task.departmentVerifiedAt && !task.sectionVerifiedAt) {
            throw new Error("Department verification timestamp requires prior section verification");
        }
        if (!(0, rbac_1.canCompleteTask)(actor, task)) {
            logger_1.logger.warn("rbac_rejected_action", {
                taskId,
                actionType: "COMPLETE_TASK",
                status: actor,
            });
            throw new Error("Actor is not authorized to complete this task");
        }
        const completedAt = new Date().toISOString();
        const completed = store.completeTask(taskId, completedAt, actor);
        store.createNotification({
            type: "TASK_COMPLETED",
            shipId: completed.shipId,
            taskId: completed.id,
            message: `Task completed: ${completed.title}`,
            targetRole: completed.assignedRole,
            timestamp: completed.completedAt ?? completedAt,
        });
        if (completed.defectId) {
            const linkedTasks = store.getTasksByDefectId(completed.defectId);
            const allCorrectiveTasksComplete = linkedTasks.every((linkedTask) => linkedTask.status === "COMPLETED");
            if (allCorrectiveTasksComplete) {
                store.updateDefectStatus(completed.defectId, "RESOLVED");
            }
        }
        return completed;
    }
}
exports.CompleteTaskAction = CompleteTaskAction;
//# sourceMappingURL=complete-task.action.js.map