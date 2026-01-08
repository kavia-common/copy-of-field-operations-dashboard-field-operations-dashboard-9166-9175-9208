import { saveDomainState } from "./domainStore";

/**
 * Compliance / route deviation detection (client-only).
 * Driven entirely by dummy data and persisted to localStorage to provide a history trail.
 *
 * The data model is intentionally simple so it can be used across:
 * - Dashboard metric card + drill-down
 * - Map highlighting (route polyline + engineer marker)
 * - Exceptions / Assignments surfacing
 *
 * Additions:
 * - A minimal “deviation event” emitter that can be used by UI to trigger popup/toast alerts.
 * - Persisted “seen” metadata to avoid repeating popups across refresh/page reload.
 */

const STORAGE_KEY = "fod_compliance_v1";
const DEVIATION_SEEN_STORAGE_KEY = "fod_compliance_deviation_seen_v1";

/**
 * Configurable thresholds for detection rules.
 * Tune these values without changing the detection logic.
 */
export const DEFAULT_COMPLIANCE_CONFIG = Object.freeze({
  // Max allowed distance from planned route polyline before flagging "off-route".
  // TrackoBit-like default corridor: 50m (can be tuned via config if needed).
  offRouteThresholdMeters: 50,

  // Consider a waypoint/checkpoint "visited" if any breadcrumb is within this radius.
  waypointVisitRadiusMeters: 120,

  // If engineer is stationary (total moved distance) within this radius for longer than threshold => idle.
  idleRadiusMeters: 35,
  idleThresholdMinutes: 25,

  // Route schedule windows: start must be within +/- window from planned start, end within +/- window.
  startWindowMinutes: 20,
  endWindowMinutes: 30,

  // How many breadcrumbs we simulate per engineer per day (dummy GPS feed).
  breadcrumbsPerDay: 18,

  // Deterministic time anchors for a "day" for simulation purposes (local-time-like strings).
  simulatedDayStartHour: 8,
});

/**
 * Severity levels used for dashboard counts and styling.
 */
export const ComplianceSeverity = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

export const ComplianceRule = Object.freeze({
  OFF_ROUTE: "off_route",
  MISSED_WAYPOINTS: "missed_waypoints",
  OUT_OF_GEOFENCE: "out_of_geofence",
  PROLONGED_IDLE: "prolonged_idle",
  START_WINDOW_BREACH: "start_window_breach",
  END_WINDOW_BREACH: "end_window_breach",
});

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function nowIso() {
  return new Date().toISOString();
}

function datePrefix(iso) {
  return (iso || nowIso()).slice(0, 10);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hashStringToInt(str) {
  // Simple deterministic hash for stable dummy simulation.
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function mulberry32(seed) {
  // Deterministic PRNG (for repeatable dummy GPS)
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Haversine distance in meters between two lat/lng points
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

// Approximate distance from point to polyline (meters) by checking each segment with simple equirectangular projection
function pointToPolylineMeters(point, polyline) {
  if (!polyline || polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineMeters(point, polyline[0]);

  // local projection around point latitude to reduce error for short distances
  const lat0 = (point.lat * Math.PI) / 180;
  const metersPerDegLat = 111132.92; // approx
  const metersPerDegLng = 111412.84 * Math.cos(lat0);

  const px = point.lng * metersPerDegLng;
  const py = point.lat * metersPerDegLat;

  let best = Infinity;

  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const ax = a.lng * metersPerDegLng;
    const ay = a.lat * metersPerDegLat;
    const bx = b.lng * metersPerDegLng;
    const by = b.lat * metersPerDegLat;

    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;

    const vv = vx * vx + vy * vy;
    const t = vv === 0 ? 0 : clamp((wx * vx + wy * vy) / vv, 0, 1);
    const cx = ax + t * vx;
    const cy = ay + t * vy;

    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    best = Math.min(best, dist);
  }

  return best;
}

function centroid(polyline) {
  if (!polyline || polyline.length === 0) return { lat: 0, lng: 0 };
  const sum = polyline.reduce(
    (acc, p) => {
      acc.lat += p.lat;
      acc.lng += p.lng;
      return acc;
    },
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / polyline.length, lng: sum.lng / polyline.length };
}

function geoFenceRadiusMeters(polyline) {
  // Simple geofence: circle around polyline centroid sized to cover polyline extents.
  const c = centroid(polyline);
  const max = (polyline || []).reduce((acc, p) => Math.max(acc, haversineMeters(c, p)), 0);
  // Give a little buffer so not all points flag out-of-geofence.
  return Math.max(350, max * 1.15);
}

function isoAtLocalHour(dateIso, hour, minute = 0) {
  const d = new Date(dateIso || nowIso());
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function loadStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { history: [], lastComputedAt: "" };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.history)) return { history: [], lastComputedAt: "" };
    return parsed;
  } catch {
    return { history: [], lastComputedAt: "" };
  }
}

