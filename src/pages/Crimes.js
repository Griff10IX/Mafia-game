import { useMemo, useState, useEffect } from 'react';
import { Flame, HelpCircle, Clock, AlertCircle } from 'lucide-react';
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
    <div className="text-yellow-500 text-xl font-bold">Loading...</div>
  </div>
);

const PageHeader = () => (
  <div className="flex items-center justify-center flex-col gap-1.5 text-center px-4">
    <div className="flex items-center gap-3 w-full justify-center">
      <div className="h-px flex-1 max-w-[60px] bg-gradient-to-r from-transparent via-yellow-500/40 to-yellow-500/60" />
      <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 bg-clip-text text-transparent uppercase tracking-wider drop-shadow-lg">
        Crimes
      </h1>
      <div className="h-px flex-1 max-w-[60px] bg-gradient-to-l from-transparent via-yellow-500/40 to-yellow-500/60" />
    </div>
    <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] font-medium">
      Commit Crimes • Earn Cash
    </p>
  </div>
);

const JailNotice = () => (
  <div className="mx-3 rounded-lg border border-amber-500/40 bg-gradient-to-br from-amber-950/40 to-amber-900/20 px-3 py-2.5 text-xs text-amber-200 flex items-start gap-2.5 shadow-lg shadow-amber-500/10 backdrop-blur-sm">
    <div className="shrink-0 mt-0.5 p-1 rounded-full bg-amber-500/20">
      <AlertCircle size={14} className="text-amber-400" />
    </div>
    <div>
      <div className="font-bold text-amber-300 mb-0.5">Incarcerated</div>
      <div className="text-amber-200/80">Can't commit crimes while in jail. Serve time or bust out.</div>
    </div>
  </div>
);

const EventBanner = ({ event }) => {
  if (!event?.name || (event.kill_cash === 1 && event.rank_points === 1)) {
    return null;
  }

  return (
    <div className="px-3">
      <div className="w-full bg-gradient-to-br from-zinc-900 to-zinc-900/50 border border-yellow-500/30 rounded-lg overflow-hidden shadow-lg shadow-yellow-500/10 backdrop-blur-sm">
        <div className="bg-gradient-to-r from-yellow-500/10 to-yellow-600/5 px-3 py-2 border-b border-yellow-500/20 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
          <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest">
            Live Event
          </span>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-sm font-bold text-yellow-300 flex items-center gap-2">
            <span>✨</span>
            {event.name}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">
            {event.message}
          </p>
        </div>
      </div>
    </div>
  );
};

