import type { ShipSignalViewModel } from "../view-models/ship-overview.vm";

interface SignalListProps {
  signals: ShipSignalViewModel[];
}

export function SignalList({ signals }: SignalListProps) {
  if (signals.length === 0) {
    return <p className="empty-state">No compliance signals for this ship.</p>;
  }

  return (
    <ul className="list">
      {signals.map((signal) => (
        <li key={signal.key} className="list-row">
          <div>
            <strong>{signal.title}</strong>
            <p className="muted">{signal.message}</p>
          </div>
          <div className="pill-group">
            <span className={`pill pill-${signal.severityTone}`}>{signal.severityLabel}</span>
            <span className="pill">{signal.scopeLabel}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
