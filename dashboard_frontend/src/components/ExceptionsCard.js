import React, { useMemo, useState } from "react";
import Modal from "./Modal";
import { Statuses } from "../data/dummyData";
import { computeExceptionsSummary } from "../state/domainStore";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function regionName(state, regionId) {
  return state.regions.find((r) => r.id === regionId)?.name || "—";
}

function routeName(state, routeId) {
  return state.routes.find((r) => r.id === routeId)?.name || "—";
}

function engineerName(state, engineerId) {
  return state.users.find((u) => u.id === engineerId)?.name || "—";
}

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

function exceptionTone(total) {
  const t = Number(total || 0);
  if (t <= 0) return "success";
  if (t <= 2) return "warn";
  return "error";
}

// PUBLIC_INTERFACE
export default function ExceptionsCard({ scopedState, dateIso, onOpenTasks }) {
  /**
   * Exceptions dashboard card: rejected/redo tasks only.
   * Drill-down is route-aware and date-scoped (tasks due today), with sorting and filtering.
   * Deeper task-level management remains on the Tasks page (ExceptionsPanel tab).
   */
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => computeExceptionsSummary(scopedState, { dateIso }), [scopedState, dateIso]);
  const date = summary.date;

  const tasksToday = useMemo(() => {
    return (scopedState?.tasks || []).filter((t) => (t.dueDate || "").slice(0, 10) === date);
  }, [scopedState, date]);

  const exceptionRows = useMemo(() => {
    return tasksToday
      .filter((t) => t.status === Statuses.REJECTED || t.status === Statuses.REDO)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        engineerId: t.engineerId,
        regionId: t.regionId,
        routeId: t.routeId,
        reason: t.status === Statuses.REJECTED ? t.rejection_reason : t.redo_reason,
        redoCount: t.status === Statuses.REDO ? t.redo_count || 0 : 0,
        dueDate: t.dueDate || "",
      }));
  }, [tasksToday]);

  const [filterType, setFilterType] = useState(""); // rejected | redo | ""
  const [filterRouteId, setFilterRouteId] = useState("");
  const [filterRegionId, setFilterRegionId] = useState("");
  const [sortKey, setSortKey] = useState("date"); // date | route | engineer | status
  const [sortDir, setSortDir] = useState("asc"); // asc | desc

  const routeOptions = useMemo(() => {
    const ids = unique(exceptionRows.map((r) => r.routeId));
    const byId = new Map((scopedState?.routes || []).map((rt) => [rt.id, rt.name]));
    return ids
      .map((id) => ({ id, name: byId.get(id) || id }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [exceptionRows, scopedState]);

  const regionOptions = useMemo(() => {
    const ids = unique(exceptionRows.map((r) => r.regionId));
    const byId = new Map((scopedState?.regions || []).map((rg) => [rg.id, rg.name]));
    return ids
      .map((id) => ({ id, name: byId.get(id) || id }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [exceptionRows, scopedState]);

  const filteredRows = useMemo(() => {
    return exceptionRows
      .filter((r) => {
        if (filterType && r.status !== filterType) return false;
        if (filterRouteId && r.routeId !== filterRouteId) return false;
        if (filterRegionId && r.regionId !== filterRegionId) return false;
        return true;
      })
      .slice()
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;

        if (sortKey === "route") return dir * String(routeName(scopedState, a.routeId)).localeCompare(String(routeName(scopedState, b.routeId)));
        if (sortKey === "engineer")
          return dir * String(engineerName(scopedState, a.engineerId)).localeCompare(String(engineerName(scopedState, b.engineerId)));
        if (sortKey === "status") return dir * String(a.status).localeCompare(String(b.status));
        // date
        return dir * String(a.dueDate).localeCompare(String(b.dueDate));
      });
  }, [exceptionRows, filterType, filterRouteId, filterRegionId, sortKey, sortDir, scopedState]);

  const tone = exceptionTone(summary.today?.total || 0);

  return (
    <>
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Exceptions</h2>
            <p>Rejected / redo tasks due today (separate from route completion)</p>
          </div>

          <span className={toneToBadgeClass(tone)}>
            <strong>{summary.today?.total || 0}</strong> active
          </span>
        </div>

        <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="kpi">
            <div className="kpiLabel">Rejected</div>
            <div className="kpiValue">{summary.today?.rejected || 0}</div>
            <div className="kpiSub">Needs review</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Redo</div>
            <div className="kpiValue">{summary.today?.redo || 0}</div>
            <div className="kpiSub">Rework required</div>
          </div>
          <div className="kpi">
            <div className="kpiLabel">Date</div>
            <div className="kpiValue" style={{ fontSize: 18 }}>{summary.date}</div>
            <div className="kpiSub">Due date scope</div>
          </div>
        </div>

        <hr className="hr" />

        <div className="splitRow">
          <button className="btn btnGhost" onClick={() => setOpen(true)}>
            View exceptions drill-down
          </button>

          <button className="btn btnGhost" onClick={() => onOpenTasks?.()}>
            Go to Tasks
          </button>
        </div>

        <div className="mini" style={{ marginTop: 10 }}>
          Drill-down is scoped to tasks due on <strong>{summary.date}</strong>. Use the Tasks page to resolve exceptions.
        </div>
      </div>

      <Modal
        open={open}
        title="Exceptions (Rejected / Redo)"
        description="Task exceptions due today. Filter by type/route/region and sort to triage. Use Tasks for resolution actions."
        onClose={() => setOpen(false)}
        maxWidth={1250}
        footer={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => setOpen(false)}>
              Done
            </button>
            <button
              className="btn btnGhost"
              onClick={() => {
                setFilterType("");
                setFilterRouteId("");
                setFilterRegionId("");
                setSortKey("date");
                setSortDir("asc");
              }}
            >
              Reset filters
            </button>
            <button className="btn btnPrimary" onClick={() => onOpenTasks?.()}>
              Open Tasks
            </button>
          </div>
        }
      >
        <div className="filters" style={{ marginBottom: 12 }}>
          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Type</span>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">All</option>
              <option value={Statuses.REJECTED}>Rejected</option>
              <option value={Statuses.REDO}>Redo</option>
            </select>
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Route</span>
            <select value={filterRouteId} onChange={(e) => setFilterRouteId(e.target.value)}>
              <option value="">All</option>
              {routeOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Region</span>
            <select value={filterRegionId} onChange={(e) => setFilterRegionId(e.target.value)}>
              <option value="">All</option>
              {regionOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Sort</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="date">Due date</option>
              <option value="route">Route</option>
              <option value="engineer">Engineer</option>
              <option value="status">Status</option>
            </select>
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Dir</span>
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
              <option value="asc">Asc</option>
              <option value="desc">Desc</option>
            </select>
          </label>
        </div>

        <div className="tableWrap">
          <table className="table" aria-label="Exceptions table" style={{ minWidth: 1050 }}>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Engineer</th>
                <th>Region</th>
                <th>Route</th>
                <th>Reason</th>
                <th>Redo #</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.taskId}>
                  <td style={{ fontWeight: 900 }}>
                    {r.title}
                    <div className="mini">{r.taskId}</div>
                    <div className="mini">Due: {r.dueDate || "—"}</div>
                  </td>
                  <td>
                    <span className={toneToBadgeClass(r.status === Statuses.REJECTED ? "error" : "warn")}>{r.status}</span>
                  </td>
                  <td>{engineerName(scopedState, r.engineerId)}</td>
                  <td>{regionName(scopedState, r.regionId)}</td>
                  <td>{routeName(scopedState, r.routeId)}</td>
                  <td>{r.reason ? r.reason : <span className="mini">—</span>}</td>
                  <td>{r.status === Statuses.REDO ? r.redoCount : <span className="mini">—</span>}</td>
                </tr>
              ))}

              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="mini">
                    No exceptions match your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <hr className="hr" />
        <div className="mini">
          This drill-down focuses only on rejected/redo tasks. Compliance alerts remain available in the Compliance Alerts card and map dashed styling.
        </div>
      </Modal>
    </>
  );
}
