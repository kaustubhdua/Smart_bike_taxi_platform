# RideForge — implementation and release roadmap

Last reconciled: 2026-10-18. This document describes the feature branch, not a claim that the service is commercially ready.

## Product goal

Build an original, accessible, portfolio-grade bike-taxi product with a React/TypeScript client, a C++17 HTTP API, PostgreSQL persistence, route/fare quotes, passenger bookings, driver operations and an admin workspace. Preserve the C++ DSA core as a documented, benchmarkable part of the portfolio. A deployed demo must clearly distinguish simulated payment/safety features from real services.

## Current implemented foundations

- C++17 DSA application, graph routing, deterministic selection/lifecycle tests and an opt-in benchmark.
- React + TypeScript + Vite passenger experience with a lazy-loaded map and configurable geocoding/routing adapter.
- C++17 Boost.Beast API for health, server-authoritative route quotes, passenger registration/login, persisted idempotent bookings, history/detail, cancellation, driver availability/queue/acceptance/status and protected admin metrics.
- PostgreSQL migration 001 for accounts, profiles, rides, quotes, ride events and idempotency; migration 002 adds explicit driver approval and a transactional event notification outbox.
- Driver queue reads are limited to approved profiles online with a location updated in the last five minutes. Availability and acceptance enforce approval.
- Migration runner applies ordered SQL files and fails closed on an existing unversioned schema.
- CI covers C++ builds/tests, API HTTP smoke behavior, PostgreSQL migration/invariant checks, frontend typecheck/build/E2E/accessibility checks, and container/Compose validation. Only runs on the exact head SHA count as release evidence.

## Known gaps — do not represent as complete

- Driver provisioning, approval and suspension API/UI are implemented with an audit trail. Real-world identity/vehicle document verification remains outside this demo.
- The ride-event outbox publisher is implemented with PostgreSQL NOTIFY, retry/backoff and dead-letter handling. The API exposes an authenticated SSE stream with persisted-event replay; passenger and driver workspaces consume ride-status frames and REST polling remains the recovery path. Ride detail exposes a fresh driver location only to authorized ride participants during an active ride; the passenger map displays that marker and hides it when the location is stale/offline or the ride becomes terminal.
- Dispatch queue filtering currently uses approval, online status and location freshness; it is not yet a full road-ETA ranking service or geographic matching engine.
- Admin workspace exposes operational metrics, driver provisioning/approval/suspension, and recent privileged-action audit history. Incident response and audit search/filtering remain future work.
- No real payment processing, refund/reconciliation, real SMS delivery, production safety response or commercial fleet operations.
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
- [ ] Verify the Compose startup path applies all migrations from a clean database and is repeatable.

Acceptance: every current-head check is green, migration 001 and 002 apply in order and the second migration run is a no-op.

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
- [ ] Add driver profile/vehicle fields and a documented demo verification policy.
- [ ] Reject stale or out-of-area offers at both queue and acceptance time.
- [ ] Add a driver trip history/earnings ledger that is derived from persisted rides.
- [ ] Add admin ride search, failed dispatch inspection and incident records.

Acceptance: a newly created driver cannot go online until explicitly approved; suspended drivers lose dispatch eligibility. The API and UI are implemented; CI evidence on the current head is still required.

## Phase 3 — realtime and dispatch

- [x] Implement an outbox publisher with row leasing, bounded retries, redaction and dead-letter visibility.
- [x] Add authenticated SSE subscriptions scoped to ride ownership; passenger and driver workspaces consume ride-status events.
- [x] Use persisted event IDs, Last-Event-ID replay and reconnect backoff for passenger streams.
- [ ] Add explicit browser resynchronization and load/reconnect stress tests beyond current smoke coverage.
- [ ] Add fresh driver-location updates while online; stop sharing on offline/logout and enforce retention.
- [ ] Rank eligible drivers by configured distance/ETA policy, with a provider adapter and timeout/failure behavior.
- [ ] Test duplicate, delayed and out-of-order event delivery.

Acceptance: passenger and driver converge on the same persisted ride state after refresh, disconnect, reconnect and duplicate events.

## Phase 4 — passenger product completeness

- [ ] Finish pickup/destination autocomplete, map selection, accessible map alternatives and quote expiry handling.
- [ ] Verify fare breakdown, cancellation policy and confirmed state across API failures.
- [ ] Add trip detail/history, receipt, support reporting and clear empty/error/offline states.
- [ ] Ensure no fabricated success when the API/provider is unavailable.
- [ ] Complete mobile/browser QA and WCAG 2.2 AA review.

Acceptance: a passenger can register, quote, book, refresh, track, cancel when permitted and view trip history on the deployed build.

## Phase 5 — reliability, privacy and deployment

- [ ] Add request IDs and structured redacted logs, readiness checks, graceful shutdown and dependency timeouts.
- [ ] Document and test backup/restore; verify schema upgrade and rollback/recovery procedures.
- [ ] Run API load and concurrency tests; publish hardware/environment and measured results.
- [ ] Run dependency, container and API security scans; review data retention and deletion.
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
