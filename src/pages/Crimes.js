import { useMemo, useState, useEffect } from 'react';
import { HelpCircle, Clock, AlertCircle, Bot, Skull } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const CRIMES_STYLES = `
  @keyframes cr-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .cr-fade-in { animation: cr-fade-in 0.4s ease-out both; }
  .cr-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .cr-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

// Constants
const CRIME_SUCCESS_RATES = {
  petty: 0.7,
  medium: 0.5,
  major: 0.3,
};

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
    if (!hasCooldown) return;

    let hasRefetched = false;
    const intervalId = setInterval(() => {
      const stillHasCooldown = crimes.some((c) => c.next_available && secondsUntil(c.next_available) > 0);
      
      if (!stillHasCooldown && !hasRefetched) {
        hasRefetched = true;
        onCooldownExpired();
      }
      
      setTick((prev) => prev + 1);
    }, TICK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [crimes, onCooldownExpired]);

  return tick;
};

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
    <Skull size={28} className="text-primary/40 animate-pulse" />
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading...</span>
  </div>
);

const JailNotice = () => (
  <div className={`relative p-2.5 ${styles.panel} border border-amber-500/40 rounded-lg cr-fade-in overflow-hidden`}>
    <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
    <div className="flex items-center gap-2">
      <AlertCircle size={14} className="text-amber-400 shrink-0" />
      <span className="text-amber-200/80">
        <strong className="text-amber-300">Incarcerated</strong> — Can't commit crimes while in jail
      </span>
    </div>
  </div>
);

const AutoRankCrimesNotice = () => (
  <div className={`relative p-2.5 ${styles.panel} border border-amber-500/40 rounded-lg cr-fade-in overflow-hidden`}>
    <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
    <div className="flex items-center gap-2">
      <Bot size={14} className="text-amber-400 shrink-0" />
      <span className="text-amber-200/80">
        <strong className="text-amber-300">Auto Rank</strong> — Crimes are running automatically. Manual play disabled.
      </span>
    </div>
  </div>
);

const EventBanner = ({ event }) => {
  if (!event?.name || (event.kill_cash === 1 && event.rank_points === 1)) {
    return null;
  }

  return (
    <div className="px-3 py-2 bg-primary/8 border border-primary/20 rounded-lg cr-fade-in">
      <p className="text-xs font-heading">
        <span className="text-primary font-bold">✨ {event.name}</span>
        <span className="text-mutedForeground ml-2">{event.message}</span>
      </p>
    </div>
  );
};

// Crime progress bar: 10–92%, similar to rank bar (fail/jail drops max 15%)
const CrimeProgressBar = ({ progress }) => {
  const pct = Math.min(92, Math.max(10, Number(progress) || 10));
  const barPct = ((pct - 10) / 82) * 100; // 10% = 0% fill, 92% = 100% fill
  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      title={`Crime success rate: ${pct}%. Success +3–5%; fail -1–3%; once you've hit 92%, it never goes below 77%.`}
    >
      <div
        style={{
          width: 48,
          height: 5,
          backgroundColor: '#333333',
          borderRadius: 9999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${barPct}%`,
            minWidth: barPct > 0 ? 4 : 0,
            background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))',
            borderRadius: 9999,
            transition: 'width 0.3s ease',
          }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={10}
          aria-valuemax={92}
        />
      </div>
      <span className="text-[10px] text-primary font-heading w-7">{pct}%</span>
    </div>
  );
};

// Compact crime row
const CrimeRow = ({ crime, onCommit, manualPlayDisabled }) => {
  const unavailable = !crime.can_commit && (!crime.remaining || crime.remaining <= 0);
  const onCooldown = !crime.can_commit && crime.remaining && crime.remaining > 0;
  const showLocked = manualPlayDisabled && crime.can_commit;

  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-all cr-row ${
        crime.can_commit 
          ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20' 
          : 'bg-zinc-800/20 border border-transparent opacity-60'
      }`}
      data-testid={`crime-row-${crime.id}`}
    >
      {/* Crime info (same layout as GTA: name + unlock badge when locked) */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-primary/50 text-xs shrink-0">▸</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap gap-y-0.5">
            <span className="text-sm font-heading font-bold text-foreground truncate">
              {crime.name}
            </span>
            {crime.unlocked === false && crime.min_rank_name && (
              <span
                className="shrink-0 inline-flex items-center gap-1 bg-zinc-800/50 text-mutedForeground rounded px-2 py-0.5 text-[10px] font-bold uppercase border border-zinc-700/50"
                title={`Unlocked at rank ${crime.min_rank_name}`}
              >
                <HelpCircle size={10} />
                Unlocked at rank {crime.min_rank_name}
              </span>
            )}
          </div>
          <div className="text-[10px] text-mutedForeground truncate hidden sm:block mt-0.5">
            {crime.description}
          </div>
        </div>
      </div>

      {/* Crime progress bar (only when unlocked by rank) */}
      {crime.unlocked !== false && <CrimeProgressBar progress={crime.progress} />}

      {/* Risk */}
      <div className="shrink-0 w-12 text-center">
        <span className={`text-xs font-bold tabular-nums ${crime.can_commit ? 'text-red-400' : 'text-mutedForeground'}`}>
          {unavailable ? '—' : `${crime.risk}%`}
        </span>
      </div>

      {/* Cooldown */}
      <div className="shrink-0 w-14 text-center">
        {onCooldown && crime.remaining > 0 ? (
          <div className="flex items-center justify-center gap-1 text-xs text-mutedForeground font-heading whitespace-nowrap">
            <Clock size={10} className="text-primary shrink-0" />
            <span>{crime.remaining}s</span>
          </div>
        ) : (
          <span className="text-[10px] text-mutedForeground whitespace-nowrap truncate block" title={crime.wait}>{crime.wait}</span>
        )}
      </div>

      {/* Action (Commit / Wait / — for rank-locked / Locked when Auto Rank) */}
      <div className="shrink-0 w-[72px] flex justify-end">
        {showLocked ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Locked
          </button>
        ) : crime.can_commit ? (
          <button
            type="button"
            onClick={() => onCommit(crime.id)}
            className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation font-heading"
            data-testid={`commit-crime-${crime.id}`}
          >
            💰 Commit
          </button>
        ) : onCooldown ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Wait
          </button>
        ) : crime.unlocked === false && crime.min_rank_name ? (
          <span className="text-[10px] text-mutedForeground">—</span>
        ) : (
          <span className="text-[10px] text-mutedForeground">Locked</span>
        )}
      </div>
    </div>
  );
};

