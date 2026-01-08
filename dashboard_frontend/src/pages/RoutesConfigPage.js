import React from "react";
import { Roles, Statuses } from "../data/dummyData";
import Modal from "../components/Modal";
import RouteEditorModal from "../components/RouteEditorModal";
import {
  computeRouteCompletionCriteriaForRoute,
  createRoute,
  deleteRoute,
  selectAssignmentMaps,
  setEngineersForRoute,
  updateRoute,
} from "../state/domainStore";

function getRegionName(scopedState, regionId) {
  const r = (scopedState?.regions || []).find((x) => x.id === regionId);
  return r?.name || regionId || "";
}

function getManagerName(scopedState, managerUserId, regionId) {
  if (managerUserId) {
    const u = (scopedState?.users || []).find((x) => x.id === managerUserId);
    if (u) return u.name;
  }
  // Fallback: infer by region (dummy model)
  const rm = (scopedState?.users || []).find((u) => u.role === Roles.REGIONAL_MANAGER && u.regionId === regionId);
  return rm?.name || "";
}

function routeTone(criteria) {
  if (criteria?.isCompleted) return "success";
  const hasAnyProgress = Number(criteria?.completedStops || 0) > 0 || Number(criteria?.completedTasks || 0) > 0;
  if (hasAnyProgress) return "warn";
  return "error";
}

function toneBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "warn") return "badge badgeWarn";
  return "badge badgeError";
}

function filterRoutes(routes, { search, regionId, managerUserId }, scopedState) {
  const s = String(search || "").trim().toLowerCase();

  return (routes || []).filter((r) => {
    if (regionId && r.regionId !== regionId) return false;

    if (managerUserId) {
      // Match either explicit managerUserId or inferred manager for region.
      const explicit = String(r.managerUserId || "");
      const inferred = (scopedState?.users || []).find((u) => u.role === Roles.REGIONAL_MANAGER && u.regionId === r.regionId)?.id || "";
      if (explicit !== managerUserId && inferred !== managerUserId) return false;
    }

    if (!s) return true;
    const regionName = getRegionName(scopedState, r.regionId).toLowerCase();
    const managerName = getManagerName(scopedState, r.managerUserId, r.regionId).toLowerCase();
    return (
      String(r.name || "").toLowerCase().includes(s) ||
      String(r.id || "").toLowerCase().includes(s) ||
      regionName.includes(s) ||
      managerName.includes(s)
    );
  });
}

