# RideForge 100-point completion matrix

**Snapshot:** 2026-11-14  
**Repository base SHA assessed:** `670e946f2b290ec7081d712a073edad6a697f1cb`  
**Target:** L4 operationally ready software, with L5 commercial authorization separate.

This is an evidence register, not a feature-count scoreboard. A task is **VERIFIED** only when its stated acceptance evidence exists. **IMPLEMENTED** means code/documentation exists but exact-head tests or real-environment proof are still outstanding. A queued workflow is not a pass. A blocked external dependency is not silently marked complete.

## Status definitions

| Status | Meaning |
|---|---|
| VERIFIED | Acceptance evidence was actually observed on the stated source/environment |
| IMPLEMENTED | Code or documentation exists; required execution/acceptance evidence is pending |
| PARTIAL | Some requirements work, but material scope remains |
| BLOCKED | Requires credentials, provider, authority, user action or infrastructure not available |
| NOT STARTED | No implementation evidence found |
| DEFERRED | Intentionally postponed until the user selects the deployment/operating model |

## Current release summary

- main is at 670e946f2b290ec7081d712a073edad6a697f1cb, merging PR #79 (Supabase-native backend).
- The current release candidate is PR #82: https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/82. It is open and not merged. Its exact head is 5f091ae5fec80f3d955aee39d9df06c2c05b0c7c; all observed exact-head GitHub Actions runs were queued, and no successful final suite has been observed. Do not merge until they complete.
- Supabase project ghcufcegfvvjhsnqnrzr is ACTIVE_HEALTHY, PostgreSQL 17.11, Free plan. Edge Function rideforge-api is ACTIVE version 9. The latest Security and Health Advisors returned zero findings. Performance Advisor reports 16 informational unused indexes; the database is empty, so do not drop them without representative workload evidence.
- Production has 14 public tables including the application migration ledger; all 14 have RLS enabled. The 13 operational tables have participant/self read policies or explicit deny policies. Client roles cannot execute the rideforge_* SECURITY DEFINER RPCs; their search paths are pinned. The auth.users insert trigger rideforge_auth_user_created exists and creates the passenger account.
- Supabase Realtime publication includes rides and ride_events, but the current React client does not directly subscribe to Realtime. It consumes the authenticated SSE compatibility endpoint, which polls durable ride events every 1.5 seconds for up to 25 seconds per connection and reconnects; REST polling is the recovery path. Do not describe the browser as a direct Realtime subscriber.
- Production has zero Auth users, zero application accounts and zero rides. Supabase logs in the latest 24-hour window showed no Edge Function log source/invocations. Real signup, first-admin bootstrap and deployed passenger/driver/admin journeys have not been proven.
- The retained Render static site rideforge-web is live on commit d8552eb0a8b2a5b11cea3c900a2ed068b6978c1d, not the PR #82 candidate. Three legacy Render API service objects remain and their most recent deploys failed/are not serving the current app. Delete them manually after the final static frontend is confirmed deployed; keep rideforge-web.
- Supabase Auth redirect configuration and first verified admin bootstrap remain operator tasks. No successful encrypted off-site backup export or isolated restore drill is evidenced; the organization is on Free, which has no automatic daily backup/PITR entitlement.
- Exact-head CI, live HTTP readiness from an external runner, browser E2E, realistic load testing, branch protection and post-cleanup Render inventory remain unverified.
- Commercial Noida operations are not authorized. UP's final Thirty-third Amendment aggregator rules were notified on 22 May 2026 and require a state licence before new operations. Noida's NCR vehicle onboarding is also subject to CAQM Direction 94; the temporary BS-VI two-wheeler exception for existing fleets expires 31 Dec 2026. The project must remain an academic/portfolio demo unless licensing, EV/vehicle eligibility, insurance, driver compliance, safety operations and counsel/authority approvals are evidenced.


## Snapshot counts

| Status | Tasks |
|---|---:|
| VERIFIED | 5 |
| IMPLEMENTED | 35 |
| PARTIAL | 45 |
| BLOCKED | 7 |
| NOT STARTED | 7 |
| DEFERRED | 1 |

These counts are a snapshot of the 100 rows below; they change only when evidence/status changes.

