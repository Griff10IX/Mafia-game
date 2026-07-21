import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleDollarSign, Coins, Flame, MapPin, Repeat2, ShieldCheck, Sparkles, Trophy, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiRequestWith429Retry, getApiErrorMessage, refreshUser } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const COIN_FLIP_STYLES = `
  .coinflip-fade-in { animation: coinflip-fade-in 0.45s ease-out both; }
  @keyframes coinflip-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes coinflip-shine { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
  .coinflip-title {
    background: linear-gradient(105deg, var(--noir-primary-dark) 0%, var(--noir-primary-bright) 35%, #fff8d6 48%, var(--noir-primary-bright) 58%, var(--noir-primary-dark) 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: coinflip-shine 8s ease-in-out infinite alternate;
  }
  .coinflip-coin {
    transform-style: preserve-3d;
    backface-visibility: hidden;
    will-change: transform;
    background:
      radial-gradient(circle at 33% 25%, rgba(255,244,184,0.92), transparent 9%),
      radial-gradient(circle at 50% 52%, rgba(30,18,4,0.15), transparent 38%),
      linear-gradient(145deg, #332107 0%, #9a6a14 34%, #e2b949 54%, #6b430b 78%, #211405 100%);
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.2), inset 0 -14px 20px rgba(37,22,3,0.58), 0 18px 38px rgba(0,0,0,0.44);
  }
  .coinflip-coin:before {
    content: "";
    position: absolute;
    inset: 10px;
    border-radius: 999px;
    border: 2px dashed rgba(24,18,8,0.55);
    box-shadow: inset 0 0 0 10px rgba(255,228,118,0.08), inset 0 0 24px rgba(0,0,0,0.42);
  }
  .coinflip-coin:after {
    content: "FAMIGLIA";
    position: absolute;
    bottom: 17%;
    left: 0;
    right: 0;
    font-family: var(--font-heading, serif);
    font-size: 0.62rem;
    font-weight: 900;
    letter-spacing: 0.32em;
    color: rgba(24,18,8,0.68);
    text-shadow: 0 1px 0 rgba(255,236,157,0.24);
  }
  .coinflip-coin.flipping { animation: coinflip-spin 0.78s cubic-bezier(.15,.82,.2,1) both; }
  @keyframes coinflip-spin {
    0% { transform: translateZ(0) rotateY(0deg) rotateX(0deg) scale(0.97); }
    40% { transform: translateZ(0) rotateY(560deg) rotateX(10deg) scale(1.045); }
    75% { transform: translateZ(0) rotateY(920deg) rotateX(-5deg) scale(1.015); }
    100% { transform: translateZ(0) rotateY(1260deg) rotateX(0deg) scale(1); }
  }
  .coinflip-crest {
    text-shadow: 0 1px 0 rgba(255,235,150,0.3), 0 5px 12px rgba(0,0,0,0.3);
  }
  .coinflip-choice { transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease; }
  .coinflip-choice:active { transform: scale(0.985); }
  .coinflip-choice-active { box-shadow: 0 0 0 1px rgba(230,194,41,0.35), 0 14px 34px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.12); }
  .coinflip-touch { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
`;

const QUICK_BETS = [10_000, 100_000, 1_000_000];

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatSignedMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num) || num === 0) return '$0';
  return `${num > 0 ? '+' : '-'}$${Math.abs(Math.trunc(num)).toLocaleString()}`;
}

function labelChoice(v) {
  return v === 'tails' ? 'Tails' : 'Heads';
}

function streakLabel(type, count) {
  const n = Number(count || 0);
  if (!type || n <= 0) return 'No flips';
  if (type === 'wins') return `${n} win${n === 1 ? '' : 's'}`;
  return `${n} loss${n === 1 ? '' : 'es'}`;
}

function runAfterUiSettles(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: 1200 });
    return;
  }
  setTimeout(fn, 250);
}

