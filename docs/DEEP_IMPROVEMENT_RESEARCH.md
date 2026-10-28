# RideForge — deep improvement research and engineering plan

Last reviewed: 2026-10-28  
Scope: current feature branch, not a claim of commercial or production readiness.

## Executive recommendation

Do not add many unrelated features yet. First make the complete passenger-to-driver lifecycle secure, race-safe, observable, reproducible, and deployable. The repository already has a meaningful baseline: React/TypeScript/Vite, a C++17 Boost.Beast API, PostgreSQL migrations, persisted fare quotes and bookings, passenger auth, driver queue/acceptance/status endpoints, an outbox table, Docker Compose, a committed npm lockfile, and CI for C++, API, PostgreSQL, web E2E and accessibility.

The project becomes a stronger portfolio flagship when a reviewer can run one documented command, create passenger and approved-driver accounts, quote a route, book it, accept it exactly once under contention, move it through the lifecycle, recover from an interrupted client connection, inspect audit events, and see tests/metrics proving these claims.

## Evidence and research basis

- The repository's own `docs/IMPLEMENTATION_ROADMAP.md`, `backend/README.md`, `backend/openapi.yaml`, `compose.yaml`, migrations, and CI workflows are the implementation evidence. Read the latest exact PR head before asserting any check is green.
- OWASP API Security Top 10 identifies broken object-level authorization, broken authentication, unrestricted resource consumption, broken function-level authorization, sensitive business-flow abuse, security misconfiguration, inventory gaps and unsafe third-party API consumption as core API risks: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- NIST SP 800-63B-4 requires effective throttling for failed authentication attempts and discusses blocklists and risk-aware mitigations: https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP Password Storage guidance recommends modern adaptive password hashing, preferring Argon2id where appropriate and documenting/tuning parameters; it lists PBKDF2-HMAC-SHA-256 at 600,000 iterations as its current recommendation where PBKDF2 is used: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- PostgreSQL documents row-level locks such as `FOR UPDATE`, transaction-bound lock lifetime and deadlock risks; concurrent assignment must be tested against actual transactions and integrity constraints: https://www.postgresql.org/docs/current/explicit-locking.html
- Google SRE recommends monitoring latency, traffic, errors and saturation, with attention to tail latency: https://sre.google/sre-book/monitoring-distributed-systems/
- OpenTelemetry C++ supports telemetry instrumentation for traces, metrics and logs: https://opentelemetry.io/docs/languages/cpp/
- PgBouncer can reduce PostgreSQL connection overhead, but pooling mode has compatibility trade-offs that must be tested with the application's transaction/session behavior: https://www.pgbouncer.org/features.html
- OpenAPI security schemes should document which operations require which authentication mechanism: https://learn.openapis.org/specification/security.html
- The public Nominatim service has strict usage limits and is not suitable for client-side autocomplete or unrestricted commercial production use: https://operations.osmfoundation.org/policies/nominatim/
- The public OSRM demo service is best-effort and not a production SLA; production needs a suitable provider or self-hosted capacity: https://github-wiki-see.page/m/Project-OSRM/osrm-backend/wiki/Api-usage-policy
- India's Motor Vehicle Aggregator Guidelines 2025 and Motor Vehicles Act section 93 are relevant launch references; applicable state licensing must be confirmed before operating: https://parivahan.gov.in/sites/default/files/NOTIFICATION%26ADVISORY/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf and https://indiacode.ecourtsindia.com/mv-act/section/93/
- DPDP Act commencement and Rules must be reviewed against the actual operating date and processing activities: https://www.meity.gov.in/documents/act-and-policies

## Current state — baseline, not certification

Implemented or documented in this branch:
- C++ DSA routing and lifecycle tests, GCC/Clang and sanitizer jobs, plus a reproducible benchmark workflow.
- React/TypeScript web app, lazy Leaflet map, route quote flow, passenger booking and cancellation, driver workspace and admin metrics workspace.
- C++ API for health, route quotes, registration/login, passenger ride history/detail/cancellation, driver availability/queue/acceptance/status, and admin metrics.
- PostgreSQL migrations, quote persistence, ride events, booking idempotency, an active-driver uniqueness guard, driver approval and a durable ride-event outbox foundation.
- Dockerfiles, Compose services and a versioned migration runner.
- Committed `web/package-lock.json` and `npm ci` in web CI.
- CI workflows for C++, API/HTTP smoke tests, database migration checks, web build/E2E/accessibility, and Compose/container checks.

