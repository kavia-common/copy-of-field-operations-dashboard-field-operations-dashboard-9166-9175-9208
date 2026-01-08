import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Roles } from "../data/demoData";
import { computeDprSnapshot, computeRouteCompletionSummary, selectTasksDueOnDate } from "../state/domainStore";
import {
  ComplianceSeverity,
  ensureComplianceComputed,
  selectActiveFlagsBySeverity,
  detectNewDeviations,
  selectNonComplianceTrendToday,
} from "../state/compliance";
import { downloadCsv, toCsv } from "../utils/csv";
import MapPanel from "../components/MapPanel";
import LegendCard from "../components/LegendCard";
import AllocationPanel from "../components/AllocationPanel";
import Modal from "../components/Modal";
import RouteCompletionCard from "../components/RouteCompletionCard";
import ExceptionsCard from "../components/ExceptionsCard";
import EngineerAllocationCard from "../components/EngineerAllocationCard";
import ToastCenter from "../components/ToastCenter";
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

function safeNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

// PUBLIC_INTERFACE
export default function DashboardPage({ scopedState, fullState, setFullState, currentUser }) {
  /** Dashboard page showing map + key operational metric cards with drill-down modals. */
  const navigate = useNavigate();
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [activeModal, setActiveModal] = useState(""); // "allocation" | "compliance" | "non_compliance" | "route_details" | "tasks_details" | "engineer_details" | ""
  const [toastQueue, setToastQueue] = useState([]);
  const [focusDeviation, setFocusDeviation] = useState(null);

  const todayIso = useMemo(() => new Date().toISOString(), []);

  // Refresh controls (Demo Mode is always ON)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState(() => getLastRefreshMeta()?.lastRefreshedAt || "");

  const dprSnapshot = useMemo(
    () => computeDprSnapshot(fullState, currentUser, { dateIso: todayIso }),
    [fullState, currentUser, todayIso]
  );

  const complianceSnapshot = useMemo(() => {
    // Persist once per day so drill-down views remain stable across navigation.
    // Note: This can be recomputed on refresh only if there isn't already a snapshot for today.
    return ensureComplianceComputed(fullState, { dateIso: todayIso });
  }, [fullState, todayIso]);

  const prevComplianceRef = React.useRef(complianceSnapshot);
  useEffect(() => {
    prevComplianceRef.current = complianceSnapshot;
  }, [complianceSnapshot]);

  const complianceCounts = useMemo(() => selectActiveFlagsBySeverity(complianceSnapshot), [complianceSnapshot]);

  const canManageAllocation = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;

  const [complianceFilterSeverity, setComplianceFilterSeverity] = useState("");
  const [complianceSort, setComplianceSort] = useState("severity"); // severity | engineer | route

  const [nonComplianceFilterSeverity, setNonComplianceFilterSeverity] = useState("");
  const [nonComplianceFilterEngineer, setNonComplianceFilterEngineer] = useState("");
  const [nonComplianceFilterRoute, setNonComplianceFilterRoute] = useState("");
  const [nonComplianceSort, setNonComplianceSort] = useState("severity"); // severity | engineer | route | rule

  // 30s refresh loop (Demo Mode is always ON)
  useEffect(() => {
    if (!autoRefreshEnabled) return undefined;

    const refresh = () => {
      const prevSnapshot = prevComplianceRef.current;

      const res = runDummyRefreshOnce(fullState);

      if (res.ok) {
        setFullState(res.state);
        setLastRefreshAt(res.refreshedAt);

        // Compute next snapshot based on the refreshed state (in-place, without waiting for render).
        const nextSnapshot = ensureComplianceComputed(res.state, { dateIso: todayIso });

        // Compliance deviation toasts are the only automatic alerts now.
        const newDevs = detectNewDeviations(prevSnapshot, nextSnapshot, { persistSeen: true });
        if (newDevs.length) {
          // Push to toast queue. Keep items small; ToastCenter handles de-dupe window.
          setToastQueue((q) => [
            ...newDevs.map((d) => ({
              id: d.id,
              dedupeKey: d.dedupeKey,
              severity: d.severity,
              title: d.title,
              subtitle: `${scopedState?.users?.find((u) => u.id === d.engineerId)?.name || d.engineerId} · ${
                scopedState?.routes?.find((r) => r.id === d.routeId)?.name || d.routeId
              }`,
              message: d.message,
              engineerId: d.engineerId,
              routeId: d.routeId,
              rule: d.rule,
            })),
            ...q,
          ]);

          // Auto-focus map on the most severe newest deviation.
          const sevRank = { high: 3, medium: 2, low: 1 };
          const best = [...newDevs].sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0))[0];
          setFocusDeviation(best);
        }
      }
    };

    // Do not auto-refresh immediately on mount; keep UI stable until first interval tick.
    const id = window.setInterval(refresh, 30_000);

    return () => window.clearInterval(id);
  }, [autoRefreshEnabled, fullState, scopedState, setFullState, todayIso]);

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

  const routeCompletionDetails = useMemo(() => computeRouteCompletionSummary(scopedState, { dateIso: todayIso }), [scopedState, todayIso]);

  const tasksToday = useMemo(() => selectTasksDueOnDate(scopedState, { dateIso: todayIso }), [scopedState, todayIso]);

  const tasksDetails = useMemo(() => {
    const completed = tasksToday.filter((t) => t.status === "completed").length;
    const rejected = tasksToday.filter((t) => t.status === "rejected").length;
    const redo = tasksToday.filter((t) => t.status === "redo").length;
    const total = tasksToday.length;
    const completionRate = total ? Math.round((completed / total) * 100) : 0;

    // Quick lists (compact): show the most recent 8 exceptions (rejected/redo)
    const exceptions = tasksToday
      .filter((t) => t.status === "rejected" || t.status === "redo")
      .slice()
      .reverse()
      .slice(0, 8);

    return { total, completed, rejected, redo, completionRate, exceptions };
  }, [tasksToday]);

  return (
    <div className="content">
      <ToastCenter
        toasts={toastQueue}
        onDismiss={(id) => setToastQueue((q) => q.filter((t) => t.id !== id))}
        onOpenDetails={() => setActiveModal("non_compliance")}
        onOpenOnMap={(t) => {
          setFocusDeviation({
            engineerId: t.engineerId,
            routeId: t.routeId,
            rule: t.rule,
            severity: t.severity,
          });
        }}
      />

      {/* Top: Legend (left) + Map (right) */}
      <div data-testid="dashboard-map">
        <div className="card" style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 900 }}>Live Tracker</div>
              <div className="mini">
                Auto-refresh: <strong>{autoRefreshEnabled ? "ON" : "PAUSED"}</strong> · Last refresh:{" "}
                <strong>{fmtTime(lastRefreshAt)}</strong>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                className={autoRefreshEnabled ? "btn btnGhost" : "btn btnPrimary"}
                style={miniButtonStyle()}
                onClick={() => setAutoRefreshEnabled((v) => !v)}
                aria-label="Toggle auto-refresh"
              >
                {autoRefreshEnabled ? "Pause auto-refresh" : "Resume auto-refresh"}
              </button>
            </div>
          </div>
        </div>

        <div className="dashboardMapRow" aria-label="Map and legend">
          <LegendCard />
          <MapPanel
            scopedState={scopedState}
            selectedRouteId={selectedRouteId}
            onSelectRouteId={setSelectedRouteId}
            complianceSnapshot={complianceSnapshot}
            focusDeviation={focusDeviation}
          />
        </div>
      </div>

      {/* Bottom: metric cards */}
      <div className="dashboardMetricsGrid" data-testid="dashboard-metrics">
        {/* 1) Route Completion */}
        <section aria-label="Route completion summary" data-testid="metric-route-completion">
          <RouteCompletionCard scopedState={scopedState} dateIso={todayIso} onShowDetails={() => setActiveModal("route_details")} />
        </section>

        {/* 2) Assignments */}
        <section aria-label="Assignments summary" data-testid="metric-tasks">
          <ExceptionsCard scopedState={scopedState} dateIso={todayIso} onShowDetails={() => setActiveModal("tasks_details")} />
        </section>

        {/* 3) Engineer Allocation */}
        <section aria-label="Engineer allocation metrics" data-testid="metric-allocation">
          <EngineerAllocationCard scopedState={scopedState} dateIso={todayIso} onShowDetails={() => setActiveModal("engineer_details")} />
        </section>

        {/* 4) DPR Snapshot */}
        <section className="card kpiCardFixed" aria-label="Daily progress report snapshot" data-testid="metric-dpr">
          <div className="cardHeader">
            <div>
              <h2>DPR Snapshot</h2>
              <p>Today&apos;s assignment KPIs (scope-aware)</p>
            </div>
            <span className="badge">{dprSnapshot.date}</span>
          </div>

          <div className="kpiCardBody">
            <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <div className="kpi">
                <div className="kpiLabel">Planned assignments</div>
                <div className="kpiValue">{dprSnapshot.planned}</div>
                <div className="kpiSub">Due today</div>
              </div>
              <div className="kpi">
                <div className="kpiLabel">Completed</div>
                <div className="kpiValue">{dprSnapshot.completed}</div>
                <div className="kpiSub">{pct(dprSnapshot.planned ? (dprSnapshot.completed / dprSnapshot.planned) * 100 : 0)} completion</div>
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
          </div>

          <div className="kpiCardFooter">
            <div className="splitRow">
              <button className="btn btnPrimary" style={miniButtonStyle()} onClick={exportDprSnapshotCsv}>
                Export DPR (CSV)
              </button>
              <Link className="btn btnGhost" style={miniButtonStyle()} to="/dpr">
                Open full DPR
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* Dedicated full-width Non-Compliance section below the metric cards */}
      <section className="card dashboardNonComplianceFullWidth" aria-label="Non-compliance summary" data-testid="metric-non-compliance">
        <div className="cardHeader">
          <div>
            <h2>Non-Compliance</h2>
            <p>Management oversight: deviations by severity + drill-down</p>
          </div>
          <span className="badge badgeError">
            <strong>{complianceCounts.total}</strong> total
          </span>
        </div>

        {(() => {
          const trend = selectNonComplianceTrendToday(complianceSnapshot);
          return (
            <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
              <div className="kpi">
                <div className="kpiLabel">High</div>
                <div className="kpiValue" style={{ color: "var(--ocean-error)" }}>
                  {complianceCounts.high}
                </div>
                <div className="kpiSub">Immediate action</div>
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
              <div className="kpi">
                <div className="kpiLabel">Trend today</div>
                <div className="kpiValue">{trend.lastHour}</div>
                <div className="kpiSub">Flags with timestamps in last hour</div>
              </div>
            </div>
          );
        })()}

        <hr className="hr" />

        <div className="splitRow">
          <button className="btn btnGhost" style={miniButtonStyle()} onClick={() => setActiveModal("non_compliance")}>
            Show details
          </button>
          <button
            className="btn btnGhost"
            style={miniButtonStyle()}
            onClick={() => {
              // Quick focus: pick the highest severity flag if any
              const sevRank = { high: 3, medium: 2, low: 1 };
              const best = [...(complianceSnapshot?.flags || [])].sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0))[0];
              if (best) {
                setFocusDeviation({
                  engineerId: best.engineerId,
                  routeId: best.routeId,
                  rule: best.rule,
                  severity: best.severity,
                });
              }
            }}
            disabled={!complianceCounts.total}
          >
            Focus highest
          </button>
        </div>
      </section>

      {/* Route Completion details modal */}
      <Modal
        open={activeModal === "route_details"}
        title="Route Completion — Details"
        description="Route-level stop progress for today’s scope."
        onClose={() => setActiveModal("")}
        maxWidth={1100}
        footer={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => setActiveModal("")}>
              Done
            </button>
          </div>
        }
      >
        <div className="tableWrap">
          <table className="table" aria-label="Route completion details table" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>Route</th>
                <th style={{ width: 140 }}>Planned</th>
                <th style={{ width: 140 }}>Completed</th>
                <th style={{ width: 140 }}>Remaining</th>
                <th style={{ width: 170 }}>Completion</th>
              </tr>
            </thead>
            <tbody>
              {(routeCompletionDetails?.perRoute || []).map((r) => (
                <tr key={r.routeId}>
                  <td style={{ fontWeight: 800 }}>{r.routeName}</td>
                  <td>{safeNum(r.planned)}</td>
                  <td>{safeNum(r.completed)}</td>
                  <td>{safeNum(r.remaining)}</td>
                  <td className="mini">{pct(r.completionPercent)}</td>
                </tr>
              ))}
              {(routeCompletionDetails?.perRoute || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="mini">
                    No routes available in the current scope.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <hr className="hr" />
        <div className="mini">Overall completion is computed from stops completed vs planned (aggregated across routes).</div>
      </Modal>

      {/* Assignments details modal */}
      <Modal
        open={activeModal === "tasks_details"}
        title="Assignments — Details"
        description="Today’s assignment outcomes and recent exceptions."
        onClose={() => setActiveModal("")}
        maxWidth={1100}
        footer={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => setActiveModal("")}>
              Done
            </button>
            <button className="btn btnPrimary" onClick={() => navigate("/tasks")}>
              Go to Assignments
            </button>
          </div>
        }
      >
        <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <div className="kpi">
            <div className="kpiLabel">Total</div>
            <div className="kpiValue">{tasksDetails.total}</div>
            <div className="kpiSub">Due today</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Completed</div>
            <div className="kpiValue">{tasksDetails.completed}</div>
            <div className="kpiSub">{tasksDetails.completionRate}% completion</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Rejected</div>
            <div className="kpiValue" style={{ color: "var(--ocean-error)" }}>
              {tasksDetails.rejected}
            </div>
            <div className="kpiSub">Needs review</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Redo</div>
            <div className="kpiValue" style={{ color: "var(--ocean-secondary)" }}>
              {tasksDetails.redo}
            </div>
            <div className="kpiSub">Rework required</div>
          </div>
        </div>

        <hr className="hr" />

        <div style={{ fontWeight: 900, fontSize: 12, color: "var(--ocean-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Recent exceptions
        </div>

        <div className="tableWrap">
          <table className="table" aria-label="Recent assignment exceptions table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Assignment</th>
                <th>Engineer</th>
                <th>Route</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {tasksDetails.exceptions.map((t) => {
                const engineer = scopedState?.users?.find((u) => u.id === t.engineerId);
                const route = scopedState?.routes?.find((r) => r.id === t.routeId);
                const reason = t.status === "rejected" ? t.rejection_reason : t.redo_reason;

                return (
                  <tr key={t.id}>
                    <td>
                      <span className={t.status === "rejected" ? "badge badgeError" : "badge badgeWarn"}>{String(t.status).toUpperCase()}</span>
                    </td>
                    <td style={{ fontWeight: 800 }}>{t.title}</td>
                    <td>{engineer?.name || t.engineerId}</td>
                    <td>{route?.name || t.routeId}</td>
                    <td className="mini">{reason || "—"}</td>
                  </tr>
                );
              })}
              {tasksDetails.exceptions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="mini">
                    No rejected/redo tasks for today in the current scope.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* Engineer Allocation details modal (reuses existing allocation drill-down) */}
      <Modal
        open={activeModal === "engineer_details" || activeModal === "allocation"}
        title="Engineer Allocation — Details"
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
        description="Automated route deviation & non-compliance flags (simulated GPS breadcrumbs)."
        onClose={() => setActiveModal("")}
        maxWidth={1250}
        footer={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => setActiveModal("")}>
              Done
            </button>
            <button className="btn btnPrimary" onClick={() => navigate("/tasks")}>
              Go to Assignments
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
              {(complianceSnapshot?.flags || []).filter((f) => (complianceFilterSeverity ? f.severity === complianceFilterSeverity : true)).length === 0 ? (
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

      {/* Non-Compliance drill-down modal (management-focused) */}
      <Modal
        open={activeModal === "non_compliance"}
        title="Non-Compliance"
        description="Dedicated management view: filter/sort route deviations and open affected engineer on map."
        onClose={() => setActiveModal("")}
        maxWidth={1300}
        footer={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => setActiveModal("")}>
              Done
            </button>
            <button className="btn btnPrimary" onClick={() => setToastQueue([])}>
              Clear current popups
            </button>
          </div>
        }
      >
        <div className="filters" style={{ marginBottom: 12 }}>
          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Severity</span>
            <select value={nonComplianceFilterSeverity} onChange={(e) => setNonComplianceFilterSeverity(e.target.value)}>
              <option value="">All</option>
              <option value={ComplianceSeverity.HIGH}>High</option>
              <option value={ComplianceSeverity.MEDIUM}>Medium</option>
              <option value={ComplianceSeverity.LOW}>Low</option>
            </select>
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Engineer</span>
            <input value={nonComplianceFilterEngineer} onChange={(e) => setNonComplianceFilterEngineer(e.target.value)} placeholder="Search name or ID" />
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Route</span>
            <input value={nonComplianceFilterRoute} onChange={(e) => setNonComplianceFilterRoute(e.target.value)} placeholder="Search route name or ID" />
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Sort</span>
            <select value={nonComplianceSort} onChange={(e) => setNonComplianceSort(e.target.value)}>
              <option value="severity">Severity</option>
              <option value="engineer">Engineer</option>
              <option value="route">Route</option>
              <option value="rule">Rule</option>
            </select>
          </label>
        </div>

        <div className="tableWrap">
          <table className="table" aria-label="Non-compliance drill-down table" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Engineer</th>
                <th>Route</th>
                <th>Rule</th>
                <th>Details</th>
                <th style={{ width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const sevRank = { high: 3, medium: 2, low: 1 };
                const rows = [...(complianceSnapshot?.flags || [])]
                  .filter((f) => (nonComplianceFilterSeverity ? f.severity === nonComplianceFilterSeverity : true))
                  .filter((f) => {
                    if (!nonComplianceFilterEngineer) return true;
                    const name = scopedState.users.find((u) => u.id === f.engineerId)?.name || "";
                    const q = nonComplianceFilterEngineer.toLowerCase();
                    return (name || "").toLowerCase().includes(q) || (f.engineerId || "").toLowerCase().includes(q);
                  })
                  .filter((f) => {
                    if (!nonComplianceFilterRoute) return true;
                    const name = scopedState.routes.find((r) => r.id === f.routeId)?.name || "";
                    const q = nonComplianceFilterRoute.toLowerCase();
                    return (name || "").toLowerCase().includes(q) || (f.routeId || "").toLowerCase().includes(q);
                  })
                  .sort((a, b) => {
                    if (nonComplianceSort === "severity") return (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
                    if (nonComplianceSort === "engineer") return (a.engineerId || "").localeCompare(b.engineerId || "");
                    if (nonComplianceSort === "route") return (a.routeId || "").localeCompare(b.routeId || "");
                    return String(a.rule || "").localeCompare(String(b.rule || ""));
                  });

                if (!rows.length) {
                  return (
                    <tr>
                      <td colSpan={6} className="mini">
                        No non-compliance entries for the current filters.
                      </td>
                    </tr>
                  );
                }

                return rows.map((f) => (
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
                    <td>
                      <button
                        className="btn btnPrimary"
                        style={{ padding: "8px 10px", fontSize: 12 }}
                        onClick={() => {
                          setFocusDeviation({
                            engineerId: f.engineerId,
                            routeId: f.routeId,
                            rule: f.rule,
                            severity: f.severity,
                          });
                        }}
                      >
                        Open on map
                      </button>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>

        <hr className="hr" />
        <div className="mini">Tip: new deviations trigger popups automatically; this table provides management oversight with filtering/sorting and map drill-down.</div>
      </Modal>
    </div>
  );
}
