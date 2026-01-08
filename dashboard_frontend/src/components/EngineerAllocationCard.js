import React, { useMemo } from "react";
import { selectEngineerAllocationCounts } from "../state/domainStore";

function rowStyle() {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 10px",
    borderRadius: 12,
    border: "1px solid var(--ocean-border)",
    background: "rgba(17, 24, 39, 0.02)",
  };
}

// PUBLIC_INTERFACE
export default function EngineerAllocationCard({ scopedState, dateIso, onShowDetails }) {
  /**
   * Dashboard KPI card: Engineer Allocation (uniform-height).
   *
   * Required:
   *  - Total badge: Total Engineers
   *  - Two rows: Active / Inactive
   *
   * Additional compact helper:
   *  - Clarify that Active is best-effort derived from location/assignment/tasks.
   *
   * Drill-down trigger renamed to "Show details" and delegated to parent via onShowDetails.
   */
  const counts = useMemo(() => selectEngineerAllocationCounts(scopedState, { dateIso }), [scopedState, dateIso]);

  return (
    <div className="card kpiCardFixed" aria-label="Engineer Allocation KPI card">
      <div className="cardHeader">
        <div>
          <h2>Engineer Allocation</h2>
          <p>Active vs idle engineers (real-time, scope-aware)</p>
        </div>

        <span className="badge" aria-label="Total engineers in current scope">
          <strong>{counts.totalEngineers}</strong> Total Engineers
        </span>
      </div>

      <div className="kpiCardBody">
        <div style={{ display: "grid", gap: 10 }}>
          <div style={rowStyle()}>
            <div style={{ fontWeight: 900 }}>Active (assigned)</div>
            <div style={{ fontWeight: 950, fontSize: 18, color: "var(--ocean-success)" }}>{counts.activeCount}</div>
          </div>

          <div style={rowStyle()}>
            <div style={{ fontWeight: 900 }}>Idle (unassigned)</div>
            <div style={{ fontWeight: 950, fontSize: 18, color: "var(--ocean-secondary)" }}>{counts.idleCount}</div>
          </div>
        </div>

        <div className="mini" style={{ marginTop: 10 }}>
          Active/Idle are derived from <strong>live location</strong> + <strong>route assignments</strong> on each refresh tick. Offline engineers are excluded from
          both and counted separately in drill-down.
        </div>
      </div>

      <div className="kpiCardFooter">
        <div className="splitRow" style={{ marginTop: 10 }}>
          <button className="btn btnGhost detailsLink" onClick={() => onShowDetails?.()} aria-label="Show allocation details">
            Show details
          </button>
        </div>
      </div>
    </div>
  );
}
