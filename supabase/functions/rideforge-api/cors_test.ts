import { createCorsHeaders } from "./cors.ts";

Deno.test("production Vercel origin is allowed without optional environment configuration", () => {
  const headers = createCorsHeaders("https://smart-bike-taxi-platform.vercel.app");
  if (headers["Access-Control-Allow-Origin"] !== "https://smart-bike-taxi-platform.vercel.app") throw new Error("production Vercel origin must be allowed");
});
Deno.test("configured exact origins are allowed", () => {
  const headers = createCorsHeaders("https://rideforge.example.com", ["https://rideforge.example.com"]);
  if (headers["Access-Control-Allow-Origin"] !== "https://rideforge.example.com") throw new Error("configured origin must be allowed");
});
Deno.test("unrecognized origins receive no allow-origin header", () => {
  const headers = createCorsHeaders("https://attacker.example", ["https://rideforge.example.com"]);
  if ("Access-Control-Allow-Origin" in headers) throw new Error("unrecognized origin must not receive an allow-origin header");
});
Deno.test("non-browser requests remain usable without an Origin header", () => {
  const headers = createCorsHeaders(null);
  if (headers["Access-Control-Allow-Origin"] !== "*") throw new Error("requests without Origin should remain accessible to non-browser clients");
});
Deno.test("preflight advertises API methods and authorization header", () => {
  const headers = createCorsHeaders("https://smart-bike-taxi-platform.vercel.app");
  if (headers["Access-Control-Allow-Methods"] !== "GET, POST, PUT, PATCH, OPTIONS") throw new Error("unexpected CORS methods");
  if (!headers["Access-Control-Allow-Headers"].includes("authorization")) throw new Error("authorization header must be allowed");
});
