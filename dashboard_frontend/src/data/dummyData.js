/**
 * Dummy domain data for the Field Operations Dashboard.
 * All data is local-only (no backend calls).
 *
 * IMPORTANT:
 * - IDs and relationships (engineerId/routeId/regionId) must remain consistent across users,
 *   engineerAssignments, engineerLiveLocations, routes, and tasks.
 * - The dummy refresh engine moves engineers along route polylines deterministically every 30s.
 * - MapPanel renders waypoints from polyline vertices. Keep polylines >= 2 points and use valid lat/lng.
 *
 * This dataset is intentionally distributed across US regions for better map visualization:
 * - Northeast (NYC metro / New Jersey corridor)
 * - Southeast (Atlanta / I-75/I-85 area)
 * - Central (Dallas / Fort Worth / I-35 corridor)
 * - West (Los Angeles basin / I-10/I-405 corridors)
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
  { id: "u_admin", name: "Avery Admin", role: Roles.ADMIN },

  // Regional managers (MapPanel expects RM users keyed by regionId).
  { id: "u_rm_ne", name: "Riley Northeast", role: Roles.REGIONAL_MANAGER, regionId: "r_ne" },
  { id: "u_rm_se", name: "Sam Southeast", role: Roles.REGIONAL_MANAGER, regionId: "r_se" },
  { id: "u_rm_c", name: "Chris Central", role: Roles.REGIONAL_MANAGER, regionId: "r_c" },
  { id: "u_rm_w", name: "Wren West", role: Roles.REGIONAL_MANAGER, regionId: "r_w" },

  // Field engineers: 16 total, distributed across the 4 regions (4 per region).
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
 * These should start near their assigned route polyline to avoid large "teleport" moves
 * on the first deterministic refresh tick.
 */
export const engineerLiveLocations = [
  // Northeast (NYC/NJ corridors)
  { engineerId: "u_eng_1", lat: 40.7506, lng: -73.9936 }, // Midtown Manhattan (Penn Station)
  { engineerId: "u_eng_2", lat: 40.7413, lng: -73.9897 }, // Flatiron-ish
  { engineerId: "u_eng_3", lat: 40.7359, lng: -74.0036 }, // Greenwich Village / West Village
  { engineerId: "u_eng_4", lat: 40.7282, lng: -74.0336 }, // Jersey City (near Holland Tunnel corridor)

  // Southeast (Atlanta)
  { engineerId: "u_eng_5", lat: 33.7552, lng: -84.3906 }, // Downtown ATL
  { engineerId: "u_eng_6", lat: 33.7712, lng: -84.3654 }, // Old Fourth Ward / Inman Park
  { engineerId: "u_eng_7", lat: 33.7864, lng: -84.3879 }, // Midtown ATL
  { engineerId: "u_eng_8", lat: 33.7339, lng: -84.3937 }, // South ATL (near I-75/85)

  // Central (Dallas/Fort Worth)
  { engineerId: "u_eng_9", lat: 32.7791, lng: -96.8087 }, // Downtown Dallas
  { engineerId: "u_eng_10", lat: 32.8003, lng: -96.7699 }, // Uptown / Knox-Henderson area
  { engineerId: "u_eng_11", lat: 32.7551, lng: -97.3308 }, // Downtown Fort Worth
  { engineerId: "u_eng_12", lat: 32.8343, lng: -96.9965 }, // Irving (near DFW / Las Colinas)

  // West (Los Angeles basin)
  { engineerId: "u_eng_13", lat: 34.0526, lng: -118.2467 }, // DTLA
  { engineerId: "u_eng_14", lat: 34.0407, lng: -118.2698 }, // Koreatown / Pico-Union
  { engineerId: "u_eng_15", lat: 34.0199, lng: -118.4915 }, // Santa Monica
  { engineerId: "u_eng_16", lat: 34.147, lng: -118.144 }, // Pasadena
];