// Mobile-friendly crime card
const CrimeCard = ({ crime, onCommit }) => {
  const unavailable = !crime.can_commit && (!crime.remaining || crime.remaining <= 0);
  const onCooldown = !crime.can_commit && crime.remaining && crime.remaining > 0;

  return (
    <div
      className={`relative bg-gradient-to-br from-zinc-800/90 to-zinc-900/70 border rounded-lg p-4 md:p-3.5 transition-all backdrop-blur-sm ${
        crime.can_commit 
          ? 'border-emerald-500/40 shadow-xl shadow-emerald-900/30 active:shadow-emerald-800/40 active:border-emerald-400/60 md:hover:shadow-emerald-800/40 md:hover:border-emerald-400/60 md:hover:from-zinc-800 md:hover:to-zinc-900' 
          : 'border-zinc-700/60 opacity-75'
      }`}
      data-testid={`crime-row-${crime.id}`}
    >
      {/* Stronger glow effect for available crimes */}
      {crime.can_commit && (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/10 via-green-500/5 to-transparent rounded-lg pointer-events-none" />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />
        </>
      )}
      
      {/* Mobile: Stacked layout, Desktop: Horizontal */}
      <div className="relative space-y-3 md:space-y-0 md:flex md:items-center md:justify-between md:gap-3">
        
        {/* Top row on mobile: Crime info + Risk */}
        <div className="flex items-start justify-between gap-3 md:flex-1 md:min-w-0">
          {/* Left: Crime info */}
          <div className="flex-1 min-w-0">
            <h3 className="text-base md:text-sm font-bold text-gray-100 truncate flex items-center gap-1.5">
              <span className="text-emerald-400/80 text-lg md:text-base">▸</span>
              {crime.name}
            </h3>
            <p className="text-sm md:text-xs text-gray-400 line-clamp-1 md:truncate mt-1 md:mt-0.5">
              {crime.description}
            </p>
          </div>

          {/* Risk badge - visible on all screens */}
          <div className="flex-shrink-0">
            <div className={`px-3 py-1.5 rounded-md text-sm md:text-xs font-bold transition-all ${
              crime.can_commit 
                ? 'bg-gradient-to-br from-red-600/30 to-red-700/20 text-red-300 border border-red-500/50 shadow-md shadow-red-900/30' 
                : 'bg-zinc-800 text-gray-500 border border-zinc-700'
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
              <div className="flex items-center gap-2 px-3 py-2 md:px-2 md:py-1 bg-emerald-950/40 border border-emerald-500/30 rounded text-sm md:text-xs text-emerald-300 font-bold">
                <Clock size={16} className="md:hidden animate-pulse text-emerald-400" />
                <Clock size={13} className="hidden md:block animate-pulse text-emerald-400" />
                <span>{crime.wait}</span>
              </div>
            )}
          </div>

          {/* Action button - larger on mobile */}
          <div className="flex-shrink-0">
            {crime.can_commit ? (
              <button
                type="button"
                onClick={() => onCommit(crime.id)}
                className="relative bg-gradient-to-br from-emerald-500 via-green-600 to-emerald-700 active:from-emerald-400 active:via-green-500 active:to-emerald-600 md:hover:from-emerald-400 md:hover:via-green-500 md:hover:to-emerald-600 text-white active:scale-95 rounded-lg md:rounded-md px-6 py-2.5 md:px-5 md:py-2 text-sm md:text-xs font-bold uppercase tracking-wide shadow-xl shadow-emerald-900/50 border border-emerald-400/30 transition-all touch-manipulation overflow-hidden"
                data-testid={`commit-crime-${crime.id}`}
              >
                <span className="relative z-10 flex items-center gap-2 md:gap-1.5">
                  💰 Commit
                </span>
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                <div className="absolute inset-0 bg-white/0 active:bg-white/10 md:hover:bg-white/10 transition-all" />
                <div className="absolute top-0 left-0 right-0 h-px bg-white/30" />
              </button>
            ) : onCooldown ? (
              <button
                type="button"
                disabled
                className="bg-zinc-800 text-gray-500 rounded-lg md:rounded-md px-5 py-2.5 md:px-4 md:py-2 text-sm md:text-xs font-bold uppercase tracking-wide border border-zinc-700 cursor-not-allowed"
              >
                Wait
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="bg-zinc-800/70 text-gray-600 rounded-lg md:rounded-md px-5 py-2.5 md:px-4 md:py-2 text-sm md:text-xs font-bold uppercase tracking-wide border border-zinc-700/50 cursor-not-allowed flex items-center gap-2 md:gap-1.5 opacity-60"
              >
                <HelpCircle size={16} className="md:hidden opacity-60" />
                <HelpCircle size={13} className="hidden md:block opacity-60" />
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
  <div className="px-3">
    <div className="w-full bg-gradient-to-br from-zinc-900 to-zinc-900/50 border border-yellow-500/20 rounded-lg px-3 py-3 shadow-lg shadow-yellow-500/5">
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="space-y-1">
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            Crimes
          </div>
          <div className="text-xl font-bold bg-gradient-to-br from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
            {totalCrimes.toLocaleString()}
          </div>
        </div>
        <div className="border-l border-yellow-500/20 space-y-1">
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            Profit
          </div>
          <div className="text-xl font-bold bg-gradient-to-br from-green-400 to-green-600 bg-clip-text text-transparent">
            ${Number(crimeProfit).toLocaleString()}
          </div>
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

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-6" data-testid="crimes-page">
      <div className="space-y-4 py-5">
        <PageHeader />

        {user?.in_jail && <JailNotice />}

        {eventsEnabled && <EventBanner event={event} />}

        {/* Mobile-optimized crime cards */}
        <div className="px-3">
          <div className="space-y-2.5">
            {crimeRows.map((crime) => (
              <CrimeCard key={crime.id} crime={crime} onCommit={commitCrime} />
            ))}
          </div>
        </div>

        <StatsFooter totalCrimes={user?.total_crimes} crimeProfit={user?.crime_profit} />
      </div>
    </div>
  );
}
