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
  coin: publicAsset('/images/chicken-cross/coin.png'),
  barrier: publicAsset('/images/chicken-cross/barrier.png'),
  bush: publicAsset('/images/chicken-cross/bush.png'),
  lane: publicAsset('/images/chicken-cross/lane-v2.jpg'),
  sidewalk: publicAsset('/images/chicken-cross/sidewalk-v2.jpg'),
  cars: [
    publicAsset('/images/chicken-cross/car-sedan-v2.png'),
    publicAsset('/images/chicken-cross/car-taxi-v2.png'),
    publicAsset('/images/chicken-cross/car-truck-v2.png'),
    publicAsset('/images/chicken-cross/car-sport-v2.png'),
    publicAsset('/images/chicken-cross/car-mafia-v2.png'),
  ],
};

const rrFrames = (name) => [1, 2, 3, 4].map((i) => publicAsset(`/images/chicken-cross/roadrunner/${name}_0${i}.png`));
const CHICKEN_FRAMES = {
  idle: rrFrames('idle'),
  hop: rrFrames('run'),
  hit: rrFrames('hit'),
  ko: rrFrames('ko'),
};

const HOP_MS = 300;
const HIT_MS = 560;
const KILL_LEAD_MS = 130;
const KILL_DRIVE_MS = 420;
const SPRITE_FRAME_MS = { idle: 260, hop: HOP_MS / 4, hit: HIT_MS / 4, ko: 240 };
const VISIBLE_AHEAD = 6;
const CLEARED_KEEP = 2;
const BOARD_COLS = 8;
const BOARD_COLS_NARROW = 6;
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
  .cc-stage { display: grid; gap: 1rem; align-items: stretch; }
  .cc-controls { order: 2; }
  .cc-board-wrap { order: 1; min-width: 0; }
  @media (min-width: 1024px) {
    .cc-stage { grid-template-columns: minmax(17rem, 19.5rem) minmax(0, 1fr); }
    .cc-controls { order: 1; }
    .cc-board-wrap { order: 2; }
  }
  .cc-board {
    position: relative; width: 100%; min-height: 20rem; height: clamp(20rem, 52vw, 28rem);
    overflow: hidden; border-radius: 1rem; isolation: isolate;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(80,100,160,0.22), transparent 50%),
      linear-gradient(180deg, #1a2450 0%, #141c3c 40%, #0e1430 100%);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), 0 18px 40px rgba(0,0,0,0.35);
  }
  @media (min-width: 1024px) { .cc-board { min-height: 28rem; height: 28rem; } }
  .cc-board { --cc-cols: ${BOARD_COLS}; }
  @media (max-width: 639px) { .cc-board { --cc-cols: ${BOARD_COLS_NARROW}; } }
  .cc-strip {
    position: absolute; inset: 0; display: grid; grid-auto-flow: column;
    grid-auto-columns: calc(100% / var(--cc-cols)); width: 100%; height: 100%;
    transform: translate3d(calc(var(--cc-cam, 0) * -100% / var(--cc-cols)), 0, 0);
    transition: transform ${HOP_MS + 120}ms cubic-bezier(.3,.8,.3,1);
    will-change: transform;
  }
  .cc-cell { position: relative; height: 100%; min-width: 0; overflow: hidden; container-type: size; background: #1a2450; }
  .cc-cell.cc-road {
    background-color: #1e2748; background-repeat: repeat-y; background-size: 100% auto;
    box-shadow: inset 0 0 18px rgba(0,0,0,0.25);
  }
  .cc-cell.cc-sidewalk {
    background-color: #4a5466; background-repeat: repeat-y; background-size: 100% auto;
    box-shadow: inset -6px 0 10px rgba(0,0,0,0.35);
  }
  .cc-bush {
    position: absolute; width: 72%; max-width: 4.5rem; left: 50%; transform: translateX(-50%);
    z-index: 2; pointer-events: none; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.35));
  }
  .cc-bush-a { top: 12%; } .cc-bush-b { bottom: 14%; }
  .cc-barrier {
    position: absolute; top: 10%; left: 50%; width: min(86%, 5.5rem); transform: translateX(-50%);
    z-index: 4; pointer-events: none; filter: drop-shadow(0 6px 8px rgba(0,0,0,0.4));
    animation: cc-pop-in 220ms cubic-bezier(.2,.85,.25,1) both;
  }
  .cc-coin {
    position: absolute; bottom: 12%; left: 50%; width: min(58%, 3.6rem); transform: translateX(-50%);
    z-index: 4; pointer-events: none; filter: drop-shadow(0 6px 10px rgba(0,0,0,0.45));
    animation: cc-pop-in 260ms cubic-bezier(.2,.85,.25,1) both;
  }
  @keyframes cc-pop-in {
    0% { opacity: 0; transform: translateX(-50%) scale(0.6); }
    100% { opacity: 1; transform: translateX(-50%) scale(1); }
  }
  .cc-mult {
    position: absolute; bottom: 11%; left: 50%; transform: translateX(-50%); z-index: 4;
    width: min(74%, 4.2rem); aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    border-radius: 999px; border: 2px solid rgba(250, 204, 21, 0.7); background: rgba(10, 14, 32, 0.78);
    font-family: var(--font-heading, serif); font-size: clamp(0.55rem, 1.7cqw, 0.85rem); font-weight: 900; color: #fde68a;
    box-shadow: inset 0 0 0 3px rgba(10, 14, 32, 0.9), inset 0 0 0 4px rgba(250, 204, 21, 0.25), 0 6px 14px rgba(0,0,0,0.4);
  }
  .cc-chicken {
    position: absolute; top: 0; bottom: 0; left: calc(var(--cc-lane, 0) * 100% / var(--cc-cols));
    width: calc(100% / var(--cc-cols)); z-index: 8; pointer-events: none; container-type: size;
    transition: left ${HOP_MS}ms cubic-bezier(.35,.1,.35,1);
  }
  .cc-chicken-body {
    position: absolute; left: 50%; top: 50%; width: min(150%, 8rem); aspect-ratio: 1;
    transform: translate3d(-50%, -50%, 0); filter: drop-shadow(0 10px 10px rgba(0,0,0,0.55));
  }
  .cc-chicken-body img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .cc-chicken-body.cc-arc { animation: cc-arc ${HOP_MS}ms cubic-bezier(.3,.7,.4,1) both; }
  @keyframes cc-arc {
    0% { transform: translate3d(-50%, -50%, 0); }
    45% { transform: translate3d(-50%, -78%, 0) scale(1.06); }
    100% { transform: translate3d(-50%, -50%, 0); }
  }
  .cc-car {
    position: absolute; left: 50%; top: 0; width: min(64%, 3.6rem); pointer-events: none; z-index: 5;
    transform: translate3d(-50%, -110%, 0); filter: drop-shadow(0 8px 8px rgba(0,0,0,0.5));
  }
  .cc-car img { width: 100%; display: block; }
  .cc-car.cc-drive { animation: cc-drive var(--cc-dur, 2.4s) linear var(--cc-delay, 0s) infinite; }
  @keyframes cc-drive {
    0% { transform: translate3d(-50%, -110%, 0); }
    100% { transform: translate3d(-50%, 105cqh, 0); }
  }
  .cc-car.cc-parked { transform: translate3d(-50%, -38%, 0); z-index: 3; animation: none; }
  .cc-kill-car { z-index: 9; animation: cc-kill-drive ${KILL_DRIVE_MS}ms linear forwards; }
  .cc-kill-car::before {
    content: ''; position: absolute; left: 12%; right: 12%; bottom: 100%; height: 90%;
    background: repeating-linear-gradient(90deg, rgba(255,255,255,0.45) 0 2px, transparent 2px 9px);
    -webkit-mask-image: linear-gradient(0deg, #000, transparent); mask-image: linear-gradient(0deg, #000, transparent);
  }
  @keyframes cc-kill-drive {
    0% { transform: translate3d(-50%, -110%, 0); }
    100% { transform: translate3d(-50%, 120cqh, 0); }
  }
  .cc-impact {
    position: absolute; left: 50%; top: 50%; width: 9rem; height: 9rem; margin: -4.5rem 0 0 -4.5rem;
    pointer-events: none; z-index: 10;
  }
  .cc-impact::before {
    content: ''; position: absolute; inset: 25%; border-radius: 999px; border: 4px solid rgba(255, 244, 200, 0.95);
    animation: cc-impact-ring 420ms ease-out forwards;
  }
  .cc-impact span {
    position: absolute; left: 50%; top: 50%; color: #fde047; font-size: 1.1rem; line-height: 1;
    text-shadow: 0 0 2px #000, 0 0 6px rgba(253, 224, 71, 0.8);
    animation: cc-impact-star 520ms ease-out forwards;
  }
  @keyframes cc-impact-ring { 0% { transform: scale(0.3); opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
  @keyframes cc-impact-star {
    0% { transform: translate(-50%, -50%) scale(0.4); opacity: 1; }
    100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1) rotate(160deg); opacity: 0; }
  }
  .cc-board.cc-shake { animation: cc-shake 180ms linear 2; }
  @keyframes cc-shake {
    0%, 100% { transform: translate3d(0,0,0); }
    25% { transform: translate3d(-5px, 3px, 0); }
    50% { transform: translate3d(4px, -3px, 0); }
    75% { transform: translate3d(-3px, -2px, 0); }
  }
  .cc-board-label {
    position: absolute; left: 0.75rem; bottom: 0.55rem; z-index: 6;
    font-family: var(--font-heading, serif); font-size: 0.62rem; letter-spacing: 0.18em;
    text-transform: uppercase; color: rgba(226,232,240,0.48); pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .cc-chicken-body.cc-arc, .cc-car.cc-drive, .cc-kill-car, .cc-barrier, .cc-coin, .cc-board.cc-shake, .cc-impact span, .cc-impact::before { animation: none !important; }
    .cc-strip, .cc-chicken { transition: none !important; }
    .cc-car.cc-drive { display: none; }
    .cc-kill-car { transform: translate3d(-50%, 30cqh, 0) !important; }
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
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useChickenSprite(pose) {
  const [anim, setAnim] = useState({ name: pose, i: 0 });
  useEffect(() => { setAnim({ name: pose, i: 0 }); }, [pose]);
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const id = setInterval(() => {
      setAnim((a) => {
        const frames = CHICKEN_FRAMES[a.name] || CHICKEN_FRAMES.idle;
        if (a.name === 'hit' && a.i >= frames.length - 1) return { name: 'ko', i: 0 };
        if (a.name === 'ko' && a.i >= frames.length - 1) return a;
        return { name: a.name, i: (a.i + 1) % frames.length };
      });
    }, SPRITE_FRAME_MS[anim.name] || SPRITE_FRAME_MS.idle);
    return () => clearInterval(id);
  }, [anim.name]);
  if (prefersReducedMotion()) return pose === 'hit' ? CHICKEN_FRAMES.ko[CHICKEN_FRAMES.ko.length - 1] : (CHICKEN_FRAMES[pose] || CHICKEN_FRAMES.idle)[0];
  return (CHICKEN_FRAMES[anim.name] || CHICKEN_FRAMES.idle)[anim.i] || CHICKEN_FRAMES.idle[0];
}

