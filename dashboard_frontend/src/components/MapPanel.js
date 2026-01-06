import React, { useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { createPortal } from "react-dom";
import { computeRouteCompletionCriteriaForRoute } from "../state/domainStore";

// Optional plugin: fullscreen control (adds L.control.fullscreen)
import "leaflet.fullscreen";

/**
 * Leaflet (React-Leaflet) map panel: renders markers for engineers and polylines for routes.
 *
 * Enhancements:
 * - Shows each engineer's assigned route as a per-engineer polyline overlay (slightly thinner than the base route).
 * - Shows route waypoints (checkpoints) as small circle markers.
 * - Engineer markers update as the domain store refreshes dummy locations (every 30s on Dashboard).
 * - Adds common map controls:
 *    - Zoom controls (ensured visible)
 *    - Fit-to-bounds control
 *    - Recenter control (returns to default fit view of all routes/markers)
 *    - Optional fullscreen toggle (via leaflet.fullscreen)
 *
 * Notes:
 * - Uses OpenStreetMap tiles (no API keys required).
 * - Click a route polyline to select it (filters other panels via selectedRouteId).
 * - Auto-fits viewport to visible markers/routes. If no data, shows a friendly empty state.
 */

// Fix for default Leaflet marker icons in bundlers (CRA) where the default icon URL resolution breaks.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function toLatLngs(polyline = []) {
  return (polyline || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lat, p.lng]);
}

function getEngineer(scopedState, engineerId) {
  return (scopedState?.users || []).find((x) => x.id === engineerId) || null;
}

function getEngineerName(scopedState, engineerId) {
  const u = getEngineer(scopedState, engineerId);
  return u?.name || engineerId;
}

function getRegionName(scopedState, regionId) {
  const r = (scopedState?.regions || []).find((x) => x.id === regionId);
  return r?.name || regionId || "";
}

function getRegionalManagerName(scopedState, regionId) {
  // In dummy data: Regional Manager users are keyed by regionId.
  const rm = (scopedState?.users || []).find((u) => u.role === "Regional Manager" && u.regionId === regionId);
  return rm?.name || rm?.id || "";
}

function completionTone(route) {
  const completion = Number(route?.completion_percent || 0);
  if (completion >= 90) return "success";
  if (completion >= 60) return "warn";
  return "error";
}

function complianceBadgeColor(severity) {
  if (severity === "high") return { bg: "rgba(220,38,38,0.12)", fg: "#DC2626", border: "rgba(220,38,38,0.35)" };
  if (severity === "medium") return { bg: "rgba(245,158,11,0.14)", fg: "#B45309", border: "rgba(245,158,11,0.45)" };
  if (severity === "low") return { bg: "rgba(17,24,39,0.08)", fg: "#111827", border: "rgba(17,24,39,0.22)" };
  return { bg: "rgba(30,58,138,0.10)", fg: "#1E3A8A", border: "rgba(30,58,138,0.25)" };
}

function completionBadgeColor(tone) {
  if (tone === "success") return { bg: "rgba(5,150,105,0.12)", fg: "#059669", border: "rgba(5,150,105,0.35)" };
  if (tone === "warn") return { bg: "rgba(245,158,11,0.14)", fg: "#B45309", border: "rgba(245,158,11,0.45)" };
  return { bg: "rgba(220,38,38,0.12)", fg: "#DC2626", border: "rgba(220,38,38,0.35)" };
}

function fmtOrDash(v) {
  return v ? v : "—";
}

