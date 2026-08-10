import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, CircleDollarSign, Clock, Gift, Sparkles, Trophy, Zap } from 'lucide-react';
import { toast } from 'sonner';
import api, { getApiErrorMessage, refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const WHEEL_STYLES = `
  .wof-fade { animation: wof-fade 0.4s ease-out both; }
  @keyframes wof-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .wof-pointer { filter: drop-shadow(0 3px 6px rgba(0,0,0,0.55)); }
  .wof-wheel-wrap {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .wof-wheel {
    transition: transform 4.6s cubic-bezier(0.12, 0.75, 0.08, 1);
    will-change: transform;
  }
  .wof-hub {
    background:
      radial-gradient(circle at 35% 30%, rgba(255,230,150,0.55), transparent 40%),
      radial-gradient(circle at 50% 55%, #3a2410 0%, #1a1008 70%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), 0 8px 24px rgba(0,0,0,0.5);
    border: 2px solid #c9a227;
  }
  .wof-btn {
    touch-action: manipulation;
    transition: transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
    min-height: 2.75rem;
  }
  .wof-btn:active:not(:disabled) { transform: scale(0.97); }
  .wof-btn:disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(0.25); }
  .wof-jackpot-glow {
    box-shadow: 0 0 0 1px rgba(255,215,0,0.35), 0 0 18px rgba(255,185,0,0.2);
  }
  .wof-label {
    paint-order: stroke fill;
    stroke: rgba(10, 6, 2, 0.85);
    stroke-width: 0.7px;
    stroke-linejoin: round;
  }
  .wof-rewards > summary {
    list-style: none;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .wof-rewards > summary::-webkit-details-marker { display: none; }
  .wof-rewards > summary .wof-chevron { transition: transform 0.2s ease; }
  .wof-rewards[open] > summary .wof-chevron { transform: rotate(180deg); }
  @media (max-width: 480px) {
    .wof-intro { font-size: 10px; line-height: 1.35; }
  }
`;

const TIER_FALLBACK = {
  jackpot: '#d4af37',
  rare: '#3d9e6f',
  token: '#4a2820',
  common: '#241810',
};

const TIER_ORDER = ['jackpot', 'rare', 'token', 'common'];
const TIER_META = {
  jackpot: { title: 'Jackpots', hint: 'Rarest', titleCls: 'text-amber-300', rowCls: 'border-amber-600/35' },
  rare: { title: 'Rares', hint: 'Hard to hit', titleCls: 'text-emerald-300', rowCls: 'border-emerald-600/35' },
  token: { title: 'Store tokens (×3)', hint: 'Perk / skip tokens', titleCls: 'text-orange-200/90', rowCls: 'border-orange-800/35' },
  common: { title: 'Commons', hint: 'Cash, points, bullets, skips', titleCls: 'text-zinc-300', rowCls: 'border-zinc-600/35' },
};

function formatCountdown(secs) {
  const s = Math.max(0, Number(secs) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function wedgePath(cx, cy, r, startDeg, endDeg) {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function formatWinAge(iso) {
  if (!iso) return '';
  try {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  } catch {
    return '';
  }
}

function shortLabel(w) {
  const raw = String(w?.short || w?.label || '').trim();
  if (!raw) return '';
  const tier = w?.tier;
  const max = tier === 'jackpot' || tier === 'rare' ? 5 : 4;
  return raw.length > max ? raw.slice(0, max) : raw;
}

export default function WheelOfFortunePage() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastPrize, setLastPrize] = useState(null);
  const [freeSecs, setFreeSecs] = useState(null);
  const spinLock = useRef(false);
  const resultTimer = useRef(null);

  const wedges = config?.wedges || [];
  const n = wedges.length || 1;
  const slice = 360 / n;
  const recentWins = Array.isArray(config?.recent_wins) ? config.recent_wins : [];

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.get('/casino/wheel/config');
      setConfig(res.data);
      setFreeSecs(res.data.free_seconds_remaining ?? null);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not load wheel');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    return () => {
      if (resultTimer.current) clearTimeout(resultTimer.current);
    };
  }, [loadConfig]);

  useEffect(() => {
    if (freeSecs == null || freeSecs <= 0) return undefined;
    const t = setInterval(() => {
      setFreeSecs((prev) => {
        if (prev == null) return null;
        const next = prev - 1;
        return next <= 0 ? 0 : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [freeSecs != null && freeSecs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusBits = useMemo(() => {
    if (!config) return null;
    const bonus = Number(config.bonus_free_spins ?? 0);
    const adminUnlimited = !!config.admin_unlimited;
    const dailyReady = !!config.daily_free_available || (freeSecs != null && freeSecs <= 0) || adminUnlimited;
    const freeOk = !!config.free_available || dailyReady || bonus > 0 || adminUnlimited;
    const dailySecs = freeSecs ?? config.free_seconds_remaining;
    return {
      freeOk,
      bonus,
      adminUnlimited,
      dailyReady,
      dailySecs: adminUnlimited ? null : dailySecs,
      paidLeft: Number(config.paid_spins_remaining_today ?? 0),
      ptsCost: Number(config.paid_cost_points ?? 100),
      respCost: Number(config.paid_cost_respect ?? 300),
      points: Number(config.points ?? 0),
      respect: Number(config.respect_points ?? 0),
    };
  }, [config, freeSecs]);

  const freeButtonLabel = useMemo(() => {
    if (!statusBits) return 'Free Spin';
    if (statusBits.adminUnlimited) return 'Free Spin · admin';
    if (statusBits.bonus > 0) return `Free Spin · ${statusBits.bonus} banked`;
    if (statusBits.dailyReady || statusBits.freeOk) return 'Free Spin';
    return `Free in ${formatCountdown(statusBits.dailySecs)}`;
  }, [statusBits]);

  const rewardsByTier = useMemo(() => {
    const groups = { jackpot: [], rare: [], token: [], common: [] };
    for (const w of wedges) {
      const tier = TIER_ORDER.includes(w.tier) ? w.tier : 'common';
      groups[tier].push(w);
    }
    return TIER_ORDER.map((tier) => ({
      tier,
      ...TIER_META[tier],
      items: groups[tier],
    })).filter((g) => g.items.length > 0);
  }, [wedges]);

  const spin = async (payWith) => {
    if (spinLock.current || spinning) return;
    spinLock.current = true;
    setSpinning(true);
    setLastPrize(null);
    try {
      const res = await api.post('/casino/wheel/spin', { pay_with: payWith });
      const data = res.data || {};
      const idx = Number(data.segment_index);
      if (!Number.isFinite(idx) || idx < 0 || idx >= n) {
        throw new Error('Bad spin result');
      }
      const segmentCenter = idx * slice + slice / 2;
      const current = rotation % 360;
      const spins = 5;
      const targetMod = (360 - segmentCenter) % 360;
      let delta = targetMod - (current < 0 ? current + 360 : current);
      if (delta <= 0) delta += 360;
      const nextRot = rotation + spins * 360 + delta;
      setRotation(nextRot);

      setConfig((prev) => ({
        ...(prev || {}),
        ...data,
        wedges: prev?.wedges || data.wedges || wedges,
      }));
      setFreeSecs(data.free_seconds_remaining ?? null);

      if (resultTimer.current) clearTimeout(resultTimer.current);
      resultTimer.current = setTimeout(() => {
        setLastPrize(data);
        toast.success(data.prize_label ? `You won ${data.prize_label}!` : 'Spin complete');
        setSpinning(false);
        spinLock.current = false;
        refreshUser();
        loadConfig();
      }, 4800);
    } catch (e) {
      setSpinning(false);
      spinLock.current = false;
      toast.error(getApiErrorMessage(e) || 'Spin failed');
      loadConfig();
    }
  };

  const cx = 200;
  const cy = 200;
  const r = 190;

  return (
    <div
      className={`space-y-3 sm:space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(7.5rem+env(safe-area-inset-bottom))]`}
      data-testid="wheel-of-fortune-page"
    >
      <style>{WHEEL_STYLES}</style>

      <div className="wof-fade px-0.5">
        <p className="text-[9px] text-amber-600/70 font-heading uppercase tracking-[0.28em] mb-0.5">The House</p>
        <h1 className="text-lg sm:text-2xl font-heading font-bold text-amber-200 tracking-wider uppercase">Wheel of Fortune</h1>
        <p className="wof-intro text-[10px] sm:text-[11px] text-zinc-500 font-heading mt-1 max-w-xl">
          Free spin every 24h · banked spins from £10 store spend · 3 paid/day (100 pts or 300 respect)
        </p>
      </div>

      {loading ? (
        <div className={`${styles.panel} rounded-lg border border-amber-900/40 p-8 text-center text-zinc-500 text-sm`}>
          Loading the wheel…
        </div>
      ) : (
        <>
          <div className={`${styles.panel} rounded-lg border border-amber-900/40 overflow-hidden wof-fade mobile-panel`}>
            <div className="relative flex flex-col items-center px-1.5 pt-5 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
              <div className="wof-pointer absolute top-1.5 sm:top-2 z-20" aria-hidden>
                <div
                  className="w-0 h-0 mx-auto"
                  style={{
                    borderLeft: '9px solid transparent',
                    borderRight: '9px solid transparent',
                    borderTop: '16px solid #e8c547',
                  }}
                />
              </div>

              <div className="wof-wheel-wrap relative w-[min(100%,min(88vw,360px))] sm:w-[min(92vw,420px)] aspect-square max-w-full">
                <svg
                  viewBox="0 0 400 400"
                  className="wof-wheel w-full h-full rounded-full"
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    boxShadow: '0 0 0 5px #2a1a0c, 0 0 0 7px #c9a227, 0 12px 32px rgba(0,0,0,0.55)',
                  }}
                >
                  <defs>
                    <filter id="wofInner" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.35" />
                    </filter>
                  </defs>
                  {wedges.map((w, i) => {
                    const start = i * slice;
                    const end = (i + 1) * slice;
                    const mid = start + slice / 2;
                    const highlight = w.tier === 'jackpot' || w.tier === 'rare';
                    // Farther out = longer usable label length along the ray
                    const labelR = highlight ? r * 0.62 : r * 0.74;
                    const fill = w.color || TIER_FALLBACK[w.tier] || TIER_FALLBACK.common;
                    const text = shortLabel(w);
                    const fontSize = highlight ? 6.8 : n > 32 ? 4.4 : 5;
                    const textFill =
                      w.tier === 'jackpot'
                        ? String(fill).toLowerCase() === '#9b59b6'
                          ? '#f6eefe'
                          : '#1a1208'
                        : w.tier === 'rare'
                          ? '#06140e'
                          : '#f0e2c4';
                    // Left/bottom half: flip so letters aren't upside-down for the viewer
                    const flip = mid > 90 && mid < 270;
                    // Rotate wedge to "top", then turn text so it runs along the ray (hub ↔ rim)
                    const textRot = flip ? 90 : -90;
                    return (
                      <g key={w.id || i}>
                        <path
                          d={wedgePath(cx, cy, r, start, end)}
                          fill={fill}
                          stroke="rgba(201,162,39,0.28)"
                          strokeWidth="0.7"
                        />
                        {text ? (
                          <g transform={`rotate(${mid} ${cx} ${cy})`}>
                            <text
                              className="wof-label"
                              x={cx}
                              y={cy - labelR}
                              fill={textFill}
                              fontSize={fontSize}
                              fontWeight={highlight ? 800 : 650}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              transform={`rotate(${textRot} ${cx} ${cy - labelR})`}
                              style={{ pointerEvents: 'none', letterSpacing: '0.04em' }}
                            >
                              {text}
                            </text>
                          </g>
                        ) : null}
                      </g>
                    );
                  })}
                  <circle cx={cx} cy={cy} r={34} className="wof-hub" fill="#1a1008" stroke="#c9a227" strokeWidth="3" />
                  <text x={cx} y={cy - 3} textAnchor="middle" fill="#e8c547" fontSize="10" fontWeight="800" letterSpacing="0.14em">
                    SPIN
                  </text>
                  <text x={cx} y={cy + 9} textAnchor="middle" fill="#a89060" fontSize="6.5" letterSpacing="0.18em">
                    FORTUNE
                  </text>
                </svg>
              </div>

              {lastPrize && (
                <div
                  className={`mt-3 sm:mt-4 w-full max-w-md rounded-lg border border-amber-700/50 bg-black/40 px-3 py-2.5 sm:px-4 sm:py-3 text-center ${
                    lastPrize.tier === 'jackpot' || lastPrize.tier === 'rare' ? 'wof-jackpot-glow' : ''
                  }`}
                  data-testid="wheel-last-prize"
                >
                  <p className="text-[9px] uppercase tracking-[0.2em] text-amber-600/80 font-heading">Result</p>
                  <p className="text-amber-100 font-heading font-bold text-sm sm:text-lg mt-0.5">{lastPrize.prize_label}</p>
                </div>
              )}

              <div className="mt-3 sm:mt-4 w-full max-w-md rounded-lg border border-amber-900/45 bg-black/35 overflow-hidden" data-testid="wheel-recent-wins">
                <div className="px-3 py-2 border-b border-amber-900/35 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-500/90 shrink-0" aria-hidden />
                  <p className="text-[10px] sm:text-[11px] font-heading font-bold uppercase tracking-wider text-amber-200">
                    Last 5 wins
                  </p>
                  <span className="ml-auto text-[9px] text-zinc-600 font-heading">Game-wide</span>
                </div>
                {recentWins.length === 0 ? (
                  <p className="px-3 py-3 text-[11px] text-zinc-500 font-heading text-center">No spins yet — be the first.</p>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {recentWins.slice(0, 5).map((win, idx) => {
                      const name = String(win.username || '?');
                      const tier = String(win.tier || 'common');
                      const tierCls =
                        tier === 'jackpot'
                          ? 'text-amber-300'
                          : tier === 'rare'
                            ? 'text-emerald-300'
                            : 'text-zinc-200';
                      return (
                        <li key={`${win.at || ''}-${name}-${idx}`} className="px-3 py-2 flex items-start gap-2 min-w-0">
                          <div className="flex-1 min-w-0">
                            <Link
                              to={`/profile/${encodeURIComponent(name)}`}
                              className="text-[11px] sm:text-xs font-heading font-bold text-primary hover:underline truncate inline-block max-w-full"
                            >
                              {name}
                            </Link>
                            <p className={`text-[11px] sm:text-xs font-heading font-semibold mt-0.5 truncate ${tierCls}`}>
                              {win.prize_label || 'prize'}
                            </p>
                          </div>
                          <span className="shrink-0 text-[9px] text-zinc-600 font-heading tabular-nums pt-0.5">
                            {formatWinAge(win.at)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <details
                className="wof-rewards mt-3 sm:mt-4 w-full max-w-md rounded-lg border border-amber-900/50 bg-black/35 overflow-hidden"
                data-testid="wheel-rewards-dropdown"
              >
                <summary className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 select-none hover:bg-amber-950/25">
                  <span className="text-[11px] sm:text-xs font-heading font-bold uppercase tracking-wider text-amber-200">
                    View all rewards
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-heading">
                    {wedges.length} prizes
                    <ChevronDown className="wof-chevron w-4 h-4 text-amber-500/80" aria-hidden />
                  </span>
                </summary>
                <div className="border-t border-amber-900/40 px-2.5 py-2.5 sm:px-3 sm:py-3 space-y-3 max-h-[min(50vh,22rem)] overflow-y-auto overscroll-contain">
                  {rewardsByTier.map((group) => (
                    <div key={group.tier}>
                      <div className="flex items-baseline justify-between gap-2 mb-1.5 px-0.5">
                        <p className={`text-[10px] font-heading font-bold uppercase tracking-wider ${group.titleCls}`}>
                          {group.title}
                        </p>
                        <p className="text-[9px] text-zinc-600 font-heading">{group.hint}</p>
                      </div>
                      <ul className="space-y-1">
                        {group.items.map((w) => (
                          <li
                            key={w.id || w.index}
                            className={`flex items-center gap-2 rounded border bg-black/25 px-2 py-1.5 ${group.rowCls}`}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/40"
                              style={{ background: w.color || TIER_FALLBACK[w.tier] || TIER_FALLBACK.common }}
                              aria-hidden
                            />
                            <span className="flex-1 min-w-0 text-[11px] sm:text-xs font-heading text-zinc-100 truncate">
                              {w.label}
                            </span>
                            {w.short ? (
                              <span className="shrink-0 text-[9px] font-heading uppercase tracking-wide text-zinc-500 tabular-nums">
                                {w.short}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>

          <div className={`${styles.panel} rounded-lg border border-amber-900/40 p-2.5 sm:p-4 wof-fade mobile-panel space-y-2.5 sm:space-y-3`}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 sm:gap-2 text-[10px] font-heading">
              <div className="rounded border border-white/5 bg-black/30 px-2 py-1.5 sm:py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1 text-[8px] sm:text-[10px]">
                  <Clock className="w-3 h-3 shrink-0" /> Daily
                </p>
                <p className="text-amber-100 mt-0.5 font-bold tabular-nums text-[11px] sm:text-[12px]">
                  {statusBits?.adminUnlimited
                    ? 'Unlimited'
                    : statusBits?.dailyReady || (statusBits?.dailySecs != null && statusBits.dailySecs <= 0)
                      ? 'Ready'
                      : formatCountdown(statusBits?.dailySecs)}
                </p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 px-2 py-1.5 sm:py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1 text-[8px] sm:text-[10px]">
                  <Gift className="w-3 h-3 shrink-0" /> Store
                </p>
                <p className="text-amber-100 mt-0.5 font-bold tabular-nums text-[11px] sm:text-[12px]">
                  {statusBits?.bonus ?? 0} banked
                </p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 px-2 py-1.5 sm:py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1 text-[8px] sm:text-[10px]">
                  <Zap className="w-3 h-3 shrink-0" /> Paid
                </p>
                <p className="text-amber-100 mt-0.5 font-bold tabular-nums text-[11px] sm:text-[12px]">
                  {statusBits?.adminUnlimited
                    ? 'No cap'
                    : `${statusBits?.paidLeft ?? 0}/${config?.paid_spins_per_day ?? 3}`}
                </p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 px-2 py-1.5 sm:py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1 text-[8px] sm:text-[10px]">
                  <Sparkles className="w-3 h-3 shrink-0" /> Points
                </p>
                <p className="text-amber-100 mt-0.5 font-bold tabular-nums text-[11px] sm:text-[12px]">
                  {(statusBits?.points ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 px-2 py-1.5 sm:py-2 col-span-2 sm:col-span-1">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1 text-[8px] sm:text-[10px]">
                  <CircleDollarSign className="w-3 h-3 shrink-0" /> Respect
                </p>
                <p className="text-amber-100 mt-0.5 font-bold tabular-nums text-[11px] sm:text-[12px]">
                  {(statusBits?.respect ?? 0).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                data-testid="wheel-spin-free"
                className="wof-btn w-full rounded-lg border-2 border-amber-500/70 bg-gradient-to-b from-amber-700/50 to-black/70 px-3 py-2.5 text-amber-50 font-heading font-bold uppercase tracking-wider text-xs sm:text-sm"
                disabled={spinning || !statusBits?.freeOk}
                onClick={() => spin('free')}
              >
                {freeButtonLabel}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="wheel-spin-points"
                  className="wof-btn rounded-lg border border-primary/40 bg-primary/15 px-2 py-2.5 text-primary font-heading font-bold uppercase tracking-wider text-xs sm:text-sm flex items-center justify-center gap-1.5"
                  disabled={
                    spinning ||
                    (statusBits?.paidLeft ?? 0) <= 0 ||
                    (statusBits?.points ?? 0) < (statusBits?.ptsCost ?? 100)
                  }
                  onClick={() => spin('points')}
                >
                  <CircleDollarSign className="w-3.5 h-3.5 shrink-0" />
                  {statusBits?.ptsCost ?? 100} PTS
                </button>
                <button
                  type="button"
                  data-testid="wheel-spin-respect"
                  className="wof-btn rounded-lg border border-violet-500/40 bg-violet-950/40 px-2 py-2.5 text-violet-200 font-heading font-bold uppercase tracking-wider text-xs sm:text-sm"
                  disabled={
                    spinning ||
                    (statusBits?.paidLeft ?? 0) <= 0 ||
                    (statusBits?.respect ?? 0) < (statusBits?.respCost ?? 300)
                  }
                  onClick={() => spin('respect')}
                >
                  {statusBits?.respCost ?? 300} Respect
                </button>
              </div>
            </div>

            <p className="text-[9px] sm:text-[10px] text-zinc-500 text-center font-heading leading-relaxed px-1">
              Open <span className="text-amber-600/90">View all rewards</span> under the wheel for full prize names.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
