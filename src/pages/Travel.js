import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plane, Car, Clock, MapPin, Zap, ShoppingCart, Bot } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const MAX_TRAVELS_PER_HOUR = 15;

const TRAVEL_STYLES = `
  @keyframes trv-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .trv-fade-in { animation: trv-fade-in 0.4s ease-out both; }
  @keyframes trv-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .trv-glow { animation: trv-glow 4s ease-in-out infinite; }
  .trv-corner::before, .trv-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .trv-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .trv-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .trv-card { transition: all 0.3s ease; }
  .trv-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .trv-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

// Subcomponents
const LoadingSpinner = () => (
  <div className={`space-y-2 ${styles.pageContent}`}>
    <style>{TRAVEL_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
      <Plane size={22} className="text-primary/40 animate-pulse" />
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading travel...</span>
    </div>
  </div>
);

const TravelingScreen = ({ destination, timeLeft }) => (
  <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-3" data-testid="traveling-screen">
    <div className="text-4xl md:text-5xl animate-bounce">🚗</div>
    <h2 className="text-lg md:text-xl font-heading font-bold text-primary uppercase tracking-wider text-center">
      Traveling to {destination}...
    </h2>
    <div className="text-3xl md:text-4xl font-heading font-bold text-foreground tabular-nums">
      {timeLeft}s
    </div>
    <div className="w-48 md:w-64 h-2 bg-secondary rounded-full overflow-hidden border border-primary/20">
      <div className="h-full bg-gradient-to-r from-primary via-yellow-600 to-primary animate-pulse"></div>
    </div>
  </div>
);

const CurrentLocationCard = ({ location, travelsUsed, maxTravels, userPoints }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 trv-card trv-corner trv-fade-in`}>
    <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none trv-glow" />
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        Current Location
      </h2>
    </div>
    <div className="p-2">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 rounded bg-primary/20 border border-primary/30">
          <MapPin className="text-primary" size={16} />
        </div>
        <div>
          <p className="text-[9px] text-mutedForeground uppercase tracking-wider mb-0.5">
            You are in
          </p>
          <h3 className="text-base font-heading font-bold text-primary">
            {location}
          </h3>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] font-heading">
        <div className="flex items-center gap-1">
          <Clock size={10} className="text-mutedForeground" />
          <span className="text-mutedForeground">
            Travels: <span className="font-bold text-foreground">{travelsUsed}/{maxTravels}</span> this hour
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Zap size={10} className="text-primary" />
          <span className="text-mutedForeground">
            Points: <span className="font-bold text-primary">{userPoints}</span>
          </span>
        </div>
      </div>
    </div>
    <div className="trv-art-line text-primary mx-2.5" />
  </div>
);

