# RideForge vs Rapido booking benchmark

**Reviewed:** 20 November 2026  
**Scope:** Publicly documented Rapido customer journey and the current RideForge repository. This is a product/engineering benchmark, not a claim that RideForge has Rapido's fleet, operational footprint, insurance, support staffing or regulatory status.

## Reference journey

Rapido's public Delhi page describes pickup and destination entry, Bike/Auto/Cab selection, fare estimates before confirmation, driver live tracking, live-location sharing, SOS and advance scheduling. Its Play listing additionally describes favourites, live tracking, a unique ride PIN, multiple service variants and cashless payments. Rapido's safety page describes captain verification/training, ride tracking, insurance, two-way ratings and 24x7 customer support.

Sources:
- https://www.rapido.bike/Delhi/main-page
- https://play.google.com/store/apps/details?id=com.rapido.passenger&gl=IN
- https://rapido.bike/Safety
- https://rapido.bike/CustomerTerms

## Feature comparison

| Booking/product capability | Rapido public reference | RideForge current state | Gap / next step |
|---|---|---|---|
| Pickup and destination | Core booking flow | Implemented: address entry, geocoding, GPS pickup, map point picker and Noida suggestions | Expand supported service geography only after routing/operations validation |
| Road route and ETA | Fare/route estimate | Implemented: server quote returns road geometry, distance, ETA and expiry | Add live traffic ETA only with a licensed/reliable provider |
| Fare transparency | Estimate before confirmation; fare depends on route/time/service | Implemented: server-only quote with base/distance breakdown and expiry | Production tariff, taxes, waiting/cancellation rules need legal/operations sign-off |
| Vehicle categories | Bike, Auto, Cab and additional variants | Bike-taxi preview only | Add categories only with separate vehicle eligibility, dispatch pools and tariff configuration |
| Captain selection | Captain options with ratings, ETA and fare context | Dispatch to eligible online driver pool; passenger UI does not yet expose a rich captain comparison card | Add accepted-driver identity, vehicle, rating and ETA after backend contract exists |
| Booking and dispatch | Request forwarded to captains; captain accepts/rejects | Implemented API-backed request, expiring offers and driver accept/decline | Real active fleet and full live acceptance test are absent |
| Driver arrival and ride states | Confirmed captain and trip lifecycle | Backend statuses, authenticated event stream and REST recovery; driver actions | Passenger UI can improve state-specific timeline and pickup instructions |
| Ride-start PIN/OTP | Unique ride PIN listed by Rapido | Not merged/deployed; PR #108 contains a proposed implementation but has migration ordering conflict | Rebase/regenerate migration, threat-model, test before merge |
| Live driver map | Live tracking | Route map can show the latest reported driver location for active passenger rides | No continuous background location sharing when page is closed; add only with consent, battery/privacy design |
| Share trip | Share live location/status | Not implemented | Needs expiring, revocable, read-only share token and public tracking page |
| SOS / emergency | SOS and response described by Rapido | No staffed emergency response; support report is not an SOS | Do not ship an SOS button until an actual response operator and escalation process exist |
| Saved places/routes | Favourites | Device-local favourite route shortcuts now implemented | Account-synced Home/Work favourites require authenticated API/schema and RLS |
| Scheduled rides | Advance scheduling | Not implemented | Needs reservation state, scheduled dispatch windows, expiry/cancellation and driver availability model |
| Payments | Cashless payment options | No payment provider or transaction ledger | Add provider, signed webhooks, refunds, reconciliation and payout ledger; never fake a payment |
| Receipts | Trip details / payment information | Trip record and printable non-tax receipt | Add provider transaction reference and tax invoice only after payments/tax review |
| Ratings | Two-way rating | Proposed in PR #108, not merged/deployed | Add post-completion rating workflow, abuse controls and moderation |
| Support | 24x7 support described | Authenticated reports to admin queue | No staffed 24x7 support. Add SLA, owner routing, notifications and escalation before claiming availability |
| Driver checks | Verification, training and ongoing checks | Admin approval gate; optional document upload for academic preview | Real KYC, licence/RC/insurance verification, training and recurring checks are missing |
| Insurance | Ride insurance described | Not connected | Obtain appropriate policy and proof before any real ride |
| Privacy | Location sharing and contact privacy | No historical driver GPS trail; current location is shared while driver online | Add phone masking/secure communication if telephony is integrated |
| No-login demonstration | Not a consumer production feature | Isolated browser-only Passenger/Driver/Admin simulation at /demo | Clearly marked simulation; no API calls or production writes |

## Product principles borrowed from the benchmark

1. Preserve a short booking funnel: pickup → drop-off → vehicle/fare → confirm → match → track.
2. Make fare and cancellation rules visible before confirmation. Do not use pressure prompts, preselected add-ons or misleading urgency.
3. Show captain identity and vehicle details only after a real accepted assignment.
4. Treat trip sharing, emergency response, payment, insurance and driver checks as operational capabilities, not decorative UI buttons.
5. Keep the no-login demo separate from authenticated production data and make simulated status unmistakable.

## Important regulatory/product note

Rapido is a reference for user journey patterns, not a compliance shortcut. RideForge's current academic preview has no verified active fleet, driver/vehicle checks, insurance, payments, staffed emergency response or commercial authorisation. Do not arrange real rides through this preview. Before commercial launch, obtain written legal/regulatory review for the actual operating state and service model.

## Current implementation changes from this benchmark

- Added an entry-point card and /demo for no-login interactive passenger/driver/admin walkthroughs.
- Added device-local saved route shortcuts (up to eight), with remove and restore actions. They remain on the current browser/device and are not synced to an account.
- Added Playwright coverage for the no-login lifecycle and saved route persistence.
