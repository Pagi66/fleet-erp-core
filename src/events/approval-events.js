"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApprovalRecordCreateEvent = createApprovalRecordCreateEvent;
exports.createApprovalTransitionEvent = createApprovalTransitionEvent;
exports.createApprovalStaleCheckEvent = createApprovalStaleCheckEvent;
function createApprovalRecordCreateEvent(shipId, recordId, recordKind, recordTitle, businessDate, occurredAt, actor, description) {
    return {
        type: "APPROVAL_RECORD_CREATE",
        shipId,
        recordId,
        recordKind,
        recordTitle,
        businessDate,
        occurredAt,
        actor,
        ...(typeof description === "string" ? { description } : {}),
    };
}
function createApprovalTransitionEvent(type, shipId, recordId, businessDate, occurredAt, actor, transitionId, reason, note) {
    return {
        type,
        shipId,
        recordId,
        businessDate,
        occurredAt,
        actor,
        ...(typeof transitionId === "string" ? { transitionId } : {}),
        ...(typeof reason === "string" ? { reason } : {}),
        ...(typeof note === "string" ? { note } : {}),
    };
}
function createApprovalStaleCheckEvent(shipId, businessDate, occurredAt, staleThresholdHours) {
    return {
        type: "APPROVAL_RECORD_STALE_CHECK",
        shipId,
        businessDate,
        occurredAt,
        staleThresholdHours,
    };
}
//# sourceMappingURL=approval-events.js.map