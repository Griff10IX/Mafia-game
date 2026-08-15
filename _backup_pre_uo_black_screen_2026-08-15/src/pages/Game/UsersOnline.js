import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Users, Target, Radio, Clock, CalendarDays, CalendarRange } from 'lucide-react';
import api from '../../utils/api';
import { warmProfilePrefetchFromUsername } from '../../utils/profileNavPrefetch';
import { toast } from 'sonner';
import { HoverCard, HoverCardTrigger, HoverCardPortal, HoverCardContent } from "@/components/ui/hover-card";
import PrestigeBadge from '../../components/PrestigeBadge';
import CountryFlagThumb from '../../components/CountryFlagThumb';
import ProfileHoverPreview from '../../components/ProfileHoverPreview';
import styles from '../../styles/noir.module.css';
import {
  readUsersOnlineBoot,
  cacheUsersOnlineResponse,
} from '../../utils/usersOnlineWarm';

const UO_STYLES = `
  @keyframes uo-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .uo-fade-in { animation: uo-fade-in 0.35s ease-out both; }
  .uo-card { transition: background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease; }
  .uo-row { -webkit-tap-highlight-color: transparent; }
  @media (hover: hover) and (pointer: fine) {
    .uo-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.12); }
    .uo-row:hover { background: rgba(var(--noir-primary-rgb), 0.07); }
  }
  .uo-row:active { background: rgba(var(--noir-primary-rgb), 0.1); }
  @keyframes uo-hitlist-pulse {
    0%, 100% { box-shadow: 0 0 10px rgba(220, 38, 38, 0.35), inset 0 0 0 1px rgba(220, 38, 38, 0.22); }
    50% { box-shadow: 0 0 16px rgba(220, 38, 38, 0.55), inset 0 0 0 1px rgba(220, 38, 38, 0.4); }
  }
  .uo-hitlist {
    animation: uo-hitlist-pulse 2.2s ease-in-out infinite;
    box-shadow: 0 0 10px rgba(220, 38, 38, 0.35), inset 0 0 0 1px rgba(220, 38, 38, 0.22);
  }
  .uo-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  @keyframes uo-preview-enter { from { opacity: 0.72; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
  .uo-preview-enter { animation: uo-preview-enter 0.2s ease-out both; }
  @keyframes uo-preview-shimmer { 0% { opacity: 0.35; } 50% { opacity: 0.85; } 100% { opacity: 0.35; } }
  .uo-preview-shimmer { animation: uo-preview-shimmer 1.1s ease-in-out infinite; }
  .uo-users-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.35rem;
    align-items: center;
  }
  .uo-info details summary { list-style: none; cursor: pointer; }
  .uo-info details summary::-webkit-details-marker { display: none; }
  .uo-info details summary::after {
    content: '+';
    margin-left: auto;
    color: rgba(var(--noir-primary-rgb), 0.85);
    font-weight: 700;
    font-size: 12px;
  }
  .uo-info details[open] summary::after { content: '−'; }
  @media (prefers-reduced-motion: reduce) {
    .uo-preview-enter, .uo-preview-shimmer, .uo-hitlist, .uo-fade-in { animation: none !important; }
  }
`;

const UO_PREVIEW_CACHE_MAX_MS = 180_000;

function previewSessionKey(username) {
  return `mafia_uo_pv_${String(username || '').trim().toLowerCase()}`;
}

function readCachedProfilePreview(username) {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(previewSessionKey(username));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.ts !== 'number' || Date.now() - o.ts > UO_PREVIEW_CACHE_MAX_MS) return null;
    return o.data && typeof o.data === 'object' && !o.data.error ? o.data : null;
  } catch {
    return null;
  }
}

