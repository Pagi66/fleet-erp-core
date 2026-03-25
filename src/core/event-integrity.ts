export const DEFAULT_PROCESSED_EVENT_TTL_MS = 24 * 60 * 60 * 1000;

export interface EventIntegrityState {
  processedEvents: Record<string, number>;
}

export function isDuplicateEvent(
  eventId: string,
  state: EventIntegrityState,
): boolean {
  return typeof state.processedEvents[eventId] === "number";
}

export function markEventProcessed(
  eventId: string,
  state: EventIntegrityState,
  processedAt: number,
): EventIntegrityState {
  return {
    processedEvents: {
      ...state.processedEvents,
      [eventId]: processedAt,
    },
  };
}

export function cleanupOldEvents(
  state: EventIntegrityState,
  now: number,
  ttlMs = DEFAULT_PROCESSED_EVENT_TTL_MS,
): EventIntegrityState {
  return {
    processedEvents: Object.fromEntries(
      Object.entries(state.processedEvents)
        .filter(([, processedAt]) => now - processedAt <= ttlMs)
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId)),
    ),
  };
}
