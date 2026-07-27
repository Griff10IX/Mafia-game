import { Activity, ArrowLeftRight, BarChart3, Building2, Car, Crosshair, Dices, FileText, Flame, Globe, History, Landmark, Layers, Leaf, Lock, LockKeyhole, Radio, Shield, Skull, UserCog, Users, Wrench, Coins, Zap, Wine } from 'lucide-react';

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

/** Standalone /tjjeujr3wa/* routes moderators may open (sidebar, mobile, AdminShell strip). */
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

export const ADMIN_ROUTE_GROUPS = [
  { id: 'overview', label: 'Overview', categoryId: 'admin-operations', anchorId: 'admin-target-username', icon: Activity, description: 'Global tools and quick actions.' },
  { id: 'players', label: 'Players', categoryId: 'admin-operations', anchorId: 'admin-players', icon: Users, description: 'Player lookup, grants, adjustments.' },
  { id: 'moderation', label: 'Moderation', categoryId: 'admin-operations', anchorId: 'admin-moderation', icon: Shield, description: 'Locks, sanctions, and interventions.' },
  { id: 'commerce', label: 'Commerce', categoryId: 'admin-economy-progression', anchorId: 'admin-donations', icon: Coins, description: 'Points, economy, and store controls.' },
  { id: 'liveops', label: 'LiveOps', categoryId: 'admin-world-systems', anchorId: 'admin-gameworld', icon: Globe, description: 'Events, claims, and world toggles.' },
  { id: 'safety', label: 'Safety', categoryId: 'admin-operations', anchorId: 'admin-security', icon: Lock, description: 'Security summary, bans, and anti-abuse.' },
  { id: 'analytics', label: 'Analytics', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-analytics', icon: BarChart3, description: 'KPI dashboards and trend monitors.' },
  { id: 'logs', label: 'Logs', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: Layers, description: 'Audit trails and event logs.' },
  { id: 'staff', label: 'Staff', categoryId: 'admin-operations', anchorId: 'admin-staff', icon: UserCog, description: 'Moderator visibility and staffing tools.' },
  { id: 'engineering', label: 'Engineering', categoryId: 'admin-world-systems', anchorId: 'admin-database', icon: Wrench, description: 'Testing, DB utilities, and diagnostics.' },
  { id: 'users-online', label: 'Online dupe screen', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: Radio, description: 'Who is online now — dupe/proxy screen, shared IPs, fingerprints, likely main account.' },
  { id: 'attack-logs', label: 'Attack logs', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: Crosshair, description: 'PVP attack log console and analytics.' },
  { id: 'ip-history', label: 'Account access', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: History, description: 'Hacked-account check: IPs, devices, shared logins, staff checklist.' },
  { id: 'dead-alive-log', label: 'Dead > Alive log', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: Skull, description: 'Retrieve and revive transfers — points cleared on dead accounts and what recipients received.' },
  { id: 'account-compare', label: 'Account compare', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: ArrowLeftRight, description: 'Compare two accounts: shared IPs, devices, and direct transfers.' },
  { id: 'exclusive-cars', label: 'Exclusive cars', categoryId: 'admin-world-systems', anchorId: 'admin-gameworld', icon: Car, description: 'Remove, transfer, or grant Al Capone / loot-exclusive cars.' },
  { id: 'vip-cars', label: 'VIP Pass cars', categoryId: 'admin-world-systems', anchorId: 'admin-gameworld', icon: Car, description: 'See every VIP Pass Car owner and remove one, several, or all from a player.' },
  { id: 'molotovs', label: 'Ammo', categoryId: 'admin-world-systems', anchorId: 'admin-gameworld', icon: Flame, description: 'Molotov and bullet circulation — totals and who holds what.' },
  { id: 'ent-games', label: 'E-Games audit', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: Dices, description: 'Entertainer Forum dice/gbox/hangman audit: creators, rewards, and whose points funded each game.' },
  { id: 'crew-recovery', label: 'Crew recovery', categoryId: 'admin-operations', anchorId: 'admin-moderation', icon: Building2, description: 'Revive families and restore illegal businesses from kill snapshots.' },
  { id: 'racket-progress', label: 'Racket progress', categoryId: 'admin-economy-progression', anchorId: 'admin-donations', icon: Wine, description: 'Set player racket business progress (ladder, vault, guards, security).' },
  { id: 'distillery-progress', label: 'Distillery progress', categoryId: 'admin-economy-progression', anchorId: 'admin-donations', icon: Wine, description: 'Set distillery progress % or grant equipment levels and special track unlocks (booze rackets).' },
  { id: 'weed-sell-audit', label: 'Weed sell audit', categoryId: 'admin-economy-progression', anchorId: 'admin-donations', icon: Leaf, description: 'Find sell-spam beneficiaries and claw back weed cash / XP / equipment.' },
  { id: 'property-transfer', label: 'Armoury / airport', categoryId: 'admin-world-systems', anchorId: 'admin-gameworld', icon: Landmark, description: 'Transfer or release armoury and airport ownership between players.' },
  { id: 'witness-statements', label: 'Witness', categoryId: 'admin-operations', anchorId: 'admin-moderation', icon: FileText, description: 'Witness statements review.' },
  { id: 'locked', label: 'Page locks', categoryId: 'admin-world-systems', anchorId: 'admin-page-locks', icon: LockKeyhole, description: 'Route / page locks (Lock page under World & Systems).' },
];

export const ADMIN_ROUTE_GROUP_MAP = ADMIN_ROUTE_GROUPS.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {});

/** Short labels for AdminShell mobile route strip (touch-friendly). */
export const ADMIN_ROUTE_GROUP_MOBILE_SHORT = {
  overview: 'Home',
  players: 'Players',
  moderation: 'Mod',
  commerce: 'Commerce',
  liveops: 'LiveOps',
  safety: 'Safety',
  'tool-audit': 'Access',
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
  locked: 'Locks',
};
