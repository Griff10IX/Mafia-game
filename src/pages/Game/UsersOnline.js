import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, User, Target, Building2, Plane, Factory, Mail, Radio, Clock, CalendarDays, CalendarRange } from 'lucide-react';
import api from '../../utils/api';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import { toast } from 'sonner';
import { HoverCard, HoverCardTrigger, HoverCardPortal, HoverCardContent } from "@/components/ui/hover-card";
import PrestigeBadge from '../../components/PrestigeBadge';
import FamilyEmblem from '../../components/FamilyEmblem';
import styles from '../../styles/noir.module.css';

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

let _regionNamesEn;
function countryDisplayName(code) {
  if (!code) return 'Unknown';
  try {
    _regionNamesEn = _regionNamesEn || new Intl.DisplayNames(['en'], { type: 'region' });
    return _regionNamesEn.of(code) || code;
  } catch {
    return code;
  }
}

function flagEmojiFromCountryCode(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const up = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
}

function SnapshotCountryLines({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <p className="text-[7px] text-mutedForeground/80 font-heading leading-tight mt-1 pt-1 border-t border-primary/10">
        Country % shown when requests send location (e.g. Cloudflare). Play a bit and refresh.
      </p>
    );
  }
  return (
    <ul className="mt-1 pt-1 border-t border-primary/10 space-y-0.5 max-h-[4.5rem] overflow-y-auto pr-0.5">
      {rows.map((row, idx) => {
        const code = row.code || '';
        const label = countryDisplayName(code || undefined);
        const flag = flagEmojiFromCountryCode(code) || '🏳️';
        const pct = Number(row.pct);
        const pctStr = Number.isFinite(pct) ? `${pct}%` : '—';
        return (
          <li
            key={`${code || 'unk'}-${idx}`}
            className="flex items-center gap-1 text-[7px] font-heading text-mutedForeground leading-tight"
            title={`${label} · ${row.count ?? 0} accounts`}
          >
            <span className="text-[10px] leading-none shrink-0" aria-hidden>{flag}</span>
            <span className="text-foreground/90 tabular-nums shrink-0 w-[26px]">{pctStr}</span>
            <span className="truncate min-w-0">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

const snapshotTile = (Icon, label, value, caption, accentClass, countryRows) => (
  <div
    className={`rounded-md border border-primary/15 bg-black/20 px-2 py-1.5 flex flex-col gap-0.5 min-h-[6.5rem] sm:min-h-[7rem] ${accentClass || ''}`}
  >
    <div className="flex items-center gap-1.5 text-mutedForeground">
      <Icon size={14} className="shrink-0 text-primary/85" aria-hidden />
      <span className="text-[9px] font-heading uppercase tracking-wide leading-tight">{label}</span>
    </div>
    <div className="text-lg md:text-xl font-heading font-bold text-foreground tabular-nums leading-none mt-0.5">
      {value}
    </div>
    <div className="text-[9px] text-mutedForeground font-heading">{caption}</div>
    <SnapshotCountryLines rows={countryRows} />
  </div>
);

const ActivitySnapshotCard = ({
  totalOnline,
  activeHour,
  activeDay,
  activeWeek,
  countriesRoster = [],
  countriesHour = [],
  countriesDay = [],
  countriesWeek = [],
}) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-card uo-fade-in mobile-panel`}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        Who&apos;s around
      </h2>
    </div>
    <div className="p-2">
      <p className="text-[9px] text-mutedForeground font-heading mb-2 leading-snug">
        Live list below; the tiles count anyone with <span className="text-foreground/90">last seen</span> in that window, or{' '}
        <span className="text-foreground/90">auto-rank on</span> (not idle), or <span className="text-foreground/90">forced online</span> — same idea as the roster (staff in ghost mode excluded).
        Flags use the last known country from your connection (usually Cloudflare).
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {snapshotTile(
          Radio,
          'Right now',
          totalOnline,
          'On live roster',
          'ring-1 ring-emerald-500/20 bg-emerald-500/5',
          countriesRoster,
        )}
        {snapshotTile(Clock, 'Past hour', activeHour, 'Accounts', undefined, countriesHour)}
        {snapshotTile(CalendarDays, 'Past day', activeDay, 'Accounts', undefined, countriesDay)}
        {snapshotTile(CalendarRange, 'Past week', activeWeek, 'Accounts', undefined, countriesWeek)}
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
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-fade-in mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Key</h3>
      </div>
      <div className="px-2.5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] font-heading">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0 bg-emerald-500" aria-hidden />
          <span className="text-mutedForeground">Online</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0 bg-amber-500" aria-hidden />
          <span className="text-mutedForeground">Idle</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: adminColor }} aria-hidden />
          <span className="text-mutedForeground">Admin</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: modColor }} aria-hidden />
          <span className="text-mutedForeground">Mod</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: hdoColor }} aria-hidden />
          <span className="text-mutedForeground">Help Desk</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Target size={12} className="text-red-400 shrink-0" aria-hidden />
          <span className="text-mutedForeground">Hitlist</span>
        </span>
      </div>
      <div className="uo-art-line text-primary mx-2.5" />
    </div>
  );
};

const UserCard = ({ user, profileCache, profileLoading, ensureProfilePreview, adminOnlineColor, modDefaultOnlineColor, profileHoverEnabled }) => {
  const preview = profileCache[user.username];
  const isLoading = !!profileLoading[user.username];
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';
  const modColor = (modDefaultOnlineColor && modDefaultOnlineColor.trim()) || DEFAULT_MOD_COLOR;
  const displayColor = user.online_color || (user.is_admin ? adminColor : user.is_moderator ? modColor : undefined);
  const userStatus = user.status || 'online';
  const profileTo = `/profile/${encodeURIComponent(user.username)}`;
  const linkClass = `relative z-10 text-[11px] font-heading font-bold transition-colors ${displayColor ? '' : 'text-foreground hover:text-primary'}`;

  const profileLink = (extra = {}) => (
    <Link
      to={profileTo}
      className={linkClass}
      style={displayColor ? { color: displayColor } : undefined}
      data-testid={`user-profile-link-${user.username}`}
      {...extra}
    >
      {user.username}
    </Link>
  );

  const hoverPreview = profileHoverEnabled ? (
    <HoverCard
      openDelay={0}
      closeDelay={100}
      onOpenChange={(open) => {
        if (open) ensureProfilePreview(user.username);
      }}
    >
      <HoverCardTrigger asChild>
        {profileLink({
          onPointerEnter: () => ensureProfilePreview(user.username),
        })}
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
              {preview.show_war_rat_badge && (
                <div className="px-2.5 py-1 bg-rose-500/15 border-b border-rose-500/25 flex items-center gap-1.5">
                  <span className="text-[10px] font-heading font-bold text-rose-300 uppercase">Rat</span>
                  <span className="text-[9px] text-mutedForeground font-heading">Left a crew during war (24h)</span>
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
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FamilyEmblem
                            emblemPresetId={preview.family_emblem_preset_id}
                            avatarUrl={preview.family_emblem_avatar_url}
                            size={18}
                          />
                          <span className="text-foreground truncate">{preview.family}</span>
                        </div>
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
  ) : (
    <>
      {profileLink()}
      {user.prestige_level > 0 && (
        <span className="relative z-10">
          <PrestigeBadge level={user.prestige_level} size="sm" />
        </span>
      )}
    </>
  );

  return (
    <div
      className={`relative z-10 ${styles.panel} rounded-md border px-2 py-1 h-7 md:h-8 flex items-center uo-row uo-card uo-fade-in ${user.on_hitlist ? 'uo-hitlist border-red-500/40' : 'border-primary/20'}`}
      data-testid="user-card"
    >
      <div className="flex items-center gap-1 min-h-[20px] w-full">
        <span 
          className={`w-2 h-2 rounded-full shrink-0 ${userStatus === 'idle' ? 'bg-amber-500' : 'bg-emerald-500'}`}
          title={userStatus === 'idle' ? 'Idle' : 'Online'}
          aria-hidden
        />
        {hoverPreview}
        
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

const InfoCard = ({ profileHoverEnabled = true }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
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
            <span className="text-emerald-400 font-bold">Online</span> = active within 5 min, <span className="text-amber-400 font-bold">Idle</span> = 5-10 min
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            Snapshot tiles count accounts with a recent <strong className="text-foreground">last seen</strong> (not the same as the live list).
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
            {profileHoverEnabled ? (
              <>
                <strong className="text-foreground">Hover</strong> over usernames for a quick profile preview
              </>
            ) : (
              <>
                <strong className="text-foreground">Tap</strong> a username to open their profile (hover preview is desktop only)
              </>
            )}
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

const UO_CACHE_KEY = 'mafia_users_online_v2';

// Main component
export default function UsersOnline() {
  const [bootCache] = useState(() => readSessionJson(UO_CACHE_KEY));
  const [totalOnline, setTotalOnline] = useState(() => bootCache?.total_online ?? 0);
  const [activeHour, setActiveHour] = useState(() => bootCache?.active_last_hour ?? 0);
  const [activeDay, setActiveDay] = useState(() => bootCache?.active_last_day ?? 0);
  const [activeWeek, setActiveWeek] = useState(() => bootCache?.active_last_week ?? 0);
  const [countriesRoster, setCountriesRoster] = useState(() => bootCache?.countries_roster ?? []);
  const [countriesHour, setCountriesHour] = useState(() => bootCache?.countries_hour ?? []);
  const [countriesDay, setCountriesDay] = useState(() => bootCache?.countries_day ?? []);
  const [countriesWeek, setCountriesWeek] = useState(() => bootCache?.countries_week ?? []);
  const [users, setUsers] = useState(() => (Array.isArray(bootCache?.users) ? bootCache.users : []));
  const [adminOnlineColor, setAdminOnlineColor] = useState(() => bootCache?.admin_online_color ?? '#a78bfa');
  const [modDefaultOnlineColor, setModDefaultOnlineColor] = useState(() => bootCache?.mod_default_online_color ?? DEFAULT_MOD_COLOR);
  const [hdoOnlineColor, setHdoOnlineColor] = useState(() => bootCache?.hdo_online_color ?? DEFAULT_HDO_COLOR);
  const [hasLoaded, setHasLoaded] = useState(() => !!bootCache);
  const [profileCache, setProfileCache] = useState({});
  const [profileLoading, setProfileLoading] = useState({});
  const [profileHoverEnabled, setProfileHoverEnabled] = useState(() =>
    typeof window !== 'undefined' ? !window.matchMedia('(max-width: 767px)').matches : true,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setProfileHoverEnabled(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const fetchOnlineUsers = useCallback(async (silent = false) => {
    try {
      const response = await api.get('/users/online');
      setTotalOnline(response.data.total_online);
      setActiveHour(response.data.active_last_hour ?? 0);
      setActiveDay(response.data.active_last_day ?? 0);
      setActiveWeek(response.data.active_last_week ?? 0);
      setCountriesRoster(Array.isArray(response.data.countries_roster) ? response.data.countries_roster : []);
      setCountriesHour(Array.isArray(response.data.countries_hour) ? response.data.countries_hour : []);
      setCountriesDay(Array.isArray(response.data.countries_day) ? response.data.countries_day : []);
      setCountriesWeek(Array.isArray(response.data.countries_week) ? response.data.countries_week : []);
      setUsers(response.data.users || []);
      if (response.data.admin_online_color != null) setAdminOnlineColor(response.data.admin_online_color);
      if (response.data.mod_default_online_color != null) setModDefaultOnlineColor(response.data.mod_default_online_color);
      if (response.data.hdo_online_color != null) setHdoOnlineColor(response.data.hdo_online_color);
      writeSessionJson(UO_CACHE_KEY, {
        total_online: response.data.total_online,
        active_last_hour: response.data.active_last_hour ?? 0,
        active_last_day: response.data.active_last_day ?? 0,
        active_last_week: response.data.active_last_week ?? 0,
        countries_roster: response.data.countries_roster ?? [],
        countries_hour: response.data.countries_hour ?? [],
        countries_day: response.data.countries_day ?? [],
        countries_week: response.data.countries_week ?? [],
        users: response.data.users || [],
        admin_online_color: response.data.admin_online_color,
        mod_default_online_color: response.data.mod_default_online_color,
        hdo_online_color: response.data.hdo_online_color,
      });
    } catch (error) {
      if (!silent) {
        toast.error('Failed to load online users');
        console.error('Error fetching online users:', error);
        setTotalOnline(0);
        setUsers([]);
      }
    } finally {
      setHasLoaded(true);
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
    const c = readSessionJson(UO_CACHE_KEY);
    fetchOnlineUsers(!!c);
    const interval = setInterval(() => fetchOnlineUsers(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchOnlineUsers]);

  // Refetch when tab/window gains focus so mod colour changes from Admin show up immediately
  useEffect(() => {
    const onFocus = () => fetchOnlineUsers(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchOnlineUsers]);

  if (!hasLoaded && !bootCache) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root`}>
        <style>{UO_STYLES}</style>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="users-online-page">
      <style>{UO_STYLES}</style>

      <div className="relative uo-fade-in">
        <p className="text-[9px] text-zinc-500 font-heading italic">
          {profileHoverEnabled
            ? "Who's active now — hover a name for an instant profile preview."
            : "Who's active now — tap a name to open their profile."}
        </p>
        <AutoRefreshNote seconds={30}>
          Automatically refreshes every 30 seconds, when you focus this window, and in the background.
        </AutoRefreshNote>
      </div>

      <ActivitySnapshotCard
        totalOnline={totalOnline}
        activeHour={activeHour}
        activeDay={activeDay}
        activeWeek={activeWeek}
        countriesRoster={countriesRoster}
        countriesHour={countriesHour}
        countriesDay={countriesDay}
        countriesWeek={countriesWeek}
      />

      {users.length === 0 ? (
        <div className={`relative ${styles.panel} rounded-md border border-primary/20 py-8 text-center uo-fade-in mobile-panel`} style={{ animationDelay: '0.03s' }} data-testid="no-users">
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
        <div className={`relative z-10 ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-fade-in mobile-panel`} style={{ animationDelay: '0.03s' }}>
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
                    profileHoverEnabled={profileHoverEnabled}
                  />
                ))}
              </div>
          </div>
          <div className="uo-art-line text-primary mx-2.5" />
        </div>
      )}

      <InfoCard profileHoverEnabled={profileHoverEnabled} />

      <RoleKey adminOnlineColor={adminOnlineColor} modDefaultOnlineColor={modDefaultOnlineColor} hdoOnlineColor={hdoOnlineColor} />
    </div>
  );
}
