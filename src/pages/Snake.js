import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import api from "../utils/api";
import styles from "../styles/noir.module.css";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const GRID = 20;          // cells across/down
const CELL = 24;          // px per cell (scales on mobile)
const BASE_SPEED = 140;   // ms per tick (lower = faster)
const SPEED_STEP = 4;     // ms faster per package collected
const MIN_SPEED = 60;     // fastest possible
const CANVAS_SIZE = GRID * CELL;

// Package types — in-game rewards (keys match backend: cash, respect, rank_points, bullets, points, booze, jail)
const PACKAGES = [
  // Booze (common)
  { type: "whiskey",   label: "🥃", points: 10, color: "#c9a460", prob: 0.18, reward: "booze",    rewardAmt: 1,   desc: "Whiskey"    },
  { type: "gin",       label: "🍸", points: 10, color: "#a0c8a0", prob: 0.14, reward: "booze",    rewardAmt: 1,   desc: "Gin"        },
  { type: "beer",      label: "🍺", points: 8,  color: "#c8900a", prob: 0.12, reward: "booze",    rewardAmt: 1,   desc: "Beer"       },
  { type: "wine",      label: "🍷", points: 12, color: "#8b1a1a", prob: 0.10, reward: "booze",    rewardAmt: 1,   desc: "Wine"       },
  // Cash
  { type: "cash",      label: "💵", points: 25, color: "#4a8a4a", prob: 0.20, reward: "cash",     rewardAmt: 500, desc: "Cash"       },
  // Respect points
  { type: "respect",   label: "⭐", points: 40, color: "#e8c870", prob: 0.12, reward: "respect",  rewardAmt: 5,   desc: "Respect"    },
  // Rank points
  { type: "rank_pts",  label: "📈", points: 35, color: "#a87820", prob: 0.08, reward: "rank_points", rewardAmt: 3, desc: "Rank points" },
  // Bullets
  { type: "bullets",   label: "🔫", points: 30, color: "#6a6a8a", prob: 0.06, reward: "bullets",  rewardAmt: 10,  desc: "Bullets"   },
  // XP / points (spendable)
  { type: "xp",        label: "📜", points: 50, color: "#60a8dc", prob: 0.06, reward: "points",   rewardAmt: 10,  desc: "XP Token"   },
  // Jail token — NEGATIVE, avoid it
  { type: "jail",      label: "🔒", points: -30, color: "#dc2626", prob: 0.06, reward: "jail",     rewardAmt: 1,   desc: "Jail Token", danger: true },
];

// Cops — spawn as obstacles after score threshold
const COP_THRESHOLD = 100;
const COP_SPAWN_INTERVAL = 150;
const MAX_COPS = 6;

const DIR = { UP:[0,-1], DOWN:[0,1], LEFT:[-1,0], RIGHT:[1,0] };

function pickPackage() {
  let r = Math.random();
  for (const p of PACKAGES) { r -= p.prob; if (r <= 0) return p; }
  return PACKAGES[0];
}

