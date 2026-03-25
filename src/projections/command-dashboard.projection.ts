import {
  ApprovalAwarenessRecord,
  AssignedRoleId,
  RoleDashboardSummary,
} from "../core/types";

export interface CommandDashboardView {
  role: AssignedRoleId;
  summary: {
    pending: number;
    stale: number;
    rejected: number;
    total: number;
  };
  sections: {
    actionRequired: ApprovalAwarenessRecord[];
    needsAttention: ApprovalAwarenessRecord[];
    forAwareness: ApprovalAwarenessRecord[];
  };
}

export function buildCommandDashboardView(
  role: AssignedRoleId,
  records: ApprovalAwarenessRecord[],
  summary: RoleDashboardSummary,
): CommandDashboardView {
  if (summary.role !== role) {
    throw new Error(
      `Command dashboard role mismatch: requested ${role}, summary provided ${summary.role}`,
    );
  }

  const actionRequired: ApprovalAwarenessRecord[] = [];
  const needsAttention: ApprovalAwarenessRecord[] = [];
  const forAwareness: ApprovalAwarenessRecord[] = [];

  for (const record of records) {
    if (record.bucket === "PENDING_MY_ACTION") {
      actionRequired.push(record);
      continue;
    }

    if (record.attentionSignals.length > 0) {
      needsAttention.push(record);
      continue;
    }

    forAwareness.push(record);
  }

  const view: CommandDashboardView = {
    role,
    summary: {
      pending: summary.totals.needingMyAction,
      stale: summary.totals.stale,
      rejected: summary.totals.blockedByRejection,
      total: summary.totals.visible,
    },
    sections: {
      actionRequired: sortDashboardSection(actionRequired),
      needsAttention: sortDashboardSection(needsAttention),
      forAwareness: sortDashboardSection(forAwareness),
    },
  };

  Object.freeze(view.summary);
  Object.freeze(view.sections.actionRequired);
  Object.freeze(view.sections.needsAttention);
  Object.freeze(view.sections.forAwareness);
  Object.freeze(view.sections);
  return Object.freeze(view);
}

function sortDashboardSection(
  records: ApprovalAwarenessRecord[],
): ApprovalAwarenessRecord[] {
  return [...records].sort(compareDashboardRecords);
}

function compareDashboardRecords(
  left: ApprovalAwarenessRecord,
  right: ApprovalAwarenessRecord,
): number {
  const leftHasSignals = left.attentionSignals.length > 0 ? 1 : 0;
  const rightHasSignals = right.attentionSignals.length > 0 ? 1 : 0;
  if (leftHasSignals !== rightHasSignals) {
    return rightHasSignals - leftHasSignals;
  }

  const leftAge = left.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
  const rightAge = right.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
  if (leftAge !== rightAge) {
    return rightAge - leftAge;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return left.recordId.localeCompare(right.recordId);
}
