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
      <div className={`${styles.pageContent} ${styles.page}`}>
        <div className="flex items-center justify-center min-h-[40vh]">
          <span className="text-primary font-heading">Loading...</span>
        </div>
      </div>
    );
  }

  if (!car) {
    return (
      <div className={`${styles.pageContent} ${styles.page}`}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
          <Car className="text-primary/40" size={48} />
          <p className="text-mutedForeground font-heading">Car not found</p>
          <Link to="/garage" className={`${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary font-heading px-4 py-2 rounded-sm flex items-center gap-2`}>
            <ArrowLeft size={16} /> Back to Garage
          </Link>
        </div>
      </div>
    );
  }

  const rarityLabel = (car.rarity || '').replace(/_/g, ' ');
  const rarityColor = RARITY_COLORS[car.rarity] || 'text-mutedForeground';

  return (
    <div className={`${styles.pageContent} ${styles.page}`}>
      <div className="mb-4">
        <Link to="/garage" className={`inline-flex items-center gap-2 text-sm font-heading text-mutedForeground hover:text-primary transition-colors`}>
          <ArrowLeft size={16} /> Back to Garage
        </Link>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 max-w-lg mx-auto`}>
        <div className="aspect-video sm:aspect-[2/1] bg-secondary/50 border-b border-primary/20">
          {car.image ? (
            <img src={car.image} alt={car.name} className="w-full h-full object-contain bg-secondary" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car className="text-primary/30" size={64} />
            </div>
          )}
        </div>
        <div className="p-4 sm:p-5 space-y-4">
          <div>
            <span className={`text-xs font-heading font-bold uppercase tracking-wider ${rarityColor}`}>
              {rarityLabel}
            </span>
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-foreground mt-1">
              {car.name}
            </h1>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className={`${styles.surface} rounded-sm border border-primary/20 p-3 flex items-center gap-2`}>
              <DollarSign size={18} className="text-primary shrink-0" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading">Value</div>
                <div className="font-heading font-bold text-primary">${(car.value || 0).toLocaleString()}</div>
              </div>
            </div>
            <div className={`${styles.surface} rounded-sm border border-primary/20 p-3 flex items-center gap-2`}>
              <Clock size={18} className="text-primary shrink-0" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading">Travel time</div>
                <div className="font-heading font-bold text-foreground">
                  {car.travel_time != null && car.travel_time >= 0
                    ? `${car.travel_time}s`
                    : '—'}
                </div>
              </div>
            </div>
            <div className={`${styles.surface} rounded-sm border border-primary/20 p-3 flex items-center gap-2`}>
              <Shield size={18} className="text-primary shrink-0" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading">Difficulty</div>
                <div className="font-heading font-bold text-foreground">{car.min_difficulty ?? '—'}</div>
              </div>
            </div>
            <div className={`${styles.surface} rounded-sm border border-primary/20 p-3 flex items-center gap-2`}>
              <Sparkles size={18} className="text-primary shrink-0" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-mutedForeground font-heading">Rarity</div>
                <div className={`font-heading font-bold ${rarityColor}`}>{rarityLabel}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
