"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubmitApprovalRecordAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class SubmitApprovalRecordAction {
    execute(command, store) {
        if (!command.shipId || !command.recordId) {
            throw new Error("SUBMIT_APPROVAL_RECORD command is missing shipId or recordId");
        }
        if (!command.actor) {
            throw new Error("SUBMIT_APPROVAL_RECORD command is missing actor");
        }
        const record = store.getApprovalRecordInShip(command.recordId, command.shipId);
        if (!record) {
            logger_1.logger.warn("ship_context_rejected_action", {
                actionType: command.type,
                status: command.shipId,
            });
            throw new Error("Approval record does not exist in the provided ship context");
        }
        if (!(0, rbac_1.canManageApprovalRecord)(command.actor, command, record)) {
            store.recordApprovalInvalidAttempt(command.recordId, command.shipId, command.issuedAt, command.actor, command.transitionId ?? null, "Actor is not authorized to submit this approval record", command.note ?? null);
            logger_1.logger.warn("rbac_rejected_action", {
                actionType: command.type,
                status: command.actor,
            });
            throw new Error("Actor is not authorized to submit approval records");
        }
        store.submitApprovalRecord(command.recordId, command.shipId, command.issuedAt, command.actor, command.transitionId ?? `${command.type}:${command.recordId}:${command.issuedAt}`, command.reason ?? null, command.note ?? null);
    }
}
exports.SubmitApprovalRecordAction = SubmitApprovalRecordAction;
//# sourceMappingURL=submit-approval-record.action.js.map