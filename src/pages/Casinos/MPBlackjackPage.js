import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PlusCircle, Spade, XCircle, Swords } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

export default function MPBlackjackPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMaxPlayers, setCreateMaxPlayers] = useState(6);
  const [createBuyIn, setCreateBuyIn] = useState('100000');
  const [createExtraPrize, setCreateExtraPrize] = useState('');
  const [createExcludeYourself, setCreateExcludeYourself] = useState(false);
  const [createAnonymous, setCreateAnonymous] = useState(false);
  const [createCardLimit, setCreateCardLimit] = useState('no_limit');
  const [createTwentyOneOnly, setCreateTwentyOneOnly] = useState(false);
  const [createEliminationRounds, setCreateEliminationRounds] = useState(false);
  const [creating, setCreating] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [recentGames, setRecentGames] = useState([]);

  useEffect(() => {
    api.get('/auth/me').then((r) => setMyUserId(r.data?.id ?? null)).catch(() => setMyUserId(null));
  }, []);

  useEffect(() => {
    api.get('/admin/check').then((r) => {
      setIsAdmin(!!r.data?.is_admin);
      setIsModerator(!!r.data?.is_moderator);
    }).catch(() => {});
  }, []);

  const fetchGames = useCallback(() => {
    api
      .get('/casino/mp-blackjack/games')
      .then((r) => setGames(r.data?.games || []))
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
    api
      .get('/casino/mp-blackjack/recent-games')
      .then((r) => setRecentGames(r.data?.games || []))
      .catch(() => setRecentGames([]));
  }, []);

  useEffect(() => {
    fetchGames();
    const t = setInterval(fetchGames, 8000);
    return () => clearInterval(t);
  }, [fetchGames]);

  const handleJoin = async (gameId) => {
    setJoiningId(gameId);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/join`);
      await refreshUser();
      toast.success(res.data?.message || 'Joined');
      fetchGames();
      if (res.data?.game?.id) navigate(`/casino/mp-blackjack/game/${res.data.game.id}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not join');
    } finally {
      setJoiningId(null);
    }
  };

  const handleOpenGame = (gameId) => navigate(`/casino/mp-blackjack/game/${gameId}`);

  const handleCancelGame = async (gameId) => {
    setCancellingId(gameId);
    try {
      await api.post(`/casino/mp-blackjack/games/${gameId}/cancel`);
      await refreshUser();
      toast.success('Game cancelled; all players refunded');
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not cancel');
    } finally {
      setCancellingId(null);
    }
  };

  const handleCreate = async () => {
    const buyIn = parseInt(createBuyIn.replace(/\D/g, ''), 10) || 0;
    const extraPrize = parseInt(String(createExtraPrize).replace(/\D/g, ''), 10) || 0;
    if (buyIn <= 0) { toast.error('Buy-in must be positive'); return; }
    setCreating(true);
    try {
      const cardLimit = createCardLimit === 'no_limit' ? null : parseInt(createCardLimit, 10);
      const res = await api.post('/casino/mp-blackjack/games', {
        max_players: Math.max(2, Math.min(8, createMaxPlayers)),
        buy_in: buyIn,
        extra_prize: extraPrize,
        exclude_yourself: createExcludeYourself,
        anonymous: createAnonymous,
        card_limit: cardLimit,
        twenty_one_only: createTwentyOneOnly,
        elimination_rounds: createEliminationRounds,
      });
      await refreshUser();
      toast.success('Game created');
      setCreateOpen(false);
      setCreateBuyIn('100000');
      setCreateExtraPrize('');
      setCreateExcludeYourself(false);
      setCreateAnonymous(false);
      setCreateCardLimit('no_limit');
      setCreateTwentyOneOnly(false);
      setCreateEliminationRounds(false);
      fetchGames();
      if (res.data?.game_id) navigate(`/casino/mp-blackjack/game/${res.data.game_id}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not create game');
    } finally {
      setCreating(false);
    }
  };

  const inputStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(212,175,55,0.2)',
    color: 'inherit',
  };
  const selectStyle = { ...inputStyle, background: '#27272a', color: '#e4e4e7', colorScheme: 'dark' };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="mp-blackjack-page">
      <style>{`
        @keyframes mpbj-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .mpbj-fade { animation: mpbj-fade 0.35s ease-out both; }
        .mp-blackjack-select option { background: #27272a; color: #e4e4e7; }
        @keyframes mpbj-row { from { opacity:0; transform:translateX(-4px); } to { opacity:1; transform:translateX(0); } }
        .mpbj-row { animation: mpbj-row 0.3s ease-out both; }
      `}</style>

      {/* ── Page header ── */}
      <div className="mpbj-fade">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-0.5">Pot game · Casino</p>
        <h1 className="text-xl font-heading font-bold text-primary tracking-wider uppercase">Multiplayer Blackjack</h1>
        <p className="text-[10px] text-mutedForeground font-heading italic mt-1">
          2–8 players · buy-in goes to the pot · best hand wins · no table owner
        </p>
      </div>

      {/* ── Deal New Game options (above Open Tables when opened) ── */}
      {createOpen && (
        <div
          className={`relative ${styles.panel} mobile-panel rounded-xl overflow-hidden border-2 mpbj-fade`}
          style={{ borderColor: '#5a3e1b', animationDelay: '0.02s' }}
        >
          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,var(--noir-primary-bright),#8b6914,var(--noir-primary-bright),#5a3e1b)' }} />

          <div className="px-3 py-2.5 border-b border-primary/20" style={{ background: 'rgba(212,175,55,0.06)' }}>
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Deal New Game</h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">
              You pay the buy-in and become the first player. Optional bonus prize added to the pot.
            </p>
          </div>

          <div className="p-3 space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-24 shrink-0">Max Players</label>
              <select value={createMaxPlayers} onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
                className="mp-blackjack-select flex-1 px-2.5 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={selectStyle}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} players</option>)}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-24 shrink-0">Buy-in ($)</label>
              <FormattedNumberInput value={createBuyIn} onChange={setCreateBuyIn} placeholder="100,000"
                className="flex-1 px-2.5 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={inputStyle} />
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-24 shrink-0">Bonus Prize</label>
              <FormattedNumberInput value={createExtraPrize} onChange={setCreateExtraPrize} placeholder="0 (optional)"
                className="flex-1 px-2.5 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={inputStyle} />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-24 shrink-0">Hit limit</label>
                <select value={createCardLimit} onChange={(e) => setCreateCardLimit(e.target.value)}
                  className="mp-blackjack-select flex-1 px-2.5 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={selectStyle}>
                  <option value="no_limit">No limit (hit until bust or stand)</option>
                  <option value="3">1 hit only (e.g. elimination)</option>
                  <option value="4">2 hits</option>
                  <option value="5">3 hits</option>
                  <option value="2">No hits (2 cards only)</option>
                </select>
              </div>
              <p className="text-[8px] font-heading text-mutedForeground ml-24">
                In elimination rounds, 1 hit is often used.
              </p>
            </div>

            {/* Toggles */}
            <div className="pt-2 border-t border-primary/15 space-y-2">
              <p className="text-[8px] font-heading text-mutedForeground uppercase tracking-widest">House Rules</p>

              {/* Elimination rounds gets its own highlighted row */}
              <label className="flex items-start gap-2.5 cursor-pointer group p-2 rounded-lg transition-colors"
                style={{ background: createEliminationRounds ? 'rgba(251,113,133,0.06)' : 'transparent', border: createEliminationRounds ? '1px solid rgba(251,113,133,0.2)' : '1px solid transparent' }}>
                <div onClick={() => setCreateEliminationRounds((v) => !v)}
                  className="relative w-8 h-4 rounded-full transition-all flex-shrink-0 mt-0.5"
                  style={{
                    background: createEliminationRounds ? 'linear-gradient(90deg,#fb7185,#e11d48)' : 'rgba(255,255,255,0.1)',
                    border: createEliminationRounds ? '1px solid #fb7185' : '1px solid rgba(255,255,255,0.15)',
                    cursor: 'pointer',
                  }}>
                  <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                    style={{ left: createEliminationRounds ? '17px' : '2px', background: createEliminationRounds ? '#fff' : 'rgba(255,255,255,0.4)' }} />
                </div>
                <div>
                  <span className="text-[9px] font-heading font-bold" style={{ color: createEliminationRounds ? '#fb7185' : 'inherit' }}>
                    Elimination Rounds
                  </span>
                  <p className="text-[8px] font-heading text-mutedForeground mt-0.5">
                    Each round, player with the lowest hand is knocked out. Last one standing wins the pot.
                  </p>
                </div>
              </label>

              {[
                { label: 'Exclude yourself from play', val: createExcludeYourself, set: setCreateExcludeYourself },
                { label: 'Anonymous game (hide creator)', val: createAnonymous, set: setCreateAnonymous },
                { label: 'Twenty-one only (only 21 wins)', val: createTwentyOneOnly, set: setCreateTwentyOneOnly },
              ].map(({ label, val, set }) => (
                <label key={label} className="flex items-center gap-2.5 cursor-pointer group">
                  <div onClick={() => set((v) => !v)}
                    className="relative w-8 h-4 rounded-full transition-all flex-shrink-0"
                    style={{
                      background: val ? 'linear-gradient(90deg,var(--noir-primary),#a08020)' : 'rgba(255,255,255,0.1)',
                      border: val ? '1px solid var(--noir-primary-bright)' : '1px solid rgba(255,255,255,0.15)',
                      cursor: 'pointer',
                    }}>
                    <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                      style={{ left: val ? '17px' : '2px', background: val ? '#1a1200' : 'rgba(255,255,255,0.4)' }} />
                  </div>
                  <span className="text-[9px] font-heading text-foreground group-hover:text-primary/80 transition-colors">{label}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button type="button" disabled={creating} onClick={handleCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200', boxShadow: '0 3px 10px rgba(212,175,55,0.2)' }}>
                <Spade size={13} />
                {creating ? 'Dealing…' : 'Deal Cards'}
              </button>
              <button type="button" onClick={() => setCreateOpen(false)}
                className="px-3 py-2 rounded-lg border border-primary/20 text-mutedForeground font-heading text-[9px] uppercase hover:bg-primary/8 transition-colors">
                Cancel
              </button>
            </div>
          </div>

          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,var(--noir-primary-bright),#8b6914,var(--noir-primary-bright),#5a3e1b)' }} />
        </div>
      )}

      {/* ── Open games panel ── */}
      <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 mpbj-fade`} style={{ animationDelay: '0.05s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Open Tables</h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Join a waiting game or deal your own</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all"
            style={{
              background: createOpen ? 'linear-gradient(180deg,var(--noir-primary),#a08020)' : 'rgba(212,175,55,0.12)',
              borderColor: 'var(--noir-primary-bright)',
              color: createOpen ? '#1a1200' : 'var(--noir-primary)',
              boxShadow: createOpen ? '0 3px 10px rgba(212,175,55,0.2)' : 'none',
            }}
          >
            <PlusCircle size={13} />
            {createOpen ? 'Close' : 'Deal New Game'}
          </button>
        </div>

        {/* Game list */}
        <div className="divide-y divide-primary/10">
          {loading ? (
            <p className="text-[10px] text-mutedForeground font-heading py-5 text-center animate-pulse">Scanning the room…</p>
          ) : games.length === 0 ? (
            <div className="py-8 text-center space-y-1">
              <p className="text-2xl opacity-20">♠</p>
              <p className="text-[10px] text-mutedForeground font-heading">No open tables. Be the first to deal.</p>
            </div>
          ) : (
            games.map((g, idx) => {
              const playerCount = g.player_count ?? 0;
              const maxPlayers = g.max_players ?? 6;
              const isOpen = g.status === 'open';
              const isCreator = g.creator_id === myUserId;
              const canCancelOpen = isOpen && (isCreator || isAdmin || isModerator);
              const canJoin = isOpen && playerCount < maxPlayers;
              const isPlaying = g.status === 'playing';
              const isReady = g.phase === 'ready';
              const isCompleted = g.status === 'completed';
              const pips = Array.from({ length: maxPlayers }, (_, i) => i < playerCount);

              return (
                <div
                  key={g.id}
                  className="mpbj-row px-3 py-3 hover:bg-primary/5 transition-colors"
                  style={{ animationDelay: `${0.06 + idx * 0.03}s` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-heading font-bold text-foreground">{g.creator_username ?? '—'}</span>
                        <span
                          className="text-[8px] font-heading font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                          style={
                            isReady
                              ? { background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }
                              : isPlaying
                              ? { background: 'rgba(212,175,55,0.15)', color: 'var(--noir-primary)', border: '1px solid rgba(212,175,55,0.3)' }
                              : isCompleted
                              ? { background: 'rgba(161,161,170,0.12)', color: '#a1a1aa', border: '1px solid rgba(161,161,170,0.2)' }
                              : { background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }
                          }
                        >
                          {isReady ? 'Ready Up' : isPlaying ? `Round ${g.current_round ?? 1}` : isCompleted ? 'Finished' : 'Open'}
                        </span>
                        {g.elimination_rounds && (
                          <span className="inline-flex items-center gap-0.5 text-[8px] font-heading px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(251,113,133,0.12)', color: '#fb7185', border: '1px solid rgba(251,113,133,0.25)' }}>
                            <Swords size={8} /> Elimination
                          </span>
                        )}
                        {g.anonymous && <span className="text-[8px] font-heading text-mutedForeground italic">anon</span>}
                      </div>

                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[9px] font-heading text-mutedForeground">
                          Buy-in <span className="text-primary font-bold">{formatMoney(g.buy_in)}</span>
                        </span>
                        <span className="text-[9px] font-heading text-mutedForeground">
                          Pot <span className="text-primary font-bold">{formatMoney(g.pot)}</span>
                        </span>
                        {g.extra_prize > 0 && (
                          <span className="text-[9px] font-heading text-mutedForeground">
                            Bonus <span className="text-emerald-400 font-bold">{formatMoney(g.extra_prize)}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {pips.map((filled, i) => (
                          <div key={i} className="w-2 h-2 rounded-full"
                            style={{
                              background: filled ? 'var(--noir-primary)' : 'rgba(255,255,255,0.1)',
                              border: filled ? '1px solid rgba(212,175,55,0.6)' : '1px solid rgba(255,255,255,0.1)',
                            }}
                          />
                        ))}
                        <span className="text-[8px] font-heading text-mutedForeground ml-1">{playerCount}/{maxPlayers}</span>
                      </div>

                      {isPlaying && g.phase === 'playing' && (g.current_turn_username != null || g.turn_seconds_left != null) && (
                        <div className="text-[9px] font-heading flex items-center gap-1.5 mt-0.5">
                          <span className="text-mutedForeground">Turn:</span>
                          <span style={{ color: g.current_turn_is_you ? 'var(--noir-primary)' : 'inherit', fontWeight: g.current_turn_is_you ? 700 : 400 }}>
                            {g.current_turn_is_you ? 'You' : (g.current_turn_username ?? '—')}
                          </span>
                          {typeof g.turn_seconds_left === 'number' && (
                            <span className="text-mutedForeground">· {g.turn_seconds_left}s left</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {canCancelOpen && (
                        <button
                          type="button"
                          disabled={cancellingId !== null}
                          onClick={() => handleCancelGame(g.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-heading font-bold text-[9px] uppercase disabled:opacity-50 transition-colors"
                          style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}
                        >
                          <XCircle size={11} />
                          {cancellingId === g.id ? '…' : 'Cancel'}
                        </button>
                      )}
                      {canJoin && (
                        <button
                          type="button"
                          disabled={joiningId !== null}
                          onClick={() => handleJoin(g.id)}
                          className="rounded-lg border-2 px-3 py-1.5 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                          style={{
                            background: 'linear-gradient(180deg,var(--noir-primary),#a08020)',
                            borderColor: 'var(--noir-primary-bright)',
                            color: '#1a1200',
                            boxShadow: '0 2px 8px rgba(212,175,55,0.2)',
                          }}
                        >
                          {joiningId === g.id ? '…' : 'Join'}
                        </button>
                      )}
                      {(isOpen || isPlaying || isCompleted) && (
                        <button
                          type="button"
                          onClick={() => handleOpenGame(g.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-heading font-bold text-[9px] uppercase tracking-wider hover:bg-primary/20 active:scale-[0.97] transition-all text-primary"
                        >
                          <Spade size={11} />
                          {isCompleted ? 'View' : 'Open'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Last 5 games ── */}
      <div className={`${styles.panel} mobile-panel rounded-xl overflow-hidden border border-primary/20 mpbj-fade`} style={{ animationDelay: '0.04s' }}>
        <div className="px-3 py-2 border-b border-primary/20" style={{ background: 'rgba(234,179,8,0.06)' }}>
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest">Last 5 Games</span>
        </div>
        <div className="p-2.5 space-y-1.5">
          {recentGames.length === 0 ? (
            <p className="text-[9px] font-heading text-mutedForeground px-2.5 py-2">No completed games yet.</p>
          ) : (
            recentGames.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[9px] font-heading"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-foreground font-bold truncate">{g.creator_username}</span>
                  <span className="text-mutedForeground">Buy-in {formatMoney(g.buy_in)} · Pot {formatMoney(g.pot)}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold" style={{ color: '#34d399' }}>🏆 {g.winner_username ?? '—'}</span>
                  <span className="tabular-nums font-bold" style={{ color: '#34d399' }}>+{formatMoney(g.pot)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Rules ── */}
      <div className={`${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 mpbj-fade`} style={{ animationDelay: '0.1s' }}>
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest">How It Works</span>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {[
            'All buy-ins go directly into the shared pot',
            'Best hand at the table wins the entire pot',
            'Everyone must Ready Up before cards are dealt',
            'Bust and you lose your buy-in',
            'Elimination mode: lowest hand is knocked out each round',
            'Card limits and 21-only rules set per table',
          ].map((rule) => (
            <div key={rule} className="flex items-start gap-1.5 text-[9px] font-heading text-mutedForeground">
              <span className="text-primary mt-0.5 shrink-0">♠</span>
              {rule}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
