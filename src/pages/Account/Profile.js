import { useEffect, useMemo, useState } from 'react';
import React from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { User as UserIcon, Search, Shield, Trophy, Building2, Mail, Skull, Users as UsersIcon, Ghost, Settings, Plane, Factory, DollarSign, MessageCircle, Car, Youtube, Bold, Italic, Image, Palette, AlignCenter, ChevronDown, Target, Lock, Unlock, Heart, Volume2, FileText, Dices, Activity, GalleryVerticalEnd, Radio, Award, Music2, Play, Pause, SkipBack, SkipForward, ExternalLink } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import PrestigeBadge from '../../components/PrestigeBadge';
import { parseForumContent, insertAtCursor } from '../../utils/forumContent';
import { filterProfanity } from '../../utils/profanityFilter';
import styles from '../../styles/noir.module.css';
import { BadgeShield, BADGE_STYLES as RANKING_BADGE_STYLES, CATEGORY_LABELS } from '../Game/RankingBadges';
import StaffUserDetailsPanel from '../../components/StaffUserDetailsPanel';

const PROFILE_STYLES = `
  @keyframes prof-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .prof-fade-in { animation: prof-fade-in 0.4s ease-out both; }
  @keyframes prof-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .prof-scale-in { animation: prof-scale-in 0.35s ease-out both; }
  .prof-card { transition: all 0.3s ease; }
  .prof-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .prof-row { transition: all 0.2s ease; }
  .prof-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .prof-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .prof-banner-content .forum-content-media { max-width: 100% !important; height: auto !important; border-radius: 8px; margin: 0.25em 0; display: block; }
  .prof-banner-content .forum-content-ytube { position: relative; width: 100%; max-width: 560px; margin: 0.5em auto; padding-bottom: 56.25%; }
  .prof-banner-content .forum-content-ytube-iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; border-radius: 8px; }
`;

/** Preset notepad backgrounds (dark greys). */
const NOTEPAD_COLOR_PRESETS = [
  { hex: '#333333', label: 'Charcoal' },
  { hex: '#282828', label: 'Graphite' },
];

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function fileToCompressedDataUrl(file, maxDim = 160, quality = 0.82) {
  if (!file) return '';
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Failed to read file'));
    r.readAsDataURL(file);
  });
  if (!String(dataUrl).startsWith('data:image/')) return '';
  const img = await new Promise((resolve, reject) => {
    const i = new window.Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Invalid image'));
    i.src = String(dataUrl);
  });
  const w = img.width || 1;
  const h = img.height || 1;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return String(dataUrl);
  ctx.drawImage(img, 0, 0, cw, ch);
  const jpeg = canvas.toDataURL('image/jpeg', quality);
  return jpeg && jpeg.startsWith('data:image/') ? jpeg : canvas.toDataURL('image/png');
}