function applyRoundToStats(prev, round) {
  if (!round) return prev;
  const bet = Number(round.bet || 0);
  const payout = Number(round.payout || 0);
  const won = !!round.won;
  const base = prev || {
    rounds: 0,
    wins: 0,
    losses: 0,
    total_wagered: 0,
    total_paid: 0,
    net_profit: 0,
    biggest_win: 0,
    win_rate: 0,
    streak: { current_type: null, current_count: 0, longest_win_run: 0, longest_loss_run: 0, scanned: 0 },
  };
  const rounds = Number(base.rounds || 0) + 1;
  const wins = Number(base.wins || 0) + (won ? 1 : 0);
  const losses = Number(base.losses || 0) + (won ? 0 : 1);
  const currentType = won ? 'wins' : 'losses';
  const previousStreak = base.streak || {};
  const currentCount = previousStreak.current_type === currentType ? Number(previousStreak.current_count || 0) + 1 : 1;
  return {
    ...base,
    rounds,
    wins,
    losses,
    total_wagered: Number(base.total_wagered || 0) + bet,
    total_paid: Number(base.total_paid || 0) + payout,
    net_profit: Number(base.net_profit || 0) + Number(round.net || payout - bet),
    in_profit: Number(base.net_profit || 0) + Number(round.net || payout - bet) >= 0,
    biggest_win: Math.max(Number(base.biggest_win || 0), payout),
    win_rate: rounds ? Number(((wins / rounds) * 100).toFixed(2)) : 0,
    streak: {
      ...previousStreak,
      current_type: currentType,
      current_count: currentCount,
      longest_win_run: won ? Math.max(Number(previousStreak.longest_win_run || 0), currentCount) : Number(previousStreak.longest_win_run || 0),
      longest_loss_run: !won ? Math.max(Number(previousStreak.longest_loss_run || 0), currentCount) : Number(previousStreak.longest_loss_run || 0),
      scanned: Math.min(Number(previousStreak.scanned || 0) + 1, 500),
    },
  };
}

// Entrance animation only on the first visit per session — replaying it on every
// navigation makes the page look like it fully reloaded.
let _coinFlipIntroPlayed = false;
// Session caches so revisits render the last-known config/stats instantly (silent refresh follows).
let _cachedCoinFlipConfig = null;
let _cachedCoinFlipStats = null;

