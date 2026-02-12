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

export default function HorseRacingPage() {
  const [config, setConfig] = useState({ horses: [], max_bet: 10_000_000 });
  const [selectedHorseId, setSelectedHorseId] = useState(null);
  const [bet, setBet] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [racing, setRacing] = useState(false);
  const [result, setResult] = useState(null);
  const [raceProgress, setRaceProgress] = useState(null);
  const [raceStarted, setRaceStarted] = useState(false);
  const [history, setHistory] = useState([]);
  const raceEndRef = useRef(null);

  const fetchHistory = () => {
    api.get('/casino/horseracing/history').then((r) => setHistory(r.data?.history || [])).catch(() => {});
  };

  useEffect(() => {
    api.get('/casino/horseracing/config').then((r) => {
      const data = r.data || {};
      setConfig({ horses: data.horses || [], max_bet: data.max_bet || 10_000_000 });
      if (!selectedHorseId && (data.horses || []).length) setSelectedHorseId(data.horses[0].id);
    }).catch(() => {});
    fetchHistory();
  }, []);

  const horses = config.horses || [];
  const selectedHorse = horses.find((h) => h.id === selectedHorseId);
  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const returnsAmount = selectedHorse && betNum > 0
    ? Math.floor(betNum * (1 + selectedHorse.odds) * (1 - (config.house_edge || 0.05)))
    : 0;
  const canBet = selectedHorseId != null && betNum > 0 && betNum <= (config.max_bet || 0) && !loading && !racing && !result;

  const placeBet = async () => {
    if (!canBet) return;
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
      setRaceProgress({ winnerId, finishPcts: finishOrder, horses: horsesList, won: data.won, payout: data.payout || 0 });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setRaceStarted(true));
      });
      raceEndRef.current = setTimeout(() => {
        setResult({ won: data.won, payout: data.payout || 0, winner_name: data.winner_name, new_balance: data.new_balance });
        setRacing(false);
        setRaceStarted(false);
        setRaceProgress(null);
        if (data.won) toast.success(`You won! ${data.winner_name} came first. +${formatMoney(data.payout - betNum)}`);
        else toast.error(`${data.winner_name} won. You lost ${formatMoney(betNum)}.`);
        if (data.new_balance != null) refreshUser(data.new_balance);
        fetchHistory();
      }, RACE_DURATION_MS);
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
    <div className={`space-y-8 ${styles.pageContent}`} data-testid="horse-racing-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Horse Racing</h1>
        <p className="text-mutedForeground">Pick a horse and place your bet</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-3 bg-secondary/40 border-b border-border">
            <h3 className="text-lg font-heading font-semibold text-foreground">Horse Racing</h3>
            <p className="text-sm text-mutedForeground">Bet on the fastest horse</p>
          </div>
          <div className="p-4 space-y-6">
            {!result ? (
              <>
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Horse</p>
                  <div className="space-y-1.5">
                    {horses.map((h) => (
                      <label
                        key={h.id}
                        className={`flex items-center gap-3 py-2 px-3 rounded-sm cursor-pointer border border-transparent hover:bg-secondary/30 ${
                          selectedHorseId === h.id ? 'bg-primary/15 border-primary/50' : ''
                        }`}
                      >
                        <input
                          type="radio"
                          name="horse"
                          checked={selectedHorseId === h.id}
                          onChange={() => setSelectedHorseId(h.id)}
                          className="w-4 h-4 text-primary"
                        />
                        <span className="text-foreground font-medium flex-1">{h.name}</span>
                        <span className="text-mutedForeground text-sm font-mono">{OddsLabel(h.odds)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-mutedForeground text-sm">Bet amount</span>
                      <span className="text-mutedForeground">$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        value={bet}
                        onChange={(e) => setBet(e.target.value)}
                        className="w-32 bg-input border border-border rounded-sm h-10 px-3 text-sm text-foreground"
                      />
                    </div>
                  </div>
                  <p className="text-sm text-green-500 font-mono">Returns: {formatMoney(returnsAmount)}</p>
                </div>
                {raceProgress ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Race in progress...</p>
                    <div className="space-y-1.5">
                      {raceLanes.map((lane) => (
                        <div key={lane.horse.id} className="flex items-center gap-2">
                          <span className="text-xs text-mutedForeground w-24 truncate">{lane.horse.name}</span>
                          <div className="flex-1 h-6 bg-secondary rounded-sm overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-sm transition-all ease-out flex items-center justify-end pr-1 animate-horse-race-bar"
                              style={{
                                width: raceStarted ? `${lane.finishPct}%` : '0%',
                                transitionDuration: `${RACE_DURATION_MS}ms`,
                              }}
                            >
                              <span className="text-[10px] text-primaryForeground font-bold">🐎</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={placeBet}
                    disabled={!canBet}
                    className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50"
                  >
                    Place bet
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="py-2">
                  <p className={`text-lg font-semibold ${result.won ? 'text-green-500' : 'text-red-500'}`}>
                    {result.won ? `You won ${formatMoney(result.payout - betNum)}!` : `You lost ${formatMoney(betNum)}.`}
                  </p>
                  <p className="text-sm text-mutedForeground mt-1">Winner: {result.winner_name}</p>
                  {result.new_balance != null && (
                    <p className="text-xs text-mutedForeground mt-1">Balance: {formatMoney(result.new_balance)}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={playAgain}
                  className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth"
                >
                  Place another bet
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${styles.panel} rounded-md overflow-hidden`}>
            <div className="px-4 py-3 bg-secondary/40 border-b border-border">
              <h3 className="text-lg font-heading font-semibold text-foreground">Information</h3>
              <p className="text-sm text-mutedForeground">Rules and payouts</p>
            </div>
            <div className="p-4 space-y-3 text-sm text-mutedForeground">
              <p><span className="text-foreground font-medium">Max bet:</span> {formatMoney(config.max_bet)}</p>
              <p>Pick a horse and place a bet. If your horse wins, you get your stake back plus winnings at the shown odds (minus house edge).</p>
              <p>Lower odds = favourite = more likely to win. Higher odds = bigger payout.</p>
            </div>
          </div>
          <div className={`${styles.panel} rounded-md overflow-hidden`}>
            <div className="px-3 py-2 bg-secondary/40 border-b border-border">
              <h3 className="text-base font-heading font-semibold text-foreground">Last 10 results</h3>
              <p className="text-xs text-mutedForeground">Your most recent bets and outcomes.</p>
            </div>
            <div className="p-3 max-h-[280px] overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-xs text-mutedForeground">No results yet. Place a bet to start.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {history.map((item, i) => {
                    const profit = (item.payout || 0) - (item.bet || 0);
                    const profitStr = profit >= 0 ? `+${formatMoney(profit)}` : formatMoney(profit);
                    return (
                      <li key={i} className="py-1.5 border-b border-border last:border-0 space-y-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-mutedForeground">{formatHistoryDate(item.created_at)}</span>
                          <span className={`font-mono ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{profitStr}</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-mutedForeground">Bet {formatMoney(item.bet)} on {item.horse_name || 'Horse'}</span>
                          <span className={item.won ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{item.won ? 'Win' : 'Lose'}</span>
                        </div>
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
