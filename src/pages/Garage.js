import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Car, Flame, DollarSign, CheckSquare, Square, Filter, ChevronDown, ChevronUp, Settings, Image as ImageIcon } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const RARITY_ORDER = { exclusive: 6, custom: 5, legendary: 4, ultra_rare: 3, rare: 2, uncommon: 1, common: 0 };
const DEFAULT_VISIBLE = 16;
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

const PageHeader = ({ totalCount }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
        <Car className="w-6 h-6 sm:w-7 sm:h-7" />
        Garage
      </h1>
      <p className="text-xs text-mutedForeground">
        Manage your stolen vehicles
      </p>
    </div>
    <div className="flex items-center gap-1.5 text-xs font-heading">
      <span className="text-mutedForeground">Total:</span>
      <span className="text-primary font-bold text-lg">{totalCount}</span>
      <span className="text-mutedForeground">cars</span>
    </div>
  </div>
);

const EmptyGarageCard = () => (
  <div className="bg-card rounded-md border border-border py-12 text-center">
    <Car size={48} className="mx-auto text-primary/30 mb-3" />
    <h3 className="text-sm font-heading font-bold text-foreground uppercase tracking-wide mb-1">
      Empty Garage
    </h3>
    <p className="text-xs text-mutedForeground font-heading">
      Steal some cars to see them here
    </p>
  </div>
);

