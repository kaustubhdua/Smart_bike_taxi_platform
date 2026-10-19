# RideForge security model and review checklist

## Scope

RideForge is a portfolio MVP, not an authorized commercial transport service. This document describes the implemented controls and the remaining gaps; it is not a certification or penetration-test report.

## Assets

- Account credentials, short-lived access tokens, passenger/driver identities.
- Pickup/drop-off addresses, coordinates and trip history.
- Driver availability and last reported location.
- Quotes, ride assignments, fares and ride-event history.
- Database credentials, token-signing secret, provider configuration and deployment secrets.

## Trust boundaries

1. Browser to HTTP API: all browser fields are untrusted. Validate type, length, range and state on the server.
2. API to PostgreSQL: use parameterized SQL and transactionally commit ride state, history and outbox records.
3. API to routing/geocoding providers: provider responses are untrusted and may fail, time out or return invalid coordinates/metrics.
4. Admin operations: only an authenticated admin token may provision, approve or suspend driver profiles.
5. Driver dispatch: only explicitly approved profiles with a fresh online location may see the queue or accept a ride.

## Implemented controls

- Passenger registration does not accept a role field; newly registered accounts are passengers.
- Passwords are stored as PBKDF2-HMAC-SHA-256 hashes with random salts and 600,000 iterations. The security module has bounded verification parameters and constant-time digest comparison.
- Access tokens are HMAC-signed, short-lived, and checked for algorithm, issuer, audience and expiry.
- Passenger ride reads are scoped to the authenticated passenger; driver actions are scoped to the assigned driver; admin routes check the admin role.
- Ride creation, idempotency reservation, quote consumption and ride-event insertion occur in a database transaction.
- A partial unique index prevents one driver from having multiple active rides.
- Admin driver provisioning, approval and suspension are transactionally audited.
- Driver profiles default to unapproved; suspension forces the driver offline.
- The API bounds request bodies/headers, applies socket timeouts and rate-limits auth/quote requests in-process.
- Ride-event insertion automatically creates a durable outbox row in the same transaction.

## Important limitations

- Tokens remain valid until expiry; there is no general token revocation/session registry yet.
- In-process rate limits do not coordinate across multiple API replicas and are not a substitute for edge/WAF limits.
- There is no shared PostgreSQL connection pool, production monitoring or verified restore drill yet. The API has an authenticated SSE stream backed by PostgreSQL NOTIFY and persisted-event replay, but it has not been load-tested and driver/admin push subscriptions are not implemented. NOTIFY alone is not a durable client-delivery guarantee; REST resynchronization remains necessary.
- Driver approval is an administrative workflow, not identity, licence, insurance or vehicle-document verification.
- Location updates are user-submitted and freshness-checked, not proof of real GPS provenance.
- Public routing/geocoding endpoints are for development/evaluation only.
- No payment processing, refunds, safety dispatch or emergency-service integration is implemented.

## Release review

- [ ] Rotate all deployment secrets; never use example values in public environments.
- [ ] Serve the API only over HTTPS behind a correctly configured reverse proxy.
- [ ] Use least-privilege database roles and a restricted network path to PostgreSQL.
- [ ] Add shared rate limits, connection pooling, request IDs and redacted structured logs.
- [ ] Test BOLA/IDOR across passenger, driver and admin identities.
- [ ] Test stale, revoked, malformed and wrong-role tokens.
- [ ] Test duplicate/out-of-order requests, cancellation races and competing assignments.
- [ ] Review CORS, security headers, body/header limits and provider timeout behavior.
- [ ] Define data retention/deletion for trip and location data; redact precise coordinates from logs.
- [ ] Verify dependency/container scans, backups and restore procedures.
- [ ] Assess applicable privacy and transport obligations before processing real customer data or operating real rides.

## Incident handling

1. Disable affected credentials and rotate secrets if compromise is suspected.
2. Preserve redacted request IDs, audit events and database timestamps; do not copy raw tokens into an incident ticket.
3. Stop driver availability or bookings if assignment integrity is uncertain.
4. Restore service only after verifying database consistency and the root cause.
5. Document the incident, customer impact, containment and follow-up tests.


## Driver location minimization

The API stores only the latest driver coordinates while the driver is online. Going offline clears latitude, longitude, and the last-location timestamp; the web client sends no coordinates in the offline request and stops geolocation watching on logout/offline. The current portfolio MVP does not keep a historical GPS trail. A production deployment still needs a documented account-data retention/deletion schedule and privacy review.
