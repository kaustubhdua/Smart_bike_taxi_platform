import { useMemo, useState } from "react";
import { ArrowLeft, Bike, CheckCircle2, Clock3, MapPin, RotateCcw, ShieldCheck, UserRound } from "lucide-react";

type Stage = "quote" | "requested" | "accepted" | "arriving" | "in_progress" | "completed" | "cancelled";
type Role = "passenger" | "driver" | "admin";

const presets = [
  { pickup: "JIIT Sector 128, Noida", destination: "Sector 18 Market, Noida", km: 13.2, mins: 28 },
  { pickup: "Botanical Garden Metro, Noida", destination: "Noida City Centre, Noida", km: 6.4, mins: 17 },
  { pickup: "JIIT Sector 128, Noida", destination: "Sector 62, Noida", km: 17.8, mins: 36 },
];

const nextStage: Partial<Record<Stage, Stage>> = {
  requested: "accepted", accepted: "arriving", arriving: "in_progress",
  in_progress: "completed",
};

const stageLabel: Record<Stage, string> = {
  quote: "Fare estimate", requested: "Finding a driver", accepted: "Driver assigned",
  arriving: "Driver arriving", in_progress: "Ride in progress", completed: "Ride completed",
  cancelled: "Ride cancelled",
};

export default function DemoMode() {
  const [role, setRole] = useState<Role>("passenger");
  const [routeIndex, setRouteIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("quote");
  const [rideNumber, setRideNumber] = useState(1);
  const [notice, setNotice] = useState("Choose a sample Noida route to explore the passenger journey.");
  const [driverOnline, setDriverOnline] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);
  const route = presets[routeIndex];
  const fare = useMemo(() => Math.round(3500 + route.km * 115), [route.km]);
  const money = (paise: number) => "₹" + (paise / 100).toFixed(0);
  const active = !["quote", "completed", "cancelled"].includes(stage);

  function reset() {
    setStage("quote");
    setShowTimeline(false);
    setRideNumber(value => value + 1);
    setNotice("Demo trip reset. Choose a route and try the flow again.");
  }

  function progress() {
    const next = nextStage[stage];
    if (!next) return;
    setStage(next);
    setNotice(next === "completed"
      ? "Demo trip completed. No real driver, payment or ride record was created."
      : "Demo state updated: " + stageLabel[next] + ".");
  }

  return (
    <div className="app-shell rideforge-app role-workspace demo-mode-shell">
      <header className="role-header">
        <a className="brand" href="/"><span className="brand-mark"><Bike size={20}/></span><span>rideforge<span className="brand-period">.</span><small>INTERACTIVE DEMO</small></span></a>
        <nav aria-label="Demo navigation"><a href="/">Exit demo</a></nav>
      </header>
      <div className="demo-disclaimer" role="note"><strong>SIMULATED DEMO MODE</strong> · No account, password, GPS permission or backend connection required. All trip, driver and admin activity below is sample data held only in this browser; nothing is booked or written to production.</div>
      <main className="demo-mode-main">
        <div className="demo-mode-heading">
          <span className="section-kicker">RIDEFORGE · TRY BEFORE SIGNING UP</span>
          <h1>Explore the complete<br/><em>RideForge experience.</em></h1>
          <p>Switch between passenger, driver and admin views. Move a sample trip through the lifecycle without creating an account.</p>
        </div>
        <div className="demo-role-switch" role="tablist" aria-label="Choose demo role">
          <button type="button" role="tab" aria-selected={role === "passenger"} onClick={() => setRole("passenger")}><UserRound size={16}/> Passenger</button>
          <button type="button" role="tab" aria-selected={role === "driver"} onClick={() => setRole("driver")}><Bike size={16}/> Driver</button>
          <button type="button" role="tab" aria-selected={role === "admin"} onClick={() => setRole("admin")}><ShieldCheck size={16}/> Admin</button>
        </div>
        <div className="demo-workspace-card">
          <div className="demo-workspace-top"><div><span className="demo-live-dot"/> DEMO SESSION · TRIP #{rideNumber.toString().padStart(4, "0")}</div><span className="demo-status-pill">{stageLabel[stage]}</span></div>
          {role === "passenger" && <>
            <div className="demo-panel-title"><MapPin size={19}/><div><h2>Plan your journey</h2><p>Choose a preset route and preview a sample fare.</p></div></div>
            <label className="demo-field">Pickup location<select value={routeIndex} onChange={event => {setRouteIndex(Number(event.target.value));setStage("quote");setNotice("Route changed. Request a fresh sample estimate.");}}>{presets.map((item,index)=><option value={index} key={item.pickup + item.destination}>{item.pickup} → {item.destination}</option>)}</select></label>
            <div className="demo-route-points"><div><span className="demo-pickup-dot"/><div><small>PICKUP</small><strong>{route.pickup}</strong></div></div><div><span className="demo-drop-dot"/><div><small>DROP-OFF</small><strong>{route.destination}</strong></div></div></div>
            <div className="demo-fare-grid"><div><small>DISTANCE</small><strong>{route.km} km</strong></div><div><small>EST. TIME</small><strong>{route.mins} min</strong></div><div><small>SAMPLE FARE</small><strong>{money(fare)}</strong></div></div>
            {stage === "quote" || stage === "cancelled" ? <button className="demo-primary-action" onClick={() => {setStage("requested");setNotice("Sample ride request created locally. Switch to Driver to accept it.");}}>Request sample ride <span>→</span></button> : <div className="demo-state-panel"><CheckCircle2 size={19}/><div><strong>{stageLabel[stage]}</strong><p>{stage === "completed" ? "Your sample trip is complete. View the receipt below." : "Your sample trip is being handled in the demo workspace."}</p></div></div>}
            {stage === "completed" && <div className="demo-receipt"><strong>Sample trip receipt</strong><span>{route.pickup} → {route.destination}</span><b>{money(fare)}</b><small>DEMO RECEIPT · NOT A PAYMENT CONFIRMATION</small></div>}
            {active && <button className="demo-secondary-action" onClick={() => {setStage("cancelled");setNotice("Sample trip cancelled locally. No real booking was affected.");}}>Cancel sample ride</button>}
          </>}
          {role === "driver" && <>
            <div className="demo-panel-title"><Bike size={19}/><div><h2>Driver workspace</h2><p>Explore availability, dispatch offers and trip controls.</p></div></div>
            <div className="demo-driver-profile"><div className="demo-avatar">RD</div><div><strong>Demo Driver</strong><small>Sample partner · No account required</small></div><span className={driverOnline ? "demo-status-pill" : "demo-status-muted"}>{driverOnline ? "Online" : "Offline"}</span></div>
            <button className="demo-secondary-action" onClick={() => {setDriverOnline(value => !value);setNotice(driverOnline ? "Demo driver is now offline." : "Demo driver is now online.");}}>{driverOnline ? "Go offline" : "Go online"}</button>
            <div className="demo-queue-card"><div><small>DISPATCH QUEUE</small><strong>{stage === "requested" ? "1 sample ride offer" : active ? "1 active sample trip" : "No pending offers"}</strong></div><span>{route.km} km away</span></div>
            <div className="demo-route-points"><div><span className="demo-pickup-dot"/><div><small>PICKUP</small><strong>{route.pickup}</strong></div></div><div><span className="demo-drop-dot"/><div><small>DROP-OFF</small><strong>{route.destination}</strong></div></div></div>
            {stage === "requested" && <button className="demo-primary-action" disabled={!driverOnline} onClick={() => {setStage("accepted");setNotice("Demo driver accepted the sample offer. Switch to Passenger to see the update.");}}>Accept sample offer <span>→</span></button>}
            {stage === "accepted" && <button className="demo-primary-action" onClick={progress}>Mark arrived <span>→</span></button>}
            {stage === "arriving" && <button className="demo-primary-action" onClick={progress}>Start sample trip <span>→</span></button>}
            {stage === "in_progress" && <button className="demo-primary-action" onClick={progress}>Complete sample trip <span>→</span></button>}
            {stage === "completed" && <div className="demo-state-panel"><CheckCircle2 size={19}/><div><strong>Trip completed</strong><p>Sample earnings: {money(fare)} gross. No payout was made.</p></div></div>}
            {!active && stage !== "requested" && <p className="demo-helper-copy">Request a sample ride in Passenger view to populate the dispatch queue.</p>}
          </>}
          {role === "admin" && <>
            <div className="demo-panel-title"><ShieldCheck size={19}/><div><h2>Operations overview</h2><p>Sample admin dashboard with a safe, read-only dataset.</p></div></div>
            <div className="demo-admin-metrics"><div><small>SAMPLE RIDES</small><strong>{stage === "quote" ? "12" : "13"}</strong></div><div><small>ONLINE DRIVERS</small><strong>{driverOnline ? "4" : "3"}</strong></div><div><small>COMPLETED</small><strong>{stage === "completed" ? "9" : "8"}</strong></div></div>
            <div className="demo-queue-card"><div><small>DEMO TRIP #{rideNumber.toString().padStart(4, "0")}</small><strong>{route.pickup} → {route.destination}</strong><span>{stageLabel[stage]} · {money(fare)} sample fare</span></div><span className="demo-status-pill">{stage}</span></div>
            <div className="demo-state-panel"><ShieldCheck size={19}/><div><strong>Admin controls are simulated</strong><p>In production, driver approval, account management and audit events require an authenticated administrator. This demo does not modify real accounts or records.</p></div></div>
            <button className="demo-secondary-action" onClick={() => setShowTimeline(value => !value)}>{showTimeline ? "Hide" : "View"} sample activity timeline</button>
            {showTimeline && <ol className="demo-timeline"><li>Sample request created</li><li>Demo driver accepted offer</li><li>Trip status: {stageLabel[stage]}</li></ol>}
          </>}
          <div className="demo-notice" role="status">{notice}</div>
          <div className="demo-workspace-footer"><span><Clock3 size={14}/> Browser-only session</span><button onClick={reset}><RotateCcw size={14}/> Reset demo trip</button></div>
        </div>
        <div className="demo-journey-steps"><strong>Sample ride lifecycle</strong><div>{(["requested","accepted","arriving","in_progress","completed"] as Stage[]).map((item,index)=><span className={["requested","accepted","arriving","in_progress","completed"].indexOf(stage) >= index && stage !== "cancelled" && stage !== "quote" ? "is-done" : ""} key={item}>{index+1}. {stageLabel[item]}</span>)}</div></div>
        <p className="demo-safety-note">This mode is intentionally isolated from production. Sample driver names, metrics, fares and trips are illustrative only. Real bookings, identity verification, payment processing and emergency operations are available only if separately implemented and provisioned in the live service.</p>
      </main>
    </div>
  );
}
