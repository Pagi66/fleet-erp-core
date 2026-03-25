"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateApprovalRecordAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
const APPROVAL_CHAIN_BY_ORIGIN = {
    MARINE_ENGINEERING_OFFICER: [
        "MARINE_ENGINEERING_OFFICER",
        "COMMANDING_OFFICER",
        "FLEET_SUPPORT_GROUP",
        "LOGISTICS_COMMAND",
    ],
    WEAPON_ELECTRICAL_OFFICER: [
        "WEAPON_ELECTRICAL_OFFICER",
        "COMMANDING_OFFICER",
        "FLEET_SUPPORT_GROUP",
        "LOGISTICS_COMMAND",
    ],
    COMMANDING_OFFICER: [
        "COMMANDING_OFFICER",
        "FLEET_SUPPORT_GROUP",
        "LOGISTICS_COMMAND",
    ],
    FLEET_SUPPORT_GROUP: [
        "FLEET_SUPPORT_GROUP",
        "LOGISTICS_COMMAND",
    ],
    LOGISTICS_COMMAND: [
        "LOGISTICS_COMMAND",
        "LOGISTICS_COMMAND",
    ],
};
class CreateApprovalRecordAction {
    execute(command, store) {
        if (!command.shipId || !command.recordId || !command.recordKind || !command.recordTitle || !command.originRole) {
            throw new Error("CREATE_APPROVAL_RECORD command is missing required record fields");
        }
        if (!command.actor) {
            throw new Error("CREATE_APPROVAL_RECORD command is missing actor");
        }
        if (store.getApprovalRecordInShip(command.recordId, command.shipId)) {
            return;
        }
        if (!(0, rbac_1.canManageApprovalRecord)(command.actor, command, null)) {
            logger_1.logger.warn("rbac_rejected_action", {
                actionType: command.type,
                status: command.actor,
            });
            throw new Error("Actor is not authorized to create approval records");
        }
        const chain = APPROVAL_CHAIN_BY_ORIGIN[command.originRole];
        const record = {
            id: command.recordId,
            shipId: command.shipId,
            kind: command.recordKind,
            title: command.recordTitle,
            description: command.description ?? null,
            businessDate: command.businessDate,
            createdAt: command.issuedAt,
            originRole: command.originRole,
            visibleTo: [...chain],
            approval: {
                chain,
                currentStepIndex: 0,
                approvalLevel: 0,
                currentOwner: command.originRole,
                status: "DRAFT",
                submittedAt: null,
                approvedAt: null,
                rejectedAt: null,
                lastActionBy: command.actor,
                lastActionAt: command.issuedAt,
                lastActionReason: command.reason ?? null,
                lastActionNote: command.note ?? null,
                lastStaleNotificationAt: null,
                version: 1,
            },
        };
        store.createApprovalRecord(record, command.issuedAt, command.actor);
    }
}
exports.CreateApprovalRecordAction = CreateApprovalRecordAction;
//# sourceMappingURL=create-approval-record.action.js.map