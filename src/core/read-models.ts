import type { ComplianceSignal } from "./compliance-engine";
import type { Task } from "./types";

export type MeoView = {
  pendingTasks: Task[];
  overdueTasks: Task[];
  complianceWarnings: ComplianceSignal[];
};

export type WeoView = {
  shipId: string;
  totalTasks: number;
  overdueCount: number;
  criticalSignals: ComplianceSignal[];
};

export type CoView = {
  ships: {
    shipId: string;
    overdueCount: number;
    criticalCount: number;
  }[];
};

export interface ReadModelState {
  tasks: Task[];
  compliance: {
    signals: ComplianceSignal[];
  };
}

export function getMeoView(
  state: ReadModelState,
  shipId: string,
): MeoView {
  const shipTasks = getTasksForShip(state.tasks, shipId);

  return {
    pendingTasks: shipTasks.filter((task) => task.status === "PENDING"),
    overdueTasks: shipTasks.filter((task) => task.status === "OVERDUE"),
    complianceWarnings: filterSignalsBySeverity(
      getSignalsForShip(state.compliance.signals, shipId),
      ["WARNING", "CRITICAL"],
    ),
  };
}

export function getWeoView(
  state: ReadModelState,
  shipId: string,
): WeoView {
  const shipTasks = getTasksForShip(state.tasks, shipId);

  return {
    shipId,
    totalTasks: shipTasks.length,
    overdueCount: countOverdueTasks(shipTasks),
    criticalSignals: filterSignalsBySeverity(
      getSignalsForShip(state.compliance.signals, shipId),
      ["CRITICAL"],
    ),
  };
}

export function getCoView(state: ReadModelState): CoView {
  const tasksByShip = groupTasksByShip(state.tasks);
  const shipIds = new Set<string>([
    ...tasksByShip.keys(),
    ...state.compliance.signals
      .map((signal) => signal.shipId)
      .filter((shipId): shipId is string => typeof shipId === "string"),
  ]);

  return {
    ships: [...shipIds]
      .sort((left, right) => left.localeCompare(right))
      .map((shipId) => {
        const shipTasks = tasksByShip.get(shipId) ?? [];
        const shipSignals = getSignalsForShip(state.compliance.signals, shipId);
        return {
          shipId,
          overdueCount: countOverdueTasks(shipTasks),
          criticalCount: filterSignalsBySeverity(shipSignals, ["CRITICAL"]).length,
        };
      }),
  };
}

export function groupTasksByShip(tasks: readonly Task[]): Map<string, Task[]> {
  const grouped = new Map<string, Task[]>();

  for (const task of sortTasks(tasks)) {
    const existing = grouped.get(task.shipId) ?? [];
    existing.push(task);
    grouped.set(task.shipId, existing);
  }

  return grouped;
}

export function filterSignalsBySeverity(
  signals: readonly ComplianceSignal[],
  severities: readonly ComplianceSignal["severity"][],
): ComplianceSignal[] {
  const allowed = new Set(severities);
  return [...signals]
    .filter((signal) => allowed.has(signal.severity))
    .sort(compareSignals);
}

export function countOverdueTasks(tasks: readonly Task[]): number {
  return tasks.filter((task) => task.status === "OVERDUE").length;
}

function getTasksForShip(tasks: readonly Task[], shipId: string): Task[] {
  return sortTasks(tasks.filter((task) => task.shipId === shipId));
}

function getSignalsForShip(
  signals: readonly ComplianceSignal[],
  shipId: string,
): ComplianceSignal[] {
  return [...signals]
    .filter((signal) => signal.shipId === shipId)
    .sort(compareSignals);
}

function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    return (
      left.shipId.localeCompare(right.shipId) ||
      compareTaskStatus(left.status, right.status) ||
      left.id.localeCompare(right.id)
    );
  });
}

function compareTaskStatus(
  left: Task["status"],
  right: Task["status"],
): number {
  return taskStatusRank(left) - taskStatusRank(right);
}

function taskStatusRank(status: Task["status"]): number {
  switch (status) {
    case "PENDING":
      return 1;
    case "OVERDUE":
      return 2;
    case "COMPLETED":
      return 3;
    default:
      return 99;
  }
}

function compareSignals(left: ComplianceSignal, right: ComplianceSignal): number {
  return (
    compareOptionalString(left.shipId, right.shipId) ||
    compareSeverity(left.severity, right.severity) ||
    left.type.localeCompare(right.type) ||
    compareOptionalString(left.taskId, right.taskId) ||
    compareOptionalString(left.defectId, right.defectId) ||
    left.message.localeCompare(right.message)
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

function compareOptionalString(left?: string, right?: string): number {
  return (left ?? "").localeCompare(right ?? "");
}
