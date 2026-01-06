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
 * Enhancements (demo randomization layer):
 * - Optional randomized mutations (small bounded changes) so dashboard visibly updates
 * - Optional random alert "toast events" emitted from the refresh tick (UI decides how to display)
 *
 * IMPORTANT: This file is the seam where real API polling can later replace the dummy mutations.
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

/**
 * Dummy randomization config.
 * Keep this small and controlled so it remains non-disruptive and demo-friendly.
 */
const DEFAULT_RANDOM_CONFIG = Object.freeze({
  randomizeEnabled: true,
  toastChancePerTick: 0.3,
  deviationChance: 0.15,
  taskFlipChance: 0.1,
  progressJitterRange: [1, 4], // percent points to jitter/advance
  maxTaskFlipsPerTick: 1,
});

function normalizeRandomConfig(cfg) {
  const merged = { ...DEFAULT_RANDOM_CONFIG, ...(cfg || {}) };
  const pr = Array.isArray(merged.progressJitterRange) ? merged.progressJitterRange : DEFAULT_RANDOM_CONFIG.progressJitterRange;
  merged.progressJitterRange = [
    Number.isFinite(Number(pr[0])) ? Number(pr[0]) : DEFAULT_RANDOM_CONFIG.progressJitterRange[0],
    Number.isFinite(Number(pr[1])) ? Number(pr[1]) : DEFAULT_RANDOM_CONFIG.progressJitterRange[1],
  ];
  merged.toastChancePerTick = clamp(Number(merged.toastChancePerTick || 0), 0, 1);
  merged.deviationChance = clamp(Number(merged.deviationChance || 0), 0, 1);
  merged.taskFlipChance = clamp(Number(merged.taskFlipChance || 0), 0, 1);
  merged.maxTaskFlipsPerTick = clamp(Number(merged.maxTaskFlipsPerTick || 1), 0, 5);
  merged.randomizeEnabled = Boolean(merged.randomizeEnabled);
  return merged;
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function pick(arr, rand) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(rand() * arr.length)];
}

