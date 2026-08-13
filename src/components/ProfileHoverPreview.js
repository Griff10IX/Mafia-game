import { User, Target, Building2, Plane, Factory, Mail, Skull, Trophy, Crown, Sparkles } from 'lucide-react';
import FamilyEmblem from './FamilyEmblem';
import styles from '../styles/noir.module.css';

/**
 * Hover dossier card for Users Online (and similar).
 * Expects preview from /users/:username/profile-preview or a roster stub ({ _stub: true }).
 */
export default function ProfileHoverPreview({ preview, userStatus = 'online' }) {
  if (!preview) {
    return (
      <div className="p-3 text-[10px] text-mutedForeground font-heading text-center">
        Hover username to preview
      </div>
    );
  }
  if (preview.error) {
    return (
      <div className="p-3 text-[10px] text-mutedForeground font-heading text-center">
        Couldn&apos;t load preview — tap name for full profile
      </div>
    );
  }

  const isStub = !!preview._stub;
  const status = preview.status || userStatus;
  const wealthColor =
    preview.wealth_rank_color && String(preview.wealth_rank_color).trim()
      ? preview.wealth_rank_color
      : undefined;
  const cosmeticGlowHex = preview.profile_cosmetic_active
    ? (preview.profile_name_glow_color || null)
    : null;
  const showKills = !isStub && typeof preview.kills === 'number';
  const showJail = !isStub && typeof preview.jail_busts === 'number';
  const killsHidden = !isStub && preview.kills === null && preview.jail_busts === null;

  return (
    <div className={isStub ? undefined : 'uo-preview-enter'}>
      {preview.on_hitlist ? (
        <div className="px-3 py-1 bg-red-500/15 border-b border-red-500/30 flex items-center gap-1.5">
          <Target size={11} className="text-red-400 shrink-0" aria-hidden />
          <span className="text-[9px] font-heading font-bold text-red-400 uppercase tracking-wider">
            On the hitlist
          </span>
        </div>
      ) : null}
      {preview.show_war_rat_badge ? (
        <div className="px-3 py-1 bg-rose-500/12 border-b border-rose-500/25 flex items-center gap-1.5">
          <span className="text-[9px] font-heading font-bold text-rose-300 uppercase tracking-wider">Rat</span>
          <span className="text-[9px] text-mutedForeground font-heading">Crew war dodge</span>
        </div>
      ) : null}

      <div className="p-3 space-y-2.5">
        <div className="flex items-start gap-3">
          <div
            className={`w-14 h-14 rounded-lg overflow-hidden border-2 bg-secondary flex items-center justify-center shrink-0 shadow-inner ${
              cosmeticGlowHex ? '' : 'border-primary/35'
            }`}
            style={cosmeticGlowHex ? { borderColor: `${cosmeticGlowHex}aa` } : undefined}
          >
            {preview.avatar_url ? (
              <img
                src={preview.avatar_url}
                alt=""
                width={56}
                height={56}
                decoding="async"
                className="w-full h-full object-cover"
              />
            ) : (
              <User size={22} className="text-mutedForeground" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="font-heading font-bold text-[14px] truncate leading-tight text-primary"
                style={
                  cosmeticGlowHex
                    ? { color: cosmeticGlowHex, textShadow: `0 0 10px ${cosmeticGlowHex}77` }
                    : undefined
                }
              >
                {preview.username}
              </span>
              {preview.custom_profile_badge ? (
                preview.custom_profile_badge_url ? (
                  <img
                    src={preview.custom_profile_badge_url}
                    alt=""
                    title="Custom badge"
                    width={16}
                    height={16}
                    decoding="async"
                    className="h-4 w-4 rounded object-cover border border-violet-500/40 shrink-0"
                  />
                ) : (
                  <span className="inline-flex items-center px-1 py-0.5 rounded border border-violet-500/40 bg-violet-500/15 text-[8px] font-heading font-bold uppercase tracking-wide text-violet-200 shrink-0">
                    Custom
                  </span>
                )
              ) : null}
              {preview.founding_member ? (
                <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-amber-500/45 bg-amber-500/12 text-[8px] font-heading font-bold uppercase tracking-wide text-amber-200 shrink-0">
                  <Crown size={10} className="text-amber-300" aria-hidden />
                  Founder
                </span>
              ) : null}
              {preview.modkill_wipe || (preview.badges || []).includes('Modkilled') ? (
                <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-red-500/50 bg-red-500/20 text-[8px] font-heading font-bold uppercase tracking-wide text-red-200 shrink-0">
                  <Skull size={10} className="text-red-300" aria-hidden />
                  Modkilled
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5 text-[11px] font-heading font-semibold truncate">
              <Trophy size={12} className="shrink-0 text-primary/80" aria-hidden />
              <span className="truncate text-primary">{preview.rank_name || '—'}</span>
            </div>

            {!isStub && preview.wealth_rank_name ? (
              <div
                className="flex items-center gap-1.5 text-[10px] font-heading font-semibold truncate"
                style={wealthColor ? { color: wealthColor } : undefined}
              >
                <Sparkles size={11} className="shrink-0 opacity-75" aria-hidden />
                <span className="truncate">{preview.wealth_rank_name}</span>
              </div>
            ) : isStub ? (
              <div className="h-3 w-24 rounded bg-zinc-700/40 uo-preview-shimmer" />
            ) : null}

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] font-heading text-mutedForeground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'idle' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  aria-hidden
                />
                {status === 'idle' ? 'Idle' : 'Online'}
              </span>
              {preview.in_jail ? (
                <span className="text-red-400 font-bold uppercase tracking-wide text-[9px]">In jail</span>
              ) : null}
              {!isStub && preview.prestige_level > 0 ? (
                <span className="text-[9px] uppercase tracking-wide truncate max-w-[8rem]">
                  {preview.prestige_name || `Prestige ${preview.prestige_level}`}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className={`${styles.surface} rounded-md border border-primary/15 px-2.5 py-2`}>
          <div className="space-y-1.5 text-[11px] font-heading">
            {isStub ? (
              <>
                <div className="h-3.5 rounded bg-zinc-700/40 uo-preview-shimmer" />
                <div className="h-3.5 rounded bg-zinc-700/40 uo-preview-shimmer" />
                <div className="h-3.5 rounded bg-zinc-700/40 uo-preview-shimmer" />
              </>
            ) : (
              <>
                {showKills ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-mutedForeground inline-flex items-center gap-1.5">
                      <Skull size={12} className="opacity-70" aria-hidden />
                      Kills
                    </span>
                    <span className="text-foreground font-bold tabular-nums">
                      {Number(preview.kills).toLocaleString()}
                    </span>
                  </div>
                ) : null}
                {showJail ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-mutedForeground">Jail busts</span>
                    <span className="text-foreground font-bold tabular-nums">
                      {Number(preview.jail_busts).toLocaleString()}
                    </span>
                  </div>
                ) : null}
                {killsHidden ? (
                  <div className="text-[9px] text-mutedForeground italic text-center py-0.5">
                    Kills &amp; jail busts hidden
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-mutedForeground inline-flex items-center gap-1.5">
                    <Mail size={12} className="opacity-70" aria-hidden />
                    Messages
                  </span>
                  <span className="text-foreground font-bold tabular-nums">
                    {Number(preview.messages_sent ?? 0).toLocaleString()}
                    {' / '}
                    {Number(preview.messages_received ?? 0).toLocaleString()}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {(preview.family || preview.owns_casino || preview.property_type) && !isStub ? (
          <div className="pt-0.5 space-y-1.5 text-[11px] font-heading">
            {preview.family ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-mutedForeground shrink-0">Family</span>
                <div className="flex items-center gap-1.5 min-w-0 justify-end">
                  <FamilyEmblem
                    emblemPresetId={preview.family_emblem_preset_id}
                    avatarUrl={preview.family_emblem_avatar_url}
                    size={18}
                  />
                  <span className="text-foreground truncate text-right font-semibold">{preview.family}</span>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              {preview.owns_casino ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/25 bg-primary/10 text-[9px] text-foreground">
                  <Building2 size={11} className="text-primary" aria-hidden />
                  Casino
                </span>
              ) : null}
              {preview.property_type === 'airport' ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/25 bg-primary/10 text-[9px] text-foreground">
                  <Plane size={11} className="text-primary" aria-hidden />
                  Airport
                </span>
              ) : null}
              {preview.property_type === 'armoury' ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/25 bg-primary/10 text-[9px] text-foreground">
                  <Factory size={11} className="text-primary" aria-hidden />
                  Armoury
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="text-[9px] text-mutedForeground/80 font-heading italic text-center pt-0.5 border-t border-primary/10">
          Click username for full dossier
        </p>
      </div>
    </div>
  );
}