function saveStore(store) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function loadDeviationSeenStore() {
  try {
    const raw = window.localStorage.getItem(DEVIATION_SEEN_STORAGE_KEY);
    if (!raw) return { seen: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { seen: {} };
    if (!parsed.seen || typeof parsed.seen !== "object") return { seen: {} };
    return parsed;
  } catch {
    return { seen: {} };
  }
}

function saveDeviationSeenStore(store) {
  window.localStorage.setItem(DEVIATION_SEEN_STORAGE_KEY, JSON.stringify(store));
}

function ruleLabel(rule) {
  switch (rule) {
    case ComplianceRule.OFF_ROUTE:
      return "Off-route";
    case ComplianceRule.MISSED_WAYPOINTS:
      return "Missed checkpoints";
    case ComplianceRule.OUT_OF_GEOFENCE:
      return "Out of geo-fence";
    case ComplianceRule.PROLONGED_IDLE:
      return "Prolonged idle";
    case ComplianceRule.START_WINDOW_BREACH:
      return "Start window breach";
    case ComplianceRule.END_WINDOW_BREACH:
      return "End window breach";
    default:
      return String(rule || "").replaceAll("_", " ");
  }
}

/**
 * PUBLIC_INTERFACE
 * Recomputes compliance for a given date (YYYY-MM-DD or ISO).
 * Persists an immutable "snapshot" record to localStorage history.
 */
export function computeAndPersistCompliance(fullState, { dateIso = "", config = DEFAULT_COMPLIANCE_CONFIG } = {}) {
  /** Compute compliance flags & scores and persist snapshot for dashboard drill-down and history. */
  const day = datePrefix(dateIso || nowIso());
  const computedAt = nowIso();

  const snapshot = computeComplianceSnapshot(fullState, { dateIso: day, config });
  const store = loadStore();

  // keep a single snapshot per day; replace if already computed (so UI stays stable)
  const nextHistory = (store.history || []).filter((h) => h.date !== day);
  nextHistory.unshift({
    id: randomId("comp"),
    date: day,
    computedAt,
    snapshot,
  });

  // cap history size
  const capped = nextHistory.slice(0, 30);

  const next = { lastComputedAt: computedAt, history: capped };
  saveStore(next);

  return snapshot;
}

/**
 * PUBLIC_INTERFACE
 * Returns the most recent persisted snapshot for a given date (if any).
 */
export function loadComplianceSnapshot({ dateIso = "" } = {}) {
  /** Load last computed compliance snapshot for a date from localStorage history. */
  const day = datePrefix(dateIso || nowIso());
  const store = loadStore();
  const rec = (store.history || []).find((h) => h.date === day);
  return rec?.snapshot || null;
}

/**
 * PUBLIC_INTERFACE
 * Produces compliance results without persisting.
 */
export function computeComplianceSnapshot(fullState, { dateIso = "", config = DEFAULT_COMPLIANCE_CONFIG } = {}) {
  /** Compute per-engineer flags, per-route compliance score, and overall summary for a selected day. */
  const day = datePrefix(dateIso || nowIso());

  const users = fullState?.users || [];
  const assignments = fullState?.engineerAssignments || [];
  const routes = fullState?.routes || [];
  const liveLocations = fullState?.engineerLiveLocations || [];

  const routeById = new Map(routes.map((r) => [r.id, r]));
  const engineerById = new Map(users.map((u) => [u.id, u]));
  const routeAssignmentsByEngineer = new Map();
  assignments.forEach((a) => {
    routeAssignmentsByEngineer.set(a.engineerId, a.routeId);
  });

  // Simulate breadcrumbs per engineer for the day.
  const breadcrumbsByEngineer = new Map();
  users
    .filter((u) => u.role === "Field Engineer")
    .forEach((eng) => {
      const routeId = routeAssignmentsByEngineer.get(eng.id);
      const route = routeId ? routeById.get(routeId) : null;
      const live = liveLocations.find((l) => l.engineerId === eng.id);

      breadcrumbsByEngineer.set(
        eng.id,
        simulateBreadcrumbs({
          engineerId: eng.id,
          dayIso: day,
          route,
          liveLocation: live,
          config,
        })
      );
    });

  // Evaluate flags.
  const flags = [];
  const perEngineerCounts = {};
  const perEngineerActiveSeverity = {};
  const perEngineerWorstSeverity = {};

  const perRouteScores = {};
  const perRouteFlagCounts = {};

  function pushFlag(flag) {
    flags.push(flag);

    const eid = flag.engineerId || "";
    if (eid) {
      perEngineerCounts[eid] = (perEngineerCounts[eid] || 0) + 1;

      const sev = flag.severity;
      perEngineerActiveSeverity[eid] = perEngineerActiveSeverity[eid] || { high: 0, medium: 0, low: 0 };
      perEngineerActiveSeverity[eid][sev] = (perEngineerActiveSeverity[eid][sev] || 0) + 1;

      const prevWorst = perEngineerWorstSeverity[eid];
      perEngineerWorstSeverity[eid] = pickWorstSeverity(prevWorst, sev);
    }

    const rid = flag.routeId || "";
    if (rid) {
      perRouteFlagCounts[rid] = perRouteFlagCounts[rid] || { high: 0, medium: 0, low: 0, total: 0 };
      perRouteFlagCounts[rid][flag.severity] += 1;
      perRouteFlagCounts[rid].total += 1;
    }
  }

  users
    .filter((u) => u.role === "Field Engineer")
    .forEach((eng) => {
      const routeId = routeAssignmentsByEngineer.get(eng.id) || "";
      const route = routeId ? routeById.get(routeId) : null;

      if (!route) return;

      const breadcrumbs = breadcrumbsByEngineer.get(eng.id) || [];

      // Rule: off-route (max distance from polyline)
      const distances = breadcrumbs.map((b) => pointToPolylineMeters({ lat: b.lat, lng: b.lng }, route.polyline));
      const maxDistance = distances.length ? Math.max(...distances) : 0;
      if (maxDistance > config.offRouteThresholdMeters) {
        pushFlag({
          id: randomId("flag"),
          date: day,
          engineerId: eng.id,
          routeId: route.id,
          rule: ComplianceRule.OFF_ROUTE,
          severity: ComplianceSeverity.HIGH,
          message: `Engineer exceeded off-route threshold (max ${Math.round(maxDistance)}m).`,
          meta: { maxDistanceMeters: maxDistance, thresholdMeters: config.offRouteThresholdMeters },
        });
      }

      // Rule: missed waypoints/checkpoints (use route polyline points as checkpoints)
      const waypoints = route.polyline || [];
      const missed = waypoints.filter((wp) => {
        return !breadcrumbs.some((b) => haversineMeters({ lat: b.lat, lng: b.lng }, wp) <= config.waypointVisitRadiusMeters);
      });

      if (missed.length > 0) {
        const ratio = missed.length / Math.max(1, waypoints.length);
        pushFlag({
          id: randomId("flag"),
          date: day,
          engineerId: eng.id,
          routeId: route.id,
          rule: ComplianceRule.MISSED_WAYPOINTS,
          severity: ratio >= 0.5 ? ComplianceSeverity.HIGH : ComplianceSeverity.MEDIUM,
          message: `Missed ${missed.length}/${waypoints.length} checkpoints.`,
          meta: { missedCount: missed.length, waypointCount: waypoints.length, visitRadiusMeters: config.waypointVisitRadiusMeters },
        });
      }

      // Rule: out of geofence (simple circle fence around route centroid)
      const c = centroid(route.polyline || []);
      const radius = geoFenceRadiusMeters(route.polyline || []);
      const outPoints = breadcrumbs.filter((b) => haversineMeters(c, { lat: b.lat, lng: b.lng }) > radius);
      if (outPoints.length > 0) {
        pushFlag({
          id: randomId("flag"),
          date: day,
          engineerId: eng.id,
          routeId: route.id,
          rule: ComplianceRule.OUT_OF_GEOFENCE,
          severity: ComplianceSeverity.HIGH,
          message: `Engineer left route geofence (${outPoints.length} breadcrumb(s) outside).`,
          meta: { geofenceRadiusMeters: radius, outsideCount: outPoints.length },
        });
      }

      // Rule: prolonged idle (stationary for threshold minutes)
      const idle = detectIdle(breadcrumbs, { idleRadiusMeters: config.idleRadiusMeters, idleThresholdMinutes: config.idleThresholdMinutes });
      if (idle) {
        pushFlag({
          id: randomId("flag"),
          date: day,
          engineerId: eng.id,
          routeId: route.id,
          rule: ComplianceRule.PROLONGED_IDLE,
          severity: ComplianceSeverity.MEDIUM,
          message: `Prolonged idle detected (~${Math.round(idle.idleMinutes)} min).`,
          meta: { ...idle, idleRadiusMeters: config.idleRadiusMeters, idleThresholdMinutes: config.idleThresholdMinutes },
        });
      }

      // Rule: start/end window breaches (simulate planned vs actual using breadcrumb times)
      const plannedStart = isoAtLocalHour(day, config.simulatedDayStartHour, 0);
      const plannedEnd = isoAtLocalHour(day, config.simulatedDayStartHour + 8, 0);

      const actualStart = breadcrumbs[0]?.timestamp || plannedStart;
      const actualEnd = breadcrumbs[breadcrumbs.length - 1]?.timestamp || plannedEnd;

      const startDeltaMin = Math.abs((new Date(actualStart).getTime() - new Date(plannedStart).getTime()) / 60000);
      const endDeltaMin = Math.abs((new Date(actualEnd).getTime() - new Date(plannedEnd).getTime()) / 60000);

      if (startDeltaMin > config.startWindowMinutes) {
        pushFlag({
          id: randomId("flag"),
          date: day,
          engineerId: eng.id,
          routeId: route.id,
          rule: ComplianceRule.START_WINDOW_BREACH,
          severity: ComplianceSeverity.LOW,
          message: `Start time breached window (Δ ${Math.round(startDeltaMin)} min).`,
          meta: { plannedStart, actualStart, deltaMinutes: startDeltaMin, thresholdMinutes: config.startWindowMinutes },
        });
      }

      if (endDeltaMin > config.endWindowMinutes) {
        pushFlag({
          id: randomId("flag"),
          date: day,
          engineerId: eng.id,
          routeId: route.id,
          rule: ComplianceRule.END_WINDOW_BREACH,
          severity: ComplianceSeverity.LOW,
          message: `End time breached window (Δ ${Math.round(endDeltaMin)} min).`,
          meta: { plannedEnd, actualEnd, deltaMinutes: endDeltaMin, thresholdMinutes: config.endWindowMinutes },
        });
      }
    });

  // Compute route compliance scores (0..100). Simple penalty model: each low/med/high reduces score.
  routes.forEach((r) => {
    const counts = perRouteFlagCounts[r.id] || { high: 0, medium: 0, low: 0, total: 0 };
    const penalty = counts.high * 35 + counts.medium * 18 + counts.low * 8;
    perRouteScores[r.id] = clamp(100 - penalty, 0, 100);
  });

  const bySeverity = flags.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      acc.total += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0, total: 0 }
  );

  return {
    date: day,
    config: deepClone(config),
    // Breadcrumbs included for map overlay/tooltip use (still dummy and deterministic).
    breadcrumbsByEngineer: Object.fromEntries(breadcrumbsByEngineer.entries()),
    flags,
    bySeverity,
    perEngineerFlagCounts: perEngineerCounts,
    perEngineerSeverityCounts: perEngineerActiveSeverity,
    perEngineerWorstSeverity,
    perRouteComplianceScore: perRouteScores,
    perRouteFlagCounts,
  };
}

