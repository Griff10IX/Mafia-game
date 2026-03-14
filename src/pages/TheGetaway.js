import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import api from "../utils/api";
import styles from "../styles/noir.module.css";

const W = 480, H = 640;
const LANES = [-120, 0, 120];
const LANE_COUNT = 3;
const TILE_H = 80;

const RULES = [
  "Swipe or use arrow keys to change lanes",
  "Tap/Press UP or swipe up to jump over barriers",
  "Tap/Press DOWN or swipe down to slide under police tape",
  "Collect cash bundles for bonus money",
  "Avoid cops and FBI agents",
  "Distance + coins = your final score",
  "Max 15 runs per hour",
];

export default function TheGetaway() {
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

  const laneX = useCallback((l) => W / 2 + LANES[l], []);

  const perspScale = useCallback((y) => {
    const t = Math.max(0, Math.min(1, (y - H * 0.28) / (H * 0.55)));
    return 0.35 + 0.65 * t;
  }, []);

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
    if (type < 0.35) {
      s.obstacles.push({ lane, x: laneX(lane), y: -40, w: 44, h: 52, type: 'barrier', dead: false });
    } else if (type < 0.65) {
      s.obstacles.push({ lane, x: laneX(lane), y: -40, w: 52, h: 30, type: 'lowbar', dead: false });
    } else {
      const l2 = (lane + 1) % 3;
      s.obstacles.push({ lane, x: laneX(lane), y: -40, w: 44, h: 52, type: 'barrier', dead: false });
      s.obstacles.push({ lane: l2, x: laneX(l2), y: -40, w: 44, h: 52, type: 'barrier', dead: false });
    }
  }, [laneX]);

  const spawnCoins = useCallback(() => {
    const s = stateRef.current;
    const lane = Math.floor(Math.random() * 3);
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      s.coinItems.push({ lane, x: laneX(lane), y: -40 - i * 52, r: 10, collected: false });
    }
  }, [laneX]);

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
    s.gameStartTime = Date.now();

    for (let i = 0; i < 12; i++) {
      s.pathTiles.push({ y: H - 120 + i * -TILE_H });
    }
    for (let i = 0; i < 8; i++) {
      s.buildings.push({
        x: Math.random() < 0.5 ? W * 0.05 + Math.random() * 50 : W * 0.75 + Math.random() * 50,
        y: 180 + Math.random() * 260,
        w: 40 + Math.random() * 60,
        h: 80 + Math.random() * 120,
        windows: Math.floor(Math.random() * 3) + 2,
        neonColor: ['#ff00ff', '#00ffff', '#ffff00', '#ff6600'][Math.floor(Math.random() * 4)],
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
    setSubmitted(true);
    
    const timeSeconds = Math.floor((Date.now() - (s.gameStartTime || Date.now())) / 1000);
    
    try {
      const res = await api.post('/the-getaway/run', {
        distance: Math.floor(s.score),
        coins_collected: s.coins,
        time_seconds: timeSeconds,
      });
      if (res.data?.reward) {
        toast.success(`Clean getaway! +$${res.data.reward.cash.toLocaleString()} +${res.data.reward.respect} respect`);
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Failed to submit run';
      toast.error(msg);
    }
  }, [submitted]);

  const jump = useCallback(() => {
    const p = stateRef.current.player;
    if (!p.jumping && !p.sliding) {
      p.jumping = true;
      p.vy = -14;
    }
  }, []);

  const slide = useCallback(() => {
    const p = stateRef.current.player;
    if (!p.jumping) {
      p.sliding = true;
      p.slideTimer = 45;
    }
  }, []);

  const moveLeft = useCallback(() => {
    const p = stateRef.current.player;
    if (p.targetLane > 0) p.targetLane--;
  }, []);

  const moveRight = useCallback(() => {
    const p = stateRef.current.player;
    if (p.targetLane < 2) p.targetLane++;
  }, []);

  const handleStart = useCallback(() => {
    const s = stateRef.current;
    if (s.state === 'title' || s.state === 'gameover') {
      if (s.state === 'gameover') {
        submitRun();
      }
      resetGame();
      s.state = 'playing';
      setGameState('playing');
    }
  }, [resetGame, submitRun]);

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
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(b.x, b.y - b.h, b.w, b.h);
    
    ctx.strokeStyle = b.neonColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x, b.y - b.h, b.w, b.h);
    
    const windowW = 8;
    const windowH = 12;
    const cols = Math.floor(b.w / 16);
    const rows = Math.floor(b.h / 20);
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = b.x + 4 + c * 16;
        const wy = b.y - b.h + 6 + r * 20;
        const lit = Math.random() > 0.3;
        ctx.fillStyle = lit ? 'rgba(255,220,100,0.7)' : 'rgba(20,20,40,0.8)';
        ctx.fillRect(wx, wy, windowW, windowH);
      }
    }
    
    if (Math.random() > 0.7) {
      ctx.fillStyle = b.neonColor;
      ctx.globalAlpha = 0.6 + Math.sin(stateRef.current.frame * 0.1) * 0.3;
      ctx.fillRect(b.x + 5, b.y - b.h - 8, b.w - 10, 6);
      ctx.globalAlpha = 1;
    }
  }, []);

  const drawPath = useCallback((ctx) => {
    const s = stateRef.current;
    s.pathTiles.forEach(tile => {
      const yy = tile.y;
      const top = yy;
      const bot = yy + TILE_H;
      const wTop = W * 0.38;
      const wBot = W * 0.64;
      const cx = W / 2;

      const tFrac = Math.max(0, Math.min(1, (top - (H * 0.28)) / (H * 0.55)));
      const bFrac = Math.max(0, Math.min(1, (bot - (H * 0.28)) / (H * 0.55)));

      const tW = wTop * (1 - tFrac) + wBot * tFrac;
      const bW = wTop * (1 - bFrac) + wBot * bFrac;

      ctx.fillStyle = '#2a2a3a';
      ctx.strokeStyle = 'rgba(100,100,140,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - tW / 2, top);
      ctx.lineTo(cx + tW / 2, top);
      ctx.lineTo(cx + bW / 2, bot);
      ctx.lineTo(cx - bW / 2, bot);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,100,0.15)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      const centerX = cx;
      ctx.beginPath();
      ctx.moveTo(centerX, top);
      ctx.lineTo(centerX, bot);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = 'rgba(140,140,180,0.3)';
      ctx.lineWidth = 0.5;
      for (let li = 0; li < LANE_COUNT - 1; li++) {
        const ratio = (li + 1) / LANE_COUNT;
        const txl = cx - tW / 2 + tW * ratio;
        const bxl = cx - bW / 2 + bW * ratio;
        ctx.beginPath();
        ctx.moveTo(txl, top);
        ctx.lineTo(bxl, bot);
        ctx.stroke();
      }
      tile.y += s.speed;
    });

    while (s.pathTiles.length > 0 && s.pathTiles[0].y > H + TILE_H) {
      s.pathTiles.shift();
    }
    while (s.pathTiles.length < 14) {
      const last = s.pathTiles[s.pathTiles.length - 1];
      s.pathTiles.push({ y: last.y - TILE_H });
    }
  }, []);

  const drawObstacle = useCallback((ctx, o) => {
    const s = stateRef.current;
    const scale = perspScale(o.y);
    const cx = W / 2 + LANES[o.lane] * scale;

    if (o.type === 'barrier') {
      ctx.save();
      ctx.translate(cx, o.y);
      ctx.scale(scale * 0.8, scale * 0.8);
      
      ctx.fillStyle = '#1a3a6a';
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-22, -52, 44, 52, 4);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(0, -40, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0000ff';
      ctx.beginPath();
      ctx.arc(0, -40, 6 * (0.5 + 0.5 * Math.sin(s.frame * 0.3)), 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('POLICE', 0, -20);
      
      ctx.restore();
    } else {
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
      ctx.fillText('CAUTION', 0, -2);
      
      ctx.restore();
    }
    o.y += s.speed;
  }, [perspScale]);

  const drawCoin = useCallback((ctx, c) => {
    if (c.collected) return;
    const s = stateRef.current;
    const scale = perspScale(c.y);
    const cx = W / 2 + LANES[c.lane] * scale;
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
    c.y += s.speed;
  }, [perspScale]);

  const drawPlayer = useCallback((ctx) => {
    const s = stateRef.current;
    const p = s.player;
    if (p.invincible > 0 && Math.floor(s.frame / 4) % 2 === 0) return;

    const tx = laneX(p.targetLane);
    p.x += (tx - p.x) * 0.22;

    const bY = H - 120;
    const jumpH = p.jumping ? -p.vy * 6 : 0;
    const pY = bY + jumpH;
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
  }, [laneX]);

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
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 130, 30, 6);
    ctx.fill();
    ctx.fillStyle = '#4afa4a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🏃 ' + distText + '  💵 ' + s.coins, 16, 27);
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
    ctx.fillText('Escape the feds!', W / 2, H / 2 - 45);

    ctx.fillStyle = '#aaa';
    ctx.font = '13px sans-serif';
    ctx.fillText('← → to change lane', W / 2, H / 2 + 5);
    ctx.fillText('↑ to jump · ↓ to slide', W / 2, H / 2 + 28);
    ctx.fillText('Swipe on mobile!', W / 2, H / 2 + 51);

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
    ctx.fillText('Cash collected: $' + (s.coins * 100).toLocaleString(), W / 2, H / 2 + 38);

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
      const ox = W / 2 + LANES[o.lane] * scale;
      const ow = o.w * scale * 0.8;
      const oh = o.h * scale * 0.8;
      const oTop = o.y - oh;

      if (Math.abs(px - ox) < (18 + ow / 2) && pTop < o.y && pY > oTop) {
        if (o.type === 'lowbar' && p.sliding) continue;
        if (o.type === 'barrier' && p.jumping) continue;
        
        o.dead = true;
        addParticle(ox, o.y, o.type === 'barrier' ? '#4488ff' : '#ffff00');
        s.lives--;
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
      const cx2 = W / 2 + LANES[c.lane] * scale;
      if (Math.abs(px - cx2) < 28 && Math.abs(pY - c.y) < 30) {
        c.collected = true;
        s.coins++;
        s.score += 50;
        addParticle(cx2, c.y, '#4afa4a');
        setDisplayCoins(s.coins);
        setDisplayScore(Math.floor(s.score));
      }
    }
  }, [perspScale, addParticle]);

  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const s = stateRef.current;

    ctx.clearRect(0, 0, W, H);
    drawSky(ctx);

    s.buildings.forEach(b => drawBuilding(ctx, b));

    if (s.state === 'title') {
      drawPath(ctx);
      drawTitle(ctx);
      s.frame++;
      animRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    if (s.state === 'gameover') {
      drawPath(ctx);
      drawGameOver(ctx);
      s.frame++;
      animRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    drawPath(ctx);

    s.frame++;
    s.score += s.speed * 0.04;
    s.speed = 6 + Math.floor(s.score / 200) * 0.5;
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
        handleStart();
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
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    const s = stateRef.current;
    if (s.state !== 'playing') {
      handleStart();
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < -30) moveLeft();
      else if (dx > 30) moveRight();
    } else {
      if (dy < -20) jump();
      else if (dy > 20) slide();
    }
  }, [handleStart, moveLeft, moveRight, jump, slide]);

  return (
    <div className={`${styles.pageContent} space-y-4`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-heading font-bold text-primary uppercase tracking-wider">The Getaway</h1>
          <p className="text-[10px] text-mutedForeground">Escape through the city streets</p>
        </div>
        <button
          onClick={() => setShowRules(!showRules)}
          className="px-3 py-1 rounded border border-primary/30 text-primary text-xs font-heading hover:bg-primary/10"
        >
          {showRules ? 'Hide Rules' : 'Show Rules'}
        </button>
      </div>

      {showRules && (
        <div className={`${styles.panel} rounded-lg p-3 space-y-2`}>
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

      <div className={`${styles.panel} rounded-lg p-2`}>
        <div className="flex justify-between items-center px-2 py-1 text-xs font-heading text-foreground">
          <span>Score: <span className="text-primary">{displayScore}</span></span>
          <span>Cash: <span className="text-emerald-400">${(displayCoins * 100).toLocaleString()}</span></span>
          <span>Lives: {'❤️'.repeat(displayLives)}{'🖤'.repeat(3 - displayLives)}</span>
        </div>
      </div>

      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          onClick={handleStart}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="rounded-lg cursor-pointer touch-none select-none"
          style={{ maxWidth: '100%', width: W, height: 'auto', aspectRatio: `${W}/${H}` }}
        />
      </div>

      <div className="flex justify-center gap-2 flex-wrap">
        <button
          onClick={() => { if (gameState === 'playing') moveLeft(); else handleStart(); }}
          className={`px-4 py-2 rounded border border-primary/30 text-primary text-sm font-heading hover:bg-primary/10 touch-manipulation min-w-[60px]`}
        >
          ← Left
        </button>
        <button
          onClick={() => { if (gameState === 'playing') jump(); else handleStart(); }}
          className={`px-4 py-2 rounded border border-primary/30 text-primary text-sm font-heading hover:bg-primary/10 touch-manipulation min-w-[60px]`}
        >
          ↑ Jump
        </button>
        <button
          onClick={() => { if (gameState === 'playing') slide(); else handleStart(); }}
          className={`px-4 py-2 rounded border border-primary/30 text-primary text-sm font-heading hover:bg-primary/10 touch-manipulation min-w-[60px]`}
        >
          ↓ Slide
        </button>
        <button
          onClick={() => { if (gameState === 'playing') moveRight(); else handleStart(); }}
          className={`px-4 py-2 rounded border border-primary/30 text-primary text-sm font-heading hover:bg-primary/10 touch-manipulation min-w-[60px]`}
        >
          Right →
        </button>
      </div>
    </div>
  );
}