## Remaining release gaps — reviewed 2026-10-28
The following are not claimed as complete merely because the relevant code or workflow exists:
- Deterministic PostgreSQL race coverage for simultaneous accepts, accept-vs-expiry, cancellation, worker restart/duplicate execution, and cross-account/role authorization.
- A bounded PostgreSQL connection pool. The API currently opens a database connection in request handlers; pool design and concurrency/load tests remain a release-hardening task.
- Dispatch matching based on real road ETA and fresh driver locations; current eligibility and sequential offer logic is not a fully optimized commercial matching engine.
- Production routing/geocoding provider and terms. Public Nominatim/OSRM endpoints are evaluation defaults, not a production SLA.
- Commercial payment processing, refunds, reconciliation, driver payouts, and real SMS/push delivery are not implemented as verified end-to-end provider flows. Demo receipts are not payment proof.
- Real-world driver identity/licence/vehicle/insurance verification, emergency response, customer support operations, and jurisdiction-specific transport/legal/privacy review.
- A real RideForge staging/production deployment, DNS/TLS, production database/secrets, monitoring/alerts, off-host backups and a successful restore drill. The connected hosting inventory currently has no RideForge Vercel project or Render service.
- Repository branch protection and enforced required checks; issue #17 tracks the required admin settings.

Implemented in the repository (but still requiring operational validation) are driver provisioning/approval/suspension APIs, admin ride search/metrics, support reports with audited resolution, durable 45-second driver offers with expiry/redispatch, the outbox worker, authenticated SSE with persisted-event replay, and Compose deployment templates.

**Exact-main CI evidence:** full release-readiness run [40628698136](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40628698136) passed all 13 jobs on main revision `415b7d5cefeca0684053a16d4a2ece8b4bb1a606`. This validates that code revision in CI only; it is not proof of a deployed service or external passenger/driver journey. Always verify fresh checks on the exact candidate SHA.

## Prioritized implementation plan

### P0 — Release confidence and security

1. **Make CI evidence deterministic**
   - Capture the exact current PR head SHA and confirm every required workflow ran on that SHA.
   - Fix README, roadmap, OpenAPI and PR claims so they agree.
   - Ensure Compose starts from an empty database, applies migrations 001 and 002 in order, and a second startup performs no schema changes.
   - Keep `npm ci`; add a documented Node version and lockfile consistency check.

   Acceptance: all required checks green on one SHA; clean-volume Compose smoke and repeat-start test pass; release notes contain the verified SHA and evidence links.

2. **Create a role/object authorization matrix**
   - Passenger A cannot read/cancel Passenger B's ride.
   - Driver A cannot change a ride assigned to Driver B.
   - Passenger cannot invoke driver/admin operations; driver cannot invoke admin operations.
   - No public endpoint accepts a caller-supplied role or account ID as proof of identity.
   - Unknown, expired, malformed and tampered tokens fail closed with consistent status codes.
   - Add tests for every endpoint and every identifier-bearing operation.

   Acceptance: automated negative tests cover all rows of the matrix and no response leaks another account's PII.

3. **Race-test booking and driver assignment**
   - Send simultaneous accept requests from two eligible drivers for one ride; exactly one succeeds.
   - Send simultaneous accept requests for two rides to one driver; at most one active assignment succeeds.
   - Retry the same booking idempotency key and payload; return the original booking. Reuse the key with a different fingerprint; return conflict.
   - Race cancellation against acceptance and start/completion transitions; exactly one valid state transition wins.
   - Assert database rows, event rows, outbox rows and driver availability are mutually consistent after every race.

   Acceptance: repeated concurrency tests pass reliably against real PostgreSQL, not just mocks; database constraints remain the final integrity guard.

