import type { DataTableColumn } from "../components/dashboard/DataTable";
import type { ExceptionListItem } from "../components/dashboard/ExceptionList";
import type { KpiCardItem } from "../components/dashboard/KpiCardGrid";
import type { ShipOption } from "../components/dashboard/ShipSelector";
import type { MeoDashboardData } from "../services/meo-dashboard.service";

export interface MeoTaskRow {
  id: string;
  title: string;
  dueDate: string;
  equipment: string;
  severity: string;
  escalation: string;
}

export interface MeoDashboardViewModel {
  shipOptions: ShipOption[];
  selectedShipId: string;
  needsShipSelection: boolean;
  kpis: KpiCardItem[];
  overdueRows: MeoTaskRow[];
  overdueColumns: DataTableColumn<MeoTaskRow>[];
  signalItems: ExceptionListItem[];
  notificationItems: ExceptionListItem[];
}

export function createMeoDashboardViewModel(
  data: MeoDashboardData,
): MeoDashboardViewModel {
  return {
    shipOptions: data.shipOptions.map((ship) => ({
      value: ship.shipId,
      label: `${ship.shipId} (${ship.status})`,
    })),
    selectedShipId: data.selectedShipId ?? "",
    needsShipSelection: data.detail === null,
    kpis: data.detail
      ? [
          { label: "Pending Tasks", value: data.detail.report.pendingCount },
          {
            label: "Overdue Tasks",
            value: data.detail.report.overdueCount,
            tone: data.detail.report.overdueCount > 0 ? "warning" : "success",
          },
          {
            label: "Warning Signals",
            value: data.detail.report.warningCount,
            tone: data.detail.report.warningCount > 0 ? "warning" : "success",
          },
          {
            label: "Unread Notifications",
            value: data.detail.notifications.filter((item) => !item.read).length,
            tone: data.detail.notifications.some((item) => !item.read) ? "info" : "success",
          },
        ]
      : [],
    overdueRows: data.detail
      ? data.detail.overdueTasks.map((task) => ({
          id: task.id,
          title: task.title,
          dueDate: task.dueDate,
          equipment: task.equipment,
          severity: task.severity ?? "ROUTINE",
          escalation: task.escalationLevel,
        }))
      : [],
    overdueColumns: [
      { key: "title", header: "Task", render: (row) => row.title },
      { key: "equipment", header: "Equipment", render: (row) => row.equipment },
      { key: "dueDate", header: "Due", render: (row) => row.dueDate },
      { key: "severity", header: "Severity", render: (row) => row.severity },
      { key: "escalation", header: "Escalation", render: (row) => row.escalation },
    ],
    signalItems: data.detail
      ? data.detail.signals
          .filter((signal) => signal.severity !== "INFO")
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
