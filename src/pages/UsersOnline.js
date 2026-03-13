import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, User, Target, Building2, Plane, Factory, Mail } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { HoverCard, HoverCardTrigger, HoverCardPortal, HoverCardContent } from "@/components/ui/hover-card";
import PrestigeBadge from '../components/PrestigeBadge';
import styles from '../styles/noir.module.css';

const UO_STYLES = `
  @keyframes uo-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .uo-fade-in { animation: uo-fade-in 0.4s ease-out both; }
  .uo-card { transition: all 0.3s ease; }
  .uo-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .uo-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  @keyframes uo-hitlist-pulse {
    0%, 100% { box-shadow: 0 0 12px rgba(220, 38, 38, 0.4), inset 0 0 0 1px rgba(220, 38, 38, 0.25); }
    50% { box-shadow: 0 0 20px rgba(220, 38, 38, 0.7), inset 0 0 0 1px rgba(220, 38, 38, 0.45); }
  }
  .uo-hitlist {
    animation: uo-hitlist-pulse 2s ease-in-out infinite;
    box-shadow: 0 0 12px rgba(220, 38, 38, 0.4), inset 0 0 0 1px rgba(220, 38, 38, 0.25);
  }
  .uo-hitlist:hover { box-shadow: 0 0 20px rgba(220, 38, 38, 0.65), 0 4px 16px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(220, 38, 38, 0.4); }
  .uo-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
    <Users size={22} className="text-primary/40 animate-pulse" />
    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading...</span>
  </div>
);

const OnlineCountCard = ({ totalOnline }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-card uo-fade-in`}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        👥 Activity Status
      </h2>
    </div>
    <div className="p-2">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-primary/10 border border-primary/20">
          <Users className="text-primary" size={20} />
        </div>
        <div>
          <div className="text-xl md:text-2xl font-heading font-bold text-primary tabular-nums">
            {totalOnline}
          </div>
          <p className="text-[10px] text-mutedForeground font-heading">
            {totalOnline === 1 ? 'user' : 'users'} online now
          </p>
        </div>
      </div>
    </div>
    <div className="uo-art-line text-primary mx-2.5" />
  </div>
);

const DEFAULT_MOD_COLOR = '#1e3a5f';
const DEFAULT_HDO_COLOR = '#166534';

