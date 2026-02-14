import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Car, Flame, DollarSign, CheckSquare, Square, Filter, ChevronDown, ChevronUp, Settings, Image as ImageIcon } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const RARITY_ORDER = { exclusive: 6, custom: 5, legendary: 4, ultra_rare: 3, rare: 2, uncommon: 1, common: 0 };
const DEFAULT_VISIBLE = 12;
const MELT_SCRAP_RARITIES_KEY = 'garage_melt_scrap_rarities';
const ALL_RARITIES = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary', 'custom', 'exclusive'];

function loadMeltScrapRarities() {
  try {
    const raw = localStorage.getItem(MELT_SCRAP_RARITIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => ALL_RARITIES.includes(r));
  } catch {
    return [];
  }
}

function saveMeltScrapRarities(rarities) {
  try {
    localStorage.setItem(MELT_SCRAP_RARITIES_KEY, JSON.stringify(rarities));
  } catch (_) {}
}

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
      Garage
    </h1>
    <p className="text-sm text-mutedForeground">
      Manage your stolen vehicles
    </p>
  </div>
);

const EmptyGarageCard = () => (
  <div className="bg-card rounded-md border border-border py-16 text-center">
    <Car size={64} className="mx-auto text-primary/30 mb-4" />
    <h3 className="text-lg font-heading font-bold text-foreground uppercase tracking-wide mb-2">
      Empty Garage
    </h3>
    <p className="text-sm text-mutedForeground font-heading">
      Steal some cars to see them here
    </p>
  </div>
);

const FiltersSortCard = ({ sortBy, setSortBy, filterRarity, setFilterRarity }) => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
        <Filter size={16} />
        Sort & Filter
      </h2>
    </div>
    <div className="p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-2">
            Sort By
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm font-heading text-foreground focus:border-primary/50 focus:outline-none transition-colors"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="value-high">Highest Value</option>
            <option value="value-low">Lowest Value</option>
            <option value="rarity">Rarity</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-2">
            Filter Rarity
          </label>
          <select
            value={filterRarity}
            onChange={(e) => setFilterRarity(e.target.value)}
            className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm font-heading text-foreground focus:border-primary/50 focus:outline-none transition-colors"
          >
            <option value="all">All Rarities</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="ultra_rare">Ultra Rare</option>
            <option value="legendary">Legendary</option>
            <option value="custom">Custom</option>
            <option value="exclusive">Exclusive</option>
          </select>
        </div>
      </div>
    </div>
  </div>
);

