/**
 * Human-readable lines for server `race_events` (interactive mode).
 */

export function formatRaceEventMessage(ev, nameById = {}) {
  if (!ev || typeof ev !== "object") return "";
  const t = ev.type;
  const nm = (id) => nameById[id] || (id && id.slice ? id.slice(0, 8) : "?");

  switch (t) {
    case "overtake":
      return `${nm(ev.passer_id)} overtakes ${nm(ev.passed_id)}`;
    case "overtake_failed":
      return `${nm(ev.attacker_id)} couldn't pass ${nm(ev.defender_id)}`;
    case "failed_overtake_contact":
      return `Contact — ${nm(ev.victim_hint)}`;
    case "pit_stop":
      return `${nm(ev.entrant_id)} pits (${ev.duration_sec != null ? ev.duration_sec + "s" : "stop"})`;
    case "weather_change":
      return `Weather → ${ev.to || "?"}`;
    case "safety_car_deployed":
      return ev.reason === "weather" ? "Safety car — weather" : `Safety car out (${ev.laps || "?"} laps)`;
    case "safety_car_in":
      return "Safety car in — green flag";
    case "dnf_engine":
      return `${nm(ev.entrant_id)} DNF — engine`;
    case "dnf_crash":
      return `${nm(ev.entrant_id)} DNF — crash`;
    case "dnf":
      return `${nm(ev.entrant_id)} DNF`;
    case "contact":
      return `Contact — ${nm(ev.damaged)}`;
    default:
      return t ? String(t).replace(/_/g, " ") : "";
  }
}
