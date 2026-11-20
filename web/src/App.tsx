import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { geocodeNoidaLocation, reverseGeocodeNoidaLocation, type Coordinates } from "./geocoding";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import RideSafetyAndFeedback from "./components/RideSafetyAndFeedback";
const RouteMap = lazy(() => import("./components/RouteMap"));
const MapPicker = lazy(() => import("./components/MapPicker"));
import {
  ArrowLeft, ArrowRight, Bike, Check, CircleHelp, Clock3, Crosshair,
  Gauge, LocateFixed, MapPin, Menu, Route, ShieldCheck, Wallet, X, Bookmark, Trash2,
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
  const [savedRoutes, setSavedRoutes] = useState<Array<{ id: string; pickup: string; destination: string }>>([]);
  const [savedRoutesReady, setSavedRoutesReady] = useState(false);
  const [destination, setDestination] = useState("");
  const [pickupCoordinates, setPickupCoordinates] = useState<Coordinates | null>(null);
  const [destinationCoordinates, setDestinationCoordinates] = useState<Coordinates | null>(null);
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
  const [authBusy, setAuthBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapTarget, setMapTarget] = useState<"pickup" | "destination">("pickup");
  const [mapPointBusy, setMapPointBusy] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [account, setAccount] = useState<{ token: string; email: string; displayName?: string; role: string } | null>(null);
  const [ride, setRide] = useState<{ rideId: string; status: string } | null>(null);
  const [rideStartCode, setRideStartCode] = useState<string | null>(null);
  const [rideDriverRating, setRideDriverRating] = useState<{ count: number; average: number | null } | null>(null);
  const [rideDriverLocation, setRideDriverLocation] = useState<{ latitude: number; longitude: number; updatedAt: string } | null>(null);
  const [bookingKey, setBookingKey] = useState<string | null>(null);
  const [supportCategory, setSupportCategory] = useState("technical");
  const [supportDescription, setSupportDescription] = useState("");
  const [supportReports, setSupportReports] = useState<Array<{ id: string; rideId: string | null; category: string; description: string; status: string; resolutionNote: string; createdAt: string }>>([]);
  const [supportBusy, setSupportBusy] = useState(false);
  const [passengerHistory, setPassengerHistory] = useState<Array<{ rideId: string; status: string; pickup: string; destination: string; farePaise: number; finalFarePaise?: number; currency: string; createdAt: string; completedAt?: string }>>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [receiptRideId, setReceiptRideId] = useState<string | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<Array<{ id: string; label: string; address: string; latitude: number; longitude: number }>>([]);
  const [savedPlaceLabel, setSavedPlaceLabel] = useState("Home");
  const [savedPlacesBusy, setSavedPlacesBusy] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("rideforge:saved-routes:v1");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSavedRoutes(parsed.filter((item): item is { id: string; pickup: string; destination: string } =>
            item && typeof item.id === "string" && typeof item.pickup === "string" &&
            typeof item.destination === "string" && item.pickup.length <= 240 && item.destination.length <= 240
          ).slice(0, 8));
        }
      }
    } catch {
      // Saved shortcuts are optional; a blocked or malformed browser store must not block booking.
    } finally {
      setSavedRoutesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!account || account.role !== "passenger") {
      setSavedPlaces([]);
      return;
    }
    void loadAccountSavedPlaces(account.token);
  }, [account?.token, account?.role]);

  useEffect(() => {
    if (!savedRoutesReady) return;
    try { window.localStorage.setItem("rideforge:saved-routes:v1", JSON.stringify(savedRoutes)); }
    catch { /* Private browsing or storage limits can disable this convenience without affecting rides. */ }
  }, [savedRoutes, savedRoutesReady]);

  function saveCurrentRoute() {
    const from = pickup.trim();
    const to = destination.trim();
    if (from.length < 3 || to.length < 3 || from.toLocaleLowerCase("en-US") === to.toLocaleLowerCase("en-US")) {
      setNotice("Enter two different locations before saving this route.");
      return;
    }
    const duplicate = savedRoutes.some(item => item.pickup.toLowerCase() === from.toLowerCase() && item.destination.toLowerCase() === to.toLowerCase());
    if (duplicate) { setNotice("This route is already in your saved places."); return; }
    if (savedRoutes.length >= 8) { setNotice("You can save up to eight favourite routes. Remove one before adding another."); return; }
    setSavedRoutes(current => [...current, { id: crypto.randomUUID(), pickup: from, destination: to }]);
    setNotice("Favourite route saved on this device only. It is not uploaded to your account.");
  }

  function applySavedRoute(item: { pickup: string; destination: string }) {
    setPickup(item.pickup);
    setDestination(item.destination);
    setPickupCoordinates(null);
    setDestinationCoordinates(null);
    clearBookingState();
    setNotice("Saved route loaded. Request a fresh server quote before booking.");
  }

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
        const data = await response.json() as { rideId?: string; status?: string; startCode?: string; driverRating?: { count?: number; average?: number | null }; driverLocation?: { latitude?: number; longitude?: number; updatedAt?: string } };
        applyStatus(data);
        if (data.rideId === ride.rideId) {
          setRideStartCode(typeof data.startCode === "string" ? data.startCode : null);
          setRideDriverRating(data.driverRating && typeof data.driverRating.count === "number" ? { count: data.driverRating.count, average: data.driverRating.average ?? null } : null);
        }
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
    let serverResponded = false;
    let apiRequestStarted = false;
    try {
      setNotice("Resolving pickup and drop-off locations…");
      const pickupPoint = pickupCoordinates ?? await geocodeNoidaLocation(pickup);
      if (!pickupCoordinates) setPickupCoordinates(pickupPoint);
      const destinationPoint = destinationCoordinates ?? await geocodeNoidaLocation(destination);
      if (!destinationCoordinates) setDestinationCoordinates(destinationPoint);

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        apiRequestStarted = true;
        response = await fetch(apiUrl(base, "/api/v1/routes/quote"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            pickup: { label: pickup, latitude: pickupPoint.latitude, longitude: pickupPoint.longitude },
            destination: { label: destination, latitude: destinationPoint.latitude, longitude: destinationPoint.longitude },
          }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
      serverResponded = true;
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
      setApiHealth("online");
      setApiState("idle");
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "The quote service took too long to respond. Please try again."
        : error instanceof Error && error.message !== "Failed to fetch"
          ? error.message
          : "We could not reach the quote service. Check the API and try again.";
      setApiState(apiRequestStarted && !serverResponded ? "offline" : "idle");
      setRoute(null);
      setRouteError(message);
      if (apiRequestStarted) setApiHealth(serverResponded ? "online" : "offline");
      setNotice(message);
    } finally {
      setRouteLoading(false);
    }
  }

  async function authenticate() {
    if (authBusy) return;
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined) {
      setNotice("Configure VITE_API_BASE_URL to connect to the RideForge API.");
      return;
    }
    setAuthBusy(true);
    try {
      const payload = authMode === "register"
        ? { email: authEmail, displayName: authName, password: authPassword }
        : { email: authEmail, password: authPassword };
      const response = await fetch(apiUrl(base, "/api/v1/auth/" + authMode), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
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
      if (data.account.role !== "passenger") {
        throw new Error(data.account.role === "driver"
          ? "This is a driver account. Choose Driver on the RideForge home screen to manage ride offers."
          : "Passenger access is required to book rides.");
      }
      setAccount({ token: data.accessToken, email: data.account.email, displayName: data.account.displayName, role: "passenger" });
      setProfileName(data.account.displayName ?? "");
      setAuthPassword("");
      setNotice(`Signed in as ${data.account.email}. Your access token stays in memory for this session.`);
    } catch (error) {
      setNotice(error instanceof Error && error.name === "TimeoutError"
        ? "Authentication took too long. Check your connection and try again."
        : error instanceof Error ? error.message : "Could not connect to the authentication service.");
    } finally {
      setAuthBusy(false);
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

  async function loadAccountSavedPlaces(accessToken = account?.token) {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base || !accessToken) return;
    try {
      const response = await fetch(apiUrl(base, "/api/v1/saved-places"), {
        headers: { Accept: "application/json", Authorization: "Bearer " + accessToken },
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json() as { places?: Array<{ id: string; label: string; address: string; latitude: number; longitude: number }>; error?: string };
      if (!response.ok || !Array.isArray(data.places)) throw new Error(data.error || "Saved places could not be loaded.");
      setSavedPlaces(data.places.filter(place => typeof place.id === "string" && typeof place.latitude === "number" && Number.isFinite(place.latitude) && typeof place.longitude === "number" && Number.isFinite(place.longitude)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Saved places could not be loaded.");
    }
  }

  async function saveAccountPlace(target: "pickup" | "destination") {
    if (!account || savedPlacesBusy) return;
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    const address = (target === "pickup" ? pickup : destination).trim();
    const currentCoordinates = target === "pickup" ? pickupCoordinates : destinationCoordinates;
    const label = savedPlaceLabel.trim();
    if (!base) { setNotice("Saved places require the configured RideForge API."); return; }
    if (label.length < 1 || label.length > 40 || address.length < 3) { setNotice("Enter a saved-place label and a valid address first."); return; }
    setSavedPlacesBusy(true);
    try {
      const coordinates = currentCoordinates ?? await geocodeNoidaLocation(address);
      const response = await fetch(apiUrl(base, "/api/v1/saved-places"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + account.token },
        body: JSON.stringify({ label, address, latitude: coordinates.latitude, longitude: coordinates.longitude }),
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save this place.");
      if (target === "pickup") setPickupCoordinates(coordinates);
      else setDestinationCoordinates(coordinates);
      await loadAccountSavedPlaces();
      setNotice(label + " saved to your RideForge account.");
      setSavedPlaceLabel(label === "Home" ? "Work" : "Home");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this place.");
    } finally { setSavedPlacesBusy(false); }
  }

  async function removeAccountPlace(id: string) {
    if (!account || savedPlacesBusy) return;
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base) return;
    setSavedPlacesBusy(true);
    try {
      const response = await fetch(apiUrl(base, "/api/v1/saved-places/" + encodeURIComponent(id)), {
        method: "DELETE", headers: { Accept: "application/json", Authorization: "Bearer " + account.token },
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not remove this place.");
      setSavedPlaces(current => current.filter(place => place.id !== id));
      setNotice("Saved place removed from your account.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove this place.");
    } finally { setSavedPlacesBusy(false); }
  }

  function applyAccountPlace(place: { address: string; latitude: number; longitude: number }, target: "pickup" | "destination") {
    const coordinates = { latitude: place.latitude, longitude: place.longitude };
    if (target === "pickup") { setPickup(place.address); setPickupCoordinates(coordinates); }
    else { setDestination(place.address); setDestinationCoordinates(coordinates); }
    clearBookingState();
    setNotice("Saved place applied. Request a fresh fare quote before booking.");
  }

  async function createBooking() {
    if (bookingBusy) return;
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
    setBookingBusy(true);
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
        signal: AbortSignal.timeout(15000),
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
      setNotice(error instanceof Error && error.name === "TimeoutError"
        ? "The booking request timed out. Retry safely; the same request reference will be reused."
        : error instanceof Error ? error.message : "Could not create the ride request.");
    } finally {
      setBookingBusy(false);
    }
  }

  async function cancelRide() {
    if (cancelBusy) return;
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (base === undefined || !account || !ride) return;
    setCancelBusy(true);
    try {
      const response = await fetch(apiUrl(base, "/api/v1/rides/" + encodeURIComponent(ride.rideId) + "/cancel"), {
        method: "POST",
        headers: { "Accept": "application/json", "Authorization": "Bearer " + account.token },
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json() as { status?: string; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error || "Cancellation failed (HTTP " + response.status + ").");
      setRide({ ...ride, status: data.status });
      setNotice("Ride request cancelled.");
    } catch (error) {
      setNotice(error instanceof Error && error.name === "TimeoutError"
        ? "Cancellation timed out. Refresh the ride status before retrying."
        : error instanceof Error ? error.message : "Could not cancel this ride request.");
    } finally {
      setCancelBusy(false);
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
      setNotice("Support report submitted. Reference: " + data.id + ". Support reports are recorded for review; they do not contact emergency services.");
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
      const coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      try {
        let label = "Current GPS location";
        try {
          const reverse = await reverseGeocodeNoidaLocation(coordinates);
          label = reverse.displayName;
        } catch {
          // GPS coordinates are still usable when reverse address lookup is unavailable.
        }
        setPickup(label);
        setPickupCoordinates(coordinates);
        setRoute(null); setRouteError(""); setQuote(null); setBookingKey(null); setRide(null);
        setNotice("Pickup set from your device location. Review it before requesting a quote.");
      } finally {
        setLocationBusy(false);
      }
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

  async function selectMapPoint(coordinates: Coordinates) {
    if (mapPointBusy) return;
    if (coordinates.latitude < 28.25 || coordinates.latitude > 28.75 ||
        coordinates.longitude < 77.15 || coordinates.longitude > 77.65) {
      setNotice("Choose a point within the Noida service preview area.");
      return;
    }
    setMapPointBusy(true);
    try {
      const place = await reverseGeocodeNoidaLocation(coordinates);
      if (mapTarget === "pickup") {
        setPickup(place.displayName);
        setPickupCoordinates(coordinates);
      } else {
        setDestination(place.displayName);
        setDestinationCoordinates(coordinates);
      }
      clearBookingState();
      setMapPickerOpen(false);
      setNotice((mapTarget === "pickup" ? "Pickup" : "Drop-off") + " selected from the map. Review the address before requesting a quote.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not resolve that map location. Try a nearby public landmark.");
    } finally {
      setMapPointBusy(false);
    }
  }

  function scrollToBooking() {
    document.getElementById("booking")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <div className="app-shell rideforge-app">
      <div className="app-announcement" role="region" aria-label="Service connection status" aria-live="polite">
        <span className="status-indicator" data-state={apiHealth} />
        <span>{apiHealth === "online" ? "RIDEFORGE API CONNECTED" : apiHealth === "checking" ? "CHECKING RIDEFORGE SERVICES" : "SERVICE CONNECTION UNAVAILABLE"}</span>
        <span className="announcement-divider" />
        <span>NOIDA · RIDE PLANNING</span>
        <span className="announcement-right">PREVIEW ENVIRONMENT · NO ACTIVE DRIVER FLEET</span>
      </div>

      <header className="site-header app-header">
        <a className="brand" href="#top">
          <span className="brand-mark"><Bike size={22} strokeWidth={2.2} /></span>
          <span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span>
        </a>
        <nav id="rideforge-primary-navigation" className={menuOpen ? "main-nav nav-open" : "main-nav"} aria-label="Main navigation">
          <a className="nav-link active" aria-current="page" href="#booking" onClick={() => setMenuOpen(false)}>Book a ride</a>
          <a className="nav-link" href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
          <a className="nav-link" href="/driver">Drive with us</a>
          <a className="nav-link" href="/admin">Admin console</a>
        </nav>
        <div className="header-actions">
          <a href="#safety" className="safety-link"><ShieldCheck size={16} /> Safety & support</a>
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(v => !v)} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="rideforge-primary-navigation">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <button className="header-cta" onClick={scrollToBooking}>Start booking <ArrowRight size={16} /></button>
        </div>
      </header>

      <main id="top" className="app-main">
        <section className="booking-hero" id="booking">
          <div className="booking-hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> NOIDA RIDE PLANNING · CLEAR BY DESIGN</div>
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
              <div><span className="card-eyebrow">01 / PLAN YOUR JOURNEY</span><h2>Where to?</h2><p>Choose a pickup and drop-off to get started.</p></div>
              <span className="card-step">01 <span>/ 03</span></span>
            </div>

            <div className="location-fields">
              <div className="location-rail" aria-hidden="true"><span className="rail-origin" /><span className="rail-line" /><span className="rail-destination" /></div>
              <div className="field-stack">
                <label className="location-field"><span>Pickup location</span><div className="field-control"><MapPin size={17} /><input list="rideforge-location-suggestions" value={pickup} onChange={e => { setPickup(e.target.value); setPickupCoordinates(null); clearBookingState(); setNotice(""); }} aria-label="Pickup point" disabled={routeLoading} placeholder="Enter pickup address or landmark" autoComplete="street-address" /></div></label>
                <div className="field-separator" />
                <label className="location-field"><span>Drop-off location</span><div className="field-control"><Crosshair size={17} /><input list="rideforge-location-suggestions" value={destination} onChange={e => { setDestination(e.target.value); setDestinationCoordinates(null); clearBookingState(); setNotice(""); }} aria-label="Drop-off point" disabled={routeLoading} placeholder="Where do you want to go?" autoComplete="off" /></div></label>
              </div>
              <button className="swap-button" aria-label="Swap pickup and drop-off" onClick={() => { setPickup(destination); setDestination(pickup); setPickupCoordinates(destinationCoordinates); setDestinationCoordinates(pickupCoordinates); clearBookingState(); setNotice(""); }} disabled={routeLoading || !pickup || !destination}><ArrowLeft size={15} /><ArrowRight size={15} /></button>
              <datalist id="rideforge-location-suggestions">{locations.map(item => <option key={item} value={item} />)}</datalist>
            </div>

            <div className="map-picker-actions" aria-label="Choose locations on map">
              <button type="button" className="location-action" onClick={() => { setMapTarget("pickup"); setMapPickerOpen(true); }} disabled={routeLoading || mapPointBusy}>
                <MapPin size={15} /> Pick pickup on map
              </button>
              <button type="button" className="location-action" onClick={() => { setMapTarget("destination"); setMapPickerOpen(true); }} disabled={routeLoading || mapPointBusy}>
                <Crosshair size={15} /> Pick drop-off on map
              </button>
            </div>
            {mapPickerOpen && <div className="map-picker-panel">
              <div className="map-picker-heading">
                <strong>{mapPointBusy ? "Resolving selected location…" : <>Tap the map to choose {mapTarget === "pickup" ? "pickup" : "drop-off"}</>}</strong>
                <button type="button" className="text-action" onClick={() => setMapPickerOpen(false)} disabled={mapPointBusy}>Close map</button>
              </div>
              <Suspense fallback={<div className="route-map-empty" role="status">Loading location map…</div>}>
                <MapPicker target={mapTarget} pickupCoordinates={pickupCoordinates} destinationCoordinates={destinationCoordinates} onSelect={selectMapPoint} />
              </Suspense>
            </div>}

            <div className="booking-quick-actions">
              <button className="location-action" type="button" onClick={() => void useCurrentLocation()} disabled={locationBusy || routeLoading}>
                <LocateFixed size={15} /> {locationBusy ? "Finding your location…" : "Use my current location"}
              </button>
              <span>Noida-focused suggestions. Use public landmarks in this preview; do not enter home addresses or sensitive locations. Address lookup uses a public geocoding service only after you request a quote. © OpenStreetMap contributors.</span>
            </div>

            <div className="route-presets" aria-label="Suggested real routes">
              <span>TRY A ROUTE</span>
              <button type="button" onClick={() => { setPickup("JIIT Sector 128, Noida"); setDestination("Sector 18 Market, Noida"); setPickupCoordinates(null); setDestinationCoordinates(null); clearBookingState(); setNotice("Suggested route selected. Get a fresh server quote to see live route data."); }} disabled={routeLoading}>
                JIIT → Sector 18 <ArrowRight size={13} />
              </button>
              <button type="button" onClick={() => { setPickup("JIIT Sector 128, Noida"); setDestination("Botanical Garden Metro, Noida"); setPickupCoordinates(null); setDestinationCoordinates(null); clearBookingState(); setNotice("Suggested route selected. Get a fresh server quote to see live route data."); }} disabled={routeLoading}>
                JIIT → Botanical Garden <ArrowRight size={13} />
              </button>
              <button type="button" onClick={saveCurrentRoute} disabled={routeLoading || !pickup.trim() || !destination.trim()} aria-label="Save route to this device">
                <Bookmark size={13} /> Save route
              </button>
            </div>
            {savedRoutes.length > 0 && <div className="saved-routes" aria-label="Saved favourite routes">
              <span>YOUR SAVED ROUTES · THIS DEVICE</span>
              {savedRoutes.map(item => <div className="saved-route-item" key={item.id}>
                <button type="button" onClick={() => applySavedRoute(item)} disabled={routeLoading} title={item.pickup + " to " + item.destination}>
                  <MapPin size={13} /><span>{item.pickup} <b>→</b> {item.destination}</span>
                </button>
                <button type="button" className="saved-route-remove" aria-label={"Remove saved route " + item.pickup + " to " + item.destination} onClick={() => setSavedRoutes(current => current.filter(route => route.id !== item.id))}><Trash2 size={13}/></button>
              </div>)}
            </div>}

            <div className="quote-row">
              <div className="quote-icon"><Route size={18} /></div>
              <div className="quote-details"><strong>{routeLoading ? "Finding your route" : route ? "Route found" : "Your route estimate"}</strong><span>{routeLoading ? "Checking the road network and calculating your fare…" : route ? `${route.km.toFixed(1)} km · ${route.mins} min · Road route` : routeError || "Address lookup runs only when you request a quote. The server calculates the route and fare; no price appears before it responds."}</span></div>
              <button className="text-action help-button" onClick={() => setNotice("RideForge resolves locations in your browser after an explicit action. The server calculates road distance, duration and the preview fare.")} aria-label="About route and fare estimates"><CircleHelp size={17} /></button>
            </div>

            <div className="fare-row">
              <div><span className="fare-label">YOUR ESTIMATED FARE</span><div className="fare-amount">{fare === null ? "—" : `₹${fare}`}<span>{fare === null ? "No quote yet" : "Server estimate"}</span></div></div>
              <div className="fare-note"><span className="fare-check"><Check size={13} /></span><span>{quote ? "Quote verified" : "No invented price"}<small>{quote?.expiresAt ? `Valid until ${new Date(quote.expiresAt).toLocaleTimeString()}` : "Price appears after a valid API response."}</small></span></div>
            </div>
            {quote && <div className="fare-breakdown" aria-label="Fare breakdown">
              <div><span>Base fare</span><strong>₹{(quote.baseFarePaise / 100).toFixed(2)}</strong></div>
              <div><span>Distance charge · {quote.distanceKm.toFixed(2)} km</span><strong>₹{(quote.distanceFarePaise / 100).toFixed(2)}</strong></div>
              <p>Preview tariff only. Not a commercial fare or a payment request.</p>
            </div>}

            <button aria-label="Get server fare quote — Get fare estimate" className="book-button quote-button" onClick={requestRide} disabled={!valid || apiState === "checking"}>
              {apiState === "checking" ? <><span className="button-spinner" /> Calculating route & fare…</> : <>Get fare estimate <ArrowRight size={17} /></>}
            </button>
            {!pickup.trim() || !destination.trim() ? <p className="form-hint">Add both locations to continue. Try “JIIT Sector 128, Noida” and “Botanical Garden Metro, Noida”.</p> : !valid ? <p className="form-hint">Pickup and drop-off must be different locations.</p> : null}
            {apiHealth === "offline" && <div className="service-warning" role="status">The RideForge API did not respond to the last health check. You can still try a quote; the result will show whether booking services are available.</div>}

            {account?.role !== "driver" && account?.role !== "admin" && (
              <div className="auth-panel booking-auth-panel">
                {account ? (
                  <div className="auth-session">
                    <div className="session-identity"><span className="confirmation-icon"><Check size={15} /></span><span><strong>You're signed in</strong><small>{account.displayName || account.email}</small></span></div>
                    <button className="text-action" onClick={() => { setAccount(null); setProfileName(""); setSupportReports([]); setPassengerHistory([]); setReceiptRideId(null); }}>Sign out</button>
                    {quote && !ride && <button className="book-button" onClick={createBooking} disabled={bookingBusy}>{bookingBusy ? "Requesting ride…" : "Confirm ride request"} <ArrowRight size={17} /></button>}
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
                    <button className="book-button" onClick={authenticate} disabled={authBusy || !authEmail.trim() || !authPassword || (authMode === "register" && (!authName.trim() || authPassword.length < 12))}>{authBusy ? "Authenticating…" : authMode === "register" ? "Create passenger account" : "Sign in and continue"} <ArrowRight size={17} /></button>
                    <p className="auth-caption">Email verification may be required. Your access token stays in memory and is cleared when you refresh or sign out.</p>
                  </>
                )}
              </div>
            )}

            {ride && <div className="ride-confirmation ride-status-card" role="status">
              <div className="confirmation-icon"><Check size={16} /></div>
              <div className="ride-status-copy"><span className="card-eyebrow">03 / RIDE STATUS</span><strong>{ride.status === "failed" ? "No driver found" : ride.status === "matching" || ride.status === "requested" ? "Finding your driver" : "Your ride request is active"}</strong><span>Reference: {ride.rideId}</span><small>Status: {ride.status.replaceAll("_", " ")} · Updates refresh automatically while this page is open.</small></div>
              <div className="ride-status-actions">
                {["requested", "matching", "assigned", "driver_arriving"].includes(ride.status) && account?.role === "passenger" && <button className="outline-button" onClick={cancelRide} disabled={cancelBusy}>{cancelBusy ? "Cancelling…" : "Cancel request"}</button>}
                <button className="text-action" onClick={() => { setRide(null); setQuote(null); setBookingKey(null); setNotice("Your previous ride remains in trip history. You can plan another ride."); }}>New ride</button>
              </div>
            </div>}

            {ride && account?.role === "passenger" && import.meta.env.VITE_API_BASE_URL !== undefined && (
              <RideSafetyAndFeedback base={String(import.meta.env.VITE_API_BASE_URL)} token={account.token} rideId={ride.rideId} status={ride.status} role="passenger" startCode={rideStartCode} driverRating={rideDriverRating} />
            )}

            {account?.role === "passenger" && (
              <div className="passenger-tools">
                <details className="tool-disclosure" open={savedPlaces.length > 0}>
                  <summary>Saved places · account synced</summary>
                  <p className="auth-caption">Save up to 20 places to your account. They are available after you sign in on another device.</p>
                  <label className="auth-field"><span>Place label</span><input value={savedPlaceLabel} onChange={event => setSavedPlaceLabel(event.target.value)} maxLength={40} placeholder="Home, Work or another name" /></label>
                  <div className="button-row">
                    <button className="outline-button" onClick={() => void saveAccountPlace("pickup")} disabled={savedPlacesBusy || !pickup.trim()}>Save current pickup</button>
                    <button className="outline-button" onClick={() => void saveAccountPlace("destination")} disabled={savedPlacesBusy || !destination.trim()}>Save current drop-off</button>
                  </div>
                  {savedPlacesBusy && <p className="auth-caption" role="status">Updating your saved places…</p>}
                  {savedPlaces.length === 0 ? <p className="auth-caption">No account-saved places yet. Save a pickup or drop-off after entering an address.</p> : savedPlaces.map(place => (
                    <article className="ride-confirmation saved-place-account" key={place.id}>
                      <div><strong>{place.label}</strong><span>{place.address}</span></div>
                      <div className="saved-place-actions">
                        <button className="text-action" onClick={() => applyAccountPlace(place, "pickup")}>Use as pickup</button>
                        <button className="text-action" onClick={() => applyAccountPlace(place, "destination")}>Use as drop-off</button>
                        <button className="text-action" onClick={() => void removeAccountPlace(place.id)} disabled={savedPlacesBusy} aria-label={"Remove saved place " + place.label}>Remove</button>
                      </div>
                    </article>
                  ))}
                </details>
                <details className="tool-disclosure"><summary>My profile</summary>
                  <label className="auth-field"><span>Display name</span><input value={profileName} onChange={event => setProfileName(event.target.value)} maxLength={120} autoComplete="name" /></label>
                  <button className="outline-button" onClick={saveProfile} disabled={profileBusy || !profileName.trim()}>{profileBusy ? "Saving…" : "Save profile"}</button>
                  <p className="auth-caption">Phone verification and notification preferences are not configured in preview.</p>
                </details>
                <details className="tool-disclosure"><summary>My trip history</summary>
                  <button className="outline-button" onClick={loadPassengerHistory} disabled={historyBusy}>{historyBusy ? "Loading…" : "Refresh trip history"}</button>
                  {passengerHistory.length === 0 ? <p className="auth-caption">Your saved trips will appear here after you refresh.</p> : passengerHistory.map(item => <article className="ride-confirmation history-item" key={item.rideId}>
                    <div><strong>{item.pickup} → {item.destination}</strong><span>{item.status.replaceAll("_", " ")} · ₹{((item.finalFarePaise ?? item.farePaise) / 100).toFixed(2)}</span><small>{new Date(item.createdAt).toLocaleString()}</small></div>
                    {item.status === "completed" && <button className="text-action" onClick={() => setReceiptRideId(item.rideId)}>View trip record</button>}
                  </article>)}
                  {receiptRideId && passengerHistory.find(item => item.rideId === receiptRideId && item.status === "completed") && (() => {
                    const item = passengerHistory.find(entry => entry.rideId === receiptRideId)!;
                    return <div className="print-receipt"><div className="card-heading"><div><span className="card-eyebrow">RIDEFORGE · TRIP RECORD</span><h3>Trip receipt</h3></div><button className="outline-button" onClick={() => window.print()}>Print receipt</button></div><p><strong>Trip reference</strong><br />{item.rideId}</p><p><strong>Pickup</strong><br />{item.pickup}</p><p><strong>Destination</strong><br />{item.destination}</p><p><strong>Completed</strong><br />{item.completedAt ? new Date(item.completedAt).toLocaleString() : new Date(item.createdAt).toLocaleString()}</p><p><strong>Final fare</strong><br />₹{((item.finalFarePaise ?? item.farePaise) / 100).toFixed(2)} {item.currency}</p><p className="auth-caption">Trip record only. Not a tax invoice, proof of payment, or driver payout statement.</p></div>;
                  })()}
                </details>
                <details className="tool-disclosure"><summary>Help & support</summary>
                  <p className="auth-caption">Reports are sent to authorized administrators for review. They do not contact emergency services.</p>
                  <form className="auth-panel support-form" onSubmit={submitSupportReport}>
                    <label className="auth-field"><span>What is this about?</span><select value={supportCategory} onChange={event => setSupportCategory(event.target.value)}><option value="booking">Booking or trip status</option><option value="driver">Driver or vehicle</option><option value="payment">Fare or payment</option><option value="safety">Safety concern</option><option value="technical">Technical issue</option><option value="other">Other</option></select></label>
                    <label className="auth-field"><span>Describe the issue (10–2,000 characters)</span><textarea className="support-description" minLength={10} maxLength={2000} required value={supportDescription} onChange={event => setSupportDescription(event.target.value)} placeholder="Tell us what happened and what should be reviewed." rows={4} /></label>
                    {supportCategory === "safety" && <p className="support-disclaimer" role="note">This creates a report for review. It does not contact emergency services. If anyone is in immediate danger, contact local emergency services directly.</p>}
                    <button className="book-button" type="submit" disabled={supportBusy || supportDescription.trim().length < 10}>{supportBusy ? "Sending report…" : "Submit support report"} <ArrowRight size={16} /></button>
                  </form>
                  <button className="outline-button" onClick={loadSupportReports}>Refresh my reports</button>
                  {supportReports.map(report => <article className="ride-confirmation history-item" key={report.id}><div><strong>#{report.id} · {report.category.replaceAll("_", " ")}</strong><span>{report.status.replaceAll("_", " ")}</span><small>{new Date(report.createdAt).toLocaleString()}</small></div></article>)}
                </details>
              </div>
            )}

            <AnimatePresence>{notice && <motion.div className={apiState === "offline" ? "inline-notice warning" : "inline-notice"} role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></motion.div>}</AnimatePresence>
            <div className="card-footnote"><ShieldCheck size={14} /><span>Your fare and ride status come from the RideForge API. RideForge is in preview: no active driver fleet, emergency-response integration or payment processing is connected.</span></div>
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
            <article><span>02</span><Route size={21} /><h3>Review your fare</h3><p>We request a real road route and a clearly labelled preview tariff from the server before you continue.</p></article>
            <article><span>03</span><Bike size={21} /><h3>Request and follow</h3><p>Sign in, request your ride and follow the status updates. Eligible drivers must be approved and online. The backend creates time-limited offers for eligible, approved drivers who are online with a fresh location.</p></article>
          </div>
        </section>

        <section className="safety-section" id="safety">
          <div className="safety-icon"><ShieldCheck size={24} /></div>
          <div><span className="section-kicker">SAFETY & TRANSPARENCY</span><h2>Clear about what works — and what doesn't.</h2><p>RideForge is currently in preview and has no active driver fleet. Payments, identity-document verification and emergency-response services are not connected. Driver location is shared only while a driver is online; no historical GPS trail is retained. Do not use this preview to arrange real-world travel.</p></div>
          <a href="/driver" className="outline-button">Driver workspace <ArrowRight size={15} /></a>
        </section>
      </main>

      <footer className="site-footer app-footer">
        <a className="brand footer-brand" href="#top"><span className="brand-mark"><Bike size={20} /></span><span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span></a>
        <span className="footer-note">Built around clear journeys and transparent estimates.</span>
        <div className="footer-links"><a href="#booking">Book a ride</a><a href="#how-it-works">How it works</a><a href="/driver">Driver portal</a><a href="/admin">Admin portal</a><a href="https://github.com/kaustubhdua/Smart_bike_taxi_platform" target="_blank" rel="noreferrer">GitHub</a></div>
        <span className="copyright">© 2026 RIDEFORGE</span>
      </footer>
      <div className="mobile-bottom-bar" role="region" aria-label="Quick booking summary"><span><small>ESTIMATED FARE</small><strong>{fare === null ? "—" : `₹${fare}`}</strong></span><button onClick={scrollToBooking}>Book a ride <ArrowRight size={16} /></button></div>
    </div>
  );
}
