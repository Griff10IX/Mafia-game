import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Users, AlertCircle, DoorOpen, Bot, UserMinus } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';
import ActiveTokenBadge from '../../components/ActiveTokenBadge';

const DEFAULT_MOD_COLOR = '#1e3a5f';

const JAIL_STYLES = `
  @keyframes j-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .j-fade-in { animation: j-fade-in 0.4s ease-out both; }
  .j-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .j-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

// Card background (jail cell). Override: REACT_APP_JAIL_BACKGROUND_IMAGE in .env
const JAIL_BACKGROUND_IMAGE =
  process.env.REACT_APP_JAIL_BACKGROUND_IMAGE ||
  `${(process.env.PUBLIC_URL || '')}/jail-background.png`;

/** Keep in sync with `JAIL_BUST_MIN_INTERVAL_SEC` in backend `routers/crime/jail.py`. */
const JAIL_BUST_MIN_INTERVAL_SEC = 3;

/** While the Jail page is visible — each open tab used 1s + 3s polling, which scaled badly on the server. */
const JAIL_STATUS_POLL_MS = 3000;
const JAIL_PLAYERS_POLL_MS = 6000;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Jail sustained RL is stored server-side (Mongo), so it survives a full browser refresh.
 * On 429, wait Retry-After (or a short default) and retry so a refresh mid-cooldown can still load.
 * Sequential jail GETs on first paint avoid three parallel hits in the same RL window.
 */
async function jailGetWith429Retry(requestFn, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await requestFn();
    } catch (e) {
      lastErr = e;
      const st = e?.response?.status;
      if (st === 429 && attempt < maxAttempts - 1) {
        const h = e?.response?.headers;
        const raw = h?.['retry-after'] ?? h?.['Retry-After'];
        const sec = parseInt(String(raw), 10);
        const ms = Number.isFinite(sec) && sec > 0 && sec <= 120 ? sec * 1000 : 2500;
        await sleep(ms);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
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
  currentReward,
  onSnitchClick,
  snitching,
}) => {
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
              className="bg-primary/20 text-primary rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all touch-manipulation inline-flex items-center gap-1 font-heading"
            >
              <DoorOpen size={10} />
              {leavingJail ? 'Leaving...' : 'Leave Jail (3 pts)'}
            </button>
            <button
              type="button"
              onClick={onSnitchClick}
              disabled={snitching}
              className="bg-amber-500/20 text-amber-400 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50 transition-all touch-manipulation inline-flex items-center gap-1 font-heading"
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
                className="w-full h-6 pl-5 pr-1.5 rounded border border-primary/30 bg-black/40 text-white text-[10px] font-heading focus:border-primary/50 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={onSetReward}
              disabled={setRewardLoading}
              className="h-6 px-2 rounded bg-primary/20 text-primary font-heading text-[9px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all"
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
    className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-amber-500/40 bg-amber-500/10 j-fade-in"
  >
    <Bot size={14} className="text-amber-400" />
  </span>
);

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

  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md transition-all j-row ${
        player.is_self
          ? 'bg-red-500/10 border border-red-500/20 opacity-60'
          : 'bg-zinc-800/30 border border-transparent hover:border-primary/20'
      }`}
      data-testid={`jailed-player-${index}`}
    >
      {/* Player info */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="min-w-0">
          <div className="text-[11px] font-heading font-bold truncate">
            {isNpc ? (
              <span className="text-foreground">{player.username}</span>
            ) : (
              <Link
                to={`/profile/${encodeURIComponent(player.username)}`}
                className={`transition-colors hover:underline ${displayColor ? '' : 'text-primary'}`}
                style={displayColor ? { color: displayColor } : undefined}
              >
                {player.username}
              </Link>
            )}
          </div>
          <div className="text-[9px] text-mutedForeground truncate">
            {player.rank_name}
          </div>
        </div>
      </div>

      {/* Badge */}
      <div className="shrink-0">
        {player.is_self ? (
          <span className="px-1 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/40">
            You
          </span>
        ) : isNpc ? (
          <span
            className={`px-1 py-0.5 rounded text-[9px] font-bold uppercase border ${
              player.private_cell_npc
                ? 'bg-violet-500/15 text-violet-300 border-violet-500/35'
                : 'bg-zinc-700/50 text-mutedForeground border-zinc-600/50'
            }`}
          >
            {player.private_cell_npc ? 'Yours' : 'NPC'}
          </span>
        ) : null}
      </div>

      {/* Stats: cash reward only */}
      <div className="flex items-center gap-2 text-[10px] font-heading shrink-0">
        <span className="text-mutedForeground w-12 text-right">
          {(player.bust_reward_cash ?? 0) > 0 ? `$${Number(player.bust_reward_cash ?? 0).toLocaleString()}` : '—'}
        </span>
      </div>

      {/* Action */}
      <div className="shrink-0 min-w-[4.5rem] flex justify-end">
        {player.is_self ? (
          <span className="text-[10px] text-mutedForeground w-10 text-center inline-block">—</span>
        ) : manualPlayDisabled ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed inline-flex items-center gap-0.5"
          >
            Locked
          </button>
        ) : bustCooldownActive ? null : (
          <button
            type="button"
            onClick={() => onBust(player.username)}
            disabled={loading || userInJail}
            className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-0.5 font-heading"
            data-testid={`bust-out-${index}`}
          >
            🔓 Bust
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
          <span>Failed bust = 30s in jail (jailbust token can sometimes avoid the penalty)</span>
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
  const [jailStatus, setJailStatus] = useState({ in_jail: false });
  const [jailedPlayers, setJailedPlayers] = useState([]);
  const [jailStats, setJailStats] = useState({
    count_today: 0, count_week: 0, success_today: 0, success_week: 0,
    profit_today: 0, profit_24h: 0, profit_week: 0,
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [bustRewardInput, setBustRewardInput] = useState('');
  const [setRewardLoading, setSetRewardLoading] = useState(false);
  const [leavingJail, setLeavingJail] = useState(false);
  const [showSnitchModal, setShowSnitchModal] = useState(false);
  const [snitchTargetInput, setSnitchTargetInput] = useState('');
  const [snitching, setSnitching] = useState(false);

  const [autoRankJailDisabled, setAutoRankJailDisabled] = useState(false);
  const [privateCell, setPrivateCell] = useState({
    available: false,
    cooldown_seconds: 0,
    global_npc_count: 0,
    personal_npc_count: 0,
  });
  const [privateCellLoading, setPrivateCellLoading] = useState(false);
  const [privateCellCooldownRemaining, setPrivateCellCooldownRemaining] = useState(0);
  const [bustCooldownRemaining, setBustCooldownRemaining] = useState(0);
  const [user, setUser] = useState(null);
  const [staffListColors, setStaffListColors] = useState({
    admin_online_color: '#a78bfa',
    mod_default_online_color: DEFAULT_MOD_COLOR,
  });

  const fetchJailData = async () => {
    try {
      const bootRes = await jailGetWith429Retry(() => api.get('/jail/bootstrap'));
      const boot = bootRes?.data || {};
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
      // Keep user object fresh for components that rely on broader /auth/me fields.
      const meRes = await api.get('/auth/me').catch(() => ({ data: null }));
      if (meRes.data) setUser(meRes.data);
      setInitialLoading(false);
    } catch (error) {
      console.error('Failed to load jail data:', error);
      toast.error('Failed to load jail data');
      setJailStatus({ in_jail: false });
      setJailedPlayers([]);
      setJailStats({ count_today: 0, count_week: 0, success_today: 0, success_week: 0, profit_today: 0, profit_24h: 0, profit_week: 0 });
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
    } catch (error) {
      // Silent fail — players list will refresh on next full fetch
      console.error('Failed to refresh jail players:', error);
    }
  };

  const fetchJailStatus = async () => {
    try {
      const response = await api.get('/jail/status');
      const wasInJail = jailStatus.in_jail;
      setJailStatus(response.data);
      
      if (wasInJail && !response.data.in_jail) {
        toast.success('You are free!');
        fetchJailData();
      }
    } catch (error) {
      console.error('Failed to check jail status:', error);
    }
  };

  useEffect(() => {
    fetchJailData();
    let statusIntervalId;
    let playersIntervalId;
    const clearPolling = () => {
      if (statusIntervalId != null) clearInterval(statusIntervalId);
      if (playersIntervalId != null) clearInterval(playersIntervalId);
      statusIntervalId = undefined;
      playersIntervalId = undefined;
    };
    const startPolling = () => {
      clearPolling();
      statusIntervalId = window.setInterval(fetchJailStatus, JAIL_STATUS_POLL_MS);
      playersIntervalId = window.setInterval(fetchJailPlayers, JAIL_PLAYERS_POLL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) clearPolling();
      else {
        void fetchJailStatus();
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

  const bustOut = async (username) => {
    setLoading(true);
    try {
      const response = await api.post('/jail/bust', { target_username: username });
      if (response.status === 200) {
        startBustCooldown(JAIL_BUST_MIN_INTERVAL_SEC);
      }
      if (response.data.success) {
        let msg = response.data.message;
        if (response.data.cash_reward > 0) {
          msg += ` +$${Number(response.data.cash_reward).toLocaleString()}`;
        }
        if (response.data.respect_points > 0) {
          msg += ` +${response.data.respect_points} respect`;
        }
        toast.success(msg);
        refreshUser();
      } else {
        const jailTime = response.data.jail_time ?? 30;
        toast.error(response.data.message + (jailTime ? ` You're in jail for ${jailTime}s.` : ''));
        refreshUser();
      }
      await fetchJailData();
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
    } finally {
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

  if (initialLoading) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root`}>
        <style>{JAIL_STYLES}</style>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="jail-page">
      <style>{JAIL_STYLES}</style>

      {user?.jailbust_bonus_until && (
        <div className="j-fade-in">
          <ActiveTokenBadge tokenType="jailbust_bonus" untilIso={user.jailbust_bonus_until} />
        </div>
      )}

      <div className="relative j-fade-in flex items-center gap-2 flex-wrap">
        <p className="text-[9px] text-zinc-500 font-heading italic">Bust out jailed players for RP. Set a reward if you get locked up.</p>
      </div>

      <JailStatusCard
        inJail={jailStatus.in_jail}
        secondsRemaining={jailStatus.seconds_remaining}
        bustRewardInput={bustRewardInput}
        onBustRewardChange={setBustRewardInput}
        onSetReward={setBustReward}
        setRewardLoading={setRewardLoading}
        onLeaveJail={leaveJail}
        leavingJail={leavingJail}
        currentReward={jailStatus.bust_reward_cash ?? 0}
        onSnitchClick={() => setShowSnitchModal(true)}
        snitching={snitching}
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

      {autoRankJailDisabled && (
        <div className="j-fade-in flex items-center justify-start">
          <AutoRankIcon />
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
          className="shrink-0 px-2.5 py-1 rounded border border-primary/40 bg-primary/15 text-primary text-[9px] font-heading font-bold uppercase tracking-wide hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
          <div className="p-1.5 space-y-0.5">
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
              />
            ))}
          </div>
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
        <div className="p-2 text-[10px] font-heading text-foreground">
          Attempted busts today: {jailStats.count_today ?? 0}  streak {jailStatus.current_consecutive_busts ?? 0}  total successful busts {jailStatus.jail_busts ?? 0}
          <div className="mt-1 text-mutedForeground text-[9px]">
            Record {jailStatus.consecutive_busts_record ?? 0}  ·  Past week {jailStats.count_week ?? 0} busts, {jailStats.success_week ?? 0} successful  ·  Profit today ${(jailStats.profit_today ?? 0).toLocaleString()}  ·  Past week ${(jailStats.profit_week ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="j-art-line text-primary mx-2.5" />
      </div>
    </div>
  );
}
