# Render deployment for RideForge

This guide describes a free-tier evaluation deployment. It is not a production SLA: Render free web services sleep when idle, and the combined API/worker service therefore pauses dispatch and outbox delivery while asleep. Use an always-on paid service and separate worker processes for a real operating service; obtain explicit budget approval first.

## Services

- Static site: build from `web/` with `npm ci && npm run build`, publish `web/dist`.
- API web service: Docker runtime, build context the repository root (`.`), Dockerfile `backend/Dockerfile`, startup command `/usr/local/bin/rideforge_render_entrypoint`.
- The API container supervises the C++ HTTP API, durable dispatch worker and outbox worker. If any child exits, the supervisor terminates siblings and exits nonzero so Render restarts the service. This combined process layout is only a demo compromise; Render recommends separate services, and its free web service sleeps after 15 minutes without inbound traffic.
- The entrypoint runs the versioned database migration runner before starting the workers/API. It requires two separate connection strings.

## Required secrets and configuration

Set these as protected Render environment variables; never commit them:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Private runtime connection using the `rideforge_app` role. This role is non-superuser, has required table DML/sequence rights, and BYPASSRLS because API-level ownership checks are authoritative. |
| `MIGRATION_DATABASE_URL` | Private migration-owner connection. Used only by the startup migration runner. Do not use this for normal API requests. |
| `RIDEFORGE_JWT_SECRET` | Independent random secret, at least 32 bytes. |
| `RIDEFORGE_USER_AGENT` | Contact-bearing identifier for the geocoding provider. |
| `RIDEFORGE_ALLOWED_ORIGINS` | Exact HTTPS origins for passenger and driver frontends; comma-separated, no wildcard. |
| `RIDEFORGE_GEOCODING_URL`, `RIDEFORGE_ROUTING_URL` | Contracted or self-hosted providers for public use. Public demo endpoints are evaluation-only. |
| `RIDEFORGE_DISPATCH_RADIUS_KM` | Integer 1–100; default 20. |

For Supabase, open the project's **Connect** dialog and copy the actual **Session pooler** host and port. Do not construct the hostname from the region: Supabase can assign different pooler cluster indexes. Session mode uses port 5432 and supports long-lived connection features such as PostgreSQL LISTEN/NOTIFY; transaction mode (6543) does not. The shared pooler username is `rideforge_app.PROJECT_REF` for the runtime role and `postgres.PROJECT_REF` for the migration owner. Use SSL mode `require` and percent-encode reserved characters in passwords.

Set a password for `rideforge_app` in the Supabase SQL editor using your own generated secret, then store the resulting runtime connection string only in Render's encrypted environment variables. Use the project owner password only in `MIGRATION_DATABASE_URL`. Rotate credentials if they have ever been pasted into chat, source control or logs.

## Frontend build

Set `VITE_API_BASE_URL` at build time to the API's HTTPS URL. The API's `RIDEFORGE_ALLOWED_ORIGINS` must include the exact static-site origin and the driver hostname/origin if a separate driver domain is configured. Rebuild the static site after changing this variable.

## Verification gates

1. Confirm Render's image build succeeds on the exact reviewed Git SHA.
2. Confirm API `/api/v1/health` and `/api/v1/ready` both return success.
3. Verify passenger registration/login, real provider route quote, booking, SSE updates, cancellation and history.
4. Verify driver approval, going online, fresh location, offer delivery, acceptance, decline, 45-second expiry and redispatch.
5. Verify admin provisioning, audit history and support-report triage.
6. Verify all workers remain alive, restart on failure, and shut down cleanly.
7. Verify a real backup and restore drill, alerting, privacy/deletion controls and load/reconnect tests.

Do not insert synthetic rides, drivers, payments, identity checks or support outcomes to make a demo appear operational. The project does not implement real payments, verified driver/vehicle compliance, staffed emergency response or commercial legal authorization.
