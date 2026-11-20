import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "npm:@supabase/supabase-js@2.119.0";
import { getRateLimitClientIp } from "./client_ip.ts";
import { createCorsHeaders } from "./cors.ts";
import { buildGeocodingUrl, parseCoordinatePair, parseGeocodingCoordinates } from "./geocoding.ts";
import { missingVerifiedDriverDocuments } from "./driver_approval.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const publicAuth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = (origin: string | null) => createCorsHeaders(
  origin,
  (Deno.env.get("RIDEFORGE_ALLOWED_ORIGINS") ?? "").split(","),
);
const json = (data: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (message: string, status = 400, origin: string | null = null) => json({ error: message }, status, origin);
const parseBody = async (req: Request): Promise<Record<string, unknown>> => {
  if (!(req.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json")) return {};
  try { const value = await req.json(); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  catch { return {}; }
};
const clean = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))));
};
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

async function quoteRoute(body: Record<string, unknown>, req: Request) {
  const pickup = body.pickup && typeof body.pickup === "object" ? body.pickup as Record<string, unknown> : {};
  const destination = body.destination && typeof body.destination === "object" ? body.destination as Record<string, unknown> : {};
  const pickupLabel = clean(pickup.label);
  const destinationLabel = clean(destination.label);
  const pickupHasCoordinates = pickup.latitude !== undefined || pickup.longitude !== undefined;
  const destinationHasCoordinates = destination.latitude !== undefined || destination.longitude !== undefined;
  const pickupCoordinates = pickupHasCoordinates
    ? parseCoordinatePair(pickup.latitude, pickup.longitude) : null;
  const destinationCoordinates = destinationHasCoordinates
    ? parseCoordinatePair(destination.latitude, destination.longitude) : null;
  if (pickupLabel.length < 3 || destinationLabel.length < 3 || pickupLabel.toLowerCase() === destinationLabel.toLowerCase()) {
    return { error: "Enter two different pickup and destination locations.", status: 422 };
  }
  if ((pickupHasCoordinates && !pickupCoordinates) || (destinationHasCoordinates && !destinationCoordinates)) {
    return { error: "Provide valid latitude and longitude for both locations.", status: 422 };
  }
  // On hosted Supabase ingress, only Cloudflare's overwritten client-IP
  // header is trusted. Caller-supplied X-Forwarded-For/X-Real-IP are local-dev
  // fallbacks only; missing hosted identity fails closed rather than bypassing
  // the distributed quote limiter.
  const clientIp = getRateLimitClientIp(req.headers, SUPABASE_URL);
  if (!clientIp) return { error: "Quote service is temporarily unavailable.", status: 503 };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientIp));
  const rateKey = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
  const { data: withinLimit, error: rateError } = await db.rpc("rideforge_consume_rate_limit", {
    p_key_hash: rateKey, p_limit: 10, p_window_seconds: 60,
  });
  if (rateError) return { error: "Quote service is temporarily unavailable.", status: 503 };
  if (withinLimit !== true) return { error: "Too many quote requests. Wait a moment and try again.", status: 429 };

  const geoUrl = Deno.env.get("RIDEFORGE_GEOCODING_URL") ?? "https://photon.komoot.io/api/";
  const routeUrl = Deno.env.get("RIDEFORGE_ROUTING_URL") ?? "https://router.project-osrm.org/route/v1/driving";
  const userAgent = Deno.env.get("RIDEFORGE_USER_AGENT") ?? "RideForge/1.0 (https://github.com/kaustubhdua/Smart_bike_taxi_platform)";
  const geocode = async (label: string) => {
    const fallbackUrls = [
      "https://photon.komoot.io/api/",
      "https://nominatim.openstreetmap.org/search",
    ];
    const endpoints = [...new Set([geoUrl, ...fallbackUrls])];
    let lastError = new Error("Geocoding providers are temporarily unavailable.");
    for (const endpoint of endpoints) {
      try {
        const host = new URL(endpoint).hostname.toLowerCase();
        const provider = host.includes("photon") ? "photon" :
          host.includes("nominatim") ? "nominatim" : "geocoding";
        const { data: slot, error: throttleError } = await db.rpc("rideforge_reserve_provider_slot", {
          p_provider: provider, p_interval_ms: 1100,
        });
        if (throttleError || typeof slot !== "string") {
          lastError = new Error("Geocoding provider is temporarily unavailable.");
          continue;
        }
        const waitMs = Date.parse(slot) - Date.now();
        if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
        const response = await fetch(buildGeocodingUrl(endpoint, label), {
          headers: {
            "User-Agent": userAgent,
            "Accept": "application/json",
            "Referer": "https://smart-bike-taxi-platform.vercel.app/",
            "Origin": "https://smart-bike-taxi-platform.vercel.app",
          },
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
          const diagnostic = (await response.text()).slice(0, 180).replace(/\\s+/g, " ");
          console.warn("RideForge geocoding provider returned a non-OK response", provider, response.status, diagnostic);
          lastError = new Error("Geocoding provider is temporarily unavailable.");
          continue;
        }
        const point = parseGeocodingCoordinates(await response.json());
        if (point) return point;
        lastError = new Error("Location could not be found.");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Geocoding provider is temporarily unavailable.");
      }
    }
    throw lastError;
  };
  try {
    const p = pickupCoordinates ?? await geocode(pickupLabel);
    const d = destinationCoordinates ?? await geocode(destinationLabel);
    const response = await fetch(routeUrl + "/" + p.lon + "," + p.lat + ";" + d.lon + "," + d.lat + "?overview=full&geometries=geojson&steps=false", {
      headers: { "Accept": "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(8_000),
    });
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
    const message = error instanceof Error ? error.message : "Route quote unavailable.";
    return { error: message, status: message === "Location could not be found." ? 422 : 503 };
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
    const emailRedirectTo = Deno.env.get("RIDEFORGE_AUTH_REDIRECT_URL") ?? "https://smart-bike-taxi-platform.vercel.app";
    const { data, error } = await publicAuth.auth.signUp({
      email, password,
      options: { data: { display_name: displayName }, emailRedirectTo },
    });
    if (error) return fail(error.message, error.status ?? 400, origin);
    if (!data.session) return json({ verificationRequired: true, message: "Check your email to verify your account, then sign in." }, 202, origin);
    const { data: account } = await db.from("accounts").select("*").eq("id", data.user!.id).single();
    return json({ accessToken: data.session.access_token, account: accountView(account) }, 201, origin);
  }
  if (path === "/auth/driver/register" && method === "POST") {
    const email = clean(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = clean(body.displayName, 120);
    const vehicleRegistration = clean(body.vehicleRegistration, 32).toUpperCase();
    if (!email.includes("@") || password.length < 12 || password.length > 128 || !displayName || vehicleRegistration.length < 3) {
      return fail("Enter a valid email, full name, vehicle registration and password of at least 12 characters.", 422, origin);
    }
    const emailRedirectTo = Deno.env.get("RIDEFORGE_AUTH_REDIRECT_URL") ?? "https://smart-bike-taxi-platform.vercel.app/driver";
    const { data, error } = await publicAuth.auth.signUp({
      email, password,
      options: { data: { display_name: displayName }, emailRedirectTo },
    });
    if (error || !data.user || (data.user.identities?.length ?? 0) === 0) return fail("Could not create this driver account. If you already registered, sign in instead.", error?.status ?? 409, origin);
    const { error: roleError } = await db.from("accounts").update({ role: "driver", display_name: displayName }).eq("id", data.user.id);
    const { error: profileError } = await db.from("driver_profiles").upsert({
      account_id: data.user.id, vehicle_registration: vehicleRegistration, is_approved: false, is_online: false,
    }, { onConflict: "account_id", ignoreDuplicates: true });
    if (roleError || profileError) {
      await db.auth.admin.deleteUser(data.user.id);
      return fail("Driver application could not be created. Please retry or contact support.", 409, origin);
    }
    const { data: account, error: accountError } = await db.from("accounts").select("*").eq("id", data.user.id).single();
    if (accountError || !account || account.role !== "driver") {
      await db.auth.admin.deleteUser(data.user.id);
      return fail("Driver account setup could not be completed.", 500, origin);
    }
    if (!data.session) {
      return json({ verificationRequired: true, message: "Driver application created. Verify your email and sign in to the driver portal. Document uploads are optional for now; an administrator can approve your driver account." }, 202, origin);
    }
    return json({
      accessToken: data.session.access_token, account: accountView(account),
      approved: false, applicationStatus: "pending_approval",
    }, 201, origin);
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
    const result = await quoteRoute(body, req);
    return "status" in result ? fail(String(result.error), Number(result.status), origin) : json(result, 200, origin);
  }

  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const accountId = ctx.user.id;
  const account = ctx.account;

  if (path === "/driver/profile" && method === "GET") {
    if (account.role !== "driver") return fail("Driver account required.", 403, origin);
    const { data, error } = await db.from("driver_profiles")
      .select("vehicle_registration,is_approved,is_online,approved_at,created_at")
      .eq("account_id", accountId).maybeSingle();
    return error || !data ? fail("Driver application profile unavailable.", 404, origin) : json({
      vehicleRegistration: data.vehicle_registration, approved: data.is_approved,
      online: data.is_online, approvedAt: data.approved_at, createdAt: data.created_at,
    }, 200, origin);
  }
  if (path === "/driver/documents" && method === "GET") {
    if (account.role !== "driver") return fail("Driver account required.", 403, origin);
    const { data, error } = await db.from("driver_documents")
      .select("id,document_type,original_name,mime_type,byte_size,review_status,review_note,created_at")
      .eq("driver_id", accountId).order("created_at", { ascending: false });
    return error ? fail("Could not load verification documents.", 500, origin) : json({ documents: data ?? [] }, 200, origin);
  }
  if (path === "/driver/documents" && method === "POST") {
    if (account.role !== "driver") return fail("Driver account required.", 403, origin);
    const form = await req.formData();
    const documentType = clean(form.get("documentType"), 32);
    const file = form.get("file");
    if (!["driving_license","vehicle_rc","insurance"].includes(documentType) || !(file instanceof File)) {
      return fail("Choose a supported document type and file.", 422, origin);
    }
    if (file.size < 1 || file.size > 10 * 1024 * 1024 || !["application/pdf","image/jpeg","image/png"].includes(file.type)) {
      return fail("Documents must be PDF, JPG or PNG and no larger than 10 MB.", 422, origin);
    }
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const validSignature = file.type === "application/pdf"
      ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
      : file.type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!validSignature) return fail("The uploaded file does not match its declared document format.", 422, origin);
    const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpg" : "png";
    const objectPath = accountId + "/" + documentType + "/" + crypto.randomUUID() + "." + extension;
    const { error: uploadError } = await db.storage.from("driver-verification").upload(objectPath, file, {
      contentType: file.type, upsert: false,
    });
    if (uploadError) return fail("Secure document upload failed. Please retry.", 503, origin);
    const { data, error } = await db.from("driver_documents").insert({
      driver_id: accountId, document_type: documentType, object_path: objectPath,
      original_name: clean(file.name, 180) || documentType + "." + extension,
      mime_type: file.type, byte_size: file.size,
    }).select("id,document_type,original_name,review_status,created_at").single();
    if (error || !data) {
      await db.storage.from("driver-verification").remove([objectPath]);
      return fail("Document metadata could not be saved. The upload was rolled back.", 500, origin);
    }
    return json({ document: data }, 201, origin);
  }
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
    let startCode: string | undefined;
    if (ride.passenger_id === accountId && ["assigned", "driver_arriving"].includes(String(ride.status))) {
      const { data: sc } = await db.from("ride_start_codes").select("code").eq("ride_id", ride.id).maybeSingle();
      if (sc?.code) startCode = String(sc.code);
    }
    let driverRating: unknown;
    if (ride.driver_id && ride.passenger_id === accountId) {
      const { data: summary } = await db.rpc("rideforge_rating_summary", { p_account_id: ride.driver_id });
      driverRating = summary ?? undefined;
    }
    return json({
      ...mapRide(ride),
      ...(driverLocation ? { driverLocation } : {}),
      ...(startCode ? { startCode } : {}),
      ...(driverRating ? { driverRating } : {}),
    }, 200, origin);
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

  const rideAction = path.match(/^\/rides\/([0-9a-f-]{36})\/(receipt|rating|sos)$/i);
  if (rideAction) {
    const [, rideId, action] = rideAction;
    if (action === "receipt" && method === "GET") {
      const { data: ride } = await db.from("rides").select("*").eq("id", rideId).maybeSingle();
      if (!ride || (ride.passenger_id !== accountId && ride.driver_id !== accountId)) return fail("Ride not found.", 404, origin);
      if (ride.status !== "completed") return fail("A receipt is available once the ride is completed.", 409, origin);
      const { data: driver } = ride.driver_id
        ? await db.from("accounts").select("display_name").eq("id", ride.driver_id).maybeSingle()
        : { data: null };
      const fare = Number(ride.final_fare_paise ?? ride.quoted_fare_paise);
      const baseFare = Math.min(2000, fare);
      return json({
        receiptNumber: `RF-${String(ride.id).slice(0, 8).toUpperCase()}`,
        rideId: ride.id, pickup: ride.pickup_label, destination: ride.destination_label,
        distanceKm: ride.route_distance_m ? Number(ride.route_distance_m) / 1000 : null,
        driverName: driver?.display_name ?? null,
        startedAt: ride.started_at, completedAt: ride.completed_at,
        currency: ride.currency, totalPaise: fare,
        fareBreakdown: { baseFarePaise: baseFare, distanceFarePaise: fare - baseFare, pricingModel: "demo_base_plus_distance" },
        payment: { collected: false, note: "No payment was collected. RideForge does not process payments yet." },
      }, 200, origin);
    }
    if (action === "rating" && method === "POST") {
      const stars = Number(body.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) return fail("Stars must be a whole number from 1 to 5.", 422, origin);
      const { data, error } = await db.rpc("rideforge_rate_ride", { p_rater_id: accountId, p_ride_id: rideId, p_stars: stars, p_comment: clean(body.comment, 500) || null });
      if (error) return error.code === "23505" ? fail("You already rated this ride.", 409, origin) : fail("This ride cannot be rated.", 409, origin);
      return json(data, 201, origin);
    }
    if (action === "sos" && method === "POST") {
      const lat = num(body.latitude), lon = num(body.longitude);
      if ((lat === null) !== (lon === null)) return fail("Send latitude and longitude together.", 422, origin);
      const { data, error } = await db.rpc("rideforge_raise_sos", { p_account_id: accountId, p_ride_id: rideId, p_latitude: lat, p_longitude: lon, p_note: clean(body.note, 500) || null });
      if (error) return fail("SOS is only available during an active ride you are part of.", 409, origin);
      return json({ ...data, guidance: "If you are in immediate danger, call 112 now. RideForge has no staffed control room, so this alert is recorded for an administrator but may not be seen in time." }, (data as { duplicate?: boolean }).duplicate ? 200 : 201, origin);
    }
  }

  if (path === "/saved-places" && method === "GET") {
    const { data, error } = await db.from("saved_places").select("id,label,address,latitude,longitude").eq("account_id", accountId).order("created_at", { ascending: true }).limit(20);
    return error ? fail("Could not load saved places.", 500, origin) : json({ places: data ?? [] }, 200, origin);
  }
  if (path === "/saved-places" && method === "POST") {
    const label = clean(body.label, 40), address = clean(body.address, 240);
    const coords = parseCoordinatePair(body.latitude, body.longitude);
    if (!label || address.length < 3 || !coords) return fail("A label, an address and valid coordinates are required.", 422, origin);
    const { data, error } = await db.from("saved_places").insert({ account_id: accountId, label, address, latitude: coords.lat, longitude: coords.lon }).select("id,label,address,latitude,longitude").single();
    if (error) return fail(error.code === "23505" ? "You already have a place with that label." : error.message.includes("limit") ? "You can save up to 20 places." : "Could not save the place.", error.code === "23505" || error.message.includes("limit") ? 409 : 500, origin);
    return json(data, 201, origin);
  }
  const placePath = path.match(/^\/saved-places\/([0-9a-f-]{36})$/i);
  if (placePath && method === "DELETE") {
    const { data } = await db.from("saved_places").delete().eq("id", placePath[1]).eq("account_id", accountId).select("id");
    return data?.length ? json({ deleted: true }, 200, origin) : fail("Saved place not found.", 404, origin);
  }

  if (path === "/driver/earnings" && method === "GET") {
    if (account.role !== "driver") return fail("Driver account required.", 403, origin);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data } = await db.from("rides").select("final_fare_paise,completed_at").eq("driver_id", accountId).eq("status", "completed").gte("completed_at", since).limit(1000);
    const sum = (days: number) => (data ?? []).filter(r => Date.parse(String(r.completed_at)) >= Date.now() - days * 86_400_000)
      .reduce((total, r) => total + Number(r.final_fare_paise ?? 0), 0);
    const trips = (days: number) => (data ?? []).filter(r => Date.parse(String(r.completed_at)) >= Date.now() - days * 86_400_000).length;
    const { data: rating } = await db.rpc("rideforge_rating_summary", { p_account_id: accountId });
    return json({
      currency: "INR",
      last24h: { trips: trips(1), grossFarePaise: sum(1) },
      last7d: { trips: trips(7), grossFarePaise: sum(7) },
      last30d: { trips: trips(30), grossFarePaise: sum(30) },
      rating: rating ?? { count: 0, average: null },
      note: "Gross completed fares only. This is not a payout ledger; no platform fee, tax or settlement is calculated.",
    }, 200, origin);
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
    const { data: dp } = await db.from("driver_profiles").select("is_approved,is_online,last_location_at,current_latitude,current_longitude").eq("account_id", accountId).maybeSingle();
    if (!dp?.is_approved || !dp.is_online || !dp.last_location_at || Date.now() - Date.parse(dp.last_location_at) > 120_000) return json({ rides: [] }, 200, origin);
    const { data: pending } = await db.from("rides").select("id").in("status", ["requested", "matching"]).is("driver_id", null).order("created_at").limit(20);
    for (const ride of pending ?? []) await db.rpc("rideforge_dispatch_ride", { p_ride_id: ride.id });
    const { data: offers } = await db.from("ride_offers").select("ride_id,expires_at").eq("driver_id", accountId).eq("status", "offered").gt("expires_at", new Date().toISOString()).order("offered_at");
    const ids = (offers ?? []).map(o => o.ride_id);
    if (!ids.length) return json({ rides: [] }, 200, origin);
    const { data: rides } = await db.from("rides").select("*").in("id", ids);
    const expiry = new Map((offers ?? []).map(o => [o.ride_id, o.expires_at]));
    return json({ rides: (rides ?? []).map(r => ({
      rideId: r.id, pickup: r.pickup_label, destination: r.destination_label,
      distanceMeters: r.route_distance_m,
      pickupDistanceMeters: dp.current_latitude !== null && dp.current_longitude !== null
        ? haversineMeters(dp.current_latitude, dp.current_longitude, r.pickup_latitude, r.pickup_longitude) : undefined,
      farePaise: r.quoted_fare_paise, offerExpiresAt: expiry.get(r.id),
    })) }, 200, origin);
  }
  if (path === "/driver/rides/history" && method === "GET") {
    if (account.role !== "driver") return fail("Driver account required.", 403, origin);
    const { data } = await db.from("rides").select("*").eq("driver_id", accountId).order("created_at", { ascending: false }).limit(50);
    const rides = data ?? [];
    return json({ rides: rides.map(mapRide), grossCompletedFarePaise: rides.filter(r => r.status === "completed").reduce((sum, r) => sum + Number(r.final_fare_paise ?? 0), 0), currency: "INR", note: "Gross completed fares are not a payout ledger." }, 200, origin);
  }
  const driverRidePath = path.match(/^\/driver\/rides\/([0-9a-f-]+)\/(accept|decline|status|cancel)$/i);
  if (driverRidePath && account.role === "driver") {
    const [, rideId, action] = driverRidePath;
    if (action === "accept" && method === "POST") {
      const { data, error } = await db.rpc("rideforge_accept_offer", { p_driver_id: accountId, p_ride_id: rideId });
      return error ? fail("This offer is expired or no longer available.", 409, origin) : json(data, 200, origin);
    }
    if (action === "decline" && method === "POST") {
      const { data, error } = await db.rpc("rideforge_decline_offer", { p_driver_id: accountId, p_ride_id: rideId });
      return error ? fail("This offer is expired or no longer available.", 409, origin) : json(data, 200, origin);
    }
    if (action === "cancel" && method === "POST") {
      const reason = clean(body.reason, 240);
      const { data, error } = await db.rpc("rideforge_driver_cancel_ride", {
        p_driver_id: accountId, p_ride_id: rideId, p_reason: reason || null,
      });
      return error ? fail("This ride cannot be cancelled by this driver.", 409, origin) : json(data, 200, origin);
    }
    if (action === "status" && method === "PUT") {
      const status = clean(body.status, 32);
      const otp = clean(body.otp, 8);
      if (status === "in_progress" && !/^\d{4}$/.test(otp)) return fail("Enter the 4-digit start code shown to the passenger.", 422, origin);
      const { data, error } = await db.rpc("rideforge_advance_ride", { p_driver_id: accountId, p_ride_id: rideId, p_status: status, p_otp: status === "in_progress" ? otp : null });
      if (error) return fail("Ride transition is not allowed.", 409, origin);
      if (data?.otpRejected) return json({ error: data.attemptsRemaining > 0 ? `Incorrect start code. ${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? "" : "s"} left.` : "Too many incorrect codes. Ask support or cancel the ride.", attemptsRemaining: data.attemptsRemaining }, 422, origin);
      return json(data, 200, origin);
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
      const statuses = ["requested","matching","assigned","driver_arriving","in_progress","completed","cancelled","failed"];
      const [statusCounts, drivers] = await Promise.all([
        Promise.all(statuses.map(status => db.from("rides").select("id", { count: "exact", head: true }).eq("status", status))),
        db.from("driver_profiles").select("account_id", { count: "exact", head: true })
          .eq("is_online", true).eq("is_approved", true)
          .gte("last_location_at", new Date(Date.now() - 120_000).toISOString()),
      ]);
      if (statusCounts.some(result => result.error) || drivers.error) return fail("Operational metrics unavailable.", 500, origin);
      const ridesByStatus: Record<string, number> = {};
      statuses.forEach((status, index) => { ridesByStatus[status] = statusCounts[index].count ?? 0; });
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      const [openSos, recent] = await Promise.all([
        db.from("sos_events").select("id", { count: "exact", head: true }).neq("status", "resolved"),
        db.from("rides").select("final_fare_paise").eq("status", "completed").gte("completed_at", dayAgo).limit(5000),
      ]);
      return json({
        ridesByStatus, onlineDrivers: drivers.count ?? 0,
        openSos: openSos.count ?? 0,
        completedLast24h: (recent.data ?? []).length,
        grossFarePaiseLast24h: (recent.data ?? []).reduce((total, r) => total + Number(r.final_fare_paise ?? 0), 0),
      }, 200, origin);
    }
    if (path === "/admin/sos" && method === "GET") {
      const { data, error } = await db.from("sos_events").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) return fail("SOS alerts unavailable.", 500, origin);
      const ids = [...new Set((data ?? []).map(x => x.account_id))];
      const { data: people } = await db.from("accounts").select("id,email,display_name,role").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const byId = new Map((people ?? []).map(x => [x.id, x]));
      return json({ alerts: (data ?? []).map(x => ({ id: String(x.id), rideId: x.ride_id, status: x.status, note: x.note, latitude: x.latitude, longitude: x.longitude, raisedBy: byId.get(x.account_id)?.email ?? "", raisedByRole: byId.get(x.account_id)?.role ?? "", createdAt: x.created_at, handledAt: x.handled_at })) }, 200, origin);
    }
    const sosUpdate = path.match(/^\/admin\/sos\/(\d+)$/);
    if (sosUpdate && method === "PUT") {
      const status = clean(body.status, 16);
      if (!["acknowledged", "resolved"].includes(status)) return fail("Status must be acknowledged or resolved.", 422, origin);
      const from = status === "acknowledged" ? ["open"] : ["open", "acknowledged"];
      const { data, error } = await db.from("sos_events").update({ status, handled_by: accountId, handled_at: new Date().toISOString() }).eq("id", Number(sosUpdate[1])).in("status", from).select("id,status").maybeSingle();
      if (error || !data) return fail("Alert is already resolved or does not exist.", 409, origin);
      await db.from("admin_audit_events").insert({ actor_id: accountId, action: "sos_" + status, target_type: "sos_event", target_id: String(data.id), details: {} });
      return json({ id: String(data.id), status: data.status }, 200, origin);
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
    const adminDocumentPath = path.match(/^\/admin\/drivers\/([0-9a-f-]+)\/documents$/i);
    if (adminDocumentPath && method === "GET") {
      const { data, error } = await db.from("driver_documents")
        .select("id,driver_id,document_type,object_path,original_name,mime_type,byte_size,review_status,review_note,created_at")
        .eq("driver_id", adminDocumentPath[1]).order("created_at", { ascending: false });
      if (error) return fail("Driver documents unavailable.", 500, origin);
      const documents = await Promise.all((data ?? []).map(async doc => {
        const { data: signed } = await db.storage.from("driver-verification").createSignedUrl(doc.object_path, 300);
        return { ...doc, signedUrl: signed?.signedUrl ?? null };
      }));
      return json({ documents }, 200, origin);
    }
    const adminReviewPath = path.match(/^\/admin\/drivers\/([0-9a-f-]+)\/documents\/([0-9a-f-]+)\/review$/i);
    if (adminReviewPath && method === "PUT") {
      const reviewStatus = clean(body.status, 16);
      const note = clean(body.note, 500);
      if (!["verified","rejected"].includes(reviewStatus) || (reviewStatus === "rejected" && note.length < 8)) {
        return fail("Choose verified or rejected; rejected documents require a reason.", 422, origin);
      }
      const { data, error } = await db.from("driver_documents").update({
        review_status: reviewStatus, review_note: note || null,
        reviewed_by: accountId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", adminReviewPath[2]).eq("driver_id", adminReviewPath[1])
        .select("id,document_type,review_status,review_note").maybeSingle();
      if (error || !data) return fail("Document not found or review could not be saved.", 404, origin);
      await db.from("admin_audit_events").insert({
        actor_id: accountId, action: "driver_document_" + reviewStatus,
        target_type: "driver_document", target_id: data.id,
        details: { driverId: adminReviewPath[1], documentType: data.document_type, note },
      });
      return json({ document: data }, 200, origin);
    }
    if (path === "/admin/drivers" && method === "GET") {
      const { data: profiles, error } = await db.from("driver_profiles").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) return fail("Driver list unavailable.", 500, origin);
      const ids = (profiles ?? []).map(x => x.account_id);
      const { data: people } = await db.from("accounts").select("id,email,display_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const byId = new Map((people ?? []).map(x => [x.id, x]));
      const { data: documents } = await db.from("driver_documents").select("driver_id,document_type,review_status,created_at").in("driver_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).order("created_at", { ascending: false });
      const docsByDriver = new Map<string, Array<{ documentType: string; status: string }>>();
      for (const doc of documents ?? []) {
        const current = docsByDriver.get(doc.driver_id) ?? [];
        if (!current.some(item => item.documentType === doc.document_type)) {
          docsByDriver.set(doc.driver_id, [...current, { documentType: doc.document_type, status: doc.review_status }]);
        }
      }
      return json({ drivers: (profiles ?? []).map(x => ({
        driverId: x.account_id, email: byId.get(x.account_id)?.email ?? "",
        displayName: byId.get(x.account_id)?.display_name ?? "",
        vehicleRegistration: x.vehicle_registration, approved: x.is_approved, online: x.is_online,
        createdAt: x.created_at, documents: docsByDriver.get(x.account_id) ?? [],
      })) }, 200, origin);
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
        await db.from("driver_profiles").delete().eq("account_id", created.user.id);
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
      if (approved) {
        const { data: documents, error: documentsError } = await db.from("driver_documents")
          .select("document_type,review_status,created_at").eq("driver_id", approval[1]).order("created_at", { ascending: false });
        if (documentsError) return fail("Could not verify driver documents; approval was not changed.", 503, origin);
        const missing = missingVerifiedDriverDocuments(documents ?? []);
        if (missing.length) return fail("Driver approval requires verified driving licence, vehicle RC and insurance documents. Missing verification: " + missing.join(", ") + ".", 409, origin);
      }
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
