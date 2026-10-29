# Self-hosted HTTPS deployment (template)

This is a reproducible two-host deployment template for a Linux VPS with Docker Engine/Compose v2 and a domain name. It is not a claim that RideForge is already deployed or commercially ready. Do not process real passenger data or real payments until the remaining privacy, safety, legal, provider, and operational gates are completed.

## Topology

~~~text
Internet
  Passenger HTTPS host + Driver HTTPS host
        |
      Caddy (automatic TLS for both hosts, persistent certificate storage)
        |
      Nginx web container :8080 (selects driver workspace by hostname)
        |-- static React app
        `-- /api/* proxy, SSE buffering disabled
                |
             C++ API :8080 ---- PostgreSQL (private Compose network)
                |
             outbox worker
             dispatch worker (durable 45-second offers + expiry/redispatch)
~~~

The Caddy edge is built from upstream Caddy v2.11.7 source with Go 1.26.10 and golang.org/x/net 0.60.0 to address the currently fixed scanner findings; CI scans the API, web, and Caddy images for fixed CRITICAL/HIGH vulnerabilities. The API and web ports are bound to host loopback for local diagnostics. The public entry point is Caddy only. The web bundle uses a relative API path in this overlay, so browser requests remain same-origin and Nginx proxies them to the API. The PostgreSQL port is never published.

## 1. Prepare the host and DNS

1. Use a supported Linux distribution, install Docker Engine and the Docker Compose plugin, and keep the host patched.
2. Point both the passenger host (RIDEFORGE_DOMAIN) and driver host (RIDEFORGE_DRIVER_DOMAIN) A/AAAA records to the VPS. Ensure inbound TCP 80/443 and UDP 443 (optional HTTP/3) are allowed. Both hosts serve the same built frontend; the driver hostname renders the driver-only workspace, while both use the same API and PostgreSQL records. The admin sign-in workspace is available at `/admin` on the passenger host and requires a separately provisioned admin account.
3. Clone the repository at the reviewed release commit. Do not deploy a moving feature branch as a release.

## 2. Configure secrets and providers

~~~sh
cp .env.production.example .env
chmod 600 .env
openssl rand -hex 32
openssl rand -hex 32
~~~

Generate two independent values. Set POSTGRES_PASSWORD to the first value, use that exact same value in DATABASE_URL, and set RIDEFORGE_JWT_SECRET to the second. Set RIDEFORGE_DOMAIN and RIDEFORGE_DRIVER_DOMAIN to the two real DNS hostnames. Set RIDEFORGE_PUBLIC_ORIGIN to the passenger origin (including https://), and set RIDEFORGE_ALLOWED_ORIGINS to the comma-separated exact HTTPS origins for both hosts. The API matches origins exactly; do not use wildcard origins. Set a real contact identifier in RIDEFORGE_USER_AGENT.

The `.env.production.example` uses reserved nonfunctional `.example` provider URLs intentionally. Replace them with contracted or self-hosted services for both the backend and browser build before deployment. Public Nominatim/OSRM demo endpoints do not provide commercial capacity or an uptime agreement. Keep the `.env` file out of Git and restrict host access.

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
curl --fail --show-error https://your-passenger-domain.example/healthz
curl --fail --show-error https://your-driver-domain.example/healthz
curl --fail --show-error https://your-passenger-domain.example/api/v1/health
curl --fail --show-error https://your-passenger-domain.example/api/v1/ready
~~~

Use the real domain in those commands. Complete the passenger-to-driver demo journey and save screenshots and the exact Git SHA separately as release evidence.

## 4. Admin bootstrap and recovery

Use the reviewed admin bootstrap procedure in the operations runbook. The database port is not published, so create backups through the Compose database container rather than running the host backup script with a DATABASE_URL containing the internal hostname db.

~~~sh
set -eu
umask 077
mkdir -p ./secure-backups
backup="./secure-backups/rideforge-$(date -u +%Y%m%dT%H%M%SZ).dump"
temporary="$backup.tmp"
docker compose -f compose.yaml -f compose.production.yaml exec -T db pg_dump -U rideforge -d rideforge --format=custom --no-owner --no-acl > "$temporary"
test -s "$temporary"
mv "$temporary" "$backup"
~~~

For a restore drill, restore only into a dedicated empty database and verify it before dropping the temporary target:

~~~sh
docker compose -f compose.yaml -f compose.production.yaml exec -T db createdb -U rideforge rideforge_restore
docker compose -f compose.yaml -f compose.production.yaml exec -T db pg_restore --no-owner --no-acl --exit-on-error --dbname=rideforge_restore < "$backup"
docker compose -f compose.yaml -f compose.production.yaml exec -T db psql -U rideforge -d rideforge_restore -X -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('public.accounts') IS NOT NULL AND to_regclass('public.rides') IS NOT NULL;"
docker compose -f compose.yaml -f compose.production.yaml exec -T db dropdb -U rideforge rideforge_restore
~~~

Keep encrypted backups outside the repository and host, define retention/deletion, and rehearse restoration regularly. Never use docker compose down -v on the production stack unless you intend to delete the database volume. Prefer tested host backups or a managed PostgreSQL service for production recovery requirements.

## 5. Release gates not solved by deployment

- Run all CI workflows against the exact release SHA and archive their evidence.
- Replace public demo geocoding/routing with a contracted/self-hosted provider and verify its terms, quotas, and latency.
- Complete WCAG 2.2 AA review, real web-vitals, load/contention tests, SSE reconnect/load tests, monitoring and alerts.
- Implement shared rate limiting, database connection pooling, secret rotation, incident response, privacy/retention/deletion, driver/vehicle verification, payment/refund handling if applicable, and legal assessment for the operating state.
- Do not represent demo payments, support reports, or emergency/safety actions as real services.

The template supplies HTTPS termination for both configured hosts and a same-origin routing path for each; it does not turn the portfolio MVP into an authorized commercial ride-hailing operation.
