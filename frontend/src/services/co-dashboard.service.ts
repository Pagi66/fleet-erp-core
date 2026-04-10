import { getComplianceSignals } from "../api/compliance";
import { getFailedEvents } from "../api/failed-events";
import { getCoReport } from "../api/reports";

export interface CoDashboardData {
  fleet: Awaited<ReturnType<typeof getCoReport>>;
  criticalSignals: Awaited<ReturnType<typeof getComplianceSignals>>;
  failedEvents: Awaited<ReturnType<typeof getFailedEvents>>;
}

export async function loadCoDashboardData(): Promise<CoDashboardData> {
  const [fleet, signals, failedEvents] = await Promise.all([
    getCoReport(),
    getComplianceSignals(100),
    getFailedEvents(),
  ]);

  return {
    fleet,
    criticalSignals: signals.filter((signal) => signal.severity === "CRITICAL"),
    failedEvents,
  };
}
