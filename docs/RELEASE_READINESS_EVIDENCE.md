# RideForge Release Readiness Evidence

**Assessment date:** 2026-10-28  
**Repository:** `kaustubhdua/Smart_bike_taxi_platform`  
**Reviewed revision:** `68daf4d95f2e67416010d5f28466017bfc6c2eec` (main)  
**Decision:** **Not production-ready for public/commercial rides yet.** The codebase has a substantial full-stack MVP, but external deployment, operational, legal, safety, and real-device evidence remain release gates.

This document deliberately separates implementation evidence from claims that require a live environment. A merged PR, green CI run, screenshot, local Compose stack, or demo booking is not proof of a commercially operational transport service.

## Evidence reviewed

- Main points to `68daf4d95f2e67416010d5f28466017bfc6c2eec`, which merged PR #13 (durable timed driver offers).
- PR #13 adds migration `006_durable_driver_offers.sql`, the C++ dispatch worker, 45-second offers, expiration/redispatch, offer-aware queue and acceptance/decline behavior, Compose/Docker wiring, and API/schema/browser-test updates.
- PR #9 is merged. Its recorded aggregate release-readiness run passed 13 jobs on the earlier tested revision `d0cab5d11bab857190f7232ffecc501ae0d5bca3`. That result must not be represented as a fresh full-suite result for the current main SHA.
- The repository contains separate passenger and driver web experiences, a C++ API, PostgreSQL migrations, an outbox worker, authenticated SSE, Compose deployment templates, and operational/security documentation.
- The latest repository metadata reviewed showed no open pull requests. Issue #2 and issue #3 remain open; issue #10 still describes the durable-offer work even though its main implementation was merged by PR #13.

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
- [ ] Run the full release-readiness workflow on the exact candidate SHA after PR #13.
- [ ] Verify C++ warnings-as-errors, sanitizers, backend smoke tests, PostgreSQL migration/recovery, web typecheck/build, desktop/mobile E2E, accessibility, dependency audit, CodeQL, container build and vulnerability scanning.
- [ ] Add/retain deterministic PostgreSQL tests for simultaneous accept, accept-vs-expiry, cancellation races, worker restart, duplicate worker execution, no eligible drivers, bounded retries, and cross-account/role authorization.
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
