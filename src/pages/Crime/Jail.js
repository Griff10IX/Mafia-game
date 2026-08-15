import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Users, AlertCircle, DoorOpen, Bot, UserMinus } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';
import { warmProfilePrefetchFromUsername } from '../../utils/profileNavPrefetch';
import { useAuthUser } from '../../context/AuthContext';
import {
  jailStatusFromAuthUser,
  prefetchJailPageData,
  readJailBootstrap,
  writeJailBootstrap,
} from '../../utils/jailPageWarm';
const DEFAULT_MOD_COLOR = '#1e3a5f';

const JAIL_STYLES = `
  @keyframes j-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .j-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .j-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }

  .j-row-reward { width: 4.75rem; text-align: right; }
  .j-row-time { width: 2.25rem; text-align: center; }

  @media (max-width: 767px) {
    .j-row {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "name action"
        "meta action";
      column-gap: 8px;
      row-gap: 2px;
      align-items: center;
      padding: 7px 8px !important;
    }
    .j-row-name { grid-area: name; min-width: 0; }
    .j-row-meta {
      grid-area: meta;
      display: flex !important;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      min-width: 0;
      width: 100%;
    }
    .j-row-action { grid-area: action; align-self: center; width: auto !important; justify-content: flex-end; }
    .j-row-name .j-name-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .j-row-action .j-action-btn {
      min-width: 4.25rem;
      justify-content: center;
    }
    .j-col-head { display: none !important; }
  }
`;
// Applied only on the first visit per session — replaying the fade on every
// navigation makes the page look like it fully reloaded.
const JAIL_FADE_STYLES = `
  .j-fade-in { animation: j-fade-in 0.4s ease-out both; }
`;
let _jailIntroPlayed = false;

// Card background (jail cell). Override: REACT_APP_JAIL_BACKGROUND_IMAGE in .env
const JAIL_BACKGROUND_IMAGE =
  process.env.REACT_APP_JAIL_BACKGROUND_IMAGE ||
  `${(process.env.PUBLIC_URL || '')}/jail-background.png`;

function jailTimeLeftSeconds(player, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (player?.jail_until) {
    const until = new Date(player.jail_until).getTime();
    if (Number.isFinite(until)) {
      return Math.max(0, Math.ceil((until - now) / 1000));
    }
  }
  return Math.max(0, Number(player?.seconds_remaining) || 0);
}

/** Keep in sync with `JAIL_BUST_MIN_INTERVAL_SEC` in backend `routers/crime/jail.py`. */
const JAIL_BUST_MIN_INTERVAL_SEC = 3;

/** While the Jail page is visible — polling is collapsed into one /jail/players call that also returns status. */
const JAIL_PLAYERS_POLL_MS = 6000;

// Warm jail cell art so the status card does not flash empty/default chrome.
try {
  if (typeof Image !== 'undefined' && JAIL_BACKGROUND_IMAGE) {
    const img = new Image();
    img.decoding = 'async';
    img.src = JAIL_BACKGROUND_IMAGE;
  }
} catch (_e) { /* ignore */ }

