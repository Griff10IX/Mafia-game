import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { MapPin, Sparkles, Ticket } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const KENO_STYLES = `
  .keno-fade-in { animation: keno-fade-in 0.45s ease-out both; }
  @keyframes keno-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes keno-line-shimmer {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  .keno-title-shine {
    background: linear-gradient(105deg, var(--noir-primary-dark) 0%, var(--noir-primary-bright) 35%, #fff8e1 48%, var(--noir-primary-bright) 58%, var(--noir-primary-dark) 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: keno-line-shimmer 8s ease-in-out infinite alternate;
  }
  /* Avoid animating box-shadow on the whole board (was very janky during draw). */
  .keno-board-loading-overlay {
    pointer-events: auto;
    position: absolute;
    inset: 0;
    z-index: 10;
    border-radius: 0.75rem;
    background: rgba(0,0,0,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  @keyframes keno-ball-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .keno-ball { animation: keno-ball-in 0.2s ease-out both; }
  /* Static glow only — infinite per-cell box-shadow animation was costly. */
  .keno-cell-hit {
    box-shadow: 0 0 0 1px rgba(52,211,153,0.55), 0 0 12px rgba(52,211,153,0.28);
  }
  .keno-touch { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .keno-board-grid {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 4px;
  }
  .keno-cell-btn {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
  }
  /* Desktop: fixed row height — avoid aspect-square (height tracked column width and cells became huge on wide screens). */
  @media (min-width: 640px) {
    .keno-board-grid {
      gap: 4px;
      grid-auto-rows: 1.8125rem;
    }
    .keno-cell-btn {
      font-size: 10px;
      border-radius: 4px;
    }
  }
  @media (min-width: 1024px) {
    .keno-board-grid {
      grid-auto-rows: 1.6875rem;
      gap: 3px;
    }
    .keno-cell-btn {
      font-size: 9px;
    }
  }
  @media (max-width: 639px) {
    .keno-board-grid {
      gap: 3px;
      grid-auto-rows: auto;
    }
    .keno-cell-btn {
      aspect-ratio: 1;
      min-height: 40px;
      font-size: 10px;
      border-radius: 6px;
    }
  }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const BOARD = Array.from({ length: 80 }, (_, i) => i + 1);

function PickDots({ count, max }) {
  return (
    <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap max-w-[11rem] sm:max-w-none" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full transition-all duration-300 shrink-0 ${
            i < count ? 'bg-primary scale-110 shadow-[0_0_6px_rgba(212,175,55,0.5)]' : 'bg-zinc-800 border border-zinc-700/80'
          }`}
        />
      ))}
    </div>
  );
}

