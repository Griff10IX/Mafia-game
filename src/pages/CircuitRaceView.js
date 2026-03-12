import { useEffect, useRef, useState, useCallback } from "react";
import styles from "../styles/noir.module.css";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CAR_COLORS = [
  "#d4af37","#dc2626","#3b82f6","#16a34a",
  "#9333ea","#f97316","#ec4899","#14b8a6",
];

const TYRE_DEFS = {
  soft:   { id:"soft",   label:"Soft",     color:"#e82020", wearPerSec:0.65, gripMult:1.08, minWear:5,  lapsPerStintBase:2, desc:"Fastest, pit every ~2 laps" },
  medium: { id:"medium", label:"Medium",   color:"#e8d020", wearPerSec:0.42, gripMult:1.02, minWear:5,  lapsPerStintBase:3, desc:"Balanced, pit every ~3 laps" },
  hard:   { id:"hard",   label:"Hard",     color:"#d0d0c0", wearPerSec:0.24, gripMult:0.96, minWear:5,  lapsPerStintBase:4, desc:"Durable, pit every ~4 laps" },
  inter:  { id:"inter",  label:"Inter",    color:"#20a840", wearPerSec:0.30, gripMult:1.04, minWear:5,  lapsPerStintBase:2.5, desc:"Damp / light rain" },
  wet:    { id:"wet",    label:"Full Wet", color:"#2080e8", wearPerSec:0.18, gripMult:1.08, minWear:5,  lapsPerStintBase:3, desc:"Heavy rain / snow" },
};

const WEATHER_DEFS = {
  clear:    { label:"Clear",     icon:"☀️",  bg1:"#0e1a06", bg2:"#0a1204", speedMult:1.00, wearMult:1.00, gripMult:1.00, tyreRec:["soft","medium","hard"] },
  night:    { label:"Night",     icon:"🌙", bg1:"#050810", bg2:"#080c14", speedMult:0.97, wearMult:1.05, gripMult:0.98, tyreRec:["medium","hard"] },
  rain:     { label:"Rain",      icon:"🌧️", bg1:"#0a1020", bg2:"#060c18", speedMult:0.90, wearMult:1.55, gripMult:0.88, tyreRec:["inter","wet"] },
  snow:     { label:"Snow",      icon:"❄️",  bg1:"#18182a", bg2:"#10101e", speedMult:0.82, wearMult:2.00, gripMult:0.82, tyreRec:["wet"] },
  very_hot: { label:"Very Hot",  icon:"🔥", bg1:"#1e0e04", bg2:"#120a02", speedMult:0.95, wearMult:1.45, gripMult:0.95, tyreRec:["medium","hard"] },
};

// Map weather IDs from backend → our keys
const WEATHER_MAP = { clear:"clear", rain:"rain", snow:"snow", very_hot:"very_hot" };

/** Pit stop duration in seconds: base minus pit_level * 0.35 (min 1.0 normal, 1.2 emergency). */
function pitDurationSeconds(pitLevel, emergency = false) {
  const base = emergency ? 3.8 : 3.0;
  const minSec = emergency ? 1.2 : 1.0;
  const level = Math.max(0, Math.min(5, pitLevel || 0));
  return Math.max(minSec, base - level * 0.35);
}

const COMMENTARY = {
  start: ["They're off!","Bootleg run underway!","Green flag — go!","Engines roar — race on!"],
  mid:   ["Close battle through the chicane!","Tire wear becoming a factor!","The gap is closing lap by lap!","Pit window starting to open!","Flat out on the back straight!","Wheel to wheel into turn three!"],
  pit:   ["Into the pits — fresh rubber!","Strategic stop, gains time later!","Quick turnaround — back out!"],
  final: ["White flag — last lap!","Everything on the line now!","Push to the limit!"],
  done:  ["Checkered flag!","What a race!","That's the finish!"],
};

const NPC_NAMES = ["Smokey Joe","Ace Johnson","The Phantom","Lucky Lou","Fast Eddie","Duke Malone","Slick Sam","Rusty Wheeler"];
// Mirror backend 4–5 historical cars for live mode
const NPC_CARS = ["Ford Model T Racer","Packard 734","Stutz Bearcat","Miller 91","Duesenberg Model J"];
// Similar difficulty to player (baseSpeed ~1.0): tight band so it's not a 1-person race
const NPC_CAR_STATS = [
  { baseSpeed: 0.92, baseGrip: 0.86 },
  { baseSpeed: 0.95, baseGrip: 0.85 },
  { baseSpeed: 0.97, baseGrip: 0.84 },
  { baseSpeed: 1.0,  baseGrip: 0.85 },
  { baseSpeed: 1.02, baseGrip: 0.83 },
  { baseSpeed: 1.04, baseGrip: 0.84 },
  { baseSpeed: 1.06, baseGrip: 0.82 },
  { baseSpeed: 0.94, baseGrip: 0.86 },
];
const NPC_TYRE_POOL = ["soft","medium","medium","hard","medium","hard","soft","medium"];

// ─────────────────────────────────────────────────────────────────────────────
// 8 TRACK DEFINITIONS — parametric paths on a 800×360 canvas coordinate space
// ─────────────────────────────────────────────────────────────────────────────

function interpPts(pts, T) {
  const t = ((T % 1) + 1) % 1;
  for (let i = 0; i < pts.length - 1; i++) {
    if (t >= pts[i].f && t < pts[i + 1].f) {
      const u = (t - pts[i].f) / (pts[i + 1].f - pts[i].f);
      const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      return {
        x: pts[i].p.x + (pts[i + 1].p.x - pts[i].p.x) * ease,
        y: pts[i].p.y + (pts[i + 1].p.y - pts[i].p.y) * ease,
      };
    }
  }
  return pts[0].p;
}

/** Smoother corners: Catmull-Rom spline so cars don't stop/start at segment joints. */
function interpPtsSmooth(pts, T) {
  const t = ((T % 1) + 1) % 1;
  const n = pts.length;
  if (n < 2) return pts[0].p;
  const wrap = (i) => ((i % n) + n) % n;
  for (let seg = 0; seg < n; seg++) {
    const next = wrap(seg + 1);
    const f0 = pts[seg].f;
    const f1 = pts[next].f;
    const isWrapSegment = f1 <= f0;
    const inSegment = isWrapSegment
      ? (t >= f0 || t <= f1)
      : (t >= f0 && t <= f1);
    if (!inSegment) continue;
    const segLen = isWrapSegment ? (1 - f0) + f1 : (f1 - f0);
    let u = isWrapSegment ? (t >= f0 ? (t - f0) / segLen : (t + (1 - f0)) / segLen) : (t - f0) / segLen;
    u = Math.max(0, Math.min(1, u));
    const u2 = u * u, u3 = u2 * u;
    const p0 = pts[wrap(seg - 1)].p;
    const p1 = pts[seg].p;
    const p2 = pts[next].p;
    const p3 = pts[wrap(seg + 2)].p;
    const x = 0.5 * (2*p1.x + (-p0.x + p2.x)*u + (2*p0.x - 5*p1.x + 4*p2.x - p3.x)*u2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x)*u3);
    const y = 0.5 * (2*p1.y + (-p0.y + p2.y)*u + (2*p0.y - 5*p1.y + 4*p2.y - p3.y)*u2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y)*u3);
    return { x, y };
  }
  return pts[0].p;
}

function rectOvalPt(T, x1,y1,x2,y2,r) {
  const t = ((T % 1) + 1) % 1;
  const W = x2-x1, H = y2-y1;
  const p = 2*(W-2*r) + 2*(H-2*r) + 2*Math.PI*r;
  const fS = (W-2*r)/p, fC = (Math.PI*r/2)/p, fL = (H-2*r)/p;
  const segs = [
    { f:fS, fn:(u)=>({ x:x1+r+u*(W-2*r), y:y1 }) },
    { f:fC, fn:(u)=>{ const a=-Math.PI/2+u*Math.PI/2; return{x:x2-r+Math.cos(a)*r,y:y1+r+Math.sin(a)*r}; } },
    { f:fL, fn:(u)=>({ x:x2, y:y1+r+u*(H-2*r) }) },
    { f:fC, fn:(u)=>{ const a=u*Math.PI/2; return{x:x2-r+Math.cos(a)*r,y:y2-r+Math.sin(a)*r}; } },
    { f:fS, fn:(u)=>({ x:x2-r-u*(W-2*r), y:y2 }) },
    { f:fC, fn:(u)=>{ const a=Math.PI/2+u*Math.PI/2; return{x:x1+r+Math.cos(a)*r,y:y2-r+Math.sin(a)*r}; } },
    { f:fL, fn:(u)=>({ x:x1, y:y2-r-u*(H-2*r) }) },
    { f:fC, fn:(u)=>{ const a=Math.PI+u*Math.PI/2; return{x:x1+r+Math.cos(a)*r,y:y1+r+Math.sin(a)*r}; } },
  ];
  let acc = 0;
  for (const seg of segs) {
    if (t < acc + seg.f) return seg.fn((t - acc) / seg.f);
    acc += seg.f;
  }
  return { x:x1+r, y:y1 };
}

