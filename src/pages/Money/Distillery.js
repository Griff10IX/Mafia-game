import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Users, Wrench, BarChart3, Clock3, ShieldAlert, TrendingUp, Layers, AlertTriangle, ChevronLeft, ChevronRight, Zap, CircleHelp, X } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { useAuthUser } from '../../context/AuthContext';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';

const REFRESH_MS = 30_000;
const DIST_CACHE_PREFIX = 'mafia_distillery_v1:';
const FAILURES_DISMISS_PREFIX = 'mafia_distillery_failures_dismiss:';

function distSessionKey(userId) {
  const id = (userId || '').trim();
  return id ? `${DIST_CACHE_PREFIX}${id}` : '';
}

function failuresDismissKey(userId) {
  const id = (userId || '').trim();
  return id ? `${FAILURES_DISMISS_PREFIX}${id}` : '';
}
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
const TRACK_EFFECTS = {
  production: ['+8% production per tier', '+1.5% cash income per tier'],
  aging: ['+5% quality per tier', '+2% aging cash bonus per tier'],
  logistics: ['+4% automation per tier (caps +120%)', '+1% worker efficiency per tier'],
  stealth: ['+3.5% heat control per tier', '+1% booze loss reduction per tier (caps 80%)'],
  labor: ['+3% worker efficiency per tier', '+1.2% maintenance slowdown per tier (caps 65%)'],
  black_market: ['+2.5% sale margin per tier', '+3% cash income per tier'],
};
const EQUIPMENT_ICONS = {
  stills: '⚗', condensers: '🌡', mash_tun: '🪣', barrels: '🛢',
  bottling: '🍾', tunnel: '🕳', bribe_office: '💼', fake_labels: '🏷', quality_lab: '🔬',
};
const EQUIPMENT_DESC = {
  stills: '+14% production / lv',
  condensers: '+11% production / lv',
  mash_tun: '+9% production / lv',
  barrels: '+5% quality / lv',
  bottling: '+7% production / lv',
  tunnel: '+25% heat mitigation / lv',
  bribe_office: '+2.5% cash & +2 workers / lv',
  fake_labels: '+1% sale margin / lv',
  quality_lab: '+6% quality / lv',
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
function intOr(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Lets users clear the field while typing; `Number(''||1)` would snap back to 1 (bad on mobile). */
function onDigitsOnlyOptionalIntChange(setter) {
  return (e) => {
    const raw = e.target.value;
    if (raw === '') {
      setter('');
      return;
    }
    if (!/^\d+$/.test(raw)) return;
    setter(Number.parseInt(raw, 10));
  };
}

// ── Segmented heat bar ────────────────────────────────────────────────────────
function HeatBar({ heat }) {
  const segs = 40;
  const litCount = Math.round((heat / 100) * segs);
  const getSegColor = (i) => {
    const ratio = i / segs;
    if (ratio < 0.4) return 'var(--heat-safe)';
    if (ratio < 0.65) return 'var(--heat-warm)';
    if (ratio < 0.82) return 'var(--heat-hot)';
    return 'var(--heat-critical)';
  };
  return (
    <div className="dist-heat-seg-wrap">
      {Array.from({ length: segs }).map((_, i) => (
        <div
          key={i}
          className={`dist-heat-seg ${i < litCount ? 'dist-heat-seg-lit' : 'dist-heat-seg-dim'}`}
          style={i < litCount ? { background: getSegColor(i) } : {}}
        />
      ))}
      {litCount > 0 && (
        <div className="dist-heat-scanner" style={{ left: `${(litCount / segs) * 100}%` }} />
      )}
    </div>
  );
}

// ── SVG Barrel ───────────────────────────────────────────────────────────────
function Barrel({ ready, label }) {
  return (
    <div className="dist-barrel-cell">
      <svg width="32" height="44" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="28" height="40" rx="5"
          fill={ready ? 'var(--barrel-ready-fill)' : 'var(--barrel-idle-fill)'}
          stroke={ready ? 'var(--barrel-ready-stroke)' : 'var(--barrel-idle-stroke)'}
          strokeWidth="1.5" />
        <line x1="2" y1="14" x2="30" y2="14" stroke={ready ? 'var(--barrel-ready-stroke)' : 'var(--barrel-idle-line)'} strokeWidth="1" />
        <line x1="2" y1="30" x2="30" y2="30" stroke={ready ? 'var(--barrel-ready-stroke)' : 'var(--barrel-idle-line)'} strokeWidth="1" />
        <ellipse cx="16" cy="2" rx="14" ry="3" fill={ready ? 'var(--barrel-ready-cap)' : 'var(--barrel-idle-cap)'} stroke={ready ? 'var(--barrel-ready-stroke)' : 'var(--barrel-idle-stroke)'} strokeWidth="1" />
        <ellipse cx="16" cy="42" rx="14" ry="3" fill={ready ? 'var(--barrel-ready-cap)' : 'var(--barrel-idle-cap)'} stroke={ready ? 'var(--barrel-ready-stroke)' : 'var(--barrel-idle-stroke)'} strokeWidth="1" />
        {ready && (
          <text x="16" y="24" textAnchor="middle" fill="var(--barrel-ready-check)" fontSize="10">✓</text>
        )}
      </svg>
      <div className={`dist-barrel-label ${ready ? 'dist-barrel-ready' : ''}`}>{label}</div>
    </div>
  );
}

// ── Section header (matches Racket CardHead strip) ───────────────────────────
function SectionHead({ icon: Icon, title, children }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 border-b border-primary/15 pb-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded border border-primary/25 bg-primary/10">
          <Icon size={13} className="text-primary shrink-0" />
        </div>
        <span className="font-heading text-[10px] font-bold uppercase tracking-[.13em] text-primary">{title}</span>
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

// ── Primary / secondary actions (IllegalBusiness.js parity) ─────────────────
function GoldBtn({ children, onClick, disabled, small, className = '', type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`tap-feedback inline-flex items-center justify-center rounded border border-primary/40 bg-primary/20 font-heading font-bold uppercase text-primary transition-all hover:bg-primary/30 active:scale-[0.97] touch-manipulation disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? 'min-h-9 px-2.5 py-1.5 text-[8px] tracking-wider' : 'min-h-[44px] px-4 py-2 text-[10px] tracking-wider'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick, disabled, small, className = '', type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`tap-feedback inline-flex items-center justify-center rounded border border-primary/30 bg-primary/10 font-heading font-bold uppercase text-primary transition-all hover:bg-primary/20 active:scale-[0.97] touch-manipulation disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? 'min-h-9 px-2 py-1 text-[8px] tracking-wider' : 'min-h-[44px] px-3 py-2 text-[10px] tracking-wider'
      } ${className}`}
    >
      {children}
    </button>
  );
}

const DIST_SEGMENTS = [
  { id: 'overview', label: 'Overview' },
  { id: 'operations', label: 'Operations' },
  { id: 'crew', label: 'Crew' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'perks', label: 'Perks' },
  { id: 'cellar', label: 'Cellar' },
  { id: 'automation', label: 'Automation' },
];

// ── Main component ─────────────────────────────────────────────────────────────
export default function Distillery() {
  const authUser = useAuthUser();
  const [saving, setSaving] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [business, setBusiness] = useState(null);
  const [pendingTake, setPendingTake] = useState(0);
  const [state, setState] = useState(null);
  const [catalog, setCatalog] = useState({ tracks: {} });
  const [activeTrack, setActiveTrack] = useState('production');
  const [specialCursor, setSpecialCursor] = useState(0);
  const [workerDraft, setWorkerDraft] = useState({ production: 0, quality: 0, security: 0, sales: 0 });
  const [maintenancePoints, setMaintenancePoints] = useState(10);
  const [autoSell, setAutoSell] = useState({ enabled: true, mode: 'crew', min_inventory: 0, batch_size: 25 });
  const [autoAging, setAutoAging] = useState({
    enabled: true,
    tier: 'standard',
    reserve_units: 0,
    auto_collect_booze: true,
  });
  const [agingTier, setAgingTier] = useState('standard');
  const [agingQty, setAgingQty] = useState(10);
  const [activeSegment, setActiveSegment] = useState('overview');
  const [cellarPane, setCellarPane] = useState('aging');
  const [passiveBoozePaused, setPassiveBoozePaused] = useState(false);

  const applyPagePayload = useCallback((payload) => {
    const biz = payload?.business || null;
    setBusiness(biz);
    setPendingTake(Number(payload?.pending_take || 0));
    const next = payload?.distillery_state || null;
    setState(next);
    setCatalog(payload?.catalog || { tracks: {} });
    setPassiveBoozePaused(payload?.passive_booze_paused === true);
    setLoadError(false);
    if (!biz) return;
    const w = next?.distillery?.workers || {};
    setWorkerDraft({
      production: Number(w.production || 0),
      quality: Number(w.quality || 0),
      security: Number(w.security || 0),
      sales: Number(w.sales || 0),
    });
    const a = next?.distillery?.auto_sell || {};
    const m = String(a.mode || 'booze_run').toLowerCase();
    setAutoSell({
      enabled: a.enabled !== false,
      mode: m === 'crew' ? 'crew' : 'booze_run',
      min_inventory: Number(a.min_inventory || 0),
      batch_size: Number(a.batch_size || 1),
    });
    const ag = next?.distillery?.auto_aging || {};
    setAutoAging({
      enabled: ag.enabled !== false,
      tier: ['quick', 'standard', 'reserve', 'premium'].includes(String(ag.tier || '').toLowerCase())
        ? String(ag.tier).toLowerCase()
        : 'standard',
      reserve_units: Number(ag.reserve_units || 0),
      auto_collect_booze: ag.auto_collect_booze !== false,
    });
  }, []);

  const load = useCallback(async (silent = false) => {
    const cacheKey = distSessionKey(authUser?.id);
    try {
      const res = await api.get('/illegal-business/distillery/page');
      applyPagePayload(res.data || {});
      if (cacheKey) {
        writeSessionJson(cacheKey, { payload: res.data, t: Date.now() });
      }
    } catch (e) {
      const status = e.response?.status;
      const detail = String(e.response?.data?.detail || '');
      const noBusiness =
        status === 404 && /don'?t have an illegal business|illegal business/i.test(detail);
      if (noBusiness) {
        setBusiness(null);
        setState(null);
        setCatalog({ tracks: {} });
        setPendingTake(0);
        setLoadError(false);
        if (cacheKey) writeSessionJson(cacheKey, { payload: { business: null }, t: Date.now() });
      } else {
        if (!silent) toast.error(getApiErrorMessage(e));
        if (!silent) {
          setLoadError(true);
          setState(null);
          setBusiness(null);
          setPendingTake(0);
        }
      }
    } finally {
      setHasLoaded(true);
    }
  }, [authUser?.id, applyPagePayload]);

  const prevDistUserIdRef = useRef(null);
  useEffect(() => {
    const uid = authUser?.id;
    if (!uid) return undefined;
    if (prevDistUserIdRef.current && prevDistUserIdRef.current !== uid) {
      setBusiness(null);
      setState(null);
      setCatalog({ tracks: {} });
      setPendingTake(0);
      setHasLoaded(false);
    }
    prevDistUserIdRef.current = uid;
    const key = distSessionKey(uid);
    const c = readSessionJson(key);
    const stale = !c?.t || Date.now() - c.t > REFRESH_MS;
    if (c?.payload != null) {
      applyPagePayload(c.payload);
      setHasLoaded(true);
    }
    if (c?.payload == null) load(false);
    else if (stale) load(true);
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [authUser?.id, load, applyPagePayload]);

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
  const distStats = dist?.stats || {};
  const autoSellUnitsLifetime = Number(distStats.total_booze_auto_sold || 0);
  const autoSellCrewVaultLifetime = Number(distStats.total_auto_sell_cash || 0);
  const autoSellBoozeRunVaultLifetime = Number(distStats.total_booze_run_auto_vault || 0);
  const autoSellVaultCombined = autoSellCrewVaultLifetime + autoSellBoozeRunVaultLifetime;
  const roi = state?.roi || {};
  const lossForecast24h = state?.loss_forecast_24h || {};
  const progression = state?.progression || {};
  const pricing = state?.pricing || {};
  const heat = Number(dist?.heat || 0);
  const allowVaultForHeat = dist?.allow_vault_for_heat !== false;
  const workers = dist?.workers || {};
  const equipment = dist?.equipment || {};
  const queue = Array.isArray(dist?.aging_queue) ? dist.aging_queue : [];
  const boozeUnitsCarrying = Number(state?.booze_units_carrying ?? 0);
  const vaultBalance = Number(state?.vault_balance ?? business?.vault ?? 0);
  const equipmentCosts = pricing?.equipment_next_costs || {};
  const workerHireCost = Number(pricing?.worker_hire_cost || 0);
  const workerMaxHiresPerAction = Number(pricing?.worker_max_hires_per_action || 0);
  const maintenanceCostPerPoint = Number(pricing?.maintenance_recover_cost_per_point || 0);
  const riskActionCosts = pricing?.risk_action_costs || {};
  const riskCooldown = state?.risk_cooldown || {};
  const riskCooldownRemaining = Number(riskCooldown?.cooldown_remaining_seconds || 0);
  const riskCooldownActive = riskCooldownRemaining > 0;
  const riskCooldownMinutes = Math.ceil(riskCooldownRemaining / 60);
  const riskCooldownHoursLabel = Number(riskCooldown?.cooldown_hours || 4);
  const workerCap = Number(dist?.worker_capacity || 0);
  const workerTotal = Number(workers.production || 0) + Number(workers.quality || 0) + Number(workers.security || 0) + Number(workers.sales || 0);
  const draftWorkerTotal = Number(workerDraft.production || 0) + Number(workerDraft.quality || 0) + Number(workerDraft.security || 0) + Number(workerDraft.sales || 0);
  const hiresNeeded = Math.max(0, draftWorkerTotal - workerTotal);
  const workerPlanCost = hiresNeeded * workerHireCost;
  const maintenanceCost = Math.max(1, Number(maintenancePoints || 1)) * maintenanceCostPerPoint;
  const projected24hCash = Number(roi.risk_adjusted_cash_per_hour_estimate || roi.cash_per_hour_estimate || 0) * 24;
  const projectedWeeklyCash = Number(roi.weekly_cash_estimate || projected24hCash * 7);
  const projected12dCash = Number(roi.projected_12d_income || 0);
  const hardCapProgress = Number(roi.hard_cap_progress || 0);
  const autoSellActive = roi.auto_sell_active === true;
  const salesWorkersCount = Number(workers.sales || 0);
  const projectedLossEvents24h = Number(lossForecast24h.expected_downgrade_events || 0);
  const projectedRebuyCost24h = Number(lossForecast24h.expected_rebuy_cost || 0);
  const maintenancePct = Number(dist?.maintenance || 0);

  const trackRows = catalog?.tracks?.[activeTrack] || [];
  const visibleTrackRows = useMemo(() => {
    const out = [];
    for (const row of trackRows) {
      if (row.purchased) { out.push(row); continue; }
      if (row.available) { out.push(row); }
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
    setSpecialCursor(Math.max(0, visibleTrackRows.length - 1));
  }, [activeTrack, visibleTrackRows.length]);

  const heatInfo = useMemo(() => {
    if (heat >= 90) return { label: 'MELTDOWN', flavor: 'Sirens in the streets. Any mistake gets seized.', cls: 'heat-meltdown' };
    if (heat >= 75) return { label: 'CRITICAL', flavor: 'Task force attention. Loss events are frequent.', cls: 'heat-critical' };
    if (heat >= 50) return { label: 'HOT', flavor: 'Eyes on the operation. Keep pressure controlled.', cls: 'heat-hot' };
    if (heat >= 25) return { label: 'WARM', flavor: 'Rumors spreading. Stay disciplined.', cls: 'heat-warm' };
    return { label: 'LOW', flavor: 'Quiet operation. Good cover and steady movement.', cls: 'heat-low' };
  }, [heat]);

  const recentFailures = Array.isArray(dist?.recent_failures) ? dist.recent_failures : [];
  const failuresSig = useMemo(
    () => recentFailures.map((f) => `${f.at}|${f.type}|${f.item}|${f.maintenance}`).join(';;'),
    [recentFailures]
  );
  const failuresDismissStorageKey = failuresDismissKey(authUser?.id);
  const [dismissedFailuresSig, setDismissedFailuresSig] = useState(null);

  useEffect(() => {
    if (!failuresDismissStorageKey) {
      setDismissedFailuresSig(null);
      return;
    }
    const stored = readSessionJson(failuresDismissStorageKey);
    setDismissedFailuresSig(stored?.sig ?? null);
  }, [failuresDismissStorageKey]);

  const dismissFailuresBanner = useCallback(() => {
    setDismissedFailuresSig(failuresSig);
    if (failuresDismissStorageKey) {
      writeSessionJson(failuresDismissStorageKey, { sig: failuresSig, t: Date.now() });
    }
  }, [failuresSig, failuresDismissStorageKey]);

  const showFailuresBanner = recentFailures.length > 0 && failuresSig !== dismissedFailuresSig;
  const maintenanceWarn = maintenancePct < 35;
  const visibleFailures = recentFailures.slice(-5).reverse();

  // ── Error / Empty ────────────────────────────────────────────────
  if (hasLoaded && loadError && !state && !business) {
    return (
      <div className={`${styles.pageContent} mobile-page-root dist-root`}>
        <div className="dist-empty-panel">
          <div className="dist-empty-icon">⚠</div>
          <h1 className="dist-empty-title">Couldn&apos;t Load Distillery</h1>
          <p className="dist-empty-sub">Try again in a moment.</p>
          <p className="dist-empty-sub mt-3 text-[10px] text-mutedForeground max-w-md mx-auto">
            If you don&apos;t have an illegal business yet: reach <strong className="text-foreground">Capo</strong> rank or higher, then{' '}
            <strong className="text-foreground">open your racket</strong> on the Racket page (choose <strong className="text-foreground">Booze making</strong> for this still).
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => load(false)}
              className="inline-block border border-primary/35 bg-primary/10 px-5 py-2 text-[11px] font-heading font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20"
            >
              Retry
            </button>
            <Link
              to="/money/racket"
              className="inline-block border border-border bg-secondary/40 px-5 py-2 text-[11px] font-heading font-bold uppercase tracking-wider text-foreground transition-all hover:bg-secondary/60"
            >
              Racket →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── No business ─────────────────────────────────────────────────────────────
  if (hasLoaded && (!state || !business)) {
    return (
      <div className={`${styles.pageContent} mobile-page-root dist-root`}>
        <div className="dist-empty-panel">
          <div className="dist-empty-icon">⚗</div>
          <h1 className="dist-empty-title">No Still Running</h1>
          <p className="dist-empty-sub max-w-lg mx-auto leading-relaxed">
            This page needs an <strong className="text-foreground">illegal business</strong> with a still. Requirements:
          </p>
          <ul className="dist-empty-sub text-left max-w-md mx-auto mt-3 space-y-2 text-[11px] list-disc pl-5">
            <li>
              Reach <strong className="text-foreground">Capo</strong> rank or higher (the game blocks starting a racket below Capo).
            </li>
            <li>
              <strong className="text-foreground">Open your racket</strong> on the Racket page — start an illegal business and pick{' '}
              <strong className="text-foreground">Booze making</strong> if you want the distillery.
            </li>
          </ul>
          <Link
            to="/money/racket"
            className="mt-5 inline-block border border-primary/35 bg-primary/10 px-5 py-2 text-[11px] font-heading font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20"
          >
            Go to Racket →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .dist-root {
          --gold: var(--noir-primary);
          --gold-dim: rgba(var(--noir-primary-rgb), 0.72);
          --gold-pale: rgba(var(--noir-primary-rgb), 0.92);
          --amber: var(--noir-primary-dark);
          --amber-dim: rgba(var(--noir-primary-rgb), 0.45);
          --bg: var(--noir-content);
          --bg2: var(--noir-surface);
          --bg3: var(--noir-raised);
          --bg4: var(--noir-panel);
          --border: var(--noir-border-mid);
          --border-dim: var(--noir-border-light);
          --text: var(--noir-foreground);
          --text-dim: var(--noir-muted);
          --text-faint: rgba(245, 245, 245, 0.5);
          --red: #c44020;
          --green: #4a8a3a;
          --danger: #ff6b6b;
          --danger-soft: rgba(255, 107, 107, 0.2);
          --heat-safe: #4a8a3a;
          --heat-warm: #c4b030;
          --heat-hot: var(--amber);
          --heat-critical: #e06020;
          --heat-meltdown: #ff4444;
          --heat-safe-border: rgba(74, 138, 58, 0.4);
          --heat-warm-border: rgba(196, 176, 48, 0.4);
          --heat-hot-border: rgba(var(--noir-primary-rgb), 0.4);
          --heat-critical-border: rgba(224, 96, 32, 0.4);
          --heat-meltdown-border: rgba(255, 68, 68, 0.4);
          --barrel-idle-fill: rgba(140, 100, 40, 0.22);
          --barrel-idle-cap: rgba(140, 100, 40, 0.3);
          --barrel-idle-stroke: rgba(var(--noir-primary-rgb), 0.45);
          --barrel-idle-line: rgba(var(--noir-primary-rgb), 0.35);
          --barrel-ready-fill: rgba(74, 138, 58, 0.25);
          --barrel-ready-cap: rgba(74, 138, 58, 0.32);
          --barrel-ready-stroke: #6aaa3a;
          --barrel-ready-check: #8add6a;
          background: var(--noir-content);
          color: var(--noir-foreground);
          font-family: inherit;
          min-height: 100vh;
          overflow-x: clip;
          padding-bottom: max(7rem, calc(5.5rem + env(safe-area-inset-bottom, 0px)));
        }
        .dist-root * { font-family: inherit; }
        @media (min-width: 768px) {
          .dist-root { padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px)); }
        }
        body[data-mobile-layout="pocket_deck"] .dist-root {
          padding-bottom: calc(var(--pocket-dock-clearance, 8.5rem) + env(safe-area-inset-bottom, 0px));
        }
        body[data-theme-variant="modern"] .dist-root {
          --bg: var(--modern-surface-2, #1f1f24);
          --bg2: rgba(45, 45, 50, 0.95);
          --bg3: rgba(55, 55, 60, 0.95);
          --bg4: rgba(24, 24, 27, 0.95);
          --border: var(--modern-border-soft, rgba(161, 161, 170, 0.22));
          --border-dim: var(--modern-divider, rgba(161, 161, 170, 0.14));
          --text-faint: rgba(228, 228, 231, 0.62);
        }

        .dist-empty-panel { background: var(--bg2); border: 1px solid var(--border); padding: 40px; text-align: center; margin: 20px; }
        .dist-empty-icon { font-size: 48px; margin-bottom: 16px; }
        .dist-empty-title { font-size: 20px; color: var(--gold); margin-bottom: 8px; }
        .dist-empty-sub { font-size: 14px; color: var(--text-dim); margin-bottom: 16px; }

        .dist-head { padding: 12px 14px 8px; background: var(--bg2); border-bottom: 1px solid var(--border-dim); }
        .dist-head-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .dist-kicker { font-size: 8px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-faint); }
        .dist-title { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gold); line-height: 1.15; overflow-wrap: anywhere; }
        .dist-head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .dist-racket-link {
          display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
          padding: 0 12px; border-radius: 6px; border: 1px solid var(--border);
          font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
          color: var(--text-dim); text-decoration: none;
        }
        .dist-refresh-note { margin-top: 6px; font-size: 8px; letter-spacing: 0.12em; color: var(--text-faint); }

        .dist-kpi {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1px; background: var(--border-dim); border-bottom: 1px solid var(--border);
        }
        @media (min-width: 1024px) {
          .dist-kpi { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        }
        .dist-kpi-cell { background: var(--bg); padding: 8px 10px; min-width: 0; }
        .dist-kpi-l { font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-faint); }
        .dist-kpi-v { margin-top: 2px; font-size: 13px; font-weight: 700; color: var(--gold); line-height: 1.25; overflow-wrap: anywhere; }

        .dist-alerts { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px 0; }
        .dist-alert {
          border: 1px solid rgba(196, 64, 32, 0.45); background: rgba(196, 64, 32, 0.08);
          border-radius: 8px; padding: 10px 12px;
        }
        .dist-alert-top { display: flex; align-items: center; gap: 8px; }
        .dist-alert-title { flex: 1; min-width: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--danger); }
        .dist-alert-dismiss {
          display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px;
          border-radius: 6px; border: 1px solid rgba(255, 107, 107, 0.35); background: rgba(80, 16, 16, 0.35); color: #fecaca;
        }
        .dist-alert-note { margin: 4px 0 6px; font-size: 11px; font-style: italic; color: var(--danger); }
        .dist-alert-row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; font-size: 12px; color: var(--danger); border-bottom: 1px solid rgba(255, 107, 107, 0.2); }
        .dist-alert-row:last-child { border-bottom: none; }
        .dist-alert-meta { font-size: 10px; color: rgba(255, 107, 107, 0.75); }
        .dist-paused-banner {
          font-size: 11px; color: var(--amber); padding: 10px 12px; line-height: 1.45;
          border: 1px solid rgba(var(--noir-primary-rgb), 0.35); background: rgba(var(--noir-primary-rgb), 0.08); border-radius: 8px;
        }

        .dist-seg-nav {
          position: sticky; top: 0; z-index: 25;
          display: flex; gap: 4px; overflow-x: auto; padding: 8px 10px;
          background: color-mix(in srgb, var(--noir-content) 92%, transparent);
          backdrop-filter: blur(8px); border-bottom: 1px solid var(--border);
          -webkit-overflow-scrolling: touch; scrollbar-width: none;
        }
        .dist-seg-nav::-webkit-scrollbar { display: none; }
        body[data-mobile-layout="pocket_deck"] .dist-seg-nav { top: var(--pocket-hud-top, 2.75rem); }
        .dist-seg-btn {
          flex: 0 0 auto; min-height: 44px; padding: 0 12px; border-radius: 6px;
          border: 1px solid transparent; background: transparent; color: var(--text-dim);
          font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
          touch-action: manipulation;
        }
        .dist-seg-btn.is-active {
          border-color: rgba(var(--noir-primary-rgb), 0.45);
          background: rgba(var(--noir-primary-rgb), 0.15);
          color: var(--gold);
        }
        .dist-subnav { display: flex; gap: 4px; margin-bottom: 12px; }
        .dist-subnav .dist-seg-btn { flex: 1 1 0; }

        .dist-body { padding: 12px 14px 16px; display: flex; flex-direction: column; gap: 12px; }
        .dist-panel {
          background: var(--bg2); border: 1px solid var(--border);
          border-radius: var(--app-surface-radius, 8px);
          box-shadow: var(--app-card-shadow, none);
          padding: 14px; position: relative; overflow: hidden;
        }
        .dist-panel::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(var(--noir-primary-rgb), 0.24), transparent);
        }
        .dist-two-col { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @media (min-width: 800px) { .dist-two-col { grid-template-columns: 1fr 1fr; } }
        .dist-quick { display: flex; flex-wrap: wrap; gap: 8px; }
        .dist-muted { font-size: 11px; color: var(--text-dim); line-height: 1.45; }
        .dist-status-line {
          font-size: 11px; color: var(--text-dim); padding: 8px 10px; margin-bottom: 10px;
          border: 1px solid var(--border-dim); background: var(--bg); border-radius: 6px;
        }
        .dist-status-line strong { color: var(--gold); }

        .dist-heat-seg-wrap { display: flex; gap: 2px; height: 14px; align-items: center; position: relative; }
        .dist-heat-seg { flex: 1; height: 100%; }
        .dist-heat-seg-dim { background: var(--bg4); }
        .dist-heat-scanner { position: absolute; top: 0; bottom: 0; width: 3px; background: rgba(232,192,96,0.6); transform: translateX(-50%); animation: dist-scanner-pulse 1.2s ease-in-out infinite; transition: left 1s ease; }
        @keyframes dist-scanner-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
        .dist-heat-readout { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
        .dist-heat-temp { font-size: 28px; font-weight: 700; }
        .heat-meltdown .dist-heat-temp, .heat-meltdown .dist-heat-badge { color: var(--heat-meltdown); border-color: var(--heat-meltdown-border); }
        .heat-critical .dist-heat-temp, .heat-critical .dist-heat-badge { color: var(--heat-critical); border-color: var(--heat-critical-border); }
        .heat-hot .dist-heat-temp, .heat-hot .dist-heat-badge { color: var(--heat-hot); border-color: var(--heat-hot-border); }
        .heat-warm .dist-heat-temp, .heat-warm .dist-heat-badge { color: var(--heat-warm); border-color: var(--heat-warm-border); }
        .heat-low .dist-heat-temp, .heat-low .dist-heat-badge { color: var(--heat-safe); border-color: var(--heat-safe-border); }
        .dist-heat-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; padding: 4px 12px; border: 1px solid; color: var(--gold); }
        .dist-heat-flavor { font-style: italic; font-size: 12px; color: var(--text-dim); margin-top: 6px; }
        .dist-heat-shutdown { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--danger); margin-top: 8px; background: rgba(255, 107, 107, 0.1); border: 1px solid var(--danger-soft); padding: 6px 10px; }
        .dist-heat-cooldown { font-size: 10px; color: var(--heat-warm); margin-top: 8px; }
        .dist-btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
        .dist-heat-help summary {
          cursor: pointer; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--gold); padding: 8px 0; list-style: none; touch-action: manipulation; min-height: 44px; display: flex; align-items: center;
        }
        .dist-heat-help summary::-webkit-details-marker { display: none; }

        .dist-roi-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border-dim); }
        .dist-roi-row:last-child { border-bottom: none; }
        .dist-roi-key { font-size: 9px; letter-spacing: 0.08em; color: var(--text-faint); text-transform: uppercase; }
        .dist-roi-val { font-size: 13px; color: var(--gold); font-weight: 700; text-align: right; }

        .dist-worker-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
        .dist-worker-card { background: var(--bg); border: 1px solid var(--border-dim); padding: 10px; min-width: 0; }
        .dist-worker-role { font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 4px; }
        .dist-worker-num { font-size: 18px; color: var(--gold); margin-bottom: 4px; }
        .dist-worker-bar { height: 3px; background: var(--bg4); }
        .dist-worker-fill { height: 100%; background: var(--amber); }
        .dist-worker-input, .dist-maint-input, .dist-aging-qty-input, .dist-input {
          width: 100%; min-height: 44px; padding: 8px 10px; box-sizing: border-box;
          background: var(--noir-content); border: 1px solid var(--border); color: var(--text); font-size: 16px;
        }
        .dist-worker-input { margin-top: 6px; }
        .dist-worker-input:focus, .dist-maint-input:focus, .dist-aging-qty-input:focus, .dist-input:focus { outline: none; border-color: var(--amber-dim); }
        .dist-worker-cap { font-size: 11px; color: var(--text-dim); margin-bottom: 8px; }
        .dist-maint-label-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
        .dist-maint-key { color: var(--text-dim); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; }
        .dist-maint-val { font-weight: 700; font-size: 16px; }
        .dist-maint-track, .dist-level-bar { height: 8px; background: var(--bg4); border: 1px solid var(--border-dim); border-radius: 2px; overflow: hidden; }
        .dist-maint-fill, .dist-level-bar-fill { height: 100%; }
        .dist-maint-warn { font-size: 11px; color: var(--danger); margin-top: 8px; font-style: italic; background: rgba(255, 107, 107, 0.1); padding: 6px 10px; border-left: 2px solid var(--danger); }
        .dist-maint-input-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
        .dist-maint-input { width: 88px; }
        .dist-level-bar { margin: 6px 0; }

        .dist-equip-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
        @media (min-width: 640px) { .dist-equip-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (min-width: 1024px) { .dist-equip-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        .dist-equip-card {
          background: var(--bg); padding: 10px 12px; text-align: left; width: 100%; min-width: 0;
          border: 1px solid rgba(var(--noir-primary-rgb), 0.25); border-radius: 6px;
        }
        .dist-equip-card.is-maxed { opacity: 0.72; }
        .dist-equip-card.is-unaffordable { opacity: 0.85; }
        .dist-equip-icon { font-size: 16px; }
        .dist-equip-name { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text); font-weight: 700; margin-top: 2px; }
        .dist-equip-desc { font-size: 10px; color: var(--cyan, #67e8f9); margin-top: 2px; }
        .dist-equip-lv { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
        .dist-equip-maxed { font-size: 11px; color: var(--green); margin-top: 8px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }

        .dist-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .dist-chip {
          min-height: 44px; padding: 6px 10px; border-radius: 6px;
          border: 1px solid rgba(var(--noir-primary-rgb), 0.3);
          background: rgba(var(--noir-primary-rgb), 0.08);
          color: var(--gold); font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        }
        .dist-track-scroll { display: flex; gap: 0; overflow-x: auto; margin: 0 -14px 8px; border-bottom: 1px solid rgba(var(--noir-primary-rgb), 0.18); scrollbar-width: none; }
        .dist-track-scroll::-webkit-scrollbar { display: none; }
        .dist-track-tab { min-height: 44px; padding: 0 14px; flex: 0 0 auto; }
        .dist-track-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
        .dist-track-nav-meta { font-size: 10px; color: var(--text-faint); }
        .dist-track-nav-btns { display: flex; gap: 6px; }
        .dist-upgrade-showcase { background: var(--bg); padding: 12px; display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(var(--noir-primary-rgb), 0.25); border-radius: 6px; }
        @media (min-width: 640px) { .dist-upgrade-showcase { flex-direction: row; align-items: flex-start; justify-content: space-between; } }
        .dist-upgrade-name { font-size: 15px; color: var(--gold-pale); font-weight: 700; }
        .dist-upgrade-tier { font-size: 9px; color: var(--text-faint); letter-spacing: 0.12em; text-transform: uppercase; margin-top: 2px; }
        .dist-upgrade-price { font-size: 16px; color: var(--amber); font-weight: 700; margin-top: 4px; }
        .dist-upgrade-status-owned { font-size: 11px; color: var(--green); margin-top: 4px; }
        .dist-upgrade-status-avail { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
        .dist-upgrade-status-locked { font-size: 11px; color: var(--text-faint); margin-top: 4px; }
        .dist-upgrade-effects { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
        .dist-upgrade-effects span { font-size: 11px; color: var(--cyan, #67e8f9); }
        .dist-no-upgrade { font-size: 13px; color: var(--text-faint); font-style: italic; }

        .dist-tier-row { display: flex; gap: 4px; margin-bottom: 10px; }
        .dist-tier-btn {
          flex: 1 1 0; min-height: 44px; border-radius: 6px; border: 1px solid rgba(113, 113, 122, 0.5);
          background: rgba(var(--noir-primary-rgb), 0.05); color: var(--text-dim);
          font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 2px;
        }
        .dist-tier-btn.is-active { border-color: rgba(var(--noir-primary-rgb), 0.5); background: rgba(var(--noir-primary-rgb), 0.15); color: var(--gold); }
        .dist-barrel-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0; align-items: flex-end; }
        .dist-barrel-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; }
        .dist-barrel-label { font-size: 8px; color: var(--text-faint); }
        .dist-barrel-ready { color: var(--green); font-weight: 600; }
        .dist-aging-start-row { display: flex; gap: 8px; align-items: center; }
        .dist-aging-qty-input { width: 88px; }
        .dist-queue-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-dim); }
        .dist-queue-item { background: var(--bg); border: 1px solid var(--border-dim); padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .dist-queue-tier { font-size: 12px; color: var(--text); font-weight: 700; }
        .dist-queue-time { font-size: 10px; color: var(--text-faint); margin-top: 2px; }
        .dist-autosell-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; min-height: 44px; }
        .dist-autosell-check { width: 18px; height: 18px; accent-color: var(--amber); }
        .dist-autosell-label { font-size: 13px; color: var(--text-dim); }
        .dist-autosell-inputs { display: grid; grid-template-columns: 1fr; gap: 8px; }
        @media (min-width: 640px) { .dist-autosell-inputs { grid-template-columns: 1fr 1fr; } }
        .dist-input-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-faint); margin-bottom: 4px; }
        .dist-mode-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
        .dist-mode {
          display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 10px;
          border: 1px solid rgba(113, 113, 122, 0.5); border-radius: 6px; color: var(--text-dim); font-size: 12px;
        }
        .dist-mode:has(input:checked) { border-color: rgba(var(--noir-primary-rgb), 0.45); background: rgba(var(--noir-primary-rgb), 0.1); color: var(--text); }
        .dist-life { margin-bottom: 10px; border: 1px solid var(--border-dim); background: rgba(var(--noir-primary-rgb), 0.06); border-radius: 6px; padding: 8px 10px; font-size: 11px; color: var(--text-dim); }
        .dist-life-top, .dist-life-sub { display: flex; flex-wrap: wrap; gap: 8px 16px; }
        .dist-life-sub { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border-dim); font-size: 10px; }
      `}</style>

      <div className={`${styles.pageContent} mobile-page-root dist-root`}>
        <header className="dist-head">
          <div className="dist-head-row">
            <div style={{ minWidth: 0 }}>
              <div className="dist-kicker">Distillery</div>
              <h1 className="dist-title">{business?.name || 'The Still'}</h1>
            </div>
            <div className="dist-head-actions">
              <GoldBtn
                disabled={saving}
                title="Same as Racket Collect the Take — banks till to vault."
                onClick={() => run(async () => {
                  const res = await api.post('/illegal-business/distillery/collect');
                  toast.success(res.data?.message || 'Distillery collected.');
                })}
              >
                Collect {pendingTake > 0 ? money(pendingTake) : 'now'}
              </GoldBtn>
              <Link to="/money/racket" className="dist-racket-link">Racket</Link>
            </div>
          </div>
          <div className="dist-refresh-note">
            <AutoRefreshNote seconds={30} />
          </div>
        </header>

        <div className="dist-kpi">
          <div className="dist-kpi-cell">
            <div className="dist-kpi-l">Vault</div>
            <div className="dist-kpi-v">{money(vaultBalance)}</div>
          </div>
          <div className="dist-kpi-cell">
            <div className="dist-kpi-l">Weekly run</div>
            <div className="dist-kpi-v">{money(projectedWeeklyCash)}</div>
          </div>
          <div className="dist-kpi-cell">
            <div className="dist-kpi-l">Heat</div>
            <div className="dist-kpi-v">{heat.toFixed(0)}°</div>
          </div>
          <div className="dist-kpi-cell">
            <div className="dist-kpi-l">Maintenance</div>
            <div className="dist-kpi-v" style={{ color: maintenancePct < 35 ? 'var(--danger)' : undefined }}>{maintenancePct.toFixed(1)}%</div>
          </div>
          <div className="dist-kpi-cell">
            <div className="dist-kpi-l">Crew</div>
            <div className="dist-kpi-v">{workerTotal} / {workerCap}</div>
          </div>
          <div className="dist-kpi-cell">
            <div className="dist-kpi-l">Projected week</div>
            <div className="dist-kpi-v">{money(projectedWeeklyCash)}</div>
          </div>
        </div>

        {(passiveBoozePaused || (!!autoSell.enabled && salesWorkersCount < 1) || showFailuresBanner) && (
          <div className="dist-alerts">
            {passiveBoozePaused && (
              <div className="dist-paused-banner">
                Booze intake is paused (Auto Rank). Distillery will not add booze to inventory until you unblock intake on Account → Auto Rank.
              </div>
            )}
            {!!autoSell.enabled && salesWorkersCount < 1 && (
              <div className="dist-paused-banner">
                Auto-sell is on but you have <strong>0 sales workers</strong> — booze will stack instead of paying. Assign at least one sales worker under Crew.
              </div>
            )}
            {showFailuresBanner && (
              <div className="dist-alert">
                <div className="dist-alert-top">
                  <AlertTriangle size={16} color="var(--danger)" />
                  <div className="dist-alert-title">
                    {recentFailures.length} maintenance failure{recentFailures.length === 1 ? '' : 's'}
                  </div>
                  <button
                    type="button"
                    onClick={dismissFailuresBanner}
                    className="dist-alert-dismiss"
                    aria-label="Dismiss maintenance failures"
                    title="Dismiss"
                  >
                    <X size={16} strokeWidth={2.25} />
                  </button>
                </div>
                <p className="dist-alert-note">Low maintenance can break upgrade tiers. Broken tiers must be repurchased.</p>
                {visibleFailures.map((f, i) => (
                  <div key={`${f.at || 'x'}-${i}`} className="dist-alert-row">
                    <span>
                      {f.type === 'equipment_degrade' ? 'Equipment degraded' : 'Special upgrade lost'}: {prettyKey(f.item)}
                    </span>
                    <span className="dist-alert-meta">{Number(f.maintenance || 0).toFixed(1)}%</span>
                  </div>
                ))}
                {recentFailures.length > visibleFailures.length && (
                  <div className="dist-alert-meta">Showing the latest {visibleFailures.length}.</div>
                )}
                <div style={{ marginTop: 8 }}>
                  <GhostBtn onClick={() => setActiveSegment('maintenance')}>Review maintenance</GhostBtn>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="dist-seg-nav" role="tablist" aria-label="Distillery sections">
          {DIST_SEGMENTS.map((seg) => (
            <button
              key={seg.id}
              type="button"
              role="tab"
              aria-selected={activeSegment === seg.id}
              className={`dist-seg-btn ${activeSegment === seg.id ? 'is-active' : ''}`}
              onClick={() => setActiveSegment(seg.id)}
            >
              {seg.label}
            </button>
          ))}
        </div>

        <div className="dist-body">
          {activeSegment === 'overview' && (
            <div className="dist-two-col" role="tabpanel">
              <div className="dist-panel">
                <SectionHead icon={BarChart3} title="Now" />
                <div className="dist-roi-row"><span className="dist-roi-key">Heat</span><span className="dist-roi-val">{heatInfo.label} · {heat.toFixed(1)}°</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Risk</span><span className="dist-roi-val" style={{ fontWeight: 500, fontSize: 12 }}>{heatInfo.flavor}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Maintenance</span><span className="dist-roi-val" style={{ color: maintenancePct < 35 ? 'var(--danger)' : undefined }}>{maintenancePct.toFixed(1)}%</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Crew</span><span className="dist-roi-val">{workerTotal} / {workerCap}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Booze on hand</span><span className="dist-roi-val">{boozeUnitsCarrying}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Live cash/h</span><span className="dist-roi-val">{money(roi.cash_per_hour_estimate)}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Booze/h</span><span className="dist-roi-val">{Number(roi.booze_per_hour_estimate || 0).toFixed(2)}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Projected week</span><span className="dist-roi-val">{money(projectedWeeklyCash)}</span></div>
                <details className="dist-heat-help">
                  <summary>House details</summary>
                  <div className="dist-roi-row"><span className="dist-roi-key">Progress</span><span className="dist-roi-val">{progression.total_steps || 0}/{progression.max_steps || 0} · {progression.progress_pct || 0}%</span></div>
                  <div className="dist-roi-row"><span className="dist-roi-key">Week band</span><span className="dist-roi-val">{money(roi.target_weekly_low || 400000000)}–{money(roi.target_weekly_high || 1000000000)}</span></div>
                  <div className="dist-roi-row"><span className="dist-roi-key">Band progress</span><span className="dist-roi-val">{(Number(hardCapProgress || 0) * 100).toFixed(0)}%{Number(hardCapProgress || 0) >= 1 ? ' · at/above $1B/week top' : ' · toward $1B/week top'}</span></div>
                  <p className="dist-muted" style={{ marginTop: 8 }}>Collect banks the till to the vault, same as Racket Collect the Take.</p>
                </details>
              </div>
              <div className="dist-panel">
                <SectionHead icon={Zap} title="Do now" />
                <div className="dist-quick">
                  <GoldBtn
                    disabled={saving || riskCooldownActive || !allowVaultForHeat}
                    onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/risk-action', { action: 'cool_off' }); toast.success(res.data?.message || 'Heat cooled.'); })}
                  >
                    Cool Off {riskActionCosts.cool_off ? `(${money(riskActionCosts.cool_off)})` : ''}
                  </GoldBtn>
                  <GhostBtn onClick={() => setActiveSegment('maintenance')}>Repair</GhostBtn>
                  <GhostBtn onClick={() => setActiveSegment('crew')}>Crew</GhostBtn>
                  <GhostBtn onClick={() => setActiveSegment('maintenance')}>Maintenance</GhostBtn>
                  <GhostBtn onClick={() => setActiveSegment('operations')}>Operations</GhostBtn>
                </div>
                {riskCooldownActive && (
                  <p className="dist-muted" style={{ marginTop: 8 }}>
                    Cool Off locked for {riskCooldownMinutes >= 120 ? `${Math.ceil(riskCooldownMinutes / 60)}h` : `${riskCooldownMinutes} min`}.
                  </p>
                )}
                {maintenanceWarn && (
                  <div className="dist-maint-warn">Critical — upgrades may degrade and need repurchasing.</div>
                )}
              </div>
            </div>
          )}

          {activeSegment === 'operations' && (
            <div className="dist-two-col" role="tabpanel">
              <div className={`dist-panel ${heatInfo.cls}`}>
                <SectionHead icon={Flame} title="Heat & Enforcement" />
                <HeatBar heat={heat} />
                <div className="dist-heat-readout">
                  <div>
                    <div className="dist-heat-temp">{heat.toFixed(1)}°</div>
                    <div className="dist-heat-badge">{heatInfo.label}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', marginBottom: 4 }}>HEAT INDEX</div>
                    <div style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 700 }}>{heat.toFixed(1)} / 100</div>
                  </div>
                </div>
                <div className="dist-heat-flavor">{heatInfo.flavor}</div>
                {dist?.shutdown_until && (
                  <div className="dist-heat-shutdown">
                    <ShieldAlert size={13} />
                    Shutdown until {new Date(dist.shutdown_until).toLocaleString()}
                  </div>
                )}
                {riskCooldownActive && (
                  <div className="dist-heat-cooldown">
                    Cooldown: {riskCooldownMinutes >= 120
                      ? `${Math.ceil(riskCooldownMinutes / 60)}h`
                      : `${riskCooldownMinutes} min`}{' '}
                    left — Cool Off / Bribe locked for {riskCooldownHoursLabel}h after a risk action.
                  </div>
                )}
                {!allowVaultForHeat && (
                  <div className="dist-heat-cooldown" style={{ color: 'var(--text-dim)', borderColor: 'var(--border-dim)' }}>
                    Vault heat spend is <strong style={{ color: 'var(--amber)' }}>off</strong>: no vault seizure on collect; Cool Off / Bribe disabled.
                  </div>
                )}
                <div className="dist-btn-row">
                  <GoldBtn
                    disabled={saving || riskCooldownActive || !allowVaultForHeat}
                    onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/risk-action', { action: 'cool_off' }); toast.success(res.data?.message || 'Heat cooled.'); })}
                  >
                    Cool Off {riskActionCosts.cool_off ? `(${money(riskActionCosts.cool_off)})` : ''}
                  </GoldBtn>
                  <GhostBtn
                    disabled={saving || riskCooldownActive || !allowVaultForHeat}
                    onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/risk-action', { action: 'bribe_crackdown' }); toast.success(res.data?.message || 'Crackdown eased.'); })}
                  >
                    Bribe {riskActionCosts.bribe_crackdown ? `(${money(riskActionCosts.bribe_crackdown)})` : ''}
                  </GhostBtn>
                </div>
                <p style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.4 }}>
                  Cool Off ({money(riskActionCosts.cool_off || 900000)}) clears heat cheaper. Bribe ({money(riskActionCosts.bribe_crackdown || 3500000)}) also clears heat and lifts shutdown — same cooldown.
                </p>
                <div style={{ marginTop: 10 }}>
                  <GhostBtn
                    disabled={saving}
                    onClick={() => run(async () => {
                      const next = !allowVaultForHeat;
                      const res = await api.post('/illegal-business/distillery/set-heat-vault-spend', { allow_vault_for_heat: next });
                      toast.success(res.data?.message || (next ? 'Vault heat spend on.' : 'Vault heat spend off.'));
                    })}
                  >
                    {allowVaultForHeat ? 'Turn off vault paying for heat' : 'Turn vault paying for heat back on'}
                  </GhostBtn>
                </div>
                <details className="dist-heat-help" style={{ marginTop: 10, borderTop: '1px solid var(--border-dim)', paddingTop: 4 }}>
                  <summary>How heat works</summary>
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-muted)' }}>Passive heat:</strong> drops slowly with real time (page refreshes about every {REFRESH_MS / 1000}s). Baseline cooling is only ~1–2° per hour (faster with security, stealth specials, and during shutdown), so HOT can sit for a while — that is normal.
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-muted)' }}>Collect risk:</strong> at critical heat and above, a collect can trigger enforcement: short shutdown plus a vault seizure (about 5–22% of vault + that collect). Heat rises each collect from production and auto-sell.
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                    When vault heat spend is off, enforcement can still shut the still down but will not remove vault money. Cool Off / Bribe stay disabled until you re-enable.
                  </p>
                </details>
              </div>

              <div className="dist-panel">
                <SectionHead icon={BarChart3} title="ROI Forecast" />
                <div className="dist-roi-row"><span className="dist-roi-key">Live cash/h</span><span className="dist-roi-val">{money(roi.cash_per_hour_estimate)}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Till /h</span><span className="dist-roi-val">{money(roi.till_cash_per_hour_estimate)}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Booze sell /h</span><span className="dist-roi-val">{money(roi.booze_cash_per_hour_estimate)}</span></div>
                {!autoSellActive && Number(roi.booze_cash_per_hour_potential || 0) > 0 && (
                  <div className="dist-roi-row"><span className="dist-roi-key">Booze potential /h</span><span className="dist-roi-val" style={{ color: 'var(--amber)' }}>{money(roi.booze_cash_per_hour_potential)}</span></div>
                )}
                <div className="dist-roi-row"><span className="dist-roi-key">Risk-adjusted</span><span className="dist-roi-val">{money(roi.risk_adjusted_cash_per_hour_estimate)}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Projected 24h</span><span className="dist-roi-val">{money(projected24hCash)}</span></div>
                <div className="dist-roi-row"><span className="dist-roi-key">Projected week</span><span className="dist-roi-val">{money(projectedWeeklyCash)}</span></div>
                {(roi.racket_token_active || roi.booze_token_active) && (
                  <div className="dist-roi-row">
                    <span className="dist-roi-key">Token boost</span>
                    <span className="dist-roi-val" style={{ fontSize: 11 }}>
                      {[
                        roi.racket_token_active && `Racket +${Math.round((Number(roi.racket_token_income_mult || 1) - 1) * 100)}%`,
                        roi.booze_token_active && `Booze +${Math.round((Number(roi.booze_token_distillery_mult || 1) - 1) * 100)}%`,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
                <details className="dist-heat-help">
                  <summary>Forecast details</summary>
                  <div className="dist-roi-row"><span className="dist-roi-key">Downside</span><span className="dist-roi-val">{pct(roi.downside_exposure)}</span></div>
                  <div className="dist-roi-row"><span className="dist-roi-key">Loss events 24h</span><span className="dist-roi-val">{projectedLossEvents24h.toFixed(2)}</span></div>
                  <div className="dist-roi-row"><span className="dist-roi-key">Rebuy exposure</span><span className="dist-roi-val">{money(projectedRebuyCost24h)}</span></div>
                  <div className="dist-roi-row"><span className="dist-roi-key">Booze/h</span><span className="dist-roi-val">{Number(roi.booze_per_hour_estimate || 0).toFixed(2)}</span></div>
                  <div className="dist-roi-row"><span className="dist-roi-key">Next payback</span><span className="dist-roi-val">{roi.next_upgrade_payback_hours ?? 'n/a'}h</span></div>
                </details>
              </div>
            </div>
          )}

          {activeSegment === 'crew' && (
            <div className="dist-panel" role="tabpanel">
              <SectionHead icon={Users} title="Crew Roster" />
              <div className="dist-worker-cap">{workerTotal} / {workerCap} workers assigned</div>
              <div className="dist-muted" style={{ marginBottom: 8 }}>
                Increase worker cap by upgrading <strong style={{ color: 'var(--text)' }}>Bribe Office</strong> (+2 capacity per level).
              </div>
              <div className="dist-worker-grid">
                {['production', 'quality', 'security', 'sales'].map((role) => {
                  const current = Number(workers[role] || 0);
                  const cap = workerCap > 0 ? current / workerCap : 0;
                  return (
                    <div key={role} className="dist-worker-card">
                      <div className="dist-worker-role">{prettyKey(role)}</div>
                      <div className="dist-worker-num">{workerDraft[role] === '' ? '—' : workerDraft[role]}</div>
                      <div className="dist-worker-bar">
                        <div className="dist-worker-fill" style={{ width: `${Math.min(100, cap * 100)}%` }} />
                      </div>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={workerDraft[role] === '' ? '' : workerDraft[role]}
                        onChange={onDigitsOnlyOptionalIntChange((v) => setWorkerDraft((p) => ({ ...p, [role]: v })))}
                        onBlur={() => setWorkerDraft((p) => ({ ...p, [role]: Math.max(0, intOr(p[role] === '' ? NaN : p[role], 0)) }))}
                        className="dist-worker-input"
                      />
                    </div>
                  );
                })}
              </div>
              <GoldBtn
                disabled={saving}
                onClick={() => run(async () => {
                  const payload = {
                    production: Math.max(0, intOr(workerDraft.production, 0)),
                    quality: Math.max(0, intOr(workerDraft.quality, 0)),
                    security: Math.max(0, intOr(workerDraft.security, 0)),
                    sales: Math.max(0, intOr(workerDraft.sales, 0)),
                  };
                  const res = await api.post('/illegal-business/distillery/assign-workers', payload);
                  toast.success(res.data?.message || 'Workers assigned.');
                })}
              >
                Save Worker Plan
              </GoldBtn>
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-faint)' }}>
                {hiresNeeded > 0 ? `Hiring ${hiresNeeded} new · ${money(workerPlanCost)}` : 'No hire cost — reassign only.'}
              </div>
              {workerMaxHiresPerAction > 0 && (
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-faint)' }}>
                  Max new hires per action: {workerMaxHiresPerAction}
                </div>
              )}
            </div>
          )}

          {activeSegment === 'maintenance' && (
            <div className="dist-two-col" role="tabpanel">
              <div className="dist-panel">
                <SectionHead icon={Wrench} title="Maintenance" />
                <div className="dist-maint-label-row">
                  <span className="dist-maint-key">Current upkeep</span>
                  <span className="dist-maint-val" style={{ color: maintenancePct < 35 ? 'var(--danger)' : maintenancePct < 60 ? 'var(--amber)' : 'var(--green)' }}>
                    {maintenancePct.toFixed(1)}%
                  </span>
                </div>
                <div className="dist-maint-track">
                  <div
                    className="dist-maint-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, maintenancePct))}%`,
                      background: maintenancePct < 35 ? 'var(--red)' : maintenancePct < 60 ? 'var(--amber)' : 'var(--green)',
                    }}
                  />
                </div>
                {maintenanceWarn && (
                  <div className="dist-maint-warn">Critical — upgrades may degrade and need repurchasing.</div>
                )}
                <div className="dist-maint-input-row">
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    aria-label="Repair amount"
                    value={maintenancePoints === '' ? '' : maintenancePoints}
                    onChange={onDigitsOnlyOptionalIntChange(setMaintenancePoints)}
                    onBlur={() => setMaintenancePoints((q) => Math.max(1, intOr(q === '' ? NaN : q, 1)))}
                    className="dist-maint-input"
                  />
                  <GhostBtn
                    disabled={saving}
                    onClick={() => run(async () => {
                      const recover_points = Math.max(1, intOr(maintenancePoints, 1));
                      const res = await api.post('/illegal-business/distillery/maintenance', { recover_points });
                      toast.success(res.data?.message || 'Maintenance done.');
                    })}
                  >
                    Repair
                  </GhostBtn>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{money(maintenanceCost)}</span>
                </div>
              </div>
              <div className="dist-panel">
                <SectionHead icon={AlertTriangle} title="Failures" />
                {visibleFailures.length === 0 ? (
                  <p className="dist-muted">No recent maintenance failures.</p>
                ) : (
                  visibleFailures.map((f, i) => (
                    <div key={`${f.at || 'm'}-${i}`} className="dist-alert-row">
                      <span>
                        {f.type === 'equipment_degrade' ? 'Equipment degraded' : 'Special upgrade lost'}: {prettyKey(f.item)}
                      </span>
                      <span className="dist-alert-meta">{Number(f.maintenance || 0).toFixed(1)}%</span>
                    </div>
                  ))
                )}
                <p className="dist-muted" style={{ marginTop: 8 }}>Low maintenance can break upgrade tiers. Broken tiers must be repurchased.</p>
              </div>
            </div>
          )}

          {activeSegment === 'equipment' && (
            <div className="dist-panel" role="tabpanel">
              <SectionHead icon={Zap} title="Equipment · 9 lanes × 20" />
              <div className="dist-equip-grid">
                {EQUIPMENT_ORDER.map((lane) => {
                  const lv = Number(equipment[lane] || 0);
                  const cost = equipmentCosts[lane];
                  const maxed = cost == null;
                  const canAfford = maxed || vaultBalance >= Number(cost || 0);
                  return (
                    <div
                      key={lane}
                      className={`dist-equip-card ${maxed ? 'is-maxed' : ''} ${!maxed && !canAfford ? 'is-unaffordable' : ''}`}
                    >
                      <div className="dist-equip-icon">{EQUIPMENT_ICONS[lane] || '⚙'}</div>
                      <div className="dist-equip-name">{prettyKey(lane)}</div>
                      <div className="dist-equip-lv">Lv {lv} / 20</div>
                      {EQUIPMENT_DESC[lane] && <div className="dist-equip-desc">{EQUIPMENT_DESC[lane]}</div>}
                      <div className="dist-level-bar" aria-hidden>
                        <div className="dist-level-bar-fill" style={{ width: `${Math.min(100, (lv / 20) * 100)}%`, background: 'var(--amber)' }} />
                      </div>
                      {maxed ? (
                        <div className="dist-equip-maxed">Maxed</div>
                      ) : (
                        <GoldBtn
                          className="w-full"
                          disabled={saving || !canAfford}
                          onClick={() => run(async () => {
                            const res = await api.post('/illegal-business/distillery/upgrade-equipment', { lane });
                            toast.success(res.data?.message || 'Upgraded.');
                          })}
                        >
                          Upgrade {money(cost)}
                        </GoldBtn>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeSegment === 'perks' && (
            <div className="dist-panel" id="dist-tracks" role="tabpanel">
              <SectionHead icon={Layers} title="Special Tracks · 180 Perks" />
              {bestNextUpgrades.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div className="dist-input-label" style={{ marginBottom: 6 }}>Recommended next</div>
                  <div className="dist-chip-row">
                    {bestNextUpgrades.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="dist-chip"
                        onClick={() => {
                          setActiveTrack(u.track);
                          setActiveSegment('perks');
                        }}
                      >
                        {prettyKey(u.track)} · T{u.tier} · {money(u.cost)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="dist-track-scroll">
                {TRACKS.map((track) => (
                  <button
                    key={track}
                    type="button"
                    onClick={() => setActiveTrack(track)}
                    className={`dist-track-tab shrink-0 whitespace-nowrap border-b-2 font-heading text-[9px] font-bold uppercase tracking-wider transition-all touch-manipulation ${
                      activeTrack === track
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-transparent bg-transparent text-mutedForeground hover:border-primary/30 hover:bg-primary/5 hover:text-foreground'
                    }`}
                  >
                    {prettyKey(track)}
                  </button>
                ))}
              </div>
              <div className="dist-track-nav">
                <div className="dist-track-nav-meta">
                  {activeSpecial ? `${clampedSpecialCursor + 1} / ${Math.max(1, visibleTrackRows.length)}` : '0/0'} · Purchased {purchasedInTrack}/{trackRows.length}
                </div>
                <div className="dist-track-nav-btns">
                  <GhostBtn className="!min-w-[44px] !px-0" disabled={clampedSpecialCursor <= 0} onClick={() => setSpecialCursor((v) => Math.max(0, v - 1))}>
                    <ChevronLeft size={14} />
                  </GhostBtn>
                  <GhostBtn className="!min-w-[44px] !px-0" disabled={clampedSpecialCursor >= maxSpecialIndex} onClick={() => setSpecialCursor((v) => Math.min(maxSpecialIndex, v + 1))}>
                    <ChevronRight size={14} />
                  </GhostBtn>
                </div>
              </div>
              {activeSpecial ? (
                <div className="dist-upgrade-showcase">
                  <div>
                    <div className="dist-upgrade-name">{activeSpecial.name}</div>
                    <div className="dist-upgrade-tier">Tier {activeSpecial.tier} · {prettyKey(activeSpecial.track)}</div>
                    <div className="dist-upgrade-price">{money(activeSpecial.cost)}</div>
                    {activeSpecial.purchased
                      ? <div className="dist-upgrade-status-owned">Owned</div>
                      : activeSpecial.available
                        ? <div className="dist-upgrade-status-avail">Available to purchase</div>
                        : <div className="dist-upgrade-status-locked">Locked — complete earlier tiers first</div>
                    }
                    <details className="dist-heat-help">
                      <summary>Perk details</summary>
                      <p className="dist-muted">{TRACK_FLAVOR[activeSpecial.track] || TRACK_FLAVOR[activeTrack]}</p>
                      {TRACK_EFFECTS[activeSpecial.track] && (
                        <div className="dist-upgrade-effects">
                          {TRACK_EFFECTS[activeSpecial.track].map((e) => <span key={e}>{e}</span>)}
                        </div>
                      )}
                    </details>
                  </div>
                  <GoldBtn
                    className="w-full sm:w-auto"
                    disabled={
                      saving
                      || !activeSpecial.available
                      || activeSpecial.purchased
                      || vaultBalance < Number(activeSpecial.cost || 0)
                    }
                    onClick={() => run(async () => {
                      const res = await api.post('/illegal-business/distillery/buy-special-upgrade', { upgrade_id: activeSpecial.id });
                      toast.success(res.data?.message || 'Upgrade bought.');
                    })}
                  >
                    {activeSpecial.purchased ? 'Owned' : `Buy ${money(activeSpecial.cost)}`}
                  </GoldBtn>
                </div>
              ) : (
                <div className="dist-no-upgrade">No upgrades visible in this track yet.</div>
              )}
            </div>
          )}

          {activeSegment === 'cellar' && (
            <div className="dist-panel" role="tabpanel">
              <SectionHead icon={Clock3} title="Cellar" />
              <div className="dist-subnav" role="tablist" aria-label="Cellar">
                <button type="button" role="tab" aria-selected={cellarPane === 'aging'} className={`dist-seg-btn ${cellarPane === 'aging' ? 'is-active' : ''}`} onClick={() => setCellarPane('aging')}>Aging</button>
                <button type="button" role="tab" aria-selected={cellarPane === 'auto'} className={`dist-seg-btn ${cellarPane === 'auto' ? 'is-active' : ''}`} onClick={() => setCellarPane('auto')}>Auto-Aging</button>
              </div>

              {cellarPane === 'aging' && (
                <div>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-[11px] font-heading text-mutedForeground">
                    <span>
                      On hand:{' '}
                      <span className="font-bold tabular-nums text-primary">{boozeUnitsCarrying}</span>
                      {' '}booze
                    </span>
                    {boozeUnitsCarrying > 0 && (
                      <button
                        type="button"
                        className="shrink-0 min-h-[44px] rounded border border-primary/30 bg-primary/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20 disabled:opacity-40 touch-manipulation"
                        disabled={saving}
                        onClick={() => setAgingQty(Math.max(1, boozeUnitsCarrying))}
                      >
                        Set qty to max
                      </button>
                    )}
                  </div>
                  <div className="dist-tier-row">
                    {['quick', 'standard', 'reserve', 'premium'].map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setAgingTier(tier)}
                        className={`dist-tier-btn ${agingTier === tier ? 'is-active' : ''}`}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                  <div className="dist-barrel-row">
                    {queue.length === 0 && (
                      <div style={{ fontStyle: 'italic', fontSize: 12, color: 'var(--text-faint)' }}>No active batches.</div>
                    )}
                    {queue.slice(0, 8).map((b) => {
                      const ready = new Date(b.ready_at) <= new Date();
                      const hoursLeft = Math.max(0, (new Date(b.ready_at) - new Date()) / 3600000);
                      return (
                        <Barrel
                          key={b.id}
                          ready={ready}
                          label={ready ? 'READY' : `${hoursLeft.toFixed(0)}h`}
                        />
                      );
                    })}
                  </div>
                  <div className="dist-aging-start-row">
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      aria-label="Batch quantity"
                      value={agingQty === '' ? '' : agingQty}
                      onChange={onDigitsOnlyOptionalIntChange(setAgingQty)}
                      onBlur={() => setAgingQty((q) => Math.max(1, intOr(q === '' ? NaN : q, 1)))}
                      className="dist-aging-qty-input"
                    />
                    <GoldBtn
                      disabled={saving}
                      onClick={() => run(async () => {
                        const quantity = Math.max(1, intOr(agingQty === '' ? NaN : agingQty, 1));
                        const res = await api.post('/illegal-business/distillery/start-aging-batch', { tier: agingTier, quantity });
                        toast.success(res.data?.message || 'Batch started.');
                      })}
                    >
                      Start Batch
                    </GoldBtn>
                  </div>
                  {queue.length > 0 && (
                    <div className="dist-queue-list">
                      {queue.map((b) => {
                        const ready = new Date(b.ready_at) <= new Date();
                        return (
                          <div key={b.id} className="dist-queue-item">
                            <div>
                              <div className="dist-queue-tier">{prettyKey(b.tier)} · {b.quantity} units</div>
                              <div className="dist-queue-time">Ready {new Date(b.ready_at).toLocaleString()}</div>
                            </div>
                            <GhostBtn
                              disabled={saving || !ready}
                              onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/claim-aged-batch', { batch_id: b.id }); toast.success(res.data?.message || 'Batch claimed.'); })}
                            >
                              Claim
                            </GhostBtn>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {cellarPane === 'auto' && (
                <div>
                  {passiveBoozePaused && (
                    <div className="dist-paused-banner" style={{ marginBottom: 10 }}>
                      Booze intake is paused — auto-aging cannot stock new booze until Auto Rank unblocks intake.
                    </div>
                  )}
                  <div className="dist-status-line">
                    <strong>{autoAging.enabled ? 'ON' : 'OFF'}</strong>
                    {' · '}{autoAging.tier}
                    {' · '}reserve {intOr(autoAging.reserve_units, 0)}
                    {' · '}{autoAging.auto_collect_booze ? 'auto-collect on' : 'auto-collect off'}
                  </div>
                  <details className="dist-heat-help" style={{ marginBottom: 10 }}>
                    <summary>How auto-aging works</summary>
                    <p className="mb-2 text-[10px] leading-snug text-mutedForeground">
                      Claims ready batches, starts new ones when spare booze stays above your reserve (≥25 spare), and can run throttled racket Collect. Turn off for full manual cellar control.
                    </p>
                    <p className="text-[9px] leading-snug text-mutedForeground">
                      To block <strong className="text-foreground/85">all</strong> booze intake, use Account → Auto Rank → Block all booze intake.
                    </p>
                  </details>
                  <div className="dist-autosell-row">
                    <input
                      type="checkbox"
                      checked={!!autoAging.enabled}
                      onChange={(e) => setAutoAging((p) => ({ ...p, enabled: e.target.checked }))}
                      className="dist-autosell-check"
                      id="autoaging-toggle"
                    />
                    <label htmlFor="autoaging-toggle" className="dist-autosell-label">Enable auto-aging</label>
                  </div>
                  <div className="dist-input-label">Auto tier</div>
                  <div className="dist-tier-row">
                    {['quick', 'standard', 'reserve', 'premium'].map((tier) => (
                      <button
                        key={`auto-${tier}`}
                        type="button"
                        onClick={() => setAutoAging((p) => ({ ...p, tier }))}
                        className={`dist-tier-btn ${autoAging.tier === tier ? 'is-active' : ''}`}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                  <div className="dist-autosell-inputs">
                    <div>
                      <div className="dist-input-label">Reserve (min on hand)</div>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={autoAging.reserve_units === '' ? '' : autoAging.reserve_units}
                        onChange={onDigitsOnlyOptionalIntChange((v) => setAutoAging((p) => ({ ...p, reserve_units: v })))}
                        onBlur={() => setAutoAging((p) => ({ ...p, reserve_units: Math.max(0, intOr(p.reserve_units === '' ? NaN : p.reserve_units, 0)) }))}
                        className="dist-input"
                      />
                    </div>
                  </div>
                  <div className="dist-autosell-row mt-2">
                    <input
                      type="checkbox"
                      checked={!!autoAging.auto_collect_booze}
                      onChange={(e) => setAutoAging((p) => ({ ...p, auto_collect_booze: e.target.checked }))}
                      className="dist-autosell-check"
                      id="autoaging-collect"
                    />
                    <label htmlFor="autoaging-collect" className="dist-autosell-label">Auto-collect racket (throttled)</label>
                  </div>
                  <GhostBtn
                    className="mt-3 w-full sm:w-auto"
                    disabled={saving}
                    onClick={() => run(async () => {
                      const res = await api.post('/illegal-business/distillery/set-auto-aging-rules', {
                        enabled: !!autoAging.enabled,
                        tier: autoAging.tier,
                        reserve_units: Math.max(0, intOr(autoAging.reserve_units, 0)),
                        auto_collect_booze: !!autoAging.auto_collect_booze,
                      });
                      toast.success(res.data?.message || 'Auto-aging saved.');
                    })}
                  >
                    Save Auto-Aging
                  </GhostBtn>
                </div>
              )}
            </div>
          )}

          {activeSegment === 'automation' && (
            <div className="dist-two-col" role="tabpanel">
              <div className="dist-panel">
                <SectionHead icon={TrendingUp} title="Auto-Sell Rules">
                  <TooltipProvider>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-primary/30 p-1 text-primary/75 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary touch-manipulation"
                          aria-label="How auto-sell works"
                        >
                          <CircleHelp size={14} aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[min(320px,calc(100vw-2rem))] space-y-2 p-3 text-left text-[11px] leading-snug text-primary-foreground">
                        <p className="font-heading text-[10px] font-bold uppercase tracking-wide text-primary-foreground">How auto-sell works</p>
                        <ul className="list-disc space-y-1.5 pl-3.5 normal-case">
                          <li>Runs when you <strong className="font-semibold">Collect</strong> (or auto-collect).</li>
                          <li>Needs <strong className="font-semibold">Sales</strong> workers.</li>
                          <li><strong className="font-semibold">Min inventory</strong> is kept; <strong className="font-semibold">Batch size</strong> caps per worker per collect.</li>
                          <li><strong className="font-semibold">Crew</strong> = vault margin. <strong className="font-semibold">Booze run</strong> = street prices + jail risk.</li>
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </SectionHead>
                <div className="dist-status-line">
                  <strong>{autoSell.enabled ? 'ON' : 'OFF'}</strong>
                  {' · '}{autoSell.mode === 'booze_run' ? 'booze run' : 'crew'}
                  {' · '}min {intOr(autoSell.min_inventory, 0)}
                  {' · '}batch {intOr(autoSell.batch_size, 1)}
                </div>
                <div className="dist-life">
                  <div className="dist-input-label">Lifetime totals</div>
                  <div className="dist-life-top">
                    <span>Vault <strong style={{ color: 'var(--text)' }}>{money(autoSellVaultCombined)}</strong></span>
                    <span>Units <strong style={{ color: 'var(--text)' }}>{autoSellUnitsLifetime.toLocaleString()}</strong></span>
                  </div>
                  <div className="dist-life-sub">
                    <span>Crew <strong style={{ color: 'var(--text)' }}>{money(autoSellCrewVaultLifetime)}</strong></span>
                    <span>Booze run <strong style={{ color: 'var(--text)' }}>{money(autoSellBoozeRunVaultLifetime)}</strong></span>
                  </div>
                </div>
                <div className="dist-autosell-row">
                  <input
                    type="checkbox"
                    checked={!!autoSell.enabled}
                    onChange={(e) => setAutoSell((p) => ({ ...p, enabled: e.target.checked }))}
                    className="dist-autosell-check"
                    id="autosell-toggle"
                  />
                  <label htmlFor="autosell-toggle" className="dist-autosell-label">Enable auto-sell</label>
                </div>
                <div className="dist-mode-row">
                  <label className="dist-mode">
                    <input
                      type="radio"
                      name="autosell-mode"
                      checked={autoSell.mode !== 'booze_run'}
                      onChange={() => setAutoSell((p) => ({ ...p, mode: 'crew' }))}
                    />
                    Crew (vault)
                  </label>
                  <label className="dist-mode">
                    <input
                      type="radio"
                      name="autosell-mode"
                      checked={autoSell.mode === 'booze_run'}
                      onChange={() => setAutoSell((p) => ({ ...p, mode: 'booze_run' }))}
                    />
                    Booze run
                  </label>
                </div>
                <div className="dist-autosell-inputs">
                  <div>
                    <div className="dist-input-label">Min inventory</div>
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={autoSell.min_inventory === '' ? '' : autoSell.min_inventory}
                      onChange={onDigitsOnlyOptionalIntChange((v) => setAutoSell((p) => ({ ...p, min_inventory: v })))}
                      onBlur={() => setAutoSell((p) => ({ ...p, min_inventory: Math.max(0, intOr(p.min_inventory === '' ? NaN : p.min_inventory, 0)) }))}
                      className="dist-input"
                    />
                  </div>
                  <div>
                    <div className="dist-input-label">Batch size</div>
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={autoSell.batch_size === '' ? '' : autoSell.batch_size}
                      onChange={onDigitsOnlyOptionalIntChange((v) => setAutoSell((p) => ({ ...p, batch_size: v })))}
                      onBlur={() => setAutoSell((p) => ({ ...p, batch_size: Math.max(1, intOr(p.batch_size === '' ? NaN : p.batch_size, 1)) }))}
                      className="dist-input"
                    />
                  </div>
                </div>
                <GhostBtn
                  className="mt-3 w-full sm:w-auto"
                  disabled={saving}
                  onClick={() => run(async () => {
                    const payload = {
                      enabled: !!autoSell.enabled,
                      mode: autoSell.mode === 'booze_run' ? 'booze_run' : 'crew',
                      min_inventory: Math.max(0, intOr(autoSell.min_inventory, 0)),
                      batch_size: Math.max(1, intOr(autoSell.batch_size, 1)),
                    };
                    const res = await api.post('/illegal-business/distillery/set-auto-sell-rules', payload);
                    toast.success(res.data?.message || 'Auto-sell rules saved.');
                  })}
                >
                  Save Auto-Sell
                </GhostBtn>
              </div>
              <div className="dist-panel">
                <SectionHead icon={Zap} title="Auto-Aging" />
                <div className="dist-status-line">
                  <strong>{autoAging.enabled ? 'ON' : 'OFF'}</strong>
                  {' · '}{autoAging.tier}
                </div>
                <GhostBtn onClick={() => { setCellarPane('auto'); setActiveSegment('cellar'); }}>
                  Configure in Cellar
                </GhostBtn>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
