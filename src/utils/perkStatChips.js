import { Zap } from 'lucide-react';

/** Format helpers for token perk lifetime chips (Inventory + My Stats). */
export const fmtPerkMoney = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;
export const fmtPerkNum = (n) => Number(n || 0).toLocaleString('en-US');
export const fmtPerkDuration = (secs) => {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export const formatPerkChipValue = (format, v) => {
  if (format === 'money') return fmtPerkMoney(v);
  if (format === 'rp') return `+${fmtPerkNum(v)} RP`;
  if (format === 'points') return `${fmtPerkNum(v)} pts`;
  if (format === 'dur') return fmtPerkDuration(v);
  return fmtPerkNum(v);
};

export const PERK_CHIP_VALUE_CLASS = {
  money: 'text-emerald-300',
  rp: 'text-violet-300',
  points: 'text-amber-300',
  dur: 'text-sky-300',
  num: 'text-foreground',
};

/** Lifetime stat chips per token type — fields from users.token_perk_stats. */
export const PERK_STAT_CHIPS = {
  xp_crimes: [
    { field: 'bonus_rp', label: 'RP earned from boost', format: 'rp' },
    { field: 'uses', label: 'Boosted crimes', format: 'num' },
  ],
  xp_gta: [
    { field: 'bonus_rp', label: 'RP earned from boost', format: 'rp' },
    { field: 'uses', label: 'Boosted GTAs', format: 'num' },
  ],
  melt: [
    { field: 'cooldown_saved_sec', label: 'Cooldown saved', format: 'dur' },
    { field: 'cars_melted', label: 'Cars melted', format: 'num' },
  ],
  oc_reduced: [
    { field: 'setup_saved_cash', label: 'Saved on setup', format: 'money' },
    { field: 'bonus_cash', label: 'Extra payout', format: 'money' },
    { field: 'bonus_rp', label: 'Extra payout RP', format: 'rp' },
    { field: 'uses', label: 'Boosted heists', format: 'num' },
  ],
  booze: [
    { field: 'saved_cash', label: 'Saved buying booze', format: 'money' },
    { field: 'bonus_cash', label: 'Distillery bonus', format: 'money' },
    { field: 'uses', label: 'Discounted buys', format: 'num' },
  ],
  racket: [
    { field: 'bonus_cash', label: 'Extra racket profit', format: 'money' },
    { field: 'uses', label: 'Boosted collects', format: 'num' },
  ],
  travel: [
    { field: 'points_saved', label: 'Points saved', format: 'points' },
    { field: 'time_saved_sec', label: 'Travel time saved', format: 'dur' },
    { field: 'uses', label: 'Boosted trips', format: 'num' },
  ],
  properties: [
    { field: 'bonus_cash', label: 'Extra income', format: 'money' },
    { field: 'uses', label: 'Boosted collects', format: 'num' },
  ],
  jailbust_bonus: [
    { field: 'busts_won', label: 'Busts won with boost', format: 'num' },
    { field: 'jail_avoided', label: 'Jail trips avoided', format: 'num' },
  ],
  jail_bailout: [
    { field: 'uses', label: 'Bailouts used', format: 'num' },
    { field: 'via_auto_rank', label: 'Used by Auto Rank', format: 'num' },
  ],
  crew_oc_auto_3h: [
    { field: 'applies', label: 'Auto-joins', format: 'num' },
  ],
  cooldown_skip_booze: [
    { field: 'profit_cash', label: 'Skip Run profit', format: 'money' },
    { field: 'runs', label: 'Skip runs done', format: 'num' },
    { field: 'uses', label: 'Drives skipped', format: 'num' },
  ],
  cooldown_skip_crime: [
    { field: 'cash_earned', label: 'Cash from skipped crimes', format: 'money' },
    { field: 'uses', label: 'Crime skips used', format: 'num' },
    { field: 'via_auto_rank', label: 'Used by Auto Rank', format: 'num' },
  ],
  cooldown_skip_gta: [
    { field: 'uses', label: 'GTA skips used', format: 'num' },
    { field: 'via_auto_rank', label: 'Used by Auto Rank', format: 'num' },
    { field: 'stolen_legendary', label: 'Legendary stolen', format: 'num' },
    { field: 'stolen_ultra_rare', label: 'Ultra rare stolen', format: 'num' },
    { field: 'stolen_rare', label: 'Rare stolen', format: 'num' },
    { field: 'stolen_uncommon', label: 'Uncommon stolen', format: 'num' },
    { field: 'stolen_common', label: 'Common stolen', format: 'num' },
    { field: 'stolen_exclusive', label: 'Exclusive stolen', format: 'num' },
    { field: 'stolen_custom', label: 'Custom stolen', format: 'num' },
  ],
};

/** Short labels for My Stats perk event cards (icons stay Zap unless overridden in UI). */
export const PERK_STAT_DISPLAY_NAMES = {
  xp_crimes: 'Crimes XP',
  xp_gta: 'GTA XP',
  melt: 'Melt',
  oc_reduced: 'OC Reduced',
  booze: 'Booze',
  racket: 'Racket',
  travel: 'Travel',
  properties: 'Properties',
  jailbust_bonus: 'Jailbust bonus',
  jail_bailout: 'Jail bailout',
  crew_oc_auto_3h: 'Crew OC auto-apply',
  cooldown_skip_booze: 'Booze cooldown skip',
  cooldown_skip_crime: 'Crime cooldown skip',
  cooldown_skip_gta: 'GTA cooldown skip',
};

/** Preferred order on My Stats (tokens with tracked chips first). */
export const PERK_STAT_DISPLAY_ORDER = Object.keys(PERK_STAT_CHIPS);

export function buildPerkStatChipsForType(tokenKey, perkStats) {
  const ps = perkStats && typeof perkStats === 'object' ? perkStats : {};
  const chips = [];
  (PERK_STAT_CHIPS[tokenKey] || []).forEach(({ field, label, format }) => {
    const v = Number(ps[field] || 0);
    if (v > 0) {
      chips.push({
        label,
        value: formatPerkChipValue(format, v),
        cls: PERK_CHIP_VALUE_CLASS[format] || 'text-foreground',
      });
    }
  });
  return chips;
}

export function tokenPerkStatsHasAny(tokenPerkStats) {
  const map = tokenPerkStats && typeof tokenPerkStats === 'object' ? tokenPerkStats : {};
  return PERK_STAT_DISPLAY_ORDER.some((key) => buildPerkStatChipsForType(key, map[key]).length > 0);
}

/** Default icon for perk event cards. */
export const PerkStatDefaultIcon = Zap;
