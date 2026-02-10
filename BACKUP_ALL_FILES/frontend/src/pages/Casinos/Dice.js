import { useState, useEffect, useRef } from 'react';
import { Dices } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';

const DICE_HOUSE_EDGE = 0.05;
const ROLL_DURATION_MS = 3000;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

export default function Dice() {
  const [diceConfig, setDiceConfig] = useState({ sides_min: 2, sides_max: 1000, max_bet: 5_000_000 });
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
    api.get('/casino/dice/config').then((r) => setDiceConfig(r.data || { sides_min: 2, sides_max: 1000, max_bet: 5_000_000 })).catch(() => {});
    api.get('/casino/dice/ownership').then((r) => {
      const data = r.data || { current_city: null, owner: null, max_bet: null, buy_back_reward: null };
      setOwnership(data);
      if (data.is_owner) {
        setOwnerMaxBet(data.max_bet != null ? String(data.max_bet) : '');
        setOwnerBuyBack(data.buy_back_reward != null ? String(data.buy_back_reward) : '');
      }
    }).catch(() => {});
  };

  useEffect(() => {
    fetchConfigAndOwnership();
  }, []);

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
  const sidesNum = Math.max(diceConfig.sides_min || 2, Math.min(diceConfig.sides_max || 1000, parseInt(String(sides || ''), 10) || 6));
  const chosenNum = Math.max(1, Math.min(sidesNum, parseInt(String(chosenNumber || ''), 10) || 1));
  const returnsAmount = stakeNum > 0 && sidesNum >= 2 ? Math.floor(stakeNum * sidesNum * (1 - DICE_HOUSE_EDGE)) : 0;
  const canBet = stakeNum > 0 && stakeNum <= (diceConfig.max_bet || 0) && sidesNum >= 2 && chosenNum >= 1 && chosenNum <= sidesNum;

  useEffect(() => {
    if (!diceLoading || sidesNum < 2) return;
    setLastResult(null);
    rollIntervalRef.current = setInterval(() => {
      setRollingNumber(Math.floor(Math.random() * sidesNum) + 1);
    }, 80);
    return () => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      rollIntervalRef.current = null;
    };
  }, [diceLoading, sidesNum]);

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

  const placeDiceBet = async () => {
    if (!canBet || playing) return;
    setPlaying(true);
    setDiceLoading(true);
    setLastResult(null);
    setRollingNumber(Math.floor(Math.random() * sidesNum) + 1);
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
    <div className="space-y-8" data-testid="dice-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Dice Game</h1>
        <p className="text-mutedForeground">Pick a number, roll the dice. Playing in {ownership?.current_city ?? '—'}.</p>
        {ownership?.current_city && (
          <div className="mt-3 p-3 bg-card border border-border rounded-sm text-sm">
            {isOwner ? (
              <p className="text-foreground">You own the dice here: you gain when players lose and pay out when they win.</p>
            ) : ownership?.owner ? (
              <p className="text-mutedForeground">Owned by <span className="text-foreground font-medium">{ownership.owner.username}</span>{ownership.owner.wealth_rank_name ? ` (${ownership.owner.wealth_rank_name})` : ''}. Wins are paid by the owner; losses go to the owner.</p>
            ) : (
              <p className="text-mutedForeground">No owner. Wins and losses are against the house.</p>
            )}
            <div className="flex gap-2 mt-2">
              {canClaim && (
                <button type="button" onClick={claimDice} disabled={claimLoading} className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                  {claimLoading ? '...' : 'Claim ownership'}
                </button>
              )}
              {isOwner && (
                <button type="button" onClick={relinquishDice} disabled={claimLoading} className="bg-secondary border border-border text-foreground hover:bg-secondary/80 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                  {claimLoading ? '...' : 'Relinquish'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {buyBackOffer && (
        <div className="p-4 rounded-sm border border-amber-500/50 bg-amber-500/10 space-y-3">
          <h3 className="font-heading font-semibold text-foreground">Buy-back offer</h3>
          <p className="text-sm text-mutedForeground">
            The house could only pay {formatMoney(buyBackOffer.owner_paid)}; you received that amount (full win was {formatMoney((buyBackOffer.owner_paid || 0) + (buyBackOffer.amount_shortfall || 0))}). You can accept the previous owner&apos;s points buy-back within 2 minutes to give the table back, or reject and keep the casino (ownership).
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {buyBackSecondsLeft !== null && (
              <span className="text-sm font-medium tabular-nums">
                Time left: {Math.floor(buyBackSecondsLeft / 60)}:{String(buyBackSecondsLeft % 60).padStart(2, '0')}
              </span>
            )}
            <button
              type="button"
              onClick={acceptBuyBack}
              disabled={buyBackActionLoading || (buyBackSecondsLeft !== null && buyBackSecondsLeft <= 0)}
              className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-4 py-2 text-sm font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {buyBackActionLoading ? '...' : `Accept (${(buyBackOffer.points_offered || 0).toLocaleString()} points)`}
            </button>
            <button
              type="button"
              onClick={rejectBuyBack}
              disabled={buyBackActionLoading || (buyBackSecondsLeft !== null && buyBackSecondsLeft <= 0)}
              className="bg-secondary border border-border text-foreground hover:bg-secondary/80 rounded-sm px-4 py-2 text-sm font-bold uppercase tracking-wider disabled:opacity-50"
            >
              {buyBackActionLoading ? '...' : 'Reject (keep casino)'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {isOwner ? (
          <div className="bg-card border border-border rounded-sm overflow-hidden">
            <div className="px-4 py-3 bg-secondary/40 border-b border-border">
              <h3 className="text-lg font-heading font-semibold text-foreground">Owner controls</h3>
              <p className="text-sm text-mutedForeground">You own the dice here — you cannot play at your own table</p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Set Max bet</label>
                <div className="flex gap-2">
                  <span className="text-mutedForeground self-center">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={String(ownership?.max_bet ?? '')}
                    value={ownerMaxBet}
                    onChange={(e) => setOwnerMaxBet(e.target.value)}
                    className="flex-1 bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
                  />
                  <button type="button" onClick={setMaxBet} disabled={claimLoading} className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                    {claimLoading ? '...' : 'Set'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Set buy-back reward (points)</label>
                <div className="flex gap-2">
                  <span className="text-mutedForeground self-center">pts</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={ownership?.buy_back_reward != null ? String(ownership.buy_back_reward) : '0'}
                    value={ownerBuyBack}
                    onChange={(e) => setOwnerBuyBack(e.target.value)}
                    className="flex-1 bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
                  />
                  <button type="button" onClick={setBuyBackReward} disabled={claimLoading} className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                    {claimLoading ? '...' : 'Set'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Send to another user</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Username"
                    value={sendToUsername}
                    onChange={(e) => setSendToUsername(e.target.value)}
                    className="flex-1 bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
                  />
                  <button type="button" onClick={sendToUser} disabled={claimLoading || !sendToUsername?.trim()} className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                    {claimLoading ? '...' : 'Send'}
                  </button>
                </div>
              </div>
              <button type="button" onClick={relinquishDice} disabled={claimLoading} className="w-full bg-secondary border border-border text-foreground hover:bg-secondary/80 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50">
                {claimLoading ? '...' : 'Relinquish'}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-sm overflow-hidden">
            <div className="px-4 py-3 bg-secondary/40 border-b border-border">
              <h3 className="text-lg font-heading font-semibold text-foreground">Dice Game</h3>
              <p className="text-sm text-mutedForeground">Play the Dice Game</p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Stake:</label>
                <div className="flex items-center gap-1">
                  <span className="text-mutedForeground">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    className="flex-1 bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Number Of Sides (+5%):</label>
                <input
                  type="number"
                  min={diceConfig.sides_min}
                  max={diceConfig.sides_max}
                  placeholder={`Sides (${diceConfig.sides_min},${diceConfig.sides_max})`}
                  value={sides}
                  onChange={(e) => setSides(e.target.value)}
                  className="w-full bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Chosen Number:</label>
                <input
                  type="number"
                  min={1}
                  max={sidesNum}
                  placeholder={`Number (1,${sidesNum})`}
                  value={chosenNumber}
                  onChange={(e) => setChosenNumber(e.target.value)}
                  className="w-full bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipAnimation}
                  onChange={(e) => setSkipAnimation(e.target.checked)}
                  className="rounded border-border bg-input text-primary focus:ring-primary"
                />
                <span className="text-sm text-mutedForeground">Skip animation (show result as soon as roll completes)</span>
              </label>
              <button
                type="button"
                onClick={placeDiceBet}
                disabled={!canBet || diceLoading}
                className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50"
              >
                Place Bet - Returns: <span className="text-primaryForeground/90">{formatMoney(returnsAmount)}</span>
              </button>
            </div>
          </div>
        )}
        <div className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="px-4 py-3 bg-secondary/40 border-b border-border">
            <h3 className="text-lg font-heading font-semibold text-foreground">Dice Info</h3>
            <p className="text-sm text-mutedForeground">Information about this Dice</p>
          </div>
          <div className="p-4 space-y-4">
            {/* Dice roll display */}
            <div className="flex flex-col items-center justify-center py-6 px-4 rounded-sm bg-secondary/20 border border-border">
              {diceLoading ? (
                <>
                  <Dices className="text-primary animate-dice-roll w-14 h-14 mb-3" aria-hidden />
                  <p className="text-sm text-mutedForeground uppercase tracking-wider">
                    Rolling… {!skipAnimation && <span className="normal-case">(~3s)</span>}
                  </p>
                  <p className="text-2xl font-heading font-bold text-primary mt-1 tabular-nums">{rollingNumber ?? '…'}</p>
                </>
              ) : lastResult ? (
                <>
                  <p className="text-xs text-mutedForeground uppercase tracking-wider mb-2">You rolled</p>
                  <div
                    className={`flex items-center justify-center w-16 h-16 rounded-sm font-heading font-bold text-2xl tabular-nums animate-dice-reveal ${
                      lastResult.win ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-destructive/20 text-destructive border border-destructive/40'
                    }`}
                  >
                    {lastResult.roll}
                  </div>
                  <p className={`text-sm mt-2 font-medium ${lastResult.win ? 'text-emerald-400' : 'text-destructive'}`}>
                    {lastResult.win ? 'Win!' : 'Loss'}
                  </p>
                </>
              ) : (
                <>
                  <Dices className="text-mutedForeground w-14 h-14 mb-3 opacity-60" aria-hidden />
                  <p className="text-sm text-mutedForeground uppercase tracking-wider">Place a bet to roll</p>
                </>
              )}
            </div>
            <div className="space-y-3 text-sm">
              <p className="text-mutedForeground"><span className="text-foreground font-medium">Maxbet:</span> {formatMoney(diceConfig.max_bet)}</p>
              <p className="text-mutedForeground"><span className="text-foreground font-medium">House edge:</span> 5% (payout multiplier: sides × 0.95)</p>
              <p className="text-mutedForeground">Pick a number 1–{sidesNum}. Roll equals your number to win.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
