const FIXED_ORIGINS = [
  "https://smart-bike-taxi-platform.vercel.app",
] as const;

const ALLOW_HEADERS = "authorization, apikey, content-type, idempotency-key, last-event-id, x-client-info";
const ALLOW_METHODS = "GET, POST, PUT, PATCH, OPTIONS";

export function createCorsHeaders(origin: string | null, configuredOrigins: string[] = []): Record<string, string> {
  const allowed = new Set([
    ...FIXED_ORIGINS,
    ...configuredOrigins.map(value => value.trim()).filter(Boolean),
  ]);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Vary": "Origin",
  };
  if (origin === null) headers["Access-Control-Allow-Origin"] = "*";
  else if (allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
