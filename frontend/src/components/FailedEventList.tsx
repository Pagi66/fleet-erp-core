import type { FailedEventViewModel } from "../view-models/failed-events.vm";

interface FailedEventListProps {
  events: FailedEventViewModel[];
}

export function FailedEventList({ events }: FailedEventListProps) {
  if (events.length === 0) {
    return <p className="empty-state">No failed events found.</p>;
  }

  return (
    <ul className="list">
      {events.map((event) => (
        <li key={event.key} className="list-row">
          <div>
            <strong>{event.eventId}</strong>
            <p className="muted">{event.reason}</p>
          </div>
          <time className="timestamp">{event.formattedTimestamp}</time>
        </li>
      ))}
    </ul>
  );
}
