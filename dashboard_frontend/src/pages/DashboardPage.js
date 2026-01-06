import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Roles } from "../data/dummyData";
import { computeAllocationSummary, computeDprSnapshot } from "../state/domainStore";
import {
  ComplianceSeverity,
  ensureComplianceComputed,
  selectActiveFlagsBySeverity,
} from "../state/compliance";
import { downloadCsv, toCsv } from "../utils/csv";
import MapPanel from "../components/MapPanel";
import AllocationPanel from "../components/AllocationPanel";
import ExceptionsPanel from "../components/ExceptionsPanel";
import Modal from "../components/Modal";
import RouteCompletionCard from "../components/RouteCompletionCard";
import { getLastRefreshMeta, runDummyRefreshOnce } from "../state/dummyRefresh";

function pct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

function miniButtonStyle() {
  return { padding: "8px 10px", fontSize: 12 };
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// PUBLIC_INTERFACE
export default function DashboardPage({ scopedState, fullState, setFullState, currentUser }) {
  /** Dashboard page showing map + key operational metric cards with drill-down modals. */
  const navigate = useNavigate();
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [activeModal, setActiveModal] = useState(""); // "allocation" | "exceptions" | "compliance" | ""

  const todayIso = useMemo(() => new Date().toISOString(), []);

  // Dummy refresh controls
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState(() => getLastRefreshMeta()?.lastRefreshedAt || "");

  const allocationSummary = useMemo(
    () => computeAllocationSummary(fullState, scopedState, { dateIso: todayIso }),
    [fullState, scopedState, todayIso]
  );
  const dprSnapshot = useMemo(
    () => computeDprSnapshot(fullState, currentUser, { dateIso: todayIso }),
    [fullState, currentUser, todayIso]
  );

  const complianceSnapshot = useMemo(() => {
    // Persist once per day so drill-down views remain stable across navigation.
    // Note: This can be recomputed on refresh only if there isn't already a snapshot for today.
    return ensureComplianceComputed(fullState, { dateIso: todayIso });
  }, [fullState, todayIso]);

  const complianceCounts = useMemo(() => selectActiveFlagsBySeverity(complianceSnapshot), [complianceSnapshot]);

  const canManageAllocation = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;

  const [complianceFilterSeverity, setComplianceFilterSeverity] = useState("");
  const [complianceSort, setComplianceSort] = useState("severity"); // severity | engineer | route

  // 30s refresh loop (simulated API polling)
  useEffect(() => {
    if (!autoRefreshEnabled) return undefined;

    const refresh = () => {
      const res = runDummyRefreshOnce(fullState);
      if (res.ok) {
        setFullState(res.state);
        setLastRefreshAt(res.refreshedAt);
      }
    };

    // Do not auto-refresh immediately on mount; keep UI stable until first interval tick.
    const id = window.setInterval(refresh, 30_000);

    return () => window.clearInterval(id);
  }, [autoRefreshEnabled, fullState, setFullState]);

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

  function manualRefreshNow() {
    const res = runDummyRefreshOnce(fullState);
    if (res.ok) {
      setFullState(res.state);
      setLastRefreshAt(res.refreshedAt);
    }
  }

  return (
    <div className="content">
      {/* Top: full-width map */}
      <div data-testid="dashboard-map">
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="splitRow" style={{ alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 900 }}>Live dummy feed</div>
              <div className="mini">
                Auto-refresh: <strong>{autoRefreshEnabled ? "ON" : "PAUSED"}</strong> · Last refresh:{" "}
                <strong>{fmtTime(lastRefreshAt)}</strong>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className={autoRefreshEnabled ? "btn btnGhost" : "btn btnPrimary"}
                style={miniButtonStyle()}
                onClick={() => setAutoRefreshEnabled((v) => !v)}
                aria-label="Toggle dummy auto-refresh"
              >
                {autoRefreshEnabled ? "Pause auto-refresh" : "Resume auto-refresh"}
              </button>
              <button className="btn btnGhost" style={miniButtonStyle()} onClick={manualRefreshNow}>
                Refresh now
              </button>
            </div>
          </div>
        </div>

        <MapPanel
          scopedState={scopedState}
          selectedRouteId={selectedRouteId}
          onSelectRouteId={setSelectedRouteId}
          complianceSnapshot={complianceSnapshot}
        />
      </div>

      {/* Bottom: metric cards */}
      <div className="dashboardMetricsGrid" data-testid="dashboard-metrics">
        {/* 1) Route Completion (merged with exceptions + drill-down) */}
        <section aria-label="Route completion and exceptions summary" data-testid="metric-route-completion">
          <RouteCompletionCard scopedState={scopedState} complianceSnapshot={complianceSnapshot} dateIso={todayIso} />
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

        {/* 3) Compliance Alerts */}
        <section className="card" aria-label="Compliance alerts summary" data-testid="metric-compliance">
          <div className="cardHeader">
            <div>
              <h2>Compliance Alerts</h2>
              <p>Automated route deviation & rule breaches (dummy GPS)</p>
            </div>
            <span className="badge badgeError">
              <strong>{complianceCounts.total}</strong> active
            </span>
          </div>

          <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div className="kpi">
              <div className="kpiLabel">High</div>
              <div className="kpiValue" style={{ color: "var(--ocean-error)" }}>
                {complianceCounts.high}
              </div>
              <div className="kpiSub">Immediate attention</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Medium</div>
              <div className="kpiValue" style={{ color: "var(--ocean-secondary)" }}>
                {complianceCounts.medium}
              </div>
              <div className="kpiSub">Investigate</div>
            </div>
            <div className="kpi">
              <div className="kpiLabel">Low</div>
              <div className="kpiValue">{complianceCounts.low}</div>
              <div className="kpiSub">Monitor</div>
            </div>
          </div>

          <hr className="hr" />

          <div className="splitRow">
            <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => setActiveModal("compliance")}>
              Drill down
            </button>
            <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => navigate("/tasks")}>
              Go to Tasks
            </button>
          </div>

          <div className="mini" style={{ marginTop: 10 }}>
            Rules include: off-route distance, missed checkpoints, out-of-geo-fence, prolonged idle, and start/end window breaches.
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

      {/* Compliance alerts drill-down modal */}
      <Modal
        open={activeModal === "compliance"}
        title="Compliance Alerts"
        description="Automated route deviation & non-compliance flags (dummy GPS breadcrumbs)."
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
        <div className="filters" style={{ marginBottom: 12 }}>
          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Severity</span>
            <select value={complianceFilterSeverity} onChange={(e) => setComplianceFilterSeverity(e.target.value)}>
              <option value="">All</option>
              <option value={ComplianceSeverity.HIGH}>High</option>
              <option value={ComplianceSeverity.MEDIUM}>Medium</option>
              <option value={ComplianceSeverity.LOW}>Low</option>
            </select>
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Sort</span>
            <select value={complianceSort} onChange={(e) => setComplianceSort(e.target.value)}>
              <option value="severity">Severity</option>
              <option value="engineer">Engineer</option>
              <option value="route">Route</option>
            </select>
          </label>
        </div>

        <div className="tableWrap">
          <table className="table" aria-label="Compliance alerts table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Engineer</th>
                <th>Route</th>
                <th>Rule</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {(complianceSnapshot?.flags || [])
                .filter((f) => (complianceFilterSeverity ? f.severity === complianceFilterSeverity : true))
                .sort((a, b) => {
                  const sevRank = { high: 3, medium: 2, low: 1 };
                  if (complianceSort === "severity") return (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
                  if (complianceSort === "engineer") return (a.engineerId || "").localeCompare(b.engineerId || "");
                  return (a.routeId || "").localeCompare(b.routeId || "");
                })
                .map((f) => (
                  <tr key={f.id}>
                    <td>
                      <span
                        className={
                          f.severity === ComplianceSeverity.HIGH
                            ? "badge badgeError"
                            : f.severity === ComplianceSeverity.MEDIUM
                              ? "badge badgeWarn"
                              : "badge"
                        }
                      >
                        {f.severity.toUpperCase()}
                      </span>
                    </td>
                    <td>{scopedState.users.find((u) => u.id === f.engineerId)?.name || f.engineerId}</td>
                    <td>{scopedState.routes.find((r) => r.id === f.routeId)?.name || f.routeId}</td>
                    <td style={{ fontWeight: 800 }}>{String(f.rule).replaceAll("_", " ")}</td>
                    <td className="mini">{f.message}</td>
                  </tr>
                ))}
              {(complianceSnapshot?.flags || []).filter((f) =>
                complianceFilterSeverity ? f.severity === complianceFilterSeverity : true
              ).length === 0 ? (
                <tr>
                  <td colSpan={5} className="mini">
                    No compliance alerts for the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <hr className="hr" />
        <div className="mini">
          Map highlighting: routes with <strong>high</strong> severity alerts are emphasized; engineer markers get an alert ring.
        </div>
      </Modal>

      {/* Keep ExceptionsPanel for Tasks page; on Dashboard we still allow deep navigation via Tasks if needed. */}
      <Modal
        open={activeModal === "exceptions"}
        title="Exceptions"
        description="Active rejected/redo tasks in your scope."
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
        <div style={{ marginTop: 12 }}>
          <ExceptionsPanel scopedState={scopedState} onSelectTaskId={() => navigate("/tasks")} />
        </div>
      </Modal>
    </div>
  );
}