// PUBLIC_INTERFACE
export default function RoutesConfigPage({ scopedState, fullState, setFullState, currentUser }) {
  /** Routes configuration page for Admin and Regional Manager roles. */
  const canSee = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;

  const [search, setSearch] = React.useState("");
  const [regionId, setRegionId] = React.useState("");
  const [managerUserId, setManagerUserId] = React.useState("");

  const [editingRouteId, setEditingRouteId] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState(null); // { routeId, routeName }

  const [assignmentModal, setAssignmentModal] = React.useState(null); // { routeId }
  const [selectedEngineerIds, setSelectedEngineerIds] = React.useState([]);

  const routes = scopedState?.routes || [];
  const tasks = scopedState?.tasks || [];
  const users = scopedState?.users || [];
  const regions = scopedState?.regions || [];

  const managers = React.useMemo(() => users.filter((u) => u.role === Roles.REGIONAL_MANAGER), [users]);
  const engineers = React.useMemo(() => users.filter((u) => u.role === Roles.FIELD_ENGINEER), [users]);

  const { routeToEngineers } = React.useMemo(() => selectAssignmentMaps(fullState || scopedState), [fullState, scopedState]);

  const criteriaByRouteId = React.useMemo(() => {
    const m = {};
    (routes || []).forEach((r) => {
      m[r.id] = computeRouteCompletionCriteriaForRoute(r, tasks);
    });
    return m;
  }, [routes, tasks]);

  const tasksCountByRouteId = React.useMemo(() => {
    const m = {};
    (tasks || []).forEach((t) => {
      if (!t.routeId) return;
      m[t.routeId] = (m[t.routeId] || 0) + 1;
    });
    return m;
  }, [tasks]);

  const filtered = React.useMemo(() => {
    return filterRoutes(routes, { search, regionId, managerUserId }, scopedState);
  }, [routes, search, regionId, managerUserId, scopedState]);

  const editingRoute = React.useMemo(() => routes.find((r) => r.id === editingRouteId) || null, [routes, editingRouteId]);
  const editingTasks = React.useMemo(() => tasks.filter((t) => t.routeId === editingRouteId), [tasks, editingRouteId]);

  function openCreate() {
    setEditingRouteId("__create__");
  }

  function openEdit(routeId) {
    setEditingRouteId(routeId);
  }

  function closeEditor() {
    setEditingRouteId("");
  }

  function openAssignments(routeId) {
    const currentlyAssigned = routeToEngineers?.[routeId] || [];
    setSelectedEngineerIds(currentlyAssigned.slice());
    setAssignmentModal({ routeId });
  }

  function closeAssignments() {
    setAssignmentModal(null);
    setSelectedEngineerIds([]);
  }

  if (!canSee) {
    return (
      <div className="content">
        <div className="card">
          <div className="cardHeader">
            <div>
              <h2>Routes</h2>
              <p>Access restricted</p>
            </div>
          </div>
          <div className="notice">Routes configuration is available to Admin and Regional Manager roles.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Routes Configuration</h2>
            <p>Create, edit, assign engineers, and manage route waypoints/tasks (localStorage-backed).</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => setSearch("")} aria-label="Clear search">
              Clear search
            </button>
            <button className="btn" onClick={openCreate} aria-label="Create route">
              + Create route
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.8fr", gap: 10, padding: "0 14px 14px 14px" }}>
          <label className="formField">
            <span className="mini" style={{ fontWeight: 900 }}>
              Search
            </span>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by route name, id, region, manager…"
              aria-label="Search routes"
            />
          </label>

          <label className="formField">
            <span className="mini" style={{ fontWeight: 900 }}>
              Filter by region
            </span>
            <select className="input" value={regionId} onChange={(e) => setRegionId(e.target.value)} aria-label="Filter by region">
              <option value="">All regions</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </select>
          </label>

          <label className="formField">
            <span className="mini" style={{ fontWeight: 900 }}>
              Filter by manager
            </span>
            <select
              className="input"
              value={managerUserId}
              onChange={(e) => setManagerUserId(e.target.value)}
              aria-label="Filter by manager"
            >
              <option value="">All managers</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id})
                </option>
              ))}
            </select>
          </label>
        </div>

        <hr className="hr" />

        <div style={{ padding: "0 14px 14px 14px" }}>
          <div className="mini" style={{ color: "var(--ocean-muted)" }}>
            Showing <strong>{filtered.length}</strong> routes.
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {filtered.map((r) => {
              const criteria = criteriaByRouteId[r.id];
              const tone = routeTone(criteria);
              const assigned = routeToEngineers?.[r.id] || [];

              const regionName = getRegionName(scopedState, r.regionId);
              const managerName = getManagerName(scopedState, r.managerUserId, r.regionId);

              const totalWaypoints = Number(criteria?.plannedStops ?? r.planned_stops ?? 0);
              const totalTasks = Number(criteria?.totalTasks ?? tasksCountByRouteId?.[r.id] ?? 0);

              const strictStatus = criteria?.isCompleted
                ? "Completed"
                : (Number(criteria?.completedStops || 0) > 0 || Number(criteria?.completedTasks || 0) > 0)
                  ? "In progress"
                  : "Not completed";

              return (
                <div
                  key={r.id}
                  style={{
                    border: "1px solid var(--ocean-border)",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.85)",
                    boxShadow: "var(--shadow-sm)",
                    padding: 12,
                  }}
                  aria-label={`Route ${r.name}`}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, color: "var(--ocean-text)" }}>{r.name}</div>
                        <span className={toneBadgeClass(tone)} aria-label={`Strict completion status ${strictStatus}`}>
                          {strictStatus}
                        </span>
                        <span className="badge" aria-label={`Completion percent ${Number(r.completion_percent || 0)} percent`}>
                          {Number(r.completion_percent || 0)}%
                        </span>
                      </div>

                      <div className="mini" style={{ marginTop: 6, color: "var(--ocean-muted)", display: "grid", gap: 4 }}>
                        <div>
                          <strong>Region:</strong> {regionName} ({r.regionId})
                        </div>
                        <div>
                          <strong>Manager:</strong> {managerName || "—"}
                        </div>
                        <div>
                          <strong>Assigned engineers:</strong> {assigned.length}
                          {" · "}
                          <strong>Waypoints:</strong> {totalWaypoints}
                          {" · "}
                          <strong>Assignments:</strong> {totalTasks}
                        </div>
                        <div>
                          <strong>Strict completion:</strong> waypoints covered ={" "}
                          <strong>{criteria?.waypointsCovered ? "yes" : "no"}</strong>, assignments completed ={" "}
                          <strong>
                            {criteria?.completedTasks}/{criteria?.totalTasks}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button className="btn btnGhost" onClick={() => openAssignments(r.id)} aria-label={`Assign engineers to ${r.name}`}>
                        Assign
                      </button>
                      <button className="btn btnGhost" onClick={() => openEdit(r.id)} aria-label={`Edit route ${r.name}`}>
                        Edit
                      </button>
                      <button
                        className="btn btnDanger"
                        onClick={() => setConfirmDelete({ routeId: r.id, routeName: r.name })}
                        aria-label={`Delete route ${r.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 ? (
              <div className="notice" aria-live="polite">
                No routes match the current filters.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Route editor (create/edit) */}
      <RouteEditorModal
        isOpen={Boolean(editingRouteId)}
        mode={editingRouteId === "__create__" ? "create" : "edit"}
        title={editingRouteId === "__create__" ? "Create route" : `Edit route: ${editingRoute?.name || ""}`}
        regions={regions}
        managers={managers}
        initialRoute={editingRouteId === "__create__" ? null : editingRoute}
        initialTasks={editingRouteId === "__create__" ? [] : editingTasks}
        onCancel={closeEditor}
        onSave={({ name, regionId: rid, managerUserId: mid, waypoints, tasks: newTasks }) => {
          if (editingRouteId === "__create__") {
            const res = createRoute(fullState, {
              name,
              regionId: rid,
              managerUserId: mid,
              waypoints,
              tasks: newTasks.map((t) => ({ title: t.title, status: t.status || Statuses.ASSIGNED })),
            });
            if (res.ok) {
              setFullState(res.state);
              closeEditor();
            }
            return;
          }

          // Replace route tasks with edited tasks (keeps logic clear and avoids complex diffing).
          const res = updateRoute(fullState, {
            routeId: editingRouteId,
            patch: { name, regionId: rid, managerUserId: mid, waypoints },
            replaceTasks: newTasks.map((t) => ({ title: t.title, status: t.status || Statuses.ASSIGNED })),
          });

          if (res.ok) {
            setFullState(res.state);
            closeEditor();
          }
        }}
      />

      {/* Assignment modal */}
      <Modal
        isOpen={Boolean(assignmentModal?.routeId)}
        title="Assign engineers"
        onClose={closeAssignments}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", width: "100%" }}>
            <button className="btn btnGhost" onClick={closeAssignments}>
              Cancel
            </button>
            <button
              className="btn"
              onClick={() => {
                const routeId = assignmentModal?.routeId;
                if (!routeId) return;

                const res = setEngineersForRoute(fullState, {
                  routeId,
                  engineerIds: selectedEngineerIds,
                  mode: "replace",
                });
                if (res.ok) {
                  setFullState(res.state);
                  closeAssignments();
                }
              }}
            >
              Save assignments
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div className="mini" style={{ color: "var(--ocean-muted)" }}>
            Changing assignments triggers a route-change pulse so the main map briefly highlights the affected route(s) and refreshes OSRM snapping.
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {engineers.map((e) => {
              const checked = selectedEngineerIds.includes(e.id);
              return (
                <label
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    border: "1px solid var(--ocean-border)",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.85)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(ev) => {
                      setSelectedEngineerIds((prev) => {
                        const set = new Set(prev);
                        if (ev.target.checked) set.add(e.id);
                        else set.delete(e.id);
                        return Array.from(set);
                      });
                    }}
                    aria-label={`Assign engineer ${e.name}`}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: "var(--ocean-text)" }}>{e.name}</div>
                    <div className="mini" style={{ color: "var(--ocean-muted)" }}>
                      {e.id} · Region: {getRegionName(scopedState, e.regionId)}
                    </div>
                  </div>
                </label>
              );
            })}

            {engineers.length === 0 ? (
              <div className="notice" aria-live="polite">
                No engineers available in your current scope.
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      {/* Confirm delete modal */}
      <Modal
        isOpen={Boolean(confirmDelete?.routeId)}
        title="Delete route?"
        onClose={() => setConfirmDelete(null)}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", width: "100%" }}>
            <button className="btn btnGhost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              className="btn btnDanger"
              onClick={() => {
                const routeId = confirmDelete?.routeId;
                if (!routeId) return;

                const res = deleteRoute(fullState, { routeId });
                if (res.ok) {
                  setFullState(res.state);
                  setConfirmDelete(null);
                }
              }}
              aria-label="Confirm delete route"
            >
              Delete
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div className="notice" role="alert">
            This will permanently remove the route, unassign engineers from it, and delete its tasks (from localStorage).
          </div>
          <div className="mini">
            Route: <strong>{confirmDelete?.routeName}</strong>
          </div>
        </div>
      </Modal>
    </div>
  );
}
