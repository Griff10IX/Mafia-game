import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Spade, MessageSquare, XCircle, CheckCircle2, Swords, Skull } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FAVICON_PNG, APP_ICON_192_PNG } from '../../utils/publicAssets';
import styles from '../../styles/noir.module.css';

const TURN_SECONDS = 60;
const START_COUNTDOWN = 5; // must match backend MP_BJ_START_COUNTDOWN

const SUITS = {
  H: { sym: '♥', color: '#dc2626' },
  D: { sym: '♦', color: '#dc2626' },
  C: { sym: '♣', color: '#1c1c1c' },
  S: { sym: '♠', color: '#1c1c1c' },
};

function handTotal(hand) {
  if (!hand?.length) return 0;
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    const v = c.value;
    if (v === 'A') { aces += 1; total += 11; }
    else if (['K', 'Q', 'J'].includes(v)) { total += 10; }
    else { total += parseInt(v, 10) || 0; }
  }
  while (total > 21 && aces) { total -= 10; aces -= 1; }
  return total;
}

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

/** Format server showdown totals, e.g. "HP 24 (bust), GhostFace 16". */
function formatShowdownTotals(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  return rows
    .map((r) => {
      const name = r?.username || '?';
      const total = Number(r?.total);
      if (Number.isNaN(total)) return name;
      return r?.bust || total > 21 ? `${name} ${total} (bust)` : `${name} ${total}`;
    })
    .join(', ');
}

/* ─── Win Particles ─── */
function WinParticles({ active }) {
  const [particles] = useState(() =>
    Array.from({ length: 22 }, (_, i) => ({
      id: i, left: 5 + Math.random() * 90,
      delay: Math.random() * 0.7, duration: 1.1 + Math.random() * 0.8,
      rotate: Math.random() * 540 - 270,
      emoji: ['🪙', '✨', '🃏', '💰'][i % 4], size: 14 + Math.random() * 12,
    }))
  );
  if (!active) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
      {particles.map((p) => (
        <span key={p.id} className="absolute animate-bj-particle"
          style={{ left: `${p.left}%`, top: '-5%', fontSize: p.size,
            animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
            '--p-rotate': `${p.rotate}deg` }}
        >{p.emoji}</span>
      ))}
    </div>
  );
}

