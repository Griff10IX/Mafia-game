import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rocket } from 'lucide-react';
import { toast } from 'sonner';
import api, { getApiErrorMessage, refreshUser } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import { publicAsset } from '../../utils/publicAssets';
import { CRASH_ADMIN_ONLY } from '../../config/gameFeatures';
import styles from '../../styles/noir.module.css';

const ROCKETS = {
  vintage: publicAsset('/images/crash/rocket-vintage.png'),
  gold: publicAsset('/images/crash/rocket-capone-gold.png'),
};
const SKYLINE = publicAsset('/images/crash/skyline.jpg');
const EXPLODE = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => publicAsset(`/images/crash/explode-${n}.png`));
const FLAMES = [1, 2, 3, 4].map((n) => publicAsset(`/images/crash/flame-${n}.png`));
const FRAME_MS = 420;
const GROWTH_FALLBACK = 0.09;

const PAGE_STYLES = `
  .crash-page { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .crash-layout { display: flex; flex-direction: column; gap: 8px; }
  .crash-board {
    position: relative;
    height: min(46dvh, 320px);
    min-height: 210px;
    overflow: hidden;
    background: #05060a;
  }
  .crash-axes {
    position: absolute;
    left: 40px;
    right: 72px;
    top: 38px;
    bottom: 22px;
    border-left: 1px solid rgba(255,255,255,0.45);
    border-bottom: 1px solid rgba(255,255,255,0.45);
  }
  .crash-chart {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .crash-tick {
    position: absolute;
    font-size: 9px;
    line-height: 1;
    color: rgba(255,255,255,0.72);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .crash-ship {
    position: absolute;
    width: 64px;
    transform: translate(0, 50%);
    pointer-events: none;
    user-select: none;
    z-index: 2;
  }
  .crash-rocket {
    position: relative;
    width: 100%;
    height: auto;
    display: block;
    filter: drop-shadow(0 8px 12px rgba(0,0,0,0.55));
  }
  .crash-flame {
    position: absolute;
    right: 93%;
    top: 50%;
    height: 42%;
    width: auto;
    transform: translateY(-50%);
    filter: drop-shadow(0 0 6px rgba(255,120,30,0.6));
    animation: crash-flicker 0.14s steps(2) infinite;
    pointer-events: none;
  }
  .heat-1 .crash-flame { height: 62%; }
  .heat-2 .crash-flame { height: 96%; }
  .heat-3 .crash-flame { height: 140%; }
  .heat-1 .crash-rocket { filter: drop-shadow(0 0 4px rgba(255,90,20,0.7)) drop-shadow(0 8px 10px rgba(0,0,0,0.45)); }
  .heat-2 .crash-rocket { filter: drop-shadow(0 0 2px #ffd2b0) drop-shadow(0 0 8px rgba(255,40,0,0.95)) drop-shadow(0 0 18px rgba(180,0,0,0.7)); }
  .heat-3 .crash-rocket { filter: drop-shadow(0 0 2px #fff) drop-shadow(0 0 8px #ff2200) drop-shadow(0 0 18px #ff0000) drop-shadow(0 0 30px rgba(255,30,0,0.9)); }
  @keyframes crash-flicker {
    0% { transform: translateY(-50%) scaleX(1) scaleY(1); }
    100% { transform: translateY(-46%) scaleX(1.08) scaleY(0.9); }
  }
  .crash-mult {
    position: absolute;
    left: 50%;
    top: 12%;
    transform: translateX(-50%);
    font-variant-numeric: tabular-nums;
    text-shadow: 0 2px 16px rgba(0,0,0,0.8);
    font-size: clamp(2rem, 8vw, 3.4rem);
    line-height: 1;
  }
  .crash-explode {
    position: absolute;
    width: min(62vw, 240px);
    height: auto;
    transform: translate(-42%, 28%);
    pointer-events: none;
    z-index: 3;
  }
  .crash-dock {
    position: sticky;
    bottom: 0;
    z-index: 30;
    padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  }
  .crash-input {
    font-size: 16px;
    min-height: 44px;
  }
  .crash-btn { min-height: 48px; touch-action: manipulation; }
  @media (max-height: 520px) and (orientation: landscape) {
    .crash-board { height: 168px; min-height: 150px; }
    .crash-axes { left: 34px; right: 58px; top: 28px; }
    .crash-ship { width: 52px; }
    .crash-mult { font-size: 1.7rem; top: 8%; }
    .crash-dock { position: static; }
  }
  @media (min-width: 768px) and (max-width: 1024px) {
    .crash-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(240px, 300px);
      grid-template-areas: "stage side" "dock side";
      align-items: start;
      gap: 10px;
    }
    .crash-stage { grid-area: stage; }
    .crash-dock { grid-area: dock; position: static; padding-bottom: 0; }
    .crash-side { grid-area: side; }
    .crash-board { height: min(42dvh, 380px); min-height: 260px; }
    .crash-ship { width: 78px; }
    .crash-axes { right: 88px; }
  }
  @media (min-width: 1025px) {
    .crash-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      grid-template-areas: "stage side" "dock side";
      align-items: start;
      gap: 12px;
    }
    .crash-stage { grid-area: stage; }
    .crash-dock { grid-area: dock; position: static; padding-bottom: 0; }
    .crash-side { grid-area: side; }
    .crash-board { height: min(52dvh, 460px); min-height: 320px; }
    .crash-ship { width: 92px; }
    .crash-axes { right: 108px; }
    .crash-input { font-size: 14px; }
  }
`;