function writeCachedProfilePreview(username, data) {
  try {
    if (typeof window === 'undefined' || !data) return;
    window.sessionStorage.setItem(previewSessionKey(username), JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {
    /* quota */
  }
}

/** Instant panel from roster row while /profile-preview loads (same fields as online payload). */
function rosterPreviewStub(rosterUser) {
  const u = rosterUser?.username;
  if (!u) return null;
  return {
    _stub: true,
    username: u,
    avatar_url: rosterUser.avatar_url || null,
    rank_name: rosterUser.rank_name,
    prestige_level: rosterUser.prestige_level ?? 0,
    founding_member: !!rosterUser.founding_member,
    custom_profile_badge: !!rosterUser.custom_profile_badge,
    custom_profile_badge_url: rosterUser.custom_profile_badge_url || null,
    profile_cosmetic_active: !!rosterUser.profile_cosmetic_active,
    profile_name_glow_color: rosterUser.profile_name_glow_color || null,
    on_hitlist: !!rosterUser.on_hitlist,
    status: rosterUser.status,
    in_jail: !!rosterUser.in_jail,
  };
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

function SnapshotCountryInline({ rows, compact = false, max = 6 }) {
  if (!rows || rows.length === 0) {
    return compact ? null : (
      <span className="text-[7px] text-mutedForeground/75 font-heading leading-snug flex-1 min-w-0 self-center">
        Country % when location headers are present.
      </span>
    );
  }
  const shown = rows.slice(0, max);
  return (
    <div
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0 ${
        compact ? 'justify-start' : 'flex-1 self-center pl-1.5 ml-0.5 border-l border-zinc-600/35'
      }`}
    >
      {shown.map((row, idx) => {
        const code = (row.code || '').trim();
        const label = countryDisplayName(code || undefined);
        const pct = Number(row.pct);
        const pctStr = Number.isFinite(pct) ? `${pct}%` : '—';
        return (
          <span
            key={`${code || 'unk'}-${idx}`}
            className="inline-flex items-center gap-0.5 text-[8px] font-heading text-foreground/90 tabular-nums leading-none"
            title={`${label} · ${row.count ?? 0} accounts`}
          >
            <CountryFlagThumb code={code} />
            <span>{pctStr}</span>
          </span>
        );
      })}
    </div>
  );
}

const snapshotTile = (Icon, label, value, caption, accentClass, countryRows, { featured = false } = {}) => (
  <div
    className={`rounded-md border border-primary/15 bg-black/25 px-2.5 py-2 flex flex-col gap-1 ${
      featured ? 'min-h-0 sm:min-h-[5.5rem]' : 'min-h-[4.5rem] sm:min-h-[5.5rem]'
    } ${accentClass || ''}`}
  >
    <div className="flex items-center gap-1.5 text-mutedForeground">
      <Icon size={featured ? 15 : 13} className="shrink-0 text-primary/85" aria-hidden />
      <span className="text-[9px] font-heading uppercase tracking-wide leading-tight">{label}</span>
    </div>
    {featured ? (
      <>
        <div className="flex items-end justify-between gap-2 min-w-0">
          <div className="text-3xl font-heading font-bold text-foreground tabular-nums leading-none tracking-tight">
            {value}
          </div>
          <div className="text-[9px] text-mutedForeground font-heading text-right leading-tight shrink-0 pb-0.5">
            {caption}
          </div>
        </div>
        <SnapshotCountryInline rows={countryRows} compact max={8} />
      </>
    ) : (
      <>
        <div className="flex flex-nowrap items-center gap-x-2 min-w-0">
          <div className="text-lg md:text-xl font-heading font-bold text-foreground tabular-nums leading-none shrink-0">
            {value}
          </div>
          <SnapshotCountryInline rows={countryRows} max={4} />
        </div>
        <div className="text-[9px] text-mutedForeground font-heading mt-auto">{caption}</div>
      </>
    )}
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
  staffUnknownFooter = null,
  staffDupeScreenFooter = null,
}) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-card uo-fade-in mobile-panel`}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        Who&apos;s around
      </h2>
      <span className="text-[9px] font-heading text-mutedForeground tabular-nums">Live roster</span>
    </div>
    <div className="p-2 space-y-2">
      <div className="sm:hidden">
        {snapshotTile(
          Radio,
          'Right now',
          totalOnline,
          'On live roster',
          'ring-1 ring-emerald-500/25 bg-emerald-500/[0.07]',
          countriesRoster,
          { featured: true },
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2">
        <div className="hidden sm:block sm:col-span-1">
          {snapshotTile(
            Radio,
            'Right now',
            totalOnline,
            'On live roster',
            'ring-1 ring-emerald-500/20 bg-emerald-500/5',
            countriesRoster,
          )}
        </div>
        {snapshotTile(Clock, 'Past hour', activeHour, 'Accounts', undefined, countriesHour)}
        {snapshotTile(CalendarDays, 'Past day', activeDay, 'Accounts', undefined, countriesDay)}
        {snapshotTile(CalendarRange, 'Past week', activeWeek, 'Accounts', undefined, countriesWeek)}
      </div>
    </div>
    {(staffDupeScreenFooter || staffUnknownFooter) ? (
      <div className="px-2.5 pb-2 pt-2 border-t border-primary/15 flex flex-col gap-1.5">
        {staffDupeScreenFooter}
        {staffUnknownFooter}
      </div>
    ) : null}
    <div className="uo-art-line text-primary mx-2.5" />
  </div>
);

const DEFAULT_MOD_COLOR = '#1e3a5f';
const DEFAULT_HDO_COLOR = '#166534';
const DEFAULT_ENTERTAINER_COLOR = '#7c3aed';

function uniqueOnlineColorsForRole(users, predicate, fallbackHex) {
  const seen = new Set();
  const out = [];
  for (const u of users || []) {
    if (!predicate(u)) continue;
    const c = ((u.online_color || '').trim() || fallbackHex).replace(/\s/g, '');
    const k = c.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

function roleKeySwatchStyle(colors, emptyFallbackHex) {
  const list = Array.isArray(colors) ? colors : [];
  if (list.length === 0) return { backgroundColor: emptyFallbackHex };
  if (list.length === 1) return { backgroundColor: list[0] };
  return {
    background: `conic-gradient(from 0deg, ${list
      .map((c, i) => {
        const a = (i / list.length) * 360;
        const b = ((i + 1) / list.length) * 360;
        return `${c} ${a}deg ${b}deg`;
      })
      .join(', ')})`,
  };
}

const RoleKeyStrip = ({ adminOnlineColor, modDefaultOnlineColor, hdoOnlineColor, hdoKeyColors, entertainerKeyColors }) => {
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';
  const modColor = (modDefaultOnlineColor && modDefaultOnlineColor.trim()) || DEFAULT_MOD_COLOR;
  const hdoColor = (hdoOnlineColor && hdoOnlineColor.trim()) || DEFAULT_HDO_COLOR;
  const hdoSwatchStyle = roleKeySwatchStyle(hdoKeyColors, hdoColor);
  const entertainerSwatchStyle = roleKeySwatchStyle(entertainerKeyColors, DEFAULT_ENTERTAINER_COLOR);
  const item = (swatch, label) => (
    <span className="inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-heading text-mutedForeground whitespace-nowrap">
      {swatch}
      {label}
    </span>
  );
  return (
    <div className="px-2.5 py-1.5 border-b border-primary/15 bg-black/15 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {item(<span className="w-2 h-2 rounded-full shrink-0 bg-emerald-500" aria-hidden />, 'Online')}
      {item(<span className="w-2 h-2 rounded-full shrink-0 bg-amber-500" aria-hidden />, 'Idle')}
      {item(<span className="w-2 h-2 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: adminColor }} aria-hidden />, 'Admin')}
      {item(<span className="w-2 h-2 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: modColor }} aria-hidden />, 'Mod')}
      {item(<span className="w-2 h-2 rounded-full shrink-0 border border-white/20" style={hdoSwatchStyle} aria-hidden />, 'Help Desk')}
      {item(<span className="w-2 h-2 rounded-full shrink-0 border border-white/20" style={entertainerSwatchStyle} aria-hidden />, 'Entertainer')}
      {item(<Target size={11} className="text-red-400 shrink-0" aria-hidden />, 'Hitlist')}
      {item(<span className="text-[10px] font-heading font-normal text-zinc-500 leading-none" aria-hidden>Aa</span>, 'No family')}
    </div>
  );
};

const UserCard = ({ user, profileCache, ensureProfilePreview, adminOnlineColor, modDefaultOnlineColor, profileHoverEnabled, myUsername }) => {
  const preview = profileCache[user.username];
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';
  const modColor = (modDefaultOnlineColor && modDefaultOnlineColor.trim()) || DEFAULT_MOD_COLOR;
  // Staff role colours only (admin / mod / HDO / entertainer). Do not use
  // profile cosmetic name glow here — it reads like staff and confuses the roster.
  const isStaff =
    !!user.is_admin || !!user.is_moderator || !!user.is_help_desk_operator || !!user.is_entertainer;
  // Missing in_family (old cache) → treat as in-family so we don't falsely grey everyone.
  const inFamily = user.in_family == null ? true : !!user.in_family;
  const displayColor = isStaff
    ? user.online_color ||
      (user.is_admin
        ? adminColor
        : user.is_moderator
          ? modColor
          : user.is_entertainer
            ? DEFAULT_ENTERTAINER_COLOR
            : DEFAULT_HDO_COLOR)
    : undefined;
  const userStatus = user.status || 'online';
  const selfFromRoster =
    myUsername &&
    user.username &&
    String(user.username).toLowerCase() === String(myUsername).toLowerCase();
  const profileTo = selfFromRoster
    ? `/profile/${encodeURIComponent(user.username)}?view=public`
    : `/profile/${encodeURIComponent(user.username)}`;
  // Family members: bold white. Familyless (non-staff): non-bold muted grey.
  const linkClass = [
    'relative z-10 max-w-[7.5rem] sm:max-w-[9rem] truncate text-[11px] font-heading transition-colors',
    displayColor
      ? 'font-bold'
      : inFamily
        ? 'font-bold text-foreground hover:text-primary'
        : 'font-normal text-zinc-500 hover:text-zinc-300',
  ].join(' ');
  const nameTitle = inFamily || isStaff ? user.username : `${user.username} (no family)`;
  const prefetchFullProfile = () => warmProfilePrefetchFromUsername(user.username);

  const profileLink = (extra = {}) => (
    <Link
      to={profileTo}
      className={linkClass}
      style={displayColor ? { color: displayColor } : undefined}
      data-testid={`user-profile-link-${user.username}`}
      onPointerDown={prefetchFullProfile}
      onPointerEnter={prefetchFullProfile}
      onFocus={prefetchFullProfile}
      title={nameTitle}
      {...extra}
    >
      {user.username}
    </Link>
  );

  const previewCosmeticHex =
    (preview && !preview.error && preview.profile_cosmetic_active && preview.profile_name_glow_color) ||
    (user.profile_cosmetic_active && user.profile_name_glow_color) ||
    null;

  const prestigeBadge =
    user.prestige_level > 0 ? (
      <span className="relative z-10 shrink-0">
        <PrestigeBadge level={user.prestige_level} size="sm" />
      </span>
    ) : null;

  const hoverPreview = (
    <div className="flex items-center gap-0.5 min-w-0">
      {profileHoverEnabled ? (
        <HoverCard
          openDelay={0}
          closeDelay={120}
          onOpenChange={(open) => {
            if (open) {
              prefetchFullProfile();
              ensureProfilePreview(user.username, user);
            }
          }}
        >
          <HoverCardTrigger asChild>
            {profileLink({
              onPointerEnter: () => {
                prefetchFullProfile();
                ensureProfilePreview(user.username, user);
              },
            })}
          </HoverCardTrigger>
          <HoverCardPortal>
            <HoverCardContent
              align="start"
              sideOffset={8}
              className={`z-[9999] w-[20.5rem] max-w-[92vw] ${styles.panel} border-2 ${previewCosmeticHex ? '' : 'border-primary/40'} rounded-lg shadow-2xl p-0 overflow-hidden backdrop-blur-sm`}
              style={previewCosmeticHex ? {
                borderColor: `${previewCosmeticHex}b3`,
                boxShadow: `0 0 18px ${previewCosmeticHex}55, 0 25px 50px -12px rgba(0,0,0,0.65)`,
              } : undefined}
            >
              <ProfileHoverPreview preview={preview} userStatus={userStatus} />
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCard>
      ) : (
        profileLink()
      )}
      {prestigeBadge}
    </div>
  );

  return (
    <div
      className={`relative z-10 inline-flex items-center gap-1 rounded border px-1.5 h-7 max-w-full uo-row uo-card uo-fade-in ${user.on_hitlist ? 'uo-hitlist border-red-500/40' : 'border-primary/20 bg-black/25'}`}
      data-testid="user-card"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${userStatus === 'idle' ? 'bg-amber-500' : 'bg-emerald-500'}`}
        title={userStatus === 'idle' ? 'Idle' : 'Online'}
        aria-hidden
      />
      {hoverPreview}
      {user.in_jail && (
        <span className="shrink-0 inline-flex items-center px-1 py-px rounded text-[8px] font-heading font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30 leading-none">
          Jail
        </span>
      )}
      {user.on_hitlist && (
        <span className="shrink-0 inline-flex items-center text-red-400" title="On the hitlist">
          <Target size={11} className="drop-shadow-[0_0_6px_rgba(220,38,38,0.8)]" aria-hidden />
        </span>
      )}
    </div>
  );
};

const InfoCard = ({ profileHoverEnabled = true }) => (
  <div className={`uo-info relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <details className="group">
      <summary className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2 min-h-10">
        <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          How it works
        </h3>
      </summary>
      <div className="p-2.5">
        <div className="space-y-1.5 text-[10px] text-mutedForeground font-heading leading-snug">
          <p>
            Status updates every <strong className="text-foreground">30 seconds</strong>.
            {' '}
            <span className="text-emerald-400 font-bold">Online</span> = active within 5 min,
            {' '}
            <span className="text-amber-400 font-bold">Idle</span> = 5–10 min.
          </p>
          <p>
            Snapshot tiles count accounts with a recent <strong className="text-foreground">last seen</strong> (not the same as the live list).
          </p>
          <p>
            <strong className="text-foreground">Bold white</strong> names are in a family.
            {' '}
            <span className="text-zinc-500 font-normal">Grey</span> names have no family.
            Staff keep their coloured names either way.
          </p>
          <p>
            Search any user (including offline or dead) from the top bar.
            {' '}
            {profileHoverEnabled ? (
              <>
                <strong className="text-foreground">Hover</strong> a name for a quick profile preview.
              </>
            ) : (
              <>
                <strong className="text-foreground">Tap</strong> a name to open their profile.
              </>
            )}
          </p>
        </div>
      </div>
    </details>
  </div>
);

// Main component
export default function UsersOnline() {
  const [bootCache] = useState(() => readUsersOnlineBoot());
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
  const [hasLoaded, setHasLoaded] = useState(() => !!(bootCache && Array.isArray(bootCache.users)));
  const [profileCache, setProfileCache] = useState({});
  const profileCacheRef = useRef({});
  const previewInflightRef = useRef(new Set());
  profileCacheRef.current = profileCache;
  const [myUsername, setMyUsername] = useState(null);
  const [profileHoverEnabled, setProfileHoverEnabled] = useState(() =>
    typeof window !== 'undefined' ? !window.matchMedia('(max-width: 767px)').matches : true,
  );
  const [staffFlags, setStaffFlags] = useState(null);

  const hdoKeyColors = useMemo(
    () => uniqueOnlineColorsForRole(users, (u) => u.is_help_desk_operator, DEFAULT_HDO_COLOR),
    [users],
  );
  const entertainerKeyColors = useMemo(
    () => uniqueOnlineColorsForRole(users, (u) => u.is_entertainer, DEFAULT_ENTERTAINER_COLOR),
    [users],
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setProfileHoverEnabled(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/auth/me');
        if (!cancelled && res.data?.username) setMyUsername(res.data.username);
      } catch {
        if (!cancelled) setMyUsername(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/auth/staff-flags');
        if (!cancelled) setStaffFlags(res.data || null);
      } catch {
        if (!cancelled) setStaffFlags(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unknownRosterCount = useMemo(() => {
    const row = (countriesRoster || []).find((r) => !(String(r.code ?? '').trim()));
    return Number(row?.count) || 0;
  }, [countriesRoster]);

  const staffDupeScreenFooter = useMemo(() => {
    const ok = !!(staffFlags?.is_admin || staffFlags?.is_moderator);
    if (!ok) return null;
    return (
      <Link
        to="/tjjeujr3wa/users-online"
        className="inline-flex w-full items-center justify-center gap-1.5 text-[10px] font-heading font-bold uppercase tracking-wide text-red-300 hover:text-red-200 border border-red-500/40 rounded-md px-2.5 py-2.5 min-h-10 bg-red-500/10 tap-feedback touch-manipulation"
      >
        Staff — online dupe / proxy screen
      </Link>
    );
  }, [staffFlags]);

  const staffUnknownFooter = useMemo(() => {
    const ok = !!(staffFlags?.is_admin || staffFlags?.is_moderator);
    if (!ok || unknownRosterCount <= 0) return null;
    return (
      <Link
        to="/tjjeujr3wa/users-online?unknown=1"
        className="inline-flex w-full items-center justify-center gap-1 text-[9px] font-heading font-bold uppercase tracking-wide text-amber-400/95 hover:text-amber-300 border border-amber-500/35 rounded-md px-2 py-2 min-h-10 bg-amber-500/10 tap-feedback touch-manipulation"
      >
        Staff — unknown country ({unknownRosterCount})
      </Link>
    );
  }, [staffFlags, unknownRosterCount]);

  const fetchOnlineUsers = useCallback(async (silent = false) => {
    try {
      const response = await api.get('/users/online');
      const data = response.data || {};
      setTotalOnline(data.total_online);
      setActiveHour(data.active_last_hour ?? 0);
      setActiveDay(data.active_last_day ?? 0);
      setActiveWeek(data.active_last_week ?? 0);
      setCountriesRoster(Array.isArray(data.countries_roster) ? data.countries_roster : []);
      setCountriesHour(Array.isArray(data.countries_hour) ? data.countries_hour : []);
      setCountriesDay(Array.isArray(data.countries_day) ? data.countries_day : []);
      setCountriesWeek(Array.isArray(data.countries_week) ? data.countries_week : []);
      setUsers(data.users || []);
      if (data.admin_online_color != null) setAdminOnlineColor(data.admin_online_color);
      if (data.mod_default_online_color != null) setModDefaultOnlineColor(data.mod_default_online_color);
      if (data.hdo_online_color != null) setHdoOnlineColor(data.hdo_online_color);
      cacheUsersOnlineResponse(data);
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

  const ensureProfilePreview = useCallback((username, rosterUser) => {
    const u = String(username || '').trim();
    if (!u) return;
    const key = u.toLowerCase();

    const mem = profileCacheRef.current[u];
    if (mem && !mem._stub && !mem.error) return;

    const cached = readCachedProfilePreview(u);
    if (cached) {
      setProfileCache((prev) => ({ ...prev, [u]: cached }));
      return;
    }

    if (rosterUser) {
      setProfileCache((prev) => {
        if (prev[u] && !prev[u]._stub && !prev[u].error) return prev;
        if (prev[u]?._stub) return prev;
        const stub = rosterPreviewStub(rosterUser);
        return stub ? { ...prev, [u]: stub } : prev;
      });
    }

    if (previewInflightRef.current.has(key)) return;
    previewInflightRef.current.add(key);
    api
      .get(`/users/${encodeURIComponent(u)}/profile-preview`)
      .then((res) => {
        writeCachedProfilePreview(u, res.data);
        setProfileCache((prev) => ({ ...prev, [u]: res.data }));
      })
      .catch(() => {
        setProfileCache((prev) => ({ ...prev, [u]: { error: true } }));
      })
      .finally(() => {
        previewInflightRef.current.delete(key);
      });
  }, []);

  // Warm profile preview from session so hover stays snappy.
  useEffect(() => {
    if (!users.length) return;
    setProfileCache((prev) => {
      let next = null;
      for (const user of users) {
        const u = user?.username;
        if (!u) continue;
        if (prev[u] && !prev[u]._stub && !prev[u].error) continue;
        const cached = readCachedProfilePreview(u);
        if (!cached) continue;
        if (!next) next = { ...prev };
        next[u] = cached;
      }
      return next || prev;
    });
  }, [users]);

  useEffect(() => {
    const c = readUsersOnlineBoot();
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

  return (
    <div className={`space-y-2.5 ${styles.pageContent} mobile-page-root`} data-testid="users-online-page">
      <style>{UO_STYLES}</style>

      <ActivitySnapshotCard
        totalOnline={totalOnline}
        activeHour={activeHour}
        activeDay={activeDay}
        activeWeek={activeWeek}
        countriesRoster={countriesRoster}
        countriesHour={countriesHour}
        countriesDay={countriesDay}
        countriesWeek={countriesWeek}
        staffUnknownFooter={staffUnknownFooter}
        staffDupeScreenFooter={staffDupeScreenFooter}
      />

      {!hasLoaded && users.length === 0 ? (
        <div className={`relative ${styles.panel} rounded-md border border-primary/20 py-8 text-center uo-fade-in mobile-panel`} style={{ animationDelay: '0.03s' }} data-testid="users-online-loading">
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <Users size={36} className="mx-auto text-primary/30 mb-2 animate-pulse" />
          <p className="text-[12px] text-foreground font-heading font-bold mb-0.5">
            Loading online users…
          </p>
          <p className="text-[10px] text-mutedForeground font-heading">
            Pulling the live roster
          </p>
        </div>
      ) : users.length === 0 ? (
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
        <div className={`relative z-10 ${styles.panel} rounded-md border border-primary/20 uo-fade-in mobile-panel overflow-hidden`} style={{ animationDelay: '0.03s' }}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
            <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
              Active users
            </h2>
            <span className="text-[11px] font-heading font-bold text-foreground tabular-nums">
              {users.length}
            </span>
          </div>
          <RoleKeyStrip
            adminOnlineColor={adminOnlineColor}
            modDefaultOnlineColor={modDefaultOnlineColor}
            hdoOnlineColor={hdoOnlineColor}
            hdoKeyColors={hdoKeyColors}
            entertainerKeyColors={entertainerKeyColors}
          />
          <div className="p-1.5 sm:p-2">
            <div className="uo-users-grid" data-testid="users-grid">
              {users.map((user, idx) => (
                <UserCard
                  key={user.username || `user-${idx}`}
                  user={user}
                  profileCache={profileCache}
                  ensureProfilePreview={ensureProfilePreview}
                  adminOnlineColor={adminOnlineColor}
                  modDefaultOnlineColor={modDefaultOnlineColor}
                  profileHoverEnabled={profileHoverEnabled}
                  myUsername={myUsername}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <InfoCard profileHoverEnabled={profileHoverEnabled} />
    </div>
  );
}
