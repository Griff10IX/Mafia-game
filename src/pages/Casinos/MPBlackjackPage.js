import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PlusCircle, Spade } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const MPBJ_STYLES = `
  @keyframes mpbj-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .mpbj-fade-in { animation: mpbj-fade-in 0.4s ease-out both; }
  .mpbj-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

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
  const [creating, setCreating] = useState(false);
  const [myUserId, setMyUserId] = useState(null);

  useEffect(() => {
    api.get('/auth/me').then((r) => setMyUserId(r.data?.id ?? null)).catch(() => setMyUserId(null));
  }, []);

  const fetchGames = useCallback(() => {
    api
      .get('/casino/mp-blackjack/games')
      .then((r) => setGames(r.data?.games || []))
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
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
      if (res.data?.game?.id) {
        navigate(`/casino/mp-blackjack/game/${res.data.game.id}`);
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not join');
    } finally {
      setJoiningId(null);
    }
  };

  const handleOpenGame = (gameId) => {
    navigate(`/casino/mp-blackjack/game/${gameId}`);
  };

  const handleCreate = async () => {
    const buyIn = parseInt(createBuyIn.replace(/\D/g, ''), 10) || 0;
    const extraPrize = parseInt(String(createExtraPrize).replace(/\D/g, ''), 10) || 0;
    if (buyIn <= 0) {
      toast.error('Buy-in must be positive');
      return;
    }
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
      fetchGames();
      if (res.data?.game_id) {
        navigate(`/casino/mp-blackjack/game/${res.data.game_id}`);
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not create game');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="mp-blackjack-page">
      <style>{MPBJ_STYLES}</style>

      <div className="relative mpbj-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Pot game</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">Multiplayer Blackjack</h1>
        <p className="text-[10px] text-mutedForeground font-heading italic mt-1">2–8 players, buy-in goes to the pot. Best hand wins. No table owner.</p>
      </div>

      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mpbj-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Open games</h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Join or create a game</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(!createOpen)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary font-heading font-bold text-[10px] uppercase tracking-wider hover:bg-primary/25 transition-colors"
          >
            <PlusCircle size={14} /> Create game
          </button>
        </div>
        <div className="p-2">
          {loading ? (
            <p className="text-[10px] text-mutedForeground font-heading py-4 text-center">Loading…</p>
          ) : games.length === 0 ? (
            <p className="text-[10px] text-mutedForeground font-heading py-4 text-center">No open games. Create one above.</p>
          ) : (
            <ul className="space-y-0 divide-y divide-primary/10">
              {games.map((g, idx) => {
                const playerCount = g.player_count ?? 0;
                const maxPlayers = g.max_players ?? 6;
                const isOpen = g.status === 'open';
                const isIn = isOpen && games.some((x) => x.id === g.id); // we don't have "am I in" on list; show Join for open
                const canJoin = isOpen && playerCount < maxPlayers;
                return (
                  <li key={g.id} className={`py-3 px-2 mpbj-fade-in ${styles.raised}`} style={{ animationDelay: `${0.05 + idx * 0.02}s` }}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-[10px] font-heading text-foreground">
                          <span className="text-mutedForeground">By </span>
                          <span className="font-semibold text-foreground">{g.creator_username ?? '—'}</span>
                          <span className="text-mutedForeground mx-1.5">·</span>
                          <span className="text-mutedForeground">Buy-in </span>
                          <span className="font-semibold text-primary">{formatMoney(g.buy_in)}</span>
                          <span className="text-mutedForeground mx-1.5">·</span>
                          <span className="text-mutedForeground">Pot </span>
                          <span className="font-semibold text-primary">{formatMoney(g.pot)}</span>
                        </p>
                        <p className="text-[9px] font-heading text-mutedForeground">
                          Players {playerCount}/{maxPlayers}
                          {g.extra_prize > 0 && ` · Extra prize ${formatMoney(g.extra_prize)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {canJoin && (
                          <button
                            type="button"
                            disabled={joiningId !== null}
                            onClick={() => handleJoin(g.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[9px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
                          >
                            {joiningId === g.id ? '…' : 'Join'}
                          </button>
                        )}
                        {(isOpen || g.status === 'playing' || g.status === 'completed') && (
                          <button
                            type="button"
                            onClick={() => handleOpenGame(g.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[9px] uppercase hover:bg-primary/30 transition-colors"
                          >
                            <Spade size={12} /> {g.status === 'completed' ? 'View' : 'Open'}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={`mpbj-art-line text-primary mx-3 ${styles.panelHeader}`} style={{ height: 0, minHeight: 0 }} />
      </div>

      {createOpen && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mpbj-fade-in`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Create game</h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Players 2–8, buy-in (money), optional extra prize. You pay buy-in + extra prize and are first player.</p>
          </div>
          <div className="p-3 space-y-3">
            <div>
              <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Players (2–8)</label>
              <select
                value={createMaxPlayers}
                onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
              >
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Buy-in ($)</label>
              <FormattedNumberInput
                value={createBuyIn}
                onChange={setCreateBuyIn}
                placeholder="100000"
                className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
              />
            </div>
            <div>
              <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Additional prize ($, optional)</label>
              <FormattedNumberInput
                value={createExtraPrize}
                onChange={setCreateExtraPrize}
                placeholder="0"
                className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
              />
            </div>
            <div className="space-y-2 pt-1 border-t border-primary/20">
              <p className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider">Additional options</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createExcludeYourself}
                  onChange={(e) => setCreateExcludeYourself(e.target.checked)}
                  className="rounded border-primary/30 bg-secondary/50 text-primary"
                />
                <span className="text-[10px] font-heading text-foreground">Exclude yourself</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createAnonymous}
                  onChange={(e) => setCreateAnonymous(e.target.checked)}
                  className="rounded border-primary/30 bg-secondary/50 text-primary"
                />
                <span className="text-[10px] font-heading text-foreground">Anonymous game</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createTwentyOneOnly}
                  onChange={(e) => setCreateTwentyOneOnly(e.target.checked)}
                  className="rounded border-primary/30 bg-secondary/50 text-primary"
                />
                <span className="text-[10px] font-heading text-foreground">Twenty one only (only 21 wins)</span>
              </label>
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Max cards per hand</label>
                <select
                  value={createCardLimit}
                  onChange={(e) => setCreateCardLimit(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                >
                  <option value="no_limit">No limit</option>
                  <option value="2">2 cards</option>
                  <option value="3">3 cards</option>
                  <option value="5">5 cards</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={creating}
                onClick={handleCreate}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[10px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
              >
                <Spade size={14} /> {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-3 py-2 rounded border border-primary/20 text-mutedForeground font-heading text-[10px] uppercase hover:bg-primary/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