export const routes = [
  // Northeast: NYC -> Lower Manhattan (arterial-like)
  {
    id: "route_ne_1",
    regionId: "r_ne",
    name: "Northeast Loop A (Midtown → Downtown)",
    planned_stops: 24,
    completed_stops: 20,
    missed_stops: 2,
    on_hold_stops: 1,
    postponed_stops: 1,
    // Roughly follows a Manhattan spine with realistic intersections/avenues
    polyline: [
      { lat: 40.758, lng: -73.9855 }, // Times Sq
      { lat: 40.7527, lng: -73.9772 }, // Grand Central
      { lat: 40.7484, lng: -73.9857 }, // Empire State
      { lat: 40.7411, lng: -73.9897 }, // Flatiron
      { lat: 40.7347, lng: -73.9943 }, // Washington Sq
      { lat: 40.7284, lng: -74.0021 }, // SoHo/West Village edge
      { lat: 40.7209, lng: -74.0049 }, // Tribeca
      { lat: 40.7093, lng: -74.0103 }, // WTC
      { lat: 40.706, lng: -74.009 }, // Battery Park/FiDi edge
    ],
  },
  // Northeast: NJ corridor (Jersey City / Hoboken / Newark-ish)
  {
    id: "route_ne_2",
    regionId: "r_ne",
    name: "Northeast Loop B (Hudson Waterfront)",
    planned_stops: 18,
    completed_stops: 11,
    missed_stops: 3,
    on_hold_stops: 2,
    postponed_stops: 2,
    polyline: [
      { lat: 40.744, lng: -74.0324 }, // Jersey City (Newport)
      { lat: 40.7393, lng: -74.0296 }, // Exchange Place corridor
      { lat: 40.7336, lng: -74.041 }, // Paulus Hook
      { lat: 40.7282, lng: -74.0336 }, // Holland Tunnel approach
      { lat: 40.7419, lng: -74.0047 }, // west Midtown (near Lincoln Tunnel / West Side)
    ],
  },

  // Southeast: Atlanta perimeter / connector style
  {
    id: "route_se_1",
    regionId: "r_se",
    name: "Southeast Corridor A (Downtown ATL)",
    planned_stops: 22,
    completed_stops: 19,
    missed_stops: 1,
    on_hold_stops: 1,
    postponed_stops: 1,
    polyline: [
      { lat: 33.7552, lng: -84.3906 }, // Downtown
      { lat: 33.7644, lng: -84.3874 }, // near North Ave / Connector
      { lat: 33.7726, lng: -84.3847 }, // Midtown
      { lat: 33.7815, lng: -84.3857 }, // near Arts Center
      { lat: 33.7899, lng: -84.388 }, // Buckhead-ish south edge
    ],
  },
  {
    id: "route_se_2",
    regionId: "r_se",
    name: "Southeast Corridor B (Eastside / Beltline)",
    planned_stops: 20,
    completed_stops: 10,
    missed_stops: 5,
    on_hold_stops: 3,
    postponed_stops: 2,
    polyline: [
      { lat: 33.7658, lng: -84.3722 }, // near Krog St / Inman Park
      { lat: 33.7712, lng: -84.3654 }, // Inman Park
      { lat: 33.781, lng: -84.3645 }, // Poncey-Highland
      { lat: 33.7926, lng: -84.3641 }, // toward Virginia-Highland / Morningside
      { lat: 33.805, lng: -84.365 }, // toward North Druid Hills edge
    ],
  },

  // Central: Dallas / I-35E / downtown connectors
  {
    id: "route_c_1",
    regionId: "r_c",
    name: "Central Route A (Dallas Core)",
    planned_stops: 21,
    completed_stops: 16,
    missed_stops: 2,
    on_hold_stops: 2,
    postponed_stops: 1,
    polyline: [
      { lat: 32.7767, lng: -96.797 }, // Downtown Dallas
      { lat: 32.7854, lng: -96.8003 }, // Arts District
      { lat: 32.7952, lng: -96.8012 }, // toward Uptown
      { lat: 32.801, lng: -96.7906 }, // Knox/Henderson vicinity
      { lat: 32.8046, lng: -96.772 }, // near SMU/Mockingbird corridor
    ],
  },
  {
    id: "route_c_2",
    regionId: "r_c",
    name: "Central Route B (DFW Connector)",
    planned_stops: 19,
    completed_stops: 8,
    missed_stops: 5,
    on_hold_stops: 3,
    postponed_stops: 3,
    polyline: [
      { lat: 32.7551, lng: -97.3308 }, // Downtown Fort Worth
      { lat: 32.7813, lng: -97.297 }, // near Arlington Heights direction
      { lat: 32.8049, lng: -97.1925 }, // Arlington / Six Flags-ish corridor
      { lat: 32.8444, lng: -97.0416 }, // DFW Airport area
      { lat: 32.8343, lng: -96.9965 }, // Irving / Las Colinas
    ],
  },

  // West: LA basin
  {
    id: "route_w_1",
    regionId: "r_w",
    name: "West Corridor A (DTLA → Santa Monica)",
    planned_stops: 23,
    completed_stops: 18,
    missed_stops: 2,
    on_hold_stops: 2,
    postponed_stops: 1,
    polyline: [
      { lat: 34.0526, lng: -118.2467 }, // DTLA
      { lat: 34.0485, lng: -118.2585 }, // near Pico-Union
      { lat: 34.0438, lng: -118.2676 }, // Koreatown edge
      { lat: 34.0362, lng: -118.3702 }, // near La Cienega / I-10 corridor
      { lat: 34.0261, lng: -118.4726 }, // Santa Monica (near 10/405)
      { lat: 34.0199, lng: -118.4915 }, // Santa Monica beach area
    ],
  },
  {
    id: "route_w_2",
    regionId: "r_w",
    name: "West Corridor B (Pasadena / Glendale)",
    planned_stops: 17,
    completed_stops: 9,
    missed_stops: 4,
    on_hold_stops: 2,
    postponed_stops: 2,
    polyline: [
      { lat: 34.147, lng: -118.144 }, // Pasadena
      { lat: 34.1437, lng: -118.152 }, // Old Town Pasadena vicinity
      { lat: 34.1367, lng: -118.1743 }, // Eagle Rock-ish
      { lat: 34.1256, lng: -118.2551 }, // near Silver Lake / Atwater
      { lat: 34.0526, lng: -118.2467 }, // back to DTLA
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
  // Northeast tasks (engineer 1..4)
  {
    id: "t_ne_1001",
    title: "Inspect junction box",
    regionId: "r_ne",
    engineerId: "u_eng_1",
    routeId: "route_ne_1",
    dueDate: "2026-01-10",
    // Scheduled/next occurrence (read-only on Tasks page)
    nextDueDate: "2026-01-17",
    status: Statuses.IN_PROGRESS,
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
    dueDate: "2026-01-08",
    nextDueDate: "2026-01-15",
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
    dueDate: "2026-01-11",
    nextDueDate: "2026-01-18",
    status: Statuses.ON_HOLD,
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
    dueDate: "2026-01-09",
    nextDueDate: "2026-01-16",
    status: Statuses.COMPLETED,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },

  // Southeast tasks (engineer 5..8)
  {
    id: "t_se_2001",
    title: "Pole integrity assessment",
    regionId: "r_se",
    engineerId: "u_eng_5",
    routeId: "route_se_1",
    dueDate: "2026-01-08",
    nextDueDate: "2026-01-15",
    status: Statuses.IN_PROGRESS,
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
    dueDate: "2026-01-11",
    nextDueDate: "2026-01-18",
    status: Statuses.IN_PROGRESS,
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
    dueDate: "2026-01-07",
    nextDueDate: "2026-01-14",
    status: Statuses.ON_HOLD,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },

  // Central tasks (engineer 9..12)
  {
    id: "t_c_3001",
    title: "Hydrant pressure test",
    regionId: "r_c",
    engineerId: "u_eng_9",
    routeId: "route_c_1",
    dueDate: "2026-01-12",
    nextDueDate: "2026-01-19",
    status: Statuses.IN_PROGRESS,
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
    dueDate: "2026-01-07",
    nextDueDate: "2026-01-14",
    status: Statuses.POSTPONED,
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
    dueDate: "2026-01-13",
    nextDueDate: "2026-01-20",
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
    dueDate: "2026-01-06",
    nextDueDate: "2026-01-13",
    status: Statuses.REDO,
    rejection_reason: "",
    redo_reason: "Photo evidence missing; please re-submit.",
    redo_count: 1,
  },

  // West tasks (engineer 13..16)
  {
    id: "t_w_4001",
    title: "Survey cable line",
    regionId: "r_w",
    engineerId: "u_eng_13",
    routeId: "route_w_1",
    dueDate: "2026-01-09",
    nextDueDate: "2026-01-16",
    status: Statuses.COMPLETED,
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
    dueDate: "2026-01-12",
    nextDueDate: "2026-01-19",
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
    dueDate: "2026-01-13",
    nextDueDate: "2026-01-20",
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
    dueDate: "2026-01-06",
    nextDueDate: "2026-01-13",
    status: Statuses.IN_PROGRESS,
    rejection_reason: "",
    redo_reason: "",
    redo_count: 0,
  },
];

export const initialStatusHistory = [
  // Seed some task lifecycle history across regions (keeps UI examples varied).
  {
    id: "h_1",
    entityType: "task",
    entityId: "t_ne_1004",
    toStatus: Statuses.COMPLETED,
    reason: "",
    timestamp: "2026-01-04T14:10:00Z",
    actorUserId: "u_eng_4",
  },
  {
    id: "h_2",
    entityType: "task",
    entityId: "t_ne_1003",
    toStatus: Statuses.ON_HOLD,
    reason: "Awaiting access authorization.",
    timestamp: "2026-01-04T09:00:00Z",
    actorUserId: "u_eng_3",
  },
  {
    id: "h_3",
    entityType: "task",
    entityId: "t_c_3002",
    toStatus: Statuses.POSTPONED,
    reason: "Weather conditions; rescheduling required.",
    timestamp: "2026-01-03T18:10:00Z",
    actorUserId: "u_eng_10",
  },
  {
    id: "h_4",
    entityType: "task",
    entityId: "t_w_4002",
    toStatus: Statuses.POSTPONED,
    reason: "Parts unavailable; awaiting delivery.",
    timestamp: "2026-01-03T16:30:00Z",
    actorUserId: "u_eng_14",
  },

  // Seed examples for new lifecycle transitions:
  {
    id: "h_5",
    entityType: "task",
    entityId: "t_w_4003",
    toStatus: Statuses.REJECTED,
    reason: "Work order missing required before/after photos.",
    timestamp: "2026-01-04T10:20:00Z",
    actorUserId: "u_rm_w",
  },
  {
    id: "h_6",
    entityType: "task",
    entityId: "t_c_3004",
    toStatus: Statuses.REDO,
    reason: "Photo evidence missing; please re-submit.",
    timestamp: "2026-01-05T08:05:00Z",
    actorUserId: "u_rm_c",
  },
];
