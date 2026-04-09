import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, Users, Trophy, Target, Zap, RefreshCw, Volume2, VolumeX, Sparkles, Crosshair, SlidersHorizontal, Gauge,
} from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { useMinigameCaptcha } from '../../hooks/useMinigameCaptcha';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import railOrnateAsset from '../../lib/pool_assets/rail-ornate.svg';
import feltNoiseAsset from '../../lib/pool_assets/felt-noise.svg';
import cueSkinAsset from '../../lib/pool_assets/cue-skin.svg';
import { simulatePreview, pockets as physicsPockets } from '../../lib/pool_physics';

const POOL_STYLES = `
  .pool-fade-in { animation: pool-fade-in 0.35s ease-out both; }
  @keyframes pool-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .pool-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.2; }
  .pool-canvas-shell {
    background: radial-gradient(ellipse 120% 80% at 50% 20%, rgba(56,189,248,0.14), transparent 50%),
      linear-gradient(180deg, #2a1810 0%, #120a06 100%);
    border: 1px solid rgba(255,255,255,0.12);
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.5), 0 16px 40px rgba(0,0,0,0.65), 0 0 24px rgba(8,145,178,0.12);
  }
  .pool-canvas {
    box-shadow: inset 0 0 48px rgba(0,0,0,0.55), 0 0 16px rgba(34,211,238,0.1);
  }
  .pool-table-wrap {
    width: 100%;
    margin: 0 auto;
    max-width: 760px;
  }
  @media (max-width: 640px) {
    .pool-table-wrap {
      max-width: 100%;
    }
    .pool-canvas-shell {
      padding: 4px !important;
      border-radius: 8px !important;
    }
  }
  @media (min-width: 1024px) {
    .pool-table-wrap {
      max-width: 700px;
    }
  }
  @media (min-width: 1280px) {
    .pool-table-wrap {
      max-width: 650px;
    }
  }
`;

const TABLE_W = 2.2;
const TABLE_H = 1.1;
/** Must match `MP_8BALL_HEAD_STRING_X` / kitchen logic in backend mp_8ball.py */
const TABLE_HEAD_STRING_X = TABLE_W * 0.25;
const BALL_R = 0.028;
const POCKET_CENTERS_TABLE = physicsPockets();
const AI_POOL_ID = 'ai_pool_bot';
const POOL_SHOT_CLOCK_SEC = 60;
const REPLAY_IDLE_POS_EPS = 0.00035;
const REPLAY_IDLE_VEL_EPS = 0.006;
const PREVIEW_TABLE_MARGIN = 14;
/** Must match `<canvas width>` / `<canvas height>` on the pool table. */
const POOL_CANVAS_W = 900;
const POOL_CANVAS_H = 450;

/** Map physics table coords to the inner felt rectangle (same basis as wall bounces in aim preview). */
function tableToCanvasX(tx, canvasW = POOL_CANVAS_W) {
  const m = PREVIEW_TABLE_MARGIN;
  return m + (Number(tx) / TABLE_W) * (canvasW - 2 * m);
}
function tableToCanvasY(ty, canvasH = POOL_CANVAS_H) {
  const m = PREVIEW_TABLE_MARGIN;
  return m + (Number(ty) / TABLE_H) * (canvasH - 2 * m);
}
/** Pixel radii on the felt — TABLE_W / TABLE_H differ, so the ball is an ellipse in canvas space (matches physics circle in table space). */
function ballRadiiPx(canvasW = POOL_CANVAS_W, canvasH = POOL_CANVAS_H) {
  const m = PREVIEW_TABLE_MARGIN;
  const fw = canvasW - 2 * m;
  const fh = canvasH - 2 * m;
  const rx = Math.max(4, (BALL_R / TABLE_W) * fw);
  const ry = Math.max(4, (BALL_R / TABLE_H) * fh);
  return { rx, ry };
}
function ballRadiusMax(canvasW = POOL_CANVAS_W, canvasH = POOL_CANVAS_H) {
  const { rx, ry } = ballRadiiPx(canvasW, canvasH);
  return Math.max(rx, ry);
}
function canvasToTableX(sx, canvasW = POOL_CANVAS_W) {
  const m = PREVIEW_TABLE_MARGIN;
  return ((Number(sx) - m) / (canvasW - 2 * m)) * TABLE_W;
}
function canvasToTableY(sy, canvasH = POOL_CANVAS_H) {
  const m = PREVIEW_TABLE_MARGIN;
  return ((Number(sy) - m) / (canvasH - 2 * m)) * TABLE_H;
}

/** Mirror backend mp_8ball._upgrade_milestones / _upgrade_effects for aim preview parity */
function poolUpgradeMilestones(upg) {
  const keys = ['power', 'curve', 'luck', 'aim', 'control'];
  const o = {};
  for (const k of keys) {
    o[k] = Math.floor(Math.max(0, Number(upg?.[k] || 0)) / 10);
  }
  return o;
}
function poolUpgradeEffects(upg) {
  if (!upg) return { power_mul: 1, curve_mul: 1 };
  const ms = poolUpgradeMilestones(upg);
  const lvPower = Math.max(0, Number(upg.power || 0));
  const lvCurve = Math.max(0, Number(upg.curve || upg.spin || 0));
  return {
    power_mul: 1.0 + (lvPower * 0.006) + (ms.power * 0.01),
    curve_mul: 1.0 + (lvCurve * 0.007) + (ms.curve * 0.015),
  };
}

const TABLE_SKINS = {
  /** Mobile-pool reference: bright felt, dark blue cushions, mahogany rails, silver sights */
  miniclip_blue: {
    name: 'Arena Blue',
    felt: ['#9ae8ff', '#4dc7fc', '#0ea5e9'],
    feltEdge: '#0369a1',
    cushion: ['#0c4a6e', '#075985', '#0a2540'],
    rail: ['#5c3624', '#7c4a32', '#4a2c18'],
    railHighlight: 'rgba(255,245,220,0.12)',
    pocket: ['#020617', '#000000'],
    pocketRim: 'rgba(30,58,138,0.45)',
    accent: 'rgba(255,255,255,0.55)',
    stud: '#d1dae6',
    studStroke: 'rgba(0,0,0,0.35)',
  },
  classic_green: {
    name: 'Classic Green',
    felt: ['#22c55e', '#16a34a', '#166534'],
    rail: ['#8b5e34', '#5c3b1e', '#2f1d0f'],
    pocket: ['#1f2937', '#000000'],
    accent: 'rgba(255,255,255,0.4)',
  },
  ice_blue: {
    name: 'Ice Blue',
    felt: ['#67e8f9', '#0ea5e9', '#075985'],
    rail: ['#9ca3af', '#4b5563', '#1f2937'],
    pocket: ['#0f172a', '#000000'],
    accent: 'rgba(255,255,255,0.5)',
  },
  royal_teal_gold: {
    name: 'Royal Teal',
    felt: ['#22d3ee', '#0891b2', '#155e75'],
    rail: ['#f5d37a', '#9a6e2e', '#2f1d0f'],
    pocket: ['#111827', '#000000'],
    accent: 'rgba(250,204,21,0.6)',
  },
};
const BALL_COLOR_MAP = {
  1: '#f59e0b', 2: '#2563eb', 3: '#dc2626', 4: '#7c3aed', 5: '#ea580c', 6: '#16a34a', 7: '#a16207',
  8: '#111111',
  9: '#f59e0b', 10: '#2563eb', 11: '#dc2626', 12: '#7c3aed', 13: '#ea580c', 14: '#16a34a', 15: '#a16207',
};

function turnLabel(game) {
  const players = game?.players || [];
  const idx = Number(game?.current_turn_index || 0);
  if (!players[idx]) return '—';
  return players[idx].username || 'Unknown';
}

function groupBadge(group) {
  if (group === 'solid') return 'Solids';
  if (group === 'stripe') return 'Stripes';
  return 'Unassigned';
}

/** Matches backend `_upgrade_cash_cost` in mp_8ball.py */
function poolUpgradeCashCost(statLevel, totalLevel) {
  const base = 420 + statLevel * 130;
  const progressionTax = Math.floor(totalLevel / 5) * 30;
  return Math.floor(base + progressionTax);
}

const POOL_GARAGE_STATS = [
  { key: 'power', label: 'Power', hint: 'Shot strength multiplier', Icon: Zap, color: '#fb923c' },
  { key: 'curve', label: 'Curve', hint: 'Spin & swerve on the cue ball', Icon: Gauge, color: '#c084fc' },
  { key: 'luck', label: 'Luck', hint: 'Minor table roll variance (not fouls)', Icon: Sparkles, color: '#f472b6' },
  { key: 'aim', label: 'Aim', hint: 'Longer aim preview & rail paths', Icon: Crosshair, color: '#22d3ee' },
  { key: 'control', label: 'Control', hint: 'Cue stability & finesse', Icon: SlidersHorizontal, color: '#84cc16' },
];

