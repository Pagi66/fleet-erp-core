import { EngineEvent } from "../core/types";

export type EventListener = (event: EngineEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