function pickWorstSeverity(prev, next) {
  const order = {
    [ComplianceSeverity.HIGH]: 3,
    [ComplianceSeverity.MEDIUM]: 2,
    [ComplianceSeverity.LOW]: 1,
    "": 0,
    undefined: 0,
    null: 0,
  };
  return order[next] > order[prev] ? next : prev;
}

function detectIdle(breadcrumbs, { idleRadiusMeters, idleThresholdMinutes }) {
  if (!breadcrumbs || breadcrumbs.length < 3) return null;

  // Find the longest window where points stay within idleRadius from the first point in that window.
  let best = null;

  for (let i = 0; i < breadcrumbs.length - 2; i += 1) {
    const anchor = { lat: breadcrumbs[i].lat, lng: breadcrumbs[i].lng };
    let lastIdx = i;

    for (let j = i + 1; j < breadcrumbs.length; j += 1) {
      const p = { lat: breadcrumbs[j].lat, lng: breadcrumbs[j].lng };
      if (haversineMeters(anchor, p) <= idleRadiusMeters) {
        lastIdx = j;
      } else {
        break;
      }
    }

    const start = breadcrumbs[i].timestamp;
    const end = breadcrumbs[lastIdx].timestamp;
    const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 60000;

    if (minutes >= idleThresholdMinutes) {
      if (!best || minutes > best.idleMinutes) {
        best = { idleMinutes: minutes, fromTimestamp: start, toTimestamp: end, anchor };
      }
    }
  }

  return best;
}

