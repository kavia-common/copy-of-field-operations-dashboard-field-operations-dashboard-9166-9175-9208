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

function getDefaultState() {
  return {
    regions: deepClone(regions),
    routes: deepClone(routes).map(computeRouteCompletion),
    users: deepClone(users),
    engineerAssignments: deepClone(engineerAssignments),
    engineerLiveLocations: deepClone(engineerLiveLocations),
    tasks: deepClone(tasks),
    statusHistory: deepClone(initialStatusHistory),
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
    next.tasks = (next.tasks || []).map((t) => ({
      ...t,
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
  const completedRoutes = (scopedState.routes || []).filter((r) => Number(r.completion_percent || 0) >= 95).length;

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

// PUBLIC_INTERFACE
export function allocateEngineerToRoute(state, { engineerId, routeId }) {
  /** Assign/unassign engineer to a route. If routeId is empty, unassign. */
  if (!engineerId) return { ok: false, error: "Missing engineerId." };
  const next = deepClone(state);
  next.engineerAssignments = Array.isArray(next.engineerAssignments) ? next.engineerAssignments : [];

  // Remove any existing assignment(s) for that engineer (keep simple: 1 active route).
  next.engineerAssignments = next.engineerAssignments.filter((a) => a.engineerId !== engineerId);

  if (routeId) {
    next.engineerAssignments.push({ engineerId, routeId });
  }

  saveDomainState(next);
  return { ok: true, state: next };
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
  const completedRoutes = routesList.filter((r) => Number(r.completion_percent || 0) >= 95).length;
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
    const regionCompletedRoutes = regionRoutes.filter((rt) => Number(rt.completion_percent || 0) >= 95).length;

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
