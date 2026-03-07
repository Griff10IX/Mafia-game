import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, MessageSquare, CheckCircle2 } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const TURN_SECONDS = 60;
const START_COUNTDOWN = 5;

const SUITS = {
  H: { sym: '♥', color: '#dc2626' },
  D: { sym: '♦', color: '#dc2626' },
  C: { sym: '♣', color: '#1c1c1c' },
  S: { sym: '♠', color: '#1c1c1c' },
};

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
        className="relative w-[40px] h-[56px] sm:w-[44px] sm:h-[62px] rounded-lg overflow-hidden flex-shrink-0"
        style={{ transform: `rotate(${fan}deg) translateX(${offsetX}px)`, boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
      >
        <div className="absolute inset-0 rounded-lg" style={{ background: 'linear-gradient(135deg,#1a3a7a,#0d2255)', border: '2px solid #2a4a9a' }}>
          <div className="absolute inset-1 rounded border border-white/10 flex items-center justify-center">
            <span className="text-yellow-500/30 text-sm">♠</span>
          </div>
        </div>
      </div>
    );
  }
  const s = SUITS[card?.suit] || { sym: '?', color: '#666' };
  const isRed = card?.suit === 'H' || card?.suit === 'D';
  return (
    <div
      className="relative w-[40px] h-[56px] sm:w-[44px] sm:h-[62px] rounded-lg overflow-hidden flex-shrink-0"
      style={{ transform: `rotate(${fan}deg) translateX(${offsetX}px)`, boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
    >
      <div className="absolute inset-0 rounded-lg" style={{ background: 'linear-gradient(180deg,#fff,#f8f8f8)', border: `2px solid ${isRed ? '#fca5a5' : '#d4d4d8'}` }}>
        <div className="absolute top-0.5 left-1 leading-none" style={{ color: s.color }}>
          <div className="text-[9px] font-bold">{card?.value}</div>
          <div className="text-[8px]">{s.sym}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: s.color }}>
          <span className="text-lg">{s.sym}</span>
        </div>
        <div className="absolute bottom-0.5 right-1 leading-none rotate-180" style={{ color: s.color }}>
          <div className="text-[9px] font-bold">{card?.value}</div>
          <div className="text-[8px]">{s.sym}</div>
        </div>
      </div>
    </div>
  );
}

function PokerSeat({ p, isMe, isCurrent, showCards, isDealer }) {
  const hole = p.hole_cards || [];
  const folded = p.status === 'folded';
  const allIn = p.status === 'all_in';
  const stack = p.stack ?? 0;
  const currentBet = p.current_bet ?? 0;
  let badge = '—';
  if (folded) badge = 'Fold';
  else if (allIn) badge = 'All-in';
  else if (isCurrent) badge = 'Turn';
  else if (p.status === 'active') badge = '';

  return (
    <div
      className={`rounded-xl overflow-hidden border-2 p-2 transition-all ${
        isCurrent ? 'border-primary shadow-lg shadow-primary/20' : isMe ? 'border-primary/50' : 'border-primary/20'
      }`}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[9px] font-heading font-bold truncate text-foreground">
          {isDealer ? 'Dealer' : p.username}{isMe ? ' (You)' : ''}
        </span>
        {badge && (
          <span className="text-[8px] font-heading px-1.5 py-0.5 rounded bg-primary/20 text-primary">{badge}</span>
        )}
      </div>
      <div className="flex items-center gap-0.5 justify-center min-h-[52px]">
        {hole.length === 0 ? (
          <span className="text-[8px] text-mutedForeground">—</span>
        ) : (
          hole.map((c, i) => (
            <PlayingCard key={i} card={c} hidden={!showCards && !isMe} index={i} total={hole.length} />
          ))
        )}
      </div>
      <div className="text-[9px] font-heading text-mutedForeground mt-1">
        {formatMoney(stack)}
        {currentBet > 0 && <span className="text-primary ml-1">bet {formatMoney(currentBet)}</span>}
      </div>
    </div>
  );
}

