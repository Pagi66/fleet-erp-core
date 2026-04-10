import { getComplianceSignals } from "../api/compliance";
import { getNotifications } from "../api/notifications";
import { getCoReport, getMeoReport } from "../api/reports";
import { getOverdueTasks, getTasks } from "../api/tasks";

export interface MeoDashboardData {
  shipOptions: Array<{ shipId: string; status: string }>;
  selectedShipId: string | null;
  detail: null | {
    report: Awaited<ReturnType<typeof getMeoReport>>;
    tasks: Awaited<ReturnType<typeof getTasks>>;
    overdueTasks: Awaited<ReturnType<typeof getOverdueTasks>>;
    signals: Awaited<ReturnType<typeof getComplianceSignals>>;
    notifications: Awaited<ReturnType<typeof getNotifications>>;
  };
}

export async function loadMeoDashboardData(
  shipId: string | null,
): Promise<MeoDashboardData> {
  const fleet = await getCoReport();
  const shipOptions = fleet.ships.map((ship) => ({
    shipId: ship.shipId,
    status: ship.status,
  }));

  if (!shipId) {
    return {
      shipOptions,
      selectedShipId: null,
      detail: null,
    };
  }

  const [report, tasks, overdueTasks, signals, notifications] = await Promise.all([
    getMeoReport(shipId),
    getTasks(shipId),
    getOverdueTasks(shipId),
    getComplianceSignals(100),
    getNotifications(shipId, "MARINE_ENGINEERING_OFFICER"),
  ]);

  return {
    shipOptions,
    selectedShipId: shipId,
    detail: {
      report,
      tasks,
      overdueTasks,
      signals: signals.filter((signal) => signal.shipId === shipId),
      notifications,
    },
  };
}
