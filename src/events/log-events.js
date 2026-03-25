"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDailyLogCheckDueEvent = createDailyLogCheckDueEvent;
exports.createDailyLogEscalationDueEvent = createDailyLogEscalationDueEvent;
function createDailyLogCheckDueEvent(businessDate, occurredAt) {
    return {
        type: "DAILY_LOG_CHECK_DUE",
        businessDate,
        occurredAt,
    };
}
function createDailyLogEscalationDueEvent(businessDate, occurredAt) {
    return {
        type: "DAILY_LOG_ESCALATION_DUE",
        businessDate,
        occurredAt,
    };
}
//# sourceMappingURL=log-events.js.map