## 1. Product scope and project definition

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 1 | Audit branches, PRs, issues, commits, packages, directories and configuration | PARTIAL | Engineering | Main tree, current PRs #72–74 and open issues #2, #3, #10 and #17 reviewed; historical inventory recorded 69 branches and four orphan branches. Full commit/package/configuration history and a complete dead-code sweep remain |
| 2 | Source-of-truth architecture document | IMPLEMENTED | Engineering | `docs/ARCHITECTURE.md` in PR #67; merge and review against final deployment choice |
| 3 | Define passenger, driver, admin and support scope | PARTIAL | Engineering | API/UI scope documented; product acceptance and support operating model still need sign-off |
| 4 | Remove duplicate implementations and configuration paths | PARTIAL | Engineering | Active Vite entrypoint identified; complete duplicate/dead-code sweep remains |
| 5 | Identify TODOs, mocks, hard-coded responses and nonfunctional screens | PARTIAL | Engineering | Initial UI/code review found planned safety/DSA actions and provider-dependent placeholders; full sweep remains |
| 6 | Home page is the real product, not a simulation | IMPLEMENTED | Engineering | The browser-only localStorage simulation is removed; `/` serves the API-backed app (`/live` remains an alias). With the API unreachable it shows an explicit error and never invents a ride or fare; browser tests cover both |
| 7 | Requirements-to-code-to-test matrix | PARTIAL | Engineering | This first-pass matrix maps tasks to evidence/acceptance; add exact route, test name, tested SHA and evidence URL for each implemented row |
| 8 | Define operating geography, boundaries, hours and vehicle categories | PARTIAL | Engineering / User | Noida context exists; strict polygon geofence, operating hours and vehicle categories are not configured |
| 9 | Define measurable acceptance criteria | PARTIAL | Engineering | CI and API acceptance tests exist; missing provider/legal/manual-device criteria remain |
| 10 | Completion dashboard with owner, blocker, evidence and status | IMPLEMENTED | Engineering | This file is the current register; update after every accepted PR and exact-head test |

## 2. Passenger application

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 11 | Registration, login, logout and session management | PARTIAL | Engineering | Register/login and client sign-out exist; email/phone verification, token revocation and recovery are absent |
| 12 | Passenger profile management | IMPLEMENTED | Engineering | PR #68 adds self-scoped GET/PATCH profile and display-name editor; phone verification/preferences are out of scope; exact-head tests pending |
| 13 | Pickup selection: search, map, current location and manual pin | PARTIAL | Engineering | Label autocomplete/datalist and map exist; passenger GPS and manual map pin placement are absent |
| 14 | Destination selection and saved destinations | PARTIAL | Engineering | Label selection exists; saved destinations and manual pin placement are absent |
| 15 | Strict service-area validation | PARTIAL | Engineering | Noida geocoding context exists; context is not a polygonal geofence or service-hours check |
| 16 | Server-side fare estimation | IMPLEMENTED | Engineering | Server geocodes/routes and computes the demo tariff; exact-head integration pass pending |
| 17 | Transparent fare breakdown | IMPLEMENTED | Engineering | Server quote and UI display base plus distance components; demo tariff is explicitly not a UP-approved commercial tariff. Exact-head Playwright and deployed journey evidence remain required |
| 18 | Durable, idempotent booking creation | IMPLEMENTED | Engineering | Transactional booking and idempotency fingerprint tests exist; exact-head CI pending |
| 19 | Booking lifecycle tracking | IMPLEMENTED | Engineering | Persisted ride events, authenticated SSE replay and REST recovery exist; deployed live journey not verified |
| 20 | Passenger trip history and receipts | IMPLEMENTED | Engineering | History and printable receipt exist; receipt is explicitly demo-only, not tax invoice/payment proof |

## 3. Driver application

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 21 | Driver registration | PARTIAL | Engineering | Admin can provision pending driver accounts; public/self-service onboarding is absent |
| 22 | Identity, licence, vehicle and document verification | BLOCKED | Provider / User / Authority | Manual approval is not identity/document verification; requires approved verification workflow and legal requirements |
| 23 | Driver availability controls | IMPLEMENTED | Engineering | Online/offline and location freshness checks exist; end-to-end live device verification pending |
| 24 | Onboarding approval and suspension | IMPLEMENTED | Engineering | Admin approval/suspension, forced offline and audit events exist; exact-head tests pending |
| 25 | Durable driver offer screen | IMPLEMENTED | Engineering | Driver queue displays pickup, destination, fare and expiry; deployed workflow not verified |
| 26 | Accept/reject with server-side checks | IMPLEMENTED | Engineering | Transactional assignment and persisted decline exist; concurrency suite execution pending |
| 27 | Driver arrival confirmation | PARTIAL | Engineering | Driver can record arriving state; GPS/geofence proof is not implemented |
| 28 | Passenger-confirmed trip start | PARTIAL | Engineering | Correct driver/ride lifecycle is checked; passenger OTP/PIN confirmation is not implemented |
| 29 | Trip completion and receipt | IMPLEMENTED | Engineering | Completion stores final quoted fare and event; no payment settlement is implied |
| 30 | Earnings and trip history | PARTIAL | Engineering | Gross completed-fare history exists; net earnings, commission, adjustments and payouts are absent |

