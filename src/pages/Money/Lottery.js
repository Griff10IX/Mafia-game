import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { Ticket, Clock, Trophy, Coins, ShoppingCart, Sparkles, TrendingUp, ChevronDown, ChevronUp, ListOrdered } from 'lucide-react';
import { toast } from 'sonner';
import api, { refreshUser } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const LOT_STYLES = `
  @keyframes lot-fade-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  .lot-fade-in { animation: lot-fade-in 0.5s ease-out both; }
  .lot-delay-1 { animation-delay: 0.08s; }
  .lot-delay-2 { animation-delay: 0.16s; }
  .lot-delay-3 { animation-delay: 0.24s; }
  .lot-delay-4 { animation-delay: 0.32s; }

  @keyframes lot-glow-pulse {
    0%, 100% { filter: drop-shadow(0 0 6px rgba(var(--noir-primary-rgb), 0.4)); }
    50% { filter: drop-shadow(0 0 18px rgba(var(--noir-primary-rgb), 0.7)); }
  }
  .lot-glow { animation: lot-glow-pulse 2.5s ease-in-out infinite; }

  @keyframes lot-jackpot-shine {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }

  @keyframes lot-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }

  @keyframes lot-ball-bob {
    0%, 100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(-4px) scale(1.05); }
  }

  @keyframes lot-countdown-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  @keyframes lot-ticket-rip {
    0% { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
    50% { clip-path: polygon(2% 1%, 98% 0, 99% 100%, 1% 99%); }
    100% { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
  }

  @keyframes lot-shimmer {
    0% { left: -30%; }
    100% { left: 130%; }
  }

  @keyframes lot-spin-slow {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .lot-jackpot-text {
    background: linear-gradient(
      90deg,
      var(--noir-primary-dark) 0%,
      var(--noir-primary-bright) 25%,
      #fff 50%,
      var(--noir-primary-bright) 75%,
      var(--noir-primary-dark) 100%
    );
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: lot-jackpot-shine 3s linear infinite;
  }

  .lot-ball {
    width: 36px; height: 36px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 11px;
    box-shadow: inset 0 -3px 6px rgba(0,0,0,0.35), inset 0 2px 4px rgba(255,255,255,0.15), 0 2px 8px rgba(0,0,0,0.4);
    user-select: none;
    font-family: var(--font-heading, inherit);
    letter-spacing: 0.02em;
  }

  .lot-ball-gold { background: linear-gradient(135deg, #e6c229 0%, #d4af37 40%, #b8860b 100%); color: #1a1a1a; }
  .lot-ball-silver { background: linear-gradient(135deg, #e0e0e0 0%, #a0a0a0 50%, #707070 100%); color: #1a1a1a; }
  .lot-ball-bronze { background: linear-gradient(135deg, #cd7f32 0%, #a0522d 50%, #8b4513 100%); color: #fff; }
  .lot-ball-red { background: linear-gradient(135deg, #ff4444 0%, #cc0000 100%); color: #fff; }
  .lot-ball-blue { background: linear-gradient(135deg, #4488ff 0%, #2255cc 100%); color: #fff; }

  .lot-hero-bg {
    background: radial-gradient(ellipse at 50% 20%, rgba(var(--noir-primary-rgb), 0.12) 0%, transparent 60%),
                radial-gradient(ellipse at 80% 80%, rgba(var(--noir-primary-rgb), 0.06) 0%, transparent 50%);
  }

  .lot-ticket-stub {
    position: relative;
    overflow: hidden;
  }
  .lot-ticket-stub::before {
    content: '';
    position: absolute;
    top: 0; bottom: 0; left: 0; right: 0;
    background: repeating-linear-gradient(
      90deg,
      transparent 0px, transparent 8px,
      rgba(var(--noir-primary-rgb), 0.03) 8px,
      rgba(var(--noir-primary-rgb), 0.03) 9px
    );
    pointer-events: none;
  }
  .lot-ticket-stub::after {
    content: '';
    position: absolute;
    top: 0; width: 20%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent);
    animation: lot-shimmer 4s ease-in-out infinite;
  }

  .lot-countdown-unit {
    display: flex; flex-direction: column; align-items: center;
    min-width: 48px;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(var(--noir-primary-rgb), 0.2);
  }
  .lot-countdown-num {
    font-size: 22px; font-weight: 800; line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--noir-primary-bright, #e6c229);
  }
  .lot-countdown-label {
    font-size: 7px; text-transform: uppercase; letter-spacing: 0.15em;
    color: var(--noir-muted, #a1a1aa);
    margin-top: 2px;
  }
  .lot-countdown-sep {
    font-size: 20px; font-weight: 700;
    color: rgba(var(--noir-primary-rgb), 0.4);
    align-self: flex-start;
    padding-top: 6px;
  }

  .lot-buy-btn {
    position: relative; overflow: hidden;
    background: linear-gradient(135deg, var(--noir-button-gradient-1), var(--noir-button-gradient-2), var(--noir-button-gradient-3));
    color: var(--noir-button-foreground, #fff);
    border: 1px solid rgba(var(--noir-primary-rgb), 0.4);
    transition: all 0.2s ease;
    box-shadow: 0 2px 12px rgba(var(--noir-primary-rgb), 0.25);
  }
  .lot-buy-btn:hover:not(:disabled) {
    box-shadow: 0 4px 20px rgba(var(--noir-primary-rgb), 0.45);
    transform: translateY(-1px);
  }
  .lot-buy-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .lot-winner-banner {
    background: linear-gradient(135deg, rgba(var(--noir-primary-rgb), 0.08) 0%, rgba(var(--noir-primary-rgb), 0.02) 100%);
    border: 1px solid rgba(var(--noir-primary-rgb), 0.25);
  }

  .lot-odds-bar {
    height: 6px; border-radius: 3px; overflow: hidden;
    background: rgba(255,255,255,0.06);
  }
  .lot-odds-fill {
    height: 100%; border-radius: 3px;
    background: linear-gradient(90deg, var(--noir-primary-dark), var(--noir-primary-bright));
    transition: width 0.6s ease-out;
  }

  /* ── Tablet (portrait iPads, landscape phones) ── */
  @media (max-width: 1024px) and (min-width: 640px) {
    .lot-countdown-unit { min-width: 52px; padding: 8px 10px; }
    .lot-countdown-num { font-size: 24px; }
  }

  /* ── Mobile phones ── */
  @media (max-width: 639px) {
    .lot-ball { width: 30px; height: 30px; font-size: 10px; }
    .lot-countdown-unit { min-width: 42px; padding: 5px 6px; }
    .lot-countdown-num { font-size: 18px; }
    .lot-countdown-sep { font-size: 16px; padding-top: 5px; }
    .lot-buy-btn {
      width: 100%;
      justify-content: center;
      padding: 14px 16px;
      font-size: 13px;
      min-height: 48px;
    }
    .lot-quick-pick-btn {
      min-width: 48px;
      min-height: 44px;
      font-size: 12px;
      padding: 8px 10px;
    }
  }

  /* ── Small phones (iPhone SE / narrow Android) ── */
  @media (max-width: 374px) {
    .lot-ball { width: 26px; height: 26px; font-size: 9px; }
    .lot-countdown-unit { min-width: 36px; padding: 4px 4px; }
    .lot-countdown-num { font-size: 15px; }
    .lot-countdown-label { font-size: 6px; }
    .lot-countdown-sep { font-size: 14px; }
  }
`;

