import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Clock, Play, Square, Shield, Car, Crosshair, Lock, Unlock, Users, Edit2, Ban, RefreshCw, BarChart3, TrendingUp, Briefcase, Wine, DollarSign, MessageSquare, Activity, Settings2, Flame, CircleDot, Search, AlertTriangle, CheckCircle2, Info, PauseCircle, Zap } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import {
  AUTO_RANK_STRIPE_PACKAGE_ID,
  AUTO_RANK_STRIPE_PRICE_GBP,
} from '../../constants/autoRankStripePricing';

const MIN_INTERVAL = 5;
const MIN_BUST_INTERVAL = 1;
const MIN_OC_INTERVAL = 10;

const AR_STYLES = `
  @keyframes ar-fade-in { 
    from { opacity: 0; transform: translateY(10px); } 
    to { opacity: 1; transform: translateY(0); } 
  }
  .ar-fade-in { animation: ar-fade-in 0.4s ease-out both; }
  
  @keyframes pulse-glow {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.6; }
  }
  .pulse-glow { animation: pulse-glow 3s ease-in-out infinite; }
`;

/* ═══════════════════════════════════════════════════════
   Helper Functions
   ═══════════════════════════════════════════════════════ */
const formatRunningTime = (seconds) => {
  if (seconds == null || seconds < 0) return '—';
  if (seconds === 0) return '0m';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
};

const formatNextOcAt = (iso) => {
  if (!iso) return { text: 'Ready', at: null };
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { text: 'Ready', at: null };
    const now = Date.now();
    if (d.getTime() <= now) return { text: 'Ready', at: null };
    const secs = Math.floor((d.getTime() - now) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    const atStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return { text: parts.join(' '), at: atStr };
  } catch {
    return { text: 'Ready', at: null };
  }
};

/** Format seconds as live countdown: "25s", "2m 10s", "1h 5m 30s" */
const formatCountdown = (seconds) => {
  if (seconds == null || seconds < 0) return '—';
  if (seconds === 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
};

const formatAdminDateTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
};

const ACCESS_TYPE_LABELS = {
  permanent: 'Permanent purchase',
  trial_active: 'Timed access (trial / 2h tokens)',
  trial_expired: 'Trial expired',
  none: 'No access',
};

const DIAG_STATUS_STYLES = {
  running: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300',
  waiting: 'border-amber-500/40 bg-amber-950/30 text-amber-300',
  idle_tasks: 'border-amber-500/40 bg-amber-950/30 text-amber-300',
  blocked: 'border-red-500/40 bg-red-950/30 text-red-300',
  inactive: 'border-zinc-600/50 bg-zinc-900/50 text-zinc-400',
};

const DiagList = ({ title, items, tone }) => {
  if (!items?.length) return null;
  const toneClass = tone === 'blocker' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : tone === 'rec' ? 'text-primary' : 'text-zinc-400';
  return (
    <div>
      <div className={`text-[9px] font-heading font-bold uppercase tracking-wider mb-1 ${toneClass}`}>{title}</div>
      <ul className="space-y-0.5">
        {items.map((line) => (
          <li key={line} className={`text-[9px] sm:text-[10px] font-heading ${toneClass}`}>• {line}</li>
        ))}
      </ul>
    </div>
  );
};