// Subcomponents
const LoadingSpinner = () => (
  <div className={`space-y-3 ${styles.pageContent} mobile-page-root`}>
    <style>{PROFILE_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
      <UserIcon size={22} className="text-primary/40 animate-pulse" />
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[10px] font-heading uppercase tracking-[0.25em]">Loading profile...</span>
    </div>
  </div>
);

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
      <span className="text-[8px] md:text-[9px] font-heading font-bold text-primary/80 uppercase tracking-wider mr-1">Staff:</span>
      <TooltipProvider>
        <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleLock} disabled={!!loading} className={btn} title="Lock account"><Lock size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Lock account</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleUnlock} disabled={!!loading} className={btn} title="Unlock account"><Unlock size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Unlock account</TooltipContent></Tooltip>
        {isAdmin && (
          <>
            <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleKill} disabled={!!loading || isDead} className={btn} title="Kill (modkill)"><Skull size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Kill player</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleRevive} disabled={!!loading || !isDead} className={btn} title="Revive"><Heart size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Revive player</TooltipContent></Tooltip>
          </>
        )}
        <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleUnmute} disabled={!!loading} className={btn} title="Unmute forum"><Volume2 size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Unmute from forum</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button type="button" onClick={handleForceOnline} disabled={!!loading} className={btn} title="Force online 1hr"><Radio size={12} className="md:w-3.5 md:h-3.5" /></button></TooltipTrigger><TooltipContent>Force online (1 hour)</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Link to={{ pathname: '/admin', state: { activityLogUsername: username, gamblingLogUsername: username } }} className={btn} title="Activity log"><FileText size={12} className="md:w-3.5 md:h-3.5" /></Link></TooltipTrigger><TooltipContent>Activity log</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Link to={{ pathname: '/admin', state: { gamblingLogUsername: username } }} className={btn} title="Gambling log"><Dices size={12} className="md:w-3.5 md:h-3.5" /></Link></TooltipTrigger><TooltipContent>Gambling log</TooltipContent></Tooltip>
      </TooltipProvider>
      <Link to={{ pathname: '/admin', state: { targetUsername: username } }} className="text-[9px] font-heading text-primary/80 hover:text-primary ml-auto">Mute / more in Admin →</Link>
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
  isPropertyOwner = false,
  showCompactHonoursAndProperties = false,
  topCars = [],
  showCarsOnProfile = true,
  isAdmin = false,
  isModerator = false,
  onStaffActionDone,
  staffDetailsOpen = false,
  setStaffDetailsOpen,
  achievementBadges = [],
  censorProfanity = false,
}) => {
  const isAdminProfile = profile.rank_name === 'Admin';
  const isModeratorProfile = profile.rank_name === 'Moderator';
  const isHdoProfile = Boolean(profile.is_help_desk_operator)
    || (typeof profile.rank_name === 'string' && profile.rank_name.startsWith('(HDO)'))
    || profile.rank_name === 'Help Desk Operator';
  const isStaffProfile = isAdminProfile || isModeratorProfile || isHdoProfile;
  const adminColor = profile.admin_online_color ?? adminOnlineColor ?? '#a78bfa';
  const modColor = profile.mod_online_color ?? '#1e3a5f';
  const hdoColor = '#166534';
  const roleColor = isAdminProfile ? adminColor : (isModeratorProfile ? modColor : (isHdoProfile ? hdoColor : undefined));
  const allRows = [
    { 
      label: 'Username', 
      value: profile.username, 
      icon: UserIcon,
      valueClass: 'text-primary font-heading font-bold' 
    },
    { 
      label: 'Crew', 
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
      label: 'Messages', 
      icon: Mail,
      value: profile.messages_sent != null 
        ? `${profile.messages_sent} sent / ${profile.messages_received ?? 0} received` 
        : `${profile.messages_received ?? 0} received`, 
      valueClass: 'text-foreground font-heading text-[10px] md:text-sm' 
    },
    { 
      label: 'Jailbusts', 
      icon: GalleryVerticalEnd,
      value: String(profile.jail_busts ?? 0), 
      valueClass: 'text-foreground font-heading font-bold' 
    },
    { 
      label: 'Kills', 
      icon: Skull,
      value: String(profile.kills ?? 0), 
      valueClass: 'text-red-400 font-heading font-bold' 
    },
  ];
  
  // Check if user is a founding member
  const isFoundingMember = profile.founding_member || (profile.badges || []).includes('Founding Member');
  
  let profileRows = isStaffProfile
    ? allRows.filter((r) => r.label !== 'Status' && r.label !== 'Messages' && r.label !== 'Jailbusts')
    : allRows;
  // Respect hide_kills_on_profile / hide_jailbusts_on_profile (API sends null when hidden)
  profileRows = profileRows.filter((r) => {
    if (r.label === 'Kills' && (profile.kills === undefined || profile.kills === null)) return false;
    if (r.label === 'Jailbusts' && (profile.jail_busts === undefined || profile.jail_busts === null)) return false;
    return true;
  });

  const isRobotBodyguard = Boolean(profile.is_npc && profile.is_bodyguard);

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 md:w-11 md:h-11 rounded-md overflow-hidden border border-primary/30 bg-secondary flex items-center justify-center shrink-0">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={`${profile.username} avatar`} className="w-full h-full object-cover" />
            ) : (
              <UserIcon size={18} className="text-mutedForeground" />
            )}
          </div>
          <h2 className="text-[10px] md:text-xs font-heading font-bold text-primary uppercase tracking-[0.12em] truncate">
            {profile.username}
          </h2>
          {isFoundingMember && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] md:text-[9px] font-heading font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
              ⭐ Founder
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0 flex-wrap justify-end">
          {profile.prestige_level > 0 && (
            <PrestigeBadge level={profile.prestige_level} size="icon" showLabel />
          )}

          {/* Action buttons group */}
          <div className="flex items-center gap-1 md:gap-1.5">
            {isMe && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center justify-center h-7 w-7 md:h-8 md:w-8 rounded-md border border-primary/30 bg-secondary hover:bg-secondary/80 hover:border-primary/50 text-primary transition-all active:scale-95"
                title="Profile settings"
                aria-label="Profile settings"
              >
                <Settings size={12} className="md:w-3.5 md:h-3.5" />
              </button>
            )}
            {!isMe && (
              <>
                <button
                  type="button"
                  onClick={onAddToSearch}
                  className="inline-flex items-center justify-center h-7 w-7 md:h-8 md:w-8 rounded-md border border-primary/30 bg-secondary hover:bg-secondary/80 hover:border-primary/50 text-primary transition-all active:scale-95"
                  title="Add to Attack searches"
                  aria-label="Add to Attack searches"
                  data-testid="profile-add-to-search"
                >
                  <Search size={12} className="md:w-3.5 md:h-3.5" />
                </button>
                {profile.id && (
                  <button
                    type="button"
                    onClick={() => onSendMessage?.()}
                    className="inline-flex items-center justify-center h-7 w-7 md:h-8 md:w-8 rounded-md border border-primary/30 bg-secondary hover:bg-secondary/80 hover:border-primary/50 text-primary transition-all active:scale-95"
                    title="Send message"
                    aria-label="Send message"
                  >
                    <MessageCircle size={12} className="md:w-3.5 md:h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onSendMoney?.()}
                  className="inline-flex items-center justify-center h-7 w-7 md:h-8 md:w-8 rounded-md border border-primary/30 bg-secondary hover:bg-secondary/80 hover:border-primary/50 text-primary transition-all active:scale-95"
                  title="Send money"
                  aria-label="Send money"
                >
                  <DollarSign size={12} className="md:w-3.5 md:h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Staff actions: Lock, Unlock, Kill, Revive, Mute, Unmute, Activity log, Gambling log */}
      {!isMe && (isAdmin || isModerator) && profile?.username && (
        <>
          <StaffProfileActions
            username={profile.username}
            isDead={!!profile.is_dead}
            isAdmin={isAdmin}
            isModerator={isModerator}
            onDone={onStaffActionDone}
          />
          <div className="prof-fade-in">
            <button
              type="button"
              onClick={() => setStaffDetailsOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/15 transition-colors text-[10px] font-heading font-bold text-primary uppercase tracking-wider"
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

      <div className="divide-y divide-zinc-700/30">
        {profileRows.map((row) => {
          const Icon = row.icon;
          return (
            <div
              key={row.label}
              className={`prof-row grid grid-cols-12 gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3 md:py-2 ${
                row.highlight ? 'border-l-4 border-l-primary/50' : ''
              }`}
            >
              <div className="col-span-5 sm:col-span-4 flex items-center gap-1 md:gap-1.5">
                {Icon && <Icon size={12} className="md:w-3.5 md:h-3.5 text-primary/60 shrink-0" />}
                <span className="text-[9px] md:text-[10px] font-heading font-bold text-mutedForeground uppercase tracking-wider">
                  {row.label}
                </span>
              </div>
              <div className="col-span-7 sm:col-span-8 text-right flex items-center justify-end">
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
                ) : row.label === 'Crew' && profile.family_tag && profile.family_name ? (
                  <Link
                    to={`/families/${encodeURIComponent(profile.family_tag)}`}
                    className={`${row.valueClass} hover:underline hover:text-primary transition-colors`}
                  >
                    {row.value}
                  </Link>
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

      {profile.is_npc && (
        <div className="px-2.5 py-1.5 md:px-3 border-t border-zinc-700/30 bg-zinc-800/30">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] md:text-[10px] uppercase tracking-wider font-heading font-bold bg-zinc-800 text-mutedForeground border border-zinc-700/40">
            🤖 NPC
          </span>
        </div>
      )}

      {/* Compact Honours + Properties (under stats, above notepad) */}
      {showCompactHonoursAndProperties && (
        <div className="border-t border-zinc-700/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 px-2.5 py-1.5 md:px-3 md:py-1.5">
            <div>
              <Link
                to="/game/leaderboard"
                className="inline-flex items-center gap-0.5 mb-0.5 rounded-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title="Open leaderboards"
              >
                <Trophy size={9} className="text-primary shrink-0" />
                <span className="text-[8px] font-heading font-bold text-primary uppercase tracking-wider underline-offset-2 hover:underline">Honours</span>
              </Link>
              <div className="grid grid-cols-2 gap-0.5">
                {honours.length === 0 ? (
                  <span className="text-[8px] text-mutedForeground font-heading col-span-2">—</span>
                ) : (
                  honours.map((h, i) => {
                    const top10 = Number(h.rank) <= 10;
                    return (
                      <Link
                        key={i}
                        to="/game/leaderboard"
                        title="View leaderboards"
                        className={`flex items-center gap-0.5 px-1 py-0.5 rounded border text-[8px] font-heading leading-tight min-w-0 w-full transition-colors hover:border-primary/40 hover:bg-primary/10 ${
                          top10 ? 'border-primary/20 bg-primary/5' : 'border-zinc-500/30 bg-zinc-500/5'
                        }`}
                      >
                        <span className={`font-bold shrink-0 ${top10 ? 'text-primary' : 'text-zinc-400'}`}>#{h.rank}</span>
                        <span className="text-foreground truncate min-w-0">{h.label}</span>
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
                {!ownedCasinos?.length && !profileProperty && (
                  <span>None</span>
                )}
                {ownedCasinos?.length > 0 && (
                  <span className="block truncate">{ownedCasinos.slice(0, 3).map((c) => `${c.city} ${c.type === 'dice' ? 'Dice' : c.type === 'roulette' ? 'Roulette' : c.type === 'blackjack' ? 'BJ' : c.type === 'horseracing' ? 'Horse' : c.type || ''}`).join(', ')}{ownedCasinos.length > 3 ? '…' : ''}</span>
                )}
                {profileProperty?.type === 'airport' && <span className="block">Airport — {profileProperty.state ?? '—'}</span>}
                {profileProperty?.type === 'bullet_factory' && <span className="block">Bullet factory — {profileProperty.state ?? '—'}</span>}
              </div>
            </div>
          </div>
          {/* Achievement Badges under Honours (always visible on profile — same for you and other players) */}
          <div className="border-t border-zinc-700/30 px-2.5 py-1.5 md:px-3 md:py-1.5">
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
          {/* Compact Cars row under Honours/Properties (no label) */}
          {showCarsOnProfile !== false && topCars?.length > 0 && (
            <div className="border-t border-zinc-700/30 px-2 py-0.5 md:px-3">
              <div className="flex flex-wrap gap-0.5">
                {topCars.map((car) => {
                  const label = RARITY_LABELS[car.rarity] || car.rarity || '';
                  const badgeClass = RARITY_BADGE_CLASSES[car.rarity] || RARITY_BADGE_CLASSES.common;
                  return (
                    <Link
                      key={car.id}
                      to={`/view-car?id=${encodeURIComponent(car.id)}`}
                      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded border bg-zinc-900/90 hover:bg-zinc-800/90 transition-colors prof-row text-[7px] font-heading leading-tight ${badgeClass}`}
                    >
                      <span className="shrink-0 uppercase">{label}:</span>
                      <span className="text-foreground truncate max-w-[56px] sm:max-w-[72px]">{censorProfanity ? filterProfanity(car.name) : car.name}</span>
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
        const notepadBg = profile.profile_notepad_color || null;
        return (
          <div
            className="border-t border-zinc-700/30"
            style={notepadBg ? { backgroundColor: notepadBg } : undefined}
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
        <div className="border-t border-zinc-700/30">
          <div className="px-3 py-2 md:px-4 bg-primary/8 border-b border-primary/20 text-center">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
              Account Created
            </span>
          </div>
          <div className="px-3 py-2 md:px-4 md:py-2.5 text-foreground font-heading text-[11px] md:text-sm text-center">
            {formatDateTime(profile.created_at)}
          </div>
        </div>
      )}

      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

const HonoursCard = ({ honours }) => (
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
            return (
              <Link
                key={i}
                to="/game/leaderboard"
                title="View leaderboards"
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
                    #{h.rank}
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
  if (showCars === false || !topCars?.length) return null;
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`} style={{ animationDelay: '0.06s' }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-center gap-0.5">
        <Car size={10} className="text-primary" />
        <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          Cars
        </h3>
      </div>
      <div className="p-1.5 flex flex-wrap gap-1">
        {topCars.map((car) => {
          const label = RARITY_LABELS[car.rarity] || car.rarity;
          const badgeClass = RARITY_BADGE_CLASSES[car.rarity] || RARITY_BADGE_CLASSES.common;
          return (
            <Link
              key={car.id}
              to={`/view-car?id=${encodeURIComponent(car.id)}`}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-zinc-900/90 hover:bg-zinc-800/90 transition-colors prof-row text-[9px] ${badgeClass}`}
            >
              <span className="font-heading uppercase tracking-wide shrink-0">{label}:</span>
              <span className="font-heading font-semibold text-white truncate max-w-[100px] sm:max-w-[140px]">{car.name}</span>
            </Link>
          );
        })}
      </div>
      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

const PropertiesCard = ({ ownedCasinos, property, isOwner }) => {
  const hasCasinos = ownedCasinos?.length > 0;
  const hasProperty = property && (property.type === 'airport' || property.type === 'bullet_factory');
  const isEmpty = !hasCasinos && !hasProperty;

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
                  const typeLabel = c.type === 'dice' ? 'Dice' : c.type === 'roulette' ? 'Roulette' : c.type === 'blackjack' ? 'Blackjack' : c.type === 'horseracing' ? 'Horse Racing' : c.type === 'videopoker' ? 'Video Poker' : c.type === 'slots' ? 'Slots' : c.type || 'Casino';
                  const typeEmoji = c.type === 'dice' ? '🎲' : c.type === 'roulette' ? '🎡' : c.type === 'blackjack' ? '🃏' : c.type === 'horseracing' ? '🏇' : c.type === 'videopoker' ? '🃏' : c.type === 'slots' ? '🎰' : '🎰';
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

// Main component
export default function Profile() {
  const { username: usernameParam } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewPublic = searchParams.get('view') === 'public';
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [hasAdminEmail, setHasAdminEmail] = useState(false);
  const [prefs, setPrefs] = useState({ ent_games: true, oc_invites: true, attacks: true, system: true, messages: true, forum_topic_reply: true, forum_comment_reply: true, forum_mention: true, designer_comp: true });
  const [savingPrefs, setSavingPrefs] = useState(false);
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
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [savingAutoplay, setSavingAutoplay] = useState(false);
  const [censorProfanity, setCensorProfanity] = useState(false);
  const [savingProfanity, setSavingProfanity] = useState(false);
  const [modOnlineColor, setModOnlineColor] = useState('#1e3a5f');
  const [savingModColor, setSavingModColor] = useState(false);
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
  const spotifyPlayerRef = React.useRef(null);

  const refetchMe = async () => {
    try {
      const meRes = await api.get('/auth/me');
      setMe(meRes.data);
    } catch (_) {}
  };

  const refetchProfile = async () => {
    if (!username) return;
    try {
      const res = await api.get(`/users/${encodeURIComponent(username)}/profile`);
      setProfile(res.data);
    } catch (_) {}
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    setSavingAvatar(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      if (!dataUrl) {
        toast.error('Please choose an image file.');
        return;
      }
      await api.post('/profile/avatar', { avatar_data: dataUrl });
      toast.success('Avatar updated');
      await refetchMe();
      await refetchProfile();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to update avatar');
    } finally {
      setSavingAvatar(false);
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
    const run = async () => {
      setLoading(true);
      try {
        const [meRes, adminRes] = await Promise.all([
          api.get('/auth/me'),
          api.get('/admin/check').catch(() => ({ data: {} })),
        ]);
        setMe(meRes.data);
        setIsAdmin(!!adminRes.data?.is_admin);
        setIsModerator(!!adminRes.data?.is_moderator);
        setHasAdminEmail(!!adminRes.data?.has_admin_email);
      } catch (e) {
        toast.error('Failed to load your account');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

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
    if (!username) return;
    setLoading(true);
    setProfile(null);
    const run = async () => {
      try {
        const res = await api.get(`/users/${encodeURIComponent(username)}/profile`);
        setProfile(res.data);
      } catch (e) {
        toast.error(e.response?.data?.detail || 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    run();
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
      setPrefs(res.data?.notification_preferences || { ent_games: true, oc_invites: true, attacks: true, system: true, messages: true, forum_topic_reply: true, forum_comment_reply: true, forum_mention: true, designer_comp: true });
    } catch (_) {
      setPrefs({ ent_games: true, oc_invites: true, attacks: true, system: true, messages: true, forum_topic_reply: true, forum_comment_reply: true, forum_mention: true, designer_comp: true });
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
      fetchPrefs();
      fetchTelegram();
      fetchSpotifyStatus();
      setProfileAutoplayVideo(me?.profile_autoplay_video !== false);
      setHideKillsOnProfile(profile?.hide_kills_on_profile === true);
      setHideJailbustsOnProfile(profile?.hide_jailbusts_on_profile === true);
      api.get('/profile/censor-profanity').then((res) => {
        setCensorProfanity(res.data?.censor_profanity === true);
      }).catch(() => {});
    }
  }, [isMe, viewPublic, profile, profile?.hide_kills_on_profile, profile?.hide_jailbusts_on_profile, me?.profile_autoplay_video]);

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

  const saveTelegram = async () => {
    setSavingTelegram(true);
    try {
      const res = await api.patch('/profile/telegram', {
        telegram_chat_id: telegramChatId.trim() || null,
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
      });
      toast.success('Profile visibility saved');
      const res = await api.get(`/users/${encodeURIComponent(me?.username)}/profile`);
      setProfile(res.data);
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
      const res = await api.get(`/users/${encodeURIComponent(profile?.username)}/profile`);
      setProfile(res.data);
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
      const res = await api.post('/attack/search', { target_username: profile.username, note: 'profile' });
      toast.success(res.data?.message || `Searching for ${profile.username}...`);
      navigate('/attack');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start search');
    }
  };

  const toggleGhostMode = async () => {
    try {
      const res = await api.post('/admin/ghost-mode');
      const enabled = res.data?.admin_ghost_mode ?? false;
      toast.success(enabled ? 'Ghost mode on — you won\'t appear online' : 'Ghost mode off');
      await refetchMe();
      if (isMe && username) {
        const p = await api.get(`/users/${encodeURIComponent(username)}/profile`);
        setProfile(p.data);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle ghost mode');
    }
  };

  const refetchAdmin = async () => {
    try {
      const r = await api.get('/admin/check');
      setIsAdmin(!!r.data?.is_admin);
      setIsModerator(!!r.data?.is_moderator);
      setHasAdminEmail(!!r.data?.has_admin_email);
      window.dispatchEvent(new CustomEvent('app:admin-changed'));
    } catch (_) {}
  };

  const toggleActAsNormal = async () => {
    try {
      const acting = !me?.admin_acting_as_normal;
      await api.post('/admin/act-as-normal', null, { params: { acting } });
      toast.success(acting ? 'Acting as normal user — admin powers off' : 'Admin powers on');
      await refetchMe();
      await refetchAdmin();
      if (isMe && username) {
        const p = await api.get(`/users/${encodeURIComponent(username)}/profile`);
        setProfile(p.data);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle');
    }
  };

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

  if (loading && !profile) {
    return <LoadingSpinner />;
  }

  if (!profile) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <style>{PROFILE_STYLES}</style>
        <div className="relative prof-fade-in">
          <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Dossier</p>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">Edit Profile</h1>
        </div>
        <div className={`relative ${styles.panel} rounded-lg border border-primary/20 prof-fade-in py-16 text-center overflow-hidden mobile-panel`} style={{ animationDelay: '0.05s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <UserIcon size={64} className="mx-auto text-primary/30 mb-4" />
          <p className="text-base text-foreground font-heading font-bold mb-1">
            Profile not found
          </p>
          <p className="text-sm text-mutedForeground font-heading">
            This user doesn't exist or has been deleted
          </p>
        </div>
      </div>
    );
  }

  const isRobotBodyguard = Boolean(profile.is_npc && profile.is_bodyguard);
  const honours = profile.honours || [];
  const ownedCasinos = profile.owned_casinos || [];

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="profile-page">
      <style>{PROFILE_STYLES}</style>

      {isMe && !isPublicView ? (
        <p className="text-[9px] text-zinc-500 font-heading italic max-w-3xl mx-auto">Edit your profile text and settings.</p>
      ) : (
        <p className="text-[9px] text-zinc-500 font-heading italic max-w-3xl mx-auto">Rank, crew, honours and property.</p>
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
          /* ─── Edit Profile: notepad + profile settings only ─── */
          <>
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
                  Avatar
                </h2>
              </div>
              <div className="p-3 flex items-center gap-3">
                <div className="w-14 h-14 rounded-md overflow-hidden border border-primary/25 bg-secondary flex items-center justify-center shrink-0">
                  {me?.avatar_url ? (
                    <img src={me.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon size={22} className="text-mutedForeground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-mutedForeground font-heading">
                    Upload a picture for your profile preview.
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-xs hover:bg-primary/30 cursor-pointer ${savingAvatar ? 'opacity-60 cursor-not-allowed' : ''}`}>
                      <input
                        type="file"
                        accept="image/*"
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
                      Your signup bonus: premium rank bar, 500 respect points, and 18 tokens (use them; they can&apos;t be sold on Quick Trade). You also get 2% higher crime payouts and a slight GTA rare car boost.
                    </p>
                  </>
                )}
                <p className="text-[11px] text-mutedForeground font-heading mb-1.5">
                  Share your link. When someone signs up with it, you earn (game-paid, not taken from them):
                </p>
                <ul className="text-[11px] text-mutedForeground font-heading list-disc list-inside space-y-0.5 mb-2">
                  <li>10% of their bullets from melting cars</li>
                  <li>5% of their crime profit</li>
                  <li>5% of their OC heist profit</li>
                  <li>5% of their garage scrap (cash) profit</li>
                  <li>2% of their booze profit (cash)</li>
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

            {/* Notifications */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Notifications</h2>
              </div>
              <div className="p-3 space-y-2">
                <p className="text-xs text-mutedForeground mb-2">Choose which inbox notifications you receive.</p>
                {[
                  { key: 'ent_games', label: 'E-Games (dice & gbox results, new games)' },
                  { key: 'oc_invites', label: 'OC Heist invites' },
                  { key: 'attacks', label: 'Kills & attack alerts' },
                  { key: 'system', label: 'System (rank ups, rewards)' },
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

            {/* Account: Telegram, password */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-fade-in mobile-panel`}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Account</h2>
              </div>
              <div className="p-3 space-y-4">
                <div>
                  <h3 className="text-xs font-heading font-bold text-foreground uppercase tracking-wider mb-1">Telegram (Auto Rank)</h3>
                  <p className="text-xs text-mutedForeground mb-2">Chat ID from @userinfobot. Optional: bot token from @BotFather.</p>
                  <input type="text" placeholder="Telegram chat ID" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 mb-2" />
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

            {isMe && (hasAdminEmail || isModerator) && (
          <>
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
            {(hasAdminEmail && (isAdmin || me?.admin_acting_as_normal != null)) ? (
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
                  to="/admin"
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
                  Set your colour for the Users Online page from <Link to="/admin" className="text-primary hover:underline font-heading">Admin → Mod display</Link> (mod tools), not here.
                </p>
              </div>
            </div>
            </>
            ) : null}
            </>
            )}
          </>
        ) : (
          /* ─── View Profile: full profile (stats, notepad display, honours, etc.) ─── */
          <>
            {profile.hitlist_on && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border-2 border-red-500/50 bg-red-950/30 prof-fade-in`}>
                <div className="h-px bg-gradient-to-r from-transparent via-red-500/40 to-transparent" />
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
                        <span className="text-red-300/70"> · {profile.hitlist_count} contract{profile.hitlist_count !== 1 ? 's' : ''}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <SpotifyCard
              spotifyEmbedUrl={profile.spotify_embed_url}
              spotifyUrl={profile.spotify_url}
            />
            <ProfileInfoCard 
              profile={profile} 
              isMe={isMe}
              onAddToSearch={addToAttackSearches}
              onSendMessage={profile.id ? () => navigate(`/inbox/chat/${profile.id}`) : undefined}
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
              isPropertyOwner={isMe}
              showCompactHonoursAndProperties
              topCars={profile.top_cars}
              showCarsOnProfile={profile.show_cars_on_profile}
              isAdmin={isAdmin}
              isModerator={isModerator}
              onStaffActionDone={async () => {
                const res = await api.get(`/users/${encodeURIComponent(username || profile?.username)}/profile`);
                setProfile(res.data);
              }}
              staffDetailsOpen={staffDetailsOpen}
              setStaffDetailsOpen={setStaffDetailsOpen}
              achievementBadges={Array.isArray(profile.achievement_badges) ? profile.achievement_badges : []}
              censorProfanity={me?.censor_profanity}
            />

            {!isMe && profile.admin_stats && (
              <AdminStatsCard adminStats={profile.admin_stats} />
            )}

          </>
        )}
      </div>
    </div>
  );
}
