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
  <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
    <Wine size={28} className="text-primary/40 animate-pulse" />
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading the shipment...</span>
  </div>
);

const AutoRankBoozeNotice = () => (
  <div className={`relative p-3 ${styles.panel} border border-amber-500/30 rounded-lg overflow-hidden bz-fade-in`}>
    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-500/50" />
    <div className="flex items-center gap-2.5">
      <Bot size={15} className="text-amber-400 shrink-0" />
      <div>
        <span className="text-[10px] font-heading font-bold text-amber-300 uppercase tracking-wider">Auto Rank Active</span>
        <p className="text-[10px] text-amber-200/60 font-heading mt-0.5">Booze running is automated — buy, travel, sell. Manual trading disabled.</p>
      </div>
    </div>
  </div>
);

const StatsCard = ({ config, timer }) => {
  const capacity = config.capacity ?? 0;
  const carryingTotal = config.carrying_total ?? 0;
  const pctFull = capacity > 0 ? (carryingTotal / capacity) * 100 : 0;
  
  return (
    <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bz-corner bz-scale-in`}>
      <div className="absolute top-0 left-0 w-28 h-28 bg-primary/5 rounded-full blur-3xl pointer-events-none bz-glow" />
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="p-4 grid grid-cols-3 md:grid-cols-6 gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-[0.15em] font-heading">
            <Clock size={10} className="text-primary" />
            Rotation
          </div>
          <div className={`text-sm font-heading font-bold tabular-nums ${timer === '00:00:00' ? 'text-amber-400 bz-timer-pulse' : 'text-foreground'}`}>{timer}</div>
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-[0.15em] font-heading">
            <MapPin size={10} className="text-primary" />
            Your City
          </div>
          <div className="text-sm font-heading font-bold text-primary truncate">{config.current_location}</div>
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-[0.15em] font-heading">
            <Package size={10} className="text-primary" />
            Cargo
          </div>
          <div className="text-sm font-heading font-bold text-foreground tabular-nums">
            {carryingTotal} / {capacity}
          </div>
          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${pctFull > 80 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pctFull}%` }} />
          </div>
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-[0.15em] font-heading">
            <DollarSign size={10} className="text-primary" />
            Today's Take
          </div>
          <div className={`text-sm font-heading font-bold tabular-nums ${
            (config.profit_today ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {formatMoney(config.profit_today)}
          </div>
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-[0.15em] font-heading">
            <TrendingUp size={10} className="text-primary" />
            Total Profit
          </div>
          <div className={`text-sm font-heading font-bold tabular-nums ${
            (config.profit_total ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {formatMoney(config.profit_total)}
          </div>
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-[0.15em] font-heading">
            <ShoppingCart size={10} className="text-primary" />
            Runs Made
          </div>
          <div className="text-sm font-heading font-bold text-foreground tabular-nums">
            {config.runs_count ?? 0}
          </div>
        </div>
      </div>
      <div className="bz-art-line text-primary mx-4" />
    </div>
  );
};

const RouteItem = ({ r, delay = 0 }) => (
  <div className="relative bg-zinc-800/40 rounded-lg p-2.5 border border-zinc-700/30 bz-card bz-fade-in overflow-hidden" style={{ animationDelay: `${delay}s` }}>
    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />
    <div className="font-heading font-bold text-foreground text-sm mb-1.5 tracking-wide">{r.booze.name}</div>
    <div className="text-[11px] text-zinc-400 font-heading space-y-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-zinc-500 uppercase w-7">Buy</span>
        <span className="text-primary font-bold">{r.bestBuyCity}</span>
        <span className="text-zinc-600 mx-0.5">—</span>
        <span className="text-foreground font-heading">{formatMoney(r.bestBuyPrice)}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-zinc-500 uppercase w-7">Sell</span>
        <span className="text-primary font-bold">{r.bestSellCity}</span>
        <span className="text-zinc-600 mx-0.5">—</span>
        <span className="text-foreground font-heading">{formatMoney(r.bestSellPrice)}</span>
      </div>
    </div>
    <div className={`mt-2 pt-1.5 border-t border-zinc-700/30 font-heading font-bold text-sm ${(r.profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
      {(r.profit ?? 0) >= 0 ? '+' : ''}{formatMoney(r.profit)}<span className="text-[10px] text-zinc-500 font-normal">/unit</span>
    </div>
  </div>
);

const BestRoutesCard = ({ routes, title }) => (
  <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 bz-fade-in`}>
    <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
        {title}
      </h2>
    </div>
    <div className="p-2.5">
      {routes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {routes.map((r, i) => (
            <RouteItem key={r.booze.id} r={r} delay={i * 0.05} />
          ))}
        </div>
      ) : (
        <div className="text-center py-6">
          <Wine size={20} className="mx-auto text-zinc-700 mb-2" />
          <p className="text-[10px] text-zinc-500 font-heading italic">No profitable routes this rotation</p>
        </div>
      )}
    </div>
  </div>
);

