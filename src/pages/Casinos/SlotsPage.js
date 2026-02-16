import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const SPIN_DURATION_MS = 1800;
const REEL_STOP_STAGGER_MS = 280;
const SYMBOL_IDS = ['cherry', 'lemon', 'bar', 'bell', 'seven'];
const SYMBOL_EMOJI = { cherry: '🍒', lemon: '🍋', bar: '📊', bell: '🔔', seven: '7️⃣' };

function getSymbolEmoji(id) {
  if (typeof id === 'string') return SYMBOL_EMOJI[id] || '?';
  return (id && SYMBOL_EMOJI[id.id]) || (id && id.name) || '?';
}

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

// Strip of symbols for spinning (duplicated for seamless loop: -50% = one full cycle)
const SPIN_STRIP = [...SYMBOL_IDS, ...SYMBOL_IDS];
const REEL_SYMBOL_HEIGHT = 40;

function Reel({ spinning, revealed, symbolId }) {
  return (
    <div className="relative w-[72px] h-[88px] sm:w-[88px] sm:h-[104px] flex-shrink-0 rounded-lg overflow-hidden bg-gradient-to-b from-zinc-900 to-black border-2 border-primary/50 shadow-inner">
      <div className="absolute inset-0 rounded-lg overflow-hidden">
        {spinning && !revealed ? (
          <div
            className="absolute left-0 right-0 flex flex-col items-center justify-start"
            style={{
              height: SPIN_STRIP.length * REEL_SYMBOL_HEIGHT,
              animation: 'reel-spin 0.1s linear infinite',
              top: 0,
            }}
          >
            {SPIN_STRIP.map((id, k) => (
              <span
                key={k}
                className="text-2xl sm:text-3xl leading-none flex items-center justify-center w-full shrink-0"
                style={{ height: REEL_SYMBOL_HEIGHT }}
              >
                {SYMBOL_EMOJI[id]}
              </span>
            ))}
          </div>
        ) : (
          <div
            className={`absolute inset-0 flex items-center justify-center ${revealed ? 'animate-reel-pop' : ''}`}
            style={{ animationDuration: '0.28s' }}
          >
            <span className="text-3xl sm:text-4xl leading-none">
              {symbolId ? getSymbolEmoji(symbolId) : '?'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SlotsPage() {
  const [config, setConfig] = useState({ max_bet: 5_000_000, current_state: '', states: [], symbols: [] });
  const [bet, setBet] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [reelRevealed, setReelRevealed] = useState([false, false, false]);
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
    setReelRevealed([false, false, false]);
    try {
      const res = await api.post('/casino/slots/spin', { bet: betNum });
      const data = res.data || {};
      setLoading(false);
      setSpinning(true);
      setDisplayReels(data.reels || []);
      const reels = data.reels || [];
      const t1 = setTimeout(() => setReelRevealed((r) => [true, r[1], r[2]]), REEL_STOP_STAGGER_MS);
      const t2 = setTimeout(() => setReelRevealed((r) => [true, true, r[2]]), REEL_STOP_STAGGER_MS * 2);
      const t3 = setTimeout(() => {
        setReelRevealed([true, true, true]);
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
      }, REEL_STOP_STAGGER_MS * 3);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    } catch (e) {
      setLoading(false);
      setSpinning(false);
      setReelRevealed([false, false, false]);
      toast.error(apiErrorDetail(e, 'Spin failed'));
    }
  };

  const symbols = config.symbols || [];
  const reelsToShow = displayReels && displayReels.length >= 3 ? displayReels : null;
  const reelSymbolIds = [0, 1, 2].map((i) => {
    if (!reelsToShow || !reelsToShow[i]) return null;
    const s = reelsToShow[i];
    return typeof s === 'string' ? s : s?.id;
  });

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="slots-page">
      <style>{`
        @keyframes reel-spin {
          0% { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        @keyframes reel-pop {
          0% { transform: scale(0.5); opacity: 0.6; }
          60% { transform: scale(1.12); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
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

      {/* Slot machine cabinet */}
      <div className="flex justify-center">
        <div className="relative rounded-2xl sm:rounded-3xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-zinc-950 border-4 border-primary/60 shadow-xl shadow-primary/10 p-4 sm:p-6 pb-8">
          {/* Top marquee */}
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-0.5 rounded-full bg-primary/90 text-black text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider">
            Lucky 7
          </div>
          {/* Payline */}
          <div className="flex justify-center gap-1 sm:gap-2 mb-1">
            <div className="h-0.5 w-2 rounded-full bg-primary/40" />
            <div className="h-0.5 flex-1 max-w-[200px] rounded-full bg-primary/60" />
            <div className="h-0.5 w-2 rounded-full bg-primary/40" />
          </div>
          {/* Reels */}
          <div className="flex justify-center gap-1 sm:gap-2 mb-4">
            {[0, 1, 2].map((i) => (
              <Reel
                key={i}
                spinning={spinning}
                revealed={reelRevealed[i]}
                symbolId={reelSymbolIds[i]}
              />
            ))}
          </div>
          {/* Result line */}
          {result && (
            <div className={`text-center text-sm font-heading mb-3 ${result.won ? 'text-emerald-400' : 'text-mutedForeground'}`}>
              {result.won ? `+${formatMoney(result.payout)}` : 'No match'}
              {result.new_balance != null && (
                <span className="block text-[10px] text-mutedForeground mt-0.5">Balance: {formatMoney(result.new_balance)}</span>
              )}
            </div>
          )}
          {/* Bet + Spin */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <label className="text-xs font-heading text-mutedForeground">Bet:</label>
            <input
              type="text"
              inputMode="numeric"
              value={bet}
              onChange={(e) => setBet(e.target.value)}
              placeholder="1000"
              className="w-24 sm:w-28 bg-zinc-800 border-2 border-primary/40 rounded-lg px-2 py-1.5 text-sm font-heading text-foreground focus:border-primary focus:outline-none"
            />
            <button
              onClick={spin}
              disabled={!canSpin}
              className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded-xl px-8 py-2.5 text-sm font-heading font-bold uppercase border-2 border-yellow-600/60 shadow-lg shadow-primary/30 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              {loading ? '...' : spinning ? 'Spinning...' : 'Spin'}
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