const DestinationCard = ({ 
  destination, 
  onTravel, 
  travelInfo,
  travelDisabled = false,
}) => {
  const airports = travelInfo.airports || [];
  const airport = airports.length > 0 ? airports[0] : null;
  const hasAirports = !!airport;
  const canUse = !travelDisabled && !travelInfo.carrying_booze && travelInfo.user_points >= (airport ? (airport.price_per_travel ?? 10) : (travelInfo.airport_cost ?? 10));

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 trv-card trv-corner trv-fade-in ${travelDisabled ? 'opacity-70' : ''}`} data-testid={`dest-${destination}`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
          {destination}
        </h3>
      </div>
      <div className="p-2 space-y-1">
        {/* One airport option per destination (city) */}
        {hasAirports ? (() => {
          const fullPrice = airport.price_per_travel ?? 10;
          const getsDiscount = !!travelInfo.user_gets_airport_discount;
          const displayPrice = getsDiscount ? Math.max(1, Math.round(fullPrice * 0.95)) : fullPrice;
          const canUseAirport = !travelDisabled && !travelInfo.carrying_booze && travelInfo.user_points >= displayPrice;
          return (
            <button
              key={airport.slot}
              onClick={() => canUseAirport && onTravel(destination, 'airport', airport.slot)}
              disabled={!canUseAirport}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded border-2 transition-all touch-manipulation ${
                canUseAirport
                  ? 'bg-gradient-to-r from-primary/20 via-yellow-600/20 to-primary/20 border-primary/50 hover:from-primary/30 hover:via-yellow-600/30 hover:to-primary/30 active:scale-95'
                  : 'bg-secondary/50 border-border opacity-50 cursor-not-allowed'
              }`}
              data-testid={`airport-${destination}-${airport.slot}`}
              title={travelInfo.carrying_booze ? 'Car travel only while carrying booze' : `${airport.owner_username} · ${displayPrice} pts${getsDiscount ? ' (5% off – you own an airport)' : ''}`}
            >
              <span className="flex items-center gap-1">
                <Plane size={12} className="text-primary" />
                <span className="text-[11px] font-heading font-bold text-foreground">Airport</span>
                <span className="text-[9px] text-mutedForeground font-heading truncate max-w-[70px]">{airport.owner_username ? <Link to={`/profile/${encodeURIComponent(airport.owner_username)}`} className="text-primary hover:underline">{airport.owner_username}</Link> : '—'}</span>
              </span>
              <span className="text-[9px] text-mutedForeground font-heading">
                {travelInfo.airport_time > 0 ? `${travelInfo.airport_time}s` : 'Instant'} · {displayPrice}pts
                {getsDiscount && <span className="text-emerald-400 ml-0.5">(5% off)</span>}
              </span>
            </button>
          );
        })() : (
          <button
            onClick={() => canUse && onTravel(destination, 'airport', 1)}
            disabled={!canUse}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded border-2 transition-all ${
              canUse
                ? 'bg-gradient-to-r from-primary/20 via-yellow-600/20 to-primary/20 border-primary/50'
                : 'bg-secondary/50 border-border opacity-50 cursor-not-allowed'
            }`}
            data-testid={`airport-${destination}`}
          >
            <span className="flex items-center gap-1">
              <Plane size={12} className="text-primary" />
              <span className="text-[11px] font-heading font-bold text-foreground">Airport</span>
            </span>
            <span className="text-[9px] text-mutedForeground font-heading">
              {travelInfo.airport_time > 0 ? `${travelInfo.airport_time}s` : 'Instant'} · {travelInfo.airport_cost ?? 10}pts
            </span>
          </button>
        )}
        
        {travelInfo.carrying_booze && (
          <p className="text-[9px] text-amber-400 font-heading text-center">
            ⚠️ Car only while carrying booze
          </p>
        )}

        {/* Custom Car */}
        {travelInfo?.custom_car && (
          <button
            onClick={() => !travelDisabled && travelInfo.custom_car?.can_travel !== false && onTravel(destination, 'custom')}
            disabled={travelDisabled || travelInfo.custom_car?.can_travel === false}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded transition-all touch-manipulation ${
              !travelDisabled && travelInfo.custom_car?.can_travel !== false
                ? 'bg-secondary text-foreground border border-border hover:border-primary/30 hover:bg-secondary/80 active:scale-95'
                : 'bg-secondary/50 border border-border opacity-60 cursor-not-allowed'
            }`}
            title={travelInfo.custom_car?.can_travel === false ? 'Too damaged — repair in garage' : undefined}
          >
            <span className="flex items-center gap-1">
              <Zap size={12} className="text-primary" />
              <span className="text-[11px] font-heading font-bold">{travelInfo.custom_car.name}</span>
            </span>
            <span className="text-[9px] text-mutedForeground font-heading">
              {travelInfo.custom_car.travel_time}s
              {travelInfo.custom_car?.damage_percent != null && (
                <span className={travelInfo.custom_car.damage_percent >= 100 ? ' text-red-400' : ''}>
                  {' '}· {travelInfo.custom_car.damage_percent}%
                </span>
              )}
            </span>
          </button>
        )}

        {/* User Cars (best 2 only, sorted fastest first) */}
        {travelInfo?.cars?.slice(0, 2).map(car => (
          <button
            key={car.user_car_id}
            onClick={() => !travelDisabled && car.can_travel !== false && onTravel(destination, car.user_car_id)}
            disabled={travelDisabled || car.can_travel === false}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded transition-all touch-manipulation ${
              !travelDisabled && car.can_travel !== false
                ? 'bg-secondary text-foreground border border-border hover:border-primary/30 hover:bg-secondary/80 active:scale-95'
                : 'bg-secondary/50 border border-border opacity-60 cursor-not-allowed'
            }`}
            title={car.can_travel === false ? 'Too damaged — repair in garage' : undefined}
          >
            <span className="flex items-center gap-1 min-w-0 flex-1">
              <Car size={12} className="text-primary shrink-0" />
              <span className="text-[11px] font-heading truncate">{car.name}</span>
            </span>
            <span className={`text-[9px] font-heading whitespace-nowrap ml-1 ${car.can_travel === false ? 'text-red-400' : 'text-mutedForeground'}`}>
              {car.travel_time}s
              {car.damage_percent != null && ` · ${car.damage_percent}%`}
            </span>
          </button>
        ))}

        {/* No Cars Message */}
        {(!travelInfo?.cars || travelInfo.cars.length === 0) && !travelInfo?.custom_car && (
          <div className="text-center py-3 text-[10px] text-mutedForeground font-heading">
            <Car size={20} className="mx-auto text-primary/30 mb-1" />
            <p>No cars available</p>
            <p className="text-[9px] mt-0.5">Steal some cars first!</p>
          </div>
        )}
      </div>
      <div className="trv-art-line text-primary mx-2.5" />
    </div>
  );
};

const TravelInfoCard = ({ travelInfo, onBuyAirmiles }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 trv-card trv-corner trv-fade-in`} style={{ animationDelay: '0.1s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        ℹ️ Travel Info
      </h2>
    </div>
    <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Car Speeds */}
      <div>
        <h4 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider mb-1.5">
          Car Speed by Rarity
        </h4>
        <div className="space-y-0.5 text-[10px] font-heading">
          {[
            { name: 'Exclusive', time: '7s', color: 'text-purple-400' },
            { name: 'Custom', time: '20s', color: 'text-primary' },
            { name: 'Legendary', time: '12s', color: 'text-orange-400' },
            { name: 'Ultra Rare', time: '18s', color: 'text-pink-400' },
            { name: 'Rare', time: '25s', color: 'text-blue-400' },
            { name: 'Uncommon', time: '35s', color: 'text-green-400' },
            { name: 'Common', time: '45s', color: 'text-gray-400' },
          ].map(item => (
            <div key={item.name} className="flex items-center justify-between">
              <span className={item.color}>{item.name}</span>
              <span className="text-mutedForeground">{item.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Extras */}
      <div>
        <h4 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider mb-1.5">
          Travel Options
        </h4>
        <div className="space-y-0.5 text-[10px] font-heading mb-2">
          <div className="flex items-center justify-between">
            <span className="text-mutedForeground">Custom Car (Store)</span>
            <span className="text-foreground font-bold">20s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-mutedForeground">Airport</span>
            <span className="text-foreground font-bold">Instant · {travelInfo?.airport_cost}pts</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-mutedForeground">Travel Limit</span>
            <span className="text-foreground font-bold">{MAX_TRAVELS_PER_HOUR}/hour</span>
          </div>
        </div>

        <button
          onClick={onBuyAirmiles}
          disabled={travelInfo?.user_points < (travelInfo?.extra_airmiles_cost || 25)}
          className="w-full bg-primary/20 text-primary rounded-md px-2.5 py-2 font-heading font-bold uppercase tracking-wide text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation flex items-center justify-center gap-1"
        >
          <ShoppingCart size={12} />
          Buy +5 Airmiles ({travelInfo?.extra_airmiles_cost || 25} pts)
        </button>
      </div>
    </div>
    <div className="trv-art-line text-primary mx-2.5" />
  </div>
);

// Main component
export default function Travel() {
  const [travelInfo, setTravelInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [traveling, setTraveling] = useState(false);
  const [travelTime, setTravelTime] = useState(0);
  const [selectedDest, setSelectedDest] = useState('');
  const [autoRankBoozeOn, setAutoRankBoozeOn] = useState(false);

  const fetchTravelInfo = useCallback(async () => {
    try {
      const [infoRes, meRes] = await Promise.all([
        api.get('/travel/info'),
        api.get('/auto-rank/me').catch(() => ({ data: {} })),
      ]);
      setTravelInfo(infoRes.data);
      setAutoRankBoozeOn(!!meRes.data?.auto_rank_booze);
    } catch (error) {
      toast.error('Failed to load travel info');
      console.error('Error fetching travel info:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTravelInfo();
  }, [fetchTravelInfo]);

  useEffect(() => {
    if (travelTime > 0) {
      const timer = setInterval(() => {
        setTravelTime(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setTraveling(false);
            fetchTravelInfo();
            toast.success(`Arrived at ${selectedDest}!`);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [travelTime, selectedDest, fetchTravelInfo]);

  const handleTravel = async (destination, method, airportSlot = 1) => {
    setTraveling(true);
    setSelectedDest(destination);
    try {
      const payload = { destination, travel_method: method };
      if (method === 'airport' && airportSlot != null) payload.airport_slot = airportSlot;
      const response = await api.post('/travel', payload);
      const tt = response.data.travel_time;
      if (tt <= 0) {
        setTraveling(false);
        fetchTravelInfo();
        refreshUser();
        toast.success(`Arrived at ${destination}!`);
      } else {
        setTravelTime(tt);
        refreshUser();
        toast.info(response.data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Travel failed');
      setTraveling(false);
    }
  };

  const handleBuyAirmiles = async () => {
    try {
      const response = await api.post('/travel/buy-airmiles');
      toast.success(response.data.message);
      refreshUser();
      fetchTravelInfo();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy airmiles');
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (traveling) {
    return <TravelingScreen destination={selectedDest} timeLeft={travelTime} />;
  }

  return (
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="travel-page">
      <style>{TRAVEL_STYLES}</style>

      {/* Page header */}
      <div className="relative trv-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.2em] mb-0.5">On the Road</p>
        <h1 className="text-base sm:text-lg font-heading font-bold text-primary tracking-wider uppercase">
          Travel
        </h1>
        <p className="text-[9px] text-zinc-500 font-heading italic mt-0.5">Fly or drive — airports and cars. Move between cities.</p>
      </div>

      {autoRankBoozeOn && (
        <div className={`p-2 ${styles.panel} border border-amber-500/40 rounded-md text-[10px] flex items-center gap-1.5 trv-fade-in`}>
          <Bot size={10} className="text-amber-400 shrink-0" />
          <span className="text-amber-200/90">
            <strong className="text-amber-300">Auto Rank booze running is on.</strong> Manual travel is disabled. Turn off booze running in <Link to="/auto-rank" className="underline font-bold">Auto Rank</Link> to travel.
          </span>
        </div>
      )}

      <CurrentLocationCard
        location={travelInfo?.current_location}
        travelsUsed={travelInfo?.travels_this_hour}
        maxTravels={travelInfo?.max_travels}
        userPoints={travelInfo?.user_points}
      />

      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
            🌎 Destinations
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-primary/40 via-primary/20 to-transparent" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
          {travelInfo?.destinations?.map(dest => (
            <DestinationCard
              key={dest}
              destination={dest}
              onTravel={handleTravel}
              travelInfo={travelInfo}
              travelDisabled={autoRankBoozeOn}
            />
          ))}
        </div>
      </div>

      <TravelInfoCard
        travelInfo={travelInfo}
        onBuyAirmiles={handleBuyAirmiles}
      />
    </div>
  );
}
