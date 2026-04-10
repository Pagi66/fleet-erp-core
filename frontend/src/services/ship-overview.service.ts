import {
  getComplianceSignals,
  type ComplianceSignal,
} from "../api/compliance";
import {
  getMeoReport,
  getWeoReport,
  type OperationalStatus,
} from "../api/reports";

export interface ShipOverviewData {
  shipId: string;
  meo: {
    pendingCount: number;
    overdueCount: number;
    criticalCount: number;
  };
  weo: {
    totalTasks: number;
    overdueCount: number;
    status: OperationalStatus;
  };
  signals: Array<{
    type: string;
    severity: ComplianceSignal["severity"];
    message: string;
    shipId?: string;
    taskId?: string;
    defectId?: string;
  }>;
}

export async function loadShipOverviewData(shipId: string): Promise<ShipOverviewData> {
  const [meo, weo, compliance] = await Promise.all([
    getMeoReport(shipId),
    getWeoReport(shipId),
    getComplianceSignals(50),
  ]);

  return {
    shipId,
    meo: {
      pendingCount: meo.pendingCount,
      overdueCount: meo.overdueCount,
      criticalCount: meo.criticalCount,
    },
    weo: {
      totalTasks: weo.totalTasks,
      overdueCount: weo.overdueCount,
      status: weo.status,
    },
    signals: compliance
      .filter((signal) => signal.shipId === shipId)
      .map((signal) => ({
        type: signal.type,
        severity: signal.severity,
        message: signal.message,
        ...(signal.shipId ? { shipId: signal.shipId } : {}),
        ...(signal.taskId ? { taskId: signal.taskId } : {}),
        ...(signal.defectId ? { defectId: signal.defectId } : {}),
      })),
  };
}
