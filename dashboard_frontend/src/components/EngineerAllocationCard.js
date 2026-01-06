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
export default function EngineerAllocationCard({ scopedState, dateIso }) {
  /**
   * Dashboard KPI card: Engineer Allocation (simplified).
   *
   * Spec:
   *  - Badge/pill: Total Engineers
   *  - Two rows only: Active and Inactive
   *
   * Definitions:
   *  - Active: on-duty/online engineers (best-effort from dummy data)
   *  - Inactive: off-duty/offline engineers (best-effort from dummy data)
   */
  const counts = useMemo(() => selectEngineerAllocationCounts(scopedState, { dateIso }), [scopedState, dateIso]);

  return (
    <div className="card" aria-label="Engineer Allocation">
      <div className="cardHeader">
        <div>
          <h2>Engineer Allocation</h2>
          <p>Active vs inactive engineers (scope-aware)</p>
        </div>

        <span className="badge" aria-label="Total engineers in current scope">
          <strong>{counts.totalEngineers}</strong> Total Engineers
        </span>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={rowStyle()}>
          <div style={{ fontWeight: 900 }}>Active</div>
          <div style={{ fontWeight: 950, fontSize: 18, color: "var(--ocean-success)" }}>{counts.activeCount}</div>
        </div>

        <div style={rowStyle()}>
          <div style={{ fontWeight: 900 }}>Inactive</div>
          <div style={{ fontWeight: 950, fontSize: 18, color: "var(--ocean-muted)" }}>{counts.inactiveCount}</div>
        </div>
      </div>

      <div className="mini" style={{ marginTop: 10 }}>
        Active represents on-duty/online engineers; Inactive represents off-duty/offline engineers.
      </div>
    </div>
  );
}
