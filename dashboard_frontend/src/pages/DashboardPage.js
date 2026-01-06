import React, { useMemo, useState } from "react";
import { computeMetrics } from "../state/domainStore";
import { Statuses } from "../data/dummyData";
import MapPanel from "../components/MapPanel";
import RouteCompletionCard from "../components/RouteCompletionCard";

function pct(n) {
  return `${n}%`;
}

export default function DashboardPage({ scopedState }) {
  const metrics = useMemo(() => computeMetrics(scopedState), [scopedState]);
  const [selectedRouteId, setSelectedRouteId] = useState("");

  return (
    <div className="content">
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Key Metrics</h2>
            <p>Overall counts and completion rate</p>
          </div>
          <span className="badge">Scope: current role</span>
        </div>

        <div className="kpiGrid">
          <div className="kpi">
            <div className="kpiLabel">Total tasks</div>
            <div className="kpiValue">{metrics.totalTasks}</div>
            <div className="kpiSub">All tasks visible in your scope</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Task completion</div>
            <div className="kpiValue">{pct(metrics.completionRate)}</div>
            <div className="kpiSub">Completed ÷ total</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Engineers</div>
            <div className="kpiValue">{metrics.engineersCount}</div>
            <div className="kpiSub">Active field engineers visible</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Exceptions</div>
            <div className="kpiValue">{metrics.exceptions.total}</div>
            <div className="kpiSub">
              Rejected {metrics.exceptions.rejected} · Redo {metrics.exceptions.redo}
            </div>
          </div>
        </div>
      </div>

      <RouteCompletionCard scopedState={scopedState} />

      <div className="grid2">
        <MapPanel scopedState={scopedState} selectedRouteId={selectedRouteId} onSelectRouteId={setSelectedRouteId} />

        <div className="card">
          <div className="cardHeader">
            <div>
              <h2>Per-Region Summary</h2>
              <p>Task counts and completion by region</p>
            </div>
            <span className="badge">{metrics.perRegion.length} regions</span>
          </div>

          <div className="tableWrap">
            <table className="table" aria-label="Per-region metrics">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Tasks</th>
                  <th>Completed</th>
                  <th>Completion</th>
                </tr>
              </thead>
              <tbody>
                {metrics.perRegion.map((r) => (
                  <tr key={r.regionId}>
                    <td style={{ fontWeight: 800 }}>{r.regionName}</td>
                    <td>{r.tasks}</td>
                    <td>{r.completed}</td>
                    <td>{pct(r.completionRate)}</td>
                  </tr>
                ))}
                {metrics.perRegion.length === 0 && (
                  <tr>
                    <td colSpan={4} className="mini">
                      No region data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <hr className="hr" />

          <div className="notice">
            <strong>Status definitions:</strong> Updates are tracked in status history (including exceptions). Use the Tasks page to view history and resolve rejected/redo tasks.
          </div>

          <hr className="hr" />

          <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div className="kpi">
              <div className="kpiLabel">Routes (scope)</div>
              <div className="kpiValue">{metrics.totalRoutes}</div>
              <div className="kpiSub">Routes visible</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Route completion</div>
              <div className="kpiValue">{pct(metrics.routesOverall.completionPercent)}</div>
              <div className="kpiSub">
                {metrics.routesOverall.completed}/{metrics.routesOverall.planned} completed stops
              </div>
            </div>
          </div>

          <hr className="hr" />

          <div className="mini">
            Map polylines are color-coded by route completion. Selected route: <strong>{selectedRouteId || "None"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
