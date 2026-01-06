import React, { useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { createPortal } from "react-dom";
import {
  computeRouteCompletionCriteriaForRoute,
  createLruCache,
  selectEngineerIdsForRoute,
  selectEngineerNameById,
  selectRouteCommentsWithMetaForDate,
  stableWaypointsHash,
} from "../state/domainStore";

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

/**
 * Route stroke palette chosen to stay high-contrast against OSM water/land tones.
 * Slightly darker/more saturated than the theme palette, and always full opacity.
 */
const ROUTE_STROKE = {
  completed: "#047857", // darker teal-green (avoid blending with lighter greens/water)
  in_progress: "#B45309", // deeper amber
  not_completed: "#B91C1C", // deeper red
  selected: "#1E3A8A", // theme primary (navy)
};

/**
 * Subtle dark halo to separate routes from water/features without overpowering the line.
 * Use neutral/navy-black; keep some transparency so it reads as an outline.
 */
const ROUTE_HALO = {
  color: "#0b1a3a",
  opacity: 0.4,
};

/**
 * OSRM demo server settings.
 * - Public endpoint, no API keys.
 * - IMPORTANT: treat as best-effort; handle errors/rate limits gracefully.
 */
const OSRM_BASE_URL = "https://router.project-osrm.org";

/**
 * Decodes an OSRM polyline6 string into an array of [lat, lng] pairs.
 * Polyline6 uses 1e-6 precision.
 *
 * Adapted from the standard polyline algorithm (Google Encoded Polyline) with precision 6.
 */
function decodePolyline6(str) {
  if (!str || typeof str !== "string") return [];
  let index = 0;
  const len = str.length;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push([lat / 1e6, lng / 1e6]);
  }

  return coordinates;
}

function toLonLatWaypointsFromRoutePolyline(routePolyline = []) {
  // Route polylines in dummy data are [{lat,lng}, ...]
  return (routePolyline || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lng, p.lat]);
}

function stableRouteCacheKey(routeId, waypointsHash) {
  return `${routeId || "route"}::${waypointsHash || ""}`;
}

/**
 * Builds OSRM route URL for an array of [lon,lat] waypoints.
 * Uses polyline6 geometry for smaller payloads.
 */
function buildOsrmRouteUrl(waypointsLonLat) {
  const coords = (waypointsLonLat || []).map((p) => `${p[0]},${p[1]}`).join(";");
  const u = new URL(`${OSRM_BASE_URL}/route/v1/driving/${coords}`);
  u.searchParams.set("overview", "full");
  u.searchParams.set("geometries", "polyline6");
  u.searchParams.set("annotations", "duration,distance");
  return u.toString();
}

/**
 * Best-effort OSRM call. Returns:
 *  - { ok: true, latLngs, distance, duration, source: 'osrm' }
 *  - { ok: false, error }
 */
async function fetchOsrmSnappedRoute(waypointsLonLat, { signal } = {}) {
  if (!Array.isArray(waypointsLonLat) || waypointsLonLat.length < 2) {
    return { ok: false, error: "Need at least 2 waypoints." };
  }

  // OSRM demo server accepts long waypoint lists, but keep it conservative.
  if (waypointsLonLat.length > 50) {
    return { ok: false, error: "Too many waypoints for demo routing." };
  }

  const url = buildOsrmRouteUrl(waypointsLonLat);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal,
      headers: {
        // A tiny hint; some public endpoints may apply fair-use policies.
        Accept: "application/json",
      },
    });

    // OSRM demo server rate-limit may show as 429 or upstream gateway errors.
    if (!res.ok) {
      const status = res.status;
      return { ok: false, error: `OSRM HTTP ${status}` };
    }

    const json = await res.json();
    const route = json?.routes?.[0];
    const geom = route?.geometry;
    if (!geom) return { ok: false, error: "OSRM response missing geometry." };

    const latLngs = decodePolyline6(geom);
    if (!latLngs || latLngs.length < 2) return { ok: false, error: "Decoded route too short." };

    return {
      ok: true,
      latLngs,
      distance: Number(route?.distance || 0),
      duration: Number(route?.duration || 0),
      source: "osrm",
    };
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, error: "aborted" };
    return { ok: false, error: e?.message || "Network error" };
  }
}

/**
 * Small concurrency-limited async queue for OSRM requests to avoid spamming the demo server.
 * Session-scoped and created once per MapPanel instance.
 */
