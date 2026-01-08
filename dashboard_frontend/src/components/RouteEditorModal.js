import React from "react";
import Modal from "./Modal";
import RoutePreviewMap from "./RoutePreviewMap";
import { Statuses } from "../data/dummyData";
import { normalizeWaypoints } from "../state/domainStore";

function parseNumberOrEmpty(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? n : s; // keep as string to show invalid
}

function validateDraftWaypoints(rows) {
  const waypoints = (rows || []).map((r) => ({
    lat: typeof r.lat === "number" ? r.lat : Number(r.lat),
    lng: typeof r.lng === "number" ? r.lng : Number(r.lng),
  }));
  return normalizeWaypoints(waypoints);
}

// PUBLIC_INTERFACE
export default function RouteEditorModal({
  isOpen,
  mode, // "create" | "edit"
  title,
  regions,
  managers,
  initialRoute, // route object or null
  initialTasks, // tasks for route or []
  onCancel,
  onSave, // ({ name, regionId, managerUserId, waypoints, tasks })
}) {
  /** Modal for creating/editing a route + its waypoints/tasks. */
  const [name, setName] = React.useState(initialRoute?.name || "");
  const [regionId, setRegionId] = React.useState(initialRoute?.regionId || (regions?.[0]?.id || ""));
  const [managerUserId, setManagerUserId] = React.useState(initialRoute?.managerUserId || "");

  const [waypointRows, setWaypointRows] = React.useState(() => {
    const wps = (initialRoute?.polyline || []).map((p) => ({ lat: p.lat, lng: p.lng }));
    return wps.length > 0 ? wps : [{ lat: "", lng: "" }, { lat: "", lng: "" }];
  });

  const [taskRows, setTaskRows] = React.useState(() => {
    const rows = (initialTasks || []).map((t) => ({ id: t.id, title: t.title, status: t.status }));
    return rows.length > 0 ? rows : [];
  });

  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!isOpen) return;
    setError("");
    setName(initialRoute?.name || "");
    setRegionId(initialRoute?.regionId || (regions?.[0]?.id || ""));
    setManagerUserId(initialRoute?.managerUserId || "");

    const wps = (initialRoute?.polyline || []).map((p) => ({ lat: p.lat, lng: p.lng }));
    setWaypointRows(wps.length > 0 ? wps : [{ lat: "", lng: "" }, { lat: "", lng: "" }]);

    const rows = (initialTasks || []).map((t) => ({ id: t.id, title: t.title, status: t.status }));
    setTaskRows(rows.length > 0 ? rows : []);
  }, [isOpen, initialRoute, initialTasks, regions]);

  const previewWaypoints = React.useMemo(() => {
    // Only pass numeric rows to preview.
    return (waypointRows || [])
      .map((r) => {
        const lat = typeof r.lat === "number" ? r.lat : Number(r.lat);
        const lng = typeof r.lng === "number" ? r.lng : Number(r.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng };
      })
      .filter(Boolean);
  }, [waypointRows]);

  const waypointValidation = React.useMemo(() => validateDraftWaypoints(waypointRows), [waypointRows]);

  const canSave = React.useMemo(() => {
    if (!String(name || "").trim()) return false;
    if (!regionId) return false;
    return waypointValidation.ok;
  }, [name, regionId, waypointValidation.ok]);

  function moveWaypoint(fromIdx, toIdx) {
    setWaypointRows((prev) => {
      const next = prev.slice();
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
          <div className="mini" style={{ color: "var(--ocean-muted)" }}>
            {mode === "edit" ? "Edits persist to localStorage immediately after saving." : "New route will be added to localStorage."}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btnGhost" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn"
              onClick={() => {
                setError("");
                const nm = String(name || "").trim();
                if (!nm) {
                  setError("Route name is required.");
                  return;
                }
                if (!regionId) {
                  setError("Region is required.");
                  return;
                }
                const wpRes = validateDraftWaypoints(waypointRows);
                if (!wpRes.ok) {
                  setError(wpRes.errors.join(" "));
                  return;
                }

                const tasks = (taskRows || [])
                  .map((t) => ({
                    id: t.id, // may be undefined for new tasks
                    title: String(t.title || "").trim(),
                    status: t.status || Statuses.ASSIGNED,
                  }))
                  .filter((t) => t.title);

                onSave?.({
                  name: nm,
                  regionId,
                  managerUserId: String(managerUserId || "").trim(),
                  waypoints: wpRes.waypoints,
                  tasks,
                });
              }}
              disabled={!canSave}
              aria-disabled={!canSave}
            >
              Save
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {error ? (
          <div className="notice" role="alert" aria-label="Route editor error">
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="formField">
            <span className="mini" style={{ fontWeight: 900 }}>
              Route name
            </span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Downtown Loop"
              aria-label="Route name"
            />
          </label>

          <label className="formField">
            <span className="mini" style={{ fontWeight: 900 }}>
              Region
            </span>
            <select className="input" value={regionId} onChange={(e) => setRegionId(e.target.value)} aria-label="Region">
              {(regions || []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </select>
          </label>

          <label className="formField" style={{ gridColumn: "1 / span 2" }}>
            <span className="mini" style={{ fontWeight: 900 }}>
              Manager (optional)
            </span>
            <select
              className="input"
              value={managerUserId}
              onChange={(e) => setManagerUserId(e.target.value)}
              aria-label="Manager"
            >
              <option value="">Unspecified</option>
              {(managers || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id})
                </option>
              ))}
            </select>
            <div className="mini" style={{ marginTop: 6, color: "var(--ocean-muted)" }}>
              Regional Managers are inferred by region in the sample dataset, but this field is kept for configuration clarity.
            </div>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 12 }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="cardHeader">
              <div>
                <h2 style={{ fontSize: 14 }}>Waypoints</h2>
                <p>Lat/Lng list with reorder. At least 2 points required.</p>
              </div>
              <button
                className="btn btnGhost"
                onClick={() => setWaypointRows((prev) => [...prev, { lat: "", lng: "" }])}
                aria-label="Add waypoint"
              >
                Add
              </button>
            </div>

            {!waypointValidation.ok ? (
              <div className="mini" style={{ color: "#B45309", padding: "0 14px 10px 14px" }}>
                {waypointValidation.errors.join(" ")}
              </div>
            ) : (
              <div className="mini" style={{ color: "var(--ocean-muted)", padding: "0 14px 10px 14px" }}>
                Planned stops will be set to {previewWaypoints.length}.
              </div>
            )}

            <div style={{ padding: "0 14px 14px 14px", display: "grid", gap: 10 }}>
              {(waypointRows || []).map((row, idx) => {
                const latVal = row.lat;
                const lngVal = row.lng;

                const latParsed = parseNumberOrEmpty(latVal);
                const lngParsed = parseNumberOrEmpty(lngVal);

                const latInvalid = typeof latParsed === "string" && latParsed !== "";
                const lngInvalid = typeof lngParsed === "string" && lngParsed !== "";

                return (
                  <div
                    key={`wp_row_${idx}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "28px 1fr 1fr auto",
                      gap: 8,
                      alignItems: "center",
                      padding: "10px 10px",
                      border: "1px solid var(--ocean-border)",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.85)",
                    }}
                    aria-label={`Waypoint row ${idx + 1}`}
                  >
                    <div className="mini" style={{ fontWeight: 900, color: "var(--ocean-muted)" }}>
                      {idx + 1}
                    </div>

                    <label className="mini" style={{ display: "grid", gap: 4 }}>
                      <span>Lat</span>
                      <input
                        className="input"
                        value={row.lat}
                        onChange={(e) =>
                          setWaypointRows((prev) => {
                            const next = prev.slice();
                            next[idx] = { ...next[idx], lat: e.target.value };
                            return next;
                          })
                        }
                        placeholder="e.g., 40.7128"
                        aria-label={`Waypoint ${idx + 1} latitude`}
                        style={latInvalid ? { borderColor: "rgba(220,38,38,0.55)" } : null}
                      />
                    </label>

                    <label className="mini" style={{ display: "grid", gap: 4 }}>
                      <span>Lng</span>
                      <input
                        className="input"
                        value={row.lng}
                        onChange={(e) =>
                          setWaypointRows((prev) => {
                            const next = prev.slice();
                            next[idx] = { ...next[idx], lng: e.target.value };
                            return next;
                          })
                        }
                        placeholder="e.g., -74.0060"
                        aria-label={`Waypoint ${idx + 1} longitude`}
                        style={lngInvalid ? { borderColor: "rgba(220,38,38,0.55)" } : null}
                      />
                    </label>

                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        className="btn btnGhost"
                        onClick={() => moveWaypoint(idx, Math.max(0, idx - 1))}
                        disabled={idx === 0}
                        aria-label={`Move waypoint ${idx + 1} up`}
                      >
                        ↑
                      </button>
                      <button
                        className="btn btnGhost"
                        onClick={() => moveWaypoint(idx, Math.min(waypointRows.length - 1, idx + 1))}
                        disabled={idx === waypointRows.length - 1}
                        aria-label={`Move waypoint ${idx + 1} down`}
                      >
                        ↓
                      </button>
                      <button
                        className="btn btnDanger"
                        onClick={() =>
                          setWaypointRows((prev) => {
                            const next = prev.slice();
                            next.splice(idx, 1);
                            return next.length > 0 ? next : [{ lat: "", lng: "" }, { lat: "", lng: "" }];
                          })
                        }
                        aria-label={`Remove waypoint ${idx + 1}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <RoutePreviewMap waypoints={previewWaypoints} />

            <div className="card" style={{ margin: 0 }}>
              <div className="cardHeader">
                <div>
                  <h2 style={{ fontSize: 14 }}>Assignments (optional)</h2>
                  <p>Placeholder assignments for strict completion criteria.</p>
                </div>
                <button
                  className="btn btnGhost"
                  onClick={() => setTaskRows((prev) => [...prev, { id: "", title: "", status: Statuses.ASSIGNED }])}
                  aria-label="Add task"
                >
                  Add
                </button>
              </div>

              <div style={{ padding: "0 14px 14px 14px", display: "grid", gap: 10 }}>
                {(taskRows || []).length === 0 ? (
                  <div className="mini" style={{ color: "var(--ocean-muted)" }}>
                    No assignments on this route. (Strict completion treats “no assignments” as not complete.)
                  </div>
                ) : null}

                {(taskRows || []).map((t, idx) => (
                  <div
                    key={`task_row_${t.id || idx}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 140px auto",
                      gap: 8,
                      alignItems: "center",
                      padding: "10px 10px",
                      border: "1px solid var(--ocean-border)",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.85)",
                    }}
                    aria-label={`Assignment row ${idx + 1}`}
                  >
                    <label className="mini" style={{ display: "grid", gap: 4 }}>
                      <span>Assignment</span>
                      <input
                        className="input"
                        value={t.title}
                        onChange={(e) =>
                          setTaskRows((prev) => {
                            const next = prev.slice();
                            next[idx] = { ...next[idx], title: e.target.value };
                            return next;
                          })
                        }
                        placeholder="e.g., Inspect hydrant"
                        aria-label={`Assignment ${idx + 1} title`}
                      />
                    </label>

                    <label className="mini" style={{ display: "grid", gap: 4 }}>
                      <span>Status</span>
                      <select
                        className="input"
                        value={t.status || Statuses.ASSIGNED}
                        onChange={(e) =>
                          setTaskRows((prev) => {
                            const next = prev.slice();
                            next[idx] = { ...next[idx], status: e.target.value };
                            return next;
                          })
                        }
                        aria-label={`Task ${idx + 1} status`}
                      >
                        {Object.values(Statuses).map((s) => (
                          <option key={s} value={s}>
                            {String(s).replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      className="btn btnDanger"
                      onClick={() =>
                        setTaskRows((prev) => {
                          const next = prev.slice();
                          next.splice(idx, 1);
                          return next;
                        })
                      }
                      aria-label={`Remove task ${idx + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