export default function MPPokerGamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myUserId, setMyUserId] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const startTriggeredRef = useRef(false);
  const [countdown, setCountdown] = useState(null);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState(null);

  useEffect(() => {
    api.get('/auth/me').then((r) => setMyUserId(r.data?.id ?? null)).catch(() => setMyUserId(null));
  }, []);

  const fetchGame = useCallback(() => {
    if (!gameId) return;
    api
      .get(`/casino/mp-poker/games/${gameId}`)
      .then((r) => r.data)
      .then(setGame)
      .catch(() => setGame(null))
      .finally(() => setLoading(false));
  }, [gameId]);

  useEffect(() => {
    fetchGame();
    if (!gameId) return;
    const t = setInterval(fetchGame, 3000);
    return () => clearInterval(t);
  }, [fetchGame, gameId]);

  useEffect(() => {
    if (!game?.all_ready_at || game?.mode !== 'vs_players') return;
    const end = new Date(game.all_ready_at).getTime() + START_COUNTDOWN * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setCountdown(left);
      if (left <= 0 && !startTriggeredRef.current) {
        startTriggeredRef.current = true;
        api.post(`/casino/mp-poker/games/${gameId}/start`).then((r) => setGame(r.data)).catch(() => { startTriggeredRef.current = false; });
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [game?.all_ready_at, game?.mode, gameId]);

  useEffect(() => {
    if (!game?.turn_started_at || game?.status !== 'playing') return;
    const start = new Date(game.turn_started_at).getTime();
    const tick = () => {
      const elapsed = (Date.now() - start) / 1000;
      setTurnSecondsLeft(Math.max(0, Math.ceil(TURN_SECONDS - elapsed)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [game?.turn_started_at, game?.status]);

  const isVsDealer = game?.mode === 'vs_dealer';
  const players = game?.players || [];
  const board = game?.board || [];
  const pot = game?.pot ?? 0;
  const street = game?.street || '';
  const currentTurnIndex = game?.current_turn_index ?? -1;
  const myIndex = players.findIndex((p) => p.user_id === myUserId);
  const isMyTurn = currentTurnIndex >= 0 && currentTurnIndex < players.length && players[currentTurnIndex]?.user_id === myUserId;
  const showAllCards = street === 'showdown' || game?.status === 'completed';

  const act = async (action, amount) => {
    if (isVsDealer) {
      setActionLoading(true);
      try {
        const res = await api.post('/casino/mp-poker/vs-dealer/act', { action, amount: amount || undefined });
        setGame(res.data?.game ?? null);
        await refreshUser();
      } catch (e) {
        toast.error(getApiErrorMessage(e) || 'Failed');
      } finally {
        setActionLoading(false);
      }
    } else {
      setActionLoading(true);
      try {
        const res = await api.post(`/casino/mp-poker/games/${gameId}/act`, { action, amount: amount || undefined });
        setGame(res.data ?? null);
        await refreshUser();
      } catch (e) {
        toast.error(getApiErrorMessage(e) || 'Failed');
      } finally {
        setActionLoading(false);
      }
    }
  };

  const markReady = async () => {
    setReadyLoading(true);
    try {
      const res = await api.post(`/casino/mp-poker/games/${gameId}/ready`);
      setGame(res.data ?? null);
      toast.success("You're ready!");
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed');
    } finally {
      setReadyLoading(false);
    }
  };

  const triggerStart = () => {
    if (startTriggeredRef.current) return;
    startTriggeredRef.current = true;
    api.post(`/casino/mp-poker/games/${gameId}/start`).then((r) => setGame(r.data)).catch(() => { startTriggeredRef.current = false; });
  };

  const triggerTimeout = () => {
    api.post(`/casino/mp-poker/games/${gameId}/timeout`).then((r) => setGame(r.data)).catch(() => {});
  };

  const sendChat = (e) => {
    e?.preventDefault();
    const msg = chatInput.trim();
    if (!msg || sendingChat) return;
    setSendingChat(true);
    api.post(`/casino/mp-poker/games/${gameId}/chat`, { message: msg }).then((r) => { setGame(r.data); setChatInput(''); }).catch(() => {}).finally(() => setSendingChat(false));
  };

  if (loading && !game) {
    return (
      <div className={styles.pageContent}>
        <p className="text-primary font-heading">Loading game…</p>
      </div>
    );
  }
  if (!game) {
    return (
      <div className={styles.pageContent}>
        <p className="text-mutedForeground font-heading">Game not found.</p>
        <Link to="/casino/mp-poker" className="text-primary font-heading text-sm mt-2 inline-block">Back to Poker</Link>
      </div>
    );
  }

  const toCall = game.to_call ?? 0;
  const myPlayer = players[myIndex];
  const myCurrentBet = myPlayer?.current_bet ?? 0;
  const needToCall = toCall - myCurrentBet;
  const minRaise = game.min_raise ?? game.big_blind ?? 1;
  const myStack = myPlayer?.stack ?? 0;

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <style>{`
        @keyframes pkr-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .pkr-fade { animation: pkr-fade 0.3s ease-out both; }
      `}</style>

      <div className="flex items-center justify-between flex-wrap gap-2 pkr-fade">
        <Link to="/casino/mp-poker" className="inline-flex items-center gap-1 text-primary font-heading text-sm hover:underline">
          <ArrowLeft size={14} />
          Back
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-heading font-bold text-primary uppercase">Pot {formatMoney(pot)}</span>
          {street && <span className="text-[9px] text-mutedForeground font-heading uppercase">{street}</span>}
        </div>
      </div>

      {game.status === 'completed' && game.results && (
        <div className="p-4 rounded-lg border border-primary/30 bg-primary/10 pkr-fade">
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase mb-2">Result</h3>
          {game.results.map((r, i) => (
            <div key={i} className="text-[10px] font-heading flex justify-between">
              <span>{r.user_id === myUserId ? 'You' : r.user_id === 'dealer' ? 'Dealer' : r.user_id}</span>
              <span className={r.result === 'win' ? 'text-green-400' : 'text-mutedForeground'}>
                {r.result === 'win' ? `+${formatMoney(r.payout)}` : r.result}
                {r.hand && ` (${r.hand})`}
              </span>
            </div>
          ))}
          <Link to="/casino/mp-poker" className="inline-block mt-3 text-primary font-heading text-sm">New game</Link>
        </div>
      )}

      {game.mode === 'vs_players' && game.phase === 'lobby' && (
        <div className="p-4 rounded-lg border border-primary/20 pkr-fade">
          <p className="text-[10px] font-heading text-mutedForeground">Waiting for players… {players.length}/{game.max_players}</p>
          <ul className="mt-2 space-y-1">
            {players.map((p) => (
              <li key={p.user_id} className="text-[10px] font-heading">{p.username}</li>
            ))}
          </ul>
        </div>
      )}

      {game.mode === 'vs_players' && game.phase === 'ready' && (
        <div className="p-4 rounded-lg border border-primary/20 pkr-fade">
          <p className="text-[10px] font-heading font-bold text-primary uppercase">Ready up!</p>
          {countdown !== null && countdown > 0 && (
            <p className="text-sm font-heading mt-2">Starting in {countdown}s…</p>
          )}
          {countdown === 0 && <p className="text-sm font-heading mt-2">Dealing…</p>}
          {myIndex >= 0 && !players[myIndex]?.ready && (
            <button type="button" onClick={markReady} disabled={readyLoading} className="mt-3 px-4 py-2 rounded-lg bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm">
              {readyLoading ? '…' : "I'm Ready"}
            </button>
          )}
          {players.every((p) => p.ready) && countdown > 0 && <p className="text-[10px] text-mutedForeground mt-2">All ready. Game starts when countdown hits 0.</p>}
        </div>
      )}

      {(game.status === 'playing' || (game.status === 'completed' && !game.results)) && (
        <>
          <div className="flex flex-wrap justify-center gap-4 p-4 rounded-lg border border-primary/20 pkr-fade">
            {board.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-center items-center">
                {board.map((c, i) => (
                  <PlayingCard key={i} card={c} hidden={false} index={i} total={board.length} />
                ))}
              </div>
            )}
          </div>
          <div className={`grid gap-3 pkr-fade ${players.length <= 2 ? 'grid-cols-2 max-w-md mx-auto' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {players.map((p, idx) => (
              <PokerSeat
                key={p.user_id || idx}
                p={p}
                isMe={p.user_id === myUserId}
                isCurrent={idx === currentTurnIndex}
                showCards={showAllCards || p.status === 'folded'}
                isDealer={p.is_bot}
              />
            ))}
          </div>

          {isMyTurn && myPlayer?.status !== 'folded' && myPlayer?.status !== 'all_in' && game.status === 'playing' && (
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/10 pkr-fade">
              <button type="button" onClick={() => act('fold')} disabled={actionLoading} className="px-3 py-2 rounded border border-red-500/50 text-red-400 text-[10px] font-heading font-bold uppercase">
                Fold
              </button>
              {needToCall <= 0 && (
                <button type="button" onClick={() => act('check')} disabled={actionLoading} className="px-3 py-2 rounded bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase">
                  Check
                </button>
              )}
              {needToCall > 0 && (
                <button type="button" onClick={() => act('call')} disabled={actionLoading} className="px-3 py-2 rounded bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase">
                  Call {formatMoney(Math.min(needToCall, myStack))}
                </button>
              )}
              {myStack > 0 && (
                <>
                  <input
                    type="number"
                    min={needToCall > 0 ? minRaise : 1}
                    max={myStack}
                    placeholder="Amount"
                    className="w-24 px-2 py-1.5 rounded border border-border bg-secondary text-[10px]"
                    id="poker-raise-amt"
                  />
                  <button type="button" onClick={() => act('raise', parseInt(document.getElementById('poker-raise-amt')?.value, 10) || minRaise)} disabled={actionLoading} className="px-3 py-2 rounded bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase">
                    Raise
                  </button>
                  <button type="button" onClick={() => act('all_in')} disabled={actionLoading} className="px-3 py-2 rounded bg-primary/20 border border-primary/50 text-primary text-[10px] font-heading font-bold uppercase">
                    All-in
                  </button>
                </>
              )}
            </div>
          )}

          {turnSecondsLeft !== null && isMyTurn && game.status === 'playing' && (
            <div className="flex items-center gap-2 pkr-fade">
              <span className="text-[10px] font-heading">Your turn — {turnSecondsLeft}s</span>
              {turnSecondsLeft <= 5 && (
                <button type="button" onClick={triggerTimeout} className="text-[9px] text-mutedForeground underline">
                  Auto-fold
                </button>
              )}
            </div>
          )}
        </>
      )}

      {game.mode === 'vs_players' && game.chat?.length > 0 && (
        <div className="rounded-lg border border-primary/20 p-3 pkr-fade">
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase mb-2 flex items-center gap-1">
            <MessageSquare size={12} /> Chat
          </h3>
          <ul className="space-y-1 max-h-32 overflow-y-auto text-[10px] font-heading">
            {game.chat.slice(-20).map((c, i) => (
              <li key={i}><strong>{c.username}:</strong> {c.message}</li>
            ))}
          </ul>
          <form onSubmit={sendChat} className="flex gap-2 mt-2">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Message" className="flex-1 px-2 py-1.5 rounded border border-border bg-secondary text-[10px]" />
            <button type="submit" disabled={sendingChat || !chatInput.trim()} className="px-3 py-1.5 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold uppercase disabled:opacity-50">Send</button>
          </form>
        </div>
      )}
    </div>
  );
}
