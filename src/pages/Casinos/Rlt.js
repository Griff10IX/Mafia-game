import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const SPIN_DURATION_MS = 4000;

// European wheel order (clockwise from 0 at top)
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
// Standard European roulette red numbers
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const RED = new Set(RED_NUMBERS);
const isRed = (n) => RED.has(n);
const CHIPS = [
  { label: '100K', value: 100_000 },
  { label: '1M', value: 1_000_000 },
  { label: '10M', value: 10_000_000 },
  { label: '100M', value: 100_000_000 },
  { label: '1B', value: 1_000_000_000 },
  { label: '10B', value: 10_000_000_000 },
  { label: '100B', value: 100_000_000_000 },
];

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function getPayout(type, selection, amount) {
  if (type === 'straight') return amount * 36;
  if (type === 'dozen' || type === 'column') return amount * 3;
  return amount * 2;
}

function betLabel(type, selection) {
  if (type === 'straight') return `#${selection}`;
  if (type === 'dozen') return `${(Number(selection) - 1) * 12 + 1}-${Number(selection) * 12}`;
  if (type === 'column') return `${['1st', '2nd', '3rd'][Number(selection) - 1]} Col`;
  return String(selection ?? type).replace(/\b\w/g, (c) => c.toUpperCase());
}

function RouletteWheel({ rotationDeg, size = 260 }) {
  const r = size / 2;
  const segmentAngle = 360 / WHEEL_ORDER.length;
  const innerR = r - 22;
  return (
    <div className="relative rounded-full bg-zinc-900 border-4 border-zinc-600 shadow-xl" style={{ width: size, height: size }}>
      {/* Inner dark circle */}
      <div 
        className="absolute rounded-full bg-zinc-950 border-2 border-zinc-700"
        style={{ width: size * 0.55, height: size * 0.55, left: size * 0.225, top: size * 0.225 }}
      />
      {/* Ball / pointer fixed at top */}
      <div
        className="absolute left-1/2 z-10 w-4 h-4 rounded-full bg-white border-2 border-zinc-400 shadow-lg"
        style={{ top: 2, transform: 'translateX(-50%)' }}
        aria-hidden
      />
      {/* Wheel track that rotates */}
      <div
        className="roulette-wheel-track absolute rounded-full overflow-visible"
        style={{ width: size, height: size, transform: `rotate(${rotationDeg}deg)`, transition: 'transform 4s cubic-bezier(0.2, 0.8, 0.3, 1)' }}
      >
        {WHEEL_ORDER.map((num, i) => {
          const deg = i * segmentAngle;
          const rad = ((deg - 90) * Math.PI) / 180;
          const x = r + innerR * Math.cos(rad);
          const y = r + innerR * Math.sin(rad);
          const numIsZero = num === 0;
          const numIsRed = isRed(num);
          return (
            <div
              key={`${num}-${i}`}
              className="absolute flex items-center justify-center text-[10px] font-bold shadow-sm"
              style={{
                width: 18,
                height: 18,
                left: x - 9,
                top: y - 9,
                borderRadius: '50%',
                background: numIsZero ? '#059669' : numIsRed ? '#dc2626' : '#18181b',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.3)',
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              }}
            >
              {num}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Rlt() {
  const [config, setConfig] = useState({ max_bet: 50_000_000 });
  const [ownership, setOwnership] = useState(null);
  const [selectedChip, setSelectedChip] = useState(1_000_000);
  const [customChip, setCustomChip] = useState('');
  const [bets, setBets] = useState([]);
  const [useAnimation, setUseAnimation] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [wheelTargetResult, setWheelTargetResult] = useState(null); // result we're animating to
  const [wheelRotation, setWheelRotation] = useState(0);
  const [recentNumbers, setRecentNumbers] = useState([]);
  const spinTimeoutRef = useRef(null);
  const pendingResultRef = useRef(null);
  
  // Owner panel state
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [ownerLoading, setOwnerLoading] = useState(false);

  const fetchOwnership = () => {
    api.get('/casino/roulette/ownership').then((r) => {
      console.log('Roulette ownership:', r.data);
      setOwnership(r.data);
      if (r.data?.max_bet) {
        setConfig((prev) => ({ ...prev, max_bet: r.data.max_bet }));
      }
    }).catch((e) => {
      console.error('Roulette ownership error:', e);
    });
  };

  useEffect(() => {
    api.get('/casino/roulette/config').then((r) => setConfig(r.data || { max_bet: 50_000_000 })).catch(() => {});
    fetchOwnership();
  }, []);

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    };
  }, []);

  // When we have a target result, animate wheel to that position (after a frame so transition runs)
  useEffect(() => {
    if (wheelTargetResult == null) return;
    const idx = WHEEL_ORDER.indexOf(wheelTargetResult);
    if (idx < 0) return;
    const segmentAngle = 360 / 37;
    const finalRotation = 5 * 360 - idx * segmentAngle;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setWheelRotation(finalRotation));
    });
    return () => cancelAnimationFrame(id);
  }, [wheelTargetResult]);

  const chipValue = customChip ? (parseInt(String(customChip).replace(/\D/g, ''), 10) || 0) : selectedChip;
  const totalBet = bets.reduce((s, b) => s + b.amount, 0);
  const totalReturns = bets.reduce((s, b) => s + getPayout(b.type, b.selection, b.amount), 0);
  const canSpin = bets.length > 0 && totalBet <= (config.max_bet || 0) && !spinning;

  const addBet = (type, selection) => {
    if (!chipValue || chipValue <= 0) {
      toast.error('Select a chip amount');
      return;
    }
    if (totalBet + chipValue > (config.max_bet || 0)) {
      toast.error(`Max total bet is ${formatMoney(config.max_bet)}`);
      return;
    }
    setBets((prev) => [...prev, { id: Date.now() + Math.random(), type, selection, amount: chipValue }]);
  };

  const removeBet = (id) => setBets((prev) => prev.filter((b) => b.id !== id));
  const clearBets = () => setBets([]);

  const applyResult = (data) => {
    setWheelTargetResult(null);
    setLastResult(data.result);
    setRecentNumbers((prev) => [data.result, ...prev].slice(0, 12));
    if (data.win) {
      toast.success(`Landed on ${data.result}! You won ${formatMoney(data.total_payout)}.`);
    } else {
      toast.error(`Landed on ${data.result}. You lost ${formatMoney(data.total_stake)}.`);
    }
    refreshUser();
    setSpinning(false);
  };

  const spin = async () => {
    if (!canSpin) return;
    setSpinning(true);
    setLastResult(null);
    setWheelRotation(0);
    setWheelTargetResult(null);
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    try {
      const payload = bets.map((b) => ({
        type: b.type,
        selection: b.type === 'straight' ? Number(b.selection) : b.selection,
        amount: b.amount,
      }));
      const res = await api.post('/casino/roulette/spin', { bets: payload });
      const data = res.data || {};
      if (!useAnimation) {
        applyResult(data);
        return;
      }
      pendingResultRef.current = data;
      setWheelTargetResult(data.result);
      spinTimeoutRef.current = setTimeout(() => {
        spinTimeoutRef.current = null;
        const pending = pendingResultRef.current;
        if (pending) applyResult(pending);
      }, SPIN_DURATION_MS);
    } catch (e) {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      setWheelTargetResult(null);
      toast.error(e.response?.data?.detail || 'Spin failed');
      setSpinning(false);
    }
  };

  // Owner actions
  const handleClaim = async () => {
    if (!ownership?.current_city) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/claim', { city: ownership.current_city });
      toast.success('You now own this roulette table!');
      fetchOwnership();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim');
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleRelinquish = async () => {
    if (!ownership?.current_city) return;
    if (!window.confirm('Are you sure you want to give up ownership?')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/relinquish', { city: ownership.current_city });
      toast.success('Ownership relinquished');
      fetchOwnership();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleSetMaxBet = async () => {
    if (!ownership?.current_city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1000000) {
      toast.error('Min max bet is $1,000,000');
      return;
    }
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/set-max-bet', { city: ownership.current_city, max_bet: val });
      toast.success('Max bet updated');
      fetchOwnership();
      setNewMaxBet('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!ownership?.current_city || !transferUsername.trim()) return;
    if (!window.confirm(`Transfer ownership to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/send-to-user', { city: ownership.current_city, target_username: transferUsername.trim() });
      toast.success('Ownership transferred');
      fetchOwnership();
      setTransferUsername('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
  };

  const isOwner = !!ownership?.is_owner;
  const currentCity = ownership?.current_city || '—';
  const canClaim = ownership?.is_unclaimed && !ownership?.owner_id;

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="roulette-page">
      <div>
        <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2">Roulette</h1>
        <p className="text-sm text-mutedForeground">Place your bets. Playing in {currentCity}.</p>
        {ownership && (
          <div className="mt-3 p-3 bg-card border border-border rounded-sm text-sm">
            {isOwner ? (
              <p className="text-foreground">You own the roulette table here: you gain 2.7% of all bets placed.</p>
            ) : ownership?.owner_name ? (
              <p className="text-mutedForeground">Owned by <span className="text-foreground font-medium">{ownership.owner_name}</span>. The owner earns 2.7% of all bets.</p>
            ) : (
              <p className="text-mutedForeground">No owner. Wins and losses are against the house.</p>
            )}
            <div className="flex gap-2 mt-2">
              {canClaim && (
                <button type="button" onClick={handleClaim} disabled={ownerLoading} className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                  {ownerLoading ? '...' : 'Claim ownership'}
                </button>
              )}
              {isOwner && (
                <button type="button" onClick={handleRelinquish} disabled={ownerLoading} className="bg-secondary border border-border text-foreground hover:bg-secondary/80 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                  {ownerLoading ? '...' : 'Relinquish'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Owner Panel */}
      {isOwner && (
        <div className={`${styles.panel} border-2 border-primary rounded-md overflow-hidden`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
            <h3 className="text-lg font-heading font-semibold text-primary">Owner Controls</h3>
            <p className="text-sm text-mutedForeground">Manage your roulette table in {currentCity}</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-secondary/30 rounded-sm p-3">
                <p className="text-xs text-mutedForeground uppercase tracking-wider mb-1">Total Earnings</p>
                <p className="text-xl font-heading font-bold text-primary">{formatMoney(ownership?.total_earnings || 0)}</p>
              </div>
              <div className="bg-secondary/30 rounded-sm p-3">
                <p className="text-xs text-mutedForeground uppercase tracking-wider mb-1">Current Max Bet</p>
                <p className="text-xl font-heading font-bold text-foreground">{formatMoney(ownership?.max_bet || config.max_bet)}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-mutedForeground mb-2">Set Max Bet</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 100000000"
                  value={newMaxBet}
                  onChange={(e) => setNewMaxBet(e.target.value)}
                  className="flex-1 bg-input border border-border rounded-sm h-10 px-3 text-foreground text-sm"
                />
                <button
                  onClick={handleSetMaxBet}
                  disabled={ownerLoading}
                  className="bg-primary text-primaryForeground px-4 rounded-sm font-bold text-sm hover:opacity-90 disabled:opacity-50"
                >
                  Set
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-mutedForeground mb-2">Transfer Ownership</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username"
                  value={transferUsername}
                  onChange={(e) => setTransferUsername(e.target.value)}
                  className="flex-1 bg-input border border-border rounded-sm h-10 px-3 text-foreground text-sm"
                />
                <button
                  onClick={handleTransfer}
                  disabled={ownerLoading || !transferUsername.trim()}
                  className="bg-secondary text-foreground px-4 rounded-sm font-bold text-sm hover:opacity-90 disabled:opacity-50"
                >
                  Transfer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bet controls at top + result + table (only when not owner) */}
      {!isOwner && (
      <>
        {/* TOP: Chips, animation, spin, current bets — so no scrolling to place bet */}
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <h3 className="text-xs sm:text-sm font-heading font-bold text-primary tracking-widest uppercase">Chips &amp; Spin</h3>
          </div>
          <div className="p-3 space-y-2">
            {/* Chips row */}
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {CHIPS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => { setSelectedChip(c.value); setCustomChip(''); }}
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full text-[9px] sm:text-[10px] font-heading font-bold transition-all border-2 ${
                    selectedChip === c.value && !customChip
                      ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border-yellow-500 shadow-lg scale-110'
                      : 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-300 border-zinc-600 hover:border-primary/50'
                  }`}
                >
                  {c.label}
                </button>
              ))}
              <span className="text-[9px] text-primary/60 font-heading mx-1">Custom:</span>
              <div className="relative">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-primary/60 text-[10px] font-heading">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Amt"
                  value={customChip}
                  onChange={(e) => setCustomChip(e.target.value)}
                  className="w-16 sm:w-20 bg-zinc-900 border border-primary/30 rounded h-6 sm:h-7 pl-4 pr-1 text-[10px] sm:text-xs text-foreground font-heading focus:border-primary/60"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
              <span className="text-mutedForeground">Bet: <span className="font-medium text-foreground">{formatMoney(totalBet)}</span></span>
              <span className="text-mutedForeground">Returns: <span className="font-medium text-primary">{formatMoney(totalReturns)}</span></span>
              <label className="flex items-center gap-1.5 cursor-pointer text-mutedForeground">
                <input type="checkbox" checked={useAnimation} onChange={(e) => setUseAnimation(e.target.checked)} className="rounded border-border bg-input text-primary" />
                Use animation?
              </label>
            </div>
            <button
              type="button"
              onClick={spin}
              disabled={!canSpin}
              className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-2 sm:py-2.5 text-sm transition-smooth disabled:opacity-50"
            >
              Spin Wheel
            </button>
            {bets.length > 0 && (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-primary/10">
                <div className="flex flex-wrap gap-1.5 min-w-0 flex-1">
                  {bets.slice(0, 6).map((b) => (
                    <span key={b.id} className="inline-flex items-center gap-0.5 text-[10px] bg-secondary/50 px-1.5 py-0.5 rounded">
                      {betLabel(b.type, b.selection)} {formatMoney(b.amount)}
                      <button type="button" onClick={() => removeBet(b.id)} className="text-destructive hover:underline ml-0.5">×</button>
                    </span>
                  ))}
                  {bets.length > 6 && <span className="text-[10px] text-mutedForeground">+{bets.length - 6}</span>}
                </div>
                <button type="button" onClick={clearBets} className="text-[10px] text-mutedForeground hover:text-foreground shrink-0">Clear all</button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Result first on mobile so it's visible without scrolling */}
          <div className="bg-card border border-border rounded-sm overflow-hidden order-2 lg:order-1">
            <div className="px-3 py-2 bg-secondary/40 border-b border-border">
              <h3 className="text-sm font-heading font-semibold text-foreground">Result</h3>
              <p className="text-xs text-mutedForeground">European single zero · Max {formatMoney(config.max_bet)}</p>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex flex-col items-center justify-center py-4 sm:py-5 px-3 rounded-sm bg-secondary/20 border border-border min-h-[140px] sm:min-h-[180px]">
                {wheelTargetResult !== null ? (
                  <>
                    <p className="text-[10px] sm:text-xs text-mutedForeground uppercase tracking-wider mb-2">Spinning…</p>
                    <RouletteWheel rotationDeg={wheelRotation} size={160} />
                  </>
                ) : lastResult !== null ? (
                  <>
                    <p className="text-[10px] sm:text-xs text-mutedForeground uppercase tracking-wider mb-1 sm:mb-2">Landed on</p>
                    <div
                      className={`inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full text-2xl sm:text-3xl font-heading font-bold tabular-nums animate-roulette-reveal ${
                        lastResult === 0 ? 'bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/40' : isRed(lastResult) ? 'bg-red-500/20 text-red-400 border-2 border-red-500/40' : 'bg-zinc-500/20 text-zinc-300 border-2 border-zinc-500/40'
                      }`}
                    >
                      {lastResult}
                    </div>
                  </>
                ) : (
                  <p className="text-xs sm:text-sm text-mutedForeground text-center">Place bets and spin. Result appears here.</p>
                )}
              </div>
              {recentNumbers.length > 0 && (
                <div className="text-[10px] sm:text-xs">
                  <span className="text-mutedForeground">Recent: </span>
                  <span className="font-mono break-all">
                    {recentNumbers.map((n, i) => (
                      <span key={`${n}-${i}`} className={n === 0 ? 'text-emerald-400' : isRed(n) ? 'text-red-400' : 'text-zinc-400'}>
                        {n}{i < recentNumbers.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* The Table - betting grid */}
          <div className={`${styles.panel} rounded-md overflow-hidden order-1 lg:order-2`}>
            <div className="px-2 sm:px-3 py-1.5 sm:py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/40">
              <h3 className="text-xs sm:text-sm font-heading font-bold text-primary tracking-widest uppercase">The Table</h3>
            </div>
            <div className="p-2 sm:p-3 space-y-1.5">
              <div className="border border-primary/40 rounded-sm overflow-hidden shadow-inner">
                <button
                  type="button"
                  onClick={() => addBet('straight', 0)}
                  className="w-full h-6 sm:h-7 bg-gradient-to-b from-emerald-800 to-emerald-900 hover:from-emerald-700 text-white font-heading font-bold text-sm tracking-wider border-b border-primary/30"
                >
                  0
                </button>
                <div className="grid grid-cols-3">
                  {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => addBet('straight', n)}
                      className={`h-5 sm:h-6 font-heading font-bold text-[10px] sm:text-xs border-b border-r border-zinc-800/80 hover:brightness-125 ${
                        isRed(n) ? 'bg-red-800 hover:bg-red-700 text-white' : 'bg-zinc-900 hover:bg-zinc-800 text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 border-t border-primary/30">
                  {[1, 2, 3].map((col) => (
                    <button key={col} type="button" onClick={() => addBet('column', col)} className="py-0.5 bg-zinc-900/80 hover:bg-zinc-800 text-primary/80 text-[9px] font-heading border-r border-zinc-800 last:border-r-0">
                      2:1
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-6 gap-0.5 sm:gap-1">
                <button type="button" onClick={() => addBet('dozen', 1)} className="col-span-2 py-1 sm:py-1.5 bg-zinc-900 hover:bg-zinc-800 text-foreground/80 text-[8px] sm:text-[10px] font-heading border border-primary/20 hover:border-primary/40">1st 12</button>
                <button type="button" onClick={() => addBet('dozen', 2)} className="col-span-2 py-1 sm:py-1.5 bg-zinc-900 hover:bg-zinc-800 text-foreground/80 text-[8px] sm:text-[10px] font-heading border border-primary/20 hover:border-primary/40">2nd 12</button>
                <button type="button" onClick={() => addBet('dozen', 3)} className="col-span-2 py-1 sm:py-1.5 bg-zinc-900 hover:bg-zinc-800 text-foreground/80 text-[8px] sm:text-[10px] font-heading border border-primary/20 hover:border-primary/40">3rd 12</button>
                <button type="button" onClick={() => addBet('low', 'low')} className="py-1 sm:py-1.5 bg-zinc-900 hover:bg-zinc-800 text-foreground/80 text-[8px] sm:text-[10px] font-heading border border-primary/20 hover:border-primary/40">1-18</button>
                <button type="button" onClick={() => addBet('even', 'even')} className="py-1 sm:py-1.5 bg-zinc-900 hover:bg-zinc-800 text-foreground/80 text-[8px] sm:text-[10px] font-heading border border-primary/20 hover:border-primary/40">Even</button>
                <button type="button" onClick={() => addBet('red', 'red')} className="py-1 sm:py-1.5 bg-gradient-to-b from-red-800 to-red-900 hover:from-red-700 text-white text-[8px] sm:text-[10px] font-heading font-bold border border-red-700/50">Red</button>
                <button type="button" onClick={() => addBet('black', 'black')} className="py-1 sm:py-1.5 bg-gradient-to-b from-zinc-800 to-zinc-900 hover:from-zinc-700 text-white text-[8px] sm:text-[10px] font-heading font-bold border border-zinc-600/50">Black</button>
                <button type="button" onClick={() => addBet('odd', 'odd')} className="py-1 sm:py-1.5 bg-zinc-900 hover:bg-zinc-800 text-foreground/80 text-[8px] sm:text-[10px] font-heading border border-primary/20 hover:border-primary/40">Odd</button>
                <button type="button" onClick={() => addBet('high', 'high')} className="py-1 sm:py-1.5 bg-zinc-900 hover:bg-zinc-800 text-foreground/80 text-[8px] sm:text-[10px] font-heading border border-primary/20 hover:border-primary/40">19-36</button>
              </div>
            </div>
          </div>
        </div>
      </>
      )}
    </div>
  );
}
