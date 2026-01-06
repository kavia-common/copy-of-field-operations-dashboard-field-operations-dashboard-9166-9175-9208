import React, { useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip } from "react-leaflet";
import L from "leaflet";
import { useMap } from "react-leaflet";

/**
 * Leaflet (React-Leaflet) map panel: renders markers for engineers and polylines for routes.
 *
 * Enhancements:
 * - Shows each engineer's assigned route as a per-engineer polyline overlay (slightly thinner than the base route).
 * - Shows route waypoints (checkpoints) as small circle markers.
 * - Engineer markers update as the domain store refreshes dummy locations (every 30s on Dashboard).
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

function routeToStyle(route, isSelected, complianceTone) {
  if (isSelected) return { color: "#1E3A8A", weight: 5, opacity: 1.0 };

  // If complianceTone is provided, emphasize the route with a dashed alert style.
  if (complianceTone === "high") return { color: "#DC2626", weight: 6, opacity: 0.95, dashArray: "10 8" };
  if (complianceTone === "medium") return { color: "#F59E0B", weight: 6, opacity: 0.9, dashArray: "10 8" };
  if (complianceTone === "low") return { color: "#111827", weight: 5, opacity: 0.85, dashArray: "6 6" };

  const completion = Number(route.completion_percent || 0);
  // green >= 90, amber 60-89, red < 60
  if (completion >= 90) return { color: "#059669", weight: 4, opacity: 0.95 };
  if (completion >= 60) return { color: "#F59E0B", weight: 4, opacity: 0.9 };
  return { color: "#DC2626", weight: 4, opacity: 0.9 };
}

function engineerRouteOverlayStyle(severity) {
  // Keep severity emphasis but slightly lighter than main route, so base route colors remain primary.
  if (severity === "high") return { color: "#DC2626", weight: 3, opacity: 0.9, dashArray: "6 6" };
  if (severity === "medium") return { color: "#F59E0B", weight: 3, opacity: 0.85, dashArray: "6 6" };
  if (severity === "low") return { color: "#111827", weight: 3, opacity: 0.8, dashArray: "4 6" };
  return { color: "#1E3A8A", weight: 3, opacity: 0.55 };
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

  const legend = useMemo(() => {
    return [
      { label: "Good (≥ 90% completion)", color: "#059669" },
      { label: "Watch (60–89% completion)", color: "#F59E0B" },
      { label: "At Risk (< 60% completion)", color: "#DC2626" },
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
            <MapContainer center={initialCenter} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }} preferCanvas>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {bounds && <FitToVisible bounds={bounds} />}
              <FocusDeviationOnMap focusDeviation={focusDeviation} markerRefs={markerRefs} onSelectRouteId={onSelectRouteId} />

              {/* Base route polylines (completion + compliance coloring preserved) */}
              {activeRoutes.map((r) => {
                const isSelected = selectedRouteId ? r.id === selectedRouteId : false;
                const complianceTone = worstSeverityByRoute[r.id] || "";
                const style = routeToStyle(r, isSelected, complianceTone);
                const positions = toLatLngs(r.polyline);

                if (positions.length < 2) return null;

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
                        Completion: <strong>{Number(r.completion_percent || 0)}%</strong>
                      </div>
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
                const routeId = engineerAssignmentsByEngineerId.get(loc.engineerId) || "";
                const routeName = routeById.get(routeId)?.name || "";

                // Use a small, high-contrast pin to match Ocean Professional theme.
                const icon = L.divIcon({
                  className: "oceanEngineerMarker",
                  html: `<div class="oceanEngineerMarkerDot" aria-hidden="true"></div>${
                    sev ? `<div class="oceanEngineerMarkerRing ${ringClass}" aria-hidden="true"></div>` : ""
                  }`,
                  iconSize: [18, 18],
                  iconAnchor: [9, 9],
                });

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
                    <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                      <div style={{ fontWeight: 900 }}>{name}</div>
                      <div className="mini">{loc.engineerId}</div>
                      <div className="mini">
                        Region: <strong>{eng?.regionId || "—"}</strong>
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
              <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 8 }}>Route completion</div>
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
          Route colors reflect completion derived from planned/completed stops. Compliance alerts use dashed emphasis.
        </div>
      )}
    </div>
  );
}
