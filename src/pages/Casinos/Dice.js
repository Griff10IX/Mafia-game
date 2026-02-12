import { useState, useEffect, useRef } from 'react';
import { Dices } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const DICE_HOUSE_EDGE = 0.05;
const ROLL_DURATION_MS = 3000;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

export default function Dice() {
  const [diceConfig, setDiceConfig] = useState({ sides_min: 2, sides_max: 5000, max_bet: 5_000_000 });
  const [ownership, setOwnership] = useState({ current_city: null, owner: null });
  const [stake, setStake] = useState('');
  const [sides, setSides] = useState('6');
  const [chosenNumber, setChosenNumber] = useState('1');
  const [diceLoading, setDiceLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { roll, win }
  const [rollingNumber, setRollingNumber] = useState(null); // cycling number during roll
  const [skipAnimation, setSkipAnimation] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [ownerMaxBet, setOwnerMaxBet] = useState('');
  const [ownerBuyBack, setOwnerBuyBack] = useState('');
  const [sendToUsername, setSendToUsername] = useState('');
  const [buyBackOffer, setBuyBackOffer] = useState(null); // { offer_id, points_offered, amount_shortfall, owner_paid, expires_at }
  const [buyBackSecondsLeft, setBuyBackSecondsLeft] = useState(null);
  const [buyBackActionLoading, setBuyBackActionLoading] = useState(false);
  const rollIntervalRef = useRef(null);
  const rollTimeoutRef = useRef(null);
  const pendingResultRef = useRef(null);
  const rollStartTimeRef = useRef(0);

  const fetchConfigAndOwnership = () => {
    api.get('/casino/dice/config').then((r) => setDiceConfig(r.data || { sides_min: 2, sides_max: 5000, max_bet: 5_000_000 })).catch(() => {});
    api.get('/casino/dice/ownership').then((r) => {
      const data = r.data || { current_city: null, owner: null, max_bet: null, buy_back_reward: null, buy_back_offer: null };
      setOwnership(data);
      if (data.buy_back_offer) setBuyBackOffer({ ...data.buy_back_offer, offer_id: data.buy_back_offer.offer_id || data.buy_back_offer.id });
      else setBuyBackOffer(null);
      if (data.is_owner) {
        setOwnerMaxBet(data.max_bet != null ? String(data.max_bet) : '');
        setOwnerBuyBack(data.buy_back_reward != null ? String(data.buy_back_reward) : '');
      }
    }).catch(() => {});
  };

  useEffect(() => {
    fetchConfigAndOwnership();
  }, []);

  // When sides change, clamp chosen number to 1..actualSidesNum so it's never out of range
  useEffect(() => {
    const n = parseInt(String(chosenNumber || ''), 10);
    if (chosenNumber === '' || Number.isNaN(n)) return;
    const actual = Math.ceil((Math.max(diceConfig.sides_min || 2, Math.min(diceConfig.sides_max || 5000, parseInt(String(sides || ''), 10) || 6)) * 1.05));
    if (n < 1) setChosenNumber('1');
    else if (n > actual) setChosenNumber(String(actual));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only clamp when sides/actual sides change
  }, [sidesNum]);

  // Keep state in sync with displayed (clamped) value so we never show one number and bet another
  useEffect(() => {
    if (chosenNumber === '') return;
    const parsed = parseInt(chosenNumber, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > actualSidesNum) setChosenNumber(String(chosenNum));
  }, [chosenNumber, chosenNum, actualSidesNum]);

  useEffect(() => {
    return () => {
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
    };
  }, []);

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

  const stakeNum = parseInt(String(stake || '').replace(/[^\d]/g, ''), 10) || 0;
  const sidesNum = Math.max(diceConfig.sides_min || 2, Math.min(diceConfig.sides_max || 5000, parseInt(String(sides || ''), 10) || 6));
  const actualSidesNum = Math.ceil(sidesNum * 1.05);  // 5% extra sides per game rules (e.g. 1000 -> 1050)
  const chosenNum = Math.max(1, Math.min(actualSidesNum, parseInt(String(chosenNumber || ''), 10) || 1));
  const returnsAmount = stakeNum > 0 && sidesNum >= 2 ? Math.floor(stakeNum * sidesNum * (1 - DICE_HOUSE_EDGE)) : 0;
  const canBet = stakeNum > 0 && stakeNum <= (diceConfig.max_bet || 0) && sidesNum >= 2 && chosenNum >= 1 && chosenNum <= actualSidesNum;

  useEffect(() => {
    if (!diceLoading || actualSidesNum < 2) return;
    setLastResult(null);
    rollIntervalRef.current = setInterval(() => {
      setRollingNumber(Math.floor(Math.random() * actualSidesNum) + 1);
    }, 80);
    return () => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      rollIntervalRef.current = null;
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
        toast.success(`You rolled ${data.roll}! House could only pay ${formatMoney(received)} (full win was ${formatMoney(data.payout)}). You received ${formatMoney(received)}.`);
        if (data.ownership_transferred) toast.success('You won the casino! The dice here are now yours.');
        if (data.buy_back_offer) setBuyBackOffer(data.buy_back_offer);
      } else {
        toast.success(`You rolled ${data.roll}! You won ${formatMoney(data.payout)}.`);
      }
    } else {
      toast.error(`You rolled ${data.roll}. You lost ${formatMoney(stakeNum)}.`);
    }
    setDiceLoading(false);
    setPlaying(false);
    refreshUser();
    fetchConfigAndOwnership();
  };

  const claimDice = async () => {
    const city = ownership?.current_city;
    if (!city || claimLoading) return;
    setClaimLoading(true);
    try {
      const res = await api.post('/casino/dice/claim', { city });
      toast.success(res.data?.message || 'You now own the dice here.');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim');
    } finally {
      setClaimLoading(false);
    }
  };

  const relinquishDice = async () => {
    const city = ownership?.current_city;
    if (!city || claimLoading) return;
    const confirmed = window.confirm(`Are you sure you want to relinquish the dice in ${city}? You will no longer own this table.`);
    if (!confirmed) return;
    setClaimLoading(true);
    try {
      const res = await api.post('/casino/dice/relinquish', { city });
      toast.success(res.data?.message || 'Relinquished.');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to relinquish');
    } finally {
      setClaimLoading(false);
    }
  };

  const setMaxBet = async () => {
    const city = ownership?.current_city;
    const val = parseInt(String(ownerMaxBet || '').replace(/[^\d]/g, ''), 10);
    if (!city || claimLoading || Number.isNaN(val) || val < 0) return;
    setClaimLoading(true);
    try {
      await api.post('/casino/dice/set-max-bet', { city, max_bet: val });
      toast.success(`Max bet set to ${formatMoney(val)}.`);
      setOwnerMaxBet(String(val));
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set max bet');
    } finally {
      setClaimLoading(false);
    }
  };

  const setBuyBackReward = async () => {
    const city = ownership?.current_city;
    const val = parseInt(String(ownerBuyBack || '').replace(/[^\d]/g, ''), 10);
    if (!city || claimLoading || Number.isNaN(val) || val < 0) return;
    setClaimLoading(true);
    try {
      await api.post('/casino/dice/set-buy-back-reward', { city, amount: val });
      toast.success(`Buy-back reward set to ${val.toLocaleString()} points.`);
      setOwnerBuyBack(String(val));
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set buy-back reward');
    } finally {
      setClaimLoading(false);
    }
  };

  const acceptBuyBack = async () => {
    const offer = buyBackOffer;
    if (!offer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      const res = await api.post('/casino/dice/buy-back/accept', { offer_id: offer.offer_id });
      toast.success(res.data?.message || 'Accepted. You received the points.');
      setBuyBackOffer(null);
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to accept buy-back');
    } finally {
      setBuyBackActionLoading(false);
    }
  };

  const rejectBuyBack = async () => {
    const offer = buyBackOffer;
    if (!offer?.offer_id || buyBackActionLoading) return;
    setBuyBackActionLoading(true);
    try {
      await api.post('/casino/dice/buy-back/reject', { offer_id: offer.offer_id });
      toast.success('You kept the casino payout.');
      setBuyBackOffer(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reject');
    } finally {
      setBuyBackActionLoading(false);
    }
  };

  const sendToUser = async () => {
    const city = ownership?.current_city;
    const username = sendToUsername?.trim();
    if (!city || !username || claimLoading) return;
    setClaimLoading(true);
    try {
      await api.post('/casino/dice/send-to-user', { city, target_username: username });
      toast.success(`Dice in ${city} transferred to ${username}.`);
      setSendToUsername('');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to transfer');
    } finally {
      setClaimLoading(false);
    }
  };

  const resetDiceProfit = async () => {
    const city = ownership?.current_city;
    if (!city || claimLoading) return;
    if (!window.confirm('Reset this table\'s profit/loss to zero?')) return;
    setClaimLoading(true);
    try {
      await api.post('/casino/dice/reset-profit', { city });
      toast.success('Profit reset to zero.');
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Reset failed');
    } finally {
      setClaimLoading(false);
    }
  };

  const placeDiceBet = async () => {
    if (!canBet || playing) return;
    setChosenNumber(String(chosenNum));
    setPlaying(true);
    setDiceLoading(true);
    setLastResult(null);
    setRollingNumber(Math.floor(Math.random() * actualSidesNum) + 1);
    rollStartTimeRef.current = Date.now();
    if (rollTimeoutRef.current) {
      clearTimeout(rollTimeoutRef.current);
      rollTimeoutRef.current = null;
    }
    try {
      const res = await api.post('/casino/dice/play', { stake: stakeNum, sides: sidesNum, chosen_number: chosenNum });
      const data = res.data || {};
      if (skipAnimation) {
        applyRollResult(data);
        return;
      }
      pendingResultRef.current = { roll: data.roll, win: data.win, payout: data.payout, actual_payout: data.actual_payout, buy_back_offer: data.buy_back_offer, owner_paid: data.owner_paid, shortfall: data.shortfall, ownership_transferred: data.ownership_transferred };
      const elapsed = Date.now() - rollStartTimeRef.current;
      const remaining = Math.max(0, ROLL_DURATION_MS - elapsed);
      rollTimeoutRef.current = setTimeout(() => {
        rollTimeoutRef.current = null;
        const pending = pendingResultRef.current;
        if (pending) {
          setLastResult({ roll: pending.roll, win: pending.win });
          if (pending.win) {
            if (pending.shortfall > 0) {
              const received = pending.actual_payout ?? pending.owner_paid ?? 0;
              toast.success(`You rolled ${pending.roll}! House could only pay ${formatMoney(received)} (full win was ${formatMoney(pending.payout)}). You received ${formatMoney(received)}.`);
              if (pending.ownership_transferred) toast.success('You won the casino! The dice here are now yours.');
              if (pending.buy_back_offer) setBuyBackOffer(pending.buy_back_offer);
            } else {
              toast.success(`You rolled ${pending.roll}! You won ${formatMoney(pending.payout)}.`);
            }
          } else {
            toast.error(`You rolled ${pending.roll}. You lost ${formatMoney(stakeNum)}.`);
          }
        }
        if (rollIntervalRef.current) {
          clearInterval(rollIntervalRef.current);
          rollIntervalRef.current = null;
        }
        setRollingNumber(null);
        setDiceLoading(false);
        setPlaying(false);
        refreshUser();
        fetchConfigAndOwnership();
      }, remaining);
    } catch (e) {
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
      rollTimeoutRef.current = null;
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      setRollingNumber(null);
      toast.error(e.response?.data?.detail || 'Bet failed');
      setDiceLoading(false);
      setPlaying(false);
    }
  };

  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.current_city && !ownership?.owner;

  return (
    <div className={`space-y-4 md:space-y-5 ${styles.pageContent}`} data-testid="dice-page">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-xl sm:text-3xl md:text-4xl font-heading font-bold text-primary tracking-wider uppercase">The Dice Table</h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">Playing in <span className="text-primary">{ownership?.current_city ?? '—'}</span></p>
        
        {ownership?.current_city && (
          <div className={`mt-4 p-3 ${styles.panel} rounded-md text-sm`}>
            {isOwner ? (
              <p className="text-primary font-heading">You own this table — you profit when players lose and pay when they win.</p>
            ) : ownership?.owner ? (
              <p className="text-mutedForeground">Owned by <span className="text-primary font-medium">{ownership.owner.username}</span>{ownership.owner.wealth_rank_name ? ` (${ownership.owner.wealth_rank_name})` : ''}. The house pays wins; losses go to the owner.</p>
            ) : (
              <p className="text-mutedForeground">No owner. Wins and losses are against the house.</p>
            )}
            <div className="flex gap-2 mt-3">
              {canClaim && (
                <button type="button" onClick={claimDice} disabled={claimLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-4 py-1.5 text-xs font-heading font-bold uppercase tracking-widest disabled:opacity-50 border border-yellow-600/50">
                  {claimLoading ? '...' : 'Claim Ownership'}
                </button>
              )}
              {isOwner && (
                <button type="button" onClick={relinquishDice} disabled={claimLoading} className="bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm px-4 py-1.5 text-xs font-heading font-bold uppercase tracking-widest disabled:opacity-50">
                  {claimLoading ? '...' : 'Relinquish'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {buyBackOffer && (
        <div className="p-4 rounded-sm border-2 border-primary/50 bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 space-y-3">
          <h3 className="font-heading font-bold text-primary uppercase tracking-wider">Buy-Back Offer</h3>
          <p className="text-sm text-mutedForeground">
            The house could only pay {formatMoney(buyBackOffer.owner_paid)}; you received that amount (full win was {formatMoney((buyBackOffer.owner_paid || 0) + (buyBackOffer.amount_shortfall || 0))}). Accept the buy-back to return the table, or reject to keep ownership.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {buyBackSecondsLeft !== null && (
              <span className="text-sm font-heading font-medium tabular-nums text-primary">
                {Math.floor(buyBackSecondsLeft / 60)}:{String(buyBackSecondsLeft % 60).padStart(2, '0')}
              </span>
            )}
            <button
              type="button"
              onClick={acceptBuyBack}
              disabled={buyBackActionLoading || (buyBackSecondsLeft !== null && buyBackSecondsLeft <= 0)}
              className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-4 py-2 text-xs font-heading font-bold uppercase tracking-widest disabled:opacity-50 border border-yellow-600/50"
            >
              {buyBackActionLoading ? '...' : `Accept (${(buyBackOffer.points_offered || 0).toLocaleString()} pts)`}
            </button>
            <button
              type="button"
              onClick={rejectBuyBack}
              disabled={buyBackActionLoading || (buyBackSecondsLeft !== null && buyBackSecondsLeft <= 0)}
              className="bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm px-4 py-2 text-xs font-heading font-bold uppercase tracking-widest disabled:opacity-50"
            >
              {buyBackActionLoading ? '...' : 'Reject (keep table)'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isOwner ? (
          <div className={`${styles.panel} rounded-md overflow-hidden`}>
            {/* Header with Art Deco decorations */}
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-8 h-px bg-primary/50" />
                <h3 className="text-base font-heading font-bold text-primary uppercase tracking-widest">Owner Controls</h3>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
              {ownership?.profit != null && (
                <p className={`text-sm font-heading font-bold mt-1 ${(ownership.profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(ownership.profit || 0) >= 0 ? 'Profit' : 'Loss'}: {formatMoney(Math.abs(ownership.profit))}
                </p>
              )}
              <p className="text-xs text-mutedForeground mt-1">You cannot play at your own table</p>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-heading font-medium text-primary/80 uppercase tracking-wider mb-1">Max Bet</label>
                <div className="flex gap-2">
                  <span className="text-primary self-center text-sm">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={String(ownership?.max_bet ?? '')}
                    value={ownerMaxBet}
                    onChange={(e) => setOwnerMaxBet(e.target.value)}
                    className="flex-1 bg-zinc-800/80 border border-primary/20 rounded-sm h-8 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                  <button type="button" onClick={setMaxBet} disabled={claimLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1 text-xs font-heading font-bold uppercase tracking-wider disabled:opacity-50 border border-yellow-600/50">
                    {claimLoading ? '...' : 'Set'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-heading font-medium text-primary/80 uppercase tracking-wider mb-1">Buy-Back Reward</label>
                <div className="flex gap-2">
                  <span className="text-primary self-center text-xs">pts</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={ownership?.buy_back_reward != null ? String(ownership.buy_back_reward) : '0'}
                    value={ownerBuyBack}
                    onChange={(e) => setOwnerBuyBack(e.target.value)}
                    className="flex-1 bg-zinc-800/80 border border-primary/20 rounded-sm h-8 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                  <button type="button" onClick={setBuyBackReward} disabled={claimLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1 text-xs font-heading font-bold uppercase tracking-wider disabled:opacity-50 border border-yellow-600/50">
                    {claimLoading ? '...' : 'Set'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-heading font-medium text-primary/80 uppercase tracking-wider mb-1">Transfer Ownership</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Username"
                    value={sendToUsername}
                    onChange={(e) => setSendToUsername(e.target.value)}
                    className="flex-1 bg-zinc-800/80 border border-primary/20 rounded-sm h-8 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                  <button type="button" onClick={sendToUser} disabled={claimLoading || !sendToUsername?.trim()} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1 text-xs font-heading font-bold uppercase tracking-wider disabled:opacity-50 border border-yellow-600/50">
                    {claimLoading ? '...' : 'Send'}
                  </button>
                </div>
              </div>
              <button type="button" onClick={resetDiceProfit} disabled={claimLoading} className="w-full bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm font-heading font-bold uppercase tracking-widest py-2 text-sm transition-smooth disabled:opacity-50">
                {claimLoading ? '...' : 'Reset Profit'}
              </button>
              <button type="button" onClick={relinquishDice} disabled={claimLoading} className="w-full bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm font-heading font-bold uppercase tracking-widest py-2 text-sm transition-smooth disabled:opacity-50">
                {claimLoading ? '...' : 'Relinquish Table'}
              </button>
            </div>
          </div>
        ) : (
          <div className={`${styles.panel} rounded-md overflow-hidden`}>
            <div className="px-3 py-1.5 sm:py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 sm:w-8 h-px bg-primary/50" />
                <h3 className="text-sm sm:text-base font-heading font-bold text-primary uppercase tracking-widest">Place Your Bet</h3>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
            </div>
            <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
              <div>
                <label className="block text-[10px] sm:text-xs font-heading font-medium text-primary/80 uppercase tracking-wider mb-1">Stake</label>
                <div className="flex items-center gap-2">
                  <span className="text-primary text-sm">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    className="flex-1 bg-zinc-800/80 border border-primary/20 rounded-sm h-8 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-heading font-medium text-primary/80 uppercase tracking-wider mb-1">Number of Sides</label>
                <input
                  type="number"
                  min={diceConfig.sides_min}
                  max={diceConfig.sides_max}
                  placeholder={`${diceConfig.sides_min}–${diceConfig.sides_max}`}
                  value={sides}
                  onChange={(e) => setSides(e.target.value)}
                  className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-8 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                />
                {actualSidesNum > sidesNum && (
                  <p className="text-[10px] text-mutedForeground mt-0.5">5% extra sides → Actual: {actualSidesNum}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-heading font-medium text-primary/80 uppercase tracking-wider mb-1">Your Number</label>
                <input
                  type="number"
                  min={1}
                  max={actualSidesNum}
                  placeholder={`1–${actualSidesNum}`}
                  value={chosenNumber === '' ? '' : String(chosenNum)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setChosenNumber('');
                      return;
                    }
                    const n = parseInt(v, 10);
                    if (Number.isNaN(n)) return;
                    const clamped = Math.max(1, Math.min(actualSidesNum, n));
                    setChosenNumber(String(clamped));
                  }}
                  onBlur={() => {
                    const n = parseInt(String(chosenNumber || ''), 10);
                    if (Number.isNaN(n) || n < 1) setChosenNumber('1');
                    else if (n > actualSidesNum) setChosenNumber(String(actualSidesNum));
                  }}
                  className="w-full bg-zinc-800/80 border border-primary/20 rounded-sm h-8 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipAnimation}
                  onChange={(e) => setSkipAnimation(e.target.checked)}
                  className="rounded border-primary/30 bg-zinc-800 text-primary focus:ring-primary"
                />
                <span className="text-xs text-mutedForeground">Skip animation</span>
              </label>
              <button
                type="button"
                onClick={placeDiceBet}
                disabled={!canBet || diceLoading}
                className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-2.5 text-sm transition-smooth disabled:opacity-50 border border-yellow-600/50 shadow-lg shadow-primary/20"
              >
                Roll — Returns {formatMoney(returnsAmount)}
              </button>
            </div>
          </div>
        )}
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-3 py-1.5 sm:py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <div className="flex items-center gap-2">
              <div className="w-6 sm:w-8 h-px bg-primary/50" />
              <h3 className="text-sm sm:text-base font-heading font-bold text-primary uppercase tracking-widest">The Roll</h3>
              <div className="flex-1 h-px bg-primary/50" />
            </div>
          </div>
          <div className="p-3 sm:p-4 space-y-3">
            {/* Dice roll display - compact, result clear on mobile */}
            <div className="flex flex-col items-center justify-center py-4 sm:py-5 px-3 rounded-sm bg-gradient-to-b from-zinc-800/50 to-zinc-900/80 border border-primary/20 min-h-[120px] sm:min-h-[140px]">
              {diceLoading ? (
                <>
                  <Dices className="text-primary animate-dice-roll w-10 h-10 sm:w-12 sm:h-12 mb-2" aria-hidden />
                  <p className="text-[10px] sm:text-xs text-primary/80 uppercase tracking-widest font-heading">
                    Rolling{!skipAnimation && ' (~3s)'}
                  </p>
                  <p className="text-2xl sm:text-3xl font-heading font-bold text-primary mt-1 tabular-nums">{rollingNumber ?? '…'}</p>
                </>
              ) : lastResult ? (
                <>
                  <p className="text-[10px] sm:text-xs text-mutedForeground uppercase tracking-widest font-heading mb-1 sm:mb-2">You rolled</p>
                  <div
                    className={`flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-sm font-heading font-bold text-2xl sm:text-3xl tabular-nums animate-dice-reveal border-2 ${
                      lastResult.win 
                        ? 'bg-gradient-to-b from-emerald-600/30 to-emerald-900/30 text-emerald-400 border-emerald-500/60 shadow-lg shadow-emerald-500/20' 
                        : 'bg-gradient-to-b from-red-600/30 to-red-900/30 text-red-400 border-red-500/60 shadow-lg shadow-red-500/20'
                    }`}
                  >
                    {lastResult.roll}
                  </div>
                  <p className={`text-xs sm:text-sm mt-2 font-heading font-bold uppercase tracking-widest ${lastResult.win ? 'text-emerald-400' : 'text-red-400'}`}>
                    {lastResult.win ? 'Winner!' : 'Busted'}
                  </p>
                </>
              ) : (
                <>
                  <Dices className="text-primary/40 w-10 h-10 sm:w-12 sm:h-12 mb-2" aria-hidden />
                  <p className="text-[10px] sm:text-xs text-mutedForeground uppercase tracking-widest font-heading text-center">Place a bet to roll</p>
                </>
              )}
            </div>
            {/* Info - compact */}
            <div className="space-y-1.5 text-[10px] sm:text-xs">
              <div className="flex justify-between items-center py-1 border-b border-primary/10">
                <span className="text-mutedForeground font-heading uppercase tracking-wider">Max Bet</span>
                <span className="text-primary font-heading font-bold">{formatMoney(diceConfig.max_bet)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-primary/10">
                <span className="text-mutedForeground font-heading uppercase tracking-wider">House Edge</span>
                <span className="text-foreground">5%</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-mutedForeground font-heading uppercase tracking-wider">Payout</span>
                <span className="text-foreground">sides × 0.95</span>
              </div>
            </div>
            <p className="text-[10px] sm:text-xs text-center text-mutedForeground italic">Pick 1–{actualSidesNum}. Match the roll to win. Payout = sides entered × stake (5% house edge).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
