import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { startBlankScreenWatchdog } from "@/utils/blankScreenWatchdog";

// When user returns after a deploy, lazy chunks can 404 (old chunk URLs). Reload once to load the new build.
// On iOS wake, wait until the tab is visible AND online — immediate reload while the radio is
// still asleep is what forces players to "keep refreshing until it works".
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
  const attempt = () => {
    try {
      if (typeof document !== "undefined" && document.hidden) {
        const onVis = () => {
          if (document.hidden) return;
          document.removeEventListener("visibilitychange", onVis);
          setTimeout(attempt, 800);
        };
        document.addEventListener("visibilitychange", onVis);
        return;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const onOnline = () => {
          window.removeEventListener("online", onOnline);
          setTimeout(attempt, 600);
        };
        window.addEventListener("online", onOnline);
        return;
      }
      const last = sessionStorage.getItem(CHUNK_ERROR_RELOAD_KEY);
      const now = Date.now();
      if (last && now - parseInt(last, 10) < CHUNK_ERROR_RELOAD_COOLDOWN_MS) return;
      sessionStorage.setItem(CHUNK_ERROR_RELOAD_KEY, String(now));
      window.location.reload();
    } catch (_) {}
  };
  // Brief delay so Safari's networking can wake after background discard.
  setTimeout(attempt, 700);
}

if (typeof window !== "undefined") {
  startBlankScreenWatchdog();
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

// Mobile WebKit/Blink: disable backdrop-filter / transform fades before first paint (black flash + tile static).
try {
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  const iPadOs = /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  if (!/Firefox/i.test(ua) && (/Android/i.test(ua) || /iPhone|iPad|iPod/i.test(ua) || iPadOs)) {
    document.documentElement.setAttribute('data-mobile-compositor-safe', 'on');
    if (document.body) document.body.setAttribute('data-mobile-compositor-safe', 'on');
  }
} catch (_) { /* ignore */ }

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
