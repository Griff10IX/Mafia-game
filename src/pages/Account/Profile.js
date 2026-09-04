import { useEffect, useMemo, useRef, useState } from 'react';
import React from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { User as UserIcon, Search, Shield, Trophy, Building2, Mail, Skull, Users as UsersIcon, Ghost, Settings, Plane, Factory, DollarSign, MessageCircle, Car, Youtube, Bold, Italic, Image, Palette, AlignCenter, Target, Lock, Unlock, Heart, Volume2, FileText, Dices, Activity, GalleryVerticalEnd, Radio, Award, Music2, Play, Pause, SkipBack, SkipForward, ExternalLink, X, Crown, Star, Eraser, Eye, Bot } from 'lucide-react';
import api, { apiGetWithResumeRetries, getApiErrorMessage, isTransientResumeLoadError, shouldSuppressResumeNetworkToast } from '../../utils/api';
import {
  apiPostWithCivilianProtectionConfirm,
  isCivilianProtectionConfirmCancelled,
} from '../../utils/civilianProtectionConfirm';
import {
  isStaffPortalTokenValid,
} from '../../utils/staffPortalSession';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import PrestigeBadge from '../../components/PrestigeBadge';
import CivilianProtectionBadge from '../../components/CivilianProtectionBadge';
import CountryFlagThumb from '../../components/CountryFlagThumb';
import { parseForumContent, insertAtCursor } from '../../utils/forumContent';
import { filterProfanity } from '../../utils/profanityFilter';
import styles from '../../styles/noir.module.css';
import { BadgeShield, BADGE_STYLES as RANKING_BADGE_STYLES, CATEGORY_LABELS } from '../Game/RankingBadges';
import StaffUserDetailsPanel from '../../components/StaffUserDetailsPanel';
import FamilyEmblem from '../../components/FamilyEmblem';
import {
  getProfilePrefetch,
  setProfilePrefetch,
  getProfileSessionLastMeUsername,
  setProfileSessionLastMeUsername,
} from '../../utils/prefetchCache';
import { getProfileEditWarm } from '../../utils/profilePageWarm';
import { prefetchViewCarPage } from '../../utils/viewCarWarm';
import { TOAST_MUTEABLE_PAGES, setToastMutedPages, normalizeToastMutedPages, getToastMutedPages } from '../../utils/toastPageMutes';
import { fileToAvatarDataUrl, fileToCustomBadgeDataUrl, validateSafeImageFile, AVATAR_RAW_UPLOAD_MAX_BYTES } from '../../utils/fileToCompressedDataUrl';
import { formatGameDateTime as formatDateTime } from '../../utils/gameDateTime';
import { robotBodyguardAvatarUrl } from '../../utils/robotBodyguardAvatar';
import { defaultPlayerAvatarUrl } from '../../utils/defaultPlayerAvatar';
import { PROFILE_GLOW_BORDER_CSS, customGlowBorderStyle, PROFILE_GLOW_PRESETS } from '../../constants/profileGlowPresets';
import GlowPresetPicker from '../../components/GlowPresetPicker';
import { isValidTelegramChatId } from '../../utils/telegramChatId';
import ProfileMessagePopup from '../Social/ProfileMessagePopup';

