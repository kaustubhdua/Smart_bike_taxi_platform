# Self-hosted HTTPS deployment (template)

This is a reproducible single-domain deployment template for a Linux VPS with Docker Engine/Compose v2 and a domain name. It is not a claim that RideForge is already deployed or commercially ready. Do not process real passenger data or real payments until the remaining privacy, safety, legal, provider, and operational gates are completed.

## Topology

~~~text
Internet
  HTTPS :443 / HTTP :80
        |
      Caddy  (automatic TLS, persistent certificate storage)
        |
      Nginx web container :8080
        |-- static React app
        `-- /api/* proxy, SSE buffering disabled
                |
             C++ API :8080 ---- PostgreSQL (private Compose network)
                |
             outbox worker
~~~

The API and web ports are bound to host loopback for local diagnostics. The public entry point is Caddy only. The web bundle uses a relative API path in this overlay, so browser requests remain same-origin and Nginx proxies them to the API. The PostgreSQL port is never published.

## 1. Prepare the host and DNS

1. Use a supported Linux distribution, install Docker Engine and the Docker Compose plugin, and keep the host patched.
2. Point the domain's A/AAAA records to the VPS. Ensure inbound TCP 80/443 and UDP 443 (optional HTTP/3) are allowed.
3. Clone the repository at the reviewed release commit. Do not deploy a moving feature branch as a release.

## 2. Configure secrets and providers

~~~sh
cp .env.production.example .env
chmod 600 .env
openssl rand -hex 32
openssl rand -hex 32
~~~

Generate two independent values. Set POSTGRES_PASSWORD to the first value, use that exact same value in DATABASE_URL, and set RIDEFORGE_JWT_SECRET to the second. Set RIDEFORGE_DOMAIN and RIDEFORGE_PUBLIC_ORIGIN to the real domain (the origin includes https://). Set a real contact identifier in RIDEFORGE_USER_AGENT.

The sample public Nominatim/OSRM endpoints are for development/evaluation and do not provide commercial capacity or an uptime agreement. Replace them with contracted or self-hosted services before real-world use. Keep the .env file out of Git and restrict host access.

## 3. Validate and start

~~~sh
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml build
docker compose -f compose.yaml -f compose.production.yaml up -d
docker compose -f compose.yaml -f compose.production.yaml ps
~~~

Caddy obtains and renews HTTPS certificates automatically when DNS and port reachability are correct. Check logs if certificate issuance or startup fails:

~~~sh
docker compose -f compose.yaml -f compose.production.yaml logs --tail=200 caddy
docker compose -f compose.yaml -f compose.production.yaml logs --tail=200 api
docker compose -f compose.yaml -f compose.production.yaml logs --tail=200 web
~~~

Verify the deployed build from an external client:

~~~sh
curl --fail --show-error https://your-real-domain.example/healthz
curl --fail --show-error https://your-real-domain.example/api/v1/health
curl --fail --show-error https://your-real-domain.example/api/v1/ready
~~~

Use the real domain in those commands. Complete the passenger-to-driver demo journey and save screenshots and the exact Git SHA separately as release evidence.

## 4. Admin bootstrap and recovery

Use the reviewed admin bootstrap procedure in the operations runbook. Take a backup before upgrades and restore only into a dedicated empty database. Keep encrypted backups outside the repository and host, define retention/deletion, and rehearse restoration regularly.

~~~sh
set -a
. ./.env
set +a
umask 077
sh backend/scripts/backup.sh ./secure-backups/rideforge-$(date -u +%Y%m%dT%H%M%SZ).dump
~~~

Never use docker compose down -v on the production stack unless you intend to delete the database volume. Prefer tested host backups or a managed PostgreSQL service for production recovery requirements.

## 5. Release gates not solved by deployment

- Run all CI workflows against the exact release SHA and archive their evidence.
- Replace public demo geocoding/routing with a contracted/self-hosted provider and verify its terms, quotas, and latency.
- Complete WCAG 2.2 AA review, real web-vitals, load/contention tests, SSE reconnect/load tests, monitoring and alerts.
- Implement shared rate limiting, database connection pooling, secret rotation, incident response, privacy/retention/deletion, driver/vehicle verification, payment/refund handling if applicable, and legal assessment for the operating state.
- Do not represent demo payments, support reports, or emergency/safety actions as real services.

The template supplies HTTPS termination and a same-origin routing path; it does not turn the portfolio MVP into an authorized commercial ride-hailing operation.
