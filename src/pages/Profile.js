import { useEffect, useMemo, useState } from 'react';
import React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { User as UserIcon, Upload, Search, Shield, Trophy, Building2, Mail, Skull, Users as UsersIcon, Ghost, Settings, Plane, Factory, DollarSign, MessageCircle } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import PrestigeBadge from '../components/PrestigeBadge';
import styles from '../styles/noir.module.css';

const PROFILE_STYLES = `
  @keyframes prof-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .prof-fade-in { animation: prof-fade-in 0.4s ease-out both; }
  @keyframes prof-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .prof-scale-in { animation: prof-scale-in 0.35s ease-out both; }
  @keyframes prof-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .prof-glow { animation: prof-glow 4s ease-in-out infinite; }
  .prof-corner::before, .prof-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .prof-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .prof-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .prof-card { transition: all 0.3s ease; }
  .prof-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .prof-row { transition: all 0.2s ease; }
  .prof-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .prof-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// Subcomponents
const LoadingSpinner = () => (
  <div className={`space-y-3 ${styles.pageContent}`}>
    <style>{PROFILE_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
      <UserIcon size={22} className="text-primary/40 animate-pulse" />
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[10px] font-heading uppercase tracking-[0.25em]">Loading profile...</span>
    </div>
  </div>
);

const WealthRankWithTooltip = ({ wealthRankName, wealthRankRange }) => {
  const value = wealthRankName ?? '—';
  const rangeStr = wealthRankRange ?? '—';
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted decoration-primary/50 underline-offset-2 text-emerald-400 font-bold">
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

const ProfileInfoCard = ({ profile, isMe, onAddToSearch, onSendMessage, onSendMoney, onOpenSettings }) => {
  const profileRows = [
    { 
      label: 'Username', 
      value: profile.username, 
      icon: UserIcon,
      valueClass: 'text-foreground font-heading font-bold' 
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
      component: <WealthRankWithTooltip wealthRankName={profile.wealth_rank_name} wealthRankRange={profile.wealth_rank_range} />
    },
    { 
      label: 'Status', 
      isStatus: true, 
      isDead: profile.is_dead, 
      isOnline: profile.online 
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

  const isRobotBodyguard = Boolean(profile.is_npc && profile.is_bodyguard);
  const avatarSrc = isRobotBodyguard ? null : profile.avatar_url;

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-corner prof-fade-in`}>
      <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none prof-glow" />
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
        <h2 className="text-[10px] md:text-xs font-heading font-bold text-primary uppercase tracking-[0.12em] truncate">
          {profile.username}
        </h2>
        <div className="flex items-center gap-1 md:gap-1.5 shrink-0">
          <div
            className={`flex items-center gap-1 px-1.5 py-0.5 md:px-2 md:py-1 rounded-md border-2 bg-primary/20 ${profile.rank_name === 'Admin' && profile.admin_online_color ? '' : 'border-primary/50'}`}
            style={profile.rank_name === 'Admin' && profile.admin_online_color ? { borderColor: `${profile.admin_online_color}80`, backgroundColor: `${profile.admin_online_color}20` } : undefined}
          >
            <Shield size={12} className={profile.rank_name !== 'Admin' || !profile.admin_online_color ? 'text-primary' : ''} style={profile.rank_name === 'Admin' && profile.admin_online_color ? { color: profile.admin_online_color } : undefined} />
            <span
              className={`text-[9px] md:text-[10px] font-heading font-bold uppercase ${profile.rank_name === 'Admin' && profile.admin_online_color ? '' : 'text-primary'}`}
              style={profile.rank_name === 'Admin' && profile.admin_online_color ? { color: profile.admin_online_color } : undefined}
            >
              {profile.rank_name || '—'}
            </span>
          </div>
          {profile.prestige_level > 0 && (
            <PrestigeBadge level={profile.prestige_level} size="sm" showLabel={false} />
          )}
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
                    {row.isDead && <span className="text-red-400">💀 Dead (Offline)</span>}
                    {!row.isDead && row.isOnline && (
                      <span>
                        <span className="text-foreground">Alive </span>
                        <span className="text-emerald-400">(🟢 Online)</span>
                      </span>
                    )}
                    {!row.isDead && !row.isOnline && (
                      <span className="text-foreground">Alive (Offline)</span>
                    )}
                  </span>
                ) : row.label === 'Crew' && profile.family_tag && profile.family_name ? (
                  <Link
                    to={`/families/${encodeURIComponent(profile.family_tag)}`}
                    className={`${row.valueClass} hover:underline hover:text-primary transition-colors`}
                  >
                    {row.value}
                  </Link>
                ) : (
                  <span
                    className={row.valueClass}
                    style={row.label === 'Rank' && profile.rank_name === 'Admin' && profile.admin_online_color ? { color: profile.admin_online_color } : undefined}
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
      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

const HonoursCard = ({ honours }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-corner prof-fade-in`} style={{ animationDelay: '0.05s' }}>
    <div className="absolute top-0 left-0 w-16 h-16 bg-primary/5 rounded-full blur-2xl pointer-events-none prof-glow" />
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center justify-center gap-1">
        <Trophy size={12} className="md:w-3.5 md:h-3.5" />
        Honours ({honours.length})
      </h3>
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
          {honours.map((h, i) => (
            <div
              key={i}
              className="prof-row flex items-center gap-2 rounded-md border border-primary/20 px-2.5 py-1.5 bg-primary/5"
            >
              <div className="flex items-center justify-center w-6 h-6 md:w-7 md:h-7 rounded-full bg-primary/20 border border-primary/30 shrink-0">
                <span className="text-primary font-heading font-bold text-[10px] md:text-xs">
                  #{h.rank}
                </span>
              </div>
              <span className="text-foreground font-heading text-[10px] md:text-xs flex-1 leading-tight">
                {h.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
    <div className="prof-art-line text-primary mx-3" />
  </div>
);

const PropertiesCard = ({ ownedCasinos, property, isOwner }) => {
  const hasCasinos = ownedCasinos?.length > 0;
  const hasProperty = property && (property.type === 'airport' || property.type === 'bullet_factory');
  const isEmpty = !hasCasinos && !hasProperty;

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-corner prof-fade-in`} style={{ animationDelay: '0.05s' }}>
      <div className="absolute top-0 left-0 w-16 h-16 bg-primary/5 rounded-full blur-2xl pointer-events-none prof-glow" />
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
                  const typeLabel = c.type === 'dice' ? 'Dice' : c.type === 'roulette' ? 'Roulette' : c.type === 'blackjack' ? 'Blackjack' : c.type === 'horseracing' ? 'Horse Racing' : c.type || 'Casino';
                  const typeEmoji = c.type === 'dice' ? '🎲' : c.type === 'roulette' ? '🎡' : c.type === 'blackjack' ? '🃏' : c.type === 'horseracing' ? '🏇' : '🎰';
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
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border-2 border-primary/30 prof-card prof-corner prof-fade-in`} style={{ animationDelay: '0.1s' }}>
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

const AvatarCard = ({ 
  avatarSrc, 
  isMe, 
  preview, 
  uploading, 
  onPickFile, 
  onUpload 
}) => {
  const [imageUrl, setImageUrl] = React.useState('');
  const [localPreview, setLocalPreview] = React.useState(avatarSrc || '');

  const handleUpdateImage = () => {
    if (!imageUrl.trim()) return;
    
    // Extract URL from [img]URL[/img] format if present
    const urlMatch = imageUrl.match(/\[img\](.*?)\[\/img\]/i);
    const finalUrl = urlMatch ? urlMatch[1] : imageUrl;
    
    setLocalPreview(finalUrl);
    // Here you would call your API to save the image URL
    // For now we just update the preview
  };

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-card prof-corner prof-fade-in`} style={{ animationDelay: '0.05s' }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] text-center">
          📸 Profile Picture
        </h3>
      </div>
      <div className="p-2.5 md:p-3 space-y-2">
        {/* Image Preview with square aspect ratio */}
        <div className="aspect-square max-h-64 w-full max-w-sm mx-auto rounded-md overflow-hidden border-2 border-primary/20 bg-secondary/20 flex items-center justify-center">
          {localPreview ? (
            <img src={localPreview} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-mutedForeground">
              <svg className="w-10 h-10 md:w-12 md:h-12 text-primary/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-[10px] md:text-xs font-heading">No picture uploaded</span>
            </div>
          )}
        </div>
        
        {isMe && (
          <div className="space-y-2">
            <div className="text-[10px] md:text-xs text-mutedForeground font-heading mb-1.5">
              Enter image URL or use <code className="text-primary bg-primary/10 px-1 rounded">[img]URL[/img]</code>
            </div>
            
            {/* Image URL Input */}
            <textarea
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg or [img]https://example.com/image.jpg[/img]"
              className="w-full px-3 py-2.5 rounded-md bg-secondary border border-border text-[11px] md:text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono resize-none"
              rows={2}
            />
            
            {/* Update Button */}
            <button
              onClick={handleUpdateImage}
              disabled={!imageUrl.trim()}
              className="w-full bg-primary/20 text-primary rounded-md font-heading font-bold uppercase tracking-wide px-4 py-2 text-[10px] md:text-xs border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-1.5 touch-manipulation"
            >
              📤 Update Profile Picture
            </button>
            
            <p className="text-[9px] md:text-[10px] text-mutedForeground font-heading italic text-center">
              💡 Square images work best for profile pictures
            </p>
          </div>
        )}
      </div>
      <div className="prof-art-line text-primary mx-3" />
    </div>
  );
};

