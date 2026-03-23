import { AssignedRoleId, EngineEvent } from "../core/types";

export function createPmsTaskGenerateEvent(
  shipId: string,
  taskId: string,
  taskTitle: string,
  businessDate: string,
  dueDate: string,
  assignedRole: AssignedRoleId,
  occurredAt: string,
): EngineEvent {
  return {
    type: "PMS_TASK_GENERATE",
    businessDate,
    occurredAt,
    shipId,
    taskId,
    taskTitle,
    dueDate,
    assignedRole,
  };
}

export function createPmsTaskCheckEvent(
  shipId: string,
  taskId: string,
  businessDate: string,
  occurredAt: string,
): EngineEvent {
  return {
    type: "PMS_TASK_CHECK",
    businessDate,
    occurredAt,
    shipId,
    taskId,
  };
}
