import type { DataTableColumn } from "../components/dashboard/DataTable";
import type { ExceptionListItem } from "../components/dashboard/ExceptionList";
import type { KpiCardItem } from "../components/dashboard/KpiCardGrid";
import type { LogComdDashboardData } from "../services/log-comd-dashboard.service";

export interface LogRecordRowViewModel {
  recordId: string;
  title: string;
  ship: string;
  status: string;
  owner: string;
  detailHref: string;
}

export interface ShipCountRow {
  shipId: string;
  visibleCount: number;
}

export interface LogComdDashboardViewModel {
  kpis: KpiCardItem[];
  actionableRows: LogRecordRowViewModel[];
  actionableColumns: DataTableColumn<LogRecordRowViewModel>[];
  blockedItems: ExceptionListItem[];
  shipRows: ShipCountRow[];
  shipColumns: DataTableColumn<ShipCountRow>[];
}

export function createLogComdDashboardViewModel(
  data: LogComdDashboardData,
): LogComdDashboardViewModel {
  return {
    kpis: [
      { label: "Need My Action", value: data.summary.totals.needingMyAction, tone: data.summary.totals.needingMyAction > 0 ? "warning" : "success" },
      { label: "Stale Records", value: data.summary.totals.stale, tone: data.summary.totals.stale > 0 ? "warning" : "success" },
      { label: "Rejected Records", value: data.summary.totals.recentlyRejected, tone: data.summary.totals.recentlyRejected > 0 ? "critical" : "success" },
      { label: "Visible Ships", value: Object.keys(data.summary.countsByShip).length },
    ],
    actionableRows: data.actionable.map((record) => ({
      recordId: record.recordId,
      title: record.title,
      ship: record.shipId,
      status: record.status,
      owner: record.currentOwner,
      detailHref: `/records/${encodeURIComponent(record.recordId)}?role=LOGISTICS_COMMAND`,
    })),
    actionableColumns: [
      { key: "title", header: "Record", render: (row) => row.title },
      { key: "ship", header: "Ship", render: (row) => row.ship },
      { key: "status", header: "Status", render: (row) => row.status },
      { key: "owner", header: "Owner", render: (row) => row.owner },
    ],
    blockedItems: [...data.stale, ...data.rejected].slice(0, 10).map((record) => ({
      key: `${record.recordId}-${record.bucket}`,
      primary: record.title,
      secondary: `${record.shipId} · ${record.kind}`,
      meta: record.attentionSignals.join(", ") || record.bucket,
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
