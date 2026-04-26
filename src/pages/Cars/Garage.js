import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Car, Flame, DollarSign, CheckSquare, Square, Filter, Settings, Wrench } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import { toast } from 'sonner';

const GARAGE_CACHE_KEY = 'mafia_garage_v1';
import { filterProfanity } from '../../utils/profanityFilter';
import styles from '../../styles/noir.module.css';
import ActiveTokenBadge from '../../components/ActiveTokenBadge';
import CustomCarImageModal from '../../components/CustomCarImageModal';
import { useGameActionsTurnstile } from '../../hooks/useGameActionsTurnstile';

const GARAGE_STYLES = `
  @keyframes gar-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .gar-fade-in { animation: gar-fade-in 0.4s ease-out both; }
  .gar-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .gar-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const RARITY_ORDER = { exclusive: 7, loot_exclusive: 6, custom: 5, legendary: 4, ultra_rare: 3, rare: 2, uncommon: 1, common: 0 };
const DEFAULT_VISIBLE = 100;
const MELT_SCRAP_RARITIES_KEY = 'garage_melt_scrap_rarities';
/** Keep in sync with backend `server.py` + `routers/cars/gta.py` melt math. */
const MELT_VALUE_PER_BULLET = 385;
const MELT_VALUE_MULTIPLIER_NUM = 122;
const MELT_VALUE_MULTIPLIER_DEN = 100;
/** Applied to sum of per-car bullets in one melt; keep in sync with `gta.py` MELT_BULLETS_TOTAL_PAYOUT_* */
const MELT_BULLETS_TOTAL_PAYOUT_MULT_NUM = 125;
const MELT_BULLETS_TOTAL_PAYOUT_MULT_DEN = 100;
/** Match `gta.REPAIR_COST_FRACTION` (repair-car / repair-all). */
const REPAIR_COST_FRACTION = 0.6;
const ALL_RARITIES = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary', 'custom', 'loot_exclusive', 'exclusive'];
/** Match SellCars / BuyCars labels for rarity pills */
const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  ultra_rare: 'Ultra Rare',
  legendary: 'Legendary',
  custom: 'Customs',
  loot_exclusive: 'Loot Exclusive',
  exclusive: 'Exclusives',
};

function normalizeCarRarity(rarity) {
  const raw = String(rarity || '').trim().toLowerCase();
  if (!raw) return 'common';
  const compact = raw.replace(/[\s-]+/g, '_');
  if (compact === 'lootexclusive') return 'loot_exclusive';
  if (compact === 'ultrarare') return 'ultra_rare';
  return ALL_RARITIES.includes(compact) ? compact : 'common';
}

function isDamageImmuneCar(carId, rarity) {
  const r = normalizeCarRarity(rarity);
  if (carId === 'car_custom') return true;
  return r === 'exclusive' || r === 'loot_exclusive';
}

/** Same billable repair total as the garage repair-all endpoint (listed / immune / 0 damage = $0). */
function previewRepairCostForCar(car) {
  if (!car || car.listed_for_sale) return 0;
  if (isDamageImmuneCar(car.car_id, car.rarity)) return 0;
  const damage = Math.min(100, Math.max(0, Number(car.damage_percent) || 0));
  if (damage <= 0) return 0;
  const value = Number(car.value) || 0;
  return Math.max(1, Math.round((damage / 100) * value * REPAIR_COST_FRACTION));
}

/** Per-car melt-for-bullets preview; keep in sync with gta._effective_catalog_value_for_melt_bullets + melt pipeline. */
function previewBulletsForCarValue(value, rarity, damagePercent = 0, carId = '') {
  const carValue = Number(value || 0);
  if (!Number.isFinite(carValue) || carValue <= 0) return 0;
  const r = normalizeCarRarity(rarity);
  let effective = carValue;
  if (!isDamageImmuneCar(carId, r)) {
    const d = Math.min(100, Math.max(0, Number(damagePercent) || 0));
    effective = Math.max(0, Math.floor((carValue * (100 - d)) / 100));
  }
  const meltValue = Math.floor((effective * MELT_VALUE_MULTIPLIER_NUM) / MELT_VALUE_MULTIPLIER_DEN);
  let bullets = Math.floor(meltValue / MELT_VALUE_PER_BULLET);
  if (r === 'common') {
    if (bullets < 5) bullets = 5;
    else if (bullets > 7) bullets = 7;
  }
  // +25% bullets for all but exclusive / loot_exclusive (floor-rounded), keep in sync with backend melt rewards.
  if (r !== 'exclusive' && r !== 'loot_exclusive') bullets = Math.floor((bullets * 125) / 100);
  return bullets;
}

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

/** Normalize server/local rarity ids so they match `car.rarity` / auto-rank filters. */
function normalizeMeltScrapRarityList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => String(x).trim()).filter((r) => ALL_RARITIES.includes(r));
}

// Subcomponents
const RARITY_COLORS = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  ultra_rare: 'text-purple-400',
  legendary: 'text-yellow-400',
  custom: 'text-orange-400',
  loot_exclusive: 'text-amber-400',
  exclusive: 'text-red-400',
};

const EmptyGarageCard = () => (
  <div className={`relative ${styles.panel} rounded-lg border border-primary/20 py-12 text-center gar-fade-in overflow-hidden mobile-panel`}>
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

const FiltersSortCard = ({ sortBy, setSortBy, filterRarity, setFilterRarity, raritySummary }) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 gar-fade-in mobile-panel`}>
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-1.5">
        <Filter size={14} />
        Sort & Filter
      </h2>
    </div>
    {/* By rarity: same pill pattern as Sell Cars */}
    <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[10px] font-heading text-mutedForeground uppercase">By rarity:</span>
      {raritySummary.length === 0 ? (
        <span className="text-[10px] text-mutedForeground">No cars</span>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setFilterRarity('all')}
            className={`text-[11px] font-heading font-bold py-0.5 px-1 rounded transition-colors ${
              filterRarity === 'all'
                ? 'bg-primary/20 text-primary border border-primary/50'
                : 'border border-transparent hover:bg-secondary/50 text-mutedForeground hover:text-foreground'
            }`}
          >
            All
          </button>
          {raritySummary.map((row) => (
            <button
              key={row.rarity}
              type="button"
              onClick={() => setFilterRarity(filterRarity === row.rarity ? 'all' : row.rarity)}
              className={`text-[11px] font-heading font-bold py-0.5 px-1 rounded transition-colors ${
                filterRarity === row.rarity
                  ? 'bg-primary/20 text-primary border border-primary/50'
                  : `border border-transparent hover:bg-secondary/50 ${RARITY_COLORS[row.rarity] || 'text-foreground'}`
              }`}
            >
              {row.label} ({row.count})
            </button>
          ))}
          {filterRarity !== 'all' && (
            <button
              type="button"
              onClick={() => setFilterRarity('all')}
              className="text-[10px] font-heading text-mutedForeground hover:text-primary"
            >
              Show all
            </button>
          )}
        </>
      )}
    </div>
    <div className="p-3">
      <div>
        <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
          Sort By
        </label>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="w-full max-w-xs bg-input border border-border rounded px-2 py-1.5 text-xs font-heading text-foreground focus:border-primary/50 focus:outline-none transition-colors"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="value-high">Highest Value</option>
          <option value="value-low">Lowest Value</option>
          <option value="rarity">Rarity</option>
        </select>
      </div>
    </div>
    <div className="gar-art-line text-primary mx-3" />
  </div>
);

