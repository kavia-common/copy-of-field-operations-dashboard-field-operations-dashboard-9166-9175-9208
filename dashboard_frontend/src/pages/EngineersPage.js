import React, { useMemo, useState } from "react";
import { Roles } from "../data/dummyData";

function routeName(state, routeId) {
  return state.routes.find((r) => r.id === routeId)?.name || "—";
}

function regionName(state, regionId) {
  return state.regions.find((r) => r.id === regionId)?.name || "—";
}

export default function EngineersPage({ scopedState, currentUser, routeFilterId }) {
  const [q, setQ] = useState("");

  const engineers = useMemo(() => scopedState.users.filter((u) => u.role === Roles.FIELD_ENGINEER), [scopedState.users]);

  const rows = useMemo(() => {
    const qLower = q.trim().toLowerCase();

    const byEngineerId = new Map();
    engineers.forEach((e) => byEngineerId.set(e.id, e));

    const assignmentByEngineer = new Map(scopedState.engineerAssignments.map((a) => [a.engineerId, a.routeId]));

    const filtered = engineers
      .map((e) => {
        const routeId = assignmentByEngineer.get(e.id) || "";
        return { engineer: e, routeId };
      })
      .filter((row) => {
        if (routeFilterId && row.routeId !== routeFilterId) return false;
        if (!qLower) return true;
        return (
          row.engineer.name.toLowerCase().includes(qLower) ||
          row.engineer.id.toLowerCase().includes(qLower) ||
          regionName(scopedState, row.engineer.regionId).toLowerCase().includes(qLower) ||
          routeName(scopedState, row.routeId).toLowerCase().includes(qLower)
        );
      });

    return filtered;
  }, [engineers, q, routeFilterId, scopedState]);

  const canSeePage = currentUser.role !== Roles.FIELD_ENGINEER;

  if (!canSeePage) {
    return (
      <div className="content">
        <div className="card">
          <div className="cardHeader">
            <div>
              <h2>Engineers</h2>
              <p>Access restricted</p>
            </div>
          </div>
          <div className="notice">
            Field Engineers can only view their own assignments. Switch to an Admin or Regional Manager account to view the engineer roster.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Engineers</h2>
            <p>Roster with region + assigned route</p>
          </div>
          <span className="badge">{rows.length} visible</span>
        </div>

        <div className="filters" style={{ marginBottom: 12 }}>
          <label className="input">
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Search</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, region, route..." />
          </label>

          {routeFilterId && (
            <span className="badge badgeWarn">
              Route filter active: <strong>{routeName(scopedState, routeFilterId)}</strong>
            </span>
          )}
        </div>

        <div className="tableWrap">
          <table className="table" aria-label="Engineer list">
            <thead>
              <tr>
                <th>Engineer</th>
                <th>Region</th>
                <th>Assigned route</th>
                <th>Engineer ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.engineer.id}>
                  <td style={{ fontWeight: 900 }}>{row.engineer.name}</td>
                  <td>{regionName(scopedState, row.engineer.regionId)}</td>
                  <td>{routeName(scopedState, row.routeId)}</td>
                  <td className="mini">{row.engineer.id}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="mini">
                    No engineers match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <hr className="hr" />
        <div className="mini">
          Visibility is role-scoped: Admin sees all; Regional Manager sees their region; Field Engineer cannot access this roster page.
        </div>
      </div>
    </div>
  );
}
