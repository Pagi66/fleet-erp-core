"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequiredFields = validateRequiredFields;
exports.checkDuplicates = checkDuplicates;
exports.validateState = validateState;
exports.runInputGuard = runInputGuard;
const REQUIRED_FIELDS = {
    CREATE_DEFECT: ["id", "shipId", "title"],
    COMPLETE_PMS_TASK: ["taskId"],
};
function validateRequiredFields(event) {
    const requiredFields = REQUIRED_FIELDS[event.type];
    for (const field of requiredFields) {
        const value = event[field];
        if (typeof value !== "string" || value.trim() === "") {
            return failure(`${event.type} is missing required field: ${field}`);
        }
    }
    return success();
}
function checkDuplicates(event, state) {
    switch (event.type) {
        case "CREATE_DEFECT":
            return checkDuplicateDefect(event, state);
        case "COMPLETE_PMS_TASK":
            return success();
        default:
            return assertNever(event);
    }
}
function validateState(event, state) {
    switch (event.type) {
        case "CREATE_DEFECT":
            return success();
        case "COMPLETE_PMS_TASK":
            return validateCompletePmsTaskState(event, state);
        default:
            return assertNever(event);
    }
}
function runInputGuard(event, state) {
    const requiredFieldsResult = validateRequiredFields(event);
    if (!requiredFieldsResult.ok) {
        return requiredFieldsResult;
    }
    const duplicateResult = checkDuplicates(event, state);
    if (!duplicateResult.ok) {
        return duplicateResult;
    }
    return validateState(event, state);
}
function checkDuplicateDefect(event, state) {
    const shipId = event.shipId?.trim();
    const normalizedTitle = normalizeTitle(event.title);
    if (!shipId || !normalizedTitle) {
        return success();
    }
    const duplicate = state.defects.find((defect) => defect.shipId === shipId &&
        normalizeTitle(defect.title) === normalizedTitle &&
        isActiveDefectStatus(defect.status));
    if (!duplicate) {
        return success();
    }
    return failure(`CREATE_DEFECT rejected: active defect already exists for ship ${shipId} with title "${duplicate.title}"`);
}
function validateCompletePmsTaskState(event, state) {
    const taskId = event.taskId?.trim();
    if (!taskId) {
        return success();
    }
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task) {
        return failure(`COMPLETE_PMS_TASK rejected: task not found: ${taskId}`);
    }
    if (isCompletedTaskStatus(task.status)) {
        return failure(`COMPLETE_PMS_TASK rejected: task ${taskId} is already completed`);
    }
    return success();
}
function isActiveDefectStatus(status) {
    const normalized = status.trim().toUpperCase();
    return !(normalized === "COMPLETED" ||
        normalized === "CLOSED" ||
        normalized === "RESOLVED" ||
        normalized === "CANCELLED");
}
function isCompletedTaskStatus(status) {
    return status.trim().toUpperCase() === "COMPLETED";
}
function normalizeTitle(title) {
    return typeof title === "string"
        ? title.trim().replace(/\s+/g, " ").toUpperCase()
        : "";
}
function success() {
    return { ok: true };
}
function failure(reason) {
    return { ok: false, reason };
}
function assertNever(value) {
    throw new Error(`Unhandled input-guard event: ${JSON.stringify(value)}`);
}
//# sourceMappingURL=input-guard.js.map