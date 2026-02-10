import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

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
