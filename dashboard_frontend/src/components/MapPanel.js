import React, { useMemo, useRef } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { createPortal } from "react-dom";
import * as turf from "@turf/turf";
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
 * UX requirements implemented (current spec):
 * - Mandatory region selector; checkbox-based multi-route visibility.
 * - Map layers per spec:
 *    1) Planned route: blue dashed polyline (one per visible route).
 *    2) Actual (live GPS trail): engineer-specific polyline of the *true GPS path taken*.
 *       - Rendered as contiguous segments: on-route uses the configured actual color; off-route segments are red.
 *    3) Deviation indicators:
 *        - optional corridor visualization along planned route (thick translucent stroke)
 *        - off-route segments are highlighted in red as part of the actual trail
 *        - engineer marker tooltip shows deviation meters and “since” timestamp.
 * - Engineer “moving marker” is the last live point (from dummy live locations / simulated trail).
 *
 * Compatibility constraints (must preserve prior behavior):
 * - Keep region selection and multi-route visibility behavior.
 * - Keep route click behavior (select route + open modal).
 * - Keep existing completion/status logic (used in modal and elsewhere).
 *
 * Notes:
 * - Dummy data is authoritative; "live" trail is derived deterministically in-memory.
 * - OSRM snapping remains best-effort for planned geometry (kept from previous implementation).
 * - Deviation detection is performed on the frontend using Turf.js:
 *     distance(point, nearestPointOnLine(routeLine, point)) > thresholdMeters
 *   plus a corridor (buffer polygon) option for visual clarity.
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

/**
 * UX Layer styles (per attached spec):
 * - Planned route: blue dashed
 * - Live GPS trail: green (on-route) or red (deviated)
 * - Deviation segments: red emphasis
 * - Corridor (buffer): translucent red fill when enabled
 */
const PLANNED_BLUE = "#2563EB"; // blue-600
const LIVE_GREEN = "#059669"; // green-600
const DEVIATION_RED = "#DC2626"; // red-600

const WAYPOINT_REMAINING = "#F59E0B"; // amber-500
const WAYPOINT_COVERED = "#059669"; // green-600
const WAYPOINT_DESTINATION = "#1E3A8A"; // primary navy

function makePinSvg({ fill, stroke = "rgba(17,24,39,0.35)", glyph = "", glyphColor = "#ffffff" }) {
  // Simple map-pin path; rendered via inline SVG to avoid adding new assets.
  const label = String(glyph || "");
  return `
  <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="marker">
    <path d="M15 39 C15 39 27 25 27 15 C27 7.268 21.732 2 15 2 C8.268 2 3 7.268 3 15 C3 25 15 39 15 39 Z"
      fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    <circle cx="15" cy="15" r="6.6" fill="rgba(255,255,255,0.92)"/>
    <text x="15" y="18.5" text-anchor="middle" font-size="9.5" font-weight="800" fill="${glyphColor}"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.12); stroke-width: 1px;">
      ${label}
    </text>
  </svg>`;
}

function makeGoogleMapsStyleDestinationSvg() {
  /**
   * A Google Maps–style destination pin:
   * - red outer pin
   * - white inner circle
   * - small red dot in the center
   *
   * Implemented as inline SVG so we don't introduce new dependencies or alter layer behavior.
   */
  return `
  <svg width="34" height="50" viewBox="0 0 34 50" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="destination marker">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="rgba(17,24,39,0.30)" />
      </filter>
    </defs>

    <g filter="url(#shadow)">
      <!-- Pin body -->
      <path d="M17 49 C17 49 31 32.5 31 19.5 C31 8.9 24.1 2 17 2 C9.9 2 3 8.9 3 19.5 C3 32.5 17 49 17 49 Z"
        fill="#EA4335" stroke="rgba(17,24,39,0.18)" stroke-width="1.2"/>
      <!-- Inner white circle -->
      <circle cx="17" cy="19.5" r="8.8" fill="#FFFFFF"/>
      <!-- Center dot -->
      <circle cx="17" cy="19.5" r="3.2" fill="#EA4335"/>
    </g>
  </svg>`;
}

function makeGoogleMapsStyleStartSvg() {
  /**
   * Start marker: same destination-like pin silhouette, but green.
   * We keep the same size and anchor as destination so the tip aligns correctly.
   */
  return `
  <svg width="34" height="50" viewBox="0 0 34 50" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="start marker">
    <defs>
      <filter id="shadowStart" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="rgba(17,24,39,0.30)" />
      </filter>
    </defs>

    <g filter="url(#shadowStart)">
      <!-- Pin body -->
      <path d="M17 49 C17 49 31 32.5 31 19.5 C31 8.9 24.1 2 17 2 C9.9 2 3 8.9 3 19.5 C3 32.5 17 49 17 49 Z"
        fill="#059669" stroke="rgba(17,24,39,0.18)" stroke-width="1.2"/>
      <!-- Inner white circle -->
      <circle cx="17" cy="19.5" r="8.8" fill="#FFFFFF"/>
      <!-- Center dot -->
      <circle cx="17" cy="19.5" r="3.2" fill="#059669"/>
    </g>
  </svg>`;
}

