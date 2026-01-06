import React, { useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { createPortal } from "react-dom";
import Modal from "./Modal";
import {
  computeRouteCompletionCriteriaForRoute,
  createLruCache,
  selectDeviationDetailsForRoute,
  selectEngineerIdsForRoute,
  selectEngineerNameById,
  selectRouteCommentsWithMetaForDate,
  stableWaypointsHash,
} from "../state/domainStore";

// Optional plugin: fullscreen control (adds L.control.fullscreen)
import "leaflet.fullscreen";

/**
 * Leaflet (React-Leaflet) map panel implementing the UX hierarchy:
 *   Region (mandatory) → Routes (multi-select) → Engineers (auto-shown).
 *
 * UX requirements implemented:
 * - Mandatory region selector (reduces clutter and improves performance)
 * - Checkbox-based multi-route visibility with unique colors
 * - Engineers shown as overlay markers inheriting assigned route color
 * - Map styling rules:
 *    - Planned route: thick dashed (route color)
 *    - Actual path: solid (route color) using OSRM-snapped geometry when available
 *    - Deviation: red highlight overlay when compliance flags exist for that route/engineer
 *
 * Notes:
 * - Uses OpenStreetMap tiles (no API keys required).
 * - Click a route polyline to select it (filters other panels via selectedRouteId).
 * - Auto-fits viewport to visible routes + engineers in selected region.
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

function toLonLatWaypointsFromRoutePolyline(routePolyline = []) {
  // Route polylines in dummy data are [{lat,lng}, ...]
  return (routePolyline || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lng, p.lat]);
}

function stableRouteCacheKey(routeId, waypointsHash) {
  return `${routeId || "route"}::${waypointsHash || ""}`;
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

function fmtOrDash(v) {
  return v ? v : "—";
}

const ROUTE_COLOR_PALETTE = [
  "#1E3A8A", // navy
  "#047857", // teal-green
  "#B45309", // amber/brown
  "#7C3AED", // violet
  "#0F766E", // teal
  "#BE185D", // magenta
  "#2563EB", // blue
  "#16A34A", // green
  "#D97706", // orange
  "#334155", // slate
];

const DEVIATION_RED = "#DC2626";

const ROUTE_HALO = {
  color: "#0b1a3a",
  opacity: 0.35,
};

function colorForIndex(i) {
  return ROUTE_COLOR_PALETTE[Math.abs(i) % ROUTE_COLOR_PALETTE.length];
}

function isValidRegionId(scopedState, regionId) {
  return Boolean(regionId && (scopedState?.regions || []).some((r) => r.id === regionId));
}

function buildRouteColorMap(routesInRegion) {
  // Assign deterministic colors based on stable sorted order (so colors don't change between refreshes).
  const sorted = (routesInRegion || [])
    .slice()
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)) || String(a.id).localeCompare(String(b.id)));
  const map = {};
  sorted.forEach((r, idx) => {
    map[r.id] = colorForIndex(idx);
  });
  return map;
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
  const scaled = min + Math.max(0, z - 10) * 0.5;
  return Math.max(min, Math.min(max, Math.round(scaled)));
}

function routeHaloStyle({ zoom }) {
  const baseWeight = strokeWeightForZoom(zoom, { min: 5, max: 9 });
  return {
    color: ROUTE_HALO.color,
    opacity: ROUTE_HALO.opacity,
    weight: baseWeight + 4,
    dashArray: null,
    lineCap: "round",
    lineJoin: "round",
  };
}

function plannedRouteStyle({ zoom, color }) {
  const base = strokeWeightForZoom(zoom, { min: 5, max: 9 });
  return { color, weight: base, opacity: 1.0, dashArray: "12 10", lineCap: "round", lineJoin: "round" };
}

function actualPathStyle({ zoom, color }) {
  const base = strokeWeightForZoom(zoom, { min: 4, max: 8 });
  return { color, weight: Math.max(3, base - 1), opacity: 0.95, lineCap: "round", lineJoin: "round" };
}

function deviationHighlightStyle({ zoom }) {
  const base = strokeWeightForZoom(zoom, { min: 6, max: 11 });
  return { color: DEVIATION_RED, weight: base, opacity: 0.95, dashArray: "10 7", lineCap: "round", lineJoin: "round" };
}

function selectionHighlightStyle({ zoom }) {
  const baseWeight = strokeWeightForZoom(zoom, { min: 5, max: 9 });
  return {
    halo: { color: "#FFFFFF", opacity: 0.95, weight: baseWeight + 6, lineCap: "round", lineJoin: "round" },
    stroke: { color: "#1E3A8A", opacity: 1.0, weight: baseWeight + 2, lineCap: "round", lineJoin: "round" },
  };
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

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  L.DomEvent.on(btn, "click", (e) => {
    L.DomEvent.stopPropagation(e);
    L.DomEvent.preventDefault(e);
    onClick?.();
  });

  return container;
}

/**
 * OSRM demo server settings.
 * - Public endpoint, no API keys.
 * - IMPORTANT: treat as best-effort; handle errors/rate limits gracefully.
 */
const OSRM_BASE_URL = "https://router.project-osrm.org";

/**
 * Decodes an OSRM polyline6 string into an array of [lat, lng] pairs.
 * Polyline6 uses 1e-6 precision.
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

function buildOsrmRouteUrl(waypointsLonLat) {
  const coords = (waypointsLonLat || []).map((p) => `${p[0]},${p[1]}`).join(";");
  const u = new URL(`${OSRM_BASE_URL}/route/v1/driving/${coords}`);
  u.searchParams.set("overview", "full");
  u.searchParams.set("geometries", "polyline6");
  u.searchParams.set("annotations", "duration,distance");
  return u.toString();
}

async function fetchOsrmSnappedRoute(waypointsLonLat, { signal } = {}) {
  if (!Array.isArray(waypointsLonLat) || waypointsLonLat.length < 2) {
    return { ok: false, error: "Need at least 2 waypoints." };
  }
  if (waypointsLonLat.length > 50) {
    return { ok: false, error: "Too many waypoints for demo routing." };
  }

  const url = buildOsrmRouteUrl(waypointsLonLat);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return { ok: false, error: `OSRM HTTP ${res.status}` };
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

/**
 * Forces Leaflet to recompute its layout when mounted and when triggerKey changes.
 */
// PUBLIC_INTERFACE
function InvalidateSizeOnMountAndResize({ triggerKey }) {
  /** Calls map.invalidateSize() shortly after mount and when triggerKey changes. */
  const map = useMap();

  React.useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      try {
        map.invalidateSize();
      } catch {
        // no-op
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
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [bounds, map]);

  return null;
}

/**
 * Disables/enables Leaflet interactions without unmounting the map.
 * This preserves map instance state (layers, caches, bounds) while preventing user pan/zoom/keyboard/touch interactions.
 */
// PUBLIC_INTERFACE
function LeafletInteractionToggle({ disabled }) {
  /** Toggle all Leaflet interaction handlers on the current map. */
  const map = useMap();

  React.useEffect(() => {
    if (!map) return;

    const enable = () => {
      // Core interactions
      try {
        map.dragging?.enable?.();
      } catch {}
      try {
        map.scrollWheelZoom?.enable?.();
      } catch {}
      try {
        map.doubleClickZoom?.enable?.();
      } catch {}
      try {
        map.boxZoom?.enable?.();
      } catch {}
      try {
        map.keyboard?.enable?.();
      } catch {}
      try {
        map.touchZoom?.enable?.();
      } catch {}
      try {
        map.tap?.enable?.(); // mobile tap handler (if present)
      } catch {}

      // Some browsers/devices use the generic "gestureHandling" plugin; if present, re-enable.
      try {
        map.gestureHandling?.enable?.();
      } catch {}
    };

    const disableAll = () => {
      try {
        map.dragging?.disable?.();
      } catch {}
      try {
        map.scrollWheelZoom?.disable?.();
      } catch {}
      try {
        map.doubleClickZoom?.disable?.();
      } catch {}
      try {
        map.boxZoom?.disable?.();
      } catch {}
      try {
        map.keyboard?.disable?.();
      } catch {}
      try {
        map.touchZoom?.disable?.();
      } catch {}
      try {
        map.tap?.disable?.();
      } catch {}
      try {
        map.gestureHandling?.disable?.();
      } catch {}

      // If a contextmenu handler is registered (plugin), it often listens on the container.
      // We don't mutate styles/DOM, but we can best-effort disable the handler if it exists.
      try {
        map.contextmenu?.disable?.();
      } catch {}
    };

    if (disabled) disableAll();
    else enable();

    // On unmount, restore interactions to avoid leaving the map locked if component tree changes.
    return () => enable();
  }, [map, disabled]);

  return null;
}

// PUBLIC_INTERFACE
function TrackZoom({ onZoom }) {
  /** Tracks Leaflet zoom changes so polyline stroke weight can be zoom-aware. */
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

// PUBLIC_INTERFACE
function MapControls({ bounds }) {
  /**
   * Adds UI controls to the map:
   * - Fit-to-bounds
   * - Recenter
   * - Optional fullscreen toggle via leaflet.fullscreen
   */
  const map = useMap();

  React.useEffect(() => {
    if (!map) return;

    const ctlGroup = L.control({ position: "topright" });
    ctlGroup.onAdd = () => {
      const wrap = L.DomUtil.create("div", "oceanMapControlGroup");
      wrap.appendChild(
        createOceanControlButton({
          title: "Fit map to all routes & engineers",
          label: "Fit to bounds",
          icon: "⤢",
          onClick: () => safeFitToBounds(map, bounds),
        })
      );
      wrap.appendChild(
        createOceanControlButton({
          title: "Recenter map to default view",
          label: "Recenter",
          icon: "⌖",
          onClick: () => safeFitToBounds(map, bounds),
        })
      );
      return wrap;
    };

    ctlGroup.addTo(map);

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
      // no-op
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
   * Inject small theme overrides for Leaflet's built-in controls.
   */
  return createPortal(
    <style>{`
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

      .mapBox .leaflet-control-fullscreen a {
        background: rgba(255,255,255,0.92);
        border: 1px solid var(--ocean-border);
        box-shadow: var(--shadow-sm);
        border-radius: 10px;
      }
      .mapBox .leaflet-control-fullscreen a:hover {
        background: rgba(30,58,138,0.06);
      }

      .card input[type="checkbox"] {
        accent-color: var(--ocean-primary);
      }
    `}</style>,
    document.head
  );
}

export default function MapPanel({ scopedState, selectedRouteId, onSelectRouteId, complianceSnapshot, focusDeviation }) {
  const [mapZoom, setMapZoom] = React.useState(12);

  // Mandatory region selection (defaults to first region in scope).
  const [selectedRegionId, setSelectedRegionId] = React.useState("");

  // Multi-route visibility set.
  const [visibleRouteIds, setVisibleRouteIds] = React.useState(() => new Set());

  // App-level route details modal (replaces Leaflet inline popup to avoid shrinking inside the map).
  const [routeDetailsModalRouteId, setRouteDetailsModalRouteId] = React.useState("");

  // Whether the route details modal is open (used to obscure the map without unmounting it).
  const isRouteDetailsModalOpen = Boolean(routeDetailsModalRouteId);

  // OSRM snap cache + inflight tracking.
  const osrmCacheRef = useRef(null);
  const osrmLimiterRef = useRef(null);
  const osrmInflightRef = useRef(new Map());
  const osrmAbortRef = useRef(new Map());
  const [snappedByKey, setSnappedByKey] = React.useState(() => ({}));
  const [snapStatusByKey, setSnapStatusByKey] = React.useState(() => ({})); // pending|ok|error
  const [anyOsrmUsed, setAnyOsrmUsed] = React.useState(false);

  if (!osrmCacheRef.current) osrmCacheRef.current = createLruCache(100);
  if (!osrmLimiterRef.current) osrmLimiterRef.current = createConcurrencyLimiter(2);

  const allRoutes = useMemo(() => scopedState?.routes || [], [scopedState]);
  const allLocations = useMemo(() => scopedState?.engineerLiveLocations || [], [scopedState]);
  const assignments = useMemo(() => scopedState?.engineerAssignments || [], [scopedState]);

  // Initialize/repair selected region when scope changes.
  React.useEffect(() => {
    if (!scopedState) return;
    if (isValidRegionId(scopedState, selectedRegionId)) return;
    const first = (scopedState.regions || [])[0]?.id || "";
    setSelectedRegionId(first);
  }, [scopedState, selectedRegionId]);

  const routesInRegion = useMemo(() => {
    if (!selectedRegionId) return [];
    return (allRoutes || []).filter((r) => r.regionId === selectedRegionId);
  }, [allRoutes, selectedRegionId]);

  // Default visible routes to "all routes in region" when region changes.
  React.useEffect(() => {
    if (!selectedRegionId) return;
    const ids = new Set((routesInRegion || []).map((r) => r.id));
    setVisibleRouteIds(ids);

    // If selectedRouteId is not in new region, clear it.
    if (selectedRouteId && !ids.has(selectedRouteId)) onSelectRouteId?.("");
    setRouteDetailsModalRouteId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRegionId]);

  const routeColorById = useMemo(() => buildRouteColorMap(routesInRegion), [routesInRegion]);

  const activeRoutes = useMemo(() => {
    const allowed = visibleRouteIds;
    return (routesInRegion || []).filter((r) => allowed.has(r.id));
  }, [routesInRegion, visibleRouteIds]);

  const activeLocations = useMemo(() => {
    // Engineers are auto-shown for the selected region.
    if (!selectedRegionId) return [];
    const regionEngineerIds = new Set(
      (scopedState?.users || []).filter((u) => u.role === "Field Engineer" && u.regionId === selectedRegionId).map((u) => u.id)
    );
    return (allLocations || []).filter((l) => regionEngineerIds.has(l.engineerId));
  }, [allLocations, scopedState?.users, selectedRegionId]);

  // Deviation highlighting: any compliance flag on route/engineer => red highlight.
  const hasDeviationByRouteId = useMemo(() => {
    const flags = complianceSnapshot?.flags || [];
    const m = {};
    flags.forEach((f) => {
      if (f?.routeId) m[f.routeId] = true;
    });
    return m;
  }, [complianceSnapshot]);

  const hasDeviationByEngineerId = useMemo(() => {
    const flags = complianceSnapshot?.flags || [];
    const m = {};
    flags.forEach((f) => {
      if (f?.engineerId) m[f.engineerId] = true;
    });
    return m;
  }, [complianceSnapshot]);

  // OSRM waypoint meta for visible routes.
  const routesWaypointMeta = useMemo(() => {
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

  // Debounced OSRM fetch scheduler.
  const scheduleOsrmFetch = useMemo(() => {
    return debounce(async (items) => {
      const cache = osrmCacheRef.current;
      const limit = osrmLimiterRef.current;

      const tasks = (items || []).map((it) =>
        limit(async () => {
          const { key, waypoints } = it;

          const cached = cache.get(key);
          if (cached?.latLngs?.length >= 2) {
            setSnappedByKey((prev) => (prev[key] ? prev : { ...prev, [key]: cached }));
            setSnapStatusByKey((prev) => (prev[key] ? prev : { ...prev, [key]: "ok" }));
            setAnyOsrmUsed(true);
            return { ok: true, cached: true };
          }

          if (osrmInflightRef.current.has(key)) return { ok: true, inflight: true };

          setSnapStatusByKey((prev) => ({ ...prev, [key]: "pending" }));
          osrmInflightRef.current.set(key, true);

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

          setSnapStatusByKey((prev) => ({ ...prev, [key]: "error" }));
          return { ok: false, error: result.error };
        })
      );

      await Promise.all(tasks);
    }, 450);
  }, []);

  // Fetch snapped geometries when waypoint hashes change.
  React.useEffect(() => {
    const list = routesWaypointMeta || [];
    if (list.length === 0) return;

    const cache = osrmCacheRef.current;
    const toFetch = [];

    list.forEach((it) => {
      const cached = cache.get(it.key);
      const alreadyInState = snappedByKey[it.key];
      if (cached?.latLngs?.length >= 2 || alreadyInState?.latLngs?.length >= 2) {
        setSnapStatusByKey((prev) => (prev[it.key] ? prev : { ...prev, [it.key]: "ok" }));
        return;
      }
      toFetch.push(it);
    });

    if (toFetch.length > 0) scheduleOsrmFetch(toFetch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesWaypointMeta, scheduleOsrmFetch]);

  // Cleanup inflight requests on unmount.
  React.useEffect(() => {
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

  // Focus deviation requested by dashboard (toasts/table).
  React.useEffect(() => {
    if (!focusDeviation) return;
    const rid = focusDeviation.routeId || "";
    if (!rid) return;

    const route = (allRoutes || []).find((r) => r.id === rid);
    if (!route) return;

    if (route.regionId && route.regionId !== selectedRegionId) {
      setSelectedRegionId(route.regionId);
    }

    setVisibleRouteIds((prev) => {
      const next = new Set(prev);
      next.add(rid);
      return next;
    });

    onSelectRouteId?.(rid);
  }, [focusDeviation, allRoutes, onSelectRouteId, selectedRegionId]);

  // Close modal if the route disappears from current region (e.g., scope/region change or refresh data changes).
  React.useEffect(() => {
    if (!routeDetailsModalRouteId) return;
    const stillExists = (routesInRegion || []).some((r) => r.id === routeDetailsModalRouteId);
    if (!stillExists) setRouteDetailsModalRouteId("");
  }, [routesInRegion, routeDetailsModalRouteId]);

  const waypointLayers = useMemo(() => {
    return (activeRoutes || [])
      .map((r) => {
        const pts = (r.polyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        return {
          routeId: r.id,
          routeName: r.name,
          color: routeColorById[r.id] || "#1E3A8A",
          points: pts.map((p, idx) => ({ id: `${r.id}_wp_${idx}`, ...p, idx })),
        };
      })
      .filter((x) => x.points.length > 0);
  }, [activeRoutes, routeColorById]);

  const latLngsForBounds = useMemo(() => {
    const pts = [];
    activeRoutes.forEach((r) => {
      toLatLngs(r.polyline).forEach((p) => pts.push(p));
    });
    (activeLocations || []).forEach((l) => {
      if (Number.isFinite(l.lat) && Number.isFinite(l.lng)) pts.push([l.lat, l.lng]);
    });
    return pts;
  }, [activeRoutes, activeLocations]);

  const hasAnyGeo = latLngsForBounds.length > 0;

  const bounds = useMemo(() => {
    if (!hasAnyGeo) return null;
    return L.latLngBounds(latLngsForBounds);
  }, [hasAnyGeo, latLngsForBounds]);

  const initialCenter = useMemo(() => {
    // Center on first visible route coordinate, else default US center-ish.
    const firstRoute = activeRoutes?.[0];
    const firstPoint = firstRoute?.polyline?.[0];
    return firstPoint && Number.isFinite(firstPoint.lat) && Number.isFinite(firstPoint.lng) ? [firstPoint.lat, firstPoint.lng] : [39.8283, -98.5795];
  }, [activeRoutes]);

  const routePopupDetails = useMemo(() => {
    if (!routeDetailsModalRouteId) return null;
    const route = (routesInRegion || []).find((r) => r.id === routeDetailsModalRouteId);
    if (!route) return null;

    const criteria = computeRouteCompletionCriteriaForRoute(route, scopedState?.tasks || []);
    const regionName = getRegionName(scopedState, route.regionId);
    const managerName = getRegionalManagerName(scopedState, route.regionId);

    const completionPercent = Number(route?.completion_percent || 0);

    const strictStatus = criteria?.isCompleted
      ? "Completed"
      : Number(criteria?.completedStops || 0) > 0 || Number(criteria?.completedTasks || 0) > 0
        ? "In progress"
        : "Not completed";

    // Engineer "reasons/comments" section already comes from task history + task exception reasons.
    const comments = selectRouteCommentsWithMetaForDate(scopedState, { routeId: route.id });

    const assignedEngineerIds = selectEngineerIdsForRoute(scopedState, route.id);
    const assignedEngineers = assignedEngineerIds
      .map((id) => ({ id, name: selectEngineerNameById(scopedState, id) }))
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));

    // Deviation aggregation for this route (from compliance snapshot flags).
    const deviationDetails = selectDeviationDetailsForRoute(scopedState, complianceSnapshot, { routeId: route.id });

    const deviationEngineerNames =
      deviationDetails?.engineerIds?.length > 0
        ? deviationDetails.engineerIds
            .map((id) => ({ id, name: selectEngineerNameById(scopedState, id) }))
            .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
        : [];

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

      deviationDetails,
      deviationEngineerNames,

      comments,
    };
  }, [routeDetailsModalRouteId, routesInRegion, scopedState, complianceSnapshot]);

  const routeLegendRows = useMemo(() => {
    return (routesInRegion || [])
      .slice()
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
      .map((r) => ({ routeId: r.id, label: r.name || r.id, color: routeColorById[r.id] || "#1E3A8A" }));
  }, [routesInRegion, routeColorById]);

  return (
    <div className="card">
      <div className="cardHeader">
        <div style={{ minWidth: 260 }}>
          <h2>Map Overview</h2>
          <p>Region → routes → engineers</p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
          <label className="input" style={{ minWidth: 220 }}>
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>Region (required)</span>
            <select
              value={selectedRegionId}
              onChange={(e) => {
                const rid = e.target.value;
                setSelectedRegionId(rid);
              }}
            >
              {(scopedState?.regions || []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.id}
                </option>
              ))}
            </select>
          </label>

          <span className="badge">Maps: Open-source</span>
        </div>
      </div>

      <div style={{ padding: "0 16px 12px 16px" }}>
        {!selectedRegionId ? (
          <div className="notice">Select a region to load routes and engineers.</div>
        ) : routesInRegion.length === 0 ? (
          <div className="notice">No routes in this region.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
              alignItems: "start",
            }}
            aria-label="Route visibility controls"
          >
            {routesInRegion
              .slice()
              .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
              .map((r) => {
                const checked = visibleRouteIds.has(r.id);
                const color = routeColorById[r.id] || "#1E3A8A";
                return (
                  <label
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 10px",
                      borderRadius: 12,
                      border: "1px solid var(--ocean-border)",
                      background: "rgba(255,255,255,0.72)",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setVisibleRouteIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);

                          if (!next.has(r.id) && selectedRouteId === r.id) onSelectRouteId?.("");
                          return next;
                        });
                      }}
                      aria-label={`Toggle visibility for ${r.name || r.id}`}
                    />
                    <span
                      aria-hidden="true"
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 99,
                        background: color,
                        boxShadow: "0 0 0 2px rgba(255,255,255,0.9) inset",
                        border: "1px solid rgba(17,24,39,0.18)",
                        flex: "0 0 auto",
                      }}
                    />
                    <span style={{ fontWeight: 800, fontSize: 13, color: "var(--ocean-text)" }}>{r.name || r.id}</span>
                  </label>
                );
              })}
          </div>
        )}
      </div>

      <div className="mapBox">
        {/* 
          Obscure the map whenever the route details modal is open.
          IMPORTANT: we keep the Leaflet map mounted to preserve map state (bounds, layers) and OSRM caches.
        */}
        {isRouteDetailsModalOpen ? (
          <div className="mapObscureOverlay" aria-hidden="true">
            <div className="mapObscureOverlayInner">
              <div style={{ fontWeight: 900, color: "var(--ocean-text)" }}>Route details open</div>
              <div className="mini" style={{ marginTop: 4 }}>
                The map is temporarily hidden behind the modal.
              </div>
            </div>
          </div>
        ) : null}

        {!hasAnyGeo ? (
          <div className="mapEmpty" aria-live="polite">
            <div className="mapFallbackInner">
              <h3>No map data to display</h3>
              <p>Pick a region to load routes and engineers for that area (region selection is required).</p>
              <div className="notice">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Current selection</div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div>
                    <strong>Region:</strong> {getRegionName(scopedState, selectedRegionId) || "—"}
                  </div>
                  <div>
                    <strong>Visible routes:</strong> {activeRoutes.length}
                  </div>
                  <div>
                    <strong>Visible engineers:</strong> {activeLocations.length}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <MapContainer center={initialCenter} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }} preferCanvas zoomControl>
              <LeafletControlTheming />
              <LeafletInteractionToggle disabled={isRouteDetailsModalOpen} />

              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <InvalidateSizeOnMountAndResize triggerKey={bounds ? bounds.toBBoxString?.() || "bounds" : "no_bounds"} />
              {bounds && <FitToVisible bounds={bounds} />}
              <TrackZoom onZoom={setMapZoom} />
              {bounds && <MapControls bounds={bounds} />}

              {activeRoutes.map((r) => {
                const isSelected = selectedRouteId ? r.id === selectedRouteId : false;
                const color = routeColorById[r.id] || "#1E3A8A";

                const waypointMeta = routesWaypointMetaByRouteId.get(r.id);
                const snapKey = waypointMeta?.key || "";
                const snapStatus = snapKey ? snapStatusByKey?.[snapKey] : "";
                const snapped = snapKey ? snappedByKey?.[snapKey] || osrmCacheRef.current.get(snapKey) : null;

                const rawPlannedPositions = toLatLngs(r.polyline);

                // Planned route should follow roads too: use OSRM-snapped geometry when available.
                // Graceful fallback: if OSRM fails/unavailable, render raw waypoint-to-waypoint polyline.
                const plannedPositions = snapped?.latLngs?.length >= 2 ? snapped.latLngs : rawPlannedPositions;

                // Actual path uses the same best-effort OSRM geometry (kept as separate variable for styling semantics).
                const actualPositions = snapped?.latLngs?.length >= 2 ? snapped.latLngs : [];

                if (plannedPositions.length < 2) return null;

                const haloStyle = routeHaloStyle({ zoom: mapZoom });
                const plannedStyle = plannedRouteStyle({ zoom: mapZoom, color });
                const actualStyle = actualPathStyle({ zoom: mapZoom, color });
                const deviationStyle = deviationHighlightStyle({ zoom: mapZoom });
                const sel = selectionHighlightStyle({ zoom: mapZoom });

                const showDeviation = Boolean(hasDeviationByRouteId?.[r.id]);

                return (
                  <React.Fragment key={`route_stack_${r.id}`}>
                    <Polyline positions={plannedPositions} pathOptions={haloStyle} interactive={false} />

                    <Polyline
                      positions={plannedPositions}
                      pathOptions={plannedStyle}
                      eventHandlers={{
                        click: () => {
                          // Preserve existing selection behavior (filters other panels, highlights route).
                          onSelectRouteId?.(r.id);

                          // Replace Leaflet inline popup (shrinks in map) with app-level modal.
                          setRouteDetailsModalRouteId(r.id);
                        },
                      }}
                    >
                      <Tooltip sticky direction="top" opacity={0.95}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 99,
                              background: color,
                              border: "1px solid rgba(17,24,39,0.25)",
                            }}
                          />
                          <div style={{ fontWeight: 900 }}>{r.name}</div>
                        </div>

                        <div className="mini">
                          Planned: <strong>dashed</strong> · Actual: <strong>solid</strong>
                        </div>

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

                        {showDeviation ? (
                          <div className="mini">
                            Deviation: <strong style={{ color: DEVIATION_RED }}>highlighted</strong>
                          </div>
                        ) : (
                          <div className="mini">Deviation: none</div>
                        )}

                        <div className="mini">Click to select</div>
                      </Tooltip>
                    </Polyline>

                    {actualPositions.length >= 2 ? <Polyline positions={actualPositions} pathOptions={actualStyle} interactive={false} /> : null}

                    {showDeviation ? (
                      <>
                        <Polyline positions={plannedPositions} pathOptions={deviationStyle} interactive={false} />
                        {actualPositions.length >= 2 ? (
                          <Polyline positions={actualPositions} pathOptions={deviationStyle} interactive={false} />
                        ) : null}
                      </>
                    ) : null}

                    {isSelected ? (
                      <>
                        <Polyline positions={plannedPositions} pathOptions={sel.halo} interactive={false} />
                        <Polyline positions={plannedPositions} pathOptions={sel.stroke} interactive={false} />
                      </>
                    ) : null}
                  </React.Fragment>
                );
              })}

              {(activeLocations || []).map((loc) => {
                const engineerId = loc.engineerId;
                if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;

                const routeId = (assignments || []).find((a) => a.engineerId === engineerId)?.routeId || "";
                const routeColor = routeId ? routeColorById[routeId] || "#1E3A8A" : "#334155";

                const routeVisible = routeId ? visibleRouteIds.has(routeId) : true;
                const opacity = routeVisible ? 0.95 : 0.35;

                const hasDeviation = Boolean(hasDeviationByEngineerId?.[engineerId]);
                const ringColor = hasDeviation ? DEVIATION_RED : "rgba(255,255,255,0.9)";

                return (
                  <CircleMarker
                    key={`eng_${engineerId}`}
                    center={[loc.lat, loc.lng]}
                    radius={7}
                    pathOptions={{
                      color: ringColor,
                      weight: hasDeviation ? 3 : 2,
                      fillColor: routeColor,
                      fillOpacity: opacity,
                      opacity,
                    }}
                  >
                    <Tooltip direction="top" opacity={0.95}>
                      <div style={{ fontWeight: 900 }}>{getEngineerName(scopedState, engineerId)}</div>
                      <div className="mini">
                        Engineer ID: <strong>{engineerId}</strong>
                      </div>
                      <div className="mini">
                        Route:{" "}
                        <strong>{(scopedState?.routes || []).find((r) => r.id === routeId)?.name || routeId || "Unassigned"}</strong>
                      </div>
                      {hasDeviation ? (
                        <div className="mini">
                          Deviation: <strong style={{ color: DEVIATION_RED }}>flagged</strong>
                        </div>
                      ) : null}
                    </Tooltip>
                  </CircleMarker>
                );
              })}

              {/* Leaflet inline popup intentionally removed; replaced by app-level modal to avoid map shrinking. */}

              {waypointLayers.map((layer) => {
                const isSelected = selectedRouteId ? layer.routeId === selectedRouteId : false;
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
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          aria-hidden="true"
                          style={{ width: 10, height: 10, borderRadius: 99, background: layer.color, border: "1px solid rgba(17,24,39,0.18)" }}
                        />
                        <div style={{ fontWeight: 900 }}>{layer.routeName}</div>
                      </div>
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
              aria-label="Map legend"
              style={{
                position: "absolute",
                left: 12,
                bottom: 12,
                background: "rgba(255,255,255,0.92)",
                border: "1px solid var(--ocean-border)",
                borderRadius: 12,
                padding: "10px 12px",
                boxShadow: "var(--shadow-sm)",
                maxWidth: 360,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 12 }}>Legend</div>

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
                <div className="mini" style={{ fontWeight: 900, color: "var(--ocean-muted)", marginTop: 2 }}>
                  Styles
                </div>

                <div className="mini">
                  Planned route: <strong>dashed</strong>
                </div>
                <div className="mini">
                  Actual path: <strong>solid</strong>
                </div>
                <div className="mini">
                  Deviation: <strong style={{ color: DEVIATION_RED }}>red highlight</strong>
                </div>

                <hr className="hr" style={{ margin: "6px 0" }} />

                <div className="mini" style={{ fontWeight: 900, color: "var(--ocean-muted)" }}>
                  Routes (colors)
                </div>

                {routeLegendRows.slice(0, 8).map((l) => (
                  <div key={l.routeId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 99,
                        background: l.color,
                        display: "inline-block",
                        border: "1px solid rgba(17,24,39,0.18)",
                      }}
                    />
                    <span className="mini">{l.label}</span>
                  </div>
                ))}
                {routeLegendRows.length > 8 ? (
                  <div className="mini" style={{ color: "var(--ocean-muted)" }}>
                    +{routeLegendRows.length - 8} more
                  </div>
                ) : null}

                <div className="mini" style={{ marginTop: 6 }}>
                  Engineers are shown as <strong>markers</strong> inheriting route color.
                </div>

                {anyOsrmUsed ? (
                  <div className="mini" style={{ marginTop: 6 }}>
                    <strong>Actual paths snapped to OSRM</strong>
                  </div>
                ) : null}

                {selectedRouteId ? (
                  <div className="mini" style={{ marginTop: 6 }}>
                    Selected route is highlighted in <strong>navy</strong>.
                  </div>
                ) : null}
              </div>
            </div>

            <Modal
              open={Boolean(routeDetailsModalRouteId && routePopupDetails)}
              title={`Route Details — ${routePopupDetails?.routeName || ""}`}
              description="Expanded route completion, deviation, and engineer notes (updates on refresh)."
              onClose={() => setRouteDetailsModalRouteId("")}
              maxWidth={1080}
              footer={
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn btnGhost" onClick={() => setRouteDetailsModalRouteId("")}>
                    Close
                  </button>
                </div>
              }
            >
              {routePopupDetails ? (
                <div aria-label="Route details content">
                  {/* Accessibility: provide ids for aria-labelledby/aria-describedby via in-body headings. */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 260 }}>
                      <div id="routeDetailsTitle" style={{ fontWeight: 900, fontSize: 14, color: "var(--ocean-text)" }}>
                        {routePopupDetails.routeName}
                      </div>
                      <div id="routeDetailsDesc" className="mini" style={{ marginTop: 4, color: "var(--ocean-muted)" }}>
                        Route ID: <strong>{routePopupDetails.routeId}</strong>
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

                  <hr className="hr" />

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                      gap: 12,
                      alignItems: "start",
                    }}
                  >
                    {/* Left: Completion + assignment */}
                    <section
                      aria-label="Route completion summary"
                      style={{
                        padding: "10px 12px",
                        border: "1px solid var(--ocean-border)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.72)",
                      }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 12, color: "var(--ocean-text)" }}>Completion</div>
                      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
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

                        <hr className="hr" style={{ margin: "6px 0" }} />

                        <div className="mini">
                          Waypoints covered:{" "}
                          <strong>
                            {routePopupDetails.waypointsCovered}/{routePopupDetails.totalWaypoints}
                          </strong>
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
                      </div>
                    </section>

                    {/* Right: Deviation details */}
                    <section
                      aria-label="Deviation details"
                      style={{
                        padding: "10px 12px",
                        border: "1px solid var(--ocean-border)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.72)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 12, color: "var(--ocean-text)" }}>Deviation details</div>
                        <span
                          className={
                            routePopupDetails.deviationDetails?.totalFlags
                              ? String(routePopupDetails.deviationDetails.worstSeverity).toLowerCase() === "high"
                                ? "badge badgeError"
                                : String(routePopupDetails.deviationDetails.worstSeverity).toLowerCase() === "medium"
                                  ? "badge badgeWarn"
                                  : "badge"
                              : "badge"
                          }
                          style={{ whiteSpace: "nowrap" }}
                          aria-label={
                            routePopupDetails.deviationDetails?.totalFlags
                              ? `Worst deviation severity: ${routePopupDetails.deviationDetails.worstSeverity || "unknown"}`
                              : "No deviations detected"
                          }
                        >
                          {routePopupDetails.deviationDetails?.totalFlags
                            ? (routePopupDetails.deviationDetails.worstSeverity || "—").toUpperCase()
                            : "NONE"}
                        </span>
                      </div>

                      {routePopupDetails.deviationDetails?.totalFlags ? (
                        <>
                          <div className="mini" style={{ marginTop: 10 }}>
                            Total deviation flags: <strong>{routePopupDetails.deviationDetails.totalFlags}</strong>
                          </div>

                          {Array.isArray(routePopupDetails.deviationEngineerNames) && routePopupDetails.deviationEngineerNames.length > 0 ? (
                            <div className="mini" style={{ marginTop: 6 }}>
                              Affected engineer(s):{" "}
                              <strong>{routePopupDetails.deviationEngineerNames.map((e) => e.name || e.id).join(", ")}</strong>
                            </div>
                          ) : null}

                          {Array.isArray(routePopupDetails.deviationDetails.byRule) && routePopupDetails.deviationDetails.byRule.length > 0 ? (
                            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                              {routePopupDetails.deviationDetails.byRule.map((r) => (
                                <div
                                  key={r.rule}
                                  style={{
                                    padding: "8px 10px",
                                    border: "1px solid var(--ocean-border)",
                                    borderRadius: 12,
                                    background: "rgba(255,255,255,0.70)",
                                  }}
                                >
                                  <div className="mini" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                    <span style={{ fontWeight: 900, color: "var(--ocean-text)" }}>{r.ruleLabel}</span>
                                    <span style={{ whiteSpace: "nowrap", color: "var(--ocean-muted)" }}>
                                      {r.count} · {(r.worstSeverity || "—").toUpperCase()}
                                    </span>
                                  </div>
                                  {r.sampleMessage ? (
                                    <div className="mini" style={{ marginTop: 6, lineHeight: 1.25, color: "var(--ocean-muted)" }}>
                                      {r.sampleMessage}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {Array.isArray(routePopupDetails.deviationDetails.timeHints) && routePopupDetails.deviationDetails.timeHints.length > 0 ? (
                            <div style={{ marginTop: 12 }}>
                              <div className="mini" style={{ fontWeight: 900, color: "var(--ocean-muted)" }}>
                                Timing hints
                              </div>
                              <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                                {routePopupDetails.deviationDetails.timeHints.map((h, idx) => (
                                  <div key={`${h.label}_${idx}`} className="mini">
                                    {h.label}: <strong>{h.value}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="mini" style={{ marginTop: 10 }}>
                          Deviation details: <strong>None detected</strong>
                        </div>
                      )}
                    </section>
                  </div>

                  {/* Comments */}
                  {Array.isArray(routePopupDetails.comments) && routePopupDetails.comments.length > 0 ? (
                    <>
                      <hr className="hr" />
                      <div style={{ fontWeight: 900, fontSize: 12, color: "var(--ocean-text)" }}>Engineer comments / reasons</div>
                      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                        {routePopupDetails.comments.map((c) => (
                          <div
                            key={c.id}
                            style={{
                              padding: "10px 12px",
                              border: "1px solid var(--ocean-border)",
                              borderRadius: 12,
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
                                flexWrap: "wrap",
                              }}
                            >
                              <span style={{ fontWeight: 900, color: "var(--ocean-text)" }}>{c.engineerName || "Engineer"}</span>
                              <span style={{ whiteSpace: "nowrap" }}>{c.timestampLabel || "—"}</span>
                            </div>

                            <div className="mini" style={{ marginTop: 6, lineHeight: 1.35 }}>
                              <strong style={{ textTransform: "capitalize" }}>{String(c.type || "").replaceAll("_", " ").trim()}:</strong>{" "}
                              {c.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </Modal>
          </>
        )}
      </div>

      <hr className="hr" />

      <div className="splitRow">
        <div className="mini">
          Region: <strong>{getRegionName(scopedState, selectedRegionId) || "—"}</strong> · Click a route to filter list views. Selected route:{" "}
          <strong>{selectedRouteId || "None"}</strong>
        </div>
        <button
          className="btn btnGhost"
          onClick={() => {
            onSelectRouteId?.("");
            setRouteDetailsModalRouteId("");
          }}
          disabled={!selectedRouteId}
        >
          Clear route filter
        </button>
      </div>

      {selectedRegionId ? (
        <div className="mini" style={{ marginTop: 10 }}>
          Showing <strong>{activeRoutes.length}</strong> route(s) and <strong>{activeLocations.length}</strong> engineer(s) for this region. Use the checkboxes to show multiple routes together.
        </div>
      ) : null}
    </div>
  );
}
