import React, { useMemo } from "react";
import { selectAssignmentOutcomeCountsForToday } from "../state/domainStore";

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
   * 03.01 update:
   * - KPIs are now assignment-table-driven for "today":
   *     include assignments where start_date OR due_date === today
   *   and compute completed/rejected/redo from tasks belonging to those assignments.
   */
  const counts = useMemo(
    () => selectAssignmentOutcomeCountsForToday(scopedState, { dateIso }),
    [scopedState, dateIso]
  );
  const tone = tasksTone(counts);

  // “Total” should match the Assignments table row count for today scope.
  const plannedAssignments = Number(counts.plannedAssignments || 0);

  // Completion rate is displayed relative to planned assignments (table count).
  const completionRate = plannedAssignments ? (Number(counts.completed || 0) / plannedAssignments) * 100 : 0;

  return (
    <div className="card kpiCardFixed" aria-label="Assignments KPI card">
      <div className="cardHeader">
        <div>
          <h2>Assignments</h2>
          <p>Today&apos;s outcomes ({counts.date})</p>
        </div>

        <span className={toneToBadgeClass(tone)} aria-label="Planned assignments in scope today (assignment table)">
          Planned: <strong>{plannedAssignments}</strong>
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
          Totals reflect assignments with <strong>start date</strong> or <strong>due date</strong> equal to today.
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
