import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Lock, Trophy, Info, ChevronUp, ChevronDown, Clock, KeyRound } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import styles from '../styles/noir.module.css';

/* ─── Styles ─── */
const CS_STYLES = `
  @keyframes cs-fade-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes cs-jackpot-pulse {
    0%,100% { text-shadow: 0 0 15px rgba(234,179,8,0.4), 0 0 30px rgba(234,179,8,0.1); }
    50% { text-shadow: 0 0 40px rgba(234,179,8,1), 0 0 80px rgba(234,179,8,0.4), 0 0 120px rgba(234,179,8,0.15); }
  }
  @keyframes cs-coin {
    0% { transform: translateY(-10px) rotate(0deg) scale(1); opacity: 1; }
    100% { transform: translateY(160px) rotate(540deg) scale(0.4); opacity: 0; }
  }
  @keyframes cs-door-open {
    0% { transform: perspective(900px) rotateY(0deg); }
    100% { transform: perspective(900px) rotateY(-80deg); }
  }
  @keyframes cs-win-glow {
    0%,100% { box-shadow: 0 0 20px rgba(234,179,8,0.4), inset 0 0 20px rgba(234,179,8,0.05); }
    50% { box-shadow: 0 0 60px rgba(234,179,8,0.9), inset 0 0 40px rgba(234,179,8,0.15); }
  }
  @keyframes cs-shake {
    0%,100% { transform: translateX(0) rotate(0deg); }
    15% { transform: translateX(-7px) rotate(-0.5deg); }
    30% { transform: translateX(7px) rotate(0.5deg); }
    45% { transform: translateX(-5px) rotate(-0.3deg); }
    60% { transform: translateX(5px) rotate(0.3deg); }
    75% { transform: translateX(-3px); }
    90% { transform: translateX(3px); }
  }
  @keyframes cs-num-up {
    0% { transform: translateY(0); opacity: 1; }
    40% { transform: translateY(-130%); opacity: 0; }
    41% { transform: translateY(130%); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
  @keyframes cs-num-down {
    0% { transform: translateY(0); opacity: 1; }
    40% { transform: translateY(130%); opacity: 0; }
    41% { transform: translateY(-130%); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
  @keyframes cs-clue-in { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes cs-rivet-glow { 0%,100% { box-shadow: 0 0 4px rgba(234,179,8,0.3); } 50% { box-shadow: 0 0 10px rgba(234,179,8,0.7); } }
  @keyframes cs-vault-breathe { 0%,100% { box-shadow: 4px 0 20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.03); } 50% { box-shadow: 4px 0 30px rgba(0,0,0,0.9), 0 0 15px rgba(234,179,8,0.05); } }
  @keyframes cs-handle-glint { 0%,80%,100% { opacity: 0; } 90% { opacity: 1; } }
  @keyframes cs-cash-glow { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.4) saturate(1.3); } }

  .cs-fade-in { animation: cs-fade-in 0.4s ease-out both; }
  .cs-jackpot-pulse { animation: cs-jackpot-pulse 2.5s ease-in-out infinite; }
  .cs-shake { animation: cs-shake 0.55s ease-in-out; }
  .cs-win-glow { animation: cs-win-glow 0.9s ease-in-out infinite; }
  .cs-door-open { animation: cs-door-open 1.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) both; transform-origin: left center; }
  .cs-clue-in { animation: cs-clue-in 0.3s ease-out both; }
  .cs-num-up { animation: cs-num-up 0.22s ease-in-out; }
  .cs-num-down { animation: cs-num-down 0.22s ease-in-out; }
  .cs-rivet { animation: cs-rivet-glow 3s ease-in-out infinite; }
  .cs-vault-breathe { animation: cs-vault-breathe 4s ease-in-out infinite; }
  .cs-cash-glow { animation: cs-cash-glow 2s ease-in-out infinite; }
`;

