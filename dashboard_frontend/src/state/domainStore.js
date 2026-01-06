import {
  engineerAssignments,
  engineerLiveLocations,
  initialStatusHistory,
  regions,
  routes,
  Statuses,
  tasks,
  users,
} from "../data/dummyData";

const STORAGE_KEY = "fod_domain_v1";

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
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

/**
 * Route completion criteria (stricter):
 * A route is considered completed only when:
 *  - All route waypoints/points are covered/visited, AND
 *  - All tasks associated with that route are completed.
 *
 * IMPORTANT:
 * The dummy dataset does not currently provide explicit waypoint-visit events.
 * We therefore interpret "covered/visited" using the existing planned/completed
 * stop counters:
 *   - waypointsCovered is satisfied when completed_stops >= planned_stops
 *   - If planned_stops is 0 or missing, we treat waypoint coverage as NOT satisfied
 *     (conservative default to avoid marking routes complete with missing data).
 *
 * Tasks completeness is evaluated from the tasks list by routeId. If a route has
 * zero tasks, we treat tasks completeness as NOT satisfied (conservative default).
 */
/**
 * PUBLIC_INTERFACE
 * Computes strict route completion criteria for a single route.
 *
 * Completion criteria (strict):
 *  - All route waypoints/points covered (approximated by completed_stops >= planned_stops, and planned_stops > 0), AND
 *  - All tasks associated with that route are completed (and there is at least 1 task).
 *
 * Used by multiple UI components (e.g., RouteCompletionCard, MapPanel) to ensure consistent status logic.
 */
export function computeRouteCompletionCriteriaForRoute(route, tasksList) {
  const plannedStops = Number(route?.planned_stops || 0);
  const completedStops = Number(route?.completed_stops || 0);

  const hasWaypoints = plannedStops > 0;
  const waypointsCovered = hasWaypoints && completedStops >= plannedStops;

  const routeTasks = (tasksList || []).filter((t) => t.routeId === route?.id);
  const hasTasks = routeTasks.length > 0;
  const allTasksCompleted = hasTasks && routeTasks.every((t) => t.status === Statuses.COMPLETED);

  const isCompleted = waypointsCovered && allTasksCompleted;

  return {
    hasWaypoints,
    waypointsCovered,
    plannedStops,
    completedStops,
    hasTasks,
    totalTasks: routeTasks.length,
    completedTasks: routeTasks.filter((t) => t.status === Statuses.COMPLETED).length,
    allTasksCompleted,
    isCompleted,
  };
}

/**
 * PUBLIC_INTERFACE
 * Creates a stable hash string for a set of route waypoints.
 *
 * Input format:
 *  - waypoints: Array of [lon, lat] pairs OR objects like { lng, lat }.
 *
 * Hash strategy:
 *  - Round to 5 decimals (≈ 1.1m precision) to avoid noise.
 *  - Join as "lon,lat;lon,lat;..." string.
 *
 * Used by MapPanel to cache OSRM snapped route polylines and avoid repeated requests.
 */
export function stableWaypointsHash(waypoints, { decimals = 5 } = {}) {
  const d = Number.isFinite(decimals) ? decimals : 5;
  const round = (n) => {
    if (!Number.isFinite(n)) return "";
    // toFixed returns a string; we normalize "-0.00000" to "0.00000"
    const s = Number(n).toFixed(d);
    return s === "-0.00000" ? "0.00000" : s;
  };

  const parts = (waypoints || [])
    .map((p) => {
      const lon = Array.isArray(p) ? p[0] : p?.lng;
      const lat = Array.isArray(p) ? p[1] : p?.lat;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return "";
      return `${round(lon)},${round(lat)}`;
    })
    .filter(Boolean);

  return parts.join(";");
}

/**
 * PUBLIC_INTERFACE
 * Creates a small in-memory LRU cache for session-only use.
 *
 * Notes:
 * - This cache is intentionally NOT persisted to localStorage, to avoid unbounded growth.
 * - Suitable for caching OSRM route responses (decoded polyline lat/lngs).
 */
export function createLruCache(maxEntries = 100) {
  const max = Math.max(1, Number(maxEntries) || 100);
  const map = new Map();

  return {
    /** Gets a cached value and marks it as most-recently-used. */
    get(key) {
      if (!map.has(key)) return undefined;
      const v = map.get(key);
      map.delete(key);
      map.set(key, v);
      return v;
    },

    /** Sets a cached value and evicts least-recently-used entries beyond max. */
    set(key, value) {
      if (!key) return;
      if (map.has(key)) map.delete(key);
      map.set(key, value);

      while (map.size > max) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },

    /** Returns true if key exists (does not update recency). */
    has(key) {
      return map.has(key);
    },

    /** Clears cache. */
    clear() {
      map.clear();
    },

    /** Current size (debugging/diagnostics). */
    size() {
      return map.size();
    },
  };
}

function getDefaultState() {
  return {
    regions: deepClone(regions),
    routes: deepClone(routes).map(computeRouteCompletion),
    users: deepClone(users),
    engineerAssignments: deepClone(engineerAssignments),
    engineerLiveLocations: deepClone(engineerLiveLocations),
    tasks: deepClone(tasks),
    statusHistory: deepClone(initialStatusHistory),

    /**
     * UI event channel (persisted as part of state for simplicity):
     * - MapPanel uses this to briefly highlight routes whose assignment changed.
     * - Shape:
     *   { id: string, routeIds: string[], at: ISO string, reason: string }
     */
    routeChangePulse: null,
  };
}

// PUBLIC_INTERFACE
export function loadDomainState() {
  /** Loads domain state from localStorage (or initializes with default dummy data). */
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw);

    // basic shape guard
    if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.tasks)) return getDefaultState();

    // Migrations / forward-compat: ensure new fields exist
    const next = deepClone(parsed);
    next.routes = (next.routes || []).map((r) => computeRouteCompletion(r));
    next.engineerAssignments = Array.isArray(next.engineerAssignments) ? next.engineerAssignments : [];
    next.statusHistory = Array.isArray(next.statusHistory) ? next.statusHistory : [];
    next.routeChangePulse = next.routeChangePulse || null;

    next.tasks = (next.tasks || []).map((t) => ({
      ...t,
      // Next scheduled due date (read-only). If missing (older localStorage), keep empty string.
      nextDueDate: t.nextDueDate || "",
      // Rescheduled date (read-only). If missing (older localStorage), keep empty string.
      rescheduledDate: t.rescheduledDate || "",
      rejection_reason: t.rejection_reason || "",
      redo_reason: t.redo_reason || "",
      redo_count: Number.isFinite(t.redo_count) ? t.redo_count : 0,
    }));

    return next;
  } catch (e) {
    return getDefaultState();
  }
}