4. **Review authentication implementation against current guidance**
   - The current security helper uses PBKDF2-HMAC-SHA-256 with 210,000 iterations. Compare against current OWASP guidance and benchmark a safe upgrade path to a higher work factor or Argon2id; include a versioned hash format and rehash-on-success migration strategy.
   - Enforce password length/size limits before expensive hashing, generic login errors, account-aware throttling and bounded memory/CPU use.
   - Validate JWT algorithm/signature, expiry, issuer/audience if present, token structure and secret configuration. Fail startup if a weak/default production secret is used.
   - Add revocation/session rotation strategy before treating bearer tokens as production sessions.
   - Use TLS at the deployment edge; never log bearer tokens, passwords, precise location or secrets.

   Acceptance: security tests and a written threat model pass review; production configuration fails closed; performance cost of password verification is measured.

5. **Protect expensive third-party routing calls**
   - Bound response size and timeouts for geocoding/routing; validate content type and all numeric values; reject non-finite and unreasonable distance/duration values.
   - Add provider-specific concurrency limits, short-lived cache for normalized route lookups, circuit-breaker behavior and clear degraded-mode responses.
   - Keep public Nominatim/OSRM endpoints for demos only; configure a contracted or self-hosted provider for a deployed demo.
   - Do not allow arbitrary caller-controlled provider URLs; they can create SSRF risk.

   Acceptance: timeout, oversized response, malformed JSON, provider 429/5xx, route-not-found and recovery are covered by deterministic mock-provider tests.

### P1 — Complete the ride lifecycle

6. **Verify driver onboarding and operational identity checks**
   - Driver provisioning/approval/suspension APIs and admin audit mechanisms exist in the repository; verify the actual admin UI path, role authorization and audit completeness.
   - Keep unapproved or suspended drivers ineligible even when they call the API directly.
   - Define the real-world document review process for identity, licence, vehicle registration, insurance and permits; an admin flag is not proof that documents were verified.
   - Add/retain negative tests for self-approval, suspended drivers, stale location and account deactivation.

   Acceptance: automated authorization tests pass and an auditable, staffed document-verification process is approved before a real pilot.

7. **Verify trip lifecycle and keep settlement claims honest**
   - Ride status transitions, cancellation and final-fare persistence exist in the repository; test every allowed and rejected transition against real PostgreSQL, including race cases.
   - Distinguish estimated fare, final fare and any actual money movement in UI and API responses.
   - Until a real payment provider is integrated and reconciled, label receipts as demo records and do not imply that payment, refund or payout occurred.

   Acceptance: transition tests cover every valid/invalid edge and atomic audit behavior; no screen or receipt falsely claims that a financial transaction settled.

8. **Fault-test the implemented transactional outbox and authenticated SSE**
   - The outbox worker, persisted ride events, authenticated SSE and replay path exist; verify behavior under process termination, reconnects, duplicate delivery and backlog.
   - Confirm retry/backoff, poison-event handling, retention/cleanup and lag metrics are operationally adequate; document a replay and recovery runbook.
   - Test mobile/network reconnects and event gaps against REST resynchronization.

   Acceptance: repeatable PostgreSQL integration tests prove restart recovery and idempotent state, and measured load tests report event lag, backlog and recovery time.

9. **Improve dispatch matching**
   - First define a deterministic scoring function based on eligibility, road ETA, location freshness and tie-breakers.
   - Use actual road ETA or a documented approximation, not straight-line distance disguised as ETA.
   - Avoid locking all drivers globally. Select a bounded candidate set and use transactions plus the database uniqueness constraint to resolve contention.
   - Benchmark realistic synthetic distributions, including dense urban clusters and many stale/offline drivers.

   Acceptance: assignment contention tests pass; metrics report time-to-assign and candidate counts; benchmark records p50/p95 latency and workload/environment.

### P2 — Operability and production-shaped engineering

10. **Database resilience**
    - Add bounded connection pooling or a carefully configured PgBouncer deployment; set connection, statement and lock timeouts.
    - Use parameterized queries exclusively, a consistent lock ordering, and narrowly scoped transactions.
    - Add migration checksums or immutable migration discipline; never edit an already-applied migration in place.
    - Document backup/restore and test restoring a backup into a clean environment.
    - Add database indexes based on measured query plans and realistic data volume, not guesses.

    Acceptance: load test produces bounded connection counts; restore drill succeeds; migrations can be applied repeatedly without drift.

