# RideForge API

## Implemented surface

The native C++17 HTTP service now implements:

- `GET /api/v1/health`: checks whether PostgreSQL is reachable.
- `POST /api/v1/routes/quote`: validates labels, geocodes through Nominatim, routes through OSRM, calculates a server-side demo fare, and persists a five-minute quote.
- `POST /api/v1/auth/register` and `POST /api/v1/auth/login`: passenger accounts, PBKDF2-HMAC-SHA-256 password hashes, short-lived HMAC-signed access tokens, duplicate-email handling, and per-IP authentication throttling.
- `POST /api/v1/rides`: authenticated quote consumption and ride creation in a PostgreSQL transaction, with idempotency replay/conflict handling and ride-event history.
- `GET /api/v1/rides`, `GET /api/v1/rides/{rideId}`, and `POST /api/v1/rides/{rideId}/cancel`: passenger history, ownership-scoped reads, and transactional cancellation.
- `GET /api/v1/rides/{rideId}/events`: authenticated server-sent events scoped to a ride owner, with persisted-event replay from `Last-Event-ID`, PostgreSQL LISTEN/NOTIFY and heartbeats.
- `PUT /api/v1/driver/availability`: role-checked availability/location updates; only profiles explicitly approved by an administrator can go online.
- Driver queue visibility is restricted to approved drivers who are online with a location updated in the last five minutes. Acceptance rechecks eligibility inside the database transaction.
- `POST /api/v1/driver/rides/{rideId}/accept` and `PUT /api/v1/driver/rides/{rideId}/status`: transactional driver acceptance, conflict-safe assignment, lifecycle transitions, and event records.
- `GET /api/v1/admin/metrics`: role-checked database-backed operational counts.
- `GET /api/v1/admin/audit?limit=50`: admin-only, bounded recent audit-event history for privileged driver operations.
- `GET /api/v1/admin/audit?limit=50`: admin-only recent privileged-action audit history; `limit` is bounded to 1–100.
- `GET/POST /api/v1/admin/drivers`: list provisioned driver profiles and create driver accounts that default to unapproved; creation and approval are audited.
- `PUT /api/v1/admin/drivers/{driverId}/approval`: explicitly approve or suspend a driver; suspension forces the driver offline and is audited.

Build with CMake after installing Boost.Beast headers, libcurl, libpq, OpenSSL, nlohmann-json, and a C++17 compiler:

```bash
cmake -S backend -B build-backend -DCMAKE_BUILD_TYPE=Release
cmake --build build-backend --parallel
```

The container also includes a one-time administrator bootstrap utility. After local Compose startup, run the steps in [the operations runbook](../docs/OPERATIONS_RUNBOOK.md). The utility reads the password from standard input, refuses to overwrite an existing email, and does not expose an API endpoint for granting admin privileges.

Configure `DATABASE_URL`, `PORT`, `RIDEFORGE_ALLOWED_ORIGIN`, and `RIDEFORGE_USER_AGENT` in the deployment environment. `RIDEFORGE_GEOCODING_URL` and `RIDEFORGE_ROUTING_URL` can point to compatible providers; their defaults target Nominatim and OSRM. Keep the base URLs free of trailing slashes. CI injects deterministic local mock providers so quote behavior is tested without network calls. Never commit credentials. The service defaults to port 8080 and a development origin of `http://localhost:5173`. Set a real contact identifier in the user agent before using public Nominatim services. Public Nominatim/OSRM endpoints are evaluation services, not a production SLA; production should use a contracted provider or self-hosted services.

The current demo fare is ₹20 base + ₹11/km, rounded up to a whole paise. This is a portfolio demonstration tariff, not a commercial tariff. Quote requests are limited in-process to 30 requests per minute and auth requests to 10 per minute per direct client IP; these are not distributed limiters. The CORS origin is configurable. Do not trust client-provided distance or price.

## Not yet implemented

The API is an incremental backend foundation, **not a complete ride-hailing service**. The current CI exercises account registration/login, persisted booking, idempotency replay/conflict, quote expiry rejection, health, and basic validation. Remaining gaps include real-world identity/vehicle document verification, production scaling, richer client retry/resynchronization tests, and WebSocket support if bidirectional realtime becomes necessary, production-grade distributed rate limiting, API connection pooling, payment, safety operations, and production deployment. The passenger UI supports sign-in and ride confirmation; the driver workspace calls the protected queue, lifecycle and availability endpoints; the admin workspace can provision, approve and suspend drivers as well as view metrics. A quote does not create a ride.

## Database invariants

- Store currency as integer paise, never floating-point rupees.
- Normalize email before uniqueness checks.
- The partial unique index on active rides is the final guard against competing driver assignments.
- Insert booking idempotency data and the ride in one transaction. A repeated key with a different request fingerprint must conflict.
- Write lifecycle transitions to `ride_events` in the same transaction as the ride update.
- Scope passenger/driver reads by authenticated identity in SQL. UUIDs are identifiers, not authorization.
- Assignment must lock relevant rows and still rely on the partial unique index for integrity.
- A driver profile starts unapproved; never set `is_approved=true` based on a self-selected frontend role. Approval must be an explicit trusted operator action. `approved_by` and `approved_at` are available for recording that decision.
- Ride-event inserts automatically create durable `ride_event_outbox` rows in the same database transaction. The worker publishes to PostgreSQL NOTIFY, retries with backoff and dead-letters after repeated failures. The API exposes an authenticated SSE stream with replay from persisted ride events; clients still use REST polling as a recovery path.
- Store modern password hashes, never plaintext or reversible encryption. Prefer Argon2id; PBKDF2-HMAC-SHA-256 is a fallback when dependency constraints require it.
- Use short-lived signed access tokens; verify signature, issuer, audience and expiry. Store secrets outside source control and rate-limit authentication.

## Migration and verification

Apply every ordered `migrations/*.sql` file to a dedicated PostgreSQL database with `sh backend/scripts/migrate-if-needed.sh` and `RIDEFORGE_MIGRATIONS_DIR=backend/migrations`. Migration versions are recorded in `schema_migrations` in the same transaction as each migration. Compose skips applied versions and fails closed when it finds an existing unversioned schema rather than guessing. PostgreSQL CI checks clean migration, repeatability, driver approval and outbox invariants. API CI builds with warnings as errors and starts the outbox worker during HTTP smoke tests, then verifies successful publication and no dead-lettered healthy events. Browser tests cover consuming authenticated SSE ride-status frames. It also tests HTTP body limits, authentication/booking status codes, persisted quotes, provider failures, idempotency and concurrent driver assignment using deterministic local mocks. These are contract/smoke tests, not production load or provider SLA verification.

Run the smoke test against a running API with `bash backend/tests/http_smoke.sh`. Production still needs backup/restore validation, least-privilege database roles, bounded connection pooling, authenticated realtime delivery/recovery, and security/load testing.
