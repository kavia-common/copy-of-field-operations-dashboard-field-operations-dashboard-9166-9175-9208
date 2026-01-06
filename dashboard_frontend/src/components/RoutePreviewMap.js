import React from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { createOsrmSnapper, stableWaypointsHash, toLonLatFromLatLngPoints } from "../utils/osrm";

/**
 * Preview map used in the route editor modal.
 * Planned routes should follow roads where possible using OSRM snapping.
 */

// Shared snapper for this component instance (in-memory cache, best-effort).
const snapper = createOsrmSnapper({ maxCacheEntries: 80, maxConcurrent: 1 });

function toLatLngs(waypointsLatLng) {
  return (waypointsLatLng || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lat, p.lng]);
}

// PUBLIC_INTERFACE
export default function RoutePreviewMap({ waypoints }) {
  /**
   * Small, isolated Leaflet preview map used only in the route editor modal.
   * - Uses OSRM demo server snapping as best-effort (fallback to straight lines).
   * - Uses internal cache for smooth editing (drag/add/remove waypoints).
   */
  const [snapped, setSnapped] = React.useState(null); // latLngs[] | null
  const [status, setStatus] = React.useState("idle"); // idle|pending|ok|error

  const lonLat = React.useMemo(() => toLonLatFromLatLngPoints(waypoints), [waypoints]);
  const hash = React.useMemo(() => stableWaypointsHash(lonLat, { decimals: 5 }), [lonLat]);
  const snapKey = React.useMemo(() => `preview::${hash}`, [hash]);

  const fallback = React.useMemo(() => toLatLngs(waypoints), [waypoints]);
  const positions = snapped?.length >= 2 ? snapped : fallback;

  const bounds = React.useMemo(() => {
    if (!positions || positions.length === 0) return null;
    try {
      return L.latLngBounds(positions);
    } catch {
      return null;
    }
  }, [positions]);

  React.useEffect(() => {
    // Best-effort snap when the waypoint hash changes.
    if (!hash || lonLat.length < 2) {
      setSnapped(null);
      setStatus("idle");
      return;
    }

    setStatus("pending");
    snapper
      .snap({ key: snapKey, waypointsLonLat: lonLat })
      .then((res) => {
        if (!res.ok) {
          setSnapped(null);
          setStatus("error");
          return;
        }
        setSnapped(res.latLngs);
        setStatus("ok");
      })
      .catch(() => {
        setSnapped(null);
        setStatus("error");
      });

    return () => {
      // no-op: snapper manages aborts; preview does not strictly need per-effect abort
    };
  }, [hash, lonLat, snapKey]);

  React.useEffect(() => {
    return () => {
      // cleanup any inflight request when preview unmounts
      snapper.cleanup();
    };
  }, []);

  const center = React.useMemo(() => {
    const p = positions?.[0];
    if (Array.isArray(p) && p.length === 2) return p;
    return [39.8283, -98.5795];
  }, [positions]);

  return (
    <div
      style={{
        border: "1px solid var(--ocean-border)",
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--ocean-surface)",
        boxShadow: "var(--shadow-sm)",
      }}
      aria-label="Route waypoint preview map"
    >
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 12, color: "var(--ocean-text)" }}>Preview</div>
        <span
          className="badge"
          style={{
            padding: "4px 8px",
            fontSize: 11,
            background:
              status === "pending"
                ? "rgba(30,58,138,0.08)"
                : status === "ok"
                  ? "rgba(5,150,105,0.12)"
                  : status === "error"
                    ? "rgba(245,158,11,0.14)"
                    : "rgba(17,24,39,0.06)",
            borderColor:
              status === "pending"
                ? "rgba(30,58,138,0.20)"
                : status === "ok"
                  ? "rgba(5,150,105,0.35)"
                  : status === "error"
                    ? "rgba(245,158,11,0.45)"
                    : "rgba(17,24,39,0.16)",
            color:
              status === "pending"
                ? "var(--ocean-primary)"
                : status === "ok"
                  ? "#059669"
                  : status === "error"
                    ? "#B45309"
                    : "var(--ocean-muted)",
            fontWeight: 900,
          }}
          aria-label={status === "ok" ? "Snapped to OSRM" : status === "pending" ? "Snapping in progress" : "Using fallback geometry"}
        >
          {status === "pending" ? "Snapping…" : status === "ok" ? "OSRM snapped" : status === "error" ? "Fallback" : "Idle"}
        </span>
      </div>

      <div style={{ height: 220, width: "100%" }}>
        <MapContainer
          center={center}
          zoom={12}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
          preferCanvas
          zoomControl={false}
          dragging
          doubleClickZoom={false}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {positions?.length >= 2 ? (
            <Polyline
              positions={positions}
              pathOptions={{
                color: "#1E3A8A",
                weight: 5,
                opacity: 0.95,
              }}
            />
          ) : null}

          {(waypoints || []).map((p, idx) => {
            if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
            const isFirst = idx === 0;
            const isLast = idx === (waypoints || []).length - 1;
            return (
              <CircleMarker
                key={`wp_${idx}`}
                center={[p.lat, p.lng]}
                radius={isFirst || isLast ? 6 : 4}
                pathOptions={{
                  color: "rgba(17,24,39,0.75)",
                  fillColor: isFirst ? "#059669" : isLast ? "#F59E0B" : "#FFFFFF",
                  fillOpacity: 0.9,
                  weight: 1,
                }}
              />
            );
          })}

          {bounds ? <FitBounds bounds={bounds} /> : null}
        </MapContainer>
      </div>
    </div>
  );
}

// PUBLIC_INTERFACE
function FitBounds({ bounds }) {
  /** Fits the preview map to the current polyline/waypoints bounds. */
  const map = useMap();
  React.useEffect(() => {
    if (!bounds) return;
    try {
      map.fitBounds(bounds, { padding: [18, 18] });
    } catch {
      // no-op
    }
  }, [bounds, map]);
  return null;
}
