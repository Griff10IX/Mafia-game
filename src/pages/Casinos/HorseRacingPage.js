import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const RACE_DURATION_MS = 3500;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function OddsLabel(odds) {
  if (odds === 1) return 'Evens';
  return `${odds}:1`;
}

function formatHistoryDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  return fallback;
}

export default function HorseRacingPage() {
  const [config, setConfig] = useState({ horses: [], max_bet: 10_000_000, claim_cost: 500_000_000 });
  const [ownership, setOwnership] = useState(null);
  const [selectedHorseId, setSelectedHorseId] = useState(null);
  const [bet, setBet] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [racing, setRacing] = useState(false);
  const [result, setResult] = useState(null);
  const [raceProgress, setRaceProgress] = useState(null);
  const [raceStarted, setRaceStarted] = useState(false);
  const [history, setHistory] = useState([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [newMaxBet, setNewMaxBet] = useState('');
  const [transferUsername, setTransferUsername] = useState('');
  const [skipAnimation, setSkipAnimation] = useState(false);
  const raceEndRef = useRef(null);

  const fetchHistory = () => {
    api.get('/casino/horseracing/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  };

  const fetchConfigAndOwnership = () => {
    api.get('/casino/horseracing/config').then((r) => {
      const data = r.data || {};
      setConfig({
        horses: data.horses || [],
        max_bet: data.max_bet || 10_000_000,
        house_edge: data.house_edge ?? 0.05,
        claim_cost: data.claim_cost ?? 500_000_000,
      });
      if (!selectedHorseId && (data.horses || []).length) setSelectedHorseId(data.horses[0].id);
    }).catch(() => {});
    api.get('/casino/horseracing/ownership').then((r) => setOwnership(r.data || null)).catch(() => setOwnership(null));
  };

  useEffect(() => {
    fetchConfigAndOwnership();
    fetchHistory();
  }, []);

  const handleClaim = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/claim', { city });
      toast.success('You now own the race track here!');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed to claim'));
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleRelinquish = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    if (!window.confirm('Give up ownership of this track?')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/relinquish', { city });
      toast.success('Ownership relinquished.');
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleSetMaxBet = async () => {
    const city = ownership?.current_city;
    if (!city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1_000_000) {
      toast.error('Min max bet is $1,000,000');
      return;
    }
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/set-max-bet', { city, max_bet: val });
      toast.success('Max bet updated');
      setNewMaxBet('');
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleTransfer = async () => {
    const city = ownership?.current_city;
    if (!city || !transferUsername.trim() || ownerLoading) return;
    if (!window.confirm(`Transfer ownership to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/send-to-user', { city, target_username: transferUsername.trim() });
      toast.success('Ownership transferred');
      setTransferUsername('');
      fetchConfigAndOwnership();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Failed'));
    } finally {
      setOwnerLoading(false);
    }
  };

  const horses = config.horses || [];
  const selectedHorse = horses.find((h) => h.id === selectedHorseId);
  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const maxBet = ownership?.max_bet ?? config.max_bet ?? 10_000_000;
  const returnsAmount = selectedHorse && betNum > 0
    ? Math.floor(betNum * (1 + selectedHorse.odds) * (1 - (config.house_edge || 0.05)))
    : 0;
  const isOwner = !!ownership?.is_owner;
  const canClaim = ownership?.is_unclaimed && !ownership?.owner_id;
  const currentCity = ownership?.current_city || '—';
  const canPlaceSameBet = selectedHorseId != null && betNum > 0 && betNum <= maxBet && !loading && !racing;
  const canBet = !isOwner && canPlaceSameBet && !result;

  const placeBet = async (sameBet = false) => {
    const allowed = sameBet ? (!isOwner && canPlaceSameBet) : canBet;
    if (!allowed) return;
    setLoading(true);
    setResult(null);
    setRaceProgress(null);
    try {
      const res = await api.post('/casino/horseracing/race', { horse_id: selectedHorseId, bet: betNum });
      const data = res.data || {};
      setLoading(false);
      setRacing(true);
      setRaceStarted(false);
      const winnerId = data.winner_id;
      const horsesList = data.horses || horses;
      const finishOrder = [];
      const winnerIndex = horsesList.findIndex((h) => h.id === winnerId);
      for (let i = 0; i < horsesList.length; i++) {
        if (i === winnerIndex) finishOrder.push(100);
        else finishOrder.push(75 + Math.random() * 22);
      }
      const durationMs = skipAnimation ? 0 : RACE_DURATION_MS;
      setRaceProgress({ winnerId, finishPcts: finishOrder, horses: horsesList, won: data.won, payout: data.payout || 0 });
      if (!skipAnimation) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setRaceStarted(true));
        });
      }
      raceEndRef.current = setTimeout(() => {
        setResult({ won: data.won, payout: data.payout || 0, winner_name: data.winner_name, new_balance: data.new_balance });
        setRacing(false);
        setRaceStarted(false);
        setRaceProgress(null);
        if (data.won) toast.success(`You won! ${data.winner_name} came first. +${formatMoney(data.payout - betNum)}`);
        else toast.error(`${data.winner_name} won. You lost ${formatMoney(betNum)}.`);
        if (data.new_balance != null) refreshUser(data.new_balance);
        fetchHistory();
      }, durationMs);
    } catch (e) {
      setLoading(false);
      toast.error(e.response?.data?.detail || 'Failed to place bet');
    }
  };

  useEffect(() => {
    return () => {
      if (raceEndRef.current) clearTimeout(raceEndRef.current);
    };
  }, []);

  const playAgain = () => {
    setResult(null);
    setRaceProgress(null);
  };

  const raceLanes = raceProgress
    ? raceProgress.horses.map((h, idx) => ({ horse: h, finishPct: raceProgress.finishPcts[idx] }))
    : [];

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="horse-racing-page">
      <div className="flex items-center gap-4 mb-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary tracking-wider uppercase">Horse Racing</h1>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
      </div>
      <p className="text-center text-mutedForeground font-heading text-sm">Pick a horse, place a bet — then watch the race</p>
      <p className="text-center text-mutedForeground font-heading text-xs">Playing in <span className="text-primary">{currentCity}</span></p>
      {ownership && (
        <div className={`mt-2 p-3 ${styles.panel} rounded-sm border border-primary/20 text-sm`}>
          {isOwner ? (
            <p className="text-foreground font-heading">You own this track — you profit when players lose; you pay when they win.</p>
          ) : ownership?.owner_name ? (
            <p className="text-mutedForeground">Owned by <span className="text-foreground font-medium">{ownership.owner_name}</span>. Losses go to the owner.</p>
          ) : (
            <p className="text-mutedForeground">No owner. Wins and losses are against the house.</p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {canClaim && (
              <button type="button" onClick={handleClaim} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider disabled:opacity-50 border border-yellow-600/50">
                {ownerLoading ? '...' : `Buy track (${formatMoney(config.claim_cost)})`}
              </button>
            )}
            {isOwner && (
              <button type="button" onClick={handleRelinquish} disabled={ownerLoading} className="bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider disabled:opacity-50">
                {ownerLoading ? '...' : 'Relinquish'}
              </button>
            )}
          </div>
        </div>
      )}

      {isOwner && (
        <div className={`${styles.panel} border-2 border-primary/50 rounded-sm overflow-hidden`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Owner Controls</h3>
            <p className="text-xs text-mutedForeground mt-0.5">Manage your race track in {currentCity}</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-secondary/30 rounded-sm p-3">
                <p className="text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Total Earnings</p>
                <p className="text-xl font-heading font-bold text-primary">{formatMoney(ownership?.total_earnings || 0)}</p>
              </div>
              <div className="bg-secondary/30 rounded-sm p-3">
                <p className="text-xs text-mutedForeground font-heading uppercase tracking-wider mb-1">Current Max Bet</p>
                <p className="text-xl font-heading font-bold text-foreground">{formatMoney(maxBet)}</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-heading uppercase tracking-wider text-mutedForeground mb-2">Set Max Bet</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 10000000"
                  value={newMaxBet}
                  onChange={(e) => setNewMaxBet(e.target.value)}
                  className={`flex-1 ${styles.input || ''} h-10 px-3 text-sm border border-primary/30 rounded-sm bg-background`}
                />
                <button onClick={handleSetMaxBet} disabled={ownerLoading} className="bg-primary text-primaryForeground px-4 rounded-sm font-heading font-bold text-sm hover:opacity-90 disabled:opacity-50">
                  Set
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-heading uppercase tracking-wider text-mutedForeground mb-2">Transfer Ownership</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username"
                  value={transferUsername}
                  onChange={(e) => setTransferUsername(e.target.value)}
                  className={`flex-1 ${styles.input || ''} h-10 px-3 text-sm border border-primary/30 rounded-sm bg-background`}
                />
                <button onClick={handleTransfer} disabled={ownerLoading || !transferUsername.trim()} className="bg-secondary text-foreground px-4 rounded-sm font-heading font-bold text-sm hover:opacity-90 disabled:opacity-50 border border-border">
                  Transfer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isOwner ? (
          <div className={`${styles.panel} rounded-sm overflow-hidden border border-primary/20 p-4`}>
            <p className="text-mutedForeground font-heading text-sm">You cannot bet at your own track. Travel to another city to play, or relinquish ownership.</p>
          </div>
        ) : (
        <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
          <div className={`${styles.panelHeader} px-4 py-2 border-b border-primary/30`}>
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Place bet · Run race</h2>
            <p className="text-xs text-mutedForeground mt-0.5">One bet starts the race; winner is revealed at the finish.</p>
          </div>
          <div className="p-4 space-y-5">
            {!result ? (
              <>
                <div>
                  <p className="text-xs font-heading font-bold text-primary uppercase tracking-wider mb-2">Choose horse</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {horses.map((h) => (
                      <label
                        key={h.id}
                        className={`flex items-center justify-between gap-2 py-2 px-2.5 rounded-sm cursor-pointer border transition-colors ${
                          selectedHorseId === h.id
                            ? 'bg-primary/20 border-primary/50 text-primary'
                            : 'border-primary/15 hover:bg-primary/5 text-foreground'
                        }`}
                      >
                        <input
                          type="radio"
                          name="horse"
                          checked={selectedHorseId === h.id}
                          onChange={() => setSelectedHorseId(h.id)}
                          className="sr-only"
                        />
                        <span className="text-xs font-heading font-medium truncate">{h.name}</span>
                        <span className="text-xs font-mono text-mutedForeground shrink-0">{OddsLabel(h.odds)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <label className="block text-xs font-heading text-mutedForeground uppercase tracking-wider mb-1">Bet amount</label>
                      <div className="flex items-center border border-primary/30 rounded-sm overflow-hidden bg-background">
                        <span className="px-2 py-2 text-mutedForeground text-sm">$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={bet}
                          onChange={(e) => setBet(e.target.value)}
                          className="w-28 py-2 px-2 text-sm text-foreground font-heading bg-transparent border-0 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col justify-end">
                    <span className="text-xs text-mutedForeground font-heading uppercase tracking-wider">Returns</span>
                    <span className="text-sm font-heading font-bold text-primary">{formatMoney(returnsAmount)}</span>
                  </div>
                </div>
                {raceProgress ? (
                  <div className="space-y-2">
                    <p className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Race in progress</p>
                    <div className="space-y-2">
                      {raceLanes.map((lane, idx) => {
                        const isWinner = lane.horse.id === raceProgress.winnerId;
                        return (
                          <div
                            key={lane.horse.id}
                            className={`flex items-center gap-2 ${isWinner ? 'bg-primary/10 rounded-sm px-2 py-1 -mx-2' : ''}`}
                            style={{ transitionDelay: raceStarted ? `${idx * 60}ms` : '0ms' }}
                          >
                            <span className={`text-xs font-heading w-28 truncate shrink-0 ${isWinner ? 'text-primary font-bold' : 'text-mutedForeground'}`}>
                              {lane.horse.name}
                            </span>
                            <div className="flex-1 h-7 bg-black/30 rounded-sm overflow-hidden border border-primary/20">
                              <div
                                className={`h-full bg-primary rounded-sm flex items-center justify-end pr-1 animate-horse-race-bar horse-race-lane ${isWinner ? 'winner' : ''}`}
                                style={{
                                  width: raceStarted ? `${lane.finishPct}%` : '0%',
                                  transitionDuration: `${RACE_DURATION_MS}ms`,
                                }}
                              >
                                <span className="text-[10px] text-primaryForeground font-bold">🐎</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-mutedForeground font-heading">
                      <input
                        type="checkbox"
                        checked={skipAnimation}
                        onChange={(e) => setSkipAnimation(e.target.checked)}
                        className="rounded border-primary/50"
                      />
                      Skip animation
                    </label>
                    <button
                      type="button"
                      onClick={placeBet}
                      disabled={!canBet}
                      className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50 border border-yellow-600/50 shadow-lg shadow-primary/20"
                    >
                      Place bet & run race
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
                  <p className={`text-lg font-heading font-bold ${result.won ? 'text-emerald-400' : 'text-red-400'}`}>
                    {result.won ? `You won ${formatMoney(result.payout - betNum)}` : `You lost ${formatMoney(betNum)}`}
                  </p>
                  <p className="text-sm text-mutedForeground mt-1">Winner: {result.winner_name}</p>
                  {result.new_balance != null && (
                    <p className="text-xs text-mutedForeground mt-1">Balance: {formatMoney(result.new_balance)}</p>
                  )}
                </div>
                <p className="text-xs text-mutedForeground font-heading">Horse and amount stay selected for your next bet.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { playAgain(); setTimeout(() => placeBet(true), 0); }}
                    disabled={!canPlaceSameBet || !!isOwner}
                    className="flex-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50 border border-yellow-600/50"
                  >
                    Same bet
                  </button>
                  <button
                    type="button"
                    onClick={playAgain}
                    className="flex-1 bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm font-heading font-bold uppercase tracking-widest py-3 transition-smooth"
                  >
                    Place another bet
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        )}

        <div className="space-y-4">
          <div className={`${styles.panel} rounded-sm overflow-hidden`}>
            <div className={`${styles.panelHeader} px-4 py-2 border-b border-primary/30`}>
              <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Rules</h3>
            </div>
            <div className="p-4 space-y-2 text-xs text-mutedForeground font-heading">
              <p>Max bet: <span className="text-primary font-semibold">{formatMoney(maxBet)}</span></p>
              <p>Place a bet to run the race. If your horse wins, you get stake + winnings at the shown odds (minus house edge).</p>
              <p>Lower odds = favourite (more likely to win). Higher odds = bigger payout.</p>
            </div>
          </div>
          <div className={`${styles.panel} rounded-sm overflow-hidden`}>
            <div className={`${styles.panelHeader} px-4 py-2 border-b border-primary/30`}>
              <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Last 10 results</h3>
            </div>
            <div className="p-3 max-h-[260px] overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-xs text-mutedForeground font-heading">No results yet. Place a bet to run a race.</p>
              ) : (
                <ul className="space-y-2 text-xs font-heading">
                  {history.map((item, i) => {
                    const profit = (item.payout || 0) - (item.bet || 0);
                    const profitStr = profit >= 0 ? `+${formatMoney(profit)}` : formatMoney(profit);
                    return (
                      <li key={i} className="py-2 border-b border-primary/10 last:border-0 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                        <span className="text-mutedForeground">{item.horse_name || 'Horse'}</span>
                        <span className={`font-mono font-semibold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{profitStr}</span>
                        <span className="w-full text-mutedForeground text-[10px]">{formatHistoryDate(item.created_at)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
