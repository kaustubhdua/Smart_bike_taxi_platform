# Local full-stack deployment

This guide starts the passenger web app, C++ API, and PostgreSQL database with Docker Compose. It is for local development and portfolio demonstrations, not an internet-facing production deployment.

## Prerequisites

- Docker Engine with the Compose v2 plugin
- A network connection for image builds and the configured geocoding/routing provider

## Configure and start

```sh
cp .env.example .env
```

Edit `.env` and set:
- A unique, strong local `POSTGRES_PASSWORD`; use the same password in `DATABASE_URL`.
- A contact-bearing `SAARTHI_USER_AGENT` that complies with the provider's usage policy.
- A random `SAARTHI_JWT_SECRET` with at least 32 characters.

Then run:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
curl --fail http://localhost:8080/api/v1/health
curl --fail http://localhost:5173/healthz
```

Open the passenger web app at http://localhost:5173. The API listens on http://localhost:8080. PostgreSQL is intentionally not published to the host; containers connect over the Compose network. The migration service runs before the API, and the web service waits for the API health check.

To inspect service logs:

```sh
docker compose logs --tail=200 api web migrate
```

To stop the stack while preserving local database data:

```sh
docker compose down
```

To also delete the local database volume (destructive):

```sh
docker compose down --volumes
```

## Important operational limits

- Public Nominatim and OSRM demo endpoints are evaluation dependencies, not a production SLA. Configure an approved provider before any public demonstration with real users.
- The default web build points to `http://localhost:8080`; configure the frontend build argument and API allowed origin together for another hostname.
- Do not expose the API or use the example environment values on the public internet without TLS termination, production secrets, restricted network policy, backups, monitoring, and rate limiting shared across API replicas.
- Container-image builds and CI smoke tests do not prove a live deployment is available. Verify the deployed URL, health checks, database restore procedure, and exact release SHA separately.
