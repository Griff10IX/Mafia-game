import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api, { getApiErrorMessage, refreshUser } from "../../utils/api";
import styles from "../../styles/noir.module.css";

const GRAVITY = 0.42;
const JUMP_FORCE = -7.2;
const PIPE_SPEED_BASE = 3.0;
const PIPE_GAP_BASE = 175;
const PIPE_WIDTH = 62;
const BIRD_SIZE = 36;
const VIEW_W = 420;
const VIEW_H = 580;

// Speed options (multiplier for pipe movement and spawn rate)
const SPEED_OPTIONS = [
  { id: "slow", label: "Slow", mult: 0.7 },
  { id: "normal", label: "Normal", mult: 1 },
  { id: "fast", label: "Fast", mult: 1.4 },
];

// Difficulty: gap offset (added to PIPE_GAP_BASE), pipe speed mult
const DIFFICULTY_OPTIONS = [
  { id: "easy", label: "Easy", gapOffset: 25, speedMult: 0.85 },
  { id: "normal", label: "Normal", gapOffset: 0, speedMult: 1 },
  { id: "hard", label: "Hard", gapOffset: -30, speedMult: 1.25 },
];

// Themes: id, name, and SVG-relevant colors/gradients
const THEMES = [
  { id: "classic", name: "Classic", sky: ["#282828", "#1a1a1a", "#000"], pipe: "var(--noir-panel)", brick: "rgba(140,90,40,0.32)", accent: "var(--noir-primary)", stripe: "rgba(var(--noir-primary-rgb),0.05)" },
  { id: "neon", name: "Neon", sky: ["#0a0a1a", "#050510", "#000"], pipe: "#1a1a2e", brick: "rgba(80,200,255,0.25)", accent: "#00ffcc", stripe: "rgba(0,255,200,0.08)" },
  { id: "sunset", name: "Sunset", sky: ["#2a1810", "#1a0c08", "#0d0604"], pipe: "#3d2817", brick: "rgba(180,80,40,0.35)", accent: "#e8a030", stripe: "rgba(232,160,48,0.06)" },
  { id: "graveyard", name: "Graveyard", sky: ["#1a1e1a", "#0e120e", "#050805"], pipe: "#252a25", brick: "rgba(80,100,70,0.3)", accent: "#8a9a6a", stripe: "rgba(138,154,106,0.06)" },
];

// Reward tiers (kept in sync with backend); after 50 gates: +$2k cash & +2 respect per gate, caps 1M / 1000
const REWARD_TIERS = [
  { score: 1, cash: 250, respect: 5, label: "Street Punk" },
  { score: 5, cash: 1000, respect: 5, label: "Corner Boy" },
  { score: 10, cash: 2500, respect: 10, label: "Made Man" },
  { score: 20, cash: 6000, respect: 20, label: "Underboss" },
  { score: 35, cash: 12500, respect: 20, label: "Capo" },
  { score: 50, cash: 25000, respect: 40, label: "Don" },
];
const MAX_CASH_CAP = 1_000_000;
const MAX_RESPECT_CAP = 1_000;
const CASH_PER_GATE_AFTER_50 = 2_000;
const RESPECT_PER_GATE_AFTER_50 = 2;

function getReward(score) {
  let cash = 0, respect = 0, label = "Nobody", tier = -1;
  for (let i = 0; i < REWARD_TIERS.length; i++) {
    if (score >= REWARD_TIERS[i].score) {
      cash += REWARD_TIERS[i].cash;
      respect += REWARD_TIERS[i].respect;
      label = REWARD_TIERS[i].label;
      tier = i;
    }
  }
  if (score > 50) {
    const extra = score - 50;
    cash += Math.min(MAX_CASH_CAP - cash, extra * CASH_PER_GATE_AFTER_50);
    respect += Math.min(MAX_RESPECT_CAP - respect, extra * RESPECT_PER_GATE_AFTER_50);
  }
  cash = Math.min(MAX_CASH_CAP, cash);
  respect = Math.min(MAX_RESPECT_CAP, respect);
  return { cash, respect, label, tier };
}

function getNextTier(score) {
  const r = getReward(score);
  if (score >= 50) return { score: score + 10, cash: CASH_PER_GATE_AFTER_50 * 10, respect: RESPECT_PER_GATE_AFTER_50 * 10, label: `${score + 10} gates` };
  for (let i = 0; i < REWARD_TIERS.length; i++) {
    if (score < REWARD_TIERS[i].score) return REWARD_TIERS[i];
  }
  return null;
}