const RoundTripCard = ({ cityA, cityB, buyASellBRoutes, buyBSellARoutes }) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bz-fade-in`} style={{ animationDelay: '0.05s' }}>
    <div className="px-4 py-3 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
        Smuggling Route: {cityA} ↔ {cityB}
      </h2>
      <p className="text-[9px] text-zinc-500 mt-0.5 font-heading italic">Load up in one city, sell in the other — then reverse the run. Maximum profit both ways.</p>
    </div>
    <div className="p-3 space-y-4">
      <div>
        <h3 className="text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-[0.12em] mb-2 flex items-center gap-1.5">
          <span className="text-primary">→</span> {cityA} to {cityB}
        </h3>
        {buyASellBRoutes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {buyASellBRoutes.map((r, i) => (
              <RouteItem key={`ab-${r.booze.id}`} r={r} delay={i * 0.05} />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-zinc-500 font-heading py-2 italic">No profitable cargo this direction</p>
        )}
      </div>
      <div className="bz-art-line text-primary" />
      <div>
        <h3 className="text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-[0.12em] mb-2 flex items-center gap-1.5">
          <span className="text-primary">←</span> {cityB} to {cityA}
        </h3>
        {buyBSellARoutes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {buyBSellARoutes.map((r, i) => (
              <RouteItem key={`ba-${r.booze.id}`} r={r} delay={i * 0.05} />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-zinc-500 font-heading py-2 italic">No profitable cargo this direction</p>
        )}
      </div>
    </div>
  </div>
);

const CityPricesCard = ({ citySummary }) => (
  <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 bz-fade-in`} style={{ animationDelay: '0.1s' }}>
    <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
        Black Market Prices
      </h2>
    </div>
    
    {/* Desktop: Table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-zinc-800/50 text-[9px] uppercase tracking-[0.12em] font-heading text-zinc-500 border-b border-zinc-700/40">
            <th className="text-left py-2 px-4">City</th>
            <th className="text-right py-2 px-4">Cheapest</th>
            <th className="text-right py-2 px-4">Priciest</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700/30">
          {citySummary.map((c, idx) => (
            <tr key={c.city} className="bz-row bz-fade-in" style={{ animationDelay: `${idx * 0.04}s` }}>
              <td className="py-2 px-4 font-heading font-bold text-foreground tracking-wide">{c.city}</td>
              <td className="py-2 px-4 text-right text-zinc-400 font-heading">
                {formatMoney(c.minPrice)} <span className="text-[9px] text-zinc-500">({c.lowestBooze})</span>
              </td>
              <td className="py-2 px-4 text-right text-zinc-400 font-heading">
                {formatMoney(c.maxPrice)} <span className="text-[9px] text-zinc-500">({c.highestBooze})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    
    {/* Mobile: Cards */}
    <div className="md:hidden divide-y divide-zinc-700/30">
      {citySummary.map((c, idx) => (
        <div key={c.city} className="p-3 bz-row bz-fade-in" style={{ animationDelay: `${idx * 0.04}s` }}>
          <div className="font-heading font-bold text-foreground text-sm mb-1.5 tracking-wide">{c.city}</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500 text-[10px]">Cheapest:</span>
              <span className="font-heading text-foreground">
                {formatMoney(c.minPrice)} <span className="text-[9px] text-zinc-500">({c.lowestBooze})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 text-[10px]">Priciest:</span>
              <span className="font-heading text-foreground">
                {formatMoney(c.maxPrice)} <span className="text-[9px] text-zinc-500">({c.highestBooze})</span>
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
  buyAmounts, 
  sellAmounts, 
  setBuyAmount, 
  setSellAmount, 
  handleBuy, 
  handleSell,
  capacity = 0,
  carryingTotal = 0,
  disabled = false,
}) => {
  const maxBuy = Math.max(0, capacity - carryingTotal);
  return (
  <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 bz-fade-in`} style={{ animationDelay: '0.15s' }}>
    <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
        The Warehouse — {location}
      </h2>
      <span className="text-[9px] text-zinc-500 font-heading">{carryingTotal}/{capacity} loaded</span>
    </div>
    
    {/* Desktop: Table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-zinc-800/50 text-[9px] uppercase tracking-[0.12em] font-heading text-zinc-500 border-b border-zinc-700/40">
            <th className="text-left py-2 px-4">Liquor</th>
            <th className="text-right py-2 px-4">Price</th>
            <th className="text-right py-2 px-4">Stash</th>
            <th className="text-right py-2 px-4">Quantity</th>
            <th className="text-right py-2 px-4">Trade</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700/30">
          {supplies.map((row, idx) => (
            <tr key={row.booze_id} className="bz-row bz-fade-in" style={{ animationDelay: `${idx * 0.03}s` }}>
              <td className="py-2 px-4 font-heading font-bold text-foreground tracking-wide">{row.name}</td>
              <td className="py-2 px-4 text-right text-zinc-400 font-heading tabular-nums">
                {formatMoney(row.buy_price)}
              </td>
              <td className="py-2 px-4 text-right font-heading font-bold text-foreground tabular-nums">
                {row.carrying ?? 0}
              </td>
              <td className="py-2 px-4 text-right">
                <div className="flex items-center justify-end gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Buy"
                    value={buyAmounts[row.booze_id] ?? ''}
                    onChange={(e) => setBuyAmount(row.booze_id, e.target.value)}
                    onFocus={() => setBuyAmount(row.booze_id, String(maxBuy))}
                    className="w-14 text-right bg-zinc-900/80 border border-zinc-600/40 rounded-md px-1.5 py-1 text-xs font-heading focus:border-primary/50 focus:outline-none transition-colors"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Sell"
                    value={sellAmounts[row.booze_id] ?? ''}
                    onChange={(e) => setSellAmount(row.booze_id, e.target.value)}
                    onFocus={() => setSellAmount(row.booze_id, String(row.carrying ?? 0))}
                    className="w-14 text-right bg-zinc-900/80 border border-zinc-600/40 rounded-md px-1.5 py-1 text-xs font-heading focus:border-primary/50 focus:outline-none transition-colors"
                  />
                </div>
              </td>
              <td className="py-2 px-4 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => handleBuy(row.booze_id)}
                    disabled={disabled}
                    className="px-2.5 py-1 rounded-md text-[10px] font-heading font-bold uppercase tracking-wider border transition-all bg-primary/20 border-primary/40 text-primary hover:bg-primary/30 hover:shadow-sm hover:shadow-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => handleSell(row.booze_id)}
                    disabled={disabled || !(row.carrying > 0)}
                    className="px-2.5 py-1 rounded-md text-[10px] font-heading font-bold uppercase tracking-wider border transition-all bg-zinc-800/60 border-zinc-600/40 text-zinc-300 hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Sell
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    
    {/* Mobile: Cards */}
    <div className="md:hidden divide-y divide-zinc-700/30">
      {supplies.map((row, idx) => (
        <div key={row.booze_id} className="p-3 space-y-2 bz-row bz-fade-in" style={{ animationDelay: `${idx * 0.04}s` }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-heading font-bold text-foreground text-sm tracking-wide">{row.name}</div>
              <div className="text-[10px] text-zinc-500 font-heading">
                Stash: <span className="text-foreground font-bold">{row.carrying ?? 0}</span>
              </div>
            </div>
            <div className="text-right text-xs">
              <div className="text-zinc-400 font-heading">{formatMoney(row.buy_price)}</div>
            </div>
          </div>
          
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Buy qty"
              value={buyAmounts[row.booze_id] ?? ''}
              onChange={(e) => setBuyAmount(row.booze_id, e.target.value)}
              onFocus={() => setBuyAmount(row.booze_id, String(maxBuy))}
              className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2.5 py-1.5 text-xs font-heading focus:border-primary/50 focus:outline-none transition-colors"
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Sell qty"
              value={sellAmounts[row.booze_id] ?? ''}
              onChange={(e) => setSellAmount(row.booze_id, e.target.value)}
              onFocus={() => setSellAmount(row.booze_id, String(row.carrying ?? 0))}
              className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2.5 py-1.5 text-xs font-heading focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => handleBuy(row.booze_id)}
              disabled={disabled}
              className="flex-1 py-2 rounded-lg font-heading font-bold uppercase text-[10px] tracking-wider border-2 transition-all touch-manipulation bg-gradient-to-b from-primary/25 to-primary/10 border-primary/40 text-primary hover:from-primary/35 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Buy
            </button>
            <button
              onClick={() => handleSell(row.booze_id)}
              disabled={disabled || !(row.carrying > 0)}
              className="flex-1 py-2 rounded-lg font-heading font-bold uppercase text-[10px] tracking-wider border transition-all touch-manipulation bg-zinc-800/60 border-zinc-600/40 text-zinc-300 hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Sell
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
  );
};

const HistoryCard = ({ history }) => (
  <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 bz-fade-in`} style={{ animationDelay: '0.2s' }}>
    <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
      <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
        The Ledger
      </h2>
      <span className="text-[9px] font-heading text-zinc-500">{history.length} entries</span>
    </div>
    
    {history.length === 0 ? (
      <div className="p-6 text-center">
        <Wine size={24} className="mx-auto text-zinc-700 mb-2" />
        <p className="text-[10px] text-zinc-500 font-heading italic">No transactions recorded yet</p>
        <p className="text-[9px] text-zinc-600 font-heading mt-0.5">Make your first run to start the books</p>
      </div>
    ) : (
      <>
        {/* Desktop: Table */}
        <div className="hidden md:block overflow-x-auto max-h-52 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-800/50 text-[9px] uppercase tracking-[0.12em] font-heading text-zinc-500 border-b border-zinc-700/40 sticky top-0">
                <th className="text-left py-2 px-4">Time</th>
                <th className="text-left py-2 px-4">Action</th>
                <th className="text-left py-2 px-4">Liquor</th>
                <th className="text-right py-2 px-4">Qty</th>
                <th className="text-right py-2 px-4">Price</th>
                <th className="text-right py-2 px-4">Total</th>
                <th className="text-right py-2 px-4">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700/30">
              {history.map((h, i) => {
                const at = h.at ? new Date(h.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
                const isSell = h.action === 'sell';
                
                return (
                  <tr key={i} className="bz-row">
                    <td className="py-2 px-4 text-zinc-500 font-heading text-[10px]">{at}</td>
                    <td className="py-2 px-4">
                      <span className={`font-heading font-bold text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${isSell ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-300 bg-zinc-700/30'}`}>
                        {isSell ? 'Sold' : 'Bought'}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-foreground font-heading">{h.booze_name ?? '—'}</td>
                    <td className="py-2 px-4 text-right font-heading font-bold tabular-nums">{h.amount ?? 0}</td>
                    <td className="py-2 px-4 text-right text-zinc-400 font-heading tabular-nums">
                      {formatMoney(h.unit_price)}
                    </td>
                    <td className="py-2 px-4 text-right font-heading font-bold text-foreground tabular-nums">
                      {formatMoney(h.total)}
                    </td>
                    <td className="py-2 px-4 text-right">
                      {isSell && h.profit != null ? (
                        <span className={`font-heading font-bold tabular-nums ${
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
        <div className="md:hidden divide-y divide-zinc-700/30 max-h-52 overflow-y-auto">
          {history.map((h, i) => {
            const at = h.at ? new Date(h.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const isSell = h.action === 'sell';
            
            return (
              <div key={i} className="p-3 space-y-1 bz-row">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className={`font-heading font-bold text-sm ${isSell ? 'text-emerald-400' : 'text-foreground'}`}>
                      {isSell ? 'Sold' : 'Bought'} {h.booze_name ?? '—'}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-heading">{at}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading font-bold text-foreground text-sm">{formatMoney(h.total)}</div>
                    {isSell && h.profit != null && (
                      <div className={`text-[10px] font-heading font-bold ${
                        h.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {h.profit >= 0 ? '+' : ''}{formatMoney(h.profit)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 text-xs text-zinc-500">
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
  <div className={`${styles.panel} rounded-lg overflow-hidden border border-zinc-700/30 bz-fade-in`} style={{ animationDelay: '0.25s' }}>
    <div className="px-4 py-2.5 border-b border-zinc-700/30">
      <h3 className="text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-[0.15em]">
        Bootlegger's Guide
      </h3>
    </div>
    <div className="p-4">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-[11px] text-zinc-400 font-heading">
        <li className="flex items-start gap-2">
          <Clock size={10} className="text-primary shrink-0 mt-0.5" />
          <span>Prices rotate every <strong className="text-foreground">{rotationSeconds != null && rotationSeconds > 0 ? `${rotationSeconds}s` : `${rotationHours ?? 3}h`}</strong></span>
        </li>
        <li className="flex items-start gap-2">
          <MapPin size={10} className="text-primary shrink-0 mt-0.5" />
          <span>Must travel by car while carrying cargo</span>
        </li>
        <li className="flex items-start gap-2">
          <Package size={10} className="text-primary shrink-0 mt-0.5" />
          <span>Cargo capacity increases with rank; upgrade in Points Store</span>
        </li>
        {dailyEstimateRough != null && dailyEstimateRough > 0 && (
          <li className="flex items-start gap-2">
            <TrendingUp size={10} className="text-emerald-400 shrink-0 mt-0.5" />
            <span>24h estimate (custom car, best route, non-stop): <strong className="text-emerald-400">~${Number(dailyEstimateRough).toLocaleString()}</strong></span>
          </li>
        )}
        <li className="flex items-start gap-2 md:col-span-2">
          <span className="text-amber-400 shrink-0 mt-0.5 text-[10px]">⚠</span>
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
  const [buyAmounts, setBuyAmounts] = useState({});
  const [sellAmounts, setSellAmounts] = useState({});
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

  const setBuyAmount = (boozeId, value) => {
    const n = parseInt(String(value).replace(/\D/g, ''), 10);
    setBuyAmounts((prev) => ({ ...prev, [boozeId]: isNaN(n) ? '' : n }));
  };
  
  const setSellAmount = (boozeId, value) => {
    const n = parseInt(String(value).replace(/\D/g, ''), 10);
    setSellAmounts((prev) => ({ ...prev, [boozeId]: isNaN(n) ? '' : n }));
  };

  const handleBuy = async (boozeId) => {
    const maxBuy = Math.max(0, (config?.capacity ?? 0) - (config?.carrying_total ?? 0));
    const amount = buyAmounts[boozeId] ?? maxBuy;
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
    const row = config?.prices_at_location?.find((p) => p.booze_id === boozeId);
    const maxSell = row?.carrying ?? 0;
    const amount = sellAmounts[boozeId] ?? maxSell;
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
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="booze-run-page">
      <style>{BOOZE_STYLES}</style>

      {/* ── Page Header ── */}
      <div className="relative bz-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Prohibition Era</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">
          The Rum Run
        </h1>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">Buy low, smuggle fast, sell high — and pray the Feds don't catch you.</p>
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
        buyAmounts={buyAmounts}
        sellAmounts={sellAmounts}
        setBuyAmount={setBuyAmount}
        setSellAmount={setSellAmount}
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
