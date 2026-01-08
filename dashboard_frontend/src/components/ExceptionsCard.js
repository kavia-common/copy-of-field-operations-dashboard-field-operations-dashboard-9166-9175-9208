import React, { useMemo } from "react";
import { selectTaskCountsByStatus } from "../state/domainStore";

function pct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

function tasksTone({ rejected, redo }) {
  const exceptions = Number(rejected || 0) + Number(redo || 0);
  if (exceptions <= 0) return "success";
  if (exceptions <= 2) return "warn";
  return "error";
}

// PUBLIC_INTERFACE
export default function ExceptionsCard({ scopedState, dateIso, onShowDetails }) {
  /**
   * Dashboard "Assignments" KPI card (uniform-height).
   *
   * Required KPIs:
   *  - Completed
   *  - Rejected
   *  - Redo
   *  - Total badge retained
   *
   * Additional compact data:
   *  - Completion rate (completed / total) helper subtext.
   *
   * Drill-down trigger renamed to "Show details" and delegated to parent via onShowDetails.
   */
  const counts = useMemo(() => selectTaskCountsByStatus(scopedState, { dateIso }), [scopedState, dateIso]);
  const tone = tasksTone(counts);

  const totalTasks = Number(counts.completed || 0) + Number(counts.rejected || 0) + Number(counts.redo || 0);
  const completionRate = totalTasks ? (Number(counts.completed || 0) / totalTasks) * 100 : 0;

  return (
    <div className="card kpiCardFixed" aria-label="Assignments KPI card">
      <div className="cardHeader">
        <div>
          <h2>Assignments</h2>
          <p>Today&apos;s outcomes ({counts.date})</p>
        </div>

        <span className={toneToBadgeClass(tone)} aria-label="Total assignments due today in current scope">
          Total: <strong>{totalTasks}</strong>
        </span>
      </div>

      <div className="kpiCardBody">
        <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="kpi">
            <div className="kpiLabel">Completed</div>
            <div className="kpiValue">{counts.completed}</div>
            <div className="kpiSub">{pct(completionRate)} completion</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Rejected</div>
            <div className="kpiValue" style={{ color: "var(--ocean-error)" }}>
              {counts.rejected}
            </div>
            <div className="kpiSub">Needs review</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Redo</div>
            <div className="kpiValue" style={{ color: "var(--ocean-secondary)" }}>
              {counts.redo}
            </div>
            <div className="kpiSub">Rework required</div>
          </div>
        </div>

        <hr className="hr" />

        <div className="mini">
          Totals reflect assignments <strong>due today</strong>.
        </div>
      </div>

      <div className="kpiCardFooter">
        <div className="splitRow" style={{ marginTop: 10 }}>
          <button className="btn btnGhost detailsLink" onClick={() => onShowDetails?.()} aria-label="Show task details">
            Show details
          </button>
        </div>
      </div>
    </div>
  );
}
