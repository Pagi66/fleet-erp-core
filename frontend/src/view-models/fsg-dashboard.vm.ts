import type { DataTableColumn } from "../components/dashboard/DataTable";
import type { ExceptionListItem } from "../components/dashboard/ExceptionList";
import type { KpiCardItem } from "../components/dashboard/KpiCardGrid";
import type { FsgDashboardData } from "../services/fsg-dashboard.service";

export interface RecordRowViewModel {
  recordId: string;
  title: string;
  ship: string;
  status: string;
  owner: string;
  detailHref: string;
}

export interface ShipWorkloadRow {
  shipId: string;
  visibleCount: number;
}

export interface FsgDashboardViewModel {
  kpis: KpiCardItem[];
  actionableRows: RecordRowViewModel[];
  actionableColumns: DataTableColumn<RecordRowViewModel>[];
  staleItems: ExceptionListItem[];
  shipRows: ShipWorkloadRow[];
  shipColumns: DataTableColumn<ShipWorkloadRow>[];
}

export function createFsgDashboardViewModel(
  data: FsgDashboardData,
): FsgDashboardViewModel {
  return {
    kpis: [
      { label: "Need My Action", value: data.summary.totals.needingMyAction, tone: data.summary.totals.needingMyAction > 0 ? "warning" : "success" },
      { label: "Stale Records", value: data.summary.totals.stale, tone: data.summary.totals.stale > 0 ? "warning" : "success" },
      { label: "Rejected Records", value: data.summary.totals.recentlyRejected, tone: data.summary.totals.recentlyRejected > 0 ? "critical" : "success" },
      { label: "Visible Records", value: data.summary.totals.visible },
    ],
    actionableRows: data.actionable.map((record) => ({
      recordId: record.recordId,
      title: record.title,
      ship: record.shipId,
      status: record.status,
      owner: record.currentOwner,
      detailHref: `/records/${encodeURIComponent(record.recordId)}?role=FLEET_SUPPORT_GROUP`,
    })),
    actionableColumns: [
      { key: "title", header: "Record", render: (row) => row.title },
      { key: "ship", header: "Ship", render: (row) => row.ship },
      { key: "status", header: "Status", render: (row) => row.status },
      { key: "owner", header: "Owner", render: (row) => row.owner },
    ],
    staleItems: data.stale.map((record) => ({
      key: record.recordId,
      primary: record.title,
      secondary: `${record.shipId} · ${record.kind}`,
      meta: `Last action ${record.lastActionAt ?? "n/a"}`,
    })),
    shipRows: Object.entries(data.summary.countsByShip).map(([shipId, visibleCount]) => ({
      shipId,
      visibleCount,
    })),
    shipColumns: [
      { key: "shipId", header: "Ship", render: (row) => row.shipId },
      { key: "visibleCount", header: "Visible Records", align: "right", render: (row) => row.visibleCount },
    ],
  };
}
