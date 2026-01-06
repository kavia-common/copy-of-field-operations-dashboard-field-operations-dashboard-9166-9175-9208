import React, { useMemo } from "react";
import { computeRouteCompletionMinimalMetrics } from "../state/domainStore";

function pct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

function completionTone(completionPercent) {
  const p = Number(completionPercent || 0);
  if (p >= 90) return "success";
  if (p >= 60) return "warn";
  return "error";
}

// PUBLIC_INTERFACE
export default function RouteCompletionCard({ scopedState, dateIso, onShowDetails }) {
  /**
   * Route Completion dashboard card (compact + uniform-height).
   *
   * Required visible KPIs:
   *  - Completed
   *  - To be completed (remaining)
   *  - Overall % (badge retained)
   * Plus: a small helper subtext.
   *
   * Drill-down trigger renamed to "Show details" and delegated to parent via onShowDetails.
   */
  const metrics = useMemo(() => computeRouteCompletionMinimalMetrics(scopedState), [scopedState]);
  const overallTone = completionTone(metrics.overallCompletionPercent);

  return (
    <div className="card kpiCardFixed" aria-label="Route Completion KPI card">
      <div className="cardHeader">
        <div>
          <h2>Route Completion</h2>
          <p>Overall route progress</p>
        </div>

        <span className={toneToBadgeClass(overallTone)} aria-label="Overall route completion percent">
          Overall: <strong>{pct(metrics.overallCompletionPercent)}</strong>
        </span>
      </div>

      <div className="kpiCardBody">
        <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="kpi">
            <div className="kpiLabel">Completed</div>
            <div className="kpiValue">{metrics.completedRoutes}</div>
            <div className="kpiSub">Routes fully closed</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">To be completed</div>
            <div className="kpiValue">{metrics.remainingRoutes}</div>
            <div className="kpiSub">Still in progress</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Total routes</div>
            <div className="kpiValue">{metrics.totalRoutes}</div>
            <div className="kpiSub">In current scope</div>
          </div>
        </div>

        <hr className="hr" />

        <div className="mini">
          Helper: a route counts as <strong>completed</strong> only when all planned stops are covered and all tasks on the route are
          completed.
        </div>
      </div>

      <div className="kpiCardFooter">
        <div className="splitRow" style={{ marginTop: 10 }}>
          <button
            className="btn btnGhost detailsLink"
            onClick={() => onShowDetails?.()}
            aria-label="Show route completion details"
          >
            Show details
          </button>
        </div>
      </div>
    </div>
  );
}
