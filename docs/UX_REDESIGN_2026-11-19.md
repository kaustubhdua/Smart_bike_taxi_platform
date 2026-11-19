# RideForge UX redesign — 19 November 2026

## Executive summary

The previous public page was a marketing-first landing page. The main rider task—enter pickup and destination, obtain a server quote, authenticate, and request a ride—was placed far below the hero. It also started with prefilled locations, used a decorative illustration as the dominant first-screen visual, and made the role-specific workspaces difficult to discover. Several secondary links led to explanatory notices rather than an actual workflow.

The redesign makes the booking journey the primary product surface. The passenger can now see the pickup/drop-off fields, current-location action, quote action, fare state, and API connection state immediately. The map and route metrics follow directly below. Passenger account actions are grouped into compact disclosures so they do not overwhelm the booking path.

## Evidence from the previous build

The audit was based on the live Vercel page, its rendered text/HTML, and the main-branch source in `web/src/App.tsx`, `web/src/styles.css`, and `web/src/main.tsx`.

Observed friction:
- The hero and decorative city illustration occupied the first screen, while the actual planner appeared after several marketing sections.
- Pickup and destination were silently prefilled with JIIT Sector 128 and Sector 18 Market, making the initial form look like a real preselected trip.
- The quote button was not the first obvious next step, and the route map appeared much later in the page.
- Driver and admin navigation were only conditionally visible in local development; production role entry points were not obvious.
- Account profile, trip history, receipts and support were mixed into a long booking panel.
- The public page had explanatory links that only set notices rather than navigating to a real user task.

## Research and patterns adopted

This implementation borrows workflow principles from open-source projects and public standards; it does not copy their source code or assets.

1. **Openfront Rideshare** documents a coherent rider flow from service discovery and quote to ride request, trip status, cancellation, payment records, support and history. It also separates the rider storefront from driver and operator workspaces. RideForge now makes that separation explicit while retaining its existing API and role controls.
   - Product/workflow overview: https://docs.openship.org/docs/openfront/rideshare
   - Getting started: https://docs.openship.org/docs/openfront/rideshare/getting-started
   - Source: https://github.com/openshiporg/openfront-rideshare

2. **tanav29/uber** documents distinct rider and captain apps, with a clear ride lifecycle: rider quote/request/tracking/cancellation/history and captain online/offline/accept/complete/history. RideForge uses the same separation principle but keeps its current React/Vite app and Supabase Edge API.
   - Source: https://github.com/tanav29/uber

3. **W3C WCAG 2.2** requires keyboard-operable controls and visible keyboard focus. The redesign retains semantic labels, visible focus treatment, keyboard-operable links/buttons, reduced-motion handling, and Playwright/axe checks.
   - Keyboard: https://www.w3.org/WAI/WCAG22/Understanding/keyboard
   - Focus visible: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible

4. **OpenStreetMap Nominatim policy** prohibits client-side autocomplete and limits public service use. RideForge therefore keeps Noida suggestions in a local HTML datalist and only calls reverse geocoding after the user explicitly presses “Use my current location”; it does not geocode on each keystroke. OpenStreetMap attribution is displayed.
   - Policy: https://operations.osmfoundation.org/policies/nominatim/

## What changed

### Passenger booking
- Replaced the long marketing-first home page with a booking-first layout.
- Removed implicit default pickup/drop-off values; both fields start empty.
- Added a local Noida landmark suggestion list without live autocomplete requests.
- Added explicit current-location pickup lookup with browser permission, timeout/error handling, and address review.
- Added a visible API connection indicator. A failed health probe does not permanently disable booking; quote requests remain retryable.
- Made quote, fare breakdown, quote expiry, route preview and route metrics part of one clear sequence.
- Kept the rule that prices only appear after a valid server response.
- Kept idempotent ride request, authenticated status events with polling recovery, cancellation, history, receipt and support flows.
- Grouped profile, history and support under compact disclosures after sign-in.
- Clarified that this is an academic demo and does not provide live transport, payment processing or emergency response.

### Driver and admin
- Added always-visible links to the rider, driver and admin entry points.
- Added a consistent navigation shell to the dedicated `/driver` and `/admin` workspaces.
- Kept role authorization on the API; frontend navigation does not grant roles.