function formatProfileViewCount(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v < 10000) return v.toLocaleString();
  if (v < 1000000) {
    const k = v / 1000;
    return `${k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  const m = v / 1000000;
  return `${m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, '')}M`;
}

const PROFILE_EDIT_TAB_IDS = new Set(['look', 'text', 'alerts', 'privacy', 'account', 'staff']);
const PROFILE_EDIT_TAB_KEY = 'profile_edit_tab';
const DEFAULT_NOTIFICATION_PREFERENCES = {
  ent_games: true,
  oc_invites: true,
  attacks: true,
  system: true,
  quicktrade: true,
  messages: true,
  forum_topic_reply: true,
  forum_comment_reply: true,
  forum_mention: true,
  game_chat_mention: true,
  designer_comp: true,
};
const readStoredProfileEditTab = () => {
  try {
    const t = sessionStorage.getItem(PROFILE_EDIT_TAB_KEY);
    if (t && PROFILE_EDIT_TAB_IDS.has(t)) return t;
  } catch (_) {}
  return 'look';
};

const PROFILE_STYLES = `
  @keyframes prof-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .prof-fade-in { animation: prof-fade-in 0.4s ease-out both; }
  @keyframes prof-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .prof-scale-in { animation: prof-scale-in 0.35s ease-out both; }
  @keyframes prof-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }
  .prof-skel {
    background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 45%, rgba(255,255,255,0.04) 90%);
    background-size: 200% 100%;
    animation: prof-shimmer 1.15s ease-in-out infinite;
    border-radius: 4px;
  }
  .prof-card { transition: box-shadow 0.3s ease, border-color 0.3s ease; }
  .prof-row { transition: background-color 0.2s ease; }
  .prof-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  @keyframes prof-dossier-enter { from { opacity: 0.88; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .prof-dossier-enter { animation: prof-dossier-enter 0.34s ease-out both; }
  @media (hover: hover) and (pointer: fine) {
    .prof-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
    .prof-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  }
  @media (max-width: 767px) {
    .prof-staff-unlock {
      padding: 8px 10px !important;
      gap: 6px !important;
    }
    .prof-staff-unlock-row {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      gap: 6px;
    }
    .prof-staff-unlock-row input {
      flex: 1;
      min-width: 0;
      max-width: none !important;
      font-size: 16px; /* avoid iOS zoom */
      padding: 8px 10px;
    }
    .prof-staff-unlock-row button {
      flex-shrink: 0;
      align-self: stretch;
      white-space: nowrap;
      padding-left: 10px;
      padding-right: 10px;
    }
    .prof-honour-chip {
      padding: 6px 8px !important;
      font-size: 10px !important;
      line-height: 1.25 !important;
      gap: 4px !important;
    }
    .prof-honour-chip .prof-honour-label {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
  }
  /* Store "Name Glow + Border" cosmetic: colored dossier border + soft glow matching the name color */
  ${PROFILE_GLOW_BORDER_CSS}
  /* Forum BBCode [img]/[gif] use inline max-height 300–400px — tall art shrinks to a narrow strip; override on profile only */
  .prof-banner-content .forum-content-media {
    max-width: 100% !important;
    max-height: min(92vh, 1080px) !important;
    width: auto !important;
    height: auto !important;
    border-radius: 8px;
    margin: 0.35em auto;
    display: block;
  }
  .prof-banner-content .forum-content-ytube { position: relative; width: 100%; max-width: 560px; margin: 0.5em auto; padding-bottom: 56.25%; }
  .prof-banner-content .forum-content-ytube-iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; border-radius: 8px; }
`;

/** Preset notepad backgrounds (dark greys). */
const NOTEPAD_COLOR_PRESETS = [
  { hex: '#333333', label: 'Charcoal' },
  { hex: '#282828', label: 'Graphite' },
];

const casinoTypeShortLabel = (type) => (
  type === 'dice' ? 'Dice'
    : type === 'roulette' ? 'Roulette'
    : type === 'blackjack' ? 'BJ'
    : type === 'horseracing' ? 'Horse'
    : type === 'videopoker' ? 'Video Poker'
    : type === 'slots' ? 'Slots'
    : type || ''
);

const casinoTypeLabel = (type) => (
  type === 'dice' ? 'Dice'
    : type === 'roulette' ? 'Roulette'
    : type === 'blackjack' ? 'Blackjack'
    : type === 'horseracing' ? 'Horse Racing'
    : type === 'videopoker' ? 'Video Poker'
    : type === 'slots' ? 'Slots'
    : type || 'Casino'
);

const casinoTypeEmoji = (type) => (
  type === 'dice' ? '🎲'
    : type === 'roulette' ? '🎡'
    : type === 'blackjack' ? '🃏'
    : type === 'horseracing' ? '🏇'
    : type === 'videopoker' ? '🃏'
    : type === 'slots' ? '🎰'
    : '🎰'
);

const formatCasinoCompactLine = (c) => {
  const maxBet = `$${Number(c?.max_bet || 0).toLocaleString()}`;
  const buyBack = Number(c?.buy_back_reward || 0);
  const buyBackPart = buyBack > 0 ? ` · Buy back ${buyBack.toLocaleString()} pts` : '';
  return `${c?.city || '—'} ${casinoTypeShortLabel(c?.type)} · Max bet ${maxBet}${buyBackPart}`;
};

/** Profile honours match main leaderboard boards; API may send `board` or we fall back by label. */
const HONOUR_BOARD_FALLBACK = {
  'Most Rank Points Earned': 'rank_points',
  'Most Kills': 'kills',
  'Most Crimes Committed': 'crimes',
  'Most GTAs Committed': 'gta',
  'Most Jail Busts': 'jail_busts',
  'Most Points Spent': 'points_spent',
};

function honourLeaderboardTo(h, isDead = false) {
  const board = h?.board || HONOUR_BOARD_FALLBACK[h?.label];
  const rank = Number(h?.rank);
  if (!board || !Number.isFinite(rank) || rank < 1) return '/game/leaderboard';
  const deadParam = isDead ? '&dead=1' : '';
  return `/game/leaderboard?period=alltime&board=${encodeURIComponent(board)}&rank=${encodeURIComponent(rank)}${deadParam}`;
}

const STAFF_ADMIN_HOME = '/tjjeujr3wa/overview';

const StaffProfileActions = ({ username, isDead, isAdmin, isModerator, onDone }) => {
  const [loading, setLoading] = useState(null);
  const handleLock = async () => {
    if (!window.confirm(`Lock ${username} for investigation? They will only see the locked page.`)) return;
    setLoading('lock');
    try {
      await api.post('/admin/lock-player', null, { params: { target_username: username } });
      toast.success('Account locked');
      onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally { setLoading(null); }
  };
  const handleUnlock = async () => {
    if (!window.confirm(`Unlock ${username}?`)) return;
    setLoading('unlock');
    try {
      await api.post('/admin/unlock-account', null, { params: { target_username: username } });
      toast.success('Account unlocked');
      onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally { setLoading(null); }
  };
  const handleKill = async () => {
    if (!window.confirm(`Kill ${username}? They will be dead and cannot log in until revived.`)) return;
    setLoading('kill');
    try {
      await api.post('/admin/kill-player', null, { params: { target_username: username } });
      toast.success('Player killed');
      onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally { setLoading(null); }
  };
  const handleKillWipe = async () => {
    const reason = window.prompt(
      `Modkill (wipe) ${username}? Enter a short Topic of Shame reason (honours, cash, points, Game Pass stripped; Rat; no £10 revive).`
    );
    if (reason == null) return;
    const trimmed = String(reason).trim();
    if (!trimmed) {
      toast.error('Enter a short reason for Topic of Shame');
      return;
    }
    if (
      !window.confirm(
        `Wipe ${username}? This cannot be undone via Dead > Alive (£10).`
      )
    ) {
      return;
    }
    setLoading('kill-wipe');
    try {
      await api.post('/admin/kill-player', null, {
        params: { target_username: username, wipe: true, reason: trimmed },
      });
      toast.success('Player wiped');
      onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(null);
    }
  };
  const handleRevive = async () => {
    if (!window.confirm(`Revive ${username}?`)) return;
    setLoading('revive');
    try {
      await api.post('/admin/revive-player', null, { params: { target_username: username } });
      toast.success('Player revived');
      onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally { setLoading(null); }
  };
  const handleUnmute = async () => {
    if (!window.confirm(`Unmute ${username} from forum?`)) return;
    setLoading('unmute');
    try {
      await api.post('/admin/forum-unmute', null, { params: { target_username: username } });
      toast.success('Unmuted from forum');
      onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally { setLoading(null); }
  };
  const handleForceOnline = async () => {
    if (!window.confirm(`Force ${username} to appear online for 1 hour?`)) return;
    setLoading('force-online');
    try {
      const res = await api.post('/admin/force-online-user', null, { params: { target_username: username, hours: 1 } });
      toast.success(res.data?.message || 'Forced online for 1 hour');
      onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally { setLoading(null); }
  };
  const btn = 'inline-flex items-center justify-center h-7 w-7 md:h-8 md:w-8 rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-all active:scale-95 disabled:opacity-50';
  return (
    <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/5 border-b border-primary/20 flex flex-wrap items-center gap-1 md:gap-1.5">
      <span className="text-[8px] md:text-[9px] font-heading font-bold text-primary/80 uppercase tracking-wider mr-0.5 shrink-0">Staff</span>
      <TooltipProvider>
        <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleLock} disabled={!!loading} className={btn} title="Lock account"><Lock size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Lock account</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleUnlock} disabled={!!loading} className={btn} title="Unlock account"><Unlock size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Unlock account</TooltipContent></Tooltip>
        {isAdmin && (
          <>
            <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleKill} disabled={!!loading || isDead} className={btn} title="Kill (modkill)"><Skull size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Kill player</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleKillWipe} disabled={!!loading} className={btn} title="Modkill (wipe)"><Eraser size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Modkill (wipe)</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleRevive} disabled={!!loading || !isDead} className={btn} title="Revive"><Heart size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Revive player</TooltipContent></Tooltip>
          </>
        )}
        <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleUnmute} disabled={!!loading} className={btn} title="Unmute forum"><Volume2 size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Unmute from forum</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleForceOnline} disabled={!!loading} className={btn} title="Force online 1hr"><Radio size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Force online (1 hour)</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Link to={{ pathname: STAFF_ADMIN_HOME, state: { activityLogUsername: username, gamblingLogUsername: username } }} className={btn} title="Activity log"><FileText size={12} className="md:w-3.5 md:h-3.5" /></Link></TooltipTrigger><TooltipContent>Activity log</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Link to={{ pathname: STAFF_ADMIN_HOME, state: { gamblingLogUsername: username } }} className={btn} title="Gambling log"><Dices size={12} className="md:w-3.5 md:h-3.5" /></Link></TooltipTrigger><TooltipContent>Gambling log</TooltipContent></Tooltip>
      </TooltipProvider>
      <Link to={{ pathname: STAFF_ADMIN_HOME, state: { targetUsername: username } }} className="text-[8px] sm:text-[9px] font-heading text-primary/80 hover:text-primary w-full sm:w-auto sm:ml-auto text-right">
        Admin →
      </Link>
    </div>
  );
};

const WealthRankWithTooltip = ({ wealthRankName, wealthRankRange, wealthRankColor }) => {
  const value = wealthRankName ?? '—';
  const rangeStr = wealthRankRange ?? '—';
  const color = wealthRankColor && /^#[0-9A-Fa-f]{6}$/.test(wealthRankColor.trim()) ? wealthRankColor.trim() : '#64748b';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="cursor-help underline decoration-dotted decoration-primary/50 underline-offset-2 font-bold"
            style={{ color }}
          >
            {value}
          </span>
        </TooltipTrigger>
        <TooltipContent 
          side="bottom" 
          className={`${styles.panel} border-2 border-primary/30 rounded-md px-3 py-2 text-sm font-heading text-foreground shadow-xl`}
        >
          {rangeStr}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const ProfileInfoCard = ({
  profile,
  isMe,
  onAddToSearch,
  onSendMessage,
  onSendMoney,
  onOpenSettings,
  adminOnlineColor,
  bannerText,
  isBannerEditing,
  editText,
  onEditTextChange,
  onSaveBanner,
  savingBanner,
  bannerTextareaRef,
  onInsertBannerMarkup,
  honours = [],
  ownedCasinos = [],
  property: profileProperty = null,
  garageDealership = null,
  sportsBetting = null,
  isPropertyOwner = false,
  showCompactHonoursAndProperties = false,
  topCars = [],
  showCarsOnProfile = true,
  isAdmin = false,
  isModerator = false,
  hasAdminEmail = false,
  staffLoginSession = false,
  staffPortalEnabled = false,
  onStaffActionDone,
  staffDetailsOpen = false,
  setStaffDetailsOpen,
  achievementBadges = [],
  censorProfanity = false,
  onAvatarPreview,
}) => {
  const isAdminProfile = profile.rank_name === 'Admin';
  const isModeratorProfile = profile.rank_name === 'Moderator';
  const isHdoProfile = Boolean(profile.is_help_desk_operator)
    || (typeof profile.rank_name === 'string' && profile.rank_name.startsWith('(HDO)'))
    || profile.rank_name === 'Help Desk Operator';
  const isEntertainerProfile = Boolean(profile.is_entertainer)
    || (typeof profile.rank_name === 'string' && profile.rank_name.startsWith('(Entertainer)'));
  const isStaffProfile = isAdminProfile || isModeratorProfile || isHdoProfile || isEntertainerProfile;
  const [killDebug, setKillDebug] = useState(null);
  const [killDebugOpen, setKillDebugOpen] = useState(false);
  const [killDebugLoading, setKillDebugLoading] = useState(false);
  const [killDebugError, setKillDebugError] = useState(null);
  const [staffPortalClientTick, setStaffPortalClientTick] = useState(0);

  const staffViewerCaps = isAdmin || isModerator || hasAdminEmail;
  const staffShellGateOk = staffViewerCaps && staffLoginSession;
  const portalUnlocked = useMemo(() => {
    void staffPortalClientTick;
    return !staffPortalEnabled || isStaffPortalTokenValid();
  }, [staffPortalEnabled, staffPortalClientTick]);
  const staffCanUseAdminApi = staffShellGateOk && portalUnlocked;

  useEffect(() => {
    const bump = () => setStaffPortalClientTick((n) => n + 1);
    window.addEventListener('staff-portal-session-changed', bump);
    window.addEventListener('staff-portal-expired', bump);
    return () => {
      window.removeEventListener('staff-portal-session-changed', bump);
      window.removeEventListener('staff-portal-expired', bump);
    };
  }, []);

  const fetchKillDebug = async () => {
    if (!staffCanUseAdminApi) {
      toast.error('Use staff login and staff portal password before admin debug tools.');
      return;
    }
    if (killDebugLoading) return;
    setKillDebugLoading(true);
    setKillDebugError(null);
    setKillDebugOpen(true);
    try {
      const res = await api.get(`/admin/kill-debug/${encodeURIComponent(profile.username)}`);
      setKillDebug(res.data);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load kill debug';
      setKillDebugError(msg);
      toast.error(msg);
    } finally {
      setKillDebugLoading(false);
    }
  };
  const adminColor = profile.admin_online_color ?? adminOnlineColor ?? '#a78bfa';
  const modColor = profile.mod_online_color ?? '#1e3a5f';
  const hdoColor = profile.hdo_online_color ?? '#166534';
  const entColor = profile.entertainer_online_color ?? '#7c3aed';
  const roleColor = isAdminProfile
    ? adminColor
    : (isModeratorProfile ? modColor : (isHdoProfile ? hdoColor : (isEntertainerProfile ? entColor : undefined)));
  const isSystemAi = Boolean(profile.system_ai);
  const allRows = isSystemAi ? [
    {
      label: 'Username',
      value: profile.username,
      icon: UserIcon,
      valueClass: 'text-amber-300 font-heading font-bold',
    },
    {
      label: 'Type',
      value: 'Artificial intelligence',
      icon: Ghost,
      valueClass: 'text-amber-200/90 font-heading',
    },
    {
      label: 'Role',
      value: profile.system_ai_role || 'House intelligence',
      icon: Shield,
      valueClass: 'text-amber-200 font-heading font-bold',
    },
    {
      label: 'Status',
      icon: Activity,
      isStatus: true,
      isDead: false,
      status: profile.status || (profile.online ? 'online' : 'offline'),
    },
  ] : [
    { 
      label: 'Username', 
      value: profile.username, 
      icon: UserIcon,
      valueClass: 'text-primary font-heading font-bold' 
    },
    { 
      label: 'Family', 
      value: profile.family_name || '—', 
      icon: UsersIcon,
      valueClass: 'text-foreground font-heading',
      highlight: !!profile.family_name
    },
    { 
      label: 'Rank', 
      value: profile.rank_name, 
      icon: Shield,
      valueClass: 'text-primary font-heading font-bold' 
    },
    { 
      label: 'Wealth', 
      icon: Trophy,
      component: (
        <WealthRankWithTooltip
          wealthRankName={profile.wealth_rank_name}
          wealthRankRange={profile.wealth_rank_range}
          wealthRankColor={profile.wealth_rank_color}
        />
      )
    },
    { 
      label: 'Status', 
      icon: Activity,
      isStatus: true, 
      isDead: profile.is_dead, 
      status: profile.status || (profile.online ? 'online' : 'offline')
    },
    { 
      label: 'Jailbusts', 
      icon: GalleryVerticalEnd,
      value: Number(profile.jail_busts ?? 0).toLocaleString(),
      valueClass: 'text-foreground font-heading font-bold' 
    },
    { 
      label: 'Kills', 
      icon: Skull,
      value: Number(profile.kills ?? 0).toLocaleString(), 
      valueClass: 'text-red-400 font-heading font-bold',
      ...(isAdmin && !isMe ? {
        component: (
          <span className="flex items-center gap-1.5 justify-end min-w-0">
            <span className="text-red-400 font-heading font-bold text-[10px] md:text-sm tabular-nums">{Number(profile.kills ?? 0).toLocaleString()}</span>
            <button type="button" onClick={fetchKillDebug} disabled={killDebugLoading || !staffCanUseAdminApi}
              className="shrink-0 text-[8px] px-1.5 py-0.5 rounded border border-zinc-600/50 bg-zinc-800/50 text-zinc-400 hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-50 touch-manipulation"
              title={staffCanUseAdminApi ? 'Debug kill count' : 'Requires staff login + staff portal unlock'}>
              {killDebugLoading ? '...' : <><span className="sm:hidden">dbg</span><span className="hidden sm:inline">debug</span></>}
            </button>
          </span>
        ),
      } : {}),
    },
  ];

  const isFoundingMember = profile.founding_member || (profile.badges || []).includes('Founding Member');
  const isCustomBadge = profile.custom_profile_badge || (profile.badges || []).includes('Custom Profile Badge');
  const isWarRat = Boolean(profile.show_war_rat_badge) || (profile.badges || []).includes('Rat');
  const isModkilled = Boolean(profile.modkill_wipe) || (profile.badges || []).includes('Modkilled');
  const nameGlowStyle = profile.profile_cosmetic_active && profile.profile_name_glow_color
    ? { color: profile.profile_name_glow_color, textShadow: `0 0 8px ${profile.profile_name_glow_color}88` }
    : undefined;
  const hasCosmeticBorder = profile.profile_cosmetic_active && profile.profile_border_style;
  const isCustomBorder = hasCosmeticBorder && profile.profile_border_style === 'custom';
  const dossierBorderClass = isSystemAi
    ? 'border-2 border-amber-400/45'
    : (hasCosmeticBorder
      ? (isCustomBorder ? 'border-2' : `border-2 prof-border-${profile.profile_border_style}`)
      : 'border-2 border-primary/35');
  const dossierBorderStyle = isSystemAi
    ? { boxShadow: '0 0 28px rgba(251,191,36,0.18)' }
    : (isCustomBorder
      ? customGlowBorderStyle(profile.profile_name_glow_color)
      : undefined);
  
  let profileRows = isStaffProfile
    ? allRows.filter((r) => r.label !== 'Status' && r.label !== 'Jailbusts')
    : allRows;
  // Respect hide_kills_on_profile / hide_jailbusts_on_profile (API sends null when hidden)
  profileRows = profileRows.filter((r) => {
    if (r.label === 'Kills' && (profile.kills === undefined || profile.kills === null)) return false;
    if (r.label === 'Jailbusts' && (profile.jail_busts === undefined || profile.jail_busts === null)) return false;
    return true;
  });

  const isRobotBodyguard = Boolean(profile.is_npc && profile.is_bodyguard);
  const dossierAvatarUrl = isSystemAi
    ? (profile.profile_portrait_url || profile.avatar_url || '/images/system-ai-profile.jpg?v=7')
    : ((typeof profile?.avatar_url === 'string' && profile.avatar_url.trim())
      ? profile.avatar_url.trim()
      : (isRobotBodyguard
        ? robotBodyguardAvatarUrl(profile.id || profile.username)
        : (!profile.is_npc
          ? defaultPlayerAvatarUrl(profile.id || profile.username)
          : null)));
  const profileNotepadBg = profile.profile_notepad_color || null;
  const profileNotepadStyle = profileNotepadBg
    ? { backgroundColor: profileNotepadBg, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)' }
    : undefined;

  return (
    <div className={`relative ${styles.panel} rounded-lg overflow-hidden ${dossierBorderClass} shadow-2xl backdrop-blur-sm prof-card prof-dossier-enter mobile-panel`} style={dossierBorderStyle}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
      <div className="px-2.5 py-2 md:px-3 md:py-2.5 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-b border-primary/25">
        <div className="flex items-start gap-2 md:gap-3 min-w-0">
          <div className={`${isSystemAi ? 'w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24' : 'w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16'} rounded-lg overflow-hidden border-2 ${isSystemAi ? 'border-amber-400/50' : 'border-primary/35'} bg-secondary flex items-center justify-center shrink-0 ring-1 ${isSystemAi ? 'ring-amber-400/40' : 'ring-black/25'} shadow-inner`}>
            {dossierAvatarUrl ? (
              onAvatarPreview ? (
                <button
                  type="button"
                  onClick={() => onAvatarPreview(dossierAvatarUrl)}
                  className="w-full h-full p-0 border-0 bg-transparent cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-lg"
                  aria-label={`View ${profile.username} profile picture`}
                >
                  <img src={dossierAvatarUrl} alt="" className={`w-full h-full object-cover pointer-events-none ${isSystemAi ? 'object-[48%_22%]' : ''}`} />
                </button>
              ) : (
                <img src={dossierAvatarUrl} alt={`${profile.username} avatar`} className={`w-full h-full object-cover ${isSystemAi ? 'object-[48%_22%]' : ''}`} />
              )
            ) : (
              <UserIcon size={26} className="text-mutedForeground" />
            )}
          </div>
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="text-[8px] md:text-[9px] font-heading font-bold text-primary uppercase tracking-[0.16em]">
                {isSystemAi ? 'System file' : 'Dossier'}
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                {profile.show_profile_view_count === true && profile.profile_view_count != null && (
                  <span
                    className="inline-flex items-center gap-0.5 sm:gap-1 h-6 md:h-7 px-1.5 sm:px-2 rounded-md border border-primary/25 bg-black/25 text-primary/90"
                    title={`${Number(profile.profile_view_count).toLocaleString()} profile views`}
                    aria-label={`${Number(profile.profile_view_count).toLocaleString()} profile views`}
                  >
                    <Eye size={11} className="shrink-0 opacity-80" aria-hidden />
                    <span className="text-[9px] md:text-[10px] font-heading font-bold tabular-nums leading-none">
                      {formatProfileViewCount(profile.profile_view_count)}
                    </span>
                    <span className="hidden sm:inline text-[8px] font-heading font-bold uppercase tracking-wider text-primary/70 leading-none">
                      views
                    </span>
                  </span>
                )}
                {isMe && onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="inline-flex items-center justify-center h-7 w-7 md:h-8 md:w-8 rounded-md border border-primary/35 bg-black/30 hover:bg-primary/15 hover:border-primary/50 text-primary transition-all active:scale-95 touch-manipulation"
                    title="Profile settings"
                    aria-label="Profile settings"
                  >
                    <Settings size={12} className="md:w-3.5 md:h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 md:gap-1.5">
              <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                <span className="text-[13px] sm:text-sm md:text-base font-heading font-bold text-foreground leading-tight break-words min-w-0" style={nameGlowStyle}>
                  {profile.username}
                </span>
                {isFoundingMember && (
                  <span
                    className="inline-flex items-center justify-center h-4 w-4 sm:h-[18px] sm:w-auto sm:gap-0.5 sm:px-1.5 rounded-sm border border-amber-500/45 bg-amber-500/15 shrink-0"
                    title="Founder"
                    aria-label="Founder"
                  >
                    <Crown size={10} className="text-amber-300 shrink-0" aria-hidden />
                    <span className="hidden sm:inline text-[8px] font-heading font-bold uppercase tracking-wide text-amber-200 leading-none">
                      Founder
                    </span>
                  </span>
                )}
              </span>
              {profile.profile_country_code ? (
                <span
                  className="inline-flex shrink-0 items-center leading-none"
                  title={`Region ${profile.profile_country_code}`}
                  aria-label={`Country ${profile.profile_country_code}`}
                >
                  <CountryFlagThumb code={profile.profile_country_code} />
                </span>
              ) : null}
              {profile.prestige_level > 0 && (
                <PrestigeBadge level={profile.prestige_level} size="sm" showLabel />
              )}
              <CivilianProtectionBadge
                active={profile.civilian_protection_active}
                endsAt={profile.civilian_protection_ends_at}
              />
              {isCustomBadge && (
                profile.custom_profile_badge_url ? (
                  <img
                    src={profile.custom_profile_badge_url}
                    alt=""
                    title="Custom badge"
                    className="h-7 w-7 md:h-8 md:w-8 rounded-md object-cover border border-violet-500/40 shrink-0 shadow-sm"
                  />
                ) : (
                  <span className="inline-flex items-center h-6 md:h-7 px-2 rounded-md border border-violet-500/40 bg-violet-500/15 text-[9px] md:text-[10px] font-heading font-bold uppercase tracking-wide text-violet-200 shrink-0">
                    Custom
                  </span>
                )
              )}
              {isModkilled && (
                <span
                  className="inline-flex items-center h-6 md:h-7 gap-1 px-2 rounded-md border border-red-500/50 bg-red-500/20 text-[9px] md:text-[10px] font-heading font-bold uppercase tracking-wide text-red-200 shrink-0"
                  title="Staff wipe for rule breaking"
                >
                  <Skull size={12} className="text-red-300 shrink-0" aria-hidden />
                  Modkilled
                </span>
              )}
              {isWarRat && (
                <span
                  className="inline-flex items-center h-6 md:h-7 gap-1 px-2 rounded-md text-[9px] md:text-[10px] font-heading font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/45 shrink-0"
                  title="Left a family during an active family war"
                >
                  Rat
                </span>
              )}
            </div>
            {!isMe && !isSystemAi && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                <button
                  type="button"
                  onClick={onAddToSearch}
                  className="inline-flex items-center gap-1 text-[10px] font-heading font-bold uppercase tracking-wider text-primary/80 hover:text-primary touch-manipulation"
                  title="Add to Attack searches"
                  data-testid="profile-add-to-search"
                >
                  <Search size={11} /> Search
                </button>
                {profile.id && (
                  <button
                    type="button"
                    onClick={() => onSendMessage?.()}
                    className="inline-flex items-center gap-1 text-[10px] font-heading font-bold uppercase tracking-wider text-primary/80 hover:text-primary touch-manipulation"
                    title="Send message"
                  >
                    <MessageCircle size={11} /> Message
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onSendMoney?.()}
                  className="inline-flex items-center gap-1 text-[10px] font-heading font-bold uppercase tracking-wider text-primary/80 hover:text-primary touch-manipulation"
                  title="Send money"
                >
                  <DollarSign size={11} /> Money
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Staff actions: Lock, Unlock, Kill, Revive, Mute, Unmute, Activity log, Gambling log */}
      {!isMe && !isSystemAi && staffViewerCaps && profile?.username && (
        <>
          {!staffShellGateOk ? (
            <div className="px-2.5 py-1.5 md:px-3 bg-amber-950/35 border-b border-amber-600/30 text-[9px] font-heading text-amber-100/95 leading-snug">
              <span className="font-bold uppercase tracking-wider text-amber-300">Staff login required</span>
              {' — '}
              <Link to="/staff-entrance" className="text-primary font-bold underline underline-offset-2 hover:text-primary/90">
                Staff entrance
              </Link>
              <span className="text-amber-100/70 hidden sm:inline"> (same session as Admin)</span>
            </div>
          ) : staffPortalEnabled && !portalUnlocked ? (
            <div className="px-2.5 py-1.5 md:px-3 bg-zinc-950/70 border-b border-primary/20 text-[9px] font-heading text-mutedForeground leading-snug">
              Unlock staff tools with the lock icon next to your name on the stats panel.
            </div>
          ) : (
            <>
          <StaffProfileActions
            username={profile.username}
            isDead={!!profile.is_dead}
            isAdmin={isAdmin}
            isModerator={isModerator}
            onDone={onStaffActionDone}
          />
          <div className="prof-fade-in px-2.5 py-1.5 md:px-3 border-b border-primary/15 bg-primary/[0.03]">
            <button
              type="button"
              onClick={() => setStaffDetailsOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-8 rounded-md border border-primary/30 bg-primary/10 hover:bg-primary/15 transition-colors text-[9px] font-heading font-bold text-primary uppercase tracking-wider touch-manipulation"
            >
              <Activity size={12} />
              Details
            </button>
          </div>
          <StaffUserDetailsPanel
            username={profile.username}
            open={staffDetailsOpen}
            onOpenChange={setStaffDetailsOpen}
            isAdmin={isAdmin}
            isModerator={isModerator}
            onActionDone={() => {
              refetchProfile();
            }}
          />
            </>
          )}
        </>
      )}

      <div className="px-2.5 pt-1.5 pb-2 md:px-3 md:pt-2 md:pb-2.5">
        <div className="rounded-lg border border-border/55 bg-black/25 divide-y divide-zinc-700/40 overflow-hidden">
        {profileRows.map((row) => {
          const Icon = row.icon;
          return (
            <div
              key={row.label}
              className={`prof-row grid grid-cols-12 gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3 md:py-2 ${
                row.highlight ? 'border-l-4 border-l-primary/50 bg-primary/5' : ''
              }`}
            >
              <div className="col-span-5 sm:col-span-4 flex items-center gap-1 md:gap-1.5">
                {Icon && <Icon size={12} className="md:w-3.5 md:h-3.5 text-primary/60 shrink-0" />}
                <span className="text-[9px] md:text-[10px] font-heading font-bold text-mutedForeground uppercase tracking-wider">
                  {row.label}
                </span>
              </div>
              <div className="col-span-7 sm:col-span-8 text-right flex items-center justify-end min-w-0">
                {row.component != null ? (
                  row.component
                ) : row.isStatus ? (
                  <span className="font-heading text-[10px] md:text-xs">
                    {row.isDead && <span className="text-red-500 font-bold">(DEAD)</span>}
                    {!row.isDead && row.status === 'online' && (
                      <span>
                        <span className="text-foreground">Alive </span>
                        <span className="text-emerald-400">(🟢 Online)</span>
                      </span>
                    )}
                    {!row.isDead && row.status === 'idle' && (
                      <span>
                        <span className="text-foreground">Alive </span>
                        <span className="text-amber-400">(🟠 Idle)</span>
                      </span>
                    )}
                    {!row.isDead && row.status === 'offline' && (
                      <span className="text-zinc-500">Alive (Offline)</span>
                    )}
                  </span>
                ) : row.label === 'Family' && profile.family_id && profile.family_name ? (
                  <div className="flex items-center justify-end gap-1.5 md:gap-2 min-w-0 max-w-full">
                    <FamilyEmblem
                      emblemPresetId={profile.family_emblem_preset_id}
                      avatarUrl={profile.family_emblem_avatar_url}
                      size={28}
                    />
                    <Link
                      to={`/families/${encodeURIComponent(profile.family_id)}`}
                      className={`${row.valueClass} hover:underline hover:text-primary transition-colors truncate min-w-0`}
                    >
                      {row.value}
                    </Link>
                  </div>
                ) : row.label === 'Rank'
                  && isEntertainerProfile
                  && typeof profile.rank_name === 'string'
                  && profile.rank_name.startsWith('(Entertainer)') ? (
                  <span className={`${row.valueClass ?? ''} inline-flex flex-wrap items-baseline justify-end gap-x-1`}>
                    <span style={{ color: entColor }} className="shrink-0">(Entertainer)</span>
                    <span className="text-primary">
                      {(profile.rank_name.slice('(Entertainer)'.length).trim() || profile.rank_name)}
                    </span>
                  </span>
                ) : row.label === 'Rank'
                  && isHdoProfile
                  && typeof profile.rank_name === 'string'
                  && profile.rank_name.startsWith('(HDO)') ? (
                  <span className={`${row.valueClass ?? ''} inline-flex flex-wrap items-baseline justify-end gap-x-1`}>
                    <span style={{ color: hdoColor }} className="shrink-0">(HDO)</span>
                    <span className="text-primary">
                      {(profile.rank_name.slice(5).trim() || profile.rank_name)}
                    </span>
                  </span>
                ) : (
                  <span
                    className={row.valueClass}
                    style={row.label === 'Rank' && roleColor ? { color: roleColor } : undefined}
                  >
                    {row.value}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {profile.is_npc && (
        <div className="px-2.5 py-1.5 md:px-3 border-t border-zinc-700/30 bg-zinc-800/30">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] md:text-[10px] uppercase tracking-wider font-heading font-bold bg-zinc-800 text-mutedForeground border border-zinc-700/40">
            {isRobotBodyguard ? (
              <img
                src={robotBodyguardAvatarUrl(profile.id || profile.username)}
                alt=""
                className="w-3.5 h-3.5 rounded-sm object-cover"
              />
            ) : (
              <span aria-hidden>🤖</span>
            )}
            NPC
          </span>
        </div>
      )}

      {/* Compact Honours + Properties (under stats, above notepad) */}
      {showCompactHonoursAndProperties && !isSystemAi && (
        <div className="border-t border-primary/15 bg-zinc-950/25">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 px-2.5 py-2 md:px-3 md:py-2">
            <div>
              <Link
                to="/game/leaderboard"
                className="inline-flex items-center gap-0.5 mb-0.5 rounded-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title="Open leaderboards"
              >
                <Trophy size={9} className="text-primary shrink-0" />
                <span className="text-[8px] font-heading font-bold text-primary uppercase tracking-wider underline-offset-2 hover:underline">Honours</span>
              </Link>
              <div className="grid grid-cols-1 gap-1 min-[420px]:grid-cols-2 min-[420px]:gap-0.5">
                {honours.length === 0 ? (
                  <span className="text-[8px] text-mutedForeground font-heading col-span-full">—</span>
                ) : (
                  honours.map((h, i) => {
                    const top10 = Number(h.rank) <= 10;
                    const rankDisp = Number(h.rank).toLocaleString();
                    return (
                      <Link
                        key={i}
                        to={honourLeaderboardTo(h, !!profile?.is_dead)}
                        title={`${h.label} — #${rankDisp} on leaderboards`}
                        className={`prof-honour-chip flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] sm:text-[8px] font-heading leading-tight min-w-0 w-full transition-colors hover:border-primary/40 hover:bg-primary/10 ${
                          top10 ? 'border-primary/20 bg-primary/5' : 'border-zinc-500/30 bg-zinc-500/5'
                        }`}
                      >
                        <span className={`font-bold shrink-0 ${top10 ? 'text-primary' : 'text-zinc-400'}`}>#{rankDisp}</span>
                        <span className="prof-honour-label text-foreground min-w-0">{h.label}</span>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-0.5 mb-0.5">
                <Building2 size={9} className="text-primary shrink-0" />
                <span className="text-[8px] font-heading font-bold text-primary uppercase tracking-wider">Properties</span>
              </div>
              <div className="text-[8px] font-heading text-mutedForeground leading-tight">
                {!ownedCasinos?.length && !profileProperty && !garageDealership && !sportsBetting && (
                  <span>None</span>
                )}
                {ownedCasinos?.length > 0 && (
                  <span className="block truncate">{ownedCasinos.slice(0, 3).map((c) => formatCasinoCompactLine(c)).join(', ')}{ownedCasinos.length > 3 ? '…' : ''}</span>
                )}
                {profileProperty?.type === 'airport' && <span className="block">Airport — {profileProperty.state ?? '—'}</span>}
                {profileProperty?.type === 'bullet_factory' && <span className="block">Bullet factory — {profileProperty.state ?? '—'}</span>}
                {garageDealership && <span className="block">Car Dealership</span>}
                {sportsBetting && <span className="block">Sports Betting Book</span>}
              </div>
            </div>
          </div>
          {/* Achievement Badges under Honours (always visible on profile — same for you and other players) */}
          <div className="border-t border-primary/15 px-2.5 py-2 md:px-3 md:py-2 bg-black/20">
            <div className="flex items-center gap-0.5 mb-1">
              <Award size={9} className="text-primary shrink-0" />
              <span className="text-[8px] font-heading font-bold text-primary uppercase tracking-wider">Badges</span>
              {achievementBadges.length > 0 && (
                <span className="text-[7px] text-mutedForeground font-heading ml-1">
                  {achievementBadges.reduce((s, c) => s + c.unlocked_count, 0)} unlocked
                </span>
              )}
            </div>
            {achievementBadges.length > 0 ? (
              <>
                <style>{RANKING_BADGE_STYLES}</style>
                <div className="flex flex-wrap gap-1.5 items-end">
                  {achievementBadges.map((cat) => {
                    const t = cat.current_target;
                    const lbl = t >= 1_000_000 ? `${Math.floor(t / 1_000_000)}M` : t >= 1000 ? `${Math.floor(t / 1000)}K` : String(t);
                    return (
                      <div key={cat.id} className="flex flex-col items-center gap-0.5">
                        <BadgeShield
                          label={lbl}
                          unlocked={true}
                          categoryId={cat.id}
                          target={t}
                          size={24}
                        />
                        <span className="text-[7px] text-mutedForeground font-heading uppercase tracking-wider whitespace-nowrap" title={cat.id}>
                          {CATEGORY_LABELS[cat.id] || cat.id.replace(/_/g, ' ')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-[8px] text-mutedForeground font-heading">No ranking badges unlocked yet</p>
            )}
          </div>
          {/* Compact Cars row under Honours/Properties — pinned cars only */}
          {topCars?.length > 0 && (
            <div className="border-t border-primary/15 px-2.5 py-2 md:px-3 md:py-2">
              <div className="flex items-center gap-1 mb-1.5">
                <Car size={12} className="text-primary shrink-0" />
                <span className="text-[10px] md:text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Cars</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {topCars.map((car) => {
                  const label = RARITY_LABELS[car.rarity] || car.rarity || '';
                  const badgeClass = RARITY_BADGE_CLASSES[car.rarity] || RARITY_BADGE_CLASSES.common;
                  return (
                    <Link
                      key={car.id}
                      to={`/cars/view?id=${encodeURIComponent(car.id)}`}
                      onMouseEnter={() => prefetchViewCarPage(car.id)}
                      onFocus={() => prefetchViewCarPage(car.id)}
                      title={`${label}: ${censorProfanity ? filterProfanity(car.name) : car.name}`}
                      className={`flex items-start gap-1 px-2 py-1.5 min-h-8 w-full min-w-0 rounded-md border bg-background/80 hover:bg-primary/10 transition-colors prof-row text-[10px] md:text-[11px] font-heading leading-snug ${badgeClass}`}
                    >
                      <span className="shrink-0 uppercase font-bold tracking-wide">{label}:</span>
                      <span className="min-w-0 text-foreground font-semibold break-words">{censorProfanity ? filterProfanity(car.name) : car.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Profile notepad: same card, joined below stats. Use [img]url[/img] for images. */}
      {(() => {
        const displayText = (bannerText || '').trim() || null;
        const renderedHtml = displayText ? parseForumContent(displayText, { censorProfanity }) : '';
        return (
          <div
            className="border-t border-zinc-700/30"
            style={profileNotepadStyle}
          >
            <div className="relative min-h-[60px] flex flex-col justify-center py-4 px-3 md:px-4">
              <div className="w-full">
                {renderedHtml ? (
                  <div
                    className="prof-banner-content font-heading text-sm md:text-base text-foreground max-w-2xl mx-auto prose prose-invert prose-sm max-w-none prose-p:my-1 prose-img:my-2 prose-div:my-1"
                    dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  />
                ) : (
                  !isMe && (
                    <p className="text-[10px] text-mutedForeground font-heading text-center py-2">No profile text set</p>
                  )
                )}
              </div>
            </div>
            {isMe && isBannerEditing && (
              <div className="p-3 space-y-3 border-t border-primary/20 bg-primary/5">
                <div>
                  <label className="block text-[10px] font-heading font-bold text-primary uppercase tracking-wider mb-1">
                    Profile text (BBCode notepad)
                  </label>
                  <textarea
                    ref={bannerTextareaRef}
                    value={editText ?? ''}
                    onChange={(e) => onEditTextChange?.(e.target.value)}
                    placeholder="Write your profile text... [b]bold[/b], [i]italic[/i], [center]centered[/center], [color=red]colour[/color], [img]url[/img] (direct image or ImgBB short link), [url]link[/url], :) smileys"
                    rows={6}
                    className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-[11px] md:text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y font-mono leading-relaxed"
                  />
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <button type="button" onClick={() => onInsertBannerMarkup?.('[b]', '[/b]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Bold"><Bold size={14} /></button>
                    <button type="button" onClick={() => onInsertBannerMarkup?.('[i]', '[/i]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Italic"><Italic size={14} /></button>
                    <button type="button" onClick={() => onInsertBannerMarkup?.('[center]', '[/center]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Center"><AlignCenter size={14} /></button>
                    <button type="button" onClick={() => onInsertBannerMarkup?.('[color=#eab308]', '[/color]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Colour"><Palette size={14} /></button>
                    <button type="button" onClick={() => { const u = window.prompt('Image URL (direct file, or ImgBB page link https://ibb.co/…):'); if (u && u.trim()) onInsertBannerMarkup?.('[img]' + u.trim() + '[/img]'); }} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Insert image — ImgBB short links are converted on save"><Image size={14} /></button>
                    <button type="button" onClick={() => { const u = window.prompt('YouTube URL or video ID:'); if (u && u.trim()) onInsertBannerMarkup?.('[ytube]' + u.trim() + '[/ytube]'); }} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="YouTube"><Youtube size={14} /></button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSaveBanner}
                  disabled={savingBanner}
                  className="w-full py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingBanner ? 'Saving…' : 'Save banner'}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Account Created — inside same card, below notepad (API sends created_at for every profile) */}
      {profile.created_at != null && (
        <div className="border-t border-zinc-700/30" style={profileNotepadStyle}>
          <div className="px-3 py-2 md:px-4 bg-primary/8 border-b border-primary/20 text-center">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
              {isSystemAi ? 'Commissioned' : 'Account Created'}
            </span>
          </div>
          <div className="px-3 py-2 md:px-4 md:py-2.5 text-foreground font-heading text-[11px] md:text-sm text-center">
            {formatDateTime(profile.created_at)}
          </div>
        </div>
      )}

      {killDebugOpen && (
        <div className="mx-3 mb-2 rounded border border-zinc-700/60 bg-zinc-900/80 overflow-hidden">
          <div className="px-2.5 py-1.5 bg-zinc-800/80 border-b border-zinc-700/40 flex items-center justify-between">
            <span className="text-[9px] font-heading font-bold text-zinc-400 uppercase tracking-wider">Kill Debug {killDebug ? `— ${killDebug.username}` : ''}</span>
            <button type="button" onClick={() => { setKillDebugOpen(false); setKillDebugError(null); }} className="text-zinc-500 hover:text-zinc-300 text-xs">&times;</button>
          </div>
          <div className="p-2 space-y-1.5 text-[9px] font-heading max-h-64 overflow-y-auto">
            {killDebugLoading && (
              <p className="text-zinc-400 animate-pulse">Loading kill debug data...</p>
            )}
            {killDebugError && (
              <p className="text-red-400 font-bold">Error: {killDebugError}</p>
            )}
            {killDebug && !killDebugLoading && (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span className="text-zinc-500">stored total_kills:</span><span className="text-foreground font-bold">{killDebug.stored_total_kills}</span>
                  <span className="text-zinc-500">effective (displayed):</span><span className="text-foreground font-bold">{killDebug.effective_kill_count}</span>
                  <span className="text-zinc-500">excludes_npc_v1 flag:</span><span className={killDebug.total_kills_excludes_npc_v1 ? 'text-emerald-400' : 'text-amber-400'}>{String(killDebug.total_kills_excludes_npc_v1)}</span>
                  <span className="text-zinc-500">hitlist_npc_kills:</span><span className="text-foreground">{killDebug.hitlist_npc_kills}</span>
                  <span className="text-zinc-500">robot_bodyguard_kills:</span><span className="text-foreground">{killDebug.robot_bodyguard_kills}</span>
                  <span className="text-zinc-500">NPC IDs excluded:</span><span className="text-foreground">{killDebug.npc_ids_excluded}</span>
                  <span className="text-zinc-500">counted from attempts:</span><span className="text-primary font-bold">{killDebug.counted_from_attempts}</span>
                </div>
                {killDebug.attempts?.length > 0 && (
                  <div className="mt-1 border-t border-zinc-700/40 pt-1">
                    <p className="text-zinc-500 uppercase tracking-wider mb-1">Matching attempts (newest first):</p>
                    {killDebug.attempts.map((a, i) => (
                      <div key={a.id || i} className="rounded border border-zinc-700/30 bg-zinc-800/30 px-2 py-1 mb-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground font-bold">{a.target_username || a.target_id}</span>
                          <span className="text-zinc-600">{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</span>
                        </div>
                        <div className="flex gap-2 text-zinc-500 mt-0.5 flex-wrap">
                          <span>target_is_npc: <span className={a.target_is_npc ? 'text-amber-400' : 'text-zinc-400'}>{String(a.target_is_npc ?? 'n/a')}</span></span>
                          <span>is_npc_kill: <span className={a.is_npc_kill ? 'text-amber-400' : 'text-zinc-400'}>{String(a.is_npc_kill ?? 'n/a')}</span></span>
                          <span>bodyguard: <span className={a.is_bodyguard_kill ? 'text-sky-400' : 'text-zinc-400'}>{String(a.is_bodyguard_kill ?? 'n/a')}</span></span>
                        </div>
                      </div>
                    ))}
                    {killDebug.counted_from_attempts > killDebug.attempts.length && (
                      <p className="text-zinc-600 italic">...and {killDebug.counted_from_attempts - killDebug.attempts.length} more</p>
                    )}
                  </div>
                )}
                {killDebug.attempts?.length === 0 && (
                  <p className="text-zinc-600 italic mt-1">No matching attack_attempts found.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

const HonoursCard = ({ honours, isDead = false }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <Link
        to="/game/leaderboard"
        title="View leaderboards"
        className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center justify-center gap-1 hover:underline underline-offset-2"
      >
        <Trophy size={12} className="md:w-3.5 md:h-3.5" />
        Honours ({honours.length})
      </Link>
    </div>
    <div className="p-2.5">
      {honours.length === 0 ? (
        <div className="text-center py-4">
          <Trophy size={32} className="md:w-10 md:h-10 mx-auto text-primary/30 mb-1.5" />
          <p className="text-[10px] md:text-xs text-mutedForeground font-heading">
            No leaderboard rankings yet
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {honours.map((h, i) => {
            const top10 = Number(h.rank) <= 10;
            const rankDisp = Number(h.rank).toLocaleString();
            return (
              <Link
                key={i}
                to={honourLeaderboardTo(h, isDead)}
                title={`${h.label} — #${rankDisp} on leaderboards`}
                className={`prof-row flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors hover:border-primary/40 hover:bg-primary/10 ${
                  top10 ? 'border-primary/20 bg-primary/5' : 'border-zinc-500/20 bg-zinc-500/5'
                }`}
              >
                <div className={`flex items-center justify-center w-6 h-6 md:w-7 md:h-7 rounded-full border shrink-0 ${
                  top10 ? 'bg-primary/20 border-primary/30' : 'bg-zinc-500/20 border-zinc-500/30'
                }`}>
                  <span className={`font-heading font-bold text-[10px] md:text-xs ${
                    top10 ? 'text-primary' : 'text-zinc-400'
                  }`}>
                    #{rankDisp}
                  </span>
                </div>
                <span className="text-foreground font-heading text-[10px] md:text-xs flex-1 leading-tight">
                  {h.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
    <div className="prof-art-line text-primary mx-3" />
  </div>
);

const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  ultra_rare: 'Ultra rare',
  legendary: 'Legendary',
  custom: 'Custom',
  loot_exclusive: 'Loot',
  exclusive: 'Exclusive',
  vip_exclusive: 'VIP',
};

/** Rarity colours for profile car badges (match ViewCar / GTA). */
const RARITY_BADGE_CLASSES = {
  common: 'border-gray-400/70 text-gray-400',
  uncommon: 'border-green-400/70 text-green-400',
  rare: 'border-blue-400/70 text-blue-400',
  ultra_rare: 'border-purple-400/70 text-purple-400',
  legendary: 'border-amber-400/70 text-amber-400',
  custom: 'border-primary/70 text-primary',
  loot_exclusive: 'border-rose-400/70 text-rose-400 bg-rose-950/30',
  exclusive: 'border-rose-400/70 text-rose-400',
  vip_exclusive: 'border-cyan-400/80 text-cyan-300 bg-cyan-950/35',
};

/** Extract YouTube video ID from watch URL, youtu.be, or embed URL. */
function getYoutubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const m1 = s.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m1 ? m1[1] : null;
}

const YouTubeCard = ({ youtubeUrl, autoplay = true }) => {
  const videoId = getYoutubeVideoId(youtubeUrl);
  if (!videoId) return null;
  const embedSrc = `https://www.youtube.com/embed/${videoId}${autoplay ? '?autoplay=1&mute=1' : ''}`;
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-center gap-1">
        <Youtube size={12} className="md:w-3.5 md:h-3.5 text-primary" />
        <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          Video
        </h3>
      </div>
      <div className="p-2.5 aspect-video w-full max-w-lg mx-auto">
        <iframe
          title="Profile video"
          src={embedSrc}
          className="w-full h-full rounded-md border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

const SpotifyCard = ({ spotifyEmbedUrl, spotifyUrl }) => {
  if (!spotifyEmbedUrl && !spotifyUrl) return null;
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-center gap-1">
        <Music2 size={12} className="md:w-3.5 md:h-3.5 text-primary" />
        <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          Spotify
        </h3>
      </div>
      <div className="p-2.5">
        {spotifyEmbedUrl ? (
          <iframe
            title="Spotify embed"
            src={spotifyEmbedUrl}
            className="w-full h-[152px] rounded-md border-0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
        ) : (
          <p className="text-xs text-mutedForeground text-center">Spotify embed unavailable for this item.</p>
        )}
        {spotifyUrl ? (
          <div className="mt-2 text-center">
            <a
              href={spotifyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] md:text-xs font-heading text-primary hover:underline"
            >
              Open on Spotify
              <ExternalLink size={12} />
            </a>
          </div>
        ) : null}
      </div>
      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

const TopCarsCard = ({ topCars, showCars }) => {
  if (!topCars?.length) return null;
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`} style={{ animationDelay: '0.06s' }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-center gap-1">
        <Car size={12} className="text-primary" />
        <h3 className="text-[10px] md:text-[11px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          Cars
        </h3>
      </div>
      <div className="p-2 flex flex-wrap gap-1.5">
        {topCars.map((car) => {
          const label = RARITY_LABELS[car.rarity] || car.rarity;
          const badgeClass = RARITY_BADGE_CLASSES[car.rarity] || RARITY_BADGE_CLASSES.common;
          return (
            <Link
              key={car.id}
              to={`/cars/view?id=${encodeURIComponent(car.id)}`}
              onMouseEnter={() => prefetchViewCarPage(car.id)}
              onFocus={() => prefetchViewCarPage(car.id)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 min-h-8 rounded-md border bg-background/80 hover:bg-primary/10 transition-colors prof-row text-[11px] md:text-xs ${badgeClass}`}
            >
              <span className="font-heading uppercase tracking-wide shrink-0 font-bold">{label}:</span>
              <span className="font-heading font-semibold text-foreground whitespace-normal break-words">{car.name}</span>
            </Link>
          );
        })}
      </div>
      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

const PropertiesCard = ({ ownedCasinos, property, garageDealership, sportsBetting, isOwner }) => {
  const hasCasinos = ownedCasinos?.length > 0;
  const hasProperty = property && (property.type === 'airport' || property.type === 'bullet_factory');
  const isEmpty = !hasCasinos && !hasProperty && !garageDealership && !sportsBetting;

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center justify-center gap-1">
          <Building2 size={12} className="md:w-3.5 md:h-3.5" />
          Properties
        </h3>
      </div>
      <div className="p-2.5">
        {isEmpty ? (
          <div className="text-center py-4">
            <Building2 size={32} className="md:w-10 md:h-10 mx-auto text-primary/30 mb-1.5" />
            <p className="text-[10px] md:text-xs text-mutedForeground font-heading">
              No casinos or properties owned
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {hasCasinos && (
              <div className="space-y-2">
                {ownedCasinos.map((c, i) => {
                  const typeLabel = casinoTypeLabel(c.type);
                  const typeEmoji = casinoTypeEmoji(c.type);
                  return (
                    <div key={`${c.type}-${c.city}-${i}`} className="prof-row rounded-md border border-primary/20 px-2.5 py-1.5 bg-zinc-800/30 flex items-start gap-2">
                      <span className="text-lg md:text-xl shrink-0 mt-0.5" aria-hidden>{typeEmoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-heading font-bold text-foreground text-[11px] md:text-sm leading-tight">
                          {c.city} {typeLabel}
                        </div>
                        <div className="space-y-0.5 text-[10px] md:text-xs font-heading mt-0.5">
                          <div className="flex justify-between gap-2">
                            <span className="text-mutedForeground shrink-0">Max bet:</span>
                            <span className="text-primary font-bold">${Number(c.max_bet || 0).toLocaleString()}</span>
                          </div>
                          {c.buy_back_reward != null && c.buy_back_reward > 0 && (
                            <div className="flex justify-between gap-2">
                              <span className="text-mutedForeground shrink-0">Buyback:</span>
                              <span className="text-primary font-bold">{Number(c.buy_back_reward).toLocaleString()} pts</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {property?.type === 'airport' && (
              <div className="prof-row rounded-md border border-primary/20 px-2.5 py-1.5 bg-zinc-800/30 flex items-start gap-2">
                <Plane size={16} className="md:w-5 md:h-5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="font-heading font-bold text-foreground text-[11px] md:text-sm leading-tight">
                    ✈️ Airport — {property.state ?? '—'} (Slot {property.slot ?? 1})
                  </div>
                  <div className="space-y-0.5 text-[10px] md:text-xs font-heading mt-0.5">
                    <div className="flex justify-between gap-2">
                      <span className="text-mutedForeground shrink-0">Price per travel:</span>
                      <span className="text-primary font-bold">{Number(property.price_per_travel ?? 0).toLocaleString()} pts</span>
                    </div>
                    {isOwner && (
                      <div className="flex justify-between gap-2">
                        <span className="text-mutedForeground shrink-0">Total earnings:</span>
                        <span className="text-primary font-bold">{Number(property.total_earnings ?? 0).toLocaleString()} pts</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {property?.type === 'bullet_factory' && (
              <div className="prof-row rounded-md border border-primary/20 px-2.5 py-1.5 bg-zinc-800/30 flex items-start gap-2">
                <Factory size={16} className="md:w-5 md:h-5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="font-heading font-bold text-foreground text-[11px] md:text-sm leading-tight">
                    Bullet factory — {property.state ?? '—'}
                  </div>
                  {property.price_per_bullet != null && (
                    <div className="text-[10px] md:text-xs font-heading mt-0.5">
                      <span className="text-mutedForeground">Price per bullet: </span>
                      <span className="text-primary font-bold">${Number(property.price_per_bullet).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {garageDealership && (
              <div className="prof-row rounded-md border border-primary/20 px-2.5 py-1.5 bg-zinc-800/30 flex items-start gap-2">
                <Car size={16} className="md:w-5 md:h-5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="font-heading font-bold text-foreground text-[11px] md:text-sm leading-tight">
                    Car Dealership
                  </div>
                  {isOwner && garageDealership.owner_pending_profit != null && (
                    <div className="text-[10px] md:text-xs font-heading mt-0.5">
                      <span className="text-mutedForeground">Pending profit: </span>
                      <span className="text-primary font-bold">${Number(garageDealership.owner_pending_profit || 0).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {sportsBetting && (
              <div className="prof-row rounded-md border border-primary/20 px-2.5 py-1.5 bg-zinc-800/30 flex items-start gap-2">
                <Trophy size={16} className="md:w-5 md:h-5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="font-heading font-bold text-foreground text-[11px] md:text-sm leading-tight">
                    Sports Betting Book
                  </div>
                  {isOwner && sportsBetting.owner_pending_profit != null && (
                    <div className="text-[10px] md:text-xs font-heading mt-0.5">
                      <span className="text-mutedForeground">Pending profit: </span>
                      <span className="text-primary font-bold">${Number(sportsBetting.owner_pending_profit || 0).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

const AdminStatsCard = ({ adminStats }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border-2 border-primary/30 prof-card prof-fade-in mobile-panel`} style={{ animationDelay: '0.1s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
        🔐 Admin Info
      </h3>
    </div>
    <div className="p-2.5 grid grid-cols-2 md:grid-cols-3 gap-2">
      {[
        { label: 'Cash', value: `$${Number(adminStats.money ?? 0).toLocaleString()}` },
        { label: 'Points', value: Number(adminStats.points ?? 0).toLocaleString() },
        { label: 'Respect', value: Number(adminStats.respect_points ?? 0).toLocaleString() },
        { label: 'Bullets', value: Number(adminStats.bullets ?? 0).toLocaleString() },
        { label: 'Booze Today', value: `$${Number(adminStats.booze_profit_today ?? 0).toLocaleString()}` },
        { label: 'Booze Total', value: `$${Number(adminStats.booze_profit_total ?? 0).toLocaleString()}` },
        { label: 'Rank Points', value: Number(adminStats.rank_points ?? 0).toLocaleString() },
        { label: 'Location', value: adminStats.current_state ?? '—', isLocation: true },
        { label: 'In Jail', value: adminStats.in_jail ? 'Yes' : 'No', isJail: true, jailed: adminStats.in_jail },
      ].map((stat) => (
        <div key={stat.label} className="space-y-0.5">
          <div className="text-[9px] md:text-[10px] text-mutedForeground font-heading uppercase tracking-wider">
            {stat.label}
          </div>
          <div className={`text-[10px] md:text-xs font-heading font-bold leading-tight ${
            stat.isJail && stat.jailed 
              ? 'text-red-400' 
              : stat.isLocation 
              ? 'text-foreground' 
              : 'text-primary'
          }`}>
            {stat.value}
          </div>
        </div>
      ))}
    </div>
    <div className="prof-art-line text-primary mx-3" />
  </div>
);

function bootProfileForRoute(usernameParam) {
  if (usernameParam) return getProfilePrefetch(usernameParam);
  const hint = getProfileSessionLastMeUsername();
  return hint ? getProfilePrefetch(hint) : null;
}

// Main component
export default function Profile() {
  const { username: usernameParam } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewPublic = searchParams.get('view') === 'public';
  const [me, setMe] = useState(null);
  const [editTab, setEditTab] = useState(readStoredProfileEditTab);
  const switchEditTab = (id) => {
    if (!PROFILE_EDIT_TAB_IDS.has(id)) return;
    setEditTab(id);
    try { sessionStorage.setItem(PROFILE_EDIT_TAB_KEY, id); } catch (_) {}
  };
  const [profile, setProfile] = useState(() => bootProfileForRoute(usernameParam));
  const [loading, setLoading] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [hasAdminEmail, setHasAdminEmail] = useState(false);
  const [systemAiOnline, setSystemAiOnline] = useState(true);
  const [staffLoginSession, setStaffLoginSession] = useState(false);
  const [staffPortalEnabled, setStaffPortalEnabled] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [toastMutedPages, setToastMutedPagesState] = useState(() => getToastMutedPages());
  const [savingToastMutes, setSavingToastMutes] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [changingPassword, setChangingPassword] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [spotifyUrlInput, setSpotifyUrlInput] = useState('');
  const [spotifyStatus, setSpotifyStatus] = useState(null);
  const [savingSpotifyEmbed, setSavingSpotifyEmbed] = useState(false);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [spotifySdkReady, setSpotifySdkReady] = useState(false);
  const [spotifyDeviceId, setSpotifyDeviceId] = useState('');
  const [spotifyPlayerState, setSpotifyPlayerState] = useState(null);
  const [spotifyVolume, setSpotifyVolume] = useState(65);
  const [profileAutoplayVideo, setProfileAutoplayVideo] = useState(true);
  const [hideKillsOnProfile, setHideKillsOnProfile] = useState(false);
  const [hideJailbustsOnProfile, setHideJailbustsOnProfile] = useState(false);
  const [hideLeaderboardUsername, setHideLeaderboardUsername] = useState(false);
  const [showCountryFlagOnProfile, setShowCountryFlagOnProfile] = useState(false);
  const [showProfileViewCount, setShowProfileViewCount] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [savingAutoplay, setSavingAutoplay] = useState(false);
  const [censorProfanity, setCensorProfanity] = useState(false);
  const [savingProfanity, setSavingProfanity] = useState(false);
  const [modOnlineColor, setModOnlineColor] = useState('#1e3a5f');
  const [savingModColor, setSavingModColor] = useState(false);
  const [hdoOnlineColor, setHdoOnlineColor] = useState('#166534');
  const [savingHdoColor, setSavingHdoColor] = useState(false);
  const [bannerTextEdit, setBannerTextEdit] = useState('');
  const [notepadColorEdit, setNotepadColorEdit] = useState('');
  const [savingBanner, setSavingBanner] = useState(false);
  const bannerTextareaRef = React.useRef(null);
  const [staffDetailsOpen, setStaffDetailsOpen] = useState(false);
  const username = useMemo(() => usernameParam || me?.username, [usernameParam, me?.username]);
  const isMe = !!(me && profile && me.username === profile.username);
  /** When true, we're viewing our own profile as a visitor would (no settings, no avatar edit, etc.). */
  const isPublicView = isMe && viewPublic;
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [savingCustomBadge, setSavingCustomBadge] = useState(false);
  const [savingGlow, setSavingGlow] = useState(false);
  const [avatarLightbox, setAvatarLightbox] = useState(null);
  const [messagePopupOpen, setMessagePopupOpen] = useState(false);
  const spotifyPlayerRef = React.useRef(null);
  const profileRequestIdRef = useRef(0);

  const refetchMe = async () => {
    try {
      const meRes = await api.get('/auth/me');
      setMe(meRes.data);
      if (meRes.data?.username) setProfileSessionLastMeUsername(meRes.data.username);
    } catch (_) {}
  };

  const refetchProfile = async ({ silent = true, forceLoading = false, usernameOverride } = {}) => {
    const targetUsername = String(usernameOverride || username || '').trim();
    if (!targetUsername) return null;
    const targetKey = targetUsername.toLowerCase();
    const reqId = ++profileRequestIdRef.current;
    if (forceLoading) setLoading(true);
    setProfileLoadError('');
    const cachedHonours = getProfilePrefetch(targetUsername)?.honours;
    const honoursPromise = api
      .get(`/users/${encodeURIComponent(targetUsername)}/profile/honours`)
      .then((res) => ({ loaded: true, honours: res.data?.honours ?? [] }))
      .catch(() => ({ loaded: false, honours: cachedHonours ?? [] }));
    let mainPaintDone = false;
    try {
      const profileRes = await apiGetWithResumeRetries(
        `/users/${encodeURIComponent(targetUsername)}/profile`,
        { params: { include_honours: false, count_view: true } },
      );
      if (reqId !== profileRequestIdRef.current) return null;
      const base = {
        ...profileRes.data,
        honours: profileRes.data?.honours ?? cachedHonours ?? [],
        _honoursLoaded: false,
      };
      setProfile(base);
      setProfilePrefetch(targetUsername, base);
      mainPaintDone = true;
      if (reqId === profileRequestIdRef.current) {
        if (forceLoading) setLoading(false);
      }

      (async () => {
        const honoursResult = await honoursPromise;
        if (reqId !== profileRequestIdRef.current) return;
        const merged = {
          ...base,
          honours: honoursResult.honours,
          _honoursLoaded: honoursResult.loaded,
        };
        setProfile((prev) => {
          if (!prev) return merged;
          if (String(prev.username || '').trim().toLowerCase() !== targetKey) return prev;
          return merged;
        });
        setProfilePrefetch(targetUsername, merged);
      })();

      return base;
    } catch (e) {
      if (reqId === profileRequestIdRef.current && !silent) {
        const st = e.response?.status;
        if (st === 404) {
          setProfileLoadError("This user doesn't exist or has been deleted");
        } else if (st === 0 || isTransientResumeLoadError(e)) {
          setProfileLoadError('Still loading — the server is busy. Wait a moment or refresh the page.');
        } else {
          setProfileLoadError(e.response?.data?.detail || 'Failed to load profile');
        }
      }
      if (!silent) throw e;
      return null;
    } finally {
      if (!mainPaintDone && reqId === profileRequestIdRef.current) {
        if (forceLoading) setLoading(false);
      }
    }
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    const valid = validateSafeImageFile(file);
    if (!valid.ok) {
      toast.error(valid.reason);
      return;
    }
    setSavingAvatar(true);
    try {
      const mime = String(file.type || '').toLowerCase();
      if (mime === 'image/gif') {
        if (file.size > AVATAR_RAW_UPLOAD_MAX_BYTES) {
          toast.error(
            `That GIF file is too large for upload (max about ${Math.floor(AVATAR_RAW_UPLOAD_MAX_BYTES / 1024)}KB). Try a shorter GIF or ask the host to raise nginx limits.`,
          );
          return;
        }
        const formData = new FormData();
        formData.append('file', file, file.name || 'avatar.gif');
        await api.post('/profile/avatar/file', formData);
      } else {
        const result = await fileToAvatarDataUrl(file);
        if (!result.ok) {
          toast.error('Please choose a valid image file.');
          return;
        }
        await api.post('/profile/avatar', { avatar_data: result.dataUrl });
      }
      toast.success('Avatar updated');
      await refetchMe();
      await refetchProfile();
    } catch (e) {
      const st = e.response?.status;
      if (st === 413) {
        toast.error(
          'Upload was blocked as too large (HTTP 413). Try a smaller image, or ask the host to raise nginx client_max_body_size for /api.',
        );
      } else {
        toast.error(getApiErrorMessage(e) || 'Failed to update avatar');
      }
    } finally {
      setSavingAvatar(false);
    }
  };

  const uploadCustomBadge = async (file) => {
    if (!file) return;
    const valid = validateSafeImageFile(file);
    if (!valid.ok) {
      toast.error(valid.reason);
      return;
    }
    setSavingCustomBadge(true);
    try {
      const result = await fileToCustomBadgeDataUrl(file);
      if (!result.ok) {
        if (result.reason === 'gif_too_large' || result.reason === 'too_large') {
          toast.error('Badge image too large. Use a small square icon (under ~250KB).');
        } else {
          toast.error('Please choose a valid image file.');
        }
        return;
      }
      await api.post('/profile/custom-badge', { badge_data: result.dataUrl });
      toast.success('Custom badge updated');
      await refetchMe();
      await refetchProfile();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to update custom badge');
    } finally {
      setSavingCustomBadge(false);
    }
  };

  const removeCustomBadge = async () => {
    setSavingCustomBadge(true);
    try {
      await api.post('/profile/custom-badge', { badge_data: '' });
      toast.success('Custom badge image removed');
      await refetchMe();
      await refetchProfile();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to remove custom badge');
    } finally {
      setSavingCustomBadge(false);
    }
  };

  const currentGlowHex = (me?.profile_name_glow_color || '').toLowerCase();
  const currentGlowPresetId = useMemo(() => {
    if (!currentGlowHex) return 'violet';
    const match = PROFILE_GLOW_PRESETS.find((p) => p.hex.toLowerCase() === currentGlowHex);
    if (match) return match.id;
    return currentGlowHex.startsWith('#') ? currentGlowHex : `#${currentGlowHex}`;
  }, [currentGlowHex]);

  const saveGlowColour = async (presetId) => {
    if (!me?.profile_cosmetic_permanent || savingGlow) return;
    setSavingGlow(true);
    try {
      await api.patch('/profile/glow', { preset_id: presetId });
      toast.success('Glow colour updated');
      await refetchMe();
      await refetchProfile();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to update glow colour');
    } finally {
      setSavingGlow(false);
    }
  };

  const removeAvatar = async () => {
    setSavingAvatar(true);
    try {
      await api.post('/profile/avatar', { avatar_data: '' });
      toast.success('Avatar removed');
      await refetchMe();
      await refetchProfile();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to remove avatar');
    } finally {
      setSavingAvatar(false);
    }
  };

  useEffect(() => {
    if (!avatarLightbox) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setAvatarLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [avatarLightbox]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const [meRes, adminRes] = await Promise.all([
          apiGetWithResumeRetries('/auth/me'),
          apiGetWithResumeRetries('/auth/staff-flags').catch(() => ({ data: {} })),
        ]);
        if (cancelled) return;
        setMe(meRes.data);
        if (meRes.data?.username) {
          setProfileSessionLastMeUsername(meRes.data.username);
          // Own edit route: hydrate from prefetch as soon as we know the username.
          if (!usernameParam) {
            const cached = getProfilePrefetch(meRes.data.username);
            if (cached) setProfile((prev) => prev || cached);
          }
        }
        try {
          const muted = normalizeToastMutedPages(meRes.data?.toast_muted_pages);
          setToastMutedPagesState(muted);
          setToastMutedPages(muted);
        } catch (_) { /* ignore */ }
        setIsAdmin(!!adminRes.data?.is_admin);
        setIsModerator(!!adminRes.data?.is_moderator);
        setHasAdminEmail(!!adminRes.data?.has_admin_email);
        if (typeof adminRes.data?.system_ai_online === 'boolean') {
          setSystemAiOnline(!!adminRes.data.system_ai_online);
        }
        setStaffLoginSession(!!adminRes.data?.staff_login_session);
        setStaffPortalEnabled(!!adminRes.data?.staff_portal_enabled);
      } catch (e) {
        if (!cancelled && !shouldSuppressResumeNetworkToast(e)) {
          toast.error(getApiErrorMessage(e) || 'Failed to load your account');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();

    const onResume = () => {
      // Soft re-check after AFK without remounting / blanking the dossier.
      apiGetWithResumeRetries('/auth/me')
        .then((meRes) => {
          if (cancelled) return;
          setMe(meRes.data);
          if (meRes.data?.username) setProfileSessionLastMeUsername(meRes.data.username);
        })
        .catch(() => {});
    };
    const onRefreshUser = (e) => {
      if (e?.detail?.resume) onResume();
    };
    window.addEventListener('app:page-resume', onResume);
    window.addEventListener('app:refresh-user', onRefreshUser);

    return () => {
      cancelled = true;
      window.removeEventListener('app:page-resume', onResume);
      window.removeEventListener('app:refresh-user', onRefreshUser);
    };
  }, [usernameParam]);

  useEffect(() => {
    try {
      const msg = window.sessionStorage.getItem('spotify_connect_message');
      if (msg) {
        toast.success(msg);
        window.sessionStorage.removeItem('spotify_connect_message');
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (me?.mod_online_color != null && (me.mod_online_color || '').trim())
      setModOnlineColor((me.mod_online_color || '').trim());
    else if (me && !me.mod_online_color) setModOnlineColor('#1e3a5f');
  }, [me]);

  useEffect(() => {
    if (me?.hdo_online_color != null && (me.hdo_online_color || '').trim())
      setHdoOnlineColor((me.hdo_online_color || '').trim());
    else if (me && !me.hdo_online_color) setHdoOnlineColor('#166534');
  }, [me]);

  useEffect(() => {
    if (!username) return;
    setProfileLoadError('');
    const cached = getProfilePrefetch(username);
    if (cached) {
      setProfile(cached);
      setLoading(false);
      refetchProfile({ silent: true, usernameOverride: username });
      return;
    }
    // No cache: clear stale other-user dossier and show loading skeleton for this username.
    setProfile((prev) => {
      if (prev && String(prev.username || '').trim().toLowerCase() === String(username).trim().toLowerCase()) {
        return prev;
      }
      return null;
    });
    refetchProfile({ silent: false, usernameOverride: username }).catch((e) => {
      const st = e.response?.status;
      if (st === 404) {
        toast.error(e.response?.data?.detail || 'Profile not found');
      } else if (st !== 0 && !isTransientResumeLoadError(e)) {
        toast.error(getApiErrorMessage(e) || 'Failed to load profile');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch by username only; profile is the result, not a trigger
  }, [username]);

  useEffect(() => {
    if (profile) {
      setBannerTextEdit(profile.profile_banner_text ?? '');
      setNotepadColorEdit(profile.profile_notepad_color ?? '');
    }
  }, [profile]);

  // When opening profile with ?details=1 as staff viewing another user, auto-open the staff dossier
  useEffect(() => {
    if (profile && (isAdmin || isModerator) && !isMe && searchParams.get('details') === '1') {
      setStaffDetailsOpen(true);
    }
  }, [profile, isAdmin, isModerator, isMe, searchParams]);

  const fetchPrefs = async () => {
    try {
      const res = await api.get('/profile/preferences');
      setPrefs({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...(res.data?.notification_preferences || {}) });
    } catch (_) {
      setPrefs(DEFAULT_NOTIFICATION_PREFERENCES);
    }
  };
  const fetchToastPagePrefs = async () => {
    try {
      const res = await api.get('/profile/toast-page-prefs');
      const muted = normalizeToastMutedPages(res.data?.muted_pages);
      setToastMutedPagesState(muted);
      setToastMutedPages(muted);
    } catch (_) {
      /* keep current */
    }
  };
  const fetchTelegram = async () => {
    try {
      const res = await api.get('/profile/telegram');
      setTelegramChatId(res.data?.telegram_chat_id ?? '');
      setTelegramBotToken(res.data?.telegram_bot_token ?? '');
    } catch (_) {
      setTelegramChatId('');
      setTelegramBotToken('');
    }
  };
  const fetchSpotifyStatus = async () => {
    try {
      const res = await api.get('/profile/spotify/status');
      setSpotifyStatus(res.data || null);
      setSpotifyUrlInput(res.data?.spotify_url || '');
    } catch (_) {
      setSpotifyStatus(null);
    }
  };
  useEffect(() => {
    if (isMe && !viewPublic && profile) {
      const warm = getProfileEditWarm(me?.id);
      if (warm) {
        if (warm.notification_preferences && typeof warm.notification_preferences === 'object') {
          setPrefs({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...warm.notification_preferences });
        }
        setTelegramChatId(warm.telegram_chat_id ?? '');
        setTelegramBotToken(warm.telegram_bot_token ?? '');
        setSpotifyStatus(warm.spotifyStatus ?? null);
        setSpotifyUrlInput(warm.spotify_url || '');
        setCensorProfanity(warm.censor_profanity === true);
        setProfileAutoplayVideo(warm.profile_autoplay_video !== false);
        setHideKillsOnProfile(warm.hide_kills_on_profile === true);
        setHideJailbustsOnProfile(warm.hide_jailbusts_on_profile === true);
        setHideLeaderboardUsername(warm.hide_leaderboard_username === true);
        setShowCountryFlagOnProfile(warm.show_country_flag_on_profile === true);
        setShowProfileViewCount(warm.show_profile_view_count === true);
      } else {
        setProfileAutoplayVideo(me?.profile_autoplay_video !== false);
        setHideKillsOnProfile(profile?.hide_kills_on_profile === true);
        setHideJailbustsOnProfile(profile?.hide_jailbusts_on_profile === true);
        setHideLeaderboardUsername(profile?.hide_leaderboard_username === true);
        setShowCountryFlagOnProfile(profile?.show_country_flag_on_profile === true);
        setShowProfileViewCount(profile?.show_profile_view_count === true);
      }
      fetchPrefs();
      fetchToastPagePrefs();
      const tTelegram = setTimeout(fetchTelegram, 400);
      const tSpotify = setTimeout(fetchSpotifyStatus, 800);
      const tCensor = setTimeout(() => {
        api.get('/profile/censor-profanity').then((res) => {
          setCensorProfanity(res.data?.censor_profanity === true);
        }).catch(() => {});
      }, 1200);
      return () => {
        clearTimeout(tTelegram);
        clearTimeout(tSpotify);
        clearTimeout(tCensor);
      };
    }
  }, [isMe, viewPublic, profile, profile?.hide_kills_on_profile, profile?.hide_jailbusts_on_profile, profile?.hide_leaderboard_username, profile?.show_country_flag_on_profile, profile?.show_profile_view_count, me?.profile_autoplay_video, me?.id]);

  useEffect(() => {
    if (!isMe || viewPublic || !spotifyStatus?.spotify_connected || !spotifyStatus?.feature_enabled) {
      if (spotifyPlayerRef.current) {
        try { spotifyPlayerRef.current.disconnect(); } catch (_) {}
      }
      spotifyPlayerRef.current = null;
      setSpotifySdkReady(false);
      setSpotifyDeviceId('');
      return;
    }

    let cancelled = false;
    const initPlayer = async () => {
      try {
        const init = async () => {
          if (cancelled || !window.Spotify) return;
          const player = new window.Spotify.Player({
            name: 'Mafia Wars Web Player',
            getOAuthToken: async (cb) => {
              try {
                const tok = await api.get('/profile/spotify/sdk-token');
                cb(tok.data?.access_token || '');
              } catch (_) {
                cb('');
              }
            },
            volume: 0.65,
          });
          player.addListener('ready', ({ device_id }) => {
            if (cancelled) return;
            setSpotifyDeviceId(device_id || '');
            setSpotifySdkReady(true);
          });
          player.addListener('not_ready', () => {
            if (cancelled) return;
            setSpotifySdkReady(false);
          });
          player.addListener('player_state_changed', (s) => {
            if (cancelled) return;
            setSpotifyPlayerState(s || null);
          });
          player.addListener('authentication_error', ({ message }) => {
            if (cancelled) return;
            toast.error(message || 'Spotify auth failed');
          });
          player.addListener('account_error', ({ message }) => {
            if (cancelled) return;
            toast.error(message || 'Spotify Premium is required for web playback');
          });
          await player.connect();
          if (!cancelled) spotifyPlayerRef.current = player;
        };

        if (window.Spotify) {
          await init();
          return;
        }
        if (!document.getElementById('spotify-player-sdk')) {
          const script = document.createElement('script');
          script.id = 'spotify-player-sdk';
          script.src = 'https://sdk.scdn.co/spotify-player.js';
          script.async = true;
          document.body.appendChild(script);
        }
        window.onSpotifyWebPlaybackSDKReady = () => {
          init();
        };
      } catch (_) {}
    };

    initPlayer();

    return () => {
      cancelled = true;
      if (spotifyPlayerRef.current) {
        try { spotifyPlayerRef.current.disconnect(); } catch (_) {}
        spotifyPlayerRef.current = null;
      }
    };
  }, [isMe, viewPublic, spotifyStatus?.spotify_connected, spotifyStatus?.feature_enabled]);

  const updatePref = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSavingPrefs(true);
    api.patch('/profile/preferences', next).then(() => {
      toast.success('Notification preferences saved');
    }).catch((e) => {
      toast.error(e.response?.data?.detail || 'Failed to save preferences');
    }).finally(() => setSavingPrefs(false));
  };

  const updateToastPageMute = (pageId, showToasts) => {
    const id = String(pageId || '').trim().toLowerCase();
    if (!id) return;
    const mutedSet = new Set(toastMutedPages);
    if (showToasts) mutedSet.delete(id);
    else mutedSet.add(id);
    const next = normalizeToastMutedPages(Array.from(mutedSet));
    setToastMutedPagesState(next);
    setToastMutedPages(next);
    setSavingToastMutes(true);
    api.patch('/profile/toast-page-prefs', { muted_pages: next }).then(() => {
      toast.success('Page toast preferences saved', { unsuppressible: true });
    }).catch((e) => {
      toast.error(e.response?.data?.detail || 'Failed to save toast preferences', { unsuppressible: true });
      fetchToastPagePrefs();
    }).finally(() => setSavingToastMutes(false));
  };

  const saveTelegram = async () => {
    const chatId = telegramChatId.trim();
    if (chatId && !isValidTelegramChatId(chatId)) {
      toast.error('Enter your numeric Chat ID from @userinfobot (not your @username).');
      return;
    }
    setSavingTelegram(true);
    try {
      const res = await api.patch('/profile/telegram', {
        telegram_chat_id: chatId || null,
        telegram_bot_token: telegramBotToken.trim() || null,
      });
      toast.success(res.data?.message ?? 'Telegram settings saved');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save Telegram settings');
    } finally {
      setSavingTelegram(false);
    }
  };

  const saveSpotifyEmbed = async () => {
    setSavingSpotifyEmbed(true);
    try {
      const res = await api.patch('/profile/spotify/embed', { spotify_url: spotifyUrlInput.trim() || null });
      toast.success(res.data?.message || 'Spotify embed saved');
      await fetchSpotifyStatus();
      await refetchProfile();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save Spotify embed');
    } finally {
      setSavingSpotifyEmbed(false);
    }
  };

  const connectSpotify = async () => {
    setSpotifyBusy(true);
    try {
      const res = await api.get('/profile/spotify/connect-url');
      const url = res.data?.url;
      if (!url) throw new Error('Missing Spotify connect URL');
      window.location.href = url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not start Spotify connect');
      setSpotifyBusy(false);
    }
  };

  const disconnectSpotify = async () => {
    setSpotifyBusy(true);
    try {
      const res = await api.post('/profile/spotify/disconnect');
      toast.success(res.data?.message || 'Spotify disconnected');
      await fetchSpotifyStatus();
      setSpotifySdkReady(false);
      setSpotifyDeviceId('');
      setSpotifyPlayerState(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to disconnect Spotify');
    } finally {
      setSpotifyBusy(false);
    }
  };

  const transferSpotifyPlayback = async () => {
    if (!spotifyDeviceId) {
      toast.error('Web player not ready yet');
      return;
    }
    setSpotifyBusy(true);
    try {
      await api.post('/profile/spotify/player/transfer', { device_id: spotifyDeviceId, play: false });
      toast.success('Web player activated');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to activate web player');
    } finally {
      setSpotifyBusy(false);
    }
  };

  const spotifyControl = async (action) => {
    setSpotifyBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Spotify control failed');
    } finally {
      setSpotifyBusy(false);
    }
  };

  const saveVisibility = async () => {
    setSavingVisibility(true);
    try {
      await api.patch('/profile/visibility', {
        hide_kills_on_profile: hideKillsOnProfile,
        hide_jailbusts_on_profile: hideJailbustsOnProfile,
        show_country_flag_on_profile: showCountryFlagOnProfile,
        hide_leaderboard_username: hideLeaderboardUsername,
        show_profile_view_count: showProfileViewCount,
      });
      toast.success('Profile visibility saved');
      await refetchProfile({ silent: true, usernameOverride: me?.username });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setSavingVisibility(false);
    }
  };

  const saveVideoAutoplay = async () => {
    setSavingAutoplay(true);
    try {
      await api.patch('/profile/video-autoplay', { profile_autoplay_video: profileAutoplayVideo });
      toast.success('Autoplay preference saved');
      const meRes = await api.get('/auth/me');
      setMe(meRes.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setSavingAutoplay(false);
    }
  };

  const saveProfanityFilter = async () => {
    setSavingProfanity(true);
    try {
      await api.patch('/profile/censor-profanity', { censor_profanity: censorProfanity });
      toast.success('Profanity filter saved');
      const meRes = await api.get('/auth/me');
      setMe(meRes.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setSavingProfanity(false);
    }
  };

  const changePassword = async () => {
    if (passwordForm.new !== passwordForm.confirm) {
      toast.error('New passwords do not match');
      return;
    }
    if (passwordForm.new.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    setChangingPassword(true);
    try {
      await api.post('/profile/change-password', { current_password: passwordForm.current, new_password: passwordForm.new });
      toast.success('Password changed successfully');
      setPasswordForm({ current: '', new: '', confirm: '' });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const saveBanner = async () => {
    setSavingBanner(true);
    try {
      await api.patch('/profile/banner', {
        banner_image_url: null,
        banner_text: (bannerTextEdit || '').trim() || null,
        notepad_color: (notepadColorEdit || '').trim() === '' ? '' : notepadColorEdit.trim(),
      });
      toast.success('Profile text updated');
      await refetchProfile({ silent: true, usernameOverride: profile?.username });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setSavingBanner(false);
    }
  };

  const insertBannerMarkup = (before, after = '') => {
    const ta = bannerTextareaRef.current;
    if (!ta) {
      setBannerTextEdit((c) => c + before + after);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const { value, cursor } = insertAtCursor(bannerTextEdit, before, after, start, end);
    setBannerTextEdit(value);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const addToAttackSearches = async () => {
    if (!profile?.username) return;
    try {
      const listRes = await api.get('/attack/list');
      const codeName = String(listRes.data?.search_code_name || '').trim();
      const searchCode = (
        codeName
        && typeof listRes.data?.[codeName] === 'string'
        && listRes.data[codeName].trim().length >= 16
      )
        ? { search_code_name: codeName, [codeName]: listRes.data[codeName].trim() }
        : {};
      const res = await apiPostWithCivilianProtectionConfirm('/attack/search', {
        target_username: profile.username,
        note: 'profile',
        ...searchCode,
      });
      toast.success(res.data?.message || `Searching for ${profile.username}...`);
      navigate('/attack');
    } catch (e) {
      if (isCivilianProtectionConfirmCancelled(e)) return;
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : (detail && typeof detail === 'object' && detail.detail)
          ? detail.detail
          : 'Failed to start search';
      toast.error(msg);
    }
  };

  const toggleGhostMode = async () => {
    const caps = isAdmin || isModerator || hasAdminEmail;
    if (caps && !staffLoginSession) {
      toast.error('Use staff login (Staff entrance) for admin actions.');
      navigate('/staff-entrance');
      return;
    }
    if (caps && staffPortalEnabled && !isStaffPortalTokenValid()) {
      toast.error('Enter the staff portal password first (unlock on a profile or open Admin).');
      return;
    }
    try {
      const res = await api.post('/admin/ghost-mode');
      const enabled = res.data?.admin_ghost_mode ?? false;
      toast.success(enabled ? 'Ghost mode on — you won\'t appear online' : 'Ghost mode off');
      await refetchMe();
      if (isMe && username) {
        await refetchProfile({ silent: true, usernameOverride: username });
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle ghost mode');
    }
  };

  const toggleSystemAiOnline = async () => {
    const caps = hasAdminEmail;
    if (caps && !staffLoginSession) {
      toast.error('Use staff login (Staff entrance) for admin actions.');
      navigate('/staff-entrance');
      return;
    }
    if (caps && staffPortalEnabled && !isStaffPortalTokenValid()) {
      toast.error('Enter the staff portal password first (unlock on a profile or open Admin).');
      return;
    }
    try {
      const res = await api.post('/admin/system-ai-online');
      const enabled = res.data?.system_ai_online ?? false;
      setSystemAiOnline(!!enabled);
      toast.success(enabled ? 'System AI online — showing on Who\'s Around' : 'System AI offline — hidden from Who\'s Around');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle System AI');
    }
  };

  const refetchAdmin = async () => {
    try {
      const r = await api.get('/auth/staff-flags');
      setIsAdmin(!!r.data?.is_admin);
      setIsModerator(!!r.data?.is_moderator);
      setHasAdminEmail(!!r.data?.has_admin_email);
      if (typeof r.data?.system_ai_online === 'boolean') {
        setSystemAiOnline(!!r.data.system_ai_online);
      }
      setStaffLoginSession(!!r.data?.staff_login_session);
      setStaffPortalEnabled(!!r.data?.staff_portal_enabled);
      window.dispatchEvent(new CustomEvent('app:admin-changed'));
    } catch (_) {}
  };

  const toggleActAsNormal = async () => {
    const caps = isAdmin || isModerator || hasAdminEmail;
    if (caps && !staffLoginSession) {
      toast.error('Use staff login (Staff entrance) for admin actions.');
      navigate('/staff-entrance');
      return;
    }
    if (caps && staffPortalEnabled && !isStaffPortalTokenValid()) {
      toast.error('Enter the staff portal password first (unlock on a profile or open Admin).');
      return;
    }
    try {
      const acting = !me?.admin_acting_as_normal;
      await api.post('/admin/act-as-normal', null, { params: { acting } });
      toast.success(acting ? 'Acting as normal user — admin powers off' : 'Admin powers on');
      await refetchMe();
      await refetchAdmin();
      if (isMe && username) {
        await refetchProfile({ silent: true, usernameOverride: username });
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle');
    }
  };

  const togglePreviewAsMod = async () => {
    const caps = isAdmin || hasAdminEmail || me?.admin_preview_as_mod;
    if (caps && !staffLoginSession) {
      toast.error('Use staff login (Staff entrance) for admin actions.');
      navigate('/staff-entrance');
      return;
    }
    if (caps && staffPortalEnabled && !isStaffPortalTokenValid()) {
      toast.error('Enter the staff portal password first (unlock on a profile or open Admin).');
      return;
    }
    try {
      const enabling = !me?.admin_preview_as_mod;
      const res = await api.post('/admin/preview-as-mod', null, { params: { enabled: enabling } });
      toast.success(res.data?.message || (enabling ? 'Moderator preview on' : 'Moderator preview off'));
      await refetchMe();
      await refetchAdmin();
      window.dispatchEvent(new CustomEvent('app:admin-changed'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle moderator preview');
    }
  };

  const formatPreviewCountdown = (secs) => {
    const n = Math.max(0, Number(secs) || 0);
    const m = Math.floor(n / 60);
    const s = n % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!me?.admin_preview_as_mod) return undefined;
    const iv = setInterval(() => {
      setMe((prev) => {
        if (!prev?.admin_preview_as_mod) return prev;
        const rem = prev.admin_preview_as_mod_seconds_remaining;
        if (rem == null || rem <= 0) return prev;
        return { ...prev, admin_preview_as_mod_seconds_remaining: rem - 1 };
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [me?.admin_preview_as_mod]);

  useEffect(() => {
    if (!me?.admin_preview_as_mod) return;
    const rem = me.admin_preview_as_mod_seconds_remaining;
    if (rem != null && rem <= 0) {
      refetchMe();
      refetchAdmin();
      window.dispatchEvent(new CustomEvent('app:admin-changed'));
    }
  }, [me?.admin_preview_as_mod, me?.admin_preview_as_mod_seconds_remaining]);

  const saveModOnlineColor = async () => {
    const hex = (modOnlineColor || '').trim() || '#1e3a5f';
    if (!/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) {
      toast.error('Enter a valid hex colour (e.g. #1e3a5f)');
      return;
    }
    setSavingModColor(true);
    try {
      await api.patch('/profile/mod-online-color', { color: hex });
      toast.success('Users online colour saved');
      await refetchMe();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setSavingModColor(false);
    }
  };

  const saveHdoOnlineColor = async () => {
    const hex = (hdoOnlineColor || '').trim() || '#166534';
    if (!/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) {
      toast.error('Enter a valid hex colour (e.g. #166534)');
      return;
    }
    setSavingHdoColor(true);
    try {
      await api.patch('/profile/hdo-online-color', { color: hex });
      toast.success('Users online colour saved');
      await refetchMe();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setSavingHdoColor(false);
    }
  };

  if (!profile) {
    const isNotFound = profileLoadError?.includes("doesn't exist");
    // Edit profile (/account/profile): paint settings chrome immediately — no skeleton/black screen.
    if (!usernameParam && !isNotFound) {
      const editTabs = [
        { id: 'look', label: 'Look', icon: UserIcon },
        { id: 'text', label: 'Text', icon: FileText },
        { id: 'alerts', label: 'Alerts', icon: Mail },
        { id: 'privacy', label: 'Privacy', icon: Lock },
        { id: 'account', label: 'Account', icon: Settings },
      ];
      return (
        <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="profile-page">
          <style>{PROFILE_STYLES}</style>
          <p className="text-[9px] text-zinc-500 font-heading italic max-w-3xl mx-auto">Edit your profile text and settings.</p>
          <div className="max-w-3xl mx-auto space-y-3 md:space-y-4">
            <div className="sticky top-0 z-20 -mx-1 sm:mx-0 px-0 py-1.5 border-b border-zinc-700/40 bg-zinc-950/95 backdrop-blur-md">
              <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
                {editTabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => switchEditTab(id)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-heading font-bold uppercase tracking-wider touch-manipulation transition-colors ${
                      (PROFILE_EDIT_TAB_IDS.has(editTab) ? editTab : 'look') === id
                        ? 'bg-primary/20 border-primary/50 text-primary'
                        : 'bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:text-foreground hover:border-zinc-600'
                    }`}
                  >
                    <Icon size={12} className="shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">Avatar</h2>
              </div>
              <div className="p-3 flex items-center gap-3 min-h-[4.5rem]">
                <div className="w-14 h-14 rounded-md overflow-hidden border border-primary/25 bg-secondary flex items-center justify-center shrink-0">
                  <UserIcon size={22} className="text-mutedForeground" />
                </div>
              </div>
            </div>
            {profileLoadError && (
              <div className="text-center">
                <button
                  type="button"
                  className="text-xs font-heading uppercase tracking-wider text-primary hover:underline"
                  onClick={() => username && refetchProfile({ silent: false, forceLoading: true, usernameOverride: username })}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }
    // Public profile still fetching — full dossier skeleton (not an empty name card).
    if (!isNotFound) {
      const label = username || 'Dossier';
      const skelRows = ['Username', 'Family', 'Rank', 'Wealth', 'Status', 'Kills'];
      return (
        <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="profile-page" aria-busy="true" aria-live="polite">
          <style>{PROFILE_STYLES}</style>
          <p className="text-[9px] text-zinc-500 font-heading italic max-w-3xl mx-auto">Rank, family, honours and property.</p>
          <div className="max-w-3xl mx-auto space-y-3">
            <div className={`relative ${styles.panel} rounded-lg border border-primary/25 overflow-hidden`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-3 py-2 bg-gradient-to-r from-primary/12 via-transparent to-transparent border-b border-primary/15 flex items-center justify-between gap-2">
                <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider truncate">{label}</p>
                <span className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/70 animate-pulse" aria-hidden />
                  Loading
                </span>
              </div>
              <div className="p-3 sm:p-4 flex flex-col sm:flex-row gap-4">
                <div className="w-full sm:w-36 h-36 rounded-lg border border-primary/20 bg-secondary/40 shrink-0 overflow-hidden">
                  <div className="prof-skel w-full h-full rounded-lg" />
                </div>
                <div className="flex-1 space-y-3 min-w-0">
                  <div className="prof-skel h-5 w-40 max-w-full" />
                  <div className="prof-skel h-3 w-28 max-w-[70%]" />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <div className="prof-skel h-8 w-20" />
                    <div className="prof-skel h-8 w-24" />
                    <div className="prof-skel h-8 w-20" />
                  </div>
                </div>
              </div>
              <div className="border-t border-primary/15 divide-y divide-primary/10">
                {skelRows.map((rowLabel) => (
                  <div key={rowLabel} className="px-3 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-[9px] font-heading font-bold text-zinc-500 uppercase tracking-wider shrink-0">{rowLabel}</span>
                    <div className="prof-skel h-3.5 w-24 sm:w-32" />
                  </div>
                ))}
              </div>
            </div>
            <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
              <div className="px-3 py-2 border-b border-primary/15">
                <div className="prof-skel h-3 w-24" />
              </div>
              <div className="p-3 space-y-2">
                <div className="prof-skel h-3 w-full" />
                <div className="prof-skel h-3 w-[88%]" />
                <div className="prof-skel h-3 w-[72%]" />
              </div>
            </div>
            {profileLoadError ? (
              <div className="text-center space-y-1">
                <p className="text-[10px] text-amber-400/90 font-heading">{profileLoadError}</p>
                <button
                  type="button"
                  className="text-xs font-heading uppercase tracking-wider text-primary hover:underline"
                  onClick={() => username && refetchProfile({ silent: false, forceLoading: true, usernameOverride: username })}
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <style>{PROFILE_STYLES}</style>
        <div className="relative prof-fade-in">
          <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Dossier</p>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">Profile</h1>
        </div>
        <div className={`relative ${styles.panel} rounded-lg border border-primary/20 prof-fade-in py-16 text-center overflow-hidden mobile-panel`} style={{ animationDelay: '0.05s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <UserIcon size={64} className="mx-auto text-primary/30 mb-4" />
          <p className="text-base text-foreground font-heading font-bold mb-1">
            Profile not found
          </p>
          <p className="text-sm text-mutedForeground font-heading">
            {profileLoadError || "This user doesn't exist or has been deleted"}
          </p>
        </div>
      </div>
    );
  }

  const isRobotBodyguard = Boolean(profile.is_npc && profile.is_bodyguard);
  const honours = profile.honours || [];
  const ownedCasinos = profile.owned_casinos || [];
  const showStaffEditTab = !!(hasAdminEmail || isModerator || me?.is_help_desk_operator);
  const editPageTabs = [
    { id: 'look', label: 'Look', icon: UserIcon },
    { id: 'text', label: 'Text', icon: FileText },
    { id: 'alerts', label: 'Alerts', icon: Mail },
    { id: 'privacy', label: 'Privacy', icon: Lock },
    { id: 'account', label: 'Account', icon: Settings },
    ...(showStaffEditTab ? [{ id: 'staff', label: 'Staff', icon: Shield }] : []),
  ];
  const currentEditTab = editPageTabs.some((t) => t.id === editTab) ? editTab : 'look';

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="profile-page">
      <style>{PROFILE_STYLES}</style>

      {isMe && !isPublicView ? (
        <p className="text-[9px] text-zinc-500 font-heading italic max-w-3xl mx-auto">Edit your profile text and settings.</p>
      ) : (
        <p className="text-[9px] text-zinc-500 font-heading italic max-w-3xl mx-auto">
          {profile.system_ai ? 'The house intelligence. Not a player.' : 'Rank, family, honours and property.'}
        </p>
      )}

      {isMe && (
        <div className="max-w-3xl mx-auto flex justify-center gap-2 mb-2">
          {!isPublicView ? (
            <Link
              to={`/profile/${encodeURIComponent(profile.username)}?view=public`}
              className="text-[10px] md:text-xs font-heading font-bold text-primary uppercase tracking-wider hover:underline"
            >
              View profile
            </Link>
          ) : (
            <Link
              to="/account/profile"
              className="text-[10px] md:text-xs font-heading font-bold text-primary uppercase tracking-wider hover:underline"
            >
              ← Back to edit
            </Link>
          )}
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-3 md:space-y-4">
        {isMe && !isPublicView ? (
          /* ─── Edit Profile: tabbed settings ─── */
          <>
            <div className="sticky top-0 z-20 -mx-1 sm:mx-0 px-0 py-1.5 border-b border-zinc-700/40 bg-zinc-950/95 backdrop-blur-md">
              <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
                {editPageTabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => switchEditTab(id)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-heading font-bold uppercase tracking-wider touch-manipulation transition-colors ${
                      currentEditTab === id
                        ? 'bg-primary/20 border-primary/50 text-primary'
                        : 'bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:text-foreground hover:border-zinc-600'
                    }`}
                  >
                    <Icon size={12} className="shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {currentEditTab === 'look' && (
            <div className="space-y-3 md:space-y-4 prof-fade-in">
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
                  Avatar
                </h2>
              </div>
              <div className="p-3 flex items-center gap-3">
                <div className="w-14 h-14 rounded-md overflow-hidden border border-primary/25 bg-secondary flex items-center justify-center shrink-0">
                  {(me?.avatar_url || defaultPlayerAvatarUrl(me?.id || me?.username)) ? (
                    <button
                      type="button"
                      onClick={() => setAvatarLightbox({
                        url: me?.avatar_url || defaultPlayerAvatarUrl(me?.id || me?.username),
                        username: me.username,
                      })}
                      className="w-full h-full p-0 border-0 bg-transparent cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md"
                      aria-label="View profile picture"
                    >
                      <img
                        src={me?.avatar_url || defaultPlayerAvatarUrl(me?.id || me?.username)}
                        alt=""
                        className="w-full h-full object-cover pointer-events-none"
                      />
                    </button>
                  ) : (
                    <UserIcon size={22} className="text-mutedForeground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-mutedForeground font-heading">
                    Upload a picture for your profile preview. GIFs stay animated; max ~1.2MB (encoded size).
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-xs hover:bg-primary/30 cursor-pointer ${savingAvatar ? 'opacity-60 cursor-not-allowed' : ''}`}>
                      <input
                        type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        disabled={savingAvatar}
                        onChange={(e) => uploadAvatar(e.target.files?.[0])}
                      />
                      {savingAvatar ? 'Saving…' : 'Choose image'}
                    </label>
                    <button
                      type="button"
                      onClick={removeAvatar}
                      disabled={savingAvatar || !me?.avatar_url}
                      className="inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-secondary border border-border text-foreground font-heading font-bold text-xs hover:bg-primary/10 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
              <div className="prof-art-line text-primary mx-3" />
            </div>

            {(me?.custom_profile_badge || (me?.badges || []).includes('Custom Profile Badge')) && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                  <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
                    Custom badge
                  </h2>
                </div>
                <div className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md overflow-hidden border border-violet-500/40 bg-secondary flex items-center justify-center shrink-0">
                    {me?.custom_profile_badge_url ? (
                      <img src={me.custom_profile_badge_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[8px] font-heading font-bold uppercase text-violet-300">Custom</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-mutedForeground font-heading">
                      Small square icon shown next to your name. JPG/PNG/WEBP/GIF; keep it tiny.
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-xs hover:bg-primary/30 cursor-pointer ${savingCustomBadge ? 'opacity-60 cursor-not-allowed' : ''}`}>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          className="hidden"
                          disabled={savingCustomBadge}
                          onChange={(e) => {
                            uploadCustomBadge(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                        {savingCustomBadge ? 'Saving…' : 'Upload badge'}
                      </label>
                      <button
                        type="button"
                        onClick={removeCustomBadge}
                        disabled={savingCustomBadge || !me?.custom_profile_badge_url}
                        className="inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-secondary border border-border text-foreground font-heading font-bold text-xs hover:bg-primary/10 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
                <div className="prof-art-line text-primary mx-3" />
              </div>
            )}

            {me?.profile_cosmetic_permanent ? (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-center gap-1.5">
                  <Star size={10} className="text-primary" />
                  <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
                    Name glow colour
                  </h2>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-[11px] text-mutedForeground font-heading">
                    Permanent Name Glow + Border owners only — change colour anytime for free (same presets &amp; custom picker as the Store). Applies to your name and profile border.
                  </p>
                  <GlowPresetPicker
                    value={currentGlowPresetId}
                    onChange={saveGlowColour}
                    disabled={savingGlow}
                    savingLabel="Saving…"
                  />
                </div>
                <div className="prof-art-line text-primary mx-3" />
              </div>
            ) : me?.profile_cosmetic_active ? (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-zinc-700/40 prof-card prof-fade-in mobile-panel`}>
                <div className="h-px bg-gradient-to-r from-transparent via-zinc-600/40 to-transparent" />
                <div className="px-2.5 py-1.5 bg-zinc-800/40 border-b border-zinc-700/40 flex items-center justify-center gap-1.5">
                  <Star size={10} className="text-zinc-500" />
                  <h2 className="text-[10px] font-heading font-bold text-zinc-400 uppercase tracking-[0.12em] text-center">
                    Name glow colour
                  </h2>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-[11px] text-mutedForeground font-heading">
                    Your 7-day glow is locked to the colour you bought. Free recolour anytime requires{' '}
                    <Link to="/game/store" className="text-primary hover:underline">Name Glow + Border (Permanent)</Link> from the Points Store.
                  </p>
                </div>
                <div className="prof-art-line text-zinc-600 mx-3" />
              </div>
            ) : null}
            </div>
            )}

            {currentEditTab === 'text' && (
            <div className="space-y-3 md:space-y-4 prof-fade-in">
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
                  Profile text
                </h2>
              </div>
              <div className="p-3 space-y-3">
                <textarea
                  ref={bannerTextareaRef}
                  value={bannerTextEdit}
                  onChange={(e) => setBannerTextEdit(e.target.value)}
                  placeholder="Write your profile text... [b]bold[/b], [i]italic[/i], [center]centered[/center], [color=red]colour[/color], [img]url[/img] (direct image or ImgBB short link), [url]link[/url], :) smileys"
                  rows={12}
                  className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-[11px] md:text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y font-mono leading-relaxed"
                />
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" onClick={() => insertBannerMarkup('[b]', '[/b]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Bold"><Bold size={14} /></button>
                  <button type="button" onClick={() => insertBannerMarkup('[i]', '[/i]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Italic"><Italic size={14} /></button>
                  <button type="button" onClick={() => insertBannerMarkup('[center]', '[/center]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Center"><AlignCenter size={14} /></button>
                  <button type="button" onClick={() => insertBannerMarkup('[color=#eab308]', '[/color]')} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Colour"><Palette size={14} /></button>
                  <button type="button" onClick={() => { const u = window.prompt('Image URL (direct file, or ImgBB page link https://ibb.co/…):'); if (u && u.trim()) insertBannerMarkup('[img]' + u.trim() + '[/img]'); }} className="p-1.5 rounded border border-zinc-700/50 text-mutedForeground hover:text-foreground hover:bg-primary/10" title="Insert image — ImgBB short links are converted on save"><Image size={14} /></button>
                </div>
                <div className="pt-2 border-t border-zinc-700/40 space-y-2">
                  <label className="block text-[10px] font-heading font-bold text-primary uppercase tracking-wider">
                    Notepad background
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      value={notepadColorEdit || '#1e293b'}
                      onChange={(e) => setNotepadColorEdit(e.target.value)}
                      className="h-9 w-9 sm:h-10 sm:w-10 cursor-pointer rounded border border-zinc-600 bg-zinc-900 p-0.5"
                      title="Pick a colour"
                      aria-label="Notepad background colour"
                    />
                    {NOTEPAD_COLOR_PRESETS.map(({ hex, label }) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setNotepadColorEdit(hex)}
                        title={`${label} ${hex}`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[10px] font-heading transition-colors ${
                          (notepadColorEdit || '').toLowerCase() === hex
                            ? 'border-primary/60 bg-primary/15 text-primary'
                            : 'border-zinc-600 text-mutedForeground hover:text-foreground hover:bg-zinc-800'
                        }`}
                      >
                        <span
                          className="h-4 w-4 rounded border border-zinc-500/60 shrink-0"
                          style={{ backgroundColor: hex }}
                          aria-hidden
                        />
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setNotepadColorEdit('')}
                      className="px-2.5 py-1.5 rounded-md border border-zinc-600 text-[10px] font-heading text-mutedForeground hover:text-foreground hover:bg-zinc-800 transition-colors"
                    >
                      Default (theme)
                    </button>
                  </div>
                  <div
                    className="rounded-md border border-zinc-700/50 p-3 min-h-[52px] flex items-center"
                    style={notepadColorEdit ? { backgroundColor: notepadColorEdit } : undefined}
                  >
                    <p className={`text-[11px] font-heading ${notepadColorEdit ? 'text-foreground' : 'text-mutedForeground'}`}>
                      {notepadColorEdit ? 'Preview: notepad area' : 'No background tint — matches profile card (default)'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={saveBanner}
                  disabled={savingBanner}
                  className="w-full py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingBanner ? 'Saving…' : 'Save profile text'}
                </button>
              </div>
              <div className="prof-art-line text-primary mx-3" />
            </div>
            </div>
            )}

            {currentEditTab === 'account' && (
            <div className="space-y-3 md:space-y-4 prof-fade-in">
            {/* Referral */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
                  Referral & Redeem
                </h2>
              </div>
              <div className="p-3 space-y-2">
                {me?.referred_by_username && (
                  <>
                    <p className="text-[11px] text-mutedForeground font-heading">
                      {(me?.referred_by_ids?.length > 1) ? 'Referrers' : 'Referred by'}: <span className="text-foreground font-semibold">{me.referred_by_username}</span>
                    </p>
                    <p className="text-[11px] text-mutedForeground font-heading">
                      Your signup bonus: premium rank bar, 500 respect points, and 18 tokens (use them; they can&apos;t be sold on Quick Trade). You also get 10% higher crime payouts and a 10% GTA rare car boost.
                    </p>
                  </>
                )}
                <p className="text-[11px] text-mutedForeground font-heading mb-1.5">
                  Share your link. When someone signs up with it, you earn (game-paid, not taken from them):
                </p>
                <ul className="text-[11px] text-mutedForeground font-heading list-disc list-inside space-y-0.5 mb-2">
                  <li>10% of their bullets from melting cars</li>
                  <li>10% of their crime profit</li>
                  <li>10% of their OC heist profit</li>
                  <li>10% of their garage scrap (cash) profit</li>
                  <li>10% of their booze profit (cash)</li>
                </ul>
                <p className="text-[10px] text-mutedForeground font-heading mb-1.5">
                  Referrals must verify email before their play counts toward your earnings.
                </p>
                <div className="rounded border border-border/60 bg-secondary/30 px-2 py-2 mb-2 space-y-1.5">
                  <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Your earnings so far</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-1 text-[10px] font-heading text-mutedForeground">
                    <span>Crime: <span className="text-emerald-400 tabular-nums">${Number(me?.referral_earnings_crime || 0).toLocaleString()}</span></span>
                    <span>OC: <span className="text-emerald-400 tabular-nums">${Number(me?.referral_earnings_oc || 0).toLocaleString()}</span></span>
                    <span>Booze: <span className="text-emerald-400 tabular-nums">${Number(me?.referral_earnings_booze || 0).toLocaleString()}</span></span>
                    <span>Scrap: <span className="text-emerald-400 tabular-nums">${Number(me?.referral_earnings_garage_scrap || 0).toLocaleString()}</span></span>
                    <span className="sm:col-span-2">Melt bullets: <span className="text-amber-400 tabular-nums">{Number(me?.referral_earnings_melt_bullets || 0).toLocaleString()}</span></span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/account/referral"
                      className="inline-flex items-center px-3 py-1.5 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-xs hover:bg-primary/30"
                    >
                      Referral &amp; redeem
                    </Link>
                    <Link to="/account/referral" className="text-[10px] text-mutedForeground font-heading underline hover:text-primary hover:no-underline">
                      Open codes &amp; details
                    </Link>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={typeof window !== 'undefined' ? `${window.location.origin}/?ref=${encodeURIComponent(me?.username || '')}` : ''}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded border border-input bg-secondary text-[11px] font-mono text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const url = typeof window !== 'undefined' ? `${window.location.origin}/?ref=${encodeURIComponent(me?.username || '')}` : '';
                      if (url && navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(url).then(() => toast.success('Link copied')).catch(() => toast.error('Copy failed'));
                      } else {
                        toast.error('Copy not supported');
                      }
                    }}
                    className="px-3 py-1.5 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-xs hover:bg-primary/30"
                  >
                    Copy link
                  </button>
                </div>
              </div>
              <div className="prof-art-line text-primary mx-3" />
            </div>
            </div>
            )}

            {currentEditTab === 'alerts' && (
            <div className="space-y-3 md:space-y-4 prof-fade-in">
            {/* Notifications */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Notifications</h2>
              </div>
              <div className="p-3 space-y-2">
                <p className="text-xs text-mutedForeground mb-2">
                  Choose which inbox notifications you receive.{' '}
                  <span className="text-[11px] text-foreground/90">
                    Witness statements (when you observe a kill) are always delivered to your inbox and cannot be disabled here.
                  </span>
                </p>
                {[
                  { key: 'ent_games', label: 'E-Games (dice & gbox results, new games)' },
                  { key: 'oc_invites', label: 'OC Heist invites' },
                  { key: 'attacks', label: 'Kill confirmations & attack alerts (not witness statements)' },
                  { key: 'system', label: 'System (rank ups, rewards)' },
                  { key: 'quicktrade', label: 'Quick Trade (listings sold or buy offers filled)' },
                  { key: 'messages', label: 'Direct messages' },
                  { key: 'forum_topic_reply', label: 'Forum: replies to your topics' },
                  { key: 'forum_comment_reply', label: 'Forum: replies to your comments' },
                  { key: 'forum_mention', label: 'Forum: when someone @mentions you' },
                  { key: 'designer_comp', label: 'Designer competition (when a new comp starts)' },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3 py-1">
                    <span className="text-sm text-foreground">{label}</span>
                    <button type="button" role="switch" aria-checked={!!prefs[key]} disabled={savingPrefs} onClick={() => updatePref(key, !prefs[key])} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs[key] ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingPrefs ? 'opacity-60' : ''}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${prefs[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="prof-art-line text-primary mx-3" />
            </div>

            {/* Page toast alerts */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Page toast alerts</h2>
              </div>
              <div className="p-3 space-y-2">
                <p className="text-xs text-mutedForeground mb-2">
                  Turn off pop-up toasts on busy pages. Inbox notifications above are separate and unchanged.
                </p>
                {TOAST_MUTEABLE_PAGES.map(({ id, label }) => {
                  const showToasts = !toastMutedPages.includes(id);
                  return (
                    <div key={id} className="flex items-center justify-between gap-3 py-1">
                      <span className="text-sm text-foreground">{label}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={showToasts}
                        disabled={savingToastMutes}
                        onClick={() => updateToastPageMute(id, !showToasts)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${showToasts ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingToastMutes ? 'opacity-60' : ''}`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${showToasts ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="prof-art-line text-primary mx-3" />
            </div>
            </div>
            )}

            {currentEditTab === 'privacy' && (
            <div className="space-y-3 md:space-y-4 prof-fade-in">
            {/* Profile: cars, video, autoplay */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Profile (cars & video)</h2>
              </div>
              <div className="p-3 space-y-4">
                <div>
                  <h3 className="text-xs font-heading font-bold text-foreground uppercase tracking-wider mb-1">Hide stats on profile</h3>
                  <p className="text-xs text-mutedForeground mb-2">Hide these from everyone viewing your profile (including you).</p>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <span className="text-sm text-foreground">Hide kills</span>
                    <button type="button" role="switch" aria-checked={hideKillsOnProfile} disabled={savingVisibility} onClick={() => setHideKillsOnProfile((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${hideKillsOnProfile ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingVisibility ? 'opacity-60' : ''}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${hideKillsOnProfile ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <span className="text-sm text-foreground">Hide jailbusts</span>
                    <button type="button" role="switch" aria-checked={hideJailbustsOnProfile} disabled={savingVisibility} onClick={() => setHideJailbustsOnProfile((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${hideJailbustsOnProfile ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingVisibility ? 'opacity-60' : ''}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${hideJailbustsOnProfile ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0 pr-2">
                      <span className="text-sm text-foreground block">Hide username on leaderboards</span>
                      <span className="text-[10px] text-mutedForeground">Shows as &quot;Hidden&quot; on leaderboards; Honours on your profile are hidden while this is on.</span>
                    </div>
                    <button type="button" role="switch" aria-checked={hideLeaderboardUsername} disabled={savingVisibility} onClick={() => setHideLeaderboardUsername((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${hideLeaderboardUsername ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingVisibility ? 'opacity-60' : ''}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${hideLeaderboardUsername ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0 pr-2">
                      <span className="text-sm text-foreground block">Show country flag</span>
                      <span className="text-[10px] text-mutedForeground">Uses your last detected region (from site visits). Shown next to your prestige badge.</span>
                    </div>
                    <button type="button" role="switch" aria-checked={showCountryFlagOnProfile} disabled={savingVisibility} onClick={() => setShowCountryFlagOnProfile((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${showCountryFlagOnProfile ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingVisibility ? 'opacity-60' : ''}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${showCountryFlagOnProfile ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  {profile?.last_seen_country ? (
                    <p className="text-[10px] text-mutedForeground flex flex-wrap items-center gap-1.5">
                      <span>Detected region:</span>
                      <span className="font-mono text-foreground">{profile.last_seen_country}</span>
                      {showCountryFlagOnProfile ? <CountryFlagThumb code={profile.last_seen_country} /> : null}
                    </p>
                  ) : (
                    <p className="text-[10px] text-mutedForeground">No region detected yet — browse the site and try again after your next request.</p>
                  )}
                  <div className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0 pr-2">
                      <span className="text-sm text-foreground block">Show profile views</span>
                      <span className="text-[10px] text-mutedForeground">Off by default. When on, a view count appears in the top right of your dossier. Your own visits are not counted.</span>
                    </div>
                    <button type="button" role="switch" aria-checked={showProfileViewCount} disabled={savingVisibility} onClick={() => setShowProfileViewCount((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${showProfileViewCount ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingVisibility ? 'opacity-60' : ''}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${showProfileViewCount ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  <button type="button" onClick={saveVisibility} disabled={savingVisibility} className="mt-2 px-3 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50">{savingVisibility ? 'Saving…' : 'Save'}</button>
                </div>
                <p className="text-[10px] text-mutedForeground">To show a car on your profile, open it from your <Link to="/cars/garage" className="text-primary hover:underline">Garage</Link> and use the <strong>Profile</strong> section on that page.</p>
                <div>
                  <h3 className="text-xs font-heading font-bold text-foreground uppercase tracking-wider mb-1">Autoplay profile videos</h3>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <span className="text-sm text-foreground">Autoplay when viewing others&apos; profiles</span>
                    <button type="button" role="switch" aria-checked={profileAutoplayVideo} disabled={savingAutoplay} onClick={() => setProfileAutoplayVideo((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${profileAutoplayVideo ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingAutoplay ? 'opacity-60' : ''}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${profileAutoplayVideo ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  <button type="button" onClick={saveVideoAutoplay} disabled={savingAutoplay} className="mt-2 px-3 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50">{savingAutoplay ? 'Saving…' : 'Save'}</button>
                </div>
                <div>
                  <h3 className="text-xs font-heading font-bold text-foreground uppercase tracking-wider mb-1">Profanity filter</h3>
                  <p className="text-xs text-mutedForeground mb-2">Replace swear words with *** in chat, forum, and messages.</p>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <span className="text-sm text-foreground">Censor profanity</span>
                    <button type="button" role="switch" aria-checked={censorProfanity} disabled={savingProfanity} onClick={() => setCensorProfanity((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${censorProfanity ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingProfanity ? 'opacity-60' : ''}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${censorProfanity ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  <button type="button" onClick={saveProfanityFilter} disabled={savingProfanity} className="mt-2 px-3 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50">{savingProfanity ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
              <div className="prof-art-line text-primary mx-3" />
            </div>
            </div>
            )}

            {currentEditTab === 'account' && (
            <div className="space-y-3 md:space-y-4 prof-fade-in">
            {/* Account: Telegram, password — referral panel is above when this tab is active */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Account</h2>
              </div>
              <div className="p-3 space-y-4">
                <div>
                  <h3 className="text-xs font-heading font-bold text-foreground uppercase tracking-wider mb-1">Telegram (Auto Rank)</h3>
                  <p className="text-xs text-mutedForeground mb-2">Numbers only (e.g. 123456789 or -100…). Get it from @userinfobot — not your @username. Optional: bot token from @BotFather.</p>
                  <input type="text" inputMode="numeric" placeholder="Chat ID (numbers only)" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 mb-2" />
                  <input type="password" placeholder="Bot token (optional)" value={telegramBotToken} onChange={(e) => setTelegramBotToken(e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 mb-2" />
                  <button type="button" onClick={saveTelegram} disabled={savingTelegram} className="px-3 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50">{savingTelegram ? 'Saving...' : 'Save'}</button>
                </div>
                <div>
                  <h3 className="text-xs font-heading font-bold text-foreground uppercase tracking-wider mb-1">Spotify</h3>
                  {!spotifyStatus?.feature_enabled ? (
                    <p className="text-xs text-mutedForeground">Spotify is currently disabled.</p>
                  ) : (
                    <>
                      <p className="text-xs text-mutedForeground mb-2">Paste a Spotify track/album/playlist/artist URL or URI for your profile embed.</p>
                      <input
                        type="text"
                        placeholder="https://open.spotify.com/track/... or spotify:track:..."
                        value={spotifyUrlInput}
                        onChange={(e) => setSpotifyUrlInput(e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 mb-2"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={saveSpotifyEmbed} disabled={savingSpotifyEmbed} className="px-3 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50">{savingSpotifyEmbed ? 'Saving...' : 'Save embed'}</button>
                        {!spotifyStatus?.spotify_connected ? (
                          <button type="button" onClick={connectSpotify} disabled={spotifyBusy || !spotifyStatus?.oauth_configured} className="px-3 py-2 rounded-md bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 font-heading font-bold text-sm hover:bg-emerald-500/30 disabled:opacity-50">
                            Connect Spotify
                          </button>
                        ) : (
                          <button type="button" onClick={disconnectSpotify} disabled={spotifyBusy} className="px-3 py-2 rounded-md bg-red-500/20 border border-red-500/50 text-red-300 font-heading font-bold text-sm hover:bg-red-500/30 disabled:opacity-50">
                            Disconnect
                          </button>
                        )}
                      </div>
                      {spotifyStatus?.spotify_connected && (
                        <div className="mt-3 rounded-md border border-primary/20 bg-secondary/30 p-2.5 space-y-2">
                          <p className="text-xs text-mutedForeground">
                            Connected as <span className="text-foreground font-semibold">{spotifyStatus?.spotify_display_name || spotifyStatus?.spotify_user_id || 'Spotify user'}</span>.
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={transferSpotifyPlayback} disabled={spotifyBusy || !spotifySdkReady || !spotifyDeviceId} className="px-2.5 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-primary text-xs font-heading font-bold disabled:opacity-50">
                              Activate web player
                            </button>
                            <button type="button" onClick={() => spotifyControl(() => api.post('/profile/spotify/player/previous'))} disabled={spotifyBusy} className="px-2 py-1.5 rounded-md border border-border text-foreground hover:bg-primary/10 disabled:opacity-50"><SkipBack size={14} /></button>
                            <button type="button" onClick={() => spotifyControl(() => api.post('/profile/spotify/player/play', {}))} disabled={spotifyBusy} className="px-2 py-1.5 rounded-md border border-border text-foreground hover:bg-primary/10 disabled:opacity-50"><Play size={14} /></button>
                            <button type="button" onClick={() => spotifyControl(() => api.post('/profile/spotify/player/pause'))} disabled={spotifyBusy} className="px-2 py-1.5 rounded-md border border-border text-foreground hover:bg-primary/10 disabled:opacity-50"><Pause size={14} /></button>
                            <button type="button" onClick={() => spotifyControl(() => api.post('/profile/spotify/player/next'))} disabled={spotifyBusy} className="px-2 py-1.5 rounded-md border border-border text-foreground hover:bg-primary/10 disabled:opacity-50"><SkipForward size={14} /></button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-mutedForeground">Volume</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={spotifyVolume}
                              onChange={(e) => setSpotifyVolume(Number(e.target.value))}
                              className="flex-1"
                            />
                            <button type="button" onClick={() => spotifyControl(() => api.patch('/profile/spotify/player/volume', { volume_percent: spotifyVolume }))} disabled={spotifyBusy} className="px-2 py-1 rounded-md border border-border text-[11px] text-foreground hover:bg-primary/10 disabled:opacity-50">Set</button>
                          </div>
                          {spotifyPlayerState?.track_window?.current_track?.name && (
                            <p className="text-xs text-mutedForeground">
                              Now playing: <span className="text-foreground font-semibold">{spotifyPlayerState.track_window.current_track.name}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div>
                  <h3 className="text-xs font-heading font-bold text-foreground uppercase tracking-wider mb-1">Change password</h3>
                  <input type="password" placeholder="Current password" value={passwordForm.current} onChange={(e) => setPasswordForm((f) => ({ ...f, current: e.target.value }))} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 mb-2" />
                  <input type="password" placeholder="New password (min 6 characters)" value={passwordForm.new} onChange={(e) => setPasswordForm((f) => ({ ...f, new: e.target.value }))} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 mb-2" />
                  <input type="password" placeholder="Confirm new password" value={passwordForm.confirm} onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 mb-2" />
                  <button type="button" onClick={changePassword} disabled={changingPassword || !passwordForm.current || !passwordForm.new || !passwordForm.confirm} className="w-full py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed">{changingPassword ? 'Changing...' : 'Change password'}</button>
                </div>
              </div>
              <div className="prof-art-line text-primary mx-3" />
            </div>
            </div>
            )}

            {currentEditTab === 'staff' && showStaffEditTab && (
            <div className="space-y-3 md:space-y-4 prof-fade-in">
            {(isAdmin || isModerator) && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1 md:gap-1.5">
                    <Ghost className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                    <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Ghost mode</span>
                  </div>
                  <button
                    type="button"
                    onClick={toggleGhostMode}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${me?.admin_ghost_mode ? 'bg-primary' : 'bg-secondary'}`}
                    role="switch"
                    aria-checked={!!me?.admin_ghost_mode}
                    title={me?.admin_ghost_mode ? 'You appear offline. Click to show online.' : 'You appear online. Click to hide (ghost).'}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow ring-0 transition-transform ${me?.admin_ghost_mode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <p className="px-2.5 py-1.5 md:px-3 text-[9px] md:text-[10px] text-mutedForeground font-heading">
                  When on, you won&apos;t appear in the online list or as &quot;Online&quot; on your profile.
                </p>
              </div>
            )}
            {hasAdminEmail && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1 md:gap-1.5">
                    <Bot className="w-3.5 h-3.5 md:w-4 md:h-4 text-amber-400" />
                    <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">System AI online</span>
                  </div>
                  <button
                    type="button"
                    onClick={toggleSystemAiOnline}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${systemAiOnline ? 'bg-primary' : 'bg-secondary'}`}
                    role="switch"
                    aria-checked={!!systemAiOnline}
                    title={systemAiOnline ? 'System AI is on Who\'s Around. Click to hide.' : 'System AI is hidden. Click to show online.'}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow ring-0 transition-transform ${systemAiOnline ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <p className="px-2.5 py-1.5 md:px-3 text-[9px] md:text-[10px] text-mutedForeground font-heading">
                  When on, System AI appears on Who&apos;s Around as online. Off hides her from the list and shows Offline on her profile.
                </p>
              </div>
            )}
            {hasAdminEmail ? (
            <>
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 md:gap-1.5">
                  <Shield className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                  <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
                    {me?.admin_acting_as_normal ? 'Acting as normal user' : 'Admin powers'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={toggleActAsNormal}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${me?.admin_acting_as_normal ? 'bg-secondary' : 'bg-primary'}`}
                  role="switch"
                  aria-checked={!!me?.admin_acting_as_normal}
                  title={me?.admin_acting_as_normal ? 'Click to use admin powers again' : 'Click to act as normal user (test without admin)'}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow ring-0 transition-transform ${me?.admin_acting_as_normal ? 'translate-x-0.5' : 'translate-x-5'}`} />
                </button>
              </div>
              <p className="px-2.5 py-1.5 md:px-3 text-[9px] md:text-[10px] text-mutedForeground font-heading">
                {me?.admin_acting_as_normal
                  ? 'Admin powers are off. Turn on to access Admin page and admin-only actions.'
                  : 'Turn off to test the game as a normal user (e.g. with others).'}
              </p>
            </div>
            {(isAdmin || me?.admin_preview_as_mod) && (
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 md:gap-1.5">
                  <Shield className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                  <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
                    {me?.admin_preview_as_mod ? 'Moderator preview' : 'Preview as moderator'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={togglePreviewAsMod}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${me?.admin_preview_as_mod ? 'bg-primary' : 'bg-secondary'}`}
                  role="switch"
                  aria-checked={!!me?.admin_preview_as_mod}
                  title={me?.admin_preview_as_mod ? 'Exit moderator preview early' : 'Use moderator-only tools for 30 minutes'}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow ring-0 transition-transform ${me?.admin_preview_as_mod ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <p className="px-2.5 py-1.5 md:px-3 text-[9px] md:text-[10px] text-mutedForeground font-heading">
                {me?.admin_preview_as_mod
                  ? `You see the same mod tools a moderator sees. Time left: ${formatPreviewCountdown(me?.admin_preview_as_mod_seconds_remaining)}. Turn off to restore full admin access.`
                  : 'Turn on for 30 minutes to test moderator tools (dupe checks, investigations, locks, etc.) without full admin powers.'}
              </p>
            </div>
            )}
            </>
            ) : isModerator ? (
            <>
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 md:gap-1.5">
                  <Shield className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                  <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Moderation tools</span>
                </div>
                <Link
                  to="/tjjeujr3wa/overview"
                  className="px-2.5 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/50 bg-primary/20 text-primary hover:bg-primary/30"
                >
                  Open
                </Link>
              </div>
              <p className="px-2.5 py-1.5 md:px-3 text-[9px] md:text-[10px] text-mutedForeground font-heading">
                View logs, account info, and lock users. No wealth or rank changes.
              </p>
            </div>
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20">
                <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Users online colour</span>
              </div>
              <div className="px-2.5 py-2 md:px-3 md:py-2.5">
                <p className="text-[9px] md:text-[10px] text-mutedForeground font-heading">
                  Set your colour for the Users Online page from <Link to="/tjjeujr3wa/overview" className="text-primary hover:underline font-heading">Admin → Mod display</Link> (mod tools), not here.
                </p>
              </div>
            </div>
            </>
            ) : me?.is_help_desk_operator && !isModerator ? (
            <>
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
                <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Help Desk Hub</span>
                <Link
                  to="/game/help-desk-hub"
                  className="px-2.5 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/50 bg-primary/20 text-primary hover:bg-primary/30"
                >
                  Open
                </Link>
              </div>
              <p className="px-2.5 py-1.5 md:px-3 text-[9px] md:text-[10px] text-mutedForeground font-heading">
                Stats, close rewards, and your roster colour.
              </p>
            </div>
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20">
                <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Users online colour</span>
              </div>
              <div className="px-2.5 py-2 md:px-3 md:py-2.5 space-y-2">
                <p className="text-[9px] md:text-[10px] text-mutedForeground font-heading">
                  How your name appears on the live roster (default green #166534).
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    type="text"
                    value={hdoOnlineColor}
                    onChange={(e) => setHdoOnlineColor(e.target.value)}
                    className="w-28 px-2 py-1 rounded border border-border bg-secondary text-xs font-mono text-foreground"
                    maxLength={7}
                  />
                  <input
                    type="color"
                    value={/^#[0-9A-Fa-f]{6}$/.test(hdoOnlineColor) ? hdoOnlineColor : '#166534'}
                    onChange={(e) => setHdoOnlineColor(e.target.value)}
                    className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
                    aria-label="Colour picker"
                  />
                  <button
                    type="button"
                    onClick={saveHdoOnlineColor}
                    disabled={savingHdoColor}
                    className="px-2.5 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/50 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50"
                  >
                    {savingHdoColor ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
            </>
            ) : null}
            </div>
            )}
          </>
        ) : (
          /* ─── View Profile: full profile (stats, notepad display, honours, etc.) ─── */
          <>
            {profile.hitlist_on && (
              <div className={`relative ${styles.panel} rounded-lg overflow-hidden border-2 border-red-500/50 bg-red-950/30 shadow-xl prof-fade-in`}>
                <div className="h-px bg-gradient-to-r from-transparent via-red-500/45 to-transparent" />
                <div className="px-3 py-2 flex items-center gap-2">
                  <Target size={18} className="text-red-400 shrink-0" aria-hidden />
                  <div>
                    <p className="text-xs font-heading font-bold text-red-400 uppercase tracking-wider">
                      On the hitlist
                    </p>
                    <p className="text-[11px] font-heading text-red-200/90 mt-0.5">
                      {profile.hitlist_total_cash > 0 && profile.hitlist_total_points > 0 && (
                        <>${Number(profile.hitlist_total_cash).toLocaleString()} cash and {Number(profile.hitlist_total_points).toLocaleString()} points in bounties</>
                      )}
                      {profile.hitlist_total_cash > 0 && profile.hitlist_total_points === 0 && (
                        <>${Number(profile.hitlist_total_cash).toLocaleString()} in bounties</>
                      )}
                      {profile.hitlist_total_cash === 0 && profile.hitlist_total_points > 0 && (
                        <>{Number(profile.hitlist_total_points).toLocaleString()} points in bounties</>
                      )}
                      {profile.hitlist_count > 0 && (
                        <span className="text-red-300/70"> · {Number(profile.hitlist_count).toLocaleString()} contract{profile.hitlist_count !== 1 ? 's' : ''}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {profile.system_ai && profile.profile_portrait_url ? (
              <div className="relative rounded-lg overflow-hidden border-2 border-amber-400/35 shadow-[0_0_40px_rgba(251,191,36,0.16)]">
                <img
                  src={profile.profile_portrait_url}
                  alt="System AI"
                  className="w-full aspect-[3/4] max-h-[36rem] object-cover object-[50%_42%]"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 py-3">
                  <p className="text-[10px] font-heading font-bold uppercase tracking-[0.22em] text-amber-300">
                    System AI
                  </p>
                  <p className="text-[11px] text-zinc-200 font-heading mt-0.5">
                    House intelligence
                  </p>
                </div>
              </div>
            ) : null}
            {!profile.system_ai ? (
            <SpotifyCard
              spotifyEmbedUrl={profile.spotify_embed_url}
              spotifyUrl={profile.spotify_url}
            />
            ) : null}
            <ProfileInfoCard 
              profile={profile} 
              isMe={isMe}
              onAddToSearch={addToAttackSearches}
              onSendMessage={profile.id ? () => setMessagePopupOpen(true) : undefined}
              onSendMoney={() => navigate('/bank', { state: { transferTo: profile.username } })}
              onOpenSettings={undefined}
              adminOnlineColor={me?.admin_online_color}
              bannerText={profile.profile_banner_text}
              isBannerEditing={false}
              editText=""
              onEditTextChange={() => {}}
              onSaveBanner={() => {}}
              savingBanner={false}
              bannerTextareaRef={undefined}
              onInsertBannerMarkup={() => {}}
              honours={honours}
              ownedCasinos={ownedCasinos}
              property={profile.property}
              garageDealership={profile.garage_dealership}
              sportsBetting={profile.sports_betting}
              isPropertyOwner={isMe}
              showCompactHonoursAndProperties
              topCars={profile.top_cars}
              showCarsOnProfile={profile.show_cars_on_profile}
              isAdmin={isAdmin}
              isModerator={isModerator}
              hasAdminEmail={hasAdminEmail}
              staffLoginSession={staffLoginSession}
              staffPortalEnabled={staffPortalEnabled}
              onStaffActionDone={async () => {
                await refetchProfile({ silent: true, usernameOverride: username || profile?.username });
              }}
              staffDetailsOpen={staffDetailsOpen}
              setStaffDetailsOpen={setStaffDetailsOpen}
              achievementBadges={Array.isArray(profile.achievement_badges) ? profile.achievement_badges : []}
              censorProfanity={me?.censor_profanity}
              onAvatarPreview={(url) => setAvatarLightbox({ url, username: profile.username })}
            />

            {!isMe && profile.admin_stats && (
              <AdminStatsCard adminStats={profile.admin_stats} />
            )}

          </>
        )}
      </div>

      {messagePopupOpen && profile?.id ? (
        <ProfileMessagePopup
          userId={profile.id}
          username={profile.username}
          onClose={() => setMessagePopupOpen(false)}
          censorProfanity={!!(censorProfanity || me?.censor_profanity)}
        />
      ) : null}
      {avatarLightbox ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/85"
          role="dialog"
          aria-modal="true"
          aria-labelledby="avatar-lightbox-title"
          onClick={() => setAvatarLightbox(null)}
        >
          <div
            className={`relative w-full max-w-lg ${styles.panel} rounded-xl border border-primary/30 shadow-2xl overflow-hidden prof-scale-in`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2.5 md:px-4 md:py-3 bg-primary/8 border-b border-primary/20 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/20 border border-primary/35 text-primary">
                  <UserIcon size={18} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p id="avatar-lightbox-title" className="text-sm md:text-base font-heading font-bold text-foreground truncate">
                    {avatarLightbox.username}
                  </p>
                  <p className="text-[10px] md:text-[11px] text-mutedForeground font-heading">Profile picture</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAvatarLightbox(null)}
                className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-secondary text-mutedForeground hover:text-foreground hover:border-primary/40 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3 md:p-4">
              <div className="rounded-lg overflow-hidden border border-border/60 bg-black/20">
                <img src={avatarLightbox.url} alt="" className="w-full h-auto max-h-[min(70vh,520px)] object-contain" />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
