import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const SPIN_DURATION_MS = 1200;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatHistoryDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  return fallback;
}

export default function SlotsPage() {
  const [config, setConfig] = useState({ max_bet: 5_000_000, current_state: '', states: [], symbols: [] });
  const [bet, setBet] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [displayReels, setDisplayReels] = useState(null);
  const [history, setHistory] = useState([]);

  const fetchConfig = useCallback(() => {
    api.get('/casino/slots/config').then((r) => {
      const d = r.data || {};
      setConfig({
        max_bet: d.max_bet ?? 5_000_000,
        current_state: d.current_state || '',
        states: d.states || [],
        symbols: d.symbols || [],
      });
    }).catch(() => {});
  }, []);

  const fetchHistory = useCallback(() => {
    api.get('/casino/slots/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchHistory();
  }, [fetchConfig, fetchHistory]);

  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const canSpin = betNum >= 1 && betNum <= (config.max_bet || 5_000_000) && !loading && !spinning;

  const spin = async () => {
    if (!canSpin) return;
    setLoading(true);
    setResult(null);
    setDisplayReels(null);
    try {
      const res = await api.post('/casino/slots/spin', { bet: betNum });
      const data = res.data || {};
      setLoading(false);
      setSpinning(true);
      setDisplayReels(data.reels || []);
      setTimeout(() => {
        setResult({
          won: data.won,
          payout: data.payout || 0,
          new_balance: data.new_balance,
        });
        setSpinning(false);
        if (data.won) toast.success(`Winner! +${formatMoney(data.payout)}`);
        else toast.info('No match. Try again!');
        if (data.new_balance != null) refreshUser(data.new_balance);
        fetchHistory();
      }, SPIN_DURATION_MS);
    } catch (e) {
      setLoading(false);
      setSpinning(false);
      toast.error(apiErrorDetail(e, 'Spin failed'));
    }
  };

  const symbols = config.symbols || [];
  const reelsToShow = displayReels && displayReels.length >= 3 ? displayReels : null;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="slots-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1">
            🎰 Slots
          </h1>
          <p className="text-xs text-mutedForeground flex items-center gap-1">
            <MapPin size={12} className="text-primary" />
            State-owned · <span className="text-primary font-bold">{config.current_state || '—'}</span>
          </p>
        </div>
        <div className="text-xs font-heading text-mutedForeground">
          Max bet: <span className="text-primary font-bold">{formatMoney(config.max_bet)}</span>
        </div>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">3-Reel Slot</h2>
        </div>
        <div className="p-4 space-y-4">
          {/* Reels */}
          <div className="flex justify-center gap-2 sm:gap-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-20 h-24 sm:w-24 sm:h-28 rounded-lg border-2 border-primary/40 bg-gradient-to-b from-zinc-800 to-zinc-900 flex items-center justify-center overflow-hidden"
              >
                {reelsToShow && reelsToShow[i] ? (
                  <span
                    className={`text-2xl sm:text-3xl font-bold ${spinning ? 'animate-pulse' : ''}`}
                    title={typeof reelsToShow[i] === 'string' ? reelsToShow[i] : (reelsToShow[i]?.name || reelsToShow[i]?.id)}
                  >
                    {(typeof reelsToShow[i] === 'string' ? reelsToShow[i] : reelsToShow[i]?.id) === 'cherry' && '🍒'}
                    {(typeof reelsToShow[i] === 'string' ? reelsToShow[i] : reelsToShow[i]?.id) === 'lemon' && '🍋'}
                    {(typeof reelsToShow[i] === 'string' ? reelsToShow[i] : reelsToShow[i]?.id) === 'bar' && '📊'}
                    {(typeof reelsToShow[i] === 'string' ? reelsToShow[i] : reelsToShow[i]?.id) === 'bell' && '🔔'}
                    {(typeof reelsToShow[i] === 'string' ? reelsToShow[i] : reelsToShow[i]?.id) === 'seven' && '7️⃣'}
                  </span>
                ) : (
                  <span className="text-primary/30 text-4xl">?</span>
                )}
              </div>
            ))}
          </div>

          {result && (
            <div className={`text-center text-sm font-heading ${result.won ? 'text-emerald-400' : 'text-mutedForeground'}`}>
              {result.won ? `+${formatMoney(result.payout)}` : 'No match'}
              {result.new_balance != null && (
                <span className="block text-[10px] text-mutedForeground mt-0.5">Balance: {formatMoney(result.new_balance)}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3">
            <label className="text-xs font-heading text-mutedForeground">Bet:</label>
            <input
              type="text"
              inputMode="numeric"
              value={bet}
              onChange={(e) => setBet(e.target.value)}
              placeholder="1000"
              className="w-28 bg-input border border-border rounded px-2 py-1.5 text-sm font-heading text-foreground focus:border-primary/50 focus:outline-none"
            />
            <button
              onClick={spin}
              disabled={!canSpin}
              className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded-lg px-6 py-2 text-sm font-heading font-bold uppercase border border-yellow-600/50 shadow shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {loading || spinning ? '...' : 'Spin'}
            </button>
          </div>
        </div>
      </div>

      {/* Paytable */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Paytable (3 of a kind)</h2>
        </div>
        <div className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-heading">
            {symbols.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded bg-secondary/30 px-2 py-1.5 border border-border/50">
                <span>
                  {s.id === 'cherry' && '🍒'}
                  {s.id === 'lemon' && '🍋'}
                  {s.id === 'bar' && '📊'}
                  {s.id === 'bell' && '🔔'}
                  {s.id === 'seven' && '7️⃣'}
                  {' '}{s.name}
                </span>
                <span className="text-primary font-bold">{(s.mult_3 ?? s.multiplier) ?? 0}×</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-mutedForeground mt-2">5% house edge on wins. One machine per state — state-owned.</p>
        </div>
      </div>

      {/* History */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Recent spins</h2>
        </div>
        <div className="p-2 max-h-48 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-xs text-mutedForeground font-heading py-2">No spins yet.</p>
          ) : (
            <ul className="space-y-1 text-[11px] font-heading">
              {history.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1 border-b border-border/30 last:border-0">
                  <span className="flex gap-0.5">
                    {(h.reels || []).map((r, j) => {
                      const id = typeof r === 'string' ? r : r?.id;
                      return (
                        <span key={j}>
                          {id === 'cherry' && '🍒'}
                          {id === 'lemon' && '🍋'}
                          {id === 'bar' && '📊'}
                          {id === 'bell' && '🔔'}
                          {id === 'seven' && '7️⃣'}
                        </span>
                      );
                    })}
                  </span>
                  <span className={h.won ? 'text-emerald-400' : 'text-mutedForeground'}>
                    {h.won ? `+${formatMoney(h.payout)}` : `-${formatMoney(h.bet)}`}
                  </span>
                  <span className="text-mutedForeground shrink-0">{formatHistoryDate(h.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
