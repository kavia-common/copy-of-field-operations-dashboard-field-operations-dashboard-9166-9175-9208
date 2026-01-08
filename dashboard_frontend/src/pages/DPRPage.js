import React, { useMemo, useState } from "react";
import { computeDpr, computeRouteStatus } from "../state/domainStore";
import { downloadCsv, toCsv } from "../utils/csv";
import { Statuses, statusMeta } from "../data/dummyData";

function regionName(state, regionId) {
  return state.regions.find((r) => r.id === regionId)?.name || "—";
}

function routeName(state, routeId) {
  return state.routes.find((r) => r.id === routeId)?.name || "—";
}

function engineerName(state, engineerId) {
  return state.users.find((u) => u.id === engineerId)?.name || "—";
}

function pct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

// PUBLIC_INTERFACE
export default function DPRPage({ currentUser, fullState }) {
  /** Daily Progress Report view with role-based scope and export options. */
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const dpr = useMemo(() => computeDpr(fullState, currentUser, { dateIso: date }), [fullState, currentUser, date]);

  const routesRows = useMemo(() => {
    return (dpr.routesSummary || []).map((r) => ({
      ...r,
      regionName: regionName(fullState, r.regionId),
      status: computeRouteStatus({ completion_percent: r.completionPercent }).label,
    }));
  }, [dpr.routesSummary, fullState]);

  function handlePrint() {
    window.print();
  }

  function exportRoutesCsv() {
    const csv = toCsv(routesRows, [
      { key: "routeId", label: "Route ID" },
      { key: "routeName", label: "Route" },
      { key: "regionName", label: "Region" },
      { key: "planned", label: "Planned Stops" },
      { key: "completed", label: "Completed Stops" },
      { key: "completionPercent", label: "Completion %" },
      { key: "status", label: "Status" },
    ]);
    downloadCsv({ filename: `dpr_routes_${dpr.date}.csv`, csvText: csv });
  }

  function exportEngineerCsv() {
    const csv = toCsv(dpr.engineerPerformance || [], [
      { key: "engineerId", label: "Engineer ID" },
      { key: "engineerName", label: "Engineer" },
      { key: "regionId", label: "Region ID" },
      { key: "tasks", label: "Assignments" },
      { key: "completed", label: "Completed" },
      { key: "completionRate", label: "Completion %" },
      { key: "load", label: "Load" },
    ]);
    downloadCsv({ filename: `dpr_engineers_${dpr.date}.csv`, csvText: csv });
  }

  function exportExceptionsCsv() {
    const rows = (dpr.exceptions || []).map((e) => ({
      ...e,
      engineerName: engineerName(fullState, e.engineerId),
      regionName: regionName(fullState, e.regionId),
      routeName: routeName(fullState, e.routeId),
    }));
    const csv = toCsv(rows, [
      { key: "taskId", label: "Task ID" },
      { key: "title", label: "Title" },
      { key: "status", label: "Status" },
      { key: "engineerName", label: "Engineer" },
      { key: "regionName", label: "Region" },
      { key: "routeName", label: "Route" },
      { key: "rejection_reason", label: "Rejection Reason" },
      { key: "redo_reason", label: "Redo Reason" },
      { key: "redo_count", label: "Redo Count" },
    ]);
    downloadCsv({ filename: `dpr_exceptions_${dpr.date}.csv`, csvText: csv });
  }

  return (
    <div className="content">
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Daily Progress Report</h2>
            <p>Role-scoped operational snapshot for a selected date</p>
          </div>
          <span className="badge">{currentUser?.role}</span>
        </div>

        <div className="splitRow" style={{ marginBottom: 12 }}>
          <label className="input" style={{ minWidth: 280 }}>
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={handlePrint}>
              Print
            </button>
            <button className="btn btnGhost" onClick={exportRoutesCsv}>
              Export Routes CSV
            </button>
            <button className="btn btnGhost" onClick={exportEngineerCsv}>
              Export Engineers CSV
            </button>
            <button className="btn btnGhost" onClick={exportExceptionsCsv}>
              Export Exceptions CSV
            </button>
          </div>
        </div>

        <div className="kpiGrid">
          <div className="kpi">
            <div className="kpiLabel">Total routes</div>
            <div className="kpiValue">{dpr.kpis.totalRoutes}</div>
            <div className="kpiSub">Visible in scope</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Completed routes</div>
            <div className="kpiValue">{dpr.kpis.completedRoutes}</div>
            <div className="kpiSub">≥ 95% completion</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Overall route completion</div>
            <div className="kpiValue">{pct(dpr.kpis.overallRouteCompletionPercent)}</div>
            <div className="kpiSub">Weighted by planned stops</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Assignments (date)</div>
            <div className="kpiValue">{dpr.kpis.totalTasks}</div>
            <div className="kpiSub">
              Completed {dpr.kpis.completedTasks} · {pct(dpr.kpis.totalTasks ? (dpr.kpis.completedTasks / dpr.kpis.totalTasks) * 100 : 0)}
            </div>
          </div>
        </div>

        <hr className="hr" />

        <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="kpi">
            <div className="kpiLabel">Exceptions</div>
            <div className="kpiValue">{dpr.kpis.exceptions}</div>
            <div className="kpiSub">Rejected + Redo</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Rejected</div>
            <div className="kpiValue">{dpr.kpis.rejected}</div>
            <div className="kpiSub">Active rejected tasks (date)</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Redo</div>
            <div className="kpiValue">{dpr.kpis.redo}</div>
            <div className="kpiSub">Active redo tasks (date)</div>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="cardHeader">
            <div>
              <h2>Routes Summary</h2>
              <p>Planned vs completed stops by route</p>
            </div>
            <span className="badge">{routesRows.length} routes</span>
          </div>

          <div className="tableWrap">
            <table className="table" aria-label="Routes summary" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Region</th>
                  <th>Planned</th>
                  <th>Completed</th>
                  <th>Completion</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {routesRows.map((r) => {
                  const status = computeRouteStatus({ completion_percent: r.completionPercent });
                  return (
                    <tr key={r.routeId}>
                      <td style={{ fontWeight: 900 }}>{r.routeName}</td>
                      <td>{r.regionName}</td>
                      <td>{r.planned}</td>
                      <td>{r.completed}</td>
                      <td>{pct(r.completionPercent)}</td>
                      <td>
                        <span className={toneToBadgeClass(status.tone)}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
                {routesRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="mini">
                      No routes in scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="cardHeader">
            <div>
              <h2>Per-Region Breakdown</h2>
              <p>Routes, assignments, and exceptions</p>
            </div>
            <span className="badge">{(dpr.perRegion || []).length} regions</span>
          </div>

          <div className="tableWrap">
            <table className="table" aria-label="Per-region breakdown" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Routes</th>
                  <th>Route completion</th>
                  <th>Assignments</th>
                  <th>Assignment completion</th>
                  <th>Exceptions</th>
                </tr>
              </thead>
              <tbody>
                {(dpr.perRegion || []).map((r) => (
                  <tr key={r.regionId}>
                    <td style={{ fontWeight: 900 }}>{r.regionName}</td>
                    <td>
                      {r.completedRoutes}/{r.totalRoutes}
                    </td>
                    <td>{pct(r.routeCompletionPercent)}</td>
                    <td>
                      {r.completedTasks}/{r.totalTasks}
                    </td>
                    <td>{pct(r.taskCompletionPercent)}</td>
                    <td>{r.exceptions}</td>
                  </tr>
                ))}
                {(dpr.perRegion || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="mini">
                      No region data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <hr className="hr" />
          <div className="mini">
            Scope rules: Admin sees all regions; Regional Manager sees their region; Engineer sees their own tasks and assigned routes.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Engineer Performance</h2>
            <p>Assignments due on selected date</p>
          </div>
          <span className="badge">{(dpr.engineerPerformance || []).length} engineers</span>
        </div>

        <div className="tableWrap">
          <table className="table" aria-label="Engineer performance" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Engineer</th>
                <th>Region</th>
                <th>Assignments</th>
                <th>Completed</th>
                <th>Completion</th>
                <th>Load</th>
              </tr>
            </thead>
            <tbody>
              {(dpr.engineerPerformance || []).map((r) => (
                <tr key={r.engineerId}>
                  <td style={{ fontWeight: 900 }}>{r.engineerName}</td>
                  <td>{regionName(fullState, r.regionId)}</td>
                  <td>{r.tasks}</td>
                  <td>{r.completed}</td>
                  <td>{pct(r.completionRate)}</td>
                  <td>{r.load}</td>
                </tr>
              ))}
              {(dpr.engineerPerformance || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="mini">
                    No engineers in scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Exceptions (date)</h2>
            <p>Rejected / Redo assignments due on selected date</p>
          </div>
          <span className="badge">{(dpr.exceptions || []).length} exceptions</span>
        </div>

        <div className="tableWrap">
          <table className="table" aria-label="Exceptions table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Assignment</th>
                <th>Status</th>
                <th>Engineer</th>
                <th>Region</th>
                <th>Route</th>
                <th>Reason</th>
                <th>Redo #</th>
              </tr>
            </thead>
            <tbody>
              {(dpr.exceptions || []).map((t) => {
                const meta = statusMeta[t.status] || { label: t.status, tone: "neutral" };
                const reason = t.status === Statuses.REJECTED ? t.rejection_reason : t.redo_reason;
                return (
                  <tr key={t.taskId}>
                    <td>
                      <div style={{ fontWeight: 900 }}>{t.title}</div>
                      <div className="mini">{t.taskId}</div>
                    </td>
                    <td>
                      <span className={toneToBadgeClass(meta.tone)}>{meta.label}</span>
                    </td>
                    <td>{engineerName(fullState, t.engineerId)}</td>
                    <td>{regionName(fullState, t.regionId)}</td>
                    <td>{routeName(fullState, t.routeId)}</td>
                    <td>{reason ? reason : <span className="mini">—</span>}</td>
                    <td>{t.status === Statuses.REDO ? t.redo_count || 0 : <span className="mini">—</span>}</td>
                  </tr>
                );
              })}
              {(dpr.exceptions || []).length === 0 && (
                <tr>
                  <td colSpan={7} className="mini">
                    No exceptions for selected date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
