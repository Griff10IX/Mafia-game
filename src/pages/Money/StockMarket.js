import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { TrendingUp, BarChart3, History } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

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

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
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
  const [summary, setSummary] = useState({ total_trades: 0, total_profit: 0, max_points: 3000, points_in_use: 0 });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [buyPoints, setBuyPoints] = useState('');
  const [buySide, setBuySide] = useState('long'); // 'long' | 'short'
  const [stopLossPct, setStopLossPct] = useState('');
  const [takeProfitPct, setTakeProfitPct] = useState('');
  const [buying, setBuying] = useState(false);
  const [sellingId, setSellingId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailPosition, setDetailPosition] = useState(null);
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const hoverCloseTimeoutRef = useRef(null);

  const fetchList = useCallback(() => api.get('/stock-market/list').then((r) => setStocks(r.data?.stocks || [])).catch(() => setStocks([])), []);
  const fetchPositions = useCallback(() => api.get('/stock-market/positions').then((r) => setPositions(r.data?.positions || [])).catch(() => setPositions([])), []);
  const fetchSummary = useCallback(() => api.get('/stock-market/summary').then((r) => setSummary(r.data ?? { total_trades: 0, total_profit: 0, max_points: 3000, points_in_use: 0 })).catch(() => setSummary({ total_trades: 0, total_profit: 0, max_points: 3000, points_in_use: 0 })), []);
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

  // Auto-update stocks and positions every 60 seconds (no page refresh needed)
  useEffect(() => {
    const t = setInterval(() => {
      fetchList();
      fetchPositions();
      fetchSummary();
    }, 60000);
    return () => clearInterval(t);
  }, [fetchList, fetchPositions, fetchSummary]);

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
        side: buySide,
        stop_loss_pct: buySide === 'long' && stopLossPct ? parseFloat(stopLossPct) : null,
        take_profit_pct: buySide === 'long' && takeProfitPct ? parseFloat(takeProfitPct) : null,
      });
      refreshUser(buySide === 'long' ? { pointsDelta: -pts } : { pointsDelta: pts });
      toast.success(buySide === 'short' ? `Short opened for ${pts} pts notional` : `Bought for ${pts} points`);
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
      const pos = positions.find((p) => p.id === positionId);
      const vp = Number(res.data?.value_points ?? 0);
      const isShort = pos?.side === 'short';
      refreshUser({ pointsDelta: isShort ? -vp : vp });
      const profit = res.data?.profit_points ?? 0;
      const name = pos?.stock_name ?? 'Stock';
      if (isShort) {
        if (profit > 0) toast.success(`Covered ${name} for a profit of ${profit} points!`);
        else toast.success(`Covered ${name}. ${profit < 0 ? `Loss: ${profit} points` : 'No change.'}`);
      } else {
        if (profit > 0) toast.success(`You sold ${name} for a profit of ${profit} points!`);
        else toast.success(`Sold ${name}. ${profit < 0 ? `Loss: ${profit} points` : 'No change.'}`);
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
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="stock-market-page">
      <style>{STOCK_STYLES}</style>

      <div className="relative stock-fade-in">
        <p className="text-[10px] text-mutedForeground font-heading italic">Long: spend points to open. Short: your balance goes up by the notional when you open (proceeds); cover subtracts the buy-back cost when you close. Same cap and cooldowns.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Stock list */}
        <div className={`lg:col-span-2 relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 stock-fade-in mobile-panel`}>
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
                      className={`border-b border-primary/5 cursor-pointer transition-colors ${selectedId === s.id ? styles.raised : ''} hover:bg-primary/5 ${s.live === false ? 'opacity-70' : ''}`}
                      title={s.live === false ? 'Price data unavailable – buying disabled' : undefined}
                    >
                      <td className="py-2 px-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selectedId === s.id ? 'border-primary bg-primary/20' : 'border-zinc-500'}`}>
                          {selectedId === s.id && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          {s.icon_url ? (
                            <img
                              src={s.icon_url}
                              alt=""
                              className="w-6 h-6 rounded-full shrink-0 bg-zinc-800/50 object-contain"
                              onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling?.classList.remove('hidden'); }}
                            />
                          ) : null}
                          <span className={`w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[10px] font-heading font-bold text-primary shrink-0 ${s.icon_url ? 'hidden' : ''}`} aria-hidden>
                            {(s.symbol || s.name || '?').charAt(0)}
                          </span>
                          <span>
                            <span className="font-heading font-semibold text-foreground">{s.name}</span>
                            <span className="text-mutedForeground font-heading text-[10px] ml-1">${formatPrice(s.price)}</span>
                          </span>
                        </div>
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

        {/* Right: Sell + Summary + Purchase */}
        <div className="space-y-4">
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 stock-fade-in mobile-panel`}>
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Sell / Cover</h2>
              <button
                type="button"
                onClick={() => { setHistoryOpen(true); fetchHistory(); }}
                className="text-[9px] font-heading text-primary/80 hover:text-primary uppercase tracking-wider"
              >
                <History size={12} className="inline mr-0.5 align-middle" /> History
              </button>
            </div>
            <div className="p-3">
              <p className="text-[9px] text-mutedForeground font-heading mb-2">Close long (sell) or short (cover) positions.</p>
              {positions.length === 0 ? (
                <p className="text-[10px] font-heading text-mutedForeground py-4 text-center">You have no open positions.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-1 text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider pb-1 border-b border-primary/10">
                    <span className="col-span-4">Position</span>
                    <span className="col-span-3 text-right">{positions.some((p) => p.side === 'short') ? 'Value / Cover' : 'Value'}</span>
                    <span className="col-span-3 text-right">P/L</span>
                    <span className="col-span-2" />
                  </div>
                  {positions.map((p) => (
                    <div
                      key={p.id}
                      className="relative"
                      onMouseEnter={(e) => {
                        if (hoverCloseTimeoutRef.current) clearTimeout(hoverCloseTimeoutRef.current);
                        const rect = e.currentTarget.getBoundingClientRect();
                        const spaceBelow = typeof window !== 'undefined' ? window.innerHeight - rect.bottom - 24 : 400;
                        const spaceAbove = typeof window !== 'undefined' ? rect.top - 24 : 400;
                        const showAbove = spaceBelow < 380 && spaceAbove > spaceBelow;
                        setPopoverAnchor({
                          left: rect.left,
                          top: rect.bottom,
                          rowTop: rect.top,
                          width: rect.width,
                          showAbove,
                        });
                        setDetailPosition(p);
                      }}
                      onMouseLeave={() => {
                        hoverCloseTimeoutRef.current = setTimeout(() => { setDetailPosition(null); setPopoverAnchor(null); }, 150);
                      }}
                    >
                      <div className="grid grid-cols-12 gap-1 items-center text-[10px] font-heading border-b border-primary/5 py-1.5 cursor-default hover:bg-primary/5 rounded px-1 -mx-1 transition-colors">
                        <span className="col-span-4 text-foreground truncate flex items-center gap-1">
                          <span className={`shrink-0 px-1 rounded text-[8px] font-bold ${p.side === 'short' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-primary/20 text-primary border border-primary/40'}`}>
                            {p.side === 'short' ? 'S' : 'L'}
                          </span>
                          {p.stock_name}
                        </span>
                        <span className="col-span-3 text-right text-foreground">{p.value_points ?? 0} pts</span>
                        <span className={`col-span-3 text-right ${(p.profit_points ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(p.profit_points ?? 0) >= 0 ? '+' : ''}{p.profit_points ?? 0}
                        </span>
                        <span className="col-span-2">
                          <button
                            type="button"
                            disabled={sellingId !== null || p.can_sell === false}
                            onClick={() => handleSell(p.id)}
                            className="px-1.5 py-0.5 rounded border border-primary/40 bg-primary/20 text-primary text-[9px] font-bold uppercase hover:bg-primary/30 disabled:opacity-50"
                            title={p.can_sell === false && (p.sell_available_in_seconds ?? 0) > 0 ? `3 min cooldown. Close in ${p.sell_available_in_seconds}s` : undefined}
                          >
                            {sellingId === p.id ? '…' : p.can_sell !== false ? (p.side === 'short' ? 'Cover' : 'Sell') : `In ${p.sell_available_in_seconds ?? 0}s`}
                          </button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 p-3 stock-fade-in mobile-panel`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-heading text-mutedForeground">Points in market</span>
              <span className="text-[10px] font-heading font-bold text-foreground">
                {(summary.points_in_use ?? 0).toLocaleString()} / {(summary.max_points ?? 3000).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="text-[10px] font-heading text-mutedForeground">Total trades</span>
              <span className="text-[10px] font-heading font-bold text-foreground">{summary.total_trades ?? 0}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="text-[10px] font-heading text-mutedForeground">Profit / loss (all-time)</span>
              <span className={`text-[10px] font-heading font-bold ${(summary.total_profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(summary.total_profit ?? 0) >= 0 ? '+' : ''}{(summary.total_profit ?? 0).toLocaleString()} pts
              </span>
            </div>
          </div>

          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 stock-fade-in mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Purchase stocks</h2>
              <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Long: points are deducted when you open. Short: points are credited when you open; you pay to cover when you close. Profit if price falls before you cover.</p>
            </div>
            <div className="p-3 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBuySide('long')}
                  className={`flex-1 px-2 py-1.5 rounded border text-[10px] font-heading font-bold uppercase ${buySide === 'long' ? 'border-primary bg-primary/20 text-primary' : 'border-primary/20 text-mutedForeground hover:border-primary/40'}`}
                >
                  Long
                </button>
                <button
                  type="button"
                  onClick={() => setBuySide('short')}
                  className={`flex-1 px-2 py-1.5 rounded border text-[10px] font-heading font-bold uppercase ${buySide === 'short' ? 'border-primary bg-primary/20 text-primary' : 'border-primary/20 text-mutedForeground hover:border-primary/40'}`}
                >
                  Short
                </button>
              </div>
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Points {buySide === 'short' ? '(notional size)' : ''}</label>
                <FormattedNumberInput
                  value={buyPoints}
                  onChange={setBuyPoints}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                />
                <p className="text-[9px] text-mutedForeground font-heading mt-0.5">
                  {(Math.max(0, (summary.max_points ?? 3000) - (summary.points_in_use ?? 0))).toLocaleString()} pts remaining (max {(summary.max_points ?? 3000).toLocaleString()} in market)
                </p>
              </div>
              {buySide === 'long' && (
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
              )}
              {selectedId && selectedStock && selectedStock.live === false && (
                <p className="text-[9px] text-amber-200/90 font-heading">
                  Price data unavailable for this stock. Try again in a moment.
                </p>
              )}
              <button
                type="button"
                disabled={
                  !selectedId ||
                  buying ||
                  selectedStock?.live === false ||
                  !(parseInt(buyPoints, 10) > 0) ||
                  (summary.points_in_use ?? 0) + (parseInt(buyPoints, 10) || 0) > (summary.max_points ?? 3000)
                }
                onClick={handleBuy}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[10px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
              >
                <BarChart3 size={14} /> {buying ? (buySide === 'short' ? 'Opening…' : 'Buying…') : buySide === 'short' ? 'Short stock' : 'Buy stock'}
              </button>
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
                history.map((t) => {
                  const label = t.type === 'buy' ? 'Long buy' : t.type === 'sell' ? 'Long sell' : t.type === 'short' ? 'Short' : t.type === 'cover' ? 'Cover' : t.type;
                  return (
                    <div key={t.id} className="text-[10px] font-heading py-1.5 border-b border-primary/5 flex justify-between gap-2">
                      <span className="text-foreground">{label} {t.stock_name}</span>
                      <span className={t.profit_points > 0 ? 'text-emerald-400' : t.profit_points < 0 ? 'text-red-400' : 'text-mutedForeground'}>
                        {t.profit_points > 0 ? '+' : ''}{t.profit_points ?? 0} pts
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {detailPosition && popoverAnchor && createPortal(
        <div
          className="fixed z-[100] w-[320px] max-h-[70vh] rounded-lg overflow-hidden bg-zinc-900 border border-primary/20 shadow-xl flex flex-col"
          style={{
            left: popoverAnchor.left,
            top: popoverAnchor.showAbove
              ? (popoverAnchor.rowTop ?? popoverAnchor.top - 420) - 420 - 8
              : popoverAnchor.top + 4,
          }}
          onMouseEnter={() => { if (hoverCloseTimeoutRef.current) clearTimeout(hoverCloseTimeoutRef.current); }}
          onMouseLeave={() => { setDetailPosition(null); setPopoverAnchor(null); }}
        >
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 shrink-0">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Position details</span>
          </div>
          <div className="p-3 space-y-2 text-[10px] font-heading overflow-y-auto min-h-0 flex-1">
            <p className="text-foreground font-bold text-sm flex items-center gap-1.5">
              {detailPosition.stock_name} ({detailPosition.symbol})
              <span className={`px-1 rounded text-[8px] font-bold ${detailPosition.side === 'short' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-primary/20 text-primary border border-primary/40'}`}>
                {detailPosition.side === 'short' ? 'Short' : 'Long'}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-zinc-800/50 rounded p-1.5 border border-primary/10">
                <span className="text-mutedForeground block text-[9px] uppercase">{detailPosition.side === 'short' ? 'Opened at' : 'Bought at'}</span>
                <span className="text-foreground">{formatDateTime(detailPosition.bought_at)}</span>
              </div>
              <div className="bg-zinc-800/50 rounded p-1.5 border border-primary/10">
                <span className="text-mutedForeground block text-[9px] uppercase">Units</span>
                <span className="text-foreground">{Number(detailPosition.units ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
              </div>
              <div className="bg-zinc-800/50 rounded p-1.5 border border-primary/10">
                <span className="text-mutedForeground block text-[9px] uppercase">{detailPosition.side === 'short' ? 'Open price' : 'Buy price'}</span>
                <span className="text-primary font-bold">{formatPrice(detailPosition.buy_price ?? detailPosition.open_price)}</span>
              </div>
              <div className="bg-zinc-800/50 rounded p-1.5 border border-primary/10">
                <span className="text-mutedForeground block text-[9px] uppercase">Current price</span>
                <span className="text-primary font-bold">{formatPrice(detailPosition.current_price)}</span>
              </div>
              <div className="bg-zinc-800/50 rounded p-1.5 border border-primary/10">
                <span className="text-mutedForeground block text-[9px] uppercase">{detailPosition.side === 'short' ? 'Notional at open' : 'Cost (points)'}</span>
                <span className="text-foreground">{(detailPosition.cost_points ?? 0).toLocaleString()} pts</span>
              </div>
              <div className="bg-zinc-800/50 rounded p-1.5 border border-primary/10">
                <span className="text-mutedForeground block text-[9px] uppercase">{detailPosition.side === 'short' ? 'Cover cost' : 'Current value'}</span>
                <span className="text-foreground">{(detailPosition.value_points ?? 0).toLocaleString()} pts</span>
              </div>
            </div>
            <div className={`rounded p-1.5 border ${(detailPosition.profit_points ?? 0) >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
              <span className="text-mutedForeground block text-[9px] uppercase">Profit / loss</span>
              <span className={`font-bold ${(detailPosition.profit_points ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(detailPosition.profit_points ?? 0) >= 0 ? '+' : ''}{(detailPosition.profit_points ?? 0).toLocaleString()} pts
              </span>
            </div>
            {detailPosition.auto_sell_at && (
              <p className="text-mutedForeground text-[9px]">Auto-sold after 7 days: {formatDateTime(detailPosition.auto_sell_at)}</p>
            )}
          </div>
          <div className="px-3 py-2 border-t border-primary/20 flex justify-end gap-1.5 shrink-0">
            <button
              type="button"
              disabled={sellingId !== null || detailPosition.can_sell === false}
              onClick={() => { handleSell(detailPosition.id); setDetailPosition(null); setPopoverAnchor(null); }}
              className="px-2.5 py-1 rounded border border-primary/40 bg-primary/20 text-primary text-[10px] font-bold uppercase hover:bg-primary/30 disabled:opacity-50"
            >
              {sellingId === detailPosition.id ? '…' : detailPosition.can_sell !== false ? (detailPosition.side === 'short' ? 'Cover' : 'Sell') : `In ${detailPosition.sell_available_in_seconds ?? 0}s`}
            </button>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
