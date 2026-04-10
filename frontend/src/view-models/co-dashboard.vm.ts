import type { DataTableColumn } from "../components/dashboard/DataTable";
import type { ExceptionListItem } from "../components/dashboard/ExceptionList";
import type { KpiCardItem } from "../components/dashboard/KpiCardGrid";
import type { CoDashboardData } from "../services/co-dashboard.service";

export interface CoFleetRow {
  shipId: string;
  status: string;
  overdueCount: number;
  criticalCount: number;
  detailHref: string;
}

export interface CoDashboardViewModel {
  kpis: KpiCardItem[];
  fleetRows: CoFleetRow[];
  fleetColumns: DataTableColumn<CoFleetRow>[];
  criticalSignalItems: ExceptionListItem[];
  failedEventItems: ExceptionListItem[];
}

export function createCoDashboardViewModel(
  data: CoDashboardData,
): CoDashboardViewModel {
  const criticalShipCount = data.fleet.ships.filter((ship) => ship.status === "CRITICAL").length;
  const attentionShipCount = data.fleet.ships.filter((ship) => ship.status === "ATTENTION").length;
  const overdueTotal = data.fleet.ships.reduce((sum, ship) => sum + ship.overdueCount, 0);
  const criticalTotal = data.fleet.ships.reduce((sum, ship) => sum + ship.criticalCount, 0);

  const fleetRows: CoFleetRow[] = data.fleet.ships.map((ship) => ({
    shipId: ship.shipId,
    status: ship.status,
    overdueCount: ship.overdueCount,
    criticalCount: ship.criticalCount,
    detailHref: `/ship/${encodeURIComponent(ship.shipId)}`,
  }));

  return {
    kpis: [
      { label: "Ships Critical", value: criticalShipCount, tone: criticalShipCount > 0 ? "critical" : "success" },
      { label: "Ships Attention", value: attentionShipCount, tone: attentionShipCount > 0 ? "warning" : "success" },
      { label: "Total Overdue", value: overdueTotal, tone: overdueTotal > 0 ? "warning" : "success" },
      { label: "Critical Signals", value: criticalTotal, tone: criticalTotal > 0 ? "critical" : "success" },
    ],
    fleetRows,
    fleetColumns: [
      { key: "ship", header: "Ship", render: (row) => row.shipId },
      { key: "status", header: "Status", render: (row) => row.status },
      { key: "overdue", header: "Overdue", align: "right", render: (row) => row.overdueCount },
      { key: "critical", header: "Critical", align: "right", render: (row) => row.criticalCount },
    ],
    criticalSignalItems: data.criticalSignals.slice(0, 8).map((signal, index) => ({
      key: `${signal.type}-${signal.shipId ?? index}`,
      primary: signal.type,
      secondary: signal.message,
      meta: signal.shipId ? `Ship ${signal.shipId}` : "Fleet scope",
    })),
    failedEventItems: data.failedEvents.slice(0, 8).map((event) => ({
      key: `${event.eventId}-${event.timestamp}`,
      primary: event.eventId,
      secondary: event.reason,
      meta: new Date(event.timestamp).toLocaleString(),
    })),
  };
}