// PUBLIC_INTERFACE
export function saveDomainState(state) {
  /** Persists domain state to localStorage. */
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// PUBLIC_INTERFACE
export function resetDomainState() {
  /** Resets domain state back to defaults (dummy data). */
  const next = getDefaultState();
  saveDomainState(next);
  return next;
}

// PUBLIC_INTERFACE
export function getScopedDomain(state, user) {
  /** Returns a view of domain state scoped by role permissions. */
  if (!user) return null;

  if (user.role === "Admin") return state;

  if (user.role === "Regional Manager") {
    const regionId = user.regionId;
    const scopedUsers = state.users.filter((u) => u.role !== "Field Engineer" || u.regionId === regionId);
    const scopedTasks = state.tasks.filter((t) => t.regionId === regionId);
    const scopedRoutes = state.routes.filter((r) => r.regionId === regionId);
    const scopedAssignments = state.engineerAssignments.filter((a) => {
      const eng = state.users.find((u) => u.id === a.engineerId);
      return eng?.regionId === regionId;
    });
    const scopedLocations = state.engineerLiveLocations.filter((l) => {
      const eng = state.users.find((u) => u.id === l.engineerId);
      return eng?.regionId === regionId;
    });
    const scopedHistory = state.statusHistory.filter((h) => {
      // keep history for tasks in region
      if (h.entityType !== "task") return false;
      const task = state.tasks.find((t) => t.id === h.entityId);
      return task?.regionId === regionId;
    });

    return {
      ...state,
      users: scopedUsers,
      tasks: scopedTasks,
      routes: scopedRoutes,
      engineerAssignments: scopedAssignments,
      engineerLiveLocations: scopedLocations,
      statusHistory: scopedHistory,
    };
  }

  // Field Engineer
  const myTasks = state.tasks.filter((t) => t.engineerId === user.id);
  const myAssignments = state.engineerAssignments.filter((a) => a.engineerId === user.id);
  const myRoutes = state.routes.filter((r) => myAssignments.some((a) => a.routeId === r.id));
  const myLoc = state.engineerLiveLocations.filter((l) => l.engineerId === user.id);
  const myHistory = state.statusHistory.filter((h) => h.entityType === "task" && myTasks.some((t) => t.id === h.entityId));

  const allowedUsers = state.users.filter((u) => u.id === user.id || u.role !== "Field Engineer");
  return {
    ...state,
    users: allowedUsers,
    tasks: myTasks,
    routes: myRoutes,
    engineerAssignments: myAssignments,
    engineerLiveLocations: myLoc,
    statusHistory: myHistory,
  };
}

function computeExceptions(tasksList) {
  const rejected = tasksList.filter((t) => t.status === Statuses.REJECTED).length;
  const redo = tasksList.filter((t) => t.status === Statuses.REDO).length;
  return { rejected, redo, total: rejected + redo };
}

function topReasons(tasksList, { limit = 2 } = {}) {
  // Aggregate common reasons for rejected/redo to surface a short "latest/common reasons" hint per route.
  const counts = new Map();
  tasksList.forEach((t) => {
    const reason = (t.status === Statuses.REJECTED ? t.rejection_reason : t.redo_reason) || "";
    const key = reason.trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}

function computeOverallRouteCompletion(routesList) {
  const totals = routesList.reduce(
    (acc, r) => {
      const planned = Number(r.planned_stops || 0);
      const completed = Number(r.completed_stops || 0);
      acc.planned += planned;
      acc.completed += completed;
      return acc;
    },
    { planned: 0, completed: 0 }
  );

  const pct = totals.planned <= 0 ? 0 : clampPct((totals.completed / totals.planned) * 100);
  return { planned: totals.planned, completed: totals.completed, completionPercent: pct };
}

// PUBLIC_INTERFACE
export function computeRouteStatus(route) {
  /** Returns a derived status for route completion display and map coloring. */
  const p = Number(route.completion_percent || 0);
  if (p >= 95) return { label: "Completed", tone: "success" };
  if (p >= 80) return { label: "On Track", tone: "success" };
  if (p >= 60) return { label: "Behind", tone: "warn" };
  return { label: "At Risk", tone: "error" };
}

// PUBLIC_INTERFACE
export function computeEngineerWorkload(state, { dateIso = "" } = {}) {
  /**
   * Computes workload per engineer. For the dummy app we define load as:
   * - number of tasks due on the given day (or all tasks if dateIso not provided)
   * - plus number of assigned routes (typically 1)
   */
  const datePrefix = dateIso ? dateIso.slice(0, 10) : "";
  const tasksList = state.tasks || [];
  const assignments = state.engineerAssignments || [];

  const taskCounts = new Map();
  tasksList.forEach((t) => {
    if (datePrefix && (t.dueDate || "").slice(0, 10) !== datePrefix) return;
    taskCounts.set(t.engineerId, (taskCounts.get(t.engineerId) || 0) + 1);
  });

  const routeCounts = new Map();
  assignments.forEach((a) => {
    routeCounts.set(a.engineerId, (routeCounts.get(a.engineerId) || 0) + 1);
  });

  const result = {};
  (state.users || [])
    .filter((u) => u.role === "Field Engineer")
    .forEach((u) => {
      result[u.id] = {
        tasksToday: taskCounts.get(u.id) || 0,
        routesAssigned: routeCounts.get(u.id) || 0,
        totalLoad: (taskCounts.get(u.id) || 0) + (routeCounts.get(u.id) || 0),
      };
    });

  return result;
}

// PUBLIC_INTERFACE
export function computeMetrics(scopedState) {
  /** Computes metrics used in dashboard panels from a (possibly scoped) state. */
  const allTasks = scopedState.tasks;
  const total = allTasks.length;

  const byStatus = allTasks.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    },
    {
      [Statuses.ASSIGNED]: 0,
      [Statuses.IN_PROGRESS]: 0,
      [Statuses.COMPLETED]: 0,
      [Statuses.ON_HOLD]: 0,
      [Statuses.POSTPONED]: 0,
      [Statuses.REJECTED]: 0,
      [Statuses.REDO]: 0,
    }
  );

  const completed = byStatus[Statuses.COMPLETED] || 0;
  const completionRate = total === 0 ? 0 : Math.round((completed / total) * 100);

  const engineers = scopedState.users.filter((u) => u.role === "Field Engineer");
  const engineersCount = engineers.length;

  const perRegion = scopedState.regions.map((r) => {
    const regionTasks = allTasks.filter((t) => t.regionId === r.id);
    const regionCompleted = regionTasks.filter((t) => t.status === Statuses.COMPLETED).length;
    return {
      regionId: r.id,
      regionName: r.name,
      tasks: regionTasks.length,
      completed: regionCompleted,
      completionRate: regionTasks.length ? Math.round((regionCompleted / regionTasks.length) * 100) : 0,
    };
  });

  const exceptions = computeExceptions(allTasks);

  const routesOverall = computeOverallRouteCompletion(scopedState.routes || []);
  const completedRoutes = (scopedState.routes || []).filter((r) =>
    computeRouteCompletionCriteriaForRoute(r, scopedState.tasks || []).isCompleted
  ).length;

  return {
    totalTasks: total,
    engineersCount,
    completionRate,
    byStatus,
    perRegion,
    exceptions,
    routesOverall,
    totalRoutes: (scopedState.routes || []).length,
    completedRoutes,
  };
}

function datePrefixFromIso(dateIso) {
  return (dateIso || nowIso()).slice(0, 10);
}

// PUBLIC_INTERFACE
export function computeRouteCompletionSummary(scopedState, { dateIso } = {}) {
  /** Computes overall route completion + a per-route list ordered by most remaining stops. */
  const routesList = scopedState?.routes || [];
  const totals = computeOverallRouteCompletion(routesList);

  const perRoute = routesList
    .map((r) => {
      const planned = Number(r.planned_stops || 0);
      const completed = Number(r.completed_stops || 0);
      const remaining = Math.max(0, planned - completed);
      const completionPercent = planned <= 0 ? 0 : clampPct((completed / planned) * 100);
      return {
        routeId: r.id,
        routeName: r.name,
        regionId: r.regionId,
        planned,
        completed,
        remaining,
        completionPercent,
      };
    })
    .sort((a, b) => b.remaining - a.remaining);

  return {
    date: datePrefixFromIso(dateIso),
    overallCompletionPercent: totals.completionPercent,
    totalPlannedStops: totals.planned,
    totalCompletedStops: totals.completed,
    perRoute,
  };
}

// PUBLIC_INTERFACE
export function computeAllocationSummary(fullState, scopedState, { dateIso } = {}) {
  /**
   * Computes allocation summary based on persisted assignments (fullState),
   * with engineer visibility (scope) derived from scopedState.
   */
  const date = datePrefixFromIso(dateIso);
  const engineersInScope = (scopedState?.users || []).filter((u) => u.role === "Field Engineer");
  const assignments = fullState?.engineerAssignments || [];

  const assignedEngineerIds = new Set(assignments.map((a) => a.engineerId));
  const allocated = engineersInScope.filter((e) => assignedEngineerIds.has(e.id));
  const unallocated = engineersInScope.filter((e) => !assignedEngineerIds.has(e.id));

  const workloadByEngineer = computeEngineerWorkload(fullState, { dateIso: date });
  const avgWorkload =
    engineersInScope.length === 0
      ? 0
      : Math.round(
          engineersInScope.reduce((acc, e) => acc + (workloadByEngineer[e.id]?.totalLoad || 0), 0) / engineersInScope.length
        );

  return {
    date,
    engineersInScopeCount: engineersInScope.length,
    allocatedCount: allocated.length,
    unallocatedCount: unallocated.length,
    unallocatedEngineerIds: unallocated.map((e) => e.id),
    avgWorkloadPerEngineer: avgWorkload,
  };
}

// PUBLIC_INTERFACE
export function computeExceptionsSummary(scopedState, { dateIso } = {}) {
  /** Computes rejected/redo counts (date scoped) plus optional daily counts for a short trend. */
  const date = datePrefixFromIso(dateIso);
  const tasksList = scopedState?.tasks || [];

  const tasksToday = tasksList.filter((t) => (t.dueDate || "").slice(0, 10) === date);
  const today = computeExceptions(tasksToday);

  // Simple 7-day trend by dueDate (counts per day). Used only if UI opts to show it.
  const trendDays = 7;
  const trend = [];
  for (let i = trendDays - 1; i >= 0; i -= 1) {
    const d = new Date(date);
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    const dayTasks = tasksList.filter((t) => (t.dueDate || "").slice(0, 10) === day);
    const dayExceptions = computeExceptions(dayTasks);
    trend.push({ date: day, total: dayExceptions.total, rejected: dayExceptions.rejected, redo: dayExceptions.redo });
  }

  return { date, today, trend };
}

// PUBLIC_INTERFACE
export function selectTasksDueOnDate(scopedState, { dateIso } = {}) {
  /**
   * Returns tasks scoped to the provided state and filtered to tasks due on the given date.
   * dateIso can be a full ISO string; only the YYYY-MM-DD prefix is used.
   */
  const date = datePrefixFromIso(dateIso);
  const tasksList = scopedState?.tasks || [];
  return tasksList.filter((t) => (t.dueDate || "").slice(0, 10) === date);
}

// PUBLIC_INTERFACE
export function selectTaskCountsByStatus(scopedState, { dateIso } = {}) {
  /**
   * Computes date-scoped task counts using the canonical Statuses definitions.
   * This is intended to keep KPI cards consistent across the app.
   *
   * Counts returned:
   *  - completed: status === COMPLETED
   *  - rejected: status === REJECTED
   *  - redo: status === REDO
   */
  const tasksToday = selectTasksDueOnDate(scopedState, { dateIso });

  const completed = tasksToday.filter((t) => t.status === Statuses.COMPLETED).length;
  const rejected = tasksToday.filter((t) => t.status === Statuses.REJECTED).length;
  const redo = tasksToday.filter((t) => t.status === Statuses.REDO).length;

  return {
    date: datePrefixFromIso(dateIso),
    completed,
    rejected,
    redo,
  };
}

// PUBLIC_INTERFACE
export function computeRouteCompletionWithExceptionsSummary(scopedState, { dateIso, complianceSnapshot = null } = {}) {
  /**
   * Computes per-route completion + exceptions (rejected/redo) and non-compliance counts for the selected date/scope.
   * Intended for the merged dashboard Route Completion card and unified drill-down table.
   *
   * - Exceptions are task statuses: Rejected, Redo (date-scoped by dueDate)
   * - Non-compliance is driven by complianceSnapshot flags (date-scoped by snapshot.date)
   */
  const date = datePrefixFromIso(dateIso);
  const routesList = scopedState?.routes || [];
  const tasksList = scopedState?.tasks || [];

  const tasksToday = tasksList.filter((t) => (t.dueDate || "").slice(0, 10) === date);

  // Map: routeId -> tasksToday[]
  const tasksByRoute = new Map();
  tasksToday.forEach((t) => {
    if (!t.routeId) return;
    if (!tasksByRoute.has(t.routeId)) tasksByRoute.set(t.routeId, []);
    tasksByRoute.get(t.routeId).push(t);
  });

  const flags = complianceSnapshot?.flags || [];
  const flagsToday = flags.filter((f) => (f.date || "").slice(0, 10) === date);

  // Map: routeId -> compliance flags
  const flagsByRoute = new Map();
  flagsToday.forEach((f) => {
    if (!f.routeId) return;
    if (!flagsByRoute.has(f.routeId)) flagsByRoute.set(f.routeId, []);
    flagsByRoute.get(f.routeId).push(f);
  });

  const totals = computeOverallRouteCompletion(routesList);

  const totalsExceptions = computeExceptions(tasksToday);
  const totalsNonCompliance = flagsToday.length;

  const perRoute = routesList
    .map((r) => {
      const planned = Number(r.planned_stops || 0);
      const completed = Number(r.completed_stops || 0);
      const remaining = Math.max(0, planned - completed);
      const completionPercent = planned <= 0 ? 0 : clampPct((completed / planned) * 100);

      const routeTasks = tasksByRoute.get(r.id) || [];
      const rejectedTasks = routeTasks.filter((t) => t.status === Statuses.REJECTED);
      const redoTasks = routeTasks.filter((t) => t.status === Statuses.REDO);

      const routeFlags = flagsByRoute.get(r.id) || [];
      const nonComplianceCount = routeFlags.length;

      // Worst severity and "latest reasons" hints.
      const sevRank = { high: 3, medium: 2, low: 1 };
      const worstComplianceSeverity = routeFlags.reduce((acc, f) => {
        if (!acc) return f.severity || "";
        return (sevRank[f.severity] || 0) > (sevRank[acc] || 0) ? f.severity : acc;
      }, "");

      return {
        routeId: r.id,
        routeName: r.name,
        regionId: r.regionId,
        planned,
        completed,
        remaining,
        completionPercent,
        completionStatus: computeRouteStatus({ completion_percent: completionPercent }),
        exceptions: {
          rejected: rejectedTasks.length,
          redo: redoTasks.length,
          total: rejectedTasks.length + redoTasks.length,
          topReasons: topReasons([...rejectedTasks, ...redoTasks], { limit: 2 }),
        },
        compliance: {
          nonComplianceCount,
          worstSeverity: worstComplianceSeverity,
          // show up to 2 latest messages as a "reason" hint
          latestMessages: routeFlags
            .slice()
            .sort((a, b) => String(b.id || "").localeCompare(String(a.id || "")))
            .slice(0, 2)
            .map((f) => ({ severity: f.severity, message: f.message, rule: f.rule })),
        },
      };
    })
    .sort((a, b) => {
      // Default sort: most exceptions+noncompliance first, then lowest completion
      const ax = (a.exceptions.total || 0) + (a.compliance.nonComplianceCount || 0);
      const bx = (b.exceptions.total || 0) + (b.compliance.nonComplianceCount || 0);
      if (bx !== ax) return bx - ax;
      return Number(a.completionPercent || 0) - Number(b.completionPercent || 0);
    });

  return {
    date,
    overallCompletionPercent: totals.completionPercent,
    totalPlannedStops: totals.planned,
    totalCompletedStops: totals.completed,
    totals: {
      exceptions: totalsExceptions,
      nonCompliance: totalsNonCompliance,
    },
    perRoute,
  };
}

//
//
// Route Completion-only selector (separated from exceptions/compliance).
//

/**
 * Route completion is considered true ONLY when:
 *  - all waypoints (represented by planned_stops) are covered, AND
 *  - all tasks for that route are completed.
 *
 * NOTE: We keep this definition in selectors so UI stays consistent.
 */

// PUBLIC_INTERFACE
export function computeRouteCompletionMinimalMetrics(scopedState) {
  /**
   * Computes minimal route completion metrics for dashboard display:
   * - routes completed (count)
   * - routes remaining (count)
   * - overall completion percent (based on route counts)
   *
   * Completion criteria (stricter):
   * A route is "completed" only if:
   *   - completed_stops >= planned_stops (and planned_stops > 0), AND
   *   - all tasks for that route are status === completed (and there is at least 1 task).
   *
   * IMPORTANT:
   * For the simplified RouteCompletionCard, the overall % must align with the displayed counts:
   *   total_routes = completed_routes + remaining_routes
   *   completion_pct = round((completed_routes / total_routes) * 100)
   */
  const routesList = scopedState?.routes || [];
  const tasksList = scopedState?.tasks || [];
  const totalRoutes = routesList.length;

  const completedRoutes = routesList.filter((r) => computeRouteCompletionCriteriaForRoute(r, tasksList).isCompleted).length;
  const remainingRoutes = Math.max(0, totalRoutes - completedRoutes);

  const denom = completedRoutes + remainingRoutes;
  const overallCompletionPercent = denom <= 0 ? 0 : clampPct((completedRoutes / denom) * 100);

  return {
    totalRoutes,
    completedRoutes,
    remainingRoutes,
    overallCompletionPercent,
  };
}

// PUBLIC_INTERFACE
export function computeRouteCompletionOnlySummary(scopedState, { dateIso } = {}) {
  /**
   * Computes per-route completion metrics only (no rejected/redo or compliance).
   * Used by the dedicated Route Completion dashboard card and any completion-only drill-down.
   */
  return computeRouteCompletionSummary(scopedState, { dateIso });
}

// PUBLIC_INTERFACE
export function computeDprSnapshot(state, user, { dateIso } = {}) {
  /** Small KPI subset for dashboard DPR card (planned vs completed, on-hold, postponed). */
  const date = datePrefixFromIso(dateIso);
  const scoped = getScopedDomain(state, user) || state;

  const tasksToday = (scoped.tasks || []).filter((t) => (t.dueDate || "").slice(0, 10) === date);

  const planned = tasksToday.length;
  const completed = tasksToday.filter((t) => t.status === Statuses.COMPLETED).length;
  const onHold = tasksToday.filter((t) => t.status === Statuses.ON_HOLD).length;
  const postponed = tasksToday.filter((t) => t.status === Statuses.POSTPONED).length;

  return { date, planned, completed, onHold, postponed };
}

function safeReadJsonLocalStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeWriteJsonLocalStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op: localStorage may be blocked; trend will fallback to neutral
  }
}

function isValidLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

function minutesBetweenIso(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.abs(b - a) / 60000;
}

/**
 * PUBLIC_INTERFACE
 * Computes dashboard "Engineer Allocation" metrics.
 *
 * Definitions (aligned to the request and dummy data model):
 * - Total Engineers: count of Field Engineers in current scope.
 * - Allocated: engineers assigned to a route (via engineerAssignments).
 * - Active / On Duty:
 *    Prefer any explicit status field if present on engineer user record; otherwise:
 *    treat engineers with an assignment OR tasks due today as "on duty".
 * - Idle: on duty but not allocated.
 * - Utilization: Allocated / Active (%).
 * - Status breakdown:
 *    Uses current assignment + inferred idle/offline. Paused uses a best-effort heuristic:
 *    If engineer has ON_HOLD tasks due today, treat as Paused.
 * - Deviations: count of compliance flags for today in the provided snapshot.
 * - GPS Issues: count engineers with missing/invalid coords OR stale location (default >5 min),
 *    also counts as GPS issue if there are compliance flags containing "gps" in rule/message.
 *
 * Trend indicator:
 * - Stores last utilization value in localStorage and compares to current.
 * - If increased: show up arrow, if decreased: down arrow, else neutral.
 */
export function computeEngineerAllocationSummary(
  scopedState,
  { dateIso = "", complianceSnapshot = null, persistTrend = true, gpsStaleMinutes = 5 } = {}
) {
  /** Computes Engineer Allocation metrics for the current scope. */
  const date = datePrefixFromIso(dateIso);

  const engineers = (scopedState?.users || []).filter((u) => u.role === "Field Engineer");
  const totalEngineers = engineers.length;

  const assignments = scopedState?.engineerAssignments || [];
  const assignedEngineerIds = new Set(assignments.map((a) => a.engineerId));

  const tasksToday = (scopedState?.tasks || []).filter((t) => (t.dueDate || "").slice(0, 10) === date);

  // Active/on duty (best-effort, given dummy schema)
  const onDutyEngineerIds = new Set();
  engineers.forEach((e) => {
    // Prefer explicit flag if the dummy dataset introduces it later.
    const explicit =
      e.isOnDuty === true ||
      e.onDuty === true ||
      String(e.shiftStatus || "").toLowerCase() === "on_duty" ||
      String(e.shiftStatus || "").toLowerCase() === "on duty";

    const hasAssignment = assignedEngineerIds.has(e.id);
    const hasTasksToday = tasksToday.some((t) => t.engineerId === e.id);

    if (explicit || hasAssignment || hasTasksToday) onDutyEngineerIds.add(e.id);
  });

  const activeOnDuty = onDutyEngineerIds.size;
  const allocated = engineers.filter((e) => assignedEngineerIds.has(e.id)).length;
  const idle = Math.max(0, activeOnDuty - allocated);

  const utilization = activeOnDuty <= 0 ? 0 : clampPct((allocated / activeOnDuty) * 100);

  // Status breakdown (best-effort):
  // - Offline: no valid location OR stale beyond threshold
  // - On Route: allocated AND not offline AND not paused
  // - Paused: on duty AND has any ON_HOLD tasks today (heuristic)
  // - Idle: on duty AND not allocated AND not offline
  const locations = scopedState?.engineerLiveLocations || [];
  const locByEngineerId = new Map(locations.map((l) => [l.engineerId, l]));

  const isOffline = (engineerId) => {
    const loc = locByEngineerId.get(engineerId);
    if (!loc) return true;
    if (!isValidLatLng(loc.lat, loc.lng)) return true;

    // lastUpdated isn't in current dummy schema; try common fields; fallback to not stale.
    const ts = loc.lastUpdated || loc.updatedAt || loc.timestamp || "";
    if (!ts) return false;

    const mins = minutesBetweenIso(ts, new Date().toISOString());
    if (!Number.isFinite(mins)) return false;
    return mins > gpsStaleMinutes;
  };

  const isPaused = (engineerId) => {
    // Heuristic: any on-hold tasks today => paused
    return tasksToday.some((t) => t.engineerId === engineerId && t.status === Statuses.ON_HOLD);
  };

  let onRoute = 0;
  let paused = 0;
  let idleStatus = 0;
  let offline = 0;

  engineers.forEach((e) => {
    const offlineNow = isOffline(e.id);
    const onDuty = onDutyEngineerIds.has(e.id);
    const allocatedNow = assignedEngineerIds.has(e.id);

    if (offlineNow) {
      offline += 1;
      return;
    }

    if (onDuty && isPaused(e.id)) {
      paused += 1;
      return;
    }

    if (allocatedNow) {
      onRoute += 1;
      return;
    }

    if (onDuty) {
      idleStatus += 1;
      return;
    }

    // Not on duty but also not offline: treat as offline-ish for display? Spec wants Offline row;
    // but we keep "offline" strictly GPS/offline and leave others uncounted.
  });

  // Alerts
  const deviations = (complianceSnapshot?.flags || []).filter((f) => (f.date || "").slice(0, 10) === date).length;

  // GPS issues:
  // - missing/invalid coords
  // - stale based on timestamp fields (if present)
  // - OR compliance flags whose rule/message mention gps
  const gpsFlagEngineerIds = new Set(
    (complianceSnapshot?.flags || [])
      .filter((f) => (f.date || "").slice(0, 10) === date)
      .filter(
        (f) => String(f.rule || "").toLowerCase().includes("gps") || String(f.message || "").toLowerCase().includes("gps")
      )
      .map((f) => f.engineerId)
      .filter(Boolean)
  );

  const gpsIssuesEngineerIds = new Set();
  engineers.forEach((e) => {
    const loc = locByEngineerId.get(e.id);
    if (!loc) {
      gpsIssuesEngineerIds.add(e.id);
      return;
    }
    if (!isValidLatLng(loc.lat, loc.lng)) {
      gpsIssuesEngineerIds.add(e.id);
      return;
    }
    const ts = loc.lastUpdated || loc.updatedAt || loc.timestamp || "";
    if (ts) {
      const mins = minutesBetweenIso(ts, new Date().toISOString());
      if (Number.isFinite(mins) && mins > gpsStaleMinutes) gpsIssuesEngineerIds.add(e.id);
    }
  });

  gpsFlagEngineerIds.forEach((id) => gpsIssuesEngineerIds.add(id));
  const gpsIssues = gpsIssuesEngineerIds.size;

  // Trend persistence for utilization
  const TREND_KEY = `fod_utilization_trend_${date}`;
  const prev = safeReadJsonLocalStorage(TREND_KEY);
  const prevValue = Number(prev?.value);
  let trend = "neutral"; // up | down | neutral
  if (Number.isFinite(prevValue)) {
    if (utilization > prevValue) trend = "up";
    else if (utilization < prevValue) trend = "down";
  }

  if (persistTrend) safeWriteJsonLocalStorage(TREND_KEY, { value: utilization, at: new Date().toISOString() });

  return {
    date,
    totals: {
      totalEngineers,
      activeOnDuty,
      allocated,
      idle,
      utilizationPercent: utilization,
      utilizationTrend: trend,
    },
    status: {
      onRoute,
      paused,
      idle: idleStatus,
      offline,
    },
    alerts: {
      deviations,
      gpsIssues,
    },
  };
}

