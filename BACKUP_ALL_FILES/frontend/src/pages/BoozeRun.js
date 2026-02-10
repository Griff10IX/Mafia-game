import { useState, useEffect, useCallback } from 'react';
import { MapPin, Package, Clock, Wine } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  return fallback;
}

function timeUntil(isoEnd) {
  if (!isoEnd) return '--:--:--';
  try {
    const end = new Date(isoEnd);
    const now = new Date();
    let s = Math.max(0, Math.floor((end - now) / 1000));
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } catch {
    return '--:--:--';
  }
}

function HistoryRow({ h }) {
  const at = h.at ? new Date(h.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const isSell = h.action === 'sell';
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-1.5 px-2 text-mutedForeground">{at}</td>
      <td className="py-1.5 px-2">
        <span className={isSell ? 'text-green-600 dark:text-green-400 font-medium' : 'text-foreground'}>{isSell ? 'Sell' : 'Buy'}</span>
      </td>
      <td className="py-1.5 px-2 text-foreground">{h.booze_name ?? '—'}</td>
      <td className="py-1.5 px-2 text-right font-mono">{h.amount ?? 0}</td>
      <td className="py-1.5 px-2 text-right text-mutedForeground">{formatMoney(h.unit_price)}</td>
      <td className="py-1.5 px-2 text-right font-mono text-foreground">{formatMoney(h.total)}</td>
      <td className="py-1.5 px-2 text-right">
        {isSell && h.profit != null ? (
          <span className={h.profit >= 0 ? 'text-green-600 dark:text-green-400 font-mono' : 'text-red-600 dark:text-red-400 font-mono'}>{formatMoney(h.profit)}</span>
        ) : '—'}
      </td>
    </tr>
  );
}

function BestRouteCard({ r }) {
  return (
    <div className="bg-background/50 border border-border rounded-sm p-2">
      <span className="font-medium text-foreground">{r.booze.name}</span>
      <div className="mt-0.5 text-mutedForeground">
        Buy in <span className="text-foreground">{r.bestBuyCity}</span> {formatMoney(r.bestBuyPrice)} → Sell in <span className="text-foreground">{r.bestSellCity}</span> {formatMoney(r.bestSellPrice)}
      </div>
      <div className="mt-0.5 font-mono font-semibold text-green-600 dark:text-green-400">+{formatMoney(r.profit)}/unit</div>
    </div>
  );
}

function CitySummaryRow({ c }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-1.5 px-2 font-medium text-foreground">{c.city}</td>
      <td className="py-1.5 px-2 text-right text-mutedForeground">{formatMoney(c.minBuy)} <span className="text-mutedForeground/80">({c.bestBuyBooze})</span></td>
      <td className="py-1.5 px-2 text-right text-mutedForeground">{formatMoney(c.maxSell)} <span className="text-mutedForeground/80">({c.bestSellBooze})</span></td>
    </tr>
  );
}

function SupplyRow({ row, buyAmounts, sellAmounts, setBuyAmount, setSellAmount, handleBuy, handleSell }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-1.5 px-2 font-medium text-foreground">{row.name}</td>
      <td className="py-1.5 px-2 text-right text-mutedForeground">{formatMoney(row.buy_price)}</td>
      <td className="py-1.5 px-2 text-right text-mutedForeground">{formatMoney(row.sell_price)}</td>
      <td className="py-1.5 px-2 text-right font-mono text-foreground">{row.carrying ?? 0}</td>
      <td className="py-1.5 px-2 text-right">
        <span className="text-mutedForeground/80 mr-1">B</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={buyAmounts[row.booze_id] ?? ''}
          onChange={(e) => setBuyAmount(row.booze_id, e.target.value)}
          className="w-12 text-right bg-background border border-border rounded px-1 py-0.5 font-mono text-foreground inline"
        />
        <span className="text-mutedForeground/80 ml-1 mr-1">S</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={sellAmounts[row.booze_id] ?? ''}
          onChange={(e) => setSellAmount(row.booze_id, e.target.value)}
          className="w-12 text-right bg-background border border-border rounded px-1 py-0.5 font-mono text-foreground inline"
        />
      </td>
      <td className="py-1.5 px-2 text-right space-x-1">
        <button
          onClick={() => handleBuy(row.booze_id)}
          className="bg-primary text-primaryForeground hover:opacity-90 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-smooth"
        >
          Buy
        </button>
        <button
          onClick={() => handleSell(row.booze_id)}
          disabled={!(row.carrying > 0)}
          className="bg-secondary border border-border text-foreground hover:bg-secondary/80 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-smooth disabled:opacity-50"
        >
          Sell
        </button>
      </td>
    </tr>
  );
}

