import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Users, Wrench, BarChart3, Clock3, Coins, ShieldAlert, TrendingUp, Layers } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import AutoRefreshNote from '../../components/AutoRefreshNote';

const REFRESH_MS = 30_000;
const EQUIPMENT_ORDER = ['stills', 'condensers', 'mash_tun', 'barrels', 'bottling', 'tunnel', 'bribe_office', 'fake_labels', 'quality_lab'];
const TRACKS = ['production', 'aging', 'logistics', 'stealth', 'labor', 'black_market'];
const TRACK_FLAVOR = {
  production: 'Stillhouse throughput and mash discipline.',
  aging: 'Cellar patience, oak quality, and reserve value.',
  logistics: 'Crates, routes, and movement efficiency.',
  stealth: 'Shadows, silence, and heat suppression.',
  labor: 'Crew quality, shift control, and upkeep flow.',
  black_market: 'Premium buyers and off-book margins.',
};

function money(n) {
  return `$${Math.trunc(Number(n || 0)).toLocaleString()}`;
}

function prettyKey(v) {
  return String(v || '').split('_').map((x) => (x ? x[0].toUpperCase() + x.slice(1) : '')).join(' ');
}

function pct(n, digits = 1) {
  return `${(Number(n || 0) * 100).toFixed(digits)}%`;
}