// PUBLIC_INTERFACE
export function selectEngineerAllocationCounts(scopedState, { dateIso = "" } = {}) {
  /**
   * Simplified selector for Engineer Allocation card.
   *
   * Returns:
   *  - totalEngineers: number of field engineers in scope
   *  - activeCount: on-duty/online engineers (best-effort)
   *  - inactiveCount: off-duty/offline engineers (best-effort)
   *
   * Implementation notes (dummy data):
   *  - If engineerLiveLocations has an entry for an engineer with valid lat/lng -> treat as "online".
   *  - If there is an explicit on-duty flag on the user record -> treat as active.
   *  - If assigned to a route OR has a task due on the selected date -> treat as active.
   *  - Otherwise inactive.
   */
  const date = datePrefixFromIso(dateIso);
  const engineers = (scopedState?.users || []).filter((u) => u.role === "Field Engineer");
  const totalEngineers = engineers.length;

  const assignments = scopedState?.engineerAssignments || [];
  const assignedEngineerIds = new Set(assignments.map((a) => a.engineerId));

  const tasksToday = (scopedState?.tasks || []).filter((t) => (t.dueDate || "").slice(0, 10) === date);

  const locations = scopedState?.engineerLiveLocations || [];
  const locByEngineerId = new Map(locations.map((l) => [l.engineerId, l]));

  const isOnline = (engineerId) => {
    const loc = locByEngineerId.get(engineerId);
    if (!loc) return false;
    return isValidLatLng(loc.lat, loc.lng);
  };

  let activeCount = 0;

  engineers.forEach((e) => {
    const explicit =
      e.isOnDuty === true ||
      e.onDuty === true ||
      String(e.shiftStatus || "").toLowerCase() === "on_duty" ||
      String(e.shiftStatus || "").toLowerCase() === "on duty";

    const hasAssignment = assignedEngineerIds.has(e.id);
    const hasTasksToday = tasksToday.some((t) => t.engineerId === e.id);

    // "Active should represent on-duty/online engineers"
    const active = explicit || isOnline(e.id) || hasAssignment || hasTasksToday;

    if (active) activeCount += 1;
  });

  const inactiveCount = Math.max(0, totalEngineers - activeCount);

  return { totalEngineers, activeCount, inactiveCount, date };
}