// Main component
export default function Profile() {
  const { username: usernameParam } = useParams();
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasAdminEmail, setHasAdminEmail] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefs] = useState({ ent_games: true, oc_invites: true, attacks: true, system: true, messages: true });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [changingPassword, setChangingPassword] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const username = useMemo(() => usernameParam || me?.username, [usernameParam, me?.username]);
  const isMe = !!(me && profile && me.username === profile.username);

  const refetchMe = async () => {
    try {
      const meRes = await api.get('/auth/me');
      setMe(meRes.data);
    } catch (_) {}
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
    if (!username) return;
    const run = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/users/${encodeURIComponent(username)}/profile`);
        setProfile(res.data);
        setPreview(null);
      } catch (e) {
        toast.error(e.response?.data?.detail || 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [username]);

  const openSettings = () => setSettingsOpen(true);
  const fetchPrefs = async () => {
    try {
      const res = await api.get('/profile/preferences');
      setPrefs(res.data?.notification_preferences || { ent_games: true, oc_invites: true, attacks: true, system: true, messages: true });
    } catch (_) {
      setPrefs({ ent_games: true, oc_invites: true, attacks: true, system: true, messages: true });
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
  useEffect(() => {
    if (settingsOpen && isMe) {
      fetchPrefs();
      fetchTelegram();
    }
  }, [settingsOpen, isMe]);

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

  const onPickFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.onerror = () => toast.error('Failed to read image');
    reader.readAsDataURL(file);
  };

  const onUpload = async () => {
    if (!preview) return;
    setUploading(true);
    try {
      const res = await api.post('/profile/avatar', { avatar_data: preview });
      toast.success(res.data.message || 'Avatar updated');
      const p = await api.get(`/users/${encodeURIComponent(me.username)}/profile`);
      setProfile(p.data);
      setPreview(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to upload avatar');
    } finally {
      setUploading(false);
    }
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

  if (loading && !profile) {
    return <LoadingSpinner />;
  }

  if (!profile) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <style>{PROFILE_STYLES}</style>
        <div className="relative prof-fade-in">
          <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Dossier</p>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">Profile</h1>
        </div>
        <div className={`relative ${styles.panel} rounded-lg border border-primary/20 prof-corner prof-fade-in py-16 text-center overflow-hidden`} style={{ animationDelay: '0.05s' }}>
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
  const avatarSrc = isRobotBodyguard ? null : (preview || profile.avatar_url || null);
  const honours = profile.honours || [];
  const ownedCasinos = profile.owned_casinos || [];

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="profile-page">
      <style>{PROFILE_STYLES}</style>

      <p className="text-[9px] text-zinc-500 font-heading italic max-w-3xl mx-auto">Rank, crew, honours and property.</p>

      <div className="max-w-3xl mx-auto space-y-3 md:space-y-4">
        <ProfileInfoCard 
          profile={profile} 
          isMe={isMe} 
          onAddToSearch={addToAttackSearches}
          onSendMessage={profile.id ? () => navigate(`/inbox/chat/${profile.id}`) : undefined}
          onSendMoney={() => navigate('/bank', { state: { transferTo: profile.username } })}
          onOpenSettings={isMe ? openSettings : undefined}
        />

        {isMe && (
          <AvatarCard
            avatarSrc={avatarSrc}
            isMe={isMe}
            preview={preview}
            uploading={uploading}
            onPickFile={onPickFile}
            onUpload={onUpload}
          />
        )}

        {isMe && hasAdminEmail && (
          <>
            {isAdmin && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 prof-fade-in`}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2.5 py-1.5 md:px-3 md:py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1 md:gap-1.5">
                    <Ghost className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                    <span className="text-[9px] md:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Admin ghost mode</span>
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
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
          <HonoursCard honours={honours} />
          <PropertiesCard ownedCasinos={ownedCasinos} property={profile.property} isOwner={isMe} />
        </div>

        {!isMe && profile.admin_stats && (
          <AdminStatsCard adminStats={profile.admin_stats} />
        )}

        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 prof-fade-in`} style={{ animationDelay: '0.1s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 md:px-4 bg-primary/8 border-b border-primary/20 text-center">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
              Account Created
            </span>
          </div>
          <div className="px-3 py-2 md:px-4 md:py-3 text-foreground font-heading text-[11px] md:text-sm text-center">
            {formatDateTime(profile.created_at)}
          </div>
          <div className="prof-art-line text-primary mx-4" />
        </div>
      </div>

      {isMe && (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className={`max-w-md ${styles.panel} border-primary/20`}>
            <DialogHeader>
              <DialogTitle className="font-heading text-primary">Profile settings</DialogTitle>
              <DialogDescription>Notifications and account options.</DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-heading font-bold text-foreground uppercase tracking-wider mb-3">Notifications</h3>
                <p className="text-xs text-mutedForeground mb-3">Choose which inbox notifications you receive. Off = no new notifications for that type.</p>
                <div className="space-y-2">
                  {[
                    { key: 'ent_games', label: 'E-Games (dice & gbox results, new games)' },
                    { key: 'oc_invites', label: 'OC Heist invites' },
                    { key: 'attacks', label: 'Kills & attack alerts' },
                    { key: 'system', label: 'System (rank ups, rewards)' },
                    { key: 'messages', label: 'Direct messages' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-3 py-1">
                      <span className="text-sm text-foreground">{label}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!prefs[key]}
                        disabled={savingPrefs}
                        onClick={() => updatePref(key, !prefs[key])}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs[key] ? 'bg-primary border-primary/50' : 'bg-secondary border-zinc-600'} ${savingPrefs ? 'opacity-60' : ''}`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${prefs[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-heading font-bold text-foreground uppercase tracking-wider mb-3">Telegram (Auto Rank)</h3>
                <p className="text-xs text-mutedForeground mb-2">Chat ID from @userinfobot. Optional: use your own bot token from @BotFather so you get notifications (if the shared bot doesn’t work for you).</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Telegram chat ID"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <input
                    type="password"
                    placeholder="Bot token (optional — from @BotFather)"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveTelegram}
                      disabled={savingTelegram}
                      className="shrink-0 px-3 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingTelegram ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-heading font-bold text-foreground uppercase tracking-wider mb-3">Change password</h3>
                <div className="space-y-2">
                  <input
                    type="password"
                    placeholder="Current password"
                    value={passwordForm.current}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, current: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <input
                    type="password"
                    placeholder="New password (min 6 characters)"
                    value={passwordForm.new}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, new: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={passwordForm.confirm}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-mutedForeground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    type="button"
                    onClick={changePassword}
                    disabled={changingPassword || !passwordForm.current || !passwordForm.new || !passwordForm.confirm}
                    className="mt-2 w-full py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {changingPassword ? 'Changing...' : 'Change password'}
                  </button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
