import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, RefreshCw, ShieldCheck, X } from "lucide-react";

type WorkspaceMode = "driver" | "admin";
type RideRequest = {
  rideId: string;
  pickup: string;
  destination: string;
  farePaise: number;
  distanceMeters?: number;
  pickupDistanceMeters?: number;
};
type Metrics = { ridesByStatus: Record<string, number>; onlineDrivers: number; pendingOutboxEvents?: number; deadLetteredOutboxEvents?: number; oldestPendingOutboxAgeSeconds?: number };
type AuditEvent = { id: string; actorEmail: string; action: string; targetType: string; targetId: string; details: Record<string, unknown>; createdAt: string };
type Driver = { driverId: string; email: string; displayName: string; vehicleRegistration: string; approved: boolean; online: boolean; createdAt: string };
type SupportReport = { id: string; rideId: string | null; category: string; description: string; status: string; resolutionNote: string; createdAt: string; updatedAt: string; resolvedAt: string | null; reporterEmail: string; reporterName: string };
type DriverHistory = { rides: Array<{ rideId: string; status: string; pickup: string; destination: string; farePaise: number; finalFarePaise?: number; createdAt: string; completedAt?: string }>; grossCompletedFarePaise: number; currency: string; note: string };
type AdminRideSearchItem = { rideId: string; status: string; passengerEmail: string; driverEmail: string | null; pickup: string; destination: string; farePaise: number; createdAt: string; updatedAt: string };