function interpolatePoint(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function simulateBreadcrumbs({ engineerId, dayIso, route, liveLocation, config }) {
  const seed = hashStringToInt(`${engineerId}_${dayIso}`);
  const rand = mulberry32(seed);

  const startIso = isoAtLocalHour(dayIso, config.simulatedDayStartHour, 0);
  const points = [];

  const count = config.breadcrumbsPerDay;

  const poly = route?.polyline || [];
  const base = poly.length ? poly : liveLocation ? [{ lat: liveLocation.lat, lng: liveLocation.lng }] : [{ lat: 39.8, lng: -98.5 }];

  for (let i = 0; i < count; i += 1) {
    const t = count <= 1 ? 0 : i / (count - 1);

    // Prefer placing points near the planned polyline, with occasional deterministic deviations.
    let plannedPoint;
    if (base.length === 1) {
      plannedPoint = base[0];
    } else {
      const seg = Math.floor(t * (base.length - 1));
      const segT = (t * (base.length - 1)) - seg;
      plannedPoint = interpolatePoint(base[seg], base[Math.min(base.length - 1, seg + 1)], segT);
    }

    // Small jitter (~10-40m) plus rare deviation bursts.
    const jitterMeters = 12 + rand() * 35;
    const angle = rand() * Math.PI * 2;
    const dx = Math.cos(angle) * jitterMeters;
    const dy = Math.sin(angle) * jitterMeters;

    // Convert meters to degrees (approx around latitude)
    const lat0 = (plannedPoint.lat * Math.PI) / 180;
    const metersPerDegLat = 111132.92;
    const metersPerDegLng = 111412.84 * Math.cos(lat0);

    let lat = plannedPoint.lat + dy / metersPerDegLat;
    let lng = plannedPoint.lng + dx / metersPerDegLng;

    // Deterministic "bad behavior" patterns for a subset of engineers
    const behaviorRoll = rand();
    if (behaviorRoll > 0.92 && route?.polyline?.length) {
      // off-route spike: push point away by 300-700m
      const spikeMeters = 300 + rand() * 450;
      const spikeAngle = rand() * Math.PI * 2;
      const sx = Math.cos(spikeAngle) * spikeMeters;
      const sy = Math.sin(spikeAngle) * spikeMeters;
      lat += sy / metersPerDegLat;
      lng += sx / metersPerDegLng;
    }

    // Occasionally create an idle cluster in the middle
    if (i > Math.floor(count * 0.45) && i < Math.floor(count * 0.6) && rand() > 0.86) {
      // freeze near this point
      const freezeCount = Math.min(3, count - i);
      for (let k = 0; k < freezeCount; k += 1) {
        const ts = new Date(startIso);
        ts.setMinutes(ts.getMinutes() + Math.round((i + k) * (480 / Math.max(1, count - 1))));
        points.push({ lat, lng, timestamp: ts.toISOString() });
      }
      // skip ahead
      i += freezeCount - 1;
      continue;
    }

    const ts = new Date(startIso);
    // spread across 8 hours (480 minutes) with small random drift
    const minutes = Math.round(t * 480 + (rand() - 0.5) * 18);
    ts.setMinutes(ts.getMinutes() + minutes);

    points.push({ lat, lng, timestamp: ts.toISOString() });
  }

  // Ensure time ordering
  points.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  return points;
}

/**
 * PUBLIC_INTERFACE
 * Builds "synthetic exceptions" entries suitable for ExceptionsPanel-like UI.
 * This does not mutate tasks; it's an overlay list driven by compliance flags.
 */
export function buildNonComplianceExceptions(scopedState, complianceSnapshot) {
  /** Convert compliance flags to list rows that can be displayed as dashboard exceptions. */
  const flags = complianceSnapshot?.flags || [];
  const users = scopedState?.users || [];
  const routes = scopedState?.routes || [];

  const userById = new Map(users.map((u) => [u.id, u]));
  const routeById = new Map(routes.map((r) => [r.id, r]));

  return flags.map((f) => {
    const eng = userById.get(f.engineerId);
    const rt = routeById.get(f.routeId);
    return {
      id: f.id,
      title: `Non-compliance: ${formatRuleLabel(f.rule)}`,
      type: "non_compliance",
      severity: f.severity,
      engineerId: f.engineerId,
      engineerName: eng?.name || f.engineerId,
      regionId: eng?.regionId || rt?.regionId || "",
      routeId: f.routeId,
      routeName: rt?.name || f.routeId,
      message: f.message,
      rule: f.rule,
      date: f.date,
    };
  });
}

function formatRuleLabel(rule) {
  switch (rule) {
    case ComplianceRule.OFF_ROUTE:
      return "Off-route";
    case ComplianceRule.MISSED_WAYPOINTS:
      return "Missed checkpoints";
    case ComplianceRule.OUT_OF_GEOFENCE:
      return "Out of geo-fence";
    case ComplianceRule.PROLONGED_IDLE:
      return "Prolonged idle";
    case ComplianceRule.START_WINDOW_BREACH:
      return "Start window breach";
    case ComplianceRule.END_WINDOW_BREACH:
      return "End window breach";
    default:
      return rule;
  }
}

/**
 * PUBLIC_INTERFACE
 * Convenience selectors for common dashboard needs.
 */
export function selectActiveFlagsBySeverity(snapshot) {
  /** Returns counts of active flags by severity for the selected day. */
  if (!snapshot) return { high: 0, medium: 0, low: 0, total: 0 };
  return snapshot.bySeverity || { high: 0, medium: 0, low: 0, total: 0 };
}

// PUBLIC_INTERFACE
export function selectPerRouteComplianceScore(snapshot, routeId) {
  /** Returns a 0..100 compliance score for a route. */
  if (!snapshot || !routeId) return 100;
  const v = snapshot.perRouteComplianceScore?.[routeId];
  return Number.isFinite(v) ? v : 100;
}

// PUBLIC_INTERFACE
export function selectPerEngineerFlagCounts(snapshot, engineerId) {
  /** Returns total flag counts for an engineer for the selected day. */
  if (!snapshot || !engineerId) return 0;
  return snapshot.perEngineerFlagCounts?.[engineerId] || 0;
}

// PUBLIC_INTERFACE
export function selectTodayOrDateSummary(fullState, { dateIso = "", config = DEFAULT_COMPLIANCE_CONFIG } = {}) {
  /**
   * Returns a summary for today/selected date.
   * Prefers persisted snapshot if available; otherwise computes without persisting.
   */
  const day = datePrefix(dateIso || nowIso());
  const existing = loadComplianceSnapshot({ dateIso: day });
  if (existing) return existing;
  return computeComplianceSnapshot(fullState, { dateIso: day, config });
}

/**
 * PUBLIC_INTERFACE
 * Helper to ensure compliance is computed once per page load (and persisted),
 * so drill-down modals and other pages remain consistent.
 */
export function ensureComplianceComputed(fullState, { dateIso = "", config = DEFAULT_COMPLIANCE_CONFIG } = {}) {
  /** Ensures there is a persisted snapshot for a date; returns the snapshot. */
  const day = datePrefix(dateIso || nowIso());
  const existing = loadComplianceSnapshot({ dateIso: day });
  if (existing) return existing;
  return computeAndPersistCompliance(fullState, { dateIso: day, config });
}

function deviationDedupeKey(flag) {
  // A stable key (independent of random flag.id) used for short-window de-dupe.
  // Intentionally coarse: same engineer+route+rule+severity within a window is considered “same alert”.
  const eid = flag?.engineerId || "";
  const rid = flag?.routeId || "";
  const rule = flag?.rule || "";
  const sev = flag?.severity || "";
  return `${eid}|${rid}|${rule}|${sev}`;
}

// PUBLIC_INTERFACE
export function detectNewDeviations(prevSnapshot, nextSnapshot, { persistSeen = true, minSeverity = "" } = {}) {
  /**
   * Compares snapshots and returns a list of newly appeared deviation “events”.
   * Uses a persisted “seen” store to avoid repeated popups across refreshes.
   *
   * Returns: Array<{ id, dedupeKey, severity, title, message, engineerId, routeId, rule, occurredAtIso }>
   */
  const prevKeys = new Set((prevSnapshot?.flags || []).map((f) => deviationDedupeKey(f)));
  const nextFlags = nextSnapshot?.flags || [];

  const sevRank = { high: 3, medium: 2, low: 1, "": 0 };
  const minRank = sevRank[minSeverity] || 0;

  const store = loadDeviationSeenStore();
  const seen = store.seen || {};
  const occurredAtIso = nowIso();

  const newEvents = [];

  nextFlags.forEach((f) => {
    const key = deviationDedupeKey(f);
    if (!key) return;
    if (prevKeys.has(key)) return; // not newly appeared in this refresh window
    if ((sevRank[f.severity] || 0) < minRank) return;

    // Don't re-emit if we've already shown this exact dedupeKey today.
    // (We keep it day-scoped by prefixing with date)
    const day = datePrefix(nextSnapshot?.date || nowIso());
    const dayKey = `${day}|${key}`;
    if (seen[dayKey]) return;

    const event = {
      id: f.id, // still useful for drill-down table row targeting
      dedupeKey: key,
      severity: f.severity,
      title: `Route deviation: ${ruleLabel(f.rule)}`,
      message: f.message,
      engineerId: f.engineerId,
      routeId: f.routeId,
      rule: f.rule,
      occurredAtIso,
    };
    newEvents.push(event);

    if (persistSeen) {
      seen[dayKey] = Date.now();
    }
  });

  if (persistSeen) saveDeviationSeenStore({ seen });

  return newEvents;
}

// PUBLIC_INTERFACE
export function selectNonComplianceTrendToday(complianceSnapshot, { now = new Date() } = {}) {
  /**
   * Produces a simple “trend today” indicator based on flag timestamps:
   * since flags are computed and not truly real-time, we approximate by comparing the
   * snapshot's computedAt (or current time) against a “last hour” bucket using occurredAtIso.
   *
   * Returns: { lastHour: number, total: number }
   */
  const flags = complianceSnapshot?.flags || [];
  const total = flags.length;

  // Flags have no native time field; we use computedAt day anchors as approximation.
  // This is deliberately lightweight for dummy data.
  const nowMs = now.getTime();
  const oneHourAgo = nowMs - 60 * 60_000;

  const lastHour = flags.filter((f) => {
    const ts = f?.meta?.fromTimestamp || f?.meta?.actualStart || f?.meta?.actualEnd || "";
    const ms = ts ? new Date(ts).getTime() : NaN;
    if (!Number.isFinite(ms)) return false;
    return ms >= oneHourAgo && ms <= nowMs;
  }).length;

  return { lastHour, total };
}
