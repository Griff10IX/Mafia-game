import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Clock, Play, Square, Shield, Car, Crosshair, Lock, Users, Edit2, Ban, RefreshCw, BarChart3, TrendingUp, Briefcase, Wine, DollarSign, MessageSquare, Activity, Settings2 } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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

/* ═══════════════════════════════════════════════════════
   Loading Spinner
   ═══════════════════════════════════════════════════════ */
const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-zinc-300">
    <Bot size={28} className="text-primary/60 animate-pulse" />
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-[9px] sm:text-[10px] font-heading uppercase tracking-[0.3em]">Loading…</span>
  </div>
);

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
  <div className="rounded bg-zinc-800/50 border border-zinc-700/40 p-2 sm:p-3 text-center">
    <div className={`text-base sm:text-lg font-heading font-bold ${valueColor}`}>
      {value}
    </div>
    <div className="text-[9px] sm:text-[10px] font-heading text-zinc-400 uppercase tracking-wider flex items-center justify-center gap-1 mt-0.5">
      {Icon && <Icon size={10} className="sm:w-3 sm:h-3" />}
      {label}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Setup & Status Card
   ═══════════════════════════════════════════════════════ */
const SetupCard = ({ canEnable, hasTelegram }) => (
  <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ar-fade-in">
    <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none pulse-glow" />
    
    <div className="relative px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
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
              <Link to="/profile" className="underline font-bold text-primary hover:text-primary/80">
                Profile → Settings
              </Link>{' '}
              (get ID from <span className="font-mono text-primary">@userinfobot</span>)
            </p>
          </div>
        </div>
      )}
      
      {!canEnable && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 sm:p-2.5">
          <div className="flex items-start gap-2">
            <Lock size={14} className="text-amber-400 shrink-0 mt-0.5 sm:w-4 sm:h-4" />
            <p className="text-[10px] sm:text-xs font-heading text-zinc-300 leading-relaxed">
              Purchase Auto Rank in the{' '}
              <Link to="/store" className="text-primary underline font-bold hover:text-primary/80">
                Store
              </Link>{' '}
              to enable automation
            </p>
          </div>
        </div>
      )}
      
      {canEnable && hasTelegram && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 sm:p-2.5">
          <div className="flex items-start gap-2">
            <MessageSquare size={14} className="text-emerald-400 shrink-0 mt-0.5 sm:w-4 sm:h-4" />
            <p className="text-[10px] sm:text-xs font-heading text-zinc-300">
              ✓ Telegram configured — you'll receive success notifications
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
const SettingsCard = ({ prefs, canEnable, savingPrefs, onUpdatePref }) => {
  const p = prefs || {};
  return (
  <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ar-fade-in" style={{ animationDelay: '0.1s' }}>
    <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
      <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">
        Your Settings
      </h2>
    </div>
    
    <div className="p-2.5 sm:p-3 space-y-0.5">
      <ToggleRow
        icon={Bot}
        label="Enable Auto Rank"
        description="Master switch. Sends Telegram notifications on success (when configured)"
        checked={p.auto_rank_enabled}
        disabled={savingPrefs || (p.auto_rank_enabled ? false : !canEnable)}
        onToggle={() => onUpdatePref('auto_rank_enabled', !p.auto_rank_enabled)}
      />
      
      <div className="py-1.5 px-0">
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
          <strong className="text-zinc-300">Cycle:</strong> busts → crimes → GTA. OC runs on its own timer.
        </p>
      </div>
      
      <ToggleRow
        icon={Crosshair}
        label="Run crimes"
        description="Auto-commit crimes per cycle"
        checked={p.auto_rank_enabled ? p.auto_rank_crimes : false}
        disabled={savingPrefs || !p.auto_rank_enabled || p.auto_rank_bust_every_5_sec}
        onToggle={() => onUpdatePref('auto_rank_crimes', !p.auto_rank_crimes)}
      />
      
      <ToggleRow
        icon={Car}
        label="Run GTA"
        description="One theft per cycle when cooldown ready"
        checked={p.auto_rank_enabled ? p.auto_rank_gta : false}
        disabled={savingPrefs || !p.auto_rank_enabled || p.auto_rank_bust_every_5_sec}
        onToggle={() => onUpdatePref('auto_rank_gta', !p.auto_rank_gta)}
      />
      
      <ToggleRow
        icon={Lock}
        label="Jail bust every 5 sec"
        description="Bust every 5s; only jail busts (no crimes or GTA)"
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
        icon={Wine}
        label="Run booze running"
        description="Buy, travel, sell on round-trip route"
        checked={p.auto_rank_enabled ? p.auto_rank_booze : false}
        disabled={savingPrefs || !p.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_booze', !p.auto_rank_booze)}
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
  selectedCrimeIds,
  selectedGtaIds,
  onToggleCrime,
  onToggleGta,
  onSelectAllCrimes,
  onDeselectAllCrimes,
  onSelectAllGta,
  onDeselectAllGta,
  onSaveSettings,
  savingSettings,
  crimesDisabled,
  gtaDisabled,
}) => (
  <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ar-fade-in" style={{ animationDelay: '0.2s' }}>
    <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
      <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Settings2 size={14} className="sm:w-4 sm:h-4" />
        Crimes & GTA options
      </h2>
    </div>
    <div className="p-2.5 sm:p-3 space-y-4">
      <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
        Choose which crimes and GTA options to run. Empty = all. Save to apply.
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
              sub={`Rank ${c.min_rank}`}
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
  const activeCrimes = enabled && prefs?.auto_rank_crimes && !prefs?.auto_rank_bust_every_5_sec;
  const activeGta = enabled && prefs?.auto_rank_gta && !prefs?.auto_rank_bust_every_5_sec;
  const activeBust5 = enabled && prefs?.auto_rank_bust_every_5_sec;
  const activeOc = enabled && prefs?.auto_rank_oc;
  const activeBooze = enabled && prefs?.auto_rank_booze;
  // "Next up" = only Cycle, OC, Booze (when the server actually runs). Don't use Crimes/GTA cooldowns —
  // those are per-action; the cycle runs on next_run_at, so "Next up" must match "Next cycle" countdown.
  const items = [];
  if (!stats?.in_jail && liveCountdown?.nextCycleSeconds != null && (activeCrimes || activeGta)) items.push({ label: 'Cycle', sec: liveCountdown.nextCycleSeconds });
  if (activeOc && liveCountdown?.nextOcSeconds != null) items.push({ label: 'OC', sec: liveCountdown.nextOcSeconds });
  if (activeBooze && liveCountdown?.nextBoozeSeconds != null) items.push({ label: 'Booze', sec: liveCountdown.nextBoozeSeconds });
  const nextUp = items.filter((x) => x.sec !== null && x.sec >= 0).sort((a, b) => a.sec - b.sec)[0];

  return (
    <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ar-fade-in" style={{ animationDelay: '0.15s' }}>
      <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20 flex flex-wrap items-center justify-between gap-2">
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
              {activeBust5 && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">Bust 5s</span>}
              {activeOc && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">OC</span>}
              {activeBooze && <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[9px] font-heading text-zinc-300">Booze</span>}
              {!activeCrimes && !activeGta && !activeBust5 && !activeOc && !activeBooze && (
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
              <div className="text-[10px] sm:text-xs font-heading text-emerald-400/90">
                Successful today: {stats.successful_crimes_today ?? 0} crimes, {stats.successful_gtas_today ?? 0} GTAs, {stats.successful_busts_today ?? 0} busts
              </div>
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
                {prefs?.auto_rank_crimes && !prefs?.auto_rank_bust_every_5_sec && (
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">Crimes</span>
                    <span className="text-foreground font-medium tabular-nums">{liveLine(liveCountdown?.nextCrimeSeconds)}</span>
                  </div>
                )}
                {prefs?.auto_rank_gta && !prefs?.auto_rank_bust_every_5_sec && (
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">GTA</span>
                    <span className="text-foreground font-medium tabular-nums">{liveLine(liveCountdown?.nextGtaSeconds)}</span>
                  </div>
                )}
                {prefs?.auto_rank_booze && (
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">Booze</span>
                    <span className="text-foreground font-medium tabular-nums">{liveLine(liveCountdown?.nextBoozeSeconds)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2 col-span-full sm:col-span-1">
                  <span className="text-zinc-500">Cycle interval</span>
                  <span className="text-foreground font-medium">{interval}s</span>
                </div>
              </div>
            </div>
            <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading leading-relaxed ">
              <strong className="text-zinc-400">Cycle order:</strong> busts → crimes → GTA. <strong className="text-zinc-400">OC</strong> and <strong className="text-zinc-400">booze</strong> run on their own timers. Interval: {interval}s; in jail, cycles pause until you’re out.
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
    <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ar-fade-in" style={{ animationDelay: '0.2s' }}>
      <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
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
  const bestCars = (Array.isArray(s.best_cars) ? s.best_cars : []).filter((car) => car && typeof car === 'object');

  return (
    <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ar-fade-in" style={{ animationDelay: '0.2s' }}>
      <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard label="Busts" value={totalBusts.toLocaleString()} icon={Lock} />
          <StatCard label="Crimes" value={totalCrimes.toLocaleString()} icon={Crosshair} />
          <StatCard label="GTAs" value={totalGtas.toLocaleString()} icon={Car} />
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
  <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ar-fade-in" style={{ animationDelay: '0.3s' }}>
    <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
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
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [prefs, setPrefs] = useState({
    auto_rank_enabled: false,
    auto_rank_crimes: true,
    auto_rank_gta: true,
    auto_rank_bust_every_5_sec: false,
    auto_rank_oc: false,
    auto_rank_booze: false,
    auto_rank_purchased: false,
    telegram_chat_id_set: false,
    auto_rank_crime_ids: [],
    auto_rank_gta_option_ids: [],
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [settingsData, setSettingsData] = useState({ crimes: [], gta_options: [], auto_rank_crime_ids: [], auto_rank_gta_option_ids: [] });
  const [selectedCrimeIds, setSelectedCrimeIds] = useState([]);
  const [selectedGtaIds, setSelectedGtaIds] = useState([]);
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
  const [stats, setStats] = useState({
    total_busts: 0,
    total_crimes: 0,
    total_gtas: 0,
    total_cash: 0,
    running_seconds: 0,
    best_cars: [],
    total_booze_runs: 0,
    total_booze_profit: 0,
    next_oc_at: null,
    in_jail: false,
    jail_seconds_remaining: null,
    jail_until: null,
    auto_rank_next_run_at: null,
    interval_seconds: 30,
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
  });
  const [liveCountdown, setLiveCountdown] = useState({
    jailSeconds: null,
    nextCycleSeconds: null,
    nextOcSeconds: null,
    nextCrimeSeconds: null,
    nextGtaSeconds: null,
    nextBoozeSeconds: null,
  });
  const [lastStatsAt, setLastStatsAt] = useState(null);
  const prevJailSecondsRef = useRef(null);

  // Derived once per render, before any early return, so useEffects can read them
  const canEnable = Boolean(prefs?.auto_rank_purchased);
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
      // When jail countdown just hit 0, refetch so "In jail — cycles paused" updates to "Running" right away
      const prev = prevJailSecondsRef.current;
      if (prev != null && prev > 0 && (jailSeconds === null || jailSeconds === 0) && refetchStatsRef.current) {
        refetchStatsRef.current();
      }
      prevJailSecondsRef.current = jailSeconds;
      setLiveCountdown((prev) => {
        if (prev.jailSeconds === jailSeconds && prev.nextCycleSeconds === nextCycleSeconds && prev.nextOcSeconds === nextOcSeconds &&
            prev.nextCrimeSeconds === nextCrimeSeconds && prev.nextGtaSeconds === nextGtaSeconds && prev.nextBoozeSeconds === nextBoozeSeconds) return prev;
        return { jailSeconds, nextCycleSeconds, nextOcSeconds, nextCrimeSeconds, nextGtaSeconds, nextBoozeSeconds };
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [stats?.jail_until, stats?.auto_rank_next_run_at, stats?.next_oc_at, stats?.next_crime_at, stats?.next_gta_at, stats?.next_booze_arrival_at]);

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
          next_oc_at: d.next_oc_at ?? null,
          in_jail: d.in_jail === true,
          jail_seconds_remaining: d.jail_seconds_remaining ?? null,
          jail_until: d.jail_until ?? null,
          auto_rank_next_run_at: d.auto_rank_next_run_at ?? null,
          interval_seconds: d.interval_seconds ?? prev.interval_seconds,
          next_crime_at: d.next_crime_at ?? null,
          next_gta_at: d.next_gta_at ?? null,
          next_booze_arrival_at: d.next_booze_arrival_at ?? null,
          activity_detail: d.activity_detail ?? null,
          last_activity: d.last_activity ?? null,
          last_activity_at: d.last_activity_at ?? null,
          failed_crimes_today: d.failed_crimes_today ?? 0,
          failed_gtas_today: d.failed_gtas_today ?? 0,
          failed_busts_today: d.failed_busts_today ?? 0,
          successful_crimes_today: d.successful_crimes_today ?? 0,
          successful_gtas_today: d.successful_gtas_today ?? 0,
          successful_busts_today: d.successful_busts_today ?? 0,
        }));
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
          api.get('/admin/check').catch(() => ({ data: {} })),
          api.get('/auto-rank/interval').catch(() => ({ data: null })),
          api.get('/auto-rank/stats').catch(() => ({ data: null })),
        ]);
        setIsAdmin(!!checkRes.data?.is_admin);
        if (meRes?.data) {
          setPrefs({
            auto_rank_enabled: meRes.data.auto_rank_enabled === true,
            auto_rank_crimes: meRes.data.auto_rank_crimes !== false,
            auto_rank_gta: meRes.data.auto_rank_gta !== false,
            auto_rank_bust_every_5_sec: !!meRes.data.auto_rank_bust_every_5_sec,
            auto_rank_oc: !!meRes.data.auto_rank_oc,
            auto_rank_booze: !!meRes.data.auto_rank_booze,
            auto_rank_purchased: !!meRes.data.auto_rank_purchased,
            telegram_chat_id_set: !!meRes.data.telegram_chat_id_set,
            auto_rank_crime_ids: meRes.data.auto_rank_crime_ids ?? [],
            auto_rank_gta_option_ids: meRes.data.auto_rank_gta_option_ids ?? [],
          });
        }
        const hasFeature = meRes?.data?.auto_rank_purchased || meRes?.data?.auto_rank_enabled;
        if (hasFeature) {
          api.get('/auto-rank/settings').then((res) => {
            const d = res.data || {};
            const crimes = d.crimes || [];
            const gtaOptions = d.gta_options || [];
            const crimeIds = d.auto_rank_crime_ids ?? [];
            const gtaIds = d.auto_rank_gta_option_ids ?? [];
            setSettingsData({ crimes, gta_options: gtaOptions, auto_rank_crime_ids: crimeIds, auto_rank_gta_option_ids: gtaIds });
            setSelectedCrimeIds(crimeIds.length === 0 ? (crimes || []).map((c) => c?.id).filter(Boolean) : crimeIds);
            setSelectedGtaIds(gtaIds.length === 0 ? (gtaOptions || []).map((o) => o?.id).filter(Boolean) : gtaIds);
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
            next_oc_at: statsRes.data.next_oc_at ?? null,
            in_jail: statsRes.data.in_jail === true,
            jail_seconds_remaining: statsRes.data.jail_seconds_remaining ?? null,
            jail_until: statsRes.data.jail_until ?? null,
            auto_rank_next_run_at: statsRes.data.auto_rank_next_run_at ?? null,
            interval_seconds: statsRes.data.interval_seconds ?? 30,
            next_crime_at: statsRes.data.next_crime_at ?? null,
            next_gta_at: statsRes.data.next_gta_at ?? null,
            next_booze_arrival_at: statsRes.data.next_booze_arrival_at ?? null,
            activity_detail: statsRes.data.activity_detail ?? null,
            last_activity: statsRes.data.last_activity ?? null,
            last_activity_at: statsRes.data.last_activity_at ?? null,
            failed_crimes_today: statsRes.data.failed_crimes_today ?? 0,
            failed_gtas_today: statsRes.data.failed_gtas_today ?? 0,
            failed_busts_today: statsRes.data.failed_busts_today ?? 0,
            successful_crimes_today: statsRes.data.successful_crimes_today ?? 0,
            successful_gtas_today: statsRes.data.successful_gtas_today ?? 0,
            successful_busts_today: statsRes.data.successful_busts_today ?? 0,
            attempted_busts_today: statsRes.data.attempted_busts_today ?? 0,
          });
          setLastStatsAt(Date.now());
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
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const updatePref = async (key, value) => {
    setSavingPrefs(true);
    try {
      const payload = { [key]: value };
      const res = await api.patch('/auto-rank/me', payload);
      setPrefs((p) => ({
        ...p,
        auto_rank_enabled: res.data?.auto_rank_enabled ?? p.auto_rank_enabled,
        auto_rank_crimes: res.data?.auto_rank_crimes ?? p.auto_rank_crimes,
        auto_rank_gta: res.data?.auto_rank_gta ?? p.auto_rank_gta,
        auto_rank_bust_every_5_sec: res.data?.auto_rank_bust_every_5_sec ?? p.auto_rank_bust_every_5_sec,
        auto_rank_oc: res.data?.auto_rank_oc ?? p.auto_rank_oc,
        auto_rank_booze: res.data?.auto_rank_booze ?? p.auto_rank_booze,
        auto_rank_crime_ids: res.data?.auto_rank_crime_ids ?? p.auto_rank_crime_ids,
        auto_rank_gta_option_ids: res.data?.auto_rank_gta_option_ids ?? p.auto_rank_gta_option_ids,
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
  const selectAllCrimes = () => setSelectedCrimeIds((settingsData?.crimes ?? []).map((c) => c?.id).filter(Boolean));
  const deselectAllCrimes = () => setSelectedCrimeIds([]);
  const selectAllGta = () => setSelectedGtaIds((settingsData?.gta_options ?? []).map((o) => o?.id).filter(Boolean));
  const deselectAllGta = () => setSelectedGtaIds([]);
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const crimes = settingsData.crimes || [];
      const gtaOptions = settingsData.gta_options || [];
      const crimePayload = selectedCrimeIds.length === crimes.length ? [] : selectedCrimeIds;
      const gtaPayload = selectedGtaIds.length === gtaOptions.length ? [] : selectedGtaIds;
      const res = await api.patch('/auto-rank/me', { auto_rank_crime_ids: crimePayload, auto_rank_gta_option_ids: gtaPayload });
      setPrefs((p) => ({ ...p, auto_rank_crime_ids: res.data?.auto_rank_crime_ids ?? [], auto_rank_gta_option_ids: res.data?.auto_rank_gta_option_ids ?? [] }));
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

  if (loading) {
    return (
      <div className="min-h-[40vh] px-3 sm:px-4 max-w-4xl mx-auto bg-zinc-900 text-zinc-100">
        <style>{AR_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-[40vh] px-3 sm:px-4 max-w-4xl mx-auto space-y-3 sm:space-y-4 bg-zinc-900 text-zinc-100">
      <style>{AR_STYLES}</style>
      
      {/* Page title - always visible so page is clearly present */}
      <div className="flex items-center gap-2 border-b border-zinc-700/50 pb-2">
        <Bot size={20} className="text-amber-500 shrink-0" />
        <h1 className="text-sm sm:text-base font-heading font-bold text-zinc-100">Auto Rank</h1>
      </div>
      
      {/* Page intro */}
      <div className="relative ar-fade-in">
        <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading italic">
          Automate crimes, GTA, busts, OC. Optional: set Telegram in Profile for notifications.
        </p>
      </div>

      <SetupCard canEnable={canEnable} hasTelegram={hasTelegram} />
      
      {canEnable && (
        <AutoRankSummaryCard stats={stats} liveCountdown={liveCountdown} prefs={prefs} />
      )}
      
      <SettingsCard 
        prefs={prefs}
        canEnable={canEnable}
        savingPrefs={savingPrefs}
        onUpdatePref={updatePref}
      />
      
      {canEnable && (prefs?.auto_rank_crimes || prefs?.auto_rank_gta) && (
        <CrimesGtaSettingsCard
          crimes={settingsData?.crimes ?? []}
          gtaOptions={settingsData?.gta_options ?? []}
          selectedCrimeIds={selectedCrimeIds}
          selectedGtaIds={selectedGtaIds}
          onToggleCrime={toggleCrimeId}
          onToggleGta={toggleGtaId}
          onSelectAllCrimes={selectAllCrimes}
          onDeselectAllCrimes={deselectAllCrimes}
          onSelectAllGta={selectAllGta}
          onDeselectAllGta={deselectAllGta}
          onSaveSettings={handleSaveSettings}
          savingSettings={savingSettings}
          crimesDisabled={savingPrefs || !prefs?.auto_rank_enabled || prefs?.auto_rank_bust_every_5_sec}
          gtaDisabled={savingPrefs || !prefs?.auto_rank_enabled || prefs?.auto_rank_bust_every_5_sec}
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
          <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ar-fade-in" style={{ animationDelay: '0.4s' }}>
          <div className="px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20 flex items-center justify-between gap-2 flex-wrap">
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
                        <th className="py-2 font-bold text-zinc-400 uppercase text-[8px] sm:text-[9px]">Act</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayed.map((u) => (
                        <tr key={u.id || u.username} className="border-b border-zinc-700/30 hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2 pr-2 text-foreground font-medium">{u.username}</td>
                          <td className="py-2 pr-2">
                            <span className={u.online ? 'text-emerald-400' : 'text-zinc-600'}>
                              {u.online ? '●' : '○'}
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
                          <td className="py-2">
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
