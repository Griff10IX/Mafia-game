import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Zap, PlusCircle, Dices, Bot, TrendingUp, TrendingDown, Clock, Users, Trophy, Skull, Mic2 } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import { useEntJoinTurnstile } from '../../hooks/useEntJoinTurnstile';
import styles from '../../styles/noir.module.css';

const MDG_STYLES = `
  @keyframes mdg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .mdg-fade-in { animation: mdg-fade-in 0.4s ease-out both; }
  .mdg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  @keyframes mdg-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  .mdg-auto-badge { animation: mdg-pulse 2s ease-in-out infinite; }

  @keyframes mdg-dice-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  @keyframes mdg-dice-bounce { 0%,100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-4px) rotate(8deg); } }
  @keyframes mdg-glow-pulse { 0%,100% { box-shadow: 0 0 8px rgba(var(--noir-primary-rgb),0.15), inset 0 0 8px rgba(var(--noir-primary-rgb),0.05); } 50% { box-shadow: 0 0 20px rgba(var(--noir-primary-rgb),0.3), inset 0 0 15px rgba(var(--noir-primary-rgb),0.1); } }
  @keyframes mdg-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  @keyframes mdg-slot-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes mdg-countdown-tick { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
  @keyframes mdg-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes mdg-pot-glow { 0%,100% { text-shadow: 0 0 6px rgba(var(--noir-primary-rgb),0.3); } 50% { text-shadow: 0 0 16px rgba(var(--noir-primary-rgb),0.6); } }

  .mdg-dice-bounce { animation: mdg-dice-bounce 2.5s ease-in-out infinite; }
  .mdg-glow-panel { animation: mdg-glow-pulse 3s ease-in-out infinite; }
  .mdg-shimmer-bar { background: linear-gradient(90deg, transparent 0%, rgba(var(--noir-primary-rgb),0.15) 50%, transparent 100%); background-size: 200% 100%; animation: mdg-shimmer 2.5s linear infinite; }
  .mdg-countdown-tick { animation: mdg-countdown-tick 1s ease-in-out infinite; }
  .mdg-float { animation: mdg-float 3s ease-in-out infinite; }
  .mdg-pot-glow { animation: mdg-pot-glow 2s ease-in-out infinite; }

  .mdg-stat-card { position: relative; overflow: hidden; }
  .mdg-stat-card::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(var(--noir-primary-rgb),0.06) 0%, transparent 60%); pointer-events: none; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatFee(game) {
  const pts = Number(game.fee_points ?? 0);
  const money = Number(game.fee_money ?? 0);
  const parts = [];
  if (pts > 0) parts.push(`${pts.toLocaleString()} pts`);
  if (money > 0) parts.push(formatMoney(money));
  return parts.length ? parts.join(' / ') : '—';
}

function formatPot(game) {
  const pts = Number(game.pot_points ?? 0);
  const money = Number(game.pot_money ?? 0);
  const parts = [];
  if (pts > 0) parts.push(`${pts.toLocaleString()} pts`);
  if (money > 0) parts.push(formatMoney(money));
  return parts.length ? parts.join(' + ') : '—';
}

function formatMdgResultToast(data) {
  if (data?.house_won) {
    return `The House won! Pot burned. Better luck next time.`;
  }
  const roll = data?.roll ?? '?';
  const name = (data?.winner_username || '?').toUpperCase();
  const pts = Number(data?.pot_points ?? 0);
  const money = Number(data?.pot_money ?? 0);
  const parts = [];
  if (money > 0) parts.push(formatMoney(money));
  if (pts > 0) parts.push(`${pts.toLocaleString()} pts`);
  const withStr = parts.length ? ` with ${parts.join(' and ')}` : '';
  return `The dice rolled ${roll} and the winner is ${name}${withStr}!`;
}

function useCountdown(deadline) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    if (!deadline) return;
    const update = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) { setRemaining('Rolling soon…'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h > 0 ? `${h}h ` : ''}${m}m ${s}s`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return remaining;
}

function formatExtraPot(game) {
  const pts = Number(game.extra_pot_points ?? 0);
  const money = Number(game.extra_pot_money ?? 0);
  if (pts <= 0 && money <= 0) return '—';
  const parts = [];
  if (pts > 0) parts.push(`${pts.toLocaleString()} pts`);
  if (money > 0) parts.push(formatMoney(money));
  return parts.join(' + ');
}

/** How the pot is rolled — shown so joiners know before paying the fee. */
function formatRollMode(game) {
  const maxP = Math.max(2, Math.min(100, Number(game.max_players ?? 10)));
  const n = Array.isArray(game.entries) ? game.entries.length : 0;
  const autoAt = game.auto_roll_at;
  if (autoAt != null && autoAt !== '') {
    const threshold = Math.max(2, Math.min(maxP, Number(autoAt)));
    return {
      label: 'Auto-roll',
      detail: `Rolls automatically when ${threshold} spots are filled (${n}/${threshold} now). Max table: ${maxP}.`,
    };
  }
  return {
    label: 'Manual roll',
    detail: `Host rolls when ready — or when the table fills (${n}/${maxP}).`,
  };
}

