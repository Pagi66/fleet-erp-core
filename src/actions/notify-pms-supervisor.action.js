"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotifyPmsSupervisorAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class NotifyPmsSupervisorAction {
    execute(command, store) {
        if (!command.shipId || !command.taskId) {
            throw new Error("NOTIFY_PMS_SUPERVISOR command is missing shipId or taskId");
        }
        if (!command.actor) {
            throw new Error("NOTIFY_PMS_SUPERVISOR command is missing actor");
        }
        const actor = command.actor;
        const task = store.getTaskInShip(command.taskId, command.shipId);
        if (!task) {
            logger_1.logger.warn("ship_context_rejected_action", {
                taskId: command.taskId,
                actionType: command.type,
                status: command.shipId,
            });
            throw new Error("Task does not exist in the provided ship context");
        }
        if (task.lastNotifiedAt !== null &&
            (task.lastOverdueAt === null || task.lastNotifiedAt >= task.lastOverdueAt)) {
            return;
        }
        if (!(0, rbac_1.canExecuteAction)(actor, command, task)) {
            logger_1.logger.warn("rbac_rejected_action", {
                taskId: command.taskId,
                actionType: command.type,
                status: actor,
            });
            throw new Error("Actor is not authorized to notify on PMS tasks");
        }
        store.recordTaskNotification(command.taskId, command.issuedAt, actor);
    }
}
exports.NotifyPmsSupervisorAction = NotifyPmsSupervisorAction;
//# sourceMappingURL=notify-pms-supervisor.action.js.map