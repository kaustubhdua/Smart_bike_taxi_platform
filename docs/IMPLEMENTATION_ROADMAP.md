# Smart Bike Taxi Platform — implementation roadmap

## Product goal
Build an original, accessible, portfolio-grade bike-taxi booking product with a real backend. It is inspired by common ride-hailing workflows, not a copy of Rapido's proprietary code, branding, illustrations, or assets.

## Current verified baseline (2026-10-18)
- Repository: `kaustubhdua/Smart_bike_taxi_platform`, default branch `main`.
- Existing app is a C++17 terminal simulation; it has a graph/Dijkstra route engine, custom linear-probing hash table, FIFO request queue, driver selection, local text persistence, CMake tests, and GitHub Actions for GCC, Clang, and sanitizers.
- Latest observed Actions run on `main` (commit `822e9e5c574aab59a48599e4558acdc6a3103051`) completed successfully on 2026-10-01: sanitizer, GCC, and Clang jobs passed.
- No open pull requests were returned by GitHub at audit time.
- There is no web frontend, HTTP API, PostgreSQL schema, auth system, or production deployment in the current tree.
- No local build was run in this review. The passing CI run is historical evidence for that exact commit, not proof for future changes.
- REA has not yet been installed or run; do not claim reverse-engineering observations until evidence is captured.

## Delivery phases and acceptance gates

### Phase 0 — audit and product/design foundation
- [x] Inspect repository tree, CMake, workflow, README and core C++ headers.
- [x] Record existing CI evidence and scope limitations.
- [x] Create a safe feature branch for the full-stack foundation.
- [ ] Run the existing build/tests in a working checkout.
- [ ] Install/verify REA in a compatible environment and record version + command output.
- [ ] Document any public reference observations with screenshots/notes and separate evidence from assumptions.

### Phase 1 — preserve and harden DSA core
- [ ] Expand graph tests: disconnected components, equal-cost paths, duplicate roads, zero-weight edges, very large finite weights, route reconstruction invariants.
- [ ] Audit hash table collision/update/full-capacity behavior; document fixed capacity and benchmark against `std::unordered_map`.
- [ ] Test FIFO semantics, deterministic driver tie-breaks, unavailable/unreachable drivers, failed dispatch state preservation, lifecycle transitions.
- [ ] Add fare rounding policy and finite/overflow input tests.
- [ ] Add reproducible benchmark program + generated datasets; publish results only after measuring.
- [ ] Add property/fuzz-style malformed persistence tests and document single-user limitations.

### Phase 2 — API + persistent data
- [ ] Choose and justify a C++ HTTP framework after checking portability and maintenance.
- [ ] Define versioned OpenAPI contract before UI integration.
- [ ] Add PostgreSQL migrations and repository layer; no production ride data in local text files.
- [ ] Model users, driver profiles, ride requests, rides, state-transition audit events, and idempotency records.
- [ ] Enforce authenticated identity, role checks, ownership checks, request validation, rate limits and safe errors.
- [ ] Make assignment transactional; add database constraints that prevent a driver having conflicting active rides.
- [ ] Add API integration tests and concurrency tests.

### Phase 3 — passenger experience
- [ ] Responsive booking shell, pickup/drop selection, route/fare quote, confirmation, active trip, cancellation and ride history.
- [ ] Real map provider adapter and geocoding policy; no reliance on public OSM demo endpoints for production.
- [ ] Keyboard, screen-reader, reduced-motion, loading, empty, offline, and error states.
- [ ] Booking submits to API; never silently create fake bookings when API is unavailable.

### Phase 4 — driver experience + real time
- [ ] Driver availability, incoming requests, accept/reject, trip state controls and trip history.
- [ ] Atomic acceptance and conflict tests.
- [ ] WebSocket updates with reconnect/backoff and REST resync fallback.
- [ ] Passenger/driver status agreement through cancellation and completion.

### Phase 5 — admin, safety and operations
- [ ] Admin-only account/trip inspection, incident reports and audited actions.
- [ ] Trip-sharing and emergency-support flows appropriate for a portfolio demo.
- [ ] Health/readiness endpoints, structured logs, redaction, backup/restore documentation.
- [ ] Dependency/security scans and secrets review.

### Phase 6 — release
- [ ] C++ and frontend CI; lockfile-backed install.
- [ ] API integration and Playwright end-to-end tests.
- [ ] WCAG 2.2 AA review, responsive visual QA, performance baseline and load tests.
- [ ] Deploy frontend and API; verify both against the exact release commit.
- [ ] README with architecture, local setup, screenshots, demo limitations and benchmark methodology.

## Design direction
- Product name: **Saarthi** (working name; changeable before public branding).
- Visual language: premium urban mobility, warm off-white canvas, deep ink typography, electric-lime action accent, cobalt map/route accent, generous whitespace, restrained motion, strong information hierarchy.
- Distinguish from reference products through clearer fare transparency, explainable driver matching, accessible controls, honest trip states and a visible DSA lab.
- Open-source inspirations may include React Bits, Magic UI, Radix UI, Motion and Lucide. Reuse specific components only under their license and preserve required notices; avoid copying brand assets or an entire competitor screen.
- Target WCAG 2.2 AA. Respect reduced-motion preferences. Use focus-visible states and semantic controls.

## Explicit MVP non-goals
No real-money collection, real SMS/OTP delivery, live commercial dispatch, unverified legal claims, native mobile apps, ML demand prediction, multi-city fleet operations, or microservices/Kubernetes in the first MVP. A sandbox payment must be visibly labelled as simulated.
