import type { FailedEventsData } from "../services/failed-events.service";

export interface FailedEventViewModel {
  key: string;
  eventId: string;
  reason: string;
  formattedTimestamp: string;
}

export interface FailedEventsViewModel {
  events: FailedEventViewModel[];
}

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function createFailedEventsViewModel(data: FailedEventsData): FailedEventsViewModel {
  return {
    events: data.events.map((event) => ({
      key: `${event.eventId}-${event.timestamp}`,
      eventId: event.eventId,
      reason: event.reason,
      formattedTimestamp: formatter.format(new Date(event.timestamp)),
    })),
  };
}
