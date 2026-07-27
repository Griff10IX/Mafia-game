import { useCallback, useEffect, useState } from 'react';
import { Leaf, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function Btn({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`px-2 py-1.5 rounded border text-[10px] font-heading font-bold uppercase tracking-wide disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString()}` : '—';
}

export default function AdminWeedSellAudit() {
  const [suspects, setSuspects] = useState([]);
  const [heuristic, setHeuristic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [detail, setDetail] = useState(null);
  const [clawPreview, setClawPreview] = useState(null);
  const [clawLoading, setClawLoading] = useState(false);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/weed-empire/admin/sell-audit', { params: { min_score: 10, limit: 150 } });
      setSuspects(data?.suspects || []);
      setHeuristic(data?.heuristic || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Audit failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const loadFarm = async (name) => {
    const un = (name || username).trim();
    if (!un) {
      toast.error('Enter username');
      return;
    }
    setLoading(true);
    setClawPreview(null);
    try {
      const { data } = await api.get(`/weed-empire/admin/farm/${encodeURIComponent(un)}`);
      setDetail(data);
      setUsername(data?.username || un);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Load failed');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  };

  const previewClawback = async () => {
    const un = (detail?.username || username).trim();
    if (!un) return;
    setClawLoading(true);
    try {
      const { data } = await api.post(`/weed-empire/admin/clawback/${encodeURIComponent(un)}`, {
        dry_run: true,
        reset_cash: true,
        reset_xp: true,
        reset_equipment: true,
        reset_dealers: true,
        reset_sold_stats: true,
        reset_house: false,
        wipe_stash: false,
      });
      setClawPreview(data?.preview || null);
      toast.success(data?.message || 'Preview ready');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Preview failed');
      setClawPreview(null);
    } finally {
      setClawLoading(false);
    }
  };

  const applyClawback = async () => {
    const un = (detail?.username || username).trim();
    if (!un || !clawPreview) return;
    if (
      !window.confirm(
        `Reset ${un}'s weed cash/XP/equipment/sold stats to starter? This cannot undo itself — confirm they exploited sell spam.`
      )
    ) {
      return;
    }
    setClawLoading(true);
    try {
      const { data } = await api.post(`/weed-empire/admin/clawback/${encodeURIComponent(un)}`, {
        dry_run: false,
        reset_cash: true,
        reset_xp: true,
        reset_equipment: true,
        reset_dealers: true,
        reset_sold_stats: true,
        reset_house: false,
        wipe_stash: false,
      });
      toast.success(data?.message || 'Clawback applied');
      setClawPreview(null);
      await loadFarm(un);
      await loadAudit();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Clawback failed');
    } finally {
      setClawLoading(false);
    }
  };

  return (
    <div className={`${styles.pageContent} space-y-4 max-w-4xl`}>
      <div>
        <h1 className="text-sm font-heading font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-2">
          <Leaf size={16} /> Weed sell spam audit
        </h1>
        <p className="text-[10px] text-mutedForeground font-heading mt-1 leading-snug">
          Find farms that likely benefited from the stash sell race (spam sell without depleting). Heuristic only —
          preview clawback before applying. Resets business cash, grower XP, equipment, dealers, and sold counters.
        </p>
      </div>

      <section className={`${styles.panel} rounded-lg border border-emerald-500/25 p-4 space-y-3`}>
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <p className="text-[10px] font-heading text-mutedForeground">
            Cap ~{money(heuristic?.max_usd_per_harvest)}/harvest · {suspects.length} flagged
          </p>
          <Btn onClick={loadAudit} disabled={loading} className="border-emerald-500/40 text-emerald-200">
            <RefreshCw size={10} className="inline mr-1" /> {loading ? '…' : 'Refresh audit'}
          </Btn>
        </div>
        {suspects.length === 0 ? (
          <p className="text-[10px] text-mutedForeground">No suspects above threshold.</p>
        ) : (
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-[9px] font-heading border-collapse">
              <thead>
                <tr className="text-mutedForeground text-left">
                  <th className="pb-1 pr-2">User</th>
                  <th className="pb-1 pr-2">Score</th>
                  <th className="pb-1 pr-2">Cash</th>
                  <th className="pb-1 pr-2">Lifetime sold</th>
                  <th className="pb-1 pr-2">H / S</th>
                  <th className="pb-1">Flags</th>
                </tr>
              </thead>
              <tbody>
                {suspects.map((s) => (
                  <tr key={s.user_id} className="border-t border-zinc-800/80 text-foreground">
                    <td className="py-1 pr-2">
                      <button
                        type="button"
                        className="text-emerald-300 underline underline-offset-2"
                        onClick={() => loadFarm(s.username)}
                      >
                        {s.username}
                      </button>
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{s.score}</td>
                    <td className="py-1 pr-2 tabular-nums">{money(s.business_cash)}</td>
                    <td className="py-1 pr-2 tabular-nums">{money(s.lifetime_sold_usd)}</td>
                    <td className="py-1 pr-2 tabular-nums">
                      {s.harvest_count}/{s.sell_count}
                    </td>
                    <td className="py-1 text-amber-200/90">{(s.flags || []).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${styles.panel} rounded-lg border border-emerald-500/25 p-4 space-y-3`}>
        <p className="text-[11px] font-heading font-bold uppercase text-emerald-300">Inspect / clawback</p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadFarm()}
            placeholder="Username"
            className="flex-1 min-w-[160px] px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
          />
          <Btn onClick={() => loadFarm()} disabled={loading} className="border-emerald-400/40 bg-emerald-500/10 text-emerald-200">
            Load
          </Btn>
        </div>

        {detail && (
          <div className="text-[10px] font-heading space-y-2 border-t border-zinc-700/50 pt-3">
            <p>
              <span className="text-foreground font-bold">{detail.username}</span>
              <span className="text-mutedForeground">
                {' '}
                · Lv {detail.suspicion?.grower_level} · cash {money(detail.suspicion?.business_cash)} · lifetime{' '}
                {money(detail.suspicion?.lifetime_sold_usd)} · harvests {detail.suspicion?.harvest_count} · sells{' '}
                {detail.suspicion?.sell_count}
              </span>
            </p>
            {(detail.suspicion?.flags || []).length > 0 && (
              <p className="text-amber-300/90">Flags: {(detail.suspicion.flags || []).join(', ')}</p>
            )}
            {(detail.recent_sells || []).length > 0 && (
              <div className="space-y-1">
                <p className="text-[9px] uppercase text-mutedForeground">Recent logged sells</p>
                <ul className="max-h-28 overflow-y-auto text-[9px] text-mutedForeground space-y-0.5">
                  {detail.recent_sells.slice(0, 20).map((ev) => (
                    <li key={ev.id}>
                      {ev.created_at || '—'} · {ev.strain_id} · {ev.grams_sold}g · {money(ev.payout)} · stash{' '}
                      {ev.stash_before}→{ev.stash_after}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Btn
                onClick={previewClawback}
                disabled={clawLoading}
                className="border-amber-500/40 bg-amber-500/10 text-amber-200"
              >
                {clawLoading ? '…' : 'Preview clawback'}
              </Btn>
              {clawPreview && (
                <Btn
                  onClick={applyClawback}
                  disabled={clawLoading}
                  className="border-red-500/45 bg-red-500/15 text-red-200"
                >
                  Apply clawback
                </Btn>
              )}
            </div>
            {clawPreview && (
              <div className="rounded border border-amber-500/35 bg-amber-950/20 p-2 space-y-1">
                <p className="text-[9px] font-bold text-amber-200 uppercase">Clawback preview</p>
                <ul className="text-[9px] text-amber-100/90 space-y-0.5">
                  {(clawPreview.changes || []).map((c) => (
                    <li key={c}>• {c}</li>
                  ))}
                </ul>
                <p className="text-[9px] text-mutedForeground">
                  Before: cash {money(clawPreview.before?.business_cash)}, Lv {clawPreview.before?.grower_level}, lifetime{' '}
                  {money(clawPreview.before?.lifetime_sold_usd)}
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
