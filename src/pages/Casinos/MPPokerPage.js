import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PlusCircle, Spade, User, Users } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

export default function MPPokerPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [recentGames, setRecentGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMaxPlayers, setCreateMaxPlayers] = useState(6);
  const [createBuyIn, setCreateBuyIn] = useState('100000');
  const [createExtraPrize, setCreateExtraPrize] = useState('');
  const [creating, setCreating] = useState(false);
  const [vsDealerOpen, setVsDealerOpen] = useState(false);
  const [vsDealerBlind, setVsDealerBlind] = useState('5000');
  const [vsDealerStarting, setVsDealerStarting] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [myUserId, setMyUserId] = useState(null);

  useEffect(() => {
    api.get('/auth/me').then((r) => setMyUserId(r.data?.id ?? null)).catch(() => setMyUserId(null));
  }, []);

  const fetchGames = useCallback(() => {
    api.get('/casino/mp-poker/games').then((r) => setGames(r.data?.games || [])).catch(() => setGames([]));
    api.get('/casino/mp-poker/recent-games').then((r) => setRecentGames(r.data?.games || [])).catch(() => setRecentGames([]));
  }, []);

  useEffect(() => {
    fetchGames();
    const t = setInterval(fetchGames, 8000);
    return () => clearInterval(t);
  }, [fetchGames]);

  useEffect(() => {
    setLoading(false);
  }, [games]);

  const handlePlayVsDealer = async () => {
    const blind = parseInt(String(vsDealerBlind).replace(/\D/g, ''), 10) || 5000;
    if (blind < 1000) {
      toast.error('Blind must be at least 1,000');
      return;
    }
    setVsDealerStarting(true);
    try {
      const res = await api.post('/casino/mp-poker/vs-dealer/start', { blind });
      await refreshUser();
      toast.success('Game started');
      if (res.data?.game_id) navigate(`/casino/mp-poker/game/${res.data.game_id}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not start');
    } finally {
      setVsDealerStarting(false);
    }
  };

  const handleCreate = async () => {
    const buyIn = parseInt(String(createBuyIn).replace(/\D/g, ''), 10) || 0;
    if (buyIn <= 0) {
      toast.error('Buy-in must be positive');
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/casino/mp-poker/games', {
        max_players: Math.max(2, Math.min(9, createMaxPlayers)),
        buy_in: buyIn,
        extra_prize: parseInt(String(createExtraPrize).replace(/\D/g, ''), 10) || 0,
      });
      await refreshUser();
      toast.success('Table created');
      setCreateOpen(false);
      fetchGames();
      if (res.data?.game_id) navigate(`/casino/mp-poker/game/${res.data.game_id}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not create');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (gameId) => {
    setJoiningId(gameId);
    try {
      const res = await api.post(`/casino/mp-poker/games/${gameId}/join`);
      await refreshUser();
      toast.success('Joined');
      fetchGames();
      if (res.data?.id) navigate(`/casino/mp-poker/game/${res.data.id}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not join');
    } finally {
      setJoiningId(null);
    }
  };

  const handleCancelGame = async (gameId) => {
    setCancellingId(gameId);
    try {
      await api.post(`/casino/mp-poker/games/${gameId}/cancel`);
      await refreshUser();
      toast.success('Game cancelled');
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not cancel');
    } finally {
      setCancellingId(null);
    }
  };

  const inputStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(212,175,55,0.2)',
    color: 'inherit',
  };

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="mp-poker-page">
      <style>{`
        @keyframes mpp-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .mpp-fade { animation: mpp-fade 0.35s ease-out both; }
      `}</style>

      <div className="mpp-fade">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-0.5">Texas Hold'em · Casino</p>
        <h1 className="text-xl font-heading font-bold text-primary tracking-wider uppercase">Poker</h1>
        <p className="text-[10px] text-mutedForeground font-heading italic mt-1">
          Play vs Dealer or create/join multiplayer tables
        </p>
      </div>

      {/* Choice: Vs Dealer vs Multiplayer */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mpp-fade" style={{ animationDelay: '0.05s' }}>
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <User size={20} className="text-primary" />
              <h2 className="text-sm font-heading font-bold text-primary uppercase">Vs Dealer</h2>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading mb-3">1v1 Texas Hold'em vs house bot. Full rules, blinds, flop/turn/river.</p>
            <button
              type="button"
              onClick={() => setVsDealerOpen((o) => !o)}
              className="w-full py-2.5 rounded-lg border-2 border-primary/40 bg-primary/10 text-primary font-heading font-bold text-[10px] uppercase tracking-wider hover:bg-primary/20 transition-colors"
            >
              {vsDealerOpen ? 'Hide' : 'Play vs Dealer'}
            </button>
            {vsDealerOpen && (
              <div className="mt-3 space-y-2 pt-3 border-t border-primary/20">
                <label className="block text-[10px] font-heading font-bold text-foreground">Blind (small)</label>
                <FormattedNumberInput
                  value={vsDealerBlind}
                  onChange={setVsDealerBlind}
                  placeholder="5000"
                  className="w-full px-3 py-2 rounded-md border border-border bg-secondary text-sm"
                />
                <button
                  type="button"
                  onClick={handlePlayVsDealer}
                  disabled={vsDealerStarting}
                  className="w-full py-2 rounded-lg bg-primary text-primaryForeground font-heading font-bold text-[10px] uppercase disabled:opacity-50"
                >
                  {vsDealerStarting ? 'Starting…' : 'Start Game'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users size={20} className="text-primary" />
              <h2 className="text-sm font-heading font-bold text-primary uppercase">Multiplayer</h2>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading mb-3">Create a table or join an open game. 2–9 players, real Hold'em.</p>
            <button
              type="button"
              onClick={() => setCreateOpen((o) => !o)}
              className="w-full py-2.5 rounded-lg border-2 border-primary/40 bg-primary/10 text-primary font-heading font-bold text-[10px] uppercase tracking-wider hover:bg-primary/20 transition-colors flex items-center justify-center gap-1.5"
            >
              <PlusCircle size={14} />
              {createOpen ? 'Close' : 'Create Table'}
            </button>
            {createOpen && (
              <div className="mt-3 space-y-2 pt-3 border-t border-primary/20">
                <label className="block text-[10px] font-heading font-bold">Max players</label>
                <input
                  type="number"
                  min={2}
                  max={9}
                  value={createMaxPlayers}
                  onChange={(e) => setCreateMaxPlayers(Math.max(2, Math.min(9, parseInt(e.target.value, 10) || 2)))}
                  className="w-full px-3 py-2 rounded-md border border-border bg-secondary text-sm"
                />
                <label className="block text-[10px] font-heading font-bold">Buy-in</label>
                <FormattedNumberInput value={createBuyIn} onChange={setCreateBuyIn} placeholder="100000" className="w-full px-3 py-2 rounded-md border border-border bg-secondary text-sm" />
                <label className="block text-[10px] font-heading font-bold">Extra prize (optional)</label>
                <FormattedNumberInput value={createExtraPrize} onChange={setCreateExtraPrize} placeholder="0" className="w-full px-3 py-2 rounded-md border border-border bg-secondary text-sm" />
                <button type="button" onClick={handleCreate} disabled={creating} className="w-full py-2 rounded-lg bg-primary text-primaryForeground font-heading font-bold text-[10px] uppercase disabled:opacity-50">
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Open tables */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mpp-fade`} style={{ animationDelay: '0.08s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Open Tables</h2>
        </div>
        <div className="p-3 space-y-2">
          {loading && games.length === 0 ? (
            <p className="text-[10px] text-mutedForeground font-heading">Loading…</p>
          ) : games.length === 0 ? (
            <p className="text-[10px] text-mutedForeground font-heading">No open tables. Create one above.</p>
          ) : (
            games.map((g) => {
              const isCreator = g.creator_id === myUserId;
              const isIn = (g.player_ids || []).includes(myUserId);
              const full = (g.player_count || 0) >= (g.max_players || 6);
              return (
                <div
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 px-3 rounded-lg border border-primary/20 bg-primary/5"
                >
                  <div>
                    <span className="text-[10px] font-heading font-bold text-foreground">{g.creator_username || '—'}</span>
                    <span className="text-[9px] text-mutedForeground font-heading ml-2">
                      {g.player_count}/{g.max_players} · {formatMoney(g.buy_in)} buy-in · pot {formatMoney(g.pot)}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {isCreator && g.phase === 'ready' && (
                      <button
                        type="button"
                        onClick={() => handleCancelGame(g.id)}
                        disabled={cancellingId === g.id}
                        className="px-2 py-1 rounded border border-red-500/50 text-red-400 text-[9px] font-heading uppercase disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                    {!isIn && !full && (
                      <button
                        type="button"
                        onClick={() => handleJoin(g.id)}
                        disabled={joiningId === g.id}
                        className="px-3 py-1.5 rounded bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase disabled:opacity-50"
                      >
                        {joiningId === g.id ? '…' : 'Join'}
                      </button>
                    )}
                    {(isIn || isCreator) && (
                      <button
                        type="button"
                        onClick={() => navigate(`/casino/mp-poker/game/${g.id}`)}
                        className="px-3 py-1.5 rounded bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase"
                      >
                        Open
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {recentGames.length > 0 && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mpp-fade`} style={{ animationDelay: '0.1s' }}>
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Recent Games</h2>
          </div>
          <div className="p-3 space-y-1">
            {recentGames.slice(0, 5).map((g) => (
              <div key={g.id} className="text-[10px] font-heading text-mutedForeground flex justify-between">
                <span>Pot {formatMoney(g.pot)}</span>
                <span>{g.completed_at ? new Date(g.completed_at).toLocaleString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
