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
  const canvasRef = useRef(null);

  const activeGame = tab === 'ai' ? aiGame : pvpGame;
  const balls = activeGame?.table_state?.balls || [];

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

    // Table
    ctx.fillStyle = '#0b4f2f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 12;
    ctx.strokeRect(0, 0, w, h);

    // Pockets
    const pockets = [
      [0, 0], [w / 2, 0], [w, 0],
      [0, h], [w / 2, h], [w, h],
    ];
    ctx.fillStyle = '#0d0d0d';
    for (const [px, py] of pockets) {
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    // Balls
    for (const b of balls) {
      if (b.pocketed) continue;
      const x = (Number(b.x || 0) / TABLE_W) * w;
      const y = (Number(b.y || 0) / TABLE_H) * h;
      const r = Math.max(4, (BALL_R / TABLE_W) * w);
      let color = '#ffffff';
      if (b.number === 8) color = '#111111';
      else if (b.kind === 'solid') color = '#f59e0b';
      else if (b.kind === 'stripe') color = '#38bdf8';
      else if (b.number === 0) color = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (b.number !== 0) {
        ctx.fillStyle = b.number === 8 ? '#fff' : '#111';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(b.number), x, y + 3);
      }
    }
  }, [balls]);

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
              <canvas ref={canvasRef} width={900} height={450} className="w-full rounded border border-primary/20 bg-[#0b4f2f]" />
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
