import { Statuses } from "../data/dummyData";
import { saveDomainState } from "./domainStore";

/**
 * Dummy-data refresh engine (client-only).
 *
 * DEMO MODE (2026-01):
 * - Deterministic, progressive updates at a fixed interval (DashboardPage interval).
 * - Engineers advance along their assigned route (0..1 progress), with a persisted GPS trail.
 * - Routes transition status deterministically:
 *    Not Started -> In Progress -> Completed
 * - Deviations remain intact but are restrained for clarity:
 *    a short, deliberate off-route segment occurs at a known tick for some routes.
 *
 * IMPORTANT:
 * - This file is the seam where real API polling can later replace the simulated mutations.
 * - Keep updates reversible on refresh: state is persisted, ticks progress monotonically.
 */

const REFRESH_META_STORAGE_KEY = "fod_dummy_refresh_meta_v2";
const ENGINEER_PROGRESS_STORAGE_KEY = "fod_engineer_route_progress_v2";
const ENGINEER_TRAILS_STORAGE_KEY = "fod_engineer_gps_trails_v1";
const ROUTE_DEMO_STORAGE_KEY = "fod_route_demo_progress_v1";

/** How many points of trail to retain per engineer (keeps map fast). */
const MAX_TRAIL_POINTS = 140;

/** If true, we append to trails on each tick so MapPanel shows a real “live GPS trail”. */
const ENABLE_TRAILS = true;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeRouteCompletion(route) {
  const planned = Number(route.planned_stops || 0);
  const completed = Number(route.completed_stops || 0);
  const completion_percent = planned <= 0 ? 0 : clampPct((completed / planned) * 100);
  return { ...route, completion_percent };
}

function safeReadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can be blocked; app should still run in-memory (demo best-effort)
  }
}

function toLatLngs(polyline = []) {
  return (polyline || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ lat: p.lat, lng: p.lng }));
}

function interpolatePoint(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Convert meters to degrees offset (approx around latitude).
 * Used to create tiny “GPS noise” and deliberate “off-route” segments.
 */
function offsetPointMeters(p, metersEast, metersNorth) {
  const lat0 = (p.lat * Math.PI) / 180;
  const metersPerDegLat = 111132.92;
  const metersPerDegLng = 111412.84 * Math.cos(lat0);

  return {
    lat: p.lat + metersNorth / metersPerDegLat,
    lng: p.lng + metersEast / metersPerDegLng,
  };
}

function normalizeRouteStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "in_progress" || v === "in progress") return "in_progress";
  if (v === "completed") return "completed";
  return "not_started";
}

function normalizeDemoMeta(route) {
  const d = route?.demo || {};
  return {
    startTick: Number.isFinite(d.startTick) ? d.startTick : 1,
    completeTick: Number.isFinite(d.completeTick) ? d.completeTick : 10,
    deviationTick: Number.isFinite(d.deviationTick) ? d.deviationTick : 6,
  };
}

function findRouteForEngineer(state, engineerId) {
  const a = (state.engineerAssignments || []).find((x) => x.engineerId === engineerId);
  if (!a) return null;
  return (state.routes || []).find((r) => r.id === a.routeId) || null;
}

function loadRefreshMeta() {
  return safeReadJson(REFRESH_META_STORAGE_KEY, { lastRefreshedAt: "", tick: 0 });
}

function saveRefreshMeta(meta) {
  safeWriteJson(REFRESH_META_STORAGE_KEY, meta);
}

// PUBLIC_INTERFACE
export function getLastRefreshMeta() {
  /** Returns persisted meta about the refresh engine (currently lastRefreshedAt + tick). */
  return loadRefreshMeta();
}

function loadEngineerProgressMap() {
  return safeReadJson(ENGINEER_PROGRESS_STORAGE_KEY, {});
}

function saveEngineerProgressMap(map) {
  safeWriteJson(ENGINEER_PROGRESS_STORAGE_KEY, map || {});
}

