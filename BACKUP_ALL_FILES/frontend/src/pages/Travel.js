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
        <h2 className="text-2xl font-heading text-primary">Traveling to {selectedDest}...</h2>
        <div className="text-4xl font-mono text-foreground">{travelTime}s</div>
        <div className="w-64 h-2 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-primary animate-pulse" style={{ width: '100%' }}></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="travel-page">
      <div>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mb-2">Travel</h1>
        <p className="text-sm text-mutedForeground">Move between cities to find new opportunities</p>
      </div>

      <div className="bg-card border border-primary rounded-sm p-4">
        <div className="flex items-center gap-3">
          <MapPin className="text-primary" size={24} />
          <div>
            <p className="text-xs text-mutedForeground">Current Location</p>
            <h2 className="text-xl font-heading font-bold text-foreground">{travelInfo?.current_location}</h2>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm">
          <span className="text-mutedForeground">
            Travels: <span className="text-foreground font-mono">{travelInfo?.travels_this_hour}/{travelInfo?.max_travels}</span> this hour
          </span>
          <span className="text-mutedForeground">
            Points: <span className="text-primary font-mono">{travelInfo?.user_points}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {travelInfo?.destinations?.map(dest => (
          <div key={dest} className="bg-card border border-border rounded-sm p-4" data-testid={`dest-${dest}`}>
            <h3 className="text-lg font-heading font-semibold text-foreground mb-4">{dest}</h3>
            
            <div className="space-y-2">
              <button
                onClick={() => handleTravel(dest, 'airport')}
                disabled={travelInfo.carrying_booze || travelInfo.user_points < travelInfo.airport_cost}
                className="w-full flex items-center justify-between bg-primary/20 hover:bg-primary/30 border border-primary px-3 py-2 rounded-sm transition-smooth disabled:opacity-50"
                data-testid={`airport-${dest}`}
                title={travelInfo.carrying_booze ? 'Car travel only while carrying booze' : ''}
              >
                <span className="flex items-center gap-2">
                  <Plane size={16} className="text-primary" />
                  <span className="text-sm">Airport</span>
                </span>
                <span className="text-xs text-mutedForeground">{travelInfo.airport_time}s • {travelInfo.airport_cost}pts</span>
              </button>
              {travelInfo.carrying_booze && (
                <p className="text-xs text-amber-500 mt-1">Car only while carrying booze</p>
              )}

              {travelInfo?.custom_car && (
                <button
                  onClick={() => handleTravel(dest, 'custom')}
                  className="w-full flex items-center justify-between bg-secondary hover:bg-secondary/80 border border-border px-3 py-2 rounded-sm transition-smooth"
                >
                  <span className="flex items-center gap-2">
                    <Zap size={16} className="text-yellow-500" />
                    <span className="text-sm">{travelInfo.custom_car.name}</span>
                  </span>
                  <span className="text-xs text-mutedForeground">{travelInfo.custom_car.travel_time}s</span>
                </button>
              )}

              {travelInfo?.cars?.slice(0, 3).map(car => (
                <button
                  key={car.user_car_id}
                  onClick={() => handleTravel(dest, car.user_car_id)}
                  className="w-full flex items-center justify-between bg-secondary hover:bg-secondary/80 border border-border px-3 py-2 rounded-sm transition-smooth"
                >
                  <span className="flex items-center gap-2">
                    <Car size={16} className="text-mutedForeground" />
                    <span className="text-sm truncate max-w-[120px]">{car.name}</span>
                  </span>
                  <span className="text-xs text-mutedForeground">{car.travel_time}s</span>
                </button>
              ))}

              {(!travelInfo?.cars || travelInfo.cars.length === 0) && !travelInfo?.custom_car && (
                <p className="text-xs text-mutedForeground text-center py-2">No cars available. Steal some!</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-sm p-4">
        <h3 className="text-base font-heading font-semibold text-primary mb-3">Travel Info</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Car Speed by Rarity</h4>
            <ul className="space-y-1 text-xs text-mutedForeground">
              <li>• Exclusive: 7 seconds</li>
              <li>• Legendary: 12 seconds</li>
              <li>• Ultra Rare: 18 seconds</li>
              <li>• Rare: 25 seconds</li>
              <li>• Uncommon: 35 seconds</li>
              <li>• Common: 45 seconds</li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Extras</h4>
            <ul className="space-y-1 text-xs text-mutedForeground mb-3">
              <li>• Custom Car (Store): 20 seconds</li>
              <li>• Airport: 5 seconds ({travelInfo?.airport_cost} pts)</li>
              <li>• Max {MAX_TRAVELS_PER_HOUR || 15} travels/hour</li>
            </ul>
            <button
              onClick={handleBuyAirmiles}
              disabled={travelInfo?.user_points < (travelInfo?.extra_airmiles_cost || 25)}
              className="bg-primary hover:bg-primary/90 text-background px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-50 transition-smooth"
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
