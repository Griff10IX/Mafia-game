import { useEffect, useRef, useState, useCallback } from "react";
import styles from "../../styles/noir.module.css";

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const CAR_COLORS = [
  "#d4af37","#dc2626","#3b82f6","#16a34a",
  "#9333ea","#f97316","#ec4899","#14b8a6",
];

// F1 Clash–style tyre compounds: cliff degradation model
// Grip stays flat, then drops sharply once past the cliff threshold
const TYRE_DEFS = {
  soft:     { id:"soft",     label:"Soft",     color:"#e82020", cliffStart:0.52, cliffRate:3.2, gripMult:1.08, minWear:5, lapsBase:2,   desc:"Fastest. Hard cliff at ~50% wear" },
  medium:   { id:"medium",   label:"Medium",   color:"#e8d020", cliffStart:0.66, cliffRate:2.4, gripMult:1.02, minWear:5, lapsBase:3,   desc:"Balanced all-rounder" },
  hard:     { id:"hard",     label:"Hard",     color:"#c0c0b8", cliffStart:0.80, cliffRate:1.6, gripMult:0.96, minWear:5, lapsBase:4,   desc:"Durable. Cliff at ~80%" },
  inter:    { id:"inter",    label:"Inter",    color:"#20a840", cliffStart:0.62, cliffRate:2.0, gripMult:1.04, minWear:5, lapsBase:2.5, desc:"Damp / light rain" },
  full_wet: { id:"full_wet", label:"Full Wet", color:"#2080e8", cliffStart:0.70, cliffRate:1.8, gripMult:1.08, minWear:5, lapsBase:3,   desc:"Heavy rain / snow" },
  wet:      { id:"full_wet", label:"Full Wet", color:"#2080e8", cliffStart:0.70, cliffRate:1.8, gripMult:1.08, minWear:5, lapsBase:3,   desc:"Heavy rain / snow" },
};

const WEATHER_DEFS = {
  clear:    { label:"Clear",    icon:"☀️",  bg1:"#0d1a07", bg2:"#091204", speedMult:1.00, wearMult:1.00, gripMult:1.00, tyreRec:["soft","medium","hard"] },
  night:    { label:"Night",    icon:"🌙",  bg1:"#050810", bg2:"#080c14", speedMult:0.97, wearMult:1.05, gripMult:0.98, tyreRec:["medium","hard"] },
  rain:     { label:"Rain",     icon:"🌧️", bg1:"#0a1020", bg2:"#060c18", speedMult:0.90, wearMult:1.55, gripMult:0.88, tyreRec:["inter","full_wet"] },
  snow:     { label:"Snow",     icon:"❄️",  bg1:"#1a1e2e", bg2:"#0d1020", speedMult:0.78, wearMult:2.10, gripMult:0.78, tyreRec:["inter","full_wet"], fog:0.18 },
  very_hot: { label:"Very Hot", icon:"🔥", bg1:"#1e0e04", bg2:"#120a02", speedMult:0.95, wearMult:1.45, gripMult:0.95, tyreRec:["medium","hard"] },
};

const WEATHER_MAP = { clear:"clear",rain:"rain",snow:"snow",very_hot:"very_hot",night:"night" };

const CAR_SCALE = 0.90;

const NPC_NAMES  = ["Smokey Joe","Ace Johnson","The Phantom","Lucky Lou","Fast Eddie","Duke Malone","Slick Sam","Rusty Wheeler"];
const NPC_CARS   = ["Ford Model T Racer","Packard 734","Stutz Bearcat","Miller 91","Duesenberg Model J"];
const NPC_STATS  = [
  {bs:0.90,bg:0.87},{bs:0.93,bg:0.85},{bs:0.96,bg:0.84},{bs:0.99,bg:0.85},
  {bs:1.02,bg:0.83},{bs:1.05,bg:0.84},{bs:1.08,bg:0.82},{bs:0.95,bg:0.86},
];
const NPC_TYRES  = ["soft","medium","medium","hard","medium","hard","soft","medium"];

const COMMENTARY = {
  start: ["They're off!","Bootleg run underway!","Green flag — go!","Engines roar across the grid!"],
  mid:   ["Close battle through the chicane!","Tyre wear is a real factor now!","The gap is tightening!","Pit window opening up...","Flat out on the back straight!","Wheel to wheel into Turn 3!","Slipstream down the long straight!","Fuel load dropping — cars quickening!","Yellow and black of the pit board!"],
  final: ["White flag — final lap!","Everything on the line!","Push to the absolute limit!"],
  done:  ["Checkered flag!","What a race!","That's the finish!","The crowd goes wild!"],
  safetyCar:    ["Safety car deployed!","Yellow flags — hold positions!","Caution period — safety car out!"],
  safetyCarEnd: ["Safety car in — green flag!","Racing resumes — go go go!","The pack bunches — big restart!"],
  weatherChange:["Conditions changing out there!","Rain incoming — tyres under threat!","Track drying — strategies shifting!"],
  fastest:       ["Purple sector — fastest lap!","New fastest lap on the board!"],
};

// ─── TYRE PHYSICS ──────────────────────────────────────────────────────────

function tyreGripFromWear(wear, tyreId) {
  const td = TYRE_DEFS[tyreId] || TYRE_DEFS.medium;
  const w  = wear / 100;
  if (w >= td.cliffStart) return 1.0;
  const below = (td.cliffStart - w) / td.cliffStart;
  return Math.max(0.28, 1.0 - below * td.cliffRate * 0.35);
}

function tyreColor(wear) {
  if (wear > 65) return "#27ae60";
  if (wear > 35) return "#f39c12";
  return "#e74c3c";
}

function pitDur(pitLevel, emergency = false) {
  const base = emergency ? 4.2 : 3.2, minT = emergency ? 1.5 : 1.2;
  return Math.max(minT, base - (Math.max(0, Math.min(100, pitLevel || 0)) / 10) * 0.15);
}

function stintLaps(tyreId, wearMult, relMult) {
  const td = TYRE_DEFS[tyreId] || TYRE_DEFS.medium;
  return Math.max(2, Math.min(5, Math.round(td.lapsBase / ((wearMult || 1) * (relMult || 1)))));
}

