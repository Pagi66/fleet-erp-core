export type ComplianceSignal = {
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  shipId?: string;
  taskId?: string;
  defectId?: string;
};

export interface ComplianceTaskState {
  id: string;
  status: "PENDING" | "COMPLETED" | "OVERDUE";
  shipId: string;
  executionStatus?: "PENDING" | "COMPLETED" | "MISSED";
}

export interface ComplianceDefectState {
  id: string;
  shipId: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  ettr?: number;
}

export interface ComplianceEngineState {
  tasks: ComplianceTaskState[];
  defects: ComplianceDefectState[];
}

interface GroupedSignals {
  byShip: Map<string, ComplianceSignal[]>;
  unscoped: ComplianceSignal[];
}

export function evaluateCompliance(
  state: ComplianceEngineState,
): ComplianceSignal[] {
  const taskSignals = evaluateTasks(state);
  const defectSignals = evaluateDefects(state);
  return aggregateSignals(taskSignals, defectSignals);
}

export function evaluateTasks(
  state: ComplianceEngineState,
): ComplianceSignal[] {
  const signals: ComplianceSignal[] = [];
  const overdueTaskCountsByShip = new Map<string, number>();

  for (const task of state.tasks) {
    const isMissedTask =
      task.status === "OVERDUE" || task.executionStatus === "MISSED";
    if (!isMissedTask) {
      continue;
    }

    signals.push({
      type: "TASK_OVERDUE",
      severity: "WARNING",
      message: `Task ${task.id} is overdue`,
      shipId: task.shipId,
      taskId: task.id,
    });

    overdueTaskCountsByShip.set(
      task.shipId,
      (overdueTaskCountsByShip.get(task.shipId) ?? 0) + 1,
    );
  }

  for (const [shipId, overdueCount] of overdueTaskCountsByShip.entries()) {
    if (overdueCount <= 3) {
      continue;
    }

    signals.push({
      type: "MULTIPLE_OVERDUE_TASKS",
      severity: "CRITICAL",
      message: `Ship ${shipId} has ${overdueCount} overdue tasks`,
      shipId,
    });
  }

  return signals;
}

export function evaluateDefects(
  state: ComplianceEngineState,
): ComplianceSignal[] {
  const signals: ComplianceSignal[] = [];

  for (const defect of state.defects) {
    if (defect.status !== "OPEN" && defect.status !== "IN_PROGRESS") {
      continue;
    }

    signals.push({
      type: "OPEN_DEFECT",
      severity: "INFO",
      message: `Defect ${defect.id} remains open`,
      shipId: defect.shipId,
      defectId: defect.id,
    });

    if (typeof defect.ettr === "number" && defect.ettr >= 21) {
      signals.push({
        type: "DEFECT_ETTR_EXCEEDED",
        severity: "CRITICAL",
        message: `Defect ${defect.id} ETTR is ${defect.ettr} days`,
        shipId: defect.shipId,
        defectId: defect.id,
      });
    }
  }

  return signals;
}

export function aggregateSignals(
  ...signalGroups: readonly ComplianceSignal[][]
): ComplianceSignal[] {
  const grouped = groupSignalsByShip(signalGroups.flat());
  const dedupedByShip = [...grouped.byShip.entries()]
    .sort(([leftShipId], [rightShipId]) => leftShipId.localeCompare(rightShipId))
    .flatMap(([, signals]) => dedupeSignals(signals));
  const dedupedUnscoped = dedupeSignals(grouped.unscoped);

  return [...dedupedByShip, ...dedupedUnscoped];
}

function groupSignalsByShip(signals: readonly ComplianceSignal[]): GroupedSignals {
  const byShip = new Map<string, ComplianceSignal[]>();
  const unscoped: ComplianceSignal[] = [];

  for (const signal of signals) {
    if (!signal.shipId) {
      unscoped.push(signal);
      continue;
    }

    const existing = byShip.get(signal.shipId) ?? [];
    existing.push(signal);
    byShip.set(signal.shipId, existing);
  }

  return {
    byShip,
    unscoped,
  };
}

function dedupeSignals(signals: readonly ComplianceSignal[]): ComplianceSignal[] {
  const ordered = [...signals].sort(compareSignals);
  const unique = new Map<string, ComplianceSignal>();

  for (const signal of ordered) {
    unique.set(buildSignalKey(signal), signal);
  }

  return [...unique.values()].sort(compareSignals);
}

function buildSignalKey(signal: ComplianceSignal): string {
  return [
    signal.type,
    signal.severity,
    signal.shipId ?? "NO_SHIP",
    signal.taskId ?? "NO_TASK",
    signal.defectId ?? "NO_DEFECT",
  ].join("::");
}

function compareSignals(left: ComplianceSignal, right: ComplianceSignal): number {
  return (
    compareString(left.shipId, right.shipId) ||
    compareSeverity(left.severity, right.severity) ||
    compareString(left.type, right.type) ||
    compareString(left.taskId, right.taskId) ||
    compareString(left.defectId, right.defectId) ||
    compareString(left.message, right.message)
  );
}

function compareSeverity(
  left: ComplianceSignal["severity"],
  right: ComplianceSignal["severity"],
): number {
  return severityRank(right) - severityRank(left);
}

function severityRank(severity: ComplianceSignal["severity"]): number {
  switch (severity) {
    case "CRITICAL":
      return 3;
    case "WARNING":
      return 2;
    case "INFO":
      return 1;
    default:
      return 0;
  }
}

function compareString(left?: string, right?: string): number {
  return (left ?? "").localeCompare(right ?? "");
}
