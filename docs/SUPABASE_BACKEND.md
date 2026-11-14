# Supabase-native RideForge backend

RideForge uses the existing Supabase project `ghcufcegfvvjhsnqnrzr` as its application backend.

## Components

- **Supabase Auth** owns user credentials and access tokens. The database trigger `rideforge_sync_auth_account` creates the matching `public.accounts` row using the same UUID as `auth.users`.
- **Supabase PostgreSQL** stores accounts, driver profiles, quotes, rides, offers, events, support reports and audit events.
- **Supabase Edge Function** `rideforge-api` provides the versioned HTTP API expected by the React app.
- **PostgreSQL RPCs** perform transactional booking, driver availability, dispatch, acceptance, cancellation and ride lifecycle changes.
- **Supabase Realtime** publishes participant-authorized ride and ride-event changes. The compatibility SSE endpoint polls the durable event table for clients that still use the existing stream contract.

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

In Supabase Dashboard → Authentication → URL Configuration, set the Site URL to `https://rideforge-web.onrender.com` and add `https://rideforge-web.onrender.com/**` plus `http://localhost:5173/**` to the allowed redirect URLs. The Edge Function sends signup verification links back to the Render static frontend by default; override `RIDEFORGE_AUTH_REDIRECT_URL` only if the frontend domain changes.

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
- Driver location is considered fresh for two minutes; offers expire after 45 seconds; a ride is offered to at most five distinct eligible drivers.
- The fare quote is server-calculated, persisted for five minutes and consumed transactionally during booking. Public quote requests are limited to 10 per client IP per minute, and database-backed provider slots serialize Nominatim requests across Edge Function instances.
- This remains a demonstration platform, not a live transport, payment or emergency-response service.

## Deployment

Deploy the Edge Function from the repository with Supabase CLI:

```bash
supabase link --project-ref ghcufcegfvvjhsnqnrzr
supabase migration list --linked
supabase db push
supabase functions deploy rideforge-api --no-verify-jwt
```

The live migrations `016_supabase_native_backend` through `020_revalidate_driver_at_acceptance` establish the Auth bridge, participant-scoped RLS, Realtime publication, transactional ride RPCs, bounded sequential dispatch, per-IP quote rate limits, serialized Nominatim requests and revalidation of driver approval/location freshness when accepting an offer.

The Render static site can continue serving the built React app. The Render API service is no longer the intended backend and must only be retired after the frontend deployment, auth bootstrap, booking/dispatch smoke tests and rollback window are verified.
