import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { User as UserIcon, Upload, Search, Shield, Trophy, Building2, Mail, Skull, Users as UsersIcon, Ghost, Settings, Plane, Factory, DollarSign, MessageCircle } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import styles from '../styles/noir.module.css';

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
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = ({ username, isMe, onOpenSettings }) => (
  <div>
    <div className="flex items-center justify-between gap-3 mb-1 md:mb-2">
      <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary flex items-center gap-3">
        <UserIcon className="w-8 h-8 md:w-10 md:h-10" />
        Profile
      </h1>
      {isMe && onOpenSettings && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenSettings}
                className="p-2 rounded-md text-mutedForeground hover:text-primary hover:bg-primary/10 border border-transparent hover:border-primary/30 transition-colors"
                aria-label="Profile settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>Profile settings</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
    <p className="text-sm text-mutedForeground">
      {username ? `Viewing ${username}'s profile` : 'User profile'}
    </p>
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
          className="bg-card border-2 border-primary/30 rounded-md px-3 py-2 text-sm font-heading text-foreground shadow-xl"
        >
          {rangeStr}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const ProfileInfoCard = ({ profile, isMe, onAddToSearch, onSendMessage, onSendMoney }) => {
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
      valueClass: 'text-foreground font-heading text-xs md:text-sm' 
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

  return (
    <div className="bg-card rounded-md overflow-hidden border border-primary/20">
      <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-3">
        <h2 className="text-base md:text-lg font-heading font-bold text-primary uppercase tracking-wider truncate">
          {profile.username}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-primary/50 bg-primary/20">
            <Shield className="text-primary" size={16} />
            <span className="text-xs font-heading font-bold text-primary uppercase">
              {profile.rank_name || '—'}
            </span>
          </div>
          {!isMe && (
            <>
              <button
                type="button"
                onClick={onAddToSearch}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-primary/30 bg-secondary hover:bg-secondary/80 hover:border-primary/50 text-primary transition-all active:scale-95"
                title="Add to Attack searches"
                aria-label="Add to Attack searches"
                data-testid="profile-add-to-search"
              >
                <Search size={16} />
              </button>
              {profile.id && (
                <button
                  type="button"
                  onClick={() => onSendMessage?.()}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-primary/30 bg-secondary hover:bg-secondary/80 hover:border-primary/50 text-primary transition-all active:scale-95"
                  title="Send message"
                  aria-label="Send message"
                >
                  <MessageCircle size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => onSendMoney?.()}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-primary/30 bg-secondary hover:bg-secondary/80 hover:border-primary/50 text-primary transition-all active:scale-95"
                title="Send money"
                aria-label="Send money"
              >
                <DollarSign size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="divide-y divide-border">
        {profileRows.map((row) => {
          const Icon = row.icon;
          return (
            <div 
              key={row.label} 
              className={`grid grid-cols-12 gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors ${
                row.highlight ? 'border-l-4 border-l-primary/50' : ''
              }`}
            >
              <div className="col-span-5 sm:col-span-4 flex items-center gap-2">
                {Icon && <Icon size={16} className="text-primary/60 shrink-0" />}
                <span className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-wider">
                  {row.label}
                </span>
              </div>
              <div className="col-span-7 sm:col-span-8 text-right flex items-center justify-end">
                {row.component != null ? (
                  row.component
                ) : row.isStatus ? (
                  <span className="font-heading text-sm">
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
                ) : (
                  <span className={row.valueClass}>{row.value}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {profile.is_npc && (
        <div className="px-4 py-2 border-t border-border bg-secondary/20">
          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs uppercase tracking-wider font-heading font-bold bg-secondary text-mutedForeground border border-border">
            🤖 NPC
          </span>
        </div>
      )}
    </div>
  );
};

const HonoursCard = ({ honours }) => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center justify-center gap-2">
        <Trophy size={16} />
        Honours ({honours.length})
      </h3>
    </div>
    <div className="p-4">
      {honours.length === 0 ? (
        <div className="text-center py-8">
          <Trophy size={48} className="mx-auto text-primary/30 mb-3" />
          <p className="text-sm text-mutedForeground font-heading">
            No leaderboard rankings yet
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {honours.map((h, i) => (
            <div 
              key={i} 
              className="flex items-center gap-3 rounded-md border border-primary/20 px-4 py-3 bg-primary/5 hover:bg-primary/10 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 border border-primary/30 shrink-0">
                <span className="text-primary font-heading font-bold text-sm">
                  #{h.rank}
                </span>
              </div>
              <span className="text-foreground font-heading text-sm flex-1">
                {h.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

const PropertiesCard = ({ ownedCasinos, property, isOwner }) => {
  const hasCasinos = ownedCasinos?.length > 0;
  const hasProperty = property && (property.type === 'airport' || property.type === 'bullet_factory');
  const isEmpty = !hasCasinos && !hasProperty;

  return (
    <div className="bg-card rounded-md overflow-hidden border border-primary/20">
      <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
        <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center justify-center gap-2">
          <Building2 size={16} />
          Properties
        </h3>
      </div>
      <div className="p-4">
        {isEmpty ? (
          <div className="text-center py-8">
            <Building2 size={48} className="mx-auto text-primary/30 mb-3" />
            <p className="text-sm text-mutedForeground font-heading">
              No casinos or properties owned
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {hasCasinos && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ownedCasinos.map((c, i) => {
                  const typeLabel = c.type === 'dice' ? 'Dice' : c.type === 'roulette' ? 'Roulette' : c.type === 'blackjack' ? 'Blackjack' : c.type === 'horseracing' ? 'Horse Racing' : c.type || 'Casino';
                  const typeEmoji = c.type === 'dice' ? '🎲' : c.type === 'roulette' ? '🎡' : c.type === 'blackjack' ? '🃏' : c.type === 'horseracing' ? '🏇' : '🎰';
                  return (
                    <div key={`${c.type}-${c.city}-${i}`} className="rounded-md border border-primary/20 px-4 py-3 bg-secondary/50 hover:bg-secondary/70 transition-colors flex items-center gap-3">
                      <span className="text-2xl shrink-0" aria-hidden>{typeEmoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-heading font-bold text-foreground text-base">
                          {c.city} {typeLabel}
                        </div>
                        <div className="space-y-1 text-sm font-heading mt-1">
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
              <div className="rounded-md border border-primary/20 px-4 py-3 bg-secondary/50 hover:bg-secondary/70 transition-colors flex items-center gap-3">
                <Plane size={24} className="text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-heading font-bold text-foreground text-base">
                    ✈️ Airport — {property.state ?? '—'} (Slot {property.slot ?? 1})
                  </div>
                  <div className="space-y-1 text-sm font-heading mt-1">
                    <div className="flex justify-between gap-2">
                      <span className="text-mutedForeground">Price per travel:</span>
                      <span className="text-primary font-bold">{Number(property.price_per_travel ?? 0).toLocaleString()} pts</span>
                    </div>
                    {isOwner && property.total_earnings != null && (
                      <div className="flex justify-between gap-2">
                        <span className="text-mutedForeground">Total earnings:</span>
                        <span className="text-primary font-bold">{Number(property.total_earnings).toLocaleString()} pts</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {property?.type === 'bullet_factory' && (
              <div className="rounded-md border border-primary/20 px-4 py-3 bg-secondary/50 hover:bg-secondary/70 transition-colors flex items-center gap-3">
                <Factory size={24} className="text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-heading font-bold text-foreground text-base">
                    Bullet factory — {property.state ?? '—'}
                  </div>
                  {property.price_per_bullet != null && (
                    <div className="text-sm font-heading mt-1">
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
    </div>
  );
};

const AdminStatsCard = ({ adminStats }) => (
  <div className="bg-card rounded-md overflow-hidden border-2 border-primary/40 shadow-lg shadow-primary/10">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest text-center">
        🔐 Admin Info
      </h3>
    </div>
    <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
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
        <div key={stat.label} className="space-y-1">
          <div className="text-xs text-mutedForeground font-heading uppercase tracking-wider">
            {stat.label}
          </div>
          <div className={`text-sm font-heading font-bold ${
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
  </div>
);

const AvatarCard = ({ 
  avatarSrc, 
  isMe, 
  preview, 
  uploading, 
  onPickFile, 
  onUpload 
}) => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest text-center">
        📸 Profile Picture
      </h3>
    </div>
    <div className="p-4 space-y-4">
      <div className="aspect-video max-h-64 w-full max-w-lg mx-auto rounded-md overflow-hidden border-2 border-primary/20 bg-secondary/20 flex items-center justify-center">
        {avatarSrc ? (
          <img src={avatarSrc} alt="Profile" className="w-full h-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-mutedForeground">
            <UserIcon size={64} className="text-primary/30" />
            <span className="text-sm font-heading">No picture uploaded</span>
          </div>
        )}
      </div>
      
      {isMe && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onPickFile(e.target.files?.[0])}
              className="text-sm bg-input border border-border rounded-md px-3 py-2 focus:border-primary/50 focus:outline-none file:mr-2 file:bg-primary/20 file:text-primary file:border-0 file:rounded-md file:px-3 file:py-1 file:text-xs file:font-heading file:font-bold file:cursor-pointer cursor-pointer transition-colors"
              data-testid="avatar-file"
            />
            <button
              onClick={onUpload}
              disabled={!preview || uploading}
              className="w-full sm:w-auto bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg font-heading font-bold uppercase tracking-wide px-6 py-2.5 text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-2 touch-manipulation"
              data-testid="avatar-upload"
            >
              <Upload size={16} />
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
          <p className="text-xs text-mutedForeground font-heading italic text-center">
            💡 Square images work best. File will be automatically resized.
          </p>
        </div>
      )}
    </div>
  </div>
);

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
  useEffect(() => {
    if (settingsOpen && isMe) fetchPrefs();
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
        <PageHeader username={null} />
        <div className="bg-card rounded-md border border-border py-16 text-center">
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
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="profile-page">
      <PageHeader username={profile.username} isMe={isMe} onOpenSettings={openSettings} />

      <div className="max-w-3xl mx-auto space-y-4 md:space-y-6">
        <ProfileInfoCard 
          profile={profile} 
          isMe={isMe} 
          onAddToSearch={addToAttackSearches}
          onSendMessage={profile.id ? () => navigate(`/inbox/chat/${profile.id}`) : undefined}
          onSendMoney={() => navigate('/bank', { state: { transferTo: profile.username } })}
        />

        {isMe && hasAdminEmail && (
          <>
            {isAdmin && (
              <div className="bg-card rounded-md overflow-hidden border-2 border-primary/30">
                <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Ghost className="w-5 h-5 text-primary" />
                    <span className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Admin ghost mode</span>
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
                <p className="px-4 py-2 text-xs text-mutedForeground font-heading">
                  When on, you won&apos;t appear in the online list or as &quot;Online&quot; on your profile.
                </p>
              </div>
            )}
            <div className="bg-card rounded-md overflow-hidden border-2 border-primary/30">
              <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  <span className="text-sm font-heading font-bold text-primary uppercase tracking-wider">
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
              <p className="px-4 py-2 text-xs text-mutedForeground font-heading">
                {me?.admin_acting_as_normal
                  ? 'Admin powers are off. Turn on to access Admin page and admin-only actions.'
                  : 'Turn off to test the game as a normal user (e.g. with others).'}
              </p>
            </div>
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <HonoursCard honours={honours} />
          <PropertiesCard ownedCasinos={ownedCasinos} property={profile.property} isOwner={isMe} />
        </div>

        {!isMe && profile.admin_stats && (
          <AdminStatsCard adminStats={profile.admin_stats} />
        )}

        <AvatarCard
          avatarSrc={avatarSrc}
          isMe={isMe}
          preview={preview}
          uploading={uploading}
          onPickFile={onPickFile}
          onUpload={onUpload}
        />

        <div className="bg-card rounded-md overflow-hidden border border-border">
          <div className="px-4 py-2.5 bg-secondary/30 border-b border-border text-center">
            <span className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-wider">
              Account Created
            </span>
          </div>
          <div className="px-4 py-3 text-foreground font-heading text-sm text-center">
            {formatDateTime(profile.created_at)}
          </div>
        </div>
      </div>

      {isMe && (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-md bg-card border-primary/20">
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