function buildStrategy(tyreId, nLaps, wearMult = 1, relMult = 1, offset = 0, strat = "normal", nextTyreOv = null) {
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

// FIX B3: pass full entrant to get correct compound cycling
function buildReplayStrategy(id, pitStopsList, entrant) {
  const stops = (pitStopsList || []).filter(ps => ps.entrant_id === id);
  if (!stops.length) return [];
  const base = ((entrant?.tyre_compound || "medium").toLowerCase());
  const next = base === "soft" ? "medium" : base === "medium" ? "hard" : "medium";
  return stops.map((ps, i) => ({ lap: ps.lap, nextTyre: i % 2 === 0 ? next : base }));
}

function rollStrat() {
  const r = Math.random();
  return r < 0.20 ? "undercut" : r < 0.35 ? "overcut" : "normal";
}

const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

// ─── PATH HELPERS ──────────────────────────────────────────────────────────

// Catmull-Rom spline through waypoints (smooth, no speed artifacts at joints)
function catmull(pts, T) {
  const t = ((T % 1) + 1) % 1, n = pts.length;
  if (n < 2) return pts[0].p;
  const wrap = i => ((i % n) + n) % n;
  for (let seg = 0; seg < n; seg++) {
    const nx = wrap(seg + 1), f0 = pts[seg].f, f1 = pts[nx].f;
    const isW = f1 <= f0;
    if (!(isW ? (t >= f0 || t <= f1) : (t >= f0 && t <= f1))) continue;
    const sl = isW ? (1 - f0) + f1 : f1 - f0;
    let u = isW ? (t >= f0 ? (t - f0) / sl : (t + 1 - f0) / sl) : (t - f0) / sl;
    u = Math.max(0, Math.min(1, u));
    const u2 = u * u, u3 = u2 * u;
    const p0 = pts[wrap(seg - 1)].p, p1 = pts[seg].p, p2 = pts[nx].p, p3 = pts[wrap(seg + 2)].p;
    return {
      x: 0.5 * (2*p1.x + (-p0.x+p2.x)*u + (2*p0.x-5*p1.x+4*p2.x-p3.x)*u2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*u3),
      y: 0.5 * (2*p1.y + (-p0.y+p2.y)*u + (2*p0.y-5*p1.y+4*p2.y-p3.y)*u2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*u3),
    };
  }
  return pts[0].p;
}

// Rectangle oval with rounded corners — used for pure ovals
function ovalPt(T, x1, y1, x2, y2, r) {
  const t = ((T % 1) + 1) % 1, W = x2 - x1, H = y2 - y1;
  const p = 2*(W-2*r) + 2*(H-2*r) + 2*Math.PI*r;
  const fS = (W-2*r)/p, fC = (Math.PI*r/2)/p, fL = (H-2*r)/p;
  const segs = [
    { f:fS, fn:u => ({ x:x1+r+u*(W-2*r), y:y1 }) },
    { f:fC, fn:u => { const a=-Math.PI/2+u*Math.PI/2; return{x:x2-r+Math.cos(a)*r,y:y1+r+Math.sin(a)*r}; } },
    { f:fL, fn:u => ({ x:x2, y:y1+r+u*(H-2*r) }) },
    { f:fC, fn:u => { const a=u*Math.PI/2; return{x:x2-r+Math.cos(a)*r,y:y2-r+Math.sin(a)*r}; } },
    { f:fS, fn:u => ({ x:x2-r-u*(W-2*r), y:y2 }) },
    { f:fC, fn:u => { const a=Math.PI/2+u*Math.PI/2; return{x:x1+r+Math.cos(a)*r,y:y2-r+Math.sin(a)*r}; } },
    { f:fL, fn:u => ({ x:x1, y:y2-r-u*(H-2*r) }) },
    { f:fC, fn:u => { const a=Math.PI+u*Math.PI/2; return{x:x1+r+Math.cos(a)*r,y:y1+r+Math.sin(a)*r}; } },
  ];
  let acc = 0;
  for (const s of segs) { if (t < acc + s.f) return s.fn((t - acc) / s.f); acc += s.f; }
  return { x:x1+r, y:y1 };
}

// ─── TRACK POINT DATA ──────────────────────────────────────────────────────
// Each track has a completely distinct shape, inspired by real historical circuits.
// Coords are in 800×360 canvas space. Dense waypoints for smooth curves.

// Chicago Board Track — tight wooden banked D-oval
const CHICAGO_PTS = [
  {f:0.000,p:{x:275,y:72}},{f:0.040,p:{x:365,y:64}},{f:0.082,p:{x:468,y:60}},
  {f:0.125,p:{x:568,y:61}},{f:0.165,p:{x:640,y:70}},{f:0.196,p:{x:682,y:90}},
  {f:0.222,p:{x:706,y:120}},{f:0.244,p:{x:714,y:155}},{f:0.263,p:{x:710,y:192}},
  {f:0.282,p:{x:696,y:224}},{f:0.304,p:{x:668,y:252}},{f:0.332,p:{x:626,y:270}},
  {f:0.370,p:{x:562,y:283}},{f:0.418,p:{x:474,y:291}},{f:0.472,p:{x:385,y:293}},
  {f:0.524,p:{x:298,y:291}},{f:0.566,p:{x:230,y:281}},{f:0.596,p:{x:176,y:264}},
  {f:0.622,p:{x:136,y:240}},{f:0.644,p:{x:110,y:210}},{f:0.660,p:{x:96,y:177}},
  {f:0.674,p:{x:94,y:142}},{f:0.690,p:{x:104,y:110}},{f:0.716,p:{x:132,y:86}},
  {f:0.754,p:{x:175,y:73}},{f:0.806,p:{x:224,y:68}},{f:0.876,p:{x:260,y:68}},
  {f:1.000,p:{x:275,y:72}},
];

// Daytona Beach — large fast oval with famous trioval kink on the front stretch
const DAYTONA_PTS = [
  {f:0.000,p:{x:282,y:76}},{f:0.028,p:{x:348,y:68}},{f:0.060,p:{x:430,y:63}},
  {f:0.095,p:{x:516,y:60}},{f:0.130,p:{x:590,y:61}},{f:0.162,p:{x:645,y:68}},
  {f:0.188,p:{x:685,y:86}},{f:0.212,p:{x:715,y:114}},{f:0.234,p:{x:728,y:150}},
  {f:0.255,p:{x:730,y:190}},{f:0.274,p:{x:720,y:228}},{f:0.294,p:{x:697,y:260}},
  {f:0.320,p:{x:659,y:284}},{f:0.356,p:{x:604,y:300}},{f:0.402,p:{x:526,y:312}},
  {f:0.452,p:{x:438,y:318}},
  // trioval kink
  {f:0.476,p:{x:390,y:305}},{f:0.492,p:{x:364,y:290}},{f:0.508,p:{x:356,y:308}},
  {f:0.526,p:{x:323,y:320}},
  {f:0.560,p:{x:258,y:316}},{f:0.594,p:{x:190,y:298}},{f:0.624,p:{x:142,y:274}},
  {f:0.649,p:{x:104,y:244}},{f:0.671,p:{x:82,y:205}},{f:0.690,p:{x:72,y:165}},
  {f:0.707,p:{x:76,y:126}},{f:0.728,p:{x:96,y:95}},{f:0.758,p:{x:132,y:76}},
  {f:0.796,p:{x:178,y:69}},{f:0.845,p:{x:232,y:70}},{f:0.894,p:{x:264,y:72}},
  {f:1.000,p:{x:282,y:76}},
];

// Roosevelt Raceway — New York's twisty parkland road course, 1930s
const ROOSEVELT_PTS = [
  {f:0.000,p:{x:395,y:76}},{f:0.024,p:{x:448,y:72}},{f:0.050,p:{x:508,y:70}},
  {f:0.074,p:{x:562,y:72}},{f:0.096,p:{x:604,y:82}},{f:0.116,p:{x:636,y:100}},
  {f:0.134,p:{x:655,y:126}},{f:0.150,p:{x:660,y:156}},{f:0.164,p:{x:650,y:184}},
  {f:0.178,p:{x:628,y:204}},{f:0.194,p:{x:599,y:216}},{f:0.212,p:{x:565,y:226}},
  // chicane 1
  {f:0.228,p:{x:542,y:238}},{f:0.242,p:{x:527,y:254}},{f:0.256,p:{x:510,y:244}},
  {f:0.272,p:{x:492,y:230}},{f:0.290,p:{x:478,y:212}},{f:0.308,p:{x:482,y:185}},
  {f:0.326,p:{x:502,y:162}},{f:0.344,p:{x:522,y:142}},{f:0.360,p:{x:530,y:118}},
  // hairpin top
  {f:0.376,p:{x:516,y:98}},{f:0.393,p:{x:490,y:88}},{f:0.412,p:{x:460,y:84}},
  {f:0.432,p:{x:428,y:88}},{f:0.450,p:{x:402,y:102}},{f:0.468,p:{x:374,y:118}},
  {f:0.486,p:{x:344,y:134}},{f:0.504,p:{x:310,y:146}},{f:0.524,p:{x:272,y:150}},
  {f:0.546,p:{x:233,y:140}},{f:0.567,p:{x:198,y:120}},{f:0.586,p:{x:175,y:96}},
  // bottom hairpin
  {f:0.602,p:{x:170,y:72}},{f:0.618,p:{x:184,y:56}},{f:0.638,p:{x:210,y:52}},
  {f:0.664,p:{x:248,y:55}},{f:0.700,p:{x:292,y:58}},{f:0.740,p:{x:335,y:62}},
  {f:0.784,p:{x:368,y:66}},{f:0.840,p:{x:388,y:71}},
  {f:1.000,p:{x:395,y:76}},
];

// Indianapolis Motor Speedway — classic rectangle superspeedway
const GP_INDIANAPOLIS = t => ovalPt(t, 130, 74, 670, 288, 55);

// Boardwalk — tight 1920s street circuit with double chicane
const BOARDWALK_PTS = [
  {f:0.000,p:{x:398,y:70}},{f:0.022,p:{x:454,y:65}},{f:0.046,p:{x:518,y:62}},
  {f:0.070,p:{x:580,y:62}},{f:0.092,p:{x:630,y:70}},{f:0.112,p:{x:668,y:88}},
  {f:0.130,p:{x:694,y:114}},{f:0.146,p:{x:706,y:144}},{f:0.160,p:{x:700,y:170}},
  {f:0.174,p:{x:680,y:182}},
  // chicane 1
  {f:0.188,p:{x:657,y:174}},{f:0.200,p:{x:645,y:158}},{f:0.212,p:{x:647,y:174}},
  {f:0.225,p:{x:661,y:192}},{f:0.240,p:{x:690,y:208}},{f:0.257,p:{x:716,y:230}},
  {f:0.272,p:{x:724,y:256}},{f:0.286,p:{x:712,y:280}},{f:0.304,p:{x:682,y:296}},
  {f:0.332,p:{x:636,y:308}},{f:0.372,p:{x:562,y:316}},{f:0.416,p:{x:476,y:318}},
  {f:0.458,p:{x:392,y:316}},{f:0.496,p:{x:312,y:312}},{f:0.530,p:{x:244,y:302}},
  {f:0.558,p:{x:188,y:286}},{f:0.580,p:{x:146,y:264}},{f:0.598,p:{x:116,y:238}},
  // chicane 2
  {f:0.614,p:{x:106,y:212}},{f:0.628,p:{x:124,y:198}},{f:0.640,p:{x:150,y:208}},
  {f:0.652,p:{x:152,y:228}},{f:0.662,p:{x:130,y:246}},
  {f:0.678,p:{x:100,y:210}},{f:0.692,p:{x:82,y:178}},{f:0.706,p:{x:72,y:142}},
  {f:0.720,p:{x:74,y:108}},{f:0.738,p:{x:90,y:80}},{f:0.762,p:{x:116,y:62}},
  {f:0.798,p:{x:160,y:57}},{f:0.848,p:{x:222,y:58}},{f:0.900,p:{x:292,y:61}},
  {f:0.950,p:{x:354,y:65}},{f:1.000,p:{x:398,y:70}},
];

// Lakeside Park — flowing sweeper circuit around a central lake
const LAKESIDE_PTS = [
  {f:0.000,p:{x:398,y:64}},{f:0.028,p:{x:460,y:60}},{f:0.058,p:{x:528,y:57}},
  {f:0.090,p:{x:592,y:59}},{f:0.118,p:{x:641,y:68}},{f:0.143,p:{x:678,y:84}},
  {f:0.168,p:{x:704,y:108}},{f:0.192,p:{x:718,y:140}},{f:0.214,p:{x:722,y:176}},
  {f:0.234,p:{x:714,y:210}},{f:0.253,p:{x:695,y:240}},{f:0.273,p:{x:664,y:265}},
  {f:0.296,p:{x:623,y:283}},{f:0.324,p:{x:572,y:297}},{f:0.358,p:{x:514,y:306}},
  {f:0.398,p:{x:448,y:310}},{f:0.440,p:{x:382,y:308}},{f:0.478,p:{x:322,y:297}},
  {f:0.513,p:{x:270,y:279}},{f:0.543,p:{x:232,y:256}},{f:0.568,p:{x:212,y:234}},
  // lakeside chicane
  {f:0.582,p:{x:198,y:250}},{f:0.596,p:{x:182,y:268}},{f:0.610,p:{x:165,y:260}},
  {f:0.624,p:{x:150,y:240}},
  {f:0.643,p:{x:128,y:212}},{f:0.664,p:{x:108,y:182}},{f:0.686,p:{x:94,y:149}},
  {f:0.708,p:{x:88,y:116}},{f:0.732,p:{x:96,y:86}},{f:0.758,p:{x:118,y:68}},
  {f:0.790,p:{x:155,y:60}},{f:0.832,p:{x:206,y:58}},{f:0.880,p:{x:266,y:59}},
  {f:0.930,p:{x:332,y:61}},{f:0.970,p:{x:372,y:63}},{f:1.000,p:{x:398,y:64}},
];

// Harbor Front — narrow dockside circuit, two hairpins
const HARBOR_PTS = [
  {f:0.000,p:{x:398,y:60}},{f:0.022,p:{x:452,y:56}},{f:0.046,p:{x:510,y:55}},
  {f:0.070,p:{x:558,y:57}},{f:0.092,p:{x:596,y:68}},{f:0.112,p:{x:620,y:87}},
  {f:0.130,p:{x:628,y:112}},{f:0.146,p:{x:618,y:133}},{f:0.160,p:{x:596,y:142}},
  {f:0.174,p:{x:574,y:132}},{f:0.186,p:{x:562,y:116}},
  // hairpin 1
  {f:0.198,p:{x:558,y:135}},{f:0.212,p:{x:570,y:156}},{f:0.228,p:{x:597,y:170}},
  {f:0.248,p:{x:628,y:188}},{f:0.268,p:{x:650,y:210}},{f:0.286,p:{x:654,y:236}},
  {f:0.303,p:{x:642,y:259}},{f:0.322,p:{x:614,y:276}},{f:0.348,p:{x:570,y:290}},
  {f:0.384,p:{x:504,y:300}},{f:0.428,p:{x:425,y:306}},{f:0.470,p:{x:344,y:306}},
  {f:0.508,p:{x:272,y:299}},{f:0.538,p:{x:213,y:284}},{f:0.562,p:{x:168,y:264}},
  {f:0.582,p:{x:138,y:240}},{f:0.600,p:{x:122,y:212}},{f:0.616,p:{x:120,y:183}},
  {f:0.632,p:{x:136,y:162}},{f:0.649,p:{x:165,y:154}},
  // hairpin 2
  {f:0.663,p:{x:192,y:142}},{f:0.678,p:{x:208,y:126}},{f:0.692,p:{x:200,y:110}},
  {f:0.706,p:{x:176,y:100}},{f:0.720,p:{x:152,y:88}},{f:0.736,p:{x:140,y:72}},
  {f:0.753,p:{x:148,y:57}},{f:0.774,p:{x:174,y:52}},{f:0.804,p:{x:220,y:52}},
  {f:0.844,p:{x:278,y:54}},{f:0.886,p:{x:334,y:57}},{f:0.930,p:{x:373,y:59}},
  {f:1.000,p:{x:398,y:60}},
];

// Mountain Pass — dramatic elevation changes, long switchback descent
const MOUNTAIN_PTS = [
  {f:0.000,p:{x:398,y:60}},{f:0.022,p:{x:452,y:57}},{f:0.046,p:{x:514,y:57}},
  {f:0.068,p:{x:570,y:62}},{f:0.090,p:{x:616,y:76}},{f:0.110,p:{x:653,y:98}},
  {f:0.128,p:{x:675,y:128}},{f:0.145,p:{x:683,y:162}},{f:0.161,p:{x:677,y:196}},
  {f:0.178,p:{x:656,y:224}},{f:0.197,p:{x:624,y:244}},{f:0.218,p:{x:586,y:258}},
  // switchback into descent
  {f:0.238,p:{x:558,y:273}},{f:0.256,p:{x:545,y:296}},{f:0.274,p:{x:558,y:316}},
  {f:0.294,p:{x:585,y:330}},{f:0.314,p:{x:606,y:344}},{f:0.330,p:{x:594,y:352}},
  {f:0.346,p:{x:562,y:340}},{f:0.362,p:{x:525,y:322}},{f:0.380,p:{x:483,y:308}},
  {f:0.400,p:{x:436,y:299}},{f:0.422,p:{x:390,y:304}},{f:0.444,p:{x:347,y:316}},
  {f:0.464,p:{x:303,y:318}},{f:0.484,p:{x:260,y:304}},{f:0.504,p:{x:223,y:284}},
  {f:0.524,p:{x:190,y:258}},{f:0.544,p:{x:162,y:228}},{f:0.564,p:{x:140,y:195}},
  {f:0.584,p:{x:122,y:160}},{f:0.604,p:{x:112,y:124}},{f:0.625,p:{x:112,y:92}},
  {f:0.648,p:{x:126,y:68}},{f:0.676,p:{x:155,y:55}},{f:0.710,p:{x:196,y:53}},
  {f:0.752,p:{x:248,y:53}},{f:0.798,p:{x:304,y:55}},{f:0.848,p:{x:355,y:57}},
  {f:0.908,p:{x:386,y:58}},{f:1.000,p:{x:398,y:60}},
];

// Brooklands Banking — big classic banked oval, Surrey 1907
const BROOKLANDS_PTS = [
  {f:0.000,p:{x:175,y:94}},{f:0.050,p:{x:270,y:83}},{f:0.104,p:{x:384,y:78}},
  {f:0.156,p:{x:494,y:77}},{f:0.204,p:{x:580,y:84}},{f:0.244,p:{x:644,y:102}},
  {f:0.280,p:{x:695,y:130}},{f:0.312,p:{x:726,y:167}},{f:0.340,p:{x:738,y:208}},
  {f:0.364,p:{x:735,y:250}},{f:0.386,p:{x:718,y:288}},{f:0.410,p:{x:684,y:318}},
  {f:0.440,p:{x:635,y:338}},{f:0.478,p:{x:566,y:350}},{f:0.524,p:{x:480,y:356}},
  {f:0.574,p:{x:386,y:355}},{f:0.618,p:{x:306,y:344}},{f:0.654,p:{x:244,y:328}},
  {f:0.684,p:{x:196,y:308}},{f:0.710,p:{x:158,y:280}},{f:0.733,p:{x:136,y:248}},
  {f:0.754,p:{x:124,y:214}},{f:0.773,p:{x:122,y:180}},{f:0.794,p:{x:130,y:152}},
  {f:0.820,p:{x:150,y:130}},{f:0.862,p:{x:178,y:114}},
  {f:1.000,p:{x:175,y:94}},
];

// Monza Autodromo — combined oval+road circuit, Italy 1922
const MONZA_PTS = [
  {f:0.000,p:{x:336,y:60}},{f:0.026,p:{x:402,y:54}},{f:0.054,p:{x:474,y:52}},
  {f:0.082,p:{x:546,y:52}},{f:0.108,p:{x:608,y:58}},{f:0.132,p:{x:657,y:70}},
  {f:0.155,p:{x:696,y:90}},{f:0.176,p:{x:724,y:117}},{f:0.196,p:{x:738,y:150}},
  {f:0.215,p:{x:742,y:188}},{f:0.232,p:{x:731,y:224}},{f:0.250,p:{x:706,y:254}},
  {f:0.269,p:{x:666,y:273}},{f:0.290,p:{x:615,y:281}},{f:0.313,p:{x:562,y:273}},
  // Lesmo 1+2 complex
  {f:0.334,p:{x:528,y:252}},{f:0.352,p:{x:512,y:223}},{f:0.368,p:{x:510,y:193}},
  {f:0.385,p:{x:524,y:167}},{f:0.402,p:{x:548,y:157}},{f:0.418,p:{x:566,y:171}},
  {f:0.433,p:{x:565,y:196}},{f:0.447,p:{x:545,y:215}},{f:0.462,p:{x:511,y:226}},
  {f:0.480,p:{x:465,y:236}},{f:0.502,p:{x:414,y:248}},{f:0.528,p:{x:358,y:264}},
  // chicane complex
  {f:0.556,p:{x:296,y:284}},{f:0.584,p:{x:236,y:306}},{f:0.610,p:{x:185,y:322}},
  {f:0.630,p:{x:158,y:316}},{f:0.648,p:{x:140,y:292}},{f:0.666,p:{x:123,y:262}},
  {f:0.684,p:{x:110,y:228}},{f:0.700,p:{x:103,y:193}},{f:0.715,p:{x:104,y:158}},
  {f:0.732,p:{x:116,y:124}},{f:0.752,p:{x:140,y:98}},{f:0.778,p:{x:175,y:80}},
  {f:0.810,p:{x:218,y:70}},{f:0.850,p:{x:270,y:63}},{f:0.895,p:{x:312,y:60}},
  {f:1.000,p:{x:336,y:60}},
];

// Le Mans Sarthe — ultra-long, iconic Mulsanne straight
const LEMANS_PTS = [
  {f:0.000,p:{x:126,y:112}},{f:0.020,p:{x:185,y:104}},{f:0.044,p:{x:262,y:98}},
  {f:0.070,p:{x:346,y:94}},{f:0.096,p:{x:420,y:94}},{f:0.118,p:{x:470,y:100}},
  {f:0.140,p:{x:505,y:116}},{f:0.165,p:{x:526,y:140}},
  // Ford chicanes / Mulsanne long run
  {f:0.190,p:{x:546,y:168}},{f:0.225,p:{x:578,y:205}},{f:0.268,p:{x:616,y:248}},
  {f:0.316,p:{x:656,y:292}},{f:0.358,p:{x:690,y:326}},{f:0.384,p:{x:710,y:346}},
  {f:0.402,p:{x:712,y:360}},{f:0.420,p:{x:694,y:364}},{f:0.440,p:{x:659,y:358}},
  // back section Porsche curves
  {f:0.466,p:{x:610,y:347}},{f:0.496,p:{x:552,y:334}},{f:0.526,p:{x:490,y:322}},
  {f:0.554,p:{x:432,y:308}},{f:0.578,p:{x:382,y:288}},{f:0.600,p:{x:340,y:265}},
  {f:0.622,p:{x:302,y:240}},{f:0.646,p:{x:264,y:218}},{f:0.672,p:{x:222,y:198}},
  {f:0.702,p:{x:178,y:180}},{f:0.738,p:{x:138,y:164}},{f:0.782,p:{x:112,y:152}},
  {f:0.836,p:{x:104,y:144}},{f:0.894,p:{x:107,y:132}},{f:0.950,p:{x:112,y:122}},
  {f:1.000,p:{x:126,y:112}},
];

// AVUS Speedway — two ultra-long straights, tiny hairpins, Berlin 1921
const GP_AVUS = t => ovalPt(t, 115, 118, 685, 252, 19);

// Targa Florio — narrow mountain roads, Sicily, 32 corners, est. 1906
const TARGA_PTS = [
  {f:0.000,p:{x:90,y:182}},{f:0.018,p:{x:110,y:162}},{f:0.034,p:{x:136,y:144}},
  {f:0.050,p:{x:160,y:150}},{f:0.065,p:{x:152,y:170}},
  {f:0.082,p:{x:174,y:156}},{f:0.100,p:{x:208,y:138}},{f:0.120,p:{x:250,y:120}},
  {f:0.142,p:{x:294,y:104}},{f:0.162,p:{x:336,y:90}},{f:0.180,p:{x:370,y:82}},
  {f:0.198,p:{x:400,y:87}},{f:0.214,p:{x:400,y:106}},{f:0.230,p:{x:416,y:120}},
  {f:0.248,p:{x:450,y:107}},{f:0.268,p:{x:490,y:92}},{f:0.290,p:{x:530,y:78}},
  {f:0.312,p:{x:572,y:66}},{f:0.336,p:{x:614,y:63}},{f:0.362,p:{x:654,y:70}},
  {f:0.390,p:{x:688,y:94}},{f:0.418,p:{x:712,y:130}},{f:0.444,p:{x:724,y:172}},
  {f:0.466,p:{x:720,y:215}},{f:0.486,p:{x:702,y:252}},{f:0.504,p:{x:670,y:280}},
  {f:0.522,p:{x:630,y:298}},{f:0.540,p:{x:586,y:306}},{f:0.556,p:{x:544,y:297}},
  {f:0.572,p:{x:516,y:279}},{f:0.586,p:{x:530,y:261}},{f:0.600,p:{x:516,y:247}},
  {f:0.614,p:{x:486,y:260}},{f:0.630,p:{x:448,y:274}},{f:0.648,p:{x:406,y:284}},
  {f:0.666,p:{x:360,y:290}},{f:0.684,p:{x:313,y:286}},{f:0.704,p:{x:267,y:272}},
  {f:0.726,p:{x:226,y:254}},{f:0.752,p:{x:190,y:238}},{f:0.783,p:{x:159,y:226}},
  {f:0.820,p:{x:132,y:218}},{f:0.866,p:{x:112,y:208}},{f:0.920,p:{x:100,y:198}},
  {f:1.000,p:{x:90,y:182}},
];

// ─── TRACK FUNCTIONS ───────────────────────────────────────────────────────

const GP_CHICAGO     = t => catmull(CHICAGO_PTS, t);
const GP_DAYTONA     = t => catmull(DAYTONA_PTS, t);
const GP_ROOSEVELT   = t => catmull(ROOSEVELT_PTS, t);
const GP_BOARDWALK   = t => catmull(BOARDWALK_PTS, t);
const GP_LAKESIDE    = t => catmull(LAKESIDE_PTS, t);
const GP_HARBOR      = t => catmull(HARBOR_PTS, t);
const GP_MOUNTAIN    = t => catmull(MOUNTAIN_PTS, t);
const GP_BROOKLANDS  = t => catmull(BROOKLANDS_PTS, t);
const GP_MONZA       = t => catmull(MONZA_PTS, t);
const GP_LEMANS      = t => catmull(LEMANS_PTS, t);
const GP_TARGA       = t => catmull(TARGA_PTS, t);

// ─── SCENE DRAWING HELPERS ─────────────────────────────────────────────────

function drawGrandstand(ctx, sx, sy, x, y, w, h, rows) {
  ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = "#6a6050";
  ctx.fillRect(sx(x), sy(y), sx(x+w)-sx(x), sy(y+h)-sy(y));
  ctx.globalAlpha = 0.12; ctx.strokeStyle = "#a09070"; ctx.lineWidth = 0.6;
  for (let r = 0; r < rows; r++) {
    const ry = y + (h/rows)*r;
    ctx.beginPath(); ctx.moveTo(sx(x), sy(ry)); ctx.lineTo(sx(x+w), sy(ry)); ctx.stroke();
  }
  ctx.restore();
}

function drawTreeCluster(ctx, sx, sy, cx, cy, count, radius) {
  ctx.save(); ctx.globalAlpha = 0.22;
  for (let i = 0; i < count; i++) {
    const a = (i/count)*Math.PI*2, r = radius*(0.4+Math.random()*0.6);
    ctx.fillStyle = `hsl(${110+Math.random()*30},${40+Math.random()*20}%,${18+Math.random()*10}%)`;
    ctx.beginPath(); ctx.arc(sx(cx+Math.cos(a)*r), sy(cy+Math.sin(a)*r), 3+Math.random()*2.5, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawBankingLines(ctx, sx, sy, trackFn, t0, t1, offset) {
  ctx.save(); ctx.globalAlpha = 0.15; ctx.strokeStyle = "#c9a460"; ctx.lineWidth = 1.5;
  for (let s = 0; s < 3; s++) {
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) {
      const f = t0 + (t1-t0)*i/18, p = trackFn(f), p2 = trackFn((f+0.004)%1);
      const ang = Math.atan2(p2.y-p.y, p2.x-p.x) + Math.PI/2, d = offset + s*5;
      i === 0 ? ctx.moveTo(sx(p.x)+Math.cos(ang)*d, sy(p.y)+Math.sin(ang)*d)
              : ctx.lineTo(sx(p.x)+Math.cos(ang)*d, sy(p.y)+Math.sin(ang)*d);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawSFGantry(ctx, sx, sy, trackFn, sfLine) {
  const p = trackFn(sfLine), p2 = trackFn(sfLine+0.005);
  const ang = Math.atan2(sy(p2.y)-sy(p.y), sx(p2.x)-sx(p.x)) + Math.PI/2;
  ctx.save(); ctx.globalAlpha = 0.3; ctx.strokeStyle = "#c9a460"; ctx.lineWidth = 2;
  const len = 18;
  const x1 = sx(p.x)+Math.cos(ang)*len,  y1 = sy(p.y)+Math.sin(ang)*len;
  const x2 = sx(p.x)-Math.cos(ang)*len,  y2 = sy(p.y)-Math.sin(ang)*len;
  ctx.beginPath(); ctx.moveTo(x1,y1-10); ctx.lineTo(x1,y1); ctx.moveTo(x2,y2-10); ctx.lineTo(x2,y2); ctx.moveTo(x1,y1-10); ctx.lineTo(x2,y2-10); ctx.stroke();
  ctx.restore();
}

// ─── TRACK DEFINITIONS ─────────────────────────────────────────────────────
// Each track: pitSide (-1=inside), pitOffset (px offset of pit lane from centreline)
// Longer lapBase = slower lap = tracks feel bigger in real-time

const TRACKS = [
  {
    id:"chicago", name:"Chicago Board Track", km:3.1, corners:10, lapBase:26, rewardMult:1.0, trackWidth:52,
    desc:"Tight banked wooden D-oval", getPoint:GP_CHICAGO,
    pitEntry:0.60, pitExit:0.68, sfLine:0.01, pitSide:-1, pitOffset:28,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,288,26,215,18,4);
      drawGrandstand(ctx,sx,sy,288,312,215,18,4);
      drawBankingLines(ctx,sx,sy,GP_CHICAGO,0.175,0.28,22);
      drawBankingLines(ctx,sx,sy,GP_CHICAGO,0.665,0.77,22);
      drawSFGantry(ctx,sx,sy,GP_CHICAGO,0.01);
      ctx.save(); ctx.globalAlpha=0.11; ctx.fillStyle="#c9a460"; ctx.font="bold 9px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("CHICAGO BOARD TRACK",sx(400),sy(174)); ctx.restore();
    },
  },
  {
    id:"daytona", name:"Daytona Beach", km:4.2, corners:6, lapBase:30, rewardMult:1.2, trackWidth:55,
    desc:"High-speed banked oval, 31° banking", getPoint:GP_DAYTONA,
    pitEntry:0.50, pitExit:0.58, sfLine:0.0, pitSide:-1, pitOffset:30,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,312,22,265,20,5);
      drawGrandstand(ctx,sx,sy,312,322,250,16,3);
      drawTreeCluster(ctx,sx,sy,400,172,8,44);
      drawBankingLines(ctx,sx,sy,GP_DAYTONA,0.215,0.305,24);
      drawBankingLines(ctx,sx,sy,GP_DAYTONA,0.670,0.766,24);
      drawSFGantry(ctx,sx,sy,GP_DAYTONA,0.0);
      ctx.save(); ctx.globalAlpha=0.13; ctx.fillStyle="#c9a460"; ctx.font="bold 13px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("DAYTONA BEACH",sx(400),sy(174)); ctx.restore();
    },
  },
  {
    id:"indianapolis", name:"Indianapolis", km:4.6, corners:4, lapBase:32, rewardMult:1.3, trackWidth:55,
    desc:"Superspeedway, Yard of Bricks", getPoint:GP_INDIANAPOLIS,
    pitEntry:0.58, pitExit:0.66, sfLine:0.0, pitSide:-1, pitOffset:30,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,282,22,248,22,6);
      drawGrandstand(ctx,sx,sy,282,320,248,16,4);
      drawTreeCluster(ctx,sx,sy,400,183,6,30);
      ctx.save(); ctx.globalAlpha=0.55; ctx.fillStyle="#c8a060"; ctx.fillRect(sx(390),sy(54),sx(412)-sx(390),sy(71)-sy(54)); ctx.restore();
      drawSFGantry(ctx,sx,sy,GP_INDIANAPOLIS,0.0);
      ctx.save(); ctx.globalAlpha=0.12; ctx.fillStyle="#c9a460"; ctx.font="bold 11px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("INDIANAPOLIS",sx(400),sy(174)); ctx.restore();
    },
  },
  {
    id:"roosevelt", name:"Roosevelt Raceway", km:2.8, corners:18, lapBase:27, rewardMult:1.1, trackWidth:40,
    desc:"Technical twisty road course, NY", getPoint:GP_ROOSEVELT,
    pitEntry:0.74, pitExit:0.81, sfLine:0.0, pitSide:-1, pitOffset:22,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,345,24,124,14,3);
      drawTreeCluster(ctx,sx,sy,295,188,6,24);
      drawTreeCluster(ctx,sx,sy,186,86,4,18);
      drawSFGantry(ctx,sx,sy,GP_ROOSEVELT,0.0);
      ctx.save(); ctx.globalAlpha=0.10; ctx.fillStyle="#c9a460"; ctx.font="bold 9px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("ROOSEVELT RACEWAY",sx(400),sy(175)); ctx.restore();
    },
  },
  {
    id:"boardwalk", name:"Boardwalk Circuit", km:3.4, corners:22, lapBase:28, rewardMult:1.15, trackWidth:27,
    desc:"Narrow street circuit, double chicane", getPoint: t => catmull(BOARDWALK_PTS, t),
    pitEntry:0.66, pitExit:0.73, sfLine:0.0, pitSide:-1, pitOffset:16,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,344,26,164,16,4);
      drawTreeCluster(ctx,sx,sy,398,180,5,20);
      ctx.save(); ctx.globalAlpha=0.10; ctx.strokeStyle="#a08050"; ctx.lineWidth=1;
      for(let i=0;i<16;i++){const x=sx(100+i*40),y1=sy(292),y2=sy(312);ctx.beginPath();ctx.moveTo(x,y1);ctx.lineTo(x,y2);ctx.stroke();}
      ctx.restore();
      drawSFGantry(ctx,sx,sy,t=>catmull(BOARDWALK_PTS,t),0.0);
      ctx.save(); ctx.globalAlpha=0.12; ctx.fillStyle="#c9a460"; ctx.font="bold 9px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("BOARDWALK CIRCUIT",sx(400),sy(178)); ctx.restore();
    },
  },
  {
    id:"lakeside", name:"Lakeside Park", km:3.8, corners:14, lapBase:29, rewardMult:1.1, trackWidth:43,
    desc:"Flowing sweepers around the lake", getPoint:GP_LAKESIDE,
    pitEntry:0.62, pitExit:0.69, sfLine:0.0, pitSide:-1, pitOffset:22,
    drawExtra:(ctx,sx,sy) => {
      ctx.save(); ctx.globalAlpha=0.10; ctx.fillStyle="#2060a0";
      ctx.beginPath(); ctx.ellipse(sx(376),sy(177),sx(108)-sx(0),sy(60)-sy(0),0,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=0.06; ctx.fillStyle="#3080c0";
      ctx.beginPath(); ctx.ellipse(sx(376),sy(177),sx(70)-sx(0),sy(38)-sy(0),0,0,Math.PI*2); ctx.fill();
      ctx.restore();
      drawTreeCluster(ctx,sx,sy,282,110,8,28);
      drawTreeCluster(ctx,sx,sy,476,116,6,22);
      drawGrandstand(ctx,sx,sy,352,24,127,14,3);
      drawSFGantry(ctx,sx,sy,GP_LAKESIDE,0.0);
      ctx.save(); ctx.globalAlpha=0.11; ctx.fillStyle="#c9a460"; ctx.font="8px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("LAKESIDE PARK",sx(374),sy(197)); ctx.restore();
    },
  },
  {
    id:"harbor", name:"Harbor Front", km:3.0, corners:24, lapBase:26, rewardMult:1.05, trackWidth:31,
    desc:"Narrow dockside, two hairpins", getPoint:GP_HARBOR,
    pitEntry:0.77, pitExit:0.84, sfLine:0.0, pitSide:-1, pitOffset:18,
    drawExtra:(ctx,sx,sy) => {
      ctx.save(); ctx.globalAlpha=0.08; ctx.fillStyle="#2060a0";
      ctx.fillRect(sx(272),sy(252),sx(535)-sx(272),sy(324)-sy(252)); ctx.restore();
      ctx.save(); ctx.globalAlpha=0.15; ctx.strokeStyle="#506070"; ctx.lineWidth=2;
      [[336,258,336,294],[390,254,390,290],[444,254,444,290],[494,258,494,294]].forEach(([x1,y1,x2,y2])=>{
        ctx.beginPath(); ctx.moveTo(sx(x1),sy(y1)); ctx.lineTo(sx(x2),sy(y2)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx(x2)-8,sy(y2)-8); ctx.lineTo(sx(x2)+8,sy(y2)-8); ctx.lineTo(sx(x2)+8,sy(y2)+2); ctx.lineTo(sx(x2)-8,sy(y2)+2); ctx.closePath(); ctx.stroke();
      });
      ctx.restore();
      drawGrandstand(ctx,sx,sy,346,24,124,16,4);
      drawSFGantry(ctx,sx,sy,GP_HARBOR,0.0);
      ctx.save(); ctx.globalAlpha=0.12; ctx.fillStyle="#c9a460"; ctx.font="bold 9px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("HARBOR FRONT",sx(400),sy(165)); ctx.restore();
    },
  },
  {
    id:"mountain", name:"Mountain Pass", km:4.8, corners:22, lapBase:34, rewardMult:1.25, trackWidth:41,
    desc:"Switchbacks and elevation changes", getPoint:GP_MOUNTAIN,
    pitEntry:0.68, pitExit:0.75, sfLine:0.0, pitSide:-1, pitOffset:22,
    drawExtra:(ctx,sx,sy) => {
      ctx.save(); ctx.globalAlpha=0.06; ctx.strokeStyle="#705840"; ctx.lineWidth=0.8;
      for(let i=0;i<8;i++){ctx.beginPath();for(let j=0;j<=50;j++){const x=sx(100+j*12),y=sy(80+i*32+Math.sin(j*0.35+i)*14);j===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();}
      ctx.restore();
      ctx.save(); ctx.globalAlpha=0.20; ctx.fillStyle="#7a6a5a";
      [[398,92,372,144,428,144],[246,120,232,155,263,155],[567,130,552,162,582,162]].forEach(([cx,y1,x1,y2,x2])=>{
        ctx.beginPath();ctx.moveTo(sx(cx),sy(y1));ctx.lineTo(sx(x1),sy(y2));ctx.lineTo(sx(x2),sy(y2));ctx.closePath();ctx.fill();
      });
      ctx.restore();
      drawTreeCluster(ctx,sx,sy,316,168,6,22);
      drawTreeCluster(ctx,sx,sy,476,242,5,18);
      drawGrandstand(ctx,sx,sy,344,22,124,14,3);
      drawSFGantry(ctx,sx,sy,GP_MOUNTAIN,0.0);
      ctx.save(); ctx.globalAlpha=0.10; ctx.fillStyle="#c9a460"; ctx.font="bold 9px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("MOUNTAIN PASS",sx(400),sy(173)); ctx.restore();
    },
  },
  {
    id:"brooklands", name:"Brooklands Banking", km:6.4, corners:8, lapBase:44, rewardMult:1.35, trackWidth:55,
    desc:"Members' Banking — Surrey 1907", getPoint:GP_BROOKLANDS,
    pitEntry:0.56, pitExit:0.63, sfLine:0.0, pitSide:-1, pitOffset:28,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,338,36,214,20,5);
      drawGrandstand(ctx,sx,sy,354,316,175,14,3);
      drawTreeCluster(ctx,sx,sy,398,188,10,54);
      drawTreeCluster(ctx,sx,sy,155,200,5,22);
      drawBankingLines(ctx,sx,sy,GP_BROOKLANDS,0.225,0.310,24);
      drawBankingLines(ctx,sx,sy,GP_BROOKLANDS,0.682,0.765,24);
      drawSFGantry(ctx,sx,sy,GP_BROOKLANDS,0.0);
      ctx.save(); ctx.globalAlpha=0.12; ctx.fillStyle="#c9a460"; ctx.font="bold 12px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("BROOKLANDS",sx(400),sy(180)); ctx.font="8px Cinzel,serif"; ctx.fillText("BANKING",sx(400),sy(196)); ctx.restore();
    },
  },
  {
    id:"monza", name:"Monza Autodromo", km:8.0, corners:14, lapBase:54, rewardMult:1.4, trackWidth:34,
    desc:"Oval + road circuit — Italy 1922", getPoint:GP_MONZA,
    pitEntry:0.60, pitExit:0.67, sfLine:0.0, pitSide:-1, pitOffset:20,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,340,18,228,18,5);
      drawTreeCluster(ctx,sx,sy,372,148,8,36);
      drawTreeCluster(ctx,sx,sy,634,150,5,18);
      drawSFGantry(ctx,sx,sy,GP_MONZA,0.0);
      ctx.save(); ctx.globalAlpha=0.12; ctx.fillStyle="#c9a460"; ctx.font="bold 10px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("MONZA AUTODROMO",sx(344),sy(168)); ctx.restore();
    },
  },
  {
    id:"lemans", name:"Le Mans Sarthe", km:10.7, corners:16, lapBase:67, rewardMult:1.5, trackWidth:45,
    desc:"Mulsanne straight — France 1923", getPoint:GP_LEMANS,
    pitEntry:0.54, pitExit:0.61, sfLine:0.0, pitSide:-1, pitOffset:24,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,312,38,210,18,5);
      drawTreeCluster(ctx,sx,sy,370,180,12,57);
      drawTreeCluster(ctx,sx,sy,608,188,5,18);
      ctx.save(); ctx.globalAlpha=0.08; ctx.fillStyle="#3a5a2a";
      ctx.fillRect(sx(296),sy(116),sx(520)-sx(296),sy(248)-sy(116)); ctx.restore();
      drawSFGantry(ctx,sx,sy,GP_LEMANS,0.0);
      ctx.save(); ctx.globalAlpha=0.12; ctx.fillStyle="#c9a460"; ctx.font="bold 10px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("LE MANS",sx(400),sy(167)); ctx.font="8px Cinzel,serif"; ctx.fillText("CIRCUIT DE LA SARTHE",sx(400),sy(182)); ctx.restore();
    },
  },
  {
    id:"avus", name:"AVUS Speedway", km:12.0, corners:4, lapBase:60, rewardMult:1.45, trackWidth:55,
    desc:"Two straights, banked hairpins — Berlin 1921", getPoint:GP_AVUS,
    pitEntry:0.46, pitExit:0.53, sfLine:0.0, pitSide:-1, pitOffset:30,
    drawExtra:(ctx,sx,sy) => {
      drawGrandstand(ctx,sx,sy,338,22,224,20,5);
      drawGrandstand(ctx,sx,sy,338,274,224,16,4);
      drawTreeCluster(ctx,sx,sy,400,152,8,42);
      drawBankingLines(ctx,sx,sy,GP_AVUS,0.275,0.420,22);
      drawBankingLines(ctx,sx,sy,GP_AVUS,0.710,0.838,22);
      drawSFGantry(ctx,sx,sy,GP_AVUS,0.0);
      ctx.save(); ctx.globalAlpha=0.12; ctx.fillStyle="#c9a460"; ctx.font="bold 14px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("AVUS",sx(400),sy(150)); ctx.font="8px Cinzel,serif"; ctx.fillText("SPEEDWAY",sx(400),sy(165)); ctx.restore();
    },
  },
  {
    id:"targa", name:"Targa Florio", km:14.5, corners:32, lapBase:82, rewardMult:1.6, trackWidth:34,
    desc:"Madonie mountains — Sicily 1906", getPoint:GP_TARGA,
    pitEntry:0.73, pitExit:0.80, sfLine:0.865, pitSide:-1, pitOffset:20,
    drawExtra:(ctx,sx,sy) => {
      drawTreeCluster(ctx,sx,sy,398,187,14,63);
      drawTreeCluster(ctx,sx,sy,195,174,8,30);
      drawTreeCluster(ctx,sx,sy,576,220,6,26);
      drawGrandstand(ctx,sx,sy,370,323,114,12,3);
      ctx.save(); ctx.globalAlpha=0.06; ctx.fillStyle="#4a6a3a";
      ctx.beginPath();ctx.moveTo(sx(294),sy(96));ctx.lineTo(sx(544),sy(76));ctx.lineTo(sx(646),sy(196));ctx.lineTo(sx(498),sy(278));ctx.lineTo(sx(276),sy(249));ctx.closePath();ctx.fill();ctx.restore();
      drawSFGantry(ctx,sx,sy,GP_TARGA,0.0);
      ctx.save(); ctx.globalAlpha=0.12; ctx.fillStyle="#c9a460"; ctx.font="bold 9px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("TARGA FLORIO",sx(400),sy(170)); ctx.font="7px Cinzel,serif"; ctx.fillText("MADONIE, SICILY",sx(400),sy(184)); ctx.restore();
    },
  },
];

