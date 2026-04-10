import { getFailedEvents } from "../api/failed-events";

export interface FailedEventsData {
  events: Array<{
    eventId: string;
    reason: string;
    timestamp: number;
  }>;
}

export async function loadFailedEventsData(): Promise<FailedEventsData> {
  const events = await getFailedEvents();

  return {
    events: events.map((event) => ({
      eventId: event.eventId,
      reason: event.reason,
      timestamp: event.timestamp,
    })),
  };
}
