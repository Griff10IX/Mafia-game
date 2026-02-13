import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import styles from '../styles/noir.module.css';

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function UserCard({ user, profileCache, profileLoading, ensureProfilePreview }) {
  const preview = profileCache[user.username];
  const isLoading = !!profileLoading[user.username];

  return (
    <div
      className={`${styles.panel} rounded-sm p-2.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-smooth w-full sm:w-[190px] shrink-0`}
      data-testid="user-card"
    >
      <div className="flex items-start justify-between mb-0.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-heading font-bold text-foreground">
            <HoverCard onOpenChange={(open) => open && ensureProfilePreview(user.username)}>
              <HoverCardTrigger asChild>
                <Link
                  to={`/profile/${encodeURIComponent(user.username)}`}
                  className="hover:text-primary transition-smooth truncate block"
                  data-testid={`user-profile-link-${user.username}`}
                >
                  {user.username}
                </Link>
              </HoverCardTrigger>
              <HoverCardContent align="start" sideOffset={8} className={`w-72 max-w-[90vw] ${styles.surface} ${styles.borderGold} rounded-sm shadow-lg`}>
                {preview?.error ? (
                  <div className="text-sm text-mutedForeground font-heading">Failed to load preview</div>
                ) : isLoading && !preview ? (
                  <div className="text-sm text-mutedForeground font-heading">Loading preview...</div>
                ) : preview ? (
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className={`w-10 h-10 rounded-sm overflow-hidden border border-primary/20 ${styles.surface} flex items-center justify-center shrink-0`}>
                        {preview.avatar_url ? (
                          <img src={preview.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-xs text-mutedForeground font-heading">No avatar</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-heading font-bold text-primary truncate">{preview.username}</div>
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-heading">
                          <div className="flex justify-between">
                            <span className="text-mutedForeground">Kills</span>
                            <span className="text-foreground font-bold">{preview.kills}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-mutedForeground">Jail busts</span>
                            <span className="text-foreground font-bold">{preview.jail_busts}</span>
                          </div>
                          <div className="col-span-2 flex justify-between">
                            <span className="text-mutedForeground">Created</span>
                            <span className="text-foreground">{formatDateTime(preview.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {preview.admin_stats && (
                      <div className="pt-2 border-t border-primary/20 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs font-heading">
                        <div className="flex justify-between"><span className="text-mutedForeground">Cash</span><span className="text-primary font-bold">${Number(preview.admin_stats.money ?? 0).toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-mutedForeground">Points</span><span className="text-primary font-bold">{Number(preview.admin_stats.points ?? 0).toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-mutedForeground">Bullets</span><span className="text-primary font-bold">{Number(preview.admin_stats.bullets ?? 0).toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-mutedForeground">Booze today</span><span className="text-primary font-bold">${Number(preview.admin_stats.booze_profit_today ?? 0).toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-mutedForeground">Booze total</span><span className="text-primary font-bold">${Number(preview.admin_stats.booze_profit_total ?? 0).toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-mutedForeground">Location</span><span className="text-foreground truncate">{preview.admin_stats.current_state ?? '—'}</span></div>
                        {preview.admin_stats.in_jail && <div className="col-span-2 text-red-400 font-bold">In jail</div>}
                      </div>
                    )}
                    <div className="text-xs text-mutedForeground font-heading">Click to open full profile</div>
                  </div>
                ) : (
                  <div className="text-sm text-mutedForeground font-heading">Hover to preview profile</div>
                )}
              </HoverCardContent>
            </HoverCard>
          </h3>
        </div>
        {user.in_jail && (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-bold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30">
            Jailed
          </span>
        )}
      </div>
    </div>
  );
}

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
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="loading">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="users-online-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Users Online</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">See who&apos;s currently active</p>
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden p-4 max-w-2xl mx-auto`} data-testid="online-count">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-sm flex items-center justify-center bg-primary/20 border border-primary/30">
            <Users className="text-primary" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold text-primary">{totalOnline}</h2>
            <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Online now</p>
          </div>
        </div>
      </div>

      {users.length === 0 ? (
        <div className={`${styles.panel} rounded-sm py-12 text-center`} data-testid="no-users">
          <p className="text-sm text-mutedForeground font-heading">No other users online right now</p>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center items-start gap-3" data-testid="users-grid">
          {users.map((user, idx) => (
            <div
              key={idx}
              data-testid={user.in_jail ? 'user-card-jailed' : undefined}
            >
              <UserCard
                user={user}
                profileCache={profileCache}
                profileLoading={profileLoading}
                ensureProfilePreview={ensureProfilePreview}
              />
            </div>
          ))}
        </div>
      )}

      <div className={`${styles.panel} rounded-sm overflow-hidden max-w-2xl mx-auto`} data-testid="info-box">
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center justify-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Quick Info</h3>
            <div className="w-6 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4 flex flex-col items-center text-center">
          <ul className="space-y-1 text-xs text-mutedForeground font-heading text-left">
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Status updates every 30 seconds</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Inactive 5+ minutes = offline</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Plan attacks and rackets by who&apos;s active</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Bust jailed players for rank points</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
