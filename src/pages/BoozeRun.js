import { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Package, Clock, Wine, TrendingUp, DollarSign, ShoppingCart } from 'lucide-react';
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

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const StatsCard = ({ config, timer }) => {
  const capacity = config.capacity ?? 0;
  const carryingTotal = config.carrying_total ?? 0;
  
  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
        <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
          📊 Overview
        </h2>
      </div>
      <div className="p-3 grid grid-cols-3 md:grid-cols-6 gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-mutedForeground">
            <Clock size={12} className="text-primary" />
            <span className="text-[10px] font-heading">Rotation</span>
          </div>
          <div className="text-sm font-heading font-bold text-foreground tabular-nums">{timer}</div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-mutedForeground">
            <MapPin size={12} className="text-primary" />
            <span className="text-[10px] font-heading">Location</span>
          </div>
          <div className="text-sm font-heading font-bold text-primary truncate">{config.current_location}</div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-mutedForeground">
            <Package size={12} className="text-primary" />
            <span className="text-[10px] font-heading">Capacity</span>
          </div>
          <div className="text-sm font-heading font-bold text-foreground tabular-nums">
            {carryingTotal} / {capacity}
          </div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-mutedForeground">
            <DollarSign size={12} className="text-primary" />
            <span className="text-[10px] font-heading">Today</span>
          </div>
          <div className={`text-sm font-heading font-bold tabular-nums ${
            (config.profit_today ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {formatMoney(config.profit_today)}
          </div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-mutedForeground">
            <TrendingUp size={12} className="text-primary" />
            <span className="text-[10px] font-heading">Total</span>
          </div>
          <div className={`text-sm font-heading font-bold tabular-nums ${
            (config.profit_total ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {formatMoney(config.profit_total)}
          </div>
        </div>
        
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-mutedForeground">
            <ShoppingCart size={12} className="text-primary" />
            <span className="text-[10px] font-heading">Runs</span>
          </div>
          <div className="text-sm font-heading font-bold text-foreground tabular-nums">
            {config.runs_count ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
};

const RouteItem = ({ r }) => (
  <div className="bg-secondary/50 rounded-md p-2 border border-border hover:border-primary/30 transition-colors">
    <div className="font-heading font-bold text-foreground text-sm mb-1">{r.booze.name}</div>
    <div className="text-xs text-mutedForeground font-heading space-y-0.5">
      <div>
        Buy in <span className="text-primary font-bold">{r.bestBuyCity}</span>
        <span className="mx-1">→</span>
        <span className="text-foreground">{formatMoney(r.bestBuyPrice)}</span>
      </div>
      <div>
        Sell in <span className="text-primary font-bold">{r.bestSellCity}</span>
        <span className="mx-1">→</span>
        <span className="text-foreground">{formatMoney(r.bestSellPrice)}</span>
      </div>
    </div>
    <div className={`mt-1 font-heading font-bold text-sm ${(r.profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
      {(r.profit ?? 0) >= 0 ? '+' : ''}{formatMoney(r.profit)}/unit
    </div>
  </div>
);

const BestRoutesCard = ({ routes, title }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        {title}
      </h2>
    </div>
    <div className="p-2">
      {routes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {routes.map((r) => (
            <RouteItem key={r.booze.id} r={r} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-mutedForeground font-heading text-center py-3">
          No profitable routes this rotation
        </p>
      )}
    </div>
  </div>
);

/** One round-trip card: Buy in A → Sell in B, then Buy in B → Sell in A (same two cities, profit both ways) */
const RoundTripCard = ({ cityA, cityB, buyASellBRoutes, buyBSellARoutes }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        🗺️ Round trip: {cityA} ↔ {cityB}
      </h2>
      <p className="text-[10px] text-mutedForeground mt-0.5">Buy in one city, sell in the other — then do the reverse. One route there and back.</p>
    </div>
    <div className="p-2 space-y-4">
      <div>
        <h3 className="text-[10px] font-heading font-bold text-mutedForeground uppercase tracking-wider mb-2">
          Buy in {cityA} → sell in {cityB}
        </h3>
        {buyASellBRoutes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {buyASellBRoutes.map((r) => (
              <RouteItem key={`ab-${r.booze.id}`} r={r} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-mutedForeground font-heading py-2">No profitable routes this rotation</p>
        )}
      </div>
      <div>
        <h3 className="text-[10px] font-heading font-bold text-mutedForeground uppercase tracking-wider mb-2">
          Buy in {cityB} → sell in {cityA}
        </h3>
        {buyBSellARoutes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {buyBSellARoutes.map((r) => (
              <RouteItem key={`ba-${r.booze.id}`} r={r} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-mutedForeground font-heading py-2">No profitable routes this rotation</p>
        )}
      </div>
    </div>
  </div>
);

const CityPricesCard = ({ citySummary }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        🌎 Prices by City
      </h2>
    </div>
    
    {/* Desktop: Table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-secondary/30 text-[10px] uppercase tracking-wider font-heading text-primary/80 border-b border-border">
            <th className="text-left py-1.5 px-3">City</th>
            <th className="text-right py-1.5 px-3">Lowest Buy</th>
            <th className="text-right py-1.5 px-3">Highest Sell</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {citySummary.map((c) => (
            <tr key={c.city} className="hover:bg-secondary/30 transition-colors">
              <td className="py-1.5 px-3 font-heading font-bold text-foreground">{c.city}</td>
              <td className="py-1.5 px-3 text-right text-mutedForeground font-heading">
                {formatMoney(c.minBuy)} <span className="text-[10px]">({c.bestBuyBooze})</span>
              </td>
              <td className="py-1.5 px-3 text-right text-mutedForeground font-heading">
                {formatMoney(c.maxSell)} <span className="text-[10px]">({c.bestSellBooze})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    
    {/* Mobile: Cards */}
    <div className="md:hidden divide-y divide-border">
      {citySummary.map((c) => (
        <div key={c.city} className="p-2 hover:bg-secondary/30 transition-colors">
          <div className="font-heading font-bold text-foreground text-sm mb-1">{c.city}</div>
          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between">
              <span className="text-mutedForeground">Lowest Buy:</span>
              <span className="font-heading text-foreground">
                {formatMoney(c.minBuy)} <span className="text-[10px] text-mutedForeground">({c.bestBuyBooze})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-mutedForeground">Highest Sell:</span>
              <span className="font-heading text-foreground">
                {formatMoney(c.maxSell)} <span className="text-[10px] text-mutedForeground">({c.bestSellBooze})</span>
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
}) => {
  const maxBuy = Math.max(0, capacity - carryingTotal);
  return (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        🍾 Supplies in {location}
      </h2>
    </div>
    
    {/* Desktop: Table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-secondary/30 text-[10px] uppercase tracking-wider font-heading text-primary/80 border-b border-border">
            <th className="text-left py-1.5 px-3">Booze</th>
            <th className="text-right py-1.5 px-3">Buy</th>
            <th className="text-right py-1.5 px-3">Sell</th>
            <th className="text-right py-1.5 px-3">Have</th>
            <th className="text-right py-1.5 px-3">Qty</th>
            <th className="text-right py-1.5 px-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {supplies.map((row) => (
            <tr key={row.booze_id} className="hover:bg-secondary/30 transition-colors">
              <td className="py-1.5 px-3 font-heading font-bold text-foreground">{row.name}</td>
              <td className="py-1.5 px-3 text-right text-mutedForeground font-heading tabular-nums">
                {formatMoney(row.buy_price)}
              </td>
              <td className="py-1.5 px-3 text-right text-mutedForeground font-heading tabular-nums">
                {formatMoney(row.sell_price)}
              </td>
              <td className="py-1.5 px-3 text-right font-heading font-bold text-foreground tabular-nums">
                {row.carrying ?? 0}
              </td>
              <td className="py-1.5 px-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Buy"
                    value={buyAmounts[row.booze_id] ?? ''}
                    onChange={(e) => setBuyAmount(row.booze_id, e.target.value)}
                    onFocus={() => setBuyAmount(row.booze_id, String(maxBuy))}
                    className="w-12 text-right bg-input border border-border rounded px-1.5 py-0.5 text-xs font-heading focus:border-primary/50 focus:outline-none"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Sell"
                    value={sellAmounts[row.booze_id] ?? ''}
                    onChange={(e) => setSellAmount(row.booze_id, e.target.value)}
                    onFocus={() => setSellAmount(row.booze_id, String(row.carrying ?? 0))}
                    className="w-12 text-right bg-input border border-border rounded px-1.5 py-0.5 text-xs font-heading focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </td>
              <td className="py-1.5 px-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => handleBuy(row.booze_id)}
                    className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground px-2 py-0.5 rounded text-[10px] font-heading font-bold uppercase transition-all border border-yellow-600/50"
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => handleSell(row.booze_id)}
                    disabled={!(row.carrying > 0)}
                    className="bg-secondary text-foreground border border-border hover:border-primary/30 px-2 py-0.5 rounded text-[10px] font-heading font-bold uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
    <div className="md:hidden divide-y divide-border">
      {supplies.map((row) => (
        <div key={row.booze_id} className="p-2 space-y-2 hover:bg-secondary/30 transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-heading font-bold text-foreground text-sm">{row.name}</div>
              <div className="text-[10px] text-mutedForeground">
                Have: <span className="text-foreground font-bold">{row.carrying ?? 0}</span>
              </div>
            </div>
            <div className="text-right text-xs space-y-0.5">
              <div className="text-mutedForeground">Buy: {formatMoney(row.buy_price)}</div>
              <div className="text-mutedForeground">Sell: {formatMoney(row.sell_price)}</div>
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
              className="flex-1 bg-input border border-border rounded px-2 py-1.5 text-xs font-heading focus:border-primary/50 focus:outline-none"
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Sell qty"
              value={sellAmounts[row.booze_id] ?? ''}
              onChange={(e) => setSellAmount(row.booze_id, e.target.value)}
              onFocus={() => setSellAmount(row.booze_id, String(row.carrying ?? 0))}
              className="flex-1 bg-input border border-border rounded px-2 py-1.5 text-xs font-heading focus:border-primary/50 focus:outline-none"
            />
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => handleBuy(row.booze_id)}
              className="flex-1 bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-1.5 font-heading font-bold uppercase text-xs border border-yellow-600/50 transition-all touch-manipulation"
            >
              Buy
            </button>
            <button
              onClick={() => handleSell(row.booze_id)}
              disabled={!(row.carrying > 0)}
              className="flex-1 bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded px-3 py-1.5 font-heading font-bold uppercase text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
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
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
      <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        📜 Recent Transactions
      </h2>
      <span className="text-xs font-heading font-bold text-primary">{history.length}</span>
    </div>
    
    {history.length === 0 ? (
      <div className="p-4 text-center text-xs text-mutedForeground font-heading">
        No transactions yet
      </div>
    ) : (
      <>
        {/* Desktop: Table */}
        <div className="hidden md:block overflow-x-auto max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary/30 text-[10px] uppercase tracking-wider font-heading text-primary/80 border-b border-border sticky top-0">
                <th className="text-left py-1.5 px-3">Time</th>
                <th className="text-left py-1.5 px-3">Action</th>
                <th className="text-left py-1.5 px-3">Booze</th>
                <th className="text-right py-1.5 px-3">Qty</th>
                <th className="text-right py-1.5 px-3">Price</th>
                <th className="text-right py-1.5 px-3">Total</th>
                <th className="text-right py-1.5 px-3">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((h, i) => {
                const at = h.at ? new Date(h.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
                const isSell = h.action === 'sell';
                
                return (
                  <tr key={i} className="hover:bg-secondary/30 transition-colors">
                    <td className="py-1.5 px-3 text-mutedForeground font-heading text-[10px]">{at}</td>
                    <td className="py-1.5 px-3">
                      <span className={`font-heading font-bold ${isSell ? 'text-emerald-400' : 'text-foreground'}`}>
                        {isSell ? 'Sell' : 'Buy'}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-foreground font-heading">{h.booze_name ?? '—'}</td>
                    <td className="py-1.5 px-3 text-right font-heading font-bold tabular-nums">{h.amount ?? 0}</td>
                    <td className="py-1.5 px-3 text-right text-mutedForeground font-heading tabular-nums">
                      {formatMoney(h.unit_price)}
                    </td>
                    <td className="py-1.5 px-3 text-right font-heading font-bold text-foreground tabular-nums">
                      {formatMoney(h.total)}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {isSell && h.profit != null ? (
                        <span className={`font-heading font-bold tabular-nums ${
                          h.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {formatMoney(h.profit)}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Mobile: Cards */}
        <div className="md:hidden divide-y divide-border max-h-48 overflow-y-auto">
          {history.map((h, i) => {
            const at = h.at ? new Date(h.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const isSell = h.action === 'sell';
            
            return (
              <div key={i} className="p-2 space-y-1 hover:bg-secondary/30 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className={`font-heading font-bold text-sm ${isSell ? 'text-emerald-400' : 'text-foreground'}`}>
                      {isSell ? 'Sell' : 'Buy'} {h.booze_name ?? '—'}
                    </div>
                    <div className="text-[10px] text-mutedForeground">{at}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading font-bold text-foreground text-sm">{formatMoney(h.total)}</div>
                    {isSell && h.profit != null && (
                      <div className={`text-[10px] font-heading font-bold ${
                        h.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {formatMoney(h.profit)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 text-xs text-mutedForeground">
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
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        ℹ️ How It Works
      </h3>
    </div>
    <div className="p-3">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Prices rotate every <strong className="text-foreground">{rotationSeconds != null && rotationSeconds > 0 ? `${rotationSeconds}s` : `${rotationHours ?? 3}h`}</strong></span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Travel via car only while carrying booze</span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Capacity goes up each rank; upgrade more in Points Store</span>
        </li>
        {dailyEstimateRough != null && dailyEstimateRough > 0 && (
          <li className="flex items-start gap-1.5">
            <span className="text-emerald-400 shrink-0">•</span>
            <span>Rough 24h (custom car, best route, non-stop): <strong className="text-foreground">~${Number(dailyEstimateRough).toLocaleString()}</strong></span>
          </li>
        )}
        <li className="flex items-start gap-1.5">
          <span className="text-amber-400 shrink-0">⚠️</span>
          <span className="text-amber-400">Higher amounts = higher risk!</span>
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

  // Per-city summary: lowest buy and highest sell (any booze) for quick scan
  const citySummary = Object.entries(allByLocation).map(([city, list]) => {
    const minBuy = Math.min(...list.map((p) => p.buy_price));
    const maxSell = Math.max(...list.map((p) => p.sell_price));
    const bestBuyBooze = list.find((p) => p.buy_price === minBuy);
    const bestSellBooze = list.find((p) => p.sell_price === maxSell);
    return { city, minBuy, maxSell, bestBuyBooze: bestBuyBooze?.name, bestSellBooze: bestSellBooze?.name };
  });

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="booze-run-page">
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
      />

      <HistoryCard history={historyList} />

      <InfoCard rotationHours={config.rotation_hours} rotationSeconds={config.rotation_seconds} dailyEstimateRough={config.daily_estimate_rough} />
    </div>
  );
}
