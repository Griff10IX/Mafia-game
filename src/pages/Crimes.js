import { useMemo, useState, useEffect, useCallback } from 'react';
import { HelpCircle, Clock, AlertCircle } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

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
      className={`relative bg-gradient-to-br from-zinc-900 to-zinc-900/50 border rounded-lg p-3 transition-all ${
        crime.can_commit 
          ? 'border-emerald-600/30 shadow-lg shadow-emerald-900/20 hover:shadow-emerald-800/30 hover:border-emerald-500/40' 
          : 'border-zinc-800/50 opacity-80'
      }`}
      data-testid={`crime-row-${crime.id}`}
    >
      {/* Glow effect for available crimes */}
      {crime.can_commit && (
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent rounded-lg pointer-events-none" />
      )}
      
      {/* Header with name and risk */}
      <div className="relative flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white truncate flex items-center gap-1.5">
            <span className="text-emerald-500/60">▸</span>
            {crime.name}
          </h3>
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {crime.description}
          </p>
        </div>
        <div className="shrink-0">
          <div className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
            crime.can_commit 
              ? 'bg-gradient-to-br from-red-500/20 to-red-600/10 text-red-400 border border-red-500/40 shadow-sm shadow-red-500/20' 
              : 'bg-zinc-800/80 text-gray-600 border border-zinc-700/50'
          }`}>
            {unavailable ? '—' : `${crime.risk}%`}
          </div>
        </div>
      </div>

      {/* Stats and action in one row */}
      <div className="relative flex items-center justify-between gap-2 mt-2.5">
        {/* Active countdown timer on the left (only when on cooldown) */}
        <div className="flex-1">
          {onCooldown && crime.remaining > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-bold">
              <Clock size={12} className="animate-pulse text-emerald-500" />
              <span>{crime.wait}</span>
            </div>
          )}
        </div>

        {/* Action button - compact */}
        <div className="shrink-0">
          {crime.can_commit ? (
            <button
              type="button"
              onClick={() => onCommit(crime.id)}
              className="relative bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-700 hover:from-emerald-500 hover:via-green-500 hover:to-emerald-600 text-white active:scale-95 rounded-md px-4 py-1.5 text-xs font-bold uppercase tracking-wide shadow-lg shadow-emerald-900/40 border border-emerald-500/30 transition-all touch-manipulation overflow-hidden"
              data-testid={`commit-crime-${crime.id}`}
            >
              <span className="relative z-10 flex items-center gap-1">
                💰 Commit
              </span>
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              <div className="absolute inset-0 bg-white/0 hover:bg-white/5 transition-all" />
            </button>
          ) : onCooldown ? (
            <button
              type="button"
              disabled
              className="bg-zinc-800/80 text-gray-500 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide border border-zinc-700/50 cursor-not-allowed opacity-60"
            >
              Wait
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="bg-zinc-800/50 text-gray-600 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide border border-zinc-700/30 cursor-not-allowed flex items-center gap-1 opacity-50"
            >
              <HelpCircle size={12} className="opacity-50" />
              Locked
            </button>
          )}
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

  const fetchCrimes = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchCrimes();
  }, [fetchCrimes]);

  const tick = useCooldownTicker(crimes, fetchCrimes);

  const commitCrime = useCallback(async (crimeId) => {
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
  }, [fetchCrimes]);

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