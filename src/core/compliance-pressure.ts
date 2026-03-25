import type { ComplianceSignal } from "./compliance-engine";

export type PressureSignal = {
  type: string;
  severity: "WARNING" | "CRITICAL";
  message: string;
  shipId?: string;
  taskId?: string;
};

export interface PressureTaskState {
  id: string;
  shipId: string;
  status: "PENDING" | "COMPLETED" | "OVERDUE";
  executionStatus?: "PENDING" | "COMPLETED" | "MISSED";
  dueAt?: number;
  nextDueAt?: number;
  overdueSince?: number;
}

export interface CompliancePressureState {
  tasks: PressureTaskState[];
  compliance: {
    signals: ComplianceSignal[];
  };
}

export function evaluatePressure(
  state: CompliancePressureState,
  now: number,
): PressureSignal[] {
  const perTaskSignals = evaluateTaskPressure(state.tasks, now);
  const shipPressureSignals = aggregateShipPressure(state.tasks);

  return [...dedupePressureSignals(perTaskSignals), ...dedupePressureSignals(shipPressureSignals)]
    .sort(comparePressureSignals);
}

export function computeOverdueDuration(
  task: PressureTaskState,
  now: number,
): number | null {
  if (typeof task.overdueSince !== "number") {
    return null;
  }

  const duration = now - task.overdueSince;
  return duration >= 0 ? duration : 0;
}

export function evaluateOverdueSeverity(
  overdueDurationMs: number | null,
): PressureSignal["severity"] {
  if (overdueDurationMs !== null && overdueDurationMs >= 24 * 60 * 60 * 1000) {
    return "CRITICAL";
  }

  return "WARNING";
}

export function aggregateShipPressure(
  tasks: readonly PressureTaskState[],
): PressureSignal[] {
  const overdueCountsByShip = new Map<string, number>();

  for (const task of tasks) {
    if (task.status !== "OVERDUE") {
      continue;
    }

    overdueCountsByShip.set(
      task.shipId,
      (overdueCountsByShip.get(task.shipId) ?? 0) + 1,
    );
  }

  const signals: PressureSignal[] = [...overdueCountsByShip.entries()]
    .filter(([, overdueCount]) => overdueCount >= 3)
    .map(([shipId, overdueCount]) => ({
      type: "OVERDUE_LOAD",
      severity: overdueCount >= 5 ? "CRITICAL" : "WARNING",
      message: `Ship ${shipId} has ${overdueCount} overdue tasks under pressure`,
      shipId,
    }));

  return signals.sort(comparePressureSignals);
}

function evaluateTaskPressure(
  tasks: readonly PressureTaskState[],
  now: number,
): PressureSignal[] {
  const signals: PressureSignal[] = [];

  for (const task of tasks) {
    if (task.status === "OVERDUE" || task.executionStatus === "MISSED") {
      const overdueDurationMs = computeOverdueDuration(task, now);
      signals.push({
        type: "TASK_PRESSURE",
        severity: evaluateOverdueSeverity(overdueDurationMs),
        message:
          overdueDurationMs === null
            ? `Task ${task.id} is overdue`
            : `Task ${task.id} has been overdue for ${formatDurationHours(overdueDurationMs)}h`,
        shipId: task.shipId,
        taskId: task.id,
      });
      continue;
    }

    if (
      task.status === "PENDING" &&
      typeof resolveDueAt(task) === "number" &&
      now > (resolveDueAt(task) as number)
    ) {
      signals.push({
        type: "STALE_TASK",
        severity: "WARNING",
        message: `Task ${task.id} is pending past due time`,
        shipId: task.shipId,
        taskId: task.id,
      });
    }
  }

  return signals.sort(comparePressureSignals);
}

function dedupePressureSignals(
  signals: readonly PressureSignal[],
): PressureSignal[] {
  const unique = new Map<string, PressureSignal>();

  for (const signal of [...signals].sort(comparePressureSignals)) {
    unique.set(buildPressureSignalKey(signal), signal);
  }

  return [...unique.values()].sort(comparePressureSignals);
}

function buildPressureSignalKey(signal: PressureSignal): string {
  return [
    signal.type,
    signal.shipId ?? "NO_SHIP",
    signal.taskId ?? "NO_TASK",
  ].join("::");
}

function comparePressureSignals(
  left: PressureSignal,
  right: PressureSignal,
): number {
  return (
    compareOptionalString(left.shipId, right.shipId) ||
    compareSeverity(left.severity, right.severity) ||
    left.type.localeCompare(right.type) ||
    compareOptionalString(left.taskId, right.taskId) ||
    left.message.localeCompare(right.message)
  );
}

function compareSeverity(
  left: PressureSignal["severity"],
  right: PressureSignal["severity"],
): number {
  return severityRank(right) - severityRank(left);
}

function severityRank(severity: PressureSignal["severity"]): number {
  switch (severity) {
    case "CRITICAL":
      return 2;
    case "WARNING":
      return 1;
    default:
      return 0;
  }
}

function compareOptionalString(left?: string, right?: string): number {
  return (left ?? "").localeCompare(right ?? "");
}

function formatDurationHours(durationMs: number): number {
  return Math.floor(durationMs / (60 * 60 * 1000));
}

function resolveDueAt(task: PressureTaskState): number | undefined {
  if (typeof task.dueAt === "number" && typeof task.nextDueAt === "number") {
    return Math.min(task.dueAt, task.nextDueAt);
  }

  return typeof task.nextDueAt === "number" ? task.nextDueAt : task.dueAt;
}
