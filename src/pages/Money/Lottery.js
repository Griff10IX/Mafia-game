import { useCallback, useEffect, useState } from 'react';
import { Ticket, Clock, Trophy, Percent, Coins, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const LOT_STYLES = `
  @keyframes lot-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .lot-fade-in { animation: lot-fade-in 0.4s ease-out both; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  return fallback;
}

function Lottery() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [count, setCount] = useState(1);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/lottery');
      setState(data);
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Could not load lottery'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (tick % 30 === 0 && tick > 0) load();
  }, [tick, load]);

  const secondsLeft = state?.seconds_until_close ?? 0;

  const onBuy = async () => {
    const n = Math.min(500, Math.max(1, parseInt(String(count), 10) || 1));
    setBuying(true);
    try {
      const { data } = await api.post('/lottery/buy', { count: n });
      toast.success(data?.message || 'Tickets purchased');
      await refreshUser();
      await load();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Purchase failed'));
    } finally {
      setBuying(false);
    }
  };

  if (loading && !state) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root`}>
        <style>{LOT_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Ticket size={22} className="text-primary/40 animate-pulse" />
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading lottery...</span>
        </div>
      </div>
    );
  }

  const last = state?.last_draw;
  const netIfWon = state?.gross_pot != null && state?.pot_tax_percent != null
    ? Math.floor((Number(state.gross_pot) * (100 - Number(state.pot_tax_percent))) / 100)
    : null;

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`}>
      <style>{LOT_STYLES}</style>
      <div className="flex flex-col gap-1 lot-fade-in">
        <h1 className="text-lg font-heading font-bold text-primary flex items-center gap-2">
          <Ticket size={22} className="shrink-0" />
          City Lottery
        </h1>
        <p className="text-[10px] text-mutedForeground font-heading max-w-xl">
          $500,000 per ticket. Draws Wednesday and Sunday at 00:00 UTC. Ten percent of the gross pot is removed at draw; ninety percent goes to one random ticket holder. Buy as many tickets as you can afford.
        </p>
      </div>

      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lot-fade-in mobile-panel`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1">
          <Clock size={12} className="text-primary" />
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Current round</span>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading">Closes (UTC)</div>
            <div className="text-sm font-heading font-bold tabular-nums">
              {state?.closes_at
                ? new Date(state.closes_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                : '—'}
            </div>
            <div className="text-[11px] text-amber-400/90 font-heading tabular-nums">
              {formatDuration(secondsLeft)} left
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading">Gross pot</div>
            <div className="text-lg font-heading font-bold text-emerald-400 tabular-nums">{formatMoney(state?.gross_pot)}</div>
            {netIfWon != null && (
              <div className="text-[10px] text-zinc-400 font-heading">
                Winner receives ~{formatMoney(netIfWon)} ({100 - (state?.pot_tax_percent ?? 10)}% after {state?.pot_tax_percent ?? 10}% tax)
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading flex items-center gap-2">
              <Coins size={10} /> Ticket price
            </div>
            <div className="text-sm font-heading font-bold tabular-nums">{formatMoney(state?.ticket_price)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading flex items-center gap-2">
              <ShoppingCart size={10} /> Your tickets this round
            </div>
            <div className="text-sm font-heading font-bold tabular-nums">{state?.my_tickets ?? 0}</div>
            <div className="text-[11px] text-zinc-500 font-heading">Total tickets: {state?.ticket_count?.toLocaleString?.() ?? state?.ticket_count ?? 0}</div>
          </div>
        </div>
      </div>

      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lot-fade-in mobile-panel`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1">
          <Ticket size={12} className="text-primary" />
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Buy tickets</span>
        </div>
        <div className="p-3 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="lottery-count" className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading">Count (1–500)</label>
            <input
              id="lottery-count"
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full max-w-[200px] px-2 py-1.5 rounded border border-primary/25 bg-background text-foreground text-sm font-heading tabular-nums"
            />
            <div className="text-[10px] text-zinc-500 font-heading">
              Total: {formatMoney((Number(state?.ticket_price) || 1) * (Math.min(500, Math.max(1, parseInt(String(count), 10) || 1))))}
            </div>
          </div>
          <button
            type="button"
            onClick={onBuy}
            disabled={buying}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-[11px] font-heading font-bold uppercase tracking-wider disabled:opacity-50"
          >
            {buying ? 'Buying…' : 'Buy'}
          </button>
        </div>
      </div>

      {last && (
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lot-fade-in mobile-panel`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1">
            <Trophy size={12} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Last draw</span>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-heading">
            <div>
              <span className="text-zinc-500">Drawn: </span>
              {last.drawn_at ? new Date(last.drawn_at).toLocaleString() : '—'}
            </div>
            <div>
              <span className="text-zinc-500">Winner: </span>
              {last.winner_username || '—'}
            </div>
            <div>
              <span className="text-zinc-500 flex items-center gap-1"><Percent size={10} /> Pot tax (sink): </span>
              {formatMoney(last.sink_amount)}
            </div>
            <div>
              <span className="text-zinc-500">Payout: </span>
              <span className="text-emerald-400">{formatMoney(last.payout)}</span>
            </div>
            <div className="sm:col-span-2">
              <span className="text-zinc-500">Tickets in pot: </span>
              {last.ticket_count?.toLocaleString?.() ?? last.ticket_count ?? '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Lottery;
