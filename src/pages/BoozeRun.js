import { useState, useEffect, useCallback } from 'react';
import { MapPin, Package, Clock, Wine } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

// Shown in toast when caught during booze run (prohibition bust)
const BOOZE_CAUGHT_IMAGE = 'https://historicipswich.net/wp-content/uploads/2021/12/0a79f-boston-rum-prohibition1.jpg';

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
    <tr className={`border-b border-primary/10 last:border-0 ${styles.raisedHover} transition-smooth`}>
      <td className="py-1.5 px-2 text-mutedForeground font-heading text-xs">{at}</td>
      <td className="py-1.5 px-2">
        <span className={isSell ? 'text-emerald-400 font-heading font-bold' : 'text-foreground font-heading'}>{isSell ? 'Sell' : 'Buy'}</span>
      </td>
      <td className="py-1.5 px-2 text-foreground font-heading">{h.booze_name ?? '—'}</td>
      <td className="py-1.5 px-2 text-right font-heading font-bold">{h.amount ?? 0}</td>
      <td className="py-1.5 px-2 text-right text-mutedForeground font-heading">{formatMoney(h.unit_price)}</td>
      <td className="py-1.5 px-2 text-right font-heading font-bold text-foreground">{formatMoney(h.total)}</td>
      <td className="py-1.5 px-2 text-right">
        {isSell && h.profit != null ? (
          <span className={`font-heading font-bold ${h.profit >= 0 ? styles.textProfit : 'text-red-400'}`}>{formatMoney(h.profit)}</span>
        ) : '—'}
      </td>
    </tr>
  );
}

function BestRouteCard({ r }) {
  return (
    <div className={`${styles.surfaceMuted} rounded-sm p-2.5`}>
      <span className="font-heading font-bold text-primary">{r.booze.name}</span>
      <div className="mt-0.5 text-mutedForeground font-heading text-xs">
        Buy in <span className="text-foreground font-bold">{r.bestBuyCity}</span> {formatMoney(r.bestBuyPrice)} → Sell in <span className="text-foreground font-bold">{r.bestSellCity}</span> {formatMoney(r.bestSellPrice)}
      </div>
      <div className={`mt-0.5 font-heading font-bold ${styles.textProfit}`}>+{formatMoney(r.profit)}/unit</div>
    </div>
  );
}

function CitySummaryRow({ c }) {
  return (
    <tr className={`border-b border-primary/10 last:border-0 ${styles.raisedHover} transition-smooth`}>
      <td className="py-1.5 px-2 font-heading font-bold text-foreground">{c.city}</td>
      <td className="py-1.5 px-2 text-right text-mutedForeground font-heading">{formatMoney(c.minBuy)} <span className="text-mutedForeground/80">({c.bestBuyBooze})</span></td>
      <td className="py-1.5 px-2 text-right text-mutedForeground font-heading">{formatMoney(c.maxSell)} <span className="text-mutedForeground/80">({c.bestSellBooze})</span></td>
    </tr>
  );
}

