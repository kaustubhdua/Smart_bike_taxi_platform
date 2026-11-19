import { getRateLimitClientIp } from "./client_ip.ts";

Deno.test("hosted rate limit uses CF-Connecting-IP, not caller X-Forwarded-For", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.9",
    "x-forwarded-for": "198.51.100.77, 203.0.113.9",
    "x-real-ip": "198.51.100.77",
  });
  const ip = getRateLimitClientIp(headers, "https://example-project.supabase.co");
  if (ip !== "203.0.113.9") throw new Error("expected trusted Cloudflare client IP");
});

Deno.test("hosted rate limit fails closed when authoritative client IP is absent", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.77",
    "x-real-ip": "198.51.100.77",
  });
  const ip = getRateLimitClientIp(headers, "https://example-project.supabase.co");
  if (ip !== null) throw new Error("hosted forwarding headers must not be trusted");
});

Deno.test("local Supabase gateway can use forwarded address for deterministic development", () => {
  const headers = new Headers({ "x-forwarded-for": "192.0.2.44, 10.0.0.1" });
  const ip = getRateLimitClientIp(headers, "http://kong:8000");
  if (ip !== "192.0.2.44") throw new Error("expected local forwarded address");
});

Deno.test("invalid Supabase URL fails closed", () => {
  const headers = new Headers({ "x-forwarded-for": "192.0.2.44" });
  const ip = getRateLimitClientIp(headers, "not a URL");
  if (ip !== null) throw new Error("invalid Supabase URL must not trust forwarding headers");
});
