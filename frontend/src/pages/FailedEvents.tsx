import { useEffect, useState } from "react";
import { FailedEventList } from "../components/FailedEventList";
import { ReportCard } from "../components/ReportCard";
import { getFailedEvents, type FailedEvent } from "../api/client";

export function FailedEvents() {
  const [events, setEvents] = useState<FailedEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const failedEvents = await getFailedEvents();
        if (active) {
          setEvents(failedEvents);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load failed events");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <ReportCard title="Failed Events" subtitle="Operational events rejected or not processed">
      {isLoading ? <p className="empty-state">Loading failed events...</p> : null}
      {error ? <p className="status-error">{error}</p> : null}
      {!isLoading && !error ? <FailedEventList events={events} /> : null}
    </ReportCard>
  );
}
