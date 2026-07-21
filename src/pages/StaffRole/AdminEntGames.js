import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dices, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function Btn({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`px-2 py-1 rounded border text-[10px] font-heading font-bold uppercase tracking-wide disabled:opacity-50 touch-manipulation ${className}`}
    >
      {children}
    </button>
  );
}

const FUNDING_META = {
  system: { label: 'Game (random prize)', cls: 'border-zinc-600/50 text-mutedForeground' },
  entertainer_fund: { label: 'Entertainer fund', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  creator_wallet: { label: "Creator's own wallet", cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
};

const GAME_TYPES = ['all', 'dice', 'gbox', 'hangman'];
const FUNDING_FILTERS = [
  { id: 'all', label: 'All funding' },
  { id: 'system', label: 'Game-funded' },
  { id: 'entertainer_fund', label: 'Entertainer fund' },
  { id: 'creator_wallet', label: 'Own wallet' },
];

export default function AdminEntGames() {
  const navigate = useNavigate();
  const [accessChecked, setAccessChecked] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [gameType, setGameType] = useState('dice');
  const [funding, setFunding] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/admin/check');
        if (cancelled) return;
        if (!res.data?.is_admin) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setAccessChecked(true);
      } catch {
        if (!cancelled) navigate('/dashboard', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (gameType !== 'all') params.set('game_type', gameType);
      if (funding !== 'all') params.set('funding', funding);
      params.set('limit', '200');
      const res = await api.get(`/forum/entertainer/admin/games-audit?${params.toString()}`);
      setData(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load E-Games audit');
    } finally {
      setLoading(false);
    }
  }, [gameType, funding]);

  useEffect(() => {
    if (accessChecked) load();
  }, [accessChecked, load]);

  if (!accessChecked) {
    return (
      <div className={`${styles.panel} rounded-lg border border-primary/20 p-6 text-center text-mutedForeground font-heading text-sm`}>
        Checking access…
      </div>
    );
  }

  const totals = data?.totals;
  const creators = data?.creators || [];
  const games = data?.games || [];

  return (
    <div className="space-y-4 max-w-4xl" data-testid="admin-ent-games-page">
      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Dices className="text-primary" size={18} />
            <h1 className="text-sm font-heading font-bold uppercase tracking-wider text-foreground">
              E-Games audit (Entertainer Forum)
            </h1>
            <Btn
              onClick={load}
              disabled={loading}
              className="ml-auto border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            >
              <RefreshCw size={11} className="inline mr-1 -mt-0.5" />
              {loading ? '…' : 'Refresh'}
            </Btn>
          </div>
          <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
            Every dice / gbox / hangman game: who created it, what was rewarded, and whose points paid for it.
            &quot;Game (random prize)&quot; games never pay points — points only come from manual games, which are
            fully reserved at create time from either the staff entertainer fund or the creator&apos;s own wallet.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {GAME_TYPES.map((t) => (
              <Btn
                key={t}
                onClick={() => setGameType(t)}
                className={gameType === t
                  ? 'border-primary/60 bg-primary/20 text-primary'
                  : 'border-zinc-600/50 text-mutedForeground hover:bg-zinc-800/60'}
              >
                {t}
              </Btn>
            ))}
            <span className="w-px bg-zinc-700/60 mx-1" />
            {FUNDING_FILTERS.map((f) => (
              <Btn
                key={f.id}
                onClick={() => setFunding(f.id)}
                className={funding === f.id
                  ? 'border-primary/60 bg-primary/20 text-primary'
                  : 'border-zinc-600/50 text-mutedForeground hover:bg-zinc-800/60'}
              >
                {f.label}
              </Btn>
            ))}
          </div>

          {totals && (
            <div className="flex flex-wrap gap-2 text-[9px] font-heading border-t border-zinc-700/50 pt-3">
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                Games: <span className="font-bold text-foreground">{Number(totals.games || 0).toLocaleString()}</span>
              </span>
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                Points paid out: <span className="font-bold text-foreground">{Number(totals.points_paid || 0).toLocaleString()}</span>
              </span>
              <span className="rounded border border-sky-500/30 px-1.5 py-0.5 text-sky-300">
                From entertainer fund: <span className="font-bold">{Number(totals.points_from_entertainer_fund || 0).toLocaleString()}</span>
              </span>
              <span className="rounded border border-amber-500/30 px-1.5 py-0.5 text-amber-300">
                From creators&apos; own points: <span className="font-bold">{Number(totals.points_from_creator_wallets || 0).toLocaleString()}</span>
              </span>
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                Cash paid out: <span className="font-bold text-foreground">${Number(totals.cash_paid || 0).toLocaleString()}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {creators.length > 0 && (
        <div className={`${styles.panel} rounded-lg border border-primary/20 p-4 space-y-2`}>
          <div className="text-[10px] font-heading font-bold uppercase text-mutedForeground">
            By creator ({creators.length})
          </div>
          <div className="space-y-1">
            {creators.map((c) => (
              <div
                key={c.creator_id || c.creator_username}
                className="flex flex-wrap items-center gap-2 rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5 text-[9px] font-heading"
              >
                {c.creator_id === 'system' ? (
                  <span className="text-[11px] font-bold text-mutedForeground">System</span>
                ) : (
                  <Link
                    to={`/profile/${encodeURIComponent(c.creator_username)}`}
                    className="text-[11px] font-bold text-primary hover:underline"
                  >
                    {c.creator_username}
                  </Link>
                )}
                <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                  {c.games} game{c.games === 1 ? '' : 's'}
                </span>
                <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                  {Number(c.points_paid || 0).toLocaleString()} pts paid
                </span>
                <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                  ${Number(c.cash_paid || 0).toLocaleString()} cash paid
                </span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {Object.entries(c.funding_counts || {}).filter(([, n]) => n > 0).map(([src, n]) => (
                    <span key={src} className={`rounded border px-1.5 py-0.5 ${FUNDING_META[src]?.cls || 'border-zinc-600/50'}`}>
                      {n}× {FUNDING_META[src]?.label || src}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${styles.panel} rounded-lg border border-primary/20 p-4 space-y-3`}>
        <div className="text-[10px] font-heading font-bold uppercase text-mutedForeground">
          Games {data ? `(${games.length})` : ''}
        </div>

        {loading && !data ? (
          <p className="text-[10px] text-mutedForeground font-heading">Loading…</p>
        ) : games.length === 0 ? (
          <p className="text-[10px] text-mutedForeground font-heading">No games match this filter.</p>
        ) : (
          <div className="space-y-2">
            {games.map((g) => {
              const meta = FUNDING_META[g.funding] || FUNDING_META.system;
              const expanded = expandedId === g.id;
              return (
                <div key={g.id} className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[9px] font-heading">
                    <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary font-bold uppercase">
                      {g.game_type}
                    </span>
                    {g.creator_id === 'system' ? (
                      <span className="text-[10px] font-bold text-mutedForeground">System</span>
                    ) : (
                      <Link
                        to={`/profile/${encodeURIComponent(g.creator_username)}`}
                        className="text-[10px] font-bold text-primary hover:underline"
                      >
                        {g.creator_username}
                      </Link>
                    )}
                    <span className={`rounded border px-1.5 py-0.5 ${meta.cls}`}>{meta.label}</span>
                    <span className={`rounded border px-1.5 py-0.5 ${g.status === 'completed' ? 'border-emerald-500/30 text-emerald-300' : 'border-zinc-600/50 text-mutedForeground'}`}>
                      {g.status}
                    </span>
                    <span className="ml-auto text-mutedForeground">
                      {g.completed_at ? formatAdminDateTime(g.completed_at) : (g.created_at ? formatAdminDateTime(g.created_at) : '—')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[9px] font-heading text-mutedForeground">
                    {g.reward_points > 0 && (
                      <span className="rounded border border-amber-500/30 px-1.5 py-0.5 text-amber-200/90">
                        Reward: {Number(g.reward_points).toLocaleString()} pts
                      </span>
                    )}
                    {g.reward_money > 0 && (
                      <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                        Reward: ${Number(g.reward_money).toLocaleString()}
                      </span>
                    )}
                    {g.pot > 0 && (
                      <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                        Pot: ${Number(g.pot).toLocaleString()}
                      </span>
                    )}
                    {g.join_fee > 0 && (
                      <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                        Entry: ${Number(g.join_fee).toLocaleString()}
                      </span>
                    )}
                    <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                      {(g.participants || []).length} player{(g.participants || []).length === 1 ? '' : 's'}
                    </span>
                    {g.winners?.length > 0 && (
                      <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-emerald-300">
                        Winner{g.winners.length === 1 ? '' : 's'}: {g.winners.join(', ')}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : g.id)}
                      className="ml-auto text-[9px] text-primary hover:underline font-heading"
                    >
                      {expanded ? 'Hide details' : 'Details'}
                    </button>
                  </div>

                  {expanded && (
                    <div className="space-y-1 border-t border-zinc-700/50 pt-1.5 text-[9px] font-heading text-mutedForeground">
                      {g.reward_text && <div>Paid out: {g.reward_text}</div>}
                      <div>
                        Players: {(g.participants || []).length ? g.participants.join(', ') : '—'}
                      </div>
                      <div>
                        Created: {g.created_at ? formatAdminDateTime(g.created_at) : '—'}
                        {g.completed_at ? ` · Settled: ${formatAdminDateTime(g.completed_at)}` : ''}
                        {` · ${g.manual_roll ? 'Manual roll' : 'Auto settle'}`}
                      </div>
                      <div className="font-mono opacity-60">{g.id}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