## 4. Booking, dispatch and trip lifecycle

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 31 | Explicit booking state machine | IMPLEMENTED | Engineering | Server-side allowed transitions and invalid-transition tests exist; exact-head CI pending |
| 32 | Booking idempotency | IMPLEMENTED | Engineering | Same-key replay/conflict behavior is persisted and tested; exact-head execution pending |
| 33 | Durable offers across worker restarts | IMPLEMENTED | Engineering | Offers and state are database-backed; restart test exists, execution pending |
| 34 | Prevent two drivers accepting the same ride | IMPLEMENTED | Engineering | Transactional locking and partial unique constraints plus concurrency tests; exact-head execution pending |
| 35 | Offer expiry | IMPLEMENTED | Engineering | Durable 45-second offers and expiry handling exist; exact-head test pending |
| 36 | Safe redispatch after decline/timeout | IMPLEMENTED | Engineering | Worker advances to next eligible candidate; exact-head test pending |
| 37 | Driver eligibility filtering | IMPLEMENTED | Engineering | Approval, online state, fresh location and pickup radius are checked server-side |
| 38 | Dispatch recovery after worker restart | IMPLEMENTED | Engineering | `backend/tests/dispatch_worker_restart_test.py` exists; exact-head execution pending |
| 39 | Cancellation rules | PARTIAL | Engineering | Passenger cancellation and state validation exist; cancellation fees/refunds and full policy matrix are absent |
| 40 | Trip audit trail | IMPLEMENTED | Engineering | Ride events, outbox and privileged admin audit records exist; production retention policy remains open |

## 5. Backend and API engineering

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 41 | Audit and document every endpoint | PARTIAL | Engineering | OpenAPI covers current API; verify every operation against implementation and authz matrix |
| 42 | Standard response/error format | PARTIAL | Engineering | Common response helper exists; audit all legacy and provider errors for consistency |
| 43 | Strict request validation and size limits | IMPLEMENTED | Engineering | Body limits and route-specific validation exist; fuzz/property tests remain |
| 44 | Role-based authorization | IMPLEMENTED | Engineering | Passenger/driver/admin checks and authorization matrix tests exist; exact-head execution pending |
| 45 | Object-level authorization | IMPLEMENTED | Engineering | SQL queries scope by authenticated subject; cross-account tests exist; exact-head execution pending |
| 46 | Rate limiting | PARTIAL | Engineering | Auth and quote have per-IP limits and support has a per-account limit; booking/cancellation lack dedicated limits. PR #71 merged bounded per-IP keys and concurrency tests; PR #73 adds counter saturation and invalid-configuration tests. Distributed enforcement remains outstanding |
| 47 | Idempotency and safe retries | PARTIAL | Engineering | Booking idempotency and durable outbox retry exist; provider/payment retries and all mutation boundaries need review |
| 48 | External-service timeouts and failure handling | IMPLEMENTED | Engineering | Curl connect/total timeouts, bounded response and provider circuit breaker exist; provider SLA not guaranteed |
| 49 | API versioning and compatibility | PARTIAL | Engineering | `/api/v1` exists; automated backwards-compatibility contract tests need expansion |
| 50 | Accurate OpenAPI documentation | PARTIAL | Engineering | OpenAPI exists; PR #68 adds profile operations; validate generated spec against every actual route |

