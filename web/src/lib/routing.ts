export type RouteResult = {
  distanceKm: number;
  durationMinutes: number;
  geometry: Array<[number, number]>;
  provider: string;
};

type GeocodingResult = { lat: string; lon: string; display_name: string };
type OsrmRouteResponse = {
  code: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: { coordinates: Array<[number, number]> };
  }>;
};

const geocodingBase = (import.meta.env.VITE_GEOCODING_BASE_URL as string | undefined)
  ?? "https://nominatim.openstreetmap.org/search";
const routingBase = (import.meta.env.VITE_ROUTING_BASE_URL as string | undefined)
  ?? "https://router.project-osrm.org/route/v1/driving";

// A short, in-memory cache avoids repeating external geocoding/routing work when
// a user revisits the same pickup/drop-off pair. It is intentionally bounded and
// expires quickly so route changes are not hidden for long.
const ROUTE_CACHE_TTL_MS = 2 * 60 * 1000;
const ROUTE_CACHE_MAX_ENTRIES = 100;
type CachedRoute = { result: RouteResult; expiresAt: number };
const routeCache = new Map<string, CachedRoute>();

// Successful geocodes are cached separately so changing only one endpoint does
// not repeatedly look up the unchanged endpoint.
const GEOCODE_CACHE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_MAX_ENTRIES = 200;
type CachedCoordinates = { coordinates: [number, number]; expiresAt: number };
const geocodeCache = new Map<string, CachedCoordinates>();

// Serialize uncached public Nominatim requests in this browser tab. The public
// service has a strict application-wide limit; this local limiter helps avoid
// accidental bursts but is not a cross-user or production rate limiter.
let geocodeQueue: Promise<void> = Promise.resolve();
let nextGeocodeAt = 0;

async function acquireGeocodeSlot(signal: AbortSignal): Promise<void> {
  let release!: () => void;
  const previous = geocodeQueue;
  geocodeQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    abortIfNeeded(signal);
    const waitMs = Math.max(0, nextGeocodeAt - Date.now());
    if (waitMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, waitMs);
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(new DOMException("Location lookup cancelled.", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    abortIfNeeded(signal);
    nextGeocodeAt = Date.now() + 1100;
  } finally {
    release();
  }
}

function cachedCoordinates(key: string): [number, number] | null {
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    geocodeCache.delete(key);
    return null;
  }
  geocodeCache.delete(key);
  geocodeCache.set(key, entry);
  return [...entry.coordinates] as [number, number];
}

function rememberCoordinates(key: string, coordinates: [number, number]): void {
  geocodeCache.delete(key);
  geocodeCache.set(key, { coordinates: [...coordinates] as [number, number], expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS });
  while (geocodeCache.size > GEOCODE_CACHE_MAX_ENTRIES) {
    const oldestKey = geocodeCache.keys().next().value;
    if (oldestKey === undefined) break;
    geocodeCache.delete(oldestKey);
  }
}

function routeCacheKey(pickup: string, destination: string): string {
  return `${pickup.trim().toLocaleLowerCase("en-US")}\u0000${destination.trim().toLocaleLowerCase("en-US")}`;
}

function copyRoute(result: RouteResult): RouteResult {
  return {
    ...result,
    geometry: result.geometry.map(([longitude, latitude]) => [longitude, latitude] as [number, number]),
  };
}

function cachedRoute(key: string): RouteResult | null {
  const entry = routeCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    routeCache.delete(key);
    return null;
  }
  // Refresh insertion order so the Map also behaves as a small LRU cache.
  routeCache.delete(key);
  routeCache.set(key, entry);
  return copyRoute(entry.result);
}

function rememberRoute(key: string, result: RouteResult): void {
  routeCache.delete(key);
  routeCache.set(key, { result: copyRoute(result), expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });
  while (routeCache.size > ROUTE_CACHE_MAX_ENTRIES) {
    const oldestKey = routeCache.keys().next().value;
    if (oldestKey === undefined) break;
    routeCache.delete(oldestKey);
  }
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Route lookup cancelled.", "AbortError");
}

async function geocode(place: string, signal: AbortSignal): Promise<[number, number]> {
  abortIfNeeded(signal);
  const cacheKey = place.trim().toLocaleLowerCase("en-US");
  const cached = cachedCoordinates(cacheKey);
  if (cached) return cached;
  await acquireGeocodeSlot(signal);

  const query = new URLSearchParams({
    q: `${place}, Noida, Uttar Pradesh, India`,
    format: "jsonv2",
    limit: "1",
  });
  const response = await fetch(`${geocodingBase}?${query}`, {
    signal,
    headers: { "Accept-Language": "en" },
  });
  if (!response.ok) throw new Error("Location search is temporarily unavailable.");
  const results = await response.json() as GeocodingResult[];
  const match = results[0];
  if (!match) throw new Error(`We couldn't find “${place}”. Try a more specific pickup or destination.`);
  const lat = Number(match.lat);
  const lon = Number(match.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error("The location service returned invalid coordinates.");
  }
  const coordinates: [number, number] = [lon, lat];
  rememberCoordinates(cacheKey, coordinates);
  return [...coordinates] as [number, number];
}

/**
 * Uses OpenStreetMap Nominatim for geocoding and the OSRM demo router for a
 * real road route. Public demo endpoints are rate-limited and are not suitable
 * as a production SLA; deploy a contracted/provider-backed adapter for launch.
 */
export async function calculateRoute(
  pickup: string,
  destination: string,
  signal: AbortSignal,
): Promise<RouteResult> {
  abortIfNeeded(signal);
  const key = routeCacheKey(pickup, destination);
  const cached = cachedRoute(key);
  if (cached) return cached;

  // Nominatim's public service policy asks clients to stay at or below 1 request/sec.
  const start = await geocode(pickup, signal);
  const end = await geocode(destination, signal);
  const routeUrl = `${routingBase}/${start[0]},${start[1]};${end[0]},${end[1]}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(routeUrl, { signal, headers: { "Accept-Language": "en" } });
  if (!response.ok) throw new Error("The routing service is temporarily unavailable.");
  const routeResponse = await response.json() as OsrmRouteResponse;
  const route = routeResponse?.routes?.[0];
  const coordinates: unknown = route?.geometry?.coordinates;
  if (routeResponse?.code !== "Ok" || !route || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error("No drivable route was found for these locations.");
  }
  if (
    !Number.isFinite(route.distance) || route.distance <= 0 ||
    !Number.isFinite(route.duration) || route.duration <= 0 ||
    coordinates.some((coordinate: unknown) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return true;
      const [longitude, latitude] = coordinate;
      return !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90;
    })
  ) {
    throw new Error("The routing service returned invalid route data. Please try again.");
  }
  const result: RouteResult = {
    distanceKm: route.distance / 1000,
    durationMinutes: Math.max(1, Math.round(route.duration / 60)),
    geometry: route.geometry.coordinates,
    provider: "OpenStreetMap + OSRM demo service",
  };
  rememberRoute(key, result);
  return copyRoute(result);
}

