import type { ShipOverviewData } from "../services/ship-overview.service";

export interface ShipMetricViewModel {
  label: string;
  value: string | number;
}

export interface ShipSignalViewModel {
  key: string;
  title: string;
  message: string;
  severityLabel: string;
  severityTone: string;
  scopeLabel: string;
}

export interface ShipOverviewViewModel {
  title: string;
  metrics: ShipMetricViewModel[];
  signals: ShipSignalViewModel[];
}

export function createShipOverviewViewModel(data: ShipOverviewData): ShipOverviewViewModel {
  return {
    title: `Ship ${data.shipId}`,
    metrics: [
      { label: "MEO Pending", value: data.meo.pendingCount },
      { label: "MEO Overdue", value: data.meo.overdueCount },
      { label: "MEO Critical", value: data.meo.criticalCount },
      { label: "WEO Tasks", value: data.weo.totalTasks },
      { label: "WEO Overdue", value: data.weo.overdueCount },
      { label: "WEO Status", value: data.weo.status },
    ],
    signals: data.signals.map((signal, index) => ({
      key: `${signal.type}-${signal.taskId ?? signal.defectId ?? index}`,
      title: signal.type,
      message: signal.message,
      severityLabel: signal.severity,
      severityTone: signal.severity.toLowerCase(),
      scopeLabel: signal.shipId ?? "UNSCOPED",
    })),
  };
}
