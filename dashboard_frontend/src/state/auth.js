import { Roles, users } from "../data/dummyData";

const SESSION_KEY = "fod_session_v1";

function isLoginRoleAllowed(role) {
  return role === Roles.ADMIN || role === Roles.REGIONAL_MANAGER;
}

// PUBLIC_INTERFACE
export function listDemoAccounts() {
  /** Returns demo accounts for the login screen. */
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    regionId: u.regionId || null,
  }));
}

// PUBLIC_INTERFACE
export function loadSession() {
  /** Loads active session from localStorage. */
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.userId) return null;
    const user = users.find((u) => u.id === parsed.userId);
    if (!user) return null;

    // Enforce: Field Engineer sessions are not supported for interactive login.
    // If an FE session exists (older demo), purge it and force re-login.
    if (!isLoginRoleAllowed(user.role)) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return user;
  } catch (e) {
    return null;
  }
}

// PUBLIC_INTERFACE
export function loginAsUserId(userId) {
  /** Logs in by selecting a user from the local sample user list. */
  const user = users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "Unknown user." };

  if (!isLoginRoleAllowed(user.role)) {
    return { ok: false, error: "This role is not permitted to log in." };
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
  return { ok: true, user };
}

// PUBLIC_INTERFACE
export function logout() {
  /** Clears session. */
  window.localStorage.removeItem(SESSION_KEY);
}

// PUBLIC_INTERFACE
export function canUpdateTask(user, task) {
  /** Permission check: Admin can update any; RM can update tasks in their region. */
  if (!user) return false;
  if (user.role === Roles.ADMIN) return true;
  if (user.role === Roles.REGIONAL_MANAGER) return task.regionId === user.regionId;
  return false;
}