export default function CoinFlipPage() {
  const animateIn = useRef(!_coinFlipIntroPlayed).current;
  useEffect(() => { _coinFlipIntroPlayed = true; }, []);
  const [config, setConfig] = useState(_cachedCoinFlipConfig || {
    current_state: '',
    max_bet: 5_000_000,
    choices: ['heads', 'tails'],
    payout_multiplier: 2,
    state_owned: true,
  });
  const [choice, setChoice] = useState('heads');
  const [bet, setBet] = useState('100000');
  const [loading, setLoading] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [skipAnimation, setSkipAnimation] = useState(false);
  const [lastRound, setLastRound] = useState(null);
  const [stats, setStats] = useState(_cachedCoinFlipStats);
  const lastBetRef = useRef('100000');
  /** Blocks a second play() before React re-renders (double-click / touch+click races). */
  const playInFlightRef = useRef(false);

  const maxBet = Number(config.max_bet || 5_000_000);
  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const canPlay = betNum >= 1 && betNum <= maxBet && !loading;
  const potentialReturn = useMemo(() => betNum * Number(config.payout_multiplier || 2), [betNum, config.payout_multiplier]);

  const fetchConfig = useCallback(() => {
    apiRequestWith429Retry(() => api.get('/casino/coin-flip/config'))
      .then((r) => {
        setConfig((prev) => {
          const next = { ...prev, ...(r.data || {}) };
          _cachedCoinFlipConfig = next;
          return next;
        });
      })
      .catch(() => toast.error('Could not load Coin Flip config'));
  }, []);

  const fetchStats = useCallback(() => {
    apiRequestWith429Retry(() => api.get('/casino/coin-flip/stats'))
      .then((r) => {
        _cachedCoinFlipStats = r.data || null;
        setStats(r.data || null);
      })
      .catch(() => setStats((prev) => prev ?? null));
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchStats();
  }, [fetchConfig, fetchStats]);

  const setQuickBet = (amount) => {
    setBet(String(Math.min(amount, maxBet)));
  };

  const repeatLast = () => {
    setBet(lastBetRef.current || '100000');
  };

  const play = async () => {
    if (playInFlightRef.current || loading) return;
    if (betNum < 1) {
      toast.error('Enter a bet');
      return;
    }
    if (betNum > maxBet) {
      toast.error(`Max bet is ${formatMoney(maxBet)}`);
      return;
    }
    playInFlightRef.current = true;
    setLoading(true);
    if (!skipAnimation) setIsFlipping(true);
    try {
      const res = await apiRequestWith429Retry(() => api.post('/casino/coin-flip/play', { choice, bet: betNum }));
      const d = res.data || {};
      lastBetRef.current = String(betNum);
      const nextRound = {
        choice: d.choice || choice,
        result: d.result,
        won: !!d.won,
        bet: d.bet ?? betNum,
        payout: d.payout ?? 0,
        net: d.net ?? 0,
      };
      if (!skipAnimation) {
        await new Promise((resolve) => setTimeout(resolve, 520));
      }
      setLastRound(nextRound);
      setStats((prev) => applyRoundToStats(prev, nextRound));
      runAfterUiSettles(() => {
        refreshUser();
        fetchStats();
      });
      if (d.won) toast.success(`${labelChoice(d.result)} landed. Paid ${formatMoney(d.payout)}`);
      else toast.message(`${labelChoice(d.result)} landed. No payout.`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Flip failed');
    } finally {
      playInFlightRef.current = false;
      setIsFlipping(false);
      setLoading(false);
    }
  };

  const coinFace = isFlipping ? 'M' : lastRound?.result ? labelChoice(lastRound.result).slice(0, 1) : labelChoice(choice).slice(0, 1);
  const netProfit = Number(stats?.net_profit || 0);
  const streakType = stats?.streak?.current_type;
  const streakCount = Number(stats?.streak?.current_count || 0);

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0`} data-testid="coin-flip-page">
      <style>{COIN_FLIP_STYLES}</style>

      <div className={`${animateIn ? 'coinflip-fade-in' : ''} space-y-4`}>
        <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading italic flex items-center gap-1.5 tracking-wide">
              <MapPin size={12} className="text-primary" />
              House table · <span className="text-primary font-bold not-italic">{config.current_state || '—'}</span>
            </p>
            <div className="flex items-center gap-2">
              <Coins size={22} className="text-primary/75 hidden sm:block" />
              <h1 className="text-2xl sm:text-3xl font-heading font-black uppercase tracking-[0.12em] coinflip-title">Coin Flip</h1>
            </div>
            <p className="text-[10px] sm:text-[11px] text-zinc-500 font-heading max-w-lg leading-relaxed">
              Call heads or tails. Win and the house pays 2x gross. The flip is generated on the server.
            </p>
          </div>
          <div className="rounded-lg border border-primary/20 bg-zinc-950/60 px-3 py-2 shadow-inner">
            <p className="text-[9px] font-heading text-zinc-500 uppercase tracking-widest">Limits</p>
            <p className="text-[12px] font-heading text-zinc-300">
              Max <span className="text-primary font-bold tabular-nums">{formatMoney(maxBet)}</span>
            </p>
          </div>
        </header>

        <section className={`${styles.panel} mobile-panel relative overflow-hidden rounded-xl border border-primary/25`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <div className="relative p-3 sm:p-5 space-y-4">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.1]"
              style={{
                background:
                  'radial-gradient(circle at 20% 10%, rgba(212,175,55,0.35), transparent 24%), radial-gradient(circle at 80% 0%, rgba(120,90,20,0.24), transparent 26%), linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.42))',
              }}
            />

            <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-4 items-stretch">
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-950/60 p-3 sm:p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {['heads', 'tails'].map((side) => {
                    const active = choice === side;
                    return (
                      <button
                        key={side}
                        type="button"
                        onClick={() => setChoice(side)}
                        disabled={loading}
                        aria-pressed={active}
                        className={`coinflip-touch coinflip-choice min-h-[7rem] rounded-xl border p-3 text-left disabled:opacity-55 ${
                          active
                            ? 'coinflip-choice-active border-primary/70 bg-primary/15'
                            : 'border-zinc-700/70 bg-zinc-900/50 hover:border-primary/35 hover:bg-zinc-900/80'
                        }`}
                      >
                        <p className="text-[9px] font-heading uppercase tracking-[0.25em] text-zinc-500">Choose</p>
                        <p className={`text-xl sm:text-2xl font-heading font-black uppercase ${active ? 'text-primary' : 'text-zinc-200'}`}>
                          {labelChoice(side)}
                        </p>
                        <p className="mt-2 text-[10px] font-heading text-zinc-500">
                          {side === 'heads' ? 'The Don calls the face.' : 'The underworld calls the back.'}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-heading uppercase tracking-widest text-zinc-500">Wager</label>
                  <FormattedNumberInput
                    value={bet}
                    onChange={setBet}
                    disabled={loading}
                    placeholder="100000"
                    className="w-full min-h-[44px] rounded-md border border-primary/25 bg-zinc-950/90 px-3 py-2 text-base sm:text-sm font-heading text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-45"
                  />
                  <div className="grid grid-cols-4 gap-1.5">
                    {QUICK_BETS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setQuickBet(amount)}
                        disabled={loading}
                        className="coinflip-touch min-h-[36px] rounded border border-zinc-700/70 bg-zinc-900/70 px-1 text-[9px] font-heading font-bold uppercase text-zinc-300 hover:border-primary/40 hover:text-primary disabled:opacity-45"
                      >
                        {amount >= 1_000_000 ? '$1M' : amount >= 100_000 ? '$100K' : '$10K'}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setQuickBet(maxBet)}
                      disabled={loading}
                      className="coinflip-touch min-h-[36px] rounded border border-primary/40 bg-primary/12 px-1 text-[9px] font-heading font-bold uppercase text-primary disabled:opacity-45"
                    >
                      Max
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={repeatLast}
                    disabled={loading}
                    className="coinflip-touch inline-flex items-center gap-1.5 rounded border border-zinc-700/60 bg-zinc-900/50 px-2 py-1 text-[10px] font-heading text-zinc-400 hover:text-primary hover:border-primary/35 disabled:opacity-45"
                  >
                    <Repeat2 size={13} /> Repeat last bet
                  </button>
                  <label className="coinflip-touch ml-2 inline-flex items-center gap-1.5 rounded border border-zinc-700/60 bg-zinc-900/50 px-2 py-1 text-[10px] font-heading text-zinc-400">
                    <input
                      type="checkbox"
                      checked={skipAnimation}
                      onChange={(e) => setSkipAnimation(e.target.checked)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    Skip animation
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-primary/20 bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 p-4 sm:p-5 flex flex-col items-center justify-center text-center min-h-[21rem]">
                <div
                  className={`coinflip-coin ${isFlipping ? 'flipping' : ''} relative flex h-40 w-40 sm:h-52 sm:w-52 items-center justify-center rounded-full border-[10px] border-primary/70 bg-gradient-to-br from-yellow-200 via-primary to-amber-900`}
                >
                  <div className="absolute inset-7 rounded-full border border-amber-950/50 bg-black/10" />
                  <span className="coinflip-crest relative z-10 font-heading text-6xl sm:text-7xl font-black text-zinc-950 drop-shadow-sm">{coinFace}</span>
                  <span className="absolute top-[18%] left-0 right-0 z-10 text-[8px] sm:text-[9px] font-heading font-black tracking-[0.32em] text-zinc-950/65">
                    THE HOUSE
                  </span>
                </div>
                <div className="mt-4 space-y-1">
                  <p className="text-[9px] font-heading uppercase tracking-[0.25em] text-zinc-500">{isFlipping ? 'The coin is in the air' : 'Potential return'}</p>
                  <p className="text-2xl font-heading font-black text-primary tabular-nums">{formatMoney(potentialReturn)}</p>
                  <p className="text-[10px] font-heading text-zinc-500">Stake {formatMoney(betNum)} · Pick {labelChoice(choice)}</p>
                </div>
                <button
                  type="button"
                  onClick={play}
                  disabled={!canPlay}
                  className="coinflip-touch hidden md:inline-flex mt-4 min-h-[44px] min-w-[11rem] items-center justify-center gap-2 rounded-lg border border-primary/55 bg-primary/15 px-5 text-[12px] font-heading font-black uppercase tracking-wider text-primary shadow-[0_10px_25px_rgba(0,0,0,0.28)] hover:bg-primary/20 disabled:opacity-35 disabled:grayscale"
                >
                  <Sparkles size={17} />
                  {loading ? 'Flipping...' : 'Flip coin'}
                </button>
              </div>
            </div>

            <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-2">
              <div className={`rounded-xl border p-3 shadow-inner ${netProfit >= 0 ? 'border-emerald-500/25 bg-emerald-950/20' : 'border-rose-500/25 bg-rose-950/15'}`}>
                <div className="flex items-center gap-1.5 text-[9px] font-heading uppercase tracking-wider text-zinc-500">
                  <TrendingUp size={13} className={netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
                  Overall
                </div>
                <div className={`mt-1 text-lg sm:text-xl font-heading font-black tabular-nums ${netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {formatSignedMoney(netProfit)}
                </div>
                <div className="text-[9px] font-heading text-zinc-500">{netProfit >= 0 ? 'In profit overall' : 'Not in profit overall'}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/55 bg-zinc-950/45 p-3 shadow-inner">
                <div className="flex items-center gap-1.5 text-[9px] font-heading uppercase tracking-wider text-zinc-500">
                  <CircleDollarSign size={13} className="text-primary/80" />
                  Won / paid
                </div>
                <div className="mt-1 text-lg sm:text-xl font-heading font-black text-primary tabular-nums">{formatMoney(stats?.total_paid || 0)}</div>
                <div className="text-[9px] font-heading text-zinc-500">Staked {formatMoney(stats?.total_wagered || 0)}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/55 bg-zinc-950/45 p-3 shadow-inner">
                <div className="flex items-center gap-1.5 text-[9px] font-heading uppercase tracking-wider text-zinc-500">
                  <Flame size={13} className={streakType === 'wins' ? 'text-emerald-300' : 'text-rose-300'} />
                  Current run
                </div>
                <div className={`mt-1 text-lg sm:text-xl font-heading font-black tabular-nums ${streakType === 'wins' ? 'text-emerald-300' : streakType === 'losses' ? 'text-rose-300' : 'text-zinc-300'}`}>
                  {streakLabel(streakType, streakCount)}
                </div>
                <div className="text-[9px] font-heading text-zinc-500">Longest scanned: {stats?.streak?.longest_win_run || 0}W / {stats?.streak?.longest_loss_run || 0}L</div>
              </div>
              <div className="rounded-xl border border-zinc-700/55 bg-zinc-950/45 p-3 shadow-inner">
                <div className="flex items-center gap-1.5 text-[9px] font-heading uppercase tracking-wider text-zinc-500">
                  <Trophy size={13} className="text-amber-300/90" />
                  Record
                </div>
                <div className="mt-1 text-lg sm:text-xl font-heading font-black text-zinc-100 tabular-nums">{(stats?.rounds || 0).toLocaleString()} flips</div>
                <div className="text-[9px] font-heading text-zinc-500">
                  {(stats?.wins || 0).toLocaleString()}W / {(stats?.losses || 0).toLocaleString()}L · {Number(stats?.win_rate || 0).toFixed(2)}%
                </div>
              </div>
            </div>

            {lastRound && (
              <div className={`relative rounded-xl border p-3 sm:p-4 ${lastRound.won ? 'border-emerald-500/35 bg-emerald-950/20' : 'border-rose-500/25 bg-rose-950/10'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-heading uppercase tracking-[0.22em] text-zinc-500">Last flip</p>
                    <p className="text-lg font-heading font-black text-foreground">
                      {labelChoice(lastRound.result)} landed · {lastRound.won ? 'You won' : 'House won'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-heading">
                    <span className="rounded border border-zinc-700/60 bg-zinc-950/50 px-2 py-1">Pick <b className="text-primary">{labelChoice(lastRound.choice)}</b></span>
                    <span className="rounded border border-zinc-700/60 bg-zinc-950/50 px-2 py-1">Stake <b>{formatMoney(lastRound.bet)}</b></span>
                    <span className="rounded border border-zinc-700/60 bg-zinc-950/50 px-2 py-1">Paid <b className="text-primary">{formatMoney(lastRound.payout)}</b></span>
                    <span className="rounded border border-zinc-700/60 bg-zinc-950/50 px-2 py-1">
                      Net <b className={lastRound.net >= 0 ? 'text-emerald-400' : 'text-rose-300'}>{formatSignedMoney(lastRound.net)}</b>
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="relative flex items-start gap-2 rounded-lg border border-zinc-700/50 bg-zinc-950/50 px-3 py-2 text-[10px] font-heading text-zinc-500">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-primary/70" />
              <span>Server-generated flip. Heads and tails pay 2x gross when called correctly. Max bet is {formatMoney(maxBet)}.</span>
            </div>
          </div>
        </section>
      </div>

      <div
        className="coinflip-touch fixed left-0 right-0 z-[48] md:hidden max-md:bottom-[7rem] bottom-0 border-t border-primary/30 bg-zinc-950/95 backdrop-blur-md px-2 pt-2 shadow-[0_-12px_40px_rgba(0,0,0,0.55)]"
        style={{ paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom, 12px))' }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-heading uppercase tracking-wider text-zinc-500">Ready</p>
            <p className="truncate text-[11px] font-heading text-zinc-200">
              <span className="text-primary">{labelChoice(choice)}</span> · {formatMoney(betNum)}
            </p>
          </div>
          <button
            type="button"
            onClick={play}
            disabled={!canPlay}
            className="coinflip-touch flex min-h-[44px] min-w-[9rem] items-center justify-center gap-1.5 rounded-lg border border-primary/55 bg-primary/15 px-4 text-xs font-heading font-black uppercase tracking-wide text-primary disabled:opacity-35 disabled:grayscale"
          >
            <CircleDollarSign size={17} />
            {loading ? '...' : 'Flip'}
          </button>
        </div>
      </div>
    </div>
  );
}
