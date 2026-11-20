# RideForge — teacher demonstration guide

## 3-minute presentation flow

### 1. Problem and product (20 seconds)
RideForge is a bike-taxi booking MVP focused on short urban trips in Noida. It connects a passenger booking interface to a server-side routing and fare-quote API. The goal is to demonstrate a real product workflow, not a static mockup.

### 2. Live passenger experience (60 seconds)
1. Open https://smart-bike-taxi-platform.vercel.app.
2. Wait for the API connection indicator.
3. Choose the JIIT → Sector 18 preset.
4. Select **Get fare estimate**.
5. Explain that the preset only fills address text. The browser requests a fresh quote from the Supabase Edge Function; route distance, duration, geometry and preview fare are returned by the service.
6. Point out that the quote is persisted as a quote record, not a booked ride.

### 3. Engineering and reliability (45 seconds)
- React + Vite + TypeScript frontend deployed on Vercel.
- Supabase Edge Function API and PostgreSQL database.
- Row-level security enabled on all 14 public application tables.
- Automated checks cover frontend typecheck/build, Playwright browser journeys, API smoke tests, database migrations and RLS invariants, dispatch concurrency, C++ tests, CodeQL and container image scans.
- CI evidence: https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/44647862357

### 4. Explain the product architecture (30 seconds)
Passenger web app → Supabase Edge Function → routing/geocoding providers and PostgreSQL. The server owns quote calculation and persistence. The client does not invent coordinates, fares, drivers or ride status.

### 5. Be transparent about scope (25 seconds)
This is a deployed and tested academic/portfolio MVP. Hosted production currently has no provisioned passenger, driver or admin identities and no ride records. Payments, payouts and emergency response are not connected. It is not authorised for commercial passenger operations. This is an explicit release boundary, not a feature to fake for a demo.

## Demo fallback
If live geocoding or routing is temporarily unavailable, explain the dependency and show the UI plus the architecture/CI evidence. Do not type in a fabricated fare or claim a driver accepted a ride.

## Links
- Live app: https://smart-bike-taxi-platform.vercel.app
- Source: https://github.com/kaustubhdua/Smart_bike_taxi_platform
- Demo runbook: https://github.com/kaustubhdua/Smart_bike_taxi_platform/blob/main/docs/DEMO_RUNBOOK.md
- Release status: https://github.com/kaustubhdua/Smart_bike_taxi_platform/blob/main/docs/COMPLETION_STATUS_2026-11-20.md