/* ─── Helpers ─── */
function formatMoney(n) {
  return `$${Math.trunc(Number(n ?? 0)).toLocaleString()}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch { return iso; }
}

function formatCountdown(targetIso) {
  if (!targetIso) return '';
  const diff = new Date(targetIso) - new Date();
  if (diff <= 0) return '00:00:00';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ─── SVG Combination Dial ─── */
function SafeDial({ dialAngle, won }) {
  const CX = 90, CY = 90, OUTER_R = 78, TICK_OUTER = 76, NUM_R = 59;
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const ang = (i * 10 - 90) * (Math.PI / 180);
    const isMajor = i % 3 === 0;
    const innerR = isMajor ? TICK_OUTER - 13 : TICK_OUTER - 7;
    return {
      x1: CX + TICK_OUTER * Math.cos(ang),
      y1: CY + TICK_OUTER * Math.sin(ang),
      x2: CX + innerR * Math.cos(ang),
      y2: CY + innerR * Math.sin(ang),
      isMajor,
    };
  });

  const numbers = Array.from({ length: 9 }, (_, i) => {
    const ang = (i * 40 - 90) * (Math.PI / 180);
    return {
      n: i + 1,
      x: CX + NUM_R * Math.cos(ang),
      y: CY + NUM_R * Math.sin(ang),
    };
  });

  return (
    <div style={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }}>
      {/* Chrome outer ring */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'conic-gradient(from 30deg, #555 0%, #888 15%, #555 30%, #999 45%, #555 60%, #888 75%, #555 90%, #999 100%)',
        boxShadow: '0 0 0 3px #0f0f0f, 0 4px 30px rgba(0,0,0,0.9)',
      }} />
      {/* Dark bezel behind SVG */}
      <div style={{
        position: 'absolute', inset: 6, borderRadius: '50%',
        background: '#111', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.9)',
      }} />
      {/* Rotating SVG dial */}
      <svg
        width={180} height={180}
        style={{
          position: 'absolute', inset: 0,
          transform: `rotate(${dialAngle}deg)`,
          transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <defs>
          <radialGradient id="cs-dial-grad" cx="38%" cy="32%" r="65%">
            <stop offset="0%" stopColor="#3a3a3a" />
            <stop offset="70%" stopColor="#1e1e1e" />
            <stop offset="100%" stopColor="#141414" />
          </radialGradient>
          <filter id="cs-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx={CX} cy={CY} r={OUTER_R} fill="url(#cs-dial-grad)" />
        {/* Subtle grooves */}
        {[65, 50, 35].map(r2 => (
          <circle key={r2} cx={CX} cy={CY} r={r2} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
        ))}
        {/* Tick marks */}
        {ticks.map((t, i) => (
          <line key={i}
            x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={t.isMajor ? 'rgba(234,179,8,0.85)' : 'rgba(255,255,255,0.18)'}
            strokeWidth={t.isMajor ? 2 : 1}
            filter={t.isMajor ? 'url(#cs-glow)' : undefined}
          />
        ))}
        {/* Numbers 1–9 */}
        {numbers.map(({ n, x, y }) => (
          <text key={n} x={x} y={y}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={9} fill="rgba(234,179,8,0.9)"
            fontWeight="bold" fontFamily="monospace"
          >{n}</text>
        ))}
      </svg>
      {/* Static red indicator at top */}
      <div style={{
        position: 'absolute', top: 5, left: '50%', transform: 'translateX(-50%)',
        width: 0, height: 0,
        borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
        borderTop: '11px solid rgba(220,38,38,0.95)',
        zIndex: 20, filter: 'drop-shadow(0 0 5px rgba(220,38,38,0.8))',
      }} />
      {/* Center knob */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 34, height: 34, borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 32%, #6a6a6a, #2a2a2a)',
        boxShadow: '0 3px 10px rgba(0,0,0,0.8), inset 0 1px 2px rgba(255,255,255,0.18)',
        zIndex: 15,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ width: 12, height: 3, background: 'rgba(234,179,8,0.9)', borderRadius: 2 }} />
      </div>
      {/* Win glow overlay */}
      {won && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(234,179,8,0.35), transparent 70%)',
          animation: 'cs-win-glow 0.9s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

/* ─── Number Tumbler ─── */
function Tumbler({ value, onChange, disabled, index }) {
  const [animClass, setAnimClass] = useState('');
  const timerRef = useRef(null);

  const handleChange = (dir) => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimClass(dir > 0 ? 'cs-num-up' : 'cs-num-down');
    timerRef.current = setTimeout(() => setAnimClass(''), 250);
    const next = ((value - 1 + dir + 9) % 9) + 1;
    onChange(index, next);
  };

  return (
    <div className="flex flex-col items-center cs-fade-in" style={{ animationDelay: `${0.35 + index * 0.04}s` }}>
      <div className="text-[8px] text-zinc-600 font-heading uppercase tracking-widest mb-0.5">#{index + 1}</div>

      {/* Up */}
      <button
        onClick={() => handleChange(1)}
        disabled={disabled}
        className="flex items-center justify-center transition-colors disabled:opacity-25"
        style={{
          width: 38, height: 24,
          background: 'linear-gradient(180deg, rgba(55,55,55,0.9), rgba(35,35,35,0.9))',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '4px 4px 0 0',
          color: disabled ? '#555' : '#a1a1a1',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = '#eab308'; }}
        onMouseLeave={e => { e.currentTarget.style.color = disabled ? '#555' : '#a1a1a1'; }}
      >
        <ChevronUp size={13} />
      </button>

      {/* Display */}
      <div style={{
        width: 38, height: 50,
        background: 'linear-gradient(180deg, #090909 0%, #131313 50%, #090909 100%)',
        border: '1px solid rgba(234,179,8,0.28)',
        borderTop: 'none', borderBottom: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
      }}>
        {/* Scan lines */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px)',
        }} />
        {/* Top / bottom shadow fade */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, background: 'linear-gradient(180deg, rgba(0,0,0,0.5), transparent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10, background: 'linear-gradient(0deg, rgba(0,0,0,0.5), transparent)', pointerEvents: 'none' }} />
        <span
          className={animClass}
          style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: '#eab308', textShadow: '0 0 12px rgba(234,179,8,0.9)', letterSpacing: 0, display: 'block' }}
        >
          {value}
        </span>
        {/* Highlight lines */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'rgba(234,179,8,0.2)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: 'rgba(234,179,8,0.2)' }} />
      </div>

      {/* Down */}
      <button
        onClick={() => handleChange(-1)}
        disabled={disabled}
        className="flex items-center justify-center transition-colors disabled:opacity-25"
        style={{
          width: 38, height: 24,
          background: 'linear-gradient(180deg, rgba(35,35,35,0.9), rgba(55,55,55,0.9))',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '0 0 4px 4px',
          color: disabled ? '#555' : '#a1a1a1',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = '#eab308'; }}
        onMouseLeave={e => { e.currentTarget.style.color = disabled ? '#555' : '#a1a1a1'; }}
      >
        <ChevronDown size={13} />
      </button>
    </div>
  );
}

/* ─── Coin / money rain on win ─── */
function CoinRain({ active }) {
  const [coins] = useState(() =>
    Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: 3 + Math.random() * 94,
      delay: Math.random() * 2.0,
      dur: 0.9 + Math.random() * 0.9,
      emoji: Math.random() > 0.35 ? '💰' : Math.random() > 0.5 ? '🪙' : '✨',
      size: 14 + Math.random() * 12,
    }))
  );
  if (!active) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 30, borderRadius: 8 }} aria-hidden>
      {coins.map(c => (
        <span key={c.id} style={{
          position: 'absolute', top: -20, left: `${c.left}%`,
          fontSize: c.size, animation: `cs-coin ${c.dur}s ease-in ${c.delay}s both`,
        }}>{c.emoji}</span>
      ))}
    </div>
  );
}

/* ─── Safe Door art ─── */
const RIVET_POSITIONS = [
  { top: 14, left: 14 },
  { top: 14, right: 14 },
  { bottom: 14, left: 14 },
  { bottom: 14, right: 14 },
];

function SafeDoor({ dialAngle, won, shaking }) {
  return (
    <div className={shaking ? 'cs-shake' : ''} style={{ position: 'relative', width: 280, height: 230 }}>
      <CoinRain active={won} />

      {/* Safe body (depth behind door) */}
      <div style={{
        position: 'absolute', inset: 10, borderRadius: 10,
        background: 'linear-gradient(135deg, #080808, #0d0d0d)',
        boxShadow: 'inset 6px 0 20px rgba(0,0,0,0.8)',
      }}>
        {/* Cash visible inside when open */}
        {won && (
          <div className="cs-cash-glow" style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36, flexDirection: 'column', gap: 4,
          }}>
            <span>💵</span>
            <span style={{ fontSize: 11, color: '#22c55e', fontFamily: 'monospace', fontWeight: 900, letterSpacing: 1 }}>OPEN</span>
          </div>
        )}
      </div>

      {/* Door */}
      <div
        className={`cs-vault-breathe ${won ? 'cs-door-open' : ''}`}
        style={{
          position: 'absolute', inset: 0, borderRadius: 10,
          background: 'linear-gradient(150deg, #2e2e2e 0%, #1c1c1c 35%, #242424 70%, #181818 100%)',
          border: '3px solid #2a2a2a',
          boxShadow: '6px 0 18px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}
      >
        {/* Inner door frame bevel */}
        <div style={{
          position: 'absolute', inset: 10, borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.04)',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }} />

        {/* Rivets */}
        {RIVET_POSITIONS.map((pos, i) => (
          <div key={i} className="cs-rivet" style={{
            position: 'absolute', ...pos,
            width: 13, height: 13, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, #6a6a6a, #2d2d2d)',
            border: '1px solid rgba(255,255,255,0.08)',
            animationDelay: `${i * 0.6}s`,
          }} />
        ))}

        {/* Combination dial */}
        <SafeDial dialAngle={dialAngle} won={won} />

        {/* Handle bar */}
        <div style={{
          width: 64, height: 13, borderRadius: 7,
          background: 'linear-gradient(90deg, #303030, #5a5a5a 30%, #6a6a6a 50%, #5a5a5a 70%, #303030)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Handle glint */}
          <div style={{
            position: 'absolute', top: 0, left: '-100%', width: '60%', height: '100%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
            animation: 'cs-handle-glint 5s ease-in-out infinite',
          }} />
        </div>
      </div>

      {/* Win glow around door */}
      {won && (
        <div style={{
          position: 'absolute', inset: -4, borderRadius: 14,
          boxShadow: '0 0 40px rgba(234,179,8,0.6)',
          pointerEvents: 'none',
          animation: 'cs-win-glow 0.9s ease-in-out infinite',
        }} />
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function CrackSafe() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [numbers, setNumbers] = useState([1, 1, 1, 1, 1]);
  const [guessing, setGuessing] = useState(false);
  const [result, setResult] = useState(null);
  const [dialAngle, setDialAngle] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [countdown, setCountdown] = useState('');
  const spinRef = useRef(null);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await api.get('/crack-safe/info');
      setInfo(res.data);
    } catch {
      toast.error('Failed to load safe info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  useEffect(() => {
    if (!info?.next_guess_at) { setCountdown(''); return; }
    const tick = () => setCountdown(formatCountdown(info.next_guess_at));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [info?.next_guess_at]);

  const handleNumberChange = (index, value) => {
    const next = [...numbers];
    next[index] = value;
    setNumbers(next);
    setDialAngle(prev => prev - value * 14);
  };

  const handleGuess = async () => {
    if (guessing) return;
    setGuessing(true);
    setResult(null);

    const startTime = Date.now();
    const MIN_SPIN_MS = 2200;

    spinRef.current = setInterval(() => {
      setDialAngle(prev => prev - 18);
    }, 28);

    try {
      const res = await api.post('/crack-safe/guess', { numbers });

      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_SPIN_MS) {
        await new Promise(r => setTimeout(r, MIN_SPIN_MS - elapsed));
      }

      clearInterval(spinRef.current);
      spinRef.current = null;
      setResult(res.data);

      if (res.data.cracked) {
        toast.success('🔓 SAFE CRACKED! Check your balance!');
        await refreshUser();
      } else {
        setShaking(true);
        setTimeout(() => setShaking(false), 650);
        toast.error(res.data.message);
      }

      await fetchInfo();
    } catch (e) {
      clearInterval(spinRef.current);
      spinRef.current = null;
      const detail = e.response?.data?.detail || 'Failed to submit guess';
      toast.error(detail);
    } finally {
      setGuessing(false);
    }
  };

  useEffect(() => () => { if (spinRef.current) clearInterval(spinRef.current); }, []);

  const clues = result?.clues ?? info?.clues ?? [];
  const won = result?.cracked === true;

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <div className="text-center text-zinc-500 py-20 font-heading text-sm tracking-widest">
          Accessing the vault...
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <style>{CS_STYLES}</style>

      {/* Page header */}
      <div className="cs-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">The Vault</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-2">
          <Lock size={18} className="text-primary/60" />
          Crack the Safe
        </h1>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">
          Enter 5 numbers between 1 and 9 to crack the safe. One attempt per day.
        </p>
      </div>

      {/* Jackpot banner */}
      <div
        className={`relative ${styles.panel} rounded-lg overflow-hidden border border-yellow-600/30 cs-fade-in`}
        style={{ animationDelay: '0.05s' }}
      >
        <div className="h-0.5 bg-gradient-to-r from-transparent via-yellow-500/60 to-transparent" />
        <div className="px-4 py-4 text-center">
          <p className="text-[9px] text-yellow-600/50 font-heading uppercase tracking-[0.3em] mb-1">Current Jackpot</p>
          <p className="cs-jackpot-pulse font-heading font-black text-3xl sm:text-4xl text-yellow-400">
            {formatMoney(info?.jackpot ?? 0)}
          </p>
          <p className="text-[9px] text-zinc-600 font-heading mt-1 tracking-widest">
            {(info?.total_attempts ?? 0).toLocaleString()} total attempts
          </p>
        </div>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-yellow-500/20 to-transparent" />
      </div>

      {/* Main two-column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Left: Safe visual + inputs */}
        <div
          className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 cs-fade-in`}
          style={{ animationDelay: '0.1s' }}
        >
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
            <KeyRound size={11} className="text-primary" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">The Vault</h2>
          </div>

          <div className="p-5 flex flex-col items-center gap-5">

            {/* Safe art */}
            <SafeDoor dialAngle={dialAngle} won={won} shaking={shaking} />

            {/* Tumblers */}
            <div className="flex gap-2 items-end justify-center flex-wrap">
              {numbers.map((n, i) => (
                <Tumbler
                  key={i}
                  index={i}
                  value={n}
                  onChange={handleNumberChange}
                  disabled={!info?.can_guess || guessing}
                />
              ))}
            </div>

            {/* Result feedback */}
            {result && !result.cracked && (
              <div className="w-full rounded-lg px-3 py-2.5 text-center border border-red-900/30 bg-red-950/20 cs-fade-in">
                <p className="text-xs text-red-400 font-heading">{result.message}</p>
              </div>
            )}
            {result?.cracked && (
              <div className="w-full rounded-lg px-3 py-2.5 text-center border border-yellow-500/40 bg-yellow-950/20 cs-win-glow cs-fade-in">
                <p className="text-sm text-yellow-300 font-heading font-bold">
                  🔓 SAFE CRACKED! {formatMoney(result.jackpot_won)} is yours!
                </p>
              </div>
            )}

            {/* Action button / cooldown */}
            {info?.can_guess ? (
              <button
                onClick={handleGuess}
                disabled={guessing}
                className="w-full py-3 rounded-lg font-heading font-bold text-sm uppercase tracking-widest transition-all"
                style={{
                  background: guessing
                    ? 'rgba(50,50,50,0.8)'
                    : 'linear-gradient(135deg, rgba(234,179,8,0.14), rgba(180,130,0,0.08))',
                  border: `1px solid ${guessing ? 'rgba(80,80,80,0.5)' : 'rgba(234,179,8,0.45)'}`,
                  color: guessing ? '#666' : '#eab308',
                  boxShadow: guessing ? 'none' : '0 0 20px rgba(234,179,8,0.08)',
                  cursor: guessing ? 'not-allowed' : 'pointer',
                }}
              >
                {guessing ? '🔐 Cracking...' : `Guess (${formatMoney(info?.entry_cost ?? 5_000_000)})`}
              </button>
            ) : (
              <div
                className="w-full py-3 rounded-lg text-center border border-zinc-700/30 bg-zinc-900/30"
              >
                <div className="flex items-center justify-center gap-2 text-zinc-400 text-xs font-heading">
                  <Clock size={12} />
                  <span>Next attempt in <span className="text-yellow-400 font-bold tabular-nums">{countdown}</span></span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Info + clues */}
        <div className="space-y-3">

          {/* Rules / info */}
          <div
            className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 cs-fade-in`}
            style={{ animationDelay: '0.12s' }}
          >
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Info size={11} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Information & How to Play</h2>
            </div>
            <div className="p-3 space-y-1.5">
              {[
                `Enter 5 numbers between 1 and 9 to crack the safe!`,
                `You can only crack the safe 1 time per day`,
                `Current Jackpot: ${formatMoney(info?.jackpot ?? 0)}`,
                `Number of attempts: ${(info?.total_attempts ?? 0).toLocaleString()}`,
                `Previous Winner: ${info?.last_winner_username ?? 'None yet'}`,
              ].map((line, i) => (
                <p key={i} className="text-xs text-zinc-400 font-heading" style={{ lineHeight: 1.6 }}>
                  {line.startsWith('Current Jackpot') ? (
                    <>Current Jackpot: <span className="text-yellow-400 font-bold">{formatMoney(info?.jackpot ?? 0)}</span></>
                  ) : line.startsWith('Previous Winner') ? (
                    <>Previous Winner: <span className="text-primary font-semibold">{info?.last_winner_username ?? 'None yet'}</span></>
                  ) : line.startsWith('Number of attempts') ? (
                    <>Number of attempts: <span className="text-primary font-semibold">{(info?.total_attempts ?? 0).toLocaleString()}</span></>
                  ) : line}
                </p>
              ))}
            </div>
          </div>

          {/* Clues */}
          <div
            className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 cs-fade-in`}
            style={{ animationDelay: '0.16s' }}
          >
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Clues</h2>
            </div>
            <div className="p-3 space-y-2">
              {clues.length === 0 ? (
                <p className="text-xs text-zinc-600 font-heading italic">No clues available yet.</p>
              ) : clues.map((clue, i) => (
                <div
                  key={clue.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border cs-clue-in ${clue.unlocked ? 'border-primary/20 bg-primary/5' : 'border-zinc-800/30 bg-zinc-900/20'}`}
                  style={{ animationDelay: `${i * 0.07}s` }}
                >
                  <span className={`font-heading font-bold text-[10px] shrink-0 ${clue.unlocked ? 'text-primary' : 'text-zinc-700'}`}>
                    #{clue.id}
                  </span>
                  <span className={`text-xs font-heading flex-1 ${clue.unlocked ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    {clue.unlocked
                      ? clue.text
                      : `Unlocks after ${clue.unlock_after} attempts`}
                  </span>
                  {clue.unlocked && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Last winner card */}
          {info?.last_winner_username && (
            <div
              className={`relative ${styles.panel} rounded-lg overflow-hidden border border-yellow-600/20 cs-fade-in`}
              style={{ animationDelay: '0.2s' }}
            >
              <div className="h-0.5 bg-gradient-to-r from-transparent via-yellow-500/30 to-transparent" />
              <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
                <Trophy size={11} className="text-yellow-500" />
                <h2 className="text-[10px] font-heading font-bold text-yellow-500/80 uppercase tracking-[0.15em]">Last Safe Cracker</h2>
              </div>
              <div className="px-3 py-2.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
                  🏆
                </div>
                <div>
                  <p className="text-sm font-heading font-bold text-yellow-400">{info.last_winner_username}</p>
                  <p className="text-[10px] text-zinc-600">{formatDate(info.last_won_at)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