11. **Observability and SLOs**
    - Add request IDs and structured JSON logs, redacting secrets and personal data.
    - Instrument request count, p50/p95/p99 latency, status-class error rates, active connections, pool wait time, database query time, provider latency/error rate, outbox age, booking failures and assignment conflicts.
    - Use OpenTelemetry where practical; expose metrics only through a protected or private endpoint.
    - Define demo SLOs, for example API availability and p95 latency under a stated workload; label targets as project objectives, not achieved claims.

    Acceptance: a load test produces a dashboard/report with latency, traffic, errors and saturation; an injected database/provider failure is diagnosable from logs and metrics.

12. **Deploy and harden containers**
    - Verify the Compose path from clean checkout with no pre-existing volumes.
    - Use non-root runtime users, health/readiness distinction, minimal runtime images, pinned base-image digests where feasible, and automated image/dependency scanning.
    - Keep secrets out of Compose files, images, logs and frontend build-time variables. Treat `VITE_*` values as public.
    - Terminate TLS at a documented edge proxy; configure strict CORS, security headers and body/time limits.
    - Add a release workflow that builds immutable images, scans them, deploys to staging, runs smoke tests and only then promotes.

    Acceptance: staged URL is reachable; smoke test completes a test ride; rollback is documented and tested; no secret is embedded in web assets.

13. **Performance and reliability testing**
    - Add k6 or equivalent workload tests for quote, auth, booking, queue, and ride status endpoints.
    - Include slow database, provider outage, duplicate requests, client disconnects and process restarts.
    - Define a small, reproducible benchmark dataset and report percentiles, not just one mean duration.
    - Preserve the current DSA benchmark but clearly separate algorithm microbenchmarks from end-to-end API latency.

    Acceptance: publish reproducible load-test commands, workload shape, hardware/runner, raw result artifact and known limitations.

### P3 — Portfolio differentiation and product quality

14. **Make the demo explain itself**
    - Provide seeded demo accounts only in local/test mode; never ship a privileged demo credential to production.
    - Add a scripted walkthrough that creates a quote, books a ride, accepts as driver, advances the trip and shows the audit trail.
    - Add clear loading/empty/error/retry states, keyboard flow, screen-reader labels and reduced-motion support.
    - Add screenshots or a short demo video tied to the exact release commit.

15. **Add meaningful product analytics**
    - Measure quote conversion, booking success, time to driver acceptance, cancellation rates, completed-trip rate and provider failures.
    - Use synthetic or anonymized demo data; do not collect location history beyond the documented need.
    - Add a dashboard that distinguishes live telemetry from seeded example metrics.

16. **Strengthen engineering credibility**
    - Add a C4 context/container diagram, ERD, state-transition diagram, threat model, ADRs for dispatch and realtime transport, API error catalog and incident runbooks.
    - Add CODEOWNERS or review expectations, branch protection, dependency update automation and release tags.
    - Publish trade-offs: why C++/Beast, how idempotency works, how database constraints prevent double assignment, and which features are simulations.

## Suggested release gates

Do not call the project “complete” until the following gates have evidence:

- [ ] Every required CI workflow passed on the exact release SHA.
- [ ] Clean Compose startup and repeat startup both succeed.
- [ ] Passenger → quote → booking → driver accept → arrival → start → completion works end-to-end.
- [ ] Cancellation and duplicate/concurrent requests behave correctly.
- [ ] Cross-account and cross-role authorization tests pass for all endpoints.
- [ ] Concurrent assignment tests prove no driver receives two active rides.
- [ ] Outbox delivery survives worker restart and duplicate delivery.
- [ ] Provider failure, DB failure and API restart scenarios are tested.
- [ ] Backup/restore drill succeeds.
- [ ] Staging deployment smoke test passes; rollback instructions exist.
- [ ] Security, privacy, demo/payment disclaimers and provider terms are documented.
- [ ] README screenshots and demo steps match the deployed release.

