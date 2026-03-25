"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotifyMeoAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class NotifyMeoAction {
    execute(command, store) {
        if (!command.shipId) {
            throw new Error("NOTIFY_MEO command is missing shipId");
        }
        if (!command.actor) {
            throw new Error("NOTIFY_MEO command is missing actor");
        }
        if (!(0, rbac_1.canExecuteAction)(command.actor, command, null)) {
            logger_1.logger.warn("rbac_rejected_action", {
                actionType: command.type,
                status: command.actor,
            });
            throw new Error("Actor is not authorized to notify MEO");
        }
        const currentState = store.getOrCreateComplianceState(command.shipId, command.businessDate);
        if (currentState.meoNotifiedAt !== null) {
            return;
        }
        store.updateComplianceState(command.shipId, command.businessDate, {
            meoNotifiedAt: command.issuedAt,
        });
        store.createNotification({
            type: "MISSING_DAILY_LOG",
            shipId: command.shipId,
            taskId: null,
            message: `Missing daily logs for ${command.businessDate}`,
            targetRole: "MARINE_ENGINEERING_OFFICER",
            timestamp: command.issuedAt,
        });
    }
}
exports.NotifyMeoAction = NotifyMeoAction;
//# sourceMappingURL=notify-meo.action.js.map