function rayCircleHit(originX, originY, dirX, dirY, ballX, ballY, radius) {
  const dx = originX - ballX;
  const dy = originY - ballY;
  const b = 2 * ((dirX * dx) + (dirY * dy));
  const c = (dx * dx) + (dy * dy) - (radius * radius);
  const disc = (b * b) - (4 * c);
  if (disc < 0) return null;
  const sd = Math.sqrt(disc);
  const t1 = (-b - sd) / 2;
  const t2 = (-b + sd) / 2;
  const candidates = [t1, t2].filter((t) => t > 1e-4);
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

/** Distance along ray to inner table edge (canvas coords). */
function rayToTableWall(ox, oy, dx, dy, minX, maxX, minY, maxY) {
  let wallDist = Number.POSITIVE_INFINITY;
  if (dx > 1e-8) wallDist = Math.min(wallDist, (maxX - ox) / dx);
  if (dx < -1e-8) wallDist = Math.min(wallDist, (minX - ox) / dx);
  if (dy > 1e-8) wallDist = Math.min(wallDist, (maxY - oy) / dy);
  if (dy < -1e-8) wallDist = Math.min(wallDist, (minY - oy) / dy);
  return wallDist;
}

export default function EightBallPool() {
  const { getCaptchaToken, captchaModal } = useMinigameCaptcha();
  const [tab, setTab] = useState('ai'); // ai | pvp
  const [loading, setLoading] = useState(false);
  const [aiGame, setAiGame] = useState(null);
  const [pvpGame, setPvpGame] = useState(null);
  const [lobbies, setLobbies] = useState([]);
  const [buyIn, setBuyIn] = useState(0);
  const [power, setPower] = useState(0.6);
  const [angleDeg, setAngleDeg] = useState(-12);
  const [spinX, setSpinX] = useState(0);
  const [spinY, setSpinY] = useState(0);
  const [profile, setProfile] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [myCues, setMyCues] = useState([]);
  const [cueUpgrades, setCueUpgrades] = useState([]);
  const [upgradeTotalCap, setUpgradeTotalCap] = useState(250);
  const [upgradeStatCap, setUpgradeStatCap] = useState(50);
  const [busy, setBusy] = useState(false);
  const [cueBusy, setCueBusy] = useState(false);
  const [pageTab, setPageTab] = useState('match');
  const [breakPreview, setBreakPreview] = useState(null);
  const [displayBalls, setDisplayBalls] = useState([]);
  const [isAiming, setIsAiming] = useState(false);
  const [aimPhase, setAimPhase] = useState('idle'); // idle | aiming | pulling
  const [tableSkin, setTableSkin] = useState('miniclip_blue');
  const [renderTick, setRenderTick] = useState(0);
  const [replayActive, setReplayActive] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const replayAnimRef = useRef(null);
  const replayActiveRef = useRef(false);
  const replayLastShotRef = useRef(0);
  const railTextureRef = useRef(null);
  const feltTextureRef = useRef(null);
  const cueTextureRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastSfxAtRef = useRef({ cue: 0, collision: 0, pocket: 0, rail: 0 });
  const animatingRef = useRef(false);
  const lastTargetBallsRef = useRef([]);
  const pocketedSetRef = useRef(new Set());
  const fxRef = useRef({ impacts: [], pockets: [], pocketDrops: [] });

  const activeGame = tab === 'ai' ? aiGame : pvpGame;
  const balls = useMemo(() => activeGame?.table_state?.balls || [], [activeGame?.table_state?.balls]);
  const viewerUid = activeGame?.viewer_user_id || null;
  const ballsSettled = Boolean(activeGame?.table_state?.balls_settled ?? true);
  const isMyTurn = useMemo(() => {
    if (!activeGame) return false;
    const players = activeGame.players || [];
    const idx = Number(activeGame.current_turn_index || 0);
    const current = players[idx];
    if (!current) return false;
    if (viewerUid) return current.user_id === viewerUid;
    if (tab === 'ai') return current.user_id !== AI_POOL_ID;
    return false;
  }, [activeGame, tab, viewerUid]);
  const canRenderCue = !!activeGame
    && !replayActive
    && activeGame.status === 'in_progress'
    && activeGame.phase === 'playing'
    && ballsSettled
    && isMyTurn;
  const awaitingBreak = Boolean(
    activeGame?.table_state?.awaiting_break_placement
    && Number(activeGame?.table_state?.shot_count || 0) === 0,
  );
  const inBreakPlacement = awaitingBreak && isMyTurn;
  const canAim = canRenderCue && !inBreakPlacement;

  const ballsForRender = useMemo(() => {
    if (breakPreview == null || !inBreakPlacement) return displayBalls;
    return displayBalls.map((b) => (Number(b.number) === 0 ? { ...b, x: breakPreview.x, y: breakPreview.y } : b));
  }, [displayBalls, breakPreview, inBreakPlacement]);

  useEffect(() => {
    if (!inBreakPlacement) setBreakPreview(null);
  }, [inBreakPlacement]);

  useEffect(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (replayAnimRef.current) cancelAnimationFrame(replayAnimRef.current);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (replayAnimRef.current) cancelAnimationFrame(replayAnimRef.current);
    };
  }, []);

  useEffect(() => {
    replayActiveRef.current = replayActive;
    if (replayActive) setIsAiming(false);
  }, [replayActive]);


  useEffect(() => {
    const loadImg = (src, targetRef) => {
      const img = new Image();
      img.src = src;
      img.onload = () => { targetRef.current = img; };
    };
    loadImg(railOrnateAsset, railTextureRef);
    loadImg(feltNoiseAsset, feltTextureRef);
    loadImg(cueSkinAsset, cueTextureRef);
  }, []);

  const playSfx = useCallback((type, strength = 1) => {
    if (!sfxEnabled) return;
    const now = Date.now();
    const minGap = type === 'collision' ? 35 : 60;
    if (now - (lastSfxAtRef.current[type] || 0) < minGap) return;
    lastSfxAtRef.current[type] = now;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
    const ctx = audioCtxRef.current;
    const t = ctx.currentTime;
    const vol = Math.min(0.12, 0.02 + strength * 0.04);

    if (type === 'cue') {
      // Sharp cue strike — short bright click + thud
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      o1.type = 'sine';
      o1.frequency.value = 800 + strength * 400;
      g1.gain.setValueAtTime(0.0001, t);
      g1.gain.linearRampToValueAtTime(vol * 1.5, t + 0.003);
      g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o2.type = 'triangle';
      o2.frequency.value = 120;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.linearRampToValueAtTime(vol * 0.8, t + 0.005);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o1.connect(g1).connect(ctx.destination);
      o2.connect(g2).connect(ctx.destination);
      o1.start(t); o1.stop(t + 0.05);
      o2.start(t); o2.stop(t + 0.1);
    } else if (type === 'collision') {
      // Ball-ball: two tones scaled by impact, softer for soft hits
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 350 + Math.min(400, strength * 600);
      const dur = strength > 0.1 ? 0.06 : 0.035;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.01);
      if (strength > 0.08) {
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'triangle';
        o2.frequency.value = 180;
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(vol * 0.4, t + 0.005);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o2.connect(g2).connect(ctx.destination);
        o2.start(t); o2.stop(t + 0.06);
      }
    } else if (type === 'pocket') {
      // Satisfying pocket drop: low thump + descending tone
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(200, t);
      o1.frequency.exponentialRampToValueAtTime(80, t + 0.15);
      g1.gain.setValueAtTime(0.0001, t);
      g1.gain.linearRampToValueAtTime(vol * 1.2, t + 0.008);
      g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o2.type = 'triangle';
      o2.frequency.value = 90;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.linearRampToValueAtTime(vol * 0.6, t + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o1.connect(g1).connect(ctx.destination);
      o2.connect(g2).connect(ctx.destination);
      o1.start(t); o1.stop(t + 0.22);
      o2.start(t); o2.stop(t + 0.27);
    } else if (type === 'rail') {
      // Cushion bounce: muted thud
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 140 + Math.min(120, strength * 180);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * 0.7, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.08);
    }
  }, [sfxEnabled]);

  useEffect(() => {
    if (replayActiveRef.current) return;
    const target = (balls || []).map((b) => ({ ...b }));
    if (!target.length) {
      setDisplayBalls([]);
      lastTargetBallsRef.current = [];
      return;
    }
    if (!displayBalls.length || !lastTargetBallsRef.current.length || displayBalls.length !== target.length) {
      setDisplayBalls(target);
      lastTargetBallsRef.current = target;
      return;
    }
    const fromById = new Map(displayBalls.map((b) => [b.id, b]));
    const toById = new Map(target.map((b) => [b.id, b]));
    const durationMs = 380;
    const startAt = performance.now();
    animatingRef.current = true;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const tick = (t) => {
      const raw = Math.min(1, (t - startAt) / durationMs);
      const eased = 1 - Math.pow(1 - raw, 3);
      const next = target.map((tb) => {
        const fb = fromById.get(tb.id);
        if (!fb || tb.pocketed || fb.pocketed) return { ...tb };
        return {
          ...tb,
          x: Number(fb.x || 0) + (Number(tb.x || 0) - Number(fb.x || 0)) * eased,
          y: Number(fb.y || 0) + (Number(tb.y || 0) - Number(fb.y || 0)) * eased,
        };
      });
      setDisplayBalls(next);
      if (raw < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        animatingRef.current = false;
        setDisplayBalls(target);
        lastTargetBallsRef.current = target;
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balls]);

  useEffect(() => {
    const id = setInterval(() => setRenderTick((n) => (n + 1) % 100000), 33);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const nowPocketed = new Set((balls || []).filter((b) => b.pocketed).map((b) => b.number));
    for (const n of nowPocketed) {
      if (!pocketedSetRef.current.has(n)) {
        fxRef.current.pockets.push({ number: n, at: Date.now() });
      }
    }
    pocketedSetRef.current = nowPocketed;
  }, [balls]);


  const selectedCue = useMemo(() => {
    const selectedId = profile?.selected_cue_id;
    return myCues.find((c) => c.id === selectedId) || myCues.find((c) => c.selected) || myCues[0] || null;
  }, [profile?.selected_cue_id, myCues]);

  const selectedCueUpgrade = useMemo(() => {
    if (!selectedCue) return null;
    return cueUpgrades.find((u) => u.cue_instance_id === selectedCue.id) || null;
  }, [cueUpgrades, selectedCue]);
  const cueLevels = useMemo(() => ({
    power: Math.max(0, Number(selectedCueUpgrade?.power || 0)),
    curve: Math.max(0, Number(selectedCueUpgrade?.curve || selectedCueUpgrade?.spin || 0)),
    luck: Math.max(0, Number(selectedCueUpgrade?.luck || 0)),
    aim: Math.max(0, Number(selectedCueUpgrade?.aim || 0)),
    control: Math.max(0, Number(selectedCueUpgrade?.control || 0)),
  }), [selectedCueUpgrade]);
  const previewFx = useMemo(() => poolUpgradeEffects(selectedCueUpgrade || {}), [selectedCueUpgrade]);
  const effPower = useMemo(
    () => Math.min(1, Math.max(0, Number(power || 0) * previewFx.power_mul)),
    [power, previewFx.power_mul],
  );
  const cueTotalLevel = useMemo(
    () => Object.values(cueLevels).reduce((sum, n) => sum + Number(n || 0), 0),
    [cueLevels],
  );
  const milestoneCount = useMemo(
    () => Math.floor(cueTotalLevel / 25),
    [cueTotalLevel],
  );
  const previewLevel = cueLevels.aim;
  const previewTier = Math.min(4, Math.floor(previewLevel / 5));
  const previewSegmentBudget = 1 + previewTier;
  const previewDistance = 130 + (previewLevel * 9) + (cueLevels.aim * 2.5);
  const objectRailSegmentCap = Math.min(12, 1 + previewTier * 2 + Math.floor(previewLevel / 7));
  const currentSkin = TABLE_SKINS[tableSkin] || TABLE_SKINS.miniclip_blue;
  const playerBallTrackers = useMemo(() => {
    const ballsByNum = new Map((displayBalls || []).map((b) => [Number(b.number), b]));
    return (activeGame?.players || []).map((p) => {
      const group = p?.group;
      const targets = group === 'solid'
        ? [1, 2, 3, 4, 5, 6, 7]
        : group === 'stripe'
          ? [9, 10, 11, 12, 13, 14, 15]
          : [];
      const potted = targets.filter((n) => ballsByNum.get(n)?.pocketed).length;
      return {
        userId: p?.user_id,
        group,
        targets,
        potted,
        left: Math.max(0, targets.length - potted),
      };
    });
  }, [activeGame?.players, displayBalls]);
  const aimPreview = useMemo(() => {
    const cue = displayBalls.find((b) => b.number === 0 && !b.pocketed);
    if (!cue || !canAim) return { segments: [], ghost: null, objectLineWidth: 1.55 };
    const w = POOL_CANVAS_W;
    const h = POOL_CANVAS_H;
    const m = PREVIEW_TABLE_MARGIN;
    const fw = w - 2 * m;
    const fh = h - 2 * m;
    const pxPerMeter = (fw / TABLE_W + fh / TABLE_H) / 2;
    const a = (Number(angleDeg || 0) * Math.PI) / 180;
    const objectLineWidth = 1.55 + (previewTier * 0.52) + Math.min(2.85, previewLevel * 0.05);
    const maxCuePathPx = previewDistance + (Number(power || 0) * 120);
    const maxObjectPathPx = 90 + (previewLevel * 14) + (previewTier * 48) + (Number(effPower || 0) * 95);

    const sim = simulatePreview(displayBalls, a, Number(effPower || power || 0), Number(spinX || 0), Number(spinY || 0));

    const toSeg = (x1t, y1t, x2t, y2t, kind, lw) => {
      const o = {
        x1: tableToCanvasX(x1t, w),
        y1: tableToCanvasY(y1t, h),
        x2: tableToCanvasX(x2t, w),
        y2: tableToCanvasY(y2t, h),
        kind,
      };
      if (typeof lw === 'number') o.lineWidth = lw;
      return o;
    };

    const segs = [];
    let ghost = null;

    // Build cue-ball path segments (limited by upgrade-gated preview distance).
    const cueMax = maxCuePathPx / pxPerMeter;
    let cueDist = 0;
    for (let i = 1; i < sim.cuePath.length && cueDist < cueMax; i++) {
      const p0 = sim.cuePath[i - 1];
      const p1 = sim.cuePath[i];
      const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (segLen < 1e-7) continue;
      const remaining = cueMax - cueDist;
      if (segLen <= remaining) {
        segs.push(toSeg(p0.x, p0.y, p1.x, p1.y, 'path'));
        cueDist += segLen;
      } else {
        const frac = remaining / segLen;
        segs.push(toSeg(p0.x, p0.y, p0.x + (p1.x - p0.x) * frac, p0.y + (p1.y - p0.y) * frac, 'path'));
        cueDist = cueMax;
      }
    }

    // Build object-ball path segments.
    if (sim.objectPath && sim.objectPath.length > 1) {
      const objMax = maxObjectPathPx / pxPerMeter;
      let objDist = 0;
      for (let i = 1; i < sim.objectPath.length && objDist < objMax; i++) {
        const p0 = sim.objectPath[i - 1];
        const p1 = sim.objectPath[i];
        const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (segLen < 1e-7) continue;
        const remaining = objMax - objDist;
        if (segLen <= remaining) {
          segs.push(toSeg(p0.x, p0.y, p1.x, p1.y, 'object', objectLineWidth));
          objDist += segLen;
        } else {
          const frac = remaining / segLen;
          segs.push(toSeg(p0.x, p0.y, p0.x + (p1.x - p0.x) * frac, p0.y + (p1.y - p0.y) * frac, 'object', objectLineWidth));
          objDist = objMax;
        }
      }
      ghost = {
        x: tableToCanvasX(sim.objectPath[0].x, w),
        y: tableToCanvasY(sim.objectPath[0].y, h),
        objectX: tableToCanvasX(sim.objectPath[0].x, w),
        objectY: tableToCanvasY(sim.objectPath[0].y, h),
      };
    }

    return { segments: segs, ghost, objectLineWidth };
  }, [displayBalls, angleDeg, power, effPower, spinX, spinY, canAim, previewDistance, previewTier, previewLevel]);

  useEffect(() => {
    const skinByCue = (selectedCue?.cue_id || '').toLowerCase();
    if (skinByCue.includes('legacy') || (profile?.rating || 0) >= 1200) setTableSkin('royal_teal_gold');
    else if (skinByCue.includes('street')) setTableSkin('classic_green');
    else setTableSkin('miniclip_blue');
  }, [selectedCue?.cue_id, profile?.rating]);

  const playShotReplay = useCallback((gameData, setGameState) => {
    const replay = gameData?.table_state?.last_shot_replay;
    const shotCount = Number(gameData?.table_state?.last_shot_replay_shot_count || 0);
    const frames = Array.isArray(replay?.frames) ? replay.frames : [];
    if (!frames.length || replayLastShotRef.current === shotCount) {
      setGameState(gameData || null);
      return;
    }
    replayLastShotRef.current = shotCount;
    setReplayActive(true);
    setIsAiming(false);
    if (replayAnimRef.current) cancelAnimationFrame(replayAnimRef.current);
    const start = performance.now();
    const duration = Math.max(1, Number(replay?.duration_ms || 1));
    const events = Array.isArray(replay?.events) ? replay.events : [];
    const firstImpactMs = events
      .filter((ev) => ev?.type === 'collision' || ev?.type === 'rail' || ev?.type === 'pocket')
      .reduce((min, ev) => Math.min(min, Number(ev?.t_ms || Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
    const hasImpactWindow = Number.isFinite(firstImpactMs) && firstImpactMs < Number.MAX_SAFE_INTEGER;
    let lastFrameIdx = -1;

    const pushFrameFx = (toIdx) => {
      for (let i = lastFrameIdx + 1; i <= toIdx; i += 1) {
        if (i < 0 || i >= frames.length) continue;
        const tMs = Number(frames[i]?.t_ms || 0);
        for (const ev of events) {
          if (Number(ev?.t_ms || 0) !== tMs) continue;
          if (ev?.type === 'collision') {
            const cx = tableToCanvasX(ev?.x, POOL_CANVAS_W);
            const cy = tableToCanvasY(ev?.y, POOL_CANVAS_H);
            fxRef.current.impacts.push({ x: cx, y: cy, at: Date.now() });
            playSfx('collision', Number(ev?.strength || 0.1));
          } else if (ev?.type === 'rail') {
            playSfx('rail', Number(ev?.strength || 0.1));
          } else if (ev?.type === 'pocket') {
            fxRef.current.pockets.push({ number: Number(ev?.number || 0), at: Date.now() });
            fxRef.current.pocketDrops.push({
              number: Number(ev?.number || 0),
              x: tableToCanvasX(ev?.x, POOL_CANVAS_W),
              y: tableToCanvasY(ev?.y, POOL_CANVAS_H),
              at: Date.now(),
            });
            playSfx('pocket', 1);
          }
        }
      }
      lastFrameIdx = toIdx;
    };

    const tick = (now) => {
      const elapsed = now - start;
      const targetMs = Math.min(duration, elapsed);
      let idx = 0;
      while (idx + 1 < frames.length && Number(frames[idx + 1]?.t_ms || 0) <= targetMs) idx += 1;
      pushFrameFx(idx);
      const current = Array.isArray(frames[idx]?.balls) ? frames[idx].balls : [];
      const next = Array.isArray(frames[idx + 1]?.balls) ? frames[idx + 1].balls : current;
      const frameA = Number(frames[idx]?.t_ms || 0);
      const frameB = Number(frames[idx + 1]?.t_ms || frameA + Number(replay?.frame_dt_ms || 16));
      const span = Math.max(1, frameB - frameA);
      const alpha = Math.max(0, Math.min(1, (targetMs - frameA) / span));
      const byId = new Map(next.map((b) => [b.id, b]));
      const interpolated = current.map((b) => {
        const nb = byId.get(b.id);
        if (!nb || b.pocketed || nb.pocketed) return { ...b };
        const bIsCue = Number(b?.number) === 0;
        const beforeFirstImpact = hasImpactWindow && targetMs < firstImpactMs;
        if (beforeFirstImpact && !bIsCue) {
          return { ...b, vx: 0, vy: 0 };
        }
        const fromX = Number(b.x || 0);
        const fromY = Number(b.y || 0);
        const toX = Number(nb.x || 0);
        const toY = Number(nb.y || 0);
        const fromVx = Number(b.vx || 0);
        const fromVy = Number(b.vy || 0);
        const toVx = Number(nb.vx || 0);
        const toVy = Number(nb.vy || 0);
        const px = fromX + (toX - fromX) * alpha;
        const py = fromY + (toY - fromY) * alpha;
        const pvx = fromVx + (toVx - fromVx) * alpha;
        const pvy = fromVy + (toVy - fromVy) * alpha;
        const tinyPos = Math.abs(px - fromX) < REPLAY_IDLE_POS_EPS && Math.abs(py - fromY) < REPLAY_IDLE_POS_EPS;
        const tinyVel = Math.abs(pvx) < REPLAY_IDLE_VEL_EPS && Math.abs(pvy) < REPLAY_IDLE_VEL_EPS;
        if (tinyPos && tinyVel) {
          return { ...b, vx: 0, vy: 0 };
        }
        return {
          ...b,
          x: px,
          y: py,
          vx: pvx,
          vy: pvy,
        };
      });
      if (interpolated.length) setDisplayBalls(interpolated);
      if (elapsed < duration) {
        replayAnimRef.current = requestAnimationFrame(tick);
        return;
      }
      const finalBalls = Array.isArray(frames[frames.length - 1]?.balls) ? frames[frames.length - 1].balls.map((b) => ({ ...b })) : [];
      if (finalBalls.length) {
        setDisplayBalls(finalBalls);
        lastTargetBallsRef.current = finalBalls;
      }
      setGameState(gameData || null);
      setReplayActive(false);
    };

    replayAnimRef.current = requestAnimationFrame(tick);
  }, [playSfx]);

  const fetchCues = useCallback(async () => {
    const [catalogRes, myRes, profileRes] = await Promise.all([
      api.get('/casino/mp-8ball/cues/catalog'),
      api.get('/casino/mp-8ball/cues/me'),
      api.get('/casino/mp-8ball/profile'),
    ]);
    setCatalog(catalogRes.data?.catalog || []);
    setMyCues(myRes.data?.owned || []);
    setCueUpgrades(myRes.data?.upgrades || []);
    setUpgradeTotalCap(Number(myRes.data?.upgrade_total_cap || 250));
    setUpgradeStatCap(Number(myRes.data?.upgrade_stat_cap || 50));
    setProfile(profileRes.data || null);
  }, []);

  const fetchPvpLobbies = useCallback(async () => {
    try {
      const res = await api.get('/casino/mp-8ball/games');
      setLobbies(res.data?.games || []);
    } catch (e) {
      setLobbies([]);
    }
  }, []);

  const fetchAiGame = useCallback(async () => {
    try {
      const res = await api.get('/casino/mp-8ball/vs-ai/game');
      if (replayActiveRef.current) return;
      const nextGame = res.data || null;
      const replayShot = Number(nextGame?.table_state?.last_shot_replay_shot_count || 0);
      if (replayShot && replayShot !== replayLastShotRef.current) {
        playShotReplay(nextGame, setAiGame);
      } else {
        setAiGame(nextGame);
      }
    } catch (_) {
      if (!replayActiveRef.current) setAiGame(null);
    }
  }, [playShotReplay]);

  const fetchPvpGame = useCallback(async () => {
    if (!pvpGame?.id) return;
    try {
      const res = await api.get(`/casino/mp-8ball/games/${encodeURIComponent(pvpGame.id)}`);
      if (replayActiveRef.current) return;
      const nextGame = res.data || null;
      const replayShot = Number(nextGame?.table_state?.last_shot_replay_shot_count || 0);
      if (replayShot && replayShot !== replayLastShotRef.current) {
        playShotReplay(nextGame, setPvpGame);
      } else {
        setPvpGame(nextGame);
      }
    } catch (e) {
      if (e?.response?.status === 404 && !replayActiveRef.current) setPvpGame(null);
    }
  }, [playShotReplay, pvpGame?.id]);

  const pointerToKitchen = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const sy = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const tx = canvasToTableX(sx, canvas.width);
    const ty = canvasToTableY(sy, canvas.height);
    const kb = activeGame?.table_state?.break_kitchen;
    const minX = kb ? Number(kb.min_x) : BALL_R;
    const maxX = kb ? Number(kb.max_x) : TABLE_HEAD_STRING_X - BALL_R * 2;
    const minY = kb ? Number(kb.min_y) : BALL_R;
    const maxY = kb ? Number(kb.max_y) : TABLE_H - BALL_R;
    return {
      x: Math.max(minX, Math.min(maxX, tx)),
      y: Math.max(minY, Math.min(maxY, ty)),
    };
  }, [activeGame?.table_state?.break_kitchen]);

  const placeBreakCue = useCallback(async (x, y) => {
    if (!activeGame?.id) return;
    setBusy(true);
    try {
      const payload = { x, y };
      if (tab === 'ai') {
        await api.post('/casino/mp-8ball/vs-ai/break-cue', payload);
        await fetchAiGame();
      } else {
        await api.post(`/casino/mp-8ball/games/${encodeURIComponent(activeGame.id)}/break-cue`, payload);
        await fetchPvpGame();
      }
      toast.success('Cue placed — shoot to break');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Placement failed');
    } finally {
      setBusy(false);
    }
  }, [activeGame?.id, tab, fetchAiGame, fetchPvpGame]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchCues(), fetchPvpLobbies(), fetchAiGame()]);
      } catch (e) {
        toast.error(getApiErrorMessage(e) || 'Failed to load 8-ball pool');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [fetchAiGame, fetchCues, fetchPvpLobbies]);

  useEffect(() => {
    const id = setInterval(() => {
      if (tab === 'ai') fetchAiGame();
      else {
        fetchPvpLobbies();
        fetchPvpGame();
      }
    }, 1400);
    return () => clearInterval(id);
  }, [tab, fetchAiGame, fetchPvpGame, fetchPvpLobbies]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const playL = PREVIEW_TABLE_MARGIN;
    const playT = PREVIEW_TABLE_MARGIN;
    const playR = w - PREVIEW_TABLE_MARGIN;
    const playB = h - PREVIEW_TABLE_MARGIN;
    const cushionClrs = currentSkin.cushion || [currentSkin.felt[2], currentSkin.felt[1], currentSkin.rail[0]];
    const wood = ctx.createLinearGradient(0, 0, w, h);
    wood.addColorStop(0, currentSkin.rail[0]);
    wood.addColorStop(0.45, currentSkin.rail[1] || currentSkin.rail[0]);
    wood.addColorStop(1, currentSkin.rail[2] || currentSkin.rail[1]);
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, w, h);
    if (currentSkin.railHighlight) {
      ctx.strokeStyle = currentSkin.railHighlight;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    }

    const cushGrad = ctx.createLinearGradient(0, playT, 0, playB);
    cushGrad.addColorStop(0, cushionClrs[0]);
    cushGrad.addColorStop(0.5, cushionClrs[1] || cushionClrs[0]);
    cushGrad.addColorStop(1, cushionClrs[2] || cushionClrs[0]);
    ctx.fillStyle = cushGrad;
    ctx.fillRect(6, 6, w - 12, h - 12);

    const felt = ctx.createRadialGradient(w * 0.5, h * 0.38, w * 0.06, w * 0.52, h * 0.5, w * 0.95);
    felt.addColorStop(0, currentSkin.felt[0]);
    felt.addColorStop(0.42, currentSkin.felt[1]);
    felt.addColorStop(1, currentSkin.feltEdge || currentSkin.felt[2]);
    ctx.fillStyle = felt;
    ctx.fillRect(playL, playT, playR - playL, playB - playT);
    if (feltTextureRef.current) {
      const feltPattern = ctx.createPattern(feltTextureRef.current, 'repeat');
      if (feltPattern) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(playL, playT, playR - playL, playB - playT);
        ctx.clip();
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = feltPattern;
        ctx.fillRect(playL, playT, playR - playL, playB - playT);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (let yy = playT; yy < playB; yy += 5) {
      ctx.beginPath();
      ctx.moveTo(playL, yy);
      ctx.lineTo(playR, yy);
      ctx.stroke();
    }
    ctx.restore();

    const baulkX = playL + (playR - playL) * 0.22;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(baulkX, playT + 4);
    ctx.lineTo(baulkX, playB - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(playL + 2, playT + 2, playR - playL - 4, playB - playT - 4);
    if (railTextureRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.drawImage(railTextureRef.current, 0, 0, w, 18);
      ctx.drawImage(railTextureRef.current, 0, h - 18, w, 18);
      ctx.translate(0, h);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(railTextureRef.current, 0, 0, h, 18);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(w, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(railTextureRef.current, 0, -18, h, 18);
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    const studFill = currentSkin.stud || currentSkin.accent;
    const studStroke = currentSkin.studStroke || 'rgba(0,0,0,0.35)';
    const studsX = [w * 0.25, w * 0.5, w * 0.75];
    const studsY = [h * 0.25, h * 0.5, h * 0.75];
    const drawStud = (sx, sy) => {
      ctx.beginPath();
      ctx.arc(sx, sy, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = studFill;
      ctx.fill();
      ctx.strokeStyle = studStroke;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx - 0.8, sy - 0.8, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fill();
    };
    for (const sx of studsX) {
      drawStud(sx, 10);
      drawStud(sx, h - 10);
    }
    for (const sy of studsY) {
      drawStud(10, sy);
      drawStud(w - 10, sy);
    }

    const feltW = playR - playL;
    const tcx = tableToCanvasX(TABLE_W * 0.5, w);
    const tcy = tableToCanvasY(TABLE_H * 0.5, h);
    for (let pi = 0; pi < POCKET_CENTERS_TABLE.length; pi += 1) {
      const { x: tx, y: ty, r: pkR } = POCKET_CENTERS_TABLE[pi];
      const pr = pkR * (feltW / TABLE_W);
      const px = tableToCanvasX(tx, w);
      const py = tableToCanvasY(ty, h);
      const isMidShortRail = pi === 1 || pi === 4;
      const rot = isMidShortRail ? 0 : Math.atan2(tcy - py, tcx - px);
      const cornerMul = isMidShortRail ? 1 : 1.36;
      const rx = pr * 1.22 * cornerMul;
      const ry = pr * 1.08 * cornerMul;
      const rGrad = Math.max(rx, ry);
      const pocketGrad = ctx.createRadialGradient(px, py, 2, px, py, rGrad + 8);
      pocketGrad.addColorStop(0, currentSkin.pocket[0]);
      pocketGrad.addColorStop(0.55, currentSkin.pocket[1]);
      pocketGrad.addColorStop(1, '#000000');
      ctx.beginPath();
      ctx.ellipse(px, py, rx + 2.2, ry + 2.2, rot, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,8,12,0.96)';
      ctx.fill();
      const rimGrad = ctx.createLinearGradient(px - rx, py - ry, px + rx, py + ry);
      const rimA = currentSkin.pocketRim || 'rgba(30,64,120,0.5)';
      rimGrad.addColorStop(0, rimA);
      rimGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.beginPath();
      ctx.ellipse(px, py, rx + 0.9, ry + 0.9, rot, 0, Math.PI * 2);
      ctx.strokeStyle = rimGrad;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      const innerFrac = isMidShortRail ? 0.45 : 0.56;
      const innerHoleRx = Math.max(rx * innerFrac, rx - 3.5);
      const innerHoleRy = Math.max(ry * innerFrac, ry - 3.5);
      ctx.beginPath();
      ctx.ellipse(px, py, innerHoleRx, innerHoleRy, rot, 0, Math.PI * 2);
      ctx.fillStyle = pocketGrad;
      ctx.fill();
      // Cushion throat (rubber ring into the pocket — reads as jaws before the drop).
      const cushionOuter = 'rgba(28,72,48,0.95)';
      const cushionInner = 'rgba(12,38,26,0.92)';
      ctx.beginPath();
      ctx.ellipse(px, py, innerHoleRx + 1.4, innerHoleRy + 1.4, rot, 0, Math.PI * 2);
      ctx.strokeStyle = cushionOuter;
      ctx.lineWidth = 3.1;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px, py, innerHoleRx + 0.35, innerHoleRy + 0.35, rot, 0, Math.PI * 2);
      ctx.strokeStyle = cushionInner;
      ctx.lineWidth = 1.35;
      ctx.stroke();
      // Jaw highlights — toward table center (same basis for corners & middle).
      const dcx = tcx - px;
      const dcy = tcy - py;
      const dlen = Math.hypot(dcx, dcy) || 1;
      const ix = dcx / dlen;
      const iy = dcy / dlen;
      const perpX = -iy;
      const perpY = ix;
      const jm = Math.max(innerHoleRx, innerHoleRy) * 0.85;
      ctx.beginPath();
      ctx.arc(px + ix * jm * 0.62, py + iy * jm * 0.62, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(190,228,200,0.26)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px + ix * jm * 0.48 + perpX * jm * 0.38, py + iy * jm * 0.48 + perpY * jm * 0.38, 1.7, 0, Math.PI * 2);
      ctx.arc(px + ix * jm * 0.48 - perpX * jm * 0.38, py + iy * jm * 0.48 - perpY * jm * 0.38, 1.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(210,240,220,0.2)';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(px, py, Math.max(rx * 0.42, innerHoleRx - 0.5), Math.max(ry * 0.42, innerHoleRy - 0.5), rot, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const kb = activeGame?.table_state?.break_kitchen;
    if (awaitingBreak) {
      const minX = kb ? Number(kb.min_x) : BALL_R;
      const maxX = kb ? Number(kb.max_x) : TABLE_HEAD_STRING_X - BALL_R * 2;
      const minY = kb ? Number(kb.min_y) : BALL_R;
      const maxY = kb ? Number(kb.max_y) : TABLE_H - BALL_R;
      const x1 = tableToCanvasX(minX, w);
      const x2 = tableToCanvasX(maxX, w);
      const y1 = tableToCanvasY(minY, h);
      const y2 = tableToCanvasY(maxY, h);
      ctx.save();
      ctx.fillStyle = 'rgba(251,191,36,0.07)';
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 3.2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeStyle = 'rgba(251,191,36,0.78)';
      ctx.lineWidth = 1.65;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Balls — clip to felt so spheres never paint on cushions/rail art; radii use X/Y table scales.
    ctx.save();
    ctx.beginPath();
    ctx.rect(playL, playT, playR - playL, playB - playT);
    ctx.clip();

    for (const b of ballsForRender) {
      if (b.pocketed) continue;
      const x = tableToCanvasX(b.x, w);
      const y = tableToCanvasY(b.y, h);
      const { rx, ry } = ballRadiiPx(w, h);
      const rm = Math.max(rx, ry);
      let color = '#ffffff';
      if (b.number === 8) color = '#111111';
      else if (Object.prototype.hasOwnProperty.call(BALL_COLOR_MAP, b.number)) color = BALL_COLOR_MAP[b.number];
      else if (b.number === 0) color = '#ffffff';

      // High-speed trail.
      const vx = Number(b.vx || 0);
      const vy = Number(b.vy || 0);
      const speed = Math.hypot(vx, vy);
      const travelDir = speed > 0.008 ? Math.atan2(vy, vx) : 0;
      const rollSpin = renderTick * (0.052 + speed * 2.6) + (Number(b.number) || 0) * 0.29;
      // Ground shadow — flat under the ball (reads as rolling on felt, not hovering).
      ctx.save();
      if (speed > 0.02) {
        ctx.translate(x, y + ry * 0.34);
        ctx.rotate(travelDir);
        ctx.scale(1, 0.38 + Math.min(0.12, speed * 0.06));
        const gsh = ctx.createRadialGradient(0, 0, 0, 0, 0, rm * 1.12);
        gsh.addColorStop(0, 'rgba(0,0,0,0.5)');
        gsh.addColorStop(0.55, 'rgba(0,0,0,0.2)');
        gsh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * 1.08, ry * 0.52, 0, 0, Math.PI * 2);
        ctx.fillStyle = gsh;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.ellipse(x, y + ry * 0.34, rx * 1.02, ry * 0.36, 0, 0, Math.PI * 2);
        const sh = ctx.createRadialGradient(x, y + ry * 0.28, rm * 0.02, x, y + ry * 0.34, rm * 1.15);
        sh.addColorStop(0, 'rgba(0,0,0,0.44)');
        sh.addColorStop(0.5, 'rgba(0,0,0,0.16)');
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fill();
      }
      ctx.restore();

      // Base sphere.
      const ballGrad = ctx.createRadialGradient(x - rx * 0.38, y - ry * 0.42, rm * 0.18, x, y, rm * 1.08);
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.2, b.number === 0 ? '#f8fafc' : color);
      ballGrad.addColorStop(0.8, b.number === 8 ? '#050505' : color);
      ballGrad.addColorStop(1, b.number === 8 ? '#000000' : '#111827');
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();

      // Cloth contact shading on lower hemisphere (ball sitting on table).
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      const contactShade = ctx.createLinearGradient(x, y - ry * 0.4, x, y + ry * 1.05);
      contactShade.addColorStop(0, 'rgba(0,0,0,0)');
      contactShade.addColorStop(0.72, 'rgba(0,0,0,0)');
      contactShade.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = contactShade;
      ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
      ctx.restore();

      // Stripe layer — rotate with roll so the band visibly spins.
      if (b.kind === 'stripe') {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();
        const bandRot = speed > 0.008 ? rollSpin - travelDir : 0;
        ctx.translate(x, y);
        ctx.rotate(bandRot);
        ctx.translate(-x, -y);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
        ctx.fillStyle = color;
        ctx.fillRect(x - rx, y - ry * 0.4, rx * 2, ry * 0.8);
        ctx.restore();
      }

      // Number circle — spins with the ball (full band match on stripes, slightly softer on solids).
      if (b.number !== 0) {
        ctx.save();
        if (speed > 0.008) {
          const numRot = b.kind === 'stripe' ? (rollSpin - travelDir) : (rollSpin - travelDir) * 0.62;
          ctx.translate(x, y);
          ctx.rotate(numRot);
          ctx.translate(-x, -y);
        }
        ctx.beginPath();
        ctx.ellipse(x, y, rx * 0.43, ry * 0.43, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.font = `700 ${Math.max(8, rm * 0.78)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.number), x, y);
        ctx.beginPath();
        ctx.ellipse(x, y, rx * 0.43, ry * 0.43, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(17,24,39,0.85)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }

      // Specular: fixed when idle; orbits with speed so light rolls around the sphere.
      const moving = speed > 0.01;
      let hx;
      let hy;
      let hiR = rm * 0.2;
      if (moving) {
        const orbit = travelDir - Math.PI / 2 + rollSpin * 0.72;
        hx = x + Math.cos(orbit) * rx * 0.34;
        hy = y + Math.sin(orbit) * ry * 0.34;
        hiR = rm * (0.17 + Math.min(0.06, speed * 0.04));
        ctx.beginPath();
        ctx.arc(hx, hy, hiR, 0, Math.PI * 2);
        const gl = ctx.createRadialGradient(hx - hiR * 0.3, hy - hiR * 0.3, 0, hx, hy, hiR * 1.2);
        gl.addColorStop(0, 'rgba(255,255,255,0.72)');
        gl.addColorStop(0.55, 'rgba(255,255,255,0.22)');
        gl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gl;
        ctx.fill();
        const orbit2 = orbit + Math.PI * 0.85;
        const hx2 = x + Math.cos(orbit2) * rx * 0.26;
        const hy2 = y + Math.sin(orbit2) * ry * 0.26;
        ctx.beginPath();
        ctx.arc(hx2, hy2, rm * 0.09, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
      } else {
        hx = x - rx * 0.22;
        hy = y - ry * 0.24;
        ctx.beginPath();
        ctx.arc(hx, hy, rm * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.fill();
      }
    }
    ctx.restore();

    const cuePlace = ballsForRender.find((b) => b.number === 0 && !b.pocketed);
    if (cuePlace && inBreakPlacement && canRenderCue) {
      const pcx = tableToCanvasX(cuePlace.x, w);
      const pcy = tableToCanvasY(cuePlace.y, h);
      const placeRingR = Math.max(10, ballRadiusMax(w, h) * 1.7);
      ctx.beginPath();
      ctx.arc(pcx, pcy, placeRingR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(251,191,36,0.92)';
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }

    // Aiming guide + cue stick.
    const cue = ballsForRender.find((b) => b.number === 0 && !b.pocketed);
    if (cue && canAim) {
      const cx = tableToCanvasX(cue.x, w);
      const cy = tableToCanvasY(cue.y, h);
      const cueVisualR = Math.max(10, ballRadiusMax(w, h) * 1.7);
      const a = (Number(angleDeg || 0) * Math.PI) / 180;
      const aimLen = 58 + Number(effPower || 0) * 200;
      const cueLen = 140;
      const ox = Math.cos(a);
      const oy = Math.sin(a);

      // Aim ring around cue ball (underlay + ring for contrast on felt).
      const ringW = isAiming ? 3.2 : 1.85;
      ctx.beginPath();
      ctx.arc(cx, cy, cueVisualR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = ringW + 2.4;
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, cueVisualR, 0, Math.PI * 2);
      ctx.strokeStyle = isAiming ? 'rgba(34,197,94,0.96)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = ringW;
      ctx.shadowColor = isAiming ? 'rgba(34,197,94,0.45)' : 'transparent';
      ctx.shadowBlur = isAiming ? 7 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Multi-segment preview: dark underlay + bright stroke so paths read on busy felt.
      const segs = aimPreview?.segments || [];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (segs.length) {
        segs.forEach((seg, idx) => {
          const grad = ctx.createLinearGradient(seg.x1, seg.y1, seg.x2, seg.y2);
          let lw;
          let dash;
          if (seg.kind === 'object') {
            grad.addColorStop(0, 'rgba(255,255,255,0.98)');
            grad.addColorStop(1, 'rgba(226,232,240,0.55)');
            dash = [];
            lw = typeof seg.lineWidth === 'number' ? seg.lineWidth : (aimPreview?.objectLineWidth || 2.1);
          } else if (seg.kind === 'cue_deflect') {
            grad.addColorStop(0, 'rgba(253,224,71,0.95)');
            grad.addColorStop(1, 'rgba(253,224,71,0.35)');
            dash = [6, 5];
            lw = 2.35;
          } else if (seg.kind === 'contact') {
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(1, 'rgba(186,230,253,0.75)');
            dash = [];
            lw = 2.85;
          } else {
            grad.addColorStop(0, idx === 0 ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.72)');
            grad.addColorStop(1, idx === 0 ? 'rgba(224,242,254,0.55)' : 'rgba(255,255,255,0.28)');
            dash = idx === 0 ? [] : [6, 5];
            lw = idx === 0 ? 3.15 : 2.05;
          }
          ctx.setLineDash(dash);
          ctx.beginPath();
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.strokeStyle = 'rgba(0,0,0,0.42)';
          ctx.lineWidth = lw + 2.8;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.strokeStyle = grad;
          ctx.lineWidth = lw;
          ctx.stroke();
          ctx.setLineDash([]);
        });
      } else {
        const gx = cx + ox * Math.min(aimLen, 170);
        const gy = cy + oy * Math.min(aimLen, 170);
        ctx.setLineDash([6, 7]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(gx, gy);
        ctx.strokeStyle = 'rgba(0,0,0,0.38)';
        ctx.lineWidth = 4.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(gx, gy);
        ctx.strokeStyle = isAiming ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2.35;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(gx, gy, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(gx, gy, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
      }
      if (aimPreview?.ghost) {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(aimPreview.ghost.x, aimPreview.ghost.y, 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(aimPreview.ghost.x, aimPreview.ghost.y, 6.2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1.85;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(aimPreview.ghost.x, aimPreview.ghost.y, 5.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(aimPreview.ghost.objectX, aimPreview.ghost.objectY, 5.2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.38)';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(aimPreview.ghost.objectX, aimPreview.ghost.objectY, 4.8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(147,197,253,0.92)';
        ctx.lineWidth = 1.45;
        ctx.stroke();
      }

      const pullBack = Number(power || 0) * 60;
      const tipDist = 14 + pullBack;
      const buttDist = tipDist + cueLen;
      const tipX = cx - ox * tipDist;
      const tipY = cy - oy * tipDist;
      const buttX = cx - ox * buttDist;
      const buttY = cy - oy * buttDist;
      const cueGrad = ctx.createLinearGradient(buttX, buttY, tipX, tipY);
      cueGrad.addColorStop(0, '#fdf6e3');
      cueGrad.addColorStop(0.25, '#e8c88a');
      cueGrad.addColorStop(0.55, '#b8894a');
      cueGrad.addColorStop(0.82, '#6b4425');
      cueGrad.addColorStop(1, '#3d2314');
      if (cueTextureRef.current) {
        const cuePattern = ctx.createPattern(cueTextureRef.current, 'repeat');
        if (cuePattern) ctx.strokeStyle = cuePattern;
      }
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(buttX, buttY);
      ctx.lineTo(tipX, tipY);
      if (!cueTextureRef.current) ctx.strokeStyle = cueGrad;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 2;
      ctx.stroke();
      // Ferrule (white tip)
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + ox * 4, tipY + oy * 4);
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 6;
      ctx.shadowBlur = 0;
      ctx.stroke();
      // Tip (blue chalk)
      ctx.beginPath();
      ctx.arc(tipX + ox * 5, tipY + oy * 5, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      ctx.restore();
    }
    const now = Date.now();
    fxRef.current.pockets = fxRef.current.pockets.filter((f) => now - f.at < 450);
    for (const f of fxRef.current.pockets) {
      const alpha = 1 - ((now - f.at) / 450);
      const glowR = 18 + (1 - alpha) * 10;
      const pkGlow = ctx.createRadialGradient(f.x || w * 0.5, f.y || h * 0.5, 2, f.x || w * 0.5, f.y || h * 0.5, glowR);
      pkGlow.addColorStop(0, `rgba(34,197,94,${0.55 * alpha})`);
      pkGlow.addColorStop(0.6, `rgba(34,197,94,${0.15 * alpha})`);
      pkGlow.addColorStop(1, 'rgba(34,197,94,0)');
      ctx.fillStyle = pkGlow;
      ctx.fillRect(0, 0, w, h);
    }
    const dropDuration = 350;
    fxRef.current.pocketDrops = fxRef.current.pocketDrops.filter((f) => now - f.at < dropDuration);
    for (const f of fxRef.current.pocketDrops) {
      const t = (now - f.at) / dropDuration;
      const scale = Math.max(0, 1 - t * t);
      const alpha = Math.max(0, 1 - t);
      const r = ballRadiusMax(w, h) * scale;
      if (r < 0.5) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
      ctx.restore();
    }
    fxRef.current.impacts = fxRef.current.impacts.filter((f) => now - f.at < 300);
    for (const f of fxRef.current.impacts) {
      const alpha = 1 - ((now - f.at) / 300);
      const rad = 6 + (1 - alpha) * 18;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0,0,0,${0.4 * alpha})`;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [ballsForRender, angleDeg, power, effPower, spinX, spinY, isAiming, currentSkin, renderTick, canAim, canRenderCue, aimPreview, awaitingBreak, activeGame?.table_state?.break_kitchen, inBreakPlacement]);

  const hasActiveAiSession = Boolean(
    aiGame?.id && (aiGame.status === 'in_progress' || aiGame.status === 'waiting'),
  );

  const startAi = async () => {
    if (hasActiveAiSession) {
      toast.error('Finish or forfeit your current AI match first (Finish match / Leave).');
      return;
    }
    setBusy(true);
    const payload = {};
    try {
      const token = await getCaptchaToken();
      if (token) payload.captcha_token = token;
    } catch {
      setBusy(false);
      return;
    }
    try {
      const res = await api.post('/casino/mp-8ball/vs-ai/start', payload);
      setAiGame(res.data || null);
      setTab('ai');
      setPageTab('match');
      toast.success('AI match started');
    } catch (e) {
      const code = e?.response?.status;
      if (code === 409) {
        toast.error(getApiErrorMessage(e) || 'You already have an AI match. Finish or forfeit it first.');
        await fetchAiGame();
      } else {
        toast.error(getApiErrorMessage(e) || 'Failed to start AI game');
      }
    } finally {
      setBusy(false);
    }
  };

  const createPvp = async () => {
    setBusy(true);
    const body = { buy_in: Number(buyIn) || 0, rated: true, anonymous: false };
    try {
      const token = await getCaptchaToken();
      if (token) body.captcha_token = token;
    } catch {
      setBusy(false);
      return;
    }
    try {
      const res = await api.post('/casino/mp-8ball/games', body);
      setPvpGame(res.data || null);
      setTab('pvp');
      setPageTab('match');
      await fetchPvpLobbies();
      toast.success('Lobby created');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to create lobby');
    } finally {
      setBusy(false);
    }
  };

  const joinLobby = async (gid) => {
    setBusy(true);
    const body = {};
    try {
      const token = await getCaptchaToken();
      if (token) body.captcha_token = token;
    } catch {
      setBusy(false);
      return;
    }
    try {
      const res = await api.post(`/casino/mp-8ball/games/${encodeURIComponent(gid)}/join`, body);
      setPvpGame(res.data || null);
      setPageTab('match');
      toast.success('Joined lobby');
      await fetchPvpLobbies();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to join');
    } finally {
      setBusy(false);
    }
  };

  const leaveLobby = async () => {
    if (!pvpGame?.id) return;
    const wasInProgress = pvpGame.status === 'in_progress';
    const waitingWithOpponent = pvpGame.status === 'waiting' && (pvpGame.players || []).length >= 2;
    const waitingSolo = pvpGame.status === 'waiting' && (pvpGame.players || []).length < 2;
    if (wasInProgress) {
      if (typeof window !== 'undefined' && !window.confirm('Forfeit this match? You lose (DNF) and your opponent wins.')) return;
    } else if (waitingWithOpponent) {
      if (typeof window !== 'undefined' && !window.confirm('Leave lobby? You forfeit — your opponent wins the pot. No buy-in refund.')) return;
    } else if (waitingSolo) {
      if (typeof window !== 'undefined' && !window.confirm('Leave lobby? Your buy-in is not refunded.')) return;
    }
    setBusy(true);
    try {
      await api.post(`/casino/mp-8ball/games/${encodeURIComponent(pvpGame.id)}/leave`);
      setPvpGame(null);
      if (wasInProgress) toast.success('You forfeited (DNF)');
      else if (waitingWithOpponent) toast.success('You forfeited — opponent wins the pot');
      else toast.success('Left lobby');
      await fetchPvpLobbies();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to leave');
    } finally {
      setBusy(false);
    }
  };

  const leaveAiMatch = async () => {
    if (!aiGame?.id) return;
    const wasInProgress = aiGame.status === 'in_progress';
    if (wasInProgress) {
      if (typeof window !== 'undefined' && !window.confirm('Forfeit this match? You lose (DNF).')) return;
    }
    setBusy(true);
    try {
      await api.post(`/casino/mp-8ball/games/${encodeURIComponent(aiGame.id)}/leave`);
      setAiGame(null);
      toast.success(wasInProgress ? 'You forfeited (DNF)' : 'Left match');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to leave match');
    } finally {
      setBusy(false);
    }
  };

  const finishMatch = async () => {
    if (!activeGame?.id || activeGame.status !== 'in_progress') return;
    if (typeof window !== 'undefined' && !window.confirm('Finish match? This counts as a loss (DNF).')) return;
    setBusy(true);
    try {
      await api.post(`/casino/mp-8ball/games/${encodeURIComponent(activeGame.id)}/leave`);
      if (tab === 'ai') {
        setAiGame(null);
        await fetchAiGame();
      } else {
        setPvpGame(null);
        await fetchPvpLobbies();
      }
      toast.success('Match ended — you forfeited (DNF)');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not finish match');
    } finally {
      setBusy(false);
    }
  };

  const readyLobby = async () => {
    if (!pvpGame?.id) return;
    setBusy(true);
    try {
      await api.post(`/casino/mp-8ball/games/${encodeURIComponent(pvpGame.id)}/ready`);
      await fetchPvpGame();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Ready failed');
    } finally {
      setBusy(false);
    }
  };

  const startLobby = async () => {
    if (!pvpGame?.id) return;
    setBusy(true);
    try {
      const res = await api.post(`/casino/mp-8ball/games/${encodeURIComponent(pvpGame.id)}/start`);
      setPvpGame(res.data || null);
      toast.success('Match started');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Start failed');
    } finally {
      setBusy(false);
    }
  };

  const shoot = async () => {
    if (!activeGame) return;
    if (busy) return;
    if (inBreakPlacement) return;
    if (!canAim || !ballsSettled) return;
    setBusy(true);
    try {
      const angle = (Number(angleDeg) * Math.PI) / 180;
      const cue = ballsForRender.find((b) => b.number === 0 && !b.pocketed);
      const canvas = canvasRef.current;
      if (cue && canvas) {
        const cx = tableToCanvasX(cue.x, canvas.width);
        const cy = tableToCanvasY(cue.y, canvas.height);
        fxRef.current.impacts.push({ x: cx, y: cy, at: Date.now() });
        playSfx('cue', Number(power || 0.6));
      }
      const payload = { angle, power: Number(power), spin_x: Number(spinX), spin_y: Number(spinY) };
      if (tab === 'ai') {
        const res = await api.post('/casino/mp-8ball/vs-ai/shoot', payload);
        playShotReplay(res.data || null, setAiGame);
      } else {
        const res = await api.post(`/casino/mp-8ball/games/${encodeURIComponent(activeGame.id)}/shoot`, payload);
        playShotReplay(res.data || null, setPvpGame);
      }
      setSpinX(0);
      setSpinY(0);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Shot failed');
    } finally {
      setBusy(false);
    }
  };

  const MAX_PULL_PX = 120;

  const getPointerOnCanvas = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      sx: ((event.clientX - rect.left) / rect.width) * canvas.width,
      sy: ((event.clientY - rect.top) / rect.height) * canvas.height,
      canvas,
    };
  };

  const updateAimAngle = (event) => {
    const ptr = getPointerOnCanvas(event);
    if (!ptr) return;
    const cue = ballsForRender.find((b) => b.number === 0 && !b.pocketed);
    if (!cue) return;
    const cx = tableToCanvasX(cue.x, ptr.canvas.width);
    const cy = tableToCanvasY(cue.y, ptr.canvas.height);
    const dx = ptr.sx - cx;
    const dy = ptr.sy - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const targetDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const damping = dist < 55 ? 0.4 : 0.65;
    setAngleDeg((prev) => prev + (targetDeg - prev) * damping);
  };

  const updatePullPower = (event) => {
    const ptr = getPointerOnCanvas(event);
    if (!ptr) return;
    const cue = ballsForRender.find((b) => b.number === 0 && !b.pocketed);
    if (!cue) return;
    const cx = tableToCanvasX(cue.x, ptr.canvas.width);
    const cy = tableToCanvasY(cue.y, ptr.canvas.height);
    const a = (Number(angleDeg || 0) * Math.PI) / 180;
    const behindX = ptr.sx - cx;
    const behindY = ptr.sy - cy;
    const pullDist = -(behindX * Math.cos(a) + behindY * Math.sin(a));
    const normalized = Math.max(0.02, Math.min(1, pullDist / MAX_PULL_PX));
    setPower(Math.pow(normalized, 0.9));
  };

  const updateSpinFromPad = useCallback((event) => {
    const target = event.currentTarget;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const size = Math.min(rect.width, rect.height);
    const cx = size / 2;
    const cy = size / 2;
    const visualRadius = size * 0.36;
    const dx = sx - cx;
    const dy = sy - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > visualRadius * 1.1) return;
    const clamped = Math.min(1, dist / visualRadius);
    const nx = dist > 1e-6 ? (dx / dist) * clamped : 0;
    const ny = dist > 1e-6 ? (dy / dist) * clamped : 0;
    setSpinX(Number(nx.toFixed(3)));
    setSpinY(Number((-ny).toFixed(3)));
  }, []);

  const buyCue = async (cueId) => {
    setCueBusy(true);
    try {
      await api.post('/casino/mp-8ball/cues/buy', { cue_id: cueId });
      toast.success('Cue purchased');
      await fetchCues();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Purchase failed');
    } finally {
      setCueBusy(false);
    }
  };

  const selectCue = async (cueInstanceId) => {
    setCueBusy(true);
    try {
      await api.post('/casino/mp-8ball/cues/select', { cue_instance_id: cueInstanceId });
      await fetchCues();
      toast.success('Cue selected');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Select failed');
    } finally {
      setCueBusy(false);
    }
  };

  const upgradeCue = async (stat) => {
    if (!selectedCue?.id) return;
    setCueBusy(true);
    try {
      const res = await api.post('/casino/mp-8ball/cues/upgrade', { cue_instance_id: selectedCue.id, stat });
      await fetchCues();
      const bal = res.data?.pool_cash_balance;
      toast.success(
        `${stat} +1${typeof bal === 'number' ? ` · Pool cash $${bal.toLocaleString()}` : ''}`,
      );
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Upgrade failed');
    } finally {
      setCueBusy(false);
    }
  };

  if (loading) {
    return (
      <>
        {captchaModal}
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Target size={22} className="text-primary/40 animate-pulse" />
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.2em]">Loading pool room...</span>
        </div>
      </>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="eight-ball-pool-page">
      {captchaModal}
      <style>{POOL_STYLES}</style>

      <header className="pool-fade-in text-center">
        <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">8-Ball Pool</h1>
        <p className="text-[10px] text-mutedForeground font-heading italic">WPA-style rules: call your group after the break, no upgrade “luck” on fouls or turns. {POOL_SHOT_CLOCK_SEC}s shot clock; forfeit = DNF loss.</p>
      </header>

      <div className="flex flex-wrap justify-center gap-2 pool-fade-in">
        <button type="button" onClick={() => setPageTab('match')} className={`px-3 py-1.5 rounded text-[10px] font-heading uppercase border ${pageTab === 'match' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-700 text-mutedForeground'}`}>Match</button>
        <button type="button" onClick={() => setPageTab('garage')} className={`px-3 py-1.5 rounded text-[10px] font-heading uppercase border ${pageTab === 'garage' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-700 text-mutedForeground'}`}>Cue garage</button>
      </div>

      {pageTab === 'match' && (
      <>
      <div className={`${styles.panel} mobile-panel rounded-md border border-primary/20 overflow-hidden pool-fade-in`}>
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
          <button type="button" onClick={() => setTab('ai')} className={`px-2 py-1 rounded text-[10px] font-heading uppercase border ${tab === 'ai' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-700 text-mutedForeground'}`}><Bot size={12} className="inline mr-1" />AI</button>
          <button type="button" onClick={() => setTab('pvp')} className={`px-2 py-1 rounded text-[10px] font-heading uppercase border ${tab === 'pvp' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-700 text-mutedForeground'}`}><Users size={12} className="inline mr-1" />PvP</button>
          <button type="button" onClick={() => setSfxEnabled((v) => !v)} className="ml-auto px-2 py-1 rounded text-[10px] border border-zinc-700 text-mutedForeground hover:text-foreground" title={sfxEnabled ? 'Mute effects' : 'Enable effects'}>
            {sfxEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
          </button>
          <button type="button" onClick={() => { fetchPvpLobbies(); fetchAiGame(); fetchPvpGame(); }} className="px-2 py-1 rounded text-[10px] border border-zinc-700 text-mutedForeground hover:text-foreground"><RefreshCw size={12} /></button>
        </div>
        <div className="p-3 space-y-3">
          {tab === 'ai' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={startAi}
                disabled={busy || cueBusy || hasActiveAiSession}
                title={hasActiveAiSession ? 'Finish or forfeit your current AI match first' : undefined}
                className="px-3 py-1.5 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? '...' : 'Start AI Match'}
              </button>
              {aiGame?.id && <span className="text-[10px] text-mutedForeground font-mono">Session: {aiGame.id}</span>}
              {hasActiveAiSession && (
                <span className="text-[10px] text-amber-400/90 max-w-[min(100%,220px)]">
                  Active match — use &quot;Finish match (lose)&quot; or leave to start another.
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input type="number" min={0} value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value || 0))} className="w-28 px-2 py-1 rounded border border-input bg-transparent text-xs" placeholder="Buy-in" />
                <button type="button" onClick={createPvp} disabled={busy || cueBusy} className="px-3 py-1.5 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading">{busy ? '...' : 'Create Lobby'}</button>
                {pvpGame?.id && <button type="button" onClick={leaveLobby} disabled={busy || cueBusy} className="px-3 py-1.5 rounded bg-red-500/20 border border-red-500/50 text-red-300 text-xs font-heading">Leave</button>}
                {pvpGame?.id && <button type="button" onClick={readyLobby} disabled={busy || cueBusy} className="px-3 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-heading">Ready</button>}
                {pvpGame?.id && <button type="button" onClick={startLobby} disabled={busy || cueBusy} className="px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-heading">Start</button>}
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {lobbies.length === 0 ? <p className="text-[10px] text-mutedForeground">No live lobbies.</p> : lobbies.map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center gap-2 p-1.5 rounded bg-zinc-900/40 border border-zinc-700/40">
                    <span className="text-[10px] text-foreground font-mono">{g.id}</span>
                    <span className="text-[10px] text-mutedForeground">{(g.players || []).length}/2 players</span>
                    <span className="text-[10px] text-mutedForeground">Pot: ${(g.pot || 0).toLocaleString()}</span>
                    <button type="button" onClick={() => joinLobby(g.id)} disabled={busy || cueBusy} className="ml-auto px-2 py-1 rounded border border-primary/40 text-primary text-[10px]">Join</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeGame && (
            <div className="space-y-2 xl:space-y-1.5">
              <div className="rounded-md border border-primary/20 bg-zinc-900/55 p-2 xl:p-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-heading">
                  {(activeGame.players || []).map((p, idx) => {
                    const isTurn = Number(activeGame.current_turn_index || 0) === idx;
                    return (
                      <div key={p.user_id} className={`px-2 py-1 rounded border ${isTurn ? 'border-primary/70 bg-primary/15 text-primary' : 'border-zinc-700/60 bg-zinc-800/35 text-foreground'}`}>
                        <span className="font-bold">{p.username}</span>
                        <span className="ml-2 text-mutedForeground">({groupBadge(p.group)})</span>
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap items-center gap-2 justify-between w-full min-w-[min(100%,220px)]">
                    <div className="px-2 py-1 rounded border border-zinc-700/60 bg-zinc-800/35 text-foreground flex-1 min-w-0">
                      Turn: <span className="font-bold text-primary">{turnLabel(activeGame)}</span>
                      {typeof activeGame.turn_seconds_left === 'number' && activeGame.phase === 'playing' && (
                        <span className="text-amber-300/90"> · {activeGame.turn_seconds_left}s</span>
                      )}
                      {' · '}{activeGame.status}/{activeGame.phase} · Shots {activeGame.table_state?.shot_count || 0} · {(replayActive || !ballsSettled) ? 'ROLLING' : inBreakPlacement ? 'PLACE CUE (KITCHEN)' : 'AIMING'}
                      {activeGame.status === 'completed' && activeGame.result_reason === 'dnf' && (
                        <span className="text-red-300/90"> · DNF</span>
                      )}
                    </div>
                    {activeGame.status === 'in_progress' && (
                      <button
                        type="button"
                        onClick={finishMatch}
                        disabled={busy || cueBusy || replayActive}
                        className="shrink-0 px-2.5 py-1 rounded border border-red-500/45 bg-red-500/15 text-red-200 text-[10px] font-heading uppercase tracking-wide hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Forfeit — counts as a loss (DNF)"
                      >
                        Finish match (lose)
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {playerBallTrackers.map((t, idx) => {
                    const player = (activeGame.players || [])[idx];
                    const isTurn = Number(activeGame.current_turn_index || 0) === idx;
                    return (
                      <div key={t.userId || idx} className={`rounded border px-2 py-1 ${isTurn ? 'border-primary/60 bg-primary/10' : 'border-zinc-700/50 bg-zinc-800/40'}`}>
                        <div className="flex items-center justify-between text-[10px] font-heading">
                          <span className="text-foreground">{player?.username || `Player ${idx + 1}`}</span>
                          <span className="text-mutedForeground">{groupBadge(t.group)} · Potted {t.potted} · Left {t.left}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {(t.targets.length ? t.targets : [1, 2, 3, 4, 5, 6, 7]).map((n) => {
                            const b = (displayBalls || []).find((x) => Number(x.number) === n);
                            const pocketed = !!b?.pocketed;
                            const color = BALL_COLOR_MAP[n] || '#cbd5e1';
                            const isStripe = n >= 9;
                            return (
                              <span
                                key={`${idx}-${n}`}
                                className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[8px] border ${pocketed ? 'opacity-20 border-zinc-700' : 'opacity-100 border-white/35'}`}
                                style={{
                                  background: isStripe
                                    ? `linear-gradient(180deg, #f8fafc 0%, #f8fafc 30%, ${color} 30%, ${color} 70%, #f8fafc 70%, #f8fafc 100%)`
                                    : color,
                                  color: n === 8 ? '#fff' : '#111',
                                }}
                                title={`Ball ${n}${pocketed ? ' (pocketed)' : ''}`}
                              >
                                {n}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="pool-table-wrap">
                <div className="pool-canvas-shell rounded-xl p-1.5 xl:p-1">
                <canvas
                  ref={canvasRef}
                  width={900}
                  height={450}
                  className="pool-canvas w-full rounded-lg border border-cyan-300/20 bg-[#0c1929] touch-none"
                  style={{ aspectRatio: '2 / 1', maxWidth: '100%' }}
                  onPointerDown={(e) => {
                    if (replayActive || !ballsSettled) return;
                    if (inBreakPlacement && canRenderCue) {
                      e.preventDefault();
                      const pos = pointerToKitchen(e);
                      if (pos) setBreakPreview(pos);
                      return;
                    }
                    if (!canAim) return;
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    setAimPhase('aiming');
                    setIsAiming(true);
                    updateAimAngle(e);
                  }}
                  onPointerMove={(e) => {
                    if (replayActive || !ballsSettled) return;
                    if (inBreakPlacement && canRenderCue) {
                      const pos = pointerToKitchen(e);
                      if (pos) setBreakPreview(pos);
                      return;
                    }
                    if (!canAim || !isAiming) return;
                    if (aimPhase === 'pulling') {
                      updatePullPower(e);
                    } else {
                      const ptr = getPointerOnCanvas(e);
                      if (ptr) {
                        const cb = ballsForRender.find((b) => b.number === 0 && !b.pocketed);
                        if (cb) {
                          const ccx = tableToCanvasX(cb.x, ptr.canvas.width);
                          const ccy = tableToCanvasY(cb.y, ptr.canvas.height);
                          const ang = (Number(angleDeg || 0) * Math.PI) / 180;
                          const behind = -((ptr.sx - ccx) * Math.cos(ang) + (ptr.sy - ccy) * Math.sin(ang));
                          if (behind > 10) {
                            setAimPhase('pulling');
                            updatePullPower(e);
                            return;
                          }
                        }
                      }
                      updateAimAngle(e);
                    }
                  }}
                  onPointerUp={async (e) => {
                    if (replayActive || !ballsSettled) return;
                    if (inBreakPlacement && canRenderCue) {
                      const pos = pointerToKitchen(e);
                      if (pos) await placeBreakCue(pos.x, pos.y);
                      setBreakPreview(null);
                      return;
                    }
                    if (!canAim || !isAiming) return;
                    setIsAiming(false);
                    if (aimPhase === 'pulling') {
                      setAimPhase('idle');
                      await shoot();
                    } else {
                      setAimPhase('idle');
                    }
                  }}
                  onPointerLeave={() => { setIsAiming(false); setAimPhase('idle'); }}
                />
                </div>
              </div>
              <div className="rounded-md border border-primary/20 bg-zinc-900/55 p-2 xl:p-1.5 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-heading">
                  <span className="text-mutedForeground uppercase">Force</span>
                  <span className="text-primary font-bold">{(Number(power || 0) * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded bg-zinc-800/70 border border-zinc-700/50 overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.max(3, Math.min(100, Number(power || 0) * 100))}%`,
                      background: `linear-gradient(90deg, ${currentSkin.felt[0]}, ${currentSkin.felt[1]}, ${currentSkin.rail[0]})`,
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                {(activeGame.players || []).map((p) => (
                  <div key={p.user_id} className="p-2 rounded bg-zinc-800/40 border border-zinc-700/40">
                    <div className="font-heading text-foreground font-bold">{p.username}</div>
                    <div className="text-mutedForeground">Group: {groupBadge(p.group)}</div>
                    <div className="text-mutedForeground">Fouls: {p.fouls || 0}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px]">
                <label className="space-y-1"><span className="text-mutedForeground">Table skin</span>
                  <select value={tableSkin} onChange={(e) => setTableSkin(e.target.value)} className="w-full px-2 py-1 rounded border border-input bg-transparent">
                    {Object.keys(TABLE_SKINS).map((k) => <option key={k} value={k}>{TABLE_SKINS[k].name}</option>)}
                  </select>
                </label>
                <div className="space-y-1">
                  <span className="text-mutedForeground">Spin</span>
                  <div className="flex items-center gap-2">
                    <div
                      className="relative w-14 h-14 rounded-full border border-zinc-500/70 bg-gradient-to-b from-zinc-100 to-zinc-300 shadow-inner cursor-pointer select-none touch-none"
                      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); updateSpinFromPad(e); }}
                      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture?.(e.pointerId) || (e.buttons & 1) === 1) updateSpinFromPad(e); }}
                      title="Drag marker to set spin"
                    >
                      <div className="absolute inset-[10%] rounded-full border border-zinc-400/60" />
                      <div
                        className="absolute w-3 h-3 rounded-full border border-red-100"
                        style={{
                          left: `calc(50% + ${Number(spinX || 0) * 18}px - 6px)`,
                          top: `calc(50% + ${-Number(spinY || 0) * 18}px - 6px)`,
                          backgroundColor: '#dc2626',
                          boxShadow: '0 0 0 2px rgba(220,38,38,0.35)',
                        }}
                      />
                    </div>
                    <button type="button" onClick={() => { setSpinX(0); setSpinY(0); }} className="px-2 py-1 rounded border border-zinc-700 text-mutedForeground hover:text-foreground text-[9px]">
                      Reset
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-w-[100px] text-[9px] text-mutedForeground leading-snug font-heading p-2 rounded bg-zinc-800/40 border border-zinc-700/30">
                  {inBreakPlacement
                    ? 'Tap the kitchen area to place the cue ball'
                    : canAim
                      ? <>
                          <span className="text-foreground font-bold">Aim:</span> Drag on felt.{' '}
                          <span className="text-foreground font-bold">Shoot:</span> Drag behind cue ball, pull back, release.
                        </>
                      : (replayActive || !ballsSettled)
                        ? 'Balls rolling...'
                        : 'Waiting for turn...'
                  }
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="pool-art-line text-primary mx-3" />
      </div>
      </>
      )}

      {pageTab === 'garage' && (
      <div className={`${styles.panel} mobile-panel rounded-md border border-primary/20 overflow-hidden pool-fade-in`}>
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
          <Zap size={13} className="text-primary" />
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Cue Garage & Upgrades</span>
        </div>
        <div className="p-3 space-y-3">
          {selectedCue && (
            <div className="space-y-3">
              <div className="text-[10px] font-heading p-3 rounded-lg border border-primary/25 bg-gradient-to-br from-zinc-900/85 to-zinc-950/95">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="text-[10px] text-primary font-bold uppercase tracking-wider">Active cue</div>
                    <div className="text-foreground font-bold">{selectedCue.cue_id}</div>
                  </div>
                  <div className="text-right text-[10px] tabular-nums">
                    <span className="text-mutedForeground">Pool cash </span>
                    <span className="text-emerald-400 font-bold">${(profile?.pool_cash ?? 0).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex justify-between text-[9px] text-mutedForeground mb-1">
                  <span>Total upgrades</span>
                  <span>{cueTotalLevel} / {upgradeTotalCap}</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-800 overflow-hidden border border-zinc-700/40">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (cueTotalLevel / Math.max(1, upgradeTotalCap)) * 100)}%`,
                      background: 'linear-gradient(90deg, rgba(8,145,178,0.95), rgba(34,211,238,0.75))',
                    }}
                  />
                </div>
                <div className="mt-2 text-[9px] text-mutedForeground">
                  Milestones {milestoneCount} · per-stat cap {upgradeStatCap}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {POOL_GARAGE_STATS.map(({ key, label, hint, Icon, color }) => {
                  const lvl = Number(cueLevels[key] || 0);
                  const nextCost = poolUpgradeCashCost(lvl, cueTotalLevel);
                  const cash = Number(profile?.pool_cash ?? 0);
                  const canAfford = cash >= nextCost;
                  const statMaxed = lvl >= upgradeStatCap;
                  const totalMaxed = cueTotalLevel >= upgradeTotalCap;
                  const disabled = cueBusy || statMaxed || totalMaxed || !canAfford;
                  let btnLabel = `Upgrade · $${nextCost.toLocaleString()}`;
                  if (statMaxed) btnLabel = 'Stat maxed';
                  else if (totalMaxed) btnLabel = 'Total cap';
                  else if (!canAfford) btnLabel = `Need $${nextCost.toLocaleString()}`;
                  return (
                    <div
                      key={key}
                      className="p-2.5 rounded-lg border border-zinc-700/55 bg-zinc-900/45 flex flex-col gap-1.5 hover:border-zinc-600/70 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10"
                            style={{ backgroundColor: `${color}22`, color }}
                          >
                            <Icon size={17} strokeWidth={2.1} />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[11px] font-heading font-bold text-foreground">{label}</div>
                            <div className="text-[9px] text-mutedForeground leading-snug">{hint}</div>
                          </div>
                        </div>
                        <span
                          className="text-[10px] font-heading tabular-nums shrink-0"
                          style={{ color: statMaxed ? 'rgb(161 161 170)' : color }}
                        >
                          {lvl}/{upgradeStatCap}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-800/90 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (lvl / Math.max(1, upgradeStatCap)) * 100)}%`,
                            backgroundColor: color,
                            opacity: 0.88,
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          upgradeCue(key);
                        }}
                        disabled={disabled}
                        className={`w-full px-2 py-1.5 rounded-md text-[10px] font-heading uppercase tracking-wide border ${
                          disabled
                            ? 'border-zinc-700/60 text-zinc-500 cursor-not-allowed bg-zinc-950/50'
                            : 'border-primary/45 text-primary bg-primary/12 hover:bg-primary/18'
                        }`}
                      >
                        {btnLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="text-[9px] text-mutedForeground font-heading px-0.5">
                Aim preview: tier {previewTier} · range {Math.round(previewDistance)}px
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {catalog.map((c) => {
              const owned = myCues.find((m) => m.cue_id === c.id);
              return (
                <div key={c.id} className="p-2 rounded border border-zinc-700/40 bg-zinc-900/40 text-[10px] space-y-1">
                  <div className="text-foreground font-bold">{c.name}</div>
                  <div className="text-mutedForeground">Price: {Number(c.price_points || 0).toLocaleString()} pts</div>
                  <div className="text-mutedForeground">Base stats: P {c.stats.power} · A {c.stats.aim} · S {c.stats.spin} · C {c.stats.control}</div>
                  {owned ? (
                    <button type="button" onClick={() => selectCue(owned.id)} disabled={cueBusy} className="px-2 py-1 rounded border border-emerald-500/50 text-emerald-300 text-[10px]">Select</button>
                  ) : (
                    <button type="button" onClick={() => buyCue(c.id)} disabled={cueBusy} className="px-2 py-1 rounded border border-primary/50 text-primary text-[10px]">Buy</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="p-2 rounded border border-primary/20 bg-zinc-900/40 text-[10px] font-heading">
            <div className="flex items-center gap-2 text-foreground"><Trophy size={12} className="text-primary" /> Rating: <span className="font-bold text-primary">{profile?.rating ?? 1000}</span></div>
            <div className="text-mutedForeground">W {profile?.wins ?? 0} / L {profile?.losses ?? 0}</div>
            <div className="text-mutedForeground">Pool cash: ${(profile?.pool_cash ?? 0).toLocaleString()}</div>
            <div className="mt-1"><Link to="/casino/mini-games/leaderboard" className="text-primary hover:underline">View mini-games leaderboard</Link></div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
