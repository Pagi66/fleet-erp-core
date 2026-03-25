import { ApprovalAwarenessRecord, AssignedRoleId } from "../core/types";
import { CommandDashboardView } from "./command-dashboard.projection";
import {
  compareRecordsByInteractionPriority,
  computeAttentionPriority,
} from "./command-dashboard.interaction";

export interface ActionBatch {
  key: string;
  records: readonly ApprovalAwarenessRecord[];
  count: number;
}

export interface PatternCluster {
  type: "SHIP" | "REJECTION_REASON" | "RECORD_KIND";
  key: string;
  records: readonly ApprovalAwarenessRecord[];
  count: number;
}

export interface Bottlenecks {
  byRole: Readonly<Record<AssignedRoleId, number>>;
  byShip: Readonly<Record<string, number>>;
}

export interface RejectionInsight {
  reason: string;
  count: number;
}

const DEFAULT_MIN_REJECTION_INSIGHT_COUNT = 2;

export function getActionBatches(
  view: CommandDashboardView,
): readonly ActionBatch[] {
  const batches = new Map<string, ApprovalAwarenessRecord[]>();

  for (const record of getOptimizedActionQueue(view)) {
    const key = getActionBatchKey(record);
    const existing = batches.get(key);
    if (existing) {
      existing.push(record);
      continue;
    }
    batches.set(key, [record]);
  }

  return Object.freeze(
    [...batches.entries()]
      .map(([key, records]) => ({
        key,
        records: Object.freeze([...records].sort(compareRecordsByInteractionPriority)),
        count: records.length,
      }))
      .sort(compareActionBatches)
      .map((batch) => Object.freeze(batch)),
  );
}

export function getPatternClusters(
  view: CommandDashboardView,
): readonly PatternCluster[] {
  const records = getAllVisibleRecords(view);
  const clusters: PatternCluster[] = [];

  clusters.push(...buildClusters("SHIP", records, (record) => normalizeShipId(record)));
  clusters.push(
    ...buildClusters(
      "REJECTION_REASON",
      records.filter((record) => record.status === "REJECTED"),
      (record) => normalizeReason(record),
    ),
  );
  clusters.push(...buildClusters("RECORD_KIND", records, (record) => normalizeKind(record)));

  return Object.freeze(clusters.sort(comparePatternClusters).map((cluster) => Object.freeze(cluster)));
}

export function getBottlenecks(
  view: CommandDashboardView,
): Bottlenecks {
  const pendingRecords = getAllVisibleRecords(view).filter((record) => record.status === "SUBMITTED");
  const byRole = initializeRoleCounts();
  const byShipEntries = new Map<string, number>();

  for (const record of pendingRecords) {
    byRole[record.currentOwner] += 1;
    byShipEntries.set(record.shipId, (byShipEntries.get(record.shipId) ?? 0) + 1);
  }

  const byShip = Object.freeze(
    Object.fromEntries(
      [...byShipEntries.entries()].sort((left, right) => {
        const countDifference = right[1] - left[1];
        if (countDifference !== 0) {
          return countDifference;
        }
        return left[0].localeCompare(right[0]);
      }),
    ),
  ) as Readonly<Record<string, number>>;

  return Object.freeze({
    byRole: Object.freeze({ ...byRole }),
    byShip,
  });
}

export function getNextBestAction(
  view: CommandDashboardView,
): ApprovalAwarenessRecord | null {
  const actionQueue = getOptimizedActionQueue(view);
  return actionQueue.length > 0 ? actionQueue[0] ?? null : null;
}

export function getOptimizedActionQueue(
  view: CommandDashboardView,
): readonly ApprovalAwarenessRecord[] {
  return Object.freeze([...view.sections.actionRequired].sort(compareOptimizedActionRecords));
}

