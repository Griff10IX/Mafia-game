import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, User, Clock, MapPin } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import styles from '../styles/noir.module.css';

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
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = () => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2 flex items-center gap-3">
      <Users className="w-8 h-8 md:w-10 md:h-10" />
      Users Online
    </h1>
    <p className="text-sm text-mutedForeground">
      See who's currently active
    </p>
  </div>
);

const OnlineCountCard = ({ totalOnline }) => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        👥 Activity Status
      </h2>
    </div>
    <div className="p-4">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-md bg-primary/20 border border-primary/30">
          <Users className="text-primary" size={32} />
        </div>
        <div>
          <div className="text-3xl md:text-4xl font-heading font-bold text-primary tabular-nums">
            {totalOnline}
          </div>
          <p className="text-sm text-mutedForeground font-heading">
            {totalOnline === 1 ? 'user' : 'users'} online now
          </p>
        </div>
      </div>
    </div>
  </div>
);

const UserCard = ({ user, profileCache, profileLoading, ensureProfilePreview }) => {
  const preview = profileCache[user.username];
  const isLoading = !!profileLoading[user.username];

  return (
    <div
      className="bg-card rounded-md border border-border hover:border-primary/30 hover:shadow-md hover:shadow-primary/10 transition-all px-3 py-2"
      data-testid="user-card"
    >
      <div className="flex items-center gap-2">
        <HoverCard onOpenChange={(open) => open && ensureProfilePreview(user.username)}>
          <HoverCardTrigger asChild>
            <Link
              to={`/profile/${encodeURIComponent(user.username)}`}
              className="text-sm font-heading font-bold text-foreground hover:text-primary transition-colors"
              data-testid={`user-profile-link-${user.username}`}
            >
              {user.username}
            </Link>
          </HoverCardTrigger>
          <HoverCardContent 
            align="start" 
            sideOffset={8} 
            className="w-80 max-w-[90vw] bg-card border-2 border-primary/30 rounded-lg shadow-2xl p-0 overflow-hidden"
          >
            {preview?.error ? (
              <div className="p-4 text-sm text-mutedForeground font-heading">
                Failed to load preview
              </div>
            ) : isLoading && !preview ? (
              <div className="p-4 text-sm text-mutedForeground font-heading">
                Loading preview...
              </div>
            ) : preview ? (
              <>
                <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
                  <h3 className="text-base font-heading font-bold text-primary">
                    Profile Preview
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="w-12 h-12 rounded-md overflow-hidden border border-primary/20 bg-secondary flex items-center justify-center shrink-0">
                      {preview.avatar_url ? (
                        <img src={preview.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        <User size={24} className="text-mutedForeground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-heading font-bold text-foreground text-base truncate mb-2">
                        {preview.username}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs font-heading">
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
                  
                  <div className="text-xs text-mutedForeground font-heading flex items-center gap-1.5">
                    <Clock size={12} />
                    Joined {formatDateTime(preview.created_at)}
                  </div>
                  
                  {preview.admin_stats && (
                    <div className="pt-3 border-t border-border space-y-2">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs font-heading">
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
                        <div className="flex items-center gap-1.5 text-xs font-heading">
                          <MapPin size={12} className="text-primary" />
                          <span className="text-mutedForeground">Location:</span>
                          <span className="text-foreground font-bold">{preview.admin_stats.current_state}</span>
                        </div>
                      )}
                      
                      {preview.admin_stats.in_jail && (
                        <div className="px-2 py-1.5 rounded-md bg-red-500/20 text-red-400 text-xs font-heading font-bold text-center border border-red-500/30">
                          🔒 In Jail
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="pt-3 border-t border-border text-xs text-mutedForeground font-heading italic text-center">
                    Click username to view full profile
                  </div>
                </div>
              </>
            ) : (
              <div className="p-4 text-sm text-mutedForeground font-heading">
                Hover to preview profile
              </div>
            )}
          </HoverCardContent>
        </HoverCard>
        
        {user.in_jail && (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-heading font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">
            Jail
          </span>
        )}
      </div>
    </div>
  );
};

const InfoCard = () => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        ℹ️ How It Works
      </h3>
    </div>
    <div className="p-4">
      <div className="space-y-2 text-sm text-mutedForeground font-heading leading-relaxed">
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            Status updates automatically every <strong className="text-foreground">30 seconds</strong>
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            Users inactive for <strong className="text-foreground">5+ minutes</strong> appear offline
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            <strong className="text-foreground">Hover</strong> over usernames to see quick stats
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            Plan <strong className="text-foreground">attacks</strong> and <strong className="text-foreground">rackets</strong> based on who's active
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            Bust <strong className="text-red-400">jailed players</strong> for rank points
          </span>
        </p>
      </div>
    </div>
  </div>
);

// Main component
export default function UsersOnline() {
  const [totalOnline, setTotalOnline] = useState(0);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profileCache, setProfileCache] = useState({});
  const [profileLoading, setProfileLoading] = useState({});

  const fetchOnlineUsers = useCallback(async () => {
    try {
      const response = await api.get('/users/online');
      setTotalOnline(response.data.total_online);
      setUsers(response.data.users);
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
    return <LoadingSpinner />;
  }

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="users-online-page">
      <PageHeader />

      <OnlineCountCard totalOnline={totalOnline} />

      {users.length === 0 ? (
        <div className="bg-card rounded-md border border-border py-16 text-center" data-testid="no-users">
          <Users size={64} className="mx-auto text-primary/30 mb-4" />
          <p className="text-base text-foreground font-heading font-bold mb-1">
            No other users online
          </p>
          <p className="text-sm text-mutedForeground font-heading">
            Check back soon to see who's active
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-md overflow-hidden border border-primary/20">
          <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
              👤 Active Users ({users.length})
            </h2>
          </div>
          <div className="p-3 md:p-4">
            {/* Flexbox wrap layout - cards flow naturally */}
            <div className="flex flex-wrap gap-2" data-testid="users-grid">
              {users.map((user, idx) => (
                <UserCard
                  key={idx}
                  user={user}
                  profileCache={profileCache}
                  profileLoading={profileLoading}
                  ensureProfilePreview={ensureProfilePreview}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <InfoCard />
    </div>
  );
}
