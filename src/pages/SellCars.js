import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, Square, ChevronDown } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// GTA rarities (match backend)
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
  const [filterRarity, setFilterRarity] = useState('all');
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

  const filteredCars = useMemo(() => {
    if (filterRarity === 'all') return cars;
    return cars.filter((c) => (c.rarity || 'common') === filterRarity);
  }, [cars, filterRarity]);

  const totalPages = Math.max(1, Math.ceil(filteredCars.length / PAGE_SIZE));
  const paginatedCars = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredCars.slice(start, start + PAGE_SIZE);
  }, [filteredCars, page]);

  useEffect(() => {
    setPage(0);
  }, [filterRarity]);

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
      <div className={styles.pageContent}>
        <div className="font-heading text-primary text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      {/* Title */}
      <div className={`${styles.panel} rounded-md border border-primary/20`}>
        <div className="px-4 py-3 text-center border-b border-primary/20">
          <h1 className="text-lg font-heading font-bold text-primary uppercase tracking-wide">Sell Cars</h1>
        </div>
      </div>

      {/* Filter + Prev/Next */}
      <div className={`${styles.panel} rounded-md border border-primary/20 px-3 py-2 flex flex-wrap items-center justify-between gap-2`}>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-heading text-mutedForeground uppercase tracking-wider">Filter:</label>
          <select
            value={filterRarity}
            onChange={(e) => setFilterRarity(e.target.value)}
            className="bg-input border border-border rounded px-2 py-1.5 text-xs font-heading text-foreground focus:border-primary/50 focus:outline-none min-w-[120px] flex items-center gap-1"
          >
            <option value="all">All</option>
            {GTA_RARITIES.map((r) => (
              <option key={r} value={r}>{RARITY_LABELS[r] || r}</option>
            ))}
          </select>
          <ChevronDown size={12} className="text-mutedForeground shrink-0" />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="p-1.5 rounded border border-border text-mutedForeground hover:text-foreground hover:border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed font-heading text-xs"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="p-1.5 rounded border border-border text-mutedForeground hover:text-foreground hover:border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed font-heading text-xs"
          >
            Next
          </button>
        </div>
      </div>

      {/* Table: Car | Price | Bullets | Damage | Speed */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={`${styles.surface} text-[10px] uppercase tracking-wider font-heading text-primary/80 border-b border-border`}>
                <th className="w-8 py-2 pl-2 pr-0" />
                <th className="text-left py-2 px-3">Car</th>
                <th className="text-right py-2 px-3">Price</th>
                <th className="text-right py-2 px-3">Bullets</th>
                <th className="text-right py-2 px-3">Damage</th>
                <th className="text-right py-2 px-3">Speed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedCars.map((car) => {
                const bullets = Math.floor((car.value || 0) / 10);
                const speed = TRAVEL_TIMES[car.rarity] ?? 45;
                const isListed = !!car.listed_for_sale;
                return (
                  <tr key={car.user_car_id} className="hover:bg-secondary/30 transition-colors">
                    <td className="py-2 pl-2 pr-0">
                      {car.car_id !== 'car_custom' && (
                        <button
                          type="button"
                          onClick={() => toggleSelect(car.user_car_id)}
                          className="p-1 rounded hover:bg-primary/10"
                        >
                          {selectedIds.has(car.user_car_id) ? (
                            <CheckSquare size={14} className="text-primary" />
                          ) : (
                            <Square size={14} className="text-mutedForeground" />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-3 font-heading text-foreground">{car.name}</td>
                    <td className="py-2 px-3 text-right font-heading text-emerald-400">
                      {isListed ? `$${(car.sale_price ?? 0).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-mutedForeground font-heading">{bullets}</td>
                    <td className="py-2 px-3 text-right text-mutedForeground font-heading">—</td>
                    <td className="py-2 px-3 text-right text-mutedForeground font-heading">{speed} secs</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paginatedCars.length === 0 && (
          <p className="p-4 text-center text-sm text-mutedForeground font-heading">No cars to sell</p>
        )}

        {/* Bottom: Check all, Price, Sell, Stop Selling */}
        <div className={`px-3 py-2 ${styles.panelHeader} border-t border-primary/20 flex flex-wrap items-center gap-3`}>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="p-1 rounded hover:bg-primary/10"
            >
              {paginatedCars.length > 0 && paginatedCars.every((c) => selectedIds.has(c.user_car_id)) ? (
                <CheckSquare size={14} className="text-primary" />
              ) : (
                <Square size={14} className="text-mutedForeground" />
              )}
            </button>
            <span className="text-[10px] font-heading text-mutedForeground uppercase">Check all</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Price..."
            value={listPrice}
            onChange={(e) => setListPrice(e.target.value.replace(/\D/g, ''))}
            className="w-24 bg-input border border-border rounded px-2 py-1 text-xs font-heading text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none"
          />
          <button
            type="button"
            disabled={selectedIds.size === 0 || selling}
            onClick={handleSell}
            className="px-3 py-1.5 rounded bg-primary/20 text-primary border border-primary/50 font-heading font-bold uppercase text-xs hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Sell
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0 || stopping}
            onClick={handleStopSelling}
            className="px-3 py-1.5 rounded bg-secondary border border-border text-foreground font-heading font-bold uppercase text-xs hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Stop Selling
          </button>
        </div>
      </div>

      <p className="text-xs text-mutedForeground font-heading">
        <Link to="/buy-cars" className="text-primary font-bold hover:underline">Buy cars</Link> from the dealer or other players.
      </p>
    </div>
  );
}
