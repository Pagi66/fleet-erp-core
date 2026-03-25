import { EngineEvent } from "../core/types";
export type EventListener = (event: EngineEvent) => void;
export declare class EventBus {
    private readonly listeners;
    subscribe(listener: EventListener): () => void;
    emit(event: EngineEvent): void;
}
//# sourceMappingURL=event-system.d.ts.map