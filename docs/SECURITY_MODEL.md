# RideForge security model and review checklist

## Scope

RideForge is a portfolio MVP, not an authorized commercial transport service. This document describes the implemented controls and the remaining gaps; it is not a certification or penetration-test report.

## Assets

- Account credentials, short-lived access tokens, passenger/driver identities.
- Pickup/drop-off addresses, coordinates and trip history.
- Driver availability and last reported location.
- Quotes, ride assignments, fares and ride-event history.
- Database credentials, token-signing secret, provider configuration and deployment secrets.

## Trust boundaries

1. Browser to HTTP API: all browser fields are untrusted. Validate type, length, range and state on the server.
2. API to PostgreSQL: use parameterized SQL and transactionally commit ride state, history and outbox records.
3. API to routing/geocoding providers: provider responses are untrusted and may fail, time out or return invalid coordinates/metrics.
4. Admin operations: only an authenticated admin token may provision, approve or suspend driver profiles.
5. Driver dispatch: only explicitly approved profiles with a fresh online location may see the queue, accept a ride or decline a queued request. A decline is scoped to one driver and ride; it never cancels the passenger's booking.

## Implemented controls

- Passenger registration does not accept a role field; newly registered accounts are passengers.
- `GET /api/v1/me` and `PATCH /api/v1/me` derive the target account only from a verified bearer-token subject; the client cannot supply another account ID or change email, role, phone verification, or account status. Profile updates accept only a bounded display name and use parameterized SQL.
- Passwords are stored as PBKDF2-HMAC-SHA-256 hashes with random salts and 600,000 iterations. Verification accepts only the exact four-field format, strictly parses bounded iteration counts, and uses constant-time digest comparison.
- Access tokens are HMAC-SHA-256 signed and require the expected algorithm, issuer, audience, non-empty subject, supported role, issued-at and expiry claims. Verification enforces a maximum 15-minute lifetime with 60-second future clock skew and canonical unpadded base64url segments.
- Passenger ride reads are scoped to the authenticated passenger; driver actions are scoped to the assigned driver; admin routes check the admin role.
- Ride creation, idempotency reservation, quote consumption and ride-event insertion occur in a database transaction.
- A partial unique index prevents one driver from having multiple active rides.
- Per-driver declines are persisted and filtered from that driver's queue. The backend rechecks decline state at acceptance time so a stale client cannot accept a request it declined.
- CORS uses exact origin matches from `RIDEFORGE_ALLOWED_ORIGINS` (comma-separated for passenger and driver hosts), with the legacy single-origin variable retained as a fallback. Wildcard/reflected origins are not allowed.
- Admin driver provisioning, approval and suspension are transactionally audited.
- Support reports are scoped to their creator; ride references are validated against passenger/driver participation. Admin resolution and its audit event commit together, and report creation is limited to five per account per hour with a PostgreSQL transaction lock.
- Driver profiles default to unapproved; suspension forces the driver offline.
- The API bounds request bodies/headers, applies socket timeouts and rate-limits auth/quote requests in-process.
- Ride-event insertion automatically creates a durable outbox row in the same transaction.
- Compose migrations run with the database-owner credential, while the API and both workers use the non-superuser `rideforge_app` login. The deployment migration runner sets its password only when `RIDEFORGE_APP_PASSWORD` is provided. Direct live inspection on 2026-11-14 found no password verifier on the production role, so password-based API authentication is not yet configured. The role has no CREATEDB/CREATEROLE/SUPERUSER rights and only the table/sequence privileges needed by the backend. It has BYPASSRLS because the API enforces object ownership and role authorization; browser roles have no direct table grants.
- Supabase's connected production schema has RLS enabled on all 12 public application tables and intentionally has zero RLS policies. The `anon` and `authenticated` database roles have no public-table CRUD or sequence grants, so direct browser/PostgREST access is denied. The private `rideforge_app` login is the only application database principal and has `BYPASSRLS` plus narrowly scoped per-table grants; the C++ API enforces object/role authorization in parameterized SQL. Supabase's `rls_enabled_no_policy` advisor result is therefore an expected informational warning for this server-only access model, not a reason to add permissive policies. If direct Supabase client access or Supabase Auth is introduced later, create and test explicit per-user RLS policies before granting browser roles table access.
- The only public-schema `SECURITY DEFINER` function is `enqueue_ride_event_notification()`, owned by `postgres`, with a fixed `search_path` of `pg_catalog, public`; it only inserts the outbox row for a new ride event. Direct EXECUTE is not granted to `anon`, `authenticated`, `service_role` or `rideforge_app`, and none of those roles has CREATE on `public`, preventing untrusted search-path object shadowing. The function is invoked through the `ride_events` AFTER INSERT trigger.
- Live migrations 013–015 are applied in `public.schema_migrations`: 013 removes sequence UPDATE from `rideforge_app` while retaining USAGE/SELECT; 014 revokes EXECUTE on existing public functions from PUBLIC, anon, authenticated and service_role and restricts future functions created by the postgres migration owner; 015 creates `rideforge_backup`, a NOLOGIN/passwordless BYPASSRLS identity with SELECT-only access to current/future public tables and USAGE/SELECT on sequences. The backup identity remains disabled until the encrypted export workflow is provisioned. Supabase-managed `supabase_admin` default ACLs remain broad for objects it creates in `public`; all current RideForge tables are owned by postgres, whose defaults are restricted. Create application objects only through the reviewed migration owner, and keep the standard Supabase `service_role` key server-only.

