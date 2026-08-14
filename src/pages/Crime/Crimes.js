import { useMemo, useState, useEffect, useCallback } from 'react';
import { HelpCircle, Clock, AlertCircle, Bot, Skull, Lock, Star } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { useAuthUser } from '../../context/AuthContext';
import { SAME_ROUTE_NAV_CLICK } from '../../constants/navigationEvents';
import { getCrimesPrefetch, clearCrimesPrefetch } from '../../utils/prefetchCache';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
const CRIMES_STYLES = `
  @keyframes cr-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .cr-fade-in { animation: cr-fade-in 0.4s ease-out both; }
  .cr-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .cr-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }

  @media (max-width: 767px) {
    .cr-row {
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
    .cr-row-name { grid-area: name; min-width: 0; }
    .cr-row-meta { grid-area: meta; display: flex; align-items: center; gap: 6px; min-width: 0; }
    .cr-row-action { grid-area: action; align-self: center; width: auto !important; justify-content: flex-end; }
    .cr-row-name .cr-name-text {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .cr-row-action .cr-action-btn {
      min-width: 4.25rem;
      justify-content: center;
    }
  }
`;

// Constants
const CRIME_SUCCESS_RATES = {
  petty: 0.7,
  medium: 0.5,
  major: 0.3,
};

const PRESTIGE_COLORS = {
  1: '#cd7f32',
  2: '#a8a9ad',
  3: '#ffd700',
  4: '#b9f2ff',
  5: '#dc2626',
};

const PRESTIGE_ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

/** Human-readable extra-reward lines from API `prestige_bonus` (matches backend _apply_prestige_bonus). */
function describePrestigeBonusLines(crime) {
  const pb = crime?.prestige_bonus;
  if (!pb || typeof pb !== 'object') return [];
  const lines = [];
  const mult = pb.multiplier != null ? Number(pb.multiplier) : null;
  const roll = (lo, hi) => {
    const x = Number(lo);
    const y = Number(hi);
    if (mult != null) {
      const a = Math.max(1, Math.floor(x * mult));
      const b = Math.max(a, Math.floor(y * mult));
      return [a, b];
    }
    const a = Math.max(1, Math.floor(x));
    const b = Math.max(a, Math.floor(y));
    return [a, b];
  };

  if (pb.rare_chance != null) {
    lines.push(`${Math.round(Number(pb.rare_chance) * 100)}% chance on success for the bonus bundle below`);
  } else if (mult != null) {
    lines.push(`Guaranteed every success (bonus rolls ×${mult})`);
  }

  if (Array.isArray(pb.cash) && pb.cash.length >= 2) {
    const [a, b] = roll(pb.cash[0], pb.cash[1]);
    lines.push(`+$${a.toLocaleString()}–$${b.toLocaleString()} extra cash (+48.5% crime payout on bonus cash)`);
  }
  if (Array.isArray(pb.respect_points) && pb.respect_points.length >= 2) {
    const [a, b] = roll(pb.respect_points[0], pb.respect_points[1]);
    lines.push(`+${a.toLocaleString()}–${b.toLocaleString()} respect`);
  }
  if (pb.booze && pb.booze.min != null && pb.booze.max != null) {
    const [a, b] = roll(pb.booze.min, pb.booze.max);
    const label = pb.booze.id === 'moonshine' ? 'Moonshine' : String(pb.booze.id || 'booze');
    lines.push(`+${a}–${b} ${label}`);
  }
  if (Array.isArray(pb.bullets) && pb.bullets.length >= 2) {
    const [a, b] = roll(pb.bullets[0], pb.bullets[1]);
    lines.push(`+${a.toLocaleString()}–${b.toLocaleString()} bullets`);
  }
  if (Array.isArray(pb.points) && pb.points.length >= 2) {
    const [a, b] = roll(pb.points[0], pb.points[1]);
    lines.push(`+${a.toLocaleString()}–${b.toLocaleString()} points`);
  }
  if (Array.isArray(pb.molotovs) && pb.molotovs.length >= 2) {
    const [a, b] = roll(pb.molotovs[0], pb.molotovs[1]);
    lines.push(`+${a}–${b} molotovs`);
  }
  return lines;
}

const TICK_INTERVAL = 1000;

// Utility functions
const getSuccessRate = (crimeType) => CRIME_SUCCESS_RATES[crimeType] ?? 0.3;

