import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import api, { getApiErrorMessage, refreshUser } from "../../utils/api";
import useMinigamePlaysLeft from "../../hooks/useMinigamePlaysLeft";
import styles from "../../styles/noir.module.css";

const GRAVITY = 0.25;
const JUMP_FORCE = -5.8;
const TERMINAL_VEL = 6;
const FIXED_DT = 1000 / 60;
const PIPE_SPEED_BASE = 3.0;
const PIPE_GAP_BASE = 175;
const PIPE_WIDTH = 62;
const BIRD_SIZE = 36;
const VIEW_W = 420;
const VIEW_H = 580;

/** Score gates required for unlocks (themes, characters, insane mode) — tuned ~10× vs original easy curve */
const GATE = (n) => n * 10;

const SPEED_OPTIONS = [
  { id: "slow", label: "Slow", mult: 0.7 },
  { id: "normal", label: "Normal", mult: 1 },
  { id: "fast", label: "Fast", mult: 1.4 },
];

const DIFFICULTY_OPTIONS = [
  { id: "easy", label: "Easy", gapOffset: 25, speedMult: 0.85 },
  { id: "normal", label: "Normal", gapOffset: 0, speedMult: 1 },
  { id: "hard", label: "Hard", gapOffset: -30, speedMult: 1.25 },
  { id: "insane", label: "Insane", gapOffset: -55, speedMult: 1.65, unlockScore: GATE(25) },
];

// ─── CHARACTERS ──────────────────────────────────────────────────────────────
// Each character is an SVG component rendered at position (x,y) with rotation
const CHARACTERS = [
  {
    id: "fedora",
    name: "The Don",
    desc: "Classic fedora. Old school, still deadly.",
    unlockType: "free",
    price: 0,
    unlockScore: 0,
    accentOverride: null,
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "var(--noir-primary)";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          <ellipse cx="18" cy="22" rx="14" ry="10" fill={col} />
          <ellipse cx="18" cy="14" rx="18" ry="5" fill="var(--noir-bg)" />
          <rect x="8" y="4" width="20" height="12" rx="4" fill="var(--noir-panel)" />
          <rect x="8" y="13" width="20" height="3" fill={col} />
          <circle cx="25" cy="20" r="3" fill="var(--noir-bg)" />
          <circle cx="26" cy="19" r="1" fill="#fff" />
          <rect x="30" y="22" width="8" height="2" rx="1" fill="#e8e0d0" />
          <circle cx="38" cy="23" r="2" fill="#ff6b35" opacity="0.9" />
        </g>
      );
    },
  },
  {
    id: "tommy",
    name: "Tommy Gun",
    desc: "Armed & dangerous. Spray and pray.",
    unlockType: "score",
    price: 0,
    unlockScore: GATE(10),
    accentOverride: "#dc2626",
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "#dc2626";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          {/* Body */}
          <ellipse cx="18" cy="18" rx="13" ry="13" fill="#1a1a1a" />
          <ellipse cx="18" cy="18" rx="10" ry="10" fill="#2a1a1a" />
          {/* Face */}
          <circle cx="14" cy="15" r="2" fill="#888" />
          <circle cx="22" cy="15" r="2" fill="#888" />
          <path d="M13 22 Q18 26 23 22" stroke={col} strokeWidth="1.5" fill="none" />
          {/* Tommy gun */}
          <rect x="26" y="14" width="12" height="5" rx="1" fill="#555" />
          <rect x="34" y="11" width="2" height="4" rx="0.5" fill="#444" />
          <circle cx="31" cy="22" r="3" fill="#444" />
          {/* Hat - flat cap */}
          <ellipse cx="18" cy="8" rx="14" ry="4" fill={col} />
          <rect x="8" y="4" width="20" height="6" rx="2" fill="#111" />
          <rect x="4" y="7" width="8" height="2" rx="1" fill={col} />
        </g>
      );
    },
  },
  {
    id: "vinnie",
    name: "Vinnie Lugs",
    desc: "Enforcer. Ears everywhere, fists first.",
    unlockType: "score",
    price: 0,
    unlockScore: GATE(12),
    accentOverride: "#b45309",
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "#b45309";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          <ellipse cx="18" cy="20" rx="14" ry="12" fill="#1c1917" />
          <ellipse cx="18" cy="14" rx="11" ry="10" fill="#d4a574" />
          <path d="M12 13 L14 11 L16 13" stroke="#7f1d1d" strokeWidth="1.2" fill="none" />
          <circle cx="21" cy="12" r="1.8" fill="#333" />
          <rect x="10" y="4" width="16" height="7" rx="2" fill="#292524" />
          <rect x="8" y="9" width="20" height="3" rx="1" fill={col} />
          <rect x="28" y="16" width="6" height="8" rx="1" fill="#444" />
          <rect x="30" y="14" width="2" height="4" fill="#222" />
        </g>
      );
    },
  },
  {
    id: "molly",
    name: "Molly Malone",
    desc: "The underboss's right hand. Don't cross her.",
    unlockType: "cash",
    price: 15000,
    unlockScore: 0,
    accentOverride: "#ec4899",
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "#ec4899";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          {/* Body */}
          <ellipse cx="18" cy="20" rx="11" ry="12" fill="#1e0a14" />
          {/* Dress detail */}
          <path d="M10 24 Q18 30 26 24 L26 32 Q18 38 10 32 Z" fill={col} opacity="0.6" />
          {/* Face */}
          <ellipse cx="18" cy="13" rx="9" ry="9" fill="#f5d5c5" />
          <circle cx="15" cy="12" r="1.5" fill="#333" />
          <circle cx="21" cy="12" r="1.5" fill="#333" />
          <path d="M15 17 Q18 20 21 17" stroke={col} strokeWidth="1.5" fill="none" />
          {/* Hair */}
          <ellipse cx="18" cy="6" rx="10" ry="5" fill="#1a0a0a" />
          <path d="M8 8 Q6 14 9 18" stroke="#1a0a0a" strokeWidth="4" fill="none" />
          <path d="M28 8 Q30 14 27 18" stroke="#1a0a0a" strokeWidth="4" fill="none" />
          {/* Hat pin */}
          <ellipse cx="18" cy="5" rx="8" ry="3" fill={col} opacity="0.8" />
          <circle cx="24" cy="4" r="2" fill={col} />
          <circle cx="24" cy="4" r="1" fill="#fff" opacity="0.6" />
          {/* Cigarette */}
          <rect x="26" y="17" width="8" height="2" rx="1" fill="#e8e0d0" />
          <circle cx="34" cy="18" r="1.5" fill="#ff6b35" />
        </g>
      );
    },
  },
  {
    id: "skeleton",
    name: "Dead Eyes",
    desc: "Already dead. Nothing to fear.",
    unlockType: "score",
    price: 0,
    unlockScore: GATE(30),
    accentOverride: "#94a3b8",
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "#94a3b8";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          {/* Skull */}
          <ellipse cx="18" cy="16" rx="12" ry="12" fill="#e8e8e0" />
          {/* Eye sockets */}
          <ellipse cx="14" cy="14" rx="4" ry="4.5" fill="#111" />
          <ellipse cx="22" cy="14" rx="4" ry="4.5" fill="#111" />
          {/* Glow eyes */}
          <ellipse cx="14" cy="14" rx="2" ry="2.5" fill={col} opacity="0.7" />
          <ellipse cx="22" cy="14" rx="2" ry="2.5" fill={col} opacity="0.7" />
          {/* Nose cavity */}
          <path d="M16 19 L18 21 L20 19" fill="#111" />
          {/* Teeth */}
          <rect x="11" y="23" width="14" height="5" rx="1" fill="#e8e8e0" />
          {[13, 16, 19, 22].map(tx => (
            <rect key={tx} x={tx} y="23" width="2" height="4" rx="0.5" fill="#111" />
          ))}
          {/* Top hat */}
          <rect x="10" y="1" width="16" height="8" rx="1" fill="#111" />
          <rect x="7" y="9" width="22" height="2" rx="1" fill="#111" />
          <rect x="10" y="2" width="16" height="1" fill={col} opacity="0.4" />
        </g>
      );
    },
  },
  {
    id: "wheelman",
    name: "The Wheelman",
    desc: "Getaway driver. Never misses a gap.",
    unlockType: "score",
    price: 0,
    unlockScore: GATE(35),
    accentOverride: "#0ea5e9",
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "#0ea5e9";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          <ellipse cx="18" cy="19" rx="12" ry="11" fill="#1e293b" />
          <circle cx="18" cy="13" r="9" fill="#e7c8a8" />
          <rect x="10" y="5" width="16" height="5" rx="2" fill="#0f172a" />
          <rect x="7" y="8" width="22" height="2" rx="1" fill={col} />
          <circle cx="15" cy="12" r="1.5" fill="#333" />
          <circle cx="21" cy="12" r="1.5" fill="#333" />
          <ellipse cx="18" cy="28" rx="10" ry="4" fill="#334155" opacity="0.9" />
          <circle cx="18" cy="28" r="5" fill="none" stroke={col} strokeWidth="2" />
          <rect x="16" y="26" width="4" height="5" fill="#64748b" />
        </g>
      );
    },
  },
  {
    id: "bishop",
    name: "The Bishop",
    desc: "Blessed by the mob. Consecrated corruption.",
    unlockType: "cash",
    price: 50000,
    unlockScore: 0,
    accentOverride: "#7c3aed",
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "#7c3aed";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          {/* Robe */}
          <path d="M8 18 Q6 32 8 36 L28 36 Q30 32 28 18 Q18 22 8 18Z" fill={col} opacity="0.85" />
          {/* Cross on robe */}
          <rect x="16" y="24" width="4" height="8" rx="0.5" fill="#ffd700" opacity="0.8" />
          <rect x="13" y="27" width="10" height="3" rx="0.5" fill="#ffd700" opacity="0.8" />
          {/* Face */}
          <ellipse cx="18" cy="16" rx="8" ry="8" fill="#f0d5b0" />
          <circle cx="15" cy="14" r="1.5" fill="#333" />
          <circle cx="21" cy="14" r="1.5" fill="#333" />
          <path d="M15 19 Q18 22 21 19" stroke="#7a5c3a" strokeWidth="1.2" fill="none" />
          {/* Mitre hat */}
          <path d="M10 12 L14 1 L18 8 L22 1 L26 12 Z" fill={col} />
          <path d="M10 12 L26 12" stroke="#ffd700" strokeWidth="1.5" />
          <line x1="18" y1="2" x2="18" y2="12" stroke="#ffd700" strokeWidth="1" />
          {/* Collar */}
          <rect x="12" y="17" width="12" height="4" rx="2" fill="#fff" opacity="0.9" />
        </g>
      );
    },
  },
  {
    id: "ghost",
    name: "The Ghost",
    desc: "No one knows who he is. Elite gate count unlocks him.",
    unlockType: "score",
    price: 0,
    unlockScore: GATE(60),
    accentOverride: "#00ffcc",
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "#00ffcc";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          {/* Ghost body */}
          <path d="M6 20 Q6 6 18 4 Q30 6 30 20 L30 34 Q25 30 22 34 Q19 30 18 34 Q17 30 14 34 Q11 30 6 34 Z"
            fill={col} opacity="0.18" />
          <path d="M6 20 Q6 6 18 4 Q30 6 30 20 L30 34 Q25 30 22 34 Q19 30 18 34 Q17 30 14 34 Q11 30 6 34 Z"
            stroke={col} strokeWidth="1.5" fill="none" opacity="0.7" />
          {/* Eyes */}
          <ellipse cx="14" cy="17" rx="3" ry="3.5" fill={col} opacity="0.9" />
          <ellipse cx="22" cy="17" rx="3" ry="3.5" fill={col} opacity="0.9" />
          <ellipse cx="14" cy="17" rx="1.5" ry="1.8" fill="#000" />
          <ellipse cx="22" cy="17" rx="1.5" ry="1.8" fill="#000" />
          {/* Inner glow */}
          <ellipse cx="18" cy="20" rx="8" ry="6" fill={col} opacity="0.06" />
        </g>
      );
    },
  },
  {
    id: "kingpin",
    name: "The Kingpin",
    desc: "Runs the whole city. Prove you're worthy.",
    unlockType: "score",
    price: 0,
    unlockScore: GATE(70),
    accentOverride: "#fbbf24",
    render: ({ x, y, rotation, accent }) => {
      const col = accent || "#fbbf24";
      return (
        <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
          <ellipse cx="18" cy="21" rx="13" ry="11" fill="#0c0a09" />
          <ellipse cx="18" cy="13" rx="10" ry="9" fill="#c9a87c" />
          <circle cx="15" cy="12" r="1.5" fill="#1a1a1a" />
          <circle cx="21" cy="12" r="1.5" fill="#1a1a1a" />
          <path d="M14 17 Q18 19 22 17" stroke="#3f2e1f" strokeWidth="1" fill="none" />
          <path d="M8 6 L28 6 L26 2 L10 2 Z" fill="#1c1917" />
          <ellipse cx="18" cy="5" rx="12" ry="3" fill={col} opacity="0.85" />
          <rect x="14" y="20" width="8" height="2" fill={col} opacity="0.6" />
        </g>
      );
    },
  },
];

