import { useMemo, useState, useEffect } from 'react';
import { HelpCircle, Clock, AlertCircle, Bot, Skull } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { getCrimesPrefetch, clearCrimesPrefetch } from '../utils/prefetchCache';
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
  <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
    <Skull size={22} className="text-primary/40 animate-pulse" />
    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading...</span>
  </div>
);

const CrimesPageSkeleton = () => (
  <div className={`space-y-2 ${styles.pageContent}`}>
    <style>{CRIMES_STYLES}</style>
    <div className="relative">
      <div className="h-3 w-3/4 rounded bg-zinc-700/60 animate-pulse" />
    </div>
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Crimes stats</span>
      </div>
      <div className="p-2 space-y-1">
        <div className="h-3 w-full rounded bg-zinc-700/50 animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-zinc-700/40 animate-pulse" />
      </div>
      <div className="cr-art-line text-primary mx-2.5" />
    </div>
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Available Crimes</span>
      </div>
      <div className="p-1.5 space-y-0.5">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-zinc-800/20 border border-transparent">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <span className="w-2 h-2 rounded bg-zinc-600/60 shrink-0" />
              <div className="h-3 w-24 rounded bg-zinc-700/50 animate-pulse shrink-0" />
              <div className="h-3 w-16 rounded bg-zinc-700/40 animate-pulse hidden sm:block" />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <div className="h-4 w-8 rounded bg-zinc-700/50 animate-pulse" />
              <div className="h-6 w-14 rounded bg-zinc-700/60 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      <div className="cr-art-line text-primary mx-2.5" />
    </div>
  </div>
);

const JailNotice = () => (
  <div className={`relative p-2 ${styles.panel} border border-amber-500/40 rounded-md cr-fade-in overflow-hidden`}>
    <div className="h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
    <div className="flex items-center gap-1.5">
      <AlertCircle size={10} className="text-amber-400 shrink-0" />
      <span className="text-amber-200/80 text-[10px]">
        <strong className="text-amber-300">Incarcerated</strong> — Can't commit crimes while in jail
      </span>
    </div>
  </div>
);