function parseBustWaitSecondsFromDetail(detail) {
  const s =
    typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && detail.message != null
        ? String(detail.message)
        : '';
  const m = s.match(/Wait (\d+)s/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

const JailStatusCard = ({ 
  inJail, 
  secondsRemaining, 
  bustRewardInput, 
  onBustRewardChange, 
  onSetReward, 
  setRewardLoading,
  onLeaveJail,
  leavingJail,
  onBailoutToken,
  bailingOut,
  bailoutTokens,
  currentReward,
  onSnitchClick,
  snitching,
  statusPending,
}) => {
  // Avoid Free ↔ Jail layout flip while bootstrap is still resolving.
  if (statusPending && !inJail) {
    return (
      <div className="relative border border-primary/30 rounded-md overflow-hidden w-full max-w-sm mx-auto min-h-[88px]">
        <div className="absolute inset-0 bg-zinc-950/80" aria-hidden />
        <div className="relative z-10 p-3 flex flex-col items-center justify-center gap-1.5">
          <div className="h-3 w-28 rounded bg-zinc-700/60" />
          <div className="h-6 w-16 rounded bg-zinc-700/40" />
          <div className="h-2.5 w-40 rounded bg-zinc-800/50" />
        </div>
      </div>
    );
  }

  if (inJail) {
    return (
      <div className="relative border-2 border-red-500/60 rounded-md overflow-hidden w-full max-w-sm mx-auto">
        <img 
          src={JAIL_BACKGROUND_IMAGE} 
          alt="" 
          className="absolute inset-0 w-full h-full object-cover" 
        />
        <div className="absolute inset-0 bg-black/70" aria-hidden />
        <div className="absolute inset-0 bg-red-950/30" aria-hidden />
        <div 
          className="relative z-10 p-2 text-center flex flex-col items-center justify-center" 
          style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
        >
          <Lock className="text-red-400 mb-0.5 drop-shadow-lg" size={18} />
          <h2 className="text-sm font-heading font-bold text-red-400 uppercase tracking-wider mb-0.5">
            You Are In Jail
          </h2>
          <div className="text-xl font-heading font-bold text-red-400 mb-1.5 tabular-nums">
            {secondsRemaining ?? 0}s
          </div>
          
          <p className="text-[9px] text-zinc-300 font-heading mb-1.5 max-w-[220px] leading-snug">
            💰 Bust reward:{' '}
            {currentReward > 0 ? (
              <span className="text-amber-200/90">${Number(currentReward).toLocaleString()}</span>
            ) : (
              <span className="text-zinc-500">none</span>
            )}
            <span className="block text-zinc-500 mt-0.5">You can&apos;t change this while in jail.</span>
          </p>
          
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={onLeaveJail}
              disabled={leavingJail}
              className="bg-primary/20 text-primary rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all touch-manipulation inline-flex items-center gap-1 font-heading"
            >
              <DoorOpen size={10} />
              {leavingJail ? 'Leaving...' : 'Leave Jail (3 pts)'}
            </button>
            {bailoutTokens > 0 && (
              <button
                type="button"
                onClick={onBailoutToken}
                disabled={bailingOut}
                className="bg-violet-500/20 text-violet-300 rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border border-violet-500/40 hover:bg-violet-500/30 disabled:opacity-50 transition-all touch-manipulation inline-flex items-center gap-1 font-heading"
              >
                {bailingOut ? '...' : `Bailout token (${bailoutTokens})`}
              </button>
            )}
            <button
              type="button"
              onClick={onSnitchClick}
              disabled={snitching}
              className="bg-amber-500/20 text-amber-400 rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50 transition-all touch-manipulation inline-flex items-center gap-1 font-heading"
              title="Snitch on someone to get released; they serve time and get a notification (not who did it)"
            >
              <UserMinus size={10} />
              {snitching ? '...' : 'Snitch'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative border border-primary/30 rounded-md overflow-hidden shadow-lg w-full max-w-sm mx-auto">
      <img 
        src={JAIL_BACKGROUND_IMAGE} 
        alt="" 
        className="absolute inset-0 w-full h-full object-cover" 
      />
      <div className="absolute inset-0 bg-black/60" aria-hidden />
      <div 
        className="relative z-10 p-2 text-center flex flex-col items-center justify-center" 
        style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
      >
        <AlertCircle className="text-primary/80 mb-0.5 drop-shadow-lg" size={18} />
        <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider mb-0.5">
          You Are Free
        </h2>
        <p className="text-[9px] text-zinc-300 font-heading mb-1.5">
          Bust out jailed players for rank points
        </p>
        
        {/* Reward setting when free */}
        <div className="w-full max-w-[200px]">
          <label className="block text-[9px] font-heading text-zinc-400 mb-0.5">
            💰 Set reward if you get jailed
            {currentReward > 0 && <span className="text-primary ml-1">(Current: ${Number(currentReward).toLocaleString()})</span>}
          </label>
          <div className="flex gap-1">
            <div className="relative flex-1">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/60 text-[10px]">$</span>
              <FormattedNumberInput
                value={bustRewardInput}
                onChange={onBustRewardChange}
                placeholder="0"
                className="w-full min-h-9 pl-5 pr-1.5 rounded border border-primary/30 bg-black/40 text-white text-[10px] font-heading focus:border-primary/50 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={onSetReward}
              disabled={setRewardLoading}
              className="min-h-9 px-2.5 rounded bg-primary/20 text-primary font-heading text-[9px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all touch-manipulation"
            >
              {setRewardLoading ? '...' : 'Set'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Compact status icon: Auto Rank active
const AutoRankIcon = () => (
  <span
    title="Auto Rank — Busts are running automatically. Manual play disabled."
    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border border-amber-500/40 bg-amber-500/10"
  >
    <Bot size={10} className="text-amber-400" />
  </span>
);

const JAIL_ACTION_IDLE =
  'j-action-btn bg-zinc-700/50 text-mutedForeground rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed font-heading';
const JAIL_ACTION_BUST =
  'j-action-btn tap-feedback bg-primary/20 text-primary rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 active:scale-[0.97] transition-all touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed font-heading';

const JailedPlayerRow = ({
  player,
  index,
  onBust,
  loading,
  userInJail,
  manualPlayDisabled,
  bustCooldownActive,
  adminOnlineColor,
  modDefaultOnlineColor,
  nowTick,
}) => {
  const legacyNpcRp = [16, 25].includes(Number(player?.rp_reward));
  const isNpc =
    player.is_jail_list_npc === true ||
    (player.is_jail_list_npc === undefined && legacyNpcRp);
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';
  const modColor = (modDefaultOnlineColor && modDefaultOnlineColor.trim()) || DEFAULT_MOD_COLOR;
  // Match Users Online / admin settings: per-user online_color (mod custom colour), else global admin/mod defaults
  const displayColor =
    !isNpc &&
    (player.online_color ||
      (player.is_admin ? adminColor : player.is_moderator ? modColor : undefined));

  const jailSecs = jailTimeLeftSeconds(player, nowTick);
  const rewardCash = Number(player.bust_reward_cash ?? 0);

  return (
    <div
      className={`j-row flex items-center justify-between gap-3 px-2 py-1.5 rounded-md transition-all ${
        player.is_self
          ? 'bg-red-500/10 border border-red-500/20 opacity-60'
          : 'bg-zinc-800/30 border border-transparent hover:border-primary/20'
      }`}
      data-testid={`jailed-player-${index}`}
    >
      <div className="j-row-name flex items-center gap-1 min-w-0 flex-1">
        <span className="text-primary/50 text-[10px] shrink-0">▸</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap gap-y-0.5">
            {isNpc ? (
              <span className="j-name-text text-xs font-heading font-bold text-foreground truncate">{player.username}</span>
            ) : (
              <Link
                to={`/profile/${encodeURIComponent(player.username)}`}
                className={`j-name-text text-xs font-heading font-bold truncate transition-colors hover:underline ${displayColor ? '' : 'text-primary'}`}
                style={displayColor ? { color: displayColor } : undefined}
                onPointerDown={() => warmProfilePrefetchFromUsername(player.username)}
                onPointerEnter={() => warmProfilePrefetchFromUsername(player.username)}
              >
                {player.username}
              </Link>
            )}
            {player.is_self ? (
              <span className="px-1 py-0.5 rounded text-[8px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/40">You</span>
            ) : isNpc ? (
              <span
                className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase border ${
                  player.private_cell_npc
                    ? 'bg-violet-500/15 text-violet-300 border-violet-500/35'
                    : 'bg-zinc-700/50 text-mutedForeground border-zinc-600/50'
                }`}
              >
                {player.private_cell_npc ? 'Yours' : 'NPC'}
              </span>
            ) : null}
          </div>
          {player.rank_name ? (
            <div className="text-[9px] text-mutedForeground truncate mt-0.5">
              {player.rank_name}
            </div>
          ) : null}
        </div>
      </div>

      <div className="j-row-meta flex items-center gap-2 shrink-0">
        <div className="j-row-reward shrink-0">
          <span className="text-[10px] font-heading font-bold tabular-nums text-primary">
            {rewardCash > 0 ? `$${rewardCash.toLocaleString()}` : '—'}
          </span>
        </div>
        <div className="j-row-time shrink-0">
          {jailSecs > 0 ? (
            <span className="text-[10px] text-red-400 font-heading tabular-nums" title={`${jailSecs}s left in jail`}>
              {jailSecs}s
            </span>
          ) : (
            <span className="text-[9px] text-mutedForeground" title={isNpc ? 'NPCs stay until busted' : undefined}>—</span>
          )}
        </div>
      </div>

      <div className="j-row-action shrink-0 w-[60px] flex justify-end">
        {player.is_self ? (
          <span className="text-[9px] text-mutedForeground">—</span>
        ) : player.unbustable || bustCooldownActive ? (
          <button type="button" disabled className={JAIL_ACTION_IDLE}>Wait</button>
        ) : manualPlayDisabled ? (
          <button type="button" disabled className={JAIL_ACTION_IDLE}>Locked</button>
        ) : (
          <button
            type="button"
            onClick={() => onBust(player.username)}
            disabled={loading || userInJail}
            className={JAIL_ACTION_BUST}
            data-testid={`bust-out-${index}`}
          >
            Bust
          </button>
        )}
      </div>
    </div>
  );
};

const InfoSection = () => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 j-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        ℹ️ Jail System
      </h3>
    </div>
    <div className="p-2">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-mutedForeground font-heading">
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>Failed crimes/GTA = 15–60s jail</span>
        </li>
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>Success chance = your bust skill (more busts = higher %)</span>
        </li>
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            No public NPCs in jail? Summon <strong className="text-foreground">5 private inmates</strong> only you see — once every 5 minutes, max 5 at a time until you bust them out.
          </span>
        </li>
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>Failed bust = 30s in jail (with a jailbust token active: 50% chance you slip away)</span>
        </li>
        <li className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>In jail? Snitch on someone (or random online). 10–20% success; on success you’re released and they serve time. Snitched-on players can’t be snitched again for 5 mins.</span>
        </li>
      </ul>
    </div>
    <div className="j-art-line text-primary mx-2.5" />
  </div>
);

// Main component
export default function Jail() {
  const authUser = useAuthUser();
  const cachedBoot = readJailBootstrap();
  const animateIn = useRef(!_jailIntroPlayed).current;
  useEffect(() => { _jailIntroPlayed = true; }, []);
  const cachedPlayers = cachedBoot?.players || {};
  const seededStatus = cachedBoot?.status || jailStatusFromAuthUser(authUser);
  const [jailStatus, setJailStatus] = useState(seededStatus || { in_jail: false });
  const [jailedPlayers, setJailedPlayers] = useState(() => (
    Array.isArray(cachedPlayers.players) ? cachedPlayers.players : []
  ));
  const [jailStats, setJailStats] = useState(cachedBoot?.stats || {
    count_today: 0, count_week: 0, success_today: 0, success_week: 0,
    profit_today: 0, profit_24h: 0, profit_week: 0,
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!cachedBoot);
  const [bustRewardInput, setBustRewardInput] = useState('');
  const [setRewardLoading, setSetRewardLoading] = useState(false);
  const [leavingJail, setLeavingJail] = useState(false);
  const [bailingOut, setBailingOut] = useState(false);
  const [showSnitchModal, setShowSnitchModal] = useState(false);
  const [snitchTargetInput, setSnitchTargetInput] = useState('');
  const [snitching, setSnitching] = useState(false);

  const [autoRankJailDisabled, setAutoRankJailDisabled] = useState(() => {
    const ar = cachedBoot?.auto_rank || {};
    return !!(ar.auto_rank_enabled && ar.auto_rank_bust_every_5_sec);
  });
  const [privateCell, setPrivateCell] = useState(() => {
    const pc = cachedPlayers.private_cell || {};
    return {
      available: !!pc.available,
      cooldown_seconds: Math.max(0, Number(pc.cooldown_seconds) || 0),
      global_npc_count: Math.max(0, Number(pc.global_npc_count) || 0),
      personal_npc_count: Math.max(0, Number(pc.personal_npc_count) || 0),
    };
  });
  const [privateCellLoading, setPrivateCellLoading] = useState(false);
  const [privateCellCooldownRemaining, setPrivateCellCooldownRemaining] = useState(0);
  const [bustCooldownRemaining, setBustCooldownRemaining] = useState(0);
  const [listNowMs, setListNowMs] = useState(() => Date.now());
  const [user, setUser] = useState(cachedBoot?.me || null);
  const [staffListColors, setStaffListColors] = useState({
    admin_online_color: cachedPlayers.admin_online_color || '#a78bfa',
    mod_default_online_color: cachedPlayers.mod_default_online_color || DEFAULT_MOD_COLOR,
  });
  const jailStatusRef = useRef(jailStatus);
  const bustInFlightRef = useRef(false);

  useEffect(() => {
    jailStatusRef.current = jailStatus;
  }, [jailStatus]);

  const applyJailBootstrap = (boot) => {
      setJailStatus(boot.status || { in_jail: false });
      const pd = boot.players || {};
      setJailedPlayers(Array.isArray(pd.players) ? pd.players : []);
      if (pd.private_cell && typeof pd.private_cell === 'object') {
        setPrivateCell({
          available: !!pd.private_cell.available,
          cooldown_seconds: Math.max(0, Number(pd.private_cell.cooldown_seconds) || 0),
          global_npc_count: Math.max(0, Number(pd.private_cell.global_npc_count) || 0),
          personal_npc_count: Math.max(0, Number(pd.private_cell.personal_npc_count) || 0),
        });
      }
      setStaffListColors({
        admin_online_color: pd.admin_online_color || '#a78bfa',
        mod_default_online_color: pd.mod_default_online_color || DEFAULT_MOD_COLOR,
      });
      setJailStats(boot.stats || {});
      const ar = boot.auto_rank || {};
      setAutoRankJailDisabled(!!(ar.auto_rank_enabled && ar.auto_rank_bust_every_5_sec));
      if (boot.me) {
        setUser((prev) => ({ ...(prev || {}), ...boot.me }));
      }
  };

  const fetchJailData = async () => {
    try {
      const boot = (await prefetchJailPageData({ force: true })) || {};
      if (boot && (boot.status || boot.players || boot.stats)) {
        applyJailBootstrap(boot);
        writeJailBootstrap(boot);
      }
      setInitialLoading(false);
    } catch (error) {
      console.error('Failed to load jail data:', error);
      if (!cachedBoot && !authUser?.in_jail) {
        toast.error('Failed to load jail data');
        setJailStatus({ in_jail: false });
        setJailedPlayers([]);
        setJailStats({ count_today: 0, count_week: 0, success_today: 0, success_week: 0, profit_today: 0, profit_24h: 0, profit_week: 0 });
      }
      setInitialLoading(false);
    }
  };

  const fetchJailPlayers = async () => {
    try {
      const res = await api.get('/jail/players');
      const pd = res.data || {};
      setJailedPlayers(Array.isArray(pd.players) ? pd.players : []);
      if (pd.private_cell && typeof pd.private_cell === 'object') {
        setPrivateCell({
          available: !!pd.private_cell.available,
          cooldown_seconds: Math.max(0, Number(pd.private_cell.cooldown_seconds) || 0),
          global_npc_count: Math.max(0, Number(pd.private_cell.global_npc_count) || 0),
          personal_npc_count: Math.max(0, Number(pd.private_cell.personal_npc_count) || 0),
        });
      }
      if (pd.admin_online_color != null || pd.mod_default_online_color != null) {
        setStaffListColors((prev) => ({
          admin_online_color: pd.admin_online_color ?? prev.admin_online_color,
          mod_default_online_color: pd.mod_default_online_color ?? prev.mod_default_online_color,
        }));
      }
      if (pd.status && typeof pd.status === 'object') {
        const wasInJail = !!jailStatusRef.current?.in_jail;
        jailStatusRef.current = pd.status;
        setJailStatus(pd.status);
        if (wasInJail && !pd.status.in_jail) {
          toast.success('You are free!');
          fetchJailData();
        }
      }
    } catch (error) {
      // Silent fail — players list will refresh on next full fetch
      console.error('Failed to refresh jail players:', error);
    }
  };

  useEffect(() => {
    fetchJailData();
    let playersIntervalId;
    const clearPolling = () => {
      if (playersIntervalId != null) clearInterval(playersIntervalId);
      playersIntervalId = undefined;
    };
    const startPolling = () => {
      clearPolling();
      playersIntervalId = window.setInterval(fetchJailPlayers, JAIL_PLAYERS_POLL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) clearPolling();
      else {
        void fetchJailPlayers();
        startPolling();
      }
    };
    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearPolling();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPrivateCellCooldownRemaining(Math.max(0, Number(privateCell.cooldown_seconds) || 0));
  }, [privateCell.cooldown_seconds]);

  const hasTimedInmate = jailedPlayers.some((p) => p?.jail_until || Number(p?.seconds_remaining) > 0);
  useEffect(() => {
    if (!hasTimedInmate) return undefined;
    const id = window.setInterval(() => setListNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasTimedInmate]);

  useEffect(() => {
    if (privateCellCooldownRemaining <= 0) return undefined;
    const id = window.setInterval(() => {
      setPrivateCellCooldownRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [privateCellCooldownRemaining > 0]);

  const startBustCooldown = (seconds) => {
    const n = Math.floor(Number(seconds));
    setBustCooldownRemaining(Math.max(1, Number.isFinite(n) ? n : JAIL_BUST_MIN_INTERVAL_SEC));
  };

  useEffect(() => {
    if (bustCooldownRemaining <= 0) return undefined;
    const id = window.setInterval(() => {
      setBustCooldownRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [bustCooldownRemaining > 0]);

  useEffect(() => {
    if (bustRewardInput === '' && (jailStatus.bust_reward_cash ?? 0) > 0) {
      setBustRewardInput(String(jailStatus.bust_reward_cash));
    }
  }, [jailStatus.bust_reward_cash, bustRewardInput]);

  // Local countdown so seeded auth jail_until stays live between polls.
  useEffect(() => {
    if (!jailStatus.in_jail) return undefined;
    const id = window.setInterval(() => {
      setJailStatus((s) => {
        if (!s?.in_jail) return s;
        const until = s.jail_until;
        if (until) {
          const left = Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
          if (left === (s.seconds_remaining ?? 0)) return s;
          if (left <= 0) return { ...s, in_jail: false, seconds_remaining: 0 };
          return { ...s, seconds_remaining: left };
        }
        const cur = Math.max(0, Number(s.seconds_remaining) || 0);
        if (cur <= 0) return { ...s, in_jail: false, seconds_remaining: 0 };
        return { ...s, seconds_remaining: cur - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [jailStatus.in_jail]);

  const leaveJail = async () => {
    setLeavingJail(true);
    try {
      const response = await api.post('/jail/leave');
      if (response.data.success) {
        toast.success(response.data.message);
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      } else {
        toast.error(response.data.message || 'Failed to leave jail');
      }
      fetchJailData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to leave jail');
    } finally {
      setLeavingJail(false);
    }
  };

  const bailoutWithToken = async () => {
    setBailingOut(true);
    try {
      const response = await api.post('/jail/bailout-token');
      if (response.data.success) {
        toast.success(response.data.message);
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      }
      fetchJailData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bailout failed');
    } finally {
      setBailingOut(false);
    }
  };

  const bustOut = async (username) => {
    if (loading || bustInFlightRef.current || bustCooldownRemaining > 0 || jailStatus.in_jail) return;
    bustInFlightRef.current = true;
    setLoading(true);
    try {
      const response = await api.post('/jail/bust', { target_username: username });
      const data = response.data || {};
      if (response.status === 200) {
        startBustCooldown(JAIL_BUST_MIN_INTERVAL_SEC);
      }
      if (data.success) {
        let msg = data.message;
        if (data.cash_reward > 0) {
          msg += ` +$${Number(data.cash_reward).toLocaleString()}`;
        }
        if (data.respect_points > 0) {
          msg += ` +${data.respect_points} respect`;
        }
        toast.success(msg);
        const cash = Number(data.cash_reward) || 0;
        setJailedPlayers((prev) =>
          (Array.isArray(prev) ? prev : []).filter(
            (p) => String(p?.username || '').toLowerCase() !== String(username || '').toLowerCase(),
          ),
        );
        setJailStats((prev) => ({
          ...prev,
          count_today: (prev.count_today || 0) + 1,
          count_week: (prev.count_week || 0) + 1,
          success_today: (prev.success_today || 0) + 1,
          success_week: (prev.success_week || 0) + 1,
          profit_today: (prev.profit_today || 0) + cash,
          profit_24h: (prev.profit_24h || 0) + cash,
          profit_week: (prev.profit_week || 0) + cash,
        }));
        refreshUser();
      } else {
        const jailTime = data.jail_time ?? 30;
        toast.error(data.message + (jailTime ? ` You're in jail for ${jailTime}s.` : ''));
        setJailStats((prev) => ({
          ...prev,
          count_today: (prev.count_today || 0) + 1,
          count_week: (prev.count_week || 0) + 1,
        }));
        if (jailTime > 0) {
          const until = new Date(Date.now() + jailTime * 1000).toISOString();
          setJailStatus((s) => ({ ...s, in_jail: true, jail_until: until }));
        }
        refreshUser();
        // List may still be fine; light poll only (not full bootstrap).
        fetchJailPlayers().catch(() => {});
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      const waitSec = parseBustWaitSecondsFromDetail(detail);
      startBustCooldown(waitSec ?? JAIL_BUST_MIN_INTERVAL_SEC);
      const msg =
        typeof detail === 'string'
          ? detail
          : detail && typeof detail === 'object' && detail.message != null
            ? String(detail.message)
            : 'Failed to bust out';
      toast.error(msg);
      if (/not in jail|no longer in jail/i.test(msg)) {
        setJailedPlayers((prev) =>
          (Array.isArray(prev) ? prev : []).filter(
            (p) => String(p?.username || '').toLowerCase() !== String(username || '').toLowerCase(),
          ),
        );
      }
    } finally {
      bustInFlightRef.current = false;
      setLoading(false);
    }
  };

  const setBustReward = async () => {
    if (jailStatus.in_jail) {
      toast.error("You can't change your bust reward while in jail.");
      return;
    }
    const amount = Math.max(0, parseInt(String(bustRewardInput).replace(/\D/g, ''), 10) || 0);
    setSetRewardLoading(true);
    try {
      const res = await api.post('/jail/set-bust-reward', { amount });
      toast.success(res.data?.message || 'Reward set');
      setJailStatus((s) => ({ ...s, bust_reward_cash: res.data?.bust_reward_cash ?? amount }));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set reward');
    } finally {
      setSetRewardLoading(false);
    }
  };

  const doSnitch = async (targetUsername) => {
    setSnitching(true);
    try {
      const res = await api.post('/jail/snitch', { target_username: targetUsername || undefined });
      if (res.data?.success) {
        toast.success(res.data.message);
        setShowSnitchModal(false);
        setSnitchTargetInput('');
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
        fetchJailData();
      } else {
        toast.error(res.data?.message || "The guards didn't buy it. You're still in jail.");
        fetchJailData();
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Snitch failed');
    } finally {
      setSnitching(false);
    }
  };

  const submitSnitch = () => {
    const name = snitchTargetInput.trim();
    if (name) {
      doSnitch(name);
    } else {
      doSnitch('random');
    }
  };

  const summonPrivateCell = async () => {
    setPrivateCellLoading(true);
    try {
      const res = await api.post('/jail/private-cell');
      toast.success(res.data?.message || 'Private inmates summoned.');
      await fetchJailData();
      refreshUser();
    } catch (e) {
      const st = e.response?.status;
      const detail = e.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Could not summon private inmates');
      if (st === 429 || st === 400) {
        try {
          const r = await api.get('/jail/players');
          const pd = r.data || {};
          if (pd.private_cell && typeof pd.private_cell === 'object') {
            setPrivateCell({
              available: !!pd.private_cell.available,
              cooldown_seconds: Math.max(0, Number(pd.private_cell.cooldown_seconds) || 0),
              global_npc_count: Math.max(0, Number(pd.private_cell.global_npc_count) || 0),
              personal_npc_count: Math.max(0, Number(pd.private_cell.personal_npc_count) || 0),
            });
          }
        } catch (_) {}
      }
    } finally {
      setPrivateCellLoading(false);
    }
  };

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="jail-page">
      <style>{JAIL_STYLES + (animateIn ? JAIL_FADE_STYLES : '')}</style>

      <p className="relative j-fade-in text-[9px] text-zinc-500 font-heading italic inline-flex items-center gap-1.5 flex-wrap leading-none">
        <span>Bust out jailed players for RP. Set a reward if you get locked up.</span>
        {autoRankJailDisabled && <AutoRankIcon />}
      </p>

      <JailStatusCard
        inJail={!!jailStatus.in_jail}
        secondsRemaining={jailStatus.seconds_remaining}
        bustRewardInput={bustRewardInput}
        onBustRewardChange={setBustRewardInput}
        onSetReward={setBustReward}
        setRewardLoading={setRewardLoading}
        onLeaveJail={leaveJail}
        leavingJail={leavingJail}
        onBailoutToken={bailoutWithToken}
        bailingOut={bailingOut}
        bailoutTokens={Number(user?.jail_bailout_tokens || authUser?.jail_bailout_tokens || 0)}
        currentReward={jailStatus.bust_reward_cash ?? 0}
        onSnitchClick={() => setShowSnitchModal(true)}
        snitching={snitching}
        statusPending={initialLoading && !jailStatus.in_jail && !cachedBoot}
      />

      {/* Snitch modal (when in jail) */}
      {showSnitchModal && jailStatus.in_jail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
          onClick={() => !snitching && setShowSnitchModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="snitch-modal-title"
        >
          <div
            className={`${styles.panel} w-full max-w-sm rounded-lg overflow-hidden border border-amber-500/40 shadow-xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 flex items-center gap-2">
              <UserMinus size={14} className="text-amber-400 shrink-0" />
              <h2 id="snitch-modal-title" className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wider">
                Snitch to the guards
              </h2>
            </div>
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground">
                Name someone to snitch on. If the deal goes through, you get released and they serve time. They&apos;ll get a notification that they were snitched on — but not by who.
              </p>
              <div>
                <label className="block text-[9px] font-heading text-mutedForeground mb-1">Username (leave blank for random online)</label>
                <input
                  type="text"
                  value={snitchTargetInput}
                  onChange={(e) => setSnitchTargetInput(e.target.value)}
                  placeholder="e.g. BigBoss or leave empty"
                  className="w-full px-2.5 py-1.5 rounded border border-primary/30 bg-black/40 text-foreground text-[11px] font-heading placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
                  disabled={snitching}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => doSnitch('random')}
                  disabled={snitching}
                  className="flex-1 px-3 py-1.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-heading font-bold uppercase border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {snitching ? '...' : 'Pick random online'}
                </button>
                <button
                  type="button"
                  onClick={submitSnitch}
                  disabled={snitching}
                  className="flex-1 px-3 py-1.5 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
                >
                  {snitching ? '...' : 'Snitch'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => !snitching && setShowSnitchModal(false)}
                className="w-full py-1 text-[10px] text-mutedForeground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 j-fade-in rounded border border-primary/15 bg-zinc-900/40 px-2 py-1.5">
        <button
          type="button"
          onClick={summonPrivateCell}
          disabled={
            privateCellLoading ||
            !privateCell.available ||
            jailStatus.in_jail ||
            autoRankJailDisabled ||
            privateCell.global_npc_count > 0
          }
          className="j-action-btn shrink-0 min-h-9 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary text-[9px] font-heading font-bold uppercase tracking-wide hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all touch-manipulation"
        >
          {privateCellLoading ? '…' : 'Private cell'}
        </button>
        <p className="text-[9px] text-mutedForeground font-heading leading-snug min-w-0 flex-1">
          {privateCell.global_npc_count > 0 ? (
            <>Public NPCs in jail — private summon locked.</>
          ) : jailStatus.in_jail ? (
            <>Can&apos;t summon while you&apos;re in jail.</>
          ) : autoRankJailDisabled ? (
            <span className="text-amber-400/90">Auto Rank bust-5s on — turn off to summon manually.</span>
          ) : privateCell.personal_npc_count > 0 ? (
            <>
              <span className="text-foreground font-bold tabular-nums">{privateCell.personal_npc_count}/5</span> yours — bust out to summon again
              {privateCellCooldownRemaining > 0 && (
                <>
                  {' '}
                  · <span className="text-primary tabular-nums">
                    {Math.floor(privateCellCooldownRemaining / 60)}:{String(privateCellCooldownRemaining % 60).padStart(2, '0')}
                  </span>{' '}
                  until next batch allowed
                </>
              )}
            </>
          ) : privateCellCooldownRemaining > 0 ? (
            <>
              Next summon{' '}
              <span className="text-primary font-bold tabular-nums">
                {Math.floor(privateCellCooldownRemaining / 60)}:{String(privateCellCooldownRemaining % 60).padStart(2, '0')}
              </span>
              {' '}(5 min between batches)
            </>
          ) : privateCell.available ? (
            <>No public NPCs — adds 5 inmates only you see (5 min cooldown).</>
          ) : (
            <>When the jail has no public NPCs, tap to summon 5 private inmates.</>
          )}
        </p>
      </div>

      {/* Jailed Players */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 j-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
            <Users size={10} />
            Jailed Players
          </span>
          <span className="text-[10px] text-primary font-heading font-bold">
            {jailedPlayers.length}
          </span>
        </div>

        {jailedPlayers.length === 0 ? (
          <div className="px-3 py-4 text-center text-mutedForeground text-[10px] font-heading italic">
            No players currently in jail
          </div>
        ) : (
          <>
        <div className="j-col-head hidden md:flex items-center gap-3 px-2 pt-1.5 pb-0.5">
          <span className="flex-1 min-w-0 text-[8px] font-heading font-bold uppercase tracking-[0.12em] text-mutedForeground">Player</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="j-row-reward text-[8px] font-heading font-bold uppercase tracking-[0.12em] text-mutedForeground">Reward</span>
            <span className="j-row-time text-[8px] font-heading font-bold uppercase tracking-[0.12em] text-mutedForeground">Time</span>
          </div>
          <span className="w-[60px] shrink-0" aria-hidden />
        </div>
          <div className="p-1.5 space-y-0.5 sm:space-y-1">
            {jailedPlayers.map((player, index) => (
              <JailedPlayerRow
                key={player.username != null ? `${String(player.username)}-${index}` : `player-${index}`}
                player={player}
                index={index}
                onBust={bustOut}
                loading={loading}
                userInJail={jailStatus.in_jail}
                manualPlayDisabled={autoRankJailDisabled}
                bustCooldownActive={bustCooldownRemaining > 0}
                adminOnlineColor={staffListColors.admin_online_color}
                modDefaultOnlineColor={staffListColors.mod_default_online_color}
                nowTick={listNowMs}
              />
            ))}
          </div>
          </>
        )}
        <div className="j-art-line text-primary mx-2.5" />
      </div>

      <InfoSection />

      {/* Bust stats */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 j-fade-in mobile-panel`} style={{ animationDelay: '0.03s' }}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Bust stats</span>
        </div>
        <div className="p-2 text-[10px] font-heading text-mutedForeground space-y-1">
          <div>
            Attempted busts today:{' '}
            <span className="text-primary font-bold tabular-nums">{(jailStats.count_today ?? 0).toLocaleString()}</span>
            {' '}· Streak{' '}
            <span className="text-amber-300 font-bold tabular-nums">{(jailStatus.current_consecutive_busts ?? 0).toLocaleString()}</span>
            {' '}· Total successful{' '}
            <span className="text-emerald-400 font-bold tabular-nums">{(jailStatus.jail_busts ?? 0).toLocaleString()}</span>
          </div>
          <div className="text-[9px]">
            Record{' '}
            <span className="text-amber-300 font-bold tabular-nums">{(jailStatus.consecutive_busts_record ?? 0).toLocaleString()}</span>
            {' '}· Past week{' '}
            <span className="text-primary font-bold tabular-nums">{(jailStats.count_week ?? 0).toLocaleString()}</span>
            {' '}busts,{' '}
            <span className="text-emerald-400 font-bold tabular-nums">{(jailStats.success_week ?? 0).toLocaleString()} successful</span>
            {' '}· Profit today{' '}
            <span className="text-emerald-400 font-bold tabular-nums">${(jailStats.profit_today ?? 0).toLocaleString()}</span>
            {' '}· Past week{' '}
            <span className="text-emerald-400 font-bold tabular-nums">${(jailStats.profit_week ?? 0).toLocaleString()}</span>
          </div>
        </div>
        <div className="j-art-line text-primary mx-2.5" />
      </div>
    </div>
  );
}