function fmtAmount(n, currency) {
  const v = Math.floor(Number(n) || 0);
  if (currency === 'points') return `${v.toLocaleString()} pts`;
  if (Math.abs(v) >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(v % 1_000_000_000 ? 2 : 0)}B`;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`;
  return `$${v.toLocaleString()}`;
}

function fmtFull(n, currency) {
  const v = Math.floor(Number(n) || 0);
  return currency === 'points' ? `${v.toLocaleString()} pts` : `$${v.toLocaleString()}`;
}

function fmtMult(cents) {
  const c = Math.max(0, Math.floor(Number(cents) || 0));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}x`;
}

function niceStep(span) {
  const raw = Math.max(span, 0.01) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const base = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return base * pow;
}

function axisTicks(min, max) {
  const step = niceStep(max - min);
  const out = [];
  let v = Math.ceil((min + step * 0.2) / step) * step;
  for (; v < max - step * 0.12 && out.length < 4; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function axisMult(m) {
  if (m >= 100) return `${Math.round(m)}x`;
  if (m >= 10) return `${m.toFixed(m >= 20 ? 0 : 1)}x`;
  return `${m.toFixed(2)}x`;
}

function pillClass(cents) {
  if (cents >= 1000) return 'border-emerald-400/40 text-emerald-300';
  if (cents >= 200) return 'border-primary/40 text-primary';
  return 'border-rose-400/40 text-rose-300';
}

function runningPayout(stake, cents, cap) {
  const raw = Math.floor((Number(stake) || 0) * Math.max(0, Math.floor(cents)) / 100);
  return cap ? Math.min(cap, raw) : raw;
}

export default function CrashPage() {
  const [staffOk, setStaffOk] = useState(CRASH_ADMIN_ONLY ? null : true);
  useEffect(() => {
    if (!CRASH_ADMIN_ONLY) return undefined;
    let cancelled = false;
    api.get('/auth/staff-flags')
      .then((r) => { if (!cancelled) setStaffOk(!!r.data?.is_admin); })
      .catch(() => { if (!cancelled) setStaffOk(false); });
    return () => { cancelled = true; };
  }, []);
  if (staffOk === null) return null;
  if (!staffOk) {
    return (
      <div className={`${styles.pageContent} mobile-page-root p-4`} data-testid="crash-page">
        <div className="mobile-panel border border-primary/20 p-4 text-sm text-zinc-400">Crash is in admin testing. Check back soon.</div>
      </div>
    );
  }
  return <CrashGame />;
}

function CrashGame() {
  const [state, setState] = useState(null);
  const [currency, setCurrency] = useState('cash');
  const [stake, setStake] = useState('1000000');
  const [autoCash, setAutoCash] = useState('2.00');
  const [autoOn, setAutoOn] = useState(false);
  const [stopProfit, setStopProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [rocket, setRocket] = useState(() => localStorage.getItem('crash-rocket') || 'vintage');
  const rocketSrc = ROCKETS[rocket] || ROCKETS.vintage;
  const flameSrc = FLAMES;
  const [tab, setTab] = useState('in');
  const [busy, setBusy] = useState(false);
  const [liveMult, setLiveMult] = useState(100);
  const [boom, setBoom] = useState(null);
  const [winFlash, setWinFlash] = useState(null);
  const offsetRef = useRef(0);
  const phaseRef = useRef('betting');
  const roundRef = useRef(null);
  const winRef = useRef(null);

  const pull = useCallback(async () => {
    const res = await api.get('/casino/crash/state');
    const data = res.data || {};
    const server = Date.parse(data.server_now || '') || Date.now();
    offsetRef.current = server - Date.now();
    if (data.auto) {
      setAutoOn(!!data.auto.enabled);
      if (data.auto.stake) setStake(String(data.auto.stake));
      if (data.auto.currency) setCurrency(data.auto.currency);
      if (data.auto.auto_cashout) setAutoCash(Number(data.auto.auto_cashout).toFixed(2));
    }
    setState(data);
    return data;
  }, []);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const loop = async () => {
      try {
        await pull();
      } catch (e) {
        if (!stop) toast.error(getApiErrorMessage(e) || 'Crash is unavailable');
      }
      if (!stop) timer = window.setTimeout(loop, document.hidden ? 1500 : 400);
    };
    loop();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [pull]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const data = state;
      if (data?.phase === 'flying' && data.flight_started_at) {
        const start = Date.parse(data.flight_started_at);
        const elapsed = Math.max(0, (Date.now() + offsetRef.current - start) / 1000);
        const growth = Number(data.growth) || GROWTH_FALLBACK;
        setLiveMult(Math.max(100, Math.round(Math.exp(growth * elapsed) * 100)));
      } else {
        setLiveMult(100);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const prevPhase = phaseRef.current;
    const prevRound = roundRef.current;
    if (prevPhase === 'flying' && state.phase === 'betting' && state.round_id !== prevRound) {
      setBoom(0);
    }
    phaseRef.current = state.phase;
    roundRef.current = state.round_id;
    const mine = state.my_bet;
    if (mine?.status === 'cashed' && winRef.current !== `${state.round_id}:cashed`) {
      winRef.current = `${state.round_id}:cashed`;
      setWinFlash({ mult: mine.cashout_cents, payout: mine.payout, currency: mine.currency });
      refreshUser();
    }
    if (mine?.status === 'lost') refreshUser();
  }, [state]);

  useEffect(() => {
    if (boom == null) return undefined;
    if (boom >= EXPLODE.length) {
      const done = window.setTimeout(() => setBoom(null), 900);
      return () => window.clearTimeout(done);
    }
    const step = window.setTimeout(() => setBoom((n) => (n == null ? null : n + 1)), FRAME_MS);
    return () => window.clearTimeout(step);
  }, [boom]);

  useEffect(() => {
    if (!winFlash) return undefined;
    const t = window.setTimeout(() => setWinFlash(null), 1700);
    return () => window.clearTimeout(t);
  }, [winFlash]);

  const limits = state?.limits?.[currency] || { max_bet: currency === 'points' ? 500 : 2_000_000_000 };
  const phase = state?.phase || 'betting';
  const flying = phase === 'flying' && boom == null;
  const countdown = useMemo(() => {
    if (!state?.betting_ends_at || phase !== 'betting') return 0;
    const left = Date.parse(state.betting_ends_at) - (Date.now() + offsetRef.current);
    return Math.max(0, Math.ceil(left / 1000));
  }, [state, liveMult, phase]);

  const chart = useMemo(() => {
    const growth = Number(state?.growth) || GROWTH_FALLBACK;
    const crashed = boom != null;
    const shownCents = crashed ? (state?.last_crash_cents || liveMult) : liveMult;
    const mult = Math.max(1, (flying || crashed ? shownCents : 100) / 100);
    const elapsed = Math.max(0, Math.log(mult) / growth);
    const yMax = Math.max(2, mult / 0.72);
    const xMax = Math.max(8, elapsed / 0.78);
    const x = (elapsed / xMax) * 100;
    const y = ((mult - 1) / (yMax - 1)) * 100;
    const samples = 40;
    const pts = [];
    for (let i = 0; i <= samples; i += 1) {
      const e = elapsed * (i / samples);
      const m = Math.exp(growth * e);
      const px = (e / xMax) * 100;
      const py = 100 - ((m - 1) / (yMax - 1)) * 100;
      pts.push(`${px.toFixed(2)},${py.toFixed(2)}`);
    }
    const yTicks = axisTicks(1, yMax).map((v) => ({
      v,
      label: axisMult(v),
      bottom: `${((v - 1) / (yMax - 1)) * 100}%`,
    }));
    const xTicks = axisTicks(0, xMax).map((v) => ({
      v,
      label: `${Math.round(v)}s`,
      left: `${(v / xMax) * 100}%`,
    }));
    return { x, y, pts: pts.join(' '), yTicks, xTicks, showLine: elapsed > 0.05 };
  }, [state, liveMult, flying, boom]);

  async function send(path, body) {
    setBusy(true);
    try {
      const res = body ? await api.post(path, body) : await api.post(path);
      setState(res.data);
      const server = Date.parse(res.data?.server_now || '') || Date.now();
      offsetRef.current = server - Date.now();
      refreshUser();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not do that');
    } finally {
      setBusy(false);
    }
  }

  function placeBet() {
    const amount = parseInt(String(stake).replace(/\D/g, ''), 10);
    const cashout = parseFloat(autoCash);
    send('/casino/crash/bet', {
      stake: amount,
      currency,
      auto_cashout: Number.isFinite(cashout) && cashout >= 1.01 ? cashout : null,
    });
  }

  function saveAuto(enabled) {
    const amount = parseInt(String(stake).replace(/\D/g, ''), 10) || 0;
    const cashout = parseFloat(autoCash);
    send('/casino/crash/auto', {
      enabled,
      stake: amount,
      currency,
      auto_cashout: Number.isFinite(cashout) && cashout >= 1.01 ? cashout : null,
      stop_profit: parseInt(String(stopProfit).replace(/\D/g, ''), 10) || 0,
      stop_loss: parseInt(String(stopLoss).replace(/\D/g, ''), 10) || 0,
    });
  }

  const mine = state?.my_bet;
  const canBet = phase === 'betting' && !mine && boom == null;
  const canCash = flying && mine?.status === 'open';
  const onAmount = canCash
    ? runningPayout(mine.stake, liveMult, state?.limits?.[mine.currency]?.payout_cap)
    : 0;
  return (
    <div className={`crash-page space-y-2 ${styles.pageContent} mobile-page-root pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-4`} data-testid="crash-page">
      <style>{PAGE_STYLES}</style>
      <header className="px-3 md:px-0 flex items-center justify-between gap-2">
        <div>
          <p className="text-[9px] text-zinc-500 font-heading uppercase tracking-[0.2em]">Casino</p>
          <h1 className="text-xl sm:text-2xl font-heading font-black uppercase tracking-wide text-primary flex items-center gap-2">
            <Rocket size={18} /> Crash
          </h1>
        </div>
        <div className="flex rounded-md border border-primary/30 overflow-hidden text-[10px] font-heading uppercase">
          {['vintage', 'gold'].map((key) => (
            <button
              key={key}
              type="button"
              className={`min-h-[36px] px-2.5 ${rocket === key ? 'bg-primary/20 text-primary' : 'text-zinc-400'}`}
              onClick={() => {
                setRocket(key);
                localStorage.setItem('crash-rocket', key);
              }}
            >
              {key === 'vintage' ? 'Capone' : 'Gold'}
            </button>
          ))}
        </div>
      </header>

      <div className="crash-layout">
        <section className={`crash-stage ${styles.panel} mobile-panel rounded-none md:rounded-xl overflow-hidden border border-primary/20`}>
          <div className="flex gap-1.5 overflow-x-auto px-2 py-1.5 border-b border-primary/15 [scrollbar-width:none]">
            {(state?.history || []).slice().reverse().map((cents, i) => (
              <span key={`${cents}-${i}`} className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-heading tabular-nums ${pillClass(cents)}`}>
                {fmtMult(cents)}
              </span>
            ))}
            {!state?.history?.length && <span className="text-[10px] text-zinc-500 font-heading">Waiting for the first flight</span>}
          </div>
          <div className={`crash-board ${boom != null ? 'animate-[crash-shake_0.45s_linear]' : ''}`}>
            <img src={SKYLINE} alt="" className="absolute inset-0 w-full h-full object-cover opacity-55" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/45" />
            <div className="crash-axes">
              <span className="crash-tick" style={{ left: 2, bottom: 2 }}>1.00x</span>
              {chart.yTicks.map((tick) => (
                <span key={`y-${tick.v}`} className="crash-tick" style={{ right: 'calc(100% + 4px)', bottom: tick.bottom, transform: 'translateY(50%)' }}>{tick.label}</span>
              ))}
              {chart.xTicks.map((tick) => (
                <span key={`x-${tick.v}`} className="crash-tick" style={{ left: tick.left, top: 'calc(100% + 5px)', transform: 'translateX(-50%)' }}>{tick.label}</span>
              ))}
              <svg className="crash-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
                {chart.yTicks.map((tick) => (
                  <line key={`g-${tick.v}`} x1="0" x2="100" y1={100 - parseFloat(tick.bottom)} y2={100 - parseFloat(tick.bottom)} stroke="rgba(255,255,255,0.12)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
                ))}
                {chart.showLine && (
                  <>
                    <polygon points={`0,100 ${chart.pts} ${chart.x.toFixed(2)},100`} fill="rgba(245,193,90,0.16)" />
                    <polyline points={chart.pts} fill="none" stroke="#f5c15a" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  </>
                )}
              </svg>
              {boom != null && boom < EXPLODE.length && rocket === 'vintage' ? (
                <img src={EXPLODE[boom]} alt="" className="crash-explode" style={{ left: `${chart.x}%`, bottom: `${chart.y}%` }} />
              ) : (
                <div className={`crash-ship ${flying ? `heat-${liveMult >= 800 ? 3 : liveMult >= 300 ? 2 : liveMult >= 160 ? 1 : 0}` : ''}`} style={{ left: `${chart.x}%`, bottom: `${chart.y}%` }}>
                  {flying && <img src={flameSrc[liveMult >= 800 ? 3 : liveMult >= 300 ? 2 : liveMult >= 160 ? 1 : 0]} alt="" className="crash-flame" />}
                  <img src={rocketSrc} alt="" className="crash-rocket" />
                </div>
              )}
              {boom != null && rocket !== 'vintage' && (
                <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,170,40,0.85),rgba(80,0,0,0.2)_55%,transparent_70%)]" />
              )}
            </div>
            <div className={`crash-mult font-heading font-black ${boom != null ? 'text-rose-400' : flying ? 'text-amber-200' : 'text-zinc-100'}`}>
              {boom != null && state?.last_crash_cents ? fmtMult(state.last_crash_cents) : fmtMult(flying ? liveMult : 100)}
            </div>
            {canCash && (
              <div className="absolute left-1/2 top-[26%] -translate-x-1/2 text-sm sm:text-base font-heading font-bold text-emerald-300 tabular-nums">
                {fmtFull(onAmount, mine.currency)}
              </div>
            )}
            {phase === 'betting' && boom == null && (
              <div className="absolute top-[26%] left-0 right-0 text-center text-[11px] font-heading uppercase tracking-widest text-zinc-200">
                Next rocket in {countdown}s
              </div>
            )}
            {winFlash && (
              <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-lg border border-amber-300/50 bg-black/75 px-3 py-3 text-center">
                <div className="text-[10px] uppercase tracking-widest text-amber-200 font-heading">Cashed out</div>
                <div className="text-2xl font-heading font-black text-amber-100">{fmtMult(winFlash.mult)}</div>
                <div className="text-sm text-emerald-300 font-heading">{fmtFull(winFlash.payout, winFlash.currency)}</div>
              </div>
            )}
          </div>
        </section>

        <section className={`crash-dock ${styles.panel} mobile-panel border border-primary/20 px-3 py-2.5 space-y-2`}>
          <div className="flex gap-1">
            {['cash', 'points'].map((key) => (
              <button
                key={key}
                type="button"
                disabled={!!mine || autoOn}
                onClick={() => {
                  setCurrency(key);
                  setStake(key === 'points' ? '50' : '1000000');
                }}
                className={`min-h-[36px] flex-1 rounded-md border text-[11px] font-heading uppercase ${currency === key ? 'border-primary text-primary bg-primary/10' : 'border-zinc-700 text-zinc-400'}`}
              >
                {key}
              </button>
            ))}
          </div>
          <FormattedNumberInput
            value={stake}
            onChange={setStake}
            max={limits.max_bet}
            disabled={!canBet && !autoOn}
            className="crash-input w-full rounded-md border border-primary/30 bg-zinc-950 px-3 text-foreground font-heading"
            inputMode="numeric"
            aria-label="Bet"
          />
          <div className="flex gap-2">
            <label className="flex-1 text-[10px] text-zinc-400 font-heading">
              Auto cash out
              <input
                value={autoCash}
                onChange={(e) => setAutoCash(e.target.value)}
                inputMode="decimal"
                className="crash-input mt-1 w-full rounded-md border border-primary/25 bg-zinc-950 px-2 text-foreground"
              />
            </label>
            <button
              type="button"
              disabled={busy || (!canBet && !canCash)}
              onClick={canCash ? () => send('/casino/crash/cashout') : placeBet}
              className="crash-btn mt-4 flex-1 rounded-md bg-primary text-primary-foreground font-heading font-black uppercase tracking-wide disabled:opacity-40"
            >
              {canCash ? `Cash out ${fmtAmount(onAmount, mine.currency)}` : mine ? (mine.status === 'open' ? 'In' : mine.status === 'cashed' ? 'Cashed' : 'Bust') : 'Place bet'}
            </button>
          </div>
        </section>

        <aside className="crash-side space-y-2 px-0">
          <div className="flex gap-1 px-3 md:px-0">
            {[
              ['in', 'In'],
              ['board', 'Board'],
              ['auto', 'Auto'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`min-h-[40px] flex-1 rounded-md border text-[11px] font-heading uppercase ${tab === id ? 'border-primary text-primary' : 'border-zinc-700 text-zinc-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={`${styles.panel} mobile-panel border border-primary/15 p-2.5 min-h-[9rem]`}>
            {tab === 'in' && (
              <ul className="space-y-1 max-h-60 overflow-y-auto md:max-h-[28rem]">
                {(state?.bets || []).map((bet, i) => (
                  <li key={`${bet.username}-${i}`} className="flex items-center justify-between gap-2 text-[11px] font-heading">
                    <span className={bet.mine ? 'text-primary' : 'text-zinc-200'}>{bet.username}</span>
                    <span className="text-zinc-400">{fmtAmount(bet.stake, bet.currency)}</span>
                    <span className={bet.status === 'cashed' ? 'text-emerald-300' : bet.status === 'lost' ? 'text-rose-300' : 'text-amber-200'}>
                      {bet.status === 'cashed'
                        ? `${fmtMult(bet.cashout_cents)} · ${fmtAmount(bet.payout, bet.currency)}`
                        : bet.status === 'lost'
                          ? 'Bust'
                          : flying
                            ? fmtAmount(runningPayout(bet.stake, liveMult, state?.limits?.[bet.currency]?.payout_cap), bet.currency)
                            : 'In'}
                    </span>
                  </li>
                ))}
                {!state?.bets?.length && <li className="text-[11px] text-zinc-500 font-heading">Nobody in yet</li>}
              </ul>
            )}
            {tab === 'board' && (
              <div>
                <div className="flex gap-1 mb-2">
                  {['cash', 'points'].map((key) => (
                    <button key={key} type="button" onClick={() => setCurrency(key)} className={`min-h-[32px] px-2 rounded border text-[10px] uppercase font-heading ${currency === key ? 'border-primary text-primary' : 'border-zinc-700 text-zinc-400'}`}>
                      {key}
                    </button>
                  ))}
                </div>
                <ul className="space-y-1 max-h-60 overflow-y-auto md:max-h-[28rem]">
                  {(state?.leaderboard?.[currency] || []).map((row, i) => (
                    <li key={`${row.username}-${i}`} className="grid grid-cols-[1.2rem_1fr_auto] gap-2 text-[11px] font-heading items-center">
                      <span className="text-zinc-500">{i + 1}</span>
                      <span className="truncate text-zinc-100">{row.username}</span>
                      <span className={row.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{fmtAmount(row.net, currency)}</span>
                    </li>
                  ))}
                  {!(state?.leaderboard?.[currency] || []).length && <li className="text-[11px] text-zinc-500">No winners yet</li>}
                </ul>
              </div>
            )}
            {tab === 'auto' && (
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-400 font-heading">Joins the next rocket with this stake. A bust lowers your running total. Stop amounts are optional.</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-zinc-400 font-heading">
                    Stop after up
                    <FormattedNumberInput value={stopProfit} onChange={setStopProfit} className="crash-input mt-1 w-full rounded-md border border-emerald-500/30 bg-zinc-950 px-2 text-foreground" />
                  </label>
                  <label className="text-[10px] text-zinc-400 font-heading">
                    Stop after down
                    <FormattedNumberInput value={stopLoss} onChange={setStopLoss} className="crash-input mt-1 w-full rounded-md border border-rose-500/30 bg-zinc-950 px-2 text-foreground" />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => saveAuto(!autoOn)}
                  className="crash-btn w-full rounded-md border border-primary/40 text-primary font-heading uppercase text-[12px]"
                >
                  {autoOn ? 'Stop auto bet' : 'Start auto bet'}
                </button>
                {state?.auto?.enabled && (
                  <p className="text-[10px] font-heading text-zinc-400">This run: {fmtFull(state.auto.session_net, state.auto.currency)}</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
      <style>{`@keyframes crash-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-3px)} 75%{transform:translateX(3px)} }`}</style>
    </div>
  );
}
