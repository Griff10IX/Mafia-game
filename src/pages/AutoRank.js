import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Clock, Play, Square, Shield, Car, Crosshair, Lock, Users, Edit2, Ban, RefreshCw, BarChart3, TrendingUp, Briefcase, Wine, DollarSign, MessageSquare } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

const MIN_INTERVAL = 5;

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

/* ═══════════════════════════════════════════════════════
   Loading Spinner
   ═══════════════════════════════════════════════════════ */
const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
    <Bot size={28} className="text-primary/40 animate-pulse" />
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[9px] sm:text-[10px] font-heading uppercase tracking-[0.3em]">Loading…</span>
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
const SettingsCard = ({ prefs, canEnable, savingPrefs, onUpdatePref }) => (
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
        checked={prefs.auto_rank_enabled}
        disabled={savingPrefs || (prefs.auto_rank_enabled ? false : !canEnable)}
        onToggle={() => onUpdatePref('auto_rank_enabled', !prefs.auto_rank_enabled)}
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
        checked={prefs.auto_rank_enabled ? prefs.auto_rank_crimes : false}
        disabled={savingPrefs || !prefs.auto_rank_enabled || prefs.auto_rank_bust_every_5_sec}
        onToggle={() => onUpdatePref('auto_rank_crimes', !prefs.auto_rank_crimes)}
      />
      
      <ToggleRow
        icon={Car}
        label="Run GTA"
        description="One theft per cycle when cooldown ready"
        checked={prefs.auto_rank_enabled ? prefs.auto_rank_gta : false}
        disabled={savingPrefs || !prefs.auto_rank_enabled || prefs.auto_rank_bust_every_5_sec}
        onToggle={() => onUpdatePref('auto_rank_gta', !prefs.auto_rank_gta)}
      />
      
      <ToggleRow
        icon={Lock}
        label="Jail bust every 5 sec"
        description="Bust every 5s; when jail empty, runs crimes + GTA instead"
        checked={prefs.auto_rank_enabled ? prefs.auto_rank_bust_every_5_sec : false}
        disabled={savingPrefs || !prefs.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_bust_every_5_sec', !prefs.auto_rank_bust_every_5_sec)}
      />
      
      <ToggleRow
        icon={Briefcase}
        label="Run Organised Crime (NPC)"
        description="Heist with you + 3 NPCs when OC cooldown ready"
        checked={prefs.auto_rank_enabled ? prefs.auto_rank_oc : false}
        disabled={savingPrefs || !prefs.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_oc', !prefs.auto_rank_oc)}
      />
      
      <ToggleRow
        icon={Wine}
        label="Run booze running"
        description="Buy, travel, sell on round-trip route"
        checked={prefs.auto_rank_enabled ? prefs.auto_rank_booze : false}
        disabled={savingPrefs || !prefs.auto_rank_enabled}
        onToggle={() => onUpdatePref('auto_rank_booze', !prefs.auto_rank_booze)}
      />
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Stats Card
   ═══════════════════════════════════════════════════════ */
const StatsCard = ({ stats }) => {
  const { text: ocText, at: ocAt } = formatNextOcAt(stats.next_oc_at);
  
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
          <StatCard label="Busts" value={stats.total_busts.toLocaleString()} icon={Lock} />
          <StatCard label="Crimes" value={stats.total_crimes.toLocaleString()} icon={Crosshair} />
          <StatCard label="GTAs" value={stats.total_gtas.toLocaleString()} icon={Car} />
          <StatCard 
            label="Cash Made" 
            value={`$${stats.total_cash.toLocaleString()}`} 
            valueColor="text-emerald-400"
            icon={DollarSign}
          />
        </div>
        
        {/* Additional stats */}
        <div className="space-y-1.5 pt-2 border-t border-zinc-700/30">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-heading">
            <Clock size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
            <span className="text-zinc-400">Running:</span>
            <span className="text-foreground font-medium">{formatRunningTime(stats.running_seconds)}</span>
          </div>
          
          <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-heading">
            <Briefcase size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
            <span className="text-zinc-400">Next OC:</span>
            <span className="text-foreground font-medium">
              {ocAt ? `in ${ocText} (at ${ocAt})` : ocText}
            </span>
          </div>
          
          {(stats.total_booze_runs > 0 || stats.total_booze_profit > 0) && (
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-heading">
              <Wine size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
              <span className="text-zinc-400">Booze:</span>
              <span className="text-foreground font-medium">{stats.total_booze_runs.toLocaleString()} runs</span>
              <span className="text-zinc-600">·</span>
              <span className="text-emerald-400 font-medium">${(stats.total_booze_profit ?? 0).toLocaleString()}</span>
            </div>
          )}
        </div>
        
        {/* Best cars */}
        {stats.best_cars && stats.best_cars.length > 0 && (
          <div className="pt-2 border-t border-zinc-700/30">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp size={12} className="text-primary sm:w-3.5 sm:h-3.5" />
              <span className="text-[9px] sm:text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-wider">
                Top 3 Cars Stolen
              </span>
            </div>
            <div className="space-y-1">
              {stats.best_cars.map((car, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] sm:text-xs bg-zinc-800/40 rounded px-2 py-1">
                  <span className="text-foreground font-medium">{car.name}</span>
                  <span className="text-emerald-400 font-mono font-medium">${(car.value || 0).toLocaleString()}</span>
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
  inputValue,
  setInputValue,
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
        The server runs one cycle for all users with Auto Rank enabled, then waits this interval before repeating. Start/Stop controls the loop.
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
      
      {/* Interval Control */}
      <div>
        <label className="text-[9px] sm:text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
          <Clock size={12} className="sm:w-3.5 sm:h-3.5" />
          Interval (seconds)
        </label>
        <p className="text-[9px] sm:text-[10px] text-zinc-400 mb-2">
          Wait time after each cycle. Min: {MIN_INTERVAL}s · Current: {intervalSeconds}s
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={MIN_INTERVAL}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded bg-zinc-800/80 border border-zinc-700/50 text-foreground font-heading text-[10px] sm:text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-[10px] sm:text-xs hover:bg-primary/30 disabled:opacity-50 transition-all active:scale-95"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
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
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(120);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [inputValue, setInputValue] = useState('120');
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
  });

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
          });
        }
        if (statsRes?.data) {
          setStats({
            total_busts: statsRes.data.total_busts ?? 0,
            total_crimes: statsRes.data.total_crimes ?? 0,
            total_gtas: statsRes.data.total_gtas ?? 0,
            total_cash: statsRes.data.total_cash ?? 0,
            running_seconds: statsRes.data.running_seconds ?? 0,
            best_cars: statsRes.data.best_cars ?? [],
            total_booze_runs: statsRes.data.total_booze_runs ?? 0,
            total_booze_profit: statsRes.data.total_booze_profit ?? 0,
            next_oc_at: statsRes.data.next_oc_at ?? null,
          });
        }
        if (checkRes.data?.is_admin) {
          if (intervalRes?.data) {
            setIntervalSeconds(intervalRes.data.interval_seconds ?? 120);
            setInputValue(String(intervalRes.data.interval_seconds ?? 120));
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
      }));
      toast.success('Saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleSaveInterval = async () => {
    const val = parseInt(inputValue, 10);
    if (Number.isNaN(val) || val < MIN_INTERVAL) {
      toast.error(`Interval must be at least ${MIN_INTERVAL} seconds`);
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch('/auto-rank/interval', { interval_seconds: val });
      setIntervalSeconds(res.data.interval_seconds);
      setInputValue(String(res.data.interval_seconds));
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
      <div className="px-3 sm:px-4 max-w-4xl mx-auto">
        <style>{AR_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  const canEnable = prefs.auto_rank_purchased;
  const hasTelegram = prefs.telegram_chat_id_set;

  return (
    <div className="px-3 sm:px-4 max-w-4xl mx-auto space-y-3 sm:space-y-4">
      <style>{AR_STYLES}</style>
      
      {/* Page intro */}
      <div className="relative ar-fade-in">
        <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading italic">
          Automate crimes, GTA, busts, OC. Optional: set Telegram in Profile for notifications.
        </p>
      </div>

      <SetupCard canEnable={canEnable} hasTelegram={hasTelegram} />
      
      <SettingsCard 
        prefs={prefs}
        canEnable={canEnable}
        savingPrefs={savingPrefs}
        onUpdatePref={updatePref}
      />
      
      {canEnable && <StatsCard stats={stats} />}
      
      {isAdmin && (
        <AdminGlobalLoopCard
          globalEnabled={globalEnabled}
          intervalSeconds={intervalSeconds}
          inputValue={inputValue}
          setInputValue={setInputValue}
          saving={saving}
          toggling={toggling}
          onStart={handleStartGlobal}
          onStop={handleStopGlobal}
          onSave={handleSaveInterval}
        />
      )}

      {/* Admin Users Table */}
      {isAdmin && (
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
      )}
    </div>
  );
}
