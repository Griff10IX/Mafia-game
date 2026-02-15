import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const SPIN_DURATION_MS = 4000;

// European wheel order
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const RED = new Set(RED_NUMBERS);
const isRed = (n) => RED.has(n);

const CHIPS = [
  { label: '100K', value: 100_000 },
  { label: '1M', value: 1_000_000 },
  { label: '10M', value: 10_000_000 },
  { label: '100M', value: 100_000_000 },
  { label: '1B', value: 1_000_000_000 },
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
  if (type === 'column') return `Col ${selection}`;
  return String(selection ?? type).replace(/\b\w/g, (c) => c.toUpperCase());
}

// Compact Roulette Wheel
function RouletteWheel({ rotationDeg, size = 200 }) {
  const r = size / 2;
  const segmentAngle = 360 / WHEEL_ORDER.length;
  const innerR = r * 0.75;
  const numSize = Math.max(12, size * 0.08);
  
  return (
    <div className="relative rounded-full bg-zinc-900 border-4 border-zinc-600 shadow-xl overflow-hidden" style={{ width: size, height: size }}>
      {/* Inner dark circle */}
      <div className="absolute rounded-full bg-zinc-950 border-2 border-zinc-700 z-20" style={{ width: size * 0.45, height: size * 0.45, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
      {/* Ball pointer at top */}
      <div className="absolute left-1/2 z-30 w-3 h-3 rounded-full bg-white border-2 border-zinc-400 shadow-lg" style={{ top: 4, transform: 'translateX(-50%)' }} />
      {/* Rotating wheel track */}
      <div 
        className="absolute inset-0 rounded-full z-10"
        style={{ 
          transform: `rotate(${rotationDeg}deg)`, 
          transformOrigin: '50% 50%',
          transition: 'transform 4s cubic-bezier(0.2, 0.8, 0.3, 1)',
          willChange: 'transform'
        }}
      >
        {WHEEL_ORDER.map((num, i) => {
          const deg = i * segmentAngle;
          const rad = ((deg - 90) * Math.PI) / 180;
          const x = r + innerR * Math.cos(rad);
          const y = r + innerR * Math.sin(rad);
          return (
            <div
              key={`${num}-${i}`}
              className="absolute flex items-center justify-center font-bold"
              style={{
                width: numSize,
                height: numSize,
                left: x,
                top: y,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                fontSize: Math.max(7, size * 0.045),
                background: num === 0 ? '#059669' : isRed(num) ? '#dc2626' : '#18181b',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.3)',
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
  const navigate = useNavigate();
  const [config, setConfig] = useState({ max_bet: 50_000_000 });
  const [ownership, setOwnership] = useState(null);
  const [selectedChip, setSelectedChip] = useState(1_000_000);
  const [customChip, setCustomChip] = useState('');
  const [bets, setBets] = useState([]);
  const [useAnimation, setUseAnimation] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [wheelTargetResult, setWheelTargetResult] = useState(null);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [recentNumbers, setRecentNumbers] = useState([]);
  const spinTimeoutRef = useRef(null);
  const pendingResultRef = useRef(null);
  
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [sellPoints, setSellPoints] = useState('');
  const [ownerLoading, setOwnerLoading] = useState(false);

  const fetchOwnership = () => {
    api.get('/casino/roulette/ownership').then((r) => {
      setOwnership(r.data);
      if (r.data?.max_bet) setConfig((prev) => ({ ...prev, max_bet: r.data.max_bet }));
    }).catch(() => {});
  };

  useEffect(() => {
    api.get('/casino/roulette/config').then((r) => setConfig(r.data || { max_bet: 50_000_000 })).catch(() => {});
    fetchOwnership();
  }, []);

  useEffect(() => () => { if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current); }, []);

  useEffect(() => {
    if (wheelTargetResult == null) return;
    const idx = WHEEL_ORDER.indexOf(wheelTargetResult);
    if (idx < 0) return;
    const segmentAngle = 360 / 37;
    const finalRotation = 5 * 360 - idx * segmentAngle;
    requestAnimationFrame(() => requestAnimationFrame(() => setWheelRotation(finalRotation)));
  }, [wheelTargetResult]);

  const chipValue = customChip ? (parseInt(String(customChip).replace(/\D/g, ''), 10) || 0) : selectedChip;
  const totalBet = bets.reduce((s, b) => s + b.amount, 0);
  const totalReturns = bets.reduce((s, b) => s + getPayout(b.type, b.selection, b.amount), 0);
  const canSpin = bets.length > 0 && totalBet <= (config.max_bet || 0) && !spinning;
  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.is_unclaimed && !ownership?.owner_id;
  const currentCity = ownership?.current_city || '—';

  const addBet = (type, selection) => {
    if (!chipValue || chipValue <= 0) { toast.error('Select chip amount'); return; }
    if (totalBet + chipValue > (config.max_bet || 0)) { toast.error(`Max bet ${formatMoney(config.max_bet)}`); return; }
    setBets((prev) => [...prev, { id: Date.now() + Math.random(), type, selection, amount: chipValue }]);
  };

  const removeBet = (id) => setBets((prev) => prev.filter((b) => b.id !== id));
  const clearBets = () => setBets([]);

  const applyResult = (data) => {
    setWheelTargetResult(null);
    setLastResult(data.result);
    setRecentNumbers((prev) => [data.result, ...prev].slice(0, 10));
    if (data.win) toast.success(`Landed ${data.result}! Won ${formatMoney(data.total_payout)}`);
    else toast.error(`Landed ${data.result}. Lost ${formatMoney(data.total_stake)}`);
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
      const payload = bets.map((b) => ({ type: b.type, selection: b.type === 'straight' ? Number(b.selection) : b.selection, amount: b.amount }));
      const res = await api.post('/casino/roulette/spin', { bets: payload });
      const data = res.data || {};
      
      if (!useAnimation) { applyResult(data); return; }
      
      pendingResultRef.current = data;
      setWheelTargetResult(data.result);
      spinTimeoutRef.current = setTimeout(() => {
        spinTimeoutRef.current = null;
        if (pendingResultRef.current) applyResult(pendingResultRef.current);
      }, SPIN_DURATION_MS);
    } catch (e) {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      setWheelTargetResult(null);
      toast.error(e.response?.data?.detail || 'Spin failed');
      setSpinning(false);
    }
  };

  const handleClaim = async () => {
    if (!ownership?.current_city) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/claim', { city: ownership.current_city });
      toast.success('You own this table!');
      fetchOwnership();
      refreshUser();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleRelinquish = async () => {
    if (!ownership?.current_city || !window.confirm('Give up ownership?')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/relinquish', { city: ownership.current_city });
      toast.success('Relinquished');
      fetchOwnership();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleSetMaxBet = async () => {
    if (!ownership?.current_city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1000000) { toast.error('Min $1,000,000'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/set-max-bet', { city: ownership.current_city, max_bet: val });
      toast.success('Updated');
      fetchOwnership();
      setNewMaxBet('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleTransfer = async () => {
    if (!ownership?.current_city || !transferUsername.trim() || !window.confirm(`Transfer to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/send-to-user', { city: ownership.current_city, target_username: transferUsername.trim() });
      toast.success('Transferred');
      fetchOwnership();
      setTransferUsername('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleSellOnTrade = async () => {
    if (!ownership?.current_city || ownerLoading) return;
    const points = parseInt(sellPoints);
    if (!points || points <= 0) { toast.error('Enter valid points'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/sell-on-trade', { city: ownership.current_city, points });
      toast.success(`Listed for ${points.toLocaleString()} pts!`);
      setSellPoints('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="roulette-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
            🎰 Roulette
          </h1>
          <p className="text-xs text-mutedForeground">
            Playing in <span className="text-primary font-bold">{currentCity}</span>
            {ownership?.owner_name && !isOwner && <span> · Owned by <span className="text-foreground">{ownership.owner_name}</span></span>}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-heading">
          <span className="text-mutedForeground">Max: <span className="text-primary font-bold">{formatMoney(config.max_bet)}</span></span>
          {canClaim && (
            <button onClick={handleClaim} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">
              Claim
            </button>
          )}
        </div>
      </div>

      {/* Owner Controls */}
      {isOwner && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/30`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">👑 Owner Controls</span>
            <span className={`text-xs font-heading font-bold ${(ownership?.profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              P/L: {formatMoney(ownership?.profit ?? ownership?.total_earnings ?? 0)}
            </span>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Max Bet</span>
              <input type="text" placeholder="e.g. 100000000" value={newMaxBet} onChange={(e) => setNewMaxBet(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSetMaxBet} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">Set</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Transfer</span>
              <input type="text" placeholder="Username" value={transferUsername} onChange={(e) => setTransferUsername(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleTransfer} disabled={ownerLoading || !transferUsername.trim()} className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 disabled:opacity-50">Send</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Sell (pts)</span>
              <input type="text" inputMode="numeric" placeholder="10000" value={sellPoints} onChange={(e) => setSellPoints(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSellOnTrade} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">List</button>
            </div>
            <div className="flex justify-end">
              <button onClick={handleRelinquish} disabled={ownerLoading} className="text-[10px] text-red-400 hover:text-red-300 font-heading">Relinquish</button>
            </div>
          </div>
        </div>
      )}

      {/* Game Area */}
      {!isOwner && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🎰 Table</span>
            <div className="flex items-center gap-3 text-[10px] text-mutedForeground">
              <span>Bet: <span className="text-foreground font-bold">{formatMoney(totalBet)}</span></span>
              <span>Returns: <span className="text-primary font-bold">{formatMoney(totalReturns)}</span></span>
            </div>
          </div>
          
          <div className="p-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Left: Result + Chips */}
              <div className="md:col-span-1 space-y-3">
                {/* Result display */}
                <div className="flex flex-col items-center py-3 px-2 rounded bg-zinc-800/30 border border-zinc-700/30">
                  {wheelTargetResult !== null ? (
                    <>
                      <p className="text-[10px] text-mutedForeground uppercase mb-1 animate-pulse">Spinning…</p>
                      <RouletteWheel rotationDeg={wheelRotation} size={100} />
                    </>
                  ) : lastResult !== null ? (
                    <>
                      <p className="text-[10px] text-mutedForeground uppercase mb-1">Landed on</p>
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-heading font-bold ${
                        lastResult === 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : isRed(lastResult) ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                        : 'bg-zinc-500/20 text-zinc-300 border border-zinc-500/40'
                      }`}>
                        {lastResult}
                      </div>
                    </>
                  ) : (
                    <p className="text-[10px] text-mutedForeground text-center">Place bets<br/>and spin</p>
                  )}
                </div>
                
                {/* Recent numbers */}
                {recentNumbers.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 justify-center">
                    {recentNumbers.slice(0, 8).map((n, i) => (
                      <div key={`${n}-${i}`} className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                        n === 0 ? 'bg-emerald-500/30 text-emerald-400' : isRed(n) ? 'bg-red-500/30 text-red-400' : 'bg-zinc-600/30 text-zinc-300'
                      }`}>{n}</div>
                    ))}
                  </div>
                )}

                {/* Chips */}
                <div className="flex flex-wrap gap-1 justify-center">
                  {CHIPS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => { setSelectedChip(c.value); setCustomChip(''); }}
                      className={`w-8 h-8 rounded-full text-[9px] font-bold border-2 transition-all ${
                        selectedChip === c.value && !customChip
                          ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border-yellow-500 scale-105'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-600 hover:border-primary/50'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                
                {/* Custom chip */}
                <div className="flex items-center gap-1 justify-center">
                  <span className="text-[10px] text-mutedForeground">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Custom"
                    value={customChip}
                    onChange={(e) => setCustomChip(e.target.value)}
                    className="w-16 bg-zinc-900/50 border border-zinc-700/50 rounded px-1.5 py-1 text-[10px] text-foreground text-center focus:border-primary/50 focus:outline-none"
                  />
                </div>

                {/* Spin button */}
                <button
                  onClick={spin}
                  disabled={!canSpin}
                  className="w-full bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-2 text-xs font-heading font-bold uppercase border border-yellow-600/50 shadow shadow-primary/20 disabled:opacity-50 transition-all touch-manipulation"
                >
                  🎰 Spin
                </button>
                
                {/* Animation toggle */}
                <label className="flex items-center gap-1.5 justify-center cursor-pointer">
                  <input type="checkbox" checked={useAnimation} onChange={(e) => setUseAnimation(e.target.checked)} className="w-3 h-3 rounded border-zinc-600" />
                  <span className="text-[10px] text-mutedForeground">Animation</span>
                </label>
              </div>
              
              {/* Right: Betting grid */}
              <div className="md:col-span-3 space-y-1.5">
                {/* Zero */}
                <button onClick={() => addBet('straight', 0)} className="w-full h-7 bg-gradient-to-b from-emerald-700 to-emerald-900 hover:from-emerald-600 text-white font-heading font-bold text-sm rounded transition-all">
                  0
                </button>
                
                {/* Numbers grid */}
                <div className="grid grid-cols-6 sm:grid-cols-12 gap-px bg-zinc-900 rounded overflow-hidden">
                  {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => addBet('straight', n)}
                      className={`h-7 font-bold text-xs transition-all active:scale-95 ${
                        isRed(n) ? 'bg-red-800 hover:bg-red-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                
                {/* Columns */}
                <div className="grid grid-cols-3 gap-1">
                  {[1, 2, 3].map((col) => (
                    <button key={col} onClick={() => addBet('column', col)} className="py-1 bg-zinc-800/80 hover:bg-zinc-700 text-primary text-[10px] font-bold rounded transition-all">
                      Col {col} (2:1)
                    </button>
                  ))}
                </div>
                
                {/* Dozens */}
                <div className="grid grid-cols-3 gap-1">
                  <button onClick={() => addBet('dozen', 1)} className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-foreground text-[10px] font-bold rounded border border-zinc-700/50 transition-all">1-12</button>
                  <button onClick={() => addBet('dozen', 2)} className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-foreground text-[10px] font-bold rounded border border-zinc-700/50 transition-all">13-24</button>
                  <button onClick={() => addBet('dozen', 3)} className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-foreground text-[10px] font-bold rounded border border-zinc-700/50 transition-all">25-36</button>
                </div>
                
                {/* Outside bets */}
                <div className="grid grid-cols-6 gap-1">
                  <button onClick={() => addBet('low', 'low')} className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-foreground text-[10px] font-bold rounded border border-zinc-700/50 transition-all">1-18</button>
                  <button onClick={() => addBet('even', 'even')} className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-foreground text-[10px] font-bold rounded border border-zinc-700/50 transition-all">Even</button>
                  <button onClick={() => addBet('red', 'red')} className="py-1.5 bg-red-800 hover:bg-red-700 text-white text-[10px] font-bold rounded border border-red-700/50 transition-all">Red</button>
                  <button onClick={() => addBet('black', 'black')} className="py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-bold rounded border border-zinc-600/50 transition-all">Black</button>
                  <button onClick={() => addBet('odd', 'odd')} className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-foreground text-[10px] font-bold rounded border border-zinc-700/50 transition-all">Odd</button>
                  <button onClick={() => addBet('high', 'high')} className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-foreground text-[10px] font-bold rounded border border-zinc-700/50 transition-all">19-36</button>
                </div>
                
                {/* Current bets */}
                {bets.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-zinc-700/30">
                    {bets.slice(0, 10).map((b) => (
                      <span key={b.id} className="inline-flex items-center gap-0.5 text-[9px] bg-zinc-800/50 px-1 py-0.5 rounded border border-zinc-700/50">
                        {betLabel(b.type, b.selection)}
                        <button onClick={() => removeBet(b.id)} className="text-red-400 hover:text-red-300 font-bold">×</button>
                      </span>
                    ))}
                    {bets.length > 10 && <span className="text-[9px] text-mutedForeground">+{bets.length - 10}</span>}
                    <button onClick={clearBets} className="text-[9px] text-mutedForeground hover:text-foreground ml-auto">Clear</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isOwner && (
        <div className="px-3 py-4 bg-zinc-800/30 border border-zinc-700/30 rounded-md text-center">
          <p className="text-xs text-mutedForeground">You cannot play at your own table. Travel to another city.</p>
        </div>
      )}

      {/* Rules */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">ℹ️ Rules</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>European single zero (2.7% edge)</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Straight up pays 35:1</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Dozens/Columns pay 2:1</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Red/Black/Odd/Even pay 1:1</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
