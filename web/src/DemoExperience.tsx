import { useEffect, useState, type CSSProperties } from "react";

type DemoRide = {
  id: string;
  pickup: string;
  destination: string;
  fare: number;
  status: "Searching" | "Driver assigned" | "In progress" | "Completed" | "Cancelled";
  createdAt: string;
};

const storageKey = "rideforge-demo-rides-v1";
const places = ["JIIT Sector 128", "Botanical Garden Metro", "Sector 18 Market", "Noida City Centre", "Sector 62"];

const validStatuses = new Set<DemoRide["status"]>([
  "Searching", "Driver assigned", "In progress", "Completed", "Cancelled",
]);

function isDemoRide(value: unknown): value is DemoRide {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const ride = value as Record<string, unknown>;
  return typeof ride.id === "string" && ride.id.length > 0 && ride.id.length <= 80 &&
    typeof ride.pickup === "string" && places.includes(ride.pickup) &&
    typeof ride.destination === "string" && places.includes(ride.destination) &&
    ride.pickup !== ride.destination &&
    typeof ride.fare === "number" && Number.isFinite(ride.fare) && ride.fare >= 0 && ride.fare <= 100000 &&
    typeof ride.status === "string" && validStatuses.has(ride.status as DemoRide["status"]) &&
    typeof ride.createdAt === "string" && ride.createdAt.length > 0 && ride.createdAt.length <= 100;
}

function readRides(): DemoRide[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    // Browser storage is user-editable and may contain stale or malformed data.
    // Keep only bounded, schema-valid demo records; never trust a type assertion.
    return Array.isArray(value) ? value.filter(isDemoRide).slice(0, 100) : [];
  } catch { return []; }
}

