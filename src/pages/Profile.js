import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { User as UserIcon, Upload, Search, Shield, Trophy, Building2 } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import styles from '../styles/noir.module.css';

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
        <TooltipContent side="bottom" className={`${styles.surface} ${styles.textForeground} ${styles.borderGold} rounded-md px-3 py-2 text-sm font-heading shadow-lg`}>
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
        <div className="flex items-center justify-center flex-col gap-2 text-center">
          <div className="flex items-center gap-3 w-full justify-center">
            <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
            <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Profile</h1>
            <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
          </div>
        </div>
        <p className="text-mutedForeground font-heading text-center">Profile not found.</p>
      </div>
    );
  }

  const isRobotBodyguard = Boolean(profile.is_npc && profile.is_bodyguard);
  const avatarSrc = isRobotBodyguard ? null : (preview || profile.avatar_url || null);

  const profileRows = [
    { label: 'Username', value: profile.username, valueClass: 'text-foreground font-heading font-bold' },
    { label: 'Crew', value: profile.family_name || '—', valueClass: 'text-foreground font-heading', crew: true },
    { label: 'Rank', value: profile.rank_name, valueClass: 'text-primary font-heading font-bold underline decoration-dotted decoration-primary/50 underline-offset-2' },
    { label: 'Wealth', value: null, valueClass: 'text-emerald-500 font-heading', component: <WealthRankWithTooltip wealthRankName={profile.wealth_rank_name} wealthRankRange={profile.wealth_rank_range} /> },
    { label: 'Status', isStatus: true, isDead: profile.is_dead, isOnline: profile.online },
    { label: 'Messages', value: profile.messages_sent != null ? `${profile.messages_sent} sent / ${profile.messages_received ?? 0} received` : `${profile.messages_received ?? 0} received`, valueClass: 'text-foreground font-heading' },
    { label: 'Jailbusts', value: String(profile.jail_busts ?? 0), valueClass: 'text-foreground font-heading' },
    { label: 'Kills', value: String(profile.kills ?? 0), valueClass: 'text-foreground font-heading font-bold' },
  ];

  const honours = profile.honours || [];
  const ownedCasinos = profile.owned_casinos || [];

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="profile-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center mb-2">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-xl md:text-2xl font-heading font-bold text-primary uppercase tracking-wider">Profile</h1>
          <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden max-w-2xl mx-auto`}>
        {/* Header: username (large) + rank badge right */}
        <div className={`px-4 py-4 ${styles.surfaceMuted} border-b border-primary/20 flex items-center justify-between gap-3`}>
          <h2 className="flex-1 text-xl md:text-2xl font-heading font-bold text-foreground uppercase tracking-wider truncate" data-testid="profile-username">
            {profile.username}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-primary/30 ${styles.surface}`}>
              <Shield className="text-primary" size={18} />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-wider">{profile.rank_name || '—'}</span>
            </div>
            {!isMe && (
              <button
                type="button"
                onClick={addToAttackSearches}
                className={`inline-flex items-center justify-center h-9 w-9 rounded-sm border border-primary/30 ${styles.surface} ${styles.raisedHover} text-primary transition-smooth`}
                title="Add to Attack searches"
                aria-label="Add to Attack searches"
                data-testid="profile-add-to-search"
              >
                <Search size={16} />
              </button>
            )}
          </div>
        </div>

        {/* User info: label / value rows */}
        <div className="divide-y divide-primary/10">
          {profileRows.map((row) => (
            <div key={row.label} className={`grid grid-cols-12 gap-3 px-4 py-3 items-center ${row.crew ? 'border-l-2 border-primary/50 pl-4' : ''}`}>
              <div className="col-span-4 sm:col-span-3 text-left">
                <span className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-wider">{row.label}:</span>
              </div>
              <div className="col-span-8 sm:col-span-9 text-right">
                {row.component != null ? (
                  <span className={row.valueClass}>{row.component}</span>
                ) : row.isStatus ? (
                  <span className="font-heading">
                    {row.isDead && <span className="text-destructive">Dead (Offline)</span>}
                    {!row.isDead && row.isOnline && (
                      <>
                        <span className="text-foreground">Alive </span>
                        <span className="text-emerald-400">(Online)</span>
                      </>
                    )}
                    {!row.isDead && !row.isOnline && (
                      <span className="text-foreground">Alive (Offline)</span>
                    )}
                  </span>
                ) : (
                  <span className={row.valueClass}>{row.value}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {profile.is_npc && (
          <div className="px-4 py-2 border-t border-primary/10">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-heading font-bold ${styles.surface} border border-primary/10 text-mutedForeground`}>
              NPC
            </span>
          </div>
        )}
      </div>

      {/* Honours (leaderboard rankings) */}
      <div className={`${styles.panel} rounded-sm overflow-hidden max-w-2xl mx-auto`}>
        <div className="px-4 py-2.5 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-center gap-2">
          <Trophy className="text-primary shrink-0" size={18} />
          <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Honours ({honours.length})</h3>
        </div>
        <div className="p-4 flex flex-col items-center text-center">
          {honours.length === 0 ? (
            <p className="text-xs text-mutedForeground font-heading">No leaderboard rankings yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md justify-items-center">
              {honours.map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-sm font-heading w-full sm:max-w-[280px] rounded-sm border border-primary/20 px-3 py-2 bg-primary/5">
                  <span className="text-primary font-bold shrink-0">#{h.rank}</span>
                  <span className="text-foreground text-left flex-1">{h.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Properties: casinos owned (max bet, buyback) */}
      <div className={`${styles.panel} rounded-sm overflow-hidden max-w-2xl mx-auto`}>
        <div className="px-4 py-2.5 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-center gap-2">
          <Building2 className="text-primary shrink-0" size={18} />
          <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Properties</h3>
        </div>
        <div className="p-4 flex flex-col items-center text-center">
          {ownedCasinos.length === 0 ? (
            <p className="text-xs text-mutedForeground font-heading">No casinos owned.</p>
          ) : (
            <div className="flex flex-wrap gap-2 justify-center">
              {ownedCasinos.map((c, i) => (
                <div key={i} className={`rounded-sm border border-primary/30 px-3 py-2 ${styles.surface} min-w-0`}>
                  <div className="font-heading font-bold text-foreground text-sm">{c.city} Dice</div>
                  <div className="text-xs text-mutedForeground font-heading mt-0.5">
                    Max bet: <span className="text-primary font-bold">${Number(c.max_bet || 0).toLocaleString()}</span>
                    {c.buy_back_reward != null && c.buy_back_reward > 0 && (
                      <> · Buyback: <span className="text-primary font-bold">{Number(c.buy_back_reward).toLocaleString()} pts</span></>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!isMe && profile.admin_stats && (
        <div className={`${styles.panel} rounded-sm overflow-hidden max-w-2xl mx-auto border-2 border-primary/40`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Admin info</span>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm font-heading">
            <div>
              <span className="text-mutedForeground uppercase tracking-wider text-xs block">Cash</span>
              <span className="text-primary font-bold">${Number(profile.admin_stats.money ?? 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-mutedForeground uppercase tracking-wider text-xs block">Points</span>
              <span className="text-primary font-bold">{Number(profile.admin_stats.points ?? 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-mutedForeground uppercase tracking-wider text-xs block">Bullets</span>
              <span className="text-primary font-bold">{Number(profile.admin_stats.bullets ?? 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-mutedForeground uppercase tracking-wider text-xs block">Booze profit today</span>
              <span className="text-primary font-bold">${Number(profile.admin_stats.booze_profit_today ?? 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-mutedForeground uppercase tracking-wider text-xs block">Booze profit total</span>
              <span className="text-primary font-bold">${Number(profile.admin_stats.booze_profit_total ?? 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-mutedForeground uppercase tracking-wider text-xs block">Rank points</span>
              <span className="text-primary font-bold">{Number(profile.admin_stats.rank_points ?? 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-mutedForeground uppercase tracking-wider text-xs block">Location</span>
              <span className="text-foreground">{profile.admin_stats.current_state ?? '—'}</span>
            </div>
            <div>
              <span className="text-mutedForeground uppercase tracking-wider text-xs block">In jail</span>
              <span className={profile.admin_stats.in_jail ? 'text-red-400 font-bold' : 'text-foreground'}>{profile.admin_stats.in_jail ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Profile picture: large display + upload when own profile */}
      <div className={`${styles.panel} rounded-sm overflow-hidden max-w-2xl mx-auto`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-center gap-2">
          <div className="w-6 h-px bg-primary/50" />
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Profile picture</span>
          <div className="w-6 h-px bg-primary/50" />
        </div>
        <div className="p-4 flex flex-col items-center text-center">
          <div className="aspect-video max-h-64 w-full max-w-md mx-auto rounded-sm overflow-hidden border border-primary/20 bg-primary/5 flex items-center justify-center">
            {avatarSrc ? (
              <img src={avatarSrc} alt="" className="w-full h-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-mutedForeground">
                <UserIcon size={48} />
                <span className="text-xs font-heading">No picture</span>
              </div>
            )}
          </div>
          {isMe && (
            <div className="mt-4 flex flex-col sm:flex-row gap-3 items-center justify-center">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onPickFile(e.target.files?.[0])}
                className={`text-sm ${styles.input} border border-primary/20 rounded-sm px-2 py-1.5 focus:border-primary/50 focus:outline-none file:mr-2 file:bg-primary/20 file:text-primary file:border-0 file:rounded file:px-2 file:py-1 file:text-xs file:font-heading`}
                data-testid="avatar-file"
              />
              <button
                onClick={onUpload}
                disabled={!preview || uploading}
                className="inline-flex items-center gap-2 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider px-4 py-2 border border-yellow-600/50 transition-smooth disabled:opacity-50"
                data-testid="avatar-upload"
              >
                <Upload size={16} />
                {uploading ? 'Uploading...' : 'Upload picture'}
              </button>
            </div>
          )}
          {isMe && <p className="text-xs text-mutedForeground font-heading mt-2">You can upload a picture to your profile. Square images work best.</p>}
        </div>
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden max-w-2xl mx-auto`}>
        <div className={`px-4 py-2 ${styles.surfaceMuted} border-b border-primary/20 text-center`}>
          <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Account created</span>
        </div>
        <div className="px-4 py-3 text-foreground font-heading text-center">{formatDateTime(profile.created_at)}</div>
      </div>
    </div>
  );
}

