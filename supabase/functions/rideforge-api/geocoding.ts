export type Coordinates = { lat: number; lon: number };

function validCoordinates(lat: unknown, lon: unknown): Coordinates | null {
  const latitude = typeof lat === "number" ? lat : Number(lat);
  const longitude = typeof lon === "number" ? lon : Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lon: longitude };
}

/** Accepts Nominatim's jsonv2 array and Photon GeoJSON FeatureCollection responses. */
export function parseGeocodingCoordinates(payload: unknown): Coordinates | null {
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (!first || typeof first !== "object") return null;
    const value = first as Record<string, unknown>;
    return validCoordinates(value.lat, value.lon);
  }
  if (!payload || typeof payload !== "object") return null;
  const features = (payload as Record<string, unknown>).features;
  if (!Array.isArray(features) || !features[0] || typeof features[0] !== "object") return null;
  const geometry = (features[0] as Record<string, unknown>).geometry;
  if (!geometry || typeof geometry !== "object") return null;
  const coordinates = (geometry as Record<string, unknown>).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  // GeoJSON coordinates are [longitude, latitude].
  return validCoordinates(coordinates[1], coordinates[0]);
}

/** Builds requests for Photon or Nominatim-compatible geocoders. */
export function buildGeocodingUrl(endpoint: string, label: string): URL {
  const url = new URL(endpoint);
  const query = label.trim() + ", Noida, Uttar Pradesh, India";
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  if (url.hostname.toLowerCase().includes("photon")) {
    url.searchParams.set("lang", "en");
    url.searchParams.set("lat", "28.5355");
    url.searchParams.set("lon", "77.3910");
  } else {
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("countrycodes", "in");
  }
  return url;
}