const ActionsBar = ({
  displayedCount,
  pageSummary,
  selectedCount,
  selectedEligibleCount,
  allBulkSelected,
  noBulkSelectable,
  noMeltMatchInList,
  filterActive,
  bulkSelectCount,
  onToggleSelectAll,
  onOpenSettings,
  onMelt,
  onScrap,
  meltBulletsSecondsRemaining,
  predictedMeltBullets,
  repairAllCount,
  repairAllTotal,
  onRepairAll,
  repairingAll,
}) => {
  const meltOnCooldown = meltBulletsSecondsRemaining != null && meltBulletsSecondsRemaining > 0;
  return (
    <div className={`relative ${styles.panel} rounded-lg border border-primary/20 p-3 gar-fade-in overflow-hidden mobile-panel`}>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {pageSummary ? (
            <span className="text-[10px] text-mutedForeground font-heading">
              {pageSummary}
            </span>
          ) : null}
          
          {selectedCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/30">
              {selectedCount} selected
              {selectedEligibleCount !== selectedCount && (
                <span className="text-amber-300 font-normal"> ({selectedEligibleCount} eligible)</span>
              )}
            </span>
          )}
          
          {(displayedCount > 0 || repairAllCount > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {displayedCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={onToggleSelectAll}
                    disabled={noBulkSelectable}
                    title={
                      noBulkSelectable
                        ? filterActive
                          ? 'No cars in this list match your melt/scrap rarity filter (or all are listed).'
                          : 'No unlisted cars in this list.'
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-heading font-bold uppercase tracking-wide transition-all ${
                      noBulkSelectable
                        ? 'border-border text-mutedForeground/60 cursor-not-allowed'
                        : 'border-primary/30 text-foreground hover:border-primary/50 hover:bg-primary/10 active:scale-95'
                    }`}
                    data-testid="garage-select-all"
                  >
                    {allBulkSelected ? (
                      <CheckSquare size={12} className="text-primary" />
                    ) : (
                      <Square size={12} className="text-mutedForeground" />
                    )}
                    {noBulkSelectable
                      ? noMeltMatchInList
                        ? 'No match'
                        : 'None to select'
                      : allBulkSelected
                        ? `Clear${bulkSelectCount > 0 ? ` (${bulkSelectCount})` : ''}`
                        : `Select all${bulkSelectCount > 0 ? ` (${bulkSelectCount})` : ''}`}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-primary/30 text-mutedForeground hover:text-primary hover:border-primary/50 hover:bg-primary/10 transition-all active:scale-95"
                    title="Filter rarities"
                  >
                    <Settings size={14} />
                  </button>
                </>
              )}
              {repairAllCount > 0 && (
                <button
                  type="button"
                  onClick={onRepairAll}
                  disabled={repairingAll}
                  title={`Repair every damaged car in your fleet (${repairAllCount} car${repairAllCount === 1 ? '' : 's'})`}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-heading font-bold uppercase tracking-wide transition-all ${
                    repairingAll
                      ? 'border-border text-mutedForeground/60 cursor-wait'
                      : 'border-sky-500/40 text-sky-300 hover:border-sky-400/60 hover:bg-sky-500/10 active:scale-95'
                  }`}
                >
                  <Wrench size={12} />
                  {repairingAll ? 'Repairing…' : `Repair all $${repairAllTotal.toLocaleString()}`}
                </button>
              )}
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
              title={meltOnCooldown ? `Melt cooldown active. Next melt in ${meltBulletsSecondsRemaining}s` : 'Melt selected eligible cars for bullets'}
              className={`rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase tracking-wide border inline-flex items-center gap-1.5 touch-manipulation transition-all ${
                meltOnCooldown
                  ? 'bg-secondary/50 text-mutedForeground border-border cursor-not-allowed'
                  : 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 shadow active:scale-95'
              }`}
            >
              <Flame size={12} />
              Melt bullets
              {selectedEligibleCount > 0 && selectedEligibleCount !== selectedCount && (
                <span className="font-normal normal-case text-amber-300/90">({selectedEligibleCount} eligible)</span>
              )}
              {predictedMeltBullets != null && predictedMeltBullets > 0 && (
                <span className="font-normal normal-case text-amber-400/90">→ {predictedMeltBullets.toLocaleString()} bullets</span>
              )}
            </button>
            <button
              type="button"
              onClick={onScrap}
              className="bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded px-3 py-1.5 text-[10px] font-heading font-bold uppercase tracking-wide transition-all active:scale-95 inline-flex items-center gap-1.5 touch-manipulation"
              title="Scrap selected cars for cash only (no cooldown)"
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

const CarCard = ({ car, isSelected, onToggle, onOpenCustomModal, onRepair, repairingCarId, repairingAll = false, getRarityColor, censorProfanity = false }) => {
  const isCustom = car.car_id === 'car_custom';
  const isListed = car.listed_for_sale;
  const damage = car.damage_percent ?? 0;
  const isRepairing = repairingCarId === car.user_car_id;
  const displayName = censorProfanity ? filterProfanity(car.name) : car.name;
  const handleClick = () => {
    if (!isListed) onToggle(car.user_car_id);
  };
  const isExclusive = car.rarity === 'exclusive' || car.rarity === 'loot_exclusive';
  return (
    <div
      onClick={handleClick}
      className={`${styles.panel} rounded-lg border p-1.5 transition-all gar-card ${
        isListed ? 'border-amber-500/40 opacity-90' : 'cursor-pointer'
      } ${
        !isListed && (isSelected ? 'border-primary shadow-md shadow-primary/20' : 'border-border hover:border-primary/30')
      } ${isExclusive ? 'shadow-[0_0_10px_rgba(251,191,36,0.45)]' : ''}`}
    >
      <div className="w-full aspect-[4/3] rounded overflow-hidden bg-secondary border border-border mb-1.5 relative">
        {car.image ? (
          <img
            src={car.image}
            alt={displayName}
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
        {!isListed && (
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
        {displayName}
      </Link>
      
      <div className="text-[10px] text-primary font-heading font-bold flex items-center justify-between">
        <span>${car.value.toLocaleString()}</span>
        {isCustom && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenCustomModal(car); }}
            className="text-[8px] px-1 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 font-heading"
          >
            Edit
          </button>
        )}
      </div>
      {damage > 0 && !isListed && (
        <div className="flex items-center justify-between gap-1 mt-1">
          <span
            className={`text-[9px] font-heading ${damage >= 100 ? 'text-red-400' : 'text-mutedForeground'}`}
          >
            {damage >= 100 ? '100% damage' : `${damage}% damage`}
          </span>
          {onRepair && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRepair(car); }}
              disabled={isRepairing || repairingAll}
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
            Select rarities to melt or scrap. Empty = none (no cars will be melted or scrapped).
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
              className="flex-1 bg-primary/20 text-primary rounded px-3 py-1.5 font-heading font-bold uppercase tracking-wide text-xs border border-primary/40 hover:bg-primary/30 transition-all active:scale-95"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main component
export default function Garage() {
  const [bootGarage] = useState(() => readSessionJson(GARAGE_CACHE_KEY));
  const [cars, setCars] = useState(() => (bootGarage?.cars ?? []).map((c) => ({ ...c, rarity: normalizeCarRarity(c?.rarity) })));
  const [selectedCars, setSelectedCars] = useState([]);
  const [sortBy, setSortBy] = useState('value-high');
  const [filterRarity, setFilterRarity] = useState('all');
  const [garagePage, setGaragePage] = useState(0);
  const [customCarModal, setCustomCarModal] = useState(null);
  const [customCarImageUrl, setCustomCarImageUrl] = useState('');
  const [savingCustomImage, setSavingCustomImage] = useState(false);
  const [meltScrapRarities, setMeltScrapRarities] = useState(() => loadMeltScrapRarities());
  const [meltScrapSettingsOpen, setMeltScrapSettingsOpen] = useState(false);
  const [meltScrapSettingsDraft, setMeltScrapSettingsDraft] = useState([]);
  const [meltBulletsCooldownUntil, setMeltBulletsCooldownUntil] = useState(null);
  const [meltBulletsSecondsRemaining, setMeltBulletsSecondsRemaining] = useState(0);
  const [repairingCarId, setRepairingCarId] = useState(null);
  const [repairingAll, setRepairingAll] = useState(false);
  const [user, setUser] = useState(null);
  const { getCaptchaToken, captchaModal } = useGameActionsTurnstile();

  const fetchGarage = useCallback(async (silent = false) => {
    try {
      const response = await api.get('/gta/garage');
      const nextCars = (response.data?.cars ?? []).map((c) => ({ ...c, rarity: normalizeCarRarity(c?.rarity) }));
      const cd = response.data?.melt_bullets_cooldown_until ?? null;
      setCars(nextCars);
      setMeltBulletsCooldownUntil(cd);
      writeSessionJson(GARAGE_CACHE_KEY, { cars: nextCars, melt_bullets_cooldown_until: cd });
    } catch (error) {
      if (!silent) {
        toast.error('Failed to load garage');
        setCars([]);
        setMeltBulletsCooldownUntil(null);
      }
    }
  }, []);

  useEffect(() => {
    const c = readSessionJson(GARAGE_CACHE_KEY);
    fetchGarage(c != null);
    api.get('/auth/me').then((r) => setUser(r.data)).catch(() => {});
  }, [fetchGarage]);

  // Keep melt/scrap rarity filters in sync with the server so Auto Rank uses the same rules as the garage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/auto-rank/me');
        if (cancelled) return;
        const serverList = normalizeMeltScrapRarityList(r.data?.auto_rank_melt_rarity_ids);
        const localList = loadMeltScrapRarities();
        if (localList.length === 0 && serverList.length > 0) {
          setMeltScrapRarities(serverList);
          saveMeltScrapRarities(serverList);
        } else if (localList.length > 0 && serverList.length === 0) {
          await api.patch('/auto-rank/me', {
            auto_rank_melt_rarity_ids: localList,
            auto_rank_scrap_rarity_ids: localList,
          });
        }
      } catch (_) {
        /* not logged in or auto-rank unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => fetchGarage(true), 60_000);
    return () => clearInterval(id);
  }, [fetchGarage]);

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

  const allFilteredCars = useMemo(() => {
    let filtered = [...cars];
    if (filterRarity !== 'all') {
      filtered = filtered.filter((car) => car.rarity === filterRarity);
    }
    filtered.sort((a, b) => {
      const rarityCmp = () => (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0);
      const valueCmp = () => (Number(b.value) || 0) - (Number(a.value) || 0);
      switch (sortBy) {
        case 'newest':
          return new Date(b.acquired_at) - new Date(a.acquired_at);
        case 'oldest':
          return new Date(a.acquired_at) - new Date(b.acquired_at);
        case 'value-high': {
          const v = valueCmp();
          if (v !== 0) return v;
          return rarityCmp();
        }
        case 'value-low': {
          const v = (Number(a.value) || 0) - (Number(b.value) || 0);
          if (v !== 0) return v;
          return rarityCmp();
        }
        case 'rarity': {
          const r = rarityCmp();
          if (r !== 0) return r;
          return valueCmp();
        }
        default:
          return 0;
      }
    });
    return filtered;
  }, [cars, filterRarity, sortBy]);

  const raritySummary = useMemo(() => {
    const counts = {};
    cars.forEach((c) => {
      const r = c.rarity || 'common';
      counts[r] = (counts[r] || 0) + 1;
    });
    return ALL_RARITIES.filter((r) => (counts[r] || 0) > 0).map((r) => ({
      rarity: r,
      label: RARITY_LABELS[r] || r,
      count: counts[r] || 0,
    }));
  }, [cars]);

  const totalCount = allFilteredCars.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / DEFAULT_VISIBLE));
  const safePage = Math.min(Math.max(0, garagePage), totalPages - 1);
  const pageOffset = safePage * DEFAULT_VISIBLE;
  const displayedCars = allFilteredCars.slice(pageOffset, pageOffset + DEFAULT_VISIBLE);

  useEffect(() => {
    setGaragePage(0);
  }, [filterRarity, sortBy]);

  useEffect(() => {
    setGaragePage((p) => Math.min(p, totalPages - 1));
  }, [totalPages]);

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
    if (!car?.user_car_id || repairingAll) return;
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

  const repairAllPreview = useMemo(() => {
    let total = 0;
    let count = 0;
    cars.forEach((c) => {
      const cost = previewRepairCostForCar(c);
      if (cost > 0) {
        total += cost;
        count += 1;
      }
    });
    return { total, count };
  }, [cars]);

  const handleRepairAll = async () => {
    const { total, count } = repairAllPreview;
    if (count === 0 || repairingAll) return;
    const money = Number(user?.money);
    const affordHint =
      Number.isFinite(money) && money < total
        ? `\n\nYou only have $${money.toLocaleString()}; this action will be rejected until you have enough cash.`
        : '';
    if (
      !window.confirm(
        `Repair ${count} damaged car${count === 1 ? '' : 's'} for a total of $${total.toLocaleString()}?${affordHint}`
      )
    ) {
      return;
    }
    setRepairingAll(true);
    try {
      const res = await api.post('/gta/repair-all');
      toast.success(res.data?.message || 'Fleet repaired');
      refreshUser();
      fetchGarage();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Repair all failed');
    } finally {
      setRepairingAll(false);
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
    const eligibleIds = meltScrapRarities.length > 0
      ? selectedCars.filter((id) => {
          const c = cars.find((car) => car.user_car_id === id);
          return c && !c.listed_for_sale && meltScrapRarities.includes(c.rarity);
        })
      : [];
    if (eligibleIds.length === 0) {
      toast.error(meltScrapRarities.length === 0 ? 'Select rarities to melt or scrap (Melt/Scrap settings)' : 'No eligible cars selected');
      return;
    }
    if (meltBulletsSecondsRemaining > 0) return;
    let captchaToken = null;
    try {
      captchaToken = await getCaptchaToken();
    } catch (e) {
      if (e?.message === 'captcha_cancelled') return;
      throw e;
    }
    try {
      const response = await api.post('/gta/melt', {
        car_ids: eligibleIds,
        action: 'bullets',
        manual_garage: true,
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      });
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
    const eligibleIds = meltScrapRarities.length > 0
      ? selectedCars.filter((id) => {
          const c = cars.find((car) => car.user_car_id === id);
          return c && !c.listed_for_sale && meltScrapRarities.includes(c.rarity);
        })
      : [];
    if (eligibleIds.length === 0) {
      toast.error(meltScrapRarities.length === 0 ? 'Select rarities to melt or scrap (Melt/Scrap settings)' : 'No eligible cars selected');
      return;
    }
    let captchaToken = null;
    try {
      captchaToken = await getCaptchaToken();
    } catch (e) {
      if (e?.message === 'captcha_cancelled') return;
      throw e;
    }
    try {
      const response = await api.post('/gta/melt', {
        car_ids: eligibleIds,
        action: 'cash',
        manual_garage: true,
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      });
      toast.success(response.data.message);
      setSelectedCars([]);
      refreshUser();
      fetchGarage();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to scrap cars');
    }
  };

  const getRarityColor = (rarity) => RARITY_COLORS[rarity] || 'text-foreground';

  const pageSummary =
    totalCount === 0
      ? ''
      : totalPages > 1
        ? `Page ${safePage + 1} / ${totalPages} · ${pageOffset + 1}–${pageOffset + displayedCars.length} of ${totalCount}`
        : `${totalCount} car${totalCount === 1 ? '' : 's'}`;

  const filterActive = meltScrapRarities.length > 0;
  const bulkSelectIds = useMemo(() => {
    return allFilteredCars
      .filter((c) => {
        if (c.listed_for_sale) return false;
        if (filterActive) return meltScrapRarities.includes(c.rarity);
        return true;
      })
      .map((c) => c.user_car_id);
  }, [allFilteredCars, filterActive, meltScrapRarities]);
  const bulkSelectCount = bulkSelectIds.length;
  const allBulkSelected =
    bulkSelectCount > 0 && bulkSelectIds.every((id) => selectedCars.includes(id));
  const noBulkSelectable = bulkSelectCount === 0;
  const noMeltMatchInList = filterActive && bulkSelectCount === 0;

  const batchLimit = user?.garage_batch_limit ?? 6;
  const selectedCarsForMelt = allFilteredCars.filter(
    (c) => selectedCars.includes(c.user_car_id) && !c.listed_for_sale && meltScrapRarities.length > 0 && meltScrapRarities.includes(c.rarity)
  );
  const predictedMeltBullets = Math.floor(
    (selectedCarsForMelt
      .slice(0, batchLimit)
      .reduce((sum, c) => sum + previewBulletsForCarValue(c.value, c.rarity, c.damage_percent, c.car_id), 0) *
      MELT_BULLETS_TOTAL_PAYOUT_MULT_NUM) /
      MELT_BULLETS_TOTAL_PAYOUT_MULT_DEN
  );

  const toggleSelectAllBulk = () => {
    if (bulkSelectCount === 0) return;
    setSelectedCars((prev) => {
      if (allBulkSelected) {
        const drop = new Set(bulkSelectIds);
        return prev.filter((id) => !drop.has(id));
      }
      return [...new Set([...prev, ...bulkSelectIds])];
    });
  };

  const openMeltScrapSettings = () => {
    setMeltScrapSettingsDraft([...meltScrapRarities]);
    setMeltScrapSettingsOpen(true);
  };

  const saveMeltScrapSettings = async () => {
    const next = normalizeMeltScrapRarityList(meltScrapSettingsDraft);
    setMeltScrapRarities(next);
    saveMeltScrapRarities(next);
    setMeltScrapSettingsOpen(false);
    try {
      await api.patch('/auto-rank/me', {
        auto_rank_melt_rarity_ids: next,
        auto_rank_scrap_rarity_ids: next,
      });
    } catch (_) {
      /* local + LS still apply; server sync best-effort */
    }
  };

  const toggleDraftRarity = (rarity) => {
    setMeltScrapSettingsDraft((prev) =>
      prev.includes(rarity) ? prev.filter((r) => r !== rarity) : [...prev, rarity]
    );
  };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
      <style>{GARAGE_STYLES}</style>

      <div className="relative gar-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Your Fleet</p>
        <p className="text-[10px] text-zinc-500 font-heading italic">
          View, melt, scrap, and list your cars. Melt for bullets pays less when a car is damaged (repair for full value); exclusives, loot exclusives, and customs ignore damage.
        </p>
        <AutoRefreshNote seconds={60} />
      </div>

      {user?.melt_until && (
        <div className="gar-fade-in">
          <ActiveTokenBadge tokenType="melt" untilIso={user.melt_until} />
        </div>
      )}

      {cars.length === 0 ? (
        <EmptyGarageCard />
      ) : (
        <>
          <FiltersSortCard
            sortBy={sortBy}
            setSortBy={setSortBy}
            filterRarity={filterRarity}
            setFilterRarity={setFilterRarity}
            raritySummary={raritySummary}
          />

          <ActionsBar
            displayedCount={displayedCars.length}
            pageSummary={pageSummary}
            selectedCount={selectedCars.length}
            selectedEligibleCount={selectedCarsForMelt.length}
            allBulkSelected={allBulkSelected}
            noBulkSelectable={noBulkSelectable}
            noMeltMatchInList={noMeltMatchInList}
            filterActive={filterActive}
            bulkSelectCount={bulkSelectCount}
            onToggleSelectAll={toggleSelectAllBulk}
            onOpenSettings={openMeltScrapSettings}
            onMelt={meltCars}
            onScrap={scrapCars}
            meltBulletsSecondsRemaining={meltBulletsSecondsRemaining > 0 ? meltBulletsSecondsRemaining : null}
            predictedMeltBullets={selectedCars.length > 0 ? predictedMeltBullets : null}
            repairAllCount={repairAllPreview.count}
            repairAllTotal={repairAllPreview.total}
            onRepairAll={handleRepairAll}
            repairingAll={repairingAll}
          />

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {displayedCars.map((car) => (
              <CarCard
                key={car.user_car_id || car._id}
                car={car}
                isSelected={selectedCars.includes(car.user_car_id)}
                onToggle={toggleSelect}
                onOpenCustomModal={openCustomCarModal}
                onRepair={handleRepair}
                repairingCarId={repairingCarId}
                repairingAll={repairingAll}
                getRarityColor={getRarityColor}
                censorProfanity={user?.censor_profanity}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 0}
                  onClick={() => setGaragePage((p) => Math.max(0, p - 1))}
                  className="px-2 py-1.5 rounded border border-border text-[10px] font-heading font-bold uppercase text-mutedForeground hover:text-foreground hover:border-primary/30 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
                >
                  Prev
                </button>
                {totalPages <= 15 ? (
                  Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setGaragePage(i)}
                      className={`min-w-[2rem] px-2 py-1.5 rounded border text-[10px] font-heading font-bold touch-manipulation ${
                        i === safePage
                          ? 'border-primary/60 bg-primary/20 text-primary'
                          : 'border-border text-mutedForeground hover:text-foreground hover:border-primary/30'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))
                ) : (
                  <label className="flex items-center gap-1.5 text-[10px] font-heading text-mutedForeground">
                    <span>Page</span>
                    <select
                      value={safePage}
                      onChange={(e) => setGaragePage(Number(e.target.value))}
                      className="bg-input border border-border rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                    >
                      {Array.from({ length: totalPages }, (_, i) => (
                        <option key={i} value={i}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                    <span>of {totalPages}</span>
                  </label>
                )}
                <button
                  type="button"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setGaragePage((p) => Math.min(totalPages - 1, p + 1))}
                  className="px-2 py-1.5 rounded border border-border text-[10px] font-heading font-bold uppercase text-mutedForeground hover:text-foreground hover:border-primary/30 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
                >
                  Next
                </button>
              </div>
              <span className="text-[9px] text-mutedForeground font-heading">{DEFAULT_VISIBLE} per page</span>
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

      <CustomCarImageModal
        car={customCarModal}
        imageUrl={customCarImageUrl}
        setImageUrl={setCustomCarImageUrl}
        onSave={saveCustomCarImage}
        onClose={() => setCustomCarModal(null)}
        saving={savingCustomImage}
        censorProfanity={user?.censor_profanity}
      />
      {captchaModal}
    </div>
  );
}
