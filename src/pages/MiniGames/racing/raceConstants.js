// Shared racing UI / replay constants (aligned with backend tyre ids & weather keys).

export const CAR_COLORS = [
  "#d4af37", "#dc2626", "#3b82f6", "#16a34a",
  "#9333ea", "#f97316", "#ec4899", "#14b8a6",
];

export const TYRE_DEFS = {
  soft:     { id: "soft",     label: "Soft",     color: "#e82020", cliffStart: 0.52, cliffRate: 3.2, gripMult: 1.08, minWear: 5, lapsBase: 2,   desc: "Fastest. Hard cliff at ~50% wear" },
  medium:   { id: "medium",   label: "Medium",   color: "#e8d020", cliffStart: 0.66, cliffRate: 2.4, gripMult: 1.02, minWear: 5, lapsBase: 3,   desc: "Balanced all-rounder" },
  hard:     { id: "hard",     label: "Hard",     color: "#c0c0b8", cliffStart: 0.80, cliffRate: 1.6, gripMult: 0.96, minWear: 5, lapsBase: 4,   desc: "Durable. Cliff at ~80%" },
  inter:    { id: "inter",    label: "Inter",    color: "#20a840", cliffStart: 0.62, cliffRate: 2.0, gripMult: 1.04, minWear: 5, lapsBase: 2.5, desc: "Damp / light rain" },
  full_wet: { id: "full_wet", label: "Full Wet", color: "#2080e8", cliffStart: 0.70, cliffRate: 1.8, gripMult: 1.08, minWear: 5, lapsBase: 3,   desc: "Heavy rain / snow" },
  wet:      { id: "full_wet", label: "Full Wet", color: "#2080e8", cliffStart: 0.70, cliffRate: 1.8, gripMult: 1.08, minWear: 5, lapsBase: 3,   desc: "Heavy rain / snow" },
};

export const WEATHER_DEFS = {
  clear:    { label: "Clear",    icon: "☀️",  bg1: "#0d1a07", bg2: "#091204", speedMult: 1.00, wearMult: 1.00, gripMult: 1.00, tyreRec: ["soft", "medium", "hard"] },
  night:    { label: "Night",    icon: "🌙",  bg1: "#050810", bg2: "#080c14", speedMult: 0.97, wearMult: 1.05, gripMult: 0.98, tyreRec: ["medium", "hard"] },
  rain:     { label: "Rain",     icon: "🌧️", bg1: "#0a1020", bg2: "#060c18", speedMult: 0.90, wearMult: 1.55, gripMult: 0.88, tyreRec: ["inter", "full_wet"] },
  snow:     { label: "Snow",     icon: "❄️",  bg1: "#1a1e2e", bg2: "#0d1020", speedMult: 0.78, wearMult: 2.10, gripMult: 0.78, tyreRec: ["inter", "full_wet"], fog: 0.18 },
  very_hot: { label: "Very Hot", icon: "🔥", bg1: "#1e0e04", bg2: "#120a02", speedMult: 0.95, wearMult: 1.45, gripMult: 0.95, tyreRec: ["medium", "hard"] },
};

export const WEATHER_MAP = { clear: "clear", rain: "rain", snow: "snow", very_hot: "very_hot", night: "night" };

export const CAR_SCALE = 0.90;

export const NPC_NAMES  = ["Smokey Joe", "Ace Johnson", "The Phantom", "Lucky Lou", "Fast Eddie", "Duke Malone", "Slick Sam", "Rusty Wheeler"];
export const NPC_CARS   = ["Ford Model T Racer", "Packard 734", "Stutz Bearcat", "Miller 91", "Duesenberg Model J"];
export const NPC_STATS  = [
  { bs: 0.90, bg: 0.87 }, { bs: 0.93, bg: 0.85 }, { bs: 0.96, bg: 0.84 }, { bs: 0.99, bg: 0.85 },
  { bs: 1.02, bg: 0.83 }, { bs: 1.05, bg: 0.84 }, { bs: 1.08, bg: 0.82 }, { bs: 0.95, bg: 0.86 },
];
export const NPC_TYRES  = ["soft", "medium", "medium", "hard", "medium", "hard", "soft", "medium"];