// ─── THEMES ──────────────────────────────────────────────────────────────────
const THEMES = [
  {
    id: "classic", name: "Downtown", unlockType: "free",
    sky: ["#282828", "#1a1a1a", "#000"], pipe: "var(--noir-panel)",
    brick: "rgba(140,90,40,0.32)", accent: "#b49650",
    stripe: "rgba(180,150,80,0.05)", groundColor: "var(--noir-bg)",
    groundAccent: "rgba(180,150,80,0.2)",
    bgElements: "buildings",
  },
  {
    id: "neon", name: "Neon District", unlockType: "score", unlockScore: GATE(5),
    sky: ["#0a0a1a", "#050510", "#000"], pipe: "#1a1a2e",
    brick: "rgba(80,200,255,0.25)", accent: "#00ffcc",
    stripe: "rgba(0,255,200,0.08)", groundColor: "#0a0a1a",
    groundAccent: "rgba(0,255,200,0.25)",
    bgElements: "neon",
  },
  {
    id: "sunset", name: "Sunset Strip", unlockType: "cash", unlockCash: 5000,
    sky: ["#2a1810", "#1a0c08", "#0d0604"], pipe: "#3d2817",
    brick: "rgba(180,80,40,0.35)", accent: "#e8a030",
    stripe: "rgba(232,160,48,0.06)", groundColor: "#1a0804",
    groundAccent: "rgba(232,160,48,0.3)",
    bgElements: "palms",
  },
  {
    id: "graveyard", name: "Graveyard", unlockType: "score", unlockScore: GATE(20),
    sky: ["#1a1e1a", "#0e120e", "#050805"], pipe: "#252a25",
    brick: "rgba(80,100,70,0.3)", accent: "#8a9a6a",
    stripe: "rgba(138,154,106,0.06)", groundColor: "#0d100d",
    groundAccent: "rgba(138,154,106,0.2)",
    bgElements: "graves",
  },
  {
    id: "speakeasy", name: "Speakeasy", unlockType: "cash", unlockCash: 25000,
    sky: ["#1a1208", "#120e06", "#080604"], pipe: "#2a1e0e",
    brick: "rgba(200,160,80,0.22)", accent: "#d4af37",
    stripe: "rgba(212,175,55,0.07)", groundColor: "#120e06",
    groundAccent: "rgba(212,175,55,0.35)",
    bgElements: "bottles",
  },
  {
    id: "casino", name: "Casino Royale", unlockType: "score", unlockScore: GATE(40),
    sky: ["#1a0808", "#100404", "#050000"], pipe: "#2a1414",
    brick: "rgba(200,30,30,0.28)", accent: "#ff2244",
    stripe: "rgba(255,34,68,0.07)", groundColor: "#100404",
    groundAccent: "rgba(255,34,68,0.3)",
    bgElements: "cards",
  },
  {
    id: "arctic", name: "Arctic Run", unlockType: "score", unlockScore: GATE(50),
    sky: ["#0d1a2a", "#061018", "#020608"], pipe: "#1a2a3a",
    brick: "rgba(120,180,240,0.22)", accent: "#88ccff",
    stripe: "rgba(136,204,255,0.07)", groundColor: "#061018",
    groundAccent: "rgba(136,204,255,0.3)",
    bgElements: "aurora",
  },
  {
    id: "subway", name: "Subway Run", unlockType: "score", unlockScore: GATE(55),
    sky: ["#1a1510", "#0f0c08", "#080604"], pipe: "#3d3428",
    brick: "rgba(180,140,80,0.2)", accent: "#f59e0b",
    stripe: "rgba(245,158,11,0.08)", groundColor: "#0c0a08",
    groundAccent: "rgba(245,158,11,0.28)",
    bgElements: "subway",
  },
  {
    id: "harbor", name: "Harbor Night", unlockType: "score", unlockScore: GATE(65),
    sky: ["#0a1520", "#050d18", "#020810"], pipe: "#1e3a4a",
    brick: "rgba(60,100,140,0.28)", accent: "#38bdf8",
    stripe: "rgba(56,189,248,0.07)", groundColor: "#050d12",
    groundAccent: "rgba(56,189,248,0.25)",
    bgElements: "harbor",
  },
  {
    id: "hellfire", name: "Hellfire Row", unlockType: "score", unlockScore: GATE(75),
    sky: ["#2a0a04", "#180502", "#0a0201"], pipe: "#3d1510",
    brick: "rgba(220,60,30,0.3)", accent: "#f97316",
    stripe: "rgba(249,115,22,0.09)", groundColor: "#120502",
    groundAccent: "rgba(249,115,22,0.35)",
    bgElements: "embers",
  },
  {
    id: "penthouse", name: "Penthouse", unlockType: "cash", unlockCash: 100_000,
    sky: ["#1e1b2e", "#12101c", "#08060c"], pipe: "#2d2840",
    brick: "rgba(200,180,255,0.18)", accent: "#c4b5fd",
    stripe: "rgba(196,181,253,0.08)", groundColor: "#100e18",
    groundAccent: "rgba(196,181,253,0.3)",
    bgElements: "penthouse",
  },
];

const REWARD_TIERS = [
  { score: 1, cash: 63, respect: 5, label: "Street Punk" },
  { score: 5, cash: 250, respect: 5, label: "Corner Boy" },
  { score: 10, cash: 625, respect: 10, label: "Made Man" },
  { score: 20, cash: 1500, respect: 20, label: "Underboss" },
  { score: 35, cash: 3125, respect: 20, label: "Capo" },
  { score: 50, cash: 6250, respect: 40, label: "Don" },
];
const MAX_CASH_CAP = 250_000;
const MAX_RESPECT_CAP = 1_000;
const CASH_PER_GATE_AFTER_50 = 500;
const RESPECT_PER_GATE_AFTER_50 = 2;

