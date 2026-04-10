"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreatePmsTaskAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class CreatePmsTaskAction {
    execute(command, store) {
        if (!command.shipId || !command.taskId || !command.taskTitle || !command.dueDate || !command.assignedRole) {
            throw new Error("CREATE_PMS_TASK command is missing required task fields");
        }
        if (!command.actor) {
            throw new Error("CREATE_PMS_TASK command is missing actor");
        }
        const actor = command.actor;
        if (!(0, rbac_1.canExecuteAction)(actor, command, null)) {
            logger_1.logger.warn("rbac_rejected_action", {
                taskId: command.taskId,
                actionType: command.type,
                status: actor,
            });
            throw new Error("Actor is not authorized to create PMS tasks");
        }
        if (store.getTaskInShip(command.taskId, command.shipId)) {
            return;
        }
        const task = {
            id: command.taskId,
            shipId: command.shipId,
            parentTaskId: command.parentTaskId ?? null,
            kind: "PMS",
            title: command.taskTitle,
            mic: "UNSPECIFIED-MIC",
            iss: "0000",
            equipment: command.taskTitle,
            cycleCode: "D",
            scheduleSource: "CYCLE",
            businessDate: command.businessDate,
            dueDate: command.dueDate,
            assignedRole: command.assignedRole,
            status: "PENDING",
            executionStatus: "PENDING",
            completedAt: null,
            verificationBy: null,
            verificationAt: null,
            lastCheckedAt: null,
            lastOverdueAt: null,
            replannedFromDueDate: null,
            replannedToDueDate: null,
            lastNotifiedAt: null,
            nextDueAt: Date.parse(command.dueDate),
            ettrDays: null,
            severity: null,
            escalationLevel: "NONE",
            escalatedAt: null,
            sectionVerifiedBy: null,
            sectionVerifiedAt: null,
            departmentVerifiedBy: null,
            departmentVerifiedAt: null,
        };
        store.createTask(task, command.issuedAt, actor);
    }
}
exports.CreatePmsTaskAction = CreatePmsTaskAction;
//# sourceMappingURL=create-pms-task.action.js.map