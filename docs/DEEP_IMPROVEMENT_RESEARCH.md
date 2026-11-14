# RideForge — deep improvement research and engineering plan

Last reviewed: 2026-11-13
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

## Remaining release gaps — reviewed 2026-11-05
The following are not claimed as complete merely because the relevant code or workflow exists:
- Deterministic PostgreSQL test code now covers simultaneous accepts, accept-vs-expiry, cancellation, parallel dispatch-worker execution, worker restart recovery and cross-account/role authorization (`backend/tests/concurrency_test.py`, `dispatch_worker_restart_test.py`, and `authz_matrix_test.py`). The latest main API smoke run failed during runtime-role password validation before these integration suites executed; rerun on the exact candidate SHA before marking this verification gate complete.
- The API now has a bounded process-local PostgreSQL connection pool (10 connections per API process, 2-second acquisition timeout, rollback/session reset before reuse). Remaining work: test saturation under representative concurrency and budget aggregate connections across API replicas plus workers; this is not a shared cross-replica pool.
- Dispatch matching based on real road ETA and fresh driver locations; current eligibility and sequential offer logic is not a fully optimized commercial matching engine.
- Production routing/geocoding provider and terms. Public Nominatim/OSRM endpoints are evaluation defaults, not a production SLA.
- Commercial payment processing, refunds, reconciliation, driver payouts, and real SMS/push delivery are not implemented as verified end-to-end provider flows. Demo receipts are not payment proof.
- Real-world driver identity/licence/vehicle/insurance verification, emergency response, customer support operations, and jurisdiction-specific transport/legal/privacy review.
- A real RideForge staging/production deployment, DNS/TLS, production database/secrets, monitoring/alerts, off-host backups and a successful restore drill. The connected hosting inventory currently has no RideForge Vercel project or Render service.
- Repository branch protection and enforced required checks; issue #17 tracks the required admin settings.

Implemented in the repository (but still requiring operational validation) are driver provisioning/approval/suspension APIs, admin ride search/metrics, support reports with audited resolution, durable 45-second driver offers with expiry/redispatch, the outbox worker, authenticated SSE with persisted-event replay, and Compose deployment templates.

