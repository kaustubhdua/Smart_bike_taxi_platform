export type Coordinates = {
  latitude: number;
  longitude: number;
};

type PhotonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

type PhotonResponse = { features?: PhotonFeature[] };

let nextPhotonRequestAt = 0;

async function requestPhoton(url: URL): Promise<PhotonResponse> {
  const waitMs = nextPhotonRequestAt - Date.now();
  if (waitMs > 0) await new Promise(resolve => window.setTimeout(resolve, waitMs));
  nextPhotonRequestAt = Date.now() + 1100;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error("Address lookup is temporarily unavailable. Try again or use your current location.");
  }
  return await response.json() as PhotonResponse;
}

function displayName(properties: Record<string, unknown> | undefined, fallback: string): string {
  const fields = ["name", "street", "district", "city", "county", "state", "country"];
  const parts = fields
    .map(field => properties?.[field])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(value => value.trim());
  return [...new Set(parts)].join(", ") || fallback;
}

function parseFeature(feature: PhotonFeature | undefined, fallback: string): Coordinates & { displayName: string } {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error("We couldn't find that location. Try a nearby landmark or a more specific address.");
  }
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("The address provider returned invalid coordinates. Try another landmark.");
  }
  return {
    latitude,
    longitude,
    displayName: displayName(feature?.properties, fallback),
  };
}

/** Resolve one location only after the passenger explicitly requests a quote. */
export async function geocodeNoidaLocation(label: string): Promise<Coordinates> {
  const cleanLabel = label.trim();
  if (cleanLabel.length < 3) throw new Error("Enter a more specific pickup or drop-off location.");
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", cleanLabel + ", Noida, Uttar Pradesh, India");
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "en");
  url.searchParams.set("lat", "28.5355");
  url.searchParams.set("lon", "77.3910");
  const data = await requestPhoton(url);
  return parseFeature(data.features?.[0], cleanLabel);
}

/** Reverse lookup is used only after the passenger explicitly grants GPS permission. */
export async function reverseGeocodeNoidaLocation(
  coordinates: Coordinates,
): Promise<Coordinates & { displayName: string }> {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat", String(coordinates.latitude));
  url.searchParams.set("lon", String(coordinates.longitude));
  url.searchParams.set("lang", "en");
  const data = await requestPhoton(url);
  return parseFeature(data.features?.[0], "Current GPS location");
}
