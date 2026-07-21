import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Car, CheckSquare, Square } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { useAuthUser } from '../../context/AuthContext';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const BUY_STYLES = `
  @keyframes bc-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .bc-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .bc-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  @media (max-width: 767px) {
    .bc-row td { padding-top: 3px !important; padding-bottom: 3px !important; }
  }
`;
// Entrance fade only runs on the first visit per session so revisits don't
// look like a full page reload.
const BUY_FADE_STYLES = `
  .bc-fade-in { animation: bc-fade-in 0.4s ease-out both; }
`;
let _bcIntroPlayed = false;
// Session cache so revisits paint instantly while a fresh fetch runs.
let _cachedBuyCars = null;

// Rarities and travel times – must match backend GTA (server CARS + gta.py TRAVEL_TIMES)
const GTA_RARITIES = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary', 'custom', 'loot_exclusive', 'exclusive', 'vip_exclusive'];
const RARITY_ORDER = [...GTA_RARITIES].reverse();

const TRAVEL_TIMES = {
  exclusive: 7,
  loot_exclusive: 7,
  vip_exclusive: 8,
  legendary: 12,
  ultra_rare: 18,
  rare: 25,
  uncommon: 35,
  common: 45,
  custom: 12,
};

const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rares',
  ultra_rare: 'Ultra Rare',
  legendary: 'Legendary',
  custom: 'Customs',
  loot_exclusive: 'Loot Exclusives',
  exclusive: 'Exclusives',
  vip_exclusive: 'VIP Pass',
};
/** Pause after each successful dealer buy so "buy selected" does not trip server pacing (see DEALER_BUY_MIN_INTERVAL_SEC in gta.py). */

function VehicleSelectCheckbox({ selected, canAfford, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="min-h-[28px] min-w-[28px] inline-flex items-center justify-center rounded hover:bg-primary/10"
      title={canAfford ? 'Select to buy' : 'Select — need more cash to purchase'}
    >
      {selected ? (
        <CheckSquare size={12} className={canAfford ? 'text-primary' : 'text-amber-400'} />
      ) : (
        <Square size={12} className={canAfford ? 'text-mutedForeground' : 'text-amber-500/80'} />
      )}
    </button>
  );
}

const RARITY_COLOR = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  ultra_rare: 'text-purple-400',
  legendary: 'text-yellow-400',
  custom: 'text-orange-400',
  loot_exclusive: 'text-amber-400',
  exclusive: 'text-red-400',
  vip_exclusive: 'text-cyan-500',
};

