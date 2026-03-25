"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefectReportedEvent = createDefectReportedEvent;
exports.createDefectEvaluationEvent = createDefectEvaluationEvent;
function createDefectReportedEvent(shipId, taskId, taskTitle, businessDate, ettrDays, severity, occurredAt) {
    return {
        type: "DEFECT_REPORTED",
        businessDate,
        occurredAt,
        shipId,
        taskId,
        taskTitle,
        taskKind: "DEFECT",
        ettrDays,
        severity,
    };
}
function createDefectEvaluationEvent(shipId, taskId, businessDate, occurredAt) {
    return {
        type: "DEFECT_EVALUATION",
        businessDate,
        occurredAt,
        shipId,
        taskId,
        taskKind: "DEFECT",
    };
}
//# sourceMappingURL=defect-events.js.map