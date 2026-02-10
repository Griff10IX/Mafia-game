import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { User as UserIcon, Upload, Search } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function WealthRankWithTooltip({ wealthRankName, wealthRankRange }) {
  const value = wealthRankName ?? '—';
  const rangeStr = wealthRankRange ?? '—';
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default underline decoration-dotted decoration-mutedForeground/50 underline-offset-2">{value}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="bg-zinc-800 text-white border border-zinc-600 rounded-md px-3 py-2 text-sm font-mono shadow-lg">
          {rangeStr}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function Profile() {
  const { username: usernameParam } = useParams();
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);

  const username = useMemo(() => usernameParam || me?.username, [usernameParam, me?.username]);
  const isMe = !!(me && profile && me.username === profile.username);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const meRes = await api.get('/auth/me');
        setMe(meRes.data);
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
      // refresh
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

  if (loading && !profile) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-heading font-bold text-primary">Profile</h1>
        <p className="text-mutedForeground">Profile not found.</p>
      </div>
    );
  }

  const isRobotBodyguard = Boolean(profile.is_npc && profile.is_bodyguard);
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '') || '';
  const robotAvatarSrc = isRobotBodyguard ? `${base}/robot-bodyguard-avatar.png` : null;
  const avatarSrc = preview || profile.avatar_url || robotAvatarSrc;
  const status = profile.is_dead ? 'Dead (Offline)' : profile.online ? 'Alive (Online)' : 'Alive (Offline)';
  const statusClass = profile.is_dead
    ? 'bg-destructive/20 text-destructive border border-destructive/30'
    : profile.online
      ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
      : 'bg-secondary text-mutedForeground border border-border';

  return (
    <div className="space-y-6" data-testid="profile-page">
      <div className="flex items-start gap-4">
        <div className="w-20 h-20 rounded-sm overflow-hidden border border-border bg-secondary flex items-center justify-center">
          {avatarSrc ? (
            <img src={avatarSrc} alt="avatar" className="w-full h-full object-cover" />
          ) : (
            <UserIcon className="text-mutedForeground" size={28} />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary">{profile.username}</h1>
            {!isMe && (
              <button
                type="button"
                onClick={addToAttackSearches}
                className="inline-flex items-center justify-center h-9 w-9 rounded-sm border border-border bg-secondary/20 hover:bg-secondary/40 text-primary transition-smooth"
                title="Add to Attack searches"
                aria-label="Add to Attack searches"
                data-testid="profile-add-to-search"
              >
                <Search size={16} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <p className="text-mutedForeground">{profile.rank_name} (Rank {profile.rank})</p>
            {profile.wealth_rank_name != null && (
              <p className="text-mutedForeground"> · <WealthRankWithTooltip wealthRankName={profile.wealth_rank_name} wealthRankRange={profile.wealth_rank_range} /></p>
            )}
            {profile.is_npc ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-bold bg-secondary text-mutedForeground">
                NPC
              </span>
            ) : null}
            <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] uppercase tracking-wider font-bold ${statusClass}`}>
              Status: {status}
            </span>
          </div>
        </div>
      </div>

      {isMe && (
        <div className="bg-card border border-border rounded-sm p-4 max-w-xl">
          <div className="text-sm font-semibold text-foreground mb-2">Avatar</div>
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onPickFile(e.target.files?.[0])}
              className="text-sm"
              data-testid="avatar-file"
            />
            <button
              onClick={onUpload}
              disabled={!preview || uploading}
              className="inline-flex items-center gap-2 bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest px-4 py-2 transition-smooth disabled:opacity-50"
              data-testid="avatar-upload"
            >
              <Upload size={16} />
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
          <p className="text-xs text-mutedForeground mt-2">Tip: use a small image (square works best).</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-sm p-4">
          <div className="text-xs text-mutedForeground">Name</div>
          <div className="text-lg font-heading font-semibold text-foreground">{profile.username}</div>
        </div>
        <div className="bg-card border border-border rounded-sm p-4">
          <div className="text-xs text-mutedForeground">Rank</div>
          <div className="text-lg font-heading font-semibold text-foreground">{profile.rank_name}</div>
        </div>
        <div className="bg-card border border-border rounded-sm p-4">
          <div className="text-xs text-mutedForeground">Wealth</div>
          <div className="text-lg font-heading font-semibold text-foreground">
            <WealthRankWithTooltip wealthRankName={profile.wealth_rank_name} wealthRankRange={profile.wealth_rank_range} />
          </div>
        </div>
        <div className="bg-card border border-border rounded-sm p-4">
          <div className="text-xs text-mutedForeground">Kills</div>
          <div className="text-lg font-heading font-semibold text-foreground">{profile.kills}</div>
        </div>
        <div className="bg-card border border-border rounded-sm p-4">
          <div className="text-xs text-mutedForeground">Jail Busts</div>
          <div className="text-lg font-heading font-semibold text-foreground">{profile.jail_busts}</div>
        </div>
        <div className="bg-card border border-border rounded-sm p-4 md:col-span-2">
          <div className="text-xs text-mutedForeground">Account created</div>
          <div className="text-lg font-heading font-semibold text-foreground">{formatDateTime(profile.created_at)}</div>
        </div>
      </div>
    </div>
  );
}

