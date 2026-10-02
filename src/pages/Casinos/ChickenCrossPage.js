import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  CircleDollarSign,
  Flame,
  MapPin,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Trophy,
  TrendingUp,
  Footprints,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiRequestWith429Retry, getApiErrorMessage, refreshUser } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import { publicAsset } from '../../utils/publicAssets';
import styles from '../../styles/noir.module.css';

const ASSET = {
  idle: publicAsset('/images/chicken-cross/chicken-idle.png'),
  hop: publicAsset('/images/chicken-cross/chicken-hop.png'),
  hit: publicAsset('/images/chicken-cross/chicken-hit.png'),
  lane: publicAsset('/images/chicken-cross/lane.png'),
  sidewalk: publicAsset('/images/chicken-cross/sidewalk.png'),
  coin: publicAsset('/images/chicken-cross/coin.png'),
  cars: [
    publicAsset('/images/chicken-cross/car-sedan.png'),
    publicAsset('/images/chicken-cross/car-taxi.png'),
    publicAsset('/images/chicken-cross/car-truck.png'),
    publicAsset('/images/chicken-cross/car-sport.png'),
  ],
};

const HOP_MS = 220;
const VISIBLE_AHEAD = 5;
const QUICK_BETS = [1_000_000, 100_000_000, 1_000_000_000];

const PAGE_STYLES = `
  .cc-fade-in { animation: cc-fade-in 0.45s ease-out both; }
  @keyframes cc-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes cc-shine { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
  .cc-title {
    background: linear-gradient(105deg, var(--noir-primary-dark) 0%, var(--noir-primary-bright) 35%, #fff8d6 48%, var(--noir-primary-bright) 58%, var(--noir-primary-dark) 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: cc-shine 8s ease-in-out infinite alternate;
  }
  .cc-touch { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .cc-board {
    --cc-lane-w: 4.6rem;
    position: relative;
    overflow: hidden;
    border-radius: 0.9rem;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(90,120,180,0.18), transparent 42%),
      linear-gradient(180deg, #1a2233 0%, #0d121c 100%);
    min-height: 17rem;
  }
  @media (min-width: 640px) { .cc-board { --cc-lane-w: 5.4rem; min-height: 19rem; } }
  .cc-strip {
    display: flex;
    align-items: stretch;
    height: 15.5rem;
    transition: transform 220ms cubic-bezier(.2,.8,.2,1);
    will-change: transform;
  }
  .cc-cell {
    position: relative;
    flex: 0 0 var(--cc-lane-w);
    width: var(--cc-lane-w);
    background-size: cover;
    background-position: center;
    overflow: hidden;
  }
  .cc-mult {
    position: absolute;
    top: 0.55rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    width: 2.55rem;
    height: 2.55rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: url(${ASSET.coin}) center / contain no-repeat;
    font-family: var(--font-heading, serif);
    font-size: 0.58rem;
    font-weight: 900;
    color: #3a2508;
    text-shadow: 0 1px 0 rgba(255,236,160,0.45);
  }
  .cc-car {
    position: absolute;
    left: 50%;
    width: 58%;
    max-width: 3.2rem;
    height: auto;
    transform: translate3d(-50%, var(--cc-y, -40%), 0);
    animation: cc-traffic var(--cc-dur, 2.8s) linear infinite;
    animation-delay: var(--cc-delay, 0s);
    will-change: transform;
    z-index: 2;
    pointer-events: none;
  }
  .cc-car.cc-rev { animation-name: cc-traffic-rev; }
  @keyframes cc-traffic {
    0% { transform: translate3d(-50%, -55%, 0); }
    100% { transform: translate3d(-50%, 155%, 0); }
  }
  @keyframes cc-traffic-rev {
    0% { transform: translate3d(-50%, 155%, 0); }
    100% { transform: translate3d(-50%, -55%, 0); }
  }
  .cc-chicken {
    position: absolute;
    left: calc(var(--cc-lane-w) * 0.5);
    bottom: 1.15rem;
    width: 3.35rem;
    height: 3.35rem;
    margin-left: -1.675rem;
    z-index: 6;
    transition: transform 220ms cubic-bezier(.2,.8,.2,1);
    will-change: transform;
    pointer-events: none;
  }
  .cc-chicken img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .cc-chicken.cc-hopping { transform: translateY(-0.55rem) scale(1.04); }
  .cc-hit-flash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(circle at 35% 70%, rgba(220,50,50,0.28), transparent 45%);
    opacity: 0;
    transition: opacity 180ms ease;
  }
  .cc-hit-flash.on { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .cc-strip, .cc-chicken { transition: none !important; }
    .cc-car { animation: none !important; transform: translate3d(-50%, 35%, 0) !important; }
    .cc-fade-in { animation: none !important; opacity: 1 !important; transform: none !important; }
  }
`;

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

