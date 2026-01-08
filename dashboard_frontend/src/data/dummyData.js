/**
 * Sample domain data for the Field Operations Dashboard.
 * All data is local-only (no backend calls).
 *
 * DEMO GOALS (2026-01):
 * - Simple, non-overlapping routes per region (Northeast, Southeast, Central, West).
 * - Easy to understand: each region has two routes with clearly separated corridors.
 * - Deterministic progressive updates (handled by src/state/dummyRefresh.js).
 *
 * IMPORTANT:
 * - IDs and relationships (engineerId/routeId/regionId) must remain consistent across users,
 *   engineerAssignments, engineerLiveLocations, routes, and tasks.
 * - MapPanel renders waypoint markers from route.polyline vertices (raw waypoints).
 * - OSRM snapping is applied to planned geometry at runtime (MapPanel), so keep points road-adjacent.
 */

export const Roles = Object.freeze({
  ADMIN: "Admin",
  REGIONAL_MANAGER: "Regional Manager",
  FIELD_ENGINEER: "Field Engineer",
});

export const Statuses = Object.freeze({
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  ON_HOLD: "on_hold",
  POSTPONED: "postponed",

  // Exceptions lifecycle additions
  REJECTED: "rejected",
  REDO: "redo",
});

export const statusMeta = {
  [Statuses.ASSIGNED]: { label: "Assigned", tone: "neutral" },
  [Statuses.IN_PROGRESS]: { label: "In Progress", tone: "warn" },
  [Statuses.COMPLETED]: { label: "Completed", tone: "success" },
  [Statuses.ON_HOLD]: { label: "On Hold", tone: "error" },
  [Statuses.POSTPONED]: { label: "Postponed", tone: "warn" },

  [Statuses.REJECTED]: { label: "Rejected", tone: "error" },
  [Statuses.REDO]: { label: "Redo Requested", tone: "warn" },
};

export const regions = [
  { id: "r_ne", name: "Northeast Region" },
  { id: "r_se", name: "Southeast Region" },
  { id: "r_c", name: "Central Region" },
  { id: "r_w", name: "West Region" },
];

export const users = [
  { id: "u_admin", name: "Admin", role: Roles.ADMIN },

  // Regional managers
  { id: "u_rm_ne", name: "Riley Northeast", role: Roles.REGIONAL_MANAGER, regionId: "r_ne" },
  { id: "u_rm_se", name: "Sam Southeast", role: Roles.REGIONAL_MANAGER, regionId: "r_se" },
  { id: "u_rm_c", name: "Chris Central", role: Roles.REGIONAL_MANAGER, regionId: "r_c" },
  { id: "u_rm_w", name: "Wren West", role: Roles.REGIONAL_MANAGER, regionId: "r_w" },

  // Field engineers: 16 total, 4 per region
  { id: "u_eng_1", name: "Jordan Lee", role: Roles.FIELD_ENGINEER, regionId: "r_ne" },
  { id: "u_eng_2", name: "Casey Patel", role: Roles.FIELD_ENGINEER, regionId: "r_ne" },
  { id: "u_eng_3", name: "Taylor Kim", role: Roles.FIELD_ENGINEER, regionId: "r_ne" },
  { id: "u_eng_4", name: "Morgan Reed", role: Roles.FIELD_ENGINEER, regionId: "r_ne" },

  { id: "u_eng_5", name: "Alex Chen", role: Roles.FIELD_ENGINEER, regionId: "r_se" },
  { id: "u_eng_6", name: "Quinn Diaz", role: Roles.FIELD_ENGINEER, regionId: "r_se" },
  { id: "u_eng_7", name: "Skyler Nguyen", role: Roles.FIELD_ENGINEER, regionId: "r_se" },
  { id: "u_eng_8", name: "Jamie Park", role: Roles.FIELD_ENGINEER, regionId: "r_se" },

  { id: "u_eng_9", name: "Robin Singh", role: Roles.FIELD_ENGINEER, regionId: "r_c" },
  { id: "u_eng_10", name: "Drew Wallace", role: Roles.FIELD_ENGINEER, regionId: "r_c" },
  { id: "u_eng_11", name: "Cameron Price", role: Roles.FIELD_ENGINEER, regionId: "r_c" },
  { id: "u_eng_12", name: "Parker Young", role: Roles.FIELD_ENGINEER, regionId: "r_c" },

  { id: "u_eng_13", name: "Rowan Brooks", role: Roles.FIELD_ENGINEER, regionId: "r_w" },
  { id: "u_eng_14", name: "Emerson Gray", role: Roles.FIELD_ENGINEER, regionId: "r_w" },
  { id: "u_eng_15", name: "Ari Flores", role: Roles.FIELD_ENGINEER, regionId: "r_w" },
  { id: "u_eng_16", name: "Reese Bennett", role: Roles.FIELD_ENGINEER, regionId: "r_w" },
];

