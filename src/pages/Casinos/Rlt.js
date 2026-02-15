import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
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

// Utility functions
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

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = ({ currentCity }) => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2">
      Roulette
    </h1>
    <p className="text-sm text-mutedForeground">
      Place your bets. Playing in {currentCity}.
    </p>
  </div>
);

const OwnershipCard = ({ ownership, onClaim, onRelinquish, loading }) => {
  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.is_unclaimed && !ownership?.owner_id;

  return (
    <div className="bg-card border border-primary/20 rounded-md p-4">
      {isOwner ? (
        <p className="text-sm text-foreground mb-3">
          ✓ You own the roulette table here: you gain 2.7% of all bets placed.
        </p>
      ) : ownership?.owner_name ? (
        <p className="text-sm text-mutedForeground mb-3">
          Owned by <span className="text-foreground font-bold">{ownership.owner_name}</span>. The owner earns 2.7% of all bets.
        </p>
      ) : (
        <p className="text-sm text-mutedForeground mb-3">
          No owner. Wins and losses are against the house.
        </p>
      )}
      
      <div className="flex gap-2">
        {canClaim && (
          <button 
            type="button" 
            onClick={onClaim} 
            disabled={loading} 
            className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground rounded-md px-4 py-2 text-sm font-bold uppercase tracking-wide border border-yellow-600/50 transition-all disabled:opacity-50 touch-manipulation"
          >
            {loading ? '...' : '🏆 Claim Ownership'}
          </button>
        )}
        {isOwner && (
          <button 
            type="button" 
            onClick={onRelinquish} 
            disabled={loading} 
            className="bg-secondary border border-border text-foreground hover:bg-secondary/80 rounded-md px-4 py-2 text-sm font-bold uppercase tracking-wide transition-all disabled:opacity-50 touch-manipulation"
          >
            {loading ? '...' : 'Relinquish'}
          </button>
        )}
      </div>
    </div>
  );
};

const OwnerControlsCard = ({ ownership, config, onSetMaxBet, onTransfer, onSellOnTrade, loading, newMaxBet, setNewMaxBet, transferUsername, setTransferUsername, sellPoints, setSellPoints }) => (
  <div className="bg-card rounded-md overflow-hidden border-2 border-primary/40">
    <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
      <h3 className="text-lg font-heading font-bold text-primary">Owner Controls</h3>
      <p className="text-sm text-mutedForeground">
        Manage your roulette table in {ownership?.current_city}
      </p>
    </div>
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-secondary/30 rounded-md p-4">
          <p className="text-xs text-mutedForeground uppercase tracking-wider mb-1">
            Profit / Loss
          </p>
          <p className={`text-2xl font-heading font-bold ${
            (ownership?.profit ?? ownership?.total_earnings ?? 0) >= 0 ? 'text-primary' : 'text-red-400'
          }`}>
            {formatMoney(ownership?.profit ?? ownership?.total_earnings ?? 0)}
          </p>
        </div>
        <div className="bg-secondary/30 rounded-md p-4">
          <p className="text-xs text-mutedForeground uppercase tracking-wider mb-1">
            Current Max Bet
          </p>
          <p className="text-2xl font-heading font-bold text-foreground">
            {formatMoney(ownership?.max_bet || config.max_bet)}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-heading text-mutedForeground uppercase tracking-wider mb-2">
          Set Max Bet
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. 100000000"
            value={newMaxBet}
            onChange={(e) => setNewMaxBet(e.target.value)}
            className="flex-1 bg-input border border-border rounded-md h-10 px-3 text-foreground text-sm focus:border-primary/50 focus:outline-none"
          />
          <button
            onClick={onSetMaxBet}
            disabled={loading}
            className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground px-6 rounded-md font-bold text-sm border border-yellow-600/50 transition-all disabled:opacity-50 touch-manipulation"
          >
            Set
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-heading text-mutedForeground uppercase tracking-wider mb-2">
          Transfer Ownership
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Username"
            value={transferUsername}
            onChange={(e) => setTransferUsername(e.target.value)}
            className="flex-1 bg-input border border-border rounded-md h-10 px-3 text-foreground text-sm focus:border-primary/50 focus:outline-none"
          />
          <button
            onClick={onTransfer}
            disabled={loading || !transferUsername.trim()}
            className="bg-secondary text-foreground px-6 rounded-md font-bold text-sm border border-border hover:bg-secondary/80 transition-all disabled:opacity-50 touch-manipulation"
          >
            Transfer
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-heading text-mutedForeground uppercase tracking-wider mb-2">
          Sell on Quick Trade (Points)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="10000"
            value={sellPoints}
            onChange={(e) => setSellPoints(e.target.value)}
            className="flex-1 bg-input border border-border rounded-md h-10 px-3 text-foreground text-sm focus:border-primary/50 focus:outline-none"
          />
          <button
            onClick={onSellOnTrade}
            disabled={loading}
            className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground px-6 rounded-md font-bold text-sm border border-yellow-600/50 transition-all disabled:opacity-50 touch-manipulation"
          >
            Set
          </button>
        </div>
      </div>
    </div>
  </div>
);

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
        style={{ 
          width: size, 
          height: size, 
          transform: `rotate(${rotationDeg}deg)`, 
          transition: 'transform 4s cubic-bezier(0.2, 0.8, 0.3, 1)' 
        }}
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

