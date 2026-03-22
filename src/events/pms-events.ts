import { EngineEvent, RoleId } from "../core/types";

export function createPmsTaskGenerateEvent(
  taskId: string,
  taskTitle: string,
  businessDate: string,
  dueDate: string,
  assignedRole: RoleId,
  occurredAt: string,
): EngineEvent {
  return {
    type: "PMS_TASK_GENERATE",
    businessDate,
    occurredAt,
    taskId,
    taskTitle,
    dueDate,
    assignedRole,
  };
}

export function createPmsTaskCheckEvent(
  taskId: string,
  businessDate: string,
  occurredAt: string,
): EngineEvent {
  return {
    type: "PMS_TASK_CHECK",
    businessDate,
    occurredAt,
    taskId,
  };
}
