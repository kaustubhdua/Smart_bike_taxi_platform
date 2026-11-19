import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
const RouteMap = lazy(() => import("./components/RouteMap"));
import {
  ArrowLeft, ArrowRight, Bike, Check, CircleHelp, Clock3, Crosshair,
  Gauge, LocateFixed, MapPin, Menu, Route, ShieldCheck, Wallet, X,
} from "lucide-react";

const locations = [
  "JIIT Sector 128, Noida",
  "Botanical Garden Metro, Noida",
  "Sector 18 Market, Noida",
  "Noida City Centre, Noida",
  "Sector 62, Noida",
  "Sector 137 Metro Station, Noida",
  "Advant Navis Business Park, Noida",
  "Amity University, Noida",
  "Jaypee Institute of Information Technology, Sector 128, Noida",
  "Noida Sector 15 Metro Station",
];

function apiUrl(base: string, path: string): string {
  return (base.endsWith("/") ? base.slice(0, -1) : base) + path;
}

function isRouteGeometry(value: unknown): value is Array<[number, number]> {
  return Array.isArray(value) && value.length >= 2 && value.length <= 10000 &&
    value.every(point => Array.isArray(point) && point.length === 2 &&
      typeof point[0] === "number" && Number.isFinite(point[0]) &&
      typeof point[1] === "number" && Number.isFinite(point[1]) &&
      point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90);
}

