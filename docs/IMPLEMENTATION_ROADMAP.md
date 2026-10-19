# RideForge — implementation and release roadmap

Last reconciled: 2026-10-19. This document describes the feature branch, not a claim that the service is commercially ready.

## Product goal

Build an original, accessible, portfolio-grade bike-taxi product with a React/TypeScript client, a C++17 HTTP API, PostgreSQL persistence, route/fare quotes, passenger bookings, driver operations and an admin workspace. Preserve the C++ DSA core as a documented, benchmarkable part of the portfolio. A deployed demo must clearly distinguish simulated payment/safety features from real services.

## Current implemented foundations

- C++17 DSA application, graph routing, deterministic selection/lifecycle tests and an opt-in benchmark.
- React + TypeScript + Vite passenger experience with a lazy-loaded map, configurable geocoding/routing adapter, and permission-based current-location pickup with reverse geocoding.
- C++17 Boost.Beast API for database liveness (`/api/v1/health`) and schema readiness (`/api/v1/ready`), server-authoritative route quotes, passenger registration/login, persisted idempotent bookings, history/detail, cancellation, driver availability/queue/acceptance/status/history, authenticated SSE, and protected admin metrics, driver management, ride search and audit history.
- PostgreSQL migrations 001–003 cover accounts, profiles, rides, quotes, ride events, idempotency, explicit driver approval, a transactional event notification outbox and dead-letter tracking.
- Driver queue reads are limited to approved profiles online with a location updated in the last five minutes. Availability and acceptance enforce approval.
- Migration runner applies ordered SQL files and fails closed on an existing unversioned schema.
- CI covers C++ builds/tests, API HTTP smoke behavior, PostgreSQL migration/invariant checks, frontend typecheck/build/E2E/accessibility checks, container/Compose validation, dependency audit, CodeQL and container vulnerability scanning. The manual Full release readiness workflow now invokes all eight suites against one workflow checkout; only a successful run on the exact release SHA counts as release evidence.

## Known gaps — do not represent as complete

- Driver provisioning, approval and suspension API/UI are implemented with an audit trail and the demo-versus-real-world boundary is documented in [the driver verification policy](DRIVER_VERIFICATION_POLICY.md). Real identity/vehicle document verification remains outside this demo.
- The ride-event outbox publisher is implemented with PostgreSQL NOTIFY, retry/backoff and dead-letter handling. The API exposes an authenticated SSE stream with persisted-event replay; passenger and driver workspaces consume ride-status frames and REST polling remains the recovery path. Ride detail exposes a fresh driver location only to authorized ride participants during an active ride; the passenger map displays that marker and hides it when the location is stale/offline or the ride becomes terminal.
- Dispatch queue filters approved, online drivers with a fresh location and a 20 km great-circle pickup radius; it is not yet ranked by road ETA, and the radius is a demo policy rather than a configurable operating rule.
- Admin workspace exposes operational metrics (including outbox backlog/dead-letter health), driver provisioning/approval/suspension, recent privileged-action audit history and bounded ride search. Support/incident records, explicit failed-dispatch investigation and a documented safety-response workflow remain future work.
- No real payment processing, refund/reconciliation, net driver payout/commission ledger, real SMS delivery, production safety response or commercial fleet operations.
- No live production deployment, production provider contract, tested production backup/restore, or legal authorization for commercial rides is claimed.
- No production-grade distributed rate limiting or shared connection pool is claimed.
- REA research tooling has not been installed/run in this implementation branch unless a later evidence artifact says otherwise.

## Phase 0 — establish trustworthy evidence

- [x] Inspect the current branch, backend, frontend, migrations, tests and CI configuration.
- [x] Add a reproducible frontend lockfile install (npm ci).
- [x] Add explicit driver approval and a transactional event outbox foundation.
- [x] Add smoke tests for offline queue privacy and unapproved driver rejection.
- [ ] Re-run every workflow against the latest exact commit SHA; fix all failures.
- [ ] Ensure README, this roadmap, OpenAPI, PR description and issue tracker agree.
- [x] CI starts the complete Compose stack from a clean database, waits for schema readiness, checks API health and web HTML, then tears the stack down.

Acceptance: every current-head check is green, migrations 001–003 apply in order and a second migration run is a no-op.

## Phase 1 — transactional API and security

