# RideForge web application

React + TypeScript + Vite passenger experience with driver and admin operational workspaces. The passenger and driver workspaces use the same API and PostgreSQL-backed ride records; they are not separate booking systems.

## Run locally

From this directory:

```sh
npm ci
npm run typecheck
npm run build
npx playwright install chromium
npm test
npm run dev
```

Set `VITE_API_BASE_URL` to the API origin when developing against a separately running API (for example, `http://localhost:8080`). In the production Compose overlay, the variable is empty so requests use the same-origin `/api` reverse proxy.

## What is implemented

- Pickup/destination geocoding and road geometry using configurable Nominatim-compatible and OSRM-compatible providers, with an interactive Leaflet/OpenStreetMap map.
- Server-authoritative fare quotes in integer paise, with quote expiry validation.
- Passenger registration/login, persistent booking, cancellation, trip history, ride-status updates, support reports, and printable **demo receipts** (not tax invoices or proof of payment).
- Driver login, online/offline availability with browser geolocation, a fresh-location/radius-filtered request queue, transactional Accept, persisted per-driver Decline, trip-state transitions, and trip history.
- A driver decline hides that request only from that driver's queue. It does **not** cancel the passenger booking. The same driver cannot accept a request after declining it; another eligible driver may still accept.
- Admin-only driver provisioning/approval/suspension, ride search, metrics, audit history and support-report triage.
- Authenticated server-sent ride events with persisted replay; the client also refreshes state to recover after reconnects.

## Important limitations

- Driver requests are currently exposed in a live queue that refreshes while the driver workspace is open. There is no durable time-limited offer delivery/expiry scheduler, automated sequential offer dispatch, browser push, SMS delivery, or guarantee of notification when the page is closed.
- The public Nominatim and OSRM demo services are evaluation defaults, not production capacity or uptime guarantees. Configure contracted or self-hosted services before a public pilot.
- Payment collection, refunds, payouts, commercial driver/vehicle verification and real emergency response are not implemented. A support report is not an emergency service.
- The repository includes a deployment template, not proof of a deployed public service. No live passenger or driver URL is claimed.

## Environment

- `VITE_API_BASE_URL`: API origin; empty means same-origin API proxy.
- `VITE_GEOCODING_BASE_URL`: optional geocoding endpoint; defaults to Nominatim search.
- `VITE_ROUTING_BASE_URL`: optional OSRM-compatible routing endpoint; defaults to the public OSRM demo router.

Respect geocoder, router and map tile terms, quotas, privacy implications and attribution. Do not send sensitive location data to a provider that has not been reviewed for the intended use.