## Important limitations

- Tokens remain valid until expiry; there is no general token revocation/session registry yet.
- In-process rate limits do not coordinate across multiple API replicas and are not a substitute for edge/WAF limits.
- The API uses a bounded process-local PostgreSQL connection pool (10 connections per API process, 2-second acquisition timeout, rollback/session reset before reuse); it is not shared across replicas. Production monitoring and a verified production restore drill are not evidenced. The API has an authenticated SSE stream backed by PostgreSQL NOTIFY and persisted-event replay, but it has not been load-tested and driver/admin push subscriptions are not implemented. NOTIFY alone is not a durable client-delivery guarantee; REST resynchronization remains necessary.
- Driver approval is an administrative workflow, not identity, licence, insurance or vehicle-document verification. Passenger profile editing currently covers display name only; verified phone/email workflows and notification preferences require an approved verification/communications provider and are not implemented.
- Location updates are user-submitted and freshness-checked, not proof of real GPS provenance.
- Public routing/geocoding endpoints are for development/evaluation only.
- No payment processing, refunds, safety dispatch or emergency-service integration is implemented. Support reports are an internal demo queue only; they do not promise response times or contact emergency services.

## Release review

- [ ] Rotate all deployment secrets; never use example values in public environments.
- [ ] Serve the API only over HTTPS behind a correctly configured reverse proxy.
- [x] Separate migration-owner and runtime database roles; [ ] provision the `rideforge_app` password in Render and verify a real login; [ ] restrict network access to PostgreSQL.
- [x] Add bounded per-process PostgreSQL connection pooling (10 connections, 2-second acquisition timeout); [ ] add shared/distributed rate limits before horizontal scaling. [x] Request IDs and redacted structured logs are implemented.
- [ ] Test BOLA/IDOR across passenger, driver and admin identities.
- [ ] Test stale, revoked, malformed and wrong-role tokens.
- [ ] Test duplicate/out-of-order requests, cancellation races and competing assignments.
- [x] Implement exact CORS allowlisting for passenger and driver hosts; CI tests allowed origins and verifies an untrusted origin is not reflected.
- [ ] Continue reviewing security headers, body/header limits and provider timeout behavior.
- [ ] Define data retention/deletion for trip and location data; redact precise coordinates from logs.
- [ ] Verify exact-head dependency/container scans; [ ] activate encrypted production backups, off-site retention and complete an isolated restore drill.
- [ ] Assess applicable privacy and transport obligations before processing real customer data or operating real rides.

## Incident handling

1. Disable affected credentials and rotate secrets if compromise is suspected.
2. Preserve redacted request IDs, audit events and database timestamps; do not copy raw tokens into an incident ticket.
3. Stop driver availability or bookings if assignment integrity is uncertain.
4. Restore service only after verifying database consistency and the root cause.
5. Document the incident, customer impact, containment and follow-up tests.


## Driver location minimization

The API stores only the latest driver coordinates while the driver is online. Going offline clears latitude, longitude, and the last-location timestamp; the web client sends no coordinates in the offline request and stops geolocation watching on logout/offline. The current portfolio MVP does not keep a historical GPS trail. A production deployment still needs a documented account-data retention/deletion schedule and privacy review.
