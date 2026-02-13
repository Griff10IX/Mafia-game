import { useState, useEffect, useMemo } from 'react';
import { Car, Lock, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// Constants
const TICK_INTERVAL = 1000;

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

const PageHeader = () => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2 flex items-center gap-3">
      <Car className="w-8 h-8 md:w-10 md:h-10" />
      GTA
    </h1>
    <p className="text-sm text-mutedForeground">
      Grand Theft Auto — steal prohibition-era vehicles
    </p>
  </div>
);

const EventBanner = ({ event, eventsEnabled }) => {
  if (!eventsEnabled || !event?.name || (event.gta_success === 1 && event.rank_points === 1)) {
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

const HeroImage = () => (
  <div
    className="relative h-32 md:h-40 rounded-md overflow-hidden border border-primary/30"
    style={{
      backgroundImage: 'url(https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?w=1920&q=80)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }}
  >
    <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-transparent" />
    <div className="absolute bottom-3 md:bottom-4 left-3 md:left-4">
      <h2 className="text-base md:text-lg font-heading font-bold text-primary uppercase tracking-wider">
        The Chicago Motor Pool
      </h2>
      <p className="text-mutedForeground text-xs font-heading mt-0.5">
        15 vehicles from the 1920s–30s
      </p>
    </div>
  </div>
);

// Mobile-optimized GTA option card
const GTACard = ({ option, attemptingOptionId, onAttempt, event, eventsEnabled }) => {
  const onCooldown = option.cooldown_until && formatCooldown(option.cooldown_until);
  const unlocked = option.unlocked;
  const defaultCooldown = formatDefaultCooldown(option.cooldown);
  
  const successRate = eventsEnabled && event?.gta_success
    ? Math.min(100, Math.round(option.success_rate * (event.gta_success ?? 1) * 100))
    : (option.success_rate * 100).toFixed(0);

  return (
    <div
      className={`bg-card border rounded-md p-4 transition-all ${
        unlocked && !onCooldown
          ? 'border-primary/30 hover:border-primary/50 hover:bg-card/80' 
          : 'border-border opacity-75'
      }`}
      data-testid={`gta-option-${option.id}`}
    >
      {/* Mobile: Stacked layout, Desktop: Horizontal */}
      <div className="space-y-3 md:space-y-0 md:flex md:items-center md:justify-between md:gap-4">
        
        {/* Top row on mobile: Option info + Stats */}
        <div className="flex items-start justify-between gap-3 md:flex-1 md:min-w-0">
          {/* Left: Option info */}
          <div className="flex-1 min-w-0">
            <h3 className="text-base md:text-sm font-heading font-bold text-foreground truncate flex items-center gap-1.5">
              {unlocked ? (
                <Car className="text-primary/60 w-4 h-4" />
              ) : (
                <Lock className="text-mutedForeground/60 w-4 h-4" />
              )}
              {option.name}
            </h3>
            <p className="text-sm md:text-xs text-mutedForeground line-clamp-1 md:truncate mt-1 md:mt-0.5">
              Difficulty {option.difficulty}/5
              {!unlocked && ` • ${option.min_rank_name}`}
            </p>
          </div>

          {/* Stats badges */}
          <div className="flex-shrink-0 flex flex-col gap-1.5">
            <div className={`px-2.5 py-1 rounded-md text-xs font-bold text-center ${
              unlocked
                ? 'bg-primary/20 text-primary border border-primary/40' 
                : 'bg-secondary text-mutedForeground border border-border'
            }`}>
              {successRate}%
            </div>
            <div className="px-2.5 py-1 rounded-md text-xs font-bold text-center bg-red-500/20 text-red-400 border border-red-500/40">
              {option.jail_time}s
            </div>
          </div>
        </div>

        {/* Bottom row on mobile: Cooldown + Button */}
        <div className="flex items-center justify-between gap-3 md:gap-2">
          {/* Cooldown display */}
          <div className="flex-1 md:flex-shrink-0 md:flex-grow-0">
            {onCooldown && (
              <div className="text-sm md:text-xs text-mutedForeground font-heading">
                {onCooldown}
              </div>
            )}
            {!onCooldown && unlocked && (
              <div className="text-xs text-mutedForeground/60 font-heading">
                CD: {defaultCooldown}
              </div>
            )}
          </div>

          {/* Action button */}
          <div className="flex-shrink-0">
            {unlocked && !onCooldown ? (
              <button
                type="button"
                onClick={() => onAttempt(option.id)}
                disabled={attemptingOptionId !== null}
                className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground active:scale-98 rounded-md px-5 py-2 md:px-4 md:py-1.5 text-sm md:text-xs font-bold uppercase tracking-wide shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all touch-manipulation border border-yellow-600/50 disabled:opacity-60 disabled:cursor-not-allowed"
                data-testid={`attempt-gta-${option.id}`}
              >
                {attemptingOptionId === option.id ? '...' : '🚗 Steal'}
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
                <Lock size={13} className="opacity-60" />
                <span>Locked</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const GarageSection = ({ garage }) => {
  if (garage.length === 0) return null;

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
        <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
          Your Garage
        </h3>
        <span className="text-xs text-primary font-heading font-bold">{garage.length} cars</span>
      </div>
      <div className="p-3 md:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
          {garage.slice(0, 20).map((car, index) => (
            <div
              key={index}
              data-testid={`garage-car-${index}`}
              className="bg-secondary/50 border border-primary/20 rounded-md p-2 flex flex-col items-center text-center hover:border-primary/40 transition-all"
            >
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-md overflow-hidden bg-secondary border border-primary/20 shrink-0 mb-2">
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
              <div className="text-xs font-heading font-bold text-foreground truncate w-full">
                {car.car_name}
              </div>
              <div className="text-[10px] text-mutedForeground font-heading mt-0.5">
                {new Date(car.acquired_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
        {garage.length > 20 && (
          <p className="text-xs text-mutedForeground font-heading mt-3 text-center">
            + {garage.length - 20} more in Garage
          </p>
        )}
      </div>
    </div>
  );
};

const InfoSection = () => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-4 py-2 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        GTA System
      </h3>
    </div>
    <div className="p-4">
      <ul className="space-y-2 text-xs text-mutedForeground font-heading">
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Unlock by rank: Goon (3) → Made Man (4) → Capo (5) → Underboss (6) → Consigliere (7)</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>One attempt = all options on cooldown</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>5 difficulty levels, 15 prohibition-era vehicles</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Higher difficulty = rarer cars + more RP</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Failed = jail (10–60s). Better cars = travel bonus</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>RP: Common 5, Uncommon 10, Rare 20, Ultra Rare 40, Legendary 100</span>
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
      } else if (response.data.jailed) {
        toast.error(response.data.message);
      } else if (response.data.success === false && response.data.message) {
        toast.error(response.data.message);
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
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="gta-page">
      <PageHeader />

      <EventBanner event={event} eventsEnabled={eventsEnabled} />

      <HeroImage />

      {/* GTA option cards */}
      <div className="space-y-3">
        {options.map((option) => (
          <GTACard
            key={option.id}
            option={option}
            attemptingOptionId={attemptingOptionId}
            onAttempt={attemptGTA}
            event={event}
            eventsEnabled={eventsEnabled}
          />
        ))}
      </div>

      <GarageSection garage={garage} />

      <InfoSection />
    </div>
  );
}