function toTitleRule(rule) {
  return String(rule || "")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function routeToStyle({ route, isSelected, complianceTone, completionStatus }) {
  /**
   * Base route style rules:
   * - Selected route: always navy highlight (highest priority).
   * - Compliance overlay: dashed emphasis with severity color (still reflects completion in legend via other entries).
   * - Otherwise: color strictly by completion status:
   *    - completed => green
   *    - in_progress => yellow
   *    - not_completed => red
   */
  if (isSelected) return { color: "#1E3A8A", weight: 5, opacity: 1.0 };

  // If complianceTone is provided, emphasize the route with a dashed alert style.
  if (complianceTone === "high") return { color: "#DC2626", weight: 6, opacity: 0.95, dashArray: "10 8" };
  if (complianceTone === "medium") return { color: "#F59E0B", weight: 6, opacity: 0.9, dashArray: "10 8" };
  if (complianceTone === "low") return { color: "#111827", weight: 5, opacity: 0.85, dashArray: "6 6" };

  if (completionStatus === "completed") return { color: "#059669", weight: 4, opacity: 0.95 };
  if (completionStatus === "in_progress") return { color: "#F59E0B", weight: 4, opacity: 0.9 };

  // not_completed (default)
  return { color: "#DC2626", weight: 4, opacity: 0.9 };
}

function engineerRouteOverlayStyle(severity) {
  // Keep severity emphasis but slightly lighter than main route, so base route colors remain primary.
  if (severity === "high") return { color: "#DC2626", weight: 3, opacity: 0.9, dashArray: "6 6" };
  if (severity === "medium") return { color: "#F59E0B", weight: 3, opacity: 0.85, dashArray: "6 6" };
  if (severity === "low") return { color: "#111827", weight: 3, opacity: 0.8, dashArray: "4 6" };
  return { color: "#1E3A8A", weight: 3, opacity: 0.55 };
}

/**
 * Forces Leaflet to recompute its layout when the map first mounts and when its container may have resized.
 * This is a common fix for “blank/grey tiles”, misaligned layers, or partially-rendered maps when the map
 * is mounted inside cards/grids/flex containers or when fullscreen toggles occur.
 */
// PUBLIC_INTERFACE
function InvalidateSizeOnMountAndResize({ triggerKey }) {
  /** Calls map.invalidateSize() shortly after mount and when triggerKey changes. */
  const map = useMap();

  React.useEffect(() => {
    // Schedule on next frame so the DOM has a chance to settle.
    const raf = window.requestAnimationFrame(() => {
      try {
        map.invalidateSize();
      } catch {
        // no-op: should never break map rendering
      }
    });

    return () => window.cancelAnimationFrame(raf);
  }, [map, triggerKey]);

  return null;
}

// PUBLIC_INTERFACE
function FitToVisible({ bounds }) {
  /** Fits the Leaflet map viewport to the given bounds when bounds changes. */
  const map = useMap();

  React.useEffect(() => {
    if (!bounds) return;
    // Fit with padding to avoid legend overlay and card padding.
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [bounds, map]);

  return null;
}

// PUBLIC_INTERFACE
function FocusDeviationOnMap({ focusDeviation, markerRefs, onSelectRouteId }) {
  /**
   * When a new deviation is detected, open a small popup (Leaflet Tooltip) on the affected marker,
   * and also select the route so the route polyline is highlighted.
   */
  const map = useMap();

  React.useEffect(() => {
    if (!focusDeviation) return;

    const engineerId = focusDeviation.engineerId;
    const routeId = focusDeviation.routeId;

    if (routeId) onSelectRouteId?.(routeId);

    const marker = markerRefs.current?.get(engineerId);
    if (marker) {
      try {
        // Bring the marker into view and open tooltip.
        const ll = marker.getLatLng?.();
        if (ll) map.flyTo(ll, Math.max(map.getZoom(), 13), { duration: 0.6 });
        marker.openTooltip?.();
      } catch {
        // no-op: map interaction should never break rendering
      }
    }
  }, [focusDeviation, markerRefs, map, onSelectRouteId]);

  return null;
}

function safeFitToBounds(map, bounds) {
  if (!map || !bounds) return;
  try {
    map.fitBounds(bounds, { padding: [40, 40] });
  } catch {
    // no-op
  }
}

function createOceanControlButton({ title, label, icon, onClick, extraClassName = "" }) {
  const container = L.DomUtil.create("div", `oceanMapControl ${extraClassName}`.trim());
  const btn = L.DomUtil.create("button", "oceanMapControlBtn", container);
  btn.type = "button";
  btn.title = title;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `<span class="oceanMapControlIcon" aria-hidden="true">${icon}</span>`;

  // Prevent map interactions from triggering when clicking the control.
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  L.DomEvent.on(btn, "click", (e) => {
    L.DomEvent.stopPropagation(e);
    L.DomEvent.preventDefault(e);
    onClick?.();
  });

  return container;
}

// PUBLIC_INTERFACE
function MapControls({ bounds }) {
  /**
   * Adds UI controls to the map:
   * - Fit-to-bounds
   * - Recenter (same as fit-to-bounds default view)
   * - Optional fullscreen toggle via leaflet.fullscreen
   *
   * IMPORTANT: Does not alter refresh behavior; it only calls map methods when user clicks controls.
   */
  const map = useMap();

  React.useEffect(() => {
    if (!map) return;

    const ctlGroup = L.control({ position: "topright" });
    ctlGroup.onAdd = () => {
      const wrap = L.DomUtil.create("div", "oceanMapControlGroup");
      // Button 1: Fit to bounds
      wrap.appendChild(
        createOceanControlButton({
          title: "Fit map to all routes & engineers",
          label: "Fit to bounds",
          icon: "⤢",
          onClick: () => safeFitToBounds(map, bounds),
        }),
      );
      // Button 2: Recenter (same behavior but clearer label/icon)
      wrap.appendChild(
        createOceanControlButton({
          title: "Recenter map to default view",
          label: "Recenter",
          icon: "⌖",
          onClick: () => safeFitToBounds(map, bounds),
        }),
      );
      return wrap;
    };

    ctlGroup.addTo(map);

    // Optional fullscreen control (if plugin loaded successfully)
    // leaflet.fullscreen registers map methods and L.control.fullscreen().
    let fullscreenControl = null;
    try {
      if (L.control?.fullscreen) {
        fullscreenControl = L.control.fullscreen({
          position: "topright",
          title: "Fullscreen",
          titleCancel: "Exit fullscreen",
        });
        fullscreenControl.addTo(map);
      }
    } catch {
      // If plugin isn't available for some reason, skip without breaking the map.
    }

    return () => {
      try {
        ctlGroup.remove();
      } catch {
        // no-op
      }
      try {
        if (fullscreenControl) fullscreenControl.remove();
      } catch {
        // no-op
      }
    };
  }, [map, bounds]);

  return null;
}

// PUBLIC_INTERFACE
function LeafletControlTheming() {
  /**
   * Inject small theme overrides for Leaflet's built-in controls (zoom buttons, etc.).
   * This keeps styling aligned with Ocean Professional without relying on external CSS plugins.
   */
  return createPortal(
    <style>{`
      /* Ocean theme for Leaflet built-in controls */
      .mapBox .leaflet-control-zoom a,
      .mapBox .leaflet-control-layers-toggle {
        background: rgba(255,255,255,0.92);
        color: #111827;
        border: 1px solid var(--ocean-border);
        box-shadow: var(--shadow-sm);
      }

      .mapBox .leaflet-control-zoom a:hover {
        background: rgba(30,58,138,0.06);
      }

      .mapBox .leaflet-control-zoom a.leaflet-disabled {
        opacity: 0.6;
      }

      .mapBox .leaflet-bar {
        border: 1px solid var(--ocean-border);
        border-radius: 12px;
        overflow: hidden;
      }

      /* Fullscreen plugin button (keeps consistent with Ocean theme) */
      .mapBox .leaflet-control-fullscreen a {
        background: rgba(255,255,255,0.92);
        border: 1px solid var(--ocean-border);
        box-shadow: var(--shadow-sm);
        border-radius: 10px;
      }
      .mapBox .leaflet-control-fullscreen a:hover {
        background: rgba(30,58,138,0.06);
      }
    `}</style>,
    document.head,
  );
}

export default function MapPanel({ scopedState, selectedRouteId, onSelectRouteId, complianceSnapshot, focusDeviation }) {
  const markerRefs = useRef(new Map());

  const activeRoutes = useMemo(() => {
    if (!scopedState) return [];
    return scopedState.routes || [];
  }, [scopedState]);

  const activeLocations = useMemo(() => {
    if (!scopedState) return [];
    return scopedState.engineerLiveLocations || [];
  }, [scopedState]);

  const assignments = useMemo(() => {
    if (!scopedState) return [];
    return scopedState.engineerAssignments || [];
  }, [scopedState]);

  const worstSeverityByEngineer = useMemo(() => {
    return complianceSnapshot?.perEngineerWorstSeverity || {};
  }, [complianceSnapshot]);

  const worstSeverityByRoute = useMemo(() => {
    const flags = complianceSnapshot?.flags || [];
    const sevRank = { high: 3, medium: 2, low: 1 };
    const map = {};
    flags.forEach((f) => {
      if (!f.routeId) return;
      const prev = map[f.routeId];
      if (!prev || (sevRank[f.severity] || 0) > (sevRank[prev] || 0)) map[f.routeId] = f.severity;
    });
    return map;
  }, [complianceSnapshot]);

  const routeById = useMemo(() => {
    const m = new Map();
    (activeRoutes || []).forEach((r) => m.set(r.id, r));
    return m;
  }, [activeRoutes]);

  const engineerAssignmentsByEngineerId = useMemo(() => {
    const m = new Map();
    (assignments || []).forEach((a) => m.set(a.engineerId, a.routeId));
    return m;
  }, [assignments]);

  const engineerRouteOverlays = useMemo(() => {
    // Build a per-engineer overlay polyline for their assigned route.
    // This allows users to see each engineer's “intended route” and ties the marker to a route context.
    return (activeLocations || [])
      .map((loc) => {
        const routeId = engineerAssignmentsByEngineerId.get(loc.engineerId);
        const route = routeId ? routeById.get(routeId) : null;
        const positions = toLatLngs(route?.polyline || []);
        return {
          engineerId: loc.engineerId,
          routeId: route?.id || "",
          routeName: route?.name || "",
          positions,
        };
      })
      .filter((x) => x.positions.length >= 2);
  }, [activeLocations, engineerAssignmentsByEngineerId, routeById]);

  const waypointLayers = useMemo(() => {
    // Waypoints are the polyline vertices (for this dummy app).
    // We render them as subtle circles to show checkpoints.
    return (activeRoutes || [])
      .map((r) => {
        const pts = (r.polyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        return {
          routeId: r.id,
          routeName: r.name,
          points: pts.map((p, idx) => ({ id: `${r.id}_wp_${idx}`, ...p, idx })),
        };
      })
      .filter((x) => x.points.length > 0);
  }, [activeRoutes]);

  const latLngsForBounds = useMemo(() => {
    const pts = [];
    activeLocations.forEach((loc) => {
      if (Number.isFinite(loc?.lat) && Number.isFinite(loc?.lng)) pts.push([loc.lat, loc.lng]);
    });
    activeRoutes.forEach((r) => {
      toLatLngs(r.polyline).forEach((p) => pts.push(p));
    });
    return pts;
  }, [activeLocations, activeRoutes]);

  const hasAnyGeo = latLngsForBounds.length > 0;

  const bounds = useMemo(() => {
    if (!hasAnyGeo) return null;
    return L.latLngBounds(latLngsForBounds);
  }, [hasAnyGeo, latLngsForBounds]);

  const initialCenter = useMemo(() => {
    // Center on first visible location, else default US center-ish
    const first = activeLocations[0];
    return first ? [first.lat, first.lng] : [39.8283, -98.5795];
  }, [activeLocations]);

  const routeCompletionById = useMemo(() => {
    // Uses the strict completion definition in domainStore:
    // completed ONLY when all waypoints covered AND all tasks completed.
    const tasksList = scopedState?.tasks || [];
    const m = {};
    (activeRoutes || []).forEach((r) => {
      m[r.id] = computeRouteCompletionCriteriaForRoute(r, tasksList);
    });
    return m;
  }, [activeRoutes, scopedState?.tasks]);

  const routeCompletionStatusById = useMemo(() => {
    // completed: strict completion criteria satisfied
    // in_progress: started (some waypoint progress OR any completed tasks) but not completed
    // not_completed: not started / zero progress
    const m = {};
    (activeRoutes || []).forEach((r) => {
      const criteria = routeCompletionById[r.id];
      const plannedStops = Number(criteria?.plannedStops ?? r?.planned_stops ?? 0);
      const completedStops = Number(criteria?.completedStops ?? r?.completed_stops ?? 0);
      const completedTasks = Number(criteria?.completedTasks ?? 0);

      const hasAnyProgress = completedStops > 0 || completedTasks > 0;
      const isCompleted = Boolean(criteria?.isCompleted);

      if (isCompleted) m[r.id] = "completed";
      else if (hasAnyProgress) m[r.id] = "in_progress";
      else m[r.id] = "not_completed";

      // If there are no waypoints AND no tasks, treat as not started (conservative).
      if (plannedStops <= 0 && Number(criteria?.totalTasks ?? 0) <= 0) m[r.id] = "not_completed";
    });
    return m;
  }, [activeRoutes, routeCompletionById]);

  const legend = useMemo(() => {
    return [
      { label: "Completed", color: "#059669" },
      { label: "In progress", color: "#F59E0B" },
      { label: "Not completed", color: "#DC2626" },
      { label: "Compliance alerts (dashed)", color: "#111827" },
    ];
  }, []);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Map Overview</h2>
          <p>Engineer locations, route polylines, and checkpoints</p>
        </div>
        <span className="badge">Maps: Open-source</span>
      </div>

      <div className="mapBox">
        {!hasAnyGeo ? (
          <div className="mapEmpty" aria-live="polite">
            <div className="mapFallbackInner">
              <h3>No map data to display</h3>
              <p>
                There are currently no engineer locations or routes in your scope. Try switching roles or resetting the dummy
                data.
              </p>
              <div className="notice">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Current scope</div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div>
                    <strong>Visible engineers:</strong> {activeLocations.length}
                  </div>
                  <div>
                    <strong>Visible routes:</strong> {activeRoutes.length}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <MapContainer
              center={initialCenter}
              zoom={12}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
              preferCanvas
              zoomControl
            >
              <LeafletControlTheming />

              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* Ensure tiles/layers render correctly when mounted in a responsive card/grid layout. */}
              <InvalidateSizeOnMountAndResize triggerKey={bounds ? bounds.toBBoxString?.() || "bounds" : "no_bounds"} />

              {/* Keep existing auto-fit behavior; no change to refresh behavior. */}
              {bounds && <FitToVisible bounds={bounds} />}

              {/* New explicit user-facing controls (recenter/fit/fullscreen) */}
              {bounds && <MapControls bounds={bounds} />}

              <FocusDeviationOnMap focusDeviation={focusDeviation} markerRefs={markerRefs} onSelectRouteId={onSelectRouteId} />

              {/* Base route polylines (strict completion coloring + compliance dashed emphasis) */}
              {activeRoutes.map((r) => {
                const isSelected = selectedRouteId ? r.id === selectedRouteId : false;
                const complianceTone = worstSeverityByRoute[r.id] || "";
                const completionStatus = routeCompletionStatusById?.[r.id] || "not_completed";
                const criteria = routeCompletionById?.[r.id] || null;

                const style = routeToStyle({ route: r, isSelected, complianceTone, completionStatus });
                const positions = toLatLngs(r.polyline);

                if (positions.length < 2) return null;

                const statusLabel =
                  completionStatus === "completed"
                    ? "Completed"
                    : completionStatus === "in_progress"
                      ? "In progress"
                      : "Not completed";

                return (
                  <Polyline
                    key={`route_${r.id}`}
                    positions={positions}
                    pathOptions={style}
                    eventHandlers={{
                      click: () => onSelectRouteId?.(r.id),
                    }}
                  >
                    <Tooltip sticky direction="top" opacity={0.95}>
                      <div style={{ fontWeight: 800 }}>{r.name}</div>

                      <div className="mini">
                        Status: <strong>{statusLabel}</strong>
                      </div>

                      <div className="mini">
                        Completion: <strong>{Number(r.completion_percent || 0)}%</strong>
                      </div>

                      {criteria ? (
                        <div className="mini">
                          Waypoints:{" "}
                          <strong>
                            {criteria.waypointsCovered ? "covered" : "not covered"}
                          </strong>
                          {" • "}
                          Tasks:{" "}
                          <strong>
                            {criteria.completedTasks}/{criteria.totalTasks} completed
                          </strong>
                        </div>
                      ) : null}

                      {complianceTone ? (
                        <div className="mini">
                          Compliance:{" "}
                          <strong style={{ textTransform: "uppercase" }}>
                            {String(complianceTone)}
                          </strong>
                        </div>
                      ) : null}

                      <div className="mini">Click to select</div>
                    </Tooltip>
                  </Polyline>
                );
              })}

              {/* Waypoints (route checkpoints) */}
              {waypointLayers.map((layer) => {
                const isSelected = selectedRouteId ? layer.routeId === selectedRouteId : false;
                // Show all waypoints, but slightly emphasize when selected.
                const radius = isSelected ? 5 : 4;
                const opacity = isSelected ? 0.9 : 0.55;

                return layer.points.map((wp) => (
                  <CircleMarker
                    key={wp.id}
                    center={[wp.lat, wp.lng]}
                    radius={radius}
                    pathOptions={{
                      color: "rgba(17,24,39,0.65)",
                      fillColor: "#FFFFFF",
                      fillOpacity: opacity,
                      weight: 1,
                    }}
                  >
                    <Tooltip direction="top" opacity={0.95}>
                      <div style={{ fontWeight: 900 }}>{layer.routeName}</div>
                      <div className="mini">Checkpoint #{wp.idx + 1}</div>
                      <div className="mini">
                        Lat/Lng: {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}
                      </div>
                    </Tooltip>
                  </CircleMarker>
                ));
              })}

              {/* Per-engineer route overlay (thin) */}
              {engineerRouteOverlays.map((o) => {
                const sev = worstSeverityByEngineer?.[o.engineerId] || "";
                const style = engineerRouteOverlayStyle(sev);

                return (
                  <Polyline key={`eng_route_${o.engineerId}`} positions={o.positions} pathOptions={style}>
                    <Tooltip sticky direction="top" opacity={0.95}>
                      <div style={{ fontWeight: 900 }}>{getEngineerName(scopedState, o.engineerId)}</div>
                      <div className="mini">
                        Assigned route: <strong>{o.routeName || o.routeId || "Unassigned"}</strong>
                      </div>
                      {sev ? (
                        <div className="mini">
                          Alerts: <strong style={{ textTransform: "uppercase" }}>{sev}</strong>
                        </div>
                      ) : null}
                    </Tooltip>
                  </Polyline>
                );
              })}

              {/* Engineer markers (update positions on store refresh) */}
              {activeLocations.map((loc) => {
                if (!Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lng)) return null;

                const name = getEngineerName(scopedState, loc.engineerId);
                const sev = worstSeverityByEngineer?.[loc.engineerId] || "";
                const ringClass =
                  sev === "high"
                    ? "oceanEngineerMarkerRingHigh"
                    : sev === "medium"
                      ? "oceanEngineerMarkerRingMed"
                      : sev
                        ? "oceanEngineerMarkerRingLow"
                        : "";

                const eng = getEngineer(scopedState, loc.engineerId);
                const regionId = eng?.regionId || "";
                const regionName = getRegionName(scopedState, regionId);
                const regionalManager = getRegionalManagerName(scopedState, regionId);

                const routeId = engineerAssignmentsByEngineerId.get(loc.engineerId) || "";
                const route = routeId ? routeById.get(routeId) : null;
                const routeName = route?.name || "";

                const plannedStops = Number(route?.planned_stops || 0);
                const completedStops = Number(route?.completed_stops || 0);
                const completionPercent = Number(route?.completion_percent || 0);
                const completionSummary =
                  plannedStops > 0 ? `${completedStops}/${plannedStops} (${completionPercent}%)` : route ? `${completionPercent}%` : "";

                const flags = complianceSnapshot?.flags || [];
                const engineerFlags = flags
                  .filter((f) => f.engineerId === loc.engineerId)
                  .slice()
                  .sort((a, b) => {
                    const sevRank = { high: 3, medium: 2, low: 1 };
                    return (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
                  });

                // Use a small, high-contrast pin to match Ocean Professional theme.
                const icon = L.divIcon({
                  className: "oceanEngineerMarker",
                  html: `<div class="oceanEngineerMarkerDot" aria-hidden="true"></div>${
                    sev ? `<div class="oceanEngineerMarkerRing ${ringClass}" aria-hidden="true"></div>` : ""
                  }`,
                  iconSize: [18, 18],
                  iconAnchor: [9, 9],
                });

                const completionToneKey = completionTone(route);
                const completionColors = completionBadgeColor(completionToneKey);
                const alertColors = complianceBadgeColor(sev);

                return (
                  <Marker
                    key={loc.engineerId}
                    position={[loc.lat, loc.lng]}
                    icon={icon}
                    riseOnHover
                    ref={(ref) => {
                      if (!ref) return;
                      markerRefs.current.set(loc.engineerId, ref);
                    }}
                  >
                    {/* Keep tooltip for quick glance on hover */}
                    <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                      <div style={{ fontWeight: 900 }}>{name}</div>
                      <div className="mini">{loc.engineerId}</div>
                      <div className="mini">
                        Region: <strong>{regionId || "—"}</strong>
                      </div>
                      <div className="mini">
                        Route: <strong>{routeName || routeId || "Unassigned"}</strong>
                      </div>
                      {sev ? (
                        <div className="mini">
                          Alerts: <strong style={{ textTransform: "uppercase" }}>{sev}</strong>
                        </div>
                      ) : null}
                      {focusDeviation?.engineerId === loc.engineerId ? (
                        <div className="mini" style={{ marginTop: 6, fontWeight: 800, color: "var(--ocean-error)" }}>
                          New deviation: {String(focusDeviation.rule || "").replaceAll("_", " ")}
                        </div>
                      ) : null}
                    </Tooltip>

                    {/* Rich popup on click (updates as state refreshes) */}
                    <Popup maxWidth={320} minWidth={260} autoPan>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 950, fontSize: 14, color: "var(--ocean-text)" }}>
                              Engineer: {fmtOrDash(name)}
                            </div>
                            <div className="mini" style={{ marginTop: 2 }}>
                              ID: <strong>{fmtOrDash(loc.engineerId)}</strong>
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                            <span
                              className="badge"
                              style={{
                                background: completionColors.bg,
                                color: completionColors.fg,
                                border: `1px solid ${completionColors.border}`,
                                fontWeight: 900,
                              }}
                            >
                              {route ? `${completionPercent}%` : "Unassigned"}
                            </span>

                            {sev ? (
                              <span
                                className="badge"
                                style={{
                                  background: alertColors.bg,
                                  color: alertColors.fg,
                                  border: `1px solid ${alertColors.border}`,
                                  fontWeight: 900,
                                  textTransform: "uppercase",
                                }}
                              >
                                {sev} alert
                              </span>
                            ) : (
                              <span
                                className="badge"
                                style={{
                                  background: "rgba(5,150,105,0.10)",
                                  color: "#059669",
                                  border: "1px solid rgba(5,150,105,0.28)",
                                  fontWeight: 900,
                                }}
                              >
                                No alerts
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ borderTop: "1px solid var(--ocean-border)", paddingTop: 10, display: "grid", gap: 6 }}>
                          <div className="mini">
                            Regional manager: <strong>{fmtOrDash(regionalManager)}</strong>
                          </div>
                          <div className="mini">
                            Region: <strong>{fmtOrDash(regionName || regionId)}</strong>
                          </div>
                          <div className="mini">
                            Current route: <strong>{fmtOrDash(routeName || routeId)}</strong>
                          </div>
                          <div className="mini">
                            Completion: <strong>{fmtOrDash(completionSummary)}</strong>
                          </div>
                        </div>

                        <div style={{ borderTop: "1px solid var(--ocean-border)", paddingTop: 10 }}>
                          <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 6, color: "var(--ocean-text)" }}>
                            Active alerts
                          </div>

                          {engineerFlags.length === 0 ? (
                            <div className="mini">—</div>
                          ) : (
                            <div style={{ display: "grid", gap: 8 }}>
                              {engineerFlags.slice(0, 5).map((f) => {
                                const c = complianceBadgeColor(f.severity);
                                return (
                                  <div
                                    key={f.id}
                                    style={{
                                      display: "grid",
                                      gap: 4,
                                      padding: "8px 10px",
                                      borderRadius: 10,
                                      border: `1px solid ${c.border}`,
                                      background: c.bg,
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                      <div style={{ fontWeight: 900, fontSize: 12, color: c.fg }}>
                                        {String(f.severity || "").toUpperCase()}
                                      </div>
                                      <div className="mini" style={{ color: "rgba(17,24,39,0.8)" }}>
                                        {fmtOrDash(toTitleRule(f.rule))}
                                      </div>
                                    </div>
                                    <div className="mini" style={{ color: "rgba(17,24,39,0.9)" }}>
                                      {fmtOrDash(f.message)}
                                    </div>
                                  </div>
                                );
                              })}
                              {engineerFlags.length > 5 ? (
                                <div className="mini" style={{ opacity: 0.85 }}>
                                  +{engineerFlags.length - 5} more
                                </div>
                              ) : null}
                            </div>
                          )}

                          {focusDeviation?.engineerId === loc.engineerId ? (
                            <div
                              className="mini"
                              style={{
                                marginTop: 10,
                                fontWeight: 900,
                                color: "var(--ocean-error)",
                                borderTop: "1px dashed var(--ocean-border)",
                                paddingTop: 10,
                              }}
                            >
                              New deviation: {String(focusDeviation.rule || "").replaceAll("_", " ")}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>

            <div
              className="mapLegend"
              aria-label="Route completion legend"
              style={{
                position: "absolute",
                left: 12,
                bottom: 12,
                background: "rgba(255,255,255,0.92)",
                border: "1px solid var(--ocean-border)",
                borderRadius: 12,
                padding: "10px 12px",
                boxShadow: "var(--shadow-sm)",
                maxWidth: 320,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 8 }}>Route status</div>
              <div style={{ display: "grid", gap: 6 }}>
                {legend.map((l) => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 18,
                        height: 6,
                        borderRadius: 99,
                        background: l.color,
                        display: "inline-block",
                      }}
                    />
                    <span className="mini">{l.label}</span>
                  </div>
                ))}
                <div className="mini" style={{ marginTop: 6 }}>
                  Checkpoints are shown as <strong>small circles</strong>. Each engineer has a thin assigned-route overlay.
                </div>
                {selectedRouteId && (
                  <div className="mini" style={{ marginTop: 6 }}>
                    Selected route is highlighted in <strong>navy</strong>.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <hr className="hr" />

      <div className="splitRow">
        <div className="mini">
          Click a route polyline to filter list views by route. Selected route: <strong>{selectedRouteId || "None"}</strong>
        </div>
        <button className="btn btnGhost" onClick={() => onSelectRouteId?.("")} disabled={!selectedRouteId}>
          Clear route filter
        </button>
      </div>

      {activeRoutes.length > 0 && (
        <div className="mini" style={{ marginTop: 10 }}>
          Route colors reflect strict completion status (all waypoints covered AND all route tasks completed). Compliance alerts use dashed emphasis.
        </div>
      )}
    </div>
  );
}
