import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { MapPin, User, Clock, Coins, LogIn } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const CG_STYLES = `
  .cg-fade-in { animation: cg-fade-in 0.4s ease-out both; }
  @keyframes cg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
`;

const SPIN_DURATION_MS = 2200;
const REEL_STOP_STAGGER_MS = 400;
const SYMBOL_IDS = ['cherry', 'lemon', 'bar', 'bell', 'seven'];
const SYMBOL_EMOJI = { cherry: '🍒', lemon: '🍋', bar: '📊', bell: '🔔', seven: '7️⃣' };
const CELL_H = 72;
const VISIBLE_ROWS = 3;
const STRIP_COPIES = 6;
const FULL_STRIP = Array.from({ length: STRIP_COPIES }, () => SYMBOL_IDS).flat();

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
  const data = e.response?.data;
  const d = data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  if (d && typeof d === 'object' && typeof d.msg === 'string') return d.msg;
  if (typeof data?.message === 'string') return data.message;
  if (e.response?.status === 401) return 'Please log in again';
  if (e.response?.status === 403) return 'Not allowed';
  if (!e.response && e.message) return e.message;
  return fallback;
}

/* ─── Reel with 3 visible rows, blur while spinning, deceleration stop ─── */
function Reel({ spinning, revealed, symbolId, reelIndex, isWin }) {
  const stripRef = useRef(null);
  const animRef = useRef(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (spinning && !revealed) {
      setSettled(false);
      const el = stripRef.current;
      if (!el) return;
      let pos = 0;
      const speed = 18 + reelIndex * 2;
      const tick = () => {
        pos = (pos + speed) % (SYMBOL_IDS.length * CELL_H * STRIP_COPIES);
        el.style.transform = `translateY(-${pos}px)`;
        animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(animRef.current);
    }
    if (revealed) {
      cancelAnimationFrame(animRef.current);
      const el = stripRef.current;
      if (!el) return;
      const safeIdx = FULL_STRIP.findIndex((id, i) => id === symbolId && i >= 1 && i <= FULL_STRIP.length - 2);
      const targetIdx = safeIdx >= 1 ? safeIdx : 1;
      const targetY = targetIdx * CELL_H;
      el.style.transition = 'transform 0.45s cubic-bezier(0.2, 0.8, 0.3, 1.05)';
      el.style.transform = `translateY(-${targetY}px)`;
      const onEnd = () => {
        el.style.transition = '';
        setSettled(true);
      };
      el.addEventListener('transitionend', onEnd, { once: true });
      return () => el.removeEventListener('transitionend', onEnd);
    }
  }, [spinning, revealed, symbolId, reelIndex]);

  return (
    <div className="relative flex flex-col items-center">
      {/* Reel chrome frame */}
      <div
        className="relative rounded-md overflow-hidden"
        style={{
          width: 80, height: CELL_H * VISIBLE_ROWS,
          background: 'linear-gradient(135deg, #3a3a3a 0%, #1a1a1a 50%, #2a2a2a 100%)',
          border: '3px solid transparent',
          borderImage: 'linear-gradient(180deg, #c9a84c 0%, #7a6528 40%, #c9a84c 60%, #7a6528 100%) 1',
          boxShadow: 'inset 0 0 24px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        {/* Glass highlight */}
        <div className="absolute inset-0 z-10 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.15) 100%)' }}
        />
        {/* Payline indicator (middle row) */}
        <div className="absolute z-20 pointer-events-none" style={{ top: CELL_H - 1, left: 0, right: 0, height: CELL_H + 2 }}>
          <div className={`absolute inset-0 border-y-2 ${isWin && settled ? 'border-emerald-400/80' : 'border-primary/30'} transition-colors duration-300`} />
          {isWin && settled && (
            <div className="absolute inset-0 animate-payline-flash rounded-sm" />
          )}
        </div>
        {/* Blur overlay while spinning */}
        {spinning && !revealed && (
          <div className="absolute inset-0 z-10 pointer-events-none backdrop-blur-[1px]"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.15) 100%)' }}
          />
        )}
        {/* Symbol strip */}
        <div className="absolute left-0 right-0" style={{ top: CELL_H }} ref={stripRef}>
          {FULL_STRIP.map((id, k) => (
            <div
              key={k}
              className="flex items-center justify-center"
              style={{ height: CELL_H, width: '100%' }}
            >
              <span className="text-3xl sm:text-4xl select-none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
                {SYMBOL_EMOJI[id]}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* Win glow under reel */}
      {isWin && settled && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-16 h-4 rounded-full bg-emerald-400/30 blur-md animate-pulse" />
      )}
    </div>
  );
}

/* ─── Falling coins with variety ─── */
function FallingCoins({ active }) {
  const [coins] = useState(() =>
    Array.from({ length: 32 }, (_, i) => ({
      id: i,
      left: 4 + Math.random() * 92,
      size: 14 + Math.random() * 14,
      delay: Math.random() * 1.2,
      duration: 1.0 + Math.random() * 0.8,
      rotate: Math.random() * 720 - 360,
      emoji: Math.random() > 0.3 ? '🪙' : '✨',
    }))
  );
  if (!active) return null;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl z-30" aria-hidden>
      {coins.map((c) => (
        <span
          key={c.id}
          className="absolute animate-coin-fall"
          style={{
            left: `${c.left}%`,
            top: '-8%',
            fontSize: c.size,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
            '--coin-rotate': `${c.rotate}deg`,
          }}
        >
          {c.emoji}
        </span>
      ))}
    </div>
  );
}

