import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const publicAuth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = (origin: string | null) => {
  const allowed = (Deno.env.get("RIDEFORGE_ALLOWED_ORIGINS") ?? "").split(",").map(v => v.trim()).filter(Boolean);
  const allowOrigin = origin && (allowed.length === 0 || allowed.includes(origin)) ? origin : (allowed.length === 0 ? "*" : allowed[0]);
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key, last-event-id, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Vary": "Origin",
  };
};
const json = (data: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (message: string, status = 400, origin: string | null = null) => json({ error: message }, status, origin);
const parseBody = async (req: Request): Promise<Record<string, unknown>> => {
  try { const value = await req.json(); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  catch { return {}; }
};
const clean = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const accountView = (a: Record<string, unknown>) => ({
  email: a.email, displayName: a.display_name, role: a.role,
});

type Context = { user: User; account: Record<string, unknown> };
async function authenticate(req: Request, roles: string[] = []): Promise<Context | Response> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return fail("Authentication required.", 401, req.headers.get("Origin"));
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return fail("Invalid or expired session.", 401, req.headers.get("Origin"));
  const { data: account, error: accountError } = await db.from("accounts").select("*").eq("id", user.id).maybeSingle();
  if (accountError || !account || !account.is_active) return fail("Account is unavailable.", 403, req.headers.get("Origin"));
  if (roles.length && !roles.includes(String(account.role))) return fail("Insufficient permissions.", 403, req.headers.get("Origin"));
  return { user, account };
}
const isResponse = (value: Context | Response): value is Response => value instanceof Response;
const adminOnly = (ctx: Context) => ctx.account.role === "admin";
const mapRide = (r: Record<string, unknown>) => ({
  rideId: r.id, status: r.status, pickup: r.pickup_label, destination: r.destination_label,
  farePaise: r.quoted_fare_paise, finalFarePaise: r.final_fare_paise,
  currency: r.currency, createdAt: r.created_at, completedAt: r.completed_at,
});
const mapReport = (r: Record<string, unknown>) => ({
  id: String(r.id), rideId: r.ride_id, category: r.category, description: r.description,
  status: r.status, resolutionNote: r.resolution_note, createdAt: r.created_at,
  updatedAt: r.updated_at, resolvedAt: r.resolved_at,
});

async function quoteRoute(body: Record<string, unknown>) {
  const pickup = body.pickup && typeof body.pickup === "object" ? body.pickup as Record<string, unknown> : {};
  const destination = body.destination && typeof body.destination === "object" ? body.destination as Record<string, unknown> : {};
  const pickupLabel = clean(pickup.label);
  const destinationLabel = clean(destination.label);
  if (pickupLabel.length < 3 || destinationLabel.length < 3 || pickupLabel.toLowerCase() === destinationLabel.toLowerCase()) {
    return { error: "Enter two different pickup and destination locations.", status: 422 };
  }
  const geoUrl = Deno.env.get("RIDEFORGE_GEOCODING_URL") ?? "https://nominatim.openstreetmap.org/search";
  const routeUrl = Deno.env.get("RIDEFORGE_ROUTING_URL") ?? "https://router.project-osrm.org/route/v1/driving";
  const userAgent = Deno.env.get("RIDEFORGE_USER_AGENT") ?? "RideForge/1.0 (https://github.com/kaustubhdua/Smart_bike_taxi_platform)";
  const geocode = async (label: string) => {
    const url = new URL(geoUrl);
    url.searchParams.set("q", label + ", Noida, Uttar Pradesh, India");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    const response = await fetch(url, { headers: { "User-Agent": userAgent, "Accept": "application/json" } });
    if (!response.ok) throw new Error("Geocoding provider unavailable.");
    const results = await response.json();
    if (!Array.isArray(results) || !results[0]) throw new Error("Location could not be found.");
    return { lat: Number(results[0].lat), lon: Number(results[0].lon) };
  };
  try {
    const [p, d] = await Promise.all([geocode(pickupLabel), geocode(destinationLabel)]);
    const response = await fetch(routeUrl + "/" + p.lon + "," + p.lat + ";" + d.lon + "," + d.lat + "?overview=full&geometries=geojson&steps=false", { headers: { "Accept": "application/json", "User-Agent": userAgent } });
    if (!response.ok) throw new Error("Routing provider unavailable.");
    const result = await response.json();
    const route = result?.routes?.[0];
    if (!route || !Number.isFinite(route.distance) || route.distance <= 0 || !Number.isFinite(route.duration)) throw new Error("No drivable route was found.");
    const distanceM = Math.round(route.distance);
    const farePaise = 2000 + Math.round(distanceM * 1.1);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const geometry = route.geometry?.coordinates;
    const { data: saved, error } = await db.from("route_quotes").insert({
      pickup_label: pickupLabel, pickup_latitude: p.lat, pickup_longitude: p.lon,
      destination_label: destinationLabel, destination_latitude: d.lat, destination_longitude: d.lon,
      route_distance_m: distanceM, route_duration_seconds: Math.round(route.duration),
      fare_paise: farePaise, currency: "INR", expires_at: expiresAt,
    }).select("id,expires_at").single();
    if (error || !saved) throw new Error("Could not persist the fare quote.");
    return {
      quoteId: saved.id, farePaise, baseFarePaise: 2000,
      distanceFarePaise: farePaise - 2000, distanceKm: distanceM / 1000,
      durationMinutes: Math.max(1, Math.round(route.duration / 60)), expiresAt: saved.expires_at,
      fareBreakdown: { baseFarePaise: 2000, distanceFarePaise: farePaise - 2000, pricingModel: "demo_base_plus_distance" },
      currency: "INR", geometry,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Route quote unavailable.", status: 503 };
  }
}

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  const url = new URL(req.url);
  const marker = url.pathname.indexOf("/api/v1");
  const path = marker >= 0 ? url.pathname.slice(marker + 7) || "/" : url.pathname.replace(/^\/rideforge-api/, "") || "/";
  const method = req.method.toUpperCase();
  const body = ["POST", "PUT", "PATCH"].includes(method) ? await parseBody(req) : {};

  // Supabase Auth replaces the custom password/token implementation.
  if (path === "/auth/register" && method === "POST") {
    const email = clean(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = clean(body.displayName, 120);
    if (!email.includes("@") || password.length < 12 || password.length > 128 || !displayName) return fail("Enter a valid email, display name and password of at least 12 characters.", 422, origin);
    const { data, error } = await publicAuth.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
    if (error) return fail(error.message, error.status ?? 400, origin);
    if (!data.session) return json({ verificationRequired: true, message: "Check your email to verify your account, then sign in." }, 202, origin);
    const { data: account } = await db.from("accounts").select("*").eq("id", data.user!.id).single();
    return json({ accessToken: data.session.access_token, account: accountView(account) }, 201, origin);
  }
  if (path === "/auth/login" && method === "POST") {
    const { data, error } = await publicAuth.auth.signInWithPassword({ email: clean(body.email, 254).toLowerCase(), password: typeof body.password === "string" ? body.password : "" });
    if (error || !data.session || !data.user) return fail("Email or password is incorrect.", 401, origin);
    const { data: account, error: accountError } = await db.from("accounts").select("*").eq("id", data.user.id).maybeSingle();
    if (accountError || !account || !account.is_active) return fail("Account is unavailable.", 403, origin);
    return json({ accessToken: data.session.access_token, account: accountView(account) }, 200, origin);
  }

  if (path === "/health" && method === "GET") return json({ status: "ok", backend: "supabase" }, 200, origin);
  if (path === "/ready" && method === "GET") {
    const { error } = await db.from("schema_migrations").select("version").limit(1);
    return error ? fail("Database not ready.", 503, origin) : json({ status: "ready", backend: "supabase" }, 200, origin);
  }

  if (path === "/routes/quote" && method === "POST") {
    const result = await quoteRoute(body);
    return "status" in result ? fail(String(result.error), Number(result.status), origin) : json(result, 200, origin);
  }

  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const accountId = ctx.user.id;
  const account = ctx.account;

  if (path === "/me" && method === "GET") return json({ email: account.email, displayName: account.display_name, role: account.role }, 200, origin);
  if (path === "/me" && method === "PATCH") {
    const displayName = clean(body.displayName, 120);
    if (!displayName) return fail("Display name is required.", 422, origin);
    const { error } = await db.from("accounts").update({ display_name: displayName, updated_at: new Date().toISOString() }).eq("id", accountId);
    return error ? fail("Could not update profile.", 500, origin) : json({ displayName }, 200, origin);
  }

  if (path === "/rides" && method === "GET") {
    const { data, error } = await db.from("rides").select("*").eq("passenger_id", accountId).order("created_at", { ascending: false }).limit(50);
    return error ? fail("Could not load trip history.", 500, origin) : json({ rides: (data ?? []).map(mapRide) }, 200, origin);
  }
  if (path === "/rides" && method === "POST") {
    if (account.role !== "passenger") return fail("Passenger account required.", 403, origin);
    const quoteId = clean(body.quoteId, 64);
    const idempotencyKey = clean(req.headers.get("Idempotency-Key"), 160);
    if (!quoteId || idempotencyKey.length < 8) return fail("A valid quote and idempotency key are required.", 422, origin);
    const { data, error } = await db.rpc("rideforge_create_booking", { p_passenger_id: accountId, p_quote_id: quoteId, p_idempotency_key: idempotencyKey });
    if (error) return fail(error.message.includes("quote") ? "Quote unavailable or expired." : "Could not create booking.", error.code === "23505" ? 409 : 422, origin);
    await db.rpc("rideforge_dispatch_ride", { p_ride_id: data.rideId });
    return json(data, 201, origin);
  }

  const ridePath = path.match(/^\/rides\/([0-9a-f-]+)(?:\/(cancel|events))?$/i);
  if (ridePath && method === "GET" && !ridePath[2]) {
    const { data: ride, error } = await db.from("rides").select("*").eq("id", ridePath[1]).maybeSingle();
    if (error || !ride || (ride.passenger_id !== accountId && ride.driver_id !== accountId)) return fail("Ride not found.", 404, origin);
    let driverLocation: Record<string, unknown> | undefined;
    if (ride.driver_id) {
      const { data: dp } = await db.from("driver_profiles").select("current_latitude,current_longitude,last_location_at").eq("account_id", ride.driver_id).maybeSingle();
      if (dp?.last_location_at && Date.now() - Date.parse(dp.last_location_at) < 120_000) driverLocation = { latitude: dp.current_latitude, longitude: dp.current_longitude, updatedAt: dp.last_location_at };
    }
    return json({ ...mapRide(ride), ...(driverLocation ? { driverLocation } : {}) }, 200, origin);
  }
  if (ridePath && ridePath[2] === "cancel" && method === "POST") {
    const { data, error } = await db.rpc("rideforge_cancel_ride", { p_passenger_id: accountId, p_ride_id: ridePath[1] });
    return error ? fail("Ride cannot be cancelled.", 409, origin) : json(data, 200, origin);
  }
  if (ridePath && ridePath[2] === "events" && method === "GET") {
    const rideId = ridePath[1];
    const { data: ride } = await db.from("rides").select("id,passenger_id,driver_id").eq("id", rideId).maybeSingle();
    if (!ride || (ride.passenger_id !== accountId && ride.driver_id !== accountId)) return fail("Ride not found.", 404, origin);
    const startId = Number(req.headers.get("Last-Event-ID") ?? "0") || 0;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        let cursor = startId;
        const until = Date.now() + 25_000;
        try {
          while (Date.now() < until) {
            const { data: events } = await db.from("ride_events").select("id,new_status").eq("ride_id", rideId).gt("id", cursor).order("id", { ascending: true }).limit(20);
            for (const event of events ?? []) {
              cursor = Number(event.id);
              controller.enqueue(encoder.encode(`id: ${cursor}\ndata: ${JSON.stringify({ rideId, status: event.new_status })}\n\n`));
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          controller.close();
        } catch { try { controller.close(); } catch { /* closed */ } }
      },
    });
    return new Response(stream, { headers: { ...corsHeaders(origin), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
  }

  if (path === "/driver/availability" && method === "PUT") {
    if (account.role !== "driver") return fail("Driver account required.", 403, origin);
    const online = body.online === true;
    const latitude = num(body.latitude), longitude = num(body.longitude);
    const { error } = await db.rpc("rideforge_update_driver_availability", { p_driver_id: accountId, p_online: online, p_latitude: latitude, p_longitude: longitude });
    return error ? fail(error.message.includes("approved") ? "Driver approval is required before going online." : "Could not update availability.", 403, origin) : json({ online }, 200, origin);
  }
  if (path === "/driver/rides" && method === "GET") {
    if (account.role !== "driver") return fail("Driver account required.", 403, origin);
    const { data: dp } = await db.from("driver_profiles").select("is_approved,is_online,last_location_at").eq("account_id", accountId).maybeSingle();
    if (!dp?.is_approved || !dp.is_online || !dp.last_location_at || Date.now() - Date.parse(dp.last_location_at) > 120_000) return json({ rides: [] }, 200, origin);
    const { data: pending } = await db.from("rides").select("id").in("status", ["requested", "matching"]).is("driver_id", null).order("created_at").limit(20);
    for (const ride of pending ?? []) await db.rpc("rideforge_dispatch_ride", { p_ride_id: ride.id });
    const { data: offers } = await db.from("ride_offers").select("ride_id,expires_at").eq("driver_id", accountId).eq("status", "offered").gt("expires_at", new Date().toISOString()).order("offered_at");
    const ids = (offers ?? []).map(o => o.ride_id);
    if (!ids.length) return json({ rides: [] }, 200, origin);
    const { data: rides } = await db.from("rides").select("*").in("id", ids);
    const expiry = new Map((offers ?? []).map(o => [o.ride_id, o.expires_at]));
    return json({ rides: (rides ?? []).map(r => ({ rideId: r.id, pickup: r.pickup_label, destination: r.destination_label, distanceMeters: r.route_distance_m, farePaise: r.quoted_fare_paise, offerExpiresAt: expiry.get(r.id) })) }, 200, origin);
  }
  if (path === "/driver/rides/history" && method === "GET") {
    if (account.role !== "driver") return fail("Driver account required.", 403, origin);
    const { data } = await db.from("rides").select("*").eq("driver_id", accountId).order("created_at", { ascending: false }).limit(50);
    const rides = data ?? [];
    return json({ rides: rides.map(mapRide), grossCompletedFarePaise: rides.filter(r => r.status === "completed").reduce((sum, r) => sum + Number(r.final_fare_paise ?? 0), 0), currency: "INR", note: "Gross completed fares are not a payout ledger." }, 200, origin);
  }
  const driverRidePath = path.match(/^\/driver\/rides\/([0-9a-f-]+)\/(accept|decline|status)$/i);
  if (driverRidePath && account.role === "driver") {
    const [, rideId, action] = driverRidePath;
    if (action === "accept" && method === "POST") {
      const { data, error } = await db.rpc("rideforge_accept_offer", { p_driver_id: accountId, p_ride_id: rideId });
      return error ? fail("This offer is expired or no longer available.", 409, origin) : json(data, 200, origin);
    }
    if (action === "decline" && method === "POST") {
      const { error: offerError } = await db.from("ride_offers").update({ status: "declined", responded_at: new Date().toISOString() }).eq("ride_id", rideId).eq("driver_id", accountId).eq("status", "offered");
      if (offerError) return fail("Could not decline ride.", 500, origin);
      const { error } = await db.from("driver_ride_declines").upsert({ ride_id: rideId, driver_id: accountId }, { onConflict: "ride_id,driver_id" });
      return error ? fail("Could not save decline.", 500, origin) : json({ rideId, status: "declined" }, 200, origin);
    }
    if (action === "status" && method === "PUT") {
      const status = clean(body.status, 32);
      const { data, error } = await db.rpc("rideforge_advance_ride", { p_driver_id: accountId, p_ride_id: rideId, p_status: status });
      return error ? fail("Ride transition is not allowed.", 409, origin) : json(data, 200, origin);
    }
  }

  if (path === "/support/reports" && method === "GET") {
    const { data, error } = await db.from("support_reports").select("*").eq("reporter_id", accountId).order("created_at", { ascending: false }).limit(50);
    return error ? fail("Could not load support reports.", 500, origin) : json({ reports: (data ?? []).map(mapReport) }, 200, origin);
  }
  if (path === "/support/reports" && method === "POST") {
    const category = clean(body.category, 32), description = clean(body.description, 2000), rideId = clean(body.rideId, 64) || null;
    if (!["booking","driver","payment","safety","technical","other"].includes(category) || description.length < 10) return fail("Provide a valid category and a description of at least 10 characters.", 422, origin);
    if (rideId) {
      const { data: ride } = await db.from("rides").select("id").eq("id", rideId).or(`passenger_id.eq.${accountId},driver_id.eq.${accountId}`).maybeSingle();
      if (!ride) return fail("Ride not found.", 404, origin);
    }
    const { count } = await db.from("support_reports").select("id", { count: "exact", head: true }).eq("reporter_id", accountId).gte("created_at", new Date(Date.now()-3600_000).toISOString());
    if ((count ?? 0) >= 5) return fail("Hourly support report limit reached.", 429, origin);
    const { data, error } = await db.from("support_reports").insert({ reporter_id: accountId, ride_id: rideId, category, description }).select("*").single();
    return error ? fail("Could not submit support report.", 500, origin) : json(mapReport(data), 201, origin);
  }

  if (path.startsWith("/admin/")) {
    if (!adminOnly(ctx)) return fail("Administrator access required.", 403, origin);
    if (path === "/admin/metrics" && method === "GET") {
      const [rides, drivers, pending, dead] = await Promise.all([
        db.from("rides").select("status"),
        db.from("driver_profiles").select("account_id").eq("is_online", true).eq("is_approved", true),
        db.from("ride_event_outbox").select("id", { count: "exact", head: true }).is("published_at", null).is("dead_lettered_at", null),
        db.from("ride_event_outbox").select("id", { count: "exact", head: true }).not("dead_lettered_at", "is", null),
      ]);
      const ridesByStatus: Record<string, number> = {};
      for (const row of rides.data ?? []) ridesByStatus[row.status] = (ridesByStatus[row.status] ?? 0) + 1;
      return json({ ridesByStatus, onlineDrivers: drivers.data?.length ?? 0, pendingOutboxEvents: pending.count ?? 0, deadLetteredOutboxEvents: dead.count ?? 0 }, 200, origin);
    }
    if (path === "/admin/audit" && method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
      const { data, error } = await db.from("admin_audit_events").select("*").order("created_at", { ascending: false }).limit(limit);
      if (error) return fail("Audit history unavailable.", 500, origin);
      const ids = [...new Set((data ?? []).map(x => x.actor_id))];
      const { data: people } = await db.from("accounts").select("id,email").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const emails = new Map((people ?? []).map(x => [x.id, x.email]));
      return json({ events: (data ?? []).map(x => ({ id: String(x.id), actorEmail: emails.get(x.actor_id) ?? "", action: x.action, targetType: x.target_type, targetId: x.target_id, details: x.details, createdAt: x.created_at })) }, 200, origin);
    }
    if (path === "/admin/support-reports" && method === "GET") {
      const { data, error } = await db.from("support_reports").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) return fail("Support reports unavailable.", 500, origin);
      const ids = [...new Set((data ?? []).map(x => x.reporter_id))];
      const { data: people } = await db.from("accounts").select("id,email,display_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const peopleById = new Map((people ?? []).map(x => [x.id, x]));
      return json({ reports: (data ?? []).map(x => ({ ...mapReport(x), reporterEmail: peopleById.get(x.reporter_id)?.email ?? "", reporterName: peopleById.get(x.reporter_id)?.display_name ?? "" })) }, 200, origin);
    }
    const reportUpdate = path.match(/^\/admin\/support-reports\/(\d+)$/);
    if (reportUpdate && method === "PUT") {
      const status = clean(body.status, 24), note = clean(body.resolutionNote, 2000);
      if (!["in_review","resolved","rejected"].includes(status) || (["resolved","rejected"].includes(status) && note.length < 10)) return fail("Invalid report transition or resolution note.", 422, origin);
      const update: Record<string, unknown> = { status, resolution_note: note, updated_at: new Date().toISOString() };
      if (status === "resolved" || status === "rejected") { update.resolved_by = accountId; update.resolved_at = new Date().toISOString(); }
      const { data, error } = await db.from("support_reports").update(update).eq("id", Number(reportUpdate[1])).in("status", ["open","in_review"]).select("*").maybeSingle();
      if (error || !data) return fail("Report is already terminal or does not exist.", 409, origin);
      await db.from("admin_audit_events").insert({ actor_id: accountId, action: "support_report_" + status, target_type: "support_report", target_id: String(data.id), details: { resolutionNote: note } });
      return json({ report: mapReport(data) }, 200, origin);
    }
    if (path === "/admin/drivers" && method === "GET") {
      const { data: profiles, error } = await db.from("driver_profiles").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) return fail("Driver list unavailable.", 500, origin);
      const ids = (profiles ?? []).map(x => x.account_id);
      const { data: people } = await db.from("accounts").select("id,email,display_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const byId = new Map((people ?? []).map(x => [x.id, x]));
      return json({ drivers: (profiles ?? []).map(x => ({ driverId: x.account_id, email: byId.get(x.account_id)?.email ?? "", displayName: byId.get(x.account_id)?.display_name ?? "", vehicleRegistration: x.vehicle_registration, approved: x.is_approved, online: x.is_online, createdAt: x.created_at })) }, 200, origin);
    }
    if (path === "/admin/drivers" && method === "POST") {
      const email = clean(body.email, 254).toLowerCase(), password = typeof body.password === "string" ? body.password : "";
      const displayName = clean(body.displayName, 120), vehicleRegistration = clean(body.vehicleRegistration, 32).toUpperCase();
      if (!email.includes("@") || password.length < 12 || !displayName || vehicleRegistration.length < 3) return fail("Valid driver details and a password of at least 12 characters are required.", 422, origin);
      const { data: created, error: createError } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
      if (createError || !created.user) return fail("Could not provision driver account.", 409, origin);
      const { error: roleError } = await db.from("accounts").update({ role: "driver" }).eq("id", created.user.id);
      const { error: profileError } = await db.from("driver_profiles").insert({ account_id: created.user.id, vehicle_registration: vehicleRegistration, is_approved: false });
      if (roleError || profileError) {
        await db.from("accounts").delete().eq("id", created.user.id);
        await db.auth.admin.deleteUser(created.user.id);
        return fail("Could not create driver profile; account creation was rolled back.", 409, origin);
      }
      await db.from("admin_audit_events").insert({ actor_id: accountId, action: "driver_provisioned", target_type: "driver", target_id: created.user.id, details: { email, vehicleRegistration } });
      return json({ driverId: created.user.id, approved: false }, 201, origin);
    }
    const approval = path.match(/^\/admin\/drivers\/([0-9a-f-]+)\/approval$/i);
    if (approval && method === "PUT") {
      const approved = body.approved === true;
      const { data, error } = await db.from("driver_profiles").update({ is_approved: approved, approved_at: approved ? new Date().toISOString() : null, approved_by: approved ? accountId : null, is_online: false }).eq("account_id", approval[1]).select("account_id").maybeSingle();
      if (error || !data) return fail("Driver profile not found.", 404, origin);
      await db.from("admin_audit_events").insert({ actor_id: accountId, action: approved ? "driver_approved" : "driver_suspended", target_type: "driver", target_id: approval[1], details: {} });
      return json({ driverId: data.account_id, approved }, 200, origin);
    }
    if (path === "/admin/rides" && method === "GET") {
      const q = clean(url.searchParams.get("q"), 160), status = clean(url.searchParams.get("status"), 32);
      let query = db.from("rides").select("*").order("created_at", { ascending: false }).limit(100);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return fail("Ride search unavailable.", 500, origin);
      const ids = [...new Set((data ?? []).flatMap(x => [x.passenger_id, x.driver_id].filter(Boolean)))];
      const { data: people } = await db.from("accounts").select("id,email").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const byId = new Map((people ?? []).map(x => [x.id, x.email]));
      const rides = (data ?? []).filter(x => !q || [x.id, byId.get(x.passenger_id), byId.get(x.driver_id), x.pickup_label, x.destination_label].some(v => String(v ?? "").toLowerCase().includes(q.toLowerCase())));
      return json({ rides: rides.map(x => ({ rideId: x.id, status: x.status, passengerEmail: byId.get(x.passenger_id) ?? "", driverEmail: byId.get(x.driver_id) ?? null, pickup: x.pickup_label, destination: x.destination_label, farePaise: x.quoted_fare_paise, createdAt: x.created_at, updatedAt: x.updated_at })), limit: 100 }, 200, origin);
    }
  }
  return fail("Route not found.", 404, origin);
}

Deno.serve(async (req: Request) => {
  try { return await handle(req); }
  catch (error) {
    console.error("rideforge-api request failed", error instanceof Error ? error.message : "unknown");
    return fail("Unexpected backend error.", 500, req.headers.get("Origin"));
  }
});
