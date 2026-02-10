import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';

const SPIN_DURATION_MS = 4000;

// European wheel order (clockwise from 0 at top)
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
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

function RouletteWheel({ rotationDeg, size = 220 }) {
  const r = size / 2;
  const segmentAngle = 360 / WHEEL_ORDER.length;
  const innerR = r - 18;
  return (
    <div className="relative rounded-full bg-zinc-800 border-4 border-zinc-600 shadow-xl" style={{ width: size, height: size }}>
      {/* Ball / pointer fixed at top */}
      <div
        className="absolute left-1/2 z-10 w-5 h-5 rounded-full bg-primary border-2 border-primaryForeground shadow-lg"
        style={{ top: -4, transform: 'translateX(-50%)' }}
        aria-hidden
      />
      {/* Wheel track that rotates */}
      <div
        className="roulette-wheel-track absolute rounded-full overflow-visible"
        style={{ width: size, height: size, transform: `rotate(${rotationDeg}deg)` }}
      >
        {WHEEL_ORDER.map((num, i) => {
          const deg = i * segmentAngle;
          const rad = ((deg - 90) * Math.PI) / 180;
          const x = r + innerR * Math.cos(rad);
          const y = r + innerR * Math.sin(rad);
          const isZero = num === 0;
          const isRed = RED.has(num);
          return (
            <div
              key={`${num}-${i}`}
              className="absolute w-8 h-6 flex items-center justify-center text-xs font-bold rounded-sm border border-black/30"
              style={{
                left: x - 16,
                top: y - 12,
                background: isZero ? '#047857' : isRed ? '#b91c1c' : '#27272a',
                color: '#fff',
                transform: `rotate(${deg}deg)`,
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

  useEffect(() => {
    api.get('/casino/roulette/config').then((r) => setConfig(r.data || { max_bet: 50_000_000 })).catch(() => {});
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

  return (
    <div className="space-y-8" data-testid="roulette-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Roulette</h1>
        <p className="text-mutedForeground">Place your bets</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Betting grid */}
        <div className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="px-4 py-3 bg-secondary/40 border-b border-border">
            <h3 className="text-lg font-heading font-semibold text-foreground">Roulette</h3>
            <p className="text-sm text-mutedForeground">Place your bets</p>
          </div>
          <div className="p-4 space-y-4">
            {/* 0 */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => addBet('straight', 0)}
                className="w-12 h-10 rounded-sm bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-sm transition-smooth"
              >
                0
              </button>
            </div>
            {/* 1-36 in 3 columns */}
            <div className="grid grid-cols-3 gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => addBet('straight', n)}
                  className={`h-9 rounded-sm font-bold text-sm transition-smooth ${
                    RED.has(n) ? 'bg-red-800 hover:bg-red-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {/* Outside bets */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <button type="button" onClick={() => addBet('column', 1)} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                1st Col
              </button>
              <button type="button" onClick={() => addBet('column', 2)} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                2nd Col
              </button>
              <button type="button" onClick={() => addBet('column', 3)} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                3rd Col
              </button>
              <button type="button" onClick={() => addBet('dozen', 1)} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                1-12
              </button>
              <button type="button" onClick={() => addBet('dozen', 2)} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                13-24
              </button>
              <button type="button" onClick={() => addBet('dozen', 3)} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                25-36
              </button>
              <button type="button" onClick={() => addBet('low', 'low')} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                1 to 18
              </button>
              <button type="button" onClick={() => addBet('high', 'high')} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                19 to 36
              </button>
              <button type="button" onClick={() => addBet('even', 'even')} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                EVEN
              </button>
              <button type="button" onClick={() => addBet('odd', 'odd')} className="py-2 rounded-sm bg-secondary hover:bg-secondary/80 text-foreground font-medium">
                ODD
              </button>
              <button type="button" onClick={() => addBet('red', 'red')} className="py-2 rounded-sm bg-red-800 hover:bg-red-700 text-white font-medium">
                RED
              </button>
              <button type="button" onClick={() => addBet('black', 'black')} className="py-2 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-white font-medium">
                BLACK
              </button>
            </div>
            {/* Chips */}
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Chip</p>
              <div className="flex flex-wrap gap-2">
                {CHIPS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setSelectedChip(c.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-smooth ${
                      selectedChip === c.value ? 'bg-primary text-primaryForeground border-primary' : 'bg-secondary border-border text-foreground hover:border-primary/50'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-mutedForeground">Custom:</span>
                <span className="text-mutedForeground">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Amount"
                  value={customChip}
                  onChange={(e) => setCustomChip(e.target.value)}
                  className="w-28 bg-input border border-border rounded-sm h-8 px-2 text-sm text-foreground"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Current bets + spin + result */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-sm overflow-hidden">
            <div className="px-4 py-3 bg-secondary/40 border-b border-border">
              <h3 className="text-lg font-heading font-semibold text-foreground">Current Bets</h3>
              <p className="text-sm text-mutedForeground">Review your bets & place them</p>
            </div>
            <div className="p-4 space-y-3">
              {bets.length === 0 ? (
                <p className="text-sm text-mutedForeground py-4">No bets yet. Select a chip and click the grid.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {bets.map((b) => (
                    <div key={b.id} className="flex items-center justify-between gap-2 py-2 border-b border-border text-sm last:border-0">
                      <span className="font-medium text-foreground">{betLabel(b.type, b.selection)}</span>
                      <span className="text-mutedForeground">{formatMoney(b.amount)}</span>
                      <span className="text-primary font-mono">{formatMoney(getPayout(b.type, b.selection, b.amount))}</span>
                      <button type="button" onClick={() => removeBet(b.id)} className="text-destructive hover:underline text-xs">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {bets.length > 0 && (
                <button type="button" onClick={clearBets} className="w-full text-sm text-mutedForeground hover:text-foreground border border-border rounded-sm py-1.5">
                  Clear Bets
                </button>
              )}
              <div className="flex justify-between text-sm pt-2">
                <span className="text-mutedForeground">Total Bet:</span>
                <span className="font-medium">{formatMoney(totalBet)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-mutedForeground">Total Returns:</span>
                <span className="font-medium text-primary">{formatMoney(totalReturns)}</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-mutedForeground mt-2">
                <input type="checkbox" checked={useAnimation} onChange={(e) => setUseAnimation(e.target.checked)} className="rounded border-border bg-input text-primary" />
                Use animation?
              </label>
              <button
                type="button"
                onClick={spin}
                disabled={!canSpin}
                className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50 mt-2"
              >
                Spin Wheel
              </button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-sm overflow-hidden">
            <div className="px-4 py-3 bg-secondary/40 border-b border-border">
              <h3 className="text-lg font-heading font-semibold text-foreground">Roulette Info</h3>
              <p className="text-sm text-mutedForeground">European single zero</p>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex flex-col items-center justify-center py-6 px-4 rounded-sm bg-secondary/20 border border-border min-h-[260px]">
                {wheelTargetResult !== null ? (
                  <>
                    <p className="text-xs text-mutedForeground uppercase tracking-wider mb-3">Spinning…</p>
                    <RouletteWheel rotationDeg={wheelRotation} size={220} />
                  </>
                ) : lastResult !== null ? (
                  <>
                    <p className="text-xs text-mutedForeground uppercase tracking-wider mb-2">Landed on</p>
                    <div
                      className={`inline-flex items-center justify-center w-16 h-16 rounded-full text-3xl font-heading font-bold tabular-nums animate-roulette-reveal ${
                        lastResult === 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : RED.has(lastResult) ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-zinc-500/20 text-zinc-300 border border-zinc-500/40'
                      }`}
                    >
                      {lastResult}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-mutedForeground">Place bets and spin. Result will appear here.</p>
                )}
              </div>
              {recentNumbers.length > 0 && (
                <div className="text-sm">
                  <span className="text-mutedForeground">Recent: </span>
                  <span className="font-mono">
                    {recentNumbers.map((n, i) => (
                      <span key={`${n}-${i}`} className={n === 0 ? 'text-emerald-400' : RED.has(n) ? 'text-red-400' : 'text-zinc-400'}>
                        {n}{i < recentNumbers.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <p className="text-mutedForeground text-sm"><span className="text-foreground font-medium">Max bet:</span> {formatMoney(config.max_bet)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
