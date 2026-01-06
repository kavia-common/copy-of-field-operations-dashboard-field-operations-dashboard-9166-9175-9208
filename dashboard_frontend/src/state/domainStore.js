import { engineerAssignments, engineerLiveLocations, initialStatusHistory, regions, routes, Statuses, tasks, users } from "../data/dummyData";

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

function getDefaultState() {
  return {
    regions: deepClone(regions),
    routes: deepClone(routes),
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
    return parsed;
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
    { [Statuses.ASSIGNED]: 0, [Statuses.IN_PROGRESS]: 0, [Statuses.COMPLETED]: 0, [Statuses.ON_HOLD]: 0, [Statuses.POSTPONED]: 0 }
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

  return { totalTasks: total, engineersCount, completionRate, byStatus, perRegion };
}

// PUBLIC_INTERFACE
export function updateTaskStatus(state, { taskId, toStatus, reason, actorUserId }) {
  /**
   * Updates task status and appends a status history record.
   * For on_hold/postponed a reason is required.
   */
  const needsReason = toStatus === Statuses.ON_HOLD || toStatus === Statuses.POSTPONED;
  if (needsReason && (!reason || reason.trim().length < 3)) {
    return { ok: false, error: "Reason is required for On Hold / Postponed (min 3 characters)." };
  }

  const taskIndex = state.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) return { ok: false, error: "Task not found." };

  const next = deepClone(state);
  next.tasks[taskIndex].status = toStatus;

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
