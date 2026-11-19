import { createCorsHeaders } from "./cors.ts";

Deno.test("production Vercel origin is allowed without optional environment configuration", () => {
  const headers = createCorsHeaders("https://smart-bike-taxi-platform.vercel.app");
  if (headers["Access-Control-Allow-Origin"] !== "https://smart-bike-taxi-platform.vercel.app") throw new Error("production Vercel origin must be allowed");
});
Deno.test("local development origins require explicit configuration", () => {
  const denied = createCorsHeaders("http://localhost:5173");
  if ("Access-Control-Allow-Origin" in denied) throw new Error("localhost must not be implicitly allowed in production");
  const allowed = createCorsHeaders("http://localhost:5173", ["http://localhost:5173"]);
  if (allowed["Access-Control-Allow-Origin"] !== "http://localhost:5173") throw new Error("explicit local origin must be allowed");
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

Deno.test("Render production origin is allowed for browser API requests", () => {
  const headers = createCorsHeaders("https://rideforge-web.onrender.com");
  if (headers["Access-Control-Allow-Origin"] !== "https://rideforge-web.onrender.com") {
    throw new Error("Render production origin must be allowed");
  }
});
