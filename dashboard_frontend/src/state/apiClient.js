/**
 * Minimal API adapter for the dashboard frontend.
 *
 * When Demo Mode is OFF, App.js will attempt to fetch domain state from an API.
 * If the API is unavailable or returns an error, the app will fall back to the
 * current local domain state so the dashboard remains usable.
 *
 * Env:
 * - REACT_APP_API_BASE (preferred)
 * - REACT_APP_BACKEND_URL (fallback)
 */

function getApiBase() {
  const base = (process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || "").trim();
  return base.replace(/\/+$/, "");
}

function joinUrl(base, path) {
  if (!base) return path;
  if (!path) return base;
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
}

async function fetchJson(url, { timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const id = window.setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Request failed (${res.status})${text ? `: ${text}` : ""}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    const msg = e?.name === "AbortError" ? "Request timed out." : e?.message || "Network error.";
    return { ok: false, error: msg };
  } finally {
    window.clearTimeout(id);
  }
}

/**
 * PUBLIC_INTERFACE
 * Fetches the full domain state from an API endpoint.
 *
 * Expected API response (recommended):
 * - a JSON object containing: regions, routes, users, engineerAssignments, engineerLiveLocations, tasks, statusHistory, routeChangePulse
 *
 * Supported endpoints (first match wins):
 * - GET {base}/api/domain
 * - GET {base}/domain
 *
 * Returns:
 * - { ok: true, state }
 * - { ok: false, error }
 */
export async function fetchDomainStateFromApi() {
  /** Fetches the domain state from the configured API base URL. */
  const base = getApiBase();
  if (!base) {
    return {
      ok: false,
      error: "API base URL is not configured. Set REACT_APP_API_BASE (or REACT_APP_BACKEND_URL).",
    };
  }

  const candidates = ["/api/domain", "/domain"].map((p) => joinUrl(base, p));

  // Try candidates in order
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchJson(url);
    if (res.ok) {
      return { ok: true, state: res.data };
    }
  }

  return { ok: false, error: "Could not load data from the API endpoints." };
}
