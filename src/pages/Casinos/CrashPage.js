import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
const GROWTH_FALLBACK = 0.09;
const BOOM_MS = 2000;
const LIVE_UI_MS = 150;

const imageCache = new Map();
function getImage(src) {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}
function ready(img) {
  return img && img.complete && img.naturalWidth > 0;
}
[SKYLINE, ...Object.values(ROCKETS), ...EXPLODE, ...FLAMES].forEach(getImage);

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
  .crash-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .crash-mult {
    position: absolute;
    left: 50%;
    top: 12%;
    transform: translateX(-50%);
    font-variant-numeric: tabular-nums;
    text-shadow: 0 2px 16px rgba(0,0,0,0.8);
    font-size: clamp(2rem, 8vw, 3.4rem);
    line-height: 1;
    pointer-events: none;
    transition: color 0.2s linear;
  }
  .crash-sub {
    position: absolute;
    left: 50%;
    top: 27%;
    transform: translateX(-50%);
    white-space: nowrap;
    pointer-events: none;
    text-shadow: 0 1px 8px rgba(0,0,0,0.8);
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
  for (; v < max - step * 0.12 && out.length < 5; v += step) out.push(Math.round(v * 100) / 100);
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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function heatFor(mult) {
  if (mult >= 8) return 3;
  if (mult >= 3) return 2;
  if (mult >= 1.6) return 1;
  return 0;
}
const FLAME_SCALE = [0.42, 0.62, 0.96, 1.4];

/**
 * Draws one frame of the board. Everything that moves lives in `sim`
 * so React never re-renders for animation.
 */
function drawBoard(ctx, sim, data, offset, rocketKey, nowMs) {
  const { w, h, dpr } = sim;
  if (!w || !h) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const growth = Number(data?.growth) || GROWTH_FALLBACK;
  const serverNow = nowMs + offset;
  const boom = sim.boom;
  const boomT = boom ? (performance.now() - boom.startedAt) / BOOM_MS : 0;
  const booming = !!boom && boomT < 1;
  if (boom && !booming) sim.boom = null;

  let mult = 1;
  let elapsed = 0;
  let flying = false;
  if (booming) {
    mult = Math.max(1, boom.crashCents / 100);
    elapsed = growth > 0 ? Math.log(mult) / growth : 0;
  } else if (data?.phase === 'flying' && data.flight_started_at) {
    const start = Date.parse(data.flight_started_at);
    elapsed = Math.max(0, (serverNow - start) / 1000);
    mult = Math.exp(growth * elapsed);
    flying = true;
  }

  // Axes follow the rocket with a soft lag so the chart never jumps.
  if (booming) {
    sim.viewY = boom.viewY;
    sim.viewX = boom.viewX;
  } else if (flying) {
    const targetY = Math.max(2, mult / 0.72);
    const targetX = Math.max(8, elapsed / 0.78);
    sim.viewY = Math.max(targetY * 0.92, lerp(sim.viewY, targetY, 0.14));
    sim.viewX = Math.max(targetX * 0.92, lerp(sim.viewX, targetX, 0.14));
  } else {
    sim.viewY = lerp(sim.viewY, 2, 0.25);
    sim.viewX = lerp(sim.viewX, 8, 0.25);
  }
  const yMax = sim.viewY;
  const xMax = sim.viewX;

  const small = w < 420;
  const padL = small ? 36 : 44;
  const padR = small ? 44 : 64;
  const padT = Math.round(h * 0.3);
  const padB = small ? 20 : 24;
  const plot = { x: padL, y: padT, w: w - padL - padR, h: h - padT - padB };
  const px = (e) => plot.x + (e / xMax) * plot.w;
  const py = (m) => plot.y + plot.h - ((m - 1) / (yMax - 1)) * plot.h;

  // Shake while the rocket blows.
  let sx = 0;
  let sy = 0;
  if (booming) {
    const k = (1 - boomT) ** 2 * 7;
    sx = (Math.random() - 0.5) * k;
    sy = (Math.random() - 0.5) * k;
  }
  ctx.save();
  ctx.translate(sx, sy);

  // Background
  ctx.fillStyle = '#05060a';
  ctx.fillRect(-10, -10, w + 20, h + 20);
  const sky = getImage(SKYLINE);
  if (ready(sky)) {
    const scale = Math.max(w / sky.naturalWidth, h / sky.naturalHeight);
    const dw = sky.naturalWidth * scale;
    const dh = sky.naturalHeight * scale;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(sky, (w - dw) / 2, h - dh, dw, dh);
    ctx.globalAlpha = 1;
  }
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(-10, -10, w + 20, h + 20);

  // Grid + axes
  ctx.font = '600 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  const yTicks = axisTicks(1, yMax);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  for (const v of yTicks) {
    const y = Math.round(py(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.moveTo(plot.x + 0.5, plot.y);
  ctx.lineTo(plot.x + 0.5, plot.y + plot.h + 0.5);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h + 0.5);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.textAlign = 'right';
  for (const v of yTicks) ctx.fillText(axisMult(v), plot.x - 5, py(v));
  ctx.textAlign = 'left';
  ctx.fillText('1.00x', plot.x + 4, plot.y + plot.h - 7);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of axisTicks(0, xMax)) ctx.fillText(`${Math.round(v)}s`, px(v), plot.y + plot.h + 5);

  // Curve
  const showLine = (flying || booming) && elapsed > 0.05;
  if (showLine) {
    const n = 56;
    ctx.beginPath();
    ctx.moveTo(px(0), py(1));
    for (let i = 1; i <= n; i += 1) {
      const e = elapsed * (i / n);
      ctx.lineTo(px(e), py(Math.exp(growth * e)));
    }
    const endX = px(elapsed);
    const endY = py(mult);
    ctx.save();
    ctx.lineTo(endX, py(1));
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, endY, 0, py(1));
    fill.addColorStop(0, booming ? 'rgba(255,90,60,0.28)' : 'rgba(245,193,90,0.26)');
    fill.addColorStop(1, 'rgba(245,193,90,0.02)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(px(0), py(1));
    for (let i = 1; i <= n; i += 1) {
      const e = elapsed * (i / n);
      ctx.lineTo(px(e), py(Math.exp(growth * e)));
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = booming ? 'rgba(255,110,80,0.35)' : 'rgba(245,193,90,0.35)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = booming ? '#ff7a5c' : '#f5c15a';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  // Rocket geometry
  const rocketImg = getImage(ROCKETS[rocketKey] || ROCKETS.vintage);
  const rw = Math.max(56, Math.min(w * 0.15, 104));
  const rh = ready(rocketImg) ? rw * (rocketImg.naturalHeight / rocketImg.naturalWidth) : rw * 0.52;
  let rx;
  let ry;
  let angle = 0;
  if (flying || booming) {
    rx = px(elapsed);
    ry = py(mult);
    const dx = plot.w / xMax;
    const dy = -((growth * mult) / (yMax - 1)) * plot.h;
    angle = Math.max(-1.0, Math.min(0, Math.atan2(dy, dx)));
  } else {
    rx = px(0) + rw * 0.55;
    ry = py(1) - rh * 0.6 + Math.sin(nowMs / 420) * 2.5;
  }
  sim.angle = lerp(sim.angle, angle, 0.18);

  const heat = flying ? heatFor(mult) : 0;
  sim.flame = lerp(sim.flame, flying ? FLAME_SCALE[heat] : 0, 0.12);
  sim.glow = lerp(sim.glow, heat, 0.1);
  sim.rocketAlpha = lerp(sim.rocketAlpha, booming ? 0 : 1, booming ? 1 : 0.2);

  if (!booming && sim.rocketAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = sim.rocketAlpha;
    ctx.translate(rx, ry);
    ctx.rotate(sim.angle);
    if (flying && sim.flame > 0.05) {
      const flameImg = getImage(FLAMES[heat]);
      if (ready(flameImg)) {
        const flicker = 1 + Math.sin(nowMs / 23) * 0.06 + Math.sin(nowMs / 7.3) * 0.04;
        const fh = rh * sim.flame * flicker;
        const fw = fh * (flameImg.naturalWidth / flameImg.naturalHeight);
        const right = -rw / 2 + rw * 0.08;
        ctx.globalAlpha = sim.rocketAlpha * (0.92 + Math.sin(nowMs / 11) * 0.08);
        ctx.drawImage(flameImg, right - fw, -fh / 2, fw, fh);
        ctx.globalAlpha = sim.rocketAlpha;
      }
    }
    if (ready(rocketImg)) {
      if (sim.glow > 0.05) {
        const g = sim.glow;
        ctx.shadowColor = g >= 2 ? `rgba(255,${Math.round(60 - (g - 2) * 40)},0,0.95)` : 'rgba(255,110,30,0.8)';
        ctx.shadowBlur = 6 + g * 7;
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 6;
      }
      ctx.drawImage(rocketImg, -rw / 2, -rh / 2, rw, rh);
    }
    ctx.restore();
  }

  // Explosion: crossfaded frames, flash, drift
  if (booming) {
    const p = boomT;
    const flash = (1 - p) ** 3;
    if (flash > 0.01) {
      const r = rw * (1.6 + p * 6);
      const rg = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
      rg.addColorStop(0, `rgba(255,236,190,${0.9 * flash})`);
      rg.addColorStop(0.35, `rgba(255,150,50,${0.6 * flash})`);
      rg.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(-10, -10, w + 20, h + 20);
    }
    const f = p * (EXPLODE.length - 1);
    const i = Math.min(EXPLODE.length - 1, Math.floor(f));
    const frac = f - i;
    const fadeOut = p > 0.82 ? 1 - (p - 0.82) / 0.18 : 1;
    const ew = rw * (2.1 + p * 0.9);
    const anchor = lerp(0.5, 0.3, p);
    const drift = p * rw * 0.35;
    const drawFrame = (idx, alpha) => {
      const img = getImage(EXPLODE[idx]);
      if (!ready(img) || alpha <= 0.01) return;
      const eh = ew * (img.naturalHeight / img.naturalWidth);
      ctx.globalAlpha = alpha * fadeOut;
      ctx.drawImage(img, rx - ew * anchor + drift, ry - eh / 2 - p * rh * 0.3, ew, eh);
    };
    ctx.save();
    drawFrame(i, 1 - frac);
    if (i + 1 < EXPLODE.length) drawFrame(i + 1, frac);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
  return { mult, flying, booming, elapsed };
}

const CrashBoard = memo(function CrashBoard({ stateRef, offsetRef, rocketKey, boomRef, onLive, multRef, subRef }) {
  const canvasRef = useRef(null);
  const simRef = useRef({ w: 0, h: 0, dpr: 1, viewY: 2, viewX: 8, angle: 0, flame: 0, glow: 0, rocketAlpha: 1, boom: null });
  const rocketKeyRef = useRef(rocketKey);
  rocketKeyRef.current = rocketKey;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return undefined;
    const sim = simRef.current;
    boomRef.current = sim;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sim.w = Math.round(rect.width);
      sim.h = Math.round(rect.height);
      sim.dpr = dpr;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const ctx = canvas.getContext('2d');
    let frame = 0;
    let lastUi = 0;
    const loop = () => {
      const now = Date.now();
      const out = drawBoard(ctx, sim, stateRef.current, offsetRef.current, rocketKeyRef.current, now);
      if (out) {
        const data = stateRef.current;
        const cents = out.booming ? Number(sim.boom?.crashCents || 100) : Math.max(100, Math.round(out.mult * 100));
        if (multRef.current) {
          multRef.current.textContent = fmtMult(cents);
          const color = out.booming ? '#fb7185' : out.flying ? '#fde68a' : '#f4f4f5';
          if (multRef.current.style.color !== color) multRef.current.style.color = color;
        }
        if (subRef.current) {
          let text = '';
          let color = '#e4e4e7';
          if (out.flying) {
            const mine = data?.my_bet;
            if (mine?.status === 'open') {
              text = fmtFull(runningPayout(mine.stake, cents, data?.limits?.[mine.currency]?.payout_cap), mine.currency);
              color = '#6ee7b7';
            }
          } else if (!out.booming && data?.phase === 'betting' && data.betting_ends_at) {
            const left = Date.parse(data.betting_ends_at) - (now + offsetRef.current);
            text = `NEXT ROCKET IN ${Math.max(0, Math.ceil(left / 1000))}S`;
          } else if (out.booming) {
            text = 'CRASHED';
            color = '#fb7185';
          }
          if (subRef.current.textContent !== text) subRef.current.textContent = text;
          if (subRef.current.style.color !== color) subRef.current.style.color = color;
        }
        if (now - lastUi >= LIVE_UI_MS) {
          lastUi = now;
          onLive(cents, out.flying, out.booming);
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [stateRef, offsetRef, boomRef, onLive, multRef, subRef]);

  return <canvas ref={canvasRef} className="crash-canvas" aria-hidden="true" />;
});

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

function stateSignature(data) {
  if (!data) return '';
  const { server_now: _now, multiplier_cents: _m, ...rest } = data;
  return JSON.stringify(rest);
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
  const [tab, setTab] = useState('in');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState({ cents: 100, flying: false, booming: false });
  const [winFlash, setWinFlash] = useState(null);
  const stateRef = useRef(null);
  const offsetRef = useRef(0);
  const sigRef = useRef('');
  const roundRef = useRef(null);
  const winRef = useRef(null);
  const boomRef = useRef(null);
  const multRef = useRef(null);
  const subRef = useRef(null);

  const applyState = useCallback((data) => {
    const server = Date.parse(data.server_now || '') || Date.now();
    offsetRef.current = server - Date.now();
    stateRef.current = data;
    const sig = stateSignature(data);
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    if (data.auto) {
      setAutoOn(!!data.auto.enabled);
      if (data.auto.stake) setStake(String(data.auto.stake));
      if (data.auto.currency) setCurrency(data.auto.currency);
      if (data.auto.auto_cashout) setAutoCash(Number(data.auto.auto_cashout).toFixed(2));
    }
    setState(data);
  }, []);

  const pull = useCallback(async () => {
    const res = await api.get('/casino/crash/state');
    applyState(res.data || {});
  }, [applyState]);

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
    if (!state) return;
    const prevRound = roundRef.current;
    if (prevRound && state.round_id !== prevRound && state.last_crash_cents) {
      const sim = boomRef.current;
      if (sim) {
        sim.boom = {
          startedAt: performance.now(),
          crashCents: Number(state.last_crash_cents) || 100,
          viewY: Math.max(2, sim.viewY),
          viewX: Math.max(8, sim.viewX),
        };
      }
    }
    roundRef.current = state.round_id;
    const mine = state.my_bet;
    if (mine?.status === 'cashed' && winRef.current !== `${state.round_id}:cashed`) {
      winRef.current = `${state.round_id}:cashed`;
      setWinFlash({ mult: mine.cashout_cents, payout: mine.payout, currency: mine.currency });
      refreshUser();
    }
    if (mine?.status === 'lost' && winRef.current !== `${state.round_id}:lost`) {
      winRef.current = `${state.round_id}:lost`;
      refreshUser();
    }
  }, [state]);

  useEffect(() => {
    if (!winFlash) return undefined;
    const t = window.setTimeout(() => setWinFlash(null), 1700);
    return () => window.clearTimeout(t);
  }, [winFlash]);

  const onLive = useCallback((cents, flying, booming) => {
    setLive((prev) => (prev.cents === cents && prev.flying === flying && prev.booming === booming ? prev : { cents, flying, booming }));
  }, []);

  const limits = state?.limits?.[currency] || { max_bet: currency === 'points' ? 500 : 2_000_000_000 };
  const phase = state?.phase || 'betting';
  const flying = live.flying && !live.booming;

  async function send(path, body) {
    setBusy(true);
    try {
      const res = body ? await api.post(path, body) : await api.post(path);
      applyState(res.data || {});
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
  const canBet = phase === 'betting' && !mine && !live.booming;
  const canCash = flying && mine?.status === 'open';
  const onAmount = canCash
    ? runningPayout(mine.stake, live.cents, state?.limits?.[mine.currency]?.payout_cap)
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
          <div className="crash-board">
            <CrashBoard
              stateRef={stateRef}
              offsetRef={offsetRef}
              rocketKey={rocket}
              boomRef={boomRef}
              onLive={onLive}
              multRef={multRef}
              subRef={subRef}
            />
            <div ref={multRef} className="crash-mult font-heading font-black text-zinc-100">1.00x</div>
            <div ref={subRef} className="crash-sub text-[11px] sm:text-sm font-heading font-bold uppercase tracking-widest tabular-nums" />
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
              className={`crash-btn mt-4 flex-1 rounded-md font-heading font-black uppercase tracking-wide disabled:opacity-40 ${canCash ? 'bg-emerald-500 text-black' : 'bg-primary text-primary-foreground'}`}
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
                            ? fmtAmount(runningPayout(bet.stake, live.cents, state?.limits?.[bet.currency]?.payout_cap), bet.currency)
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
    </div>
  );
}
