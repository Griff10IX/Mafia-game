import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Car, ArrowLeft, Clock, DollarSign, Shield, Sparkles } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const RARITY_COLORS = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  ultra_rare: 'text-purple-400',
  legendary: 'text-amber-400',
  custom: 'text-primary',
  exclusive: 'text-rose-400',
};

export default function CarProfile() {
  const { carId } = useParams();
  const [car, setCar] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchCar = async () => {
      try {
        const res = await api.get(`/gta/car/${carId}`);
        if (!cancelled) setCar(res.data);
      } catch (e) {
        if (!cancelled) {
          toast.error(e.response?.status === 404 ? 'Car not found' : 'Failed to load car');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCar();
    return () => { cancelled = true; };
  }, [carId]);

  if (loading) {
    return (
      <div className={`${styles.pageContent}`}>
        <div className="flex items-center justify-center min-h-[40vh]">
          <span className="text-primary font-heading font-bold">Loading...</span>
        </div>
      </div>
    );
  }

  if (!car) {
    return (
      <div className={`${styles.pageContent}`}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
          <Car className="text-primary/40" size={48} />
          <p className="text-mutedForeground font-heading">Car not found</p>
          <Link to="/garage" className="bg-zinc-800/50 border border-primary/30 text-primary font-heading text-xs px-3 py-1.5 rounded flex items-center gap-1.5 hover:bg-zinc-700/50 transition-all">
            <ArrowLeft size={14} /> Back to Garage
          </Link>
        </div>
      </div>
    );
  }

  const rarityLabel = (car.rarity || '').replace(/_/g, ' ');
  const rarityColor = RARITY_COLORS[car.rarity] || 'text-mutedForeground';

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link 
            to="/garage" 
            className="text-mutedForeground hover:text-primary transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <span className={`text-[10px] font-heading font-bold uppercase tracking-wider ${rarityColor}`}>
              {rarityLabel}
            </span>
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary flex items-center gap-2">
              <Car className="w-5 h-5 sm:w-6 sm:h-6" />
              {car.name}
            </h1>
          </div>
        </div>
        
        {/* Quick stats */}
        <div className="flex items-center gap-3 text-xs font-heading">
          <div className="flex items-center gap-1">
            <DollarSign size={12} className="text-primary" />
            <span className="text-primary font-bold">${(car.value || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            🚗 Vehicle Details
          </span>
        </div>
        
        <div className="p-3">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Image - compact */}
            <div className="sm:w-48 shrink-0">
              <div className="aspect-[4/3] rounded-md overflow-hidden bg-zinc-800/50 border border-zinc-700/50">
                {car.image ? (
                  <img src={car.image} alt={car.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Car className="text-primary/30" size={48} />
                  </div>
                )}
              </div>
            </div>
            
            {/* Stats grid */}
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div className="bg-zinc-800/30 rounded-md p-3 border border-zinc-700/30">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign size={14} className="text-primary" />
                  <span className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading">Value</span>
                </div>
                <div className="font-heading font-bold text-primary text-lg">${(car.value || 0).toLocaleString()}</div>
              </div>
              
              <div className="bg-zinc-800/30 rounded-md p-3 border border-zinc-700/30">
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={14} className="text-primary" />
                  <span className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading">Travel Time</span>
                </div>
                <div className="font-heading font-bold text-foreground text-lg">
                  {car.travel_time != null && car.travel_time >= 0 ? `${car.travel_time}s` : '—'}
                </div>
              </div>
              
              <div className="bg-zinc-800/30 rounded-md p-3 border border-zinc-700/30">
                <div className="flex items-center gap-2 mb-1">
                  <Shield size={14} className="text-primary" />
                  <span className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading">Difficulty</span>
                </div>
                <div className="font-heading font-bold text-foreground text-lg">{car.min_difficulty ?? '—'}</div>
              </div>
              
              <div className="bg-zinc-800/30 rounded-md p-3 border border-zinc-700/30">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles size={14} className="text-primary" />
                  <span className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading">Rarity</span>
                </div>
                <div className={`font-heading font-bold text-lg capitalize ${rarityColor}`}>{rarityLabel}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Back button */}
      <div className="flex justify-center">
        <Link 
          to="/garage" 
          className="bg-zinc-700/50 hover:bg-zinc-600/50 text-foreground rounded px-4 py-2 text-xs font-heading font-bold uppercase tracking-wide border border-zinc-600/50 transition-all inline-flex items-center gap-1.5 touch-manipulation"
        >
          <ArrowLeft size={14} />
          Back to Garage
        </Link>
      </div>
    </div>
  );
}
