import { useState, useEffect, useMemo } from 'react';
import { Car, Lock, ChevronDown, ChevronRight } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// Constants
const TICK_INTERVAL = 1000;
const COLLAPSED_KEY = 'gta_garage_collapsed';

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
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const EventBanner = ({ event, eventsEnabled }) => {
  if (!eventsEnabled || !event?.name || (event.gta_success === 1 && event.rank_points === 1)) {
    return null;
  }

  return (
    <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded-md">
      <p className="text-xs font-heading">
        <span className="text-primary font-bold">✨ {event.name}</span>
        <span className="text-mutedForeground ml-2">{event.message}</span>
      </p>
    </div>
  );
};

// Compact GTA row
const GTARow = ({ option, attemptingOptionId, onAttempt, event, eventsEnabled }) => {
  const onCooldown = option.cooldown_until && formatCooldown(option.cooldown_until);
  const unlocked = option.unlocked;
  const defaultCooldown = formatDefaultCooldown(option.cooldown);
  const progress = Math.min(92, Math.max(10, Number(option.progress) ?? 10));
  const successRateDisplay = eventsEnabled && event?.gta_success
    ? Math.min(100, Math.round(progress * (event.gta_success ?? 1)))
    : progress;

  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md transition-all ${
        unlocked && !onCooldown
          ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20 hover:bg-zinc-800/50' 
          : 'bg-zinc-800/20 border border-transparent opacity-60'
      }`}
      data-testid={`gta-option-${option.id}`}
    >
      {/* Car info */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {unlocked ? (
          <Car className="text-primary/50 w-4 h-4 shrink-0" />
        ) : (
          <Lock className="text-mutedForeground/50 w-4 h-4 shrink-0" />
        )}
        <div className="min-w-0">
          <span className="text-sm font-heading font-bold text-foreground truncate block">
            {option.name}
          </span>
          <div className="text-[10px] text-mutedForeground truncate">
            Difficulty {option.difficulty}/5
            {!unlocked && ` • ${option.min_rank_name}`}
          </div>
        </div>
      </div>

      {/* Progress bar (only when unlocked) */}
      {unlocked && <GTAProgressBar progress={option.progress} />}

      {/* Success rate */}
      <div className="shrink-0 w-12 text-center">
        <span className={`text-xs font-bold ${unlocked ? 'text-primary' : 'text-mutedForeground'}`}>
          {successRateDisplay}%
        </span>
      </div>

      {/* Jail time */}
      <div className="shrink-0 w-10 text-center">
        <span className="text-xs font-bold text-red-400">{option.jail_time}s</span>
      </div>

      {/* Cooldown */}
      <div className="shrink-0 w-14 text-center">
        {onCooldown ? (
          <span className="text-xs text-mutedForeground font-heading">{onCooldown}</span>
        ) : unlocked ? (
          <span className="text-[10px] text-mutedForeground/60">{defaultCooldown}</span>
        ) : (
          <span className="text-[10px] text-mutedForeground">—</span>
        )}
      </div>

      {/* Action */}
      <div className="shrink-0">
        {unlocked && !onCooldown ? (
          <button
            type="button"
            onClick={() => onAttempt(option.id)}
            disabled={attemptingOptionId !== null}
            className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide shadow shadow-primary/20 transition-all touch-manipulation border border-yellow-600/50 disabled:opacity-60"
            data-testid={`attempt-gta-${option.id}`}
          >
            {attemptingOptionId === option.id ? '...' : '🚗 Steal'}
          </button>
        ) : onCooldown ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed"
          >
            Wait
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="bg-zinc-800/50 text-mutedForeground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-700/50 cursor-not-allowed flex items-center gap-1"
          >
            <Lock size={10} />
            Locked
          </button>
        )}
      </div>
    </div>
  );
};

const GarageSection = ({ garage, isCollapsed, onToggle }) => {
  if (garage.length === 0) return null;

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between hover:bg-primary/15 transition-colors"
      >
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
          🚗 Your Garage
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-primary font-heading font-bold">{garage.length} cars</span>
          <span className="text-primary/80">
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </button>
      
      {!isCollapsed && (
        <div className="p-3">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {garage.slice(0, 24).map((car, index) => (
              <div
                key={index}
                data-testid={`garage-car-${index}`}
                className="bg-zinc-800/30 border border-primary/10 rounded-sm p-1 flex flex-col items-center text-center hover:border-primary/30 transition-all"
              >
                <div className="w-full aspect-square rounded-sm overflow-hidden bg-zinc-900/50 shrink-0 mb-0.5">
                  {car.image ? (
                    <img
                      src={car.image}
                      alt={car.car_name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car size={20} className="text-primary/40" />
                    </div>
                  )}
                </div>
                <div className="text-[9px] font-heading font-bold text-primary truncate w-full leading-tight">
                  {car.car_name}
                </div>
              </div>
            ))}
          </div>
          {garage.length > 24 && (
            <p className="text-[10px] text-mutedForeground font-heading mt-2 text-center">
              + {garage.length - 24} more
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// GTA progress bar: 10–92%, same as crimes (fail -2% or -3%; once at 92% floor 77%)
const GTAProgressBar = ({ progress }) => {
  const pct = Math.min(92, Math.max(10, Number(progress) ?? 10));
  const barPct = ((pct - 10) / 82) * 100;
  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      title={`Success rate: ${pct}%. Success +3–5%; fail -1–3%; once you've hit 92%, it never goes below 77%.`}
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
      <span className="text-[10px] text-primary font-heading w-7">{pct}%</span>
    </div>
  );
};