export default function DemoExperience() {
  const [rides, setRides] = useState<DemoRide[]>(readRides);
  const [pickup, setPickup] = useState(places[0]);
  const [destination, setDestination] = useState(places[2]);
  const [tab, setTab] = useState<"passenger" | "driver" | "admin">("passenger");
  const [message, setMessage] = useState("This is a self-contained simulation. No account or database is required.");

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(rides.slice(0, 100)));
    } catch {
      setMessage("Browser storage is unavailable. Demo history may not persist after this session.");
    }
  }, [rides]);

  const active = rides.filter(r => !["Completed", "Cancelled"].includes(r.status));
  const card: CSSProperties = { background: "#fff", border: "1px solid #e6e8ec", borderRadius: 18, padding: 20, boxShadow: "0 8px 28px #1720330a" };
  const button: CSSProperties = { border: 0, borderRadius: 12, padding: "12px 16px", background: "#172b4d", color: "white", fontWeight: 700, cursor: "pointer" };
  const field: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #d8dde5", borderRadius: 10, padding: 12, background: "white", color: "#172033", marginTop: 6 };

  function updateRide(id: string, status: DemoRide["status"]) {
    setRides(current => current.map(ride => ride.id === id ? { ...ride, status } : ride));
    setMessage("Demo ride updated: " + status + ".");
  }

  function createRide() {
    if (pickup === destination) { setMessage("Choose two different locations."); return; }
    const fare = Math.round((55 + Math.abs(places.indexOf(pickup) - places.indexOf(destination)) * 22) * 100) / 100;
    const ride: DemoRide = { id: "RF-" + Math.random().toString(36).slice(2, 8).toUpperCase(), pickup, destination, fare, status: "Searching", createdAt: new Date().toLocaleString() };
    setRides(current => [ride, ...current].slice(0, 100));
    setTab("passenger");
    setMessage("Demo booking created. Switch to Driver to simulate acceptance.");
  }

  return <main style={{ minHeight: "100vh", background: "#f4f6f8", color: "#172033", fontFamily: "Inter, system-ui, sans-serif", padding: "28px 16px 56px" }}>
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div><div style={{ color: "#b45309", fontWeight: 800, letterSpacing: 2, fontSize: 12 }}>RIDEFORGE · INTERACTIVE DEMO</div><h1 style={{ fontSize: 34, margin: "8px 0" }}>Bike rides, reimagined.</h1><p style={{ color: "#596579", margin: 0 }}>A credential-free product walkthrough for Noida.</p></div>
        <span style={{ background: "#fff2d8", color: "#8a4b08", borderRadius: 99, padding: "9px 14px", fontWeight: 800, fontSize: 12 }}>SIMULATION ONLY</span>
      </header>
      <section style={{ ...card, background: "#fff8eb", borderColor: "#f1d8a8", marginBottom: 18 }}>
        <strong>Important: no real rides or payments.</strong><p style={{ margin: "6px 0 0", color: "#69583c", lineHeight: 1.5 }}>This demo uses fictional ride records saved only in this browser. It does not contact drivers, use GPS, process payments, authenticate users, or connect to the production database. Do not enter personal information.</p>
      </section>
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {(["passenger", "driver", "admin"] as const).map(value => <button key={value} onClick={() => setTab(value)} style={{ ...button, background: tab === value ? "#172b4d" : "#e5e9ef", color: tab === value ? "#fff" : "#263449", textTransform: "capitalize" }}>{value} workspace</button>)}
      </nav>
      <p role="status" style={{ color: "#315d47", minHeight: 24 }}>{message}</p>
      {tab === "passenger" && <section style={card}>
        <h2 style={{ marginTop: 0 }}>Book a demo ride</h2><p style={{ color: "#647084" }}>Choose two public test landmarks. The estimated fare is illustrative, not a real quote.</p>
        <label>Pickup<select value={pickup} onChange={e => setPickup(e.target.value)} style={field}>{places.map(p => <option key={p}>{p}</option>)}</select></label>
        <label style={{ display: "block", marginTop: 14 }}>Destination<select value={destination} onChange={e => setDestination(e.target.value)} style={field}>{places.map(p => <option key={p}>{p}</option>)}</select></label>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}><div><small style={{ color: "#647084" }}>Illustrative fare</small><div style={{ fontSize: 28, fontWeight: 800 }}>₹{(55 + Math.abs(places.indexOf(pickup) - places.indexOf(destination)) * 22).toFixed(2)}</div></div><button style={button} onClick={createRide}>Create demo booking</button></div>
      </section>}
      {tab === "driver" && <section style={card}><h2 style={{ marginTop: 0 }}>Driver workspace</h2><p style={{ color: "#647084" }}>Simulate accepting and completing a passenger request. No driver account or location is used.</p>
        {active.length === 0 ? <p>No active demo requests. Create one in Passenger workspace.</p> : active.map(ride => <article key={ride.id} style={{ borderTop: "1px solid #e6e8ec", padding: "16px 0" }}><strong>{ride.id}</strong><p>{ride.pickup} → {ride.destination}</p><p>₹{ride.fare.toFixed(2)} · {ride.status}</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{ride.status === "Searching" && <button style={button} onClick={() => updateRide(ride.id, "Driver assigned")}>Accept request</button>}{ride.status === "Driver assigned" && <button style={button} onClick={() => updateRide(ride.id, "In progress")}>Start ride</button>}{ride.status === "In progress" && <button style={button} onClick={() => updateRide(ride.id, "Completed")}>Complete ride</button>}<button style={{ ...button, background: "#e9edf2", color: "#263449" }} onClick={() => updateRide(ride.id, "Cancelled")}>Cancel demo</button></div></article>)}
      </section>}
      {tab === "admin" && <section style={card}><h2 style={{ marginTop: 0 }}>Operations overview</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12 }}>{[["Total demo rides", rides.length], ["Active", active.length], ["Completed", rides.filter(r => r.status === "Completed").length], ["Cancelled", rides.filter(r => r.status === "Cancelled").length]].map(([label, value]) => <div key={String(label)} style={{ background: "#f4f6f8", padding: 16, borderRadius: 12 }}><div style={{ color: "#647084", fontSize: 13 }}>{label}</div><strong style={{ fontSize: 28 }}>{value}</strong></div>)}</div><p style={{ color: "#647084" }}>All metrics are derived from this browser's simulated records.</p></section>}
      <section style={{ ...card, marginTop: 18 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><h2 style={{ margin: 0 }}>Demo ride history</h2><button style={{ ...button, background: "#e9edf2", color: "#263449" }} onClick={() => { setRides([]); setMessage("Local demo history cleared."); }}>Clear local demo data</button></div>
        {rides.length === 0 ? <p style={{ color: "#647084" }}>No demo rides yet.</p> : rides.map(ride => <div key={ride.id} style={{ borderTop: "1px solid #e6e8ec", padding: "13px 0" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><strong>{ride.id}</strong><strong>₹{ride.fare.toFixed(2)}</strong></div><div style={{ marginTop: 5 }}>{ride.pickup} → {ride.destination}</div><small style={{ color: "#647084" }}>{ride.status} · {ride.createdAt}</small></div>)}
      </section>
      <footer style={{ textAlign: "center", color: "#788397", fontSize: 12, marginTop: 24 }}>RideForge academic portfolio demo · Noida · No backend credentials required</footer>
    </div>
  </main>;
}
