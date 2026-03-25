"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateDefectTaskAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class CreateDefectTaskAction {
    execute(command, store) {
        if (!command.shipId || !command.taskId || !command.taskTitle || !command.assignedRole) {
            throw new Error("CREATE_DEFECT_TASK command is missing required task fields");
        }
        if (!command.actor) {
            throw new Error("CREATE_DEFECT_TASK command is missing actor");
        }
        const actor = command.actor;
        if (!(0, rbac_1.canExecuteAction)(actor, command, null)) {
            logger_1.logger.warn("rbac_rejected_action", {
                taskId: command.taskId,
                actionType: command.type,
                status: actor,
            });
            throw new Error("Actor is not authorized to create defect tasks");
        }
        if (store.getTaskInShip(command.taskId, command.shipId)) {
            return;
        }
        const task = {
            id: command.taskId,
            shipId: command.shipId,
            parentTaskId: command.parentTaskId ?? null,
            kind: "DEFECT",
            title: command.taskTitle,
            businessDate: command.businessDate,
            dueDate: command.businessDate,
            assignedRole: command.assignedRole,
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
        store.createTask(task, command.issuedAt, actor);
    }
}
exports.CreateDefectTaskAction = CreateDefectTaskAction;
//# sourceMappingURL=create-defect-task.action.js.map