import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

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
      className="bg-card border border-border rounded-sm p-2 hover:border-primary/50 transition-smooth w-full sm:w-[190px] shrink-0"
      data-testid="user-card"
    >
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[13px] font-bold text-foreground mb-0.5">
            <HoverCard onOpenChange={(open) => open && ensureProfilePreview(user.username)}>
              <HoverCardTrigger asChild>
                <Link
                  to={`/profile/${encodeURIComponent(user.username)}`}
                  className="hover:underline"
                  data-testid={`user-profile-link-${user.username}`}
                >
                  {user.username}
                </Link>
              </HoverCardTrigger>
              <HoverCardContent align="start" sideOffset={8} className="w-64">
                {preview?.error ? (
                  <div className="text-sm text-mutedForeground">Failed to load preview</div>
                ) : isLoading && !preview ? (
                  <div className="text-sm text-mutedForeground">Loading preview...</div>
                ) : preview ? (
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-sm overflow-hidden border border-border bg-secondary flex items-center justify-center shrink-0">
                      {preview.avatar_url ? (
                        <img src={preview.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-xs text-mutedForeground">No avatar</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-foreground truncate">{preview.username}</div>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-mutedForeground">Kills</span>
                          <span className="text-foreground font-mono">{preview.kills}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mutedForeground">Jail busts</span>
                          <span className="text-foreground font-mono">{preview.jail_busts}</span>
                        </div>
                        <div className="col-span-2 flex justify-between">
                          <span className="text-mutedForeground">Created</span>
                          <span className="text-foreground font-mono">{formatDateTime(preview.created_at)}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-mutedForeground">Click to open full profile</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-mutedForeground">Hover to preview profile</div>
                )}
              </HoverCardContent>
            </HoverCard>
          </h3>
        </div>
        {user.in_jail && (
          <div className="bg-destructive/20 border border-destructive px-2 py-0.5 rounded-sm">
            <span className="text-[11px] text-destructive font-bold uppercase">Jailed</span>
          </div>
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
    <div className="space-y-4" data-testid="users-online-page">
      <div>
        <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary mb-1">Users Online</h1>
        <p className="text-xs text-mutedForeground">See who's currently active in the family</p>
      </div>

      <div className="bg-card border border-border rounded-sm p-3" data-testid="online-count">
        <div className="flex items-center gap-2">
          <Users className="text-primary" size={22} />
          <div>
            <h2 className="text-xl font-heading font-semibold text-foreground">{totalOnline}</h2>
            <p className="text-xs text-mutedForeground">Online now</p>
          </div>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="text-center py-12 text-mutedForeground text-sm" data-testid="no-users">
          <p>No other users online right now</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-3" data-testid="users-grid">
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
      )}

      <div className="bg-card border border-border rounded-sm p-3" data-testid="info-box">
        <h3 className="text-sm font-heading font-semibold text-primary mb-2">Quick Info</h3>
        <ul className="space-y-1 text-xs text-mutedForeground">
          <li>• Online status updates every 30 seconds</li>
          <li>• Users inactive for 5+ minutes are considered offline</li>
          <li>• Plan your attacks and rackets based on who's active</li>
          <li>• Jailed players can be busted out for rank points</li>
        </ul>
      </div>
    </div>
  );
}
