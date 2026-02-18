import { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Package, Clock, Wine, TrendingUp, DollarSign, ShoppingCart, Bot } from 'lucide-react';
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

const BOOZE_STYLES = `
  @keyframes bz-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .bz-fade-in { animation: bz-fade-in 0.4s ease-out both; }
  @keyframes bz-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .bz-scale-in { animation: bz-scale-in 0.35s ease-out both; }
  @keyframes bz-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .bz-glow { animation: bz-glow 4s ease-in-out infinite; }
  @keyframes bz-shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  .bz-shimmer {
    background: linear-gradient(90deg, rgba(var(--noir-primary-rgb),0.6) 0%, rgba(var(--noir-primary-rgb),1) 50%, rgba(var(--noir-primary-rgb),0.6) 100%);
    background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    animation: bz-shimmer 3s linear infinite;
  }
  .bz-corner::before, .bz-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .bz-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .bz-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .bz-card { transition: all 0.3s ease; }
  .bz-card:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
  .bz-row { transition: all 0.2s ease; }
  .bz-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  @keyframes bz-timer-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
  .bz-timer-pulse { animation: bz-timer-pulse 1s ease-in-out infinite; }
  .bz-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
    <Wine size={22} className="text-primary/40 animate-pulse" />
    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading the shipment...</span>
  </div>
);

const AutoRankBoozeNotice = () => (
  <div className={`relative p-2 ${styles.panel} border border-amber-500/30 rounded-md overflow-hidden bz-fade-in`}>
    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-500/50" />
    <div className="flex items-center gap-1.5">
      <Bot size={10} className="text-amber-400 shrink-0" />
      <div>
        <span className="text-[9px] font-heading font-bold text-amber-300 uppercase tracking-wider">Auto Rank Active</span>
        <p className="text-[9px] text-amber-200/60 font-heading mt-0.5">Booze running is automated — buy, travel, sell. Manual trading disabled.</p>
      </div>
    </div>
  </div>
);

const StatsCard = ({ config, timer }) => {
  const capacity = config.capacity ?? 0;
  const carryingTotal = config.carrying_total ?? 0;
  const pctFull = capacity > 0 ? (carryingTotal / capacity) * 100 : 0;
  
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 bz-corner bz-scale-in`}>
      <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none bz-glow" />
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="p-2 grid grid-cols-3 md:grid-cols-6 gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-0.5 text-[8px] text-zinc-500 uppercase tracking-[0.1em] font-heading">
            <Clock size={8} className="text-primary" />
            Rotation
          </div>
          <div className={`text-[11px] font-heading font-bold tabular-nums ${timer === '00:00:00' ? 'text-amber-400 bz-timer-pulse' : 'text-foreground'}`}>{timer}</div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-0.5 text-[8px] text-zinc-500 uppercase tracking-[0.1em] font-heading">
            <MapPin size={8} className="text-primary" />
            Your City
          </div>
          <div className="text-[11px] font-heading font-bold text-primary truncate">{config.current_location}</div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-0.5 text-[8px] text-zinc-500 uppercase tracking-[0.1em] font-heading">
            <Package size={8} className="text-primary" />
            Cargo
          </div>
          <div className="text-[11px] font-heading font-bold text-foreground tabular-nums">
            {carryingTotal} / {capacity}
          </div>
          <div className="w-full h-0.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${pctFull > 80 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pctFull}%` }} />
          </div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-0.5 text-[8px] text-zinc-500 uppercase tracking-[0.1em] font-heading">
            <DollarSign size={8} className="text-primary" />
            Today's Take
          </div>
          <div className={`text-[11px] font-heading font-bold tabular-nums ${
            (config.profit_today ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {formatMoney(config.profit_today)}
          </div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-0.5 text-[8px] text-zinc-500 uppercase tracking-[0.1em] font-heading">
            <TrendingUp size={8} className="text-primary" />
            Total Profit
          </div>
          <div className={`text-[11px] font-heading font-bold tabular-nums ${
            (config.profit_total ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {formatMoney(config.profit_total)}
          </div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-0.5 text-[8px] text-zinc-500 uppercase tracking-[0.1em] font-heading">
            <ShoppingCart size={8} className="text-primary" />
            Runs Made
          </div>
          <div className="text-[11px] font-heading font-bold text-foreground tabular-nums">
            {config.runs_count ?? 0}
          </div>
        </div>
      </div>
      <div className="bz-art-line text-primary mx-2.5" />
    </div>
  );
};

const RouteItem = ({ r, delay = 0 }) => (
  <div className="relative bg-zinc-800/40 rounded-md p-1.5 border border-zinc-700/30 bz-card bz-fade-in overflow-hidden" style={{ animationDelay: `${delay}s` }}>
    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />
    <div className="font-heading font-bold text-foreground text-[11px] mb-1 tracking-wide">{r.booze.name}</div>
    <div className="text-[9px] text-zinc-400 font-heading space-y-0.5">
      <div className="flex items-center gap-0.5">
        <span className="text-[8px] text-zinc-500 uppercase w-6">Buy</span>
        <span className="text-primary font-bold">{r.bestBuyCity}</span>
        <span className="text-zinc-600 mx-0.5">—</span>
        <span className="text-foreground font-heading">{formatMoney(r.bestBuyPrice)}</span>
      </div>
      <div className="flex items-center gap-0.5">
        <span className="text-[8px] text-zinc-500 uppercase w-6">Sell</span>
        <span className="text-primary font-bold">{r.bestSellCity}</span>
        <span className="text-zinc-600 mx-0.5">—</span>
        <span className="text-foreground font-heading">{formatMoney(r.bestSellPrice)}</span>
      </div>
    </div>
    <div className={`mt-1 pt-1 border-t border-zinc-700/30 font-heading font-bold text-[11px] ${(r.profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
      {(r.profit ?? 0) >= 0 ? '+' : ''}{formatMoney(r.profit)}<span className="text-[8px] text-zinc-500 font-normal">/unit</span>
    </div>
  </div>
);

const BestRoutesCard = ({ routes, title }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 bz-fade-in`}>
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        {title}
      </h2>
    </div>
    <div className="p-2">
      {routes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {routes.map((r, i) => (
            <RouteItem key={r.booze.id} r={r} delay={i * 0.05} />
          ))}
        </div>
      ) : (
        <div className="text-center py-4">
          <Wine size={16} className="mx-auto text-zinc-700 mb-1" />
          <p className="text-[9px] text-zinc-500 font-heading italic">No profitable routes this rotation</p>
        </div>
      )}
    </div>
  </div>
);

