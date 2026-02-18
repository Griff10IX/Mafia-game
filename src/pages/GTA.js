import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Car, Lock, ChevronDown, ChevronRight, Bot } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const GTA_STYLES = `
  @keyframes gta-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .gta-fade-in { animation: gta-fade-in 0.4s ease-out both; }
  .gta-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .gta-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

// Constants
const TICK_INTERVAL = 1000;
const RECENT_STOLEN_COLLAPSED_KEY = 'gta_recent_stolen_collapsed';

// Utility functions
function formatCooldown(isoUntil) {
  if (!isoUntil) return null;
  const until = new Date(isoUntil);
  const now = new Date();
  const secs = Math.max(0, Math.floor((until - now) / 1000));
  if (secs <= 0) return null;
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function formatDefaultCooldown(cooldownSeconds) {
  if (cooldownSeconds >= 60) return `${Math.floor(cooldownSeconds / 60)}m`;
  return `${cooldownSeconds}s`;
}

// Custom hook for cooldown ticker
const useCooldownTicker = (options, onCooldownExpired) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const hasCooldown = options.some((o) => o.cooldown_until && new Date(o.cooldown_until) > new Date());
    if (!hasCooldown) return;

    let hasRefetched = false;
    const intervalId = setInterval(() => {
      const stillHasCooldown = options.some((o) => o.cooldown_until && new Date(o.cooldown_until) > new Date());
      
      if (!stillHasCooldown && !hasRefetched) {
        hasRefetched = true;
        onCooldownExpired();
      }
      
      setTick((prev) => prev + 1);
    }, TICK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [options, onCooldownExpired]);

  return tick;
};

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
    <Car size={22} className="text-primary/40 animate-pulse" />
    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading...</span>
  </div>
);

const EventBanner = ({ event, eventsEnabled }) => {
  if (!eventsEnabled || !event?.name || (event.gta_success === 1 && event.rank_points === 1)) {
    return null;
  }

  return (
    <div className="px-2 py-1.5 bg-primary/8 border border-primary/20 rounded-md gta-fade-in">
      <p className="text-[10px] font-heading">
        <span className="text-primary font-bold">✨ {event.name}</span>
        <span className="text-mutedForeground ml-1">{event.message}</span>
      </p>
    </div>
  );
};

const AutoRankGtaNotice = () => (
  <div className={`relative p-2 ${styles.panel} border border-amber-500/40 rounded-md gta-fade-in overflow-hidden`}>
    <div className="h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
    <div className="flex items-center gap-1.5">
      <Bot size={10} className="text-amber-400 shrink-0" />
      <span className="text-amber-200/80 text-[10px]">
        <strong className="text-amber-300">Auto Rank</strong> — GTA is running automatically. Manual play disabled.
      </span>
    </div>
  </div>
);

// Compact GTA row
const GTARow = ({ option, attemptingOptionId, onAttempt, event, eventsEnabled, manualPlayDisabled }) => {
  const onCooldown = option.cooldown_until && formatCooldown(option.cooldown_until);
  const unlocked = option.unlocked;
  const defaultCooldown = formatDefaultCooldown(option.cooldown);
  const progress = Math.min(92, Math.max(10, Number(option.progress) ?? 10));
  const successRateDisplay = eventsEnabled && event?.gta_success
    ? Math.min(100, Math.round(progress * (event.gta_success ?? 1)))
    : progress;

  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md transition-all gta-row ${
        unlocked && !onCooldown
          ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20' 
          : 'bg-zinc-800/20 border border-transparent opacity-60'
      }`}
      data-testid={`gta-option-${option.id}`}
    >
      {/* Car info */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {unlocked ? (
          <Car className="text-primary/50 w-3.5 h-3.5 shrink-0" />
        ) : (
          <Lock className="text-mutedForeground/50 w-3.5 h-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[11px] font-heading font-bold text-foreground truncate block">
              {option.name}
            </span>
            {!unlocked && option.min_rank_name && (
              <span
                className="shrink-0 inline-flex items-center gap-0.5 bg-zinc-800/50 text-mutedForeground rounded px-1 py-0.5 text-[9px] font-bold uppercase border border-zinc-700/50"
                title={`Unlocked at rank ${option.min_rank_name}`}
              >
                <Lock size={8} />
                Unlocked at rank {option.min_rank_name}
              </span>
            )}
          </div>
          <div className="text-[9px] text-mutedForeground truncate">
            {!unlocked && option.min_rank_name
              ? 'Unavailable'
              : `Difficulty ${option.difficulty}/5`}
          </div>
        </div>
      </div>

      {/* Progress bar (only when unlocked) */}
      {unlocked && <GTAProgressBar progress={option.progress} />}

      {/* Success rate */}
      <div className="shrink-0 w-8 text-center">
        <span className={`text-[10px] font-bold ${unlocked ? 'text-primary' : 'text-mutedForeground'}`}>
          {successRateDisplay}%
        </span>
      </div>

      {/* Jail time */}
      <div className="shrink-0 w-8 text-center">
        <span className="text-[10px] font-bold text-red-400">{option.jail_time}s</span>
      </div>

      {/* Cooldown */}
      <div className="shrink-0 w-10 text-center">
        {onCooldown ? (
          <span className="text-[10px] text-mutedForeground font-heading">{onCooldown}</span>
        ) : unlocked ? (
          <span className="text-[9px] text-mutedForeground/60">{defaultCooldown}</span>
        ) : (
          <span className="text-[9px] text-mutedForeground">—</span>
        )}
      </div>

      {/* Action */}
      <div className="shrink-0">
        {manualPlayDisabled && unlocked && !onCooldown ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Locked
          </button>
        ) : unlocked && !onCooldown ? (
          <button
            type="button"
            onClick={() => onAttempt(option.id)}
            disabled={attemptingOptionId !== null}
            className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation disabled:opacity-60 font-heading"
            data-testid={`attempt-gta-${option.id}`}
          >
            {attemptingOptionId === option.id ? '...' : '🚗 Steal'}
          </button>
        ) : onCooldown ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Wait
          </button>
        ) : (
          <span className="text-[9px] text-mutedForeground">
            {option.min_rank_name ? '—' : 'Locked'}
          </span>
        )}
      </div>
    </div>
  );
};

