import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Spade, MessageSquare, XCircle } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const TURN_SECONDS = 60;

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
function PlayingCard({ card, hidden, index = 0, total }) {
  const fan = total > 1 ? (index - (total - 1) / 2) * 3 : 0;
  const offsetX = total > 1 ? (index - (total - 1) / 2) * 2 : 0;

  if (hidden) {
    return (
      <div className="relative w-[44px] h-[62px] sm:w-[52px] sm:h-[74px] rounded-lg overflow-hidden animate-card-deal flex-shrink-0"
        style={{ transform: `rotate(${fan}deg) translateX(${offsetX}px)`, animationDelay: `${index * 0.1}s`, boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
        <div className="absolute inset-0 rounded-lg" style={{ background: 'linear-gradient(135deg,#1a3a7a,#0d2255)', border: '2px solid #2a4a9a' }}>
          <div className="absolute inset-1 rounded border border-white/10"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(255,255,255,0.03) 4px,rgba(255,255,255,0.03) 8px),repeating-linear-gradient(-45deg,transparent,transparent 4px,rgba(255,255,255,0.03) 4px,rgba(255,255,255,0.03) 8px)' }}>
            <div className="absolute inset-2 rounded border border-yellow-500/20 flex items-center justify-center">
              <span className="text-yellow-500/30 text-base">♠</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = SUITS[card.suit] || { sym: '?', color: '#666' };
  const isRed = card.suit === 'H' || card.suit === 'D';
  return (
    <div className="relative w-[44px] h-[62px] sm:w-[52px] sm:h-[74px] rounded-lg overflow-hidden animate-card-deal flex-shrink-0"
      style={{ transform: `rotate(${fan}deg) translateX(${offsetX}px)`, animationDelay: `${index * 0.1}s`, boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
      <div className="absolute inset-0 rounded-lg" style={{ background: 'linear-gradient(180deg,#fff,#f8f8f8,#f0f0f0)', border: `2px solid ${isRed ? '#fca5a5' : '#d4d4d8'}` }}>
        <div className="absolute top-1 left-1.5 leading-none" style={{ color: s.color }}>
          <div className="text-[10px] font-bold">{card.value}</div>
          <div className="text-[9px] -mt-0.5">{s.sym}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: s.color }}>
          <span className="text-xl opacity-90" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.1))' }}>{s.sym}</span>
        </div>
        <div className="absolute bottom-1 right-1.5 leading-none rotate-180" style={{ color: s.color }}>
          <div className="text-[10px] font-bold">{card.value}</div>
          <div className="text-[9px] -mt-0.5">{s.sym}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Player Seat ─── */
function PlayerSeat({ p, isMe, isCurrent, showCards }) {
  const hand = p.hand || [];
  const total = handTotal(hand);
  const isBust = p.status === 'bust';
  const isStood = p.status === 'stood';

  let badgeLabel = '—';
  let badgeStyle = { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)' };
  if (isBust)         { badgeLabel = 'Bust';    badgeStyle = { background: 'rgba(248,113,113,0.2)', color: '#f87171' }; }
  else if (isStood)   { badgeLabel = 'Stand';   badgeStyle = { background: 'rgba(161,161,170,0.2)', color: '#a1a1aa' }; }
  else if (isCurrent) { badgeLabel = 'Playing'; badgeStyle = { background: 'rgba(212,175,55,0.2)', color: '#d4af37' }; }
  else if (hand.length && showCards) { badgeLabel = String(total); }
  else if (hand.length) { badgeLabel = `${hand.length}cd`; }

  return (
    <div className="rounded-xl overflow-hidden border-2 transition-all duration-300"
      style={{
        borderColor: isCurrent ? '#c9a84c' : isMe ? 'rgba(212,175,55,0.35)' : 'rgba(90,62,27,0.5)',
        background: isCurrent ? 'linear-gradient(180deg,rgba(212,175,55,0.07),rgba(0,0,0,0.3))' : 'rgba(0,0,0,0.28)',
        boxShadow: isCurrent ? '0 0 24px rgba(212,175,55,0.18),inset 0 0 20px rgba(0,0,0,0.2)' : 'none',
      }}>
      <div className="px-2.5 py-1.5 flex items-center justify-between gap-1"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.22)' }}>
        <span className="text-[9px] font-heading font-bold truncate"
          style={{ color: isMe ? '#d4af37' : 'rgba(255,255,255,0.75)', maxWidth: 72 }}>
          {p.username}{isMe ? ' (You)' : ''}
        </span>
        <span className="text-[8px] font-heading px-1.5 py-0.5 rounded-full flex-shrink-0" style={badgeStyle}>
          {badgeLabel}
        </span>
      </div>
      <div className="p-2 min-h-[84px] flex items-center justify-center flex-wrap gap-0.5">
        {hand.length === 0
          ? <span className="text-[8px] font-heading" style={{ color: 'rgba(255,255,255,0.1)' }}>waiting…</span>
          : hand.map((card, i) => (
              <PlayingCard key={i} card={card} hidden={!showCards} index={i} total={hand.length} />
            ))
        }
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
  const color = urgent ? '#f87171' : isMyTurn ? '#d4af37' : 'rgba(255,255,255,0.35)';
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

/* ══════════════════════════════════════════════════════════
   Main Page
   ══════════════════════════════════════════════════════════ */
export default function MPBlackjackGamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [prevStatus, setPrevStatus] = useState(null);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState(null);
  const chatEndRef = useRef(null);
  const timeoutTriggeredRef = useRef(null);

  useEffect(() => {
    api.get('/auth/me').then((r) => setMyUserId(r.data?.id ?? null)).catch(() => setMyUserId(null));
  }, []);

  const fetchGame = useCallback(() => {
    if (!gameId) return;
    api.get(`/casino/mp-blackjack/games/${gameId}`)
      .then((r) => {
        const g = r.data?.game ?? null;
        setGame(g);
        if (g?.status === 'completed' && prevStatus !== 'completed') {
          const myResult = g?.results?.find((res) => res.user_id === myUserId);
          if (myResult?.result === 'win' || myResult?.result === 'blackjack') {
            setShowWin(true);
            setTimeout(() => setShowWin(false), 3000);
          }
        }
        setPrevStatus(g?.status);
      })
      .catch(() => setGame(null))
      .finally(() => setLoading(false));
  }, [gameId, myUserId, prevStatus]);

  useEffect(() => {
    fetchGame();
    if (!gameId) return;
    const t = setInterval(fetchGame, 3000);
    return () => clearInterval(t);
  }, [fetchGame, gameId]);

  const hit = async () => {
    if (!gameId || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/hit`);
      setGame(res.data?.game ?? null);
      await refreshUser();
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const stand = async () => {
    if (!gameId || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/stand`);
      setGame(res.data?.game ?? null);
      await refreshUser();
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Failed'); }
    finally { setActionLoading(false); }
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

  const sendChat = async (e) => {
    e?.preventDefault();
    const msg = chatInput.trim();
    if (!gameId || !msg || sendingChat) return;
    setSendingChat(true);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/chat`, { message: msg });
      setGame(res.data?.game ?? null);
      setChatInput('');
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Send failed'); }
    finally { setSendingChat(false); }
  };

  const triggerTimeout = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/timeout`);
      setGame(res.data?.game ?? null);
    } catch (_) {}
  }, [gameId]);

  // ── Derived (after all hooks) ──
  const status = game?.status || 'open';
  const phase = game?.phase || 'lobby';
  const players = game?.players || [];
  const currentTurnIndex = game?.current_turn_index ?? -1;
  const pot = game?.pot ?? 0;
  const myIndex = players.findIndex((p) => p.user_id === myUserId);
  const isMyTurn = status === 'playing' && phase === 'playing' && currentTurnIndex >= 0 && currentTurnIndex < players.length && players[currentTurnIndex]?.user_id === myUserId;
  const cardLimit = game?.card_limit ?? null;
  const myHandLength = isMyTurn && players[currentTurnIndex] ? (players[currentTurnIndex].hand || []).length : 0;
  const hitDisabled = actionLoading || (cardLimit != null && myHandLength >= cardLimit);
  const isCreator = game?.creator_id === myUserId;
  const turnStartedAt = game?.turn_started_at;

  // Turn timer
  useEffect(() => {
    if (status !== 'playing' || phase !== 'playing' || currentTurnIndex < 0 || !turnStartedAt) {
      setTurnSecondsLeft(null); return;
    }
    const compute = () => {
      const start = new Date(turnStartedAt).getTime();
      return Math.max(0, Math.ceil(TURN_SECONDS - (Date.now() - start) / 1000));
    };
    setTurnSecondsLeft(compute());
    const t = setInterval(() => setTurnSecondsLeft(compute()), 1000);
    return () => clearInterval(t);
  }, [status, phase, currentTurnIndex, turnStartedAt]);

  // Auto-trigger timeout
  useEffect(() => {
    if (turnSecondsLeft !== 0 || status !== 'playing' || phase !== 'playing' || currentTurnIndex < 0) return;
    const key = `${currentTurnIndex}-${turnStartedAt}`;
    if (timeoutTriggeredRef.current === key) return;
    timeoutTriggeredRef.current = key;
    triggerTimeout();
  }, [turnSecondsLeft, status, phase, currentTurnIndex, turnStartedAt, triggerTimeout]);

  // ── Early returns (after ALL hooks) ──
  if (loading && !game) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <p className="text-[10px] text-mutedForeground font-heading animate-pulse">Loading table…</p>
      </div>
    );
  }
  if (!game) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <p className="text-[10px] text-mutedForeground font-heading">Game not found.</p>
        <Link to="/casino/mp-blackjack" className="text-primary font-heading text-sm hover:underline">← Back to Multiplayer Blackjack</Link>
      </div>
    );
  }
  if (game.status === 'cancelled') {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <div className="rounded-xl border p-6 text-center space-y-3" style={{ borderColor: 'rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.05)' }}>
          <p className="text-sm font-heading font-bold text-red-400 uppercase tracking-wider">Game Cancelled</p>
          <p className="text-[10px] text-mutedForeground font-heading">All bets have been refunded.</p>
          <Link to="/casino/mp-blackjack"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary font-heading text-[10px] uppercase hover:bg-primary/20">
            ← Back to games
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="mp-blackjack-game-page">
      <style>{`
        @keyframes card-deal {
          0%   { transform: translateY(-28px) rotate(-5deg) scale(0.8); opacity: 0; }
          100% { opacity: 1; }
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
        .animate-card-deal    { animation: card-deal 0.32s cubic-bezier(0.2,0.8,0.3,1) backwards; }
        .animate-bj-particle  { animation: bj-particle ease-in forwards; }
        .animate-result-slide { animation: result-slide 0.35s ease-out both; }
        .animate-turn-pulse   { animation: turn-pulse 1.4s ease-in-out infinite; }
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
            <h1 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Multiplayer Blackjack</h1>
            <p className="text-[9px] text-mutedForeground font-heading">
              Pot <span className="text-primary font-bold">{formatMoney(pot)}</span>
              {' · '}{players.length} player{players.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* ══ LOBBY ══ */}
      {status === 'open' && (
        <div className="rounded-xl overflow-hidden border-2"
          style={{
            borderColor: '#5a3e1b',
            background: 'linear-gradient(180deg,#0c3d1a 0%,#0a5e2a 20%,#0d7a35 50%,#0a5e2a 80%,#0c3d1a 100%)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5),inset 0 0 60px rgba(0,0,0,0.2)',
          }}>
          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,#c9a84c,#8b6914,#c9a84c,#5a3e1b)' }} />
          <div className="p-6 text-center space-y-4">
            <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
              style={{ background: 'linear-gradient(180deg,#ffd700,#c9a84c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Waiting for Players
            </p>
            <p className="text-[9px] font-heading uppercase tracking-wider" style={{ color: 'rgba(110,231,183,0.4)' }}>
              {players.length} / {game.max_players ?? 6} seated
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {players.map((p) => (
                <span key={p.user_id} className="px-3 py-1 rounded-full text-[9px] font-heading font-bold"
                  style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)', color: '#d4af37' }}>
                  {p.username}
                </span>
              ))}
            </div>
            {isCreator && (
              <button type="button" disabled={cancelLoading} onClick={cancelGame}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase disabled:opacity-50 transition-colors"
                style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                <XCircle size={11} />{cancelLoading ? 'Cancelling…' : 'Cancel Game'}
              </button>
            )}
          </div>
          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,#c9a84c,#8b6914,#c9a84c,#5a3e1b)' }} />
        </div>
      )}

      {/* ══ PLAYING / COMPLETED TABLE ══ */}
      {(status === 'playing' || status === 'completed') && (
        <div className="rounded-xl overflow-hidden border-2"
          style={{
            borderColor: '#5a3e1b',
            background: 'linear-gradient(180deg,#0c3d1a 0%,#0a5e2a 20%,#0d7a35 50%,#0a5e2a 80%,#0c3d1a 100%)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5),inset 0 0 60px rgba(0,0,0,0.2)',
          }}>
          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,#c9a84c,#8b6914,#c9a84c,#5a3e1b)' }} />

          <div className="p-4 space-y-4">
            {/* Dealer (completed only) */}
            {status === 'completed' && game.dealer_hand?.length > 0 && (
              <div className="text-center">
                <div className="inline-flex items-center gap-2 mb-2.5 px-3 py-1 rounded-full"
                  style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <span className="text-[9px] font-heading uppercase tracking-wider" style={{ color: 'rgba(110,231,183,0.55)' }}>Dealer</span>
                  <span className="text-sm font-heading font-bold"
                    style={{ color: (game.dealer_total ?? 0) > 21 ? '#f87171' : '#d4af37' }}>
                    {game.dealer_total ?? '?'}
                  </span>
                </div>
                <div className="flex justify-center gap-1.5 flex-wrap">
                  {game.dealer_hand.map((c, i) => (
                    <PlayingCard key={i} card={c} hidden={false} index={i} total={game.dealer_hand.length} />
                  ))}
                </div>
              </div>
            )}

            {/* Turn indicator + timer */}
            {status === 'playing' && phase === 'playing' && currentTurnIndex >= 0 && (
              <div className="flex items-center justify-center gap-3">
                {turnSecondsLeft != null && (
                  <TurnTimer seconds={turnSecondsLeft} isMyTurn={isMyTurn} />
                )}
                <span className="text-[10px] font-heading font-bold uppercase tracking-wider animate-turn-pulse"
                  style={{
                    color: isMyTurn ? '#d4af37' : 'rgba(255,255,255,0.45)',
                    textShadow: isMyTurn ? '0 0 12px rgba(212,175,55,0.4)' : 'none',
                  }}>
                  {isMyTurn ? '🎴 Your Turn' : `${players[currentTurnIndex]?.username ?? 'Player'}'s Turn`}
                </span>
              </div>
            )}

            {/* Player seats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {players.map((p, idx) => {
                const isMe = p.user_id === myUserId;
                const isCurrent = idx === currentTurnIndex;
                const roundOver = status === 'completed';
                const opponentRevealed = roundOver || p.status === 'stood' || p.status === 'bust';
                return (
                  <PlayerSeat
                    key={p.user_id}
                    p={p}
                    isMe={isMe}
                    isCurrent={isCurrent}
                    showCards={isMe || opponentRevealed}
                  />
                );
              })}
            </div>

            {/* Actions */}
            {status === 'playing' && phase === 'playing' && isMyTurn && (
              <div className="flex items-center justify-center gap-3 pt-1">
                <button type="button" disabled={hitDisabled} onClick={hit}
                  title={cardLimit != null && myHandLength >= cardLimit ? `Card limit (${cardLimit}) reached` : ''}
                  className="w-28 sm:w-32 rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider border-2 disabled:opacity-40 active:scale-[0.97] transition-all"
                  style={{ background: 'linear-gradient(180deg,#d4af37,#a08020,#8a6e18)', borderColor: '#c9a84c', color: '#1a1200', boxShadow: '0 4px 12px rgba(212,175,55,0.25)' }}>
                  {actionLoading ? '…' : 'Hit'}
                </button>
                <button type="button" disabled={actionLoading} onClick={stand}
                  className="w-28 sm:w-32 rounded-lg py-3 text-sm font-heading font-bold uppercase tracking-wider border disabled:opacity-40 active:scale-[0.97] transition-all"
                  style={{ background: '#27272a', borderColor: '#52525b', color: '#fff' }}>
                  {actionLoading ? '…' : 'Stand'}
                </button>
              </div>
            )}

            {status === 'playing' && phase === 'playing' && !isMyTurn && myIndex >= 0 && (
              <p className="text-center text-[9px] font-heading" style={{ color: 'rgba(110,231,183,0.3)' }}>
                Waiting for {players[currentTurnIndex]?.username ?? 'player'}…
              </p>
            )}
          </div>

          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,#c9a84c,#8b6914,#c9a84c,#5a3e1b)' }} />
        </div>
      )}

      {/* ══ CHAT ══ */}
      {(status === 'open' || status === 'playing' || status === 'completed') && myIndex >= 0 && (
        <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 border-b border-primary/20 flex items-center gap-1.5"
            style={{ background: 'rgba(234,179,8,0.06)' }}>
            <MessageSquare size={11} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Table Chat</span>
          </div>
          <div className="max-h-[130px] overflow-y-auto p-2.5 space-y-1.5" style={{ background: 'rgba(0,0,0,0.2)' }}>
            {(game.chat || []).length === 0
              ? <p className="text-[9px] font-heading text-center py-2" style={{ color: 'rgba(255,255,255,0.15)' }}>No messages yet…</p>
              : (game.chat || []).map((c, i) => (
                  <div key={i} className="text-[9px] font-heading leading-relaxed">
                    <span className="font-semibold" style={{ color: '#c9a84c' }}>{c.username}:</span>{' '}
                    <span className="text-foreground break-words">{c.message}</span>
                  </div>
                ))
            }
            <div ref={chatEndRef} />
          </div>
          {status !== 'completed' && (
            <form onSubmit={sendChat} className="p-2 border-t border-primary/20 flex gap-1.5">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Say something…"
                maxLength={500}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[11px] font-heading placeholder:text-mutedForeground focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(234,179,8,0.15)', color: 'inherit' }}
              />
              <button type="submit" disabled={sendingChat || !chatInput.trim()}
                className="px-3 py-1.5 rounded-lg text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors">
                {sendingChat ? '…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ══ RESULTS ══ */}
      {status === 'completed' && (
        <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20`}>
          <div className="px-3 py-2 border-b border-primary/20" style={{ background: 'rgba(234,179,8,0.06)' }}>
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest">Results</span>
          </div>
          <div className="p-2.5 space-y-1.5">
            {(game.results || []).map((r, i) => {
              const isWin = r.result === 'win' || r.result === 'blackjack';
              const isLose = r.result === 'lose' || r.result === 'bust';
              const profit = isWin ? (r.payout ?? 0) - (r.bet ?? 0) : isLose ? -(r.bet ?? 0) : 0;
              return (
                <div key={i} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[9px] font-heading animate-result-slide"
                  style={{ animationDelay: `${i * 0.06}s`, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="text-foreground font-bold">{r.username}</span>
                  <span style={{ color: isWin ? '#34d399' : isLose ? '#f87171' : '#a1a1aa' }}>
                    {r.result === 'blackjack' ? 'Blackjack!' : r.result.charAt(0).toUpperCase() + r.result.slice(1)}
                  </span>
                  <span className="tabular-nums font-bold" style={{ color: profit > 0 ? '#34d399' : profit < 0 ? '#f87171' : '#a1a1aa' }}>
                    {profit > 0 ? `+${formatMoney(profit)}` : profit < 0 ? `−${formatMoney(Math.abs(profit))}` : r.result === 'refund' ? `Refund ${formatMoney(r.payout)}` : 'Push'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-2.5 border-t border-primary/20">
            <Link to="/casino/mp-blackjack"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 text-[9px] font-heading font-bold uppercase tracking-wider active:scale-[0.97] transition-all"
              style={{ background: 'linear-gradient(180deg,#d4af37,#a08020)', borderColor: '#c9a84c', color: '#1a1200', boxShadow: '0 3px 10px rgba(212,175,55,0.2)' }}>
              <Spade size={11} /> New Game
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
