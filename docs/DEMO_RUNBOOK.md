# RideForge live demo runbook

This guide documents how to verify the currently deployed preview without overstating its capabilities.

## Live entry point

- Production frontend: https://smart-bike-taxi-platform.vercel.app
- Repository: https://github.com/kaustubhdua/Smart_bike_taxi_platform

## 60–90 second route-quote walkthrough

1. Open the production frontend and wait for the top service indicator to report **RideForge API connected**.
2. In the booking card, select **JIIT → Sector 18** (or **JIIT → Botanical Garden**).
3. Select **Get fare estimate**.
4. Allow location resolution and the server-side route provider to finish. The page should display a route line, distance, estimated duration, and a server-returned INR preview quote.
5. Verify that the quote is returned by the connected Supabase Edge Function and persisted as a route quote. The displayed fare is a preview tariff, not a commercial fare or payment request.

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
- If the service is unavailable, inspect the product UI and explain the dependency. Do not replace the response with a hard-coded fare or map.
- Do not claim a driver is online or a ride is completed unless the API returns that state for a real provisioned account.

## Production boundary

RideForge is a preview, not an authorised passenger transport operation. The preview fare is not an approved commercial tariff. Do not accept passenger payments or arrange real-world rides until driver/vehicle eligibility, applicable aggregator permissions, safety operations, insurance, support and payment compliance are confirmed.

## Visual direction

The RideForge interface uses the Nirdhoom visual principles—warm cream, forest green, saffron, navy ink, restrained motion and clear status communication—adapted to a mobility booking workflow. It does not reuse Nirdhoom's assets or farmer-specific workflows.
