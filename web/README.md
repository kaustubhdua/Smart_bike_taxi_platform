# RideForge web application

React + TypeScript + Vite passenger booking experience.

## Run locally

```sh
npm install
npm run typecheck
npm run build
npx playwright install chromium
npm test
npm run dev
```

## Current behavior

- Pickup and destination choices are geocoded using OpenStreetMap Nominatim.
- Road distance, estimated duration, and route geometry are requested from the OSRM demo router and rendered on an interactive Leaflet/OpenStreetMap map.
- Fare is **not guessed in the browser**. It appears only when the server returns a quote in integer paise.
- The quote button calls `POST /api/v1/routes/quote` using the contract in `../backend/openapi.yaml`.
- Ride creation, authentication, driver assignment, and persistent booking are not yet implemented. A quote is not a booking.
- Live traffic may not be included in the OSRM duration estimate.

## Routing provider limitations

The default Nominatim and OSRM public demo endpoints are for development and evaluation, not production availability guarantees. Nominatim public usage is rate-limited. Configure `VITE_GEOCODING_BASE_URL` and `VITE_ROUTING_BASE_URL` for an approved hosted/self-hosted provider before launch. Do not send personal or sensitive location data to an unreviewed provider. A production backend should calculate and validate its own route and fare rather than trusting client-supplied values.

The OpenStreetMap tile layer requires visible attribution, which is provided by Leaflet. Respect the tile provider's usage policy; use a suitable provider or self-hosted tiles for production traffic.

## Environment

- `VITE_API_BASE_URL`: API origin, for example `http://localhost:8080`. The app appends `/api/v1/routes/quote`.
- `VITE_GEOCODING_BASE_URL`: optional geocoding endpoint; defaults to Nominatim search.
- `VITE_ROUTING_BASE_URL`: optional OSRM-compatible route endpoint; defaults to the public OSRM demo router.

The current API contract is not yet backed by a running HTTP service. Without `VITE_API_BASE_URL` and a working API, the UI intentionally reports that the quote service is unavailable instead of inventing a fare.
