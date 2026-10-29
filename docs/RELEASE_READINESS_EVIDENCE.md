# RideForge Release Readiness Evidence

**Assessment date:** 2026-10-28  
**Repository:** `kaustubhdua/Smart_bike_taxi_platform`  
**Current main SHA:** `d2e1cd1449d471d6fd3bdc58e0457675446c2d84`  
**Release decision:** **Not ready for public/commercial rides.** The repository has a substantial full-stack MVP and recent engineering fixes, but no verified public staging deployment, real two-device journey, operational service, driver/vehicle compliance process, or transport-authority/legal approval.

This report distinguishes repository implementation and automated CI from evidence that requires real infrastructure. A green build, local Compose stack, mock-provider browser test, or demo receipt is not proof of a commercially operating taxi service.

## Recent engineering changes and exact-candidate evidence

| Change | Merge SHA | Exact candidate CI evidence | Result |
|---|---|---|---|
| Route/geocode caches, malformed-provider validation (PR #20) | `f4e9a5d2f8db17d678e2b97292ada976b0a18868` | [Full release readiness, run 40648144882](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40648144882), candidate `c7853cc84928bba3cf9f00ed157378e5cf91b948` | 13/13 jobs passed; browser tests reported 25 passed, 1 skipped. |
| Bounded per-process PostgreSQL pool (PR #21) | `dafd28504f80e252887b2467648a78f33e5d6726` | [Full release readiness, run 40648486771](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40648486771), candidate `5ece2fe492b998eb2109504c09199552e56617c7` | 13/13 jobs passed, including concurrent connection smoke tests. |
| Production driver/admin entry routing (PR #22) | `82f0f7a53ca0dc3e382152f75a6c70923166d596` | [Full release readiness, run 40650689471](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40650689471), candidate `f85dad1fa6f64a8dda1cf530dedf712db4fea76b` | All 13 jobs passed. |
| Dispatch expiry/ride lock-order hardening (PR #23) | `8c6ee2ed12e3cff339c98b4389dacff708e525bb` | [Full release readiness, run 40651307975](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651307975), candidate `0fc4bb5cf54adfb03cc4b583a63b7175e36dec3d` | All 13 jobs passed. Main-branch workflows for the merge SHA are running separately and were not yet complete at the time of this report. |
| Debounce location geocoding while typing (PR #26) | `d2e1cd1449d471d6fd3bdc58e0457675446c2d84` | [Full release readiness, run 40651766311](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/40651766311), candidate `1ae3ad8b05662d5720715b73491f775167ba7aaa` | All 13 jobs passed; browser workflow reported 31 passed, 1 skipped. |

The latest main revision `d2e1cd1449d471d6fd3bdc58e0457675446c2d84` has its own workflow runs; at the time of this report, current-main verification was still pending. Do not describe post-merge main CI as green until those exact-SHA runs complete.

## Capability and limitation matrix

| Area | Status | What is still missing |
|---|---|---|
| Passenger booking, accounts, history and cancellation | Implemented in repository | Verified public deployment and real-device end-to-end evidence. |
| Driver workspace, queue, timed offers and redispatch | Implemented in repository | Real driver onboarding/verification, push/background alert proof, race/restart/load tests. |
| Admin workspace | Implemented in repository | Production access controls and tested operator procedures. |
| PostgreSQL persistence and migrations | Implemented in repository | Production database, least-privilege roles, off-host backup and restore rehearsal. |
| Live ride events (SSE/outbox) | Implemented in repository | Production reconnect/load measurements and alerts for lag/dead letters. |
| PostgreSQL API pool | Bounded to 12 connections per API process, 2-second acquisition wait | Aggregate connection budgeting across replicas/workers and representative saturation/load tests. It is not a shared cross-replica pool. |
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
