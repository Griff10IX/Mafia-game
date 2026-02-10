import { useState, useEffect, useCallback } from 'react';
import { Plane, Car, Clock, MapPin, Zap } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

export default function Travel() {
  const [travelInfo, setTravelInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [traveling, setTraveling] = useState(false);
  const [travelTime, setTravelTime] = useState(0);
  const [selectedDest, setSelectedDest] = useState('');

  const fetchTravelInfo = useCallback(async () => {
    try {
      const response = await api.get('/travel/info');
      setTravelInfo(response.data);
    } catch (error) {
      toast.error('Failed to load travel info');
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

  const handleTravel = async (destination, method) => {
    setTraveling(true);
    setSelectedDest(destination);
    try {
      const response = await api.post('/travel', {
        destination,
        travel_method: method
      });
      setTravelTime(response.data.travel_time);
      toast.info(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Travel failed');
      setTraveling(false);
    }
  };

  const handleBuyAirmiles = async () => {
    try {
      const response = await api.post('/travel/buy-airmiles');
      toast.success(response.data.message);
      fetchTravelInfo();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy airmiles');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  if (traveling) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6" data-testid="traveling-screen">
        <div className="text-6xl animate-bounce">🚗</div>
        <div className="flex items-center gap-3">
          <div className="h-px w-8 bg-primary/60" />
          <h2 className="text-2xl font-heading font-bold text-primary uppercase tracking-wider">Traveling to {selectedDest}...</h2>
          <div className="h-px w-8 bg-primary/60" />
        </div>
        <div className="text-4xl font-heading font-bold text-foreground">{travelTime}s</div>
        <div className="w-64 h-2 bg-zinc-800 rounded-full overflow-hidden border border-primary/20">
          <div className="h-full bg-gradient-to-r from-primary to-yellow-600 animate-pulse" style={{ width: '100%' }}></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="travel-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Travel</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Move between cities · find new opportunities</p>
      </div>

      <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-sm flex items-center justify-center bg-primary/20 border border-primary/30">
            <MapPin className="text-primary" size={24} />
          </div>
          <div>
            <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Current Location</p>
            <h2 className="text-xl font-heading font-bold text-primary">{travelInfo?.current_location}</h2>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm font-heading">
          <span className="text-mutedForeground">
            Travels: <span className="text-foreground font-bold">{travelInfo?.travels_this_hour}/{travelInfo?.max_travels}</span> this hour
          </span>
          <span className="text-mutedForeground">
            Points: <span className="text-primary font-bold">{travelInfo?.user_points}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {travelInfo?.destinations?.map(dest => (
          <div key={dest} className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5" data-testid={`dest-${dest}`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">{dest}</h3>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
            </div>
            <div className="p-4 space-y-2">
              <button
                onClick={() => handleTravel(dest, 'airport')}
                disabled={travelInfo.carrying_booze || travelInfo.user_points < travelInfo.airport_cost}
                className="w-full flex items-center justify-between bg-gradient-to-b from-primary/30 to-primary/10 hover:from-primary/40 hover:to-primary/20 border border-primary/50 px-3 py-2 rounded-sm transition-smooth disabled:opacity-50"
                data-testid={`airport-${dest}`}
                title={travelInfo.carrying_booze ? 'Car travel only while carrying booze' : ''}
              >
                <span className="flex items-center gap-2">
                  <Plane size={16} className="text-primary" />
                  <span className="text-sm font-heading font-bold text-primary">Airport</span>
                </span>
                <span className="text-xs text-primary/90 font-heading">{travelInfo.airport_time}s · {travelInfo.airport_cost}pts</span>
              </button>
              {travelInfo.carrying_booze && (
                <p className="text-xs text-amber-400 font-heading">Car only while carrying booze</p>
              )}

              {travelInfo?.custom_car && (
                <button
                  onClick={() => handleTravel(dest, 'custom')}
                  className="w-full flex items-center justify-between bg-zinc-800 hover:bg-zinc-700 border border-primary/30 px-3 py-2 rounded-sm transition-smooth"
                >
                  <span className="flex items-center gap-2">
                    <Zap size={16} className="text-primary" />
                    <span className="text-sm font-heading font-bold text-foreground">{travelInfo.custom_car.name}</span>
                  </span>
                  <span className="text-xs text-mutedForeground font-heading">{travelInfo.custom_car.travel_time}s</span>
                </button>
              )}

              {travelInfo?.cars?.slice(0, 3).map(car => (
                <button
                  key={car.user_car_id}
                  onClick={() => handleTravel(dest, car.user_car_id)}
                  className="w-full flex items-center justify-between bg-zinc-800 hover:bg-zinc-700 border border-primary/30 px-3 py-2 rounded-sm transition-smooth"
                >
                  <span className="flex items-center gap-2">
                    <Car size={16} className="text-primary" />
                    <span className="text-sm font-heading truncate max-w-[120px] text-foreground">{car.name}</span>
                  </span>
                  <span className="text-xs text-mutedForeground font-heading">{car.travel_time}s</span>
                </button>
              ))}

              {(!travelInfo?.cars || travelInfo.cars.length === 0) && !travelInfo?.custom_car && (
                <p className="text-xs text-mutedForeground font-heading text-center py-2">No cars available. Steal some!</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Travel Info</h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest mb-2">Car speed by rarity</h4>
            <ul className="space-y-1 text-xs text-mutedForeground font-heading">
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Exclusive: 7s</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Legendary: 12s</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Ultra Rare: 18s</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Rare: 25s</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Uncommon: 35s</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Common: 45s</li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest mb-2">Extras</h4>
            <ul className="space-y-1 text-xs text-mutedForeground font-heading mb-3">
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Custom Car (Store): 20s</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Airport: 5s ({travelInfo?.airport_cost} pts)</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Max {MAX_TRAVELS_PER_HOUR || 15} travels/hour</li>
            </ul>
            <button
              onClick={handleBuyAirmiles}
              disabled={travelInfo?.user_points < (travelInfo?.extra_airmiles_cost || 25)}
              className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 px-4 py-2 rounded-sm text-sm font-heading font-bold border border-yellow-600/50 disabled:opacity-50 transition-smooth"
            >
              Buy +5 Airmiles ({travelInfo?.extra_airmiles_cost || 25} pts)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const MAX_TRAVELS_PER_HOUR = 15;
