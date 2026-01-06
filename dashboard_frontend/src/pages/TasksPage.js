import React, { useMemo, useState } from "react";
import StatusUpdateModal from "../components/StatusUpdateModal";
import TaskExceptionModal from "../components/TaskExceptionModal";
import ExceptionsPanel from "../components/ExceptionsPanel";
import { Roles, Statuses, statusMeta } from "../data/dummyData";
import { canUpdateTask } from "../state/auth";
import { updateTaskStatus } from "../state/domainStore";

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

export default function TasksPage({ scopedState, fullState, setFullState, currentUser, routeFilterId }) {
  const [activeTab, setActiveTab] = useState("tasks"); // tasks | exceptions

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const [exceptionModalOpen, setExceptionModalOpen] = useState(false);
  const [exceptionMode, setExceptionMode] = useState("reject"); // reject | redo | redo_complete

  const selectedTask = useMemo(() => scopedState.tasks.find((t) => t.id === selectedTaskId) || null, [scopedState.tasks, selectedTaskId]);
  const selectedEngineer = useMemo(
    () => (selectedTask ? scopedState.users.find((u) => u.id === selectedTask.engineerId) : null),
    [selectedTask, scopedState.users]
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
    return scopedState.statusHistory.filter((h) => h.entityType === "task" && h.entityId === selectedTask.id);
  }, [scopedState.statusHistory, selectedTask]);

  function openUpdate(taskId) {
    setSelectedTaskId(taskId);
    setModalOpen(true);
  }

  function openException(taskId, mode) {
    setSelectedTaskId(taskId);
    setExceptionMode(mode);
    setExceptionModalOpen(true);
  }

  function handleSubmitUpdate({ toStatus, reason }) {
    if (!selectedTask) return { ok: false, error: "No task selected." };
    if (!canUpdateTask(currentUser, selectedTask)) return { ok: false, error: "You do not have permission to update this task." };

    const res = updateTaskStatus(fullState, { taskId: selectedTask.id, toStatus, reason, actorUserId: currentUser.id });
    if (!res.ok) return res;
    setFullState(res.state);
    return { ok: true };
  }

  function handleSubmitException({ toStatus, reason }) {
    if (!selectedTask) return { ok: false, error: "No task selected." };
    if (!canUpdateTask(currentUser, selectedTask)) return { ok: false, error: "You do not have permission to update this task." };

    // Enforce reasons for reject/redo inside domainStore, but keep a friendly message here too.
    const res = updateTaskStatus(fullState, { taskId: selectedTask.id, toStatus, reason, actorUserId: currentUser.id });
    if (!res.ok) return res;
    setFullState(res.state);
    return { ok: true };
  }

  const roleNotice =
    currentUser.role === Roles.FIELD_ENGINEER
      ? "You can update statuses for your assigned tasks."
      : currentUser.role === Roles.REGIONAL_MANAGER
      ? "You can view and update tasks within your region."
      : "You can view and update all tasks across regions.";

  const tabs = [
    { key: "tasks", label: "Tasks" },
    { key: "exceptions", label: "Exceptions" },
  ];

  return (
    <div className="content">
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Tasks</h2>
            <p>Filtering, per-role visibility, and status updates</p>
          </div>
          <span className="badge">{rows.length} visible</span>
        </div>

        <div className="splitRow" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`btn ${activeTab === t.key ? "btnPrimary" : "btnGhost"}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {routeFilterId && (
            <span className="badge badgeWarn">
              Route filter: <strong>{routeName(scopedState, routeFilterId)}</strong>
            </span>
          )}
        </div>

        <div className="notice">{roleNotice}</div>

        {activeTab === "exceptions" ? (
          <div style={{ marginTop: 12 }}>
            <ExceptionsPanel
              scopedState={scopedState}
              onSelectTaskId={(id) => {
                setActiveTab("tasks");
                setSelectedTaskId(id);
              }}
            />
          </div>
        ) : (
          <>
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const meta = statusMeta[t.status] || { label: t.status, tone: "neutral" };
                    const badgeClass = toneToBadgeClass(meta.tone);
                    const canUpdate = canUpdateTask(currentUser, t);

                    const canRejectRedo = canUpdate; // keep simple; same permission as other status updates
                    const isRedo = t.status === Statuses.REDO;

                    return (
                      <tr key={t.id}>
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
                          {(t.status === Statuses.REJECTED || t.status === Statuses.REDO) && (
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
                        <td>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button className="btn btnGhost" onClick={() => setSelectedTaskId(t.id)}>
                              Details
                            </button>

                            <button className="btn btnPrimary" onClick={() => openUpdate(t.id)} disabled={!canUpdate}>
                              Update
                            </button>

                            <button className="btn btnGhost" onClick={() => openException(t.id, "reject")} disabled={!canRejectRedo}>
                              Reject
                            </button>

                            <button className="btn btnGhost" onClick={() => openException(t.id, "redo")} disabled={!canRejectRedo}>
                              Request Redo
                            </button>

                            <button
                              className="btn btnGhost"
                              onClick={() => openException(t.id, "redo_complete")}
                              disabled={!canRejectRedo || !isRedo}
                            >
                              Mark Redo Completed
                            </button>
                          </div>
                          {!canUpdate && <div className="mini">No permission</div>}
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
            </div>

            {selectedTask && (
              <>
                <hr className="hr" />
                <div className="splitRow">
                  <div>
                    <div style={{ fontWeight: 900 }}>Task Details</div>
                    <div className="mini">
                      {selectedTask.title} · {engineerName(scopedState, selectedTask.engineerId)} · {routeName(scopedState, selectedTask.routeId)}
                    </div>
                  </div>
                  <button className="btn btnGhost" onClick={() => setSelectedTaskId("")}>
                    Clear selection
                  </button>
                </div>

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
              </>
            )}
          </>
        )}
      </div>

      <StatusUpdateModal
        open={modalOpen}
        task={selectedTask}
        engineer={selectedEngineer}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmitUpdate}
      />

      <TaskExceptionModal
        open={exceptionModalOpen}
        task={selectedTask}
        mode={exceptionMode}
        onClose={() => setExceptionModalOpen(false)}
        onSubmit={handleSubmitException}
      />
    </div>
  );
}
