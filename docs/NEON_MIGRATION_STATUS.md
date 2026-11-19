# Neon backend migration foundation

**Status:** bootstrap only; not a production API or a completed backend migration.

## Provisioned resources

- Neon project: `rideforge-neon-free` (`calm-lab-22392047`)
- Branch: `main` (`br-gentle-shadow-b331trhm`)
- Database: `rideforge`, PostgreSQL 17, Singapore region
- Neon Managed Better Auth: provisioned
- Neon Function slug: `rideforgeapi`
- Function runtime: Node.js 24
- Function URL: https://br-gentle-shadow-b331trhm-rideforgeapi.compute.c-4.ap-southeast-1.aws.neon.tech/

## Current deployed behavior

- `GET /health` and `GET /api/v1/health` return a liveness response.
- `GET /ready` and `GET /api/v1/ready` deliberately return HTTP 503. The endpoint must not claim readiness until it actually verifies database connectivity and the application routes exist.
- CORS only reflects the production Vercel origin and localhost development origin. Add any future preview origin explicitly.
- No database adapter or authentication middleware is included in this bootstrap.

## Migration blockers

1. Implement a PostgreSQL adapter using the Neon Function runtime's injected `DATABASE_URL`; never ship privileged connection strings to the browser.
2. Verify Neon Managed Better Auth JWTs against the branch JWKS and issuer. Resolve the authenticated subject to an application account on the server. Do not create a trigger on the managed `neon_auth` schema; Neon controls those tables.
3. Port the complete existing API contract from `supabase/functions/rideforge-api/index.ts` and preserve response shapes expected by `web/src`.
4. Replace every Supabase RPC/table/Auth/Realtime dependency with Neon-backed equivalents. Preserve transaction semantics, idempotency, ride state transitions, atomic offer acceptance/decline, role checks, and participant-level authorization.
5. Add integration tests against a disposable Neon branch, including concurrent offer acceptance, duplicate booking, expired quotes, unauthorized cross-account reads, and recovery/replay.
6. Add authenticated SSE or WebSocket updates with REST resynchronization. Liveness alone is not readiness.
7. Configure storage and notifications only after provider quotas, privacy, retention and costs are reviewed.
8. Deploy the frontend only after exact-head CI and hosted passenger/driver/admin journeys pass.

## Production safety

The existing production frontend still points to the Supabase Edge Function. This function is not a replacement and must not receive production traffic yet. Do not remove or modify the existing Supabase production backend until a tested cutover and rollback plan exists.

## Free-tier boundary

Neon Functions and the Neon Free database can support development and a constrained MVP within published quotas. Free tiers are quota-limited and are not an unlimited commercial hosting commitment. Monitor compute, storage, invocation and egress usage before any public traffic.
