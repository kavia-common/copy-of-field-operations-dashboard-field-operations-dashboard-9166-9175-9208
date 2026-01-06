import React, { useMemo, useState } from "react";
import { Statuses, statusMeta } from "../data/dummyData";

function regionName(state, regionId) {
  return state.regions.find((r) => r.id === regionId)?.name || "—";
}

function engineerName(state, engineerId) {
  return state.users.find((u) => u.id === engineerId)?.name || "—";
}

function routeName(state, routeId) {
  return state.routes.find((r) => r.id === routeId)?.name || "—";
}

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

// PUBLIC_INTERFACE
export default function ExceptionsPanel({ scopedState, onSelectTaskId, nonComplianceRows = [] }) {
  /** Shows active rejected/redo tasks within current scope (and optional non-compliance entries). */
  const [type, setType] = useState(""); // rejected | redo | non_compliance | all
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const qLower = q.trim().toLowerCase();

    const taskRows = (scopedState.tasks || [])
      .filter((t) => t.status === Statuses.REJECTED || t.status === Statuses.REDO)
      .map((t) => ({ kind: "task", task: t }));

    const compliance = (nonComplianceRows || []).map((c) => ({ kind: "non_compliance", c }));

    return [...taskRows, ...compliance]
      .filter((row) => {
        if (row.kind === "task") {
          const t = row.task;
          if (type && type !== "all" && type !== "task" && t.status !== type) return false;
          if (region && t.regionId !== region) return false;
          if (!qLower) return true;
          return (
            t.title.toLowerCase().includes(qLower) ||
            t.id.toLowerCase().includes(qLower) ||
            engineerName(scopedState, t.engineerId).toLowerCase().includes(qLower) ||
            routeName(scopedState, t.routeId).toLowerCase().includes(qLower)
          );
        }

        // non-compliance rows
        if (type && type !== "all" && type !== "non_compliance") return false;
        if (region && row.c.regionId !== region) return false;
        if (!qLower) return true;
        return (
          String(row.c.title || "").toLowerCase().includes(qLower) ||
          String(row.c.engineerName || "").toLowerCase().includes(qLower) ||
          String(row.c.routeName || "").toLowerCase().includes(qLower) ||
          String(row.c.rule || "").toLowerCase().includes(qLower) ||
          String(row.c.message || "").toLowerCase().includes(qLower)
        );
      })
      .sort((a, b) => {
        const aDate = a.kind === "task" ? a.task.dueDate || "" : a.c.date || "";
        const bDate = b.kind === "task" ? b.task.dueDate || "" : b.c.date || "";
        return aDate.localeCompare(bDate);
      });
  }, [scopedState, type, region, q, nonComplianceRows]);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Exceptions</h2>
          <p>Active rejected / redo tasks (in your scope)</p>
        </div>
        <span className="badge">{rows.length} active</span>
      </div>

      <div className="filters" style={{ marginBottom: 12 }}>
        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Task title, ID, engineer..." />
        </label>

        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            <option value={Statuses.REJECTED}>Rejected</option>
            <option value={Statuses.REDO}>Redo</option>
            <option value="non_compliance">Non-compliance</option>
          </select>
        </label>

        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All</option>
            {(scopedState.regions || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tableWrap">
        <table className="table" aria-label="Exceptions list" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Engineer</th>
              <th>Region</th>
              <th>Route</th>
              <th>Reason</th>
              <th>Redo #</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === "non_compliance") {
                const c = row.c;
                const badgeClass =
                  c.severity === "high" ? "badge badgeError" : c.severity === "medium" ? "badge badgeWarn" : "badge";
                return (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 900 }}>{c.title}</div>
                      <div className="mini">{c.rule}</div>
                    </td>
                    <td>
                      <span className={badgeClass}>{String(c.severity).toUpperCase()}</span>
                    </td>
                    <td>{c.engineerName || "—"}</td>
                    <td>{regionName(scopedState, c.regionId)}</td>
                    <td>{c.routeName || routeName(scopedState, c.routeId)}</td>
                    <td>{c.message ? c.message : <span className="mini">—</span>}</td>
                    <td className="mini">—</td>
                    <td>
                      <button className="btn btnGhost" onClick={() => onSelectTaskId?.("")}>
                        Open Tasks
                      </button>
                    </td>
                  </tr>
                );
              }

              const t = row.task;
              const meta = statusMeta[t.status] || { label: t.status, tone: "neutral" };
              const reason = t.status === Statuses.REJECTED ? t.rejection_reason : t.redo_reason;
              return (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 900 }}>{t.title}</div>
                    <div className="mini">{t.id}</div>
                  </td>
                  <td>
                    <span className={toneToBadgeClass(meta.tone)}>{meta.label}</span>
                  </td>
                  <td>{engineerName(scopedState, t.engineerId)}</td>
                  <td>{regionName(scopedState, t.regionId)}</td>
                  <td>{routeName(scopedState, t.routeId)}</td>
                  <td>{reason ? reason : <span className="mini">—</span>}</td>
                  <td>{t.status === Statuses.REDO ? t.redo_count || 0 : <span className="mini">—</span>}</td>
                  <td>
                    <button className="btn btnGhost" onClick={() => onSelectTaskId?.(t.id)}>
                      View in Tasks
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="mini">
                  No active exceptions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <hr className="hr" />
      <div className="mini">Exceptions are tasks with status Rejected or Redo. Use the Tasks page actions to resolve them.</div>
    </div>
  );
}