function createConcurrencyLimiter(maxConcurrent = 2) {
  const max = Math.max(1, Number(maxConcurrent) || 2);
  let inFlight = 0;
  const queue = [];

  const runNext = () => {
    if (inFlight >= max) return;
    const item = queue.shift();
    if (!item) return;

    inFlight += 1;
    const { fn, resolve } = item;

    Promise.resolve()
      .then(fn)
      .then((v) => resolve(v))
      .catch((err) => resolve({ ok: false, error: err?.message || "error" }))
      .finally(() => {
        inFlight -= 1;
        runNext();
      });
  };

  return (fn) =>
    new Promise((resolve) => {
      queue.push({ fn, resolve });
      runNext();
    });
}

function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), waitMs);
  };
}

/**
 * Returns a zoom-aware stroke weight, but never below the requested min.
 * This prevents lines from becoming hairlines when zoomed out (visibility issue).
 */
function strokeWeightForZoom(zoom, { min = 4, max = 8 } = {}) {
  const z = Number.isFinite(zoom) ? zoom : 12;

  // Piecewise scale: keep a strong minimum at low zoom, gently increase at higher zoom.
  // z<=10 -> min, z=12 -> min+1, z=14 -> min+2, z>=16 -> max (capped)
  const scaled = min + Math.max(0, z - 10) * 0.5;
  return Math.max(min, Math.min(max, Math.round(scaled)));
}

/**
 * Base route style rules (no selection here; selection is rendered as a top highlight layer).
 * - Compliance overlay: dashed emphasis with severity color (still visible above halo/base).
 * - Otherwise: strict completion-status colors (darker/saturated), opacity locked at 1.0.
 */
function routeToStyle({ zoom, complianceTone, completionStatus }) {
  const baseWeight = strokeWeightForZoom(zoom, { min: 4, max: 7 });

  // If complianceTone is provided, emphasize the route with a dashed alert style.
  // Keep opacity at 1.0 to avoid washed-out appearance.
  if (complianceTone === "high") return { color: ROUTE_STROKE.not_completed, weight: baseWeight + 2, opacity: 1.0, dashArray: "10 8" };
  if (complianceTone === "medium") return { color: "#D97706", weight: baseWeight + 2, opacity: 1.0, dashArray: "10 8" };
  if (complianceTone === "low") return { color: "#111827", weight: baseWeight + 1, opacity: 1.0, dashArray: "6 6" };

  if (completionStatus === "completed") return { color: ROUTE_STROKE.completed, weight: baseWeight, opacity: 1.0 };
  if (completionStatus === "in_progress") return { color: ROUTE_STROKE.in_progress, weight: baseWeight, opacity: 1.0 };

  // not_completed (default)
  return { color: ROUTE_STROKE.not_completed, weight: baseWeight, opacity: 1.0 };
}

function routeHaloStyle({ zoom, complianceTone }) {
  // Halo should be slightly thicker than the base stroke and *solid* even if compliance is dashed,
  // so the route stays legible on water/streets at far zoom.
  const baseWeight = strokeWeightForZoom(zoom, { min: 4, max: 7 });
  const haloExtra = complianceTone ? 4 : 3;
  return {
    color: ROUTE_HALO.color,
    opacity: ROUTE_HALO.opacity,
    weight: baseWeight + haloExtra,
    dashArray: null,
    lineCap: "round",
    lineJoin: "round",
  };
}

function selectionHighlightStyle({ zoom }) {
  // Selection should pop: thicker stroke + brighter outline effect.
  // We use a white-ish halo above everything plus the navy stroke on top.
  const baseWeight = strokeWeightForZoom(zoom, { min: 4, max: 7 });
  return {
    halo: { color: "#FFFFFF", opacity: 0.95, weight: baseWeight + 6, lineCap: "round", lineJoin: "round" },
    stroke: { color: ROUTE_STROKE.selected, opacity: 1.0, weight: baseWeight + 2, lineCap: "round", lineJoin: "round" },
  };
}

function assignmentPulseHighlightStyle({ zoom }) {
  // Assignment changes should be visible even when route isn't selected:
  // use a bright halo + slightly thicker primary stroke for ~3-5s.
  const baseWeight = strokeWeightForZoom(zoom, { min: 4, max: 7 });
  return {
    halo: { color: "#FFFFFF", opacity: 0.95, weight: baseWeight + 10, lineCap: "round", lineJoin: "round" },
    glow: { color: "#60A5FA", opacity: 0.85, weight: baseWeight + 7, lineCap: "round", lineJoin: "round" }, // light blue glow
    stroke: { color: "#1E3A8A", opacity: 1.0, weight: baseWeight + 3, lineCap: "round", lineJoin: "round" },
  };
}

