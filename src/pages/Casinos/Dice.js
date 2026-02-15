import { useState, useEffect, useRef } from 'react';
import { Dices } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const DICE_HOUSE_EDGE = 0.05;
const ROLL_DURATION_MS = 2500;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

// Animated dice display component
function DiceDisplay({ isRolling, result, rollingNumber }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 md:py-8 px-3 rounded-lg bg-gradient-to-b from-zinc-800/50 to-zinc-900/80 border border-primary/20 min-h-[180px] md:min-h-[200px]">
      {isRolling ? (
        <>
          <Dices className="text-primary animate-dice-roll w-16 h-16 md:w-20 md:h-20 mb-3" aria-hidden />
          <p className="text-xs md:text-sm text-primary/80 uppercase tracking-widest font-heading mb-2 animate-pulse">
            Rolling...
          </p>
          <div className="text-5xl md:text-6xl font-heading font-bold text-primary tabular-nums animate-dice-number">
            {rollingNumber ?? '?'}
          </div>
        </>
      ) : result ? (
        <>
          <p className="text-xs md:text-sm text-mutedForeground uppercase tracking-widest font-heading mb-3">
            You rolled
          </p>
          <div
            className={`flex items-center justify-center w-24 h-24 md:w-28 md:h-28 rounded-xl font-heading font-bold text-5xl md:text-6xl tabular-nums border-4 ${
              result.win
                ? 'bg-gradient-to-br from-emerald-600/40 to-emerald-900/40 text-emerald-300 border-emerald-500/70 animate-dice-win'
                : 'bg-gradient-to-br from-red-600/40 to-red-900/40 text-red-300 border-red-500/70 animate-dice-lose'
            }`}
          >
            {result.roll}
          </div>
          <p className={`text-base md:text-lg mt-4 font-heading font-bold uppercase tracking-widest ${
            result.win ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {result.win ? '🎉 Winner!' : '💀 Busted'}
          </p>
        </>
      ) : (
        <>
          <Dices className="text-primary/30 w-16 h-16 md:w-20 md:h-20 mb-3" aria-hidden />
          <p className="text-sm md:text-base text-mutedForeground uppercase tracking-widest font-heading text-center">
            Place a bet to roll
          </p>
          <p className="text-xs text-mutedForeground/60 mt-2 text-center max-w-xs">
            Pick your number. Match the roll to win.
          </p>
        </>
      )}
    </div>
  );
}

export default function Dice() {
  const navigate = useNavigate();
  const [diceConfig, setDiceConfig] = useState({ sides_min: 2, sides_max: 5000, max_bet: 5_000_000 });
  const [ownership, setOwnership] = useState({ current_city: null, owner: null });

  // Betting state
  const [stake, setStake] = useState('');
  const [sides, setSides] = useState('100');
  const [chosenNumber, setChosenNumber] = useState('101');
  const [skipAnimation, setSkipAnimation] = useState(false);

  // Game state
  const [playing, setPlaying] = useState(false);
  const [diceLoading, setDiceLoading] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [rollingNumber, setRollingNumber] = useState(null);

  // Owner state (aligned with Blackjack/RLT)
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [sellPoints, setSellPoints] = useState('');
  const [buyBackOffer, setBuyBackOffer] = useState(null);
  const [buyBackSecondsLeft, setBuyBackSecondsLeft] = useState(null);
  const [buyBackActionLoading, setBuyBackActionLoading] = useState(false);

  // Refs
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

  useEffect(() => {
    fetchConfigAndOwnership();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
    };
  }, []);

  // Calculated values
  const config = diceConfig && typeof diceConfig === 'object' ? diceConfig : { sides_min: 2, sides_max: 5000, max_bet: 5_000_000 };
  const stakeNum = parseInt(String(stake || '').replace(/[^\d]/g, ''), 10) || 0;
  const sidesNum = Math.max(config.sides_min || 2, Math.min(config.sides_max || 5000, parseInt(String(sides || ''), 10) || 100));
  const actualSidesNum = Math.max(2, Math.ceil(sidesNum * 1.05)); // 5% extra sides
  const chosenNum = Math.max(1, Math.min(actualSidesNum, parseInt(String(chosenNumber || ''), 10) || 101));
  const returnsAmount = stakeNum > 0 && sidesNum >= 2 ? Math.floor(stakeNum * sidesNum * (1 - DICE_HOUSE_EDGE)) : 0;
  const canBet = stakeNum > 0 && stakeNum <= (config.max_bet || 0) && sidesNum >= 2 && chosenNum >= 1 && chosenNum <= actualSidesNum;

  // Auto-clamp chosen number when sides change
  useEffect(() => {
    const n = parseInt(String(chosenNumber || ''), 10);
    if (chosenNumber === '' || Number.isNaN(n)) return;
    if (n < 1) setChosenNumber('1');
    else if (n > actualSidesNum) setChosenNumber(String(actualSidesNum));
  }, [sides, actualSidesNum, chosenNumber]);

  // Buy-back timer
  useEffect(() => {
    if (!buyBackOffer?.expires_at) {
      setBuyBackSecondsLeft(null);
      return;
    }
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

  // Rolling animation
  useEffect(() => {
    if (!diceLoading || actualSidesNum < 2) return;
    setLastResult(null);
    rollIntervalRef.current = setInterval(() => {
      setRollingNumber(Math.floor(Math.random() * actualSidesNum) + 1);
    }, 60);
    return () => {
      if (rollIntervalRef.current) {
        clearInterval(rollIntervalRef.current);
        rollIntervalRef.current = null;
      }
    };
  }, [diceLoading, actualSidesNum]);

  const applyRollResult = (data) => {
    if (rollIntervalRef.current) {
      clearInterval(rollIntervalRef.current);
      rollIntervalRef.current = null;
    }
    setRollingNumber(null);
    setLastResult({ roll: data.roll, win: data.win });

    if (data.win) {
      if (data.shortfall > 0) {
        const received = data.actual_payout ?? data.owner_paid ?? 0;
        toast.success(`Rolled ${data.roll}! House paid ${formatMoney(received)} (full win: ${formatMoney(data.payout)})`);
        if (data.ownership_transferred) toast.success('🎰 You won the casino! This table is now yours.');
        if (data.buy_back_offer) setBuyBackOffer(data.buy_back_offer);
      } else {
        toast.success(`🎲 Rolled ${data.roll}! You won ${formatMoney(data.payout)}!`);
      }
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
      else if (chosenNum < 1 || chosenNum > actualSidesNum) toast.error(`Pick 1-${actualSidesNum}`);
      return;
    }

    setChosenNumber(String(chosenNum));
    setPlaying(true);

    // Only set loading and show animation if NOT skipping
    if (!skipAnimation) {
      setDiceLoading(true);
      setLastResult(null);
      setRollingNumber(Math.floor(Math.random() * actualSidesNum) + 1);
    }

    if (rollTimeoutRef.current) {
      clearTimeout(rollTimeoutRef.current);
      rollTimeoutRef.current = null;
    }

    try {
      const res = await api.post('/casino/dice/play', {
        stake: stakeNum,
        sides: sidesNum,
        chosen_number: chosenNum,
      });

      const data = res.data || {};

      if (skipAnimation) {
        // Instant result - no animation
        applyRollResult(data);
        return;
      }

      // With animation
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

  // Owner actions (identical pattern to Blackjack/RLT)
  const handleClaim = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    setOwnerLoading(true);
    try {
      const res = await api.post('/casino/dice/claim', { city });
      toast.success(res.data?.message || 'You own this table!');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
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
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleSetMaxBet = async () => {
    const city = ownership?.current_city;
    if (!city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1000000) {
      toast.error('Min $1,000,000');
      return;
    }
    setOwnerLoading(true);
    try {
      await api.post('/casino/dice/set-max-bet', { city, max_bet: val });
      toast.success('Updated');
      fetchConfigAndOwnership();
      setNewMaxBet('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
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
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleSellOnTrade = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    const points = parseInt(sellPoints, 10);
    if (!points || points <= 0) {
      toast.error('Enter valid points');
      return;
    }
    setOwnerLoading(true);
    try {
      await api.post('/casino/dice/sell-on-trade', { city, points });
      toast.success(`Listed for ${points.toLocaleString()} pts!`);
      setSellPoints('');
      setTimeout(() => navigate('/quick-trade'), 1500);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setOwnerLoading(false);
    }
  };

  const acceptBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      const res = await api.post('/casino/dice/buy-back/accept', { offer_id: buyBackOffer.offer_id });
      toast.success(res.data?.message || 'Accepted! You received the points.');
      setBuyBackOffer(null);
      refreshUser();
      fetchConfigAndOwnership(); // Refresh ownership state after accepting
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setBuyBackActionLoading(false);
    }
  };

  const rejectBuyBack = async () => {
    if (!buyBackOffer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      await api.post('/casino/dice/buy-back/reject', { offer_id: buyBackOffer.offer_id });
      toast.success('You kept the casino!');
      setBuyBackOffer(null);
      fetchConfigAndOwnership(); // Refresh ownership state after rejecting
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setBuyBackActionLoading(false);
    }
  };

  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.current_city && !ownership?.owner;
  const currentCity = ownership?.current_city || '—';
  const maxBet = ownership?.max_bet ?? config.max_bet ?? 5_000_000;

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="dice-page">
      {/* Header (identical to Blackjack/RLT) */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
            🎲 Dice
          </h1>
          <p className="text-xs text-mutedForeground">
            Playing in <span className="text-primary font-bold">{currentCity}</span>
            {ownership?.owner?.username && !isOwner && <span> · Owned by <span className="text-foreground">{ownership.owner.username}</span></span>}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-heading">
          <span className="text-mutedForeground">Max: <span className="text-primary font-bold">{formatMoney(maxBet)}</span></span>
          {canClaim && (
            <button onClick={handleClaim} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">
              Claim
            </button>
          )}
        </div>
      </div>

      {/* Buy-back offer */}
      {buyBackOffer && (
        <div className="p-4 rounded-lg border-2 border-primary/50 bg-gradient-to-r from-primary/10 to-primary/5 space-y-3">
          <h3 className="font-heading font-bold text-primary uppercase tracking-wider">Buy-Back Offer</h3>
          <p className="text-sm text-mutedForeground">
            House could only pay {formatMoney(buyBackOffer.owner_paid)}. Accept to return the table for {(buyBackOffer.points_offered || 0).toLocaleString()} points, or reject to keep ownership.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {buyBackSecondsLeft !== null && (
              <span className="text-sm font-heading font-medium text-primary tabular-nums">
                {Math.floor(buyBackSecondsLeft / 60)}:{String(buyBackSecondsLeft % 60).padStart(2, '0')}
              </span>
            )}
            <button
              type="button"
              onClick={acceptBuyBack}
              disabled={buyBackActionLoading || (buyBackSecondsLeft !== null && buyBackSecondsLeft <= 0)}
              className="bg-primary text-primaryForeground px-5 py-2 rounded-md text-sm font-bold uppercase tracking-wide hover:opacity-90 disabled:opacity-50 touch-manipulation"
            >
              {buyBackActionLoading ? '...' : `Accept (${(buyBackOffer.points_offered || 0).toLocaleString()} pts)`}
            </button>
            <button
              type="button"
              onClick={rejectBuyBack}
              disabled={buyBackActionLoading}
              className="bg-secondary border border-border text-foreground px-5 py-2 rounded-md text-sm font-bold uppercase tracking-wide hover:opacity-90 disabled:opacity-50 touch-manipulation"
            >
              {buyBackActionLoading ? '...' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Owner Controls (identical to Blackjack/RLT) */}
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
            <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
              <h3 className="text-lg font-heading font-semibold text-primary">Place Your Bet</h3>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-mutedForeground mb-2">
                  Stake
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary font-bold">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="5000000"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    className="w-full bg-input border border-border rounded-sm h-12 pl-8 pr-3 text-foreground text-base font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-mutedForeground mb-2">
                  Number of Sides (5% edge)
                </label>
                <input
                  type="number"
                  min={config.sides_min ?? 2}
                  max={config.sides_max ?? 5000}
                  placeholder="100"
                  value={sides}
                  onChange={(e) => setSides(e.target.value)}
                  className="w-full bg-input border border-border rounded-sm h-12 px-3 text-foreground text-base font-semibold"
                />
                {actualSidesNum > sidesNum && (
                  <p className="text-xs text-mutedForeground mt-1.5">
                    Actual sides: {actualSidesNum} ({sidesNum} + 5%)
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-mutedForeground mb-2">
                  Your Number
                </label>
                <input
                  type="number"
                  min={1}
                  max={actualSidesNum}
                  placeholder={`1-${actualSidesNum}`}
                  value={chosenNumber === '' ? '' : String(chosenNum)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setChosenNumber('');
                      return;
                    }
                    const n = parseInt(v, 10);
                    if (!Number.isNaN(n)) {
                      const clamped = Math.max(1, Math.min(actualSidesNum, n));
                      setChosenNumber(String(clamped));
                    }
                  }}
                  onBlur={() => {
                    if (chosenNumber === '') setChosenNumber('1');
                  }}
                  className="w-full bg-input border border-border rounded-sm h-12 px-3 text-foreground text-base font-semibold"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                <input
                  type="checkbox"
                  checked={skipAnimation}
                  onChange={(e) => setSkipAnimation(e.target.checked)}
                  className="rounded border-border bg-input text-primary focus:ring-primary w-4 h-4"
                />
                <span className="text-sm text-mutedForeground">Skip animation</span>
              </label>

              <button
                type="button"
                onClick={placeDiceBet}
                disabled={!canBet || diceLoading}
                className="w-full bg-gradient-to-r from-primary via-yellow-600 to-primary text-primaryForeground hover:opacity-90 active:scale-98 rounded-lg py-4 text-base font-bold uppercase tracking-wider disabled:opacity-50 shadow-xl shadow-primary/20 transition-all touch-manipulation"
              >
                {diceLoading ? 'Rolling...' : `Roll — Returns ${formatMoney(returnsAmount)}`}
              </button>
            </div>
          </div>

        {/* Right panel - Result Display */}
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
            <h3 className="text-lg font-heading font-semibold text-primary">The Roll</h3>
          </div>
          <div className="p-4 space-y-4">
            <DiceDisplay
              isRolling={diceLoading}
              result={lastResult}
              rollingNumber={rollingNumber}
            />

            {/* Game info */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-mutedForeground">Max Bet</span>
                <span className="text-primary font-bold">{formatMoney(config.max_bet ?? 0)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-mutedForeground">House Edge</span>
                <span className="text-foreground font-semibold">5%</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-mutedForeground">Payout</span>
                <span className="text-foreground font-semibold">sides × stake × 0.95</span>
              </div>
            </div>

            <div className="bg-secondary/30 rounded-sm p-3 text-center">
              <p className="text-xs text-mutedForeground">
                Pick 1–{actualSidesNum}. Match the roll to win.<br />
                Payout = sides × stake (5% house edge)
              </p>
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
    </div>
  );
}
