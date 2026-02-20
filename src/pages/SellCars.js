import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, Square, DollarSign, Car } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../components/FormattedNumberInput';
import styles from '../styles/noir.module.css';

const SELL_STYLES = `
  @keyframes sc-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .sc-fade-in { animation: sc-fade-in 0.4s ease-out both; }
  .sc-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .sc-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

// GTA rarities (match backend and BuyCars)
const GTA_RARITIES = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary', 'custom', 'exclusive'];
const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
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
const TRAVEL_TIMES = {
  exclusive: 7,
  legendary: 12,
  ultra_rare: 18,
  rare: 25,
  uncommon: 35,
  common: 45,
  custom: 20,
};

const PAGE_SIZE = 15;

export default function SellCars() {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRarity, setSelectedRarity] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [listPrice, setListPrice] = useState('');
  const [selling, setSelling] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [page, setPage] = useState(0);

  const fetchCars = async () => {
    setLoading(true);
    try {
      const res = await api.get('/gta/garage').catch(() => ({ data: { cars: [] } }));
      setCars(Array.isArray(res.data?.cars) ? res.data.cars : []);
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCars();
  }, []);

  const raritySummary = useMemo(() => {
    const counts = {};
    cars.forEach((c) => {
      const r = c.rarity || 'common';
      counts[r] = (counts[r] || 0) + 1;
    });
    return GTA_RARITIES.filter((r) => (counts[r] || 0) > 0).map((r) => ({
      rarity: r,
      label: RARITY_LABELS[r] || r,
      count: counts[r] || 0,
    }));
  }, [cars]);

  const filteredCars = useMemo(() => {
    if (!selectedRarity) return cars;
    return cars.filter((c) => (c.rarity || 'common') === selectedRarity);
  }, [cars, selectedRarity]);

  const totalPages = Math.max(1, Math.ceil(filteredCars.length / PAGE_SIZE));
  const paginatedCars = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredCars.slice(start, start + PAGE_SIZE);
  }, [filteredCars, page]);

  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [selectedRarity]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const ids = paginatedCars.map((c) => c.user_car_id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleSell = async () => {
    const price = Math.floor(Number(String(listPrice).replace(/\D/g, '')) || 0);
    if (price < 1) {
      toast.error('Enter a price to list at');
      return;
    }
    const toList = [...selectedIds];
    if (toList.length === 0) {
      toast.error('Select at least one car');
      return;
    }
    setSelling(true);
    let listed = 0;
    for (const userCarId of toList) {
      const car = cars.find((c) => c.user_car_id === userCarId);
      if (car?.listed_for_sale) continue;
      if (car?.car_id === 'car_custom') continue;
      try {
        await api.post('/gta/list-car', { user_car_id: userCarId, price });
        listed++;
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(userCarId);
          return next;
        });
      } catch (e) {
        toast.error(e.response?.data?.detail || `Failed to list ${car?.name || 'car'}`);
      }
    }
    if (listed > 0) {
      toast.success(`Listed ${listed} car(s) for $${price.toLocaleString()}`);
      refreshUser();
      fetchCars();
    }
    setSelling(false);
  };

  const handleStopSelling = async () => {
    const toDelist = [...selectedIds];
    if (toDelist.length === 0) {
      toast.error('Select at least one listed car');
      return;
    }
    setStopping(true);
    let delisted = 0;
    for (const userCarId of toDelist) {
      const car = cars.find((c) => c.user_car_id === userCarId);
      if (!car?.listed_for_sale) continue;
      try {
        await api.post('/gta/delist-car', { user_car_id: userCarId });
        delisted++;
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(userCarId);
          return next;
        });
      } catch (e) {
        toast.error(e.response?.data?.detail || `Failed to delist ${car?.name || 'car'}`);
      }
    }
    if (delisted > 0) {
      toast.success(`Delisted ${delisted} car(s)`);
      refreshUser();
      fetchCars();
    }
    setStopping(false);
  };

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <style>{SELL_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <DollarSign size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <style>{SELL_STYLES}</style>

      <div className="relative sc-fade-in flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">List for Sale</p>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-2">Sell Cars</h1>
          <p className="text-[10px] text-zinc-500 font-heading italic mt-1">List cars from your garage. Select cars and set a price.</p>
        </div>
        <Link
          to="/garage"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-primary/30 text-primary font-heading text-[11px] font-bold hover:bg-primary/10"
        >
          <Car size={12} />
          Garage
        </Link>
      </div>

      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 sc-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        {/* By rarity: pill buttons (same as Buy Cars) */}
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] font-heading text-mutedForeground uppercase">By rarity:</span>
          {raritySummary.length === 0 ? (
            <span className="text-[10px] text-mutedForeground">No cars</span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSelectedRarity(null)}
                className={`text-[11px] font-heading font-bold py-0.5 px-1 rounded transition-colors ${
                  selectedRarity === null
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
                  onClick={() => setSelectedRarity(selectedRarity === row.rarity ? null : row.rarity)}
                  className={`text-[11px] font-heading font-bold py-0.5 px-1 rounded transition-colors ${
                    selectedRarity === row.rarity
                      ? 'bg-primary/20 text-primary border border-primary/50'
                      : `border border-transparent hover:bg-secondary/50 ${RARITY_COLOR[row.rarity] || 'text-foreground'}`
                  }`}
                >
                  {row.label} ({row.count})
                </button>
              ))}
              {selectedRarity && (
                <button
                  type="button"
                  onClick={() => setSelectedRarity(null)}
                  className="text-[10px] font-heading text-mutedForeground hover:text-primary"
                >
                  Show all
                </button>
              )}
            </>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className={`${styles.surface} text-[10px] uppercase tracking-wider font-heading text-primary/80 border-b border-border`}>
                <th className="w-7 py-1 pl-1.5 pr-0">
                  <button type="button" onClick={toggleSelectAll} className="p-0.5 rounded hover:bg-primary/10" title="Check all">
                    {paginatedCars.filter((c) => c.car_id !== 'car_custom').length > 0 &&
                    paginatedCars.filter((c) => c.car_id !== 'car_custom').every((c) => selectedIds.has(c.user_car_id)) ? (
                      <CheckSquare size={12} className="text-primary" />
                    ) : (
                      <Square size={12} className="text-mutedForeground" />
                    )}
                  </button>
                </th>
                <th className="text-left py-1 px-2">Car</th>
                <th className="text-right py-1 px-2">Price</th>
                <th className="text-right py-1 px-2">Damage</th>
                <th className="text-right py-1 px-2">Speed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedCars.map((car) => {
                const speed = TRAVEL_TIMES[car.rarity] ?? 45;
                const isListed = !!car.listed_for_sale;
                const rarity = car.rarity || 'common';
                return (
                  <tr key={car.user_car_id} className="sc-row transition-colors">
                    <td className="py-1 pl-1.5 pr-0">
                      {car.car_id !== 'car_custom' ? (
                        <button
                          type="button"
                          onClick={() => toggleSelect(car.user_car_id)}
                          className="p-0.5 rounded hover:bg-primary/10"
                        >
                          {selectedIds.has(car.user_car_id) ? (
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
                      <span className={`font-heading font-bold ${RARITY_COLOR[rarity] || 'text-foreground'}`}>
                        {RARITY_LABELS[rarity] || rarity}:
                      </span>{' '}
                      <Link to={`/view-car?id=${encodeURIComponent(car.user_car_id)}`} className="font-heading text-foreground hover:text-primary transition-colors">
                        {car.name}
                      </Link>
                    </td>
                    <td className="py-1 px-2 text-right font-heading font-bold text-emerald-400">
                      {isListed ? `$${(car.sale_price ?? 0).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-1 px-2 text-right text-mutedForeground font-heading">
                      {car.damage_percent != null ? `${car.damage_percent}%` : '—'}
                    </td>
                    <td className="py-1 px-2 text-right text-mutedForeground font-heading">{speed} secs</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paginatedCars.length === 0 && (
          <p className="py-2 text-center text-[11px] text-mutedForeground font-heading">
            {selectedRarity ? `No cars in ${RARITY_LABELS[selectedRarity]}.` : 'No cars to sell.'}
          </p>
        )}

        <div className="px-3 py-2.5 bg-primary/8 border-t border-primary/20 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-mutedForeground font-heading uppercase">Check all</span>
            <FormattedNumberInput
              value={listPrice}
              onChange={setListPrice}
              placeholder="Price..."
              className="w-20 bg-input border border-border rounded px-1.5 py-1 text-[11px] font-heading text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
            />
            <button
              type="button"
              disabled={selectedIds.size === 0 || selling}
              onClick={handleSell}
              className={`px-3 py-1 rounded font-heading font-bold uppercase text-[11px] border ${
                selectedIds.size > 0 && !selling
                  ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30'
                  : 'bg-secondary/50 text-mutedForeground border-border cursor-not-allowed'
              }`}
            >
              Sell
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || stopping}
              onClick={handleStopSelling}
              className="px-2 py-1 rounded bg-secondary border border-border text-foreground font-heading font-bold uppercase text-[11px] hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Stop Selling
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
        <div className="sc-art-line text-primary mx-3" />
      </div>

      <p className="text-[10px] text-mutedForeground font-heading sc-fade-in" style={{ animationDelay: '0.05s' }}>
        <Link to="/buy-cars" className="text-primary font-bold hover:underline">Buy cars</Link> from dealer or other players.
      </p>
    </div>
  );
}
