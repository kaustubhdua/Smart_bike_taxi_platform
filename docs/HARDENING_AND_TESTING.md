# Hardening and adversarial testing

This change adds adversarial tests against a real PostgreSQL + API stack, fixes three defects they found, and hardens provider and request handling. CI runs everything after the HTTP smoke test (`.github/workflows/backend.yml`).

## Suites

| Suite | Tests | What it proves |
| --- | --- | --- |
| `provider_guard_test.cpp`, `request_guard_test.cpp` (ctest) | unit | Circuit breaker, concurrency limiter, pacing gate, route/label validation, trusted-proxy parsing, IPv6 /64 keys, login throttle |
| `authz_matrix_test.py` | 20 | Forged/tampered/expired tokens, role matrix over every protected endpoint, cross-account access, revocation, malformed IDs, 4xx-not-5xx; fails if a protected OpenAPI operation is not covered |
| `concurrency_test.py` | 13 | Double accept, accept vs cancel, one driver/two rides, concurrent status/cancel, expired-offer acceptance, accept-vs-expiry race, expired-offer redispatch, idempotency-key race, quote reuse, expired quote |
| `outbox_events_test.py` | 13 | Event/outbox atomicity and rollback, lease recovery, backoff, dead letters, SSE replay order, `Last-Event-ID`, late older events, no duplicates |
| `abuse_controls_test.py` | 19 | Trusted proxies, IPv6 limits, account lockout, timing equality, breaker, concurrency bound, content-type, oversized bodies, label sanitising, Nominatim pacing, startup validation |

Run locally: build, `ctest`, start a fresh database, run `backend/tests/http_smoke.sh` first, then `python3 -I backend/tests/<suite>_test.py` with `RIDEFORGE_TEST_BASE_URL` and `RIDEFORGE_API_BIN` set.

## Defects found and fixed

1. A non-UUID `quoteId` returned 503; it now returns 422.
2. SSE could permanently drop an older event published after a newer one. Notifications are now only a wake-up hint and the stream replays from `ride_events`.
3. Cancelling a ride left a live `offered` offer; it is now superseded in the same transaction.

## Token model

Bearer JWTs (HS256) live 15 minutes. Each request re-checks that the account is active and its role is unchanged (cached up to ~5 s; fails closed if the lookup fails), so deactivation and role changes take effect within seconds.

## Design references (no third-party code copied)

Only standards and published guidance informed the design: OWASP API Security 2023 (API1, API4), PostgreSQL NOTIFY, WHATWG Server-Sent Events, MDN X-Forwarded-For, the transactional-outbox and circuit-breaker patterns, and the OSM Nominatim usage policy. No code was copied from any project.

## Still open

Distributed (cross-replica) rate limits, least-privilege database roles, full SQLSTATE-mapping review, ETA-based driver ranking, payments and earnings ledger, load/stress tests, and a geocode cache. Limits and breakers are per-process.