const formatWaitFromMinutes = (cooldownMinutes) => {
  if (cooldownMinutes >= 1) return `${Math.round(cooldownMinutes)}m`;
  return `${Math.round(cooldownMinutes * 60)}s`;
};

const secondsUntil = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
};

// Custom hooks
const useCooldownTicker = (crimes, onCooldownExpired) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const hasCooldown = crimes.some((c) => c.next_available && secondsUntil(c.next_available) > 0);
    const needsStaleSync = crimes.some(
      (c) => c.next_available && !c.can_commit && secondsUntil(c.next_available) === 0
    );
    if (!hasCooldown && !needsStaleSync) return;

    const lastRefetchAt = { t: 0 };
    const intervalId = setInterval(() => {
      const now = Date.now();
      const stillHasCooldown = crimes.some((c) => c.next_available && secondsUntil(c.next_available) > 0);
      const staleSync = crimes.some(
        (c) => c.next_available && !c.can_commit && secondsUntil(c.next_available) === 0
      );
      if ((!stillHasCooldown || staleSync) && now - lastRefetchAt.t > 1500) {
        lastRefetchAt.t = now;
        onCooldownExpired();
      }

      setTick((prev) => prev + 1);
    }, TICK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [crimes, onCooldownExpired]);

  return tick;
};

// Compact status icons: show when Incarcerated or Auto Rank is active
const StatusIcons = ({ inJail, autoRankActive }) => {
  if (!inJail && !autoRankActive) return null;
  return (
    <div className="flex items-center gap-2 cr-fade-in">
      {inJail && (
        <span
          title="Incarcerated — Can't commit crimes while in jail"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-amber-500/40 bg-amber-500/10"
        >
          <AlertCircle size={14} className="text-amber-400" />
        </span>
      )}
      {autoRankActive && (
        <span
          title="Auto Rank — Crimes are running automatically. Manual play disabled."
          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-amber-500/40 bg-amber-500/10"
        >
          <Bot size={14} className="text-amber-400" />
        </span>
      )}
    </div>
  );
};

// Crime progress bar: 25–92%, similar to rank bar (fail/jail drops max 15%)
const CrimeProgressBar = ({ progress }) => {
  const pct = Math.min(92, Math.max(25, Number(progress) || 25));
  const barPct = ((pct - 25) / 67) * 100; // 25% = 0% fill, 92% = 100% fill
  return (
    <div
      className="flex items-center gap-1 shrink-0"
      title={`Crime success rate: ${pct}%. Success +3–5%; fail -1–3%; once you've hit 92%, it never goes below 77%.`}
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
            background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))',
            borderRadius: 9999,
            transition: 'width 0.3s ease',
          }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={25}
          aria-valuemax={92}
        />
      </div>
      <span className="text-[9px] text-primary font-heading w-6">{pct}%</span>
    </div>
  );
};