const RoundTripCard = ({ cityA, cityB, buyASellBRoutes, buyBSellARoutes }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 bz-fade-in`} style={{ animationDelay: '0.05s' }}>
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        Smuggling Route: {cityA} ↔ {cityB}
      </h2>
      <p className="text-[8px] text-zinc-500 mt-0.5 font-heading italic">Load up in one city, sell in the other — then reverse the run. Maximum profit both ways.</p>
    </div>
    <div className="p-2 space-y-2">
      <div>
        <h3 className="text-[9px] font-heading font-bold text-zinc-400 uppercase tracking-[0.1em] mb-1 flex items-center gap-1">
          <span className="text-primary">→</span> {cityA} to {cityB}
        </h3>
        {buyASellBRoutes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
            {buyASellBRoutes.map((r, i) => (
              <RouteItem key={`ab-${r.booze.id}`} r={r} delay={i * 0.05} />
            ))}
          </div>
        ) : (
          <p className="text-[9px] text-zinc-500 font-heading py-1 italic">No profitable cargo this direction</p>
        )}
      </div>
      <div className="bz-art-line text-primary" />
      <div>
        <h3 className="text-[9px] font-heading font-bold text-zinc-400 uppercase tracking-[0.1em] mb-1 flex items-center gap-1">
          <span className="text-primary">←</span> {cityB} to {cityA}
        </h3>
        {buyBSellARoutes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
            {buyBSellARoutes.map((r, i) => (
              <RouteItem key={`ba-${r.booze.id}`} r={r} delay={i * 0.05} />
            ))}
          </div>
        ) : (
          <p className="text-[9px] text-zinc-500 font-heading py-1 italic">No profitable cargo this direction</p>
        )}
      </div>
    </div>
  </div>
);

const CityPricesCard = ({ citySummary }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 bz-fade-in`} style={{ animationDelay: '0.1s' }}>
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        Black Market Prices
      </h2>
    </div>
    
    {/* Desktop: Table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-zinc-800/50 text-[8px] uppercase tracking-[0.1em] font-heading text-zinc-500 border-b border-zinc-700/40">
            <th className="text-left py-1.5 px-2">City</th>
            <th className="text-right py-1.5 px-2">Cheapest</th>
            <th className="text-right py-1.5 px-2">Priciest</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700/30">
          {citySummary.map((c, idx) => (
            <tr key={c.city} className="bz-row bz-fade-in" style={{ animationDelay: `${idx * 0.04}s` }}>
              <td className="py-1.5 px-2 font-heading font-bold text-foreground tracking-wide">{c.city}</td>
              <td className="py-1.5 px-2 text-right text-zinc-400 font-heading">
                {formatMoney(c.minPrice)} <span className="text-[8px] text-zinc-500">({c.lowestBooze})</span>
              </td>
              <td className="py-1.5 px-2 text-right text-zinc-400 font-heading">
                {formatMoney(c.maxPrice)} <span className="text-[8px] text-zinc-500">({c.highestBooze})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    
    {/* Mobile: Cards */}
    <div className="md:hidden divide-y divide-zinc-700/30">
      {citySummary.map((c, idx) => (
        <div key={c.city} className="p-2 bz-row bz-fade-in" style={{ animationDelay: `${idx * 0.04}s` }}>
          <div className="font-heading font-bold text-foreground text-[11px] mb-1 tracking-wide">{c.city}</div>
          <div className="space-y-0.5 text-[10px]">
            <div className="flex justify-between">
              <span className="text-zinc-500 text-[9px]">Cheapest:</span>
              <span className="font-heading text-foreground">
                {formatMoney(c.minPrice)} <span className="text-[8px] text-zinc-500">({c.lowestBooze})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 text-[9px]">Priciest:</span>
              <span className="font-heading text-foreground">
                {formatMoney(c.maxPrice)} <span className="text-[8px] text-zinc-500">({c.highestBooze})</span>
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const SuppliesCard = ({ 
  location, 
  supplies, 
  tradeAmounts, 
  setTradeAmount, 
  tradeMode, 
  setTradeMode, 
  handleBuy, 
  handleSell,
  capacity = 0,
  carryingTotal = 0,
  disabled = false,
}) => {
  const maxBuy = Math.max(0, capacity - carryingTotal);
  return (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 bz-fade-in`} style={{ animationDelay: '0.15s' }}>
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        The Warehouse — {location}
      </h2>
      <span className="text-[8px] text-zinc-500 font-heading">{carryingTotal}/{capacity} loaded</span>
    </div>
    
    {/* Desktop: Table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-zinc-800/50 text-[8px] uppercase tracking-[0.1em] font-heading text-zinc-500 border-b border-zinc-700/40">
            <th className="text-left py-1.5 px-2">Liquor</th>
            <th className="text-right py-1.5 px-2">Price</th>
            <th className="text-right py-1.5 px-2">Stash</th>
            <th className="text-right py-1.5 px-2">Quantity</th>
            <th className="text-right py-1.5 px-2">Trade</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700/30">
          {supplies.map((row, idx) => {
            const amount = tradeAmounts[row.booze_id] ?? '';
            const maxSell = row.carrying ?? 0;
            const placeholder = tradeMode === 'buy' ? (maxBuy > 0 ? String(maxBuy) : '0') : (maxSell > 0 ? String(maxSell) : '0');
            const isBuy = tradeMode === 'buy';
            const tradeDisabled = disabled || (isBuy ? false : !(row.carrying > 0));
            return (
            <tr key={row.booze_id} className="bz-row bz-fade-in" style={{ animationDelay: `${idx * 0.03}s` }}>
              <td className="py-1.5 px-2 font-heading font-bold text-foreground tracking-wide">{row.name}</td>
              <td className="py-1.5 px-2 text-right text-zinc-400 font-heading tabular-nums">
                {formatMoney(row.buy_price)}
              </td>
              <td className="py-1.5 px-2 text-right font-heading font-bold text-foreground tabular-nums">
                {row.carrying ?? 0}
              </td>
              <td className="py-1.5 px-2 text-right">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={placeholder}
                  value={amount}
                  onChange={(e) => setTradeAmount(row.booze_id, e.target.value)}
                  onFocus={() => setTradeAmount(row.booze_id, isBuy ? String(maxBuy) : String(maxSell))}
                  className="w-14 text-right bg-zinc-900/80 border border-zinc-600/40 rounded px-1 py-0.5 text-[10px] font-heading focus:border-primary/50 focus:outline-none transition-colors"
                />
              </td>
              <td className="py-1.5 px-2 text-right">
                <div className="flex items-center justify-end gap-0.5">
                  <div className="flex rounded overflow-hidden border border-zinc-600/40">
                    <button
                      type="button"
                      onClick={() => setTradeMode('buy')}
                      className={`px-1.5 py-0.5 text-[9px] font-heading font-bold uppercase tracking-wider transition-all ${tradeMode === 'buy' ? 'bg-primary/30 border-primary/40 text-primary' : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-300'}`}
                    >
                      Buy
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeMode('sell')}
                      className={`px-1.5 py-0.5 text-[9px] font-heading font-bold uppercase tracking-wider transition-all ${tradeMode === 'sell' ? 'bg-primary/30 border-primary/40 text-primary' : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-300'}`}
                    >
                      Sell
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      const qty = typeof amount === 'number' ? amount : parseInt(String(amount || ''), 10);
                      const val = (!qty || qty <= 0) ? undefined : qty;
                      isBuy ? handleBuy(row.booze_id, val) : handleSell(row.booze_id, val);
                    }}
                    disabled={tradeDisabled}
                    className="px-1.5 py-0.5 rounded text-[9px] font-heading font-bold uppercase tracking-wider border transition-all bg-primary/20 border-primary/40 text-primary hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Trade
                  </button>
                </div>
              </td>
            </tr>
          );})}
        </tbody>
      </table>
    </div>
    
    {/* Mobile: Cards */}
    <div className="md:hidden divide-y divide-zinc-700/30">
      {supplies.map((row, idx) => {
        const amount = tradeAmounts[row.booze_id] ?? '';
        const maxSell = row.carrying ?? 0;
        const isBuy = tradeMode === 'buy';
        const tradeDisabled = disabled || (isBuy ? false : !(row.carrying > 0));
        return (
        <div key={row.booze_id} className="p-2 space-y-1 bz-row bz-fade-in" style={{ animationDelay: `${idx * 0.04}s` }}>
          <div className="flex items-start justify-between gap-1.5">
            <div>
              <div className="font-heading font-bold text-foreground text-[11px] tracking-wide">{row.name}</div>
              <div className="text-[9px] text-zinc-500 font-heading">
                Stash: <span className="text-foreground font-bold">{row.carrying ?? 0}</span>
              </div>
            </div>
            <div className="text-right text-[10px]">
              <div className="text-zinc-400 font-heading">{formatMoney(row.buy_price)}</div>
            </div>
          </div>
          
          <div className="flex gap-1 items-center">
            <input
              type="text"
              inputMode="numeric"
              placeholder={isBuy ? 'Buy qty' : 'Sell qty'}
              value={amount}
              onChange={(e) => setTradeAmount(row.booze_id, e.target.value)}
              onFocus={() => setTradeAmount(row.booze_id, isBuy ? String(maxBuy) : String(maxSell))}
              className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded px-2 py-1 text-[10px] font-heading focus:border-primary/50 focus:outline-none transition-colors"
            />
            <div className="flex rounded overflow-hidden border border-zinc-600/40 shrink-0">
              <button
                type="button"
                onClick={() => setTradeMode('buy')}
                className={`px-2 py-1 text-[9px] font-heading font-bold uppercase tracking-wider transition-all ${tradeMode === 'buy' ? 'bg-primary/30 text-primary' : 'bg-zinc-800/60 text-zinc-400'}`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setTradeMode('sell')}
                className={`px-2 py-1 text-[9px] font-heading font-bold uppercase tracking-wider transition-all ${tradeMode === 'sell' ? 'bg-primary/30 text-primary' : 'bg-zinc-800/60 text-zinc-400'}`}
              >
                Sell
              </button>
            </div>
            <button
              onClick={() => {
                const qty = typeof amount === 'number' ? amount : parseInt(String(amount || ''), 10);
                const val = (!qty || qty <= 0) ? undefined : qty;
                isBuy ? handleBuy(row.booze_id, val) : handleSell(row.booze_id, val);
              }}
              disabled={tradeDisabled}
              className="py-1 px-2 rounded font-heading font-bold uppercase text-[9px] tracking-wider border transition-all touch-manipulation bg-primary/20 border-primary/40 text-primary hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              Trade
            </button>
          </div>
        </div>
      );})}
    </div>
  </div>
  );
};

