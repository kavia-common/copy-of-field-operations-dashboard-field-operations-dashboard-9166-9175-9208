import React, { useMemo, useState } from "react";
import { computeMetrics } from "../state/domainStore";
import { Statuses } from "../data/dummyData";
import MapPanel from "../components/MapPanel";

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
            <div className="kpiLabel">Completion rate</div>
            <div className="kpiValue">{pct(metrics.completionRate)}</div>
            <div className="kpiSub">Completed ÷ total</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Engineers</div>
            <div className="kpiValue">{metrics.engineersCount}</div>
            <div className="kpiSub">Active field engineers visible</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">In progress</div>
            <div className="kpiValue">{metrics.byStatus[Statuses.IN_PROGRESS] || 0}</div>
            <div className="kpiSub">Tasks currently in progress</div>
          </div>
        </div>
      </div>

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
            <strong>Status definitions:</strong> Completed, On Hold, and Postponed updates are tracked in status history and visible in task details.
          </div>
        </div>
      </div>
    </div>
  );
}
