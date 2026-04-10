import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import styles from '../../styles/noir.module.css';

const CG_STYLES = `
  .cg-fade-in { animation: cg-fade-in 0.4s ease-out both; }
  @keyframes cg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .cg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const SPIN_DURATION_MS = 4500;

const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const RED = new Set(RED_NUMBERS);
const isRed = (n) => RED.has(n);
const SEG = 360 / WHEEL_ORDER.length;

const CHIPS = [
  { label: '100K', value: 100_000, color: '#e4e4e7', ring: '#a1a1aa' },
  { label: '1M',   value: 1_000_000, color: '#dc2626', ring: '#991b1b' },
  { label: '10M',  value: 10_000_000, color: '#16a34a', ring: '#166534' },
  { label: '100M', value: 100_000_000, color: '#18181b', ring: '#52525b' },
  { label: '1B',   value: 1_000_000_000, color: '#7c3aed', ring: '#5b21b6' },
];

const TABLE_ROWS = [
  [3,6,9,12,15,18,21,24,27,30,33,36],
  [2,5,8,11,14,17,20,23,26,29,32,35],
  [1,4,7,10,13,16,19,22,25,28,31,34],
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

/** Multi-line banner copy for a spin response (uses API fields only). */
function buildRouletteSpinBannerMessage(data) {
  const n = data.result;
  const num = Number(n);
  let toneWord = 'black';
  let slot = String(n ?? '—');
  if (num === 0) {
    toneWord = 'green';
    slot = '0';
  } else if (RED.has(num)) {
    toneWord = 'red';
  }
  const stake = Number(data.total_stake || 0);
  const payout = Number(data.total_payout || 0);
  const shortfall = Number(data.shortfall || 0);
  const ownerCut = Number(data.owner_cut || 0);
  const lines = [];
  lines.push(`Ball landed on ${slot} (${toneWord}).`);
  if (data.win) {
    const net = payout - stake;
    let line2 = `Paid out ${formatMoney(payout)} on ${formatMoney(stake)} wagered.`;
    if (net > 0) line2 += ` Net gain ${formatMoney(net)}.`;
    else if (net < 0) line2 += ` Net ${formatMoney(net)}.`;
    else line2 += ' Break-even on this spin.';
    lines.push(line2);
    if (shortfall > 0) {
      lines.push(
        `The owner could not cover the full win — you still collected ${formatMoney(payout)} (${formatMoney(shortfall)} below the full payout).`,
      );
    }
  } else {
    lines.push(`No winning bets — ${formatMoney(stake)} stays with the house.`);
    if (ownerCut > 0) {
      lines.push(`State head / edge share: ${formatMoney(ownerCut)}.`);
    }
  }
  if (data.ownership_transferred) {
    lines.push('You seized this roulette table — the previous owner could not pay.');
  }
  return lines.join('\n');
}

function setBusyAnimationsFlag(isBusy) {
  if (typeof document === 'undefined') return;
  if (isBusy) {
    document.body?.setAttribute('data-busy-animations', '1');
    document.documentElement?.setAttribute('data-busy-animations', '1');
  } else {
    document.body?.removeAttribute('data-busy-animations');
    document.documentElement?.removeAttribute('data-busy-animations');
  }
}

/* ═══════════════════════════════════════════════════════
   SVG Roulette Wheel – pie segments, metallic rim, ball
   ═══════════════════════════════════════════════════════ */
function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function piePath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  return `M${cx},${cy} L${s.x.toFixed(2)},${s.y.toFixed(2)} A${r},${r} 0 0 1 ${e.x.toFixed(2)},${e.y.toFixed(2)} Z`;
}

function RouletteWheel({ rotationDeg, spinning, lastResult, size = 260 }) {
  const cx = 100, cy = 100, outerR = 95, textR = 78;
  const segAngle = 360 / WHEEL_ORDER.length;
  const ballOrbitRef = useRef(null);
  const ballAnimRef = useRef(null);

  useEffect(() => {
    if (spinning && ballOrbitRef.current) {
      const el = ballOrbitRef.current;
      const startTime = performance.now();
      const duration = SPIN_DURATION_MS;
      const totalRotation = -2520;

      const animate = (now) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 2.8);
        el.style.transform = `rotate(${totalRotation * eased}deg)`;
        if (t < 1) {
          ballAnimRef.current = requestAnimationFrame(animate);
        }
      };

      el.style.transform = 'rotate(0deg)';
      ballAnimRef.current = requestAnimationFrame(animate);

      return () => {
        if (ballAnimRef.current) cancelAnimationFrame(ballAnimRef.current);
      };
    } else if (!spinning && ballOrbitRef.current) {
      ballOrbitRef.current.style.transform = 'rotate(0deg)';
    }
  }, [spinning]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Outer wooden rim */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'conic-gradient(from 30deg, #5a3e1b, #8b6914, var(--noir-primary-bright), #8b6914, #5a3e1b, #3e2a0f, #5a3e1b)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6), inset 0 0 12px rgba(0,0,0,0.4)',
        }}
      />
      {/* Ball track groove */}
      <div
        className="absolute rounded-full"
        style={{
          inset: 8,
          background: 'linear-gradient(135deg, #2a2a2a, #1a1a1a, #2a2a2a)',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.6), inset 0 -1px 3px rgba(255,255,255,0.05)',
        }}
      />
      {/* Ball orbit container — JS-driven smooth animation */}
      <div
        ref={ballOrbitRef}
        className="absolute inset-0 z-30"
        style={{ transform: 'rotate(0deg)', willChange: 'transform' }}
      >
        <div
          className="absolute rounded-full"
          style={{
            width: 11,
            height: 11,
            top: 5,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'radial-gradient(circle at 35% 30%, #ffffff, #e0e0e0, #999)',
            boxShadow: '0 0 8px rgba(255,255,255,0.8), 0 1px 4px rgba(0,0,0,0.5)',
          }}
        />
      </div>
      {/* SVG wheel face */}
      <div
        className="absolute rounded-full overflow-hidden"
        style={{
          inset: 14,
          transform: `rotate(${rotationDeg}deg)`,
          transition: spinning ? `transform ${SPIN_DURATION_MS / 1000}s cubic-bezier(0.0, 0.0, 0.18, 1.0)` : 'none',
          willChange: 'transform',
        }}
      >
        <svg viewBox="0 0 200 200" className="w-full h-full">
          <defs>
            <filter id="seg-shadow">
              <feDropShadow dx="0" dy="0" stdDeviation="0.5" floodOpacity="0.3" />
            </filter>
          </defs>
          {WHEEL_ORDER.map((num, i) => {
            const startDeg = i * segAngle;
            const endDeg = startDeg + segAngle;
            const fill = num === 0 ? '#0a8a4a' : isRed(num) ? '#b91c1c' : '#1c1c1c';
            const midDeg = startDeg + segAngle / 2;
            const tp = polar(cx, cy, textR, midDeg);
            return (
              <g key={`seg-${num}-${i}`}>
                <path
                  d={piePath(cx, cy, outerR, startDeg, endDeg)}
                  fill={fill}
                  stroke="var(--noir-primary-bright)"
                  strokeWidth="0.4"
                  filter="url(#seg-shadow)"
                />
                <text
                  x={tp.x}
                  y={tp.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize="6.5"
                  fontWeight="bold"
                  transform={`rotate(${midDeg}, ${tp.x}, ${tp.y})`}
                  style={{ textShadow: '0 0 2px rgba(0,0,0,0.8)' }}
                >
                  {num}
                </text>
              </g>
            );
          })}
          {/* Inner ring separator */}
          <circle cx={cx} cy={cy} r={58} fill="none" stroke="var(--noir-primary-bright)" strokeWidth="1.2" />
          {/* Decorative spokes */}
          {WHEEL_ORDER.map((_, i) => {
            const deg = i * segAngle;
            const inner = polar(cx, cy, 58, deg);
            const outer = polar(cx, cy, outerR, deg);
            return (
              <line key={`spoke-${i}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--noir-primary-bright)" strokeWidth="0.5" opacity="0.6" />
            );
          })}
        </svg>
      </div>
      {/* Center cone */}
      <div
        className="absolute rounded-full z-10"
        style={{
          inset: '32%',
          background: 'radial-gradient(circle at 40% 35%, var(--noir-primary-bright), #8b6914 40%, #5a3e1b 70%, #3e2a0f)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5), inset 0 1px 4px rgba(255,255,255,0.15)',
          border: '2px solid #8b6914',
        }}
      >
        <div className="absolute top-[20%] left-[25%] w-[30%] h-[15%] rounded-full bg-white/10 blur-[2px]" />
      </div>
      {/* Result glow ring */}
      {lastResult !== null && !spinning && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none animate-result-glow z-20"
          style={{
            border: `3px solid ${lastResult === 0 ? '#34d399' : isRed(lastResult) ? '#f87171' : '#a1a1aa'}`,
            boxShadow: `0 0 20px ${lastResult === 0 ? 'rgba(52,211,153,0.4)' : isRed(lastResult) ? 'rgba(248,113,113,0.4)' : 'rgba(161,161,170,0.3)'}`,
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Casino Chip – realistic with edge markings
   ═══════════════════════════════════════════════════════ */
function Chip({ label, color, ring, selected, onClick, size = 36 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-full flex items-center justify-center font-bold transition-all ${selected ? 'scale-110 z-10' : 'hover:scale-105'}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 40% 35%, ${color}, ${ring})`,
        border: `2px dashed ${ring}`,
        boxShadow: selected
          ? `0 0 0 2px var(--noir-primary), 0 4px 12px rgba(0,0,0,0.4)`
          : `0 2px 6px rgba(0,0,0,0.3)`,
        color: color === '#e4e4e7' || color === '#16a34a' ? '#000' : '#fff',
        fontSize: Math.max(8, size * 0.24),
      }}
    >
      <span className="relative z-10 drop-shadow-sm">{label}</span>
      {/* Inner ring */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: 4,
          border: `1.5px solid ${selected ? 'var(--noir-primary)' : 'rgba(255,255,255,0.2)'}`,
        }}
      />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   Number Cell – styled for the felt table
   ═══════════════════════════════════════════════════════ */
function NumCell({ num, onClick, betCount }) {
  const bg = num === 0
    ? 'bg-emerald-700 hover:bg-emerald-600'
    : isRed(num)
      ? 'bg-red-700 hover:bg-red-600'
      : 'bg-zinc-800 hover:bg-zinc-700';
  return (
    <button
      onClick={onClick}
      className={`relative h-9 sm:h-10 font-bold text-xs sm:text-sm text-white transition-all active:scale-95 border border-white/10 ${bg}`}
    >
      {num}
      {betCount > 0 && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary text-[7px] text-black font-bold flex items-center justify-center shadow z-10">
          {betCount}
        </span>
      )}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════ */
export default function Rlt() {
  const [config, setConfig] = useState({ max_bet: 50_000_000 });
  const [ownership, setOwnership] = useState(null);
  const [selectedChip, setSelectedChip] = useState(1_000_000);
  const [customChip, setCustomChip] = useState('');
  const [bets, setBets] = useState([]);
  const [useAnimation, setUseAnimation] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [recentNumbers, setRecentNumbers] = useState([]);
  const [showWin, setShowWin] = useState(false);
  const spinTimeoutRef = useRef(null);
  const busyClearTimeoutRef = useRef(null);
  const pendingResultRef = useRef(null);
  /** Animation mode only: one spin at a time (wheel + pendingResult ref). Turbo mode allows many in-flight HTTP spins. */
  const spinInFlightRef = useRef(false);
  const spinSeqRef = useRef(0);
  const completedSpinDataRef = useRef(new Map());
  const inFlightCountRef = useRef(0);
  const lastMoneyErrRef = useRef(0);
  const betsRef = useRef(bets);
  const configRef = useRef(config);
  const useAnimationRef = useRef(useAnimation);
  const historySeqRef = useRef(0);
  betsRef.current = bets;
  configRef.current = config;
  useAnimationRef.current = useAnimation;

  const [newMaxBet, setNewMaxBet] = useState('');
  const [ownerBuyBack, setOwnerBuyBack] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [sellPoints, setSellPoints] = useState('');
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [buyBackOffer, setBuyBackOffer] = useState(null);
  const [buyBackSecondsLeft, setBuyBackSecondsLeft] = useState(null);
  const [buyBackActionLoading, setBuyBackActionLoading] = useState(false);
  const buyBackFromGameRef = useRef(false);
  const [rouletteBanner, setRouletteBannerState] = useState(null);

  const clearRouletteBanner = useCallback(() => {
    setRouletteBannerState(null);
  }, []);

  /** No auto-dismiss — avoids layout collapse/jump; replaced on next spin result or cleared with ×. */
  const showRouletteBanner = useCallback((variant, message) => {
    setRouletteBannerState({ variant, message: String(message || '') });
  }, []);

  const [betBarWiggle, setBetBarWiggle] = useState(false);
  const betWiggleTimeoutRef = useRef(null);

  const triggerBetBarWiggle = useCallback(() => {
    if (betWiggleTimeoutRef.current) {
      clearTimeout(betWiggleTimeoutRef.current);
      betWiggleTimeoutRef.current = null;
    }
    setBetBarWiggle(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setBetBarWiggle(true);
        betWiggleTimeoutRef.current = setTimeout(() => {
          betWiggleTimeoutRef.current = null;
          setBetBarWiggle(false);
        }, 450);
      });
    });
  }, []);

  const fetchOwnership = () => {
    api.get('/casino/roulette/ownership').then((r) => {
      const data = r.data ?? null;
      setOwnership(data);
      if (data?.max_bet) setConfig((prev) => ({ ...prev, max_bet: data.max_bet }));
      if (data?.buy_back_reward != null) setOwnerBuyBack(String(data.buy_back_reward));
      if (data?.buy_back_offer) {
        setBuyBackOffer({ ...data.buy_back_offer, offer_id: data.buy_back_offer.offer_id || data.buy_back_offer.id });
        buyBackFromGameRef.current = false;
      } else if (!buyBackFromGameRef.current) {
        setBuyBackOffer(null);
      }
    }).catch(() => {
      setOwnership(null);
      if (!buyBackFromGameRef.current) setBuyBackOffer(null);
    });
  };

  useEffect(() => {
    api.get('/casino/roulette/config').then((r) => setConfig(r.data ?? { max_bet: 50_000_000 })).catch(() => {
      setConfig({ max_bet: 50_000_000 });
    });
    fetchOwnership();
  }, []);

  useEffect(() => () => {
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    if (busyClearTimeoutRef.current) clearTimeout(busyClearTimeoutRef.current);
    if (betWiggleTimeoutRef.current) clearTimeout(betWiggleTimeoutRef.current);
    setBusyAnimationsFlag(false);
  }, []);

  useEffect(() => {
    if (!buyBackOffer?.expires_at) { setBuyBackSecondsLeft(null); return; }
    const update = () => {
      const exp = new Date(buyBackOffer.expires_at).getTime();
      const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
      setBuyBackSecondsLeft(left);
      if (left <= 0) setBuyBackOffer(null);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [buyBackOffer]);

  const startWheelSpin = (resultNum) => {
    const idx = WHEEL_ORDER.indexOf(resultNum);
    const targetOffset = - (idx >= 0 ? idx : 0) * SEG - SEG / 2;
    setSpinning(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setWheelRotation((prev) => {
          const prevNorm = ((prev % 360) + 360) % 360;
          const targetNorm = ((targetOffset % 360) + 360) % 360;
          let delta = targetNorm - prevNorm;
          if (delta < 0) delta += 360;
          // Preserve current wheel angle and add full turns for spin feel.
          return prev + (10 * 360) + delta;
        });
      });
    });
  };

  const chipValue = customChip ? (parseInt(String(customChip).replace(/\D/g, ''), 10) || 0) : selectedChip;
  const totalBet = bets.reduce((s, b) => s + b.amount, 0);
  const totalReturns = bets.reduce((s, b) => s + getPayout(b.type, b.selection, b.amount), 0);
  const canSpin = bets.length > 0 && totalBet <= (config.max_bet || 0);
  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.is_unclaimed && !ownership?.owner_id;
  const currentCity = ownership?.current_city || '—';

  const betCountFor = (type, sel) => bets.filter((b) => b.type === type && String(b.selection) === String(sel)).length;

  const addBet = (type, selection) => {
    if (!chipValue || chipValue <= 0) {
      showRouletteBanner('error', 'Select chip amount');
      return;
    }
    if (totalBet + chipValue > (config.max_bet || 0)) {
      showRouletteBanner('error', `Max bet ${formatMoney(config.max_bet)}`);
      return;
    }
    setBets((prev) => [...prev, { id: Date.now() + Math.random(), type, selection, amount: chipValue }]);
    triggerBetBarWiggle();
  };

  const removeBet = (id) => setBets((prev) => prev.filter((b) => b.id !== id));
  const clearBets = () => setBets([]);

  const applyResult = (data) => {
    setLastResult(data.result);
    const hid = ++historySeqRef.current;
    setRecentNumbers((prev) => [{ id: hid, n: data.result }, ...prev].slice(0, 12));
    showRouletteBanner(data.win ? 'success' : 'error', buildRouletteSpinBannerMessage(data));
    if (data.win) {
      setShowWin(true);
      setTimeout(() => setShowWin(false), 2200);
    }
    if (data.buy_back_offer) { setBuyBackOffer(data.buy_back_offer); buyBackFromGameRef.current = true; }
    refreshUser();
    fetchOwnership();
    setSpinning(false);
    if (busyClearTimeoutRef.current) clearTimeout(busyClearTimeoutRef.current);
    busyClearTimeoutRef.current = setTimeout(() => {
      busyClearTimeoutRef.current = null;
      setBusyAnimationsFlag(false);
    }, 700);
  };

  /** No-animation / turbo: many spins in flight; order history and “last” number by client_spin_id when responses race. */
  const applyResultTurbo = (seq, data) => {
    completedSpinDataRef.current.set(seq, data);
    const keys = [...completedSpinDataRef.current.keys()].sort((a, b) => a - b);
    const hi = keys[keys.length - 1];
    keys.forEach((k) => {
      if (k < hi - 150) completedSpinDataRef.current.delete(k);
    });
    const sorted = [...completedSpinDataRef.current.entries()].sort((a, b) => b[0] - a[0]).slice(0, 12);
    setRecentNumbers(sorted.map(([s, d]) => ({ id: s, n: d.result })));
    const maxSeq = sorted.length ? sorted[0][0] : seq;
    const lead = completedSpinDataRef.current.get(maxSeq);
    if (lead && lead.result != null) setLastResult(lead.result);

    showRouletteBanner(data.win ? 'success' : 'error', buildRouletteSpinBannerMessage(data));
    if (data.win) {
      setShowWin(true);
      setTimeout(() => setShowWin(false), 2200);
    }
    if (data.buy_back_offer) {
      setBuyBackOffer({ ...data.buy_back_offer, offer_id: data.buy_back_offer.offer_id || data.buy_back_offer.id });
      buyBackFromGameRef.current = true;
    }
    refreshUser();
    fetchOwnership();
  };

  /** One spin end-to-end (async). Caller must ensure only one instance runs at a time via spinInFlightRef. */
  const runSingleSpin = async () => {
    const b = betsRef.current;
    const cfg = configRef.current;
    const anim = useAnimationRef.current;
    const stake = b.reduce((s, x) => s + x.amount, 0);
    if (b.length === 0 || stake > (cfg.max_bet || 0)) return;

    setBusyAnimationsFlag(true);
    setSpinning(true);
    setLastResult(null);
    setShowWin(false);
    if (!anim) {
      setWheelRotation(0);
    } else {
      setWheelRotation((prev) => prev + 360);
    }
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);

    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const payload = b.map((bet) => ({
        type: bet.type,
        selection: bet.type === 'straight' ? Number(bet.selection) : bet.selection,
        amount: bet.amount,
      }));
      const res = await api.post('/casino/roulette/spin', { bets: payload });
      const data = res.data || {};

      if (!anim) {
        setWheelRotation(0);
        applyResult(data);
        return;
      }

      pendingResultRef.current = data;
      startWheelSpin(data.result);
      await new Promise((resolve) => {
        spinTimeoutRef.current = setTimeout(() => {
          spinTimeoutRef.current = null;
          const pending = pendingResultRef.current;
          pendingResultRef.current = null;
          if (pending) applyResult(pending);
          resolve();
        }, SPIN_DURATION_MS + 80);
      });
    } catch (e) {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      pendingResultRef.current = null;
      const d = e.response?.data?.detail;
      showRouletteBanner('error', typeof d === 'string' ? d : d != null ? String(d) : 'Spin failed');
      setSpinning(false);
      setBusyAnimationsFlag(false);
      refreshUser();
    }
  };

  const spin = () => {
    if (!canSpin) return;
    const anim = useAnimationRef.current;

    if (anim) {
      if (spinInFlightRef.current) return;
      spinInFlightRef.current = true;
      runSingleSpin().finally(() => {
        spinInFlightRef.current = false;
      });
      return;
    }

    const b = betsRef.current;
    const cfg = configRef.current;
    const stake = b.reduce((s, x) => s + x.amount, 0);
    if (b.length === 0 || stake > (cfg.max_bet || 0)) return;

    const seq = ++spinSeqRef.current;
    const payload = b.map((bet) => ({
      type: bet.type,
      selection: bet.type === 'straight' ? Number(bet.selection) : bet.selection,
      amount: bet.amount,
    }));

    inFlightCountRef.current += 1;
    setSpinning(true);
    setBusyAnimationsFlag(true);
    setWheelRotation(0);

    const finishOne = () => {
      inFlightCountRef.current -= 1;
      if (inFlightCountRef.current <= 0) {
        inFlightCountRef.current = 0;
        setSpinning(false);
        if (busyClearTimeoutRef.current) clearTimeout(busyClearTimeoutRef.current);
        busyClearTimeoutRef.current = setTimeout(() => {
          busyClearTimeoutRef.current = null;
          setBusyAnimationsFlag(false);
        }, 400);
      }
    };

    const runPost = () => {
      api
        .post('/casino/roulette/spin', { bets: payload, client_spin_id: seq })
        .then((res) => {
          const raw = res.data || {};
          const sid = raw.client_spin_id != null ? Number(raw.client_spin_id) : seq;
          applyResultTurbo(sid, raw);
        })
        .catch((e) => {
          const msg = e.response?.data?.detail || 'Spin failed';
          const s = typeof msg === 'string' ? msg : String(msg);
          const now = Date.now();
          if (s.toLowerCase().includes('money') || s.toLowerCase().includes('enough')) {
            if (now - lastMoneyErrRef.current > 1200) {
              lastMoneyErrRef.current = now;
              showRouletteBanner('error', s);
            }
          } else {
            showRouletteBanner('error', s);
          }
          refreshUser();
        })
        .finally(finishOne);
    };

    requestAnimationFrame(() => requestAnimationFrame(runPost));
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

  const handleResetProfit = async () => {
    if (!ownership?.current_city || !window.confirm('Reset profit counter to zero? This cannot be undone.')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/reset-profit', { city: ownership.current_city });
      toast.success('Profit reset to zero');
      fetchOwnership();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleSetMaxBet = async () => {
    if (!ownership?.current_city) { toast.error('No city found'); return; }
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 50_000) { toast.error('Min $50,000'); return; }
    setOwnerLoading(true);
    try {
      const res = await api.post('/casino/roulette/set-max-bet', { city: ownership.current_city, max_bet: val });
      toast.success(res.data?.message || 'Updated');
      if (res.data?.max_bet) setConfig((prev) => ({ ...prev, max_bet: res.data.max_bet }));
      fetchOwnership();
      setNewMaxBet('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleSetBuyBack = async () => {
    if (!ownership?.current_city) return;
    const val = parseInt(String(ownerBuyBack).replace(/\D/g, ''), 10) || 0;
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/set-buy-back-reward', { city: ownership.current_city, amount: val });
      toast.success('Buy-back reward updated');
      fetchOwnership();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const acceptBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      const res = await api.post('/casino/roulette/buy-back/accept', { offer_id: buyBackOffer.offer_id });
      toast.success(res.data?.message || 'Accepted! You received the points.');
      setBuyBackOffer(null);
      refreshUser();
      fetchOwnership();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBuyBackActionLoading(false); }
  };

  const rejectBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      await api.post('/casino/roulette/buy-back/reject', { offer_id: buyBackOffer.offer_id });
      toast.success('You kept the table!');
      setBuyBackOffer(null);
      fetchOwnership();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBuyBackActionLoading(false); }
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
    const points = parseInt(String(sellPoints).replace(/\D/g, ''), 10);
    if (!points || points <= 0) { toast.error('Enter valid points'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/roulette/sell-on-trade', { city: ownership.current_city, points });
      toast.success(`Listed for ${points.toLocaleString()} pts!`);
      setSellPoints('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const renderRouletteBanner = (extraClassName = '') => {
    if (!rouletteBanner) return null;
    const variant = rouletteBanner.variant;
    const vClass =
      variant === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
        : variant === 'error'
          ? 'border-red-500/40 bg-red-500/10 text-red-100'
          : 'border-primary/30 bg-primary/10 text-foreground';
    return (
      <div
        className={`rounded-md border px-2.5 py-1.5 flex items-start justify-between gap-2 min-h-[5.5rem] max-h-[5.5rem] sm:min-h-[6rem] sm:max-h-[6rem] overflow-hidden ${vClass} ${extraClassName}`.trim()}
        role="status"
      >
        <p className="text-[10px] font-heading leading-snug whitespace-pre-line flex-1 min-h-0 min-w-0 overflow-y-auto pr-0.5">
          {rouletteBanner.message}
        </p>
        <button
          type="button"
          onClick={clearRouletteBanner}
          className="shrink-0 leading-none px-1 py-0.5 rounded text-[11px] text-mutedForeground hover:text-foreground hover:bg-black/20 font-heading"
          aria-label="Dismiss message"
        >
          ×
        </button>
      </div>
    );
  };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="roulette-page">
      <style>{CG_STYLES}</style>
      <style>{`
        @keyframes result-glow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes result-number-pop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes win-shower {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          100% { transform: translateY(400px) rotate(var(--r, 180deg)) scale(0.3); opacity: 0; }
        }
        @keyframes spin-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(212,175,55,0.2); }
          50% { box-shadow: 0 0 40px rgba(212,175,55,0.5); }
        }
        /* ball-orbit: now driven by requestAnimationFrame in JS */
        .animate-result-glow { animation: result-glow 1s ease-in-out 3; }
        .animate-result-pop { animation: result-number-pop 0.5s cubic-bezier(0.2, 0.8, 0.3, 1.1) forwards; }
        .animate-win-shower { animation: win-shower ease-in forwards; }
        .animate-spin-pulse { animation: spin-pulse 1s ease-in-out infinite; }
        @keyframes rlt-bet-wiggle {
          0%, 100% { transform: translateY(0); }
          25% { transform: translateY(-6px); }
          50% { transform: translateY(5px); }
          75% { transform: translateY(-2px); }
        }
        .rlt-bet-wiggle { animation: rlt-bet-wiggle 0.42s ease-in-out; }
      `}</style>

      {/* Page header */}
      <div className="relative cg-fade-in flex flex-wrap items-end justify-between gap-y-2 gap-x-4">
        <div className="w-full min-w-0 sm:w-auto">
          <p className="text-[10px] text-zinc-500 font-heading italic">
            Playing in <span className="text-primary font-bold">{currentCity}</span>
            {ownership?.owner_name && !isOwner && (
              <span>
                {' '}· Owned by{' '}
                <Link to={`/profile/${encodeURIComponent(ownership.owner_name)}`} className="text-primary hover:underline font-heading">
                  {ownership.owner_name}
                </Link>
                {ownership?.owner_wealth_rank_name ? (
                  <>
                    {' '}·{' '}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="font-bold underline decoration-dotted underline-offset-2 cursor-help"
                            style={ownership?.owner_wealth_rank_color ? { color: ownership.owner_wealth_rank_color } : undefined}
                          >
                            {ownership.owner_wealth_rank_name}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="font-heading text-[11px]">
                          {ownership?.owner_wealth_rank_range || 'Wealth tier'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </>
                ) : null}
              </span>
            )}
          </p>
          {renderRouletteBanner('mt-1.5 max-w-xl hidden sm:flex')}
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs font-heading sm:w-auto sm:justify-end">
          {ownership?.owner_name ? (
            <span className="text-mutedForeground">Buy-back: <span className="text-primary font-bold">{Number(ownership.buy_back_reward ?? 0).toLocaleString()} pts</span></span>
          ) : null}
          <span className="text-mutedForeground">Max: <span className="text-primary font-bold">{formatMoney(config.max_bet)}</span></span>
          {canClaim && (
            <button onClick={handleClaim} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">
              Claim ({formatMoney(config.claim_cost ?? 250_000_000)})
            </button>
          )}
        </div>
        {renderRouletteBanner('mt-1 flex w-full sm:hidden')}
      </div>

      {/* Buy-back offer */}
      {buyBackOffer && (
        <div
          className="p-4 rounded-lg border-2 space-y-3"
          style={{
            borderColor: 'var(--noir-primary-bright)',
            background: 'linear-gradient(135deg, rgba(212,175,55,0.1), rgba(212,175,55,0.03))',
          }}
        >
          <h3 className="font-heading font-bold text-primary uppercase tracking-wider text-sm">Buy-Back Offer</h3>
          <p className="text-xs text-mutedForeground">
            House could only pay {formatMoney(buyBackOffer.owner_paid)}. Accept to return the table for {(buyBackOffer.points_offered || 0).toLocaleString()} points, or reject to keep ownership.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {buyBackSecondsLeft !== null && (
              <span className="text-sm font-heading font-medium text-primary tabular-nums">
                {Math.floor(buyBackSecondsLeft / 60)}:{String(buyBackSecondsLeft % 60).padStart(2, '0')}
              </span>
            )}
            <button onClick={acceptBuyBack} disabled={buyBackActionLoading || (buyBackSecondsLeft !== null && buyBackSecondsLeft <= 0)}
              className="rounded-lg px-5 py-2 text-xs font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, var(--noir-primary), #8a6e18)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200' }}
            >
              {buyBackActionLoading ? '...' : `Accept (${(buyBackOffer.points_offered || 0).toLocaleString()} pts)`}
            </button>
            <button onClick={rejectBuyBack} disabled={buyBackActionLoading}
              className="bg-zinc-800 border border-zinc-600 text-foreground px-5 py-2 rounded-lg text-xs font-heading font-bold uppercase disabled:opacity-40"
            >
              {buyBackActionLoading ? '...' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ Owner Controls ═══ */}
      {isOwner && (
        <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 cg-fade-in`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Owner Controls</span>
            <span className={`text-xs font-heading font-bold ${(ownership?.profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              P/L: {formatMoney(ownership?.profit ?? ownership?.total_earnings ?? 0)}
            </span>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Max Bet</span>
              <FormattedNumberInput placeholder="e.g. 100,000,000" value={newMaxBet} onChange={setNewMaxBet} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSetMaxBet} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">Set</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Buy-back</span>
              <FormattedNumberInput placeholder="Points offered if taken" value={ownerBuyBack} onChange={setOwnerBuyBack} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSetBuyBack} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">Set</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Transfer</span>
              <input type="text" placeholder="Username" value={transferUsername} onChange={(e) => setTransferUsername(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleTransfer} disabled={ownerLoading || !transferUsername.trim()} className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 disabled:opacity-50">Send</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-mutedForeground w-20 shrink-0">Sell (pts)</span>
              <FormattedNumberInput value={sellPoints} onChange={setSellPoints} placeholder="10,000" className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSellOnTrade} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">List</button>
            </div>
            <div className="flex justify-between">
              <button onClick={handleResetProfit} disabled={ownerLoading} className="text-[10px] text-amber-400 hover:text-amber-300 font-heading">Reset Profit</button>
              <button onClick={handleRelinquish} disabled={ownerLoading} className="text-[10px] text-red-400 hover:text-red-300 font-heading">Relinquish</button>
            </div>
          </div>
          <div className="cg-art-line text-primary mx-3" />
        </div>
      )}

      {/* ═══ Game Table ═══ */}
      {!isOwner && (
        <div
          className="rounded-xl overflow-hidden border-2"
          style={{
            borderColor: '#5a3e1b',
            background: 'linear-gradient(180deg, #0c3d1a 0%, #0a5e2a 20%, #0d7a35 50%, #0a5e2a 80%, #0c3d1a 100%)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5), inset 0 0 60px rgba(0,0,0,0.2)',
          }}
        >
          {/* Gold rail trim */}
          <div style={{ height: 3, background: 'linear-gradient(90deg, #5a3e1b, var(--noir-primary-bright), #8b6914, var(--noir-primary-bright), #5a3e1b)' }} />

          <div className="p-3 sm:p-4">
            {/* Bet info bar — wiggles up/down when a chip is placed */}
            <div className={`flex items-center justify-between mb-3 px-1 ${betBarWiggle ? 'rlt-bet-wiggle' : ''}`}>
              <span className="text-[10px] font-heading text-emerald-200/70 uppercase tracking-wider">Place your bets</span>
              <div className="flex items-center gap-3 text-[10px] font-heading">
                <span className="text-emerald-200/60">Wager: <span className="text-white font-bold">{formatMoney(totalBet)}</span></span>
                <span className="text-emerald-200/60">Pays: <span className="text-primary font-bold">{formatMoney(totalReturns)}</span></span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4">
              {/* ── Left column: Wheel, chips, spin ── */}
              <div className="flex flex-col items-center gap-3 min-w-0">
                {/* Wheel */}
                <div className={`rounded-full p-1 ${spinning && useAnimation ? 'animate-spin-pulse' : ''}`}>
                  <RouletteWheel
                    rotationDeg={wheelRotation}
                    spinning={spinning && useAnimation}
                    lastResult={lastResult}
                    size={200}
                  />
                </div>

                {/* Result display */}
                <div className="min-h-[56px] flex flex-col items-center justify-center">
                  {spinning ? (
                    <div className="h-14" />
                  ) : lastResult !== null ? (
                    <div className="flex flex-col items-center animate-result-pop">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-heading font-black shadow-lg"
                        style={{
                          background: lastResult === 0
                            ? 'radial-gradient(circle at 40% 35%, #34d399, #059669)' 
                            : isRed(lastResult)
                              ? 'radial-gradient(circle at 40% 35%, #f87171, #b91c1c)'
                              : 'radial-gradient(circle at 40% 35%, #71717a, #27272a)',
                          border: '3px solid rgba(255,255,255,0.2)',
                          color: 'white',
                          boxShadow: `0 0 20px ${lastResult === 0 ? 'rgba(52,211,153,0.4)' : isRed(lastResult) ? 'rgba(248,113,113,0.4)' : 'rgba(100,100,100,0.3)'}`,
                        }}
                      >
                        {lastResult}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-emerald-200/50 font-heading text-center">Place bets<br/>and spin</p>
                  )}
                </div>

                {/* Recent numbers rail */}
                {recentNumbers.length > 0 && (
                  <div className="flex gap-1 justify-center flex-wrap">
                    {recentNumbers.slice(0, 10).map((entry, i) => {
                      const n = typeof entry === 'object' && entry != null && 'n' in entry ? entry.n : entry;
                      const key = typeof entry === 'object' && entry != null && entry.id != null ? entry.id : `${n}-${i}`;
                      return (
                        <div
                          key={key}
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-sm"
                          style={{
                            background: n === 0 ? '#059669' : isRed(n) ? '#b91c1c' : '#27272a',
                            border: '1.5px solid rgba(255,255,255,0.15)',
                            opacity: 1 - i * 0.07,
                          }}
                        >
                          {n}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Chip selector */}
                <div className="flex gap-1.5 justify-center items-end">
                  {CHIPS.map((c) => (
                    <Chip
                      key={c.value}
                      label={c.label}
                      color={c.color}
                      ring={c.ring}
                      selected={selectedChip === c.value && !customChip}
                      onClick={() => { setSelectedChip(c.value); setCustomChip(''); }}
                    />
                  ))}
                </div>

                {/* Custom chip */}
                <div className="flex items-center gap-1.5 justify-center">
                  <span className="text-[10px] text-emerald-200/50 font-heading">$</span>
                  <FormattedNumberInput
                    value={customChip}
                    onChange={(raw) => setCustomChip(raw)}
                    placeholder="Custom"
                    className="w-20 bg-black/30 border border-emerald-700/40 rounded px-2 py-1 text-[10px] text-white text-center focus:border-primary/60 focus:outline-none font-heading"
                  />
                </div>

                {/* Spin */}
                <button
                  onClick={spin}
                  disabled={!canSpin}
                  className="w-full max-w-[200px] rounded-lg px-6 py-2.5 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
                  style={{
                    background: 'linear-gradient(180deg, var(--noir-primary), #a08020, #8a6e18)',
                    borderColor: 'var(--noir-primary-bright)',
                    color: '#1a1200',
                    boxShadow: '0 4px 16px rgba(212,175,55,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                >
                  Spin
                </button>

                {/* Animation toggle */}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={useAnimation} onChange={(e) => setUseAnimation(e.target.checked)} className="w-3 h-3 rounded accent-primary" />
                  <span className="text-[10px] text-emerald-200/50 font-heading">Animation</span>
                </label>
              </div>

              {/* ── Right: Betting layout ── */}
              <div className="space-y-px min-w-0">
                {/* Zero */}
                <button
                  onClick={() => addBet('straight', 0)}
                  className="relative w-full h-10 rounded-t font-heading font-bold text-sm text-white transition-all active:scale-[0.98] border border-white/10"
                  style={{
                    background: 'linear-gradient(180deg, #059669, #047857)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
                  }}
                >
                  0
                  {betCountFor('straight', 0) > 0 && (
                    <span className="absolute top-0.5 right-1 w-4 h-4 rounded-full bg-primary text-[8px] text-black font-bold flex items-center justify-center">{betCountFor('straight', 0)}</span>
                  )}
                </button>

                {/* Number grid – 3 rows × 12 columns */}
                <div
                  className="grid gap-px rounded overflow-hidden"
                  style={{ gridTemplateColumns: 'repeat(12, 1fr)', background: 'rgba(0,0,0,0.3)' }}
                >
                  {TABLE_ROWS.map((row) =>
                    row.map((n) => (
                      <NumCell key={n} num={n} onClick={() => addBet('straight', n)} betCount={betCountFor('straight', n)} />
                    ))
                  )}
                </div>

                {/* Column bets */}
                <div className="grid grid-cols-3 gap-px pt-px">
                  {[3, 2, 1].map((col) => (
                    <button
                      key={col}
                      onClick={() => addBet('column', col)}
                      className="relative py-1.5 text-[10px] font-heading font-bold text-emerald-100 rounded-sm transition-all active:scale-[0.98] border border-white/10"
                      style={{ background: 'rgba(0,0,0,0.25)' }}
                    >
                      Col {col} <span className="text-primary">(2:1)</span>
                      {betCountFor('column', col) > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary text-[7px] text-black font-bold flex items-center justify-center">{betCountFor('column', col)}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Dozens */}
                <div className="grid grid-cols-3 gap-px pt-1">
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      onClick={() => addBet('dozen', d)}
                      className="relative py-2 text-[11px] font-heading font-bold text-emerald-100 rounded-sm transition-all active:scale-[0.98] border border-white/10"
                      style={{ background: 'rgba(0,0,0,0.2)' }}
                    >
                      {(d - 1) * 12 + 1}–{d * 12}
                      {betCountFor('dozen', d) > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary text-[7px] text-black font-bold flex items-center justify-center">{betCountFor('dozen', d)}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Outside bets */}
                <div className="grid grid-cols-6 gap-px pt-1">
                  {[
                    { type: 'low', sel: 'low', label: '1–18' },
                    { type: 'even', sel: 'even', label: 'Even' },
                    { type: 'red', sel: 'red', label: 'Red', bg: '#b91c1c' },
                    { type: 'black', sel: 'black', label: 'Black', bg: '#18181b' },
                    { type: 'odd', sel: 'odd', label: 'Odd' },
                    { type: 'high', sel: 'high', label: '19–36' },
                  ].map((b) => (
                    <button
                      key={b.type}
                      onClick={() => addBet(b.type, b.sel)}
                      className="relative py-2 text-[10px] font-heading font-bold text-white rounded-sm transition-all active:scale-[0.98] border border-white/10"
                      style={{ background: b.bg || 'rgba(0,0,0,0.2)' }}
                    >
                      {b.label}
                      {betCountFor(b.type, b.sel) > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary text-[7px] text-black font-bold flex items-center justify-center">{betCountFor(b.type, b.sel)}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Current bets list */}
                {bets.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-2 mt-1 border-t border-white/10">
                    {bets.slice(0, 12).map((b) => (
                      <span key={b.id} className="inline-flex items-center gap-0.5 text-[9px] font-heading bg-black/30 text-emerald-100 px-1.5 py-0.5 rounded border border-white/10">
                        {betLabel(b.type, b.selection)} <span className="text-primary">{formatMoney(b.amount)}</span>
                        <button onClick={() => removeBet(b.id)} className="text-red-400 hover:text-red-300 font-bold ml-0.5">×</button>
                      </span>
                    ))}
                    {bets.length > 12 && <span className="text-[9px] text-emerald-200/50 font-heading">+{bets.length - 12}</span>}
                    <button onClick={clearBets} className="text-[9px] text-emerald-200/50 hover:text-white font-heading ml-auto">Clear all</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom rail */}
          <div style={{ height: 3, background: 'linear-gradient(90deg, #5a3e1b, var(--noir-primary-bright), #8b6914, var(--noir-primary-bright), #5a3e1b)' }} />
        </div>
      )}

      {/* Win celebration overlay */}
      {showWin && (
        <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
          {Array.from({ length: 20 }, (_, i) => (
            <span
              key={i}
              className="absolute text-lg animate-win-shower"
              style={{
                left: `${5 + Math.random() * 90}%`,
                top: '-5%',
                animationDelay: `${Math.random() * 0.6}s`,
                animationDuration: `${1.2 + Math.random() * 0.8}s`,
                '--r': `${Math.random() * 360}deg`,
              }}
            >
              {['🪙', '✨', '💰'][i % 3]}
            </span>
          ))}
        </div>
      )}

      {isOwner && (
        <div className="px-3 py-4 bg-zinc-800/30 border border-zinc-700/30 rounded-md text-center">
          <p className="text-xs text-mutedForeground">You cannot play at your own table. Travel to another city.</p>
        </div>
      )}

      {/* Rules */}
      <div className={`${styles.panel} mobile-panel rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Rules</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>European single zero (0.05% edge)</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Straight up pays 35:1</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Dozens/Columns pay 2:1</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Red/Black/Odd/Even pay 1:1</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