function getReward(score) {
  let cash = 0, respect = 0, label = "Nobody", tier = -1;
  for (let i = 0; i < REWARD_TIERS.length; i++) {
    if (score >= REWARD_TIERS[i].score) {
      cash += REWARD_TIERS[i].cash; respect += REWARD_TIERS[i].respect;
      label = REWARD_TIERS[i].label; tier = i;
    }
  }
  if (score > 50) {
    const extra = score - 50;
    cash += Math.min(MAX_CASH_CAP - cash, extra * CASH_PER_GATE_AFTER_50);
    respect += Math.min(MAX_RESPECT_CAP - respect, extra * RESPECT_PER_GATE_AFTER_50);
  }
  return { cash: Math.min(MAX_CASH_CAP, cash), respect: Math.min(MAX_RESPECT_CAP, respect), label, tier };
}

function getNextTier(score) {
  if (score >= 50) return { score: score + 10, cash: CASH_PER_GATE_AFTER_50 * 10, respect: RESPECT_PER_GATE_AFTER_50 * 10, label: `${score + 10} gates` };
  for (const t of REWARD_TIERS) { if (score < t.score) return t; }
  return null;
}

// ─── BACKGROUND ELEMENTS ─────────────────────────────────────────────────────
function BgElements({ theme, bgOffset, tick }) {
  const t = tick || 0;
  if (theme.bgElements === "buildings") {
    return (
      <g opacity="0.3">
        {[0, 40, 80, 120, 160, 200, 240, 280, 320, 360].map((bx, i) => (
          <rect key={i} x={bx} y={VIEW_H - 80 - (i % 3) * 40 - (i % 5) * 20}
            width={35} height={80 + (i % 3) * 40 + (i % 5) * 20} fill="rgba(0,0,0,0.28)" />
        ))}
        {/* Window lights */}
        {[20, 60, 100, 180, 260, 340].map((bx, i) => (
          <g key={`w${i}`}>
            <rect x={bx + 5} y={VIEW_H - 110 - (i % 3) * 35} width={5} height={5} fill="rgba(255,220,100,0.25)" />
            <rect x={bx + 15} y={VIEW_H - 95 - (i % 3) * 35} width={5} height={5} fill="rgba(255,220,100,0.15)" />
          </g>
        ))}
      </g>
    );
  }
  if (theme.bgElements === "neon") {
    return (
      <g>
        {/* Animated neon signs */}
        {[30, 180, 310].map((bx, i) => {
          const flash = Math.sin(t * 0.08 + i * 2.1) > 0.3;
          return (
            <g key={i} opacity={flash ? 0.6 : 0.2}>
              <rect x={bx} y={120 + i * 60} width={60} height={20} rx="3" fill="none" stroke={["#00ffcc","#ff00aa","#ffaa00"][i]} strokeWidth="1.5" />
              <text x={bx + 30} y={134 + i * 60} textAnchor="middle" fill={["#00ffcc","#ff00aa","#ffaa00"][i]} fontSize="8" fontFamily="Cinzel,serif">
                {["BOURBON","JAZZ","CASINO"][i]}
              </text>
            </g>
          );
        })}
        {/* Grid lines on ground */}
        <rect x={0} y={VIEW_H - 80} width={VIEW_W} height={80} fill="rgba(0,255,200,0.03)" />
        {[0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400].map((lx, i) => (
          <line key={i} x1={lx} y1={VIEW_H - 80} x2={lx} y2={VIEW_H} stroke="rgba(0,255,200,0.08)" strokeWidth="1" />
        ))}
      </g>
    );
  }
  if (theme.bgElements === "palms") {
    return (
      <g opacity="0.4">
        {[30, 120, 220, 350].map((px, i) => {
          const sway = Math.sin(t * 0.04 + i) * 3;
          return (
            <g key={i} transform={`translate(${px}, 0)`}>
              <rect x={15 + sway * 0.3} y={VIEW_H - 150} width={6} height={120} rx="3" fill="#5a3a1a" />
              {[-30, -15, 0, 15, 30].map((angle, j) => (
                <line key={j} x1={18 + sway * 0.3} y1={VIEW_H - 150}
                  x2={18 + sway * 0.3 + Math.cos((angle + sway) * Math.PI / 180) * 35}
                  y2={VIEW_H - 150 + Math.sin((angle + sway + 30) * Math.PI / 180) * 20}
                  stroke="#2d5a1a" strokeWidth="4" />
              ))}
            </g>
          );
        })}
        {/* Sun / moon */}
        <circle cx={VIEW_W - 60} cy={80} r={30} fill="#e8600a" opacity="0.25" />
        <circle cx={VIEW_W - 60} cy={80} r={22} fill="#ff8c00" opacity="0.18" />
      </g>
    );
  }
  if (theme.bgElements === "graves") {
    return (
      <g opacity="0.35">
        {[20, 80, 140, 200, 280, 360].map((gx, i) => (
          <g key={i}>
            <rect x={gx} y={VIEW_H - 100 - (i % 2) * 20} width={28} height={40} rx="14 14 0 0" fill="#2a3a2a" />
            <text x={gx + 14} y={VIEW_H - 72 - (i % 2) * 20} textAnchor="middle" fill="#4a6a4a" fontSize="8" fontFamily="serif">R.I.P</text>
          </g>
        ))}
        {/* Floating orbs */}
        {[50, 160, 290].map((ox, i) => {
          const oy = 200 + Math.sin(t * 0.05 + i * 1.5) * 20;
          return <circle key={i} cx={ox} cy={oy} r={4} fill="#8a9a6a" opacity={0.3 + Math.sin(t * 0.06 + i) * 0.15} />;
        })}
        {/* Fog */}
        <rect x={0} y={VIEW_H - 50} width={VIEW_W} height={50} fill="rgba(80,100,70,0.08)" />
      </g>
    );
  }
  if (theme.bgElements === "bottles") {
    return (
      <g opacity="0.3">
        {/* Bar shelves */}
        <rect x={0} y={180} width={VIEW_W} height={4} fill="#5a3a1a" opacity="0.5" />
        <rect x={0} y={280} width={VIEW_W} height={4} fill="#5a3a1a" opacity="0.5" />
        {[10, 50, 90, 130, 170, 210, 260, 310, 360].map((bx, i) => {
          const h = 25 + (i % 3) * 10;
          const col = ["#8B4513","#d4af37","#2a4a6a","#4a2a6a"][i % 4];
          return (
            <g key={i}>
              <rect x={bx} y={180 - h} width={10} height={h} rx="2" fill={col} opacity="0.6" />
              <ellipse cx={bx + 5} cy={180 - h} rx={5} ry={3} fill={col} opacity="0.7" />
              <rect x={bx + 2} y={175 - h} width={6} height={6} rx="1" fill="#e8d5a0" opacity="0.5" />
            </g>
          );
        })}
      </g>
    );
  }
  if (theme.bgElements === "cards") {
    return (
      <g opacity="0.2">
        {/* Floating cards */}
        {[20, 100, 200, 310].map((cx, i) => {
          const cy = 120 + Math.sin(t * 0.04 + i * 1.2) * 15;
          const rot = Math.sin(t * 0.03 + i) * 8;
          return (
            <g key={i} transform={`translate(${cx}, ${cy}) rotate(${rot}, 12, 18)`}>
              <rect x={0} y={0} width={24} height={36} rx="2" fill="#c0392b" stroke="#ff2244" strokeWidth="0.5" />
              <text x={12} y={22} textAnchor="middle" fill="#fff" fontSize="14" fontFamily="serif">♥</text>
              <text x={4} y={12} fill="#fff" fontSize="8" fontFamily="serif">A</text>
            </g>
          );
        })}
        {/* Dice */}
        <g transform={`translate(350, ${150 + Math.sin(t * 0.05) * 10})`} opacity="0.4">
          <rect x={0} y={0} width={20} height={20} rx="3" fill="#fff" />
          <circle cx={5} cy={5} r={2} fill="#c0392b" />
          <circle cx={15} cy={15} r={2} fill="#c0392b" />
        </g>
      </g>
    );
  }
  if (theme.bgElements === "aurora") {
    return (
      <g>
        {/* Aurora bands */}
        {[0, 1, 2].map(i => {
          const wave = Math.sin(t * 0.02 + i * 1.5);
          const y = 80 + i * 50 + wave * 20;
          return (
            <path key={i}
              d={`M0 ${y} Q${VIEW_W / 4} ${y - 30 + wave * 15} ${VIEW_W / 2} ${y + wave * 10} Q${VIEW_W * 3 / 4} ${y + 30 - wave * 15} ${VIEW_W} ${y}`}
              fill="none" stroke={["#88ccff","#44ffbb","#aa88ff"][i]}
              strokeWidth={20 + i * 8} opacity={0.04 + Math.abs(wave) * 0.03} />
          );
        })}
        {/* Stars */}
        {[...Array(20)].map((_, i) => {
          const sx = (i * 73) % VIEW_W;
          const sy = (i * 47) % (VIEW_H - 120);
          const twinkle = 0.3 + Math.sin(t * 0.1 + i * 0.7) * 0.25;
          return <circle key={i} cx={sx} cy={sy} r={1} fill="#88ccff" opacity={twinkle} />;
        })}
      </g>
    );
  }
  if (theme.bgElements === "subway") {
    return (
      <g opacity="0.35">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => {
          const bx = i * 48 - ((bgOffset || 0) % 48);
          return (
            <g key={i}>
              <rect x={bx} y={VIEW_H - 72} width={4} height={72} fill="#2a2418" />
              <rect x={bx + 8} y={VIEW_H - 68} width={32} height={3} fill="#f59e0b" opacity={0.15 + (Math.sin(t * 0.06 + i) * 0.08 + 0.08)} />
              <rect x={bx + 10} y={140 + (i % 3) * 40} width={20} height={12} rx={1} fill="none" stroke="#78716c" strokeWidth="0.5" opacity={0.4} />
            </g>
          );
        })}
        <text x={VIEW_W / 2} y={95} textAnchor="middle" fill="#f59e0b" fontSize="9" fontFamily="Cinzel,serif" opacity="0.25">LOCAL</text>
      </g>
    );
  }
  if (theme.bgElements === "harbor") {
    return (
      <g opacity="0.32">
        <rect x={0} y={VIEW_H - 42} width={VIEW_W} height={8} fill="#0c4a6e" opacity="0.15" />
        <path d={`M0 ${VIEW_H - 38} Q${VIEW_W * 0.25} ${VIEW_H - 42 - Math.sin(t * 0.04) * 3} ${VIEW_W * 0.5} ${VIEW_H - 38} T${VIEW_W} ${VIEW_H - 36}`}
          fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.2" />
        {[40, 120, 220, 320].map((hx, i) => (
          <g key={i}>
            <rect x={hx} y={VIEW_H - 200 - (i % 2) * 30} width={4} height={160 + (i % 2) * 30} fill="#1e293b" />
            <line x1={hx - 20} y1={VIEW_H - 200 - (i % 2) * 30} x2={hx + 24} y2={VIEW_H - 200 - (i % 2) * 30} stroke="#334155" strokeWidth="2" />
            <rect x={hx + 8} y={VIEW_H - 120} width={28} height={18} rx={1} fill="#0f172a" opacity="0.7" />
            <rect x={hx + 10} y={VIEW_H - 100} width={24} height={16} rx={1} fill="#1e3a5f" opacity="0.5" />
          </g>
        ))}
      </g>
    );
  }
  if (theme.bgElements === "embers") {
    return (
      <g>
        {[...Array(24)].map((_, i) => {
          const ex = ((i * 97 + t * 0.4) % (VIEW_W + 20)) - 10;
          const ey = 80 + (i * 41) % (VIEW_H - 160) + Math.sin(t * 0.05 + i) * 12;
          const op = 0.15 + Math.sin(t * 0.08 + i * 0.9) * 0.12;
          return <circle key={i} cx={ex} cy={ey} r={1.2 + (i % 3) * 0.6} fill="#f97316" opacity={op} />;
        })}
        <ellipse cx={VIEW_W * 0.3} cy={120} rx={80} ry={40} fill="#dc2626" opacity="0.04" />
        <ellipse cx={VIEW_W * 0.75} cy={180} rx={60} ry={50} fill="#f97316" opacity="0.03" />
      </g>
    );
  }
  if (theme.bgElements === "penthouse") {
    return (
      <g opacity="0.28">
        {[0, 55, 110, 165, 220, 275, 330].map((bx, i) => (
          <g key={i}>
            <rect x={bx} y={VIEW_H - 140 - (i % 4) * 25} width={40} height={140 + (i % 4) * 25} fill="#1a1628" />
            {[0, 1, 2, 3].flatMap(row => [0, 1, 2].map(col => (
              <rect key={`${i}-${row}-${col}`} x={bx + 6 + col * 10} y={VIEW_H - 130 - (i % 4) * 25 + row * 12} width={7} height={8} rx={0.5}
                fill={Math.sin(t * 0.04 + i + row + col) > 0.2 ? "rgba(196,181,253,0.35)" : "rgba(30,24,50,0.9)"} />
            )))}
          </g>
        ))}
        <circle cx={VIEW_W - 50} cy={60} r={3} fill="#c4b5fd" opacity={0.2 + Math.sin(t * 0.07) * 0.1} />
      </g>
    );
  }
  return null;
}

