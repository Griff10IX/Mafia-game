import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import api from "../../utils/api";
import { startMinigameRun } from "../../utils/minigameRunSession";
import useMinigamePlaysLeft from "../../hooks/useMinigamePlaysLeft";
import { useMinigameCaptcha } from "../../hooks/useMinigameCaptcha";
import styles from "../../styles/noir.module.css";

const W = 480, H = 640;
const LANES = [-120, 0, 120];
const LANE_COUNT = 3;
const TILE_H = 80;
const HORIZON_Y = H * 0.24;
const ROAD_TOP_W = W * 0.22;
const ROAD_BOTTOM_W = W * 0.86;

const RULES = [
  "Swipe left/right or use arrow keys to snap between three lanes",
  "Swipe up / press UP to vault wooden barricades",
  "Swipe down / press DOWN to slide under police tape",
  "Dodge FBI agents and police cars — they cannot be jumped through",
  "Follow cash trails for bonus money",
  "Distance + coins = your final score",
  "Max 10 runs per 2 hours",
];

function lightHaptic(ms = 12) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch (_) {
    /* ignore unsupported haptics */
  }
}

export default function TheGetaway() {
  const { getCaptchaToken, captchaModal } = useMinigameCaptcha();
  const { playsLeft, maxPlays, canPlay, updateFromStart, refresh: refreshPlays, applyPlaysLeftPayload } = useMinigamePlaysLeft("the_getaway");
  const canvasRef = useRef(null);
  const stateRef = useRef({
    state: 'title',
    score: 0,
    coins: 0,
    lives: 3,
    highScore: 0,
    frame: 0,
    speed: 6,
    player: {
      lane: 1,
      targetLane: 1,
      x: W / 2,
      y: H - 180,
      w: 36,
      h: 56,
      vy: 0,
      jumping: false,
      sliding: false,
      slideTimer: 0,
      invincible: 0,
      runFrame: 0,
      runTick: 0,
    },
    obstacles: [],
    coinItems: [],
    particles: [],
    pathTiles: [],
    buildings: [],
    clouds: [],
    streaks: [],
    shake: 0,
    gameStartTime: null,
  });
  const animRef = useRef(null);
  const [gameState, setGameState] = useState('title');
  const [displayScore, setDisplayScore] = useState(0);
  const [displayCoins, setDisplayCoins] = useState(0);
  const [displayLives, setDisplayLives] = useState(3);
  const [submitted, setSubmitted] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const getawaySessionRef = useRef(null);

  const perspScale = useCallback((y) => {
    const t = Math.max(0, Math.min(1, (y - HORIZON_Y) / (H - HORIZON_Y - 42)));
    return 0.18 + 0.92 * (t * t * 0.65 + t * 0.35);
  }, []);

  const roadT = useCallback((y) => Math.max(0, Math.min(1, (y - HORIZON_Y) / (H - HORIZON_Y))), []);
  const roadWidthAtY = useCallback((y) => {
    const t = roadT(y);
    return ROAD_TOP_W + (ROAD_BOTTOM_W - ROAD_TOP_W) * (t * t * 0.72 + t * 0.28);
  }, [roadT]);
  const laneScreenX = useCallback((lane, y) => {
    const w = roadWidthAtY(y);
    return W / 2 - w / 2 + ((lane + 0.5) / LANE_COUNT) * w;
  }, [roadWidthAtY]);

  const addParticle = useCallback((x, y, color) => {
    const s = stateRef.current;
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 4;
      s.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 3,
        life: 1,
        color,
        r: 3 + Math.random() * 4
      });
    }
  }, []);

  const spawnObstacle = useCallback(() => {
    const s = stateRef.current;
    const type = Math.random();
    const lane = Math.floor(Math.random() * 3);
    if (type < 0.28) {
      s.obstacles.push({ lane, y: HORIZON_Y - 70, w: 50, h: 54, type: 'cop', dead: false });
    } else if (type < 0.52) {
      s.obstacles.push({ lane, y: HORIZON_Y - 70, w: 54, h: 44, type: 'barrier', dead: false });
    } else if (type < 0.76) {
      s.obstacles.push({ lane, y: HORIZON_Y - 70, w: 66, h: 30, type: 'lowbar', dead: false });
    } else {
      const l2 = (lane + 1) % 3;
      s.obstacles.push({ lane, y: HORIZON_Y - 70, w: 50, h: 54, type: 'cop', dead: false });
      s.obstacles.push({ lane: l2, y: HORIZON_Y - 70, w: 54, h: 44, type: 'barrier', dead: false });
    }
  }, []);

  const spawnCoins = useCallback(() => {
    const s = stateRef.current;
    const lane = Math.floor(Math.random() * 3);
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      s.coinItems.push({ lane, y: HORIZON_Y - 50 - i * 46, r: 10, collected: false });
    }
  }, []);

  const resetGame = useCallback(() => {
    const s = stateRef.current;
    s.score = 0;
    s.coins = 0;
    s.lives = 3;
    s.frame = 0;
    s.speed = 6;
    s.player.lane = 1;
    s.player.targetLane = 1;
    s.player.x = W / 2;
    s.player.jumping = false;
    s.player.sliding = false;
    s.player.slideTimer = 0;
    s.player.invincible = 0;
    s.player.vy = 0;
    s.player.runFrame = 0;
    s.player.runTick = 0;
    s.obstacles = [];
    s.coinItems = [];
    s.particles = [];
    s.pathTiles = [];
    s.buildings = [];
    s.clouds = [];
    s.streaks = [];
    s.shake = 0;
    s.gameStartTime = Date.now();

    for (let i = 0; i < 12; i++) {
      s.pathTiles.push({ y: H - 120 + i * -TILE_H });
    }
    for (let i = 0; i < 8; i++) {
      s.buildings.push({
        side: Math.random() < 0.5 ? 'left' : 'right',
        y: HORIZON_Y + Math.random() * (H - HORIZON_Y),
        w: 40 + Math.random() * 60,
        h: 80 + Math.random() * 120,
        windows: Math.floor(Math.random() * 3) + 2,
        neonColor: ['#ff00ff', '#00ffff', '#ffff00', '#ff6600'][Math.floor(Math.random() * 4)],
      });
    }
    for (let i = 0; i < 18; i++) {
      s.streaks.push({
        side: Math.random() < 0.5 ? -1 : 1,
        y: HORIZON_Y + Math.random() * (H - HORIZON_Y),
        len: 18 + Math.random() * 38,
        alpha: 0.15 + Math.random() * 0.3,
      });
    }
    for (let i = 0; i < 5; i++) {
      s.clouds.push({ x: Math.random() * W, y: 40 + Math.random() * 80, w: 50 + Math.random() * 70 });
    }

    setDisplayScore(0);
    setDisplayCoins(0);
    setDisplayLives(3);
    setSubmitted(false);
  }, []);

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
      const res = await api.post('/the-getaway/run', {
        distance: Math.floor(s.score),
        coins_collected: s.coins,
        time_seconds: timeSeconds,
        session_id: sid,
      });
      getawaySessionRef.current = null;
      if (res.data?.ok) {
        const dist = Math.floor(stateRef.current?.score || 0);
        const coins = stateRef.current?.coins || 0;
        const estCash = 3750 + Math.floor(dist / 100) * 500 + coins * 25;
        const estResp = 15 + Math.floor(dist / 100) * 2;
        toast.success(`Clean getaway! +$${estCash.toLocaleString()} +${estResp} respect`);
      }
      if (res.data?.plays_left != null) applyPlaysLeftPayload(res.data);
      else refreshPlays();
    } catch (err) {
      setSubmitted(false);
      const msg = err?.response?.data?.detail || 'Failed to submit run';
      toast.error(msg);
      refreshPlays();
    }
  }, [submitted, refreshPlays, applyPlaysLeftPayload]);

  const jump = useCallback(() => {
    const p = stateRef.current.player;
    if (!p.jumping && !p.sliding) {
      lightHaptic(8);
      p.jumping = true;
      p.vy = -14;
    }
  }, []);

  const slide = useCallback(() => {
    const p = stateRef.current.player;
    if (!p.jumping) {
      lightHaptic(8);
      p.sliding = true;
      p.slideTimer = 45;
    }
  }, []);

  const moveLeft = useCallback(() => {
    const p = stateRef.current.player;
    if (p.targetLane > 0) {
      lightHaptic(6);
      p.targetLane--;
    }
  }, []);

  const moveRight = useCallback(() => {
    const p = stateRef.current.player;
    if (p.targetLane < 2) {
      lightHaptic(6);
      p.targetLane++;
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (!canPlay) { toast.error("Play limit reached for this 2-hour window."); return; }
    const s = stateRef.current;
    if (s.state === 'title' || s.state === 'gameover') {
      if (s.state === 'gameover') {
        await submitRun();
      }
      let captchaToken = null;
      try {
        captchaToken = await getCaptchaToken();
      } catch (c) {
        if (c?.message === 'captcha_cancelled') return;
        throw c;
      }
      try {
        const run = await startMinigameRun('the_getaway', undefined, captchaToken);
        getawaySessionRef.current = run.session_id;
        updateFromStart(run);
      } catch (err) {
        toast.error(err?.response?.data?.detail || err?.message || 'Could not start run');
        return;
      }
      resetGame();
      s.state = 'playing';
      setGameState('playing');
    }
  }, [resetGame, submitRun, canPlay, updateFromStart, getCaptchaToken]);

  const drawSky = useCallback((ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.65);
    grad.addColorStop(0, '#0a0a1a');
    grad.addColorStop(0.3, '#1a1a3e');
    grad.addColorStop(0.7, '#2a2a5e');
    grad.addColorStop(1, '#3a2a4e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H * 0.65);

    ctx.fillStyle = 'rgba(255,255,200,0.8)';
    ctx.beginPath();
    ctx.arc(W * 0.8, 70, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,150,0.2)';
    ctx.beginPath();
    ctx.arc(W * 0.8, 70, 35, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 30; i++) {
      const sx = (i * 137.5 + 50) % W;
      const sy = (i * 83.2 + 20) % (H * 0.4);
      const sr = 0.5 + (i % 3) * 0.4;
      ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 2) * 0.2})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    const s = stateRef.current;
    s.clouds.forEach(c => {
      ctx.fillStyle = 'rgba(40,40,60,0.4)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.w, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.x - c.w * 0.25, c.y - 5, c.w * 0.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      c.x += 0.15;
      if (c.x > W + c.w) c.x = -c.w;
    });
  }, []);

  const drawBuilding = useCallback((ctx, b) => {
    const s = stateRef.current;
    const t = roadT(b.y);
    const roadW = roadWidthAtY(b.y);
    const sideSign = b.side === 'left' ? -1 : 1;
    const bw = b.w * (0.45 + t * 0.95);
    const bh = b.h * (0.35 + t * 1.05);
    const x = W / 2 + sideSign * (roadW / 2 + 16 + bw / 2 + t * 34);
    const y = b.y;

    ctx.fillStyle = '#161623';
    ctx.fillRect(x - bw / 2, y - bh, bw, bh);
    
    ctx.strokeStyle = b.neonColor;
    ctx.lineWidth = 1 + t;
    ctx.strokeRect(x - bw / 2, y - bh, bw, bh);
    
    const windowW = Math.max(3, 8 * (0.55 + t));
    const windowH = Math.max(4, 12 * (0.55 + t));
    const cols = Math.max(1, Math.floor(bw / (windowW * 2)));
    const rows = Math.max(1, Math.floor(bh / (windowH * 1.7)));
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = x - bw / 2 + 5 + c * windowW * 2;
        const wy = y - bh + 8 + r * windowH * 1.7;
        const lit = ((r * 7 + c * 11 + Math.floor(s.frame / 20)) % 5) !== 0;
        ctx.fillStyle = lit ? 'rgba(255,220,100,0.7)' : 'rgba(20,20,40,0.8)';
        ctx.fillRect(wx, wy, windowW, windowH);
      }
    }
    
    ctx.fillStyle = b.neonColor;
    ctx.globalAlpha = 0.35 + Math.sin(s.frame * 0.1 + b.y * 0.02) * 0.18;
    ctx.fillRect(x - bw / 2 + 5, y - bh - 8 * (0.6 + t), bw - 10, 5 * (0.5 + t));
    ctx.globalAlpha = 1;

    b.y += Math.max(0.7, s.speed * (0.08 + t * 0.16));
    if (b.y - bh > H + 40) {
      b.y = HORIZON_Y + Math.random() * 60;
      b.side = Math.random() < 0.5 ? 'left' : 'right';
      b.w = 40 + Math.random() * 60;
      b.h = 80 + Math.random() * 120;
    }
  }, [roadT, roadWidthAtY]);

  const drawPath = useCallback((ctx) => {
    const s = stateRef.current;
    const skyGlow = ctx.createRadialGradient(W / 2, HORIZON_Y, 20, W / 2, HORIZON_Y, W * 0.55);
    skyGlow.addColorStop(0, 'rgba(255,210,110,0.16)');
    skyGlow.addColorStop(1, 'rgba(255,210,110,0)');
    ctx.fillStyle = skyGlow;
    ctx.fillRect(0, HORIZON_Y - 100, W, 220);

    s.pathTiles.forEach(tile => {
      const yy = tile.y;
      const top = yy;
      const bot = yy + TILE_H;
      const cx = W / 2;
      const tW = roadWidthAtY(top);
      const bW = roadWidthAtY(bot);
      const depth = roadT(bot);

      const roadGrad = ctx.createLinearGradient(0, top, 0, bot);
      roadGrad.addColorStop(0, '#1d1d2c');
      roadGrad.addColorStop(1, '#303043');
      ctx.fillStyle = roadGrad;
      ctx.strokeStyle = 'rgba(201,164,96,0.26)';
      ctx.lineWidth = 0.8 + depth * 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - tW / 2, top);
      ctx.lineTo(cx + tW / 2, top);
      ctx.lineTo(cx + bW / 2, bot);
      ctx.lineTo(cx - bW / 2, bot);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,225,120,${0.08 + depth * 0.17})`;
      ctx.lineWidth = 1 + depth * 2.2;
      for (let li = 0; li < LANE_COUNT - 1; li++) {
        const ratio = (li + 1) / LANE_COUNT;
        const txl = cx - tW / 2 + tW * ratio;
        const bxl = cx - bW / 2 + bW * ratio;
        ctx.setLineDash([6 + depth * 20, 7 + depth * 15]);
        ctx.beginPath();
        ctx.moveTo(txl, top);
        ctx.lineTo(bxl, bot);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.strokeStyle = `rgba(255,70,70,${0.16 + depth * 0.18})`;
      ctx.lineWidth = 2 + depth * 2;
      ctx.beginPath();
      ctx.moveTo(cx - tW / 2, top);
      ctx.lineTo(cx - bW / 2, bot);
      ctx.moveTo(cx + tW / 2, top);
      ctx.lineTo(cx + bW / 2, bot);
      ctx.stroke();
      tile.y += s.speed;
    });

    s.streaks.forEach((st) => {
      const t = roadT(st.y);
      const roadW = roadWidthAtY(st.y);
      const x = W / 2 + st.side * (roadW / 2 + 10 + t * 30);
      ctx.strokeStyle = `rgba(255,255,255,${st.alpha * t})`;
      ctx.lineWidth = 1 + t * 3;
      ctx.beginPath();
      ctx.moveTo(x, st.y - st.len * t);
      ctx.lineTo(x + st.side * 18 * t, st.y + st.len);
      ctx.stroke();
      st.y += s.speed * (0.55 + t * 1.2);
      if (st.y > H + 60) {
        st.y = HORIZON_Y + Math.random() * 70;
        st.side = Math.random() < 0.5 ? -1 : 1;
        st.alpha = 0.15 + Math.random() * 0.3;
      }
    });

    while (s.pathTiles.length > 0 && s.pathTiles[0].y > H + TILE_H) {
      s.pathTiles.shift();
    }
    while (s.pathTiles.length < 14) {
      const last = s.pathTiles[s.pathTiles.length - 1];
      s.pathTiles.push({ y: last.y - TILE_H });
    }
  }, [roadT, roadWidthAtY]);

  const drawObstacle = useCallback((ctx, o) => {
    const s = stateRef.current;
    const scale = perspScale(o.y);
    const cx = laneScreenX(o.lane, o.y);
    const shadowW = (o.w || 50) * scale * 0.85;

    ctx.save();
    ctx.globalAlpha = Math.max(0.2, scale);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(cx, o.y + 4 * scale, shadowW * 0.55, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (o.type === 'barrier') {
      ctx.save();
      ctx.translate(cx, o.y);
      ctx.scale(scale * 0.95, scale * 0.95);
      
      ctx.fillStyle = '#301a0a';
      ctx.strokeStyle = '#ffb020';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-28, -18, 56, 34, 4);
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#ffb020' : '#1a1410';
        ctx.fillRect(-27 + i * 11, -14, 10, 25);
      }
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('JUMP', 0, -24);
      
      ctx.restore();
    } else if (o.type === 'lowbar') {
      ctx.save();
      ctx.translate(cx, o.y);
      ctx.scale(scale * 0.85, scale * 0.85);
      
      ctx.fillStyle = '#ffff00';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#ffff00' : '#000';
        ctx.fillRect(-26 + i * 10.4, -8, 10.4, 8);
      }
      ctx.strokeRect(-26, -8, 52, 8);
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 6px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SLIDE', 0, -2);
      
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(cx, o.y);
      ctx.scale(scale, scale);

      const flash = Math.sin(s.frame * 0.32) > 0 ? '#ff1f35' : '#1f66ff';
      ctx.fillStyle = '#152747';
      ctx.strokeStyle = flash;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-22, -48, 44, 50, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = flash;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(0, -48, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8eefc';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FBI', 0, -22);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-15, -8, 30, 10);
      ctx.restore();
    }
    o.y += s.speed * (0.88 + scale * 0.18);
  }, [perspScale, laneScreenX]);

  const drawCoin = useCallback((ctx, c) => {
    if (c.collected) return;
    const s = stateRef.current;
    const scale = perspScale(c.y);
    const cx = laneScreenX(c.lane, c.y);
    const pulse = 0.85 + 0.15 * Math.sin(s.frame * 0.12 + c.y * 0.05);
    
    ctx.save();
    ctx.translate(cx, c.y);
    ctx.scale(scale * pulse, scale * pulse);
    
    ctx.fillStyle = '#2a5a2a';
    ctx.strokeStyle = '#4a8a4a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-12, -8, 24, 16, 3);
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = '#8afa8a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 0);
    
    ctx.restore();
    c.y += s.speed * (0.9 + scale * 0.12);
  }, [perspScale, laneScreenX]);

  const drawPlayer = useCallback((ctx) => {
    const s = stateRef.current;
    const p = s.player;
    if (p.invincible > 0 && Math.floor(s.frame / 4) % 2 === 0) return;

    const bY = H - 120;
    const tx = laneScreenX(p.targetLane, bY);
    p.x += (tx - p.x) * 0.26;
    const jumpH = p.jumping ? Math.max(0, -p.vy * 6) : 0;
    const pY = bY - jumpH;
    const sh = p.sliding ? p.h * 0.5 : p.h;
    const sy = p.sliding ? p.h * 0.5 : 0;

    p.runTick++;
    if (p.runTick % 8 === 0) p.runFrame = (p.runFrame + 1) % 4;
    const bob = p.jumping ? 0 : Math.sin(p.runFrame * Math.PI / 2) * 3;

    ctx.save();
    ctx.translate(p.x, pY + bob);

    const shadow = ctx.createRadialGradient(0, bY - pY + sh + sy, 2, 0, bY - pY + sh + sy, 22);
    shadow.addColorStop(0, 'rgba(0,0,0,0.5)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(0, bY - pY + sh + sy, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!p.sliding) {
      const legSwing = Math.sin(p.runFrame * Math.PI / 2) * 8;
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.roundRect(-8, 22, 14, 26, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-8 + legSwing, 22, 13, 26, 3);
      ctx.fill();
      
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.roundRect(-10 - legSwing * 0.5, 44, 16, 7, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(4 + legSwing * 0.5, 44, 16, 7, 2);
      ctx.fill();
      
      const armSwing = Math.sin(p.runFrame * Math.PI / 2) * 14;
      ctx.fillStyle = '#d4a574';
      ctx.beginPath();
      ctx.roundRect(-18, 2 + armSwing, 12, 22, 4);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(8, 2 - armSwing, 12, 22, 4);
      ctx.fill();
    }

    ctx.fillStyle = '#2a2a2a';
    if (p.sliding) {
      ctx.beginPath();
      ctx.roundRect(-16, 2, 32, 36, 6);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(-14, -sh + sy, 28, sh - sy, 6);
      ctx.fill();
      
      ctx.fillStyle = '#c41e3a';
      ctx.beginPath();
      ctx.roundRect(-10, -sh + sy + 20, 20, 8, 2);
      ctx.fill();
    }

    if (!p.sliding) {
      ctx.fillStyle = '#d4a574';
      ctx.beginPath();
      ctx.arc(0, -sh + sy + 10, 12, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.ellipse(0, -sh + sy + 2, 16, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-16, -sh + sy + 2, 32, 8);
      ctx.beginPath();
      ctx.ellipse(0, -sh + sy - 4, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-4, -sh + sy + 12, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(4, -sh + sy + 12, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [laneScreenX]);

  const drawParticles = useCallback((ctx) => {
    const s = stateRef.current;
    s.particles.forEach((p) => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2;
      p.life -= 0.04;
    });
    ctx.globalAlpha = 1;
    s.particles = s.particles.filter(p => p.life > 0);
  }, []);

  const drawHUD = useCallback((ctx) => {
    const s = stateRef.current;
    const distText = `${Math.floor(s.score)} m`;
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 172, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#4afa4a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🏃 ' + distText + '  💵 ' + s.coins, 16, 29);

    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.beginPath();
    ctx.roundRect(W - 142, 8, 134, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#ff4455';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`WANTED  ${Math.round(s.speed * 10)} mph`, W - 16, 29);
  }, []);

  const drawTitle = useCallback((ctx) => {
    const s = stateRef.current;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#c41e3a';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('THE GETAWAY', W / 2, H / 2 - 80);

    ctx.fillStyle = 'rgba(196,30,58,0.6)';
    ctx.font = '15px sans-serif';
    ctx.fillText('Run the alley. Dodge the feds. Grab the cash.', W / 2, H / 2 - 45);

    ctx.fillStyle = '#aaa';
    ctx.font = '13px sans-serif';
    ctx.fillText('← → / swipe: change lanes', W / 2, H / 2 + 5);
    ctx.fillText('↑ jump barricades · ↓ slide tape', W / 2, H / 2 + 28);
    ctx.fillText('Stay alive as the street speeds up', W / 2, H / 2 + 51);

    ctx.fillStyle = '#4afa4a';
    ctx.font = 'bold 18px sans-serif';
    const pulse = 0.7 + 0.3 * Math.sin(s.frame * 0.08);
    ctx.globalAlpha = pulse;
    ctx.fillText('TAP TO START', W / 2, H / 2 + 100);
    ctx.globalAlpha = 1;

    if (s.highScore > 0) {
      ctx.fillStyle = 'rgba(74,250,74,0.6)';
      ctx.font = '13px sans-serif';
      ctx.fillText('Best: ' + Math.floor(s.highScore) + ' m', W / 2, H / 2 + 140);
    }

    ctx.save();
    ctx.translate(W * 0.15, H / 2 + 10);
    ctx.scale(0.6, 0.6);
    ctx.fillStyle = '#1a3a6a';
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
    const flashColor = Math.sin(s.frame * 0.2) > 0 ? '#ff0000' : '#0000ff';
    ctx.fillStyle = flashColor;
    ctx.beginPath();
    ctx.arc(0, -15, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FBI', 0, 8);
    ctx.restore();
  }, []);

  const drawGameOver = useCallback((ctx) => {
    const s = stateRef.current;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ff4444';
    ctx.font = 'bold 38px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BUSTED!', W / 2, H / 2 - 70);

    ctx.fillStyle = '#4afa4a';
    ctx.font = '20px sans-serif';
    ctx.fillText(Math.floor(s.score) + ' m', W / 2, H / 2 - 25);

    ctx.fillStyle = '#aaa';
    ctx.font = '14px sans-serif';
    ctx.fillText('Best: ' + Math.floor(s.highScore) + ' m', W / 2, H / 2 + 8);

    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText('Cash collected: $' + (s.coins * 25).toLocaleString(), W / 2, H / 2 + 38);

    ctx.fillStyle = '#4afa4a';
    ctx.font = 'bold 17px sans-serif';
    const pulse = 0.7 + 0.3 * Math.sin(s.frame * 0.1);
    ctx.globalAlpha = pulse;
    ctx.fillText('TAP TO PLAY AGAIN', W / 2, H / 2 + 90);
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(W * 0.82, H / 2 - 30);
    ctx.scale(0.8, 0.8);
    ctx.fillStyle = '#1a3a6a';
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
    const flashColor = Math.sin(s.frame * 0.2) > 0 ? '#ff0000' : '#0000ff';
    ctx.fillStyle = flashColor;
    ctx.beginPath();
    ctx.arc(0, -15, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FBI', 0, 8);
    ctx.restore();
  }, []);

  const checkCollisions = useCallback(() => {
    const s = stateRef.current;
    const p = s.player;
    if (p.invincible > 0) {
      p.invincible--;
      return;
    }
    
    const px = p.x;
    const pY = H - 120;
    const ph = p.sliding ? p.h * 0.5 : p.h;
    const pTop = pY - ph + (p.sliding ? p.h * 0.5 : 0);

    for (let o of s.obstacles) {
      if (o.dead) continue;
      const scale = perspScale(o.y);
      const ox = laneScreenX(o.lane, o.y);
      const ow = o.w * scale * 0.9;
      const oh = o.h * scale * 0.9;
      const oTop = o.y - oh;

      if (Math.abs(px - ox) < (18 + ow / 2) && pTop < o.y && pY > oTop) {
        if (o.type === 'lowbar' && p.sliding) continue;
        if (o.type === 'barrier' && p.jumping) continue;
        
        o.dead = true;
        addParticle(ox, o.y, o.type === 'barrier' ? '#4488ff' : '#ffff00');
        s.lives--;
        s.shake = 18;
        lightHaptic(35);
        p.invincible = 90;
        setDisplayLives(s.lives);
        
        if (s.lives <= 0) {
          s.state = 'gameover';
          setGameState('gameover');
          if (s.score > s.highScore) s.highScore = s.score;
        }
        return;
      }
    }

    for (let c of s.coinItems) {
      if (c.collected) continue;
      const scale = perspScale(c.y);
      const cx2 = laneScreenX(c.lane, c.y);
      if (Math.abs(px - cx2) < 28 && Math.abs(pY - c.y) < 30) {
        c.collected = true;
        s.coins++;
        s.score += 50;
        addParticle(cx2, c.y, '#4afa4a');
        setDisplayCoins(s.coins);
        setDisplayScore(Math.floor(s.score));
      }
    }
  }, [perspScale, laneScreenX, addParticle]);

  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const s = stateRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (s.shake > 0) {
      const amt = Math.min(8, s.shake * 0.45);
      ctx.translate((Math.random() - 0.5) * amt, (Math.random() - 0.5) * amt);
      s.shake--;
    }
    drawSky(ctx);

    s.buildings.forEach(b => drawBuilding(ctx, b));

    if (s.state === 'title') {
      drawPath(ctx);
      drawTitle(ctx);
      s.frame++;
      ctx.restore();
      animRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    if (s.state === 'gameover') {
      drawPath(ctx);
      drawGameOver(ctx);
      s.frame++;
      ctx.restore();
      animRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    drawPath(ctx);

    s.frame++;
    s.score += s.speed * 0.04;
    s.speed = 6 + Math.min(12, s.score / 360);
    if (s.speed > 18) s.speed = 18;

    setDisplayScore(Math.floor(s.score));

    const spawnRate = Math.max(55, 120 - Math.floor(s.score / 100) * 4);
    if (s.frame % spawnRate === 0) spawnObstacle();
    if (s.frame % 90 === 45) spawnCoins();

    s.obstacles = s.obstacles.filter(o => o.y < H + 100 && !o.dead);
    s.coinItems = s.coinItems.filter(c => c.y < H + 60);

    s.coinItems.forEach(c => drawCoin(ctx, c));
    s.obstacles.forEach(o => drawObstacle(ctx, o));

    if (s.player.jumping) {
      s.player.vy += 0.7;
      if (s.player.vy >= 0) {
        s.player.jumping = false;
        s.player.vy = 0;
      }
    }

    if (s.player.sliding) {
      s.player.slideTimer--;
      if (s.player.slideTimer <= 0) s.player.sliding = false;
    }

    drawPlayer(ctx);
    drawParticles(ctx);
    drawHUD(ctx);
    checkCollisions();
    ctx.restore();

    animRef.current = requestAnimationFrame(gameLoop);
  }, [drawSky, drawBuilding, drawPath, drawTitle, drawGameOver, drawCoin, drawObstacle, drawPlayer, drawParticles, drawHUD, checkCollisions, spawnObstacle, spawnCoins]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    
    resetGame();
    animRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [resetGame, gameLoop]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const s = stateRef.current;
      if (s.state !== 'playing') {
        void handleStart();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'a') { e.preventDefault(); moveLeft(); }
      if (e.key === 'ArrowRight' || e.key === 'd') { e.preventDefault(); moveRight(); }
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') { e.preventDefault(); jump(); }
      if (e.key === 'ArrowDown' || e.key === 's') { e.preventDefault(); slide(); }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleStart, moveLeft, moveRight, jump, slide]);

  const handleTouchStart = useCallback((e) => {
    e.preventDefault();
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const handleTouchMove = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleTouchEnd = useCallback((e) => {
    e.preventDefault();
    const s = stateRef.current;
    if (s.state !== 'playing') {
      void handleStart();
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const threshold = 22;
    if (absX < threshold && absY < threshold) {
      jump();
      return;
    }
    if (absX > absY) {
      if (dx < -threshold) moveLeft();
      else if (dx > threshold) moveRight();
    } else {
      if (dy < -threshold) jump();
      else if (dy > threshold) slide();
    }
  }, [handleStart, moveLeft, moveRight, jump, slide]);

  return (
    <div className={`${styles.pageContent} mobile-page-root space-y-2 sm:space-y-4`}>
      {captchaModal}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-base sm:text-lg font-heading font-bold text-primary uppercase tracking-wider">The Getaway</h1>
          <p className="text-[9px] sm:text-[10px] text-mutedForeground">Swipe-run alley chase through the city</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {playsLeft != null && (
            <span className={`text-[9px] sm:text-[10px] font-heading ${canPlay ? 'text-mutedForeground' : 'text-red-500 font-bold'}`}>
              {playsLeft}/{maxPlays} plays
            </span>
          )}
          <button
            onClick={() => setShowRules(!showRules)}
            className="px-2.5 sm:px-3 py-1 rounded border border-primary/30 text-primary text-[10px] sm:text-xs font-heading hover:bg-primary/10"
          >
            {showRules ? 'Hide Rules' : 'Show Rules'}
          </button>
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
          <span>Score: <span className="text-primary">{displayScore}</span></span>
          <span>Cash: <span className="text-emerald-400">${(displayCoins * 25).toLocaleString()}</span></span>
          <span>Lives: {'❤️'.repeat(displayLives)}{'🖤'.repeat(3 - displayLives)}</span>
        </div>
      </div>

      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          onClick={() => void handleStart()}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="rounded-lg cursor-pointer touch-none select-none border border-primary/20 shadow-2xl shadow-black/40 bg-black"
          style={{
            maxWidth: '100%',
            width: 'min(100%, 480px, calc((100dvh - 210px) * 0.75))',
            minWidth: 'min(100%, 300px)',
            height: 'auto',
            aspectRatio: `${W}/${H}`,
            touchAction: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
        />
      </div>

      <div className={`${styles.panel} mobile-panel rounded-lg p-2 grid grid-cols-4 gap-2 sm:flex sm:w-full sm:justify-between sm:flex-wrap`}>
        <button
          onClick={() => { if (gameState === 'playing') moveLeft(); else void handleStart(); }}
          className={`px-2 sm:px-4 py-3 sm:py-2 rounded border border-primary/30 text-primary text-[11px] sm:text-sm font-heading font-bold hover:bg-primary/10 touch-manipulation min-h-[48px] sm:min-w-[60px] active:scale-95 transition-transform`}
        >
          ←<span className="hidden sm:inline"> Left</span>
        </button>
        <button
          onClick={() => { if (gameState === 'playing') jump(); else void handleStart(); }}
          className={`px-2 sm:px-4 py-3 sm:py-2 rounded border border-primary/30 text-primary text-[11px] sm:text-sm font-heading font-bold hover:bg-primary/10 touch-manipulation min-h-[48px] sm:min-w-[60px] active:scale-95 transition-transform`}
        >
          ↑<span className="hidden sm:inline"> Jump</span>
        </button>
        <button
          onClick={() => { if (gameState === 'playing') slide(); else void handleStart(); }}
          className={`px-2 sm:px-4 py-3 sm:py-2 rounded border border-primary/30 text-primary text-[11px] sm:text-sm font-heading font-bold hover:bg-primary/10 touch-manipulation min-h-[48px] sm:min-w-[60px] active:scale-95 transition-transform`}
        >
          ↓<span className="hidden sm:inline"> Slide</span>
        </button>
        <button
          onClick={() => { if (gameState === 'playing') moveRight(); else void handleStart(); }}
          className={`px-2 sm:px-4 py-3 sm:py-2 rounded border border-primary/30 text-primary text-[11px] sm:text-sm font-heading font-bold hover:bg-primary/10 touch-manipulation min-h-[48px] sm:min-w-[60px] active:scale-95 transition-transform`}
        >
          <span className="hidden sm:inline">Right </span>→
        </button>
      </div>
    </div>
  );
}
