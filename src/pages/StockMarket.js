import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { TrendingUp, BarChart3, History } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../utils/api';
import { FormattedNumberInput } from '../components/FormattedNumberInput';
import styles from '../styles/noir.module.css';

const STOCK_STYLES = `
  @keyframes stock-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .stock-fade-in { animation: stock-fade-in 0.4s ease-out both; }
  .stock-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatPrice(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '0';
  if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function ChangeCell({ value }) {
  const num = Number(value ?? 0);
  const isPos = num > 0;
  const isNeg = num < 0;
  return (
    <span className={isPos ? 'text-emerald-400' : isNeg ? 'text-red-400' : 'text-mutedForeground'}>
      {isPos ? '+' : ''}{num}%
    </span>
  );
}

export default function StockMarket() {
  const [stocks, setStocks] = useState([]);
  const [positions, setPositions] = useState([]);
  const [summary, setSummary] = useState({ total_trades: 0, total_profit: 0 });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [buyPoints, setBuyPoints] = useState('');
  const [stopLossPct, setStopLossPct] = useState('');
  const [takeProfitPct, setTakeProfitPct] = useState('');
  const [buying, setBuying] = useState(false);
  const [sellingId, setSellingId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const fetchList = useCallback(() => api.get('/stock-market/list').then((r) => setStocks(r.data?.stocks || [])).catch(() => setStocks([])), []);
  const fetchPositions = useCallback(() => api.get('/stock-market/positions').then((r) => setPositions(r.data?.positions || [])).catch(() => setPositions([])), []);
  const fetchSummary = useCallback(() => api.get('/stock-market/summary').then((r) => setSummary(r.data || { total_trades: 0, total_profit: 0 })).catch(() => {}), []);
  const fetchHistory = useCallback(() => api.get('/stock-market/history').then((r) => setHistory(r.data?.history || [])).catch(() => setHistory([])), []);

  useEffect(() => {
    Promise.all([fetchList(), fetchPositions(), fetchSummary()]).finally(() => setLoading(false));
  }, [fetchList, fetchPositions, fetchSummary]);

  // Refresh positions every second while any position is in sell cooldown so countdown updates
  useEffect(() => {
    const anyInCooldown = positions.some((p) => p.can_sell === false && (p.sell_available_in_seconds ?? 0) > 0);
    if (!anyInCooldown) return;
    const t = setInterval(fetchPositions, 1000);
    return () => clearInterval(t);
  }, [positions, fetchPositions]);

  useEffect(() => {
    const t = setInterval(() => { fetchList(); fetchPositions(); }, 15000);
    return () => clearInterval(t);
  }, [fetchList, fetchPositions]);

  const handleBuy = async () => {
    if (!selectedId) {
      toast.error('Select a stock');
      return;
    }
    const pts = parseInt(buyPoints, 10) || 0;
    if (pts < 1) {
      toast.error('Enter points to spend');
      return;
    }
    setBuying(true);
    try {
      await api.post('/stock-market/buy', {
        stock_id: selectedId,
        points: pts,
        stop_loss_pct: stopLossPct ? parseFloat(stopLossPct) : null,
        take_profit_pct: takeProfitPct ? parseFloat(takeProfitPct) : null,
      });
      await refreshUser();
      toast.success(`Bought for ${pts} points`);
      setBuyPoints('');
      fetchList();
      fetchPositions();
      fetchSummary();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not buy');
    } finally {
      setBuying(false);
    }
  };

  const handleSell = async (positionId) => {
    setSellingId(positionId);
    try {
      const res = await api.post('/stock-market/sell', { position_id: positionId });
      await refreshUser();
      const profit = res.data?.profit_points ?? 0;
      const name = positions.find((p) => p.id === positionId)?.stock_name ?? 'Stock';
      if (profit > 0) {
        toast.success(`You sold ${name} for a profit of ${profit} points!`);
      } else {
        toast.success(`Sold ${name}. ${profit < 0 ? `Loss: ${profit} points` : 'No change.'}`);
      }
      fetchList();
      fetchPositions();
      fetchSummary();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not sell');
    } finally {
      setSellingId(null);
    }
  };

  const selectedStock = stocks.find((s) => s.id === selectedId);

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="stock-market-page">
      <style>{STOCK_STYLES}</style>

      <div className="relative stock-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">The Exchange</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">Stocks</h1>
        <p className="text-[10px] text-mutedForeground font-heading italic mt-1">Buy and sell with points. One winner per trade.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Stock list */}
        <div className={`lg:col-span-2 relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 stock-fade-in`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Stocks</h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Here you can purchase stocks. Select one to buy.</p>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <p className="text-[10px] text-mutedForeground font-heading py-6 text-center">Loading…</p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-primary/10">
                    <th className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider py-2 px-2 w-8" />
                    <th className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider py-2 px-2">Stock</th>
                    <th className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider py-2 px-2 text-right">3 Hours</th>
                    <th className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider py-2 px-2 text-right">1 Day</th>
                    <th className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider py-2 px-2 text-right">3 Days</th>
                    <th className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider py-2 px-2 text-right">1 Week</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`border-b border-primary/5 cursor-pointer transition-colors ${selectedId === s.id ? styles.raised : ''} hover:bg-primary/5`}
                    >
                      <td className="py-2 px-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selectedId === s.id ? 'border-primary bg-primary/20' : 'border-zinc-500'}`}>
                          {selectedId === s.id && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <span className="font-heading font-semibold text-foreground">{s.name}</span>
                        <span className="text-mutedForeground font-heading text-[10px] ml-1">${formatPrice(s.price)}</span>
                      </td>
                      <td className="py-2 px-2 text-right text-[10px] font-heading"><ChangeCell value={s.change_3h} /></td>
                      <td className="py-2 px-2 text-right text-[10px] font-heading"><ChangeCell value={s.change_1d} /></td>
                      <td className="py-2 px-2 text-right text-[10px] font-heading"><ChangeCell value={s.change_3d} /></td>
                      <td className="py-2 px-2 text-right text-[10px] font-heading"><ChangeCell value={s.change_1w} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="stock-art-line text-primary mx-3" />
        </div>

        {/* Right: Purchase + Summary + Sell */}
        <div className="space-y-4">
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 stock-fade-in`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Purchase stocks</h2>
              <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Enter the amount you wish to purchase (points)</p>
            </div>
            <div className="p-3 space-y-3">
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Points</label>
                <FormattedNumberInput
                  value={buyPoints}
                  onChange={setBuyPoints}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Stop loss % (optional)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={stopLossPct}
                    onChange={(e) => setStopLossPct(e.target.value)}
                    placeholder="—"
                    className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Take profit % (optional)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={takeProfitPct}
                    onChange={(e) => setTakeProfitPct(e.target.value)}
                    placeholder="—"
                    className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={!selectedId || buying || !(parseInt(buyPoints, 10) > 0)}
                onClick={handleBuy}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[10px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
              >
                <BarChart3 size={14} /> {buying ? 'Buying…' : 'Buy stock'}
              </button>
            </div>
          </div>

          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 p-3 stock-fade-in`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-heading text-mutedForeground">Total trades</span>
              <span className="text-[10px] font-heading font-bold text-foreground">{summary.total_trades ?? 0}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="text-[10px] font-heading text-mutedForeground">Total profit</span>
              <span className={`text-[10px] font-heading font-bold ${(summary.total_profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {summary.total_profit >= 0 ? '+' : ''}{summary.total_profit ?? 0} points
              </span>
            </div>
          </div>

          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 stock-fade-in`}>
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Sell stocks</h2>
              <button
                type="button"
                onClick={() => { setHistoryOpen(true); fetchHistory(); }}
                className="text-[9px] font-heading text-primary/80 hover:text-primary uppercase tracking-wider"
              >
                <History size={12} className="inline mr-0.5 align-middle" /> History
              </button>
            </div>
            <div className="p-3">
              <p className="text-[9px] text-mutedForeground font-heading mb-2">Sell your stocks here.</p>
              {positions.length === 0 ? (
                <p className="text-[10px] font-heading text-mutedForeground py-4 text-center">You currently have no active investments!</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-1 text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider pb-1 border-b border-primary/10">
                    <span className="col-span-5">Investment</span>
                    <span className="col-span-3 text-right">Value</span>
                    <span className="col-span-3 text-right">Profit</span>
                    <span className="col-span-1" />
                  </div>
                  {positions.map((p) => (
                    <div key={p.id} className="grid grid-cols-12 gap-1 items-center text-[10px] font-heading border-b border-primary/5 py-1.5">
                      <span className="col-span-5 text-foreground truncate">{p.stock_name}</span>
                      <span className="col-span-3 text-right text-foreground">{p.value_points ?? 0} pts</span>
                      <span className={`col-span-3 text-right ${(p.profit_points ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(p.profit_points ?? 0) >= 0 ? '+' : ''}{p.profit_points ?? 0}
                      </span>
                      <span className="col-span-1">
                        <button
                          type="button"
                          disabled={sellingId !== null || p.can_sell === false}
                          onClick={() => handleSell(p.id)}
                          className="px-1.5 py-0.5 rounded border border-primary/40 bg-primary/20 text-primary text-[9px] font-bold uppercase hover:bg-primary/30 disabled:opacity-50"
                          title={p.can_sell === false && (p.sell_available_in_seconds ?? 0) > 0 ? `3 min cooldown after buy. Sell in ${p.sell_available_in_seconds}s` : undefined}
                        >
                          {sellingId === p.id ? '…' : p.can_sell !== false ? 'Sell' : `Sell in ${p.sell_available_in_seconds ?? 0}s`}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {historyOpen && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 ${styles.panel} rounded-lg border border-primary/20 max-h-[80vh] overflow-hidden`} style={{ margin: 0 }}>
          <div className="w-full max-w-md max-h-[70vh] flex flex-col rounded-lg overflow-hidden bg-zinc-900 border border-primary/20">
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <h3 className="text-[10px] font-heading font-bold text-primary uppercase">Transaction history</h3>
              <button type="button" onClick={() => setHistoryOpen(false)} className="text-mutedForeground hover:text-foreground text-sm">Close</button>
            </div>
            <div className="overflow-y-auto p-3 space-y-1">
              {history.length === 0 ? (
                <p className="text-[10px] text-mutedForeground font-heading">No transactions yet.</p>
              ) : (
                history.map((t) => (
                  <div key={t.id} className="text-[10px] font-heading py-1.5 border-b border-primary/5 flex justify-between gap-2">
                    <span className="text-foreground">{t.type === 'buy' ? 'Buy' : 'Sell'} {t.stock_name}</span>
                    <span className={t.profit_points > 0 ? 'text-emerald-400' : t.profit_points < 0 ? 'text-red-400' : 'text-mutedForeground'}>
                      {t.profit_points > 0 ? '+' : ''}{t.profit_points ?? 0} pts
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
