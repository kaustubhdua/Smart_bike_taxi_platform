import { assertEquals } from "jsr:@std/assert@1";
import { buildGeocodingUrl, parseGeocodingCoordinates } from "./geocoding.ts";

Deno.test("parses a Nominatim jsonv2 result", () => {
  assertEquals(parseGeocodingCoordinates([{ lat: "28.5355", lon: "77.3910" }]), { lat: 28.5355, lon: 77.391 });
});

Deno.test("parses a Photon GeoJSON feature", () => {
  assertEquals(parseGeocodingCoordinates({
    type: "FeatureCollection",
    features: [{ geometry: { type: "Point", coordinates: [77.3659633, 28.5193178] } }],
  }), { lat: 28.5193178, lon: 77.3659633 });
});

Deno.test("rejects malformed and out-of-range provider coordinates", () => {
  assertEquals(parseGeocodingCoordinates(null), null);
  assertEquals(parseGeocodingCoordinates([{ lat: "91", lon: "77" }]), null);
  assertEquals(parseGeocodingCoordinates({ features: [{ geometry: { coordinates: [200, 28] } }] }), null);
  assertEquals(parseGeocodingCoordinates({ features: [] }), null);
});

Deno.test("builds Photon queries with Noida bias", () => {
  const url = buildGeocodingUrl("https://photon.komoot.io/api/", "JIIT Sector 128");
  assertEquals(url.searchParams.get("q"), "JIIT Sector 128, Noida, Uttar Pradesh, India");
  assertEquals(url.searchParams.get("limit"), "1");
  assertEquals(url.searchParams.get("lat"), "28.5355");
  assertEquals(url.searchParams.get("lon"), "77.3910");
});

Deno.test("builds Nominatim queries constrained to India", () => {
  const url = buildGeocodingUrl("https://nominatim.openstreetmap.org/search", "Sector 18 Market");
  assertEquals(url.searchParams.get("format"), "jsonv2");
  assertEquals(url.searchParams.get("countrycodes"), "in");
});
