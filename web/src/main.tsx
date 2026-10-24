import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import OperationsWorkspace from "./components/OperationsWorkspace";
import "./styles.css";

const isDriverPortal = window.location.hostname.toLowerCase().startsWith("driver.");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDriverPortal ? <OperationsWorkspace mode="driver" /> : <App />}
  </React.StrictMode>,
);
