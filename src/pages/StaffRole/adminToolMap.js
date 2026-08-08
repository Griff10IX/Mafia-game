import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Building2,
  Car,
  Crosshair,
  Dices,
  FileText,
  Flame,
  Globe,
  History,
  Landmark,
  Layers,
  Leaf,
  Lock,
  LockKeyhole,
  Radio,
  Settings,
  Shield,
  Skull,
  UserCog,
  Users,
  Wrench,
  Coins,
  Zap,
  Wine,
} from 'lucide-react';

export const ADMIN_CATEGORIES = [
  { id: 'admin-operations', label: 'Operations', icon: UserCog },
  { id: 'admin-economy-progression', label: 'Economy & Progression', icon: Coins },
  { id: 'admin-world-systems', label: 'World & Systems', icon: Zap },
  { id: 'admin-analytics-monitoring', label: 'Analytics & Monitoring', icon: BarChart3 },
];

/** Listed staff email but API `is_admin` false (e.g. "Act as normal") — no destructive tools until powers restored. */
export const LISTED_ONLY_STAFF_CATEGORY = { id: 'admin-listed-recovery', label: 'Account', icon: Shield };

/** Default category tabs visible to moderators (admins can narrow via Staff → Categories). */
export const MOD_ONLY_CATEGORY_IDS = ADMIN_CATEGORIES.map((c) => c.id);

/** Standalone /tjjeujr3wa/* routes moderators may open (sidebar, mobile, AdminShell). */
export const MOD_STAFF_ROUTE_IDS = [
  'overview',
  'users-online',
  'witness-statements',
  'attack-logs',
  'ip-history',
  'dead-alive-log',
  'account-compare',
];

export function modStaffRouteGroups(allGroups = ADMIN_ROUTE_GROUPS) {
  const allowed = new Set(MOD_STAFF_ROUTE_IDS);
  return allGroups.filter((g) => allowed.has(g.id));
}

export const ADMIN_CATEGORY_MOBILE_SHORT = {
  'admin-operations': 'Ops',
  'admin-economy-progression': 'Economy',
  'admin-world-systems': 'World',
  'admin-analytics-monitoring': 'Stats',
};

export const LEGACY_CATEGORY_MAP = {
  'admin-players': 'admin-operations',
  'admin-moderation': 'admin-operations',
  'admin-security': 'admin-operations',
  'admin-cheat': 'admin-operations',
  'admin-staff': 'admin-operations',
  'admin-mod-tools': 'admin-operations',
  'admin-donations': 'admin-economy-progression',
  'admin-quick': 'admin-economy-progression',
  'admin-gameworld': 'admin-world-systems',
  'admin-testing': 'admin-world-systems',
  'admin-database': 'admin-world-systems',
  'admin-analytics': 'admin-analytics-monitoring',
  'admin-logs': 'admin-analytics-monitoring',
};

export const LEGACY_CATEGORY_SECTION_ID = {
  'admin-players': 'admin-players',
  'admin-moderation': 'admin-moderation',
  'admin-donations': 'admin-donations',
  'admin-security': 'admin-security',
  'admin-cheat': 'admin-cheat',
  'admin-staff': 'admin-staff',
  'admin-mod-tools': 'admin-mod-tools',
  'admin-gameworld': 'admin-gameworld',
  'admin-testing': 'admin-testing',
  'admin-database': 'admin-database',
  'admin-quick': 'admin-quick',
  'admin-analytics': 'admin-analytics',
  'admin-logs': 'admin-logs',
};

/**
 * Hub → which Admin.js section ids to mount (performance: one hub at a time).
 * Overview does not mount Admin.js.
 */
export const HUB_SECTION_IDS = {
  players: ['admin-search-users', 'admin-players'],
  moderation: ['admin-moderation'],
  safety: ['admin-security', 'admin-cheat'],
  staff: ['admin-staff', 'admin-mod-tools'],
  commerce: ['admin-economy-links', 'admin-donations', 'admin-quicktrade', 'admin-quick'],
  liveops: ['admin-gameworld'],
  engineering: ['admin-testing', 'admin-database'],
  analytics: ['admin-analytics'],
  logs: ['admin-logs'],
};

