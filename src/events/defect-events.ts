import { EngineEvent, TaskSeverity } from "../core/types";

export function createDefectReportedEvent(
  taskId: string,
  taskTitle: string,
  businessDate: string,
  ettrDays: number,
  severity: TaskSeverity,
  occurredAt: string,
): EngineEvent {
  return {
    type: "DEFECT_REPORTED",
    businessDate,
    occurredAt,
    taskId,
    taskTitle,
    taskKind: "DEFECT",
    ettrDays,
    severity,
  };
}

export function createDefectEvaluationEvent(
  taskId: string,
  businessDate: string,
  occurredAt: string,
): EngineEvent {
  return {
    type: "DEFECT_EVALUATION",
    businessDate,
    occurredAt,
    taskId,
    taskKind: "DEFECT",
  };
}
