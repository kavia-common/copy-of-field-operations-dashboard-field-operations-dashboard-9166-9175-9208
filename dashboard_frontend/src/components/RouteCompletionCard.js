import React, { useMemo, useState } from "react";
import Modal from "./Modal";
import { computeRouteCompletionOnlySummary } from "../state/domainStore";

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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

// PUBLIC_INTERFACE
export default function RouteCompletionCard({ scopedState, dateIso }) {
  /**
   * Route Completion dashboard card (completion-only).
   * Drill-down shows per-route completion metrics (planned/completed/remaining/%),
   * without mixing in rejected/redo exceptions or compliance flags.
   */
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    return computeRouteCompletionOnlySummary(scopedState, { dateIso });
  }, [scopedState, dateIso]);

  const [filterRouteId, setFilterRouteId] = useState("");
  const [filterRegionId, setFilterRegionId] = useState("");
  const [sortKey, setSortKey] = useState("remaining"); // remaining | completion | route | region
  const [sortDir, setSortDir] = useState("desc"); // asc | desc

  const routeOptions = useMemo(() => {
    return (summary.perRoute || []).map((r) => ({ id: r.routeId, name: r.routeName }));
  }, [summary.perRoute]);

  const regionOptions = useMemo(() => {
    const regions = scopedState?.regions || [];
    const regionById = new Map(regions.map((r) => [r.id, r.name]));
    const ids = unique((summary.perRoute || []).map((r) => r.regionId));
    return ids
      .map((id) => ({ id, name: regionById.get(id) || id }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [summary.perRoute, scopedState]);

  const filteredRows = useMemo(() => {
    const rows = summary.perRoute || [];
    return rows
      .filter((r) => {
        if (filterRouteId && r.routeId !== filterRouteId) return false;
        if (filterRegionId && r.regionId !== filterRegionId) return false;
        return true;
      })
      .slice()
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortKey === "route") return dir * String(a.routeName).localeCompare(String(b.routeName));
        if (sortKey === "region") return dir * String(a.regionId || "").localeCompare(String(b.regionId || ""));
        if (sortKey === "completion") return dir * (Number(a.completionPercent || 0) - Number(b.completionPercent || 0));
        // remaining
        return dir * (Number(a.remaining || 0) - Number(b.remaining || 0));
      });
  }, [summary.perRoute, filterRouteId, filterRegionId, sortKey, sortDir]);

  const overallTone = completionTone(summary.overallCompletionPercent);

  return (
    <>
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Route Completion</h2>
            <p>Completion progress per route (planned vs completed stops)</p>
          </div>

          <span className={toneToBadgeClass(overallTone)}>
            Overall: <strong>{pct(summary.overallCompletionPercent)}</strong>
          </span>
        </div>

        <div className="kpiGrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="kpi">
            <div className="kpiLabel">Stops (today)</div>
            <div className="kpiValue">
              {summary.totalCompletedStops}/{summary.totalPlannedStops}
            </div>
            <div className="kpiSub">Completed ÷ planned (weighted)</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Completion</div>
            <div className="kpiValue">{pct(summary.overallCompletionPercent)}</div>
            <div className="kpiSub">Across all visible routes</div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Routes in scope</div>
            <div className="kpiValue">{(summary.perRoute || []).length}</div>
            <div className="kpiSub">Role/region filtered</div>
          </div>
        </div>

        <hr className="hr" />

        <div className="splitRow">
          <button className="btn btnGhost" onClick={() => setOpen(true)}>
            View route drill-down
          </button>

          <div className="mini">
            Route colors on map reflect completion (green/amber/red). Exceptions and compliance are tracked separately.
          </div>
        </div>
      </div>

      <Modal
        open={open}
        title="Route Completion"
        description="Per-route completion metrics (planned, completed, remaining). Use filters and sorting to drill down."
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
                setFilterRouteId("");
                setFilterRegionId("");
                setSortKey("remaining");
                setSortDir("desc");
              }}
            >
              Reset filters
            </button>
          </div>
        }
      >
        <div className="filters" style={{ marginBottom: 12 }}>
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
              <option value="remaining">Remaining stops</option>
              <option value="completion">Completion %</option>
              <option value="route">Route</option>
              <option value="region">Region</option>
            </select>
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Dir</span>
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </label>
        </div>

        <div className="tableWrap">
          <table className="table" aria-label="Route completion table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Route</th>
                <th>Planned</th>
                <th>Completed</th>
                <th>Remaining</th>
                <th>Completion</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const completionClass = toneToBadgeClass(completionTone(r.completionPercent));
                return (
                  <tr key={r.routeId}>
                    <td style={{ fontWeight: 900 }}>
                      {r.routeName}
                      <div className="mini">ID: {r.routeId}</div>
                    </td>
                    <td>{r.planned}</td>
                    <td>{r.completed}</td>
                    <td>{r.remaining}</td>
                    <td>
                      <span className={completionClass}>{pct(r.completionPercent)}</span>
                    </td>
                    <td className="mini">{r.remaining <= 0 ? "Complete" : "In progress"}</td>
                  </tr>
                );
              })}

              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="mini">
                    No routes match your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <hr className="hr" />

        <div className="mini">
          Notes: route completion is derived from planned/completed stops for the selected day. Task exceptions and compliance alerts
          are tracked separately.
        </div>
      </Modal>
    </>
  );
}