const RecentStolenSection = ({ recentStolen, isCollapsed, onToggle }) => {
  if (recentStolen.length === 0) return null;

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 gta-fade-in`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between hover:bg-primary/12 transition-colors"
      >
        <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.1em]">
          🚗 Last 10 cars stolen
        </span>
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-primary font-heading font-bold">{recentStolen.length} cars</span>
          <span className="text-primary/80">
            {isCollapsed ? <ChevronRight size={8} /> : <ChevronDown size={8} />}
          </span>
        </div>
      </button>
      
      {!isCollapsed && (
        <div className="p-1">
          <div className="grid grid-cols-5 gap-1">
            {recentStolen.map((car, index) => (
              <div
                key={car.user_car_id ?? index}
                data-testid={`recent-stolen-car-${index}`}
                className="bg-zinc-800/30 border border-primary/10 rounded p-0.5 flex flex-col items-center text-center hover:border-primary/30 transition-all min-w-0"
              >
                <div className="w-14 h-14 rounded overflow-hidden bg-zinc-900/50 shrink-0">
                  {car.image ? (
                    <img
                      src={car.image}
                      alt={car.car_name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car size={12} className="text-primary/40" />
                    </div>
                  )}
                </div>
                <div className="text-[7px] font-heading font-bold text-primary truncate w-full leading-tight mt-0.5 px-0.5">
                  {car.car_name}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[8px] text-mutedForeground font-heading mt-0.5 text-center">
            <Link to="/garage" className="text-primary hover:underline">View full garage →</Link>
          </p>
        </div>
      )}
      <div className="gta-art-line text-primary mx-2.5" />
    </div>
  );
};

// GTA progress bar: 10–92%, same as crimes (fail -2% or -3%; once at 92% floor 77%)
const GTAProgressBar = ({ progress }) => {
  const pct = Math.min(92, Math.max(10, Number(progress) ?? 10));
  const barPct = ((pct - 10) / 82) * 100;
  return (
    <div
      className="flex items-center gap-1 shrink-0"
      title={`Success rate: ${pct}%. Success +3–5%; fail -1–3%; once you've hit 92%, it never goes below 77%.`}
    >
      <div
        style={{
          width: 36,
          height: 4,
          backgroundColor: '#333333',
          borderRadius: 9999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${barPct}%`,
            minWidth: barPct > 0 ? 3 : 0,
            background: 'linear-gradient(to right, #d4af37, #ca8a04)',
            borderRadius: 9999,
            transition: 'width 0.3s ease',
          }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={10}
          aria-valuemax={92}
        />
      </div>
      <span className="text-[9px] text-primary font-heading w-6">{pct}%</span>
    </div>
  );
};

const InfoSection = () => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 gta-fade-in`} style={{ animationDelay: '0.08s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        ℹ️ GTA System
      </h3>
    </div>
    <div className="p-2">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-mutedForeground font-heading">
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>Unlock by rank (Goon → Consigliere)</span>
        </li>
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>One attempt = all on cooldown</span>
        </li>
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>Higher difficulty = rarer cars + more RP</span>
        </li>
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>Failed = jail. Better cars = travel bonus</span>
        </li>
      </ul>
    </div>
    <div className="gta-art-line text-primary mx-2.5" />
  </div>
);

// Main component
export default function GTA() {
  const [options, setOptions] = useState([]);
  const [recentStolen, setRecentStolen] = useState([]);
  const [gtaStats, setGtaStats] = useState({
    count_today: 0, count_week: 0, success_today: 0, success_week: 0,
    profit_today: 0, profit_24h: 0, profit_week: 0,
  });
  const [attemptingOptionId, setAttemptingOptionId] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recentStolenCollapsed, setRecentStolenCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RECENT_STOLEN_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleRecentStolen = () => {
    setRecentStolenCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(RECENT_STOLEN_COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  };

  const [autoRankGtaDisabled, setAutoRankGtaDisabled] = useState(false);

  const fetchData = async () => {
    try {
      const [optionsRes, recentStolenRes, eventsRes, statsRes, autoRankRes] = await Promise.allSettled([
        api.get('/gta/options'),
        api.get('/gta/recent-stolen'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/gta/stats').catch(() => ({ data: {} })),
        api.get('/auto-rank/me').catch(() => ({ data: {} })),
      ]);
      
      if (optionsRes.status === 'fulfilled' && Array.isArray(optionsRes.value?.data)) {
        setOptions(optionsRes.value.data);
      } else if (optionsRes.status === 'rejected') {
        toast.error('Failed to load GTA options');
      }
      if (statsRes.status === 'fulfilled' && statsRes.value?.data) {
        setGtaStats(statsRes.value.data);
      }
      
      if (recentStolenRes.status === 'fulfilled' && recentStolenRes.value?.data) {
        setRecentStolen(Array.isArray(recentStolenRes.value.data.cars) ? recentStolenRes.value.data.cars : []);
      }
      
      if (eventsRes.status === 'fulfilled' && eventsRes.value?.data) {
        setEvent(eventsRes.value.data?.event ?? null);
        setEventsEnabled(!!eventsRes.value.data?.events_enabled);
      }
      if (autoRankRes.status === 'fulfilled' && autoRankRes.value?.data) {
        const ar = autoRankRes.value.data;
        setAutoRankGtaDisabled(!!(ar.auto_rank_gta || ar.auto_rank_bust_every_5_sec));
      }
    } catch (error) {
      toast.error('Failed to load GTA data');
      console.error('Error fetching GTA data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const tick = useCooldownTicker(options, fetchData);

  const attemptGTA = async (optionId, isRetry = false) => {
    if (attemptingOptionId) return;
    setAttemptingOptionId(optionId);
    let willRetry = false;
    
    try {
      const response = await api.post('/gta/attempt', { option_id: optionId });
      
      if (response.data.success) {
        const car = response.data.car;
        const img = car?.image;
        toast.success(response.data.message, {
          description: car ? (
            <div className="flex items-center gap-3">
              {img ? (
                <div className="w-12 h-12 rounded-sm overflow-hidden border border-border bg-secondary shrink-0">
                  <img src={img} alt={car?.name || 'car'} className="w-full h-full object-cover" loading="lazy" />
                </div>
              ) : null}
              <div className="text-xs text-mutedForeground">
                <div className="text-foreground font-semibold">{car?.name || 'Car'}</div>
                {typeof response.data.rank_points_earned === 'number' ? (
                  <div className="mt-0.5">Rank Points: +{response.data.rank_points_earned}</div>
                ) : null}
              </div>
            </div>
          ) : undefined,
        });
        refreshUser();
      } else if (response.data.jailed) {
        toast.error(response.data.message);
        refreshUser();
      } else if (response.data.success === false && response.data.message) {
        toast.error(response.data.message);
      }

      if (response.data?.progress_after != null) {
        setOptions((prev) =>
          prev.map((o) =>
            o.id === optionId ? { ...o, progress: response.data.progress_after } : o
          )
        );
      }
      fetchData();
    } catch (error) {
      const status = error.response?.status;
      const d = error.response?.data?.detail;
      const backendMsg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg || x.loc?.join('.')).join('; ') : null;
      const reason = error.code === 'ECONNABORTED' ? 'Request timed out' : error.message === 'Network Error' ? 'Network error' : backendMsg || (status ? `${status} error` : 'Request failed');
      toast.error(`Failed to steal car: ${reason}`);
      willRetry = !isRetry && (error.code === 'ECONNABORTED' || error.message === 'Network Error' || (status && status >= 500));
      
      if (willRetry) {
        await new Promise((r) => setTimeout(r, 800));
        setAttemptingOptionId(null);
        attemptGTA(optionId, true);
        return;
      }
    } finally {
      if (!willRetry) setAttemptingOptionId(null);
    }
  };

  if (loading) {
    return (
      <div className={`space-y-2 ${styles.pageContent}`}>
        <style>{GTA_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="gta-page">
      <style>{GTA_STYLES}</style>

      <div className="relative gta-fade-in">
        <p className="text-[9px] text-zinc-500 font-heading italic">Steal cars. Unlock by rank. One attempt puts all on cooldown.</p>
      </div>

      {autoRankGtaDisabled && <AutoRankGtaNotice />}
      <EventBanner event={event} eventsEnabled={eventsEnabled} />

      {/* GTA stats */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 gta-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">GTA stats</span>
        </div>
        <div className="p-2 text-[10px] font-heading text-foreground">
          GTAs today: {gtaStats.count_today ?? 0}  successful today {gtaStats.success_today ?? 0}  past week {gtaStats.count_week ?? 0} ({gtaStats.success_week ?? 0} successful)
        </div>
        <div className="gta-art-line text-primary mx-2.5" />
      </div>

      {/* GTA options list */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 gta-fade-in`} style={{ animationDelay: '0.05s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
            Available Vehicles
          </span>
        </div>

        <div className="p-1.5 space-y-0.5">
          {options.map((option) => (
            <GTARow
              key={option.id}
              option={option}
              attemptingOptionId={attemptingOptionId}
              onAttempt={attemptGTA}
              event={event}
              eventsEnabled={eventsEnabled}
              manualPlayDisabled={autoRankGtaDisabled}
            />
          ))}
        </div>
        <div className="gta-art-line text-primary mx-2.5" />
      </div>

      <RecentStolenSection 
        recentStolen={recentStolen} 
        isCollapsed={recentStolenCollapsed} 
        onToggle={toggleRecentStolen} 
      />

      <InfoSection />
    </div>
  );
}
