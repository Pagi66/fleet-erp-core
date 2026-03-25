"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMeoView = getMeoView;
exports.getWeoView = getWeoView;
exports.getCoView = getCoView;
exports.groupTasksByShip = groupTasksByShip;
exports.filterSignalsBySeverity = filterSignalsBySeverity;
exports.countOverdueTasks = countOverdueTasks;
function getMeoView(state, shipId) {
    const shipTasks = getTasksForShip(state.tasks, shipId);
    return {
        pendingTasks: shipTasks.filter((task) => task.status === "PENDING"),
        overdueTasks: shipTasks.filter((task) => task.status === "OVERDUE"),
        complianceWarnings: filterSignalsBySeverity(getSignalsForShip(state.compliance.signals, shipId), ["WARNING", "CRITICAL"]),
    };
}
function getWeoView(state, shipId) {
    const shipTasks = getTasksForShip(state.tasks, shipId);
    return {
        shipId,
        totalTasks: shipTasks.length,
        overdueCount: countOverdueTasks(shipTasks),
        criticalSignals: filterSignalsBySeverity(getSignalsForShip(state.compliance.signals, shipId), ["CRITICAL"]),
    };
}
function getCoView(state) {
    const tasksByShip = groupTasksByShip(state.tasks);
    const shipIds = new Set([
        ...tasksByShip.keys(),
        ...state.compliance.signals
            .map((signal) => signal.shipId)
            .filter((shipId) => typeof shipId === "string"),
    ]);
    return {
        ships: [...shipIds]
            .sort((left, right) => left.localeCompare(right))
            .map((shipId) => {
            const shipTasks = tasksByShip.get(shipId) ?? [];
            const shipSignals = getSignalsForShip(state.compliance.signals, shipId);
            return {
                shipId,
                overdueCount: countOverdueTasks(shipTasks),
                criticalCount: filterSignalsBySeverity(shipSignals, ["CRITICAL"]).length,
            };
        }),
    };
}
function groupTasksByShip(tasks) {
    const grouped = new Map();
    for (const task of sortTasks(tasks)) {
        const existing = grouped.get(task.shipId) ?? [];
        existing.push(task);
        grouped.set(task.shipId, existing);
    }
    return grouped;
}
function filterSignalsBySeverity(signals, severities) {
    const allowed = new Set(severities);
    return [...signals]
        .filter((signal) => allowed.has(signal.severity))
        .sort(compareSignals);
}
function countOverdueTasks(tasks) {
    return tasks.filter((task) => task.status === "OVERDUE").length;
}
function getTasksForShip(tasks, shipId) {
    return sortTasks(tasks.filter((task) => task.shipId === shipId));
}
function getSignalsForShip(signals, shipId) {
    return [...signals]
        .filter((signal) => signal.shipId === shipId)
        .sort(compareSignals);
}
function sortTasks(tasks) {
    return [...tasks].sort((left, right) => {
        return (left.shipId.localeCompare(right.shipId) ||
            compareTaskStatus(left.status, right.status) ||
            left.id.localeCompare(right.id));
    });
}
function compareTaskStatus(left, right) {
    return taskStatusRank(left) - taskStatusRank(right);
}
function taskStatusRank(status) {
    switch (status) {
        case "PENDING":
            return 1;
        case "OVERDUE":
            return 2;
        case "COMPLETED":
            return 3;
        default:
            return 99;
    }
}
function compareSignals(left, right) {
    return (compareOptionalString(left.shipId, right.shipId) ||
        compareSeverity(left.severity, right.severity) ||
        left.type.localeCompare(right.type) ||
        compareOptionalString(left.taskId, right.taskId) ||
        compareOptionalString(left.defectId, right.defectId) ||
        left.message.localeCompare(right.message));
}
function compareSeverity(left, right) {
    return severityRank(right) - severityRank(left);
}
function severityRank(severity) {
    switch (severity) {
        case "CRITICAL":
            return 3;
        case "WARNING":
            return 2;
        case "INFO":
            return 1;
        default:
            return 0;
    }
}
function compareOptionalString(left, right) {
    return (left ?? "").localeCompare(right ?? "");
}
//# sourceMappingURL=read-models.js.map