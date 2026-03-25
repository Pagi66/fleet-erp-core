"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EscalateDefectToMccAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class EscalateDefectToMccAction {
    execute(command, store) {
        if (!command.shipId || !command.taskId) {
            throw new Error("ESCALATE_DEFECT_TO_MCC command is missing shipId or taskId");
        }
        if (!command.actor) {
            throw new Error("ESCALATE_DEFECT_TO_MCC command is missing actor");
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
        if (task.escalationLevel !== "NONE") {
            return;
        }
        if (!(0, rbac_1.canExecuteAction)(actor, command, task)) {
            logger_1.logger.warn("rbac_rejected_action", {
                taskId: command.taskId,
                actionType: command.type,
                status: actor,
            });
            throw new Error("Actor is not authorized to escalate defect to FLEET_SUPPORT_GROUP");
        }
        store.escalateTask(command.taskId, "MCC", command.issuedAt, actor);
        store.createNotification({
            type: "ESCALATION",
            shipId: command.shipId,
            taskId: command.taskId,
            message: `Defect escalated to FLEET_SUPPORT_GROUP: ${task.title}`,
            targetRole: "FLEET_SUPPORT_GROUP",
            timestamp: command.issuedAt,
        });
    }
}
exports.EscalateDefectToMccAction = EscalateDefectToMccAction;
//# sourceMappingURL=escalate-defect-to-mcc.action.js.map