function makeDotSvg({ fill, stroke = "rgba(17,24,39,0.30)" }) {
  return `
  <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="waypoint">
    <circle cx="7" cy="7" r="5.2" fill="${fill}" stroke="${stroke}" stroke-width="1.4" />
  </svg>`;
}

function makeEngineerPinSvg({ fill = "#0F766E" } = {}) {
  /**
   * Rounded pin for engineer marker (default variant).
   * Sized ~30x40 with a clear tip; anchored at bottom center.
   */
  return makePinSvg({
    fill,
    stroke: "rgba(17,24,39,0.28)",
    glyph: "E",
    glyphColor: "#0F766E",
  });
}

function makeEngineerAvatarSvg({ fill = "#0F766E" } = {}) {
  /**
   * Circle avatar variant for engineer marker.
   * Useful when a non-pin marker is desired (e.g., clustered/overview modes).
   */
  return `
  <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="engineer">
    <defs>
      <filter id="avatarShadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.4" flood-color="rgba(17,24,39,0.25)" />
      </filter>
    </defs>
    <g filter="url(#avatarShadow)">
      <circle cx="16" cy="16" r="14" fill="${fill}" stroke="rgba(17,24,39,0.28)" stroke-width="1.4"/>
      <circle cx="16" cy="13" r="5.0" fill="rgba(255,255,255,0.92)"/>
      <path d="M8.6 26.2c1.6-4.2 6.0-6.4 7.4-6.4s5.8 2.2 7.4 6.4"
        fill="rgba(255,255,255,0.92)"/>
    </g>
  </svg>`;
}

/**
 * Built-in engineer marker icon (no external assets).
 * Two variants are supported:
 * - "pin" (default): rounded pin with a tip aligned to the GPS point.
 * - "avatar": circle avatar anchored at its center.
 */
function makeEngineerIcon({ variant = "pin", fill = "#0F766E" } = {}) {
  const v = String(variant || "pin").toLowerCase();
  if (v === "avatar") {
    // Circle marker: anchor at center.
    return L.divIcon({
      className: "oceanMarker oceanMarkerEngineer oceanMarkerEngineer_avatar",
      html: makeEngineerAvatarSvg({ fill }),
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      tooltipAnchor: [0, -18],
    });
  }

  // Default: rounded pin. Use ~30x40 and anchor at tip.
  return L.divIcon({
    className: "oceanMarker oceanMarkerEngineer oceanMarkerEngineer_pin",
    html: makeEngineerPinSvg({ fill }),
    iconSize: [30, 40],
    iconAnchor: [15, 39],
    tooltipAnchor: [0, -34],
  });
}

// Default engineer icon (requested default: rounded pin).
const engineerDefaultIcon = makeEngineerIcon({ variant: "pin", fill: "#0F766E" });
/**
 * Alternate variant (circle avatar) used for engineer markers.
 * Per requirement: set engineer circle avatar fill to blue while keeping sizing/anchor/tooltip offsets intact.
 */
const engineerAvatarIcon = makeEngineerIcon({ variant: "avatar", fill: "#2563EB" });

const destinationDivIcon = L.divIcon({
  className: "oceanMarker oceanMarkerDestination",
  html: makeGoogleMapsStyleDestinationSvg(),
  iconSize: [34, 50],
  iconAnchor: [17, 49],
  tooltipAnchor: [0, -34],
});

const startDivIcon = L.divIcon({
  className: "oceanMarker oceanMarkerStart",
  html: makeGoogleMapsStyleStartSvg(),
  iconSize: [34, 50],
  iconAnchor: [17, 49], // tip aligns to start coordinate
  tooltipAnchor: [0, -34],
});

function makeWaypointIcon({ status }) {
  const fill = status === "covered" ? WAYPOINT_COVERED : WAYPOINT_REMAINING;
  return L.divIcon({
    className: `oceanMarker oceanMarkerWaypoint oceanMarkerWaypoint_${status}`,
    html: makeDotSvg({ fill }),
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    tooltipAnchor: [0, -10],
  });
}