/** Entry usernames as profile links; `separator` between names (e.g. ' – ' or ', '). */
function MdgPlayerUsernameLinks({ entries, separator }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.map((e, i) => (
    <span key={e.user_id ?? `${String(e.username)}-${i}`}>
      {i > 0 ? separator : null}
      <Link
        to={`/profile/${encodeURIComponent(e.username)}`}
        className="text-primary/90 hover:text-primary hover:underline font-medium"
      >
        {e.username}
      </Link>
    </span>
  ));
}

function DiceArt({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}>
      <rect x="4" y="4" width="32" height="32" rx="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" fill="currentColor" fillOpacity="0.06" />
      <circle cx="13" cy="13" r="2.5" fill="currentColor" fillOpacity="0.6" />
      <circle cx="27" cy="13" r="2.5" fill="currentColor" fillOpacity="0.6" />
      <circle cx="20" cy="20" r="2.5" fill="currentColor" fillOpacity="0.6" />
      <circle cx="13" cy="27" r="2.5" fill="currentColor" fillOpacity="0.6" />
      <circle cx="27" cy="27" r="2.5" fill="currentColor" fillOpacity="0.6" />
    </svg>
  );
}

function DicePair({ className = '' }) {
  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <DiceArt size={28} className="text-primary/70 mdg-dice-bounce" />
      <DiceArt size={24} className="text-primary/50 mdg-dice-bounce" />
    </div>
  );
}

function SlotMeter({ filled, total, hasHouse = false, className = '' }) {
  const displayTotal = hasHouse ? total + 1 : total;
  const displayFilled = hasHouse ? filled + 1 : filled;
  const pct = displayTotal > 0 ? (displayFilled / displayTotal) * 100 : 0;
  const isFull = filled >= total;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-2 rounded-full bg-zinc-800/80 border border-primary/20 overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isFull ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary/80 to-primary'}`}
          style={{ width: `${pct}%` }}
        />
        {!isFull && <div className="absolute inset-0 mdg-shimmer-bar rounded-full" />}
      </div>
      <div className="flex gap-0.5">
        {hasHouse && (
          <div className="w-1.5 h-3 rounded-sm bg-red-500/80 border border-red-400/40" title="House slot" />
        )}
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`w-1.5 h-3 rounded-sm transition-colors duration-300 ${
              i < filled ? (isFull ? 'bg-emerald-400' : 'bg-primary') : 'bg-zinc-700/60'
            }`}
          />
        ))}
      </div>
      <span className={`text-[9px] font-heading font-bold tabular-nums ${isFull ? 'text-emerald-400' : 'text-primary/80'}`}>
        {displayFilled}/{displayTotal}
      </span>
    </div>
  );
}

function HouseIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="mdg-float">
      <path d="M3 21V10L12 3L21 10V21H15V14H9V21H3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="currentColor" fillOpacity="0.1" />
      <rect x="10" y="15" width="4" height="6" rx="0.5" fill="currentColor" fillOpacity="0.3" />
    </svg>
  );
}