/* ─── Playing Card ─── */
function PlayingCard({ card, hidden, index = 0, total, large = false }) {
  const fan = total > 1 ? (index - (total - 1) / 2) * 3 : 0;
  const offsetX = total > 1 ? (index - (total - 1) / 2) * 2 : 0;
  const sizeClass = large
    ? 'w-[56px] h-[80px] sm:w-[64px] sm:h-[92px]'
    : 'w-[48px] h-[68px] sm:w-[56px] sm:h-[80px]';

  if (hidden) {
    return (
      <div
        className={`relative ${sizeClass} rounded-lg overflow-hidden animate-card-deal flex-shrink-0`}
        style={{ transform: `rotate(${fan}deg) translateX(${offsetX}px)`, animationDelay: `${index * 0.08}s`, boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
      >
        <div className="absolute inset-0 rounded-lg" style={{ background: 'linear-gradient(135deg,#1a3a7a,#0d2255)', border: '2px solid #2a4a9a' }}>
          <div
            className="absolute inset-1 rounded border border-white/10"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(255,255,255,0.03) 4px,rgba(255,255,255,0.03) 8px),repeating-linear-gradient(-45deg,transparent,transparent 4px,rgba(255,255,255,0.03) 4px,rgba(255,255,255,0.03) 8px)',
            }}
          >
            <div className="absolute inset-2 rounded border border-yellow-500/20 flex items-center justify-center">
              <span className="text-yellow-500/30 text-lg">♠</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = SUITS[card?.suit] || { sym: '?', color: '#666' };
  const isRed = card?.suit === 'H' || card?.suit === 'D';
  return (
    <div
      className={`relative ${sizeClass} rounded-lg overflow-hidden animate-card-deal flex-shrink-0`}
      style={{ transform: `rotate(${fan}deg) translateX(${offsetX}px)`, animationDelay: `${index * 0.08}s`, boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
    >
      <div
        className="absolute inset-0 rounded-lg"
        style={{ background: 'linear-gradient(180deg,#fff,#f8f8f8,#f0f0f0)', border: `2px solid ${isRed ? '#fca5a5' : '#d4d4d8'}` }}
      >
        <div className="absolute top-1 left-1.5 leading-none" style={{ color: s.color }}>
          <div className="text-[10px] sm:text-[11px] font-bold">{card?.value}</div>
          <div className="text-[9px] sm:text-[10px] -mt-0.5">{s.sym}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: s.color }}>
          <span className={`${large ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'} opacity-90`} style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.1))' }}>
            {s.sym}
          </span>
        </div>
        <div className="absolute bottom-1 right-1.5 leading-none rotate-180" style={{ color: s.color }}>
          <div className="text-[10px] sm:text-[11px] font-bold">{card?.value}</div>
          <div className="text-[9px] sm:text-[10px] -mt-0.5">{s.sym}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Player Seat ─── */
function PlayerSeat({ p, isMe, isCurrent, showCards, isWinner, large = false }) {
  const hand = p.hand || [];
  const total = handTotal(hand);
  const isBust = p.status === 'bust' || total > 21;
  const isStood = p.status === 'stood';
  const isEliminated = p.eliminated || p.status === 'eliminated';
  const isWaiting = p.status === 'waiting' || p.status === 'waiting_ready';
  const isReady = p.ready && isWaiting;
  const maskPeek = !isMe && !showCards;
  // Only count face-up cards (own hand mid-game, or everyone after showdown).
  const canCountTotal = hand.length > 0
    && hand.every((c) => c && c.hidden !== true && c.value && c.value !== '?');

  let badgeLabel = '—';
  let badgeStyle = { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)' };

  if (isWinner) { badgeLabel = 'Win'; badgeStyle = { background: 'rgba(52,211,153,0.25)', color: '#34d399' }; }
  else if (isEliminated) { badgeLabel = 'Out'; badgeStyle = { background: 'rgba(239,68,68,0.2)', color: '#ef4444' }; }
  else if (canCountTotal && (isMe || showCards)) {
    // Always show countable total for yourself (and for everyone once cards are revealed).
    if (isBust) {
      badgeLabel = `Bust ${total}`;
      badgeStyle = { background: 'rgba(248,113,113,0.2)', color: '#f87171' };
    } else {
      badgeLabel = String(total);
      badgeStyle = isCurrent
        ? { background: 'rgba(212,175,55,0.25)', color: 'var(--noir-primary-bright)' }
        : { background: 'rgba(52,211,153,0.18)', color: '#6ee7b7' };
    }
  }
  else if (isBust) { badgeLabel = 'Bust'; badgeStyle = { background: 'rgba(248,113,113,0.2)', color: '#f87171' }; }
  else if (isStood) { badgeLabel = 'Stand'; badgeStyle = { background: 'rgba(161,161,170,0.2)', color: '#a1a1aa' }; }
  else if (isCurrent) { badgeLabel = 'Playing'; badgeStyle = { background: 'rgba(212,175,55,0.2)', color: 'var(--noir-primary)' }; }
  else if (maskPeek && hand.length) {
    badgeLabel = 'Hidden';
    badgeStyle = { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' };
  }
  else if (isReady) { badgeLabel = 'Ready'; badgeStyle = { background: 'rgba(52,211,153,0.2)', color: '#34d399' }; }
  else if (isWaiting) { badgeLabel = 'Waiting'; badgeStyle = { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }; }
  else if (hand.length) { badgeLabel = `${hand.length} cd`; }

  return (
    <div
      className={`rounded-xl overflow-hidden border-2 transition-all duration-300 ${large ? 'w-full' : ''}`}
      style={{
        borderColor: isWinner
          ? '#34d399'
          : isEliminated
            ? 'rgba(239,68,68,0.3)'
            : isCurrent
              ? 'var(--noir-primary-bright)'
              : isMe
                ? 'rgba(212,175,55,0.45)'
                : 'rgba(90,62,27,0.5)',
        background: isWinner
          ? 'linear-gradient(180deg,rgba(52,211,153,0.08),rgba(0,0,0,0.35))'
          : isEliminated
            ? 'rgba(239,68,68,0.04)'
            : isCurrent
              ? 'linear-gradient(180deg,rgba(212,175,55,0.07),rgba(0,0,0,0.3))'
              : 'rgba(0,0,0,0.28)',
        boxShadow: isWinner
          ? '0 0 28px rgba(52,211,153,0.35), 0 0 14px rgba(52,211,153,0.2), inset 0 0 20px rgba(0,0,0,0.2)'
          : isCurrent
            ? '0 0 24px rgba(212,175,55,0.18),inset 0 0 20px rgba(0,0,0,0.2)'
            : 'none',
        opacity: isEliminated ? 0.5 : 1,
      }}
    >
      <div
        className="px-2.5 py-1.5 flex items-center justify-between gap-2"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.22)' }}
      >
        <span
          className={`font-heading font-bold truncate min-w-0 ${large ? 'text-xs sm:text-sm' : 'text-[11px]'}`}
          style={{ color: isMe ? 'var(--noir-primary)' : 'rgba(255,255,255,0.75)' }}
        >
          {isEliminated && <Skull size={10} className="inline mr-0.5 opacity-50" />}
          {p.username}{isMe ? ' (You)' : ''}
        </span>
        <span className="text-[10px] font-heading px-1.5 py-0.5 rounded-full flex-shrink-0 uppercase tracking-wide" style={badgeStyle}>
          {badgeLabel}
        </span>
      </div>
      <div className={`p-2 ${large ? 'min-h-[96px] sm:min-h-[110px]' : 'min-h-[88px]'} flex flex-col items-center justify-center gap-1.5`}>
        <div className="flex items-center justify-center flex-wrap gap-1">
          {isEliminated
            ? <span className="text-[11px] font-heading uppercase tracking-wider text-red-400/50">Eliminated</span>
            : hand.length === 0
              ? <span className="text-[10px] font-heading" style={{ color: 'rgba(255,255,255,0.15)' }}>waiting…</span>
              : hand.map((card, i) => (
                  <PlayingCard
                    key={`${card?.suit || 'x'}-${card?.value || '?'}-${i}`}
                    card={card}
                    hidden={!showCards || card?.hidden === true || card?.value === '?'}
                    index={i}
                    total={hand.length}
                    large={large}
                  />
                ))}
        </div>
        {isMe && canCountTotal && !isEliminated && (
          <p
            className={`font-heading font-bold tabular-nums ${large ? 'text-base sm:text-lg' : 'text-sm'}`}
            style={{ color: isBust ? '#f87171' : 'var(--noir-primary-bright)' }}
          >
            {isBust ? `Total ${total} — Bust` : `Total ${total}`}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Turn Timer Arc ─── */
function TurnTimer({ seconds, isMyTurn }) {
  const pct = Math.max(0, seconds / TURN_SECONDS);
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const urgent = seconds <= 10;
  const color = urgent ? '#f87171' : isMyTurn ? 'var(--noir-primary)' : 'rgba(255,255,255,0.35)';
  return (
    <svg width="44" height="44" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
      <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.9s linear, stroke 0.3s' }} />
      <text x="22" y="22" textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize="11" fontWeight="700" fontFamily="Cinzel, serif"
        transform="rotate(90,22,22)">{seconds}</text>
    </svg>
  );
}

/* ─── Start Countdown Ring ─── */
function StartCountdown({ seconds }) {
  const pct = Math.max(0, seconds / START_COUNTDOWN);
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(212,175,55,0.1)" strokeWidth="4" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--noir-primary)" strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.9s linear' }} />
        <text x="36" y="36" textAnchor="middle" dominantBaseline="central"
          fill="var(--noir-primary)" fontSize="22" fontWeight="700" fontFamily="Cinzel, serif"
          transform="rotate(90,36,36)">{seconds}</text>
      </svg>
      <p className="text-[10px] font-heading font-bold uppercase tracking-[0.2em] animate-turn-pulse"
        style={{ background: 'linear-gradient(180deg,#ffd700,var(--noir-primary-bright))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        Game Starting…
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Page
   ══════════════════════════════════════════════════════════ */
export default function MPBlackjackGamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [refundStuckLoading, setRefundStuckLoading] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [prevStatus, setPrevStatus] = useState(null);
  const [prevPhase, setPrevPhase] = useState(null);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState(null);
  const [startSecondsLeft, setStartSecondsLeft] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const chatEndRef = useRef(null);
  const timeoutTriggeredRef = useRef(null);
  const timeoutInFlightRef = useRef(false);
  const startTriggeredRef = useRef(false);
  const startInFlightRef = useRef(false);
  const prevRoundRef = useRef(null);
  const prevRoundEliminatedRef = useRef([]);
  const lastTieHistoryLenRef = useRef(0);
  const pollSeqRef = useRef(0);
  const actionSeqRef = useRef(0);
  const myUserIdRef = useRef(null);
  const pendingWinCheckRef = useRef(null);

  useEffect(() => {
    api.get('/auth/me').then((r) => {
      const id = r.data?.id ?? null;
      myUserIdRef.current = id;
      setMyUserId(id);
    }).catch(() => setMyUserId(null));
  }, []);

  useEffect(() => {
    api.get('/auth/staff-flags').then((r) => {
      setIsAdmin(!!r.data?.is_admin);
      setIsModerator(!!r.data?.is_moderator);
    }).catch(() => {});
  }, []);

  const applyGameUpdate = useCallback((g, { fromAction = false } = {}) => {
    if (!g) {
      setGame(null);
      return;
    }
    setGame((prev) => {
      const uid = myUserIdRef.current;
      if (g?.status === 'completed') {
        const myResult = g?.results?.find((res) => res.user_id === uid);
        if (myResult?.result === 'win' && prev?.status !== 'completed') {
          setShowWin(true);
          setTimeout(() => setShowWin(false), 3500);
          pendingWinCheckRef.current = null;
        } else if (!uid && prev?.status !== 'completed') {
          // myUserId not loaded yet — re-check when it arrives
          pendingWinCheckRef.current = g;
        }
      }
      const newRound = g?.current_round;
      if (newRound && prevRoundRef.current && newRound > prevRoundRef.current) {
        const roundElim = g?.round_eliminated || [];
        if (roundElim.length) {
          const elimNames = (g?.players || [])
            .filter((p) => roundElim.includes(p.user_id))
            .map((p) => p.username);
          toast.message(`Round ${prevRoundRef.current} over — eliminated: ${elimNames.join(', ')}`);
        }
      }
      // Tie / no winner → pot stays, another round (detect new round_history entry)
      const history = g?.round_history || [];
      if (prev == null) {
        lastTieHistoryLenRef.current = history.length;
      } else if (history.length > lastTieHistoryLenRef.current) {
        const latest = history[history.length - 1];
        if (latest?.tie_play_again) {
          const totalsLine = formatShowdownTotals(latest.showdown_totals);
          toast.message(
            totalsLine
              ? `Tie / no winner (${totalsLine}) — another round will begin. Ready up to deal again.`
              : 'Tie / no winner — another round will begin. Ready up to deal again.',
            { duration: 7000 },
          );
        }
        lastTieHistoryLenRef.current = history.length;
      } else if (history.length < lastTieHistoryLenRef.current) {
        lastTieHistoryLenRef.current = history.length;
      }
      prevRoundRef.current = newRound;
      setPrevStatus(g?.status);
      setPrevPhase(g?.phase);
      return g;
    });
    if (fromAction) {
      actionSeqRef.current += 1;
    }
  }, []);

  // Fire win particles if completed state arrived before myUserId
  useEffect(() => {
    if (!myUserId || !pendingWinCheckRef.current) return;
    const g = pendingWinCheckRef.current;
    pendingWinCheckRef.current = null;
    const myResult = g?.results?.find((res) => res.user_id === myUserId);
    if (myResult?.result === 'win') {
      setShowWin(true);
      setTimeout(() => setShowWin(false), 3500);
    }
  }, [myUserId]);

  const fetchGame = useCallback(() => {
    if (!gameId) return;
    const seq = ++pollSeqRef.current;
    const actionAtStart = actionSeqRef.current;
    api.get(`/casino/mp-blackjack/games/${gameId}`)
      .then((r) => {
        // Ignore stale GETs that finished after a newer poll or after a POST applied state
        if (seq !== pollSeqRef.current || actionSeqRef.current !== actionAtStart) return;
        applyGameUpdate(r.data?.game ?? null);
      })
      .catch(() => {
        if (seq !== pollSeqRef.current) return;
        setGame(null);
      })
      .finally(() => {
        if (seq === pollSeqRef.current) setHasLoaded(true);
      });
  }, [gameId, applyGameUpdate]);

  useEffect(() => {
    lastTieHistoryLenRef.current = 0;
    prevRoundRef.current = null;
    fetchGame();
    if (!gameId) return;
    const t = setInterval(fetchGame, 3000);
    return () => clearInterval(t);
  }, [fetchGame, gameId]);

  // All-ready notification
  useEffect(() => {
    if (game?.phase === 'ready' && game?.all_ready_at && prevPhase !== 'ready') {
      toast.success('All players ready — game starting!', { duration: 4000 });
    }
  }, [game?.phase, game?.all_ready_at, prevPhase]);

  const hit = async () => {
    if (!gameId || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/hit`);
      applyGameUpdate(res.data?.game ?? null, { fromAction: true });
      await refreshUser();
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const stand = async () => {
    if (!gameId || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/stand`);
      applyGameUpdate(res.data?.game ?? null, { fromAction: true });
      await refreshUser();
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const markReady = async () => {
    if (!gameId || readyLoading) return;
    setReadyLoading(true);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/ready`);
      applyGameUpdate(res.data?.game ?? null, { fromAction: true });
      toast.success("You're ready!");
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Failed'); }
    finally { setReadyLoading(false); }
  };

  const cancelGame = async () => {
    if (!gameId || cancelLoading) return;
    setCancelLoading(true);
    try {
      await api.post(`/casino/mp-blackjack/games/${gameId}/cancel`);
      await refreshUser();
      toast.success('Game cancelled; everyone refunded');
      navigate('/casino/mp-blackjack');
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not cancel'); }
    finally { setCancelLoading(false); }
  };

  const leaveGame = async () => {
    if (!gameId || leaveLoading) return;
    setLeaveLoading(true);
    try {
      await api.post(`/casino/mp-blackjack/games/${gameId}/leave`);
      await refreshUser();
      toast.success('You left the game');
      navigate('/casino/mp-blackjack');
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not leave'); }
    finally { setLeaveLoading(false); }
  };

  const refundStuckGame = async () => {
    if (!gameId || refundStuckLoading || !isAdmin) return;
    if (!window.confirm('Cancel this game and refund all buy-ins to players?')) return;
    setRefundStuckLoading(true);
    try {
      await api.post(`/casino/mp-blackjack/games/${gameId}/refund-stuck`);
      await refreshUser();
      toast.success('Bets refunded — game cancelled');
      navigate('/casino/mp-blackjack');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not refund');
    } finally {
      setRefundStuckLoading(false);
    }
  };

  const triggerStart = useCallback(async () => {
    if (!gameId || startTriggeredRef.current || startInFlightRef.current) return;
    startTriggeredRef.current = true;
    startInFlightRef.current = true;
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/start`);
      applyGameUpdate(res.data?.game ?? null, { fromAction: true });
      toast.success('Cards are dealt — good luck!');
    } catch (_) {
      // Allow one retry if start failed (countdown already hit 0)
      startTriggeredRef.current = false;
    } finally {
      startInFlightRef.current = false;
    }
  }, [gameId, applyGameUpdate]);

  const triggerTimeout = useCallback(async () => {
    if (!gameId || timeoutInFlightRef.current) return;
    timeoutInFlightRef.current = true;
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/timeout`);
      applyGameUpdate(res.data?.game ?? null, { fromAction: true });
    } catch (_) {
      // Allow retry on next tick if request failed
      timeoutTriggeredRef.current = null;
    } finally {
      timeoutInFlightRef.current = false;
    }
  }, [gameId, applyGameUpdate]);

  const sendChat = async (e) => {
    e?.preventDefault();
    const msg = chatInput.trim();
    if (!gameId || !msg || sendingChat) return;
    setSendingChat(true);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/chat`, { message: msg });
      applyGameUpdate(res.data?.game ?? null, { fromAction: true });
      setChatInput('');
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Send failed'); }
    finally { setSendingChat(false); }
  };

  // ── Derived values ──
  const status = game?.status || 'open';
  const phase = game?.phase || 'lobby';
  const players = game?.players || [];
  const currentTurnIndex = game?.current_turn_index ?? -1;
  const pot = game?.pot ?? 0;
  const myIndex = players.findIndex((p) => p.user_id === myUserId);
  const amIPlayer = myIndex >= 0;
  const isMyTurn = status === 'playing' && phase === 'playing' && currentTurnIndex >= 0
    && currentTurnIndex < players.length && players[currentTurnIndex]?.user_id === myUserId;
  const cardLimit = game?.card_limit ?? null;
  const myHandLength = isMyTurn && players[currentTurnIndex] ? (players[currentTurnIndex].hand || []).length : 0;
  const hitDisabled = actionLoading || (cardLimit != null && myHandLength >= cardLimit);
  const isCreator = game?.creator_id === myUserId;
  const canCancelGame = (isCreator || isAdmin || isModerator) && phase !== 'playing' && phase !== 'dealer';
  const canLeaveGame = amIPlayer && !canCancelGame && phase !== 'playing' && phase !== 'dealer';
  const showRefundStuckBtn = isAdmin && status !== 'completed' && status !== 'cancelled';
  const turnStartedAt = game?.turn_started_at;
  const allReadyAt = game?.all_ready_at;
  const eliminationRounds = game?.elimination_rounds || false;
  const currentRound = game?.current_round || 1;

  const activePlayers = players.filter((p) => !p.eliminated && p.status !== 'eliminated');
  const myPlayer = players[myIndex];
  const amIEliminated = myPlayer?.eliminated || myPlayer?.status === 'eliminated';
  const amIReady = myPlayer?.ready || false;
  const allReady = activePlayers.length > 0 && activePlayers.every((p) => p.ready);

  // ── Turn timer ──
  useEffect(() => {
    if (status !== 'playing' || phase !== 'playing' || currentTurnIndex < 0 || !turnStartedAt) {
      setTurnSecondsLeft(null); return;
    }
    const compute = () => Math.max(0, Math.ceil(TURN_SECONDS - (Date.now() - new Date(turnStartedAt).getTime()) / 1000));
    setTurnSecondsLeft(compute());
    const t = setInterval(() => setTurnSecondsLeft(compute()), 1000);
    return () => clearInterval(t);
  }, [status, phase, currentTurnIndex, turnStartedAt]);

  // ── Notify when it's your turn (toast + browser notification if tab in background)
  const prevIsMyTurnRef = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnRef.current) {
      toast.success('Your turn — hit or stand.');
      if (typeof Notification !== 'undefined' && document.hidden) {
        if (Notification.permission === 'granted') {
          try {
            new Notification('Multiplayer Blackjack', {
              body: "It's your turn — hit or stand!",
              icon: FAVICON_PNG,
              badge: APP_ICON_192_PNG,
            });
          } catch (_) {}
        } else if (Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [isMyTurn]);

  // ── Start countdown ──
  useEffect(() => {
    if (phase !== 'ready' || !allReadyAt) {
      setStartSecondsLeft(null);
      startTriggeredRef.current = false;
      return;
    }
    const compute = () => Math.max(0, Math.ceil(START_COUNTDOWN - (Date.now() - new Date(allReadyAt).getTime()) / 1000));
    setStartSecondsLeft(compute());
    const t = setInterval(() => setStartSecondsLeft(compute()), 1000);
    return () => clearInterval(t);
  }, [phase, allReadyAt]);

  // ── Auto-trigger start after countdown ──
  useEffect(() => {
    if (startSecondsLeft !== 0 || phase !== 'ready' || !allReadyAt) return;
    triggerStart();
  }, [startSecondsLeft, phase, allReadyAt, triggerStart]);

  // ── Auto-trigger timeout ──
  useEffect(() => {
    if (turnSecondsLeft !== 0 || status !== 'playing' || phase !== 'playing' || currentTurnIndex < 0) return;
    const key = `${currentTurnIndex}-${turnStartedAt}`;
    if (timeoutTriggeredRef.current === key) return;
    timeoutTriggeredRef.current = key;
    triggerTimeout();
  }, [turnSecondsLeft, status, phase, currentTurnIndex, turnStartedAt, triggerTimeout]);

  // Only show "not found" after the first fetch settles — until then paint lobby chrome with safe defaults.
  if (hasLoaded && !game) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0`}>
        <p className="text-[11px] text-mutedForeground font-heading">Game not found.</p>
        <Link to="/casino/mp-blackjack" className="text-primary font-heading text-sm hover:underline">← Back to Multiplayer Blackjack</Link>
      </div>
    );
  }
  if (status === 'cancelled') {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0`}>
        <div className="rounded-xl border p-6 text-center space-y-3" style={{ borderColor: 'rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.05)' }}>
          <p className="text-sm font-heading font-bold text-red-400 uppercase tracking-wider">Game Cancelled</p>
          <p className="text-[11px] text-mutedForeground font-heading">All bets have been refunded.</p>
          <Link to="/casino/mp-blackjack"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary font-heading text-[11px] uppercase hover:bg-primary/20">
            ← Back to games
          </Link>
        </div>
      </div>
    );
  }

  const tableBackground = {
    background: 'linear-gradient(180deg,#0c3d1a 0%,#0a5e2a 20%,#0d7a35 50%,#0a5e2a 80%,#0c3d1a 100%)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.5),inset 0 0 60px rgba(0,0,0,0.2)',
  };
  const goldBar = { height: 3, background: 'linear-gradient(90deg,#5a3e1b,var(--noir-primary-bright),#8b6914,var(--noir-primary-bright),#5a3e1b)' };
  const mySeatPlayer = amIPlayer ? players[myIndex] : null;
  const otherPlayers = players.filter((p) => p.user_id !== myUserId);
  const isSettling = phase === 'dealer' || (status === 'playing' && phase === 'settled' && !(game?.results || []).length);

  return (
    <div
      className={`space-y-3 ${styles.pageContent} mobile-page-root pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0`}
      data-testid="mp-blackjack-game-page"
    >
      <style>{`
        @keyframes card-deal {
          0%   { transform: translateY(-28px) rotate(-5deg) scale(0.8); opacity: 0; }
          100% { transform: translateY(0) rotate(0) scale(1); opacity: 1; }
        }
        @keyframes bj-particle {
          0%   { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          70%  { opacity: 1; }
          100% { transform: translateY(600px) rotate(var(--p-rotate,180deg)) scale(0.3); opacity: 0; }
        }
        @keyframes result-slide {
          0%   { transform: translateY(6px); opacity: 0; }
          100% { transform: translateY(0);   opacity: 1; }
        }
        @keyframes turn-pulse {
          0%,100% { opacity: 0.55; }
          50%     { opacity: 1; }
        }
        @keyframes ready-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(212,175,55,0); }
          50%     { box-shadow: 0 0 0 8px rgba(212,175,55,0.15); }
        }
        .animate-card-deal    { animation: card-deal 0.32s cubic-bezier(0.2,0.8,0.3,1) backwards; }
        .animate-bj-particle  { animation: bj-particle ease-in forwards; }
        .animate-result-slide { animation: result-slide 0.35s ease-out both; }
        .animate-turn-pulse   { animation: turn-pulse 1.4s ease-in-out infinite; }
        .animate-ready-pulse  { animation: ready-pulse 2s ease-in-out infinite; }
        .mpbj-sticky-actions {
          position: sticky;
          bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px));
          z-index: 30;
        }
        .mpbj-action-chrome {
          background: linear-gradient(180deg, rgba(12,61,26,0.96), rgba(10,94,42,0.98));
          border: 1px solid rgba(212,175,55,0.25);
          box-shadow: 0 -4px 20px rgba(0,0,0,0.35);
        }
        @media (min-width: 768px) {
          .mpbj-sticky-actions { position: static; bottom: auto; }
          .mpbj-action-chrome {
            background: transparent;
            border: none;
            box-shadow: none;
          }
        }
      `}</style>

      <WinParticles active={showWin} />

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to="/casino/mp-blackjack"
            className="p-1.5 rounded border border-primary/20 text-primary hover:bg-primary/10 transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Multiplayer Blackjack</h1>
              {eliminationRounds && (
                <span className="inline-flex items-center gap-1 text-[8px] font-heading font-bold px-1.5 py-0.5 rounded-full uppercase"
                  style={{ background: 'rgba(251,113,133,0.15)', color: '#fb7185', border: '1px solid rgba(251,113,133,0.3)' }}>
                  <Swords size={8} /> Elimination
                </span>
              )}
            </div>
            <p className="text-[9px] text-mutedForeground font-heading">
              Pot <span className="text-primary font-bold">{formatMoney(pot)}</span>
              {' · '}{activePlayers.length} active
              {eliminationRounds && currentRound > 1 && ` · Round ${currentRound}`}
            </p>
          </div>
        </div>
        {showRefundStuckBtn && (
          <button
            type="button"
            disabled={refundStuckLoading}
            onClick={refundStuckGame}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[8px] font-heading font-bold uppercase disabled:opacity-50 transition-colors"
            style={{
              borderColor: 'rgba(248,113,113,0.45)',
              background: 'rgba(248,113,113,0.1)',
              color: '#f87171',
            }}
          >
            <XCircle size={10} />
            {refundStuckLoading ? '…' : 'Refund table'}
          </button>
        )}
      </div>

      {/* ══ LOBBY (waiting for 2+ players) ══ */}
      {status === 'open' && phase !== 'ready' && (
        <div className="mobile-panel rounded-xl overflow-hidden border-2" style={{ borderColor: '#5a3e1b', ...tableBackground }}>
          <div style={goldBar} />
          <div className="p-5 sm:p-6 text-center space-y-4">
            <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
              style={{ background: 'linear-gradient(180deg,#ffd700,var(--noir-primary-bright))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Waiting for Players
            </p>
            <p className="text-[11px] font-heading uppercase tracking-wider" style={{ color: 'rgba(110,231,183,0.4)' }}>
              {players.length} / {game?.max_players ?? 6} seated
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {players.map((p) => (
                <span key={p.user_id} className="px-3 py-1.5 rounded-full text-[11px] font-heading font-bold"
                  style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)', color: 'var(--noir-primary)' }}>
                  {p.username}
                </span>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row justify-center gap-2 mt-2">
              {canCancelGame && (
                <button type="button" disabled={cancelLoading} onClick={cancelGame}
                  className="inline-flex items-center justify-center gap-1.5 px-4 min-h-10 py-2 rounded-lg border text-[11px] font-heading font-bold uppercase disabled:opacity-50 transition-colors"
                  style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                  <XCircle size={11} />{cancelLoading ? 'Cancelling…' : 'Cancel Game'}
                </button>
              )}
              {canLeaveGame && (
                <button type="button" disabled={leaveLoading} onClick={leaveGame}
                  className="inline-flex items-center justify-center gap-1.5 px-4 min-h-10 py-2 rounded-lg border text-[11px] font-heading font-bold uppercase disabled:opacity-50 transition-colors"
                  style={{ borderColor: 'rgba(161,161,170,0.4)', background: 'rgba(39,39,42,0.85)', color: '#e4e4e7' }}>
                  <XCircle size={11} />{leaveLoading ? 'Leaving…' : 'Leave Game'}
                </button>
              )}
            </div>
          </div>
          <div style={goldBar} />
        </div>
      )}

      {/* ══ READY PHASE ══ */}
      {(status === 'playing' || status === 'open') && phase === 'ready' && (() => {
        const lastHistory = (game?.round_history || [])[(game?.round_history || []).length - 1];
        const tieRedeal = !!lastHistory?.tie_play_again;
        return (
        <div className="mobile-panel rounded-xl overflow-hidden border-2" style={{ borderColor: '#5a3e1b', ...tableBackground }}>
          <div style={goldBar} />
          <div className="p-4 sm:p-5 space-y-5">
            {tieRedeal && (
              <div className="text-center px-3 py-2.5 rounded-lg border"
                style={{ background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.35)' }}>
                <p className="text-[11px] sm:text-xs font-heading font-bold uppercase tracking-wider text-amber-300">
                  Tie / no winner — another round will begin
                </p>
                {!!formatShowdownTotals(lastHistory?.showdown_totals) && (
                  <p className="text-[11px] sm:text-xs font-heading text-foreground mt-1.5 tabular-nums">
                    {formatShowdownTotals(lastHistory.showdown_totals)}
                  </p>
                )}
                <p className="text-[11px] font-heading text-mutedForeground mt-1">
                  Pot stays. Everyone ready up to deal again.
                </p>
              </div>
            )}
            {/* Header */}
            <div className="text-center space-y-1">
              {eliminationRounds && currentRound > 1 ? (
                <>
                  <p className="text-xs font-heading font-bold uppercase tracking-[0.2em]"
                    style={{ background: 'linear-gradient(180deg,#fb7185,#e11d48)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Round {currentRound}
                  </p>
                  <p className="text-[11px] font-heading text-mutedForeground">
                    {activePlayers.length} players remain — lowest hand will be eliminated
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
                    style={{ background: 'linear-gradient(180deg,#ffd700,var(--noir-primary-bright))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {tieRedeal
                      ? 'Ready for the next deal'
                      : (activePlayers.length >= (game?.max_players ?? 6) ? 'Table Full — Ready Up!' : 'Ready Up!')}
                  </p>
                  <p className="text-[11px] font-heading" style={{ color: 'rgba(110,231,183,0.5)' }}>
                    {activePlayers.length >= 2 ? 'All seated players must ready — then deal' : 'Need at least 2 players'}
                  </p>
                </>
              )}
            </div>

            {/* Countdown or ready button */}
            {allReady && allReadyAt ? (
              <div className="flex flex-col items-center gap-2">
                <StartCountdown seconds={startSecondsLeft ?? START_COUNTDOWN} />
              </div>
            ) : (
              amIPlayer && !amIEliminated && (
                <div className="flex flex-col items-center gap-2 w-full max-w-sm mx-auto">
                  {amIReady ? (
                    <div className="inline-flex items-center gap-2 w-full justify-center px-5 py-3 rounded-xl font-heading font-bold text-[11px] uppercase tracking-wider"
                      style={{ background: 'rgba(52,211,153,0.1)', border: '2px solid rgba(52,211,153,0.35)', color: '#34d399' }}>
                      <CheckCircle2 size={14} /> You're Ready
                    </div>
                  ) : (
                    <button type="button" disabled={readyLoading} onClick={markReady}
                      className="inline-flex items-center justify-center gap-2 w-full px-6 py-3.5 rounded-xl border-2 font-heading font-bold text-sm uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50 animate-ready-pulse"
                      style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200', boxShadow: '0 4px 16px rgba(212,175,55,0.3)' }}>
                      <CheckCircle2 size={15} />
                      {readyLoading ? 'Readying…' : "I'm Ready"}
                    </button>
                  )}
                  {canLeaveGame && (
                    <button type="button" disabled={leaveLoading} onClick={leaveGame}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] font-heading font-bold uppercase disabled:opacity-50 transition-colors"
                      style={{ borderColor: 'rgba(161,161,170,0.4)', background: 'rgba(39,39,42,0.85)', color: '#e4e4e7' }}>
                      <XCircle size={11} />{leaveLoading ? 'Leaving…' : 'Leave Game'}
                    </button>
                  )}
                </div>
              )
            )}

            {/* Player ready list */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {activePlayers.map((p) => (
                <div key={p.user_id} className="flex items-center gap-2 px-2.5 py-2.5 rounded-lg"
                  style={{
                    background: p.ready ? 'rgba(52,211,153,0.07)' : 'rgba(0,0,0,0.25)',
                    border: p.ready ? '1px solid rgba(52,211,153,0.25)' : '1px solid rgba(255,255,255,0.06)',
                  }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0 transition-all"
                    style={{ background: p.ready ? '#34d399' : 'rgba(255,255,255,0.12)', boxShadow: p.ready ? '0 0 6px rgba(52,211,153,0.5)' : 'none' }} />
                  <span className="text-[11px] font-heading font-bold truncate min-w-0"
                    style={{ color: p.user_id === myUserId ? 'var(--noir-primary)' : 'rgba(255,255,255,0.7)' }}>
                    {p.username}
                    {p.user_id === myUserId ? ' (You)' : ''}
                  </span>
                  {p.ready && <CheckCircle2 size={12} className="ml-auto flex-shrink-0" style={{ color: '#34d399' }} />}
                </div>
              ))}
            </div>

            {/* Progress */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-heading text-mutedForeground">
                <span>{activePlayers.filter((p) => p.ready).length} / {activePlayers.length} ready</span>
                {!allReady && <span className="animate-turn-pulse">Waiting for others…</span>}
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${activePlayers.length ? (activePlayers.filter((p) => p.ready).length / activePlayers.length) * 100 : 0}%`,
                    background: 'linear-gradient(90deg,#34d399,#10b981)',
                  }} />
              </div>
            </div>

            {canCancelGame && (
              <div className="flex justify-center">
                <button type="button" disabled={cancelLoading} onClick={cancelGame}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] font-heading font-bold uppercase disabled:opacity-50"
                  style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                  <XCircle size={11} />{cancelLoading ? 'Cancelling…' : 'Cancel Game'}
                </button>
              </div>
            )}
          </div>
          <div style={goldBar} />
        </div>
        );
      })()}

      {/* ══ PLAYING / COMPLETED TABLE ══ */}
      {(status === 'playing' || status === 'completed') && phase !== 'ready' && (
        <div className="mobile-panel rounded-xl overflow-hidden border-2" style={{ borderColor: '#5a3e1b', ...tableBackground }}>
          <div style={goldBar} />
          <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">

            {/* Round badge for elimination */}
            {eliminationRounds && status === 'playing' && (
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-heading font-bold uppercase"
                  style={{ background: 'rgba(251,113,133,0.1)', border: '1px solid rgba(251,113,133,0.25)', color: '#fb7185' }}>
                  <Swords size={10} /> Round {currentRound}
                </span>
              </div>
            )}

            {/* Settling banner */}
            {isSettling && (
              <div className="text-center px-3 py-2 rounded-lg border animate-turn-pulse"
                style={{ background: 'rgba(212,175,55,0.1)', borderColor: 'rgba(212,175,55,0.35)' }}>
                <p className="text-[11px] sm:text-xs font-heading font-bold uppercase tracking-wider text-primary">
                  Revealing hands…
                </p>
              </div>
            )}

            {/* Game info: pot, buy-in, rules */}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-2 py-2 rounded-lg text-[11px] font-heading"
              style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(212,175,55,0.12)' }}>
              <span className="text-mutedForeground">Pot <span className="text-primary font-bold">{formatMoney(pot)}</span></span>
              <span className="text-mutedForeground">Buy-in <span className="text-primary">{formatMoney(game?.buy_in ?? 0)}</span></span>
              {(game?.extra_prize ?? 0) > 0 && (
                <span className="text-mutedForeground">Bonus <span className="text-emerald-400">{formatMoney(game.extra_prize)}</span></span>
              )}
              {eliminationRounds && <span className="text-mutedForeground">Round <span className="font-bold">{currentRound}</span></span>}
              {cardLimit != null && (
                <span className="text-mutedForeground">
                  {cardLimit === 2 ? 'No hits' : cardLimit === 3 ? '1 hit max' : cardLimit === 4 ? '2 hits max' : `${cardLimit - 2} hits max`}
                </span>
              )}
              {game?.twenty_one_only && <span className="text-amber-400/80">21 only</span>}
              {(phase === 'settled' || status === 'completed') && (game?.results || []).length > 0 && (() => {
                const winners = (game.results || []).filter((r) => r.result === 'win').map((r) => r.username);
                if (winners.length === 0) return null;
                return (
                  <span className="flex items-center gap-1">
                    <span className="text-mutedForeground">Winner{winners.length > 1 ? 's' : ''}:</span>
                    <span className="font-bold" style={{ color: '#34d399' }}>{winners.join(', ')}</span>
                  </span>
                );
              })()}
            </div>

            {/* Last 5 rounds / games */}
            {(game?.round_history?.length > 0) && (
              <div className="px-2 py-2 rounded-lg text-[11px] font-heading space-y-1"
                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(212,175,55,0.1)' }}>
                <p className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground text-center mb-1.5">Last 5 rounds</p>
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                  {(game.round_history.slice(-5)).reverse().map((entry, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-mutedForeground">R{entry.round}:</span>
                      {entry.winner_username ? (
                        <span className="font-bold" style={{ color: '#34d399' }}>{entry.winner_username}</span>
                      ) : entry.eliminated?.length > 0 ? (
                        <span className="text-amber-400/90">{entry.eliminated.join(', ')} out</span>
                      ) : entry.tie_play_again ? (
                        <span className="text-amber-300/90">
                          Tie{formatShowdownTotals(entry.showdown_totals)
                            ? ` (${formatShowdownTotals(entry.showdown_totals)})`
                            : ''} — another round
                        </span>
                      ) : (
                        <span className="text-mutedForeground">—</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Turn indicator + timer (desktop / when not sticky bar) */}
            {status === 'playing' && phase === 'playing' && currentTurnIndex >= 0 && !isMyTurn && (
              <div className="flex items-center justify-center gap-3">
                {turnSecondsLeft != null && (
                  <TurnTimer seconds={turnSecondsLeft} isMyTurn={false} />
                )}
                <span className="text-[11px] font-heading font-bold uppercase tracking-wider animate-turn-pulse"
                  style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {players[currentTurnIndex]?.username ?? 'Player'}&apos;s turn
                </span>
              </div>
            )}

            {/* Your seat — full width on mobile */}
            {mySeatPlayer && (() => {
              const everyoneResolved = status === 'completed' || phase === 'settled' || phase === 'dealer';
              const winnerIds = game?.winner_ids || [];
              const isWinner = (status === 'completed' || phase === 'settled') && winnerIds.includes(mySeatPlayer.user_id);
              return (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-heading uppercase tracking-wider text-primary/70 text-center sm:text-left">Your hand</p>
                  <PlayerSeat
                    p={mySeatPlayer}
                    isMe
                    isCurrent={myIndex === currentTurnIndex}
                    showCards
                    isWinner={isWinner}
                    large
                  />
                </div>
              );
            })()}

            {/* Opponent seats */}
            {otherPlayers.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground text-center sm:text-left sm:hidden">Table</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {otherPlayers.map((p) => {
                    const idx = players.findIndex((x) => x.user_id === p.user_id);
                    const isCurrent = idx === currentTurnIndex;
                    const everyoneResolved = status === 'completed' || phase === 'settled' || phase === 'dealer';
                    const showOpponentCards = everyoneResolved;
                    const winnerIds = game?.winner_ids || [];
                    const isWinner = (status === 'completed' || phase === 'settled') && winnerIds.includes(p.user_id);
                    return (
                      <PlayerSeat
                        key={p.user_id}
                        p={p}
                        isMe={false}
                        isCurrent={isCurrent}
                        showCards={showOpponentCards}
                        isWinner={isWinner}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sticky Hit / Stand on mobile */}
            {status === 'playing' && phase === 'playing' && isMyTurn && (
              <div className="mpbj-sticky-actions mpbj-action-chrome flex flex-col gap-2 pt-1 rounded-xl p-2.5 sm:p-0">
                <div className="flex items-center justify-center gap-2 sm:hidden">
                  {turnSecondsLeft != null && (
                    <TurnTimer seconds={turnSecondsLeft} isMyTurn />
                  )}
                  <span className="text-[11px] font-heading font-bold uppercase tracking-wider text-primary">
                    Your turn
                    {mySeatPlayer?.hand?.length
                      ? ` · Total ${handTotal(mySeatPlayer.hand)}`
                      : ''}
                  </span>
                </div>
                <div className="hidden sm:flex items-center justify-center gap-3 pb-1">
                  {turnSecondsLeft != null && (
                    <TurnTimer seconds={turnSecondsLeft} isMyTurn />
                  )}
                  <span className="text-[11px] font-heading font-bold uppercase tracking-wider text-primary animate-turn-pulse">
                    Your turn
                    {mySeatPlayer?.hand?.length
                      ? ` · Total ${handTotal(mySeatPlayer.hand)}`
                      : ''}
                  </span>
                </div>
                <div className="flex items-stretch gap-2 w-full max-w-md mx-auto">
                  <button
                    type="button"
                    disabled={hitDisabled}
                    onClick={hit}
                    title={cardLimit != null && myHandLength >= cardLimit
                      ? (cardLimit === 2 ? 'No hits allowed' : `Hit limit reached (${cardLimit - 2} hit${cardLimit - 2 > 1 ? 's' : ''})`)
                      : ''}
                    className="flex-1 rounded-lg py-3.5 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 active:scale-[0.97] transition-all"
                    style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020,#8a6e18)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200', boxShadow: '0 4px 12px rgba(212,175,55,0.25)' }}
                  >
                    {actionLoading ? '…' : 'Hit'}
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={stand}
                    className="flex-1 rounded-lg py-3.5 text-sm font-heading font-bold uppercase tracking-wider border disabled:opacity-40 active:scale-[0.97] transition-all"
                    style={{ background: '#27272a', borderColor: '#52525b', color: '#fff' }}
                  >
                    {actionLoading ? '…' : 'Stand'}
                  </button>
                </div>
                {hitDisabled && cardLimit != null && myHandLength >= cardLimit && (
                  <p className="text-[10px] font-heading text-mutedForeground text-center">
                    {cardLimit === 2 ? 'No hits in this game' : `Hit limit reached (${cardLimit - 2} hit${cardLimit - 2 > 1 ? 's' : ''})`}
                  </p>
                )}
              </div>
            )}

            {status === 'playing' && phase === 'playing' && !isMyTurn && amIPlayer && !amIEliminated && (
              <p className="text-center text-[11px] font-heading" style={{ color: 'rgba(110,231,183,0.45)' }}>
                Waiting for {players[currentTurnIndex]?.username ?? 'player'}…
              </p>
            )}

            {amIEliminated && status === 'playing' && (
              <div className="text-center py-2 space-y-1">
                <p className="text-[11px] font-heading font-bold text-red-400 uppercase tracking-wider">You&apos;ve been eliminated</p>
                <p className="text-[10px] font-heading text-mutedForeground">Watch the rest of the game unfold…</p>
              </div>
            )}
          </div>
          <div style={goldBar} />
        </div>
      )}

      {/* ══ ELIMINATION HISTORY ══ */}
      {eliminationRounds && (game?.eliminated || []).length > 0 && (
        <div className={`${styles.panel} mobile-panel rounded-xl overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 border-b border-primary/20 flex items-center gap-1.5"
            style={{ background: 'rgba(251,113,133,0.05)' }}>
            <Skull size={12} style={{ color: '#fb7185' }} />
            <span className="text-[11px] font-heading font-bold uppercase tracking-wider" style={{ color: '#fb7185' }}>Elimination Log</span>
          </div>
          <div className="p-2.5 space-y-1">
            {(game.eliminated || []).map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px] font-heading px-2 py-1.5 rounded"
                style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)' }}>
                <span className="text-red-400/70 shrink-0">R{e.round}</span>
                <span className="text-foreground font-bold truncate">{e.username}</span>
                <span className="text-mutedForeground shrink-0">{e.hand_total > 21 ? `Bust (${e.hand_total})` : e.hand_total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ CHAT ══ */}
      {(status === 'open' || status === 'playing' || status === 'completed') && amIPlayer && (
        <div data-chat-surface="table" data-chat-game="blackjack" className={`${styles.panel} mobile-panel rounded-xl overflow-hidden border border-primary/20 mb-2`}>
          <div data-chat-part="header" className="px-3 py-2 border-b border-primary/20 flex items-center gap-1.5"
            style={{ background: 'rgba(234,179,8,0.06)' }}>
            <MessageSquare size={12} className="text-primary" />
            <span className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Table Chat</span>
          </div>
          <div data-chat-part="messages" className="max-h-[130px] overflow-y-auto p-2.5 space-y-1.5" style={{ background: 'rgba(0,0,0,0.2)' }}>
            {(game.chat || []).length === 0
              ? <p className="text-[11px] font-heading text-center py-2" style={{ color: 'rgba(255,255,255,0.15)' }}>No messages yet…</p>
              : (game.chat || []).map((c, i) => (
                  <div key={i} data-chat-part="message-row" className="text-[11px] font-heading leading-relaxed">
                    <span className="font-semibold" style={{ color: 'var(--noir-primary-bright)' }}>{c.username}:</span>{' '}
                    <span data-chat-part="message-text" className="text-foreground break-words">{c.message}</span>
                  </div>
                ))
            }
            <div ref={chatEndRef} />
          </div>
          {status !== 'completed' && (
            <form onSubmit={sendChat} data-chat-part="composer" className="p-2 border-t border-primary/20 flex gap-1.5">
              <input type="text" data-chat-part="input" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                placeholder="Say something…" maxLength={500}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] font-heading placeholder:text-mutedForeground focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(234,179,8,0.15)', color: 'inherit' }} />
              <button type="submit" data-chat-part="send" disabled={sendingChat || !chatInput.trim()}
                className="px-3 py-2 rounded-lg text-[11px] font-heading font-bold uppercase border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors">
                {sendingChat ? '…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ══ RESULTS ══ */}
      {status === 'completed' && (() => {
        const results = game.results || [];
        const noWinner = results.length > 0 && results.every((r) => r.result === 'refund');
        return (
          <div className={`${styles.panel} mobile-panel rounded-xl overflow-hidden border border-primary/20`}>
            <div className="px-3 py-2 border-b border-primary/20" style={{ background: 'rgba(234,179,8,0.06)' }}>
              <span className="text-[11px] font-heading font-bold text-primary uppercase tracking-widest">Results</span>
              {noWinner && (
                <p className="text-[11px] font-heading text-mutedForeground mt-1">
                  No winner — refunds issued. Play again?
                </p>
              )}
            </div>
            <div className="p-2.5 space-y-1.5">
              {results.map((r, i) => {
                const isWin = r.result === 'win';
                const isLose = r.result === 'lose' || r.result === 'bust';
                const isElim = r.result === 'eliminated';
                const isRefund = r.result === 'refund';
                return (
                  <div key={i} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[11px] font-heading animate-result-slide"
                    style={{ animationDelay: `${i * 0.06}s`, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-foreground font-bold truncate">{r.username}</span>
                    <span className="shrink-0" style={{ color: isWin ? '#34d399' : isElim ? '#fb7185' : isLose ? '#f87171' : isRefund ? '#94a3b8' : '#a1a1aa' }}>
                      {isWin ? 'Winner' : isElim ? 'Eliminated' : r.result.charAt(0).toUpperCase() + r.result.slice(1)}
                    </span>
                    {isWin && (
                      <span className="tabular-nums font-bold shrink-0" style={{ color: '#34d399' }}>
                        +{formatMoney(r.payout ?? 0)}
                      </span>
                    )}
                    {isElim && (
                      <span className="tabular-nums shrink-0" style={{ color: '#fb7185' }}>
                        −{formatMoney(game.buy_in ?? 0)}
                      </span>
                    )}
                    {(isLose || isRefund) && !isElim && (
                      <span className="tabular-nums font-bold shrink-0" style={{ color: isRefund ? '#94a3b8' : '#f87171' }}>
                        {isRefund ? `Refund ${formatMoney(r.payout)}` : `−${formatMoney(game.buy_in ?? 0)}`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-2.5 border-t border-primary/20">
              <Link to="/casino/mp-blackjack"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border-2 text-[11px] font-heading font-bold uppercase tracking-wider active:scale-[0.97] transition-all"
                style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200', boxShadow: '0 3px 10px rgba(212,175,55,0.2)' }}>
                <Spade size={11} /> {noWinner ? 'Play Again' : 'New Game'}
              </Link>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