function clampWaypointCountForMarkers(polyline = [], max = 60) {
  const pts = Array.isArray(polyline) ? polyline : [];
  if (pts.length <= max) return pts;

  // Keep first + last, then sample evenly. This prevents hundreds of markers from bogging the map.
  const out = [];
  const keep = Math.max(2, Number(max) || 60);
  const stride = Math.ceil(pts.length / keep);
  for (let i = 0; i < pts.length; i += stride) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function computeWaypointCoverageStatus({ route, scopedState }) {
  /**
   * Covered/remaining is derived from existing route completion criteria:
   * - plannedStops = total waypoints/stops
   * - completedStops = covered waypoints/stops
   *
   * We don't invent new completion logic; we just map it onto the waypoints along the route polyline.
   */
  const criteria = computeRouteCompletionCriteriaForRoute(route, scopedState?.tasks || []);
  const plannedStops = Math.max(0, Number(criteria?.plannedStops ?? 0));
  const completedStops = Math.max(0, Math.min(Number(criteria?.completedStops ?? 0), plannedStops));
  return { plannedStops, completedStops };
}

function plannedRouteStyle({ zoom }) {
  const base = strokeWeightForZoom(zoom, { min: 5, max: 9 });
  return { color: PLANNED_BLUE, weight: base, opacity: 0.95, dashArray: "8 10", lineCap: "round", lineJoin: "round" };
}

function livePathStyle({ zoom, isDeviated }) {
  const base = strokeWeightForZoom(zoom, { min: 4, max: 8 });
  return {
    color: isDeviated ? DEVIATION_RED : LIVE_GREEN,
    weight: Math.max(3, base - 1),
    opacity: 0.98,
    lineCap: "round",
    lineJoin: "round",
  };
}

/**
 * Segment a trail into contiguous polylines classified as on-route vs off-route.
 * We keep the trail continuous, but render each segment with its own stroke color.
 */
// PUBLIC_INTERFACE
function segmentTrailByDeviation({ trailLatLngs, routeLine, thresholdMeters }) {
  /**
   * Returns: Array<{ positions: [lat,lng][], isDeviated: boolean }>
   *
   * Algorithm:
   * - classify each point as deviated or not (distance-to-route > threshold)
   * - build segments; when classification changes, start a new segment
   * - to avoid visible gaps, we include the transition point in both segments
   */
  if (!Array.isArray(trailLatLngs) || trailLatLngs.length < 2 || !routeLine) return [];

  const flags = trailLatLngs.map((p) => {
    const lat = p?.[0];
    const lng = p?.[1];
    const { isDeviated } = computeDeviationForPoint({ routeLine, lat, lng, thresholdMeters });
    return Boolean(isDeviated);
  });

  const segments = [];
  let current = [trailLatLngs[0]];
  let currentFlag = flags[0];

  for (let i = 1; i < trailLatLngs.length; i += 1) {
    const pt = trailLatLngs[i];
    const flag = flags[i];

    if (flag === currentFlag) {
      current.push(pt);
      continue;
    }

    // Close out the previous segment; include transition point to keep line continuous.
    current.push(pt);
    if (current.length >= 2) segments.push({ positions: current, isDeviated: currentFlag });

    // Start new segment; include transition point as first point.
    current = [pt];
    currentFlag = flag;
  }

  if (current.length >= 2) segments.push({ positions: current, isDeviated: currentFlag });

  return segments;
}

function deviationSegmentStyle({ zoom }) {
  const base = strokeWeightForZoom(zoom, { min: 5, max: 10 });
  return { color: DEVIATION_RED, weight: base, opacity: 0.98, lineCap: "round", lineJoin: "round" };
}

function corridorStyle() {
  // Polyline “fill look” via thick translucent stroke (keeps Leaflet polyline-only rendering).
  // If you want a true polygon fill, we'd introduce react-leaflet <GeoJSON>, but kept minimal here.
  return { color: DEVIATION_RED, weight: 18, opacity: 0.08, dashArray: null, lineCap: "round", lineJoin: "round" };
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
 * --- Deviation (Turf.js) helpers ---
 */

function toTurfLineStringFromLatLngs(latLngs) {
  // turf expects [lng, lat]
  const coords = (latLngs || [])
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[1], p[0]]);
  if (coords.length < 2) return null;
  try {
    return turf.lineString(coords);
  } catch {
    return null;
  }
}

function toTurfPointFromLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    return turf.point([lng, lat]);
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
function computeDeviationForPoint({ routeLine, lat, lng, thresholdMeters }) {
  /** Compute deviation meters and boolean on/off-route using Turf.js nearestPointOnLine. */
  const pt = toTurfPointFromLatLng(lat, lng);
  if (!pt || !routeLine) return { ok: false, deviationMeters: null, isDeviated: false };

  try {
    const snapped = turf.nearestPointOnLine(routeLine, pt);
    // turf.distance docs: units supports "kilometers", "miles", etc. Meters is supported in turf v7.
    const meters = turf.distance(pt, snapped, { units: "meters" });
    const deviationMeters = Number.isFinite(meters) ? meters : null;
    const isDeviated = Number.isFinite(deviationMeters) ? deviationMeters > (Number(thresholdMeters) || 50) : false;
    return { ok: true, deviationMeters, isDeviated };
  } catch {
    return { ok: false, deviationMeters: null, isDeviated: false };
  }
}