function SupplyRow({ row, buyAmounts, sellAmounts, setBuyAmount, setSellAmount, handleBuy, handleSell }) {
  return (
    <tr className={`border-b border-primary/10 last:border-0 ${styles.raisedHover} transition-smooth`}>
      <td className="py-1.5 px-2 font-heading font-bold text-foreground">{row.name}</td>
      <td className="py-1.5 px-2 text-right text-mutedForeground font-heading">{formatMoney(row.buy_price)}</td>
      <td className="py-1.5 px-2 text-right text-mutedForeground font-heading">{formatMoney(row.sell_price)}</td>
      <td className="py-1.5 px-2 text-right font-heading font-bold text-foreground">{row.carrying ?? 0}</td>
      <td className="py-1.5 px-2 text-right">
        <span className="text-primary/80 mr-1 font-heading text-[10px]">B</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={buyAmounts[row.booze_id] ?? ''}
          onChange={(e) => setBuyAmount(row.booze_id, e.target.value)}
          className={`w-12 text-right ${styles.input} rounded px-1 py-0.5 font-heading inline focus:border-primary/50 focus:outline-none`}
        />
        <span className="text-primary/80 ml-1 mr-1 font-heading text-[10px]">S</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={sellAmounts[row.booze_id] ?? ''}
          onChange={(e) => setSellAmount(row.booze_id, e.target.value)}
          className={`w-12 text-right ${styles.input} rounded px-1 py-0.5 font-heading inline focus:border-primary/50 focus:outline-none`}
        />
      </td>
      <td className="py-1.5 px-2 text-right space-x-1">
        <button
          onClick={() => handleBuy(row.booze_id)}
          className={`${styles.btnGoldDarkText} px-2 py-1 rounded text-[10px] font-heading font-bold uppercase tracking-wider transition-smooth`}
        >
          Buy
        </button>
        <button
          onClick={() => handleSell(row.booze_id)}
          disabled={!(row.carrying > 0)}
          className={`${styles.btnGoldDarkText} px-2 py-1 rounded text-[10px] font-heading font-bold uppercase tracking-wider transition-smooth disabled:opacity-50`}
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
      const response = await api.post('/booze-run/buy', { booze_id: boozeId, amount });
      if (response.data.caught) {
        toast.error(response.data.message, {
          description: (
            <div className="mt-2 overflow-hidden isolate max-w-[280px]" style={{ contain: 'layout paint' }}>
              <div className="relative w-full aspect-[4/3] rounded-sm overflow-hidden border border-red-500/50 bg-black">
                <img src={BOOZE_CAUGHT_IMAGE} alt="Busted by prohibition agents" className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none" />
                <div className="absolute inset-0 bg-black/40 pointer-events-auto" aria-hidden />
              </div>
              {response.data.jail_seconds && <p className="text-xs text-mutedForeground mt-1">{response.data.jail_seconds}s in jail</p>}
            </div>
          ),
        });
      } else {
        toast.success(`Purchased ${amount} units`);
      }
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
      const response = await api.post('/booze-run/sell', { booze_id: boozeId, amount });
      if (response.data.caught) {
        toast.error(response.data.message, {
          description: (
            <div className="mt-2 overflow-hidden isolate max-w-[280px]" style={{ contain: 'layout paint' }}>
              <div className="relative w-full aspect-[4/3] rounded-sm overflow-hidden border border-red-500/50 bg-black">
                <img src={BOOZE_CAUGHT_IMAGE} alt="Busted by prohibition agents" className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none" />
                <div className="absolute inset-0 bg-black/40 pointer-events-auto" aria-hidden />
              </div>
              {response.data.jail_seconds && <p className="text-xs text-mutedForeground mt-1">{response.data.jail_seconds}s in jail</p>}
            </div>
          ),
        });
      } else {
        toast.success(`Sold ${amount} units`);
      }
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
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="booze-run-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-primary/40" />
          <h1 className={`text-2xl md:text-3xl font-heading font-bold uppercase tracking-wider flex items-center gap-2 ${styles.gmTitle}`}>
            <Wine size={28} />
            Booze Run
          </h1>
          <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-primary/40" />
        </div>
        <p className={`text-xs font-heading uppercase tracking-widest max-w-xl ${styles.gmMuted}`}>
          Prohibition-era supply runs, buy here, travel by car, sell for profit. Routes change every {config.rotation_hours ?? 3} hours.
        </p>
      </div>

      {/* Timer + location + capacity + profit stats */}
      <div className={`${styles.panel} rounded-md px-4 py-3`}>
        <div className="flex flex-wrap items-center gap-4 text-xs font-heading">
          <div className="flex items-center gap-2">
            <Clock size={14} style={{ color: 'var(--gm-gold)' }} />
            <span className={styles.gmStatLabel}>Rotation:</span>
            <span className={`font-bold ${styles.gmStatValue}`}>{timer}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={14} style={{ color: 'var(--gm-gold)' }} />
            <span className={`font-bold ${styles.gmStatGold}`}>{config.current_location}</span>
          </div>
          <div className="flex items-center gap-2">
            <Package size={14} style={{ color: 'var(--gm-gold)' }} />
            <span className={`font-bold ${styles.gmStatValue}`}>{carryingTotal} / {capacity}</span>
            <span className={styles.gmStatLabel}>units</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={styles.gmStatLabel}>Today:</span>
            <span className={`font-bold ${(config.profit_today ?? 0) >= 0 ? styles.textProfit : 'text-red-400'}`}>{formatMoney(config.profit_today)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={styles.gmStatLabel}>Overall:</span>
            <span className={`font-bold ${(config.profit_total ?? 0) >= 0 ? styles.textProfit : 'text-red-400'}`}>{formatMoney(config.profit_total)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={styles.gmStatLabel}>Runs:</span>
            <span className={`font-bold ${styles.gmStatValue}`}>{config.runs_count ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Best routes: buy where cheap, sell where high */}
      <div className={`${styles.panel} rounded-md overflow-hidden`}>
        <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--gm-border)' }}>
          <h3 className={`text-xs font-heading font-bold uppercase tracking-widest ${styles.gmSectionHead}`}>Best routes (buy low → sell high)</h3>
        </div>
        <div className="p-3">
          {bestRoutes.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              {bestRoutes.map((r) => (
                <BestRouteCard key={r.booze.id} r={r} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-mutedForeground font-heading">No profitable route this rotation.</p>
          )}
        </div>
      </div>

      {/* City summary: min buy / max sell per city */}
      <div className={`${styles.panel} rounded-md overflow-hidden`}>
        <div className={`px-4 py-2 ${styles.surfaceMuted} border-b`} style={{ borderColor: 'var(--gm-border)' }}>
          <span className={`text-xs font-heading font-bold uppercase tracking-widest ${styles.gmSectionHead}`}>Prices by city</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={`${styles.surfaceMuted} text-primary/80`}>
                <th className="text-left py-1.5 px-2 font-heading font-bold uppercase tracking-wider">City</th>
                <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Lowest buy</th>
                <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Highest sell</th>
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
      <div className={`${styles.panel} rounded-md overflow-hidden`}>
        <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--gm-border)' }}>
          <h3 className={`text-xs font-heading font-bold uppercase tracking-widest ${styles.gmSectionHead}`}>Supplies here ({config.current_location})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={`${styles.surfaceMuted} text-primary/80`}>
                <th className="text-left py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Booze</th>
                <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Buy</th>
                <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Sell</th>
                <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Carry</th>
                <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Qty</th>
                <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Actions</th>
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
      <div className={`${styles.panel} rounded-md overflow-hidden`}>
        <div className={`px-4 py-2 ${styles.surfaceMuted} border-b`} style={{ borderColor: 'var(--gm-border)' }}>
          <span className={`text-xs font-heading font-bold uppercase tracking-widest ${styles.gmSectionHead}`}>Last 10 buy/sells</span>
        </div>
        <div className="p-3">
          {historyList.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className={`${styles.surfaceMuted} text-primary/80`}>
                    <th className="text-left py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Time</th>
                    <th className="text-left py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Action</th>
                    <th className="text-left py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Booze</th>
                    <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Amount</th>
                    <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Price</th>
                    <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Total</th>
                    <th className="text-right py-1.5 px-2 font-heading font-bold uppercase tracking-wider">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {historyList.map((h, i) => <HistoryRow key={i} h={h} />)}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-mutedForeground font-heading">No buy/sell history yet.</p>
          )}
        </div>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden`}>
        <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--gm-border)' }}>
          <span className={`text-xs font-heading font-bold uppercase tracking-widest ${styles.gmSectionHead}`}>Quick tip</span>
        </div>
        <div className="p-4">
          <p className={`text-xs font-heading flex items-center gap-2 ${styles.gmMuted}`}>
            <span style={{ color: 'var(--gm-gold)' }}>◆</span> Travel via <strong className={styles.gmStatValue}>Travel</strong> (car only while carrying booze). Upgrade capacity on the <strong className={styles.gmStatValue}>Points Store</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