const RoleKey = ({ adminOnlineColor, modDefaultOnlineColor, hdoOnlineColor }) => {
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';
  const modColor = (modDefaultOnlineColor && modDefaultOnlineColor.trim()) || DEFAULT_MOD_COLOR;
  const hdoColor = (hdoOnlineColor && hdoOnlineColor.trim()) || DEFAULT_HDO_COLOR;
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-fade-in`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Role colours</h3>
      </div>
      <div className="px-2.5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] font-heading">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm shrink-0 border border-white/20" style={{ backgroundColor: adminColor }} aria-hidden />
          <span className="text-mutedForeground">Admin</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm shrink-0 border border-white/20" style={{ backgroundColor: modColor }} aria-hidden />
          <span className="text-mutedForeground">Mod</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm shrink-0 border border-white/20" style={{ backgroundColor: hdoColor }} aria-hidden />
          <span className="text-mutedForeground">Help Desk Operator</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Target size={12} className="text-red-400 shrink-0" aria-hidden />
          <span className="text-mutedForeground">On hitlist</span>
        </span>
      </div>
      <div className="uo-art-line text-primary mx-2.5" />
    </div>
  );
};

const UserCard = ({ user, profileCache, profileLoading, ensureProfilePreview, adminOnlineColor, modDefaultOnlineColor }) => {
  const preview = profileCache[user.username];
  const isLoading = !!profileLoading[user.username];
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';
  const modColor = (modDefaultOnlineColor && modDefaultOnlineColor.trim()) || DEFAULT_MOD_COLOR;
  const displayColor = user.online_color || (user.is_admin ? adminColor : user.is_moderator ? modColor : undefined);

  return (
    <div
      className={`relative z-10 ${styles.panel} rounded-md border px-2 py-1 h-7 md:h-8 flex items-center uo-row uo-card uo-fade-in ${user.on_hitlist ? 'uo-hitlist border-red-500/40' : 'border-primary/20'}`}
      data-testid="user-card"
    >
      <div className="flex items-center gap-1 min-h-[20px] w-full">
        <HoverCard onOpenChange={(open) => open && ensureProfilePreview(user.username)}>
          <HoverCardTrigger asChild>
            <Link
              to={`/profile/${encodeURIComponent(user.username)}`}
              className={`relative z-10 text-[11px] font-heading font-bold transition-colors ${displayColor ? '' : 'text-foreground hover:text-primary'}`}
              style={displayColor ? { color: displayColor } : undefined}
              data-testid={`user-profile-link-${user.username}`}
            >
              {user.username}
            </Link>
          </HoverCardTrigger>
          {user.prestige_level > 0 && (
            <span className="relative z-10">
              <PrestigeBadge level={user.prestige_level} size="sm" />
            </span>
          )}
          <HoverCardPortal>
            <HoverCardContent
              align="start"
              sideOffset={8}
              className={`z-[9999] w-72 max-w-[90vw] ${styles.panel} border-2 border-primary/30 rounded-md shadow-2xl p-0 overflow-hidden`}
            >
            {preview?.error ? (
              <div className="p-2 text-[10px] text-mutedForeground font-heading">
                Failed to load preview
              </div>
            ) : isLoading && !preview ? (
              <div className="p-2 text-[10px] text-mutedForeground font-heading">
                Loading preview...
              </div>
            ) : preview ? (
              <>
                <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
                  <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
                    Profile Preview
                  </h3>
                </div>
                {preview.on_hitlist && (
                  <div className="px-2.5 py-1 bg-red-500/20 border-b border-red-500/30 flex items-center gap-1.5">
                    <Target size={12} className="text-red-400 shrink-0" aria-hidden />
                    <span className="text-[10px] font-heading font-bold text-red-400 uppercase">On the hitlist</span>
                  </div>
                )}
                <div className="p-2">
                  <div className="flex items-center gap-2">
                    <div className="w-11 h-11 rounded-md overflow-hidden border border-primary/25 bg-secondary flex items-center justify-center shrink-0">
                      {preview.avatar_url ? (
                        <img src={preview.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        <User size={18} className="text-mutedForeground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-heading font-bold text-foreground text-[12px] truncate leading-tight">
                        {preview.username}
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-heading">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-mutedForeground">Kills</span>
                          <span className="text-foreground font-bold tabular-nums">{preview.kills}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-mutedForeground">Jail</span>
                          <span className="text-foreground font-bold tabular-nums">{preview.jail_busts}</span>
                        </div>
                        <div className="col-span-2 flex items-center justify-between gap-2">
                          <span className="text-mutedForeground inline-flex items-center gap-1">
                            <Mail size={12} className="opacity-70" aria-hidden />
                            Msgs
                          </span>
                          <span className="text-foreground font-bold tabular-nums">
                            {(preview.messages_sent ?? 0)} / {(preview.messages_received ?? 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {(preview.family || preview.owns_casino || preview.property_type) && (
                    <div className="mt-2 pt-2 border-t border-border/70 space-y-1 text-[10px] font-heading">
                      {preview.family && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-mutedForeground">Family</span>
                          <span className="text-foreground truncate">{preview.family}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {preview.owns_casino ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-primary/10 border border-primary/20 text-foreground">
                            <Building2 size={12} className="text-primary/80" aria-hidden />
                            Casino
                          </span>
                        ) : null}
                        {preview.property_type === 'airport' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-primary/10 border border-primary/20 text-foreground">
                            <Plane size={12} className="text-primary/80" aria-hidden />
                            Airport
                          </span>
                        ) : null}
                        {preview.property_type === 'armoury' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-primary/10 border border-primary/20 text-foreground">
                            <Factory size={12} className="text-primary/80" aria-hidden />
                            Armoury
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 pt-2 border-t border-border/70 text-[9px] text-mutedForeground font-heading italic text-center">
                    Click username to open full profile
                  </div>
                </div>
              </>
            ) : (
              <div className="p-2 text-[10px] text-mutedForeground font-heading">
                Hover to preview profile
              </div>
            )}
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCard>
        
        {user.in_jail && (
          <span className="shrink-0 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-heading font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">
            Jail
          </span>
        )}
        {user.on_hitlist && (
          <span className="shrink-0 inline-flex items-center text-red-400" title="On the hitlist">
            <Target size={12} className="drop-shadow-[0_0_6px_rgba(220,38,38,0.8)]" aria-hidden />
          </span>
        )}
      </div>
    </div>
  );
};

const InfoCard = () => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-fade-in`} style={{ animationDelay: '0.08s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        ℹ️ How It Works
      </h3>
    </div>
    <div className="p-2">
      <div className="space-y-0.5 text-[10px] text-mutedForeground font-heading leading-snug">
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            Status updates automatically every <strong className="text-foreground">30 seconds</strong>
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            Users inactive for <strong className="text-foreground">5+ minutes</strong> appear offline
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            Search any user (including offline or dead) from the top bar.
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            <strong className="text-foreground">Hover</strong> over usernames to see quick stats
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            Plan <strong className="text-foreground">attacks</strong> and <strong className="text-foreground">rackets</strong> based on who's active
          </span>
        </p>
      </div>
    </div>
    <div className="uo-art-line text-primary mx-2.5" />
  </div>
);

// Main component
export default function UsersOnline() {
  const [totalOnline, setTotalOnline] = useState(0);
  const [users, setUsers] = useState([]);
  const [adminOnlineColor, setAdminOnlineColor] = useState('#a78bfa');
  const [modDefaultOnlineColor, setModDefaultOnlineColor] = useState(DEFAULT_MOD_COLOR);
  const [hdoOnlineColor, setHdoOnlineColor] = useState(DEFAULT_HDO_COLOR);
  const [loading, setLoading] = useState(true);
  const [profileCache, setProfileCache] = useState({});
  const [profileLoading, setProfileLoading] = useState({});

  const fetchOnlineUsers = useCallback(async () => {
    try {
      const response = await api.get('/users/online');
      setTotalOnline(response.data.total_online);
      setUsers(response.data.users || []);
      if (response.data.admin_online_color != null) setAdminOnlineColor(response.data.admin_online_color);
      if (response.data.mod_default_online_color != null) setModDefaultOnlineColor(response.data.mod_default_online_color);
      if (response.data.hdo_online_color != null) setHdoOnlineColor(response.data.hdo_online_color);
    } catch (error) {
      toast.error('Failed to load online users');
      console.error('Error fetching online users:', error);
      setTotalOnline(0);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureProfilePreview = useCallback(async (username) => {
    if (!username) return;
    if (profileCache[username] || profileLoading[username]) return;
    
    setProfileLoading((prev) => ({ ...prev, [username]: true }));
    try {
      const res = await api.get(`/users/${encodeURIComponent(username)}/profile-preview`);
      setProfileCache((prev) => ({ ...prev, [username]: res.data }));
    } catch (e) {
      setProfileCache((prev) => ({ ...prev, [username]: { error: true } }));
    } finally {
      setProfileLoading((prev) => ({ ...prev, [username]: false }));
    }
  }, [profileCache, profileLoading]);

  useEffect(() => {
    fetchOnlineUsers();
    const interval = setInterval(fetchOnlineUsers, 30000);
    return () => clearInterval(interval);
  }, [fetchOnlineUsers]);

  // Refetch when tab/window gains focus so mod colour changes from Admin show up immediately
  useEffect(() => {
    const onFocus = () => fetchOnlineUsers();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchOnlineUsers]);

  if (loading) {
    return (
      <div className={`space-y-2 ${styles.pageContent}`}>
        <style>{UO_STYLES}</style>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="users-online-page">
      <style>{UO_STYLES}</style>

      <div className="relative uo-fade-in">
        <p className="text-[9px] text-zinc-500 font-heading italic">Who&apos;s active now. Hover for quick stats.</p>
      </div>

      <OnlineCountCard totalOnline={totalOnline} />

      {users.length === 0 ? (
        <div className={`relative ${styles.panel} rounded-md border border-primary/20 py-8 text-center uo-fade-in`} style={{ animationDelay: '0.03s' }} data-testid="no-users">
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <Users size={36} className="mx-auto text-primary/30 mb-2" />
          <p className="text-[12px] text-foreground font-heading font-bold mb-0.5">
            No other users online
          </p>
          <p className="text-[10px] text-mutedForeground font-heading">
            Check back soon to see who&apos;s active
          </p>
        </div>
      ) : (
        <div className={`relative z-10 ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-fade-in`} style={{ animationDelay: '0.03s' }}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
              👤 Active Users ({users.length})
            </h2>
          </div>
          <div className="p-2">
            <div className="flex flex-wrap gap-1" data-testid="users-grid">
                {users.map((user, idx) => (
                  <UserCard
                    key={user.username || `user-${idx}`}
                    user={user}
                    profileCache={profileCache}
                    profileLoading={profileLoading}
                    ensureProfilePreview={ensureProfilePreview}
                    adminOnlineColor={adminOnlineColor}
                    modDefaultOnlineColor={modDefaultOnlineColor}
                  />
                ))}
              </div>
          </div>
          <div className="uo-art-line text-primary mx-2.5" />
        </div>
      )}

      <InfoCard />

      <RoleKey adminOnlineColor={adminOnlineColor} modDefaultOnlineColor={modDefaultOnlineColor} hdoOnlineColor={hdoOnlineColor} />
    </div>
  );
}
