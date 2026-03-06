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
    if (v === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(v)) {
      total += 10;
    } else {
      total += parseInt(v, 10) || 0;
    }
  }
  while (total > 21 && aces) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function PlayingCard({ card, hidden, index = 0, total }) {
  const fan = total > 1 ? (index - (total - 1) / 2) * 3 : 0;
  const offsetX = total > 1 ? (index - (total - 1) / 2) * 2 : 0;
  if (hidden) {
    return (
      <div
        className="relative w-[48px] h-[68px] sm:w-[56px] sm:h-[80px] rounded-lg overflow-hidden"
        style={{
          transform: `rotate(${fan}deg) translateX(${offsetX}px)`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)',
        }}
      >
        <div
          className="absolute inset-0 rounded-lg"
          style={{
            background: 'linear-gradient(135deg, #1a3a7a, #0d2255)',
            border: '2px solid #2a4a9a',
          }}
        >
          <div className="absolute inset-2 rounded border border-primary/20 flex items-center justify-center">
            <span className="text-primary/40 text-lg">♠</span>
          </div>
        </div>
      </div>
    );
  }
  const s = SUITS[card.suit] || { sym: '?', color: '#666' };
  const isRed = card.suit === 'H' || card.suit === 'D';
  return (
    <div
      className="relative w-[48px] h-[68px] sm:w-[56px] sm:h-[80px] rounded-lg overflow-hidden"
      style={{
        transform: `rotate(${fan}deg) translateX(${offsetX}px)`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)',
      }}
    >
      <div
        className="absolute inset-0 rounded-lg"
        style={{
          background: 'linear-gradient(180deg, #ffffff, #f8f8f8)',
          border: `2px solid ${isRed ? '#fca5a5' : '#d4d4d8'}`,
        }}
      >
        <div className="absolute top-0.5 left-1 leading-none" style={{ color: s.color }}>
          <div className="text-[10px] font-bold">{card.value}</div>
          <div className="text-[9px] -mt-0.5">{s.sym}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: s.color }}>
          <span className="text-xl opacity-90">{s.sym}</span>
        </div>
      </div>
    </div>
  );
}

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
  const chatEndRef = useRef(null);
  const timeoutTriggeredRef = useRef(null);

  useEffect(() => {
    api.get('/auth/me').then((r) => setMyUserId(r.data?.id ?? null)).catch(() => setMyUserId(null));
  }, []);

  const fetchGame = useCallback(() => {
    if (!gameId) return;
    api
      .get(`/casino/mp-blackjack/games/${gameId}`)
      .then((r) => setGame(r.data?.game ?? null))
      .catch(() => setGame(null))
      .finally(() => setLoading(false));
  }, [gameId]);

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
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const stand = async () => {
    if (!gameId || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/stand`);
      setGame(res.data?.game ?? null);
      await refreshUser();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const cancelGame = async () => {
    if (!gameId || cancelLoading) return;
    setCancelLoading(true);
    try {
      await api.post(`/casino/mp-blackjack/games/${gameId}/cancel`);
      await refreshUser();
      toast.success('Game cancelled; everyone refunded');
      navigate('/casino/mp-blackjack');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not cancel');
    } finally {
      setCancelLoading(false);
    }
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
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Send failed');
    } finally {
      setSendingChat(false);
    }
  };

  const triggerTimeout = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await api.post(`/casino/mp-blackjack/games/${gameId}/timeout`);
      setGame(res.data?.game ?? null);
    } catch (_) {}
  }, [gameId]);

  if (loading && !game) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <p className="text-[10px] text-mutedForeground font-heading">Loading game…</p>
      </div>
    );
  }
  if (!game) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <p className="text-[10px] text-mutedForeground font-heading">Game not found.</p>
        <Link to="/casino/mp-blackjack" className="text-primary font-heading text-sm hover:underline">
          Back to Multiplayer Blackjack
        </Link>
      </div>
    );
  }

  if (game.status === 'cancelled') {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <p className="text-[10px] text-mutedForeground font-heading">This game was cancelled. Everyone was refunded.</p>
        <Link to="/casino/mp-blackjack" className="text-primary font-heading text-sm hover:underline">
          Back to Multiplayer Blackjack
        </Link>
      </div>
    );
  }

  const status = game.status || 'open';
  const phase = game.phase || 'lobby';
  const players = game.players || [];
  const currentTurnIndex = game.current_turn_index ?? -1;
  const pot = game.pot ?? 0;
  const myIndex = players.findIndex((p) => p.user_id === myUserId);
  const isMyTurn = status === 'playing' && phase === 'playing' && currentTurnIndex >= 0 && currentTurnIndex < players.length && players[currentTurnIndex]?.user_id === myUserId;
  const cardLimit = game.card_limit ?? null;
  const myHandLength = isMyTurn && players[currentTurnIndex] ? (players[currentTurnIndex].hand || []).length : 0;
  const hitDisabled = actionLoading || (cardLimit != null && myHandLength >= cardLimit);
  const isCreator = game.creator_id === myUserId;

  const [turnSecondsLeft, setTurnSecondsLeft] = useState(null);
  const turnStartedAt = game.turn_started_at;
  useEffect(() => {
    if (status !== 'playing' || phase !== 'playing' || currentTurnIndex < 0 || !turnStartedAt) {
      setTurnSecondsLeft(null);
      return;
    }
    const compute = () => {
      const start = new Date(turnStartedAt).getTime();
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, Math.ceil(TURN_SECONDS - elapsed));
      return left;
    };
    setTurnSecondsLeft(compute());
    const t = setInterval(() => {
      const left = compute();
      setTurnSecondsLeft(left);
    }, 1000);
    return () => clearInterval(t);
  }, [status, phase, currentTurnIndex, turnStartedAt]);

  useEffect(() => {
    if (turnSecondsLeft !== 0 || status !== 'playing' || phase !== 'playing' || currentTurnIndex < 0) return;
    const key = `${currentTurnIndex}-${turnStartedAt}`;
    if (timeoutTriggeredRef.current === key) return;
    timeoutTriggeredRef.current = key;
    triggerTimeout();
  }, [turnSecondsLeft, status, phase, currentTurnIndex, turnStartedAt, triggerTimeout]);

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="mp-blackjack-game-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link
            to="/casino/mp-blackjack"
            className="p-1.5 rounded border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-heading font-bold text-primary uppercase tracking-wider">Multiplayer Blackjack</h1>
            <p className="text-[9px] text-mutedForeground font-heading">
              Pot {formatMoney(pot)} · {players.length} player{players.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {status === 'open' && (
        <div className={`${styles.panel} rounded-lg border border-primary/20 p-4 text-center`}>
          <p className="text-sm font-heading text-foreground">Waiting for players ({players.length}/{game.max_players ?? 6})</p>
          <ul className="mt-2 space-y-0.5 text-[10px] font-heading text-mutedForeground">
            {players.map((p) => (
              <li key={p.user_id}>{p.username}</li>
            ))}
          </ul>
          {isCreator && (
            <button
              type="button"
              disabled={cancelLoading}
              onClick={cancelGame}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-500/50 bg-red-500/10 text-red-400 font-heading text-[10px] uppercase hover:bg-red-500/20 disabled:opacity-50"
            >
              <XCircle size={12} /> {cancelLoading ? '…' : 'Cancel game'}
            </button>
          )}
        </div>
      )}

      {(status === 'playing' || status === 'completed') && (
        <>
          {/* Players */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {players.map((p, idx) => {
              const hand = p.hand || [];
              const isMe = p.user_id === myUserId;
              const isCurrent = idx === currentTurnIndex;
              const roundOver = status === 'completed';
              const opponentRevealed = roundOver || p.status === 'stood' || p.status === 'bust';
              const showOpponentCards = isMe || opponentRevealed;
              return (
                <div
                  key={p.user_id}
                  className={`rounded-lg border p-2 ${
                    isMe ? 'border-primary/50 bg-primary/10' : 'border-primary/20 bg-secondary/30'
                  } ${isCurrent ? 'ring-2 ring-primary/50' : ''}`}
                >
                  <p className="text-[10px] font-heading font-bold text-foreground truncate">
                    {p.username} {isMe && '(You)'}
                  </p>
                  <p className="text-[9px] text-mutedForeground font-heading">
                    {p.status === 'bust' ? 'Bust' : p.status === 'stood' ? 'Stand' : hand.length && showOpponentCards ? `Total: ${handTotal(hand)}` : hand.length && !showOpponentCards ? `${hand.length} card${hand.length !== 1 ? 's' : ''}` : '—'}
                  </p>
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {hand.map((card, i) => (
                      <PlayingCard key={i} card={card} hidden={!showOpponentCards} index={i} total={hand.length} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Turn timer */}
          {status === 'playing' && phase === 'playing' && currentTurnIndex >= 0 && turnSecondsLeft != null && (
            <p className="text-center text-[10px] font-heading text-mutedForeground">
              {isMyTurn ? (
                <span className={turnSecondsLeft <= 10 ? 'text-amber-400' : ''}>
                  Your turn — {turnSecondsLeft}s left
                </span>
              ) : (
                <span>
                  {players[currentTurnIndex]?.username ?? 'Player'}&apos;s turn — {turnSecondsLeft}s left
                </span>
              )}
            </p>
          )}

          {/* Hit / Stand */}
          {status === 'playing' && phase === 'playing' && isMyTurn && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={hitDisabled}
                onClick={hit}
                title={cardLimit != null && myHandLength >= cardLimit ? `Card limit (${cardLimit}) reached` : ''}
                className="px-4 py-2 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-sm uppercase hover:bg-primary/30 disabled:opacity-50"
              >
                Hit
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={stand}
                className="px-4 py-2 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-sm uppercase hover:bg-primary/30 disabled:opacity-50"
              >
                Stand
              </button>
            </div>
          )}

          {status === 'playing' && phase === 'playing' && !isMyTurn && myIndex >= 0 && (
            <p className="text-center text-[10px] text-mutedForeground font-heading">
              Waiting for {players[currentTurnIndex]?.username ?? 'player'}…
            </p>
          )}
        </>
      )}

      {/* In-game chat (open, playing, or completed) */}
      {(status === 'open' || status === 'playing' || status === 'completed') && myIndex >= 0 && (
        <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
          <div className="px-2.5 py-1.5 border-b border-primary/20 flex items-center gap-1.5">
            <MessageSquare size={12} className="text-primary" />
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Chat</span>
          </div>
          <div className="max-h-[140px] overflow-y-auto p-2 space-y-1 bg-secondary/20">
            {(game.chat || []).map((c, i) => (
              <div key={i} className="text-[10px] font-heading">
                <span className="text-primary/90 font-semibold">{c.username}:</span>{' '}
                <span className="text-foreground break-words">{c.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          {status !== 'completed' && (
            <form onSubmit={sendChat} className="p-2 border-t border-primary/20 flex gap-1.5">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message…"
                maxLength={500}
                className="flex-1 min-w-0 px-2 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm placeholder:text-mutedForeground"
              />
              <button
                type="submit"
                disabled={sendingChat || !chatInput.trim()}
                className="px-2.5 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary font-heading text-[10px] uppercase hover:bg-primary/30 disabled:opacity-50"
              >
                {sendingChat ? '…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}

      {status === 'completed' && (
        <div className={`${styles.panel} rounded-lg border border-primary/20 p-4`}>
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider mb-2">Results</h2>
          <ul className="space-y-1">
            {(game.results || []).map((r, i) => (
              <li key={i} className="text-[10px] font-heading flex justify-between gap-2">
                <span className="text-foreground">{r.username}</span>
                <span className={r.result === 'win' ? 'text-emerald-400' : r.result === 'lose' ? 'text-red-400' : 'text-mutedForeground'}>
                  {r.result === 'win' && `+${formatMoney(r.payout)}`}
                  {r.result === 'lose' && 'Lose'}
                  {r.result === 'refund' && `Refund ${formatMoney(r.payout)}`}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-3 border-t border-primary/20">
            <Link
              to="/casino/mp-blackjack"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary font-heading text-[10px] uppercase hover:bg-primary/30"
            >
              <Spade size={12} /> Back to games
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
