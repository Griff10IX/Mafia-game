import { useCallback, useEffect, useMemo, useState } from 'react';
import { Skull, Shovel, Clock3, Coins, Sparkles, Gem, AlertTriangle, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const GR_STYLES = `
  @keyframes gr-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes gr-dig { 0%, 100% { transform: translateY(0) rotate(0deg); } 25% { transform: translateY(-2px) rotate(-1deg); } 50% { transform: translateY(1px) rotate(1deg); } 75% { transform: translateY(-1px) rotate(-0.5deg); } }
  @keyframes gr-fog { 0% { transform: translateX(-6%); opacity: 0.18; } 100% { transform: translateX(6%); opacity: 0.3; } }
  @keyframes gr-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(var(--noir-primary-rgb), 0.35); } 50% { box-shadow: 0 0 0 5px rgba(var(--noir-primary-rgb), 0); } }
  .gr-fade-in { animation: gr-fade-in .35s ease-out both; }
  .gr-dig { animation: gr-dig .55s ease-in-out infinite; }
  .gr-fog { animation: gr-fog 7s ease-in-out infinite alternate; }
  .gr-glow { animation: gr-glow 1.7s ease-in-out infinite; }
  .gr-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}h ${m}m ${r}s`;
}

function rewardText(reward) {
  const r = reward || {};
  if (r.kind === 'nothing') return 'Empty grave. Nothing found.';
  if (r.kind === 'cash') return `Found stash: ${formatMoney(r.money)}`;
  if (r.kind === 'bullets') return `Found ammo: ${Number(r.bullets || 0).toLocaleString()} bullets`;
  if (r.kind === 'points') return `Found intel: ${Number(r.points || 0).toLocaleString()} points`;
  if (r.kind === 'tokens') {
    const parts = (r.tokens || []).map((t) => `${Number(t.amount || 0)} ${String(t.token_type || '').replace(/_/g, ' ')}`);
    return parts.length ? `Found token bundle: ${parts.join(', ')}` : 'Found tokens.';
  }
  if (r.kind === 'car' && r.car) return `You found the keys to "${r.car.name}"`;
  return 'The grave gave up something.';
}

function rewardIcon(reward) {
  const k = reward?.kind;
  if (k === 'cash') return <Coins size={14} className="text-emerald-400" />;
  if (k === 'bullets') return <Sparkles size={14} className="text-amber-400" />;
  if (k === 'points') return <Gem size={14} className="text-sky-400" />;
  if (k === 'tokens') return <Sparkles size={14} className="text-primary" />;
  if (k === 'car') return <Gem size={14} className="text-violet-400" />;
  return <Skull size={14} className="text-zinc-500" />;
}

function formatRecentAttemptLine(row) {
  const attemptNo = Number(row?.attempt_number || 0);
  const result = rewardText(row?.reward);
  const cost = formatMoney(row?.attempt_cost);
  const at = row?.attempted_at ? new Date(row.attempted_at).toLocaleString() : '—';
  return `#${attemptNo} · ${result} · Cost ${cost} · ${at}`;
}

