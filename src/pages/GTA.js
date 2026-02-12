import { useState, useEffect } from 'react';
import { Car, Lock, Star, TrendingUp } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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

export default function GTA() {
  const [options, setOptions] = useState([]);
  const [garage, setGarage] = useState([]);
  const [attemptingOptionId, setAttemptingOptionId] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const hasCooldown = options.some((o) => o.cooldown_until && new Date(o.cooldown_until) > new Date());
    if (!hasCooldown) return;
    let refetched = false;
    const id = setInterval(() => {
      const stillHasCooldown = options.some((o) => o.cooldown_until && new Date(o.cooldown_until) > new Date());
      if (!stillHasCooldown && !refetched) {
        refetched = true;
        fetchData();
      }
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [options]);

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
    }
  };

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

  return (
    <div className={`space-y-5 ${styles.pageContent}`} data-testid="gta-page">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Car size={24} className="text-primary/80" />
            GTA
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">Grand Theft Auto — steal prohibition-era vehicles</p>
      </div>

      {(eventsEnabled && event && (event.gta_success !== 1 || event.rank_points !== 1)) && event?.name && (
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className={`${styles.panelHeader} px-3 py-2 sm:px-4`}>
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Today&apos;s event</span>
          </div>
          <div className="p-3 sm:p-4">
            <p className="text-sm font-heading font-bold text-primary">{event.name}</p>
            <p className={`text-xs font-heading mt-1 ${styles.textMuted}`}>{event.message}</p>
          </div>
        </div>
      )}

      <div className="flex justify-center">
        <div
          className="w-full max-w-3xl relative h-40 rounded-sm overflow-hidden border border-primary/30"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?w=1920&q=80)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-transparent" />
          <div className="absolute bottom-4 left-4">
            <h2 className="text-lg font-heading font-bold text-primary uppercase tracking-wider">The Chicago Motor Pool</h2>
            <p className="text-mutedForeground text-xs font-heading">15 vehicles from the 1920s–30s</p>
          </div>
        </div>
      </div>

      <div className="flex justify-center min-w-0">
        <div className={`w-full max-w-3xl min-w-0 ${styles.panel} rounded-md overflow-hidden`}>
          <div className="grid grid-cols-12 gap-1 bg-zinc-800/50 text-[10px] sm:text-xs uppercase tracking-widest font-heading text-primary/80 px-2 sm:px-4 py-2 border-b border-primary/20">
            <div className="col-span-4 sm:col-span-5 min-w-0">Option</div>
            <div className="col-span-2 text-right">Success</div>
            <div className="col-span-1 text-right">Jail</div>
            <div className="col-span-1 text-right hidden sm:block">CD</div>
            <div className="col-span-5 sm:col-span-3">
              <div className="flex items-center justify-end gap-1">
                <span>Status</span>
                <span className="text-right">Action</span>
              </div>
            </div>
          </div>

          {options.map((option) => {
            const onCooldown = option.cooldown_until && formatCooldown(option.cooldown_until);
            const unlocked = option.unlocked;
            const statusText = onCooldown ? 'Cooldown' : unlocked ? 'Available' : 'Locked';
            const defaultCooldown = option.cooldown >= 60 ? `${Math.floor(option.cooldown / 60)}m` : `${option.cooldown}s`;

            return (
              <div
                key={option.id}
                data-testid={`gta-option-${option.id}`}
                className={`grid grid-cols-12 gap-1 px-2 sm:px-4 py-2 border-b border-primary/10 items-center transition-smooth bg-transparent hover:bg-zinc-800/30 ${!unlocked ? 'opacity-90' : ''}`}
              >
                <div className="col-span-4 sm:col-span-5 min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="text-[11px] sm:text-sm font-heading font-bold text-foreground truncate">{option.name}</div>
                      <div className="text-[10px] sm:text-xs text-mutedForeground font-heading">
                        {option.difficulty}/5
                        {!unlocked ? ` · ${option.min_rank_name}` : ''}
                      </div>
                    </div>
                    {unlocked ? <Car className="text-primary shrink-0 hidden sm:block" size={14} /> : <Lock className="text-mutedForeground shrink-0 hidden sm:block" size={14} />}
                  </div>
                </div>

                <div className="col-span-2 text-right text-[11px] sm:text-sm font-heading text-primary font-bold shrink-0">
                  {eventsEnabled && event?.gta_success
                    ? `${Math.min(100, Math.round(option.success_rate * (event.gta_success ?? 1) * 100))}%`
                    : `${(option.success_rate * 100).toFixed(0)}%`}
                  {eventsEnabled && event?.gta_success && event.gta_success !== 1 && (
                    <span className="block text-[9px] text-mutedForeground font-normal">event</span>
                  )}
                </div>

                <div className="col-span-1 text-right text-[11px] sm:text-xs font-heading text-red-400 shrink-0">
                  {option.jail_time}s
                </div>

                <div className="col-span-1 text-right text-xs font-heading text-mutedForeground shrink-0 hidden sm:block">
                  {onCooldown ? formatCooldown(option.cooldown_until) : defaultCooldown}
                </div>

                <div className="col-span-5 sm:col-span-3 flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1">
                  <span
                    className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-sm text-[9px] sm:text-[10px] uppercase tracking-wider font-heading font-bold ${
                      statusText === 'Available'
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : statusText === 'Cooldown'
                          ? 'bg-zinc-800 text-mutedForeground border border-primary/10'
                          : 'bg-zinc-800/80 text-mutedForeground border border-primary/10'
                    }`}
                    data-testid={`gta-status-${option.id}`}
                  >
                    {statusText}
                  </span>
                  {onCooldown || !unlocked ? null : (
                    <button
                      type="button"
                      onClick={() => attemptGTA(option.id)}
                      data-testid={`attempt-gta-${option.id}`}
                      disabled={attemptingOptionId !== null}
                      className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-wider font-heading font-bold border border-yellow-600/50 disabled:opacity-60 disabled:cursor-not-allowed touch-manipulation transition-smooth"
                    >
                      {attemptingOptionId === option.id ? '...' : 'Steal'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {garage.length > 0 && (
        <div className="flex justify-center">
          <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Your Garage</span>
                <div className="w-6 h-px bg-primary/50" />
              </div>
              <span className="text-xs text-primary font-heading font-bold">{garage.length} cars</span>
            </div>
            <div className="p-2 sm:p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {garage.slice(0, 20).map((car, index) => (
                  <div
                    key={index}
                    data-testid={`garage-car-${index}`}
                    className="bg-zinc-800/50 border border-primary/20 rounded-sm p-2 flex flex-col items-center text-center"
                  >
                    <div className="w-12 h-12 rounded-sm overflow-hidden bg-zinc-800 border border-primary/20 shrink-0 mb-1">
                      {car.image ? (
                        <img
                          src={car.image}
                          alt={car.car_name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Car size={16} className="text-primary/40" />
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] sm:text-xs font-heading font-bold text-foreground truncate w-full">{car.car_name}</div>
                    <div className="text-[9px] sm:text-[10px] text-mutedForeground font-heading">{new Date(car.acquired_at).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
              {garage.length > 20 && (
                <p className="text-[10px] sm:text-xs text-mutedForeground font-heading mt-2 text-center">+ {garage.length - 20} more in Garage</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <div className="flex items-center gap-2">
              <div className="w-6 h-px bg-primary/50" />
              <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">GTA System</h3>
              <div className="flex-1 h-px bg-primary/50" />
            </div>
          </div>
          <div className="p-4">
            <ul className="space-y-1 text-xs text-mutedForeground font-heading">
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Unlock by rank: Goon (3) → Made Man (4) → Capo (5) → Underboss (6) → Consigliere (7)</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> One attempt = all options on cooldown</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> 5 difficulty levels, 15 prohibition-era vehicles</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Higher difficulty = rarer cars + more RP</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Failed = jail (10–60s). Better cars = travel bonus</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> RP: Common 5, Uncommon 10, Rare 20, Ultra Rare 40, Legendary 100</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
