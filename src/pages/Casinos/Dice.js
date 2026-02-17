import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const CG_STYLES = `
  .cg-fade-in { animation: cg-fade-in 0.4s ease-out both; }
  @keyframes cg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .cg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const DICE_HOUSE_EDGE = 0.05;
const ROLL_DURATION_MS = 2500;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

/* ═══════════════════════════════════════════════════════
   3D Dice Visual
   ═══════════════════════════════════════════════════════ */
function DiceVisual({ isRolling, result, rollingNumber }) {
  const showResult = !isRolling && result;
  const isWin = showResult && result.win;
  const isLoss = showResult && !result.win;

  return (
    <div className="flex flex-col items-center justify-center py-6 sm:py-8 min-h-[240px] relative">
      {/* Ambient table light */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 rounded-full blur-3xl pointer-events-none"
        style={{
          background: isWin
            ? 'rgba(52,211,153,0.15)'
            : isLoss
              ? 'rgba(248,113,113,0.1)'
              : 'rgba(212,175,55,0.08)',
        }}
      />

      {isRolling ? (
        <>
          {/* Rolling state */}
          <div className="relative">
            <div
              className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl flex items-center justify-center animate-dice-tumble"
              style={{
                background: 'linear-gradient(135deg, #2a2520, #1a1612)',
                border: '3px solid #c9a84c',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 20px rgba(212,175,55,0.15)',
              }}
            >
              <span className="text-4xl sm:text-5xl font-heading font-black text-primary tabular-nums animate-dice-number-blur">
                {rollingNumber ?? '?'}
              </span>
            </div>
            {/* Dice shadow */}
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-20 h-3 rounded-full bg-black/30 blur-md animate-dice-shadow" />
          </div>
          <p className="text-xs text-primary/70 font-heading uppercase tracking-[0.3em] mt-5 animate-pulse">
            Rolling...
          </p>
        </>
      ) : showResult ? (
        <>
          {/* Result state */}
          <div className="relative animate-dice-land">
            <div
              className={`w-28 h-28 sm:w-32 sm:h-32 rounded-2xl flex items-center justify-center transition-all duration-500 ${isWin ? 'animate-dice-win-glow' : ''}`}
              style={{
                background: isWin
                  ? 'linear-gradient(135deg, #064e3b, #065f46)'
                  : 'linear-gradient(135deg, #450a0a, #7f1d1d)',
                border: `3px solid ${isWin ? '#34d399' : '#f87171'}`,
                boxShadow: isWin
                  ? '0 0 30px rgba(52,211,153,0.3), 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)'
                  : '0 0 20px rgba(248,113,113,0.2), 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
            >
              <span className={`text-4xl sm:text-5xl font-heading font-black tabular-nums ${isWin ? 'text-emerald-300' : 'text-red-300'}`}>
                {result.roll}
              </span>
              {/* Corner pips */}
              {[
                { top: 8, left: 8 }, { top: 8, right: 8 },
                { bottom: 8, left: 8 }, { bottom: 8, right: 8 },
              ].map((pos, i) => (
                <div
                  key={i}
                  className="absolute w-2 h-2 rounded-full"
                  style={{
                    ...pos,
                    background: isWin ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.3)',
                  }}
                />
              ))}
            </div>
            {/* Landing shadow */}
            <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 w-24 h-3 rounded-full blur-md ${isWin ? 'bg-emerald-500/20' : 'bg-red-500/10'}`} />
          </div>
          <p className={`text-lg sm:text-xl font-heading font-black uppercase tracking-wider mt-5 ${isWin ? 'text-emerald-400 animate-dice-win-text' : 'text-red-400'}`}>
            {isWin ? 'Winner!' : 'Busted'}
          </p>
        </>
      ) : (
        <>
          {/* Idle state */}
          <div className="relative">
            <div
              className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #2a2520, #1a1612)',
                border: '3px solid rgba(201,168,76,0.3)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
            >
              <span className="text-4xl text-primary/20 font-heading font-black">?</span>
              {[
                { top: 8, left: 8 }, { top: 8, right: 8 },
                { bottom: 8, left: 8 }, { bottom: 8, right: 8 },
              ].map((pos, i) => (
                <div
                  key={i}
                  className="absolute w-2 h-2 rounded-full bg-primary/15"
                  style={pos}
                />
              ))}
            </div>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-20 h-3 rounded-full bg-black/20 blur-md" />
          </div>
          <p className="text-sm text-emerald-200/40 font-heading mt-5 text-center">
            Place a bet to roll
          </p>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Win celebration particles
   ═══════════════════════════════════════════════════════ */
function WinParticles({ active }) {
  const [particles] = useState(() =>
    Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: 5 + Math.random() * 90,
      delay: Math.random() * 0.8,
      duration: 1.0 + Math.random() * 0.6,
      rotate: Math.random() * 540 - 270,
      emoji: ['🪙', '✨', '💰', '🎲'][i % 4],
      size: 14 + Math.random() * 10,
    }))
  );
  if (!active) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute animate-dice-particle"
          style={{
            left: `${p.left}%`,
            top: '-5%',
            fontSize: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--p-rotate': `${p.rotate}deg`,
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Quick bet chips
   ═══════════════════════════════════════════════════════ */
const QUICK_BETS = [
  { label: '100K', value: 100_000, color: '#e4e4e7', text: '#000' },
  { label: '1M', value: 1_000_000, color: '#dc2626', text: '#fff' },
  { label: '5M', value: 5_000_000, color: '#16a34a', text: '#fff' },
  { label: '10M', value: 10_000_000, color: '#18181b', text: '#fff' },
  { label: '50M', value: 50_000_000, color: '#7c3aed', text: '#fff' },
];

export default function Dice() {
  const [diceConfig, setDiceConfig] = useState({ sides_min: 2, sides_max: 5000, max_bet: 5_000_000 });
  const [ownership, setOwnership] = useState({ current_city: null, owner: null });

  const [stake, setStake] = useState('');
  const [sides, setSides] = useState('100');
  const [chosenNumber, setChosenNumber] = useState('101');
  const [skipAnimation, setSkipAnimation] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [diceLoading, setDiceLoading] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [rollingNumber, setRollingNumber] = useState(null);
  const [showWin, setShowWin] = useState(false);

  const [ownerLoading, setOwnerLoading] = useState(false);
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [sellPoints, setSellPoints] = useState('');
  const [buyBackOffer, setBuyBackOffer] = useState(null);
  const [buyBackSecondsLeft, setBuyBackSecondsLeft] = useState(null);
  const [buyBackActionLoading, setBuyBackActionLoading] = useState(false);

  const rollIntervalRef = useRef(null);
  const rollTimeoutRef = useRef(null);
  const pendingResultRef = useRef(null);

  const fetchConfigAndOwnership = () => {
    api.get('/casino/dice/config')
      .then((r) => setDiceConfig(r.data || { sides_min: 2, sides_max: 5000, max_bet: 5_000_000 }))
      .catch(() => {});

    api.get('/casino/dice/ownership')
      .then((r) => {
        const data = r.data || { current_city: null, owner: null };
        setOwnership(data);
        if (data.buy_back_offer) {
          setBuyBackOffer({ ...data.buy_back_offer, offer_id: data.buy_back_offer.offer_id || data.buy_back_offer.id });
        } else {
          setBuyBackOffer(null);
        }
      })
      .catch(() => {});
  };

  useEffect(() => { fetchConfigAndOwnership(); }, []);
  useEffect(() => () => {
    if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
    if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
  }, []);

  const config = diceConfig && typeof diceConfig === 'object' ? diceConfig : { sides_min: 2, sides_max: 5000, max_bet: 5_000_000 };
  const stakeNum = parseInt(String(stake || '').replace(/[^\d]/g, ''), 10) || 0;
  const sidesNum = Math.max(config.sides_min || 2, Math.min(config.sides_max || 5000, parseInt(String(sides || ''), 10) || 100));
  const chosenNum = Math.max(1, Math.min(sidesNum, parseInt(String(chosenNumber || ''), 10) || 1));
  const returnsAmount = stakeNum > 0 && sidesNum >= 2 ? Math.floor(stakeNum * sidesNum * (1 - DICE_HOUSE_EDGE)) : 0;
  const canBet = stakeNum > 0 && stakeNum <= (config.max_bet || 0) && sidesNum >= 2 && chosenNum >= 1 && chosenNum <= sidesNum;

  useEffect(() => {
    const n = parseInt(String(chosenNumber || ''), 10);
    if (chosenNumber === '' || Number.isNaN(n)) return;
    if (n < 1) setChosenNumber('1');
    else if (n > sidesNum) setChosenNumber(String(sidesNum));
  }, [sides, sidesNum, chosenNumber]);

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

  useEffect(() => {
    if (!diceLoading || sidesNum < 2) return;
    setLastResult(null);
    rollIntervalRef.current = setInterval(() => {
      setRollingNumber(Math.floor(Math.random() * sidesNum) + 1);
    }, 60);
    return () => {
      if (rollIntervalRef.current) { clearInterval(rollIntervalRef.current); rollIntervalRef.current = null; }
    };
  }, [diceLoading, sidesNum]);

  const applyRollResult = (data) => {
    if (rollIntervalRef.current) { clearInterval(rollIntervalRef.current); rollIntervalRef.current = null; }
    setRollingNumber(null);
    setLastResult({ roll: data.roll, win: data.win });
    if (data.win) {
      if (data.shortfall > 0) {
        const received = data.actual_payout ?? data.owner_paid ?? 0;
        toast.success(`Rolled ${data.roll}! House paid ${formatMoney(received)} (full win: ${formatMoney(data.payout)})`);
        if (data.ownership_transferred) toast.success('You won the casino! This table is now yours.');
        if (data.buy_back_offer) setBuyBackOffer(data.buy_back_offer);
      } else {
        toast.success(`Rolled ${data.roll}! You won ${formatMoney(data.payout)}!`);
      }
      setShowWin(true);
      setTimeout(() => setShowWin(false), 3000);
    } else {
      toast.error(`Rolled ${data.roll}. Lost ${formatMoney(stakeNum)}.`);
    }
    setDiceLoading(false);
    setPlaying(false);
    refreshUser();
    fetchConfigAndOwnership();
  };

  const placeDiceBet = async () => {
    if (!canBet || playing) {
      if (stakeNum <= 0) toast.error('Enter a stake amount');
      else if (stakeNum > (config.max_bet || 0)) toast.error(`Max bet is ${formatMoney(config.max_bet)}`);
      else if (chosenNum < 1 || chosenNum > sidesNum) toast.error(`Pick 1-${sidesNum}`);
      return;
    }
    setChosenNumber(String(chosenNum));
    setPlaying(true);
    setShowWin(false);
    if (!skipAnimation) {
      setDiceLoading(true);
      setLastResult(null);
      setRollingNumber(Math.floor(Math.random() * sidesNum) + 1);
    }
    if (rollTimeoutRef.current) { clearTimeout(rollTimeoutRef.current); rollTimeoutRef.current = null; }
    try {
      const res = await api.post('/casino/dice/play', { stake: stakeNum, sides: sidesNum, chosen_number: chosenNum });
      const data = res.data || {};
      if (skipAnimation) { applyRollResult(data); return; }
      pendingResultRef.current = data;
      rollTimeoutRef.current = setTimeout(() => {
        rollTimeoutRef.current = null;
        const pending = pendingResultRef.current;
        if (pending) applyRollResult(pending);
      }, ROLL_DURATION_MS);
    } catch (e) {
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      setRollingNumber(null);
      toast.error(e.response?.data?.detail || 'Bet failed');
      setDiceLoading(false);
      setPlaying(false);
    }
  };

  const handleClaim = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    setOwnerLoading(true);
    try {
      const res = await api.post('/casino/dice/claim', { city });
      toast.success(res.data?.message || 'You own this table!');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleRelinquish = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    if (!window.confirm('Give up ownership?')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/dice/relinquish', { city });
      toast.success('Relinquished');
      fetchConfigAndOwnership();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleSetMaxBet = async () => {
    const city = ownership?.current_city;
    if (!city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1000000) { toast.error('Min $1,000,000'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/dice/set-max-bet', { city, max_bet: val });
      toast.success('Updated');
      fetchConfigAndOwnership();
      setNewMaxBet('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleTransfer = async () => {
    const city = ownership?.current_city;
    if (!city || !transferUsername.trim() || ownerLoading) return;
    if (!window.confirm(`Transfer to ${transferUsername.trim()}?`)) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/dice/send-to-user', { city, target_username: transferUsername.trim() });
      toast.success('Transferred');
      fetchConfigAndOwnership();
      setTransferUsername('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const handleSellOnTrade = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    const points = parseInt(sellPoints, 10);
    if (!points || points <= 0) { toast.error('Enter valid points'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/dice/sell-on-trade', { city, points });
      toast.success(`Listed for ${points.toLocaleString()} pts!`);
      setSellPoints('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setOwnerLoading(false); }
  };

  const acceptBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      const res = await api.post('/casino/dice/buy-back/accept', { offer_id: buyBackOffer.offer_id });
      toast.success(res.data?.message || 'Accepted! You received the points.');
      setBuyBackOffer(null);
      refreshUser();
      fetchConfigAndOwnership();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBuyBackActionLoading(false); }
  };

  const rejectBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      await api.post('/casino/dice/buy-back/reject', { offer_id: buyBackOffer.offer_id });
      toast.success('You kept the casino!');
      setBuyBackOffer(null);
      fetchConfigAndOwnership();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBuyBackActionLoading(false); }
  };

  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.current_city && !ownership?.owner;
  const currentCity = ownership?.current_city || '—';
  const maxBet = ownership?.max_bet ?? config.max_bet ?? 5_000_000;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="dice-page">
      <style>{CG_STYLES}</style>
      <style>{`
        @keyframes dice-tumble {
          0% { transform: rotate(0deg) scale(1); }
          15% { transform: rotate(-12deg) scale(1.05) translateY(-6px); }
          30% { transform: rotate(8deg) scale(0.98) translateY(2px); }
          45% { transform: rotate(-6deg) scale(1.03) translateY(-4px); }
          60% { transform: rotate(10deg) scale(0.97) translateY(3px); }
          75% { transform: rotate(-4deg) scale(1.02) translateY(-2px); }
          90% { transform: rotate(3deg) scale(1); }
          100% { transform: rotate(0deg) scale(1); }
        }
        @keyframes dice-number-blur {
          0%, 100% { filter: blur(0px); opacity: 1; }
          50% { filter: blur(1px); opacity: 0.8; }
        }
        @keyframes dice-shadow {
          0%, 100% { transform: translateX(-50%) scaleX(1); opacity: 0.3; }
          50% { transform: translateX(-50%) scaleX(0.7); opacity: 0.15; }
        }
        @keyframes dice-land {
          0% { transform: scale(0.3) rotate(-20deg); opacity: 0; }
          50% { transform: scale(1.1) rotate(3deg); }
          70% { transform: scale(0.95) rotate(-1deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes dice-win-glow {
          0%, 100% { box-shadow: 0 0 30px rgba(52,211,153,0.3), 0 8px 32px rgba(0,0,0,0.4); }
          50% { box-shadow: 0 0 50px rgba(52,211,153,0.5), 0 0 80px rgba(52,211,153,0.2), 0 8px 32px rgba(0,0,0,0.4); }
        }
        @keyframes dice-win-text {
          0%, 100% { text-shadow: 0 0 8px rgba(52,211,153,0.4); }
          50% { text-shadow: 0 0 20px rgba(52,211,153,0.8), 0 0 40px rgba(52,211,153,0.3); }
        }
        @keyframes dice-particle {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translateY(500px) rotate(var(--p-rotate, 180deg)) scale(0.3); opacity: 0; }
        }
        .animate-dice-tumble { animation: dice-tumble 0.4s ease-in-out infinite; }
        .animate-dice-number-blur { animation: dice-number-blur 0.15s ease-in-out infinite; }
        .animate-dice-shadow { animation: dice-shadow 0.4s ease-in-out infinite; }
        .animate-dice-land { animation: dice-land 0.5s cubic-bezier(0.2, 0.8, 0.3, 1.05) forwards; }
        .animate-dice-win-glow { animation: dice-win-glow 1.2s ease-in-out infinite; }
        .animate-dice-win-text { animation: dice-win-text 1s ease-in-out infinite; }
        .animate-dice-particle { animation: dice-particle ease-in forwards; }
      `}</style>

      <WinParticles active={showWin} />

      {/* Page header */}
      <div className="relative cg-fade-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] text-zinc-500 font-heading italic">
            Playing in <span className="text-primary font-bold">{currentCity}</span>
            {ownership?.owner?.username && !isOwner && <span> · Owned by <Link to={`/profile/${encodeURIComponent(ownership.owner.username)}`} className="text-primary hover:underline font-heading">{ownership.owner.username}</Link></span>}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-heading">
          <span className="text-mutedForeground">Max: <span className="text-primary font-bold">{formatMoney(maxBet)}</span></span>
          {canClaim && (
            <button onClick={handleClaim} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">
              Claim
            </button>
          )}
        </div>
      </div>

      {/* Buy-back offer */}
      {buyBackOffer && (
        <div
          className="p-4 rounded-lg border-2 space-y-3"
          style={{
            borderColor: '#c9a84c',
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
              style={{ background: 'linear-gradient(180deg, #d4af37, #8a6e18)', borderColor: '#c9a84c', color: '#1a1200' }}
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

      {/* Owner Controls */}
      {isOwner && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 cg-fade-in`}>
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
              <input type="text" placeholder="e.g. 100000000" value={newMaxBet} onChange={(e) => setNewMaxBet(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
              <button onClick={handleSetMaxBet} disabled={ownerLoading} className="bg-primary/20 text-primary rounded px-2 py-1 text-[10px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading">Set</button>
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
            <div className="flex justify-end">
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
          {/* Gold rail */}
          <div style={{ height: 3, background: 'linear-gradient(90deg, #5a3e1b, #c9a84c, #8b6914, #c9a84c, #5a3e1b)' }} />

          <div className="p-4 sm:p-5">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5">
              {/* Left: Dice display */}
              <div className="flex flex-col items-center">
                <DiceVisual isRolling={diceLoading} result={lastResult} rollingNumber={rollingNumber} />

                {/* Odds info strip */}
                <div className="flex items-center gap-4 mt-2 text-[10px] font-heading">
                  <span className="text-emerald-200/50">
                    Sides: <span className="text-white font-bold">{sidesNum}</span>
                  </span>
                  <span className="text-emerald-200/50">
                    Odds: <span className="text-primary font-bold">1 in {sidesNum}</span>
                  </span>
                  <span className="text-emerald-200/50">
                    Pays: <span className="text-emerald-300 font-bold">{formatMoney(returnsAmount)}</span>
                  </span>
                </div>
              </div>

              {/* Right: Bet controls */}
              <div
                className="flex flex-col gap-3 rounded-lg p-4 min-w-[260px]"
                style={{
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {/* Stake */}
                <div>
                  <label className="block text-[10px] font-heading text-emerald-200/60 uppercase tracking-wider mb-1.5">Stake</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary font-bold text-sm">$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="5000000"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      className="w-full bg-black/30 border border-emerald-700/30 rounded-lg h-10 pl-7 pr-3 text-white text-sm font-heading font-bold focus:border-primary/60 focus:outline-none"
                    />
                  </div>
                  {/* Quick bet chips */}
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {QUICK_BETS.map((qb) => (
                      <button
                        key={qb.value}
                        onClick={() => setStake(String(qb.value))}
                        className="w-9 h-9 rounded-full text-[8px] font-bold transition-all hover:scale-105 active:scale-95"
                        style={{
                          background: `radial-gradient(circle at 40% 35%, ${qb.color}, ${qb.color}dd)`,
                          border: `2px dashed ${qb.color}88`,
                          color: qb.text,
                          boxShadow: stake === String(qb.value) ? `0 0 0 2px #d4af37, 0 2px 8px rgba(0,0,0,0.3)` : '0 2px 6px rgba(0,0,0,0.3)',
                        }}
                      >
                        {qb.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sides */}
                <div>
                  <label className="block text-[10px] font-heading text-emerald-200/60 uppercase tracking-wider mb-1.5">
                    Sides
                  </label>
                  <input
                    type="number"
                    min={config.sides_min ?? 2}
                    max={config.sides_max ?? 5000}
                    placeholder="100"
                    value={sides}
                    onChange={(e) => setSides(e.target.value)}
                    className="w-full bg-black/30 border border-emerald-700/30 rounded-lg h-10 px-3 text-white text-sm font-heading font-bold focus:border-primary/60 focus:outline-none"
                  />
                </div>

                {/* Chosen number */}
                <div>
                  <label className="block text-[10px] font-heading text-emerald-200/60 uppercase tracking-wider mb-1.5">Your Number</label>
                  <input
                    type="number"
                    min={1}
                    max={sidesNum}
                    placeholder={`1-${sidesNum}`}
                    value={chosenNumber === '' ? '' : String(chosenNum)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') { setChosenNumber(''); return; }
                      const n = parseInt(v, 10);
                      if (!Number.isNaN(n)) setChosenNumber(String(Math.max(1, Math.min(sidesNum, n))));
                    }}
                    onBlur={() => { if (chosenNumber === '') setChosenNumber('1'); }}
                    className="w-full bg-black/30 border border-emerald-700/30 rounded-lg h-10 px-3 text-white text-sm font-heading font-bold focus:border-primary/60 focus:outline-none"
                  />
                </div>

                {/* Skip animation */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={skipAnimation} onChange={(e) => setSkipAnimation(e.target.checked)} className="w-3.5 h-3.5 rounded accent-primary" />
                  <span className="text-[10px] text-emerald-200/50 font-heading">Skip animation</span>
                </label>

                {/* Roll button */}
                <button
                  type="button"
                  onClick={placeDiceBet}
                  disabled={!canBet || diceLoading}
                  className="w-full rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
                  style={{
                    background: 'linear-gradient(180deg, #d4af37, #a08020, #8a6e18)',
                    borderColor: '#c9a84c',
                    color: '#1a1200',
                    boxShadow: '0 4px 16px rgba(212,175,55,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                >
                  {diceLoading ? 'Rolling...' : 'Roll the Dice'}
                </button>
              </div>
            </div>
          </div>

          {/* Bottom rail */}
          <div style={{ height: 3, background: 'linear-gradient(90deg, #5a3e1b, #c9a84c, #8b6914, #c9a84c, #5a3e1b)' }} />
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
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Rules</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Pick 1–{sidesNum}, match the roll to win</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Payout = sides × stake × 0.95</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>5% house edge on winnings</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Max bet: {formatMoney(maxBet)}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
