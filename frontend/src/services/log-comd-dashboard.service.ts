import {
  getActionableAwarenessRecords,
  getAwarenessSummary,
  getRejectedAwarenessRecords,
  getStaleAwarenessRecords,
  getVisibleAwarenessRecords,
} from "../api/awareness";

export interface LogComdDashboardData {
  summary: Awaited<ReturnType<typeof getAwarenessSummary>>;
  actionable: Awaited<ReturnType<typeof getActionableAwarenessRecords>>;
  stale: Awaited<ReturnType<typeof getStaleAwarenessRecords>>;
  rejected: Awaited<ReturnType<typeof getRejectedAwarenessRecords>>;
  visible: Awaited<ReturnType<typeof getVisibleAwarenessRecords>>;
}

export async function loadLogComdDashboardData(): Promise<LogComdDashboardData> {
  const [summary, actionable, stale, rejected, visible] = await Promise.all([
    getAwarenessSummary("LOGISTICS_COMMAND"),
    getActionableAwarenessRecords("LOGISTICS_COMMAND", { limit: 10 }),
    getStaleAwarenessRecords("LOGISTICS_COMMAND", { limit: 10 }),
    getRejectedAwarenessRecords("LOGISTICS_COMMAND", { limit: 10 }),
    getVisibleAwarenessRecords("LOGISTICS_COMMAND"),
  ]);

  return {
    summary,
    actionable,
    stale,
    rejected,
    visible,
  };
}
