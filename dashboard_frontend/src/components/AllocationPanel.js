import React, { useMemo, useState } from "react";
import { Roles } from "../data/dummyData";
import {
  assignRouteToEngineer,
  computeEngineerWorkload,
  selectEngineerAllocationCounts,
  unassignRouteFromEngineer,
} from "../state/domainStore";
import { clampPageIndex, paginateRows, sortRows } from "../utils/tableTools";

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

function nextSortOrder(currentKey, currentOrder, clickedKey) {
  if (currentKey !== clickedKey) return "asc";
  return currentOrder === "asc" ? "desc" : "asc";
}

function sortIndicator(active, order) {
  if (!active) return null;
  return order === "asc" ? " ▲" : " ▼";
}

// PUBLIC_INTERFACE
export default function AllocationPanel({ scopedState, fullState, setFullState, currentUser }) {
  /** Admin / Regional Manager view to allocate engineers to routes. */
  const [regionFilter, setRegionFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | active | idle | offline
  const [q, setQ] = useState("");

  const [sortKey, setSortKey] = useState("engineer");
  const [sortOrder, setSortOrder] = useState("asc");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const canUse = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;

  const managers = useMemo(() => fullState.users.filter((u) => u.role === Roles.REGIONAL_MANAGER), [fullState.users]);

  const assignmentByEngineer = useMemo(
    () => new Map((fullState.engineerAssignments || []).map((a) => [a.engineerId, a.routeId])),
    [fullState.engineerAssignments]
  );

  // Derive live/assignment allocation status in real-time (updates as fullState changes via refresh loop).
  const locationByEngineer = useMemo(
    () => new Map((fullState.engineerLiveLocations || []).map((l) => [l.engineerId, l])),
    [fullState.engineerLiveLocations]
  );

  const isValidLatLng = (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
    return true;
  };

  const allocationStatusForEngineer = (engineerId) => {
    const loc = locationByEngineer.get(engineerId);
    const online = !!loc && isValidLatLng(loc.lat, loc.lng);
    if (!online) return "offline";
    return assignmentByEngineer.get(engineerId) ? "active" : "idle";
  };

  const allocationCounts = useMemo(
    () => selectEngineerAllocationCounts(scopedState, { dateIso: new Date().toISOString() }),
    [scopedState]
  );

  const workloadByEngineer = useMemo(() => computeEngineerWorkload(fullState, { dateIso: new Date().toISOString() }), [fullState]);

  const filteredEngineers = useMemo(() => {
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

        // Status filter (derived from live location + assignment)
        if (statusFilter && statusFilter !== "all") {
          const st = allocationStatusForEngineer(u.id);
          if (st !== statusFilter) return false;
        }

        if (!qLower) return true;
        return (
          u.name.toLowerCase().includes(qLower) ||
          u.id.toLowerCase().includes(qLower) ||
          regionName(fullState, u.regionId).toLowerCase().includes(qLower)
        );
      });
  }, [scopedState, q, regionFilter, managerFilter, statusFilter, fullState, managers, assignmentByEngineer, locationByEngineer]);

  const sortedEngineers = useMemo(() => {
    return sortRows(filteredEngineers, {
      sortKey,
      sortOrder,
      accessor: (e, key) => {
        const routeId = assignmentByEngineer.get(e.id)?.routeId || "";
        const wl = workloadByEngineer[e.id] || { tasksToday: 0, routesAssigned: 0, totalLoad: 0 };
        switch (key) {
          case "engineer":
            return e.name;
          case "region":
            return regionName(fullState, e.regionId);
          case "route":
            return routeId ? routeName(fullState, routeId) : "";
          case "workload":
            return wl.totalLoad;
          default:
            return "";
        }
      },
    });
  }, [filteredEngineers, sortKey, sortOrder, assignmentByEngineer, workloadByEngineer, fullState]);

  const pagination = useMemo(() => paginateRows(sortedEngineers, { pageIndex, pageSize }), [sortedEngineers, pageIndex, pageSize]);
  const effectivePageIndex = useMemo(
    () => clampPageIndex(pageIndex, pagination.totalPages),
    [pageIndex, pagination.totalPages]
  );

  const pageEngineers = useMemo(() => {
    if (effectivePageIndex !== pageIndex) {
      return paginateRows(sortedEngineers, { pageIndex: effectivePageIndex, pageSize }).pageRows;
    }
    return pagination.pageRows;
  }, [effectivePageIndex, pageIndex, pageSize, pagination.pageRows, sortedEngineers]);

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

  function onHeaderSort(clickedKey) {
    setSortOrder((prevOrder) => nextSortOrder(sortKey, prevOrder, clickedKey));
    setSortKey(clickedKey);
    setPageIndex(0);
  }

  function headerButton(label, key) {
    const active = sortKey === key;
    return (
      <button
        type="button"
        className="tableHeaderBtn"
        onClick={() => onHeaderSort(key)}
        aria-label={`Sort by ${label}${active ? ` (${sortOrder})` : ""}`}
      >
        <span>{label}</span>
        <span className="srOnly">{active ? `Sorted ${sortOrder}` : "Not sorted"}</span>
        <span aria-hidden="true">{sortIndicator(active, sortOrder)}</span>
      </button>
    );
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
          {/* <p>Assign/unassign engineers to routes (persists to localStorage)</p> */}
        </div>
        <span className="badge" aria-label="Engineer allocation counts">
          Engineers: {pagination.totalRows} · Active: {allocationCounts.activeCount} · Idle: {allocationCounts.idleCount} · Offline:{" "}
          {allocationCounts.inactiveCount}
        </span>
      </div>

      <div className="filters" style={{ marginBottom: 12 }}>
        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Search</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPageIndex(0);
            }}
            placeholder="Engineer name or ID..."
          />
        </label>

        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPageIndex(0);
            }}
          >
            <option value="all">All</option>
            <option value="active">Active (assigned)</option>
            <option value="idle">Idle (unassigned)</option>
            <option value="offline">Offline</option>
          </select>
        </label>

        <label className="input">
          <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Region</span>
          <select
            value={regionFilter}
            onChange={(e) => {
              setRegionFilter(e.target.value);
              setPageIndex(0);
            }}
          >
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
          <select
            value={managerFilter}
            onChange={(e) => {
              setManagerFilter(e.target.value);
              setPageIndex(0);
            }}
          >
            <option value="">All</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({regionName(fullState, m.regionId)})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tableToolbar">
        <div className="mini">
          Sorted by <strong>{sortKey}</strong> ({sortOrder}) · Page <strong>{effectivePageIndex + 1}</strong> of{" "}
          <strong>{pagination.totalPages}</strong>
        </div>

        <div className="paginationControls">
          <label className="input" style={{ minWidth: 160 }}>
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) || 10);
                setPageIndex(0);
              }}
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" className="btn btnGhost" onClick={() => setPageIndex(0)} disabled={effectivePageIndex === 0}>
              First
            </button>
            <button
              type="button"
              className="btn btnGhost"
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={effectivePageIndex === 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btnGhost"
              onClick={() => setPageIndex((p) => Math.min(pagination.totalPages - 1, p + 1))}
              disabled={effectivePageIndex >= pagination.totalPages - 1}
            >
              Next
            </button>
            <button
              type="button"
              className="btn btnGhost"
              onClick={() => setPageIndex(pagination.totalPages - 1)}
              disabled={effectivePageIndex >= pagination.totalPages - 1}
            >
              Last
            </button>
          </div>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table" aria-label="Allocation table" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th>{headerButton("Engineer", "engineer")}</th>
              <th>{headerButton("Region", "region")}</th>
              <th>{headerButton("Current route", "route")}</th>
              <th>Due date</th>
              <th>{headerButton("Workload", "workload")}</th>
              <th>Assign to route</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageEngineers.map((e) => {
              const assignment = assignmentByEngineer.get(e.id) || null;
              const routeId = assignment?.routeId || "";
              const dueDate = (assignment?.due_date || "").slice(0, 10);

              const wl = workloadByEngineer[e.id] || { tasksToday: 0, routesAssigned: 0, totalLoad: 0 };
              const warn = wl.totalLoad > workloadWarnThreshold;

              const status =
                warn
                  ? { label: "Overloaded", tone: "error" }
                  : wl.totalLoad === 0
                    ? { label: "Idle", tone: "warn" }
                    : { label: "Balanced", tone: "success" };

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
                    <label className="input" style={{ minWidth: 170 }}>
                      <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Due</span>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={() => {}}
                        disabled={!routeId}
                        aria-label={`Due date for ${e.name}`}
                      />
                    </label>
                  </td>
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
            {pageEngineers.length === 0 && (
              <tr>
                <td colSpan={7} className="mini">
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
