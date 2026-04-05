import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Users, Wrench, BarChart3, Clock3, Coins, ShieldAlert } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import AutoRefreshNote from '../../components/AutoRefreshNote';

const REFRESH_MS = 30_000;

const EQUIPMENT_ORDER = [
  'stills',
  'condensers',
  'mash_tun',
  'barrels',
  'bottling',
  'tunnel',
  'bribe_office',
  'fake_labels',
  'quality_lab',
];

function money(n) {
  return `$${Math.trunc(Number(n || 0)).toLocaleString()}`;
}

function prettyKey(v) {
  return String(v || '')
    .split('_')
    .map((x) => (x ? x[0].toUpperCase() + x.slice(1) : ''))
    .join(' ');
}

function pct(n, digits = 1) {
  return `${(Number(n || 0) * 100).toFixed(digits)}%`;
}

export default function Distillery() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [state, setState] = useState(null);

  const [workerDraft, setWorkerDraft] = useState({
    production: 0,
    quality: 0,
    security: 0,
    sales: 0,
  });
  const [maintenancePoints, setMaintenancePoints] = useState(10);
  const [autoSell, setAutoSell] = useState({
    enabled: false,
    min_inventory: 50,
    batch_size: 30,
  });
  const [agingTier, setAgingTier] = useState('standard');
  const [agingQty, setAgingQty] = useState(50);

  const dist = state?.distillery || {};
  const roi = state?.roi || {};
  const heat = Number(dist?.heat || 0);
  const workers = dist?.workers || {};
  const workerCap = Number(dist?.worker_capacity || 0);
  const workerTotal = Number(workers.production || 0) + Number(workers.quality || 0) + Number(workers.security || 0) + Number(workers.sales || 0);
  const equipment = dist?.equipment || {};
  const queue = Array.isArray(dist?.aging_queue) ? dist.aging_queue : [];

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [bizRes, distRes] = await Promise.all([
        api.get('/illegal-business'),
        api.get('/illegal-business/distillery'),
      ]);
      setBusiness(bizRes.data?.business || null);
      const next = distRes.data || null;
      setState(next);
      const w = next?.distillery?.workers || {};
      setWorkerDraft({
        production: Number(w.production || 0),
        quality: Number(w.quality || 0),
        security: Number(w.security || 0),
        sales: Number(w.sales || 0),
      });
      const a = next?.distillery?.auto_sell || {};
      setAutoSell({
        enabled: !!a.enabled,
        min_inventory: Number(a.min_inventory || 0),
        batch_size: Number(a.batch_size || 1),
      });
    } catch (e) {
      if (!silent) toast.error(getApiErrorMessage(e));
      setState(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const run = async (fn) => {
    if (saving) return;
    setSaving(true);
    try {
      await fn();
      await load(true);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const heatBar = useMemo(() => {
    const val = Math.max(0, Math.min(100, heat));
    if (val >= 75) return { cls: 'bg-red-500', text: 'Critical' };
    if (val >= 50) return { cls: 'bg-orange-500', text: 'Hot' };
    if (val >= 25) return { cls: 'bg-amber-400', text: 'Warm' };
    return { cls: 'bg-emerald-500', text: 'Low' };
  }, [heat]);

  if (loading) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!state || !business) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
        <div className={`${styles.panel} border border-primary/20 rounded-md p-4`}>
          <h1 className="text-lg font-heading text-primary">Distillery Unavailable</h1>
          <p className="text-sm text-mutedForeground mt-2">
            You need an illegal business first. Start one from your racket page.
          </p>
          <div className="mt-3">
            <Link to="/money/racket" className="text-primary underline underline-offset-2">
              Go to Racket
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.pageContent} mobile-page-root`}>
      <div className="space-y-3">
        <AutoRefreshNote seconds={30} />
        <div className="flex flex-wrap items-end justify-between gap-3 pb-2 border-b border-primary/20">
          <div>
            <div className="text-[10px] uppercase tracking-[.2em] text-mutedForeground font-heading">1920s Distillery</div>
            <h1 className="text-2xl font-heading text-primary font-bold tracking-wide">{business?.name || 'Distillery'}</h1>
            <p className="text-xs text-mutedForeground italic">Long grind, big payoff. Keep the coppers guessing.</p>
          </div>
          <Link to="/money/racket" className="text-xs text-primary underline underline-offset-2">Back to Racket</Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className={`${styles.panel} border border-primary/20 rounded-md p-3 lg:col-span-2`}>
            <div className="flex items-center gap-2 mb-2">
              <Flame size={14} className="text-primary" />
              <h2 className="text-xs font-heading uppercase tracking-widest text-primary">Heat & Enforcement</h2>
            </div>
            <div className="h-2 rounded bg-zinc-800 overflow-hidden">
              <div className={`h-full ${heatBar.cls}`} style={{ width: `${Math.max(0, Math.min(100, heat))}%` }} />
            </div>
            <div className="mt-2 text-xs text-mutedForeground">
              Heat {heat.toFixed(1)} / 100 - <span className="text-primary">{heatBar.text}</span>
            </div>
            {dist?.shutdown_until && (
              <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
                <ShieldAlert size={12} /> Shutdown until {new Date(dist.shutdown_until).toLocaleString()}
              </div>
            )}
          </div>

          <div className={`${styles.panel} border border-primary/20 rounded-md p-3`}>
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 size={14} className="text-primary" />
              <h2 className="text-xs font-heading uppercase tracking-widest text-primary">ROI Snapshot</h2>
            </div>
            <div className="text-xs text-mutedForeground space-y-1">
              <div>Cash/h est: <span className="text-primary">{money(roi.cash_per_hour_estimate)}</span></div>
              <div>Booze/h est: <span className="text-primary">{Number(roi.booze_per_hour_estimate || 0).toFixed(2)}</span></div>
              <div>Next lane: <span className="text-primary">{prettyKey(roi.next_upgrade_lane || 'n/a')}</span></div>
              <div>Payback: <span className="text-primary">{roi.next_upgrade_payback_hours ?? 'n/a'}h</span></div>
              <div>Worker payback: <span className="text-primary">{roi.worker_payback_hours ?? 'n/a'}h</span></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className={`${styles.panel} border border-primary/20 rounded-md p-3`}>
            <h2 className="text-xs font-heading uppercase tracking-widest text-primary mb-2">Equipment Upgrades</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EQUIPMENT_ORDER.map((lane) => (
                <button
                  key={lane}
                  disabled={saving}
                  onClick={() => run(async () => {
                    const res = await api.post('/illegal-business/distillery/upgrade-equipment', { lane });
                    toast.success(res.data?.message || 'Upgraded.');
                  })}
                  className="text-left px-3 py-2 rounded border border-zinc-700/50 hover:border-primary/35 transition-all disabled:opacity-50"
                >
                  <div className="text-xs font-heading text-foreground">{prettyKey(lane)}</div>
                  <div className="text-[10px] text-mutedForeground">Level {Number(equipment[lane] || 0)} / 10</div>
                </button>
              ))}
            </div>
          </div>

          <div className={`${styles.panel} border border-primary/20 rounded-md p-3 space-y-3`}>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users size={14} className="text-primary" />
                <h2 className="text-xs font-heading uppercase tracking-widest text-primary">Workers</h2>
              </div>
              <div className="text-xs text-mutedForeground mb-2">{workerTotal}/{workerCap} assigned</div>
              <div className="grid grid-cols-2 gap-2">
                {['production', 'quality', 'security', 'sales'].map((role) => (
                  <div key={role}>
                    <label className="block text-[10px] text-mutedForeground mb-1">{prettyKey(role)}</label>
                    <input
                      type="number"
                      min="0"
                      value={workerDraft[role]}
                      onChange={(e) => setWorkerDraft((p) => ({ ...p, [role]: Number(e.target.value || 0) }))}
                      className="w-full px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm"
                    />
                  </div>
                ))}
              </div>
              <button
                disabled={saving}
                onClick={() => run(async () => {
                  const res = await api.post('/illegal-business/distillery/assign-workers', workerDraft);
                  toast.success(res.data?.message || 'Workers assigned.');
                })}
                className="mt-2 px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
              >
                Save Worker Plan
              </button>
            </div>

            <div className="pt-2 border-t border-primary/10">
              <div className="flex items-center gap-2 mb-2">
                <Wrench size={14} className="text-primary" />
                <h2 className="text-xs font-heading uppercase tracking-widest text-primary">Maintenance</h2>
              </div>
              <div className="text-xs text-mutedForeground mb-2">Current: {Number(dist?.maintenance || 0).toFixed(1)}%</div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  value={maintenancePoints}
                  onChange={(e) => setMaintenancePoints(Number(e.target.value || 1))}
                  className="w-24 px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm"
                />
                <button
                  disabled={saving}
                  onClick={() => run(async () => {
                    const res = await api.post('/illegal-business/distillery/maintenance', { recover_points: maintenancePoints });
                    toast.success(res.data?.message || 'Maintenance done.');
                  })}
                  className="px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
                >
                  Repair
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className={`${styles.panel} border border-primary/20 rounded-md p-3`}>
            <div className="flex items-center gap-2 mb-2">
              <Coins size={14} className="text-primary" />
              <h2 className="text-xs font-heading uppercase tracking-widest text-primary">Worker Auto-Sell</h2>
            </div>
            <div className="space-y-2 text-xs text-mutedForeground">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!autoSell.enabled}
                  onChange={(e) => setAutoSell((p) => ({ ...p, enabled: e.target.checked }))}
                />
                Enable auto-sell crew
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] mb-1">Min inventory</label>
                  <input
                    type="number"
                    min="0"
                    value={autoSell.min_inventory}
                    onChange={(e) => setAutoSell((p) => ({ ...p, min_inventory: Number(e.target.value || 0) }))}
                    className="w-full px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] mb-1">Batch size / worker</label>
                  <input
                    type="number"
                    min="1"
                    value={autoSell.batch_size}
                    onChange={(e) => setAutoSell((p) => ({ ...p, batch_size: Number(e.target.value || 1) }))}
                    className="w-full px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm"
                  />
                </div>
              </div>
              <button
                disabled={saving}
                onClick={() => run(async () => {
                  const res = await api.post('/illegal-business/distillery/set-auto-sell-rules', autoSell);
                  toast.success(res.data?.message || 'Auto-sell rules saved.');
                })}
                className="px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
              >
                Save Auto-Sell
              </button>
            </div>
          </div>

          <div className={`${styles.panel} border border-primary/20 rounded-md p-3`}>
            <div className="flex items-center gap-2 mb-2">
              <Clock3 size={14} className="text-primary" />
              <h2 className="text-xs font-heading uppercase tracking-widest text-primary">Aging Cellar</h2>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {['quick', 'standard', 'reserve', 'premium'].map((tier) => (
                <button
                  key={tier}
                  onClick={() => setAgingTier(tier)}
                  className={`px-2 py-1 rounded border text-[10px] font-heading uppercase tracking-wider ${agingTier === tier ? 'border-primary/50 text-primary bg-primary/10' : 'border-zinc-700/50 text-mutedForeground'}`}
                >
                  {tier}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              <input
                type="number"
                min="1"
                value={agingQty}
                onChange={(e) => setAgingQty(Number(e.target.value || 1))}
                className="w-24 px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm"
              />
              <button
                disabled={saving}
                onClick={() => run(async () => {
                  const res = await api.post('/illegal-business/distillery/start-aging-batch', { tier: agingTier, quantity: agingQty });
                  toast.success(res.data?.message || 'Batch started.');
                })}
                className="px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
              >
                Start Batch
              </button>
            </div>
            <div className="space-y-1.5">
              {queue.length === 0 && <div className="text-xs text-mutedForeground">No active batches.</div>}
              {queue.map((b) => {
                const ready = new Date(b.ready_at) <= new Date();
                return (
                  <div key={b.id} className="border border-zinc-700/50 rounded px-2 py-1.5">
                    <div className="text-[11px] text-foreground">{prettyKey(b.tier)} · {b.quantity} units</div>
                    <div className="text-[10px] text-mutedForeground">Ready: {new Date(b.ready_at).toLocaleString()}</div>
                    <button
                      disabled={saving || !ready}
                      onClick={() => run(async () => {
                        const res = await api.post('/illegal-business/distillery/claim-aged-batch', { batch_id: b.id });
                        toast.success(res.data?.message || 'Batch claimed.');
                      })}
                      className="mt-1 px-2 py-1 text-[10px] font-heading uppercase tracking-wider border border-primary/35 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
                    >
                      Claim
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className={`${styles.panel} border border-primary/20 rounded-md p-3 text-xs text-mutedForeground`}>
          <div className="font-heading uppercase tracking-widest text-primary mb-1">Grind Notes</div>
          <ul className="space-y-1">
            <li>- Heat above 75 can trigger raids and shutdowns.</li>
            <li>- Reserve and Premium batches are long but highest-value.</li>
            <li>- Security and stealth upgrades reduce pressure over time.</li>
          </ul>
          <div className="mt-2 text-primary">Aging ROI: quick {pct(roi?.aging_tier_roi?.quick - 1)} · standard {pct(roi?.aging_tier_roi?.standard - 1)} · reserve {pct(roi?.aging_tier_roi?.reserve - 1)} · premium {pct(roi?.aging_tier_roi?.premium - 1)}</div>
        </div>
      </div>
    </div>
  );
}