function randCell(exclude = []) {
  const flat = new Set(exclude.map(([x,y]) => `${x},${y}`));
  let x, y;
  let tries = 0;
  do {
    x = Math.floor(Math.random() * GRID);
    y = Math.floor(Math.random() * GRID);
    tries++;
  } while (flat.has(`${x},${y}`) && tries < 200);
  return [x, y];
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS DRAW
// ─────────────────────────────────────────────────────────────────────────────
function drawGame(ctx, state, cellSize, t) {
  const { snake, pkg, cops, score, phase } = state;
  const C = cellSize;
  const W = GRID * C;

  // ── BACKGROUND ──
  ctx.fillStyle = "#0a0c08";
  ctx.fillRect(0, 0, W, W);

  ctx.strokeStyle = "rgba(201,164,96,0.06)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * C, 0); ctx.lineTo(i * C, W); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * C); ctx.lineTo(W, i * C); ctx.stroke();
  }

  const lampPositions = [[0,0],[GRID-1,0],[0,GRID-1],[GRID-1,GRID-1]];
  lampPositions.forEach(([gx,gy]) => {
    const px = gx * C + C*0.5;
    const py = gy * C + C*0.5;
    const grd = ctx.createRadialGradient(px, py, 0, px, py, C * 3.5);
    grd.addColorStop(0, "rgba(255,200,80,0.10)");
    grd.addColorStop(1, "rgba(255,200,80,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, W);
  });

  // ── COPS ──
  cops.forEach(([cx, cy]) => {
    const px = cx * C, py = cy * C;
    const flash = 0.65 + Math.sin(t * 6 + cx + cy) * 0.25;
    ctx.fillStyle = `rgba(220,50,50,${flash * 0.25})`;
    ctx.fillRect(px + 1, py + 1, C - 2, C - 2);
    ctx.font = `${Math.round(C * 0.7)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🚔", px + C * 0.5, py + C * 0.5);
    ctx.strokeStyle = `rgba(220,50,50,${flash * 0.7})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 1, py + 1, C - 2, C - 2);
  });

  // ── PACKAGE ──
  if (pkg) {
    const [px, py] = pkg.pos;
    const bob = Math.sin(t * 3.5) * 1.5;
    const glow = 0.5 + Math.sin(t * 4) * 0.3;
    const grd = ctx.createRadialGradient(
      px * C + C / 2, py * C + C / 2, 0,
      px * C + C / 2, py * C + C / 2, C * 1.1
    );
    grd.addColorStop(0, pkg.data.color + "55");
    grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(px * C + C / 2, py * C + C / 2, C, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(px * C + 3, py * C + C * 0.6 + 3, C - 6, C * 0.35);
    ctx.fillStyle = "#3a2a10";
    ctx.fillRect(px * C + 2, py * C + 2 + bob, C - 4, C - 4);
    ctx.strokeStyle = "#5a3a15";
    ctx.lineWidth = 1;
    ctx.strokeRect(px * C + 2, py * C + 2 + bob, C - 4, C - 4);
    ctx.beginPath();
    ctx.moveTo(px * C + C / 2, py * C + 2 + bob);
    ctx.lineTo(px * C + C / 2, py * C + C - 2 + bob);
    ctx.moveTo(px * C + 2, py * C + C / 2 + bob);
    ctx.lineTo(px * C + C - 2, py * C + C / 2 + bob);
    ctx.strokeStyle = "#4a2e10";
    ctx.stroke();
    ctx.font = `${Math.round(C * 0.55)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pkg.data.label, px * C + C / 2, py * C + C / 2 + bob);
  }

  // ── SNAKE ──
  snake.forEach(([sx, sy], i) => {
    const isHead = i === 0;
    const isTail = i === snake.length - 1;
    const px = sx * C, py = sy * C;
    const padding = isHead ? 1 : isTail ? 3 : 2;

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(px + padding + 1, py + padding + 2, C - padding * 2, C - padding * 2);

    const t_seg = i / Math.max(snake.length - 1, 1);
    const r = Math.round(lerp(0xc9, 0x3a, t_seg));
    const g = Math.round(lerp(0xa4, 0x2a, t_seg));
    const b = Math.round(lerp(0x60, 0x10, t_seg));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.roundRect(px + padding, py + padding, C - padding * 2, C - padding * 2, isHead ? 5 : isTail ? 4 : 3);
    ctx.fill();

    ctx.fillStyle = "rgba(255,220,100,0.15)";
    ctx.fillRect(px + padding, py + padding, C - padding * 2, (C - padding * 2) * 0.4);

    if (!isHead && i % 2 === 0) {
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(px + C/2, py + C/2, (C - padding*2) * 0.35, 0, Math.PI*2);
      ctx.stroke();
    }

    if (isHead) {
      ctx.fillStyle = "#1a1208";
      ctx.fillRect(px + 3, py + 1, C - 6, 5);
      ctx.fillRect(px + 5, py - 2, C - 10, 6);
      ctx.fillStyle = "#ff4444";
      ctx.beginPath(); ctx.arc(px + C*0.32, py + C*0.42, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + C*0.68, py + C*0.42, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(px + C*0.32 + 0.5, py + C*0.42, 1.2, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + C*0.68 + 0.5, py + C*0.42, 1.2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#f5e8c0";
      ctx.fillRect(px + C*0.55, py + C*0.62, 7, 2);
      ctx.fillStyle = "#ff6600";
      ctx.beginPath(); ctx.arc(px + C*0.55 + 7, py + C*0.63, 1.5, 0, Math.PI*2); ctx.fill();
      const smokeAlpha = 0.3 + Math.sin(t * 4) * 0.15;
      ctx.strokeStyle = `rgba(200,200,200,${smokeAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + C*0.55 + 8, py + C*0.63);
      ctx.bezierCurveTo(
        px + C*0.55 + 11, py + C*0.43,
        px + C*0.55 + 7,  py + C*0.28,
        px + C*0.55 + 13, py + C*0.12
      );
      ctx.stroke();
    }
  });

  if (phase === "dead") {
    ctx.fillStyle = "rgba(180,20,20,0.35)";
    ctx.fillRect(0, 0, W, W);
  }
}