// PUBLIC_INTERFACE
export function updateTaskStatus(state, { taskId, toStatus, reason, actorUserId }) {
  /**
   * Updates task status and appends a status history record.
   * For on_hold/postponed/rejected/redo a reason is required.
   */
  const needsReason =
    toStatus === Statuses.ON_HOLD ||
    toStatus === Statuses.POSTPONED ||
    toStatus === Statuses.REJECTED ||
    toStatus === Statuses.REDO;

  if (needsReason && (!reason || reason.trim().length < 3)) {
    return { ok: false, error: "Reason is required (min 3 characters)." };
  }

  const taskIndex = state.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) return { ok: false, error: "Task not found." };

  const next = deepClone(state);
  const prevStatus = next.tasks[taskIndex].status;

  next.tasks[taskIndex].status = toStatus;

  if (toStatus === Statuses.REJECTED) {
    next.tasks[taskIndex].rejection_reason = reason?.trim() || "";
  }
  if (toStatus === Statuses.REDO) {
    next.tasks[taskIndex].redo_reason = reason?.trim() || "";
    next.tasks[taskIndex].redo_count = (next.tasks[taskIndex].redo_count || 0) + 1;
  }

  // If redo is marked completed, clear redo reason.
  if (prevStatus === Statuses.REDO && toStatus === Statuses.COMPLETED) {
    next.tasks[taskIndex].redo_reason = "";
  }

  next.statusHistory.unshift({
    id: randomId("h"),
    entityType: "task",
    entityId: taskId,
    toStatus,
    reason: reason?.trim() || "",
    timestamp: nowIso(),
    actorUserId,
  });

  saveDomainState(next);
  return { ok: true, state: next };
}

