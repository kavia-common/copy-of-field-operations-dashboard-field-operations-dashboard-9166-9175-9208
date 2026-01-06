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
   * Replaces the prior Exceptions drill-down card. Shows only:
   *  - Completed (tasks due today that are marked completed)
   *  - Rejected (tasks due today with status rejected)
   *  - Redo (tasks due today with status redo)
   *
   * Note: This card is date-scoped by task dueDate (same scoping used elsewhere).
   */
  const counts = useMemo(() => selectTaskCountsByStatus(scopedState, { dateIso }), [scopedState, dateIso]);
  const tone = tasksTone(counts);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Tasks</h2>
          <p>Today&apos;s task outcomes (due date scope)</p>
        </div>

        <span className={toneToBadgeClass(tone)}>
          Date: <strong>{counts.date}</strong>
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

      <div className="mini">
        This card replaces the previous Exceptions drill-down. Use the Tasks page to review and resolve rejected/redo items.
      </div>
    </div>
  );
}