// PUBLIC_INTERFACE
function computeDeviationSegmentsFromTrail({ trailLatLngs, routeLine, thresholdMeters }) {
  /**
   * Convert a trail into contiguous “deviated segments” for visualization.
   * Algorithm:
   * - classify each trail point as deviated / not
   * - create polyline segments for runs of deviated points
   */
  if (!Array.isArray(trailLatLngs) || trailLatLngs.length < 2 || !routeLine) return [];

  const flags = trailLatLngs.map((p) => {
    const lat = p?.[0];
    const lng = p?.[1];
    const { isDeviated } = computeDeviationForPoint({ routeLine, lat, lng, thresholdMeters });
    return Boolean(isDeviated);
  });

  const segments = [];
  let current = [];

  for (let i = 0; i < trailLatLngs.length; i += 1) {
    const isDev = flags[i];
    const pt = trailLatLngs[i];

    if (isDev) {
      current.push(pt);
    } else if (current.length > 0) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

function buildSyntheticTrailForEngineer({ engineerId, currentLatLng, routeLatLngs }) {
  /**
   * Build a deterministic “live GPS trail” from dummy data without needing backend feeds.
   * - If we have a route polyline, create a short trail around the route.
   * - Add a deterministic “deviation wiggle” for some engineers (stable by engineerId hash).
   *
   * This keeps the UI fully functional with existing dummy data while matching UX spec.
   */
  const base = [];
  const seed = String(engineerId || "").split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  const hasRoute = Array.isArray(routeLatLngs) && routeLatLngs.length >= 2;
  const onRouteTrailPoints = hasRoute ? routeLatLngs.slice(0, Math.min(routeLatLngs.length, 6)) : [];

  // Basic trail: a handful of points on/near the planned route plus current location.
  onRouteTrailPoints.forEach((p) => base.push(p));

  if (Array.isArray(currentLatLng) && currentLatLng.length === 2) base.push(currentLatLng);

  // Ensure at least 2 points; otherwise just synthesize around current location.
  if (base.length < 2 && Array.isArray(currentLatLng) && currentLatLng.length === 2) {
    const [lat, lng] = currentLatLng;
    base.push([lat + 0.0008, lng + 0.0008], [lat, lng]);
  }

  // Create a deterministic “deviation” for ~half of engineers.
  const shouldDeviate = seed % 2 === 0;

  if (!shouldDeviate) return base;

  // Apply a lateral offset to the last few points to simulate off-route movement.
  const offsetMetersApproxLat = 0.0012; // ~133m (rough)
  const offsetMetersApproxLng = 0.0012;

  return base.map((p, idx) => {
    if (idx < Math.max(0, base.length - 3)) return p;
    return [p[0] + offsetMetersApproxLat, p[1] + offsetMetersApproxLng];
  });
}

function formatTimeSince(tsMillis) {
  if (!Number.isFinite(tsMillis)) return "—";
  const delta = Date.now() - tsMillis;
  if (!Number.isFinite(delta) || delta < 0) return "—";
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
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

  // Layer toggles (per spec guidance; default to showing everything).
  const [showPlannedRoutes, setShowPlannedRoutes] = React.useState(true);
  const [showLiveTrails, setShowLiveTrails] = React.useState(true);
  const [showDeviations, setShowDeviations] = React.useState(true);
  const [showDeviationCorridor, setShowDeviationCorridor] = React.useState(true);

  // Deviation settings (TrackoBit-like): default 50m, but each route may override via `allowedDeviationMeters`.
  const DEFAULT_ALLOWED_DEVIATION_METERS = 50;

  // OSRM snap cache + inflight tracking.
  const osrmCacheRef = useRef(null);
  const osrmLimiterRef = useRef(null);
  const osrmInflightRef = useRef(new Map());
  const osrmAbortRef = useRef(new Map());
  const [snappedByKey, setSnappedByKey] = React.useState(() => ({}));
  const [snapStatusByKey, setSnapStatusByKey] = React.useState(() => ({})); // pending|ok|error
  const [anyOsrmUsed, setAnyOsrmUsed] = React.useState(false);

  // Track “since deviated” (so status chip can show “Since”).
  const deviationSinceByEngineerRef = useRef(new Map());

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

  /**
   * Build per-engineer live trail + deviation stats for rendering.
   * Uses:
   * - engineerLiveLocations (dummy current point)
   * - engineerAssignments → route
   * - route planned polyline (OSRM snapped if available) as reference geometry
   */
  const liveTrailsByEngineerId = useMemo(() => {
    const m = new Map();

    (activeLocations || []).forEach((loc) => {
      const engineerId = loc.engineerId;
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;

      const routeId = (assignments || []).find((a) => a.engineerId === engineerId)?.routeId || "";
      const route = (allRoutes || []).find((r) => r.id === routeId) || null;

      const waypointMeta = routeId ? routesWaypointMetaByRouteId.get(routeId) : null;
      const snapKey = waypointMeta?.key || "";
      const snapped = snapKey ? snappedByKey?.[snapKey] || osrmCacheRef.current.get(snapKey) : null;

      const plannedLatLngs = snapped?.latLngs?.length >= 2 ? snapped.latLngs : toLatLngs(route?.polyline || []);
      const plannedLine = toTurfLineStringFromLatLngs(plannedLatLngs);

      const currentLatLng = [loc.lat, loc.lng];
      const trail = buildSyntheticTrailForEngineer({ engineerId, currentLatLng, routeLatLngs: plannedLatLngs });

      const allowedDeviationMeters = Number(route?.allowedDeviationMeters ?? DEFAULT_ALLOWED_DEVIATION_METERS) || DEFAULT_ALLOWED_DEVIATION_METERS;

      // Deviation metrics for current point.
      const pointDeviation = computeDeviationForPoint({
        routeLine: plannedLine,
        lat: loc.lat,
        lng: loc.lng,
        thresholdMeters: allowedDeviationMeters,
      });

      const isDeviatedNow = Boolean(pointDeviation?.isDeviated);

      // Track “since deviated” timestamp.
      const prevSince = deviationSinceByEngineerRef.current.get(engineerId);
      if (isDeviatedNow && !prevSince) deviationSinceByEngineerRef.current.set(engineerId, Date.now());
      if (!isDeviatedNow && prevSince) deviationSinceByEngineerRef.current.delete(engineerId);

      const deviationSince = deviationSinceByEngineerRef.current.get(engineerId) || null;

      const segmentedTrail = segmentTrailByDeviation({
        trailLatLngs: trail,
        routeLine: plannedLine,
        thresholdMeters: allowedDeviationMeters,
      });

      // Corridor visualization: use thick translucent stroke along the planned route polyline
      // (we keep corridor as a polyline style to avoid introducing new GeoJSON components).
      m.set(engineerId, {
        engineerId,
        routeId,
        routeName: route?.name || routeId,
        plannedLatLngs,
        trailLatLngs: trail, // always the true GPS trail (continuous)
        segmentedTrail, // computed rendering segments (on-route vs off-route)
        plannedLine,
        allowedDeviationMeters,
        isDeviatedNow,
        deviationMeters: pointDeviation?.deviationMeters ?? null,
        deviationSince,
      });
    });

    return m;
  }, [activeLocations, assignments, allRoutes, routesWaypointMetaByRouteId, snappedByKey]);

  // Fit-to-bounds considers visible planned routes + engineer trails + deviation segments (preserves prior fit behavior).
  const latLngsForBounds = useMemo(() => {
    const pts = [];

    activeRoutes.forEach((r) => {
      const waypointMeta = routesWaypointMetaByRouteId.get(r.id);
      const snapKey = waypointMeta?.key || "";
      const snapped = snapKey ? snappedByKey?.[snapKey] || osrmCacheRef.current.get(snapKey) : null;

      const rawPlannedPositions = toLatLngs(r.polyline);
      const plannedPositions = snapped?.latLngs?.length >= 2 ? snapped.latLngs : rawPlannedPositions;

      plannedPositions.forEach((p) => pts.push(p));

      // Include start marker, waypoint markers & destination in fit-to-bounds.
      const start = rawPlannedPositions[0];
      if (Array.isArray(start) && start.length === 2) pts.push(start);

      const sampledWaypoints = clampWaypointCountForMarkers(rawPlannedPositions, 60);
      sampledWaypoints.forEach((p) => pts.push(p));
      const dest = rawPlannedPositions[rawPlannedPositions.length - 1];
      if (Array.isArray(dest) && dest.length === 2) pts.push(dest);
    });

    // Live trails + segmented trail (on/off) + live engineer marker
    (activeLocations || []).forEach((l) => {
      if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng)) return;
      pts.push([l.lat, l.lng]);

      const live = liveTrailsByEngineerId.get(l.engineerId);

      // Always include the raw GPS trail points.
      (live?.trailLatLngs || []).forEach((p) => pts.push(p));

      // Also include any segmented points (covers both on-route and off-route explicitly).
      (live?.segmentedTrail || []).forEach((seg) => (seg?.positions || []).forEach((p) => pts.push(p)));
    });

    return pts;
  }, [activeRoutes, activeLocations, routesWaypointMetaByRouteId, snappedByKey, liveTrailsByEngineerId]);

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

  // On-map status summary for the currently selected engineer (or selected route’s first engineer).
  const selectedEngineerId = useMemo(() => {
    if (!selectedRouteId) return "";
    const engineerIds = selectEngineerIdsForRoute(scopedState, selectedRouteId) || [];
    return engineerIds?.[0] || "";
  }, [scopedState, selectedRouteId]);

  const liveStatusSummary = useMemo(() => {
    const rows = [];

    // Default: show all engineers in selected region (since spec says multi- engineer view).
    (activeLocations || []).forEach((loc) => {
      const live = liveTrailsByEngineerId.get(loc.engineerId);
      if (!live) return;

      rows.push({
        engineerId: loc.engineerId,
        engineerName: getEngineerName(scopedState, loc.engineerId),
        routeId: live.routeId,
        routeName: live.routeName,
        isDeviatedNow: live.isDeviatedNow,
        deviationMeters: live.deviationMeters,
        deviationSince: live.deviationSince,
      });
    });

    // Sort: deviated first, then name.
    rows.sort((a, b) => Number(b.isDeviatedNow) - Number(a.isDeviatedNow) || String(a.engineerName).localeCompare(String(b.engineerName)));

    return rows;
  }, [activeLocations, liveTrailsByEngineerId, scopedState]);

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
          <>
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

            {/* Spec-guided layer toggles (kept light, defaults ON) */}
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div className="mini" style={{ color: "var(--ocean-muted)" }}>
                Layers:
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <label className="mini" style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
                  <input type="checkbox" checked={showPlannedRoutes} onChange={(e) => setShowPlannedRoutes(e.target.checked)} />
                  Planned routes
                </label>

                <label className="mini" style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
                  <input type="checkbox" checked={showLiveTrails} onChange={(e) => setShowLiveTrails(e.target.checked)} />
                  Live trails
                </label>

                <label className="mini" style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
                  <input type="checkbox" checked={showDeviations} onChange={(e) => setShowDeviations(e.target.checked)} />
                  Deviations
                </label>

                <label className="mini" style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={showDeviationCorridor}
                    onChange={(e) => setShowDeviationCorridor(e.target.checked)}
                    disabled={!showDeviations}
                  />
                  Corridor
                </label>
              </div>
            </div>

            <div className="mini" style={{ marginTop: 8, color: "var(--ocean-muted)" }}>
              {(() => {
                const selectedRoute = selectedRouteId ? (allRoutes || []).find((r) => r.id === selectedRouteId) : null;
                const threshold = Number(selectedRoute?.allowedDeviationMeters ?? DEFAULT_ALLOWED_DEVIATION_METERS) || DEFAULT_ALLOWED_DEVIATION_METERS;
                return (
                  <>
                    Deviation threshold: <strong>{threshold}m</strong> (distance from planned route)
                  </>
                );
              })()}
            </div>
          </>
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

              {/* Planned routes (blue dashed) + waypoint markers (covered/remaining) + destination marker */}
              {showPlannedRoutes
                ? activeRoutes.map((r) => {
                    const isSelected = selectedRouteId ? r.id === selectedRouteId : false;

                    const waypointMeta = routesWaypointMetaByRouteId.get(r.id);
                    const snapKey = waypointMeta?.key || "";
                    const snapStatus = snapKey ? snapStatusByKey?.[snapKey] : "";
                    const snapped = snapKey ? snappedByKey?.[snapKey] || osrmCacheRef.current.get(snapKey) : null;

                    const rawPlannedPositions = toLatLngs(r.polyline);

                    // Planned route should follow roads too: use OSRM-snapped geometry when available.
                    // Graceful fallback: if OSRM fails/unavailable, render raw waypoint-to-waypoint polyline.
                    const plannedPositions = snapped?.latLngs?.length >= 2 ? snapped.latLngs : rawPlannedPositions;

                    if (plannedPositions.length < 2) return null;

                    const plannedStyle = plannedRouteStyle({ zoom: mapZoom });
                    const sel = selectionHighlightStyle({ zoom: mapZoom });

                    const { plannedStops, completedStops } = computeWaypointCoverageStatus({ route: r, scopedState });

                    // Marker waypoints: show along the route's raw polyline (this is the "waypoint list" in dummy data).
                    // Sample to keep performance stable on long polylines.
                    const markerWaypoints = clampWaypointCountForMarkers(rawPlannedPositions, 60);
                    const totalMarkers = markerWaypoints.length;

                    // Map completion count to markers: if there are N markers, consider first K covered.
                    // We use plannedStops/completedStops to keep parity with existing completion logic.
                    const markerCoveredCount =
                      plannedStops > 0 && totalMarkers > 0 ? Math.round((Math.min(completedStops, plannedStops) / plannedStops) * totalMarkers) : 0;

                    const start = rawPlannedPositions[0];
                    const destination = rawPlannedPositions[rawPlannedPositions.length - 1];

                    return (
                      <React.Fragment key={`planned_${r.id}`}>
                        <Polyline
                          positions={plannedPositions}
                          pathOptions={plannedStyle}
                          eventHandlers={{
                            click: () => {
                              onSelectRouteId?.(r.id);
                              setRouteDetailsModalRouteId(r.id);
                            },
                          }}
                        >
                          <Tooltip sticky direction="top" opacity={0.95}>
                            <div style={{ fontWeight: 900 }}>{r.name}</div>
                            <div className="mini">
                              Planned route: <strong style={{ color: PLANNED_BLUE }}>blue dashed</strong>
                            </div>
                            <div className="mini">
                              Waypoints:{" "}
                              <strong>
                                {Math.min(completedStops, plannedStops)}/{plannedStops || rawPlannedPositions.length}
                              </strong>{" "}
                              covered
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
                            <div className="mini">Click for details</div>
                          </Tooltip>
                        </Polyline>

                        {/* Start pin */}
                        {Array.isArray(start) && start.length === 2 ? (
                          <Marker key={`start_${r.id}`} position={start} icon={startDivIcon} interactive>
                            <Tooltip direction="top" opacity={0.95}>
                              <div style={{ fontWeight: 900 }}>{r.name}</div>
                              <div className="mini">
                                Start: <strong style={{ color: WAYPOINT_COVERED }}>First waypoint</strong>
                              </div>
                            </Tooltip>
                          </Marker>
                        ) : null}

                        {/* Waypoint dots */}
                        {markerWaypoints.map((p, idx) => {
                          const isCovered = idx < markerCoveredCount;
                          const isDestination = idx === markerWaypoints.length - 1;

                          // Destination is rendered with its own icon below; keep dot markers for intermediate points.
                          if (isDestination) return null;

                          return (
                            <Marker
                              key={`wp_${r.id}_${idx}`}
                              position={p}
                              icon={makeWaypointIcon({ status: isCovered ? "covered" : "remaining" })}
                              interactive
                            >
                              <Tooltip direction="top" opacity={0.95}>
                                <div style={{ fontWeight: 900 }}>{r.name}</div>
                                <div className="mini">
                                  Waypoint: <strong>{idx + 1}</strong>
                                </div>
                                <div className="mini">
                                  Status:{" "}
                                  {isCovered ? (
                                    <strong style={{ color: WAYPOINT_COVERED }}>Covered</strong>
                                  ) : (
                                    <strong style={{ color: WAYPOINT_REMAINING }}>Remaining</strong>
                                  )}
                                </div>
                              </Tooltip>
                            </Marker>
                          );
                        })}

                        {/* Destination pin */}
                        {Array.isArray(destination) && destination.length === 2 ? (
                          <Marker key={`dest_${r.id}`} position={destination} icon={destinationDivIcon} interactive>
                            <Tooltip direction="top" opacity={0.95}>
                              <div style={{ fontWeight: 900 }}>{r.name}</div>
                              <div className="mini">
                                Destination: <strong style={{ color: WAYPOINT_DESTINATION }}>Final waypoint</strong>
                              </div>
                              <div className="mini">
                                Covered:{" "}
                                <strong>
                                  {Math.min(completedStops, plannedStops)}/{plannedStops || rawPlannedPositions.length}
                                </strong>
                              </div>
                            </Tooltip>
                          </Marker>
                        ) : null}

                        {isSelected ? (
                          <>
                            <Polyline positions={plannedPositions} pathOptions={sel.halo} interactive={false} />
                            <Polyline positions={plannedPositions} pathOptions={sel.stroke} interactive={false} />
                          </>
                        ) : null}
                      </React.Fragment>
                    );
                  })
                : null}

              {/* Optional deviation corridor (thick translucent stroke along planned route) */}
              {showDeviations && showDeviationCorridor
                ? activeRoutes.map((r) => {
                    const waypointMeta = routesWaypointMetaByRouteId.get(r.id);
                    const snapKey = waypointMeta?.key || "";
                    const snapped = snapKey ? snappedByKey?.[snapKey] || osrmCacheRef.current.get(snapKey) : null;

                    const rawPlannedPositions = toLatLngs(r.polyline);
                    const plannedPositions = snapped?.latLngs?.length >= 2 ? snapped.latLngs : rawPlannedPositions;
                    if (plannedPositions.length < 2) return null;

                    return <Polyline key={`corridor_${r.id}`} positions={plannedPositions} pathOptions={corridorStyle()} interactive={false} />;
                  })
                : null}

              {/* Live GPS trails (per engineer) — rendered as segmented actual path:
                  - on-route segments use the existing actual color (LIVE_GREEN)
                  - off-route segments use solid red (DEVIATION_RED)
                  NOTE: this keeps “Actual” as the true GPS trail at all times; deviation is just a styling outcome.
               */}
              {showLiveTrails
                ? (activeLocations || []).flatMap((loc) => {
                    const engineerId = loc.engineerId;
                    const live = liveTrailsByEngineerId.get(engineerId);
                    const segments = live?.segmentedTrail || [];
                    if (!segments.length) return [];

                    const routeVisible = live.routeId ? visibleRouteIds.has(live.routeId) : true;
                    const opacity = routeVisible ? 0.98 : 0.35;

                    return segments.map((seg, idx) => {
                      const isDev = Boolean(seg?.isDeviated);

                      const style = isDev
                        ? { ...deviationSegmentStyle({ zoom: mapZoom }), opacity }
                        : { ...livePathStyle({ zoom: mapZoom, isDeviated: false }), opacity };

                      return (
                        <Polyline key={`live_${engineerId}_${idx}`} positions={seg.positions} pathOptions={style} interactive={false}>
                          {/* Attach tooltip to the first segment only to avoid repetitive hover popups */}
                          {idx === 0 ? (
                            <Tooltip sticky direction="top" opacity={0.95}>
                              <div style={{ fontWeight: 900 }}>{getEngineerName(scopedState, engineerId)}</div>
                              <div className="mini">
                                Actual trail:{" "}
                                <strong style={{ color: live.isDeviatedNow ? DEVIATION_RED : LIVE_GREEN }}>{live.isDeviatedNow ? "Deviated" : "On route"}</strong>
                              </div>
                              <div className="mini">
                                Route: <strong>{live.routeName || "Unassigned"}</strong>
                              </div>
                              <div className="mini" style={{ color: "var(--ocean-muted)" }}>
                                Off-route segments are highlighted in red.
                              </div>
                            </Tooltip>
                          ) : null}
                        </Polyline>
                      );
                    });
                  })
                : null}

              {/* Engineer “moving marker” = current location; distinct icon */}
              {(activeLocations || []).map((loc) => {
                const engineerId = loc.engineerId;
                if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;

                const live = liveTrailsByEngineerId.get(engineerId);
                const routeId = (assignments || []).find((a) => a.engineerId === engineerId)?.routeId || "";
                const routeVisible = routeId ? visibleRouteIds.has(routeId) : true;
                const opacity = routeVisible ? 1.0 : 0.35;

                const isDeviatedNow = Boolean(live?.isDeviatedNow);

                // Engineer icon remains distinct; deviation is conveyed via tooltip and live trail color.
                // (We intentionally keep the icon stable to avoid jittering DOM reflows.)
                return (
                  <Marker
                    key={`eng_${engineerId}`}
                    position={[loc.lat, loc.lng]}
                    icon={engineerAvatarIcon}
                    opacity={opacity}
                    interactive
                  >
                    <Tooltip direction="top" opacity={0.95}>
                      <div style={{ fontWeight: 900 }}>{getEngineerName(scopedState, engineerId)}</div>
                      <div className="mini">
                        Marker: <strong>Engineer</strong>
                      </div>
                      <div className="mini">
                        Status:{" "}
                        {isDeviatedNow ? (
                          <strong style={{ color: DEVIATION_RED }}>Deviated</strong>
                        ) : (
                          <strong style={{ color: LIVE_GREEN }}>On route</strong>
                        )}
                      </div>
                      <div className="mini">
                        Deviation: <strong>{Number.isFinite(live?.deviationMeters) ? `${Math.round(live.deviationMeters)}m` : "—"}</strong>
                      </div>
                      <div className="mini">
                        Since: <strong>{isDeviatedNow ? formatTimeSince(live?.deviationSince) : "—"}</strong>
                      </div>
                      <div className="mini">
                        Route: <strong>{live?.routeName || "Unassigned"}</strong>
                      </div>
                    </Tooltip>
                  </Marker>
                );
              })}
            </MapContainer>

            <Modal
              open={Boolean(routeDetailsModalRouteId && routePopupDetails)}
              title={`Route Details — ${routePopupDetails?.routeName || ""}`}
              description="Expanded route completion, deviation, and engineer notes."
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
                          style={{
                            whiteSpace: "nowrap",
                            ...(routePopupDetails.deviationDetails?.totalFlags
                              ? null
                              : {
                                  background: "rgba(148,163,184,0.16)",
                                  borderColor: "rgba(148,163,184,0.28)",
                                  color: "var(--ocean-muted)",
                                  fontWeight: 900,
                                }),
                          }}
                          aria-label={
                            routePopupDetails.deviationDetails?.totalFlags
                              ? `Worst deviation severity: ${routePopupDetails.deviationDetails.worstSeverity || "unknown"}`
                              : "No deviations"
                          }
                        >
                          {routePopupDetails.deviationDetails?.totalFlags
                            ? (routePopupDetails.deviationDetails.worstSeverity || "—").toUpperCase()
                            : "No deviations"}
                        </span>
                      </div>

                      {routePopupDetails.deviationDetails?.totalFlags ? (
                        <>
                          <div className="mini" style={{ marginTop: 10 }}>
                            Total deviation flags: <strong>{routePopupDetails.deviationDetails.totalFlags}</strong>
                          </div>

                          {Array.isArray(routePopupDetails.deviationEngineerNames) && routePopupDetails.deviationEngineerNames.length > 0 ? (
                            <div className="mini" style={{ marginTop: 6 }}>
                              Affected engineer(s): <strong>{routePopupDetails.deviationEngineerNames.map((e) => e.name || e.id).join(", ")}</strong>
                            </div>
                          ) : null}

                          <div className="mini" style={{ marginTop: 12, color: "var(--ocean-muted)" }}>
                            Live deviation detection also runs on the frontend (distance-to-route) using a{" "}
                            {Number((routesInRegion || []).find((x) => x.id === routePopupDetails.routeId)?.allowedDeviationMeters ?? DEFAULT_ALLOWED_DEVIATION_METERS) ||
                              DEFAULT_ALLOWED_DEVIATION_METERS}
                            m threshold.
                          </div>
                        </>
                      ) : (
                        <div className="mini" style={{ marginTop: 10 }}>
                          Deviation details: <strong style={{ color: "var(--ocean-muted)" }}>No deviations</strong>
                        </div>
                      )}
                    </section>
                  </div>

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
                              <strong style={{ textTransform: "capitalize" }}>{String(c.type || "").replaceAll("_", " ").trim()}:</strong> {c.text}
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
          Region: <strong>{getRegionName(scopedState, selectedRegionId) || "—"}</strong> · Click a planned route to filter list views. Selected route:{" "}
          <strong>{selectedRouteId || "None"}</strong>
          {selectedEngineerId ? (
            <>
              {" "}
              · Suggested engineer: <strong>{getEngineerName(scopedState, selectedEngineerId)}</strong>
            </>
          ) : null}
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
          Showing <strong>{activeRoutes.length}</strong> route(s) and <strong>{activeLocations.length}</strong> engineer(s) for this region. Use the checkboxes to show multiple
          routes together.
        </div>
      ) : null}
    </div>
  );
}