// ─── PHYSICS: CORNER SPEED PROFILE ─────────────────────────────────────────
// Pre-computed per track. Braking zones before corners, acceleration out.
// Exactly matches F1 Clash's approach: pre-baked speed profile lookup.

const PROFILE_N = 256;
const _profileCache = new Map();

/** Must match buildSpeedProfile `inSFZone` — wide approach so cars don’t brake before the gantry on any map. */
const SF_PROFILE_PRE_ZONE = 0.28;
const SF_PROFILE_POST_ZONE = 0.14;

/** True if moving forward from cell i hits the start/finish zone within `maxSteps` samples. Stops braking/accel bleed into the run-up. */
function forwardReachesSfZoneWithin(i, sfZone, N, maxSteps) {
  for (let k = 1; k <= maxSteps; k++) {
    if (sfZone[(i + k) % N]) return true;
  }
  return false;
}

// FIX B1: uses geometry discontinuity detection instead of blanket 5% bypass
function getCurvature(track, t) {
  const eps = 0.006;
  const p0 = track.getPoint(((t - eps) % 1 + 1) % 1);
  const p1 = track.getPoint(t);
  const p2 = track.getPoint((t + eps) % 1);
  const dx1 = p1.x-p0.x, dy1 = p1.y-p0.y;
  const dx2 = p2.x-p1.x, dy2 = p2.y-p1.y;
  const l1 = Math.hypot(dx1,dy1)||1e-6, l2 = Math.hypot(dx2,dy2)||1e-6;
  if ((l1+l2)/2 > 40) return 0; // lap-join teleport artefact
  let delta = Math.atan2(dy2,dx2) - Math.atan2(dy1,dx1);
  if (delta > Math.PI)  delta -= 2*Math.PI;
  if (delta < -Math.PI) delta += 2*Math.PI;
  return Math.abs(delta) / ((l1+l2)/2);
}

/** Same geometry as buildSpeedProfile's SF zone — use for slide-off + corner-tier gating (no gap vs profile). */
function inStartFinishSafeZone(track, t) {
  const sfL = track.sfLine != null ? track.sfLine : 0;
  const tt = ((t % 1) + 1) % 1;
  const dBehind = ((sfL - tt + 1) % 1);
  const dAhead = ((tt - sfL + 1) % 1);
  return dBehind <= SF_PROFILE_PRE_ZONE || dAhead <= SF_PROFILE_POST_ZONE;
}

/** Wider zone after SF line only — damps seam curvature for brake/accel tiers (not profile / slide-off). */
function inStartFinishCornerRelaxZone(track, t) {
  const sfL = track.sfLine != null ? track.sfLine : 0;
  const tt = ((t % 1) + 1) % 1;
  const postTier = 0.26;
  const dBehind = ((sfL - tt + 1) % 1);
  const dAhead = ((tt - sfL + 1) % 1);
  return dBehind <= SF_PROFILE_PRE_ZONE || dAhead <= postTier;
}

/**
 * Forward move from p0 → p1 crosses sfLine (lap timing line). Works with large dt (x4 / frame gaps);
 * the old “both points within 8% of line” test often missed laps.
 */
function crossedStartFinishLineForward(p0raw, p1raw, sfLine) {
  const EPS = 1e-7;
  const sf = sfLine != null ? (((sfLine % 1) + 1) % 1) : 0;
  const p0 = ((p0raw % 1) + 1) % 1;
  const p1 = ((p1raw % 1) + 1) % 1;
  let d = p1 - p0;
  if (d < 0) d += 1;
  if (d < EPS) return false;
  if (sf <= EPS) {
    return p1 < p0 - EPS;
  }
  if (p0 < sf - EPS) {
    return p0 + d >= sf - EPS;
  }
  const end = p0 + d;
  if (end < 1 - EPS) return false;
  return end - 1 >= sf - EPS;
}

function buildSpeedProfile(track) {
  const cacheKey = `${track.id}:${track.sfLine ?? 0}:sfv6`;
  if (_profileCache.has(cacheKey)) return _profileCache.get(cacheKey);
  const N = PROFILE_N, raw = new Float32Array(N);

  const sfL = track.sfLine != null ? track.sfLine : 0;
  const inSFZone = f => {
    const dBehind = ((sfL - f + 1) % 1);
    const dAhead  = ((f - sfL + 1) % 1);
    return dBehind <= SF_PROFILE_PRE_ZONE || dAhead <= SF_PROFILE_POST_ZONE;
  };
  // Pre-compute a boolean array for speed in the hot loop
  const sfZone = new Uint8Array(N);
  for (let i = 0; i < N; i++) sfZone[i] = inSFZone(i/N) ? 1 : 0;

  // ── Pass 1: raw corner speed from curvature ──
  for (let i = 0; i < N; i++) {
    if (sfZone[i]) {
      raw[i] = 1.0; // forced full speed on SF straight — immune to later passes
    } else {
      const c = getCurvature(track, i/N);
      raw[i] = c < 0.005 ? 1.0 : Math.max(0.52, 1/(1 + c*22));
    }
  }

  // ── Pass 2: braking (scan backwards, 5 iterations) ──
  // CRITICAL: if cell i is in the SF zone, SKIP it — don't let braking reduce it.
  // Also: if cell (i+1) is in the SF zone, don't propagate from it backward
  // (cars don't brake because of a fast straight ahead of them).
  const sfRunUpSteps = 72; // ~28% @ N=256 — block braking bleed into S/F approach
  for (let iter = 0; iter < 5; iter++) {
    for (let i = N-1; i >= 0; i--) {
      if (sfZone[i]) continue;
      if (forwardReachesSfZoneWithin(i, sfZone, N, sfRunUpSteps)) continue;
      const ni = (i + 1) % N;
      const lim = raw[ni] / 0.956;
      if (raw[i] > lim) raw[i] = lim;
    }
  }

  // ── Pass 3: acceleration (scan forward, 5 iterations) ──
  // FIX: rate 0.910 (was 0.974) — cars recover from corner in ~6 cells (~2.3% lap)
  // instead of ~22 cells (~8.6% lap). Straights before SF line reach full speed.
  for (let iter = 0; iter < 5; iter++) {
    for (let i = 0; i < N; i++) {
      if (sfZone[i]) continue;
      const pi = (i - 1 + N) % N;
      if (sfZone[pi]) continue;
      if (forwardReachesSfZoneWithin(pi, sfZone, N, sfRunUpSteps)) continue;
      const lim = raw[pi] / 0.910;
      if (raw[i] > lim) raw[i] = lim;
    }
  }

  // ── FIX: clamp instead of normalize ──
  // Normalization maps min-raw → 0.54 regardless of what min-raw actually is.
  // On low-curvature tracks (ovals), a gentle bend with raw=0.85 gets mapped to ~0.56.
  // Direct clamp preserves the physically correct values: straights=1.0, corners=0.54..0.85.
  const profile = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    profile[i] = sfZone[i]
      ? Math.max(0.97, Math.min(1.0, raw[i]))
      : Math.max(0.54, Math.min(1.0, raw[i]));
  }

  _profileCache.set(cacheKey, profile);
  return profile;
}

function getSpeedMult(track, t, grip = 0.85) {
  const profile = buildSpeedProfile(track);
  const idx = Math.round(((t%1+1)%1) * (PROFILE_N-1));
  return Math.max(0.50, Math.min(1.0, profile[idx] + (grip-0.85)*0.6));
}

// Shared corner grip multiplier — used by both race loop and draw code.
// k=22 matches the buildSpeedProfile corner formula for physical consistency.
function cornerGripMult(curvature, grip = 0.85) {
  const k = 22 * (1.2 - grip*0.5);
  return Math.max(0.54 + grip*0.16, Math.min(1, 1/(1 + curvature*k)));
}

// ─── PIT LANE GEOMETRY ─────────────────────────────────────────────────────
// Physically offset from track, blends in/out smoothly at entry/exit

function getPitLanePoint(track, frac) {
  const rangeStart = track.pitEntry - 0.025;
  const rangeEnd   = track.pitExit  + 0.025;
  const f0 = rangeStart + (rangeEnd - rangeStart) * frac;
  const f  = ((f0 % 1) + 1) % 1;
  const pp  = track.getPoint(f);
  const pp2 = track.getPoint(((f + 0.004) % 1 + 1) % 1);
  const ang = Math.atan2(pp2.y-pp.y, pp2.x-pp.x) + Math.PI/2;
  const BLEND = 0.10;
  const blend = frac < BLEND ? (frac/BLEND)**2 : frac > 1-BLEND ? ((1-frac)/BLEND)**2 : 1;
  const side = track.pitSide  !== undefined ? track.pitSide  : -1;
  const off  = track.pitOffset !== undefined ? track.pitOffset : 24;
  return { x: pp.x + Math.cos(ang)*blend*off*side, y: pp.y + Math.sin(ang)*blend*off*side };
}

// ─── SKID MARKS ────────────────────────────────────────────────────────────

class SkidMarks {
  constructor() { this.marks = []; this.MAX = 250; }
  add(x, y, angle, intensity) {
    if (this.marks.length >= this.MAX) this.marks.shift();
    this.marks.push({ x, y, angle, intensity, born: Date.now(), life: 9000 + Math.random()*5000 });
  }
  draw(ctx) {
    const now = Date.now();
    this.marks = this.marks.filter(m => now - m.born < m.life);
    ctx.save();
    this.marks.forEach(m => {
      const age = (now - m.born) / m.life;
      const alpha = Math.max(0, (1-age) * m.intensity * 0.40);
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.fillStyle = "#201e18";
      ctx.fillRect(-3.5, -1.5, 7, 3);
      ctx.restore();
    });
    ctx.restore();
  }
}

const SKIDS = new SkidMarks();

// ─── PARTICLE SYSTEM ──────────────────────────────────────────────────────

const _particles = [];
const MAX_PARTICLES = 200;

function addTireSmoke(x, y, intensity = 1) {
  for (let i = 0; i < Math.ceil(3 * intensity); i++) {
    if (_particles.length >= MAX_PARTICLES) _particles.shift();
    _particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      life: 1.0,
      decay: 0.02 + Math.random() * 0.03,
      size: 2 + Math.random() * 3,
      type: 'smoke',
    });
  }
}

function addSparks(x, y) {
  for (let i = 0; i < 5; i++) {
    if (_particles.length >= MAX_PARTICLES) _particles.shift();
    _particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      life: 1.0,
      decay: 0.05 + Math.random() * 0.05,
      size: 1 + Math.random(),
      type: 'spark',
    });
  }
}

function updateAndDrawParticles(ctx) {
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) { _particles.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    if (p.type === 'spark') {
      ctx.fillStyle = `rgba(255,200,50,${(p.life * 0.8).toFixed(2)})`;
    } else {
      ctx.fillStyle = `rgba(180,180,180,${(p.life * 0.5).toFixed(2)})`;
    }
    ctx.fill();
  }
}

