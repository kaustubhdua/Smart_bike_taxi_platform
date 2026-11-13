# RideForge — implementation and release roadmap

Last reconciled: 2026-11-13. PR #53 (dispatch uniqueness) and PR #54 (driver offer polling and portal routes) are merged. Main assessment SHA: `2c6ba631815b13feb6d3064de47765967e8db0ec`. Their exact PR candidates each passed all 13 release-readiness jobs: PR #53 run `43433243879`; PR #54 run `43432850270`. The exact-main post-merge run `43434905271` passed all 13 release-readiness jobs. Migration 011 is applied to Supabase. The role has a password verifier, but the matching Render runtime URL/owner connection remain pending. PR #59 adds candidate migration 012 for least-privilege runtime grants; production currently records only 001–011. Root `render.yaml` defines adoption of the existing free-tier API and static-site services. Render Blueprint `exs-dbrhb55g1s2s738gi39g` has an initial adoption plan awaiting approval; no infrastructure changes have been applied. See `docs/RELEASE_READINESS_EVIDENCE.md` for evidence. No live API deployment or commercial readiness is claimed.

## Product goal

Build an original, accessible, portfolio-grade bike-taxi product with a React/TypeScript client, a C++17 HTTP API, PostgreSQL persistence, route/fare quotes, passenger bookings, driver operations and an admin workspace. Preserve the C++ DSA core as a documented, benchmarkable part of the portfolio. A deployed demo must clearly distinguish simulated payment/safety features from real services.

## Current implemented foundations

- C++17 DSA application, graph routing, deterministic selection/lifecycle tests and an opt-in benchmark.
- React + TypeScript + Vite passenger experience with a lazy-loaded map, configurable geocoding/routing adapter, persisted trip history and printable demo receipts.
- C++17 Boost.Beast API for database liveness (`/api/v1/health`) and schema readiness (`/api/v1/ready`), server-authoritative route quotes, passenger registration/login, persisted idempotent bookings, history/detail, cancellation, driver availability/queue/acceptance/status and protected admin metrics.
- PostgreSQL migration 001 for accounts, profiles, rides, quotes, ride events and idempotency; migration 002 adds explicit driver approval and a transactional event notification outbox.
- Driver queue reads are limited to approved profiles online with a location updated in the last five minutes. Availability and acceptance enforce approval.
- Dispatch uses durable 45-second offers with expiry and sequential redispatch; migration 011 enforces one active offer per driver across concurrent workers. The driver workspace polls its queue every five seconds while online, independently of the 60-second GPS refresh.
- The passenger portal is `/`, the driver portal is `/driver` (or a `driver.` hostname), and the protected admin portal is `/admin`; the Render static-site rewrite is defined in `render.yaml`.
- Migration runner applies ordered SQL files and fails closed on an existing unversioned schema.
- CI covers C++ builds/tests, API HTTP smoke behavior, PostgreSQL migration/invariant checks, frontend typecheck/build/E2E/accessibility checks, and container/Compose validation. Only runs on the exact head SHA count as release evidence.

## Known gaps — do not represent as complete

- Driver provisioning, approval and suspension API/UI are implemented with an audit trail. Real-world identity/vehicle document verification remains outside this demo.
- The ride-event outbox publisher is implemented with PostgreSQL NOTIFY, retry/backoff and dead-letter handling. The API exposes an authenticated SSE stream with persisted-event replay; passenger and driver workspaces consume ride-status frames and REST polling remains the recovery path. Ride detail exposes a fresh driver location only to authorized ride participants during an active ride; the passenger map displays that marker and hides it when the location is stale/offline or the ride becomes terminal.
- Dispatch queue filters approved, online drivers with a fresh location and a configurable `RIDEFORGE_DISPATCH_RADIUS_KM` great-circle pickup radius (1–100 km; default 20 km); it is not yet ranked by road ETA, and the radius remains a demo policy rather than a calibrated operating rule.
- Admin workspace exposes operational metrics, bounded ride search, driver provisioning/approval/suspension, privileged-action audit history, and support-report triage with transactional audit records. Real-time paging, external support tooling and operational incident escalation remain future work.
- No real payment processing, refund/reconciliation, real SMS delivery, production safety response or commercial fleet operations.
- No live production deployment, production provider contract, tested production backup/restore, or legal authorization for commercial rides is claimed.
- No production-grade distributed rate limiting or shared connection pool is claimed.
- REA research tooling has not been installed/run in this implementation branch unless a later evidence artifact says otherwise.

