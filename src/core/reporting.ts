import {
  getCoView,
  getMeoView,
  getWeoView,
  type ReadModelState,
} from "./read-models";

export type OperationalStatus = "STABLE" | "ATTENTION" | "CRITICAL";

export type MeoReport = {
  shipId: string;
  pendingCount: number;
  overdueCount: number;
  warningCount: number;
  criticalCount: number;
};

export type WeoReport = {
  shipId: string;
  totalTasks: number;
  overdueCount: number;
  criticalCount: number;
  status: OperationalStatus;
};

export type CoReport = {
  ships: {
    shipId: string;
    overdueCount: number;
    criticalCount: number;
    status: OperationalStatus;
  }[];
};

export function generateMeoReport(
  state: ReadModelState,
  shipId: string,
): MeoReport {
  const view = getMeoView(state, shipId);

  return {
    shipId,
    pendingCount: view.pendingTasks.length,
    overdueCount: view.overdueTasks.length,
    warningCount: view.complianceWarnings.filter(
      (signal) => signal.severity === "WARNING",
    ).length,
    criticalCount: view.complianceWarnings.filter(
      (signal) => signal.severity === "CRITICAL",
    ).length,
  };
}

export function generateWeoReport(
  state: ReadModelState,
  shipId: string,
): WeoReport {
  const view = getWeoView(state, shipId);
  const criticalCount = view.criticalSignals.length;

  return {
    shipId: view.shipId,
    totalTasks: view.totalTasks,
    overdueCount: view.overdueCount,
    criticalCount,
    status: computeStatus(view.overdueCount, criticalCount),
  };
}

export function generateCoReport(state: ReadModelState): CoReport {
  const view = getCoView(state);

  return {
    ships: view.ships.map((ship) => ({
      shipId: ship.shipId,
      overdueCount: ship.overdueCount,
      criticalCount: ship.criticalCount,
      status: computeStatus(ship.overdueCount, ship.criticalCount),
    })),
  };
}

export function computeStatus(
  overdueCount: number,
  criticalCount: number,
): OperationalStatus {
  if (criticalCount > 0) {
    return "CRITICAL";
  }

  if (overdueCount > 0) {
    return "ATTENTION";
  }

  return "STABLE";
}
