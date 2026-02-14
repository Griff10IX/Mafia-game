import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Car, Flame, DollarSign, CheckSquare, Square, Filter, ChevronDown, ChevronUp, Settings } from 'lucide-react';
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
    // Only keep rarities that exist in ALL_RARITIES so settings stay valid
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
  // For melt/scrap, only non-custom cars; filter by saved rarities when set (empty = all)
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
                    <option value="custom">Custom</option>
                    <option value="exclusive">Exclusive</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Actions Bar */}
          <div className={`${styles.panel} rounded-sm overflow-hidden p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-primary font-heading font-bold">{totalCount}</span>
              <span className="text-mutedForeground text-sm font-heading">Cars</span>
              {!showAll && hiddenCount > 0 && (
                <span className="text-mutedForeground text-xs font-heading">(showing top {displayedCars.length})</span>
              )}
              {selectedCars.length > 0 && (
                <span className="text-primary text-xs font-heading">({selectedCars.length} selected)</span>
              )}
              {displayedCars.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={toggleSelectAllDisplayed}
                    disabled={noEligibleInView}
                    className={`inline-flex items-center gap-2 text-xs font-heading font-bold uppercase tracking-wider transition-smooth ${
                      noEligibleInView ? 'text-mutedForeground/60 cursor-not-allowed' : 'text-mutedForeground hover:text-primary'
                    }`}
                    data-testid="garage-select-all"
                    title={noEligibleInView ? 'No cars in view match your melt/scrap rarity filter' : undefined}
                  >
                    {allDisplayedSelected ? (
                      <CheckSquare size={14} className="text-primary" />
                    ) : (
                      <Square size={14} className="text-mutedForeground" />
                    )}
                    {noEligibleInView
                      ? 'No cars match filter'
                      : allDisplayedSelected
                        ? `Clear selection${filterActive ? ` (${displayedEligibleIds.length})` : ''}`
                        : `Select all${filterActive ? ` (${displayedEligibleIds.length})` : ''}`}
                  </button>
                  <button
                    type="button"
                    onClick={openMeltScrapSettings}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-sm border border-primary/30 text-mutedForeground hover:text-primary hover:border-primary/50 transition-smooth"
                    title="Melt/Scrap rarities filter"
                    aria-label="Melt/Scrap settings"
                  >
                    <Settings size={14} />
                  </button>
                </>
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
                onClick={() => (car.car_id === 'car_custom' ? openCustomCarModal(car) : toggleSelect(car.user_car_id))}
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
                  {car.car_id !== 'car_custom' && (
                    <div className="absolute top-1 right-1 w-6 h-6 rounded flex items-center justify-center bg-background/90 border border-primary/40 shadow">
                      {selectedCars.includes(car.user_car_id) ? (
                        <CheckSquare size={16} className="text-primary" strokeWidth={2.5} />
                      ) : (
                        <Square size={16} className="text-mutedForeground" strokeWidth={2} />
                      )}
                    </div>
                  )}
                </div>
                <div className={`text-[8px] sm:text-[9px] font-heading font-bold uppercase tracking-wider ${getRarityColor(car.rarity)} leading-tight`}>
                  {car.rarity.replace('_', ' ')}
                </div>
                <Link
                  to={`/gta/car/${car.car_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] sm:text-xs font-heading font-bold text-foreground truncate leading-tight block hover:text-primary hover:underline focus:outline-none focus:underline"
                >
                  {car.name}
                </Link>
                <div className="flex items-center justify-between gap-1">
                  <div className="text-[9px] sm:text-[10px] text-primary font-heading font-bold">${car.value.toLocaleString()}</div>
                  {car.car_id !== 'car_custom' && (
                    <div className={`flex items-center gap-0.5 text-[8px] sm:text-[9px] font-heading ${selectedCars.includes(car.user_car_id) ? 'text-primary font-bold' : 'text-mutedForeground'}`}>
                      {selectedCars.includes(car.user_car_id) ? (
                        <><CheckSquare size={10} className="shrink-0" /> Selected</>
                      ) : (
                        <><Square size={10} className="shrink-0" /> —</>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Melt/Scrap rarities settings modal */}
          {meltScrapSettingsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setMeltScrapSettingsOpen(false)}>
              <div className={`${styles.panel} border border-primary/30 rounded-sm shadow-xl max-w-sm w-full p-4`} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                    <Settings size={16} /> Melt / Scrap filter
                  </h3>
                  <button type="button" onClick={() => setMeltScrapSettingsOpen(false)} className="text-mutedForeground hover:text-foreground">✕</button>
                </div>
                <p className="text-xs text-mutedForeground font-heading mb-3">
                  When you use &quot;Select all&quot;, only cars of these rarities are selected. Leave all unchecked to include every rarity.
                </p>
                <div className="space-y-2 mb-4">
                  {ALL_RARITIES.map((rarity) => (
                    <label key={rarity} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={meltScrapSettingsDraft.includes(rarity)}
                        onChange={() => toggleDraftRarity(rarity)}
                        className="rounded border-primary/50 text-primary focus:ring-primary/50"
                      />
                      <span className={`text-sm font-heading capitalize ${getRarityColor(rarity)}`}>
                        {rarity.replace('_', ' ')}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMeltScrapSettingsDraft([])}
                    className="text-xs font-heading text-mutedForeground hover:text-primary"
                  >
                    Clear (allow all)
                  </button>
                  <button
                    type="button"
                    onClick={saveMeltScrapSettings}
                    className="flex-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground font-heading font-bold uppercase tracking-wider py-2 rounded-sm border border-yellow-600/50"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Custom car picture modal */}
          {customCarModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setCustomCarModal(null)}>
              <div className={`${styles.panel} border border-primary/30 rounded-sm shadow-xl max-w-md w-full p-4`} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Custom car — change picture</h3>
                  <button type="button" onClick={() => setCustomCarModal(null)} className="text-mutedForeground hover:text-foreground">✕</button>
                </div>
                <p className="text-xs text-mutedForeground font-heading mb-2">{customCarModal.name}</p>
                <div className="aspect-video rounded-sm overflow-hidden bg-muted border border-primary/20 mb-3">
                  {customCarImageUrl ? (
                    <img src={customCarImageUrl} alt={customCarModal.name} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Car size={32} className="text-primary/30" /></div>
                  )}
                </div>
                <label className="block text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Image URL</label>
                <input
                  type="url"
                  value={customCarImageUrl}
                  onChange={(e) => setCustomCarImageUrl(e.target.value)}
                  placeholder="https://..."
                  className={`${styles.input} w-full h-9 px-3 text-sm mb-3`}
                />
                <div className="flex gap-2">
                  <button type="button" onClick={saveCustomCarImage} disabled={savingCustomImage} className="flex-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground font-heading font-bold uppercase tracking-wider py-2 rounded-sm border border-yellow-600/50 disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => setCustomCarModal(null)} className="px-4 border border-primary/30 font-heading text-sm rounded-sm hover:bg-primary/10">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* View All / Show Less */}
          {totalCount > DEFAULT_VISIBLE && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className={`flex items-center gap-2 ${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary rounded-sm px-5 py-2 text-xs font-heading font-bold uppercase tracking-wider transition-smooth`}
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
    </div>
  );
}