## Phase 0 — establish trustworthy evidence

- [x] Inspect the current branch, backend, frontend, migrations, tests and CI configuration.
- [x] Add a reproducible frontend lockfile install (npm ci).
- [x] Add explicit driver approval and a transactional event outbox foundation.
- [x] Add smoke tests for offline queue privacy and unapproved driver rejection.
- [x] Configure the aggregate release-readiness workflow to run on pull requests and include C++/sanitizer/benchmark, API integration (5 km and 20 km), PostgreSQL migration/recovery, web/Playwright/axe, dependency audit, CodeQL, container/Compose and CRITICAL/HIGH container scanning. [ ] Confirm every required check is green on the exact latest PR head after final changes.
- [x] Reconcile the web README with implemented booking/auth/driver workflows and document the per-driver decline contract in OpenAPI.
- [x] Merge release-hardening PR #9 after all 13 aggregate release-readiness jobs passed on tested head `d0cab5d11bab857190f7232ffecc501ae0d5bca3`.
- [ ] Re-run the release gate on the exact candidate release SHA after any subsequent code changes; a successful earlier SHA is not evidence for later commits. Durable-offer PR #13 has been opened and its checks are pending.
- [x] CI applies all versioned migrations (001–009), re-runs the migration runner for idempotency, verifies integrity constraints and restores a backup into a fresh database; the PR #44 exact candidate also passed container/Compose validation and vulnerability scanning.

Acceptance: every required current-head check is green; migrations 001–012 apply in order, migration 012 enforces no runtime DELETE and append-only audit/ledger records, and a second migration run is a no-op.

## Phase 1 — transactional API and security

- [x] Expand cross-account and cross-role authorization tests for every protected endpoint (`backend/tests/authz_matrix_test.py`; a guard fails CI if a protected OpenAPI operation is missing from the matrix).
- [x] Test same-key booking retries, payload conflicts, expired/consumed quotes, expired driver-offer acceptance, accept-vs-expiry race and durable expired-offer redispatch, cancellation races and concurrent driver acceptance (`backend/tests/concurrency_test.py`, real PostgreSQL).
- [x] Verify event rows and outbox rows commit/rollback together (`backend/tests/outbox_events_test.py`).
- [x] Implement a bounded per-process PostgreSQL connection pool (12 connections, 2-second acquisition timeout, rollback/session reset before reuse). [ ] Verify pool behavior under concurrent load and budget aggregate connections before horizontal scaling; a per-process pool is not shared across replicas.
- [x] Make account deactivation/revocation take effect promptly (per-request active/role check, ≤5 s cache, fails closed); the short-lived token model is documented in `docs/HARDENING_AND_TESTING.md`.
- [ ] Add distributed rate limits before horizontally scaling. (Per-process limits, trusted-proxy client-IP resolution, IPv6 /64 keys and a per-account login throttle are in place and tested; they are not shared across replicas.)
- [ ] Complete a full SQLSTATE-to-HTTP mapping review and document retryable versus permanent database errors. (Malformed IDs, oversized bodies, auth header forms, and 4xx-not-5xx behavior are now covered by adversarial tests.)
- [x] Separate migration-owner credentials from the non-superuser `rideforge_app` runtime role; CI verifies role attributes, password login, grants and API/worker connectivity. [x] Add candidate migration 012 to revoke unused runtime DELETE and audit/ledger mutation rights. [ ] Verify deployed credentials and restrict database network access.

