import { useCallback, useState } from "react";

type Props = {
  base: string;
  token: string;
  rideId: string;
  status: string;
  /** "passenger" sees the start code; both roles can raise SOS and rate. */
  role: "passenger" | "driver";
  /** Supplied by the parent's existing ride polling, so no extra requests are made. */
  startCode?: string | null;
  driverRating?: { count: number; average: number | null } | null;
};

type Receipt = {
  receiptNumber: string; pickup: string; destination: string; totalPaise: number; currency: string;
  distanceKm: number | null; driverName: string | null; completedAt: string | null;
  fareBreakdown: { baseFarePaise: number; distanceFarePaise: number };
  payment: { collected: boolean; note: string };
};

const ACTIVE = ["assigned", "driver_arriving", "in_progress"];
const rupees = (paise: number) => "₹" + (paise / 100).toFixed(2);

export default function RideSafetyAndFeedback({ base, token, rideId, status, role, startCode = null, driverRating = null }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(base.replace(/\/$/, "") + "/api/v1" + path, {
      ...init,
      headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed.");
    return data;
  }, [base, token]);

  async function sendSos() {
    if (!window.confirm("Send an SOS alert for this ride? If you are in immediate danger, call 112 first.")) return;
    setBusy(true); setMessage("");
    try {
      let location: { latitude?: number; longitude?: number } = {};
      if ("geolocation" in navigator) {
        location = await new Promise(resolve => navigator.geolocation.getCurrentPosition(
          position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
          () => resolve({}), { timeout: 4000, maximumAge: 30000 }));
      }
      const data = await call("/rides/" + encodeURIComponent(rideId) + "/sos", { method: "POST", body: JSON.stringify(location) });
      setMessage(typeof data.guidance === "string" ? data.guidance : "SOS recorded. If you are in danger, call 112.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not send SOS. Call 112 if you are in danger."); }
    finally { setBusy(false); }
  }

  async function submitRating() {
    setBusy(true); setMessage("");
    try {
      await call("/rides/" + encodeURIComponent(rideId) + "/rating", { method: "POST", body: JSON.stringify({ stars, comment }) });
      setRated(true); setMessage("Thanks, your rating was saved.");
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Could not save rating.";
      if (text.includes("already")) setRated(true);
      setMessage(text);
    } finally { setBusy(false); }
  }

  async function loadReceipt() {
    setBusy(true); setMessage("");
    try { setReceipt(await call("/rides/" + encodeURIComponent(rideId) + "/receipt") as unknown as Receipt); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Receipt unavailable."); }
    finally { setBusy(false); }
  }

  return (
    <div className="ride-extras" aria-live="polite">
      {role === "passenger" && startCode && ["assigned", "driver_arriving"].includes(status) && (
        <div className="start-code" role="status">
          <span className="card-eyebrow">START CODE</span>
          <strong className="start-code-digits" aria-label={"Start code " + startCode.split("").join(" ")}>{startCode}</strong>
          <small>Tell this code to your driver only when you meet. The trip cannot start without it.</small>
          {driverRating && driverRating.count > 0 && driverRating.average !== null && <small>Driver rating {driverRating.average.toFixed(1)} from {driverRating.count} {driverRating.count === 1 ? "ride" : "rides"}</small>}
        </div>
      )}
      {ACTIVE.includes(status) && (
        <div className="sos-row">
          <button className="outline-button sos-button" onClick={sendSos} disabled={busy}>Send SOS alert</button>
          <small>Records an alert with your location for an administrator. There is no staffed control room, so call 112 in an emergency.</small>
        </div>
      )}
      {status === "completed" && (
        <div className="feedback-panel">
          {!rated ? (
            <>
              <span className="card-eyebrow">RATE THIS RIDE</span>
              <div role="radiogroup" aria-label="Rating" className="star-row">
                {[1, 2, 3, 4, 5].map(value => (
                  <button key={value} type="button" role="radio" aria-checked={stars === value} aria-label={value + (value === 1 ? " star" : " stars")}
                    className={value <= stars ? "star selected" : "star"} onClick={() => setStars(value)}>★</button>
                ))}
              </div>
              <label className="auth-field"><span>Comment (optional)</span><input value={comment} onChange={event => setComment(event.target.value)} maxLength={500} /></label>
              <button className="outline-button" onClick={submitRating} disabled={busy || stars === 0}>Submit rating</button>
            </>
          ) : <small>You rated this ride.</small>}
          <button className="text-action" onClick={loadReceipt} disabled={busy}>View receipt</button>
        </div>
      )}
      {receipt && (
        <div className="receipt-card" role="region" aria-label="Receipt">
          <strong>{receipt.receiptNumber}</strong>
          <span>{receipt.pickup} → {receipt.destination}</span>
          {receipt.distanceKm !== null && <span>{receipt.distanceKm.toFixed(1)} km{receipt.driverName ? " · " + receipt.driverName : ""}</span>}
          <span>Base fare {rupees(receipt.fareBreakdown.baseFarePaise)} + distance {rupees(receipt.fareBreakdown.distanceFarePaise)}</span>
          <strong>Total {rupees(receipt.totalPaise)}</strong>
          <small>{receipt.payment.note}</small>
        </div>
      )}
      {message && <p className="auth-caption">{message}</p>}
    </div>
  );
}
