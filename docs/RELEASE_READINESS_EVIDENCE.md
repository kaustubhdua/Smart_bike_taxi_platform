# RideForge Release Readiness Evidence

**Assessment date:** 2026-11-13  
**Repository:** `kaustubhdua/Smart_bike_taxi_platform`  
**Main SHA at assessment:** `a1eff3bfe4a6e99f668bbf8c2d4796beda084f2d`  
**Release decision:** **Not ready for public/commercial rides.** The repository has a substantially hardened full-stack MVP, but no verified public staging deployment, real two-device journey, production operational service, driver/vehicle compliance process, or transport-authority/legal approval.

This report distinguishes repository implementation and automated CI from evidence that requires real infrastructure. A green build, local Compose stack, mock-provider browser test, or demo receipt is not proof of a commercially operating taxi service.

## Latest merged upgrades — PR #53 and PR #54

Both release-hardening upgrades are merged into `main`:

| Change | Merge SHA | Exact candidate evidence | Result |
|---|---|---|---|
| One active dispatch offer per driver (PR #53) | `05581bb1bdcbf68d9675a647db1b334f337dbe3b` | [Full release readiness, run 43433243879](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43433243879), candidate `9216cd69f34c8c7bdddf7df8d86b7cf3a261ee9f` | 13/13 jobs passed. Migration 011 adds a unique partial index; worker selection excludes drivers with another active offer; a two-worker PostgreSQL test verifies the invariant. |
| Driver offer visibility and portal routing (PR #54) | `2c6ba631815b13feb6d3064de47765967e8db0ec` | [Full release readiness, run 43432850270](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43432850270), candidate `e2300ca274efe342de78cb7924d10595059d8c64` | 13/13 jobs passed. Driver queue polls every five seconds while online; `/driver` and `/admin` entry points are tested; 37 Playwright browser tests passed. |

The latest main-branch full release-readiness run for the previous assessment SHA `2c6ba631815b13feb6d3064de47765967e8db0ec` is [run 43434905271](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43434905271), which completed all 13/13 jobs successfully. This is exact-main evidence for that SHA; deployment and commercial-readiness gates remain separate.

## Current infrastructure snapshot — 2026-11-13 (latest recheck)

- Supabase project `rideforge-production` (`ghcufcegfvvjhsnqnrzr`) is `ACTIVE_HEALTHY`, PostgreSQL 17.11, region `ap-south-1`. Direct read-only SQL checks confirm all 12 public tables have RLS enabled and migrations 001–011 are recorded.
- The private `rideforge_app` role exists, is LOGIN and BYPASSRLS, and is not a superuser. It has SELECT/INSERT/UPDATE/DELETE grants on the 12 application tables. The `anon` and `authenticated` roles have no table grants. The RLS-enabled/no-policy Supabase advisor findings (12 INFOs) are expected under this deliberate model: browser roles cannot reach the tables, while only the trusted backend role bypasses RLS and enforces account/role ownership in the API. This is a high-trust backend boundary and must remain covered by authorization tests. A later read-only SQL recheck confirmed a password verifier exists for `rideforge_app`; the password itself is not retrievable, and whether Render has a matching runtime secret remains unverified.
- The Supabase performance advisor currently reports 21 unused indexes. These are not removed: the database has little/no production traffic, and the indexes support expected history, dispatch, expiry and foreign-key access paths. Reassess with representative workload statistics before considering removal.
- Render Blueprint sync `exe-dbrhk33m8hqs73d2tvn0` was approved and applied to the existing `rideforge-api-final` and `rideforge-web` services only. Both now track `main`; no Render database, duplicate service or paid resource was created.
- The static site is live at [https://rideforge-web.onrender.com](https://rideforge-web.onrender.com), deployed from PR #57 merge SHA `0f69d9fc735aa0cea330cd4672ec2c721bd1a03d`. The API Docker image also built from that SHA, but the service exited at startup because the required private-role `DATABASE_URL` was absent. There is no healthy public API or verified end-to-end journey yet. API service: [Render dashboard](https://dashboard.render.com/web/srv-dbloqnom7kps73br5ojg).
- The existing Supabase database is used; no Render Postgres instance exists or is needed for this architecture. Render's free web-service plan sleeps when idle, so even after configuration it is evaluation hosting, not a production availability commitment.
- PR #59 proposes a safer deployment contract: Render-generated 256-bit base64 runtime-role password, a password-free `DATABASE_URL_TEMPLATE`, URI-safe password construction, one protected migration-owner URL, and candidate migration 012 to revoke unused runtime DELETE rights and protect append-only audit/event and schema-migration records. PR #60 moves route lookup behind explicit server-side quote requests and adds a persistent demo-only warning. PR #62 adds the state-compliance research and this evidence refresh. At the latest recheck, exact-head CI for PRs #59, #60, #62 and #63 was queued. None of these exact heads has completed all required checks; do not merge them yet.
- Required manual inputs remain: (1) `DATABASE_URL_TEMPLATE` built from the exact Supabase **Session pooler** host/port and username `rideforge_app.PROJECT_REF`, with `__RIDEFORGE_PASSWORD__` in the password component; and (2) `MIGRATION_DATABASE_URL` using the exact owner Session-pooler URI and the actual database-owner password. The host/port and owner password are not returned by Supabase project metadata or the connected database inspection tools; the exact values are available only in Supabase **Connect**/Database Settings. They must be entered into Render's protected environment settings. Never paste either secret into chat. The new variables must be added manually to the existing Render service after the Blueprint update because Render ignores newly added `sync: false` values on subsequent syncs.


## Earlier verified engineering milestone — PR #44 (historical)

[PR #44](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/44), “Harden auth, provider calls and SSE; add adversarial test suites”, was merged on 2026-11-13 as `d7a90e24977119618f079ae7f8c1623aae97899d`.

Its exact candidate head was `b386f4db8da4b5d0817963252d525ac7d0af9610`. The [Full release readiness workflow, run 43377409848](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43377409848) completed **13/13 jobs successfully**. This included GCC/Clang and ASan/UBSan C++ checks, PostgreSQL migration/recovery, API smoke at 5 km and 20 km, web build/browser checks, Compose/container build, container vulnerability scanning, CodeQL and npm dependency audit.

The PR added:
- 20 authorization-matrix checks, including token tampering, role checks, cross-account access and account-state changes.
- 11 PostgreSQL-backed concurrency tests (including expired-offer acceptance).
- 13 transactional outbox/SSE tests, including lease expiry recovery and out-of-order replay.
- 19 abuse-control tests covering proxy-aware IP resolution, IPv6 keys, login throttling, request limits and provider pacing.
- Provider circuit-breaker, concurrency, content-type, route-metric and untrusted-label guards.
- Three defect fixes: malformed quote IDs returning 422, SSE replay gaps, and live offers surviving ride cancellation.
- Docker build-context corrections that address the previously observed missing migration/entrypoint files.

**Important distinction:** the 13/13 result belongs to the exact PR candidate SHA above. The post-merge workflows on main SHA `d7a90e24977119618f079ae7f8c1623aae97899d` were still running at the time of this assessment. Do not call post-merge main CI green until those exact-SHA workflows finish successfully.

## Historical release-gate snapshot before PR #53/#54

The table below is retained for history and is superseded by the current evidence summary at the top of this report.

| Area | Evidence/status | Remaining work |
|---|---|---|
| C++ API, DSA, sanitizer checks | PR #44 candidate passed | Confirm exact post-merge main checks |
| Authorization and abuse controls | Adversarial tests merged | Distributed limits and independent security review |
| Dispatch | Durable 45-second offers, expiry/redispatch, one-active-offer-per-driver unique index, two-worker PostgreSQL regression test | Production-scale worker stress, restart/recovery and sustained load metrics |
| Outbox/SSE | Persisted replay and fault tests merged | Real reconnect/load metrics, alerts and production resynchronization |
| PostgreSQL | 10-connection per-process pool, migration/recovery tests, Supabase-verified restricted runtime role/grants, and one-active-offer-per-driver database constraint | Runtime password/Render connection, aggregate connection budget, saturation tests and production restore drill |
| Web | Passenger, driver and admin workspaces; `/driver` and `/admin` paths; five-second driver queue polling; 37 Playwright tests passed | Manual Android/iOS, keyboard/screen-reader and WCAG 2.2 AA sign-off; push/SMS notifications remain unimplemented |
| Routing | Provider guards and deterministic mock tests | Contracted/self-hosted provider, production-wide cache and global rate limits |
| Deployment | Render Blueprint configuration for existing free-tier services; Supabase schema ready | Blueprint adoption/sync, runtime credentials, healthy API deployment, HTTPS journey, monitoring and restore drill |
| Operations | Admin approval, support triage and audit events | Real driver/vehicle verification, staffed escalation and incident drills |
| Commercial | No real payment or transport authorization claimed | Payment/refund ledger, insurance, state-specific legal and privacy approval |

## External blockers

The existing Render static site is live from `main`, but the API service is not healthy. No verified running API, end-to-end booking journey, production DNS/custom domain, or real two-device passenger-to-driver acceptance has been established. The Supabase `rideforge_app` role has a password verifier, but the matching runtime connection string and owner migration connection are not configured/verified in Render. Do not infer deployment from a Blueprint file, template, or CI.

The repository also reports `main` as unprotected. The GitHub integration available for this review cannot change repository branch-protection settings; a repository administrator must configure a ruleset requiring pull requests and the relevant release checks, while preventing force pushes and branch deletion.

## Selected historical engineering changes and exact-candidate evidence

| Change | Merge SHA | Exact candidate CI evidence | Result |
|---|---|---|---|
| Auth/provider/SSE adversarial hardening (PR #44) | `d7a90e24977119618f079ae7f8c1623aae97899d` | [Full release readiness, run 43377409848](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43377409848), candidate `b386f4db8da4b5d0817963252d525ac7d0af9610` | 13/13 jobs passed on exact candidate; post-merge main workflows were pending at assessment time. |

## Previous engineering changes and exact-candidate evidence

| Change | Merge SHA | Exact candidate CI evidence | Result |
|---|---|---|---|
| Route/geocode caches, malformed-provider validation (PR #20) | `f4e9a5d2f8db17d678e2b97292ada976b0a18868` | [Full release readiness, run 40648144882](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40648144882), candidate `c7853cc84928bba3cf9f00ed157378e5cf91b948` | 13/13 jobs passed; browser tests reported 25 passed, 1 skipped. |
| Bounded per-process PostgreSQL pool (PR #21) | `dafd28504f80e252887b2467648a78f33e5d6726` | [Full release readiness, run 40648486771](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40648486771), candidate `5ece2fe492b998eb2109504c09199552e56617c7` | 13/13 jobs passed, including concurrent connection smoke tests. |
| Production driver/admin entry routing (PR #22) | `82f0f7a53ca0dc3e382152f75a6c70923166d596` | [Full release readiness, run 40650689471](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40650689471), candidate `f85dad1fa6f64a8dda1cf530dedf712db4fea76b` | All 13 jobs passed. |
| Dispatch expiry/ride lock-order hardening (PR #23) | `8c6ee2ed12e3cff339c98b4389dacff708e525bb` | [Full release readiness, run 40651307975](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651307975), candidate `0fc4bb5cf54adfb03cc4b583a63b7175e36dec3d` | All 13 jobs passed. Main-branch workflows for the merge SHA are running separately and were not yet complete at the time of this report. |
| Debounce location geocoding while typing (PR #26) | `d2e1cd1449d471d6fd3bdc58e0457675446c2d84` | [Full release readiness, run 40651766311](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651766311), candidate `1ae3ad8b05662d5720715b73491f775167ba7aaa` | All 13 jobs passed; browser workflow reported 31 passed, 1 skipped. |

The latest main revision at this report's assessment is `a1eff3bfe4a6e99f668bbf8c2d4796beda084f2d` (PR #61 merge); its exact-SHA CI passed as recorded above. The merged PR's test presence does not substitute for confirming the full release-readiness workflow on main. Do not describe current-main CI as green until those exact-SHA runs complete.

## Capability and limitation matrix

| Area | Status | What is still missing |
|---|---|---|
| Passenger booking, accounts, history and cancellation | Implemented in repository | Verified public deployment and real-device end-to-end evidence. |
| Driver workspace, queue, timed offers and redispatch | Implemented in repository | Real driver onboarding/verification, push/background alert proof, race/restart/load tests. |
| Admin workspace | Implemented in repository | Production access controls and tested operator procedures. |
| PostgreSQL persistence and migrations | Implemented in repository | Production database, least-privilege roles, off-host backup and restore rehearsal. |
| Live ride events (SSE/outbox) | Implemented in repository | Production reconnect/load measurements and alerts for lag/dead letters. |
| PostgreSQL API pool | Bounded to 12 connections per API process on current main, 2-second acquisition wait; PR #59 proposes reducing it to 10 for the Supabase shared-pooler budget | Aggregate connection budgeting across replicas/workers and representative saturation/load tests. It is not a shared cross-replica pool. |
| Maps/geocoding/routing | Public OSM Nominatim and OSRM evaluation endpoints are defaults; route caching and malformed-response validation are implemented | Public endpoints do not provide a commercial SLA. Nominatim's one-request/second ceiling applies across all users of an application, and its policy prohibits client-side autocomplete. A browser-local queue is not an application-wide limiter. Configure a suitable provider or self-hosted stack, with global rate limiting, caching, terms and attribution. |
| Payments/refunds/driver payouts | Not implemented as a real commercial money flow | Provider integration, server-verified webhooks, idempotency, refunds, reconciliation and ledger. Demo receipts are not payment evidence. |
| Driver identity, licence, vehicle, insurance and permits | Not verified by the software alone | Documented real-world verification and competent-authority checks before activating drivers. |
| Emergency response and support | A support-report workflow exists | Staffed response process, ownership, escalation, response-time expectations and tested incident procedures. A form is not an emergency service. |
| Public HTTPS URLs, DNS and hosting | Not verified | Real deployed origins, TLS/DNS, persistent database, managed secrets, CORS allowlist and public smoke test. |
| Monitoring, recovery and privacy | Procedures documented; live operation not evidenced | Alerts, retention/deletion, account revocation, encrypted off-host backups, restore drill, measured RPO/RTO and incident runbook rehearsal. |
| Legal authorization | Not established | Qualified legal advice and transport-authority confirmation for the intended state, vehicle class and business model. |

## Release gates

### A. Engineering and concurrency
- [x] Exact-candidate CI passed for PRs #20, #21, #22 and #23 as listed above.
- [ ] Confirm current-main CI passes on `8c6ee2ed12e3cff339c98b4389dacff708e525bb`.
- [x] Merge PR #26 after its exact head passed the 13-job full release-readiness suite and browser E2E (31 passed, 1 skipped).
- [ ] Add deterministic PostgreSQL race/recovery coverage for concurrent accept, accept-vs-expiry, cancellation races, worker restart, duplicate worker execution and cross-role/cross-account authorization.
- [ ] Load-test API, pool saturation, dispatch worker and SSE/outbox with recorded workload, latency, error rates and recovery behavior.
- [ ] Budget total PostgreSQL connections across all API replicas plus dispatch/outbox workers before scaling.

### B. Real staging deployment
- [ ] Select and explicitly configure the hosting workspace/provider, persistent database, secrets, DNS, TLS, firewall and CORS origins.
- [ ] Replace public demo routing/geocoding defaults with a suitable contracted or self-hosted service and application-wide request limits.
- [ ] Deploy passenger and driver origins and record the exact deployed SHA.
- [ ] Run an end-to-end journey from two independent real devices over public HTTPS: passenger request, driver offer, decline/expiry redispatch, accept, arrival, trip start, completion, history, cancellation and reconnect recovery.
- [ ] Keep evidence real: public URLs, timestamps, CI links, redacted logs and actual test results. Do not manufacture screenshots, metrics or delivery receipts.

### C. Operations, privacy and safety
- [ ] Configure monitoring/alerts for API errors and latency, DB saturation, dispatch outcomes, worker health, outbox backlog/dead letters and backup failures.
- [ ] Create encrypted off-host backups and successfully restore to a separate environment; record measured recovery point and recovery time.
- [ ] Define consent, location retention/deletion, access logging, account suspension/revocation, support ownership, incident escalation and emergency disclosures.
- [ ] Verify driver identity, licence, vehicle, insurance and permits through a documented process.
- [ ] Obtain qualified state-specific legal/privacy review and written transport-authority confirmation before real rides.

### D. Commercial features, only if offered
- [ ] Integrate real payments only with server-verified provider webhooks, idempotency, refunds, reconciliation and driver payout accounting.
- [ ] Implement and test real push/SMS delivery before promising background alerts; distinguish queued, accepted, sent, delivered and opened.
- [ ] Publish only features and service guarantees that have actually been implemented and tested.

## External primary-source research

- [Haryana Transport Department — Aggregator Policy notification dated 21 May 2026](https://haryanatransport.gov.in/en/content/aggregator-policy-transport-department-notification-no-13920166ti-dated-21st-may-2026). Relevant to intended Haryana/NCR operations; applicability and vehicle eligibility require competent-authority/legal confirmation.
- [MoRTH — Motor Vehicle Aggregator Guidelines 2025 (PDF)](https://parivahan.gov.in/sites/default/files/NOTIFICATION%26ADVISORY/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf). Starting point for licensing and operational review, not proof of RideForge compliance.
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/). Public service limit is one request/second per application across all users; client-side autocomplete is prohibited; commercial use requires careful capacity/policy planning.
- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/). Public standard tiles are best-effort with no SLA, require attribution/caching and may be blocked for policy violations.

## Safe release wording

Until the gates above are evidenced, describe RideForge as a **full-stack bike-taxi MVP with PostgreSQL-backed booking/dispatch code and a self-hosting template**. Do not describe it as a live taxi service, claim that payments are processed or driver documents verified, promise emergency response, or publish unmeasured availability/performance figures.

## Evidence log template

Fill only with observed values:

- Candidate and deployed SHA:
- Full release-readiness workflow URL/conclusion:
- Passenger HTTPS URL:
- Driver HTTPS URL:
- Deployment timestamp:
- Migration/recovery result:
- Two-device end-to-end result:
- Race/load test conditions and measured results:
- Backup restore result and measured RPO/RTO:
- Driver/vehicle verification owner and procedure:
- Legal/transport authority reviewer:
- Open P0/P1 issues:


## Follow-up hardening — 2026-11-13

- PR [#46](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/46) merged as `cd0361f9d491a7423f61338a2210cc75ce1a3508`. Its exact head `71f25e9053eb3349bd3daff35ee51a0bad409b47` passed all 13 jobs in [Full release readiness run 43401276877](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43401276877). The new PostgreSQL-backed regression verifies an expired driver offer cannot be accepted, does not assign the ride, and does not create an accepted-offer row.
- PR [#49](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/49) merged as `4d4ff78d7ed12ce7b4432bd4fbce07678bc82603`. Its exact head `b42c590d41b5df38e4682247f2a9b0fbad8d4acf` passed all 13 jobs in [Full release readiness run 43403681589](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43403681589). It adds migration 010, provisions the `rideforge_app` password through the owner-only migration runner, configures Compose/CI to run the API and workers with that role, and verifies the runtime login in PostgreSQL/API smoke tests.
- The dedicated Supabase project `rideforge-production` was restored and is now `ACTIVE_HEALTHY`. Supabase migration history confirms migrations 001–011 are recorded. All 12 public tables have RLS enabled; `anon` and `authenticated` have zero table/sequence privileges; `rideforge_app` is LOGIN+BYPASSRLS, non-superuser, has no CREATEDB/CREATEROLE rights, has database CONNECT and table DML but not TRUNCATE. Its password is not yet configured, and a direct login test from the application runtime has not been performed. Migration 011 adds `ride_offers_one_active_per_driver`, a unique partial index over `status='offered'`; the live database confirms the migration ledger and index definition, with zero active offers at application time. The Supabase security advisor reports only the expected informational `rls_enabled_no_policy` findings because the Data API roles have no grants; no health findings were returned. The unused-index advisor reports 22 unused indexes on the empty database, which is expected before workload and is not grounds for removing them.

Do not infer that the Render API is deployed from the repository template: the connected Render workspace has no PostgreSQL instance, and its existing RideForge API deploys are on an older branch and have failed. The static site has a previous live deployment, but this is not proof of an integrated passenger-to-driver journey.


## Mainline release verification after PR #49 — 2026-11-13

PR #49's exact candidate passed 13/13 release-readiness jobs before merge. The resulting main SHA is `4d4ff78d7ed12ce7b4432bd4fbce07678bc82603`; its own post-merge workflows were still running when this evidence update was prepared. Those post-merge workflows have since completed successfully: [Full release readiness run 43404828111](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43404828111) passed 13/13 jobs. Do not substitute the PR-candidate pass for post-merge main verification. The runtime role password is provisioned by the deployment migration runner only when `RIDEFORGE_APP_PASSWORD` is configured; it remains unset in the restored Supabase project until a real deployment connection is configured.


## Multi-worker dispatch correction — 2026-11-13

Source review after PR #51 found a real multi-replica race: separate dispatch workers can lock different rides and select the same currently-free driver before either offer is committed. Migration 006 only enforced one active offer per ride, not per driver. The worker also did not exclude drivers with an existing active offer.

The follow-up branch `fix/dispatch-one-offer-per-driver` adds migration 011 with a fail-closed duplicate preflight and unique partial index on `ride_offers(driver_id) WHERE status='offered'`. The dispatch worker excludes drivers with active offers both in ride eligibility and final driver selection; the unique index remains the final race guard. CI schema smoke verifies the index and rejects a second active offer for the same driver, and the API integration suite runs two dispatch-worker processes against PostgreSQL with multiple rides/drivers.

The migration was applied to the connected Supabase project. The migration ledger records 011, the index is unique with the expected predicate, and there were zero active offers at application time. Do not mark the code fix complete until the exact PR head passes CI and is merged.



## Current deployment and release evidence — 2026-11-13

### Merged mainline changes

- PR [#61](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/61) merged to main as `a1eff3bfe4a6e99f668bbf8c2d4796beda084f2d`. Its exact candidate `e2420b39f3d35dcf33a97f629e4ed830cf24cc5c` passed all seven top-level workflow runs, including [Full release readiness run 43441762858](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43441762858), C++/API/PostgreSQL/web/container tests, CodeQL and container vulnerability scan. The change isolates the accept-vs-expiry test fixture from the live dispatcher.
- Mainline already includes PRs #53, #54 and #57 for per-driver active-offer exclusion, driver/admin experience and Render Blueprint adoption.

### Render deployment observation

- The existing static service is live at [https://rideforge-web.onrender.com](https://rideforge-web.onrender.com), deployed from commit `0f69d9fc735aa0cea330cd4672ec2c721bd1a03d` (PR #57) at 2026-11-13 14:09:38 UTC.
- The existing API service [rideforge-api-final](https://dashboard.render.com/web/srv-dbloqnom7kps73br5ojg) built its image, but deployment `dep-dbrhk556e07s73bo8kcg` failed at runtime. Its exact startup error was `DATABASE_URL (private runtime role) is required`; no API health/readiness or full-stack E2E pass is claimed.
- The Render Blueprint intentionally adopts the two existing free services and does not create a Render database. The existing Supabase project remains the database.

### Supabase production database recheck

- Project `rideforge-production` is `ACTIVE_HEALTHY`, Postgres 17.11 in `ap-south-1`.
- Migration history records 001–011; 12 application tables are present and all 12 have RLS enabled.
- `anon` and `authenticated` have no table privileges in the public schema. The backend role `rideforge_app` is LOGIN, non-superuser, has a password verifier, has table DML but not TRUNCATE, and has BYPASSRLS. Tables are owned by `postgres`, not the app role. This is a privileged backend-only role; the password must never enter browser variables, source control or chat.
- The earlier statement above that the `rideforge_app` password was unset is superseded by this read-only recheck. Its current password verifier does not establish that Render has the matching runtime URL configured; PR #59 provisions the generated Render password during deployment.

### Open exact-head candidates

- PR [#59](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/59): Render-generated runtime password, password-free URI template, URL-encoding helper, CI tests and candidate migration 012 least-privilege grants. All exact-head checks were queued at this snapshot.
- PR [#60](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/60), head `a7439986146491cb244f39de672bda844f439526`: explicit server-side quote routing, bounded GeoJSON, Noida geocoding context, public Nominatim allowlist for five public landmarks, policy-compliant OSM tile host and persistent demo-only notice. All exact-head checks were queued at this snapshot.
- PR [#62](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/62) (this branch): UP aggregator licensing/vehicle/driver/fare/DPDP research and OSM/OSRM provider restrictions. Exact-head checks were queued at this snapshot.
- PR [#63](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/63), head `b7510bcccbac74b12f5c2ac6423a34d2ca069494`: process-level dispatch-worker restart recovery regression. All exact-head checks were queued at this snapshot.

### Remaining non-negotiable gates

1. Pass exact-head CI for PRs #59, #60, #62 and #63 before merging.
2. Configure protected `DATABASE_URL_TEMPLATE` (actual Supabase Session-pooler host copied from Connect; runtime username `rideforge_app.PROJECT_REF`; literal `__RIDEFORGE_PASSWORD__` placeholder) and protected `MIGRATION_DATABASE_URL` (owner Session-pooler URI) in Render.
3. Merge the validated candidates, sync the Render Blueprint, redeploy the API, and verify `/api/v1/health` and `/api/v1/ready`.
4. Run passenger, driver and admin E2E journeys against the deployed SHA using separate sessions/devices; verify workers, reconnect/replay, cancellation, expiry/redispatch and support triage.
5. Complete production provider capacity, distributed rate limiting, load/connection-budget tests, monitoring/alerts, off-host backup restore, privacy retention/deletion and manual mobile/accessibility QA.
6. Keep real passenger transport disabled until UP licensing, transport-motorcycle eligibility, driver screening/training/insurance, CAQM/NCR constraints, required independent app-security certification, 24x7 safety operations and qualified legal/privacy review are evidenced.
7. Configure and test main-branch protection/rulesets (issue #17): require PRs and release checks, block force-push/deletion, and verify that missing checks block merging. This could not be changed through the connected GitHub integration in this session.

The static frontend being live is not a full-stack deployment. No commercial rides, payment processing, verified driver onboarding, staffed emergency dispatch or transport authorization are claimed.

## Live Supabase production recheck — 13 November 2026, 15:50 UTC

This read-only database inspection supersedes earlier snapshots in this document that described migration 012 as merely a candidate or stated that the role still had DELETE grants.

- Supabase project `rideforge-production` is `ACTIVE_HEALTHY`, PostgreSQL 17.11, region `ap-south-1`.
- The live `public.schema_migrations` ledger records migrations 001 through 012, including `012_runtime_role_least_privilege` at 2026-11-13 15:42:34 UTC. The migration is already applied in production; it must not be applied a second time manually.
- `rideforge_app` is LOGIN+BYPASSRLS, non-superuser, without CREATEDB/CREATEROLE, and has a password verifier. The secret itself is not retrievable. A Render-side login using the generated runtime password has not yet been proven.
- A direct read-only privilege check found **zero DELETE table grants** for `rideforge_app`. UPDATE/DELETE on `admin_audit_events`, `ride_events`, and `driver_ride_declines` are all false; INSERT/UPDATE/DELETE on `schema_migrations` are false. This confirms the append-only/least-privilege migration is live.
- The 12 public tables remain RLS-enabled. `anon` and `authenticated` have no public-table grants. The trusted server-side `rideforge_app` role remains the only application role with direct table DML (excluding DELETE). This role has BYPASSRLS and must never be exposed to browser clients.
- Supabase security advisor: 12 INFO findings named `rls_enabled_no_policy`, expected because the Data API roles have no table grants; no health findings. Performance advisor: 21 unused-index INFO findings on an essentially empty database. Do not drop indexes until representative workload and query-plan evidence exists.
- The project metadata exposes the direct endpoint `db.ghcufcegfvvjhsnqnrzr.supabase.co`, but not the exact shared Session-pooler cluster index/hostname or the database-owner password. Do not derive or guess the pooler host from the Mumbai region; copy it from Supabase Connect.

The remaining database/Render blocker is therefore not the schema migration or the existence of the runtime role. It is the protected connection configuration and proof that the Render-generated runtime secret is provisioned through the owner connection and successfully used by the API.

The Render service still needs:
1. `DATABASE_URL_TEMPLATE` using the exact shared Session-pooler hostname from Supabase Connect, port 5432, username `rideforge_app.ghcufcegfvvjhsnqnrzr`, and the literal `__RIDEFORGE_PASSWORD__` placeholder.
2. `MIGRATION_DATABASE_URL` using the same exact Session-pooler host/port, owner username `postgres.ghcufcegfvvjhsnqnrzr`, and the actual database-owner password.

Set these only in the existing Render service's protected Environment page. Never send passwords through chat. The generated Render runtime password is applied by the migration runner's `ALTER ROLE rideforge_app PASSWORD ...` step, even when migration 012 is already recorded.

No schema change, service creation, paid resource or Render environment-variable update was performed during this inspection.

## Final exact-head and hosting snapshot — 13 November 2026 (latest tool recheck)

- PR #59 latest reviewed head: `4beb2cdaa167e77f92c1595169d6b213e2b79d44` (25 check runs queued/pending at snapshot). It now accepts both PostgreSQL URI aliases, rejects direct/transaction-pooler endpoints for Render, and requires migration 012 in `/api/v1/ready`.
- PR #60 latest reviewed head: `ebd2bdf1f90a5057c739a9d28cb45300b16e3129` (25 check runs queued/pending).
- PR #62 is the documentation/compliance evidence branch; its own commits are excluded from the code-test gate except for the required repository-wide workflows. It distinguishes the UP March draft from the final May rules analysis, cites the signed CAQM Direction 94 amendment, and records DPDP phased commencement dates.
- PR #63 latest reviewed head: `91ca5bf1bd8204cb18a9883f18effe228b55a2e3` (24 check runs queued/pending).
- All four PRs were mergeable in GitHub's metadata, but no exact-head required check had completed at this snapshot. Do not merge based on mergeability alone.
- Render workspace `kaustubh dua`: the existing API `rideforge-api-final` remains on `main`, free plan, and unhealthy. Its latest build from `0f69d9f` succeeded but runtime startup failed because the old mainline entrypoint requires `DATABASE_URL` and the protected value is not configured. The static `rideforge-web` service remains the existing live free static site.
- Render Blueprint remains paused with `autoSync=false`. A fresh plan against current mainline proposes only one change to the existing static site's publish path (`web/dist` → `./web/dist`); it creates no resource and changes no service plan. The plan was not approved/applied. It does not yet include PR #59's generated runtime secret/template because that branch has not merged.
- The remaining manual values are still the exact Supabase shared Session-pooler hostname from Connect and the owner database password. Supabase's current documentation confirms shared Session mode is the IPv4-compatible option for persistent services and uses port 5432; transaction mode on 6543 is for transient workloads. The project metadata does not reveal the assigned pooler hostname.
