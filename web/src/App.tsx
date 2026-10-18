import { lazy, Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { calculateRoute } from "./lib/routing";
const RouteMap = lazy(() => import("./components/RouteMap"));
import OperationsWorkspace from "./components/OperationsWorkspace";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bike, Check,
  CircleHelp, Clock3, Compass, Crosshair, Gauge, LocateFixed,
  MapPin, Menu, Navigation, Route, ShieldCheck, Sparkles, Wallet, X,
} from "lucide-react";

const locations = [
  "JIIT Sector 128",
  "Botanical Garden Metro",
  "Sector 18 Market",
  "Noida City Centre",
  "Sector 62",
];

function apiUrl(base: string, path: string): string {
  return (base.endsWith("/") ? base.slice(0, -1) : base) + path;
}

export default function App() {
  const reduceMotion = useReducedMotion();
  const [pickup, setPickup] = useState(locations[0]);
  const [destination, setDestination] = useState(locations[2]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"ride" | "driver" | "insights">("ride");
  const [apiState, setApiState] = useState<"idle" | "checking" | "offline">("idle");
  const [route, setRoute] = useState<{ km: number; mins: number; path: string; geometry: Array<[number, number]>; provider: string } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [quote, setQuote] = useState<{ quoteId: string; farePaise: number; distanceKm: number; durationMinutes: number; expiresAt?: string } | null>(null);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [account, setAccount] = useState<{ token: string; email: string; displayName?: string; role: string } | null>(null);
  const [ride, setRide] = useState<{ rideId: string; status: string } | null>(null);
  const [bookingKey, setBookingKey] = useState<string | null>(null);
  const [driverOnline, setDriverOnline] = useState(false);
  const [driverLatitude, setDriverLatitude] = useState("28.53");
  const [driverLongitude, setDriverLongitude] = useState("77.35");
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [driverQueue, setDriverQueue] = useState<Array<{ rideId: string; pickup: string; destination: string; distanceMeters: number; farePaise: number }>>([]);
  const [driverRide, setDriverRide] = useState<{ rideId: string; status: string } | null>(null);
  const [adminMetrics, setAdminMetrics] = useState<{ onlineDrivers: number; ridesByStatus: Record<string, number> } | null>(null);
  const fare = quote ? (quote.farePaise / 100).toFixed(2) : null;
  const valid = pickup !== destination && Boolean(pickup && destination) && Boolean(route) && !routeLoading;

  useEffect(() => {
    const controller = new AbortController();
    setRoute(null);
    setQuote(null);
    setRouteError("");
    if (!pickup || !destination || pickup === destination) {
      setRouteLoading(false);
      return () => controller.abort();
    }
    setRouteLoading(true);
    calculateRoute(pickup, destination, controller.signal)
      .then(result => setRoute({
        km: result.distanceKm,
        mins: result.durationMinutes,
        path: "Road route",
        geometry: result.geometry,
        provider: result.provider,
      }))
      .catch(error => {
        if (error instanceof Error && error.name !== "AbortError") setRouteError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteLoading(false);
      });
    return () => controller.abort();
  }, [pickup, destination]);

  useEffect(() => {
    if (!quote?.expiresAt) return;
    const expiresAt = Date.parse(quote.expiresAt);
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setQuote(null);
      setBookingKey(null);
      setNotice("Your fare quote expired. Request a fresh quote before making a decision.");
      return;
    }
    const timer = setTimeout(() => {
      setQuote(null);
      setBookingKey(null);
      setNotice("Your fare quote expired. Request a fresh quote before making a decision.");
    }, Math.min(remaining, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [quote?.expiresAt]);

  useEffect(() => {
    if (account?.role === "driver") void refreshDriverQueue();
    if (account?.role === "admin") void loadAdminMetrics();
  }, [account?.role]);

  async function requestRide() {
    setNotice("");
    setApiState("checking");
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base) {
      setApiState("offline");
      setNotice("Saarthi API is not configured. Set VITE_API_BASE_URL to request quotes and create ride bookings.");
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(apiUrl(base, "/api/v1/routes/quote"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ pickup: { label: pickup }, destination: { label: destination } }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        if (response.status === 429) throw new Error("Too many quote requests. Wait a moment and try again.");
        if (response.status === 503) throw new Error("Routing is temporarily unavailable. Please try again shortly.");
        if (response.status === 422) throw new Error("One of these locations could not be routed. Check the pickup and destination.");
        throw new Error(`Quote service returned HTTP ${response.status}.`);
      }
      const data = await response.json() as {
        quoteId?: string; farePaise?: number; distanceKm?: number; durationMinutes?: number;
        currency?: string; expiresAt?: string;
      };
      const expiry = data.expiresAt ? Date.parse(data.expiresAt) : Number.NaN;
      if (
        typeof data.quoteId !== "string" || data.quoteId.trim().length < 8 ||
        !Number.isSafeInteger(data.farePaise) || (data.farePaise as number) < 0 ||
        typeof data.distanceKm !== "number" || !Number.isFinite(data.distanceKm) || data.distanceKm <= 0 ||
        !Number.isSafeInteger(data.durationMinutes) || (data.durationMinutes as number) <= 0 ||
        data.currency !== "INR" || !Number.isFinite(expiry) || expiry <= Date.now()
      ) {
        throw new Error("The quote service returned an invalid or expired quote. Please try again.");
      }
      setQuote({
        quoteId: data.quoteId, farePaise: data.farePaise as number,
        distanceKm: data.distanceKm, durationMinutes: data.durationMinutes as number,
        expiresAt: new Date(expiry).toISOString(),
      });
      setBookingKey(`saarthi-${crypto.randomUUID()}`);
      setNotice(`Server quote received: ${data.distanceKm} km · ₹${((data.farePaise as number) / 100).toFixed(2)}. This checks the quote only; it does not create a ride.`);
      setApiState("idle");
    } catch (error) {
      setApiState("offline");
      if (error instanceof Error && error.name === "AbortError") {
        setNotice("The quote service took too long to respond. Please try again.");
      } else {
        setNotice(error instanceof Error && error.message !== "Failed to fetch"
          ? error.message
          : "We could not reach the quote service. Check the API and try again.");
      }
    }
  }

  async function authenticate() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base) {
      setNotice("Configure VITE_API_BASE_URL to connect to the Saarthi API.");
      return;
    }
    try {
      const payload = authMode === "register"
        ? { email: authEmail, displayName: authName, password: authPassword }
        : { email: authEmail, password: authPassword };
      const response = await fetch(apiUrl(base, "/api/v1/auth/" + authMode), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as {
        accessToken?: string;
        account?: { email?: string; displayName?: string; role?: string };
        error?: string;
      };
      if (!response.ok || !data.accessToken || !data.account?.email) {
        throw new Error(response.status === 409 ? "An account already exists for this email. Sign in instead."
          : response.status === 401 ? "Email or password is incorrect."
          : data.error || `Authentication failed (HTTP ${response.status}).`);
      }
      setAccount({ token: data.accessToken, email: data.account.email, displayName: data.account.displayName, role: data.account.role ?? "passenger" });
      setAuthPassword("");
      setNotice(`Signed in as ${data.account.email}. Your access token stays in memory for this session.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect to the authentication service.");
    }
  }

  async function createBooking() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base || !quote || !account) {
      setNotice("Get a valid quote and sign in before confirming a ride.");
      return;
    }
    if (!quote.expiresAt || Date.parse(quote.expiresAt) <= Date.now()) {
      setQuote(null);
      setBookingKey("");
      setNotice("Your quote expired. Request a fresh quote before booking.");
      return;
    }
    const key = bookingKey || ("saarthi-" + crypto.randomUUID());
    setBookingKey(key);
    try {
      const response = await fetch(apiUrl(base, "/api/v1/rides"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${account.token}`,
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const data = await response.json() as { rideId?: string; status?: string; error?: string };
      if (!response.ok || !data.rideId || !data.status) {
        throw new Error(response.status === 409 ? "This quote expired or was already used. Request a new quote."
          : response.status === 401 ? "Your session is invalid. Sign in again."
          : data.error || `Booking failed (HTTP ${response.status}).`);
      }
      setRide({ rideId: data.rideId, status: data.status });
      setNotice(`Ride request created. Reference: ${data.rideId}. Status: ${data.status}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create the ride request.");
    }
  }

  async function cancelRide() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base || !account || !ride) return;
    try {
      const response = await fetch(apiUrl(base, "/api/v1/rides/" + encodeURIComponent(ride.rideId) + "/cancel"), {
        method: "POST",
        headers: { "Accept": "application/json", "Authorization": "Bearer " + account.token },
      });
      const data = await response.json() as { status?: string; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error || "Cancellation failed (HTTP " + response.status + ").");
      setRide({ ...ride, status: data.status });
      setNotice("Ride request cancelled.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not cancel this ride request.");
    }
  }

  async function refreshDriverQueue() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base || !account || account.role !== "driver") return;
    try {
      const response = await fetch(apiUrl(base, "/api/v1/driver/rides"), {
        headers: { "Accept": "application/json", "Authorization": "Bearer " + account.token },
      });
      const data = await response.json() as { rides?: Array<{ rideId: string; pickup: string; destination: string; distanceMeters: number; farePaise: number }>; error?: string };
      if (!response.ok || !data.rides) throw new Error(data.error || "Could not load the driver queue.");
      setDriverQueue(data.rides);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load the driver queue.");
    }
  }

  async function toggleDriverAvailability() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base || !account || account.role !== "driver") return;
    const latitude = Number(driverLatitude);
    const longitude = Number(driverLongitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setNotice("Enter valid latitude and longitude coordinates.");
      return;
    }
    const coords = { latitude, longitude };
    try {
      const online = !driverOnline;
      const response = await fetch(apiUrl(base, "/api/v1/driver/availability"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + account.token },
        body: JSON.stringify({ online, ...coords }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update availability.");
      setDriverOnline(online);
      setDriverLocation(coords);
      setNotice(online ? "You are online and can accept ride requests." : "You are now offline.");
      if (online) await refreshDriverQueue();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update availability.");
    }
  }

  async function acceptDriverRide(rideId: string) {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base || !account) return;
    try {
      const response = await fetch(apiUrl(base, "/api/v1/driver/rides/" + encodeURIComponent(rideId) + "/accept"), {
        method: "POST", headers: { "Accept": "application/json", "Authorization": "Bearer " + account.token },
      });
      const data = await response.json() as { rideId?: string; status?: string; error?: string };
      if (!response.ok || !data.rideId || !data.status) throw new Error(data.error || "This ride is no longer available.");
      setDriverRide({ rideId: data.rideId, status: data.status });
      setDriverQueue(current => current.filter(item => item.rideId !== rideId));
      setNotice("Ride accepted. Follow the required ride-state transitions.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not accept the ride.");
      await refreshDriverQueue();
    }
  }

  async function advanceDriverRide(nextStatus: "driver_arriving" | "in_progress" | "completed") {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base || !account || !driverRide) return;
    try {
      const response = await fetch(apiUrl(base, "/api/v1/driver/rides/" + encodeURIComponent(driverRide.rideId) + "/status"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + account.token },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json() as { status?: string; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error || "Could not update ride status.");
      setDriverRide({ ...driverRide, status: nextStatus });
      setNotice("Ride status updated to " + nextStatus + ".");
      await refreshDriverQueue();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update ride status.");
    }
  }

  async function loadAdminMetrics() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base || !account || account.role !== "admin") return;
    try {
      const response = await fetch(apiUrl(base, "/api/v1/admin/metrics"), {
        headers: { "Accept": "application/json", "Authorization": "Bearer " + account.token },
      });
      const data = await response.json() as { onlineDrivers?: number; ridesByStatus?: Record<string, number>; error?: string };
      if (!response.ok || typeof data.onlineDrivers !== "number" || !data.ridesByStatus) throw new Error(data.error || "Could not load admin metrics.");
      setAdminMetrics({ onlineDrivers: data.onlineDrivers, ridesByStatus: data.ridesByStatus });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load admin metrics.");
    }
  }

  function scrollToBooking() {
    document.getElementById("booking")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <div className="app-shell">
      <div className="top-strip"><span className="pulse-dot" /> <span>THE BETTER WAY TO GET THERE</span><span className="strip-divider" /> Built for the city, designed around you</div>
      <header className="site-header">
        <a className="brand" href="#top">
          <span className="brand-mark"><Bike size={22} strokeWidth={2.3} /></span>
          <span>saarthi<span className="brand-period">.</span><small>URBAN MOBILITY</small></span>
        </a>
        <nav className={menuOpen ? "main-nav nav-open" : "main-nav"} aria-label="Main navigation">
          <button className={mode === "ride" ? "nav-link active" : "nav-link"} onClick={() => { setMode("ride"); setMenuOpen(false); }}>Book a ride</button>
          <button className={mode === "driver" ? "nav-link active" : "nav-link"} onClick={() => { setMode("driver"); setAuthMode("login"); setMenuOpen(false); setNotice(""); }}>Drive with us</button>
          <button className={mode === "insights" ? "nav-link active" : "nav-link"} onClick={() => { setMode("insights"); setAuthMode("login"); setMenuOpen(false); setNotice(""); }}>How it works</button>
        </nav>
        <div className="header-actions"><a href="#safety" className="safety-link"><ShieldCheck size={16} /> Safety first</a><button className="icon-button mobile-menu" onClick={() => setMenuOpen(v => !v)} aria-label={menuOpen ? "Close navigation" : "Open navigation"}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button><button className="header-cta" onClick={scrollToBooking}>Get moving <ArrowUpRight size={16} /></button></div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <motion.div className="eyebrow" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}><span className="eyebrow-icon"><Sparkles size={14} /></span> YOUR CITY, WITHOUT THE FRICTION</motion.div>
            <motion.h1 initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.06 }}>Small ride.<br /><span>Big city energy.</span></motion.h1>
            <p className="hero-description">Skip the gridlock, keep your day moving. A smarter bike ride starts with a clearer plan — no surprises, just the essentials.</p>
            <div className="hero-proof"><div className="proof-icon"><Clock3 size={17} /></div><div><strong>Made for the in-between</strong><span>Quick hops, daily commutes, last-mile links.</span></div></div>
            <div className="hero-proof"><div className="proof-icon"><Wallet size={17} /></div><div><strong>Know before you go</strong><span>Transparent estimates, with the math shown.</span></div></div>
            <button className="hero-link" onClick={scrollToBooking}>Plan your ride <span className="round-arrow"><ArrowDown size={16} /></span></button>
          </div>
          <div className="hero-art" aria-label="Illustration of a city bike route" role="img">
            <div className="art-sun" /><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
            <div className="city-grid">
              <div className="building building-a"><i /><i /><i /><i /></div><div className="building building-b"><i /><i /><i /><i /><i /><i /></div><div className="building building-c"><i /><i /><i /></div><div className="building building-d"><i /><i /><i /><i /></div><div className="building building-e"><i /><i /><i /><i /><i /></div>
              <svg className="route-drawing" viewBox="0 0 560 420" role="presentation" aria-hidden="true"><path d="M62 312 C112 300 102 236 178 236 S244 314 310 274 S358 150 420 176 S452 242 502 142" fill="none" stroke="#fff" strokeWidth="17" strokeLinecap="round"/><path d="M62 312 C112 300 102 236 178 236 S244 314 310 274 S358 150 420 176 S452 242 502 142" fill="none" stroke="#335cff" strokeWidth="4" strokeDasharray="8 9" strokeLinecap="round"/><circle cx="62" cy="312" r="10" fill="#b9f65b" stroke="#17211d" strokeWidth="3"/><circle cx="502" cy="142" r="11" fill="#335cff" stroke="#fff" strokeWidth="4"/></svg>
              <div className="map-label label-start"><span className="label-dot" /> YOUR START</div><div className="map-label label-end"><MapPin size={13} /> THE GOOD PART</div>
              <motion.div className="bike-token" animate={reduceMotion ? {} : { y: [0, -5, 0], rotate: [0, -2, 0] }} transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}><Bike size={35} strokeWidth={1.8} /></motion.div>
              <div className="art-sticker"><span>LESS WAITING</span><strong>MORE LIVING<span>↗</span></strong></div>
            </div>
            <div className="art-caption"><span className="caption-mark"><Navigation size={15} /></span><span><strong>Take the scenic shortcut.</strong><small>Every minute has somewhere to be.</small></span><ArrowUpRight size={17} /></div>
          </div>
          <div className="hero-index"><span>01</span><i /> A NEW KIND OF CITY RIDE</div>
        </section>

        {mode !== "ride" && <OperationsWorkspace mode={mode} />}

        <section className="booking-section" id="booking">
          <div className="section-intro"><span className="section-kicker">LET'S GET YOU THERE</span><h2>Your next stop<br className="mobile-break" /> is closer than you think.</h2><p>Two locations. One easy plan.</p></div>
          <div className="booking-layout">
            <div className="booking-card">
              <div className="card-heading"><div><span className="card-eyebrow">RIDE PLANNER</span><h3>Where to?</h3></div><span className="demo-badge"><span /> PREVIEW</span></div>
              <div className="location-fields">
                <div className="location-rail"><span className="rail-origin" /><span className="rail-line" /><span className="rail-destination" /></div>
                <div className="field-stack">
                  <label className="location-field"><span>Pickup point</span><div className="field-control"><MapPin size={17} /><input list="saarthi-location-suggestions" value={pickup} onChange={e => { setPickup(e.target.value); setQuote(null); setBookingKey(null); setRide(null); setNotice(""); }} aria-label="Pickup point" placeholder="Search pickup in Noida" autoComplete="off" /></div></label>
                  <div className="field-separator" />
                  <label className="location-field"><span>Drop-off point</span><div className="field-control"><Crosshair size={17} /><input list="saarthi-location-suggestions" value={destination} onChange={e => { setDestination(e.target.value); setQuote(null); setRide(null); setNotice(""); }} aria-label="Drop-off point" placeholder="Search destination in Noida" autoComplete="off" /></div></label>
                </div>
                <datalist id="saarthi-location-suggestions">{locations.map(item => <option key={item} value={item} />)}</datalist>
                <button className="swap-button" aria-label="Swap pickup and drop-off" onClick={() => { setPickup(destination); setDestination(pickup); setQuote(null); setBookingKey(null); setRide(null); setNotice(""); }}><ArrowLeft size={15} /><ArrowRight size={15} /></button>
              </div>
              <div className="quote-row"><div className="quote-icon"><Route size={17} /></div><div className="quote-details"><strong>Estimated route</strong><span>{routeLoading ? "Finding a real road route…" : route ? `${route.km.toFixed(1)} km · ${route.mins} min · ${route.path}` : routeError || "Select different locations to calculate a road route."}</span></div><button className="text-action" onClick={() => setNotice(route ? `Route calculated with ${route.provider}. Travel time is an estimate and may not include live traffic.` : "A route is not available yet. Check the locations or try again.")} aria-label="About route estimate"><CircleHelp size={17} /></button></div>
              <div className="fare-row"><div><span className="fare-label">ESTIMATED FARE</span><div className="fare-amount">{fare === null ? "—" : `₹${fare}`}<span>{fare === null ? " awaiting server quote" : " server quote"}</span></div></div><div className="fare-note"><Check size={14} /> {quote ? "Quote from API" : "No invented price"}<br /><small>{quote ? (quote.expiresAt ? `Valid until ${new Date(quote.expiresAt).toLocaleTimeString()}` : "Check quote expiry before booking") : "A fare appears only after the server responds."}</small></div></div>
              <button className="book-button" onClick={requestRide} disabled={!valid || apiState === "checking"}>{apiState === "checking" ? "Checking quote…" : "Get server fare quote"} <ArrowRight size={18} /></button>
              {((quote && !ride) || mode !== "ride") && account?.role !== "driver" && account?.role !== "admin" && (
                <div className="auth-panel">
                  {account ? (
                    <div className="auth-session">
                      <span><Check size={15} /> Signed in as <strong>{account.email}</strong></span>
                      <button className="text-action" onClick={() => setAccount(null)}>Sign out</button>
                      <button className="book-button" onClick={createBooking}>Confirm ride request <ArrowRight size={18} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="auth-switch" role="group" aria-label="Account action">
                        <button className={authMode === "register" ? "auth-tab selected" : "auth-tab"} onClick={() => setAuthMode("register")}>Create account</button>
                        <button className={authMode === "login" ? "auth-tab selected" : "auth-tab"} onClick={() => setAuthMode("login")}>Sign in</button>
                      </div>
                      {authMode === "register" && (
                        <label className="auth-field"><span>Your name</span><input value={authName} onChange={event => setAuthName(event.target.value)} maxLength={120} autoComplete="name" placeholder="Full name" /></label>
                      )}
                      <label className="auth-field"><span>Email</span><input type="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} maxLength={254} autoComplete="email" placeholder="you@example.com" /></label>
                      <label className="auth-field"><span>Password</span><input type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} maxLength={128} minLength={authMode === "register" ? 12 : 1} autoComplete={authMode === "register" ? "new-password" : "current-password"} placeholder={authMode === "register" ? "At least 12 characters" : "Your password"} /></label>
                      <button className="book-button" onClick={authenticate}>{authMode === "register" ? "Create passenger account" : mode === "ride" ? "Sign in" : "Sign in securely"} <ArrowRight size={18} /></button>
                      <p className="auth-caption">Your access token is kept in memory and cleared when you sign out or refresh.</p>
                    </>
                  )}
                </div>
              )}
              {ride && (
                <div className="ride-confirmation" role="status">
                  <span className="confirmation-icon"><Check size={17} /></span>
                  <div><strong>Ride request created</strong><span>Reference: {ride.rideId}</span><small>Status: {ride.status}. Driver matching is not live yet.</small></div>
                  {ride.status !== "cancelled" && ride.status !== "completed" && account && (
                    <button className="text-action" onClick={cancelRide}>Cancel request</button>
                  )}
                  <button className="text-action" onClick={() => { setRide(null); setQuote(null); setNotice("Ride request saved. You can request a new quote for another trip."); }}>New ride</button>
                </div>
              )}
              {account?.role === "driver" && (
                <section className="driver-panel" aria-labelledby="driver-console-title">
                  <div className="driver-panel-head">
                    <div><h3 id="driver-console-title">Availability and rides</h3><p>Availability and ride actions use the API.</p></div>
                    <button className={driverOnline ? "driver-online online" : "driver-online"} onClick={toggleDriverAvailability}>{driverOnline ? "Go offline" : "Go online"}</button>
                    <button className="text-action" onClick={() => { setAccount(null); setDriverQueue([]); setDriverRide(null); setDriverOnline(false); }}>Sign out</button>
                  </div>
                  <button className="text-action" onClick={refreshDriverQueue}>Refresh ride queue</button>
                  {driverRide ? (
                    <div className="driver-active-ride">
                      <strong>Active ride</strong><span>Reference: {driverRide.rideId}</span><span>Status: {driverRide.status}</span>
                      {driverRide.status === "assigned" && <button className="book-button" onClick={() => advanceDriverRide("driver_arriving")}>I'm heading to pickup</button>}
                      {driverRide.status === "driver_arriving" && <button className="book-button" onClick={() => advanceDriverRide("in_progress")}>Start trip</button>}
                      {driverRide.status === "in_progress" && <button className="book-button" onClick={() => advanceDriverRide("completed")}>Complete trip</button>}
                    </div>
                  ) : (
                    <div className="driver-queue">
                      {driverQueue.map(item => <article className="driver-queue-item" key={item.rideId}>
                        <div><strong>{item.pickup} → {item.destination}</strong><small>{(item.distanceMeters / 1000).toFixed(1)} km · ₹{(item.farePaise / 100).toFixed(2)}</small></div>
                        <button onClick={() => acceptDriverRide(item.rideId)} disabled={!driverOnline}>Accept</button>
                      </article>)}
                      {driverQueue.length === 0 && <p className="auth-caption">{driverOnline ? "No open requests right now. Refresh to check again." : "Go online to update your location and see open requests."}</p>}
                    </div>
                  )}
                </section>
              )}
              {account?.role === "admin" && (
                <section className="driver-panel" aria-labelledby="admin-console-title">
                  <div className="driver-panel-head">
                    <div><h3 id="admin-console-title">Admin overview</h3><p>Operational counts from PostgreSQL.</p></div>
                    <button className="driver-online" onClick={loadAdminMetrics}>Refresh metrics</button>
                    <button className="text-action" onClick={() => { setAccount(null); setAdminMetrics(null); }}>Sign out</button>
                  </div>
                  {adminMetrics && <div className="admin-metrics">
                    <strong>Online drivers: {adminMetrics.onlineDrivers}</strong>
                    {Object.entries(adminMetrics.ridesByStatus).map(([status, count]) => <span key={status}>{status.replaceAll("_", " ")} <b>{count}</b></span>)}
                  </div>}
                </section>
              )}
              <div className="card-footnote"><ShieldCheck size={14} /> Quotes and ride requests are saved by the API. Driver matching and live tracking are not live yet.</div>
              <AnimatePresence>{notice && <motion.div className={apiState === "offline" ? "inline-notice warning" : "inline-notice"} role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></motion.div>}</AnimatePresence>
            </div>
            <div className="route-card">
              <div className="route-card-top"><div><span className="card-eyebrow">THE SHORT VERSION</span><h3>Your route, at a glance.</h3></div><span className="compass-chip"><Compass size={16} /></span></div>
              <div className="mini-map" role="group" aria-label={route ? `Route map from ${pickup} to ${destination}` : "Route map"}>
                <Suspense fallback={<div className="route-map-empty" role="status">Loading interactive map…</div>}>
                  {route
                    ? <RouteMap geometry={route.geometry} pickup={pickup} destination={destination} />
                    : <div className="route-map-empty" role="status">A real road route will appear here when routing succeeds.</div>}
                </Suspense>
                <button className="locate-button" onClick={() => setNotice("Device location is not requested in this preview. Choose a pickup from the location list.")} aria-label="About current location"><LocateFixed size={17} /></button>
              </div>
              <div className="route-stats"><div><span><Route size={15} /> DISTANCE</span><strong>{route ? route.km.toFixed(1) : "—"} <small>km</small></strong></div><div><span><Clock3 size={15} /> EST. TIME</span><strong>{route ? route.mins : "—"} <small>min</small></strong></div><div><span><Gauge size={15} /> ROUTE TYPE</span><strong>{route ? "Road" : "—"} <small>{route ? "route" : "unavailable"}</small></strong></div></div>
              <div className="route-disclaimer"><span className="disclaimer-dot" /> {route ? `Real road geometry via ${route.provider}; live traffic may not be included.` : routeLoading ? "Looking up locations and calculating road geometry…" : routeError || "A route will appear when a real road route is available."}</div>
            </div>
          </div>
        </section>

        <section className="value-section" id="safety"><div className="value-header"><div><span className="section-kicker">THE SAARTHI DIFFERENCE</span><h2>Less guesswork.<br />More go-time.</h2></div><p>Good mobility is not just getting there. It's knowing what's happening at every step.</p></div>
          <div className="value-grid">
            <article className="value-card"><div className="value-icon lime"><Wallet size={21} /></div><span className="value-number">01 / CLARITY</span><h3>Price, made plain.</h3><p>See the estimate and how it's calculated before you commit. No mystery math.</p><a href="#booking" onClick={e => { e.preventDefault(); scrollToBooking(); }}>Plan a ride <ArrowRight size={15} /></a></article>
            <article className="value-card"><div className="value-icon blue"><ShieldCheck size={21} /></div><span className="value-number">02 / CONFIDENCE</span><h3>Safety isn't a footnote.</h3><p>Trip status, support and sharing belong in the experience — not buried in settings.</p><a href="#safety" onClick={e => { e.preventDefault(); setNotice("Safety workflows are planned for the operational milestone."); }}>Our approach <ArrowRight size={15} /></a></article>
            <article className="value-card"><div className="value-icon peach"><Sparkles size={21} /></div><span className="value-number">03 / SMARTER SYSTEMS</span><h3>Smart, with receipts.</h3><p>Our DSA lab will show why a route or driver ranks first — backed by measurable results.</p><a href="#lab" onClick={e => { e.preventDefault(); document.getElementById("lab")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }}>Meet the engine <ArrowRight size={15} /></a></article>
          </div>
        </section>

        <section className="lab-section" id="lab"><div className="lab-orb"><div className="orb-ring ring-a" /><div className="orb-ring ring-b" /><div className="orb-core"><Bike size={30} /></div><span className="orb-node node-a" /><span className="orb-node node-b" /><span className="orb-node node-c" /></div><div className="lab-copy"><span className="section-kicker">UNDER THE HOOD</span><h2>Not just a pretty route.<br /><em>A smarter one.</em></h2><p>Behind the ride is a C++ routing and dispatch engine. We’re building the tools to inspect the path, understand driver selection, and benchmark every decision instead of calling it “AI” and hoping nobody asks.</p><div className="lab-pills"><span><Route size={14} /> Dijkstra routing</span><span><Gauge size={14} /> Benchmarks</span><span><Sparkles size={14} /> Explainable matching</span></div><button className="outline-button" onClick={() => { setMode("insights"); setNotice("DSA explorer is planned: this UI foundation will connect to measured backend results, not fabricated metrics."); document.getElementById("booking")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }}>Explore the engine <ArrowUpRight size={16} /></button></div></section>

        <section className="closing-cta"><div><span className="section-kicker">YOUR CITY IS CALLING</span><h2>Make the next move<br />a little lighter.</h2></div><button onClick={scrollToBooking}>Plan your first route <ArrowRight size={17} /></button><span className="cta-decoration">↗</span></section>
      </main>

      <footer className="site-footer"><a className="brand footer-brand" href="#top"><span className="brand-mark"><Bike size={20} /></span><span>saarthi<span className="brand-period">.</span><small>URBAN MOBILITY</small></span></a><span className="footer-note">A portfolio project in progress. No live rides or payments.</span><div className="footer-links"><a href="#booking">Ride planner</a><a href="#safety">Safety</a><a href="#lab">DSA lab</a><a href="https://github.com/kaustubhdua/Smart_bike_taxi_platform" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a></div><span className="copyright">© 2026 SAARTHI LABS</span></footer>
      <div className="mobile-bottom-bar"><span><small>ESTIMATED FARE</small><strong>{fare === null ? "—" : `₹${fare}`}</strong></span><button onClick={scrollToBooking}>Plan a ride <ArrowRight size={16} /></button></div>
    </div>
  );
}
