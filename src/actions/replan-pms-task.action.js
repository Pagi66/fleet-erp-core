"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplanPmsTaskAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class ReplanPmsTaskAction {
    execute(command, store) {
        if (!command.shipId || !command.taskId) {
            throw new Error("REPLAN_PMS_TASK command is missing shipId or taskId");
        }
        if (!command.actor) {
            throw new Error("REPLAN_PMS_TASK command is missing actor");
        }
        const actor = command.actor;
        const task = store.getTaskInShip(command.taskId, command.shipId);
        if (!task) {
            logger_1.logger.warn("ship_context_rejected_action", {
                taskId: command.taskId,
                actionType: command.type,
                status: command.shipId,
            });
            throw new Error(`Task not found in ship context: ${command.taskId}`);
        }
        if (!(0, rbac_1.canExecuteAction)(actor, command, task)) {
            logger_1.logger.warn("rbac_rejected_action", {
                taskId: command.taskId,
                actionType: command.type,
                status: actor,
            });
            throw new Error("Actor is not authorized to replan PMS tasks");
        }
        const nextDueDate = addOneDay(task.dueDate);
        if (task.dueDate === nextDueDate) {
            return;
        }
        store.replanTask(command.taskId, nextDueDate, command.issuedAt, actor);
    }
}
exports.ReplanPmsTaskAction = ReplanPmsTaskAction;
function addOneDay(isoDate) {
    const next = new Date(isoDate);
    next.setDate(next.getDate() + 1);
    return next.toISOString();
}
//# sourceMappingURL=replan-pms-task.action.js.map