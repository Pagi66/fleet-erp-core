export declare const DEFAULT_PROCESSED_EVENT_TTL_MS: number;
export interface EventIntegrityState {
    processedEvents: Record<string, number>;
}
export declare function isDuplicateEvent(eventId: string, state: EventIntegrityState): boolean;
export declare function markEventProcessed(eventId: string, state: EventIntegrityState, processedAt: number): EventIntegrityState;
export declare function cleanupOldEvents(state: EventIntegrityState, now: number, ttlMs?: number): EventIntegrityState;
//# sourceMappingURL=event-integrity.d.ts.map