function NextCycleCountdown({ deadline, large = false }) {
  const countdown = useCountdown(deadline);
  if (!deadline || !countdown) return null;
  if (large) {
    return (
      <div className="flex items-center justify-center gap-2 mt-2">
        <Clock size={14} className="text-primary/60 mdg-countdown-tick" />
        <span className="text-xs font-heading font-bold text-primary">
          Next games in: <span className="tabular-nums">{countdown}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-1.5">
      <Clock size={10} className="text-primary/50 mdg-countdown-tick" />
      <span className="text-[8px] font-heading text-primary/60 uppercase tracking-wider">
        Next games in: <span className="font-bold text-primary/80 tabular-nums">{countdown}</span>
      </span>
    </div>
  );
}

/** Entertainer MDG: max points (fee + extra pot) from fund per game — keep in sync with backend `ENTERTAINER_MDG_MAX_POINTS_PER_GAME`. */
const ENTERTAINER_MDG_MAX_POINTS = 1_000;

const ADMIN_PRIZE_KIND_OPTIONS = [
  { kind: 'token', label: 'Token / skip' },
  { kind: 'unowned_airport', label: 'Unowned airport' },
  { kind: 'unowned_armoury', label: 'Unowned armoury' },
  { kind: 'unowned_casino', label: 'Unowned casino' },
];

export default function MDGPage() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [rollingId, setRollingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFeePoints, setCreateFeePoints] = useState('');
  const [createFeeMoney, setCreateFeeMoney] = useState('');
  const [createMaxPlayers, setCreateMaxPlayers] = useState('10');
  const [createAutoRollAt, setCreateAutoRollAt] = useState('');
  const [createExtraPotPoints, setCreateExtraPotPoints] = useState('');
  const [createExtraPotMoney, setCreateExtraPotMoney] = useState('');
  const [creating, setCreating] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [autoStats, setAutoStats] = useState(null);
  const [adminPrizeOptions, setAdminPrizeOptions] = useState(null);
  const [adminPrizes, setAdminPrizes] = useState([]);
  const [adminPrizeDraft, setAdminPrizeDraft] = useState({
    kind: 'token',
    token_type: 'mission_skip',
    amount: '1',
    state: '',
    casino: 'dice',
  });
  /** Entertainer segregated fund — MDG create debits fee + extra pot from here when role is entertainer (admins exempt) */
  const [entFund, setEntFund] = useState({
    is_entertainer: false,
    cash: 0,
    points: 0,
  });

  const usesEntFund = entFund.is_entertainer && !isAdmin;
  const refreshAuthMe = useCallback(() => {
    api
      .get('/auth/me')
      .then((r) => {
        const d = r.data || {};
        setMyUserId(d.id ?? null);
        setEntFund({
          is_entertainer: !!d.is_entertainer,
          cash: Number(d.entertainer_fund_cash ?? 0),
          points: Number(d.entertainer_fund_points ?? 0),
        });
      })
      .catch(() => {
        setMyUserId(null);
      });
  }, []);

  useEffect(() => {
    refreshAuthMe();
  }, [refreshAuthMe]);

  useEffect(() => {
    if (createOpen) refreshAuthMe();
  }, [createOpen, refreshAuthMe]);

  useEffect(() => {
    api.get('/auth/staff-flags').then((r) => {
      setIsAdmin(!!r.data?.is_admin);
      setIsModerator(!!r.data?.is_moderator);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!createOpen || !isAdmin) return undefined;
    let cancelled = false;
    api
      .get('/casino/mdg/admin-prize-options')
      .then((r) => {
        if (cancelled) return;
        setAdminPrizeOptions(r.data || null);
        const states = r.data?.states || [];
        setAdminPrizeDraft((prev) => ({
          ...prev,
          state: prev.state || states[0] || '',
          token_type: prev.token_type || r.data?.tokens?.[0]?.token_type || 'mission_skip',
        }));
      })
      .catch(() => {
        if (!cancelled) setAdminPrizeOptions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen, isAdmin]);

  const fetchAutoStats = useCallback(() => {
    api.get('/casino/mdg/auto-stats').then((r) => setAutoStats(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchAutoStats();
    const t = setInterval(fetchAutoStats, 30000);
    return () => clearInterval(t);
  }, [fetchAutoStats]);

  const joinTokenRef = useRef(null);
  const { getCaptchaToken: getJoinCaptchaToken, captchaModal: joinCaptchaModal } = useEntJoinTurnstile();

  const fetchGames = useCallback(() => {
    api.get('/casino/mdg/games').then((r) => {
      setGames(r.data?.games || []);
      if (r.data?.join_token) joinTokenRef.current = r.data.join_token;
    }).catch(() => setGames([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchGames();
    const t = setInterval(fetchGames, 8000);
    return () => clearInterval(t);
  }, [fetchGames]);

  const handleJoin = async (gameId) => {
    const game = games.find((g) => g.id === gameId);
    if (game && game.created_by === myUserId) {
      toast.error("You're already in this game (you created it)");
      return;
    }
    setJoiningId(gameId);
    try {
      let captchaToken = null;
      try {
        captchaToken = await getJoinCaptchaToken();
      } catch {
        return; // captcha cancelled/failed — user can tap Join again
      }
      const res = await api.post('/casino/mdg/join', {
        game_id: gameId,
        join_token: joinTokenRef.current,
        captcha_token: captchaToken,
      });
      await refreshUser();
      if (res.data?.winner_username != null) {
        toast.success(formatMdgResultToast(res.data));
      } else {
        toast.success(res.data?.message || 'Joined');
      }
      fetchGames();
    } catch (e) {
      const detail = e.response?.data?.detail || '';
      // Anti-bot join token expired/stale: silently refresh the list (issues a fresh token) and ask for another tap.
      if (typeof detail === 'string' && (detail.includes('refresh the games list') || detail.includes('Too fast'))) {
        fetchGames();
        toast.warning(detail.includes('Too fast') ? 'Too fast — tap Join again.' : 'Session refreshed — tap Join again.');
      } else {
        toast.error(getApiErrorMessage(e) || 'Could not join');
      }
    } finally {
      setJoiningId(null);
    }
  };

  const handleRoll = async (gameId) => {
    setRollingId(gameId);
    try {
      const res = await api.post('/casino/mdg/roll', { game_id: gameId });
      await refreshUser();
      if (res.data?.winner_username != null) {
        toast.success(formatMdgResultToast(res.data));
      } else {
        toast.success(res.data?.message || 'Roll complete');
      }
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not roll');
    } finally {
      setRollingId(null);
    }
  };

  const handleCreate = async () => {
    const feePoints = parseInt(createFeePoints, 10) || 0;
    const feeMoney = parseFloat(createFeeMoney) || 0;
    if (feePoints <= 0 && feeMoney <= 0) {
      toast.error('Set a fee: points and/or money');
      return;
    }
    const maxPlayers = Math.max(2, Math.min(100, parseInt(createMaxPlayers, 10) || 10));
    if (usesEntFund && maxPlayers < 4) {
      toast.error('Entertainer-created MDG games must allow at least 4 players (increase Max players).');
      return;
    }
    const extraPts = parseInt(createExtraPotPoints, 10) || 0;
    if (usesEntFund && feePoints + extraPts > ENTERTAINER_MDG_MAX_POINTS) {
      toast.error(
        `Entertainer MDG: fee points + extra pot points cannot exceed ${ENTERTAINER_MDG_MAX_POINTS.toLocaleString()} (from your entertainer fund).`,
      );
      return;
    }
    setCreating(true);
    try {
      await api.post('/casino/mdg/create', {
        fee_points: feePoints,
        fee_money: feeMoney,
        max_players: maxPlayers,
        auto_roll_at: createAutoRollAt.trim() ? Math.max(2, parseInt(createAutoRollAt, 10) || 2) : null,
        extra_pot_points: extraPts,
        extra_pot_money: parseFloat(createExtraPotMoney) || 0,
        ...(isAdmin && adminPrizes.length > 0 ? { admin_prizes: adminPrizes } : {}),
      });
      await refreshUser();
      refreshAuthMe();
      toast.success('Game created — fee taken (you’re in the game)');
      setCreateOpen(false);
      setCreateFeePoints('');
      setCreateFeeMoney('');
      setCreateMaxPlayers('10');
      setCreateAutoRollAt('');
      setCreateExtraPotPoints('');
      setCreateExtraPotMoney('');
      setAdminPrizes([]);
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not create game');
    } finally {
      setCreating(false);
    }
  };

  const addAdminPrize = () => {
    if (!isAdmin) return;
    const kind = adminPrizeDraft.kind;
    if (kind === 'token') {
      const amount = Math.max(1, parseInt(adminPrizeDraft.amount, 10) || 1);
      const token_type = adminPrizeDraft.token_type;
      if (!token_type) {
        toast.error('Pick a token type');
        return;
      }
      const label =
        adminPrizeOptions?.tokens?.find((t) => t.token_type === token_type)?.label || token_type;
      setAdminPrizes((prev) => [...prev, { kind: 'token', token_type, amount, label: `${amount}× ${label}` }]);
      return;
    }
    const state = adminPrizeDraft.state;
    if (!state) {
      toast.error('Pick a state');
      return;
    }
    if (kind === 'unowned_casino') {
      const casino = adminPrizeDraft.casino || 'dice';
      setAdminPrizes((prev) => [
        ...prev,
        { kind, state, casino, label: `Unowned ${casino} · ${state}` },
      ]);
      return;
    }
    setAdminPrizes((prev) => [
      ...prev,
      {
        kind,
        state,
        label: `Unowned ${kind === 'unowned_airport' ? 'airport' : 'armoury'} · ${state}`,
      },
    ]);
  };
  const autoGames = games.filter((g) => g.is_automated);
  const playerGames = games.filter((g) => !g.is_automated);
  const houseNet = autoStats ? (autoStats.total_fees_collected ?? 0) - ((autoStats.total_paid_to_winners ?? 0) - (autoStats.total_pot_created ?? 0)) : 0;

  const previewFeePts = parseInt(createFeePoints, 10) || 0;
  const previewFeeMoney = parseFloat(createFeeMoney) || 0;
  const previewExtraPts = parseInt(createExtraPotPoints, 10) || 0;
  const previewExtraMoney = parseFloat(createExtraPotMoney) || 0;
  const previewTotalPts = previewFeePts + previewExtraPts;
  const previewTotalMoney = previewFeeMoney + previewExtraMoney;
  const entInsufficient =
    usesEntFund &&
    createOpen &&
    (previewTotalPts > entFund.points || previewTotalMoney > entFund.cash);
  const entMdgPointsOverCap =
    usesEntFund && createOpen && previewTotalPts > ENTERTAINER_MDG_MAX_POINTS;

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="mdg-page">
      <style>{MDG_STYLES}</style>
      {joinCaptchaModal}

      <div className="relative mdg-fade-in flex items-center justify-between">
        <div>
          <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Pot Game</p>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">MDG</h1>
          <p className="text-[10px] text-mutedForeground font-heading italic mt-1">
            Set a fee, fill spots, one winner takes the pot. Points or money — or both. Admins/mods can enter but cannot win.
          </p>
        </div>
        <div className="hidden sm:flex items-end gap-1 opacity-30">
          <DiceArt size={36} className="text-primary" />
          <DiceArt size={28} className="text-primary/70" />
        </div>
      </div>

      {/* ════ PLAYER GAMES ════ */}
      <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 mdg-fade-in`} style={{ animationDelay: '0.02s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Player Games</h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">User-created games — view & join below</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(!createOpen)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary font-heading font-bold text-[10px] uppercase tracking-wider hover:bg-primary/25 transition-colors"
          >
            <PlusCircle size={14} /> New game
          </button>
        </div>
        {createOpen && (
          <div className="px-3 pb-3 border-b border-primary/15 bg-zinc-900/40">
            <div className="rounded-lg overflow-hidden border border-primary/20 bg-secondary/20">
              <div className="px-3 py-2 bg-primary/8 border-b border-primary/15">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Game options</h2>
                <p className="text-[9px] text-mutedForeground font-heading mt-0.5">
                  Fee (points and/or money), max players, auto-roll when N spots filled, optional extra pot. Max 3 open games. You are auto-joined.
                  {usesEntFund ? (
                    <>
                      {' '}
                      As an Entertainer, your creation fee plus extra pot are paid from your Entertainer fund — not your main wallet. Max players must be at least <strong className="text-violet-200">4</strong>. Points from the fund (fee + extra pot) are capped at <strong className="text-violet-200">{ENTERTAINER_MDG_MAX_POINTS.toLocaleString()}</strong> per game.
                    </>
                  ) : isAdmin && entFund.is_entertainer ? (
                    <>
                      {' '}
                      <span className="text-amber-200/90">Admin: Entertainer fund caps do not apply — paid from your main wallet.</span>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="p-3 space-y-3">
                {usesEntFund && (
                  <div className="rounded-lg border border-violet-500/35 bg-violet-950/25 px-3 py-2.5 space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-heading font-bold text-violet-200 uppercase tracking-wider">
                      <Mic2 size={14} className="text-violet-400 shrink-0" />
                      Entertainer fund (charged on create)
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-heading">
                      <span className="text-zinc-300">
                        Cash:{' '}
                        <strong className="text-emerald-400 tabular-nums">{formatMoney(entFund.cash)}</strong>
                      </span>
                      <span className="text-zinc-300">
                        Fund points:{' '}
                        <strong className="text-sky-400 tabular-nums">{Math.trunc(entFund.points).toLocaleString()}</strong>
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-400 font-heading leading-snug">
                      Debit at create = your fee + extra pot (same fields below). Join fees from other players still go to main balances as usual.
                    </p>
                    {(previewFeePts > 0 || previewFeeMoney > 0) && (
                      <div className="text-[10px] font-heading border-t border-violet-500/20 pt-2 mt-1">
                        <span className="text-zinc-500 uppercase tracking-wide mr-2">This setup debits</span>
                        <span className="text-foreground tabular-nums">
                          {[
                            previewTotalPts > 0 ? `${previewTotalPts.toLocaleString()} pts` : null,
                            previewTotalMoney > 0 ? formatMoney(previewTotalMoney) : null,
                          ]
                            .filter(Boolean)
                            .join(' + ') || '—'}
                        </span>
                        {entMdgPointsOverCap && (
                          <span className="block text-amber-400/95 mt-1">
                            Points total exceeds entertainer cap ({ENTERTAINER_MDG_MAX_POINTS.toLocaleString()} max fee + extra pot combined).
                          </span>
                        )}
                        {entInsufficient && !entMdgPointsOverCap && (
                          <span className="block text-amber-400/95 mt-1">
                            Not enough in Entertainer fund for these amounts — lower fees/extra pot or wait for daily UTC top-up.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Fee (points)</label>
                    <FormattedNumberInput
                      value={createFeePoints}
                      onChange={setCreateFeePoints}
                      placeholder="0"
                      className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Fee (money)</label>
                    <FormattedNumberInput
                      value={createFeeMoney}
                      onChange={setCreateFeeMoney}
                      placeholder="0"
                      className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">
                      Max players{usesEntFund ? ' (min 4)' : ''}
                    </label>
                    <input
                      type="number"
                      min={usesEntFund ? 4 : 2}
                      max={100}
                      value={createMaxPlayers}
                      onChange={(e) => setCreateMaxPlayers(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Auto-roll after (spots filled)</label>
                    <input
                      type="number"
                      min={2}
                      max={100}
                      value={createAutoRollAt}
                      onChange={(e) => setCreateAutoRollAt(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Extra pot (points)</label>
                    <FormattedNumberInput
                      value={createExtraPotPoints}
                      onChange={setCreateExtraPotPoints}
                      placeholder="0"
                      className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Extra pot (money)</label>
                    <FormattedNumberInput
                      value={createExtraPotMoney}
                      onChange={setCreateExtraPotMoney}
                      placeholder="0"
                      className="w-full px-2.5 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-sm"
                    />
                  </div>
                </div>
                {isAdmin && (
                  <div className="rounded-lg border border-amber-600/35 bg-amber-950/20 px-3 py-2.5 space-y-2">
                    <p className="text-[10px] font-heading font-bold text-amber-200 uppercase tracking-wider">
                      Admin bonus prizes (optional)
                    </p>
                    <p className="text-[9px] text-zinc-400 font-heading leading-snug">
                      Awarded to the winner with the pot. Unowned assets fail gracefully if claimed before roll.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select
                        value={adminPrizeDraft.kind}
                        onChange={(e) => setAdminPrizeDraft((p) => ({ ...p, kind: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-[11px]"
                      >
                        {ADMIN_PRIZE_KIND_OPTIONS.map((o) => (
                          <option key={o.kind} value={o.kind}>{o.label}</option>
                        ))}
                      </select>
                      {adminPrizeDraft.kind === 'token' ? (
                        <>
                          <select
                            value={adminPrizeDraft.token_type}
                            onChange={(e) => setAdminPrizeDraft((p) => ({ ...p, token_type: e.target.value }))}
                            className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-[11px]"
                          >
                            {(adminPrizeOptions?.tokens || [{ token_type: 'mission_skip', label: 'Mission Skip' }]).map((t) => (
                              <option key={t.token_type} value={t.token_type}>{t.label}</option>
                            ))}
                          </select>
                          <FormattedNumberInput
                            value={adminPrizeDraft.amount}
                            onChange={(v) => setAdminPrizeDraft((p) => ({ ...p, amount: v }))}
                            placeholder="1"
                            className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-[11px]"
                          />
                        </>
                      ) : (
                        <>
                          <select
                            value={adminPrizeDraft.state}
                            onChange={(e) => setAdminPrizeDraft((p) => ({ ...p, state: e.target.value }))}
                            className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-[11px]"
                          >
                            {(adminPrizeOptions?.states || []).map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          {adminPrizeDraft.kind === 'unowned_casino' && (
                            <select
                              value={adminPrizeDraft.casino}
                              onChange={(e) => setAdminPrizeDraft((p) => ({ ...p, casino: e.target.value }))}
                              className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-primary/20 text-foreground font-heading text-[11px]"
                            >
                              {['dice', 'roulette', 'blackjack', 'horseracing', 'videopoker', 'slots'].map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          )}
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={addAdminPrize}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-100 font-heading text-[10px] uppercase"
                    >
                      <PlusCircle size={12} /> Add prize
                    </button>
                    {adminPrizes.length > 0 && (
                      <ul className="space-y-1">
                        {adminPrizes.map((p, i) => (
                          <li key={`${p.label}-${i}`} className="flex items-center justify-between gap-2 text-[10px] font-heading text-amber-100/90">
                            <span className="truncate">{p.label}</span>
                            <button
                              type="button"
                              className="text-zinc-500 hover:text-red-400 shrink-0"
                              onClick={() => setAdminPrizes((prev) => prev.filter((_, j) => j !== i))}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={creating || (usesEntFund && (entInsufficient || entMdgPointsOverCap))}
                    onClick={handleCreate}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[10px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
                  >
                    <Zap size={14} /> {creating ? 'Creating…' : 'Create game'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="px-3 py-2 rounded border border-primary/20 text-mutedForeground font-heading text-[10px] uppercase hover:bg-primary/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="p-2">
          {loading ? (
            <p className="text-[10px] text-mutedForeground font-heading py-4 text-center">Loading…</p>
          ) : playerGames.length === 0 ? (
            <p className="text-[10px] text-mutedForeground font-heading py-4 text-center">No open player games. Use New game to create one.</p>
          ) : (
            <ul className="space-y-0 divide-y divide-primary/10">
              {playerGames.map((g, idx) => {
                const entries = g.entries || [];
                const isCreator = g.created_by === myUserId;
                const isStaff = isAdmin || isModerator;
                const isIn = entries.some((e) => e.user_id === myUserId) || isCreator;
                const canRoll = (isCreator || isStaff) && entries.length >= 1;
                const rollMode = formatRollMode(g);
                return (
                  <li key={g.id} className={`py-3 px-2 mdg-fade-in ${styles.raised}`} style={{ animationDelay: `${0.05 + idx * 0.02}s` }}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-[10px] font-heading text-foreground">
                          <span className="text-mutedForeground">Bet: </span>
                          <span className="font-semibold text-foreground">{formatFee(g)}</span>
                          <span className="text-mutedForeground mx-1.5">/</span>
                          <span className="text-mutedForeground">Potential Win: </span>
                          <span className="font-semibold text-primary">{formatPot(g)}</span>
                        </p>
                        {Array.isArray(g.admin_prizes) && g.admin_prizes.length > 0 && (
                          <p className="text-[9px] font-heading text-amber-200/90">
                            Bonus prizes: {g.admin_prizes.map((p) => p.label || p.kind).join(' · ')}
                          </p>
                        )}
                        <p className="text-[9px] font-heading text-foreground/90">
                          <span className={rollMode.label === 'Auto-roll' ? 'text-primary/95 font-bold' : 'text-mutedForeground'}>
                            {rollMode.label}:
                          </span>{' '}
                          <span className="text-mutedForeground">{rollMode.detail}</span>
                        </p>
                        <p className="text-[9px] font-heading text-mutedForeground break-words">
                          {entries.length > 0 ? (
                            <>
                              <MdgPlayerUsernameLinks entries={entries} separator=" – " />
                              {` – ${entries.length} Players`}
                            </>
                          ) : (
                            '—'
                          )}
                          {(g.extra_pot_points > 0 || g.extra_pot_money > 0) && ` – Extra Pot: ${formatExtraPot(g)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isIn && (
                          <button
                            type="button"
                            disabled={joiningId === g.id}
                            onClick={() => handleJoin(g.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[9px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
                          >
                            {joiningId === g.id ? '…' : 'Join'}
                          </button>
                        )}
                        {canRoll && (
                          <button
                            type="button"
                            disabled={rollingId === g.id}
                            onClick={() => handleRoll(g.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-primary/50 bg-primary/20 text-primary font-heading font-bold text-[9px] uppercase hover:bg-primary/30 disabled:opacity-50 transition-colors"
                          >
                            <Dices size={12} /> {rollingId === g.id ? '…' : 'Roll'}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={`mdg-art-line text-primary mx-3 ${styles.panelHeader}`} style={{ height: 0, minHeight: 0 }} />
      </div>

      {/* ════ AUTOMATED HOUSE GAMES ════ */}
      <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/30 mdg-fade-in mdg-glow-panel`} style={{ animationDelay: '0.03s' }}>
        <div className="h-1 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="px-4 py-3 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-b border-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <HouseIcon size={22} />
              </div>
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary border border-primary/60 flex items-center justify-center mdg-auto-badge">
                <Bot size={8} className="text-black" />
              </div>
            </div>
            <div>
              <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-[0.15em]">House Games</h2>
              <p className="text-[9px] text-primary/40 font-heading mt-0.5">The House puts up the pot and takes a slot in every roll</p>
            </div>
          </div>
          <DicePair />
        </div>

        {/* Info strip */}
        <div className="px-3 py-2 bg-primary/5 border-b border-primary/10 space-y-1.5">
          <div className="flex items-center justify-center gap-4">
            <span className="text-[8px] font-heading text-primary/50 uppercase tracking-widest">3 games</span>
            <span className="w-1 h-1 rounded-full bg-primary/30" />
            <span className="text-[8px] font-heading text-primary/50 uppercase tracking-widest">every 3 hours</span>
            <span className="w-1 h-1 rounded-full bg-primary/30" />
            <span className="text-[8px] font-heading text-primary/50 uppercase tracking-widest">max 10 players</span>
          </div>
          {/* Next cycle countdown */}
          <NextCycleCountdown deadline={autoStats?.next_cycle} />
        </div>

        {/* How it works */}
        <div className="px-3 py-2 border-b border-primary/8 bg-zinc-900/50">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px] font-heading">
            <div className="flex items-start gap-2">
              <div className="w-4 h-4 rounded bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <Dices size={10} className="text-primary" />
              </div>
              <p className="text-zinc-400"><span className="text-primary/80 font-semibold">Entry fee</span> is 10% of the house pot. Fee gets added to the total pot.</p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-4 h-4 rounded bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <Trophy size={10} className="text-emerald-400" />
              </div>
              <p className="text-zinc-400"><span className="text-emerald-300/80 font-semibold">Player wins?</span> They take the entire pot — house pot + all entry fees.</p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-4 h-4 rounded bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <Skull size={10} className="text-red-400" />
              </div>
              <p className="text-zinc-400"><span className="text-red-300/80 font-semibold">House wins?</span> The pot is burned — all money is removed from the game. Nobody wins.</p>
            </div>
          </div>
        </div>

        {autoGames.length > 0 ? (
          <div className="p-2 space-y-2">
            {autoGames.map((g, idx) => (
              <AutoGameRow
                key={g.id}
                game={g}
                idx={idx}
                myUserId={myUserId}
                joiningId={joiningId}
                onJoin={handleJoin}
              />
            ))}
          </div>
        ) : (
          <div className="p-4 text-center">
            <p className="text-[10px] font-heading text-zinc-500">No house games right now.</p>
            <NextCycleCountdown deadline={autoStats?.next_cycle} large />
          </div>
        )}
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      </div>

      {/* ════ HOUSE STATS ════ */}
      {autoStats && autoStats.total_games > 0 && (
        <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 mdg-fade-in`} style={{ animationDelay: '0.04s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-gradient-to-r from-primary/8 to-transparent border-b border-primary/15 flex items-center gap-2">
            <Trophy size={14} className="text-primary/70" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">House Scoreboard</h2>
          </div>
          <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="mdg-stat-card rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Dices size={11} className="text-zinc-500" />
                <p className="text-[8px] font-heading text-zinc-500 uppercase tracking-wider">Games Played</p>
              </div>
              <p className="text-lg font-heading font-bold text-foreground tabular-nums">{(autoStats.total_games ?? 0).toLocaleString()}</p>
            </div>
            <div className="mdg-stat-card rounded-lg border border-primary/20 bg-primary/5 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Skull size={11} className="text-primary/60" />
                <p className="text-[8px] font-heading text-primary/60 uppercase tracking-wider">House Wins</p>
              </div>
              <p className="text-lg font-heading font-bold text-primary tabular-nums">{(autoStats.house_wins ?? 0).toLocaleString()}</p>
            </div>
            <div className="mdg-stat-card rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Users size={11} className="text-emerald-500/60" />
                <p className="text-[8px] font-heading text-emerald-500/60 uppercase tracking-wider">Player Wins</p>
              </div>
              <p className="text-lg font-heading font-bold text-emerald-400 tabular-nums">{(autoStats.player_wins ?? 0).toLocaleString()}</p>
            </div>
            <div className={`mdg-stat-card rounded-lg border p-2.5 ${houseNet >= 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                {houseNet >= 0 ? <TrendingUp size={11} className="text-emerald-500/60" /> : <TrendingDown size={11} className="text-red-500/60" />}
                <p className={`text-[8px] font-heading uppercase tracking-wider ${houseNet >= 0 ? 'text-emerald-500/60' : 'text-red-500/60'}`}>House Net</p>
              </div>
              <p className={`text-lg font-heading font-bold tabular-nums ${houseNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {houseNet >= 0 ? '+' : '-'}{formatMoney(Math.abs(houseNet))}
              </p>
            </div>
          </div>
          {/* Win rate bar */}
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2 text-[8px] font-heading text-zinc-500 uppercase mb-1">
              <span>House {Math.round(((autoStats.house_wins ?? 0) / (autoStats.total_games || 1)) * 100)}%</span>
              <span className="flex-1" />
              <span>Players {Math.round(((autoStats.player_wins ?? 0) / (autoStats.total_games || 1)) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden flex">
              <div
                className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-700"
                style={{ width: `${((autoStats.house_wins ?? 0) / (autoStats.total_games || 1)) * 100}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
                style={{ width: `${((autoStats.player_wins ?? 0) / (autoStats.total_games || 1)) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AutoGameRow({ game: g, idx, myUserId, joiningId, onJoin }) {
  const entries = g.entries || [];
  const maxP = g.max_players || 10;
  const isIn = entries.some((e) => e.user_id === myUserId);
  const isFull = entries.length >= maxP;
  const countdown = useCountdown(g.auto_roll_deadline);
  const housePot = Number(g.house_pot ?? g.pot_money ?? 0);
  const currentPot = Number(g.pot_money ?? 0);
  const fee = Number(g.fee_money ?? 0);
  const odds = entries.length > 0 ? `1/${entries.length + 1}` : '—';

  return (
    <div
      className="rounded-lg border border-primary/15 bg-gradient-to-br from-primary/5 via-transparent to-transparent p-3 mdg-fade-in"
      style={{ animationDelay: `${0.05 + idx * 0.04}s` }}
    >
      {/* Top row: pot display + join */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center">
              <span className="text-[15px] font-heading font-black text-primary mdg-pot-glow tabular-nums">
                ${Math.round(housePot / 1_000_000)}M
              </span>
            </div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0 rounded bg-zinc-900 border border-primary/30 text-[7px] font-heading text-primary/60 uppercase whitespace-nowrap">
              house pot
            </div>
          </div>
          <div>
            <p className="text-xs font-heading font-bold text-foreground">
              Total Pot: <span className="text-primary mdg-pot-glow">{formatMoney(currentPot)}</span>
            </p>
            <p className="text-[9px] font-heading text-mutedForeground mt-0.5">
              Entry: <span className="text-foreground font-semibold">{formatMoney(fee)}</span>
              <span className="text-zinc-600 mx-1">·</span>
              Your odds: <span className="text-primary/80 font-semibold">{odds}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {!isIn && (
            <button
              type="button"
              disabled={joiningId === g.id || isFull}
              onClick={() => onJoin(g.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/50 bg-gradient-to-r from-primary/25 to-primary/15 text-primary font-heading font-bold text-[10px] uppercase tracking-wider hover:from-primary/35 hover:to-primary/25 disabled:opacity-40 transition-all shadow-lg shadow-primary/5"
            >
              <Dices size={13} />
              {joiningId === g.id ? 'Joining…' : isFull ? 'Full' : `Join · ${formatMoney(fee)}`}
            </button>
          )}
          {isIn && (
            <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[9px] font-heading font-bold uppercase">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.25-3.25a.75.75 0 0 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0Z"/></svg>
              Entered
            </div>
          )}
        </div>
      </div>

      {/* Slot meter — house counts as slot #1 */}
      <SlotMeter filled={entries.length} total={maxP} hasHouse className="mb-2" />

      {/* Bottom info row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* Countdown */}
        {countdown && (
          <div className="flex items-center gap-1.5">
            <Clock size={11} className={`text-primary/60 ${!isFull ? 'mdg-countdown-tick' : ''}`} />
            <span className="text-[9px] font-heading text-primary/80">
              {isFull ? (
                <span className="text-emerald-400 font-bold">Full — rolling now!</span>
              ) : (
                <>Rolls in <span className="font-bold tabular-nums">{countdown}</span></>
              )}
            </span>
          </div>
        )}
        {/* Players list — show House as first participant */}
        <div className="flex items-center gap-1.5">
          <Users size={11} className="text-zinc-600" />
          <span className="text-[9px] font-heading text-zinc-500 truncate max-w-[250px]">
            <span className="text-red-400/80 font-semibold">House</span>
            {entries.length > 0 && (
              <>
                {', '}
                <MdgPlayerUsernameLinks entries={entries} separator=", " />
              </>
            )}
          </span>
        </div>
        {entries.length === 0 && (
          <span className="text-[9px] font-heading text-zinc-600 italic">— be the first player to challenge the House!</span>
        )}
      </div>
    </div>
  );
}