const ChipSelector = ({ chips, selectedChip, customChip, onSelectChip, onCustomChange }) => (
  <div className="flex flex-wrap items-center justify-center gap-2">
    {chips.map((c) => (
      <button
        key={c.value}
        type="button"
        onClick={() => onSelectChip(c.value)}
        className={`w-10 h-10 md:w-12 md:h-12 rounded-full text-xs md:text-sm font-heading font-bold transition-all border-2 ${
          selectedChip === c.value && !customChip
            ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border-yellow-500 shadow-lg scale-110'
            : 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-300 border-zinc-600 hover:border-primary/50'
        }`}
      >
        {c.label}
      </button>
    ))}
    <div className="flex items-center gap-1">
      <span className="text-xs text-mutedForeground">Custom:</span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-mutedForeground text-xs">$</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="Amount"
          value={customChip}
          onChange={(e) => onCustomChange(e.target.value)}
          className="w-24 bg-input border border-border rounded-md h-9 pl-5 pr-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>
    </div>
  </div>
);

const BetControls = ({ totalBet, totalReturns, useAnimation, onToggleAnimation, onSpin, canSpin, bets, onRemoveBet, onClearBets }) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-mutedForeground">
        Bet: <span className="font-bold text-foreground">{formatMoney(totalBet)}</span>
      </span>
      <span className="text-mutedForeground">
        Returns: <span className="font-bold text-primary">{formatMoney(totalReturns)}</span>
      </span>
      <label className="flex items-center gap-2 cursor-pointer text-mutedForeground">
        <input 
          type="checkbox" 
          checked={useAnimation} 
          onChange={(e) => onToggleAnimation(e.target.checked)} 
          className="rounded border-border bg-input text-primary" 
        />
        <span className="text-sm">Animation</span>
      </label>
    </div>
    
    <button
      type="button"
      onClick={onSpin}
      disabled={!canSpin}
      className="w-full bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground rounded-lg font-heading font-bold uppercase tracking-widest py-3 text-base border-2 border-yellow-600/50 transition-all shadow-xl shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
    >
      🎰 Spin Wheel
    </button>
    
    {bets.length > 0 && (
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
        <div className="flex flex-wrap gap-1.5 min-w-0 flex-1">
          {bets.slice(0, 6).map((b) => (
            <span 
              key={b.id} 
              className="inline-flex items-center gap-1 text-xs bg-secondary px-2 py-1 rounded-md border border-border"
            >
              {betLabel(b.type, b.selection)} {formatMoney(b.amount)}
              <button 
                type="button" 
                onClick={() => onRemoveBet(b.id)} 
                className="text-red-400 hover:text-red-300 font-bold"
              >
                ×
              </button>
            </span>
          ))}
          {bets.length > 6 && (
            <span className="text-xs text-mutedForeground">+{bets.length - 6} more</span>
          )}
        </div>
        <button 
          type="button" 
          onClick={onClearBets} 
          className="text-xs text-mutedForeground hover:text-foreground shrink-0"
        >
          Clear all
        </button>
      </div>
    )}
  </div>
);

