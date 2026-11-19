# Supabase-native RideForge backend

RideForge uses the existing Supabase project `ghcufcegfvvjhsnqnrzr` as its application backend.

## Components

- **Supabase Auth** owns user credentials and access tokens. The database trigger `rideforge_sync_auth_account` creates the matching `public.accounts` row using the same UUID as `auth.users`.
- **Supabase PostgreSQL** stores accounts, driver profiles, quotes, rides, offers, events, support reports and audit events.
- **Supabase Edge Function** `rideforge-api` provides the versioned HTTP API expected by the React app.
- **PostgreSQL RPCs** perform transactional booking, driver availability, dispatch, acceptance, cancellation and ride lifecycle changes.
- **Supabase Realtime** publication is enabled for rides and ride_events. The current React client does not subscribe to it directly; it uses the authenticated SSE compatibility endpoint, which polls the durable event table every 1.5 seconds for up to 25 seconds, reconnects, and recovers through REST.

The browser never receives the service-role key. The Edge Function validates the Supabase access token with Auth before performing privileged queries. The function is deployed with gateway JWT verification disabled because public registration and quote endpoints must be reachable without a session; all protected routes enforce JWT verification in the function itself.

## Local frontend configuration

Set `web/.env` to:

```dotenv
VITE_API_BASE_URL=https://ghcufcegfvvjhsnqnrzr.supabase.co/functions/v1/rideforge-api
```

Run:

```bash
cd web
npm ci
npm run typecheck
npm run build
npm test
```

## Supabase Auth URL configuration

In Supabase Dashboard → Authentication → URL Configuration, set the Site URL to `https://smart-bike-taxi-platform.vercel.app` and add `https://smart-bike-taxi-platform.vercel.app/**` plus `http://localhost:5173/**` to the allowed redirect URLs. Set the Edge Function secret `RIDEFORGE_AUTH_REDIRECT_URL` to `https://smart-bike-taxi-platform.vercel.app` (the code fallback is the same). The `rideforge-api` CORS policy always allows this exact production Vercel origin and additionally accepts exact origins listed in `RIDEFORGE_ALLOWED_ORIGINS`; unknown browser origins receive no `Access-Control-Allow-Origin` header. Do not use wildcard origins for browser sessions.

## Initial administrator bootstrap

There are currently no application accounts in the production database. The first account must be registered through the app and its email verified. Then an authorized project owner must promote that exact account once in the Supabase SQL Editor:

```sql
UPDATE public.accounts
SET role = 'admin', updated_at = now()
WHERE email = lower('YOUR_VERIFIED_ADMIN_EMAIL')
  AND role = 'passenger'
RETURNING id, email, role;
```

Confirm exactly one row is returned. This is intentionally a manual privileged operation; the public API has no self-service admin promotion endpoint. Do not place a database password or service-role key in the frontend.

## Security model

- RLS remains enabled on every application table.
- Authenticated users receive only participant/self SELECT policies needed for Realtime. Internal tables have explicit deny policies and no browser write grants.
- All mutations go through the Edge Function and service-role-only RPCs after JWT, account-state and role checks.
- The service-role key is used only inside the Supabase Edge Function runtime.
- Driver accounts are created by an administrator and remain ineligible for dispatch until explicitly approved.
- Driver location is considered fresh for two minutes; offers expire after 45 seconds; a ride is offered to at most five distinct eligible drivers, one offer at a time.
- The fare quote is server-calculated, persisted for five minutes and consumed transactionally during booking. Public quote requests are limited to 10 per client IP per minute, and database-backed provider slots serialize Nominatim requests across Edge Function instances.
- This remains a demonstration platform, not a live transport, payment or emergency-response service.

## Deployment

The repository's CI pins Supabase CLI v3.0.0 rather than floating on `latest`. This avoids silently changing migration/deployment semantics when a new major CLI is released.

Deploy the Edge Function from the repository with Supabase CLI v3 (pin the version in CI and review the v3 migration guide before upgrading):

```bash
supabase login
supabase link --project-ref ghcufcegfvvjhsnqnrzr
supabase migration list --remote
supabase db push --remote --yes
supabase functions deploy rideforge-api --no-verify-jwt --yes
```

CLI v3 runs local database commands locally by default and requires explicit `--remote` for hosted database operations. Hosted changes require `--yes` in unattended automation. Never use `db reset --remote` against production.

The live migrations `016_supabase_native_backend` through `024_retire_legacy_outbox_trigger` establish the Auth bridge, participant-scoped RLS, Realtime publication, transactional ride RPCs, bounded sequential dispatch with one active offer per ride, per-IP quote rate limits, serialized Nominatim requests, driver approval/location revalidation, and retirement of the legacy outbox notification trigger.

The Vercel project `smart-bike-taxi-platform` serves the built React app from `web/`; the production browser API base is `https://ghcufcegfvvjhsnqnrzr.supabase.co/functions/v1/rideforge-api`. The Render static site is a legacy deployment and the old Render API services are not part of the active Supabase-native architecture. Do not delete legacy resources until the Vercel production domain, Auth redirect allowlist, first-admin bootstrap, driver onboarding, and external browser booking/dispatch acceptance tests are complete.
