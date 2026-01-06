import { Statuses } from "../data/dummyData";
import { saveDomainState } from "./domainStore";

/**
 * Dummy-data refresh engine (client-only).
 *
 * This simulates a backend polling loop by mutating the persisted domain state
 * at a fixed interval:
 * - engineers move along their assigned route polyline
 * - route completed stops progress (and completion_percent updates)
 * - a few task statuses may advance (assigned -> in_progress -> completed)
 *
 * IMPORTANT: This file is the seam where real API polling can later replace the dummy mutations.
 *
 * NOTE (2026-01): Randomized demo mutations and random toast generation were removed.
 * Refresh behavior is deterministic again so the 30s loop is stable and repeatable.
 */

const REFRESH_META_STORAGE_KEY = "fod_dummy_refresh_meta_v1";
const ENGINEER_PROGRESS_STORAGE_KEY = "fod_engineer_route_progress_v1";

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

function hashStringToInt(str) {
  // Simple deterministic hash for stable PRNG seeding.
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function mulberry32(seed) {
  // Deterministic PRNG (repeatable across page loads).
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toLatLngs(polyline = []) {
  return (polyline || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ lat: p.lat, lng: p.lng }));
}

function interpolatePoint(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function jitterPoint(p, rand, meters = 18) {
  // Convert meters to degrees (approx around latitude)
  const lat0 = (p.lat * Math.PI) / 180;
  const metersPerDegLat = 111132.92;
  const metersPerDegLng = 111412.84 * Math.cos(lat0);

  const angle = rand() * Math.PI * 2;
  const dx = Math.cos(angle) * meters;
  const dy = Math.sin(angle) * meters;

  return {
    lat: p.lat + dy / metersPerDegLat,
    lng: p.lng + dx / metersPerDegLng,
  };
}

function loadRefreshMeta() {
  try {
    const raw = window.localStorage.getItem(REFRESH_META_STORAGE_KEY);
    if (!raw) return { lastRefreshedAt: "" };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { lastRefreshedAt: "" };
  } catch {
    return { lastRefreshedAt: "" };
  }
}

function saveRefreshMeta(meta) {
  window.localStorage.setItem(REFRESH_META_STORAGE_KEY, JSON.stringify(meta));
}

// PUBLIC_INTERFACE
export function getLastRefreshMeta() {
  /** Returns persisted meta about the dummy refresh engine (currently lastRefreshedAt). */
  return loadRefreshMeta();
}

function computeEngineerRouteProgressMap() {
  // Persist a per-engineer progress (0..1) so movement feels continuous across refresh ticks.
  let store = {};
  try {
    const raw = window.localStorage.getItem(ENGINEER_PROGRESS_STORAGE_KEY);
    if (raw) store = JSON.parse(raw) || {};
  } catch {
    store = {};
  }

  const progressByEngineer = store || {};
  const setProgress = (engineerId, t) => {
    progressByEngineer[engineerId] = t;
  };

  const persist = () => window.localStorage.setItem(ENGINEER_PROGRESS_STORAGE_KEY, JSON.stringify(progressByEngineer));

  return { progressByEngineer, setProgress, persist };
}

function findRouteForEngineer(state, engineerId) {
  const a = (state.engineerAssignments || []).find((x) => x.engineerId === engineerId);
  if (!a) return null;
  return (state.routes || []).find((r) => r.id === a.routeId) || null;
}

function stableRandForTick(prevState) {
  /**
   * Deterministic per-tick seed that does NOT use Date.now().
   * We derive a seed from state + last refresh meta so repeated runs are stable and monotonic.
   */
  const meta = loadRefreshMeta();
  const last = meta?.lastRefreshedAt || "";
  const routesKey = JSON.stringify((prevState?.routes || []).map((r) => [r.id, r.completed_stops, r.completion_percent]));
  const tasksKey = JSON.stringify((prevState?.tasks || []).map((t) => [t.id, t.status]));
  const seed = hashStringToInt(`fod_deterministic_refresh_v1|${last}|${routesKey}|${tasksKey}`);
  return mulberry32(seed);
}

function tickEngineerMovement(nextState, rand) {
  const { progressByEngineer, setProgress, persist } = computeEngineerRouteProgressMap();

  const locations = Array.isArray(nextState.engineerLiveLocations) ? nextState.engineerLiveLocations : [];
  const updated = locations.map((loc) => {
    const route = findRouteForEngineer(nextState, loc.engineerId);
    const poly = toLatLngs(route?.polyline || []);
    if (!poly.length) return loc;

    const currentT = Number(progressByEngineer[loc.engineerId] || 0);

    // Deterministic advance between ~4.5% and ~7.5% per refresh (bounded, stable).
    // This keeps UI feeling "live" without depending on time-based randomness.
    const advance = 0.045 + rand() * 0.03;
    const t = (currentT + advance) % 1;

    const segFloat = t * (poly.length - 1);
    const seg = Math.floor(segFloat);
    const segT = segFloat - seg;

    const a = poly[seg];
    const b = poly[Math.min(poly.length - 1, seg + 1)];
    const planned = interpolatePoint(a, b, segT);

    // Mild deterministic jitter to avoid snapping exactly to the line.
    const jitterMeters = 10 + rand() * 10;
    const moved = jitterPoint(planned, rand, jitterMeters);

    setProgress(loc.engineerId, t);
    return { ...loc, lat: moved.lat, lng: moved.lng };
  });

  nextState.engineerLiveLocations = updated;
  persist();
}

function tickRouteProgress(nextState, rand) {
  const routes = Array.isArray(nextState.routes) ? nextState.routes : [];

  nextState.routes = routes.map((r) => {
    const planned = Number(r.planned_stops || 0);
    if (planned <= 0) return computeRouteCompletion(r);

    let completed = Number(r.completed_stops || 0);

    // Deterministic-ish incremental stops progression:
    // - mostly +1, sometimes +0, rarely +2.
    if (completed < planned) {
      const roll = rand();
      const inc = roll > 0.92 ? 2 : roll > 0.22 ? 1 : 0;
      completed = clamp(completed + inc, 0, planned);
    }

    return computeRouteCompletion({ ...r, completed_stops: completed });
  });
}

function tickSomeTaskStatuses(nextState, rand) {
  const tasks = Array.isArray(nextState.tasks) ? nextState.tasks : [];

  // Light deterministic mutations:
  // - some ASSIGNED -> IN_PROGRESS
  // - some IN_PROGRESS -> COMPLETED
  // never auto-change exceptions (rejected/redo) or holds/postponed.
  nextState.tasks = tasks.map((t) => {
    const roll = rand();
    if (t.status === Statuses.ASSIGNED && roll > 0.88) return { ...t, status: Statuses.IN_PROGRESS };
    if (t.status === Statuses.IN_PROGRESS && roll > 0.93) return { ...t, status: Statuses.COMPLETED };
    return t;
  });
}

function computeNextDomainState(prevState) {
  const next = deepClone(prevState);
  const rand = stableRandForTick(prevState);

  tickEngineerMovement(next, rand);
  tickRouteProgress(next, rand);
  tickSomeTaskStatuses(next, rand);

  // Random toast generation removed; compliance deviation toasts are driven by compliance.js.
  return { state: next, toastEvents: [] };
}

// PUBLIC_INTERFACE
export function runDummyRefreshOnce(fullState) {
  /**
   * Runs a single dummy refresh tick:
   * - returns { ok, state, refreshedAt, toastEvents }
   * - persists updated domain state to localStorage
   * - persists meta.lastRefreshedAt
   *
   * NOTE: In a real app, replace this with API polling + websocket updates, then persist into domain store.
   */
  try {
    const { state: next, toastEvents } = computeNextDomainState(fullState);
    const refreshedAt = nowIso();
    saveDomainState(next);
    saveRefreshMeta({ lastRefreshedAt: refreshedAt });
    return { ok: true, state: next, refreshedAt, toastEvents };
  } catch (e) {
    return { ok: false, error: e?.message || "Failed to refresh dummy data." };
  }
}