const AdminDiagnosticsPanel = ({ inspectData, inspectLoading, inspectError, inspectUsername, setInspectUsername, onLoad, onRefresh }) => {
  const d = inspectData?.diagnostics;
  const statusClass = DIAG_STATUS_STYLES[d?.status] || DIAG_STATUS_STYLES.inactive;
  return (
    <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`} style={{ animationDelay: '0.35s' }}>
      <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader} flex items-center justify-between gap-2 flex-wrap`}>
        <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Activity size={14} className="sm:w-4 sm:h-4" />
          Staff diagnostics
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={inspectLoading}
          className="p-1 sm:p-1.5 rounded bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 disabled:opacity-50 transition-all active:scale-95"
          title="Refresh diagnostics"
        >
          <RefreshCw size={12} className={`sm:w-3.5 sm:h-3.5 ${inspectLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="p-2.5 sm:p-3 space-y-3">
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
          Admin-only: why Auto Rank is running or stopped — access, idle, jail, global loop, cron eligibility.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-[140px]">
            <Search size={12} className="text-zinc-500 shrink-0" />
            <input
              type="text"
              value={inspectUsername}
              onChange={(e) => setInspectUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onLoad(); }}
              placeholder="Username (blank = you)"
              className="flex-1 min-w-0 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-foreground text-[10px] font-heading"
            />
          </div>
          <button
            type="button"
            onClick={onLoad}
            disabled={inspectLoading}
            className="px-2.5 py-1 rounded bg-primary/20 border border-primary/50 text-primary font-heading text-[9px] sm:text-[10px] font-bold hover:bg-primary/30 disabled:opacity-50"
          >
            {inspectLoading ? 'Loading…' : 'Inspect'}
          </button>
        </div>
        {inspectError ? (
          <div className="text-[10px] font-heading text-red-400">{inspectError}</div>
        ) : null}
        {inspectData && d ? (
          <div className="space-y-3">
            <div className={`rounded-lg border px-3 py-2 ${statusClass}`}>
              <div className="flex items-start gap-2">
                {d.status === 'running' ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : d.status === 'blocked' ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <Info size={14} className="shrink-0 mt-0.5" />}
                <div>
                  <div className="text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wide">{d.status?.replace('_', ' ')}</div>
                  <div className="text-[9px] sm:text-[10px] font-heading mt-0.5 opacity-90">{d.summary}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[9px] sm:text-[10px] font-heading">
              <div className="rounded border border-zinc-700/50 bg-zinc-900/40 p-2 space-y-1">
                <div className="text-[9px] font-bold text-primary uppercase tracking-wider mb-1">Account</div>
                <div><span className="text-zinc-500">User:</span> {inspectData.user?.username || '—'}</div>
                <div><span className="text-zinc-500">Last seen:</span> {inspectData.user?.last_seen ? formatAdminDateTime(inspectData.user.last_seen) : '—'}{d.last_seen_hours_ago != null ? <span className="text-zinc-500"> ({d.last_seen_hours_ago}h ago)</span> : null}</div>
                <div><span className="text-zinc-500">Idle in:</span> {d.hours_until_idle != null ? `${d.hours_until_idle}h` : '—'} <span className="text-zinc-500">(limit {d.idle_threshold_hours}h)</span></div>
                <div><span className="text-zinc-500">Dead / jail:</span> {inspectData.user?.is_dead ? 'dead' : 'alive'} / {inspectData.stats?.in_jail ? `jail until ${inspectData.stats.jail_until ? formatAdminDateTime(inspectData.stats.jail_until) : '?'}` : 'free'}</div>
                {d.staff_exempt_from_idle ? <div className="text-amber-400/90">Staff — idle exempt</div> : null}
              </div>
              <div className="rounded border border-zinc-700/50 bg-zinc-900/40 p-2 space-y-1">
                <div className="text-[9px] font-bold text-primary uppercase tracking-wider mb-1">Access</div>
                <div><span className="text-zinc-500">Type:</span> {ACCESS_TYPE_LABELS[d.access_type] || d.access_type}</div>
                <div><span className="text-zinc-500">Has access:</span> {d.auto_rank_has_access ? 'yes' : 'no'}</div>
                <div><span className="text-zinc-500">2h tokens:</span> {d.auto_rank_2h_tokens ?? 0}</div>
                {d.trial_seconds_remaining != null && !d.auto_rank_permanent ? (
                  <div><span className="text-zinc-500">Timed access left:</span> {formatCountdown(d.trial_seconds_remaining)}</div>
                ) : null}
                <div><span className="text-zinc-500">Master on:</span> {inspectData.preferences?.auto_rank_enabled ? 'yes' : 'no'}</div>
                <div><span className="text-zinc-500">auto_rank_idle:</span> {inspectData.idle?.auto_rank_idle ? 'yes' : 'no'}</div>
              </div>
              <div className="rounded border border-zinc-700/50 bg-zinc-900/40 p-2 space-y-1">
                <div className="text-[9px] font-bold text-primary uppercase tracking-wider mb-1">Cron loops</div>
                <div><span className="text-zinc-500">Global loop:</span> {d.global_loop_enabled ? 'on' : 'off'}</div>
                <div><span className="text-zinc-500">Main cycle due:</span> {d.cron?.main_cycle_due ? 'yes' : 'no'}{d.cron?.next_run_in_seconds != null ? <span className="text-zinc-500"> (in {formatCountdown(d.cron.next_run_in_seconds)})</span> : null}</div>
                <div><span className="text-zinc-500">Bust 5s loop:</span> {d.cron?.bust_loop_eligible ? 'eligible' : 'no'}</div>
                <div><span className="text-zinc-500">OC loop:</span> {d.cron?.oc_loop_eligible ? 'eligible' : 'no'}{d.cron?.oc_retry_at ? <span className="text-zinc-500"> (retry {formatAdminDateTime(d.cron.oc_retry_at)})</span> : null}</div>
                <div><span className="text-zinc-500">Tasks on:</span> {(d.active_task_toggles || []).length ? d.active_task_toggles.join(', ') : 'none'}</div>
              </div>
              <div className="rounded border border-zinc-700/50 bg-zinc-900/40 p-2 space-y-1">
                <div className="text-[9px] font-bold text-primary uppercase tracking-wider mb-1">Live activity</div>
                <div><span className="text-zinc-500">Detail:</span> {inspectData.stats?.activity_detail || '—'}</div>
                <div><span className="text-zinc-500">Last AR action:</span> {inspectData.stats?.last_activity || '—'}{inspectData.stats?.last_activity_at ? <span className="text-zinc-500"> @ {formatAdminDateTime(inspectData.stats.last_activity_at)}</span> : null}</div>
                <div><span className="text-zinc-500">Next cycle:</span> {inspectData.stats?.auto_rank_next_run_at ? formatAdminDateTime(inspectData.stats.auto_rank_next_run_at) : 'now / —'}</div>
                <div><span className="text-zinc-500">Next OC:</span> {inspectData.stats?.next_oc_at ? formatAdminDateTime(inspectData.stats.next_oc_at) : 'ready'}</div>
              </div>
            </div>
            <div className="rounded border border-zinc-700/50 bg-zinc-900/40 p-2 space-y-2">
              <DiagList title="Blockers" items={d.blockers} tone="blocker" />
              <DiagList title="Warnings" items={d.warnings} tone="warn" />
              <DiagList title="Notes" items={d.notes} tone="note" />
              <DiagList title="Recommendations" items={d.recommendations} tone="rec" />
              {!d.blockers?.length && !d.warnings?.length && !d.notes?.length && !d.recommendations?.length ? (
                <div className="text-[9px] text-zinc-500 font-heading">No issues flagged.</div>
              ) : null}
            </div>
            {inspectData.idle?.saved_on_idle && Object.keys(inspectData.idle.saved_on_idle).length > 0 ? (
              <div className="rounded border border-amber-700/30 bg-amber-950/20 p-2 text-[9px] font-heading text-amber-200/90">
                <div className="font-bold uppercase tracking-wider mb-1">Saved prefs (will restore on wake)</div>
                {Object.entries(inspectData.idle.saved_on_idle).map(([k, v]) => (
                  <div key={k}><span className="text-amber-200/60">{k}:</span> {v ? 'on' : 'off'}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : inspectLoading ? (
          <p className="text-xs text-zinc-400 font-heading">Loading diagnostics…</p>
        ) : null}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   Toggle Switch Component
   ═══════════════════════════════════════════════════════ */
const ToggleSwitch = ({ checked, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={onChange}
    className={`relative inline-flex h-5 w-10 sm:h-6 sm:w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
      checked ? 'bg-primary border-primary/50' : 'bg-zinc-800 border-zinc-700'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    <span className={`pointer-events-none inline-block h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-zinc-900 shadow transition-transform ${
      checked ? 'translate-x-5 sm:translate-x-5' : 'translate-x-0'
    }`} />
  </button>
);

/* ═══════════════════════════════════════════════════════
   Toggle Row Component
   ═══════════════════════════════════════════════════════ */
const ToggleRow = ({ icon: Icon, label, description, checked, disabled, onToggle }) => (
  <div className="flex items-start justify-between gap-2 sm:gap-3 py-2 sm:py-2.5 border-b border-zinc-700/30 last:border-b-0">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Icon size={14} className="text-primary shrink-0 sm:w-4 sm:h-4" />
        <span className={`text-[10px] sm:text-xs font-heading font-medium ${disabled ? 'text-zinc-500' : 'text-foreground'}`}>
          {label}
        </span>
      </div>
      {description && (
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading mt-0.5 pl-4 sm:pl-[22px] leading-snug">
          {description}
        </p>
      )}
    </div>
    <ToggleSwitch checked={checked} disabled={disabled} onChange={onToggle} />
  </div>
);

/* ═══════════════════════════════════════════════════════
   Stat Card Component
   ═══════════════════════════════════════════════════════ */
const StatCard = ({ label, value, valueColor = "text-foreground", icon: Icon }) => (
  <div className={`rounded border p-2 sm:p-3 text-center ${styles.surface}`}>
    <div className={`text-base sm:text-lg font-heading font-bold ${valueColor}`}>
      {value}
    </div>
    <div className={`text-[9px] sm:text-[10px] font-heading uppercase tracking-wider flex items-center justify-center gap-1 mt-0.5 ${styles.gmStatLabel}`}>
      {Icon && <Icon size={10} className="sm:w-3 sm:h-3" />}
      {label}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Trial Banner
   ═══════════════════════════════════════════════════════ */
const TrialBanner = ({ trialUntil, dismissed, onDismiss }) => {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const tick = () => {
      if (!trialUntil) { setRemaining(''); return; }
      const ms = new Date(trialUntil).getTime() - Date.now();
      if (ms <= 0) { setRemaining('expired'); return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setRemaining(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [trialUntil]);

  if (!remaining || dismissed) return null;
  const expired = remaining === 'expired';

  return (
    <div className={`rounded-lg border p-2.5 sm:p-3 ar-fade-in ${expired ? 'border-red-500/30 bg-red-500/5' : 'border-cyan-500/30 bg-cyan-500/5'}`}>
      <div className="flex items-center gap-2">
        <Clock size={14} className={`shrink-0 ${expired ? 'text-red-400' : 'text-cyan-400'}`} />
        <p className="flex-1 text-[10px] sm:text-xs font-heading text-zinc-300">
          {expired ? (
            <>Auto Rank trial has ended. <Link to="/game/store" className="text-primary underline font-bold">Purchase Auto Rank</Link> in the Store to keep it.</>
          ) : (
            <>Auto Rank trial — <span className="font-bold text-cyan-400">{remaining}</span> remaining. <Link to="/game/store" className="text-primary underline font-bold">Purchase permanently</Link> in the Store.</>
          )}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 text-xs leading-none px-1 py-0.5 rounded hover:bg-white/10 ${expired ? 'text-red-400' : 'text-cyan-400'}`}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   Setup & Status Card
   ═══════════════════════════════════════════════════════ */
const SetupCard = ({
  canEnable,
  hasTelegram,
  telegramNotifyOn,
  stripePurchasable,
  stripeLoading,
  onBuyStripe,
  emailEntitled,
}) => (
  <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`}>
    <div className={`relative px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
      <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Bot size={14} className="sm:w-4 sm:h-4" />
        Setup & Status
      </h2>
    </div>
    
    <div className="relative p-2.5 sm:p-3 space-y-2">
      {!hasTelegram && (
        <div className="rounded border border-primary/30 bg-primary/5 p-2 sm:p-2.5">
          <div className="flex items-start gap-2">
            <MessageSquare size={14} className="text-primary shrink-0 mt-0.5 sm:w-4 sm:h-4" />
            <p className="text-[10px] sm:text-xs font-heading text-zinc-300 leading-relaxed">
              Auto Rank runs without Telegram. For success notifications, set <strong>Telegram chat ID</strong> in{' '}
              <Link to="/account/profile" className="underline font-bold text-primary hover:text-primary/80">
                Profile → Settings
              </Link>{' '}
              (get ID from <span className="font-mono text-primary">@userinfobot</span>)
            </p>
          </div>
        </div>
      )}
      
      {!canEnable && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 sm:p-2.5 space-y-2">
          <div className="flex items-start gap-2">
            <Lock size={14} className="text-amber-400 shrink-0 mt-0.5 sm:w-4 sm:h-4" />
            <p className="text-[10px] sm:text-xs font-heading text-zinc-300 leading-relaxed">
              Activate an <strong>Auto Rank (2h)</strong> token from My Inventory, or purchase Auto Rank permanently in the{' '}
              <Link to="/game/store?tab=upgrades#store-auto-rank" className="text-primary underline font-bold hover:text-primary/80">
                Store
              </Link>
              , to enable automation.
            </p>
          </div>
          {stripePurchasable ? (
            <button
              type="button"
              onClick={onBuyStripe}
              disabled={stripeLoading}
              className="w-full min-h-[44px] py-2 text-[10px] font-heading font-bold uppercase rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-50 touch-manipulation"
            >
              {stripeLoading ? '…' : `Buy permanent Auto Rank — £${AUTO_RANK_STRIPE_PRICE_GBP}`}
            </button>
          ) : null}
          {!stripePurchasable && !emailEntitled ? (
            <p className="text-[9px] text-amber-400/90 font-heading">
              Card purchase requires a verified email (Profile → verify email). Points purchase in Store is account-only.
            </p>
          ) : null}
        </div>
      )}

      {emailEntitled && canEnable ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 sm:p-2.5">
          <p className="text-[10px] sm:text-xs font-heading text-emerald-300">
            Permanent (email) — tied to your verified email; restores on a new account with the same email. Keeps running without the 24h idle pause.
          </p>
        </div>
      ) : null}

      {canEnable && !emailEntitled && stripePurchasable ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 sm:p-2.5 space-y-2">
          <p className="text-[10px] sm:text-xs font-heading text-zinc-300 leading-relaxed">
            You have account-only Auto Rank. Upgrade to email-tied permanent so it survives death / a new account on the same email — and keeps running without the 24h idle pause.
          </p>
          <button
            type="button"
            onClick={onBuyStripe}
            disabled={stripeLoading}
            className="w-full min-h-[44px] py-2 text-[10px] font-heading font-bold uppercase rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-50 touch-manipulation"
          >
            {stripeLoading ? '…' : `Upgrade to email — £${AUTO_RANK_STRIPE_PRICE_GBP}`}
          </button>
        </div>
      ) : null}
      
      {canEnable && hasTelegram && telegramNotifyOn && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 sm:p-2.5">
          <div className="flex items-start gap-2">
            <MessageSquare size={14} className="text-emerald-400 shrink-0 mt-0.5 sm:w-4 sm:h-4" />
            <p className="text-[10px] sm:text-xs font-heading text-zinc-300">
              ✓ Telegram configured — push notifications are on (turn off below anytime)
            </p>
          </div>
        </div>
      )}
      {canEnable && hasTelegram && !telegramNotifyOn && (
        <div className="rounded border border-zinc-600/50 bg-zinc-800/40 p-2 sm:p-2.5">
          <div className="flex items-start gap-2">
            <MessageSquare size={14} className="text-zinc-500 shrink-0 mt-0.5 sm:w-4 sm:h-4" />
            <p className="text-[10px] sm:text-xs font-heading text-zinc-400">
              Telegram is linked, but <strong className="text-zinc-300">push notifications are off</strong> — automation still runs. Use <strong className="text-primary">Telegram notifications</strong> below to turn them back on. Bot commands like /autorank still work.
            </p>
          </div>
        </div>
      )}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Settings Card
   ═══════════════════════════════════════════════════════ */
const kindHasUsableSkip = (s) => {
  if (!s) return false;
  const credits = Number(s.credits || 0);
  if (credits > 0) return true;
  const held = Number(s.tokens || 0);
  if (held < 1) return false;
  const leftToday = Math.max(0, Number(s.daily_cap || 0) - Number(s.uses_today || 0));
  return leftToday > 0;
};

const hasAnyUsableArSkip = (skipTokens, statsFlag) => {
  if (typeof statsFlag === 'boolean') return statsFlag;
  const skip = skipTokens || {};
  return (
    kindHasUsableSkip(skip.crime)
    || kindHasUsableSkip(skip.gta)
    || kindHasUsableSkip(skip.booze)
  );
};

const SettingsCard = ({ prefs, canEnable, savingPrefs, onUpdatePref, skipTokens, hasUsableArSkips }) => {
  const p = prefs || {};
  const masterDisabled = savingPrefs || (!p.auto_rank_enabled && !canEnable);
  const inventoryKnown = typeof hasUsableArSkips === 'boolean' || skipTokens != null;
  const canUseSkips = inventoryKnown
    ? hasAnyUsableArSkip(skipTokens, hasUsableArSkips)
    : true;
  const skipToggleDisabled = savingPrefs || (!p.auto_rank_use_skip_tokens && !canUseSkips);
  return (
  <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`} style={{ animationDelay: '0.1s' }}>
    <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
      <h2 className={`text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider ${styles.gmTitle}`}>
        Your Settings
      </h2>
    </div>
    
    <div className="p-2.5 sm:p-3 space-y-0.5">
      <ToggleRow
        icon={Bot}
        label="Enable Auto Rank"
        description="Master switch for automation. Turning off clears all task toggles below."
        checked={p.auto_rank_enabled}
        disabled={masterDisabled}
        onToggle={() => onUpdatePref('auto_rank_enabled', !p.auto_rank_enabled)}
      />

      <ToggleRow
        icon={PauseCircle}
        label="Block all booze intake"
        description={
          p.passive_booze_paused
            ? 'Nothing can add booze to your inventory (distillery, crimes, missions, booze runs, hitlist)'
            : !p.auto_rank_enabled
              ? 'Booze can still enter from distillery and other sources — turn on to block all intake'
              : 'Turn on to stop every source adding booze; auto-enabled when you turn off Auto Rank'
        }
        checked={!!p.passive_booze_paused}
        disabled={savingPrefs}
        onToggle={() => onUpdatePref('passive_booze_paused', !p.passive_booze_paused)}
      />

      <ToggleRow
        icon={MessageSquare}
        label="Telegram notifications"
        description="Success summaries, busts, OC, booze/jail alerts. Requires chat ID in Profile. /autorank and other bot replies still work when off"
        checked={p.auto_rank_telegram_notify !== false}
        disabled={savingPrefs}
        onToggle={() => onUpdatePref('auto_rank_telegram_notify', !(p.auto_rank_telegram_notify !== false))}
      />

      <ToggleRow
        icon={Zap}
        label="Use cooldown skip tokens"
        description={
          !canUseSkips
            ? 'No usable Crime / GTA / Booze skip tokens (all must be empty). Buy some in the Points Store to enable this.'
            : 'When on, Auto Rank burns up to 5 Crime / GTA / Booze Travel Skip tokens per cycle (daily caps still apply), uses jail bailout tokens if you get locked up, and skipped crimes pay −50% cash. Turn off to only act when cooldowns are naturally ready.'
        }
        checked={!!p.auto_rank_use_skip_tokens && canUseSkips}
        disabled={skipToggleDisabled}
        onToggle={() => {
          if (!p.auto_rank_use_skip_tokens && !canUseSkips) return;
          onUpdatePref('auto_rank_use_skip_tokens', !p.auto_rank_use_skip_tokens);
        }}
      />
      
      <div className="py-1.5 px-0">
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
          <strong className="text-zinc-300">Cycle:</strong> busts → crimes → GTA → melt. OC runs on its own timer.
        </p>
      </div>
      
      <ToggleRow
        icon={Crosshair}
        label="Run crimes"
        description="Auto-commit crimes per cycle"
        checked={p.auto_rank_enabled ? p.auto_rank_crimes : false}
        disabled={savingPrefs || !p.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_crimes', !p.auto_rank_crimes)}
      />
      
      <ToggleRow
        icon={Car}
        label="Run GTA"
        description="One theft per cycle when cooldown ready"
        checked={p.auto_rank_enabled ? p.auto_rank_gta : false}
        disabled={savingPrefs || !p.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_gta', !p.auto_rank_gta)}
      />
      
      <ToggleRow
        icon={Lock}
        label="Jail bust every 5 sec"
        description="Bust attempts every 5s (cron-bust). Runs alongside crimes/GTA when those are enabled"
        checked={p.auto_rank_enabled ? p.auto_rank_bust_every_5_sec : false}
        disabled={savingPrefs || !p.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_bust_every_5_sec', !p.auto_rank_bust_every_5_sec)}
      />
      
      <ToggleRow
        icon={Briefcase}
        label="Run Organised Crime (NPC)"
        description="Heist with you + 3 NPCs when OC cooldown ready"
        checked={p.auto_rank_enabled ? p.auto_rank_oc : false}
        disabled={savingPrefs || !p.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_oc', !p.auto_rank_oc)}
      />
      
      <ToggleRow
        icon={Flame}
        label="Run melt"
        description="Melt cars for bullets or cash per main cycle"
        checked={p.auto_rank_enabled ? p.auto_rank_melt : false}
        disabled={savingPrefs || !p.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_melt', !p.auto_rank_melt)}
      />

      <ToggleRow
        icon={Flame}
        label="Run scrap"
        description="Scrap cars for cash every 2 minutes (separate from melt)"
        checked={p.auto_rank_enabled ? p.auto_rank_scrap : false}
        disabled={savingPrefs || !p.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_scrap', !p.auto_rank_scrap)}
      />

      <ToggleRow
        icon={Wine}
        label="Run booze running"
        description={
          p.passive_booze_paused
            ? 'Blocked while all booze intake is on — turn that off above first'
            : !p.auto_rank_enabled && p.auto_rank_booze
            ? 'Still on in your account — turn off to allow manual travel (Auto Rank is off)'
            : 'Buy, travel, sell on round-trip route (city arbitrage only)'
        }
        checked={!!p.auto_rank_booze}
        disabled={savingPrefs || p.passive_booze_paused || (!p.auto_rank_enabled && !p.auto_rank_booze)}
        onToggle={() => onUpdatePref('auto_rank_booze', !p.auto_rank_booze)}
      />

      <ToggleRow
        icon={Search}
        label="Robot bodyguard auto-search"
        description={
          !p.robot_bg_auto_search_subscription_active
            ? (
              <>
                Requires Robot Auto-Search from the{' '}
                <Link to="/game/store?tab=upgrades" className="text-primary hover:underline">Points Store</Link>
                {' '}(30-day pass). Renews Attack searches for your hired robots when ≤3h left.
              </>
            )
            : p.robot_bg_auto_search_enabled
              ? 'Maintains Attack searches for your robot bodyguards (independent of the Auto Rank master switch).'
              : 'Paused — your store pass is still active; turn on to resume auto-searches.'
        }
        checked={!!p.robot_bg_auto_search_subscription_active && p.robot_bg_auto_search_enabled !== false}
        disabled={savingPrefs || !p.robot_bg_auto_search_subscription_active}
        onToggle={() => onUpdatePref('robot_bg_auto_search_enabled', p.robot_bg_auto_search_enabled === false)}
      />
    </div>
  </div>
  );
};

/* ═══════════════════════════════════════════════════════
   Crimes & GTA options Settings Card
   ═══════════════════════════════════════════════════════ */
const OptionCheckbox = ({ id, label, sub, checked, disabled, onChange }) => (
  <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-zinc-800/50 cursor-pointer group">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={() => onChange(id)}
      className="rounded border-zinc-600 text-primary focus:ring-primary/50"
    />
    <span className="text-[10px] sm:text-xs font-heading text-foreground flex-1">{label}</span>
    {sub != null && sub !== '' && <span className="text-[9px] text-zinc-500 font-heading">{sub}</span>}
  </label>
);

const CrimesGtaSettingsCard = ({
  crimes,
  gtaOptions,
  meltOptions,
  selectedCrimeIds,
  selectedGtaIds,
  selectedMeltActionIds,
  selectedMeltRarityIds,
  selectedScrapRarityIds,
  onToggleCrime,
  onToggleGta,
  onToggleMeltAction,
  onToggleMeltRarity,
  onToggleScrapRarity,
  onSelectAllCrimes,
  onDeselectAllCrimes,
  onSelectAllGta,
  onDeselectAllGta,
  onSelectAllMeltActions,
  onDeselectAllMeltActions,
  onSelectAllMeltRarities,
  onDeselectAllMeltRarities,
  onSelectAllScrapRarities,
  onDeselectAllScrapRarities,
  onSaveSettings,
  savingSettings,
  crimesDisabled,
  gtaDisabled,
  meltDisabled,
  scrapDisabled,
}) => (
  <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`} style={{ animationDelay: '0.2s' }}>
    <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
      <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Settings2 size={14} className="sm:w-4 sm:h-4" />
        Crimes, GTA & Melt options
      </h2>
    </div>
    <div className="p-2.5 sm:p-3 space-y-4">
      <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
        Choose which crimes and GTA options to run. Melt: select bullets and/or cash; rarities empty = all. Save to apply.
      </p>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] sm:text-xs font-heading font-bold text-zinc-300 flex items-center gap-1.5">
            <Crosshair size={12} className="text-primary" />
            Crimes
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={onSelectAllCrimes} disabled={crimesDisabled} className="text-[9px] font-heading font-bold text-primary hover:underline disabled:opacity-50">All</button>
            <span className="text-zinc-600">|</span>
            <button type="button" onClick={onDeselectAllCrimes} disabled={crimesDisabled} className="text-[9px] font-heading font-bold text-zinc-400 hover:underline disabled:opacity-50">None</button>
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto rounded bg-zinc-800/40 border border-zinc-700/30 divide-y divide-zinc-700/30">
          {(crimes || []).map((c) => (
            <OptionCheckbox
              key={c.id}
              id={c.id}
              label={c.name}
              sub={c.prestige_required ? `P${c.prestige_required} · Rank ${c.min_rank}` : `Rank ${c.min_rank}`}
              checked={selectedCrimeIds.includes(c.id)}
              disabled={crimesDisabled}
              onChange={onToggleCrime}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] sm:text-xs font-heading font-bold text-zinc-300 flex items-center gap-1.5">
            <Car size={12} className="text-primary" />
            GTA
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={onSelectAllGta} disabled={gtaDisabled} className="text-[9px] font-heading font-bold text-primary hover:underline disabled:opacity-50">All</button>
            <span className="text-zinc-600">|</span>
            <button type="button" onClick={onDeselectAllGta} disabled={gtaDisabled} className="text-[9px] font-heading font-bold text-zinc-400 hover:underline disabled:opacity-50">None</button>
          </div>
        </div>
        <div className="max-h-40 overflow-y-auto rounded bg-zinc-800/40 border border-zinc-700/30 divide-y divide-zinc-700/30">
          {(gtaOptions || []).map((o) => (
            <OptionCheckbox
              key={o.id}
              id={o.id}
              label={o.name}
              sub={`Rank ${o.min_rank}`}
              checked={selectedGtaIds.includes(o.id)}
              disabled={gtaDisabled}
              onChange={onToggleGta}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] sm:text-xs font-heading font-bold text-zinc-300 flex items-center gap-1.5">
            <Flame size={12} className="text-primary" />
            Melt / Scrap actions
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={onSelectAllMeltActions} disabled={meltDisabled} className="text-[9px] font-heading font-bold text-primary hover:underline disabled:opacity-50">All</button>
            <span className="text-zinc-600">|</span>
            <button type="button" onClick={onDeselectAllMeltActions} disabled={meltDisabled} className="text-[9px] font-heading font-bold text-zinc-400 hover:underline disabled:opacity-50">None</button>
          </div>
        </div>
        <div className="max-h-24 overflow-y-auto rounded bg-zinc-800/40 border border-zinc-700/30 divide-y divide-zinc-700/30">
          {((meltOptions?.actions) || []).map((a) => (
            <OptionCheckbox
              key={a.id}
              id={a.id}
              label={a.name}
              checked={selectedMeltActionIds.includes(a.id)}
              disabled={meltDisabled}
              onChange={onToggleMeltAction}
            />
          ))}
        </div>
        <p className="text-[9px] text-zinc-500 font-heading mt-1.5 leading-snug">
          If both &quot;Melt for Bullets&quot; and &quot;Scrap for Cash&quot; are on, each cycle splits your garage batch about 50/50 between melt and scrap (one shared pool).
          For scrap-only automation here, turn off &quot;Melt for Bullets&quot;. Garage Melt / Scrap buttons always use only the action you press.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] sm:text-xs font-heading font-bold text-zinc-300 flex items-center gap-1.5">
            Melt rarities
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={onSelectAllMeltRarities} disabled={meltDisabled} className="text-[9px] font-heading font-bold text-primary hover:underline disabled:opacity-50">All</button>
            <span className="text-zinc-600">|</span>
            <button type="button" onClick={onDeselectAllMeltRarities} disabled={meltDisabled} className="text-[9px] font-heading font-bold text-zinc-400 hover:underline disabled:opacity-50">None</button>
          </div>
        </div>
        <p className="text-[9px] text-zinc-500 font-heading mb-1">Select at least one rarity to melt; empty = none</p>
        <div className="max-h-32 overflow-y-auto rounded bg-zinc-800/40 border border-zinc-700/30 divide-y divide-zinc-700/30">
          {((meltOptions?.rarities) || []).map((r) => (
            <OptionCheckbox
              key={r.id}
              id={r.id}
              label={r.name}
              checked={selectedMeltRarityIds.includes(r.id)}
              disabled={meltDisabled || selectedScrapRarityIds.includes(r.id)}
              onChange={onToggleMeltRarity}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] sm:text-xs font-heading font-bold text-zinc-300 flex items-center gap-1.5">
            Scrap rarities
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={onSelectAllScrapRarities} disabled={scrapDisabled} className="text-[9px] font-heading font-bold text-primary hover:underline disabled:opacity-50">All</button>
            <span className="text-zinc-600">|</span>
            <button type="button" onClick={onDeselectAllScrapRarities} disabled={scrapDisabled} className="text-[9px] font-heading font-bold text-zinc-400 hover:underline disabled:opacity-50">None</button>
          </div>
        </div>
        <p className="text-[9px] text-zinc-500 font-heading mb-1">Select rarities to scrap for cash (runs every 2 min). Empty = none.</p>
        <div className="max-h-32 overflow-y-auto rounded bg-zinc-800/40 border border-zinc-700/30 divide-y divide-zinc-700/30">
          {((meltOptions?.scrap_rarities) || (meltOptions?.rarities) || []).map((r) => (
            <OptionCheckbox
              key={r.id}
              id={r.id}
              label={r.name}
              checked={selectedScrapRarityIds.includes(r.id)}
              disabled={scrapDisabled || selectedMeltRarityIds.includes(r.id)}
              onChange={onToggleScrapRarity}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onSaveSettings}
        disabled={savingSettings}
        className="w-full py-2 rounded bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-[10px] sm:text-xs hover:bg-primary/30 disabled:opacity-50 transition-all active:scale-[0.99]"
      >
        {savingSettings ? 'Saving...' : 'Save options'}
      </button>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Summary / Status Card (what Auto Rank is doing)
   ═══════════════════════════════════════════════════════ */
const LAST_ACTIVITY_LABELS = {
  crimes: 'Committing crimes',
  gta: 'GTA',
  bust: 'Busting from jail',
  melt: 'Melting cars',
  scrap: 'Scrapping cars',
  booze_sell: 'Sold booze',
  booze_travel: 'Travelling (booze)',
};

const formatLastActivityAt = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
};

const AutoRankSummaryCard = ({ stats, liveCountdown, prefs }) => {
  const enabled = prefs?.auto_rank_enabled;
  const interval = stats?.interval_seconds ?? 30;
  const lastLabel = stats?.last_activity ? (LAST_ACTIVITY_LABELS[stats.last_activity] || stats.last_activity) : null;
  const lastAt = formatLastActivityAt(stats?.last_activity_at);
  const nextCycleAt = (() => {
    const iso = stats?.auto_rank_next_run_at;
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  })();
  const liveLine = (sec, readyLabel = 'Ready') => {
    if (sec != null && sec > 0) return formatCountdown(sec);
    if (sec === 0) return 'now';
    return readyLabel;
  };
  const activeCrimes = enabled && prefs?.auto_rank_crimes;
  const activeGta = enabled && prefs?.auto_rank_gta;
  const activeMelt = enabled && prefs?.auto_rank_melt;
  const activeScrap = enabled && prefs?.auto_rank_scrap;
  const activeBust5 = enabled && prefs?.auto_rank_bust_every_5_sec;
  const activeOc = enabled && prefs?.auto_rank_oc;
  const activeBooze = enabled && prefs?.auto_rank_booze;
  // "Next up" = only Cycle, OC, Booze, Scrap (when the server actually runs). Don't use Crimes/GTA cooldowns —
  // those are per-action; the cycle runs on next_run_at, so "Next up" must match "Next cycle" countdown.
  const items = [];
  if (!stats?.in_jail && liveCountdown?.nextCycleSeconds != null && (activeCrimes || activeGta || activeMelt)) items.push({ label: 'Cycle', sec: liveCountdown.nextCycleSeconds });
  if (activeOc && liveCountdown?.nextOcSeconds != null) items.push({ label: 'OC', sec: liveCountdown.nextOcSeconds });
  if (activeBooze && liveCountdown?.nextBoozeSeconds != null) items.push({ label: 'Booze', sec: liveCountdown.nextBoozeSeconds });
  if (activeScrap && liveCountdown?.nextScrapSeconds != null) items.push({ label: 'Scrap', sec: liveCountdown.nextScrapSeconds });
  const nextUp = items.filter((x) => x.sec !== null && x.sec >= 0).sort((a, b) => a.sec - b.sec)[0];
  const skip = stats?.skip_tokens || {};
  const skipOn = !!(prefs?.auto_rank_use_skip_tokens || stats?.auto_rank_use_skip_tokens);
  const crimeReadyLabel = stats?.crime_skips_ready ? 'Ready (skips)' : 'Ready';
  const gtaReadyLabel = stats?.gta_skips_ready ? 'Ready (skips)' : 'Ready';
  const boozeReadyLabel = stats?.booze_skips_ready ? 'Ready (skips)' : 'Ready';
  const fmtMoney = (n) => `$${Number(n || 0).toLocaleString()}`;

  return (
    <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`} style={{ animationDelay: '0.15s' }}>
      <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader} flex flex-wrap items-center justify-between gap-2`}>
        <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Activity size={14} className="sm:w-4 sm:h-4" />
          What Auto Rank is doing
        </h2>
        {enabled && (
          <div className="flex items-center gap-2">
            {stats?.global_loop_enabled !== false ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 text-[9px] font-heading font-medium text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-heading font-medium text-amber-400">
                Loop stopped
              </span>
            )}
          </div>
        )}
      </div>
      <div className="p-2.5 sm:p-3 space-y-3">
        {!enabled ? (
          <p className="text-[10px] sm:text-xs text-zinc-400 font-heading">Auto Rank is off. Enable it above to run crimes, GTA, busts, OC and booze automatically.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[9px] sm:text-[10px] font-heading text-zinc-500 uppercase tracking-wider">Active:</span>
              {activeCrimes && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">Crimes</span>}
              {activeGta && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">GTA</span>}
              {activeMelt && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">Melt</span>}
              {activeScrap && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">Scrap</span>}
              {activeBust5 && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">Bust 5s</span>}
              {activeOc && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">OC</span>}
              {activeBooze && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">Booze</span>}
              {skipOn && <span className="rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[9px] font-heading text-sky-300">Skip tokens</span>}
              {!activeCrimes && !activeGta && !activeMelt && !activeScrap && !activeBust5 && !activeOc && !activeBooze && (
                <span className="text-zinc-500 text-[9px] font-heading">None (turn on toggles below)</span>
              )}
            </div>
            <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-2.5 sm:p-3 space-y-2.5">
              <div className="text-[9px] sm:text-[10px] font-heading font-bold text-zinc-500 uppercase tracking-wider">
                Right now
              </div>
              {stats?.global_loop_enabled === false ? (
                <div className="text-xs sm:text-sm font-heading font-medium text-amber-400">
                  Global loop stopped — no cycles running
                </div>
              ) : stats?.activity_detail ? (
                <div className="text-xs sm:text-sm font-heading font-medium text-foreground">
                  {stats.activity_detail}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-xs font-heading">
                <span className="text-zinc-500">Status:</span>
                <span className={stats?.global_loop_enabled === false ? 'text-amber-400 font-medium' : stats?.in_jail ? 'text-amber-400 font-medium' : 'text-emerald-400 font-medium'}>
                  {stats?.global_loop_enabled === false ? 'Loop stopped' : stats?.in_jail ? 'In jail — cycles paused' : 'Running'}
                </span>
                {stats?.in_jail && liveCountdown?.jailSeconds != null && liveCountdown.jailSeconds > 0 && (
                  <span className="text-foreground/90">· Out in {formatCountdown(liveCountdown.jailSeconds)}</span>
                )}
              </div>
              {activeBust5 && stats?.global_loop_enabled !== false && (
                <div className="space-y-0.5 text-[10px] sm:text-xs font-heading">
                  <div className="text-foreground/90">
                    Attempted to bust: <span className="font-medium text-foreground">{stats?.attempted_busts_today ?? 0}</span> today
                  </div>
                  <div className="text-foreground/90">
                    Successfully busted: <span className="font-medium text-emerald-400">{stats?.successful_busts_today ?? 0}</span> today
                  </div>
                </div>
              )}
              {nextUp && !stats?.in_jail && stats?.global_loop_enabled !== false && (
                <div className="text-[10px] sm:text-xs font-heading text-primary/90">
                  Next up: <span className="font-medium text-foreground">{nextUp.label}</span> in {liveLine(nextUp.sec)}
                </div>
              )}
              {lastLabel && (
                <div className="text-[10px] sm:text-xs font-heading text-zinc-400">
                  Last: <span className="text-foreground/90">{lastLabel}{lastAt ? ` at ${lastAt}` : ''}</span>
                </div>
              )}
              <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2 space-y-1.5 text-[10px] sm:text-xs font-heading">
                <div className="text-[9px] font-bold text-emerald-300/90 uppercase tracking-wider">Earned today</div>
                <div className="text-emerald-400/90">
                  {stats.successful_crimes_today ?? 0} crimes
                  {(stats?.crime_cash_today ?? 0) > 0 && <> ({fmtMoney(stats.crime_cash_today)})</>}
                  {', '}
                  {stats.successful_gtas_today ?? 0} GTAs
                  {(stats?.gta_value_today ?? 0) > 0 && <> ({fmtMoney(stats.gta_value_today)} cars)</>}
                  {', '}
                  {stats.successful_busts_today ?? 0} busts
                  {(stats?.bust_cash_today ?? 0) > 0 && <> ({fmtMoney(stats.bust_cash_today)})</>}
                </div>
                {(activeBooze || (stats?.booze_runs_today ?? 0) > 0 || (stats?.booze_profit_today ?? 0) > 0 || (stats?.total_booze_profit ?? 0) > 0) && (
                  <div className="text-emerald-400/90">
                    Booze: {stats.booze_runs_today ?? 0} run{(stats.booze_runs_today ?? 0) === 1 ? '' : 's'}
                    {' · '}
                    {fmtMoney(stats.booze_profit_today ?? 0)} today
                    {(stats?.total_booze_profit ?? 0) > 0 && (
                      <span className="text-zinc-500"> · {fmtMoney(stats.total_booze_profit)} lifetime</span>
                    )}
                  </div>
                )}
                {((stats?.bullets_from_melt_today ?? 0) > 0 || (stats?.cars_melted_today ?? 0) > 0) && (
                  <div className="text-emerald-400/90">
                    Melt: {(stats.cars_melted_today ?? 0).toLocaleString()} cars · {(stats.bullets_from_melt_today ?? 0).toLocaleString()} bullets
                  </div>
                )}
                {((stats?.cash_from_scrap_today ?? 0) > 0 || (stats?.cars_scrapped_today ?? 0) > 0) && (
                  <div className="text-emerald-400/90">
                    Scrap: {(stats.cars_scrapped_today ?? 0).toLocaleString()} cars · {fmtMoney(stats.cash_from_scrap_today ?? 0)}
                  </div>
                )}
              </div>
              {(skipOn || stats?.in_jail || (skip.bailout?.tokens ?? 0) > 0 || (skip.bailout?.auto_rank_used_today ?? 0) > 0) && (
                <div className="space-y-2">
                  <div className="text-[9px] font-bold text-sky-300/90 uppercase tracking-wider flex items-center gap-1.5">
                    <Zap size={11} className="text-sky-400" />
                    {skipOn ? 'Daily skips & bailouts' : 'Jail bailout'}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {skipOn && [
                      {
                        key: 'crime',
                        label: 'Crime skip',
                        Icon: Crosshair,
                        chips: (s) => {
                          const held = s.tokens ?? 0;
                          const leftToday = Math.max(0, (s.daily_cap ?? 0) - (s.uses_today ?? 0));
                          const canBurn = (s.credits ?? 0) > 0 || (held > 0 && leftToday > 0);
                          return [
                            { label: 'Held', value: held.toLocaleString(), cls: 'text-foreground' },
                            { label: 'Status', value: canBurn ? 'Usable' : held > 0 ? 'Daily cap' : 'Empty', cls: canBurn ? 'text-emerald-300' : held > 0 ? 'text-amber-300' : 'text-zinc-500' },
                            { label: 'AR used today', value: String(s.auto_rank_used_today ?? 0), cls: 'text-foreground' },
                            ...((s.auto_rank_cash_today ?? 0) > 0 ? [{ label: 'Cash from skips', value: fmtMoney(s.auto_rank_cash_today), cls: 'text-emerald-300' }] : []),
                            { label: 'Left today', value: leftToday.toLocaleString(), cls: 'text-zinc-300' },
                            ...((s.lifetime_cash ?? 0) > 0 ? [{ label: 'Lifetime cash', value: fmtMoney(s.lifetime_cash), cls: 'text-emerald-300' }] : []),
                          ];
                        },
                      },
                      {
                        key: 'gta',
                        label: 'GTA skip',
                        Icon: Car,
                        chips: (s) => {
                          const held = s.tokens ?? 0;
                          const leftToday = Math.max(0, (s.daily_cap ?? 0) - (s.uses_today ?? 0));
                          const canBurn = (s.credits ?? 0) > 0 || (held > 0 && leftToday > 0);
                          return [
                            { label: 'Held', value: held.toLocaleString(), cls: 'text-foreground' },
                            { label: 'Status', value: canBurn ? 'Usable' : held > 0 ? 'Daily cap' : 'Empty', cls: canBurn ? 'text-emerald-300' : held > 0 ? 'text-amber-300' : 'text-zinc-500' },
                            { label: 'AR used today', value: String(s.auto_rank_used_today ?? 0), cls: 'text-foreground' },
                            { label: 'Left today', value: leftToday.toLocaleString(), cls: 'text-zinc-300' },
                            ...((s.lifetime_uses ?? 0) > 0 ? [{ label: 'Lifetime uses', value: String(s.lifetime_uses), cls: 'text-foreground' }] : []),
                          ];
                        },
                      },
                      {
                        key: 'booze',
                        label: 'Booze travel skip',
                        Icon: Wine,
                        chips: (s) => {
                          const held = s.tokens ?? 0;
                          const leftToday = Math.max(0, (s.daily_cap ?? 0) - (s.uses_today ?? 0));
                          const canBurn = (s.credits ?? 0) > 0 || (held > 0 && leftToday > 0);
                          return [
                            { label: 'Held', value: held.toLocaleString(), cls: 'text-foreground' },
                            { label: 'Status', value: canBurn ? 'Usable' : held > 0 ? 'Daily cap' : 'Empty', cls: canBurn ? 'text-emerald-300' : held > 0 ? 'text-amber-300' : 'text-zinc-500' },
                            { label: 'AR used today', value: String(s.auto_rank_used_today ?? 0), cls: 'text-foreground' },
                            ...((s.auto_rank_cash_today ?? 0) > 0 ? [{ label: 'Profit from skips', value: fmtMoney(s.auto_rank_cash_today), cls: 'text-emerald-300' }] : []),
                            { label: 'Left today', value: leftToday.toLocaleString(), cls: 'text-zinc-300' },
                            ...((s.lifetime_profit ?? 0) > 0 ? [{ label: 'Lifetime profit', value: fmtMoney(s.lifetime_profit), cls: 'text-emerald-300' }] : []),
                          ];
                        },
                      },
                    ].map(({ key, label, Icon, chips }) => {
                      const s = skip[key] || {};
                      const chipList = chips(s);
                      return (
                        <div key={key} className="rounded-lg border border-sky-500/20 bg-zinc-900/40 p-2.5 space-y-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/25 flex items-center justify-center shrink-0">
                              <Icon size={13} className="text-sky-300" />
                            </div>
                            <span className="text-[11px] font-heading font-bold text-foreground truncate">{label}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {chipList.map((c) => (
                              <div key={c.label} className="rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2 py-1.5 min-w-0">
                                <div className="text-[8px] font-heading uppercase tracking-wider text-zinc-500 truncate">{c.label}</div>
                                <div className={`text-[11px] font-heading font-bold truncate ${c.cls}`}>{c.value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {(() => {
                      const b = skip.bailout || {};
                      const held = b.tokens ?? 0;
                      const leftToday = Math.max(0, (b.daily_cap ?? 500) - (b.uses_today ?? 0));
                      const willAuto = !!b.will_auto_bail && !!stats?.in_jail;
                      const status = willAuto
                        ? 'Will bail you out'
                        : stats?.in_jail && skipOn && held < 1
                          ? 'No tokens'
                          : held > 0 && leftToday > 0
                            ? 'Ready'
                            : held > 0
                              ? 'Daily cap'
                              : 'Empty';
                      const statusCls = willAuto || (held > 0 && leftToday > 0)
                        ? 'text-emerald-300'
                        : held > 0
                          ? 'text-amber-300'
                          : 'text-zinc-500';
                      return (
                        <div className="rounded-lg border border-amber-500/25 bg-zinc-900/40 p-2.5 space-y-2 sm:col-span-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shrink-0">
                                <Unlock size={13} className="text-amber-300" />
                              </div>
                              <div className="min-w-0">
                                <span className="text-[11px] font-heading font-bold text-foreground truncate block">Jail bailout</span>
                                <span className="text-[9px] text-zinc-500 font-heading">
                                  {skipOn
                                    ? 'Auto Rank spends these when you get locked up'
                                    : 'Turn on Use cooldown skip tokens for Auto Rank bailouts'}
                                </span>
                              </div>
                            </div>
                            {willAuto && (
                              <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-heading font-bold text-emerald-300">
                                Auto bail ready
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            {[
                              { label: 'Held', value: held.toLocaleString(), cls: 'text-foreground' },
                              { label: 'Status', value: status, cls: statusCls },
                              { label: 'AR used today', value: String(b.auto_rank_used_today ?? 0), cls: 'text-foreground' },
                              { label: 'Left today', value: leftToday.toLocaleString(), cls: 'text-zinc-300' },
                              ...((b.lifetime_via_auto_rank ?? 0) > 0 || (b.lifetime_uses ?? 0) > 0
                                ? [
                                    { label: 'Life (AR)', value: String(b.lifetime_via_auto_rank ?? 0), cls: 'text-foreground' },
                                    { label: 'Life (all)', value: String(b.lifetime_uses ?? 0), cls: 'text-foreground' },
                                  ]
                                : []),
                            ].map((c) => (
                              <div key={c.label} className="rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2 py-1.5 min-w-0">
                                <div className="text-[8px] font-heading uppercase tracking-wider text-zinc-500 truncate">{c.label}</div>
                                <div className={`text-[11px] font-heading font-bold truncate ${c.cls}`}>{c.value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {skipOn && (skip.crime?.tokens ?? 0) + (skip.gta?.tokens ?? 0) + (skip.booze?.tokens ?? 0) === 0 && (
                    <div className="text-amber-300/90 text-[9px] font-heading">No Crime / GTA / Booze skip tokens held — buy them in the Store, or turn the skip toggle off.</div>
                  )}
                </div>
              )}
              {(stats?.failed_crimes_today > 0 || stats?.failed_gtas_today > 0 || stats?.failed_busts_today > 0) && (
                <div className="text-[10px] sm:text-xs font-heading text-amber-300/90">
                  Unsuccessful today: {stats.failed_crimes_today ?? 0} crimes, {stats.failed_gtas_today ?? 0} GTAs, {stats.failed_busts_today ?? 0} busts
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 pt-1 border-t border-zinc-700/30 text-[10px] sm:text-xs font-heading">
                {!stats?.in_jail && stats?.global_loop_enabled !== false && (
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">Next cycle</span>
                    <span className="text-foreground font-medium tabular-nums text-right">
                      {liveCountdown?.nextCycleSeconds != null
                        ? liveCountdown.nextCycleSeconds > 0
                          ? `${liveLine(liveCountdown.nextCycleSeconds)}${nextCycleAt ? ` (at ${nextCycleAt})` : ''}`
                          : 'now'
                        : nextCycleAt
                          ? `at ${nextCycleAt}`
                          : `within ${interval}s`}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">OC</span>
                  <span className="text-foreground font-medium tabular-nums">{liveLine(liveCountdown?.nextOcSeconds)}</span>
                </div>
                {prefs?.auto_rank_crimes && (
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">Crimes</span>
                    <span className="text-foreground font-medium tabular-nums">{liveLine(liveCountdown?.nextCrimeSeconds, crimeReadyLabel)}</span>
                  </div>
                )}
                {prefs?.auto_rank_gta && (
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">GTA</span>
                    <span className="text-foreground font-medium tabular-nums">{liveLine(liveCountdown?.nextGtaSeconds, gtaReadyLabel)}</span>
                  </div>
                )}
                {prefs?.auto_rank_booze && (
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">Booze</span>
                    <span className="text-foreground font-medium tabular-nums">{liveLine(liveCountdown?.nextBoozeSeconds, boozeReadyLabel)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2 col-span-full sm:col-span-1">
                  <span className="text-zinc-500">Cycle interval</span>
                  <span className="text-foreground font-medium">{interval}s</span>
                </div>
              </div>
            </div>
            <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading leading-relaxed ">
              <strong className="text-zinc-400">Cycle order:</strong> busts → crimes → GTA. <strong className="text-zinc-400">OC</strong> and <strong className="text-zinc-400">booze</strong> run on their own timers. Interval: {interval}s; in jail, cycles pause until you’re out
              {skipOn ? ' (or until a bailout token frees you). With skip tokens on, Auto Rank burns up to 5 Crime/GTA/Booze skips per cycle; skipped crimes pay −50% cash.' : '.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   OC Equipment Options Card
   ═══════════════════════════════════════════════════════ */
const OCOptionsCard = ({ equipment, selectedId, saving, onSelect }) => {
  const list = Array.isArray(equipment) ? equipment : [];
  return (
    <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`} style={{ animationDelay: '0.2s' }}>
      <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
        <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Briefcase size={14} className="sm:w-4 sm:h-4" />
          OC equipment (Auto Rank heists)
        </h2>
      </div>
      <div className="p-2.5 sm:p-3 space-y-2">
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
          Equipment used when Auto Rank runs Organised Crime. Cost is charged per heist when it runs.
        </p>
        <div className="space-y-1.5">
          {list.map((e) => (
            <label key={e.id} className={`flex items-center gap-2 py-2 px-2 rounded border cursor-pointer transition-colors ${e.id === selectedId ? 'bg-primary/10 border-primary/50' : 'bg-zinc-800/40 border-zinc-700/30 hover:bg-zinc-800/60'}`}>
              <input
                type="radio"
                name="oc-equipment"
                checked={e.id === selectedId}
                disabled={saving}
                onChange={() => onSelect(e.id)}
                className="text-primary focus:ring-primary/50"
              />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] sm:text-xs font-heading font-medium text-foreground">{e.name}</span>
                <span className="text-[9px] text-zinc-500 font-heading ml-1.5">
                  ${(e.cost || 0).toLocaleString()}{e.success_bonus != null && e.success_bonus > 0 ? ` · +${Math.round((e.success_bonus || 0) * 100)}%` : ''}
                </span>
              </div>
            </label>
          ))}
        </div>
        {list.length === 0 && <p className="text-[10px] text-zinc-500 font-heading">Loading equipment…</p>}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   Stats Card
   ═══════════════════════════════════════════════════════ */
const StatsCard = ({ stats, liveCountdown }) => {
  const s = stats || {};
  const { text: ocText, at: ocAt } = formatNextOcAt(s.next_oc_at);
  const nextCycleAt = (() => {
    const iso = s.auto_rank_next_run_at;
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  })();
  const jailDisplay = s.in_jail && (liveCountdown?.jailSeconds != null ? liveCountdown.jailSeconds > 0 : s.jail_seconds_remaining != null);
  const jailSeconds = liveCountdown?.jailSeconds ?? s.jail_seconds_remaining;
  const totalBusts = Number(s.total_busts) || 0;
  const totalCrimes = Number(s.total_crimes) || 0;
  const totalGtas = Number(s.total_gtas) || 0;
  const totalCash = Number(s.total_cash) || 0;
  const totalCarsMelted = Number(s.total_cars_melted) || 0;
  const totalBulletsFromMelt = Number(s.total_bullets_from_melt) || 0;
  const totalCarsScrapped = Number(s.total_cars_scrapped) || 0;
  const totalCashFromScrap = Number(s.total_cash_from_scrap) || 0;
  const bestCars = (Array.isArray(s.best_cars) ? s.best_cars : []).filter((car) => car && typeof car === 'object');

  return (
    <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`} style={{ animationDelay: '0.2s' }}>
      <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
        <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
          <BarChart3 size={14} className="sm:w-4 sm:h-4" />
          Your Stats
        </h2>
      </div>
      
      <div className="p-2.5 sm:p-3 space-y-3">
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
          Lifetime totals since first activation
        </p>
        
        {/* Main stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          <StatCard label="Busts" value={totalBusts.toLocaleString()} icon={Lock} />
          <StatCard label="Crimes" value={totalCrimes.toLocaleString()} icon={Crosshair} />
          <StatCard label="GTAs" value={totalGtas.toLocaleString()} icon={Car} />
          <StatCard label="Bullets" value={totalBulletsFromMelt.toLocaleString()} valueColor="text-amber-400" icon={CircleDot} />
          <StatCard 
            label="Cash Made" 
            value={`$${totalCash.toLocaleString()}`} 
            valueColor="text-emerald-400"
            icon={DollarSign}
          />
        </div>
        
        {/* Additional stats */}
        <div className="space-y-1.5 pt-2 border-t border-zinc-700/30">
          {s.in_jail && (
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-heading text-amber-400">
              <Lock size={12} className="sm:w-3.5 sm:h-3.5 shrink-0" />
              <span>In jail — cycles paused</span>
              {jailDisplay && jailSeconds != null && jailSeconds > 0 && (
                <span className="text-amber-300/90">· out in {formatCountdown(jailSeconds)}</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-heading">
            <Clock size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
            <span className="text-zinc-400">Running:</span>
            <span className="text-foreground font-medium">{formatRunningTime(s.running_seconds)}</span>
          </div>
          
          {!s.in_jail && (
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-heading">
              <Activity size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
              <span className="text-zinc-400">Next cycle:</span>
              <span className="text-foreground font-medium">
                {liveCountdown?.nextCycleSeconds != null && liveCountdown.nextCycleSeconds > 0
                  ? `${formatCountdown(liveCountdown.nextCycleSeconds)}${nextCycleAt ? ` (at ${nextCycleAt})` : ''}`
                  : liveCountdown?.nextCycleSeconds === 0
                    ? 'now'
                    : nextCycleAt
                      ? `at ${nextCycleAt}`
                      : `within ${s.interval_seconds ?? 30}s`}
              </span>
            </div>
          )}
          
          <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-heading">
            <Briefcase size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
            <span className="text-zinc-400">Next OC:</span>
            <span className="text-foreground font-medium">
              {liveCountdown?.nextOcSeconds != null && liveCountdown.nextOcSeconds > 0
                ? `${formatCountdown(liveCountdown.nextOcSeconds)} (at ${ocAt || '—'})`
                : ocAt ? `in ${ocText} (at ${ocAt})` : ocText}
            </span>
          </div>
          
          {((Number(s.total_booze_runs) || 0) > 0 || (Number(s.total_booze_profit) || 0) > 0) && (
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-heading">
              <Wine size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
              <span className="text-zinc-400">Booze:</span>
              <span className="text-foreground font-medium">{(Number(s.total_booze_runs) || 0).toLocaleString()} runs</span>
              <span className="text-zinc-600">·</span>
              <span className="text-emerald-400 font-medium">${(Number(s.total_booze_profit) || 0).toLocaleString()}</span>
            </div>
          )}
          {(totalCarsMelted > 0 || totalCarsScrapped > 0 || totalBulletsFromMelt > 0 || totalCashFromScrap > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-xs font-heading">
              <Flame size={12} className="text-primary sm:w-3.5 sm:h-3.5 shrink-0" />
              <span className="text-zinc-400">Melt:</span>
              {totalCarsMelted > 0 && (
                <span className="text-foreground font-medium">{totalCarsMelted.toLocaleString()} car{totalCarsMelted !== 1 ? 's' : ''} melted</span>
              )}
              {totalCarsMelted > 0 && totalBulletsFromMelt > 0 && <span className="text-zinc-600">·</span>}
              {totalBulletsFromMelt > 0 && (
                <span className="text-amber-400 font-medium">{totalBulletsFromMelt.toLocaleString()} bullets</span>
              )}
              {(totalCarsMelted > 0 || totalBulletsFromMelt > 0) && (totalCarsScrapped > 0 || totalCashFromScrap > 0) && <span className="text-zinc-600">·</span>}
              {totalCarsScrapped > 0 && (
                <span className="text-foreground font-medium">{totalCarsScrapped.toLocaleString()} car{totalCarsScrapped !== 1 ? 's' : ''} scrapped</span>
              )}
              {totalCarsScrapped > 0 && totalCashFromScrap > 0 && <span className="text-zinc-600">·</span>}
              {totalCashFromScrap > 0 && (
                <span className="text-emerald-400 font-medium">${totalCashFromScrap.toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
        
        {/* Best cars */}
        {bestCars.length > 0 && (
          <div className="pt-2 border-t border-zinc-700/30">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
              <span className="text-[9px] sm:text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-wider">
                Top 3 Cars Stolen
              </span>
            </div>
            <div className="space-y-1">
              {bestCars.map((car, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] sm:text-xs bg-zinc-800/40 rounded px-2 py-1">
                  <span className="text-foreground font-medium">{car?.name ?? '—'}</span>
                  <span className="text-emerald-400 font-mono font-medium">${(car?.value ?? 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   Admin Global Loop Card
   ═══════════════════════════════════════════════════════ */
const AdminGlobalLoopCard = ({
  globalEnabled,
  intervalSeconds,
  intervalBustSeconds,
  intervalOcSeconds,
  inputValue,
  inputValueBust,
  inputValueOc,
  setInputValue,
  setInputValueBust,
  setInputValueOc,
  saving,
  toggling,
  onStart,
  onStop,
  onSave,
}) => (
  <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`} style={{ animationDelay: '0.3s' }}>
    <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
      <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Shield size={14} className="sm:w-4 sm:h-4" />
        Admin — Global Loop
      </h2>
    </div>
    
    <div className="p-2.5 sm:p-3 md:p-4 space-y-3 sm:space-y-4">
      <p className="text-[10px] sm:text-xs text-zinc-400 font-heading leading-relaxed">
        Separate loop intervals: main (crimes/GTA/booze), jail busts, and OC. Start/Stop controls the main loop.
      </p>
      
      {/* Status & Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs sm:text-sm font-heading text-foreground">
          Loop:{' '}
          <span className={globalEnabled ? 'text-emerald-400 font-bold' : 'text-zinc-400'}>
            {globalEnabled ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={toggling || globalEnabled}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-heading font-bold text-[10px] sm:text-xs hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            <Play size={12} className="sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Start</span>
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={toggling || !globalEnabled}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded bg-red-500/20 border border-red-500/50 text-red-400 font-heading font-bold text-[10px] sm:text-xs hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            <Square size={12} className="sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        </div>
      </div>
      
      {/* Main interval (crimes / GTA / booze) */}
      <div>
        <label className="text-[9px] sm:text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
          <Clock size={12} className="sm:w-3.5 sm:h-3.5" />
          Main (crimes / GTA / booze) — seconds
        </label>
        <p className="text-[9px] sm:text-[10px] text-zinc-400 mb-2">
          Wait after each user cycle. Min: {MIN_INTERVAL}s · Current: {intervalSeconds}s
        </p>
        <p className="text-[9px] text-emerald-200/90 mb-2">
          Cron: ticker calls <code className="bg-zinc-800 px-1 rounded">cron-cycle-ticker.py</code> — it reads this value from the server, so what you set here is what runs.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={MIN_INTERVAL}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded bg-zinc-800/80 border border-zinc-700/50 text-foreground font-heading text-[10px] sm:text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
          />
        </div>
      </div>

      {/* Bust interval (jail busts) */}
      <div>
        <label className="text-[9px] sm:text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
          Bust (jail) — seconds
        </label>
        <p className="text-[9px] sm:text-[10px] text-zinc-400 mb-2">
          How often to run jail bust pass. Min: {MIN_BUST_INTERVAL}s · Current: {intervalBustSeconds}s
        </p>
        <p className="text-[9px] text-emerald-200/90 mb-2">
          Cron: ticker calls <code className="bg-zinc-800 px-1 rounded">cron-bust-ticker.py</code> — it reads this value from the server.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={MIN_BUST_INTERVAL}
            value={inputValueBust}
            onChange={(e) => setInputValueBust(e.target.value)}
            className="flex-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded bg-zinc-800/80 border border-zinc-700/50 text-foreground font-heading text-[10px] sm:text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
          />
        </div>
      </div>

      {/* OC interval */}
      <div>
        <label className="text-[9px] sm:text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
          OC — seconds
        </label>
        <p className="text-[9px] sm:text-[10px] text-zinc-400 mb-2">
          How often to run OC pass. Min: {MIN_OC_INTERVAL}s · Current: {intervalOcSeconds}s
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={MIN_OC_INTERVAL}
            value={inputValueOc}
            onChange={(e) => setInputValueOc(e.target.value)}
            className="flex-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded bg-zinc-800/80 border border-zinc-700/50 text-foreground font-heading text-[10px] sm:text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-3 sm:px-4 py-1.5 sm:py-2 rounded bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-[10px] sm:text-xs hover:bg-primary/30 disabled:opacity-50 transition-all active:scale-95"
        >
          {saving ? 'Saving...' : 'Save intervals'}
        </button>
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */
export default function AutoRank() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [prefs, setPrefs] = useState({
    auto_rank_enabled: false,
    auto_rank_crimes: false,
    auto_rank_gta: false,
    auto_rank_bust_every_5_sec: false,
    auto_rank_oc: false,
    auto_rank_booze: false,
    auto_rank_melt: false,
    auto_rank_scrap: false,
    passive_booze_paused: false,
    auto_rank_purchased: false,
    auto_rank_permanent: false,
    auto_rank_has_access: false,
    auto_rank_trial: false,
    auto_rank_trial_until: null,
    auto_rank_trial_dismissed: false,
    telegram_chat_id_set: false,
    auto_rank_crime_ids: [],
    auto_rank_gta_option_ids: [],
    auto_rank_melt_action_ids: [],
    auto_rank_melt_rarity_ids: [],
    auto_rank_scrap_rarity_ids: [],
    auto_rank_email_entitled: false,
    auto_rank_stripe_purchasable: false,
    robot_bg_auto_search_subscription_active: false,
    robot_bg_auto_search_enabled: true,
    robot_bg_auto_search_until: null,
  });
  const [autoRankStripeLoading, setAutoRankStripeLoading] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [settingsData, setSettingsData] = useState({
    crimes: [], gta_options: [], melt_options: { actions: [], rarities: [], scrap_rarities: [] },
    auto_rank_crime_ids: [], auto_rank_gta_option_ids: [], auto_rank_melt_action_ids: [], auto_rank_melt_rarity_ids: [], auto_rank_scrap_rarity_ids: [],
  });
  const [selectedCrimeIds, setSelectedCrimeIds] = useState([]);
  const [selectedGtaIds, setSelectedGtaIds] = useState([]);
  const [selectedMeltActionIds, setSelectedMeltActionIds] = useState([]);
  const [selectedMeltRarityIds, setSelectedMeltRarityIds] = useState([]);
  const [selectedScrapRarityIds, setSelectedScrapRarityIds] = useState([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [ocEquipment, setOcEquipment] = useState([]);
  const [selectedOcEquipmentId, setSelectedOcEquipmentId] = useState('basic');
  const [savingOcEquipment, setSavingOcEquipment] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [intervalBustSeconds, setIntervalBustSeconds] = useState(5);
  const [intervalOcSeconds, setIntervalOcSeconds] = useState(63);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [inputValue, setInputValue] = useState('30');
  const [inputValueBust, setInputValueBust] = useState('5');
  const [inputValueOc, setInputValueOc] = useState('63');
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersFilter, setAdminUsersFilter] = useState('all');
  const [hideOffline, setHideOffline] = useState(false);
  const [editingChatId, setEditingChatId] = useState({});
  const [editingToken, setEditingToken] = useState({});
  const [savingUser, setSavingUser] = useState(null);
  const [wipingStats, setWipingStats] = useState(false);
  const [inspectUsername, setInspectUsername] = useState('');
  const [inspectData, setInspectData] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState('');
  const adminDiagRef = useRef(null);
  const [stats, setStats] = useState({
    total_busts: 0,
    total_crimes: 0,
    total_gtas: 0,
    total_cash: 0,
    running_seconds: 0,
    best_cars: [],
    total_booze_runs: 0,
    total_booze_profit: 0,
    total_cars_melted: 0,
    total_bullets_from_melt: 0,
    total_cars_scrapped: 0,
    total_cash_from_scrap: 0,
    next_oc_at: null,
    in_jail: false,
    jail_seconds_remaining: null,
    jail_until: null,
    auto_rank_next_run_at: null,
    next_scrap_at: null,
    interval_seconds: 30,
    interval_scrap_seconds: 120,
    next_crime_at: null,
    next_gta_at: null,
    next_booze_arrival_at: null,
    activity_detail: null,
    last_activity: null,
    last_activity_at: null,
    failed_crimes_today: 0,
    failed_gtas_today: 0,
    failed_busts_today: 0,
    successful_crimes_today: 0,
    successful_gtas_today: 0,
    successful_busts_today: 0,
    bullets_from_melt_today: 0,
    cars_melted_today: 0,
    cars_scrapped_today: 0,
    cash_from_scrap_today: 0,
  });
  const [liveCountdown, setLiveCountdown] = useState({
    jailSeconds: null,
    nextCycleSeconds: null,
    nextOcSeconds: null,
    nextCrimeSeconds: null,
    nextGtaSeconds: null,
    nextBoozeSeconds: null,
    nextScrapSeconds: null,
  });
  const [lastStatsAt, setLastStatsAt] = useState(null);
  const prevJailSecondsRef = useRef(null);

  // Derived once per render, before any early return, so useEffects can read them
  const trialUntilMs = prefs?.auto_rank_trial_until ? new Date(prefs.auto_rank_trial_until).getTime() : null;
  const trialActive = Boolean(!prefs?.auto_rank_permanent && prefs?.auto_rank_trial && trialUntilMs && trialUntilMs > Date.now());
  const permanentPurchased = Boolean(prefs?.auto_rank_permanent || (prefs?.auto_rank_purchased && !prefs?.auto_rank_trial));
  const canEnable = Boolean(prefs?.auto_rank_has_access) || permanentPurchased || trialActive;
  const hasTelegram = Boolean(prefs?.telegram_chat_id_set);

  // Refetch stats (used when jail countdown hits 0 so status updates immediately)
  const refetchStatsRef = useRef(null);

  // Live countdown ticker: recompute every second from server timestamps; refetch stats when jail expires
  useEffect(() => {
    const s = stats ?? {};
    const jailUntil = s.jail_until;
    const nextRunAt = s.auto_rank_next_run_at;
    const nextOcAt = s.next_oc_at;
    const nextCrimeAt = s.next_crime_at;
    const nextGtaAt = s.next_gta_at;
    const nextBoozeAt = s.next_booze_arrival_at;
    const nextScrapAt = s.next_scrap_at;
    const tick = () => {
      const now = Date.now();
      const sec = (iso) => {
        if (!iso) return null;
        const t = new Date(iso).getTime();
        return (!Number.isNaN(t) && t > now) ? Math.max(0, Math.floor((t - now) / 1000)) : null;
      };
      const jailSeconds = sec(jailUntil);
      const nextCycleSeconds = sec(nextRunAt);
      const nextOcSeconds = sec(nextOcAt);
      const nextCrimeSeconds = sec(nextCrimeAt);
      const nextGtaSeconds = sec(nextGtaAt);
      const nextBoozeSeconds = sec(nextBoozeAt);
      const nextScrapSeconds = sec(nextScrapAt);
      // When jail countdown just hit 0, refetch so "In jail — cycles paused" updates to "Running" right away
      const prev = prevJailSecondsRef.current;
      if (prev != null && prev > 0 && (jailSeconds === null || jailSeconds === 0) && refetchStatsRef.current) {
        refetchStatsRef.current();
      }
      prevJailSecondsRef.current = jailSeconds;
      setLiveCountdown((prev) => {
        if (prev.jailSeconds === jailSeconds && prev.nextCycleSeconds === nextCycleSeconds && prev.nextOcSeconds === nextOcSeconds &&
            prev.nextCrimeSeconds === nextCrimeSeconds && prev.nextGtaSeconds === nextGtaSeconds && prev.nextBoozeSeconds === nextBoozeSeconds && prev.nextScrapSeconds === nextScrapSeconds) return prev;
        return { jailSeconds, nextCycleSeconds, nextOcSeconds, nextCrimeSeconds, nextGtaSeconds, nextBoozeSeconds, nextScrapSeconds };
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [stats]);

  // Live stats: poll every 2s whenever Auto Rank is enabled so status, bust counts, and countdowns update in near real time
  useEffect(() => {
    if (!canEnable || !prefs?.auto_rank_enabled) return;
    const poll = () => {
      api.get('/auto-rank/stats').then((res) => {
        if (!res?.data) return;
        const d = res.data;
        setStats((prev) => ({
          ...prev,
          global_loop_enabled: d.global_loop_enabled !== false,
          successful_busts_today: d.successful_busts_today ?? prev.successful_busts_today,
          attempted_busts_today: d.attempted_busts_today ?? prev.attempted_busts_today,
          total_busts: d.total_busts ?? prev.total_busts,
          total_crimes: d.total_crimes ?? prev.total_crimes,
          total_gtas: d.total_gtas ?? prev.total_gtas,
          total_cash: d.total_cash ?? prev.total_cash,
          running_seconds: d.running_seconds ?? prev.running_seconds,
          best_cars: d.best_cars ?? prev.best_cars,
          total_booze_runs: d.total_booze_runs ?? prev.total_booze_runs,
          total_booze_profit: d.total_booze_profit ?? prev.total_booze_profit,
          total_cars_melted: d.total_cars_melted ?? prev.total_cars_melted,
          total_bullets_from_melt: d.total_bullets_from_melt ?? prev.total_bullets_from_melt,
          total_cars_scrapped: d.total_cars_scrapped ?? prev.total_cars_scrapped,
          total_cash_from_scrap: d.total_cash_from_scrap ?? prev.total_cash_from_scrap,
          next_oc_at: d.next_oc_at ?? null,
          in_jail: d.in_jail === true,
          jail_seconds_remaining: d.jail_seconds_remaining ?? null,
          jail_until: d.jail_until ?? null,
          auto_rank_next_run_at: d.auto_rank_next_run_at ?? null,
          next_scrap_at: d.next_scrap_at ?? null,
          interval_seconds: d.interval_seconds ?? prev.interval_seconds,
          interval_scrap_seconds: d.interval_scrap_seconds ?? prev.interval_scrap_seconds,
          next_crime_at: d.next_crime_at ?? null,
          next_gta_at: d.next_gta_at ?? null,
          next_booze_arrival_at: d.next_booze_arrival_at ?? null,
          crime_skips_ready: !!d.crime_skips_ready,
          gta_skips_ready: !!d.gta_skips_ready,
          booze_skips_ready: !!d.booze_skips_ready,
          auto_rank_use_skip_tokens: !!d.auto_rank_use_skip_tokens,
          has_usable_ar_skips: typeof d.has_usable_ar_skips === 'boolean'
            ? d.has_usable_ar_skips
            : hasAnyUsableArSkip(d.skip_tokens ?? prev.skip_tokens),
          skip_tokens: d.skip_tokens ?? prev.skip_tokens ?? null,
          activity_detail: d.activity_detail ?? null,
          last_activity: d.last_activity ?? null,
          last_activity_at: d.last_activity_at ?? null,
          failed_crimes_today: d.failed_crimes_today ?? 0,
          failed_gtas_today: d.failed_gtas_today ?? 0,
          failed_busts_today: d.failed_busts_today ?? 0,
          successful_crimes_today: d.successful_crimes_today ?? 0,
          successful_gtas_today: d.successful_gtas_today ?? 0,
          successful_busts_today: d.successful_busts_today ?? 0,
          bullets_from_melt_today: d.bullets_from_melt_today ?? 0,
          cars_melted_today: d.cars_melted_today ?? 0,
          cars_scrapped_today: d.cars_scrapped_today ?? 0,
          cash_from_scrap_today: d.cash_from_scrap_today ?? 0,
          booze_runs_today: d.booze_runs_today ?? 0,
          booze_profit_today: d.booze_profit_today ?? 0,
          crime_cash_today: d.crime_cash_today ?? 0,
          gta_value_today: d.gta_value_today ?? 0,
          bust_cash_today: d.bust_cash_today ?? 0,
          total_booze_runs: d.total_booze_runs ?? prev.total_booze_runs,
          total_booze_profit: d.total_booze_profit ?? prev.total_booze_profit,
        }));
        if (d.auto_rank_use_skip_tokens === false) {
          setPrefs((p) => (p.auto_rank_use_skip_tokens ? { ...p, auto_rank_use_skip_tokens: false } : p));
        }
        setLastStatsAt(Date.now());
      }).catch(() => {});
    };
    refetchStatsRef.current = poll;
    const id = setInterval(poll, 2000);
    poll();
    return () => {
      refetchStatsRef.current = null;
      clearInterval(id);
    };
  }, [canEnable, prefs?.auto_rank_enabled]);

  // Fetch OC equipment when user has Auto Rank and OC enabled
  useEffect(() => {
    if (!canEnable || !prefs?.auto_rank_oc) return;
    api.get('/organised-crime/equipment')
      .then((res) => {
        const eq = res.data?.equipment ?? [];
        setOcEquipment(eq);
        const sel = res.data?.selected_equipment ?? 'basic';
        setSelectedOcEquipmentId(sel);
      })
      .catch(() => setOcEquipment([]));
  }, [canEnable, prefs?.auto_rank_oc]);

  useEffect(() => {
    const run = async () => {
      try {
        const [meRes, checkRes, intervalRes, statsRes] = await Promise.all([
          api.get('/auto-rank/me').catch(() => ({ data: null })),
          api.get('/auth/staff-flags').catch(() => ({ data: {} })),
          api.get('/auto-rank/interval').catch(() => ({ data: null })),
          api.get('/auto-rank/stats').catch(() => ({ data: null })),
        ]);
        setIsAdmin(!!checkRes.data?.is_admin);
        if (meRes?.data) {
          setPrefs({
            auto_rank_enabled: meRes.data.auto_rank_enabled === true,
            auto_rank_crimes: meRes.data.auto_rank_crimes === true,
            auto_rank_gta: meRes.data.auto_rank_gta === true,
            auto_rank_bust_every_5_sec: !!meRes.data.auto_rank_bust_every_5_sec,
            auto_rank_oc: !!meRes.data.auto_rank_oc,
            auto_rank_booze: !!meRes.data.auto_rank_booze,
            passive_booze_paused: !!meRes.data.passive_booze_paused,
            auto_rank_purchased: !!meRes.data.auto_rank_purchased,
            auto_rank_permanent: !!meRes.data.auto_rank_permanent,
            auto_rank_has_access: meRes.data.auto_rank_has_access === true,
            auto_rank_trial: !!meRes.data.auto_rank_trial,
            auto_rank_trial_until: meRes.data.auto_rank_trial_until || null,
            auto_rank_trial_dismissed: !!meRes.data.auto_rank_trial_dismissed,
            telegram_chat_id_set: !!meRes.data.telegram_chat_id_set,
            auto_rank_crime_ids: meRes.data.auto_rank_crime_ids ?? [],
            auto_rank_gta_option_ids: meRes.data.auto_rank_gta_option_ids ?? [],
            auto_rank_melt: meRes.data.auto_rank_melt === true,
            auto_rank_scrap: meRes.data.auto_rank_scrap === true,
            auto_rank_telegram_notify: meRes.data.auto_rank_telegram_notify !== false,
            auto_rank_use_skip_tokens: !!meRes.data.auto_rank_use_skip_tokens,
            auto_rank_melt_action_ids: meRes.data.auto_rank_melt_action_ids ?? [],
            auto_rank_melt_rarity_ids: meRes.data.auto_rank_melt_rarity_ids ?? [],
            auto_rank_scrap_rarity_ids: meRes.data.auto_rank_scrap_rarity_ids ?? [],
            auto_rank_email_entitled: !!meRes.data.auto_rank_email_entitled,
            auto_rank_stripe_purchasable: !!meRes.data.auto_rank_stripe_purchasable,
            robot_bg_auto_search_subscription_active: !!meRes.data.robot_bg_auto_search_subscription_active,
            robot_bg_auto_search_enabled: meRes.data.robot_bg_auto_search_enabled !== false,
            robot_bg_auto_search_until: meRes.data.robot_bg_auto_search_until || null,
          });
        }
        const hasFeature = meRes?.data?.auto_rank_has_access || meRes?.data?.auto_rank_purchased || meRes?.data?.auto_rank_enabled;
        if (hasFeature) {
          api.get('/auto-rank/settings').then((res) => {
            const d = res.data || {};
            const crimes = d.crimes || [];
            const gtaOptions = d.gta_options || [];
            const meltOptions = d.melt_options || { actions: [], rarities: [], scrap_rarities: [] };
            const crimeIds = d.auto_rank_crime_ids ?? [];
            const gtaIds = d.auto_rank_gta_option_ids ?? [];
            const meltActionIds = d.auto_rank_melt_action_ids ?? [];
            const meltRarityIds = d.auto_rank_melt_rarity_ids ?? [];
            const scrapRarityIds = d.auto_rank_scrap_rarity_ids ?? [];
            setSettingsData({
              crimes, gta_options: gtaOptions, melt_options: meltOptions,
              auto_rank_crime_ids: crimeIds, auto_rank_gta_option_ids: gtaIds,
              auto_rank_melt_action_ids: meltActionIds, auto_rank_melt_rarity_ids: meltRarityIds, auto_rank_scrap_rarity_ids: scrapRarityIds,
            });
            setSelectedCrimeIds(crimeIds.length === 0 ? (crimes || []).map((c) => c?.id).filter(Boolean) : crimeIds);
            setSelectedGtaIds(gtaIds.length === 0 ? (gtaOptions || []).map((o) => o?.id).filter(Boolean) : gtaIds);
            setSelectedMeltActionIds(meltActionIds);
            setSelectedMeltRarityIds(meltRarityIds);
            setSelectedScrapRarityIds(scrapRarityIds);
          }).catch(() => {});
        }
        if (statsRes?.data) {
          setStats({
            global_loop_enabled: statsRes.data.global_loop_enabled !== false,
            total_busts: statsRes.data.total_busts ?? 0,
            total_crimes: statsRes.data.total_crimes ?? 0,
            total_gtas: statsRes.data.total_gtas ?? 0,
            total_cash: statsRes.data.total_cash ?? 0,
            running_seconds: statsRes.data.running_seconds ?? 0,
            best_cars: statsRes.data.best_cars ?? [],
            total_booze_runs: statsRes.data.total_booze_runs ?? 0,
            total_booze_profit: statsRes.data.total_booze_profit ?? 0,
            total_cars_melted: statsRes.data.total_cars_melted ?? 0,
            total_bullets_from_melt: statsRes.data.total_bullets_from_melt ?? 0,
            total_cars_scrapped: statsRes.data.total_cars_scrapped ?? 0,
            total_cash_from_scrap: statsRes.data.total_cash_from_scrap ?? 0,
            next_oc_at: statsRes.data.next_oc_at ?? null,
            in_jail: statsRes.data.in_jail === true,
            jail_seconds_remaining: statsRes.data.jail_seconds_remaining ?? null,
            jail_until: statsRes.data.jail_until ?? null,
            auto_rank_next_run_at: statsRes.data.auto_rank_next_run_at ?? null,
            next_scrap_at: statsRes.data.next_scrap_at ?? null,
            interval_seconds: statsRes.data.interval_seconds ?? 30,
            interval_scrap_seconds: statsRes.data.interval_scrap_seconds ?? 120,
            next_crime_at: statsRes.data.next_crime_at ?? null,
            next_gta_at: statsRes.data.next_gta_at ?? null,
            next_booze_arrival_at: statsRes.data.next_booze_arrival_at ?? null,
            crime_skips_ready: !!statsRes.data.crime_skips_ready,
            gta_skips_ready: !!statsRes.data.gta_skips_ready,
            booze_skips_ready: !!statsRes.data.booze_skips_ready,
            auto_rank_use_skip_tokens: !!statsRes.data.auto_rank_use_skip_tokens,
            has_usable_ar_skips: typeof statsRes.data.has_usable_ar_skips === 'boolean'
              ? statsRes.data.has_usable_ar_skips
              : hasAnyUsableArSkip(statsRes.data.skip_tokens),
            skip_tokens: statsRes.data.skip_tokens ?? null,
            activity_detail: statsRes.data.activity_detail ?? null,
            last_activity: statsRes.data.last_activity ?? null,
            last_activity_at: statsRes.data.last_activity_at ?? null,
            failed_crimes_today: statsRes.data.failed_crimes_today ?? 0,
            failed_gtas_today: statsRes.data.failed_gtas_today ?? 0,
            failed_busts_today: statsRes.data.failed_busts_today ?? 0,
            successful_crimes_today: statsRes.data.successful_crimes_today ?? 0,
            successful_gtas_today: statsRes.data.successful_gtas_today ?? 0,
            successful_busts_today: statsRes.data.successful_busts_today ?? 0,
            bullets_from_melt_today: statsRes.data.bullets_from_melt_today ?? 0,
            cars_melted_today: statsRes.data.cars_melted_today ?? 0,
            cars_scrapped_today: statsRes.data.cars_scrapped_today ?? 0,
            cash_from_scrap_today: statsRes.data.cash_from_scrap_today ?? 0,
            booze_runs_today: statsRes.data.booze_runs_today ?? 0,
            booze_profit_today: statsRes.data.booze_profit_today ?? 0,
            crime_cash_today: statsRes.data.crime_cash_today ?? 0,
            gta_value_today: statsRes.data.gta_value_today ?? 0,
            bust_cash_today: statsRes.data.bust_cash_today ?? 0,
            attempted_busts_today: statsRes.data.attempted_busts_today ?? 0,
          });
          setLastStatsAt(Date.now());
          if (statsRes.data.auto_rank_use_skip_tokens === false) {
            setPrefs((p) => (p.auto_rank_use_skip_tokens ? { ...p, auto_rank_use_skip_tokens: false } : p));
          }
        }
        if (checkRes.data?.is_admin) {
          if (intervalRes?.data) {
            setIntervalSeconds(intervalRes.data.interval_seconds ?? 30);
            setInputValue(String(intervalRes.data.interval_seconds ?? 30));
            setIntervalBustSeconds(intervalRes.data.interval_bust_seconds ?? 5);
            setInputValueBust(String(intervalRes.data.interval_bust_seconds ?? 5));
            setIntervalOcSeconds(intervalRes.data.interval_oc_seconds ?? 63);
            setInputValueOc(String(intervalRes.data.interval_oc_seconds ?? 63));
            setGlobalEnabled(intervalRes.data.enabled !== false);
          }
          api.get('/admin/auto-rank/users').then((r) => setAdminUsers(r.data?.users ?? [])).catch(() => setAdminUsers([]));
        }
      } catch {
        setPrefs((p) => ({ ...p, auto_rank_purchased: false }));
      }
    };
    run();
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sessionId = sp.get('session_id');
    if (!sessionId) return;
    let cancelled = false;
    const poll = async (attempt = 0) => {
      if (cancelled) return;
      if (attempt >= 5) {
        toast.error('Payment verification timed out.');
        window.history.replaceState({}, '', '/account/autorank');
        return;
      }
      try {
        const res = await api.get(`/payments/status/${encodeURIComponent(sessionId)}`);
        if (res.data.status === 'fulfillment_blocked' || res.data.payment_status === 'fulfillment_blocked') {
          toast.error(res.data.detail || 'Purchase could not be completed.');
          window.history.replaceState({}, '', '/account/autorank');
          return;
        }
        if (res.data.payment_status === 'paid' || res.data.status === 'completed') {
          if (res.data.auto_rank_entitled) {
            toast.success('Permanent Auto Rank purchased — tied to your verified email.');
          }
          window.history.replaceState({}, '', '/account/autorank');
          const meRes = await api.get('/auto-rank/me');
          if (meRes?.data) {
            setPrefs((p) => ({
              ...p,
              ...meRes.data,
              auto_rank_email_entitled: !!meRes.data.auto_rank_email_entitled,
              auto_rank_stripe_purchasable: !!meRes.data.auto_rank_stripe_purchasable,
            }));
          }
          return;
        }
      } catch {
        /* retry */
      }
      setTimeout(() => poll(attempt + 1), 1500);
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  const handleBuyAutoRankStripe = async () => {
    if (autoRankStripeLoading) return;
    setAutoRankStripeLoading(true);
    try {
      const res = await api.post('/payments/checkout', {
        package_id: AUTO_RANK_STRIPE_PACKAGE_ID,
        origin_url: `${window.location.origin}/account/autorank`,
      });
      window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Checkout failed');
      setAutoRankStripeLoading(false);
    }
  };

  const updatePref = async (key, value) => {
    setSavingPrefs(true);
    try {
      const payload = { [key]: value };
      const res = await api.patch('/auto-rank/me', payload);
      setPrefs((p) => ({
        ...p,
        auto_rank_enabled: res.data?.auto_rank_enabled === true,
        auto_rank_has_access: res.data?.auto_rank_has_access ?? p.auto_rank_has_access,
        auto_rank_purchased: res.data?.auto_rank_purchased ?? p.auto_rank_purchased,
        auto_rank_crimes: res.data?.auto_rank_crimes === true,
        auto_rank_gta: res.data?.auto_rank_gta === true,
        auto_rank_bust_every_5_sec: res.data?.auto_rank_bust_every_5_sec === true,
        auto_rank_oc: res.data?.auto_rank_oc === true,
        auto_rank_booze: res.data?.auto_rank_booze === true,
        passive_booze_paused: res.data?.passive_booze_paused ?? p.passive_booze_paused,
        auto_rank_melt: res.data?.auto_rank_melt === true,
        auto_rank_scrap: res.data?.auto_rank_scrap === true,
        auto_rank_telegram_notify: res.data?.auto_rank_telegram_notify !== false,
        auto_rank_use_skip_tokens: !!res.data?.auto_rank_use_skip_tokens,
        auto_rank_crime_ids: res.data?.auto_rank_crime_ids ?? p.auto_rank_crime_ids,
        auto_rank_gta_option_ids: res.data?.auto_rank_gta_option_ids ?? p.auto_rank_gta_option_ids,
        auto_rank_melt_action_ids: res.data?.auto_rank_melt_action_ids ?? p.auto_rank_melt_action_ids,
        auto_rank_melt_rarity_ids: res.data?.auto_rank_melt_rarity_ids ?? p.auto_rank_melt_rarity_ids,
        auto_rank_scrap_rarity_ids: res.data?.auto_rank_scrap_rarity_ids ?? p.auto_rank_scrap_rarity_ids,
        robot_bg_auto_search_subscription_active: res.data?.robot_bg_auto_search_subscription_active ?? p.robot_bg_auto_search_subscription_active,
        robot_bg_auto_search_enabled: res.data?.robot_bg_auto_search_enabled !== false,
        robot_bg_auto_search_until: res.data?.robot_bg_auto_search_until ?? p.robot_bg_auto_search_until,
      }));
      toast.success('Saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setSavingPrefs(false);
    }
  };

  const toggleCrimeId = (id) => {
    setSelectedCrimeIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const toggleGtaId = (id) => {
    setSelectedGtaIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const toggleMeltActionId = (id) => {
    setSelectedMeltActionIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const _AUTO_RANK_DANGEROUS_RARITIES = new Set(['custom', 'loot_exclusive', 'exclusive']);
  const _confirmDangerousRarity = (rarityId, contextLabel) => {
    const rid = String(rarityId || '').trim();
    if (!_AUTO_RANK_DANGEROUS_RARITIES.has(rid)) return true;
    return window.confirm(
      `Confirm selection: "${rid.replace(/_/g, ' ')}" (${contextLabel}).\n\n` +
      `Cars in this rarity can be very valuable. Are you sure you want Auto Rank to include them?`
    );
  };

  const toggleMeltRarityId = (id) => {
    setSelectedMeltRarityIds((prev) => {
      const isAdding = !prev.includes(id);
      if (isAdding && !_confirmDangerousRarity(id, 'Melt')) return prev;
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // Enforce: a rarity can't be selected in both Melt and Scrap.
      if (!prev.includes(id)) setSelectedScrapRarityIds((sPrev) => sPrev.filter((x) => x !== id));
      return next;
    });
  };
  const toggleScrapRarityId = (id) => {
    setSelectedScrapRarityIds((prev) => {
      const isAdding = !prev.includes(id);
      if (isAdding && !_confirmDangerousRarity(id, 'Scrap')) return prev;
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // Enforce: a rarity can't be selected in both Melt and Scrap.
      if (!prev.includes(id)) setSelectedMeltRarityIds((mPrev) => mPrev.filter((x) => x !== id));
      return next;
    });
  };
  const selectAllCrimes = () => setSelectedCrimeIds((settingsData?.crimes ?? []).map((c) => c?.id).filter(Boolean));
  const deselectAllCrimes = () => setSelectedCrimeIds([]);
  const selectAllGta = () => setSelectedGtaIds((settingsData?.gta_options ?? []).map((o) => o?.id).filter(Boolean));
  const deselectAllGta = () => setSelectedGtaIds([]);
  const meltActions = settingsData?.melt_options?.actions ?? [];
  const meltRarities = settingsData?.melt_options?.rarities ?? [];
  const scrapRarities = settingsData?.melt_options?.scrap_rarities ?? settingsData?.melt_options?.rarities ?? [];
  const selectAllMeltActions = () => setSelectedMeltActionIds(meltActions.map((a) => a?.id).filter(Boolean));
  const deselectAllMeltActions = () => setSelectedMeltActionIds([]);
  const selectAllMeltRarities = () => {
    const all = meltRarities.map((r) => r?.id).filter(Boolean);
    const filtered = all.filter((id) => !selectedScrapRarityIds.includes(id));
    const willAddDangerous = filtered.some((id) => _AUTO_RANK_DANGEROUS_RARITIES.has(String(id || '').trim())) &&
      filtered.some((id) => !selectedMeltRarityIds.includes(id));
    if (willAddDangerous && !window.confirm(
      'Confirm selection: Custom / Loot Exclusive / Exclusive (Melt).\n\n' +
      'These cars can be very valuable. Are you sure you want Auto Rank to include them?'
    )) {
      return;
    }
    setSelectedMeltRarityIds(filtered);
  };
  const deselectAllMeltRarities = () => setSelectedMeltRarityIds([]);
  const selectAllScrapRarities = () => {
    const all = scrapRarities.map((r) => r?.id).filter(Boolean);
    const filtered = all.filter((id) => !selectedMeltRarityIds.includes(id));
    const willAddDangerous = filtered.some((id) => _AUTO_RANK_DANGEROUS_RARITIES.has(String(id || '').trim())) &&
      filtered.some((id) => !selectedScrapRarityIds.includes(id));
    if (willAddDangerous && !window.confirm(
      'Confirm selection: Custom / Loot Exclusive / Exclusive (Scrap).\n\n' +
      'These cars can be very valuable. Are you sure you want Auto Rank to include them?'
    )) {
      return;
    }
    setSelectedScrapRarityIds(filtered);
  };
  const deselectAllScrapRarities = () => setSelectedScrapRarityIds([]);
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const crimes = settingsData.crimes || [];
      const gtaOptions = settingsData.gta_options || [];
      const crimePayload = selectedCrimeIds.length === crimes.length ? [] : selectedCrimeIds;
      const gtaPayload = selectedGtaIds.length === gtaOptions.length ? [] : selectedGtaIds;
      const meltActionPayload = selectedMeltActionIds;
      // Enforce no overlap (UI should already prevent it, but keep payload clean).
      const scrapSet = new Set(selectedScrapRarityIds);
      const meltRarityPayload = selectedMeltRarityIds.filter((id) => !scrapSet.has(id));
      const meltSet = new Set(meltRarityPayload);
      const scrapRarityPayload = selectedScrapRarityIds.filter((id) => !meltSet.has(id));
      const res = await api.patch('/auto-rank/me', {
        auto_rank_crime_ids: crimePayload,
        auto_rank_gta_option_ids: gtaPayload,
        auto_rank_melt_action_ids: meltActionPayload,
        auto_rank_melt_rarity_ids: meltRarityPayload,
        auto_rank_scrap_rarity_ids: scrapRarityPayload,
      });
      setPrefs((p) => ({
        ...p,
        auto_rank_crime_ids: res.data?.auto_rank_crime_ids ?? [],
        auto_rank_gta_option_ids: res.data?.auto_rank_gta_option_ids ?? [],
        auto_rank_melt_action_ids: res.data?.auto_rank_melt_action_ids ?? [],
        auto_rank_melt_rarity_ids: res.data?.auto_rank_melt_rarity_ids ?? [],
        auto_rank_scrap_rarity_ids: res.data?.auto_rank_scrap_rarity_ids ?? [],
      }));
      toast.success('Options saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save options');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSelectOcEquipment = async (equipmentId) => {
    setSavingOcEquipment(true);
    try {
      await api.post('/organised-crime/equipment/select', { equipment_id: equipmentId });
      setSelectedOcEquipmentId(equipmentId);
      toast.success('OC equipment updated');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to set equipment');
    } finally {
      setSavingOcEquipment(false);
    }
  };

  const handleSaveInterval = async () => {
    const mainVal = parseInt(inputValue, 10);
    const bustVal = parseInt(inputValueBust, 10);
    const ocVal = parseInt(inputValueOc, 10);
    if (Number.isNaN(mainVal) || mainVal < MIN_INTERVAL) {
      toast.error(`Main interval must be at least ${MIN_INTERVAL}s`);
      return;
    }
    if (Number.isNaN(bustVal) || bustVal < MIN_BUST_INTERVAL) {
      toast.error(`Bust interval must be at least ${MIN_BUST_INTERVAL}s`);
      return;
    }
    if (Number.isNaN(ocVal) || ocVal < MIN_OC_INTERVAL) {
      toast.error(`OC interval must be at least ${MIN_OC_INTERVAL}s`);
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch('/auto-rank/interval', {
        interval_seconds: mainVal,
        interval_bust_seconds: bustVal,
        interval_oc_seconds: ocVal,
      });
      setIntervalSeconds(res.data.interval_seconds);
      setInputValue(String(res.data.interval_seconds));
      setIntervalBustSeconds(res.data.interval_bust_seconds);
      setInputValueBust(String(res.data.interval_bust_seconds));
      setIntervalOcSeconds(res.data.interval_oc_seconds);
      setInputValueOc(String(res.data.interval_oc_seconds));
      toast.success(res.data?.message ?? 'Saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleStartGlobal = async () => {
    setToggling(true);
    try {
      const res = await api.post('/auto-rank/start');
      setGlobalEnabled(res.data?.enabled !== false);
      toast.success(res.data?.message ?? 'Auto Rank started');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to start');
    } finally {
      setToggling(false);
    }
  };

  const handleStopGlobal = async () => {
    setToggling(true);
    try {
      const res = await api.post('/auto-rank/stop');
      setGlobalEnabled(res.data?.enabled !== false);
      toast.success(res.data?.message ?? 'Auto Rank stopped');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to stop');
    } finally {
      setToggling(false);
    }
  };

  const fetchInspect = async (username) => {
    if (!isAdmin) return;
    setInspectLoading(true);
    setInspectError('');
    try {
      const params = {};
      const uname = (username !== undefined ? username : inspectUsername).trim();
      if (uname) params.username = uname;
      const res = await api.get('/admin/auto-rank/user-inspect', { params });
      setInspectData(res.data || null);
      if (res.data?.user?.username) setInspectUsername(res.data.user.username);
    } catch (err) {
      setInspectData(null);
      setInspectError(err?.response?.data?.detail || err?.message || 'Inspect failed');
    } finally {
      setInspectLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) fetchInspect('');
  }, [isAdmin]);

  const fetchAdminUsers = (nextFilter) => {
    if (!isAdmin) return;
    const filter = nextFilter !== undefined ? nextFilter : adminUsersFilter;
    if (nextFilter !== undefined) setAdminUsersFilter(nextFilter);
    setAdminUsersLoading(true);
    api.get('/admin/auto-rank/users', { params: { online_only: filter === 'online_only' } })
      .then((r) => setAdminUsers(r.data?.users ?? []))
      .catch(() => setAdminUsers([]))
      .finally(() => setAdminUsersLoading(false));
  };

  const handleSaveUserChatId = async (username, newChatId) => {
    setSavingUser(username);
    try {
      await api.patch(`/admin/auto-rank/users/${encodeURIComponent(username)}`, { telegram_chat_id: newChatId || null });
      toast.success('Chat ID updated');
      setEditingChatId((p) => ({ ...p, [username]: false }));
      fetchAdminUsers();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to update');
    } finally {
      setSavingUser(null);
    }
  };

  const handleSaveUserToken = async (username, newToken) => {
    setSavingUser(username);
    try {
      await api.patch(`/admin/auto-rank/users/${encodeURIComponent(username)}`, { telegram_bot_token: newToken || null });
      toast.success('Bot token updated');
      setEditingToken((p) => ({ ...p, [username]: false }));
      fetchAdminUsers();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to update');
    } finally {
      setSavingUser(null);
    }
  };

  const handleDisableUser = async (username) => {
    setSavingUser(username);
    try {
      await api.patch(`/admin/auto-rank/users/${encodeURIComponent(username)}`, { auto_rank_enabled: false });
      toast.success(`${username}'s Auto Rank disabled`);
      fetchAdminUsers();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to disable');
    } finally {
      setSavingUser(null);
    }
  };

  const handleWipeUserTelegram = async (username) => {
    if (!window.confirm(`Clear Telegram (chat ID + bot token) for ${username}? They will need to re-link.`)) return;
    setSavingUser(username);
    try {
      await api.post(`/admin/auto-rank/users/${encodeURIComponent(username)}/wipe-telegram`);
      toast.success(`Telegram cleared for ${username}`);
      setEditingChatId((p) => ({ ...p, [username]: false }));
      setEditingToken((p) => ({ ...p, [username]: false }));
      fetchAdminUsers();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to wipe');
    } finally {
      setSavingUser(null);
    }
  };

  const handleWipeAllStats = async () => {
    if (!window.confirm('Wipe all Auto Rank stats for every user? Running time and all counters will reset. This cannot be undone.')) return;
    setWipingStats(true);
    try {
      const res = await api.post('/admin/auto-rank/wipe-stats');
      toast.success(res.data?.message ?? 'All auto rank stats wiped');
      const [statsRes] = await Promise.all([
        api.get('/auto-rank/stats').catch(() => ({ data: null })),
      ]);
      if (statsRes?.data) setStats(statsRes.data);
      fetchAdminUsers();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to wipe stats');
    } finally {
      setWipingStats(false);
    }
  };

  return (
    <div className={`min-h-[40vh] px-3 sm:px-4 max-w-4xl mx-auto space-y-3 sm:space-y-4 ${styles.pageContent} mobile-page-root`}>
      <style>{AR_STYLES}</style>
      
      {/* Page title - always visible so page is clearly present */}
      <div className="flex items-center gap-2 border-b pb-2" style={{ borderBottomColor: 'var(--gm-border)' }}>
        <Bot size={20} className="shrink-0" style={{ color: 'var(--gm-gold)' }} />
        <h1 className={`text-sm sm:text-base font-heading font-bold ${styles.gmTitle}`}>Auto Rank</h1>
      </div>
      
      {/* Page intro */}
      <div className="relative ar-fade-in">
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading italic">
          Automate crimes, GTA, busts, OC. Optional: set Telegram in Profile for notifications.
        </p>
      </div>

      <SetupCard
        canEnable={canEnable}
        hasTelegram={hasTelegram}
        telegramNotifyOn={prefs?.auto_rank_telegram_notify !== false}
        stripePurchasable={!!prefs?.auto_rank_stripe_purchasable}
        stripeLoading={autoRankStripeLoading}
        onBuyStripe={handleBuyAutoRankStripe}
        emailEntitled={!!prefs?.auto_rank_email_entitled}
      />

      {prefs?.auto_rank_trial && prefs?.auto_rank_trial_until && !prefs?.auto_rank_permanent && (
        <TrialBanner
          trialUntil={prefs.auto_rank_trial_until}
          dismissed={prefs.auto_rank_trial_dismissed}
          onDismiss={() => {
            setPrefs(p => ({ ...p, auto_rank_trial_dismissed: true }));
            api.patch('/auto-rank/me', { auto_rank_trial_dismissed: true }).catch(() => {});
          }}
        />
      )}
      
      {canEnable && (
        <AutoRankSummaryCard stats={stats} liveCountdown={liveCountdown} prefs={prefs} />
      )}
      
      <SettingsCard 
        prefs={prefs}
        canEnable={canEnable}
        savingPrefs={savingPrefs}
        onUpdatePref={updatePref}
        skipTokens={stats?.skip_tokens}
        hasUsableArSkips={stats?.has_usable_ar_skips}
      />
      
      {canEnable && (prefs?.auto_rank_crimes || prefs?.auto_rank_gta || prefs?.auto_rank_melt || prefs?.auto_rank_scrap) && (
        <CrimesGtaSettingsCard
          crimes={settingsData?.crimes ?? []}
          gtaOptions={settingsData?.gta_options ?? []}
          meltOptions={settingsData?.melt_options ?? { actions: [], rarities: [], scrap_rarities: [] }}
          selectedCrimeIds={selectedCrimeIds}
          selectedGtaIds={selectedGtaIds}
          selectedMeltActionIds={selectedMeltActionIds}
          selectedMeltRarityIds={selectedMeltRarityIds}
          selectedScrapRarityIds={selectedScrapRarityIds}
          onToggleCrime={toggleCrimeId}
          onToggleGta={toggleGtaId}
          onToggleMeltAction={toggleMeltActionId}
          onToggleMeltRarity={toggleMeltRarityId}
          onToggleScrapRarity={toggleScrapRarityId}
          onSelectAllCrimes={selectAllCrimes}
          onDeselectAllCrimes={deselectAllCrimes}
          onSelectAllGta={selectAllGta}
          onDeselectAllGta={deselectAllGta}
          onSelectAllMeltActions={selectAllMeltActions}
          onDeselectAllMeltActions={deselectAllMeltActions}
          onSelectAllMeltRarities={selectAllMeltRarities}
          onDeselectAllMeltRarities={deselectAllMeltRarities}
          onSelectAllScrapRarities={selectAllScrapRarities}
          onDeselectAllScrapRarities={deselectAllScrapRarities}
          onSaveSettings={handleSaveSettings}
          savingSettings={savingSettings}
          crimesDisabled={savingPrefs || !prefs?.auto_rank_enabled}
          gtaDisabled={savingPrefs || !prefs?.auto_rank_enabled}
          meltDisabled={savingPrefs || !prefs?.auto_rank_enabled}
          scrapDisabled={savingPrefs || !prefs?.auto_rank_enabled}
        />
      )}

      {canEnable && prefs?.auto_rank_oc && (
        <OCOptionsCard
          equipment={ocEquipment}
          selectedId={selectedOcEquipmentId}
          saving={savingOcEquipment}
          onSelect={handleSelectOcEquipment}
        />
      )}
      
      {canEnable && <StatsCard stats={stats} liveCountdown={liveCountdown} />}

      {/* ─── Admin (all admin controls at bottom) ─── */}
      {isAdmin && (
        <>
          <div className="pt-4 sm:pt-6 border-t border-zinc-700/50">
            <h2 className="text-xs sm:text-sm font-heading font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2 mb-3">
              <Shield size={16} className="text-primary" />
              Admin
            </h2>
          </div>
          <div ref={adminDiagRef}>
          <AdminDiagnosticsPanel
            inspectData={inspectData}
            inspectLoading={inspectLoading}
            inspectError={inspectError}
            inspectUsername={inspectUsername}
            setInspectUsername={setInspectUsername}
            onLoad={() => fetchInspect()}
            onRefresh={() => fetchInspect(inspectData?.user?.username || inspectUsername)}
          />
          </div>

          <AdminGlobalLoopCard
            globalEnabled={globalEnabled}
            intervalSeconds={intervalSeconds}
            intervalBustSeconds={intervalBustSeconds}
            intervalOcSeconds={intervalOcSeconds}
            inputValue={inputValue}
            inputValueBust={inputValueBust}
            inputValueOc={inputValueOc}
            setInputValue={setInputValue}
            setInputValueBust={setInputValueBust}
            setInputValueOc={setInputValueOc}
            saving={saving}
            toggling={toggling}
            onStart={handleStartGlobal}
            onStop={handleStopGlobal}
            onSave={handleSaveInterval}
          />

          {/* Admin Users Table */}
          <div className={`relative rounded-lg overflow-hidden ar-fade-in ${styles.panel} mobile-panel`} style={{ animationDelay: '0.4s' }}>
          <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader} flex items-center justify-between gap-2 flex-wrap`}>
            <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Users size={14} className="sm:w-4 sm:h-4" />
              Auto Rank Users (Alive)
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleWipeAllStats}
                disabled={wipingStats}
                className="px-2 py-1 sm:py-1.5 rounded bg-red-500/20 border border-red-500/50 text-red-400 font-heading text-[9px] sm:text-[10px] font-bold hover:bg-red-500/30 disabled:opacity-50 transition-all active:scale-95"
                title="Wipe all auto rank stats"
              >
                {wipingStats ? 'Wiping…' : 'Wipe Stats'}
              </button>
              <button
                type="button"
                onClick={() => fetchAdminUsers()}
                disabled={adminUsersLoading}
                className="p-1 sm:p-1.5 rounded bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 disabled:opacity-50 transition-all active:scale-95"
                title="Refresh"
              >
                <RefreshCw size={12} className={`sm:w-3.5 sm:h-3.5 ${adminUsersLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          
          <div className="p-2.5 sm:p-3 md:p-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
              <span className="text-[9px] sm:text-[10px] font-heading text-zinc-400">Filter:</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => fetchAdminUsers('all')}
                  className={`px-2 py-1 rounded text-[9px] sm:text-[10px] font-heading font-bold border transition-all ${
                    adminUsersFilter === 'all' 
                      ? 'bg-primary/20 border-primary/50 text-primary' 
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-foreground'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => fetchAdminUsers('online_only')}
                  className={`px-2 py-1 rounded text-[9px] sm:text-[10px] font-heading font-bold border transition-all ${
                    adminUsersFilter === 'online_only' 
                      ? 'bg-primary/20 border-primary/50 text-primary' 
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-foreground'
                  }`}
                >
                  Online
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-heading text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideOffline}
                  onChange={(e) => setHideOffline(e.target.checked)}
                  className="rounded border-zinc-600"
                />
                Hide offline
              </label>
            </div>
            
            <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading mb-3">
              Alive users who purchased Auto Rank. Edit Telegram settings per user; Disable turns off their automation.
            </p>
            
            {adminUsersLoading ? (
              <p className="text-xs text-zinc-400 font-heading">Loading...</p>
            ) : (() => {
              const displayed = hideOffline && adminUsersFilter === 'all' ? adminUsers.filter((u) => u.online) : adminUsers;
              return displayed.length === 0 ? (
                <p className="text-xs text-zinc-400 font-heading">
                  {adminUsersFilter === 'online_only' ? 'No online users with Auto Rank.' : hideOffline ? 'No online users to show.' : 'No users with Auto Rank purchased.'}
                </p>
              ) : (
                <div className="overflow-x-auto -mx-2.5 sm:-mx-3 md:-mx-4 px-2.5 sm:px-3 md:px-4">
                  <table className="w-full text-left border-collapse text-[10px] sm:text-xs font-heading">
                    <thead>
                      <tr className="border-b border-zinc-700/50">
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">User</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">●</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">On</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">Cr</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">GT</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">B5</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">OC</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">Bz</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">Chat</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">Token</th>
                        <th className="py-2 pr-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">Diag</th>
                        <th className="py-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">Act</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayed.map((u) => (
                        <tr key={u.id || u.username} className="border-b border-zinc-700/30 hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2 pr-2 text-foreground font-medium">{u.username}</td>
                          <td className="py-2 pr-2">
                            <span className={u.auto_rank_idle ? 'text-amber-400' : u.online ? 'text-emerald-400' : 'text-zinc-600'}>
                              {u.auto_rank_idle ? '●' : u.online ? '●' : '○'}
                            </span>
                          </td>
                          <td className="py-2 pr-2">
                            <span className={u.auto_rank_enabled ? 'text-emerald-400' : 'text-zinc-500'}>
                              {u.auto_rank_enabled ? 'Y' : 'N'}
                            </span>
                          </td>
                          <td className="py-2 pr-2 text-zinc-400">{u.auto_rank_crimes ? '✓' : '–'}</td>
                          <td className="py-2 pr-2 text-zinc-400">{u.auto_rank_gta ? '✓' : '–'}</td>
                          <td className="py-2 pr-2 text-zinc-400">{u.auto_rank_bust_every_5_sec ? '✓' : '–'}</td>
                          <td className="py-2 pr-2 text-zinc-400">{u.auto_rank_oc ? '✓' : '–'}</td>
                          <td className="py-2 pr-2 text-zinc-400">{u.auto_rank_booze ? '✓' : '–'}</td>
                          <td className="py-2 pr-2">
                            {editingChatId[u.username] ? (
                              <div className="flex gap-1 items-center">
                                <input
                                  type="text"
                                  defaultValue={u.telegram_chat_id}
                                  id={`chat-${u.username}`}
                                  placeholder="ID"
                                  className="w-20 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-foreground text-[9px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const val = document.getElementById(`chat-${u.username}`)?.value ?? '';
                                    handleSaveUserChatId(u.username, val.trim() || null);
                                  }}
                                  disabled={savingUser === u.username}
                                  className="px-1.5 py-0.5 rounded bg-primary/20 border border-primary/50 text-primary text-[8px] font-bold disabled:opacity-50"
                                >
                                  {savingUser === u.username ? '...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingChatId((p) => ({ ...p, [u.username]: false }))}
                                  className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 text-[8px]"
                                >
                                  ×
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <span className="text-zinc-400 font-mono text-[9px]">{u.telegram_chat_id || '—'}</span>
                                <button
                                  type="button"
                                  onClick={() => setEditingChatId((p) => ({ ...p, [u.username]: true }))}
                                  className="p-0.5 rounded text-primary hover:bg-primary/20"
                                >
                                  <Edit2 size={10} />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            {editingToken[u.username] ? (
                              <div className="flex gap-1 items-center">
                                <input
                                  type="password"
                                  defaultValue={u.telegram_bot_token}
                                  id={`token-${u.username}`}
                                  placeholder="Token"
                                  className="w-24 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-foreground text-[9px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const val = document.getElementById(`token-${u.username}`)?.value ?? '';
                                    handleSaveUserToken(u.username, val.trim() || null);
                                  }}
                                  disabled={savingUser === u.username}
                                  className="px-1.5 py-0.5 rounded bg-primary/20 border border-primary/50 text-primary text-[8px] font-bold disabled:opacity-50"
                                >
                                  {savingUser === u.username ? '...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingToken((p) => ({ ...p, [u.username]: false }))}
                                  className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 text-[8px]"
                                >
                                  ×
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <span className="text-zinc-400 font-mono text-[9px]">{u.telegram_bot_token ? '•••' : '—'}</span>
                                <button
                                  type="button"
                                  onClick={() => setEditingToken((p) => ({ ...p, [u.username]: true }))}
                                  className="p-0.5 rounded text-primary hover:bg-primary/20"
                                >
                                  <Edit2 size={10} />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            <button
                              type="button"
                              onClick={async () => {
                                setInspectUsername(u.username);
                                await fetchInspect(u.username);
                                adminDiagRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }}
                              className="px-1.5 py-0.5 rounded bg-primary/15 border border-primary/40 text-primary text-[8px] font-bold hover:bg-primary/25"
                              title="Load staff diagnostics for this user"
                            >
                              View
                            </button>
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              {(u.telegram_chat_id || u.telegram_bot_token) && (
                                <button
                                  type="button"
                                  onClick={() => handleWipeUserTelegram(u.username)}
                                  disabled={savingUser === u.username}
                                  title="Clear chat ID and bot token"
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[8px] sm:text-[9px] font-bold hover:bg-amber-500/30 disabled:opacity-50 transition-all active:scale-95"
                                >
                                  Wipe
                                </button>
                              )}
                              {u.auto_rank_enabled && (
                                <button
                                  type="button"
                                  onClick={() => handleDisableUser(u.username)}
                                  disabled={savingUser === u.username}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/50 text-red-400 text-[8px] sm:text-[9px] font-bold hover:bg-red-500/30 disabled:opacity-50 transition-all active:scale-95"
                                >
                                  <Ban size={9} />
                                  Off
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
