import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EventForm } from "../components/EventForm";
import { ReportCard } from "../components/ReportCard";
import { getCoReport, type CoShipReport } from "../api/client";

export function Dashboard() {
  const [ships, setShips] = useState<CoShipReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const report = await getCoReport();
        if (active) {
          setShips(report.ships);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
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
    <div className="page-grid">
      <ReportCard title="Command Dashboard" subtitle="Fleet-wide operational snapshot">
        {isLoading ? <p className="empty-state">Loading command report...</p> : null}
        {error ? <p className="status-error">{error}</p> : null}
        {!isLoading && !error ? (
          <ul className="list">
            {ships.map((ship) => (
              <li key={ship.shipId} className="list-row">
                <div>
                  <Link className="ship-link" to={`/ship/${encodeURIComponent(ship.shipId)}`}>
                    {ship.shipId}
                  </Link>
                  <p className="muted">
                    Overdue: {ship.overdueCount} | Critical: {ship.criticalCount}
                  </p>
                </div>
                <span className={`pill pill-${ship.status.toLowerCase()}`}>{ship.status}</span>
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