export default function KenoPage() {
  const [config, setConfig] = useState({
    states: [],
    current_state: '',
    min_pick: 2,
    max_pick: 10,
    max_bet: 5_000_000,
    draw_count: 20,
    paytable: {},
    state_owned: true,
  });
  const [selected, setSelected] = useState(() => new Set());
  const [bet, setBet] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [lastRound, setLastRound] = useState(null);
  const [paytableOpen, setPaytableOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
  );
  const roundKeyRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const sync = () => setPaytableOpen(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const fetchConfig = useCallback(() => {
    api
      .get('/casino/keno/config')
      .then((r) => {
        const d = r.data || {};
        setConfig((prev) => ({
          ...prev,
          ...d,
          states: d.states || prev.states,
          paytable: d.paytable || prev.paytable,
        }));
      })
      .catch(() => toast.error('Could not load Keno config'));
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const minPick = config.min_pick ?? 2;
  const maxPick = config.max_pick ?? 10;
  const maxBet = config.max_bet ?? 5_000_000;

  const toggle = (n) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else if (next.size < maxPick) next.add(n);
      else toast.message(`At most ${maxPick} numbers`);
      return next;
    });
  };

  const clearBoard = () => {
    setSelected(new Set());
    setLastRound(null);
  };

  const quickPick = () => {
    const count = Math.min(maxPick, Math.max(minPick, 5));
    const pool = [...BOARD];
    const next = new Set();
    for (let i = 0; i < count; i += 1) {
      const j = Math.floor(Math.random() * pool.length);
      next.add(pool.splice(j, 1)[0]);
    }
    setSelected(next);
    setLastRound(null);
    toast.success(`Quick pick: ${count} numbers`);
  };

  const betNum = parseInt(String(bet || '').replace(/\D/g, ''), 10) || 0;
  const picksArr = useMemo(() => Array.from(selected).sort((a, b) => a - b), [selected]);
  const canPlay =
    picksArr.length >= minPick &&
    picksArr.length <= maxPick &&
    betNum >= 1 &&
    betNum <= maxBet &&
    !loading;

  const play = async () => {
    if (!canPlay) {
      if (picksArr.length < minPick) toast.error(`Pick at least ${minPick} numbers`);
      else if (betNum < 1) toast.error('Enter a bet');
      else if (betNum > maxBet) toast.error(`Max bet is ${formatMoney(maxBet)}`);
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/casino/keno/play', { bet: betNum, picks: picksArr });
      const d = res.data || {};
      roundKeyRef.current += 1;
      setLastRound({
        drawn: d.drawn || [],
        hits: d.hits ?? 0,
        payout: d.payout ?? 0,
        won: !!d.won,
        picks: d.picks || picksArr,
        bet: d.bet ?? betNum,
      });
      requestAnimationFrame(() => {
        refreshUser();
      });
      if (d.won) toast.success(`Hit ${d.hits}! Paid ${formatMoney(d.payout)}`);
      else toast.message(`Draw complete · ${d.hits} hits · no payout`);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Play failed');
    } finally {
      setLoading(false);
    }
  };

  const drawnSet = lastRound?.drawn?.length ? new Set(lastRound.drawn) : null;
  const hitSet =
    lastRound?.picks?.length && drawnSet
      ? new Set(lastRound.picks.filter((p) => drawnSet.has(p)))
      : null;

  const roundAnimKey = lastRound ? roundKeyRef.current : 0;

  return (
    <div
      className={`space-y-3 sm:space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden pb-24 md:pb-0`}
      data-testid="keno-page"
    >
      <style>{KENO_STYLES}</style>
      <div className="relative keno-fade-in space-y-3 sm:space-y-4 px-0.5 sm:px-0">
        {/* Top accent */}
        <div
          className="h-px w-full max-w-md rounded-full opacity-80"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(212,175,55,0.5), rgba(230,194,41,0.85), rgba(212,175,55,0.5), transparent)',
          }}
        />

        <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3 sm:gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading italic flex items-start gap-1.5 tracking-wide leading-snug">
              <MapPin size={12} className="text-primary shrink-0 mt-0.5" />
              <span>
                State table · <span className="text-primary font-bold not-italic">{config.current_state || '—'}</span>
                <span className="text-zinc-600 hidden min-[400px]:inline"> · 20 from 80</span>
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Ticket size={22} className="text-primary/70 hidden sm:block" strokeWidth={1.5} />
              <h1 className="text-xl sm:text-3xl font-heading font-black uppercase tracking-[0.1em] sm:tracking-[0.12em] keno-title-shine">
                Keno
              </h1>
            </div>
            <p className="text-[10px] sm:text-[11px] text-zinc-500 font-heading max-w-md leading-relaxed hidden sm:block">
              Mark your spots. The house draws twenty. Matches pay by the state paytable below.
            </p>
            <p className="text-[10px] text-zinc-500 font-heading leading-snug sm:hidden">
              Tap numbers, then Draw. Paytable optional — expand below.
            </p>
          </div>
          <div
            className="rounded-lg border border-primary/20 px-3 py-2 text-left sm:text-right shrink-0 w-full sm:w-auto"
            style={{
              background: 'linear-gradient(145deg, rgba(40,40,40,0.95) 0%, rgba(15,15,15,0.98) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 20px rgba(0,0,0,0.35)',
            }}
          >
            <p className="text-[9px] font-heading text-zinc-500 uppercase tracking-widest mb-1">Limits</p>
            <div className="flex flex-wrap sm:flex-col gap-x-4 gap-y-0.5 sm:gap-0">
              <p className="text-[11px] font-heading text-zinc-300">
                Max{' '}
                <span className="text-primary font-bold tabular-nums">{formatMoney(maxBet)}</span>
              </p>
              <p className="text-[11px] font-heading text-zinc-300">
                Spots{' '}
                <span className="text-primary font-bold">
                  {minPick}–{maxPick}
                </span>
              </p>
            </div>
          </div>
        </header>

        <div
          className={`${styles.panel} mobile-panel rounded-xl overflow-hidden border border-primary/25 relative`}
          style={{
            boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <div className="p-2.5 sm:p-4 space-y-3 sm:space-y-4 relative">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
              }}
            />

            <div className="relative flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="flex flex-wrap items-end gap-2 flex-1 min-w-0">
                  <label className="text-[10px] text-zinc-500 font-heading uppercase tracking-widest w-full sm:w-auto sm:inline sm:mr-1">
                    Wager
                  </label>
                  <FormattedNumberInput
                    value={bet}
                    onChange={setBet}
                    placeholder="1000"
                    className="w-full sm:w-36 min-h-[44px] sm:min-h-0 sm:min-w-[9rem] bg-zinc-950/80 border border-primary/20 rounded-md px-3 py-2.5 sm:py-2 text-base sm:text-sm font-heading text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-2 sm:ml-auto sm:justify-end">
                  <button
                    type="button"
                    onClick={quickPick}
                    disabled={loading}
                    className="keno-touch text-[10px] font-heading font-bold uppercase min-h-[44px] sm:min-h-0 px-3 py-2.5 sm:py-2 rounded-md border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-45"
                  >
                    Quick pick
                  </button>
                  <button
                    type="button"
                    onClick={clearBoard}
                    disabled={loading}
                    className="keno-touch text-[10px] font-heading font-bold uppercase min-h-[44px] sm:min-h-0 px-3 py-2.5 sm:py-2 rounded-md border border-zinc-600/80 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors disabled:opacity-45"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={play}
                    disabled={!canPlay}
                    className="keno-touch hidden md:flex text-[11px] font-heading font-black uppercase px-5 py-2.5 rounded-md items-center justify-center gap-2 min-w-[7.5rem] border transition-all disabled:opacity-35 disabled:grayscale"
                    style={{
                      borderColor: 'rgba(212,175,55,0.55)',
                      background: 'linear-gradient(180deg, rgba(212,175,55,0.28) 0%, rgba(120,90,20,0.35) 100%)',
                      boxShadow: '0 2px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
                      color: 'var(--noir-primary-bright)',
                    }}
                  >
                    <Sparkles size={16} strokeWidth={2} />
                    {loading ? 'Drawing…' : 'Draw'}
                  </button>
                </div>
              </div>
            </div>

            <div className="relative flex flex-col min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between gap-2 border-t border-primary/10 pt-2 sm:pt-3">
              <p className="text-[10px] text-zinc-500 font-heading flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                <span className="text-zinc-400 shrink-0">
                  Spots{' '}
                  <span className="text-primary font-bold tabular-nums text-sm">{picksArr.length}</span>
                  <span className="text-zinc-600">/{maxPick}</span>
                </span>
                <PickDots count={picksArr.length} max={maxPick} />
              </p>
              <p className="text-[9px] text-zinc-600 font-heading uppercase tracking-wider shrink-0">
                Play: {minPick}–{maxPick}
              </p>
            </div>

            <div className="relative rounded-xl p-1.5 sm:p-3">
              <div
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{
                  background:
                    'radial-gradient(ellipse 90% 70% at 50% 0%, rgba(212,175,55,0.1), transparent 55%), linear-gradient(180deg, rgba(30,30,30,0.4) 0%, rgba(0,0,0,0.55) 100%)',
                  border: '1px solid rgba(212,175,55,0.12)',
                }}
              />
              {loading && (
                <div className="keno-board-loading-overlay" aria-busy="true" aria-live="polite">
                  <p className="text-xs font-heading font-bold uppercase tracking-[0.35em] text-primary">
                    Drawing
                  </p>
                </div>
              )}
              <div className="mx-auto w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl">
                <div className="relative keno-board-grid">
                {BOARD.map((n) => {
                  const isOn = selected.has(n);
                  const isDrawn = drawnSet?.has(n);
                  const isHit = hitSet?.has(n);
                  const isMissPick = !!(lastRound && isOn && drawnSet && !drawnSet.has(n));
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggle(n)}
                      disabled={loading}
                      className={[
                        'keno-cell-btn keno-touch relative h-full w-full max-sm:aspect-square rounded-md font-heading font-bold tabular-nums transition-[color,background-color,border-color,opacity] duration-150 border active:scale-[0.96] disabled:cursor-not-allowed',
                        isHit
                          ? 'keno-cell-hit z-[1] bg-gradient-to-br from-emerald-600 to-emerald-800 text-white border-emerald-300/90 scale-[1.02]'
                          : isDrawn && !isOn
                            ? 'bg-gradient-to-br from-zinc-600 to-zinc-900 text-zinc-100 border-zinc-400/40 shadow-inner'
                            : isOn
                              ? 'bg-gradient-to-br from-[rgba(212,175,55,0.35)] to-[rgba(80,60,15,0.5)] text-primary border-primary/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_0_1px_rgba(212,175,55,0.15)]'
                              : 'bg-zinc-950/80 text-zinc-500 border-zinc-800/90 hover:border-primary/35 hover:text-zinc-200 hover:bg-zinc-900/90',
                        isMissPick ? 'opacity-45 saturate-50' : '',
                      ].join(' ')}
                    >
                      <span className="relative z-[1]">{n}</span>
                      {!isHit && isDrawn && (
                        <span
                          className="absolute inset-0.5 rounded-md opacity-30 pointer-events-none"
                          style={{
                            background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.25), transparent 55%)',
                          }}
                        />
                      )}
                    </button>
                  );
                })}
                </div>
              </div>
            </div>

            {lastRound && (
              <div
                className="relative rounded-xl border border-primary/20 overflow-hidden"
                style={{
                  background: 'linear-gradient(165deg, rgba(35,35,35,0.95) 0%, rgba(10,10,12,0.98) 100%)',
                }}
              >
                <div
                  className={`px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b ${
                    lastRound.won ? 'border-emerald-500/25 bg-emerald-950/25' : 'border-primary/10 bg-primary/5'
                  }`}
                >
                  <p className="text-[10px] font-heading text-primary uppercase tracking-[0.2em]">Last draw</p>
                  {lastRound.won ? (
                    <span className="text-[10px] font-heading font-black uppercase text-emerald-400 tracking-wider">
                      Winner
                    </span>
                  ) : (
                    <span className="text-[10px] font-heading text-zinc-500 uppercase tracking-wider">No payout</span>
                  )}
                </div>
                <div className="p-3 space-y-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-heading">
                    <span className="text-zinc-400">
                      Hits{' '}
                      <span
                        className={`font-black tabular-nums text-base ${lastRound.won ? 'text-emerald-400' : 'text-zinc-200'}`}
                      >
                        {lastRound.hits}
                      </span>
                    </span>
                    <span className="text-zinc-500">|</span>
                    <span className="text-zinc-400">
                      Stake <span className="text-zinc-200 font-bold tabular-nums">{formatMoney(lastRound.bet)}</span>
                    </span>
                    <span className="text-zinc-500">|</span>
                    <span className="text-zinc-400">
                      Return{' '}
                      <span
                        className={`font-bold tabular-nums ${lastRound.won ? 'text-primary' : 'text-zinc-500'}`}
                      >
                        {formatMoney(lastRound.payout)}
                      </span>
                    </span>
                  </div>
                  <div>
                    <p className="text-[9px] font-heading text-zinc-600 uppercase tracking-widest mb-2">
                      {config.draw_count ?? 20} balls
                    </p>
                    <div className="flex flex-wrap gap-1 sm:gap-1.5 justify-start">
                      {(lastRound.drawn || []).map((x) => (
                        <span
                          key={`${roundAnimKey}-${x}`}
                          className={`keno-ball inline-flex min-w-[1.75rem] sm:min-w-[2rem] h-7 sm:h-8 items-center justify-center rounded-full text-[10px] sm:text-[11px] font-heading font-black tabular-nums border-2 ${
                            hitSet?.has(x)
                              ? 'border-emerald-400 bg-gradient-to-b from-emerald-500 to-emerald-800 text-white shadow-[0_2px_8px_rgba(16,185,129,0.35)]'
                              : 'border-zinc-500 bg-gradient-to-b from-zinc-500 to-zinc-900 text-zinc-100 shadow-[inset_0_2px_4px_rgba(255,255,255,0.12)]'
                          }`}
                        >
                          {x}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          className={`${styles.panel} mobile-panel rounded-xl border border-primary/20 overflow-hidden`}
          style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
        >
          <button
            type="button"
            className="keno-touch w-full sm:cursor-default px-3 py-2.5 sm:py-2 bg-gradient-to-r from-primary/12 via-primary/6 to-transparent border-b border-primary/15 flex items-center justify-between gap-2 text-left sm:pointer-events-none"
            onClick={() => setPaytableOpen((o) => !o)}
            aria-expanded={paytableOpen}
          >
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.2em]">
              State paytable
            </h2>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-[9px] text-zinc-500 font-heading hidden sm:inline">× bet (before skim)</span>
              <span className="text-[10px] font-heading text-primary/80 sm:hidden">{paytableOpen ? 'Hide' : 'Show'}</span>
            </span>
          </button>
          <div
            className={`p-0 overflow-y-auto transition-[max-height] duration-200 ease-out sm:max-h-52 ${
              paytableOpen ? 'max-h-[min(55vh,28rem)] border-t border-primary/5' : 'max-h-0 sm:max-h-52'
            }`}
          >
            {Object.keys(config.paytable || {})
              .map(Number)
              .sort((a, b) => a - b)
              .map((n, idx) => (
                <div
                  key={n}
                  className={`flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 px-3 py-2.5 sm:py-2 border-b border-zinc-800/60 font-heading text-[10px] sm:text-[11px] transition-colors hover:bg-primary/[0.04] ${
                    idx % 2 === 0 ? 'bg-black/10' : ''
                  }`}
                >
                  <span className="text-primary font-bold shrink-0 w-20 uppercase tracking-wide">{n} spots</span>
                  <span className="text-zinc-400 leading-relaxed">
                    {Object.entries(config.paytable[String(n)] || {})
                      .map(([hits, mult]) => (
                        <span key={hits} className="inline mr-2 last:mr-0">
                          <span className="text-zinc-600">{hits} hit{Number(hits) === 1 ? '' : 's'}:</span>{' '}
                          <span className="text-zinc-200 font-semibold tabular-nums">{mult}×</span>
                        </span>
                      ))}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* Mobile: thumb-reach primary action + safe area */}
        <div
          className="keno-touch fixed bottom-0 left-0 right-0 z-30 md:hidden border-t border-primary/30 bg-zinc-950/95 backdrop-blur-md px-3 pt-2 shadow-[0_-12px_40px_rgba(0,0,0,0.55)]"
          style={{ paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom, 12px))' }}
        >
          <div className="flex items-center gap-3 max-w-lg mx-auto">
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider">Ready</p>
              <p className="text-[11px] font-heading text-zinc-200 truncate tabular-nums">
                <span className="text-primary font-bold">{picksArr.length}</span>
                <span className="text-zinc-600">/{maxPick}</span>
                <span className="text-zinc-600 mx-1">·</span>
                {formatMoney(betNum)}
              </p>
            </div>
            <button
              type="button"
              onClick={play}
              disabled={!canPlay}
              className="keno-touch shrink-0 min-h-[48px] min-w-[8.5rem] px-5 rounded-lg font-heading font-black uppercase text-xs tracking-wide border transition-all disabled:opacity-35 disabled:grayscale active:scale-[0.98]"
              style={{
                borderColor: 'rgba(212,175,55,0.55)',
                background: 'linear-gradient(180deg, rgba(212,175,55,0.32) 0%, rgba(120,90,20,0.4) 100%)',
                boxShadow: '0 2px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
                color: 'var(--noir-primary-bright)',
              }}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Sparkles size={18} strokeWidth={2} />
                {loading ? '…' : 'Draw'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