/**
 * Initial engineer marker locations.
 * Keep these close to their assigned route starts to avoid a confusing first move.
 */
export const engineerLiveLocations = [
  // Northeast (Manhattan corridors)
  { engineerId: "u_eng_1", lat: 40.7581, lng: -73.9855 }, // Midtown (Times Sq)
  { engineerId: "u_eng_2", lat: 40.7581, lng: -73.9855 }, // Midtown (Times Sq)
  { engineerId: "u_eng_3", lat: 40.7064, lng: -74.0094 }, // FiDi (Wall St / Broad St)
  { engineerId: "u_eng_4", lat: 40.7064, lng: -74.0094 }, // FiDi (Wall St / Broad St)

  // Southeast (Atlanta)
  { engineerId: "u_eng_5", lat: 33.7538, lng: -84.3915 }, // Five Points
  { engineerId: "u_eng_6", lat: 33.7538, lng: -84.3915 }, // Five Points
  { engineerId: "u_eng_7", lat: 33.7909, lng: -84.3879 }, // Midtown
  { engineerId: "u_eng_8", lat: 33.7909, lng: -84.3879 }, // Midtown

  // Central (Dallas)
  { engineerId: "u_eng_9", lat: 32.7767, lng: -96.797 }, // Downtown Dallas
  { engineerId: "u_eng_10", lat: 32.7767, lng: -96.797 }, // Downtown Dallas
  { engineerId: "u_eng_11", lat: 32.7507, lng: -96.8277 }, // Oak Cliff / Bishop Arts-ish
  { engineerId: "u_eng_12", lat: 32.7507, lng: -96.8277 }, // Oak Cliff / Bishop Arts-ish

  // West (Los Angeles)
  { engineerId: "u_eng_13", lat: 34.0526, lng: -118.2467 }, // DTLA
  { engineerId: "u_eng_14", lat: 34.0526, lng: -118.2467 }, // DTLA
  { engineerId: "u_eng_15", lat: 34.0199, lng: -118.4915 }, // Santa Monica
  { engineerId: "u_eng_16", lat: 34.0199, lng: -118.4915 }, // Santa Monica
];

/**
 * Demo route model additions:
 * - routeStatus: "not_started" | "in_progress" | "completed"
 * - demo: per-route deterministic schedule used by dummyRefresh.js
 *
 * allowedDeviationMeters is kept for TrackoBit-like corridor logic in MapPanel.
 */