const HistoryCard = ({ history }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 bz-fade-in`} style={{ animationDelay: '0.2s' }}>
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        The Ledger
      </h2>
      <span className="text-[8px] font-heading text-zinc-500">{history.length} entries</span>
    </div>
    
    {history.length === 0 ? (
      <div className="p-4 text-center">
        <Wine size={18} className="mx-auto text-zinc-700 mb-1" />
        <p className="text-[9px] text-zinc-500 font-heading italic">No transactions recorded yet</p>
        <p className="text-[8px] text-zinc-600 font-heading mt-0.5">Make your first run to start the books</p>
      </div>
    ) : (
      <>
        {/* Desktop: Table */}
        <div className="hidden md:block overflow-x-auto max-h-40 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-zinc-800/50 text-[8px] uppercase tracking-[0.1em] font-heading text-zinc-500 border-b border-zinc-700/40 sticky top-0">
                <th className="text-left py-1.5 px-2">Time</th>
                <th className="text-left py-1.5 px-2">Action</th>
                <th className="text-left py-1.5 px-2">Liquor</th>
                <th className="text-right py-1.5 px-2">Qty</th>
                <th className="text-right py-1.5 px-2">Price</th>
                <th className="text-right py-1.5 px-2">Total</th>
                <th className="text-right py-1.5 px-2">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700/30">
              {history.map((h, i) => {
                const at = h.at ? new Date(h.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
                const isSell = h.action === 'sell';
                
                return (
                  <tr key={i} className="bz-row">
                    <td className="py-1.5 px-2 text-zinc-500 font-heading text-[9px]">{at}</td>
                    <td className="py-1.5 px-2">
                      <span className={`font-heading font-bold text-[9px] uppercase tracking-wider px-1 py-0.5 rounded ${isSell ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-300 bg-zinc-700/30'}`}>
                        {isSell ? 'Sold' : 'Bought'}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-foreground font-heading">{h.booze_name ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right font-heading font-bold tabular-nums">{h.amount ?? 0}</td>
                    <td className="py-1.5 px-2 text-right text-zinc-400 font-heading tabular-nums">
                      {formatMoney(h.unit_price)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-heading font-bold text-foreground tabular-nums">
                      {formatMoney(h.total)}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {isSell && h.profit != null ? (
                        <span className={`font-heading font-bold tabular-nums text-[10px] ${
                          h.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {h.profit >= 0 ? '+' : ''}{formatMoney(h.profit)}
                        </span>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Mobile: Cards */}
        <div className="md:hidden divide-y divide-zinc-700/30 max-h-40 overflow-y-auto">
          {history.map((h, i) => {
            const at = h.at ? new Date(h.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const isSell = h.action === 'sell';
            
            return (
              <div key={i} className="p-2 space-y-0.5 bz-row">
                <div className="flex items-start justify-between gap-1.5">
                  <div>
                    <div className={`font-heading font-bold text-[11px] ${isSell ? 'text-emerald-400' : 'text-foreground'}`}>
                      {isSell ? 'Sold' : 'Bought'} {h.booze_name ?? '—'}
                    </div>
                    <div className="text-[9px] text-zinc-500 font-heading">{at}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading font-bold text-foreground text-[11px]">{formatMoney(h.total)}</div>
                    {isSell && h.profit != null && (
                      <div className={`text-[9px] font-heading font-bold ${
                        h.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {h.profit >= 0 ? '+' : ''}{formatMoney(h.profit)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 text-[9px] text-zinc-500">
                  <span>Qty: <span className="text-foreground font-bold">{h.amount ?? 0}</span></span>
                  <span>@ {formatMoney(h.unit_price)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </>
    )}
  </div>
);

const InfoCard = ({ rotationHours, rotationSeconds, dailyEstimateRough }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-zinc-700/30 bz-fade-in`} style={{ animationDelay: '0.25s' }}>
    <div className="px-2.5 py-1.5 border-b border-zinc-700/30">
      <h3 className="text-[9px] font-heading font-bold text-zinc-400 uppercase tracking-[0.12em]">
        Bootlegger's Guide
      </h3>
    </div>
    <div className="p-2">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-zinc-400 font-heading">
        <li className="flex items-start gap-1">
          <Clock size={8} className="text-primary shrink-0 mt-0.5" />
          <span>Prices rotate every <strong className="text-foreground">{rotationSeconds != null && rotationSeconds > 0 ? `${rotationSeconds}s` : `${rotationHours ?? 3}h`}</strong></span>
        </li>
        <li className="flex items-start gap-1">
          <MapPin size={8} className="text-primary shrink-0 mt-0.5" />
          <span>Must travel by car while carrying cargo</span>
        </li>
        <li className="flex items-start gap-1">
          <Package size={8} className="text-primary shrink-0 mt-0.5" />
          <span>Cargo capacity increases with rank; upgrade in Points Store</span>
        </li>
        {dailyEstimateRough != null && dailyEstimateRough > 0 && (
          <li className="flex items-start gap-1">
            <TrendingUp size={8} className="text-emerald-400 shrink-0 mt-0.5" />
            <span>24h estimate (custom car, best route, non-stop): <strong className="text-emerald-400">~${Number(dailyEstimateRough).toLocaleString()}</strong></span>
          </li>
        )}
        <li className="flex items-start gap-1 md:col-span-2">
          <span className="text-amber-400 shrink-0 mt-0.5 text-[9px]">⚠</span>
          <span className="text-amber-400/80">Bigger shipments attract more heat from the Feds — higher amounts means higher bust risk!</span>
        </li>
      </ul>
    </div>
  </div>
);

// Main component
export default function BoozeRun() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tradeAmounts, setTradeAmounts] = useState({});
  const [tradeMode, setTradeMode] = useState('buy');
  const [timer, setTimer] = useState('');
  const [autoRankBoozeDisabled, setAutoRankBoozeDisabled] = useState(false);

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
    api.get('/auto-rank/me').then((r) => setAutoRankBoozeDisabled(!!r.data?.auto_rank_booze)).catch(() => setAutoRankBoozeDisabled(false));
  }, []);

  const rotationEndRef = useRef(null);
  useEffect(() => {
    if (!config?.rotation_ends_at) return;
    const tick = () => {
      const end = new Date(config.rotation_ends_at).getTime();
      const now = Date.now();
      if (end <= now) {
        if (rotationEndRef.current !== config.rotation_ends_at) {
          rotationEndRef.current = config.rotation_ends_at;
          fetchConfig();
          toast.success('Prices rotated — new rates and best routes');
        }
        setTimer('00:00:00');
        return;
      }
      setTimer(timeUntil(config.rotation_ends_at));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [config?.rotation_ends_at, fetchConfig]);

  const setTradeAmount = (boozeId, value) => {
    const n = parseInt(String(value).replace(/\D/g, ''), 10);
    setTradeAmounts((prev) => ({ ...prev, [boozeId]: isNaN(n) ? '' : n }));
  };

  const handleBuy = async (boozeId, amountOverride) => {
    const maxBuy = Math.max(0, (config?.capacity ?? 0) - (config?.carrying_total ?? 0));
    const amount = amountOverride ?? tradeAmounts[boozeId] ?? maxBuy;
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
      setTradeAmounts((prev) => ({ ...prev, [boozeId]: '' }));
      fetchConfig();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Purchase failed'));
    }
  };

  const handleSell = async (boozeId, amountOverride) => {
    const row = config?.prices_at_location?.find((p) => p.booze_id === boozeId);
    const maxSell = row?.carrying ?? 0;
    const amount = amountOverride ?? tradeAmounts[boozeId] ?? maxSell;
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
      setTradeAmounts((prev) => ({ ...prev, [boozeId]: '' }));
      fetchConfig();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Sell failed'));
    }
  };

  if (loading || !config) {
    return <LoadingSpinner />;
  }

  const historyList = config.history || [];
  const pricesAtLocation = config.prices_at_location || [];

  // Consider all 4 cities: for every (buy city, sell city) pair compute best profit and pick the best pair overall.
  const allByLocation = config.all_prices_by_location || {};
  const currentLocation = config.current_location || '';
  const cities = Object.keys(allByLocation);

  // One round-trip per rotation: use server's round_trip_cities so there's always one route there and back
  const roundTripCities = config.round_trip_cities && config.round_trip_cities.length === 2 ? config.round_trip_cities : null;
  const cityA = roundTripCities ? roundTripCities[0] : '';
  const cityB = roundTripCities ? roundTripCities[1] : '';

  const buyASellBRoutes = (config.booze_types || [])
    .map((bt) => {
      const buyItem = allByLocation[cityA]?.find((p) => p.booze_id === bt.id);
      const sellItem = allByLocation[cityB]?.find((p) => p.booze_id === bt.id);
      const buyPrice = buyItem?.buy_price ?? Infinity;
      const sellPrice = sellItem?.sell_price ?? -1;
      const profit = (typeof sellPrice === 'number' && typeof buyPrice === 'number' && sellPrice > buyPrice) ? sellPrice - buyPrice : -Infinity;
      return { booze: bt, bestBuyCity: cityA, bestBuyPrice: buyPrice, bestSellCity: cityB, bestSellPrice: sellPrice, profit };
    })
    .filter((r) => r.profit > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 3);

  const buyBSellARoutes = (config.booze_types || [])
    .map((bt) => {
      const buyItem = allByLocation[cityB]?.find((p) => p.booze_id === bt.id);
      const sellItem = allByLocation[cityA]?.find((p) => p.booze_id === bt.id);
      const buyPrice = buyItem?.buy_price ?? Infinity;
      const sellPrice = sellItem?.sell_price ?? -1;
      const profit = (typeof sellPrice === 'number' && typeof buyPrice === 'number' && sellPrice > buyPrice) ? sellPrice - buyPrice : -Infinity;
      return { booze: bt, bestBuyCity: cityB, bestBuyPrice: buyPrice, bestSellCity: cityA, bestSellPrice: sellPrice, profit };
    })
    .filter((r) => r.profit > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 3);

  // Per-city summary: lowest and highest price (one price per booze — profit = sell in pricier city than you bought)
  const citySummary = Object.entries(allByLocation).map(([city, list]) => {
    const minPrice = Math.min(...list.map((p) => p.buy_price));
    const maxPrice = Math.max(...list.map((p) => p.sell_price));
    const lowestBooze = list.find((p) => p.buy_price === minPrice);
    const highestBooze = list.find((p) => p.sell_price === maxPrice);
    return { city, minPrice, maxPrice, lowestBooze: lowestBooze?.name, highestBooze: highestBooze?.name };
  });

  return (
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="booze-run-page">
      <style>{BOOZE_STYLES}</style>

      {/* ── Page Header ── */}
      <div className="relative bz-fade-in">
        <p className="text-[9px] text-zinc-500 font-heading italic">Buy low, smuggle fast, sell high — and pray the Feds don't catch you.</p>
      </div>

      {autoRankBoozeDisabled && <AutoRankBoozeNotice />}
      <StatsCard config={config} timer={timer} />

      {roundTripCities && (
        <RoundTripCard
          cityA={cityA}
          cityB={cityB}
          buyASellBRoutes={buyASellBRoutes}
          buyBSellARoutes={buyBSellARoutes}
        />
      )}

      <CityPricesCard citySummary={citySummary} />

      <SuppliesCard
        location={config.current_location}
        supplies={pricesAtLocation}
        tradeAmounts={tradeAmounts}
        setTradeAmount={setTradeAmount}
        tradeMode={tradeMode}
        setTradeMode={setTradeMode}
        handleBuy={handleBuy}
        handleSell={handleSell}
        capacity={config.capacity ?? 0}
        carryingTotal={config.carrying_total ?? 0}
        disabled={autoRankBoozeDisabled}
      />

      <HistoryCard history={historyList} />

      <InfoCard rotationHours={config.rotation_hours} rotationSeconds={config.rotation_seconds} dailyEstimateRough={config.daily_estimate_rough} />
    </div>
  );
}
