import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import { capturePrivateEntry } from "./app/private-entry";

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
