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
export default function RouteCompletionCard({ scopedState }) {
  /**
   * Minimal Route Completion dashboard card.
   *
   * Shows only:
   *  1) Routes completed
   *  2) Routes remaining
   *  3) Overall completion %
   *
   * Drill-down is intentionally disabled because route-level breakdown is handled elsewhere
   * (map + other operational views), and exceptions/compliance are surfaced in dedicated sections.
   */
  const metrics = useMemo(() => computeRouteCompletionMinimalMetrics(scopedState), [scopedState]);
  const overallTone = completionTone(metrics.overallCompletionPercent);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Route Completion</h2>
          <p>Minimal completion signal (routes + overall progress)</p>
        </div>

        <span className={toneToBadgeClass(overallTone)}>
          Overall: <strong>{pct(metrics.overallCompletionPercent)}</strong>
        </span>
      </div>

      <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi">
          <div className="kpiLabel">Routes completed</div>
          <div className="kpiValue">{metrics.completedRoutes}</div>
          <div className="kpiSub">All points covered + all tasks done</div>
        </div>

        <div className="kpi">
          <div className="kpiLabel">Routes remaining</div>
          <div className="kpiValue">{metrics.remainingRoutes}</div>
          <div className="kpiSub">Not yet complete</div>
        </div>

        <div className="kpi">
          <div className="kpiLabel">Overall completion</div>
          <div className="kpiValue">{pct(metrics.overallCompletionPercent)}</div>
          <div className="kpiSub">Based on route counts</div>
        </div>
      </div>

      <hr className="hr" />

      <div className="mini">
        Notes: a route is marked completed only when all route points are covered and all tasks on that route are completed. Exceptions
        and non-compliance are shown in their dedicated cards/sections.
      </div>
    </div>
  );
}
