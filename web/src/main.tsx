import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import OperationsWorkspace from "./components/OperationsWorkspace";
import "./styles.css";

const hostname = window.location.hostname.toLowerCase();
const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const isDriverPortal = hostname.startsWith("driver.") || pathname === "/driver";
const isAdminPortal = pathname === "/admin";
// "/" is the canonical API-backed app; "/live" remains a compatibility alias. No browser-only ride simulator is mounted.\n// This entry point must never fabricate a booking or fare when Supabase is unavailable.
const isLiveApiView = pathname === "/live";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDriverPortal
      ? <><div className="demo-disclaimer" role="note"><strong>LIVE API WORKSPACE</strong> · Requires the configured RideForge API and real credentials.</div><OperationsWorkspace mode="driver" /></>
      : isAdminPortal
        ? <><div className="demo-disclaimer" role="note"><strong>LIVE API WORKSPACE</strong> · Requires the configured RideForge API and administrator credentials.</div><OperationsWorkspace mode="admin" /></>
        : isLiveApiView
          ? <><div className="demo-disclaimer" role="note"><strong>LIVE API WORKSPACE</strong> · Requires the configured RideForge API. Not a live transport service.</div><App /></>
          : <App />}
  </React.StrictMode>,
);
