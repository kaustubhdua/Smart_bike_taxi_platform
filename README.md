<div align="center">

# 🏍️ RideForge — Smart Bike Taxi Platform

**A C++17-powered bike-taxi platform with a real API, PostgreSQL bookings, and driver/admin workspaces.**

Shortest-path routing · Radius-filtered driver queue · Transactional bookings · Local persistence

![C++17](https://img.shields.io/badge/C%2B%2B-17-00599C?logo=cplusplus&logoColor=white)
![CI](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/cpp.yml/badge.svg)
![API](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/backend.yml/badge.svg)
![Database](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/db-migration.yml/badge.svg)
![Web](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/web.yml/badge.svg)
![Containers](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/container.yml/badge.svg)
![Container security](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/container-scan.yml/badge.svg)
![Release readiness](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/release-readiness.yml/badge.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)
![Project](https://img.shields.io/badge/status-portfolio%20MVP%20in%20progress-blue)

</div>

---


## Run the complete verification suite

The [Full release readiness workflow](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/release-readiness.yml) aggregates the C++/sanitizer/benchmark, API integration, PostgreSQL migration and recovery, web/Playwright/accessibility, and container/Compose suites. The individual workflows also run on pull-request changes; record the exact SHA whose checks passed. All 14 constituent checks passed on release-branch SHA `a0a3b2859cde2de8045809fed4aaa96bafd3356a` on 2026-10-20. Later Compose PostgreSQL connection-timeout and documentation changes still require current-head verification. The aggregate manual workflow itself has not been dispatched.

## Full-stack roadmap status

See [`docs/DEEP_IMPROVEMENT_RESEARCH.md`](docs/DEEP_IMPROVEMENT_RESEARCH.md) for the research-backed priority order, security/reliability recommendations, acceptance criteria, and release gates. The implementation status below is not a production-readiness claim.

This repository has evolved from its original C++17 academic simulation into **RideForge**, an original bike-taxi portfolio MVP. The C++ API exposes PostgreSQL-backed quotes, passenger authentication and persisted booking, cancellation, passenger/driver history, demo receipts, configurable-radius dispatch eligibility, admin ride search, driver provisioning/approval/suspension, support reports with audited resolution, and operational metrics. A self-hosted HTTPS deployment template is included, but no live deployment or commercial ride service is claimed.

| Area | Current evidence | Status |
|---|---|---|
| C++ DSA baseline | Existing C++ build/tests and GCC/Clang/sanitizer CI | Existing baseline |
| Route algorithm | Deterministic equal-distance predecessor selection, zero-weight parent-cycle guard, and overflow handling; disconnected/extreme-weight tests | GCC, Clang and ASan/UBSan passed on release-branch SHA `a0a3b2859cde2de8045809fed4aaa96bafd3356a` |
| Ride lifecycle/dispatch | Cancellation releases drivers; tests cover cancellation/reassignment, deterministic driver ties and unreachable drivers | GCC, Clang and ASan/UBSan passed on release-branch SHA `de6884ea7b46140509cd39bfd785e3c52f7c1bdb` |
| Benchmarking | Deterministic 1,000-node / 1,000-query benchmark; CI publishes a CSV artifact with environment notes | Download the artifact from the [C++ workflow runs](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/workflows/cpp.yml); no benchmark sample is currently checked into this branch, and one run is not a general performance claim |
| Web UI | React + TypeScript + Vite; lazy-loaded Leaflet map; Nominatim geocoding + OSRM road geometry; pickup/drop autocomplete; quote expiry validation | CI covers typecheck/build, high-severity npm audit, gzip budgets, desktop/mobile Playwright E2E and axe accessibility audit; dependency installation is lockfile-backed with `npm ci` |
| API service | C++17 Boost.Beast HTTP server; database liveness and schema readiness probes, quote, passenger auth/booking/history/cancellation, driver queue/accept/status/availability/history, admin ride search, driver provisioning/approval/suspension, support reports and metrics routes | CI builds with warnings as errors and smoke-tests API/database behavior, including request size limits and booking validation; public routing providers are not exercised by CI |
| PostgreSQL | Versioned migrations include accounts, driver profiles, rides, quotes, idempotency, active-driver uniqueness, explicit driver approval, admin audit events, transactional ride-event outbox, and support reports with audited resolution | CI is configured to apply all migrations twice and check schema/outbox invariants; no production database is configured |
| Authentication and passenger booking | PBKDF2 password hashing, short-lived signed access tokens, role/ownership checks, quote consumption, transactional idempotency, ride history, final fares, printable demo receipts and cancellation | API implemented with smoke coverage; current-head verification and broader authorization/concurrency tests remain |
| Driver/admin operations | Driver queue uses configurable `RIDEFORGE_DISPATCH_RADIUS_KM` (1–100 km, default 20); drivers can review trip history/gross completed fares; admins can search rides, provision/approve/suspend drivers, review audit history, and triage support reports with audited resolution | Connected driver/admin workspaces and API smoke coverage; real identity/vehicle verification remains out of scope |
| Realtime, payments and safety operations | Durable outbox worker publishes through PostgreSQL NOTIFY with retry/dead-letter handling; API exposes authenticated SSE with persisted-event replay and the passenger UI consumes ride-status frames | SSE fallback/resync needs broader load/reconnect verification; payments and safety operations remain release blockers |
| Reproducible installs | `web/package-lock.json` is committed and web CI uses `npm ci` | CI validates lockfile-backed installation; current-head checks are required after any subsequent changes |
| Deployment and screenshots | Self-hosted HTTPS Compose/Caddy template and same-origin API/SSE proxy validated in CI; no live deployment or screenshots verified | Template; external host/domain still required |

### Frontend development

```bash
cd web
npm install
npm run dev
npm run typecheck
npm run build
```

The web CI workflow runs typechecking and a production build. The web interface requests real road geometry through configurable geocoding/routing adapters and an interactive OpenStreetMap view. The API calculates and persists a five-minute demo quote in PostgreSQL; the UI supports passenger registration/sign-in, ride confirmation, cancellation, trip history, printable demo receipts, and support reports. The driver workspace includes trip history and a gross completed-fare summary, not a payout ledger; the admin workspace includes bounded ride search and support-report triage. Playwright desktop/mobile E2E, axe accessibility audit, high-severity npm audit and gzip budgets run in CI. Public demo routing endpoints are for evaluation only. Drivers manually accept eligible requests in the driver workspace. Passenger status uses authenticated server-sent events with REST polling/reconnect recovery; the API exposes only the driver's latest fresh location while online, not a historical GPS trail. Automated offer dispatch, driver/admin push subscriptions, and push notifications are not implemented. Lockfile-backed installs now use the committed `web/package-lock.json` and `npm ci`; deployment verification remains a release gate in [PR #8](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/8).

### C++ tests and benchmark

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build --parallel
ctest --test-dir build --output-on-failure

cmake -S . -B build-bench -DSMART_BIKE_TAXI_BUILD_BENCHMARKS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build-bench --target smart_bike_taxi_benchmark --parallel
./build-bench/smart_bike_taxi_benchmark 1000 1000
```

The benchmark prints CSV timing data for route queries and custom-versus-standard hash lookup. Results are hardware/compiler/dataset dependent; do not claim one structure is faster until results are recorded under a reproducible environment.

### Backend contract and schema

See [backend/README.md](backend/README.md), [OpenAPI contract](backend/openapi.yaml), [initial PostgreSQL migration](backend/migrations/001_initial_schema.sql), and [driver approval/outbox migration](backend/migrations/002_driver_approval_and_outbox.sql), plus [outbox retry/dead-letter migration](backend/migrations/003_outbox_dead_letters.sql) and [support reports migration](backend/migrations/004_support_reports.sql). The native service supports database-backed quotes, passenger registration/login, signed access tokens, idempotent booking transactions, ride history/detail reads, cancellation, driver queue/availability/acceptance/lifecycle-transition endpoints, audited admin driver provisioning/approval/suspension, bounded admin ride search, support-report triage, metrics and recent admin-audit history. The driver workspace requests browser geolocation, refreshes location/queue while online, and signs out by attempting to mark the driver offline. Authenticated SSE ride-status updates and a fresh driver-location marker are implemented for active rides; the marker is refreshed from the authorized ride-detail API and disappears when location becomes stale. Use the one-time [admin bootstrap utility](backend/src/bootstrap_admin.cpp) and [operations runbook](docs/OPERATIONS_RUNBOOK.md) to create the first local administrator. Backend CI covers API compilation, auth/booking smoke behavior, clean PostgreSQL migrations, and 5 km/20 km dispatch-radius behavior. Real-world identity/vehicle verification, broader concurrency/authorization tests, broader SSE reconnect/load verification, a live deployment, and commercial operating requirements remain release gates. Track the remaining work in [PR #8](https://github.com/kaustubhdua/Smart_bike_taxi_platform/pull/8) and the [release-hardening issue](https://github.com/kaustubhdua/Smart_bike_taxi_platform/issues/8).

Security automation includes scheduled CodeQL analysis for C++/TypeScript and dependency-review checks for high-severity or disallowed-license changes; those checks must pass on the release SHA before merge. The API also emits redacted JSON request-completion logs and provides a schema-aware readiness endpoint.

See also the [implementation roadmap](docs/IMPLEMENTATION_ROADMAP.md), [security model and release checklist](docs/SECURITY_MODEL.md), and [operations runbook](docs/OPERATIONS_RUNBOOK.md). These documents separate implemented behavior from release blockers and do not claim commercial readiness.

### Run the API and PostgreSQL locally

With Docker Compose installed, copy `.env.example` to `.env`, replace the local database password in both `POSTGRES_PASSWORD` and `DATABASE_URL`, set a contact-bearing `RIDEFORGE_USER_AGENT`, and generate a random `RIDEFORGE_JWT_SECRET` of at least 32 characters. Optional provider URL overrides are documented in the template. Then run:

```bash
docker compose up --build
curl http://localhost:8080/api/v1/health
curl --fail http://localhost:8080/api/v1/ready
```

Compose applies all ordered migrations to the local PostgreSQL volume before starting the API and outbox worker. Use a strong local password and do not reuse development values in a public deployment. The quote endpoint depends on public Nominatim/OSRM demo services; configure a real provider/contact identifier before use and do not treat these endpoints as production infrastructure.

### Container deployment

See [the local deployment guide](docs/local-deployment.md) for the development Compose stack and [the production deployment template](docs/production-deployment.md) for a single-domain HTTPS setup using Caddy, same-origin API proxying, loopback-only app ports, and persistent PostgreSQL storage. The production template is not a live deployment; a domain, VPS, secret generation, and provider agreement are still required.

### UI libraries and attribution

The design is original and may incorporate licensed open-source components selectively. Review each upstream package's license and retain its notices before copying or vendoring code. Reference libraries include [React Bits](https://github.com/DavidHDev/react-bits), [Magic UI](https://github.com/magicuidesign/magicui), [Radix UI](https://www.radix-ui.com/), [Motion](https://motion.dev/) and [Lucide](https://lucide.dev/). No third-party proprietary ride-hailing source or branding is copied.

## Original C++17 terminal simulation (legacy DSA component)

The following sections document the original academic command-line simulation. Its local-file persistence and synchronous/manual workflows are separate from the RideForge full-stack API, PostgreSQL database, and web application described above.


Smart Bike Taxi Platform is an interactive terminal application that demonstrates how core DSA concepts can support a simplified ride-hailing workflow. It uses a small, illustrative Noida road network and lets users register riders and drivers, request and cancel rides, dispatch requests, estimate fares, and review ride history.

> The C++ console application is an academic simulation. The separate web/API stack supports persisted passenger bookings, protected driver acceptance/lifecycle operations, browser-geolocation-based driver availability, and admin driver approval. Live ride-status events and an active-trip driver-location marker are supported; real payments, verified driver identity, and real safety operations are not available.

## Workflow

```mermaid
flowchart TD
    A[Launch] --> B[Load saved state]
    B --> C[Register rider / driver]
    C --> D[Create ride request]
    D --> E[Validate rider and route]
    E --> F[Append request to FIFO queue]
    F --> G[Dispatch next request]
    G --> H{Eligible driver available?}
    H -- No --> I[Keep request pending]
    I --> G
    H -- Yes --> J[Choose shortest route to pickup]
    J --> K[Calculate trip route with Dijkstra]
    K --> L[Estimate fare and record ride]
    L --> M[Simulate trip completion]
    M --> N[Save state]
    N --> O[Ride history / next action]
    O --> N
```

## Features

| Feature | Description |
| --- | --- |
| Road network | Weighted, undirected graph with sample Noida locations |
| Route planning | Dijkstra shortest path with route reconstruction |
| Rider and driver records | Custom linear-probing hash table |
| Request management | FIFO queue, pending count, and cancellation by request ID |
| Driver matching | Min-priority queue selects the available driver with the shortest route to pickup |
| Driver controls | List drivers and toggle availability |
| Ride lifecycle | Assigned → in progress → completed; driver is released only on completion |
| Fare estimate | Sample formula: ₹20 base + ₹10 per km |
| Ride history | Lists all recorded rides and their current status |
| Persistence | Saves riders, drivers, pending requests, history, and ID counters to a local file |
| Automated checks | GitHub Actions compiles the app and tests with warnings treated as errors |

## DSA concepts

| Use case | Implementation | Complexity |
| --- | --- | --- |
| Road network | Adjacency list | O(V + E) space |
| Shortest path | Dijkstra with binary heap | O((V + E) log V) |
| Record lookup | Linear-probing hash table | Average O(1), worst O(n) |
| Request order | FIFO queue | O(1) enqueue/dequeue |
| Driver candidate selection | Min-heap | O(log D) per insertion/removal |

V = locations, E = roads, D = eligible drivers. Hash table performance depends on load factor and collisions.

## Project structure

```text
.
├── .github/workflows/cpp.yml  # GCC, Clang, and sanitizer CI
├── CMakeLists.txt             # Portable build and CTest configuration
├── graph/Graph.h              # Graph and Dijkstra
├── models/Models.h            # Rider, driver, request, ride models
├── storage/Storage.h          # Versioned local save/load
├── structures/HashTable.h     # Linear-probing hash table
├── main.cpp                   # Interactive application
├── tests.cpp                  # Unit and persistence tests
└── README.md
```

## Requirements

- C++17-compatible compiler (g++ recommended)
- Terminal / PowerShell

## Build and run

Run from the repository root. CMake is the recommended cross-platform build path.

**CMake (Windows, Linux, macOS)**

```bash
cmake -S . -B build
cmake --build build --parallel
```

Run the generated `smart_bike_taxi` (or `smart_bike_taxi.exe` on Windows) from the build directory. The application stores its data in the current working directory.

**Windows (MinGW / PowerShell, direct compiler)**

```powershell
g++ -std=c++17 -Wall -Wextra -Wpedantic main.cpp -o smart_bike_taxi.exe
.\smart_bike_taxi.exe
```

**Linux / macOS (direct compiler)**

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic main.cpp -o smart_bike_taxi
./smart_bike_taxi
```

### Menu

| Option | Action |
| ---: | --- |
| 1 | Show locations |
| 2 | Register rider |
| 3 | Register driver |
| 4 | Request a ride |
| 5 | Dispatch next request |
| 6 | Show ride history |
| 7 | Show pending request count |
| 8 | Cancel a pending request |
| 9 | Show drivers |
| 10 | Toggle driver availability |
| 11 | Start an assigned ride |
| 12 | Complete an in-progress ride |
| 0 | Exit |

Enter location names exactly as listed by **Show locations**.

## Run tests

**Windows**

```powershell
g++ -std=c++17 -Wall -Wextra -Wpedantic tests.cpp -o tests.exe
.\tests.exe
```

**Linux / macOS**

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic tests.cpp -o tests
./tests
```

Tests cover graph and hash-table behavior, invalid road weights, persistence save/load, malformed-file rejection without partial mutation, driver dispatch selection, ride lifecycle transitions, and rejection of zero-length ride requests. GitHub Actions builds with GCC and Clang and runs the tests; a separate job enables AddressSanitizer and UndefinedBehaviorSanitizer. Run locally with `cmake -S . -B build`, `cmake --build build --parallel`, then `ctest --test-dir build --output-on-failure`.

## Local data

The application writes `smart_bike_taxi_data.txt` in the current working directory and saves after each menu action. Keep this file in the same directory when restarting the application to restore the demo state.

- The file is local, plain-text demo storage—not encrypted or suitable for sensitive personal information.
- Do not enter real phone numbers or other private information.
- The file is excluded from Git by `.gitignore`.
- The save format is versioned; incompatible or malformed data causes startup to stop with an error rather than silently overwrite it.

## Sample map and fare

The built-in map includes JIIT 128, Sector 62, Botanical Garden, Noida City Centre, and Sector 18. Distances are illustrative values defined in the source, not official road distances.

Fare estimate = ₹20 + (shortest trip distance in km × ₹10). This is a demonstration formula, not a real-world fare quote.

## Legacy terminal simulation limitations

- Dispatch, ride start, and trip completion are synchronous simulations; the operator manually advances ride states.
- No live GPS, map provider, traffic data, OTP, authentication, database server, payment gateway, or buyer/operator network is connected.
- The local data file is intended for a single-user demo and has no concurrent-write protection.
- The custom hash table has a fixed capacity of 101 records per table; when full, new records are rejected.
- Saves write a temporary snapshot and retain the previous snapshot as a backup during replacement; sudden power loss and filesystem-specific rename behavior can still affect recovery.

## Legacy simulation extension ideas

Possible extensions include a configurable map, a larger/resizing hash table, broader dispatch/cancellation integration tests, cancellation of already-assigned rides, and a real backend. Production use would also require authentication, privacy controls, secure storage, operational monitoring, and real service integrations.

---

<div align="center">

Built as a C++17 DSA academic project.

**[View repository](https://github.com/kaustubhdua/Smart_bike_taxi_platform)**

</div>


PostgreSQL recovery helpers: `backend/scripts/backup.sh` and `backend/scripts/restore.sh`. Read the [operations runbook](docs/OPERATIONS_RUNBOOK.md#backup-and-restore) before use. CI configuration includes a disposable-database restore smoke test; this does not replace scheduled encrypted production backups.
