import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Roles } from "../data/dummyData";
import { computeAllocationSummary, computeDprSnapshot } from "../state/domainStore";
import {
  ComplianceSeverity,
  ensureComplianceComputed,
  selectActiveFlagsBySeverity,
  detectNewDeviations,
  selectNonComplianceTrendToday,
} from "../state/compliance";
import { downloadCsv, toCsv } from "../utils/csv";
import MapPanel from "../components/MapPanel";
import AllocationPanel from "../components/AllocationPanel";
import Modal from "../components/Modal";
import RouteCompletionCard from "../components/RouteCompletionCard";
import ExceptionsCard from "../components/ExceptionsCard";
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

// PUBLIC_INTERFACE
export default function DashboardPage({ scopedState, fullState, setFullState, currentUser }) {
  /** Dashboard page showing map + key operational metric cards with drill-down modals. */
  const navigate = useNavigate();
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [activeModal, setActiveModal] = useState(""); // "allocation" | "compliance" | "non_compliance" | ""
  const [toastQueue, setToastQueue] = useState([]);
  const [focusDeviation, setFocusDeviation] = useState(null);

  const todayIso = useMemo(() => new Date().toISOString(), []);

  // Dummy refresh controls
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [randomizeEnabled, setRandomizeEnabled] = useState(true);
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

  // 30s refresh loop (simulated API polling)
  useEffect(() => {
    if (!autoRefreshEnabled) return undefined;

    const refresh = () => {
      const prevSnapshot = prevComplianceRef.current;

      const res = runDummyRefreshOnce(fullState, {
        randomConfig: {
          // Keep this config small and easy to tweak while demoing.
          // NOTE: This is the seam where real API polling options will later live.
          randomizeEnabled,
          toastChancePerTick: 0.3,
          deviationChance: 0.15,
          taskFlipChance: 0.1,
          progressJitterRange: [1, 4],
          maxTaskFlipsPerTick: 1,
        },
      });

      if (res.ok) {
        setFullState(res.state);
        setLastRefreshAt(res.refreshedAt);

        // Enqueue any random demo alerts (ToastCenter handles windowed de-dupe).
        if (Array.isArray(res.toastEvents) && res.toastEvents.length) {
          setToastQueue((q) => [
            ...res.toastEvents.map((t) => ({
              id: t.id,
              dedupeKey: t.dedupeKey,
              severity: t.severity,
              title: t.title,
              subtitle: t.category ? `${String(t.category).toUpperCase()} · ${fmtTime(t.occurredAtIso)}` : fmtTime(t.occurredAtIso),
              message: t.message,
              engineerId: t.engineerId,
              routeId: t.routeId,
              rule: t.rule,
            })),
            ...q,
          ]);
        }

        // Compute next snapshot based on the refreshed state (in-place, without waiting for render).
        const nextSnapshot = ensureComplianceComputed(res.state, { dateIso: todayIso });

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
  }, [autoRefreshEnabled, randomizeEnabled, fullState, scopedState, setFullState, todayIso]);

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
    const prevSnapshot = prevComplianceRef.current;

    const res = runDummyRefreshOnce(fullState, {
      randomConfig: {
        randomizeEnabled,
        toastChancePerTick: 0.3,
        deviationChance: 0.15,
        taskFlipChance: 0.1,
        progressJitterRange: [1, 4],
        maxTaskFlipsPerTick: 1,
      },
    });

    if (res.ok) {
      setFullState(res.state);
      setLastRefreshAt(res.refreshedAt);

      if (Array.isArray(res.toastEvents) && res.toastEvents.length) {
        setToastQueue((q) => [
          ...res.toastEvents.map((t) => ({
            id: t.id,
            dedupeKey: t.dedupeKey,
            severity: t.severity,
            title: t.title,
            subtitle: t.category ? `${String(t.category).toUpperCase()} · ${fmtTime(t.occurredAtIso)}` : fmtTime(t.occurredAtIso),
            message: t.message,
            engineerId: t.engineerId,
            routeId: t.routeId,
            rule: t.rule,
          })),
          ...q,
        ]);
      }

      const nextSnapshot = ensureComplianceComputed(res.state, { dateIso: todayIso });
      const newDevs = detectNewDeviations(prevSnapshot, nextSnapshot, { persistSeen: true });
      if (newDevs.length) {
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

        const sevRank = { high: 3, medium: 2, low: 1 };
        const best = [...newDevs].sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0))[0];
        setFocusDeviation(best);
      }
    }
  }

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
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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

              <button
                className="btn btnPrimary"
                style={miniButtonStyle()}
                onClick={() => {
                  // Demo helper: force one tick that includes randomization behaviors (even if auto-refresh is paused).
                  manualRefreshNow();
                }}
              >
                Random tick now
              </button>

              <label
                className="mini"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  border: "1px solid var(--ocean-border)",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.7)",
                }}
              >
                <input
                  type="checkbox"
                  checked={randomizeEnabled}
                  onChange={(e) => setRandomizeEnabled(e.target.checked)}
                  aria-label="Enable/disable random demo mutations"
                />
                Randomize demo data
              </label>
            </div>
          </div>
        </div>

        <MapPanel
          scopedState={scopedState}
          selectedRouteId={selectedRouteId}
          onSelectRouteId={setSelectedRouteId}
          complianceSnapshot={complianceSnapshot}
          focusDeviation={focusDeviation}
        />
      </div>

      {/* Bottom: metric cards */}
      <div className="dashboardMetricsGrid" data-testid="dashboard-metrics">
        {/* 1) Route Completion (completion-only + drill-down) */}
        <section aria-label="Route completion summary" data-testid="metric-route-completion">
          <RouteCompletionCard scopedState={scopedState} dateIso={todayIso} />
        </section>

        {/* 2) Exceptions (rejected/redo only + drill-down) */}
        <section aria-label="Exceptions summary" data-testid="metric-exceptions">
          <ExceptionsCard scopedState={scopedState} dateIso={todayIso} onOpenTasks={() => navigate("/tasks")} />
        </section>

        {/* 3) Engineer Allocation */}
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
            Drill down
          </button>
          <button
            className="btn btnGhost"
            style={miniButtonStyle()}
            onClick={() => {
              // Quick focus: pick the highest severity flag if any
              const sevRank = { high: 3, medium: 2, low: 1 };
              const best = [...(complianceSnapshot?.flags || [])].sort(
                (a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0)
              )[0];
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

        <div className="mini" style={{ marginTop: 10 }}>
          This section is separate from Exceptions and Route Completion; it is built from compliance detection (dummy GPS breadcrumbs).
        </div>
      </section>

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
            <input
              value={nonComplianceFilterEngineer}
              onChange={(e) => setNonComplianceFilterEngineer(e.target.value)}
              placeholder="Search name or ID"
            />
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Route</span>
            <input
              value={nonComplianceFilterRoute}
              onChange={(e) => setNonComplianceFilterRoute(e.target.value)}
              placeholder="Search route name or ID"
            />
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
        <div className="mini">
          Tip: new deviations trigger popups automatically; this table provides management oversight with filtering/sorting and map drill-down.
        </div>
      </Modal>
    </div>
  );
}
