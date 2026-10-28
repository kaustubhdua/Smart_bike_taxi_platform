# RideForge Release Readiness Evidence

**Assessment date:** 2026-10-28  
**Repository:** `kaustubhdua/Smart_bike_taxi_platform`  
**Dispatch-fix revision:** `28bbad3e7469ad753eebb52fe960917efb78664c` (PR #15 merge)  
**Reviewed revision:** `82f0f7a53ca0dc3e382152f75a6c70923166d596` (main after PR #22; post-merge CI evidence is being collected)
**Decision:** **Not production-ready for public/commercial rides yet.** The codebase has a substantial full-stack MVP, but external deployment, operational, legal, safety, and real-device evidence remain release gates.

This document deliberately separates implementation evidence from claims that require a live environment. A merged PR, green CI run, screenshot, local Compose stack, or demo booking is not proof of a commercially operational transport service.

## Evidence reviewed

- The current main revision at the start of this assessment was `415b7d5cefeca0684053a16d4a2ece8b4bb1a606`. Main has since advanced through merged PRs #20 (route/geocoding caching and provider-response validation), #21 (bounded per-process PostgreSQL connection pool), and #22 (production driver/admin entry routing); see the updated evidence below. The earlier `e67fe208722c44aad1252cead2985e1f39f6ffad` revision was the pre-PR #15 baseline.
- PR #13 adds migration `006_durable_driver_offers.sql`, the C++ dispatch worker, 45-second offers, expiration/redispatch, offer-aware queue and acceptance/decline behavior, Compose/Docker wiring, and API/schema/browser-test updates.
- PR #9 is merged. Its recorded aggregate release-readiness run passed 13 jobs on the earlier tested revision `d0cab5d11bab857190f7232ffecc501ae0d5bca3`. That result must not be represented as a fresh full-suite result for the current main SHA.
- The repository contains separate passenger and driver web experiences, a C++ API, PostgreSQL migrations, an outbox worker, authenticated SSE, Compose deployment templates, and operational/security documentation.
- PR #15's bounded dispatch-attempt fix was merged to main as `28bbad3e7469ad753eebb52fe960917efb78664c` after all 13 jobs in the full release-readiness workflow passed on exact tested head `ec8780b20beef1470047f23f73f9705ac148f5a6`. See [full release-readiness run](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40571466789) and [API smoke run](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40571466885). PR #16's documentation corrections were merged as `415b7d5cefeca0684053a16d4a2ece8b4bb1a606`. Fresh CI runs for the PR #16 head `ffe72e56ed877d7154c16a5e386a9033fb8ae018` also passed all eight workflows, including the 13-job release-readiness suite. A prior main full suite at the `415b7d5cefeca0684053a16d4a2ece8b4bb1a606` revision is [run 40628698136](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40628698136) and completed all 13 reported jobs successfully: GCC/Clang tests, ASan/UBSan, API smoke at 5 km and 20 km, PostgreSQL migration/recovery, web typecheck/build/browser E2E, container/Compose validation, container vulnerability scan, npm dependency audit, and C++/JavaScript CodeQL. This is CI evidence for the current-main revision only; it is not proof of a live deployment, external two-device ride journey, operational readiness, or legal authorization. Issue #2 and issue #3 remain open; issue #10 still tracks concurrency, recovery and deployed-journey verification. Issue #17 records that `main` is not protected and required status checks are not enforced.

## Capability status

| Area | Status | Evidence / limitation |
|---|---|---|
| Passenger and driver web experiences | Implemented in repository | Build and browser tests exist; a public deployment was not verified in this assessment. |
| PostgreSQL-backed accounts, quotes, rides and history | Implemented in repository | Migrations and API smoke tests exist; no production database is configured. |
| Timed driver offers and sequential redispatch | Implemented in main | PR #13 adds durable offers and a worker. This does not establish behavior under production load. |
| Single-driver assignment protections | Implemented in code; needs stronger operational proof | Transactional guards exist; retain explicit concurrent accept/cancel/expiry tests and repeat them against PostgreSQL. |
| Live ride updates | Implemented in repository | Authenticated SSE and persisted-event replay exist; reconnect storms, real mobile background behavior and production load are not proven. |
| Maps and road routing | Integrated with public evaluation endpoints by default | Public Nominatim/OSRM endpoints are not a production SLA. Select a provider or operate suitable infrastructure and verify terms, capacity, and attribution. |
| Browser push / SMS | Not verified as implemented | Do not promise background driver alerts or say an SMS was sent unless a real provider integration is configured and tested. |
| Payments, refunds, driver payouts | Not implemented as a commercial flow | Demo receipts and stored final fares are not payment evidence. |
| Driver identity, licence, vehicle, insurance and permits | Operational process required | An admin approval flag is not real-world document verification. |
| Safety/emergency response | Operational process required | A support report form is not an emergency-response service. |
| Public URLs, DNS, TLS and hosting | Not verified | The repository contains templates, not verified live passenger/driver URLs. |
| Monitoring, off-host backups and recovery objectives | Not verified in a live environment | Documented procedures must be configured and rehearsed on the chosen host. |
| India/state-specific legal and privacy compliance | External review required | Obtain qualified advice and transport-authority confirmation for the exact operating state and two-wheeler model before real rides. |

## Required gates before a controlled pilot

### Gate A — exact-revision engineering verification
- [x] Run the full release-readiness workflow on the exact PR #15 candidate SHA, including the bounded-retry regression, before merging that fix. All 13 jobs passed on `ec8780b20beef1470047f23f73f9705ac148f5a6`; the merge commit is `28bbad3e7469ad753eebb52fe960917efb78664c`.
- [x] Verify C++ warnings-as-errors, sanitizers, backend smoke tests at 5 km and 20 km dispatch radii, PostgreSQL migration/recovery, web typecheck/build, desktop/mobile E2E, accessibility, dependency audit, CodeQL, container build and vulnerability scanning on that exact candidate. This is CI evidence, not proof of a live deployment.
- [ ] Add/retain deterministic PostgreSQL tests for simultaneous accept, accept-vs-expiry, cancellation races, worker restart, duplicate worker execution, no eligible drivers, and cross-account/role authorization. The bounded retry exhaustion regression is covered by PR #15 and passed on its exact candidate SHA.
- [ ] Stress-test the dispatch worker and SSE/outbox under representative concurrency. Record test conditions and measured results; do not infer capacity from a single local run.
- [ ] Confirm readiness fails closed when any required schema/migration or dependency is unavailable.

### Gate B — actual staging deployment
- [ ] Choose a host and configure the production Compose overlay, persistent database storage, firewall, TLS, and DNS.
- [ ] Configure independent strong secrets outside source control; verify secret rotation and restore procedures.
- [ ] Deploy passenger and driver entry points to real HTTPS origins and allow only those exact origins in CORS.
- [ ] Replace public evaluation routing endpoints with a provider/self-hosted service appropriate to the intended traffic and terms.
- [ ] Run the full workflow from two independent devices over the public internet: passenger request, eligible driver offer, decline/expiry redispatch, accept, arrival, trip start, completion, history, cancellation, and reconnect recovery.
- [ ] Record actual public URLs, deployed SHA, timestamps, CI run links, redacted logs and real-device results. Do not invent screenshots, metrics, delivery receipts, or successful test outcomes.

### Gate C — operations and privacy
- [ ] Configure monitoring and alerting for API errors/latency, database saturation, dispatch offer outcomes, worker health, outbox backlog/dead letters, and backup failures.
- [ ] Create encrypted off-host backups and successfully restore them in a separate environment; record measured recovery time and recovery point.
- [ ] Define location consent, access controls, retention/deletion, account suspension/revocation, support ownership, incident escalation, and emergency disclosures.
- [ ] Verify drivers and vehicles using a documented real-world process before enabling real rides.
- [ ] Obtain state-specific legal/transport-authority review and qualified privacy advice before inviting customers or collecting real trip data.

### Gate D — commercial features, if offered
- [ ] If collecting money, integrate a real payment provider with server-verified webhooks, idempotency, refunds, reconciliation, and a ledger for fees and driver payables.
- [ ] If offering background alerts, implement and test browser push or an external notification provider on supported real devices; distinguish accepted, sent, delivered, and opened states.
- [ ] Publish only services that are actually available. Clearly label estimates and demo-only functions.

## Safe release wording

Until Gates A–C have evidence, describe RideForge as a **full-stack bike-taxi MVP with a PostgreSQL-backed booking/dispatch implementation and a self-hosting template**. Do not describe it as a live taxi service, claim payments are processed, claim driver documents are verified, promise emergency response, or publish unmeasured availability/performance metrics.

## Evidence log template

Fill this in only with observed values:

- Candidate SHA:
- Full release-readiness workflow URL and conclusion:
- Staging passenger URL:
- Staging driver URL:
- Deployment timestamp:
- PostgreSQL migration/recovery result:
- Two-device end-to-end result:
- Concurrent accept/cancel/expiry test result:
- Real Android/iOS device matrix:
- Backup restore result and measured recovery time:
- Open P0/P1 issues:
- Reviewer and date:

No field above is pre-filled with a fabricated result.

## External policy research references

These are primary or official-source starting points for the compliance review, not a legal opinion and not proof that RideForge meets the requirements:

- [Ministry of Road Transport and Highways — Motor Vehicle Aggregator Guidelines 2025 (PDF)](https://parivahan.gov.in/sites/default/files/NOTIFICATION%26ADVISORY/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf). The guidelines describe a framework for state licensing and operational requirements; confirm their implementation and any additional rules with the relevant state authority.
- [Motor Vehicles Act, 1988, Section 93 — aggregator licensing](https://indiacode.ecourtsindia.com/mv-act/section/93/). The statutory text states that an aggregator must obtain a licence from the competent authority subject to state-prescribed conditions.
- [Rajasthan Transport Aggregator Management Portal](https://transportaggregator.rajasthan.gov.in/) and [Rajasthan transport policies](https://transport.rajasthan.gov.in/content/transportportal/en/transport/policies.html) are examples of state-level implementation. They are not a substitute for the rules applicable to the intended operating state.
- [Maharashtra Transport Department — aggregator rules and notifications](https://transport.maharashtra.gov.in/Site/Common/ViewPdfList.aspx?Doctype=ae4e6702-3ac3-44e4-8d70-db31c41fd41e) illustrates that state-specific bike-taxi rules may be separate from general aggregator rules.

Before launch, counsel should confirm the current commencement, applicability, licensing, vehicle-class, insurance, safety, data-storage, grievance, and control-room obligations for the exact state and business model. Do not assume a central guideline alone authorizes commercial two-wheeler rides in every state.


## Open-source research and reuse policy

Open-source references reviewed for architecture and operational patterns:

- [Namma Yatri's public mobility repository](https://github.com/nammayatri/nammayatri) is an active India-focused mobility platform. Use it as a domain-model and operational-requirements reference, not as a drop-in implementation. Its repository is AGPL-3.0; do not copy or vendor its code into RideForge unless a maintainer/legal review explicitly approves the license obligations and compatibility with RideForge's distribution model.
- Prefer the current project's own C++/PostgreSQL architecture and small, well-scoped upstream dependencies where they meet requirements. Pin dependency versions, review license notices, run dependency vulnerability/license checks, and preserve attribution for any code actually reused.
- Do not copy proprietary ride-hailing branding, credentials, private APIs, scraped customer data, or fabricated operational metrics. Public reference code is not evidence that the same feature is secure or suitable for this deployment.
- Use open-source project behavior as design inspiration only. Every adopted pattern still needs RideForge-specific authorization, concurrency, migration, failure-recovery, accessibility and end-to-end tests.

### Research-derived launch implications

The 2025 Motor Vehicle Aggregator Guidelines include operational expectations beyond software availability, including grievance handling and driver induction training. The exact requirements and applicability must be verified with qualified counsel and the relevant state authority before operating. The application should not claim compliance merely because a support form or driver approval flag exists.

Research references:
- [MoRTH — Motor Vehicle Aggregator Guidelines 2025 (official PDF)](https://morth.gov.in/sites/default/files/circulars_document/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf)
- [MoRTH — Circulars and notifications related to road transport](https://morth.nic.in/Circulars-Notifications-related-to-Road-Transport?page=3)
- [Motor Vehicles Act, 1988, Section 93](https://indiacode.ecourtsindia.com/mv-act/section/93/)

These references support further legal review; they do not establish RideForge's licensing status or authorize any specific state-level bike-taxi operation.

## Latest merged engineering changes (2026-10-28)

- **PR #20** ([merge commit `f4e9a5d2f8db17d678e2b97292ada976b0a18868`](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/20)): bounded route/geocode caches, in-tab serialization of public Nominatim requests, and validation of provider route geometry. Its exact candidate passed all 13 release-readiness jobs. This is client-side request reduction, not a global rate limiter or production routing SLA.
- **PR #21** ([merge commit `dafd28504f80e252887b2467648a78f33e5d6726`](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/21)): bounded 12-connection-per-process PostgreSQL pool, 2-second acquisition timeout, and rollback/session reset before reuse. Its exact candidate passed all 13 release-readiness jobs. Load capacity and aggregate connection budgeting across replicas remain unverified.
- **PR #22** ([merge commit `82f0f7a53ca0dc3e382152f75a6c70923166d596`](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/22)): production driver hostname and admin path initialize the correct workspace; passenger booking UI and geocoding are suppressed on role-specific entry points. Its exact candidate passed all 13 jobs in [full release readiness run 40650689471](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40650689471). Browser E2E ran 32 tests: 31 passed, 1 skipped; CodeQL and container vulnerability scan passed.
- Fresh post-merge workflows are running against current main `82f0f7a53ca0dc3e382152f75a6c70923166d596`: [full release readiness](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651130776), [web build/E2E](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651130824), [C++ build/tests](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651130743), [Compose](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651130735), [CodeQL](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651130728), and [container scan](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651130658). Do not record these post-merge checks as passed until their final conclusions are available.
- [PR #23](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/23) proposes separating expired-offer cleanup from ride selection transactions to reduce a potential lock-order inversion. It is pending CI/review and is not part of main yet.

The decision remains **not production-ready for public/commercial rides**. The repository now has stronger exact-revision CI evidence, but no verified live staging deployment, DNS/TLS, production database, external two-device passenger-to-driver journey, measured load results, off-host backup/restore proof, real driver document verification, safety response operation, or transport/legal authorization. Those are real-world gates and must not be replaced by synthetic claims.
