import {
  getActionableAwarenessRecords,
  getAwarenessSummary,
  getStaleAwarenessRecords,
  getVisibleAwarenessRecords,
} from "../api/awareness";

export interface FsgDashboardData {
  summary: Awaited<ReturnType<typeof getAwarenessSummary>>;
  actionable: Awaited<ReturnType<typeof getActionableAwarenessRecords>>;
  stale: Awaited<ReturnType<typeof getStaleAwarenessRecords>>;
  visible: Awaited<ReturnType<typeof getVisibleAwarenessRecords>>;
}

export async function loadFsgDashboardData(): Promise<FsgDashboardData> {
  const [summary, actionable, stale, visible] = await Promise.all([
    getAwarenessSummary("FLEET_SUPPORT_GROUP"),
    getActionableAwarenessRecords("FLEET_SUPPORT_GROUP", { limit: 10 }),
    getStaleAwarenessRecords("FLEET_SUPPORT_GROUP", { limit: 10 }),
    getVisibleAwarenessRecords("FLEET_SUPPORT_GROUP"),
  ]);

  return {
    summary,
    actionable,
    stale,
    visible,
  };
}