function useBoardCols() {
  const query = '(max-width: 639px)';
  const read = () => (typeof window !== 'undefined' && window.matchMedia && window.matchMedia(query).matches
    ? BOARD_COLS_NARROW
    : BOARD_COLS);
  const [cols, setCols] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setCols(mq.matches ? BOARD_COLS_NARROW : BOARD_COLS);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return cols;
}

function laneSeed(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
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

let _introPlayed = false;
let _cachedConfig = null;
let _cachedStats = null;
let _staffOkCache = true;

export default function ChickenCrossPage() {
  const animateIn = useRef(!_introPlayed).current;
  useEffect(() => { _introPlayed = true; }, []);

  const [staffOk, setStaffOk] = useState(_staffOkCache);
  const [config, setConfig] = useState(_cachedConfig || {
    current_state: '',
    max_bet: 2_000_000_000,
    payout_cap: 250_000_000_000,
    difficulties: [],
    admin_only: false,
  });
  const [difficulty, setDifficulty] = useState('easy');
  const [bet, setBet] = useState('100000');
  const [game, setGame] = useState(null);
  const [stats, setStats] = useState(_cachedStats);
  const [loading, setLoading] = useState(false);
  const [pose, setPose] = useState('idle');
  const [chickenLane, setChickenLane] = useState(0);
  const [hopKey, setHopKey] = useState(0);
  const [lastRound, setLastRound] = useState(null);
  const [hitFlash, setHitFlash] = useState(false);
  const [killCar, setKillCar] = useState(false);
  const [killCarSrc, setKillCarSrc] = useState(ASSET.cars[0]);
  const lastBetRef = useRef('100000');
  const busyRef = useRef(false);

  const maxBet = Number(config.max_bet || 2_000_000_000);
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

  const boardCols = useBoardCols();
  const chickenSrc = useChickenSprite(pose);

  useEffect(() => {
    if (active) setChickenLane(lane);
  }, [active, lane]);

  const boardLanes = useMemo(() => {
    const rows = [];
    const catalog = offered.length
      ? offered
      : ((config.difficulties || []).find((d) => d.id === difficulty)?.lanes || []);
    const multByLane = new Map(catalog.map((r) => [Number(r.lane), r]));
    const roadEnd = catalog.length ? Number(catalog[catalog.length - 1].lane) : (lastOffered || VISIBLE_AHEAD);
    const maxLane = Math.max(Math.min(roadEnd, chickenLane + boardCols + 1), chickenLane);

    rows.push({ kind: 'sidewalk', key: 'lane-0', lane: 0 });
    for (let i = 1; i <= maxLane; i += 1) {
      const info = multByLane.get(i);
      const kind = i < chickenLane ? 'cleared' : i === chickenLane ? 'current' : 'ahead';
      rows.push({ kind, key: `lane-${i}`, lane: i, mult: info?.multiplier || '' });
    }
    return rows;
  }, [chickenLane, lastOffered, offered, config.difficulties, difficulty, boardCols]);

  const boardMaxLane = boardLanes.length - 1;
  const cameraLane = Math.max(0, Math.min(chickenLane - CLEARED_KEEP, boardMaxLane + 1 - boardCols));
  const trafficTo = cameraLane + boardCols;

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
    ASSET.cars.concat(
      [ASSET.coin, ASSET.barrier, ASSET.bush, ASSET.lane, ASSET.sidewalk],
      ...Object.values(CHICKEN_FRAMES),
    ).forEach((src) => {
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
    setKillCar(false);
    setPose('idle');
    setChickenLane(0);
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

  const waitHit = () => new Promise((resolve) => {
    if (prefersReducedMotion()) {
      resolve();
      return;
    }
    setTimeout(resolve, HIT_MS);
  });

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : ms));

  const step = async () => {
    if (busyRef.current || loading || !canStep) return;
    busyRef.current = true;
    setLoading(true);
    setHitFlash(false);
    setKillCar(false);
    setPose('hop');
    try {
      const res = await apiRequestWith429Retry(() => api.post('/casino/chicken-cross/step'));
      const isHit = res.data?.settled?.result === 'hit';
      if (isHit) {
        const deathLane = Number(res.data?.settled?.lane || lane + 1);
        setKillCarSrc(ASSET.cars[Math.floor(Math.random() * ASSET.cars.length)]);
        setGame((prev) => (prev ? {
          ...prev,
          lane: deathLane,
          can_step: false,
          can_cashout: false,
          can_void: false,
        } : prev));
        setHopKey((k) => k + 1);
        await pause(HOP_MS - KILL_LEAD_MS);
        setKillCar(true);
        await pause(KILL_LEAD_MS);
        setPose('hit');
        setHitFlash(true);
        await waitHit();
        setKillCar(false);
        afterSettle(res.data.settled);
        toast.message('Squashed. Stake lost.');
      } else if (res.data?.active && res.data?.game) {
        setGame(res.data.game);
        setHopKey((k) => k + 1);
        await waitHop();
        setPose('idle');
      } else if (res.data?.settled) {
        setChickenLane(Number(res.data.settled?.lane || lane + 1));
        setHopKey((k) => k + 1);
        await waitHop();
        afterSettle(res.data.settled);
        toast.success(`Crossed the road! Paid ${formatMoney(res.data.settled?.payout || 0)}`);
      } else {
        setPose('idle');
      }
    } catch (e) {
      setKillCar(false);
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

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0`} data-testid="chicken-cross-page">
      <style>{PAGE_STYLES}</style>

      <div className={`${animateIn ? 'cc-fade-in' : ''} space-y-4`}>
        <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading italic flex items-center gap-1.5 tracking-wide">
              <MapPin size={12} className="text-primary" />
              House table · <span className="text-primary font-bold not-italic">{config.current_state || '—'}</span>
              {config.admin_only ? (
                <span className="ml-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-heading font-bold uppercase tracking-wider text-amber-300 not-italic">Admin test</span>
              ) : null}
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
            <div className="cc-stage">
              <div className="cc-controls rounded-xl border border-zinc-700/60 bg-zinc-950/60 p-3 sm:p-4 space-y-3">
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

              <div className="cc-board-wrap">
              <div className={`cc-board border border-primary/20 ${hitFlash ? 'cc-shake' : ''}`} data-testid="chicken-cross-board">
                <div className="cc-strip" style={{ '--cc-cam': cameraLane }}>
                  {boardLanes.map((cell) => {
                    const seed = laneSeed(cell.lane);
                    const showTraffic = cell.kind === 'ahead' && cell.lane <= trafficTo;
                    const dur = 1.7 + seed * 1.6;
                    return (
                      <div
                        key={cell.key}
                        className={`cc-cell ${cell.kind === 'sidewalk' ? 'cc-sidewalk' : 'cc-road'}`}
                        style={{
                          backgroundImage: `url(${cell.kind === 'sidewalk' ? ASSET.sidewalk : ASSET.lane})`,
                          backgroundPositionY: `${Math.round(seed * 100)}%`,
                        }}
                      >
                        {cell.kind === 'sidewalk' ? (
                          <>
                            <img src={ASSET.bush} alt="" className="cc-bush cc-bush-a" draggable={false} />
                            <img src={ASSET.bush} alt="" className="cc-bush cc-bush-b" draggable={false} />
                          </>
                        ) : null}
                        {(cell.kind === 'cleared' && cell.lane >= cameraLane - 1)
                          || (cell.kind === 'current' && !killCar && pose !== 'hit') ? (
                          <>
                            <div className="cc-car cc-parked">
                              <img src={ASSET.cars[Math.floor(seed * ASSET.cars.length)]} alt="" draggable={false} />
                            </div>
                            <img src={ASSET.barrier} alt="" className="cc-barrier" draggable={false} />
                            {cell.kind === 'cleared' ? (
                              <img src={ASSET.coin} alt="" className="cc-coin" draggable={false} />
                            ) : null}
                          </>
                        ) : null}
                        {cell.kind === 'ahead' && cell.mult ? (
                          <div className="cc-mult">{cell.mult}</div>
                        ) : null}
                        {showTraffic ? [0, 1].map((n) => (
                          <div
                            key={n}
                            className="cc-car cc-drive"
                            style={{ '--cc-dur': `${dur.toFixed(2)}s`, '--cc-delay': `${(-(seed + n * 0.5) * dur).toFixed(2)}s` }}
                          >
                            <img
                              src={ASSET.cars[Math.floor(laneSeed(cell.lane * 7 + n) * ASSET.cars.length)]}
                              alt=""
                              draggable={false}
                            />
                          </div>
                        )) : null}
                      </div>
                    );
                  })}
                  <div className="cc-chicken" style={{ '--cc-lane': chickenLane }} aria-hidden>
                    <div key={hopKey} className={`cc-chicken-body ${hopKey ? 'cc-arc' : ''}`}>
                      <img src={chickenSrc} alt="" draggable={false} />
                    </div>
                    {killCar ? (
                      <div className="cc-car cc-kill-car">
                        <img src={killCarSrc} alt="" draggable={false} />
                      </div>
                    ) : null}
                    {hitFlash ? (
                      <div className="cc-impact">
                        {[[-52, -40], [48, -46], [-60, 8], [58, 12], [-30, 50], [34, 54], [0, -62], [6, 64]].map(([dx, dy]) => (
                          <span key={`${dx}:${dy}`} style={{ '--dx': `${dx}px`, '--dy': `${dy}px` }}>★</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="cc-board-label">{active ? (lane > 0 ? `Lane ${lane}` : 'Sidewalk') : 'Ready'}</div>
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
                Outcome is fixed when you start. Cash out after a safe hop. Max bet {formatMoney(maxBet)}, payout cap {formatMoney(config.payout_cap || 250_000_000_000)}.
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
