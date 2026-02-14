import { useMemo, useState, useEffect } from 'react';
import { HelpCircle, Clock, AlertCircle } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = () => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2">
      Crimes
    </h1>
    <p className="text-sm text-mutedForeground">
      Commit crimes to earn cash and rank points.
    </p>
  </div>
);

const JailNotice = () => (
  <div className="p-3 bg-card border border-amber-500/40 rounded-sm text-sm">
    <div className="flex items-start gap-2.5">
      <div className="shrink-0 mt-0.5 p-1 rounded-full bg-amber-500/20">
        <AlertCircle size={14} className="text-amber-400" />
      </div>
      <div>
        <div className="font-bold text-amber-300 mb-0.5">Incarcerated</div>
        <div className="text-amber-200/80">
          Can't commit crimes while in jail. Serve time or bust out.
        </div>
      </div>
    </div>
  </div>
);

const EventBanner = ({ event }) => {
  if (!event?.name || (event.kill_cash === 1 && event.rank_points === 1)) {
    return null;
  }

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
          Live Event
        </span>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm font-heading font-bold text-primary mb-1">
          ✨ {event.name}
        </p>
        <p className="text-xs text-mutedForeground">
          {event.message}
        </p>
      </div>
    </div>
  );
};

// Mobile-optimized crime card
const CrimeCard = ({ crime, onCommit }) => {
  const unavailable = !crime.can_commit && (!crime.remaining || crime.remaining <= 0);
  const onCooldown = !crime.can_commit && crime.remaining && crime.remaining > 0;

  return (
    <div
      className={`bg-card border rounded-md p-4 transition-all ${
        crime.can_commit 
          ? 'border-primary/30 hover:border-primary/50 hover:bg-card/80' 
          : 'border-border opacity-75'
      }`}
      data-testid={`crime-row-${crime.id}`}
    >
      {/* Mobile: Stacked layout, Desktop: Horizontal */}
      <div className="space-y-3 md:space-y-0 md:flex md:items-center md:justify-between md:gap-4">
        
        {/* Top row on mobile: Crime info + Risk */}
        <div className="flex items-start justify-between gap-3 md:flex-1 md:min-w-0">
          {/* Left: Crime info */}
          <div className="flex-1 min-w-0">
            <h3 className="text-base md:text-sm font-heading font-bold text-foreground truncate flex items-center gap-1.5">
              <span className="text-primary/60">▸</span>
              {crime.name}
            </h3>
            <p className="text-sm md:text-xs text-mutedForeground line-clamp-1 md:truncate mt-1 md:mt-0.5">
              {crime.description}
            </p>
          </div>

          {/* Risk badge */}
          <div className="flex-shrink-0">
            <div className={`px-3 py-1.5 rounded-md text-sm md:text-xs font-bold transition-all ${
              crime.can_commit 
                ? 'bg-red-500/20 text-red-400 border border-red-500/40' 
                : 'bg-secondary text-mutedForeground border border-border'
            }`}>
              {unavailable ? '—' : `${crime.risk}%`}
            </div>
          </div>
        </div>

        {/* Bottom row on mobile: Timer + Button */}
        <div className="flex items-center justify-between gap-3 md:gap-2">
          {/* Timer (if on cooldown) */}
          <div className="flex-1 md:flex-shrink-0 md:flex-grow-0">
            {onCooldown && crime.remaining > 0 && (
              <div className="flex items-center gap-2 text-sm md:text-xs text-mutedForeground font-heading">
                <Clock size={14} className="text-primary shrink-0" />
                <span>{crime.wait}</span>
              </div>
            )}
          </div>

          {/* Action button */}
          <div className="flex-shrink-0">
            {crime.can_commit ? (
              <button
                type="button"
                onClick={() => onCommit(crime.id)}
                className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground active:scale-98 rounded-md px-5 py-2 md:px-4 md:py-1.5 text-sm md:text-xs font-bold uppercase tracking-wide shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all touch-manipulation border border-yellow-600/50"
                data-testid={`commit-crime-${crime.id}`}
              >
                💰 Commit
              </button>
            ) : onCooldown ? (
              <button
                type="button"
                disabled
                className="bg-secondary text-mutedForeground rounded-md px-4 py-2 md:px-3 md:py-1.5 text-sm md:text-xs font-bold uppercase tracking-wide border border-border cursor-not-allowed"
              >
                Wait
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="bg-secondary/70 text-mutedForeground rounded-md px-4 py-2 md:px-3 md:py-1.5 text-sm md:text-xs font-bold uppercase tracking-wide border border-border cursor-not-allowed flex items-center gap-1.5 opacity-60"
              >
                <HelpCircle size={13} className="opacity-60" />
                <span>Locked</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatsFooter = ({ totalCrimes = 0, crimeProfit = 0 }) => (
  <div className={`${styles.panel} rounded-md px-4 py-3`}>
    <div className="grid grid-cols-2 gap-4 text-center">
      <div className="space-y-1">
        <div className="text-xs text-mutedForeground uppercase tracking-wider font-heading">
          Total Crimes
        </div>
        <div className="text-xl font-heading font-bold text-primary">
          {totalCrimes.toLocaleString()}
        </div>
      </div>
      <div className="border-l border-border space-y-1">
        <div className="text-xs text-mutedForeground uppercase tracking-wider font-heading">
          Total Profit
        </div>
        <div className="text-xl font-heading font-bold text-primary">
          ${Number(crimeProfit).toLocaleString()}
        </div>
      </div>
    </div>
  </div>
);

// Main component
export default function Crimes() {
  const [crimes, setCrimes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);

  const fetchCrimes = async () => {
    try {
      const [crimesRes, meRes, eventsRes] = await Promise.all([
        api.get('/crimes'),
        api.get('/auth/me'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      ]);
      
      setCrimes(crimesRes.data);
      setUser(meRes.data);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
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
      
      if (response.data.success) {
        toast.success(response.data.message);
        refreshUser();
      } else {
        toast.error(response.data.message);
      }
      
      await fetchCrimes();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to commit crime');
      console.error('Error committing crime:', error);
    }
  };

  const crimeRows = useMemo(() => {
    // Include tick to trigger recalculation on countdown
    void tick;
    
    const inJail = !!user?.in_jail;

    return crimes.map((crime) => {
      const successRate = getSuccessRate(crime.crime_type);
      const risk = Math.round((1 - successRate) * 100);
      const remaining = crime.next_available ? secondsUntil(crime.next_available) : null;
      
      // Crime is available if not in jail AND (can_commit flag is true OR cooldown has expired)
      const canCommit = !inJail && (
        crime.can_commit || 
        (crime.next_available && (remaining === null || remaining <= 0))
      );
      
      const wait = canCommit
        ? formatWaitFromMinutes(crime.cooldown_minutes)
        : remaining && remaining > 0
          ? `${remaining}s`
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
    let totalCash = 0;
    try {
      for (const crime of available) {
        try {
          const response = await api.post(`/crimes/${crime.id}/commit`);
          if (response.data?.success) {
            committed += 1;
            totalCash += Number(response.data?.reward) || 0;
            refreshUser();
          } else {
            toast.error(response.data?.message || `${crime.name} failed`);
          }
          await fetchCrimes();
        } catch (err) {
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
        toast.success(
          `You committed ${committed} crime${committed !== 1 ? 's' : ''} and made $${totalCash.toLocaleString()}`
        );
      }
    } finally {
      setCommitAllLoading(false);
    }
  };

  const commitAllCount = crimeRows.filter((c) => c.can_commit).length;

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="crimes-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader />
        {!user?.in_jail && commitAllCount > 0 && (
          <button
            type="button"
            onClick={commitAll}
            disabled={commitAllLoading}
            className="text-xs font-heading font-bold uppercase tracking-wider text-primary border border-primary/40 hover:bg-primary/10 rounded px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
          >
            {commitAllLoading ? '...' : `Commit all (${commitAllCount})`}
          </button>
        )}
      </div>

      {user?.in_jail && <JailNotice />}

      {eventsEnabled && <EventBanner event={event} />}

      {/* Crime cards */}
      <div className="space-y-3">
        {crimeRows.map((crime) => (
          <CrimeCard key={crime.id} crime={crime} onCommit={commitCrime} />
        ))}
      </div>

      <StatsFooter totalCrimes={user?.total_crimes} crimeProfit={user?.crime_profit} />
    </div>
  );
}
