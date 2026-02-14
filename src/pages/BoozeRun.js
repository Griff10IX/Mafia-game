import { useState, useEffect, useCallback } from 'react';
import { MapPin, Package, Clock, Wine, TrendingUp, DollarSign, ChevronDown, ChevronRight } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const COLLAPSED_KEY = 'booze_sections_collapsed';
const BOOZE_CAUGHT_IMAGE = 'https://historicipswich.net/wp-content/uploads/2021/12/0a79f-boston-rum-prohibition1.jpg';

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
  if (!isoEnd) return '--:--';
  try {
    const end = new Date(isoEnd);
    const now = new Date();
    let s = Math.max(0, Math.floor((end - now) / 1000));
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  } catch {
    return '--:--';
  }
}

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = ({ config, timer }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
        <Wine className="w-6 h-6 sm:w-7 sm:h-7" />
        Booze Run
      </h1>
      <p className="text-xs text-mutedForeground">
        Buy low, travel, sell high
      </p>
    </div>
    
    {/* Quick stats */}
    <div className="flex flex-wrap items-center gap-3 text-xs font-heading">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 rounded">
        <Clock size={12} className="text-primary" />
        <span className="text-primary font-bold">{timer}</span>
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 rounded">
        <MapPin size={12} className="text-primary" />
        <span className="text-foreground font-bold">{config?.current_location}</span>
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 rounded">
        <Package size={12} className="text-primary" />
        <span className="text-foreground font-bold">{config?.carrying_total ?? 0}/{config?.capacity ?? 0}</span>
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 rounded">
        <TrendingUp size={12} className="text-emerald-400" />
        <span className={`font-bold ${(config?.profit_total ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {formatMoney(config?.profit_total)}
        </span>
      </div>
    </div>
  </div>
);

// Best route card (horizontal)
const RouteCard = ({ route }) => (
  <div className="bg-zinc-800/30 border border-primary/10 rounded-lg p-3 hover:border-primary/30 transition-all">
    <div className="text-sm font-heading font-bold text-foreground mb-2">{route.booze.name}</div>
    <div className="flex items-center gap-2 text-[11px] font-heading text-mutedForeground mb-1">
      <span className="text-primary">{route.bestBuyCity}</span>
      <span>{formatMoney(route.bestBuyPrice)}</span>
      <span className="text-primary/50">→</span>
      <span className="text-primary">{route.bestSellCity}</span>
      <span>{formatMoney(route.bestSellPrice)}</span>
    </div>
    <div className="text-emerald-400 font-heading font-bold text-sm">
      +{formatMoney(route.profit)}/unit
    </div>
  </div>
);

const BestRoutesSection = ({ routes, isCollapsed, onToggle }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between hover:bg-primary/15 transition-colors"
    >
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        🗺️ Best Routes
      </span>
      <span className="text-primary/80">
        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </span>
    </button>
    {!isCollapsed && (
      <div className="p-3">
        {routes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {routes.map((r) => <RouteCard key={r.booze.id} route={r} />)}
          </div>
        ) : (
          <p className="text-xs text-mutedForeground font-heading text-center py-3">No profitable routes this rotation</p>
        )}
      </div>
    )}
  </div>
);

// Compact city row
const CityRow = ({ city, minBuy, maxSell, bestBuyBooze, bestSellBooze }) => (
  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-zinc-800/20 hover:bg-zinc-800/40 transition-all">
    <span className="text-sm font-heading font-bold text-foreground w-28 truncate">{city}</span>
    <div className="flex items-center gap-4 text-xs font-heading">
      <div className="text-right">
        <span className="text-mutedForeground">Buy: </span>
        <span className="text-foreground font-bold">{formatMoney(minBuy)}</span>
        <span className="text-mutedForeground ml-1">({bestBuyBooze})</span>
      </div>
      <div className="text-right">
        <span className="text-mutedForeground">Sell: </span>
        <span className="text-foreground font-bold">{formatMoney(maxSell)}</span>
        <span className="text-mutedForeground ml-1">({bestSellBooze})</span>
      </div>
    </div>
  </div>
);

const CityPricesSection = ({ citySummary, isCollapsed, onToggle }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between hover:bg-primary/15 transition-colors"
    >
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        🌎 Prices by City
      </span>
      <span className="text-primary/80">
        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </span>
    </button>
    {!isCollapsed && (
      <div className="p-2 space-y-1">
        {citySummary.map((c) => (
          <CityRow key={c.city} {...c} />
        ))}
      </div>
    )}
  </div>
);

// Compact supply row
const SupplyRow = ({ row, buyAmount, sellAmount, setBuyAmount, setSellAmount, onBuy, onSell }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800/20 hover:bg-zinc-800/40 transition-all">
    {/* Name & carrying */}
    <div className="min-w-0 flex-1">
      <div className="text-sm font-heading font-bold text-foreground truncate">{row.name}</div>
      <div className="text-[10px] text-mutedForeground">
        Carrying: <span className="text-foreground font-bold">{row.carrying ?? 0}</span>
      </div>
    </div>
    
    {/* Prices */}
    <div className="text-right text-xs font-heading shrink-0 w-20">
      <div className="text-mutedForeground">Buy: <span className="text-foreground">{formatMoney(row.buy_price)}</span></div>
      <div className="text-mutedForeground">Sell: <span className="text-foreground">{formatMoney(row.sell_price)}</span></div>
    </div>
    
    {/* Inputs */}
    <div className="flex items-center gap-1 shrink-0">
      <input
        type="text"
        inputMode="numeric"
        placeholder="Qty"
        value={buyAmount ?? ''}
        onChange={(e) => setBuyAmount(e.target.value)}
        className="w-14 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-right text-foreground focus:border-primary/50 focus:outline-none"
      />
      <button
        onClick={onBuy}
        className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-2.5 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 transition-all"
      >
        Buy
      </button>
    </div>
    
    <div className="flex items-center gap-1 shrink-0">
      <input
        type="text"
        inputMode="numeric"
        placeholder="Qty"
        value={sellAmount ?? ''}
        onChange={(e) => setSellAmount(e.target.value)}
        className="w-14 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-right text-foreground focus:border-primary/50 focus:outline-none"
      />
      <button
        onClick={onSell}
        disabled={!(row.carrying > 0)}
        className="bg-zinc-700/50 hover:bg-zinc-600/50 text-foreground rounded px-2.5 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        Sell
      </button>
    </div>
  </div>
);

// Mobile supply card
const SupplyCard = ({ row, buyAmount, sellAmount, setBuyAmount, setSellAmount, onBuy, onSell }) => (
  <div className="bg-zinc-800/30 border border-primary/10 rounded-lg p-3 space-y-2">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-sm font-heading font-bold text-foreground">{row.name}</div>
        <div className="text-[10px] text-mutedForeground">Carrying: <span className="text-foreground font-bold">{row.carrying ?? 0}</span></div>
      </div>
      <div className="text-right text-xs font-heading">
        <div>Buy: <span className="text-foreground font-bold">{formatMoney(row.buy_price)}</span></div>
        <div>Sell: <span className="text-foreground font-bold">{formatMoney(row.sell_price)}</span></div>
      </div>
    </div>
    
    <div className="flex gap-2">
      <div className="flex-1 flex gap-1">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Qty"
          value={buyAmount ?? ''}
          onChange={(e) => setBuyAmount(e.target.value)}
          className="flex-1 min-w-0 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
        />
        <button
          onClick={onBuy}
          className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-yellow-600/50"
        >
          Buy
        </button>
      </div>
      <div className="flex-1 flex gap-1">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Qty"
          value={sellAmount ?? ''}
          onChange={(e) => setSellAmount(e.target.value)}
          className="flex-1 min-w-0 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
        />
        <button
          onClick={onSell}
          disabled={!(row.carrying > 0)}
          className="bg-zinc-700/50 text-foreground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-zinc-600/50 disabled:opacity-40"
        >
          Sell
        </button>
      </div>
    </div>
  </div>
);

const SuppliesSection = ({ location, supplies, buyAmounts, sellAmounts, setBuyAmount, setSellAmount, handleBuy, handleSell }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        🍾 Supplies in {location}
      </span>
    </div>
    
    {/* Desktop rows */}
    <div className="hidden md:block p-2 space-y-1">
      {supplies.map((row) => (
        <SupplyRow
          key={row.booze_id}
          row={row}
          buyAmount={buyAmounts[row.booze_id]}
          sellAmount={sellAmounts[row.booze_id]}
          setBuyAmount={(v) => setBuyAmount(row.booze_id, v)}
          setSellAmount={(v) => setSellAmount(row.booze_id, v)}
          onBuy={() => handleBuy(row.booze_id)}
          onSell={() => handleSell(row.booze_id)}
        />
      ))}
    </div>
    
    {/* Mobile cards */}
    <div className="md:hidden p-3 space-y-2">
      {supplies.map((row) => (
        <SupplyCard
          key={row.booze_id}
          row={row}
          buyAmount={buyAmounts[row.booze_id]}
          sellAmount={sellAmounts[row.booze_id]}
          setBuyAmount={(v) => setBuyAmount(row.booze_id, v)}
          setSellAmount={(v) => setSellAmount(row.booze_id, v)}
          onBuy={() => handleBuy(row.booze_id)}
          onSell={() => handleSell(row.booze_id)}
        />
      ))}
    </div>
  </div>
);

// Compact history row
const HistoryRow = ({ h }) => {
  const at = h.at ? new Date(h.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const isSell = h.action === 'sell';
  
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-zinc-800/20 hover:bg-zinc-800/40 text-xs font-heading">
      <span className="text-mutedForeground w-24 truncate">{at}</span>
      <span className={`font-bold w-10 ${isSell ? 'text-emerald-400' : 'text-foreground'}`}>
        {isSell ? 'Sell' : 'Buy'}
      </span>
      <span className="text-foreground flex-1 truncate">{h.booze_name ?? '—'}</span>
      <span className="text-foreground font-bold w-8 text-right">{h.amount ?? 0}</span>
      <span className="text-mutedForeground w-16 text-right">{formatMoney(h.unit_price)}</span>
      <span className="text-foreground font-bold w-20 text-right">{formatMoney(h.total)}</span>
      <span className={`font-bold w-20 text-right ${isSell && h.profit != null ? (h.profit >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-mutedForeground'}`}>
        {isSell && h.profit != null ? formatMoney(h.profit) : '—'}
      </span>
    </div>
  );
};

const HistorySection = ({ history, isCollapsed, onToggle }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between hover:bg-primary/15 transition-colors"
    >
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        📜 Recent Transactions
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-primary font-bold">{history.length}</span>
        <span className="text-primary/80">
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
      </div>
    </button>
    {!isCollapsed && (
      history.length === 0 ? (
        <div className="p-4 text-center text-xs text-mutedForeground font-heading">No transactions yet</div>
      ) : (
        <div className="p-2 space-y-0.5 max-h-64 overflow-y-auto">
          {history.map((h, i) => <HistoryRow key={i} h={h} />)}
        </div>
      )
    )}
  </div>
);

const InfoSection = ({ rotationHours, isCollapsed, onToggle }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between hover:bg-primary/15 transition-colors"
    >
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        ℹ️ How It Works
      </span>
      <span className="text-primary/80">
        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </span>
    </button>
    {!isCollapsed && (
      <div className="p-3">
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
          <li className="flex items-start gap-1.5">
            <span className="text-primary shrink-0">•</span>
            <span>Prices rotate every <strong className="text-foreground">{rotationHours ?? 3}h</strong></span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-primary shrink-0">•</span>
            <span>Travel via car only while carrying booze</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-primary shrink-0">•</span>
            <span>Upgrade capacity in Points Store</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-amber-400 shrink-0">⚠️</span>
            <span className="text-amber-400">Risk of getting caught!</span>
          </li>
        </ul>
      </div>
    )}
  </div>
);

// Main component
export default function BoozeRun() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buyAmounts, setBuyAmounts] = useState({});
  const [sellAmounts, setSellAmounts] = useState({});
  const [timer, setTimer] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      return raw ? JSON.parse(raw) : { routes: false, cities: true, history: true, info: true };
    } catch {
      return { routes: false, cities: true, history: true, info: true };
    }
  });

  const toggleSection = (key) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

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

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

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
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const response = await api.post('/booze-run/buy', { booze_id: boozeId, amount });
      if (response.data.caught) {
        toast.error(response.data.message, {
          description: (
            <div className="mt-2 overflow-hidden max-w-[280px]">
              <div className="relative w-full aspect-[4/3] rounded-sm overflow-hidden border border-red-500/50 bg-black">
                <img src={BOOZE_CAUGHT_IMAGE} alt="Busted" className="absolute inset-0 w-full h-full object-cover" />
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
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const response = await api.post('/booze-run/sell', { booze_id: boozeId, amount });
      if (response.data.caught) {
        toast.error(response.data.message, {
          description: (
            <div className="mt-2 overflow-hidden max-w-[280px]">
              <div className="relative w-full aspect-[4/3] rounded-sm overflow-hidden border border-red-500/50 bg-black">
                <img src={BOOZE_CAUGHT_IMAGE} alt="Busted" className="absolute inset-0 w-full h-full object-cover" />
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

  if (loading || !config) return <LoadingSpinner />;

  const historyList = config.history || [];
  const pricesAtLocation = config.prices_at_location || [];
  const allByLocation = config.all_prices_by_location || {};

  // Best routes
  const bestRoutes = (config.booze_types || []).map((bt) => {
    let bestBuyCity = null, bestBuyPrice = Infinity, bestSellCity = null, bestSellPrice = -1;
    Object.entries(allByLocation).forEach(([city, list]) => {
      const item = list.find((p) => p.booze_id === bt.id);
      if (item) {
        if (item.buy_price < bestBuyPrice) { bestBuyPrice = item.buy_price; bestBuyCity = city; }
        if (item.sell_price > bestSellPrice) { bestSellPrice = item.sell_price; bestSellCity = city; }
      }
    });
    const profit = (bestBuyCity && bestSellCity && bestSellPrice > bestBuyPrice) ? bestSellPrice - bestBuyPrice : 0;
    return { booze: bt, bestBuyCity, bestBuyPrice, bestSellCity, bestSellPrice, profit };
  }).filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit);

  // City summary
  const citySummary = Object.entries(allByLocation).map(([city, list]) => {
    const minBuy = Math.min(...list.map((p) => p.buy_price));
    const maxSell = Math.max(...list.map((p) => p.sell_price));
    const bestBuyBooze = list.find((p) => p.buy_price === minBuy);
    const bestSellBooze = list.find((p) => p.sell_price === maxSell);
    return { city, minBuy, maxSell, bestBuyBooze: bestBuyBooze?.name, bestSellBooze: bestSellBooze?.name };
  });

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="booze-run-page">
      <PageHeader config={config} timer={timer} />

      <BestRoutesSection routes={bestRoutes} isCollapsed={collapsed.routes} onToggle={() => toggleSection('routes')} />

      <CityPricesSection citySummary={citySummary} isCollapsed={collapsed.cities} onToggle={() => toggleSection('cities')} />

      <SuppliesSection
        location={config.current_location}
        supplies={pricesAtLocation}
        buyAmounts={buyAmounts}
        sellAmounts={sellAmounts}
        setBuyAmount={setBuyAmount}
        setSellAmount={setSellAmount}
        handleBuy={handleBuy}
        handleSell={handleSell}
      />

      <HistorySection history={historyList} isCollapsed={collapsed.history} onToggle={() => toggleSection('history')} />

      <InfoSection rotationHours={config.rotation_hours} isCollapsed={collapsed.info} onToggle={() => toggleSection('info')} />
    </div>
  );
}
