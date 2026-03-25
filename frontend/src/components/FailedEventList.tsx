import type { FailedEvent } from "../api/client";

interface FailedEventListProps {
  events: FailedEvent[];
}

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function FailedEventList({ events }: FailedEventListProps) {
  if (events.length === 0) {
    return <p className="empty-state">No failed events found.</p>;
  }

  return (
    <ul className="list">
      {events.map((event) => (
        <li key={`${event.eventId}-${event.timestamp}`} className="list-row">
          <div>
            <strong>{event.eventId}</strong>
            <p className="muted">{event.reason}</p>
          </div>
          <time className="timestamp">{formatter.format(new Date(event.timestamp))}</time>
        </li>
      ))}
    </ul>
  );
}