function engineerRouteOverlayStyle(severity, zoom) {
  // Keep severity emphasis but slightly lighter than main route, so base route colors remain primary.
  // Ensure it remains visible when zoomed out by enforcing a minimum weight + full opacity.
  const w = strokeWeightForZoom(zoom, { min: 3, max: 5 });

  if (severity === "high") return { color: ROUTE_STROKE.not_completed, weight: w, opacity: 1.0, dashArray: "6 6" };
  if (severity === "medium") return { color: ROUTE_STROKE.in_progress, weight: w, opacity: 1.0, dashArray: "6 6" };
  if (severity === "low") return { color: "#111827", weight: w, opacity: 1.0, dashArray: "4 6" };
  return { color: ROUTE_STROKE.selected, weight: w, opacity: 0.9 };
}

function engineerRouteOverlayHaloStyle(zoom) {
  const w = strokeWeightForZoom(zoom, { min: 3, max: 5 });
  return {
    color: ROUTE_HALO.color,
    opacity: 0.25,
    weight: w + 3,
    lineCap: "round",
    lineJoin: "round",
  };
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
function TrackZoom({ onZoom }) {
  /** Tracks Leaflet zoom changes so polyline stroke weight can be zoom-aware while keeping min visibility. */
  const map = useMap();

  React.useEffect(() => {
    if (!map) return;

    const emit = () => {
      try {
        onZoom?.(map.getZoom());
      } catch {
        // no-op
      }
    };

    emit();
    map.on("zoomend", emit);
    return () => {
      try {
        map.off("zoomend", emit);
      } catch {
        // no-op
      }
    };
  }, [map, onZoom]);

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

export default function MapPanel({ scopedState, selectedRouteId, onSelectRouteId, complianceSnapshot }) {
  // Engineer markers/overlays are intentionally suppressed: map should display routes only.
  const [mapZoom, setMapZoom] = React.useState(12);

  // Route click popup (anchored near click). Stores only routeId + lat/lng so content can re-render as state refreshes.
  const [routePopup, setRoutePopup] = React.useState(null); // { routeId: string, lat: number, lng: number } | null

  // Assignment-change highlight: routeId -> expiresAtMs
  const [assignmentHighlightByRouteId, setAssignmentHighlightByRouteId] = React.useState(() => ({}));
  const lastPulseIdRef = useRef("");

  // OSRM snap cache + inflight tracking:
  // - cache persists for the session (component lifetime)
  // - inflight map avoids duplicate requests for the same route+waypoints
  const osrmCacheRef = useRef(null);
  const osrmLimiterRef = useRef(null);
  const osrmInflightRef = useRef(new Map());
  const osrmAbortRef = useRef(new Map());
  const [snappedByKey, setSnappedByKey] = React.useState(() => ({}));
  const [snapStatusByKey, setSnapStatusByKey] = React.useState(() => ({})); // pending|ok|error
  const [anyOsrmUsed, setAnyOsrmUsed] = React.useState(false);

  if (!osrmCacheRef.current) osrmCacheRef.current = createLruCache(100);
  if (!osrmLimiterRef.current) osrmLimiterRef.current = createConcurrencyLimiter(2);

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

  const routesWaypointMeta = useMemo(() => {
    // For OSRM: build stable hashes based on route waypoints ([lon,lat]).
    // We intentionally only re-fetch when the hash changes (not every 30s refresh unless waypoints moved).
    return (activeRoutes || [])
      .map((r) => {
        const waypoints = toLonLatWaypointsFromRoutePolyline(r.polyline || []);
        const hash = stableWaypointsHash(waypoints, { decimals: 5 });
        const key = stableRouteCacheKey(r.id, hash);
        return { routeId: r.id, hash, key, waypoints };
      })
      .filter((x) => x.waypoints.length >= 2);
  }, [activeRoutes]);

  const routesWaypointMetaByRouteId = useMemo(() => {
    const m = new Map();
    routesWaypointMeta.forEach((x) => m.set(x.routeId, x));
    return m;
  }, [routesWaypointMeta]);

  // Debounced fetch scheduler; recreated when route set changes (safe and small).
  const scheduleOsrmFetch = useMemo(() => {
    return debounce(async (items) => {
      const cache = osrmCacheRef.current;
      const limit = osrmLimiterRef.current;

      const tasks = (items || []).map((it) =>
        limit(async () => {
          const { key, routeId, waypoints } = it;

          // Cache hit: populate local state if missing.
          const cached = cache.get(key);
          if (cached?.latLngs?.length >= 2) {
            setSnappedByKey((prev) => (prev[key] ? prev : { ...prev, [key]: cached }));
            setSnapStatusByKey((prev) => (prev[key] ? prev : { ...prev, [key]: "ok" }));
            setAnyOsrmUsed(true);
            return { ok: true, cached: true };
          }

          // Avoid duplicate in-flight calls.
          if (osrmInflightRef.current.has(key)) return { ok: true, inflight: true };

          setSnapStatusByKey((prev) => ({ ...prev, [key]: "pending" }));
          osrmInflightRef.current.set(key, true);

          // Abort previous same-key (shouldn't exist if inflight map is correct, but safe).
          try {
            const prevCtl = osrmAbortRef.current.get(key);
            if (prevCtl) prevCtl.abort();
          } catch {
            // no-op
          }

          const ctl = new AbortController();
          osrmAbortRef.current.set(key, ctl);

          const result = await fetchOsrmSnappedRoute(waypoints, { signal: ctl.signal });

          osrmInflightRef.current.delete(key);

          if (result.ok) {
            const payload = { latLngs: result.latLngs, distance: result.distance, duration: result.duration, source: "osrm" };
            cache.set(key, payload);
            setSnappedByKey((prev) => ({ ...prev, [key]: payload }));
            setSnapStatusByKey((prev) => ({ ...prev, [key]: "ok" }));
            setAnyOsrmUsed(true);
            return { ok: true };
          }

          // Error: keep dummy rendering; mark error but don't break.
          setSnapStatusByKey((prev) => ({ ...prev, [key]: "error" }));
          return { ok: false, error: result.error };
        })
      );

      // Wait for completion (best-effort). We don't throw; each task resolves.
      await Promise.all(tasks);
    }, 450);
  }, []);

  const engineerAssignmentsByEngineerId = useMemo(() => {
    const m = new Map();
    (assignments || []).forEach((a) => m.set(a.engineerId, a.routeId));
    return m;
  }, [assignments]);

  const engineerRouteOverlays = useMemo(() => {
    // Build a per-engineer overlay polyline for their assigned route.
    // If OSRM snapped geometry exists for the assigned route, use it so overlays match the base route.
    return (activeLocations || [])
      .map((loc) => {
        const routeId = engineerAssignmentsByEngineerId.get(loc.engineerId);
        const route = routeId ? routeById.get(routeId) : null;

        const waypointMeta = route?.id ? routesWaypointMetaByRouteId.get(route.id) : null;
        const snapKey = waypointMeta?.key || "";
        const snapped = snapKey ? snappedByKey?.[snapKey] || osrmCacheRef.current.get(snapKey) : null;

        const positions = snapped?.latLngs?.length >= 2 ? snapped.latLngs : toLatLngs(route?.polyline || []);

        return {
          engineerId: loc.engineerId,
          routeId: route?.id || "",
          routeName: route?.name || "",
          positions,
          snapKey,
        };
      })
      .filter((x) => x.positions.length >= 2);
  }, [activeLocations, engineerAssignmentsByEngineerId, routeById, routesWaypointMetaByRouteId, snappedByKey]);

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
    // Routes-only viewport: we deliberately ignore engineer locations/markers.
    const pts = [];
    activeRoutes.forEach((r) => {
      toLatLngs(r.polyline).forEach((p) => pts.push(p));
    });
    return pts;
  }, [activeRoutes]);

  const hasAnyGeo = latLngsForBounds.length > 0;

  const bounds = useMemo(() => {
    if (!hasAnyGeo) return null;
    return L.latLngBounds(latLngsForBounds);
  }, [hasAnyGeo, latLngsForBounds]);

  const initialCenter = useMemo(() => {
    // Center on first visible route coordinate, else default US center-ish.
    const firstRoute = activeRoutes?.[0];
    const firstPoint = firstRoute?.polyline?.[0];
    return firstPoint && Number.isFinite(firstPoint.lat) && Number.isFinite(firstPoint.lng)
      ? [firstPoint.lat, firstPoint.lng]
      : [39.8283, -98.5795];
  }, [activeRoutes]);

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

  const routePopupDetails = useMemo(() => {
    if (!routePopup?.routeId) return null;
    const route = (activeRoutes || []).find((r) => r.id === routePopup.routeId);
    if (!route) return null;

    const criteria = routeCompletionById?.[route.id] || computeRouteCompletionCriteriaForRoute(route, scopedState?.tasks || []);
    const regionName = getRegionName(scopedState, route.regionId);
    const managerName = getRegionalManagerName(scopedState, route.regionId);

    const completionPercent = Number(route?.completion_percent || 0);

    const strictStatus = criteria?.isCompleted
      ? "Completed"
      : (Number(criteria?.completedStops || 0) > 0 || Number(criteria?.completedTasks || 0) > 0)
        ? "In progress"
        : "Not completed";

    // Route-level comments sourced from persisted task history/notes (role-scoped via scopedState).
    // Enriched with engineer name + a short local timestamp label for the popup UI.
    const comments = selectRouteCommentsWithMetaForDate(scopedState, { routeId: route.id });

    // Assignment context (routes-only rendering preserved; no engineer markers added).
    const assignedEngineerIds = selectEngineerIdsForRoute(scopedState, route.id);
    const assignedEngineers = assignedEngineerIds
      .map((id) => ({ id, name: selectEngineerNameById(scopedState, id) }))
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));

    return {
      routeId: route.id,
      routeName: route.name || route.id,
      regionName,
      managerName,
      assignedEngineers,
      totalWaypoints: Number(criteria?.plannedStops ?? 0),
      waypointsCovered: Math.min(Number(criteria?.completedStops ?? 0), Number(criteria?.plannedStops ?? 0)),
      totalTasks: Number(criteria?.totalTasks ?? 0),
      tasksCompleted: Number(criteria?.completedTasks ?? 0),
      strictStatus,
      completionPercent,
      isStrictCompleted: Boolean(criteria?.isCompleted),
      comments,
    };
  }, [routePopup, activeRoutes, routeCompletionById, scopedState]);

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
      { label: "Completed", color: ROUTE_STROKE.completed },
      { label: "In progress", color: ROUTE_STROKE.in_progress },
      { label: "Not completed", color: ROUTE_STROKE.not_completed },
      { label: "Compliance alerts (dashed)", color: "#111827" },
    ];
  }, []);

  // Fetch snapped OSRM geometries when route waypoint hashes change.
  React.useEffect(() => {
    const list = routesWaypointMeta || [];
    if (list.length === 0) return;

    // Determine which keys need fetching.
    const cache = osrmCacheRef.current;
    const toFetch = [];

    list.forEach((it) => {
      const cached = cache.get(it.key);
      const alreadyInState = snappedByKey[it.key];
      if (cached?.latLngs?.length >= 2 || alreadyInState?.latLngs?.length >= 2) {
        // Ensure status is ok for cached entries (may be missing on first render).
        setSnapStatusByKey((prev) => (prev[it.key] ? prev : { ...prev, [it.key]: "ok" }));
        return;
      }

      // If previously errored, we still allow retry when hash changes (key changes).
      toFetch.push(it);
    });

    if (toFetch.length > 0) scheduleOsrmFetch(toFetch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesWaypointMeta, scheduleOsrmFetch]);

  // Assignment-change pulse:
  // - Briefly emphasize affected routes for ~4 seconds.
  // - Force OSRM snapped polylines to refresh for affected routes by dropping cached/state entries.
  React.useEffect(() => {
    const pulse = scopedState?.routeChangePulse;
    if (!pulse?.id || pulse.id === lastPulseIdRef.current) return;

    lastPulseIdRef.current = pulse.id;

    const routeIds = Array.isArray(pulse.routeIds) ? pulse.routeIds.filter(Boolean) : [];
    if (routeIds.length === 0) return;

    const ttlMs = 4200;
    const expiresAt = Date.now() + ttlMs;

    // 1) Highlight routes
    setAssignmentHighlightByRouteId((prev) => {
      const next = { ...prev };
      routeIds.forEach((rid) => {
        next[rid] = expiresAt;
      });
      return next;
    });

    // Ensure highlight is removed after TTL. (We keep it simple; no interval needed.)
    const t = window.setTimeout(() => {
      setAssignmentHighlightByRouteId((prev) => {
        const next = { ...prev };
        const now = Date.now();
        Object.keys(next).forEach((rid) => {
          if (next[rid] <= now) delete next[rid];
        });
        return next;
      });
    }, ttlMs + 120);

    // 2) Force OSRM refresh for affected route(s):
    // Drop in-memory LRU entries and local state entries for all keys that match those routeIds.
    try {
      const routeKeyPrefixes = new Set(routeIds.map((rid) => `${rid}::`));
      const cache = osrmCacheRef.current;

      // Remove from React state maps (snapped/status) so the hash-based effect refetches.
      setSnappedByKey((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          for (const prefix of routeKeyPrefixes) {
            if (k.startsWith(prefix)) delete next[k];
          }
        });
        return next;
      });

      setSnapStatusByKey((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          for (const prefix of routeKeyPrefixes) {
            if (k.startsWith(prefix)) delete next[k];
          }
        });
        return next;
      });

      // Also drop from the LRU itself. We don't have direct key iteration on the cache by design,
      // but we can "invalidate" by overwriting to undefined only when we know keys:
      // use current route waypoint meta keys as the authoritative list.
      (routesWaypointMeta || []).forEach((it) => {
        if (!it?.key) return;
        for (const prefix of routeKeyPrefixes) {
          if (it.key.startsWith(prefix)) cache.set(it.key, undefined);
        }
      });
    } catch {
      // no-op: snapping is best-effort; highlight should still work.
    }

    return () => window.clearTimeout(t);
  }, [scopedState?.routeChangePulse, routesWaypointMeta]);

  // If scope changes and the selected popup route is no longer available, close the popup.
  React.useEffect(() => {
    if (!routePopup?.routeId) return;
    const stillExists = (activeRoutes || []).some((r) => r.id === routePopup.routeId);
    if (!stillExists) setRoutePopup(null);
  }, [activeRoutes, routePopup?.routeId]);

  React.useEffect(() => {
    // Cleanup: abort any inflight requests when the map panel unmounts.
    return () => {
      try {
        osrmAbortRef.current.forEach((ctl) => ctl?.abort?.());
        osrmAbortRef.current.clear();
      } catch {
        // no-op
      }
      try {
        osrmInflightRef.current.clear();
      } catch {
        // no-op
      }
    };
  }, []);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Map Overview</h2>
          <p>Route polylines and checkpoints</p>
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

              {/* Track zoom for visibility-aware polyline styling (does not alter map behavior). */}
              <TrackZoom onZoom={setMapZoom} />

              {/* New explicit user-facing controls (recenter/fit/fullscreen) */}
              {bounds && <MapControls bounds={bounds} />}

              {/* Base route polylines (strict completion coloring + compliance dashed emphasis)
                  Rendered as layered strokes to ensure visibility on water/tiles at all zoom levels:
                  1) neutral halo (under)
                  2) base stroke (solid, high-contrast, opacity locked at 1.0)
                  3) compliance dashed overlay (if applicable)
                  4) selection highlight (top-most)
              */}
              {activeRoutes.map((r) => {
                const isSelected = selectedRouteId ? r.id === selectedRouteId : false;
                const complianceTone = worstSeverityByRoute[r.id] || "";
                const completionStatus = routeCompletionStatusById?.[r.id] || "not_completed";
                const criteria = routeCompletionById?.[r.id] || null;

                const waypointMeta = routesWaypointMetaByRouteId.get(r.id);
                const snapKey = waypointMeta?.key || "";
                const snapStatus = snapKey ? snapStatusByKey?.[snapKey] : "";
                const snapped = snapKey ? snappedByKey?.[snapKey] || osrmCacheRef.current.get(snapKey) : null;

                // Prefer OSRM-snapped geometry when available; fallback to dummy polyline.
                const positions = snapped?.latLngs?.length >= 2 ? snapped.latLngs : toLatLngs(r.polyline);
                if (positions.length < 2) return null;

                const statusLabel =
                  completionStatus === "completed"
                    ? "Completed"
                    : completionStatus === "in_progress"
                      ? "In progress"
                      : "Not completed";

                // Base style is always solid and full opacity; compliance is rendered as a separate dashed overlay.
                const baseStyle = routeToStyle({ zoom: mapZoom, complianceTone: "", completionStatus });
                const complianceStyle = complianceTone ? routeToStyle({ zoom: mapZoom, complianceTone, completionStatus }) : null;
                const haloStyle = routeHaloStyle({ zoom: mapZoom, complianceTone: complianceTone || "" });
                const sel = selectionHighlightStyle({ zoom: mapZoom });

                const now = Date.now();
                const isAssignmentHighlighted = Number(assignmentHighlightByRouteId?.[r.id] || 0) > now;
                const pulse = assignmentPulseHighlightStyle({ zoom: mapZoom });

                return (
                  <React.Fragment key={`route_stack_${r.id}`}>
                    {/* Under-halo */}
                    <Polyline positions={positions} pathOptions={haloStyle} interactive={false} />

                    {/* Base visible stroke (clickable/selectable) */}
                    <Polyline
                      positions={positions}
                      pathOptions={baseStyle}
                      eventHandlers={{
                        click: (e) => {
                          onSelectRouteId?.(r.id);

                          // Anchor popup near click position (lat/lng), and let content re-render on state refresh.
                          const latlng = e?.latlng;
                          if (latlng && Number.isFinite(latlng.lat) && Number.isFinite(latlng.lng)) {
                            setRoutePopup({ routeId: r.id, lat: latlng.lat, lng: latlng.lng });
                          } else {
                            // Fallback: anchor at first point of route if click event doesn't provide latlng (unlikely).
                            const first = positions?.[0];
                            if (Array.isArray(first) && first.length === 2) {
                              setRoutePopup({ routeId: r.id, lat: first[0], lng: first[1] });
                            } else {
                              setRoutePopup({ routeId: r.id, lat: initialCenter[0], lng: initialCenter[1] });
                            }
                          }
                        },
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
                            Waypoints: <strong>{criteria.waypointsCovered ? "covered" : "not covered"}</strong>
                            {" • "}
                            Tasks:{" "}
                            <strong>
                              {criteria.completedTasks}/{criteria.totalTasks} completed
                            </strong>
                          </div>
                        ) : null}

                        {snapKey ? (
                          <div className="mini">
                            Routing:{" "}
                            <strong>
                              {snapStatus === "pending"
                                ? "snapping…"
                                : snapped?.source === "osrm"
                                  ? "snapped to OSRM"
                                  : snapStatus === "error"
                                    ? "fallback (dummy)"
                                    : "fallback (dummy)"}
                            </strong>
                          </div>
                        ) : null}

                        {complianceTone ? (
                          <div className="mini">
                            Compliance: <strong style={{ textTransform: "uppercase" }}>{String(complianceTone)}</strong>
                          </div>
                        ) : null}

                        <div className="mini">Click to select</div>
                      </Tooltip>
                    </Polyline>

                    {/* Compliance dashed overlay (above base; not clickable) */}
                    {complianceStyle ? <Polyline positions={positions} pathOptions={complianceStyle} interactive={false} /> : null}

                    {/* Assignment-change pulse highlight (top-most unless selected highlight also present) */}
                    {isAssignmentHighlighted ? (
                      <>
                        <Polyline positions={positions} pathOptions={pulse.halo} interactive={false} />
                        <Polyline positions={positions} pathOptions={pulse.glow} interactive={false} />
                        <Polyline positions={positions} pathOptions={pulse.stroke} interactive={false} />
                      </>
                    ) : null}

                    {/* Selection highlight (top-most) */}
                    {isSelected ? (
                      <>
                        <Polyline positions={positions} pathOptions={sel.halo} interactive={false} />
                        <Polyline positions={positions} pathOptions={sel.stroke} interactive={false} />
                      </>
                    ) : null}
                  </React.Fragment>
                );
              })}

              {/* Route click popup (completion details) */}
              {routePopup && routePopupDetails ? (
                <Popup
                  position={[routePopup.lat, routePopup.lng]}
                  closeButton
                  autoPan
                  keepInView
                  closeOnEscapeKey
                  eventHandlers={{
                    remove: () => setRoutePopup(null),
                  }}
                >
                  <div
                    role="dialog"
                    aria-label={`Route completion details for ${routePopupDetails.routeName}`}
                    style={{ minWidth: 260, maxWidth: 340 }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 13, color: "var(--ocean-text)" }}>
                          {routePopupDetails.routeName}
                        </div>
                        <div className="mini" style={{ marginTop: 2 }}>
                          ID: <strong>{routePopupDetails.routeId}</strong>
                        </div>
                      </div>

                      <span
                        className={
                          routePopupDetails.strictStatus === "Completed"
                            ? "badge badgeSuccess"
                            : routePopupDetails.strictStatus === "In progress"
                              ? "badge badgeWarn"
                              : "badge badgeError"
                        }
                        aria-label={`Strict completion status: ${routePopupDetails.strictStatus}`}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {routePopupDetails.strictStatus}
                      </span>
                    </div>

                    <hr className="hr" style={{ margin: "10px 0" }} />

                    <div style={{ display: "grid", gap: 6 }}>
                      <div className="mini">
                        Region: <strong>{fmtOrDash(routePopupDetails.regionName)}</strong>
                      </div>
                      <div className="mini">
                        Assigned manager: <strong>{fmtOrDash(routePopupDetails.managerName)}</strong>
                      </div>

                      <div className="mini">
                        Assigned engineer(s):{" "}
                        <strong>
                          {Array.isArray(routePopupDetails.assignedEngineers) && routePopupDetails.assignedEngineers.length > 0
                            ? routePopupDetails.assignedEngineers.map((e) => e.name || e.id).join(", ")
                            : "Unassigned"}
                        </strong>
                      </div>

                      <div className="mini">
                        Total waypoints: <strong>{routePopupDetails.totalWaypoints}</strong>
                      </div>
                      <div className="mini">
                        Waypoints covered:{" "}
                        <strong>
                          {routePopupDetails.waypointsCovered}/{routePopupDetails.totalWaypoints}
                        </strong>
                      </div>

                      <div className="mini">
                        Total tasks: <strong>{routePopupDetails.totalTasks}</strong>
                      </div>
                      <div className="mini">
                        Tasks completed:{" "}
                        <strong>
                          {routePopupDetails.tasksCompleted}/{routePopupDetails.totalTasks}
                        </strong>
                      </div>

                      <div className="mini">
                        Overall route completion: <strong>{Math.round(routePopupDetails.completionPercent)}%</strong>
                      </div>

                      <div className="mini" style={{ marginTop: 2, color: "var(--ocean-muted)" }}>
                        Strict completion requires <strong>all waypoints covered</strong> and <strong>all tasks completed</strong>.
                      </div>

                      {Array.isArray(routePopupDetails.comments) && routePopupDetails.comments.length > 0 ? (
                        <>
                          <hr className="hr" style={{ margin: "10px 0" }} />
                          <div style={{ fontWeight: 900, fontSize: 12, color: "var(--ocean-text)" }}>Comments</div>
                          <div style={{ display: "grid", gap: 6 }}>
                            {routePopupDetails.comments.slice(0, 4).map((c) => (
                              <div
                                key={c.id}
                                style={{
                                  padding: "6px 8px",
                                  border: "1px solid var(--ocean-border)",
                                  borderRadius: 10,
                                  background: "rgba(255,255,255,0.70)",
                                }}
                              >
                                <div
                                  className="mini"
                                  style={{
                                    display: "flex",
                                    alignItems: "baseline",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    lineHeight: 1.2,
                                    color: "var(--ocean-muted)",
                                  }}
                                >
                                  <span style={{ fontWeight: 900, color: "var(--ocean-text)" }}>
                                    {c.engineerName || "Engineer"}
                                  </span>
                                  <span style={{ whiteSpace: "nowrap" }}>{c.timestampLabel || "—"}</span>
                                </div>

                                <div className="mini" style={{ marginTop: 4, lineHeight: 1.25 }}>
                                  <strong style={{ textTransform: "capitalize" }}>
                                    {String(c.type || "")
                                      .replaceAll("_", " ")
                                      .trim()}
                                    :
                                  </strong>{" "}
                                  {c.text}
                                </div>
                              </div>
                            ))}
                            {routePopupDetails.comments.length > 4 ? (
                              <div className="mini" style={{ color: "var(--ocean-muted)" }}>
                                +{routePopupDetails.comments.length - 4} more
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </Popup>
              ) : null}

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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 12 }}>Route status</div>

                {/* Lightweight OSRM status indicator (no new deps) */}
                {Object.values(snapStatusByKey || {}).some((s) => s === "pending") ? (
                  <span
                    className="badge"
                    style={{
                      padding: "4px 8px",
                      fontSize: 11,
                      background: "rgba(30,58,138,0.08)",
                      borderColor: "rgba(30,58,138,0.20)",
                      color: "var(--ocean-primary)",
                      fontWeight: 900,
                    }}
                    aria-label="Routes are being snapped to OSRM"
                  >
                    Snapping…
                  </span>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
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

                {anyOsrmUsed ? (
                  <div className="mini" style={{ marginTop: 6 }}>
                    <strong>Routes snapped to OSRM</strong>
                  </div>
                ) : null}

                <div className="mini" style={{ marginTop: 6 }}>
                  Checkpoints are shown as <strong>small circles</strong>.
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
        <button
          className="btn btnGhost"
          onClick={() => {
            onSelectRouteId?.("");
            setRoutePopup(null);
          }}
          disabled={!selectedRouteId}
        >
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
