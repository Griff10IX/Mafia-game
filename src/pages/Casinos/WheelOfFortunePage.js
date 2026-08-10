import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleDollarSign, Clock, Gift, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';
import api, { getApiErrorMessage, refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const WHEEL_STYLES = `
  .wof-fade { animation: wof-fade 0.4s ease-out both; }
  @keyframes wof-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .wof-pointer {
    filter: drop-shadow(0 4px 8px rgba(0,0,0,0.55));
  }
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
  .wof-btn { touch-action: manipulation; transition: transform 0.15s ease, opacity 0.15s ease; }
  .wof-btn:active:not(:disabled) { transform: scale(0.97); }
  .wof-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .wof-jackpot-glow {
    box-shadow: 0 0 0 1px rgba(255,215,0,0.35), 0 0 18px rgba(255,185,0,0.2);
  }
`;

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
    const dailyReady = !!config.daily_free_available || (freeSecs != null && freeSecs <= 0);
    const freeOk = !!config.free_available || dailyReady || bonus > 0;
    return {
      freeOk,
      bonus,
      paidLeft: Number(config.paid_spins_remaining_today ?? 0),
      ptsCost: Number(config.paid_cost_points ?? 100),
      respCost: Number(config.paid_cost_respect ?? 300),
      points: Number(config.points ?? 0),
      respect: Number(config.respect_points ?? 0),
    };
  }, [config, freeSecs]);

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
      // Align segment center with pointer at top (0°). SVG wedges start at -90° visually via polar().
      const segmentCenter = idx * slice + slice / 2;
      const current = rotation % 360;
      const spins = 5;
      const targetMod = (360 - segmentCenter) % 360;
      let delta = targetMod - (current < 0 ? current + 360 : current);
      if (delta <= 0) delta += 360;
      const nextRot = rotation + spins * 360 + delta;
      setRotation(nextRot);

      // Sync status fields from response during spin
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
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(8rem+env(safe-area-inset-bottom))]`} data-testid="wheel-of-fortune-page">
      <style>{WHEEL_STYLES}</style>

      <div className="wof-fade">
        <p className="text-[9px] text-amber-600/70 font-heading uppercase tracking-[0.28em] mb-1">The House</p>
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-amber-200 tracking-wider uppercase">Wheel of Fortune</h1>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">
          One free spin every 24h. Store GBP: +1 free spin per whole £10 (banked). Up to 3 paid spins per day — 100 pts or 300 respect each.
        </p>
      </div>

      {loading ? (
        <div className={`${styles.panel} rounded-lg border border-amber-900/40 p-8 text-center text-zinc-500 text-sm`}>Loading the wheel…</div>
      ) : (
        <>
          <div className={`${styles.panel} rounded-lg border border-amber-900/40 overflow-hidden wof-fade mobile-panel`}>
            <div className="relative flex flex-col items-center px-2 pt-6 pb-4 sm:px-6">
              {/* Pointer */}
              <div className="wof-pointer absolute top-2 z-20" aria-hidden>
                <div
                  className="w-0 h-0 mx-auto"
                  style={{
                    borderLeft: '10px solid transparent',
                    borderRight: '10px solid transparent',
                    borderTop: '18px solid #e8c547',
                  }}
                />
              </div>

              <div className="wof-wheel-wrap relative w-[min(92vw,420px)] aspect-square max-w-full">
                <svg
                  viewBox="0 0 400 400"
                  className="wof-wheel w-full h-full rounded-full"
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    boxShadow: '0 0 0 6px #2a1a0c, 0 0 0 8px #c9a227, 0 16px 40px rgba(0,0,0,0.55)',
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
                    const [tx, ty] = polar(cx, cy, r * 0.68, mid);
                    const jackpot = w.tier === 'jackpot';
                    return (
                      <g key={w.id || i}>
                        <path
                          d={wedgePath(cx, cy, r, start, end)}
                          fill={w.color || '#2a1810'}
                          stroke="rgba(201,162,39,0.35)"
                          strokeWidth="0.8"
                        />
                        <text
                          x={tx}
                          y={ty}
                          fill={jackpot ? '#FFD700' : '#f3e6c8'}
                          fontSize={n > 28 ? 7.5 : 9}
                          fontWeight={jackpot ? 700 : 600}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          transform={`rotate(${mid}, ${tx}, ${ty})`}
                          style={{ pointerEvents: 'none', letterSpacing: '0.02em' }}
                        >
                          {w.short || w.label}
                        </text>
                      </g>
                    );
                  })}
                  <circle cx={cx} cy={cy} r={36} className="wof-hub" fill="#1a1008" stroke="#c9a227" strokeWidth="3" />
                  <text x={cx} y={cy - 4} textAnchor="middle" fill="#e8c547" fontSize="11" fontWeight="800" letterSpacing="0.12em">
                    SPIN
                  </text>
                  <text x={cx} y={cy + 10} textAnchor="middle" fill="#a89060" fontSize="7" letterSpacing="0.2em">
                    FORTUNE
                  </text>
                </svg>
              </div>

              {lastPrize && (
                <div
                  className={`mt-4 w-full max-w-md rounded-lg border border-amber-700/50 bg-black/40 px-4 py-3 text-center ${
                    lastPrize.tier === 'jackpot' ? 'wof-jackpot-glow' : ''
                  }`}
                  data-testid="wheel-last-prize"
                >
                  <p className="text-[9px] uppercase tracking-[0.2em] text-amber-600/80 font-heading">Result</p>
                  <p className="text-amber-100 font-heading font-bold text-base sm:text-lg mt-0.5">{lastPrize.prize_label}</p>
                </div>
              )}
            </div>
          </div>

          <div className={`${styles.panel} rounded-lg border border-amber-900/40 p-3 sm:p-4 wof-fade mobile-panel space-y-3`}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] font-heading">
              <div className="rounded border border-white/5 bg-black/30 px-2 py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1"><Clock className="w-3 h-3" /> Daily</p>
                <p className="text-amber-100 mt-0.5 font-bold">
                  {config?.daily_free_available || (freeSecs != null && freeSecs <= 0)
                    ? 'Ready'
                    : formatCountdown(freeSecs ?? config?.free_seconds_remaining)}
                </p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 px-2 py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1"><Gift className="w-3 h-3" /> Store</p>
                <p className="text-amber-100 mt-0.5 font-bold">{statusBits?.bonus ?? 0} banked</p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 px-2 py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1"><Zap className="w-3 h-3" /> Paid today</p>
                <p className="text-amber-100 mt-0.5 font-bold">
                  {statusBits?.paidLeft ?? 0} / {config?.paid_spins_per_day ?? 3} left
                </p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 px-2 py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1"><Sparkles className="w-3 h-3" /> Points</p>
                <p className="text-amber-100 mt-0.5 font-bold">{(statusBits?.points ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded border border-white/5 bg-black/30 px-2 py-2">
                <p className="text-zinc-500 uppercase tracking-wider flex items-center gap-1"><CircleDollarSign className="w-3 h-3" /> Respect</p>
                <p className="text-amber-100 mt-0.5 font-bold">{(statusBits?.respect ?? 0).toLocaleString()}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                data-testid="wheel-spin-free"
                className={`wof-btn flex-1 rounded-lg border-2 border-amber-600/60 bg-gradient-to-b from-amber-800/40 to-black/60 px-4 py-3 text-amber-100 font-heading font-bold uppercase tracking-wider text-sm`}
                disabled={spinning || !statusBits?.freeOk}
                onClick={() => spin('free')}
              >
                Free Spin{statusBits?.bonus > 0 ? ` (${statusBits.bonus})` : ''}
              </button>
              <button
                type="button"
                data-testid="wheel-spin-points"
                className="wof-btn flex-1 rounded-lg border border-primary/40 bg-primary/15 px-4 py-3 text-primary font-heading font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2"
                disabled={spinning || (statusBits?.paidLeft ?? 0) <= 0 || (statusBits?.points ?? 0) < (statusBits?.ptsCost ?? 100)}
                onClick={() => spin('points')}
              >
                <CircleDollarSign className="w-4 h-4" />
                {statusBits?.ptsCost ?? 100} PTS
              </button>
              <button
                type="button"
                data-testid="wheel-spin-respect"
                className="wof-btn flex-1 rounded-lg border border-violet-500/40 bg-violet-950/40 px-4 py-3 text-violet-200 font-heading font-bold uppercase tracking-wider text-sm"
                disabled={spinning || (statusBits?.paidLeft ?? 0) <= 0 || (statusBits?.respect ?? 0) < (statusBits?.respCost ?? 300)}
                onClick={() => spin('respect')}
              >
                {statusBits?.respCost ?? 300} Respect
              </button>
            </div>
            <p className="text-[9px] text-zinc-500 text-center font-heading">
              Jackpots: 2,500 points · 1,000 loot · Mission Skip. Rare: free robot hire · $5B cash. Bullets 1k–5k. Other loot max 5. Tokens pay 3×.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