export default function App() {
  const reduceMotion = useReducedMotion();
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [apiHealth, setApiHealth] = useState<"checking" | "online" | "offline">("checking");
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [apiState, setApiState] = useState<"idle" | "checking" | "offline">("idle");
  const [route, setRoute] = useState<{ km: number; mins: number; path: string; geometry: Array<[number, number]>; provider: string } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [quote, setQuote] = useState<{ quoteId: string; farePaise: number; baseFarePaise: number; distanceFarePaise: number; distanceKm: number; durationMinutes: number; expiresAt?: string } | null>(null);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [account, setAccount] = useState<{ token: string; email: string; displayName?: string; role: string } | null>(null);
  const [ride, setRide] = useState<{ rideId: string; status: string } | null>(null);
  const [rideDriverLocation, setRideDriverLocation] = useState<{ latitude: number; longitude: number; updatedAt: string } | null>(null);
  const [bookingKey, setBookingKey] = useState<string | null>(null);
  const [supportCategory, setSupportCategory] = useState("technical");
  const [supportDescription, setSupportDescription] = useState("");
  const [supportReports, setSupportReports] = useState<Array<{ id: string; rideId: string | null; category: string; description: string; status: string; resolutionNote: string; createdAt: string }>>([]);
  const [supportBusy, setSupportBusy] = useState(false);
  const [passengerHistory, setPassengerHistory] = useState<Array<{ rideId: string; status: string; pickup: string; destination: string; farePaise: number; finalFarePaise?: number; currency: string; createdAt: string; completedAt?: string }>>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [receiptRideId, setReceiptRideId] = useState<string | null>(null);
  const fare = quote ? (quote.farePaise / 100).toFixed(2) : null;
  const valid = pickup.trim().length >= 3 && destination.trim().length >= 3 &&
    pickup.trim().toLocaleLowerCase("en-US") !== destination.trim().toLocaleLowerCase("en-US") && !routeLoading;

  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base) { setApiHealth("offline"); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    fetch(apiUrl(base, "/api/v1/health"), { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("API unavailable"); setApiHealth("online"); })
      .catch(() => setApiHealth("offline"))
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, []);

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
    setRideDriverLocation(null);
  }, [ride?.rideId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRideDriverLocation(current => {
        if (!current) return current;
        const timestamp = Date.parse(current.updatedAt);
        return !Number.isFinite(timestamp) || Date.now() - timestamp > 120_000 ? null : current;
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // Use authenticated SSE for low-latency updates and keep REST polling as recovery.
  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined || !account || account.role !== "passenger" || !ride ||
        ["completed", "cancelled", "failed"].includes(ride.status)) return;
    let inFlight = false;
    let disposed = false;
    let lastEventId = 0;
    let lastKnownStatus = ride.status;
    const terminal = () => ["completed", "cancelled", "failed"].includes(lastKnownStatus);
    const streamAbort = new AbortController();
    const statusRank: Record<string, number> = {
      requested: 0, matching: 1, assigned: 2, driver_arriving: 3,
      in_progress: 4, completed: 5, cancelled: 5, failed: 5,
    };

    const applyStatus = (data: { rideId?: string; status?: string }) => {
      if (disposed || data.rideId !== ride.rideId || typeof data.status !== "string" ||
          data.status === lastKnownStatus || terminal() ||
          statusRank[data.status] === undefined || statusRank[lastKnownStatus] === undefined ||
          statusRank[data.status] < statusRank[lastKnownStatus]) return;
      lastKnownStatus = data.status;
      setRide(current => {
        if (!current || current.rideId !== data.rideId) return current;
        return { rideId: current.rideId, status: data.status! };
      });
      setNotice("Ride status updated to " + data.status + ".");
      if (terminal()) { setRideDriverLocation(null); streamAbort.abort(); }
    };

    const refreshRide = async () => {
      if (disposed || inFlight || terminal() || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const response = await fetch(apiUrl(base, "/api/v1/rides/" + encodeURIComponent(ride.rideId)), {
          headers: { "Accept": "application/json", "Authorization": "Bearer " + account.token },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return;
        const data = await response.json() as { rideId?: string; status?: string; driverLocation?: { latitude?: number; longitude?: number; updatedAt?: string } };
        applyStatus(data);
        if (data.rideId === ride.rideId && data.driverLocation &&
            typeof data.driverLocation.latitude === "number" && Number.isFinite(data.driverLocation.latitude) &&
            typeof data.driverLocation.longitude === "number" && Number.isFinite(data.driverLocation.longitude) &&
            typeof data.driverLocation.updatedAt === "string") {
          setRideDriverLocation({ latitude: data.driverLocation.latitude, longitude: data.driverLocation.longitude, updatedAt: data.driverLocation.updatedAt });
        } else if (data.rideId === ride.rideId) setRideDriverLocation(null);
      } catch {
        // Transient network errors do not erase persisted status; retry on the next poll.
      } finally {
        inFlight = false;
      }
    };

    const pause = (milliseconds: number) =>
      new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));
    const connectEvents = async () => {
      while (!disposed && !terminal()) {
        try {
          const headers: Record<string, string> = {
            "Accept": "text/event-stream",
            "Authorization": "Bearer " + account.token,
          };
          if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
          const response = await fetch(apiUrl(base, "/api/v1/rides/" + encodeURIComponent(ride.rideId) + "/events"), {
            headers,
            signal: streamAbort.signal,
          });
          if (!response.ok || !response.body) throw new Error("Ride event stream unavailable");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let streamEnded = false;
          while (!disposed && !terminal() && !streamEnded) {
            const chunk = await reader.read();
            if (chunk.done) { streamEnded = true; break; }
            buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              let id = 0;
              const dataLines: string[] = [];
              for (const line of frame.split("\n")) {
                if (line.startsWith("id:")) {
                  const parsed = Number(line.slice(3).trim());
                  if (Number.isSafeInteger(parsed) && parsed >= 0) id = parsed;
                } else if (line.startsWith("data:")) {
                  dataLines.push(line.slice(5).trimStart());
                }
              }
              if (id > lastEventId) lastEventId = id;
              if (dataLines.length > 0) {
                try {
                  const data = JSON.parse(dataLines.join("\n")) as { rideId?: string; status?: string };
                  applyStatus(data);
                } catch {
                  // Ignore malformed frames; REST polling remains the recovery path.
                }
              }
              boundary = buffer.indexOf("\n\n");
            }
          }
          if (!disposed && !terminal()) await pause(250);
        } catch {
          if (disposed || streamAbort.signal.aborted || terminal()) break;
          await pause(1500);
        }
      }
    };

    const timer = window.setInterval(() => { void refreshRide(); }, 5000);
    const resync = () => { if (document.visibilityState === "visible") void refreshRide(); };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    void refreshRide();
    void connectEvents();
    return () => {
      disposed = true;
      streamAbort.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [account?.token, account?.role, ride?.rideId]);

  // Keep offer countdowns synchronized with the browser clock; server-side expiry remains authoritative.
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function requestRide() {
    setNotice("");
    setApiState("checking");
    setRouteLoading(true);
    setRouteError("");
    setRoute(null);
    setQuote(null);
    setBookingKey(null);
    setRide(null);
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined) {
      const message = "RideForge API is not configured. Set VITE_API_BASE_URL to request quotes and create ride bookings.";
      setApiState("offline");
      setRouteError(message);
      setNotice(message);
      setRouteLoading(false);
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
        fareBreakdown?: { baseFarePaise?: number; distanceFarePaise?: number; pricingModel?: string };
        currency?: string; expiresAt?: string; geometry?: unknown;
      };
      const expiry = data.expiresAt ? Date.parse(data.expiresAt) : Number.NaN;
      const breakdown = data.fareBreakdown;
      if (
        typeof data.quoteId !== "string" || data.quoteId.trim().length < 8 ||
        !Number.isSafeInteger(data.farePaise) || (data.farePaise as number) < 0 ||
        !breakdown ||
        !Number.isSafeInteger(breakdown.baseFarePaise) || (breakdown.baseFarePaise as number) < 0 ||
        !Number.isSafeInteger(breakdown.distanceFarePaise) || (breakdown.distanceFarePaise as number) < 0 ||
        breakdown.pricingModel !== "demo_base_plus_distance" ||
        (breakdown.baseFarePaise as number) + (breakdown.distanceFarePaise as number) !== data.farePaise ||
        typeof data.distanceKm !== "number" || !Number.isFinite(data.distanceKm) || data.distanceKm <= 0 ||
        !Number.isSafeInteger(data.durationMinutes) || (data.durationMinutes as number) <= 0 ||
        data.currency !== "INR" || !Number.isFinite(expiry) || expiry <= Date.now() ||
        !isRouteGeometry(data.geometry)
      ) {
        throw new Error("The quote service returned an invalid quote or route. Please try again.");
      }
      setRoute({
        km: data.distanceKm,
        mins: data.durationMinutes as number,
        path: "Road route",
        geometry: data.geometry,
        provider: "server-side routing provider",
      });
      setRouteError("");
      setQuote({
        quoteId: data.quoteId, farePaise: data.farePaise as number,
        baseFarePaise: breakdown.baseFarePaise as number,
        distanceFarePaise: breakdown.distanceFarePaise as number,
        distanceKm: data.distanceKm, durationMinutes: data.durationMinutes as number,
        expiresAt: new Date(expiry).toISOString(),
      });
      setBookingKey(`rideforge-${crypto.randomUUID()}`);
      setNotice(`Server quote received: ${data.distanceKm} km · ₹${((data.farePaise as number) / 100).toFixed(2)}. This checks the quote only; it does not create a ride.`);
      setApiState("idle");
    } catch (error) {
      setApiState("offline");
      const message = error instanceof Error && error.name === "AbortError"
        ? "The quote service took too long to respond. Please try again."
        : error instanceof Error && error.message !== "Failed to fetch"
          ? error.message
          : "We could not reach the quote service. Check the API and try again.";
      setRoute(null);
      setRouteError(message);
      setNotice(message);
    } finally {
      setRouteLoading(false);
    }
  }

  async function authenticate() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined) {
      setNotice("Configure VITE_API_BASE_URL to connect to the RideForge API.");
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
        verificationRequired?: boolean;
        message?: string;
      };
      if (response.status === 202 && data.verificationRequired) {
        setAuthPassword("");
        setNotice(data.message || "Check your email to verify your account, then sign in.");
        return;
      }
      if (!response.ok || !data.accessToken || !data.account?.email) {
        throw new Error(response.status === 409 ? "An account already exists for this email. Sign in instead."
          : response.status === 401 ? "Email or password is incorrect."
          : data.error || `Authentication failed (HTTP ${response.status}).`);
      }
      setAccount({ token: data.accessToken, email: data.account.email, displayName: data.account.displayName, role: data.account.role ?? "passenger" });
      setProfileName(data.account.displayName ?? "");
      setAuthPassword("");
      setNotice(`Signed in as ${data.account.email}. Your access token stays in memory for this session.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect to the authentication service.");
    }
  }

  async function saveProfile() {
    if (!account || profileBusy) return;
    const displayName = profileName.trim();
    if (displayName.length < 1 || displayName.length > 120) {
      setNotice("Display name must contain between 1 and 120 characters.");
      return;
    }
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined) {
      setNotice("Configure VITE_API_BASE_URL to update your profile.");
      return;
    }
    setProfileBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(apiUrl(base, "/api/v1/me"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Accept": "application/json",
          "Authorization": "Bearer " + account.token },
        body: JSON.stringify({ displayName }),
        signal: controller.signal,
      });
      const data = await response.json() as { displayName?: string; error?: string };
      if (!response.ok || typeof data.displayName !== "string") {
        throw new Error(data.error || `Profile update failed (HTTP ${response.status}).`);
      }
      setProfileName(data.displayName);
      setAccount(current => current ? { ...current, displayName: data.displayName } : current);
      setNotice("Your profile was updated.");
    } catch (error) {
      setNotice(error instanceof Error && error.name === "AbortError"
        ? "The profile service took too long to respond. Try again."
        : error instanceof Error ? error.message : "Could not update your profile.");
    } finally {
      window.clearTimeout(timeout);
      setProfileBusy(false);
    }
  }

  async function createBooking() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined || !quote || !account) {
      setNotice("Get a valid quote and sign in before confirming a ride.");
      return;
    }
    if (!quote.expiresAt || Date.parse(quote.expiresAt) <= Date.now()) {
      setQuote(null);
      setBookingKey("");
      setNotice("Your quote expired. Request a fresh quote before booking.");
      return;
    }
    const key = bookingKey || ("rideforge-" + crypto.randomUUID());
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
    if (base === undefined || !account || !ride) return;
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

  async function loadPassengerHistory() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined || !account || account.role !== "passenger") return;
    setHistoryBusy(true);
    try {
      const response = await fetch(apiUrl(base, "/api/v1/rides"), {
        headers: { "Accept": "application/json", "Authorization": "Bearer " + account.token },
      });
      const data = await response.json() as { rides?: typeof passengerHistory; error?: string };
      if (!response.ok || !Array.isArray(data.rides)) throw new Error(data.error || "Could not load trip history.");
      setPassengerHistory(data.rides);
      setReceiptRideId(null);
      setNotice("Trip history refreshed from the API.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load trip history.");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadSupportReports() {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined || !account || !["passenger", "driver"].includes(account.role)) return;
    try {
      const response = await fetch(apiUrl(base, "/api/v1/support/reports"), {
        headers: { "Accept": "application/json", "Authorization": "Bearer " + account.token },
      });
      const data = await response.json() as { reports?: typeof supportReports; error?: string };
      if (!response.ok || !Array.isArray(data.reports)) throw new Error(data.error || "Could not load support reports.");
      setSupportReports(data.reports);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load support reports.");
    }
  }

  async function submitSupportReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined || !account || !["passenger", "driver"].includes(account.role)) {
      setNotice("Sign in as a passenger or driver before submitting a report.");
      return;
    }
    setSupportBusy(true);
    try {
      const payload: { category: string; description: string; rideId?: string } = {
        category: supportCategory,
        description: supportDescription.trim(),
      };
      if (ride?.rideId) payload.rideId = ride.rideId;
      const response = await fetch(apiUrl(base, "/api/v1/support/reports"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": "Bearer " + account.token },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { id?: string; error?: string };
      if (response.status === 429) throw new Error("You've reached the five-report hourly limit. Try again later.");
      if (!response.ok || !data.id) throw new Error(data.error || "Could not submit support report.");
      setSupportDescription("");
      setNotice("Support report submitted. Reference: " + data.id + ". This demo does not contact emergency services.");
      await loadSupportReports();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit support report.");
    } finally {
      setSupportBusy(false);
    }
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setNotice("This browser does not support location access. Enter your pickup address instead.");
      return;
    }
    setLocationBusy(true);
    setNotice("Finding your current location…");
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const params = new URLSearchParams({
          format: "jsonv2",
          lat: String(position.coords.latitude),
          lon: String(position.coords.longitude),
          zoom: "18",
          addressdetails: "1",
        });
        const response = await fetch("https://nominatim.openstreetmap.org/reverse?" + params.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("Address lookup is temporarily unavailable.");
        const data = await response.json() as { display_name?: string };
        if (!data.display_name) throw new Error("We could not identify an address at your location. Enter it manually.");
        setPickup(data.display_name);
        setRoute(null); setRouteError(""); setQuote(null); setBookingKey(null); setRide(null);
        setNotice("Pickup set to your current location. Review the address before requesting a quote.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not look up your current address.");
      } finally { setLocationBusy(false); }
    }, error => {
      setLocationBusy(false);
      setNotice(error.code === error.PERMISSION_DENIED
        ? "Location permission was denied. Enter your pickup address manually."
        : "We could not get your location. Check device settings or enter your pickup manually.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }

  function clearBookingState() {
    setRoute(null); setRouteError(""); setQuote(null); setBookingKey(null); setRide(null);
  }

  function scrollToBooking() {
    document.getElementById("booking")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <div className="app-shell rideforge-app">
      <div className="app-announcement">
        <span className="status-indicator" data-state={apiHealth} />
        <span>{apiHealth === "online" ? "RIDEFORGE API CONNECTED" : apiHealth === "checking" ? "CHECKING RIDEFORGE SERVICES" : "SERVICE CONNECTION UNAVAILABLE"}</span>
        <span className="announcement-divider" />
        <span>NOIDA · BIKE RIDE DEMO</span>
        <span className="announcement-right">ACADEMIC PROJECT · NO LIVE TRANSPORT SERVICE</span>
      </div>

      <header className="site-header app-header">
        <a className="brand" href="#top" aria-label="RideForge home">
          <span className="brand-mark"><Bike size={22} strokeWidth={2.2} /></span>
          <span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span>
        </a>
        <nav className={menuOpen ? "main-nav nav-open" : "main-nav"} aria-label="Main navigation">
          <a className="nav-link active" href="#booking" onClick={() => setMenuOpen(false)}>Book a ride</a>
          <a className="nav-link" href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
          <a className="nav-link" href="/driver">Drive with us</a>
          <a className="nav-link" href="/admin">Admin</a>
        </nav>
        <div className="header-actions">
          <a href="#safety" className="safety-link"><ShieldCheck size={16} /> Safety & support</a>
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(v => !v)} aria-label={menuOpen ? "Close navigation" : "Open navigation"}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <button className="header-cta" onClick={scrollToBooking}>Start booking <ArrowRight size={16} /></button>
        </div>
      </header>

      <main id="top" className="app-main">
        <section className="booking-hero" id="booking">
          <div className="booking-hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> SIMPLE CITY RIDES, BUILT AROUND YOU</div>
            <h1>Your ride.<br /><em>Your route.<br />No guesswork.</em></h1>
            <p className="hero-description">Set your pickup and destination, see a real road route and a server-calculated fare, then request a ride. Clear steps, clear status.</p>
            <div className="hero-benefits">
              <div><span className="benefit-icon"><MapPin size={16} /></span><span><strong>Pickup that makes sense</strong><small>Use your location or enter an address.</small></span></div>
              <div><span className="benefit-icon"><Wallet size={16} /></span><span><strong>Fare before confirmation</strong><small>Only show prices returned by the API.</small></span></div>
              <div><span className="benefit-icon"><ShieldCheck size={16} /></span><span><strong>Ride status you can follow</strong><small>Live events with polling recovery.</small></span></div>
            </div>
            <a className="text-link" href="#how-it-works">See how RideForge works <ArrowRight size={15} /></a>
          </div>

          <div className="booking-card booking-card-primary">
            <div className="card-heading booking-card-heading">
              <div><span className="card-eyebrow">01 / PLAN YOUR JOURNEY</span><h2>Where are you going?</h2><p>Choose a pickup and drop-off to get started.</p></div>
              <span className="card-step">01 <span>/ 03</span></span>
            </div>

            <div className="location-fields">
              <div className="location-rail" aria-hidden="true"><span className="rail-origin" /><span className="rail-line" /><span className="rail-destination" /></div>
              <div className="field-stack">
                <label className="location-field"><span>Pickup location</span><div className="field-control"><MapPin size={17} /><input list="rideforge-location-suggestions" value={pickup} onChange={e => { setPickup(e.target.value); clearBookingState(); setNotice(""); }} aria-label="Pickup point" disabled={routeLoading} placeholder="Enter pickup address or landmark" autoComplete="street-address" /></div></label>
                <div className="field-separator" />
                <label className="location-field"><span>Drop-off location</span><div className="field-control"><Crosshair size={17} /><input list="rideforge-location-suggestions" value={destination} onChange={e => { setDestination(e.target.value); clearBookingState(); setNotice(""); }} aria-label="Drop-off point" disabled={routeLoading} placeholder="Where do you want to go?" autoComplete="off" /></div></label>
              </div>
              <button className="swap-button" aria-label="Swap pickup and drop-off" onClick={() => { setPickup(destination); setDestination(pickup); clearBookingState(); setNotice(""); }} disabled={routeLoading || !pickup || !destination}><ArrowLeft size={15} /><ArrowRight size={15} /></button>
              <datalist id="rideforge-location-suggestions">{locations.map(item => <option key={item} value={item} />)}</datalist>
            </div>

            <div className="booking-quick-actions">
              <button className="location-action" type="button" onClick={() => void useCurrentLocation()} disabled={locationBusy || routeLoading}>
                <LocateFixed size={15} /> {locationBusy ? "Finding your location…" : "Use my current location"}
              </button>
              <span>Suggestions are focused on Noida. You can also type a full address.</span>
            </div>

            <div className="quote-row">
              <div className="quote-icon"><Route size={18} /></div>
              <div className="quote-details"><strong>{routeLoading ? "Finding your route" : route ? "Route found" : "Your route estimate"}</strong><span>{routeLoading ? "Checking the road network and calculating your fare…" : route ? `${route.km.toFixed(1)} km · ${route.mins} min · Road route` : routeError || "Enter both locations and request a quote. No price is shown until the server confirms it."}</span></div>
              <button className="text-action help-button" onClick={() => setNotice("RideForge uses server-side geocoding and road routing. Fare is a demo estimate, not a commercial price commitment.")} aria-label="About route and fare estimates"><CircleHelp size={17} /></button>
            </div>

            <div className="fare-row">
              <div><span className="fare-label">YOUR ESTIMATED FARE</span><div className="fare-amount">{fare === null ? "—" : `₹${fare}`}<span>{fare === null ? "No quote yet" : "Server estimate"}</span></div></div>
              <div className="fare-note"><span className="fare-check"><Check size={13} /></span><span>{quote ? "Quote verified" : "No made-up prices"}<small>{quote?.expiresAt ? `Valid until ${new Date(quote.expiresAt).toLocaleTimeString()}` : "Price appears after a valid API response."}</small></span></div>
            </div>
            {quote && <div className="fare-breakdown" aria-label="Fare breakdown">
              <div><span>Base fare</span><strong>₹{(quote.baseFarePaise / 100).toFixed(2)}</strong></div>
              <div><span>Distance charge · {quote.distanceKm.toFixed(2)} km</span><strong>₹{(quote.distanceFarePaise / 100).toFixed(2)}</strong></div>
              <p>Demo tariff only. This is not a commercial fare commitment or a payment request.</p>
            </div>}

            <button className="book-button quote-button" onClick={requestRide} disabled={!valid || apiState === "checking" || apiHealth === "offline"}>
              {apiState === "checking" ? <><span className="button-spinner" /> Calculating route & fare…</> : <>Get fare estimate <ArrowRight size={17} /></>}
            </button>
            {!pickup.trim() || !destination.trim() ? <p className="form-hint">Add both locations to continue. Try “JIIT Sector 128, Noida” and “Botanical Garden Metro, Noida”.</p> : !valid ? <p className="form-hint">Pickup and drop-off must be different locations.</p> : null}
            {apiHealth === "offline" && <div className="service-warning" role="status">The RideForge API is not responding. Booking is disabled until the service is reachable. Please try again later.</div>}

            {((quote && !ride) || account) && account?.role !== "driver" && account?.role !== "admin" && (
              <div className="auth-panel booking-auth-panel">
                {account ? (
                  <div className="auth-session">
                    <div className="session-identity"><span className="confirmation-icon"><Check size={15} /></span><span><strong>You're signed in</strong><small>{account.displayName || account.email}</small></span></div>
                    <button className="text-action" onClick={() => { setAccount(null); setProfileName(""); setSupportReports([]); setPassengerHistory([]); setReceiptRideId(null); }}>Sign out</button>
                    {quote && !ride && <button className="book-button" onClick={createBooking}>Confirm ride request <ArrowRight size={17} /></button>}
                  </div>
                ) : (
                  <>
                    <div className="auth-panel-heading"><div><span className="card-eyebrow">02 / YOUR ACCOUNT</span><h3>Almost there. Who's riding?</h3><p>Sign in or create an account to request this ride.</p></div></div>
                    <div className="auth-switch" role="group" aria-label="Account action">
                      <button type="button" className={authMode === "register" ? "auth-tab selected" : "auth-tab"} onClick={() => setAuthMode("register")}>Create account</button>
                      <button type="button" className={authMode === "login" ? "auth-tab selected" : "auth-tab"} onClick={() => setAuthMode("login")}>Sign in</button>
                    </div>
                    {authMode === "register" && <label className="auth-field"><span>Your name</span><input required value={authName} onChange={event => setAuthName(event.target.value)} maxLength={120} autoComplete="name" placeholder="Full name" /></label>}
                    <label className="auth-field"><span>Email address</span><input required type="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} maxLength={254} autoComplete="email" placeholder="you@example.com" /></label>
                    <label className="auth-field"><span>Password</span><input required type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} maxLength={128} minLength={authMode === "register" ? 12 : 1} autoComplete={authMode === "register" ? "new-password" : "current-password"} placeholder={authMode === "register" ? "At least 12 characters" : "Your password"} /></label>
                    <button className="book-button" onClick={authenticate} disabled={!authEmail.trim() || !authPassword || (authMode === "register" && (!authName.trim() || authPassword.length < 12))}>{authMode === "register" ? "Create passenger account" : "Sign in and continue"} <ArrowRight size={17} /></button>
                    <p className="auth-caption">Email verification may be required. Your access token stays in memory and is cleared when you refresh or sign out.</p>
                  </>
                )}
              </div>
            )}

            {ride && <div className="ride-confirmation ride-status-card" role="status">
              <div className="confirmation-icon"><Check size={16} /></div>
              <div className="ride-status-copy"><span className="card-eyebrow">03 / RIDE STATUS</span><strong>{ride.status === "failed" ? "No driver found" : ride.status === "matching" || ride.status === "requested" ? "Finding your driver" : "Your ride request is active"}</strong><span>Reference: {ride.rideId}</span><small>Status: {ride.status.replaceAll("_", " ")} · Updates refresh automatically while this page is open.</small></div>
              <div className="ride-status-actions">
                {["requested", "matching", "assigned", "driver_arriving"].includes(ride.status) && account?.role === "passenger" && <button className="outline-button" onClick={cancelRide}>Cancel ride</button>}
                <button className="text-action" onClick={() => { setRide(null); setQuote(null); setBookingKey(null); setNotice("Your previous ride remains in trip history. You can plan another ride."); }}>New ride</button>
              </div>
            </div>}

            {account?.role === "passenger" && (
              <div className="passenger-tools">
                <details className="tool-disclosure"><summary>My profile</summary>
                  <label className="auth-field"><span>Display name</span><input value={profileName} onChange={event => setProfileName(event.target.value)} maxLength={120} autoComplete="name" /></label>
                  <button className="outline-button" onClick={saveProfile} disabled={profileBusy || !profileName.trim()}>{profileBusy ? "Saving…" : "Save profile"}</button>
                  <p className="auth-caption">Phone verification and notification preferences are not configured in this demo.</p>
                </details>
                <details className="tool-disclosure"><summary>My trip history</summary>
                  <button className="outline-button" onClick={loadPassengerHistory} disabled={historyBusy}>{historyBusy ? "Loading…" : "Refresh trip history"}</button>
                  {passengerHistory.length === 0 ? <p className="auth-caption">Your saved trips will appear here after you refresh.</p> : passengerHistory.map(item => <article className="ride-confirmation history-item" key={item.rideId}>
                    <div><strong>{item.pickup} → {item.destination}</strong><span>{item.status.replaceAll("_", " ")} · ₹{((item.finalFarePaise ?? item.farePaise) / 100).toFixed(2)}</span><small>{new Date(item.createdAt).toLocaleString()}</small></div>
                    {item.status === "completed" && <button className="text-action" onClick={() => setReceiptRideId(item.rideId)}>View receipt</button>}
                  </article>)}
                  {receiptRideId && passengerHistory.find(item => item.rideId === receiptRideId && item.status === "completed") && (() => {
                    const item = passengerHistory.find(entry => entry.rideId === receiptRideId)!;
                    return <div className="print-receipt"><div className="card-heading"><div><span className="card-eyebrow">RIDEFORGE · DEMO RECEIPT</span><h3>Trip receipt</h3></div><button className="outline-button" onClick={() => window.print()}>Print receipt</button></div><p><strong>Trip reference</strong><br />{item.rideId}</p><p><strong>Pickup</strong><br />{item.pickup}</p><p><strong>Destination</strong><br />{item.destination}</p><p><strong>Completed</strong><br />{item.completedAt ? new Date(item.completedAt).toLocaleString() : new Date(item.createdAt).toLocaleString()}</p><p><strong>Final fare</strong><br />₹{((item.finalFarePaise ?? item.farePaise) / 100).toFixed(2)} {item.currency}</p><p className="auth-caption">Demo trip record only. Not a tax invoice, proof of payment, or driver payout statement.</p></div>;
                  })()}
                </details>
                <details className="tool-disclosure"><summary>Help & support</summary>
                  <p className="auth-caption">Reports are sent to authorized administrators for review. This demo does not contact emergency services.</p>
                  <form className="auth-panel support-form" onSubmit={submitSupportReport}>
                    <label className="auth-field"><span>What is this about?</span><select value={supportCategory} onChange={event => setSupportCategory(event.target.value)}><option value="booking">Booking or trip status</option><option value="driver">Driver or vehicle</option><option value="payment">Fare or payment</option><option value="safety">Safety concern</option><option value="technical">Technical issue</option><option value="other">Other</option></select></label>
                    <label className="auth-field"><span>Describe the issue (10–2,000 characters)</span><textarea className="support-description" minLength={10} maxLength={2000} required value={supportDescription} onChange={event => setSupportDescription(event.target.value)} placeholder="Tell us what happened and what should be reviewed." rows={4} /></label>
                    {supportCategory === "safety" && <p className="support-disclaimer" role="note">This creates a report for review. It does not contact emergency services. If anyone is in immediate danger, contact local emergency services directly.</p>}
                    <button className="book-button" type="submit" disabled={supportBusy || supportDescription.trim().length < 10}>{supportBusy ? "Sending report…" : "Submit report"} <ArrowRight size={16} /></button>
                  </form>
                  <button className="outline-button" onClick={loadSupportReports}>Refresh my reports</button>
                  {supportReports.map(report => <article className="ride-confirmation history-item" key={report.id}><div><strong>#{report.id} · {report.category.replaceAll("_", " ")}</strong><span>{report.status.replaceAll("_", " ")}</span><small>{new Date(report.createdAt).toLocaleString()}</small></div></article>)}
                </details>
              </div>
            )}

            <AnimatePresence>{notice && <motion.div className={apiState === "offline" ? "inline-notice warning" : "inline-notice"} role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></motion.div>}</AnimatePresence>
            <div className="card-footnote"><ShieldCheck size={14} /><span>Your fare and ride status come from the RideForge API. This is an academic demonstration: no live transport service, emergency response or payment processing is provided.</span></div>
          </div>
        </section>

        <section className="route-section" aria-labelledby="route-heading">
          <div className="route-section-heading"><div><span className="section-kicker">YOUR JOURNEY, MADE CLEAR</span><h2 id="route-heading">See the route.<br /><em>Know the details.</em></h2></div><p>Once a quote succeeds, the real road geometry and trip estimate appear here. No simulated driver positions or made-up route metrics.</p></div>
          <div className="route-card route-card-large">
            <div className="route-card-top"><div><span className="card-eyebrow">ROUTE PREVIEW</span><h3>{route ? `${pickup} to ${destination}` : "Your route will appear here"}</h3></div><span className="route-live-badge"><span /> {route ? "ROUTE READY" : "WAITING FOR LOCATIONS"}</span></div>
            <div className="mini-map" role="group" aria-label={route ? `Route map from ${pickup} to ${destination}` : "Route map"}>
              <Suspense fallback={<div className="route-map-empty" role="status">Loading map…</div>}>
                {route ? <RouteMap geometry={route.geometry} pickup={pickup} destination={destination} driverLocation={rideDriverLocation} /> : <div className="route-map-empty"><div className="empty-map-icon"><Route size={26} /></div><strong>Nothing plotted yet</strong><span>Enter two locations above and get a fare estimate to see your road route.</span></div>}
              </Suspense>
              {route && <div className="map-attribution-note">Map data © OpenStreetMap contributors</div>}
            </div>
            <div className="route-stats"><div><span><Route size={15} /> DISTANCE</span><strong>{route ? route.km.toFixed(1) : "—"} <small>km</small></strong></div><div><span><Clock3 size={15} /> EST. TIME</span><strong>{route ? route.mins : "—"} <small>min</small></strong></div><div><span><Gauge size={15} /> ROUTE TYPE</span><strong>{route ? "Road" : "—"} <small>{route ? "route" : "not calculated"}</small></strong></div></div>
            <div className="route-disclaimer"><span className="disclaimer-dot" /> {route ? `Real road geometry via ${route.provider}; travel time may not include live traffic.` : routeLoading ? "Calculating route from the selected locations…" : routeError || "Your map and route metrics will load after a successful server quote."}</div>
          </div>
        </section>

        <section className="how-section" id="how-it-works">
          <div className="section-kicker">HOW RIDEFORGE WORKS</div>
          <h2>Three clear steps.<br /><em>One less thing to worry about.</em></h2>
          <div className="how-grid">
            <article><span>01</span><MapPin size={21} /><h3>Choose your locations</h3><p>Enter your pickup and destination, or use your device location for pickup.</p></article>
            <article><span>02</span><Route size={21} /><h3>Review your fare</h3><p>We request a road route and a transparent demo fare from the server before you confirm.</p></article>
            <article><span>03</span><Bike size={21} /><h3>Request and follow</h3><p>Sign in, request your ride and follow the status updates. Eligible drivers must be approved and online.</p></article>
          </div>
        </section>

        <section className="safety-section" id="safety">
          <div className="safety-icon"><ShieldCheck size={24} /></div>
          <div><span className="section-kicker">SAFETY & TRANSPARENCY</span><h2>Clear about what works — and what doesn't.</h2><p>RideForge is a portfolio and academic demo, not an operating taxi service. It does not process payments, verify identity documents, contact emergency services or guarantee a driver. Do not use it to arrange real-world travel.</p></div>
          <a href="/driver" className="outline-button">Driver workspace <ArrowRight size={15} /></a>
        </section>
      </main>

      <footer className="site-footer app-footer">
        <a className="brand footer-brand" href="#top"><span className="brand-mark"><Bike size={20} /></span><span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span></a>
        <span className="footer-note">Built for learning. Designed for clear journeys.</span>
        <div className="footer-links"><a href="#booking">Book a ride</a><a href="#how-it-works">How it works</a><a href="/driver">Driver portal</a><a href="/admin">Admin portal</a><a href="https://github.com/kaustubhdua/Smart_bike_taxi_platform" target="_blank" rel="noreferrer">GitHub</a></div>
        <span className="copyright">© 2026 RIDEFORGE</span>
      </footer>
      <div className="mobile-bottom-bar"><span><small>ESTIMATED FARE</small><strong>{fare === null ? "—" : `₹${fare}`}</strong></span><button onClick={scrollToBooking}>Book a ride <ArrowRight size={16} /></button></div>
    </div>
  );
}