export const ADMIN_ROUTE_GROUPS = [
  { id: 'overview', label: 'Overview', categoryId: 'admin-operations', kind: 'overview', icon: Activity, description: 'Search tools and jump to any area.' },
  { id: 'players', label: 'Players', categoryId: 'admin-operations', kind: 'hub', hubSection: 'players', anchorId: 'admin-players', icon: Users, description: 'Player lookup, grants, adjustments.' },
  { id: 'moderation', label: 'Moderation', categoryId: 'admin-operations', kind: 'hub', hubSection: 'moderation', anchorId: 'admin-moderation', icon: Shield, description: 'Locks, sanctions, and interventions.' },
  { id: 'safety', label: 'Safety', categoryId: 'admin-operations', kind: 'hub', hubSection: 'safety', anchorId: 'admin-security', icon: Lock, description: 'Security summary, bans, and anti-abuse.' },
  { id: 'staff', label: 'Staff', categoryId: 'admin-operations', kind: 'hub', hubSection: 'staff', anchorId: 'admin-staff', icon: UserCog, description: 'Moderator visibility and staffing tools.' },
  { id: 'crew-recovery', label: 'Crew recovery', categoryId: 'admin-operations', kind: 'standalone', icon: Building2, description: 'Revive families and restore illegal businesses from kill snapshots.' },
  { id: 'witness-statements', label: 'Witness', categoryId: 'admin-operations', kind: 'standalone', icon: FileText, description: 'Witness statements review.' },
  { id: 'commerce', label: 'Commerce', categoryId: 'admin-economy-progression', kind: 'hub', hubSection: 'commerce', anchorId: 'admin-donations', icon: Coins, description: 'Points, economy, and store controls.' },
  { id: 'racket-progress', label: 'Racket progress', categoryId: 'admin-economy-progression', kind: 'standalone', icon: Wine, description: 'Set player racket business progress (ladder, vault, guards, security).' },
  { id: 'distillery-progress', label: 'Distillery progress', categoryId: 'admin-economy-progression', kind: 'standalone', icon: Wine, description: 'Set distillery progress % or grant equipment levels and special track unlocks.' },
  { id: 'weed-sell-audit', label: 'Weed sell audit', categoryId: 'admin-economy-progression', kind: 'standalone', icon: Leaf, description: 'Sell-spam clawback + reset all farm heat for the new heat system.' },
  { id: 'liveops', label: 'LiveOps', categoryId: 'admin-world-systems', kind: 'hub', hubSection: 'liveops', anchorId: 'admin-gameworld', icon: Globe, description: 'Events, claims, and world toggles.' },
  { id: 'engineering', label: 'Engineering', categoryId: 'admin-world-systems', kind: 'hub', hubSection: 'engineering', anchorId: 'admin-testing', icon: Wrench, description: 'Testing, DB utilities, and diagnostics.' },
  { id: 'exclusive-cars', label: 'Exclusive cars', categoryId: 'admin-world-systems', kind: 'standalone', icon: Car, description: 'Remove, transfer, or grant Al Capone / loot-exclusive cars.' },
  { id: 'vip-cars', label: 'VIP Pass cars', categoryId: 'admin-world-systems', kind: 'standalone', icon: Car, description: 'See every VIP Pass Car owner and remove cars from a player.' },
  { id: 'molotovs', label: 'Ammo', categoryId: 'admin-world-systems', kind: 'standalone', icon: Flame, description: 'Molotov and bullet circulation — totals and who holds what.' },
  { id: 'property-transfer', label: 'Armoury / airport', categoryId: 'admin-world-systems', kind: 'standalone', icon: Landmark, description: 'Transfer or release armoury and airport ownership between players.' },
  { id: 'locked', label: 'Locked accounts', categoryId: 'admin-world-systems', kind: 'standalone', icon: LockKeyhole, description: 'Investigation locks on player accounts.' },
  { id: 'analytics', label: 'Analytics', categoryId: 'admin-analytics-monitoring', kind: 'hub', hubSection: 'analytics', anchorId: 'admin-analytics', icon: BarChart3, description: 'KPI dashboards and trend monitors.' },
  { id: 'logs', label: 'Logs', categoryId: 'admin-analytics-monitoring', kind: 'hub', hubSection: 'logs', anchorId: 'admin-logs', icon: Layers, description: 'Audit trails and event logs.' },
  { id: 'users-online', label: 'Online dupe screen', categoryId: 'admin-analytics-monitoring', kind: 'standalone', icon: Radio, description: 'Who is online now — dupe/proxy screen, shared IPs, fingerprints.' },
  { id: 'attack-logs', label: 'Attack logs', categoryId: 'admin-analytics-monitoring', kind: 'standalone', icon: Crosshair, description: 'PVP attack log console and analytics.' },
  { id: 'ip-history', label: 'Account access', categoryId: 'admin-analytics-monitoring', kind: 'standalone', icon: History, description: 'Hacked-account check: IPs, devices, shared logins.' },
  { id: 'dead-alive-log', label: 'Dead > Alive log', categoryId: 'admin-analytics-monitoring', kind: 'standalone', icon: Skull, description: 'Retrieve and revive transfers.' },
  { id: 'account-compare', label: 'Account compare', categoryId: 'admin-analytics-monitoring', kind: 'standalone', icon: ArrowLeftRight, description: 'Compare two accounts: shared IPs, devices, and transfers.' },
  { id: 'ent-games', label: 'E-Games audit', categoryId: 'admin-analytics-monitoring', kind: 'standalone', icon: Dices, description: 'Entertainer Forum dice/gbox/hangman audit.' },
];

