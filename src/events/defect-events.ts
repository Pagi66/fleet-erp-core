import { EngineEvent, TaskSeverity } from "../core/types";

export function createDefectReportedEvent(
  shipId: string,
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
    shipId,
    taskId,
    taskTitle,
    taskKind: "DEFECT",
    ettrDays,
    severity,
  };
}

export function createDefectEvaluationEvent(
  shipId: string,
  taskId: string,
  businessDate: string,
  occurredAt: string,
): EngineEvent {
  return {
    type: "DEFECT_EVALUATION",
    businessDate,
    occurredAt,
    shipId,
    taskId,
    taskKind: "DEFECT",
  };
}
