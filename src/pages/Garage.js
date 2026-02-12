import { useState, useEffect } from 'react';
import { Car, Flame, DollarSign, CheckSquare, Square, Filter } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

export default function Garage() {
  const [cars, setCars] = useState([]);
  const [selectedCars, setSelectedCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('newest');
  const [filterRarity, setFilterRarity] = useState('all');

  useEffect(() => {
    fetchGarage();
  }, []);

  const fetchGarage = async () => {
    try {
      const response = await api.get('/gta/garage');
      setCars(response.data.cars);
    } catch (error) {
      toast.error('Failed to load garage');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (carId) => {
    setSelectedCars(prev =>
      prev.includes(carId) ? prev.filter(id => id !== carId) : [...prev, carId]
    );
  };

  const meltCars = async () => {
    if (selectedCars.length === 0) {
      toast.error('No cars selected');
      return;
    }

    try {
      const response = await api.post('/gta/melt', { car_ids: selectedCars, action: 'bullets' });
      toast.success(response.data.message);
      setSelectedCars([]);
      fetchGarage();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to melt cars');
    }
  };

  const scrapCars = async () => {
    if (selectedCars.length === 0) {
      toast.error('No cars selected');
      return;
    }

    try {
      const response = await api.post('/gta/melt', { car_ids: selectedCars, action: 'cash' });
      toast.success(response.data.message);
      setSelectedCars([]);
      fetchGarage();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to scrap cars');
    }
  };

  const getRarityColor = (rarity) => {
    const colors = {
      common: 'text-gray-400',
      uncommon: 'text-green-400',
      rare: 'text-blue-400',
      ultra_rare: 'text-purple-400',
      legendary: 'text-yellow-400',
      exclusive: 'text-red-400'
    };
    return colors[rarity] || 'text-foreground';
  };

  const getFilteredAndSortedCars = () => {
    let filtered = [...cars];
    
    if (filterRarity !== 'all') {
      filtered = filtered.filter(car => car.rarity === filterRarity);
    }
    
    filtered.sort((a, b) => {
      switch(sortBy) {
        case 'newest':
          return new Date(b.acquired_at) - new Date(a.acquired_at);
        case 'oldest':
          return new Date(a.acquired_at) - new Date(b.acquired_at);
        case 'value-high':
          return b.value - a.value;
        case 'value-low':
          return a.value - b.value;
        case 'rarity':
          const rarityOrder = { exclusive: 5, legendary: 4, ultra_rare: 3, rare: 2, uncommon: 1, common: 0 };
          return (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0);
        default:
          return 0;
      }
    });
    
    return filtered;
  };

  const displayedCars = getFilteredAndSortedCars();
  const displayedCarIds = displayedCars.map((c) => c.user_car_id);
  const allDisplayedSelected =
    displayedCarIds.length > 0 && displayedCarIds.every((id) => selectedCars.includes(id));

  const toggleSelectAllDisplayed = () => {
    setSelectedCars((prev) => {
      if (allDisplayedSelected) {
        // clear only displayed cars from selection
        return prev.filter((id) => !displayedCarIds.includes(id));
      }
      // add displayed cars to selection (dedupe)
      return [...new Set([...prev, ...displayedCarIds])];
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${styles.pageContent}`}>
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Car size={24} className="text-primary/80" />
            Garage
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">Manage your stolen vehicles</p>
      </div>

      {cars.length === 0 ? (
        <div className={`${styles.panel} rounded-sm overflow-hidden p-12 text-center`}>
          <Car className="text-primary/40 mx-auto mb-4" size={48} />
          <h3 className="text-lg font-heading font-bold text-primary uppercase tracking-wider mb-2">Empty Garage</h3>
          <p className="text-mutedForeground font-heading text-sm">Steal some cars to see them here.</p>
        </div>
      ) : (
        <>
          {/* Filters and Sort */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                  <Filter size={14} /> Sort & Filter
                </span>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
            </div>
            <div className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Sort By</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className={`w-full ${styles.input} h-9 px-3 text-sm font-heading focus:border-primary/50 focus:outline-none`}
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="value-high">Highest Value</option>
                    <option value="value-low">Lowest Value</option>
                    <option value="rarity">Rarity</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Filter Rarity</label>
                  <select
                    value={filterRarity}
                    onChange={(e) => setFilterRarity(e.target.value)}
                    className={`w-full ${styles.input} h-9 px-3 text-sm font-heading focus:border-primary/50 focus:outline-none`}
                  >
                    <option value="all">All Rarities</option>
                    <option value="common">Common</option>
                    <option value="uncommon">Uncommon</option>
                    <option value="rare">Rare</option>
                    <option value="ultra_rare">Ultra Rare</option>
                    <option value="legendary">Legendary</option>
                    <option value="exclusive">Exclusive</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Actions Bar */}
          <div className={`${styles.panel} rounded-sm overflow-hidden p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-primary font-heading font-bold">{displayedCars.length}</span>
              <span className="text-mutedForeground text-sm font-heading">Cars</span>
              {selectedCars.length > 0 && (
                <span className="text-primary text-xs font-heading">({selectedCars.length} selected)</span>
              )}
              {displayedCars.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectAllDisplayed}
                  className="inline-flex items-center gap-2 text-xs font-heading font-bold uppercase tracking-wider text-mutedForeground hover:text-primary transition-smooth"
                  data-testid="garage-select-all"
                >
                  {allDisplayedSelected ? (
                    <CheckSquare size={14} className="text-primary" />
                  ) : (
                    <Square size={14} className="text-mutedForeground" />
                  )}
                  {allDisplayedSelected ? 'Clear selection' : 'Select all'}
                </button>
              )}
            </div>
            {selectedCars.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={meltCars}
                  className="flex items-center gap-2 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50"
                >
                  <Flame size={14} />
                  Melt for Bullets
                </button>
                <button
                  onClick={scrapCars}
                  className={`flex items-center gap-2 ${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary rounded-sm px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider`}
                >
                  <DollarSign size={14} />
                  Scrap for Cash
                </button>
              </div>
            )}
          </div>

          {/* Cars Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {displayedCars.map((car, index) => (
              <div
                key={index}
                onClick={() => toggleSelect(car.user_car_id)}
                className={`${styles.panel} border rounded-sm p-1.5 sm:p-2 cursor-pointer transition-smooth ${
                  selectedCars.includes(car.user_car_id)
                    ? 'border-primary ring-1 ring-primary/30'
                    : 'border-primary/20 hover:border-primary/50'
                }`}
              >
                <div className={`w-full aspect-square rounded-sm overflow-hidden ${styles.surface} border border-primary/20 mb-1 relative`}>
                  {car.image ? (
                    <img
                      src={car.image}
                      alt={car.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car size={20} className="text-primary/30" />
                    </div>
                  )}
                  <div className="absolute top-0.5 right-0.5">
                    {selectedCars.includes(car.user_car_id) ? (
                      <CheckSquare size={12} className="text-primary drop-shadow" />
                    ) : (
                      <Square size={12} className="text-mutedForeground/60 drop-shadow" />
                    )}
                  </div>
                </div>
                <div className={`text-[8px] sm:text-[9px] font-heading font-bold uppercase tracking-wider ${getRarityColor(car.rarity)} leading-tight`}>
                  {car.rarity.replace('_', ' ')}
                </div>
                <h3 className="text-[10px] sm:text-xs font-heading font-bold text-foreground truncate leading-tight">{car.name}</h3>
                <div className="text-[9px] sm:text-[10px] text-primary font-heading font-bold">${car.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
