# Backend architecture and API contract

## Status

This directory contains the intended API contract and first PostgreSQL schema migration. **The HTTP handlers, authentication implementation and database integration are not implemented yet.** Do not treat these routes as live until server integration tests exist.

## Database invariants

- Store currency as integer paise, never floating-point rupees.
- Normalize email before uniqueness checks.
- The partial unique index on active rides is the final guard against competing driver assignments.
- Insert booking idempotency data and the ride in one transaction. A repeated key with a different request fingerprint must conflict.
- Write lifecycle transitions to ride_events in the same transaction as the ride update.
- Scope passenger/driver reads by authenticated identity in SQL. UUIDs are identifiers, not authorization.
- Assignment must lock relevant rows and still rely on the partial unique index for integrity.
- Store modern password hashes, never plaintext or reversible encryption. Prefer Argon2id; PBKDF2-HMAC-SHA-256 is a fallback when dependency constraints require it.
- Use short-lived signed access tokens; verify signature, issuer, audience and expiry. Store secrets outside source control and rate-limit authentication.

## Migration

Apply migrations/001_initial_schema.sql to a dedicated PostgreSQL database through a migration runner. Production still needs a migration runner, backup/restore validation and least-privilege database roles. The `PostgreSQL migration smoke test` workflow applies this migration to a clean PostgreSQL 16 database and checks the active-driver uniqueness guard and idempotency table. Run locally with `psql -v ON_ERROR_STOP=1 -f migrations/001_initial_schema.sql` followed by `psql -v ON_ERROR_STOP=1 -f tests/schema_smoke.sql` against a disposable database.

## Contract

openapi.yaml defines the initial API surface. It is a contract, not proof endpoints exist. API integration tests and generated/validated client types must accompany implementation.