const ResultCard = ({ wheelTargetResult, wheelRotation, lastResult, recentNumbers, maxBet }) => (
  <div className="bg-card border border-border rounded-md overflow-hidden">
    <div className="px-4 py-2 bg-secondary/30 border-b border-border">
      <h3 className="text-sm font-heading font-bold text-foreground">Result</h3>
      <p className="text-xs text-mutedForeground">
        European single zero · Max {formatMoney(maxBet)}
      </p>
    </div>
    <div className="p-4 space-y-3">
      <div className="flex flex-col items-center justify-center py-6 px-3 rounded-md bg-secondary/20 border border-border min-h-[200px]">
        {wheelTargetResult !== null ? (
          <>
            <p className="text-xs text-mutedForeground uppercase tracking-wider mb-3">
              Spinning…
            </p>
            <RouletteWheel rotationDeg={wheelRotation} size={180} />
          </>
        ) : lastResult !== null ? (
          <>
            <p className="text-xs text-mutedForeground uppercase tracking-wider mb-3">
              Landed on
            </p>
            <div
              className={`inline-flex items-center justify-center w-20 h-20 rounded-full text-4xl font-heading font-bold tabular-nums animate-pulse ${
                lastResult === 0 
                  ? 'bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/40' 
                  : isRed(lastResult) 
                  ? 'bg-red-500/20 text-red-400 border-2 border-red-500/40' 
                  : 'bg-zinc-500/20 text-zinc-300 border-2 border-zinc-500/40'
              }`}
            >
              {lastResult}
            </div>
          </>
        ) : (
          <p className="text-sm text-mutedForeground text-center">
            Place bets and spin. Result appears here.
          </p>
        )}
      </div>
      
      {recentNumbers.length > 0 && (
        <div className="text-xs">
          <span className="text-mutedForeground">Recent: </span>
          <span className="font-mono">
            {recentNumbers.map((n, i) => (
              <span 
                key={`${n}-${i}`} 
                className={n === 0 ? 'text-emerald-400 font-bold' : isRed(n) ? 'text-red-400 font-bold' : 'text-zinc-400'}
              >
                {n}{i < recentNumbers.length - 1 ? ', ' : ''}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  </div>
);

const BettingTable = ({ onAddBet }) => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        The Table
      </h3>
    </div>
    <div className="p-3 md:p-4 space-y-2">
      <div className="border-2 border-primary/40 rounded-md overflow-hidden shadow-inner">
        <button
          type="button"
          onClick={() => onAddBet('straight', 0)}
          className="w-full h-8 bg-gradient-to-b from-emerald-700 to-emerald-900 hover:from-emerald-600 text-white font-heading font-bold text-base tracking-wider border-b border-primary/30 transition-all"
        >
          0
        </button>
        <div className="grid grid-cols-3">
          {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onAddBet('straight', n)}
              className={`h-7 md:h-8 font-heading font-bold text-sm border-b border-r border-zinc-800/80 hover:brightness-125 transition-all ${
                isRed(n) 
                  ? 'bg-red-800 hover:bg-red-700 text-white' 
                  : 'bg-zinc-900 hover:bg-zinc-800 text-white'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 border-t border-primary/30">
          {[1, 2, 3].map((col) => (
            <button 
              key={col} 
              type="button" 
              onClick={() => onAddBet('column', col)} 
              className="py-1.5 bg-zinc-900/80 hover:bg-zinc-800 text-primary text-xs font-heading font-bold border-r border-zinc-800 last:border-r-0 transition-all"
            >
              2:1
            </button>
          ))}
        </div>
      </div>
      
      <div className="grid grid-cols-6 gap-1">
        <button type="button" onClick={() => onAddBet('dozen', 1)} className="col-span-2 py-2 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs font-heading font-bold border border-primary/20 hover:border-primary/40 rounded transition-all">1st 12</button>
        <button type="button" onClick={() => onAddBet('dozen', 2)} className="col-span-2 py-2 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs font-heading font-bold border border-primary/20 hover:border-primary/40 rounded transition-all">2nd 12</button>
        <button type="button" onClick={() => onAddBet('dozen', 3)} className="col-span-2 py-2 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs font-heading font-bold border border-primary/20 hover:border-primary/40 rounded transition-all">3rd 12</button>
        <button type="button" onClick={() => onAddBet('low', 'low')} className="py-2 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs font-heading font-bold border border-primary/20 hover:border-primary/40 rounded transition-all">1-18</button>
        <button type="button" onClick={() => onAddBet('even', 'even')} className="py-2 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs font-heading font-bold border border-primary/20 hover:border-primary/40 rounded transition-all">Even</button>
        <button type="button" onClick={() => onAddBet('red', 'red')} className="py-2 bg-gradient-to-b from-red-800 to-red-900 hover:from-red-700 text-white text-xs font-heading font-bold border border-red-700/50 rounded transition-all">Red</button>
        <button type="button" onClick={() => onAddBet('black', 'black')} className="py-2 bg-gradient-to-b from-zinc-800 to-zinc-900 hover:from-zinc-700 text-white text-xs font-heading font-bold border border-zinc-600/50 rounded transition-all">Black</button>
        <button type="button" onClick={() => onAddBet('odd', 'odd')} className="py-2 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs font-heading font-bold border border-primary/20 hover:border-primary/40 rounded transition-all">Odd</button>
        <button type="button" onClick={() => onAddBet('high', 'high')} className="py-2 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs font-heading font-bold border border-primary/20 hover:border-primary/40 rounded transition-all">19-36</button>
      </div>
    </div>
  </div>
);

// Main component
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
  
  // Owner panel state
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [sellPoints, setSellPoints] = useState('');
  const [ownerLoading, setOwnerLoading] = useState(false);

  const COLLAPSED_KEY = 'mafia_rlt_collapsed';
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_) {}
    return {};
  });
  const toggleSection = (id) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };
  const isCollapsed = (id) => !!collapsedSections[id];

  const fetchOwnership = () => {
    api.get('/casino/roulette/ownership').then((r) => {
      setOwnership(r.data);
      if (r.data?.max_bet) {
        setConfig((prev) => ({ ...prev, max_bet: r.data.max_bet }));
      }
    }).catch((e) => {
      console.error('Roulette ownership error:', e);
    });
  };

  useEffect(() => {
    api.get('/casino/roulette/config')
      .then((r) => setConfig(r.data || { max_bet: 50_000_000 }))
      .catch(() => {});
    fetchOwnership();
  }, []);

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    };
  }, []);

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
      await api.post('/casino/roulette/send-to-user', { 
        city: ownership.current_city, 
        target_username: transferUsername.trim() 
      });
      toast.success('Ownership transferred');
      fetchOwnership();
      setTransferUsername('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleSellOnTrade = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    
    const points = parseInt(sellPoints);
    if (!points || points <= 0) {
      toast.error('Enter a valid point amount');
      return;
    }

    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/sell-on-trade', { city, points });
      toast.success(`Listed for ${points.toLocaleString()} points on Quick Trade!`);
      setSellPoints('');
      setTimeout(() => navigate('/quick-trade'), 1500);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to list');
    } finally {
      setOwnerLoading(false);
    }
  };

  const isOwner = !!ownership?.is_owner;
  const currentCity = ownership?.current_city || '—';

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="roulette-page">
      <PageHeader currentCity={currentCity} />

      {ownership && (
        <div className="bg-card border border-primary/20 rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('ownership')}
            className="w-full px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center gap-2 text-left hover:bg-primary/15 transition-colors"
          >
            <span className="shrink-0 text-primary/80">{isCollapsed('ownership') ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</span>
            <span className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Ownership</span>
          </button>
          {!isCollapsed('ownership') && (
            <div className="p-4 pt-0">
              <OwnershipCard
                ownership={ownership}
                onClaim={handleClaim}
                onRelinquish={handleRelinquish}
                loading={ownerLoading}
              />
            </div>
          )}
        </div>
      )}

      {isOwner && (
        <div className="bg-card rounded-md overflow-hidden border-2 border-primary/40">
          <button
            type="button"
            onClick={() => toggleSection('ownerControls')}
            className="w-full px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center gap-2 text-left hover:bg-primary/15 transition-colors"
          >
            <span className="shrink-0 text-primary/80">{isCollapsed('ownerControls') ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</span>
            <span className="text-lg font-heading font-bold text-primary">Owner Controls</span>
          </button>
          {!isCollapsed('ownerControls') && (
            <OwnerControlsCard
          ownership={ownership}
          config={config}
          onSetMaxBet={handleSetMaxBet}
          onTransfer={handleTransfer}
          onSellOnTrade={handleSellOnTrade}
          loading={ownerLoading}
          newMaxBet={newMaxBet}
          setNewMaxBet={setNewMaxBet}
          transferUsername={transferUsername}
          setTransferUsername={setTransferUsername}
          sellPoints={sellPoints}
          setSellPoints={setSellPoints}
            />
          )}
        </div>
      )}

      {!isOwner && (
        <>
          <div className="bg-card rounded-md overflow-hidden border border-primary/20">
            <button
              type="button"
              onClick={() => toggleSection('chipsControls')}
              className="w-full px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center gap-2 text-left hover:bg-primary/15 transition-colors"
            >
              <span className="shrink-0 text-primary/80">{isCollapsed('chipsControls') ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</span>
              <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
                Chips & Controls
              </h3>
            </button>
            {!isCollapsed('chipsControls') && (
            <div className="p-4 space-y-4">
              <ChipSelector
                chips={CHIPS}
                selectedChip={selectedChip}
                customChip={customChip}
                onSelectChip={(val) => { setSelectedChip(val); setCustomChip(''); }}
                onCustomChange={setCustomChip}
              />
              
              <BetControls
                totalBet={totalBet}
                totalReturns={totalReturns}
                useAnimation={useAnimation}
                onToggleAnimation={setUseAnimation}
                onSpin={spin}
                canSpin={canSpin}
                bets={bets}
                onRemoveBet={removeBet}
                onClearBets={clearBets}
              />
            </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {/* Combined Roulette Table - Wheel + Betting Grid */}
            <div className="lg:col-span-2">
              <div className="bg-card border border-primary/20 rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('rouletteTable')}
                  className="w-full px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center gap-2 text-left hover:bg-primary/15 transition-colors"
                >
                  <span className="shrink-0 text-primary/80">{isCollapsed('rouletteTable') ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</span>
                  <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
                    Roulette Table
                  </h3>
                  <p className="text-xs text-mutedForeground">
                    European single zero · Max {formatMoney(config.max_bet)}
                  </p>
                </button>
                {!isCollapsed('rouletteTable') && (
                <div className="p-4 md:p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* LEFT: Wheel and Result */}
                    <div className="lg:col-span-1 space-y-4">
                      <div className="flex flex-col items-center justify-center py-6 px-3 rounded-md bg-secondary/20 border border-border">
                        {wheelTargetResult !== null ? (
                          <>
                            <p className="text-xs text-mutedForeground uppercase tracking-wider mb-3">
                              Spinning…
                            </p>
                            <RouletteWheel rotationDeg={wheelRotation} size={220} />
                          </>
                        ) : lastResult !== null ? (
                          <>
                            <p className="text-xs text-mutedForeground uppercase tracking-wider mb-3">
                              Landed on
                            </p>
                            <div
                              className={`inline-flex items-center justify-center w-24 h-24 rounded-full text-5xl font-heading font-bold tabular-nums animate-pulse ${
                                lastResult === 0 
                                  ? 'bg-emerald-500/20 text-emerald-400 border-4 border-emerald-500/40' 
                                  : isRed(lastResult) 
                                  ? 'bg-red-500/20 text-red-400 border-4 border-red-500/40' 
                                  : 'bg-zinc-500/20 text-zinc-300 border-4 border-zinc-500/40'
                              }`}
                            >
                              {lastResult}
                            </div>
                          </>
                        ) : (
                          <>
                            <RouletteWheel rotationDeg={0} size={220} />
                            <p className="text-sm text-mutedForeground text-center mt-4">
                              Place bets and spin
                            </p>
                          </>
                        )}
                      </div>
                      
                      {recentNumbers.length > 0 && (
                        <div className="bg-secondary/20 border border-border rounded-md p-3">
                          <p className="text-xs text-mutedForeground uppercase tracking-wider mb-2">
                            Recent Numbers
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {recentNumbers.map((n, i) => (
                              <div
                                key={`${n}-${i}`}
                                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                  n === 0 
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' 
                                    : isRed(n) 
                                    ? 'bg-red-500/20 text-red-400 border border-red-500/40' 
                                    : 'bg-zinc-500/20 text-zinc-300 border border-zinc-500/40'
                                }`}
                              >
                                {n}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* RIGHT: Betting Grid */}
                    <div className="lg:col-span-2 space-y-3">
                      <div className="border-2 border-primary/40 rounded-md overflow-hidden shadow-inner">
                        <button
                          type="button"
                          onClick={() => addBet('straight', 0)}
                          className="w-full h-10 md:h-12 bg-gradient-to-b from-emerald-700 to-emerald-900 hover:from-emerald-600 text-white font-heading font-bold text-lg tracking-wider border-b-2 border-emerald-950 transition-all"
                        >
                          0
                        </button>
                        <div className="grid grid-cols-3">
                          {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => addBet('straight', n)}
                              className={`h-10 md:h-12 font-heading font-bold text-base md:text-lg border-b border-r border-zinc-950 hover:brightness-125 active:scale-95 transition-all ${
                                isRed(n) 
                                  ? 'bg-red-800 hover:bg-red-700 text-white' 
                                  : 'bg-zinc-900 hover:bg-zinc-800 text-white'
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-3 border-t-2 border-primary/30">
                          {[1, 2, 3].map((col) => (
                            <button 
                              key={col} 
                              type="button" 
                              onClick={() => addBet('column', col)} 
                              className="py-2 bg-zinc-900/80 hover:bg-zinc-800 text-primary text-sm font-heading font-bold border-r border-zinc-800 last:border-r-0 transition-all active:scale-95"
                            >
                              2:1
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-6 gap-1 md:gap-2">
                        <button type="button" onClick={() => addBet('dozen', 1)} className="col-span-2 py-2.5 md:py-3 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs md:text-sm font-heading font-bold border border-primary/20 hover:border-primary/40 rounded-md transition-all active:scale-95">1st 12</button>
                        <button type="button" onClick={() => addBet('dozen', 2)} className="col-span-2 py-2.5 md:py-3 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs md:text-sm font-heading font-bold border border-primary/20 hover:border-primary/40 rounded-md transition-all active:scale-95">2nd 12</button>
                        <button type="button" onClick={() => addBet('dozen', 3)} className="col-span-2 py-2.5 md:py-3 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs md:text-sm font-heading font-bold border border-primary/20 hover:border-primary/40 rounded-md transition-all active:scale-95">3rd 12</button>
                        <button type="button" onClick={() => addBet('low', 'low')} className="py-2.5 md:py-3 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs md:text-sm font-heading font-bold border border-primary/20 hover:border-primary/40 rounded-md transition-all active:scale-95">1-18</button>
                        <button type="button" onClick={() => addBet('even', 'even')} className="py-2.5 md:py-3 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs md:text-sm font-heading font-bold border border-primary/20 hover:border-primary/40 rounded-md transition-all active:scale-95">Even</button>
                        <button type="button" onClick={() => addBet('red', 'red')} className="py-2.5 md:py-3 bg-gradient-to-b from-red-800 to-red-900 hover:from-red-700 text-white text-xs md:text-sm font-heading font-bold border border-red-700/50 rounded-md transition-all active:scale-95">Red</button>
                        <button type="button" onClick={() => addBet('black', 'black')} className="py-2.5 md:py-3 bg-gradient-to-b from-zinc-800 to-zinc-900 hover:from-zinc-700 text-white text-xs md:text-sm font-heading font-bold border border-zinc-600/50 rounded-md transition-all active:scale-95">Black</button>
                        <button type="button" onClick={() => addBet('odd', 'odd')} className="py-2.5 md:py-3 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs md:text-sm font-heading font-bold border border-primary/20 hover:border-primary/40 rounded-md transition-all active:scale-95">Odd</button>
                        <button type="button" onClick={() => addBet('high', 'high')} className="py-2.5 md:py-3 bg-zinc-900 hover:bg-zinc-800 text-foreground text-xs md:text-sm font-heading font-bold border border-primary/20 hover:border-primary/40 rounded-md transition-all active:scale-95">19-36</button>
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
