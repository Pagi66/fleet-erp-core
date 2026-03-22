import { RoleId } from "../core/types";
import { AppEvent } from "./event-system";

export function createPmsTaskGenerateEvent(
  taskId: string,
  taskTitle: string,
  businessDate: string,
  dueDate: string,
  assignedRole: RoleId,
  occurredAt: string,
): AppEvent {
  return {
    name: "PMS_TASK_GENERATE",
    occurredAt,
    payload: {
      taskId,
      taskTitle,
      businessDate,
      dueDate,
      assignedRole,
    },
  };
}

export function createPmsTaskCheckEvent(
  taskId: string,
  businessDate: string,
  occurredAt: string,
): AppEvent {
  return {
    name: "PMS_TASK_CHECK",
    occurredAt,
    payload: {
      taskId,
      businessDate,
    },
  };
}