export const routes = [
  // ---------------------------
  // Northeast (Manhattan) — two non-overlapping corridors
  // ---------------------------

  // NE Route A: Midtown → SoHo → Battery Park (simplified, fewer vertices)
  {
    id: "route_ne_1",
    regionId: "r_ne",
    name: "Northeast A — Midtown → Battery Park",
    planned_stops: 8,
    completed_stops: 0,
    missed_stops: 0,
    on_hold_stops: 0,
    postponed_stops: 0,
    allowedDeviationMeters: 60,
    routeStatus: "not_started",
    demo: {
      startTick: 1,
      completeTick: 10,
      deviationTick: 5, // short deliberate off-route wiggle
    },
    polyline: [
      { lat: 40.7581, lng: -73.9855 }, // Times Sq
      { lat: 40.7465, lng: -73.9836 }, // Herald Sq
      { lat: 40.7359, lng: -73.9911 }, // Union Sq
      { lat: 40.7282, lng: -73.9996 }, // SoHo (Prince St)
      { lat: 40.7155, lng: -74.0094 }, // City Hall Park
      { lat: 40.7099, lng: -74.0125 }, // WTC
      { lat: 40.7033, lng: -74.0170 }, // Battery Park City
    ],
  },

  // NE Route B: FiDi → Brooklyn Bridge → DUMBO (simplified)
  {
    id: "route_ne_2",
    regionId: "r_ne",
    name: "Northeast B — FiDi → DUMBO",
    planned_stops: 7,
    completed_stops: 0,
    missed_stops: 0,
    on_hold_stops: 0,
    postponed_stops: 0,
    allowedDeviationMeters: 60,
    routeStatus: "not_started",
    demo: {
      startTick: 2,
      completeTick: 11,
      deviationTick: 7,
    },
    polyline: [
      { lat: 40.7064, lng: -74.0094 }, // Wall St / Broad St
      { lat: 40.7043, lng: -74.0139 }, // West St
      { lat: 40.7062, lng: -74.0038 }, // near Brooklyn Bridge approach
      { lat: 40.7068, lng: -73.9969 }, // Brooklyn Bridge (approx)
      { lat: 40.7033, lng: -73.9895 }, // DUMBO
      { lat: 40.7004, lng: -73.9870 }, // Brooklyn Bridge Park
    ],
  },

  // ---------------------------
  // Southeast (Atlanta) — two separated corridors
  // ---------------------------

  // SE Route A: Downtown → Buckhead (simplified)
  {
    id: "route_se_1",
    regionId: "r_se",
    name: "Southeast A — Downtown → Buckhead",
    planned_stops: 7,
    completed_stops: 0,
    missed_stops: 0,
    on_hold_stops: 0,
    postponed_stops: 0,
    allowedDeviationMeters: 70,
    routeStatus: "not_started",
    demo: {
      startTick: 1,
      completeTick: 9,
      deviationTick: 6,
    },
    polyline: [
      { lat: 33.7538, lng: -84.3915 }, // Five Points
      { lat: 33.7707, lng: -84.3857 }, // Midtown / North Ave
      { lat: 33.7890, lng: -84.3870 }, // Piedmont area edge
      { lat: 33.7990, lng: -84.3872 }, // toward Buckhead
      { lat: 33.8100, lng: -84.3875 }, // Buckhead-ish
    ],
  },

  // SE Route B: Midtown → Decatur (simplified, fewer vertices)
  {
    id: "route_se_2",
    regionId: "r_se",
    name: "Southeast B — Midtown → Decatur",
    planned_stops: 6,
    completed_stops: 0,
    missed_stops: 0,
    on_hold_stops: 0,
    postponed_stops: 0,
    allowedDeviationMeters: 70,
    routeStatus: "not_started",
    demo: {
      startTick: 3,
      completeTick: 12,
      deviationTick: 8,
    },
    polyline: [
      { lat: 33.7909, lng: -84.3879 }, // Midtown
      { lat: 33.7897, lng: -84.3660 }, // toward Virginia-Highland edge
      { lat: 33.7848, lng: -84.3420 }, // Avondale Estates-ish
      { lat: 33.7749, lng: -84.2963 }, // Decatur
    ],
  },

  // ---------------------------
  // Central (Dallas) — two corridors, separated north/south
  // ---------------------------

  // C Route A: Downtown → Uptown (simplified)
  {
    id: "route_c_1",
    regionId: "r_c",
    name: "Central A — Downtown → Uptown",
    planned_stops: 6,
    completed_stops: 0,
    missed_stops: 0,
    on_hold_stops: 0,
    postponed_stops: 0,
    allowedDeviationMeters: 70,
    routeStatus: "not_started",
    demo: {
      startTick: 2,
      completeTick: 10,
      deviationTick: 6,
    },
    polyline: [
      { lat: 32.7767, lng: -96.797 }, // Downtown
      { lat: 32.7875, lng: -96.7978 }, // Victory Park-ish
      { lat: 32.7960, lng: -96.7970 }, // Uptown-ish
      { lat: 32.8046, lng: -96.7720 }, // Mockingbird / SMU edge
    ],
  },

  // C Route B: Oak Cliff → Downtown (simplified)
  {
    id: "route_c_2",
    regionId: "r_c",
    name: "Central B — Oak Cliff → Downtown",
    planned_stops: 5,
    completed_stops: 0,
    missed_stops: 0,
    on_hold_stops: 0,
    postponed_stops: 0,
    allowedDeviationMeters: 70,
    routeStatus: "not_started",
    demo: {
      startTick: 1,
      completeTick: 9,
      deviationTick: 5,
    },
    polyline: [
      { lat: 32.7507, lng: -96.8277 }, // Bishop Arts-ish
      { lat: 32.7605, lng: -96.8080 }, // Reunion / river crossing area
      { lat: 32.7767, lng: -96.7970 }, // Downtown
    ],
  },

  // ---------------------------
  // West (Los Angeles) — two corridors, separated east/west
  // ---------------------------

  // W Route A: DTLA → Beverly Grove (simplified)
  {
    id: "route_w_1",
    regionId: "r_w",
    name: "West A — DTLA → Beverly Grove",
    planned_stops: 6,
    completed_stops: 0,
    missed_stops: 0,
    on_hold_stops: 0,
    postponed_stops: 0,
    allowedDeviationMeters: 80,
    routeStatus: "not_started",
    demo: {
      startTick: 1,
      completeTick: 10,
      deviationTick: 7,
    },
    polyline: [
      { lat: 34.0526, lng: -118.2467 }, // DTLA
      { lat: 34.0472, lng: -118.2741 }, // Koreatown
      { lat: 34.0462, lng: -118.3190 }, // near La Brea
      { lat: 34.0736, lng: -118.3617 }, // Beverly Grove edge
    ],
  },

  // W Route B: Santa Monica → Culver City (simplified)
  {
    id: "route_w_2",
    regionId: "r_w",
    name: "West B — Santa Monica → Culver City",
    planned_stops: 6,
    completed_stops: 0,
    missed_stops: 0,
    on_hold_stops: 0,
    postponed_stops: 0,
    allowedDeviationMeters: 80,
    routeStatus: "not_started",
    demo: {
      startTick: 2,
      completeTick: 11,
      deviationTick: 8,
    },
    polyline: [
      { lat: 34.0199, lng: -118.4915 }, // Santa Monica
      { lat: 34.0030, lng: -118.4418 }, // Sawtelle-ish edge
      { lat: 33.9870, lng: -118.4350 }, // near Culver Blvd edge
      { lat: 33.9803, lng: -118.3990 }, // Culver City
    ],
  },
];