**Exact-main CI evidence:** the latest main revision identified in the 2026-11-05 audit is `e234e434dad8cda26a90cb096722eaa5c1faeab0` (PR #28 merge). This audit did not retrieve a completed full release-readiness result for that exact SHA. Historical full-suite success on older commits remains useful regression evidence but is not current-main verification. Always verify fresh checks on the exact candidate SHA; a CI pass is not proof of a deployed service or external passenger/driver journey.

## Prioritized implementation plan

### P0 — Release confidence and security

1. **Make CI evidence deterministic**
   - Capture the exact current PR head SHA and confirm every required workflow ran on that SHA.
   - Fix README, roadmap, OpenAPI and PR claims so they agree.
   - Ensure Compose starts from an empty database, applies every ordered migration and a second startup performs no schema changes; the migration ledger and schema invariants must be checked against the full current migration set.
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
   - The current security helper uses versioned PBKDF2-HMAC-SHA-256 hashes with 600,000 iterations and bounded verification parameters. Keep this work factor covered by tests and benchmark login latency under representative load; assess Argon2id only as a separately reviewed migration.
   - Enforce password length/size limits before expensive hashing, generic login errors, account-aware throttling and bounded memory/CPU use.
   - Validate JWT algorithm/signature, expiry, issuer/audience if present, token structure and secret configuration. Fail startup if a weak/default production secret is used.
   - Add revocation/session rotation strategy before treating bearer tokens as production sessions.
   - Use TLS at the deployment edge; never log bearer tokens, passwords, precise location or secrets.

   Acceptance: security tests and a written threat model pass review; production configuration fails closed; performance cost of password verification is measured.

5. **Protect expensive third-party routing calls**
   - Provider timeouts and numeric/coordinate validation are implemented. The unbounded response-body callback is being hardened in the current release-hardening candidate with a 1 MiB cap and CTest coverage; treat it as incomplete until the exact PR head passes backend and full release-readiness CI. Content-type validation and unreasonable distance/duration caps still need review.
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


## Review addendum — 2026-11-13

PR #44 was merged as `d7a90e24977119618f079ae7f8c1623aae97899d` after all 13 jobs in the exact candidate's [Full release readiness run 43377409848](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/43377409848) passed. The candidate added adversarial authorization, PostgreSQL concurrency, transactional outbox/SSE and abuse-control suites, plus provider circuit-breaker/pacing/validation controls. The merged changes fix the invalid quote-ID response, an SSE replay gap, and cancellation leaving an active offer.

The post-merge main SHA was `d7a90e24977119618f079ae7f8c1623aae97899d`; its exact-SHA workflows were still running at the time of this update. PR-candidate success is not post-merge verification.

The most important remaining engineering gates are successful exact-head execution of the existing deterministic accept-vs-expiry, duplicate-worker, restart and authorization suites; dispatch/outbox multi-process load testing; aggregate connection budgeting; distributed rate limits; manual mobile/accessibility acceptance; a real staging deployment with production-grade routing; monitoring and restore rehearsal; and privacy/legal/driver operations approval. No commercial ride authorization or live deployment is claimed.


## Routing/geocoding policy correction — 2026-11-13

The passenger browser now requests road routing only when the user explicitly asks for a server fare quote. Editing pickup/drop-off fields does not trigger geocoding. The backend appends the configured Noida service-area context, validates bounded GeoJSON coordinates and returns the route geometry with the quote. This avoids using the public Nominatim service as a client-side autocomplete provider. The API applies shared one-request-per-second pacing to the public Nominatim and OSRM demo hosts, in line with their published policies; this limiter is per process, not distributed across replicas. Successful geocodes are cached in bounded process memory for 10 minutes and road geometries for 2 minutes to reduce repeat upstream traffic. Nominatim also prohibits sending personal or confidential data, so the public demo must use public landmarks/test locations only; production pickup/drop-off addresses require a contracted provider with suitable privacy terms or a self-hosted geocoder. The public Nominatim and OSRM endpoints remain evaluation defaults only; production requires a contracted or self-hosted geocoder/router with capacity, attribution, monitoring and distributed rate limiting. See `docs/UP_AGGREGATOR_COMPLIANCE.md` for the policy and India/UP launch gates. For a self-hosted open-source routing candidate, evaluate [Valhalla](https://github.com/valhalla/valhalla): its MIT-licensed C++ engine supports routes, time/distance matrices, isochrones and map matching. It is not an OSRM drop-in—the provider adapter and request/response mapping must be implemented and tested—and the public Valhalla demo is also fair-use, not production capacity.


## Live deployment and standards refresh — 2026-11-14

This section supersedes any earlier statement in this document that no RideForge Render service was found. A later read-only inspection identified the existing Render resources and the current startup failure.

### Verified hosting state

- Existing Render API web service: `rideforge-api-final` (service ID `srv-dbloqnom7kps73br5ojg`), health check `/api/v1/ready`.
- Existing static site: `https://rideforge-web.onrender.com`.
- The API's latest inspected container build succeeded, but the process exited during startup with `DATABASE_URL_TEMPLATE must be a PostgreSQL URI containing __RIDEFORGE_PASSWORD__`. The immediately preceding environment-updated deploy failed earlier with `DATABASE_URL_TEMPLATE is required`; the latest failure therefore indicates that the variable was subsequently supplied but its value did not satisfy the required placeholder format.
- The Blueprint declares `DATABASE_URL_TEMPLATE` and `MIGRATION_DATABASE_URL` as manual protected values. The latest log does not prove the template's secret value, and it does not prove whether `MIGRATION_DATABASE_URL` is correct: startup validates the runtime template before validating the migration-owner URI. Do not infer or publish either secret. The latest observed failed deployment is `dep-dbrm1qjl550s73cs5r10` (2026-11-13 19:11:38–19:11:54 UTC).
- Render is configured with `autoDeployTrigger=checksPass`. A merge to `main` after checks pass can initiate a deployment. Do not merge the open code/documentation PRs until exact-head CI passes and the operator confirms that the Render deployment is intended.
- The connected GitHub branch metadata reports `main` unprotected. The current GitHub integration can inspect this state but cannot configure repository rulesets/branch protection.

**Operator sequence:** correct the protected `DATABASE_URL_TEMPLATE` directly in Render so it is a PostgreSQL URI with username `rideforge_app.PROJECT_REF` and the literal password component `__RIDEFORGE_PASSWORD__`; copy the exact shared Session-pooler hostname/port from Supabase Connect. Then verify the protected `MIGRATION_DATABASE_URL` uses the matching pooler host/project and owner username `postgres.PROJECT_REF`, with the owner password URI-encoded and TLS enabled. Do not paste credentials into chat or source control. After a controlled deployment, verify both `/api/v1/health` and `/api/v1/ready`, the deployed Git SHA, migration ledger and worker startup logs. A green image build alone is insufficient.

### API security review priorities

Use the OWASP API Security Top 10 (2023) as the route-by-route threat model, not just a generic checklist. The most relevant areas for RideForge are object-level authorization for ride/offer/support IDs, property-level authorization and mass-assignment resistance, resource-consumption controls for login/quote/booking/cancellation/support, sensitive business-flow abuse (repeated booking, dispatch and cancellation), SSRF boundaries around routing/geocoding providers, and third-party response validation. Existing authorization and abuse-control suites provide a foundation; add coverage whenever a new route or field is introduced. Source: https://owasp.org/API-Security/editions/2023/en/0x11-t10/

### Routing and dispatch research

Google Maps Routes API documentation explicitly includes a two-wheeled motorized travel mode, distinct from human-powered bicycle routing. Its Route Matrix can calculate distance and duration for multiple origin/destination combinations (up to 625 non-transit route elements), which is a better architectural fit for comparing eligible nearby drivers than repeatedly routing one candidate at a time. This is a candidate provider capability, not a recommendation to switch without reviewing billing, data-processing terms, geographic coverage, motorcycle routing behavior in Noida, quotas and attribution requirements. A provider adapter should normalize route distance, duration, status, provider attribution and freshness; dispatch should retain a bounded candidate set and fall back safely when a matrix element is unavailable. Sources:
- https://developers.google.com/maps/documentation/routes
- https://developers.google.com/maps/documentation/routes/compute_route_matrix

The current OSRM URL in the Render Blueprint uses `/driving`; it is an evaluation default and should not be represented as motorcycle-aware routing. For commercial service, select a contracted or self-hosted routing engine with a documented motorcycle profile and validate representative Noida routes against observed travel times. Never treat a driving route distance as a guaranteed motorcycle ETA.

### Payment integration design gate

No payment provider should be wired into the live service until the business entity, merchant account, settlement model, fees, refund policy and operating jurisdiction are approved. When a provider is selected, implement a durable webhook inbox before any booking/ride state is driven by payment notifications:

1. Verify the provider signature against the exact raw request bytes before parsing or mutating state.
2. Persist the provider event ID, provider account/environment, payload hash, received time and verification result under a unique constraint.
3. Acknowledge only after durable receipt; process asynchronously with bounded retries and a dead-letter/reconciliation path.
4. Treat delivery as at-least-once and potentially out-of-order. Deduplicate provider event IDs and enforce a monotonic, provider-aware payment state machine so an old authorization cannot overwrite a capture or refund.
5. Keep separate idempotency identities for booking, payment creation/capture, refund and driver payout. Use only the provider's documented endpoint-specific contracts; do not assume one universal idempotency header.
6. Reconcile provider transactions against the internal ledger and bank/settlement reports. A successful webhook is not itself a settlement proof.

Razorpay's documentation describes duplicate webhook delivery, unique `x-razorpay-event-id` values and out-of-order events; its security guidance requires HMAC validation. Its endpoint-specific payout/refund/transfer idempotency contracts must not be generalized to every payment endpoint. Sources:
- https://razorpay.com/security/checklist/
- https://hdfcbank-collectnow-docs.razorpay.com/webhooks/validate-test/
- https://hdfcbank-collectnow-docs.razorpay.com/webhooks/best-practices/

### India privacy commencement calendar

The DPDP Act and Rules were notified with phased commencement, so compliance must be assessed against the actual processing date rather than a blanket statement that every provision is already in force. The 13 November 2025 Gazette notification schedules specified provisions immediately, section 6(9) and section 27(1)(d) after one year, and sections 3–5, sections 6(1)–(8) and (10), sections 7–17 and other listed provisions after eighteen months. The 14 November 2025 Rules notification similarly phases Rule 4 after one year and Rules 3, 5–16, 22 and 23 after eighteen months. On this research date (14 November 2026), the one-year milestones have arrived; the eighteen-month milestones have not yet arrived. Counsel must check the Gazette text, corrigenda, commencement notices and the actual processing/launch date before deciding which duties apply. Irrespective of phased commencement, RideForge should implement privacy-by-design now: data minimisation, purpose limitation, clear notices, consent/withdrawal flows where applicable, retention/deletion, access controls, incident handling and processor/vendor agreements. Sources:
- https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf
- https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf?v=20261027115856

### Supabase production database verification — 2026-11-14

A live check against the existing `rideforge-production` project confirms it is ACTIVE_HEALTHY on PostgreSQL 17.11 in `ap-south-1`. The authoritative RideForge application ledger, `public.schema_migrations`, now records migrations 001–015. The Supabase platform migration history is a separate audit ledger: it retains timestamped migration records and five explicit `apply_migration` operations performed during this work. Do not treat that platform history as the backend runner's source-of-truth ledger or manually delete its audit records.

The sequence least-privilege change is applied and verified. `rideforge_app` retains USAGE and SELECT on all five public sequences but has no UPDATE privilege; default sequence UPDATE is also revoked. The function-execution hardening is applied and verified: the existing public trigger function and future public functions created by the migration owner are not executable by PUBLIC, `anon`, `authenticated` or `service_role`. The existing trigger remains attached to `public.ride_events`; its SECURITY DEFINER function retains a fixed `pg_catalog, public` search path. The default ACL restriction applies to functions created by the RideForge migration owner; Supabase-managed `supabase_admin` defaults remain unchanged and still grant broad public table/sequence privileges to anon/authenticated/service_role for objects it creates. All 12 current app tables are owned by postgres, whose defaults are restricted. Supabase's `service_role` keeps standard broad table privileges and BYPASSRLS, so its key must remain server-only. Migration 015 also created `rideforge_backup`, a NOLOGIN/BYPASSRLS identity with SELECT-only access to current/future public tables and USAGE/SELECT on sequences. Its password is unset, it has no write privileges, and only the project administrator can assume it; it must remain disabled until a backup workflow is configured.

All 12 public application tables have RLS enabled, and `anon`/`authenticated` have zero application-table grants. No permissive policies were added: the project deliberately uses a server-only database model. The `rideforge_app` role is a non-superuser LOGIN/BYPASSRLS identity with no CREATE DATABASE/ROLE, DELETE, TRUNCATE, REFERENCES or TRIGGER rights; it has only the DML needed by the trusted backend, with UPDATE removed from append-only audit/event/decline tables and SELECT-only access to the application migration ledger. BYPASSRLS is intentional for this model, so application-layer ownership and role checks remain security-critical and must continue to be tested.

Exact counts confirm the 11 business tables are empty, `auth.users` has zero users, Storage has zero buckets, and no public application table is in a Realtime publication. The live SQL inspection connection negotiated TLS 1.3. The 12 `rls_enabled_no_policy` INFO findings are expected under the server-only access model; do not add public policies just to silence them. The health advisor has no findings. The performance advisor reports 21 unused-index notices; with no representative production workload, do not remove indexes solely on that basis.

Direct `pg_authid` inspection on 2026-11-14 confirms the `rideforge_app` role currently has no password verifier. An actual login using the protected application connection string from the running API has not been proven. The Render Blueprint declares `RIDEFORGE_RUNTIME_ROLE_PASSWORD` as a generated secret; the startup script maps it to `RIDEFORGE_APP_PASSWORD`, and the migration runner sets the database role password. Verify the generated secret is present and prove a real login; the owner migration connection remains a separate configuration gate. No real passenger, driver, ride, support or payment records were present during this check.

The organization is on the Free plan. Automatic daily backups and PITR are not included. PR #76 adds a daily encrypted GitHub Actions logical-export workflow (30-day artifact retention) that uses the disabled read-only backup identity, but it is not active until the operator configures `RIDEFORGE_BACKUP_DATABASE_URL` and `RIDEFORGE_BACKUP_PASSPHRASE` repository secrets and observes a successful run. There is still no verified encrypted backup artifact, independent off-site retention or successful production restore drill. Do not accept real personal data until those steps are complete. See the Supabase backup documentation below.

### Backup and restore decision

Supabase's current documentation says Free projects do not receive automatic daily backups; it recommends regular exports with the Supabase CLI `db dump` command and off-site storage. Therefore the existing local/CI backup-restore tests do not satisfy the operational recovery gate. Before real personal data is accepted, schedule encrypted off-site exports, verify integrity and access controls, define retention and deletion, and perform a timed restore to an isolated project. Record recovery point and recovery time actually achieved; do not invent an RPO/RTO. Source: https://supabase.com/docs/guides/platform/backups

### Current code-review queue

- PR #72–74 are merged into `main`.
- PR #75 is closed as superseded by PR #76.
- PR #76: migrations 014–015, 22-column readiness, restore-role re-provisioning and encrypted backup automation; exact-head CI is queued, not passed.
- Main SHA `5d802f212ba11a2980c066e7734595bd8b4e2ba8` is the current assessed base. No post-merge full-suite pass is established for it.

**Release conclusion:** RideForge remains a full-stack academic/evaluation MVP, not a commercially authorised taxi service. A real staging journey, live API readiness, exact-head CI, backup/restore proof, driver/vehicle verification, emergency/support operations and written transport/privacy/legal approval remain separate gates.


## Post-migration release and regulatory review — 2026-11-14

This addendum supersedes earlier snapshots in this document where they describe the C++/Render API as the intended production backend or list the Render API as still required. The current intended application backend is Supabase; Render is retained only for the static web frontend.

### Verified implementation state

- PR #79 is merged into `main` at merge commit `670e946f2b290ec7081d712a073edad6a697f1cb`.
- Supabase project `ghcufcegfvvjhsnqnrzr` is `ACTIVE_HEALTHY`; the `rideforge-api` Edge Function is active at version 9.
- Security and health advisors returned zero findings in the latest check. The backend migration work records 14 public application tables with RLS enabled.
- Transactional SQL evidence covers idempotent booking, dispatch/offer expiry and retries, acceptance revalidation, ride lifecycle, cancellation, passenger isolation, auth account creation trigger, rate limits and event persistence. These are database-level tests, not a substitute for deployed browser journeys.
- Production has no real application accounts or rides. The first verified account/admin bootstrap and browser end-to-end journey have not been completed.
- PR #82 forward-ports the real-app homepage change after the Supabase migration. Its exact-head Actions checks are queued; they are not passes. Do not merge until those checks complete successfully.
- Three old Render API services remain in the account. They are not part of the intended architecture and must be deleted manually after the static frontend is confirmed healthy. Keep `rideforge-web`.

### Supabase production controls to close

Use the official [Supabase Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod) and [Production Security Checklist](https://supabase.com/docs/guides/security/production-checklist) as an evidence register, not just the SQL advisor.

1. **Auth:** configure the Site URL and redirect allow-list for the actual frontend and local development; verify email confirmation; use custom SMTP before public signup; set confirmation/recovery OTP expiry to one hour or less; configure CAPTCHA/rate limits and an account recovery path. Create and verify a real first account before owner-only admin promotion.
2. **Database transport/network:** verify Postgres SSL enforcement and assess database network restrictions. Do not blindly allow-list a changing serverless egress IP. Supabase notes that network restrictions apply to Postgres/pooler but not HTTPS APIs, and Edge Functions lose direct database connectivity when restrictions are enabled; validate the actual supabase-js/data-API connection path before enabling restrictions.
3. **Organization access:** enable MFA for the Supabase and GitHub owner accounts, review team membership and privileges, and maintain at least two trusted organization owners where feasible.
4. **Realtime:** verify the actual channel authorization model for passenger/driver subscriptions. Supabase warns that Postgres Changes DELETE events are not filtered by RLS; do not put sensitive information in unscoped broadcast payloads.
5. **Backups:** the project is on the Free plan, which does not provide downloadable automatic daily backups or PITR. The repository's encrypted export workflow is not operational until its secrets are configured and a successful run is observed. Store encrypted backups outside the GitHub artifact retention boundary, test key recovery, and perform a timed restore into an isolated PostgreSQL 17 project. Record achieved RPO/RTO only after measurement.
6. **Performance/availability:** run representative staging load tests (k6 or equivalent) for quote, booking, dispatch, concurrent driver location updates, Realtime subscriptions and reconnects. Capture p50/p95/p99, database pool saturation, lock waits, errors and queue/offer expiry. Review query plans with realistic data; the empty production DB cannot establish index usefulness or capacity.
7. **Operations:** define alert ownership, incident severity, on-call/contact path, release rollback, secret rotation, data retention/deletion, user support and a documented restore drill. A zero-lint advisor result is not an operational resilience certificate.

### India bike-taxi regulatory research (Noida / Uttar Pradesh)

**Central guidance:** the Ministry of Road Transport and Highways' [Motor Vehicle Aggregator Guidelines, 2025](https://morth.nic.in/sites/default/files/circulars_document/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf) says in clause 23 that a State Government *may* permit aggregation of non-transport motorcycles for passenger journeys under section 67(3) of the Motor Vehicles Act. This is not a blanket nationwide permission. The same guidelines set substantial driver-onboarding requirements (identity, relevant licence, experience, bank account, conviction checks, medical/eye examination, psychological assessment, police antecedent verification and a written driver contract) and require passenger insurance of at least ₹5 lakh under clause 9.5.

**Uttar Pradesh — final rules, not merely a draft:** The 13 March 2026 UP Transport Department document was a draft and is not the current operative instrument. Subsequent legal reporting and the official UP My Fleet portal identify the final Uttar Pradesh Motor Vehicle (Thirty-third Amendment) (Aggregator and Delivery Service Provider) Rules, 2026, notified on 22 May 2026 and effective 15 days after Gazette publication. The State Transport Authority is the licensing authority; a new aggregator must obtain its licence before commencing operations. The final framework describes a five-year licence, ₹25,000 application fee, ₹5,00,000 licence fee and fleet-size-based bank-guarantee/security deposit (reported tiers ₹10–50 lakh). The portal exposes the licensing/compliance process and a prescribed affidavit referring to the final Thirty-third Amendment rules. Confirm the exact Gazette instrument, any later amendments, the current STA interpretation and the applicable fee/deposit for RideForge with UP transport counsel before relying on any summary.

The final rules materially exceed what the current app implements. The legal summary identifies applicant eligibility as a company, LLP or qualifying co-operative with a registered office in Uttar Pradesh; driver identity/Aadhaar verification, valid driving licence and at least two years' experience, police antecedent checks, medical/eye fitness and psychological assessment; 40-hour induction training; passenger insurance of at least ₹5 lakh; driver health cover of at least ₹5 lakh and accident/term cover of at least ₹10 lakh; non-exclusivity for drivers; vehicle registration/permit, fitness, insurance with passenger cover, PUC, AIS-140 tracking/panic button, first-aid/fire equipment and vehicle-age controls; a full-time grievance-redressal/compliance officer; 24×7 control room and call centre; CERT-In-empanelled application security certification; fare and driver-share transparency; two-way ratings; live-location sharing and applicable gender preference; and statutory trip/fare data retention. Treat this legal summary as a checklist to validate against the final Gazette text, not as a substitute for counsel's opinion.

**Noida / NCR vehicle restriction — a launch-critical point:** Noida is in the NCR. The UP rules expressly incorporate CAQM Direction No. 94 for NCR vehicles. CAQM's 23 December 2025 amendment says conventional petrol/diesel ICE vehicles must not be further inducted into the specified existing fleets from 1 January 2026, while temporarily allowing BS-VI two-wheelers to be inducted into existing fleets only through 31 December 2026. That temporary exception is close to expiry as of this research date (14 November 2026). Do not design a new Noida fleet around petrol motorcycles or assume the temporary exception applies to a newly formed aggregator. Treat an EV-only two-wheeler fleet as the conservative product assumption for any post-2026 Noida launch, subject to written STA/CAQM/legal confirmation. This is a legal gate, not a UI toggle.

**Commercial implication:** RideForge's internal driver approval flag is not legal verification and the current fare is not an approved UP tariff. A real operator must obtain the aggregator licence before launch, satisfy the full driver/vehicle/training/insurance obligations, integrate with the State portal and required control-room arrangements, disclose regulated fare and driver-share calculations, and obtain app security certification. The current repository is an academic prototype and must not onboard real passenger trips.

**Product implication:** RideForge's current driver "approval" flag is an internal workflow control, not legal verification. Before any real rides, add evidence-backed records and expiry/reverification for identity, licence class/validity, police verification, medical/eye fitness, psychological assessment, vehicle registration/permit/fitness/insurance, driver contract and induction training. Block dispatch unless every required record is valid. The platform also needs the mandated passenger and driver insurance, grievance officer, emergency response, incident reporting and audit processes. Do not collect Aadhaar or sensitive documents until a counsel-approved lawful basis, consent/notice, retention and access design exists.

### DPDP Act / Rules timing

The commencement instruments are phased. Under G.S.R. 843(E), the one-year commencement date of 13 November 2026 applies to Act section 6(9) and section 27(1)(d); the eighteen-month commencement date for most core Data Fiduciary duties (sections 3–5, 6(1)–(8), 6(10), 7–17 and associated provisions) is 13 May 2027. Under G.S.R. 846(E), Rules 1, 2 and 17–21 commenced on publication; Rule 4 commences after one year; Rules 3, 5–16, 22 and 23 commence after eighteen months. Rule 4 concerns Consent Manager registration/obligations; do not describe the 13 November 2026 milestone as general commencement of RideForge's Data Fiduciary obligations. The DPDP Act's core platform obligations are scheduled for 13 May 2027 under the published schedule, subject to subsequent amendments/corrigenda. The UP aggregator rules separately require compliance with applicable data-protection law, and existing IT/security/consumer obligations remain relevant. Build now: clear standalone notices, purpose limitation, data minimisation, consent/withdrawal where applicable, retention/deletion schedules, processor contracts, access/correction/erasure request handling, children's-data safeguards if relevant, breach response and a data inventory. Re-check official Gazette and MeitY updates before launch; this is engineering planning, not legal advice.

### Completion definition — two different products

**Portfolio / academic MVP completion** is achievable without pretending the product is a commercial transport operator. Require:
- PR #82 merged after exact-head CI passes; all required checks green on the resulting main SHA.
- Render static site deploys that exact SHA and the homepage is the real API-backed app, not a local simulation.
- Supabase Auth redirects are configured; first verified passenger/admin account exists; signup, sign-in, passenger booking/cancellation/history, driver offer/accept/start/complete, admin controls and support journeys pass in a real browser against the deployed stack.
- Two independent browser sessions prove driver/passenger isolation and Realtime updates; reconnect/reload recovers from persisted ride state.
- Backup export, off-site copy, key recovery and isolated restore are demonstrated; secrets and rollback steps are documented.
- Old Render API services are removed and the remaining hosting diagram matches reality.
- Release evidence records exact commit SHA, deployment IDs, test results, screenshots, known limitations and measured performance. Keep the fare/receipt clearly labelled as a demo tariff/receipt and payments disabled.

**Commercial ride-hailing readiness** is a separate programme, not a final coding sprint. It additionally requires the applicable UP aggregator licence and motorcycle authorization, legal review, verified drivers/vehicles, mandated insurance and training, payment-provider contract and signed webhook/refund/reconciliation flows, tax/accounting treatment, emergency and grievance operations, privacy compliance, customer support staffing, security assessment, load/capacity/SLO evidence and an operational recovery plan. Until those are independently evidenced, describe RideForge as an academic/portfolio MVP and do not accept real passengers or payments.

### Research sources

- Supabase, [Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod), updated 2 Nov 2026.
- Supabase, [Production Security Checklist](https://supabase.com/docs/guides/security/production-checklist), updated 2 Nov 2026.
- Supabase, [Database Backups](https://supabase.com/docs/guides/platform/backups), updated 5 Nov 2026.
- Supabase, [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization).
- CAQM, [23 Dec 2025 amendment to Direction No. 94](https://caqm.nic.in/FileUploadDomain/WebsiteDocument/Advisories%20and%20Direction/Directions/Amendment%2023122025bea783db-8767-4617-8be6-bfa4ad62c6e4.pdf), including the BS-VI two-wheeler transition deadline of 31 Dec 2026.
- MoRTH, [Motor Vehicle Aggregator Guidelines, 2025](https://morth.nic.in/sites/default/files/circulars_document/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf), especially clauses 9, 11 and 23.
- Government of Uttar Pradesh, [UP My Fleet licensing portal](https://www.upmyfleet.com/) and its [Thirty-third Amendment compliance affidavit](https://upmyfleet.com/storage/affidavit/Affidavit.pdf); the 13 Mar 2026 UP document is historical draft only. See the [legal summary of the final 22 May 2026 rules](https://www.admin.argus-p.com/updates/updates/overview-of-the-uttar-pradesh-motor-vehicle-thirty-third-amendment-aggregator-and-delivery-services-provider-rules-2026/).
- Government of India, e-Gazette, [G.S.R. 843(E), DPDP Act commencement](https://egazette.gov.in/WriteReadData/2025/267647.pdf).
- Government of India, e-Gazette, [G.S.R. 846(E), DPDP Rules, 2025](https://egazette.gov.in/WriteReadData/2025/267650.pdf).


### CI concurrency defect discovered during final audit — 2026-11-14

The reusable workflows `codeql.yml`, `container-scan.yml`, `container.yml`, `db-migration.yml`, `dependency-review.yml` and `web.yml` had workflow-level concurrency groups based on `github.workflow`. When invoked as reusable jobs by `release-readiness.yml`, those jobs inherit the caller workflow context and can collide on the same group, cancelling sibling jobs. This was consistent with the observed exact-head cancellations. PR #82 removes concurrency groups from those reusable workflow files; the top-level `release-readiness.yml` retains one PR-scoped concurrency group to cancel superseded aggregate runs. Re-run the aggregate workflow on the exact final PR head and confirm every child job completes before merging. The previous cancelled runs are not evidence of test success.