Acceptance: adversarial integration tests pass and no client can read or mutate another account's ride.

## Phase 2 — driver trust and operations

- [x] Add an admin-only driver provisioning/approval/suspension API and corresponding UI.
- [x] Record approval actor/time and audit driver provisioning, approval and suspension.
- [ ] Add driver profile/vehicle fields and a documented demo verification policy.
- [x] Reject stale or out-of-area offers at both queue and acceptance time using configurable `RIDEFORGE_DISPATCH_RADIUS_KM` (1–100 km; default 20), tested at 5 km and 20 km.
- [ ] Add a real earnings/payout ledger with adjustments, deductions and settlements; current driver history reports gross completed fares only.
- [x] Add bounded admin ride search by ride ID, account email, pickup/drop-off and status with server-side role checks.
- [x] Add persisted support/incident reports, participant-only ride references, per-account rate limiting, admin triage and transactional audit events.
- [ ] Add failed-dispatch alerting, escalation policy and external support operations.

Acceptance: a newly created driver cannot go online until explicitly approved; suspended drivers lose dispatch eligibility. The API and UI are implemented; CI evidence on the current head is still required.

## Phase 3 — realtime and dispatch

- [x] Implement an outbox publisher with row leasing, bounded retries, redaction and dead-letter visibility.
- [x] Add authenticated SSE subscriptions scoped to ride ownership; passenger and driver workspaces consume ride-status events.
- [x] Use persisted event IDs, Last-Event-ID replay and reconnect backoff for passenger streams.
- [ ] Add explicit browser resynchronization and load/reconnect stress tests beyond current smoke coverage.
- [x] Persist driver-specific decline decisions and test that declining never cancels the passenger's booking.
- [x] Refresh driver coordinates while online with movement-aware updates and a 30-second freshness heartbeat; clear stored coordinates and timestamp when going offline/logout. [ ] Define and verify a retention/deletion policy for account data.
- [ ] Rank eligible drivers by configured distance/ETA policy, with a provider adapter and timeout/failure behavior.
- [x] Test duplicate, delayed and out-of-order event delivery (SSE now replays from `ride_events` on every NOTIFY hint, so a late older event is no longer dropped).
- [x] Add a durable offer table, expiry worker and bounded automatic redispatch; offers expire after 45 seconds, and acceptance/decline require a live offer. API smoke tests cover persisted accepted/declined offer state. [ ] Add dedicated expiry/redispatch stress tests and load-test multiple worker replicas.
- [x] Enforce one active `offered` row per driver with migration 011 and a unique partial index; add a PostgreSQL integration test that races two dispatch-worker processes across 12 rides/four drivers.
- [x] Refresh the online driver's offer queue every five seconds, independently of GPS refresh, so the UI can see 45-second offers before expiry. Playwright verifies the polling cadence.

Acceptance: passenger and driver converge on the same persisted ride state after refresh, disconnect, reconnect and duplicate events.

## Phase 4 — passenger product completeness

- [x] Calculate the road route and fare only after an explicit server-quote action; keep public geocoding off browser keystrokes and enforce provider pacing server-side. [ ] Add optional place suggestions only after selecting a contracted/self-hosted geocoder, plus accessible map selection and keyboard alternatives.
- [ ] Verify fare breakdown, cancellation policy and confirmed state across API failures.
- [x] Add passenger trip history with final fare/completion timestamps and a printable demo receipt, plus driver trip history and gross completed-fare summary (not a payout ledger).
- [x] Add passenger/driver support reporting and admin triage UI.
- [x] Add same-origin `/driver` and `/admin` portal entry points and browser coverage; the Render SPA fallback rewrite is part of the deployment Blueprint.
- [ ] Finish broader empty/error/offline UX review and manual accessibility sign-off.
- [ ] Ensure no fabricated success when the API/provider is unavailable.
- [ ] Complete mobile/browser QA and WCAG 2.2 AA review.