export const engineerAssignments = [
  // Northeast engineers -> NE routes
  { engineerId: "u_eng_1", routeId: "route_ne_1" },
  { engineerId: "u_eng_2", routeId: "route_ne_1" },
  { engineerId: "u_eng_3", routeId: "route_ne_2" },
  { engineerId: "u_eng_4", routeId: "route_ne_2" },

  // Southeast engineers -> SE routes
  { engineerId: "u_eng_5", routeId: "route_se_1" },
  { engineerId: "u_eng_6", routeId: "route_se_1" },
  { engineerId: "u_eng_7", routeId: "route_se_2" },
  { engineerId: "u_eng_8", routeId: "route_se_2" },

  // Central engineers -> Central routes
  { engineerId: "u_eng_9", routeId: "route_c_1" },
  { engineerId: "u_eng_10", routeId: "route_c_1" },
  { engineerId: "u_eng_11", routeId: "route_c_2" },
  { engineerId: "u_eng_12", routeId: "route_c_2" },

  // West engineers -> West routes
  { engineerId: "u_eng_13", routeId: "route_w_1" },
  { engineerId: "u_eng_14", routeId: "route_w_1" },
  { engineerId: "u_eng_15", routeId: "route_w_2" },
  { engineerId: "u_eng_16", routeId: "route_w_2" },
];

