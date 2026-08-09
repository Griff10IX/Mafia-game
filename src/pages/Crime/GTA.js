import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Car, Lock, ChevronDown, ChevronRight, Bot, HelpCircle } from 'lucide-react';
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
import {
  apiPostWithCivilianProtectionConfirm,
  isCivilianProtectionConfirmCancelled,
} from '../../utils/civilianProtectionConfirm';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { GTA_SESSION_CACHE_KEY, DEFAULT_GTA_STATS } from '../../utils/gtaPageWarm';

const GTA_STYLES = `
  @keyframes gta-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .gta-fade-in { animation: gta-fade-in 0.4s ease-out both; }
  .gta-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .gta-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }

  @media (max-width: 767px) {
    .gta-row {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "name action"
        "meta action";
      column-gap: 8px;
      row-gap: 3px;
      align-items: center;
      padding: 7px 8px !important;
    }
    .gta-row-name { grid-area: name; min-width: 0; }
    .gta-row-meta { grid-area: meta; display: flex; align-items: center; gap: 6px; min-width: 0; }
    .gta-row-action { grid-area: action; align-self: center; width: auto !important; justify-content: flex-end; }
    .gta-row-name .gta-name-text {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .gta-row-action .gta-action-btn {
      min-width: 4.25rem;
      justify-content: center;
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
const GTARow = ({ option, attemptingOptionId, onAttempt, event, eventsEnabled, manualPlayDisabled, canSkip, onSkip, skipBusy }) => {
  const onCooldown = option.cooldown_until && formatCooldown(option.cooldown_until);
  const unlocked = option.unlocked;
  const showSkip = Boolean(onCooldown && unlocked && canSkip && !manualPlayDisabled);
  const defaultCooldown = formatDefaultCooldown(option.cooldown ?? 0);
  const progress = Math.min(92, Math.max(10, Number(option.progress) ?? 10));
  // Backend maps progress → steal % (max 55% base, 65% with events/climate). Prefer API value.
  const successRateDisplay = Number.isFinite(Number(option.success_chance))
    ? Math.min(65, Math.max(0, Math.round(Number(option.success_chance))))
    : Math.min(55, Math.round(25 + ((progress - 25) / 67) * 30));

  const rankLocked = !unlocked && option.min_rank_name;
  return (
    <div
      className={`gta-row flex justify-between gap-2 px-2 py-1 rounded-md transition-all min-w-0 ${
        rankLocked ? 'items-start sm:items-center' : 'items-center'
      } ${
        unlocked && !onCooldown
          ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20' 
          : 'bg-zinc-800/20 border border-transparent opacity-60'
      }`}
      data-testid={`gta-option-${option.id}`}
    >
      {/* Car info */}
      <div className="gta-row-name flex items-start gap-1 min-w-0 flex-1">
        {unlocked ? (
          <Car className={`text-primary/50 w-3.5 h-3.5 shrink-0 ${rankLocked ? 'mt-0.5 sm:mt-0' : ''}`} />
        ) : (
          <Lock className={`text-mutedForeground/50 w-3.5 h-3.5 shrink-0 ${rankLocked ? 'mt-0.5 sm:mt-0' : ''}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:flex-wrap sm:gap-x-1 sm:gap-y-0.5">
            <span className="inline-flex items-center gap-1 min-w-0">
              <span className="gta-name-text text-[11px] font-heading font-bold text-foreground truncate min-w-0" title={option.name}>
                {option.name}
              </span>
              <PossibleCarsInfo optionName={option.name} cars={option.possible_cars} />
            </span>
            {!unlocked && option.min_rank_name && (
              <span
                className="hidden sm:inline-flex items-start gap-0.5 bg-zinc-800/50 text-mutedForeground rounded px-1 py-0.5 text-[9px] font-bold uppercase border border-zinc-700/50 w-full min-w-0 sm:w-auto sm:max-w-full leading-snug"
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

      <div className="gta-row-meta flex items-center gap-2 shrink-0">
        {/* Progress bar + % inline on mobile (matches Crimes layout) */}
        {unlocked && (
          <div className="flex items-center gap-1 shrink-0">
            <GTAProgressBar progress={option.progress} successChance={successRateDisplay} />
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
      </div>

      {/* Action — same width as Crimes */}
      <div className="gta-row-action shrink-0 w-[60px] flex justify-end">
        {manualPlayDisabled && unlocked && !onCooldown ? (
          <button
            type="button"
            disabled
            className="gta-action-btn bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Locked
          </button>
        ) : unlocked && !onCooldown ? (
          <button
            type="button"
            onClick={() => onAttempt(option.id)}
            disabled={attemptingOptionId !== null}
            className="gta-action-btn tap-feedback bg-primary/20 text-primary rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 active:scale-[0.97] transition-all touch-manipulation disabled:opacity-60 font-heading"
            data-testid={`attempt-gta-${option.id}`}
          >
            {attemptingOptionId === option.id ? '...' : 'Steal'}
          </button>
        ) : showSkip ? (
          <button
            type="button"
            disabled={skipBusy || attemptingOptionId !== null}
            onClick={() => onSkip(option.id)}
            title="Use a GTA cooldown skip token to attempt now (max 1,000 GTA skips/day)"
            className="gta-action-btn tap-feedback bg-amber-500/15 text-amber-300 rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border border-amber-500/45 hover:bg-amber-500/25 active:scale-[0.97] transition-all touch-manipulation font-heading disabled:opacity-50"
            data-testid={`skip-gta-${option.id}`}
          >
            {skipBusy ? '...' : 'Skip'}
          </button>
        ) : onCooldown ? (
          <button
            type="button"
            disabled
            className="gta-action-btn bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Wait
          </button>
        ) : (
          <span
            className="text-[8px] sm:text-[9px] text-mutedForeground text-right leading-tight max-w-[4.75rem] font-heading uppercase"
            title={option.min_rank_name ? `Unlocked at rank ${option.min_rank_name}` : undefined}
          >
            {option.min_rank_name ? `Rank ${option.min_rank_name}` : 'Locked'}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
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
                  className={`${styles.panel} rounded-lg border border-border hover:border-primary/30 p-1.5 transition-all overflow-hidden block text-left min-w-0`}
                >
                  <div
                    className="w-full aspect-[4/3] rounded overflow-hidden bg-secondary mb-1 relative shrink-0"
                    style={{ border: `2px solid ${glowHex}`, boxShadow: `0 0 12px ${glowHex}aa, inset 0 0 8px ${glowHex}33` }}
                  >
                    {/* Icon sits underneath; if the image 404s we hide it so the icon shows instead of broken alt text. */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Car size={20} className="text-primary/30 shrink-0" />
                    </div>
                    {car.image && (
                      <img
                        src={car.image}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover object-center"
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                  </div>
                  <div className={`text-[9px] font-heading font-bold uppercase tracking-wider truncate ${getRarityColor(car.rarity)} mb-0.5`}>
                    {rarity}
                  </div>
                  <div className="text-[11px] font-heading font-bold text-foreground leading-snug line-clamp-2 mb-0.5" title={displayName}>
                    {displayName}
                  </div>
                  <div className="text-[10px] text-primary font-heading font-bold truncate">
                    ${Number(value).toLocaleString()}
                  </div>
                  {damage > 0 && (
                    <p className="text-[9px] font-heading text-mutedForeground mt-0.5 truncate">
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

// GTA progress bar: skill meter 25–92% (maps to steal chance up to 55%/65%).
const GTAProgressBar = ({ progress, successChance }) => {
  const pct = Math.min(92, Math.max(10, Number(progress) ?? 10));
  const barPct = ((pct - 10) / 82) * 100;
  const chanceLabel = Number.isFinite(Number(successChance))
    ? Math.round(Number(successChance))
    : Math.min(55, Math.round(25 + ((pct - 25) / 67) * 30));
  return (
    <div
      className="flex items-center gap-1 shrink-0"
      title={`Steal chance: ${chanceLabel}% (max 55% without boosts, 65% with events/climate). Progress +4–6% on success, −1–2% on fail; after peaking at 92% skill floor is 80%.`}
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
  const [skipBusyId, setSkipBusyId] = useState(null);
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
  const [user, setUser] = useState(() => gtaBoot?.user ?? null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetchData = useCallback(async ({ silent = false } = {}) => {
    let nextOptions = optionsRef.current;
    let nextRecentStolen = [];
    let nextEvent = null;
    let nextEventsEnabled = false;
    let nextAutoRankGtaDisabled = false;
    let nextUser = null;
    let nextGtaStats = { ...DEFAULT_GTA_STATS };
    try {
      const settled = await Promise.allSettled([
        api.get('/gta/options'),
        api.get('/gta/recent-stolen'),
        apiRequestWith429Retry(() => api.get('/events/active')).catch(() => ({ data: { event: null, events_enabled: false } })),
        silent ? Promise.resolve({ data: null }) : api.get('/gta/stats').catch(() => ({ data: {} })),
        api.get('/auto-rank/me').catch(() => ({ data: {} })),
        api.get('/auth/me').catch(() => ({ data: null })),
      ]);
      const [optionsRes, recentStolenRes, eventsRes, statsRes, autoRankRes, meRes] = settled;
      
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
      const response = await apiPostWithCivilianProtectionConfirm('/gta/attempt', { option_id: optionId });
      const data = response.data || {};
      const car = data.car;
      const progressAfter = data.progress_after;
      const cooldownUntil = data.cooldown_until;
      
      if (data.success) {
        const img = car?.image;
        const rarityKey = String(car?.rarity || 'common').toLowerCase();
        const glowHex = RARITY_GLOW_HEX[rarityKey] || RARITY_GLOW_HEX.common;
        const rarityLabel = rarityKey.replace(/_/g, ' ');
        toast.success(data.message, {
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
                {typeof data.respect_points === 'number' && data.respect_points > 0 ? (
                  <div className="mt-0.5">Respect: +{data.respect_points}</div>
                ) : null}
              </div>
            </div>
          ) : undefined,
        });
        const profit = Number(car?.value) || 0;
        setGtaStats((prev) => ({
          ...prev,
          count_today: (prev.count_today || 0) + 1,
          count_week: (prev.count_week || 0) + 1,
          success_today: (prev.success_today || 0) + 1,
          success_week: (prev.success_week || 0) + 1,
          profit_today: (prev.profit_today || 0) + profit,
          profit_24h: (prev.profit_24h || 0) + profit,
          profit_week: (prev.profit_week || 0) + profit,
        }));
        if (car) {
          setRecentStolen((prev) => {
            const entry = {
              id: car.id,
              car_id: car.id,
              name: car.name,
              rarity: car.rarity,
              image: car.image,
              value: car.value,
            };
            return [entry, ...(Array.isArray(prev) ? prev : [])].slice(0, 10);
          });
        }
      } else if (data.jailed) {
        toast.error(data.message);
        setGtaStats((prev) => ({
          ...prev,
          count_today: (prev.count_today || 0) + 1,
          count_week: (prev.count_week || 0) + 1,
        }));
      } else if (data.success === false && data.message) {
        toast.error(data.message);
        setGtaStats((prev) => ({
          ...prev,
          count_today: (prev.count_today || 0) + 1,
          count_week: (prev.count_week || 0) + 1,
        }));
      }

      // One attempt cools all options — patch from response instead of refetching /gta/options.
      setOptions((prev) =>
        prev.map((o) => {
          const patched = { ...o };
          if (cooldownUntil) patched.cooldown_until = cooldownUntil;
          if (o.id === optionId && progressAfter != null) patched.progress = progressAfter;
          return patched;
        })
      );
      refreshUser();
    } catch (error) {
      if (isCivilianProtectionConfirmCancelled(error)) {
        /* user declined — keep protection */
      } else {
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
        fetchData({ silent: true });
      }
    } finally {
      if (!willRetry) setAttemptingOptionId(null);
    }
  };

  // Skip tokens: activating one grants a credit /gta/attempt auto-consumes when on cooldown.
  const skipTokens = Number(user?.cooldown_skip_gta_tokens || 0);
  const skipCredits = Number(user?.cooldown_skip_gta_credits || 0);
  const canSkipCooldown = skipTokens > 0 || skipCredits > 0;

  const skipCooldownAndAttempt = async (optionId) => {
    if (skipBusyId || attemptingOptionId) return;
    setSkipBusyId(optionId);
    try {
      if (skipCredits < 1) {
        await api.post('/inventory/tokens/use', { token_type: 'cooldown_skip_gta' });
      }
      await attemptGTA(optionId);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to use cooldown skip token');
      refreshUser();
      fetchData({ silent: true });
    } finally {
      setSkipBusyId(null);
    }
  };

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="gta-page">
      <style>{GTA_STYLES}</style>

      <div className="relative gta-fade-in flex items-center gap-2 flex-wrap">
        <p className="text-[9px] text-zinc-500 font-heading italic">Steal cars. Unlock by rank. One attempt puts all on cooldown.</p>
        {autoRankGtaDisabled && <AutoRankIcon />}
      </div>

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
              canSkip={canSkipCooldown}
              onSkip={skipCooldownAndAttempt}
              skipBusy={skipBusyId === option.id}
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
        <div className="p-2 text-[10px] font-heading text-mutedForeground gta-stats-text space-y-1">
          <div>
            GTAs today:{' '}
            <span className="text-primary font-bold tabular-nums">{(gtaStats.count_today ?? 0).toLocaleString()}</span>
            {' '}· Successful today{' '}
            <span className="text-emerald-400 font-bold tabular-nums">{(gtaStats.success_today ?? 0).toLocaleString()}</span>
            {' '}· Past week{' '}
            <span className="text-primary font-bold tabular-nums">{(gtaStats.count_week ?? 0).toLocaleString()}</span>
            {' '}(
            <span className="text-emerald-400 font-bold tabular-nums">{(gtaStats.success_week ?? 0).toLocaleString()} successful</span>
            )
          </div>
        </div>
        <div className="gta-art-line text-primary mx-2.5" />
      </div>

      <InfoSection />
    </div>
  );
}
