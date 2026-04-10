import { FailedEventList } from "../components/FailedEventList";
import { ReportCard } from "../components/ReportCard";
import { useFailedEventsState } from "../state/failed-events-store";
import { createFailedEventsViewModel } from "../view-models/failed-events.vm";

export function FailedEvents() {
  const failedEvents = useFailedEventsState();
  const viewModel = createFailedEventsViewModel(failedEvents.data);

  return (
    <ReportCard title="Failed Events" subtitle="Operational events rejected or not processed">
      {failedEvents.status === "loading" ? <p className="empty-state">Loading failed events...</p> : null}
      {failedEvents.error ? <p className="status-error">{failedEvents.error}</p> : null}
      {failedEvents.status === "success" ? <FailedEventList events={viewModel.events} /> : null}
    </ReportCard>
  );
}
