"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePressure = evaluatePressure;
exports.computeOverdueDuration = computeOverdueDuration;
exports.evaluateOverdueSeverity = evaluateOverdueSeverity;
exports.aggregateShipPressure = aggregateShipPressure;
function evaluatePressure(state, now) {
    const perTaskSignals = evaluateTaskPressure(state.tasks, now);
    const shipPressureSignals = aggregateShipPressure(state.tasks);
    return [...dedupePressureSignals(perTaskSignals), ...dedupePressureSignals(shipPressureSignals)]
        .sort(comparePressureSignals);
}
function computeOverdueDuration(task, now) {
    if (typeof task.overdueSince !== "number") {
        return null;
    }
    const duration = now - task.overdueSince;
    return duration >= 0 ? duration : 0;
}
function evaluateOverdueSeverity(overdueDurationMs) {
    if (overdueDurationMs !== null && overdueDurationMs >= 24 * 60 * 60 * 1000) {
        return "CRITICAL";
    }
    return "WARNING";
}
function aggregateShipPressure(tasks) {
    const overdueCountsByShip = new Map();
    for (const task of tasks) {
        if (task.status !== "OVERDUE") {
            continue;
        }
        overdueCountsByShip.set(task.shipId, (overdueCountsByShip.get(task.shipId) ?? 0) + 1);
    }
    const signals = [...overdueCountsByShip.entries()]
        .filter(([, overdueCount]) => overdueCount >= 3)
        .map(([shipId, overdueCount]) => ({
        type: "OVERDUE_LOAD",
        severity: overdueCount >= 5 ? "CRITICAL" : "WARNING",
        message: `Ship ${shipId} has ${overdueCount} overdue tasks under pressure`,
        shipId,
    }));
    return signals.sort(comparePressureSignals);
}
function evaluateTaskPressure(tasks, now) {
    const signals = [];
    for (const task of tasks) {
        if (task.status === "OVERDUE") {
            const overdueDurationMs = computeOverdueDuration(task, now);
            signals.push({
                type: "TASK_PRESSURE",
                severity: evaluateOverdueSeverity(overdueDurationMs),
                message: overdueDurationMs === null
                    ? `Task ${task.id} is overdue`
                    : `Task ${task.id} has been overdue for ${formatDurationHours(overdueDurationMs)}h`,
                shipId: task.shipId,
                taskId: task.id,
            });
            continue;
        }
        if (task.status === "PENDING" &&
            typeof task.dueAt === "number" &&
            now > task.dueAt) {
            signals.push({
                type: "STALE_TASK",
                severity: "WARNING",
                message: `Task ${task.id} is pending past due time`,
                shipId: task.shipId,
                taskId: task.id,
            });
        }
    }
    return signals.sort(comparePressureSignals);
}
function dedupePressureSignals(signals) {
    const unique = new Map();
    for (const signal of [...signals].sort(comparePressureSignals)) {
        unique.set(buildPressureSignalKey(signal), signal);
    }
    return [...unique.values()].sort(comparePressureSignals);
}
function buildPressureSignalKey(signal) {
    return [
        signal.type,
        signal.shipId ?? "NO_SHIP",
        signal.taskId ?? "NO_TASK",
    ].join("::");
}
function comparePressureSignals(left, right) {
    return (compareOptionalString(left.shipId, right.shipId) ||
        compareSeverity(left.severity, right.severity) ||
        left.type.localeCompare(right.type) ||
        compareOptionalString(left.taskId, right.taskId) ||
        left.message.localeCompare(right.message));
}
function compareSeverity(left, right) {
    return severityRank(right) - severityRank(left);
}
function severityRank(severity) {
    switch (severity) {
        case "CRITICAL":
            return 2;
        case "WARNING":
            return 1;
        default:
            return 0;
    }
}
function compareOptionalString(left, right) {
    return (left ?? "").localeCompare(right ?? "");
}
function formatDurationHours(durationMs) {
    return Math.floor(durationMs / (60 * 60 * 1000));
}
//# sourceMappingURL=compliance-pressure.js.map