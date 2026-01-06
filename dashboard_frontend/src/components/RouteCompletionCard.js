import React, { useMemo } from "react";
import { computeRouteStatus } from "../state/domainStore";

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

function pct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

// PUBLIC_INTERFACE
export default function RouteCompletionCard({ scopedState }) {
  /** Dashboard card showing overall and per-route completion details. */
  const routesList = useMemo(() => scopedState?.routes || [], [scopedState]);

  const overall = useMemo(() => {
    const totals = routesList.reduce(
      (acc, r) => {
        const planned = Number(r.planned_stops || 0);
        const completed = Number(r.completed_stops || 0);
        acc.planned += planned;
        acc.completed += completed;
        return acc;
      },
      { planned: 0, completed: 0 }
    );
    const completion = totals.planned <= 0 ? 0 : Math.round((totals.completed / totals.planned) * 100);
    return { ...totals, completion };
  }, [routesList]);

  const rows = useMemo(() => {
    return [...routesList]
      .map((r) => {
        const status = computeRouteStatus(r);
        return { route: r, status };
      })
      .sort((a, b) => Number(b.route.completion_percent || 0) - Number(a.route.completion_percent || 0));
  }, [routesList]);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Route Completion</h2>
          <p>Weighted by planned stops (routes visible in your scope)</p>
        </div>
        <span className="badge">
          Overall: <strong>{pct(overall.completion)}</strong>
        </span>
      </div>

      <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi">
          <div className="kpiLabel">Planned stops</div>
          <div className="kpiValue">{overall.planned}</div>
          <div className="kpiSub">Sum across routes</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Completed stops</div>
          <div className="kpiValue">{overall.completed}</div>
          <div className="kpiSub">Completed ÷ planned</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Completion</div>
          <div className="kpiValue">{pct(overall.completion)}</div>
          <div className="kpiSub">Weighted %</div>
        </div>
      </div>

      <hr className="hr" />

      <div className="tableWrap">
        <table className="table" aria-label="Route completion list" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Route</th>
              <th>Planned</th>
              <th>Completed</th>
              <th>Missed</th>
              <th>On Hold</th>
              <th>Postponed</th>
              <th>Completion</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ route, status }) => (
              <tr key={route.id}>
                <td style={{ fontWeight: 900 }}>{route.name}</td>
                <td>{route.planned_stops ?? 0}</td>
                <td>{route.completed_stops ?? 0}</td>
                <td>{route.missed_stops ?? 0}</td>
                <td>{route.on_hold_stops ?? 0}</td>
                <td>{route.postponed_stops ?? 0}</td>
                <td>{pct(route.completion_percent || 0)}</td>
                <td>
                  <span className={toneToBadgeClass(status.tone)}>{status.label}</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="mini">
                  No routes in scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <hr className="hr" />

      <div className="mini">
        Thresholds: <strong>Completed</strong> ≥ 95% · <strong>On Track</strong> 80–94% · <strong>Behind</strong> 60–79% ·{" "}
        <strong>At Risk</strong> &lt; 60%.
      </div>
    </div>
  );
}
