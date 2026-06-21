import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Users, User, Target, Building2, Plane, Factory, Mail, Radio, Clock, CalendarDays, CalendarRange, Skull, Trophy, Crown, Sparkles } from 'lucide-react';
import api from '../../utils/api';
import { warmProfilePrefetchFromUsername } from '../../utils/profileNavPrefetch';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { toast } from 'sonner';
import { HoverCard, HoverCardTrigger, HoverCardPortal, HoverCardContent } from "@/components/ui/hover-card";
import PrestigeBadge from '../../components/PrestigeBadge';
import CountryFlagThumb from '../../components/CountryFlagThumb';
import FamilyEmblem from '../../components/FamilyEmblem';
import styles from '../../styles/noir.module.css';
import { formatGameDateTime as formatDateTime } from '../../utils/gameDateTime';

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
  @keyframes uo-preview-enter { from { opacity: 0.65; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .uo-preview-enter { animation: uo-preview-enter 0.28s ease-out both; }
  @keyframes uo-preview-shimmer { 0% { opacity: 0.35; } 50% { opacity: 0.85; } 100% { opacity: 0.35; } }
  .uo-preview-shimmer { animation: uo-preview-shimmer 1.1s ease-in-out infinite; }
`;

const UO_PREVIEW_CACHE_MAX_MS = 55_000;

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

/** Sits on the same row as the big count (to the right), not stacked under the caption. */
function SnapshotCountryInline({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <span className="text-[7px] text-mutedForeground/75 font-heading leading-snug flex-1 min-w-0 self-center">
        Country % when location headers are present (e.g. Cloudflare).
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 flex-1 min-w-0 self-center pl-1.5 ml-0.5 border-l border-zinc-600/35">
      {rows.map((row, idx) => {
        const code = (row.code || '').trim();
        const label = countryDisplayName(code || undefined);
        const pct = Number(row.pct);
        const pctStr = Number.isFinite(pct) ? `${pct}%` : '—';
        return (
          <span
            key={`${code || 'unk'}-${idx}`}
            className="inline-flex items-center gap-1 text-[8px] font-heading text-foreground/90 tabular-nums leading-none"
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

const snapshotTile = (Icon, label, value, caption, accentClass, countryRows) => (
  <div
    className={`rounded-md border border-primary/15 bg-black/20 px-2 py-1.5 flex flex-col gap-0.5 min-h-[5.25rem] sm:min-h-[5.5rem] ${accentClass || ''}`}
  >
    <div className="flex items-center gap-1.5 text-mutedForeground">
      <Icon size={14} className="shrink-0 text-primary/85" aria-hidden />
      <span className="text-[9px] font-heading uppercase tracking-wide leading-tight">{label}</span>
    </div>
    {/* nowrap so the count never sits alone on a row above the flags; chips wrap inside the right column */}
    <div className="flex flex-nowrap items-center gap-x-2 mt-0.5 min-w-0">
      <div className="text-lg md:text-xl font-heading font-bold text-foreground tabular-nums leading-none shrink-0">
        {value}
      </div>
      <SnapshotCountryInline rows={countryRows} />
    </div>
    <div className="text-[9px] text-mutedForeground font-heading mt-auto pt-0.5">{caption}</div>
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
}) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 uo-card uo-fade-in mobile-panel`}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        Who&apos;s around
      </h2>
    </div>
    <div className="p-2">
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
    {staffUnknownFooter ? (
      <div className="px-2.5 pb-2 pt-0 border-t border-primary/15">{staffUnknownFooter}</div>
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

const RoleKey = ({ adminOnlineColor, modDefaultOnlineColor, hdoOnlineColor, hdoKeyColors, entertainerKeyColors }) => {
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';
  const modColor = (modDefaultOnlineColor && modDefaultOnlineColor.trim()) || DEFAULT_MOD_COLOR;
  const hdoColor = (hdoOnlineColor && hdoOnlineColor.trim()) || DEFAULT_HDO_COLOR;
  const hdoSwatchStyle = roleKeySwatchStyle(hdoKeyColors, hdoColor);
  const entertainerSwatchStyle = roleKeySwatchStyle(entertainerKeyColors, DEFAULT_ENTERTAINER_COLOR);
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
          <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={hdoSwatchStyle} aria-hidden />
          <span className="text-mutedForeground">Help Desk</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={entertainerSwatchStyle} aria-hidden />
          <span className="text-mutedForeground">Entertainer</span>
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

const UserCard = ({ user, profileCache, ensureProfilePreview, adminOnlineColor, modDefaultOnlineColor, profileHoverEnabled, myUsername }) => {
  const preview = profileCache[user.username];
  const isStub = !!preview?._stub;
  const adminColor = (adminOnlineColor && adminOnlineColor.trim()) || '#a78bfa';
  const modColor = (modDefaultOnlineColor && modDefaultOnlineColor.trim()) || DEFAULT_MOD_COLOR;
  const displayColor =
    user.online_color ||
    (user.is_admin ? adminColor : user.is_moderator ? modColor : user.is_entertainer ? DEFAULT_ENTERTAINER_COLOR : user.is_help_desk_operator ? DEFAULT_HDO_COLOR : undefined);
  const userStatus = user.status || 'online';
  const selfFromRoster =
    myUsername &&
    user.username &&
    String(user.username).toLowerCase() === String(myUsername).toLowerCase();
  const profileTo = selfFromRoster
    ? `/profile/${encodeURIComponent(user.username)}?view=public`
    : `/profile/${encodeURIComponent(user.username)}`;
  const linkClass = `relative z-10 inline-block max-w-[160px] truncate text-[11px] font-heading font-bold transition-colors ${displayColor ? '' : 'text-foreground hover:text-primary'}`;
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
      title={user.username}
      {...extra}
    >
      {user.username}
    </Link>
  );

  const showHitlistBanner = preview?.on_hitlist ?? user.on_hitlist;
  const showKills = preview && !isStub && typeof preview.kills === 'number';
  const showJail = preview && !isStub && typeof preview.jail_busts === 'number';
  const wealthColor = preview?.wealth_rank_color && String(preview.wealth_rank_color).trim() ? preview.wealth_rank_color : undefined;

  const hoverPreview = profileHoverEnabled ? (
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
      {user.prestige_level > 0 && (
        <span className="relative z-10">
          <PrestigeBadge level={user.prestige_level} size="sm" />
        </span>
      )}
      <HoverCardPortal>
        <HoverCardContent
          align="start"
          sideOffset={8}
          className={`z-[9999] w-[20rem] max-w-[92vw] ${styles.panel} border-2 border-primary/35 rounded-lg shadow-2xl p-0 overflow-hidden backdrop-blur-sm`}
        >
          {preview?.error ? (
            <div className="p-3 text-[10px] text-mutedForeground font-heading text-center">Couldn&apos;t load preview — tap name for full profile</div>
          ) : preview ? (
            <div className={isStub ? '' : 'uo-preview-enter'}>
              <div className="px-2.5 py-1.5 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-b border-primary/20 flex items-center justify-between gap-2">
                <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.14em]">Profile</h3>
                {!isStub && preview.prestige_level > 0 && (
                  <span className="text-[8px] font-heading text-mutedForeground uppercase tracking-wide truncate max-w-[9rem]">
                    {preview.prestige_name ? `${preview.prestige_name}` : `Prestige ${preview.prestige_level}`}
                  </span>
                )}
              </div>
              {showHitlistBanner && (
                <div className="px-2.5 py-1 bg-red-500/20 border-b border-red-500/30 flex items-center gap-1.5">
                  <Target size={12} className="text-red-400 shrink-0" aria-hidden />
                  <span className="text-[10px] font-heading font-bold text-red-400 uppercase">On the hitlist</span>
                </div>
              )}
              {preview.show_war_rat_badge && (
                <div className="px-2.5 py-1 bg-rose-500/15 border-b border-rose-500/25 flex items-center gap-1.5">
                  <span className="text-[10px] font-heading font-bold text-rose-300 uppercase">Rat</span>
                  <span className="text-[9px] text-mutedForeground font-heading">Crew war dodge (24h)</span>
                </div>
              )}
              <div className="p-2.5 space-y-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-12 h-12 rounded-lg overflow-hidden border-2 border-primary/30 bg-secondary flex items-center justify-center shrink-0 ring-1 ring-black/20 shadow-inner">
                    {preview.avatar_url ? (
                      <img src={preview.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User size={20} className="text-mutedForeground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-heading font-bold text-foreground text-[13px] truncate leading-tight">{preview.username}</span>
                      {preview.founding_member ? (
                        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-amber-500/40 bg-amber-500/15 text-[8px] font-heading font-bold uppercase tracking-wide text-amber-200 shrink-0">
                          <Crown size={10} className="text-amber-300" aria-hidden />
                          Founder
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-heading text-primary font-bold truncate">
                      <Trophy size={12} className="shrink-0 opacity-80" aria-hidden />
                      <span className="truncate">{preview.rank_name || user.rank_name || '—'}</span>
                    </div>
                    {!isStub && preview.wealth_rank_name ? (
                      <div className="flex items-center gap-1 text-[9px] font-heading font-semibold truncate" style={wealthColor ? { color: wealthColor } : undefined}>
                        <Sparkles size={11} className="shrink-0 opacity-70" aria-hidden />
                        <span className="truncate">{preview.wealth_rank_name}</span>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] font-heading text-mutedForeground">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${(preview.status || userStatus) === 'idle' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          aria-hidden
                        />
                        {(preview.status || userStatus) === 'idle' ? 'Idle' : 'Online'}
                      </span>
                      {(preview.in_jail ?? user.in_jail) ? (
                        <span className="text-red-400 font-bold uppercase">In jail</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border/60 bg-black/25 px-2 py-1.5">
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[10px] font-heading">
                    {isStub ? (
                      <>
                        <div className="h-3.5 rounded bg-zinc-700/45 uo-preview-shimmer col-span-2" />
                        <div className="h-3.5 rounded bg-zinc-700/45 uo-preview-shimmer col-span-2" />
                        <div className="h-3.5 rounded bg-zinc-700/45 uo-preview-shimmer col-span-2" />
                      </>
                    ) : (
                      <>
                        {showKills ? (
                          <div className="col-span-2 flex items-center justify-between gap-2">
                            <span className="text-mutedForeground inline-flex items-center gap-1">
                              <Skull size={12} className="opacity-70" aria-hidden />
                              Kills
                            </span>
                            <span className="text-foreground font-bold tabular-nums">{Number(preview.kills).toLocaleString()}</span>
                          </div>
                        ) : null}
                        {showJail ? (
                          <div className="col-span-2 flex items-center justify-between gap-2">
                            <span className="text-mutedForeground">Jail busts</span>
                            <span className="text-foreground font-bold tabular-nums">{Number(preview.jail_busts).toLocaleString()}</span>
                          </div>
                        ) : null}
                        {preview.kills === null && preview.jail_busts === null ? (
                          <div className="col-span-2 text-[9px] text-mutedForeground italic text-center py-0.5">
                            Kills & jail busts hidden on profile
                          </div>
                        ) : null}
                        <div className="col-span-2 flex items-center justify-between gap-2">
                          <span className="text-mutedForeground inline-flex items-center gap-1">
                            <Mail size={12} className="opacity-70" aria-hidden />
                            Messages
                          </span>
                          <span className="text-foreground font-bold tabular-nums">
                            {Number(preview.messages_sent ?? 0).toLocaleString()} / {Number(preview.messages_received ?? 0).toLocaleString()}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {(preview.family || preview.owns_casino || preview.property_type) && !isStub ? (
                  <div className="pt-1 border-t border-border/60 space-y-1.5 text-[10px] font-heading">
                    {preview.family ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-mutedForeground shrink-0">Family</span>
                        <div className="flex items-center gap-1.5 min-w-0 justify-end">
                          <FamilyEmblem
                            emblemPresetId={preview.family_emblem_preset_id}
                            avatarUrl={preview.family_emblem_avatar_url}
                            size={18}
                          />
                          <span className="text-foreground truncate text-right">{preview.family}</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5 justify-end">
                      {preview.owns_casino ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/12 border border-primary/25 text-foreground">
                          <Building2 size={12} className="text-primary/85" aria-hidden />
                          Casino
                        </span>
                      ) : null}
                      {preview.property_type === 'airport' ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/12 border border-primary/25 text-foreground">
                          <Plane size={12} className="text-primary/85" aria-hidden />
                          Airport
                        </span>
                      ) : null}
                      {preview.property_type === 'armoury' ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/12 border border-primary/25 text-foreground">
                          <Factory size={12} className="text-primary/85" aria-hidden />
                          Armoury
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <p className="text-[9px] text-mutedForeground/90 font-heading italic text-center pt-0.5">Click username for full dossier</p>
              </div>
            </div>
          ) : (
            <div className="p-3 text-[10px] text-mutedForeground font-heading text-center">Hover username to preview</div>
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
  const previewInflightRef = useRef(new Set());
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

  const staffUnknownFooter = useMemo(() => {
    const ok = !!(staffFlags?.is_admin || staffFlags?.is_moderator);
    if (!ok || unknownRosterCount <= 0) return null;
    return (
      <Link
        to="/tjjeujr3wa/users-online?unknown=1"
        className="inline-flex items-center gap-1 text-[9px] font-heading font-bold uppercase tracking-wide text-amber-400/95 hover:text-amber-300 border border-amber-500/35 rounded px-2 py-1 bg-amber-500/10"
      >
        Staff — who has unknown country? ({unknownRosterCount})
      </Link>
    );
  }, [staffFlags, unknownRosterCount]);

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

  const ensureProfilePreview = useCallback((username, rosterUser) => {
    const u = String(username || '').trim();
    if (!u) return;
    const key = u.toLowerCase();

    const cached = readCachedProfilePreview(u);
    if (cached) {
      setProfileCache((prev) => ({ ...prev, [u]: cached }));
    } else if (rosterUser) {
      setProfileCache((prev) => {
        if (prev[u] && !prev[u]._stub && !prev[u].error) return prev;
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
                    ensureProfilePreview={ensureProfilePreview}
                    adminOnlineColor={adminOnlineColor}
                    modDefaultOnlineColor={modDefaultOnlineColor}
                    profileHoverEnabled={profileHoverEnabled}
                    myUsername={myUsername}
                  />
                ))}
              </div>
          </div>
          <div className="uo-art-line text-primary mx-2.5" />
        </div>
      )}

      <InfoCard profileHoverEnabled={profileHoverEnabled} />

      <RoleKey
        adminOnlineColor={adminOnlineColor}
        modDefaultOnlineColor={modDefaultOnlineColor}
        hdoOnlineColor={hdoOnlineColor}
        hdoKeyColors={hdoKeyColors}
        entertainerKeyColors={entertainerKeyColors}
      />
    </div>
  );
}