## 6. Database and Supabase

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 51 | Audit tables, relationships and constraints | VERIFIED | Engineering | Read-only SQL inspected all 12 tables, PK/FK/UNIQUE/CHECK constraints, indexes, ride-status/account-role enums and the ride-event outbox trigger; all FK delete actions are RESTRICT |
| 52 | Verify migration history | VERIFIED | Engineering | RideForge application ledger `public.schema_migrations` records 001–015; Supabase platform migration history is a separate audit ledger with additional operator-applied DDL records |
| 53 | Clean-database migration reproducibility | IMPLEMENTED | Engineering | PostgreSQL CI migration smoke exists; main failed before full API integration; PR #64 exact-head run pending |
| 54 | Database role separation | VERIFIED | Engineering | `rideforge_app` is LOGIN/BYPASSRLS, non-superuser, cannot create DB/roles |
| 55 | Runtime database connection configuration | BLOCKED | User / Engineering | Exact runtime host/credential authentication from an application process is not proven; deployment later |
| 56 | Synchronize and prove runtime-role credentials | BLOCKED | User / Engineering | Direct `pg_authid` inspection shows no `rideforge_app` password verifier. Render already declares a generated `RIDEFORGE_RUNTIME_ROLE_PASSWORD`, which the entrypoint maps to `RIDEFORGE_APP_PASSWORD`; startup currently exits earlier because `DATABASE_URL_TEMPLATE` lacks the required literal password placeholder. Correct the runtime template and owner Session-pooler URL privately, then prove an actual application login; never paste credentials into chat |
| 57 | RLS and browser-role exposure | VERIFIED | Engineering | RLS enabled on all 12 tables; zero policies intentionally; anon/authenticated have no table CRUD grants |
| 58 | Database least privilege | PARTIAL | Engineering | Live DB verified: no runtime DELETE/TRUNCATE, no UPDATE on five sequences, append-only tables protected, existing public function EXECUTE removed from browser/service roles, postgres-owner defaults restricted, and a NOLOGIN read-only backup role exists. Supabase-managed `supabase_admin` function defaults and the standard privileged `service_role` table grants remain platform-managed; never expose the service-role key. Migration sources/CI are pending PR #76 checks; live runtime-credential authentication and independent security review remain. |
| 59 | Query/index performance | PARTIAL | Engineering | 21 unused-index notices retained because workload is negligible; EXPLAIN and load evidence remain |
| 60 | Production backup and restore | BLOCKED | User / Engineering | Supabase Free has no automatic daily backups/PITR. PR #76 adds a daily encrypted GitHub Actions export workflow and disabled read-only backup role, but repository secrets, a successful backup run, off-site retention and a production restore drill remain. |

## 7. Payments, pricing and financial correctness

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 61 | Audit payment architecture | PARTIAL | Engineering | Current system has no real payment provider; document provider selection before implementation |
| 62 | Separate demo and real payments | VERIFIED | Engineering | No successful payment is fabricated; demo receipt explicitly is not proof of payment |
| 63 | Real payment initiation | BLOCKED | User / Provider | Requires selected provider, merchant account, credentials and legal/financial approval |
| 64 | Signed, replay-safe payment webhooks | NOT STARTED | Engineering / Provider | No real payment webhook implementation |
| 65 | Payment idempotency | NOT STARTED | Engineering / Provider | Booking idempotency exists; payment-event idempotency does not |
| 66 | Payment reconciliation | NOT STARTED | Engineering / Provider | No provider transaction reconciliation |
| 67 | Refund workflows | NOT STARTED | Engineering / Provider | No real payment/refund provider |
| 68 | Fare calculation boundary tests | PARTIAL | Engineering | Existing fare uses integer paise; open PR #74 adds pure C++ rounding/boundary/overflow tests and API smoke checks for component totals; exact-head CI pending |
| 69 | Driver settlement accounting | NOT STARTED | Engineering / Finance | No net payout, commission or settlement ledger |
| 70 | Financial audit reports | NOT STARTED | Engineering / Finance | No real transactions to reconcile; finance reporting is not implemented |

## 8. Safety, privacy, security and legal readiness

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 71 | Threat model | PARTIAL | Engineering | Security model documents trust boundaries; complete abuse-case review and sign-off remain |
| 72 | OWASP API Security review | PARTIAL | Engineering | Authz matrix, CodeQL and dependency checks exist; full manual API threat review remains |
| 73 | Dependency and vulnerability scans | IMPLEMENTED | Engineering | CI jobs exist and passed on prior main candidate; current exact-head checks pending |
| 74 | Secret management | PARTIAL | User / Engineering | No secrets should be committed; actual runtime credentials and protected backup secret are not configured/verified |
| 75 | Location privacy | PARTIAL | Engineering | Driver coordinates clear when offline and are freshness-scoped; retention/erasure and passenger GPS controls remain |
| 76 | Privacy notices and consent | PARTIAL | Engineering / Counsel | Compliance documentation exists; production notice, consent records and operational workflow need approval |
| 77 | Data access/deletion requests | NOT STARTED | Engineering / Counsel | No end-user export/deletion workflow or approved retention schedule |
| 78 | DPDP applicability/readiness | PARTIAL | Counsel / Engineering | Phased commencement and mapping documented; counsel review, notices, processors and incident drill remain |
| 79 | UP aggregator legal assessment | PARTIAL | Counsel / Authority | 2026 state rules researched; counsel/authority confirmation and actual licence/vehicle/insurance approvals absent |
| 80 | Commercial launch blocker register | IMPLEMENTED | Engineering / Counsel | `docs/UP_AGGREGATOR_COMPLIANCE.md` records licence, vehicle, driver, safety and grievance gates |