function streakLabel(type, count) {
  const n = Number(count || 0);
  if (!type || n <= 0) return 'No rounds';
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

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.getAttribute('data-mobile-compositor-safe') === 'on';
}

function applyRoundToStats(prev, round) {
  if (!round || round.void) return prev;
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

function trafficSeed(laneIndex) {
  const a = (laneIndex * 17 + 11) % 4;
  const b = (laneIndex * 29 + 3) % 4;
  return {
    cars: [ASSET.cars[a], ASSET.cars[b]],
    durs: [`${2.4 + (laneIndex % 5) * 0.22}s`, `${2.8 + (laneIndex % 4) * 0.25}s`],
    delays: [`-${(laneIndex % 7) * 0.31}s`, `-${(laneIndex % 5) * 0.47 + 0.9}s`],
    rev: laneIndex % 2 === 1,
  };
}

let _introPlayed = false;
let _cachedConfig = null;
let _cachedStats = null;
let _staffOkCache = null;

export default function ChickenCrossPage() {
  const animateIn = useRef(!_introPlayed).current;
  useEffect(() => { _introPlayed = true; }, []);

  const [staffOk, setStaffOk] = useState(_staffOkCache);
  const [config, setConfig] = useState(_cachedConfig || {
    current_state: '',
    max_bet: 5_000_000_000,
    payout_cap: 250_000_000_000,
    difficulties: [],
    admin_only: true,
  });
  const [difficulty, setDifficulty] = useState('easy');
  const [bet, setBet] = useState('100000');
  const [game, setGame] = useState(null);
  const [stats, setStats] = useState(_cachedStats);
  const [loading, setLoading] = useState(false);
  const [pose, setPose] = useState('idle');
  const [lastRound, setLastRound] = useState(null);
  const [hitFlash, setHitFlash] = useState(false);
  const lastBetRef = useRef('100000');
  const busyRef = useRef(false);

  const maxBet = Number(config.max_bet || 5_000_000_000);
  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const active = !!game;
  const lane = Number(game?.lane || 0);
  const offered = game?.offered_lanes || [];
  const lastOffered = offered.length ? Number(offered[offered.length - 1].lane) : 0;
  const canStart = !active && betNum >= 1 && betNum <= maxBet && !loading;
  const canStep = active && !!game?.can_step && !loading;
  const canCashout = active && !!game?.can_cashout && !loading;
  const canVoid = active && !!game?.can_void && !loading;

  const potentialCashout = useMemo(() => {
    if (active) return Number(game?.cashout || 0);
    const diff = (config.difficulties || []).find((d) => d.id === difficulty);
    const first = (diff?.lanes || [])[0];
    if (!first || betNum < 1) return 0;
    const cents = Number(first.multiplier_cents || 0);
    return Math.min(Number(config.payout_cap || 250_000_000_000), Math.floor((betNum * cents) / 100));
  }, [active, game, config, difficulty, betNum]);

  const boardLanes = useMemo(() => {
    const rows = [];
    const catalog = offered.length
      ? offered
      : ((config.difficulties || []).find((d) => d.id === difficulty)?.lanes || []);
    const multByLane = new Map(catalog.map((r) => [Number(r.lane), r]));
    const maxLane = catalog.length
      ? Number(catalog[catalog.length - 1].lane)
      : (lastOffered || VISIBLE_AHEAD);
    if (!active || lane === 0) {
      rows.push({ kind: 'sidewalk', key: 'sidewalk', lane: 0 });
    }
    const from = active && lane > 0 ? lane : 1;
    const to = Math.min(maxLane, from + VISIBLE_AHEAD - (rows.length ? 1 : 0));
    for (let i = from; i <= to; i += 1) {
      const info = multByLane.get(i);
      rows.push({
        kind: 'lane',
        key: `lane-${i}`,
        lane: i,
        mult: info?.multiplier || '',
        traffic: trafficSeed(i),
      });
    }
    return rows;
  }, [active, lane, lastOffered, offered, config.difficulties, difficulty]);

  const fetchConfig = useCallback(() => {
    apiRequestWith429Retry(() => api.get('/casino/chicken-cross/config'))
      .then((r) => {
        setConfig((prev) => {
          const next = { ...prev, ...(r.data || {}) };
          _cachedConfig = next;
          return next;
        });
      })
      .catch((e) => {
        if (e?.response?.status === 403) {
          _staffOkCache = false;
          setStaffOk(false);
          return;
        }
        toast.error(getApiErrorMessage(e) || 'Could not load Chicken Cross');
      });
  }, []);

  const fetchStats = useCallback(() => {
    apiRequestWith429Retry(() => api.get('/casino/chicken-cross/stats'))
      .then((r) => {
        _cachedStats = r.data || null;
        setStats(r.data || null);
      })
      .catch(() => setStats((prev) => prev ?? null));
  }, []);

  const fetchGame = useCallback(() => {
    apiRequestWith429Retry(() => api.get('/casino/chicken-cross/game'))
      .then((r) => {
        if (r.data?.active && r.data?.game) setGame(r.data.game);
        else setGame(null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (_staffOkCache === true) {
      setStaffOk(true);
      return undefined;
    }
    api.get('/auth/staff-flags')
      .then((r) => {
        if (cancelled) return;
        const ok = !!r.data?.is_admin;
        _staffOkCache = ok;
        setStaffOk(ok);
      })
      .catch(() => {
        if (!cancelled) {
          _staffOkCache = false;
          setStaffOk(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (staffOk !== true) return undefined;
    fetchConfig();
    fetchStats();
    fetchGame();
    ASSET.cars.concat([ASSET.idle, ASSET.hop, ASSET.hit, ASSET.lane, ASSET.sidewalk, ASSET.coin]).forEach((src) => {
      const img = new Image();
      img.src = src;
    });
    return undefined;
  }, [staffOk, fetchConfig, fetchStats, fetchGame]);

  useEffect(() => {
    if (!active || loading) return undefined;
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (canStep) step();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, loading, canStep]);

  const setQuickBet = (amount) => setBet(String(Math.min(amount, maxBet)));
  const repeatLast = () => setBet(lastBetRef.current || '100000');

  const afterSettle = (settled) => {
    setGame(null);
    setPose(settled?.result === 'hit' ? 'hit' : 'idle');
    if (settled) {
      setLastRound(settled);
      setStats((prev) => applyRoundToStats(prev, settled));
    }
    runAfterUiSettles(() => {
      refreshUser();
      fetchStats();
    });
  };

  const waitHop = () => new Promise((resolve) => {
    if (prefersReducedMotion()) {
      resolve();
      return;
    }
    setTimeout(resolve, HOP_MS);
  });

  const start = async () => {
    if (busyRef.current || loading || active) return;
    if (betNum < 1) {
      toast.error('Enter a bet');
      return;
    }
    if (betNum > maxBet) {
      toast.error(`Max bet is ${formatMoney(maxBet)}`);
      return;
    }
    busyRef.current = true;
    setLoading(true);
    setHitFlash(false);
    setPose('idle');
    try {
      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/start', { bet: betNum, difficulty }));
      lastBetRef.current = String(betNum);
      setGame(res.data?.game || null);
      setLastRound(null);
      runAfterUiSettles(() => refreshUser());
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not start');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  const step = async () => {
    if (busyRef.current || loading || !canStep) return;
    busyRef.current = true;
    setLoading(true);
    setPose('hop');
    setHitFlash(false);
    try {
      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/step'));
      await waitHop();
      if (res.data?.active && res.data?.game) {
        setGame(res.data.game);
        setPose('idle');
      } else if (res.data?.settled) {
        setHitFlash(res.data.settled.result === 'hit');
        afterSettle(res.data.settled);
        if (res.data.settled.result === 'hit') toast.message('Squashed. Stake lost.');
      }
    } catch (e) {
      setPose('idle');
      toast.error(getApiErrorMessage(e) || 'Hop failed');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  const cashout = async () => {
    if (busyRef.current || loading || !canCashout) return;
    busyRef.current = true;
    setLoading(true);
    try {
      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/cashout'));
      afterSettle(res.data?.settled);
      toast.success(`Cashed out ${formatMoney(res.data?.settled?.payout || 0)}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Cash out failed');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  const voidRound = async () => {
    if (busyRef.current || loading || !canVoid) return;
    busyRef.current = true;
    setLoading(true);
    try {
      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/void'));
      afterSettle(res.data?.settled);
      toast.message('Stake returned');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not void');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  if (staffOk === false) return <Navigate to="/casino" replace />;
  if (staffOk === null) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="chicken-cross-page">
        <p className="text-[11px] font-heading text-zinc-500">Checking admin access…</p>
      </div>
    );
  }

  const netProfit = Number(stats?.net_profit || 0);
  const streakType = stats?.streak?.current_type;
  const streakCount = Number(stats?.streak?.current_count || 0);
  const chickenSrc = pose === 'hop' ? ASSET.hop : pose === 'hit' ? ASSET.hit : ASSET.idle;

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0`} data-testid="chicken-cross-page">
      <style>{PAGE_STYLES}</style>

      <div className={`${animateIn ? 'cc-fade-in' : ''} space-y-4`}>
        <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading italic flex items-center gap-1.5 tracking-wide">
              <MapPin size={12} className="text-primary" />
              House table · <span className="text-primary font-bold not-italic">{config.current_state || '—'}</span>
              <span className="ml-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-heading font-bold uppercase tracking-wider text-amber-300 not-italic">Admin test</span>
            </p>
            <div className="flex items-center gap-2">
              <Footprints size={22} className="text-primary/75 hidden sm:block" />
              <h1 className="text-2xl sm:text-3xl font-heading font-black uppercase tracking-[0.12em] cc-title">Chicken Cross</h1>
            </div>
            <p className="text-[10px] sm:text-[11px] text-zinc-500 font-heading max-w-lg leading-relaxed">
              Hop one lane at a time. Cash out before traffic hits. Server rolls the round when you bet.
            </p>
          </div>
          <div className="rounded-lg border border-primary/20 bg-zinc-950/60 px-3 py-2 shadow-inner">
            <p className="text-[9px] font-heading text-zinc-500 uppercase tracking-widest">Limits</p>
            <p className="text-[12px] font-heading text-zinc-300">
              Max <span className="text-primary font-bold tabular-nums">{formatMoney(maxBet)}</span>
            </p>
            <p className="text-[10px] font-heading text-zinc-500">
              Cap <span className="tabular-nums">{formatMoney(config.payout_cap || 250_000_000_000)}</span>
            </p>
          </div>
        </header>

        <section className={`${styles.panel} mobile-panel relative overflow-hidden rounded-xl border border-primary/25`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <div className="relative p-3 sm:p-5 space-y-4">
            <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_1.25fr] gap-4 items-stretch">
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-950/60 p-3 sm:p-4 space-y-3">
                <div>
                  <p className="text-[9px] font-heading uppercase tracking-widest text-zinc-500 mb-1.5">Difficulty</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {(config.difficulties || []).map((d) => {
                      const on = difficulty === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          disabled={loading || active}
                          onClick={() => setDifficulty(d.id)}
                          className={`cc-touch min-h-[40px] rounded-lg border px-2 text-[10px] font-heading font-bold uppercase tracking-wide disabled:opacity-55 ${
                            on ? 'border-primary/70 bg-primary/15 text-primary' : 'border-zinc-700/70 bg-zinc-900/50 text-zinc-300 hover:border-primary/35'
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-heading uppercase tracking-widest text-zinc-500">Wager</label>
                  <FormattedNumberInput
                    value={bet}
                    onChange={setBet}
                    disabled={loading || active}
                    placeholder="100000"
                    className="w-full min-h-[44px] rounded-md border border-primary/25 bg-zinc-950/90 px-3 py-2 text-base sm:text-sm font-heading text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-45"
                  />
                  <div className="grid grid-cols-4 gap-1.5">
                    {QUICK_BETS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setQuickBet(amount)}
                        disabled={loading || active}
                        className="cc-touch min-h-[36px] rounded border border-zinc-700/70 bg-zinc-900/70 px-1 text-[9px] font-heading font-bold uppercase text-zinc-300 hover:border-primary/40 hover:text-primary disabled:opacity-45"
                      >
                        {amount >= 1_000_000_000 ? '$1B' : amount >= 100_000_000 ? '$100M' : '$1M'}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setQuickBet(maxBet)}
                      disabled={loading || active}
                      className="cc-touch min-h-[36px] rounded border border-primary/40 bg-primary/12 px-1 text-[9px] font-heading font-bold uppercase text-primary disabled:opacity-45"
                    >
                      Max
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={repeatLast}
                    disabled={loading || active}
                    className="cc-touch inline-flex items-center gap-1.5 rounded border border-zinc-700/60 bg-zinc-900/50 px-2 py-1 text-[10px] font-heading text-zinc-400 hover:text-primary hover:border-primary/35 disabled:opacity-45"
                  >
                    <Repeat2 size={13} /> Repeat last bet
                  </button>
                </div>

                <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-3 py-2">
                  <p className="text-[9px] font-heading uppercase tracking-wider text-zinc-500">{active ? 'Cash out now' : 'First lane pays'}</p>
                  <p className="text-xl font-heading font-black text-primary tabular-nums">{formatMoney(potentialCashout)}</p>
                  {active && (
                    <p className="text-[10px] font-heading text-zinc-500">
                      Lane {lane} · x{game?.multiplier || '0.00'} · stake {formatMoney(game?.bet || 0)}
                    </p>
                  )}
                </div>

                <div className="hidden md:flex flex-wrap gap-2">
                  {!active ? (
                    <button
                      type="button"
                      onClick={start}
                      disabled={!canStart}
                      className="cc-touch inline-flex min-h-[44px] min-w-[9rem] items-center justify-center gap-2 rounded-lg border border-primary/55 bg-primary/15 px-5 text-[12px] font-heading font-black uppercase tracking-wider text-primary disabled:opacity-35"
                    >
                      <Sparkles size={16} />
                      {loading ? 'Starting…' : 'Start'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={step}
                        disabled={!canStep}
                        className="cc-touch inline-flex min-h-[44px] min-w-[8rem] items-center justify-center gap-2 rounded-lg border border-primary/55 bg-primary/15 px-4 text-[12px] font-heading font-black uppercase tracking-wider text-primary disabled:opacity-35"
                      >
                        <Footprints size={16} />
                        {loading ? '…' : 'Hop'}
                      </button>
                      <button
                        type="button"
                        onClick={cashout}
                        disabled={!canCashout}
                        className="cc-touch inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-emerald-500/45 bg-emerald-500/12 px-4 text-[12px] font-heading font-black uppercase tracking-wider text-emerald-300 disabled:opacity-35"
                      >
                        Cash out
                      </button>
                      {canVoid && (
                        <button
                          type="button"
                          onClick={voidRound}
                          disabled={!canVoid}
                          className="cc-touch inline-flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-600 bg-zinc-900/70 px-3 text-[11px] font-heading font-bold uppercase text-zinc-300 disabled:opacity-35"
                        >
                          Void
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="cc-board border border-primary/20">
                <div className={`cc-hit-flash ${hitFlash ? 'on' : ''}`} />
                <div className="cc-strip">
                  {boardLanes.map((cell) => (
                    <div
                      key={cell.key}
                      className="cc-cell"
                      style={{
                        backgroundImage: `url(${cell.kind === 'sidewalk' ? ASSET.sidewalk : ASSET.lane})`,
                      }}
                    >
                      {cell.kind === 'lane' && cell.mult ? (
                        <div className="cc-mult">x{cell.mult}</div>
                      ) : null}
                      {cell.kind === 'lane' && cell.traffic ? (
                        <>
                          <img
                            src={cell.traffic.cars[0]}
                            alt=""
                            className={`cc-car ${cell.traffic.rev ? 'cc-rev' : ''}`}
                            style={{ '--cc-dur': cell.traffic.durs[0], '--cc-delay': cell.traffic.delays[0] }}
                            draggable={false}
                          />
                          <img
                            src={cell.traffic.cars[1]}
                            alt=""
                            className={`cc-car ${cell.traffic.rev ? '' : 'cc-rev'}`}
                            style={{ '--cc-dur': cell.traffic.durs[1], '--cc-delay': cell.traffic.delays[1] }}
                            draggable={false}
                          />
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className={`cc-chicken ${pose === 'hop' ? 'cc-hopping' : ''}`} aria-hidden>
                  <img src={chickenSrc} alt="" draggable={false} />
                </div>
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
              </div>
              <div className="rounded-xl border border-zinc-700/55 bg-zinc-950/45 p-3 shadow-inner">
                <div className="flex items-center gap-1.5 text-[9px] font-heading uppercase tracking-wider text-zinc-500">
                  <Trophy size={13} className="text-amber-300/90" />
                  Record
                </div>
                <div className="mt-1 text-lg sm:text-xl font-heading font-black text-zinc-100 tabular-nums">{(stats?.rounds || 0).toLocaleString()} rounds</div>
                <div className="text-[9px] font-heading text-zinc-500">
                  {(stats?.wins || 0).toLocaleString()}W / {(stats?.losses || 0).toLocaleString()}L · {Number(stats?.win_rate || 0).toFixed(2)}%
                </div>
              </div>
            </div>

            {lastRound && (
              <div className={`relative rounded-xl border p-3 sm:p-4 ${lastRound.won ? 'border-emerald-500/35 bg-emerald-950/20' : lastRound.void ? 'border-zinc-600/50 bg-zinc-950/30' : 'border-rose-500/25 bg-rose-950/10'}`}>
                <p className="text-[9px] font-heading uppercase tracking-[0.22em] text-zinc-500">Last round</p>
                <p className="text-lg font-heading font-black text-foreground">
                  {lastRound.void ? 'Voided' : lastRound.won ? 'Cashed out' : 'Hit by traffic'}
                  {!lastRound.void ? ` · lane ${lastRound.lane}` : ''}
                </p>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-heading">
                  <span className="rounded border border-zinc-700/60 bg-zinc-950/50 px-2 py-1">Stake <b>{formatMoney(lastRound.bet)}</b></span>
                  <span className="rounded border border-zinc-700/60 bg-zinc-950/50 px-2 py-1">Mult <b className="text-primary">x{lastRound.multiplier || '0.00'}</b></span>
                  <span className="rounded border border-zinc-700/60 bg-zinc-950/50 px-2 py-1">Paid <b className="text-primary">{formatMoney(lastRound.payout)}</b></span>
                  <span className="rounded border border-zinc-700/60 bg-zinc-950/50 px-2 py-1">
                    Net <b className={lastRound.net >= 0 ? 'text-emerald-400' : 'text-rose-300'}>{formatSignedMoney(lastRound.net)}</b>
                  </span>
                </div>
              </div>
            )}

            <div className="relative flex items-start gap-2 rounded-lg border border-zinc-700/50 bg-zinc-950/50 px-3 py-2 text-[10px] font-heading text-zinc-500">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-primary/70" />
              <span>
                Admin test only. Outcome is fixed when you start. Cash out after a safe hop. Max bet {formatMoney(maxBet)}, payout cap {formatMoney(config.payout_cap || 250_000_000_000)}.
              </span>
            </div>
          </div>
        </section>
      </div>

      <div
        className="cc-touch fixed left-0 right-0 z-[48] md:hidden max-md:bottom-[7rem] bottom-0 border-t border-primary/30 bg-zinc-950/95 backdrop-blur-md px-2 pt-2 shadow-[0_-12px_40px_rgba(0,0,0,0.55)]"
        style={{ paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom, 12px))' }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-heading uppercase tracking-wider text-zinc-500">{active ? 'Live' : 'Ready'}</p>
            <p className="truncate text-[11px] font-heading text-zinc-200">
              {active ? (
                <>Lane {lane} · {formatMoney(potentialCashout)}</>
              ) : (
                <><span className="text-primary capitalize">{difficulty}</span> · {formatMoney(betNum)}</>
              )}
            </p>
          </div>
          {!active ? (
            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              className="cc-touch flex min-h-[44px] min-w-[9rem] items-center justify-center gap-1.5 rounded-lg border border-primary/55 bg-primary/15 px-4 text-xs font-heading font-black uppercase tracking-wide text-primary disabled:opacity-35"
            >
              <CircleDollarSign size={17} />
              {loading ? '…' : 'Start'}
            </button>
          ) : (
            <>
              {canVoid ? (
                <button
                  type="button"
                  onClick={voidRound}
                  disabled={!canVoid}
                  className="cc-touch flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-600 px-3 text-[10px] font-heading font-bold uppercase text-zinc-300 disabled:opacity-35"
                >
                  Void
                </button>
              ) : (
                <button
                  type="button"
                  onClick={cashout}
                  disabled={!canCashout}
                  className="cc-touch flex min-h-[44px] items-center justify-center rounded-lg border border-emerald-500/45 bg-emerald-500/12 px-3 text-[10px] font-heading font-bold uppercase text-emerald-300 disabled:opacity-35"
                >
                  Cash out
                </button>
              )}
              <button
                type="button"
                onClick={step}
                disabled={!canStep}
                className="cc-touch flex min-h-[44px] min-w-[7.5rem] items-center justify-center gap-1.5 rounded-lg border border-primary/55 bg-primary/15 px-4 text-xs font-heading font-black uppercase tracking-wide text-primary disabled:opacity-35"
              >
                <Footprints size={16} />
                {loading ? '…' : 'Hop'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
