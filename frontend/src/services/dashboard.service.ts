import { getCoReport, type OperationalStatus } from "../api/reports";

export interface DashboardShipSummary {
  shipId: string;
  overdueCount: number;
  criticalCount: number;
  status: OperationalStatus;
}

export interface DashboardData {
  ships: DashboardShipSummary[];
}

export async function loadDashboardData(): Promise<DashboardData> {
  const report = await getCoReport();

  return {
    ships: report.ships.map((ship) => ({
      shipId: ship.shipId,
      overdueCount: ship.overdueCount,
      criticalCount: ship.criticalCount,
      status: ship.status,
    })),
  };
}