const AutoRankCrimesNotice = () => (
  <div className={`relative p-2 ${styles.panel} border border-amber-500/40 rounded-md cr-fade-in overflow-hidden`}>
    <div className="h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
    <div className="flex items-center gap-1.5">
      <Bot size={10} className="text-amber-400 shrink-0" />
      <span className="text-amber-200/80 text-[10px]">
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
    <div className="px-2 py-1.5 bg-primary/8 border border-primary/20 rounded-md cr-fade-in">
      <p className="text-[10px] font-heading">
        <span className="text-primary font-bold">✨ {event.name}</span>
        <span className="text-mutedForeground ml-1">{event.message}</span>
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
          aria-valuemin={10}
          aria-valuemax={92}
        />
      </div>
      <span className="text-[9px] text-primary font-heading w-6">{pct}%</span>
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
      className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md transition-all cr-row ${
        crime.can_commit 
          ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20' 
          : 'bg-zinc-800/20 border border-transparent opacity-60'
      }`}
      data-testid={`crime-row-${crime.id}`}
    >
      {/* Crime info (same layout as GTA: name + unlock badge when locked) */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span className="text-primary/50 text-[10px] shrink-0">▸</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap gap-y-0.5">
            <span className="text-[11px] font-heading font-bold text-foreground truncate">
              {crime.name}
            </span>
            {crime.unlocked === false && crime.min_rank_name && (
              <span
                className="shrink-0 inline-flex items-center gap-0.5 bg-zinc-800/50 text-mutedForeground rounded px-1 py-0.5 text-[9px] font-bold uppercase border border-zinc-700/50"
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

      {/* Action (Commit / Wait / — for rank-locked / Locked when Auto Rank) */}
      <div className="shrink-0 w-[60px] flex justify-end">
        {showLocked ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Locked
          </button>
        ) : crime.can_commit ? (
          <button
            type="button"
            onClick={() => onCommit(crime.id)}
            className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation font-heading"
            data-testid={`commit-crime-${crime.id}`}
          >
            💰 Commit
          </button>
        ) : onCooldown ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Wait
          </button>
        ) : crime.unlocked === false && crime.min_rank_name ? (
          <span className="text-[9px] text-mutedForeground">—</span>
        ) : (
          <span className="text-[9px] text-mutedForeground">Locked</span>
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
      const prefetched = getCrimesPrefetch();
      let crimesData;
      if (prefetched) {
        crimesData = prefetched;
        const meRes = await api.get('/auth/me');
        setCrimes(crimesData);
        setUser(meRes.data);
        setLoading(false);
      } else {
        const [crimesRes, meRes] = await Promise.all([
          api.get('/crimes'),
          api.get('/auth/me'),
        ]);
        crimesData = crimesRes.data;
        setCrimes(crimesData);
        setUser(meRes.data);
        setLoading(false);
      }
      Promise.all([
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/crimes/stats').catch(() => ({ data: {} })),
        api.get('/auto-rank/me').catch(() => ({ data: {} })),
      ]).then(([eventsRes, statsRes, autoRankRes]) => {
        setEvent(eventsRes.data?.event ?? null);
        setEventsEnabled(!!eventsRes.data?.events_enabled);
        setCrimeStats(statsRes.data || {});
        const ar = autoRankRes.data || {};
        setAutoRankCrimesDisabled(!!(ar.auto_rank_crimes || ar.auto_rank_bust_every_5_sec));
      }).catch(() => {});
    } catch (error) {
      toast.error('Failed to load crimes');
      console.error('Error fetching crimes:', error);
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
      clearCrimesPrefetch();
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
      const results = await Promise.allSettled(
        available.map((crime) => api.post(`/crimes/${crime.id}/commit`))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const crime = available[i];
        if (result.status === 'fulfilled') {
          const response = result.value;
          if (response.data?.success) {
            committed += 1;
            const msg = response.data?.message || '';
            const cashMatch = msg.match(/\$([0-9,]+)/);
            const rpMatch = msg.match(/(\d+)\s*(?:RP|rank points?)/i);
            if (cashMatch) totalCash += parseInt(cashMatch[1].replace(/,/g, ''), 10) || 0;
            if (rpMatch) totalRankPoints += parseInt(rpMatch[1], 10) || 0;
          } else {
            failed += 1;
            toast.error(response.data?.message || `${crime.name} failed`);
          }
        } else {
          failed += 1;
          const detail = result.reason?.response?.data?.detail ?? result.reason?.message ?? 'Request failed';
          toast.error(detail);
        }
      }

      if (committed > 0) {
        refreshUser();
        const parts = [`Committed ${committed} crime${committed !== 1 ? 's' : ''}`];
        if (totalCash > 0 || totalRankPoints > 0) {
          const rewards = [];
          if (totalCash > 0) rewards.push(`$${totalCash.toLocaleString()}`);
          if (totalRankPoints > 0) rewards.push(`${totalRankPoints.toLocaleString()} RP`);
          parts.push(`earned ${rewards.join(' + ')}`);
        }
        toast.success(parts.join(' and '));
      }
      clearCrimesPrefetch();
      await fetchCrimes();
    } finally {
      setCommitAllLoading(false);
    }
  };

  const commitAllCount = crimeRows.filter((c) => c.can_commit).length;

  if (loading) {
    return <CrimesPageSkeleton />;
  }

  return (
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="crimes-page">
      <style>{CRIMES_STYLES}</style>

      <div className="relative cr-fade-in">
        <p className="text-[9px] text-zinc-500 font-heading italic">Commit crimes for cash and rank. Fail and you risk jail.</p>
      </div>

      {user?.in_jail && <JailNotice />}
      {autoRankCrimesDisabled && <AutoRankCrimesNotice />}

      {eventsEnabled && <EventBanner event={event} />}

      {/* Stats */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 cr-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Crimes stats</span>
        </div>
        <div className="p-2 text-[10px] font-heading text-foreground">
          Crimes today: {crimeStats.count_today ?? 0}  successful today {crimeStats.success_today ?? 0}  past week {crimeStats.count_week ?? 0} ({crimeStats.success_week ?? 0} successful)
          <div className="mt-1 text-mutedForeground text-[9px]">
            Profit today ${(crimeStats.profit_today ?? 0).toLocaleString()}  ·  Past 24h ${(crimeStats.profit_24h ?? 0).toLocaleString()}  ·  Past week ${(crimeStats.profit_week ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="cr-art-line text-primary mx-2.5" />
      </div>

      {/* Crimes list */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 cr-fade-in`} style={{ animationDelay: '0.05s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
            Available Crimes
          </span>
          {!user?.in_jail && !autoRankCrimesDisabled && commitAllCount > 0 && (
            <button
              type="button"
              onClick={commitAll}
              disabled={commitAllLoading}
              className="text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/40 hover:bg-primary/10 rounded px-1.5 py-0.5 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              {commitAllLoading ? '...' : `Commit All (${commitAllCount})`}
            </button>
          )}
        </div>

        <div className="p-1.5 space-y-0.5">
          {crimeRows.map((crime) => (
            <CrimeRow key={crime.id} crime={crime} onCommit={commitCrime} manualPlayDisabled={autoRankCrimesDisabled} />
          ))}
        </div>
        <div className="cr-art-line text-primary mx-2.5" />
      </div>
    </div>
  );
}