export default function BoozeRun() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buyAmounts, setBuyAmounts] = useState({});
  const [sellAmounts, setSellAmounts] = useState({});
  const [timer, setTimer] = useState('');

  const fetchConfig = useCallback(async () => {
    try {
      const r = await api.get('/booze-run/config');
      setConfig(r.data);
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to load booze run'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (!config?.rotation_ends_at) return;
    const tick = () => setTimer(timeUntil(config.rotation_ends_at));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [config?.rotation_ends_at]);

  const setBuyAmount = (boozeId, value) => {
    const n = parseInt(String(value).replace(/\D/g, ''), 10);
    setBuyAmounts((prev) => ({ ...prev, [boozeId]: isNaN(n) ? '' : n }));
  };
  const setSellAmount = (boozeId, value) => {
    const n = parseInt(String(value).replace(/\D/g, ''), 10);
    setSellAmounts((prev) => ({ ...prev, [boozeId]: isNaN(n) ? '' : n }));
  };

  const handleBuy = async (boozeId) => {
    const amount = buyAmounts[boozeId];
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    try {
      await api.post('/booze-run/buy', { booze_id: boozeId, amount });
      toast.success(`Purchased ${amount} units`);
      refreshUser();
      setBuyAmounts((prev) => ({ ...prev, [boozeId]: '' }));
      fetchConfig();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Purchase failed'));
    }
  };

  const handleSell = async (boozeId) => {
    const amount = sellAmounts[boozeId];
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    try {
      await api.post('/booze-run/sell', { booze_id: boozeId, amount });
      toast.success(`Sold ${amount} units`);
      refreshUser();
      setSellAmounts((prev) => ({ ...prev, [boozeId]: '' }));
      fetchConfig();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Sell failed'));
    }
  };

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  const capacity = config.capacity ?? 0;
  const carryingTotal = config.carrying_total ?? 0;

  // Precompute lists for iteration to avoid Babel plugin stack overflow
  const historyList = config.history || [];
  const pricesAtLocation = config.prices_at_location || [];

  // Best route per booze: city with lowest buy, city with highest sell, profit/unit
  const allByLocation = config.all_prices_by_location || {};
  const bestRoutes = (config.booze_types || []).map((bt) => {
    let bestBuyCity = null;
    let bestBuyPrice = Infinity;
    let bestSellCity = null;
    let bestSellPrice = -1;
    Object.entries(allByLocation).forEach(([city, list]) => {
      const item = list.find((p) => p.booze_id === bt.id);
      if (item) {
        if (item.buy_price < bestBuyPrice) {
          bestBuyPrice = item.buy_price;
          bestBuyCity = city;
        }
        if (item.sell_price > bestSellPrice) {
          bestSellPrice = item.sell_price;
          bestSellCity = city;
        }
      }
    });
    const profit = (bestBuyCity && bestSellCity && bestSellPrice > bestBuyPrice)
      ? bestSellPrice - bestBuyPrice
      : 0;
    return { booze: bt, bestBuyCity, bestBuyPrice, bestSellCity, bestSellPrice, profit };
  }).filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit);

  // Per-city summary: lowest buy and highest sell (any booze) for quick scan
  const citySummary = Object.entries(allByLocation).map(([city, list]) => {
    const minBuy = Math.min(...list.map((p) => p.buy_price));
    const maxSell = Math.max(...list.map((p) => p.sell_price));
    const bestBuyBooze = list.find((p) => p.buy_price === minBuy);
    const bestSellBooze = list.find((p) => p.sell_price === maxSell);
    return { city, minBuy, maxSell, bestBuyBooze: bestBuyBooze?.name, bestSellBooze: bestSellBooze?.name };
  });

  return (
    <div className="space-y-4" data-testid="booze-run-page">
      <div>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mb-2 flex items-center gap-2">
          <Wine size={32} />
          Booze Run
        </h1>
        <p className="text-sm text-mutedForeground">
          Prohibition-era supply runs. Buy booze here, travel by car to another city, sell for profit. Routes change every {config.rotation_hours ?? 3} hours.
        </p>
      </div>

      {/* Timer + location + capacity + profit stats */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-xs">
          <Clock size={14} className="text-mutedForeground" />
          <span className="text-mutedForeground">Rotation in:</span>
          <span className="font-mono font-bold text-foreground">{timer}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <MapPin size={14} className="text-primary" />
          <span className="text-foreground font-medium">{config.current_location}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Package size={14} className="text-primary" />
          <span className="font-mono text-foreground">{carryingTotal} / {capacity}</span>
          <span className="text-mutedForeground">units</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-mutedForeground">Profit today:</span>
          <span className={`font-mono font-semibold ${(config.profit_today ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatMoney(config.profit_today)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-mutedForeground">Overall profit:</span>
          <span className={`font-mono font-semibold ${(config.profit_total ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatMoney(config.profit_total)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-mutedForeground">Runs:</span>
          <span className="font-mono font-semibold text-foreground">{config.runs_count ?? 0}</span>
        </div>
      </div>

      {/* Best routes: buy where cheap, sell where high */}
      <div className="bg-card border border-primary rounded-sm p-3">
        <h3 className="text-sm font-heading font-semibold text-primary mb-2">Best routes (buy low → sell high)</h3>
        {bestRoutes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
            {bestRoutes.map((r) => (
              <BestRouteCard key={r.booze.id} r={r} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-mutedForeground">No profitable route this rotation.</p>
        )}
      </div>

      {/* City summary: min buy / max sell per city */}
      <div className="bg-card border border-border rounded-sm p-3">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-2">Prices by city</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left py-1.5 px-2 font-semibold text-foreground">City</th>
                <th className="text-right py-1.5 px-2 font-semibold text-foreground">Lowest buy</th>
                <th className="text-right py-1.5 px-2 font-semibold text-foreground">Highest sell</th>
              </tr>
            </thead>
            <tbody>
              {citySummary.map((c) => (
                <CitySummaryRow key={c.city} c={c} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compact supplies table: buy/sell at current location */}
      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <h3 className="text-sm font-heading font-semibold text-foreground px-3 py-2 border-b border-border">Supplies here ({config.current_location})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left py-1.5 px-2 font-semibold text-foreground">Booze</th>
                <th className="text-right py-1.5 px-2 font-semibold text-foreground">Buy</th>
                <th className="text-right py-1.5 px-2 font-semibold text-foreground">Sell</th>
                <th className="text-right py-1.5 px-2 font-semibold text-foreground">Carry</th>
                <th className="text-right py-1.5 px-2 font-semibold text-foreground">Qty</th>
                <th className="text-right py-1.5 px-2 font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pricesAtLocation.map((row) => (
                <SupplyRow
                  key={row.booze_id}
                  row={row}
                  buyAmounts={buyAmounts}
                  sellAmounts={sellAmounts}
                  setBuyAmount={setBuyAmount}
                  setSellAmount={setSellAmount}
                  handleBuy={handleBuy}
                  handleSell={handleSell}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Last 10 buy/sells */}
      <div className="bg-card border border-border rounded-sm p-3">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-2">Last 10 buy/sells</h3>
        {historyList.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left py-1.5 px-2 font-semibold text-foreground">Time</th>
                  <th className="text-left py-1.5 px-2 font-semibold text-foreground">Action</th>
                  <th className="text-left py-1.5 px-2 font-semibold text-foreground">Booze</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-foreground">Amount</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-foreground">Price</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-foreground">Total</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-foreground">Profit</th>
                </tr>
              </thead>
              <tbody>
                {historyList.map((h, i) => <HistoryRow key={i} h={h} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-mutedForeground">No buy/sell history yet.</p>
        )}
      </div>

      <div className="bg-card border border-border rounded-sm p-3 text-xs text-mutedForeground">
        <p>Travel via <strong className="text-foreground">Travel</strong> (car only while carrying booze). Upgrade capacity on the <strong className="text-foreground">Points Store</strong>.</p>
      </div>
    </div>
  );
}
