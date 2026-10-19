# RideForge operations runbook

## Status and operating boundary

The Compose setup is a local evaluation environment. It is not a production deployment and does not provide a production SLA. Do not use real passenger/driver personal data or real-money payments in the demo.

## Local startup

1. Install Docker Compose.
2. Copy `.env.example` to `.env`.
3. Set a strong local POSTGRES_PASSWORD; keep DATABASE_URL's password identical.
4. Set RIDEFORGE_JWT_SECRET to at least 32 random characters and set RIDEFORGE_USER_AGENT to a contact-bearing value.
5. Start the stack:

```sh
docker compose up --build
```

6. Check API health:

```sh
curl --fail --show-error http://localhost:8080/api/v1/health
curl --fail --show-error http://localhost:8080/api/v1/ready
```

The migration service applies all ordered SQL files in backend/migrations and exits only after pending migrations succeed. The API waits for migration completion and database readiness. The web app is exposed on port 5173 and the API on port 8080.

## Stop and inspect

```sh
docker compose ps
docker compose logs --tail=200 api
docker compose logs --tail=200 migrate
docker compose logs --tail=200 db
docker compose logs --tail=200 outbox-worker
docker compose down
```

A plain `docker compose down` preserves the named database volume. Do not remove volumes when troubleshooting unless you intend to destroy the local demo data.

## Migration behavior

- Migrations are ordered SQL files named with a stable version prefix.
- Each migration records its version inside its own transaction.
- Re-running the migration runner skips versions already recorded.
- If an accounts table exists without schema_migrations, the runner fails closed. Back up the database and deliberately baseline its schema; do not bypass the check casually.
- Before production schema changes, take a verified backup, test the migration on a copy, and prepare a rollback/recovery plan. Destructive migrations require a separate reviewed plan.

## Create the first local administrator

The public API intentionally has no endpoint that can grant an account the admin role. After the stack is running, use the one-time bootstrap utility to create the first admin. It reads the password from standard input instead of a command-line argument.

```sh
read -rsp "Initial admin password (12+ chars): " RIDEFORGE_ADMIN_PASSWORD
printf '\n'
printf '%s\n' "$RIDEFORGE_ADMIN_PASSWORD" | docker compose exec -T api /usr/local/bin/rideforge_admin_bootstrap admin@example.test "RideForge Admin"
unset RIDEFORGE_ADMIN_PASSWORD
```

Use a unique password and replace the example email. The command refuses to overwrite an existing email. Keep shell history and terminal transcripts private; for production, provision administrators through a reviewed operator process with a least-privilege database credential.

## Driver provisioning

- Admin creates a driver profile through the admin workspace.
- New profiles are unapproved and offline.
- Admin approval is recorded with actor and timestamp; suspension takes the driver offline.
- Approval in this demo is not proof of identity, licence, insurance or vehicle compliance.
- A driver must sign in and explicitly go online with a fresh location before the queue is visible.

## Provider failures

Quote requests depend on external geocoding and road-routing services. If the provider is unavailable, the API should fail the quote request rather than invent a route/fare. Check API logs and configured provider URLs, then retry only after the provider recovers. Public Nominatim/OSRM endpoints are not a production service contract.

## Database backup/restore rehearsal (local only)

A local logical backup can be created with:

```sh
docker compose exec -T db pg_dump -U rideforge -d rideforge --format=custom > rideforge-demo.dump
```

To rehearse restoration, use a separate disposable database/volume and restore there. Do not overwrite a production database as an experiment. This command is a procedure example, not evidence that a restore has been tested.

## Production launch blockers

Before any public launch, provide HTTPS, managed secrets, least-privilege database roles, connection pooling, shared rate limits, observability/alerts, backup/restore proof, SSE load/reconnect testing, driver/admin push subscriptions, and location retention/deletion, security/load testing, a contracted or self-hosted routing provider, incident response and legal/privacy review. Payments and emergency/safety operations are not implemented.


## Deployment probes

Use `GET /api/v1/health` for database connectivity and `GET /api/v1/ready` for rollout readiness. Readiness returns `503` if the database is unavailable, required account/ride/outbox/migration-ledger tables are missing, or either required migration version is absent from the ledger. The Compose API healthcheck uses readiness so the web service does not start against an incomplete schema.


## Backup and restore

Use the repository scripts only with a deliberate database target. Keep backup files outside the repository and protect them as sensitive data; a database dump contains account and ride data. Run these scripts on a trusted host with PostgreSQL client tools (`pg_dump` and `pg_restore`) installed. For local Compose, load the non-secret-placeholder settings from `.env` into the current shell first; do not commit real credentials.

```sh
set -a
. ./.env
set +a
umask 077
sh backend/scripts/backup.sh ./secure-backups/rideforge-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Restore into a **dedicated empty database** first; the restore script intentionally does not drop or clean existing objects:

```sh
DATABASE_URL="$RESTORE_DATABASE_URL" sh backend/scripts/restore.sh ./secure-backups/rideforge-backup.dump
```

After restoration, run migration/readiness checks and verify representative account, ride, event, and idempotency counts before considering a recovery successful. Store backups encrypted at rest in a separate access-controlled location, define retention/deletion, and periodically perform a timed restore drill. CI runs a disposable-database backup/restore smoke test; that is not evidence of a production backup schedule or recovery-time objective.


## Request logs and correlation

The API emits one-line JSON completion records with event name, generated request ID, HTTP method, path without query parameters, response status, elapsed milliseconds, and whether the response write succeeded. It never logs request bodies, bearer tokens, precise coordinates, passwords, or raw provider/database exception messages. Use the response `X-Request-ID` to correlate a client report with server logs. SSE requests have a separate long-lived lifecycle; broader per-connection SSE logging and operational metrics remain a release-hardening task.


## Outbox worker shutdown

The outbox worker handles `SIGTERM` and `SIGINT`, finishes the current database operation, closes its PostgreSQL connection, and emits an `outbox_worker_shutdown` JSON log record. Container orchestrators should allow a short grace period for the current transaction to finish. The API integration workflow explicitly verifies this shutdown path; it does not replace a production load/drain test.