Acceptance: a passenger can register, quote, book, refresh, track, cancel when permitted and view trip history on the deployed build.

## Phase 5 — reliability, privacy and deployment

- [x] Add a schema-aware `/api/v1/ready` probe and use it for the Compose API healthcheck.
- [x] Add `render.yaml` to adopt the existing free-tier `rideforge-api-final` and `rideforge-web` services, deploy from `main` only after checks pass, and rewrite SPA paths to `/index.html`. [x] Create the Render Blueprint and plan its initial adoption sync. [ ] Review/approve the planned sync, provision the `rideforge_app` password, and enter/test the Supabase runtime/migration secrets.
- [x] Add generated request IDs to API/SSE responses and redact raw quote-provider/database exception text.
- [x] Add backup/restore scripts, a CI recovery smoke test, and schema-readiness failure-path coverage.
- [x] Add structured redacted request-completion logs, correlation IDs, SIGTERM/SIGINT handling, and bounded graceful draining.
- [x] Bound routing-provider HTTP connect/total timeouts and HTTP socket read/write deadlines.
- [x] Bound PostgreSQL connection-establishment time to five seconds in Compose API, migration and outbox-worker services via libpq `PGCONNECT_TIMEOUT`.
- [x] Implement a bounded per-process PostgreSQL connection pool (12 connections, 2-second acquisition timeout). [ ] Validate pool capacity under concurrent load, size aggregate connections before horizontal scaling, and add broader SSE connection observability.
- [x] Document local and Compose backup/restore procedures and add a CI recovery smoke test.
- [ ] Complete a production backup/restore drill and rehearse schema upgrade/rollback recovery.
- [ ] Run API load and concurrency tests; publish hardware/environment and measured results.
- [x] Add scheduled CodeQL analysis for C++/TypeScript and dependency-review checks for high-severity/disallowed-license changes.
- [x] Add CodeQL, dependency audit, and CRITICAL/HIGH container image scans to CI.
- [x] The constituent CI suite has passed on recent release-candidate commits; [ ] require all checks green on the exact PR head immediately before merge.
- [ ] Review and exercise location/data retention and deletion procedures.
- [ ] Select a suitable contracted or self-hosted routing/geocoding provider for any public service.
- [x] Add and CI-validate a self-hosted HTTPS Compose overlay, Caddy TLS edge, and same-origin API/SSE proxy.
- [ ] Deploy frontend/API/database on a real host using protected secrets and HTTPS; verify the exact release SHA.
- [ ] Capture genuine desktop/mobile screenshots, record the deployment URL and publish a demo walkthrough.

Acceptance: clean setup and deployment are reproducible, all checks pass on one release SHA, and operations/recovery steps have been exercised.

## Phase 6 — optional commercial capabilities

- [ ] Payment sandbox first, then signed/deduplicated webhooks, reconciliation, refunds and support operations.
- [ ] Real notifications only after consent, provider setup, delivery/retry monitoring and cost limits.
- [ ] Safety/incident escalation that never falsely claims to contact emergency services.
- [ ] Assess Indian DPDP applicability/commencement, state transport rules, insurance, driver/vehicle verification and legal permission before commercial operation.

Acceptance: each external capability has separate operational and legal approval. A portfolio demo is not represented as an authorized ride-hailing service.

## UI/engineering principles

- Use React, TypeScript, Radix/accessibility primitives, Motion with reduced-motion support, and Lucide icons where appropriate.
- Preserve required notices for third-party open-source components; do not copy competitor branding or proprietary assets.
- Prioritize clear fare transparency, honest state transitions, accessible controls, explainable dispatch and evidence-backed DSA benchmarks over decorative effects.
