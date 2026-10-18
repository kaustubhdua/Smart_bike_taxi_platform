import { useState } from "react";
import { ArrowRight, Check, RefreshCw, ShieldCheck } from "lucide-react";

type WorkspaceMode = "driver" | "admin";
type RideRequest = {
  rideId: string;
  pickup: string;
  destination: string;
  farePaise: number;
  distanceMeters?: number;
};
type Metrics = { ridesByStatus: Record<string, number>; onlineDrivers: number };
type Driver = { driverId: string; email: string; displayName: string; vehicleRegistration: string; approved: boolean; online: boolean; createdAt: string };

export default function OperationsWorkspace({ mode }: { mode: WorkspaceMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [online, setOnline] = useState(false);
  const [rides, setRides] = useState<RideRequest[]>([]);
  const [activeRide, setActiveRide] = useState<{ rideId: string; status: string } | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverEmail, setDriverEmail] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPassword, setDriverPassword] = useState("");
  const [vehicleRegistration, setVehicleRegistration] = useState("");
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");

  async function signIn() {
    if (!apiBase) { setError("Set VITE_API_BASE_URL to connect to the API."); return; }
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
    if (!apiBase || !token) throw new Error("Sign in to continue.");
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", "Bearer " + token);
    const response = await fetch(apiBase + path, { ...init, headers });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed (HTTP " + response.status + ").");
    return data;
  }

  async function refreshQueue() {
    setBusy(true);
    try {
      const data = await request("/api/v1/driver/rides");
      setRides(Array.isArray(data.rides) ? data.rides as RideRequest[] : []);
      setError("Ride queue refreshed from the API.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Queue unavailable."); }
    finally { setBusy(false); }
  }

  async function toggleAvailability() {
    const lat = Number(latitude), lon = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setError("Enter a valid latitude and longitude before changing availability."); return;
    }
    setBusy(true);
    try {
      await request("/api/v1/driver/availability", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ online: !online, latitude: lat, longitude: lon }),
      });
      setOnline(value => !value);
      setError(online ? "You are offline." : "You are online. Refresh the queue to see available requests.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Availability update failed."); }
    finally { setBusy(false); }
  }

  async function rideAction(rideId: string, action: "accept" | "driver_arriving" | "in_progress" | "completed") {
    setBusy(true);
    try {
      const data = await request("/api/v1/driver/rides/" + encodeURIComponent(rideId) + (action === "accept" ? "/accept" : "/status"), {
        method: action === "accept" ? "POST" : "PUT",
        ...(action === "accept" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: action }) }),
      });
      if (typeof data.rideId !== "string" || typeof data.status !== "string") throw new Error("The API returned an invalid ride state.");
      setActiveRide({ rideId: data.rideId, status: data.status });
      setRides(current => current.filter(ride => ride.rideId !== rideId));
      setError("Ride state saved: " + data.status + ".");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ride action failed."); }
    finally { setBusy(false); }
  }

  async function refreshMetrics() {
    setBusy(true);
    try {
      const data = await request("/api/v1/admin/metrics");
      if (!data.ridesByStatus || typeof data.onlineDrivers !== "number") throw new Error("The API returned invalid metrics.");
      setMetrics({ ridesByStatus: data.ridesByStatus as Record<string, number>, onlineDrivers: data.onlineDrivers });
      setError("Operational metrics refreshed from PostgreSQL.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Metrics unavailable."); }
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

  async function provisionDriver(event: React.FormEvent<HTMLFormElement>) {
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
              <div className="card-heading"><div><span className="card-eyebrow">DRIVER SESSION</span><h3>Availability and rides</h3></div><button className="text-action" onClick={() => { setToken(""); setRides([]); setActiveRide(null); setOnline(false); }}>Sign out</button></div>
              <div className="location-fields">
                <label className="auth-field"><span>Latitude</span><input inputMode="decimal" value={latitude} onChange={event => setLatitude(event.target.value)} placeholder="Latitude" /></label>
                <label className="auth-field"><span>Longitude</span><input inputMode="decimal" value={longitude} onChange={event => setLongitude(event.target.value)} placeholder="Longitude" /></label>
              </div>
              <button className="book-button" onClick={toggleAvailability} disabled={busy}>{online ? "Go offline" : "Go online"} <ArrowRight size={18} /></button>
              <button className="outline-button" onClick={refreshQueue} disabled={busy}><RefreshCw size={15} /> Refresh ride queue</button>
              {activeRide && <div className="ride-confirmation" role="status"><span className="confirmation-icon"><Check size={16} /></span><div><strong>Active ride</strong><span>{activeRide.rideId}</span><small>Status: {activeRide.status}</small></div>
                {activeRide.status === "assigned" && <button className="text-action" onClick={() => rideAction(activeRide.rideId, "driver_arriving")} disabled={busy}>Mark arriving</button>}
                {activeRide.status === "driver_arriving" && <button className="text-action" onClick={() => rideAction(activeRide.rideId, "in_progress")} disabled={busy}>Start trip</button>}
                {activeRide.status === "in_progress" && <button className="text-action" onClick={() => rideAction(activeRide.rideId, "completed")} disabled={busy}>Complete trip</button>}
              </div>}
              <div className="driver-queue"><h3>Available requests ({rides.length})</h3>
                {rides.length === 0 ? <p>Queue is empty or has not been loaded yet.</p> : rides.map(ride => <div className="ride-confirmation" key={ride.rideId}><div><strong>{ride.pickup} → {ride.destination}</strong><span>{ride.distanceMeters ? (ride.distanceMeters / 1000).toFixed(1) + " km · " : ""}₹{(ride.farePaise / 100).toFixed(2)}</span><small>{ride.rideId}</small></div><button className="text-action" onClick={() => rideAction(ride.rideId, "accept")} disabled={busy}>Accept</button></div>)}
              </div>
            </>
          ) : (
            <>
              <div className="card-heading"><div><span className="card-eyebrow">ADMIN SESSION</span><h3>Operations and driver approval</h3></div><button className="text-action" onClick={() => { setToken(""); setMetrics(null); setDrivers([]); }}>Sign out</button></div>
              <div className="button-row">
                <button className="book-button" onClick={refreshMetrics} disabled={busy}>Refresh metrics <ArrowRight size={18} /></button>
                <button className="outline-button" onClick={refreshDrivers} disabled={busy}><RefreshCw size={15} /> Refresh drivers</button>
              </div>
              {metrics && <div className="driver-queue"><h3>PostgreSQL-backed counts</h3><p>Online drivers: <strong>{metrics.onlineDrivers}</strong></p>{Object.entries(metrics.ridesByStatus).map(([status, count]) => <div className="ride-confirmation" key={status}><strong>{status.replaceAll("_", " ")}</strong><span>{count} ride(s)</span></div>)}</div>}
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
            </>
          )}
          {error && <div className="inline-notice" role="status" aria-live="polite">{error}</div>}
        </div>
      </div>
    </section>
  );
}
