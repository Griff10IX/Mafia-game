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
    <div className="space-y-6" data-testid="gta-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Grand Theft Auto</div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">GTA</h1>
        </div>
      </div>

      {(eventsEnabled && event && (event.gta_success !== 1 || event.rank_points !== 1)) && (
        <div className="bg-primary/15 border border-primary rounded-sm p-4">
          <p className="text-sm font-semibold text-primary">Today&apos;s event: {event.name}</p>
          <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
        </div>
      )}

      <div className="flex justify-center">
        <div
          className="w-full max-w-3xl relative h-48 rounded-sm overflow-hidden vintage-filter border border-border"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?w=1920&q=80)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent"></div>
          <div className="absolute bottom-6 left-6">
            <h2 className="text-2xl font-heading font-bold text-primary">The Chicago Motor Pool</h2>
            <p className="text-foreground/80 text-sm">15 vehicles from the 1920s-1930s</p>
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-card border border-border rounded-sm overflow-hidden">
          <div className="grid grid-cols-12 bg-secondary/40 text-xs uppercase tracking-wider text-mutedForeground px-4 py-3">
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
                className={`grid grid-cols-12 px-4 py-3 border-t border-border items-center transition-smooth bg-background/30 hover:bg-background/50 ${
                  !unlocked ? 'opacity-90' : ''
                }`}
              >
                <div className="col-span-5 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{option.name}</div>
                      <div className="text-xs text-mutedForeground">
                        Difficulty: {option.difficulty}/5
                        {!unlocked ? ` • Requires ${option.min_rank_name} (Rank ${option.min_rank})` : ''}
                      </div>
                    </div>
                    {unlocked ? <Car className="text-primary shrink-0" size={18} /> : <Lock className="text-mutedForeground shrink-0" size={18} />}
                  </div>
                </div>

                <div className="col-span-2 text-right text-sm font-mono text-primary font-bold">
                  {eventsEnabled && event?.gta_success
                    ? `${Math.min(100, Math.round(option.success_rate * (event.gta_success ?? 1) * 100))}%`
                    : `${(option.success_rate * 100).toFixed(0)}%`}
                  {eventsEnabled && event?.gta_success && event.gta_success !== 1 && (
                    <span className="block text-[10px] text-mutedForeground font-normal">event</span>
                  )}
                </div>

                <div className="col-span-1 text-right text-sm font-mono text-destructive">
                  {option.jail_time}s
                </div>

                <div className="col-span-1 text-right text-sm font-mono text-mutedForeground">
                  {onCooldown ? formatCooldown(option.cooldown_until) : defaultCooldown}
                </div>

                <div className="col-span-3">
                  <div className="flex items-center justify-end gap-2">
                    <span
                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wide font-bold min-w-[92px] ${
                        statusText === 'Available'
                          ? 'bg-primary text-primaryForeground'
                          : statusText === 'Cooldown'
                            ? 'bg-secondary text-mutedForeground'
                            : 'bg-secondary/60 text-mutedForeground'
                      }`}
                      data-testid={`gta-status-${option.id}`}
                    >
                      {statusText}
                    </span>

                    {onCooldown || !unlocked ? (
                      <span className="text-xs text-mutedForeground font-mono min-w-[66px] text-right">—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => attemptGTA(option.id)}
                        data-testid={`attempt-gta-${option.id}`}
                        disabled={loading}
                        className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth gold-glow disabled:opacity-50 min-w-[66px]"
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
          <div className="w-full max-w-3xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Garage</div>
              <div className="text-xs text-mutedForeground">{garage.length} cars</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {garage.slice(0, 12).map((car, index) => (
                <div
                  key={index}
                  data-testid={`garage-car-${index}`}
                  className="bg-card border border-border rounded-sm p-4"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-sm overflow-hidden bg-secondary border border-border shrink-0">
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
                      <div className="text-sm font-bold text-foreground truncate">{car.car_name}</div>
                      <div className="text-xs text-mutedForeground">{new Date(car.acquired_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {garage.length > 12 && (
              <p className="text-sm text-mutedForeground mt-4">+ {garage.length - 12} more cars...</p>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-card border border-border rounded-sm p-6">
          <h3 className="text-xl font-heading font-semibold text-primary mb-3">GTA System</h3>
          <ul className="space-y-2 text-sm text-mutedForeground">
            <li>• Options unlock as you rank up: Goon (3) → Made Man (4) → Capo (5) → Underboss (6) → Consigliere (7)</li>
            <li>• One attempt puts all GTA options on cooldown; wait for the timer before trying any option again</li>
            <li>• 5 difficulty levels with 15 unique prohibition-era vehicles</li>
            <li>• Higher difficulty = rarer cars + more rank points</li>
            <li>• Failed attempts send you to jail (10-60 seconds based on difficulty)</li>
            <li>• Better cars provide travel bonuses between states</li>
            <li>• Earn rank points: Common (5), Uncommon (10), Rare (20), Ultra Rare (40), Legendary (100)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
