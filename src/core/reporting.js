"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMeoReport = generateMeoReport;
exports.generateWeoReport = generateWeoReport;
exports.generateCoReport = generateCoReport;
exports.computeStatus = computeStatus;
const read_models_1 = require("./read-models");
function generateMeoReport(state, shipId) {
    const view = (0, read_models_1.getMeoView)(state, shipId);
    return {
        shipId,
        pendingCount: view.pendingTasks.length,
        overdueCount: view.overdueTasks.length,
        warningCount: view.complianceWarnings.filter((signal) => signal.severity === "WARNING").length,
        criticalCount: view.complianceWarnings.filter((signal) => signal.severity === "CRITICAL").length,
    };
}
function generateWeoReport(state, shipId) {
    const view = (0, read_models_1.getWeoView)(state, shipId);
    const criticalCount = view.criticalSignals.length;
    return {
        shipId: view.shipId,
        totalTasks: view.totalTasks,
        overdueCount: view.overdueCount,
        criticalCount,
        status: computeStatus(view.overdueCount, criticalCount),
    };
}
function generateCoReport(state) {
    const view = (0, read_models_1.getCoView)(state);
    return {
        ships: view.ships.map((ship) => ({
            shipId: ship.shipId,
            overdueCount: ship.overdueCount,
            criticalCount: ship.criticalCount,
            status: computeStatus(ship.overdueCount, ship.criticalCount),
        })),
    };
}
function computeStatus(overdueCount, criticalCount) {
    if (criticalCount > 0) {
        return "CRITICAL";
    }
    if (overdueCount > 0) {
        return "ATTENTION";
    }
    return "STABLE";
}
//# sourceMappingURL=reporting.js.map