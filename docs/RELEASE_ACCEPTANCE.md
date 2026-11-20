# RideForge release acceptance and production gates

This document distinguishes implemented application workflows from launch prerequisites. A green CI run is not proof of a live fleet, live payment processing, regulatory approval, or operational readiness.

## Product surfaces

### Passenger
- Account registration and sign-in against the configured API.
- Pickup and destination entry, current-device location, map selection, and location suggestions.
- Server-generated road route and fare quote; integer-paise pricing and quote expiry.
- Authenticated booking request, booking idempotency, cancellation, and persisted ride status.
- Authenticated server-sent ride events with REST refresh recovery.
- Ride-start code display, safety/reporting controls, driver feedback, trip history, saved places, and printable trip records.
- Support reports with status visibility. A support report does not contact emergency services.

### Driver
- Driver self-registration and sign-in.
- Private upload of driving licence, vehicle registration certificate (RC), and insurance.
- Current application status and per-document review status.
- Explicit online/offline availability with fresh browser geolocation.
- Time-limited dispatch offers, accept/decline, ride lifecycle transitions, start-code verification, and trip history.
- Queue refresh while the browser is open. There is no push/SMS delivery guarantee when the browser is closed.

### Administrator
- Server-authorized administrator sign-in.
- Driver provisioning, private signed document previews, per-document verification/rejection with a reason, approval and suspension.
- Approval is denied unless the latest driving licence, vehicle RC, and insurance uploads are each verified. Uploading a replacement document immediately resets approval and takes the driver offline until re-review.
- Ride search, operational metrics, audit history, and support-report triage.

## Design and accessibility
- The passenger booking flow prioritizes location selection, route/fare transparency, and one primary next action.
- Passenger, driver, and admin layouts use the same spacing, typography, card, form, focus, and status language.
- Mobile breakpoints support compact navigation, full-width forms, stacked review cards, safe-area bottom booking action, and responsive tables/cards.
- Reduced-motion preferences are respected; keyboard focus remains visible.
- The refresh uses existing React, Motion and Lucide dependencies. The new visual layer is project-owned CSS; it does not introduce a component framework migration.

## Verification to run for every candidate commit

From `web/`:
```sh
npm ci
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

The repository release-readiness workflow additionally validates Supabase migrations/Edge API, C++ tests, API HTTP smoke, PostgreSQL migration/recovery, web accessibility/browser tests, container builds/scans, CodeQL and dependency review.

## Production blockers that must not be represented as complete

- Provision distinct real passenger, driver and administrator identities in a non-production/staging environment first; verify role isolation with negative tests.
- Configure production Supabase Auth redirect URLs, email delivery, storage bucket policy, API secrets and rate limits. Never commit service-role keys, JWT secrets, database URLs, backup passphrases or provider credentials.
- Run migrations against the intended Supabase project and verify the applied migration ledger. Do not assume GitHub CI's disposable PostgreSQL database is the hosted production database.
- Configure contracted or self-hosted geocoding, routing and map tile services with quotas, attribution, privacy review and monitoring. Public demo Nominatim/OSRM endpoints are not a production SLA.
- Complete independent identity, driving-licence, vehicle ownership, insurance, permit and local transport-law checks. Manual document review in this app is not an official KYC/vehicle registry integration.
- Implement and test payment collection, refunds, driver payouts, reconciliation, webhook signature verification and financial audit before charging users.
- Establish a real staffed safety/emergency escalation process and test it end-to-end before describing SOS as an emergency service.
- Create staging test accounts and exercise passenger booking → dispatch → driver acceptance → OTP start → completion → receipt/history, plus cancellation, decline, duplicate requests, concurrent acceptance, expired offers, account suspension and unauthorized cross-role access.
- Verify backup/restore using the configured encrypted backup credentials, retention, access control and recovery objectives.
- Confirm Vercel's deployed commit SHA matches the reviewed Git commit; run live smoke tests against the actual production host and API.
- Complete small-screen manual testing on Android/iOS, keyboard-only navigation, screen-reader checks, and browser console/network inspection.
- Add operational monitoring, alert ownership, incident runbooks, privacy notice, terms, retention policy, support ownership and release rollback instructions.

## Submission checklist
- [ ] Candidate commit passes the full GitHub release-readiness workflow.
- [ ] Preview deployment is tied to the candidate commit SHA.
- [ ] Passenger, driver and admin journeys are demonstrated with real staging accounts and persisted records.
- [ ] Every unavailable production integration is explicitly disclosed in the report and demo.
- [ ] Screenshots cover passenger booking, driver queue/ride, admin document review and operations.
- [ ] Architecture, data model, API contracts, setup, environment variables and test evidence are documented.
- [ ] No secrets, private documents, personal data or real credentials appear in screenshots or repository history.
- [ ] Reviewer has a clean demo reset procedure and a fallback local runbook.

## Current release stance
RideForge is an academic product preview with real API-backed workflows where configured. It is not a public ride-hailing service and must not be used to arrange real travel until the production blockers above are closed and independently verified.