/* ─── Chasing lights around marquee ─── */
function ChasingLights({ count = 20, active }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg z-10">
      {Array.from({ length: count }, (_, i) => {
        const pct = (i / count) * 100;
        const isTop = pct < 25;
        const isRight = pct >= 25 && pct < 50;
        const isBottom = pct >= 50 && pct < 75;
        let posStyle = {};
        if (isTop) { posStyle = { top: -1, left: `${(pct / 25) * 100}%` }; }
        else if (isRight) { posStyle = { right: -1, top: `${((pct - 25) / 25) * 100}%` }; }
        else if (isBottom) { posStyle = { bottom: -1, right: `${((pct - 50) / 25) * 100}%` }; }
        else { posStyle = { left: -1, bottom: `${((pct - 75) / 25) * 100}%` }; }
        return (
          <span
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              ...posStyle,
              background: active ? '#d4af37' : '#5a4a1a',
              boxShadow: active ? `0 0 6px rgba(212,175,55,0.8)` : 'none',
              opacity: active ? 1 : 0.4,
              animation: active ? `chase-blink 1.5s ease-in-out infinite` : 'none',
              animationDelay: `${i * (1.5 / count)}s`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ─── Lever with pull animation ─── */
function Lever({ onPull, disabled }) {
  const [pulled, setPulled] = useState(false);

  const handlePull = () => {
    if (disabled || pulled) return;
    setPulled(true);
    onPull();
    setTimeout(() => setPulled(false), 500);
  };

  return (
    <div className="flex flex-col items-center justify-center ml-1 sm:ml-2 select-none">
      {/* Mount plate */}
      <div
        className="w-5 h-3 rounded-t-sm"
        style={{
          background: 'linear-gradient(180deg, #8a7a3a, #5a4a1a)',
          borderTop: '1px solid #c9a84c',
        }}
      />
      {/* Shaft */}
      <div className="relative flex flex-col items-center">
        <div
          className="w-2.5 sm:w-3 rounded-sm transition-all origin-top"
          style={{
            height: pulled ? 52 : 64,
            background: 'linear-gradient(90deg, #8a7a3a, #c9a84c, #8a7a3a)',
            boxShadow: 'inset -1px 0 2px rgba(0,0,0,0.3), 1px 0 2px rgba(0,0,0,0.2)',
            transition: 'height 0.15s ease-out',
          }}
        />
        {/* Knob */}
        <button
          type="button"
          onClick={handlePull}
          disabled={disabled}
          className="focus:outline-none disabled:cursor-not-allowed group"
          style={{ marginTop: -4 }}
          aria-label="Pull lever to spin"
        >
          <div
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 transition-transform"
            style={{
              background: 'radial-gradient(circle at 35% 35%, #ff6b6b, #cc2233 50%, #881122)',
              borderColor: '#992233',
              boxShadow: '0 3px 12px rgba(0,0,0,0.5), inset 0 1px 3px rgba(255,255,255,0.3)',
              transform: pulled ? 'translateY(12px) scale(0.95)' : 'translateY(0) scale(1)',
              transition: 'transform 0.15s ease-out',
            }}
          >
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-3 h-1 rounded-full bg-white/25" />
          </div>
        </button>
      </div>
      <span className="text-[9px] font-heading text-mutedForeground mt-1.5 tracking-wider hidden sm:block">PULL</span>
    </div>
  );
}

function formatTimeLeft(expiresAtIso) {
  if (!expiresAtIso) return null;
  try {
    const end = new Date(expiresAtIso);
    const now = new Date();
    const ms = end - now;
    if (ms <= 0) return 'Ended';
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const mins = m % 60;
    return h ? `${h}h ${mins}m` : `${m}m`;
  } catch { return null; }
}

export default function SlotsPage() {
  const [config, setConfig] = useState({ max_bet: 5_000_000, current_state: '', states: [], symbols: [], state_owned: true, ownership_hours: 3 });
  const [ownership, setOwnership] = useState(null);
  const [bet, setBet] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [reelRevealed, setReelRevealed] = useState([false, false, false]);
  const [result, setResult] = useState(null);
  const [displayReels, setDisplayReels] = useState(null);
  const [history, setHistory] = useState([]);
  const [showCoins, setShowCoins] = useState(false);
  const [buyBackOffer, setBuyBackOffer] = useState(null);
  const [ownerMaxBet, setOwnerMaxBet] = useState('');
  const [ownerBuyBack, setOwnerBuyBack] = useState('');
  const [ownerActionLoading, setOwnerActionLoading] = useState(false);
  const [enterLoading, setEnterLoading] = useState(false);

  const fetchConfig = useCallback(() => {
    api.get('/casino/slots/config').then((r) => {
      const d = r.data || {};
      setConfig({
        max_bet: d.max_bet ?? 5_000_000,
        current_state: d.current_state || '',
        states: d.states || [],
        symbols: d.symbols || [],
        state_owned: d.state_owned !== false,
        ownership_hours: d.ownership_hours ?? 3,
      });
    }).catch(() => {});
  }, []);

  const fetchOwnership = useCallback(() => {
    api.get('/casino/slots/ownership').then((r) => {
      const o = r.data || {};
      setOwnership(o);
      if (o.is_owner && o.max_bet != null) setOwnerMaxBet(String(o.max_bet));
      if (o.is_owner && o.buy_back_reward != null) setOwnerBuyBack(String(o.buy_back_reward ?? 0));
    }).catch(() => setOwnership(null));
  }, []);

  const fetchHistory = useCallback(() => {
    api.get('/casino/slots/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchOwnership();
    fetchHistory();
  }, [fetchConfig, fetchOwnership, fetchHistory]);

  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const canSpin = betNum >= 1 && betNum <= (config.max_bet || 5_000_000) && !loading && !spinning;

  const spin = async () => {
    if (!canSpin) return;
    setLoading(true);
    setResult(null);
    setDisplayReels(null);
    setShowCoins(false);
    setReelRevealed([false, false, false]);
    try {
      const res = await api.post('/casino/slots/spin', { bet: betNum });
      const data = res.data || {};
      setLoading(false);
      setSpinning(true);
      setDisplayReels(data.reels || []);
      const t1 = setTimeout(() => setReelRevealed((r) => [true, r[1], r[2]]), SPIN_DURATION_MS);
      const t2 = setTimeout(() => setReelRevealed((r) => [true, true, r[2]]), SPIN_DURATION_MS + REEL_STOP_STAGGER_MS);
      const t3 = setTimeout(() => {
        setReelRevealed([true, true, true]);
        setResult({
          won: data.won,
          payout: data.payout || 0,
          new_balance: data.new_balance,
        });
        setSpinning(false);
        if (data.won) {
          toast.success(`Winner! +${formatMoney(data.payout)}`);
          setShowCoins(true);
          setTimeout(() => setShowCoins(false), 2800);
        } else {
          toast.info('No match. Try again!');
        }
        if (data.new_balance != null) refreshUser(data.new_balance);
        if (data.buy_back_offer) setBuyBackOffer(data.buy_back_offer);
        if (data.ownership_transferred) fetchOwnership();
        fetchConfig();
        fetchHistory();
      }, SPIN_DURATION_MS + REEL_STOP_STAGGER_MS * 2 + 500);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    } catch (e) {
      setLoading(false);
      setSpinning(false);
      setReelRevealed([false, false, false]);
      toast.error(apiErrorDetail(e, 'Spin failed'));
    }
  };

  const enterDraw = async () => {
    setEnterLoading(true);
    try {
      await api.post('/casino/slots/enter', { state: config.current_state });
      toast.success('You have entered the draw. A random winner is chosen when the current owner\'s 3 hours end.');
      fetchOwnership();
      fetchConfig();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Could not enter'));
    } finally {
      setEnterLoading(false);
    }
  };

  const setMaxBet = async () => {
    const val = parseInt(String(ownerMaxBet || '').replace(/\D/g, ''), 10);
    if (Number.isNaN(val) || val < 1) {
      toast.error('Enter a valid max bet');
      return;
    }
    setOwnerActionLoading(true);
    try {
      await api.post('/casino/slots/set-max-bet', { state: config.current_state, max_bet: val });
      toast.success('Max bet updated');
      fetchConfig();
      fetchOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const setBuyBackReward = async () => {
    const val = parseInt(String(ownerBuyBack || '').replace(/\D/g, ''), 10) || 0;
    if (val < 0) {
      toast.error('Enter a non-negative amount');
      return;
    }
    setOwnerActionLoading(true);
    try {
      await api.post('/casino/slots/set-buy-back-reward', { state: config.current_state, amount: val });
      toast.success('Buy-back reward updated');
      fetchOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const relinquish = async () => {
    if (!window.confirm('Give up the slots here? You will not be able to enter the next draw for 3 hours.')) return;
    setOwnerActionLoading(true);
    try {
      await api.post('/casino/slots/relinquish', { state: config.current_state });
      toast.success('You have relinquished the slots.');
      fetchConfig();
      fetchOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const acceptBuyBack = async () => {
    if (!buyBackOffer?.offer_id) return;
    setOwnerActionLoading(true);
    try {
      await api.post('/casino/slots/buy-back/accept', { offer_id: buyBackOffer.offer_id });
      toast.success('Accepted. You received the points and the slots were returned to the previous owner.');
      setBuyBackOffer(null);
      fetchOwnership();
      fetchConfig();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const rejectBuyBack = async () => {
    if (!buyBackOffer?.offer_id) return;
    setOwnerActionLoading(true);
    try {
      await api.post('/casino/slots/buy-back/reject', { offer_id: buyBackOffer.offer_id });
      toast.success('Rejected. You keep the slots.');
      setBuyBackOffer(null);
      fetchOwnership();
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const symbols = config.symbols || [];
  const reelsToShow = displayReels && displayReels.length >= 3 ? displayReels : null;
  const reelSymbolIds = [0, 1, 2].map((i) => {
    if (!reelsToShow || !reelsToShow[i]) return null;
    const s = reelsToShow[i];
    return typeof s === 'string' ? s : s?.id;
  });
  const isWin = !!result?.won;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="slots-page">
      <style>{CG_STYLES}</style>
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
        @keyframes coin-fall {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translateY(500px) rotate(var(--coin-rotate, 360deg)) scale(0.5); opacity: 0; }
        }
        @keyframes cabinet-glow {
          0%, 100% { box-shadow: 0 0 24px rgba(212,175,55,0.2), 0 0 48px rgba(212,175,55,0.08), inset 0 1px 0 rgba(255,255,255,0.06); }
          50% { box-shadow: 0 0 40px rgba(212,175,55,0.5), 0 0 80px rgba(212,175,55,0.2), inset 0 1px 0 rgba(255,255,255,0.06); }
        }
        @keyframes payline-flash {
          0%, 100% { background: rgba(52,211,153,0); }
          50% { background: rgba(52,211,153,0.15); }
        }
        @keyframes chase-blink {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes win-pulse {
          0%, 100% { text-shadow: 0 0 8px rgba(52,211,153,0.4); }
          50% { text-shadow: 0 0 20px rgba(52,211,153,0.8), 0 0 40px rgba(52,211,153,0.3); }
        }
        .animate-coin-fall { animation: coin-fall ease-in forwards; }
        .animate-cabinet-glow { animation: cabinet-glow 1.2s ease-in-out infinite; }
        .animate-payline-flash { animation: payline-flash 0.6s ease-in-out infinite; }
        .animate-win-pulse { animation: win-pulse 1s ease-in-out infinite; }
      `}</style>
      <div className="relative cg-fade-in space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] text-zinc-500 font-heading italic flex items-center gap-1">
              <MapPin size={12} className="text-primary" />
              {ownership?.is_owner ? (
                <>You own · <span className="text-primary font-bold">{config.current_state || '—'}</span> · {config.ownership_hours}h</>
              ) : config.state_owned ? (
                <>State-owned · <span className="text-primary font-bold">{config.current_state || '—'}</span> · play anytime</>
              ) : (
                <>Owned by <span className="text-primary font-bold">{ownership?.owner_username || '?'}</span> · <span className="text-primary font-bold">{config.current_state || '—'}</span></>
              )}
            </p>
          </div>
          <div className="text-xs font-heading text-mutedForeground">
            Max bet: <span className="text-primary font-bold">{formatMoney(config.max_bet)}</span>
          </div>
        </div>

        {/* Enter draw */}
        {ownership?.can_enter && !ownership?.is_owner && (
          <div className={`${styles.panel} rounded-lg border border-primary/20 p-2 flex flex-wrap items-center gap-2`}>
            <LogIn size={14} className="text-primary" />
            <span className="text-xs font-heading text-mutedForeground">
              {ownership.has_entered ? `You're in the draw (${ownership.entries_count ?? 0} entered). Winner chosen at random when current owner's ${config.ownership_hours}h ends.` : 'Enter the draw for a chance to own the slots here for 3 hours.'}
            </span>
            {!ownership.has_entered && (
              <button
                type="button"
                onClick={enterDraw}
                disabled={enterLoading}
                className="bg-primary/20 text-primary rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
              >
                {enterLoading ? '...' : 'Enter'}
              </button>
            )}
          </div>
        )}

        {/* Owner panel */}
        {ownership?.is_owner && (
          <div className={`${styles.panel} rounded-lg border border-primary/30 overflow-hidden`}>
            <div className="px-3 py-2 bg-primary/10 border-b border-primary/20 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-heading font-bold text-primary uppercase flex items-center gap-1.5">
                <User size={12} /> Owner · {config.ownership_hours}h only
              </span>
              {ownership.expires_at && (
                <span className="text-[10px] text-mutedForeground flex items-center gap-1">
                  <Clock size={10} /> {formatTimeLeft(ownership.expires_at) ?? '—'} left
                </span>
              )}
            </div>
            <div className="p-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] text-mutedForeground font-heading">Max bet</label>
                <input
                  type="text"
                  value={ownerMaxBet}
                  onChange={(e) => setOwnerMaxBet(e.target.value)}
                  placeholder={String(config.max_bet)}
                  className="w-24 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs font-heading"
                />
                <button type="button" onClick={setMaxBet} disabled={ownerActionLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50">Set</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] text-mutedForeground font-heading">Buy-back (points)</label>
                <input
                  type="text"
                  value={ownerBuyBack}
                  onChange={(e) => setOwnerBuyBack(e.target.value)}
                  placeholder="0"
                  className="w-20 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs font-heading"
                />
                <button type="button" onClick={setBuyBackReward} disabled={ownerActionLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50">Set</button>
              </div>
              <button type="button" onClick={relinquish} disabled={ownerActionLoading} className="text-[10px] font-heading text-amber-400 hover:text-amber-300 border border-amber-500/40 rounded px-2 py-1">Relinquish</button>
            </div>
          </div>
        )}

        {/* Buy-back offer (you won the table but previous owner offers points to get it back) */}
        {buyBackOffer?.offer_id && (
          <div className={`${styles.panel} rounded-lg border border-amber-500/40 overflow-hidden`}>
            <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[10px] font-heading font-bold text-amber-400 uppercase">
              Buy-back offer: {buyBackOffer.points_offered ?? 0} points for the shortfall
            </div>
            <div className="p-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={acceptBuyBack} disabled={ownerActionLoading} className="bg-emerald-500/20 text-emerald-400 rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-emerald-500/40 hover:bg-emerald-500/30">Accept</button>
              <button type="button" onClick={rejectBuyBack} disabled={ownerActionLoading} className="bg-zinc-700/50 text-foreground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-zinc-600/50">Reject</button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════ SLOT MACHINE ══════════ */}
      <div className="flex justify-center">
        <div className="flex flex-col items-center">
          {/* Main cabinet body */}
          <div
            className={`relative rounded-2xl sm:rounded-3xl transition-shadow duration-500 ${spinning || isWin ? 'animate-cabinet-glow' : ''}`}
            style={{
              background: 'linear-gradient(180deg, #2a2520 0%, #1a1612 30%, #0f0d0a 100%)',
              border: '3px solid transparent',
              borderImage: 'linear-gradient(180deg, #c9a84c, #7a6528 40%, #c9a84c 60%, #5a4a1a) 1',
              borderRadius: 20,
              boxShadow: '0 0 24px rgba(212,175,55,0.15), 0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
              padding: '0 0 12px 0',
              overflow: 'hidden',
            }}
          >
            <FallingCoins active={showCoins} />

            {/* ── Marquee ── */}
            <div
              className="relative mx-auto rounded-b-lg overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, #2a1f0f, #1a140a)',
                border: '2px solid #7a6528',
                borderTop: 'none',
                width: 'calc(100% - 24px)',
                margin: '0 12px',
                padding: '10px 16px 8px',
              }}
            >
              <ChasingLights count={28} active={spinning || isWin} />
              <div className="text-center relative z-20">
                <div
                  className="font-heading font-black text-lg sm:text-xl uppercase tracking-[0.25em]"
                  style={{
                    background: 'linear-gradient(180deg, #ffd700 0%, #c9a84c 40%, #ffd700 60%, #b8941e 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                    textShadow: 'none',
                  }}
                >
                  LUCKY 7
                </div>
                <div className="text-[9px] font-heading text-amber-600/70 tracking-[0.3em] uppercase mt-0.5">
                  Triple Jackpot
                </div>
              </div>
            </div>

            {/* ── Reel area + Lever ── */}
            <div className="flex items-center justify-center px-3 sm:px-5 pt-4 pb-2">
              {/* Reel housing */}
              <div className="flex flex-col items-center">
                {/* Chrome frame around reels */}
                <div
                  className="relative rounded-lg p-[3px]"
                  style={{
                    background: 'linear-gradient(135deg, #c9a84c, #7a6528 30%, #c9a84c 50%, #5a4a1a 70%, #c9a84c)',
                  }}
                >
                  <div
                    className="relative rounded-md overflow-hidden flex gap-[2px] p-1"
                    style={{
                      background: 'linear-gradient(180deg, #0a0a0a, #151515, #0a0a0a)',
                    }}
                  >
                    {/* Reels */}
                    {[0, 1, 2].map((i) => (
                      <Reel
                        key={i}
                        spinning={spinning}
                        revealed={reelRevealed[i]}
                        symbolId={reelSymbolIds[i]}
                        reelIndex={i}
                        isWin={isWin}
                      />
                    ))}
                  </div>
                  {/* Decorative screws */}
                  {[
                    { top: 3, left: 3 }, { top: 3, right: 3 },
                    { bottom: 3, left: 3 }, { bottom: 3, right: 3 },
                  ].map((pos, i) => (
                    <div
                      key={i}
                      className="absolute w-2 h-2 rounded-full"
                      style={{
                        ...pos,
                        background: 'radial-gradient(circle at 40% 40%, #c9a84c, #5a4a1a)',
                        boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.5)',
                      }}
                    />
                  ))}
                </div>

                {/* Payline labels */}
                <div className="flex justify-between w-full px-1 mt-1">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-[2px] rounded-full bg-primary/50" />
                    <span className="text-[8px] font-heading text-primary/50 uppercase">Pay</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] font-heading text-primary/50 uppercase">Line</span>
                    <div className="w-3 h-[2px] rounded-full bg-primary/50" />
                  </div>
                </div>
              </div>

              {/* Lever */}
              <Lever onPull={spin} disabled={!canSpin} />
            </div>

            {/* ── Coin tray ── */}
            <div className="mx-3 sm:mx-5 mb-1">
              <div
                className="relative rounded-b-lg overflow-hidden"
                style={{
                  height: 20,
                  background: 'linear-gradient(180deg, #1a1612, #0f0d0a)',
                  borderLeft: '2px solid #5a4a1a',
                  borderRight: '2px solid #5a4a1a',
                  borderBottom: '2px solid #5a4a1a',
                  boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.6)',
                }}
              >
                <div
                  className="absolute top-0 left-[10%] right-[10%] h-[2px] rounded-full"
                  style={{ background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.3), transparent)' }}
                />
                {isWin && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[8px] text-primary/50 font-heading animate-pulse">🪙 🪙 🪙</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Result display ── */}
            <div className="min-h-[28px] flex items-center justify-center">
              {result && (
                <div className={`text-center font-heading ${isWin ? 'text-emerald-400 animate-win-pulse' : 'text-mutedForeground'}`}>
                  <span className={`text-base sm:text-lg font-bold ${isWin ? '' : 'text-sm'}`}>
                    {isWin ? `+${formatMoney(result.payout)}` : 'No match'}
                  </span>
                  {result.new_balance != null && (
                    <span className="block text-[10px] text-mutedForeground">Bal: {formatMoney(result.new_balance)}</span>
                  )}
                </div>
              )}
            </div>

            {/* ── Bet controls ── */}
            <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-3 pt-1">
              <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2 border border-primary/20">
                <label className="text-[10px] font-heading text-mutedForeground uppercase tracking-wider">Bet</label>
                <FormattedNumberInput
                  value={bet}
                  onChange={(raw) => setBet(raw)}
                  placeholder="1,000"
                  className="w-20 sm:w-24 bg-black/40 border border-primary/30 rounded px-2 py-1 text-sm font-heading text-foreground focus:border-primary focus:outline-none text-center"
                />
              </div>
              <button
                onClick={spin}
                disabled={!canSpin}
                className="relative overflow-hidden rounded-lg px-7 sm:px-10 py-2.5 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
                style={{
                  background: 'linear-gradient(180deg, #d4af37, #a08020, #8a6e18)',
                  borderColor: '#c9a84c',
                  color: '#1a1200',
                  boxShadow: '0 4px 16px rgba(212,175,55,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                }}
              >
                <span className="relative z-10">
                  {loading ? '...' : spinning ? 'Spinning' : 'SPIN'}
                </span>
              </button>
            </div>

            {/* ── Cabinet base plate ── */}
            <div
              className="mx-auto"
              style={{
                width: 'calc(100% + 6px)',
                marginLeft: -3,
                height: 8,
                background: 'linear-gradient(180deg, #3a3020, #1a1612)',
                borderTop: '1px solid #5a4a1a',
                borderRadius: '0 0 16px 16px',
              }}
            />
          </div>

          {/* Cabinet feet */}
          <div className="flex justify-between" style={{ width: 'calc(100% - 40px)' }}>
            {[0, 1].map((i) => (
              <div
                key={i}
                className="w-8 h-2 rounded-b-md"
                style={{
                  background: 'linear-gradient(180deg, #5a4a1a, #3a2a0a)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ══════════ PAYTABLE ══════════ */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Paytable (3 of a kind)</h2>
        </div>
        <div className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-heading">
            {symbols.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded bg-secondary/30 px-2 py-1.5 border border-border/50">
                <span>
                  {getSymbolEmoji(s.id)} {s.name}
                </span>
                <span className="text-primary font-bold">{(s.mult_3 ?? s.multiplier) ?? 0}×</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-mutedForeground mt-2">5% house edge on wins. One machine per state.</p>
          {/* Enter the draw — always show when not owner so users find it; server enforces cooldown */}
          <div className="mt-3 pt-3 border-t border-primary/20">
            {ownership?.is_owner ? (
              <p className="text-[10px] text-primary font-heading">You own this machine for {config.ownership_hours}h. Set max bet and buy-back above.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {ownership?.has_entered ? (
                  <p className="text-[10px] text-mutedForeground font-heading">
                    You&apos;re in the draw ({ownership.entries_count ?? 0} entered). Winner chosen at random when current owner&apos;s {config.ownership_hours}h ends.
                  </p>
                ) : (
                  <>
                    <p className="text-[10px] text-mutedForeground font-heading">Enter the draw for a chance to own the slots here for {config.ownership_hours} hours (set max bet and buy-back like other casinos).</p>
                    <button
                      type="button"
                      onClick={enterDraw}
                      disabled={enterLoading}
                      className="bg-primary text-primary-foreground rounded px-4 py-2 text-xs font-bold uppercase border border-primary hover:opacity-90 disabled:opacity-50"
                    >
                      {enterLoading ? '...' : 'Enter the draw'}
                    </button>
                    <p className="text-[10px] text-zinc-500 font-heading italic">If the button says you can&apos;t enter, you may be on cooldown from a previous run.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════ HISTORY ══════════ */}
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
                      return <span key={j}>{getSymbolEmoji(id)}</span>;
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
