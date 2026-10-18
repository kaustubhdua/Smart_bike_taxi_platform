# Saarthi API

## Implemented surface

The native C++17 HTTP service now implements:

- `GET /api/v1/health`: checks whether PostgreSQL is reachable.
- `POST /api/v1/routes/quote`: validates labels, geocodes through Nominatim, routes through OSRM, calculates a server-side demo fare, and persists a five-minute quote.
- `POST /api/v1/auth/register` and `POST /api/v1/auth/login`: passenger accounts, PBKDF2-HMAC-SHA-256 password hashes, short-lived HMAC-signed access tokens, duplicate-email handling, and per-IP authentication throttling.
- `POST /api/v1/rides`: authenticated quote consumption and ride creation in a PostgreSQL transaction, with idempotency replay/conflict handling and ride-event history.
- `GET /api/v1/rides`, `GET /api/v1/rides/{rideId}`, and `POST /api/v1/rides/{rideId}/cancel`: passenger history, ownership-scoped reads, and transactional cancellation.
- `PUT /api/v1/driver/availability`: role-checked driver profile availability/location updates.
- `GET /api/v1/admin/metrics`: role-checked database-backed operational counts.

Build with CMake after installing Boost.Beast headers, libcurl, libpq, OpenSSL, nlohmann-json, and a C++17 compiler:

```bash
cmake -S backend -B build-backend -DCMAKE_BUILD_TYPE=Release
cmake --build build-backend --parallel
```

Configure `DATABASE_URL`, `PORT`, `SAARTHI_ALLOWED_ORIGIN`, and `SAARTHI_USER_AGENT` in the deployment environment. Never commit credentials. The service defaults to port 8080 and a development origin of `http://localhost:5173`. Set a real contact identifier in the user agent before using public Nominatim services. Public Nominatim/OSRM endpoints are evaluation services, not a production SLA; production should use a contracted provider or self-hosted services.

The current demo fare is ₹20 base + ₹11/km, rounded up to a whole paise. This is a portfolio demonstration tariff, not a commercial tariff. Quote requests are limited in-process to 30 requests per minute and auth requests to 10 per minute per direct client IP; these are not distributed limiters. The CORS origin is configurable. Do not trust client-provided distance or price.

## Not yet implemented

The API is an incremental backend foundation, **not a complete ride-hailing service**. The current CI exercises account registration/login, persisted booking, idempotency replay/conflict, quote expiry rejection, health, and basic validation. Remaining gaps include a connected driver/admin web experience, trusted driver onboarding/provisioning, real-time delivery/reconnect, production-grade distributed rate limiting, API connection pooling, payment, safety operations, and production deployment. The web UI currently requests a quote but does not yet expose sign-in and ride confirmation; a quote does not create a ride.

## Database invariants

- Store currency as integer paise, never floating-point rupees.
- Normalize email before uniqueness checks.
- The partial unique index on active rides is the final guard against competing driver assignments.
- Insert booking idempotency data and the ride in one transaction. A repeated key with a different request fingerprint must conflict.
- Write lifecycle transitions to `ride_events` in the same transaction as the ride update.
- Scope passenger/driver reads by authenticated identity in SQL. UUIDs are identifiers, not authorization.
- Assignment must lock relevant rows and still rely on the partial unique index for integrity.
- Store modern password hashes, never plaintext or reversible encryption. Prefer Argon2id; PBKDF2-HMAC-SHA-256 is a fallback when dependency constraints require it.
- Use short-lived signed access tokens; verify signature, issuer, audience and expiry. Store secrets outside source control and rate-limit authentication.

## Migration and verification

Apply `migrations/001_initial_schema.sql` to a dedicated PostgreSQL database. The PostgreSQL migration workflow checks a clean migration and database invariants. The API workflow builds with warnings as errors, starts the service against PostgreSQL, and smoke-tests health, invalid quote input, and unknown routes. These tests do not call the public geocoder/router and do not establish production readiness.

Run the smoke test against a running API with `bash backend/tests/http_smoke.sh`. Production still needs a proper migration runner, backup/restore validation, least-privilege database roles, bounded connection pooling, and security/load testing.
