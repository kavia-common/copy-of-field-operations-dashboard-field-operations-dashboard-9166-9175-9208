import React, { useMemo, useState } from "react";
import Modal from "./Modal";
import { computeRouteCompletionWithExceptionsSummary } from "../state/domainStore";

function pct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

function severityBadgeClass(sev) {
  if (sev === "high") return "badge badgeError";
  if (sev === "medium") return "badge badgeWarn";
  if (sev === "low") return "badge";
  return "badge";
}

function completionTone(completionPercent) {
  const p = Number(completionPercent || 0);
  if (p >= 90) return "success";
  if (p >= 60) return "warn";
  return "error";
}

function exceptionBadgeTone({ exceptionsTotal, nonComplianceCount }) {
  const total = Number(exceptionsTotal || 0) + Number(nonComplianceCount || 0);
  if (total <= 0) return "success";
  // Keep simple: any exception -> warn; any compliance -> escalate based on severity at row-level.
  return "warn";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

// PUBLIC_INTERFACE
export default function RouteCompletionCard({ scopedState, complianceSnapshot, dateIso }) {
  /**
   * Combined dashboard card: Route completion + Exceptions (Rejected/Redo + Non-compliance).
   * Provides a unified drill-down modal/table with per-route details, filtering, and sorting.
   */
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    return computeRouteCompletionWithExceptionsSummary(scopedState, { dateIso, complianceSnapshot });
  }, [scopedState, dateIso, complianceSnapshot]);

  const [filterRouteId, setFilterRouteId] = useState("");
  const [filterRegionId, setFilterRegionId] = useState("");
  const [filterStatus, setFilterStatus] = useState(""); // all | exceptions | non_compliance | clean
  const [sortKey, setSortKey] = useState("exceptions"); // exceptions | completion | route | region
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

        const hasExceptions = (r.exceptions?.total || 0) > 0;
        const hasCompliance = (r.compliance?.nonComplianceCount || 0) > 0;

        if (filterStatus === "exceptions" && !hasExceptions) return false;
        if (filterStatus === "non_compliance" && !hasCompliance) return false;
        if (filterStatus === "clean" && (hasExceptions || hasCompliance)) return false;

        return true;
      })
      .slice()
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortKey === "route") return dir * String(a.routeName).localeCompare(String(b.routeName));
        if (sortKey === "region") return dir * String(a.regionId || "").localeCompare(String(b.regionId || ""));
        if (sortKey === "completion") return dir * (Number(a.completionPercent || 0) - Number(b.completionPercent || 0));
        // exceptions
        const ax = (a.exceptions?.total || 0) + (a.compliance?.nonComplianceCount || 0);
        const bx = (b.exceptions?.total || 0) + (b.compliance?.nonComplianceCount || 0);
        return dir * (ax - bx);
      });
  }, [summary.perRoute, filterRouteId, filterRegionId, filterStatus, sortKey, sortDir]);

  const totalsBadgeTone = exceptionBadgeTone({
    exceptionsTotal: summary.totals?.exceptions?.total || 0,
    nonComplianceCount: summary.totals?.nonCompliance || 0,
  });

  return (
    <>
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Route Completion</h2>
            <p>Completion + exceptions (Rejected/Redo + non-compliance) for your current scope</p>
          </div>

          <span className="badge">
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
            <div className="kpiLabel">Exceptions (today)</div>
            <div className="kpiValue">{summary.totals?.exceptions?.total || 0}</div>
            <div className="kpiSub">
              Rejected {summary.totals?.exceptions?.rejected || 0} · Redo {summary.totals?.exceptions?.redo || 0}
            </div>
          </div>

          <div className="kpi">
            <div className="kpiLabel">Non-compliance (today)</div>
            <div className="kpiValue" style={{ color: (summary.totals?.nonCompliance || 0) > 0 ? "var(--ocean-error)" : undefined }}>
              {summary.totals?.nonCompliance || 0}
            </div>
            <div className="kpiSub">Compliance snapshot flags</div>
          </div>
        </div>

        <hr className="hr" />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className={toneToBadgeClass(totalsBadgeTone)}>
            Exceptions + compliance: <strong>{(summary.totals?.exceptions?.total || 0) + (summary.totals?.nonCompliance || 0)}</strong>
          </span>

          <span className="badge badgeWarn">
            Rejected/Redo: <strong>{summary.totals?.exceptions?.total || 0}</strong>
          </span>

          <span className="badge">
            Non-compliance: <strong>{summary.totals?.nonCompliance || 0}</strong>
          </span>

          <span className="mini" style={{ marginLeft: "auto" }}>
            Date: <strong>{summary.date}</strong>
          </span>
        </div>

        <hr className="hr" />

        <div className="splitRow">
          <button className="btn btnGhost" onClick={() => setOpen(true)}>
            View route drill-down
          </button>

          <div className="mini">
            Badge key: <strong>green</strong> clean · <strong>amber</strong> has exceptions · <strong>red</strong> high compliance severity.
          </div>
        </div>
      </div>

      <Modal
        open={open}
        title="Route Completion + Exceptions"
        description="Per-route completion with rejected/redo counts and non-compliance details. Use filters and sorting to drill down."
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
                setFilterStatus("");
                setSortKey("exceptions");
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
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Status</span>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              <option value="exceptions">Has rejected/redo</option>
              <option value="non_compliance">Has non-compliance</option>
              <option value="clean">Clean</option>
            </select>
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Sort</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="exceptions">Exceptions + compliance</option>
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
          <table className="table" aria-label="Route completion and exceptions table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Route</th>
                <th>Planned</th>
                <th>Completed</th>
                <th>Completion</th>
                <th>Rejected</th>
                <th>Redo</th>
                <th>Non-compliance</th>
                <th>Latest reasons / flags</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const hasExceptions = (r.exceptions?.total || 0) > 0;
                const hasCompliance = (r.compliance?.nonComplianceCount || 0) > 0;

                const completionClass = toneToBadgeClass(completionTone(r.completionPercent));
                const exceptionClass = toneToBadgeClass(exceptionBadgeTone({ exceptionsTotal: r.exceptions?.total, nonComplianceCount: r.compliance?.nonComplianceCount }));

                const reasons = (r.exceptions?.topReasons || []).map((x) => `${x.reason} (${x.count})`).join(" · ");
                const flags = (r.compliance?.latestMessages || [])
                  .map((f) => `${String(f.rule).replaceAll("_", " ")}: ${f.message}`)
                  .join(" · ");

                return (
                  <tr key={r.routeId}>
                    <td style={{ fontWeight: 900 }}>
                      {r.routeName}
                      <div className="mini">ID: {r.routeId}</div>
                    </td>
                    <td>{r.planned}</td>
                    <td>{r.completed}</td>
                    <td>
                      <span className={completionClass}>{pct(r.completionPercent)}</span>
                    </td>
                    <td>{r.exceptions?.rejected || 0}</td>
                    <td>{r.exceptions?.redo || 0}</td>
                    <td>
                      <span className={severityBadgeClass(r.compliance?.worstSeverity || "")}>
                        {(r.compliance?.nonComplianceCount || 0) > 0 ? r.compliance.nonComplianceCount : 0}
                      </span>
                    </td>
                    <td className="mini" style={{ maxWidth: 420 }}>
                      {reasons || flags ? (
                        <>
                          {reasons ? (
                            <div>
                              <strong>Exceptions:</strong> {reasons}
                            </div>
                          ) : null}
                          {flags ? (
                            <div style={{ marginTop: reasons ? 6 : 0 }}>
                              <strong>Compliance:</strong> {flags}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="mini">—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span className={toneToBadgeClass(r.completionStatus?.tone)}>{r.completionStatus?.label || "—"}</span>
                        {(hasExceptions || hasCompliance) && (
                          <span className={exceptionClass}>
                            {hasCompliance && r.compliance?.worstSeverity
                              ? String(r.compliance.worstSeverity).toUpperCase()
                              : "EXCEPTION"}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="mini">
                    No routes match your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <hr className="hr" />

        <div className="mini">
          Notes: rejected/redo counts are based on tasks <strong>due on {summary.date}</strong>. Non-compliance counts come from the compliance snapshot for the same day.
        </div>
      </Modal>
    </>
  );
}
