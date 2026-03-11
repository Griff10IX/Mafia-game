import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Zap, PlusCircle, Dices } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const MDG_STYLES = `
  @keyframes mdg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .mdg-fade-in { animation: mdg-fade-in 0.4s ease-out both; }
  .mdg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatFee(game) {
  const pts = Number(game.fee_points ?? 0);
  const money = Number(game.fee_money ?? 0);
  const parts = [];
  if (pts > 0) parts.push(`${pts.toLocaleString()} pts`);
  if (money > 0) parts.push(formatMoney(money));
  return parts.length ? parts.join(' / ') : '—';
}

function formatPot(game) {
  const pts = Number(game.pot_points ?? 0);
  const money = Number(game.pot_money ?? 0);
  const parts = [];
  if (pts > 0) parts.push(`${pts.toLocaleString()} pts`);
  if (money > 0) parts.push(formatMoney(money));
  return parts.length ? parts.join(' + ') : '—';
}

function formatMdgResultToast(data) {
  const roll = data?.roll ?? '?';
  const name = (data?.winner_username || '?').toUpperCase();
  const pts = Number(data?.pot_points ?? 0);
  const money = Number(data?.pot_money ?? 0);
  const parts = [];
  if (money > 0) parts.push(formatMoney(money));
  if (pts > 0) parts.push(`${pts.toLocaleString()} pts`);
  const withStr = parts.length ? ` with ${parts.join(' and ')}` : '';
  return `The dice rolled ${roll} and the winner is ${name}${withStr}!`;
}

function formatExtraPot(game) {
  const pts = Number(game.extra_pot_points ?? 0);
  const money = Number(game.extra_pot_money ?? 0);
  if (pts <= 0 && money <= 0) return '—';
  const parts = [];
  if (pts > 0) parts.push(`${pts.toLocaleString()} pts`);
  if (money > 0) parts.push(formatMoney(money));
  return parts.join(' + ');
}

export default function MDGPage() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [rollingId, setRollingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFeePoints, setCreateFeePoints] = useState('');
  const [createFeeMoney, setCreateFeeMoney] = useState('');
  const [createMaxPlayers, setCreateMaxPlayers] = useState('10');
  const [createAutoRollAt, setCreateAutoRollAt] = useState('');
  const [createExtraPotPoints, setCreateExtraPotPoints] = useState('');
  const [createExtraPotMoney, setCreateExtraPotMoney] = useState('');
  const [creating, setCreating] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);

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
    api.get('/casino/mdg/games').then((r) => setGames(r.data?.games || [])).catch(() => setGames([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchGames();
    const t = setInterval(fetchGames, 8000);
    return () => clearInterval(t);
  }, [fetchGames]);

  const handleJoin = async (gameId) => {
    const game = games.find((g) => g.id === gameId);
    if (game && game.created_by === myUserId) {
      toast.error("You're already in this game (you created it)");
      return;
    }
    setJoiningId(gameId);
    try {
      const res = await api.post('/casino/mdg/join', { game_id: gameId });
      await refreshUser();
      if (res.data?.winner_username != null) {
        toast.success(formatMdgResultToast(res.data));
      } else {
        toast.success(res.data?.message || 'Joined');
      }
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not join');
    } finally {
      setJoiningId(null);
    }
  };

  const handleRoll = async (gameId) => {
    setRollingId(gameId);
    try {
      const res = await api.post('/casino/mdg/roll', { game_id: gameId });
      await refreshUser();
      if (res.data?.winner_username != null) {
        toast.success(formatMdgResultToast(res.data));
      } else {
        toast.success(res.data?.message || 'Roll complete');
      }
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not roll');
    } finally {
      setRollingId(null);
    }
  };

  const handleCreate = async () => {
    const feePoints = parseInt(createFeePoints, 10) || 0;
    const feeMoney = parseFloat(createFeeMoney) || 0;
    if (feePoints <= 0 && feeMoney <= 0) {
      toast.error('Set a fee: points and/or money');
      return;
    }
    setCreating(true);
    try {
      await api.post('/casino/mdg/create', {
        fee_points: feePoints,
        fee_money: feeMoney,
        max_players: Math.max(2, Math.min(100, parseInt(createMaxPlayers, 10) || 10)),
        auto_roll_at: createAutoRollAt.trim() ? Math.max(2, parseInt(createAutoRollAt, 10) || 2) : null,
        extra_pot_points: parseInt(createExtraPotPoints, 10) || 0,
        extra_pot_money: parseFloat(createExtraPotMoney) || 0,
      });
      await refreshUser();
      toast.success('Game created — fee taken (you’re in the game)');
      setCreateOpen(false);
      setCreateFeePoints('');
      setCreateFeeMoney('');
      setCreateMaxPlayers('10');
      setCreateAutoRollAt('');
      setCreateExtraPotPoints('');
      setCreateExtraPotMoney('');
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not create game');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="mdg-page">
      <style>{MDG_STYLES}</style>

      <div className="relative mdg-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Pot Game</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">MDG</h1>
        <p className="text-[10px] text-mutedForeground font-heading italic mt-1">Set a fee, fill spots, one winner takes the pot. Points or money — or both.</p>
      </div>

      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mdg-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Current Games</h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">View & join games below</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(!createOpen)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary font-heading font-bold text-[10px] uppercase tracking-wider hover:bg-primary/25 transition-colors"
          >
            <PlusCircle size={14} /> New game
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
                const entries = g.entries || [];
                const playerNames = entries.map((e) => e.username).join(' – ');
                const isCreator = g.created_by === myUserId;
                const isStaff = isAdmin || isModerator;
                const isIn = entries.some((e) => e.user_id === myUserId) || isCreator;
                const canRoll = (isCreator || isStaff) && entries.length >= 1;
                return (
                  <li key={g.id} className={`py-3 px-2 mdg-fade-in ${styles.raised}`} style={{ animationDelay: `${0.05 + idx * 0.02}s` }}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-[10px] font-heading text-foreground">
                          <span className="text-mutedForeground">Bet: </span>
                          <span className="font-semibold text-foreground">{formatFee(g)}</span>
                          <span className="text-mutedForeground mx-1.5">/</span>
                          <span className="text-mutedForeground">Potential Win: </span>
                          <span className="font-semibold text-primary">{formatPot(g)}</span>
                        </p>
                        <p className="text-[9px] font-heading text-mutedForeground truncate">
                          {playerNames || '—'} {entries.length > 0 && `– ${entries.length} Players`}
                          {(g.extra_pot_points > 0 || g.extra_pot_money > 0) && ` – Extra Pot: ${formatExtraPot(g)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isIn && (
                          <button
                            type="button"
                            disabled={joiningId !== null}
                            onClick={() => handleJoin(g.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[9px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
                          >
                            {joiningId === g.id ? '…' : 'Join'}
                          </button>
                        )}
                        {canRoll && (
                          <button
                            type="button"
                            disabled={rollingId !== null}
                            onClick={() => handleRoll(g.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-amber-500/50 bg-amber-500/20 text-amber-400 font-heading font-bold text-[9px] uppercase hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
                          >
                            <Dices size={12} /> {rollingId === g.id ? '…' : 'Roll'}
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
        <div className={`mdg-art-line text-primary mx-3 ${styles.panelHeader}`} style={{ height: 0, minHeight: 0 }} />
      </div>

      {createOpen && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mdg-fade-in`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Game options</h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Fee (points and/or money), max players, auto-roll when N spots filled, optional extra pot. Max 3 open games. You are auto-joined.</p>
          </div>
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Fee (points)</label>
                <FormattedNumberInput
                  value={createFeePoints}
                  onChange={setCreateFeePoints}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                />
              </div>
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Fee (money)</label>
                <FormattedNumberInput
                  value={createFeeMoney}
                  onChange={setCreateFeeMoney}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Max players</label>
                <input
                  type="number"
                  min={2}
                  max={100}
                  value={createMaxPlayers}
                  onChange={(e) => setCreateMaxPlayers(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                />
              </div>
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Auto-roll after (spots filled)</label>
                <input
                  type="number"
                  min={2}
                  max={100}
                  value={createAutoRollAt}
                  onChange={(e) => setCreateAutoRollAt(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Extra pot (points)</label>
                <FormattedNumberInput
                  value={createExtraPotPoints}
                  onChange={setCreateExtraPotPoints}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                />
              </div>
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Extra pot (money)</label>
                <FormattedNumberInput
                  value={createExtraPotMoney}
                  onChange={setCreateExtraPotMoney}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={creating}
                onClick={handleCreate}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[10px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
              >
                <Zap size={14} /> {creating ? 'Creating…' : 'Create game'}
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
