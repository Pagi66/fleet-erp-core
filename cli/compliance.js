"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComplianceStatus = getComplianceStatus;
exports.getTodayEngineRoomRegisterStatus = getTodayEngineRoomRegisterStatus;
exports.getWeeklyReturnStatus = getWeeklyReturnStatus;
exports.getMonthlyReturnStatus = getMonthlyReturnStatus;
exports.countOverdueOperationalItems = countOverdueOperationalItems;
function getComplianceStatus(input) {
    const dueAtMs = input.dueAt ? new Date(input.dueAt).getTime() : NaN;
    const nowMs = new Date(input.now).getTime();
    if (input.completedAt) {
        return {
            label: "OK",
            priority: 0,
            dueAt: input.dueAt,
            hoursUntilDue: Number.isNaN(dueAtMs) ? null : Math.floor((dueAtMs - nowMs) / 3600000),
        };
    }
    if (Number.isNaN(dueAtMs)) {
        return {
            label: "OK",
            priority: 0,
            dueAt: null,
            hoursUntilDue: null,
        };
    }
    const hoursUntilDue = Math.floor((dueAtMs - nowMs) / 3600000);
    if (hoursUntilDue < 0) {
        return {
            label: "OVERDUE",
            priority: 2,
            dueAt: input.dueAt,
            hoursUntilDue,
        };
    }
    if (hoursUntilDue <= 24) {
        return {
            label: "DUE",
            priority: 1,
            dueAt: input.dueAt,
            hoursUntilDue,
        };
    }
    return {
        label: "OK",
        priority: 0,
        dueAt: input.dueAt,
        hoursUntilDue,
    };
}
function getTodayEngineRoomRegisterStatus(input) {
    const engineRoomRegisterPresent = !input.complianceState.missingLogs.includes("ENGINE_ROOM_REGISTER");
    const completedAt = engineRoomRegisterPresent
        ? input.records
            .filter((record) => record.kind === "MAINTENANCE_LOG")
            .map((record) => record.createdAt)
            .sort()[0] ?? input.now
        : null;
    return getComplianceStatus({
        dueAt: endOfDayIso(input.now),
        completedAt,
        now: input.now,
    });
}
function getWeeklyReturnStatus(now) {
    return getComplianceStatus({
        dueAt: getUpcomingWeekBoundary(now, 5, 16),
        now,
    });
}
function getMonthlyReturnStatus(now) {
    return getComplianceStatus({
        dueAt: getMonthBoundary(now, 16),
        now,
    });
}
function countOverdueOperationalItems(input) {
    let count = 0;
    count += input.tasks.filter((task) => task.status === "OVERDUE").length;
    count += input.awarenessRecords.filter((record) => record.computed.isPendingTooLong || record.computed.isStale).length;
    count += Number(input.weeklyStatus.label === "OVERDUE");
    count += Number(input.monthlyStatus.label === "OVERDUE");
    count += Number(input.engineRoomRegisterStatus.label === "OVERDUE");
    return count;
}
function endOfDayIso(now) {
    const date = new Date(now);
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
}
function getUpcomingWeekBoundary(now, dueDay, dueHour) {
    const date = new Date(now);
    const currentDay = date.getDay();
    const normalizedDueDay = dueDay % 7;
    let deltaDays = normalizedDueDay - currentDay;
    if (deltaDays < 0) {
        deltaDays += 7;
    }
    date.setDate(date.getDate() + deltaDays);
    date.setHours(dueHour, 0, 0, 0);
    return date.toISOString();
}
function getMonthBoundary(now, dueHour) {
    const date = new Date(now);
    date.setMonth(date.getMonth() + 1, 0);
    date.setHours(dueHour, 0, 0, 0);
    return date.toISOString();
}
//# sourceMappingURL=compliance.js.map