const InfoSection = () => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        ℹ️ GTA System
      </h3>
    </div>
    <div className="p-3">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Unlock by rank (Goon → Consigliere)</span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>One attempt = all on cooldown</span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Higher difficulty = rarer cars + more RP</span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Failed = jail. Better cars = travel bonus</span>
        </li>
      </ul>
    </div>
  </div>
);

// Main component
export default function GTA() {
  const [options, setOptions] = useState([]);
  const [garage, setGarage] = useState([]);
  const [attemptingOptionId, setAttemptingOptionId] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [garageCollapsed, setGarageCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleGarage = () => {
    setGarageCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  };

  const fetchData = async () => {
    try {
      const [optionsRes, garageRes, eventsRes] = await Promise.allSettled([
        api.get('/gta/options'),
        api.get('/gta/garage'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } }))
      ]);
      
      if (optionsRes.status === 'fulfilled' && Array.isArray(optionsRes.value?.data)) {
        setOptions(optionsRes.value.data);
      } else if (optionsRes.status === 'rejected') {
        toast.error('Failed to load GTA options');
      }
      
      if (garageRes.status === 'fulfilled' && garageRes.value?.data) {
        setGarage(Array.isArray(garageRes.value.data.cars) ? garageRes.value.data.cars : []);
      }
      
      if (eventsRes.status === 'fulfilled' && eventsRes.value?.data) {
        setEvent(eventsRes.value.data?.event ?? null);
        setEventsEnabled(!!eventsRes.value.data?.events_enabled);
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
    return <LoadingSpinner />;
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="gta-page">
      <EventBanner event={event} eventsEnabled={eventsEnabled} />

      {/* GTA options list */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            Available Vehicles
          </span>
        </div>

        <div className="p-2 space-y-1">
          {options.map((option) => (
            <GTARow
              key={option.id}
              option={option}
              attemptingOptionId={attemptingOptionId}
              onAttempt={attemptGTA}
              event={event}
              eventsEnabled={eventsEnabled}
            />
          ))}
        </div>
      </div>

      <GarageSection 
        garage={garage} 
        isCollapsed={garageCollapsed} 
        onToggle={toggleGarage} 
      />

      <InfoSection />
    </div>
  );
}