function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function Snake() {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const rafRef = useRef(null);
  const lastTickRef = useRef(0);
  const tRef = useRef(0);

  const [phase, setPhase] = useState("menu");
  const [score, setScore] = useState(0);
  const [hiScore, setHiScore] = useState(0);
  const [lastPkg, setLastPkg] = useState(null);
  const [pkgFade, setPkgFade] = useState(0);
  const [cellSize, setCellSize] = useState(CELL);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loadingLB, setLoadingLB] = useState(false);

  useEffect(() => {
    const calc = () => {
      const maxW = Math.min(window.innerWidth - 32, 520);
      setCellSize(Math.floor(maxW / GRID));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const fetchLB = useCallback(async () => {
    setLoadingLB(true);
    try {
      const r = await api.get("/snake/leaderboard");
      setLeaderboard(r.data?.leaderboard || []);
    } catch (_) {}
    finally { setLoadingLB(false); }
  }, []);

  useEffect(() => { fetchLB(); }, [fetchLB]);

  const initState = useCallback(() => {
    const mid = Math.floor(GRID / 2);
    return {
      snake: [[mid, mid], [mid - 1, mid], [mid - 2, mid]],
      dir: [1, 0],
      nextDir: [1, 0],
      pkg: { pos: randCell([[mid,mid],[mid-1,mid],[mid-2,mid]]), data: pickPackage() },
      cops: [],
      score: 0,
      speed: BASE_SPEED,
      phase: "playing",
      copTimer: 0,
    };
  }, []);

  const tick = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.phase !== "playing") return;

    s.dir = s.nextDir;
    const [dx, dy] = s.dir;
    const head = s.snake[0];
    const newHead = [head[0] + dx, head[1] + dy];

    if (newHead[0] < 0 || newHead[0] >= GRID || newHead[1] < 0 || newHead[1] >= GRID) {
      s.phase = "dead";
      setPhase("dead");
      return;
    }

    const bodyCheck = s.snake.slice(0, -1);
    if (bodyCheck.some(([x,y]) => x === newHead[0] && y === newHead[1])) {
      s.phase = "dead";
      setPhase("dead");
      return;
    }

    if (s.cops.some(([x,y]) => x === newHead[0] && y === newHead[1])) {
      s.phase = "dead";
      setPhase("dead");
      return;
    }

    const atePackage = s.pkg && s.pkg.pos[0] === newHead[0] && s.pkg.pos[1] === newHead[1];
    const newSnake = [newHead, ...s.snake];
    if (!atePackage) newSnake.pop();

    if (atePackage) {
      const pkgData = s.pkg.data;
      const pts = pkgData.points;
      const isJail = pkgData.type === "jail";

      if (isJail) {
        const newScore = Math.max(0, s.score + pts);
        s.score = newScore;
        setScore(newScore);
        while (newSnake.length > 3) { newSnake.pop(); newSnake.pop(); newSnake.pop(); break; }
        setLastPkg({ label: "🔒", points: pts, x: newHead[0], y: newHead[1], isJail: true });
        setPkgFade(1);
        const occupied = [...newSnake, ...s.cops];
        s.pkg = { pos: randCell(occupied), data: pickPackage() };
        s.snake = newSnake;
        return;
      }

      const newScore = s.score + pts;
      s.score = newScore;
      s.speed = Math.max(MIN_SPEED, BASE_SPEED - Math.floor(newScore / 10) * SPEED_STEP);
      setScore(newScore);
      setHiScore(h => Math.max(h, newScore));

      if (!s.rewards) s.rewards = {};
      s.rewards[pkgData.reward] = (s.rewards[pkgData.reward] || 0) + pkgData.rewardAmt;

      const rewardLabel = pkgData.reward === "booze" ? pkgData.desc
        : pkgData.reward === "cash" ? `$${pkgData.rewardAmt}`
        : pkgData.reward === "respect" ? `+${pkgData.rewardAmt} Respect`
        : pkgData.reward === "rank_points" ? `+${pkgData.rewardAmt} Rank pts`
        : pkgData.reward === "bullets" ? `+${pkgData.rewardAmt} Bullets`
        : pkgData.reward === "points" ? `+${pkgData.rewardAmt} XP`
        : pkgData.desc;
      setLastPkg({ label: pkgData.label, points: pts, rewardLabel, x: newHead[0], y: newHead[1] });
      setPkgFade(1);

      const occupied = [...newSnake, ...s.cops];
      s.pkg = { pos: randCell(occupied), data: pickPackage() };

      s.copTimer += pts;
      if (s.copTimer >= COP_SPAWN_INTERVAL && s.cops.length < MAX_COPS && newScore >= COP_THRESHOLD) {
        s.copTimer = 0;
        const copPos = randCell([...newSnake, ...s.cops]);
        s.cops = [...s.cops, copPos];
      }

      lastTickRef.current = performance.now();
    }

    s.snake = newSnake;
  }, []);

  const renderLoop = useCallback((now) => {
    rafRef.current = requestAnimationFrame(renderLoop);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = stateRef.current;
    if (!s) return;

    const dt = Math.min(0.05, (now - (tRef.current || now)) / 1000);
    tRef.current = now;
    const t = now / 1000;

    if (s.phase === "playing" && now - lastTickRef.current >= s.speed) {
      lastTickRef.current = now;
      tick();
    }

    setPkgFade(f => Math.max(0, f - dt * 2.5));

    const C = canvas.width / GRID;
    drawGame(ctx, s, C, t);
  }, [tick]);

  const startGame = useCallback(() => {
    const s = initState();
    stateRef.current = s;
    setScore(0);
    setPhase("playing");
    setLastPkg(null);
    setPkgFade(0);
    lastTickRef.current = performance.now();
    tRef.current = 0;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderLoop);
  }, [initState, renderLoop]);

  const submitScore = useCallback(async (finalScore) => {
    if (finalScore <= 0) return;
    setPhase("submitting");
    try {
      const rewards = stateRef.current?.rewards || {};
      await api.post("/snake/score", { score: finalScore, rewards });
      toast.success(`Score submitted: ${finalScore} pts`);
      await fetchLB();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to submit score");
    } finally {
      setPhase("dead");
    }
  }, [fetchLB]);

  useEffect(() => {
    const onKey = (e) => {
      const s = stateRef.current;
      if (!s) return;

      if (phase === "menu" || phase === "dead") {
        if (["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w","a","s","d"].includes(e.key)) {
          e.preventDefault();
          startGame();
        }
        return;
      }

      if (s.phase !== "playing") return;
      const [cx, cy] = s.dir;
      const map = {
        ArrowUp: DIR.UP, w: DIR.UP, W: DIR.UP,
        ArrowDown: DIR.DOWN, s: DIR.DOWN, S: DIR.DOWN,
        ArrowLeft: DIR.LEFT, a: DIR.LEFT, A: DIR.LEFT,
        ArrowRight: DIR.RIGHT, d: DIR.RIGHT, D: DIR.RIGHT,
      };
      const nd = map[e.key];
      if (!nd) return;
      e.preventDefault();
      if (nd[0] === -cx && nd[1] === -cy) return;
      if (nd[0] !== cx || nd[1] !== cy) s.nextDir = nd;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, startGame]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const dpad = useCallback((dir) => {
    const s = stateRef.current;
    if (!s) return;
    if (phase === "menu" || phase === "dead") { startGame(); return; }
    if (s.phase !== "playing") return;
    const [cx, cy] = s.dir;
    const nd = DIR[dir];
    if (!nd) return;
    if (nd[0] === -cx && nd[1] === -cy) return;
    s.nextDir = nd;
  }, [phase, startGame]);

  const C = cellSize;
  const canvasW = GRID * C;

  return (
    <div className={styles.page} style={{ fontFamily: "'Cinzel', serif" }}>

      <div className={styles.panelHeader} style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="font-heading" style={{ color: "var(--noir-primary)", fontSize: "clamp(14px,4vw,22px)", letterSpacing: ".25em", textTransform: "uppercase" }}>
            The Package Run
          </h1>
          <p style={{ fontSize: 10, color: "var(--noir-muted)", letterSpacing: ".15em", marginTop: 2 }}>
            Collect contraband · Dodge the feds
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: 11, letterSpacing: ".18em", color: "var(--noir-primary)" }}>
            SCORE <span style={{ fontSize: 16, fontWeight: 700 }}>{score}</span>
          </div>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: 9, letterSpacing: ".15em", color: "var(--noir-muted)" }}>
            BEST <span style={{ color: "var(--noir-primary)" }}>{hiScore}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", position: "relative" }}>

        <div style={{
          position: "relative",
          border: "2px solid var(--noir-primary)",
          boxShadow: "0 0 30px rgba(201,164,96,0.15), inset 0 0 30px rgba(0,0,0,0.5)",
          lineHeight: 0,
        }}>
          {["top:0;left:0","top:0;right:0","bottom:0;left:0","bottom:0;right:0"].map((pos, i) => (
            <div key={i} style={{
              position: "absolute",
              [pos.split(";")[0].split(":")[0]]: -1,
              [pos.split(";")[1].split(":")[0]]: -1,
              width: 10, height: 10,
              borderTop: i < 2 ? "2px solid var(--noir-primary)" : "none",
              borderBottom: i >= 2 ? "2px solid var(--noir-primary)" : "none",
              borderLeft: i % 2 === 0 ? "2px solid var(--noir-primary)" : "none",
              borderRight: i % 2 === 1 ? "2px solid var(--noir-primary)" : "none",
              zIndex: 2,
            }}/>
          ))}

          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasW}
            style={{ width: canvasW, height: canvasW, display: "block" }}
          />

          {lastPkg && pkgFade > 0 && (
            <div style={{
              position: "absolute",
              left: `${(lastPkg.x / GRID) * 100}%`,
              top: `${(lastPkg.y / GRID) * 100 - 8}%`,
              transform: `translate(-50%, ${-(1 - pkgFade) * 20}px)`,
              opacity: pkgFade,
              fontFamily: "'Cinzel',serif",
              fontSize: 12,
              fontWeight: 700,
              color: "#e8c870",
              textShadow: "0 0 8px rgba(232,200,112,0.8)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              zIndex: 10,
            }}>
              {lastPkg.label} +{lastPkg.points}
            </div>
          )}

          {phase === "menu" && (
            <div style={{
              position: "absolute", inset: 0, background: "rgba(0,0,0,0.82)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 16,
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "clamp(22px,6vw,38px)", fontWeight: 900, color: "var(--noir-primary)", letterSpacing: ".25em", textShadow: "0 0 30px rgba(201,164,96,0.5)" }}>
                  THE PACKAGE RUN
                </div>
                <div style={{ fontFamily: "'Crimson Text',serif", fontStyle: "italic", fontSize: "clamp(12px,3vw,16px)", color: "rgba(201,164,96,0.6)", marginTop: 6 }}>
                  Move the package through the streets
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 280 }}>
                {PACKAGES.map(p => (
                  <div key={p.type} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--noir-muted)", letterSpacing: ".1em" }}>
                    <span>{p.label}</span>
                    <span style={{ color: "var(--noir-primary)" }}>+{p.points}</span>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#dc2626", letterSpacing: ".1em" }}>
                  <span>🚔</span><span>= Dead</span>
                </div>
              </div>
              <button
                onClick={startGame}
                style={{
                  fontFamily: "'Cinzel',serif", fontSize: 11, fontWeight: 700, letterSpacing: ".3em",
                  textTransform: "uppercase", padding: "10px 28px",
                  background: "linear-gradient(135deg,#6a4010,#c9a460)",
                  border: "none", color: "#0a0c06", cursor: "pointer",
                  boxShadow: "0 0 20px rgba(201,164,96,0.3)",
                }}
              >
                Start Run
              </button>
              <div style={{ fontSize: 9, color: "var(--noir-muted)", letterSpacing: ".15em" }}>
                WASD / ARROWS — PRESS ENTER TO START
              </div>
            </div>
          )}

          {(phase === "dead" || phase === "submitting") && (
            <div style={{
              position: "absolute", inset: 0, background: "rgba(0,0,0,0.88)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 14,
            }}>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: "clamp(16px,4vw,26px)", fontWeight: 900, color: "#dc2626", letterSpacing: ".3em", textShadow: "0 0 20px rgba(220,38,38,0.6)" }}>
                PINCHED
              </div>
              <div style={{ fontFamily: "'Crimson Text',serif", fontStyle: "italic", fontSize: "clamp(11px,3vw,14px)", color: "var(--noir-muted)" }}>
                The feds got you, boss
              </div>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: "clamp(28px,8vw,52px)", fontWeight: 900, color: "var(--noir-primary)", textShadow: "0 0 30px rgba(201,164,96,0.5)", lineHeight: 1 }}>
                {score}
              </div>
              <div style={{ fontSize: 9, letterSpacing: ".2em", color: "var(--noir-muted)" }}>POINTS</div>
              {score > 0 && phase !== "submitting" && (
                <button
                  onClick={() => submitScore(score)}
                  style={{
                    fontFamily: "'Cinzel',serif", fontSize: 10, fontWeight: 700, letterSpacing: ".25em",
                    textTransform: "uppercase", padding: "8px 22px",
                    background: "linear-gradient(135deg,#6a4010,#c9a460)",
                    border: "none", color: "#0a0c06", cursor: "pointer",
                    boxShadow: "0 0 16px rgba(201,164,96,0.25)",
                  }}
                >
                  Submit Score
                </button>
              )}
              {phase === "submitting" && (
                <div style={{ fontSize: 10, color: "var(--noir-muted)", letterSpacing: ".15em" }}>Submitting…</div>
              )}
              <button
                onClick={startGame}
                style={{
                  fontFamily: "'Cinzel',serif", fontSize: 10, letterSpacing: ".2em",
                  padding: "7px 18px", border: "1px solid var(--noir-border)",
                  background: "rgba(201,164,96,0.07)", color: "var(--noir-primary)", cursor: "pointer",
                }}
              >
                Run Again
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "48px 48px 48px", gridTemplateRows: "48px 48px", gap: 4 }}>
          {[
            { label: "▲", dir: "UP",    col: 2, row: 1 },
            { label: "◀", dir: "LEFT",  col: 1, row: 2 },
            { label: "▼", dir: "DOWN",  col: 2, row: 2 },
            { label: "▶", dir: "RIGHT", col: 3, row: 2 },
          ].map(({ label, dir, col, row }) => (
            <button
              key={dir}
              onPointerDown={(e) => { e.preventDefault(); dpad(dir); }}
              style={{
                gridColumn: col, gridRow: row,
                background: "rgba(201,164,96,0.08)", border: "1px solid rgba(201,164,96,0.3)",
                color: "var(--noir-primary)", fontSize: 18, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "sans-serif", userSelect: "none", WebkitUserSelect: "none",
                touchAction: "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.panel} style={{ margin: "12px 16px", padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: 10, letterSpacing: ".25em", textTransform: "uppercase", color: "var(--noir-primary)" }}>
            Top Runners
          </div>
          <button onClick={fetchLB} style={{ fontFamily: "'Cinzel',serif", fontSize: 8, letterSpacing: ".15em", padding: "2px 8px", border: "1px solid var(--noir-border)", background: "transparent", color: "var(--noir-muted)", cursor: "pointer" }}>
            Refresh
          </button>
        </div>
        {loadingLB ? (
          <div style={{ fontSize: 11, color: "var(--noir-muted)", fontStyle: "italic", fontFamily: "'Crimson Text',serif" }}>Loading…</div>
        ) : leaderboard.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--noir-muted)", fontStyle: "italic", fontFamily: "'Crimson Text',serif" }}>No scores yet. Be the first.</div>
        ) : (
          leaderboard.slice(0, 10).map((row, i) => (
            <div key={row.user_id || i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "5px 0", borderBottom: "1px solid rgba(201,164,96,0.06)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'Cinzel',serif", fontSize: 10, fontWeight: 700,
                  background: i === 0 ? "linear-gradient(135deg,#a87820,#e8c870)" : i === 1 ? "rgba(160,160,160,.2)" : i === 2 ? "rgba(140,80,20,.2)" : "rgba(201,164,96,.06)",
                  color: i === 0 ? "#0a0c06" : i === 1 ? "#bbb" : i === 2 ? "#c07a30" : "var(--noir-muted)",
                  border: i > 0 ? "1px solid rgba(201,164,96,.15)" : "none",
                  flexShrink: 0,
                }}>{i + 1}</div>
                <span style={{ fontSize: 13, fontWeight: 600, color: row.is_me ? "var(--noir-primary)" : "var(--noir-foreground)" }}>
                  {row.username}
                  {row.is_me && <span style={{ fontSize: 9, color: "var(--noir-primary)", marginLeft: 4 }}>(You)</span>}
                </span>
              </div>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: 11, color: "var(--noir-primary)", background: "rgba(201,164,96,.08)", border: "1px solid var(--noir-border)", padding: "1px 8px" }}>
                {row.score.toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.panel} style={{ margin: "0 16px 20px", padding: "10px 14px" }}>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: 9, letterSpacing: ".25em", textTransform: "uppercase", color: "var(--noir-muted)", marginBottom: 8 }}>
          Contraband
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PACKAGES.map(p => (
            <div key={p.type} style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "rgba(201,164,96,0.05)", border: "1px solid rgba(201,164,96,0.12)",
              padding: "4px 8px", fontSize: 11,
            }}>
              <span>{p.label}</span>
              <span style={{ fontFamily: "'Cinzel',serif", fontSize: 9, color: "var(--noir-primary)", letterSpacing: ".1em" }}>
                {p.type.toUpperCase()}
              </span>
              <span style={{ fontSize: 10, color: p.color, fontWeight: 700 }}>+{p.points}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: "var(--noir-muted)", fontFamily: "'Crimson Text',serif", fontStyle: "italic" }}>
          🚔 Cops appear after {COP_THRESHOLD} points. Speed increases as you collect.
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Crimson+Text:ital@0;1&display=swap');
      `}</style>
    </div>
  );
}