function loadEngineerTrails() {
  return safeReadJson(ENGINEER_TRAILS_STORAGE_KEY, {});
}

function saveEngineerTrails(trails) {
  safeWriteJson(ENGINEER_TRAILS_STORAGE_KEY, trails || {});
}

function loadRouteDemoProgress() {
  return safeReadJson(ROUTE_DEMO_STORAGE_KEY, {});
}

function saveRouteDemoProgress(progress) {
  safeWriteJson(ROUTE_DEMO_STORAGE_KEY, progress || {});
}

/**
 * Deterministic per-engineer speed bucket (no randomness):
 * ensures multiple engineers on same route don't “stack” perfectly.
 */
function speedFactorForEngineer(engineerId) {
  const s = String(engineerId || "");
  let sum = 0;
  for (let i = 0; i < s.length; i += 1) sum += s.charCodeAt(i);
  const bucket = sum % 3; // 0,1,2
  // ~4.5%, 5.5%, 6.5% per tick
  return bucket === 0 ? 0.045 : bucket === 1 ? 0.055 : 0.065;
}

function computePlannedPointAtProgress(poly, t) {
  const pts = toLatLngs(poly);
  if (pts.length < 2) return null;

  const tt = clamp(Number(t) || 0, 0, 1);
  const segFloat = tt * (pts.length - 1);
  const seg = Math.floor(segFloat);
  const segT = segFloat - seg;

  const a = pts[seg];
  const b = pts[Math.min(pts.length - 1, seg + 1)];
  return interpolatePoint(a, b, segT);
}

function applyMildGpsNoise(p, engineerId, tick) {
  // Small deterministic “noise” that stays on-route (<= ~8m) to avoid a perfectly straight line.
  const factor = (String(engineerId || "").length + tick) % 4; // 0..3
  const east = factor * 2; // 0..6 meters
  const north = (3 - factor) * 2; // 6..0 meters
  return offsetPointMeters(p, east, north);
}

/**
 * Deliberate off-route segment:
 * - for clarity, we only do this briefly around a route's deviationTick.
 * - offset is ~120m east + 40m north to exceed route.allowedDeviationMeters (60-80m) reliably.
 */
function applyDeliberateDeviation(p) {
  // Make deviations unmistakable even with simplified planned routes:
  // ~150m east + ~60m north reliably exceeds 60–80m thresholds, but remains visually near the route.
  return offsetPointMeters(p, 150, 60);
}

/**
 * Route status transitions (deterministic and easy to explain):
 * - Each route has demo.startTick and demo.completeTick.
 * - We store per-route ticks so routes can be at different stages concurrently.
 */
function tickRouteStatusesAndStops(nextState, globalTick) {
  const routeDemoProgress = loadRouteDemoProgress();
  const routes = Array.isArray(nextState.routes) ? nextState.routes : [];

  nextState.routes = routes.map((r) => {
    const planned = Number(r.planned_stops || 0);
    const completedStops = Number(r.completed_stops || 0);

    const demo = normalizeDemoMeta(r);
    const rid = r.id;

    // Per-route local tick, derived from globalTick but stored (so reversible and stable).
    // If missing, seed with 0 so the schedule starts cleanly.
    const localTick = Number(routeDemoProgress[rid] || 0);

    // Advance per-route tick by 1 each global tick. This makes different routes follow their own schedule
    // even if the app reorders arrays.
    const nextLocalTick = localTick + 1;
    routeDemoProgress[rid] = nextLocalTick;

    // Determine status from schedule
    const currentStatus = normalizeRouteStatus(r.routeStatus);
    let routeStatus = currentStatus;

    if (nextLocalTick < demo.startTick) routeStatus = "not_started";
    else if (nextLocalTick >= demo.completeTick) routeStatus = "completed";
    else routeStatus = "in_progress";

    // Update stops in a clear, non-random way:
    // - Not started: 0 completed stops
    // - In progress: progress linearly up to planned-1
    // - Completed: planned stops (fully covered)
    let nextCompletedStops = completedStops;

    if (planned > 0) {
      if (routeStatus === "not_started") {
        nextCompletedStops = 0;
      } else if (routeStatus === "in_progress") {
        const span = Math.max(1, demo.completeTick - demo.startTick);
        const stage = clamp(nextLocalTick - demo.startTick + 1, 0, span);
        const pct = stage / span; // 0..1
        // Keep 1 stop “remaining” until completed, so completion is visible.
        nextCompletedStops = clamp(Math.floor(pct * (planned - 1)), 1, Math.max(1, planned - 1));
      } else if (routeStatus === "completed") {
        nextCompletedStops = planned;
      }
    }

    return computeRouteCompletion({
      ...r,
      routeStatus,
      completed_stops: planned > 0 ? clamp(nextCompletedStops, 0, planned) : 0,
    });
  });

  saveRouteDemoProgress(routeDemoProgress);
}

