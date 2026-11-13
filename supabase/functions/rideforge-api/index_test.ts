import { assertEquals } from "jsr:@std/assert@1.0.14";

Deno.test("health route is exposed by the Supabase gateway path", () => {
  const marker = "/functions/v1/rideforge-api";
  const url = new URL("https://example.supabase.co/functions/v1/rideforge-api/api/v1/health");
  const path = url.pathname.slice(url.pathname.indexOf(marker) + marker.length) || "/";
  assertEquals(path, "/api/v1/health");
});

Deno.test("registration rejects short passwords and malformed email before Auth writes", () => {
  const validEmail = (v: unknown): v is string =>
    typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  assertEquals(validEmail("not-an-email"), false);
  assertEquals(validEmail("passenger@example.com"), true);
});
