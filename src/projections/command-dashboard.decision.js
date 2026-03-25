"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActionBatches = getActionBatches;
exports.getPatternClusters = getPatternClusters;
exports.getBottlenecks = getBottlenecks;
exports.getNextBestAction = getNextBestAction;
exports.getOptimizedActionQueue = getOptimizedActionQueue;
exports.getRejectionInsights = getRejectionInsights;
const command_dashboard_interaction_1 = require("./command-dashboard.interaction");
const DEFAULT_MIN_REJECTION_INSIGHT_COUNT = 2;
function getActionBatches(view) {
    const batches = new Map();
    for (const record of getOptimizedActionQueue(view)) {
        const key = getActionBatchKey(record);
        const existing = batches.get(key);
        if (existing) {
            existing.push(record);
            continue;
        }
        batches.set(key, [record]);
    }
    return Object.freeze([...batches.entries()]
        .map(([key, records]) => ({
        key,
        records: Object.freeze([...records].sort(command_dashboard_interaction_1.compareRecordsByInteractionPriority)),
        count: records.length,
    }))
        .sort(compareActionBatches)
        .map((batch) => Object.freeze(batch)));
}
function getPatternClusters(view) {
    const records = getAllVisibleRecords(view);
    const clusters = [];
    clusters.push(...buildClusters("SHIP", records, (record) => normalizeShipId(record)));
    clusters.push(...buildClusters("REJECTION_REASON", records.filter((record) => record.status === "REJECTED"), (record) => normalizeReason(record)));
    clusters.push(...buildClusters("RECORD_KIND", records, (record) => normalizeKind(record)));
    return Object.freeze(clusters.sort(comparePatternClusters).map((cluster) => Object.freeze(cluster)));
}
function getBottlenecks(view) {
    const pendingRecords = getAllVisibleRecords(view).filter((record) => record.status === "SUBMITTED");
    const byRole = initializeRoleCounts();
    const byShipEntries = new Map();
    for (const record of pendingRecords) {
        byRole[record.currentOwner] += 1;
        byShipEntries.set(record.shipId, (byShipEntries.get(record.shipId) ?? 0) + 1);
    }
    const byShip = Object.freeze(Object.fromEntries([...byShipEntries.entries()].sort((left, right) => {
        const countDifference = right[1] - left[1];
        if (countDifference !== 0) {
            return countDifference;
        }
        return left[0].localeCompare(right[0]);
    })));
    return Object.freeze({
        byRole: Object.freeze({ ...byRole }),
        byShip,
    });
}
function getNextBestAction(view) {
    const actionQueue = getOptimizedActionQueue(view);
    return actionQueue.length > 0 ? actionQueue[0] ?? null : null;
}
function getOptimizedActionQueue(view) {
    return Object.freeze([...view.sections.actionRequired].sort(compareOptimizedActionRecords));
}
function getRejectionInsights(view, minimumCount = DEFAULT_MIN_REJECTION_INSIGHT_COUNT) {
    if (!Number.isInteger(minimumCount) || minimumCount < 1) {
        throw new Error("minimumCount must be a positive integer");
    }
    const reasons = new Map();
    for (const record of getAllVisibleRecords(view)) {
        if (record.status !== "REJECTED") {
            continue;
        }
        const reason = normalizeReason(record);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    return Object.freeze([...reasons.entries()]
        .filter(([, count]) => count >= minimumCount)
        .map(([reason, count]) => Object.freeze({ reason, count }))
        .sort((left, right) => {
        const countDifference = right.count - left.count;
        if (countDifference !== 0) {
            return countDifference;
        }
        return left.reason.localeCompare(right.reason);
    }));
}
function buildClusters(type, records, keySelector) {
    const grouped = new Map();
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
        records: Object.freeze([...groupRecords].sort(command_dashboard_interaction_1.compareRecordsByInteractionPriority)),
        count: groupRecords.length,
    }));
}
function compareActionBatches(left, right) {
    const countDifference = right.count - left.count;
    if (countDifference !== 0) {
        return countDifference;
    }
    const recordDifference = (0, command_dashboard_interaction_1.compareRecordsByInteractionPriority)(left.records[0], right.records[0]);
    if (recordDifference !== 0) {
        return recordDifference;
    }
    return left.key.localeCompare(right.key);
}
function comparePatternClusters(left, right) {
    const countDifference = right.count - left.count;
    if (countDifference !== 0) {
        return countDifference;
    }
    const typeDifference = left.type.localeCompare(right.type);
    if (typeDifference !== 0) {
        return typeDifference;
    }
    const recordDifference = (0, command_dashboard_interaction_1.compareRecordsByInteractionPriority)(left.records[0], right.records[0]);
    if (recordDifference !== 0) {
        return recordDifference;
    }
    return left.key.localeCompare(right.key);
}
function compareOptimizedActionRecords(left, right) {
    const attentionDifference = (0, command_dashboard_interaction_1.computeAttentionPriority)(right) - (0, command_dashboard_interaction_1.computeAttentionPriority)(left);
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
function getAllVisibleRecords(view) {
    return Object.freeze([
        ...view.sections.actionRequired,
        ...view.sections.needsAttention,
        ...view.sections.forAwareness,
    ]);
}
function initializeRoleCounts() {
    return {
        COMMANDING_OFFICER: 0,
        MARINE_ENGINEERING_OFFICER: 0,
        WEAPON_ELECTRICAL_OFFICER: 0,
        FLEET_SUPPORT_GROUP: 0,
        LOGISTICS_COMMAND: 0,
    };
}
function hasNonEmptyReason(record) {
    return normalizeReason(record) !== "NO_REASON";
}
function getActionBatchKey(record) {
    return `${normalizeShipId(record)}::${normalizeKind(record)}`;
}
function normalizeShipId(record) {
    return record.shipId;
}
function normalizeKind(record) {
    return record.kind;
}
function normalizeReason(record) {
    const reason = record.lastActionReason?.trim() ?? "";
    return reason !== "" ? reason : "NO_REASON";
}
function normalizeAge(record) {
    return record.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
}
//# sourceMappingURL=command-dashboard.decision.js.map