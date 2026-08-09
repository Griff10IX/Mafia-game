import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import api from "../../utils/api";
import useMinigamePlaysLeft from "../../hooks/useMinigamePlaysLeft";
import { useMinigameCaptcha } from "../../hooks/useMinigameCaptcha";
import styles from "../../styles/noir.module.css";
import {
  W,
  H,
  LANE_COUNT,
  TILE_H,
  HORIZON_Y,
  PLAYER_Y,
  SPEED_PRESETS,
  loadSpeedPresetId,
  saveSpeedPresetId,
  createGameState,
  resetWorldEntities,
  roadT,
  roadWidthAtY,
  laneScreenX,
  perspScale,
  mphDisplay,
  updateWorld,
  updatePlayer,
  tickPlaying,
  checkCollisions,
  addParticles,
  getPreset,
  saveHighScore,
  freezeRunSpeed,
} from "./theGetawayEngine";

const FIXED_DT = 1 / 60;

/** Mulberry32 — must match backend/utils/getaway_sim.py */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToU32(seed) {
  const s = String(seed || "").trim().toLowerCase();
  if (!s) return 1;
  const hex = parseInt(s.slice(0, 8), 16);
  if (Number.isFinite(hex) && hex > 0) return hex >>> 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

const RULES = [
  "Temple Run-style: three lanes, swipe or arrow keys to dodge",
  "Swipe up / ↑ to jump wooden barricades",
  "Swipe down / ↓ to slide under police tape",
  "Dodge FBI units — jump and slide won't work on them",
  "Collect cash lines for bonus score",
  "Choose game speed before you start (saved on this device)",
  "Distance + coins = payout · max 10 runs per 2 hours",
];

function lightHaptic(ms = 12) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch (_) {
    /* ignore */
  }
}

