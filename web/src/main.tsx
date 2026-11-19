import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import OperationsWorkspace from "./components/OperationsWorkspace";
import "./styles.css";

const hostname = window.location.hostname.toLowerCase();
const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const isDriverPortal = hostname.startsWith("driver.") || pathname === "/driver";
const isAdminPortal = pathname === "/admin";
// "/" is the canonical API-backed app; "/live" remains a compatibility alias. No browser-only ride simulator is mounted.
// This entry point must never fabricate a booking or fare when Supabase is unavailable.
const isLiveApiView = pathname === "/live";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDriverPortal
      ? <div className="app-shell rideforge-app role-workspace">
          <header className="role-header">
            <a className="brand" href="/"><span className="brand-mark">R</span><span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span></a>
            <nav aria-label="Role navigation"><a href="/">Book a ride</a><a href="/driver" aria-current="page">Driver workspace</a><a href="/admin">Admin console</a></nav>
          </header>
          <div className="demo-disclaimer" role="note"><strong>LIVE API WORKSPACE</strong> · Requires the configured Supabase API and real driver credentials.</div>
          <OperationsWorkspace mode="driver" />
        </div>
      : isAdminPortal
        ? <div className="app-shell rideforge-app role-workspace">
            <header className="role-header">
              <a className="brand" href="/"><span className="brand-mark">R</span><span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span></a>
              <nav aria-label="Role navigation"><a href="/">Book a ride</a><a href="/driver">Driver workspace</a><a href="/admin" aria-current="page">Admin console</a></nav>
            </header>
            <div className="demo-disclaimer" role="note"><strong>LIVE API WORKSPACE</strong> · Requires the configured Supabase API and administrator credentials.</div>
            <OperationsWorkspace mode="admin" />
          </div>
        : isLiveApiView
          ? <><div className="demo-disclaimer" role="note"><strong>LIVE API WORKSPACE</strong> · Requires the configured Supabase API. Not a live transport service.</div><App /></>
          : <App />}
  </React.StrictMode>,
);
