import React, { useMemo, useState } from "react";
import { Roles, Statuses, statusMeta } from "../data/dummyData";

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

function isExceptionStatus(status) {
  return status === Statuses.REJECTED || status === Statuses.REDO;
}

/**
 * Builds a compact, read-only "Engineer comments" string for a task row.
 * We treat comments as:
 * - task.rejection_reason when currently rejected
 * - task.redo_reason when currently redo
 * - any statusHistory reason for on_hold/postponed/rejected/redo (if present)
 */
function buildEngineerCommentsForTask(scopedState, task) {
  if (!task) return "";

  const out = [];

  // 1) Current exception reason fields on the task record.
  if (task.status === Statuses.REJECTED) {
    const rej = String(task.rejection_reason || "").trim();
    if (rej) out.push(`Rejected: ${rej}`);
  }
  if (task.status === Statuses.REDO) {
    const redo = String(task.redo_reason || "").trim();
    if (redo) out.push(`Redo: ${redo}`);
  }

  // 2) Any historical reasons captured in statusHistory for this task.
  // Keep it compact: grab up to the most recent 2 "reason-bearing" transitions.
  const allowed = new Set([Statuses.ON_HOLD, Statuses.POSTPONED, Statuses.REJECTED, Statuses.REDO]);

  const historyReasons = (scopedState?.statusHistory || [])
    .filter((h) => h?.entityType === "task" && h.entityId === task.id)
    .filter((h) => allowed.has(h.toStatus))
    .map((h) => {
      const reason = String(h.reason || "").trim();
      if (!reason) return null;

      const label = statusMeta[h.toStatus]?.label || h.toStatus;
      return { ts: String(h.timestamp || ""), text: `${label}: ${reason}` };
    })
    .filter(Boolean)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 2);

  historyReasons.forEach((r) => out.push(r.text));

  // De-dupe repeated strings (e.g., task record reason matches history reason)
  const seen = new Set();
  const deduped = [];
  out.forEach((s) => {
    const key = String(s || "").trim();
    if (!key) return;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(key);
  });

  return deduped.join(" · ");
}

