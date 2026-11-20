import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import OperationsWorkspace from "./components/OperationsWorkspace";
import DemoMode from "./components/DemoMode";
import "./styles.css";
import { ArrowRight, Bike, ShieldCheck, UserRound, Play } from "lucide-react";

const hostname = window.location.hostname.toLowerCase();
const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const isDemoPortal = pathname === "/demo";
const isDriverPortal = hostname.startsWith("driver.") || pathname === "/driver";
const isAdminPortal = pathname === "/admin";
const isLiveApiView = pathname === "/live";
const isPassengerPortal = pathname === "/passenger";
const isRoleLanding = pathname === "/";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDemoPortal
      ? <DemoMode />
      : isRoleLanding
      ? <div className="app-shell rideforge-app role-entry">
          <header className="role-header">
            <a className="brand" href="/"><span className="brand-mark"><Bike size={20} /></span><span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span></a>
            <nav aria-label="Role navigation"><a href="/admin">Admin console</a></nav>
          </header>
          <main className="role-entry-main">
            <div className="role-entry-intro">
              <span className="section-kicker">RIDEFORGE · NOIDA</span>
              <h1>How would you like<br/><em>to move today?</em></h1>
              <p>Try the interactive demo instantly, or sign in to a verified passenger or driver workspace for live API-backed activity.</p>
            </div>
            <div className="role-entry-cards">
              <a className="role-entry-card passenger" href="/passenger">
                <span className="role-entry-icon"><UserRound size={26}/></span>
                <span className="role-entry-overline">FOR YOUR JOURNEY</span>
                <strong>I'm a passenger</strong>
                <span>Get a real route and fare estimate, request a ride, and follow your booking.</span>
                <b>Continue as passenger <ArrowRight size={17}/></b>
              </a>
              <a className="role-entry-card driver" href="/driver">
                <span className="role-entry-icon"><Bike size={26}/></span>
                <span className="role-entry-overline">FOR DRIVER PARTNERS</span>
                <strong>I'm a driver</strong>
                <span>Sign in to go online, receive nearby ride offers, and manage your trips.</span>
                <b>Continue as driver <ArrowRight size={17}/></b>
              </a>
              <a className="role-entry-card demo" href="/demo">
                <span className="role-entry-icon"><Play size={25}/></span>
                <span className="role-entry-overline">NO LOGIN REQUIRED</span>
                <strong>Explore demo mode</strong>
                <span>Try passenger booking, driver dispatch and admin views with an interactive sample trip.</span>
                <b>Start interactive demo <ArrowRight size={17}/></b>
              </a>
            </div>
            <p className="role-entry-footnote"><ShieldCheck size={15}/> Live passenger, driver and administrator actions are protected by server-verified account permissions. Demo mode is isolated and never writes to production.</p>
            <p className="role-entry-footnote">Academic demonstration preview only — not a live transport service. Driver/vehicle verification, regulatory approvals, insurance, payments and staffed emergency response are not available.</p>
          </main>
          <footer className="site-footer"><span>© 2026 RIDEFORGE</span><a href="https://github.com/kaustubhdua/Smart_bike_taxi_platform" target="_blank" rel="noreferrer">Open-source project</a></footer>
        </div>
      : isDriverPortal
      ? <div className="app-shell rideforge-app role-workspace">
          <header className="role-header">
            <a className="brand" href="/"><span className="brand-mark">R</span><span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span></a>
            <nav aria-label="Role navigation"><a href="/passenger">Passenger booking</a><a href="/driver" aria-current="page">Driver workspace</a><a href="/admin">Admin console</a><a href="/demo">Try demo</a></nav>
          </header>
          <div className="demo-disclaimer" role="note"><strong>DEMONSTRATION WORKSPACE</strong> · Uses the configured Supabase API. Not authorised for real rides; driver and vehicle checks must be completed outside this prototype.</div>
          <OperationsWorkspace mode="driver" />
        </div>
      : isAdminPortal
        ? <div className="app-shell rideforge-app role-workspace">
            <header className="role-header">
              <a className="brand" href="/"><span className="brand-mark">R</span><span>rideforge<span className="brand-period">.</span><small>MOVE WITH CLARITY</small></span></a>
              <nav aria-label="Role navigation"><a href="/">Book a ride</a><a href="/driver">Driver workspace</a><a href="/admin" aria-current="page">Admin console</a><a href="/demo">Try demo</a></nav>
            </header>
            <div className="demo-disclaimer" role="note"><strong>DEMONSTRATION WORKSPACE</strong> · Requires provisioned administrator credentials. Administrative tools do not establish commercial or regulatory readiness.</div>
            <OperationsWorkspace mode="admin" />
          </div>
        : (isLiveApiView || isPassengerPortal)
          ? <><div className="demo-disclaimer" role="note"><strong>LIVE API WORKSPACE</strong> · Requires the configured Supabase API. Not a live transport service. <a href="/demo">Try no-login demo mode</a></div><App /></>
          : <App />}
  </React.StrictMode>,
);