const FiltersSortCard = ({ sortBy, setSortBy, filterRarity, setFilterRarity }) => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-1.5">
        <Filter size={14} />
        Sort & Filter
      </h2>
    </div>
    <div className="p-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
            Sort By
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs font-heading text-foreground focus:border-primary/50 focus:outline-none transition-colors"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="value-high">Highest Value</option>
            <option value="value-low">Lowest Value</option>
            <option value="rarity">Rarity</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
            Filter Rarity
          </label>
          <select
            value={filterRarity}
            onChange={(e) => setFilterRarity(e.target.value)}
            className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs font-heading text-foreground focus:border-primary/50 focus:outline-none transition-colors"
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
  <div className="bg-card rounded-md border border-primary/20 p-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!showAll && hiddenCount > 0 && (
          <span className="text-[10px] text-mutedForeground font-heading">
            Showing {displayedCount}
          </span>
        )}
        
        {selectedCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/30">
            {selectedCount} selected
          </span>
        )}
        
        {displayedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleSelectAll}
              disabled={noEligibleInView}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-heading font-bold uppercase tracking-wide transition-all ${
                noEligibleInView
                  ? 'border-border text-mutedForeground/60 cursor-not-allowed'
                  : 'border-primary/30 text-foreground hover:border-primary/50 hover:bg-primary/10 active:scale-95'
              }`}
              data-testid="garage-select-all"
            >
              {allDisplayedSelected ? (
                <CheckSquare size={12} className="text-primary" />
              ) : (
                <Square size={12} className="text-mutedForeground" />
              )}
              {noEligibleInView
                ? 'No match'
                : allDisplayedSelected
                ? `Clear${filterActive ? ` (${displayedEligibleCount})` : ''}`
                : `Select all${filterActive ? ` (${displayedEligibleCount})` : ''}`}
            </button>
            
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center justify-center w-7 h-7 rounded border border-primary/30 text-mutedForeground hover:text-primary hover:border-primary/50 hover:bg-primary/10 transition-all active:scale-95"
              title="Filter rarities"
            >
              <Settings size={14} />
            </button>
          </div>
        )}
      </div>
      
      {selectedCount > 0 && (
        <div className="flex gap-2">
          <button
            onClick={onMelt}
            className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase tracking-wide border border-yellow-600/50 shadow shadow-primary/20 transition-all active:scale-95 inline-flex items-center gap-1.5 touch-manipulation"
          >
            <Flame size={12} />
            Melt
          </button>
          <button
            onClick={onScrap}
            className="bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase tracking-wide transition-all active:scale-95 inline-flex items-center gap-1.5 touch-manipulation"
          >
            <DollarSign size={12} />
            Scrap
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
      className={`bg-card rounded-md border p-1.5 cursor-pointer transition-all ${
        isSelected
          ? 'border-primary shadow-md shadow-primary/20'
          : 'border-border hover:border-primary/30 hover:shadow-sm'
      }`}
    >
      <div className="w-full aspect-[4/3] rounded overflow-hidden bg-secondary border border-border mb-1.5 relative">
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
          <div className="absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center bg-card/95 border border-primary/50 shadow">
            {isSelected ? (
              <CheckSquare size={12} className="text-primary" strokeWidth={2.5} />
            ) : (
              <Square size={12} className="text-mutedForeground" strokeWidth={2} />
            )}
          </div>
        )}
      </div>
      
      <div className={`text-[8px] font-heading font-bold uppercase tracking-wider ${getRarityColor(car.rarity)} mb-0.5`}>
        {car.rarity.replace('_', ' ')}
      </div>
      
      <Link
        to={`/gta/car/${car.car_id}`}
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] font-heading font-bold text-foreground hover:text-primary transition-colors truncate block mb-0.5"
      >
        {car.name}
      </Link>
      
      <div className="text-[10px] text-primary font-heading font-bold">
        ${car.value.toLocaleString()}
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
      <div className="bg-card border-2 border-primary/30 rounded-lg shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wide flex items-center gap-2">
            <Settings size={16} />
            Select All Filter
          </h3>
          <button type="button" onClick={onClose} className="text-mutedForeground hover:text-primary transition-colors">
            <span className="text-lg">×</span>
          </button>
        </div>
        
        <div className="p-4 space-y-3">
          <p className="text-xs text-mutedForeground font-heading">
            Choose rarities for "Select all". Leave unchecked to include all.
          </p>
          
          <div className="space-y-1">
            {ALL_RARITIES.map((rarity) => (
              <label
                key={rarity}
                className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-secondary/30 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={draft.includes(rarity)}
                  onChange={() => onToggleRarity(rarity)}
                  className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                />
                <span className={`text-xs font-heading font-bold capitalize ${getRarityColor(rarity)}`}>
                  {rarity.replace('_', ' ')}
                </span>
              </label>
            ))}
          </div>
          
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClear}
              className="px-3 py-1.5 text-xs font-heading text-mutedForeground hover:text-foreground transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onSave}
              className="flex-1 bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-1.5 font-heading font-bold uppercase tracking-wide text-xs border border-yellow-600/50 transition-all active:scale-95"
            >
              Save
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
      <div className="bg-card border-2 border-primary/30 rounded-lg shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wide flex items-center gap-2">
            <ImageIcon size={16} />
            Custom Car Picture
          </h3>
          <button type="button" onClick={onClose} className="text-mutedForeground hover:text-primary transition-colors">
            <span className="text-lg">×</span>
          </button>
        </div>
        
        <div className="p-4 space-y-3">
          <div>
            <p className="text-sm font-heading font-bold text-foreground">{car.name}</p>
            <p className="text-[10px] text-mutedForeground font-heading">Update the image URL</p>
          </div>
          
          <div className="aspect-video rounded overflow-hidden bg-secondary border border-border">
            {imageUrl ? (
              <img src={imageUrl} alt={car.name} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Car size={32} className="text-primary/30" />
              </div>
            )}
          </div>
          
          <div>
            <label className="block text-[10px] text-mutedForeground font-heading mb-1">Image URL</label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/car-image.jpg"
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>
          
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-border rounded text-xs font-heading text-foreground hover:bg-secondary/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex-1 bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-1.5 font-heading font-bold uppercase tracking-wide text-xs border border-yellow-600/50 transition-all disabled:opacity-50 active:scale-95"
            >
              {saving ? 'Saving...' : 'Save'}
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
    if (selectedCars.length === 0) { toast.error('No cars selected'); return; }
    try {
      const response = await api.post('/gta/melt', { car_ids: selectedCars, action: 'bullets' });
      toast.success(response.data.message);
      setSelectedCars([]);
      refreshUser();
      fetchGarage();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to melt cars');
    }
  };

  const scrapCars = async () => {
    if (selectedCars.length === 0) { toast.error('No cars selected'); return; }
    try {
      const response = await api.post('/gta/melt', { car_ids: selectedCars, action: 'cash' });
      toast.success(response.data.message);
      setSelectedCars([]);
      refreshUser();
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
        case 'newest': return new Date(b.acquired_at) - new Date(a.acquired_at);
        case 'oldest': return new Date(a.acquired_at) - new Date(b.acquired_at);
        case 'value-high': return b.value - a.value;
        case 'value-low': return a.value - b.value;
        case 'rarity': return (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0);
        default: return 0;
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
  const allDisplayedSelected = displayedEligibleIds.length > 0 && displayedEligibleIds.every((id) => selectedCars.includes(id));
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

  if (loading) return <LoadingSpinner />;

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <PageHeader totalCount={cars.length} />

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

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
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
                className="bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded px-4 py-2 text-xs font-heading font-bold uppercase tracking-wide transition-all active:scale-95 inline-flex items-center gap-1.5 touch-manipulation"
              >
                {showAll ? (
                  <>
                    <ChevronUp size={14} />
                    Show Top {DEFAULT_VISIBLE}
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} />
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