export const COMMENTARY = {
  grid:   ["Grid is set — standing start", "Formation complete — all eyes on the lights", "Cars on the grid — engines screaming", "Grid locked in — tension building"],
  lights: ["Red lights on...", "Five red lights — watch for the start", "Lights sequence — hold your nerve", "Red lights glowing — any moment now"],
  start:  ["Lights out and away we go!", "They're off!", "Bootleg run underway!", "Green flag — go!", "Engines roar across the grid!", "And it's go go go!", "Brilliant start — the pack surges forward!", "Clean getaway from the grid!"],
  mid:    ["Close battle through the chicane!", "Tyre wear is a real factor now!", "The gap is tightening!", "Pit window opening up...", "Flat out on the back straight!", "Wheel to wheel into Turn 3!", "Slipstream down the long straight!", "Fuel load dropping — cars quickening!", "Yellow and black of the pit board!", "Pressure building in the midfield!", "DRS zone — can they make the move?", "Dirty air causing problems for the chaser!", "Running nose to tail through the complex!", "Strategy is everything at this point!", "Tyre deg is rearing its head!"],
  final:  ["White flag — final lap!", "Everything on the line!", "Push to the absolute limit!", "Last lap — it's now or never!", "Final tour — give it everything!"],
  done:   ["Checkered flag!", "What a race!", "That's the finish!", "The crowd goes wild!", "And that's the race — incredible!", "What a drive — take a bow!"],
  safetyCar:    ["Safety car deployed!", "Yellow flags — hold positions!", "Caution period — safety car out!"],
  safetyCarEnd: ["Safety car in — green flag!", "Racing resumes — go go go!", "The pack bunches — big restart!"],
  weatherChange:["Conditions changing out there!", "Rain incoming — tyres under threat!", "Track drying — strategies shifting!"],
  fastest:      ["Purple sector — fastest lap!", "New fastest lap on the board!"],
};

export function tyreGripFromWear(wear, tyreId) {
  const td = TYRE_DEFS[tyreId] || TYRE_DEFS.medium;
  const w  = wear / 100;
  if (w >= td.cliffStart) return 1.0;
  const below = (td.cliffStart - w) / td.cliffStart;
  return Math.max(0.28, 1.0 - below * td.cliffRate * 0.35);
}

export function tyreColor(wear) {
  if (wear > 65) return "#27ae60";
  if (wear > 35) return "#f39c12";
  return "#e74c3c";
}

export function pitDur(pitLevel, emergency = false) {
  const base = emergency ? 4.2 : 3.2, minT = emergency ? 1.5 : 1.2;
  return Math.max(minT, base - (Math.max(0, Math.min(100, pitLevel || 0)) / 10) * 0.15);
}

export function stintLaps(tyreId, wearMult, relMult) {
  const td = TYRE_DEFS[tyreId] || TYRE_DEFS.medium;
  return Math.max(2, Math.min(5, Math.round(td.lapsBase / ((wearMult || 1) * (relMult || 1)))));
}

export function buildStrategy(tyreId, nLaps, wearMult = 1, relMult = 1, offset = 0, strat = "normal", nextTyreOv = null) {
  if (nLaps <= 2) return [];
  const sl   = stintLaps(tyreId, wearMult, relMult);
  const next = nextTyreOv || (tyreId === "soft" ? "medium" : tyreId === "medium" ? "hard" : "medium");
  const sOff = strat === "undercut" ? -1 : strat === "overcut" ? 1 : 0;
  const stops = [], last = nLaps - 2;
  for (let lap = sl; lap < nLaps; lap += sl) {
    stops.push({ lap: Math.max(2, Math.min(last, lap + offset + sOff)), nextTyre: next });
  }
  return stops.filter(s => s.lap <= last);
}

export function buildReplayStrategy(id, pitStopsList, entrant) {
  const stops = (pitStopsList || []).filter(ps => ps.entrant_id === id);
  if (!stops.length) return [];
  const base = ((entrant?.tyre_compound || "medium").toLowerCase());
  const next = base === "soft" ? "medium" : base === "medium" ? "hard" : "medium";
  return stops.map((ps, i) => ({ lap: ps.lap, nextTyre: i % 2 === 0 ? next : base }));
}

export function rollStrat() {
  const r = Math.random();
  return r < 0.20 ? "undercut" : r < 0.35 ? "overcut" : "normal";
}

export const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
