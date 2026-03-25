"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditApprovalInvalidAttemptAction = void 0;
class AuditApprovalInvalidAttemptAction {
    execute(command, store) {
        if (!command.shipId || !command.recordId || !command.actor || !command.reason) {
            throw new Error("AUDIT_APPROVAL_INVALID_ATTEMPT command is missing required fields");
        }
        store.recordApprovalInvalidAttempt(command.recordId, command.shipId, command.issuedAt, command.actor, command.transitionId ?? null, command.reason, command.note ?? null);
    }
}
exports.AuditApprovalInvalidAttemptAction = AuditApprovalInvalidAttemptAction;
//# sourceMappingURL=audit-approval-invalid-attempt.action.js.map