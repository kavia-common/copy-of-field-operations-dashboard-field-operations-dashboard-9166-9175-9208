import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Roles } from "../data/dummyData";
import {
  computeAllocationSummary,
  computeDprSnapshot,
  computeExceptionsSummary,
  computeRouteCompletionSummary,
} from "../state/domainStore";
import { downloadCsv, toCsv } from "../utils/csv";
import MapPanel from "../components/MapPanel";
import AllocationPanel from "../components/AllocationPanel";
import ExceptionsPanel from "../components/ExceptionsPanel";
import Modal from "../components/Modal";

function pct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

function miniButtonStyle() {
  return { padding: "8px 10px", fontSize: 12 };
}

function routeRemainingLabel(r) {
  return `${r.remaining} remaining`;
}

// PUBLIC_INTERFACE
export default function DashboardPage({ scopedState, fullState, setFullState, currentUser }) {
  /** Dashboard page showing map + key operational metric cards with drill-down modals. */
  const navigate = useNavigate();
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [activeModal, setActiveModal] = useState(""); // "routes" | "allocation" | "exceptions" | ""

  const todayIso = useMemo(() => new Date().toISOString(), []);
  const routeSummary = useMemo(() => computeRouteCompletionSummary(scopedState, { dateIso: todayIso }), [scopedState, todayIso]);
  const allocationSummary = useMemo(
    () => computeAllocationSummary(fullState, scopedState, { dateIso: todayIso }),
    [fullState, scopedState, todayIso]
  );
  const exceptionsSummary = useMemo(() => computeExceptionsSummary(scopedState, { dateIso: todayIso }), [scopedState, todayIso]);
  const dprSnapshot = useMemo(() => computeDprSnapshot(fullState, currentUser, { dateIso: todayIso }), [fullState, currentUser, todayIso]);

  const topRemainingRoutes = useMemo(() => {
    return (routeSummary.perRoute || []).filter((r) => r.remaining > 0).slice(0, 3);
  }, [routeSummary.perRoute]);

  const canManageAllocation = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;

  function exportDprSnapshotCsv() {
    const rows = [
      {
        date: dprSnapshot.date,
        planned_tasks: dprSnapshot.planned,
        completed_tasks: dprSnapshot.completed,
        on_hold: dprSnapshot.onHold,
        postponed: dprSnapshot.postponed,
      },
    ];

    const csv = toCsv(rows, [
      { key: "date", label: "Date" },
      { key: "planned_tasks", label: "Planned Tasks" },
      { key: "completed_tasks", label: "Completed Tasks" },
      { key: "on_hold", label: "On Hold" },
      { key: "postponed", label: "Postponed" },
    ]);

    downloadCsv({ filename: `dpr_snapshot_${dprSnapshot.date}.csv`, csvText: csv });
  }

  return (
    <div className="content">
      {/* Top: full-width map */}
      <div data-testid="dashboard-map">
        <MapPanel scopedState={scopedState} selectedRouteId={selectedRouteId} onSelectRouteId={setSelectedRouteId} />
      </div>

      {/* Bottom: four key metric cards */}
      <div className="dashboardMetricsGrid" data-testid="dashboard-metrics">
        {/* 1) Route Completion */}
        <section className="card" aria-label="Route completion summary" data-testid="metric-route-completion">
          <div className="cardHeader">
            <div>
              <h2>Route Completion</h2>
              <p>Overall completion today + routes with the most remaining work</p>
            </div>
            <span className="badge">
              <strong>{pct(routeSummary.overallCompletionPercent)}</strong>
            </span>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div className="mini">
              {routeSummary.totalCompletedStops}/{routeSummary.totalPlannedStops} stops completed (weighted).
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div className="mini" style={{ fontWeight: 800, color: "var(--ocean-text)" }}>
                Top remaining (routes)
              </div>
              {topRemainingRoutes.map((r) => (
                <div key={r.routeId} className="metricRow">
                  <div style={{ fontWeight: 900, minWidth: 0 }}>
                    <div className="metricRowTitle">{r.routeName}</div>
                    <div className="mini">{pct(r.completionPercent)} complete</div>
                  </div>
                  <span className="badge badgeWarn">{routeRemainingLabel(r)}</span>
                </div>
              ))}
              {topRemainingRoutes.length === 0 ? <div className="mini">No remaining stops across routes.</div> : null}
            </div>

            <div className="splitRow">
              <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => setActiveModal("routes")}>
                View details
              </button>
              {selectedRouteId ? (
                <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => navigate("/tasks")}>
                  View tasks (selected route)
                </button>
              ) : (
                <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => navigate("/tasks")}>
                  View tasks
                </button>
              )}
            </div>
          </div>
        </section>

        {/* 2) Engineer Allocation */}
        <section className="card" aria-label="Engineer allocation summary" data-testid="metric-allocation">
          <div className="cardHeader">
            <div>
              <h2>Engineer Allocation</h2>
              <p>Allocated vs unallocated engineers + workload signal</p>
            </div>
            <span className="badge">{allocationSummary.engineersInScopeCount} engineers</span>
          </div>

          <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div className="kpi">
              <div className="kpiLabel">Allocated</div>
              <div className="kpiValue">{allocationSummary.allocatedCount}</div>
              <div className="kpiSub">Assigned to a route</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Unallocated</div>
              <div className="kpiValue">{allocationSummary.unallocatedCount}</div>
              <div className="kpiSub">No route assignment</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Avg workload</div>
              <div className="kpiValue">{allocationSummary.avgWorkloadPerEngineer}</div>
              <div className="kpiSub">Tasks due today + assigned routes</div>
            </div>
          </div>

          <hr className="hr" />

          <div className="splitRow">
            <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => setActiveModal("allocation")}>
              Drill down
            </button>

            <Link className="btn btnGhost" style={miniButtonStyle()} to="/allocation" aria-label="Go to Allocation page">
              Go to Allocation
            </Link>
          </div>

          {!canManageAllocation ? (
            <div className="mini" style={{ marginTop: 10 }}>
              Allocation management is restricted to Admin / Regional Manager. You can view allocation details read-only here.
            </div>
          ) : null}
        </section>

        {/* 3) Rejected/Redo Tasks */}
        <section className="card" aria-label="Rejected and redo tasks summary" data-testid="metric-exceptions">
          <div className="cardHeader">
            <div>
              <h2>Exceptions</h2>
              <p>Rejected and redo tasks due today</p>
            </div>
            <span className="badge badgeError">
              <strong>{exceptionsSummary.today.total}</strong> today
            </span>
          </div>

          <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div className="kpi">
              <div className="kpiLabel">Rejected</div>
              <div className="kpiValue">{exceptionsSummary.today.rejected}</div>
              <div className="kpiSub">Due today</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Redo</div>
              <div className="kpiValue">{exceptionsSummary.today.redo}</div>
              <div className="kpiSub">Due today</div>
            </div>
          </div>

          <hr className="hr" />

          <div className="splitRow">
            <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => setActiveModal("exceptions")}>
              View details
            </button>
            <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => navigate("/tasks")}>
              Go to Tasks
            </button>
          </div>

          <div className="mini" style={{ marginTop: 10 }}>
            Tip: resolve exceptions via Tasks actions. This dashboard view is a quick operational alert.
          </div>
        </section>

        {/* 4) DPR Snapshot */}
        <section className="card" aria-label="Daily progress report snapshot" data-testid="metric-dpr">
          <div className="cardHeader">
            <div>
              <h2>DPR Snapshot</h2>
              <p>Today&apos;s task KPIs (scope-aware)</p>
            </div>
            <span className="badge">{dprSnapshot.date}</span>
          </div>

          <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div className="kpi">
              <div className="kpiLabel">Planned tasks</div>
              <div className="kpiValue">{dprSnapshot.planned}</div>
              <div className="kpiSub">Due today</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Completed</div>
              <div className="kpiValue">{dprSnapshot.completed}</div>
              <div className="kpiSub">
                {pct(dprSnapshot.planned ? (dprSnapshot.completed / dprSnapshot.planned) * 100 : 0)} completion
              </div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">On hold</div>
              <div className="kpiValue">{dprSnapshot.onHold}</div>
              <div className="kpiSub">Needs attention</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Postponed</div>
              <div className="kpiValue">{dprSnapshot.postponed}</div>
              <div className="kpiSub">Reschedule required</div>
            </div>
          </div>

          <hr className="hr" />

          <div className="splitRow">
            <button className="btn btnPrimary" style={miniButtonStyle()} onClick={exportDprSnapshotCsv}>
              Export DPR (CSV)
            </button>
            <Link className="btn btnGhost" style={miniButtonStyle()} to="/dpr">
              Open full DPR
            </Link>
          </div>
        </section>
      </div>

      {/* Route completion details modal */}
      <Modal
        open={activeModal === "routes"}
        title="Route Completion Details"
        description="Full per-route completion table (weighted by planned stops)."
        onClose={() => setActiveModal("")}
        maxWidth={1100}
      >
        <div className="tableWrap">
          <table className="table" aria-label="Route completion details" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Route</th>
                <th>Planned stops</th>
                <th>Completed stops</th>
                <th>Remaining</th>
                <th>Completion</th>
              </tr>
            </thead>
            <tbody>
              {(routeSummary.perRoute || []).map((r) => (
                <tr key={r.routeId}>
                  <td style={{ fontWeight: 900 }}>{r.routeName}</td>
                  <td>{r.planned}</td>
                  <td>{r.completed}</td>
                  <td>{r.remaining}</td>
                  <td>{pct(r.completionPercent)}</td>
                </tr>
              ))}
              {(routeSummary.perRoute || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="mini">
                    No routes in scope.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* Allocation drill-down modal (reuse AllocationPanel read-only if needed) */}
      <Modal
        open={activeModal === "allocation"}
        title="Allocation Drill-down"
        description={canManageAllocation ? "Manage allocations here or open the full Allocation page." : "Read-only allocation visibility."}
        onClose={() => setActiveModal("")}
        maxWidth={1200}
        footer={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => setActiveModal("")}>
              Done
            </button>
            <Link className="btn btnPrimary" to="/allocation">
              Go to Allocation
            </Link>
          </div>
        }
      >
        <div style={!canManageAllocation ? { opacity: 0.8, pointerEvents: "none" } : undefined} aria-label="Allocation panel container">
          <AllocationPanel scopedState={scopedState} fullState={fullState} setFullState={setFullState} currentUser={currentUser} />
        </div>

        {!canManageAllocation ? (
          <div className="notice" style={{ marginTop: 12 }}>
            You are viewing this panel in read-only mode due to your role. Use Admin / Regional Manager credentials to manage allocations.
          </div>
        ) : null}
      </Modal>

      {/* Exceptions drill-down modal (filters preset to today not supported by panel state; show panel and highlight meaning) */}
      <Modal
        open={activeModal === "exceptions"}
        title="Exceptions Drill-down"
        description="Active rejected/redo tasks in your scope. (Dashboard KPI shows due-today counts.)"
        onClose={() => setActiveModal("")}
        maxWidth={1250}
        footer={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => setActiveModal("")}>
              Done
            </button>
            <button className="btn btnPrimary" onClick={() => navigate("/tasks")}>
              Go to Tasks
            </button>
          </div>
        }
      >
        <div className="notice">
          <strong>Note:</strong> The Exceptions panel lists active rejected/redo tasks (regardless of due date). The KPI above counts only tasks due{" "}
          <strong>today</strong>.
        </div>

        <div style={{ marginTop: 12 }}>
          <ExceptionsPanel scopedState={scopedState} onSelectTaskId={() => navigate("/tasks")} />
        </div>
      </Modal>
    </div>
  );
}
