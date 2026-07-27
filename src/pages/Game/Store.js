import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShoppingBag, Zap, Shield, Star, Car, Crosshair, VolumeX, Clock, Bot, Heart, Send, ArrowRightLeft, ChevronDown, ChevronUp, Package, Copy, Swords, Award, Gauge } from 'lucide-react';
import api, { refreshUser, apiRequestWith429Retry } from '../../utils/api';
import { copyTextToClipboard } from '../../utils/copyToClipboard';
import { toast } from 'sonner';
import { containsProfanity } from '../../utils/profanityFilter';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';
import {
  GAME_PASS_PRICE_GBP,
  SILVER_PACK_POINTS,
  SILVER_PACK_PRICE_GBP,
} from '../../constants/gamePassPricing';
import {
  AUTO_RANK_STRIPE_PACKAGE_ID,
  AUTO_RANK_STRIPE_PRICE_GBP,
} from '../../constants/autoRankStripePricing';
import { formatGameDateTime, formatGameDateTimeShort, formatGameDateOnly } from '../../utils/gameDateTime';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { STORE_PAGE_CACHE_KEY } from '../../utils/sessionStaleCache';
import GlowPresetPicker from '../../components/GlowPresetPicker';

const STORE_STYLES = `
  .store-fade-in { animation: store-fade-in 0.4s ease-out both; }
  @keyframes store-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .store-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const CUSTOM_POINTS_PACKAGE = 'custom';

const BULLET_PACKS = [
  { bullets: 5000, cost: 100 },
  { bullets: 10000, cost: 175 },
  { bullets: 50000, cost: 775 },
  { bullets: 100000, cost: 1525 },
];
/** Must match backend store.CUSTOM_BULLETS_MAX */
const CUSTOM_BULLETS_MAX = 250_000;
const VIP_PASS_CAR_COST_POINTS = 5000;

const VALID_TABS = ['points', 'sendpts', 'upgrades', 'tokens', 'bullets'];
const bulletCost = (bullets) => bullets < 5000 ? Math.max(1, Math.floor(bullets * 0.02)) : 100 + Math.ceil((bullets - 5000) * 75 / 5000);

/** Match backend store._store_respect_cost_for_points: ceil(20.25×pts) = (pts×81+3)//4 */
function storeRespectForPoints(pts) {
  const p = Math.max(0, Math.floor(Number(pts) || 0));
  if (p <= 0) return 0;
  return Math.floor((p * 81 + 3) / 4);
}

/** Keep in sync with backend armoury.TOKEN_MAX_STACK_HOURS (7 × 24 = 1 week). */
const TOKEN_MAX_STACK_LABEL = '1 week';

/** Must match backend AUTO_RANK_COST_POINTS / pricing logic (8× token pts ≈ full unlock pts for 16h only). */
const AUTO_RANK_COST_POINTS = 5000;
const ROBOT_BG_AUTO_SEARCH_COST_POINTS = 10_000;
const BODYGUARD_FIND_TIME_COST_POINTS = 5000;
const SLOW_KILL_INFLATION_COST_POINTS = 5000;
const SLOW_BODYGUARD_HIRE_INFLATION_COST_POINTS = 5000;
const RAID_CAPACITY_COST_POINTS = 100; // +5 raids/day per pack, 30 days, stacks to 20/day total
const RAID_RESET_COST_POINTS = 2000; // points only, once per day

function robotBgAutoSearchActive(user) {
  if (user?.robot_bg_auto_search_active) return true;
  const until = user?.robot_bg_auto_search_until;
  if (!until) return false;
  const t = Date.parse(String(until).replace('Z', '+00:00'));
  return Number.isFinite(t) && t > Date.now();
}

function bodyguardFindTimeActive(user) {
  if (user?.bodyguard_find_time_active) return true;
  const until = user?.bodyguard_find_time_until;
  if (!until) return false;
  const t = Date.parse(String(until).replace('Z', '+00:00'));
  return Number.isFinite(t) && t > Date.now();
}

function slowKillInflationActive(user) {
  if (user?.slow_kill_inflation_active) return true;
  const until = user?.slow_kill_inflation_until;
  if (!until) return false;
  const t = Date.parse(String(until).replace('Z', '+00:00'));
  return Number.isFinite(t) && t > Date.now();
}

function slowBodyguardHireInflationActive(user) {
  if (user?.slow_bodyguard_hire_inflation_active) return true;
  const until = user?.slow_bodyguard_hire_inflation_until;
  if (!until) return false;
  const t = Date.parse(String(until).replace('Z', '+00:00'));
  return Number.isFinite(t) && t > Date.now();
}

function raidCapacityBoostAdd(user) {
  const until = user?.raid_capacity_boost_until;
  if (!until) return 0;
  const t = Date.parse(String(until).replace('Z', '+00:00'));
  if (!Number.isFinite(t) || t <= Date.now()) return 0;
  return Math.max(0, Math.min(15, Number(user?.raid_capacity_boost_add) || 0));
}

function raidCapacityBoostActive(user) {
  return raidCapacityBoostAdd(user) > 0;
}
const ARMOUR_TIER_6_STORE_COST_POINTS = 500;
const WEAPON11_STORE_COST_POINTS = 1000;
const AUTO_RANK_2H_TOKEN_STORE_PTS = Math.ceil(AUTO_RANK_COST_POINTS / 8);
const CREW_OC_AUTO_3H_TOKEN_STORE_PTS = 48; // match backend jailbust_bonus / crew_oc_auto_3h store price

/** Default max qty per consumable-token purchase (must match backend BuyStoreTokenBody). */
const TOKEN_BUY_MAX_QTY = 100;
/** Cooldown-skip buy caps = daily activation caps (backend utils/cooldown_skip.py). */
const TOKEN_BUY_MAX_QTY_BY_TYPE = {
  cooldown_skip_crime: 5000,
  cooldown_skip_gta: 1000,
  cooldown_skip_booze: 200,
  cooldown_skip_properties: 3,
};
function tokenBuyMaxQty(tokenType) {
  return TOKEN_BUY_MAX_QTY_BY_TYPE[tokenType] || TOKEN_BUY_MAX_QTY;
}
const TOKEN_STORE_ITEMS = [
  { tokenType: 'xp_crimes', title: 'Crimes XP Token', price: 42, userKey: 'xp_crimes_tokens', desc: `2× crime XP for 1h when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  { tokenType: 'xp_gta', title: 'GTA XP Token', price: 42, userKey: 'xp_gta_tokens', desc: `2× GTA XP for 1h when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  { tokenType: 'melt', title: 'Melt Token', price: 42, userKey: 'melt_tokens', desc: `Melt bonus hour when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  { tokenType: 'oc_reduced', title: 'OC Token', price: 42, userKey: 'oc_reduced_tokens', desc: `Reduced OC cooldown hour when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  { tokenType: 'booze', title: 'Booze Token', price: 42, userKey: 'booze_tokens', desc: `Cheaper booze buys + distillery boost when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  { tokenType: 'racket', title: 'Racket Token', price: 42, userKey: 'racket_tokens', desc: `+20% illegal business & distillery cash when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  { tokenType: 'properties', title: 'Properties Token', price: 48, userKey: 'properties_tokens', desc: `Property income bonus when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  { tokenType: 'travel', title: 'Travel Token', price: 55, userKey: 'travel_tokens', desc: `Travel bonus when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  { tokenType: 'jailbust_bonus', title: 'Jailbust Token', price: 48, userKey: 'jailbust_tokens', desc: `+10% bust success for 1h when activated (stack up to ${TOKEN_MAX_STACK_LABEL}).` },
  {
    tokenType: 'auto_rank_2h',
    title: 'Auto Rank (2h) Token',
    price: AUTO_RANK_2H_TOKEN_STORE_PTS,
    userKey: 'auto_rank_2h_tokens',
    desc: `+2h Auto Rank when activated (stack to ${TOKEN_MAX_STACK_LABEL}). ${AUTO_RANK_2H_TOKEN_STORE_PTS} pts each — eight tokens equal ${AUTO_RANK_COST_POINTS.toLocaleString()} pts but only 16h vs permanent unlock.`,
  },
  {
    tokenType: 'crew_oc_auto_3h',
    title: 'Crew OC auto-apply (3h)',
    price: CREW_OC_AUTO_3H_TOKEN_STORE_PTS,
    userKey: 'crew_oc_auto_apply_tokens',
    desc: `Activate in My Inventory — you must set a max join fee; auto-apply only runs after that. 3h per token, stack to ${TOKEN_MAX_STACK_LABEL}.`,
  },
  { tokenType: 'auto_collect_12h', title: 'Auto-Collect (12h)', price: 85, userKey: 'auto_collect_12h_tokens', flagKey: 'auto_collect', desc: 'Auto-collect family rackets when cooldowns allow (properties have their own Auto Collect perk). Activate in My Inventory (12h, stacks to 168h).' },
  { tokenType: 'auto_collect_24h', title: 'Auto-Collect (24h)', price: 150, userKey: 'auto_collect_24h_tokens', flagKey: 'auto_collect', desc: 'Same as 12h pass but 24h per activation (stacks to 168h).' },
  { tokenType: 'jail_bailout', title: 'Jail Bailout Token', price: 25, userKey: 'jail_bailout_tokens', flagKey: 'jail_bailout', desc: 'Instant leave jail from the Jail page (500 uses/day UTC; does not bypass OC lockdown).' },
  { tokenType: 'cooldown_skip_crime', title: 'Crime Cooldown Skip', price: 35, userKey: 'cooldown_skip_crime_tokens', flagKey: 'cooldown_skip_crime', desc: 'Activate in My Inventory or tap Skip on a crime row — skips one crime cooldown (max 5,000 activations/day). Skipped crimes pay −50% cash.' },
  { tokenType: 'cooldown_skip_gta', title: 'GTA Cooldown Skip', price: 35, userKey: 'cooldown_skip_gta_tokens', flagKey: 'cooldown_skip_gta', desc: 'Skips one GTA cooldown when activated (1,000/day cap).' },
  { tokenType: 'cooldown_skip_booze', title: 'Booze Travel Skip', price: 35, userKey: 'cooldown_skip_booze_tokens', flagKey: 'cooldown_skip_booze', desc: 'Skips one booze-run travel wait when activated (200/day cap).' },
  { tokenType: 'cooldown_skip_properties', title: 'Properties Collect Skip', price: 35, userKey: 'cooldown_skip_properties_tokens', flagKey: 'cooldown_skip_properties', desc: 'Skips one property collect cooldown when activated — tap ⚡ Skip Collect on the Properties page (3/day cap).' },
];

const TOKEN_BUNDLES = [
  { id: 'grinder', title: 'Grinder Pack', price: 75, desc: '+1 Crimes XP token and +1 GTA XP token.' },
  { id: 'racket_runner', title: 'Racket Runner Pack', price: 78, desc: '+1 Racket token and +1 Booze token.' },
  { id: 'builder', title: 'Builder Pack', price: 100, desc: '+1 Travel token and +1 Properties token.' },
];
const SELECTABLE_BUNDLE_SIZE = 250;
const SELECTABLE_BUNDLE_DISCOUNT_PCT = 20;
const SELECTABLE_BUNDLE_DISALLOWED = new Set(['rank_xp_pass', 'crew_oc_auto_3h']);
const SELECTABLE_BUNDLE_ITEMS = TOKEN_STORE_ITEMS.filter((t) => !SELECTABLE_BUNDLE_DISALLOWED.has(t.tokenType));

const FOUNDING_MEMBER_COST_POINTS = 5000;

const STORE_ITEM_FLAG_LABELS = {
  auto_collect: 'Auto-collect passes',
  jail_bailout: 'Jail bailout tokens',
  cooldown_skip_crime: 'Crime cooldown skip',
  cooldown_skip_gta: 'GTA cooldown skip',
  cooldown_skip_booze: 'Booze travel skip',
  cooldown_skip_properties: 'Properties collect skip',
  profile_badge: 'Custom profile badge',
  profile_glow_7d: 'Profile glow (7-day)',
  profile_glow_permanent: 'Profile glow (permanent)',
  crew_oc_insurance: 'Crew OC insurance',
  family_safe_deposit: 'Family safe deposit',
  family_event_token: 'Family event token',
  raid_capacity: 'Raid capacity (+5 raids/day)',
  raid_reset: 'Raid reset (once/day)',
  weed_empire: 'Weed Empire',
};

const UPGRADES = [
  { id: 'health', title: 'Full Health', Icon: Heart, price: 15, path: '/store/buy-health', ownedKey: null, desc: 'Restore health to 100%', extra: (u) => ({ line: 'Health', value: `${Number(u?.health ?? 100).toFixed(0)}%` }) },
  { id: 'rank-bar', title: 'Premium Rank Bar', Icon: Star, price: 50, path: '/store/buy-rank-bar', ownedKey: 'premium_rank_bar', desc: 'Exact numbers & amounts for next rank' },
  { id: 'founding-member', title: 'Founding Member', Icon: Award, price: FOUNDING_MEMBER_COST_POINTS, path: '/store/buy-founding-member', ownedKey: 'founding_member', desc: '+15% on crimes, GTA, OC, hitlist NPCs, properties, family rackets, and missions. Account-only — lost on death; buy again on a new life if you want it back.' },
  { id: 'custom-profile-badge', title: 'Custom Profile Badge', Icon: Award, price: 750, path: '/store/buy-custom-profile-badge', ownedKey: 'custom_profile_badge', flagKey: 'profile_badge', desc: 'Unlock a custom badge image next to your name. After purchase, upload your image on Profile. Account-only — lost on death.' },
  { id: 'profile-glow-7d', title: 'Name Glow + Border (7d)', Icon: Star, price: 120, path: '/store/buy-profile-glow-7d', ownedKey: null, flagKey: 'profile_glow_7d', needsGlowPreset: true, desc: 'Timed username glow and dossier border (7 days, stacks).' },
  { id: 'profile-glow-permanent', title: 'Name Glow + Border (Permanent)', Icon: Star, price: 800, path: '/store/buy-profile-glow-permanent', ownedKey: 'profile_cosmetic_permanent', flagKey: 'profile_glow_permanent', needsGlowPreset: true, desc: 'Permanent username glow and profile border. After purchase, change colour anytime for free on Edit Profile.' },
  { id: 'family-safe-deposit-tier', title: 'Family Safe Deposit Tier', Icon: Shield, price: 600, path: '/store/buy-family-safe-deposit-tier', ownedKey: null, flagKey: 'family_safe_deposit', familyDonOnly: true, desc: 'Don/Underboss: raises the personal safe cash cap per member in the family vault — $250M / $500M / $1B (max 3 tiers).', extra: (u, _cfg, _weed, famSafe) => {
    if (!famSafe?.has_family) return { line: 'Your family', value: 'No family' };
    const tiers = Number(famSafe.tiers || 0);
    const cap = Number(famSafe.cap || 0);
    if (tiers <= 0 && cap <= 0) return { line: 'Your family', value: '0 / 3 tiers · $0 cap' };
    return { line: 'Your family', value: `${tiers}/${famSafe.max_tiers || 3} tiers · $${cap.toLocaleString()} cap` };
  } },
  { id: 'weed-daily-cap', title: 'Weed Daily Sell Cap +$250M', Icon: ShoppingBag, price: 50, path: '/store/buy-weed-daily-cap', ownedKey: null, flagKey: 'weed_empire', stackWhileActive: true, desc: 'Weed Empire: +$250M daily sell cap (street/dealer). Stacks up to $5B. Does not raise the $250M/day withdraw cap.', extra: (u, _cfg, weed) => {
    const base = 250_000_000;
    const step = 250_000_000;
    const tiers = Number(weed?.daily_cap_bonus_tiers ?? u?.weed_daily_cap_bonus_tiers ?? 0);
    const cap = Number(weed?.daily_sold_cap ?? (base + tiers * step));
    return { line: 'Your sell cap', value: `$${cap.toLocaleString()}` };
  } },
  { id: 'weed-safety-deposit', title: 'Weed Safety Deposit Unlock', Icon: Shield, price: 500, path: '/store/buy-weed-safety-deposit', ownedKey: 'weed_safety_bank_unlocked', flagKey: 'weed_empire', desc: 'Weed Empire: unlock a raid- and bust-safe vault. Then expand in Weed Empire with business cash — $10M → +$25M capacity (max $5B).' },
  { id: 'family-event-token', title: 'Family Event Token', Icon: Zap, price: 250, path: '/store/buy-family-event-token', ownedKey: null, flagKey: 'family_event_token', familyDonOnly: true, desc: 'Don/Underboss: 3-day +10% family racket income (1 per 7 days).' },
  { id: 'auto-rank', title: 'Auto Rank', Icon: Bot, price: AUTO_RANK_COST_POINTS, path: '/store/buy-auto-rank', ownedKey: 'auto_rank_purchased', desc: 'Auto-commit crimes, GTA, busts, OC. Optional: set Telegram in Profile for notifications.' },
  { id: 'robot-bg-auto-search', title: 'Robot Auto-Search', Icon: Crosshair, price: ROBOT_BG_AUTO_SEARCH_COST_POINTS, path: '/store/buy-robot-bg-auto-search', ownedKey: null, activeCheck: robotBgAutoSearchActive, desc: '30 days: auto-maintain Attack searches for your hired robot bodyguards (renews when ≤3h left on a row). One purchase per active period — buy again after it expires.', extra: (u) => (robotBgAutoSearchActive(u) && u?.robot_bg_auto_search_until ? { line: 'Active until', value: formatGameDateTime(u.robot_bg_auto_search_until) } : null) },
  { id: 'bodyguard-find-time', title: 'Bodyguard Find Clock', Icon: Clock, price: BODYGUARD_FIND_TIME_COST_POINTS, path: '/store/buy-bodyguard-find-time', ownedKey: null, activeCheck: bodyguardFindTimeActive, stackWhileActive: true, desc: 'Weekly (7 days, stacks): on Kill → Attack, searching rows show the exact find time (not only the ~2h15m–2h45m range).', extra: (u) => (bodyguardFindTimeActive(u) && u?.bodyguard_find_time_until ? { line: 'Active until', value: formatGameDateTime(u.bodyguard_find_time_until) } : null) },
  { id: 'slow-kill-inflation', title: 'Slow Kill Inflation', Icon: Gauge, price: SLOW_KILL_INFLATION_COST_POINTS, path: '/store/buy-slow-kill-inflation', ownedKey: null, activeCheck: slowKillInflationActive, stackWhileActive: true, desc: '7 days (stacks up to 14 days max): kill inflation rises at half the normal rate (~1–2% per kill instead of ~2–4%).', extra: (u) => (slowKillInflationActive(u) && u?.slow_kill_inflation_until ? { line: 'Active until', value: formatGameDateTime(u.slow_kill_inflation_until) } : null) },
  { id: 'slow-bodyguard-hire-inflation', title: 'Slow Bodyguard Hire Inflation', Icon: Shield, price: SLOW_BODYGUARD_HIRE_INFLATION_COST_POINTS, path: '/store/buy-slow-bodyguard-hire-inflation', ownedKey: null, activeCheck: slowBodyguardHireInflationActive, stackWhileActive: true, desc: '7 days (stacks up to 14 days max): 3h bodyguard hire markup is halved while active.', extra: (u) => (slowBodyguardHireInflationActive(u) && u?.slow_bodyguard_hire_inflation_until ? { line: 'Active until', value: formatGameDateTime(u.slow_bodyguard_hire_inflation_until) } : null) },
  { id: 'raid-capacity', title: 'Raid Capacity +5/day', Icon: Crosshair, price: RAID_CAPACITY_COST_POINTS, path: '/store/buy-raid-capacity', ownedKey: null, flagKey: 'raid_capacity', activeCheck: raidCapacityBoostActive, stackWhileActive: true, disabledWhen: (u) => raidCapacityBoostAdd(u) >= 15, desc: '30 days: +5 illegal business raids per day per pack. Stacks up to +15 (20 raids/day total); buying again adds +5 and restarts the 30 days.', extra: (u) => (raidCapacityBoostActive(u) && u?.raid_capacity_boost_until ? { line: `Boost +${raidCapacityBoostAdd(u)}/day until`, value: formatGameDateTime(u.raid_capacity_boost_until) } : null) },
  { id: 'raid-reset', title: 'Raid Reset', Icon: Crosshair, price: RAID_RESET_COST_POINTS, path: '/store/buy-raid-reset', ownedKey: null, flagKey: 'raid_reset', pointsOnly: true, stackWhileActive: true, desc: 'Wipes today\'s used raid count back to 0 so you can hit joints again up to your daily cap. Points only — can be bought once per day.' },
  { id: 'armour-tier-6', title: 'Elite Composite Battledress', Icon: Shield, price: ARMOUR_TIER_6_STORE_COST_POINTS, path: '/store/buy-armour-tier-6', ownedKey: null, ownedCheck: (u) => (u?.armour_owned_level_max ?? 0) >= 6, disabledWhen: (u) => (u?.armour_owned_level_max ?? 0) < 5, desc: 'Armour level 6 (60k base bullets). Requires level 5 owned. Auto-equipped on purchase. Also shown on Armour page.' },
  { id: 'weapon11', title: 'Engraved Lewis Gun', Icon: Swords, price: WEAPON11_STORE_COST_POINTS, path: '/store/buy-weapon11', ownedKey: null, ownedCheck: (u) => !!u?.owns_weapon11, disabledWhen: (u) => !u?.owns_weapon10, desc: 'Top store gun (130 dmg). Requires Chicago Typewriter Premium owned. Auto-equipped on purchase. Also on Armour page.' },
  { id: 'silencer', title: 'Silencer', Icon: VolumeX, price: 150, path: '/store/buy-silencer', ownedKey: 'has_silencer', desc: 'Fewer witness statements when you kill' },
  { id: 'anti-snitch', title: 'Anti Snitch', Icon: Shield, price: 120, path: '/store/buy-anti-snitch', ownedKey: 'anti_snitch', desc: 'Cannot be snitched on when others are in jail' },
  { id: 'oc-timer', title: 'OC Timer', Icon: Clock, price: 300, path: '/store/buy-oc-timer', ownedKey: 'oc_timer_reduced', desc: 'Solo Organised Crime heists: 4h cooldown instead of 6h (not Family Crew OC)' },
  { id: 'crew-oc-timer', title: 'Crew OC Timer', Icon: Clock, price: 350, path: '/store/buy-crew-oc-timer', ownedKey: 'crew_oc_timer_reduced', desc: 'Family Crew OC: 6h base when you commit (stacks with family −1h perk → 5h). Any Don/Underboss/Capo with this upgrade applies it for the crew.' },
  { id: 'garage', title: 'Garage Batch', Icon: Zap, price: 75, path: '/store/upgrade-garage-batch', ownedKey: null, desc: '+10 melt/scrap at once', extra: (u) => ({ line: 'Limit', value: u?.garage_batch_limit ?? 6 }) },
  { id: 'booze', title: 'Booze Capacity', Icon: ShoppingBag, price: 100, path: '/store/buy-booze-capacity', ownedKey: null, desc: '+25 bonus cargo from Points Store (rank + prestige set your base)', extra: (u, cfg) => cfg && ({
    line: 'Cargo',
    value: `Total ${cfg.capacity != null ? Number(cfg.capacity).toLocaleString() : '—'} · bonus +${Number(cfg.capacity_bonus ?? 0).toLocaleString()}/${cfg.capacity_bonus_max != null ? Number(cfg.capacity_bonus_max).toLocaleString() : '—'}`,
  }) },
  {
    id: 'hitlist-npc-cap',
    title: 'Practice Targets',
    Icon: Crosshair,
    price: (u) => (Math.min(3, (Number(u?.hitlist_npc_bonus_slots) || 0) + 1) * 100),
    path: '/store/buy-hitlist-npc-bonus-slot',
    ownedKey: null,
    desc: '+1 max practice NPC on The Board at once (base 3, max 6). Costs: 4th=100, 5th=200, 6th=300.',
    extra: (u) => ({ line: 'Limit', value: `${3 + (Number(u?.hitlist_npc_bonus_slots) || 0)} on board` }),
  },
];

function isQtAnonDisplayName(name) {
  const n = String(name || '').trim();
  return !n || n === '[Anonymous]' || (n.startsWith('[') && n.endsWith(']'));
}

function StorePointsTransferRow({ t, compact }) {
  const amt = Number(t.amount).toLocaleString();
  const when = t.created_at ? formatGameDateTime(t.created_at) : '';
  const summary = `${amt} pts: ${t.from_username} → ${t.to_username}${when ? ` · ${when}` : ''}`;
  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyTextToClipboard(summary);
    if (ok) toast.success('Copied to clipboard');
    else toast.error('Could not copy');
  };
  return (
    <li
      className={`text-[10px] font-heading border-b border-zinc-800/50 last:border-0 ${
        compact ? 'flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 py-0.5' : 'py-1'
      }`}
    >
      <div className={`flex items-center justify-between gap-2 min-w-0 ${compact ? 'w-full' : ''}`}>
        <span className="text-mutedForeground truncate min-w-0 flex-1">
          {isQtAnonDisplayName(t.from_username) ? (
            <span className="text-primary">{t.from_username}</span>
          ) : (
            <Link to={`/profile/${encodeURIComponent(t.from_username)}`} className="text-primary hover:underline">{t.from_username}</Link>
          )}
          {' → '}
          {isQtAnonDisplayName(t.to_username) ? (
            <span className="text-primary">{t.to_username}</span>
          ) : (
            <Link to={`/profile/${encodeURIComponent(t.to_username)}`} className="text-primary hover:underline">{t.to_username}</Link>
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onCopy}
            className="p-1 rounded-md border border-transparent text-zinc-500 hover:text-primary hover:bg-primary/15 hover:border-primary/25 transition-colors touch-manipulation"
            title="Copy points, users & date"
            aria-label="Copy transfer details"
          >
            <Copy size={compact ? 12 : 14} />
          </button>
          <span className="text-primary whitespace-nowrap">{amt} pts</span>
        </div>
      </div>
      {when ? (
        <span className={`text-[9px] text-zinc-600 w-full shrink-0 block ${compact ? '' : 'mt-0.5'}`}>{when}</span>
      ) : null}
    </li>
  );
}

const Tab = ({ active, onClick, children, disabled, className = '' }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`flex-1 min-w-0 min-h-[44px] py-2.5 px-3 rounded-md text-[10px] sm:text-[9px] font-heading font-bold uppercase tracking-wider transition-all border touch-manipulation ${
      active
        ? 'text-primary bg-primary/10 border-primary/20'
        : 'text-zinc-500 hover:text-zinc-300 border-transparent'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`.trim()}
  >
    {children}
  </button>
);

function StorePayWithSelect({ value, onChange, showCash = false }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider">Pay with</span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'cash' && showCash) onChange('cash');
          else if (v === 'respect') onChange('respect');
          else onChange('points');
        }}
        className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-foreground focus:border-primary/50 focus:outline-none"
      >
        <option value="points">Points</option>
        <option value="respect">Respect points</option>
        {showCash && <option value="cash">Cash ($)</option>}
      </select>
    </div>
  );
}

const StoreCard = ({ title, Icon, desc, price, respectPrice, owned, ownedLabel, onBuy, loading, disabled, comingSoon, staffPreview, user, payWith = 'auto', cashPrice, children }) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel ${comingSoon && !staffPreview ? 'opacity-60' : ''}`}>
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
      <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">{title}</span>
      <div className="flex items-center gap-1 shrink-0">
        {comingSoon && !staffPreview && <span className="text-[8px] font-heading uppercase text-zinc-500 border border-zinc-600/50 rounded px-1 py-0.5">Coming soon</span>}
        {staffPreview && <span className="text-[8px] font-heading uppercase text-amber-400/90 border border-amber-500/40 rounded px-1 py-0.5">Staff preview</span>}
        {Icon && <Icon className="text-primary shrink-0" size={14} />}
      </div>
    </div>
    <div className="p-2.5">
      <p className="text-[10px] text-mutedForeground font-heading mb-1.5">{desc}</p>
      {children}
      {owned ? (
        <div className="py-1.5 text-center text-[10px] font-heading font-bold text-primary uppercase">{ownedLabel || 'Owned'}</div>
      ) : (
        <button
          type="button"
          onClick={() => onBuy()}
          disabled={
            loading
            || disabled
            || (comingSoon && !staffPreview)
            || (payWith === 'cash'
              ? (!cashPrice || (user && (user.money ?? 0) < cashPrice))
              : (
                !!user
                && (
                  respectPrice != null
                    ? (
                      payWith === 'points'
                        ? (user.points ?? 0) < price
                        : payWith === 'respect'
                          ? (user.respect_points ?? 0) < respectPrice
                          : ((user.points ?? 0) < price && (user.respect_points ?? 0) < respectPrice)
                    )
                    // Points-only items ignore the pay-with toggle.
                    : (user.points ?? 0) < price
                )
              )
            )
          }
          className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 mt-1 touch-manipulation"
        >
          {loading
            ? '...'
            : payWith === 'cash'
              ? (cashPrice ? `$${Math.round(cashPrice).toLocaleString()}` : 'Unavailable')
              : respectPrice != null
                ? (
                  payWith === 'points'
                    ? `${price} pts`
                    : payWith === 'respect'
                      ? `${respectPrice} resp`
                      : `${price} pts or ${respectPrice} resp`
                )
                : `${price} pts`}
        </button>
      )}
    </div>
    <div className="store-art-line text-primary mx-3" />
  </div>
);

export default function Store() {
  const storeBoot = readSessionJson(STORE_PAGE_CACHE_KEY);
  const [loading, setLoading] = useState(false);
  const [autoRankStripeLoading, setAutoRankStripeLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [user, setUser] = useState(() => storeBoot?.user ?? null);
  const [boozeConfig, setBoozeConfig] = useState(() => storeBoot?.boozeConfig ?? null);
  const [weedEmpireSummary, setWeedEmpireSummary] = useState(() => storeBoot?.weedEmpireSummary ?? null);
  const [familySafeDepositSummary, setFamilySafeDepositSummary] = useState(() => storeBoot?.familySafeDepositSummary ?? null);
  const [event, setEvent] = useState(() => storeBoot?.event ?? null);
  const [eventsEnabled, setEventsEnabled] = useState(() => !!storeBoot?.eventsEnabled);
  const [storePointsEvent, setStorePointsEvent] = useState(() => storeBoot?.storePointsEvent ?? null);
  const [customCarName, setCustomCarName] = useState('');
  const [activeTab, setActiveTab] = useState('points');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  useEffect(() => {
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (activeTab !== 'upgrades') return;
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const t = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [activeTab, user, weedEmpireSummary, familySafeDepositSummary]);
  const [pointsTransfers, setPointsTransfers] = useState([]);
  const [pointsBreakdown, setPointsBreakdown] = useState(null);
  const [pointsBreakdownLoading, setPointsBreakdownLoading] = useState(false);
  const [adminTransfers, setAdminTransfers] = useState([]);
  const [adminTransfersOpen, setAdminTransfersOpen] = useState(false);
  const [sendToUsername, setSendToUsername] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [customBullets, setCustomBullets] = useState('');
  const [customPurchaseMode, setCustomPurchaseMode] = useState('points');
  const [pointsPaymentMode, setPointsPaymentMode] = useState('card');
  const [customPointsInput, setCustomPointsInput] = useState('');
  const [customGbpInput, setCustomGbpInput] = useState('');
  const [customQuote, setCustomQuote] = useState(null);
  const [pointsCashInput, setPointsCashInput] = useState('');
  const [pointsCashPriceData, setPointsCashPriceData] = useState(null);
  const [pointsCashQuote, setPointsCashQuote] = useState(null);
  const [isAdmin, setIsAdmin] = useState(() => !!storeBoot?.isAdmin);
  const [isStaff, setIsStaff] = useState(() => !!storeBoot?.isStaff);
  const [storeItemFlags, setStoreItemFlags] = useState(() => storeBoot?.storeItemFlags ?? {});
  const [glowPresetId, setGlowPresetId] = useState('violet');
  const [pointsTabLocked, setPointsTabLocked] = useState(() => !!storeBoot?.pointsTabLocked);
  const [pointsTabLockMessage, setPointsTabLockMessage] = useState(() => storeBoot?.pointsTabLockMessage ?? '');
  const [paymentTransactions, setPaymentTransactions] = useState(() => storeBoot?.paymentTransactions ?? []);
  const [preorderActive, setPreorderActive] = useState(() => !!storeBoot?.preorderActive);
  const [preorderReleaseDate, setPreorderReleaseDate] = useState(() => storeBoot?.preorderReleaseDate ?? null);
  const [storePointsAutoCredit, setStorePointsAutoCredit] = useState(() => storeBoot?.storePointsAutoCredit !== false);
  const [manualCreditEta, setManualCreditEta] = useState(() => storeBoot?.manualCreditEta ?? null);
  const [pendingPoints, setPendingPoints] = useState(() => storeBoot?.pendingPoints ?? 0);
  const [claimingPending, setClaimingPending] = useState(false);
  const [storePayWith, setStorePayWith] = useState('points');
  const [cashPricePerPoint, setCashPricePerPoint] = useState(0);
  const [cashPriceAvailable, setCashPriceAvailable] = useState(false);
  const [cashPriceUsesQtAvg, setCashPriceUsesQtAvg] = useState(false);
  const [cashMinPricePerPoint, setCashMinPricePerPoint] = useState(150_000);
  const [cashPurchasesToday, setCashPurchasesToday] = useState(0);
  const [cashPurchasesLimit, setCashPurchasesLimit] = useState(250);
  const [selectableBundleQtyByToken, setSelectableBundleQtyByToken] = useState(() =>
    Object.fromEntries(SELECTABLE_BUNDLE_ITEMS.map((t) => [t.tokenType, 0])),
  );
  const [tokenBuyQtyByType, setTokenBuyQtyByType] = useState(() =>
    Object.fromEntries(TOKEN_STORE_ITEMS.map((t) => [t.tokenType, 1])),
  );
  const [vipPassCarStock, setVipPassCarStock] = useState(null);

  const setTokenBuyQty = (tokenType, next) => {
    const maxQty = tokenBuyMaxQty(tokenType);
    const n = Math.max(1, Math.min(maxQty, Math.floor(Number(next) || 1)));
    setTokenBuyQtyByType((prev) => ({ ...prev, [tokenType]: n }));
  };

  const storeFlagAllowed = useCallback((flagKey) => {
    if (!flagKey) return true;
    if (storeItemFlags?.[flagKey]) return true;
    return isStaff;
  }, [storeItemFlags, isStaff]);

  const fetchTokenCashPrice = useCallback(() => {
    api.get('/store/token-cash-price').then(({ data }) => {
      setCashPriceAvailable(!!data.available);
      setCashPricePerPoint(data.price_per_point || 0);
      setCashPriceUsesQtAvg(!!data.used_qt_average);
      setCashMinPricePerPoint(Number(data.min_price_per_point) || 150_000);
      setCashPurchasesToday(Number(data.cash_purchases_today) || 0);
      setCashPurchasesLimit(Number(data.cash_purchases_limit) || 250);
    }).catch(() => {
      setCashPriceAvailable(false);
      setCashPricePerPoint(0);
      setCashPriceUsesQtAvg(false);
    });
  }, []);

  const fetchVipPassCarStock = useCallback(() => {
    api.get('/store/vip-pass-car-stock').then(({ data }) => {
      setVipPassCarStock(data || null);
    }).catch(() => {
      setVipPassCarStock(null);
    });
  }, []);

  useEffect(() => {
    if (activeTab !== 'tokens' && storePayWith === 'cash') {
      setStorePayWith('points');
    }
  }, [activeTab, storePayWith]);

  const fetchPointsCashPrice = useCallback(() => {
    api.get('/store/points-cash-price').then(({ data }) => {
      setPointsCashPriceData(data || null);
    }).catch(() => {
      setPointsCashPriceData(null);
    });
  }, []);

  useEffect(() => {
    if (activeTab !== 'points' || pointsTabLocked || pointsPaymentMode !== 'cash') {
      setPointsCashQuote(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const p = parseInt(String(pointsCashInput).replace(/\D/g, ''), 10);
        if (!Number.isFinite(p) || p < 1) {
          setPointsCashQuote(null);
          return;
        }
        const r = await api.get('/store/points-cash-quote', { params: { points: p } });
        setPointsCashQuote(r.data || null);
      } catch {
        setPointsCashQuote(null);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [activeTab, pointsTabLocked, pointsPaymentMode, pointsCashInput]);

  const pointsCashPrestigeOk =
    (user?.prestige_level ?? 0) >= 1
    || Boolean(pointsCashPriceData?.prestige_eligible)
    || Boolean(pointsCashQuote?.prestige_eligible);

  useEffect(() => {
    if (activeTab === 'points' && !pointsTabLocked && pointsPaymentMode === 'cash' && user?.email_verified && pointsCashPrestigeOk) {
      fetchPointsCashPrice();
    }
  }, [activeTab, pointsTabLocked, pointsPaymentMode, user?.email_verified, pointsCashPrestigeOk, fetchPointsCashPrice]);

  useEffect(() => {
    if (activeTab !== 'points' || pointsTabLocked || pointsPaymentMode !== 'cash' || !user?.email_verified || !pointsCashPrestigeOk) return undefined;
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchPointsCashPrice();
    };
    const onFocus = () => fetchPointsCashPrice();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [activeTab, pointsTabLocked, pointsPaymentMode, user?.email_verified, pointsCashPrestigeOk, fetchPointsCashPrice]);

  useEffect(() => {
    if (activeTab !== 'points' || pointsTabLocked) {
      setCustomQuote(null);
      return;
    }
    if (pointsPaymentMode !== 'card') {
      setCustomQuote(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        if (customPurchaseMode === 'points') {
          const p = parseInt(String(customPointsInput).replace(/\D/g, ''), 10);
          if (!Number.isFinite(p) || p < 1000) {
            setCustomQuote(null);
            return;
          }
          const r = await api.get('/payments/custom-quote', { params: { points: p } });
          setCustomQuote(r.data || null);
        } else {
          const raw = String(customGbpInput).replace(/[^0-9.]/g, '');
          const g = parseFloat(raw);
          if (!Number.isFinite(g) || g < 2.49) {
            setCustomQuote(null);
            return;
          }
          const r = await api.get('/payments/custom-quote', { params: { gbp: g } });
          setCustomQuote(r.data || null);
        }
      } catch {
        setCustomQuote(null);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [activeTab, pointsTabLocked, pointsPaymentMode, customPurchaseMode, customPointsInput, customGbpInput]);

  useEffect(() => {
    if (activeTab === 'tokens' && storePayWith === 'cash') {
      fetchTokenCashPrice();
    }
  }, [activeTab, storePayWith, fetchTokenCashPrice]);

  useEffect(() => {
    if (activeTab !== 'tokens' || storePayWith !== 'cash') return undefined;
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchTokenCashPrice();
    };
    const onFocus = () => fetchTokenCashPrice();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [activeTab, storePayWith, fetchTokenCashPrice]);

  const handleClaimPendingPoints = async () => {
    setClaimingPending(true);
    try {
      const res = await api.post('/payments/check-release');
      if (res.data?.released > 0) {
        toast.success(res.data?.message || 'Points released!');
        setPendingPoints(0);
        fetchData();
      } else {
        toast.info(res.data?.message || 'No points to release');
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to release points');
    } finally {
      setClaimingPending(false);
    }
  };

  const fetchPaymentTransactions = useCallback(async () => {
    try {
      const res = await api.get('/payments/my-transactions');
      const txs = res.data?.transactions || [];
      setPaymentTransactions(txs);
      return txs;
    } catch {
      setPaymentTransactions([]);
      return [];
    }
  }, []);

  const fetchData = useCallback(async ({ silent = false } = {}) => {
    try {
      const [userRes, boozeRes, weedRes, familySafeRes, eventsRes, storePointsEventRes, adminRes, locksRes, pendingRes, flagsRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/booze-run/config').catch(() => ({ data: null })),
        api.get('/store/weed-empire-summary').catch(() => ({ data: null })),
        api.get('/store/family-safe-deposit-summary').catch(() => ({ data: null })),
        apiRequestWith429Retry(() => api.get('/events/active')).catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/payments/store-points-event').catch(() => ({ data: { event: null } })),
        api.get('/auth/staff-flags').catch(() => ({ data: { is_admin: false } })),
        api.get('/page-locks').catch(() => ({ data: { paths: {} } })),
        api.get('/payments/pending-points').catch(() => ({ data: { pending_points: 0 } })),
        api.get('/store/item-flags').catch(() => ({ data: { flags: {} } })),
      ]);
      setUser(userRes.data);
      const nextBooze = boozeRes?.data || null;
      setBoozeConfig(nextBooze);
      const nextWeed = weedRes?.data || null;
      setWeedEmpireSummary(nextWeed);
      const nextFamilySafe = familySafeRes?.data || null;
      setFamilySafeDepositSummary(nextFamilySafe);
      const nextEvent = eventsRes.data?.event ?? null;
      const nextEventsEnabled = !!eventsRes.data?.events_enabled;
      setEvent(nextEvent);
      setEventsEnabled(nextEventsEnabled);
      const nextStorePointsEvent = storePointsEventRes.data?.event ?? null;
      setStorePointsEvent(nextStorePointsEvent);
      const nextIsAdmin = !!adminRes.data?.is_admin;
      const nextIsMod = !!adminRes.data?.is_moderator;
      const nextHasAdminEmail = !!adminRes.data?.has_admin_email;
      setIsAdmin(nextIsAdmin);
      setIsStaff(nextIsAdmin || nextIsMod || nextHasAdminEmail);
      setStoreItemFlags(flagsRes.data?.flags || {});
      const paths = locksRes?.data?.paths ?? {};
      const pointsLocked = !!paths['/store/points'];
      const pointsLockMsg = paths['/store/points'] || 'Points purchase temporarily unavailable';
      setPointsTabLocked(pointsLocked);
      setPointsTabLockMessage(pointsLockMsg);
      const pending = pendingRes?.data || {};
      const releaseDate = pending.release_date || null;
      let preorderOn = false;
      if (releaseDate) {
        try {
          preorderOn = new Date(releaseDate).getTime() > Date.now();
        } catch {
          preorderOn = false;
        }
      }
      setPreorderActive(preorderOn);
      setPreorderReleaseDate(releaseDate);
      const nextAutoCredit = pending.store_points_auto_credit !== false;
      const nextManualEta = pending.manual_credit_eta ?? null;
      const nextPendingPts = pending.pending_points || 0;
      setStorePointsAutoCredit(nextAutoCredit);
      setManualCreditEta(nextManualEta);
      setPendingPoints(nextPendingPts);
      const txs = await fetchPaymentTransactions();
      writeSessionJson(STORE_PAGE_CACHE_KEY, {
        user: userRes.data,
        boozeConfig: nextBooze,
        weedEmpireSummary: nextWeed,
        familySafeDepositSummary: nextFamilySafe,
        event: nextEvent,
        eventsEnabled: nextEventsEnabled,
        storePointsEvent: nextStorePointsEvent,
        isAdmin: nextIsAdmin,
        pointsTabLocked: pointsLocked,
        pointsTabLockMessage: pointsLockMsg,
        preorderActive: preorderOn,
        preorderReleaseDate: releaseDate,
        storePointsAutoCredit: nextAutoCredit,
        manualCreditEta: nextManualEta,
        pendingPoints: nextPendingPts,
        paymentTransactions: txs,
      });
    } catch {
      if (!silent) toast.error('Failed to load data');
    }
  }, [fetchPaymentTransactions]);

  const fetchPointsTransfers = useCallback(async () => {
    try {
      const res = await api.get('/store/points-transfers');
      setPointsTransfers(res.data?.transfers || []);
    } catch {
      setPointsTransfers([]);
    }
  }, []);

  const fetchPointsBreakdown = useCallback(async () => {
    setPointsBreakdownLoading(true);
    try {
      const res = await api.get('/store/points-breakdown');
      setPointsBreakdown(res.data || null);
    } catch {
      setPointsBreakdown(null);
    } finally {
      setPointsBreakdownLoading(false);
    }
  }, []);

  const fetchAdminTransfers = useCallback(async () => {
    try {
      const res = await api.get('/store/points-transfers/admin', { params: { limit: 500 } });
      setAdminTransfers(res.data?.transfers || []);
    } catch {
      toast.error('Failed to load admin log');
      setAdminTransfers([]);
    }
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sessionId = sp.get('session_id');
    const paymentCancel = sp.get('payment_cancel');
    // Stripe cancel_url: user backed out — mark checkout abandoned (not paid)
    if (paymentCancel === '1' && sessionId) {
      (async () => {
        try {
          await api.post(`/payments/mark-checkout-cancelled/${encodeURIComponent(sessionId)}`);
          toast.info('Checkout was not completed — no charge was made.');
          await fetchPaymentTransactions();
        } catch {
          toast.error('Could not update checkout status');
        }
        const tab = sp.get('tab');
        window.history.replaceState({}, '', tab ? `/game/store?tab=${encodeURIComponent(tab)}` : '/game/store');
        fetchData();
      })();
      return;
    }
    // Prime session activity before /auth/me: Stripe redirect means no API calls for a long time; inactivity
    // logout + parallel fetchData used to race and clear the token before payment verification.
    (async () => {
      if (sessionId) {
        try {
          await api.get(`/payments/status/${encodeURIComponent(sessionId)}`);
        } catch {
          /* checkPaymentStatus will surface errors; avoid blocking store load */
        }
      }
      const bootForSilent = readSessionJson(STORE_PAGE_CACHE_KEY);
      fetchData({ silent: !!bootForSilent?.user });
      if (sessionId) checkPaymentStatus(sessionId);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'sendpts') {
      fetchPointsTransfers();
      fetchPointsBreakdown();
    }
  }, [activeTab, fetchPointsTransfers, fetchPointsBreakdown]);

  useEffect(() => {
    if (activeTab === 'upgrades') {
      fetchVipPassCarStock();
    }
  }, [activeTab, fetchVipPassCarStock]);

  const checkPaymentStatus = async (sessionId, attempt = 0) => {
    if (attempt >= 5) {
      toast.error('Payment verification timed out.');
      window.history.replaceState({}, '', '/game/store');
      return;
    }
    setCheckingPayment(true);
    try {
      const res = await api.get(`/payments/status/${sessionId}`);
      if (res.data.status === 'fulfillment_blocked' || res.data.payment_status === 'fulfillment_blocked') {
        toast.error(res.data.detail || 'This purchase could not be completed. If you were charged, contact support.');
        refreshUser();
        fetchData();
        fetchPaymentTransactions();
      } else if (res.data.payment_status === 'paid') {
        if (res.data.manual_credit_pending || res.data.status === 'manual_credit_pending') {
          const eta = res.data.manual_credit_eta ? formatGameDateTimeShort(res.data.manual_credit_eta) : null;
          toast.success(
            `Payment received. ${Number(res.data.points_added || 0).toLocaleString()} points will be added manually by staff${eta ? ` (around ${eta})` : ''}.`,
          );
        } else if (res.data.preorder) {
          const releaseDate = res.data.preorder_release_date ? formatGameDateOnly(res.data.preorder_release_date) : 'launch';
          toast.success(`Payment received. ${res.data.points_added} points will be credited on ${releaseDate}.`);
        } else {
          const pts = Number(res.data.points_added || 0);
          if (res.data.auto_rank_entitled) {
            toast.success('Permanent Auto Rank purchased — tied to your verified email.');
          } else if (pts === 0) toast.success('Game Pass purchased — token delivered. Activate in My Inventory.');
          else toast.success(`${pts} points added.`);
        }
        refreshUser();
        fetchData();
        fetchPaymentTransactions();
      } else if (res.data.status === 'expired' || res.data.payment_status === 'expired') {
        toast.error('Session expired.');
      } else if (res.data.payment_status === 'unpaid') {
        toast.info('No payment was completed.');
        fetchPaymentTransactions();
      } else {
        setTimeout(() => checkPaymentStatus(sessionId, attempt + 1), 2000);
        return;
      }
    } catch {
      toast.error('Error checking payment');
    }
    window.history.replaceState({}, '', '/game/store');
    setCheckingPayment(false);
  };

  const apiBuy = async (path, body, successMsg, onSuccess) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await api.post(path, body || {});
      toast.success(successMsg || 'Done');
      refreshUser();
      fetchData();
      if (onSuccess) onSuccess(res.data);
    } catch (e) {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : 'Failed';
      toast.error(msg || 'Failed');
      if (typeof detail === 'string' && detail.includes('Daily cash purchase limit')) {
        fetchTokenCashPrice();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBuyAutoRankStripe = async () => {
    if (autoRankStripeLoading) return;
    if (!user?.email_verified) {
      toast.error('Verify your email before purchasing permanent Auto Rank.');
      return;
    }
    setAutoRankStripeLoading(true);
    try {
      const origin = `${window.location.origin}/game/store?tab=upgrades`;
      const res = await api.post('/payments/checkout', {
        package_id: AUTO_RANK_STRIPE_PACKAGE_ID,
        origin_url: origin,
      });
      window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Checkout failed');
      setAutoRankStripeLoading(false);
    }
  };

  const selectableBundlePickedTotal = SELECTABLE_BUNDLE_ITEMS.reduce(
    (sum, t) => sum + Number(selectableBundleQtyByToken[t.tokenType] || 0),
    0,
  );
  const selectableBundleSubtotalPoints = SELECTABLE_BUNDLE_ITEMS.reduce(
    (sum, t) => sum + (Number(selectableBundleQtyByToken[t.tokenType] || 0) * Number(t.price || 0)),
    0,
  );
  const selectableBundleDiscountPoints = Math.floor((selectableBundleSubtotalPoints * SELECTABLE_BUNDLE_DISCOUNT_PCT) / 100);
  const selectableBundleFinalPoints = Math.max(0, selectableBundleSubtotalPoints - selectableBundleDiscountPoints);
  const selectableBundleFinalRespect = storeRespectForPoints(selectableBundleFinalPoints);
  const selectableBundleSubtotalCash = cashPriceAvailable ? Math.round(selectableBundleSubtotalPoints * cashPricePerPoint) : 0;
  const selectableBundleDiscountCash = cashPriceAvailable ? Math.round(selectableBundleDiscountPoints * cashPricePerPoint) : 0;
  const selectableBundleFinalCash = cashPriceAvailable ? Math.round(selectableBundleFinalPoints * cashPricePerPoint) : 0;
  const selectableBundleCanBuy =
    selectableBundlePickedTotal >= 1 && selectableBundlePickedTotal <= SELECTABLE_BUNDLE_SIZE;
  const selectableBundleSelectionPayload = Object.fromEntries(
    Object.entries(selectableBundleQtyByToken).filter(([, qty]) => Number(qty) > 0),
  );

  const adjustSelectableBundleQty = (tokenType, delta) => {
    setSelectableBundleQtyByToken((prev) => {
      const cur = Number(prev[tokenType] || 0);
      const total = SELECTABLE_BUNDLE_ITEMS.reduce(
        (sum, t) => sum + Number(prev[t.tokenType] || 0),
        0,
      );
      let next = cur + delta;
      if (delta > 0) {
        const room = Math.max(0, SELECTABLE_BUNDLE_SIZE - total);
        next = cur + Math.min(delta, room);
      }
      next = Math.max(0, next);
      if (next === cur) return prev;
      return { ...prev, [tokenType]: next };
    });
  };

  const clearSelectableBundle = () => {
    setSelectableBundleQtyByToken(Object.fromEntries(SELECTABLE_BUNDLE_ITEMS.map((t) => [t.tokenType, 0])));
  };

  const handleCustomPointsPurchase = async () => {
    if (!customQuote?.points || customQuote.points < 1) {
      toast.error('Enter a valid amount and wait for the price preview');
      return;
    }
    setLoading(true);
    try {
      const origin = `${window.location.origin}/game/store`;
      const body =
        customPurchaseMode === 'points'
          ? { package_id: CUSTOM_POINTS_PACKAGE, origin_url: origin, custom_points: customQuote.base_points || customQuote.points }
          : { package_id: CUSTOM_POINTS_PACKAGE, origin_url: origin, custom_gbp: parseFloat(String(customGbpInput).replace(/[^0-9.]/g, '')) || 0 };
      const res = await api.post('/payments/checkout', body);
      window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Checkout failed');
      setLoading(false);
    }
  };

  const handleBuyPointsCash = async () => {
    if (!user?.email_verified) {
      toast.error('Verify your email before buying points with cash');
      return;
    }
    if ((user?.prestige_level ?? 0) < 1) {
      toast.error('Prestige 1+ required to buy points with cash');
      return;
    }
    const p = parseInt(String(pointsCashInput).replace(/\D/g, ''), 10);
    if (!Number.isFinite(p) || p < 1) {
      toast.error('Enter at least 1 point');
      return;
    }
    if (!pointsCashQuote?.can_buy) {
      toast.error('Purchase blocked — check cash balance and monthly allowance');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/store/buy-points-cash', { points: p });
      toast.success(res.data?.message || `+${p.toLocaleString()} points`);
      setPointsCashInput('');
      setPointsCashQuote(null);
      fetchPointsCashPrice();
      refreshUser();
      fetchData({ silent: true });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Purchase failed');
    } finally {
      setLoading(false);
    }
  };

  const formatCashAllowance = (spent, limit) => {
    const s = Number(spent) || 0;
    const l = Number(limit) || 2_000_000_000;
    return `$${s.toLocaleString()} / $${l.toLocaleString()}`;
  };

  const handleCustomBulletsPurchase = async () => {
    const b = parseInt(String(customBullets).replace(/\D/g, ''), 10);
    if (!Number.isFinite(b) || b < 1 || b > CUSTOM_BULLETS_MAX) {
      toast.error(`Enter 1–${CUSTOM_BULLETS_MAX.toLocaleString()} bullets`);
      return;
    }
    const cost = bulletCost(b);
    const respectCost = storeRespectForPoints(cost);
    if (storePayWith === 'points' && (user.points ?? 0) < cost) {
      toast.error(`Need ${cost} pts`);
      return;
    }
    if (storePayWith === 'respect' && (user.respect_points ?? 0) < respectCost) {
      toast.error(`Need ${respectCost} respect`);
      return;
    }
    setLoading(true);
    try {
      await api.post(`/store/buy-bullets?bullets=${b}&pay_with=${encodeURIComponent(storePayWith)}`);
      toast.success(`Bought ${b.toLocaleString()} bullets`);
      setCustomBullets('');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (checkingPayment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <ShoppingBag size={28} className="text-primary/40 animate-pulse" />
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Verifying payment…</span>
      </div>
    );
  }

  return (
    <div className={`space-y-4 sm:space-y-6 ${styles.pageContent} mobile-page-root px-3 sm:px-4 pb-6`} data-testid="store-page" data-page="store">
      <style>{STORE_STYLES}</style>
      <div className="relative store-fade-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] text-zinc-500 font-heading italic">Points, upgrades & bullets</p>
        </div>
        {user != null && (
          <span className="text-sm font-heading font-bold text-primary">
            {Number(user.points ?? 0).toLocaleString()} pts
            <span className="text-mutedForeground font-normal ml-2">· Respect: {Number(user.respect_points ?? 0).toLocaleString()}</span>
          </span>
        )}
      </div>

      {!storePointsAutoCredit && (
        <div className="relative rounded-lg border border-sky-500/30 overflow-hidden bg-sky-500/5">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-sky-500/50 to-transparent" />
          <div className="px-4 py-3">
            <p className="text-[10px] font-heading font-bold text-sky-400 uppercase tracking-[0.15em]">Pre-order point crediting</p>
            <p className="text-[10px] text-zinc-400 font-heading mt-1">
              This applies only to <span className="text-zinc-300">pre-order</span> point purchases: your payment is recorded and staff add points to your account manually.
              {manualCreditEta ? (
                <>
                  {' '}
                  Planned crediting window:{' '}
                  <span className="text-sky-400 font-bold">
                    {formatGameDateTimeShort(manualCreditEta)}
                  </span>
                </>
              ) : null}
              {preorderReleaseDate ? (
                <>
                  {' '}
                  On or after{' '}
                  <span className="text-zinc-300 font-semibold">
                    {formatGameDateTimeShort(preorderReleaseDate)}
                  </span>
                  , new point purchases are credited <span className="text-emerald-400/90">automatically as soon as payment succeeds</span>.
                </>
              ) : (
                <>
                  {' '}
                  After the release date, new point purchases are credited <span className="text-emerald-400/90">automatically as soon as payment succeeds</span>.
                </>
              )}
            </p>
            {pendingPoints > 0 && (
              <p className="text-[10px] text-sky-400 font-heading font-bold mt-2">
                You have {pendingPoints.toLocaleString()} points waiting to be credited
              </p>
            )}
          </div>
          <div className="h-px bg-sky-500/20 mx-3" />
        </div>
      )}

      {storePointsAutoCredit && preorderActive && (
        <div className="relative rounded-lg border border-amber-500/30 overflow-hidden bg-amber-500/5">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
          <div className="px-4 py-3">
            <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-[0.15em]">Pre-Order Mode Active</p>
            <p className="text-[10px] text-zinc-400 font-heading mt-1">
              Points purchased now will be credited on{' '}
              <span className="text-amber-400 font-bold">
                {preorderReleaseDate ? formatGameDateTimeShort(preorderReleaseDate) : 'launch date'}
              </span>
              . Purchases on or after that time are credited <span className="text-emerald-400/90">automatically as soon as payment succeeds</span>.
              {' '}
              <span className="text-violet-400/90">Loot box piece bonuses (~5,000 per £100 GBP charged) release with your points.</span>
            </p>
            {pendingPoints > 0 && (
              <p className="text-[10px] text-amber-400 font-heading font-bold mt-2">
                You have {pendingPoints.toLocaleString()} points pending release
              </p>
            )}
          </div>
          <div className="h-px bg-amber-500/20 mx-3" />
        </div>
      )}

      {storePointsAutoCredit && !preorderActive && pendingPoints > 0 && (
        <div className="relative rounded-lg border border-green-500/30 overflow-hidden bg-green-500/5">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-green-500/50 to-transparent" />
          <div className="px-4 py-3">
            <p className="text-[10px] font-heading font-bold text-green-400 uppercase tracking-[0.15em]">Pending Points Ready</p>
            <p className="text-[10px] text-zinc-400 font-heading mt-1">
              You have <span className="text-green-400 font-bold">{pendingPoints.toLocaleString()}</span> points ready to be credited.
            </p>
            <button
              type="button"
              onClick={handleClaimPendingPoints}
              disabled={claimingPending}
              className="mt-2 px-3 py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30 disabled:opacity-50"
            >
              {claimingPending ? 'Releasing...' : 'Claim Pending Points'}
            </button>
          </div>
          <div className="h-px bg-green-500/20 mx-3" />
        </div>
      )}

      <div className="relative flex gap-1 p-1.5 sm:p-1 rounded-lg overflow-x-auto store-fade-in border border-primary/20 bg-primary/5 scrollbar-thin">
        <div className="h-0.5 absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-t-lg pointer-events-none" aria-hidden />
        <Tab
          active={activeTab === 'points'}
          onClick={() => { setActiveTab('points'); setSearchParams({ tab: 'points' }); }}
          disabled={pointsTabLocked}
        >Points</Tab>
        <Tab active={activeTab === 'sendpts'} onClick={() => { setActiveTab('sendpts'); setSearchParams({ tab: 'sendpts' }); }}>Send pts</Tab>
        <Tab active={activeTab === 'upgrades'} onClick={() => { setActiveTab('upgrades'); setSearchParams({ tab: 'upgrades' }); }}>Upgrades</Tab>
        <Tab active={activeTab === 'tokens'} onClick={() => { setActiveTab('tokens'); setSearchParams({ tab: 'tokens' }); }}>Tokens</Tab>
        <Tab active={activeTab === 'bullets'} onClick={() => { setActiveTab('bullets'); setSearchParams({ tab: 'bullets' }); }}>Bullets</Tab>
      </div>
      {['upgrades', 'tokens', 'bullets'].includes(activeTab) && (
        <div className="mb-2">
          <StorePayWithSelect value={storePayWith} onChange={setStorePayWith} showCash={activeTab === 'tokens'} />
        </div>
      )}

      {activeTab === 'points' && (
        <div className="space-y-3">
          {pointsTabLocked ? (
            <div className={`${styles.panel} rounded-lg border border-primary/20 p-6 text-center mobile-panel`}>
              <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">{pointsTabLockMessage}</p>
              <p className="text-[9px] text-mutedForeground mt-1">Points purchase is temporarily unavailable. Upgrades, bullets, and send pts remain available.</p>
            </div>
          ) : (
          <>
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2 bg-primary/8 border-b border-primary/20">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Buy points</span>
              <p className="text-[8px] text-mutedForeground font-heading mt-0.5 leading-snug">
                {pointsPaymentMode === 'card'
                  ? (
                    <>
                      Enter whole points from 1,000–1,000,000, or a GBP budget — the server prices along the standard store curve (Stripe checkout).
                      {' '}
                      <span className="text-violet-400/90">GBP card checkouts earn ~9,000 loot box pieces per £120 charged</span> (75 per whole £1; credited when your points are).
                    </>
                  )
                  : (
                    <>
                      Buy points with in-game cash at Quick Trade pricing (avg of cheapest 3 sell offers; min $550,000/pt).
                      {' '}
                      Monthly allowance: $2B per IP and per verified email (London month) — purchase must fit under both.
                    </>
                  )}
              </p>
            </div>
            {storePointsEvent?.active && pointsPaymentMode === 'card' && (
              <div className="mx-3 mt-3 rounded border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
                <p className="text-[10px] font-heading font-bold uppercase tracking-[0.14em] text-emerald-400">
                  Store event live: +{Math.round(Number(storePointsEvent.bonus_rate ?? 0.75) * 100)}% points
                </p>
                <p className="text-[9px] font-heading text-zinc-400 mt-0.5">
                  Buy points today and get +{Math.round(Number(storePointsEvent.bonus_rate ?? 0.75) * 100)}% added on top at checkout.
                </p>
              </div>
            )}
            <div className="p-3 space-y-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => { setPointsPaymentMode('card'); setPointsCashQuote(null); }}
                  className={`flex-1 py-1.5 text-[9px] font-heading font-bold uppercase rounded border ${pointsPaymentMode === 'card' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-primary/20 text-mutedForeground'}`}
                >
                  Card
                </button>
                <button
                  type="button"
                  onClick={() => { setPointsPaymentMode('cash'); setCustomQuote(null); }}
                  className={`flex-1 py-1.5 text-[9px] font-heading font-bold uppercase rounded border ${pointsPaymentMode === 'cash' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-primary/20 text-mutedForeground'}`}
                >
                  Cash ($)
                </button>
              </div>
              {pointsPaymentMode === 'card' ? (
              <>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => { setCustomPurchaseMode('points'); setCustomQuote(null); }}
                  className={`flex-1 py-1.5 text-[9px] font-heading font-bold uppercase rounded border ${customPurchaseMode === 'points' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-primary/20 text-mutedForeground'}`}
                >
                  By points
                </button>
                <button
                  type="button"
                  onClick={() => { setCustomPurchaseMode('gbp'); setCustomQuote(null); }}
                  className={`flex-1 py-1.5 text-[9px] font-heading font-bold uppercase rounded border ${customPurchaseMode === 'gbp' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-primary/20 text-mutedForeground'}`}
                >
                  By GBP
                </button>
              </div>
              {customPurchaseMode === 'points' ? (
                <FormattedNumberInput
                  value={customPointsInput}
                  onChange={setCustomPointsInput}
                  placeholder="Points (e.g. 160000)"
                  className="w-full px-3 py-2 text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none text-foreground font-heading"
                />
              ) : (
                <input
                  type="text"
                  inputMode="decimal"
                  value={customGbpInput}
                  onChange={(e) => setCustomGbpInput(e.target.value)}
                  placeholder="GBP (e.g. 40)"
                  className="w-full px-3 py-2 text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none text-foreground font-heading"
                />
              )}
              {customQuote && (
                <p className="text-[10px] font-heading text-zinc-300">
                  {customPurchaseMode === 'points' ? (
                    <>
                      <span className="text-primary font-bold">{Number(customQuote.points).toLocaleString()} pts</span>
                      {Number(customQuote.bonus_points || 0) > 0 && (
                        <span className="text-emerald-400/90"> ({Number(customQuote.base_points || 0).toLocaleString()} + {Number(customQuote.bonus_points || 0).toLocaleString()} bonus)</span>
                      )}
                      {' · '}
                      <span className="text-emerald-400/90">£{Number(customQuote.price_gbp).toFixed(2)}</span>
                      {Number(customQuote.loot_box_pieces || 0) > 0 && (
                        <>
                          {' · '}
                          <span className="text-violet-400/90">{Number(customQuote.loot_box_pieces).toLocaleString()} loot pieces</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      Pay <span className="text-emerald-400/90 font-bold">£{Number(customQuote.price_gbp).toFixed(2)}</span>
                      {' → '}
                      <span className="text-primary font-bold">{Number(customQuote.points).toLocaleString()} pts</span>
                      {Number(customQuote.bonus_points || 0) > 0 && (
                        <span className="text-emerald-400/90"> ({Number(customQuote.base_points || 0).toLocaleString()} + {Number(customQuote.bonus_points || 0).toLocaleString()} bonus)</span>
                      )}
                      {Number(customQuote.loot_box_pieces || 0) > 0 && (
                        <>
                          {' · '}
                          <span className="text-violet-400/90">{Number(customQuote.loot_box_pieces).toLocaleString()} loot pieces</span>
                        </>
                      )}
                      <span className="block text-[8px] text-mutedForeground mt-0.5">GBP mode charges the shown amount (largest whole base points that fit your budget; event bonus is added on top).</span>
                    </>
                  )}
                </p>
              )}
              <button
                type="button"
                onClick={handleCustomPointsPurchase}
                disabled={loading || !customQuote}
                className="w-full min-h-[44px] py-2.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
              >
                {loading ? '...' : 'Buy with card'}
              </button>
              </>
              ) : (
              <>
              {!user?.email_verified ? (
                <p className="text-[9px] text-amber-400/90 font-heading">
                  Verify your email before buying points with cash.{' '}
                  <Link to="/verify-email" className="text-primary underline">Verify email</Link>
                </p>
              ) : (user?.prestige_level ?? 0) < 1 ? (
                <p className="text-[9px] text-amber-400/90 font-heading">
                  Prestige 1+ required to buy points with cash.{' '}
                  <Link to="/account/prestige" className="text-primary underline">Prestige</Link>
                </p>
              ) : (
                <>
                  {pointsCashPriceData && (
                    <div className="text-[9px] font-heading text-zinc-400 space-y-1 rounded border border-primary/15 bg-zinc-900/40 px-2.5 py-2">
                      <p>
                        Price per point:{' '}
                        <span className="text-primary font-bold">${Number(pointsCashPriceData.price_per_point || 0).toLocaleString()}</span>
                        {pointsCashPriceData.used_qt_average
                          ? ' (avg of cheapest 3 QT sell offers)'
                          : ` (floor; min $${Number(pointsCashPriceData.min_price_per_point || 550000).toLocaleString()}/pt)`}
                      </p>
                      <p>
                        Monthly allowance (IP):{' '}
                        <span className="text-zinc-300">{formatCashAllowance(pointsCashPriceData.ip_spent, pointsCashPriceData.monthly_limit)}</span>
                      </p>
                      <p>
                        Monthly allowance (email):{' '}
                        <span className="text-zinc-300">{formatCashAllowance(pointsCashPriceData.email_spent, pointsCashPriceData.monthly_limit)}</span>
                      </p>
                      <p>
                        Effective remaining:{' '}
                        <span className="text-emerald-400/90 font-bold">${Number(pointsCashPriceData.effective_remaining || 0).toLocaleString()}</span>
                      </p>
                    </div>
                  )}
                  <FormattedNumberInput
                    value={pointsCashInput}
                    onChange={setPointsCashInput}
                    placeholder="Points (e.g. 100)"
                    className="w-full px-3 py-2 text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none text-foreground font-heading"
                  />
                  {pointsCashQuote && (
                    <p className="text-[10px] font-heading text-zinc-300">
                      <span className="text-primary font-bold">{Number(pointsCashQuote.points).toLocaleString()} pts</span>
                      {' · '}
                      <span className="text-emerald-400/90">${Number(pointsCashQuote.cash_cost).toLocaleString()}</span>
                      {!pointsCashQuote.prestige_eligible && (
                        <span className="block text-amber-400/90 mt-0.5">Prestige 1+ required</span>
                      )}
                      {pointsCashQuote.prestige_eligible && !pointsCashQuote.fits_caps && (
                        <span className="block text-amber-400/90 mt-0.5">Exceeds monthly IP or email allowance</span>
                      )}
                      {pointsCashQuote.prestige_eligible && pointsCashQuote.fits_caps && !pointsCashQuote.sufficient_cash && (
                        <span className="block text-amber-400/90 mt-0.5">Insufficient cash</span>
                      )}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleBuyPointsCash}
                    disabled={loading || !pointsCashQuote?.can_buy}
                    className="w-full min-h-[44px] py-2.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
                  >
                    {loading ? '...' : 'Buy with cash'}
                  </button>
                </>
              )}
              </>
              )}
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>
          </>
          )}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`} data-testid="store-game-pass-inline">
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">{`Game Pass (£${GAME_PASS_PRICE_GBP})`}</span>
              <Package className="text-primary shrink-0" size={14} />
            </div>
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-zinc-400 font-heading">
                {`Opens the Game Pass page — £${GAME_PASS_PRICE_GBP}, rewards & status (grouped with Points, not Combat).`}
              </p>
              <Link
                to="/game-pass"
                className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation flex items-center justify-center gap-2"
              >
                Open Game Pass →
              </Link>
              <p className="text-[8px] text-zinc-500/90 font-heading leading-snug pt-1">
                Not the same as {SILVER_PACK_POINTS.toLocaleString()} pts (£{SILVER_PACK_PRICE_GBP}): that adds spendable points; Game Pass unlocks rank tier rewards, not a points balance.
              </p>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>
        </div>
      )}

      {activeTab === 'sendpts' && (
        <div className="space-y-4 store-fade-in">
          <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 sm:px-4 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Send size={14} className="text-primary shrink-0" />
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Send points to player</span>
            </div>
            <div className="p-3 sm:p-4 space-y-3">
              <input
                type="text"
                placeholder="Recipient username"
                value={sendToUsername}
                onChange={(e) => setSendToUsername(e.target.value)}
                className="w-full px-3 py-2.5 sm:py-2 text-sm sm:text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none min-h-[44px] sm:min-h-0"
              />
              <FormattedNumberInput
                value={sendAmount}
                onChange={setSendAmount}
                placeholder="Amount"
                className="w-full px-3 py-2.5 sm:py-2 text-sm sm:text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none min-h-[44px] sm:min-h-0 text-foreground font-heading"
              />
              <button
                type="button"
                onClick={async () => {
                  const to = sendToUsername.trim();
                  const amt = parseInt(String(sendAmount).replace(/\D/g, ''), 10);
                  if (!to || !Number.isFinite(amt) || amt < 1) {
                    toast.error('Enter username and amount (min 1)');
                    return;
                  }
                  setLoading(true);
                  try {
                    await api.post('/store/send-points', { to_username: to, amount: amt });
                    toast.success(`Sent ${amt.toLocaleString()} points`);
                    setSendToUsername('');
                    setSendAmount('');
                    refreshUser();
                    fetchData();
                    fetchPointsTransfers();
                    fetchPointsBreakdown();
                  } catch (e) {
                    toast.error(e.response?.data?.detail || 'Failed to send');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading || !user || (user?.points ?? 0) < 1}
                className="w-full min-h-[44px] py-3 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
              >
                {loading ? '...' : 'Send'}
              </button>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Package size={14} className="text-primary shrink-0" />
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Points received / sent breakdown</span>
            </div>
            <div className="p-3 space-y-3">
              {pointsBreakdownLoading && !pointsBreakdown ? (
                <p className="text-[10px] text-zinc-500 font-heading italic">Loading…</p>
              ) : (
                <>
                  <div>
                    <p className="text-[9px] font-heading font-bold text-emerald-300/90 uppercase tracking-wider mb-1">Received totals</p>
                    {!(pointsBreakdown?.lines || []).length ? (
                      <p className="text-[10px] text-zinc-500 font-heading italic">No logged points received yet.</p>
                    ) : (
                      <ul className="space-y-1 max-h-40 overflow-y-auto">
                        {(pointsBreakdown.lines || []).map((line, i) => (
                          <li key={`pts-recv-${i}`} className="text-[11px] sm:text-[10px] font-heading text-emerald-200/90 leading-snug">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                    {pointsBreakdown?.totals?.all != null && (
                      <p className="text-[9px] text-zinc-500 font-heading mt-1.5">
                        Logged total received: {(pointsBreakdown.totals.all ?? 0).toLocaleString()} pts
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[9px] font-heading font-bold text-amber-300/90 uppercase tracking-wider mb-1">Sent totals</p>
                    {!(pointsBreakdown?.sent_lines || []).length ? (
                      <p className="text-[10px] text-zinc-500 font-heading italic">No logged points sent yet.</p>
                    ) : (
                      <ul className="space-y-1 max-h-40 overflow-y-auto">
                        {(pointsBreakdown.sent_lines || []).map((line, i) => (
                          <li key={`pts-sent-${i}`} className="text-[11px] sm:text-[10px] font-heading text-amber-200/85 leading-snug">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                    {pointsBreakdown?.sent_totals?.all != null && (
                      <p className="text-[9px] text-zinc-500 font-heading mt-1.5">
                        Logged total sent: {(pointsBreakdown.sent_totals.all ?? 0).toLocaleString()} pts
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[9px] font-heading font-bold text-emerald-300/90 uppercase tracking-wider mb-1">Each received</p>
                    <p className="text-[9px] text-zinc-500 font-heading mb-1">MDG shows host / opponents; balance before→after when available.</p>
                    {!(pointsBreakdown?.received_transactions || []).length ? (
                      <p className="text-[10px] text-zinc-500 font-heading italic">No per-event received rows.</p>
                    ) : (
                      <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                        {(pointsBreakdown.received_transactions || []).map((tx, i) => (
                          <li key={tx.id || `recv-tx-${i}`} className="text-[11px] sm:text-[10px] font-heading text-emerald-100/90 leading-snug">
                            {tx.line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-[9px] font-heading font-bold text-amber-300/90 uppercase tracking-wider mb-1">Each sent out</p>
                    {!(pointsBreakdown?.sent_transactions || []).length ? (
                      <p className="text-[10px] text-zinc-500 font-heading italic">No per-event sent rows.</p>
                    ) : (
                      <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                        {(pointsBreakdown.sent_transactions || []).map((tx, i) => (
                          <li key={tx.id || `sent-tx-${i}`} className="text-[11px] sm:text-[10px] font-heading text-amber-100/90 leading-snug">
                            {tx.line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <ArrowRightLeft size={14} className="text-primary shrink-0" />
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Last 10 points transactions</span>
            </div>
            <div className="p-3">
              {pointsTransfers.length === 0 ? (
                <p className="text-[10px] text-zinc-500 font-heading italic">No transfers yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {pointsTransfers.map((t) => (
                    <StorePointsTransferRow key={t.id} t={t} compact={false} />
                  ))}
                </ul>
              )}
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          {isAdmin && (
            <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
              <button
                type="button"
                onClick={() => {
                  if (!adminTransfersOpen && adminTransfers.length === 0) fetchAdminTransfers();
                  setAdminTransfersOpen((v) => !v);
                }}
                className="w-full px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2"
              >
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Admin: last 500 transfers</span>
                {adminTransfersOpen ? <ChevronUp size={14} className="text-primary shrink-0" /> : <ChevronDown size={14} className="text-primary shrink-0" />}
              </button>
              {adminTransfersOpen && (
                <div className="p-3 max-h-80 overflow-y-auto">
                  {adminTransfers.length === 0 ? (
                    <p className="text-[10px] text-zinc-500 font-heading italic">Loading…</p>
                  ) : (
                    <ul className="space-y-1">
                      {adminTransfers.map((t) => (
                        <StorePointsTransferRow key={t.id} t={t} compact />
                      ))}
                    </ul>
                  )}
                  {adminTransfers.length > 0 && (
                    <p className="text-[9px] text-zinc-600 font-heading italic mt-2">{adminTransfers.length} transfers (most recent first).</p>
                  )}
                </div>
              )}
              <div className="store-art-line text-primary mx-3" />
            </div>
          )}
        </div>
      )}

      {activeTab === 'upgrades' && (
        <div className="space-y-6">
          <div className="space-y-2" id="store-permanent-upgrades">
            <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Permanent upgrades & QoL</h2>
            <p className="text-[9px] text-zinc-500 font-heading leading-snug max-w-2xl">
              Includes <span className="text-primary font-bold">Auto Rank</span> for{' '}
              <span className="text-foreground font-semibold">£{AUTO_RANK_STRIPE_PRICE_GBP}</span> (email-tied, permanent) or{' '}
              <span className="text-foreground font-semibold">5,000 pts</span> (account-only).
              {' '}The email-tied card option hides once that email owns permanent Auto Rank.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
          {UPGRADES.filter((u) => {
            if (u.id === 'auto-rank') {
              if (user?.auto_rank_email_entitlement) return false;
            } else {
              const owned = u.ownedKey && user?.[u.ownedKey];
              if (owned) return false;
            }
            // Hide Garage Batch when already at max (100)
            if (u.id === 'garage' && (user?.garage_batch_limit ?? 0) >= 100) return false;
            // Hide Booze Capacity when already at max
            if (u.id === 'booze' && boozeConfig?.capacity_bonus_max != null && (user?.booze_capacity_bonus ?? 0) >= boozeConfig.capacity_bonus_max) return false;
            // Hide Practice Targets when already at max (base 3 + bonus 3)
            if (u.id === 'hitlist-npc-cap' && (Number(user?.hitlist_npc_bonus_slots) || 0) >= 3) return false;
            if (u.id === 'weed-daily-cap' && weedEmpireSummary?.at_max_sell_cap) return false;
            if (u.id === 'family-safe-deposit-tier' && familySafeDepositSummary?.at_max) return false;
            if (u.ownedCheck?.(user)) return false;
            return true;
          }).map((u) => {
            const extra = u.extra?.(user, boozeConfig, weedEmpireSummary, familySafeDepositSummary);
            const priceVal = typeof u.price === 'function' ? Number(u.price(user, boozeConfig)) : Number(u.price);
            const hasAccountOnlyAutoRank = Boolean(
              user?.auto_rank_permanent || (user?.auto_rank_purchased && !user?.auto_rank_trial),
            ) && !user?.auto_rank_email_entitlement;
            const disabled =
              (u.id === 'booze' && boozeConfig?.capacity_bonus_max != null && (user?.booze_capacity_bonus ?? 0) >= boozeConfig.capacity_bonus_max) ||
              (u.id === 'hitlist-npc-cap' && (Number(user?.hitlist_npc_bonus_slots) || 0) >= 3) ||
              (u.id === 'health' && Number(user?.health ?? 100) >= 100) ||
              (u.id === 'weed-daily-cap' && !!weedEmpireSummary?.at_max_sell_cap) ||
              (u.id === 'family-safe-deposit-tier' && !!familySafeDepositSummary?.at_max) ||
              !!u.disabledWhen?.(user);
            const flagLive = !u.flagKey || !!storeItemFlags?.[u.flagKey];
            const comingSoon = !flagLive;
            const staffPreview = comingSoon && isStaff;
            return (
              <div key={u.id} id={u.id === 'auto-rank' ? 'store-auto-rank' : `store-${u.id}`}>
              {u.id === 'auto-rank' ? (
                <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
                  <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                  <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">{u.title}</span>
                    <u.Icon className="text-primary shrink-0" size={14} />
                  </div>
                  <div className="p-2.5">
                    <p className="text-[10px] text-mutedForeground font-heading mb-1.5">{u.desc}</p>
                    {hasAccountOnlyAutoRank ? (
                      <p className="text-[9px] text-emerald-300/90 font-heading mb-2 leading-snug">
                        You already have account-only Auto Rank on this character. Upgrade to email-tied below so it survives death / a new account on the same email.
                      </p>
                    ) : (
                      <p className="text-[9px] text-zinc-500 font-heading mb-2 leading-snug">
                        Card purchase is tied to your verified email — survives if your account dies and you register again with the same email. Points purchase is account-only.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleBuyAutoRankStripe}
                      disabled={autoRankStripeLoading || !user?.email_verified}
                      title={!user?.email_verified ? 'Verify your email to unlock email-tied permanent Auto Rank' : undefined}
                      className="w-full min-h-[44px] py-2.5 text-[10px] font-heading font-bold uppercase rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-50 touch-manipulation"
                    >
                      {autoRankStripeLoading ? '…' : hasAccountOnlyAutoRank ? `Upgrade to email — £${AUTO_RANK_STRIPE_PRICE_GBP}` : `Buy with card £${AUTO_RANK_STRIPE_PRICE_GBP}`}
                    </button>
                    {!user?.email_verified ? (
                      <p className="text-[9px] text-amber-400/90 font-heading mt-1.5">Verify your email in Profile before buying with card.</p>
                    ) : null}
                    {!hasAccountOnlyAutoRank ? (
                    <button
                      type="button"
                      onClick={() => apiBuy(`${u.path}?pay_with=${encodeURIComponent(storePayWith)}`, {}, 'Purchased')}
                      disabled={
                        loading
                        || disabled
                        || (storePayWith === 'points'
                          ? (user?.points ?? 0) < priceVal
                          : storePayWith === 'respect'
                            ? storeRespectForPoints(priceVal) > (user?.respect_points ?? 0)
                            : ((user?.points ?? 0) < priceVal && storeRespectForPoints(priceVal) > (user?.respect_points ?? 0)))
                      }
                      className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 mt-2 touch-manipulation"
                    >
                      {loading
                        ? '...'
                        : storePayWith === 'points'
                          ? `${priceVal} pts`
                          : storePayWith === 'respect'
                            ? `${storeRespectForPoints(priceVal)} resp`
                            : `${priceVal} pts or ${storeRespectForPoints(priceVal)} resp`}
                    </button>
                    ) : (
                      <div className="mt-2 py-1.5 text-center text-[10px] font-heading font-bold text-primary uppercase border border-primary/20 rounded bg-primary/5">
                        Account-only — owned
                      </div>
                    )}
                  </div>
                  <div className="store-art-line text-primary mx-3" />
                </div>
              ) : (
              <StoreCard
                title={u.title}
                Icon={u.Icon}
                desc={u.desc}
                price={priceVal}
                respectPrice={u.pointsOnly ? null : storeRespectForPoints(priceVal)}
                owned={u.stackWhileActive ? false : (!!u.activeCheck?.(user) || !!(u.ownedKey && user?.[u.ownedKey]))}
                ownedLabel={u.activeCheck?.(user) ? 'Active' : undefined}
                loading={loading}
                disabled={disabled}
                comingSoon={comingSoon}
                staffPreview={staffPreview}
                user={user}
                payWith={storePayWith}
                onBuy={() => {
                  const body = u.needsGlowPreset ? { preset_id: glowPresetId } : {};
                  apiBuy(`${u.path}?pay_with=${encodeURIComponent(storePayWith)}`, body, 'Purchased');
                }}
              >
                {u.needsGlowPreset && (
                  <GlowPresetPicker
                    value={glowPresetId}
                    onChange={setGlowPresetId}
                    buttonClassName="mb-1.5 text-[9px] font-heading px-2 py-1 rounded border border-zinc-700 flex items-center gap-1.5 hover:border-zinc-500"
                  />
                )}
                {extra && (
                  <p className="text-[10px] text-mutedForeground mb-1">{extra.line ? `${extra.line}: ` : 'Current: '}{extra.value}</p>
                )}
              </StoreCard>
              )}
              </div>
            );
          })}
            </div>
          </div>

          {/* VIP Pass Car — limited game-wide stock (stock from GET /store/vip-pass-car-stock, not /me) */}
          {(() => {
            const vipInGame = Number(vipPassCarStock?.vip_pass_car_in_game ?? user?.vip_pass_car_in_game ?? 0);
            const vipLimit = Number(vipPassCarStock?.vip_pass_car_purchase_limit ?? user?.vip_pass_car_purchase_limit ?? 5);
            const vipOwned = Number(vipPassCarStock?.vip_pass_car_count ?? user?.vip_pass_car_count ?? 0);
            const vipSoldOut = vipInGame >= vipLimit;
            return (
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
              <div className="px-3 py-2.5 bg-cyan-500/8 border-b border-cyan-500/20 flex items-center justify-between gap-2">
                <span className="text-[10px] font-heading font-bold text-cyan-400 uppercase tracking-[0.15em]">VIP Pass Car</span>
                <Car className="text-cyan-400 shrink-0" size={14} />
              </div>
              <div className="p-2.5">
                <p className="text-[10px] text-mutedForeground font-heading mb-1.5">
                  9s travel, +50% booze cargo while owned, custom image, survives death. Only {vipLimit} store copies game-wide — VIP Game Pass tier 100 still grants one free (does not use store stock).
                </p>
                <p className="text-[10px] text-mutedForeground mb-1.5">
                  Store stock: <span className="text-cyan-300 font-bold">{vipInGame}</span>
                  /{vipLimit}
                  {vipOwned > 0 ? (
                    <span className="text-mutedForeground"> · You own {vipOwned}</span>
                  ) : null}
                </p>
                <button
                  type="button"
                  onClick={() => apiBuy(
                    `/store/buy-vip-pass-car?pay_with=${encodeURIComponent(storePayWith)}`,
                    {},
                    'VIP Pass Car purchased',
                    (data) => {
                      if (data) {
                        setVipPassCarStock({
                          vip_pass_car_in_game: Number(data.vip_pass_car_in_game ?? vipInGame),
                          vip_pass_car_purchase_limit: Number(data.vip_pass_car_purchase_limit ?? vipLimit),
                          vip_pass_car_count: Number(data.vip_pass_car_count ?? vipOwned),
                        });
                      } else {
                        fetchVipPassCarStock();
                      }
                    },
                  )}
                  disabled={
                    !user
                    || vipSoldOut
                    || (
                      storePayWith === 'points'
                        ? (user.points ?? 0) < VIP_PASS_CAR_COST_POINTS
                        : (user.respect_points ?? 0) < storeRespectForPoints(VIP_PASS_CAR_COST_POINTS)
                    )
                  }
                  className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/35 hover:bg-cyan-500/25 disabled:opacity-50 touch-manipulation"
                >
                  {vipSoldOut
                    ? `Sold out (${vipInGame}/${vipLimit})`
                    : storePayWith === 'points'
                      ? `${VIP_PASS_CAR_COST_POINTS.toLocaleString()} pts`
                      : `${storeRespectForPoints(VIP_PASS_CAR_COST_POINTS)} resp`}
                </button>
              </div>
              <div className="store-art-line text-primary mx-3" />
            </div>
            );
          })()}

          {/* Custom Car — always show (can buy multiple) */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Custom Car</span>
                <Car className="text-primary shrink-0" size={14} />
              </div>
              <div className="p-2.5">
                <p className="text-[10px] text-mutedForeground font-heading mb-1.5">Named car, 12s travel, below Exclusive.</p>
                <input
                  type="text"
                  placeholder="Name (2–30 chars)"
                  value={customCarName}
                  onChange={(e) => setCustomCarName(e.target.value)}
                  maxLength={30}
                  className="w-full px-2 py-1.5 text-xs bg-zinc-900/50 border border-zinc-700/50 rounded mb-1.5 focus:border-primary/50 focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const name = customCarName.trim();
                      if (!name || name.length < 2) {
                        toast.error('Name 2+ characters');
                        return;
                      }
                      if (containsProfanity(name)) {
                        toast.error('Custom car name contains disallowed language.');
                        return;
                      }
                      apiBuy(`/store/buy-custom-car?pay_with=${encodeURIComponent(storePayWith)}`, { car_name: name }, 'Custom car purchased').then(() => setCustomCarName(''));
                    }}
                    disabled={
                      !user
                      || !customCarName.trim()
                      || (
                        storePayWith === 'points'
                          ? (user.points ?? 0) < 500
                          : (user.respect_points ?? 0) < storeRespectForPoints(500)
                      )
                    }
                    className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                  >
                    {storePayWith === 'points' ? '500 pts' : `${storeRespectForPoints(500)} resp`}
                  </button>
                </div>
              </div>
              <div className="store-art-line text-primary mx-3" />
            </div>
        </div>
      )}

      {activeTab === 'tokens' && (
        <div className="space-y-6">
          {user && (Number(user.token_points_spent || 0) > 0 || Number(user.token_respect_spent || 0) > 0 || Number(user.token_cash_spent || 0) > 0) && (
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded border border-primary/20 bg-primary/5">
              <span className="text-[9px] font-heading text-zinc-400 uppercase tracking-wider">Spent on tokens:</span>
              {Number(user.token_points_spent || 0) > 0 && (
                <span className="text-[9px] font-heading text-zinc-300">
                  <span className="text-primary font-bold">{Number(user.token_points_spent).toLocaleString()}</span> pts
                </span>
              )}
              {Number(user.token_respect_spent || 0) > 0 && (
                <span className="text-[9px] font-heading text-zinc-300">
                  <span className="text-primary font-bold">{Number(user.token_respect_spent).toLocaleString()}</span> respect
                </span>
              )}
              {Number(user.token_cash_spent || 0) > 0 && (
                <span className="text-[9px] font-heading text-zinc-300">
                  <span className="text-primary font-bold">${Number(user.token_cash_spent).toLocaleString()}</span> cash
                </span>
              )}
            </div>
          )}
          {storePayWith === 'cash' && (
            <div className="flex flex-wrap items-center gap-3">
              {cashPriceAvailable ? (
                <>
                  <span className="text-[9px] font-heading text-zinc-500">
                    Price per point: <span className="text-primary font-bold">${Math.round(cashPricePerPoint).toLocaleString()}</span>
                    <span className="text-zinc-600 ml-1">
                      {cashPriceUsesQtAvg
                        ? `(avg of cheapest 3 QT sell offers; min $${Math.round(cashMinPricePerPoint).toLocaleString()}/pt)`
                        : `(default $${Math.round(cashPricePerPoint).toLocaleString()}/pt — fewer than 3 QT sell offers)`}
                    </span>
                  </span>
                  <span className="text-[9px] font-heading text-zinc-500">
                    Daily: <span className={`font-bold ${cashPurchasesToday >= cashPurchasesLimit ? 'text-red-400' : 'text-primary'}`}>{cashPurchasesToday}/{cashPurchasesLimit}</span> used
                  </span>
                </>
              ) : (
                <span className="text-[9px] font-heading text-red-400/80">Could not load cash price — try again.</span>
              )}
            </div>
          )}

          <div className="space-y-2">
            <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Consumable tokens</h2>
            <p className="text-[9px] text-zinc-500 font-heading italic max-w-2xl">
              Buy unactivated tokens. Activate from My Inventory. Also tradable via Quick Trade — store prices are a points sink for convenience.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
              {TOKEN_STORE_ITEMS.map((t) => {
                const held = Number(user?.[t.userKey] ?? 0);
                const maxQty = tokenBuyMaxQty(t.tokenType);
                const bigStep = maxQty >= 1000 ? 100 : 10;
                const qty = Math.max(1, Math.min(maxQty, Number(tokenBuyQtyByType[t.tokenType] || 1)));
                const totalPts = t.price * qty;
                const totalRespect = storeRespectForPoints(totalPts);
                const tokenCashPrice = cashPriceAvailable ? Math.round(t.price * cashPricePerPoint) : 0;
                const totalCash = cashPriceAvailable ? Math.round(tokenCashPrice * qty) : 0;
                const flagLive = !t.flagKey || !!storeItemFlags?.[t.flagKey];
                const comingSoon = !flagLive;
                const staffPreview = comingSoon && isStaff;
                return (
                  <StoreCard
                    key={t.tokenType}
                    title={t.title}
                    Icon={Package}
                    desc={t.desc}
                    price={totalPts}
                    respectPrice={totalRespect}
                    owned={false}
                    loading={loading}
                    disabled={storePayWith === 'cash' && cashPurchasesToday >= cashPurchasesLimit}
                    comingSoon={comingSoon}
                    staffPreview={staffPreview}
                    user={user}
                    payWith={storePayWith}
                    cashPrice={storePayWith === 'cash' ? totalCash : undefined}
                    onBuy={() => {
                      const buyQty = qty;
                      const okMsg = buyQty === 1 ? `+1 ${t.title}` : `+${buyQty} ${t.title}`;
                      if (storePayWith === 'cash') {
                        apiBuy('/store/buy-token-cash', { token_type: t.tokenType, amount: buyQty }, okMsg, (d) => {
                          if (d?.cash_purchases_today != null) setCashPurchasesToday(d.cash_purchases_today);
                        });
                      } else {
                        apiBuy(`/store/buy-token?pay_with=${encodeURIComponent(storePayWith)}`, { token_type: t.tokenType, amount: buyQty }, okMsg);
                      }
                    }}
                  >
                    <p className="text-[10px] text-mutedForeground mb-1.5">Held: {held.toLocaleString()} · {t.price} pts each · buy up to {maxQty.toLocaleString()}</p>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <button
                        type="button"
                        onClick={() => setTokenBuyQty(t.tokenType, qty - bigStep)}
                        disabled={qty <= 1}
                        className="min-h-[32px] min-w-[32px] rounded border border-primary/30 bg-primary/10 text-primary text-[9px] font-bold disabled:opacity-40"
                        title={`−${bigStep}`}
                      >
                        −{bigStep}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTokenBuyQty(t.tokenType, qty - 1)}
                        disabled={qty <= 1}
                        className="min-h-[32px] min-w-[32px] rounded border border-primary/30 bg-primary/10 text-primary font-bold disabled:opacity-40"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={maxQty}
                        value={qty}
                        onChange={(e) => setTokenBuyQty(t.tokenType, e.target.value)}
                        className="flex-1 min-w-0 h-8 rounded border border-primary/30 bg-background/80 px-2 text-center text-[11px] font-heading font-bold text-foreground tabular-nums"
                        aria-label={`${t.title} quantity`}
                      />
                      <button
                        type="button"
                        onClick={() => setTokenBuyQty(t.tokenType, qty + 1)}
                        disabled={qty >= maxQty}
                        className="min-h-[32px] min-w-[32px] rounded border border-primary/30 bg-primary/10 text-primary font-bold disabled:opacity-40"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => setTokenBuyQty(t.tokenType, qty + bigStep)}
                        disabled={qty >= maxQty}
                        className="min-h-[32px] min-w-[32px] rounded border border-primary/30 bg-primary/10 text-primary text-[9px] font-bold disabled:opacity-40"
                        title={`+${bigStep}`}
                      >
                        +{bigStep}
                      </button>
                    </div>
                    <p className="text-[9px] text-zinc-500 font-heading mb-0.5 tabular-nums">
                      {qty} × {t.price} pts = <span className="text-primary font-bold">{totalPts.toLocaleString()} pts</span>
                      {storePayWith === 'respect' || storePayWith === 'auto' ? (
                        <> · <span className="text-zinc-400">{totalRespect.toLocaleString()} resp</span></>
                      ) : null}
                      {storePayWith === 'cash' && cashPriceAvailable ? (
                        <> · <span className="text-zinc-400">${totalCash.toLocaleString()}</span></>
                      ) : null}
                    </p>
                  </StoreCard>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Build your bundle (up to {SELECTABLE_BUNDLE_SIZE})</h2>
            <p className="text-[9px] text-zinc-500 font-heading italic max-w-2xl">
              Pick 1–{SELECTABLE_BUNDLE_SIZE} eligible tokens (duplicates allowed). {SELECTABLE_BUNDLE_DISCOUNT_PCT}% off the subtotal. Game Pass token is excluded.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
              {SELECTABLE_BUNDLE_ITEMS.map((t) => {
                const held = Number(user?.[t.userKey] ?? 0);
                const picked = Number(selectableBundleQtyByToken[t.tokenType] || 0);
                const canAdd = selectableBundlePickedTotal < SELECTABLE_BUNDLE_SIZE;
                const canRemove = picked > 0;
                return (
                  <div key={`sel-${t.tokenType}`} className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
                    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                    <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] truncate">{t.title}</span>
                      <Package className="text-primary shrink-0" size={14} />
                    </div>
                    <div className="p-2.5">
                      <p className="text-[9px] text-mutedForeground font-heading mb-1.5">{t.desc}</p>
                      <p className="text-[10px] text-mutedForeground mb-1.5">
                        Held: {held.toLocaleString()} · {t.price} pts each
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => adjustSelectableBundleQty(t.tokenType, -10)}
                          disabled={!canRemove}
                          className="min-h-[36px] min-w-[36px] rounded border border-primary/30 bg-primary/10 text-primary text-[9px] font-bold disabled:opacity-40"
                          title="Remove 10"
                        >
                          −10
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustSelectableBundleQty(t.tokenType, -1)}
                          disabled={!canRemove}
                          className="min-h-[36px] min-w-[36px] rounded border border-primary/30 bg-primary/10 text-primary font-bold disabled:opacity-40"
                        >
                          -
                        </button>
                        <div className="flex-1 text-center text-[11px] font-heading font-bold text-foreground tabular-nums">{picked}</div>
                        <button
                          type="button"
                          onClick={() => adjustSelectableBundleQty(t.tokenType, +1)}
                          disabled={!canAdd}
                          className="min-h-[36px] min-w-[36px] rounded border border-primary/30 bg-primary/10 text-primary font-bold disabled:opacity-40"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustSelectableBundleQty(t.tokenType, +10)}
                          disabled={!canAdd}
                          className="min-h-[36px] min-w-[36px] rounded border border-primary/30 bg-primary/10 text-primary text-[9px] font-bold disabled:opacity-40"
                          title="Add 10"
                        >
                          +10
                        </button>
                      </div>
                    </div>
                    <div className="store-art-line text-primary mx-3" />
                  </div>
                );
              })}
            </div>
            <div className="rounded border border-primary/20 bg-primary/5 p-3">
              <p className="text-[10px] font-heading text-zinc-300">
                Selected: <span className="text-primary font-bold">{selectableBundlePickedTotal}/{SELECTABLE_BUNDLE_SIZE}</span>
                {' · '}
                Subtotal:{' '}
                <span className="font-bold">
                  {storePayWith === 'cash' ? `$${selectableBundleSubtotalCash.toLocaleString()}` : `${selectableBundleSubtotalPoints.toLocaleString()} pts`}
                </span>
                {' · '}
                Discount:{' '}
                <span className="text-emerald-400/90 font-bold">
                  {SELECTABLE_BUNDLE_DISCOUNT_PCT}% ({storePayWith === 'cash' ? `$${selectableBundleDiscountCash.toLocaleString()}` : `${selectableBundleDiscountPoints.toLocaleString()} pts`})
                </span>
                {' · '}
                Final:{' '}
                <span className="text-primary font-bold">
                  {storePayWith === 'cash' ? `$${selectableBundleFinalCash.toLocaleString()}` : `${selectableBundleFinalPoints.toLocaleString()} pts`}
                </span>
              </p>
              {storePayWith === 'cash' && (
                <p className="text-[9px] text-zinc-500 font-heading mt-1">
                  Cash total: {cashPriceAvailable ? <span className="text-primary font-bold">${selectableBundleFinalCash.toLocaleString()}</span> : 'Unavailable'}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!selectableBundleCanBuy) {
                      toast.error(`Pick 1–${SELECTABLE_BUNDLE_SIZE} tokens`);
                      return;
                    }
                    if (storePayWith === 'cash') {
                      apiBuy('/store/buy-token-selectable-bundle-cash', { selections: selectableBundleSelectionPayload }, 'Selectable bundle purchased', (d) => {
                        if (d?.cash_purchases_today != null) setCashPurchasesToday(d.cash_purchases_today);
                        clearSelectableBundle();
                      });
                      return;
                    }
                    apiBuy(
                      `/store/buy-token-selectable-bundle?pay_with=${encodeURIComponent(storePayWith)}`,
                      { selections: selectableBundleSelectionPayload },
                      'Selectable bundle purchased',
                      () => clearSelectableBundle(),
                    );
                  }}
                  disabled={
                    loading
                    || !user
                    || !selectableBundleCanBuy
                    || (storePayWith === 'cash'
                      ? (!cashPriceAvailable
                        || cashPurchasesToday + selectableBundlePickedTotal > cashPurchasesLimit
                        || (user.money ?? 0) < selectableBundleFinalCash)
                      : (storePayWith === 'points'
                        ? (user.points ?? 0) < selectableBundleFinalPoints
                        : (user.respect_points ?? 0) < selectableBundleFinalRespect))
                  }
                  className="min-h-[40px] rounded border border-primary/40 bg-primary/20 px-3 py-2 text-[10px] font-heading font-bold uppercase text-primary hover:bg-primary/30 disabled:opacity-50"
                >
                  {storePayWith === 'cash'
                    ? `Buy bundle · $${selectableBundleFinalCash.toLocaleString()}`
                    : storePayWith === 'respect'
                      ? `Buy bundle · ${selectableBundleFinalRespect.toLocaleString()} resp`
                      : `Buy bundle · ${selectableBundleFinalPoints.toLocaleString()} pts`}
                </button>
                <button
                  type="button"
                  onClick={clearSelectableBundle}
                  disabled={loading || selectableBundlePickedTotal === 0}
                  className="min-h-[40px] rounded border border-zinc-700/60 bg-zinc-900/40 px-3 py-2 text-[10px] font-heading font-bold uppercase text-zinc-300 hover:bg-zinc-800/50 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Token bundles</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-2">
              {TOKEN_BUNDLES.map((b) => {
                const bundleCashPrice = cashPriceAvailable ? Math.round(b.price * cashPricePerPoint) : 0;
                return (
                  <StoreCard
                    key={b.id}
                    title={b.title}
                    Icon={Package}
                    desc={b.desc}
                    price={b.price}
                    respectPrice={storeRespectForPoints(b.price)}
                    owned={false}
                    loading={loading}
                    disabled={!user || (storePayWith === 'cash' && cashPurchasesToday >= cashPurchasesLimit)}
                    user={user}
                    payWith={storePayWith}
                    cashPrice={storePayWith === 'cash' ? bundleCashPrice : undefined}
                    onBuy={() => {
                      if (storePayWith === 'cash') {
                        apiBuy('/store/buy-token-bundle-cash', { bundle_id: b.id }, 'Bundle purchased', (d) => {
                          if (d?.cash_purchases_today != null) setCashPurchasesToday(d.cash_purchases_today);
                        });
                      } else {
                        apiBuy(`/store/buy-token-bundle?pay_with=${encodeURIComponent(storePayWith)}`, { bundle_id: b.id }, 'Bundle purchased');
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'bullets' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-2">
            {BULLET_PACKS.map((pack) => {
              const respectCost = storeRespectForPoints(pack.cost);
              const canAfford =
                user
                && (storePayWith === 'points'
                  ? (user.points ?? 0) >= pack.cost
                  : (user.respect_points ?? 0) >= respectCost);
              return (
                <div key={pack.bullets} className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
                  <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                  <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-center gap-1.5">
                    <Crosshair size={14} className="text-primary shrink-0" />
                    <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{(pack.bullets / 1000).toFixed(0)}k bullets</span>
                  </div>
                  <div className="p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500 font-heading mb-2">
                      {storePayWith === 'points' ? `${pack.cost} pts` : `${respectCost} resp`}
                    </p>
                    <button
                      type="button"
                      onClick={() => apiBuy(`/store/buy-bullets?bullets=${pack.bullets}&pay_with=${encodeURIComponent(storePayWith)}`, null, `Bought ${pack.bullets.toLocaleString()} bullets`)}
                      disabled={!canAfford}
                      className="w-full min-h-[44px] py-2.5 sm:py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                    >
                      {storePayWith === 'points' ? `Buy · ${pack.cost} pts` : `Buy · ${respectCost} resp`}
                    </button>
                  </div>
                  <div className="store-art-line text-primary mx-3" />
                </div>
              );
            })}
          </div>
          <div className={`relative rounded-lg border border-primary/20 overflow-hidden bg-zinc-900/50`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="p-3 text-center">
              <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Custom amount</p>
              <FormattedNumberInput
                value={customBullets}
                onChange={setCustomBullets}
                placeholder={`Up to ${CUSTOM_BULLETS_MAX.toLocaleString()}`}
                className="w-full mt-1 px-3 py-2 text-lg font-heading font-bold text-primary bg-zinc-900/80 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none text-center"
              />
              <p className="text-[10px] text-zinc-500 font-heading italic mt-1">
                {customBullets ? (
                  (() => {
                    const b = parseInt(String(customBullets).replace(/\D/g, ''), 10);
                    if (!Number.isFinite(b) || b < 1) return null;
                    if (b > CUSTOM_BULLETS_MAX) return '—';
                    const c = bulletCost(b);
                    const r = storeRespectForPoints(c);
                    return storePayWith === 'points' ? `${c} pts` : `${r} resp`;
                  })() || '—'
                ) : (
                  '—'
                )}
              </p>
            </div>
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={handleCustomBulletsPurchase}
                disabled={loading || !user || !customBullets || (() => {
                  const b = parseInt(String(customBullets).replace(/\D/g, ''), 10);
                  if (!Number.isFinite(b) || b < 1 || b > CUSTOM_BULLETS_MAX) return true;
                  const c = bulletCost(b);
                  const r = storeRespectForPoints(c);
                  if (storePayWith === 'points') return (user.points ?? 0) < c;
                  return (user.respect_points ?? 0) < r;
                })()}
                className="w-full min-h-[44px] py-2.5 sm:py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
              >
                {loading ? '...' : 'Buy'}
              </button>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>
        </div>
      )}

      <div className="relative rounded-lg border border-primary/20 overflow-hidden">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 sm:px-4 py-2.5 bg-primary/8 border-b border-primary/20">
          <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Payments</p>
        </div>
        <div className="px-3 sm:px-4 py-3 space-y-2">
          <p className="text-[10px] text-zinc-500 font-heading italic">
            Payments via Stripe.{' '}
            {!storePointsAutoCredit
              ? `Pre-order point purchases are added manually by staff${manualCreditEta ? ` (planned around ${formatGameDateTimeShort(manualCreditEta)}).` : '.'} ${preorderReleaseDate ? `From ${formatGameDateTimeShort(preorderReleaseDate)} onward, new point purchases credit automatically when payment completes.` : 'After release, new point purchases credit automatically when payment completes.'}`
              : preorderActive
                ? 'Pre-order points credit on the release date above; purchases on or after that date credit automatically when payment completes.'
                : 'Point purchases are credited automatically when payment completes.'}
          </p>
          {paymentTransactions.length > 0 ? (
            <div className="rounded border border-primary/20 bg-zinc-900/50 overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 text-[9px] font-heading font-bold text-primary uppercase tracking-wider border-b border-primary/20">
                <span>Date</span>
                <span>Package</span>
                <span className="text-right">Points</span>
                <span>Status</span>
              </div>
              {paymentTransactions.slice(0, 15).map((t, i) => {
                const ui = t.ui_status || '';
                const statusClass =
                  t.payment_status === 'completed'
                    ? 'text-green-400'
                    : t.payment_status === 'preorder_pending'
                      ? 'text-amber-400'
                      : t.payment_status === 'manual_credit_pending'
                        ? 'text-sky-400'
                        : ui.includes('Unpaid')
                          ? 'text-zinc-500'
                          : ui.includes('Paid')
                            ? 'text-emerald-400/90'
                            : 'text-zinc-400';
                const statusText =
                  t.ui_status
                    ? t.ui_status
                    : t.payment_status === 'completed'
                      ? 'Credited'
                      : t.payment_status === 'preorder_pending'
                        ? 'Pre-order'
                        : t.payment_status === 'manual_credit_pending'
                          ? 'Manual credit'
                          : t.payment_status || 'Pending';
                return (
                  <div key={t.session_id || i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 text-[10px] font-heading border-b border-zinc-800/50 last:border-0">
                    <span className="text-mutedForeground truncate" title={t.created_at}>{t.created_at ? formatGameDateTime(t.created_at) : '—'}</span>
                    <span className="capitalize">{t.package_id || '—'}</span>
                    <span className="text-right font-mono">+{Number(t.points || 0).toLocaleString()}</span>
                    <span className={statusClass}>{statusText}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-zinc-600 font-heading italic">No purchases yet.</p>
          )}
        </div>
        <div className="store-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
