# Saarthi API

## Implemented surface

The native C++17 HTTP service now implements:

- `GET /api/v1/health`: checks whether PostgreSQL is reachable.
- `POST /api/v1/routes/quote`: validates labels, geocodes through Nominatim, routes through OSRM, calculates a server-side demo fare, and persists a five-minute quote.
- `POST /api/v1/auth/register` and `POST /api/v1/auth/login`: passenger accounts, PBKDF2-HMAC-SHA-256 password hashes, short-lived HMAC-signed access tokens, duplicate-email handling, and per-IP authentication throttling.
- `POST /api/v1/rides`: authenticated quote consumption and ride creation in a PostgreSQL transaction, with idempotency replay/conflict handling and ride-event history.
- `GET /api/v1/rides`, `GET /api/v1/rides/{rideId}`, and `POST /api/v1/rides/{rideId}/cancel`: passenger history, ownership-scoped reads, and transactional cancellation.
- `PUT /api/v1/driver/availability`: role-checked availability/location updates; only profiles explicitly approved by an administrator can go online.
- Driver queue visibility is restricted to approved drivers who are online with a location updated in the last five minutes. Acceptance rechecks eligibility inside the database transaction.
- `POST /api/v1/driver/rides/{rideId}/accept` and `PUT /api/v1/driver/rides/{rideId}/status`: transactional driver acceptance, conflict-safe assignment, lifecycle transitions, and event records.
- `GET /api/v1/admin/metrics`: role-checked database-backed operational counts.

Build with CMake after installing Boost.Beast headers, libcurl, libpq, OpenSSL, nlohmann-json, and a C++17 compiler:

```bash
cmake -S backend -B build-backend -DCMAKE_BUILD_TYPE=Release
cmake --build build-backend --parallel
```

Configure `DATABASE_URL`, `PORT`, `SAARTHI_ALLOWED_ORIGIN`, and `SAARTHI_USER_AGENT` in the deployment environment. `SAARTHI_GEOCODING_URL` and `SAARTHI_ROUTING_URL` can point to compatible providers; their defaults target Nominatim and OSRM. Keep the base URLs free of trailing slashes. CI injects deterministic local mock providers so quote behavior is tested without network calls. Never commit credentials. The service defaults to port 8080 and a development origin of `http://localhost:5173`. Set a real contact identifier in the user agent before using public Nominatim services. Public Nominatim/OSRM endpoints are evaluation services, not a production SLA; production should use a contracted provider or self-hosted services.

The current demo fare is ₹20 base + ₹11/km, rounded up to a whole paise. This is a portfolio demonstration tariff, not a commercial tariff. Quote requests are limited in-process to 30 requests per minute and auth requests to 10 per minute per direct client IP; these are not distributed limiters. The CORS origin is configurable. Do not trust client-provided distance or price.

## Not yet implemented

The API is an incremental backend foundation, **not a complete ride-hailing service**. The current CI exercises account registration/login, persisted booking, idempotency replay/conflict, quote expiry rejection, health, and basic validation. Remaining gaps include a self-service/admin driver onboarding UI (approval is currently an explicit database provisioning operation), a worker that publishes the durable ride-event outbox, push-based real-time delivery/reconnect, production-grade distributed rate limiting, API connection pooling, payment, safety operations, and production deployment. The passenger UI supports sign-in and ride confirmation; the driver/admin workspaces call the protected queue, lifecycle, availability and metrics endpoints. A quote does not create a ride.

## Database invariants

- Store currency as integer paise, never floating-point rupees.
- Normalize email before uniqueness checks.
- The partial unique index on active rides is the final guard against competing driver assignments.
- Insert booking idempotency data and the ride in one transaction. A repeated key with a different request fingerprint must conflict.
- Write lifecycle transitions to `ride_events` in the same transaction as the ride update.
- Scope passenger/driver reads by authenticated identity in SQL. UUIDs are identifiers, not authorization.
- Assignment must lock relevant rows and still rely on the partial unique index for integrity.
- A driver profile starts unapproved; never set `is_approved=true` based on a self-selected frontend role. Approval must be an explicit trusted operator action. `approved_by` and `approved_at` are available for recording that decision.
- Ride-event inserts automatically create durable `ride_event_outbox` rows in the same database transaction. The outbox is a foundation only; no publisher worker is shipped yet.
- Store modern password hashes, never plaintext or reversible encryption. Prefer Argon2id; PBKDF2-HMAC-SHA-256 is a fallback when dependency constraints require it.
- Use short-lived signed access tokens; verify signature, issuer, audience and expiry. Store secrets outside source control and rate-limit authentication.

## Migration and verification

Apply every ordered `migrations/*.sql` file to a dedicated PostgreSQL database with `sh backend/scripts/migrate-if-needed.sh` and `SAARTHI_MIGRATIONS_DIR=backend/migrations`. Migration versions are recorded in `schema_migrations` in the same transaction as each migration. Compose skips applied versions and fails closed when it finds an existing unversioned schema rather than guessing. PostgreSQL CI checks clean migration, repeatability, driver approval and outbox invariants. API CI builds with warnings as errors and tests HTTP body limits, authentication/booking status codes, successful persisted quotes, malformed geocoder output, missing locations, unreachable routes, provider failure handling, booking idempotency and concurrent driver assignment using deterministic local mock providers. These are contract/smoke tests, not production load or provider SLA verification.

Run the smoke test against a running API with `bash backend/tests/http_smoke.sh`. Production still needs a proper migration runner, backup/restore validation, least-privilege database roles, bounded connection pooling, and security/load testing.