const BALL_COLORS = ['lot-ball-gold', 'lot-ball-silver', 'lot-ball-bronze', 'lot-ball-red', 'lot-ball-blue'];

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function apiErrorDetail(e, fallback) {
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || x.loc?.join('.')).join('; ') || fallback;
  return fallback;
}

function DecorationBalls() {
  const balls = useMemo(() => {
    const nums = [];
    const seen = new Set();
    while (nums.length < 5) {
      const n = Math.floor(Math.random() * 49) + 1;
      if (!seen.has(n)) { seen.add(n); nums.push(n); }
    }
    return nums.sort((a, b) => a - b);
  }, []);

  return (
    <div className="flex items-center gap-2 justify-center">
      {balls.map((n, i) => (
        <div
          key={i}
          className={`lot-ball ${BALL_COLORS[i]}`}
          style={{ animation: `lot-ball-bob ${1.8 + i * 0.3}s ease-in-out infinite`, animationDelay: `${i * 0.15}s` }}
        >
          {n}
        </div>
      ))}
    </div>
  );
}

function CountdownTimer({ secondsLeft }) {
  const s = Math.max(0, Math.floor(secondsLeft));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const urgent = s < 3600;

  const pad = (v) => String(v).padStart(2, '0');

  return (
    <div className="flex items-center gap-1.5 justify-center flex-wrap">
      {d > 0 && (
        <>
          <div className="lot-countdown-unit">
            <span className="lot-countdown-num">{pad(d)}</span>
            <span className="lot-countdown-label">Days</span>
          </div>
          <span className="lot-countdown-sep">:</span>
        </>
      )}
      <div className="lot-countdown-unit">
        <span className="lot-countdown-num">{pad(h)}</span>
        <span className="lot-countdown-label">Hours</span>
      </div>
      <span className="lot-countdown-sep">:</span>
      <div className="lot-countdown-unit">
        <span className="lot-countdown-num">{pad(m)}</span>
        <span className="lot-countdown-label">Min</span>
      </div>
      <span className="lot-countdown-sep">:</span>
      <div className="lot-countdown-unit" style={urgent ? { borderColor: 'rgba(255,68,68,0.5)', animation: 'lot-countdown-pulse 1s ease-in-out infinite' } : undefined}>
        <span className="lot-countdown-num" style={urgent ? { color: '#ff4444' } : undefined}>{pad(sec)}</span>
        <span className="lot-countdown-label">Sec</span>
      </div>
    </div>
  );
}