### Responsive and accessibility
- Added mobile-first stacking, mobile booking action bar, compact role navigation, and route-map sizing.
- Kept keyboard focus indicators and semantic form labels.
- Respects reduced-motion preferences.
- Updated browser tests for explicit location selection and the revised account workflow.

## Acceptance checklist

| Area | Acceptance |
|---|---|
| Initial state | Pickup and destination are empty; no invented fare or route |
| Locations | Local Noida suggestions work; manual address entry works |
| Current location | Requires explicit user action and permission; reverse lookup failure is recoverable |
| Quote | Calls the server only after the quote button; validates quote ID, INR fare arithmetic, expiry, duration and route geometry |
| Fare | Only displayed after a valid server quote; breakdown is shown |
| Authentication | Passenger registration/sign-in remains API-backed; email verification response is surfaced |
| Booking | Requires valid quote and passenger session; preserves idempotency key for retry |
| Tracking | SSE with REST polling recovery; terminal state and stale GPS handling retained |
| Cancellation | Uses authenticated API and reflects server status |
| Driver | Dedicated route; sign-in, availability, location refresh, queue, accept/decline, trip lifecycle and history remain API-backed |
| Admin | Dedicated route; sign-in, metrics, driver provisioning/approval, audit, ride search and support review remain API-backed |
| Support | Passenger reports are authenticated and routed to admin review; emergency disclaimer remains explicit |
| Mobile | Responsive layout; no horizontal overflow test |
| Accessibility | axe checks and keyboard-visible focus; reduced motion supported |

## Remaining operational limitations

A polished UI does not create missing production prerequisites. The Supabase project currently has no passenger, driver or admin identities and no staging environment. A real passenger/driver/admin end-to-end journey still needs separately provisioned test identities in staging. Email verification/redirect configuration must be correct. The map/geocoding providers are public evaluation services and need a provider strategy and usage controls before real traffic. Payments, phone verification, emergency operations, licensing, vehicle compliance, insurance and commercial service authorization are outside this academic MVP.

Do not describe the project as a licensed live taxi service or claim that real rides/payments/emergency response are available.


## 2026-11-19 follow-up — address resolution and visual system

### Address lookup reliability
- The hosted Supabase Edge runtime received HTTP 403 from both public Photon and Nominatim geocoders. Sending an application User-Agent, Referer and Origin did not resolve that egress restriction.
- The browser now resolves each manually entered pickup/drop-off address through Photon only when the rider presses **Get fare estimate**. It requests one result per address, biases the query to Noida, validates coordinate bounds and rejects an explicitly non-India result.
- Only the resulting coordinates and the rider-entered labels are sent to the Edge API. The Edge API validates both coordinate pairs, calls the road-routing provider and calculates the fare server-side. Client-supplied fare, distance, duration and route geometry are never accepted as quote truth.
- If Photon cannot resolve either address, the UI shows a recoverable error and does not invent a route or price. Browser-side lookup is still subject to the public provider's availability and fair-use limits.

### Visual system
- Applied the Nirdhoom visual language: warm cream and parchment surfaces, navy ink, forest-green actions, saffron accents, DM Sans / Plus Jakarta Sans / JetBrains Mono typography, softer shadows and restrained motion.
- Kept RideForge's own identity, content, booking flow and map treatment; no Nirdhoom domain assets or copy were transplanted.
- Existing keyboard focus, reduced-motion, mobile layout and explicit academic-demo disclosures remain.

### Verification boundary
The coordinate-based quote contract has passing exact-head release CI. The production route-quote smoke is the deciding hosted check for the server-side routing provider. A passing CI build is not a substitute for a successful live quote, a real authenticated passenger/driver lifecycle, or an isolated backup restore.


### Final integration follow-up — PR #106
- Browser Photon requests are serialized with a 1.1-second minimum interval to respect the public geocoder's fair-use posture.
- The current-location flow uses browser GPS coordinates directly for the quote even if reverse-address lookup is unavailable; no fabricated address or route is substituted.
- Playwright now runs the `web/tests` suite and includes a one-time post-merge live passenger quote acceptance test.
