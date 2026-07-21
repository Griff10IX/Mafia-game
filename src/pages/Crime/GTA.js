import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Car, Lock, ChevronDown, ChevronRight, Bot, Zap, HelpCircle } from 'lucide-react';
import ActiveTokenBadge from '../../components/ActiveTokenBadge';

const RARITY_COLORS = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  ultra_rare: 'text-purple-400',
  legendary: 'text-yellow-400',
  custom: 'text-orange-400',
  exclusive: 'text-red-400',
};
function getRarityColor(rarity) {
  return RARITY_COLORS[rarity] || 'text-foreground';
}
/** Hex versions of RARITY_COLORS for inline border/glow styling (toast card). */
const RARITY_GLOW_HEX = {
  common: '#9ca3af',
  uncommon: '#4ade80',
  rare: '#60a5fa',
  ultra_rare: '#c084fc',
  legendary: '#facc15',
  custom: '#fb923c',
  exclusive: '#f87171',
  loot_exclusive: '#fbbf24',
  vip_exclusive: '#06b6d4',
};
import api, { refreshUser, apiRequestWith429Retry } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { GTA_SESSION_CACHE_KEY, DEFAULT_GTA_STATS } from '../../utils/gtaPageWarm';

const GTA_STYLES = `
  @keyframes gta-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .gta-fade-in { animation: gta-fade-in 0.4s ease-out both; }
  .gta-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .gta-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }

  /* Mobile row compact padding (shared mobile layout in noir.module.css) */
  @media (max-width: 767px) {
    .gta-row {
      padding-top: 3px !important;
      padding-bottom: 3px !important;
    }
  }
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
  const s = Number(cooldownSeconds ?? 0) || 0;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
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

// Compact status icon: Auto Rank active
const AutoRankIcon = () => (
  <span
    title="Auto Rank — GTA is running automatically. Manual play disabled."
    className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-amber-500/40 bg-amber-500/10 gta-fade-in"
  >
    <Bot size={14} className="text-amber-400" />
  </span>
);

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary'];

/** "?" info popover listing which cars an option can steal (no odds). Hover on desktop, tap on mobile. */
const PossibleCarsInfo = ({ optionName, cars }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const closeTimerRef = useRef(null);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openNow = () => {
    cancelClose();
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 232;
    const flipUp = window.innerHeight - r.bottom < 300 && r.top > window.innerHeight - r.bottom;
    setPos({
      ...(flipUp ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      left: Math.max(8, Math.min(r.left - 8, window.innerWidth - width - 8)),
      width,
    });
    setOpen(true);
  };

  const closeSoon = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 160);
  };

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!Array.isArray(cars) || cars.length === 0) return null;

  const grouped = {};
  for (const c of cars) {
    const key = String(c?.rarity || 'common').toLowerCase();
    (grouped[key] = grouped[key] || []).push(c);
  }
  const hoverCapable = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover)').matches;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openNow();
        }}
        onMouseEnter={() => { if (hoverCapable) openNow(); }}
        onMouseLeave={() => { if (hoverCapable) closeSoon(); }}
        className="inline-flex items-center justify-center w-5 h-5 -my-0.5 rounded-full text-mutedForeground hover:text-primary transition-colors shrink-0 touch-manipulation"
        title="Possible cars"
        aria-label={`Possible cars from ${optionName}`}
        aria-expanded={open}
      >
        <HelpCircle size={12} />
      </button>
      {open && pos ? createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] rounded-lg border-2 border-primary/35 shadow-2xl p-2.5 space-y-1.5 max-h-[45vh] overflow-y-auto"
          style={{ ...pos, backgroundColor: 'var(--noir-content, #0a0a0a)' }}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
          role="tooltip"
        >
          <p className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
            {optionName} — possible cars
          </p>
          {RARITY_ORDER.filter((r) => grouped[r]?.length).map((r) => (
            <div key={r}>
              <p className={`text-[8px] font-heading font-bold uppercase tracking-wider ${getRarityColor(r)}`}>
                {r.replace(/_/g, ' ')}
              </p>
              <p className="text-[10px] font-heading text-foreground leading-snug">
                {grouped[r].map((c) => c.name).join(', ')}
              </p>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  );
};

// Compact GTA row
const GTARow = ({ option, attemptingOptionId, onAttempt, event, eventsEnabled, manualPlayDisabled }) => {
  const onCooldown = option.cooldown_until && formatCooldown(option.cooldown_until);
  const unlocked = option.unlocked;
  const defaultCooldown = formatDefaultCooldown(option.cooldown ?? 0);
  const progress = Math.min(92, Math.max(10, Number(option.progress) ?? 10));
  const successRateDisplay = eventsEnabled && event?.gta_success
    ? Math.min(100, Math.round(progress * (event.gta_success ?? 1)))
    : progress;

  const rankLocked = !unlocked && option.min_rank_name;
  return (
    <div
      className={`flex justify-between gap-2 px-2 py-1 rounded-md transition-all gta-row min-w-0 ${
        rankLocked ? 'items-start sm:items-center' : 'items-center'
      } ${
        unlocked && !onCooldown
          ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20' 
          : 'bg-zinc-800/20 border border-transparent opacity-60'
      }`}
      data-testid={`gta-option-${option.id}`}
    >
      {/* Car info — rank unlock on its own row on mobile so timers don’t overlap "Underboss" */}
      <div className="flex items-start gap-1 min-w-0 flex-1">
        {unlocked ? (
          <Car className={`text-primary/50 w-3.5 h-3.5 shrink-0 ${rankLocked ? 'mt-0.5 sm:mt-0' : ''}`} />
        ) : (
          <Lock className={`text-mutedForeground/50 w-3.5 h-3.5 shrink-0 ${rankLocked ? 'mt-0.5 sm:mt-0' : ''}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:flex-wrap sm:gap-x-1 sm:gap-y-0.5">
            <span className="inline-flex items-center gap-1 min-w-0">
              <span className="text-[11px] font-heading font-bold text-foreground truncate min-w-0">
                {option.name}
              </span>
              <PossibleCarsInfo optionName={option.name} cars={option.possible_cars} />
            </span>
            {!unlocked && option.min_rank_name && (
              <span
                className="inline-flex items-start gap-0.5 bg-zinc-800/50 text-mutedForeground rounded px-1 py-0.5 text-[9px] font-bold uppercase border border-zinc-700/50 w-full min-w-0 sm:w-auto sm:max-w-full leading-snug"
                title={`Unlocked at rank ${option.min_rank_name}`}
              >
                <Lock size={8} className="shrink-0 mt-px" />
                <span className="min-w-0 break-words">
                  Unlocked at rank {option.min_rank_name}
                </span>
              </span>
            )}
          </div>
          <div className="text-[9px] text-mutedForeground truncate hidden sm:block mt-0.5">
            {!unlocked && option.min_rank_name
              ? 'Unavailable'
              : `Difficulty ${option.difficulty}/5`}
          </div>
        </div>
      </div>

      {/* Progress bar + % inline on mobile (matches Crimes layout) */}
      {unlocked && (
        <div className="flex items-center gap-1 shrink-0">
          <GTAProgressBar progress={option.progress} />
          <span className="text-[9px] text-primary font-heading w-6 sm:hidden">{successRateDisplay}%</span>
        </div>
      )}

      {/* Success rate — desktop only */}
      <div className="shrink-0 w-8 text-center hidden sm:block">
        <span className={`text-[10px] font-bold tabular-nums ${unlocked ? 'text-primary' : 'text-mutedForeground'}`}>
          {successRateDisplay}%
        </span>
      </div>

      {/* Jail time (like Crimes "risk" column) */}
      <div className="shrink-0 w-8 text-center">
        <span className="text-[10px] font-bold text-red-400 tabular-nums">{option.jail_time ?? 0}s</span>
      </div>

      {/* Cooldown */}
      <div className="shrink-0 w-10 text-center">
        {onCooldown ? (
          <span className="text-[10px] text-mutedForeground font-heading whitespace-nowrap">{onCooldown}</span>
        ) : unlocked ? (
          <span className="text-[9px] text-mutedForeground/60 whitespace-nowrap truncate block">{defaultCooldown}</span>
        ) : (
          <span className="text-[9px] text-mutedForeground">—</span>
        )}
      </div>

      {/* Action — same width as Crimes */}
      <div className="shrink-0 w-[60px] flex justify-end">
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
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 gta-fade-in mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between hover:bg-primary/12 transition-colors"
      >
        <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.1em] gta-panel-header">
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
        <div className="p-2">
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {recentStolen.map((car, index) => {
              const displayName = car.car_name || car.name || 'Car';
              const rarityKey = String(car.rarity || 'common').toLowerCase();
              const rarity = rarityKey.replace(/_/g, ' ');
              const glowHex = RARITY_GLOW_HEX[rarityKey] || RARITY_GLOW_HEX.common;
              const value = car.value ?? 0;
              const damage = Math.min(100, Math.max(0, Number(car.damage_percent) ?? 0));
              return (
                <Link
                  key={car.user_car_id ?? `car-${index}`}
                  to={`/view-car?id=${encodeURIComponent(car.user_car_id)}`}
                  data-testid={`recent-stolen-car-${index}`}
                  className={`${styles.panel} rounded-lg border border-border hover:border-primary/30 p-1 sm:p-1.5 transition-all overflow-hidden block text-left min-w-0`}
                >
                  <div
                    className="w-full aspect-[4/3] rounded overflow-hidden bg-secondary mb-0.5 sm:mb-1 relative shrink-0"
                    style={{ border: `2px solid ${glowHex}`, boxShadow: `0 0 12px ${glowHex}aa, inset 0 0 8px ${glowHex}33` }}
                  >
                    {car.image ? (
                      <img
                        src={car.image}
                        alt={displayName}
                        className="absolute inset-0 w-full h-full object-cover object-center"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Car size={20} className="text-primary/30 shrink-0" />
                      </div>
                    )}
                  </div>
                  <div className={`text-[8px] sm:text-[9px] font-heading font-bold uppercase tracking-wider truncate ${getRarityColor(car.rarity)} mb-0.5`}>
                    {rarity}
                  </div>
                  <div className="text-[9px] sm:text-[11px] font-heading font-bold text-foreground truncate mb-0.5">
                    {displayName}
                  </div>
                  <div className="text-[9px] sm:text-[10px] text-primary font-heading font-bold truncate">
                    ${Number(value).toLocaleString()}
                  </div>
                  {damage > 0 && (
                    <p className="text-[8px] sm:text-[9px] font-heading text-mutedForeground mt-0.5 truncate">
                      {damage}% dmg
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
          <p className="text-[9px] text-mutedForeground font-heading mt-2 text-center">
            <Link to="/cars/garage" className="text-primary hover:underline">View full garage →</Link>
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
            background: 'linear-gradient(to right, var(--noir-primary), #ca8a04)',
            borderRadius: 9999,
            transition: 'width 0.3s ease',
          }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={10}
          aria-valuemax={92}
        />
      </div>
    </div>
  );
};

const InfoSection = () => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 gta-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] gta-panel-header">
        ℹ️ GTA System
      </h3>
    </div>
    <div className="p-2">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-mutedForeground font-heading gta-stats-text">
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
  const gtaBoot = readSessionJson(GTA_SESSION_CACHE_KEY);
  const [options, setOptions] = useState(() => gtaBoot?.options ?? []);
  const [recentStolen, setRecentStolen] = useState(() => gtaBoot?.recentStolen ?? []);
  const [gtaStats, setGtaStats] = useState(() => {
    const gs = gtaBoot?.gtaStats;
    return gs && typeof gs === 'object' ? { ...DEFAULT_GTA_STATS, ...gs } : { ...DEFAULT_GTA_STATS };
  });
  const [attemptingOptionId, setAttemptingOptionId] = useState(null);
  const [event, setEvent] = useState(() => gtaBoot?.event ?? null);
  const [eventsEnabled, setEventsEnabled] = useState(() => !!gtaBoot?.eventsEnabled);
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

  const [autoRankGtaDisabled, setAutoRankGtaDisabled] = useState(() => !!gtaBoot?.autoRankGtaDisabled);
  const [activeLootPerks, setActiveLootPerks] = useState(() => gtaBoot?.activeLootPerks ?? []);
  const [user, setUser] = useState(() => gtaBoot?.user ?? null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetchData = useCallback(async ({ silent = false } = {}) => {
    let nextOptions = optionsRef.current;
    let nextRecentStolen = [];
    let nextEvent = null;
    let nextEventsEnabled = false;
    let nextAutoRankGtaDisabled = false;
    let nextActiveLootPerks = [];
    let nextUser = null;
    let nextGtaStats = { ...DEFAULT_GTA_STATS };
    try {
      const settled = await Promise.allSettled([
        api.get('/gta/options'),
        api.get('/gta/recent-stolen'),
        apiRequestWith429Retry(() => api.get('/events/active')).catch(() => ({ data: { event: null, events_enabled: false } })),
        silent ? Promise.resolve({ data: null }) : api.get('/gta/stats').catch(() => ({ data: {} })),
        api.get('/auto-rank/me').catch(() => ({ data: {} })),
        api.get('/loot-box/status').catch(() => ({ data: {} })),
        api.get('/auth/me').catch(() => ({ data: null })),
      ]);
      const [optionsRes, recentStolenRes, eventsRes, statsRes, autoRankRes, lootStatusRes, meRes] = settled;
      
      if (optionsRes.status === 'fulfilled' && Array.isArray(optionsRes.value?.data)) {
        nextOptions = optionsRes.value.data;
        setOptions(nextOptions);
      } else {
        if (!silent && optionsRes.status === 'rejected') {
          toast.error('Failed to load GTA options');
        }
      }
      if (!silent && statsRes.status === 'fulfilled' && statsRes.value?.data && typeof statsRes.value.data === 'object') {
        nextGtaStats = { ...DEFAULT_GTA_STATS, ...statsRes.value.data };
        setGtaStats(nextGtaStats);
      }
      
      if (recentStolenRes.status === 'fulfilled' && recentStolenRes.value?.data) {
        nextRecentStolen = Array.isArray(recentStolenRes.value.data.cars) ? recentStolenRes.value.data.cars : [];
        setRecentStolen(nextRecentStolen);
      }
      
      if (eventsRes.status === 'fulfilled' && eventsRes.value?.data) {
        nextEvent = eventsRes.value.data?.event ?? null;
        nextEventsEnabled = !!eventsRes.value.data?.events_enabled;
        setEvent(nextEvent);
        setEventsEnabled(nextEventsEnabled);
      }
      if (autoRankRes.status === 'fulfilled' && autoRankRes.value?.data) {
        const ar = autoRankRes.value.data;
        nextAutoRankGtaDisabled = !!(ar.auto_rank_enabled && ar.auto_rank_gta);
        setAutoRankGtaDisabled(nextAutoRankGtaDisabled);
      }
      if (lootStatusRes.status === 'fulfilled' && Array.isArray(lootStatusRes.value?.data?.active_rewards)) {
        nextActiveLootPerks = lootStatusRes.value.data.active_rewards.filter((r) => r.type === 'rp_10' || r.type === 'gta_rare_100');
        setActiveLootPerks(nextActiveLootPerks);
      } else {
        nextActiveLootPerks = [];
        setActiveLootPerks(nextActiveLootPerks);
      }
      if (meRes.status === 'fulfilled' && meRes.value?.data) {
        nextUser = meRes.value.data;
        setUser(nextUser);
      }
      writeSessionJson(GTA_SESSION_CACHE_KEY, {
        options: nextOptions,
        recentStolen: nextRecentStolen,
        event: nextEvent,
        eventsEnabled: nextEventsEnabled,
        gtaStats: silent ? (readSessionJson(GTA_SESSION_CACHE_KEY)?.gtaStats ?? nextGtaStats) : nextGtaStats,
        autoRankGtaDisabled: nextAutoRankGtaDisabled,
        activeLootPerks: nextActiveLootPerks,
        user: nextUser,
      });
    } catch (error) {
      if (!silent) {
        toast.error('Failed to load GTA data');
        console.error('Error fetching GTA data:', error);
      }
    }
  }, []);

  useEffect(() => {
    const boot = readSessionJson(GTA_SESSION_CACHE_KEY);
    fetchData({ silent: !!(boot?.options?.length) });
    // Intentionally once per mount (returning to /crime/gta remounts and loads fresh).
  }, [fetchData]);

  const tick = useCooldownTicker(options, () => fetchData({ silent: true }));

  const attemptGTA = async (optionId, isRetry = false) => {
    if (attemptingOptionId) return;
    setAttemptingOptionId(optionId);
    let willRetry = false;
    
    try {
      const response = await api.post('/gta/attempt', { option_id: optionId });
      
      if (response.data.success) {
        const car = response.data.car;
        const img = car?.image;
        const rarityKey = String(car?.rarity || 'common').toLowerCase();
        const glowHex = RARITY_GLOW_HEX[rarityKey] || RARITY_GLOW_HEX.common;
        const rarityLabel = rarityKey.replace(/_/g, ' ');
        toast.success(response.data.message, {
          description: car ? (
            <div className="flex items-center gap-3">
              {img ? (
                <div
                  className="w-12 h-12 rounded-sm overflow-hidden bg-secondary shrink-0"
                  style={{
                    border: `2px solid ${glowHex}`,
                    boxShadow: `0 0 10px ${glowHex}99, inset 0 0 6px ${glowHex}33`,
                  }}
                >
                  <img src={img} alt={car?.name || 'car'} className="w-full h-full object-cover" loading="lazy" />
                </div>
              ) : null}
              <div className="text-xs text-mutedForeground">
                <div className="text-foreground font-semibold">{car?.name || 'Car'}</div>
                <div className={`mt-0.5 text-[10px] font-bold uppercase tracking-wider ${getRarityColor(rarityKey)}`}>
                  {rarityLabel}
                </div>
                {typeof response.data.respect_points === 'number' && response.data.respect_points > 0 ? (
                  <div className="mt-0.5">Respect: +{response.data.respect_points}</div>
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
      fetchData({ silent: true });
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

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="gta-page">
      <style>{GTA_STYLES}</style>

      <div className="relative gta-fade-in flex items-center gap-2 flex-wrap">
        <p className="text-[9px] text-zinc-500 font-heading italic">Steal cars. Unlock by rank. One attempt puts all on cooldown.</p>
        {autoRankGtaDisabled && <AutoRankIcon />}
      </div>
      <EventBanner event={event} eventsEnabled={eventsEnabled} />

      {user?.xp_gta_until && (
        <div className="gta-fade-in">
          <ActiveTokenBadge tokenType="xp_gta" untilIso={user.xp_gta_until} />
        </div>
      )}

      {activeLootPerks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 gta-fade-in">
          {activeLootPerks.map((ar, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] font-heading text-amber-400/90 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
              <Zap size={10} className="shrink-0" />
              <span>
                {ar.name}
                {ar.expires_at && (() => {
                  try {
                    const until = new Date(ar.expires_at.replace('Z', 'Z'));
                    const ms = until - new Date();
                    if (ms <= 0) return null;
                    const h = Math.floor(ms / 3600000);
                    const m = Math.floor((ms % 3600000) / 60000);
                    return ` (${h}h ${m}m left)`;
                  } catch { return null; }
                })()}
                {ar.attempts_remaining != null && ` (${ar.attempts_remaining} attempts left)`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* GTA options list */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 gta-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] gta-panel-header">
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

      {/* GTA stats */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 gta-fade-in mobile-panel`} style={{ animationDelay: '0.03s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] gta-panel-header">GTA stats</span>
        </div>
        <div className="p-2 text-[10px] font-heading text-foreground gta-stats-text">
          GTAs today: {(gtaStats.count_today ?? 0).toLocaleString()}  successful today {(gtaStats.success_today ?? 0).toLocaleString()}  past week {(gtaStats.count_week ?? 0).toLocaleString()} ({(gtaStats.success_week ?? 0).toLocaleString()} successful)
        </div>
        <div className="gta-art-line text-primary mx-2.5" />
      </div>

      <InfoSection />
    </div>
  );
}
