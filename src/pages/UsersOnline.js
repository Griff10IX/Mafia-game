import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, User, Clock, MapPin } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { HoverCard, HoverCardTrigger, HoverCardPortal, HoverCardContent } from "@/components/ui/hover-card";
import styles from '../styles/noir.module.css';

const UO_STYLES = `
  @keyframes uo-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .uo-fade-in { animation: uo-fade-in 0.4s ease-out both; }
  .uo-corner::before, .uo-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .uo-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .uo-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .uo-card { transition: all 0.3s ease; }
  .uo-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .uo-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
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
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-card uo-corner uo-fade-in`}>
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

const UserCard = ({ user, profileCache, profileLoading, ensureProfilePreview, adminOnlineColor }) => {
  const preview = profileCache[user.username];
  const isLoading = !!profileLoading[user.username];
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';

  return (
    <div
      className={`relative z-10 ${styles.panel} rounded-md border border-primary/20 uo-row uo-card uo-fade-in px-2 py-1`}
      data-testid="user-card"
    >
      <div className="flex items-center gap-1">
        <HoverCard onOpenChange={(open) => open && ensureProfilePreview(user.username)}>
          <HoverCardTrigger asChild>
            <Link
              to={`/profile/${encodeURIComponent(user.username)}`}
              className={`relative z-10 text-[11px] font-heading font-bold transition-colors ${user.is_admin ? '' : 'text-foreground hover:text-primary'}`}
              style={user.is_admin ? { color: adminColor } : undefined}
              data-testid={`user-profile-link-${user.username}`}
            >
              {user.username}
              {user.is_admin && (
                <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: `${adminColor}20`, color: adminColor }}>Admin</span>
              )}
            </Link>
          </HoverCardTrigger>
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
                <div className="p-2 space-y-2">
                  <div className="flex gap-2">
                    <div className="w-10 h-10 rounded overflow-hidden border border-primary/20 bg-secondary flex items-center justify-center shrink-0">
                      {preview.avatar_url ? (
                        <img src={preview.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        <User size={18} className="text-mutedForeground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-heading font-bold text-foreground text-[12px] truncate mb-1">
                        {preview.username}
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-heading">
                        <div className="flex justify-between">
                          <span className="text-mutedForeground">Kills</span>
                          <span className="text-foreground font-bold">{preview.kills}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mutedForeground">Jailbusts</span>
                          <span className="text-foreground font-bold">{preview.jail_busts}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-[9px] text-mutedForeground font-heading flex items-center gap-1">
                    <Clock size={9} />
                    Joined {formatDateTime(preview.created_at)}
                  </div>
                  
                  {preview.admin_stats && (
                    <div className="pt-2 border-t border-border space-y-1">
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-heading">
                        <div className="flex justify-between">
                          <span className="text-mutedForeground">Cash</span>
                          <span className="text-primary font-bold">
                            ${Number(preview.admin_stats.money ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mutedForeground">Points</span>
                          <span className="text-primary font-bold">
                            {Number(preview.admin_stats.points ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mutedForeground">Bullets</span>
                          <span className="text-primary font-bold">
                            {Number(preview.admin_stats.bullets ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between col-span-2">
                          <span className="text-mutedForeground">Booze (Today)</span>
                          <span className="text-emerald-400 font-bold">
                            ${Number(preview.admin_stats.booze_profit_today ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between col-span-2">
                          <span className="text-mutedForeground">Booze (Total)</span>
                          <span className="text-emerald-400 font-bold">
                            ${Number(preview.admin_stats.booze_profit_total ?? 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      
                      {preview.admin_stats.current_state && (
                        <div className="flex items-center gap-1 text-[10px] font-heading">
                          <MapPin size={9} className="text-primary" />
                          <span className="text-mutedForeground">Location:</span>
                          <span className="text-foreground font-bold">{preview.admin_stats.current_state}</span>
                        </div>
                      )}
                      
                      {preview.admin_stats.in_jail && (
                        <div className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px] font-heading font-bold text-center border border-red-500/30">
                          🔒 In Jail
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="pt-2 border-t border-border text-[9px] text-mutedForeground font-heading italic text-center">
                    Click username to view full profile
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
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            Bust <strong className="text-red-400">jailed players</strong> for rank points
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
  const [loading, setLoading] = useState(true);
  const [profileCache, setProfileCache] = useState({});
  const [profileLoading, setProfileLoading] = useState({});

  const fetchOnlineUsers = useCallback(async () => {
    try {
      const response = await api.get('/users/online');
      setTotalOnline(response.data.total_online);
      setUsers(response.data.users || []);
      if (response.data.admin_online_color) setAdminOnlineColor(response.data.admin_online_color);
    } catch (error) {
      toast.error('Failed to load online users');
      console.error('Error fetching online users:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureProfilePreview = useCallback(async (username) => {
    if (!username) return;
    if (profileCache[username] || profileLoading[username]) return;
    
    setProfileLoading((prev) => ({ ...prev, [username]: true }));
    try {
      const res = await api.get(`/users/${encodeURIComponent(username)}/profile`);
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
                    key={idx}
                    user={user}
                    profileCache={profileCache}
                    profileLoading={profileLoading}
                    ensureProfilePreview={ensureProfilePreview}
                    adminOnlineColor={adminOnlineColor}
                  />
                ))}
              </div>
          </div>
          <div className="uo-art-line text-primary mx-2.5" />
        </div>
      )}

      <InfoCard />
    </div>
  );
}
