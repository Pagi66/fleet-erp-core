import { RoleId } from "../core/types";

export type AppEventName =
  | "DAILY_LOG_CHECK_DUE"
  | "DAILY_LOG_ESCALATION_DUE"
  | "PMS_TASK_GENERATE"
  | "PMS_TASK_CHECK";

export interface AppEvent {
  name: AppEventName;
  occurredAt: string;
  payload: {
    businessDate: string;
    taskId?: string;
    taskTitle?: string;
    dueDate?: string;
    assignedRole?: RoleId;
  };
}

export type EventListener = (event: AppEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: AppEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