export default function GraveRobber() {
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const [digging, setDigging] = useState(false);
  const [latest, setLatest] = useState(null);

  const fetchStatus = useCallback(async (silent = false) => {
    try {
      const res = await api.get('/grave-robber/status');
      setStatus(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load Grave Robber');
      setStatus(null);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (!status?.cooldown_active || !status?.cooldown_remaining_seconds) return undefined;
    const id = setInterval(() => {
      setStatus((prev) => {
        if (!prev?.cooldown_active) return prev;
        const next = Math.max(0, Number(prev.cooldown_remaining_seconds || 0) - 1);
        return {
          ...prev,
          cooldown_remaining_seconds: next,
          cooldown_active: next > 0,
          cooldown_until: next > 0 ? prev.cooldown_until : null,
        };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [status?.cooldown_active, status?.cooldown_remaining_seconds]);

  const attemptsUsed = Number(status?.attempts_used || 0);
  const attemptsTotal = Number(status?.attempts_total || 50);
  const attemptsRemaining = Number(status?.attempts_remaining || 0);
  const progressPct = attemptsTotal > 0 ? Math.min(100, (attemptsUsed / attemptsTotal) * 100) : 0;
  const canStart = !status?.cooldown_active && !status?.run_started;
  const canDig = !!status?.run_started && attemptsRemaining > 0 && !status?.cooldown_active;
  const totalSpent = Number(status?.total_spent || 0);
  const totalRewardsCash = Number(status?.total_rewards_cash || 0);
  const totalNetCash = Number(status?.total_net_cash || (totalRewardsCash - totalSpent));
  const globalSpent = Number(status?.global_cash_spent || 0);
  const globalCashWon = Number(status?.global_cash_won || 0);
  const globalNetCash = Number(status?.global_net_cash || (globalCashWon - globalSpent));

  const tierChips = useMemo(() => {
    const list = [];
    const tiers = Number(status?.tier_count || 20);
    const activeTier = Number(status?.tier_index || 0);
    for (let i = 0; i < tiers; i += 1) list.push({ i, active: i === activeTier, done: i < activeTier });
    return list;
  }, [status?.tier_count, status?.tier_index]);

  const onStartRun = async () => {
    setStarting(true);
    try {
      const res = await api.post('/grave-robber/start-run');
      toast.success(res.data?.message || 'Run started');
      setLatest(null);
      await fetchStatus(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start run');
    } finally {
      setStarting(false);
    }
  };

  const onDig = async () => {
    setDigging(true);
    try {
      const res = await api.post('/grave-robber/attempt');
      setLatest(res.data?.attempt || null);
      if (res.data?.hitlist_event?.bounty_cash) {
        toast.warning(`You were spotted and added to hitlist for ${formatMoney(res.data.hitlist_event.bounty_cash)}.`);
      }
      refreshUser();
      await fetchStatus(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Dig failed');
    } finally {
      setDigging(false);
    }
  };

  const onCopyRecent = async (row) => {
    const line = formatRecentAttemptLine(row);
    try {
      await navigator.clipboard.writeText(line);
      toast.success('Copied line to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };

  if (!status) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root`}>
        <style>{GR_STYLES}</style>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="grave-robber-page">
      <style>{GR_STYLES}</style>

      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="absolute inset-0 pointer-events-none opacity-40 gr-fog bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_65%)]" />
        <div className="px-4 py-3 relative">
          <div className="flex items-center gap-2">
            <Skull size={16} className="text-primary/80" />
            <h1 className="text-[11px] font-heading font-bold uppercase tracking-[0.2em] text-primary">Grave Robber</h1>
          </div>
          <p className="text-[10px] text-zinc-500 font-heading italic mt-1">
            Disturb the fallen gangsters. Some graves are empty. Some are loaded.
          </p>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-heading">
            <div className="rounded border border-primary/15 bg-black/20 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Run</p>
              <p className="text-foreground font-bold tabular-nums">{attemptsUsed}/{attemptsTotal}</p>
            </div>
            <div className="rounded border border-primary/15 bg-black/20 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Current cost</p>
              <p className="text-primary font-bold tabular-nums">{formatMoney(status?.current_attempt_cost || 0)}</p>
            </div>
            <div className="rounded border border-primary/15 bg-black/20 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Next cost</p>
              <p className="text-amber-400 font-bold tabular-nums">{formatMoney(status?.next_attempt_cost || 0)}</p>
            </div>
          </div>

          <div className="mt-2">
            <div className="h-2 rounded bg-zinc-900/70 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-zinc-600 via-primary to-amber-400 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-1 text-[9px] text-zinc-500 font-heading">
              Progress {progressPct.toFixed(1)}% · Cost scales +{Math.round((Number(status?.tier_multiplier || 1.15) - 1) * 100)}% every {status?.tier_step_percent || 5}%.
            </p>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {tierChips.map((t) => (
              <span
                key={t.i}
                className={`h-2 w-2 rounded-full border ${
                  t.active ? 'bg-primary border-primary/80 gr-glow' : t.done ? 'bg-amber-500/70 border-amber-500/80' : 'bg-zinc-700 border-zinc-600'
                }`}
                title={`Tier ${t.i + 1}`}
              />
            ))}
          </div>

          {status?.cooldown_active && (
            <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 flex items-center gap-2 text-[10px] font-heading text-amber-300">
              <Clock3 size={12} className="shrink-0" />
              Cooldown active: {formatCountdown(status.cooldown_remaining_seconds)}
            </div>
          )}

          <div className="mt-3 rounded border border-primary/20 bg-primary/5 px-2.5 py-2">
            <p className="text-[9px] font-heading font-bold uppercase tracking-[0.14em] text-primary mb-1">How it works</p>
            <ul className="space-y-0.5 text-[9px] text-zinc-500 font-heading">
              <li>Run = 50 digs. Start at {formatMoney(status?.base_attempt_cost || 1_000_000)} per dig.</li>
              <li>Cost rises by +{Math.round((Number(status?.tier_multiplier || 1.15) - 1) * 100)}% every {status?.tier_step_percent || 5}% progress.</li>
              <li>After dig #50, cooldown is {status?.cooldown_hours || 24}h before a new run.</li>
              <li>Possible outcomes: nothing, cash, bullets, points, tokens, or a non-exclusive car.</li>
              <li>
                Heat: about {Math.round(Number(status?.jail_chance_per_dig ?? 0.04) * 100)}% chance per dig of
                {' '}{Number(status?.jail_seconds_on_caught ?? 60)}s jail (unbreakable for that term).
              </li>
              <li>Profit/Loss below tracks cash only (other rewards are extra value).</li>
            </ul>
          </div>
        </div>
        <div className="gr-art-line text-primary mx-3 mb-1" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Dig Site</p>
            <p className="text-[10px] text-zinc-500 font-heading">
              Spend cash to crack open tombs. Misses happen. Big hits do too.
            </p>
            <div className="flex items-center gap-2">
              {canStart ? (
                <button
                  type="button"
                  onClick={onStartRun}
                  disabled={starting}
                  className="flex-1 py-2 rounded border border-primary/40 bg-primary/15 text-primary font-heading font-bold uppercase tracking-wider text-[10px] hover:bg-primary/25 disabled:opacity-50"
                >
                  {starting ? 'Starting...' : 'Start Run (50 Graves)'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onDig}
                  disabled={!canDig || digging}
                  className="flex-1 py-2 rounded border border-primary/40 bg-primary/15 text-primary font-heading font-bold uppercase tracking-wider text-[10px] hover:bg-primary/25 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Shovel size={12} className={digging ? 'gr-dig' : ''} />
                  {digging ? 'Digging...' : 'Dig Next Grave'}
                </button>
              )}
            </div>
            {!canStart && !canDig && !status?.cooldown_active && (
              <div className="text-[10px] text-zinc-500 font-heading rounded border border-zinc-700/40 bg-zinc-800/20 px-2 py-1.5">
                Run is complete. Wait out cooldown to start again.
              </div>
            )}
          </div>
          <div className="gr-art-line text-primary mx-3 mb-1" />
        </div>

        <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Last Dig</p>
            {latest ? (
              <div className={`rounded border px-2.5 py-2 ${latest.reward?.kind === 'nothing' ? 'border-zinc-700/60 bg-zinc-800/30' : 'border-primary/30 bg-primary/10'}`}>
                <div className="flex items-center gap-1.5">
                  {rewardIcon(latest.reward)}
                  <p className="text-[10px] font-heading font-bold text-foreground">Attempt #{latest.attempt_number}</p>
                </div>
                <p className="text-[10px] font-heading text-zinc-300 mt-1">{rewardText(latest.reward)}</p>
                <p className="text-[9px] text-zinc-500 font-heading mt-1">
                  Spent {formatMoney(latest.attempt_cost)} this dig.
                </p>
              </div>
            ) : (
              <div className="rounded border border-zinc-700/50 bg-zinc-800/20 px-2.5 py-2 text-[10px] text-zinc-500 font-heading">
                No dig yet in this session.
              </div>
            )}
          </div>
          <div className="gr-art-line text-primary mx-3 mb-1" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.06s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 border-b border-primary/15">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">What You Can Win</p>
            <p className="text-[9px] text-zinc-500 font-heading">Values below use your current dig cost.</p>
          </div>
          <div className="p-2.5 space-y-1.5">
            {(status?.possible_wins || []).map((w, idx) => (
              <div key={`${w.kind}-${idx}`} className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5 flex items-center gap-2">
                <div className="shrink-0">{rewardIcon({ kind: w.kind })}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-heading text-foreground">
                    {w.label} <span className="text-zinc-500">({Number(w.chance_pct || 0)}%)</span>
                  </p>
                  {typeof w.details === 'string' ? (
                    <p className="text-[9px] text-zinc-500 font-heading">{w.details}</p>
                  ) : (
                    <p className="text-[9px] text-zinc-500 font-heading">
                      {w.kind === 'cash' && `Range ${formatMoney(w.details?.min)} - ${formatMoney(w.details?.max)}`}
                      {w.kind === 'bullets' && `Range ${Number(w.details?.min || 0).toLocaleString()} - ${Number(w.details?.max || 0).toLocaleString()} bullets`}
                      {w.kind === 'points' && `Range ${Number(w.details?.min || 0).toLocaleString()} - ${Number(w.details?.max || 0).toLocaleString()} points (cap ${Number(w.details?.max_cap || 100)})`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="gr-art-line text-primary mx-3 mb-1" />
        </div>

        <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.07s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 border-b border-primary/15">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Profit / Loss</p>
            <p className="text-[9px] text-zinc-500 font-heading">Cash-only run tracker.</p>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-heading">
            <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Spent</p>
              <p className="text-rose-400 font-bold tabular-nums">{formatMoney(totalSpent)}</p>
            </div>
            <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Cash won</p>
              <p className="text-emerald-400 font-bold tabular-nums">{formatMoney(totalRewardsCash)}</p>
            </div>
            <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
              <p className="text-zinc-500 uppercase tracking-wider">Net</p>
              <p className={`font-bold tabular-nums ${totalNetCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totalNetCash >= 0 ? '+' : '-'}{formatMoney(Math.abs(totalNetCash))}
              </p>
            </div>
          </div>
          <div className="px-3 pb-2">
            <p className="text-[9px] text-zinc-600 font-heading">
              Net uses cash in vs cash out only. Bullets, points, tokens, and cars are extra value not included in this line.
            </p>
          </div>
          <div className="gr-art-line text-primary mx-3 mb-1" />
        </div>
      </div>

      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.075s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2 border-b border-primary/15">
          <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Game-Wide Profit / Loss</p>
          <p className="text-[9px] text-zinc-500 font-heading">All players combined (cash-only).</p>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-heading">
          <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
            <p className="text-zinc-500 uppercase tracking-wider">Spent</p>
            <p className="text-rose-400 font-bold tabular-nums">{formatMoney(globalSpent)}</p>
          </div>
          <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
            <p className="text-zinc-500 uppercase tracking-wider">Cash won</p>
            <p className="text-emerald-400 font-bold tabular-nums">{formatMoney(globalCashWon)}</p>
          </div>
          <div className="rounded border border-zinc-700/50 bg-zinc-900/35 px-2.5 py-2">
            <p className="text-zinc-500 uppercase tracking-wider">Net</p>
            <p className={`font-bold tabular-nums ${globalNetCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {globalNetCash >= 0 ? '+' : '-'}{formatMoney(Math.abs(globalNetCash))}
            </p>
          </div>
        </div>
        <div className="px-3 pb-2">
          <p className="text-[9px] text-zinc-600 font-heading">
            Same scope as personal P/L: cash only. Bullets, points, tokens, and cars are excluded from this net line.
          </p>
        </div>
        <div className="gr-art-line text-primary mx-3 mb-1" />
      </div>

      <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 gr-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2 border-b border-primary/15 flex items-center justify-between">
          <p className="text-[10px] font-heading font-bold uppercase tracking-[0.15em] text-primary">Recent Digs</p>
          <p className="text-[9px] text-zinc-600 font-heading">Latest {Array.isArray(status?.recent_attempts) ? status.recent_attempts.length : 0}</p>
        </div>
        <div className="p-2.5 space-y-1.5 max-h-80 overflow-y-auto">
          {Array.isArray(status?.recent_attempts) && status.recent_attempts.length > 0 ? (
            status.recent_attempts.map((row) => (
              <div key={row.id} className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5 flex items-center gap-2">
                <div className="shrink-0">{rewardIcon(row.reward)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-heading text-foreground truncate">
                    #{row.attempt_number} · {rewardText(row.reward)}
                  </p>
                  <p className="text-[9px] font-heading text-zinc-600">
                    Cost {formatMoney(row.attempt_cost)} · {row.attempted_at ? new Date(row.attempted_at).toLocaleString() : '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onCopyRecent(row)}
                  className="inline-flex items-center justify-center w-5 h-5 rounded border border-zinc-600/60 text-zinc-400 hover:text-primary hover:border-primary/50 transition-colors shrink-0"
                  title="Copy this line"
                  aria-label="Copy this line"
                >
                  <Copy size={11} />
                </button>
                <ChevronRight size={12} className="text-zinc-600 shrink-0" />
              </div>
            ))
          ) : (
            <div className="rounded border border-zinc-700/40 bg-zinc-900/30 px-2.5 py-2 text-[10px] text-zinc-500 font-heading flex items-center gap-1.5">
              <AlertTriangle size={11} className="text-zinc-600" />
              No attempt history yet.
            </div>
          )}
        </div>
        <div className="gr-art-line text-primary mx-3 mb-1" />
      </div>
    </div>
  );
}