## 9. Frontend, usability and accessibility

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 81 | Passenger UI functionality | PARTIAL | Engineering | Quote, booking, history, support and profile display-name editor exist; exact-head browser tests pending |
| 82 | Driver UI functionality | PARTIAL | Engineering | Availability, queue, accept/decline and lifecycle actions exist; passenger start PIN and document verification absent |
| 83 | Admin dashboard | IMPLEMENTED | Engineering | Metrics, ride search, driver approval, support triage and audit history exist; deployed data verification pending |
| 84 | Loading/empty/error states | IMPLEMENTED | Engineering | UI has loading, empty, notice and error states; manual usability review remains |
| 85 | Responsive layouts | PARTIAL | Engineering | Playwright mobile viewport coverage exists; real low-end Android/device testing not done |
| 86 | Accessibility | PARTIAL | Engineering | Axe/WCAG automated coverage exists in PR #65; manual keyboard and screen-reader acceptance pending |
| 87 | Map permissions and fallbacks | PARTIAL | Engineering | Manual location labels and map fallback exist; passenger GPS/manual pin and provider outage tests remain |
| 88 | Notifications | PARTIAL | Engineering | Passenger SSE and REST recovery exist; push/SMS/email notifications are absent |
| 89 | Real-device testing | BLOCKED | User / Engineering | Requires representative Android devices and real network conditions |
| 90 | Visual/interaction audit | PARTIAL | Engineering | Initial button audit found planned safety/DSA copy; remaining full-page audit and cleanup required |

## 10. Testing, deployment, operations and documentation

| # | Task | Status | Owner | Evidence / acceptance still required |
|---:|---|---|---|---|
| 91 | Reliable CI pipeline | BLOCKED | GitHub / Engineering | Current `main` is `5d802f212ba11a2980c066e7734595bd8b4e2ba8`. PR #76 head `a3c2cf5f795b659ad62a21c14a5156190d7c8198` has 25 exact-head checks queued, with no pass/failure conclusion yet. Do not merge until all checks complete successfully |
| 92 | Meaningful required checks | IMPLEMENTED | Engineering | C++, sanitizer, PostgreSQL, API, web, CodeQL, dependency and container scan jobs exist; exact-head pass pending |
| 93 | Unit/component tests | IMPLEMENTED | Engineering | Fare, provider, security and frontend tests exist; exact-head CI pending |
| 94 | Integration tests | IMPLEMENTED | Engineering | PostgreSQL, API, outbox and authz integration suites exist; exact-head CI pending |
| 95 | Passenger-to-driver E2E | PARTIAL | Engineering | Source tests cover lifecycle and PR #65 demo flow; no deployed live journey is verified |
| 96 | Concurrency and recovery tests | IMPLEMENTED | Engineering | 14 PostgreSQL concurrency tests plus worker restart test exist; exact-head execution pending |
| 97 | Deployment verification | DEFERRED | User / Engineering | User will configure Vercel later; C++ API/worker compute host still needs a decision |
| 98 | Observability and runbooks | PARTIAL | Engineering | Structured logs, request IDs, admin metrics and runbook exist; external monitoring/alerts/on-call not configured |
| 99 | Load, resilience and recovery exercises | PARTIAL | Engineering | Concurrency tests and local backup/restore smoke (PR #70) exist; representative load, Supabase production backup restore and recovery objectives are absent |
| 100 | Final release evidence package | PARTIAL | Engineering / User | Architecture, runbook, security/compliance and this matrix exist; exact CI, deployed SHA, live screenshots/video and sign-off remain |

## Readiness assessment

| Level | Current assessment | Why |
|---|---|---|
| L0 — Repository complete | PARTIAL | Architecture and matrix are drafted; CI queue, docs/branch review and remaining gaps persist |
| L1 — Feature complete | PARTIAL | Core booking/dispatch/admin paths exist; profile, verification, safety, payments and service-area gaps remain |
| L2 — Test complete | NOT ACHIEVED | Exact current PR checks are queued; main SHA b4f91bc failed API smoke and web tests |
| L3 — Deployment complete | DEFERRED | Vercel intentionally postponed; no healthy live API has been verified |
| L4 — Operationally ready | NOT ACHIEVED | No production backup/restore, monitoring, load proof or real-device acceptance |
| L5 — Commercially authorised | NOT AUTHORISED | Licence, insurance, driver/vehicle verification and regulatory approval are separate gates |

## Non-negotiable acceptance rule

Do not change any row to VERIFIED because a file or button exists. Record the exact tested SHA, command/workflow, result, environment and evidence link. Do not mark an external legal, provider, payment, backup or deployment gate complete without proof from the responsible party.