function rollChance(rand, p) {
  return rand() < p;
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

function tickEngineerMovement(nextState, rand) {
  const { progressByEngineer, setProgress, persist } = computeEngineerRouteProgressMap(nextState);

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

function tickRouteProgress(nextState, rand) {
  const routes = Array.isArray(nextState.routes) ? nextState.routes : [];

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

function tickSomeTaskStatuses(nextState, rand) {
  const tasks = Array.isArray(nextState.tasks) ? nextState.tasks : [];

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

/**
 * Randomization layer: produces small changes so the UI demonstrates live updates.
 * IMPORTANT: Keep changes bounded and avoid excessive churn.
 *
 * Returns: { nextState, toastEvents }
 */
function applyRandomization(nextState, prevState, rand, config) {
  const toastEvents = [];

  const safeCfg = normalizeRandomConfig(config);
  if (!safeCfg.randomizeEnabled) return { nextState, toastEvents };

  // 1) Progress jitter/advance by percentage points (bounded, no <0 or >100, never regress).
  // This is intentionally separate from stop-based progression so it visibly moves even for small planned_stops.
  nextState.routes = (nextState.routes || []).map((r) => {
    const planned = Number(r.planned_stops || 0);
    const completed = Number(r.completed_stops || 0);

    // If route has no stops, keep completion_percent stable.
    if (planned <= 0) return computeRouteCompletion(r);

    const prev = (prevState?.routes || []).find((x) => x.id === r.id) || r;
    const prevPct = Number(prev?.completion_percent || 0);

    const [minJ, maxJ] = safeCfg.progressJitterRange;
    const jitter = Math.round(minJ + rand() * Math.max(0, maxJ - minJ));
    const nextPct = clampPct(prevPct + jitter);

    // Never regress completion: keep monotonic.
    const monotonicPct = Math.max(prevPct, nextPct);

    // Translate pct to stop counts in a consistent way.
    // Ensure monotonic stops as well; keep within [0..planned].
    const targetStops = clamp(Math.round((monotonicPct / 100) * planned), 0, planned);
    const nextCompletedStops = Math.max(completed, targetStops);

    // Optional progress milestone toast (on thresholds).
    const milestone = monotonicPct >= 100 ? 100 : monotonicPct >= 90 ? 90 : monotonicPct >= 75 ? 75 : monotonicPct >= 50 ? 50 : 0;
    const prevMilestone =
      prevPct >= 100 ? 100 : prevPct >= 90 ? 90 : prevPct >= 75 ? 75 : prevPct >= 50 ? 50 : 0;

    if (milestone && milestone !== prevMilestone) {
      toastEvents.push({
        id: randomId("toast"),
        dedupeKey: `route_milestone|${r.id}|${milestone}`,
        severity: milestone >= 90 ? "default" : "default",
        title: "Route milestone reached",
        category: "route",
        occurredAtIso: nowIso(),
        message: `${r.name || r.id} crossed ${milestone}% completion.`,
        routeId: r.id,
      });
    }

    return computeRouteCompletion({ ...r, completed_stops: nextCompletedStops });
  });

  // 2) Occasionally flip at most N tasks into exception states (Rejected/Redo) so Exceptions card updates.
  // Guard: flip at most maxTaskFlipsPerTick.
  const tasks = Array.isArray(nextState.tasks) ? nextState.tasks : [];
  const flipCandidates = tasks.filter(
    (t) =>
      t &&
      t.id &&
      // Prefer flipping "active-ish" tasks to keep it believable
      (t.status === Statuses.IN_PROGRESS || t.status === Statuses.ASSIGNED || t.status === Statuses.COMPLETED) &&
      t.status !== Statuses.REJECTED &&
      t.status !== Statuses.REDO
  );

  let flipsRemaining = safeCfg.maxTaskFlipsPerTick;

  if (flipsRemaining > 0 && rollChance(rand, safeCfg.taskFlipChance) && flipCandidates.length) {
    const chosen = pick(flipCandidates, rand);
    if (chosen) {
      const toStatus = rand() > 0.55 ? Statuses.REDO : Statuses.REJECTED;
      const reasonsRejected = ["Customer not home", "Access blocked", "Safety concern reported", "Incorrect address details"];
      const reasonsRedo = ["Photo evidence required", "Parts missing - return required", "Work quality review requested", "Validation failed - redo"];

      nextState.tasks = tasks.map((t) => {
        if (t.id !== chosen.id) return t;

        if (toStatus === Statuses.REJECTED) {
          return {
            ...t,
            status: Statuses.REJECTED,
            rejection_reason: pick(reasonsRejected, rand) || "Issue reported",
          };
        }

        return {
          ...t,
          status: Statuses.REDO,
          redo_reason: pick(reasonsRedo, rand) || "Redo requested",
          redo_count: Number.isFinite(t.redo_count) ? t.redo_count + 1 : 1,
        };
      });

      toastEvents.push({
        id: randomId("toast"),
        dedupeKey: `task_exception|${chosen.id}|${toStatus}`,
        severity: toStatus === Statuses.REJECTED ? "high" : "medium",
        title: toStatus === Statuses.REJECTED ? "Task rejected" : "Task redo requested",
        category: "task",
        occurredAtIso: nowIso(),
        message: `${chosen.title || chosen.id} marked as ${toStatus}.`,
        engineerId: chosen.engineerId,
        routeId: chosen.routeId,
      });

      flipsRemaining -= 1;
    }
  }

  // 3) Sporadically reassign an engineer (shows visible change on map/metrics).
  // Keep it rare and do not break scoping (assign within existing routes list).
  if (rollChance(rand, 0.08) && Array.isArray(nextState.engineerAssignments) && Array.isArray(nextState.routes)) {
    const assignments = nextState.engineerAssignments;
    const routesList = nextState.routes;
    if (assignments.length && routesList.length >= 2) {
      const a = pick(assignments, rand);
      const alt = pick(
        routesList.filter((r) => r.id !== a.routeId),
        rand
      );
      if (a && alt) {
        nextState.engineerAssignments = assignments.map((x) => (x.engineerId === a.engineerId ? { ...x, routeId: alt.id } : x));

        toastEvents.push({
          id: randomId("toast"),
          dedupeKey: `engineer_reassigned|${a.engineerId}|${alt.id}`,
          severity: "default",
          title: "Engineer reassigned",
          category: "allocation",
          occurredAtIso: nowIso(),
          message: `Engineer ${a.engineerId} reassigned to ${alt.name || alt.id}.`,
          engineerId: a.engineerId,
          routeId: alt.id,
        });
      }
    }
  }

  // 4) Optional "minor deviation" alert toast (does not itself create compliance flags).
  // Compliance flags remain computed by compliance.js; this toast is a generic alert for demo.
  if (rollChance(rand, safeCfg.deviationChance)) {
    const routesList = Array.isArray(nextState.routes) ? nextState.routes : [];
    const r = pick(routesList, rand);
    if (r) {
      toastEvents.push({
        id: randomId("toast"),
        dedupeKey: `minor_deviation|${r.id}`,
        severity: "low",
        title: "Minor deviation detected",
        category: "compliance",
        occurredAtIso: nowIso(),
        message: `${r.name || r.id}: minor deviation pattern detected. Monitoring...`,
        routeId: r.id,
      });
    }
  }

  // 5) Occasionally emit a generic toast per tick (controlled by toastChancePerTick)
  // (This is separate from the specific events above.)
  if (rollChance(rand, safeCfg.toastChancePerTick)) {
    const variants = [
      { title: "Update received", category: "system", severity: "default", message: "Live feed updated (dummy)." },
      { title: "Progress updated", category: "route", severity: "default", message: "Routes advanced on the latest tick." },
      { title: "Ops note", category: "ops", severity: "default", message: "Small operational change detected." },
    ];
    const v = pick(variants, rand);
    if (v) {
      toastEvents.push({
        id: randomId("toast"),
        dedupeKey: `generic_tick|${v.category}`,
        severity: v.severity,
        title: v.title,
        category: v.category,
        occurredAtIso: nowIso(),
        message: v.message,
      });
    }
  }

  return { nextState, toastEvents };
}

function computeNextDomainState(prevState, { randomConfig } = {}) {
  const next = deepClone(prevState);

  // Deterministic-ish seed with time variability.
  const seedBase = hashStringToInt("fod_refresh_seed");
  const rand = mulberry32(seedBase + Date.now());

  tickEngineerMovement(next, rand);
  tickRouteProgress(next, rand);
  tickSomeTaskStatuses(next, rand);

  const randomized = applyRandomization(next, prevState, rand, randomConfig);
  return { state: randomized.nextState, toastEvents: randomized.toastEvents };
}

// PUBLIC_INTERFACE
export function runDummyRefreshOnce(fullState, { randomConfig } = {}) {
  /**
   * Runs a single dummy refresh tick:
   * - returns { ok, state, refreshedAt, toastEvents }
   * - persists updated domain state to localStorage
   * - persists meta.lastRefreshedAt
   *
   * NOTE: In a real app, replace this with API polling + websocket updates, then persist into domain store.
   */
  try {
    const { state: next, toastEvents } = computeNextDomainState(fullState, { randomConfig });
    const refreshedAt = nowIso();
    saveDomainState(next);
    saveRefreshMeta({ lastRefreshedAt: refreshedAt });
    return { ok: true, state: next, refreshedAt, toastEvents };
  } catch (e) {
    return { ok: false, error: e?.message || "Failed to refresh dummy data." };
  }
}
