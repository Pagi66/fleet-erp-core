import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getComplianceSignals,
  getMeoReport,
  getWeoReport,
  type ComplianceSignal,
  type MeoReport,
  type WeoReport,
} from "../api/client";
import { ReportCard } from "../components/ReportCard";
import { SignalList } from "../components/SignalList";

export function ShipView() {
  const { shipId = "" } = useParams();
  const [meoReport, setMeoReport] = useState<MeoReport | null>(null);
  const [weoReport, setWeoReport] = useState<WeoReport | null>(null);
  const [signals, setSignals] = useState<ComplianceSignal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [meo, weo, compliance] = await Promise.all([
          getMeoReport(shipId),
          getWeoReport(shipId),
          getComplianceSignals(50),
        ]);

        if (!active) {
          return;
        }

        setMeoReport(meo);
        setWeoReport(weo);
        setSignals(compliance.filter((signal) => signal.shipId === shipId));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load ship view");
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
  }, [shipId]);

  return (
    <div className="page-grid">
      <ReportCard
        title={`Ship ${shipId}`}
        subtitle="Operational detail"
        actions={
          <Link className="button-link" to="/">
            Back to Dashboard
          </Link>
        }
      >
        {isLoading ? <p className="empty-state">Loading ship reports...</p> : null}
        {error ? <p className="status-error">{error}</p> : null}
        {!isLoading && !error && meoReport && weoReport ? (
          <div className="metrics-grid">
            <div className="metric">
              <span className="metric-label">MEO Pending</span>
              <strong>{meoReport.pendingCount}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">MEO Overdue</span>
              <strong>{meoReport.overdueCount}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">MEO Critical</span>
              <strong>{meoReport.criticalCount}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">WEO Tasks</span>
              <strong>{weoReport.totalTasks}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">WEO Overdue</span>
              <strong>{weoReport.overdueCount}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">WEO Status</span>
              <strong>{weoReport.status}</strong>
            </div>
          </div>
        ) : null}
      </ReportCard>

      <ReportCard title="Compliance Signals" subtitle="Filtered from /compliance?limit=50">
        <SignalList signals={signals} />
      </ReportCard>
    </div>
  );
}
