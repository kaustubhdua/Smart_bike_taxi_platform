# Saarthi web experience

React + TypeScript + Vite frontend foundation for Smart Bike Taxi Platform.

## Local development
```bash
cd web
npm install
npm run dev
npm run typecheck
npm run build
```

Configure `VITE_API_BASE_URL` in a local `.env` file when the C++ API is implemented. The first UI milestone intentionally does not fabricate bookings, drivers, payments or live GPS. The current route illustration and fare values are clearly labelled sample data and must be replaced by an API-backed routing/quote service before being presented as live estimates.

## UI implementation notes
- Original Saarthi visual identity; not a clone of Rapido branding or proprietary assets.
- Motion-powered micro-interactions and Lucide icons.
- Responsive booking UI, keyboard focus styles, visible sample-data disclaimers and reduced-motion support.
- Component inspiration is documented in `../docs/UX_DESIGN_SYSTEM.md`; check package and source licenses before adapting third-party components.
- Live map/geocoding, authentication, persistent bookings, driver console and WebSocket updates are not implemented yet.
