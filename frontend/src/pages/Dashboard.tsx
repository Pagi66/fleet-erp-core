import { Link } from "react-router-dom";
import { EventForm } from "../components/EventForm";
import { ReportCard } from "../components/ReportCard";
import { useDashboardState } from "../state/dashboard-store";
import { createDashboardViewModel } from "../view-models/dashboard.vm";

export function Dashboard() {
  const dashboard = useDashboardState();
  const viewModel = createDashboardViewModel(dashboard.data);

  return (
    <div className="page-grid">
      <ReportCard title="Command Dashboard" subtitle="Fleet-wide operational snapshot">
        {dashboard.status === "loading" ? <p className="empty-state">Loading command report...</p> : null}
        {dashboard.error ? <p className="status-error">{dashboard.error}</p> : null}
        {dashboard.status === "success" ? (
          <ul className="list">
            {viewModel.ships.map((ship) => (
              <li key={ship.shipId} className="list-row">
                <div>
                  <Link className="ship-link" to={ship.shipHref}>
                    {ship.shipId}
                  </Link>
                  <p className="muted">{ship.countsLabel}</p>
                </div>
                <span className={`pill pill-${ship.statusTone}`}>{ship.statusLabel}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </ReportCard>

      <ReportCard title="Submit Event" subtitle="Send an engine event to the Fleet ERP API">
        <EventForm />
      </ReportCard>
    </div>
  );
}
