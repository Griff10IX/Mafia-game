import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api, { getApiErrorMessage, refreshUser } from "../utils/api";

const GRAVITY = 0.42;
const JUMP_FORCE = -7.2;
const PIPE_SPEED = 3.0;
const PIPE_GAP = 175;
const PIPE_WIDTH = 62;
const BIRD_SIZE = 36;
const VIEW_W = 420;
const VIEW_H = 580;

// Cash reward tiers (kept in sync with backend/routers/gauntlet.py)
const REWARD_TIERS = [
  { score: 1, cash: 250, label: "Street Punk" },
  { score: 5, cash: 1000, label: "Corner Boy" },
  { score: 10, cash: 2500, label: "Made Man" },
  { score: 20, cash: 6000, label: "Underboss" },
  { score: 35, cash: 12500, label: "Capo" },
  { score: 50, cash: 25000, label: "Don" },
];

function getCashReward(score) {
  let reward = { cash: 0, label: "Nobody", tier: -1 };
  for (let i = 0; i < REWARD_TIERS.length; i++) {
    if (score >= REWARD_TIERS[i].score) {
      reward = { ...REWARD_TIERS[i], tier: i };
    }
  }
  return reward;
}

function getNextTier(score) {
  for (let i = 0; i < REWARD_TIERS.length; i++) {
    if (score < REWARD_TIERS[i].score) return REWARD_TIERS[i];
  }
  return null;
}

