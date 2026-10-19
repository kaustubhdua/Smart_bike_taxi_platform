# Local deployment guide

This guide runs the RideForge portfolio MVP locally with Docker Compose. It is a controlled demo environment, not a commercial ride-hailing deployment.

## Prerequisites

- Docker Engine and Docker Compose v2
- A modern browser
- Network access to the configured geocoding and road-routing providers, unless local mocks/provider endpoints are configured

## Configure secrets

```sh
cp .env.example .env
```

Edit `.env` and set:
- A strong, unique `POSTGRES_PASSWORD`; keep the password in `DATABASE_URL` consistent. If it contains URL-reserved characters such as `@`, `:`, `/`, or `#`, percent-encode the password component in `DATABASE_URL` while keeping `POSTGRES_PASSWORD` unchanged.
- A random `RIDEFORGE_JWT_SECRET` of at least 32 characters.
- A contact-bearing `RIDEFORGE_USER_AGENT` for geocoding-provider policy compliance.
- The appropriate provider URLs for your environment.

Never commit `.env`, real credentials, or real passenger/driver data.

## Start the stack

```sh
docker compose config
docker compose up --build -d
docker compose ps
```

Compose starts PostgreSQL, applies ordered migrations, starts the API and outbox worker, then starts the web container after API readiness.

## Verify readiness

```sh
curl --fail --show-error http://localhost:8080/api/v1/health
curl --fail --show-error http://localhost:8080/api/v1/ready
```

- `/api/v1/health` checks database connectivity.
- `/api/v1/ready` also checks the required account, ride, outbox, and migration-ledger tables.
- Open the web app at http://localhost:5173.

If readiness fails, inspect the API, migration and database logs before retrying:

```sh
docker compose logs --tail=200 api migrate db outbox-worker
```

## Bootstrap the local administrator

Follow the single supported procedure in [the operations runbook](OPERATIONS_RUNBOOK.md#bootstrap-the-first-local-administrator). Then sign in to the admin workspace and provision a driver. New drivers are unapproved and offline until an administrator explicitly approves them.

## Exercise a demo ride

1. Register a passenger account in the web app.
2. Request a quote using real addresses served by the configured routing/geocoding provider.
3. Confirm the booking only after the API returns a persisted ride.
4. Sign in as an approved driver, allow location access, and go online near the pickup.
5. Accept the request and advance the ride through arrival, in-progress and completion states.
6. Refresh the passenger page and verify the ride state recovers from the API; use ride history to inspect persisted records.

The public Nominatim and OSRM endpoints are evaluation defaults, not a production SLA. A demo driver is not identity/vehicle verified, and this environment does not implement real payments, commercial safety response, or legal transport authorization.

## Stop and preserve local data

```sh
docker compose down
```

The named PostgreSQL volume is preserved. To deliberately destroy local demo data, use `docker compose down --volumes` only after confirming that you no longer need it.

For backup/restore guidance and release blockers, see [the operations runbook](OPERATIONS_RUNBOOK.md).