// PUBLIC_INTERFACE
export default function TasksPage({ scopedState, currentUser, routeFilterId }) {
  /**
   * Tasks page:
   * - Status and comments are read-only (no update actions from this page).
   * - No "Details" action/button in the task list.
   * - Engineer comments column remains visible and functional.
   */
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");

  const selectedTask = useMemo(
    () => scopedState.tasks.find((t) => t.id === selectedTaskId) || null,
    [scopedState.tasks, selectedTaskId]
  );

  const rows = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return scopedState.tasks
      .filter((t) => {
        if (routeFilterId && t.routeId !== routeFilterId) return false;
        if (statusFilter && t.status !== statusFilter) return false;
        if (!qLower) return true;
        return (
          t.title.toLowerCase().includes(qLower) ||
          t.id.toLowerCase().includes(qLower) ||
          engineerName(scopedState, t.engineerId).toLowerCase().includes(qLower) ||
          regionName(scopedState, t.regionId).toLowerCase().includes(qLower) ||
          routeName(scopedState, t.routeId).toLowerCase().includes(qLower)
        );
      })
      .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  }, [q, statusFilter, scopedState, routeFilterId]);

  const historyForSelected = useMemo(() => {
    if (!selectedTask) return [];
    return scopedState.statusHistory
      .filter((h) => h.entityType === "task" && h.entityId === selectedTask.id)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [scopedState.statusHistory, selectedTask]);

  const exceptionHistoryForSelected = useMemo(() => {
    if (!selectedTask) return [];
    return historyForSelected.filter((h) => isExceptionStatus(h.toStatus));
  }, [historyForSelected, selectedTask]);

  const roleNotice =
    currentUser.role === Roles.FIELD_ENGINEER
      ? "Task statuses are shown read-only in this view."
      : currentUser.role === Roles.REGIONAL_MANAGER
        ? "You can view tasks within your region. Statuses are read-only on this page."
        : "You can view all tasks across regions. Statuses are read-only on this page.";

  return (
    <div className="content">
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Tasks</h2>
            <p>Filtering, per-role visibility, and status tracking</p>
          </div>
          <span className="badge">{rows.length} visible</span>
        </div>

        <div className="splitRow" style={{ marginBottom: 10 }}>
          <div />
          {routeFilterId && (
            <span className="badge badgeWarn">
              Route filter: <strong>{routeName(scopedState, routeFilterId)}</strong>
            </span>
          )}
        </div>

        <div className="notice">{roleNotice}</div>

        <div className="filters" style={{ marginBottom: 12, marginTop: 12 }}>
          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Search</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Task, engineer, region, route..." />
          </label>

          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value={Statuses.ASSIGNED}>Assigned</option>
              <option value={Statuses.IN_PROGRESS}>In Progress</option>
              <option value={Statuses.COMPLETED}>Completed</option>
              <option value={Statuses.ON_HOLD}>On Hold</option>
              <option value={Statuses.POSTPONED}>Postponed</option>
              <option value={Statuses.REJECTED}>Rejected</option>
              <option value={Statuses.REDO}>Redo</option>
            </select>
          </label>
        </div>

        <div className="tableWrap" style={{ marginTop: 12 }}>
          <table className="table" aria-label="Task list">
            <thead>
              <tr>
                <th>Task</th>
                <th>Engineer</th>
                <th>Region</th>
                <th>Route</th>
                <th>Due</th>
                <th>Status</th>
                <th>Engineer comments</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const meta = statusMeta[t.status] || { label: t.status, tone: "neutral" };
                const badgeClass = toneToBadgeClass(meta.tone);
                const comments = buildEngineerCommentsForTask(scopedState, t);

                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTaskId(t.id)}
                    style={{ cursor: "pointer" }}
                    aria-label={`Select task ${t.id}`}
                  >
                    <td>
                      <div style={{ fontWeight: 900 }}>{t.title}</div>
                      <div className="mini">{t.id}</div>
                    </td>
                    <td>{engineerName(scopedState, t.engineerId)}</td>
                    <td>{regionName(scopedState, t.regionId)}</td>
                    <td>{routeName(scopedState, t.routeId)}</td>
                    <td>{t.dueDate || "—"}</td>
                    <td>
                      <span className={badgeClass}>{meta.label}</span>
                      {isExceptionStatus(t.status) && (
                        <div className="mini" style={{ marginTop: 6 }}>
                          {t.status === Statuses.REJECTED ? (
                            <>
                              <strong>Reason:</strong> {t.rejection_reason || "—"}
                            </>
                          ) : (
                            <>
                              <strong>Redo:</strong> {t.redo_reason || "—"} · <strong>count</strong> {t.redo_count || 0}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: 380 }}>
                      {comments ? (
                        <div className="mini" style={{ lineHeight: 1.25 }}>
                          {comments}
                        </div>
                      ) : (
                        <span className="mini">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="mini">
                    No tasks match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mini" style={{ marginTop: 8, color: "var(--ocean-muted)" }}>
            Tip: click a task row to view details below.
          </div>
        </div>

        {selectedTask && (
          <>
            <hr className="hr" />
            <div className="splitRow">
              <div>
                <div style={{ fontWeight: 900 }}>Task Details</div>
                <div className="mini">
                  {selectedTask.title} · {engineerName(scopedState, selectedTask.engineerId)} ·{" "}
                  {routeName(scopedState, selectedTask.routeId)}
                </div>
              </div>
              <button className="btn btnGhost" onClick={() => setSelectedTaskId("")}>
                Clear selection
              </button>
            </div>

            {/* Consolidated exceptions area (read-only) */}
            <div style={{ marginTop: 10 }}>
              <div className="splitRow" style={{ alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>Exceptions</div>
                {isExceptionStatus(selectedTask.status) ? (
                  <span className={toneToBadgeClass(statusMeta[selectedTask.status]?.tone || "neutral")}>
                    Current: {statusMeta[selectedTask.status]?.label || selectedTask.status}
                  </span>
                ) : (
                  <span className="badge badgeSuccess">No active exception</span>
                )}
              </div>

              {isExceptionStatus(selectedTask.status) && (
                <div className="notice" style={{ marginTop: 10 }}>
                  {selectedTask.status === Statuses.REJECTED ? (
                    <>
                      <strong>Rejected reason:</strong> {selectedTask.rejection_reason || "—"}
                    </>
                  ) : (
                    <>
                      <strong>Redo reason:</strong> {selectedTask.redo_reason || "—"} · <strong>Redo count:</strong>{" "}
                      {selectedTask.redo_count || 0}
                    </>
                  )}
                </div>
              )}

              <div className="tableWrap" style={{ marginTop: 10 }}>
                <table className="table" aria-label="Exception history">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Exception status</th>
                      <th>Reason / Note</th>
                      <th>Actor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exceptionHistoryForSelected.map((h) => {
                      const meta = statusMeta[h.toStatus] || { label: h.toStatus, tone: "neutral" };
                      return (
                        <tr key={h.id}>
                          <td className="mini">{new Date(h.timestamp).toLocaleString()}</td>
                          <td>
                            <span className={toneToBadgeClass(meta.tone)}>{meta.label}</span>
                          </td>
                          <td>{h.reason || <span className="mini">—</span>}</td>
                          <td>{engineerName(scopedState, h.actorUserId) || h.actorUserId}</td>
                        </tr>
                      );
                    })}
                    {exceptionHistoryForSelected.length === 0 && (
                      <tr>
                        <td colSpan={4} className="mini">
                          No exception history entries for this task.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <hr className="hr" />

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 900 }}>Status History</div>
              <div className="mini">All status transitions (read-only)</div>

              <div className="tableWrap" style={{ marginTop: 10 }}>
                <table className="table" aria-label="Status history">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>New status</th>
                      <th>Reason</th>
                      <th>Actor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyForSelected.map((h) => {
                      const meta = statusMeta[h.toStatus] || { label: h.toStatus, tone: "neutral" };
                      return (
                        <tr key={h.id}>
                          <td className="mini">{new Date(h.timestamp).toLocaleString()}</td>
                          <td>
                            <span className={toneToBadgeClass(meta.tone)}>{meta.label}</span>
                          </td>
                          <td>{h.reason || <span className="mini">—</span>}</td>
                          <td>{engineerName(scopedState, h.actorUserId) || h.actorUserId}</td>
                        </tr>
                      );
                    })}
                    {historyForSelected.length === 0 && (
                      <tr>
                        <td colSpan={4} className="mini">
                          No history entries for this task yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
