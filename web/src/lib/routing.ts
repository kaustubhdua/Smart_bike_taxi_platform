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
const MAX_GEOCODING_RESPONSE_BYTES = 64 * 1024;
const MAX_ROUTING_RESPONSE_BYTES = 1024 * 1024;

async function readJsonBounded<T>(response: Response, maxBytes: number, errorMessage: string): Promise<T> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel(); } catch { /* The body may already be closed. */ }
    throw new Error(errorMessage);
  }

  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(errorMessage);
    return JSON.parse(text) as T;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch { /* The stream may already be closed. */ }
        throw new Error(errorMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}


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
  const results = await readJsonBounded<GeocodingResult[]>(response, MAX_GEOCODING_RESPONSE_BYTES, "The location service returned an oversized response.");
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

export type PlaceSuggestion = { label: string; detail: string; coordinates: [number, number] };

// Nominatim's usage policy forbids search-as-you-type against the public service, so
// by default suggestions are fetched only when the user explicitly submits a search.
// Pointing VITE_AUTOCOMPLETE_URL at a Photon-compatible endpoint (Apache-2.0, built for
// typeahead; self-hosted or contracted) enables as-you-type suggestions.
const autocompleteBase = (import.meta.env.VITE_AUTOCOMPLETE_URL as string | undefined) || "";
export const suggestionMode: "typeahead" | "submit" = autocompleteBase ? "typeahead" : "submit";
const MAX_SUGGESTIONS = 6;

function validCoordinates(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

function splitDisplayName(displayName: string): { label: string; detail: string } {
  const parts = displayName.split(",").map(part => part.trim()).filter(Boolean);
  const label = (parts.slice(0, 2).join(", ") || displayName).slice(0, 120);
  const detail = parts.slice(2, 5).join(", ").slice(0, 120);
  return { label, detail };
}

function dedupeSuggestions(items: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>();
  const unique: PlaceSuggestion[] = [];
  for (const item of items) {
    const key = item.label.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    // Remember the exact coordinates the user picked so routing does not geocode the
    // label a second time (and cannot resolve it to a different place).
    unique.push(item);
    if (unique.length >= MAX_SUGGESTIONS) break;
  }
  return unique;
}

/** Remember a chosen suggestion so the route lookup reuses its coordinates. */
export function rememberSelectedPlace(place: PlaceSuggestion): void {
  rememberCoordinates(place.label.trim().toLocaleLowerCase("en-US"), place.coordinates);
}

export async function searchPlaces(query: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  abortIfNeeded(signal);
  const text = query.trim();
  if (text.length < 3) return [];
  if (suggestionMode === "typeahead") {
    // Photon: GeoJSON FeatureCollection, coordinates are [lon, lat].
    const params = new URLSearchParams({ q: text, limit: String(MAX_SUGGESTIONS), lang: "en",
      lat: "28.57", lon: "77.35" });
    const response = await fetch(`${autocompleteBase}?${params}`, { signal });
    if (!response.ok) throw new Error("Place suggestions are temporarily unavailable.");
    const data = await readJsonBounded<{ features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, string | undefined>;
    }> }>(response, MAX_GEOCODING_RESPONSE_BYTES, "The location service returned an oversized response.");
    const items: PlaceSuggestion[] = [];
    for (const feature of data.features ?? []) {
      const [lon, lat] = feature.geometry?.coordinates ?? [Number.NaN, Number.NaN];
      const props = feature.properties ?? {};
      const label = [props.name ?? props.street, props.district ?? props.city].filter(Boolean).join(", ");
      if (!label || !validCoordinates(lon, lat)) continue;
      items.push({ label: label.slice(0, 120), detail: [props.city, props.state].filter(Boolean).join(", ").slice(0, 120), coordinates: [lon, lat] });
    }
    return dedupeSuggestions(items);
  }
  await acquireGeocodeSlot(signal);
  const params = new URLSearchParams({
    q: text,
    format: "jsonv2",
    limit: String(MAX_SUGGESTIONS),
    countrycodes: "in",
    // Prefer (but do not force) results around Noida / Delhi NCR.
    viewbox: "76.8,28.9,77.7,28.3",
    bounded: "0",
  });
  const response = await fetch(`${geocodingBase}?${params}`, { signal, headers: { "Accept-Language": "en" } });
  if (!response.ok) throw new Error("Location search is temporarily unavailable.");
  const results = await readJsonBounded<GeocodingResult[]>(response, MAX_GEOCODING_RESPONSE_BYTES, "The location service returned an oversized response.");
  const items: PlaceSuggestion[] = [];
  for (const match of Array.isArray(results) ? results : []) {
    const lon = Number(match.lon);
    const lat = Number(match.lat);
    if (!validCoordinates(lon, lat) || typeof match.display_name !== "string") continue;
    items.push({ ...splitDisplayName(match.display_name), coordinates: [lon, lat] });
  }
  return dedupeSuggestions(items);
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
  const routeResponse = await readJsonBounded<OsrmRouteResponse>(response, MAX_ROUTING_RESPONSE_BYTES, "The routing service returned an oversized response.");
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

