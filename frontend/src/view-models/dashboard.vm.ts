import type { DashboardData } from "../services/dashboard.service";

export interface DashboardShipViewModel {
  shipId: string;
  shipHref: string;
  countsLabel: string;
  statusLabel: string;
  statusTone: string;
}

export interface DashboardViewModel {
  ships: DashboardShipViewModel[];
}

export function createDashboardViewModel(data: DashboardData): DashboardViewModel {
  return {
    ships: data.ships.map((ship) => ({
      shipId: ship.shipId,
      shipHref: `/ship/${encodeURIComponent(ship.shipId)}`,
      countsLabel: `Overdue: ${ship.overdueCount} | Critical: ${ship.criticalCount}`,
      statusLabel: ship.status,
      statusTone: ship.status.toLowerCase(),
    })),
  };
}
