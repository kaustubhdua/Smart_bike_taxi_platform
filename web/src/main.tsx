import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import OperationsWorkspace from "./components/OperationsWorkspace";
import "./styles.css";

const hostname = window.location.hostname.toLowerCase();
const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const isDriverPortal = hostname.startsWith("driver.") || pathname === "/driver";
const isAdminPortal = pathname === "/admin";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <>
      <div className="demo-disclaimer" role="note">
        <strong>DEMO ONLY</strong> · RideForge is a portfolio prototype, not a live taxi service. Use public landmarks/test locations only—never enter home addresses or personal data. No real passenger trips, payments, driver verification or emergency dispatch.
      </div>
      {isDriverPortal
        ? <OperationsWorkspace mode="driver" />
        : isAdminPortal
          ? <OperationsWorkspace mode="admin" />
          : <App />}
    </>
  </React.StrictMode>,
);
