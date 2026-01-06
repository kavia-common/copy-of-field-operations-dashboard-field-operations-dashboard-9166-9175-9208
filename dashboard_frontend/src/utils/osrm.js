const OSRM_BASE_URL = "https://router.project-osrm.org";

/**
 * Simple in-memory LRU cache.
 * MapPanel already has createLruCache in domainStore, but this util is used by
 * other map components that need OSRM snapping without depending on domainStore internals.
 */
function createLruCache(maxEntries = 100) {
  const max = Math.max(10, Number(maxEntries) || 100);
  const map = new Map();

  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const v = map.get(key);
      // refresh recency
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      if (!key) return;
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > max) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
      }
    },
    has(key) {
      return map.has(key);
    },
    size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
  };
}

/**
 * Decodes an OSRM polyline6 string into an array of [lat, lng] pairs.
 * Polyline6 uses 1e-6 precision.
 */
function decodePolyline6(str) {
  if (!str || typeof str !== "string") return [];
  let index = 0;
  const len = str.length;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push([lat / 1e6, lng / 1e6]);
  }

  return coordinates;
}

function buildOsrmRouteUrl(waypointsLonLat) {
  const coords = (waypointsLonLat || []).map((p) => `${p[0]},${p[1]}`).join(";");
  const u = new URL(`${OSRM_BASE_URL}/route/v1/driving/${coords}`);
  u.searchParams.set("overview", "full");
  u.searchParams.set("geometries", "polyline6");
  u.searchParams.set("annotations", "duration,distance");
  return u.toString();
}

// PUBLIC_INTERFACE
export function stableWaypointsHash(waypointsLonLat, { decimals = 5 } = {}) {
  /**
   * Stable hash for waypoints for caching purposes.
   * We intentionally keep this local to avoid importing domainStore into small components.
   */
  const d = Math.max(0, Math.min(8, Number(decimals) || 5));
  return (waypointsLonLat || [])
    .map((p) => {
      const lon = Number(p?.[0]);
      const lat = Number(p?.[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return "x";
      return `${lon.toFixed(d)},${lat.toFixed(d)}`;
    })
    .join("|");
}

// PUBLIC_INTERFACE
export function toLonLatFromLatLngPoints(points) {
  /** Convert [{lat,lng},...] -> [[lon,lat],...] filtering invalid points. */
  return (points || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lng, p.lat]);
}

// PUBLIC_INTERFACE
export async function fetchOsrmSnappedRoute(waypointsLonLat, { signal } = {}) {
  /**
   * Fetch a snapped/drivable route line from the OSRM demo server.
   * Returns { ok: true, latLngs, distance, duration, source } or { ok:false, error }.
   *
   * Graceful fallback strategy is implemented by callers: if ok=false, they should
   * draw the straight-line geometry.
   */
  if (!Array.isArray(waypointsLonLat) || waypointsLonLat.length < 2) {
    return { ok: false, error: "Need at least 2 waypoints." };
  }
  if (waypointsLonLat.length > 50) {
    return { ok: false, error: "Too many waypoints for demo routing." };
  }

  const url = buildOsrmRouteUrl(waypointsLonLat);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return { ok: false, error: `OSRM HTTP ${res.status}` };

    const json = await res.json();
    const route = json?.routes?.[0];
    const geom = route?.geometry;
    if (!geom) return { ok: false, error: "OSRM response missing geometry." };

    const latLngs = decodePolyline6(geom);
    if (!latLngs || latLngs.length < 2) return { ok: false, error: "Decoded route too short." };

    return {
      ok: true,
      latLngs,
      distance: Number(route?.distance || 0),
      duration: Number(route?.duration || 0),
      source: "osrm",
    };
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, error: "aborted" };
    return { ok: false, error: e?.message || "Network error" };
  }
}

function createConcurrencyLimiter(maxConcurrent = 2) {
  const max = Math.max(1, Number(maxConcurrent) || 2);
  let inFlight = 0;
  const queue = [];

  const runNext = () => {
    if (inFlight >= max) return;
    const item = queue.shift();
    if (!item) return;

    inFlight += 1;
    const { fn, resolve } = item;

    Promise.resolve()
      .then(fn)
      .then((v) => resolve(v))
      .catch((err) => resolve({ ok: false, error: err?.message || "error" }))
      .finally(() => {
        inFlight -= 1;
        runNext();
      });
  };

  return (fn) =>
    new Promise((resolve) => {
      queue.push({ fn, resolve });
      runNext();
    });
}

// PUBLIC_INTERFACE
export function createOsrmSnapper({ maxCacheEntries = 120, maxConcurrent = 2 } = {}) {
  /**
   * Creates a reusable OSRM snapper with:
   * - LRU cache (in-memory)
   * - inflight dedupe per key
   * - concurrency limiting
   *
   * Intended for planned routes: given a cacheKey + waypoints, returns snapped latLngs.
   */
  const cache = createLruCache(maxCacheEntries);
  const limiter = createConcurrencyLimiter(maxConcurrent);
  const inflight = new Map();
  const abortByKey = new Map();

  async function snap({ key, waypointsLonLat }) {
    if (!key) return { ok: false, error: "missing key" };

    const cached = cache.get(key);
    if (cached?.latLngs?.length >= 2) return { ok: true, ...cached, cached: true };

    if (inflight.has(key)) return inflight.get(key);

    const p = limiter(async () => {
      // abort previous request for same key (if any)
      try {
        abortByKey.get(key)?.abort?.();
      } catch {
        // no-op
      }

      const ctl = new AbortController();
      abortByKey.set(key, ctl);

      const res = await fetchOsrmSnappedRoute(waypointsLonLat, { signal: ctl.signal });
      if (!res.ok) return res;

      const payload = { latLngs: res.latLngs, distance: res.distance, duration: res.duration, source: "osrm" };
      cache.set(key, payload);
      return { ok: true, ...payload };
    });

    inflight.set(key, p);

    try {
      const out = await p;
      return out;
    } finally {
      inflight.delete(key);
    }
  }

  function cleanup() {
    try {
      abortByKey.forEach((ctl) => ctl?.abort?.());
      abortByKey.clear();
    } catch {
      // no-op
    }
    try {
      inflight.clear();
    } catch {
      // no-op
    }
  }

  return { snap, cache, cleanup };
}
