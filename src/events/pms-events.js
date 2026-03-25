"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPmsTaskGenerateEvent = createPmsTaskGenerateEvent;
exports.createPmsTaskCheckEvent = createPmsTaskCheckEvent;
function createPmsTaskGenerateEvent(shipId, taskId, taskTitle, businessDate, dueDate, assignedRole, occurredAt) {
    return {
        type: "PMS_TASK_GENERATE",
        businessDate,
        occurredAt,
        shipId,
        taskId,
        taskTitle,
        dueDate,
        assignedRole,
    };
}
function createPmsTaskCheckEvent(shipId, taskId, businessDate, occurredAt) {
    return {
        type: "PMS_TASK_CHECK",
        businessDate,
        occurredAt,
        shipId,
        taskId,
    };
}
//# sourceMappingURL=pms-events.js.map