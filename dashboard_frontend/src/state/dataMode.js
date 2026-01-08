/**
 * Data mode state: controls whether the app sources data from local demo state
 * (localStorage-backed + dummyRefresh) or from API endpoints.
 *
 * Persisted to localStorage so user choice survives reloads.
 */

const STORAGE_KEY = "fod_data_mode_v1";

/**
 * PUBLIC_INTERFACE
 * Returns true when Demo Mode is enabled (local demo data).
 */
export function getDemoModeEnabled() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return true; // default: demo mode ON for a smooth first-run experience
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.demoModeEnabled);
  } catch {
    return true;
  }
}

/**
 * PUBLIC_INTERFACE
 * Persists Demo Mode enabled flag.
 */
export function setDemoModeEnabled(enabled) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ demoModeEnabled: Boolean(enabled) }));
  } catch {
    // If localStorage is blocked, keep best-effort behavior in-memory (caller state still works)
  }
}

/**
 * PUBLIC_INTERFACE
 * Returns a human-friendly label for current mode.
 */
export function getDemoModeLabel(enabled) {
  /** Returns a short label for UI rendering. */
  return enabled ? "Demo Mode: On" : "Demo Mode: Off";
}
