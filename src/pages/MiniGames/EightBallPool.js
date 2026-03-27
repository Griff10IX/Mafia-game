import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Users, Trophy, Target, Zap, RefreshCw } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const POOL_STYLES = `
  .pool-fade-in { animation: pool-fade-in 0.35s ease-out both; }
  @keyframes pool-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .pool-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.2; }
  .pool-canvas-shell {
    background: radial-gradient(circle at 50% 30%, rgba(255,255,255,0.06), transparent 55%), linear-gradient(180deg, #1f140b 0%, #120c07 100%);
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.35), 0 10px 30px rgba(0,0,0,0.5);
  }
  .pool-canvas {
    box-shadow: inset 0 0 28px rgba(0,0,0,0.5), 0 0 20px rgba(14,165,233,0.15);
  }
`;

const TABLE_W = 2.2;
const TABLE_H = 1.1;
const BALL_R = 0.028;
const TABLE_SKINS = {
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

export default function EightBallPool() {
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
  const [busy, setBusy] = useState(false);
  const [displayBalls, setDisplayBalls] = useState([]);
  const [isAiming, setIsAiming] = useState(false);
  const [tableSkin, setTableSkin] = useState('ice_blue');
  const [renderTick, setRenderTick] = useState(0);
  const [replayActive, setReplayActive] = useState(false);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const replayAnimRef = useRef(null);
  const replayActiveRef = useRef(false);
  const replayLastShotRef = useRef(0);
  const animatingRef = useRef(false);
  const lastTargetBallsRef = useRef([]);
  const pocketedSetRef = useRef(new Set());
  const fxRef = useRef({ impacts: [], pockets: [] });

  const activeGame = tab === 'ai' ? aiGame : pvpGame;
  const balls = useMemo(() => activeGame?.table_state?.balls || [], [activeGame?.table_state?.balls]);
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
  }, [replayActive]);

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
  const currentSkin = TABLE_SKINS[tableSkin] || TABLE_SKINS.ice_blue;

  useEffect(() => {
    const skinByCue = (selectedCue?.cue_id || '').toLowerCase();
    if (skinByCue.includes('legacy') || (profile?.rating || 0) >= 1200) setTableSkin('royal_teal_gold');
    else if (skinByCue.includes('street')) setTableSkin('classic_green');
    else setTableSkin('ice_blue');
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
    if (replayAnimRef.current) cancelAnimationFrame(replayAnimRef.current);
    const start = performance.now();
    const duration = Math.max(1, Number(replay?.duration_ms || 1));
    const events = Array.isArray(replay?.events) ? replay.events : [];
    let lastFrameIdx = -1;

    const pushFrameFx = (toIdx) => {
      for (let i = lastFrameIdx + 1; i <= toIdx; i += 1) {
        if (i < 0 || i >= frames.length) continue;
        const tMs = Number(frames[i]?.t_ms || 0);
        for (const ev of events) {
          if (Number(ev?.t_ms || 0) !== tMs) continue;
          if (ev?.type === 'collision') {
            const cx = (Number(ev?.x || 0) / TABLE_W) * 900;
            const cy = (Number(ev?.y || 0) / TABLE_H) * 450;
            fxRef.current.impacts.push({ x: cx, y: cy, at: Date.now() });
          } else if (ev?.type === 'pocket') {
            fxRef.current.pockets.push({ number: Number(ev?.number || 0), at: Date.now() });
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
      const frameBalls = Array.isArray(frames[idx]?.balls) ? frames[idx].balls.map((b) => ({ ...b })) : [];
      if (frameBalls.length) setDisplayBalls(frameBalls);
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
  }, []);

  const fetchCues = useCallback(async () => {
    const [catalogRes, myRes, profileRes] = await Promise.all([
      api.get('/casino/mp-8ball/cues/catalog'),
      api.get('/casino/mp-8ball/cues/me'),
      api.get('/casino/mp-8ball/profile'),
    ]);
    setCatalog(catalogRes.data?.catalog || []);
    setMyCues(myRes.data?.owned || []);
    setCueUpgrades(myRes.data?.upgrades || []);
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

    // Felt with depth (skin driven).
    const felt = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.5, w * 0.8);
    felt.addColorStop(0, currentSkin.felt[0]);
    felt.addColorStop(0.45, currentSkin.felt[1]);
    felt.addColorStop(1, currentSkin.felt[2]);
    ctx.fillStyle = felt;
    ctx.fillRect(0, 0, w, h);

    // Subtle cloth noise lines.
    ctx.save();
    ctx.globalAlpha = 0.065;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (let yy = 0; yy < h; yy += 6) {
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
    ctx.restore();

    // Cushion/rail and inner bevel.
    const railGrad = ctx.createLinearGradient(0, 0, w, h);
    railGrad.addColorStop(0, currentSkin.rail[0]);
    railGrad.addColorStop(0.5, currentSkin.rail[1]);
    railGrad.addColorStop(1, currentSkin.rail[2]);
    ctx.strokeStyle = railGrad;
    ctx.lineWidth = 14;
    ctx.strokeRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    // Pockets
    const pockets = [
      [0, 0], [w / 2, 0], [w, 0],
      [0, h], [w / 2, h], [w, h],
    ];
    // Diamonds on rails.
    ctx.fillStyle = currentSkin.accent;
    const diamonds = [w * 0.25, w * 0.5, w * 0.75];
    for (const dx of diamonds) {
      ctx.fillRect(dx - 2, 4, 4, 8);
      ctx.fillRect(dx - 2, h - 12, 4, 8);
    }
    const sideDiamonds = [h * 0.25, h * 0.5, h * 0.75];
    for (const dy of sideDiamonds) {
      ctx.fillRect(4, dy - 2, 8, 4);
      ctx.fillRect(w - 12, dy - 2, 8, 4);
    }

    ctx.fillStyle = '#070707';
    for (const [px, py] of pockets) {
      const pocketGrad = ctx.createRadialGradient(px, py, 2, px, py, 18);
      pocketGrad.addColorStop(0, currentSkin.pocket[0]);
      pocketGrad.addColorStop(1, currentSkin.pocket[1]);
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fillStyle = pocketGrad;
      ctx.fill();
    }

    // Balls
    for (const b of displayBalls) {
      if (b.pocketed) continue;
      const x = (Number(b.x || 0) / TABLE_W) * w;
      const y = (Number(b.y || 0) / TABLE_H) * h;
      const r = Math.max(4, (BALL_R / TABLE_W) * w);
      let color = '#ffffff';
      if (b.number === 8) color = '#111111';
      else if (Object.prototype.hasOwnProperty.call(BALL_COLOR_MAP, b.number)) color = BALL_COLOR_MAP[b.number];
      else if (b.number === 0) color = '#ffffff';

      // High-speed trail.
      const vx = Number(b.vx || 0);
      const vy = Number(b.vy || 0);
      const speed = Math.hypot(vx, vy);
      if (speed > 0.04) {
        const tx = x - (vx * 900 * 0.08);
        const ty = y - (vy * 900 * 0.08);
        const trail = ctx.createLinearGradient(x, y, tx, ty);
        trail.addColorStop(0, 'rgba(255,255,255,0.22)');
        trail.addColorStop(1, 'rgba(255,255,255,0.0)');
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = trail;
        ctx.lineWidth = Math.max(1, r * 0.7);
        ctx.stroke();
      }

      // Ball shadow.
      ctx.beginPath();
      ctx.arc(x + 1.5, y + 2.5, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();

      // Base sphere.
      const ballGrad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.25, x, y, r * 1.05);
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.25, color);
      ballGrad.addColorStop(1, b.number === 8 ? '#000000' : '#1f2937');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();

      // Stripe layer.
      if (b.kind === 'stripe') {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = color;
        ctx.fillRect(x - r, y - r * 0.4, r * 2, r * 0.8);
        ctx.restore();
      }

      // Number circle.
      if (b.number !== 0) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = `${Math.max(8, r * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.number), x, y);
      }
      ctx.strokeStyle = 'rgba(17,24,39,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Specular highlight.
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fill();
    }

    // Aiming guide + cue stick.
    const cue = displayBalls.find((b) => b.number === 0 && !b.pocketed);
    if (cue) {
      const cx = (Number(cue.x || 0) / TABLE_W) * w;
      const cy = (Number(cue.y || 0) / TABLE_H) * h;
      const a = (Number(angleDeg || 0) * Math.PI) / 180;
      const aimLen = 58 + Number(power || 0) * 200;
      const cueLen = 140;
      const ox = Math.cos(a);
      const oy = Math.sin(a);

      // Aim ring around cue ball.
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(10, (BALL_R / TABLE_W) * w * 1.7), 0, Math.PI * 2);
      ctx.strokeStyle = isAiming ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = isAiming ? 2.5 : 1.4;
      ctx.stroke();

      // Predicted ghost marker.
      const gx = cx + ox * Math.min(aimLen, 170);
      const gy = cy + oy * Math.min(aimLen, 170);
      ctx.beginPath();
      ctx.arc(gx, gy, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + ox * aimLen, cy + oy * aimLen);
      const lineGrad = ctx.createLinearGradient(cx, cy, cx + ox * aimLen, cy + oy * aimLen);
      lineGrad.addColorStop(0, 'rgba(255,255,255,0.75)');
      lineGrad.addColorStop(1, isAiming ? 'rgba(250,204,21,0.9)' : 'rgba(255,255,255,0.08)');
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = isAiming ? 2.5 : 2;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Secondary faint trajectory extension.
      ctx.beginPath();
      ctx.moveTo(cx + ox * aimLen, cy + oy * aimLen);
      ctx.lineTo(cx + ox * (aimLen + 120), cy + oy * (aimLen + 120));
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 7]);
      ctx.stroke();
      ctx.setLineDash([]);

      const cueGrad = ctx.createLinearGradient(
        cx - ox * (cueLen * (0.45 + Number(power || 0) * 0.65)),
        cy - oy * (cueLen * (0.45 + Number(power || 0) * 0.65)),
        cx - ox * 18,
        cy - oy * 18,
      );
      cueGrad.addColorStop(0, '#f5d0a9');
      cueGrad.addColorStop(0.55, '#b08968');
      cueGrad.addColorStop(1, '#5b3a20');
      ctx.beginPath();
      ctx.moveTo(cx - ox * (cueLen * (0.45 + Number(power || 0) * 0.65)), cy - oy * (cueLen * (0.45 + Number(power || 0) * 0.65)));
      ctx.lineTo(cx - ox * 18, cy - oy * 18);
      ctx.strokeStyle = cueGrad;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    const now = Date.now();
    fxRef.current.pockets = fxRef.current.pockets.filter((f) => now - f.at < 450);
    for (const f of fxRef.current.pockets) {
      const alpha = 1 - ((now - f.at) / 450);
      const flash = ctx.createRadialGradient(w * 0.5, h * 0.5, 30, w * 0.5, h * 0.5, w * 0.55);
      flash.addColorStop(0, `rgba(255,255,255,${0.12 * alpha})`);
      flash.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, w, h);
    }
    fxRef.current.impacts = fxRef.current.impacts.filter((f) => now - f.at < 300);
    for (const f of fxRef.current.impacts) {
      const alpha = 1 - ((now - f.at) / 300);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 6 + (1 - alpha) * 18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [displayBalls, angleDeg, power, isAiming, currentSkin, renderTick]);

  const startAi = async () => {
    setBusy(true);
    try {
      const res = await api.post('/casino/mp-8ball/vs-ai/start');
      setAiGame(res.data || null);
      setTab('ai');
      toast.success('AI match started');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to start AI game');
    } finally {
      setBusy(false);
    }
  };

  const createPvp = async () => {
    setBusy(true);
    try {
      const res = await api.post('/casino/mp-8ball/games', { buy_in: Number(buyIn) || 0, rated: true, anonymous: false });
      setPvpGame(res.data || null);
      setTab('pvp');
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
    try {
      const res = await api.post(`/casino/mp-8ball/games/${encodeURIComponent(gid)}/join`);
      setPvpGame(res.data || null);
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
    setBusy(true);
    try {
      await api.post(`/casino/mp-8ball/games/${encodeURIComponent(pvpGame.id)}/leave`);
      setPvpGame(null);
      toast.success('Left lobby');
      await fetchPvpLobbies();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to leave');
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
    setBusy(true);
    try {
      const angle = (Number(angleDeg) * Math.PI) / 180;
      const cue = displayBalls.find((b) => b.number === 0 && !b.pocketed);
      const canvas = canvasRef.current;
      if (cue && canvas) {
        const cx = (Number(cue.x || 0) / TABLE_W) * canvas.width;
        const cy = (Number(cue.y || 0) / TABLE_H) * canvas.height;
        fxRef.current.impacts.push({ x: cx, y: cy, at: Date.now() });
      }
      const payload = { angle, power: Number(power), spin_x: Number(spinX), spin_y: Number(spinY) };
      if (tab === 'ai') {
        const res = await api.post('/casino/mp-8ball/vs-ai/shoot', payload);
        playShotReplay(res.data || null, setAiGame);
      } else {
        const res = await api.post(`/casino/mp-8ball/games/${encodeURIComponent(activeGame.id)}/shoot`, payload);
        playShotReplay(res.data || null, setPvpGame);
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Shot failed');
    } finally {
      setBusy(false);
    }
  };

  const updateAimFromPointer = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cue = displayBalls.find((b) => b.number === 0 && !b.pocketed);
    if (!cue) return;
    const rect = canvas.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const sy = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const cx = (Number(cue.x || 0) / TABLE_W) * canvas.width;
    const cy = (Number(cue.y || 0) / TABLE_H) * canvas.height;
    const dx = sx - cx;
    const dy = sy - cy;
    const ang = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);
    const targetDeg = (ang * 180) / Math.PI;
    setAngleDeg((prev) => prev + (targetDeg - prev) * 0.38);
    const targetPower = Math.max(0.08, Math.min(1, dist / 260));
    setPower((prev) => prev + (targetPower - prev) * 0.42);
  };

  const buyCue = async (cueId) => {
    setBusy(true);
    try {
      await api.post('/casino/mp-8ball/cues/buy', { cue_id: cueId });
      toast.success('Cue purchased');
      await fetchCues();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Purchase failed');
    } finally {
      setBusy(false);
    }
  };

  const selectCue = async (cueInstanceId) => {
    setBusy(true);
    try {
      await api.post('/casino/mp-8ball/cues/select', { cue_instance_id: cueInstanceId });
      await fetchCues();
      toast.success('Cue selected');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Select failed');
    } finally {
      setBusy(false);
    }
  };

  const upgradeCue = async (stat) => {
    if (!selectedCue?.id) return;
    setBusy(true);
    try {
      await api.post('/casino/mp-8ball/cues/upgrade', { cue_instance_id: selectedCue.id, stat });
      await fetchCues();
      toast.success(`${stat} upgraded`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Upgrade failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
        <Target size={22} className="text-primary/40 animate-pulse" />
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-primary text-[10px] font-heading uppercase tracking-[0.2em]">Loading pool room...</span>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="eight-ball-pool-page">
      <style>{POOL_STYLES}</style>

      <header className="pool-fade-in text-center">
        <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">8-Ball Pool</h1>
        <p className="text-[10px] text-mutedForeground font-heading italic">Play against AI or live PvP. Upgrade cues for power, aim, spin and control.</p>
      </header>

      <div className={`${styles.panel} mobile-panel rounded-md border border-primary/20 overflow-hidden pool-fade-in`}>
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
          <button type="button" onClick={() => setTab('ai')} className={`px-2 py-1 rounded text-[10px] font-heading uppercase border ${tab === 'ai' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-700 text-mutedForeground'}`}><Bot size={12} className="inline mr-1" />AI</button>
          <button type="button" onClick={() => setTab('pvp')} className={`px-2 py-1 rounded text-[10px] font-heading uppercase border ${tab === 'pvp' ? 'bg-primary/20 border-primary/50 text-primary' : 'border-zinc-700 text-mutedForeground'}`}><Users size={12} className="inline mr-1" />PvP</button>
          <button type="button" onClick={() => { fetchPvpLobbies(); fetchAiGame(); fetchPvpGame(); }} className="ml-auto px-2 py-1 rounded text-[10px] border border-zinc-700 text-mutedForeground hover:text-foreground"><RefreshCw size={12} /></button>
        </div>
        <div className="p-3 space-y-3">
          {tab === 'ai' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={startAi} disabled={busy} className="px-3 py-1.5 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading">{busy ? '...' : 'Start AI Match'}</button>
              {aiGame?.id && <span className="text-[10px] text-mutedForeground font-mono">Session: {aiGame.id}</span>}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input type="number" min={0} value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value || 0))} className="w-28 px-2 py-1 rounded border border-input bg-transparent text-xs" placeholder="Buy-in" />
                <button type="button" onClick={createPvp} disabled={busy} className="px-3 py-1.5 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading">{busy ? '...' : 'Create Lobby'}</button>
                {pvpGame?.id && <button type="button" onClick={leaveLobby} disabled={busy} className="px-3 py-1.5 rounded bg-red-500/20 border border-red-500/50 text-red-300 text-xs font-heading">Leave</button>}
                {pvpGame?.id && <button type="button" onClick={readyLobby} disabled={busy} className="px-3 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-heading">Ready</button>}
                {pvpGame?.id && <button type="button" onClick={startLobby} disabled={busy} className="px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-heading">Start</button>}
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {lobbies.length === 0 ? <p className="text-[10px] text-mutedForeground">No live lobbies.</p> : lobbies.map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center gap-2 p-1.5 rounded bg-zinc-900/40 border border-zinc-700/40">
                    <span className="text-[10px] text-foreground font-mono">{g.id}</span>
                    <span className="text-[10px] text-mutedForeground">{(g.players || []).length}/2 players</span>
                    <span className="text-[10px] text-mutedForeground">Pot: ${(g.pot || 0).toLocaleString()}</span>
                    <button type="button" onClick={() => joinLobby(g.id)} disabled={busy} className="ml-auto px-2 py-1 rounded border border-primary/40 text-primary text-[10px]">Join</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeGame && (
            <div className="space-y-2">
              <div className="rounded-md border border-primary/20 bg-zinc-900/55 p-2">
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
                  <div className="px-2 py-1 rounded border border-zinc-700/60 bg-zinc-800/35 text-foreground">
                    Turn: <span className="font-bold text-primary">{turnLabel(activeGame)}</span> · {activeGame.status}/{activeGame.phase} · Shots {activeGame.table_state?.shot_count || 0}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => {
                    const b = (displayBalls || []).find((x) => x.number === n);
                    const pocketed = !!b?.pocketed;
                    const color = BALL_COLOR_MAP[n] || '#cbd5e1';
                    return (
                      <span
                        key={n}
                        className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[8px] border ${pocketed ? 'opacity-25 border-zinc-700' : 'opacity-100 border-white/30'}`}
                        style={{ backgroundColor: color, color: n === 8 ? '#fff' : '#111' }}
                        title={`Ball ${n}${pocketed ? ' (pocketed)' : ''}`}
                      >
                        {n}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="pool-canvas-shell rounded-xl p-2">
                <canvas
                  ref={canvasRef}
                  width={900}
                  height={450}
                  className="pool-canvas w-full rounded-lg border border-cyan-400/25 bg-[#0b4f2f] touch-none"
                  onPointerDown={(e) => {
                    if (replayActive) return;
                    setIsAiming(true);
                    updateAimFromPointer(e);
                  }}
                  onPointerMove={(e) => {
                    if (replayActive) return;
                    if (!isAiming) return;
                    updateAimFromPointer(e);
                  }}
                  onPointerUp={async (e) => {
                    if (replayActive) return;
                    if (!isAiming) return;
                    updateAimFromPointer(e);
                    setIsAiming(false);
                    await shoot();
                  }}
                  onPointerLeave={() => setIsAiming(false)}
                />
              </div>
              <div className="rounded-md border border-primary/20 bg-zinc-900/55 p-2 space-y-1">
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
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[10px]">
                <label className="space-y-1"><span className="text-mutedForeground">Table skin</span>
                  <select value={tableSkin} onChange={(e) => setTableSkin(e.target.value)} className="w-full px-2 py-1 rounded border border-input bg-transparent">
                    {Object.keys(TABLE_SKINS).map((k) => <option key={k} value={k}>{TABLE_SKINS[k].name}</option>)}
                  </select>
                </label>
                <label className="space-y-1"><span className="text-mutedForeground">Angle (deg)</span><input type="number" value={angleDeg} onChange={(e) => setAngleDeg(Number(e.target.value || 0))} className="w-full px-2 py-1 rounded border border-input bg-transparent" /></label>
                <label className="space-y-1"><span className="text-mutedForeground">Power (0-1)</span><input type="number" min={0} max={1} step={0.01} value={power} onChange={(e) => setPower(Number(e.target.value || 0))} className="w-full px-2 py-1 rounded border border-input bg-transparent" /></label>
                <label className="space-y-1"><span className="text-mutedForeground">Spin X</span><input type="number" min={-1} max={1} step={0.05} value={spinX} onChange={(e) => setSpinX(Number(e.target.value || 0))} className="w-full px-2 py-1 rounded border border-input bg-transparent" /></label>
                <label className="space-y-1"><span className="text-mutedForeground">Spin Y</span><input type="number" min={-1} max={1} step={0.05} value={spinY} onChange={(e) => setSpinY(Number(e.target.value || 0))} className="w-full px-2 py-1 rounded border border-input bg-transparent" /></label>
                <div className="flex items-end"><button type="button" onClick={shoot} disabled={busy || replayActive} className="w-full px-3 py-2 rounded bg-primary/20 border border-primary/50 text-primary font-heading">{replayActive ? 'Rolling...' : busy ? '...' : 'Shoot'}</button></div>
              </div>
            </div>
          )}
        </div>
        <div className="pool-art-line text-primary mx-3" />
      </div>

      <div className={`${styles.panel} mobile-panel rounded-md border border-primary/20 overflow-hidden pool-fade-in`}>
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
          <Zap size={13} className="text-primary" />
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Cue Garage & Upgrades</span>
        </div>
        <div className="p-3 space-y-3">
          {selectedCue && (
            <div className="text-[10px] font-heading p-2 rounded border border-primary/20 bg-zinc-900/40">
              <div className="text-foreground font-bold">Selected cue: {selectedCue.cue_id}</div>
              <div className="text-mutedForeground">Power {selectedCueUpgrade?.power || 0} · Aim {selectedCueUpgrade?.aim || 0} · Spin {selectedCueUpgrade?.spin || 0} · Control {selectedCueUpgrade?.control || 0}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {['power', 'aim', 'spin', 'control'].map((stat) => (
                  <button key={stat} type="button" onClick={() => upgradeCue(stat)} disabled={busy} className="px-2 py-1 rounded border border-primary/40 text-primary text-[10px] uppercase">{stat} +1</button>
                ))}
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
                    <button type="button" onClick={() => selectCue(owned.id)} disabled={busy} className="px-2 py-1 rounded border border-emerald-500/50 text-emerald-300 text-[10px]">Select</button>
                  ) : (
                    <button type="button" onClick={() => buyCue(c.id)} disabled={busy} className="px-2 py-1 rounded border border-primary/50 text-primary text-[10px]">Buy</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="p-2 rounded border border-primary/20 bg-zinc-900/40 text-[10px] font-heading">
            <div className="flex items-center gap-2 text-foreground"><Trophy size={12} className="text-primary" /> Rating: <span className="font-bold text-primary">{profile?.rating ?? 1000}</span></div>
            <div className="text-mutedForeground">W {profile?.wins ?? 0} / L {profile?.losses ?? 0}</div>
            <div className="mt-1"><Link to="/casino/mini-games/leaderboard" className="text-primary hover:underline">View mini-games leaderboard</Link></div>
          </div>
        </div>
      </div>
    </div>
  );
}
