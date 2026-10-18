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

async function geocode(place: string, signal: AbortSignal): Promise<[number, number]> {
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
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("The location service returned invalid coordinates.");
  return [lon, lat];
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
  // Nominatim's public service policy asks clients to stay at or below 1 request/sec.
  const start = await geocode(pickup, signal);
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Route lookup cancelled.", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Route lookup cancelled.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 1100);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const end = await geocode(destination, signal);
  const routeUrl = `${routingBase}/${start[0]},${start[1]};${end[0]},${end[1]}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(routeUrl, { signal, headers: { "Accept-Language": "en" } });
  if (!response.ok) throw new Error("The routing service is temporarily unavailable.");
  const result = await response.json() as OsrmRouteResponse;
  const route = result.routes?.[0];
  if (result.code !== "Ok" || !route || route.geometry.coordinates.length < 2) {
    throw new Error("No drivable route was found for these locations.");
  }
  return {
    distanceKm: route.distance / 1000,
    durationMinutes: Math.max(1, Math.round(route.duration / 60)),
    geometry: route.geometry.coordinates,
    provider: "OpenStreetMap + OSRM demo service",
  };
}

/** Project a GeoJSON [longitude, latitude] route into the existing SVG viewBox. */
export function routeToSvgPath(
  coordinates: Array<[number, number]>,
  width = 500,
  height = 260,
  padding = 24,
): string {
  if (coordinates.length < 2) return "";
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const lonSpan = maxLon - minLon || 1;
  const latSpan = maxLat - minLat || 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const scale = Math.min(usableWidth / lonSpan, usableHeight / latSpan);
  const drawnWidth = lonSpan * scale;
  const drawnHeight = latSpan * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;
  return coordinates.map(([longitude, latitude], index) => {
    const x = offsetX + (longitude - minLon) * scale;
    const y = height - offsetY - (latitude - minLat) * scale;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}