export default function BuyCars() {
  const authUser = useAuthUser();
  const animateIn = useState(() => !_bcIntroPlayed)[0];
  useEffect(() => { _bcIntroPlayed = true; }, []);
  const [dealerCars, setDealerCars] = useState(() => _cachedBuyCars?.dealerCars ?? []);
  const [marketplaceListings, setMarketplaceListings] = useState(() => _cachedBuyCars?.marketplaceListings ?? []);
  const [dealership, setDealership] = useState(() => _cachedBuyCars?.dealership ?? null);
  const [dealershipSaving, setDealershipSaving] = useState(false);
  const [dealershipTransferUsername, setDealershipTransferUsername] = useState('');
  const [dealershipSellPoints, setDealershipSellPoints] = useState('');
  const [stockRarity, setStockRarity] = useState('legendary');
  const [stockTarget, setStockTarget] = useState('100');
  const [stockPayFrom, setStockPayFrom] = useState('cash');
  const [stockEstimate, setStockEstimate] = useState(null);
  const [autoStockRarity, setAutoStockRarity] = useState('legendary');
  const [autoStockTarget, setAutoStockTarget] = useState('100');
  const [userMoney, setUserMoney] = useState(() => (authUser?.money != null ? authUser.money : null));
  const [hasLoaded, setHasLoaded] = useState(_cachedBuyCars != null);
  const [selectedRarity, setSelectedRarity] = useState(null);
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'dealer' | 'listing'
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [dealerQtyByRowId, setDealerQtyByRowId] = useState({});
  const [buying, setBuying] = useState(false);
  const [cancellingUserCarId, setCancellingUserCarId] = useState(null);

  const fetchAll = async () => {
    try {
      const [saleRes, marketRes] = await Promise.all([
        api.get('/gta/cars-for-sale').catch(() => ({ data: { cars: [] } })),
        api.get('/gta/marketplace').catch(() => ({ data: { listings: [] } })),
      ]);
      const cars = Array.isArray(saleRes.data?.cars) ? saleRes.data.cars : [];
      const listings = Array.isArray(marketRes.data?.listings) ? marketRes.data.listings : [];
      const d = saleRes.data?.dealership || null;
      setDealerCars(cars);
      setDealership(d);
      _cachedBuyCars = { dealerCars: cars, marketplaceListings: listings, dealership: d };
      if (d?.auto_stock?.rarity) setAutoStockRarity(d.auto_stock.rarity);
      if (d?.auto_stock?.target_per_model) setAutoStockTarget(String(d.auto_stock.target_per_model));
      if (d?.stock_default_target) setStockTarget(String(d.stock_default_target));
      if (authUser?.money != null) setUserMoney(authUser.money);
      setMarketplaceListings(listings);
    } catch (_) {}
    finally { setHasLoaded(true); }
  };

  useEffect(() => {
    if (authUser?.money != null) setUserMoney(authUser.money);
  }, [authUser?.money]);

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (!dealership?.is_owner) {
      setStockEstimate(null);
      return;
    }
    const target = parseInt(String(stockTarget).replace(/\D/g, ''), 10);
    if (!stockRarity || !target || target <= 0) {
      setStockEstimate(null);
      return;
    }
    let cancelled = false;
    api.get('/gta/dealership/stock-estimate', { params: { rarity: stockRarity, target_per_model: target } })
      .then((res) => { if (!cancelled) setStockEstimate(res.data || null); })
      .catch(() => { if (!cancelled) setStockEstimate(null); });
    return () => { cancelled = true; };
  }, [dealership?.is_owner, stockRarity, stockTarget]);

  const raritySummary = useMemo(() => {
    const forSaleByRarity = {};
    marketplaceListings.forEach((l) => {
      const r = l.rarity || 'common';
      forSaleByRarity[r] = (forSaleByRarity[r] || 0) + 1;
    });
    const dealerInStockByRarity = {};
    const dealerModelsByRarity = {};
    dealerCars.forEach((c) => {
      const r = c.rarity || 'common';
      dealerModelsByRarity[r] = (dealerModelsByRarity[r] || 0) + 1;
      dealerInStockByRarity[r] = (dealerInStockByRarity[r] || 0) + (c.in_stock ?? 0);
    });
    return RARITY_ORDER.map((r) => ({
      rarity: r,
      label: RARITY_LABELS[r] || r,
      speed: TRAVEL_TIMES[r] != null ? `${TRAVEL_TIMES[r]} secs` : '—',
      forSale: forSaleByRarity[r] || 0,
      dealerInStock: dealerInStockByRarity[r] || 0,
      total: (dealerInStockByRarity[r] || 0) + (forSaleByRarity[r] || 0),
      modelCount: (dealerModelsByRarity[r] || 0) + (forSaleByRarity[r] || 0),
    })).filter((row) => row.modelCount > 0);
  }, [dealerCars, marketplaceListings]);

  const dealerOwnerLabel = dealership?.owner_username || 'Dealer';

  const allVehicles = useMemo(() => {
    const cash = userMoney != null ? Number(userMoney) : null;
    const moneyKnown = cash != null && !Number.isNaN(cash);
    const rows = [];
    dealerCars.forEach((c, i) => {
      const inStock = c.in_stock ?? 0;
      const canBuyFromApi = c.can_buy ?? false;
      const price = c.dealer_price ?? 0;
      const canAfford = !moneyKnown || cash >= price;
      rows.push({
        id: `dealer:${c.id}:${i}`,
        source: 'dealer',
        carId: c.id,
        name: c.name,
        price,
        speed: TRAVEL_TIMES[c.rarity] ?? 45,
        owner: dealerOwnerLabel,
        rarity: c.rarity || 'common',
        inStock,
        minRank: c.min_rank ?? 1,
        /** Stock + API; selection does not depend on client cash (fixes blank /auth/me or stale money blocking checkboxes). */
        canSelect: canBuyFromApi && inStock > 0,
        canAfford,
        damage_percent: 0,
      });
    });
    marketplaceListings.forEach((l) => {
      const own = !!l.is_own_listing;
      const price = l.sale_price ?? 0;
      const canAfford = !moneyKnown || cash >= price;
      rows.push({
        id: `listing:${l.user_car_id}`,
        source: 'listing',
        userCarId: l.user_car_id,
        name: l.name,
        price,
        speed: TRAVEL_TIMES[l.rarity] ?? 45,
        owner: l.seller_username ?? '?',
        rarity: l.rarity || 'common',
        isOwnListing: own,
        canSelect: !own,
        canAfford,
        damage_percent: l.damage_percent ?? 0,
      });
    });
    return rows;
  }, [dealerCars, marketplaceListings, userMoney, dealerOwnerLabel]);

  const filteredVehicles = useMemo(() => {
    let list = allVehicles;
    if (sourceFilter === 'dealer') list = list.filter((v) => v.source === 'dealer');
    else if (sourceFilter === 'listing') list = list.filter((v) => v.source === 'listing');
    if (selectedRarity) list = list.filter((v) => v.rarity === selectedRarity);
    return list;
  }, [allVehicles, selectedRarity, sourceFilter]);

  useEffect(() => {
    setSelectedIds(new Set());
    setDealerQtyByRowId({});
  }, [selectedRarity, sourceFilter]);

  const dealerQtyForRow = useCallback((row) => {
    if (!row || row.source !== 'dealer') return 1;
    const max = Math.max(1, Number(row.inStock) || 1);
    const raw = dealerQtyByRowId[row.id];
    const n = parseInt(String(raw ?? '1').replace(/\D/g, ''), 10);
    if (!n || n < 1) return 1;
    return Math.min(n, max);
  }, [dealerQtyByRowId]);

  const selectedTotal = useMemo(() => {
    let sum = 0;
    selectedIds.forEach((id) => {
      const row = allVehicles.find((v) => v.id === id);
      if (row && row.canSelect) {
        const qty = row.source === 'dealer' ? dealerQtyForRow(row) : 1;
        sum += (row.price || 0) * qty;
      }
    });
    return sum;
  }, [selectedIds, allVehicles, dealerQtyForRow]);

  const selectedUnitCount = useMemo(() => {
    let n = 0;
    selectedIds.forEach((id) => {
      const row = allVehicles.find((v) => v.id === id);
      if (row && row.canSelect) {
        n += row.source === 'dealer' ? dealerQtyForRow(row) : 1;
      }
    });
    return n;
  }, [selectedIds, allVehicles, dealerQtyForRow]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setDealerQtyByRowId((q) => (q[id] != null ? q : { ...q, [id]: '1' }));
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectable = filteredVehicles.filter((v) => v.canSelect);
    const selectableIds = selectable.map((v) => v.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
    if (!allSelected) {
      setDealerQtyByRowId((prev) => {
        const next = { ...prev };
        selectable.filter((v) => v.source === 'dealer').forEach((v) => {
          if (next[v.id] == null) next[v.id] = '1';
        });
        return next;
      });
    }
  };

  const handleBuySelected = async () => {
    const cash = userMoney != null ? Number(userMoney) : null;
    const moneyOk = cash != null && !Number.isNaN(cash);
    const toBuy = [...selectedIds].map((id) => allVehicles.find((v) => v.id === id)).filter(Boolean);
    const valid = toBuy.filter((r) => r.canSelect);
    if (valid.length === 0) {
      toast.error('Select at least one vehicle');
      return;
    }
    if (moneyOk && selectedTotal > cash) {
      toast.error(`Insufficient cash. Need $${selectedTotal.toLocaleString()}.`);
      return;
    }
    setBuying(true);
    let bought = 0;
    const dealerRows = valid.filter((r) => r.source === 'dealer');
    const listingRows = valid.filter((r) => r.source === 'listing');
    const boughtRowIds = new Set();

    if (dealerRows.length > 0) {
      try {
        const items = dealerRows.map((row) => ({
          car_id: row.carId,
          quantity: dealerQtyForRow(row),
        }));
        const res = await api.post('/gta/buy-cars-bulk', { items });
        const count = Number(res.data?.purchased_count ?? 0);
        bought += count;
        const shortfalls = res.data?.shortfalls || [];
        const shortfallByCar = Object.fromEntries(shortfalls.map((s) => [s.car_id, s]));
        dealerRows.forEach((row) => {
          const sf = shortfallByCar[row.carId];
          if (!sf || Number(sf.bought) > 0) boughtRowIds.add(row.id);
        });
        const partial = shortfalls.filter((s) => Number(s.bought) > 0 && Number(s.bought) < Number(s.requested));
        const empty = shortfalls.filter((s) => Number(s.bought) === 0);
        if (partial.length > 0) {
          toast.warning(`${partial.length} model(s) only partially filled — not charged for missing stock`);
        } else if (empty.length > 0) {
          toast.warning(`${empty.length} model(s) were out of stock`);
        }
      } catch (e) {
        const d = e.response?.data?.detail;
        const msg = typeof d === 'string' ? d : (d && typeof d === 'object' ? d.message : null);
        toast.error(msg || 'Failed to buy dealer cars');
      }
    }

    for (const row of listingRows) {
      try {
        await api.post('/gta/buy-listed-car', { user_car_id: row.userCarId });
        bought++;
        boughtRowIds.add(row.id);
      } catch (e) {
        const d = e.response?.data?.detail;
        const msg = typeof d === 'string' ? d : (d && typeof d === 'object' ? d.message : null);
        toast.error(msg || `Failed to buy ${row.name}`);
      }
    }

    if (boughtRowIds.size > 0) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        boughtRowIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    if (bought > 0) {
      toast.success(`Purchased ${bought} car(s)`);
      refreshUser();
      fetchAll();
    }
    setBuying(false);
  };

  const handleCancelListing = async (userCarId) => {
    if (!userCarId) return;
    setCancellingUserCarId(userCarId);
    try {
      await api.post('/gta/delist-car', { user_car_id: userCarId });
      toast.success('Listing cancelled');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not cancel listing');
    } finally {
      setCancellingUserCarId(null);
    }
  };

  const handleClaimDealership = async () => {
    if (dealershipSaving) return;
    setDealershipSaving(true);
    try {
      const res = await api.post('/gta/dealership/claim');
      toast.success(res?.data?.message || 'Dealership claimed');
      refreshUser();
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not claim dealership');
    } finally {
      setDealershipSaving(false);
    }
  };

  const handleCollectDealership = async () => {
    if (dealershipSaving) return;
    setDealershipSaving(true);
    try {
      const res = await api.post('/gta/dealership/collect');
      toast.success(res?.data?.message || 'Profit collected');
      refreshUser();
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not collect profit');
    } finally {
      setDealershipSaving(false);
    }
  };

  const handleRelinquishDealership = async () => {
    if (dealershipSaving) return;
    if (!window.confirm('Relinquish the car dealership? Pending profit will be paid out first.')) return;
    setDealershipSaving(true);
    try {
      const res = await api.post('/gta/dealership/relinquish');
      toast.success(res?.data?.message || 'Dealership relinquished');
      refreshUser();
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not relinquish');
    } finally {
      setDealershipSaving(false);
    }
  };

  const handleSendDealership = async () => {
    const username = (dealershipTransferUsername || '').trim();
    if (!username || dealershipSaving) return;
    setDealershipSaving(true);
    try {
      const res = await api.post('/gta/dealership/send-to-user', { target_username: username });
      toast.success(res?.data?.message || 'Dealership transferred');
      setDealershipTransferUsername('');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Transfer failed');
    } finally {
      setDealershipSaving(false);
    }
  };

  const handleListDealershipOnTrade = async () => {
    const pts = parseInt(String(dealershipSellPoints).replace(/,/g, '').replace(/\D/g, ''), 10);
    if (!pts || pts <= 0) {
      toast.error('Enter points to list on Quick Trade');
      return;
    }
    if (dealershipSaving) return;
    setDealershipSaving(true);
    try {
      const res = await api.post('/gta/dealership/sell-on-trade', { points: pts });
      toast.success(res?.data?.message || 'Listed on Quick Trade');
      setDealershipSellPoints('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not list on Quick Trade');
    } finally {
      setDealershipSaving(false);
    }
  };

  const stockableRarities = dealership?.stockable_rarities || ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary'];
  const stockFeePct = dealership?.stock_fee_rate_pct ?? 25;
  const stockMaxPerModel = dealership?.stock_max_per_model ?? 100;

  const handleStockDealership = async () => {
    const target = parseInt(String(stockTarget).replace(/\D/g, ''), 10);
    if (!stockRarity || !target || target <= 0) {
      toast.error('Choose a rarity and target stock count');
      return;
    }
    if (dealershipSaving) return;
    const fee = stockEstimate?.total_fee ?? 0;
    const units = stockEstimate?.total_units ?? 0;
    if (units <= 0) {
      toast.error('Nothing to stock at that target');
      return;
    }
    const payLabel = stockPayFrom === 'profit' ? 'pending profit' : 'cash';
    if (!window.confirm(`Stock ${units} ${stockRarity.replace(/_/g, ' ')} car${units !== 1 ? 's' : ''} for $${Number(fee).toLocaleString()} (${stockFeePct}% catalog value) from ${payLabel}?`)) return;
    setDealershipSaving(true);
    try {
      const res = await api.post('/gta/dealership/stock', {
        rarity: stockRarity,
        target_per_model: target,
        pay_from: stockPayFrom,
      });
      toast.success(res?.data?.message || 'Stocked');
      refreshUser();
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not stock dealership');
    } finally {
      setDealershipSaving(false);
    }
  };

  const handleAutoStockDealership = async (enabled) => {
    if (dealershipSaving) return;
    const target = parseInt(String(autoStockTarget).replace(/\D/g, ''), 10);
    if (enabled && (!autoStockRarity || !target || target <= 0)) {
      toast.error('Choose a rarity and target for auto-stock');
      return;
    }
    setDealershipSaving(true);
    try {
      const res = await api.post('/gta/dealership/auto-stock', {
        enabled,
        rarity: enabled ? autoStockRarity : null,
        target_per_model: enabled ? target : undefined,
      });
      toast.success(res?.data?.message || (enabled ? 'Auto-stock enabled' : 'Auto-stock disabled'));
      refreshUser();
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not update auto-stock');
    } finally {
      setDealershipSaving(false);
    }
  };

  if (!hasLoaded) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <style>{BUY_STYLES}</style>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
      <style>{BUY_STYLES + (animateIn ? BUY_FADE_STYLES : '')}</style>

      <div className="relative bc-fade-in flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] text-zinc-500 font-heading italic">
            Dealer and player listings. Dealership owner earns {dealership?.dealer_owner_profit_share_pct ?? 25}% of dealer-sale profit and {dealership?.player_sale_owner_profit_share_pct ?? 10}% of player listing profit.
          </p>
        </div>
        <Link
          to="/cars/garage"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-primary/30 text-primary font-heading text-[11px] font-bold hover:bg-primary/10"
        >
          <Car size={12} />
          Garage
        </Link>
      </div>

      {dealership && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bc-fade-in mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Car dealership</span>
          </div>
          <div className="p-3 space-y-2 text-[10px] font-heading">
            {dealership.is_owner ? (
              <>
                <p className="text-mutedForeground">
                  You own the dealership. Collect profit from dealer sales ({dealership.dealer_owner_profit_share_pct}% of markup) and player listings ({dealership.player_sale_owner_profit_share_pct}% of markup). The lot also gets a free baseline restock every 1–4 hours (up to 5 per model).
                </p>
                <p>
                  <span className="text-mutedForeground">Pending profit: </span>
                  <span className="text-emerald-400 font-bold">${Number(dealership.owner_pending_profit || 0).toLocaleString()}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={dealershipSaving} onClick={handleCollectDealership} className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-primary font-bold disabled:opacity-50">Collect</button>
                  <button type="button" disabled={dealershipSaving} onClick={handleRelinquishDealership} className="px-2 py-1 rounded border border-rose-500/40 text-rose-400 font-bold disabled:opacity-50">Relinquish</button>
                </div>
                <div className="pt-2 border-t border-border/50 space-y-2">
                  <p className="text-[9px] uppercase tracking-wider text-mutedForeground font-bold">Owner stocking · {stockFeePct}% of catalog value per car</p>
                  <p className="text-[9px] text-mutedForeground">
                    Fill each model of a rarity up to {stockMaxPerModel} units. Fee is {stockFeePct}% of catalog value × cars added (not dealer sale price).
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[8px] uppercase tracking-wider text-mutedForeground">Rarity</span>
                      <select value={stockRarity} onChange={(e) => setStockRarity(e.target.value)} className="rounded border border-primary/30 bg-background/80 px-2 py-1 text-[10px]">
                        {stockableRarities.map((r) => (
                          <option key={r} value={r}>{RARITY_LABELS[r] || r.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5 min-w-[5rem]">
                      <span className="text-[8px] uppercase tracking-wider text-mutedForeground">Target / model</span>
                      <input value={stockTarget} onChange={(e) => setStockTarget(e.target.value)} className="rounded border border-primary/30 bg-background/80 px-2 py-1 text-[10px]" placeholder="100" />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[8px] uppercase tracking-wider text-mutedForeground">Pay from</span>
                      <select value={stockPayFrom} onChange={(e) => setStockPayFrom(e.target.value)} className="rounded border border-primary/30 bg-background/80 px-2 py-1 text-[10px]">
                        <option value="cash">Cash</option>
                        <option value="profit">Pending profit</option>
                      </select>
                    </label>
                    <button type="button" disabled={dealershipSaving || !(stockEstimate?.total_units > 0)} onClick={handleStockDealership} className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-bold disabled:opacity-50">
                      Stock now
                    </button>
                  </div>
                  {stockEstimate?.total_units > 0 ? (
                    <p className="text-[9px] text-mutedForeground">
                      Adds <span className="text-foreground font-bold">{stockEstimate.total_units}</span> car{stockEstimate.total_units !== 1 ? 's' : ''} · fee <span className="text-emerald-400 font-bold">${Number(stockEstimate.total_fee || 0).toLocaleString()}</span>
                    </p>
                  ) : (
                    <p className="text-[9px] text-mutedForeground">At target {stockTarget || '—'} per model, nothing more to add for this rarity.</p>
                  )}
                  <div className="flex flex-wrap items-end gap-2 pt-1">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[8px] uppercase tracking-wider text-mutedForeground">Auto-stock rarity</span>
                      <select value={autoStockRarity} onChange={(e) => setAutoStockRarity(e.target.value)} className="rounded border border-primary/30 bg-background/80 px-2 py-1 text-[10px]" disabled={!!dealership.auto_stock?.enabled}>
                        {stockableRarities.map((r) => (
                          <option key={r} value={r}>{RARITY_LABELS[r] || r.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5 min-w-[5rem]">
                      <span className="text-[8px] uppercase tracking-wider text-mutedForeground">Auto target</span>
                      <input value={autoStockTarget} onChange={(e) => setAutoStockTarget(e.target.value)} className="rounded border border-primary/30 bg-background/80 px-2 py-1 text-[10px]" disabled={!!dealership.auto_stock?.enabled} />
                    </label>
                    {dealership.auto_stock?.enabled ? (
                      <button type="button" disabled={dealershipSaving} onClick={() => handleAutoStockDealership(false)} className="px-2 py-1 rounded border border-amber-500/40 text-amber-400 font-bold disabled:opacity-50">
                        Disable auto
                      </button>
                    ) : (
                      <button type="button" disabled={dealershipSaving} onClick={() => handleAutoStockDealership(true)} className="px-2 py-1 rounded border border-primary/40 text-primary font-bold disabled:opacity-50">
                        Enable auto
                      </button>
                    )}
                  </div>
                  {dealership.auto_stock?.enabled ? (
                    <p className="text-[9px] text-primary">
                      Auto-stock on: {RARITY_LABELS[dealership.auto_stock.rarity] || dealership.auto_stock.rarity} → {dealership.auto_stock.target_per_model}/model.
                      Spends pending profit in small batches (every sale + every 5 min), not all at once.
                    </p>
                  ) : (
                    <p className="text-[9px] text-mutedForeground">
                      Auto-stock tops up your chosen rarity from pending profit as sales come in (partial fills; no need to pay the full target upfront).
                    </p>
                  )}
                </div>
                {dealership.transfer_locked_war ? (
                  <p className="text-amber-400/90 text-[9px]">
                    Family war active — you cannot send or list the dealership until the war ends.
                  </p>
                ) : null}
                {dealership.stack_conflict?.seconds_remaining != null ? (
                  <p className="text-amber-400/90 text-[9px]">
                    You hold an airport or armoury — send the dealership to another player within{' '}
                    {Math.max(1, Math.ceil((dealership.stack_conflict.seconds_remaining || 0) / 60))} min or it auto-drops.
                  </p>
                ) : null}
                {!dealership.transfer_locked_war ? (
                  <>
                <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-border/50">
                  <label className="flex flex-col gap-0.5 min-w-[8rem] flex-1">
                    <span className="text-[8px] uppercase tracking-wider text-mutedForeground">Send to player</span>
                    <input value={dealershipTransferUsername} onChange={(e) => setDealershipTransferUsername(e.target.value)} className="rounded border border-primary/30 bg-background/80 px-2 py-1 text-[10px]" placeholder="Username" />
                  </label>
                  <button type="button" disabled={dealershipSaving || !dealershipTransferUsername.trim()} onClick={handleSendDealership} className="px-2 py-1 rounded border border-primary/40 text-primary font-bold disabled:opacity-50">Send</button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-0.5 min-w-[8rem] flex-1">
                    <span className="text-[8px] uppercase tracking-wider text-mutedForeground">Quick Trade (points)</span>
                    <input value={dealershipSellPoints} onChange={(e) => setDealershipSellPoints(e.target.value)} className="rounded border border-primary/30 bg-background/80 px-2 py-1 text-[10px]" placeholder="Points price" />
                  </label>
                  <button type="button" disabled={dealershipSaving} onClick={handleListDealershipOnTrade} className="px-2 py-1 rounded border border-primary/40 text-primary font-bold disabled:opacity-50">List on QT</button>
                </div>
                  </>
                ) : null}
              </>
            ) : dealership.owner_username ? (
              <p className="text-mutedForeground">
                Owned by <span className="text-foreground font-bold">{dealership.owner_username}</span>.
              </p>
            ) : (
              <>
                <p className="text-mutedForeground">
                  Unclaimed — claim for {(dealership.claim_cost_points || 10000).toLocaleString()} points to earn from dealer and player car sales.
                </p>
                {dealership.claim_blocked ? (
                  <p className="text-[9px] text-amber-400">{dealership.claim_blocked}</p>
                ) : (
                <button type="button" disabled={dealershipSaving} onClick={handleClaimDealership} className="px-3 py-1.5 rounded border border-primary/50 bg-primary/15 text-primary font-bold disabled:opacity-50">
                  Claim dealership · {(dealership.claim_cost_points || 10000).toLocaleString()} pts
                </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bc-fade-in mobile-panel`} style={{ animationDelay: '0.03s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        {/* Compact rarity row: click to filter */}
        <div className="px-2.5 sm:px-3 py-2 bg-primary/8 border-b border-primary/20 flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-1">
          <span className="text-[9px] font-heading text-mutedForeground uppercase tracking-[0.12em]">Source:</span>
          {['all', 'dealer', 'listing'].map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => setSourceFilter(src)}
              className={`text-[11px] font-heading font-bold py-0.5 px-1 rounded transition-colors ${
                sourceFilter === src
                  ? 'bg-primary/20 text-primary border border-primary/50'
                  : 'border border-transparent hover:bg-secondary/50 text-mutedForeground hover:text-foreground'
              }`}
            >
              {src === 'all' ? 'All' : src === 'dealer' ? 'Dealer only' : 'Players only'}
            </button>
          ))}
          <span className="text-[9px] font-heading text-mutedForeground uppercase tracking-[0.12em] ml-1">By rarity:</span>
          {raritySummary.length === 0 ? (
            <span className="text-[10px] text-mutedForeground">None</span>
          ) : (
            raritySummary.map((row) => (
              <button
                key={row.rarity}
                type="button"
                onClick={() => setSelectedRarity(selectedRarity === row.rarity ? null : row.rarity)}
                className={`text-[11px] font-heading font-bold py-0.5 px-1 rounded transition-colors ${
                  selectedRarity === row.rarity
                    ? 'bg-primary/20 text-primary border border-primary/50'
                    : `border border-transparent hover:bg-secondary/50 ${RARITY_COLOR[row.rarity] || 'text-foreground'}`
                }`}
              >
                {row.label} ({row.total})
              </button>
            ))
          )}
          {selectedRarity && (
            <button
              type="button"
              onClick={() => setSelectedRarity(null)}
              className="text-[10px] font-heading text-mutedForeground hover:text-primary"
            >
              Show all
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className={`${styles.surface} text-[9px] uppercase tracking-wider font-heading text-primary/80 border-b border-border`}>
                <th className="w-8 py-1 pl-1.5 pr-0">
                  <button type="button" onClick={toggleSelectAll} className="min-h-[28px] min-w-[28px] inline-flex items-center justify-center rounded hover:bg-primary/10" title="Check all">
                    {filteredVehicles.filter((v) => v.canSelect).length > 0 &&
                    filteredVehicles.filter((v) => v.canSelect).every((v) => selectedIds.has(v.id)) ? (
                      <CheckSquare size={12} className="text-primary" />
                    ) : (
                      <Square size={12} className="text-mutedForeground" />
                    )}
                  </button>
                </th>
                <th className="text-left py-1 px-2">Car</th>
                <th className="text-right py-1 px-2 w-14">Qty</th>
                <th className="text-right py-1 px-2">Price</th>
                <th className="text-right py-1 px-2">Stock</th>
                <th className="text-right py-1 px-2">Damage</th>
                <th className="text-right py-1 px-2">Speed</th>
                <th className="text-right py-1 px-2">Owner / action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredVehicles.map((row) => (
                <tr
                  key={row.id}
                  className={`bc-row transition-colors ${
                    !row.canSelect && !row.isOwnListing ? 'opacity-60' : ''
                  } ${row.canSelect && !row.canAfford ? 'bg-amber-500/[0.04]' : ''}`}
                >
                  <td className="py-1 pl-1.5 pr-0 align-middle">
                    {row.source === 'dealer' && (row.inStock ?? 0) > 0 ? (
                      row.canSelect ? (
                        <VehicleSelectCheckbox
                          selected={selectedIds.has(row.id)}
                          canAfford={row.canAfford}
                          onToggle={() => toggleSelect(row.id)}
                        />
                      ) : (
                        <span className="inline-flex items-center justify-center min-w-[28px] min-h-[28px] text-mutedForeground/40" title="Unavailable">
                          —
                        </span>
                      )
                    ) : row.source === 'listing' ? (
                      row.isOwnListing ? (
                        <span className="inline-block min-w-[28px] min-h-[28px]" title="Your listing — cancel in Owner column or Sell Cars" />
                      ) : (
                        <VehicleSelectCheckbox
                          selected={selectedIds.has(row.id)}
                          canAfford={row.canAfford}
                          onToggle={() => toggleSelect(row.id)}
                        />
                      )
                    ) : (
                      <span className="inline-block min-w-[28px] min-h-[28px]" />
                    )}
                  </td>
                  <td className="py-1 px-2">
                    <span className={`font-heading font-bold ${RARITY_COLOR[row.rarity] || 'text-foreground'}`}>
                      {RARITY_LABELS[row.rarity] || row.rarity}:
                    </span>{' '}
                    {row.source === 'listing' && row.userCarId ? (
                      <Link to={`/view-car?id=${encodeURIComponent(row.userCarId)}`} className="font-heading text-foreground hover:text-primary transition-colors">
                        {row.name}
                      </Link>
                    ) : (
                      <span className="font-heading text-foreground">{row.name}</span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right font-heading">
                    {row.source === 'dealer' && (row.inStock ?? 0) > 0 ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        value={dealerQtyByRowId[row.id] ?? '1'}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d]/g, '');
                          setDealerQtyByRowId((prev) => ({ ...prev, [row.id]: v }));
                          if (v && !selectedIds.has(row.id)) {
                            setSelectedIds((prev) => new Set(prev).add(row.id));
                          }
                        }}
                        onBlur={() => {
                          const max = Math.max(1, Number(row.inStock) || 1);
                          const n = dealerQtyForRow(row);
                          setDealerQtyByRowId((prev) => ({ ...prev, [row.id]: String(n) }));
                        }}
                        className="w-12 rounded border border-primary/30 bg-background/80 px-1 py-0.5 text-[10px] text-right"
                        title={`Max ${row.inStock}`}
                        aria-label={`Quantity for ${row.name}`}
                      />
                    ) : (
                      <span className="text-mutedForeground">—</span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right font-heading font-bold text-emerald-400">
                    ${(row.price || 0).toLocaleString()}
                  </td>
                  <td className="py-1 px-2 text-right font-heading">
                    {row.source === 'dealer' ? (
                      (row.inStock ?? 0) > 0 ? (
                        <span className="text-emerald-400">In stock ({row.inStock})</span>
                      ) : (
                        <span className="text-amber-500/90">Out of stock</span>
                      )
                    ) : (
                      <span className="text-mutedForeground">—</span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right text-mutedForeground font-heading">
                    {row.source === 'dealer' ? '—' : `${row.damage_percent ?? 0}%`}
                  </td>
                  <td className="py-1 px-2 text-right text-mutedForeground font-heading">{row.speed} secs</td>
                  <td className="py-1 px-2 text-right font-heading">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-foreground">{row.owner}</span>
                      {row.isOwnListing && row.userCarId ? (
                        <button
                          type="button"
                          disabled={cancellingUserCarId === row.userCarId}
                          onClick={() => handleCancelListing(row.userCarId)}
                          className="text-[9px] font-heading font-bold uppercase text-rose-400/90 hover:text-rose-300 border border-rose-500/40 rounded px-1 py-0.5 disabled:opacity-50"
                        >
                          {cancellingUserCarId === row.userCarId ? '…' : 'Cancel listing'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredVehicles.length === 0 && (
          <p className="py-2 text-center text-[11px] text-mutedForeground font-heading">
            {selectedRarity ? `No vehicles in ${RARITY_LABELS[selectedRarity]}.` : 'No vehicles for sale.'}
          </p>
        )}

        <div className="px-2.5 sm:px-3 py-2 bg-primary/8 border-t border-primary/20 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-[9px] font-heading font-bold uppercase tracking-wide text-mutedForeground hover:text-primary border border-transparent hover:border-primary/30 rounded px-1.5 py-0.5"
            >
              Check all
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || buying}
              onClick={handleBuySelected}
              className={`px-3 py-1 rounded font-heading font-bold uppercase text-[11px] border ${
                selectedIds.size > 0 && !buying
                  ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30'
                  : 'bg-secondary/50 text-mutedForeground border-border cursor-not-allowed'
              }`}
            >
              Buy — ${selectedTotal.toLocaleString()}
              {selectedUnitCount > 1 ? ` (${selectedUnitCount} cars)` : ''}
            </button>
          </div>
        </div>
        <div className="bc-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