const ActionsBar = ({
  totalCount,
  displayedCount,
  hiddenCount,
  showAll,
  selectedCount,
  allDisplayedSelected,
  noEligibleInView,
  filterActive,
  displayedEligibleCount,
  onToggleSelectAll,
  onOpenSettings,
  onMelt,
  onScrap
}) => (
  <div className="bg-card rounded-md border border-primary/20 p-4">
    <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-heading font-bold text-primary tabular-nums">
            {totalCount}
          </span>
          <span className="text-sm text-mutedForeground font-heading">
            {totalCount === 1 ? 'Car' : 'Cars'}
          </span>
        </div>
        
        {!showAll && hiddenCount > 0 && (
          <span className="text-xs text-mutedForeground font-heading">
            (showing {displayedCount})
          </span>
        )}
        
        {selectedCount > 0 && (
          <span className="px-2 py-1 rounded-md bg-primary/20 text-primary text-xs font-heading font-bold border border-primary/30">
            {selectedCount} selected
          </span>
        )}
        
        {displayedCount > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleSelectAll}
              disabled={noEligibleInView}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-heading font-bold uppercase tracking-wide transition-all ${
                noEligibleInView
                  ? 'border-border text-mutedForeground/60 cursor-not-allowed'
                  : 'border-primary/30 text-foreground hover:border-primary/50 hover:bg-primary/10 active:scale-95'
              }`}
              data-testid="garage-select-all"
              title={noEligibleInView ? 'No cars match your filter' : undefined}
            >
              {allDisplayedSelected ? (
                <CheckSquare size={14} className="text-primary" />
              ) : (
                <Square size={14} className="text-mutedForeground" />
              )}
              {noEligibleInView
                ? 'No cars match'
                : allDisplayedSelected
                ? `Clear${filterActive ? ` (${displayedEligibleCount})` : ''}`
                : `Select all${filterActive ? ` (${displayedEligibleCount})` : ''}`}
            </button>
            
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-primary/30 text-mutedForeground hover:text-primary hover:border-primary/50 hover:bg-primary/10 transition-all active:scale-95"
              title="Filter rarities for Select All"
              aria-label="Melt/Scrap settings"
            >
              <Settings size={16} />
            </button>
          </div>
        )}
      </div>
      
      {selectedCount > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onMelt}
            className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wide border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all active:scale-95 inline-flex items-center gap-2 touch-manipulation"
          >
            <Flame size={16} />
            Melt for Bullets
          </button>
          <button
            onClick={onScrap}
            className="bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded-lg px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wide transition-all active:scale-95 inline-flex items-center gap-2 touch-manipulation"
          >
            <DollarSign size={16} />
            Scrap for Cash
          </button>
        </div>
      )}
    </div>
  </div>
);

const CarCard = ({ car, isSelected, onToggle, onOpenCustomModal, getRarityColor }) => {
  const isCustom = car.car_id === 'car_custom';
  
  return (
    <div
      onClick={() => (isCustom ? onOpenCustomModal(car) : onToggle(car.user_car_id))}
      className={`bg-card rounded-md border-2 p-2 cursor-pointer transition-all ${
        isSelected
          ? 'border-primary shadow-md shadow-primary/20'
          : 'border-border hover:border-primary/30 hover:shadow-sm'
      }`}
    >
      <div className="w-full aspect-square rounded-md overflow-hidden bg-secondary border border-border mb-2 relative">
        {car.image ? (
          <img
            src={car.image}
            alt={car.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car size={32} className="text-primary/30" />
          </div>
        )}
        {!isCustom && (
          <div className="absolute top-2 right-2 w-7 h-7 rounded-md flex items-center justify-center bg-card/95 border-2 border-primary/50 shadow-lg">
            {isSelected ? (
              <CheckSquare size={18} className="text-primary" strokeWidth={2.5} />
            ) : (
              <Square size={18} className="text-mutedForeground" strokeWidth={2} />
            )}
          </div>
        )}
      </div>
      
      <div className={`text-[9px] md:text-[10px] font-heading font-bold uppercase tracking-wider ${getRarityColor(car.rarity)} mb-1`}>
        {car.rarity.replace('_', ' ')}
      </div>
      
      <Link
        to={`/gta/car/${car.car_id}`}
        onClick={(e) => e.stopPropagation()}
        className="text-xs md:text-sm font-heading font-bold text-foreground hover:text-primary transition-colors truncate block mb-1"
      >
        {car.name}
      </Link>
      
      <div className="flex items-center justify-between gap-1 text-xs">
        <span className="text-primary font-heading font-bold">
          ${car.value.toLocaleString()}
        </span>
        {!isCustom && (
          <span className={`text-[10px] font-heading ${isSelected ? 'text-primary font-bold' : 'text-mutedForeground'}`}>
            {isSelected ? 'Selected' : '—'}
          </span>
        )}
      </div>
    </div>
  );
};

const SettingsModal = ({ 
  isOpen, 
  onClose, 
  draft, 
  onToggleRarity, 
  onClear, 
  onSave, 
  getRarityColor 
}) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border-2 border-primary/30 rounded-lg shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-4 md:px-6 py-4 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <h3 className="text-base font-heading font-bold text-primary uppercase tracking-wide flex items-center gap-2">
            <Settings size={18} />
            Select All Filter
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mutedForeground hover:text-primary transition-colors p-1"
          >
            <span className="text-xl">×</span>
          </button>
        </div>
        
        <div className="p-4 md:p-6 space-y-4">
          <p className="text-sm text-mutedForeground font-heading leading-relaxed">
            Choose which rarities to include when using "Select all". Leave all unchecked to include every rarity.
          </p>
          
          <div className="space-y-2">
            {ALL_RARITIES.map((rarity) => (
              <label
                key={rarity}
                className="flex items-center gap-3 cursor-pointer p-2 rounded-md hover:bg-secondary/30 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={draft.includes(rarity)}
                  onChange={() => onToggleRarity(rarity)}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                />
                <span className={`text-sm font-heading font-bold capitalize ${getRarityColor(rarity)}`}>
                  {rarity.replace('_', ' ')}
                </span>
              </label>
            ))}
          </div>
          
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClear}
              className="px-4 py-2 text-sm font-heading text-mutedForeground hover:text-foreground transition-colors"
            >
              Clear All
            </button>
            <button
              type="button"
              onClick={onSave}
              className="flex-1 bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg px-4 py-2.5 font-heading font-bold uppercase tracking-wide text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all active:scale-95"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const CustomCarModal = ({ 
  car, 
  imageUrl, 
  setImageUrl, 
  onSave, 
  onClose, 
  saving 
}) => {
  if (!car) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border-2 border-primary/30 rounded-lg shadow-2xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="px-4 md:px-6 py-4 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <h3 className="text-base font-heading font-bold text-primary uppercase tracking-wide flex items-center gap-2">
            <ImageIcon size={18} />
            Custom Car Picture
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mutedForeground hover:text-primary transition-colors p-1"
          >
            <span className="text-xl">×</span>
          </button>
        </div>
        
        <div className="p-4 md:p-6 space-y-4">
          <div>
            <p className="text-sm font-heading font-bold text-foreground mb-1">
              {car.name}
            </p>
            <p className="text-xs text-mutedForeground font-heading">
              Update the image URL for your custom car
            </p>
          </div>
          
          <div className="aspect-video rounded-md overflow-hidden bg-secondary border-2 border-border">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={car.name}
                className="w-full h-full object-cover"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Car size={48} className="text-primary/30" />
              </div>
            )}
          </div>
          
          <div>
            <label className="block text-sm text-mutedForeground font-heading mb-2">
              Image URL
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/car-image.jpg"
              className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>
          
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-border rounded-md text-sm font-heading text-foreground hover:bg-secondary/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg px-4 py-2.5 font-heading font-bold uppercase tracking-wide text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {saving ? 'Saving...' : 'Save Picture'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main component
export default function Garage() {
  const [cars, setCars] = useState([]);
  const [selectedCars, setSelectedCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('rarity');
  const [filterRarity, setFilterRarity] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [customCarModal, setCustomCarModal] = useState(null);
  const [customCarImageUrl, setCustomCarImageUrl] = useState('');
  const [savingCustomImage, setSavingCustomImage] = useState(false);
  const [meltScrapRarities, setMeltScrapRarities] = useState(() => loadMeltScrapRarities());
  const [meltScrapSettingsOpen, setMeltScrapSettingsOpen] = useState(false);
  const [meltScrapSettingsDraft, setMeltScrapSettingsDraft] = useState([]);

  useEffect(() => {
    fetchGarage();
  }, []);

  const fetchGarage = async () => {
    try {
      const response = await api.get('/gta/garage');
      setCars(response.data.cars);
    } catch (error) {
      toast.error('Failed to load garage');
      console.error('Error fetching garage:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (carId) => {
    setSelectedCars(prev =>
      prev.includes(carId) ? prev.filter(id => id !== carId) : [...prev, carId]
    );
  };

  const openCustomCarModal = (car) => {
    setCustomCarModal(car);
    setCustomCarImageUrl(car.image || '');
  };

  const saveCustomCarImage = async () => {
    if (!customCarModal) return;
    setSavingCustomImage(true);
    try {
      await api.patch(`/gta/custom-car/${customCarModal.user_car_id}`, {
        image_url: customCarImageUrl.trim() || null,
      });
      toast.success('Picture updated');
      setCustomCarModal(null);
      fetchGarage();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update picture');
    } finally {
      setSavingCustomImage(false);
    }
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
      custom: 'text-orange-400',
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
          return (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0);
        default:
          return 0;
      }
    });
    
    return filtered;
  };

  const allFilteredCars = getFilteredAndSortedCars();
  const totalCount = allFilteredCars.length;
  const displayedCars = showAll ? allFilteredCars : allFilteredCars.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = totalCount - displayedCars.length;
  
  const displayedEligibleForMelt = displayedCars.filter(
    (c) => c.car_id !== 'car_custom' && (meltScrapRarities.length === 0 || meltScrapRarities.includes(c.rarity))
  );
  const displayedEligibleIds = displayedEligibleForMelt.map((c) => c.user_car_id);
  const allDisplayedSelected =
    displayedEligibleIds.length > 0 && displayedEligibleIds.every((id) => selectedCars.includes(id));
  const filterActive = meltScrapRarities.length > 0;
  const noEligibleInView = filterActive && displayedEligibleIds.length === 0;

  const toggleSelectAllDisplayed = () => {
    if (noEligibleInView) return;
    setSelectedCars((prev) => {
      if (allDisplayedSelected) {
        return prev.filter((id) => !displayedEligibleIds.includes(id));
      }
      return [...new Set([...prev, ...displayedEligibleIds])];
    });
  };

  const openMeltScrapSettings = () => {
    setMeltScrapSettingsDraft([...meltScrapRarities]);
    setMeltScrapSettingsOpen(true);
  };

  const saveMeltScrapSettings = () => {
    setMeltScrapRarities(meltScrapSettingsDraft);
    saveMeltScrapRarities(meltScrapSettingsDraft);
    setMeltScrapSettingsOpen(false);
  };

  const toggleDraftRarity = (rarity) => {
    setMeltScrapSettingsDraft((prev) =>
      prev.includes(rarity) ? prev.filter((r) => r !== rarity) : [...prev, rarity]
    );
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`}>
      <PageHeader />

      {cars.length === 0 ? (
        <EmptyGarageCard />
      ) : (
        <>
          <FiltersSortCard
            sortBy={sortBy}
            setSortBy={setSortBy}
            filterRarity={filterRarity}
            setFilterRarity={setFilterRarity}
          />

          <ActionsBar
            totalCount={totalCount}
            displayedCount={displayedCars.length}
            hiddenCount={hiddenCount}
            showAll={showAll}
            selectedCount={selectedCars.length}
            allDisplayedSelected={allDisplayedSelected}
            noEligibleInView={noEligibleInView}
            filterActive={filterActive}
            displayedEligibleCount={displayedEligibleIds.length}
            onToggleSelectAll={toggleSelectAllDisplayed}
            onOpenSettings={openMeltScrapSettings}
            onMelt={meltCars}
            onScrap={scrapCars}
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
            {displayedCars.map((car, index) => (
              <CarCard
                key={index}
                car={car}
                isSelected={selectedCars.includes(car.user_car_id)}
                onToggle={toggleSelect}
                onOpenCustomModal={openCustomCarModal}
                getRarityColor={getRarityColor}
              />
            ))}
          </div>

          {totalCount > DEFAULT_VISIBLE && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded-lg px-6 py-3 text-sm font-heading font-bold uppercase tracking-wide transition-all active:scale-95 inline-flex items-center gap-2 touch-manipulation"
              >
                {showAll ? (
                  <>
                    <ChevronUp size={16} />
                    Show Top {DEFAULT_VISIBLE}
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    View All ({hiddenCount} more)
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}

      <SettingsModal
        isOpen={meltScrapSettingsOpen}
        onClose={() => setMeltScrapSettingsOpen(false)}
        draft={meltScrapSettingsDraft}
        onToggleRarity={toggleDraftRarity}
        onClear={() => setMeltScrapSettingsDraft([])}
        onSave={saveMeltScrapSettings}
        getRarityColor={getRarityColor}
      />

      <CustomCarModal
        car={customCarModal}
        imageUrl={customCarImageUrl}
        setImageUrl={setCustomCarImageUrl}
        onSave={saveCustomCarImage}
        onClose={() => setCustomCarModal(null)}
        saving={savingCustomImage}
      />
    </div>
  );
}
