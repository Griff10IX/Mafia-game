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
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const animatingRef = useRef(false);
  const lastTargetBallsRef = useRef([]);

  const activeGame = tab === 'ai' ? aiGame : pvpGame;
  const balls = activeGame?.table_state?.balls || [];
  useEffect(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  useEffect(() => {
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
    const durationMs = 460;
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


  const selectedCue = useMemo(() => {
    const selectedId = profile?.selected_cue_id;
    return myCues.find((c) => c.id === selectedId) || myCues.find((c) => c.selected) || myCues[0] || null;
  }, [profile?.selected_cue_id, myCues]);

  const selectedCueUpgrade = useMemo(() => {
    if (!selectedCue) return null;
    return cueUpgrades.find((u) => u.cue_instance_id === selectedCue.id) || null;
  }, [cueUpgrades, selectedCue]);

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
      setAiGame(res.data || null);
    } catch (_) {
      setAiGame(null);
    }
  }, []);

  const fetchPvpGame = useCallback(async () => {
    if (!pvpGame?.id) return;
    try {
      const res = await api.get(`/casino/mp-8ball/games/${encodeURIComponent(pvpGame.id)}`);
      setPvpGame(res.data || null);
    } catch (e) {
      if (e?.response?.status === 404) setPvpGame(null);
    }
  }, [pvpGame?.id]);

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

    // Felt with depth (Mini-clip inspired blue table look).
    const felt = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.5, w * 0.8);
    felt.addColorStop(0, '#0ea5e9');
    felt.addColorStop(0.45, '#0284c7');
    felt.addColorStop(1, '#075985');
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
    ctx.strokeStyle = '#5b3a20';
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
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
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
      pocketGrad.addColorStop(0, '#111827');
      pocketGrad.addColorStop(1, '#000000');
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
      else if (b.number === 1) color = '#f59e0b';
      else if (b.number === 2) color = '#2563eb';
      else if (b.number === 3) color = '#dc2626';
      else if (b.number === 4) color = '#7c3aed';
      else if (b.number === 5) color = '#ea580c';
      else if (b.number === 6) color = '#16a34a';
      else if (b.number === 7) color = '#a16207';
      else if (b.number === 9) color = '#f59e0b';
      else if (b.number === 10) color = '#2563eb';
      else if (b.number === 11) color = '#dc2626';
      else if (b.number === 12) color = '#7c3aed';
      else if (b.number === 13) color = '#ea580c';
      else if (b.number === 14) color = '#16a34a';
      else if (b.number === 15) color = '#a16207';
      else if (b.number === 0) color = '#ffffff';

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
  }, [displayBalls, angleDeg, power, isAiming]);

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
      const payload = { angle, power: Number(power), spin_x: Number(spinX), spin_y: Number(spinY) };
      if (tab === 'ai') {
        const res = await api.post('/casino/mp-8ball/vs-ai/shoot', payload);
        setAiGame(res.data || null);
      } else {
        const res = await api.post(`/casino/mp-8ball/games/${encodeURIComponent(activeGame.id)}/shoot`, payload);
        setPvpGame(res.data || null);
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
    setAngleDeg((ang * 180) / Math.PI);
    setPower(Math.max(0.08, Math.min(1, dist / 260)));
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-heading">
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/40">
                  <div className="text-mutedForeground">Turn</div>
                  <div className="text-primary font-bold">{turnLabel(activeGame)}</div>
                </div>
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/40">
                  <div className="text-mutedForeground">Status</div>
                  <div className="text-foreground font-bold">{activeGame.status} / {activeGame.phase}</div>
                </div>
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/40">
                  <div className="text-mutedForeground">Shot count</div>
                  <div className="text-foreground font-bold">{activeGame.table_state?.shot_count || 0}</div>
                </div>
              </div>
              <div className="pool-canvas-shell rounded-xl p-2">
                <canvas
                  ref={canvasRef}
                  width={900}
                  height={450}
                  className="pool-canvas w-full rounded-lg border border-cyan-400/25 bg-[#0b4f2f] touch-none"
                  onPointerDown={(e) => {
                    setIsAiming(true);
                    updateAimFromPointer(e);
                  }}
                  onPointerMove={(e) => {
                    if (!isAiming) return;
                    updateAimFromPointer(e);
                  }}
                  onPointerUp={async (e) => {
                    if (!isAiming) return;
                    updateAimFromPointer(e);
                    setIsAiming(false);
                    await shoot();
                  }}
                  onPointerLeave={() => setIsAiming(false)}
                />
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
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <label className="space-y-1"><span className="text-mutedForeground">Angle (deg)</span><input type="number" value={angleDeg} onChange={(e) => setAngleDeg(Number(e.target.value || 0))} className="w-full px-2 py-1 rounded border border-input bg-transparent" /></label>
                <label className="space-y-1"><span className="text-mutedForeground">Power (0-1)</span><input type="number" min={0} max={1} step={0.01} value={power} onChange={(e) => setPower(Number(e.target.value || 0))} className="w-full px-2 py-1 rounded border border-input bg-transparent" /></label>
                <label className="space-y-1"><span className="text-mutedForeground">Spin X</span><input type="number" min={-1} max={1} step={0.05} value={spinX} onChange={(e) => setSpinX(Number(e.target.value || 0))} className="w-full px-2 py-1 rounded border border-input bg-transparent" /></label>
                <label className="space-y-1"><span className="text-mutedForeground">Spin Y</span><input type="number" min={-1} max={1} step={0.05} value={spinY} onChange={(e) => setSpinY(Number(e.target.value || 0))} className="w-full px-2 py-1 rounded border border-input bg-transparent" /></label>
                <div className="flex items-end"><button type="button" onClick={shoot} disabled={busy} className="w-full px-3 py-2 rounded bg-primary/20 border border-primary/50 text-primary font-heading">{busy ? '...' : 'Shoot'}</button></div>
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