export const tasks = [
  // Northeast tasks
  {
    id: "t_ne_1001",
    title: "Inspect junction box",
    regionId: "r_ne",
    engineerId: "u_eng_1",
    routeId: "route_ne_1",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_ne_1002",
    title: "Replace damaged signage",
    regionId: "r_ne",
    engineerId: "u_eng_2",
    routeId: "route_ne_1",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_ne_1003",
    title: "Verify meter readings",
    regionId: "r_ne",
    engineerId: "u_eng_3",
    routeId: "route_ne_2",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_ne_1004",
    title: "Traffic control check",
    regionId: "r_ne",
    engineerId: "u_eng_4",
    routeId: "route_ne_2",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },

  // Southeast tasks
  {
    id: "t_se_2001",
    title: "Pole integrity assessment",
    regionId: "r_se",
    engineerId: "u_eng_5",
    routeId: "route_se_1",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_se_2002",
    title: "Sensor calibration",
    regionId: "r_se",
    engineerId: "u_eng_6",
    routeId: "route_se_1",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_se_2003",
    title: "Leak detection sweep",
    regionId: "r_se",
    engineerId: "u_eng_7",
    routeId: "route_se_2",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_se_2004",
    title: "Restore access panel",
    regionId: "r_se",
    engineerId: "u_eng_8",
    routeId: "route_se_2",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },

  // Central tasks
  {
    id: "t_c_3001",
    title: "Hydrant pressure test",
    regionId: "r_c",
    engineerId: "u_eng_9",
    routeId: "route_c_1",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_c_3002",
    title: "Confirm route clearance",
    regionId: "r_c",
    engineerId: "u_eng_10",
    routeId: "route_c_1",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_c_3003",
    title: "Audit maintenance log",
    regionId: "r_c",
    engineerId: "u_eng_11",
    routeId: "route_c_2",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_c_3004",
    title: "Resolve customer ticket",
    regionId: "r_c",
    engineerId: "u_eng_12",
    routeId: "route_c_2",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.REDO,
    rejection_reason: "",
    redo_reason: "Missing photo evidence; please re-submit.",
    redo_count: 1,
  },

  // West tasks
  {
    id: "t_w_4001",
    title: "Survey cable line",
    regionId: "r_w",
    engineerId: "u_eng_13",
    routeId: "route_w_1",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.ASSIGNED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_w_4002",
    title: "Validate waypoint list",
    regionId: "r_w",
    engineerId: "u_eng_14",
    routeId: "route_w_1",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.POSTPONED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_w_4003",
    title: "Replace streetlight ballast",
    regionId: "r_w",
    engineerId: "u_eng_15",
    routeId: "route_w_2",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.REJECTED,
    rejection_reason: "Work order missing required before/after photos.",
    redo_reason: "",
    redo_count: 0,
  },
  {
    id: "t_w_4004",
    title: "Close out service request",
    regionId: "r_w",
    engineerId: "u_eng_16",
    routeId: "route_w_2",
    dueDate: "2026-01-10",
    nextDueDate: "2026-01-17",
    rescheduledDate: "",
    status: Statuses.IN_PROGRESS,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
];

export const initialStatusHistory = [
  // Keep a couple of seeded lifecycle events for UI examples.
  {
    id: "h_seed_1",
    entityType: "task",
    entityId: "t_c_3004",
    toStatus: Statuses.REDO,
    reason: "Missing photo evidence; please re-submit.",
    timestamp: "2026-01-05T08:05:00Z",
    actorUserId: "u_rm_c",
  },
  {
    id: "h_seed_2",
    entityType: "task",
    entityId: "t_w_4003",
    toStatus: Statuses.REJECTED,
    reason: "Work order missing required before/after photos.",
    timestamp: "2026-01-04T10:20:00Z",
    actorUserId: "u_rm_w",
  },
];