// Compact crime row
const CrimeRow = ({ crime, onCommit, manualPlayDisabled, canSkip, onSkip, skipBusy }) => {
  const unavailable = !crime.can_commit && (!crime.remaining || crime.remaining <= 0);
  const onCooldown = !crime.can_commit && crime.remaining && crime.remaining > 0;
  // Only lock when auto-rank/manual-play-disabled is confirmed true.
  const showLocked = manualPlayDisabled === true && crime.can_commit;
  const showSkip = onCooldown && canSkip && manualPlayDisabled !== true && !crime.in_jail;

  return (
    <div
      className={`cr-row flex items-center justify-between gap-2 px-2 py-1 rounded-md transition-all ${
        crime.can_commit 
          ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20' 
          : 'bg-zinc-800/20 border border-transparent opacity-60'
      }`}
      data-testid={`crime-row-${crime.id}`}
    >
      {/* Crime info */}
      <div className="cr-row-name flex items-center gap-1 min-w-0 flex-1">
        <span className="text-primary/50 text-[10px] shrink-0">▸</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap gap-y-0.5">
            <span className="cr-name-text text-[11px] font-heading font-bold text-foreground truncate" title={crime.name}>
              {crime.name}
            </span>
            {crime.unlocked === false && crime.min_rank_name && (
              <span
                className="hidden sm:inline-flex shrink-0 items-center gap-0.5 bg-zinc-800/50 text-mutedForeground rounded px-1 py-0.5 text-[9px] font-bold uppercase border border-zinc-700/50"
                title={`Unlocked at rank ${crime.min_rank_name}`}
              >
                <HelpCircle size={8} />
                Unlocked at rank {crime.min_rank_name}
              </span>
            )}
          </div>
          <div className="text-[9px] text-mutedForeground truncate hidden sm:block mt-0.5">
            {crime.description}
          </div>
        </div>
      </div>

      <div className="cr-row-meta flex items-center gap-2 shrink-0">
        {/* Crime progress bar (only when unlocked by rank) */}
        {crime.unlocked !== false && <CrimeProgressBar progress={crime.progress} />}

        {/* Risk */}
        <div className="shrink-0 w-8 text-center">
          <span className={`text-[10px] font-bold tabular-nums ${crime.can_commit ? 'text-red-400' : 'text-mutedForeground'}`}>
            {unavailable ? '—' : `${crime.risk}%`}
          </span>
        </div>

        {/* Cooldown */}
        <div className="shrink-0 w-10 text-center">
          {onCooldown && crime.remaining > 0 ? (
            <div className="flex items-center justify-center gap-0.5 text-[10px] text-mutedForeground font-heading whitespace-nowrap">
              <Clock size={8} className="text-primary shrink-0" />
              <span>{crime.remaining}s</span>
            </div>
          ) : (
            <span className="text-[9px] text-mutedForeground whitespace-nowrap truncate block" title={crime.wait}>{crime.wait}</span>
          )}
        </div>
      </div>

      {/* Action (Commit / Wait / — for rank-locked / Locked when Auto Rank) */}
      <div className="cr-row-action shrink-0 w-[60px] flex justify-end">
        {showLocked ? (
          <button
            type="button"
            disabled
            className="cr-action-btn bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Locked
          </button>
        ) : crime.can_commit ? (
          <button
            type="button"
            onClick={() => onCommit(crime.id)}
            className="cr-action-btn tap-feedback bg-primary/20 text-primary rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 active:scale-[0.97] transition-all touch-manipulation font-heading"
            data-testid={`commit-crime-${crime.id}`}
          >
            Commit
          </button>
        ) : showSkip ? (
          <button
            type="button"
            disabled={skipBusy}
            onClick={() => onSkip(crime.id)}
            title="Use a cooldown skip token to commit now (−50% cash; max 5,000 crime skips/day)"
            className="cr-action-btn tap-feedback bg-amber-500/15 text-amber-300 rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border border-amber-500/45 hover:bg-amber-500/25 active:scale-[0.97] transition-all touch-manipulation font-heading disabled:opacity-50"
            data-testid={`skip-crime-${crime.id}`}
          >
            {skipBusy ? '...' : 'Skip'}
          </button>
        ) : onCooldown ? (
          <button
            type="button"
            disabled
            className="cr-action-btn bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Wait
          </button>
        ) : crime.unlocked === false && crime.min_rank_name ? (
          <span
            className="text-[8px] sm:text-[9px] text-mutedForeground text-right leading-tight max-w-[4.75rem] font-heading uppercase"
            title={`Unlocked at rank ${crime.min_rank_name}`}
          >
            Rank {crime.min_rank_name}
          </span>
        ) : (
          <span className="text-[9px] text-mutedForeground">Locked</span>
        )}
      </div>
    </div>
  );
};

