import { Activity, BarChart3, Crosshair, FileText, Globe, Layers, Lock, LockKeyhole, Radio, Shield, UserCog, Users, Wrench, Coins, Zap } from 'lucide-react';

export const ADMIN_CATEGORIES = [
  { id: 'admin-operations', label: 'Operations', icon: UserCog },
  { id: 'admin-economy-progression', label: 'Economy & Progression', icon: Coins },
  { id: 'admin-world-systems', label: 'World & Systems', icon: Zap },
  { id: 'admin-analytics-monitoring', label: 'Analytics & Monitoring', icon: BarChart3 },
];

export const MOD_ONLY_CATEGORY_IDS = ['admin-operations', 'admin-analytics-monitoring', 'admin-world-systems'];

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
  { id: 'users-online', label: 'Live online', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: Radio, description: 'Who is online now (IPs, last page, same-IP hints).' },
  { id: 'attack-logs', label: 'Attack logs', categoryId: 'admin-analytics-monitoring', anchorId: 'admin-logs', icon: Crosshair, description: 'PVP attack log console and analytics.' },
  { id: 'witness-statements', label: 'Witness', categoryId: 'admin-operations', anchorId: 'admin-moderation', icon: FileText, description: 'Witness statements review.' },
  { id: 'locked', label: 'Page locks', categoryId: 'admin-operations', anchorId: 'admin-operations', icon: LockKeyhole, description: 'Locked accounts and route / page locks.' },
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
  analytics: 'Stats',
  logs: 'Logs',
  staff: 'Staff',
  engineering: 'Eng',
  'users-online': 'Live',
  'attack-logs': 'Attacks',
  'witness-statements': 'Witness',
  locked: 'Locks',
};
