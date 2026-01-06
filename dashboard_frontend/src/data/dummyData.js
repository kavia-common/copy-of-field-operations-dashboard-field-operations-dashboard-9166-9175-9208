/**
 * Dummy domain data for the Field Operations Dashboard.
 * All data is local-only (no backend calls).
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
});

export const statusMeta = {
  [Statuses.ASSIGNED]: { label: "Assigned", tone: "neutral" },
  [Statuses.IN_PROGRESS]: { label: "In Progress", tone: "warn" },
  [Statuses.COMPLETED]: { label: "Completed", tone: "success" },
  [Statuses.ON_HOLD]: { label: "On Hold", tone: "error" },
  [Statuses.POSTPONED]: { label: "Postponed", tone: "warn" },
};

export const regions = [
  { id: "r_north", name: "North Region" },
  { id: "r_south", name: "South Region" },
];

export const users = [
  { id: "u_admin", name: "Avery Admin", role: Roles.ADMIN },

  { id: "u_rm_n", name: "Riley North", role: Roles.REGIONAL_MANAGER, regionId: "r_north" },
  { id: "u_rm_s", name: "Sam South", role: Roles.REGIONAL_MANAGER, regionId: "r_south" },

  { id: "u_eng_1", name: "Jordan Lee", role: Roles.FIELD_ENGINEER, regionId: "r_north" },
  { id: "u_eng_2", name: "Casey Patel", role: Roles.FIELD_ENGINEER, regionId: "r_north" },
  { id: "u_eng_3", name: "Taylor Kim", role: Roles.FIELD_ENGINEER, regionId: "r_north" },
  { id: "u_eng_4", name: "Morgan Reed", role: Roles.FIELD_ENGINEER, regionId: "r_north" },
  { id: "u_eng_5", name: "Alex Chen", role: Roles.FIELD_ENGINEER, regionId: "r_north" },
  { id: "u_eng_6", name: "Quinn Diaz", role: Roles.FIELD_ENGINEER, regionId: "r_north" },
  { id: "u_eng_7", name: "Skyler Nguyen", role: Roles.FIELD_ENGINEER, regionId: "r_north" },
  { id: "u_eng_8", name: "Jamie Park", role: Roles.FIELD_ENGINEER, regionId: "r_north" },

  { id: "u_eng_9", name: "Robin Singh", role: Roles.FIELD_ENGINEER, regionId: "r_south" },
  { id: "u_eng_10", name: "Drew Wallace", role: Roles.FIELD_ENGINEER, regionId: "r_south" },
  { id: "u_eng_11", name: "Cameron Price", role: Roles.FIELD_ENGINEER, regionId: "r_south" },
  { id: "u_eng_12", name: "Parker Young", role: Roles.FIELD_ENGINEER, regionId: "r_south" },
  { id: "u_eng_13", name: "Rowan Brooks", role: Roles.FIELD_ENGINEER, regionId: "r_south" },
  { id: "u_eng_14", name: "Emerson Gray", role: Roles.FIELD_ENGINEER, regionId: "r_south" },
  { id: "u_eng_15", name: "Ari Flores", role: Roles.FIELD_ENGINEER, regionId: "r_south" },
  { id: "u_eng_16", name: "Reese Bennett", role: Roles.FIELD_ENGINEER, regionId: "r_south" },
];

export const engineerLiveLocations = [
  { engineerId: "u_eng_1", lat: 40.7512, lng: -73.9857 },
  { engineerId: "u_eng_2", lat: 40.7428, lng: -73.9921 },
  { engineerId: "u_eng_3", lat: 40.7594, lng: -73.9845 },
  { engineerId: "u_eng_4", lat: 40.7308, lng: -73.9973 },
  { engineerId: "u_eng_5", lat: 40.719, lng: -74.0062 },
  { engineerId: "u_eng_6", lat: 40.7355, lng: -73.9781 },
  { engineerId: "u_eng_7", lat: 40.7489, lng: -73.968 },
  { engineerId: "u_eng_8", lat: 40.706, lng: -74.009 },

  { engineerId: "u_eng_9", lat: 34.0522, lng: -118.2437 },
  { engineerId: "u_eng_10", lat: 34.0407, lng: -118.2468 },
  { engineerId: "u_eng_11", lat: 34.0622, lng: -118.308 },
  { engineerId: "u_eng_12", lat: 34.0739, lng: -118.2395 },
  { engineerId: "u_eng_13", lat: 34.0299, lng: -118.2673 },
  { engineerId: "u_eng_14", lat: 34.0195, lng: -118.4912 },
  { engineerId: "u_eng_15", lat: 34.1381, lng: -118.3534 },
  { engineerId: "u_eng_16", lat: 34.1478, lng: -118.1445 },
];

export const routes = [
  {
    id: "route_n_1",
    regionId: "r_north",
    name: "North Loop A",
    polyline: [
      { lat: 40.7512, lng: -73.9857 },
      { lat: 40.7428, lng: -73.9921 },
      { lat: 40.7308, lng: -73.9973 },
      { lat: 40.719, lng: -74.0062 },
      { lat: 40.706, lng: -74.009 },
    ],
  },
  {
    id: "route_n_2",
    regionId: "r_north",
    name: "North Loop B",
    polyline: [
      { lat: 40.7594, lng: -73.9845 },
      { lat: 40.7489, lng: -73.968 },
      { lat: 40.7355, lng: -73.9781 },
      { lat: 40.7428, lng: -73.9921 },
    ],
  },
  {
    id: "route_s_1",
    regionId: "r_south",
    name: "South Corridor A",
    polyline: [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0407, lng: -118.2468 },
      { lat: 34.0299, lng: -118.2673 },
      { lat: 34.0195, lng: -118.4912 },
    ],
  },
  {
    id: "route_s_2",
    regionId: "r_south",
    name: "South Corridor B",
    polyline: [
      { lat: 34.0739, lng: -118.2395 },
      { lat: 34.0622, lng: -118.308 },
      { lat: 34.1381, lng: -118.3534 },
      { lat: 34.1478, lng: -118.1445 },
    ],
  },
];

export const engineerAssignments = [
  { engineerId: "u_eng_1", routeId: "route_n_1" },
  { engineerId: "u_eng_2", routeId: "route_n_1" },
  { engineerId: "u_eng_3", routeId: "route_n_2" },
  { engineerId: "u_eng_4", routeId: "route_n_2" },
  { engineerId: "u_eng_5", routeId: "route_n_1" },
  { engineerId: "u_eng_6", routeId: "route_n_2" },
  { engineerId: "u_eng_7", routeId: "route_n_1" },
  { engineerId: "u_eng_8", routeId: "route_n_2" },

  { engineerId: "u_eng_9", routeId: "route_s_1" },
  { engineerId: "u_eng_10", routeId: "route_s_1" },
  { engineerId: "u_eng_11", routeId: "route_s_2" },
  { engineerId: "u_eng_12", routeId: "route_s_2" },
  { engineerId: "u_eng_13", routeId: "route_s_1" },
  { engineerId: "u_eng_14", routeId: "route_s_1" },
  { engineerId: "u_eng_15", routeId: "route_s_2" },
  { engineerId: "u_eng_16", routeId: "route_s_2" },
];

export const tasks = [
  // North tasks (engineer 1..8)
  {
    id: "t_n_1001",
    title: "Inspect junction box",
    regionId: "r_north",
    engineerId: "u_eng_1",
    routeId: "route_n_1",
    dueDate: "2026-01-10",
    status: Statuses.IN_PROGRESS,
  },
  {
    id: "t_n_1002",
    title: "Replace damaged signage",
    regionId: "r_north",
    engineerId: "u_eng_2",
    routeId: "route_n_1",
    dueDate: "2026-01-08",
    status: Statuses.ASSIGNED,
  },
  {
    id: "t_n_1003",
    title: "Verify meter readings",
    regionId: "r_north",
    engineerId: "u_eng_3",
    routeId: "route_n_2",
    dueDate: "2026-01-11",
    status: Statuses.ON_HOLD,
  },
  {
    id: "t_n_1004",
    title: "Traffic control check",
    regionId: "r_north",
    engineerId: "u_eng_4",
    routeId: "route_n_2",
    dueDate: "2026-01-09",
    status: Statuses.COMPLETED,
  },
  {
    id: "t_n_1005",
    title: "Hydrant pressure test",
    regionId: "r_north",
    engineerId: "u_eng_5",
    routeId: "route_n_1",
    dueDate: "2026-01-12",
    status: Statuses.IN_PROGRESS,
  },
  {
    id: "t_n_1006",
    title: "Confirm route clearance",
    regionId: "r_north",
    engineerId: "u_eng_6",
    routeId: "route_n_2",
    dueDate: "2026-01-07",
    status: Statuses.POSTPONED,
  },
  {
    id: "t_n_1007",
    title: "Audit maintenance log",
    regionId: "r_north",
    engineerId: "u_eng_7",
    routeId: "route_n_1",
    dueDate: "2026-01-13",
    status: Statuses.ASSIGNED,
  },
  {
    id: "t_n_1008",
    title: "Resolve customer ticket",
    regionId: "r_north",
    engineerId: "u_eng_8",
    routeId: "route_n_2",
    dueDate: "2026-01-06",
    status: Statuses.IN_PROGRESS,
  },

  // South tasks (engineer 9..16)
  {
    id: "t_s_2001",
    title: "Pole integrity assessment",
    regionId: "r_south",
    engineerId: "u_eng_9",
    routeId: "route_s_1",
    dueDate: "2026-01-08",
    status: Statuses.IN_PROGRESS,
  },
  {
    id: "t_s_2002",
    title: "Sensor calibration",
    regionId: "r_south",
    engineerId: "u_eng_10",
    routeId: "route_s_1",
    dueDate: "2026-01-10",
    status: Statuses.ASSIGNED,
  },
  {
    id: "t_s_2003",
    title: "Leak detection sweep",
    regionId: "r_south",
    engineerId: "u_eng_11",
    routeId: "route_s_2",
    dueDate: "2026-01-11",
    status: Statuses.IN_PROGRESS,
  },
  {
    id: "t_s_2004",
    title: "Restore access panel",
    regionId: "r_south",
    engineerId: "u_eng_12",
    routeId: "route_s_2",
    dueDate: "2026-01-07",
    status: Statuses.ON_HOLD,
  },
  {
    id: "t_s_2005",
    title: "Survey cable line",
    regionId: "r_south",
    engineerId: "u_eng_13",
    routeId: "route_s_1",
    dueDate: "2026-01-09",
    status: Statuses.COMPLETED,
  },
  {
    id: "t_s_2006",
    title: "Validate waypoint list",
    regionId: "r_south",
    engineerId: "u_eng_14",
    routeId: "route_s_1",
    dueDate: "2026-01-12",
    status: Statuses.POSTPONED,
  },
  {
    id: "t_s_2007",
    title: "Replace streetlight ballast",
    regionId: "r_south",
    engineerId: "u_eng_15",
    routeId: "route_s_2",
    dueDate: "2026-01-13",
    status: Statuses.ASSIGNED,
  },
  {
    id: "t_s_2008",
    title: "Close out service request",
    regionId: "r_south",
    engineerId: "u_eng_16",
    routeId: "route_s_2",
    dueDate: "2026-01-06",
    status: Statuses.IN_PROGRESS,
  },
];

export const initialStatusHistory = [
  {
    id: "h_1",
    entityType: "task",
    entityId: "t_n_1004",
    toStatus: Statuses.COMPLETED,
    reason: "",
    timestamp: "2026-01-04T14:10:00Z",
    actorUserId: "u_eng_4",
  },
  {
    id: "h_2",
    entityType: "task",
    entityId: "t_n_1003",
    toStatus: Statuses.ON_HOLD,
    reason: "Awaiting access authorization.",
    timestamp: "2026-01-04T09:00:00Z",
    actorUserId: "u_eng_3",
  },
  {
    id: "h_3",
    entityType: "task",
    entityId: "t_n_1006",
    toStatus: Statuses.POSTPONED,
    reason: "Weather conditions; rescheduling required.",
    timestamp: "2026-01-03T18:10:00Z",
    actorUserId: "u_eng_6",
  },
  {
    id: "h_4",
    entityType: "task",
    entityId: "t_s_2006",
    toStatus: Statuses.POSTPONED,
    reason: "Parts unavailable; awaiting delivery.",
    timestamp: "2026-01-03T16:30:00Z",
    actorUserId: "u_eng_14",
  },
];
