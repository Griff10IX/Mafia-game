import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, MessageSquare, CheckCircle2, XCircle } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import styles from '../../styles/noir.module.css';

const TURN_SECONDS = 60;
const START_COUNTDOWN = 5;

const SUITS = {
  H: { sym: '♥', color: '#dc2626' },
  D: { sym: '♦', color: '#dc2626' },
  C: { sym: '♣', color: '#e8e0d0' },
  S: { sym: '♠', color: '#e8e0d0' },
};

const STREET_LABELS = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${Math.trunc(num).toLocaleString()}`;
}
function formatMoneyFull(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

/* ─── Win Particles ─── */
function WinParticles({ active }) {
  const [particles] = useState(() =>
    Array.from({ length: 24 }, (_, i) => ({
      id: i, left: 4 + Math.random() * 92,
      delay: Math.random() * 0.8, duration: 1.2 + Math.random() * 0.9,
      rotate: Math.random() * 540 - 270,
      emoji: ['🪙', '✨', '🃏', '💰', '♠'][i % 5], size: 14 + Math.random() * 14,
    }))
  );
  if (!active) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
      {particles.map((p) => (
        <span key={p.id} className="absolute"
          style={{
            left: `${p.left}%`, top: '-5%', fontSize: p.size,
            animation: `pkr-particle ${p.duration}s ease-in forwards`,
            animationDelay: `${p.delay}s`,
            '--p-rotate': `${p.rotate}deg`,
          }}>
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

/* ─── Playing Card ─── */
function Card({ card, hidden, index = 0, total = 1, small = false }) {
  const w = small ? 'w-[32px] h-[46px]' : 'w-[44px] h-[62px] sm:w-[52px] sm:h-[74px]';
  const fan = total > 1 ? (index - (total - 1) / 2) * 4 : 0;
  const offsetX = total > 1 ? (index - (total - 1) / 2) * 3 : 0;
  const style = { transform: `rotate(${fan}deg) translateX(${offsetX}px)`, animationDelay: `${index * 0.08}s`, boxShadow: '0 3px 12px rgba(0,0,0,0.55)', flexShrink: 0 };

  if (hidden) {
    return (
      <div className={`relative ${w} rounded-md overflow-hidden animate-pkr-deal`} style={style}>
        <div className="absolute inset-0 rounded-md" style={{ background: 'linear-gradient(135deg,#1a3a7a,#0d2255)', border: '2px solid #2a4a9a' }}>
          <div className="absolute inset-1 rounded" style={{ backgroundImage: 'repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,0.03) 3px,rgba(255,255,255,0.03) 6px)' }}>
            <div className="absolute inset-1.5 rounded border border-yellow-500/20 flex items-center justify-center">
              <span className="text-yellow-500/25 text-sm">♠</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const s = SUITS[card?.suit] || { sym: '?', color: '#888' };
  const isRed = card?.suit === 'H' || card?.suit === 'D';
  return (
    <div className={`relative ${w} rounded-md overflow-hidden animate-pkr-deal`} style={style}>
      <div className="absolute inset-0 rounded-md" style={{ background: 'linear-gradient(180deg,#fff,#f4f4f4)', border: `2px solid ${isRed ? '#fca5a5' : '#c4c4c8'}` }}>
        <div className="absolute top-0.5 left-1 leading-none" style={{ color: s.color }}>
          <div className={`${small ? 'text-[8px]' : 'text-[10px]'} font-black`}>{card?.value}</div>
          <div className={`${small ? 'text-[7px]' : 'text-[9px]'} -mt-0.5`}>{s.sym}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: s.color }}>
          <span className={`${small ? 'text-base' : 'text-xl'} opacity-85`}>{s.sym}</span>
        </div>
        <div className="absolute bottom-0.5 right-1 leading-none rotate-180" style={{ color: s.color }}>
          <div className={`${small ? 'text-[8px]' : 'text-[10px]'} font-black`}>{card?.value}</div>
          <div className={`${small ? 'text-[7px]' : 'text-[9px]'} -mt-0.5`}>{s.sym}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Chip Stack ─── */
function ChipStack({ amount, small = false }) {
  if (!amount || amount <= 0) return null;
  const colors = ['#e53e3e', '#3182ce', '#38a169', '#d4af37', '#805ad5'];
  const count = Math.min(5, Math.ceil(Math.log10(amount + 1)));
  return (
    <div className="inline-flex flex-col-reverse items-center" style={{ gap: 1 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-full border border-black/30"
          style={{
            width: small ? 12 : 16, height: small ? 4 : 5,
            background: colors[i % colors.length],
            boxShadow: `0 1px 2px rgba(0,0,0,0.4)`,
            transform: `translateY(${i * (small ? 1 : 1.5)}px)`,
          }} />
      ))}
      {amount > 0 && (
        <span className="text-[7px] font-heading font-bold text-yellow-300 mt-0.5" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          {formatMoney(amount)}
        </span>
      )}
    </div>
  );
}

/* ─── Turn Timer Arc ─── */
function TurnTimer({ seconds, isMyTurn }) {
  const pct = Math.max(0, seconds / TURN_SECONDS);
  const r = 16;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const urgent = seconds <= 10;
  const color = urgent ? '#f87171' : isMyTurn ? '#d4af37' : 'rgba(255,255,255,0.4)';
  return (
    <svg width="38" height="38" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx="19" cy="19" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
      <circle cx="19" cy="19" r={r} fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.9s linear, stroke 0.3s' }} />
      <text x="19" y="19" textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize="10" fontWeight="700" fontFamily="Cinzel, serif"
        transform="rotate(90,19,19)">{seconds}</text>
    </svg>
  );
}

/* ─── Start Countdown Ring ─── */
function StartCountdown({ seconds }) {
  const pct = Math.max(0, seconds / START_COUNTDOWN);
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="64" height="64" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(212,175,55,0.1)" strokeWidth="3.5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="#d4af37" strokeWidth="3.5"
          strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.9s linear' }} />
        <text x="32" y="32" textAnchor="middle" dominantBaseline="central"
          fill="#d4af37" fontSize="20" fontWeight="700" fontFamily="Cinzel, serif"
          transform="rotate(90,32,32)">{seconds}</text>
      </svg>
      <p className="text-[9px] font-heading font-bold uppercase tracking-[0.2em] animate-pkr-pulse"
        style={{ background: 'linear-gradient(180deg,#ffd700,#c9a84c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        Game Starting…
      </p>
    </div>
  );
}

/* ─── Player Seat (oval layout) ─── */
function PlayerSeat({ p, isMe, isCurrent, showHole, isDealer, seatPos, totalSeats }) {
  const hole = p.hole_cards || [];
  const folded = p.status === 'folded';
  const allIn = p.status === 'all_in';
  const ready = p.ready;
  const waiting = p.status === 'waiting';
  const stack = p.stack ?? 0;
  const bet = p.current_bet ?? 0;

  let borderColor = 'rgba(90,62,27,0.6)';
  let glow = 'none';
  if (isCurrent) { borderColor = '#c9a84c'; glow = '0 0 20px rgba(212,175,55,0.35)'; }
  else if (isMe) { borderColor = 'rgba(212,175,55,0.4)'; }
  else if (folded) { borderColor = 'rgba(255,255,255,0.1)'; }

  let statusBadge = null;
  if (folded) statusBadge = { label: 'Folded', color: '#6b7280' };
  else if (allIn) statusBadge = { label: 'All-In', color: '#f59e0b' };
  else if (isCurrent) statusBadge = { label: 'Turn', color: '#d4af37' };
  else if (waiting && ready) statusBadge = { label: '✓ Ready', color: '#34d399' };
  else if (waiting) statusBadge = { label: 'Waiting', color: '#6b7280' };

  return (
    <div className="flex flex-col items-center gap-1" style={{ opacity: folded ? 0.45 : 1, transition: 'opacity 0.3s' }}>
      {/* Cards above/beside seat */}
      <div className="flex items-center gap-0.5 mb-0.5" style={{ minHeight: 36 }}>
        {hole.length === 0
          ? <div className="w-[28px] h-[38px] rounded border border-white/5" style={{ background: 'rgba(0,0,0,0.2)' }} />
          : hole.map((c, i) => (
              <Card key={i} card={c} hidden={!showHole} index={i} total={hole.length} small />
            ))
        }
      </div>

      {/* Seat chip */}
      <div className="relative rounded-xl border-2 transition-all duration-300 px-2 py-1.5"
        style={{
          borderColor, boxShadow: glow,
          background: isCurrent
            ? 'linear-gradient(180deg,rgba(212,175,55,0.1),rgba(0,0,0,0.4))'
            : 'rgba(0,0,0,0.4)',
          minWidth: 70, maxWidth: 90,
        }}>
        {isDealer && (
          <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black z-10"
            style={{ background: '#d4af37', color: '#1a1200', border: '1.5px solid #1a1200' }}>D</div>
        )}
        <div className="text-center">
          <div className="text-[9px] font-heading font-bold truncate"
            style={{ color: isMe ? '#d4af37' : 'rgba(255,255,255,0.85)', maxWidth: 80 }}>
            {p.username}{isMe ? ' ★' : ''}
          </div>
          <div className="text-[8px] font-heading" style={{ color: 'rgba(110,231,183,0.6)' }}>
            {formatMoney(stack)}
          </div>
          {statusBadge && (
            <div className="text-[7px] font-heading font-bold mt-0.5" style={{ color: statusBadge.color }}>
              {statusBadge.label}
            </div>
          )}
        </div>
      </div>

      {/* Bet chips */}
      {bet > 0 && (
        <div className="mt-0.5">
          <ChipStack amount={bet} small />
        </div>
      )}
    </div>
  );
}

/* ─── Oval Table positions ─── */
function getTablePositions(totalSeats) {
  // Returns array of {x, y} as percentages for seat container positioning
  // Arranged around an oval: x 10-90%, y 5-85%
  const positions = {
    2: [{ x: 50, y: 88 }, { x: 50, y: 5 }],
    3: [{ x: 50, y: 88 }, { x: 10, y: 30 }, { x: 90, y: 30 }],
    4: [{ x: 50, y: 88 }, { x: 8, y: 45 }, { x: 50, y: 5 }, { x: 92, y: 45 }],
    5: [{ x: 50, y: 88 }, { x: 8, y: 60 }, { x: 18, y: 12 }, { x: 82, y: 12 }, { x: 92, y: 60 }],
    6: [{ x: 50, y: 90 }, { x: 8, y: 65 }, { x: 8, y: 20 }, { x: 50, y: 5 }, { x: 92, y: 20 }, { x: 92, y: 65 }],
    7: [{ x: 50, y: 90 }, { x: 10, y: 70 }, { x: 5, y: 35 }, { x: 25, y: 5 }, { x: 75, y: 5 }, { x: 95, y: 35 }, { x: 90, y: 70 }],
    8: [{ x: 50, y: 90 }, { x: 12, y: 72 }, { x: 2, y: 48 }, { x: 12, y: 14 }, { x: 50, y: 4 }, { x: 88, y: 14 }, { x: 98, y: 48 }, { x: 88, y: 72 }],
    9: [{ x: 50, y: 90 }, { x: 14, y: 78 }, { x: 2, y: 52 }, { x: 6, y: 22 }, { x: 30, y: 4 }, { x: 70, y: 4 }, { x: 94, y: 22 }, { x: 98, y: 52 }, { x: 86, y: 78 }],
  };
  return positions[totalSeats] || positions[6];
}

/* ══════════════════════════════════════════════════════════
   Main Game Page
   ══════════════════════════════════════════════════════════ */
export default function MPPokerGamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myUserId, setMyUserId] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState('');
  const [startSecondsLeft, setStartSecondsLeft] = useState(null);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState(null);
  const [prevStatus, setPrevStatus] = useState(null);
  const [helpPanelOpen, setHelpPanelOpen] = useState(false);
  const startTriggeredRef = useRef(false);
  const timeoutTriggeredRef = useRef(null);
  const chatEndRef = useRef(null);
  const isVsDealer = game?.mode === 'vs_dealer';

  useEffect(() => {
    api.get('/auth/me').then((r) => setMyUserId(r.data?.id ?? null)).catch(() => {});
  }, []);

  const fetchGame = useCallback(() => {
    if (!gameId) return;
    const endpoint = isVsDealer
      ? '/casino/mp-poker/vs-dealer/game'
      : `/casino/mp-poker/games/${gameId}`;
    api.get(endpoint)
      .then((r) => {
        const g = isVsDealer ? (r.data?.game ?? null) : (r.data ?? null);
        setGame((prev) => {
          if (g?.status === 'completed' && prev?.status !== 'completed') {
            const myResult = (g?.results || []).find((res) => res.user_id === myUserId);
            if (myResult?.result === 'win') {
              setShowWin(true);
              setTimeout(() => setShowWin(false), 4000);
            }
          }
          setPrevStatus(g?.status);
          return g;
        });
      })
      .catch(() => setGame(null))
      .finally(() => setLoading(false));
  }, [gameId, isVsDealer, myUserId]);

  // Poll faster when all-in (board still being dealt) or bot's turn
  const pollInterval = (() => {
    if (!game) return 3000;
    const allInActive = (game.players || []).some((p) => p.status === 'all_in') && game.status === 'playing';
    const botTurn = game.mode === 'vs_dealer' && game.current_turn_index === 1 && game.status === 'playing';
    return (allInActive || botTurn) ? 1500 : 3000;
  })();

  useEffect(() => {
    fetchGame();
    const t = setInterval(fetchGame, pollInterval);
    return () => clearInterval(t);
  }, [fetchGame, pollInterval]);

  // Start countdown timer
  useEffect(() => {
    if (!game?.all_ready_at || game?.phase !== 'ready') {
      setStartSecondsLeft(null);
      startTriggeredRef.current = false;
      return;
    }
    const compute = () => Math.max(0, Math.ceil(START_COUNTDOWN - (Date.now() - new Date(game.all_ready_at).getTime()) / 1000));
    setStartSecondsLeft(compute());
    const t = setInterval(() => setStartSecondsLeft(compute()), 500);
    return () => clearInterval(t);
  }, [game?.all_ready_at, game?.phase]);

  // Auto-trigger start
  useEffect(() => {
    if (startSecondsLeft !== 0 || game?.phase !== 'ready' || !game?.all_ready_at) return;
    if (startTriggeredRef.current) return;
    startTriggeredRef.current = true;
    api.post(`/casino/mp-poker/games/${gameId}/start`)
      .then((r) => setGame(r.data ?? null))
      .catch(() => { startTriggeredRef.current = false; });
  }, [startSecondsLeft, game?.phase, game?.all_ready_at, gameId]);

  // Turn timer
  useEffect(() => {
    if (!game?.turn_started_at || game?.status !== 'playing') {
      setTurnSecondsLeft(null); return;
    }
    const compute = () => Math.max(0, Math.ceil(TURN_SECONDS - (Date.now() - new Date(game.turn_started_at).getTime()) / 1000));
    setTurnSecondsLeft(compute());
    const t = setInterval(() => setTurnSecondsLeft(compute()), 1000);
    return () => clearInterval(t);
  }, [game?.turn_started_at, game?.status]);

  // Auto-timeout
  useEffect(() => {
    if (turnSecondsLeft !== 0 || game?.status !== 'playing') return;
    const key = `${game?.current_turn_index}-${game?.turn_started_at}`;
    if (timeoutTriggeredRef.current === key) return;
    const players = game?.players || [];
    if (players[game?.current_turn_index]?.user_id !== myUserId) return;
    timeoutTriggeredRef.current = key;
    api.post(`/casino/mp-poker/games/${gameId}/timeout`).then((r) => setGame(r.data ?? null)).catch(() => {});
  }, [turnSecondsLeft, game, myUserId, gameId]);

  // Ready notification
  useEffect(() => {
    if (game?.phase === 'ready' && game?.all_ready_at && prevStatus !== 'ready') {
      toast.success('All players ready — game starting!', { duration: 4000 });
    }
  }, [game?.phase, game?.all_ready_at, prevStatus]);

  const act = async (action, amount) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const endpoint = isVsDealer ? '/casino/mp-poker/vs-dealer/act' : `/casino/mp-poker/games/${gameId}/act`;
      const res = await api.post(endpoint, { action, amount: amount || undefined });
      setGame(isVsDealer ? (res.data?.game ?? null) : (res.data ?? null));
      await refreshUser();
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Action failed'); }
    finally { setActionLoading(false); }
  };

  const markReady = async () => {
    setReadyLoading(true);
    try {
      const res = await api.post(`/casino/mp-poker/games/${gameId}/ready`);
      setGame(res.data ?? null);
      toast.success("You're ready!");
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Failed'); }
    finally { setReadyLoading(false); }
  };

  const cancelGame = async () => {
    setCancelLoading(true);
    try {
      await api.post(`/casino/mp-poker/games/${gameId}/cancel`);
      await refreshUser();
      toast.success('Game cancelled; everyone refunded');
      navigate('/casino/mp-poker');
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not cancel'); }
    finally { setCancelLoading(false); }
  };

  const sendChat = (e) => {
    e?.preventDefault();
    const msg = chatInput.trim();
    if (!msg || sendingChat) return;
    setSendingChat(true);
    api.post(`/casino/mp-poker/games/${gameId}/chat`, { message: msg })
      .then((r) => { setGame(r.data ?? null); setChatInput(''); chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); })
      .catch(() => {})
      .finally(() => setSendingChat(false));
  };

  // ── Derived ──
  const players = game?.players || [];
  const board = game?.board || [];
  const pot = game?.pot ?? 0;
  const street = game?.street || '';
  const phase = game?.phase || 'lobby';
  const status = game?.status || 'open';
  const currentTurnIndex = game?.current_turn_index ?? -1;
  const myIndex = players.findIndex((p) => p.user_id === myUserId);
  const myPlayer = players[myIndex];
  const isMyTurn = !isVsDealer
    ? (currentTurnIndex >= 0 && currentTurnIndex < players.length && players[currentTurnIndex]?.user_id === myUserId)
    : (currentTurnIndex === 0);
  const toCall = game?.to_call ?? 0;
  const myCurrentBet = myPlayer?.current_bet ?? 0;
  const needToCall = Math.max(0, toCall - myCurrentBet);
  const minRaise = game?.min_raise ?? game?.big_blind ?? 1;
  const myStack = myPlayer?.stack ?? 0;
  const showAllCards = street === 'showdown' || status === 'completed';
  const amIPlayer = myIndex >= 0;
  const amIReady = myPlayer?.ready || false;
  const activePlayers = players.filter((p) => p.status !== 'folded');
  const allReady = players.length >= 2 && players.every((p) => p.ready);
  const allReadyAt = game?.all_ready_at;
  const buttonIndex = game?.button_index ?? 0;
  const isCreator = game?.creator_id === myUserId;

  // Seat positions on oval table
  const maxSeats = game?.max_players || players.length || 6;
  const tablePositions = getTablePositions(Math.min(9, Math.max(2, players.length || maxSeats)));

  if (loading && !game) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <p className="text-[10px] text-mutedForeground font-heading animate-pulse">Entering the poker room…</p>
      </div>
    );
  }
  if (!game) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <p className="text-[10px] text-mutedForeground font-heading">Game not found.</p>
        <Link to="/casino/mp-poker" className="text-primary font-heading text-sm hover:underline">← Back to Poker</Link>
      </div>
    );
  }
  if (status === 'cancelled') {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <div className="rounded-xl border p-6 text-center space-y-3" style={{ borderColor: 'rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.05)' }}>
          <p className="text-sm font-heading font-bold text-red-400 uppercase tracking-wider">Table Cancelled</p>
          <p className="text-[10px] text-mutedForeground font-heading">All buy-ins have been refunded.</p>
          <Link to="/casino/mp-poker"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary font-heading text-[10px] uppercase hover:bg-primary/20">
            ← Back to Poker
          </Link>
        </div>
      </div>
    );
  }

  const goldBar = { height: 3, background: 'linear-gradient(90deg,#5a3e1b,#c9a84c,#8b6914,#c9a84c,#5a3e1b)' };
  const feltBg = {
    background: 'radial-gradient(ellipse 90% 70% at 50% 50%, #0d7a35 0%, #0a5e2a 50%, #0c3d1a 100%)',
    boxShadow: 'inset 0 0 80px rgba(0,0,0,0.4), 0 4px 24px rgba(0,0,0,0.5)',
  };

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="mp-poker-game-page">
      <style>{`
        @keyframes pkr-deal {
          0%   { transform: translateY(-20px) scale(0.85); opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes pkr-particle {
          0%   { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          70%  { opacity: 1; }
          100% { transform: translateY(600px) rotate(var(--p-rotate,180deg)) scale(0.3); opacity: 0; }
        }
        @keyframes pkr-pulse {
          0%,100% { opacity: 0.5; }
          50%     { opacity: 1; }
        }
        @keyframes pkr-fade-in {
          from { opacity:0; transform:translateY(6px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes pkr-ready-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(212,175,55,0); }
          50%     { box-shadow: 0 0 0 8px rgba(212,175,55,0.15); }
        }
        @keyframes pkr-chip-bounce {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-3px); }
        }
        .animate-pkr-deal    { animation: pkr-deal 0.28s cubic-bezier(0.2,0.8,0.3,1) backwards; }
        .animate-pkr-fade    { animation: pkr-fade-in 0.35s ease-out both; }
        .animate-pkr-pulse   { animation: pkr-pulse 1.4s ease-in-out infinite; }
        .animate-pkr-ready   { animation: pkr-ready-pulse 2s ease-in-out infinite; }
        .animate-pkr-chip    { animation: pkr-chip-bounce 1.2s ease-in-out infinite; }
      `}</style>

      <WinParticles active={showWin} />

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 animate-pkr-fade">
        <div className="flex items-center gap-2">
          <Link to="/casino/mp-poker"
            className="p-1.5 rounded border border-primary/20 text-primary hover:bg-primary/10 transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 className="text-base font-heading font-bold text-primary uppercase tracking-wider">
              {isVsDealer ? 'Vs Dealer' : 'Poker Table'}
            </h1>
            <p className="text-[9px] text-mutedForeground font-heading">
              {street ? <span className="text-yellow-400/80 font-bold">{STREET_LABELS[street] || street}</span> : 'Hold\'em'}
              {' · '}Pot <span className="text-primary font-bold">{formatMoneyFull(pot)}</span>
              {game?.hand_number > 0 && ` · Hand #${game.hand_number}`}
            </p>
          </div>
        </div>
        {/* My hole cards condensed in header when game is active */}
        {myPlayer && (street === 'preflop' || street === 'flop' || street === 'turn' || street === 'river') && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.2)' }}>
            <span className="text-[8px] font-heading text-primary/60 mr-1">You</span>
            {(myPlayer.hole_cards || []).map((c, i) => (
              <Card key={i} card={c} hidden={false} index={i} total={2} small />
            ))}
          </div>
        )}
      </div>

      {/* ══ LOBBY ══ */}
      {phase === 'lobby' && status === 'open' && (
        <div className="rounded-xl overflow-hidden border-2 animate-pkr-fade" style={{ borderColor: '#5a3e1b' }}>
          <div style={goldBar} />
          <div className="p-5" style={feltBg}>
            <div className="text-center space-y-4">
              <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
                style={{ background: 'linear-gradient(180deg,#ffd700,#c9a84c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Waiting for Players
              </p>
              <p className="text-[9px] font-heading" style={{ color: 'rgba(110,231,183,0.4)' }}>
                {players.length} / {game.max_players} seated
                {game.big_blind && ` · Blinds ${formatMoney(game.small_blind)}/${formatMoney(game.big_blind)}`}
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase"
                  style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                  <XCircle size={11} />{cancelLoading ? '…' : 'Cancel Table'}
                </button>
              )}
            </div>
          </div>
          <div style={goldBar} />
        </div>
      )}

      {/* ══ READY PHASE ══ */}
      {phase === 'ready' && (
        <div className="rounded-xl overflow-hidden border-2 animate-pkr-fade" style={{ borderColor: '#5a3e1b' }}>
          <div style={goldBar} />
          <div className="p-5 space-y-5" style={feltBg}>
            <div className="text-center space-y-1">
              <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
                style={{ background: 'linear-gradient(180deg,#ffd700,#c9a84c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Table Full — Ready Up!
              </p>
              <p className="text-[9px] font-heading" style={{ color: 'rgba(110,231,183,0.4)' }}>
                All players must ready before blinds are posted
              </p>
            </div>

            {allReady && allReadyAt ? (
              <div className="flex justify-center">
                <StartCountdown seconds={startSecondsLeft ?? START_COUNTDOWN} />
              </div>
            ) : (
              amIPlayer && (
                <div className="flex justify-center">
                  {amIReady ? (
                    <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-heading font-bold text-[10px] uppercase"
                      style={{ background: 'rgba(52,211,153,0.1)', border: '2px solid rgba(52,211,153,0.35)', color: '#34d399' }}>
                      <CheckCircle2 size={14} /> You're Ready
                    </div>
                  ) : (
                    <button type="button" disabled={readyLoading} onClick={markReady}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border-2 font-heading font-bold text-[11px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50 animate-pkr-ready"
                      style={{ background: 'linear-gradient(180deg,#d4af37,#a08020)', borderColor: '#c9a84c', color: '#1a1200', boxShadow: '0 4px 16px rgba(212,175,55,0.3)' }}>
                      <CheckCircle2 size={15} />
                      {readyLoading ? 'Readying…' : "I'm Ready"}
                    </button>
                  )}
                </div>
              )
            )}

            {/* Player ready grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {players.map((p) => (
                <div key={p.user_id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all"
                  style={{
                    background: p.ready ? 'rgba(52,211,153,0.07)' : 'rgba(0,0,0,0.35)',
                    border: p.ready ? '1px solid rgba(52,211,153,0.25)' : '1px solid rgba(255,255,255,0.07)',
                  }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0 transition-all"
                    style={{ background: p.ready ? '#34d399' : 'rgba(255,255,255,0.15)', boxShadow: p.ready ? '0 0 6px rgba(52,211,153,0.5)' : 'none' }} />
                  <span className="text-[9px] font-heading font-bold truncate"
                    style={{ color: p.user_id === myUserId ? '#d4af37' : 'rgba(255,255,255,0.75)' }}>
                    {p.username}{p.user_id === myUserId ? ' (You)' : ''}
                  </span>
                  {p.ready && <CheckCircle2 size={10} className="ml-auto shrink-0" style={{ color: '#34d399' }} />}
                </div>
              ))}
            </div>

            {/* Ready progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[8px] font-heading text-mutedForeground">
                <span>{players.filter((p) => p.ready).length} / {players.length} ready</span>
                {!allReady && <span className="animate-pkr-pulse">Waiting for others…</span>}
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${players.length ? (players.filter((p) => p.ready).length / players.length) * 100 : 0}%`,
                    background: 'linear-gradient(90deg,#34d399,#10b981)',
                  }} />
              </div>
            </div>

            {(isCreator || status === 'open') && (
              <div className="flex justify-center">
                <button type="button" disabled={cancelLoading} onClick={cancelGame}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-heading font-bold uppercase"
                  style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                  <XCircle size={11} />{cancelLoading ? '…' : 'Cancel Table'}
                </button>
              </div>
            )}
          </div>
          <div style={goldBar} />
        </div>
      )}

      {/* ══ LIVE TABLE (playing + completed) ══ */}
      {(status === 'playing' || status === 'completed') && phase !== 'ready' && (
        <div className="rounded-xl overflow-hidden border-2 animate-pkr-fade" style={{ borderColor: '#5a3e1b' }}>
          <div style={goldBar} />

          {/* Felt table with oval player layout */}
          <div className="relative" style={{ ...feltBg, minHeight: players.length <= 2 ? 280 : 400 }}>
            {/* Table felt oval */}
            <div className="absolute inset-6 rounded-[50%]"
              style={{
                background: 'radial-gradient(ellipse at 50% 50%, #0f8a3e 0%, #0a6b2e 60%, #085c26 100%)',
                border: '6px solid #5a3e1b',
                boxShadow: 'inset 0 0 40px rgba(0,0,0,0.35), 0 0 0 2px #c9a84c',
              }} />

            {/* Pot display in center */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 5 }}>
              <div className="flex flex-col items-center gap-1.5">
                {board.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap justify-center">
                    {board.map((c, i) => (
                      <Card key={i} card={c} hidden={false} index={i} total={board.length} small={players.length > 4} />
                    ))}
                  </div>
                )}
                <div className="px-3 py-1 rounded-full text-[9px] font-heading font-bold"
                  style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(212,175,55,0.3)', color: '#d4af37' }}>
                  {street ? `${STREET_LABELS[street] || street} · ` : ''}Pot {formatMoneyFull(pot)}
                </div>
                {status === 'playing' && phase === 'playing' && currentTurnIndex >= 0 && (
                  <div className="flex items-center gap-2 mt-1">
                    {turnSecondsLeft != null && (
                      <TurnTimer seconds={turnSecondsLeft} isMyTurn={isMyTurn} />
                    )}
                    <span className="text-[9px] font-heading font-bold animate-pkr-pulse"
                      style={{ color: isMyTurn ? '#d4af37' : 'rgba(255,255,255,0.4)' }}>
                      {isMyTurn ? '🎴 Your Turn' : `${players[currentTurnIndex]?.username ?? '?'}'s turn`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Player seats positioned around oval */}
            {players.map((p, idx) => {
              const pos = tablePositions[idx] || { x: 50, y: 50 };
              // Show face-up: always for your own cards, always for bot in vs-dealer, on showdown/completed, folded
              const isMyCard = myUserId ? p.user_id === myUserId : !p.is_bot;
              const showHole = showAllCards || isMyCard || p.status === 'folded' || (isVsDealer && p.is_bot && showAllCards);
              const isDealer = !isVsDealer && idx === buttonIndex;
              const isCurrent = idx === currentTurnIndex;
              return (
                <div key={p.user_id || idx}
                  className="absolute"
                  style={{
                    left: `${pos.x}%`, top: `${pos.y}%`,
                    transform: 'translate(-50%,-50%)',
                    zIndex: isCurrent ? 10 : 6,
                  }}>
                  <PlayerSeat
                    p={p}
                    isMe={p.user_id === myUserId}
                    isCurrent={isCurrent}
                    showHole={showHole}
                    isDealer={isVsDealer ? p.is_bot : isDealer}
                    seatPos={pos}
                    totalSeats={players.length}
                  />
                </div>
              );
            })}
          </div>

          <div style={goldBar} />
        </div>
      )}

      {/* ══ ACTION BAR ══ */}
      {status === 'playing' && (phase === 'playing' || isVsDealer) && isMyTurn && myPlayer?.status !== 'folded' && myPlayer?.status !== 'all_in' && (
        <div className="rounded-xl overflow-hidden border-2 animate-pkr-fade" style={{ borderColor: '#5a3e1b' }}>
          <div style={goldBar} />
          <div className="p-3 space-y-3" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-heading text-primary/60 uppercase tracking-wider">Your Action</span>
              <span className="text-[9px] font-heading text-mutedForeground">
                Stack <span className="text-primary font-bold">{formatMoneyFull(myStack)}</span>
                {needToCall > 0 && <span className="text-yellow-400 ml-2">· Call {formatMoneyFull(needToCall)}</span>}
              </span>
            </div>

            {/* Primary actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" disabled={actionLoading} onClick={() => act('fold')}
                className="px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                style={{ borderColor: 'rgba(248,113,113,0.5)', background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
                Fold
              </button>
              {needToCall <= 0 && (
                <button type="button" disabled={actionLoading} onClick={() => act('check')}
                  className="px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                  style={{ borderColor: 'rgba(161,161,170,0.4)', background: 'rgba(161,161,170,0.08)', color: '#a1a1aa' }}>
                  Check
                </button>
              )}
              {needToCall > 0 && (
                <button type="button" disabled={actionLoading} onClick={() => act('call')}
                  className="px-4 py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                  style={{ borderColor: '#c9a84c', background: 'rgba(212,175,55,0.12)', color: '#d4af37' }}>
                  Call {formatMoneyFull(Math.min(needToCall, myStack))}
                </button>
              )}
              <button type="button" disabled={actionLoading || myStack <= 0} onClick={() => act('all_in')}
                className="px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                style={{ borderColor: 'rgba(251,113,133,0.5)', background: 'rgba(251,113,133,0.1)', color: '#fb7185' }}>
                All-In {formatMoney(myStack)}
              </button>
            </div>

            {/* Raise row */}
            {myStack > 0 && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={minRaise}
                  max={myStack}
                  value={raiseAmount}
                  onChange={(e) => setRaiseAmount(e.target.value)}
                  placeholder={`Min ${formatMoneyFull(minRaise)}`}
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg font-heading text-[10px] focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(212,175,55,0.2)', color: 'inherit' }}
                />
                <button type="button" disabled={actionLoading || !raiseAmount}
                  onClick={() => { act(needToCall > 0 ? 'raise' : 'bet', parseInt(raiseAmount, 10) || minRaise); setRaiseAmount(''); }}
                  className="px-4 py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(180deg,#d4af37,#a08020)', borderColor: '#c9a84c', color: '#1a1200' }}>
                  {needToCall > 0 ? 'Raise' : 'Bet'}
                </button>
                {/* Quick-bet buttons */}
                {[0.5, 0.75, 1].map((f) => {
                  const amt = Math.min(myStack, Math.max(minRaise, Math.floor(pot * f)));
                  return (
                    <button key={f} type="button"
                      onClick={() => setRaiseAmount(String(amt))}
                      className="px-2 py-1.5 rounded font-heading text-[8px] uppercase tracking-wider border border-primary/20 text-primary/60 hover:text-primary hover:border-primary/40 transition-colors">
                      {f === 1 ? 'Pot' : `${f * 100}%`}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div style={goldBar} />
        </div>
      )}

      {/* ══ ALL-IN WAITING STATE ══ */}
      {status === 'playing' && myPlayer?.status === 'all_in' && street !== 'showdown' && (
        <div className="rounded-xl overflow-hidden border-2 animate-pkr-fade" style={{ borderColor: '#5a3e1b' }}>
          <div style={goldBar} />
          <div className="p-4 text-center space-y-3" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <div className="flex justify-center">
              <div className="w-10 h-10 rounded-full border-2 border-primary/40 flex items-center justify-center animate-pkr-pulse"
                style={{ background: 'rgba(212,175,55,0.1)' }}>
                <span className="text-xl">♠</span>
              </div>
            </div>
            <div>
              <p className="text-sm font-heading font-bold uppercase tracking-[0.2em]"
                style={{ background: 'linear-gradient(180deg,#ffd700,#c9a84c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                All In — Running It Out
              </p>
              <p className="text-[9px] font-heading mt-1 animate-pkr-pulse" style={{ color: 'rgba(110,231,183,0.5)' }}>
                Dealing remaining streets…
              </p>
            </div>
            {/* Manual advance fallback for vs-dealer all-in */}
            {isVsDealer && (
              <button type="button" onClick={fetchGame}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all"
                style={{ borderColor: 'rgba(212,175,55,0.35)', background: 'rgba(212,175,55,0.08)', color: '#d4af37' }}>
                ↻ Check Result
              </button>
            )}
            {myPlayer?.hole_cards?.length > 0 && (
              <div className="flex justify-center items-end gap-1.5 pt-1">
                <span className="text-[8px] font-heading text-primary/50 self-center mr-1">Your cards</span>
                {myPlayer.hole_cards.map((c, i) => (
                  <Card key={i} card={c} hidden={false} index={i} total={2} />
                ))}
              </div>
            )}
          </div>
          <div style={goldBar} />
        </div>
      )}

      {/* ══ RESULTS ══ */}
      {status === 'completed' && game.results && (() => {
        const myResult = (game.results || []).find((r) => r.user_id === myUserId);
        const didWin = myResult?.result === 'win';
        const winner = (game.results || []).find((r) => r.result === 'win');
        const winnerName = winner?.user_id === myUserId ? 'You' : winner?.user_id === 'dealer' ? 'The Dealer' : (players.find((p) => p.user_id === winner?.user_id)?.username ?? 'Unknown');
        const winnerHand = winner?.hand;
        const pot = winner?.payout ?? 0;

        return (
          <div className="rounded-xl overflow-hidden border-2 animate-pkr-fade" style={{ borderColor: didWin ? '#c9a84c' : '#5a3e1b' }}>
            <div style={goldBar} />

            {/* Big winner banner */}
            <div className="p-5 text-center space-y-3"
              style={{ background: didWin ? 'linear-gradient(180deg,rgba(212,175,55,0.12),rgba(0,0,0,0.6))' : 'linear-gradient(180deg,rgba(248,113,113,0.06),rgba(0,0,0,0.6))' }}>

              <p className="text-[9px] font-heading uppercase tracking-[0.3em]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Showdown
              </p>

              {/* Winner name + outcome */}
              <div>
                <p className="text-2xl font-heading font-black uppercase tracking-wider"
                  style={didWin
                    ? { background: 'linear-gradient(180deg,#ffd700,#c9a84c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }
                    : { color: '#f87171' }}>
                  {didWin ? '🏆 You Win' : `${winnerName} Wins`}
                </p>
                {winnerHand && (
                  <p className="text-[11px] font-heading font-bold mt-1" style={{ color: didWin ? '#d4af37' : 'rgba(255,255,255,0.45)' }}>
                    {didWin ? `with ${winnerHand}` : `with ${winnerHand}`}
                  </p>
                )}
                {pot > 0 && (
                  <p className="text-[10px] font-heading mt-1" style={{ color: 'rgba(110,231,183,0.6)' }}>
                    Pot: <span className="font-bold text-green-400">{formatMoneyFull(pot)}</span>
                  </p>
                )}
              </div>

              {/* All hole cards revealed */}
              {players.length > 0 && (
                <div className="flex flex-wrap justify-center gap-4 pt-2 border-t border-white/5">
                  {players.filter((p) => (p.hole_cards || []).length > 0).map((p) => {
                    const pResult = (game.results || []).find((r) => r.user_id === p.user_id);
                    const pWon = pResult?.result === 'win';
                    const isMe = p.user_id === myUserId;
                    const pName = isMe ? 'You' : p.is_bot ? 'Dealer' : p.username;
                    return (
                      <div key={p.user_id} className="flex flex-col items-center gap-1.5">
                        <div className="flex gap-1">
                          {(p.hole_cards || []).map((c, i) => (
                            <Card key={i} card={c} hidden={false} index={i} total={2} />
                          ))}
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] font-heading font-bold" style={{ color: pWon ? '#d4af37' : 'rgba(255,255,255,0.45)' }}>
                            {pName} {pWon ? '✓' : '✗'}
                          </p>
                          {pResult?.hand && (
                            <p className="text-[8px] font-heading italic" style={{ color: pWon ? 'rgba(212,175,55,0.7)' : 'rgba(255,255,255,0.3)' }}>
                              {pResult.hand}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-primary/20 flex items-center justify-between" style={{ background: 'rgba(0,0,0,0.4)' }}>
              <p className="text-[9px] font-heading text-mutedForeground italic">
                {didWin ? 'The pot is yours, Don.' : 'Better luck next hand.'}
              </p>
              <Link to="/casino/mp-poker"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 text-[9px] font-heading font-bold uppercase tracking-wider active:scale-[0.97] transition-all"
                style={{ background: 'linear-gradient(180deg,#d4af37,#a08020)', borderColor: '#c9a84c', color: '#1a1200' }}>
                ♠ New Hand
              </Link>
            </div>
            <div style={goldBar} />
          </div>
        );
      })()}

      {/* ══ HELP / LEGEND ══ */}
      {(() => {
        const [helpOpen, setHelpOpen] = [helpPanelOpen, setHelpPanelOpen];
        return (
          <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 animate-pkr-fade`}>
            <button type="button" onClick={() => setHelpOpen((o) => !o)}
              className="w-full px-3 py-2.5 border-b border-primary/20 flex items-center justify-between hover:bg-primary/5 transition-colors"
              style={{ background: 'rgba(234,179,8,0.04)' }}>
              <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-1.5">
                ♠ How to Play · Hand Rankings
              </span>
              <span className="text-primary/50 text-[10px]">{helpOpen ? '▲' : '▼'}</span>
            </button>
            {helpOpen && (
              <div className="p-3 space-y-4" style={{ background: 'rgba(0,0,0,0.25)' }}>

                {/* Actions explained */}
                <div>
                  <p className="text-[8px] font-heading font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Your Actions</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {[
                      { label: 'Fold', color: '#f87171', desc: 'Surrender your hand. You lose any chips already bet.' },
                      { label: 'Check', color: '#a1a1aa', desc: 'Pass without betting — only if no one has bet this round.' },
                      { label: 'Call', color: '#d4af37', desc: 'Match the current bet to stay in the hand.' },
                      { label: 'Raise / Bet', color: '#d4af37', desc: 'Increase the bet. Others must call your raise or fold.' },
                      { label: 'All-In', color: '#fb7185', desc: 'Bet everything you have. You play for the pot up to your stack.' },
                    ].map((a) => (
                      <div key={a.label} className="flex gap-2 items-start px-2.5 py-2 rounded-lg"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span className="text-[8px] font-heading font-black shrink-0 mt-0.5 w-14" style={{ color: a.color }}>{a.label}</span>
                        <span className="text-[8px] font-heading leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{a.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Streets explained */}
                <div>
                  <p className="text-[8px] font-heading font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>The Streets</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {[
                      { name: 'Pre-Flop', desc: '2 hole cards dealt. First round of betting.' },
                      { name: 'Flop', desc: '3 community cards revealed.' },
                      { name: 'Turn', desc: '4th community card revealed.' },
                      { name: 'River', desc: '5th and final card. Last betting round.' },
                    ].map((s) => (
                      <div key={s.name} className="px-2 py-2 rounded-lg text-center"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="text-[8px] font-heading font-bold mb-0.5" style={{ color: '#d4af37' }}>{s.name}</p>
                        <p className="text-[7px] font-heading leading-snug" style={{ color: 'rgba(255,255,255,0.45)' }}>{s.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Hand rankings */}
                <div>
                  <p className="text-[8px] font-heading font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(212,175,55,0.6)' }}>Hand Rankings — Best to Worst</p>
                  <div className="space-y-1">
                    {[
                      { rank: '1', name: 'Straight Flush', example: '9♠ 8♠ 7♠ 6♠ 5♠', desc: 'Five consecutive cards, same suit.' },
                      { rank: '2', name: 'Four of a Kind', example: 'K♠ K♥ K♦ K♣ A', desc: 'Four cards of the same value.' },
                      { rank: '3', name: 'Full House', example: 'J♠ J♥ J♦ 7♠ 7♥', desc: 'Three of a kind + a pair.' },
                      { rank: '4', name: 'Flush', example: 'A♦ J♦ 8♦ 5♦ 2♦', desc: 'Any five cards, same suit.' },
                      { rank: '5', name: 'Straight', example: '8♠ 7♥ 6♦ 5♣ 4♠', desc: 'Five consecutive cards, mixed suits.' },
                      { rank: '6', name: 'Three of a Kind', example: 'Q♠ Q♥ Q♦ 9 3', desc: 'Three cards of the same value.' },
                      { rank: '7', name: 'Two Pair', example: 'A♠ A♥ K♦ K♣ J', desc: 'Two different pairs.' },
                      { rank: '8', name: 'Pair', example: '10♠ 10♥ A K 5', desc: 'Two cards of the same value.' },
                      { rank: '9', name: 'High Card', example: 'A♠ J♥ 9♦ 4♣ 2', desc: 'No combination — highest card plays.' },
                    ].map((h) => (
                      <div key={h.rank} className="flex items-center gap-2 px-2.5 py-1.5 rounded"
                        style={{ background: 'rgba(255,255,255,0.025)' }}>
                        <span className="text-[8px] font-heading font-black w-4 shrink-0 text-center"
                          style={{ color: Number(h.rank) <= 3 ? '#d4af37' : Number(h.rank) <= 6 ? 'rgba(212,175,55,0.6)' : 'rgba(255,255,255,0.3)' }}>
                          {h.rank}
                        </span>
                        <span className="text-[8px] font-heading font-bold w-28 shrink-0"
                          style={{ color: Number(h.rank) <= 3 ? '#d4af37' : 'rgba(255,255,255,0.7)' }}>
                          {h.name}
                        </span>
                        <span className="text-[7px] font-mono flex-1 hidden sm:block" style={{ color: 'rgba(255,255,255,0.3)' }}>{h.example}</span>
                        <span className="text-[7px] font-heading flex-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{h.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Blinds explained */}
                <div className="px-2.5 py-2 rounded-lg" style={{ background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.1)' }}>
                  <p className="text-[8px] font-heading font-bold mb-1" style={{ color: '#d4af37' }}>Blinds</p>
                  <p className="text-[8px] font-heading leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    The Small Blind and Big Blind are forced bets posted before cards are dealt. They rotate each hand to keep action moving. The Big Blind is double the Small Blind.
                    You must at least call the Big Blind to stay in pre-flop.
                  </p>
                </div>

              </div>
            )}
          </div>
        );
      })()}

      {/* ══ CHAT ══ */}
      {!isVsDealer && amIPlayer && (
        <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 animate-pkr-fade`}>
          <div className="px-3 py-2 border-b border-primary/20 flex items-center gap-1.5" style={{ background: 'rgba(234,179,8,0.06)' }}>
            <MessageSquare size={11} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">Table Chat</span>
          </div>
          <div className="max-h-[120px] overflow-y-auto p-2.5 space-y-1.5" style={{ background: 'rgba(0,0,0,0.2)' }}>
            {(game.chat || []).length === 0
              ? <p className="text-[9px] font-heading text-center py-2" style={{ color: 'rgba(255,255,255,0.15)' }}>No messages yet…</p>
              : (game.chat || []).slice(-30).map((c, i) => (
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
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                placeholder="Say something…" maxLength={200}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[11px] font-heading focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(234,179,8,0.15)', color: 'inherit' }} />
              <button type="submit" disabled={sendingChat || !chatInput.trim()}
                className="px-3 py-1.5 rounded-lg text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors">
                {sendingChat ? '…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