function FedoraHat({ x, y, rotation }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation}, 18, 18)`}>
      <ellipse cx="18" cy="22" rx="14" ry="10" fill="#c9a84c" />
      <ellipse cx="18" cy="14" rx="18" ry="5" fill="#1a1008" />
      <rect x="8" y="4" width="20" height="12" rx="4" fill="#2a1a0a" />
      <rect x="8" y="13" width="20" height="3" fill="#c9a84c" />
      <circle cx="25" cy="20" r="3" fill="#1a1008" />
      <circle cx="26" cy="19" r="1" fill="#fff" />
      <rect x="30" y="22" width="8" height="2" rx="1" fill="#e8e0d0" />
      <circle cx="38" cy="23" r="2" fill="#ff6b35" opacity="0.9" />
    </g>
  );
}

function Pipe({ x, topHeight, gap }) {
  const bottomY = topHeight + gap;
  const bottomHeight = VIEW_H - bottomY;
  return (
    <g>
      <rect x={x} y={0} width={PIPE_WIDTH} height={topHeight} fill="#1a1008" />
      <rect x={x} y={0} width={PIPE_WIDTH} height={topHeight} fill="url(#brickPattern)" opacity="0.4" />
      <rect x={x - 4} y={topHeight - 24} width={PIPE_WIDTH + 8} height={24} rx="3" fill="#2a1a0a" />
      <rect x={x - 4} y={topHeight - 24} width={PIPE_WIDTH + 8} height={24} rx="3" fill="url(#brickPattern)" opacity="0.3" />
      <rect x={x} y={0} width="3" height={topHeight} fill="rgba(255,255,255,0.05)" />

      <rect x={x} y={bottomY} width={PIPE_WIDTH} height={bottomHeight} fill="#1a1008" />
      <rect x={x} y={bottomY} width={PIPE_WIDTH} height={bottomHeight} fill="url(#brickPattern)" opacity="0.4" />
      <rect x={x - 4} y={bottomY} width={PIPE_WIDTH + 8} height={24} rx="3" fill="#2a1a0a" />
      <rect x={x - 4} y={bottomY} width={PIPE_WIDTH + 8} height={24} rx="3" fill="url(#brickPattern)" opacity="0.3" />
      <rect x={x} y={bottomY} width="3" height={bottomHeight} fill="rgba(255,255,255,0.05)" />
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
  const [claimStatus, setClaimStatus] = useState({ state: "idle", cash: 0, message: "" }); // idle|claiming|claimed|error

  const frameRef = useRef(null);
  const stateRef = useRef(gameState);
  const birdYRef = useRef(birdY);
  const birdVelRef = useRef(birdVel);
  const pipesRef = useRef(pipes);
  const scoreRef = useRef(score);
  const tickRef = useRef(0);

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
    setClaimStatus({ state: "claiming", cash: 0, message: "" });
    try {
      const res = await api.post("/gauntlet/claim", { score: Number(finalScore || 0) });
      const cash = Number(res.data?.cash_awarded || 0);
      const newMoney = res.data?.money;
      if (newMoney != null) {
        setMoney(Number(newMoney));
        refreshUser(Number(newMoney));
      }
      setClaimStatus({ state: "claimed", cash, message: cash > 0 ? `Claimed $${cash.toLocaleString()}` : "No reward (score 1+ to earn cash)" });
    } catch (e) {
      setClaimStatus({ state: "error", cash: 0, message: getApiErrorMessage(e) });
    }
  }, [claimStatus.state]);

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
      setClaimStatus({ state: "idle", cash: 0, message: "" });
    }
  }, []);

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

      let newPipes = pipesRef.current.map((p) => ({ ...p, x: p.x - PIPE_SPEED }));
      if (tickRef.current % 95 === 0) {
        newPipes.push({ x: VIEW_W + 20, topHeight: 80 + Math.random() * 240, scored: false });
      }
      newPipes = newPipes.filter((p) => p.x > -PIPE_WIDTH - 20);

      let newScore = scoreRef.current;
      newPipes = newPipes.map((p) => {
        if (!p.scored && p.x + PIPE_WIDTH < 80) {
          newScore++;
          setFlashGold(true);
          setTimeout(() => setFlashGold(false), 260);
          spawnParticles(80, newY, "#c9a84c");
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
        const inBot = newY + birdR > p.topHeight + PIPE_GAP + 4;
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
  }, [gameState, spawnParticles, claimReward]);

  const reward = getCashReward(score);
  const nextTier = getNextTier(score);

  const onPointerDown = useCallback((e) => {
    // prevent mobile scroll / double-tap zoom during play
    if (e?.preventDefault) e.preventDefault();
    jump();
  }, [jump]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        width: "100%",
        background: "#0d0a05",
        fontFamily: "'Cinzel', serif",
        padding: isTouch ? "10px 10px 14px" : "14px 14px 16px",
        borderRadius: "8px",
        border: "1px solid rgba(201,168,76,0.15)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <h1
          style={{
            fontSize: "clamp(18px, 4.5vw, 28px)",
            color: "#c9a84c",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            margin: 0,
            textShadow: "0 0 20px rgba(201,168,76,0.5)",
          }}
        >
          The Gauntlet
        </h1>
        <p style={{ color: "#6b5a3a", fontSize: "11px", letterSpacing: "0.1em", margin: "2px 0 0" }}>
          FLY THE CORRIDOR — EARN YOUR KEEP
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: "18px",
          marginBottom: "10px",
          padding: "8px 16px",
          background: "rgba(201,168,76,0.06)",
          border: "1px solid rgba(201,168,76,0.2)",
          borderRadius: "6px",
          width: "min(420px, 100%)",
          justifyContent: "space-between",
        }}
      >
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ color: "#6b5a3a", fontSize: "9px", letterSpacing: "0.1em" }}>BANK</div>
          <div style={{ color: "#c9a84c", fontSize: "16px", fontWeight: "700" }}>${Number(money || 0).toLocaleString()}</div>
        </div>
        <div style={{ width: "1px", background: "rgba(201,168,76,0.2)" }} />
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ color: "#6b5a3a", fontSize: "9px", letterSpacing: "0.1em" }}>BEST</div>
          <div style={{ color: "#8a7040", fontSize: "16px" }}>{bestScore}</div>
        </div>
      </div>

      <div
        style={{
          position: "relative",
          width: "min(420px, 100%)",
          borderRadius: "10px",
          overflow: "hidden",
          border: "2px solid rgba(201,168,76,0.3)",
          boxShadow: "0 0 40px rgba(201,168,76,0.1), inset 0 0 60px rgba(0,0,0,0.8)",
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
            <pattern id="brickPattern" x="0" y="0" width="30" height="20" patternUnits="userSpaceOnUse">
              <rect width="30" height="20" fill="none" />
              <rect x="0" y="0" width="28" height="9" rx="0" fill="rgba(60,30,10,0.6)" />
              <rect x="15" y="10" width="28" height="9" rx="0" fill="rgba(60,30,10,0.6)" />
              <line x1="0" y1="10" x2="30" y2="10" stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
            </pattern>
            <pattern id="bgStripes" x={bgOffset} y="0" width="60" height="60" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="60" y2="60" stroke="rgba(201,168,76,0.03)" strokeWidth="1" />
            </pattern>
            <radialGradient id="skyGrad" cx="50%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#1a1206" />
              <stop offset="100%" stopColor="#080503" />
            </radialGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect width={VIEW_W} height={VIEW_H} fill="url(#skyGrad)" />
          <rect width={VIEW_W} height={VIEW_H} fill="url(#bgStripes)" />

          <circle cx={VIEW_W - 60} cy={70} r={35} fill="#1e1508" />
          <circle cx={VIEW_W - 55} cy={65} r={33} fill="#c9a84c" opacity="0.12" />
          <circle cx={VIEW_W - 55} cy={65} r={28} fill="#c9a84c" opacity="0.07" />

          {[0, 40, 80, 120, 160, 200, 240, 280, 320, 360].map((bx, i) => (
            <rect
              key={i}
              x={bx}
              y={VIEW_H - 80 - (i % 3) * 40 - (i % 5) * 20}
              width={35}
              height={80 + (i % 3) * 40 + (i % 5) * 20}
              fill="rgba(10,7,3,0.9)"
            />
          ))}

          <rect x={0} y={VIEW_H - 30} width={VIEW_W} height={30} fill="#1a1008" />
          <rect x={0} y={VIEW_H - 30} width={VIEW_W} height={4} fill="#c9a84c" opacity="0.2" />

          {pipes.map((p, i) => (
            <Pipe key={i} x={p.x} topHeight={p.topHeight} gap={PIPE_GAP} />
          ))}

          {particles.map((pt) => (
            <circle key={pt.id} cx={pt.x + pt.vx * 5} cy={pt.y + pt.vy * 5} r={3} fill={pt.color} opacity={pt.life * 0.8} />
          ))}

          {gameState !== "idle" && <FedoraHat x={70 - BIRD_SIZE / 2} y={birdY - BIRD_SIZE / 2} rotation={birdRot} />}

          {gameState === "playing" && (
            <g filter={flashGold ? "url(#glow)" : ""}>
              <text x={VIEW_W / 2} y={55} textAnchor="middle" fill={flashGold ? "#ffe066" : "#c9a84c"} fontSize="42" fontFamily="Cinzel, serif" fontWeight="700" opacity="0.9">
                {score}
              </text>
              {reward.label !== "Nobody" && (
                <text x={VIEW_W / 2} y={78} textAnchor="middle" fill="#6b5a3a" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="2">
                  {reward.label.toUpperCase()}
                </text>
              )}
            </g>
          )}

          {gameState === "idle" && (
            <g>
              <rect width={VIEW_W} height={VIEW_H} fill="rgba(0,0,0,0.55)" />
              <FedoraHat x={70 - BIRD_SIZE / 2} y={VIEW_H / 2 - BIRD_SIZE / 2} rotation={0} />

              <text x={VIEW_W / 2} y={VIEW_H / 2 - 80} textAnchor="middle" fill="#c9a84c" fontSize="32" fontFamily="Cinzel, serif" fontWeight="700" letterSpacing="3">
                THE GAUNTLET
              </text>
              <text x={VIEW_W / 2} y={VIEW_H / 2 - 50} textAnchor="middle" fill="#6b5a3a" fontSize="12" fontFamily="Cinzel, serif" letterSpacing="2">
                NAVIGATE THE CORRIDORS OF POWER
              </text>

              {REWARD_TIERS.slice(0, 4).map((t, i) => (
                <g key={i}>
                  <text x={VIEW_W / 2 - 60} y={VIEW_H / 2 + 20 + i * 22} textAnchor="middle" fill="#8a7040" fontSize="11" fontFamily="Cinzel, serif">
                    {t.label} ({t.score}+)
                  </text>
                  <text x={VIEW_W / 2 + 70} y={VIEW_H / 2 + 20 + i * 22} textAnchor="middle" fill="#c9a84c" fontSize="11" fontFamily="Cinzel, serif">
                    +${t.cash.toLocaleString()}
                  </text>
                </g>
              ))}

              <text x={VIEW_W / 2} y={VIEW_H / 2 + 130} textAnchor="middle" fill="#c9a84c" fontSize="13" fontFamily="Cinzel, serif" letterSpacing="3" opacity={0.85}>
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
              <text x={VIEW_W / 2} y={VIEW_H / 2 - 95} textAnchor="middle" fill="#6b5a3a" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="1">
                THE FAMILY SENDS ITS REGARDS
              </text>

              <text x={VIEW_W / 2} y={VIEW_H / 2 - 50} textAnchor="middle" fill="#c9a84c" fontSize="60" fontFamily="Cinzel, serif" fontWeight="700">
                {score}
              </text>
              <text x={VIEW_W / 2} y={VIEW_H / 2 - 20} textAnchor="middle" fill="#6b5a3a" fontSize="11" fontFamily="Cinzel, serif" letterSpacing="2">
                GATES CLEARED
              </text>

              <rect x={VIEW_W / 2 - 110} y={VIEW_H / 2} width={220} height={68} rx="6" fill="rgba(201,168,76,0.08)" stroke="rgba(201,168,76,0.25)" strokeWidth="1" />

              <text x={VIEW_W / 2} y={VIEW_H / 2 + 22} textAnchor="middle" fill="#c9a84c" fontSize="13" fontFamily="Cinzel, serif" letterSpacing="2">
                {reward.label !== "Nobody" ? reward.label.toUpperCase() : "NOBODY"}
              </text>

              <text x={VIEW_W / 2} y={VIEW_H / 2 + 50} textAnchor="middle" fill={claimStatus.state === "error" ? "#f87171" : claimStatus.cash > 0 ? "#ffe066" : "#6b5a3a"} fontSize="15" fontFamily="Cinzel, serif" fontWeight="700">
                {claimStatus.state === "claiming" ? "CLAIMING..." : (claimStatus.message || (reward.cash > 0 ? `+${reward.cash.toLocaleString()} EARNED` : "Score 1+ to earn cash"))}
              </text>

              {nextTier && (
                <text x={VIEW_W / 2} y={VIEW_H / 2 + 88} textAnchor="middle" fill="#4a3a20" fontSize="10" fontFamily="Cinzel, serif" letterSpacing="1">
                  REACH {nextTier.score} FOR {nextTier.label.toUpperCase()} (+${nextTier.cash.toLocaleString()})
                </text>
              )}

              <text x={VIEW_W / 2} y={VIEW_H / 2 + 124} textAnchor="middle" fill="#c9a84c" fontSize="12" fontFamily="Cinzel, serif" letterSpacing="3" opacity="0.85">
                TAP TO TRY AGAIN
              </text>
            </g>
          )}
        </svg>
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
                padding: "4px 10px",
                border: `1px solid ${current ? "#c9a84c" : active ? "rgba(201,168,76,0.4)" : "rgba(201,168,76,0.1)"}`,
                borderRadius: "6px",
                background: current ? "rgba(201,168,76,0.15)" : "transparent",
                textAlign: "center",
                transition: "all 0.3s",
                minWidth: 92,
              }}
            >
              <div style={{ color: current ? "#c9a84c" : "#4a3a20", fontSize: "9px", letterSpacing: "0.1em" }}>{t.label.toUpperCase()}</div>
              <div style={{ color: current ? "#ffe066" : "#4a3a20", fontSize: "11px", fontWeight: "700" }}>${t.cash.toLocaleString()}</div>
              <div style={{ color: "#2a1a0a", fontSize: "8px" }}>{t.score}+ gates</div>
            </div>
          );
        })}
      </div>

      <p style={{ color: "#4a3a20", fontSize: "10px", marginTop: "10px", letterSpacing: "0.1em" }}>
        {isTouch ? "TAP TO FLY" : "SPACE / TAP TO FLY"}
      </p>
    </div>
  );
}