export function getRejectionInsights(
  view: CommandDashboardView,
  minimumCount = DEFAULT_MIN_REJECTION_INSIGHT_COUNT,
): readonly RejectionInsight[] {
  if (!Number.isInteger(minimumCount) || minimumCount < 1) {
    throw new Error("minimumCount must be a positive integer");
  }

  const reasons = new Map<string, number>();

  for (const record of getAllVisibleRecords(view)) {
    if (record.status !== "REJECTED") {
      continue;
    }

    const reason = normalizeReason(record);
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return Object.freeze(
    [...reasons.entries()]
      .filter(([, count]) => count >= minimumCount)
      .map(([reason, count]) => Object.freeze({ reason, count }))
      .sort((left, right) => {
        const countDifference = right.count - left.count;
        if (countDifference !== 0) {
          return countDifference;
        }
        return left.reason.localeCompare(right.reason);
      }),
  );
}

function buildClusters(
  type: PatternCluster["type"],
  records: readonly ApprovalAwarenessRecord[],
  keySelector: (record: ApprovalAwarenessRecord) => string,
): PatternCluster[] {
  const grouped = new Map<string, ApprovalAwarenessRecord[]>();

  for (const record of records) {
    const key = keySelector(record);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(record);
      continue;
    }
    grouped.set(key, [record]);
  }

  return [...grouped.entries()]
    .filter(([, groupRecords]) => groupRecords.length > 1)
    .map(([key, groupRecords]) => ({
      type,
      key,
      records: Object.freeze([...groupRecords].sort(compareRecordsByInteractionPriority)),
      count: groupRecords.length,
    }));
}

function compareActionBatches(
  left: ActionBatch,
  right: ActionBatch,
): number {
  const countDifference = right.count - left.count;
  if (countDifference !== 0) {
    return countDifference;
  }

  const recordDifference = compareRecordsByInteractionPriority(left.records[0]!, right.records[0]!);
  if (recordDifference !== 0) {
    return recordDifference;
  }

  return left.key.localeCompare(right.key);
}

function comparePatternClusters(
  left: PatternCluster,
  right: PatternCluster,
): number {
  const countDifference = right.count - left.count;
  if (countDifference !== 0) {
    return countDifference;
  }

  const typeDifference = left.type.localeCompare(right.type);
  if (typeDifference !== 0) {
    return typeDifference;
  }

  const recordDifference = compareRecordsByInteractionPriority(left.records[0]!, right.records[0]!);
  if (recordDifference !== 0) {
    return recordDifference;
  }

  return left.key.localeCompare(right.key);
}

function compareOptimizedActionRecords(
  left: ApprovalAwarenessRecord,
  right: ApprovalAwarenessRecord,
): number {
  const attentionDifference = computeAttentionPriority(right) - computeAttentionPriority(left);
  if (attentionDifference !== 0) {
    return attentionDifference;
  }

  const ageDifference = normalizeAge(right) - normalizeAge(left);
  if (ageDifference !== 0) {
    return ageDifference;
  }

  const batchKeyDifference = getActionBatchKey(left).localeCompare(getActionBatchKey(right));
  if (batchKeyDifference !== 0) {
    return batchKeyDifference;
  }

  const createdAtDifference = left.createdAt.localeCompare(right.createdAt);
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return left.recordId.localeCompare(right.recordId);
}

function getAllVisibleRecords(
  view: CommandDashboardView,
): readonly ApprovalAwarenessRecord[] {
  return Object.freeze([
    ...view.sections.actionRequired,
    ...view.sections.needsAttention,
    ...view.sections.forAwareness,
  ]);
}

function initializeRoleCounts(): Record<AssignedRoleId, number> {
  return {
    COMMANDING_OFFICER: 0,
    MARINE_ENGINEERING_OFFICER: 0,
    WEAPON_ELECTRICAL_OFFICER: 0,
    FLEET_SUPPORT_GROUP: 0,
    LOGISTICS_COMMAND: 0,
  };
}

function hasNonEmptyReason(record: ApprovalAwarenessRecord): boolean {
  return normalizeReason(record) !== "NO_REASON";
}

function getActionBatchKey(record: ApprovalAwarenessRecord): string {
  return `${normalizeShipId(record)}::${normalizeKind(record)}`;
}

function normalizeShipId(record: ApprovalAwarenessRecord): string {
  return record.shipId;
}

function normalizeKind(record: ApprovalAwarenessRecord): string {
  return record.kind;
}

function normalizeReason(record: ApprovalAwarenessRecord): string {
  const reason = record.lastActionReason?.trim() ?? "";
  return reason !== "" ? reason : "NO_REASON";
}

function normalizeAge(record: ApprovalAwarenessRecord): number {
  return record.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
}