function tickTasksDeterministically(nextState) {
  // For demo clarity:
  // - each task transitions: ASSIGNED -> IN_PROGRESS -> COMPLETED
  // - REDO / REJECTED remain as-is (exceptions are intentional)
  // - POSTPONED / ON_HOLD remain as-is (avoid clutter)
  //
  // We pace tasks so they move slowly and predictably based on routeStatus.
  const routesById = new Map((nextState.routes || []).map((r) => [r.id, r]));
  const tasks = Array.isArray(nextState.tasks) ? nextState.tasks : [];

  nextState.tasks = tasks.map((t) => {
    if (t.status === Statuses.REJECTED || t.status === Statuses.REDO) return t;
    if (t.status === Statuses.POSTPONED || t.status === Statuses.ON_HOLD) return t;

    const route = routesById.get(t.routeId);
    const routeStatus = normalizeRouteStatus(route?.routeStatus);

    // If route hasn't started, keep tasks assigned (clear expectation).
    if (routeStatus === "not_started") {
      return t.status === Statuses.ASSIGNED ? t : { ...t, status: Statuses.ASSIGNED };
    }

    // If route in progress, move some tasks to in-progress, but do not finish everything at once.
    if (routeStatus === "in_progress") {
      // Deterministic partition by task id: every other task becomes in_progress.
      const idSum = String(t.id || "")
        .split("")
        .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

      const shouldBeInProgress = idSum % 2 === 0;
      if (t.status === Statuses.ASSIGNED && shouldBeInProgress) return { ...t, status: Statuses.IN_PROGRESS };
      // Let existing IN_PROGRESS remain.
      return t;
    }

    // If route completed, complete all non-exception tasks for that route.
    if (routeStatus === "completed") {
      if (t.status === Statuses.COMPLETED) return t;
      return { ...t, status: Statuses.COMPLETED };
    }

    return t;
  });
}

