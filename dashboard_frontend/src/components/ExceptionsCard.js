import React, { useMemo } from "react";
import { selectTaskCountsByStatus } from "../state/domainStore";

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
export default function ExceptionsCard({ scopedState, dateIso }) {
  /**
   * Dashboard "Tasks" KPI card (simplified).
   *
   * Shows:
   *  - Total tasks (badge): sum of the same scoped tasks used by the KPI tiles below
   *  - Completed (tasks due today that are marked completed)
   *  - Rejected (tasks due today with status rejected)
   *  - Redo (tasks due today with status redo)
   *
   * Note: This card is scoped by permissions (scopedState) AND date-scoped by task dueDate
   * (same scoping used elsewhere).
   */
  const counts = useMemo(() => selectTaskCountsByStatus(scopedState, { dateIso }), [scopedState, dateIso]);
  const tone = tasksTone(counts);

  // Total tasks must match the same scope/date criteria used for the other counts.
  const totalTasks = Number(counts.completed || 0) + Number(counts.rejected || 0) + Number(counts.redo || 0);

  return (
    <div className="card">
      <div className="cardHeader">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Tasks</h2>
          <span className="badge" aria-label="Total tasks due today in current scope">
            Total: <strong>{totalTasks}</strong>
          </span>
          <p style={{ margin: 0, width: "100%" }}>Today&apos;s task outcomes ({counts.date})</p>
        </div>

        <span className={toneToBadgeClass(tone)} aria-label="Total tasks due today in current scope">
          Total: <strong>{totalTasks}</strong>
        </span>
      </div>

      <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi">
          <div className="kpiLabel">Completed</div>
          <div className="kpiValue">{counts.completed}</div>
          <div className="kpiSub">Marked completed</div>
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

      <div className="mini">Notes: Tasks overview</div>
    </div>
  );
}