export default function Distillery() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [state, setState] = useState(null);
  const [catalog, setCatalog] = useState({ tracks: {} });
  const [activeTrack, setActiveTrack] = useState('production');
  const [specialCursor, setSpecialCursor] = useState(0);
  const [workerDraft, setWorkerDraft] = useState({ production: 0, quality: 0, security: 0, sales: 0 });
  const [maintenancePoints, setMaintenancePoints] = useState(10);
  const [autoSell, setAutoSell] = useState({ enabled: false, min_inventory: 50, batch_size: 30 });
  const [agingTier, setAgingTier] = useState('standard');
  const [agingQty, setAgingQty] = useState(50);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [bizRes, distRes, catRes] = await Promise.all([
        api.get('/illegal-business'),
        api.get('/illegal-business/distillery'),
        api.get('/illegal-business/distillery/progression-catalog'),
      ]);
      setBusiness(bizRes.data?.business || null);
      const next = distRes.data || null;
      setState(next);
      setCatalog(catRes.data || { tracks: {} });
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

  const dist = state?.distillery || {};
  const roi = state?.roi || {};
  const lossForecast24h = state?.loss_forecast_24h || {};
  const progression = state?.progression || {};
  const pricing = state?.pricing || {};
  const heat = Number(dist?.heat || 0);
  const workers = dist?.workers || {};
  const equipment = dist?.equipment || {};
  const queue = Array.isArray(dist?.aging_queue) ? dist.aging_queue : [];
  const vaultBalance = Number(state?.vault_balance ?? business?.vault ?? 0);
  const equipmentCosts = pricing?.equipment_next_costs || {};
  const workerHireCost = Number(pricing?.worker_hire_cost || 0);
  const maintenanceCostPerPoint = Number(pricing?.maintenance_recover_cost_per_point || 0);
  const riskActionCosts = pricing?.risk_action_costs || {};
  const riskCooldown = state?.risk_cooldown || {};
  const riskCooldownRemaining = Number(riskCooldown?.cooldown_remaining_seconds || 0);
  const riskCooldownActive = riskCooldownRemaining > 0;
  const riskCooldownMinutes = Math.ceil(riskCooldownRemaining / 60);
  const workerCap = Number(dist?.worker_capacity || 0);
  const workerTotal = Number(workers.production || 0) + Number(workers.quality || 0) + Number(workers.security || 0) + Number(workers.sales || 0);
  const draftWorkerTotal = Number(workerDraft.production || 0) + Number(workerDraft.quality || 0) + Number(workerDraft.security || 0) + Number(workerDraft.sales || 0);
  const hiresNeeded = Math.max(0, draftWorkerTotal - workerTotal);
  const workerPlanCost = hiresNeeded * workerHireCost;
  const maintenanceCost = Math.max(1, Number(maintenancePoints || 1)) * maintenanceCostPerPoint;
  const projected24hCash = Number(roi.risk_adjusted_cash_per_hour_estimate || roi.cash_per_hour_estimate || 0) * 24;
  const projected12dCash = Number(roi.projected_12d_income || 0);
  const hardCapProgress = Number(roi.hard_cap_progress || 0);
  const projectedLossEvents24h = Number(lossForecast24h.expected_downgrade_events || 0);
  const projectedRebuyCost24h = Number(lossForecast24h.expected_rebuy_cost || 0);

  const trackRows = catalog?.tracks?.[activeTrack] || [];
  const visibleTrackRows = useMemo(() => {
    const out = [];
    for (const row of trackRows) {
      if (row.purchased) {
        out.push(row);
        continue;
      }
      if (row.available) {
        out.push(row);
      }
      break;
    }
    return out;
  }, [trackRows]);
  const maxSpecialIndex = Math.max(0, visibleTrackRows.length - 1);
  const clampedSpecialCursor = Math.min(Math.max(0, specialCursor), maxSpecialIndex);
  const activeSpecial = visibleTrackRows[clampedSpecialCursor] || null;
  const purchasedInTrack = trackRows.filter((r) => r.purchased).length;
  const bestNextUpgrades = useMemo(() => {
    const out = [];
    for (const track of TRACKS) {
      const rows = catalog?.tracks?.[track] || [];
      const next = rows.find((r) => r.available && !r.purchased);
      if (next) out.push(next);
    }
    return out.sort((a, b) => Number(a.cost || 0) - Number(b.cost || 0)).slice(0, 6);
  }, [catalog]);

  useEffect(() => {
    const nextIndex = Math.max(0, visibleTrackRows.length - 1);
    setSpecialCursor(nextIndex);
  }, [activeTrack, visibleTrackRows.length]);

  const heatBar = useMemo(() => {
    const val = Math.max(0, Math.min(100, heat));
    if (val >= 90) return { cls: 'bg-red-600', text: 'Meltdown' };
    if (val >= 75) return { cls: 'bg-red-500', text: 'Critical' };
    if (val >= 50) return { cls: 'bg-orange-500', text: 'Hot' };
    if (val >= 25) return { cls: 'bg-amber-400', text: 'Warm' };
    return { cls: 'bg-emerald-500', text: 'Low' };
  }, [heat]);
  const recentFailures = Array.isArray(dist?.recent_failures) ? dist.recent_failures : [];
  const heatFlavor = useMemo(() => {
    if (heat >= 90) return 'Sirens in the streets. Any mistake gets seized.';
    if (heat >= 75) return 'Task force attention. Loss events are frequent.';
    if (heat >= 50) return 'Eyes on the operation. Keep pressure controlled.';
    if (heat >= 25) return 'Rumors are spreading. Stay disciplined.';
    return 'Quiet operation. Good cover and steady movement.';
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
          <p className="text-sm text-mutedForeground mt-2">You need an illegal business first. Start one from your racket page.</p>
          <div className="mt-3">
            <Link to="/money/racket" className="text-primary underline underline-offset-2">Go to Racket</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.pageContent} mobile-page-root`}>
      <div className="space-y-3">
        <AutoRefreshNote seconds={30} />
        <div className={`${styles.panel} border border-primary/25 rounded-md px-4 py-3 bg-primary/5`}>
          <div className="flex flex-wrap items-end justify-between gap-3 pb-2 border-b border-primary/20">
            <div>
              <div className="text-[10px] uppercase tracking-[.24em] text-mutedForeground font-heading">1920s Distillery</div>
              <h1 className="text-2xl font-heading text-primary font-bold tracking-wide">{business?.name || 'Distillery'}</h1>
              <p className="text-xs text-mutedForeground italic">Long grind. Massive upside. Risk is real.</p>
            </div>
            <Link to="/money/racket" className="text-xs text-primary underline underline-offset-2">Back to Racket</Link>
          </div>
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
              <div className="rounded border border-primary/20 px-3 py-2 bg-black/20">
                <div className="text-[9px] uppercase tracking-widest text-mutedForeground font-heading">House Status</div>
                <div className="text-xs text-foreground mt-0.5">{heatBar.text} heat · {progression.progress_pct || 0}% complete</div>
              </div>
              <div className="rounded border border-primary/20 px-3 py-2 bg-black/20">
                <div className="text-[9px] uppercase tracking-widest text-mutedForeground font-heading">12-Day Run</div>
                <div className="text-xs text-foreground mt-0.5">{money(projected12dCash)} / {money(roi.target_12d_top_end)}</div>
              </div>
              <div className="rounded border border-primary/20 px-3 py-2 bg-black/20">
                <div className="text-[9px] uppercase tracking-widest text-mutedForeground font-heading">Risk Tone</div>
                <div className="text-xs text-foreground mt-0.5">{heatFlavor}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <div className={`${styles.panel} border border-primary/25 rounded-md p-3 bg-primary/5`}>
            <div className="text-[10px] uppercase tracking-widest text-mutedForeground font-heading">Vault</div>
            <div className="text-2xl font-heading font-bold text-primary">{money(vaultBalance)}</div>
          </div>
          <div className={`${styles.panel} border border-primary/25 rounded-md p-3 bg-primary/5`}>
            <div className="text-[10px] uppercase tracking-widest text-mutedForeground font-heading">Progress</div>
            <div className="text-lg font-heading text-primary">{progression.total_steps || 0} / {progression.max_steps || 0}</div>
            <div className="text-[10px] text-mutedForeground">{progression.progress_pct || 0}% unlocked</div>
          </div>
          <div className={`${styles.panel} border border-primary/25 rounded-md p-3 bg-primary/5`}>
            <div className="text-[10px] uppercase tracking-widest text-mutedForeground font-heading">Projected 12d</div>
            <div className="text-lg font-heading text-primary">{money(projected12dCash)}</div>
            <div className="text-[10px] text-mutedForeground">Target {money(roi.target_12d_top_end)}</div>
          </div>
          <div className={`${styles.panel} border border-primary/25 rounded-md p-3 bg-primary/5`}>
            <div className="text-[10px] uppercase tracking-widest text-mutedForeground font-heading">Target Progress</div>
            <div className="text-lg font-heading text-primary">{pct(hardCapProgress, 1)}</div>
            <div className="text-[10px] text-mutedForeground">Progress toward your 12-day target</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className={`${styles.panel} border border-primary/25 rounded-md p-3 lg:col-span-2`}>
            <div className="flex items-center gap-2 mb-2"><Flame size={14} className="text-primary" /><h2 className="text-xs font-heading uppercase tracking-widest text-primary">Heat & Enforcement</h2></div>
            <div className="h-2 rounded bg-zinc-800 overflow-hidden"><div className={`h-full ${heatBar.cls}`} style={{ width: `${Math.max(0, Math.min(100, heat))}%` }} /></div>
            <div className="mt-2 text-xs text-mutedForeground">Heat {heat.toFixed(1)} / 100 - <span className="text-primary">{heatBar.text}</span></div>
            <div className="text-[10px] text-mutedForeground mt-1">{heatFlavor}</div>
            {dist?.shutdown_until && <div className="mt-2 text-xs text-red-400 flex items-center gap-1"><ShieldAlert size={12} /> Shutdown until {new Date(dist.shutdown_until).toLocaleString()}</div>}
            <div className="mt-2 flex gap-2 flex-wrap">
              <button
                disabled={saving || riskCooldownActive}
                onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/risk-action', { action: 'cool_off' }); toast.success(res.data?.message || 'Heat cooled.'); })}
                className="px-2.5 py-1.5 text-[10px] border border-primary/35 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
              >
                Cool Off ({money(riskActionCosts.cool_off)})
              </button>
              <button
                disabled={saving || riskCooldownActive}
                onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/risk-action', { action: 'bribe_crackdown' }); toast.success(res.data?.message || 'Crackdown eased.'); })}
                className="px-2.5 py-1.5 text-[10px] border border-primary/35 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
              >
                Bribe Crackdown ({money(riskActionCosts.bribe_crackdown)})
              </button>
            </div>
            {riskCooldownActive && (
              <div className="text-[10px] text-amber-300 mt-1">
                Bribe cooldown active: {riskCooldownMinutes} min remaining.
              </div>
            )}
          </div>

          <div className={`${styles.panel} border border-primary/25 rounded-md p-3`}>
            <div className="flex items-center gap-2 mb-2"><BarChart3 size={14} className="text-primary" /><h2 className="text-xs font-heading uppercase tracking-widest text-primary">Risk-Adjusted ROI</h2></div>
            <div className="text-xs text-mutedForeground space-y-1">
              <div>Raw cash/h: <span className="text-primary">{money(roi.cash_per_hour_estimate)}</span></div>
              <div>Risk-adjusted cash/h: <span className="text-primary">{money(roi.risk_adjusted_cash_per_hour_estimate)}</span></div>
              <div>Projected 24h: <span className="text-primary">{money(projected24hCash)}</span></div>
              <div>Downside exposure: <span className="text-primary">{pct(roi.downside_exposure)}</span></div>
              <div>Projected losses if ignored (next 24h): <span className="text-primary">{projectedLossEvents24h.toFixed(2)} downgrade events (~{money(projectedRebuyCost24h)} rebuy)</span></div>
              <div>Booze/h: <span className="text-primary">{Number(roi.booze_per_hour_estimate || 0).toFixed(2)}</span></div>
              <div>Next lane payback: <span className="text-primary">{roi.next_upgrade_payback_hours ?? 'n/a'}h</span></div>
            </div>
          </div>
        </div>

        {recentFailures.length > 0 && (
          <div className={`${styles.panel} border border-red-500/35 rounded-md p-3 bg-red-500/5`}>
            <div className="text-[10px] uppercase tracking-widest text-red-300 font-heading mb-1">Maintenance Failures</div>
            <div className="text-xs text-red-100 mb-2">
              Low maintenance can break upgrade tiers. Broken tiers are removed and must be repurchased.
            </div>
            <div className="space-y-1">
              {recentFailures.slice(-5).reverse().map((f, i) => (
                <div key={`${f.at || 'x'}-${i}`} className="text-[11px] text-red-200">
                  {f.type === 'equipment_degrade' ? 'Equipment degraded' : 'Special upgrade lost'}: {prettyKey(f.item)} (maintenance {Number(f.maintenance || 0).toFixed(1)}%)
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className={`${styles.panel} border border-primary/25 rounded-md p-3`}>
            <h2 className="text-xs font-heading uppercase tracking-widest text-primary mb-2">Equipment Progression (180 levels)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EQUIPMENT_ORDER.map((lane) => (
                <button
                  key={lane}
                  disabled={saving}
                  onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/upgrade-equipment', { lane }); toast.success(res.data?.message || 'Upgraded.'); })}
                  className="text-left px-3 py-2 rounded border border-zinc-700/50 hover:border-primary/35 transition-all disabled:opacity-50"
                >
                  <div className="text-xs font-heading text-foreground">{prettyKey(lane)}</div>
                  <div className="text-[10px] text-mutedForeground">Level {Number(equipment[lane] || 0)} / 20</div>
                  <div className="text-[10px] text-primary/90">{equipmentCosts[lane] == null ? 'Maxed' : `Upgrade: ${money(equipmentCosts[lane])}`}</div>
                </button>
              ))}
            </div>
          </div>

          <div className={`${styles.panel} border border-primary/25 rounded-md p-3`}>
            <div className="flex items-center gap-2 mb-2"><TrendingUp size={14} className="text-primary" /><h2 className="text-xs font-heading uppercase tracking-widest text-primary">Best Next Upgrades</h2></div>
            <div className="space-y-2">
              {bestNextUpgrades.length === 0 && <div className="text-xs text-mutedForeground">No track upgrades available.</div>}
              {bestNextUpgrades.map((u) => (
                <div key={u.id} className="rounded border border-zinc-700/50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs text-foreground">{u.name}</div>
                      <div className="text-[10px] text-mutedForeground">{prettyKey(u.track)} · Tier {u.tier}</div>
                    </div>
                    <button
                      disabled={saving || !u.available}
                      onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/buy-special-upgrade', { upgrade_id: u.id }); toast.success(res.data?.message || 'Upgrade bought.'); })}
                      className="px-2 py-1 text-[10px] border border-primary/35 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
                    >
                      Buy {money(u.cost)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`${styles.panel} border border-primary/25 rounded-md p-3`}>
          <div className="flex items-center gap-2 mb-2"><Layers size={14} className="text-primary" /><h2 className="text-xs font-heading uppercase tracking-widest text-primary">Special Upgrade Tracks (180 perks)</h2></div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {TRACKS.map((track) => (
              <button
                key={track}
                onClick={() => setActiveTrack(track)}
                className={`px-2 py-1 rounded border text-[10px] font-heading uppercase tracking-wider ${activeTrack === track ? 'border-primary/50 text-primary bg-primary/10' : 'border-zinc-700/50 text-mutedForeground'}`}
              >
                {prettyKey(track)}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-mutedForeground mb-2 italic">{TRACK_FLAVOR[activeTrack]}</div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[10px] text-mutedForeground font-heading">
              {activeSpecial ? `${clampedSpecialCursor + 1}/${Math.max(1, visibleTrackRows.length)}` : '0/0'} · Purchased {purchasedInTrack}/{trackRows.length}
            </div>
            <div className="flex gap-1">
              <button
                disabled={clampedSpecialCursor <= 0}
                onClick={() => setSpecialCursor((v) => Math.max(0, v - 1))}
                className="px-2 py-1 text-[10px] border border-zinc-700/60 rounded text-mutedForeground disabled:opacity-40"
              >
                Prev
              </button>
              <button
                disabled={clampedSpecialCursor >= maxSpecialIndex}
                onClick={() => setSpecialCursor((v) => Math.min(maxSpecialIndex, v + 1))}
                className="px-2 py-1 text-[10px] border border-zinc-700/60 rounded text-mutedForeground disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
          {activeSpecial ? (
            <div className="rounded border border-zinc-700/50 p-3 max-w-xl">
              <div className="text-sm text-foreground">{activeSpecial.name}</div>
              <div className="text-[10px] text-mutedForeground">Tier {activeSpecial.tier}</div>
              <div className="text-xs text-primary mt-1">{money(activeSpecial.cost)}</div>
              <div className="text-[10px] text-mutedForeground mt-1">
                {activeSpecial.purchased ? 'Purchased' : activeSpecial.available ? 'Available' : 'Locked by tier path'}
              </div>
              <button
                disabled={saving || !activeSpecial.available || activeSpecial.purchased}
                onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/buy-special-upgrade', { upgrade_id: activeSpecial.id }); toast.success(res.data?.message || 'Upgrade bought.'); })}
                className="mt-2 px-2.5 py-1 text-[10px] border border-primary/35 text-primary rounded hover:bg-primary/10 disabled:opacity-50"
              >
                {activeSpecial.purchased ? 'Owned' : `Buy ${money(activeSpecial.cost)}`}
              </button>
            </div>
          ) : (
            <div className="text-xs text-mutedForeground">No upgrades visible in this track yet.</div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className={`${styles.panel} border border-primary/25 rounded-md p-3 space-y-3`}>
            <div>
              <div className="flex items-center gap-2 mb-2"><Users size={14} className="text-primary" /><h2 className="text-xs font-heading uppercase tracking-widest text-primary">Workers</h2></div>
              <div className="text-xs text-mutedForeground mb-2">{workerTotal}/{workerCap} assigned</div>
              <div className="grid grid-cols-2 gap-2">
                {['production', 'quality', 'security', 'sales'].map((role) => (
                  <div key={role}>
                    <label className="block text-[10px] text-mutedForeground mb-1">{prettyKey(role)}</label>
                    <input type="number" min="0" value={workerDraft[role]} onChange={(e) => setWorkerDraft((p) => ({ ...p, [role]: Number(e.target.value || 0) }))} className="w-full px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm" />
                  </div>
                ))}
              </div>
              <button disabled={saving} onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/assign-workers', workerDraft); toast.success(res.data?.message || 'Workers assigned.'); })} className="mt-2 px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50">Save Worker Plan</button>
              <div className="mt-1 text-[10px] text-mutedForeground">{hiresNeeded > 0 ? `Hiring ${hiresNeeded}: ${money(workerPlanCost)}` : 'No hire cost (reassign only).'}</div>
            </div>
            <div className="pt-2 border-t border-primary/10">
              <div className="flex items-center gap-2 mb-2"><Wrench size={14} className="text-primary" /><h2 className="text-xs font-heading uppercase tracking-widest text-primary">Maintenance</h2></div>
              <div className="text-xs text-mutedForeground mb-2">Current: {Number(dist?.maintenance || 0).toFixed(1)}%</div>
              {Number(dist?.maintenance || 0) < 35 && (
                <div className="text-[10px] text-red-300 mb-2">
                  Critical upkeep warning: upgrades may degrade and need repurchase if you leave maintenance this low.
                </div>
              )}
              <div className="flex gap-2">
                <input type="number" min="1" value={maintenancePoints} onChange={(e) => setMaintenancePoints(Number(e.target.value || 1))} className="w-24 px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm" />
                <button disabled={saving} onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/maintenance', { recover_points: maintenancePoints }); toast.success(res.data?.message || 'Maintenance done.'); })} className="px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50">Repair</button>
              </div>
              <div className="mt-1 text-[10px] text-mutedForeground">Repair cost: {money(maintenanceCost)}</div>
            </div>
          </div>

          <div className={`${styles.panel} border border-primary/25 rounded-md p-3`}>
            <div className="flex items-center gap-2 mb-2"><Clock3 size={14} className="text-primary" /><h2 className="text-xs font-heading uppercase tracking-widest text-primary">Auto-Sell & Aging</h2></div>
            <div className="space-y-2 text-xs text-mutedForeground mb-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!autoSell.enabled} onChange={(e) => setAutoSell((p) => ({ ...p, enabled: e.target.checked }))} /> Enable auto-sell crew</label>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min="0" value={autoSell.min_inventory} onChange={(e) => setAutoSell((p) => ({ ...p, min_inventory: Number(e.target.value || 0) }))} className="px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm" />
                <input type="number" min="1" value={autoSell.batch_size} onChange={(e) => setAutoSell((p) => ({ ...p, batch_size: Number(e.target.value || 1) }))} className="px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm" />
              </div>
              <button disabled={saving} onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/set-auto-sell-rules', autoSell); toast.success(res.data?.message || 'Auto-sell rules saved.'); })} className="px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50">Save Auto-Sell</button>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {['quick', 'standard', 'reserve', 'premium'].map((tier) => (
                <button key={tier} onClick={() => setAgingTier(tier)} className={`px-2 py-1 rounded border text-[10px] font-heading uppercase tracking-wider ${agingTier === tier ? 'border-primary/50 text-primary bg-primary/10' : 'border-zinc-700/50 text-mutedForeground'}`}>{tier}</button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              <input type="number" min="1" value={agingQty} onChange={(e) => setAgingQty(Number(e.target.value || 1))} className="w-24 px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm" />
              <button disabled={saving} onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/start-aging-batch', { tier: agingTier, quantity: agingQty }); toast.success(res.data?.message || 'Batch started.'); })} className="px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50">Start Batch</button>
            </div>
            <div className="space-y-1.5">
              {queue.length === 0 && <div className="text-xs text-mutedForeground">No active batches.</div>}
              {queue.map((b) => {
                const ready = new Date(b.ready_at) <= new Date();
                return (
                  <div key={b.id} className="border border-zinc-700/50 rounded px-2 py-1.5">
                    <div className="text-[11px] text-foreground">{prettyKey(b.tier)} · {b.quantity} units</div>
                    <div className="text-[10px] text-mutedForeground">Ready: {new Date(b.ready_at).toLocaleString()}</div>
                    <button disabled={saving || !ready} onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/claim-aged-batch', { batch_id: b.id }); toast.success(res.data?.message || 'Batch claimed.'); })} className="mt-1 px-2 py-1 text-[10px] font-heading uppercase tracking-wider border border-primary/35 text-primary rounded hover:bg-primary/10 disabled:opacity-50">Claim</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