// Prestige crime row — separate styled row for prestige-exclusive crimes
const PrestigeCrimeRow = ({ crime, onCommit, manualPlayDisabled, canSkip, onSkip, skipBusy }) => {
  const level = crime.prestige_required;
  const color = PRESTIGE_COLORS[level] || '#71717a';
  const isLocked = crime.unlocked === false;
  const onCooldown = !crime.can_commit && crime.remaining && crime.remaining > 0;
  const showSkip = onCooldown && canSkip && manualPlayDisabled !== true && !crime.in_jail;
  const isGuaranteed = level >= 4;
  const bonusLines = describePrestigeBonusLines(crime);

  return (
    <div
      className="flex flex-col gap-1 px-2 py-1 rounded-md transition-all cr-row"
      style={{
        background: isLocked ? 'rgba(39,39,42,0.3)' : `${color}08`,
        border: `1px solid ${isLocked ? 'rgba(63,63,70,0.4)' : color + '25'}`,
        opacity: isLocked ? 0.7 : 1,
      }}
    >
      {/* Top row: badge + name + lock chip */}
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Prestige badge */}
        <span
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-heading font-bold uppercase tracking-wider border"
          style={isLocked
            ? { color: '#52525b', borderColor: 'rgba(63,63,70,0.5)' }
            : { color, borderColor: color + '50', backgroundColor: color + '12' }
          }
        >
          {isLocked ? <Lock size={7} /> : <Star size={7} />}
          {PRESTIGE_ROMAN[level]}
        </span>

        {/* Name */}
        <span className="text-[10px] font-heading font-bold truncate" style={{ color: isLocked ? '#52525b' : '#e4e4e7' }} title={crime.description}>
          {crime.name}
        </span>

        {/* Lock chip */}
        {isLocked && (
          <span
            className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-heading font-bold uppercase px-1.5 py-0.5 rounded border"
            style={{ color: '#71717a', borderColor: 'rgba(63,63,70,0.5)' }}
          >
            <Lock size={7} /> Prestige {level}
          </span>
        )}
      </div>

      {/* Description (now only in tooltip on the title to keep row compact) */}
      <div className="hidden">{crime.description}</div>

      {/* Bottom row: drop type + cooldown + button */}
      <div className="flex items-center gap-2 flex-wrap">
        {!isLocked && (
          <span
            className="shrink-0 inline-flex items-center gap-0.5 text-[8px] font-heading font-bold uppercase px-1.5 py-0.5 rounded border"
            style={isGuaranteed
              ? { color: '#34d399', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.08)' }
              : { color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.08)' }
            }
          >
            {isGuaranteed ? `Guaranteed ×${level === 4 ? '0.5' : '1'}` : '30% Rare Drop'}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Cooldown */}
        {onCooldown && crime.remaining > 0 && (
          <div className="flex items-center gap-0.5 text-[10px] text-zinc-500 font-heading whitespace-nowrap">
            <Clock size={8} className="shrink-0" style={{ color }} />
            <span>{crime.remaining}s</span>
          </div>
        )}
        {!onCooldown && !isLocked && !crime.can_commit && (
          <span className="text-[9px] text-zinc-600 font-heading">{crime.wait}</span>
        )}

        {/* Action button */}
        <div className="shrink-0">
          {manualPlayDisabled === true && crime.can_commit ? (
            <button type="button" disabled className="bg-zinc-700/50 text-zinc-500 rounded px-1.5 py-0.5 text-[9px] font-heading font-bold uppercase border border-zinc-600/50 cursor-not-allowed">Locked</button>
          ) : crime.can_commit ? (
            <button
              type="button"
              onClick={() => onCommit(crime.id)}
              className="tap-feedback rounded px-2.5 py-1.5 min-h-9 text-[9px] font-heading font-bold uppercase tracking-wide border transition-all touch-manipulation active:scale-[0.97]"
              style={{ color, borderColor: color + '60', background: color + '15' }}
            >
              ★ Commit
            </button>
          ) : showSkip ? (
            <button
              type="button"
              disabled={skipBusy}
              onClick={() => onSkip(crime.id)}
              title="Use a cooldown skip token to commit now (−50% cash; max 5,000 crime skips/day)"
              className="tap-feedback bg-amber-500/15 text-amber-300 rounded px-2.5 py-1.5 min-h-9 text-[9px] font-heading font-bold uppercase border border-amber-500/45 hover:bg-amber-500/25 active:scale-[0.97] transition-all touch-manipulation disabled:opacity-50"
            >
              {skipBusy ? '...' : '⚡ Skip'}
            </button>
          ) : onCooldown ? (
            <button type="button" disabled className="bg-zinc-700/50 text-zinc-500 rounded px-1.5 py-0.5 text-[9px] font-heading font-bold uppercase border border-zinc-600/50 cursor-not-allowed">Wait</button>
          ) : isLocked ? (
            <span className="text-[9px] text-zinc-600">—</span>
          ) : (
            <span className="text-[9px] text-zinc-600">Unavailable</span>
          )}
        </div>
      </div>

      {/* Possible rewards — from server prestige_bonus + base payout */}
      {!isLocked && (
        <div className="pl-0.5 space-y-0.5 border-t border-zinc-700/30 pt-1 mt-0.5">
          <p className="text-[8px] font-heading text-zinc-500 leading-tight">
            Base (success): ${Number(crime.reward_min || 0).toLocaleString()}–${Number(crime.reward_max || 0).toLocaleString()} cash · 10 rank points (more with perks / events / badges / prestige mult)
          </p>
          {bonusLines.length > 0 && (
            <ul className="text-[8px] font-heading text-zinc-400 list-disc list-inside space-y-0.5 leading-snug">
              {bonusLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          <p className="text-[7px] font-heading text-zinc-600 italic leading-tight">
            Same global extras as other crimes: ~0.15% loot piece (vs ~0.05%), ~0.1% molotov, ~1/100k random token.
          </p>
        </div>
      )}
    </div>
  );
};

// Main component
export default function Crimes() {
  const authUser = useAuthUser();
  const [bootPrefetchedCrimes] = useState(() => getCrimesPrefetch());
  const [crimes, setCrimes] = useState(() => bootPrefetchedCrimes || []);
  const [crimeStats, setCrimeStats] = useState({
    count_today: 0, count_week: 0, success_today: 0, success_week: 0,
    profit_today: 0, profit_24h: 0, profit_week: 0,
  });

  const [autoRankCrimesDisabled, setAutoRankCrimesDisabled] = useState(null); // null = unknown/loading, true = disabled, false = enabled

  // silent=true (cooldown sync / focus): skip /crimes/stats — that aggregate scans 7d of crime_events.
  // includeStats overrides: needed when silently refreshing after prefetch still wants the footer numbers.
  const fetchCrimes = useCallback(async (silent = false, { includeStats } = {}) => {
    if (authUser?.in_jail) return;
    const wantStats = includeStats ?? !silent;
    try {
      const prefetched = getCrimesPrefetch();
      const [crimesRes, autoRankRes] = await Promise.all([
        prefetched ? Promise.resolve({ data: prefetched }) : api.get('/crimes'),
        api.get('/auto-rank/me').catch(() => ({ data: {} })),
      ]);

      setCrimes(crimesRes.data || []);
      const ar = autoRankRes.data || {};
      setAutoRankCrimesDisabled(!!(ar.auto_rank_enabled && ar.auto_rank_crimes));

      if (wantStats) {
        api.get('/crimes/stats').catch(() => ({ data: {} })).then((statsRes) => {
          setCrimeStats(statsRes.data || {});
        }).catch(() => {});
      }
    } catch (error) {
      if (!silent) {
        toast.error('Failed to load crimes');
        console.error('Error fetching crimes:', error);
        setCrimes([]);
        setCrimeStats({ count_today: 0, count_week: 0, success_today: 0, success_week: 0, profit_today: 0, profit_24h: 0, profit_week: 0 });
        setAutoRankCrimesDisabled(false); // Allow manual play if we can't determine status
      }
    }
  }, [authUser?.in_jail]);

  useEffect(() => {
    fetchCrimes(!!bootPrefetchedCrimes, { includeStats: true });
  }, [fetchCrimes, bootPrefetchedCrimes]);

  useEffect(() => {
    const onSameRouteNav = (e) => {
      const d = e.detail;
      if (!d || d.pathname !== '/crime/crimes' || (d.search && d.search !== '')) return;
      clearCrimesPrefetch();
      fetchCrimes(false);
    };
    window.addEventListener(SAME_ROUTE_NAV_CLICK, onSameRouteNav);
    return () => window.removeEventListener(SAME_ROUTE_NAV_CLICK, onSameRouteNav);
  }, [fetchCrimes]);

  // AFK/mobile wake: if the page resumes with stale/empty data, silently refetch without forcing full reload.
  useEffect(() => {
    let lastWakeRefetchAt = 0;
    const maybeRefetchOnWake = () => {
      const now = Date.now();
      if (now - lastWakeRefetchAt < 2500) return;
      lastWakeRefetchAt = now;
      clearCrimesPrefetch();
      fetchCrimes(true);
    };
    const onFocus = () => maybeRefetchOnWake();
    const onPageShow = () => maybeRefetchOnWake();
    const onVisibility = () => {
      if (!document.hidden) maybeRefetchOnWake();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchCrimes]);

  const tick = useCooldownTicker(crimes, () => fetchCrimes(true));

  const [commitAllLoading, setCommitAllLoading] = useState(false);
  const [skipBusyId, setSkipBusyId] = useState(null);

  // Skip tokens: activating one grants a credit the commit endpoint auto-consumes when on cooldown.
  const skipTokens = Number(authUser?.cooldown_skip_crime_tokens || 0);
  const skipCredits = Number(authUser?.cooldown_skip_crime_credits || 0);
  const canSkipCooldown = skipTokens > 0 || skipCredits > 0;

  const skipCooldownAndCommit = async (crimeId) => {
    if (skipBusyId) return;
    setSkipBusyId(crimeId);
    try {
      if (skipCredits < 1) {
        await api.post('/inventory/tokens/use', { token_type: 'cooldown_skip_crime' });
      }
      await commitCrime(crimeId);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to use cooldown skip token');
      refreshUser();
      clearCrimesPrefetch();
      await fetchCrimes(true);
    } finally {
      setSkipBusyId(null);
    }
  };

  const commitCrime = async (crimeId) => {
    try {
      const response = await api.post(`/crimes/${crimeId}/commit`);
      const data = response.data || {};
      const progressAfter = data.progress_after;
      const nextAvailable = data.next_available;

      if (data.success) {
        const bonus = data.prestige_bonus_earned;
        let msg = data.message;
        if (data.respect_points) {
          msg += `${msg.trim().endsWith('.') ? '' : '.'} +${data.respect_points} respect`;
        }
        if (bonus && Object.keys(bonus).length > 0) {
          const parts = [];
          if (bonus.cash) parts.push(`$${bonus.cash.toLocaleString()}`);
          if (bonus.respect_points) parts.push(`+${bonus.respect_points} respect`);
          if (bonus.booze && (bonus.booze?.amount ?? 0) > 0) {
            const boozeId = typeof bonus.booze.id === 'string' ? bonus.booze.id : 'booze';
            const boozeName = boozeId.charAt(0).toUpperCase() + boozeId.slice(1);
            parts.push(`${bonus.booze.amount}× ${boozeName}`);
          }
          if (bonus.bullets) parts.push(`${bonus.bullets} bullets`);
          if (bonus.molotovs) parts.push(`${bonus.molotovs} molotov${bonus.molotovs === 1 ? '' : 's'} (each counts as 250 bullets)`);
          if (bonus.loot_box_pieces) {
            parts.push(`${bonus.loot_box_pieces} loot piece${bonus.loot_box_pieces === 1 ? '' : 's'}`);
          }
          if (bonus.token) {
            const amt = Math.max(1, Number(bonus.token_amount) || 1);
            const tokLabel = String(bonus.token).replace(/_/g, ' ');
            parts.push(`${amt}× ${tokLabel} token${amt === 1 ? '' : 's'}`);
          }
          if (bonus.points) parts.push(`${bonus.points} pts`);
          if (parts.length > 0) msg += ` ★ Bonus: ${parts.join(', ')}`;
        }
        toast.success(msg);
        const profit = Number(data.reward) || 0;
        setCrimeStats((prev) => ({
          ...prev,
          count_today: (prev.count_today || 0) + 1,
          count_week: (prev.count_week || 0) + 1,
          success_today: (prev.success_today || 0) + 1,
          success_week: (prev.success_week || 0) + 1,
          profit_today: (prev.profit_today || 0) + profit,
          profit_24h: (prev.profit_24h || 0) + profit,
          profit_week: (prev.profit_week || 0) + profit,
        }));
      } else {
        toast.error(data.message);
        setCrimeStats((prev) => ({
          ...prev,
          count_today: (prev.count_today || 0) + 1,
          count_week: (prev.count_week || 0) + 1,
        }));
      }

      // Patch cooldown / progress from the commit response — avoid a full /crimes refetch per tap.
      clearCrimesPrefetch();
      setCrimes((prev) =>
        prev.map((c) => {
          if (c.id !== crimeId) return c;
          const patched = { ...c, can_commit: false };
          if (progressAfter != null) patched.progress = progressAfter;
          if (nextAvailable) patched.next_available = nextAvailable;
          return patched;
        })
      );
      refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to commit crime');
      console.error('Error committing crime:', error);
      const jailed = String(error.response?.data?.detail || '').toLowerCase().includes('while in jail');
      if (jailed) {
        try { window.dispatchEvent(new CustomEvent('app:refresh-user', { detail: { in_jail: true } })); } catch (_) { /* ignore */ }
        return;
      }
      // Keep cooldown UI authoritative on server state (important on mobile taps/races).
      clearCrimesPrefetch();
      await fetchCrimes(true);
    }
  };

  const crimeRows = useMemo(() => {
    void tick;
    
    const inJail = !!authUser?.in_jail;

    return crimes.map((crime) => {
      const progress = Math.min(92, Math.max(25, Number(crime.progress) ?? 25));
      const successRate = progress / 100;
      const risk = Math.round(100 - progress);
      const remaining = crime.next_available ? secondsUntil(crime.next_available) : null;

      // Server can_commit is authoritative — local timer-only override caused COMMIT while API returned "Crime on cooldown".
      const canCommit = !inJail && crime.can_commit;
      
      const lockedByRank = crime.unlocked === false && crime.min_rank_name;
      const wait = canCommit
        ? formatWaitFromMinutes(crime.cooldown_minutes ?? 0)
        : remaining && remaining > 0
          ? `${remaining}s`
          : lockedByRank
            ? '—'
            : 'Unavailable';

      return {
        ...crime,
        can_commit: canCommit,
        risk,
        wait,
        remaining,
        in_jail: inJail,
      };
    });
  }, [crimes, tick, authUser?.in_jail]);

  const commitAll = async () => {
    const ready = crimeRows.filter((c) => c.crime_type !== 'prestige' && c.can_commit);
    const onCooldown = crimeRows.filter(
      (c) => c.crime_type !== 'prestige' && c.unlocked !== false && !c.can_commit && c.next_available,
    );
    const skipBudget = skipTokens + skipCredits;
    const willSkip = canSkipCooldown ? Math.min(onCooldown.length, Math.max(0, skipBudget)) : 0;
    if ((ready.length === 0 && willSkip === 0) || commitAllLoading || authUser?.in_jail) return;
    setCommitAllLoading(true);

    try {
      const res = await api.post('/crimes/commit-all');
      const committed = Number(res.data?.committed || 0);
      const failed = Number(res.data?.failed || 0);
      const skipsUsed = Number(res.data?.skips_used || 0);
      const totalCash = Number(res.data?.total_cash || 0);
      const totalRespect = Number(res.data?.total_respect || 0);
      const errors = Array.isArray(res.data?.errors) ? res.data.errors : [];
      if (committed > 0 || failed > 0) {
        refreshUser();
        const parts = [`Committed ${committed} crime${committed !== 1 ? 's' : ''}`];
        if (skipsUsed > 0) parts.push(`${skipsUsed} skip${skipsUsed !== 1 ? 's' : ''} (−50% cash)`);
        if (failed > 0) parts.push(`${failed} failed`);
        if (totalCash > 0 || totalRespect > 0) {
          const rewards = [];
          if (totalCash > 0) rewards.push(`$${totalCash.toLocaleString()}`);
          if (totalRespect > 0) rewards.push(`${totalRespect.toLocaleString()} respect`);
          parts.push(`earned ${rewards.join(' + ')}`);
        }
        toast.success(parts.join(' · '));
      }
      errors.slice(0, 3).forEach((msg) => toast.error(String(msg)));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
      const jailed = String(e.response?.data?.detail || '').toLowerCase().includes('while in jail');
      if (jailed) {
        try { window.dispatchEvent(new CustomEvent('app:refresh-user', { detail: { in_jail: true } })); } catch (_) { /* ignore */ }
        return;
      }
    } finally {
      setCommitAllLoading(false);
    }
    // Refetch after the button stops loading so the wait matches server work, not a second full page round-trip.
    clearCrimesPrefetch();
    fetchCrimes(true).catch(() => {});
  };

  const regularCrimeRows = crimeRows.filter((c) => c.crime_type !== 'prestige');
  const prestigeCrimeRows = crimeRows.filter((c) => c.crime_type === 'prestige' && c.unlocked);
  const commitAllReady = regularCrimeRows.filter((c) => c.can_commit).length;
  const commitAllOnCooldown = regularCrimeRows.filter(
    (c) => c.unlocked !== false && !c.can_commit && c.next_available,
  ).length;
  const commitAllSkipBudget = skipTokens + skipCredits;
  const commitAllSkippable = canSkipCooldown ? Math.min(commitAllOnCooldown, Math.max(0, commitAllSkipBudget)) : 0;
  const commitAllCount = commitAllReady + commitAllSkippable;

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="crimes-page">
      <style>{CRIMES_STYLES}</style>

      <div className="relative cr-fade-in flex items-center gap-2 flex-wrap">
        <p className="text-[9px] text-zinc-500 font-heading italic">Commit crimes for cash and rank. Fail and you risk jail.</p>
        <StatusIcons inJail={!!authUser?.in_jail} autoRankActive={autoRankCrimesDisabled === true} />
      </div>

      {/* Crimes list */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 cr-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
            Available Crimes
          </span>
          {!authUser?.in_jail && autoRankCrimesDisabled === false && commitAllCount > 0 && (
            <button
              type="button"
              onClick={commitAll}
              disabled={commitAllLoading}
              title={
                commitAllSkippable > 0
                  ? `Commit ready crimes, then burn up to ${commitAllSkippable} Crime Skip(s) for on-cooldown crimes (−50% cash each)`
                  : 'Commit all ready crimes'
              }
              className="tap-feedback min-h-9 text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/40 hover:bg-primary/10 active:scale-[0.97] rounded px-2.5 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              {commitAllLoading
                ? '...'
                : commitAllSkippable > 0
                  ? (
                    <>
                      <span className="sm:hidden">All ({commitAllCount}·{commitAllSkippable})</span>
                      <span className="hidden sm:inline">{`Commit All (${commitAllCount} · ${commitAllSkippable} skips)`}</span>
                    </>
                  )
                  : (
                    <>
                      <span className="sm:hidden">All ({commitAllCount})</span>
                      <span className="hidden sm:inline">{`Commit All (${commitAllCount})`}</span>
                    </>
                  )}
            </button>
          )}
        </div>

        <div className="p-1.5 space-y-0.5">
          {regularCrimeRows.map((crime) => (
            <CrimeRow
              key={crime.id}
              crime={crime}
              onCommit={commitCrime}
              manualPlayDisabled={autoRankCrimesDisabled}
              canSkip={canSkipCooldown}
              onSkip={skipCooldownAndCommit}
              skipBusy={skipBusyId === crime.id}
            />
          ))}
        </div>
        <div className="cr-art-line text-primary mx-2.5" />
      </div>

      {/* Prestige Crimes */}
      {prestigeCrimeRows.length > 0 && (
        <div className={`relative ${styles.panel} rounded-md overflow-hidden cr-fade-in mobile-panel`} style={{ animationDelay: '0.08s', border: '1px solid rgba(184,145,68,0.2)' }}>
          <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(184,145,68,0.5), transparent)' }} />
          <div className="px-2.5 py-1.5 border-b flex items-center gap-2" style={{ background: 'rgba(184,145,68,0.06)', borderColor: 'rgba(184,145,68,0.15)' }}>
            <Star size={10} style={{ color: 'var(--noir-primary-bright)' }} />
            <span className="text-[9px] font-heading font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--noir-primary-bright)' }}>
              Prestige Crimes
            </span>
            <span className="text-[8px] font-heading text-zinc-600 ml-1">— exclusive to each prestige level</span>
          </div>
          <div className="p-1.5 space-y-1.5">
            {prestigeCrimeRows.map((crime) => (
              <PrestigeCrimeRow
                key={crime.id}
                crime={crime}
                onCommit={commitCrime}
                manualPlayDisabled={autoRankCrimesDisabled}
                canSkip={canSkipCooldown}
                onSkip={skipCooldownAndCommit}
                skipBusy={skipBusyId === crime.id}
              />
            ))}
          </div>
          <div className="cr-art-line mx-2.5" style={{ color: 'rgba(184,145,68,0.3)' }} />
        </div>
      )}

      {/* Stats — below prestige crimes */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 cr-fade-in mobile-panel`} style={{ animationDelay: '0.03s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Crime stats</span>
        </div>
        <div className="p-2 text-[10px] font-heading text-mutedForeground space-y-1">
          <div>
            Crimes today:{' '}
            <span className="text-primary font-bold tabular-nums">{(crimeStats.count_today ?? 0).toLocaleString()}</span>
            {' '}· Successful today{' '}
            <span className="text-emerald-400 font-bold tabular-nums">{(crimeStats.success_today ?? 0).toLocaleString()}</span>
            {' '}· Past week{' '}
            <span className="text-primary font-bold tabular-nums">{(crimeStats.count_week ?? 0).toLocaleString()}</span>
            {' '}(
            <span className="text-emerald-400 font-bold tabular-nums">{(crimeStats.success_week ?? 0).toLocaleString()} successful</span>
            )
          </div>
          <div className="text-[9px]">
            Profit today{' '}
            <span className="text-emerald-400 font-bold tabular-nums">${(crimeStats.profit_today ?? 0).toLocaleString()}</span>
            {' '}· Past 24h{' '}
            <span className="text-emerald-400 font-bold tabular-nums">${(crimeStats.profit_24h ?? 0).toLocaleString()}</span>
            {' '}· Past week{' '}
            <span className="text-emerald-400 font-bold tabular-nums">${(crimeStats.profit_week ?? 0).toLocaleString()}</span>
          </div>
        </div>
        <div className="cr-art-line text-primary mx-2.5" />
      </div>
    </div>
  );
}
