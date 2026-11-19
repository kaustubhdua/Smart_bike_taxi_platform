# Supabase-native RideForge operations

> **Operational refresh (19 November 2026):** PR #106 is merged to `main` with the Nirdhoom-inspired UI, browser Photon forward/reverse geocoding, a 1.1-second public-request throttle, GPS-coordinate fallback, and server-authoritative routing/fare calculation. The deployed Supabase `rideforge-api` remains the backend. The existing Render static site `rideforge-web` (`https://rideforge-web.onrender.com`) is the active frontend deployment because Vercel's free daily deployment API limit was exhausted; the Vercel production alias remains on the previous build until its quota resets or the account plan changes. Render is configured with `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and the Supabase publishable key. Edge Function v15 explicitly allows `https://rideforge-web.onrender.com` in CORS. The main-push browser acceptance test now targets Render and verifies a real passenger route quote. Backup credentials, Auth URL allowlist for the Render domain, and hosted passenger/driver/admin acceptance remain outstanding.

**Scope:** current academic/portfolio MVP deployment as of 19 November 2026. This is the active operations guide. It does not authorize real passenger transport, payments, or commercial operation.

## 1. Active architecture and inventory

- GitHub repository: [kaustubhdua/Smart_bike_taxi_platform](https://github.com/kaustubhdua/Smart_bike_taxi_platform).
- Supabase project: `ghcufcegfvvjhsnqnrzr`, Mumbai region, PostgreSQL 17.11, Free plan.
- Edge Function: `rideforge-api`, deployed and ACTIVE at version 15 (last observed 19 November 2026).
- Active frontend: Render static site `rideforge-web` at [rideforge-web.onrender.com](https://rideforge-web.onrender.com), connected to `main`, building `web` and publishing `web/dist`.
- Production browser API base: `https://ghcufcegfvvjhsnqnrzr.supabase.co/functions/v1/rideforge-api` (Render static-site environment variable `VITE_API_BASE_URL`).
- Render `rideforge-web` is the active static frontend fallback. Legacy Render API services are not used; keep them stopped and do not point the frontend back to a Render backend.
- The current React client uses authenticated SSE polling plus REST recovery. The database Realtime publication is enabled for `rides` and `ride_events`, but the browser does not currently subscribe to it directly.

The Supabase database currently contains 14 public tables, all with RLS enabled. Migration `025_atomic_driver_offer_transitions` is applied; `rideforge_accept_offer` and `rideforge_decline_offer` exist, `service_role` can execute the decline RPC, and `anon`/`authenticated` cannot. The production database has zero Auth users, zero application accounts and zero rides at the latest audit. Do not claim that a live passenger/driver/admin journey has been proven until the first verified account and deployed E2E tests exist.

## 2. Safe deployment workflow

The repository pins Supabase CLI v3.0.0 in CI. CLI v3 defaults database commands to the local stack; use explicit `--remote` for hosted database operations and `--yes` for unattended hosted changes. Read the [CLI v3 migration guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3) before changing the pinned version.

From the repository root, after reviewing the PR and the exact commit:

```bash
supabase login
supabase link --project-ref ghcufcegfvvjhsnqnrzr
supabase migration list --remote
supabase db push --remote --yes
supabase functions deploy rideforge-api --no-verify-jwt --yes
```

Do not run `supabase db reset --remote` against production. Do not use `db push` without `--remote` when intending to change the hosted project; under CLI v3 it targets the local database by default. Do not deploy an Edge Function from an unreviewed branch.

The normal release sequence is:

1. Run [Full release readiness](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/release-readiness.yml) on the exact PR head.
2. Require every child job to pass, including the local Supabase migration rebuild/security-invariant test, Deno type-check, frontend type-check/build/Playwright, PostgreSQL migration/recovery, C++ tests, API smoke, CodeQL, dependency audit and container checks.
3. Merge the integrated release PR #97 only after the exact-head Full release readiness and backup-workflow actionlint checks are green.
4. Confirm Render `rideforge-web` deploys the merged `main` SHA and the production bundle embeds the Supabase Edge Function URL. Vercel can be re-enabled after its deployment quota resets.
5. Deploy the reviewed Edge Function source to Supabase with `verify_jwt=false` only because the function performs its own JWT validation; verify `/api/v1/health` and `/api/v1/ready` from an external runner.
6. Complete the real browser acceptance checklist in section 5.
7. Only then retire the legacy Render API services; keep `rideforge-web` as the active static host unless Vercel is restored.

## 3. Supabase Auth and administrator bootstrap

Open [Supabase Auth URL configuration](https://supabase.com/dashboard/project/ghcufcegfvvjhsnqnrzr/auth/url-configuration) and set:

- Site URL: `https://rideforge-web.onrender.com`
- Additional redirect URL: `https://rideforge-web.onrender.com/**`
- Additional redirect URL: `http://localhost:5173/**`

The Edge Function default signup verification redirect should target `https://rideforge-web.onrender.com`. Add the Render origin to Supabase Auth URL Configuration (Site URL and Additional Redirect URLs) before testing signup. Keep the Vercel URL as a secondary redirect until Vercel is restored. Do not disable email confirmation merely to make a demo signup appear successful.

There are currently no production Auth users. The first admin must be a real, verified account created through the app. Then a project owner must promote exactly that account once in the Supabase SQL Editor:

```sql
UPDATE public.accounts
SET role = 'admin', updated_at = now()
WHERE email = lower('YOUR_VERIFIED_ADMIN_EMAIL')
  AND role = 'passenger'
RETURNING id, email, role;
```

Verify exactly one row is returned. Never add a public admin-promotion endpoint, place a service-role key in the browser, or create a dummy admin identity to satisfy a release checklist.

Driver accounts are provisioned by an admin and begin unapproved/offline. Approval in the demo is not identity, licence, insurance or vehicle verification.

## 4. Security and health checks

After a schema or function deployment:

- Run Supabase Security, Health and Performance Advisors in the project dashboard or through the connected Supabase tools.
- Verify all public application tables retain RLS; SECURITY DEFINER functions keep pinned search paths; client roles cannot execute privileged RideForge RPCs; and service-role credentials remain server-only.
- Verify `rideforge-api` is ACTIVE and the health/readiness endpoints respond.
- Review Edge Function and Postgres logs for errors and unexpected traffic.
- Confirm the deployed function's source matches the reviewed repository SHA.

The latest advisor snapshot had zero Security findings and zero Health findings. The Performance Advisor reported 16 informational unused indexes on an empty production database; do not drop indexes without representative workload evidence.

## 5. Required real browser acceptance

Use separate real browser sessions and a verified test passenger, admin and provisioned driver. Do not rely solely on Playwright network mocks.

**Passenger**
- Sign up, receive and follow email verification, sign in, sign out and sign back in.
- Read and update the passenger profile.
- Request a route quote; confirm the server fare and expiry; confirm malformed/expired quotes are rejected.
- Create a ride, retry idempotently, see dispatch state, cancel where allowed, and verify history/receipt.
- Disconnect/reconnect and confirm persisted state is recovered through REST/SSE.
- Submit a support report and verify it appears in the passenger's report history.

**Driver**
- Confirm an unapproved driver cannot go online or receive/accept offers.
- Approve the driver through admin; sign in as driver and go online with fresh location.
- Verify offer visibility, 45-second expiry, decline/redispatch, acceptance, arrival, in-progress and completion.
- Verify stale location/offline/suspended drivers cannot accept.
- Verify driver history is gross completed fares, not net earnings or a payout ledger.

**Admin**
- Verify non-admin accounts receive 403 for every admin route.
- Verify metrics, driver provisioning/approval/suspension, ride search, support triage and audit history.
- Confirm failed operations do not leave orphan Auth users or partially provisioned driver profiles.

Record the tested commit SHA, browser/device, test account role (never password/token), timestamp, screenshots and any failures. Do not fabricate a successful journey.

## 6. Backups and recovery

Supabase Free does not include automatic daily backups or PITR. The repository has a scheduled encrypted GitHub Actions backup workflow, but it is **not active until the dedicated database role and GitHub repository secrets are configured**.

The current `rideforge_backup` role is intentionally NOLOGIN and has read-only access. To activate the workflow:

1. Use a private trusted terminal and a secure PostgreSQL owner connection. Enable LOGIN for `rideforge_backup` and set a unique strong password without putting it in shell history, Git, or chat.
2. Create repository secrets:
   - `RIDEFORGE_BACKUP_DATABASE_URL`: Supabase Session pooler URI, port 5432, username `rideforge_backup.ghcufcegfvvjhsnqnrzr`, URL-encoded password and `sslmode=require`.
   - `RIDEFORGE_BACKUP_PASSPHRASE`: a separate strong GPG passphrase.
3. Manually run [Supabase encrypted backup](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/supabase-backup.yml).
4. Verify the run succeeds and download/decrypt the artifact in a controlled environment.
5. Perform an actual restore into a disposable PostgreSQL 17 database and verify schema, constraints and representative row counts.
6. Store an encrypted copy outside GitHub Actions artifacts with a documented retention period, access controls and key recovery procedure. The current Actions artifact retention is 30 days and is not sufficient as the sole long-term backup.

The new isolated restore workflow is added in PR #97, but it cannot run until the two repository secrets and backup login are provisioned and a backup artifact exists. The workflow backs up the RideForge `public` schema; it does not include managed Auth or Storage schemas, Edge Function bundles, project secrets or platform settings. A passing schema-only restore drill is not full Supabase disaster recovery.

## 7. Known product and launch boundaries

RideForge is an academic/portfolio MVP, not a licensed transport operator. The current demo fare is illustrative (₹20 base + ₹11/km), not a UP-notified commercial tariff. No real payment initiation, signed payment webhook, refunds, payout ledger, verified driver/vehicle KYC, staffed emergency response, or legal aggregator licence is implemented.

The final Uttar Pradesh Thirty-third Amendment aggregator rules were notified on 22 May 2026. New aggregators need the applicable STA licence and must meet driver, vehicle, insurance, training, control-room, grievance, app-security and data-retention requirements. Noida is in the NCR and CAQM Direction 94 restricts further induction of conventional petrol/diesel two-wheelers; the transitional BS-VI exception for existing fleets expires 31 December 2026. Do not offer real rides or accept money until the exact legal/vehicle class is confirmed in writing and all statutory controls are operational.

## 8. Browser geocoding and route quote contract

- The passenger web client resolves one location only after the user requests a quote; it does not send address queries on every keystroke.
- Photon requests are throttled to at least 1.1 seconds apart within a browser tab and biased toward Noida.
- If reverse geocoding fails after GPS permission, the client still sends validated GPS coordinates and labels the pickup as a current GPS location.
- The Edge Function accepts coordinate pairs only after latitude/longitude range validation, then calls OSRM itself. It never trusts a client-supplied fare, distance, duration or route geometry.
- Server-side geocoding remains as a compatibility fallback for non-browser callers, but public Photon/Nominatim requests are blocked from the current Supabase Edge egress region; production web traffic should send coordinates.

## 9. External service and cost boundaries

- Public Photon/Nominatim and OSRM endpoints are evaluation defaults, not a production service contract. Do not submit personal/confidential pickup addresses to public Nominatim. Select a contracted or self-hosted geocoder/router before real-world use.
- Supabase Free has limited compute, database, log and backup capabilities. Measure actual workload and plan capacity before any public pilot.
- Render is used only for the static frontend in the active architecture. The three legacy Render API services are not required by the Supabase-native app.
- Do not add real payment or emergency integrations without an approved provider, credentials, legal review and end-to-end tests.
