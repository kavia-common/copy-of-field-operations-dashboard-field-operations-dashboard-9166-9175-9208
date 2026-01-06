import React, { useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip } from "react-leaflet";
import L from "leaflet";
import { useMap } from "react-leaflet";

/**
 * Leaflet (React-Leaflet) map panel: renders markers for engineers and polylines for routes.
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

function getEngineerName(scopedState, engineerId) {
  const u = (scopedState?.users || []).find((x) => x.id === engineerId);
  return u?.name || engineerId;
}

function routeToStyle(route, isSelected) {
  if (isSelected) return { color: "#1E3A8A", weight: 5, opacity: 1.0 };

  const completion = Number(route.completion_percent || 0);
  // green >= 90, amber 60-89, red < 60
  if (completion >= 90) return { color: "#059669", weight: 4, opacity: 0.95 };
  if (completion >= 60) return { color: "#F59E0B", weight: 4, opacity: 0.9 };
  return { color: "#DC2626", weight: 4, opacity: 0.9 };
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

export default function MapPanel({ scopedState, selectedRouteId, onSelectRouteId }) {
  const activeRoutes = useMemo(() => {
    if (!scopedState) return [];
    return scopedState.routes || [];
  }, [scopedState]);

  const activeLocations = useMemo(() => {
    if (!scopedState) return [];
    return scopedState.engineerLiveLocations || [];
  }, [scopedState]);

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
      { label: "Good (≥ 90%)", color: "#059669" },
      { label: "Watch (60–89%)", color: "#F59E0B" },
      { label: "At Risk (< 60%)", color: "#DC2626" },
    ];
  }, []);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Map Overview</h2>
          <p>Engineer locations and route polylines</p>
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
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {bounds && <FitToVisible bounds={bounds} />}

              {activeRoutes.map((r) => {
                const isSelected = selectedRouteId ? r.id === selectedRouteId : false;
                const style = routeToStyle(r, isSelected);
                const positions = toLatLngs(r.polyline);

                if (positions.length < 2) return null;

                return (
                  <Polyline
                    key={r.id}
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
                      <div className="mini">Click to select</div>
                    </Tooltip>
                  </Polyline>
                );
              })}

              {activeLocations.map((loc) => {
                if (!Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lng)) return null;

                const name = getEngineerName(scopedState, loc.engineerId);

                // Use a small, high-contrast pin to match Ocean Professional theme.
                const icon = L.divIcon({
                  className: "oceanEngineerMarker",
                  html: `<div class="oceanEngineerMarkerDot" aria-hidden="true"></div>`,
                  iconSize: [16, 16],
                  iconAnchor: [8, 8],
                });

                return (
                  <Marker key={loc.engineerId} position={[loc.lat, loc.lng]} icon={icon}>
                    <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                      <div style={{ fontWeight: 900 }}>{name}</div>
                      <div className="mini">{loc.engineerId}</div>
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
          Route colors reflect completion derived from planned/completed stops.
        </div>
      )}
    </div>
  );
}