## Recommended order of execution

1. Verify the latest SHA and reconcile CI/docs.
2. Add authorization matrix and PostgreSQL race tests.
3. Verify driver approval/admin UI, complete the authorization matrix, and run the full lifecycle E2E against real PostgreSQL.
4. Fault-test the existing outbox worker and authenticated SSE/reconnect/resync path; add race/restart tests.
5. Add bounded PostgreSQL connection pooling and provider hardening.
6. Add structured logs, metrics, SLO and load tests.
7. Validate clean Compose, backup/restore, staged deploy and rollback.
8. Only then polish the showcase, publish a release tag, and mark the PR ready for review.

The important distinction is between **implemented**, **tested**, **deployed**, and **operationally verified**. Track those as separate statuses; do not use one to imply the others.


## Open-source comparative review (2026-10-24)

This review informs product boundaries and acceptance criteria; it does **not** copy code or claim these projects are production-ready. Re-check each repository's current license, maintenance, dependencies, and status before any code reuse.

- [Namma Yatri](https://github.com/nammayatri/nammayatri) is an India-specific, driver-centric mobility platform with an AGPL-3.0 license. Useful product lessons: transparent driver economics, operational accountability, and Indian mobility context. Its domain and network/ONDC assumptions are not a drop-in generic stack. AGPL network-copyleft obligations require legal review before reusing or modifying code.
- [OpenRide by codelocal-cloud](https://github.com/codelocal-cloud/OpenRide) documents a clear Request → Quote → Agreement → Ride model, driver-owned terms, explainable ranking, and the principle that declining an unsuitable request should not itself be treated as misconduct. Its README identifies the project as pre-1.0 and explicitly lists incomplete durable execution and service modules. Use the invariants as design inspiration, not as evidence that its entire stack is production-ready. Its repository declares AGPL-3.0-or-later.
- [OpenRide by adam-nelson](https://github.com/adam-nelson/openride) describes a single-operator mobility MVP and calls out driver authorities, vehicle inspections, insurance, fatigue, incident logging, and provider integrations. Its repository declares Apache-2.0; verify the current LICENSE and dependencies before reuse.
- [Autofleet Locomotion](https://github.com/Autofleet/locomotion) is a MIT-licensed rider/passenger app, but its README says it is pre-integrated with Autofleet's backend ride engine. It is a reference for a separate passenger client, not proof that the complete backend can be self-hosted from that repository.
- [Taluxi Open Source](https://github.com/sitatec/Taluxi-Open-Source) demonstrates a separate passenger/driver app approach, but declares GPL-3.0 and describes a location/VoIP flow that is architecturally different from RideForge. Treat it as a UI/flow reference unless GPL obligations are intentionally accepted.

### What RideForge should adopt

1. **Model the offer and agreement as durable state.** A request, a driver's offer, a driver's decision, an accepted assignment, and the trip are different records/states. Do not infer an offer from a queue query.
2. **Keep the driver's Decline scoped to one offer.** It must not cancel the passenger request or silently penalize the driver. Record the decision for auditability and allow bounded redispatch to another eligible driver.
3. **Snapshot accepted terms.** Keep quoted fare, currency, distance, and the agreed terms stable for the trip; any adjustment needs an explicit, audited rule.
4. **Separate services by responsibility, not by duplicating data.** Passenger and driver clients can have distinct URLs while sharing one authoritative API and database.
5. **Treat safety/compliance as workflows.** A database flag saying a driver is approved is not evidence that licence, vehicle, insurance, permits, and local operating permissions have been verified by a human or trusted provider.
6. **Make capability status visible.** In-app queue, browser push, SMS, payment collection, refunds, emergency escalation, and public deployment each require separate implementation and evidence.

### License and originality rule

RideForge should retain its existing C++/React/PostgreSQL architecture unless a documented engineering decision justifies a change. Prefer original implementations of general patterns. Before copying any source, record the exact upstream commit, license, notices, modifications, dependency transitivity, and whether copyleft terms are compatible with the intended distribution/hosting model. Never copy competitor logos, branding, private assets, or user data.
