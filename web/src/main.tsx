import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import OperationsWorkspace from "./components/OperationsWorkspace";
import "./styles.css";

const hostname = window.location.hostname.toLowerCase();
const isDriverPortal = hostname.startsWith("driver.");
const isAdminPortal = window.location.pathname.replace(/\/+$/, "") === "/admin";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDriverPortal
      ? <OperationsWorkspace mode="driver" />
      : isAdminPortal
        ? <OperationsWorkspace mode="admin" />
        : <App />}
  </React.StrictMode>,
);
