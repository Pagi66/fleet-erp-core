import type { DataTableColumn } from "../components/dashboard/DataTable";
import type { ExceptionListItem } from "../components/dashboard/ExceptionList";
import type { KpiCardItem } from "../components/dashboard/KpiCardGrid";
import type { ShipOption } from "../components/dashboard/ShipSelector";
import type { WeoDashboardData } from "../services/weo-dashboard.service";

export interface WeoTaskRow {
  id: string;
  title: string;
  dueDate: string;
  equipment: string;
  status: string;
  severity: string;
}

export interface WeoDashboardViewModel {
  shipOptions: ShipOption[];
  selectedShipId: string;
  needsShipSelection: boolean;
  kpis: KpiCardItem[];
  taskRows: WeoTaskRow[];
  taskColumns: DataTableColumn<WeoTaskRow>[];
  signalItems: ExceptionListItem[];
  notificationItems: ExceptionListItem[];
}

export function createWeoDashboardViewModel(
  data: WeoDashboardData,
): WeoDashboardViewModel {
  return {
    shipOptions: data.shipOptions.map((ship) => ({
      value: ship.shipId,
      label: `${ship.shipId} (${ship.status})`,
    })),
    selectedShipId: data.selectedShipId ?? "",
    needsShipSelection: data.detail === null,
    kpis: data.detail
      ? [
          { label: "Total Tasks", value: data.detail.report.totalTasks },
          {
            label: "Overdue Tasks",
            value: data.detail.report.overdueCount,
            tone: data.detail.report.overdueCount > 0 ? "warning" : "success",
          },
          {
            label: "Critical Signals",
            value: data.detail.report.criticalCount,
            tone: data.detail.report.criticalCount > 0 ? "critical" : "success",
          },
          {
            label: "Operational Status",
            value: data.detail.report.status,
            tone:
              data.detail.report.status === "CRITICAL"
                ? "critical"
                : data.detail.report.status === "ATTENTION"
                  ? "warning"
                  : "success",
          },
        ]
      : [],
    taskRows: data.detail
      ? data.detail.overdueTasks.map((task) => ({
          id: task.id,
          title: task.title,
          dueDate: task.dueDate,
          equipment: task.equipment,
          status: task.status,
          severity: task.severity ?? "ROUTINE",
        }))
      : [],
    taskColumns: [
      { key: "title", header: "Task", render: (row) => row.title },
      { key: "equipment", header: "Equipment", render: (row) => row.equipment },
      { key: "dueDate", header: "Due", render: (row) => row.dueDate },
      { key: "status", header: "Status", render: (row) => row.status },
      { key: "severity", header: "Severity", render: (row) => row.severity },
    ],
    signalItems: data.detail
      ? data.detail.signals
          .filter((signal) => signal.severity === "CRITICAL")
          .slice(0, 8)
          .map((signal, index) => ({
            key: `${signal.type}-${signal.taskId ?? signal.defectId ?? index}`,
            primary: signal.type,
            secondary: signal.message,
            meta: signal.severity,
          }))
      : [],
    notificationItems: data.detail
      ? data.detail.notifications.slice(0, 8).map((item) => ({
          key: item.id,
          primary: item.type,
          secondary: item.message,
          meta: `${item.read ? "Read" : "Unread"} · ${new Date(item.timestamp).toLocaleString()}`,
        }))
      : [],
  };
}
