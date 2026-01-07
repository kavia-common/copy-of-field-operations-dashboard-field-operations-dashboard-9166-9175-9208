import React, { useMemo, useState } from "react";
import { Roles } from "../data/dummyData";
import { clampPageIndex, paginateRows, sortRows } from "../utils/tableTools";

function routeName(state, routeId) {
  return state.routes.find((r) => r.id === routeId)?.name || "—";
}

function regionName(state, regionId) {
  return state.regions.find((r) => r.id === regionId)?.name || "—";
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
export default function EngineersPage({ scopedState, currentUser, routeFilterId }) {
  const [q, setQ] = useState("");

  const [sortKey, setSortKey] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const engineers = useMemo(() => scopedState.users.filter((u) => u.role === Roles.FIELD_ENGINEER), [scopedState.users]);

  const filteredRows = useMemo(() => {
    const qLower = q.trim().toLowerCase();

    const assignmentByEngineer = new Map(scopedState.engineerAssignments.map((a) => [a.engineerId, a.routeId]));

    return engineers
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
  }, [engineers, q, routeFilterId, scopedState]);

  const sortedRows = useMemo(() => {
    return sortRows(filteredRows, {
      sortKey,
      sortOrder,
      accessor: (row, key) => {
        switch (key) {
          case "name":
            return row.engineer.name;
          case "region":
            return regionName(scopedState, row.engineer.regionId);
          case "route":
            return routeName(scopedState, row.routeId);
          case "id":
            return row.engineer.id;
          default:
            return "";
        }
      },
    });
  }, [filteredRows, sortKey, sortOrder, scopedState]);

  const pagination = useMemo(() => paginateRows(sortedRows, { pageIndex, pageSize }), [sortedRows, pageIndex, pageSize]);
  const effectivePageIndex = useMemo(
    () => clampPageIndex(pageIndex, pagination.totalPages),
    [pageIndex, pagination.totalPages]
  );

  const pageRows = useMemo(() => {
    if (effectivePageIndex !== pageIndex) {
      return paginateRows(sortedRows, { pageIndex: effectivePageIndex, pageSize }).pageRows;
    }
    return pagination.pageRows;
  }, [effectivePageIndex, pageIndex, pageSize, pagination.pageRows, sortedRows]);

  const canSeePage = currentUser.role !== Roles.FIELD_ENGINEER;

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
            Field Engineers can only view their own assignments. Switch to an Admin or Regional Manager account to view the
            engineer roster.
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
          <span className="badge">{pagination.totalRows} visible</span>
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
              placeholder="Name, region, route..."
            />
          </label>

          {routeFilterId && (
            <span className="badge badgeWarn">
              Route filter active: <strong>{routeName(scopedState, routeFilterId)}</strong>
            </span>
          )}
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
          <table className="table" aria-label="Engineer list">
            <thead>
              <tr>
                <th>{headerButton("Engineer", "name")}</th>
                <th>{headerButton("Region", "region")}</th>
                <th>{headerButton("Assigned route", "route")}</th>
                <th>{headerButton("Engineer ID", "id")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.engineer.id}>
                  <td style={{ fontWeight: 900 }}>{row.engineer.name}</td>
                  <td>{regionName(scopedState, row.engineer.regionId)}</td>
                  <td>{routeName(scopedState, row.routeId)}</td>
                  <td className="mini">{row.engineer.id}</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
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
