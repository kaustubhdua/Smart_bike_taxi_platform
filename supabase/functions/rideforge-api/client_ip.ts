/**
 * Resolve the caller address used by the public route-quote rate limiter.
 *
 * Hosted Supabase traffic must use Cloudflare's edge-overwritten
 * CF-Connecting-IP. X-Forwarded-For is caller-controlled and must not be
 * trusted on hosted ingress. Forwarding headers are accepted only for the
 * local Supabase gateway used by the disposable development stack.
 */
export function getRateLimitClientIp(headers: Headers, supabaseUrl: string): string | null {
  const cloudflareIp = headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  let hostname = "";
  try {
    hostname = new URL(supabaseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  const localGateway = ["localhost", "127.0.0.1", "::1", "kong"].includes(hostname);
  if (!localGateway) return null;

  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  return forwarded || realIp || null;
}
