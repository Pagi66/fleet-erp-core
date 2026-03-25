"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROCESSED_EVENT_TTL_MS = void 0;
exports.isDuplicateEvent = isDuplicateEvent;
exports.markEventProcessed = markEventProcessed;
exports.cleanupOldEvents = cleanupOldEvents;
exports.DEFAULT_PROCESSED_EVENT_TTL_MS = 24 * 60 * 60 * 1000;
function isDuplicateEvent(eventId, state) {
    return typeof state.processedEvents[eventId] === "number";
}
function markEventProcessed(eventId, state, processedAt) {
    return {
        processedEvents: {
            ...state.processedEvents,
            [eventId]: processedAt,
        },
    };
}
function cleanupOldEvents(state, now, ttlMs = exports.DEFAULT_PROCESSED_EVENT_TTL_MS) {
    return {
        processedEvents: Object.fromEntries(Object.entries(state.processedEvents)
            .filter(([, processedAt]) => now - processedAt <= ttlMs)
            .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))),
    };
}
//# sourceMappingURL=event-integrity.js.map