function drawConfetti(ctx, W, H, elapsed) {
  if (elapsed > 5000 || elapsed < 0) return;
  const count = 40;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const seed = i * 137.508;
    const x = ((seed * 7.3 + elapsed * 0.05 * (1 + (i%3)*0.3)) % W);
    const y = ((seed * 3.7 + elapsed * 0.08 * (1 + (i%2)*0.2)) % H);
    const colors = ["#e8c870","#dc2626","#3b82f6","#22c55e","#f59e0b","#ec4899"];
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = Math.max(0, 1 - elapsed/5000);
    ctx.fillRect(x, y, 4 + (i%3)*2, 2 + (i%2)*2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─── COMPONENT ─────────────────────────────────────────────────────────────

export default function CircuitRaceView({
  participants = [], lap_results = [], pit_stops = [], qualifying_order = [],
  tire_wear_after_lap = {}, laps: totalLaps = 3, resultOrder = [],
  weather: weatherIdProp = "clear", weather_name: weatherNameProp,
  onComplete, onReset, onVisualLapChange = null,
  mode = "replay", raceId = null, initialTrackId = "chicago",
  initialCondition = "clear", playerCarName = "Stutz Bearcat",
  playerTyreId = "medium", playerPitLevel = 0, currentUserId = null,
  rewards: rewardsProp = null,
  liveCarStates = null, liveIncidents = null, livePitStops = null,
  liveCurrentLap = 0, liveTotalLaps = 3,
  lapDeadline = null,
}) {
  const canvasRef  = useRef(null);
  const rafRef     = useRef(null);
  const stateRef   = useRef(null);
  const cdRef      = useRef(null);
  const rpStarted  = useRef(false);

  const [uiPhase,    setUiPhase]    = useState("setup");
  const [selTrack,   setSelTrack]   = useState(() => TRACKS.find(t=>t.id===initialTrackId)||TRACKS[0]);
  const [condition,  setCondition]  = useState(initialCondition);
  const [chosenTyre, setChosenTyre] = useState(playerTyreId);
  const [numLaps,    setNumLaps]    = useState(() => Math.max(2, Math.min(20, totalLaps)));
  const [countdown,  setCountdown]  = useState(3);
  const [commentary, setCommentary] = useState("Select track & tyres, then start");
  const [standings,  setStandings]  = useState([]);
  const [pitNotif,   setPitNotif]   = useState(null);
  const [lapDisp,    setLapDisp]    = useState("—");
  const [results,    setResults]    = useState(null);
  const [spMult,     setSpMult]     = useState(1);
  const spMultRef = useRef(1);
  const [paused,    setPaused]    = useState(false);
  const pausedRef = useRef(false);
  const [raceProg,  setRaceProg]  = useState(0);
  const [manPit,    setManPit]    = useState(false);
  const manPitRef = useRef(false);
  const pitTimer  = useRef(null);
  const [narrow,    setNarrow]    = useState(() => typeof window!=="undefined" && window.innerWidth<640);

  useEffect(() => { const f = ()=>setNarrow(window.innerWidth<640); window.addEventListener("resize",f); return ()=>window.removeEventListener("resize",f); }, []);
  useEffect(() => { spMultRef.current = spMult; },  [spMult]);
  useEffect(() => { pausedRef.current = paused; },  [paused]);
  useEffect(() => { manPitRef.current = manPit; },  [manPit]);
  const onVisualLapChangeRef = useRef(onVisualLapChange);
  useEffect(() => { onVisualLapChangeRef.current = onVisualLapChange; }, [onVisualLapChange]);

  const liveCarStatesRef = useRef(liveCarStates);
  const liveIncidentsRef = useRef(liveIncidents);
  const livePitStopsRef = useRef(livePitStops);
  const liveCurrentLapRef = useRef(liveCurrentLap);
  const liveTotalLapsRef = useRef(liveTotalLaps);
  const liveInitDone = useRef(false);
  const lapDeadlineRef = useRef(lapDeadline);

  useEffect(() => { liveCarStatesRef.current = liveCarStates; }, [liveCarStates]);
  useEffect(() => { liveIncidentsRef.current = liveIncidents; }, [liveIncidents]);
  useEffect(() => { livePitStopsRef.current = livePitStops; }, [livePitStops]);
  useEffect(() => { liveCurrentLapRef.current = liveCurrentLap; }, [liveCurrentLap]);
  useEffect(() => { liveTotalLapsRef.current = liveTotalLaps; }, [liveTotalLaps]);
  useEffect(() => { lapDeadlineRef.current = lapDeadline; }, [lapDeadline]);

  const SKEY = raceId ? `rcv3_${raceId}` : null;
  const lastSave = useRef(0);
  const raceStart = useRef(null);

  const clearSaved = useCallback(() => { if (!SKEY) return; try { localStorage.removeItem(SKEY); } catch {} }, [SKEY]);
  const saveState  = useCallback(() => {
    if (!SKEY || !stateRef.current) return;
    const { racers, nLaps } = stateRef.current;
    if (!racers?.length) return;
    try {
      localStorage.setItem(SKEY, JSON.stringify({ ts: Date.now(), nLaps, racers: racers.map(r => ({
        id:r.id, trackPos:r.trackPos, totalLapsDone:r.totalLapsDone, lapCount:r.lapCount,
        finished:r.finished, finishOrder:r.finishOrder, dnf:r.dnf, tyreWear:r.tyreWear,
        currentTyre:r.currentTyre, pitStops:r.pitStops, fuelLoad:r.fuelLoad, position:r.position,
        inPit:r.inPit, baseSpeed:r.baseSpeed, baseGrip:r.baseGrip, carNumber:r.carNumber,
      })) }));
    } catch {}
  }, [SKEY]);

  const effCond = (mode==="replay"||mode==="live"||mode==="interactive-live") ? (WEATHER_MAP[weatherIdProp]||"clear") : condition;
  const wDef    = WEATHER_DEFS[effCond] || WEATHER_DEFS.clear;

  const getScale = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return { sx:x=>x, sy:y=>y, W:800, H:360 };
    const dpr = window.devicePixelRatio||1;
    return { sx:x=>(x/800)*(c.width/dpr), sy:y=>(y/360)*(c.height/dpr), W:c.width/dpr, H:c.height/dpr };
  }, []);

  const resizeCanvas = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const dpr = window.devicePixelRatio||1, w = c.parentElement.clientWidth;
    const h = Math.max(240, Math.min(w*0.56, 420));
    c.width = w*dpr; c.height = h*dpr; c.style.width = w+"px"; c.style.height = h+"px";
    c.getContext("2d").scale(dpr, dpr);
  }, []);

  // ─── DRAW CANVAS ─────────────────────────────────────────────────────────
  const drawCanvas = useCallback((track, cond, racerArr, nowSec = 0) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { sx, sy, W, H } = getScale();
    const wd = WEATHER_DEFS[cond] || WEATHER_DEFS.clear;

    // ── Background ──
    const bg = ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0, wd.bg1); bg.addColorStop(1, wd.bg2);
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

    // ── Weather particles ──
    if (cond === "rain") {
      const t = Date.now();
      for (let l=0; l<3; l++) {
        const cnt=[80,50,30][l], a=[0.08,0.14,0.22][l], len=[5,8,12][l], sp=[0.04,0.07,0.11][l];
        ctx.strokeStyle = `rgba(150,185,225,${a})`; ctx.lineWidth = 0.5+l*0.3;
        for (let i=0; i<cnt; i++) {
          const x=((i*47+l*111+t*sp)%W), y=((i*61+l*73+t*(sp*1.5))%H);
          ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+1.5,y+len); ctx.stroke();
        }
      }
      ctx.fillStyle="rgba(120,160,200,0.04)";
      for (let i=0; i<12; i++) {
        const p=track.getPoint((i/12+Date.now()*0.00001)%1);
        ctx.beginPath(); ctx.ellipse(sx(p.x),sy(p.y),12+Math.sin(Date.now()*0.003+i)*4,3,0,0,Math.PI*2); ctx.fill();
      }
    }
    if (cond === "snow") {
      const t=Date.now();

      // ── Atmospheric fog overlay ──
      const fogG=ctx.createLinearGradient(0,0,0,H);
      fogG.addColorStop(0,"rgba(180,195,225,0.12)");
      fogG.addColorStop(0.5,"rgba(160,180,215,0.06)");
      fogG.addColorStop(1,"rgba(140,165,210,0.14)");
      ctx.fillStyle=fogG; ctx.fillRect(0,0,W,H);

      // ── Snow accumulation on ground (bottom edge) ──
      ctx.save();
      const snowG=ctx.createLinearGradient(0,H-18,0,H);
      snowG.addColorStop(0,"rgba(220,230,248,0)");
      snowG.addColorStop(1,"rgba(220,230,248,0.18)");
      ctx.fillStyle=snowG; ctx.fillRect(0,H-18,W,18);
      ctx.restore();

      // ── Snowflake shapes (6-pointed star) for large flakes ──
      const drawFlake=(cx,cy,radius,alpha)=>{
        ctx.save(); ctx.globalAlpha=alpha; ctx.strokeStyle="rgba(220,235,255,1)";
        ctx.lineWidth=0.8; ctx.translate(cx,cy);
        for(let arm=0;arm<6;arm++){
          ctx.save(); ctx.rotate((arm/6)*Math.PI*2);
          ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-radius);
          // side branches at 1/3 and 2/3
          const b1=radius*0.35, b2=radius*0.62;
          ctx.moveTo(0,-b1); ctx.lineTo(radius*0.22,-b1-radius*0.18);
          ctx.moveTo(0,-b1); ctx.lineTo(-radius*0.22,-b1-radius*0.18);
          ctx.moveTo(0,-b2); ctx.lineTo(radius*0.16,-b2-radius*0.12);
          ctx.moveTo(0,-b2); ctx.lineTo(-radius*0.16,-b2-radius*0.12);
          ctx.stroke(); ctx.restore();
        }
        ctx.restore();
      };

      // ── Layer 1: distant fine snow (circular, fast) ──
      ctx.fillStyle="rgba(210,225,250,0.18)";
      for(let i=0;i<80;i++){
        const drift=Math.sin(t*0.0008+i*0.7)*20;
        const x=((i*53+t*0.028+drift)%(W+40))-20;
        const y=((i*71+t*0.038)%H);
        ctx.beginPath(); ctx.arc(x,y,0.8,0,Math.PI*2); ctx.fill();
      }

      // ── Layer 2: mid-range flakes (circular, medium speed) ──
      ctx.fillStyle="rgba(215,228,252,0.28)";
      for(let i=0;i<50;i++){
        const drift=Math.sin(t*0.001+i*0.5)*18;
        const x=((i*67+t*0.018+drift)%(W+50))-25;
        const y=((i*83+t*0.026)%H);
        ctx.beginPath(); ctx.arc(x,y,1.4,0,Math.PI*2); ctx.fill();
      }

      // ── Layer 3: large foreground flakes (star shapes, slow drift) ──
      for(let i=0;i<22;i++){
        const drift=Math.sin(t*0.0007+i*1.1)*28+Math.sin(t*0.0015+i)*8;
        const x=((i*113+t*0.010+drift)%(W+60))-30;
        const y=((i*97+t*0.014)%H);
        const sway=Math.sin(t*0.0012+i*0.8)*3;
        drawFlake(x+sway,y,3.5,0.28+Math.sin(i*2.3)*0.08);
      }

      // ── Layer 4: extra-large slow flakes tumbling ──
      for(let i=0;i<8;i++){
        const drift=Math.sin(t*0.0005+i*1.8)*40;
        const x=((i*178+t*0.007+drift)%(W+80))-40;
        const y=((i*133+t*0.009)%H);
        const sway=Math.sin(t*0.001+i*1.2)*5;
        drawFlake(x+sway,y,5.5,0.20+Math.sin(i*1.5)*0.06);
      }
    }
    // ── Snow pass 2: track-surface accumulation (needs STEPS/halfW, drawn after tarmac) ──
    // defined as a closure called after STEPS is in scope
    const _drawSnowTrackAccum = () => {
      if (cond !== "snow") return;
      const t=Date.now();
      // Snow on track surface: white shimmer dots
      ctx.save(); ctx.globalAlpha=0.07; ctx.fillStyle="rgba(225,235,255,1)";
      for(let i=0;i<=STEPS;i++){
        const f=i/STEPS, p=track.getPoint(f), p2=track.getPoint((f+0.003)%1);
        const ang=Math.atan2(sy(p2.y)-sy(p.y),sx(p2.x)-sx(p.x))+Math.PI/2;
        const kx=sx(p.x)+Math.cos(ang)*(halfW*0.9), ky=sy(p.y)+Math.sin(ang)*(halfW*0.9);
        ctx.beginPath(); ctx.arc(kx,ky,2.5,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
      // Snow build-up on track edges
      ctx.save();
      for(let edge=-1;edge<=1;edge+=2){
        ctx.globalAlpha=0.24; ctx.fillStyle="rgba(215,228,250,1)";
        for(let i=0;i<84;i++){
          const f=i/84, p=track.getPoint(f), pn=track.getPoint((f+0.003)%1);
          const ang=Math.atan2(pn.y-p.y,pn.x-p.x)+Math.PI/2;
          const bump=1.6+Math.sin(i*3.7+t*0.0002)*0.7;
          const kx=sx(p.x)+Math.cos(ang)*(halfW+1)*edge;
          const ky=sy(p.y)+Math.sin(ang)*(halfW+1)*edge;
          ctx.beginPath(); ctx.arc(kx,ky,bump,0,Math.PI*2); ctx.fill();
        }
      }
      ctx.restore();
      // Icy surface sheen patches
      ctx.save(); ctx.globalAlpha=0.05;
      for(let i=0;i<8;i++){
        const f=(i/8+t*0.000003)%1, p=track.getPoint(f);
        const iceG=ctx.createRadialGradient(sx(p.x),sy(p.y),0,sx(p.x),sy(p.y),halfW*0.8);
        iceG.addColorStop(0,"rgba(200,220,255,0.7)");
        iceG.addColorStop(1,"rgba(200,220,255,0)");
        ctx.fillStyle=iceG;
        ctx.beginPath(); ctx.ellipse(sx(p.x),sy(p.y),halfW*0.8,halfW*0.5,0,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    };

    if (cond === "night") {
      [0.08,0.22,0.38,0.52,0.66,0.80].forEach((f,li) => {
        const lp=track.getPoint(f), lp2=track.getPoint((f+0.01)%1);
        const la=Math.atan2(lp2.y-lp.y,lp2.x-lp.x), fl=0.14+0.04*Math.sin(nowSec*6+li*1.7);
        ctx.save(); ctx.translate(sx(lp.x),sy(lp.y)); ctx.rotate(la);
        const cone=ctx.createRadialGradient(0,0,2,20,0,55);
        cone.addColorStop(0,`rgba(255,210,90,${fl})`); cone.addColorStop(1,"rgba(255,210,90,0)");
        ctx.fillStyle=cone; ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,55,-0.5,0.5); ctx.closePath(); ctx.fill();
        ctx.restore();
        const g=ctx.createRadialGradient(sx(lp.x),sy(lp.y),0,sx(lp.x),sy(lp.y),50);
        g.addColorStop(0,`rgba(255,210,90,${fl})`); g.addColorStop(1,"rgba(255,210,90,0)");
        ctx.fillStyle=g; ctx.fillRect(sx(lp.x)-50,sy(lp.y)-50,100,100);
        ctx.strokeStyle="rgba(100,90,60,0.55)"; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(sx(lp.x),sy(lp.y)); ctx.lineTo(sx(lp.x),sy(lp.y)-16); ctx.stroke();
        ctx.fillStyle=`rgba(255,225,100,${0.7+fl*2})`; ctx.beginPath(); ctx.arc(sx(lp.x),sy(lp.y)-16,2.5,0,Math.PI*2); ctx.fill();
      });
    }
    if (cond === "very_hot") {
      ctx.fillStyle = "rgba(255,80,0,0.03)"; ctx.fillRect(0,0,W,H);
    }

    // ── Track surface ──
    const STEPS = 420, tw = track.trackWidth || 12, halfW = tw * 0.5;

    const buildBand = (ctx, offPx) => {
      const out = [], inn = [];
      for (let i = 0; i <= STEPS; i++) {
        const f=i/STEPS, p=track.getPoint(f), p2=track.getPoint((f+0.003)%1);
        const ang=Math.atan2(sy(p2.y)-sy(p.y), sx(p2.x)-sx(p.x)) + Math.PI/2;
        out.push({ x:sx(p.x)+Math.cos(ang)*(halfW+offPx), y:sy(p.y)+Math.sin(ang)*(halfW+offPx) });
        inn.push({ x:sx(p.x)-Math.cos(ang)*(halfW+offPx), y:sy(p.y)-Math.sin(ang)*(halfW+offPx) });
      }
      ctx.beginPath();
      out.forEach((pt,i) => i===0 ? ctx.moveTo(pt.x,pt.y) : ctx.lineTo(pt.x,pt.y));
      for (let i=inn.length-1; i>=0; i--) ctx.lineTo(inn[i].x,inn[i].y);
      ctx.closePath();
    };

    // Outer grass/spectator area
    buildBand(ctx,18);
    ctx.fillStyle = cond==="snow" ? "rgba(190,200,210,0.08)" : "rgba(40,65,28,0.25)"; ctx.fill();
    // Grass/runoff
    buildBand(ctx,12);
    ctx.fillStyle = cond==="snow" ? "rgba(200,210,220,0.15)" : "rgba(58,88,38,0.35)"; ctx.fill();
    // Gravel trap
    buildBand(ctx,7);
    ctx.fillStyle = cond==="snow" ? "rgba(180,185,190,0.10)" : "rgba(140,120,80,0.15)"; ctx.fill();
    // Soft shoulder
    buildBand(ctx,4);
    ctx.fillStyle = "rgba(76,125,48,0.18)"; ctx.fill();
    // Tarmac outer edge
    buildBand(ctx,2);
    ctx.fillStyle = cond==="rain"?"#222018":cond==="snow"?"#2e303e":cond==="night"?"#151210":"#282620"; ctx.fill();
    // Tarmac inner (slightly lighter)
    buildBand(ctx,0);
    ctx.fillStyle = cond==="rain"?"#2c2a24":cond==="snow"?"#3e4055":cond==="night"?"#1e1c18":"#352e28"; ctx.fill();

    // Rubber-darkened corners (racing line deposits)
    for (let i = 0; i < STEPS; i++) {
      const f = i / STEPS;
      const curv = getCurvature(track, f);
      if (curv > 0.05) {
        const p = track.getPoint(f);
        const darkness = Math.min(0.12, (curv - 0.05) * 0.8);
        ctx.fillStyle = `rgba(0,0,0,${darkness})`;
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), halfW * 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Centre dashes
    ctx.setLineDash([8,16]); ctx.beginPath();
    for (let i=0; i<=STEPS; i++) {
      const p=track.getPoint(i/STEPS); i===0?ctx.moveTo(sx(p.x),sy(p.y)):ctx.lineTo(sx(p.x),sy(p.y));
    }
    ctx.strokeStyle="rgba(255,255,255,0.07)"; ctx.lineWidth=1; ctx.stroke(); ctx.setLineDash([]);

    // Edge lines
    for (let edge=-1; edge<=1; edge+=2) {
      ctx.beginPath();
      for (let i=0; i<=STEPS; i++) {
        const f=i/STEPS, p=track.getPoint(f), p2=track.getPoint((f+0.003)%1);
        const ang=Math.atan2(sy(p2.y)-sy(p.y),sx(p2.x)-sx(p.x))+Math.PI/2;
        const ex=sx(p.x)+Math.cos(ang)*halfW*edge, ey=sy(p.y)+Math.sin(ang)*halfW*edge;
        i===0?ctx.moveTo(ex,ey):ctx.lineTo(ex,ey);
      }
      ctx.strokeStyle="rgba(255,255,255,0.18)"; ctx.lineWidth=1.2; ctx.stroke();
    }

    // Kerbs (corner-aware: rectangles at corners, dots on straights)
    for (let edge=-1; edge<=1; edge+=2) {
      for (let i=0; i<120; i++) {
        const f=i/120, p=track.getPoint(f), pn=track.getPoint((f+0.003)%1);
        const ang=Math.atan2(pn.y-p.y,pn.x-p.x)+Math.PI/2;
        const c = getCurvature(track, f);
        const isCorner = c > 0.04;
        const kx=sx(p.x)+Math.cos(ang)*(halfW+2)*edge, ky=sy(p.y)+Math.sin(ang)*(halfW+2)*edge;
        if (isCorner) {
          const ka = Math.atan2(pn.y-p.y, pn.x-p.x);
          ctx.save(); ctx.translate(kx, ky); ctx.rotate(ka);
          ctx.fillStyle = i%2===0 ? "rgba(220,38,38,0.55)" : "rgba(255,255,255,0.45)";
          ctx.fillRect(-3, -2, 6, 4);
          ctx.restore();
        } else {
          ctx.fillStyle = i%2===0 ? "rgba(220,38,38,0.30)" : "rgba(255,255,255,0.18)";
          ctx.beginPath(); ctx.arc(kx,ky,1.8,0,Math.PI*2); ctx.fill();
        }
      }
    }

    // Corner apex markers (inside edge, at tightest points)
    let prevCurv = 0, inApex = false;
    for (let i = 0; i < STEPS; i++) {
      const f = i / STEPS;
      const curv = getCurvature(track, f);
      if (curv > 0.08 && curv > prevCurv && !inApex) {
        inApex = true;
      } else if (inApex && curv < prevCurv) {
        inApex = false;
        const p = track.getPoint(f), pn = track.getPoint((f + 0.003) % 1);
        const ang = Math.atan2(pn.y - p.y, pn.x - p.x) + Math.PI / 2;
        const ax = sx(p.x) - Math.cos(ang) * (halfW + 4);
        const ay = sy(p.y) - Math.sin(ang) * (halfW + 4);
        ctx.fillStyle = "rgba(255,200,50,0.35)";
        ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();
      }
      prevCurv = curv;
    }

    // Pit wall (between track and pit lane)
    {
      const pitSide = track.pitSide || -1;
      const wallSteps = 80;
      const rS = track.pitEntry - 0.02, rE = track.pitExit + 0.02;
      ctx.beginPath();
      for (let i = 0; i <= wallSteps; i++) {
        const frac = i / wallSteps;
        const f = ((rS + (rE - rS) * frac) % 1 + 1) % 1;
        const p = track.getPoint(f), pn = track.getPoint((f + 0.004) % 1);
        const ang = Math.atan2(pn.y - p.y, pn.x - p.x) + Math.PI / 2;
        const wx = sx(p.x) + Math.cos(ang) * (halfW + 3) * pitSide;
        const wy = sy(p.y) + Math.sin(ang) * (halfW + 3) * pitSide;
        i === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
      }
      ctx.strokeStyle = "rgba(180,180,180,0.25)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ── Snow track accumulation pass (needs STEPS/halfW — called here after tarmac) ──
    _drawSnowTrackAccum();

    // ── SKID MARKS on tarmac ──
    SKIDS.draw(ctx);

    // ── PIT LANE ──
    {
      const pSteps = 60, pOff = track.pitOffset||24;
      // Surface
      ctx.strokeStyle = "rgba(42,40,34,0.84)";
      ctx.lineWidth   = Math.max(6, pOff*0.36);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i=0; i<=pSteps; i++) {
        const pt = getPitLanePoint(track, i/pSteps);
        i===0 ? ctx.moveTo(sx(pt.x),sy(pt.y)) : ctx.lineTo(sx(pt.x),sy(pt.y));
      }
      ctx.stroke();

      // Pit lane edge lines
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 0.8;
      const rStart = track.pitEntry-0.025, rEnd = track.pitExit+0.025;
      for (let e=-1; e<=1; e+=2) {
        ctx.beginPath();
        for (let i=0; i<=pSteps; i++) {
          const frac=i/pSteps, f0=rStart+(rEnd-rStart)*frac, f=((f0%1)+1)%1;
          const pp=track.getPoint(f), pp2=track.getPoint(((f+0.004)%1+1)%1);
          const ang=Math.atan2(pp2.y-pp.y,pp2.x-pp.x)+Math.PI/2;
          const BLEND=0.10, blend=frac<BLEND?(frac/BLEND)**2:frac>1-BLEND?((1-frac)/BLEND)**2:1;
          const d=blend*pOff*(track.pitSide||-1)+e*4;
          const ox=sx(pp.x)+Math.cos(ang)*d, oy=sy(pp.y)+Math.sin(ang)*d;
          i===0?ctx.moveTo(ox,oy):ctx.lineTo(ox,oy);
        }
        ctx.stroke();
      }

      // Team pit boxes
      const bcols=["#d4af37","#dc2626","#3b82f6","#16a34a","#9333ea","#f97316"];
      for (let b=0; b<6; b++) {
        const bF=0.15+0.70*((b+0.5)/6), pt=getPitLanePoint(track,bF), pt2=getPitLanePoint(track,bF+0.03);
        const bA=Math.atan2(sy(pt2.y)-sy(pt.y),sx(pt2.x)-sx(pt.x))+Math.PI/2;
        ctx.globalAlpha=0.36; ctx.fillStyle=bcols[b%bcols.length];
        ctx.save(); ctx.translate(sx(pt.x)+Math.cos(bA)*8,sy(pt.y)+Math.sin(bA)*8);
        ctx.fillRect(-3,-2,6,4); ctx.restore();
      }
      ctx.globalAlpha=1;

      // Speed limit dashes
      [0.04,0.96].forEach(frac => {
        const pt=getPitLanePoint(track,frac), pt2=getPitLanePoint(track,Math.min(1,frac+0.04));
        const a=Math.atan2(sy(pt2.y)-sy(pt.y),sx(pt2.x)-sx(pt.x))+Math.PI/2;
        ctx.strokeStyle="rgba(255,200,0,0.38)"; ctx.lineWidth=1.5; ctx.setLineDash([3,3]);
        ctx.beginPath();
        ctx.moveTo(sx(pt.x)+Math.cos(a)*-6, sy(pt.y)+Math.sin(a)*-6);
        ctx.lineTo(sx(pt.x)+Math.cos(a)*6,  sy(pt.y)+Math.sin(a)*6);
        ctx.stroke(); ctx.setLineDash([]);
      });

      // PIT LANE label
      const mid = getPitLanePoint(track,0.5);
      ctx.globalAlpha=0.28; ctx.fillStyle="#c9a460"; ctx.font="bold 6px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("PIT LANE", sx(mid.x), sy(mid.y)+3); ctx.globalAlpha=1;

      // IN / OUT markers
      const inP=getPitLanePoint(track,0.0), outP=getPitLanePoint(track,1.0);
      ctx.fillStyle="rgba(232,200,112,0.85)"; ctx.beginPath(); ctx.arc(sx(inP.x),sy(inP.y),5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="rgba(232,200,112,0.95)"; ctx.font="bold 7px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("IN", sx(inP.x), sy(inP.y)-10);
      ctx.fillStyle="rgba(232,200,112,0.65)"; ctx.beginPath(); ctx.arc(sx(outP.x),sy(outP.y),5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="rgba(232,200,112,0.80)"; ctx.font="bold 7px Cinzel,serif";
      ctx.fillText("OUT", sx(outP.x), sy(outP.y)-10);
    }

    // ── S/F Line ──
    const sfP = track.getPoint(track.sfLine), sfP2 = track.getPoint(track.sfLine+0.005);
    const sfA = Math.atan2(sy(sfP2.y)-sy(sfP.y), sx(sfP2.x)-sx(sfP.x)) + Math.PI/2;
    ctx.save(); ctx.translate(sx(sfP.x),sy(sfP.y)); ctx.rotate(sfA);
    for (let i=0; i<5; i++) { ctx.fillStyle=i%2===0?"#fff":"#111"; ctx.fillRect(-13+i*5.2,-6,5.2,12); }
    ctx.restore();
    ctx.fillStyle="rgba(232,200,112,0.9)"; ctx.font="bold 7px Cinzel,serif"; ctx.textAlign="center";
    ctx.fillText("S/F", sx(sfP.x), sy(sfP.y)-11);

    // ── Sector markers ──
    [0, 0.333, 0.666].forEach((sF, si) => {
      const sp=track.getPoint(sF), sp2=track.getPoint((sF+0.005)%1);
      const sA=Math.atan2(sp2.y-sp.y,sp2.x-sp.x)+Math.PI/2;
      const fx=sx(sp.x)+Math.cos(sA)*-18, fy=sy(sp.y)+Math.sin(sA)*-18;
      ctx.save();
      ctx.strokeStyle="rgba(180,160,120,0.3)"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(fx,fy); ctx.lineTo(fx,fy-10); ctx.stroke();
      ctx.fillStyle=["rgba(220,180,60,0.4)","rgba(60,180,220,0.4)","rgba(220,60,60,0.4)"][si];
      ctx.beginPath(); ctx.moveTo(fx,fy-10); ctx.lineTo(fx+7,fy-8); ctx.lineTo(fx,fy-6); ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    // ── Safety car banner ──
    const sc = stateRef.current?.safetyCar;
    if (sc?.active && nowSec < sc.endsAtSec) {
      ctx.fillStyle="rgba(255,200,0,0.06)"; ctx.fillRect(0,0,W,H);
      ctx.fillStyle="rgba(255,200,0,0.42)"; ctx.font="bold 10px Cinzel,serif"; ctx.textAlign="center";
      ctx.fillText("SAFETY CAR",W/2,18);
    }

    // (Finish-line radial flash removed — large arcs at S/F read as a “zone” and cluttered the line.)

    // ── Track decorations ──
    if (track.drawExtra) track.drawExtra(ctx, sx, sy);

    // ── Cars ──
    if (!racerArr?.length) return;
    const drawOrder = [...racerArr].reverse();
    const trkPos = drawOrder.map(r => r.inPit ? -1 : ((((r.totalLapsDone??0)+r.trackPos)%1)+1)%1);

    drawOrder.forEach((r, di) => {
      if (!r.visible) return;
      const prog = (r.totalLapsDone??0) + r.trackPos;
      let px, py, angle;

      if (r.inPit) {
        const dur  = r.pitDurationSeconds || 3.2;
        const pprog = r.pitEndAt ? Math.max(0,Math.min(1,1-(r.pitEndAt-nowSec)/dur)) : 0.5;
        let pf = pprog<0.2?(pprog/0.2)*0.4 : pprog>0.8?0.6+((pprog-0.8)/0.2)*0.4 : 0.4+((pprog-0.2)/0.6)*0.2;
        const pp=getPitLanePoint(track,pf), pp2=getPitLanePoint(track,Math.min(1,pf+0.02));
        px=sx(pp.x); py=sy(pp.y); angle=Math.atan2(sy(pp2.y)-sy(pp.y),sx(pp2.x)-sx(pp.x));
      } else {
        const tRaw=((prog%1)+1)%1, t=(tRaw+0.006*di)%1;
        const p=track.getPoint(t), p2=track.getPoint((t+0.006)%1);
        angle=Math.atan2(sy(p2.y)-sy(p.y), sx(p2.x)-sx(p.x));
        let latOff = 0;
        const myPos = trkPos[di];
        if (!(r.slideOffUntil>0&&nowSec<r.slideOffUntil)) {
          trkPos.forEach((op,oi) => { if (oi!==di&&op>=0&&Math.abs(op-myPos)<0.02) latOff=((di%3)-1)*(halfW*0.60); });
        }
        const offs = (r.slideOffUntil>0&&nowSec<r.slideOffUntil) ? (halfW+9) : latOff;
        px = sx(p.x)+Math.cos(angle+Math.PI/2)*offs;
        py = sy(p.y)+Math.sin(angle+Math.PI/2)*offs;
      }

      const tt = r.inPit ? ((track.pitEntry+track.pitExit)/2) : ((prog%1)+1)%1;
      const curv = getCurvature(track, r.inPit?0:tt);

      // ── Live SKID MARKS ──
      if (!r.inPit && !r.dnf) {
        // Braking skids in corners
        if (curv > 0.065 && (r.currentSpeedMph||0) > 35) {
          const bI = Math.min(1, (curv-0.065)/0.14);
          const tGrip = tyreGripFromWear(r.tyreWear, r.currentTyre) * ((TYRE_DEFS[r.currentTyre]||TYRE_DEFS.medium).gripMult);
          const chance = bI * (1.0 - Math.min(1, tGrip)) * 0.38;
          if (Math.random() < chance) {
            SKIDS.add(px+Math.cos(angle+Math.PI/2)*3,  py+Math.sin(angle+Math.PI/2)*3,  angle, bI);
            SKIDS.add(px-Math.cos(angle+Math.PI/2)*3,  py-Math.sin(angle+Math.PI/2)*3,  angle, bI);
          }
        }
        // Slide skids
        if (r.slideOffUntil>0 && nowSec<r.slideOffUntil && Math.random()<0.45) {
          SKIDS.add(px+Math.cos(angle)*2, py+Math.sin(angle)*2, angle+0.3, 0.85);
          SKIDS.add(px-Math.cos(angle)*2, py-Math.sin(angle)*2, angle-0.3, 0.85);
        }
        // Tire smoke at braking zones
        if (curv > 0.08 && (r.currentSpeedMph||0) > 40) {
          const smokeI = Math.min(1, (curv - 0.08) / 0.15);
          if (Math.random() < smokeI * 0.3) addTireSmoke(px - Math.cos(angle)*6, py - Math.sin(angle)*6, smokeI);
        }
        // Slide smoke
        if (r.slideOffUntil>0 && nowSec<r.slideOffUntil) {
          addTireSmoke(px, py, 0.8);
        }
      }

      // Exhaust trail
      if (!r.inPit && !(r.slideOffUntil>0&&nowSec<r.slideOffUntil)) {
        const td2 = TYRE_DEFS[r.currentTyre]||TYRE_DEFS.medium;
        for (let ei=1; ei<=6; ei++) {
          const et=((tt-0.004*ei)%1+1)%1, ep=track.getPoint(et);
          const a=0.25-ei*0.035;
          if (a>0) { ctx.fillStyle=td2.color; ctx.globalAlpha=a; ctx.beginPath(); ctx.arc(sx(ep.x),sy(ep.y),2.5-ei*0.3,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; }
        }
        // ── Snow/cold weather: exhaust steam puffs ──
        if (cond==="snow"||cond==="rain") {
          for (let ei=1; ei<=5; ei++) {
            const et=((tt-0.006*ei)%1+1)%1, ep=track.getPoint(et);
            const age=ei/5, steamA=cond==="snow"?0.18*(1-age*0.6):0.10*(1-age*0.6);
            const steamR=2.5+ei*1.8;
            const drift=Math.sin(nowSec*2+ei*1.3)*2*age;
            ctx.fillStyle=cond==="snow"?"rgba(220,230,248,1)":"rgba(180,200,230,1)";
            ctx.globalAlpha=steamA;
            ctx.beginPath();
            ctx.arc(sx(ep.x)+drift,sy(ep.y)-steamR*0.6,steamR,0,Math.PI*2);
            ctx.fill();
            ctx.globalAlpha=1;
          }
        }
      }

      // Slipstream glow
      if (r.inSlipstream && !r.inPit) {
        ctx.save(); ctx.globalAlpha=0.16;
        for (let si=1; si<=4; si++) {
          const st=((tt-0.006*si)%1+1)%1, sp=track.getPoint(st);
          ctx.fillStyle="#80c0ff"; ctx.beginPath(); ctx.arc(sx(sp.x),sy(sp.y),3+si*0.5,0,Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }

      // Overtaking sparks
      if (r.inSlipstream && !r.inPit && nowSec < (r.overtakeBoostUntil||0) && Math.random() < 0.4) {
        addSparks(px - Math.cos(angle)*5, py - Math.sin(angle)*5);
      }

      // Speed glow
      const clr = r.color||"#888";
      const grd = ctx.createRadialGradient(px,py,0,px,py,22);
      grd.addColorStop(0,clr+"55"); grd.addColorStop(1,clr+"00");
      ctx.fillStyle=grd; ctx.fillRect(px-22,py-22,44,44);

      // Shadow (angle-aware ellipse)
      ctx.save(); ctx.translate(px+2, py+3); ctx.rotate(angle); ctx.scale(CAR_SCALE,CAR_SCALE);
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 4.5, 0, 0, Math.PI*2);
      ctx.fillStyle="rgba(0,0,0,0.25)"; ctx.fill(); ctx.restore();

      // Brake glow (red lights rear)
      if (curv>0.06 && !r.inPit && !r.dnf) {
        const bi = Math.min(1,(curv-0.06)/0.12);
        ctx.save(); ctx.translate(px,py); ctx.rotate(angle); ctx.scale(CAR_SCALE,CAR_SCALE);
        ctx.fillStyle=`rgba(255,28,18,${0.3+bi*0.55})`;
        ctx.beginPath(); ctx.arc(-12,-3,2.5,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-12,3,2.5,0,Math.PI*2);  ctx.fill();
        ctx.restore();
      }

      // Car body — detailed F1 top-down
      ctx.save(); ctx.translate(px,py); ctx.rotate(angle); ctx.scale(CAR_SCALE,CAR_SCALE);
      const carClr = r.color||"#888";

      // Rear diffuser
      ctx.fillStyle = "rgba(30,30,30,0.8)";
      ctx.fillRect(-14, -5.5, 3, 11);

      // Rear wing endplates
      ctx.fillStyle = carClr;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(-13, -6, 2.5, 1.5);
      ctx.fillRect(-13, 4.5, 2.5, 1.5);
      ctx.globalAlpha = 1;

      // Rear wing DRS element
      ctx.fillStyle = carClr;
      ctx.globalAlpha = 0.65;
      ctx.fillRect(-13, -5.5, 2, 11);
      ctx.globalAlpha = 1;

      // Main body
      ctx.beginPath();
      ctx.moveTo(-11, -4.5);
      ctx.lineTo(6, -4.5);
      ctx.quadraticCurveTo(10, -4.5, 12, -2);
      ctx.quadraticCurveTo(13, 0, 12, 2);
      ctx.quadraticCurveTo(10, 4.5, 6, 4.5);
      ctx.lineTo(-11, 4.5);
      ctx.lineTo(-13, 0);
      ctx.closePath();
      ctx.fillStyle = carClr;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Sidepods
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(-6, -4.5, 10, 1.8);
      ctx.fillRect(-6, 2.7, 10, 1.8);

      // Cockpit opening
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.ellipse(1, 0, 3.5, 2.5, 0, 0, Math.PI*2);
      ctx.fill();

      // Halo device
      ctx.strokeStyle = "rgba(120,120,120,0.7)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-1, -2);
      ctx.quadraticCurveTo(4, -1, 4, 0);
      ctx.quadraticCurveTo(4, 1, -1, 2);
      ctx.stroke();

      // Driver helmet
      ctx.fillStyle = r.isPlayer ? "#e8c870" : "rgba(200,200,200,0.7)";
      ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI*2); ctx.fill();

      // Front wing
      ctx.fillStyle = carClr;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(11, -6, 2.5, 12);
      ctx.globalAlpha = 1;

      // Front wing endplates
      ctx.fillStyle = carClr;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(11.5, -7, 1.5, 1.5);
      ctx.fillRect(11.5, 5.5, 1.5, 1.5);
      ctx.globalAlpha = 1;

      // Front nose cone
      ctx.fillStyle = carClr;
      ctx.beginPath();
      ctx.moveTo(12, -1.5);
      ctx.lineTo(15, 0);
      ctx.lineTo(12, 1.5);
      ctx.closePath();
      ctx.fill();

      // Side mirrors
      ctx.fillStyle = "rgba(100,100,100,0.8)";
      ctx.beginPath(); ctx.arc(4, -5, 1, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, 5, 1, 0, Math.PI*2); ctx.fill();

      // Team stripe
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(-8, -4.5, 14, 1.2);

      // Front wheel fairings
      ctx.fillStyle = "rgba(20,20,20,0.6)";
      ctx.fillRect(7, -6.5, 3, 2);
      ctx.fillRect(7, 4.5, 3, 2);

      // Rear wheel fairings
      ctx.fillRect(-9, -6.5, 3, 2);
      ctx.fillRect(-9, 4.5, 3, 2);

      // Number on sidepod
      ctx.fillStyle = "#fff";
      ctx.font = "bold 5px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(r.carNumber!=null?r.carNumber:(di+1)).slice(0,2), -4, 0);
      ctx.textBaseline = "alphabetic";

      // Windshield glint
      ctx.fillStyle = "rgba(180,200,220,0.2)";
      ctx.beginPath(); ctx.ellipse(3, -1, 2, 1.2, 0.3, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // Exhaust flame (high push level or in slipstream)
      if (!r.dnf && !r.inPit && (r.pushLevel >= 4 || r.inSlipstream)) {
        ctx.save(); ctx.translate(px,py); ctx.rotate(angle); ctx.scale(CAR_SCALE,CAR_SCALE);
        const fl = 0.5 + 0.5 * Math.sin(nowSec * 12);
        const fLen = r.pushLevel >= 5 ? 8 : 5;
        const fg = ctx.createRadialGradient(-14, 0, 1, -14 - fLen, 0, fLen);
        fg.addColorStop(0, `rgba(255,160,30,${0.4 + fl * 0.3})`);
        fg.addColorStop(0.5, `rgba(255,80,0,${0.2 + fl * 0.15})`);
        fg.addColorStop(1, "rgba(255,40,0,0)");
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.ellipse(-14 - fLen/2, 0, fLen, 2.5, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }

      // Rain spray trail
      if ((cond==="rain"||cond==="snow") && !r.dnf && !r.inPit && r.currentSpeedMph > 30) {
        ctx.save(); ctx.translate(px,py); ctx.rotate(angle); ctx.scale(CAR_SCALE,CAR_SCALE);
        const sprayIntensity = Math.min(1, (r.currentSpeedMph - 30) / 120);
        for (let si = 0; si < 4; si++) {
          const sx2 = -16 - si * 4 + (Math.sin(nowSec * 6 + si) * 2);
          const sy2 = (Math.sin(nowSec * 8 + si * 1.5) * 3);
          ctx.fillStyle = `rgba(180,200,220,${0.08 + sprayIntensity * 0.12})`;
          ctx.beginPath(); ctx.arc(sx2, sy2, 2 + si * 1.5, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }

      // Night headlights
      if (cond==="night" && !r.inPit && !r.dnf) {
        ctx.save(); ctx.translate(px,py); ctx.rotate(angle); ctx.scale(CAR_SCALE,CAR_SCALE);
        const hl=ctx.createRadialGradient(13,0,0,25,0,30);
        hl.addColorStop(0,"rgba(255,240,180,0.20)"); hl.addColorStop(1,"rgba(255,240,180,0)");
        ctx.fillStyle=hl; ctx.beginPath(); ctx.moveTo(11,0); ctx.arc(11,0,30,-0.36,0.36); ctx.closePath(); ctx.fill();
        ctx.fillStyle="rgba(255,240,180,0.65)";
        ctx.beginPath(); ctx.arc(11,-3,1.5,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(11,3,1.5,0,Math.PI*2);  ctx.fill();
        ctx.restore();
      }

      // Car number badge
      const dn = r.carNumber != null ? r.carNumber : (di+1);
      ctx.save(); ctx.translate(px,py); ctx.scale(CAR_SCALE,CAR_SCALE);
      ctx.fillStyle = r.isPlayer ? "#e8c870" : r.color;
      ctx.beginPath(); ctx.arc(0,-13,7,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = r.isPlayer ? "#0a0c06" : "rgba(0,0,0,0.6)"; ctx.lineWidth=1.2; ctx.stroke();
      ctx.fillStyle = r.isPlayer ? "#0a0c06" : "#fff";
      ctx.font="bold 7px Rajdhani,sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(String(dn),0,-13); ctx.textBaseline="alphabetic"; ctx.restore();

      // Tyre dot + blister
      const td3 = TYRE_DEFS[r.currentTyre]||TYRE_DEFS.medium;
      ctx.save(); ctx.translate(px,py); ctx.scale(CAR_SCALE,CAR_SCALE);
      if (r.tyreBlister) {
        const pulse=0.5+0.5*Math.sin(nowSec*8);
        ctx.fillStyle=`rgba(231,76,60,${0.5+pulse*0.5})`;
        ctx.beginPath(); ctx.arc(11,-6,5,0,Math.PI*2); ctx.fill();
      }
      ctx.fillStyle=td3.color; ctx.beginPath(); ctx.arc(11,-6,4,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle="rgba(0,0,0,0.5)"; ctx.lineWidth=0.8; ctx.stroke();
      ctx.restore();

      // Engine smoke (pre-DNF)
      if (!r.dnf && r.engineHealth!=null && r.engineHealth<40 && !r.inPit) {
        const sa=Math.max(0,(40-r.engineHealth)/40)*0.36;
        for (let si=0; si<3; si++) {
          const sAge=(nowSec*1.5+si*0.5)%2;
          ctx.fillStyle=`rgba(78,78,78,${sa*(1-sAge/2)})`;
          ctx.beginPath(); ctx.arc(px-Math.cos(angle)*8+(Math.sin(nowSec*3+si)*3),py-Math.sin(angle)*8-sAge*12,3+sAge*4,0,Math.PI*2); ctx.fill();
        }
      }

      // DNF sparks + fire
      if (r.dnf && r.dnfSparks?.length) {
        const age = nowSec-(r.dnfAtSec||nowSec);
        if (age < 8) {
          for (let si=0; si<5; si++) {
            const sA=(age*0.8+si*0.4)%3, sAl=Math.max(0,0.3*(1-sA/3)*Math.min(1,(8-age)/2));
            ctx.fillStyle=`rgba(60,60,60,${sAl})`; ctx.beginPath(); ctx.arc(px+(Math.sin(nowSec*2+si)*5),py-sA*18-5,4+sA*6,0,Math.PI*2); ctx.fill();
          }
          if (age<4) {
            const fg=ctx.createRadialGradient(px,py,2,px,py,15);
            fg.addColorStop(0,`rgba(255,120,0,${Math.max(0,0.25*(1-age/4))})`); fg.addColorStop(1,"rgba(255,80,0,0)");
            ctx.fillStyle=fg; ctx.beginPath(); ctx.arc(px,py,15,0,Math.PI*2); ctx.fill();
          }
        }
        r.dnfSparks.forEach(sp => {
          const a=nowSec-sp.born; if (a>sp.life) return;
          ctx.fillStyle=`rgba(255,${Math.floor(155+Math.random()*80)},28,${1-a/sp.life})`;
          ctx.beginPath(); ctx.arc(px+sp.vx*a,py+sp.vy*a+20*a*a,2*(1-a/sp.life),0,Math.PI*2); ctx.fill();
        });
      }

      // Labels
      if (r.dnf) { ctx.fillStyle="#e74c3c"; ctx.font="bold 8px Cinzel,serif"; ctx.textAlign="center"; ctx.fillText("DNF",px,py+16); }
      else if (r.inPit) { ctx.fillStyle="#ff9800"; ctx.font="bold 8px Cinzel,serif"; ctx.textAlign="center"; ctx.fillText("PIT",px,py+16); }
      else if (r.slideOffUntil>0&&nowSec<r.slideOffUntil) { ctx.fillStyle="#e74c3c"; ctx.font="bold 7px Cinzel,serif"; ctx.textAlign="center"; ctx.fillText("OFF",px,py+16); }
    });

    // ── Particles (tire smoke, sparks) ──
    updateAndDrawParticles(ctx);

    // ── Confetti (race finish celebration) ──
    const ff2 = stateRef.current?.finishFlash || 0;
    if (ff2 > 0) {
      const crossTime = ff2 - 2;
      const elapsed = (nowSec - crossTime) * 1000;
      if (elapsed >= 0 && elapsed < 5000) {
        drawConfetti(ctx, W, H, elapsed);
      }
    }

    // Incident log
    const log = stateRef.current?.incidents;
    if (log?.length) {
      ctx.save();
      log.slice(-4).forEach((e,i) => {
        const age=(performance.now()-e.time)/1000, a=Math.max(0,1-age/10); if(a<=0)return;
        ctx.globalAlpha=a*0.86; ctx.fillStyle="#111"; ctx.font="bold 13px Rajdhani,sans-serif"; ctx.textAlign="left";
        const yP=H-34-i*18, tW=ctx.measureText(e.text).width;
        ctx.fillRect(4,yP-12,tW+10,16); ctx.globalAlpha=a*0.96; ctx.fillStyle="#e8c870"; ctx.fillText(e.text,9,yP);
      });
      ctx.restore();
    }

    // ── Snow foreground pass — large close flakes on top of everything ──
    if (cond === "snow") {
      const t2=Date.now();
      // Very large slow close-up flakes for depth parallax
      ctx.save();
      for(let i=0;i<6;i++){
        const drift=Math.sin(t2*0.0004+i*2.1)*55+Math.cos(t2*0.0006+i)*20;
        const x=((i*201+t2*0.005+drift)%(W+120))-60;
        const y=((i*157+t2*0.007)%H);
        const sway=Math.sin(t2*0.0009+i*1.7)*8;
        const r2=7+Math.sin(i*1.3)*1.5;
        ctx.globalAlpha=0.14+Math.sin(i*2.2)*0.04;
        ctx.strokeStyle="rgba(230,240,255,1)"; ctx.lineWidth=1.0;
        ctx.save(); ctx.translate(x+sway,y);
        for(let arm=0;arm<6;arm++){
          ctx.save(); ctx.rotate((arm/6)*Math.PI*2);
          ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-r2);
          const b1=r2*0.38, b2=r2*0.65;
          ctx.moveTo(0,-b1); ctx.lineTo(r2*0.24,-b1-r2*0.18); ctx.moveTo(0,-b1); ctx.lineTo(-r2*0.24,-b1-r2*0.18);
          ctx.moveTo(0,-b2); ctx.lineTo(r2*0.18,-b2-r2*0.13); ctx.moveTo(0,-b2); ctx.lineTo(-r2*0.18,-b2-r2*0.13);
          ctx.stroke(); ctx.restore();
        }
        ctx.restore();
      }
      ctx.restore();

      // Cold atmosphere vignette
      const vig=ctx.createRadialGradient(W/2,H/2,H*0.3,W/2,H/2,H*0.9);
      vig.addColorStop(0,"rgba(160,185,230,0)");
      vig.addColorStop(1,"rgba(130,155,210,0.14)");
      ctx.fillStyle=vig; ctx.fillRect(0,0,W,H);
    }

  }, [getScale]);

  // ─── BUILD LIVE RACERS ──────────────────────────────────────────────────
  const buildRacers = useCallback((track, cond, nLaps, pTyre) => {
    const wd=WEATHER_DEFS[cond]||WEATHER_DEFS.clear, ww=wd.wearMult||1;
    const pPs=pitDur(playerPitLevel,false), pPe=pitDur(playerPitLevel,true);
    const total=8, pRel=Math.max(0.7,1-playerPitLevel*0.05);
    const racers=[{
      id:"player",name:"You",isPlayer:true,color:CAR_COLORS[0],carName:playerCarName,
      trackPos:total*0.012,lapCount:1,totalLapsDone:0,
      currentTyre:pTyre,tyreWear:100,pitStops:0,inPit:false,pitEndAt:0,
      pitDurationSeconds:pPs,pitDurationEmergencySeconds:pPe,
      baseSpeed:1.0,baseGrip:0.85,reliabilityWearMult:pRel,
      pitStrategy:buildStrategy(pTyre,nLaps,ww,pRel),
      finished:false,finishOrder:0,visible:true,position:1,carNumber:1,lapTimes:[],
      slideOffUntil:0,pitExitUntil:null,engineHealth:100,dnf:false,dnfAtSec:0,dnfSparks:[],
      fuelLoad:100,currentSector:0,lastSectorCross:0,bestSectors:[Infinity,Infinity,Infinity],sectorDelta:null,
      inSlipstream:false,tyreBlister:false,strategyType:"normal",overtakingLevel:0,overtakeBoostUntil:0,currentSpeedMph:null,
    }];
    for (let i=0; i<7; i++) {
      const st=NPC_STATS[i%NPC_STATS.length], t=NPC_TYRES[i] in TYRE_DEFS?NPC_TYRES[i]:"medium";
      const ns=rollStrat(), po=Math.floor(Math.random()*3)-1, nr=0.8+Math.random()*0.2;
      racers.push({
        id:`npc_${i}`,name:NPC_NAMES[i],isPlayer:false,color:CAR_COLORS[i+1],carName:NPC_CARS[i%NPC_CARS.length],
        trackPos:(total-(i+1))*0.012,lapCount:1,totalLapsDone:0,
        currentTyre:t,tyreWear:100,pitStops:0,inPit:false,pitEndAt:0,
        pitDurationSeconds:2.5+Math.random(),pitDurationEmergencySeconds:3.2+Math.random(),
        baseSpeed:st.bs+(Math.random()-0.5)*0.06, baseGrip:st.bg, reliabilityWearMult:nr,
        pitStrategy:buildStrategy(t,nLaps,ww,nr,po,ns),
        finished:false,finishOrder:0,visible:true,position:i+2,carNumber:i+2,lapTimes:[],
        slideOffUntil:0,pitExitUntil:null,engineHealth:100,dnf:false,dnfAtSec:0,dnfSparks:[],
        fuelLoad:100,currentSector:0,lastSectorCross:0,bestSectors:[Infinity,Infinity,Infinity],sectorDelta:null,
        inSlipstream:false,tyreBlister:false,strategyType:ns,
        // FIX B5: overtaking scales with car speed tier
        overtakingLevel:Math.max(0,Math.round((st.bs-0.88)*200)),
        overtakeBoostUntil:0,currentSpeedMph:null,
      });
    }
    return racers;
  }, [playerCarName, playerPitLevel]);

  // ─── RACE LOOP ──────────────────────────────────────────────────────────
  const startRaceLoop = useCallback((track, cond, nLaps, racerArr, options = {}) => {
    const { onQualifyingComplete } = options;
    buildSpeedProfile(track); // warm cache

    let curWd=WEATHER_DEFS[cond]||WEATHER_DEFS.clear, curCond=cond;
    let lastFrame=performance.now(), lastComm=performance.now();
    let commPhase="start", commQ=[...COMMENTARY.start], lastCommLine="", firstFrame=true;
    const sc={active:false,endsAtSec:0,cooldownUntil:0};
    const fl={holderId:null,time:Infinity};
    const incidents=[];
    const addInc=t=>{incidents.push({text:t,time:performance.now()});};
    let weatherChg=null;
    if (nLaps>3 && Math.random()<0.25) {
      const cl=2+Math.floor(Math.random()*(nLaps-3));
      weatherChg={lap:cl,to:Object.keys(WEATHER_DEFS).filter(k=>k!==cond)[Math.floor(Math.random()*4)]};
    }
    let finishFlash=0, nextFO=1;
    stateRef.current={racers:racerArr,track,nLaps,wd:curWd,safetyCar:sc,fastestLap:fl,finishFlash:0,incidents};
    const SM=()=>spMultRef.current||1;
    const lapCrossAllowedAfterSec = nLaps > 1 ? (performance.now() / 1000 + 1.75) : -Infinity;

    const loop = now => {
      try {
        if (pausedRef.current) { lastFrame=now; rafRef.current=requestAnimationFrame(loop); return; }
        let dt=(now-lastFrame)/1000; if(firstFrame){firstFrame=false;dt=0;}
        dt=Math.min(0.05,dt)*SM(); lastFrame=now; const nowSec=now/1000;
        const{racers}=stateRef.current;
        if(lastSave.current===0){lastSave.current=now;saveState();}

        const prevSorted=[...racers].sort((a,b)=>((b.totalLapsDone??0)+(b.trackPos??0))-((a.totalLapsDone??0)+(a.trackPos??0)));
        const prevMap={};prevSorted.forEach((r,i)=>{prevMap[r.id]={idx:i,prog:(r.totalLapsDone??0)+(r.trackPos??0)};});

        const scActive=sc.active&&nowSec<sc.endsAtSec;
        if(sc.active&&nowSec>=sc.endsAtSec){sc.active=false;addInc("Safety car in — green flag");setCommentary(rnd(COMMENTARY.safetyCarEnd));}
        stateRef.current.safetyCar=sc;

        if(weatherChg){const lL=Math.max(0,...racers.map(r=>r.totalLapsDone??0));if(lL>=weatherChg.lap){curWd=WEATHER_DEFS[weatherChg.to]||WEATHER_DEFS.clear;curCond=weatherChg.to;stateRef.current.wd=curWd;addInc(`Weather → ${curWd.label}`);setCommentary(rnd(COMMENTARY.weatherChange));weatherChg=null;}}
        const wd=curWd;

        racers.forEach(r => {
          // Finished cars coast forward for ~2s — avoids dead freeze at SF line (number badge cluster)
          if (r.finished && !r.dnf) {
            const coastDur = 2.2;
            const t0 = r.finishedAtSec != null ? r.finishedAtSec : nowSec;
            const coastAge = nowSec - t0;
            if (coastAge < coastDur) {
              const coastSpeed = Math.max(0, 1 - coastAge / coastDur) * 0.18;
              r.trackPos = (r.trackPos + coastSpeed * dt + 1) % 1;
            }
            return;
          }
          if(r.dnf){if(r.visible&&nowSec>r.dnfAtSec+30)r.visible=false;if(r.visible){r.trackPos=(r.trackPos+0.001+1)%1;r.currentSpeedMph=2;}return;}

          // ── Pit stop in progress ──
          if(r.inPit){
            if(nowSec>=r.pitEndAt){
              r.inPit=false;r.pitStops++;r.fuelLoad=100;r.pitExitUntil=nowSec+2.5;r.trackPos=track.pitExit;
              if(r.pitStrategy.length>0){r.currentTyre=r.pitStrategy[0].nextTyre;r.pitStrategy=r.pitStrategy.slice(1);}
              // FIX B2: only reset tyreWear here at pit exit, never per-frame
              r.tyreWear=100;r.tyreBlister=false;
              if(r.isPlayer){clearTimeout(pitTimer.current);setPitNotif(`Out of pits — ${TYRE_DEFS[r.currentTyre]?.label||r.currentTyre} fitted ✓`);pitTimer.current=setTimeout(()=>setPitNotif(null),2500);}
            }
            r.currentSpeedMph=r.currentSpeedMph!=null?r.currentSpeedMph+(5-r.currentSpeedMph)*Math.min(1,dt*4):5;
            return;
          }

          // Engine decay
          if(r.engineHealth!=null&&r.engineHealth<100)r.engineHealth=Math.max(0,r.engineHealth-dt*0.08);
          if(r.engineHealth!=null&&r.engineHealth>0&&Math.random()<dt*0.002)r.engineHealth=Math.max(0,r.engineHealth-(1+Math.random()*2));
          if(r.engineHealth!=null&&r.engineHealth<=0&&!r.dnf){
            r.dnf=true;r.dnfAtSec=nowSec;r.finished=true;
            r.dnfSparks=Array.from({length:10},()=>({x:0,y:0,vx:(Math.random()-0.5)*60,vy:(Math.random()-0.5)*60,life:0.8+Math.random()*0.7,born:nowSec}));
            addInc(`${r.name} — DNF (mechanical)`);if(r.isPlayer)setPitNotif("ENGINE FAILURE — Race over!");
            if(!scActive&&nowSec>sc.cooldownUntil&&Math.random()<0.4&&nLaps>1){sc.active=true;sc.endsAtSec=nowSec+8+Math.random()*4;sc.cooldownUntil=sc.endsAtSec+10;addInc("Safety car deployed!");setCommentary(rnd(COMMENTARY.safetyCar));}
            return;
          }

          // Pit exit slow zone
          let pxMul=1.0;
          if(r.pitExitUntil!=null&&nowSec<r.pitExitUntil)pxMul=Math.min(1,0.5+0.5*(2.5-(r.pitExitUntil-nowSec))/2.5);
          if(r.pitExitUntil!=null&&nowSec>=r.pitExitUntil)r.pitExitUntil=null;

          // F1 Clash–style tyre cliff model
          const td=TYRE_DEFS[r.currentTyre]||TYRE_DEFS.medium;
          const tyreGripFactor=tyreGripFromWear(r.tyreWear,r.currentTyre);
          const effGrip=(r.baseGrip||0.85)*tyreGripFactor*(wd.gripMult||1);
          const fuelW=1.0+0.03*((r.fuelLoad??100)/100);

          let effSpeed=(r.baseSpeed*td.gripMult*wd.speedMult*tyreGripFactor*pxMul)/fuelW;

          // Rubber-banding
          const myP=prevMap[r.id], lP=prevSorted[0]?(prevSorted[0].totalLapsDone??0)+(prevSorted[0].trackPos??0):0;
          const gapLdr=lP-((myP?.prog)??0);
          if(gapLdr>0.15&&!scActive)effSpeed*=1+Math.min(0.08,gapLdr*0.25);

          // Slipstream + overtake
          // Slipstream: within 0.016 lap-fraction (~1.6%) of car ahead = drafting range
          // Overtake boost: within 0.022 lap-fraction (~2.2%) = very close, fighting for position
          r.inSlipstream=false;
          if(myP&&myP.idx>0){
            const ahP=(prevSorted[myP.idx-1].totalLapsDone??0)+(prevSorted[myP.idx-1].trackPos??0);
            const sl=ahP-((myP.prog)??0);
            if(sl>0&&sl<0.016&&!scActive){effSpeed*=1.045;r.inSlipstream=true;}
            if(sl>0&&sl<=0.022&&!scActive&&Math.random()<dt*0.7*((r.overtakingLevel||0)/100)+dt*0.05)r.overtakeBoostUntil=nowSec+0.4;
          }
          if(nowSec<(r.overtakeBoostUntil||0))effSpeed*=1.04;
          if(scActive)effSpeed=Math.min(effSpeed,0.35*r.baseSpeed);

          // Engine push/save modes
          const isLast2=r.totalLapsDone>=nLaps-2;
          if(isLast2)effSpeed*=1.03;
          else if(myP&&myP.idx===0){const s2P=prevSorted[1]?(prevSorted[1].totalLapsDone??0)+(prevSorted[1].trackPos??0):0;if((myP.prog??0)-s2P>0.08)effSpeed*=0.98;}

          // Physics corner profile (pre-computed, sfLine-aware)
          const trackT=((r.trackPos%1)+1)%1;
          const profile=buildSpeedProfile(track);
          const pidx=Math.round(trackT*(PROFILE_N-1));
          const curvature=getCurvature(track,trackT);

          // Corner speed multiplier: profile drives the base, then grip modulates it.
          // High curvature = must slow down; grip determines how slow.
          // cornerGripMult gives the grip-based limit; profile gives the geometry limit.
          // Take the more conservative (minimum) of the two so physics are consistent.
          const inSF = inStartFinishSafeZone(track, trackT);
          const inSFRelax = inStartFinishCornerRelaxZone(track, trackT);
          const gripBasedMult = cornerGripMult(curvature, effGrip);
          const profileMult   = Math.max(0.50, Math.min(1.0, profile[pidx] + (effGrip-0.85)*0.55));
          // On the start/finish straight, ignore grip/curvature cap — it caused visible lift-off before the line
          let cornerSM = inSF
            ? Math.min(1, Math.max(profileMult, 0.998))
            : Math.min(profileMult, gripBasedMult);

          // Curvature-aware brake/accel rates — sharper on straights, gentler in tight corners
          // In real cars: brake distance is short (0.2-0.4s), accel ramp is longer (0.5-1.2s)
          const effCurvSlide = inSF ? 0 : curvature;
          const isTightCorner = !inSFRelax && curvature > 0.12;
          const isMedCorner   = !inSFRelax && curvature > 0.055;
          // ABRAKE: how fast we reach the corner speed target. Higher = more instant.
          // At 60fps dt≈0.016: ABRAKE=5 → ~50% correction per frame = sharp, realistic braking
          const ABRAKE = isTightCorner ? 6.5 : isMedCorner ? 5.0 : 4.0;
          // AACCEL: how fast we reach full speed again exiting a corner.
          // Real cars: 0-100 takes ~3-4s. At the track scale this means 2-3s ramp.
          const AACCEL = isTightCorner ? 2.2 : isMedCorner ? 2.8 : 3.6;
          const SSCALE=0.170, SCAP=160;
          const applyLerp=(cur,tgt)=>{if(tgt==null)return tgt;if(cur==null)return tgt;const brk=tgt<cur;return cur+(tgt-cur)*Math.min(1,dt*(brk?ABRAKE:AACCEL));};

          // Movement
          const prevPos=r.trackPos;
          if(r.slideOffUntil>0&&nowSec<r.slideOffUntil){
            r.trackPos=(r.trackPos+(1/(track.lapBase/effSpeed))*dt*0.18+1)%1;r.currentSpeedMph=20;
          } else {
            r.slideOffUntil=0;
            const lapTime=track.lapBase/(effSpeed*cornerSM);
            r.trackPos=(r.trackPos+(1/lapTime)*dt+1)%1;
            const rawMph=track.km&&track.lapBase?SSCALE*(3600*track.km*cornerSM*effSpeed)/track.lapBase:null;
            const tMph=rawMph!=null?Math.max(0,Math.min(SCAP,rawMph)):null;
            r.currentSpeedMph=tMph!=null?(r.currentSpeedMph!=null?applyLerp(r.currentSpeedMph,tMph):tMph):null;
            // Slide off — low grip + sharp corner (never in SF safe zone — seam curvature spikes)
            if(!inSF&&effCurvSlide>0.22&&effGrip<0.66&&Math.random()<dt*0.5*(0.66-effGrip)*Math.min(1,effCurvSlide/0.36)){
              r.slideOffUntil=nowSec+0.5+Math.random()*0.65;addInc(`${r.name} off track!`);
              if(!scActive&&nowSec>sc.cooldownUntil&&Math.random()<0.15&&nLaps>1){sc.active=true;sc.endsAtSec=nowSec+6+Math.random()*4;sc.cooldownUntil=sc.endsAtSec+10;addInc("Safety car deployed!");setCommentary(rnd(COMMENTARY.safetyCar));}
            }
          }

          // Sector crossings (use sfLine-relative sectors so they divide the lap evenly from sfLine)
          const sfL = track.sfLine ?? 0;
          const relT = ((trackT - sfL + 1) % 1);
          const ns2 = relT < 0.333 ? 0 : relT < 0.666 ? 1 : 2;
          if(ns2!==r.currentSector){
            const el=nowSec-(r.lastSectorCross||nowSec);
            if(r.lastSectorCross>0&&el>0.5&&r.isPlayer){const delta=el-r.bestSectors[r.currentSector];r.sectorDelta=delta;r.bestSectors[r.currentSector]=Math.min(r.bestSectors[r.currentSector],el);}
            r.currentSector=ns2;r.lastSectorCross=nowSec;
          }

          // Lap crossing: forward arc from prevPos → trackPos crosses sfLine (OK at x4 / big dt)
          const sfL2 = track.sfLine ?? 0;
          const crossedSF = crossedStartFinishLineForward(prevPos, r.trackPos, sfL2);
          const canCountLap = nLaps === 1 || nowSec >= lapCrossAllowedAfterSec;
          if(crossedSF && canCountLap && !(r._justCrossedFrames > 0)){
            r._justCrossedFrames = 4; // FIX: frame counter, no async stutter
            r.totalLapsDone++;r.lapCount=Math.min(nLaps,r.totalLapsDone+1);
            const lt=track.lapBase/(effSpeed*0.97)+(Math.random()-0.5)*0.8;
            r.lapTimes.push(lt);
            if(lt<fl.time){fl.time=lt;fl.holderId=r.id;stateRef.current.fastestLap=fl;addInc(`${r.name} — fastest lap! (${lt.toFixed(2)}s)`);}
            // Sync tyre wear from replay data at lap boundary
            if(r.tireWearByLap&&r.tireWearByLap.length){
              const idx=Math.min(r.totalLapsDone,r.tireWearByLap.length-1);
              const tw=r.tireWearByLap[idx];
              if(!r.inPit&&!(r.tyreWear>92&&tw<20))r.tyreWear=tw;
            }
            if(r.totalLapsDone>=nLaps){r.finished=true;r.finishOrder=nextFO++;r.finishedAtSec=nowSec;r.finishVisibleUntil=nowSec+9999;if(r.finishOrder===1&&nLaps>1){finishFlash=nowSec+2.0;stateRef.current.finishFlash=finishFlash;}}
          } else {
            // FIX: decrement each frame
            if (r._justCrossedFrames > 0) r._justCrossedFrames--;
          }

          // Tyre wear (per-frame, only when no replay data)
          if(!(r.tireWearByLap&&r.tireWearByLap.length)){
            const sl2=stintLaps(r.currentTyre,wd.wearMult,r.reliabilityWearMult);
            const wearPerLap=90/sl2, lapTimeSec=track.lapBase/effSpeed;
            const wearPerSec=lapTimeSec>0?wearPerLap/lapTimeSec:wearPerLap/22;
            r.tyreWear=Math.max(td.minWear,r.tyreWear-wearPerSec*dt);
          }
          r.tyreBlister=r.tyreWear<20;

          // Tyre cliff warning (for HUD)
          r.tyreCliffWarning=r.tyreWear<(td.cliffStart*100+12);

          // Fuel
          if(r.fuelLoad!=null&&nLaps>1){const fps=100/(track.lapBase*nLaps);r.fuelLoad=Math.max(0,r.fuelLoad-fps*dt);if(r.fuelLoad<=0&&!r.dnf){r.dnf=true;r.dnfAtSec=nowSec;r.finished=true;r.dnfSparks=[];addInc(`${r.name} — out of fuel!`);}}

          // Manual pit
          if(r.isPlayer&&!r.inPit&&manPitRef.current){const dist=Math.abs(((r.trackPos-track.pitEntry)+1)%1);if(dist<0.12){r.inPit=true;r.pitEndAt=nowSec+(r.pitDurationSeconds||3.2)+0.5;addInc(`${r.name} — manual pit stop`);setPitNotif("MANUAL PIT — Changing tyres + refuel…");setManPit(false);}}

          // Auto-pit from strategy
          const isLast2b=r.totalLapsDone>=nLaps-2;
          if(!r.inPit&&!isLast2b&&r.pitStrategy.length>0&&!(r.isPlayer&&manPitRef.current)){
            const nxt=r.pitStrategy[0], curLap=r.totalLapsDone+1;
            const hasRP=r.tireWearByLap&&r.tireWearByLap.length;
            const should=hasRP?(curLap>=nxt.lap):(curLap>=nxt.lap&&r.tyreWear<58);
            if(should){const dist=Math.abs(((r.trackPos-track.pitEntry)+1)%1);if(dist<0.12){r.inPit=true;r.pitEndAt=nowSec+(r.pitDurationSeconds||3.2)+0.5;addInc(`${r.name} — pit stop`);if(r.isPlayer)setPitNotif("PIT STOP — Changing tyres + refuel…");}}
          }
          // Smart pit (worn tyres)
          const smartThresh=38+(1-(r.reliabilityWearMult||1))*40;
          if(!r.inPit&&!isLast2b&&r.tyreWear<smartThresh&&!(r.isPlayer&&manPitRef.current)){const dist=Math.abs(((r.trackPos-track.pitEntry)+1)%1);if(dist<0.12){r.inPit=true;r.pitEndAt=nowSec+(r.pitDurationSeconds||3.2)+0.5;if(r.pitStrategy.length>0)r.pitStrategy=r.pitStrategy.slice(1);addInc(`${r.name} — smart pit`);if(r.isPlayer)setPitNotif("PIT STOP — Tyres worn…");}}
          // Emergency pit
          if(!r.inPit&&r.tyreWear<=td.minWear+1){const dist=Math.abs(((r.trackPos-track.pitEntry)+1)%1);if(dist<0.12&&(!isLast2b||r.tyreWear<=td.minWear)){r.inPit=true;r.pitEndAt=nowSec+(r.pitDurationEmergencySeconds||4.2)+0.5;addInc(`${r.name} — emergency pit`);if(r.isPlayer)setPitNotif("Emergency pit — tyres critical!");}}
        });

        // Sort standings
        const sorted=[...racers].sort((a,b)=>{
          if(a.dnf&&!b.dnf)return 1;if(!a.dnf&&b.dnf)return -1;
          if(a.dnf&&b.dnf){const pa=(a.totalLapsDone??0)+(a.trackPos??0),pb=(b.totalLapsDone??0)+(b.trackPos??0);if(Math.abs(pb-pa)>1e-9)return pb-pa;return(b.dnfAtSec??0)-(a.dnfAtSec??0);}
          const aF=a.finished&&a.finishOrder>0,bF=b.finished&&b.finishOrder>0;
          if(aF&&bF)return a.finishOrder-b.finishOrder;if(aF&&!bF)return-1;if(!aF&&bF)return 1;
          const pa=(a.totalLapsDone??0)+(a.trackPos??0),pb=(b.totalLapsDone??0)+(b.trackPos??0);
          if(Math.abs(pb-pa)>1e-9)return pb-pa;return(a.position??99)-(b.position??99);
        });
        sorted.forEach((r,i)=>{r.position=i+1;});

        const leaderLap=Math.max(0,...racers.filter(r=>!r.dnf).map(r=>r.totalLapsDone??0));
        setLapDisp(nLaps===1?"Qualifying":`${Math.min(leaderLap+1,nLaps)} / ${nLaps}`);

        // Commentary
        if(now-lastComm>3200){
          lastComm=now;const lf=leaderLap/nLaps;
          if(lf<0.15)commPhase="start";else if(lf<0.75)commPhase="mid";else if(lf<0.92)commPhase="final";else commPhase="done";
          if(!commQ.length)commQ=[...COMMENTARY[commPhase]];
          commQ=commQ.filter(l=>l!==lastCommLine);
          if(!commQ.length)commQ=[...COMMENTARY[commPhase]];
          const idx=Math.floor(Math.random()*commQ.length);
          lastCommLine=commQ[idx];setCommentary(commQ[idx]);commQ.splice(idx,1);
        }

        drawCanvas(track,curCond,sorted,nowSec);
        if(now-lastSave.current>2000){lastSave.current=now;saveState();}

        // Update standings state (gap in real seconds FIX)
        const ldrProg=sorted.length?sorted[0].totalLapsDone+sorted[0].trackPos:0;
        setStandings(sorted.map(r=>{
          const prog=r.totalLapsDone+r.trackPos;
          const gapLaps=ldrProg-prog;
          // Gap in real seconds (not fractional laps)
          const gapSec=gapLaps>0.05?gapLaps*track.lapBase/(r.baseSpeed||1):0;
          return{
            id:r.id,name:r.name,isPlayer:r.isPlayer,color:r.color,carName:r.carName,
            position:r.position,lapCount:r.lapCount,currentTyre:r.currentTyre,tyreWear:r.tyreWear,
            inPit:r.inPit,finished:r.finished,dnf:r.dnf,pitStops:r.pitStops,
            pitTimeRemaining:r.inPit&&r.pitEndAt?Math.max(0,r.pitEndAt-nowSec):0,
            gapSec,lapsDown:Math.floor(gapLaps),
            currentSpeedMph:r.currentSpeedMph!=null?Math.round(r.currentSpeedMph):null,
            hasFastestLap:fl.holderId===r.id,
            inSlipstream:r.inSlipstream,fuelLoad:r.fuelLoad!=null?Math.round(r.fuelLoad):null,
            sectorDelta:r.isPlayer?r.sectorDelta:null,
            tyreCliffWarning:r.tyreCliffWarning,
          };
        }));

        if(nLaps>0){const mx=sorted.length?Math.max(...sorted.map(r=>(r.totalLapsDone+r.trackPos)/nLaps)):0;setRaceProg(Math.min(1,mx));}

        const active=racers.filter(r=>!r.finished&&!r.dnf);
        if(active.length===0){
          if(nLaps===1&&onQualifyingComplete){
            const fo=[...racers].sort((a,b)=>{const aF=a.finished&&a.finishOrder>0,bF=b.finished&&b.finishOrder>0;if(aF&&bF)return a.finishOrder-b.finishOrder;if(aF&&!bF)return-1;if(!aF&&bF)return 1;return((b.totalLapsDone??0)+(b.trackPos??0))-((a.totalLapsDone??0)+(a.trackPos??0));});
            onQualifyingComplete(fo);return;
          }
          setUiPhase("done");setCommentary(rnd(COMMENTARY.done));
          const fo=[...racers].sort((a,b)=>{if(a.dnf&&!b.dnf)return 1;if(!a.dnf&&b.dnf)return-1;if(a.dnf&&b.dnf){const pa=(a.totalLapsDone??0)+(a.trackPos??0),pb=(b.totalLapsDone??0)+(b.trackPos??0);if(Math.abs(pb-pa)>1e-9)return pb-pa;return(b.dnfAtSec??0)-(a.dnfAtSec??0);}const aF=a.finished&&a.finishOrder>0,bF=b.finished&&b.finishOrder>0;if(aF&&bF)return a.finishOrder-b.finishOrder;if(aF&&!bF)return-1;if(!aF&&bF)return 1;return((b.totalLapsDone??0)+(b.trackPos??0))-((a.totalLapsDone??0)+(a.trackPos??0));});
          setResults(fo.map((r,i)=>({pos:i+1,id:r.id,name:r.name,isPlayer:r.isPlayer,color:r.color,carName:r.carName,pitStops:r.pitStops,lapTimes:r.lapTimes,dnf:r.dnf,bestLap:r.lapTimes.length?Math.min(...r.lapTimes):null,hasFastestLap:fl.holderId===r.id})));
          const rOIds=fo.map(r=>r.id),dIds=fo.filter(r=>r.dnf).map(r=>r.id);
          clearSaved();setTimeout(()=>onComplete?.(rOIds,dIds),1200);return;
        }
        rafRef.current=requestAnimationFrame(loop);
      } catch(err){ console.error("Race loop error",err); rafRef.current=requestAnimationFrame(loop); }
    };

    raceStart.current=Date.now(); rafRef.current=requestAnimationFrame(loop);
  }, [drawCanvas, onComplete, clearSaved, saveState]);

  // ─── REPLAY MODE ────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "replay") return;
    if (!participants.length && !resultOrder.length) return;
    rpStarted.current = false;
    const rawOrder = (qualifying_order?.length) ? qualifying_order : (resultOrder.length ? resultOrder : participants.map(p=>p.user_id||p.id));
    const seen = new Set();
    const order = rawOrder.filter(id => { if(seen.has(id))return false;seen.add(id);return true; });
    resizeCanvas();
    const track = TRACKS.find(t=>t.id===initialTrackId)||TRACKS[0];
    const cond  = WEATHER_MAP[weatherIdProp]||"clear";
    const racers = order.map((id,i) => {
      const p = participants.find(x=>(x.user_id||x.id)===id)||{};
      const isPlayer = (currentUserId!=null&&(id===currentUserId||p.user_id===currentUserId));
      const bs = (p.effective_speed!=null?p.effective_speed:15)/15;
      const tyreId = ((p.tyre_compound||"medium").toLowerCase());
      const resolved = tyreId in TYRE_DEFS ? tyreId : "medium";
      const pitLvl = p.pit_level!=null?p.pit_level:0;
      // FIX B3: pass entrant object so compound cycling is correct
      const rpStrat = buildReplayStrategy(id, pit_stops, p);
      return {
        id, name:p.username||p.car_name||`#${i+1}`, isPlayer,
        color:CAR_COLORS[i%CAR_COLORS.length], carName:p.car_name||"",
        trackPos:(rawOrder.length-i)*0.012, lapCount:1, totalLapsDone:0,
        currentTyre:resolved, tyreWear:Array.isArray(tire_wear_after_lap[id])?(tire_wear_after_lap[id][0]??100):100,
        pitStops:0, inPit:false, pitEndAt:0,
        pitDurationSeconds:pitDur(pitLvl,false), pitDurationEmergencySeconds:pitDur(pitLvl,true),
        baseSpeed:bs, baseGrip:p.effective_grip!=null?p.effective_grip:0.85,
        pitStrategy:rpStrat, finished:false, finishOrder:0, visible:true, position:i+1, carNumber:i+1, lapTimes:[],
        // FIX B2: lap data used only at lap boundary
        tireWearByLap:tire_wear_after_lap[id],
        slideOffUntil:0, pitExitUntil:null, engineHealth:100, dnf:false, dnfAtSec:0, dnfSparks:[],
        fuelLoad:100, currentSector:0, lastSectorCross:0, bestSectors:[Infinity,Infinity,Infinity], sectorDelta:null,
        inSlipstream:false, tyreBlister:false, strategyType:"normal",
        reliabilityWearMult:Math.max(0.7,1-pitLvl*0.05),
        overtakingLevel:0, overtakeBoostUntil:0, currentSpeedMph:null,
      };
    });

    stateRef.current = { racers, track, nLaps:totalLaps, wd:WEATHER_DEFS[cond]||WEATHER_DEFS.clear };
    stateRef.current.pendingReplay = { racers, track, cond, totalLaps };
    setUiPhase("countdown"); setCountdown(3); setCommentary(rnd(COMMENTARY.start));

    cdRef.current = setInterval(() => {
      setCountdown(prev => {
        const next = prev-1;
        if (next <= 0) {
          clearInterval(cdRef.current); cdRef.current=null;
          setUiPhase("racing");
          const pr = stateRef.current?.pendingReplay;
          if (pr?.racers?.length) { rpStarted.current=true; startRaceLoop(pr.track,pr.cond,pr.totalLaps,pr.racers); }
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => { clearInterval(cdRef.current); if(rafRef.current)cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentUserId, raceId, participants.length, resultOrder.length]);

  useEffect(() => {
    if (mode!=="replay"||uiPhase!=="racing") return;
    if (rpStarted.current) return;
    const pr = stateRef.current?.pendingReplay;
    if (!pr?.racers?.length) return;
    rpStarted.current=true; startRaceLoop(pr.track,pr.cond,pr.totalLaps,pr.racers);
  }, [mode, uiPhase, startRaceLoop]);

  // ─── LIVE MODE ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "live") return;
    if (!participants.length || !qualifying_order?.length) return;
    const seen=new Set();
    const order=qualifying_order.filter(id=>{if(seen.has(id))return false;seen.add(id);return true;});
    resizeCanvas();
    const track=TRACKS.find(t=>t.id===initialTrackId)||TRACKS[0];
    const cond=WEATHER_MAP[weatherIdProp]||"clear";
    const wd=WEATHER_DEFS[cond]||WEATHER_DEFS.clear;
    const ww=wd.wearMult||1;
    const racers=order.map((id,i)=>{
      const p=participants.find(x=>(x.user_id||x.id)===id)||{};
      const isPlayer=currentUserId!=null&&(id===currentUserId||p.user_id===currentUserId);
      const bs=(p.effective_speed!=null?p.effective_speed:15)/15;
      const tyreId=(p.tyre_compound||"medium").toLowerCase();
      const resolved=tyreId in TYRE_DEFS?tyreId:"medium";
      const pitLvl=p.pit_level!=null?p.pit_level:0;
      const relMult=Math.max(0.7,1-0.008*(p.reliability_level||0));
      const ns=isPlayer?"normal":rollStrat();
      const po=isPlayer?0:Math.floor(Math.random()*3)-1;
      // FIX B5: NPC overtaking scales with car speed tier
      const ovt=isPlayer?(p.overtaking_level||0):Math.max(0,Math.round((bs-0.88)*200));
      return{
        id,name:p.username||p.car_name||`#${i+1}`,isPlayer,
        color:CAR_COLORS[i%CAR_COLORS.length],carName:p.car_name||"",
        trackPos:(order.length-i)*0.012,lapCount:1,totalLapsDone:0,
        currentTyre:resolved,tyreWear:100,pitStops:0,inPit:false,pitEndAt:0,
        pitDurationSeconds:pitDur(pitLvl,false),pitDurationEmergencySeconds:pitDur(pitLvl,true),
        baseSpeed:bs,baseGrip:p.effective_grip!=null?p.effective_grip:0.85,reliabilityWearMult:relMult,
        pitStrategy:buildStrategy(resolved,totalLaps,ww,relMult,po,ns),
        finished:false,finishOrder:0,visible:true,position:i+1,carNumber:i+1,lapTimes:[],
        slideOffUntil:0,pitExitUntil:null,engineHealth:100,dnf:false,dnfAtSec:0,dnfSparks:[],
        fuelLoad:100,currentSector:0,lastSectorCross:0,bestSectors:[Infinity,Infinity,Infinity],sectorDelta:null,
        inSlipstream:false,tyreBlister:false,strategyType:ns,
        overtakingLevel:ovt,overtakeBoostUntil:0,currentSpeedMph:null,
      };
    });
    stateRef.current={racers,track,nLaps:totalLaps,wd};
    stateRef.current.pendingReplay={racers,track,cond,totalLaps};
    setUiPhase("countdown");setCountdown(3);setCommentary(rnd(COMMENTARY.start));
    cdRef.current=setInterval(()=>{
      setCountdown(prev=>{
        const next=prev-1;
        if(next<=0){
          clearInterval(cdRef.current);cdRef.current=null;
          const pr=stateRef.current?.pendingReplay;
          if(pr){
            setUiPhase("qualifying");setLapDisp("Qualifying");setCommentary("Qualifying lap — grid set by this lap");
            startRaceLoop(pr.track,pr.cond,1,pr.racers,{
              onQualifyingComplete:(sortedRacers)=>{
                const qWd=WEATHER_DEFS[pr.cond]||WEATHER_DEFS.clear;
                const gridRacers=sortedRacers.map((r,gi)=>({
                  ...r,trackPos:(sortedRacers.length-gi)*0.012,totalLapsDone:0,lapCount:1,
                  finished:false,finishOrder:0,visible:true,tyreWear:100,lapTimes:[],pitStops:0,
                  inPit:false,pitEndAt:0,slideOffUntil:0,pitExitUntil:null,position:gi+1,carNumber:gi+1,
                  pitStrategy:buildStrategy(r.currentTyre,pr.totalLaps,qWd.wearMult||1,r.reliabilityWearMult||1,r.isPlayer?0:Math.floor(Math.random()*3)-1,r.strategyType||"normal"),
                  engineHealth:100,dnf:false,dnfAtSec:0,dnfSparks:[],fuelLoad:100,
                  currentSector:0,lastSectorCross:0,bestSectors:[Infinity,Infinity,Infinity],sectorDelta:null,
                  inSlipstream:false,tyreBlister:false,overtakeBoostUntil:0,currentSpeedMph:null,
                }));
                setCommentary("Grid set — race start!");
                setTimeout(()=>{setUiPhase("racing");setLapDisp(`1 / ${pr.totalLaps}`);setCommentary(rnd(COMMENTARY.start));startRaceLoop(pr.track,pr.cond,pr.totalLaps,gridRacers);},2200);
              },
            });
          }
          return 0;
        }
        return next;
      });
    },1000);
    return()=>{clearInterval(cdRef.current);if(rafRef.current)cancelAnimationFrame(rafRef.current);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mode,currentUserId]);

  // Countdown draw loop
  useEffect(()=>{
    if(uiPhase!=="countdown"||(mode!=="replay"&&mode!=="live"&&mode!=="interactive-live"))return;
    let id;const draw=()=>{const{track,racers}=stateRef.current||{};if(track&&racers?.length)drawCanvas(track,effCond,racers);id=requestAnimationFrame(draw);};
    id=requestAnimationFrame(draw);return()=>{cancelAnimationFrame(id);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[uiPhase,mode,effCond,drawCanvas]);

  // ─── INTERACTIVE-LIVE MODE (backend-driven, full replay physics) ───────
  useEffect(() => {
    if (mode !== "interactive-live") return;
    if (!participants.length) return;
    liveInitDone.current = false;
    resizeCanvas();
    const track = TRACKS.find(t => t.id === initialTrackId) || TRACKS[0];
    const cond = WEATHER_MAP[weatherIdProp] || "clear";
    const wd = WEATHER_DEFS[cond] || WEATHER_DEFS.clear;
    const ww = wd.wearMult || 1;
    const profile = buildSpeedProfile(track);

    // Pre-compute average corner speed multiplier so we can calibrate orbit speed
    let avgCSM = 0;
    for (let i = 0; i < PROFILE_N; i++) avgCSM += Math.max(0.50, Math.min(1.0, profile[i]));
    avgCSM /= PROFILE_N;
    if (avgCSM < 0.4) avgCSM = 0.75;

    const TARGET_LAP_SEC = 28;

    const cs = liveCarStatesRef.current || {};
    const ids = Object.keys(cs).length
      ? Object.entries(cs).sort((a, b) => (a[1].position ?? 99) - (b[1].position ?? 99)).map(([k]) => k)
      : participants.map(p => p.user_id || p.id);
    const seen = new Set();
    const order = ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; });

    const nRaceLaps = liveTotalLapsRef.current || liveTotalLaps || 3;
    const qualRacers = order.map((id, i) => {
      const p = participants.find(x => (x.user_id || x.id) === id) || {};
      const isPlayer = currentUserId != null && (id === currentUserId || p.user_id === currentUserId);
      const bs = (p.effective_speed != null ? p.effective_speed : 15) / 15;
      const carState = cs[id] || {};
      const tyreId = (carState.compound || p.tyre_compound || "medium").toLowerCase();
      const resolved = tyreId in TYRE_DEFS ? tyreId : "medium";
      const startTrackPos = 1.0 - (i * 0.06);
      const pitLvl = p.pit_level != null ? p.pit_level : 0;
      const relMult = Math.max(0.7, 1 - pitLvl * 0.05);
      const po = isPlayer ? 0 : Math.floor(Math.random() * 3) - 1;
      return {
        id, name: p.username || p.car_name || `#${i + 1}`, isPlayer,
        color: CAR_COLORS[i % CAR_COLORS.length], carName: p.car_name || "",
        trackPos: startTrackPos, lapCount: 1, totalLapsDone: 0,
        currentTyre: resolved, tyreWear: carState.tyre_wear ?? 100,
        pitStops: 0, inPit: false, pitEndAt: 0,
        pitDurationSeconds: pitDur(pitLvl, false), pitDurationEmergencySeconds: pitDur(pitLvl, true),
        baseSpeed: bs, baseGrip: p.effective_grip != null ? p.effective_grip : 0.85,
        pitStrategy: buildStrategy(resolved, nRaceLaps, ww, relMult, po, "normal"),
        finished: false, finishOrder: 0, visible: true,
        position: carState.position ?? (i + 1), carNumber: i + 1, lapTimes: [],
        slideOffUntil: 0, pitExitUntil: null,
        engineHealth: 100 - (carState.engine_wear ?? 0),
        dnf: !!carState.dnf, dnfAtSec: 0, dnfSparks: [],
        fuelLoad: carState.fuel_pct ?? 100,
        currentSector: 0, lastSectorCross: 0,
        bestSectors: [Infinity, Infinity, Infinity], sectorDelta: null,
        inSlipstream: false, tyreBlister: (carState.tyre_wear ?? 100) < 20,
        strategyType: "normal", reliabilityWearMult: relMult,
        overtakingLevel: Math.max(0, Math.round((bs - 0.88) * 200)), overtakeBoostUntil: 0, currentSpeedMph: null,
        _targetPos: carState.position ?? (i + 1),
        _smoothPos: carState.position ?? (i + 1),
        _prevPitCount: 0,
      };
    });

    const sc = { active: false, endsAtSec: 0, cooldownUntil: 0 };
    liveInitDone.current = false;
    let lightsAfterQualInterval = null;

    setUiPhase("qualifying");
    setLapDisp("Qualifying");
    setCommentary("Qualifying lap — grid order set");
    drawCanvas(track, cond, qualRacers, 0);

    function startRacing() {
    let lastFrame = performance.now();
    let firstFrame = true;
    let prevPitStopsLen = (livePitStopsRef.current || []).length;
    let prevIncidentsLen = (liveIncidentsRef.current || []).length;
    let prevBackendLap = liveCurrentLapRef.current || 0;
    let lastReportedVisLap = -1;
    let lastReportedProg = -1;
    const raceTotLaps = liveTotalLapsRef.current || 3;
    const lapCrossAllowedAfterSec = raceTotLaps > 1 ? (performance.now() / 1000 + 1.75) : -Infinity;

    const addInc = (text) => {
      stateRef.current.incidents.push({ text, time: performance.now() });
    };

    const loop = (now) => {
      if (pausedRef.current) { lastFrame = now; rafRef.current = requestAnimationFrame(loop); return; }
      let dt = (now - lastFrame) / 1000;
      if (firstFrame) { firstFrame = false; dt = 0; }
      dt = Math.min(0.05, dt) * (spMultRef.current || 1);
      lastFrame = now;
      const nowSec = now / 1000;

      const st = stateRef.current;
      if (!st || !st.racers || !st.track) { rafRef.current = requestAnimationFrame(loop); return; }
      const r = st.racers, trk = st.track;

      const cs2 = liveCarStatesRef.current || {};
      const curLap = liveCurrentLapRef.current || 0;
      const totLaps = liveTotalLapsRef.current || 3;

      if (curLap !== prevBackendLap) {
        prevBackendLap = curLap;
        r.forEach(x => { x.lastSectorCross = nowSec; x.currentSector = 0; });
      }

      const scActive = sc.active && nowSec < sc.endsAtSec;
      if (sc.active && nowSec >= sc.endsAtSec) { sc.active = false; addInc("Safety car in — green flag!"); setCommentary(rnd(COMMENTARY.safetyCarEnd)); }

      // Process new pit stops from backend
      const pitArr = livePitStopsRef.current || [];
      if (pitArr.length > prevPitStopsLen) {
        for (let pi = prevPitStopsLen; pi < pitArr.length; pi++) {
          const ps = pitArr[pi];
          const pr = r.find(x => x.id === ps.entrant_id);
          if (pr && !pr.inPit) {
            pr.inPit = true;
            pr.pitEndAt = nowSec + pr.pitDurationSeconds;
            pr.trackPos = trk.pitEntry;
            addInc(`${pr.name} pits for ${cs2[ps.entrant_id]?.compound || "tyres"}`);
          }
        }
        prevPitStopsLen = pitArr.length;
      }

      // Process new incidents from backend
      const incArr = liveIncidentsRef.current || [];
      if (incArr.length > prevIncidentsLen) {
        for (let ii = prevIncidentsLen; ii < incArr.length; ii++) {
          const inc = incArr[ii];
          const dmgR = r.find(x => x.id === inc.damaged);
          if (dmgR) {
            const pt = trk.getPoint(dmgR.trackPos % 1);
            addSparks(pt.x, pt.y);
            addInc(`Contact! ${dmgR.name} takes ${inc.damage_pct}% damage`);
          }
        }
        prevIncidentsLen = incArr.length;
      }

      // Build sorted standings from previous frame for rubber-banding / slipstream
      const prevSorted = [...r].filter(x => !x.dnf && !x.inPit).sort((a, b) =>
        ((b.totalLapsDone ?? 0) + (b.trackPos ?? 0)) - ((a.totalLapsDone ?? 0) + (a.trackPos ?? 0))
      );
      const prevMap = {};
      prevSorted.forEach((x, idx) => { prevMap[x.id] = { idx, prog: (x.totalLapsDone ?? 0) + (x.trackPos ?? 0) }; });

      // --- Per-car physics update ---
      r.forEach(racer => {
        const carState = cs2[racer.id];
        if (carState) {
          racer._targetPos = carState.position ?? racer._targetPos;
          racer.tyreWear = carState.tyre_wear ?? racer.tyreWear;
          racer.currentTyre = carState.compound || racer.currentTyre;
          racer.engineHealth = 100 - (carState.engine_wear ?? 0);
          racer.fuelLoad = carState.fuel_pct ?? racer.fuelLoad;
          racer.tyreBlister = racer.tyreWear < 20;
          const damage = carState.damage ?? 0;

          if (carState.dnf && !racer.dnf) {
            racer.dnf = true;
            racer.dnfAtSec = nowSec;
            racer.dnfSparks = Array.from({ length: 8 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, life: 1 }));
            addInc(`${racer.name} RETIRES (DNF)`);
          }

          if (damage > 0.1 && Math.random() < 0.02) {
            const pt = trk.getPoint(racer.trackPos % 1);
            addSparks(pt.x, pt.y);
          }
        }

        if (racer.dnf) {
          if (racer.visible && nowSec > racer.dnfAtSec + 20) racer.visible = false;
          if (racer.visible) { racer.trackPos = (racer.trackPos + 0.0005) % 1; racer.currentSpeedMph = 2; }
          return;
        }

        if (racer.inPit) {
          if (nowSec >= racer.pitEndAt) {
            racer.inPit = false;
            racer.pitStops++;
            racer.trackPos = trk.pitExit;
            racer.pitExitUntil = nowSec + 2.0;
            racer.tyreWear = 100;
            racer.tyreBlister = false;
            const carState2 = cs2[racer.id];
            if (carState2?.compound) racer.currentTyre = carState2.compound;
          }
          racer.currentSpeedMph = racer.currentSpeedMph != null
            ? racer.currentSpeedMph + (5 - racer.currentSpeedMph) * Math.min(1, dt * 4) : 5;
          return;
        }

        // Smooth position interpolation (overtakes transition over ~2s)
        racer._smoothPos = racer._smoothPos + (racer._targetPos - racer._smoothPos) * Math.min(1, dt * 1.5);

        // Tyre grip model (F1 Clash cliff model)
        const td = TYRE_DEFS[racer.currentTyre] || TYRE_DEFS.medium;
        const tyreGripFactor = tyreGripFromWear(racer.tyreWear, racer.currentTyre);
        const effGrip = (racer.baseGrip || 0.85) * tyreGripFactor * (wd.gripMult || 1);
        const fuelW = 1.0 + 0.03 * ((racer.fuelLoad ?? 100) / 100);

        // effSpeed calibrated so leader completes 1 orbit in TARGET_LAP_SEC
        const totalActive = r.filter(x => !x.dnf && !x.inPit).length || 1;
        const posSpeedMult = 1.0 + ((totalActive + 1) / 2 - racer._smoothPos) / totalActive * 0.20;
        const enginePenalty = racer.engineHealth < 30 ? (0.85 + racer.engineHealth / 200) : 1.0;

        let effSpeed = (trk.lapBase / (TARGET_LAP_SEC * avgCSM))
          * posSpeedMult * td.gripMult * (wd.speedMult || 1) * tyreGripFactor * enginePenalty / fuelW;

        // Rubber-banding: trailing cars get a small boost
        const myP = prevMap[racer.id];
        const lP = prevSorted[0] ? (prevSorted[0].totalLapsDone ?? 0) + (prevSorted[0].trackPos ?? 0) : 0;
        const gapLdr = lP - ((myP?.prog) ?? 0);
        if (gapLdr > 0.15 && !scActive) effSpeed *= 1 + Math.min(0.08, gapLdr * 0.25);

        // Slipstream + overtake boost
        racer.inSlipstream = false;
        if (myP && myP.idx > 0) {
          const ahP = (prevSorted[myP.idx - 1].totalLapsDone ?? 0) + (prevSorted[myP.idx - 1].trackPos ?? 0);
          const sl = ahP - ((myP.prog) ?? 0);
          if (sl > 0 && sl < 0.016 && !scActive) { effSpeed *= 1.045; racer.inSlipstream = true; }
          if (sl > 0 && sl <= 0.022 && !scActive && Math.random() < dt * 0.7 * ((racer.overtakingLevel || 0) / 100) + dt * 0.05)
            racer.overtakeBoostUntil = nowSec + 0.4;
        }
        if (nowSec < (racer.overtakeBoostUntil || 0)) effSpeed *= 1.04;
        if (scActive) effSpeed = Math.min(effSpeed, 0.35 * (trk.lapBase / (TARGET_LAP_SEC * avgCSM)));

        // Corner physics from speed profile + grip
        const trackT = ((racer.trackPos % 1) + 1) % 1;
        const pidx = Math.round(trackT * (PROFILE_N - 1));
        const curvature = getCurvature(trk, trackT);

        const inSF = inStartFinishSafeZone(trk, trackT);
        const inSFRelax = inStartFinishCornerRelaxZone(trk, trackT);
        const gripBasedMult = cornerGripMult(curvature, effGrip);
        const profileMult = Math.max(0.50, Math.min(1.0, profile[pidx] + (effGrip - 0.85) * 0.55));
        let cornerSM = inSF
          ? Math.min(1, Math.max(profileMult, 0.998))
          : Math.min(profileMult, gripBasedMult);

        const effCurvSlide = inSF ? 0 : curvature;
        // Curvature-aware braking/acceleration rates
        const isTightCorner = !inSFRelax && curvature > 0.12;
        const isMedCorner = !inSFRelax && curvature > 0.055;
        const ABRAKE = isTightCorner ? 6.5 : isMedCorner ? 5.0 : 4.0;
        const AACCEL = isTightCorner ? 2.2 : isMedCorner ? 2.8 : 3.6;
        const SSCALE = 0.170, SCAP = 160;
        const applyLerp = (cur, tgt) => {
          if (tgt == null) return tgt; if (cur == null) return tgt;
          const brk = tgt < cur;
          return cur + (tgt - cur) * Math.min(1, dt * (brk ? ABRAKE : AACCEL));
        };

        // Movement
        const prevPos = racer.trackPos;
        if (racer.slideOffUntil > 0 && nowSec < racer.slideOffUntil) {
          racer.trackPos = (racer.trackPos + (1 / (trk.lapBase / effSpeed)) * dt * 0.18 + 1) % 1;
          racer.currentSpeedMph = 20;
        } else {
          racer.slideOffUntil = 0;
          const lapTime = trk.lapBase / (effSpeed * cornerSM);
          racer.trackPos = (racer.trackPos + (1 / lapTime) * dt + 1) % 1;

          // Realistic MPH display (based on track's natural pace, not compressed orbit)
          const displayEff = 1.0 * posSpeedMult * tyreGripFactor * enginePenalty;
          const rawMph = trk.km && trk.lapBase
            ? SSCALE * (3600 * trk.km * cornerSM * displayEff) / trk.lapBase : null;
          const tMph = rawMph != null ? Math.max(0, Math.min(SCAP, rawMph)) : null;
          racer.currentSpeedMph = tMph != null
            ? (racer.currentSpeedMph != null ? applyLerp(racer.currentSpeedMph, tMph) : tMph) : null;

          // Slide-off on low grip + sharp corners (not in SF safe zone)
          if (!inSF && effCurvSlide > 0.22 && effGrip < 0.66 && Math.random() < dt * 0.5 * (0.66 - effGrip) * Math.min(1, effCurvSlide / 0.36)) {
            racer.slideOffUntil = nowSec + 0.5 + Math.random() * 0.65;
            addInc(`${racer.name} off track!`);
            if (!sc.active && nowSec > sc.cooldownUntil && Math.random() < 0.15 && totLaps > 1) {
              sc.active = true; sc.endsAtSec = nowSec + 6 + Math.random() * 4;
              sc.cooldownUntil = sc.endsAtSec + 10;
              addInc("Safety car deployed!"); setCommentary(rnd(COMMENTARY.safetyCar));
            }
          }
        }

        // Sector crossings
        const sfL = trk.sfLine ?? 0;
        const relT = ((trackT - sfL + 1) % 1);
        const ns2 = relT < 0.333 ? 0 : relT < 0.666 ? 1 : 2;
        if (ns2 !== racer.currentSector) {
          const el = nowSec - (racer.lastSectorCross || nowSec);
          if (racer.lastSectorCross > 0 && el > 0.5 && racer.isPlayer) {
            const delta = el - racer.bestSectors[racer.currentSector];
            racer.sectorDelta = delta;
            racer.bestSectors[racer.currentSector] = Math.min(racer.bestSectors[racer.currentSector], el);
          }
          racer.currentSector = ns2; racer.lastSectorCross = nowSec;
        }

        // Lap crossing (same geometry test as main loop — works at x4 speed)
        const sfL2 = trk.sfLine ?? 0;
        const crossedSF = crossedStartFinishLineForward(prevPos, racer.trackPos, sfL2);
        const canCountLap = raceTotLaps <= 1 || nowSec >= lapCrossAllowedAfterSec;
        if (crossedSF && canCountLap && !(racer._justCrossedFrames > 0)) {
          racer._justCrossedFrames = 4; // FIX: frame counter
          racer.totalLapsDone = Math.min(totLaps, (racer.totalLapsDone || 0) + 1);
          racer.lapCount = Math.min(totLaps, racer.totalLapsDone + 1);
          const lt = trk.lapBase / (effSpeed * 0.97) + (Math.random() - 0.5) * 0.8;
          racer.lapTimes.push(lt);
          if (lt < fl.time) { fl.time = lt; fl.holderId = racer.id; stateRef.current.fastestLap = fl; addInc(`${racer.name} — fastest lap!`); }
        } else {
          if (racer._justCrossedFrames > 0) racer._justCrossedFrames--;
        }

        // Visual tyre wear (gentle degradation between backend updates)
        if (racer.tyreWear > 5 && !racer.inPit) {
          const sl2 = stintLaps(racer.currentTyre, wd.wearMult || 1, 1);
          const wearPerLap = 90 / sl2;
          const wearPerSec = wearPerLap / TARGET_LAP_SEC;
          racer.tyreWear = Math.max(td.minWear, racer.tyreWear - wearPerSec * dt * 0.3);
        }
        racer.tyreBlister = racer.tyreWear < 20;
        racer.tyreCliffWarning = racer.tyreWear < (td.cliffStart * 100 + 12);

        // Visual fuel drain
        if (racer.fuelLoad != null && totLaps > 1) {
          const fps = 100 / (TARGET_LAP_SEC * totLaps);
          racer.fuelLoad = Math.max(0, racer.fuelLoad - fps * dt * 0.3);
        }

        // Tyre smoke in corners with worn tyres
        if (!inSF && curvature > 0.06 && racer.tyreWear < 40) {
          const pt = trk.getPoint(racer.trackPos);
          addTireSmoke(pt.x, pt.y, 0.4 + (1 - racer.tyreWear / 100) * 0.6);
        }
        // Engine smoke on critical wear
        if (racer.engineHealth < 25 && Math.random() < 0.08) {
          const pt = trk.getPoint(racer.trackPos);
          addTireSmoke(pt.x, pt.y, 0.3);
        }
      });

      let visLap = 0;
      r.forEach(x => { if (!x.dnf) visLap = Math.max(visLap, x.totalLapsDone ?? 0); });
      visLap = Math.min(visLap, totLaps);

      // Race finished: backend lap count or leader completed final lap visually
      if ((curLap >= totLaps || visLap >= totLaps) && totLaps > 0 && !st._raceFinished) {
        st._raceFinished = true;
        st.finishFlash = nowSec + 3.0;
        addInc("CHECKERED FLAG!");
        setCommentary(rnd(COMMENTARY.done));
        let fo = 1;
        [...r].sort((a, b) => (a._targetPos ?? 99) - (b._targetPos ?? 99)).forEach(x => {
          if (!x.dnf) { x.finished = true; x.finishOrder = fo++; }
        });
      }

      // Sort standings by progress
      r.sort((a, b) => {
        if (a.dnf && !b.dnf) return 1;
        if (!a.dnf && b.dnf) return -1;
        return ((b.totalLapsDone ?? 0) + (b.trackPos ?? 0)) - ((a.totalLapsDone ?? 0) + (a.trackPos ?? 0));
      });
      r.forEach((x, i) => { x.position = i + 1; });

      setStandings(r.map(x => ({
        id: x.id, name: x.name, isPlayer: x.isPlayer,
        position: x.position, tyre: x.currentTyre, tyreWear: x.tyreWear,
        pitStops: x.pitStops, dnf: x.dnf, engineHealth: x.engineHealth,
        fuelLoad: Math.round(x.fuelLoad), currentSpeedMph: Math.round(x.currentSpeedMph || 0),
        tyreCliffWarning: x.tyreWear < ((TYRE_DEFS[x.currentTyre]?.cliffStart || 0.66) * 100 + 12),
      })));
      // Match startRaceLoop HUD: current lap = leader completed + 1 (not raw completed count)
      const lapCur = totLaps <= 1 ? totLaps : Math.min(visLap + 1, totLaps);
      setLapDisp(totLaps === 1 ? 'Qualifying' : `${lapCur} / ${totLaps}`);
      let mxFrac = 0;
      r.forEach(x => {
        if (!x.dnf) mxFrac = Math.max(mxFrac, ((x.totalLapsDone ?? 0) + (x.trackPos ?? 0)) / totLaps);
      });
      const prog01 = totLaps > 0 ? Math.min(1, mxFrac) : 0;
      setRaceProg(prog01);
      const cb = onVisualLapChangeRef.current;
      if (cb && (visLap !== lastReportedVisLap || lastReportedProg < 0 || Math.abs(prog01 - lastReportedProg) >= 0.025)) {
        lastReportedVisLap = visLap;
        lastReportedProg = prog01;
        cb(visLap, totLaps, prog01);
      }

      drawCanvas(trk, cond, r, nowSec);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    } // end startRacing()

    startRaceLoop(track, cond, 1, qualRacers, {
      onQualifyingComplete: (sorted) => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        const nRace = liveTotalLapsRef.current || 3;
        const wd2 = wd;
        const grid = sorted.map((r, i) => ({
          ...r,
          trackPos: (sorted.length - i) * 0.012,
          totalLapsDone: 0,
          lapCount: 1,
          finished: false,
          finishOrder: 0,
          visible: true,
          tyreWear: Math.min(100, r.tyreWear ?? 100),
          lapTimes: [],
          pitStops: 0,
          inPit: false,
          pitEndAt: 0,
          slideOffUntil: 0,
          pitExitUntil: null,
          position: i + 1,
          carNumber: i + 1,
          pitStrategy: buildStrategy(r.currentTyre, nRace, wd2.wearMult || 1, r.reliabilityWearMult || 1, r.isPlayer ? 0 : Math.floor(Math.random() * 3) - 1, r.strategyType || "normal"),
          engineHealth: r.engineHealth ?? 100,
          dnf: false,
          dnfAtSec: 0,
          dnfSparks: [],
          fuelLoad: r.fuelLoad ?? 100,
          currentSector: 0,
          lastSectorCross: 0,
          bestSectors: [Infinity, Infinity, Infinity],
          sectorDelta: null,
          inSlipstream: false,
          tyreBlister: false,
          overtakeBoostUntil: 0,
          currentSpeedMph: null,
          _targetPos: i + 1,
          _smoothPos: i + 1,
        }));
        stateRef.current = {
          racers: grid, track, nLaps: nRace, wd: wd2, safetyCar: sc,
          fastestLap: { holderId: null, time: Infinity }, finishFlash: 0, incidents: [],
        };
        liveInitDone.current = true;
        drawCanvas(track, cond, grid, 0);
        setCommentary("Grid set — race start!");
        setUiPhase("countdown");
        setCountdown(3);
        let cdVal = 3;
        lightsAfterQualInterval = setInterval(() => {
          cdVal--;
          setCountdown(cdVal);
          if (cdVal <= 0) {
            if (lightsAfterQualInterval) clearInterval(lightsAfterQualInterval);
            lightsAfterQualInterval = null;
            setUiPhase("racing");
            setLapDisp(nRace === 1 ? "Qualifying" : `1 / ${nRace}`);
            setCommentary(rnd(COMMENTARY.start));
            startRacing();
          }
        }, 1000);
      },
    });

    return () => {
      if (lightsAfterQualInterval) clearInterval(lightsAfterQualInterval);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentUserId, participants.length, initialTrackId, weatherIdProp, liveTotalLaps, startRaceLoop]);

  // ─── LIVE MODE STANDALONE START ─────────────────────────────────────────
  const handleStart=useCallback(()=>{
    if(uiPhase==="racing")return;
    resizeCanvas();
    const track=selTrack, cond=effCond;
    const racers=buildRacers(track,cond,numLaps,chosenTyre);
    setUiPhase("countdown");setCountdown(3);
    let c=3;
    const cdI=setInterval(()=>{
      c--;setCountdown(c);
      if(c<=0){
        clearInterval(cdI);
        setUiPhase("qualifying");setLapDisp("Qualifying");setCommentary("Qualifying lap — grid order set");
        startRaceLoop(track,cond,1,racers,{
          onQualifyingComplete:(sorted)=>{
            const wd2=WEATHER_DEFS[cond]||WEATHER_DEFS.clear;
            const grid=sorted.map((r,i)=>({
              ...r,trackPos:(sorted.length-i)*0.012,totalLapsDone:0,lapCount:1,
              finished:false,finishOrder:0,visible:true,tyreWear:100,lapTimes:[],pitStops:0,
              inPit:false,pitEndAt:0,slideOffUntil:0,pitExitUntil:null,position:i+1,carNumber:i+1,
              pitStrategy:buildStrategy(r.currentTyre,numLaps,wd2.wearMult||1,r.reliabilityWearMult||1,r.isPlayer?0:Math.floor(Math.random()*3)-1,r.strategyType||"normal"),
              engineHealth:100,dnf:false,dnfAtSec:0,dnfSparks:[],fuelLoad:100,
              currentSector:0,lastSectorCross:0,bestSectors:[Infinity,Infinity,Infinity],sectorDelta:null,
              inSlipstream:false,tyreBlister:false,overtakeBoostUntil:0,currentSpeedMph:null,
            }));
            setCommentary("Grid set — race start!");
            setTimeout(()=>{setUiPhase("racing");setLapDisp(`1 / ${numLaps}`);setCommentary(rnd(COMMENTARY.start));startRaceLoop(track,cond,numLaps,grid);},2200);
          },
        });
      }
    },1000);
  },[uiPhase,selTrack,effCond,numLaps,chosenTyre,buildRacers,resizeCanvas,startRaceLoop]);

  const handleReset=useCallback(()=>{
    if(onReset){if(rafRef.current)cancelAnimationFrame(rafRef.current);onReset();return;}
    if(rafRef.current)cancelAnimationFrame(rafRef.current);
    setUiPhase("setup");setResults(null);setStandings([]);setLapDisp("—");
    setCommentary("Select track & tyres, then start");
    resizeCanvas(); requestAnimationFrame(()=>drawCanvas(selTrack,effCond,[]));
  },[selTrack,effCond,drawCanvas,resizeCanvas,onReset]);

  useEffect(()=>{const f=()=>{resizeCanvas();if(uiPhase==="setup")drawCanvas(selTrack,effCond,[]);};window.addEventListener("resize",f);return()=>window.removeEventListener("resize",f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[resizeCanvas,drawCanvas,selTrack,effCond,uiPhase]);

  useEffect(()=>{if(mode!=="live")return;resizeCanvas();drawCanvas(selTrack,effCond,[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{if(uiPhase!=="setup")return;resizeCanvas();drawCanvas(selTrack,effCond,[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selTrack,effCond,uiPhase]);

  useEffect(()=>()=>{if(rafRef.current)cancelAnimationFrame(rafRef.current);},[]);

  const isLive = mode === "live" || mode === "interactive-live";

  // ─── RENDER ─────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'Rajdhani',sans-serif", color:"var(--noir-foreground)" }}>

      {/* Track/tyre picker — live mode setup only (not interactive-live) */}
      {mode === "live" && uiPhase === "setup" && (
        <>
          <div className={styles.panel} style={{ padding:"0.75rem",marginBottom:"0.75rem" }}>
            <div className="font-heading text-xs mb-2" style={{ color:"var(--noir-primary)",letterSpacing:".2em",textTransform:"uppercase" }}>Select Track</div>
            <div style={{ display:"grid",gridTemplateColumns:narrow?"repeat(2,1fr)":"repeat(4,1fr)",gap:"0.4rem" }}>
              {TRACKS.map(t => (
                <button key={t.id} type="button" onClick={()=>setSelTrack(t)}
                  style={{ background:selTrack.id===t.id?"rgba(201,164,96,.1)":"transparent",border:`1px solid ${selTrack.id===t.id?"var(--noir-primary)":"var(--noir-border)"}`,padding:"0.5rem 0.4rem",minHeight:44,cursor:"pointer",textAlign:"left",touchAction:"manipulation" }}>
                  <TrackThumb track={t} active={selTrack.id===t.id}/>
                  <div className="font-heading" style={{ color:"var(--noir-primary)",fontSize:"8px",letterSpacing:".15em",textTransform:"uppercase",marginTop:"3px",lineHeight:1.2 }}>{t.name}</div>
                  <div style={{ fontSize:"9px",color:"var(--noir-muted)",marginTop:"2px" }}>{t.km}km · {t.corners}T</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:"flex",gap:"0.6rem",flexWrap:"wrap",marginBottom:"0.75rem",alignItems:"flex-start" }}>
            <div className={styles.panel} style={{ padding:"0.6rem",flex:"0 0 auto" }}>
              <div className="font-heading" style={{ fontSize:"8px",letterSpacing:".22em",textTransform:"uppercase",color:"var(--noir-muted)",marginBottom:"4px" }}>Weather</div>
              <span className="font-heading" style={{ fontSize:"12px",color:"var(--noir-primary)" }}>{wDef.icon} {weatherNameProp||wDef.label}</span>
              {wDef.tyreRec&&<div style={{ fontSize:"10px",color:"var(--noir-muted)",marginTop:"4px",fontStyle:"italic" }}>Rec: {wDef.tyreRec.map(t=>TYRE_DEFS[t]?.label).join(", ")}</div>}
            </div>
            <div className={styles.panel} style={{ padding:"0.6rem",flex:"1 1 200px" }}>
              <div className="font-heading" style={{ fontSize:"8px",letterSpacing:".22em",textTransform:"uppercase",color:"var(--noir-muted)",marginBottom:"4px" }}>Starting Tyre</div>
              <div style={{ display:"flex",gap:"4px",flexWrap:"wrap" }}>
                {Object.values(TYRE_DEFS).filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i).map(td=>(
                  <button key={td.id} type="button" onClick={()=>setChosenTyre(td.id)}
                    style={{ display:"flex",alignItems:"center",gap:"5px",padding:"8px 10px",minHeight:44,border:`1px solid ${chosenTyre===td.id?"var(--noir-primary)":"var(--noir-border)"}`,background:chosenTyre===td.id?"rgba(201,164,96,.1)":"transparent",cursor:"pointer",fontSize:"12px",fontWeight:600,color:chosenTyre===td.id?"var(--noir-foreground)":"var(--noir-muted)",touchAction:"manipulation" }}>
                    <span style={{ width:9,height:9,borderRadius:"50%",background:td.color,display:"inline-block",flexShrink:0 }}/>{td.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.panel} style={{ padding:"0.6rem",flex:"0 0 auto" }}>
              <div className="font-heading" style={{ fontSize:"8px",letterSpacing:".22em",textTransform:"uppercase",color:"var(--noir-muted)",marginBottom:"4px" }}>Laps</div>
              <input type="number" min={2} max={20} value={numLaps} onChange={e=>setNumLaps(Math.max(2,Math.min(20,parseInt(e.target.value)||3)))}
                style={{ width:56,minHeight:44,background:"transparent",border:"1px solid var(--noir-border)",color:"var(--noir-foreground)",fontFamily:"'Rajdhani',sans-serif",fontSize:14,padding:"6px 8px",textAlign:"center" }}/>
            </div>
          </div>
        </>
      )}

      {/* Canvas */}
      <div style={{ position:"relative",background:"#0d1208",border:"1px solid var(--noir-border)",marginBottom:"0.6rem",overflow:"hidden",touchAction:"manipulation" }}>
        <canvas ref={canvasRef} style={{ width:"100%",display:"block" }}/>

        {/* HUD top */}
        <div style={{ position:"absolute",top:0,left:0,right:0,display:"flex",alignItems:"flex-start",justifyContent:"space-between",padding:"6px 8px",background:"linear-gradient(to bottom,rgba(0,0,0,.78),transparent)",pointerEvents:"none" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap" }}>
            <div style={{ fontFamily:"'Cinzel',serif",fontSize:"clamp(9px,2vw,11px)",letterSpacing:".18em",color:"var(--noir-primary)",background:"rgba(0,0,0,.6)",border:"1px solid rgba(201,164,96,.2)",padding:"2px 7px" }}>
              Lap {lapDisp}
            </div>
            {(uiPhase==="qualifying"||uiPhase==="racing")&&(()=>{
              const ps=standings.find(s=>s.isPlayer);
              if(ps?.currentSpeedMph==null)return null;
              return<div style={{ fontFamily:"'Cinzel',serif",fontSize:"clamp(9px,2vw,11px)",letterSpacing:".12em",color:"#94a890",background:"rgba(0,0,0,.6)",border:"1px solid rgba(201,164,96,.15)",padding:"2px 7px" }}>{ps.currentSpeedMph} mph</div>;
            })()}
            {uiPhase==="racing"&&(()=>{
              const ps=standings.find(s=>s.isPlayer);
              if(!ps?.fuelLoad)return null;
              return<div style={{ fontFamily:"'Cinzel',serif",fontSize:"clamp(8px,1.8vw,10px)",color:ps.fuelLoad<20?"#e74c3c":"#94a890",background:"rgba(0,0,0,.6)",border:"1px solid rgba(201,164,96,.15)",padding:"2px 7px" }}>⛽ {ps.fuelLoad}%</div>;
            })()}
            {uiPhase==="racing"&&(()=>{
              const ps=standings.find(s=>s.isPlayer);
              if(!ps?.sectorDelta)return null;
              const d=ps.sectorDelta;
              return<div style={{ fontFamily:"'Cinzel',serif",fontSize:"clamp(8px,1.8vw,10px)",color:d<=0?"#a020f0":"#e74c3c",background:"rgba(0,0,0,.6)",border:"1px solid rgba(201,164,96,.15)",padding:"2px 7px" }}>{d<=0?`${d.toFixed(2)}s`:`+${d.toFixed(2)}s`}</div>;
            })()}
            {uiPhase==="racing"&&(()=>{
              const ps=standings.find(s=>s.isPlayer);
              if(!ps?.tyreCliffWarning)return null;
              return<div style={{ fontFamily:"'Cinzel',serif",fontSize:"clamp(8px,1.8vw,10px)",color:"#ff8c00",background:"rgba(0,0,0,.6)",border:"1px solid rgba(255,140,0,.35)",padding:"2px 7px" }}>⚠ TYRES</div>;
            })()}
          </div>
          <div style={{ display:"flex",gap:"5px",flexWrap:"wrap" }}>
            <span style={{ fontFamily:"'Cinzel',serif",fontSize:"clamp(8px,1.8vw,10px)",color:"var(--noir-foreground)",background:"rgba(0,0,0,.6)",border:"1px solid rgba(201,164,96,.15)",padding:"2px 7px" }}>{wDef.icon} {wDef.label}</span>
            <span style={{ fontFamily:"'Cinzel',serif",fontSize:"clamp(8px,1.8vw,10px)",color:"var(--noir-primary)",background:"rgba(0,0,0,.6)",border:"1px solid rgba(201,164,96,.15)",padding:"2px 7px" }}>{selTrack.name}</span>
          </div>
        </div>

        {/* Speed + pause controls */}
        {(uiPhase==="qualifying"||uiPhase==="racing")&&(
          <div style={{ position:"absolute",top:30,right:8,display:"flex",flexDirection:"column",gap:3,pointerEvents:"auto",alignItems:"flex-end" }}>
            <div style={{ display:"flex",gap:2 }}>
              <button type="button" onClick={()=>setPaused(p=>!p)}
                style={{ fontFamily:"'Cinzel',serif",fontSize:9,fontWeight:700,padding:"2px 8px",background:paused?"rgba(201,164,96,.35)":"rgba(0,0,0,.6)",border:`1px solid ${paused?"var(--noir-primary)":"rgba(201,164,96,.2)"}`,color:paused?"var(--noir-primary)":"var(--noir-muted)",cursor:"pointer",touchAction:"manipulation" }}>{paused?"▶":"⏸"}</button>
              {[1,2,4].map(x=>(
                <button key={x} type="button" onClick={()=>setSpMult(x)}
                  style={{ fontFamily:"'Cinzel',serif",fontSize:9,fontWeight:700,padding:"2px 6px",background:spMult===x?"rgba(201,164,96,.35)":"rgba(0,0,0,.6)",border:`1px solid ${spMult===x?"var(--noir-primary)":"rgba(201,164,96,.2)"}`,color:spMult===x?"var(--noir-primary)":"var(--noir-muted)",cursor:"pointer",touchAction:"manipulation" }}>x{x}</button>
              ))}
            </div>
            <div style={{ width:100,height:4,background:"rgba(255,255,255,.1)",borderRadius:2,overflow:"hidden" }}>
              <div style={{ width:`${Math.round(raceProg*100)}%`,height:"100%",background:"var(--noir-primary)",borderRadius:2,transition:"width .3s ease" }}/>
            </div>
            {uiPhase==="racing"&&(
              <button type="button" onClick={()=>setManPit(p=>!p)}
                style={{ fontFamily:"'Cinzel',serif",fontSize:9,fontWeight:700,padding:"3px 10px",background:manPit?"rgba(230,80,80,.35)":"rgba(0,0,0,.6)",border:`1px solid ${manPit?"#e74c3c":"rgba(201,164,96,.2)"}`,color:manPit?"#e74c3c":"var(--noir-muted)",cursor:"pointer",touchAction:"manipulation" }}>{manPit?"PIT CALLED":"PIT"}</button>
            )}
          </div>
        )}

        {/* Commentary */}
        <div style={{ position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(to top,rgba(0,0,0,.84),transparent)",padding:"6px 8px",pointerEvents:"none" }}>
          <div style={{ fontFamily:"'Crimson Text',serif",fontStyle:"italic",fontSize:"clamp(11px,2.5vw,14px)",color:"var(--noir-primary)",textShadow:"0 0 14px rgba(201,164,96,.5)" }}>{commentary}</div>
        </div>

        {/* Countdown */}
        {uiPhase==="countdown"&&(
          <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.72)",pointerEvents:"none" }}>
            <div style={{ fontFamily:"'Cinzel',serif",fontSize:"clamp(40px,12vw,80px)",fontWeight:900,color:countdown>1?"var(--noir-primary)":"#dc2626",textShadow:`0 0 40px ${countdown>1?"rgba(201,164,96,.6)":"rgba(220,38,38,.8)"}`,lineHeight:1 }}>{countdown===0?"GO!":countdown}</div>
          </div>
        )}

        {/* Pit notification */}
        {pitNotif&&(
          <div style={{ position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"rgba(0,0,0,.90)",border:"1px solid var(--noir-primary)",padding:"6px 14px",fontFamily:"'Cinzel',serif",fontSize:"clamp(9px,2.5vw,12px)",letterSpacing:".18em",color:"var(--noir-primary)",whiteSpace:"nowrap",pointerEvents:"none" }}>{pitNotif}</div>
        )}
      </div>

      {/* Leaderboard */}
      {standings.length>0&&(
        <div className={styles.panel} style={{ marginBottom:"0.6rem",overflowX:"auto",WebkitOverflowScrolling:"touch" }}>
          <div style={{ padding:"6px 8px 4px",borderBottom:"1px solid rgba(201,164,96,.2)",fontFamily:"'Cinzel',serif",fontSize:11,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:"var(--noir-primary)" }}>Leaderboard</div>
          {!narrow&&(
            <div style={{ display:"flex",alignItems:"center",padding:"4px 8px",borderBottom:"1px solid rgba(201,164,96,.10)",gap:"6px",fontSize:9,fontFamily:"'Cinzel',serif",fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:"var(--noir-muted)" }}>
              <div style={{ width:20,flexShrink:0 }}/>
              <div style={{ width:9,flexShrink:0 }}/>
              <div style={{ flex:1 }}>Driver</div>
              <div style={{ width:55,flexShrink:0 }}>Tyre</div>
              <div style={{ width:56,textAlign:"right",flexShrink:0 }}>Gap</div>
            </div>
          )}
          {[...standings].sort((a,b)=>(a.position||0)-(b.position||0)).map((r,i)=>{
            const td2=TYRE_DEFS[r.currentTyre]||TYRE_DEFS.medium, wc=tyreColor(r.tyreWear);
            const lapsDown=r.lapsDown||0;
            let gapStr="Leader";
            if(r.dnf)gapStr="DNF";
            else if(r.inPit)gapStr=r.pitTimeRemaining>0?`PIT ${r.pitTimeRemaining.toFixed(1)}s`:"PIT";
            else if(r.position>1){
              if(lapsDown>=1)gapStr=`${lapsDown} lap${lapsDown>1?"s":""}`;
              else gapStr=r.gapSec>0?`+${r.gapSec.toFixed(2)}s`:"—";
            }
            const pos=r.position||i+1;
            return(
              <div key={r.id} style={{ display:"flex",alignItems:"center",padding:narrow?"4px 6px":"5px 8px",borderBottom:"1px solid rgba(201,164,96,.06)",background:r.isPlayer?"rgba(201,164,96,.07)":pos===1?"rgba(201,164,96,.03)":"transparent",gap:narrow?"4px":"6px",opacity:r.dnf?0.5:1 }}>
                <div style={{ width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif",fontSize:10,fontWeight:700,flexShrink:0,background:pos===1?"linear-gradient(135deg,#a87820,#e8c870)":pos===2?"rgba(160,160,160,.2)":pos===3?"rgba(140,80,20,.2)":"rgba(201,164,96,.06)",color:pos===1?"#0a0c06":pos===2?"#bbb":pos===3?"#c07a30":"var(--noir-muted)",border:"1px solid rgba(201,164,96,.15)" }}>{pos}</div>
                <div style={{ width:9,height:9,borderRadius:"50%",background:r.color,flexShrink:0,boxShadow:`0 0 5px ${r.color}80` }}/>
                <div style={{ flex:1,fontSize:narrow?11:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                  {r.name}{r.isPlayer&&<span style={{ color:"var(--noir-primary)",fontSize:10,marginLeft:4 }}>(You)</span>}
                  {r.hasFastestLap&&<span style={{ color:"#a020f0",fontSize:10,marginLeft:3 }}>⚡</span>}
                  {r.inSlipstream&&<span style={{ color:"#5090e0",fontSize:9,marginLeft:2 }}>↗</span>}
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:4,width:narrow?40:55,flexShrink:0 }} title={`${td2.label} — ${Math.round(r.tyreWear)}%`}>
                  <div style={{ width:8,height:8,borderRadius:"50%",background:td2.color,flexShrink:0 }}/>
                  <div style={{ flex:1,height:3,background:"rgba(201,164,96,.1)",borderRadius:2,overflow:"hidden" }}>
                    <div style={{ height:"100%",width:`${r.tyreWear}%`,background:wc,borderRadius:2,transition:"width .5s" }}/>
                  </div>
                </div>
                <div style={{ fontFamily:"'Rajdhani',sans-serif",fontSize:11,width:narrow?44:56,textAlign:"right",flexShrink:0,color:r.dnf?"#e74c3c":r.inPit?"#ff9800":pos===1?"var(--noir-primary)":"var(--noir-muted)",fontWeight:r.dnf||r.inPit||pos===1?700:400 }}>{gapStr}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Live mode controls (standalone only, not interactive-live) */}
      {mode==="live"&&(
        <div style={{ display:"flex",gap:"0.5rem",alignItems:"center",flexWrap:"wrap",marginBottom:"0.6rem" }}>
          {uiPhase==="setup"&&(
            <button type="button" onClick={handleStart}
              style={{ fontFamily:"'Cinzel',serif",fontSize:"9px",fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",padding:"10px 18px",minHeight:44,border:"1px solid var(--noir-primary)",background:"linear-gradient(135deg,#6a4010,#c9a460)",color:"#0a0c06",cursor:"pointer",touchAction:"manipulation" }}>
              Start Race
            </button>
          )}
          {(uiPhase==="qualifying"||uiPhase==="racing"||uiPhase==="done")&&(
            <button type="button" onClick={handleReset}
              style={{ fontFamily:"'Cinzel',serif",fontSize:"9px",letterSpacing:".2em",textTransform:"uppercase",padding:"10px 16px",minHeight:44,border:"1px solid var(--noir-border)",background:"rgba(201,164,96,.07)",color:"var(--noir-primary)",cursor:"pointer",touchAction:"manipulation" }}>
              Reset
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {results&&(
        <div className={styles.panel} style={{ padding:"0.75rem" }}>
          <div className="font-heading" style={{ fontSize:"11px",letterSpacing:".25em",textTransform:"uppercase",color:"var(--noir-primary)",marginBottom:"0.5rem" }}>Race Results</div>
          {results.length>=3&&(
            <div style={{ display:"flex",justifyContent:"center",alignItems:"flex-end",gap:4,marginBottom:12,padding:"8px 0" }}>
              {[1,0,2].map(pi=>{
                const r=results[pi]; if(!r||r.dnf)return null;
                const hs=[60,44,34][pi], cs=["linear-gradient(135deg,#a87820,#e8c870)","linear-gradient(135deg,#888,#ccc)","linear-gradient(135deg,#8b4513,#cd853f)"][pi];
                const ls=["1st","2nd","3rd"][pi];
                return(
                  <div key={pi} style={{ display:"flex",flexDirection:"column",alignItems:"center",width:70 }}>
                    <div style={{ width:9,height:9,borderRadius:"50%",background:r.color,marginBottom:3,boxShadow:`0 0 8px ${r.color}` }}/>
                    <div style={{ fontSize:10,fontWeight:600,color:"var(--noir-foreground)",textAlign:"center",maxWidth:70,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2 }}>{r.name}</div>
                    <div style={{ width:56,height:hs,background:cs,borderRadius:"4px 4px 0 0",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif",fontSize:12,fontWeight:700,color:pi===0?"#0a0c06":pi===1?"#333":"#fff" }}>{ls}</div>
                  </div>
                );
              })}
            </div>
          )}
          {results.map((r,i)=>{
            const bR=rewardsProp?.find(rw=>rw.entrant_id===r.id);
            const pool=[0.40,0.25,0.15,0.10,0.05,0.03,0.02,0.00];
            const purse=bR?(bR.cash||0):r.dnf?0:Math.round(5000*8*0.9*(pool[i]||0));
            return(
              <div key={r.id} style={{ display:"flex",alignItems:"center",gap:"6px",padding:"6px 8px",borderBottom:"1px solid rgba(201,164,96,.06)",background:r.isPlayer?"rgba(201,164,96,.07)":"transparent",opacity:r.dnf?0.5:1 }}>
                <div style={{ width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif",fontSize:11,fontWeight:700,background:i===0&&!r.dnf?"linear-gradient(135deg,#a87820,#e8c870)":i===1&&!r.dnf?"rgba(160,160,160,.2)":i===2&&!r.dnf?"rgba(140,80,20,.2)":"rgba(201,164,96,.06)",color:i===0&&!r.dnf?"#0a0c06":i===1&&!r.dnf?"#bbb":i===2&&!r.dnf?"#c07a30":"var(--noir-muted)",border:"1px solid rgba(201,164,96,.15)" }}>{r.dnf?"X":i+1}</div>
                <div style={{ width:9,height:9,borderRadius:"50%",background:r.color,flexShrink:0 }}/>
                <div style={{ flex:1,fontSize:13,fontWeight:600 }}>{r.name}{r.isPlayer&&<span style={{ color:"var(--noir-primary)",fontSize:10,marginLeft:4 }}>(You)</span>}{r.hasFastestLap&&<span style={{ color:"#a020f0",fontSize:10,marginLeft:3 }}>⚡</span>}{r.dnf&&<span style={{ color:"#e74c3c",fontSize:10,marginLeft:4 }}>DNF</span>}</div>
                {!narrow&&<div style={{ fontSize:11,color:"var(--noir-muted)" }}>{r.carName}</div>}
                <div style={{ fontSize:10,color:"var(--noir-muted)" }}>{r.pitStops} pit{r.pitStops!==1?"s":""}</div>
                {r.bestLap&&<div style={{ fontSize:10,color:"var(--noir-muted)" }}>{r.bestLap.toFixed(2)}s</div>}
                {!r.dnf&&<div style={{ fontFamily:"'Cinzel',serif",fontSize:11,color:"var(--noir-primary)",background:"rgba(201,164,96,.08)",border:"1px solid var(--noir-border)",padding:"1px 7px" }}>${purse.toLocaleString()}</div>}
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes winPulse{0%,100%{border-color:var(--noir-border)}50%{border-color:var(--noir-primary);box-shadow:0 0 18px rgba(201,164,96,.3)}}`}</style>
    </div>
  );
}

// ─── TRACK THUMBNAIL ───────────────────────────────────────────────────────

function TrackThumb({ track, active }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    const W=200, H=72;
    ctx.fillStyle="#0d1208"; ctx.fillRect(0,0,W,H);
    const pts=[];
    for (let i=0; i<=300; i++) pts.push(track.getPoint(i/300));
    let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity;
    pts.forEach(p=>{mnX=Math.min(mnX,p.x);mxX=Math.max(mxX,p.x);mnY=Math.min(mnY,p.y);mxY=Math.max(mxY,p.y);});
    const rX=mxX-mnX||1, rY=mxY-mnY||1, pad=8;
    const scale=Math.min((W-pad*2)/rX,(H-pad*2)/rY);
    const offX=(W-rX*scale)/2, offY=(H-rY*scale)/2;
    ctx.beginPath();
    pts.forEach((p,i)=>{const x=(p.x-mnX)*scale+offX,y=(p.y-mnY)*scale+offY;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    ctx.closePath();
    ctx.strokeStyle=active?"rgba(232,200,112,0.18)":"rgba(201,164,96,0.12)"; ctx.lineWidth=3; ctx.lineJoin="round"; ctx.stroke();
    ctx.strokeStyle=active?"#e8c870":"#c9a460"; ctx.lineWidth=active?2:1.5; ctx.stroke();
    // Track width fill
    ctx.strokeStyle=active?"rgba(232,200,112,0.10)":"rgba(201,164,96,0.07)"; ctx.lineWidth=active?6:4; ctx.stroke();
  }, [track, active]);
  return <canvas ref={ref} width={200} height={72} style={{ width:"100%",height:40,display:"block" }}/>;
}

export { TRACKS, TrackThumb };