function FedoraHat({ x, y, rotation, accent }) {
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
}

function Pipe({ x, topHeight, gap, theme }) {
  const pipeFill = theme?.pipe || "var(--noir-panel)";
  const patternId = theme?.id ? `brickPattern-${theme.id}` : "brickPattern-classic";
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

export default function Gauntlet() {
  const [gameState, setGameState] = useState("idle"); // idle, playing, dead
  const [birdY, setBirdY] = useState(VIEW_H / 2);
  const [birdVel, setBirdVel] = useState(0);
  const [birdRot, setBirdRot] = useState(0);
  const [pipes, setPipes] = useState([]);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [money, setMoney] = useState(0);
  const [flashGold, setFlashGold] = useState(false);
  const [particles, setParticles] = useState([]);
  const [bgOffset, setBgOffset] = useState(0);
  const [claimStatus, setClaimStatus] = useState({ state: "idle", cash: 0, respect: 0, message: "" }); // idle|claiming|claimed|error
  const [lbPeriod, setLbPeriod] = useState("weekly");
  const [top10, setTop10] = useState([]);
  const [themeId, setThemeId] = useState("classic");
  const [speedId, setSpeedId] = useState("normal");
  const [difficultyId, setDifficultyId] = useState("normal");

  const frameRef = useRef(null);
  const stateRef = useRef(gameState);
  const birdYRef = useRef(birdY);
  const birdVelRef = useRef(birdVel);
  const pipesRef = useRef(pipes);
  const scoreRef = useRef(score);
  const tickRef = useRef(0);
  const speedRef = useRef(speedId);
  const difficultyRef = useRef(difficultyId);
  speedRef.current = speedId;
  difficultyRef.current = difficultyId;

  stateRef.current = gameState;
  birdYRef.current = birdY;
  birdVelRef.current = birdVel;
  pipesRef.current = pipes;
  scoreRef.current = score;

  const isTouch = useMemo(() => {
    if (typeof window === "undefined") return false;
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }, []);

  useEffect(() => {
    let mounted = true;
    api
      .get("/auth/me")
      .then((r) => {
        if (!mounted) return;
        setMoney(Number(r.data?.money || 0));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const loadLeaderboard = useCallback(async (period) => {
    try {
      const p = (period || lbPeriod || "weekly").toLowerCase();
      const r = await api.get("/gauntlet/leaderboard", { params: { period: p } });
      setTop10(Array.isArray(r.data?.top10) ? r.data.top10 : []);
    } catch (_) {
      setTop10([]);
    }
  }, [lbPeriod]);

  useEffect(() => {
    loadLeaderboard(lbPeriod);
  }, [lbPeriod, loadLeaderboard]);

  const spawnParticles = useCallback((x, y, color = "#c9a84c") => {
    const newP = Array.from({ length: 8 }, (_, i) => ({
      id: Date.now() + i,
      x,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      life: 1,
      color,
    }));
    setParticles((p) => [...p, ...newP]);
    setTimeout(() => setParticles((p) => p.filter((pt) => !newP.find((n) => n.id === pt.id))), 800);
  }, []);

  const claimReward = useCallback(async (finalScore) => {
    if (claimStatus.state === "claiming" || claimStatus.state === "claimed") return;
    setClaimStatus({ state: "claiming", cash: 0, respect: 0, message: "" });
    try {
      const res = await api.post("/gauntlet/claim", {
        score: Number(finalScore || 0),
        theme: themeId,
        speed: speedId,
        difficulty: difficultyId,
      });
      const cash = Number(res.data?.cash_awarded || 0);
      const respect = Number(res.data?.respect_awarded || 0);
      const playsLeft = res.data?.plays_left;
      const resetsAt = res.data?.resets_at;
      const newMoney = res.data?.money;
      if (newMoney != null) {
        setMoney(Number(newMoney));
        refreshUser(Number(newMoney));
      }
      const playsMsg = (playsLeft != null) ? ` • Plays left this hour: ${Number(playsLeft)}` : "";
      const resetMsg = (resetsAt && typeof resetsAt === "string") ? ` (resets ${resetsAt.replace("T", " ").replace("Z", " UTC")})` : "";
      const parts = [];
      if (cash > 0) parts.push(`$${cash.toLocaleString()}`);
      if (respect > 0) parts.push(`${respect} respect`);
      setClaimStatus({
        state: "claimed",
        cash,
        respect,
        message: (parts.length ? `Claimed ${parts.join(" & ")}` : "No reward (score 1+ to earn)") + playsMsg + resetMsg,
      });
      loadLeaderboard(lbPeriod);
    } catch (e) {
      setClaimStatus({ state: "error", cash: 0, respect: 0, message: getApiErrorMessage(e) });
    }
  }, [claimStatus.state, lbPeriod, loadLeaderboard, themeId, speedId, difficultyId]);

  const jump = useCallback(() => {
    if (stateRef.current === "idle") {
      setClaimStatus({ state: "idle", cash: 0, message: "" });
      setGameState("playing");
      setBirdVel(JUMP_FORCE);
      setPipes([{ x: VIEW_W + 80, topHeight: 100 + Math.random() * 200, scored: false }]);
      tickRef.current = 0;
      return;
    }
    if (stateRef.current === "playing") {
      // Slightly smooth: don't stack jumps into an extreme velocity
      setBirdVel((v) => Math.min(JUMP_FORCE, v - 1.2));
    }
    if (stateRef.current === "dead") {
      setGameState("idle");
      setBirdY(VIEW_H / 2);
      setBirdVel(0);
      setBirdRot(0);
      setPipes([]);
      setScore(0);
      setClaimStatus({ state: "idle", cash: 0, respect: 0, message: "" });
    }
  }, []);

  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const speedOpt = SPEED_OPTIONS.find((s) => s.id === speedId) || SPEED_OPTIONS[1];
  const difficultyOpt = DIFFICULTY_OPTIONS.find((d) => d.id === difficultyId) || DIFFICULTY_OPTIONS[1];
  const pipeSpeed = PIPE_SPEED_BASE * speedOpt.mult * difficultyOpt.speedMult;
  const pipeGap = PIPE_GAP_BASE + difficultyOpt.gapOffset;
  const spawnInterval = Math.max(40, Math.round(95 / speedOpt.mult));

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump]);

  useEffect(() => {
    if (gameState !== "playing") return;

    const loop = () => {
      tickRef.current++;

      const newVel = birdVelRef.current + GRAVITY;
      const newY = birdYRef.current + newVel;
      const newRot = Math.max(-30, Math.min(90, newVel * 5));

      setBgOffset((o) => (o + 1) % 60);

      let newPipes = pipesRef.current.map((p) => ({ ...p, x: p.x - pipeSpeed }));
      if (tickRef.current % spawnInterval === 0) {
        newPipes.push({ x: VIEW_W + 20, topHeight: 80 + Math.random() * 240, scored: false });
      }
      newPipes = newPipes.filter((p) => p.x > -PIPE_WIDTH - 20);

      let newScore = scoreRef.current;
      newPipes = newPipes.map((p) => {
        if (!p.scored && p.x + PIPE_WIDTH < 80) {
          newScore++;
          setFlashGold(true);
          setTimeout(() => setFlashGold(false), 260);
          spawnParticles(80, newY, theme.accent || "#c9a84c");
          return { ...p, scored: true };
        }
        return p;
      });

      const birdX = 70;
      const birdR = BIRD_SIZE / 2 - 4;
      let dead = newY < 0 || newY > VIEW_H - BIRD_SIZE;

      for (const p of newPipes) {
        const inX = birdX + birdR > p.x + 4 && birdX - birdR < p.x + PIPE_WIDTH - 4;
        const inTop = newY - birdR < p.topHeight - 4;
        const inBot = newY + birdR > p.topHeight + pipeGap + 4;
        if (inX && (inTop || inBot)) {
          dead = true;
          break;
        }
      }

      if (dead) {
        spawnParticles(birdX, birdYRef.current, "#ff4444");
        setBestScore((b) => Math.max(b, newScore));
        setScore(newScore);
        setGameState("dead");
        cancelAnimationFrame(frameRef.current);
        claimReward(newScore);
        return;
      }

      setBirdY(newY);
      setBirdVel(newVel);
      setBirdRot(newRot);
      setPipes(newPipes);
      setScore(newScore);

      frameRef.current = requestAnimationFrame(loop);
    };

    frameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameRef.current);
  }, [gameState, pipeSpeed, pipeGap, spawnInterval, theme.accent, spawnParticles, claimReward]);

  const reward = getReward(score);
  const nextTier = getNextTier(score);

  const onPointerDown = useCallback((e) => {
    // prevent mobile scroll / double-tap zoom during play
    if (e?.preventDefault) e.preventDefault();
    jump();
  }, [jump]);

  return (
    <div
      className={styles.panel}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        width: "100%",
        background: "var(--noir-surface)",
        color: "var(--noir-foreground)",
        fontFamily: "var(--font-heading, 'Cinzel', serif)",
        padding: isTouch ? "10px 10px 14px" : "14px 14px 16px",
        borderRadius: "8px",
        border: "1px solid var(--noir-border-mid)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <h1
          style={{
            fontSize: "clamp(18px, 4.5vw, 28px)",
            color: "var(--noir-primary)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            margin: 0,
            textShadow: "0 0 20px rgba(var(--noir-primary-rgb),0.35)",
          }}
        >
          Flappy Gangster
        </h1>
        <p style={{ color: "var(--noir-muted)", fontSize: "11px", letterSpacing: "0.1em", margin: "2px 0 0" }}>
          FLY THE CORRIDOR — EARN YOUR KEEP
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: "18px",
          marginBottom: "10px",
          padding: "8px 16px",
          background: "rgba(var(--noir-primary-rgb),0.06)",
          border: "1px solid var(--noir-border-light)",
          borderRadius: "6px",
          width: "min(420px, 100%)",
          justifyContent: "space-between",
        }}
      >
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>BANK</div>
          <div style={{ color: "var(--noir-primary)", fontSize: "16px", fontWeight: "700" }}>${Number(money || 0).toLocaleString()}</div>
        </div>
        <div style={{ width: "1px", background: "var(--noir-border-light)" }} />
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>BEST</div>
          <div style={{ color: "var(--noir-foreground)", opacity: 0.85, fontSize: "16px" }}>{bestScore}</div>
        </div>
      </div>

      <div style={{ marginBottom: "10px", padding: "8px 16px", background: "var(--noir-content)", border: "1px solid var(--noir-border-light)", borderRadius: "6px", width: "min(420px, 100%)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>THEME</span>
            {THEMES.map((t) => (
              <button key={t.id} type="button" onClick={() => setThemeId(t.id)} style={{ padding: "4px 10px", fontSize: 11, border: `1px solid ${themeId === t.id ? "var(--noir-primary)" : "var(--noir-border)"}`, borderRadius: 4, background: themeId === t.id ? "rgba(var(--noir-primary-rgb),0.15)" : "transparent", color: themeId === t.id ? "var(--noir-primary)" : "var(--noir-muted)", cursor: "pointer" }}>{t.name}</button>
            ))}
          </div>
          <div style={{ width: "1px", height: 20, background: "var(--noir-border)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>SPEED</span>
            {SPEED_OPTIONS.map((s) => (
              <button key={s.id} type="button" onClick={() => setSpeedId(s.id)} style={{ padding: "4px 10px", fontSize: 11, border: `1px solid ${speedId === s.id ? "var(--noir-primary)" : "var(--noir-border)"}`, borderRadius: 4, background: speedId === s.id ? "rgba(var(--noir-primary-rgb),0.15)" : "transparent", color: speedId === s.id ? "var(--noir-primary)" : "var(--noir-muted)", cursor: "pointer" }}>{s.label}</button>
            ))}
          </div>
          <div style={{ width: "1px", height: 20, background: "var(--noir-border)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ color: "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em" }}>DIFFICULTY</span>
            {DIFFICULTY_OPTIONS.map((d) => (
              <button key={d.id} type="button" onClick={() => setDifficultyId(d.id)} style={{ padding: "4px 10px", fontSize: 11, border: `1px solid ${difficultyId === d.id ? "var(--noir-primary)" : "var(--noir-border)"}`, borderRadius: 4, background: difficultyId === d.id ? "rgba(var(--noir-primary-rgb),0.15)" : "transparent", color: difficultyId === d.id ? "var(--noir-primary)" : "var(--noir-muted)", cursor: "pointer" }}>{d.label}</button>
            ))}
          </div>
        </div>
        <p style={{ color: "var(--noir-muted)", fontSize: "9px", marginTop: "6px", marginBottom: 0, textAlign: "center" }}>Rewards capped at 1,000 respect & $1,000,000 cash per run</p>
      </div>

      <div className="w-full flex flex-col md:flex-row md:items-start md:justify-center gap-3">
        <div
          style={{
            position: "relative",
            width: "min(420px, 100%)",
            borderRadius: "10px",
            overflow: "hidden",
            border: "2px solid var(--noir-border-mid)",
            boxShadow: "0 0 40px rgba(var(--noir-primary-rgb),0.10), inset 0 0 40px rgba(0,0,0,0.45)",
            cursor: "pointer",
            touchAction: "manipulation",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTapHighlightColor: "transparent",
          }}
          onPointerDown={onPointerDown}
        >
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ display: "block", width: "100%", height: "auto" }}>
          <defs>
            {THEMES.map((t) => (
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
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect width={VIEW_W} height={VIEW_H} fill={`url(#skyGrad-${theme.id})`} />
          <rect width={VIEW_W} height={VIEW_H} fill="url(#bgStripes)" />
          <rect width={VIEW_W} height={VIEW_H} fill="rgba(255,255,255,0.06)" />

          <circle cx={VIEW_W - 60} cy={70} r={35} fill={theme.pipe} />
          <circle cx={VIEW_W - 55} cy={65} r={33} fill={theme.accent} opacity="0.12" />
          <circle cx={VIEW_W - 55} cy={65} r={28} fill={theme.accent} opacity="0.07" />

          {[0, 40, 80, 120, 160, 200, 240, 280, 320, 360].map((bx, i) => (
            <rect
              key={i}
              x={bx}
              y={VIEW_H - 80 - (i % 3) * 40 - (i % 5) * 20}
              width={35}
              height={80 + (i % 3) * 40 + (i % 5) * 20}
              fill="rgba(0,0,0,0.28)"
            />
          ))}

          <rect x={0} y={VIEW_H - 30} width={VIEW_W} height={30} fill="var(--noir-bg)" />
          <rect x={0} y={VIEW_H - 30} width={VIEW_W} height={4} fill={theme.accent} opacity="0.2" />

          {pipes.map((p, i) => (
            <Pipe key={i} x={p.x} topHeight={p.topHeight} gap={pipeGap} theme={theme} />
          ))}

          {particles.map((pt) => (
            <circle key={pt.id} cx={pt.x + pt.vx * 5} cy={pt.y + pt.vy * 5} r={3} fill={pt.color} opacity={pt.life * 0.8} />
          ))}

          {gameState !== "idle" && <FedoraHat x={70 - BIRD_SIZE / 2} y={birdY - BIRD_SIZE / 2} rotation={birdRot} accent={theme.accent} />}

          {gameState === "playing" && (
            <g filter={flashGold ? "url(#glow)" : ""}>
              <text x={VIEW_W / 2} y={55} textAnchor="middle" fill={flashGold ? (theme.accent || "var(--noir-primary-bright)") : (theme.accent || "var(--noir-primary)")} fontSize="42" fontFamily="Cinzel, serif" fontWeight="700" opacity="0.9">
                {score}
              </text>
              {reward.label !== "Nobody" && (
                <text x={VIEW_W / 2} y={78} textAnchor="middle" fill="var(--noir-muted)" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="2">
                  {reward.label.toUpperCase()}
                </text>
              )}
            </g>
          )}

          {gameState === "idle" && (
            <g>
              <rect width={VIEW_W} height={VIEW_H} fill="rgba(0,0,0,0.38)" />
              <FedoraHat x={70 - BIRD_SIZE / 2} y={VIEW_H / 2 - BIRD_SIZE / 2} rotation={0} accent={theme.accent} />

              <text x={VIEW_W / 2} y={VIEW_H / 2 - 80} textAnchor="middle" fill={theme.accent} fontSize="32" fontFamily="Cinzel, serif" fontWeight="700" letterSpacing="3">
                FLAPPY GANGSTER
              </text>
              <text x={VIEW_W / 2} y={VIEW_H / 2 - 50} textAnchor="middle" fill="var(--noir-muted)" fontSize="12" fontFamily="Cinzel, serif" letterSpacing="2">
                NAVIGATE THE CORRIDORS OF POWER
              </text>

              {REWARD_TIERS.slice(0, 4).map((t, i) => (
                <g key={i}>
                  <text x={VIEW_W / 2 - 60} y={VIEW_H / 2 + 20 + i * 22} textAnchor="middle" fill="var(--noir-foreground)" opacity="0.75" fontSize="11" fontFamily="Cinzel, serif">
                    {t.label} ({t.score}+)
                  </text>
                  <text x={VIEW_W / 2 + 70} y={VIEW_H / 2 + 20 + i * 22} textAnchor="middle" fill={theme.accent} fontSize="11" fontFamily="Cinzel, serif">
                    +${t.cash.toLocaleString()} / +{t.respect} resp
                  </text>
                </g>
              ))}

              <text x={VIEW_W / 2} y={VIEW_H / 2 + 108} textAnchor="middle" fill="var(--noir-muted)" fontSize="9" fontFamily="Cinzel, serif" letterSpacing="0.5">
                After 50: +$2k & +2 resp/gate. Caps: $1M / 1,000 respect
              </text>

              <text x={VIEW_W / 2} y={VIEW_H / 2 + 138} textAnchor="middle" fill={theme.accent} fontSize="13" fontFamily="Cinzel, serif" letterSpacing="3" opacity={0.85}>
                {isTouch ? "TAP TO BEGIN" : "TAP / SPACE TO BEGIN"}
              </text>
            </g>
          )}

          {gameState === "dead" && (
            <g>
              <rect width={VIEW_W} height={VIEW_H} fill="rgba(0,0,0,0.75)" />

              <text x={VIEW_W / 2} y={VIEW_H / 2 - 130} textAnchor="middle" fill="#8b1a1a" fontSize="30" fontFamily="Cinzel, serif" fontWeight="700" letterSpacing="3">
                YOU'RE DONE
              </text>
              <text x={VIEW_W / 2} y={VIEW_H / 2 - 95} textAnchor="middle" fill="var(--noir-muted)" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="1">
                THE FAMILY SENDS ITS REGARDS
              </text>

              <text x={VIEW_W / 2} y={VIEW_H / 2 - 50} textAnchor="middle" fill="var(--noir-primary)" fontSize="60" fontFamily="Cinzel, serif" fontWeight="700">
                {score}
              </text>
              <text x={VIEW_W / 2} y={VIEW_H / 2 - 20} textAnchor="middle" fill="var(--noir-muted)" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="2">
                GATES CLEARED
              </text>

              <rect x={VIEW_W / 2 - 140} y={VIEW_H / 2} width={280} height={95} rx="6" fill="rgba(var(--noir-primary-rgb),0.08)" stroke="var(--noir-border-mid)" strokeWidth="1" />

              <foreignObject x={VIEW_W / 2 - 140} y={VIEW_H / 2} width={280} height={95} style={{ overflow: "visible" }}>
                <div xmlns="http://www.w3.org/1999/xhtml" style={{ padding: "8px 12px", textAlign: "center", width: "100%", boxSizing: "border-box" }}>
                  <div style={{ color: "var(--noir-primary)", fontSize: 13, letterSpacing: "0.15em", fontFamily: "Cinzel, serif", marginBottom: 4 }}>
                    {reward.label !== "Nobody" ? reward.label.toUpperCase() : "NOBODY"}
                  </div>
                  <div style={{ color: claimStatus.state === "error" ? "#f87171" : claimStatus.cash > 0 || claimStatus.respect > 0 ? "var(--noir-primary-bright)" : "var(--noir-muted)", fontSize: 14, fontWeight: 700, fontFamily: "Cinzel, serif", lineHeight: 1.35, wordBreak: "break-word" }}>
                    {claimStatus.state === "claiming" ? "CLAIMING..." : (claimStatus.message || (reward.cash > 0 || reward.respect > 0 ? `+$${reward.cash.toLocaleString()}${reward.respect > 0 ? ` & +${reward.respect} respect` : ""} EARNED` : "Score 1+ to earn"))}
                  </div>
                  {nextTier && (
                    <div style={{ color: "var(--noir-muted)", fontSize: 10, letterSpacing: "0.08em", fontFamily: "Cinzel, serif", marginTop: 6, lineHeight: 1.3, wordBreak: "break-word" }}>
                      {nextTier.label ? `REACH ${nextTier.score} FOR ${nextTier.label.toUpperCase()}` : `REACH ${nextTier.score} GATES`}{nextTier.cash != null || nextTier.respect != null ? ` (+$${nextTier.cash != null ? nextTier.cash.toLocaleString() : "0"} / +${nextTier.respect != null ? nextTier.respect : 0} resp)` : ""}
                    </div>
                  )}
                </div>
              </foreignObject>

              <text x={VIEW_W / 2} y={VIEW_H / 2 + 132} textAnchor="middle" fill="var(--noir-primary)" fontSize="12" fontFamily="Cinzel, serif" letterSpacing="3" opacity="0.85">
                TAP TO TRY AGAIN
              </text>
            </g>
          )}
        </svg>
        </div>

        <div
          className="w-full md:w-[340px] rounded-md"
          style={{
            background: "var(--noir-content)",
            border: "1px solid var(--noir-border-mid)",
            padding: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--noir-primary)" }}>
              Top 10
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={lbPeriod}
                onChange={(e) => setLbPeriod(e.target.value)}
                style={{
                  background: "var(--noir-surface)",
                  border: "1px solid var(--noir-border-light)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  color: "var(--noir-foreground)",
                }}
              >
                <option value="weekly">Weekly</option>
                <option value="alltime">All-time</option>
              </select>
              <button
                type="button"
                onClick={() => loadLeaderboard(lbPeriod)}
                style={{
                  background: "var(--noir-raised)",
                  border: "1px solid var(--noir-border-light)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 11,
                  color: "var(--noir-foreground)",
                }}
              >
                Refresh
              </button>
            </div>
          </div>

          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {(top10 || []).map((r) => (
              <div
                key={`${r.rank}-${r.user_id || r.username}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  background: "var(--noir-raised)",
                  border: "1px solid var(--noir-border-light)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                  <span style={{ color: "var(--noir-primary)", fontWeight: 700 }}>#{r.rank}</span>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.username}</span>
                </div>
                <div style={{ fontWeight: 700 }}>{Number(r.score || 0)}</div>
              </div>
            ))}
            {!top10?.length ? (
              <div style={{ color: "var(--noir-muted)", fontSize: 11 }}>No scores yet.</div>
            ) : null}
          </div>

          <div style={{ marginTop: 10, color: "var(--noir-muted)", fontSize: 10, letterSpacing: "0.06em" }}>
            Weekly = best score since Monday (UTC).
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: "10px",
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: "min(420px, 100%)",
        }}
      >
        {REWARD_TIERS.map((t, i) => {
          const active = score >= t.score && gameState === "dead";
          const current = reward.tier === i && gameState === "dead";
          return (
            <div
              key={i}
              style={{
                padding: "6px 10px",
                border: `1px solid ${current ? "var(--noir-primary)" : active ? "var(--noir-border-mid)" : "var(--noir-border-light)"}`,
                borderRadius: "6px",
                background: current ? "rgba(var(--noir-primary-rgb),0.12)" : "transparent",
                textAlign: "center",
                transition: "all 0.3s",
                minWidth: 92,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ color: current ? "var(--noir-primary)" : "var(--noir-muted)", fontSize: "9px", letterSpacing: "0.1em", textAlign: "center" }}>{t.label.toUpperCase()}</div>
              <div style={{ color: current ? "var(--noir-primary-bright)" : "var(--noir-foreground)", opacity: current ? 1 : 0.8, fontSize: "11px", fontWeight: "700", textAlign: "center" }}>${t.cash.toLocaleString()} / {t.respect} resp</div>
              <div style={{ color: "var(--noir-muted)", fontSize: "8px", textAlign: "center" }}>{t.score}+ gates</div>
            </div>
          );
        })}
      </div>

      <p style={{ color: "var(--noir-muted)", fontSize: "10px", marginTop: "6px", letterSpacing: "0.1em", textAlign: "center" }}>
        After 50: +$2k & +2 respect per gate. Caps: $1M / 1,000 respect
      </p>
      <p style={{ color: "var(--noir-muted)", fontSize: "10px", marginTop: "4px", letterSpacing: "0.1em", textAlign: "center" }}>
        {isTouch ? "TAP TO FLY" : "SPACE / TAP TO FLY"}
      </p>
    </div>
  );
}