- [ ] Expand cross-account and cross-role authorization tests for every protected endpoint.
- [ ] Test same-key booking retries, payload conflicts, expired/consumed quotes, cancellation races and concurrent driver acceptance.
- [ ] Verify event rows and outbox rows commit/rollback together.
- [ ] Add a real connection pool or bounded database concurrency strategy.
- [ ] Make account deactivation/revocation take effect promptly; document the short-lived token model.
- [ ] Add distributed rate limits before horizontally scaling.
- [ ] Review malformed JSON, oversized headers/bodies, route path parsing, SQLSTATE mapping, and safe error/log behavior.
- [ ] Add least-privilege database roles and a secrets/dependency scan.

Acceptance: adversarial integration tests pass and no client can read or mutate another account's ride.

## Phase 2 — driver trust and operations

- [x] Add an admin-only driver provisioning/approval/suspension API and corresponding UI.
- [x] Record approval actor/time and audit driver provisioning, approval and suspension.
- [x] Add driver profile/vehicle fields and a documented demo verification policy.
- [x] Reject stale or out-of-area offers at both queue and acceptance time (20 km great-circle demo radius).
- [x] Add driver trip history and lifetime gross completed-trip fare totals derived from persisted rides; this is not a net payout ledger.
- [ ] Add admin ride search, failed dispatch inspection and incident records.

Acceptance: a newly created driver cannot go online until explicitly approved; suspended drivers lose dispatch eligibility. The API and UI are implemented; CI evidence on the current head is still required.

## Phase 3 — realtime and dispatch

- [x] Implement an outbox publisher with row leasing, bounded retries, redaction and dead-letter visibility.
- [x] Add authenticated SSE subscriptions scoped to ride ownership; passenger and driver workspaces consume ride-status events.
- [x] Use persisted event IDs, Last-Event-ID replay and reconnect backoff for passenger streams.
- [ ] Add explicit browser resynchronization and load/reconnect stress tests beyond current smoke coverage.
- [x] Refresh driver location while online, stop sharing on offline/logout, and enforce freshness-limited exposure. Retention/deletion policy for real production data remains open.
- [ ] Rank eligible drivers by configured distance/ETA policy, with a provider adapter and timeout/failure behavior.
- [ ] Test duplicate, delayed and out-of-order event delivery.

Acceptance: passenger and driver converge on the same persisted ride state after refresh, disconnect, reconnect and duplicate events.

## Phase 4 — passenger product completeness

- [x] Add pickup/destination autocomplete, accessible text route summary/map fallback, and quote-expiry messaging.
- [ ] Add direct map-click pickup/destination selection.
- [ ] Verify fare breakdown, cancellation policy and confirmed state across API failures.
- [x] Add passenger trip detail/history and clear empty/error/offline states.
- [x] Add a printable demo receipt for completed passenger rides, clearly labeled as not proof of payment or a tax invoice.
- [ ] Add support reporting.
- [x] Ensure no fabricated fare/booking success when the API/provider is unavailable; Playwright covers provider failures and quote errors.
- [ ] Complete mobile/browser QA and WCAG 2.2 AA review.

Acceptance: a passenger can register, quote, book, refresh, track, cancel when permitted and view trip history on the deployed build.

## Phase 5 — reliability, privacy and deployment

- [x] Add a schema-aware `/api/v1/ready` probe and use it for the Compose API healthcheck.
- [x] Add generated request IDs to API/SSE responses and redact raw quote-provider/database exception text.
- [x] Add backup/restore scripts, a CI recovery smoke test, and schema-readiness failure-path coverage.
- [x] Add structured redacted request-completion logs, correlation IDs, SIGTERM/SIGINT handling, and bounded graceful draining.
- [x] Bound routing-provider HTTP connect/total timeouts and HTTP socket read/write deadlines.
- [ ] Add explicit PostgreSQL connection timeouts/pooling and broader SSE connection observability.
- [ ] Document and test backup/restore; verify schema upgrade and rollback/recovery procedures.
- [ ] Run API load and concurrency tests; publish hardware/environment and measured results.
- [x] Add scheduled CodeQL analysis for C++/TypeScript, lockfile-backed npm audit, and scheduled high-severity container image scans.
- [ ] Execute all security scans on the release SHA, enable GitHub dependency graph for license/dependency review, and review data retention/deletion.
- [ ] Select a suitable contracted or self-hosted routing/geocoding provider for any public service.
- [ ] Deploy frontend/API/database using protected secrets and HTTPS; verify the exact release SHA.
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
