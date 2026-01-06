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
 * No external APIs or keys are required.
 */

const REFRESH_META_STORAGE_KEY = "fod_dummy_refresh_meta_v1";

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
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function mulberry32(seed) {
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

function computeEngineerRouteProgressMap(state) {
  // We persist a per-engineer progress (0..1) in localStorage meta so movement feels continuous.
  const key = "fod_engineer_route_progress_v1";
  let store = {};
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) store = JSON.parse(raw) || {};
  } catch {
    store = {};
  }

  const progressByEngineer = store || {};
  const setProgress = (engineerId, t) => {
    progressByEngineer[engineerId] = t;
  };

  const persist = () => window.localStorage.setItem(key, JSON.stringify(progressByEngineer));

  return { progressByEngineer, setProgress, persist };
}

function findRouteForEngineer(state, engineerId) {
  const a = (state.engineerAssignments || []).find((x) => x.engineerId === engineerId);
  if (!a) return null;
  return (state.routes || []).find((r) => r.id === a.routeId) || null;
}

function tickEngineerMovement(nextState) {
  const { progressByEngineer, setProgress, persist } = computeEngineerRouteProgressMap(nextState);

  const seedBase = hashStringToInt("fod_refresh_seed");
  const rand = mulberry32(seedBase + Date.now()); // slight variability each refresh

  const locations = Array.isArray(nextState.engineerLiveLocations) ? nextState.engineerLiveLocations : [];
  const updated = locations.map((loc) => {
    const route = findRouteForEngineer(nextState, loc.engineerId);
    const poly = toLatLngs(route?.polyline || []);
    if (!poly.length) return loc;

    const currentT = Number(progressByEngineer[loc.engineerId] || 0);
    // Advance between 2% and 9% of route each refresh
    const advance = 0.02 + rand() * 0.07;
    const t = (currentT + advance) % 1;

    const segFloat = t * (poly.length - 1);
    const seg = Math.floor(segFloat);
    const segT = segFloat - seg;

    const a = poly[seg];
    const b = poly[Math.min(poly.length - 1, seg + 1)];
    const planned = interpolatePoint(a, b, segT);

    // Jitter to avoid perfectly snapping to the line (still mostly on-route)
    const jitterMeters = 8 + rand() * 24;
    const moved = jitterPoint(planned, rand, jitterMeters);

    setProgress(loc.engineerId, t);

    return { ...loc, lat: moved.lat, lng: moved.lng };
  });

  nextState.engineerLiveLocations = updated;
  persist();
}

function tickRouteProgress(nextState) {
  const routes = Array.isArray(nextState.routes) ? nextState.routes : [];
  const seed = hashStringToInt(`route_tick_${Date.now().toString(16)}`);
  const rand = mulberry32(seed);

  nextState.routes = routes.map((r) => {
    const planned = Number(r.planned_stops || 0);
    if (planned <= 0) return computeRouteCompletion(r);

    let completed = Number(r.completed_stops || 0);

    // Progress only if not essentially completed
    if (completed < planned) {
      // 0..2 stops per refresh, biased to 1
      const inc = rand() > 0.85 ? 2 : rand() > 0.35 ? 1 : 0;
      completed = clamp(completed + inc, 0, planned);
    }

    return computeRouteCompletion({ ...r, completed_stops: completed });
  });
}

function tickSomeTaskStatuses(nextState) {
  const tasks = Array.isArray(nextState.tasks) ? nextState.tasks : [];
  const seed = hashStringToInt(`task_tick_${Date.now().toString(16)}`);
  const rand = mulberry32(seed);

  // Only lightly mutate to preserve demo feel:
  // - some ASSIGNED -> IN_PROGRESS
  // - some IN_PROGRESS -> COMPLETED
  // never auto-change exceptions (rejected/redo) or holds/postponed.
  nextState.tasks = tasks.map((t) => {
    const roll = rand();
    if (t.status === Statuses.ASSIGNED && roll > 0.85) return { ...t, status: Statuses.IN_PROGRESS };
    if (t.status === Statuses.IN_PROGRESS && roll > 0.9) return { ...t, status: Statuses.COMPLETED };
    return t;
  });
}

function computeNextDomainState(prevState) {
  const next = deepClone(prevState);

  tickEngineerMovement(next);
  tickRouteProgress(next);
  tickSomeTaskStatuses(next);

  return next;
}

// PUBLIC_INTERFACE
export function runDummyRefreshOnce(fullState) {
  /**
   * Runs a single dummy refresh tick:
   * - returns { ok, state, refreshedAt }
   * - persists updated domain state to localStorage
   * - persists meta.lastRefreshedAt
   */
  try {
    const next = computeNextDomainState(fullState);
    const refreshedAt = nowIso();
    saveDomainState(next);
    saveRefreshMeta({ lastRefreshedAt: refreshedAt });
    return { ok: true, state: next, refreshedAt };
  } catch (e) {
    return { ok: false, error: e?.message || "Failed to refresh dummy data." };
  }
}
