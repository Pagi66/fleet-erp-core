import type { ComplianceSignal } from "../api/client";

interface SignalListProps {
  signals: ComplianceSignal[];
}

export function SignalList({ signals }: SignalListProps) {
  if (signals.length === 0) {
    return <p className="empty-state">No compliance signals for this ship.</p>;
  }

  return (
    <ul className="list">
      {signals.map((signal, index) => (
        <li key={`${signal.type}-${signal.taskId ?? signal.defectId ?? index}`} className="list-row">
          <div>
            <strong>{signal.type}</strong>
            <p className="muted">{signal.message}</p>
          </div>
          <div className="pill-group">
            <span className={`pill pill-${signal.severity.toLowerCase()}`}>{signal.severity}</span>
            <span className="pill">{signal.shipId ?? "UNSCOPED"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