const TRACKS = [
  {
    id:"chicago", name:"Chicago Board Track", km:2.4, corners:8, lapBase:22, rewardMult:1.0,
    desc:"Tight oval, low downforce",
    getPoint:(t)=>rectOvalPt(t,110,65,690,295,58),
    pitEntry:0.61, pitExit:0.67, sfLine:0.01,
    drawExtra:(ctx,sx,sy)=>{
      // Banking stripes on turns
      ctx.save(); ctx.globalAlpha=0.2;
      ctx.strokeStyle="#c9a460"; ctx.lineWidth=3;
      [[0.0,0.06],[0.24,0.31],[0.5,0.56],[0.74,0.81]].forEach(([a,b])=>{
        ctx.beginPath();
        for(let i=0;i<=20;i++){ctx.lineTo(...pt2xy(rectOvalPt((a+(b-a)*i/20),110,65,690,295,58),sx,sy));}
        ctx.stroke();
      });
      ctx.restore();
    },
  },
  {
    id:"daytona", name:"Daytona Beach", km:3.6, corners:4, lapBase:26, rewardMult:1.2,
    desc:"High-speed banked oval, 31° banking",
    getPoint:(t)=>{ const a=-Math.PI/2+((t%1)+1)%1*Math.PI*2; return{x:400+310*Math.cos(a),y:182+118*Math.sin(a)}; },
    pitEntry:0.55, pitExit:0.62, sfLine:0.0,
    drawExtra:(ctx,sx,sy)=>{
      // Infield logo
      ctx.save(); ctx.globalAlpha=0.15;
      ctx.fillStyle="#c9a460"; ctx.font="bold 18px Cinzel,serif";
      ctx.textAlign="center"; ctx.fillText("DAYTONA",sx(400),sy(175));
      ctx.font="10px Cinzel,serif"; ctx.fillText("BEACH",sx(400),sy(193));
      ctx.restore();
    },
  },
  {
    id:"indianapolis", name:"Indianapolis", km:4.0, corners:4, lapBase:28, rewardMult:1.3,
    desc:"Superspeedway, 9° banking, Yard of Bricks",
    getPoint:(t)=>rectOvalPt(t,90,58,710,302,72),
    pitEntry:0.59, pitExit:0.66, sfLine:0.0,
    drawExtra:(ctx,sx,sy)=>{
      ctx.save(); ctx.globalAlpha=0.15;
      ctx.fillStyle="#c9a460"; ctx.font="bold 14px Cinzel,serif";
      ctx.textAlign="center"; ctx.fillText("INDIANAPOLIS",sx(400),sy(175));
      ctx.font="9px Cinzel,serif"; ctx.fillText("MOTOR SPEEDWAY",sx(400),sy(191));
      // Yard of bricks
      ctx.globalAlpha=0.6;
      ctx.fillStyle="#c8a060"; ctx.fillRect(sx(393),sy(58),sx(408)-sx(393),sy(78)-sy(58));
      ctx.restore();
    },
  },
  {
    id:"roosevelt", name:"Roosevelt Raceway", km:2.1, corners:12, lapBase:24, rewardMult:1.1,
    desc:"Technical road course, fast sweepers",
    getPoint:(t)=>interpPtsSmooth([
      {f:0.00,p:{x:400,y:78}},{f:0.09,p:{x:600,y:78}},{f:0.13,p:{x:648,y:108}},
      {f:0.19,p:{x:655,y:170}},{f:0.23,p:{x:630,y:220}},{f:0.27,p:{x:570,y:252}},
      {f:0.34,p:{x:480,y:255}},{f:0.38,p:{x:445,y:218}},{f:0.42,p:{x:462,y:172}},
      {f:0.46,p:{x:520,y:150}},{f:0.50,p:{x:538,y:118}},{f:0.54,p:{x:500,y:92}},
      {f:0.58,p:{x:440,y:88}},{f:0.63,p:{x:382,y:128}},{f:0.67,p:{x:322,y:158}},
      {f:0.71,p:{x:252,y:168}},{f:0.75,p:{x:182,y:148}},{f:0.79,p:{x:142,y:108}},
      {f:0.83,p:{x:152,y:68}},{f:0.89,p:{x:245,y:63}},{f:0.94,p:{x:330,y:66}},
      {f:1.00,p:{x:400,y:78}},
    ], t),
    pitEntry:0.77, pitExit:0.83, sfLine:0.0,
    drawExtra:null,
  },
  {
    id:"boardwalk", name:"Boardwalk Circuit", km:2.8, corners:16, lapBase:25, rewardMult:1.15,
    desc:"Tight street circuit, chicanes, hairpins",
    getPoint:(t)=>interpPts([
      {f:0.00,p:{x:400,y:72}},{f:0.13,p:{x:670,y:72}},{f:0.18,p:{x:712,y:105}},
      {f:0.22,p:{x:718,y:138}},{f:0.25,p:{x:692,y:158}},{f:0.28,p:{x:662,y:148}},
      {f:0.31,p:{x:642,y:168}},{f:0.34,p:{x:660,y:194}},{f:0.38,p:{x:718,y:208}},
      {f:0.42,p:{x:718,y:264}},{f:0.46,p:{x:675,y:290}},{f:0.55,p:{x:400,y:295}},
      {f:0.63,p:{x:125,y:290}},{f:0.67,p:{x:82,y:260}},{f:0.71,p:{x:82,y:198}},
      {f:0.74,p:{x:118,y:174}},{f:0.77,p:{x:155,y:192}},{f:0.80,p:{x:152,y:228}},
      {f:0.83,p:{x:95,y:238}},{f:0.86,p:{x:78,y:128}},{f:0.89,p:{x:80,y:98}},
      {f:0.92,p:{x:118,y:72}},{f:1.00,p:{x:400,y:72}},
    ], t),
    pitEntry:0.69, pitExit:0.75, sfLine:0.0,
    drawExtra:null,
  },
  {
    id:"lakeside", name:"Lakeside Park", km:3.2, corners:10, lapBase:27, rewardMult:1.1,
    desc:"Flowing high-speed sweepers, open circuit",
    getPoint:(t)=>interpPts([
      {f:0.00,p:{x:400,y:68}},{f:0.11,p:{x:630,y:68}},{f:0.15,p:{x:682,y:98}},
      {f:0.21,p:{x:695,y:158}},{f:0.27,p:{x:658,y:218}},{f:0.33,p:{x:578,y:258}},
      {f:0.39,p:{x:498,y:282}},{f:0.44,p:{x:438,y:298}},{f:0.49,p:{x:378,y:288}},
      {f:0.53,p:{x:318,y:258}},{f:0.57,p:{x:268,y:228}},{f:0.61,p:{x:228,y:208}},
      {f:0.65,p:{x:184,y:228}},{f:0.69,p:{x:154,y:268}},{f:0.73,p:{x:128,y:238}},
      {f:0.77,p:{x:108,y:178}},{f:0.81,p:{x:118,y:128}},{f:0.85,p:{x:158,y:94}},
      {f:0.90,p:{x:220,y:68}},{f:1.00,p:{x:400,y:68}},
    ], t),
    pitEntry:0.64, pitExit:0.70, sfLine:0.0,
    drawExtra:null,
  },
  {
    id:"harbor", name:"Harbor Front", km:2.5, corners:20, lapBase:23, rewardMult:1.05,
    desc:"Narrow dockside street track, low grip",
    getPoint:(t)=>interpPts([
      {f:0.00,p:{x:400,y:62}},{f:0.07,p:{x:555,y:62}},{f:0.11,p:{x:594,y:82}},
      {f:0.14,p:{x:614,y:108}},{f:0.17,p:{x:595,y:128}},{f:0.20,p:{x:564,y:118}},
      {f:0.23,p:{x:540,y:138}},{f:0.26,p:{x:564,y:162}},{f:0.30,p:{x:615,y:172}},
      {f:0.34,p:{x:645,y:208}},{f:0.37,p:{x:635,y:248}},{f:0.41,p:{x:594,y:272}},
      {f:0.49,p:{x:400,y:298}},{f:0.57,p:{x:206,y:272}},{f:0.61,p:{x:162,y:248}},
      {f:0.65,p:{x:152,y:202}},{f:0.68,p:{x:178,y:168}},{f:0.71,p:{x:215,y:162}},
      {f:0.74,p:{x:232,y:138}},{f:0.77,p:{x:208,y:112}},{f:0.80,p:{x:176,y:105}},
      {f:0.83,p:{x:148,y:82}},{f:0.86,p:{x:162,y:62}},{f:0.91,p:{x:238,y:62}},
      {f:1.00,p:{x:400,y:62}},
    ], t),
    pitEntry:0.79, pitExit:0.85, sfLine:0.0,
    drawExtra:null,
  },
  {
    id:"mountain", name:"Mountain Pass", km:4.2, corners:18, lapBase:29, rewardMult:1.25,
    desc:"Long elevation changes, sweeping S-curves",
    getPoint:(t)=>interpPts([
      {f:0.00,p:{x:400,y:62}},{f:0.06,p:{x:598,y:68}},{f:0.11,p:{x:652,y:94}},
      {f:0.16,p:{x:668,y:142}},{f:0.21,p:{x:640,y:182}},{f:0.25,p:{x:582,y:202}},
      {f:0.29,p:{x:542,y:238}},{f:0.33,p:{x:552,y:278}},{f:0.37,p:{x:604,y:298}},
      {f:0.41,p:{x:608,y:320}},{f:0.45,p:{x:548,y:312}},{f:0.49,p:{x:478,y:288}},
      {f:0.53,p:{x:418,y:292}},{f:0.57,p:{x:358,y:308}},{f:0.61,p:{x:288,y:298}},
      {f:0.65,p:{x:228,y:268}},{f:0.69,p:{x:188,y:238}},{f:0.73,p:{x:158,y:198}},
      {f:0.77,p:{x:138,y:152}},{f:0.81,p:{x:148,y:112}},{f:0.85,p:{x:188,y:82}},
      {f:0.90,p:{x:268,y:62}},{f:1.00,p:{x:400,y:62}},
    ], t),
    pitEntry:0.71, pitExit:0.77, sfLine:0.0,
    drawExtra:null,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function pt2xy(p, sx, sy) { return [sx(p.x), sy(p.y)]; }

/** Approximate curvature at track position t (0..1). Higher = sharper corner. */
function getCurvature(track, t) {
  const eps = 0.008;
  const t0 = (t - eps + 1) % 1;
  const t1 = (t + eps) % 1;
  const p0 = track.getPoint(t0);
  const p1 = track.getPoint(t);
  const p2 = track.getPoint(t1);
  const dx1 = p1.x - p0.x, dy1 = p1.y - p0.y;
  const dx2 = p2.x - p1.x, dy2 = p2.y - p1.y;
  const len1 = Math.hypot(dx1, dy1) || 1e-6;
  const len2 = Math.hypot(dx2, dy2) || 1e-6;
  const ang1 = Math.atan2(dy1, dx1);
  const ang2 = Math.atan2(dy2, dx2);
  let delta = ang2 - ang1;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  const arcLen = (len1 + len2) / 2;
  return Math.abs(delta) / arcLen;
}

/** Corner multiplier: 1.0 on straights, ~0.78 in sharp corners. Scale by grip (higher grip = less slowdown). Cars carry more speed through corners. */
function getCornerMult(curvature, baseGrip = 0.85) {
  const k = 0.007;
  const raw = 1 / (1 + curvature * k);
  const minMult = 0.78 + (baseGrip - 0.5) * 0.15;
  return Math.max(minMult, Math.min(1, raw));
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function tyreColor(wear) {
  if (wear > 60) return "#27ae60";
  if (wear > 30) return "#f39c12";
  return "#e74c3c";
}

/** Stint length in laps (2–4) from tyre, weather and reliability. Used for pit strategy and wear. */
function getEffectiveStintLaps(tyreId, weatherWearMult, reliabilityWearMult) {
  const td = TYRE_DEFS[tyreId] || TYRE_DEFS.medium;
  const base = td.lapsPerStintBase != null ? td.lapsPerStintBase : 3;
  const mult = (weatherWearMult || 1) * (reliabilityWearMult || 1);
  const laps = base / mult;
  return Math.max(2, Math.min(4, Math.round(laps)));
}

/** Build pit strategy: pit every 2–4 laps (tyre/weather/reliability dependent). */
function buildPitStrategy(tyreId, numLaps, weatherWearMult = 1, reliabilityWearMult = 1) {
  if (numLaps <= 2) return [];
  const stintLaps = getEffectiveStintLaps(tyreId, weatherWearMult, reliabilityWearMult);
  const nextTyre = tyreId === "soft" ? "medium" : tyreId === "medium" ? "hard" : "medium";
  const stops = [];
  for (let lap = stintLaps; lap < numLaps; lap += stintLaps) {
    stops.push({ lap, nextTyre });
  }
  return stops;
}

/** Build pit strategy for replay from backend pit_stops (list of { lap, entrant_id }). */
function buildReplayPitStrategy(entrantId, pitStopsList, defaultTyre = "medium") {
  const stops = (pitStopsList || []).filter((ps) => ps.entrant_id === entrantId);
  if (!stops.length) return [];
  return stops.map((ps) => ({ lap: ps.lap, nextTyre: defaultTyre }));
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function CircuitRaceView({
  // Props from Racing.jsx (post-race replay mode)
  participants = [],
  lap_results = [],
  pit_stops = [],
  qualifying_order = [],
  tire_wear_after_lap = {},
  laps: totalLaps = 3,
  resultOrder = [],
  weather: weatherIdProp = "clear",
  weather_name: weatherNameProp,
  onComplete,
  // Props for standalone / pre-race mode (new usage)
  mode = "replay", // "replay" | "live"
  initialTrackId = "chicago",
  initialCondition = "clear",
  playerCarName = "Stutz Bearcat",
  playerTyreId = "medium",
  playerPitLevel = 0,
  currentUserId = null, // in replay: mark this user as "You" and show first in standings
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const stateRef = useRef(null); // mutable race state (avoids closure staleness)
  const countdownIntervalRef = useRef(null);

  // ── UI STATE ──
  const [uiPhase, setUiPhase] = useState("setup"); // setup | countdown | racing | done
  const [selectedTrack, setSelectedTrack] = useState(() => TRACKS.find(t=>t.id===initialTrackId)||TRACKS[0]);
  const [condition, setCondition] = useState(initialCondition);
  const [chosenTyre, setChosenTyre] = useState(playerTyreId);
  const [numLaps, setNumLaps] = useState(() => Math.max(2, Math.min(20, totalLaps)));
  const [countdown, setCountdown] = useState(3);
  const [commentary, setCommentary] = useState("Select track & tyres, then start");
  const [standings, setStandings] = useState([]);
  const [pitNotif, setPitNotif] = useState(null);
  const [lapDisplay, setLapDisplay] = useState("—"); // "—" until race starts; then "1 / N" … "N / N" (qualifying is not lap 1)
  const [results, setResults] = useState(null);
  const pitNotifTimer = useRef(null);
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // In replay mode, derive condition from weather prop; in live mode weather is automatic (from race)
  const effectiveCondition = mode === "replay" || mode === "live"
    ? (WEATHER_MAP[weatherIdProp] || "clear")
    : condition;
  const wDef = WEATHER_DEFS[effectiveCondition] || WEATHER_DEFS.clear;

  // ── CANVAS SCALE ──
  const getScale = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { sx: x=>x, sy: y=>y, W:800, H:360 };
    const W = canvas.width / (window.devicePixelRatio||1);
    const H = canvas.height / (window.devicePixelRatio||1);
    return {
      sx: (x) => (x / 800) * W,
      sy: (y) => (y / 360) * H,
      W, H,
    };
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = Math.max(200, Math.min(w * 0.48, 320));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }, []);

  // ── DRAW TRACK ──
  const drawTrackCanvas = useCallback((track, cond, racerArr, nowSec = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { sx, sy, W, H } = getScale();
    const wd = WEATHER_DEFS[cond] || WEATHER_DEFS.clear;

    // Background
    const bg = ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0, wd.bg1); bg.addColorStop(1, wd.bg2);
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

    // Weather particles
    if (cond === "rain") {
      ctx.strokeStyle = "rgba(150,185,225,0.14)"; ctx.lineWidth = 0.9;
      for (let i=0;i<60;i++) {
        const x=((i*47+Date.now()*0.06)%W), y=((i*61+Date.now()*0.09)%H);
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+1.5,y+7); ctx.stroke();
      }
    }
    if (cond === "snow") {
      ctx.fillStyle = "rgba(210,225,255,0.18)";
      for (let i=0;i<35;i++) {
        const x=((i*53+Date.now()*0.025)%W), y=((i*71+Date.now()*0.035)%H);
        ctx.beginPath(); ctx.arc(x,y,1.3,0,Math.PI*2); ctx.fill();
      }
    }
    if (cond === "night") {
      // Lamp glows along track
      [0.08,0.22,0.38,0.52,0.66,0.80].forEach(f=>{
        const lp = track.getPoint(f);
        const grd = ctx.createRadialGradient(sx(lp.x),sy(lp.y),0,sx(lp.x),sy(lp.y),50);
        grd.addColorStop(0,"rgba(255,210,90,0.18)"); grd.addColorStop(1,"rgba(255,210,90,0)");
        ctx.fillStyle=grd; ctx.fillRect(sx(lp.x)-50,sy(lp.y)-50,100,100);
        // post
        ctx.strokeStyle="rgba(100,90,60,0.55)"; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(sx(lp.x),sy(lp.y)); ctx.lineTo(sx(lp.x),sy(lp.y)-16); ctx.stroke();
        ctx.fillStyle="rgba(255,225,100,0.9)"; ctx.beginPath(); ctx.arc(sx(lp.x),sy(lp.y)-16,2,0,Math.PI*2); ctx.fill();
      });
    }
    if (cond === "very_hot") {
      ctx.fillStyle="rgba(255,80,0,0.03)"; ctx.fillRect(0,0,W,H);
    }

    // ── TRACK SURFACE (draw as thick stroked path) ──
    const STEPS = 320;
    const buildPath = (ctx) => {
      ctx.beginPath();
      for (let i=0;i<=STEPS;i++) {
        const p=track.getPoint(i/STEPS);
        if(i===0) ctx.moveTo(sx(p.x),sy(p.y)); else ctx.lineTo(sx(p.x),sy(p.y));
      }
      ctx.closePath();
    };

    // Glow halo
    buildPath(ctx);
    ctx.strokeStyle = cond==="night" ? "rgba(255,200,80,0.10)" : "rgba(80,130,50,0.25)";
    ctx.lineWidth = 36; ctx.lineJoin="round"; ctx.lineCap="round"; ctx.stroke();

    // Tarmac
    const tarmacColor = cond==="rain"?"#262420":cond==="snow"?"#303045":cond==="night"?"#1a1815":"#2e2c28";
    buildPath(ctx);
    ctx.strokeStyle = tarmacColor; ctx.lineWidth = 26; ctx.stroke();

    // White centre line dashes
    ctx.setLineDash([10,14]);
    buildPath(ctx);
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);

    // Kerbing — red/white
    ctx.setLineDash([7,7]);
    buildPath(ctx);
    ctx.strokeStyle = "rgba(220,40,40,0.50)"; ctx.lineWidth = 4; ctx.stroke();
    ctx.setLineDash([]);

    // Pit entry marker
    const pitPt = track.getPoint(track.pitEntry);
    ctx.fillStyle = "rgba(232,200,112,0.8)";
    ctx.beginPath(); ctx.arc(sx(pitPt.x),sy(pitPt.y),5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "rgba(232,200,112,0.9)";
    ctx.font = "6px Cinzel,serif"; ctx.textAlign="center";
    ctx.fillText("PIT", sx(pitPt.x), sy(pitPt.y)-8);

    // Start/finish line
    const sfPt = track.getPoint(track.sfLine);
    const sfPt2 = track.getPoint(track.sfLine + 0.005);
    const ang = Math.atan2(sy(sfPt2.y)-sy(sfPt.y), sx(sfPt2.x)-sx(sfPt.x)) + Math.PI/2;
    ctx.save();
    ctx.translate(sx(sfPt.x), sy(sfPt.y)); ctx.rotate(ang);
    for (let i=0;i<5;i++) {
      ctx.fillStyle = i%2===0 ? "#fff" : "#111";
      ctx.fillRect(-13+i*5.2, -6, 5.2, 12);
    }
    ctx.restore();
    ctx.fillStyle="rgba(232,200,112,0.9)"; ctx.font="bold 7px Cinzel,serif"; ctx.textAlign="center";
    ctx.fillText("S/F", sx(sfPt.x), sy(sfPt.y)-11);

    // Extra track-specific decoration
    if (track.drawExtra) track.drawExtra(ctx, sx, sy);

    // ── CARS ──
    if (!racerArr || racerArr.length === 0) return;

    // Draw back to front so leader (last in reversed order) appears at the front; use r.position for car number
    const drawOrder = [...racerArr].reverse();
    drawOrder.forEach((r, drawIdx) => {
      if (!r.visible) return;
      const spread = 0.009 * drawIdx;
      // When in pit: draw car at pit box (middle of pit lane) so it stays visibly in pit
      const pitPos = (track.pitEntry + track.pitExit) / 2;
      // Use progress (totalLapsDone + trackPos) for draw so order matches leaderboard: negative = back of grid → draw at 0
      const progress = (r.totalLapsDone ?? 0) + r.trackPos;
      const tRaw = r.inPit ? pitPos + spread * 0.5 : (progress < 0 ? 0 : ((progress % 1) + 1) % 1);
      const t = r.inPit ? tRaw % 1 : (tRaw + spread) % 1;
      const p = track.getPoint(t);
      const p2 = track.getPoint((t + 0.006) % 1);
      const angle = Math.atan2(sy(p2.y)-sy(p.y), sx(p2.x)-sx(p.x));
      const offTrack = r.slideOffUntil > 0 && nowSec < r.slideOffUntil;
      const offs = offTrack ? 14 : 0;
      const px = sx(p.x) + Math.cos(angle + Math.PI/2) * offs;
      const py = sy(p.y) + Math.sin(angle + Math.PI/2) * offs;

      // Speed glow
      const grd = ctx.createRadialGradient(px,py,0,px,py,18);
      grd.addColorStop(0, r.color+"44"); grd.addColorStop(1, r.color+"00");
      ctx.fillStyle=grd; ctx.fillRect(px-18,py-18,36,36);

      // Shadow
      ctx.save(); ctx.translate(px,py+4); ctx.scale(1.1,0.4);
      ctx.fillStyle="rgba(0,0,0,0.45)"; ctx.beginPath(); ctx.arc(0,0,9,0,Math.PI*2); ctx.fill();
      ctx.restore();

      // Car body
      ctx.save(); ctx.translate(px,py); ctx.rotate(angle);
      ctx.fillStyle = r.color;
      ctx.beginPath(); ctx.roundRect(-9,-4,18,8,2.5); ctx.fill();
      ctx.strokeStyle="rgba(255,255,255,0.22)"; ctx.lineWidth=0.8; ctx.stroke();
      // Cockpit
      ctx.fillStyle="rgba(0,0,0,0.62)";
      ctx.beginPath(); ctx.ellipse(1,0,3.5,2.5,0,0,Math.PI*2); ctx.fill();
      ctx.restore();

      // Car number circle (F1 Manager style) — use race position so leader shows 1 and appears at front
      const isPlayer = r.isPlayer;
      const carNumber = r.position != null ? r.position : drawIdx + 1;
      ctx.fillStyle = isPlayer ? "#e8c870" : r.color;
      ctx.beginPath(); ctx.arc(px,py-13,7,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = isPlayer ? "#0a0c06" : "rgba(0,0,0,0.6)"; ctx.lineWidth=1.2; ctx.stroke();
      ctx.fillStyle = isPlayer ? "#0a0c06" : "#fff";
      ctx.font = `bold 7px Rajdhani,sans-serif`; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(carNumber, px, py-13);
      ctx.textBaseline = "alphabetic";

      // Tyre compound dot
      const td = TYRE_DEFS[r.currentTyre] || TYRE_DEFS.medium;
      ctx.fillStyle = td.color;
      ctx.beginPath(); ctx.arc(px+11,py-6,4,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle="rgba(0,0,0,0.5)"; ctx.lineWidth=0.8; ctx.stroke();

      // Pit label
      if (r.inPit) {
        ctx.fillStyle="#ff9800"; ctx.font="bold 8px Cinzel,serif"; ctx.textAlign="center";
        ctx.fillText("PIT", px, py+16);
      }
      if (offTrack) {
        ctx.fillStyle="#e74c3c"; ctx.font="bold 7px Cinzel,serif"; ctx.textAlign="center";
        ctx.fillText("OFF", px, py+16);
      }
    });
  }, [getScale]);

  // ── BUILD RACER ARRAY ──
  const buildRacers = useCallback((track, cond, nLaps, pTyre) => {
    const wd = WEATHER_DEFS[cond] || WEATHER_DEFS.clear;
    const weatherWear = wd.wearMult != null ? wd.wearMult : 1;
    const racers = [];
    const playerPitSec = pitDurationSeconds(playerPitLevel, false);
    const playerPitSecEmerg = pitDurationSeconds(playerPitLevel, true);
    racers.push({
      id:"player", name:"You", isPlayer:true,
      color:CAR_COLORS[0], carName:playerCarName,
      trackPos:0, lapCount:1, totalLapsDone:0,
      currentTyre:pTyre, tyreWear:100,
      pitStops:0, inPit:false, pitEndAt:0,
      pitDurationSeconds: playerPitSec,
      pitDurationEmergencySeconds: playerPitSecEmerg,
      baseSpeed:1.0, baseGrip:0.85,
      reliabilityWearMult: 1,
      pitStrategy: buildPitStrategy(pTyre, nLaps, weatherWear, 1),
      finished:false, visible:true, position:1,
      lapTimes:[],
      slideOffUntil:0, pitExitUntil: null,
    });
    for (let i=0;i<7;i++) {
      const carIdx = i % NPC_CARS.length;
      const statsIdx = i % NPC_CAR_STATS.length;
      const stats = NPC_CAR_STATS[statsIdx] || NPC_CAR_STATS[0];
      const t = NPC_TYRE_POOL[i] in TYRE_DEFS ? NPC_TYRE_POOL[i] : "medium";
      racers.push({
        id:`npc_${i}`, name:NPC_NAMES[i], isPlayer:false,
        color:CAR_COLORS[i+1], carName:NPC_CARS[carIdx],
        trackPos: -(i+1)*0.012, lapCount:1, totalLapsDone:0,
        currentTyre:t, tyreWear:100,
        pitStops:0, inPit:false, pitEndAt:0,
        pitDurationSeconds: 3.0,
        pitDurationEmergencySeconds: 3.8,
        baseSpeed: stats.baseSpeed + (Math.random()-0.5)*0.06,
        baseGrip: stats.baseGrip,
        reliabilityWearMult: 1,
        pitStrategy: buildPitStrategy(t, nLaps, weatherWear, 1),
        finished:false, visible:true, position:i+2,
        lapTimes:[],
        slideOffUntil:0, pitExitUntil: null,
      });
    }
    return racers;
  }, [playerCarName, playerPitLevel]);

  // ── RACE LOOP ──
  const startRaceLoop = useCallback((track, cond, nLaps, racerArr) => {
    const wd = WEATHER_DEFS[cond] || WEATHER_DEFS.clear;
    let lastFrameTime = performance.now();
    let lastCommTime = performance.now();
    let commPhase = "start";
    let commQueue = [...COMMENTARY.start];
    let firstFrame = true;

    stateRef.current = { racers: racerArr, track, nLaps, wd };

    const loop = (now) => {
      let dt = (now - lastFrameTime) / 1000;
      if (firstFrame) {
        firstFrame = false;
        dt = 0;
      }
      dt = Math.min(0.05, dt);
      lastFrameTime = now;

      const { racers } = stateRef.current;
      let allDone = true;

      racers.forEach((r) => {
        if (r.finished) return;
        allDone = false;

        // Pit stop in progress — car stays in pit until pitEndAt
        if (r.inPit) {
          if (now / 1000 >= r.pitEndAt) {
            r.inPit = false; r.tyreWear = 100; r.pitStops++;
            r.pitExitUntil = now / 1000 + 2.5; // slow take-off after exit
            r.trackPos = track.pitExit; // rejoin at pit exit
            if (r.pitStrategy.length > 0) {
              r.currentTyre = r.pitStrategy[0].nextTyre;
              r.pitStrategy = r.pitStrategy.slice(1);
            }
            if (r.isPlayer) {
              clearTimeout(pitNotifTimer.current);
              setPitNotif(`Out of pits — ${TYRE_DEFS[r.currentTyre]?.label} fitted ✓`);
              pitNotifTimer.current = setTimeout(() => setPitNotif(null), 2500);
            }
          }
          return; // don't move while pitting
        }

        const nowSec = now / 1000;
        // Slow take-off after pit exit (ramp speed from ~50% to 100% over ~2.5s)
        let pitExitMult = 1.0;
        if (r.pitExitUntil != null && nowSec < r.pitExitUntil) {
          const exitDuration = 2.5;
          const elapsed = exitDuration - (r.pitExitUntil - nowSec);
          pitExitMult = Math.min(1.0, 0.5 + 0.5 * (elapsed / exitDuration));
        }
        if (r.pitExitUntil != null && nowSec >= r.pitExitUntil) r.pitExitUntil = null;

        // Tyre wear factor
        const td = TYRE_DEFS[r.currentTyre] || TYRE_DEFS.medium;
        const wearFactor = Math.max(0.4, r.tyreWear / 100);
        const wdGrip = (wd.gripMult != null) ? wd.gripMult : 1.0;
        const effectiveGrip = (r.baseGrip != null ? r.baseGrip : 0.85) * wearFactor * wdGrip;
        const effSpeed = r.baseSpeed * td.gripMult * wd.speedMult * wearFactor * pitExitMult;

        // Corner-aware speed: slow in corners, fast on straights (weather + tyre grip affect cornering)
        const curvature = getCurvature(track, r.trackPos);
        const cornerMult = getCornerMult(curvature, effectiveGrip);

        // Slide off track: high curvature + low grip → chance to slide off; while off, crawl back on
        const prevPos = r.trackPos;
        if (r.slideOffUntil > 0 && nowSec < r.slideOffUntil) {
          // Still off track — reduced advance (rejoining)
          const lapTime = track.lapBase / effSpeed;
          const advance = (1.0 / lapTime) * dt * 0.18;
          r.trackPos = (r.trackPos + advance + 1) % 1;
        } else {
          r.slideOffUntil = 0;
          // Normal advance
          const lapTime = track.lapBase / effSpeed;
          const advance = (1.0 / lapTime) * dt * cornerMult;
          r.trackPos = (r.trackPos + advance + 1) % 1;
          // Chance to slide off in sharp corners with low grip
          if (curvature > 0.10 && effectiveGrip < 0.82 && Math.random() < dt * 2.2 * (0.85 - effectiveGrip) * Math.min(1, curvature / 0.18)) {
            r.slideOffUntil = nowSec + 0.5 + Math.random() * 0.6;
          }
        }

        // Detect lap crossing: only when we've actually completed a full lap (prevPos was on track, not start)
        // Require prevPos > 0.3 so we never count a spurious "lap" from initial state or wrap from start line
        if (prevPos > 0.3 && prevPos > 0.93 && r.trackPos < 0.07) {
          r.totalLapsDone++;
          r.lapCount = r.totalLapsDone + 1;
          const lt = track.lapBase / effSpeed + (Math.random() - 0.5) * 0.8;
          r.lapTimes.push(lt);
          if (r.totalLapsDone >= nLaps) {
            r.finished = true; r.visible = false;
          }
        }

        // Tyre wear: per-lap wear so you pit every 2–4 laps (tyre/weather/reliability)
        if (r.tireWearByLap && r.tireWearByLap.length)
          r.tyreWear = r.tireWearByLap[Math.min(r.totalLapsDone, r.tireWearByLap.length - 1)];
        else {
          const stintLaps = getEffectiveStintLaps(r.currentTyre, wd.wearMult, r.reliabilityWearMult);
          const wearPerLap = 85 / stintLaps;
          const lapTimeSec = track.lapBase / effSpeed;
          const wearPerSec = lapTimeSec > 0 ? wearPerLap / lapTimeSec : wearPerLap / 22;
          r.tyreWear = Math.max(td.minWear, r.tyreWear - wearPerSec * dt);
        }

        // Pit decision: pit when we're on or past the planned lap and tyre wear is low enough, and we're near pit entry
        if (!r.inPit && r.pitStrategy.length > 0) {
          const next = r.pitStrategy[0];
          const currentLap = r.totalLapsDone + 1;
          const shouldPit = currentLap >= next.lap && r.tyreWear < 45;
          if (shouldPit) {
            const distToPit = Math.abs(((r.trackPos - track.pitEntry) + 1) % 1);
            if (distToPit < 0.12) {
              r.inPit = true;
              const dur = (r.pitDurationSeconds != null ? r.pitDurationSeconds : 3.0);
              r.pitEndAt = now / 1000 + dur;
              if (r.isPlayer) {
                setPitNotif("🔧 PIT STOP — Changing tyres…");
              }
            }
          }
        }
        // Emergency pit on critically worn tyres
        if (!r.inPit && r.tyreWear <= td.minWear + 1) {
          const dist = Math.abs(((r.trackPos - track.pitEntry) + 1) % 1);
          if (dist < 0.12) {
            r.inPit = true;
            const durEmerg = (r.pitDurationEmergencySeconds != null ? r.pitDurationEmergencySeconds : 3.8);
            r.pitEndAt = now / 1000 + durEmerg;
            if (r.isPlayer) setPitNotif("⚠️ Emergency pit — tyres critical!");
          }
        }
      });

      // Sort by position: progress = totalLapsDone + trackPos; higher = leader. Tie-break by previous position so leader stays leader.
      const sorted = [...racers].sort((a, b) => {
        const progressA = (a.totalLapsDone ?? 0) + (a.trackPos ?? 0);
        const progressB = (b.totalLapsDone ?? 0) + (b.trackPos ?? 0);
        if (Math.abs(progressB - progressA) > 1e-9) return progressB - progressA;
        return (a.position ?? 99) - (b.position ?? 99);
      });
      sorted.forEach((r, i) => { r.position = i + 1; });

      // Lap display: current lap = laps completed + 1 (so we show "1 / N" at start, "2 / N" after first crossing, etc.)
      const leaderLap = Math.max(0, ...racers.map((r) => r.totalLapsDone ?? 0));
      setLapDisplay(`${Math.min(leaderLap + 1, nLaps)} / ${nLaps}`);

      // Commentary
      if (now - lastCommTime > 3200) {
        lastCommTime = now;
        const lf = leaderLap / nLaps;
        if (lf < 0.15) { commPhase="start"; commQueue = [...COMMENTARY.start]; }
        else if (lf < 0.75) { commPhase="mid"; commQueue = [...COMMENTARY.mid]; }
        else if (lf < 0.92) { commPhase="final"; commQueue = [...COMMENTARY.final]; }
        else { commPhase="done"; commQueue = [...COMMENTARY.done]; }
        if (!commQueue.length) commQueue = [...COMMENTARY[commPhase]];
        const idx = Math.floor(Math.random() * commQueue.length);
        setCommentary(commQueue[idx]);
        commQueue.splice(idx, 1);
      }

      // Draw
      drawTrackCanvas(track, cond, sorted, now / 1000);

      // Update standings state (gap in fractional laps; leader progress used for all)
      const leaderProgress = sorted[0].totalLapsDone + sorted[0].trackPos;
      const nowSec = now / 1000;
      setStandings(sorted.map(r=>{
        const progress = r.totalLapsDone + r.trackPos;
        const gapLaps = leaderProgress - progress;
        const pitTimeRemaining = r.inPit && r.pitEndAt ? Math.max(0, r.pitEndAt - nowSec) : 0;
        return {
          id:r.id, name:r.name, isPlayer:r.isPlayer,
          color:r.color, carName:r.carName,
          position:r.position, lapCount:r.lapCount,
          currentTyre:r.currentTyre, tyreWear:r.tyreWear,
          inPit:r.inPit, finished:r.finished,
          pitStops:r.pitStops,
          pitTimeRemaining,
          gap: gapLaps,
          lapsDown: Math.floor(gapLaps),
        };
      }));

      if (allDone) {
        setUiPhase("done");
        setCommentary(rand(COMMENTARY.done));
        // Build results: same progress formula as during race (totalLapsDone + trackPos)
        const finalOrder = [...racers].sort((a, b) => {
          const pa = (a.totalLapsDone ?? 0) + (a.trackPos ?? 0);
          const pb = (b.totalLapsDone ?? 0) + (b.trackPos ?? 0);
          if (Math.abs(pb - pa) > 1e-9) return pb - pa;
          return (a.position ?? 99) - (b.position ?? 99);
        });
        setResults(finalOrder.map((r,i)=>({
          pos:i+1, id:r.id, name:r.name, isPlayer:r.isPlayer,
          color:r.color, carName:r.carName, pitStops:r.pitStops,
          lapTimes:r.lapTimes,
          bestLap:r.lapTimes.length ? Math.min(...r.lapTimes) : null,
        })));
        const resultOrderIds = finalOrder.map((r) => r.id);
        setTimeout(()=>onComplete?.(resultOrderIds), 1200);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [drawTrackCanvas, onComplete]);

  // ── REPLAY MODE ──
  // When mode==="replay", auto-start using backend data (pre-computed result)
  useEffect(() => {
    if (mode !== "replay") return;
    if (!participants.length && !resultOrder.length) return;
    const rawOrder = (qualifying_order && qualifying_order.length) ? qualifying_order : (resultOrder.length ? resultOrder : participants.map(p => p.user_id || p.id));
    // Deduplicate: one racer per entrant id (keep first occurrence) so leaderboard never shows duplicate names/positions
    const seen = new Set();
    const order = rawOrder.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    resizeCanvas();
    const track = TRACKS.find(t=>t.id===initialTrackId) || TRACKS[0];
    const cond = WEATHER_MAP[weatherIdProp] || "clear";
      const racers = order.map((id, i) => {
      const p = participants.find(x=>(x.user_id||x.id)===id) || {};
      const isPlayer = (currentUserId != null && (id === currentUserId || p.user_id === currentUserId));
      const effSpeed = p.effective_speed != null ? p.effective_speed : 15;
      const effGrip = p.effective_grip != null ? p.effective_grip : 0.85;
      const baseSpeed = effSpeed / 15;
      const tyreId = (p.tyre_compound || "medium").toLowerCase();
      const pitLvl = p.pit_level != null ? p.pit_level : 0;
      const replayPitStrategy = buildReplayPitStrategy(id, pit_stops, tyreId);
      return {
        id, name:p.username||p.car_name||`#${i+1}`, isPlayer,
        color:CAR_COLORS[i%CAR_COLORS.length], carName:p.car_name||"",
        trackPos: i * (-0.012), lapCount:1, totalLapsDone:0,
        currentTyre: tyreId in TYRE_DEFS ? tyreId : "medium",
        tyreWear: Array.isArray(tire_wear_after_lap[id]) ? (tire_wear_after_lap[id][0] ?? 100) : 100,
        pitStops:0, inPit:false, pitEndAt:0,
        pitDurationSeconds: pitDurationSeconds(pitLvl, false),
        pitDurationEmergencySeconds: pitDurationSeconds(pitLvl, true),
        baseSpeed, baseGrip: effGrip,
        pitStrategy: replayPitStrategy, finished:false, visible:true, position:i+1, lapTimes:[],
        tireWearByLap: tire_wear_after_lap[id],
        slideOffUntil: 0, pitExitUntil: null,
      };
    });
    stateRef.current = { racers, track, nLaps: totalLaps, wd: WEATHER_DEFS[cond] || WEATHER_DEFS.clear };
    stateRef.current.pendingReplay = { racers, track, cond, totalLaps };
    setUiPhase("countdown");
    setCountdown(3);
    setCommentary(rand(COMMENTARY.start));
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          setUiPhase("racing");
          const pr = stateRef.current?.pendingReplay;
          if (pr) startRaceLoop(pr.track, pr.cond, pr.totalLaps, pr.racers);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replay init: only re-run when mode / currentUserId
  }, [mode, currentUserId]);

  // ── LIVE MODE ──
  // When mode==="live", race runs in real time; build racers from participants + qualifying_order (no backend result)
  useEffect(() => {
    if (mode !== "live") return;
    if (!participants.length || !(qualifying_order && qualifying_order.length)) return;
    const seen = new Set();
    const order = qualifying_order.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    resizeCanvas();
    const track = TRACKS.find((t) => t.id === initialTrackId) || TRACKS[0];
    const cond = WEATHER_MAP[weatherIdProp] || "clear";
    const wd = WEATHER_DEFS[cond] || WEATHER_DEFS.clear;
    const weatherWear = wd.wearMult != null ? wd.wearMult : 1;
    const racers = order.map((id, i) => {
      const p = participants.find((x) => (x.user_id || x.id) === id) || {};
      const isPlayer = currentUserId != null && (id === currentUserId || p.user_id === currentUserId);
      const effSpeed = p.effective_speed != null ? p.effective_speed : 15;
      const effGrip = p.effective_grip != null ? p.effective_grip : 0.85;
      const baseSpeed = effSpeed / 15;
      const tyreId = (p.tyre_compound || "medium").toLowerCase();
      const pitLvl = p.pit_level != null ? p.pit_level : 0;
      const relLevel = p.reliability_level != null ? p.reliability_level : 0;
      const reliabilityWearMult = 1 - 0.08 * relLevel;
      return {
        id,
        name: p.username || p.car_name || `#${i + 1}`,
        isPlayer,
        color: CAR_COLORS[i % CAR_COLORS.length],
        carName: p.car_name || "",
        trackPos: i * -0.012,
        lapCount: 1,
        totalLapsDone: 0,
        currentTyre: tyreId in TYRE_DEFS ? tyreId : "medium",
        tyreWear: 100,
        pitStops: 0,
        inPit: false,
        pitEndAt: 0,
        pitDurationSeconds: pitDurationSeconds(pitLvl, false),
        pitDurationEmergencySeconds: pitDurationSeconds(pitLvl, true),
        baseSpeed,
        baseGrip: effGrip,
        reliabilityWearMult,
        pitStrategy: buildPitStrategy(tyreId in TYRE_DEFS ? tyreId : "medium", totalLaps, weatherWear, reliabilityWearMult),
        finished: false,
        visible: true,
        position: i + 1,
        lapTimes: [],
        slideOffUntil: 0,
        pitExitUntil: null,
      };
    });
    stateRef.current = { racers, track, nLaps: totalLaps, wd: WEATHER_DEFS[cond] || WEATHER_DEFS.clear };
    stateRef.current.pendingReplay = { racers, track, cond, totalLaps };
    setUiPhase("countdown");
    setCountdown(3);
    setCommentary(rand(COMMENTARY.start));
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          setUiPhase("racing");
          const pr = stateRef.current?.pendingReplay;
          if (pr) startRaceLoop(pr.track, pr.cond, pr.totalLaps, pr.racers);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- live init: participants, qualifying_order, totalLaps, etc.
  }, [mode, currentUserId]);

  // Draw loop during replay/live countdown (grid visible, no movement)
  useEffect(() => {
    if (uiPhase !== "countdown" || (mode !== "replay" && mode !== "live")) return;
    let rafId;
    const draw = () => {
      const { track, racers } = stateRef.current || {};
      if (track && racers?.length) drawTrackCanvas(track, effectiveCondition, racers);
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- countdown draw loop: deps are read from stateRef
  }, [uiPhase, mode, effectiveCondition, drawTrackCanvas]);

  // ── HANDLE START (live mode) ──
  const handleStart = useCallback(() => {
    if (uiPhase === "racing") return;
    resizeCanvas();
    const track = selectedTrack;
    const cond = effectiveCondition;
    const racers = buildRacers(track, cond, numLaps, chosenTyre);
    setUiPhase("countdown");
    setCountdown(3);
    let c = 3;
    const cdInterval = setInterval(() => {
      c--;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(cdInterval);
        setUiPhase("racing");
        setCommentary(rand(COMMENTARY.start));
        startRaceLoop(track, cond, numLaps, racers);
      }
    }, 1000);
  }, [uiPhase, selectedTrack, effectiveCondition, numLaps, chosenTyre, buildRacers, resizeCanvas, startRaceLoop]);

  const handleReset = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setUiPhase("setup"); setResults(null); setStandings([]);
    setCommentary("Select track & tyres, then start");
    resizeCanvas();
    // Draw static preview
    requestAnimationFrame(() => drawTrackCanvas(selectedTrack, effectiveCondition, []));
  }, [selectedTrack, effectiveCondition, drawTrackCanvas, resizeCanvas]);

  // ── RESIZE ──
  useEffect(() => {
    const onResize = () => {
      resizeCanvas();
      if (uiPhase === "setup") drawTrackCanvas(selectedTrack, effectiveCondition, []);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resize: stable deps intended
  }, [resizeCanvas, drawTrackCanvas, selectedTrack, effectiveCondition, uiPhase]);

  // ── INITIAL DRAW ──
  useEffect(() => {
    if (mode !== "live") return;
    resizeCanvas();
    drawTrackCanvas(selectedTrack, effectiveCondition, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial draw once on mount (live mode)
  }, []);

  // Redraw preview on track/condition change (setup phase only)
  useEffect(() => {
    if (uiPhase !== "setup") return;
    resizeCanvas();
    drawTrackCanvas(selectedTrack, effectiveCondition, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setup preview: selectedTrack, effectiveCondition, uiPhase are the triggers
  }, [selectedTrack, effectiveCondition, uiPhase]);

  // ── CLEANUP ──
  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const isLive = mode === "live";

  return (
    <div style={{ fontFamily:"'Rajdhani',sans-serif", color:"var(--noir-foreground)" }}>

      {/* ── LIVE MODE: Track picker ── */}
      {isLive && uiPhase === "setup" && (
        <div className={styles.panel} style={{ padding:"0.75rem", marginBottom:"0.75rem" }}>
          <div className="font-heading text-xs mb-2" style={{ color:"var(--noir-primary)", letterSpacing:".2em", textTransform:"uppercase" }}>
            Select Track
          </div>
          <div style={{ display:"grid", gridTemplateColumns: isNarrow ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:"0.4rem" }}>
            {TRACKS.map(t => (
              <button
                key={t.id} type="button"
                onClick={()=>setSelectedTrack(t)}
                style={{
                  background: selectedTrack.id===t.id ? "rgba(201,164,96,.1)" : "transparent",
                  border: `1px solid ${selectedTrack.id===t.id ? "var(--noir-primary)" : "var(--noir-border)"}`,
                  padding:"0.5rem 0.4rem", minHeight:44, cursor:"pointer", textAlign:"left",
                  transition:".15s", touchAction:"manipulation",
                }}
              >
                <TrackThumb track={t} active={selectedTrack.id===t.id}/>
                <div className="font-heading" style={{ color:"var(--noir-primary)", fontSize:"8px", letterSpacing:".15em", textTransform:"uppercase", marginTop:"3px", lineHeight:1.2 }}>{t.name}</div>
                <div style={{ fontSize:"9px", color:"var(--noir-muted)", marginTop:"2px" }}>{t.km}km · {t.corners}T</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── LIVE MODE: Conditions (auto) + Tyres ── */}
      {isLive && uiPhase === "setup" && (
        <div style={{ display:"flex", gap:"0.6rem", flexWrap:"wrap", marginBottom:"0.75rem", alignItems:"flex-start" }}>
          {/* Weather (auto) — read-only, same style as Create race */}
          <div className={styles.panel} style={{ padding:"0.6rem", flex:"0 0 auto" }}>
            <div className="font-heading" style={{ fontSize:"8px", letterSpacing:".22em", textTransform:"uppercase", color:"var(--noir-muted)", marginBottom:"4px" }}>Weather (auto)</div>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
              <span className="font-heading" style={{ fontSize:"12px", color:"var(--noir-primary)" }}>
                {wDef.icon} {weatherNameProp || wDef.label}
              </span>
            </div>
            <p style={{ fontSize:"10px", color:"var(--noir-muted)", marginTop:"5px", marginBottom:"0", maxWidth:260 }}>
              Weather affects car speed and tyre wear. Pick tyres suited to conditions.
            </p>
            {wDef.tyreRec && (
              <div style={{ fontSize:"10px", color:"var(--noir-muted)", marginTop:"4px", fontStyle:"italic" }}>
                Rec: {wDef.tyreRec.map(t=>TYRE_DEFS[t]?.label).join(", ")}
              </div>
            )}
          </div>

          {/* Tyres */}
          <div className={styles.panel} style={{ padding:"0.6rem", flex:"1 1 200px" }}>
            <div className="font-heading" style={{ fontSize:"8px", letterSpacing:".22em", textTransform:"uppercase", color:"var(--noir-muted)", marginBottom:"4px" }}>Your Starting Tyre</div>
            <div style={{ display:"flex", gap:"4px", flexWrap:"wrap" }}>
              {Object.values(TYRE_DEFS).map(td=>(
                <button key={td.id} type="button" onClick={()=>setChosenTyre(td.id)}
                  style={{
                    display:"flex", alignItems:"center", gap:"5px",
                    padding:"8px 10px", minHeight:44, border:`1px solid ${chosenTyre===td.id?"var(--noir-primary)":"var(--noir-border)"}`,
                    background:chosenTyre===td.id?"rgba(201,164,96,.1)":"transparent",
                    cursor:"pointer", fontSize:"12px", fontWeight:600,
                    color:chosenTyre===td.id?"var(--noir-foreground)":"var(--noir-muted)",
                    touchAction:"manipulation",
                  }}
                >
                  <span style={{ width:9,height:9,borderRadius:"50%",background:td.color,display:"inline-block",flexShrink:0 }}/>
                  {td.label}
                </button>
              ))}
            </div>
            {chosenTyre && (
              <div style={{ fontSize:"11px", color:"var(--noir-muted)", marginTop:"5px", fontStyle:"italic" }}>
                {TYRE_DEFS[chosenTyre]?.desc}
              </div>
            )}
          </div>

          {/* Laps */}
          <div className={styles.panel} style={{ padding:"0.6rem", flex:"0 0 auto" }}>
            <div className="font-heading" style={{ fontSize:"8px", letterSpacing:".22em", textTransform:"uppercase", color:"var(--noir-muted)", marginBottom:"4px" }}>Laps</div>
            <input type="number" min={2} max={20} value={numLaps}
              onChange={e=>setNumLaps(Math.max(2,Math.min(5,parseInt(e.target.value)||3)))}
              style={{ width:56, minHeight:44, background:"transparent", border:"1px solid var(--noir-border)", color:"var(--noir-foreground)", fontFamily:"'Rajdhani',sans-serif", fontSize:14, padding:"6px 8px", textAlign:"center", touchAction:"manipulation" }}
            />
          </div>
        </div>
      )}

      {/* ── RACE CANVAS ── */}
      <div style={{ position:"relative", background:"#0d1208", border:"1px solid var(--noir-border)", marginBottom:"0.6rem", overflow:"hidden", touchAction:"manipulation", maxWidth:"100%" }}>
        <canvas ref={canvasRef} style={{ width:"100%", display:"block" }}/>

        {/* HUD: top bar */}
        <div style={{ position:"absolute", top:0, left:0, right:0, display:"flex", alignItems:"flex-start", justifyContent:"space-between", padding:"6px 8px", background:"linear-gradient(to bottom,rgba(0,0,0,.75),transparent)", pointerEvents:"none" }}>
          <div style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(9px,2vw,11px)", letterSpacing:".18em", color:"var(--noir-primary)", background:"rgba(0,0,0,.6)", border:"1px solid rgba(201,164,96,.2)", padding:"2px 7px" }}>
            Lap {lapDisplay}
          </div>
          <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(8px,1.8vw,10px)", letterSpacing:".14em", color:"var(--noir-foreground)", background:"rgba(0,0,0,.6)", border:"1px solid rgba(201,164,96,.15)", padding:"2px 7px" }}>
              {wDef.icon} {wDef.label}
            </span>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(8px,1.8vw,10px)", letterSpacing:".12em", color:"var(--noir-primary)", background:"rgba(0,0,0,.6)", border:"1px solid rgba(201,164,96,.15)", padding:"2px 7px" }}>
              {selectedTrack.name}
            </span>
          </div>
        </div>

        {/* HUD: bottom commentary */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"linear-gradient(to top,rgba(0,0,0,.82),transparent)", padding:"6px 8px", pointerEvents:"none" }}>
          <div style={{ fontFamily:"'Crimson Text',serif", fontStyle:"italic", fontSize:"clamp(11px,2.5vw,14px)", color:"var(--noir-primary)", textShadow:"0 0 14px rgba(201,164,96,.5)" }}>
            {commentary}
          </div>
        </div>

        {/* Countdown */}
        {uiPhase === "countdown" && (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,.7)", pointerEvents:"none" }}>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(40px,12vw,80px)", fontWeight:900, color:countdown>1?"var(--noir-primary)":"#dc2626", textShadow:`0 0 40px ${countdown>1?"rgba(201,164,96,.6)":"rgba(220,38,38,.8)"}`, lineHeight:1 }}>
              {countdown === 0 ? "GO!" : countdown}
            </div>
          </div>
        )}

        {/* Pit notif */}
        {pitNotif && (
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", background:"rgba(0,0,0,.88)", border:"1px solid var(--noir-primary)", padding:"6px 14px", fontFamily:"'Cinzel',serif", fontSize:"clamp(9px,2.5vw,12px)", letterSpacing:".18em", color:"var(--noir-primary)", whiteSpace:"nowrap", pointerEvents:"none" }}>
            {pitNotif}
          </div>
        )}
      </div>

      {/* ── LEADERBOARD (live race standings) ── */}
      {standings.length > 0 && (
        <div className={styles.panel} style={{ marginBottom:"0.6rem", overflowX:"auto", overflowY:"hidden", WebkitOverflowScrolling:"touch" }}>
          <div style={{ padding:"6px 8px 4px", borderBottom:"1px solid rgba(201,164,96,.2)", fontFamily:"'Cinzel',serif", fontSize:11, fontWeight:700, letterSpacing:".12em", textTransform:"uppercase", color:"var(--noir-primary)" }}>
            Leaderboard
          </div>
          {/* Column headers */}
          <div style={{
            display:"flex", alignItems:"center", padding:"6px 8px",
            borderBottom:"1px solid rgba(201,164,96,.12)",
            gap:"6px",
            fontSize:10, fontFamily:"'Cinzel',serif", fontWeight:600, letterSpacing:".08em", textTransform:"uppercase", color:"var(--noir-muted)",
          }}>
            <div style={{ width:20, flexShrink:0 }} />
            <div style={{ width:9, flexShrink:0 }} />
            <div style={{ flex:1 }}>Driver</div>
            <div style={{ width:80, flexShrink:0 }}>Car</div>
            <div style={{ display:"flex", alignItems:"center", gap:4, width:55, flexShrink:0 }}>
              Tyre <span style={{ fontSize:9, fontWeight:400, textTransform:"none", letterSpacing:0, opacity:0.85 }}>(compound – wear)</span>
            </div>
            <div style={{ width:54, textAlign:"right", flexShrink:0 }}>Gap</div>
          </div>
          {[...standings]
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map((r, i) => {
            const td = TYRE_DEFS[r.currentTyre] || TYRE_DEFS.medium;
            const wc = tyreColor(r.tyreWear);
            const lapsDown = r.lapsDown != null ? r.lapsDown : (r.gap != null ? Math.floor(r.gap) : 0);
            const fracLap = r.gap != null ? r.gap - Math.floor(r.gap) : 0;
            let gapStr = "Leader";
            if (r.inPit) {
              gapStr = r.pitTimeRemaining != null && r.pitTimeRemaining > 0
                ? `PIT — ${r.pitTimeRemaining.toFixed(1)}s`
                : "PIT";
            } else if (r.position > 1) {
              if (lapsDown >= 1) {
                gapStr = lapsDown === 1 ? "1 lap down" : `${lapsDown} laps down`;
                if (fracLap > 0.001) gapStr += ` +${(fracLap * selectedTrack.lapBase).toFixed(2)}s`;
              } else {
                gapStr = `+${((r.gap || 0) * selectedTrack.lapBase).toFixed(2)}s`;
              }
            }
            const pos = r.position != null ? r.position : i + 1;
            return (
              <div key={r.id}
                style={{
                  display:"flex", alignItems:"center", padding:"5px 8px",
                  borderBottom:"1px solid rgba(201,164,96,.06)",
                  background: r.isPlayer ? "rgba(201,164,96,.06)" : pos===1 ? "rgba(201,164,96,.03)" : "transparent",
                  gap:"6px",
                }}
              >
                {/* Pos badge — actual race position */}
                <div style={{
                  width:20, height:20, display:"flex", alignItems:"center", justifyContent:"center",
                  fontFamily:"'Cinzel',serif", fontSize:10, fontWeight:700, flexShrink:0,
                  background: pos===1?"linear-gradient(135deg,#a87820,#e8c870)":pos===2?"rgba(160,160,160,.2)":pos===3?"rgba(140,80,20,.2)":"rgba(201,164,96,.06)",
                  color: pos===1?"#0a0c06":pos===2?"#bbb":pos===3?"#c07a30":"var(--noir-muted)",
                  border: pos>0?"1px solid rgba(201,164,96,.15)":"none",
                }}>{pos}</div>

                {/* Car color dot */}
                <div style={{ width:9,height:9,borderRadius:"50%",background:r.color,flexShrink:0,boxShadow:`0 0 5px ${r.color}80` }}/>

                {/* Name */}
                <div style={{ flex:1, fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {r.name}
                  {r.isPlayer && <span style={{ color:"var(--noir-primary)", fontSize:10, marginLeft:4 }}>(You)</span>}
                </div>

                {/* Car name */}
                <div style={{ fontSize:11, color:"var(--noir-muted)", width:80, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flexShrink:0 }}>{r.carName}</div>

                {/* Tyre + wear — dot = compound (soft/med/hard), bar = wear (green→yellow→red) */}
                <div
                  title="Dot = compound (soft/medium/hard). Bar = tyre wear: green = good, yellow = worn, red = critical."
                  style={{ display:"flex", alignItems:"center", gap:4, width:55, flexShrink:0 }}
                >
                  <div style={{ width:8,height:8,borderRadius:"50%",background:td.color,flexShrink:0 }}/>
                  <div style={{ flex:1, height:3, background:"rgba(201,164,96,.1)", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${r.tyreWear}%`, background:wc, borderRadius:2, transition:"width .5s" }}/>
                  </div>
                </div>

                {/* Gap / Pit */}
                <div style={{
                  fontFamily:"'Rajdhani',sans-serif", fontSize:11, width:54, textAlign:"right", flexShrink:0,
                  color: r.inPit ? "#ff9800" : pos===1 ? "var(--noir-primary)" : "var(--noir-muted)",
                  fontWeight: r.inPit || pos===1 ? 700 : 400,
                }}>
                  {gapStr}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── LIVE MODE: Controls ── */}
      {isLive && (
        <div style={{ display:"flex", gap:"0.5rem", alignItems:"center", flexWrap:"wrap", marginBottom:"0.6rem" }}>
          {uiPhase === "setup" && (
            <button type="button" onClick={handleStart}
              style={{ fontFamily:"'Cinzel',serif", fontSize:"9px", fontWeight:700, letterSpacing:".2em", textTransform:"uppercase", padding:"10px 18px", minHeight:44, border:"1px solid var(--noir-primary)", background:"linear-gradient(135deg,#6a4010,#c9a460)", color:"#0a0c06", cursor:"pointer", touchAction:"manipulation" }}>
              Start Race
            </button>
          )}
          {(uiPhase === "racing" || uiPhase === "done") && (
            <button type="button" onClick={handleReset}
              style={{ fontFamily:"'Cinzel',serif", fontSize:"9px", letterSpacing:".2em", textTransform:"uppercase", padding:"10px 16px", minHeight:44, border:"1px solid var(--noir-border)", background:"rgba(201,164,96,.07)", color:"var(--noir-primary)", cursor:"pointer", touchAction:"manipulation" }}>
              Reset
            </button>
          )}
        </div>
      )}

      {/* ── POST-RACE RESULTS ── */}
      {results && (
        <div className={styles.panel} style={{ padding:"0.75rem" }}>
          <div className="font-heading" style={{ fontSize:"11px", letterSpacing:".25em", textTransform:"uppercase", color:"var(--noir-primary)", marginBottom:"0.5rem" }}>
            Race Results
          </div>
          {results.map((r,i)=>{
            const purses = [0.40,0.25,0.15,0.10,0.05,0.03,0.02,0.00];
            const pool = 5000 * 8 * 0.9;
            const purse = Math.round(pool * (purses[i]||0));
            const best = r.bestLap ? `Best: ${r.bestLap.toFixed(2)}s` : "";
            return (
              <div key={r.id}
                style={{
                  display:"flex", alignItems:"center", gap:"6px", padding:"6px 8px",
                  borderBottom:"1px solid rgba(201,164,96,.06)",
                  background: r.isPlayer ? "rgba(201,164,96,.07)" : "transparent",
                  animation: r.isPlayer && i===0 ? "winPulse 1s 3" : "none",
                }}>
                <div style={{ width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif",fontSize:11,fontWeight:700,
                  background:i===0?"linear-gradient(135deg,#a87820,#e8c870)":i===1?"rgba(160,160,160,.2)":i===2?"rgba(140,80,20,.2)":"rgba(201,164,96,.06)",
                  color:i===0?"#0a0c06":i===1?"#bbb":i===2?"#c07a30":"var(--noir-muted)",
                  border:i>0?"1px solid rgba(201,164,96,.15)":"none",
                }}>{i+1}</div>
                <div style={{ width:9,height:9,borderRadius:"50%",background:r.color,flexShrink:0 }}/>
                <div style={{ flex:1, fontSize:13, fontWeight:600 }}>{r.name}{r.isPlayer&&<span style={{color:"var(--noir-primary)",fontSize:10,marginLeft:4}}>(You)</span>}</div>
                <div style={{ fontSize:11, color:"var(--noir-muted)" }}>{r.carName}</div>
                <div style={{ fontSize:10, color:"var(--noir-muted)" }}>{r.pitStops} pit{r.pitStops!==1?"s":""}</div>
                <div style={{ fontSize:10, color:"var(--noir-muted)" }}>{best}</div>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:11, color:"var(--noir-primary)", background:"rgba(201,164,96,.08)", border:"1px solid var(--noir-border)", padding:"1px 7px" }}>
                  ${purse.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes winPulse {
          0%,100%{border-color:var(--noir-border)}
          50%{border-color:var(--noir-primary);box-shadow:0 0 18px rgba(201,164,96,.3)}
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACK THUMBNAIL (mini canvas rendered once)
// ─────────────────────────────────────────────────────────────────────────────
function TrackThumb({ track, active }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0d1208"; ctx.fillRect(0,0,120,44);
    ctx.beginPath();
    for (let i=0;i<=200;i++) {
      const p = track.getPoint(i/200);
      const x = (p.x/800)*110+5, y=(p.y/360)*34+5;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath();
    ctx.strokeStyle = active ? "#e8c870" : "#c9a460";
    ctx.lineWidth = active ? 2.5 : 2;
    ctx.lineJoin="round"; ctx.stroke();
    ctx.strokeStyle = active ? "rgba(232,200,112,0.3)" : "rgba(201,164,96,0.2)";
    ctx.lineWidth=6; ctx.stroke();
  }, [track, active]);
  return <canvas ref={ref} width={120} height={44} style={{ width:"100%", height:40, display:"block" }}/>;
}