/**
 * PUBLIC_INTERFACE
 * Resolve an engineer/user display name by id, using the provided (scoped) domain state.
 *
 * Notes:
 * - In scope-restricted views, the engineer may not be present in scopedState.users;
 *   in that case this returns the id as a fallback.
 */
// PUBLIC_INTERFACE
export function selectEngineerNameById(scopedState, engineerId) {
  /** Returns a friendly engineer name, or a fallback string when missing. */
  if (!engineerId) return "";
  const u = (scopedState?.users || []).find((x) => x.id === engineerId);
  return u?.name || engineerId;
}

/**
 * PUBLIC_INTERFACE
 * Formats an ISO timestamp (or Date-parsable value) into a short local datetime.
 *
 * Example output (depends on locale):
 * - "Jan 6, 3:42 PM"
 * - "06 Jan, 15:42"
 */
// PUBLIC_INTERFACE
export function formatTimestampShortLocal(ts) {
  /** Formats a timestamp for compact UI display. */
  if (!ts) return "";
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "";

  try {
    // Compact, locale-aware; keep it short for popup layout.
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    // Fallback: "YYYY-MM-DD HH:MM"
    const iso = d.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
}

/**
 * PUBLIC_INTERFACE
 * Collects compact, route-level comments/notes for a given date from persisted task state + status history.
 *
 * This is used by MapPanel route click popups to show engineer/task comments (hold reasons, rejection/redo notes).
 *
 * What is considered a “comment”:
 * - statusHistory reasons for task transitions to: on_hold, postponed, rejected, redo
 * - task.rejection_reason for tasks currently rejected
 * - task.redo_reason for tasks currently in redo
 *
 * Filtering:
 * - Only tasks belonging to the given routeId
 * - Only items whose timestamp/dueDate matches the YYYY-MM-DD prefix of dateIso (defaults to “today”)
 *
 * Return shape:
 * - id, taskId, type, timestamp, text
 */
export function selectRouteCommentsForDate(scopedState, { routeId, dateIso } = {}) {
  const date = datePrefixFromIso(dateIso);
  if (!scopedState || !routeId) return [];

  const tasksForRoute = (scopedState.tasks || []).filter((t) => t.routeId === routeId);
  if (tasksForRoute.length === 0) return [];

  const tasksById = new Map(tasksForRoute.map((t) => [t.id, t]));

  const commentItems = [];

  // 1) History-based reasons (today only)
  const allowed = new Set([Statuses.ON_HOLD, Statuses.POSTPONED, Statuses.REJECTED, Statuses.REDO]);
  (scopedState.statusHistory || [])
    .filter((h) => h?.entityType === "task" && tasksById.has(h.entityId))
    .filter((h) => allowed.has(h.toStatus))
    .filter((h) => String(h.timestamp || "").slice(0, 10) === date)
    .forEach((h) => {
      const reason = String(h.reason || "").trim();
      if (!reason) return;
      commentItems.push({
        id: h.id || `${h.entityId}_${h.toStatus}_${h.timestamp || ""}`,
        taskId: h.entityId,
        type: h.toStatus,
        timestamp: h.timestamp || "",
        text: reason,
      });
    });

  // 2) Task-record notes for tasks due today (so popups still show useful notes even if history isn’t “today”)
  tasksForRoute
    .filter((t) => String(t.dueDate || "").slice(0, 10) === date)
    .forEach((t) => {
      const rej = String(t.rejection_reason || "").trim();
      const redo = String(t.redo_reason || "").trim();

      if (t.status === Statuses.REJECTED && rej) {
        commentItems.push({
          id: `task_${t.id}_rejection_reason`,
          taskId: t.id,
          type: Statuses.REJECTED,
          timestamp: "",
          text: rej,
        });
      }

      if (t.status === Statuses.REDO && redo) {
        commentItems.push({
          id: `task_${t.id}_redo_reason`,
          taskId: t.id,
          type: Statuses.REDO,
          timestamp: "",
          text: redo,
        });
      }
    });

  // De-dupe by text+type to keep section compact.
  const seen = new Set();
  const deduped = [];
  commentItems.forEach((c) => {
    const key = `${c.type}::${c.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(c);
  });

  // Sort: most recent timestamps first; then stable by id.
  deduped.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")) || String(a.id).localeCompare(String(b.id)));

  return deduped;
}

/**
 * PUBLIC_INTERFACE
 * Route popup-specific selector:
 * returns route comments enriched with engineer name + formatted timestamp.
 *
 * If a comment doesn't have a direct engineerId, we infer it from the owning task.
 *
 * Return shape:
 * - id, taskId, type, text
 * - timestamp (raw ISO if present)
 * - timestampLabel (short local string, if possible)
 * - engineerId (inferred if possible)
 * - engineerName (resolved via users list, fallback to id)
 */
// PUBLIC_INTERFACE
export function selectRouteCommentsWithMetaForDate(scopedState, { routeId, dateIso } = {}) {
  /** Enriches route comments with engineer + local short timestamp labels for UI. */
  const base = selectRouteCommentsForDate(scopedState, { routeId, dateIso });
  if (!Array.isArray(base) || base.length === 0) return [];

  const taskById = new Map((scopedState?.tasks || []).map((t) => [t.id, t]));

  return base.map((c) => {
    const t = c?.taskId ? taskById.get(c.taskId) : null;

    const engineerId = c.engineerId || t?.engineerId || "";
    const engineerName = engineerId ? selectEngineerNameById(scopedState, engineerId) : "";
    const timestampLabel = c.timestamp ? formatTimestampShortLocal(c.timestamp) : "";

    return {
      ...c,
      engineerId,
      engineerName,
      timestampLabel,
    };
  });
}

/**
 * PUBLIC_INTERFACE
 * Computes assignment maps for UI usage:
 * - engineerToRoute: { [engineerId]: routeId }
 * - routeToEngineers: { [routeId]: engineerId[] }
 */
// PUBLIC_INTERFACE
export function selectAssignmentMaps(stateOrScopedState) {
  /** Returns engineer->route and route->engineers maps derived from engineerAssignments. */
  const assignments = stateOrScopedState?.engineerAssignments || [];
  const engineerToRoute = {};
  const routeToEngineers = {};
  assignments.forEach((a) => {
    if (!a?.engineerId) return;
    if (a.routeId) engineerToRoute[a.engineerId] = a.routeId;
    if (a.routeId) {
      if (!routeToEngineers[a.routeId]) routeToEngineers[a.routeId] = [];
      routeToEngineers[a.routeId].push(a.engineerId);
    }
  });
  return { engineerToRoute, routeToEngineers };
}

/**
 * PUBLIC_INTERFACE
 * Returns engineer IDs assigned to a given route (for popups/context).
 */
// PUBLIC_INTERFACE
export function selectEngineerIdsForRoute(stateOrScopedState, routeId) {
  /** Returns an array of engineerIds assigned to the specified routeId. */
  if (!routeId) return [];
  const assignments = stateOrScopedState?.engineerAssignments || [];
  return assignments.filter((a) => a.routeId === routeId).map((a) => a.engineerId);
}

/**
 * PUBLIC_INTERFACE
 * Assigns an engineer to a route, persisting the update.
 *
 * Behavior:
 * - One active route per engineer (replaces previous).
 * - Returns { ok, state, changedRouteIds } so callers can trigger map highlight/refresh.
 */
// PUBLIC_INTERFACE
export function assignRouteToEngineer(state, { engineerId, routeId }) {
  /** Assigns engineerId to routeId (replaces prior assignment if any). */
  if (!engineerId) return { ok: false, error: "Missing engineerId." };
  if (!routeId) return { ok: false, error: "Missing routeId." };

  const next = deepClone(state);
  next.engineerAssignments = Array.isArray(next.engineerAssignments) ? next.engineerAssignments : [];

  const prev = next.engineerAssignments.find((a) => a.engineerId === engineerId);
  const prevRouteId = prev?.routeId || "";

  // If no change, do nothing (avoid unnecessary highlight pulses)
  if (prevRouteId === routeId) {
    return { ok: true, state: next, changedRouteIds: [] };
  }

  // Remove any existing assignment(s) for that engineer (keep simple: 1 active route).
  next.engineerAssignments = next.engineerAssignments.filter((a) => a.engineerId !== engineerId);
  next.engineerAssignments.push({ engineerId, routeId });

  const changedRouteIds = [prevRouteId, routeId].filter(Boolean);

  // Pulse used by MapPanel for temporary route highlight and OSRM cache refresh.
  next.routeChangePulse = {
    id: randomId("pulse"),
    routeIds: changedRouteIds,
    at: nowIso(),
    reason: "assignment_changed",
  };

  saveDomainState(next);
  return { ok: true, state: next, changedRouteIds };
}

/**
 * PUBLIC_INTERFACE
 * Unassigns an engineer from their current route, persisting the update.
 *
 * Returns { ok, state, changedRouteIds } so callers can trigger map highlight/refresh.
 */
// PUBLIC_INTERFACE
export function unassignRouteFromEngineer(state, { engineerId }) {
  /** Unassigns engineerId from any route. */
  if (!engineerId) return { ok: false, error: "Missing engineerId." };

  const next = deepClone(state);
  next.engineerAssignments = Array.isArray(next.engineerAssignments) ? next.engineerAssignments : [];

  const prev = next.engineerAssignments.find((a) => a.engineerId === engineerId);
  const prevRouteId = prev?.routeId || "";

  // If not assigned, no-op
  if (!prevRouteId) {
    return { ok: true, state: next, changedRouteIds: [] };
  }

  next.engineerAssignments = next.engineerAssignments.filter((a) => a.engineerId !== engineerId);

  const changedRouteIds = [prevRouteId].filter(Boolean);
  next.routeChangePulse = {
    id: randomId("pulse"),
    routeIds: changedRouteIds,
    at: nowIso(),
    reason: "assignment_changed",
  };

  saveDomainState(next);
  return { ok: true, state: next, changedRouteIds };
}

// PUBLIC_INTERFACE
export function allocateEngineerToRoute(state, { engineerId, routeId }) {
  /** Assign/unassign engineer to a route. If routeId is empty, unassign. */
  if (!engineerId) return { ok: false, error: "Missing engineerId." };

  if (!routeId) return unassignRouteFromEngineer(state, { engineerId });
  return assignRouteToEngineer(state, { engineerId, routeId });
}

// PUBLIC_INTERFACE
export function computeDpr(state, user, { dateIso }) {
  /**
   * Daily Progress Report (client-side aggregation).
   * dateIso should be 'YYYY-MM-DD' (or a full ISO string; only date is used).
   */
  const date = (dateIso || nowIso()).slice(0, 10);
  const scoped = getScopedDomain(state, user) || state;

  const tasksToday = (scoped.tasks || []).filter((t) => (t.dueDate || "").slice(0, 10) === date);
  const completedTasksToday = tasksToday.filter((t) => t.status === Statuses.COMPLETED).length;
  const exceptionsToday = computeExceptions(tasksToday);

  const routesList = scoped.routes || [];
  const completedRoutes = routesList.filter((r) => computeRouteCompletionCriteriaForRoute(r, scoped.tasks || []).isCompleted).length;
  const routesOverall = computeOverallRouteCompletion(routesList);

  // Engineer performance (within scope)
  const workloadByEngineer = computeEngineerWorkload(scoped, { dateIso: date });
  const engineerRows = (scoped.users || [])
    .filter((u) => u.role === "Field Engineer")
    .map((u) => {
      const engTasks = tasksToday.filter((t) => t.engineerId === u.id);
      const engCompleted = engTasks.filter((t) => t.status === Statuses.COMPLETED).length;
      return {
        engineerId: u.id,
        engineerName: u.name,
        regionId: u.regionId || "",
        tasks: engTasks.length,
        completed: engCompleted,
        completionRate: engTasks.length ? clampPct((engCompleted / engTasks.length) * 100) : 0,
        load: workloadByEngineer[u.id]?.totalLoad || 0,
      };
    })
    .sort((a, b) => b.tasks - a.tasks);

  const perRegion = (scoped.regions || []).map((r) => {
    const regionRoutes = routesList.filter((rt) => rt.regionId === r.id);
    const regionTasks = tasksToday.filter((t) => t.regionId === r.id);
    const regionCompletedTasks = regionTasks.filter((t) => t.status === Statuses.COMPLETED).length;
    const regionExceptions = computeExceptions(regionTasks);
    const regionRouteOverall = computeOverallRouteCompletion(regionRoutes);
    const regionCompletedRoutes = regionRoutes.filter((rt) =>
      computeRouteCompletionCriteriaForRoute(rt, tasksToday).isCompleted
    ).length;

    return {
      regionId: r.id,
      regionName: r.name,
      totalRoutes: regionRoutes.length,
      completedRoutes: regionCompletedRoutes,
      routeCompletionPercent: regionRouteOverall.completionPercent,
      totalTasks: regionTasks.length,
      completedTasks: regionCompletedTasks,
      taskCompletionPercent: regionTasks.length ? clampPct((regionCompletedTasks / regionTasks.length) * 100) : 0,
      exceptions: regionExceptions.total,
    };
  });

  return {
    date,
    kpis: {
      totalRoutes: routesList.length,
      completedRoutes,
      overallRouteCompletionPercent: routesOverall.completionPercent,
      totalTasks: tasksToday.length,
      completedTasks: completedTasksToday,
      exceptions: exceptionsToday.total,
      rejected: exceptionsToday.rejected,
      redo: exceptionsToday.redo,
    },
    routesSummary: routesList.map((r) => ({
      routeId: r.id,
      routeName: r.name,
      regionId: r.regionId,
      planned: Number(r.planned_stops || 0),
      completed: Number(r.completed_stops || 0),
      completionPercent: Number(r.completion_percent || 0),
    })),
    engineerPerformance: engineerRows,
    exceptions: tasksToday
      .filter((t) => t.status === Statuses.REJECTED || t.status === Statuses.REDO)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        engineerId: t.engineerId,
        regionId: t.regionId,
        routeId: t.routeId,
        status: t.status,
        rejection_reason: t.rejection_reason || "",
        redo_reason: t.redo_reason || "",
        redo_count: t.redo_count || 0,
      })),
    perRegion,
  };
}
