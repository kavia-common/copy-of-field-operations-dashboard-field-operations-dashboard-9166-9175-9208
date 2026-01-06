import React, { useMemo, useState } from "react";
import { Roles } from "../data/dummyData";
import { assignRouteToEngineer, computeEngineerWorkload, unassignRouteFromEngineer } from "../state/domainStore";

function regionName(state, regionId) {
  return state.regions.find((r) => r.id === regionId)?.name || "—";
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
export default function AllocationPanel({ scopedState, fullState, setFullState, currentUser }) {
  /** Admin / Regional Manager view to allocate engineers to routes. */
  const [regionFilter, setRegionFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [q, setQ] = useState("");

  const canUse = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;

  const managers = useMemo(() => fullState.users.filter((u) => u.role === Roles.REGIONAL_MANAGER), [fullState.users]);

  const assignmentByEngineer = useMemo(
    () => new Map((fullState.engineerAssignments || []).map((a) => [a.engineerId, a.routeId])),
    [fullState.engineerAssignments]
  );

  const workloadByEngineer = useMemo(() => computeEngineerWorkload(fullState, { dateIso: new Date().toISOString() }), [fullState]);

  const visibleEngineers = useMemo(() => {
    if (!scopedState) return [];
    const qLower = q.trim().toLowerCase();

    // Use scopedState users for role visibility, but assignment and workload are from fullState for persistence.
    return scopedState.users
      .filter((u) => u.role === Roles.FIELD_ENGINEER)
      .filter((u) => {
        if (regionFilter && u.regionId !== regionFilter) return false;
        if (managerFilter) {
          // map manager -> region; show engineers in manager's region
          const mgr = managers.find((m) => m.id === managerFilter);
          if (mgr?.regionId && u.regionId !== mgr.regionId) return false;
        }
        if (!qLower) return true;
        return u.name.toLowerCase().includes(qLower) || u.id.toLowerCase().includes(qLower) || regionName(fullState, u.regionId).toLowerCase().includes(qLower);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedState, q, regionFilter, managerFilter, fullState, managers]);

  const routesByRegion = useMemo(() => {
    const m = new Map();
    (fullState.routes || []).forEach((r) => {
      if (!m.has(r.regionId)) m.set(r.regionId, []);
      m.get(r.regionId).push(r);
    });
    return m;
  }, [fullState.routes]);

  function handleAssign(engineerId, routeId) {
    // Use explicit actions so assignment changes emit a routeChangePulse for MapPanel highlight.
    const res = routeId
      ? assignRouteToEngineer(fullState, { engineerId, routeId })
      : unassignRouteFromEngineer(fullState, { engineerId });

    if (!res.ok) return;
    setFullState(res.state);
  }

  if (!canUse) {
    return (
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Allocation</h2>
            <p>Access restricted</p>
          </div>
        </div>
        <div className="notice">Allocation controls are visible to Admin and Regional Manager roles.</div>
      </div>
    );
  }

  const workloadWarnThreshold = 4; // simple threshold for demo

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Engineer Allocation</h2>
          <p>Assign/unassign engineers to routes (persists to localStorage)</p>
        </div>
        <span className="badge">Engineers: {visibleEngineers.length}</span>
      </div>

      <div className="filters" style={{ marginBottom: 12 }}>
        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Engineer name or ID..." />
        </label>

        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Region</span>
          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
            <option value="">All</option>
            {(fullState.regions || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Manager</span>
          <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
            <option value="">All</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({regionName(fullState, m.regionId)})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tableWrap">
        <table className="table" aria-label="Allocation table" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>Engineer</th>
              <th>Region</th>
              <th>Current route</th>
              <th>Workload</th>
              <th>Assign to route</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleEngineers.map((e) => {
              const routeId = assignmentByEngineer.get(e.id) || "";
              const wl = workloadByEngineer[e.id] || { tasksToday: 0, routesAssigned: 0, totalLoad: 0 };
              const warn = wl.totalLoad > workloadWarnThreshold;

              const status = warn ? { label: "Overloaded", tone: "error" } : wl.totalLoad === 0 ? { label: "Idle", tone: "warn" } : { label: "Balanced", tone: "success" };

              const regionRoutes = routesByRegion.get(e.regionId) || [];

              return (
                <tr key={e.id}>
                  <td style={{ fontWeight: 900 }}>
                    {e.name}
                    <div className="mini">{e.id}</div>
                  </td>
                  <td>{regionName(fullState, e.regionId)}</td>
                  <td>{routeId ? routeName(fullState, routeId) : <span className="mini">Unassigned</span>}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span className={toneToBadgeClass(status.tone)}>{status.label}</span>
                      <span className="mini">
                        {wl.tasksToday} tasks today · {wl.routesAssigned} route(s) · total {wl.totalLoad}
                      </span>
                    </div>
                  </td>
                  <td>
                    <label className="input" style={{ minWidth: 260 }}>
                      <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Route</span>
                      <select value={routeId} onChange={(ev) => handleAssign(e.id, ev.target.value)}>
                        <option value="">Unassigned</option>
                        {regionRoutes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn btnGhost" onClick={() => handleAssign(e.id, "")} disabled={!routeId}>
                        Unassign
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleEngineers.length === 0 && (
              <tr>
                <td colSpan={6} className="mini">
                  No engineers match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <hr className="hr" />

      <div className="notice">
        <strong>Workload heuristic:</strong> tasks due today + number of assigned routes. Threshold warning when total load &gt; {workloadWarnThreshold}.
      </div>
    </div>
  );
}
