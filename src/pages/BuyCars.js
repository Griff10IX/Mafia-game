import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Car, CheckSquare, Square } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// Rarities and travel times – must match backend GTA (server CARS + gta.py TRAVEL_TIMES)
const GTA_RARITIES = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary', 'custom', 'exclusive'];
const RARITY_ORDER = [...GTA_RARITIES].reverse();

const TRAVEL_TIMES = {
  exclusive: 7,
  legendary: 12,
  ultra_rare: 18,
  rare: 25,
  uncommon: 35,
  common: 45,
  custom: 20,
};

const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rares',
  ultra_rare: 'Ultra Rare',
  legendary: 'Legendary',
  custom: 'Customs',
  exclusive: 'Exclusives',
};
const RARITY_COLOR = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  ultra_rare: 'text-purple-400',
  legendary: 'text-yellow-400',
  custom: 'text-orange-400',
  exclusive: 'text-red-400',
};

const PAGE_SIZE = 15;

export default function BuyCars() {
  const [cars, setCars] = useState([]);
  const [dealerCars, setDealerCars] = useState([]);
  const [marketplaceListings, setMarketplaceListings] = useState([]);
  const [userMoney, setUserMoney] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedRarity, setSelectedRarity] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [buying, setBuying] = useState(false);
  const [page, setPage] = useState(0);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [garageRes, saleRes, meRes, marketRes] = await Promise.all([
        api.get('/gta/garage').catch(() => ({ data: { cars: [] } })),
        api.get('/gta/cars-for-sale').catch(() => ({ data: { cars: [] } })),
        api.get('/auth/me').catch(() => ({ data: {} })),
        api.get('/gta/marketplace').catch(() => ({ data: { listings: [] } })),
      ]);
      setCars(Array.isArray(garageRes.data?.cars) ? garageRes.data.cars : []);
      setDealerCars(Array.isArray(saleRes.data?.cars) ? saleRes.data.cars : []);
      setUserMoney(meRes.data?.money ?? null);
      setMarketplaceListings(Array.isArray(marketRes.data?.listings) ? marketRes.data.listings : []);
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const raritySummary = useMemo(() => {
    const forSaleByRarity = {};
    marketplaceListings.forEach((l) => {
      const r = l.rarity || 'common';
      forSaleByRarity[r] = (forSaleByRarity[r] || 0) + 1;
    });
    const dealerModelsByRarity = {};
    dealerCars.forEach((c) => {
      const r = c.rarity || 'common';
      dealerModelsByRarity[r] = (dealerModelsByRarity[r] || 0) + 1;
    });
    return RARITY_ORDER.map((r) => ({
      rarity: r,
      label: RARITY_LABELS[r] || r,
      speed: TRAVEL_TIMES[r] != null ? `${TRAVEL_TIMES[r]} secs` : '—',
      forSale: forSaleByRarity[r] || 0,
      total: (dealerModelsByRarity[r] || 0) + (forSaleByRarity[r] || 0),
    })).filter((row) => row.total > 0 || row.forSale > 0);
  }, [dealerCars, marketplaceListings]);

  const allVehicles = useMemo(() => {
    const rows = [];
    dealerCars.forEach((c) => {
      rows.push({
        id: `dealer:${c.id}`,
        source: 'dealer',
        carId: c.id,
        name: c.name,
        price: c.dealer_price ?? 0,
        speed: TRAVEL_TIMES[c.rarity] ?? 45,
        owner: 'Dealer',
        rarity: c.rarity || 'common',
        canBuy: c.can_buy && (userMoney ?? 0) >= (c.dealer_price ?? 0),
      });
    });
    marketplaceListings.forEach((l) => {
      rows.push({
        id: `listing:${l.user_car_id}`,
        source: 'listing',
        userCarId: l.user_car_id,
        name: l.name,
        price: l.sale_price ?? 0,
        speed: TRAVEL_TIMES[l.rarity] ?? 45,
        owner: l.seller_username ?? '?',
        rarity: l.rarity || 'common',
        canBuy: (userMoney ?? 0) >= (l.sale_price ?? 0),
      });
    });
    return rows;
  }, [dealerCars, marketplaceListings, userMoney]);

  const filteredVehicles = useMemo(() => {
    if (!selectedRarity) return allVehicles;
    return allVehicles.filter((v) => v.rarity === selectedRarity);
  }, [allVehicles, selectedRarity]);

  const totalPages = Math.max(1, Math.ceil(filteredVehicles.length / PAGE_SIZE));
  const paginatedVehicles = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredVehicles.slice(start, start + PAGE_SIZE);
  }, [filteredVehicles, page]);

  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [selectedRarity]);

  const selectedTotal = useMemo(() => {
    let sum = 0;
    selectedIds.forEach((id) => {
      const row = allVehicles.find((v) => v.id === id);
      if (row && row.canBuy) sum += row.price;
    });
    return sum;
  }, [selectedIds, allVehicles]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const canSelect = paginatedVehicles.filter((v) => v.canBuy).map((v) => v.id);
    const allSelected = canSelect.length > 0 && canSelect.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) canSelect.forEach((id) => next.delete(id));
      else canSelect.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleBuySelected = async () => {
    const toBuy = [...selectedIds].map((id) => allVehicles.find((v) => v.id === id)).filter(Boolean);
    const valid = toBuy.filter((r) => r.canBuy);
    if (valid.length === 0) {
      toast.error('Select at least one car you can afford');
      return;
    }
    setBuying(true);
    let bought = 0;
    for (const row of valid) {
      try {
        if (row.source === 'dealer') {
          await api.post('/gta/buy-car', { car_id: row.carId });
        } else {
          await api.post('/gta/buy-listed-car', { user_car_id: row.userCarId });
        }
        bought++;
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      } catch (e) {
        toast.error(e.response?.data?.detail || `Failed to buy ${row.name}`);
      }
    }
    if (bought > 0) {
      toast.success(`Purchased ${bought} car(s)`);
      refreshUser();
      fetchAll();
    }
    setBuying(false);
  };

  if (loading) {
    return (
      <div className={styles.pageContent}>
        <div className="font-heading text-primary text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${styles.pageContent}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wide">Buy Cars</h1>
        <Link
          to="/garage"
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/30 text-primary font-heading text-[11px] font-bold hover:bg-primary/10"
        >
          <Car size={12} />
          Garage
        </Link>
      </div>

      <p className="text-[10px] text-mutedForeground font-heading">
        Dealer stock replenishes in 1–2 hours. Dealer prices are inflated; check marketplace for player listings.
      </p>

      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        {/* Compact rarity row: click to filter */}
        <div className={`px-3 py-1 ${styles.panelHeader} border-b border-primary/20 flex flex-wrap items-center gap-x-3 gap-y-1`}>
          <span className="text-[10px] font-heading text-mutedForeground uppercase">By rarity:</span>
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
              <tr className={`${styles.surface} text-[10px] uppercase tracking-wider font-heading text-primary/80 border-b border-border`}>
                <th className="w-7 py-1 pl-1.5 pr-0">
                  <button type="button" onClick={toggleSelectAll} className="p-0.5 rounded hover:bg-primary/10" title="Check all">
                    {paginatedVehicles.filter((v) => v.canBuy).length > 0 &&
                    paginatedVehicles.filter((v) => v.canBuy).every((v) => selectedIds.has(v.id)) ? (
                      <CheckSquare size={12} className="text-primary" />
                    ) : (
                      <Square size={12} className="text-mutedForeground" />
                    )}
                  </button>
                </th>
                <th className="text-left py-1 px-2">Car</th>
                <th className="text-right py-1 px-2">Price</th>
                <th className="text-right py-1 px-2">Speed</th>
                <th className="text-right py-1 px-2">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedVehicles.map((row) => (
                <tr key={row.id} className={`hover:bg-secondary/30 transition-colors ${!row.canBuy ? 'opacity-60' : ''}`}>
                  <td className="py-1 pl-1.5 pr-0">
                    {row.canBuy ? (
                      <button type="button" onClick={() => toggleSelect(row.id)} className="p-0.5 rounded hover:bg-primary/10">
                        {selectedIds.has(row.id) ? (
                          <CheckSquare size={12} className="text-primary" />
                        ) : (
                          <Square size={12} className="text-mutedForeground" />
                        )}
                      </button>
                    ) : (
                      <span className="inline-block w-4" />
                    )}
                  </td>
                  <td className="py-1 px-2">
                    <span className={`font-heading font-bold ${RARITY_COLOR[row.rarity] || 'text-foreground'}`}>
                      {RARITY_LABELS[row.rarity] || row.rarity}:
                    </span>{' '}
                    <span className="font-heading text-foreground">{row.name}</span>
                  </td>
                  <td className="py-1 px-2 text-right font-heading font-bold text-emerald-400">
                    ${(row.price || 0).toLocaleString()}
                  </td>
                  <td className="py-1 px-2 text-right text-mutedForeground font-heading">{row.speed} secs</td>
                  <td className="py-1 px-2 text-right font-heading text-foreground">{row.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {paginatedVehicles.length === 0 && (
          <p className="py-2 text-center text-[11px] text-mutedForeground font-heading">
            {selectedRarity ? `No vehicles in ${RARITY_LABELS[selectedRarity]}.` : 'No vehicles for sale.'}
          </p>
        )}

        <div className={`px-3 py-1.5 ${styles.panelHeader} border-t border-primary/20 flex flex-wrap items-center justify-between gap-2`}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-mutedForeground font-heading uppercase">Check all</span>
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
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="p-1 rounded border border-border text-mutedForeground hover:text-foreground hover:border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed font-heading text-[11px]"
            >
              Prev
            </button>
            <span className="text-[10px] font-heading text-mutedForeground px-1.5">{page + 1}/{totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="p-1 rounded border border-border text-mutedForeground hover:text-foreground hover:border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed font-heading text-[11px]"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
