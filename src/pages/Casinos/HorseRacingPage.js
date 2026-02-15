import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const RACE_DURATION_MS = 4000;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function oddsLabel(odds) {
  if (odds === 1) return 'Evens';
  return `${odds}:1`;
}

function formatHistoryDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  return fallback;
}

// Horse emoji with color
const HorseIcon = ({ color = '#eab308', size = 20 }) => (
  <span style={{ fontSize: size }} role="img" aria-label="horse">🏇</span>
);

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
  const [sellPoints, setSellPoints] = useState('');
  const [skipAnimation, setSkipAnimation] = useState(false);
  const raceEndRef = useRef(null);

  const fetchHistory = useCallback(() => {
    api.get('/casino/horseracing/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  }, []);

  const fetchConfigAndOwnership = useCallback(() => {
    api.get('/casino/horseracing/config').then((r) => {
      const data = r.data || {};
      setConfig({
        horses: data.horses || [],
        max_bet: data.max_bet || 10_000_000,
        house_edge: data.house_edge ?? 0.05,
        claim_cost: data.claim_cost ?? 500_000_000,
      });
      setSelectedHorseId((prev) => {
        if (prev) return prev;
        const horses = data.horses || [];
        return horses.length ? horses[0].id : null;
      });
    }).catch(() => {});
    api.get('/casino/horseracing/ownership').then((r) => setOwnership(r.data || null)).catch(() => setOwnership(null));
  }, []);

  useEffect(() => { fetchConfigAndOwnership(); fetchHistory(); }, [fetchConfigAndOwnership, fetchHistory]);

  const handleClaim = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/claim', { city });
      toast.success('You now own the track!');
      fetchConfigAndOwnership();
      refreshUser();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleRelinquish = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    if (!window.confirm('Give up ownership?')) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/relinquish', { city });
      toast.success('Ownership relinquished.');
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSetMaxBet = async () => {
    const city = ownership?.current_city;
    if (!city) return;
    const val = parseInt(String(newMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1_000_000) { toast.error('Min $1,000,000'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/set-max-bet', { city, max_bet: val });
      toast.success('Max bet updated');
      setNewMaxBet('');
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleTransfer = async () => {
    const city = ownership?.current_city;
    if (!city || !transferUsername.trim() || ownerLoading) return;
    if (!window.confirm(`Transfer to ${transferUsername}?`)) return;
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/send-to-user', { city, target_username: transferUsername.trim() });
      toast.success('Transferred');
      setTransferUsername('');
      fetchConfigAndOwnership();
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
  };

  const handleSellOnTrade = async () => {
    const city = ownership?.current_city;
    if (!city || ownerLoading) return;
    const points = parseInt(sellPoints);
    if (!points || points <= 0) { toast.error('Enter valid points'); return; }
    setOwnerLoading(true);
    try {
      await api.post('/casino/horseracing/sell-on-trade', { city, points });
      toast.success(`Listed for ${points.toLocaleString()} pts!`);
      setSellPoints('');
    } catch (e) { toast.error(apiErrorDetail(e, 'Failed')); }
    finally { setOwnerLoading(false); }
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
      
      // Generate realistic race positions
      const finishOrder = horsesList.map((h, i) => {
        if (h.id === winnerId) return 100;
        // Random finish between 60-95%
        return 60 + Math.random() * 35;
      });
      
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
        if (data.won) toast.success(`🏆 ${data.winner_name} wins! +${formatMoney(data.payout - betNum)}`);
        else toast.error(`${data.winner_name} won. Lost ${formatMoney(betNum)}`);
        if (data.new_balance != null) refreshUser(data.new_balance);
        fetchHistory();
      }, durationMs);
    } catch (e) {
      setLoading(false);
      toast.error(apiErrorDetail(e, 'Failed'));
    }
  };

  useEffect(() => {
    return () => { if (raceEndRef.current) clearTimeout(raceEndRef.current); };
  }, []);

  const playAgain = () => { setResult(null); setRaceProgress(null); };

  const raceLanes = raceProgress
    ? raceProgress.horses.map((h, idx) => ({ horse: h, finishPct: raceProgress.finishPcts[idx] }))
    : [];

  // Horse colors for the track
  const horseColors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#ec4899'];

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="horse-racing-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
            🏇 Horse Racing
          </h1>
          <p className="text-xs text-mutedForeground">
            Playing in <span className="text-primary font-bold">{currentCity}</span>
            {ownership?.owner_name && !isOwner && (
              <span> · Owned by <span className="text-foreground">{ownership.owner_name}</span></span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-heading">
          <span className="text-mutedForeground">Max: <span className="text-primary font-bold">{formatMoney(maxBet)}</span></span>
          {canClaim && (
            <button onClick={handleClaim} disabled={ownerLoading} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">
              Buy ({formatMoney(config.claim_cost)})
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
              <input type="text" placeholder="e.g. 10000000" value={newMaxBet} onChange={(e) => setNewMaxBet(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
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
              <button onClick={handleRelinquish} disabled={ownerLoading} className="text-[10px] text-red-400 hover:text-red-300 font-heading">
                Relinquish Ownership
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Race Track / Betting Area */}
      {!isOwner ? (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🏁 Race Track</span>
            {selectedHorse && (
              <span className="text-[10px] text-mutedForeground">
                Selected: <span className="text-foreground font-bold">{selectedHorse.name}</span> ({oddsLabel(selectedHorse.odds)})
              </span>
            )}
          </div>
          
          <div className="p-3 space-y-4">
            {/* Race Animation */}
            {raceProgress && (
              <div className="space-y-1.5 py-2">
                {raceLanes.map((lane, idx) => {
                  const isWinner = lane.horse.id === raceProgress.winnerId;
                  const isSelected = lane.horse.id === selectedHorseId;
                  const color = horseColors[idx % horseColors.length];
                  
                  return (
                    <div key={lane.horse.id} className="flex items-center gap-2">
                      {/* Horse name */}
                      <div className={`w-16 sm:w-24 shrink-0 truncate text-[10px] sm:text-xs font-heading ${isSelected ? 'text-primary font-bold' : 'text-mutedForeground'}`}>
                        {lane.horse.name}
                      </div>
                      
                      {/* Track */}
                      <div className="flex-1 h-6 sm:h-8 bg-gradient-to-r from-green-900/30 to-green-800/20 rounded border border-green-700/30 relative overflow-hidden">
                        {/* Track lines */}
                        <div className="absolute inset-0 flex">
                          {[...Array(10)].map((_, i) => (
                            <div key={i} className="flex-1 border-r border-green-700/20 last:border-0" />
                          ))}
                        </div>
                        
                        {/* Horse */}
                        <div
                          className="absolute top-0 h-full flex items-center transition-all ease-out"
                          style={{
                            left: raceStarted ? `calc(${lane.finishPct}% - 24px)` : '0%',
                            transitionDuration: `${RACE_DURATION_MS}ms`,
                            transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                          }}
                        >
                          <div 
                            className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-sm sm:text-base shadow-lg ${isWinner && !racing ? 'ring-2 ring-yellow-400 ring-offset-1 ring-offset-transparent' : ''}`}
                            style={{ backgroundColor: color }}
                          >
                            🏇
                          </div>
                        </div>
                        
                        {/* Finish line */}
                        <div className="absolute right-0 top-0 bottom-0 w-1 bg-gradient-to-b from-white via-black to-white opacity-50" />
                      </div>
                    </div>
                  );
                })}
                <p className="text-center text-xs text-primary font-heading animate-pulse mt-2">Race in progress...</p>
              </div>
            )}

            {/* Result */}
            {result && !raceProgress && (
              <div className={`text-center py-4 px-4 rounded-lg ${
                result.won 
                  ? 'bg-emerald-500/20 border border-emerald-500/30' 
                  : 'bg-red-500/20 border border-red-500/30'
              }`}>
                <div className={`text-xl font-heading font-bold ${result.won ? 'text-emerald-400' : 'text-red-400'}`}>
                  {result.won ? `🏆 You Won!` : 'Better luck next time'}
                </div>
                <div className="text-sm text-mutedForeground mt-1">
                  Winner: <span className="text-foreground font-bold">{result.winner_name}</span>
                </div>
                <div className={`text-lg font-heading font-bold mt-2 ${result.won ? 'text-emerald-400' : 'text-red-400'}`}>
                  {result.won ? `+${formatMoney(result.payout - betNum)}` : `-${formatMoney(betNum)}`}
                </div>
              </div>
            )}

            {/* Betting UI - only show when not racing */}
            {!raceProgress && !result && (
              <>
                {/* Horse Selection */}
                <div>
                  <p className="text-[10px] text-mutedForeground uppercase tracking-wider mb-2">Select Horse</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {horses.map((h, idx) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => setSelectedHorseId(h.id)}
                        className={`flex items-center justify-between gap-1 py-2 px-2 rounded-md border transition-all text-left ${
                          selectedHorseId === h.id
                            ? 'bg-primary/20 border-primary/50 shadow-md'
                            : 'bg-zinc-800/30 border-zinc-700/30 hover:border-primary/30'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div 
                            className="w-3 h-3 rounded-full shrink-0" 
                            style={{ backgroundColor: horseColors[idx % horseColors.length] }}
                          />
                          <span className={`text-xs font-heading truncate ${selectedHorseId === h.id ? 'text-primary font-bold' : 'text-foreground'}`}>
                            {h.name}
                          </span>
                        </div>
                        <span className="text-[10px] text-mutedForeground shrink-0">{oddsLabel(h.odds)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bet Amount */}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[120px]">
                    <p className="text-[10px] text-mutedForeground uppercase tracking-wider mb-1">Bet Amount</p>
                    <div className="flex items-center">
                      <span className="text-primary font-heading mr-1">$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={bet}
                        onChange={(e) => setBet(e.target.value)}
                        className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground text-center focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-mutedForeground uppercase tracking-wider">Returns</p>
                    <p className="text-lg font-heading font-bold text-primary">{formatMoney(returnsAmount)}</p>
                  </div>
                </div>

                {/* Skip animation */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipAnimation}
                    onChange={(e) => setSkipAnimation(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-zinc-600"
                  />
                  <span className="text-[10px] text-mutedForeground">Skip animation</span>
                </label>

                {/* Race Button */}
                <button
                  onClick={() => placeBet(false)}
                  disabled={!canBet}
                  className="w-full bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded-lg px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide border border-yellow-600/50 shadow-lg shadow-primary/20 disabled:opacity-50 transition-all touch-manipulation"
                >
                  🏁 Place Bet & Race
                </button>
              </>
            )}

            {/* Play Again */}
            {result && !raceProgress && (
              <div className="flex gap-2">
                <button
                  onClick={() => { playAgain(); setTimeout(() => placeBet(true), 0); }}
                  disabled={!canPlaceSameBet}
                  className="flex-1 bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded-lg px-4 py-3 text-sm font-heading font-bold uppercase border border-yellow-600/50 disabled:opacity-50 touch-manipulation"
                >
                  Same Bet
                </button>
                <button
                  onClick={playAgain}
                  className="flex-1 bg-zinc-700/80 hover:bg-zinc-600/80 text-foreground rounded-lg px-4 py-3 text-sm font-heading font-bold uppercase border border-zinc-600/50 touch-manipulation"
                >
                  Change Bet
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="px-3 py-4 bg-zinc-800/30 border border-zinc-700/30 rounded-md text-center">
          <p className="text-xs text-mutedForeground">You cannot bet at your own track. Travel to another city to play.</p>
        </div>
      )}

      {/* History */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">📜 History</span>
          <span className="text-[10px] text-mutedForeground">{history.length} races</span>
        </div>
        {history.length === 0 ? (
          <div className="p-4 text-center text-xs text-mutedForeground">No races yet</div>
        ) : (
          <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
            {history.map((item, i) => {
              const profit = (item.payout || 0) - (item.bet || 0);
              return (
                <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-zinc-800/30 text-xs font-heading">
                  <span className="text-mutedForeground truncate">{formatHistoryDate(item.created_at)}</span>
                  <span className="text-foreground truncate">{item.horse_name}</span>
                  <span className="text-mutedForeground">{formatMoney(item.bet)}</span>
                  <span className={`font-bold tabular-nums ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {profit >= 0 ? '+' : ''}{formatMoney(profit)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rules */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">ℹ️ Rules</span>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Pick a horse and place your bet</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Lower odds = more likely to win</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>Higher odds = bigger payout</li>
            <li className="flex items-start gap-1.5"><span className="text-primary shrink-0">•</span>5% house edge on winnings</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
