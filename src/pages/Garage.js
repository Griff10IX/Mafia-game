import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Car, Flame, DollarSign, CheckSquare, Square, Filter, ChevronDown, ChevronUp, Settings, Image as ImageIcon, Wrench } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const GARAGE_STYLES = `
  @keyframes gar-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .gar-fade-in { animation: gar-fade-in 0.4s ease-out both; }
  .gar-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .gar-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

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
  <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
    <Car size={28} className="text-primary/40 animate-pulse" />
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading...</span>
  </div>
);

const RARITY_COLORS = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  ultra_rare: 'text-purple-400',
  legendary: 'text-yellow-400',
  custom: 'text-orange-400',
  exclusive: 'text-red-400',
};

const EmptyGarageCard = () => (
  <div className={`relative ${styles.panel} rounded-lg border border-primary/20 py-12 text-center gar-fade-in overflow-hidden`}>
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <Car size={48} className="mx-auto text-primary/30 mb-3" />
    <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] mb-1">
      Empty Garage
    </h3>
    <p className="text-xs text-mutedForeground font-heading">
      Steal some cars to see them here
    </p>
  </div>
);

const FiltersSortCard = ({ sortBy, setSortBy, filterRarity, setFilterRarity }) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 gar-fade-in`}>
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-1.5">
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
    <div className="gar-art-line text-primary mx-3" />
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
  onScrap,
  meltBulletsSecondsRemaining,
}) => {
  const meltOnCooldown = meltBulletsSecondsRemaining != null && meltBulletsSecondsRemaining > 0;
  return (
    <div className={`relative ${styles.panel} rounded-lg border border-primary/20 p-3 gar-fade-in overflow-hidden`}>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
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
          <div className="flex flex-wrap items-center gap-2">
            {meltOnCooldown && (
              <span className="text-[10px] text-mutedForeground font-heading">
                Melt for bullets: next in {meltBulletsSecondsRemaining}s
              </span>
            )}
            <button
              onClick={onMelt}
              disabled={meltOnCooldown}
              title={meltOnCooldown ? `1 car per 45s. Next in ${meltBulletsSecondsRemaining}s` : 'Melt for bullets (1 car every 45s)'}
              className={`rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase tracking-wide border inline-flex items-center gap-1.5 touch-manipulation transition-all ${
                meltOnCooldown
                  ? 'bg-secondary/50 text-mutedForeground border-border cursor-not-allowed'
                  : 'bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground border border-yellow-600/50 shadow shadow-primary/20 active:scale-95'
              }`}
            >
              <Flame size={12} />
              Melt (1/45s)
            </button>
            <button
              onClick={onScrap}
              className="bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase tracking-wide transition-all active:scale-95 inline-flex items-center gap-1.5 touch-manipulation"
              title="Scrap for cash (no cooldown)"
            >
              <DollarSign size={12} />
              Scrap
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const CarCard = ({ car, isSelected, onToggle, onOpenCustomModal, onRepair, repairingCarId, getRarityColor }) => {
  const isCustom = car.car_id === 'car_custom';
  const isListed = car.listed_for_sale;
  const damage = car.damage_percent ?? 0;
  const isRepairing = repairingCarId === car.user_car_id;
  const handleClick = () => {
    if (isCustom) onOpenCustomModal(car);
    else if (!isListed) onToggle(car.user_car_id);
  };
  return (
    <div
      onClick={handleClick}
      className={`${styles.panel} rounded-lg border p-1.5 transition-all gar-card ${
        isListed ? 'border-amber-500/40 opacity-90' : 'cursor-pointer'
      } ${
        !isListed && (isSelected ? 'border-primary shadow-md shadow-primary/20' : 'border-border hover:border-primary/30')
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
        {isListed && (
          <div className="absolute top-1 left-1 px-1 rounded bg-amber-500/90 text-[8px] font-heading font-bold text-black uppercase">
            Listed ${(car.sale_price ?? 0).toLocaleString()}
          </div>
        )}
        {!isCustom && !isListed && (
          <div className="absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center bg-zinc-800/95 border border-primary/50 shadow">
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
        to={`/view-car?id=${encodeURIComponent(car.user_car_id)}`}
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] font-heading font-bold text-foreground hover:text-primary transition-colors truncate block mb-0.5"
      >
        {car.name}
      </Link>
      
      <div className="text-[10px] text-primary font-heading font-bold">
        ${car.value.toLocaleString()}
      </div>
      {damage >= 100 ? (
        <p className="text-[9px] font-heading text-red-400 mt-0.5">100% — scrap/melt only</p>
      ) : damage > 0 && !isListed && (
        <div className="flex items-center justify-between gap-1 mt-1">
          <span className="text-[9px] font-heading text-mutedForeground">{damage}% damage</span>
          {onRepair && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRepair(car); }}
              disabled={isRepairing}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/50 text-[8px] font-heading font-bold uppercase hover:bg-primary/30 disabled:opacity-50"
            >
              <Wrench size={10} />
              {isRepairing ? '...' : 'Repair'}
            </button>
          )}
        </div>
      )}
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
      <div className={`${styles.panel} border border-primary/20 rounded-lg shadow-2xl max-w-sm w-full overflow-hidden`} onClick={e => e.stopPropagation()}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-4 py-3 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
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
      <div className={`${styles.panel} border border-primary/20 rounded-lg shadow-2xl max-w-md w-full overflow-hidden`} onClick={e => e.stopPropagation()}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-4 py-3 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-2">
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
  const [meltBulletsCooldownUntil, setMeltBulletsCooldownUntil] = useState(null);
  const [meltBulletsSecondsRemaining, setMeltBulletsSecondsRemaining] = useState(0);
  const [repairingCarId, setRepairingCarId] = useState(null);

  useEffect(() => {
    fetchGarage();
  }, []);

  const fetchGarage = async () => {
    try {
      const response = await api.get('/gta/garage');
      setCars(response.data.cars ?? []);
      setMeltBulletsCooldownUntil(response.data.melt_bullets_cooldown_until ?? null);
    } catch (error) {
      toast.error('Failed to load garage');
    } finally {
      setLoading(false);
    }
  };

  // Tick every second while melt-for-bullets cooldown is active
  useEffect(() => {
    if (!meltBulletsCooldownUntil) {
      setMeltBulletsSecondsRemaining(0);
      return;
    }
    const until = new Date(meltBulletsCooldownUntil).getTime();
    const update = () => {
      const secs = Math.max(0, Math.floor((until - Date.now()) / 1000));
      setMeltBulletsSecondsRemaining(secs);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [meltBulletsCooldownUntil]);

  const toggleSelect = (carId) => {
    setSelectedCars(prev =>
      prev.includes(carId) ? prev.filter(id => id !== carId) : [...prev, carId]
    );
  };

  const openCustomCarModal = (car) => {
    setCustomCarModal(car);
    setCustomCarImageUrl(car.image || '');
  };

  const handleRepair = async (car) => {
    if (!car?.user_car_id) return;
    setRepairingCarId(car.user_car_id);
    try {
      const res = await api.post('/gta/repair-car', { user_car_id: car.user_car_id });
      toast.success(res.data?.message || 'Repaired');
      refreshUser();
      fetchGarage();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Repair failed');
    } finally {
      setRepairingCarId(null);
    }
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
    if (meltBulletsSecondsRemaining > 0) return;
    try {
      const response = await api.post('/gta/melt', { car_ids: selectedCars, action: 'bullets' });
      toast.success(response.data.message);
      if (response.data.melt_bullets_cooldown_until) {
        setMeltBulletsCooldownUntil(response.data.melt_bullets_cooldown_until);
      }
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
    (c) => c.car_id !== 'car_custom' && !c.listed_for_sale && (meltScrapRarities.length === 0 || meltScrapRarities.includes(c.rarity))
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

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <style>{GARAGE_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <style>{GARAGE_STYLES}</style>

      <div className="relative gar-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Your Fleet</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-2">
          <Car size={24} /> Garage
        </h1>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">View, melt, scrap, and list your cars.</p>
      </div>

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
            meltBulletsSecondsRemaining={meltBulletsSecondsRemaining > 0 ? meltBulletsSecondsRemaining : null}
          />

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {displayedCars.map((car, index) => (
              <CarCard
                key={index}
                car={car}
                isSelected={selectedCars.includes(car.user_car_id)}
                onToggle={toggleSelect}
                onOpenCustomModal={openCustomCarModal}
                onRepair={handleRepair}
                repairingCarId={repairingCarId}
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