export const ADMIN_ROUTE_GROUP_MAP = ADMIN_ROUTE_GROUPS.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {});

export const STANDALONE_ADMIN_SECTIONS = new Set(
  ADMIN_ROUTE_GROUPS.filter((g) => g.kind === 'standalone').map((g) => g.id),
);

export const HUB_ADMIN_SECTIONS = new Set(
  ADMIN_ROUTE_GROUPS.filter((g) => g.kind === 'hub').map((g) => g.id),
);

/** Short labels for mobile nav chips. */
export const ADMIN_ROUTE_GROUP_MOBILE_SHORT = {
  overview: 'Home',
  players: 'Players',
  moderation: 'Mod',
  commerce: 'Commerce',
  liveops: 'LiveOps',
  safety: 'Safety',
  analytics: 'Stats',
  logs: 'Logs',
  staff: 'Staff',
  engineering: 'Eng',
  'users-online': 'Live',
  'attack-logs': 'Attacks',
  'ip-history': 'IPs',
  'dead-alive-log': 'D>A',
  'account-compare': 'Compare',
  'exclusive-cars': 'Cars',
  'vip-cars': 'VIP',
  molotovs: 'Ammo',
  'ent-games': 'E-Games',
  'crew-recovery': 'Crew',
  'racket-progress': 'Racket',
  'distillery-progress': 'Still',
  'weed-sell-audit': 'Weed',
  'property-transfer': 'Props',
  'witness-statements': 'Witness',
  locked: 'Locked',
};

/** In-game Layout sidebar: Admin Tools entry + short favorites. */
export const LAYOUT_STAFF_FAVORITE_IDS = [
  'overview',
  'users-online',
  'attack-logs',
  'locked',
  'witness-statements',
  'ip-history',
  'account-compare',
];

export function buildLayoutStaffNavItems({ isAdmin, isModerator } = {}) {
  const ids = isAdmin
    ? LAYOUT_STAFF_FAVORITE_IDS
    : LAYOUT_STAFF_FAVORITE_IDS.filter((id) => MOD_STAFF_ROUTE_IDS.includes(id));
  return ids.map((id) => {
    const group = ADMIN_ROUTE_GROUP_MAP[id];
    const Icon = id === 'overview'
      ? (isAdmin ? Settings : Shield)
      : (group?.icon || Shield);
    const label = id === 'overview'
      ? (isAdmin ? 'Admin Tools' : 'Moderator tools')
      : (group?.label || id);
    return { path: `/tjjeujr3wa/${id}`, icon: Icon, label };
  }).filter((item) => isAdmin || isModerator);
}

/** Routes grouped under each category for shell sidebar. */
export function routesByCategory(groups = ADMIN_ROUTE_GROUPS) {
  const map = Object.fromEntries(ADMIN_CATEGORIES.map((c) => [c.id, []]));
  for (const g of groups) {
    if (!map[g.categoryId]) map[g.categoryId] = [];
    map[g.categoryId].push(g);
  }
  return map;
}

export function hubAllowsSection(hubId, sectionId) {
  const allowed = HUB_SECTION_IDS[hubId];
  if (!allowed) return false;
  return allowed.includes(sectionId);
}

export { SEARCHABLE_TOOLS } from './adminSearchableTools';