const CONFIRM_THRESHOLD = 10;

function QuickPick({ onPick, ticketPrice }) {
  const presets = [1, 5, 10, 25, 50, 100];
  return (
    <div className="grid grid-cols-6 sm:flex sm:flex-wrap gap-1.5">
      {presets.map((n) => {
        const cost = (ticketPrice || 500000) * n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onPick(n)}
            title={`${n} ticket${n !== 1 ? 's' : ''} — ${formatMoney(cost)}`}
            className="lot-quick-pick-btn rounded text-[10px] font-heading font-bold uppercase tracking-wider border transition-colors flex items-center justify-center px-2.5 py-2 sm:py-1 sm:min-h-0 min-h-[44px]"
            style={{
              background: 'rgba(var(--noir-primary-rgb), 0.08)',
              borderColor: 'rgba(var(--noir-primary-rgb), 0.2)',
              color: 'var(--noir-primary)',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.18)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.08)'; }}
          >
            {n}x
          </button>
        );
      })}
    </div>
  );
}

function MyTicketsSection() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!open && !data) {
      setLoading(true);
      try {
        const { data: d } = await api.get('/lottery/my-tickets');
        setData(d);
      } catch (e) {
        toast.error(apiErrorDetail(e, 'Could not load tickets'));
      } finally {
        setLoading(false);
      }
    }
    setOpen((o) => !o);
  };

  return (
    <div className="lot-fade-in lot-delay-1">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 text-[10px] font-heading font-bold text-primary hover:text-primary/80 transition-colors py-1"
      >
        <ListOrdered size={12} />
        My Tickets
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className={`${styles.panel} rounded-md overflow-hidden mt-1`}>
          <div className="p-2.5">
            {loading ? (
              <div className="flex items-center gap-2 py-2">
                <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-[10px] text-zinc-500 font-heading">Loading tickets...</span>
              </div>
            ) : !data || data.total === 0 ? (
              <div className="text-[10px] text-zinc-500 font-heading py-1">No tickets purchased this round.</div>
            ) : (
              <div className="space-y-1.5">
                <div className="text-[10px] text-zinc-400 font-heading">
                  <span className="text-primary font-bold">{data.total}</span> ticket{data.total !== 1 ? 's' : ''} this round
                </div>
                <div className="space-y-0.5">
                  {data.purchases.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] font-heading py-0.5 border-b border-primary/5 last:border-0">
                      <span className="text-zinc-500 tabular-nums">
                        {p.purchased_at ? new Date(p.purchased_at + 'Z').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                      <span className="text-zinc-300 font-bold tabular-nums flex items-center gap-1">
                        <Ticket size={9} className="text-primary/50" />
                        {p.count} ticket{p.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Lottery() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [count, setCount] = useState(1);
  const [tick, setTick] = useState(0);
  const [confirmPending, setConfirmPending] = useState(false);
  const countRef = useRef(null);
  const confirmTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/lottery');
      setState(data);
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Could not load lottery'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (tick % 30 === 0 && tick > 0) load();
  }, [tick, load]);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const secondsLeft = Math.max(0, (state?.seconds_until_close ?? 0) - tick);

  const clearConfirm = useCallback(() => {
    setConfirmPending(false);
    clearTimeout(confirmTimer.current);
  }, []);

  const doBuy = async (n) => {
    setBuying(true);
    setConfirmPending(false);
    clearTimeout(confirmTimer.current);
    try {
      const { data } = await api.post('/lottery/buy', { count: n });
      toast.success(data?.message || 'Tickets purchased!');
      await refreshUser();
      await load();
    } catch (e) {
      toast.error(apiErrorDetail(e, 'Purchase failed'));
    } finally {
      setBuying(false);
    }
  };

  const onBuy = () => {
    const n = Math.min(500, Math.max(1, parseInt(String(count), 10) || 1));
    if (n >= CONFIRM_THRESHOLD && !confirmPending) {
      setConfirmPending(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmPending(false), 5000);
      return;
    }
    doBuy(n);
  };

  if (loading && !state) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root`}>
        <style>{LOT_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
          <div className="lot-ball lot-ball-gold lot-glow" style={{ width: 48, height: 48, fontSize: 16 }}>
            <span style={{ animation: 'lot-spin-slow 2s linear infinite', display: 'inline-block' }}>$</span>
          </div>
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.25em]">Loading lottery...</span>
        </div>
      </div>
    );
  }

  const last = state?.last_draw;
  const grossPot = Number(state?.gross_pot ?? 0);
  const taxPct = Number(state?.pot_tax_percent ?? 10);
  const netIfWon = Math.floor((grossPot * (100 - taxPct)) / 100);
  const myTickets = state?.my_tickets ?? 0;
  const totalTickets = state?.ticket_count ?? 0;
  const oddsPercent = totalTickets > 0 ? Math.min(100, (myTickets / totalTickets) * 100) : 0;
  const parsedCount = Math.min(500, Math.max(1, parseInt(String(count), 10) || 1));
  const ticketPrice = Number(state?.ticket_price) || 500000;
  const totalCost = ticketPrice * parsedCount;
  const needsConfirm = parsedCount >= CONFIRM_THRESHOLD;

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`}>
      <style>{LOT_STYLES}</style>

      {/* ── HERO / JACKPOT SECTION ── */}
      <div className="lot-hero-bg rounded-lg overflow-hidden lot-fade-in" style={{ border: '1px solid rgba(var(--noir-primary-rgb), 0.15)' }}>
        <div className="px-4 py-5 sm:py-6 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary/60" />
            <span className="text-[9px] font-heading uppercase tracking-[0.3em] text-primary/70 font-bold">City Lottery</span>
            <Sparkles size={14} className="text-primary/60" />
          </div>

          <DecorationBalls />

          <div className="space-y-1">
            <div className="text-[8px] text-zinc-500 uppercase tracking-[0.2em] font-heading">Current Jackpot</div>
            <div className="lot-jackpot-text text-3xl sm:text-4xl font-heading font-black tracking-tight lot-glow">
              {formatMoney(netIfWon)}
            </div>
            <div className="text-[10px] text-zinc-500 font-heading">
              Gross pot {formatMoney(grossPot)} &mdash; {taxPct}% tax at draw
            </div>
          </div>

          <div style={{ marginTop: 4 }}>
            <CountdownTimer secondsLeft={secondsLeft} />
            <div className="text-[8px] text-zinc-600 font-heading uppercase tracking-wider mt-1.5">
              Until next draw
              {state?.closes_at && (
                <span className="text-zinc-500">
                  {' '}({new Date(state.closes_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── STATS ROW ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lot-fade-in lot-delay-1">
        {[
          { icon: Coins, label: 'Ticket Price', value: formatMoney(state?.ticket_price), color: 'text-primary' },
          { icon: Ticket, label: 'Total Tickets', value: (totalTickets).toLocaleString(), color: 'text-zinc-300' },
          { icon: ShoppingCart, label: 'Your Tickets', value: myTickets.toLocaleString(), color: 'text-emerald-400' },
          { icon: TrendingUp, label: 'Your Odds', value: totalTickets > 0 ? `${oddsPercent < 0.01 && myTickets > 0 ? '<0.01' : oddsPercent.toFixed(2)}%` : '—', color: myTickets > 0 ? 'text-amber-400' : 'text-zinc-500' },
        ].map(({ icon: Icon, label, value, color }, i) => (
          <div
            key={label}
            className={`${styles.panel} rounded-md p-2.5 flex flex-col gap-1`}
          >
            <div className="flex items-center gap-1.5">
              <Icon size={11} className="text-primary/50" />
              <span className="text-[7px] text-zinc-500 uppercase tracking-wider font-heading font-bold">{label}</span>
            </div>
            <span className={`text-sm font-heading font-bold tabular-nums ${color}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* ── ODDS BAR (only when you have tickets) ── */}
      {myTickets > 0 && (
        <div className="lot-fade-in lot-delay-1 px-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading">Your chance of winning</span>
            <span className="text-[10px] text-primary font-heading font-bold tabular-nums">{myTickets} / {totalTickets.toLocaleString()}</span>
          </div>
          <div className="lot-odds-bar">
            <div className="lot-odds-fill" style={{ width: `${Math.max(1, oddsPercent)}%` }} />
          </div>
        </div>
      )}

      {/* ── MY TICKETS ── */}
      {myTickets > 0 && <MyTicketsSection />}

      {/* ── BUY TICKETS ── */}
      <div className={`lot-ticket-stub ${styles.panel} rounded-md overflow-hidden lot-fade-in lot-delay-2`}>
        <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ background: 'rgba(var(--noir-primary-rgb), 0.08)', borderBottom: '1px solid rgba(var(--noir-primary-rgb), 0.15)' }}>
          <Ticket size={13} className="text-primary" />
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Purchase Tickets</span>
        </div>
        <div className="p-3 space-y-3">
          <div className="text-[10px] text-zinc-400 font-heading">
            Pick your count or use a quick-pick. Each ticket is one chance to win the full jackpot.
          </div>

          <QuickPick ticketPrice={ticketPrice} onPick={(n) => { setCount(n); clearConfirm(); if (countRef.current) countRef.current.focus(); }} />

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 space-y-1">
              <label htmlFor="lottery-count" className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading font-bold">
                Ticket Count (1–500)
              </label>
              <input
                ref={countRef}
                id="lottery-count"
                type="number"
                min={1}
                max={500}
                value={count}
                onChange={(e) => { setCount(e.target.value); clearConfirm(); }}
                className="w-full max-w-[200px] px-2.5 py-2 rounded-md border text-sm font-heading tabular-nums"
                style={{
                  borderColor: 'rgba(var(--noir-primary-rgb), 0.25)',
                  background: 'rgba(0,0,0,0.3)',
                  color: 'var(--noir-foreground)',
                }}
              />
              <div className="text-[11px] font-heading tabular-nums" style={{ color: 'var(--noir-primary)' }}>
                Total cost: {formatMoney(totalCost)}
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-1">
              <button
                type="button"
                onClick={onBuy}
                disabled={buying}
                className="lot-buy-btn px-5 py-2.5 rounded-md text-[11px] font-heading font-bold uppercase tracking-wider"
                style={confirmPending ? { background: 'linear-gradient(135deg, #b91c1c, #dc2626)', borderColor: 'rgba(239,68,68,0.5)', boxShadow: '0 2px 12px rgba(239,68,68,0.35)' } : undefined}
              >
                {buying ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Purchasing…
                  </span>
                ) : confirmPending ? (
                  <span className="flex items-center gap-1.5">
                    <Ticket size={13} />
                    Confirm {formatMoney(totalCost)}?
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Ticket size={13} />
                    Buy {parsedCount} Ticket{parsedCount !== 1 ? 's' : ''}
                  </span>
                )}
              </button>
              {needsConfirm && !confirmPending && !buying && (
                <span className="text-[8px] text-zinc-600 font-heading">Requires confirmation</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── LAST DRAW RESULTS ── */}
      {last && (
        <div className="lot-winner-banner rounded-md overflow-hidden lot-fade-in lot-delay-3">
          <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ borderBottom: '1px solid rgba(var(--noir-primary-rgb), 0.15)' }}>
            <Trophy size={13} className="text-amber-400" />
            <span className="text-[9px] font-heading font-bold text-amber-400 uppercase tracking-wider">Previous Draw</span>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
              <div className="flex items-center gap-2">
                <div className="lot-ball lot-ball-gold" style={{ width: 28, height: 28, fontSize: 10, flexShrink: 0 }}>
                  <Trophy size={12} />
                </div>
                <div>
                  <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading">Winner</div>
                  <div className="text-sm font-heading font-bold text-primary">{last.winner_username || 'No winner'}</div>
                </div>
              </div>
              <div>
                <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading">Payout</div>
                <div className="text-sm font-heading font-bold text-emerald-400 tabular-nums">{formatMoney(last.payout)}</div>
              </div>
              <div>
                <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading">Tax Sink</div>
                <div className="text-[11px] font-heading text-zinc-400 tabular-nums">{formatMoney(last.sink_amount)}</div>
              </div>
              <div>
                <div className="text-[8px] text-zinc-500 uppercase tracking-wider font-heading">Tickets</div>
                <div className="text-[11px] font-heading text-zinc-400 tabular-nums">{last.ticket_count?.toLocaleString?.() ?? '—'}</div>
              </div>
            </div>
            {last.drawn_at && (
              <div className="text-[9px] text-zinc-600 font-heading">
                Drawn {new Date(last.drawn_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HOW IT WORKS ── */}
      <div className={`${styles.panel} rounded-md overflow-hidden lot-fade-in lot-delay-4`}>
        <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ background: 'rgba(var(--noir-primary-rgb), 0.05)', borderBottom: '1px solid rgba(var(--noir-primary-rgb), 0.1)' }}>
          <Clock size={12} className="text-zinc-500" />
          <span className="text-[8px] font-heading font-bold text-zinc-500 uppercase tracking-wider">How it works</span>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { step: '1', title: 'Buy Tickets', desc: `Each ticket costs ${formatMoney(state?.ticket_price)}. Buy up to 500 per transaction.` },
            { step: '2', title: 'Wait for the Draw', desc: 'Draws happen Wednesday & Sunday at 00:00 UTC. The pot grows with every ticket sold.' },
            { step: '3', title: 'Win the Jackpot', desc: `One random ticket wins ${100 - taxPct}% of the gross pot. The other ${taxPct}% is removed from the economy.` },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-2.5">
              <div
                className="lot-ball lot-ball-gold flex-shrink-0"
                style={{ width: 28, height: 28, fontSize: 12, marginTop: 2 }}
              >
                {step}
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-primary">{title}</div>
                <div className="text-[9px] text-zinc-500 font-heading leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Lottery;
