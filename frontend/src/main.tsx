import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import { capturePrivateEntry } from "./app/private-entry";
import { assertLocalDemo } from "./app/demo-context";

assertLocalDemo(
  {
    VITE_FORECAST_DEMO: import.meta.env.VITE_FORECAST_DEMO,
    VITE_API_ORIGIN: import.meta.env.VITE_API_ORIGIN,
  },
  window.location.origin,
);

const privateEntry = /^\/private\/?$/.test(window.location.pathname)
  ? capturePrivateEntry()
  : undefined;

const root = document.getElementById("root");
if (!root) {
  throw new Error("Application root not found");
}

createRoot(root).render(
  <StrictMode>
    <App privateEntry={privateEntry} />
  </StrictMode>,
);