function tickEngineerMovementAndTrails(nextState, globalTick) {
  const progressByEngineer = loadEngineerProgressMap();
  const trailsByEngineer = loadEngineerTrails();
  const routeDemoProgress = loadRouteDemoProgress();

  const locations = Array.isArray(nextState.engineerLiveLocations) ? nextState.engineerLiveLocations : [];
  const routesById = new Map((nextState.routes || []).map((r) => [r.id, r]));

  const updatedLocations = locations.map((loc) => {
    const route = findRouteForEngineer(nextState, loc.engineerId);
    const routeId = route?.id || "";
    const plannedPoly = route?.polyline || [];
    const plannedPoint = computePlannedPointAtProgress(plannedPoly, progressByEngineer[loc.engineerId] || 0);

    if (!route || !plannedPoint) return loc;

    const demo = normalizeDemoMeta(route);
    const localTick = Number(routeDemoProgress[routeId] || 0);
    const routeStatus = normalizeRouteStatus(routesById.get(routeId)?.routeStatus);

    // Engineer progress rules:
    // - Not started: stay at start (t=0)
    // - In progress: advance by a small deterministic amount each tick
    // - Completed: snap to end (t=1)
    let t = Number(progressByEngineer[loc.engineerId] || 0);

    if (routeStatus === "not_started") {
      t = 0;
    } else if (routeStatus === "completed") {
      t = 1;
    } else {
      const step = speedFactorForEngineer(loc.engineerId);
      t = clamp(t + step, 0, 1);
    }

    progressByEngineer[loc.engineerId] = t;

    let pt = computePlannedPointAtProgress(plannedPoly, t);
    if (!pt) return loc;

    // Apply mild noise (stays near the line)
    pt = applyMildGpsNoise(pt, loc.engineerId, globalTick);

    // Apply a short deliberate deviation near deviationTick while route is in progress:
    // - exactly 2 ticks of deviation to keep red segment short and clear.
    const shouldDeviate =
      routeStatus === "in_progress" && (localTick === demo.deviationTick || localTick === demo.deviationTick + 1);

    if (shouldDeviate) {
      pt = applyDeliberateDeviation(pt);
    }

    // Append to trails (persisted)
    if (ENABLE_TRAILS) {
      const prevTrail = Array.isArray(trailsByEngineer[loc.engineerId]) ? trailsByEngineer[loc.engineerId] : [];
      const nextTrail = [...prevTrail, [pt.lat, pt.lng]];
      // Keep last N points
      trailsByEngineer[loc.engineerId] = nextTrail.slice(Math.max(0, nextTrail.length - MAX_TRAIL_POINTS));
    }

    return { ...loc, lat: pt.lat, lng: pt.lng };
  });

  nextState.engineerLiveLocations = updatedLocations;

  saveEngineerProgressMap(progressByEngineer);
  saveEngineerTrails(trailsByEngineer);
}

/**
 * PUBLIC_INTERFACE
 * Returns a persisted map of engineerId -> [[lat,lng], ...] GPS trail points.
 *
 * MapPanel currently synthesizes trails internally; this function provides a clean seam
 * so a future agent can wire MapPanel to persisted trails without changing the refresh logic.
 */
export function loadPersistedEngineerTrails() {
  /** Loads persisted engineer GPS trails (for potential use by map rendering). */
  return loadEngineerTrails();
}

function computeNextDomainState(prevState) {
  const next = deepClone(prevState);

  // Global tick (monotonic across refreshes)
  const meta = loadRefreshMeta();
  const nextTick = Number(meta?.tick || 0) + 1;

  // 1) Advance route statuses + route stop progress (demo schedule)
  tickRouteStatusesAndStops(next, nextTick);

  // 2) Advance engineers and append to trails (clear, progressive movement)
  tickEngineerMovementAndTrails(next, nextTick);

  // 3) Advance task statuses deterministically based on route stage
  tickTasksDeterministically(next);

  // Persist meta
  saveRefreshMeta({ lastRefreshedAt: nowIso(), tick: nextTick });

  return { state: next, toastEvents: [] };
}

// PUBLIC_INTERFACE
export function runDummyRefreshOnce(fullState) {
  /**
   * Runs a single refresh tick:
   * - returns { ok, state, refreshedAt, toastEvents }
   * - persists updated domain state to localStorage
   * - persists meta.lastRefreshedAt and meta.tick
   *
   * NOTE: In a real app, replace this with API polling + websocket updates, then persist into domain store.
   */
  try {
    const { state: next, toastEvents } = computeNextDomainState(fullState);
    const refreshedAt = nowIso();
    saveDomainState(next);

    // saveRefreshMeta already ran inside computeNextDomainState; keep returned timestamp aligned.
    return { ok: true, state: next, refreshedAt, toastEvents };
  } catch (e) {
    return { ok: false, error: e?.message || "Failed to refresh sample data." };
  }
}
