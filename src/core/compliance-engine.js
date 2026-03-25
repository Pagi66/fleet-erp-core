"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCompliance = evaluateCompliance;
exports.evaluateTasks = evaluateTasks;
exports.evaluateDefects = evaluateDefects;
exports.aggregateSignals = aggregateSignals;
function evaluateCompliance(state) {
    const taskSignals = evaluateTasks(state);
    const defectSignals = evaluateDefects(state);
    return aggregateSignals(taskSignals, defectSignals);
}
function evaluateTasks(state) {
    const signals = [];
    const overdueTaskCountsByShip = new Map();
    for (const task of state.tasks) {
        if (task.status !== "OVERDUE") {
            continue;
        }
        signals.push({
            type: "TASK_OVERDUE",
            severity: "WARNING",
            message: `Task ${task.id} is overdue`,
            shipId: task.shipId,
            taskId: task.id,
        });
        overdueTaskCountsByShip.set(task.shipId, (overdueTaskCountsByShip.get(task.shipId) ?? 0) + 1);
    }
    for (const [shipId, overdueCount] of overdueTaskCountsByShip.entries()) {
        if (overdueCount <= 3) {
            continue;
        }
        signals.push({
            type: "MULTIPLE_OVERDUE_TASKS",
            severity: "CRITICAL",
            message: `Ship ${shipId} has ${overdueCount} overdue tasks`,
            shipId,
        });
    }
    return signals;
}
function evaluateDefects(state) {
    const signals = [];
    for (const defect of state.defects) {
        if (defect.status !== "OPEN") {
            continue;
        }
        signals.push({
            type: "OPEN_DEFECT",
            severity: "INFO",
            message: `Defect ${defect.id} remains open`,
            shipId: defect.shipId,
            defectId: defect.id,
        });
    }
    return signals;
}
function aggregateSignals(...signalGroups) {
    const grouped = groupSignalsByShip(signalGroups.flat());
    const dedupedByShip = [...grouped.byShip.entries()]
        .sort(([leftShipId], [rightShipId]) => leftShipId.localeCompare(rightShipId))
        .flatMap(([, signals]) => dedupeSignals(signals));
    const dedupedUnscoped = dedupeSignals(grouped.unscoped);
    return [...dedupedByShip, ...dedupedUnscoped];
}
function groupSignalsByShip(signals) {
    const byShip = new Map();
    const unscoped = [];
    for (const signal of signals) {
        if (!signal.shipId) {
            unscoped.push(signal);
            continue;
        }
        const existing = byShip.get(signal.shipId) ?? [];
        existing.push(signal);
        byShip.set(signal.shipId, existing);
    }
    return {
        byShip,
        unscoped,
    };
}
function dedupeSignals(signals) {
    const ordered = [...signals].sort(compareSignals);
    const unique = new Map();
    for (const signal of ordered) {
        unique.set(buildSignalKey(signal), signal);
    }
    return [...unique.values()].sort(compareSignals);
}
function buildSignalKey(signal) {
    return [
        signal.type,
        signal.severity,
        signal.shipId ?? "NO_SHIP",
        signal.taskId ?? "NO_TASK",
        signal.defectId ?? "NO_DEFECT",
    ].join("::");
}
function compareSignals(left, right) {
    return (compareString(left.shipId, right.shipId) ||
        compareSeverity(left.severity, right.severity) ||
        compareString(left.type, right.type) ||
        compareString(left.taskId, right.taskId) ||
        compareString(left.defectId, right.defectId) ||
        compareString(left.message, right.message));
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
function compareString(left, right) {
    return (left ?? "").localeCompare(right ?? "");
}
//# sourceMappingURL=compliance-engine.js.map