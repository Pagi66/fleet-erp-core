import { Link, useParams } from "react-router-dom";
import { ReportCard } from "../components/ReportCard";
import { SignalList } from "../components/SignalList";
import { useShipOverviewState } from "../state/ship-overview-store";
import { createShipOverviewViewModel } from "../view-models/ship-overview.vm";

export function ShipView() {
  const { shipId = "" } = useParams();
  const shipOverview = useShipOverviewState(shipId);
  const viewModel = shipOverview.data ? createShipOverviewViewModel(shipOverview.data) : null;

  return (
    <div className="page-grid">
      <ReportCard
        title={viewModel?.title ?? `Ship ${shipId}`}
        subtitle="Operational detail"
        actions={
          <Link className="button-link" to="/">
            Back to Dashboard
          </Link>
        }
      >
        {shipOverview.status === "loading" ? <p className="empty-state">Loading ship reports...</p> : null}
        {shipOverview.error ? <p className="status-error">{shipOverview.error}</p> : null}
        {viewModel ? (
          <div className="metrics-grid">
            {viewModel.metrics.map((metric) => (
              <div key={metric.label} className="metric">
                <span className="metric-label">{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </ReportCard>

      <ReportCard title="Compliance Signals" subtitle="Filtered from /compliance?limit=50">
        <SignalList signals={viewModel?.signals ?? []} />
      </ReportCard>
    </div>
  );
}