// ─── PIPE ────────────────────────────────────────────────────────────────────
function Pipe({ x, topHeight, gap, theme }) {
  const pipeFill = theme?.pipe || "var(--noir-panel)";
  const patternId = `brickPattern-${theme?.id || "classic"}`;
  const bottomY = topHeight + gap;
  const bottomHeight = VIEW_H - bottomY;
  return (
    <g>
      <rect x={x} y={0} width={PIPE_WIDTH} height={topHeight} fill={pipeFill} />
      <rect x={x} y={0} width={PIPE_WIDTH} height={topHeight} fill={`url(#${patternId})`} opacity="0.28" />
      <rect x={x - 4} y={topHeight - 24} width={PIPE_WIDTH + 8} height={24} rx="3" fill={pipeFill} />
      <rect x={x - 4} y={topHeight - 24} width={PIPE_WIDTH + 8} height={24} rx="3" fill={`url(#${patternId})`} opacity="0.22" />
      <rect x={x} y={0} width="3" height={topHeight} fill="rgba(255,255,255,0.10)" />
      <rect x={x} y={bottomY} width={PIPE_WIDTH} height={bottomHeight} fill={pipeFill} />
      <rect x={x} y={bottomY} width={PIPE_WIDTH} height={bottomHeight} fill={`url(#${patternId})`} opacity="0.28" />
      <rect x={x - 4} y={bottomY} width={PIPE_WIDTH + 8} height={24} rx="3" fill={pipeFill} />
      <rect x={x - 4} y={bottomY} width={PIPE_WIDTH + 8} height={24} rx="3" fill={`url(#${patternId})`} opacity="0.22" />
      <rect x={x} y={bottomY} width="3" height={bottomHeight} fill="rgba(255,255,255,0.10)" />
    </g>
  );
}