export default function OperationsWorkspace({ mode }: { mode: WorkspaceMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [online, setOnline] = useState(false);
  const [rides, setRides] = useState<RideRequest[]>([]);
  const [activeRide, setActiveRide] = useState<{ rideId: string; status: string } | null>(null);
  const [driverHistory, setDriverHistory] = useState<DriverHistory | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [driverEmail, setDriverEmail] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPassword, setDriverPassword] = useState("");
  const [vehicleRegistration, setVehicleRegistration] = useState("");
  const [supportReports, setSupportReports] = useState<SupportReport[]>([]);
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [rideSearch, setRideSearch] = useState("");
  const [rideStatusFilter, setRideStatusFilter] = useState("");
  const [adminRideResults, setAdminRideResults] = useState<AdminRideSearchItem[]>([]);
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");

  async function signIn() {
    if (apiBase === undefined) { setError("Set VITE_API_BASE_URL to connect to the API."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(apiBase + "/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json() as { accessToken?: string; account?: { role?: string }; error?: string };
      const requiredRole = mode === "driver" ? "driver" : "admin";
      if (!response.ok || !data.accessToken) throw new Error(response.status === 401 ? "Email or password is incorrect." : data.error || "Sign-in failed.");
      if (data.account?.role !== requiredRole) throw new Error(requiredRole === "driver"
        ? "This account is not provisioned as a driver."
        : "Administrator access is required.");
      setToken(data.accessToken); setPassword("");
      setError("Signed in. Protected operations are enabled for this session.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally { setBusy(false); }
  }

  async function request(path: string, init: RequestInit = {}) {
    if (apiBase === undefined || !token) throw new Error("Sign in to continue.");
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", "Bearer " + token);
    const response = await fetch(apiBase + path, { ...init, headers });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed (HTTP " + response.status + ").");
    return data;
  }

  function getCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("This browser does not support location. Availability cannot be enabled."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        error => reject(new Error(error.code === error.PERMISSION_DENIED
          ? "Location permission is required to go online."
          : "Could not get a fresh location. Check device location settings and retry.")),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
  }

  async function syncDriverLocation(): Promise<{ latitude: number; longitude: number }> {
    const location = await getCurrentLocation();
    await request("/api/v1/driver/availability", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ online: true, latitude: location.latitude, longitude: location.longitude }),
    });
    setDriverLocation(location);
    return location;
  }

  async function refreshQueue() {
    setBusy(true);
    try {
      if (online) await syncDriverLocation();
      const data = await request("/api/v1/driver/rides");
      setRides(Array.isArray(data.rides) ? data.rides as RideRequest[] : []);
      setError("Ride queue refreshed from the API.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Queue unavailable."); }
    finally { setBusy(false); }
  }

  async function refreshDriverHistory() {
    setBusy(true);
    try {
      const data = await request("/api/v1/driver/rides/history");
      if (!Array.isArray(data.rides) || typeof data.grossCompletedFarePaise !== "number" || typeof data.note !== "string") {
        throw new Error("The API returned an invalid driver history.");
      }
      setDriverHistory(data as unknown as DriverHistory);
      setError("Driver trip history refreshed.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Driver history unavailable."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (mode !== "driver" || !online || !token || apiBase === undefined) return;
    let cancelled = false;
    const refreshLocationAndQueue = async () => {
      try {
        const location = await new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
            () => reject(new Error("Location refresh failed")),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
          );
        });
        await request("/api/v1/driver/availability", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ online: true, latitude: location.latitude, longitude: location.longitude }),
        });
        if (cancelled) return;
        setDriverLocation(location);
        const data = await request("/api/v1/driver/rides");
        if (!cancelled) setRides(Array.isArray(data.rides) ? data.rides as RideRequest[] : []);
      } catch {
        if (!cancelled) setError("Could not refresh your live location. Dispatch eligibility will expire if the location remains stale; check permission and connection.");
      }
    };
    const interval = window.setInterval(() => { void refreshLocationAndQueue(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [mode, online, token, apiBase]);

  async function refreshLocationNow() {
    if (!online) {
      setError("Go online before refreshing your location.");
      return;
    }
    setBusy(true);
    try {
      const location = await getCurrentLocation();
      await request("/api/v1/driver/availability", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ online: true, latitude: location.latitude, longitude: location.longitude }),
      });
      setDriverLocation(location);
      const data = await request("/api/v1/driver/rides");
      setRides(Array.isArray(data.rides) ? data.rides as RideRequest[] : []);
      setError("Your location and nearby ride queue were refreshed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh your location.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailability() {
    setBusy(true);
    try {
      if (online) {
        if (!driverLocation) throw new Error("No last known location is available. Refresh location before going offline.");
        await request("/api/v1/driver/availability", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ online: false }),
        });
        setOnline(false);
        setRides([]);
        setError("You are offline. Your location will no longer be refreshed.");
      } else {
        const location = await getCurrentLocation();
        await request("/api/v1/driver/availability", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ online: true, latitude: location.latitude, longitude: location.longitude }),
        });
        setDriverLocation(location);
        setOnline(true);
        setError("You are online. Your fresh location is shared while you remain online.");
        const data = await request("/api/v1/driver/rides");
        setRides(Array.isArray(data.rides) ? data.rides as RideRequest[] : []);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Availability update failed."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (mode !== "driver" || !token || apiBase === undefined || !activeRide ||
        ["completed", "cancelled", "failed"].includes(activeRide.status)) return;
    let disposed = false;
    let lastEventId = 0;
    let currentStatus = activeRide.status;
    const abort = new AbortController();
    const terminal = () => ["completed", "cancelled", "failed"].includes(currentStatus);
    const statusRank: Record<string, number> = {
      requested: 0, matching: 1, assigned: 2, driver_arriving: 3,
      in_progress: 4, completed: 5, cancelled: 5, failed: 5,
    };
    const applyStatus = (data: { rideId?: string; status?: string }) => {
      if (disposed || data.rideId !== activeRide.rideId || typeof data.status !== "string" ||
          statusRank[data.status] === undefined || statusRank[currentStatus] === undefined ||
          statusRank[data.status] < statusRank[currentStatus]) return;
      currentStatus = data.status;
      setActiveRide(current => current && current.rideId === data.rideId
        ? { rideId: current.rideId, status: data.status! } : current);
    };
    const refresh = async () => {
      try {
        const data = await request("/api/v1/rides/" + encodeURIComponent(activeRide.rideId));
        if (typeof data.rideId === "string" && typeof data.status === "string") applyStatus(data as { rideId: string; status: string });
      } catch { /* Keep last known state until REST recovery succeeds. */ }
    };
    const pause = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));
    const connect = async () => {
      while (!disposed && !terminal()) {
        try {
          const headers: Record<string, string> = { Accept: "text/event-stream", Authorization: "Bearer " + token };
          if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
          const response = await fetch(apiBase + "/api/v1/rides/" + encodeURIComponent(activeRide.rideId) + "/events", {
            headers, signal: abort.signal,
          });
          if (!response.ok || !response.body) throw new Error("Ride event stream unavailable");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!disposed && !terminal()) {
            const chunk = await reader.read();
            if (chunk.done) break;
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
                } else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
              }
              if (id > lastEventId) lastEventId = id;
              if (dataLines.length) {
                try { applyStatus(JSON.parse(dataLines.join("\n")) as { rideId?: string; status?: string }); }
                catch { /* Ignore malformed frames; REST polling recovers the state. */ }
              }
              boundary = buffer.indexOf("\n\n");
            }
          }
          if (!disposed && !terminal()) await pause(250);
        } catch {
          if (disposed || abort.signal.aborted || terminal()) break;
          await pause(1500);
        }
      }
    };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    const resync = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    void refresh();
    void connect();
    return () => {
      disposed = true;
      abort.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [mode, token, apiBase, activeRide?.rideId]);

  async function rideAction(rideId: string, action: "accept" | "decline" | "driver_arriving" | "in_progress" | "completed") {
    setBusy(true);
    try {
      const suffix = action === "accept" ? "/accept" : action === "decline" ? "/decline" : "/status";
      const data = await request("/api/v1/driver/rides/" + encodeURIComponent(rideId) + suffix, {
        method: action === "driver_arriving" || action === "in_progress" || action === "completed" ? "PUT" : "POST",
        ...(action === "driver_arriving" || action === "in_progress" || action === "completed"
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: action }) }
          : {}),
      });
      if (typeof data.rideId !== "string" || typeof data.status !== "string") throw new Error("The API returned an invalid ride state.");
      if (action !== "decline") setActiveRide({ rideId: data.rideId, status: data.status });
      setRides(current => current.filter(ride => ride.rideId !== rideId));
      setError(action === "decline"
        ? "Request declined for your driver account. The passenger's booking remains active for other drivers."
        : "Ride state saved: " + data.status + ".");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ride action failed."); }
    finally { setBusy(false); }
  }

  async function signOutDriver() {
    setBusy(true);
    try {
      if (online && driverLocation) {
        await request("/api/v1/driver/availability", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ online: false }),
        });
      }
      setError("Driver signed out and availability stopped.");
    } catch {
      setError("Signed out locally. If the offline request failed, dispatch eligibility expires when the location becomes stale.");
    } finally {
      setToken(""); setRides([]); setActiveRide(null); setDriverHistory(null); setOnline(false); setDriverLocation(null);
      setBusy(false);
    }
  }

  async function refreshMetrics() {
    setBusy(true);
    try {
      const data = await request("/api/v1/admin/metrics");
      if (!data.ridesByStatus || typeof data.onlineDrivers !== "number") throw new Error("The API returned invalid metrics.");
      setMetrics({
        ridesByStatus: data.ridesByStatus as Record<string, number>,
        onlineDrivers: data.onlineDrivers,
        pendingOutboxEvents: typeof data.pendingOutboxEvents === "number" ? data.pendingOutboxEvents : undefined,
        deadLetteredOutboxEvents: typeof data.deadLetteredOutboxEvents === "number" ? data.deadLetteredOutboxEvents : undefined,
        oldestPendingOutboxAgeSeconds: typeof data.oldestPendingOutboxAgeSeconds === "number" ? data.oldestPendingOutboxAgeSeconds : undefined,
      });
      setError("Operational metrics refreshed from PostgreSQL.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Metrics unavailable."); }
    finally { setBusy(false); }
  }

  async function refreshAudit() {
    setBusy(true);
    try {
      const data = await request("/api/v1/admin/audit?limit=50");
      if (!Array.isArray(data.events)) throw new Error("The API returned an invalid audit history.");
      setAuditEvents(data.events as AuditEvent[]);
      setError("Administrative audit history refreshed from PostgreSQL.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Audit history unavailable."); }
    finally { setBusy(false); }
  }

  async function refreshSupportReports() {
    setBusy(true);
    try {
      const data = await request("/api/v1/admin/support-reports");
      if (!Array.isArray(data.reports)) throw new Error("The API returned an invalid support report list.");
      setSupportReports(data.reports as SupportReport[]);
      setError("Support reports refreshed from PostgreSQL.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Support reports unavailable."); }
    finally { setBusy(false); }
  }

  async function searchAdminRides(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (rideSearch.trim()) params.set("q", rideSearch.trim());
      if (rideStatusFilter) params.set("status", rideStatusFilter);
      const queryString = params.toString();
      const data = await request("/api/v1/admin/rides" + (queryString ? "?" + queryString : ""));
      if (!Array.isArray(data.rides)) throw new Error("The API returned an invalid ride search result.");
      setAdminRideResults(data.rides as AdminRideSearchItem[]);
      setError("Ride search refreshed from PostgreSQL.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ride search unavailable."); }
    finally { setBusy(false); }
  }

  async function updateSupportReport(report: SupportReport, status: "in_review" | "resolved" | "rejected") {
    const resolutionNote = (resolutionNotes[report.id] ?? "").trim();
    if ((status === "resolved" || status === "rejected") && resolutionNote.length < 10) {
      setError("Add a resolution note of at least 10 characters before resolving or rejecting a report.");
      return;
    }
    setBusy(true);
    try {
      await request("/api/v1/admin/support-reports/" + encodeURIComponent(report.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolutionNote }),
      });
      setError("Support report #" + report.id + " updated to " + status.replaceAll("_", " ") + ".");
      await refreshSupportReports();
      await refreshAudit();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Support report update failed."); }
    finally { setBusy(false); }
  }

  async function refreshDrivers() {
    setBusy(true);
    try {
      const data = await request("/api/v1/admin/drivers");
      if (!Array.isArray(data.drivers)) throw new Error("The API returned an invalid driver list.");
      setDrivers(data.drivers as Driver[]);
      setError("Driver approval state refreshed from PostgreSQL.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Driver list unavailable."); }
    finally { setBusy(false); }
  }

  async function provisionDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await request("/api/v1/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: driverEmail, displayName: driverName, password: driverPassword, vehicleRegistration }),
      });
      if (typeof data.driverId !== "string" || data.approved !== false) throw new Error("The API did not return a new unapproved driver.");
      setDriverEmail(""); setDriverName(""); setDriverPassword(""); setVehicleRegistration("");
      setError("Driver provisioned as pending approval. Review the profile before enabling dispatch.");
      await refreshDrivers();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Driver provisioning failed."); }
    finally { setBusy(false); }
  }

  async function changeDriverApproval(driver: Driver) {
    setBusy(true);
    try {
      await request("/api/v1/admin/drivers/" + encodeURIComponent(driver.driverId) + "/approval", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: !driver.approved }),
      });
      setError(driver.approved ? "Driver suspended and taken offline." : "Driver approved. The driver must still sign in and explicitly go online.");
      await refreshDrivers();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Driver approval update failed."); }
    finally { setBusy(false); }
  }

  return (
    <section className="booking-section" id="operations">
      <div className="section-intro">
        <span className="section-kicker">{mode === "driver" ? "DRIVER WORKSPACE" : "OPERATIONS CONSOLE"}</span>
        <h2>{mode === "driver" ? "Your next ride starts here." : "Operations, backed by data."}</h2>
        <p>{mode === "driver" ? "Sign in with a provisioned driver account to manage availability and ride requests." : "Admin metrics come from the API and PostgreSQL, not browser-side mock data."}</p>
      </div>
      <div className="booking-layout">
        <div className="booking-card">
          {!token ? (
            <div className="auth-panel">
              <div className="card-heading"><div><span className="card-eyebrow">SECURE ACCESS</span><h3>{mode === "driver" ? "Driver sign in" : "Admin sign in"}</h3></div><ShieldCheck size={20} /></div>
              <label className="auth-field"><span>Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" maxLength={254} placeholder="you@example.com" /></label>
              <label className="auth-field"><span>Password</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" maxLength={128} placeholder="Your password" /></label>
              <button className="book-button" onClick={signIn} disabled={busy || !email || !password}>Sign in securely <ArrowRight size={18} /></button>
              <p className="auth-caption">Driver and admin accounts must be provisioned by an administrator. This form cannot grant roles.</p>
            </div>
          ) : mode === "driver" ? (
            <>
              <div className="card-heading"><div><span className="card-eyebrow">DRIVER SESSION</span><h3>Availability and rides</h3></div><button className="text-action" onClick={() => { void signOutDriver(); }} disabled={busy}>Sign out</button></div>
              <p className="auth-caption">Location permission is used to refresh your dispatch eligibility while online. The queue requires a recent location.</p>
              <button className="book-button" onClick={toggleAvailability} disabled={busy}>{online ? "Go offline" : "Use my location and go online"} <ArrowRight size={18} /></button>
              {driverLocation && <p className="auth-caption" aria-live="polite">Last location: {driverLocation.latitude.toFixed(4)}, {driverLocation.longitude.toFixed(4)}</p>}
              {online && <button className="outline-button" onClick={refreshLocationNow} disabled={busy}><RefreshCw size={15} /> Refresh my location</button>}
              <button className="outline-button" onClick={refreshQueue} disabled={busy}><RefreshCw size={15} /> Refresh ride queue</button>
              {activeRide && <div className="ride-confirmation" role="status"><span className="confirmation-icon"><Check size={16} /></span><div><strong>Active ride</strong><span>{activeRide.rideId}</span><small>Status: {activeRide.status}</small></div>
                {activeRide.status === "assigned" && <button className="text-action" onClick={() => rideAction(activeRide.rideId, "driver_arriving")} disabled={busy}>Mark arriving</button>}
                {activeRide.status === "driver_arriving" && <button className="text-action" onClick={() => rideAction(activeRide.rideId, "in_progress")} disabled={busy}>Start trip</button>}
                {activeRide.status === "in_progress" && <button className="text-action" onClick={() => rideAction(activeRide.rideId, "completed")} disabled={busy}>Complete trip</button>}
              </div>}
              <div className="driver-queue"><h3>Available requests ({rides.length})</h3>
                {rides.length === 0 ? <p>Queue is empty or has not been loaded yet.</p> : rides.map(ride => <div className="ride-confirmation" key={ride.rideId}><div><strong>{ride.pickup} → {ride.destination}</strong><span>{typeof ride.pickupDistanceMeters === "number" ? "Pickup " + (ride.pickupDistanceMeters / 1000).toFixed(1) + " km away · " : ""}{ride.distanceMeters ? (ride.distanceMeters / 1000).toFixed(1) + " km trip · " : ""}₹{(ride.farePaise / 100).toFixed(2)}</span><small>{ride.rideId}</small></div><div className="ride-actions"><button className="text-action" onClick={() => rideAction(ride.rideId, "accept")} disabled={busy}><Check size={15} /> Accept</button><button className="text-action" onClick={() => rideAction(ride.rideId, "decline")} disabled={busy}><X size={15} /> Decline</button></div></div>)}
              </div>
              <div className="driver-queue">
                <div className="driver-panel-head"><h3>Trip history</h3><button className="outline-button" onClick={refreshDriverHistory} disabled={busy}><RefreshCw size={15} /> Refresh trip history</button></div>
                {driverHistory && <>
                  <p>Gross completed fares: <strong>₹{(driverHistory.grossCompletedFarePaise / 100).toFixed(2)}</strong></p>
                  <p className="auth-caption">{driverHistory.note}</p>
                  {driverHistory.rides.length === 0 ? <p>No trips recorded yet.</p> : driverHistory.rides.map(item => <div className="ride-confirmation" key={item.rideId}>
                    <div><strong>{item.pickup} → {item.destination}</strong><span>{item.status.replaceAll("_", " ")} · ₹{((item.finalFarePaise ?? item.farePaise) / 100).toFixed(2)}</span><small>{new Date(item.createdAt).toLocaleString()} · {item.rideId}</small></div>
                  </div>)}
                </>}
              </div>
            </>
          ) : (
            <>
              <div className="card-heading"><div><span className="card-eyebrow">ADMIN SESSION</span><h3>Operations and driver approval</h3></div><button className="text-action" onClick={() => { setToken(""); setMetrics(null); setDrivers([]); setAuditEvents([]); setSupportReports([]); setResolutionNotes({}); setAdminRideResults([]); setRideSearch(""); setRideStatusFilter(""); }}>Sign out</button></div>
              <div className="button-row">
                <button className="book-button" onClick={refreshMetrics} disabled={busy}>Refresh metrics <ArrowRight size={18} /></button>
                <button className="outline-button" onClick={refreshDrivers} disabled={busy}><RefreshCw size={15} /> Refresh drivers</button>
                <button className="outline-button" onClick={refreshAudit} disabled={busy}><ShieldCheck size={15} /> Refresh audit history</button>
              </div>
              <form className="auth-panel" onSubmit={searchAdminRides}>
                <div className="card-heading"><div><span className="card-eyebrow">RIDE INVESTIGATION</span><h3>Search rides</h3></div></div>
                <label className="auth-field"><span>Ride ID, passenger/driver email, or pickup/drop-off</span><input maxLength={160} value={rideSearch} onChange={event => setRideSearch(event.target.value)} placeholder="Search by ID, email or address" /></label>
                <label className="auth-field"><span>Status filter</span><select value={rideStatusFilter} onChange={event => setRideStatusFilter(event.target.value)}>
                  <option value="">All statuses</option><option value="requested">Requested</option><option value="matching">Matching</option><option value="assigned">Assigned</option><option value="driver_arriving">Driver arriving</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="failed">Failed</option>
                </select></label>
                <button className="book-button" type="submit" disabled={busy}>Search rides <ArrowRight size={18} /></button>
              </form>
              <div className="driver-queue"><h3>Ride search results ({adminRideResults.length})</h3>
                {adminRideResults.length === 0 ? <p>Search by ride reference, account email, or address to investigate a ride.</p> : adminRideResults.map(item => <article className="ride-confirmation" key={item.rideId}>
                  <div><strong>{item.status.replaceAll("_", " ")} · ₹{(item.farePaise / 100).toFixed(2)}</strong><span>{item.pickup} → {item.destination}</span><small>Passenger: {item.passengerEmail} · Driver: {item.driverEmail ?? "unassigned"} · {item.rideId}</small><small>{new Date(item.createdAt).toLocaleString()}</small></div>
                </article>)}
              </div>
              {metrics && <div className="driver-queue"><h3>PostgreSQL-backed counts</h3><p>Online drivers: <strong>{metrics.onlineDrivers}</strong></p><p>Outbox backlog: <strong>{metrics.pendingOutboxEvents ?? "—"}</strong> pending · <strong>{metrics.deadLetteredOutboxEvents ?? "—"}</strong> dead-lettered · oldest pending {metrics.oldestPendingOutboxAgeSeconds ?? "—"}s</p>{(metrics.deadLetteredOutboxEvents ?? 0) > 0 && <p role="alert">Dead-lettered ride events need operator review.</p>}{Object.entries(metrics.ridesByStatus).map(([status, count]) => <div className="ride-confirmation" key={status}><strong>{status.replaceAll("_", " ")}</strong><span>{count} ride(s)</span></div>)}</div>}
              <div className="driver-queue"><h3>Privileged action audit ({auditEvents.length})</h3>
                {auditEvents.length === 0 ? <p>Refresh audit history to inspect driver provisioning, approval and suspension events.</p> : auditEvents.map(event => <div className="ride-confirmation" key={event.id}>
                  <div><strong>{event.action.replaceAll(".", " ")}</strong><span>{event.actorEmail} · {event.targetType} · {event.targetId}</span><small>{new Date(event.createdAt).toLocaleString()} · {JSON.stringify(event.details)}</small></div>
                </div>)}
              </div>
              <form className="auth-panel" onSubmit={provisionDriver}>
                <div className="card-heading"><div><span className="card-eyebrow">TRUSTED ONBOARDING</span><h3>Provision a driver</h3></div><ShieldCheck size={20} /></div>
                <p className="auth-caption">New accounts start unapproved and cannot go online until you explicitly approve them. Provisioning is not identity or document verification.</p>
                <label className="auth-field"><span>Driver name</span><input required maxLength={120} value={driverName} onChange={event => setDriverName(event.target.value)} autoComplete="name" /></label>
                <label className="auth-field"><span>Email</span><input required type="email" maxLength={254} value={driverEmail} onChange={event => setDriverEmail(event.target.value)} autoComplete="email" /></label>
                <label className="auth-field"><span>Temporary password (12+ characters)</span><input required type="password" minLength={12} maxLength={128} value={driverPassword} onChange={event => setDriverPassword(event.target.value)} autoComplete="new-password" /></label>
                <label className="auth-field"><span>Vehicle registration</span><input required minLength={3} maxLength={32} value={vehicleRegistration} onChange={event => setVehicleRegistration(event.target.value)} autoComplete="off" /></label>
                <button className="book-button" type="submit" disabled={busy || !driverEmail || !driverName || driverPassword.length < 12 || !vehicleRegistration}>Create pending driver <ArrowRight size={18} /></button>
              </form>
              <div className="driver-queue"><h3>Driver review ({drivers.length})</h3>
                {drivers.length === 0 ? <p>Refresh the driver list to review provisioned accounts.</p> : drivers.map(driver => <div className="ride-confirmation" key={driver.driverId}>
                  <div><strong>{driver.displayName}</strong><span>{driver.email} · {driver.vehicleRegistration}</span><small>{driver.approved ? "Approved" : "Pending approval"} · {driver.online ? "Online" : "Offline"}</small></div>
                  <button className="text-action" onClick={() => changeDriverApproval(driver)} disabled={busy}>{driver.approved ? "Suspend" : "Approve"}</button>
                </div>)}
              </div>
              <div className="driver-queue">
                <div className="driver-panel-head"><h3>Support and incident reports ({supportReports.length})</h3><button className="outline-button" onClick={refreshSupportReports} disabled={busy}><RefreshCw size={15} /> Refresh reports</button></div>
                {supportReports.length === 0 ? <p>Refresh reports to review passenger and driver submissions. Safety reports are records for follow-up; the demo does not contact emergency services.</p> : supportReports.map(report => <article className="ride-confirmation support-review-item" key={report.id}>
                  <div>
                    <strong>#{report.id} · {report.category.replaceAll("_", " ")} · {report.status.replaceAll("_", " ")}</strong>
                    <span>{report.reporterName} ({report.reporterEmail}){report.rideId ? " · Ride " + report.rideId : ""}</span>
                    <p>{report.description}</p>
                    {report.resolutionNote && <small>Resolution: {report.resolutionNote}</small>}
                    {report.status === "open" || report.status === "in_review" ? <>
                      <label className="auth-field"><span>Resolution note (required to resolve/reject)</span><textarea className="support-description" minLength={10} maxLength={2000} rows={3} value={resolutionNotes[report.id] ?? ""} onChange={event => setResolutionNotes(current => ({ ...current, [report.id]: event.target.value }))} /></label>
                      <div className="button-row">
                        {report.status === "open" && <button className="outline-button" onClick={() => updateSupportReport(report, "in_review")} disabled={busy}>Mark in review</button>}
                        <button className="book-button" onClick={() => updateSupportReport(report, "resolved")} disabled={busy || (resolutionNotes[report.id] ?? "").trim().length < 10}>Resolve</button>
                        <button className="outline-button" onClick={() => updateSupportReport(report, "rejected")} disabled={busy || (resolutionNotes[report.id] ?? "").trim().length < 10}>Reject</button>
                      </div>
                    </> : <small>Terminal report state · {report.resolvedAt ? new Date(report.resolvedAt).toLocaleString() : "updated"}</small>}
                  </div>
                </article>)}
              </div>
            </>
          )}
          {error && <div className="inline-notice" role="status" aria-live="polite">{error}</div>}
        </div>
      </div>
    </section>
  );
}
