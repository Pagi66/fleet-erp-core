"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarkComplianceAction = void 0;
const types_1 = require("../core/types");
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class MarkComplianceAction {
    execute(command, store) {
        if (!command.shipId) {
            throw new Error("MARK_COMPLIANT/MARK_NON_COMPLIANT command is missing shipId");
        }
        if (!command.actor) {
            throw new Error("MARK_COMPLIANT/MARK_NON_COMPLIANT command is missing actor");
        }
        if (!(0, rbac_1.canExecuteAction)(command.actor, command, null)) {
            logger_1.logger.warn("rbac_rejected_action", {
                actionType: command.type,
                status: command.actor,
            });
            throw new Error("Actor is not authorized to update compliance state");
        }
        const currentState = store.getOrCreateComplianceState(command.shipId, command.businessDate);
        const logs = store.getLogsForDate(command.shipId, command.businessDate);
        const presentLogs = logs.map((log) => log.logType);
        const missingLogs = types_1.REQUIRED_DAILY_LOGS.filter((logType) => !presentLogs.includes(logType));
        const nextStatus = command.type === "MARK_COMPLIANT" ? "COMPLIANT" : "NON_COMPLIANT";
        const sameState = currentState.status === nextStatus &&
            currentState.lastEvaluatedAt === command.issuedAt &&
            currentState.presentLogs.length === presentLogs.length &&
            currentState.presentLogs.every((logType) => presentLogs.includes(logType)) &&
            currentState.missingLogs.length === missingLogs.length &&
            currentState.missingLogs.every((logType) => missingLogs.includes(logType));
        if (sameState) {
            return;
        }
        store.updateComplianceState(command.shipId, command.businessDate, {
            presentLogs,
            missingLogs,
            status: nextStatus,
            lastEvaluatedAt: command.issuedAt,
        });
    }
}
exports.MarkComplianceAction = MarkComplianceAction;
//# sourceMappingURL=mark-compliance.action.js.map