// ─── CHARACTER SELECT SCREEN ─────────────────────────────────────────────────
function CharacterSelect({ characters, selected, onSelect, money, bestScore, onClose, onBuy, ownedChars = [] }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.92)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "20px", overflowY: "auto",
    }}>
      <div style={{
        width: "100%", maxWidth: 480,
        background: "var(--noir-surface)", border: "1px solid var(--noir-border-mid)",
        borderRadius: 12, padding: "24px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontFamily: "Cinzel,serif", color: "var(--noir-primary)", fontSize: 18, letterSpacing: "0.15em", margin: 0 }}>
            SELECT CHARACTER
          </h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "1px solid var(--noir-border)", color: "var(--noir-muted)", cursor: "pointer", padding: "4px 10px", borderRadius: 4, fontFamily: "Cinzel,serif", fontSize: 11 }}>✕ CLOSE</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {characters.map(char => {
            const isSelected = selected === char.id;
            const isScoreLocked = char.unlockType === "score" && bestScore < char.unlockScore;
            const isOwned = char.unlockType === "free"
              || (char.unlockType === "score" && bestScore >= char.unlockScore)
              || (char.unlockType === "cash" && ownedChars.includes(char.id));
            const locked = isScoreLocked || (char.unlockType === "cash" && !isOwned);

            return (
              <div key={char.id}
                onClick={() => { if (isOwned) onSelect(char.id); }}
                style={{
                  border: `1px solid ${isSelected ? "var(--noir-primary)" : locked ? "var(--noir-border-light)" : "var(--noir-border-mid)"}`,
                  borderRadius: 8, padding: "14px 12px", cursor: isOwned ? "pointer" : "default",
                  background: isSelected ? "rgba(var(--noir-primary-rgb),0.1)" : "var(--noir-content)",
                  opacity: locked ? 0.6 : 1,
                  transition: "all 0.2s",
                  position: "relative",
                }}>
                {/* Character preview */}
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                  <svg width="64" height="64" viewBox="0 0 36 36">
                    <char.render x={0} y={0} rotation={0} accent={char.accentOverride || "var(--noir-primary)"} />
                  </svg>
                </div>
                <div style={{ fontFamily: "Cinzel,serif", fontSize: 11, color: isSelected ? "var(--noir-primary)" : "var(--noir-foreground)", letterSpacing: "0.1em", textAlign: "center", marginBottom: 4 }}>
                  {char.name}
                </div>
                <div style={{ fontSize: 9, color: "var(--noir-muted)", textAlign: "center", lineHeight: 1.3, marginBottom: 8 }}>
                  {char.desc}
                </div>

                {/* Unlock condition */}
                {char.unlockType === "free" && (
                  <div style={{ fontSize: 8, color: "var(--noir-primary)", textAlign: "center", letterSpacing: "0.08em" }}>FREE</div>
                )}
                {char.unlockType === "score" && (
                  <div style={{ fontSize: 8, color: bestScore >= char.unlockScore ? "#22c55e" : "var(--noir-muted)", textAlign: "center" }}>
                    {bestScore >= char.unlockScore ? "✓ UNLOCKED" : `🔒 REACH ${char.unlockScore} GATES`}
                  </div>
                )}
                {char.unlockType === "cash" && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 8, color: "var(--noir-muted)", marginBottom: 4 }}>
                      💰 ${char.price.toLocaleString()}
                    </div>
                    {isOwned ? (
                      <div style={{ fontSize: 8, color: "#22c55e" }}>✓ UNLOCKED</div>
                    ) : (
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); onBuy(char); }}
                        disabled={money < char.price}
                        style={{
                          fontFamily: "Cinzel,serif", fontSize: 9, padding: "4px 10px",
                          border: "1px solid var(--noir-primary)", borderRadius: 4,
                          background: "rgba(var(--noir-primary-rgb),0.15)",
                          color: "var(--noir-primary)", cursor: money >= char.price ? "pointer" : "not-allowed",
                          opacity: money < char.price ? 0.5 : 1,
                        }}>
                        BUY
                      </button>
                    )}
                  </div>
                )}

                {isSelected && (
                  <div style={{ position: "absolute", top: 6, right: 8, fontSize: 9, color: "var(--noir-primary)", fontFamily: "Cinzel,serif" }}>✓</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── THEME SELECT SCREEN ─────────────────────────────────────────────────────
function ThemeSelect({ themes, selected, onSelect, money, bestScore, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.92)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "20px", overflowY: "auto",
    }}>
      <div style={{
        width: "100%", maxWidth: 480,
        background: "var(--noir-surface)", border: "1px solid var(--noir-border-mid)",
        borderRadius: 12, padding: "24px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontFamily: "Cinzel,serif", color: "var(--noir-primary)", fontSize: 18, letterSpacing: "0.15em", margin: 0 }}>
            SELECT WORLD
          </h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "1px solid var(--noir-border)", color: "var(--noir-muted)", cursor: "pointer", padding: "4px 10px", borderRadius: 4, fontFamily: "Cinzel,serif", fontSize: 11 }}>✕ CLOSE</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {themes.map(theme => {
            const isSelected = selected === theme.id;
            const scoreLocked = theme.unlockType === "score" && bestScore < theme.unlockScore;
            const cashLocked = theme.unlockType === "cash" && money < theme.unlockCash;
            const locked = scoreLocked || cashLocked;
            const isOwned = !locked;

            return (
              <div key={theme.id}
                onClick={() => { if (isOwned) onSelect(theme.id); }}
                style={{
                  border: `1px solid ${isSelected ? theme.accent : locked ? "var(--noir-border-light)" : "var(--noir-border-mid)"}`,
                  borderRadius: 8, padding: "12px", cursor: isOwned ? "pointer" : "default",
                  background: isSelected ? `${theme.accent}14` : "var(--noir-content)",
                  opacity: locked ? 0.55 : 1,
                  transition: "all 0.2s",
                }}>
                {/* Mini preview */}
                <svg width="100%" viewBox={`0 0 100 50`} style={{ display: "block", borderRadius: 4, marginBottom: 8, background: theme.sky[1] }}>
                  <defs>
                    <radialGradient id={`prev-sky-${theme.id}`} cx="50%" cy="30%" r="70%">
                      <stop offset="0%" stopColor={theme.sky[0]} />
                      <stop offset="100%" stopColor={theme.sky[2]} />
                    </radialGradient>
                  </defs>
                  <rect width="100" height="50" fill={`url(#prev-sky-${theme.id})`} />
                  <rect x="20" y="0" width="12" height="30" fill={theme.pipe} opacity="0.8" />
                  <rect x="16" y="26" width="20" height="5" rx="1" fill={theme.pipe} opacity="0.8" />
                  <rect x="20" y="36" width="12" height="14" fill={theme.pipe} opacity="0.8" />
                  <rect x="16" y="36" width="20" height="5" rx="1" fill={theme.pipe} opacity="0.8" />
                  <rect x={0} y={44} width={100} height={6} fill={theme.groundColor} />
                  <rect x={0} y={44} width={100} height={1.5} fill={theme.accent} opacity="0.4" />
                  {/* Dots = character silhouette */}
                  <circle cx="65" cy="25" r="5" fill={theme.accent} opacity="0.6" />
                </svg>

                <div style={{ fontFamily: "Cinzel,serif", fontSize: 11, color: isSelected ? theme.accent : "var(--noir-foreground)", letterSpacing: "0.1em", marginBottom: 4 }}>
                  {theme.name}
                </div>

                {theme.unlockType === "free" && (
                  <div style={{ fontSize: 8, color: theme.accent }}>FREE</div>
                )}
                {theme.unlockType === "score" && (
                  <div style={{ fontSize: 8, color: isOwned ? "#22c55e" : "var(--noir-muted)" }}>
                    {isOwned ? `✓ UNLOCKED` : `🔒 ${theme.unlockScore} gates`}
                  </div>
                )}
                {theme.unlockType === "cash" && (
                  <div style={{ fontSize: 8, color: isOwned ? "#22c55e" : "var(--noir-muted)" }}>
                    {isOwned ? `✓ UNLOCKED` : `💰 $${theme.unlockCash?.toLocaleString()}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
const initialGameFrame = () => ({ birdY: VIEW_H / 2, birdVel: 0, birdRot: 0, pipes: [], score: 0, bgOffset: 0 });

export default function Gauntlet() {
  const { playsLeft, maxPlays, canPlay, refresh: refreshPlays, updateFromStart, applyPlaysLeftPayload } = useMinigamePlaysLeft("gauntlet");
  const [gameState, setGameState] = useState("idle");
  const [gameFrame, setGameFrame] = useState(initialGameFrame);
  const { birdY, birdVel, birdRot, pipes, score, bgOffset } = gameFrame;
  const [bestScore, setBestScore] = useState(0);
  const [money, setMoney] = useState(0);
  const [flashGold, setFlashGold] = useState(false);
  const [particles, setParticles] = useState([]);
  const [claimStatus, setClaimStatus] = useState({ state: "idle", cash: 0, respect: 0, message: "" });
  const [lbPeriod, setLbPeriod] = useState("weekly");
  const [top10, setTop10] = useState([]);
  const [themeId, setThemeId] = useState("classic");
  const [speedId, setSpeedId] = useState("normal");
  const [difficultyId, setDifficultyId] = useState("normal");
  const [characterId, setCharacterId] = useState("fedora");
  const [showCharSelect, setShowCharSelect] = useState(false);
  const [showThemeSelect, setShowThemeSelect] = useState(false);
  const [tick, setTick] = useState(0);
  const [ownedChars, setOwnedChars] = useState(["fedora"]);

  const frameRef = useRef(null);
  const stateRef = useRef(gameState);
  const birdYRef = useRef(birdY);
  const birdVelRef = useRef(birdVel);
  const pipesRef = useRef(pipes);
  const scoreRef = useRef(score);
  const bgOffsetRef = useRef(bgOffset);
  const tickRef = useRef(0);
  const lastTimeRef = useRef(null);
  const accumRef = useRef(0);
  const animTickRef = useRef(null);
  const gauntletSessionIdRef = useRef(null);

  stateRef.current = gameState;
  birdYRef.current = birdY;
  birdVelRef.current = birdVel;
  pipesRef.current = pipes;
  scoreRef.current = score;
  bgOffsetRef.current = bgOffset;

  const isTouch = useMemo(() => {
    if (typeof window === "undefined") return false;
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }, []);

  // Ambient animation tick (for backgrounds when not playing)
  useEffect(() => {
    const run = () => { setTick(t => t + 1); animTickRef.current = requestAnimationFrame(run); };
    animTickRef.current = requestAnimationFrame(run);
    return () => cancelAnimationFrame(animTickRef.current);
  }, []);

  useEffect(() => {
    let mounted = true;
    api.get("/auth/me").then(r => { if (mounted) setMoney(Number(r.data?.money || 0)); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const loadLeaderboard = useCallback(async (period) => {
    try {
      const r = await api.get("/gauntlet/leaderboard", { params: { period: period || lbPeriod || "weekly" } });
      setTop10(Array.isArray(r.data?.top10) ? r.data.top10 : []);
    } catch (_) { setTop10([]); }
  }, [lbPeriod]);

  useEffect(() => { loadLeaderboard(lbPeriod); }, [lbPeriod, loadLeaderboard]);

  const spawnParticles = useCallback((x, y, color = "var(--noir-primary-bright)") => {
    const newP = Array.from({ length: 8 }, (_, i) => ({
      id: Date.now() + i, x, y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 1, color,
    }));
    setParticles(p => [...p, ...newP]);
    setTimeout(() => setParticles(p => p.filter(pt => !newP.find(n => n.id === pt.id))), 800);
  }, []);

  const claimReward = useCallback(async (finalScore) => {
    if (claimStatus.state === "claiming" || claimStatus.state === "claimed") return;
    const runSessionId = gauntletSessionIdRef.current;
    if (!runSessionId) {
      setClaimStatus({
        state: "error", cash: 0, respect: 0,
        message: "Run session missing. Refresh the page and try again.",
      });
      return;
    }
    setClaimStatus({ state: "claiming", cash: 0, respect: 0, message: "" });
    try {
      const res = await api.post("/gauntlet/claim", {
        score: Number(finalScore || 0),
        session_id: runSessionId,
        theme: themeId, speed: speedId,
        difficulty: difficultyId, character: characterId,
      });
      if (gauntletSessionIdRef.current === runSessionId) gauntletSessionIdRef.current = null;
      const r = getReward(Number(finalScore || 0));
      const cash = r.cash;
      const respect = r.respect;
      void refreshUser();
      if (res.data?.plays_left != null) applyPlaysLeftPayload(res.data);
      else refreshPlays();
      const playsMsg = res.data?.plays_left != null ? ` • Plays left: ${res.data.plays_left}` : "";
      const parts = [];
      if (cash > 0) parts.push(`$${cash.toLocaleString()}`);
      if (respect > 0) parts.push(`${respect} respect`);
      setClaimStatus({ state: "claimed", cash, respect, message: (parts.length ? `Claimed ${parts.join(" & ")}` : "No reward") + playsMsg });
      loadLeaderboard(lbPeriod);
    } catch (e) {
      if (gauntletSessionIdRef.current === runSessionId) gauntletSessionIdRef.current = null;
      setClaimStatus({ state: "error", cash: 0, respect: 0, message: getApiErrorMessage(e) });
      refreshPlays();
    }
  }, [claimStatus.state, lbPeriod, loadLeaderboard, themeId, speedId, difficultyId, characterId, refreshPlays, applyPlaysLeftPayload]);

  const handleBuyCharacter = useCallback(async (char) => {
    if (money < char.price) return;
    try {
      await api.post("/gauntlet/unlock-character", { character_id: char.id, cost: char.price });
      setMoney(m => m - char.price);
      setOwnedChars(o => [...o, char.id]);
      setCharacterId(char.id);
    } catch (e) {
      // Optimistic: just unlock locally if backend doesn't have endpoint yet
      setMoney(m => m - char.price);
      setOwnedChars(o => [...o, char.id]);
      setCharacterId(char.id);
    }
  }, [money]);

  const jump = useCallback(() => {
    if (stateRef.current === "idle") {
      if (!canPlay) { toast.error("Play limit reached for this 2-hour window."); return; }
      void (async () => {
        try {
          const r = await api.post("/gauntlet/start", {
            theme: themeId, speed: speedId, difficulty: difficultyId,
          });
          const sid = r.data?.session_id;
          if (!sid) {
            toast.error("Could not start run. Try again.");
            return;
          }
          updateFromStart(r.data);
          gauntletSessionIdRef.current = sid;
          setClaimStatus({ state: "idle", cash: 0, message: "" });
          setGameState("playing");
          setGameFrame(prev => ({
            ...prev, birdVel: JUMP_FORCE,
            pipes: [{ x: VIEW_W + 80, topHeight: 100 + Math.random() * 200, scored: false }],
            score: 0, bgOffset: 0,
          }));
          tickRef.current = 0;
        } catch (e) {
          toast.error(getApiErrorMessage(e));
        }
      })();
      return;
    }
    if (stateRef.current === "playing") {
      setGameFrame(prev => ({ ...prev, birdVel: JUMP_FORCE }));
    }
    if (stateRef.current === "dead") {
      setGameState("idle");
      setGameFrame(initialGameFrame());
      setClaimStatus({ state: "idle", cash: 0, respect: 0, message: "" });
    }
  }, [themeId, speedId, difficultyId, canPlay, updateFromStart]);

  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  const speedOpt = SPEED_OPTIONS.find(s => s.id === speedId) || SPEED_OPTIONS[1];
  const difficultyOpt = DIFFICULTY_OPTIONS.find(d => d.id === difficultyId) || DIFFICULTY_OPTIONS[1];
  const pipeSpeed = PIPE_SPEED_BASE * speedOpt.mult * difficultyOpt.speedMult;
  const pipeGap = PIPE_GAP_BASE + difficultyOpt.gapOffset;
  const spawnInterval = Math.max(40, Math.round(95 / speedOpt.mult));
  const character = CHARACTERS.find(c => c.id === characterId) || CHARACTERS[0];
  const charAccent = character.accentOverride || theme.accent;

  useEffect(() => {
    const onKey = e => {
      if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); jump(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump]);

  useEffect(() => {
    if (gameState !== "playing") return;
    lastTimeRef.current = null;
    accumRef.current = 0;

    const loop = (now) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = now;
        frameRef.current = requestAnimationFrame(loop);
        return;
      }

      let elapsed = now - lastTimeRef.current;
      lastTimeRef.current = now;
      if (elapsed > 100) elapsed = 100;
      accumRef.current += elapsed;

      let dead = false;

      while (accumRef.current >= FIXED_DT && !dead) {
        accumRef.current -= FIXED_DT;

        try {
          tickRef.current++;
          const newVel = Math.min(TERMINAL_VEL, birdVelRef.current + GRAVITY);
          const newY = birdYRef.current + newVel;
          const nextBgOffset = (bgOffsetRef.current + 1) % 60;

          let newPipes = pipesRef.current.map(p => ({ ...p, x: p.x - pipeSpeed }));
          if (tickRef.current % spawnInterval === 0) {
            newPipes.push({ x: VIEW_W + 20, topHeight: 80 + Math.random() * 240, scored: false });
          }
          newPipes = newPipes.filter(p => p.x > -PIPE_WIDTH - 20);

          let newScore = scoreRef.current;
          newPipes = newPipes.map(p => {
            if (!p.scored && p.x + PIPE_WIDTH < 80) {
              newScore++;
              setFlashGold(true);
              setTimeout(() => setFlashGold(false), 260);
              spawnParticles(80, birdYRef.current, charAccent);
              return { ...p, scored: true };
            }
            return p;
          });

          const birdX = 70, birdR = BIRD_SIZE / 2 - 4;
          let hitDeath = newY < 0 || newY > VIEW_H - BIRD_SIZE;
          for (const p of newPipes) {
            const inX = birdX + birdR > p.x + 4 && birdX - birdR < p.x + PIPE_WIDTH - 4;
            const inTop = newY - birdR < p.topHeight - 4;
            const inBot = newY + birdR > p.topHeight + pipeGap + 4;
            if (inX && (inTop || inBot)) { hitDeath = true; break; }
          }

          if (hitDeath) {
            dead = true;
            spawnParticles(birdX, birdYRef.current, "#ff4444");
            setBestScore(b => Math.max(b, newScore));
            setGameFrame(prev => ({ ...prev, score: newScore }));
            setGameState("dead");
            claimReward(newScore);
            break;
          }

          birdYRef.current = newY;
          birdVelRef.current = newVel;
          pipesRef.current = newPipes;
          scoreRef.current = newScore;
          bgOffsetRef.current = nextBgOffset;
        } catch (err) { console.error("Gauntlet loop error:", err); }
      }

      if (!dead) {
        const rot = Math.max(-30, Math.min(90, birdVelRef.current * 5));
        setGameFrame({ birdY: birdYRef.current, birdVel: birdVelRef.current, birdRot: rot, pipes: pipesRef.current, score: scoreRef.current, bgOffset: bgOffsetRef.current });
        frameRef.current = requestAnimationFrame(loop);
      }
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frameRef.current); lastTimeRef.current = null; };
  }, [gameState, pipeSpeed, pipeGap, spawnInterval, charAccent, spawnParticles, claimReward]);

  const reward = getReward(score);
  const nextTier = getNextTier(score);

  const onPointerDown = useCallback(e => {
    if (showCharSelect || showThemeSelect) return;
    if (e?.preventDefault) e.preventDefault();
    jump();
  }, [jump, showCharSelect, showThemeSelect]);

  const narrow = typeof window !== "undefined" && window.innerWidth < 640;

  // Check what's newly unlockable
  const newlyUnlockedChar = CHARACTERS.find(c => c.unlockType === "score" && bestScore >= c.unlockScore && !ownedChars.includes(c.id));
  const newlyUnlockedTheme = THEMES.find(t => t.unlockType === "score" && bestScore >= t.unlockScore && t.id !== themeId);

  return (
    <div className="mobile-page-root w-full max-w-[min(1240px,calc(100vw-1rem))] mx-auto px-1 sm:px-2">
      {showCharSelect && (
        <CharacterSelect
          characters={CHARACTERS} selected={characterId} money={money} bestScore={bestScore} ownedChars={ownedChars}
          onSelect={id => { setCharacterId(id); setShowCharSelect(false); }}
          onClose={() => setShowCharSelect(false)}
          onBuy={handleBuyCharacter}
        />
      )}
      {showThemeSelect && (
        <ThemeSelect
          themes={THEMES} selected={themeId} money={money} bestScore={bestScore}
          onSelect={id => { setThemeId(id); setShowThemeSelect(false); }}
          onClose={() => setShowThemeSelect(false)}
        />
      )}

      <div className={`${styles.panel} mobile-panel`} style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        width: "100%", background: "var(--noir-surface)", color: "var(--noir-foreground)",
        fontFamily: "var(--font-heading, 'Cinzel', serif)",
        padding: isTouch ? "10px 10px 14px" : "14px 14px 16px",
        borderRadius: "8px", border: "1px solid var(--noir-border-mid)",
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "10px" }}>
          <h1 style={{ fontSize: "clamp(18px, 4.5vw, 28px)", color: "var(--noir-primary)", letterSpacing: "0.15em", textTransform: "uppercase", margin: 0, textShadow: "0 0 20px rgba(var(--noir-primary-rgb),0.35)" }}>
            Flappy Gangster
          </h1>
          <p style={{ color: "var(--noir-muted)", fontSize: "11px", letterSpacing: "0.1em", margin: "2px 0 0" }}>
            FLY THE CORRIDOR — EARN YOUR KEEP
          </p>
          {playsLeft != null && (
            <p style={{ fontSize: 10, letterSpacing: "0.12em", marginTop: 3, color: canPlay ? "var(--noir-muted)" : "#dc2626", fontWeight: canPlay ? 400 : 700 }}>
              {playsLeft}/{maxPlays} plays left
            </p>
          )}
        </div>

        {/* Stats bar */}
        <div style={{ display: "flex", gap: "18px", marginBottom: "10px", padding: "8px 16px", background: "rgba(var(--noir-primary-rgb),0.06)", border: "1px solid var(--noir-border-light)", borderRadius: "6px", width: "100%", maxWidth: "min(900px, 100%)", marginLeft: "auto", marginRight: "auto", justifyContent: "space-between" }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>BANK</div>
            <div style={{ color: "var(--noir-primary)", fontSize: "16px", fontWeight: "700" }}>${Number(money || 0).toLocaleString()}</div>
          </div>
          <div style={{ width: "1px", background: "var(--noir-border-light)" }} />
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>BEST</div>
            <div style={{ color: "var(--noir-foreground)", opacity: 0.85, fontSize: "16px" }}>{bestScore}</div>
          </div>
          <div style={{ width: "1px", background: "var(--noir-border-light)" }} />
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>PLAYING AS</div>
            <div style={{ color: charAccent, fontSize: "11px", fontWeight: "700" }}>{character.name}</div>
          </div>
        </div>

        {/* Controls row */}
        <div style={{ marginBottom: "10px", padding: "8px 12px", background: "var(--noir-content)", border: "1px solid var(--noir-border-light)", borderRadius: "6px", width: "100%", maxWidth: "min(900px, 100%)", marginLeft: "auto", marginRight: "auto" }}>
          {/* Character + World pickers */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, justifyContent: "center" }}>
            <button type="button" onClick={() => setShowCharSelect(true)}
              style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--noir-border-mid)", borderRadius: 6, background: "var(--noir-raised)", cursor: "pointer", fontFamily: "Cinzel,serif", fontSize: 10, color: "var(--noir-primary)", letterSpacing: "0.1em", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, position: "relative" }}>
              <svg width="18" height="18" viewBox="0 0 36 36">
                <character.render x={0} y={0} rotation={0} accent={charAccent} />
              </svg>
              CHARACTER
              {newlyUnlockedChar && <span style={{ position: "absolute", top: 2, right: 6, width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />}
            </button>
            <button type="button" onClick={() => setShowThemeSelect(true)}
              style={{ flex: 1, padding: "8px 10px", border: `1px solid ${theme.accent}44`, borderRadius: 6, background: "var(--noir-raised)", cursor: "pointer", fontFamily: "Cinzel,serif", fontSize: 10, color: theme.accent, letterSpacing: "0.1em" }}>
              🌍 {theme.name}
            </button>
          </div>

          {/* Speed / Difficulty */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>SPEED</span>
              {SPEED_OPTIONS.map(s => (
                <button key={s.id} type="button" onClick={() => setSpeedId(s.id)}
                  style={{ padding: "3px 9px", fontSize: 10, border: `1px solid ${speedId === s.id ? "var(--noir-primary)" : "var(--noir-border)"}`, borderRadius: 4, background: speedId === s.id ? "rgba(var(--noir-primary-rgb),0.15)" : "transparent", color: speedId === s.id ? "var(--noir-primary)" : "var(--noir-muted)", cursor: "pointer" }}>{s.label}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>DIFF</span>
              {DIFFICULTY_OPTIONS.map(d => {
                const locked = d.unlockScore && bestScore < d.unlockScore;
                return (
                  <button key={d.id} type="button"
                    onClick={() => { if (!locked) setDifficultyId(d.id); }}
                    title={locked ? `Reach ${d.unlockScore} gates to unlock` : ""}
                    style={{ padding: "3px 9px", fontSize: 10, border: `1px solid ${difficultyId === d.id ? "var(--noir-primary)" : "var(--noir-border)"}`, borderRadius: 4, background: difficultyId === d.id ? "rgba(var(--noir-primary-rgb),0.15)" : "transparent", color: locked ? "var(--noir-border)" : difficultyId === d.id ? "var(--noir-primary)" : "var(--noir-muted)", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.5 : 1 }}>
                    {locked ? `🔒` : d.label}
                  </button>
                );
              })}
            </div>
          </div>
          <p style={{ color: "var(--noir-muted)", fontSize: "9px", marginTop: "6px", marginBottom: 0, textAlign: "center" }}>Caps: $250K cash · 1,000 respect per run</p>
        </div>

        {/* Game viewport */}
        <div className="w-full flex flex-col lg:flex-row lg:items-start lg:justify-center gap-4 lg:gap-6">
          <div style={{
            position: "relative", width: "100%", maxWidth: "min(820px, 100%)", marginLeft: "auto", marginRight: "auto", borderRadius: "10px",
            overflow: "hidden", border: "2px solid var(--noir-border-mid)",
            boxShadow: "0 0 40px rgba(var(--noir-primary-rgb),0.10), inset 0 0 40px rgba(0,0,0,0.45)",
            cursor: "pointer", touchAction: "manipulation", userSelect: "none",
            WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent",
          }} onPointerDown={onPointerDown}>
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ display: "block", width: "100%", height: "auto" }}>
              <defs>
                {THEMES.map(t => (
                  <pattern key={t.id} id={`brickPattern-${t.id}`} x="0" y="0" width="30" height="20" patternUnits="userSpaceOnUse">
                    <rect width="30" height="20" fill="none" />
                    <rect x="0" y="0" width="28" height="9" rx="0" fill={t.brick} />
                    <rect x="15" y="10" width="28" height="9" rx="0" fill={t.brick} />
                    <line x1="0" y1="10" x2="30" y2="10" stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
                  </pattern>
                ))}
                <pattern id="bgStripes" x={bgOffset} y="0" width="60" height="60" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="60" y2="60" stroke={theme.stripe} strokeWidth="1" />
                </pattern>
                <radialGradient id={`skyGrad-${theme.id}`} cx="50%" cy="30%" r="70%">
                  <stop offset="0%" stopColor={theme.sky[0]} />
                  <stop offset="55%" stopColor={theme.sky[1]} />
                  <stop offset="100%" stopColor={theme.sky[2]} />
                </radialGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <filter id="charGlow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* Sky */}
              <rect width={VIEW_W} height={VIEW_H} fill={`url(#skyGrad-${theme.id})`} />
              <rect width={VIEW_W} height={VIEW_H} fill="url(#bgStripes)" />

              {/* Animated bg elements */}
              <BgElements theme={theme} bgOffset={bgOffset} tick={tick} />

              {/* Ground */}
              <rect x={0} y={VIEW_H - 30} width={VIEW_W} height={30} fill={theme.groundColor || "var(--noir-bg)"} />
              <rect x={0} y={VIEW_H - 30} width={VIEW_W} height={3} fill={theme.accent} opacity="0.25" />

              {/* Pipes */}
              {pipes.map((p, i) => <Pipe key={i} x={p.x} topHeight={p.topHeight} gap={pipeGap} theme={theme} />)}

              {/* Particles */}
              {particles.map(pt => (
                <circle key={pt.id} cx={pt.x + pt.vx * 5} cy={pt.y + pt.vy * 5} r={3} fill={pt.color} opacity={pt.life * 0.8} />
              ))}

              {/* Character */}
              {gameState !== "idle" && (
                <g filter={flashGold ? "url(#charGlow)" : ""}>
                  <character.render x={70 - BIRD_SIZE / 2} y={birdY - BIRD_SIZE / 2} rotation={birdRot} accent={charAccent} />
                </g>
              )}

              {/* Playing HUD */}
              {gameState === "playing" && (
                <g filter={flashGold ? "url(#glow)" : ""}>
                  <text x={VIEW_W / 2} y={55} textAnchor="middle" fill={flashGold ? theme.accent : theme.accent} fontSize="42" fontFamily="Cinzel, serif" fontWeight="700" opacity="0.9">
                    {score}
                  </text>
                  {reward.label !== "Nobody" && (
                    <text x={VIEW_W / 2} y={78} textAnchor="middle" fill="var(--noir-muted)" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="2">
                      {reward.label.toUpperCase()}
                    </text>
                  )}
                </g>
              )}

              {/* Idle screen */}
              {gameState === "idle" && (
                <g>
                  <rect width={VIEW_W} height={VIEW_H} fill="rgba(0,0,0,0.38)" />
                  <character.render x={70 - BIRD_SIZE / 2} y={VIEW_H / 2 - BIRD_SIZE / 2} rotation={0} accent={charAccent} />
                  <text x={VIEW_W / 2} y={VIEW_H / 2 - 80} textAnchor="middle" fill={theme.accent} fontSize="30" fontFamily="Cinzel, serif" fontWeight="700" letterSpacing="3">
                    FLAPPY GANGSTER
                  </text>
                  <text x={VIEW_W / 2} y={VIEW_H / 2 - 50} textAnchor="middle" fill="var(--noir-muted)" fontSize="12" fontFamily="Cinzel, serif" letterSpacing="2">
                    NAVIGATE THE CORRIDORS OF POWER
                  </text>
                  {REWARD_TIERS.slice(0, 4).map((t, i) => (
                    <g key={i}>
                      <text x={VIEW_W / 2 - 60} y={VIEW_H / 2 + 20 + i * 22} textAnchor="middle" fill="var(--noir-foreground)" opacity="0.75" fontSize="11" fontFamily="Cinzel, serif">{t.label} ({t.score}+)</text>
                      <text x={VIEW_W / 2 + 70} y={VIEW_H / 2 + 20 + i * 22} textAnchor="middle" fill={theme.accent} fontSize="11" fontFamily="Cinzel, serif">+${t.cash.toLocaleString()} / +{t.respect}r</text>
                    </g>
                  ))}
                  <text x={VIEW_W / 2} y={VIEW_H / 2 + 115} textAnchor="middle" fill={canPlay ? theme.accent : "#dc2626"} fontSize="13" fontFamily="Cinzel, serif" letterSpacing="3" opacity={0.85}>
                    {!canPlay ? "HOURLY LIMIT REACHED" : isTouch ? "TAP TO BEGIN" : "TAP / SPACE TO BEGIN"}
                  </text>
                </g>
              )}

              {/* Dead screen */}
              {gameState === "dead" && (
                <g>
                  <rect width={VIEW_W} height={VIEW_H} fill="rgba(0,0,0,0.75)" />
                  <text x={VIEW_W / 2} y={VIEW_H / 2 - 130} textAnchor="middle" fill="#8b1a1a" fontSize="30" fontFamily="Cinzel, serif" fontWeight="700" letterSpacing="3">
                    YOU'RE DONE
                  </text>
                  <text x={VIEW_W / 2} y={VIEW_H / 2 - 95} textAnchor="middle" fill="var(--noir-muted)" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="1">
                    THE FAMILY SENDS ITS REGARDS
                  </text>
                  <text x={VIEW_W / 2} y={VIEW_H / 2 - 48} textAnchor="middle" fill={theme.accent} fontSize="60" fontFamily="Cinzel, serif" fontWeight="700">
                    {score}
                  </text>
                  <text x={VIEW_W / 2} y={VIEW_H / 2 - 18} textAnchor="middle" fill="var(--noir-muted)" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="2">
                    GATES CLEARED
                  </text>

                  {/* Unlock notification */}
                  {newlyUnlockedChar && (
                    <g>
                      <rect x={VIEW_W / 2 - 120} y={VIEW_H / 2 - 12} width={240} height={22} rx="4" fill="rgba(34,197,94,0.15)" stroke="#22c55e" strokeWidth="0.5" />
                      <text x={VIEW_W / 2} y={VIEW_H / 2 + 4} textAnchor="middle" fill="#22c55e" fontSize="10" fontFamily="Cinzel, serif">
                        🔓 {newlyUnlockedChar.name} UNLOCKED!
                      </text>
                    </g>
                  )}

                  <rect x={VIEW_W / 2 - 140} y={VIEW_H / 2 + 14} width={280} height={90} rx="6" fill="rgba(var(--noir-primary-rgb),0.08)" stroke="var(--noir-border-mid)" strokeWidth="1" />
                  <foreignObject x={VIEW_W / 2 - 140} y={VIEW_H / 2 + 14} width={280} height={90} style={{ overflow: "visible" }}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{ padding: "8px 12px", textAlign: "center", width: "100%", boxSizing: "border-box" }}>
                      <div style={{ color: "var(--noir-primary)", fontSize: 13, letterSpacing: "0.15em", fontFamily: "Cinzel, serif", marginBottom: 4 }}>
                        {reward.label !== "Nobody" ? reward.label.toUpperCase() : "NOBODY"}
                      </div>
                      <div style={{ color: claimStatus.state === "error" ? "#f87171" : claimStatus.cash > 0 || claimStatus.respect > 0 ? "var(--noir-primary-bright)" : "var(--noir-muted)", fontSize: 14, fontWeight: 700, fontFamily: "Cinzel, serif", lineHeight: 1.35, wordBreak: "break-word" }}>
                        {claimStatus.state === "claiming" ? "CLAIMING..." : (claimStatus.message || (reward.cash > 0 ? `+$${reward.cash.toLocaleString()}${reward.respect > 0 ? ` & +${reward.respect}r` : ""} EARNED` : "Score 1+ to earn"))}
                      </div>
                      {nextTier && (
                        <div style={{ color: "var(--noir-muted)", fontSize: 10, fontFamily: "Cinzel, serif", marginTop: 6, lineHeight: 1.3 }}>
                          REACH {nextTier.score} FOR {nextTier.label?.toUpperCase() || `${nextTier.score} GATES`}
                        </div>
                      )}
                    </div>
                  </foreignObject>
                  <text x={VIEW_W / 2} y={VIEW_H / 2 + 136} textAnchor="middle" fill={canPlay ? "var(--noir-primary)" : "#dc2626"} fontSize="12" fontFamily="Cinzel, serif" letterSpacing="3" opacity="0.85">
                    {canPlay ? "TAP TO TRY AGAIN" : "HOURLY LIMIT REACHED"}
                  </text>
                </g>
              )}
            </svg>
          </div>

          {/* Leaderboard */}
          <div className="w-full lg:w-[min(400px,100%)] lg:max-w-[420px] lg:shrink-0 rounded-md" style={{ background: "var(--noir-content)", border: "1px solid var(--noir-border-mid)", padding: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--noir-primary)" }}>Top 10</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select value={lbPeriod} onChange={e => setLbPeriod(e.target.value)} style={{ background: "var(--noir-surface)", border: "1px solid var(--noir-border-light)", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "var(--noir-foreground)" }}>
                  <option value="weekly">Weekly</option>
                  <option value="alltime">All-time</option>
                </select>
                <button type="button" onClick={() => loadLeaderboard(lbPeriod)} style={{ background: "var(--noir-raised)", border: "1px solid var(--noir-border-light)", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "var(--noir-foreground)" }}>↻</button>
              </div>
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
              {(top10 || []).map(r => (
                <div key={`${r.rank}-${r.user_id || r.username}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--noir-raised)", border: "1px solid var(--noir-border-light)", borderRadius: 6, padding: "5px 10px", fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                    <span style={{ color: r.rank <= 3 ? "var(--noir-primary)" : "var(--noir-muted)", fontWeight: 700 }}>#{r.rank}</span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.username}</span>
                  </div>
                  <div style={{ fontWeight: 700 }}>{Number(r.score || 0)}</div>
                </div>
              ))}
              {!top10?.length && <div style={{ color: "var(--noir-muted)", fontSize: 11 }}>No scores yet.</div>}
            </div>

            {/* Unlock progress panel */}
            <div style={{ marginTop: 12, borderTop: "1px solid var(--noir-border-light)", paddingTop: 10 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--noir-primary)", marginBottom: 8 }}>UNLOCK PROGRESS</div>
              {[
                ...CHARACTERS.filter(c => c.unlockType === "score").map(c => ({ type: "char", name: c.name, req: c.unlockScore, current: bestScore, label: "gates" })),
                ...THEMES.filter(t => t.unlockType === "score").map(t => ({ type: "theme", name: t.name, req: t.unlockScore, current: bestScore, label: "gates" })),
                ...DIFFICULTY_OPTIONS.filter(d => d.unlockScore).map(d => ({ type: "diff", name: `${d.label} Mode`, req: d.unlockScore, current: bestScore, label: "gates" })),
              ].sort((a, b) => a.req - b.req).map((u, i) => {
                const pct = Math.min(100, (u.current / u.req) * 100);
                const unlocked = u.current >= u.req;
                return (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 3 }}>
                      <span style={{ color: unlocked ? "#22c55e" : "var(--noir-foreground)" }}>{unlocked ? "✓ " : ""}{u.name}</span>
                      <span style={{ color: "var(--noir-muted)" }}>{unlocked ? "UNLOCKED" : `${u.current}/${u.req} ${u.label}`}</span>
                    </div>
                    <div style={{ height: 3, background: "var(--noir-border-light)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: unlocked ? "#22c55e" : "var(--noir-primary)", borderRadius: 2, transition: "width 0.4s" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 8, color: "var(--noir-muted)", fontSize: 10 }}>Weekly = best since Monday (UTC).</div>
          </div>
        </div>

        {/* Reward tiers */}
        <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center", width: "100%", maxWidth: "min(900px, 100%)", marginLeft: "auto", marginRight: "auto" }}>
          {REWARD_TIERS.map((t, i) => {
            const active = score >= t.score && gameState === "dead";
            const current = reward.tier === i && gameState === "dead";
            return (
              <div key={i} style={{ padding: "5px 9px", border: `1px solid ${current ? "var(--noir-primary)" : active ? "var(--noir-border-mid)" : "var(--noir-border-light)"}`, borderRadius: "6px", background: current ? "rgba(var(--noir-primary-rgb),0.12)" : "transparent", textAlign: "center", transition: "all 0.3s", minWidth: 80 }}>
                <div style={{ color: current ? "var(--noir-primary)" : "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>{t.label.toUpperCase()}</div>
                <div style={{ color: current ? "var(--noir-primary-bright)" : "var(--noir-foreground)", opacity: current ? 1 : 0.8, fontSize: "10px", fontWeight: "700" }}>${t.cash.toLocaleString()}</div>
                <div style={{ color: "var(--noir-muted)", fontSize: "8px" }}>{t.score}+ gates</div>
              </div>
            );
          })}
        </div>

        <p style={{ color: "var(--noir-muted)", fontSize: "10px", marginTop: "6px", letterSpacing: "0.1em", textAlign: "center" }}>
          {isTouch ? "TAP TO FLY" : "SPACE / TAP TO FLY"}
        </p>
      </div>
    </div>
  );
}
