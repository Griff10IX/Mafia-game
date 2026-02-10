import { useState, useEffect } from 'react';
import { Car, Lock, Star, TrendingUp } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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
  const [loading, setLoading] = useState(false);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const hasCooldown = options.some((o) => o.cooldown_until && new Date(o.cooldown_until) > new Date());
    if (!hasCooldown) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
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

  const attemptGTA = async (optionId) => {
    setLoading(true);
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
      }
      
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to steal car');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="gta-page">
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

      {(eventsEnabled && event && (event.gta_success !== 1 || event.rank_points !== 1)) && (
        <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border border-primary/50 rounded-sm p-3">
          <p className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Event: {event.name}</p>
          <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
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

      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
          <div className="grid grid-cols-12 bg-zinc-800/50 text-xs uppercase tracking-widest font-heading text-primary/80 px-4 py-2 border-b border-primary/20">
            <div className="col-span-5">Option</div>
            <div className="col-span-2 text-right">Success</div>
            <div className="col-span-1 text-right">Jail</div>
            <div className="col-span-1 text-right">CD</div>
            <div className="col-span-3">
              <div className="flex items-center justify-end gap-6">
                <span>Status</span>
                <span>Action</span>
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
                className={`grid grid-cols-12 px-4 py-2.5 border-b border-primary/10 items-center transition-smooth bg-transparent hover:bg-zinc-800/30 ${!unlocked ? 'opacity-90' : ''}`}
              >
                <div className="col-span-5 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-heading font-bold text-foreground truncate">{option.name}</div>
                      <div className="text-xs text-mutedForeground font-heading">
                        Difficulty: {option.difficulty}/5
                        {!unlocked ? ` · ${option.min_rank_name} (Rank ${option.min_rank})` : ''}
                      </div>
                    </div>
                    {unlocked ? <Car className="text-primary shrink-0" size={16} /> : <Lock className="text-mutedForeground shrink-0" size={16} />}
                  </div>
                </div>

                <div className="col-span-2 text-right text-sm font-heading text-primary font-bold">
                  {eventsEnabled && event?.gta_success
                    ? `${Math.min(100, Math.round(option.success_rate * (event.gta_success ?? 1) * 100))}%`
                    : `${(option.success_rate * 100).toFixed(0)}%`}
                  {eventsEnabled && event?.gta_success && event.gta_success !== 1 && (
                    <span className="block text-[10px] text-mutedForeground font-normal">event</span>
                  )}
                </div>

                <div className="col-span-1 text-right text-sm font-heading text-red-400">
                  {option.jail_time}s
                </div>

                <div className="col-span-1 text-right text-sm font-heading text-mutedForeground">
                  {onCooldown ? formatCooldown(option.cooldown_until) : defaultCooldown}
                </div>

                <div className="col-span-3">
                  <div className="flex items-center justify-end gap-2">
                    <span
                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-heading font-bold min-w-[92px] ${
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

                    {onCooldown || !unlocked ? (
                      <span className="text-xs text-mutedForeground font-heading min-w-[66px] text-right">—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => attemptGTA(option.id)}
                        data-testid={`attempt-gta-${option.id}`}
                        disabled={loading}
                        className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50 disabled:opacity-50 min-w-[66px] transition-smooth"
                      >
                        {loading ? '...' : 'Steal'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {garage.length > 0 && (
        <div className="flex justify-center">
          <div className="w-full max-w-3xl bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Your Garage</span>
                <div className="w-6 h-px bg-primary/50" />
              </div>
              <span className="text-xs text-primary font-heading font-bold">{garage.length} cars</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {garage.slice(0, 12).map((car, index) => (
                  <div
                    key={index}
                    data-testid={`garage-car-${index}`}
                    className="bg-zinc-800/50 border border-primary/20 rounded-sm p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-sm overflow-hidden bg-zinc-800 border border-primary/20 shrink-0">
                        {car.image ? (
                          <img
                            src={car.image}
                            alt={car.car_name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-heading font-bold text-foreground truncate">{car.car_name}</div>
                        <div className="text-xs text-mutedForeground font-heading">{new Date(car.acquired_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {garage.length > 12 && (
                <p className="text-xs text-mutedForeground font-heading mt-3">+ {garage.length - 12} more in Garage</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
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
