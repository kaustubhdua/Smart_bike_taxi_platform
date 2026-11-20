# RideForge live demo runbook

This guide is for a short, honest walkthrough of the currently deployed preview.

## Live entry point

- Production frontend: https://smart-bike-taxi-platform.vercel.app
- Repository: https://github.com/kaustubhdua/Smart_bike_taxi_platform

## 60–90 second route-quote walkthrough

1. Open the production frontend and wait for the top service indicator to report **RideForge API connected**.
2. In the booking card, select **JIIT → Sector 18** (or **JIIT → Botanical Garden**).
3. Select **Get fare estimate**.
4. Allow location resolution and the server-side route provider to finish. The page should display a route line, distance, estimated duration, and a server-returned INR preview quote.
5. Point out that the quote is returned by the connected Supabase Edge Function and persisted as a route quote. The displayed fare is a preview tariff, not a commercial fare or payment request.

The route preset only fills the two location inputs. It does not invent coordinates, route geometry, travel time, fare, driver identity, or a ride record. A new quote is requested from the live service each time.

## What is live vs. not yet provisioned

| Capability | Current state |
|---|---|
| Public frontend | Vercel production deployment |
| API | Supabase Edge Function `rideforge-api` |
| Location resolution and road quote | Live provider-backed request; subject to provider availability |
| Quote persistence | Supabase `route_quotes` |
| Passenger account and ride booking | Requires a real account and successful auth/session |
| Driver queue and availability | Requires a provisioned, approved driver account and fresh device location |
| Admin operations | Requires a separately provisioned admin account |
| Payment collection / payouts | Not connected |
| Emergency response | Not connected |

The latest audited database snapshot contains 0 Auth users, 0 application accounts, 0 driver profiles, 0 rides, 0 driver documents and 9 route quotes. Do not present those quotes as completed rides.

## If the live quote fails

- Confirm the top service indicator is connected.
- Refresh once and try the JIIT → Sector 18 preset again.
- If the service is unavailable, show the product UI and explain the dependency. Do not replace the response with a hard-coded fare or map.
- Do not claim a driver is online or a ride is completed unless the API returns that state for a real provisioned account.

## Production boundary

RideForge is a preview, not an authorised passenger transport operation. The preview fare is not an approved commercial tariff. Do not accept passenger payments or arrange real-world rides until driver/vehicle eligibility, applicable aggregator permissions, safety operations, insurance, support and payment compliance are confirmed.

## Visual direction

The RideForge interface uses the Nirdhoom visual principles—warm cream, forest green, saffron, navy ink, restrained motion and clear status communication—adapted to a mobility booking workflow. It does not reuse Nirdhoom's assets or farmer-specific workflows.

## Teacher presentation — 7–9 minute plan

**Important deployment note:** the current main branch contains additional source changes, including an optional map picker and pre-presentation fixes. The latest verified production deployment is still commit `11fb9dd161c83fef5fb6f10e2d9e289f5700a4bf`; later commits have not been deployed while Vercel reports `build-rate-limit`. Only demonstrate controls that are visible and working on the deployed URL.

### Safe presentation flow with the currently provisioned production data

| Time | What to show | What to say |
|---|---|---|
| 0:00–0:45 | Role landing page | RideForge separates passenger, driver and administrator workflows with server-checked roles. |
| 0:45–2:30 | Passenger route quote | Choose a Noida route preset, request a live quote, and show returned road distance, duration, route and INR preview fare. |
| 2:30–3:30 | Fare details | Explain base fare + distance component, quote expiry and why this is a preview tariff rather than a payment. |
| 3:30–5:00 | Architecture | React/Vite frontend → Supabase Edge Function → PostgreSQL/RPCs; explain idempotent booking, role checks, dispatch and event history. |
| 5:00–6:15 | Driver/admin workspaces | Explain pending driver approval, GPS freshness, offer acceptance and admin controls. Do not claim a real driver or ride exists. |
| 6:15–7:30 | Security and reliability | Show RLS, private driver-document storage, CI and server-authoritative quote/booking logic. |
| 7:30–9:00 | Limitations and roadmap | Explain that payments, real driver/vehicle verification, staffed emergency response and regulatory approvals are not part of this preview. |

### Full ride lifecycle demonstration — conditional

Only use this flow after real, separately verified staging accounts exist for passenger, driver and admin, and after a READY Vercel deployment and external end-to-end acceptance confirm the same commit:

1. Passenger signs in and creates a ride from a fresh quote.
2. Driver account is registered and remains pending.
3. Admin approves the driver.
4. Driver grants GPS permission and goes online.
5. Driver receives and accepts the actual offer.
6. Passenger and driver views show the same persisted status.
7. Driver advances arrival and trip states, then completes the ride.
8. Passenger history and admin search show the same completed ride.

Do not create fake production accounts, GPS points, rides, ratings, payments or metrics. If the accounts or deployed workflow are not ready, use the safe route-quote presentation above and state the limitation.

### Backup plan

- Record the route-quote walkthrough from the deployed site before presenting.
- Keep the live URL open in a second browser tab.
- Use public landmarks only; do not enter home addresses or sensitive locations into the public geocoding service.
- If the quote provider is unavailable, show the API health state and explain the dependency. Never substitute a fabricated quote or route.
- A screen recording is a labelled backup demonstration, not proof that a live transaction happened during the presentation.