export default function TheGetaway() {
  const { getCaptchaToken, captchaModal } = useMinigameCaptcha();
  const { playsLeft, maxPlays, canPlay, updateFromStart, refresh: refreshPlays, applyPlaysLeftPayload } =
    useMinigamePlaysLeft("the_getaway");

  const [speedPresetId, setSpeedPresetId] = useState(loadSpeedPresetId);
  const canvasRef = useRef(null);
  const stateRef = useRef(createGameState(speedPresetId));
  const animRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const getawaySessionRef = useRef(null);
  const inputsRef = useRef([]);
  const accumRef = useRef(0);
  const lastTsRef = useRef(0);

  const [gameState, setGameState] = useState("title");
  const [displayScore, setDisplayScore] = useState(0);
  const [displayCoins, setDisplayCoins] = useState(0);
  const [displayLives, setDisplayLives] = useState(3);
  const [displayMph, setDisplayMph] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const setSpeedPreset = useCallback((id) => {
    if (!SPEED_PRESETS[id]) return;
    setSpeedPresetId(id);
    saveSpeedPresetId(id);
    const s = stateRef.current;
    s.speedPresetId = id;
    const preset = SPEED_PRESETS[id];
    if (s.state === "title" || s.state === "gameover") {
      s.speed = preset.base;
      s.displayMphFrozen = mphDisplay(preset.base);
      setDisplayMph(s.displayMphFrozen);
    }
  }, []);

  const resetGame = useCallback((seed = null) => {
    const s = stateRef.current;
    s.speedPresetId = speedPresetId;
    resetWorldEntities(s);
    s.rng = seed ? mulberry32(seedToU32(seed)) : null;
    s.seed = seed || null;
    inputsRef.current = [];
    accumRef.current = 0;
    setDisplayScore(0);
    setDisplayCoins(0);
    setDisplayLives(3);
    s.displayMphFrozen = mphDisplay(s.speed);
    setDisplayMph(s.displayMphFrozen);
    setSubmitted(false);
  }, [speedPresetId]);

  const submitRun = useCallback(async () => {
    const s = stateRef.current;
    if (submitted || s.score < 50) return;
    const sid = getawaySessionRef.current;
    if (!sid) {
      toast.error("No active run. Start again from the title screen.");
      return;
    }
    setSubmitted(true);
    const timeSeconds = Math.floor((Date.now() - (s.gameStartTime || Date.now())) / 1000);
    try {
      const res = await api.post("/the-getaway/run", {
        distance: Math.floor(s.score),
        coins_collected: s.coins,
        time_seconds: timeSeconds,
        session_id: sid,
        inputs: Array.isArray(inputsRef.current) ? inputsRef.current.slice() : [],
        ticks: s.frame || 0,
        speed_preset: s.speedPresetId,
      });
      getawaySessionRef.current = null;
      if (res.data?.ok) {
        const dist = Math.floor(Number(res.data?.distance ?? s.score) || 0);
        const coins = Math.floor(Number(res.data?.coins_collected ?? s.coins) || 0);
        s.score = dist;
        s.coins = coins;
        setDisplayScore(dist);
        setDisplayCoins(coins);
        const estCash = 3750 + Math.floor(dist / 100) * 500 + coins * 25;
        const estResp = 15 + Math.floor(dist / 100) * 2;
        toast.success(`Clean getaway! +$${estCash.toLocaleString()} +${estResp} respect`);
      }
      if (res.data?.plays_left != null) applyPlaysLeftPayload(res.data);
      else refreshPlays();
    } catch (err) {
      setSubmitted(false);
      getawaySessionRef.current = null;
      toast.error(err?.response?.data?.detail || "Failed to submit run");
      refreshPlays();
    }
  }, [submitted, refreshPlays, applyPlaysLeftPayload]);

  const pushInput = useCallback((action) => {
    const s = stateRef.current;
    if (s.state !== "playing") return;
    inputsRef.current.push({ f: s.frame, a: action });
  }, []);

  const jump = useCallback(() => {
    const p = stateRef.current.player;
    if (!p.jumping && !p.sliding) {
      lightHaptic(8);
      p.jumping = true;
      p.vy = -13;
      pushInput("J");
    }
  }, [pushInput]);

  const slide = useCallback(() => {
    const p = stateRef.current.player;
    if (!p.jumping) {
      lightHaptic(8);
      p.sliding = true;
      p.slideTimer = 42;
      pushInput("S");
    }
  }, [pushInput]);

  const moveLeft = useCallback(() => {
    const p = stateRef.current.player;
    if (p.targetLane > 0) {
      lightHaptic(6);
      p.targetLane--;
      p.laneT = 0;
      pushInput("L");
    }
  }, [pushInput]);

  const moveRight = useCallback(() => {
    const p = stateRef.current.player;
    if (p.targetLane < 2) {
      lightHaptic(6);
      p.targetLane++;
      p.laneT = 0;
      pushInput("R");
    }
  }, [pushInput]);

  const handleStart = useCallback(async () => {
    if (!canPlay) {
      toast.error("Play limit reached for this 2-hour window.");
      return;
    }
    const s = stateRef.current;
    if (s.state === "title" || s.state === "gameover") {
      if (s.state === "gameover") await submitRun();
      let captchaToken = null;
      try {
        captchaToken = await getCaptchaToken();
      } catch (c) {
        if (c?.message === "captcha_cancelled") return;
        throw c;
      }
      try {
        const resp = await api.post("/the-getaway/start", {
          speed_preset: speedPresetId,
          ...(captchaToken ? { captcha_token: captchaToken } : {}),
        });
        const sid = resp.data?.session_id;
        const seed = resp.data?.seed;
        const lockedPreset = resp.data?.speed_preset || speedPresetId;
        if (!sid || !seed) {
          toast.error("Could not start run. Try again.");
          return;
        }
        getawaySessionRef.current = sid;
        if (SPEED_PRESETS[lockedPreset]) {
          s.speedPresetId = lockedPreset;
          setSpeedPresetId(lockedPreset);
        }
        updateFromStart(resp.data);
        resetGame(seed);
        s.state = "playing";
        setGameState("playing");
      } catch (err) {
        toast.error(err?.response?.data?.detail || err?.message || "Could not start run");
      }
    }
  }, [resetGame, submitRun, canPlay, updateFromStart, getCaptchaToken, speedPresetId]);

  const drawSky = useCallback((ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    grad.addColorStop(0, "#060612");
    grad.addColorStop(0.35, "#141430");
    grad.addColorStop(0.65, "#252550");
    grad.addColorStop(1, "#3a2848");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H * 0.72);

    ctx.fillStyle = "rgba(255,240,180,0.85)";
    ctx.beginPath();
    ctx.arc(W * 0.78, 58, 18, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 24; i++) {
      const sx = (i * 137.5 + 40) % W;
      const sy = (i * 83.2 + 12) % (H * 0.35);
      ctx.fillStyle = `rgba(255,255,255,${0.25 + (i % 3) * 0.15})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.4 + (i % 2) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    stateRef.current.clouds.forEach((c) => {
      ctx.fillStyle = "rgba(30,30,50,0.35)";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.w, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  const drawBuilding = useCallback((ctx, b) => {
    const t = roadT(b.y);
    const roadW = roadWidthAtY(b.y);
    const sideSign = b.side === "left" ? -1 : 1;
    const bw = b.w * (0.5 + t * 0.9);
    const bh = b.h * (0.4 + t * 1);
    const x = W / 2 + sideSign * (roadW / 2 + 14 + bw / 2 + t * 28);
    const y = b.y;

    ctx.fillStyle = "#12121c";
    ctx.fillRect(x - bw / 2, y - bh, bw, bh);
    ctx.strokeStyle = b.neonColor;
    ctx.lineWidth = 1 + t * 0.8;
    ctx.strokeRect(x - bw / 2, y - bh, bw, bh);

    const ww = Math.max(3, 7 * (0.5 + t));
    const wh = Math.max(4, 10 * (0.5 + t));
    const cols = Math.max(1, Math.floor(bw / (ww * 2.2)));
    const rows = Math.max(1, Math.floor(bh / (wh * 1.6)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = ((r * 5 + c * 9 + Math.floor(stateRef.current.frame / 24)) % 4) !== 0;
        ctx.fillStyle = lit ? "rgba(255,210,120,0.65)" : "rgba(18,18,32,0.85)";
        ctx.fillRect(x - bw / 2 + 4 + c * ww * 2.2, y - bh + 6 + r * wh * 1.6, ww, wh);
      }
    }
  }, []);

  const drawPath = useCallback((ctx) => {
    const s = stateRef.current;
    const glow = ctx.createRadialGradient(W / 2, HORIZON_Y, 10, W / 2, HORIZON_Y, W * 0.5);
    glow.addColorStop(0, "rgba(255,200,100,0.12)");
    glow.addColorStop(1, "rgba(255,200,100,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, HORIZON_Y - 80, W, 200);

    s.pathTiles.forEach((tile) => {
      const top = tile.y;
      const bot = tile.y + TILE_H;
      const cx = W / 2;
      const tW = roadWidthAtY(top);
      const bW = roadWidthAtY(bot);
      const depth = roadT(bot);

      const base = tile.stripe === 0 ? "#252535" : "#2a2a3e";
      const base2 = tile.stripe === 0 ? "#303048" : "#353552";
      const roadGrad = ctx.createLinearGradient(0, top, 0, bot);
      roadGrad.addColorStop(0, base);
      roadGrad.addColorStop(1, base2);
      ctx.fillStyle = roadGrad;
      ctx.beginPath();
      ctx.moveTo(cx - tW / 2, top);
      ctx.lineTo(cx + tW / 2, top);
      ctx.lineTo(cx + bW / 2, bot);
      ctx.lineTo(cx - bW / 2, bot);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = `rgba(255,225,140,${0.1 + depth * 0.14})`;
      ctx.lineWidth = 1 + depth * 1.8;
      for (let li = 0; li < LANE_COUNT - 1; li++) {
        const ratio = (li + 1) / LANE_COUNT;
        ctx.setLineDash([5 + depth * 14, 8 + depth * 12]);
        ctx.beginPath();
        ctx.moveTo(cx - tW / 2 + tW * ratio, top);
        ctx.lineTo(cx - bW / 2 + bW * ratio, bot);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.strokeStyle = `rgba(200,60,60,${0.2 + depth * 0.15})`;
      ctx.lineWidth = 2 + depth * 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - tW / 2, top);
      ctx.lineTo(cx - bW / 2, bot);
      ctx.moveTo(cx + tW / 2, top);
      ctx.lineTo(cx + bW / 2, bot);
      ctx.stroke();
    });

    s.streaks.forEach((st) => {
      const t = roadT(st.y);
      const roadW = roadWidthAtY(st.y);
      const x = W / 2 + st.side * (roadW / 2 + 8 + t * 22);
      ctx.strokeStyle = `rgba(255,255,255,${st.alpha * t * 0.9})`;
      ctx.lineWidth = 1 + t * 2;
      ctx.beginPath();
      ctx.moveTo(x, st.y - st.len * t * 0.5);
      ctx.lineTo(x + st.side * 12 * t, st.y);
      ctx.stroke();
    });
  }, []);

  const drawObstacle = useCallback((ctx, o) => {
    const scale = perspScale(o.y);
    const cx = laneScreenX(o.lane, o.y);
    const shadowW = (o.w || 48) * scale * 0.8;

    ctx.save();
    ctx.globalAlpha = Math.max(0.25, scale);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, o.y + 3 * scale, shadowW * 0.5, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (o.type === "barrier") {
      ctx.save();
      ctx.translate(cx, o.y);
      ctx.scale(scale * 0.92, scale * 0.92);
      ctx.fillStyle = "#2a1810";
      ctx.strokeStyle = "#e8a020";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-26, -16, 52, 32, 4);
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#e8a020" : "#1a1410";
        ctx.fillRect(-25 + i * 10, -12, 9, 22);
      }
      ctx.fillStyle = "#fff";
      ctx.font = "bold 7px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("JUMP", 0, -22);
      ctx.restore();
    } else if (o.type === "lowbar") {
      ctx.save();
      ctx.translate(cx, o.y);
      ctx.scale(scale * 0.82, scale * 0.82);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#f0e040" : "#111";
        ctx.fillRect(-24 + i * 9.6, -7, 9.6, 7);
      }
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2;
      ctx.strokeRect(-24, -7, 48, 7);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 6px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SLIDE", 0, -1);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(cx, o.y);
      ctx.scale(scale, scale);
      const flash = Math.sin(stateRef.current.frame * 0.28) > 0 ? "#ff2844" : "#2266ff";
      ctx.fillStyle = "#152040";
      ctx.strokeStyle = flash;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-20, -44, 40, 46, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = flash;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(0, -44, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#e8eefc";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("FBI", 0, -20);
      ctx.restore();
    }
  }, []);

  const drawCoin = useCallback((ctx, c) => {
    if (c.collected) return;
    const scale = perspScale(c.y);
    const cx = laneScreenX(c.lane, c.y);
    const pulse = 0.88 + 0.12 * Math.sin(stateRef.current.frame * 0.14 + (c.spin || 0));
    c.spin = (c.spin || 0) + 0.08;

    ctx.save();
    ctx.translate(cx, c.y);
    ctx.scale(scale * pulse, scale * pulse);
    ctx.fillStyle = "#1a4a28";
    ctx.strokeStyle = "#5cda6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#b8ffb8";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", 0, 1);
    ctx.restore();
  }, []);

  const drawPlayer = useCallback((ctx) => {
    const s = stateRef.current;
    const p = s.player;
    if (p.invincible > 0 && Math.floor(s.frame / 5) % 2 === 0) return;

    const jumpH = p.jumping ? Math.max(0, -p.vy * 5.5) : 0;
    const pY = PLAYER_Y - jumpH;
    const sh = p.sliding ? p.h * 0.52 : p.h;
    const sy = p.sliding ? p.h * 0.48 : 0;
    const bob = p.jumping ? 0 : Math.sin(p.runFrame * (Math.PI / 2)) * 2.5;

    ctx.save();
    ctx.translate(p.x, pY + bob);

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 8, 18, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!p.sliding) {
      const leg = Math.sin(p.runFrame * (Math.PI / 2)) * 7;
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.roundRect(-7, 20, 12, 24, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-7 + leg, 20, 11, 24, 3);
      ctx.fill();
      const arm = Math.sin(p.runFrame * (Math.PI / 2)) * 12;
      ctx.fillStyle = "#c9a070";
      ctx.beginPath();
      ctx.roundRect(-16, 0 + arm, 10, 20, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(6, 0 - arm, 10, 20, 3);
      ctx.fill();
    }

    ctx.fillStyle = "#242424";
    if (p.sliding) {
      ctx.beginPath();
      ctx.roundRect(-15, 4, 30, 32, 6);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(-13, -sh + sy, 26, sh - sy, 5);
      ctx.fill();
      ctx.fillStyle = "#b81e38";
      ctx.fillRect(-9, -sh + sy + 18, 18, 7);
      ctx.fillStyle = "#c9a070";
      ctx.beginPath();
      ctx.arc(0, -sh + sy + 8, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(-14, -sh + sy, 28, 7);
    }
    ctx.restore();
  }, []);

  const drawParticles = useCallback((ctx) => {
    stateRef.current.particles.forEach((p) => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, []);

  const drawHUD = useCallback((ctx) => {
    const s = stateRef.current;
    const preset = getPreset(s);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(8, 8, 178, 36, 8);
    ctx.fill();
    ctx.fillStyle = "#5ce0ff";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`🏃 ${Math.floor(s.score)} m  💵 ${s.coins}`, 14, 30);

    ctx.beginPath();
    ctx.roundRect(W - 150, 8, 142, 36, 8);
    ctx.fill();
    ctx.fillStyle = "#ff5566";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${mphDisplay(s.speed)} mph · ${preset.label}`, W - 14, 30);
  }, []);

  const drawOverlay = useCallback((ctx, title, sublines, cta) => {
    const s = stateRef.current;
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#c41e3a";
    ctx.font = "bold 38px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(title, W / 2, H / 2 - 72);
    ctx.fillStyle = "#aaa";
    ctx.font = "14px sans-serif";
    sublines.forEach((line, i) => ctx.fillText(line, W / 2, H / 2 - 30 + i * 22));
    if (s.highScore > 0) {
      ctx.fillStyle = "rgba(90,220,120,0.7)";
      ctx.fillText(`Best: ${Math.floor(s.highScore)} m`, W / 2, H / 2 + 40);
    }
    ctx.fillStyle = "#5ce080";
    ctx.font = "bold 16px sans-serif";
    const pulse = 0.75 + 0.25 * Math.sin(s.frame * 0.09);
    ctx.globalAlpha = pulse;
    ctx.fillText(cta, W / 2, H / 2 + 88);
    ctx.globalAlpha = 1;
  }, []);

  const onLifeLost = useCallback((ox, oy, type) => {
    const s = stateRef.current;
    addParticles(s, ox, oy, type === "barrier" ? "#4488ff" : "#ffdd44");
    s.lives--;
    s.shake = 16;
    lightHaptic(35);
    s.player.invincible = 85;
    setDisplayLives(s.lives);
    if (s.lives <= 0) {
      freezeRunSpeed(s);
      s.state = "gameover";
      setGameState("gameover");
      setDisplayMph(s.displayMphFrozen ?? mphDisplay(s.speed));
      if (s.score > s.highScore) {
        s.highScore = s.score;
        saveHighScore(s.highScore);
      }
    }
  }, []);

  const onCoin = useCallback((cx, cy) => {
    const s = stateRef.current;
    s.coins++;
    s.score += 45;
    addParticles(s, cx, cy, "#5ce080", 5);
    setDisplayCoins(s.coins);
    setDisplayScore(Math.floor(s.score));
  }, []);

  const gameLoop = useCallback((now) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = stateRef.current;

    if (!lastTsRef.current) lastTsRef.current = now || performance.now();
    let dt = ((now || performance.now()) - lastTsRef.current) / 1000;
    lastTsRef.current = now || performance.now();
    if (dt > 0.05) dt = 0.05;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (s.shake > 0) {
      const amt = Math.min(7, s.shake * 0.4);
      ctx.translate((Math.random() - 0.5) * amt, (Math.random() - 0.5) * amt);
      s.shake--;
    }

    drawSky(ctx);
    s.buildings.forEach((b) => drawBuilding(ctx, b));

    if (s.state === "playing") {
      accumRef.current += dt;
      let steps = 0;
      while (accumRef.current >= FIXED_DT && steps < 5) {
        tickPlaying(s);
        checkCollisions(s, onLifeLost, onCoin);
        accumRef.current -= FIXED_DT;
        steps++;
        if (s.state !== "playing") break;
      }
      setDisplayScore(Math.floor(s.score));
      const mph = mphDisplay(s.speed);
      if (mph !== s._lastHudMph) {
        s._lastHudMph = mph;
        setDisplayMph(mph);
      }
    }

    drawPath(ctx);

    if (s.state === "title") {
      drawOverlay(ctx, "THE GETAWAY", [
        "Swipe-run chase · Temple Run style",
        "← → lanes · ↑ jump · ↓ slide",
        `Speed: ${getPreset(s).label}`,
      ], "TAP TO START");
      s.frame++;
      ctx.restore();
      animRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    if (s.state === "gameover") {
      if (s.displayMphFrozen == null) freezeRunSpeed(s);
      drawOverlay(ctx, "BUSTED!", [
        `${Math.floor(s.score)} m · $${(s.coins * 25).toLocaleString()} cash`,
        `Top speed: ${s.displayMphFrozen ?? mphDisplay(s.speed)} mph · ${getPreset(s).label}`,
      ], "TAP TO PLAY AGAIN");
      s.frame++;
      ctx.restore();
      animRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    s.coinItems.forEach((c) => drawCoin(ctx, c));
    s.obstacles.forEach((o) => drawObstacle(ctx, o));
    drawPlayer(ctx);
    drawParticles(ctx);
    drawHUD(ctx);

    ctx.restore();
    animRef.current = requestAnimationFrame(gameLoop);
  }, [
    drawSky,
    drawBuilding,
    drawPath,
    drawObstacle,
    drawCoin,
    drawPlayer,
    drawParticles,
    drawHUD,
    drawOverlay,
    onLifeLost,
    onCoin,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    stateRef.current = createGameState(speedPresetId);
    resetWorldEntities(stateRef.current);
    animRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [gameLoop, speedPresetId]);

  useEffect(() => {
    const onKey = (e) => {
      const s = stateRef.current;
      if (s.state !== "playing") {
        void handleStart();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "a") {
        e.preventDefault();
        moveLeft();
      }
      if (e.key === "ArrowRight" || e.key === "d") {
        e.preventDefault();
        moveRight();
      }
      if (e.key === "ArrowUp" || e.key === "w" || e.key === " ") {
        e.preventDefault();
        jump();
      }
      if (e.key === "ArrowDown" || e.key === "s") {
        e.preventDefault();
        slide();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleStart, moveLeft, moveRight, jump, slide]);

  const handleTouchEnd = useCallback(
    (e) => {
      e.preventDefault();
      const s = stateRef.current;
      if (s.state !== "playing") {
        void handleStart();
        return;
      }
      const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
      const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
      const th = 20;
      if (Math.abs(dx) < th && Math.abs(dy) < th) {
        jump();
        return;
      }
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < -th) moveLeft();
        else if (dx > th) moveRight();
      } else {
        if (dy < -th) jump();
        else if (dy > th) slide();
      }
    },
    [handleStart, moveLeft, moveRight, jump, slide]
  );

  const preset = SPEED_PRESETS[speedPresetId] || SPEED_PRESETS.normal;
  const canChangeSpeed = gameState === "title" || gameState === "gameover";

  return (
    <div className={`${styles.pageContent} mobile-page-root space-y-2 sm:space-y-4`}>
      {captchaModal}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-base sm:text-lg font-heading font-bold text-primary uppercase tracking-wider">The Getaway</h1>
          <p className="text-[9px] sm:text-[10px] text-mutedForeground">Temple Run-style lane chase — pick your speed</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {playsLeft != null && (
            <span className={`text-[9px] sm:text-[10px] font-heading ${canPlay ? "text-mutedForeground" : "text-red-500 font-bold"}`}>
              {playsLeft}/{maxPlays} plays
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowRules(!showRules)}
            className="px-2.5 sm:px-3 py-1 rounded border border-primary/30 text-primary text-[10px] sm:text-xs font-heading hover:bg-primary/10"
          >
            {showRules ? "Hide Rules" : "Show Rules"}
          </button>
        </div>
      </div>

      <div className={`${styles.panel} mobile-panel rounded-lg p-3 space-y-2`}>
        <div className="text-[10px] font-heading text-primary uppercase tracking-wider">Game speed</div>
        <p className="text-[10px] text-mutedForeground">
          {canChangeSpeed ? preset.desc : "Finish or wait for game over to change speed."}
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.values(SPEED_PRESETS).map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!canChangeSpeed}
              onClick={() => setSpeedPreset(p.id)}
              className={`px-3 py-1.5 rounded text-[10px] sm:text-xs font-heading border transition-colors ${
                speedPresetId === p.id
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-zinc-600/60 text-mutedForeground hover:border-primary/40"
              } ${!canChangeSpeed ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {showRules && (
        <div className={`${styles.panel} mobile-panel rounded-lg p-3 space-y-2`}>
          <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-wider">How to Play</h3>
          <ul className="text-[11px] text-foreground space-y-1">
            {RULES.map((rule, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-primary">•</span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`${styles.panel} mobile-panel rounded-lg p-1.5 sm:p-2`}>
        <div className="flex justify-between items-center gap-2 px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-heading text-foreground">
          <span>
            Score: <span className="text-primary">{displayScore}</span>
          </span>
          <span>
            Cash: <span className="text-emerald-400">${(displayCoins * 25).toLocaleString()}</span>
          </span>
          <span>
            {displayMph} mph · {preset.label}
          </span>
          <span>Lives: {"❤️".repeat(displayLives)}{"🖤".repeat(3 - displayLives)}</span>
        </div>
      </div>

      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          onClick={() => void handleStart()}
          onTouchStart={(e) => {
            e.preventDefault();
            touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }}
          onTouchMove={(e) => e.preventDefault()}
          onTouchEnd={handleTouchEnd}
          className="rounded-lg cursor-pointer touch-none select-none border border-primary/20 shadow-2xl shadow-black/40 bg-black"
          style={{
            maxWidth: "100%",
            width: "min(100%, 480px, calc((100dvh - 260px) * 0.75))",
            minWidth: "min(100%, 300px)",
            height: "auto",
            aspectRatio: `${W}/${H}`,
            touchAction: "none",
            userSelect: "none",
          }}
        />
      </div>

      <div className={`${styles.panel} mobile-panel rounded-lg p-2 grid grid-cols-4 gap-2`}>
        {[
          { label: "← Left", fn: moveLeft },
          { label: "↑ Jump", fn: jump },
          { label: "↓ Slide", fn: slide },
          { label: "Right →", fn: moveRight },
        ].map(({ label, fn }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (gameState === "playing") fn();
              else void handleStart();
            }}
            className="px-2 py-3 rounded border border-primary/30 text-primary text-[11px] font-heading font-bold hover:bg-primary/10 touch-manipulation min-h-[48px] active:scale-95 transition-transform"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
