import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("RIDEFORGE_ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function fail(status: number, code: string) { return reply({ error: code }, status); }
function validEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
async function body(req: Request) {
  const raw = await req.text();
  if (raw.length > 16384) throw new Error("request_too_large");
  try { return JSON.parse(raw); } catch { throw new Error("invalid_json"); }
}
async function currentAccount(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return { error: "authentication_required" as const };
  const token = header.slice(7);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return { error: "authentication_required" as const };
  const { data: account, error } = await admin.from("accounts")
    .select("id,email,display_name,phone,role,is_active")
    .eq("auth_user_id", user.id).maybeSingle();
  if (error || !account) return { error: "account_not_found" as const };
  if (!account.is_active) return { error: "account_inactive" as const };
  return { user, account };
}
async function register(req: Request) {
  const input = await body(req);
  if (!input || typeof input !== "object" || !validEmail(input.email) ||
      typeof input.password !== "string" || input.password.length < 12 ||
      input.password.length > 128 || typeof input.displayName !== "string") {
    return fail(422, "valid_email_display_name_and_12_character_password_required");
  }
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 120) return fail(422, "invalid_display_name");
  const { data, error } = await admin.auth.admin.createUser({
    email, password: input.password, email_confirm: false,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) return fail(409, "registration_failed");
  const { error: insertError } = await admin.from("accounts").insert({
    auth_user_id: data.user.id, email, display_name: displayName,
    role: "passenger", password_hash: "managed-by-supabase-auth",
  });
  if (insertError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return fail(409, "account_creation_failed");
  }
  // Email confirmation is required; no bearer session is issued here.
  return reply({ status: "confirmation_required", email }, 201);
}
async function login(req: Request) {
  const input = await body(req);
  if (!input || !validEmail(input.email) || typeof input.password !== "string" ||
      input.password.length < 1 || input.password.length > 128) return fail(422, "invalid_credentials");
  const { data, error } = await authClient.auth.signInWithPassword({
    email: input.email.trim().toLowerCase(), password: input.password,
  });
  if (error || !data.user || !data.session) return fail(401, "invalid_credentials");
  const { data: account, error: accountError } = await admin.from("accounts")
    .select("id,email,display_name,phone,role,is_active")
    .eq("auth_user_id", data.user.id).maybeSingle();
  if (accountError || !account) {
    await authClient.auth.signOut();
    return fail(403, "account_not_provisioned");
  }
  if (!account.is_active) {
    await admin.auth.admin.signOut(data.user.id, "global");
    return fail(403, "account_inactive");
  }
  return reply({
    token: data.session.access_token, refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at, account,
  });
}
async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const marker = "/functions/v1/rideforge-api";
  const path = url.pathname.includes(marker) ? url.pathname.slice(url.pathname.indexOf(marker) + marker.length) || "/" : url.pathname;
  if (req.method === "GET" && path === "/api/v1/health") return reply({ status: "ok", database: "connected", provider: "supabase" });
  if (req.method === "GET" && path === "/api/v1/ready") {
    const { data, error } = await admin.from("schema_migrations").select("version");
    if (error) return fail(503, "database_unavailable");
    const versions = new Set((data ?? []).map(x => x.version));
    const required = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(3, "0"));
    const present = [...versions].filter(v => required.some(n => v.startsWith(n + "_")));
    return reply({ status: present.length >= 16 ? "ready" : "not_ready", provider: "supabase", migrations: present.length, required: 16 }, present.length >= 16 ? 200 : 503);
  }
  if (req.method === "POST" && path === "/api/v1/auth/register") return await register(req);
  if (req.method === "POST" && path === "/api/v1/auth/login") return await login(req);
  if (path === "/api/v1/me" && req.method === "GET") {
    const result = await currentAccount(req);
    return "error" in result ? fail(401, result.error) : reply({ account: result.account });
  }
  if (path === "/api/v1/me" && req.method === "PATCH") {
    const result = await currentAccount(req);
    if ("error" in result) return fail(401, result.error);
    const input = await body(req);
    const patch: Record<string, string> = {};
    if (typeof input.displayName === "string" && input.displayName.trim().length > 0 && input.displayName.trim().length <= 120)
      patch.display_name = input.displayName.trim();
    if (typeof input.phone === "string" && input.phone.length <= 32) patch.phone = input.phone.trim();
    if (Object.keys(patch).length === 0) return fail(422, "no_valid_profile_fields");
    const { data, error } = await admin.from("accounts").update(patch).eq("id", result.account.id)
      .select("id,email,display_name,phone,role,is_active").single();
    return error ? fail(503, "profile_update_unavailable") : reply({ account: data });
  }
  return fail(404, "not_found");
}
Deno.serve(async (req) => {
  try { return await handler(req); }
  catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    if (message === "request_too_large") return fail(413, message);
    if (message === "invalid_json") return fail(400, message);
    console.error(JSON.stringify({ event: "request_failed", message }));
    return fail(500, "internal_error");
  }
});
