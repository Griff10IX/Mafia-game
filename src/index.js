import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// When user returns after a deploy, lazy chunks can 404 (old chunk URLs). Reload once to load the new build.
const CHUNK_ERROR_RELOAD_KEY = "chunk_error_reload_at";
const CHUNK_ERROR_RELOAD_COOLDOWN_MS = 15000;

function isChunkLoadError(message) {
  if (!message || typeof message !== "string") return false;
  return (
    message.includes("Loading chunk") ||
    message.includes("ChunkLoadError") ||
    message.includes("Loading CSS chunk") ||
    /Failed to fetch dynamically imported module|Importing a module script failed/i.test(message)
  );
}

function tryReloadForChunkError() {
  try {
    const last = sessionStorage.getItem(CHUNK_ERROR_RELOAD_KEY);
    const now = Date.now();
    if (last && now - parseInt(last, 10) < CHUNK_ERROR_RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(CHUNK_ERROR_RELOAD_KEY, String(now));
    window.location.reload();
  } catch (_) {}
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.message)) {
      event.preventDefault();
      tryReloadForChunkError();
      return true;
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    const msg = event.reason?.message || event.reason?.toString() || "";
    if (isChunkLoadError(msg)) {
      event.preventDefault();
      tryReloadForChunkError();
    }
  });
}

// Remove Emergent-injected badge if present (hosting overlay)
function removeEmergentBadge() {
  try {
    const candidates = [
      document.getElementById("emergent-badge"),
      document.querySelector('a#emergent-badge'),
      document.querySelector('[id*="emergent"]'),
      document.querySelector('[class*="emergent"]'),
      document.querySelector('a[href*="emergent"]'),
      document.querySelector('[href*="utm_source=emergent-badge"]'),
    ].filter(Boolean);

    candidates.forEach((el) => {
      try { el.remove(); } catch (e) { /* ignore */ }
    });
  } catch (e) {
    // ignore
  }
}

removeEmergentBadge();
setTimeout(removeEmergentBadge, 500);
setTimeout(removeEmergentBadge, 2000);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