// Main component
export default function Crimes() {
  const [crimes, setCrimes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [crimeStats, setCrimeStats] = useState({
    count_today: 0, count_week: 0, success_today: 0, success_week: 0,
    profit_today: 0, profit_24h: 0, profit_week: 0,
  });

  const [autoRankCrimesDisabled, setAutoRankCrimesDisabled] = useState(false);

  const fetchCrimes = async () => {
    try {
      const [crimesRes, meRes, eventsRes, statsRes, autoRankRes] = await Promise.all([
        api.get('/crimes'),
        api.get('/auth/me'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/crimes/stats').catch(() => ({ data: {} })),
        api.get('/auto-rank/me').catch(() => ({ data: {} })),
      ]);
      
      setCrimes(crimesRes.data);
      setUser(meRes.data);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
      setCrimeStats(statsRes.data || {});
      const ar = autoRankRes.data || {};
      setAutoRankCrimesDisabled(!!(ar.auto_rank_crimes || ar.auto_rank_bust_every_5_sec));
    } catch (error) {
      toast.error('Failed to load crimes');
      console.error('Error fetching crimes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCrimes();
  }, []);

  const tick = useCooldownTicker(crimes, fetchCrimes);

  const [commitAllLoading, setCommitAllLoading] = useState(false);

  const commitCrime = async (crimeId) => {
    try {
      const response = await api.post(`/crimes/${crimeId}/commit`);
      const progressAfter = response.data?.progress_after;

      if (response.data.success) {
        toast.success(response.data.message);
        refreshUser();
      } else {
        toast.error(response.data.message);
      }

      if (progressAfter != null) {
        setCrimes((prev) =>
          prev.map((c) =>
            c.id === crimeId ? { ...c, progress: progressAfter } : c
          )
        );
      }
      await fetchCrimes();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to commit crime');
      console.error('Error committing crime:', error);
    }
  };

  const crimeRows = useMemo(() => {
    void tick;
    
    const inJail = !!user?.in_jail;

    return crimes.map((crime) => {
      const progress = Math.min(92, Math.max(10, Number(crime.progress) ?? 10));
      const successRate = progress / 100;
      const risk = Math.round(100 - progress);
      const remaining = crime.next_available ? secondsUntil(crime.next_available) : null;
      
      const canCommit = !inJail && (
        crime.can_commit || 
        (crime.next_available && (remaining === null || remaining <= 0))
      );
      
      const lockedByRank = crime.unlocked === false && crime.min_rank_name;
      const wait = canCommit
        ? formatWaitFromMinutes(crime.cooldown_minutes)
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
  }, [crimes, tick, user?.in_jail]);

  const commitAll = async () => {
    const available = crimeRows.filter((c) => c.can_commit);
    if (available.length === 0 || commitAllLoading || user?.in_jail) return;
    setCommitAllLoading(true);
    let committed = 0;
    let failed = 0;
    let totalCash = 0;
    let totalRankPoints = 0;
    
    try {
      for (const crime of available) {
        try {
          const response = await api.post(`/crimes/${crime.id}/commit`);
          if (response.data?.success) {
            committed += 1;
            
            const msg = response.data?.message || '';
            const cashMatch = msg.match(/\$([0-9,]+)/);
            const rpMatch = msg.match(/(\d+)\s*(?:RP|rank points?)/i);
            
            if (cashMatch) {
              totalCash += parseInt(cashMatch[1].replace(/,/g, ''), 10) || 0;
            }
            if (rpMatch) {
              totalRankPoints += parseInt(rpMatch[1], 10) || 0;
            }
            
            refreshUser();
          } else {
            failed += 1;
            toast.error(response.data?.message || `${crime.name} failed`);
          }
          await fetchCrimes();
        } catch (err) {
          failed += 1;
          const detail = err.response?.data?.detail ?? err.message ?? 'Request failed';
          toast.error(detail);
          await refreshUser();
          await fetchCrimes();
          if (typeof detail === 'string' && detail.toLowerCase().includes('jail')) {
            break;
          }
        }
      }
      if (committed > 0) {
        const parts = [`Committed ${committed} crime${committed !== 1 ? 's' : ''}`];
        if (totalCash > 0 || totalRankPoints > 0) {
          const rewards = [];
          if (totalCash > 0) rewards.push(`$${totalCash.toLocaleString()}`);
          if (totalRankPoints > 0) rewards.push(`${totalRankPoints.toLocaleString()} RP`);
          parts.push(`earned ${rewards.join(' + ')}`);
        }
        toast.success(parts.join(' and '));
      }
    } finally {
      setCommitAllLoading(false);
    }
  };

  const commitAllCount = crimeRows.filter((c) => c.can_commit).length;

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <style>{CRIMES_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="crimes-page">
      <style>{CRIMES_STYLES}</style>

      <div className="relative cr-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">The Grind</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-2">
          <Skull size={24} /> Crimes
        </h1>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">Commit crimes for cash and rank. Fail and you risk jail.</p>
      </div>

      {user?.in_jail && <JailNotice />}
      {autoRankCrimesDisabled && <AutoRankCrimesNotice />}

      {eventsEnabled && <EventBanner event={event} />}

      {/* Stats */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 cr-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Crimes stats</span>
        </div>
        <div className="p-3 text-sm font-heading text-foreground">
          Crimes today: {crimeStats.count_today ?? 0}  successful today {crimeStats.success_today ?? 0}  past week {crimeStats.count_week ?? 0} ({crimeStats.success_week ?? 0} successful)
          <div className="mt-1.5 text-mutedForeground text-xs">
            Profit today ${(crimeStats.profit_today ?? 0).toLocaleString()}  ·  Past 24h ${(crimeStats.profit_24h ?? 0).toLocaleString()}  ·  Past week ${(crimeStats.profit_week ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="cr-art-line text-primary mx-3" />
      </div>

      {/* Crimes list */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 cr-fade-in`} style={{ animationDelay: '0.05s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
            Available Crimes
          </span>
          {!user?.in_jail && !autoRankCrimesDisabled && commitAllCount > 0 && (
            <button
              type="button"
              onClick={commitAll}
              disabled={commitAllLoading}
              className="text-[10px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/40 hover:bg-primary/10 rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              {commitAllLoading ? '...' : `Commit All (${commitAllCount})`}
            </button>
          )}
        </div>

        <div className="p-2 space-y-1">
          {crimeRows.map((crime) => (
            <CrimeRow key={crime.id} crime={crime} onCommit={commitCrime} manualPlayDisabled={autoRankCrimesDisabled} />
          ))}
        </div>
        <div className="cr-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
