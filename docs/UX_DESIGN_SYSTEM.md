# UX and design system

## Brand and promise
**Saarthi** (working name): a calmer, clearer bike-taxi booking experience. Promise: transparent fares, clear trip states, accessible interactions, and explainable matching.

## Principles
1. **Clarity before decoration** — pickup, destination, ETA, fare and trip status are always easy to scan.
2. **Trust through transparency** — explain fare assumptions, route data, demo mode and unavailable services.
3. **Progressive disclosure** — keep the first booking action simple; reveal route details and matching rationale when useful.
4. **Mobile-first** — thumb-sized controls, compact bottom-sheet booking on mobile, desktop split view on larger screens.
5. **Accessible motion** — meaningful transitions, no motion required to understand state; support `prefers-reduced-motion`.
6. **Honest states** — never present fabricated driver locations, availability, payment success or ride confirmation as real.

## Tokens
- Canvas: warm stone/off-white; surfaces: white; text: deep ink; muted text: slate; primary action: electric lime; route/interactive map: cobalt; error: dark red with icon and text.
- Type: system UI / Inter-like sans stack; use tabular numerals for fare, ETA and IDs.
- Radius: small controls 10–12px, cards 18–24px, large booking surface 28px.
- Elevation: subtle one-level card shadow, no excessive glassmorphism.
- Motion: 160–240ms for small transitions; one purposeful hero reveal; reduced-motion disables non-essential transforms.
- Spacing: 4px base rhythm; section spacing increases with viewport width.

## Core surfaces
### Passenger
- Landing/booking: pickup + destination, location permissions explanation, route preview, transparent fare estimate and request action.
- Quote: route distance, estimate, pricing assumptions and quote expiry if API supports it.
- Matching: clear status and cancel affordance; do not invent driver/ETA.
- Active trip: driver identity only from authorized API response, trip state, safety/support and trip-sharing.
- History: empty state, pagination, receipts and status labels.

### Driver
- Availability toggle with explicit status; incoming request card with pickup/destination, estimated distance/fare and expiry; accept/reject with clear feedback.
- Trip controls must enforce legal state transitions and reflect server truth, not optimistic UI alone.
- History and earnings are derived from persisted completed rides.

### Admin
- Search and inspect users/rides with least privilege; display audit events; require confirmation for consequential actions.
- Avoid exposing phone, location history or incident notes to unauthorized roles.

## Component inspirations and license hygiene
- React Bits: use as inspiration or copy only the individual components whose license/notice permits it; preserve required attribution.
- Magic UI: use selected motion/visual components as a source of patterns; check the exact component's license and dependencies before copying.
- Radix UI: accessible primitives where custom interaction semantics are needed.
- Motion: animation primitives, with reduced-motion alternatives.
- Lucide: icons; use consistent stroke weight and never use icons without accessible labels when they convey meaning.
- Keep a `THIRD_PARTY_NOTICES.md` before shipping any copied/adapted source snippets. Pin package versions and audit dependencies.
- Do not copy Rapido logos, proprietary screenshots, wording, illustrations, or source code. Build a distinct product identity.

## Responsive breakpoints
- Small: single-column, bottom action area, compact map, no horizontal overflow.
- Medium: stacked booking and route surfaces with a persistent summary.
- Large: split view with booking controls on the left and route/preview on the right.
- Verify at 360px, 390px, 768px, 1024px and 1440px widths.

## Accessibility checklist
- Semantic landmarks and one H1 per view.
- Every input has a persistent label and useful error text.
- Keyboard-only booking and dialogs; visible focus.
- Color contrast meets WCAG 2.2 AA.
- Status changes announced with polite live regions.
- Touch targets meet WCAG 2.2 target-size guidance where applicable.
- Motion respects `prefers-reduced-motion`.
- Maps have a non-map text alternative for pickup, destination, route and distance.
