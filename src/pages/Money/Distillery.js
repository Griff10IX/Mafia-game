import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Users, Wrench, BarChart3, Clock3, ShieldAlert, TrendingUp, Layers, AlertTriangle, ChevronLeft, ChevronRight, Zap, CircleHelp } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';

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
const EQUIPMENT_ICONS = {
  stills: '⚗', condensers: '🌡', mash_tun: '🪣', barrels: '🛢',
  bottling: '🍾', tunnel: '🕳', bribe_office: '💼', fake_labels: '🏷', quality_lab: '🔬',
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

// ── Animated steam wisps ──────────────────────────────────────────────────────
function SteamWisps({ count = 3 }) {
  return (
    <div className="dist-steam-container" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="dist-steam-wisp"
          style={{ animationDelay: `${i * 0.8}s`, left: `${20 + i * 30}%` }}
        />
      ))}
    </div>
  );
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

// ── Equipment pip indicator ───────────────────────────────────────────────────
function LevelPips({ level, max = 20 }) {
  return (
    <div className="dist-pip-row">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`dist-pip ${i < level ? 'dist-pip-filled' : 'dist-pip-empty'}`}
        />
      ))}
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

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div className="dist-stat-card">
      <div className="dist-stat-label">{label}</div>
      <div className={`dist-stat-value ${accent ? 'dist-stat-accent' : ''}`}>{value}</div>
      {sub && <div className="dist-stat-sub">{sub}</div>}
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
function GoldBtn({ children, onClick, disabled, small }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded border border-primary/40 bg-primary/20 font-heading font-bold uppercase text-primary transition-all hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? 'px-2.5 py-1.5 text-[8px] tracking-wider' : 'px-4 py-2 text-[10px] tracking-wider'
      }`}
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick, disabled, small }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded border border-primary/30 bg-primary/10 font-heading font-bold uppercase text-primary transition-all hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? 'px-2 py-1 text-[8px] tracking-wider' : 'px-3 py-2 text-[10px] tracking-wider'
      }`}
    >
      {children}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Distillery() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [pendingTake, setPendingTake] = useState(0);
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
      setPendingTake(Number(bizRes.data?.pending_take || 0));
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
      if (!silent) {
        setState(null);
        setBusiness(null);
        setPendingTake(0);
      }
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
  const maintenanceWarn = maintenancePct < 35;

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`${styles.pageContent} mobile-page-root dist-root`}>
        <div className="dist-loading">
          <div className="dist-loading-still">⚗</div>
          <div className="dist-loading-text">Firing up the copper…</div>
        </div>
      </div>
    );
  }

  // ── No business ─────────────────────────────────────────────────────────────
  if (!state || !business) {
    return (
      <div className={`${styles.pageContent} mobile-page-root dist-root`}>
        <div className="dist-empty-panel">
          <div className="dist-empty-icon">⚗</div>
          <h1 className="dist-empty-title">No Still Running</h1>
          <p className="dist-empty-sub">You need an illegal business first. Start one from your racket page.</p>
          <Link
            to="/money/racket"
            className="inline-block border border-primary/35 bg-primary/10 px-5 py-2 text-[11px] font-heading font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20"
          >
            Go to Racket →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Injected styles ─────────────────────────────────────────────────── */}
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
        }

        .dist-root { background: var(--noir-content); color: var(--noir-foreground); font-family: inherit; min-height: 100vh; }
        .dist-root * { font-family: inherit; }
        body[data-theme-variant="modern"] .dist-root {
          --bg: var(--modern-surface-2, #1f1f24);
          --bg2: rgba(45, 45, 50, 0.95);
          --bg3: rgba(55, 55, 60, 0.95);
          --bg4: rgba(24, 24, 27, 0.95);
          --border: var(--modern-border-soft, rgba(161, 161, 170, 0.22));
          --border-dim: var(--modern-divider, rgba(161, 161, 170, 0.14));
          --text-faint: rgba(228, 228, 231, 0.62);
        }

        /* Loading */
        .dist-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; gap: 16px; }
        .dist-loading-still { font-size: 48px; animation: dist-spin 3s linear infinite; }
        @keyframes dist-spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        .dist-loading-text { font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: var(--gold-dim); }

        /* Empty */
        .dist-empty-panel { background: var(--bg2); border: 1px solid var(--border); padding: 40px; text-align: center; margin: 20px; }
        .dist-empty-icon { font-size: 48px; margin-bottom: 16px; }
        .dist-empty-title { font-size: 20px; color: var(--gold); margin-bottom: 8px; }
        .dist-empty-sub { font-size: 14px; color: var(--text-dim); margin-bottom: 16px; }
        /* Hero banner */
        .dist-hero { background: var(--bg2); border-bottom: 2px solid var(--border); padding: 20px 20px 0; position: relative; overflow: hidden; }
        .dist-hero-bg-text { position: absolute; right: -10px; top: -10px; font-size: 90px; font-weight: 900; color: rgba(var(--noir-primary-rgb), 0.07); pointer-events: none; user-select: none; line-height: 1; }
        .dist-hero-eyebrow { font-size: 9px; letter-spacing: 5px; text-transform: uppercase; color: var(--text-faint); margin-bottom: 6px; }
        .dist-hero-title { font-size: 32px; font-weight: 900; color: var(--gold); letter-spacing: 4px; margin: 0 0 4px; line-height: 1.1; }
        .dist-hero-tagline { font-style: italic; font-size: 14px; color: var(--text-dim); margin-bottom: 16px; }
        .dist-hero-top-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .dist-hero-status-strip { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1px; background: var(--border-dim); border-top: 1px solid var(--border); margin: 0 -20px; }
        .dist-hero-status-cell { background: var(--bg2); padding: 10px 16px; }
        .dist-hero-status-l { font-size: 8px; letter-spacing: 3px; text-transform: uppercase; color: var(--text-faint); margin-bottom: 4px; }
        .dist-hero-status-v { font-size: 12px; color: var(--text); }

        /* Steam wisps */
        .dist-steam-container { position: absolute; bottom: 0; left: 0; right: 0; height: 60px; pointer-events: none; overflow: hidden; }
        .dist-steam-wisp { position: absolute; bottom: 0; width: 3px; border-radius: 2px; background: rgba(200,160,60,0.12); animation: dist-steam 2.5s ease-in infinite; }
        @keyframes dist-steam { 0%{height:0;opacity:.5;transform:translateX(0) scaleX(1)} 60%{opacity:.2} 100%{height:50px;opacity:0;transform:translateX(6px) scaleX(2)} }

        /* Stat strip */
        .dist-stat-strip { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 1px; background: var(--border); border-bottom: 1px solid var(--border); }
        .dist-stat-card { background: var(--bg); padding: 14px 16px; }
        .dist-stat-label { font-size: 8px; letter-spacing: 3px; text-transform: uppercase; color: var(--text-faint); margin-bottom: 6px; }
        .dist-stat-value { font-size: 20px; color: var(--text); font-weight: 700; }
        .dist-stat-accent { color: var(--gold); }
        .dist-stat-sub { font-size: 10px; color: var(--text-faint); margin-top: 2px; }

        /* Main body */
        .dist-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

        /* Panel */
        .dist-panel { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--app-surface-radius, 8px); box-shadow: var(--app-card-shadow, none); padding: 16px 18px; position: relative; overflow: hidden; }
        .dist-panel::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(var(--noir-primary-rgb), 0.24), transparent); }
        .dist-panel-danger { background: rgba(196,64,32,0.06); border-color: rgba(196,64,32,0.4); }

        /* Heat */
        .dist-heat-seg-wrap { display: flex; gap: 2px; height: 14px; align-items: center; position: relative; }
        .dist-heat-seg { flex: 1; height: 100%; transition: background 0.5s; }
        .dist-heat-seg-lit { }
        .dist-heat-seg-dim { background: var(--bg4); }
        .dist-heat-scanner { position: absolute; top: 0; bottom: 0; width: 3px; background: rgba(232,192,96,0.6); transform: translateX(-50%); animation: dist-scanner-pulse 1.2s ease-in-out infinite; transition: left 1s ease; }
        @keyframes dist-scanner-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
        .dist-heat-readout { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
        .dist-heat-temp { font-size: 28px; font-weight: 700; transition: color 0.5s; }
        .heat-meltdown .dist-heat-temp, .heat-meltdown .dist-heat-badge { color: var(--heat-meltdown); border-color: var(--heat-meltdown-border); }
        .heat-critical .dist-heat-temp, .heat-critical .dist-heat-badge { color: var(--heat-critical); border-color: var(--heat-critical-border); }
        .heat-hot .dist-heat-temp, .heat-hot .dist-heat-badge { color: var(--heat-hot); border-color: var(--heat-hot-border); }
        .heat-warm .dist-heat-temp, .heat-warm .dist-heat-badge { color: var(--heat-warm); border-color: var(--heat-warm-border); }
        .heat-low .dist-heat-temp, .heat-low .dist-heat-badge { color: var(--heat-safe); border-color: var(--heat-safe-border); }
        .dist-heat-badge { font-size: 10px; font-weight: 700; letter-spacing: 3px; padding: 4px 12px; border: 1px solid; color: var(--gold); }
        .dist-heat-flavor { font-style: italic; font-size: 12px; color: var(--text-dim); margin-top: 6px; }
        .dist-heat-shutdown { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--danger); margin-top: 8px; background: rgba(255, 107, 107, 0.1); border: 1px solid var(--danger-soft); padding: 6px 10px; }
        .dist-heat-cooldown { font-size: 10px; color: var(--heat-warm); margin-top: 8px; }

        .dist-btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }

        /* Two cols */
        .dist-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 640px) { .dist-two-col { grid-template-columns: 1fr; } .dist-stat-strip { grid-template-columns: 1fr 1fr; } }

        /* Equipment */
        .dist-equip-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
        @media (max-width: 500px) { .dist-equip-grid { grid-template-columns: 1fr 1fr; } }
        .dist-equip-card { background: var(--bg); padding: 12px; cursor: pointer; transition: border-color 0.2s, background 0.2s; position: relative; overflow: hidden; }
        .dist-equip-card::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, rgba(var(--noir-primary-rgb), 0.45), transparent); opacity: 0; transition: opacity 0.2s; }
        .dist-equip-card:hover:not(:disabled)::after { opacity: 1; }
        .dist-equip-card:disabled { opacity: 0.5; cursor: not-allowed; }
        .dist-equip-icon { font-size: 18px; margin-bottom: 6px; }
        .dist-equip-name { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 8px; }
        .dist-equip-cost { font-size: 10px; color: var(--amber); margin-top: 5px; }
        .dist-equip-maxed { font-size: 10px; color: var(--green); margin-top: 5px; }

        /* Pip row */
        .dist-pip-row { display: flex; gap: 2px; flex-wrap: wrap; margin-bottom: 3px; }
        .dist-pip { width: 5px; height: 5px; }
        .dist-pip-filled { background: var(--amber); }
        .dist-pip-empty { background: var(--bg4); }

        /* Best upgrades */
        .dist-best-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-dim); }
        .dist-best-row:last-child { border-bottom: none; }
        .dist-best-name { font-size: 13px; color: var(--text); }
        .dist-best-meta { font-size: 10px; color: var(--text-faint); margin-top: 2px; }

        /* Workers */
        .dist-worker-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .dist-worker-card { background: var(--bg); border: 1px solid var(--border-dim); padding: 12px; }
        .dist-worker-role { font-size: 8px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-faint); margin-bottom: 6px; }
        .dist-worker-num { font-size: 22px; color: var(--gold); margin-bottom: 6px; }
        .dist-worker-bar { height: 3px; background: var(--bg4); }
        .dist-worker-fill { height: 100%; background: var(--amber); transition: width 0.5s; }
        .dist-worker-input { width: 100%; padding: 6px 8px; background: var(--noir-content); border: 1px solid var(--border); color: var(--text); font-size: 13px; margin-top: 4px; }
        .dist-worker-input:focus { outline: none; border-color: var(--amber-dim); }
        .dist-worker-cap { font-size: 10px; color: var(--text-faint); margin-bottom: 10px; }

        /* Maintenance */
        .dist-maint-bar-wrap { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-dim); }
        .dist-maint-label-row { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 5px; }
        .dist-maint-key { color: var(--text-dim); font-size: 9px; text-transform: uppercase; letter-spacing: 2px; }
        .dist-maint-val { font-weight: 700; }
        .dist-maint-track { height: 8px; background: var(--bg4); border: 1px solid var(--border-dim); }
        .dist-maint-fill { height: 100%; transition: width 0.6s; }
        .dist-maint-warn { font-size: 11px; color: var(--danger); margin-top: 8px; font-style: italic; background: rgba(255, 107, 107, 0.1); padding: 6px 10px; border-left: 2px solid var(--danger-soft); }
        .dist-maint-input-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
        .dist-maint-input { width: 70px; padding: 6px 8px; background: var(--noir-content); border: 1px solid var(--border); color: var(--text); font-size: 13px; }
        .dist-maint-input:focus { outline: none; border-color: var(--amber-dim); }

        /* ROI */
        .dist-roi-row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--border-dim); }
        .dist-roi-row:last-child { border-bottom: none; }
        .dist-roi-key { font-size: 9px; letter-spacing: 1px; color: var(--text-faint); text-transform: uppercase; }
        .dist-roi-val { font-size: 14px; color: var(--gold); font-weight: 700; }

        /* Tracks */
        .dist-track-scroll { display: flex; gap: 0; overflow-x: auto; background: rgba(var(--noir-primary-rgb), 0.06); border-bottom: 1px solid rgba(var(--noir-primary-rgb), 0.18); margin: 0 -18px; padding: 0; }
        .dist-track-scroll::-webkit-scrollbar { height: 2px; }
        .dist-track-scroll::-webkit-scrollbar-thumb { background: var(--border); }
        .dist-track-flavor { font-style: italic; font-size: 13px; color: var(--text-dim); margin: 12px 0 14px; }
        .dist-track-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .dist-track-nav-meta { font-size: 9px; color: var(--text-faint); }
        .dist-track-nav-btns { display: flex; gap: 6px; }
        .dist-upgrade-showcase { background: var(--bg); padding: 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
        .dist-upgrade-name { font-size: 16px; color: var(--gold-pale); margin-bottom: 4px; font-weight: 700; }
        .dist-upgrade-tier { font-size: 9px; color: var(--text-faint); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; }
        .dist-upgrade-price { font-size: 22px; color: var(--amber); font-weight: 700; }
        .dist-upgrade-status-owned { font-size: 11px; color: var(--green); font-style: italic; margin-top: 4px; }
        .dist-upgrade-status-avail { font-size: 11px; color: var(--text-dim); font-style: italic; margin-top: 4px; }
        .dist-upgrade-status-locked { font-size: 11px; color: var(--text-faint); font-style: italic; margin-top: 4px; }
        .dist-no-upgrade { font-size: 13px; color: var(--text-faint); font-style: italic; }

        /* Aging */
        .dist-barrel-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; align-items: flex-end; }
        .dist-barrel-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; }
        .dist-barrel-label { font-size: 8px; color: var(--text-faint); }
        .dist-barrel-ready { color: var(--green); font-weight: 600; }
        .dist-aging-start-row { display: flex; gap: 8px; align-items: center; }
        .dist-aging-qty-input { width: 70px; padding: 6px 8px; background: var(--bg); border: 1px solid var(--border); color: var(--text); font-size: 13px; }
        .dist-aging-qty-input:focus { outline: none; border-color: var(--amber-dim); }
        .dist-queue-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-dim); }
        .dist-queue-item { background: var(--bg); border: 1px solid var(--border-dim); padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .dist-queue-tier { font-size: 12px; color: var(--text); font-weight: 700; }
        .dist-queue-time { font-size: 9px; color: var(--text-faint); margin-top: 2px; }

        /* Auto-sell */
        .dist-autosell-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .dist-autosell-check { width: 16px; height: 16px; accent-color: var(--amber); }
        .dist-autosell-label { font-size: 13px; color: var(--text-dim); }
        .dist-autosell-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
        .dist-input { width: 100%; padding: 7px 10px; background: var(--noir-content); border: 1px solid var(--border); color: var(--text); font-size: 13px; box-sizing: border-box; }
        .dist-input:focus { outline: none; border-color: var(--amber-dim); }
        .dist-input-label { font-size: 8px; text-transform: uppercase; letter-spacing: 2px; color: var(--text-faint); margin-bottom: 4px; }

        /* Failures */
        .dist-failure-item { font-size: 12px; color: var(--danger); padding: 4px 0; border-bottom: 1px solid rgba(255, 107, 107, 0.25); }
        .dist-failure-item:last-child { border-bottom: none; }
        .dist-failure-desc { font-size: 9px; color: rgba(255, 107, 107, 0.72); margin-top: 2px; }

        /* Gold ornament divider */
        .dist-ornament { text-align: center; color: var(--border); letter-spacing: 8px; font-size: 10px; margin: 2px 0; }

        /* AutoRefreshNote override area */
        .dist-refresh-note { font-size: 8px; color: var(--text-faint); letter-spacing: 2px; padding: 6px 20px; background: var(--bg2); border-bottom: 1px solid var(--border-dim); }
      `}</style>

      <div className={`${styles.pageContent} mobile-page-root dist-root`}>
        {/* Refresh note */}
        <div className="dist-refresh-note">
          <AutoRefreshNote seconds={30} />
        </div>

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div className="dist-hero">
          <div className="dist-hero-bg-text">DIST</div>
          <SteamWisps count={4} />
          <div className="dist-hero-top-row">
            <div>
              <div className="dist-hero-eyebrow">1920s Distillery · International Gangsters</div>
              <h1 className="dist-hero-title">{business?.name || 'The Still'}</h1>
              <p className="dist-hero-tagline">Long grind. Massive upside. Risk is real.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <GoldBtn
                small
                disabled={saving}
                onClick={() => run(async () => {
                  const res = await api.post('/illegal-business/distillery/collect');
                  toast.success(res.data?.message || 'Distillery collected.');
                })}
              >
                Collect now {pendingTake > 0 ? `(${money(pendingTake)})` : ''}
              </GoldBtn>
              <Link
                to="/money/racket"
                className="rounded border border-zinc-700/50 px-2.5 py-1 text-[9px] font-heading text-mutedForeground transition-all hover:border-primary/30 hover:text-foreground"
              >
                ← Back
              </Link>
            </div>
          </div>
          <div className="dist-hero-status-strip">
            <div className="dist-hero-status-cell">
              <div className="dist-hero-status-l">House Status</div>
              <div className="dist-hero-status-v">{heatInfo.label} heat · {progression.progress_pct || 0}% complete</div>
            </div>
            <div className="dist-hero-status-cell">
              <div className="dist-hero-status-l">12-Day Run</div>
              <div className="dist-hero-status-v">{money(projected12dCash)} / {money(roi.target_12d_top_end)}</div>
            </div>
            <div className="dist-hero-status-cell">
              <div className="dist-hero-status-l">Risk Tone</div>
              <div className="dist-hero-status-v" style={{ fontStyle: 'italic' }}>{heatInfo.flavor}</div>
            </div>
          </div>
        </div>

        {/* ── Stat strip ───────────────────────────────────────────────────── */}
        <div className="dist-stat-strip">
          <StatCard label="Vault" value={money(vaultBalance)} accent />
          <StatCard label="Progress" value={`${progression.total_steps || 0}/${progression.max_steps || 0}`} sub={`${progression.progress_pct || 0}% unlocked`} />
          <StatCard label="Projected 12d" value={money(projected12dCash)} sub={`Target ${money(roi.target_12d_top_end)}`} />
          <StatCard label="Target Progress" value={pct(hardCapProgress)} sub="toward 12-day goal" />
        </div>

        <div className="dist-body">

          {/* ── Failures banner ─────────────────────────────────────────────── */}
          {recentFailures.length > 0 && (
            <div className="dist-panel dist-panel-danger">
              <SectionHead icon={AlertTriangle} title="Maintenance Failures" />
              <p style={{ fontSize: 12, color: 'var(--danger)', fontStyle: 'italic', marginBottom: 10 }}>
                Low maintenance can break upgrade tiers. Broken tiers must be repurchased.
              </p>
              <div>
                {recentFailures.slice(-5).reverse().map((f, i) => (
                  <div key={`${f.at || 'x'}-${i}`} className="dist-failure-item">
                    {f.type === 'equipment_degrade' ? 'Equipment degraded' : 'Special upgrade lost'}: {prettyKey(f.item)}
                    <div className="dist-failure-desc">maintenance was {Number(f.maintenance || 0).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Heat & ROI ──────────────────────────────────────────────────── */}
          <div className="dist-two-col">
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
                  ⏱ Cooldown active: {riskCooldownMinutes} min remaining
                </div>
              )}
              <div className="dist-btn-row">
                <GoldBtn
                  disabled={saving || riskCooldownActive}
                  onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/risk-action', { action: 'cool_off' }); toast.success(res.data?.message || 'Heat cooled.'); })}
                >
                  Cool Off {riskActionCosts.cool_off ? `(${money(riskActionCosts.cool_off)})` : ''}
                </GoldBtn>
                <GhostBtn
                  disabled={saving || riskCooldownActive}
                  onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/risk-action', { action: 'bribe_crackdown' }); toast.success(res.data?.message || 'Crackdown eased.'); })}
                >
                  Bribe {riskActionCosts.bribe_crackdown ? `(${money(riskActionCosts.bribe_crackdown)})` : ''}
                </GhostBtn>
              </div>
            </div>

            <div className="dist-panel">
              <SectionHead icon={BarChart3} title="ROI Forecast" />
              <div className="dist-roi-row"><span className="dist-roi-key">Raw cash/h</span><span className="dist-roi-val">{money(roi.cash_per_hour_estimate)}</span></div>
              <div className="dist-roi-row"><span className="dist-roi-key">Risk-adjusted</span><span className="dist-roi-val">{money(roi.risk_adjusted_cash_per_hour_estimate)}</span></div>
              <div className="dist-roi-row"><span className="dist-roi-key">Projected 24h</span><span className="dist-roi-val">{money(projected24hCash)}</span></div>
              <div className="dist-roi-row"><span className="dist-roi-key">Downside</span><span className="dist-roi-val">{pct(roi.downside_exposure)}</span></div>
              <div className="dist-roi-row"><span className="dist-roi-key">Loss events 24h</span><span className="dist-roi-val">{projectedLossEvents24h.toFixed(2)}</span></div>
              <div className="dist-roi-row"><span className="dist-roi-key">Rebuy exposure</span><span className="dist-roi-val">{money(projectedRebuyCost24h)}</span></div>
              <div className="dist-roi-row"><span className="dist-roi-key">Booze/h</span><span className="dist-roi-val">{Number(roi.booze_per_hour_estimate || 0).toFixed(2)}</span></div>
              <div className="dist-roi-row"><span className="dist-roi-key">Next payback</span><span className="dist-roi-val">{roi.next_upgrade_payback_hours ?? 'n/a'}h</span></div>
            </div>
          </div>

          {/* ── Equipment ───────────────────────────────────────────────────── */}
          <div className="dist-panel">
            <SectionHead icon={Zap} title="Equipment Progression · 180 Levels" />
            <div className="dist-equip-grid">
              {EQUIPMENT_ORDER.map((lane) => {
                const lv = Number(equipment[lane] || 0);
                const cost = equipmentCosts[lane];
                return (
                  <button
                    key={lane}
                    type="button"
                    disabled={saving}
                    onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/upgrade-equipment', { lane }); toast.success(res.data?.message || 'Upgraded.'); })}
                    className="dist-equip-card rounded-md border border-primary/25 transition-all hover:border-primary/40 hover:bg-primary/5"
                  >
                    <div className="dist-equip-icon">{EQUIPMENT_ICONS[lane] || '⚙'}</div>
                    <div className="dist-equip-name">{prettyKey(lane)}</div>
                    <LevelPips level={lv} max={20} />
                    <div style={{ fontSize: 8, color: 'var(--text-faint)', marginBottom: 3 }}>Lv {lv} / 20</div>
                    {cost == null
                      ? <div className="dist-equip-maxed">✓ Maxed</div>
                      : <div className="dist-equip-cost">↑ {money(cost)}</div>
                    }
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Best next upgrades ──────────────────────────────────────────── */}
          <div className="dist-panel">
            <SectionHead icon={TrendingUp} title="Best Next Upgrades" />
            {bestNextUpgrades.length === 0
              ? <div className="dist-no-upgrade">No track upgrades available right now.</div>
              : bestNextUpgrades.map((u) => (
                <div key={u.id} className="dist-best-row">
                  <div>
                    <div className="dist-best-name">{u.name}</div>
                    <div className="dist-best-meta">{prettyKey(u.track)} · Tier {u.tier}</div>
                  </div>
                  <GoldBtn
                    small
                    disabled={saving || !u.available}
                    onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/buy-special-upgrade', { upgrade_id: u.id }); toast.success(res.data?.message || 'Upgrade bought.'); })}
                  >
                    Buy {money(u.cost)}
                  </GoldBtn>
                </div>
              ))
            }
          </div>

          {/* ── Special upgrade tracks ──────────────────────────────────────── */}
          <div className="dist-panel">
            <SectionHead icon={Layers} title="Special Upgrade Tracks · 180 Perks" />
            <div className="dist-track-scroll">
              {TRACKS.map((track) => (
                <button
                  key={track}
                  type="button"
                  onClick={() => setActiveTrack(track)}
                  className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 font-heading text-[8px] font-bold uppercase tracking-wider transition-all ${
                    activeTrack === track
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-transparent bg-transparent text-mutedForeground hover:border-primary/30 hover:bg-primary/5 hover:text-foreground'
                  }`}
                >
                  {prettyKey(track)}
                </button>
              ))}
            </div>
            <div className="dist-track-flavor">{TRACK_FLAVOR[activeTrack]}</div>
            <div className="dist-track-nav">
              <div className="dist-track-nav-meta">
                {activeSpecial ? `${clampedSpecialCursor + 1} / ${Math.max(1, visibleTrackRows.length)}` : '0/0'} · Purchased {purchasedInTrack}/{trackRows.length}
              </div>
              <div className="dist-track-nav-btns">
                <GhostBtn small disabled={clampedSpecialCursor <= 0} onClick={() => setSpecialCursor((v) => Math.max(0, v - 1))}>
                  <ChevronLeft size={12} />
                </GhostBtn>
                <GhostBtn small disabled={clampedSpecialCursor >= maxSpecialIndex} onClick={() => setSpecialCursor((v) => Math.min(maxSpecialIndex, v + 1))}>
                  <ChevronRight size={12} />
                </GhostBtn>
              </div>
            </div>
            {activeSpecial ? (
              <div className="dist-upgrade-showcase rounded-md border border-primary/25">
                <div>
                  <div className="dist-upgrade-name">{activeSpecial.name}</div>
                  <div className="dist-upgrade-tier">Tier {activeSpecial.tier} · {prettyKey(activeSpecial.track)}</div>
                  <div className="dist-upgrade-price">{money(activeSpecial.cost)}</div>
                  {activeSpecial.purchased
                    ? <div className="dist-upgrade-status-owned">✓ Owned</div>
                    : activeSpecial.available
                      ? <div className="dist-upgrade-status-avail">Available to purchase</div>
                      : <div className="dist-upgrade-status-locked">Locked — complete earlier tiers first</div>
                  }
                </div>
                <GoldBtn
                  disabled={saving || !activeSpecial.available || activeSpecial.purchased}
                  onClick={() => run(async () => { const res = await api.post('/illegal-business/distillery/buy-special-upgrade', { upgrade_id: activeSpecial.id }); toast.success(res.data?.message || 'Upgrade bought.'); })}
                >
                  {activeSpecial.purchased ? 'Owned' : `Buy ${money(activeSpecial.cost)}`}
                </GoldBtn>
              </div>
            ) : (
              <div className="dist-no-upgrade">No upgrades visible in this track yet.</div>
            )}
          </div>

          {/* ── Workers & Maintenance | ROI ─────────────────────────────────── */}
          <div className="dist-two-col">
            <div className="dist-panel">
              <SectionHead icon={Users} title="Crew Roster" />
              <div className="dist-worker-cap">{workerTotal} / {workerCap} workers assigned</div>
              <div className="text-[10px] text-mutedForeground font-heading mb-2">
                Increase worker cap by upgrading <strong className="text-foreground">Bribe Office</strong> (+2 capacity per level).
              </div>
              <div className="dist-worker-grid">
                {['production', 'quality', 'security', 'sales'].map((role) => {
                  const current = Number(workers[role] || 0);
                  const cap = workerCap > 0 ? current / workerCap : 0;
                  return (
                    <div key={role} className="dist-worker-card">
                      <div className="dist-worker-role">{prettyKey(role)}</div>
                      <div className="dist-worker-num">{workerDraft[role]}</div>
                      <div className="dist-worker-bar">
                        <div className="dist-worker-fill" style={{ width: `${Math.min(100, cap * 100)}%` }} />
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={workerDraft[role]}
                        onChange={(e) => setWorkerDraft((p) => ({ ...p, [role]: Number(e.target.value || 0) }))}
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

              {/* Maintenance */}
              <div className="dist-maint-bar-wrap">
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
                      width: `${maintenancePct}%`,
                      background: maintenancePct < 35 ? 'var(--red)' : maintenancePct < 60 ? 'var(--amber)' : 'var(--green)',
                    }}
                  />
                </div>
                {maintenanceWarn && (
                  <div className="dist-maint-warn">
                    ⚠ Critical — upgrades may degrade and need repurchasing.
                  </div>
                )}
                <div className="dist-maint-input-row">
                  <input
                    type="number"
                    min="1"
                    value={maintenancePoints}
                    onChange={(e) => setMaintenancePoints(Number(e.target.value || 1))}
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
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{money(maintenanceCost)}</span>
                </div>
              </div>
            </div>

            {/* Auto-sell & Aging */}
            <div className="dist-panel">
              <SectionHead icon={Clock3} title="Aging Cellar" />
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-[11px] font-heading text-mutedForeground">
                <span>
                  On hand:{' '}
                  <span className="font-bold tabular-nums text-primary">{boozeUnitsCarrying}</span>
                  {' '}booze — used when you start a batch
                </span>
                {boozeUnitsCarrying > 0 && (
                  <button
                    type="button"
                    className="shrink-0 rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20 disabled:opacity-40"
                    disabled={saving}
                    onClick={() => setAgingQty(Math.max(1, boozeUnitsCarrying))}
                  >
                    Set qty to max
                  </button>
                )}
              </div>
              <div className="mb-3.5 flex gap-1">
                {['quick', 'standard', 'reserve', 'premium'].map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setAgingTier(tier)}
                    className={`flex-1 rounded border py-2 px-1 text-center font-heading text-[9px] font-bold uppercase tracking-wider transition-all ${
                      agingTier === tier
                        ? 'border-primary/50 bg-primary/15 text-primary'
                        : 'border-zinc-700/50 bg-primary/5 text-mutedForeground hover:border-primary/30 hover:text-foreground'
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>

              {/* Barrel visuals */}
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
                  value={agingQty}
                  onChange={(e) => setAgingQty(Number(e.target.value || 1))}
                  className="dist-aging-qty-input"
                />
                <GoldBtn
                  disabled={saving}
                  onClick={() => run(async () => {
                    const quantity = Math.max(1, intOr(agingQty, 1));
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
                          small
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

              {/* Auto-sell */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-dim)' }}>
                <SectionHead icon={TrendingUp} title="Auto-Sell Rules">
                  <TooltipProvider>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex rounded border border-primary/30 p-1 text-primary/75 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                          aria-label="How auto-sell works"
                        >
                          <CircleHelp size={14} aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[min(320px,calc(100vw-2rem))] space-y-2 p-3 text-left text-[11px] leading-snug text-primary-foreground">
                        <p className="font-heading text-[10px] font-bold uppercase tracking-wide text-primary-foreground">How auto-sell works</p>
                        <ul className="list-disc space-y-1.5 pl-3.5 normal-case">
                          <li>It runs when you <strong className="font-semibold">Collect</strong> — not on its own in the background.</li>
                          <li>You need <strong className="font-semibold">Sales</strong> workers hired. More sales workers move more bottles per collect.</li>
                          <li><strong className="font-semibold">Min inventory</strong> is the stash you try to keep; the crew avoids selling below that (using what you already have plus this collect).</li>
                          <li><strong className="font-semibold">Batch size</strong> is the max each sales worker can sell in one collect (you still cannot sell more than you earned that collect).</li>
                          <li>Money from sales goes to your <strong className="font-semibold">vault</strong> with the collect. Heat and raids can still hurt outcomes.</li>
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </SectionHead>
                <div className="dist-autosell-row">
                  <input
                    type="checkbox"
                    checked={!!autoSell.enabled}
                    onChange={(e) => setAutoSell((p) => ({ ...p, enabled: e.target.checked }))}
                    className="dist-autosell-check"
                    id="autosell-toggle"
                  />
                  <label htmlFor="autosell-toggle" className="dist-autosell-label">Enable auto-sell crew</label>
                </div>
                <div className="dist-autosell-inputs">
                  <div>
                    <div className="dist-input-label">Min inventory</div>
                    <input
                      type="number"
                      min="0"
                      value={autoSell.min_inventory}
                      onChange={(e) => setAutoSell((p) => ({ ...p, min_inventory: Number(e.target.value || 0) }))}
                      className="dist-input"
                    />
                  </div>
                  <div>
                    <div className="dist-input-label">Batch size</div>
                    <input
                      type="number"
                      min="1"
                      value={autoSell.batch_size}
                      onChange={(e) => setAutoSell((p) => ({ ...p, batch_size: Number(e.target.value || 1) }))}
                      className="dist-input"
                    />
                  </div>
                </div>
                <GhostBtn
                  disabled={saving}
                  onClick={() => run(async () => {
                    const payload = {
                      enabled: !!autoSell.enabled,
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
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
