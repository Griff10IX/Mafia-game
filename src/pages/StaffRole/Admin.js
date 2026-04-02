import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useLocation, Navigate } from 'react-router-dom';
import { Settings, UserCog, Coins, Car, Lock, Skull, Bot, Crosshair, Shield, Building2, Zap, Gift, Trash2, Clock, ChevronDown, ChevronRight, ScrollText, Dice5, AlertTriangle, Palette, Users, Mail, LogOut, KeyRound, User, LayoutGrid, Info, X, HelpCircle, BarChart3, Wrench, Database, Globe, Activity, Bell, Layers, DollarSign, Trophy, Search, Award, Image, HandCoins, Wine, Landmark, UserCircle, Eye, Receipt } from 'lucide-react';
import api, { imageHostPublicUrl } from '../../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const ADMIN_STYLES = `
  .admin-fade-in { animation: admin-fade-in 0.4s ease-out both; }
  @keyframes admin-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .admin-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .admin-category-nav { scroll-margin-top: 5rem; }
  /* Iron Man / HUD module styling */
  .admin-module {
    background-color: rgba(10, 10, 12, 0.95);
    border: 1px solid rgba(var(--noir-primary-rgb), 0.3);
    border-top-width: 2px;
    box-shadow: 0 0 20px rgba(var(--noir-primary-rgb), 0.06);
  }
  @media (max-width: 767px) {
    /* Match Crimes / GTA: no extra horizontal padding here — Layout main p-4 + .mobile-panel negative margins handle full-bleed cards */
    .admin-mobile-shell.mobile-page-root {
      padding-left: 0;
      padding-right: 0;
      overflow-x: hidden;
      max-width: 100vw;
      width: 100%;
      box-sizing: border-box;
    }
    .admin-mobile-shell,
    .admin-mobile-shell * {
      box-sizing: border-box;
    }
    .admin-mobile-shell .admin-category-nav,
    .admin-mobile-shell main,
    .admin-mobile-shell section,
    .admin-mobile-shell div {
      max-width: 100%;
      min-width: 0;
    }
    .admin-mobile-shell .mobile-panel {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    .admin-mobile-shell .overflow-x-auto {
      max-width: 100%;
    }
    .admin-mobile-shell input,
    .admin-mobile-shell select,
    .admin-mobile-shell button,
    .admin-mobile-shell textarea {
      max-width: 100%;
    }
    .admin-mobile-shell [class*="min-w-["] {
      min-width: 0 !important;
    }
    .admin-mobile-shell [class*="max-w-["] {
      max-width: 100% !important;
    }
    .admin-mobile-shell pre {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .admin-mobile-shell table {
      display: block;
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
    }
    .admin-mobile-shell thead,
    .admin-mobile-shell tbody {
      display: table;
      width: 100%;
      table-layout: fixed;
    }
    .admin-mobile-shell th,
    .admin-mobile-shell td {
      white-space: normal !important;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .admin-mobile-shell .grid.grid-cols-12 {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 6px !important;
    }
  }
  /* Full-bleed mobile sidebar strip (uses global .mobile-panel margins); reset on md+ */
  @media (min-width: 768px) {
    .admin-mobile-shell aside.admin-aside-nav.mobile-panel {
      margin-left: 0 !important;
      margin-right: 0 !important;
      width: 220px;
      max-width: 220px;
    }
  }
  .admin-command-bar {
    border-bottom: 1px solid rgba(var(--noir-primary-rgb), 0.35);
    background: linear-gradient(180deg, rgba(var(--noir-primary-rgb), 0.06) 0%, transparent 100%);
  }
  .admin-focus-block {
    border-top-color: rgba(var(--noir-primary-rgb), 0.5);
    box-shadow: 0 0 24px rgba(var(--noir-primary-rgb), 0.08);
  }
  .admin-hud-bar {
    border-left: 2px solid rgba(var(--noir-primary-rgb), 0.4);
  }
  .admin-scan-line {
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(var(--noir-primary-rgb), 0.4), transparent);
    opacity: 0.6;
  }
`;

const ADMIN_CATEGORIES = [
  { id: 'admin-operations', label: 'Operations', icon: UserCog },
  { id: 'admin-economy-progression', label: 'Economy & Progression', icon: Coins },
  { id: 'admin-world-systems', label: 'World & Systems', icon: Zap },
  { id: 'admin-analytics-monitoring', label: 'Analytics & Monitoring', icon: BarChart3 },
];
const MOD_ONLY_CATEGORY_IDS = ['admin-operations', 'admin-analytics-monitoring', 'admin-world-systems'];

/** Short labels for horizontal category chips on mobile */
const ADMIN_CATEGORY_MOBILE_SHORT = {
  'admin-operations': 'Ops',
  'admin-economy-progression': 'Economy',
  'admin-world-systems': 'World',
  'admin-analytics-monitoring': 'Stats',
};

const LEGACY_CATEGORY_MAP = {
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

/** Section id inside the page for tools without a collapsible header (scroll target). */
const LEGACY_CATEGORY_SECTION_ID = {
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

const normalizeCategoryId = (id) => LEGACY_CATEGORY_MAP[id] || id;

const ADMIN_MOBILE_TARGET_OPEN_KEY = 'admin_mobile_target_open';

function summarizeRedeemRewardsForAdmin(rewards) {
  if (!rewards || typeof rewards !== 'object') return '—';
  const parts = [];
  if (rewards.money) parts.push(`$${Number(rewards.money).toLocaleString()} cash`);
  if (rewards.points) parts.push(`${Number(rewards.points).toLocaleString()} pts`);
  if (rewards.respect_points) parts.push(`${Number(rewards.respect_points).toLocaleString()} respect`);
  if (rewards.loot_box_pieces) parts.push(`${Number(rewards.loot_box_pieces)} loot`);
  const carN = Array.isArray(rewards.cars) ? rewards.cars.length : 0;
  if (carN) parts.push(`${carN} car${carN === 1 ? '' : 's'}`);
  const tok = rewards.tokens;
  if (tok && typeof tok === 'object' && !Array.isArray(tok)) {
    Object.entries(tok).forEach(([k, v]) => {
      const n = Number(v);
      if (n > 0) parts.push(`${n}× ${String(k).replace(/_/g, ' ')}`);
    });
  }
  return parts.length ? parts.join(' · ') : '—';
}

function formatWholeCash(x) {
  const n = Number(x ?? 0);
  if (!Number.isFinite(n)) return '0';
  return Math.trunc(n).toLocaleString();
}

// Searchable tools list - each item has: label (searchable), categoryId (scroll target), collapseKey (optional - to expand section)
const SEARCHABLE_TOOLS = [
  // Player Management
  { label: 'Target Username', categoryId: 'admin-operations', scrollToId: 'admin-target-username', keywords: ['target', 'username', 'player', 'command'] },
  { label: 'Search Users', categoryId: 'admin-players', scrollToId: 'admin-search-users', keywords: ['search', 'users', 'email', 'find'] },
  { label: 'Change Rank', categoryId: 'admin-players', collapseKey: 'rank', keywords: ['rank', 'change', 'prestige', 'level'] },
  { label: 'Add Points', categoryId: 'admin-players', collapseKey: 'points', keywords: ['points', 'add', 'give'] },
  { label: 'Remove points', categoryId: 'admin-players', collapseKey: 'points', keywords: ['points', 'remove', 'deduct', 'take'] },
  { label: 'Point sources audit', categoryId: 'admin-players', collapseKey: 'player', keywords: ['points', 'sources', 'audit', 'where', 'breakdown', 'ledger', 'stripe', 'transfers'] },
  { label: 'Add respect points', categoryId: 'admin-players', collapseKey: 'player', keywords: ['respect', 'add', 'grant', 'give', 'points'] },
  { label: 'Remove respect points', categoryId: 'admin-players', collapseKey: 'player', keywords: ['respect', 'remove', 'deduct', 'take'] },
  { label: 'Points Provenance', categoryId: 'admin-donations', collapseKey: 'donationsProvenance', keywords: ['chargeback', 'provenance', 'payment session', 'points tree'], adminOnly: true },
  { label: 'Add Tokens', categoryId: 'admin-players', collapseKey: 'tokens', keywords: ['tokens', 'crime', 'gta', 'melt', 'booze', 'travel', 'oc', 'racket', 'jailbust'] },
  { label: 'Clear pool cue upgrades', categoryId: 'admin-players', collapseKey: 'userAdjustHub', scrollToId: 'admin-user-adjust-hub', keywords: ['pool', '8-ball', '8 ball', 'cue', 'upgrades', 'reset', 'minigame'] },
  { label: 'Founding Member', categoryId: 'admin-players', collapseKey: 'founding', keywords: ['founding', 'member', 'badge', 'founder'] },
  { label: 'Add Money', categoryId: 'admin-players', collapseKey: 'money', keywords: ['money', 'cash', 'add', 'give'] },
  { label: 'Add Bullets', categoryId: 'admin-players', collapseKey: 'bullets', keywords: ['bullets', 'ammo', 'add'] },
  { label: 'Give Car', categoryId: 'admin-players', collapseKey: 'cars', keywords: ['car', 'vehicle', 'give'] },
  { label: 'Ghost Mode', categoryId: 'admin-players', collapseKey: 'ghost', keywords: ['ghost', 'invisible', 'hide'] },
  { label: 'Lock Account', categoryId: 'admin-moderation', collapseKey: 'moderationPlayer', keywords: ['lock', 'ban', 'account'] },
  { label: 'Kill Player', categoryId: 'admin-moderation', collapseKey: 'moderationPlayer', keywords: ['kill', 'death', 'player'] },
  { label: 'Revive Player', categoryId: 'admin-moderation', collapseKey: 'moderationPlayer', keywords: ['revive', 'resurrect', 'alive'] },
  { label: 'User Details', categoryId: 'admin-players', collapseKey: 'userDetails', keywords: ['user', 'details', 'info', 'profile', 'jail', 'bust', 'reward'] },
  { label: 'User give / take & leaderboards', categoryId: 'admin-players', collapseKey: 'userAdjustHub', keywords: ['leaderboard', 'adjust', 'strip', 'username', 'crimes', 'scores', 'gta', 'busts', 'kills', 'minigame', 'money', 'points', 'respect', 'bullets', 'weekly', 'alltime', 'preview', 'partial'] },
  { label: 'Referrals & prereg heal', categoryId: 'admin-players', collapseKey: 'referralsReport', keywords: ['referral', 'referrer', 'referee', 'invite', 'earnings', 'ref', 'heal', 'prereg', 'backfill', 'manual', 'assign', 'link', 'remove', 'unlink', 'clear'] },
  { label: 'Respect points log', categoryId: 'admin-players', collapseKey: 'respectPointsLog', keywords: ['respect', 'points', 'log', 'earned', 'audit', 'player'] },
  { label: 'Gambling Log', categoryId: 'admin-logs', collapseKey: 'gamblingLog', keywords: ['gambling', 'log', 'casino', 'bet'] },
  { label: 'Activity Log', categoryId: 'admin-logs', collapseKey: 'activityLog', keywords: ['activity', 'log', 'history'] },
  // Donations
  { label: 'Donations Payments Log', categoryId: 'admin-donations', collapseKey: 'donationsPayments', keywords: ['donations', 'payments', 'stripe', 'credit'], adminOnly: true },
  { label: 'Store Point Crediting', categoryId: 'admin-donations', collapseKey: 'donationsStore', keywords: ['store', 'crediting', 'manual', 'eta', 'payments'], adminOnly: true },
  { label: 'Pre-order Settings', categoryId: 'admin-donations', collapseKey: 'donationsStore', keywords: ['preorder', 'points', 'release', 'manual', 'store', 'credit'], adminOnly: true },
  { label: 'Release Preorder Points', categoryId: 'admin-donations', collapseKey: 'donationsStore', keywords: ['release', 'preorder', 'points', 'credit'], adminOnly: true },
  // Game World
  { label: 'Events Toggle', categoryId: 'admin-gameworld', collapseKey: 'events', keywords: ['events', 'toggle', 'enable', 'disable'], adminOnly: true },
  { label: 'Booze Run rotation & global discount', categoryId: 'admin-gameworld', collapseKey: 'boozeRun', keywords: ['booze', 'run', 'rotation', 'prices', 'discount', 'listed', 'nudge', 'global', 'jail', 'bust', 'prohibition'], adminOnly: true },
  { label: 'Booze Run analytics', categoryId: 'admin-analytics-monitoring', collapseKey: 'boozeRunAnalytics', keywords: ['booze', 'analytics', 'economy', 'events', 'profit', 'revenue', 'jail', 'leaderboard'] },
  { label: 'Presence simulator', categoryId: 'admin-gameworld', collapseKey: 'presenceSimulator', keywords: ['presence', 'simulator', 'online', 'active', 'fake', 'last_seen'], adminOnly: true },
  { label: 'Slots Draw', categoryId: 'admin-gameworld', collapseKey: 'slotsDraw', keywords: ['slots', 'draw', 'lottery'] },
  { label: 'Crack the Safe jackpot', categoryId: 'admin-gameworld', collapseKey: 'crackSafeJackpot', keywords: ['crack', 'safe', 'jackpot', 'pot', 'lower'] },
  { label: 'State Heads', categoryId: 'admin-gameworld', collapseKey: 'stateHeads', keywords: ['state', 'heads', 'family', 'territory'] },
  { label: 'Release soft-launch', categoryId: 'admin-gameworld', collapseKey: 'releaseSoftLaunch', keywords: ['release', 'soft', 'launch', 'pvp', 'kill', 'game pass'], adminOnly: true },
  { label: 'Reset Racket Cooldown', categoryId: 'admin-gameworld', collapseKey: 'racketReset', keywords: ['racket', 'cooldown', 'reset', 'family'], adminOnly: true },
  { label: 'Casino limits (global caps)', categoryId: 'admin-gameworld', collapseKey: 'casinoLimits', keywords: ['casino', 'limits', 'caps', 'max bet', 'buyback', 'poker', 'blind'] },
  { label: 'Claim costs (casino, airport, armoury)', categoryId: 'admin-gameworld', collapseKey: 'claimCosts', keywords: ['claim', 'cost', 'casino', 'airport', 'armoury', 'bullet', 'factory', 'dice', 'roulette'], adminOnly: true },
  { label: 'Casino per-game max bets', categoryId: 'admin-gameworld', collapseKey: 'casinoMaxBets', keywords: ['casino', 'max bet', 'per game', 'slots', 'blackjack', 'roulette'] },
  { label: 'Admin display & signup', categoryId: 'admin-gameworld', collapseKey: 'adminDisplay', keywords: ['admin', 'display', 'colour', 'color', 'online', 'email', 'verification', 'vpn', 'proxy', 'user agent', 'signup'], adminOnly: true },
  { label: 'Launch & login lock', categoryId: 'admin-gameworld', collapseKey: 'launchSettings', keywords: ['login', 'lock', 'launch', 'store', 'preorder', 'preregister', 'banner', 'landing'], adminOnly: true },
  { label: 'Maintenance banner', categoryId: 'admin-gameworld', collapseKey: 'maintenanceBanner', keywords: ['maintenance', 'banner', 'downtime'] },
  // Security
  { label: 'Security Summary', categoryId: 'admin-security', collapseKey: 'security', keywords: ['security', 'summary', 'flags', 'rate', 'ban', 'ip', 'lockout', 'telegram'] },
  { label: 'Session stats', categoryId: 'admin-security', collapseKey: 'sessionStats', keywords: ['session', 'sessions', 'active', 'log out', 'revoke', '24h'] },
  { label: 'IP Bans', categoryId: 'admin-security', collapseKey: 'security', keywords: ['ip', 'ban', 'block', 'unban', 'restore'] },
  { label: 'Rate Limits', categoryId: 'admin-security', collapseKey: 'security', keywords: ['rate', 'limit', 'throttle', 'violations', 'cooldown'] },
  { label: 'Cloudflare Bot Block', categoryId: 'admin-security', collapseKey: 'cfBotBlock', keywords: ['cloudflare', 'bot', 'block', 'cf'] },
  { label: 'Cloudflare auto block', categoryId: 'admin-security', collapseKey: 'cfAutoBlock', keywords: ['cloudflare', 'auto', 'block', 'cf'] },
  { label: 'Security panel', categoryId: 'admin-security', collapseKey: 'security', keywords: ['security', 'flags', 'threat', 'monitor'] },
  // Cheat Detection
  { label: 'Cheat Detection', categoryId: 'admin-cheat', collapseKey: 'cheat', keywords: ['cheat', 'detection', 'suspicious'] },
  { label: 'Bot / script investigation', categoryId: 'admin-cheat', collapseKey: 'botInvestigation', keywords: ['bot', 'script', 'automation', 'investigation', 'cheat', 'suspicious'] },
  { label: 'Find Duplicates', categoryId: 'admin-cheat', collapseKey: 'duplicates', keywords: ['duplicate', 'multi', 'account'] },
  // Analytics
  { label: 'Login page unique visitors', categoryId: 'admin-analytics', collapseKey: 'loginPageVisitors', keywords: ['login', 'visitors', 'unique', 'page', 'stats'] },
  { label: 'Casino Ownership Profits', categoryId: 'admin-analytics', collapseKey: 'ownershipProfits', keywords: ['casino', 'ownership', 'profit', 'owner', 'earnings'] },
  { label: 'Interest bank by player', categoryId: 'admin-analytics', collapseKey: 'interestBankPlayers', keywords: ['interest', 'bank', 'deposits', 'holders'] },
  { label: 'Swiss Bank Overview', categoryId: 'admin-analytics', collapseKey: 'swissBank', keywords: ['swiss', 'bank', 'balance', 'hidden', 'money', 'wipe'] },
  { label: 'Points purchases (store spends)', categoryId: 'admin-analytics', collapseKey: 'pointsStoreSpends', keywords: ['points', 'store', 'spend', 'bought', 'purchases', 'refund'] },
  { label: 'Analytics V2 workspace', categoryId: 'admin-analytics-monitoring', collapseKey: 'analyticsWorkspaceV2', keywords: ['analytics', 'v2', 'workspace', 'rollup', 'rollups', 'stats', 'users', 'events'] },
  { label: 'Economy overview', categoryId: 'admin-analytics-monitoring', collapseKey: 'economyOverview', keywords: ['economy', 'overview', 'gdp', 'money', 'circulation', 'cash', 'holders', 'wallet', 'distribution', 'drill', 'accounts'] },
  { label: 'Capital breakdown', categoryId: 'admin-analytics-monitoring', collapseKey: 'capitalBreakdown', keywords: ['capital', 'breakdown', 'wealth'] },
  { label: 'Player activity', categoryId: 'admin-analytics-monitoring', collapseKey: 'playerActivity', keywords: ['player', 'activity', 'dau', 'mau'] },
  { label: 'Attack analytics', categoryId: 'admin-analytics-monitoring', collapseKey: 'attackAnalytics', keywords: ['attack', 'analytics', 'pvp', 'kills'] },
  { label: 'Crime analytics', categoryId: 'admin-analytics-monitoring', collapseKey: 'crimeAnalytics', keywords: ['crime', 'analytics'] },
  { label: 'Casino analytics', categoryId: 'admin-analytics-monitoring', collapseKey: 'casinoAnalytics', keywords: ['casino', 'analytics', 'house'] },
  { label: 'Trades analytics', categoryId: 'admin-analytics-monitoring', collapseKey: 'tradesAnalytics', keywords: ['trades', 'analytics', 'stock', 'market'] },
  { label: 'Hitlist & bodyguards analytics', categoryId: 'admin-analytics-monitoring', collapseKey: 'hitlistBodyguardsAnalytics', keywords: ['hitlist', 'bodyguard', 'analytics'] },
  { label: 'Economy analytics', categoryId: 'admin-analytics-monitoring', collapseKey: 'economyAnalytics', keywords: ['economy', 'analytics', 'sink', 'faucet'] },
  { label: 'Player compare', categoryId: 'admin-analytics-monitoring', collapseKey: 'playerCompare', keywords: ['compare', 'players', 'side by side'] },
  // Logs
  { label: 'Live Activity Feed', categoryId: 'admin-logs', collapseKey: 'activityFeed', keywords: ['activity', 'feed', 'live', 'real-time', 'actions', 'gambling', 'bank', 'transfer'] },
  { label: 'Minigame Payouts', categoryId: 'admin-logs', collapseKey: 'minigamePayouts', keywords: ['minigame', 'payout', 'reward', 'cash', 'mini', 'game'] },
  { label: 'Weekly Leaderboard Payouts', categoryId: 'admin-logs', collapseKey: 'weeklyLeaderboardPayouts', keywords: ['leaderboard', 'weekly', 'payout', 'respect', 'points', 'top 10'] },
  { label: 'Attack Logs', categoryId: 'admin-logs', collapseKey: 'attackLogs', keywords: ['attack', 'log', 'kill'] },
  { label: 'Mod Action Logs', categoryId: 'admin-logs', collapseKey: 'modLogs', keywords: ['mod', 'action', 'log'] },
  { label: 'Crime logs', categoryId: 'admin-logs', collapseKey: 'crimeLogs', keywords: ['crime', 'log', 'heist'] },
  { label: 'GTA logs', categoryId: 'admin-logs', collapseKey: 'gtaLogs', keywords: ['gta', 'log', 'theft', 'car'] },
  { label: 'Jail logs', categoryId: 'admin-logs', collapseKey: 'jailLogs', keywords: ['jail', 'log', 'sentence'] },
  { label: 'Bank logs', categoryId: 'admin-logs', collapseKey: 'bankLogs', keywords: ['bank', 'log', 'transfer'] },
  { label: 'Stock logs', categoryId: 'admin-logs', collapseKey: 'stockLogs', keywords: ['stock', 'log', 'shares'] },
  // Testing Tools
  { label: 'Search & Attack Tools', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['search', 'attack', 'time'] },
  { label: 'Set Search Time', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['search', 'time', 'minutes'], adminOnly: true },
  { label: 'Clear All Searches', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['clear', 'searches', 'delete'], adminOnly: true },
  { label: 'Fix login fields (user)', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['login', 'fix', 'repair', 'sessions', 'ip', 'lockout'] },
  { label: 'Clear OC invites (user)', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['oc', 'organised', 'crime', 'invite', 'clear', 'user'] },
  { label: 'Clear minigame records (user)', categoryId: 'admin-players', collapseKey: 'userAdjustHub', keywords: ['minigame', 'records', 'clear', 'user', 'scores'], adminOnly: true },
  { label: 'Minigame weekly leaderboard strip/add', categoryId: 'admin-players', collapseKey: 'userAdjustHub', keywords: ['minigame', 'leaderboard', 'weekly', 'strip', 'add', 'score', 'flappy', 'gauntlet'], adminOnly: true },
  { label: 'Main leaderboards strip (respect melt stock booze)', categoryId: 'admin-players', collapseKey: 'userAdjustHub', keywords: ['leaderboard', 'weekly', 'respect', 'melt', 'stock', 'booze', 'strip', 'top 10'], adminOnly: true },
  { label: 'Reconcile Game Pass tiers', categoryId: 'admin-players', collapseKey: 'userAdjustHub', keywords: ['game pass', 'reconcile', 'tier', 'vip', 'rank xp', 'micro tier', 'force grant', 'rewards'], adminOnly: true },
  { label: 'Game Pass inspector', categoryId: 'admin-players', collapseKey: 'userAdjustHub', scrollToId: 'admin-game-pass-inspector', keywords: ['game pass', 'inspector', 'vip', 'token', 'stripe', 'rank xp', 'micro tier', 'entitlement'], adminOnly: true },
  { label: 'Game Pass stuck cursors', categoryId: 'admin-players', collapseKey: 'userAdjustHub', scrollToId: 'admin-game-pass-inspector', keywords: ['game pass', 'stuck', 'cursor', 'broken', 'fix', 'repair', 'rewards'], adminOnly: true },
  { label: 'Deleted messages', categoryId: 'admin-players', collapseKey: 'userAdjustHub', scrollToId: 'admin-deleted-messages', keywords: ['deleted', 'messages', 'archive', 'forum', 'chat', 'dm', 'notification', 'history'], adminOnly: true },
  { label: 'Reset OC Timers', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['oc', 'organised', 'crime', 'timer'] },
  { label: 'Reset Daily Rewards Timer', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['daily', 'rewards', 'timer', 'rps'] },
  { label: 'Bodyguard Tools', categoryId: 'admin-testing', collapseKey: 'bodyguards', keywords: ['bodyguard', 'robot', 'generate'] },
  { label: 'Generate Bodyguards', categoryId: 'admin-testing', collapseKey: 'bodyguards', keywords: ['bodyguard', 'generate', 'robot'] },
  { label: 'Test Bodyguard Payout', categoryId: 'admin-testing', collapseKey: 'bodyguards', keywords: ['bodyguard', 'payout', 'test'] },
  { label: 'GTA exclusive pool & dealer', categoryId: 'admin-world-systems', collapseKey: 'gtaPool', keywords: ['gta', 'exclusive', 'pool', 'dealer', 'cars', 'values'], adminOnly: true },
  { label: 'System health', categoryId: 'admin-operations', collapseKey: 'systemHealth', keywords: ['system', 'health', 'uptime', 'status', 'db'] },
  { label: 'Moderation related accounts', categoryId: 'admin-operations', collapseKey: 'moderationRelated', keywords: ['moderation', 'related', 'linked', 'accounts'] },
  { label: 'Page locks (admin)', categoryId: 'admin-operations', collapseKey: 'pageLocks', keywords: ['page', 'lock', 'route'] },
  { label: 'Mod display', categoryId: 'admin-operations', collapseKey: 'modDisplay', keywords: ['mod', 'display', 'colour', 'color', 'badge'] },
  { label: 'Cheat detection (mod)', categoryId: 'admin-operations', collapseKey: 'cheatDetectionMod', keywords: ['cheat', 'detection', 'mod', 'suspicious'] },
  { label: 'Database tools', categoryId: 'admin-world-systems', collapseKey: 'database', keywords: ['database', 'mongo', 'wipe', 'migrate'], adminOnly: true },
  // Quick & Bulk
  { label: 'Give All Points', categoryId: 'admin-quick', collapseKey: 'quick', keywords: ['give', 'all', 'points', 'bulk'] },
  { label: 'Give All Money', categoryId: 'admin-quick', collapseKey: 'quick', keywords: ['give', 'all', 'money', 'bulk'] },
  { label: 'Bulk User Action', categoryId: 'admin-quick', collapseKey: 'bulkAction', keywords: ['bulk', 'action', 'multiple', 'users'] },
  { label: 'Redeem Codes', categoryId: 'admin-quick', collapseKey: 'redeemCodes', keywords: ['redeem', 'code', 'reward', 'cash', 'points', 'cars'] },
  // Database
  { label: 'Image host (user uploads)', categoryId: 'admin-database', collapseKey: 'imageHostAdmin', keywords: ['image', 'host', 'upload', 'picture', 'imgur', 'photo'], adminOnly: true },
  { label: 'Wipe Database', categoryId: 'admin-database', collapseKey: 'wipe', keywords: ['wipe', 'database', 'reset', 'delete'], adminOnly: true },
  { label: 'New Release', categoryId: 'admin-database', collapseKey: 'newRelease', keywords: ['new', 'release', 'season'], adminOnly: true },
  { label: 'Delete User', categoryId: 'admin-database', collapseKey: 'deleteUser', keywords: ['delete', 'user', 'remove'], adminOnly: true },
  { label: 'Delete Family', categoryId: 'admin-database', collapseKey: 'deleteFamily', keywords: ['delete', 'family', 'crew', 'remove'], adminOnly: true },
  { label: 'Wipe All Families', categoryId: 'admin-database', collapseKey: 'wipeAllFamilies', keywords: ['wipe', 'all', 'families', 'crews'], adminOnly: true },
  { label: 'Create Test Users', categoryId: 'admin-database', collapseKey: 'testUsers', keywords: ['test', 'users', 'create', 'seed'], adminOnly: true },
  // Staff Management
  { label: 'Staff Management', categoryId: 'admin-staff', collapseKey: 'staff', keywords: ['staff', 'mod', 'helper', 'promote'] },
  { label: 'Add Moderator', categoryId: 'admin-staff', collapseKey: 'staff', keywords: ['mod', 'moderator', 'add', 'promote'] },
  { label: 'Add Helper', categoryId: 'admin-staff', collapseKey: 'staff', keywords: ['helper', 'help desk', 'add', 'promote'] },
  // Mod Tools
  { label: 'Mod Online Colour', categoryId: 'admin-mod-tools', collapseKey: 'modDisplay', keywords: ['mod', 'colour', 'color', 'online', 'palette'] },
  { label: 'Dupe check', categoryId: 'admin-mod-tools', collapseKey: 'dupeCheckMod', keywords: ['dupe', 'duplicate', 'multi', 'account'] },
  { label: 'Lock player', categoryId: 'admin-moderation', collapseKey: 'moderationPlayer', keywords: ['lock', 'player', 'investigation'] },
  { label: 'Modkill', categoryId: 'admin-moderation', collapseKey: 'moderationPlayer', keywords: ['modkill', 'kill', 'player'] },
  { label: 'Lock page', categoryId: 'admin-moderation', collapseKey: 'moderationPageLocks', keywords: ['lock', 'page', 'maintenance'] },
];

/** Display names for /admin/casinos/analytics/summary game_type keys */
const CASINO_ANALYTICS_GAME_LABELS = {
  mp_poker_vs_dealer: 'Poker (vs dealer)',
  mp_poker_vs_players: 'Poker (multiplayer)',
  mp_poker: 'Poker (legacy)',
};

const SECTIONS_KEY = 'admin_sections_collapsed';

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { referralsReport: false, userAdjustHub: true, botInvestigation: false, ...parsed };
  } catch { return { referralsReport: false, userAdjustHub: true, botInvestigation: false }; }
}

function saveCollapsed(state) {
  try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(state)); } catch {}
}

function formatAttackLogTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const ms = d.getMilliseconds();
  return d.toLocaleString() + '.' + String(ms).padStart(3, '0');
}

function parseAttackLogUA(ua) {
  if (!ua || typeof ua !== 'string') return { device: '—', bot: null };
  const s = ua.toLowerCase();
  let bot = null;
  if (/\b(bot|crawler|spider|scraper)\b/i.test(ua)) bot = 'Bot';
  else if (/python|requests|urllib|aiohttp/i.test(ua)) bot = 'Python';
  else if (/selenium|webdriver|headless/i.test(ua)) bot = 'Selenium';
  else if (/curl|wget|libwww|axios\//i.test(ua)) bot = 'curl/wget';
  else if (/postman|insomnia/i.test(ua)) bot = 'API client';
  let device = 'PC';
  if (/ipad|tablet(?!.*mobile)/i.test(ua) || (s.includes('tablet') && !s.includes('mobile'))) device = 'Tablet';
  else if (/iphone|ipod/i.test(ua)) device = 'iPhone';
  else if (/android/i.test(ua)) device = /mobile/i.test(ua) && !/tablet/i.test(ua) ? 'Android' : 'Android (tablet)';
  else if (/mobile|opera mini|blackberry|windows phone/i.test(ua)) device = 'Mobile';
  return { device, bot };
}

const AdminInput = (props) => (
  <input {...props} className="w-full sm:w-24 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
);
const AdminSelect = ({ children, ...props }) => (
  <select {...props} className="w-full sm:w-32 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none">
    {children}
  </select>
);

function SectionHeader({ icon: Icon, title, badge, isCollapsed, onToggle, color = 'text-primary', toolAnchor }) {
  return (
    <button
      type="button"
      data-admin-tool={toolAnchor || undefined}
      onClick={onToggle}
      className="admin-hud-bar w-full px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between hover:bg-primary/12 transition-colors scroll-mt-24"
    >
      <div className="flex items-center gap-2">
        <Icon size={14} className={color} />
        <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        {badge}
        <span className="text-primary/80">
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
      </div>
    </button>
  );
}
function ActionRow({ icon: Icon, label, description, children, color = 'text-primary' }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-md bg-zinc-800/30 border border-transparent border-l-2 border-l-transparent hover:border-primary/20 hover:border-l-primary/20 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={14} className={`shrink-0 ${color}`} />
        <div className="min-w-0">
          <div className={`text-sm font-heading font-bold ${color === 'text-red-400' ? 'text-red-400' : 'text-foreground'}`}>{label}</div>
          {description && <div className="text-[10px] text-mutedForeground truncate">{description}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 ml-6 sm:ml-0 min-w-0 w-full sm:w-auto sm:flex-1 sm:justify-end">
        {children}
      </div>
    </div>
  );
}
function BtnPrimary({ children, ...props }) {
  return (
    <button {...props} className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 hover:shadow-[0_0_12px_rgba(var(--noir-primary-rgb),0.15)] focus:shadow-[0_0_12px_rgba(var(--noir-primary-rgb),0.12)] transition-all disabled:opacity-50 touch-manipulation font-heading">
      {children}
    </button>
  );
}
function BtnDanger({ children, ...props }) {
  return (
    <button {...props} className="bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-red-500/50 transition-all disabled:opacity-50 touch-manipulation">
      {children}
    </button>
  );
}
function BtnSecondary({ children, ...props }) {
  return (
    <button {...props} className="bg-zinc-700/50 hover:bg-zinc-600/50 text-foreground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 transition-all disabled:opacity-50 touch-manipulation">
      {children}
    </button>
  );
}

export default function Admin() {
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const staffCanAccessWorldSystems = isAdmin || isModerator;
  const [loading, setLoading] = useState(true);
  const [forceOnlineInfo, setForceOnlineInfo] = useState(null);
  const [boozeRotationSeconds, setBoozeRotationSeconds] = useState(null);
  const [boozeJailChances, setBoozeJailChances] = useState(null);
  const [boozeJailMinPct, setBoozeJailMinPct] = useState('');
  const [boozeJailMaxPct, setBoozeJailMaxPct] = useState('');
  const [boozeJailSaving, setBoozeJailSaving] = useState(false);
  const [boozeListedPrice, setBoozeListedPrice] = useState(null);
  const [boozePriceSaving, setBoozePriceSaving] = useState(false);
  const [presenceSim, setPresenceSim] = useState(null);
  const [presenceSimLoading, setPresenceSimLoading] = useState(false);
  const [psForm, setPsForm] = useState({
    intervalMin: '5',
    minAdd: '1',
    maxAdd: '3',
    maxRemove: '2',
    maxPool: '25',
    skipUsernames: '',
    gradualAdd: true,
    secondsBetweenAdds: '25',
  });
  const [crackSafeInfo, setCrackSafeInfo] = useState(null);
  const [crackSafeJackpotInput, setCrackSafeJackpotInput] = useState('');
  const [crackSafeJackpotLoading, setCrackSafeJackpotLoading] = useState(false);
  const [crackSafeJackpotSaving, setCrackSafeJackpotSaving] = useState(false);
  const [ranks, setRanks] = useState([]);
  const [cars, setCars] = useState([]);
  const [bgTestCount, setBgTestCount] = useState(2);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const [adminMobileTargetOpen, setAdminMobileTargetOpen] = useState(() => {
    try {
      const v = localStorage.getItem(ADMIN_MOBILE_TARGET_OPEN_KEY);
      if (v === null) return true;
      return v !== '0' && v !== 'false';
    } catch {
      return true;
    }
  });
  const [formData, setFormData] = useState({
    targetUsername: '',
    newRank: 1,
    prestigeLevel: 0,
    points: 100,
    pointsRemove: 100,
    bullets: 5000,
    lootPieces: 100,
    carId: 'car1',
    lockMinutes: 5,
    searchMinutes: 1,
    adminNewEmail: '',
    adminNewPassword: '',
    tokenType: 'xp_crimes',
    tokenAmount: 5,
    gamePassTierSnapshot: '',
    gamePassRewindCursor: '',
    respectAdd: 100,
    respectRemove: 100,
  });

  const [eventsEnabled, setEventsEnabled] = useState(true);
  const [allEventsForTesting, setAllEventsForTesting] = useState(false);
  const [todayEvent, setTodayEvent] = useState(null);
  const [eventList, setEventList] = useState([]);
  const [eventToggleLoadingId, setEventToggleLoadingId] = useState(null);
  const [overrideEventId, setOverrideEventId] = useState(null);
  const [eventRandomLoading, setEventRandomLoading] = useState(false);
  const [eventClearOverrideLoading, setEventClearOverrideLoading] = useState(false);
  const [selectedForRandomPool, setSelectedForRandomPool] = useState({});
  const [cfBotBlockEnabled, setCfBotBlockEnabled] = useState(null);
  const [cfBotBlockLoading, setCfBotBlockLoading] = useState(false);
  const [cfBotBlockError, setCfBotBlockError] = useState(null);
  
  const [cfAutoBlockEnabled, setCfAutoBlockEnabled] = useState(null);
  const [cfAutoBlockLoading, setCfAutoBlockLoading] = useState(false);
  const [cfAutoBlockError, setCfAutoBlockError] = useState(null);
  
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [deleteUserId, setDeleteUserId] = useState('');
  const [adminFamiliesList, setAdminFamiliesList] = useState([]);
  const [deleteFamilyId, setDeleteFamilyId] = useState('');
  const [wipeAllFamiliesConfirmText, setWipeAllFamiliesConfirmText] = useState('');
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [freshConfirmText, setFreshConfirmText] = useState('');
  const [dropAllCasinosConfirmText, setDropAllCasinosConfirmText] = useState('');
  const [dbLoading, setDbLoading] = useState(false);
  const [dbFreshLoading, setDbFreshLoading] = useState(false);
  const [giveAllPoints, setGiveAllPoints] = useState(100);
  const [giveAllMoney, setGiveAllMoney] = useState(10000);
  const [removeAllPointsLoading, setRemoveAllPointsLoading] = useState(false);
  const [zeroAllPointsLoading, setZeroAllPointsLoading] = useState(false);
  const [clearSearchesLoading, setClearSearchesLoading] = useState(false);
  const [dropHumanBgLoading, setDropHumanBgLoading] = useState(false);
  const [testPayoutLoading, setTestPayoutLoading] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [toolSearchFocused, setToolSearchFocused] = useState(false);
  const searchInputRef = useRef(null);

  const [activeCategoryId, setActiveCategoryId] = useState('admin-operations');
  const [modVisibleCategoryIds, setModVisibleCategoryIds] = useState(() => [...MOD_ONLY_CATEGORY_IDS]);
  const visibleCategories = isAdmin ? ADMIN_CATEGORIES : ADMIN_CATEGORIES.filter((c) => modVisibleCategoryIds.includes(c.id));
  useEffect(() => {
    const hRaw = (typeof window !== 'undefined' && window.location.hash) ? window.location.hash.slice(1) : '';
    const h = normalizeCategoryId(hRaw);
    const visible = isAdmin ? ADMIN_CATEGORIES : ADMIN_CATEGORIES.filter((c) => modVisibleCategoryIds.includes(c.id));
    if (h && ADMIN_CATEGORIES.some((c) => c.id === h) && visible.some((c) => c.id === h)) {
      setActiveCategoryId(h);
      return;
    }
    if (!isAdmin && visible.length > 0) setActiveCategoryId(visible[0].id);
  }, [isAdmin, modVisibleCategoryIds]);

  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_MOBILE_TARGET_OPEN_KEY, adminMobileTargetOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [adminMobileTargetOpen]);

  const filteredTools = useMemo(() => {
    if (!toolSearch.trim()) return [];
    const raw = toolSearch.toLowerCase().trim();
    const words = raw.split(/\s+/).filter(Boolean);
    const visibleIds = isAdmin ? null : new Set(modVisibleCategoryIds);
    const matchesTool = (tool) => {
      const label = tool.label.toLowerCase();
      const kws = tool.keywords.map((k) => k.toLowerCase());
      if (label.includes(raw) || kws.some((k) => k.includes(raw))) return true;
      if (words.length === 0) return false;
      const matchWord = (w) => label.includes(w) || kws.some((kw) => kw.includes(w));
      return words.every(matchWord);
    };
    return SEARCHABLE_TOOLS.filter((tool) => {
      const normalizedCategoryId = normalizeCategoryId(tool.categoryId);
      if (visibleIds && !visibleIds.has(normalizedCategoryId)) return false;
      if (!isAdmin && isModerator && tool.adminOnly) return false;
      return matchesTool(tool);
    })
      .map((tool) => ({ ...tool, categoryId: normalizeCategoryId(tool.categoryId) }))
      .slice(0, 28);
  }, [toolSearch, isAdmin, isModerator, modVisibleCategoryIds]);

  const handleToolSelect = (tool) => {
    const normalizedCategoryId = normalizeCategoryId(tool.categoryId);
    setActiveCategoryId(normalizedCategoryId);
    if (tool.collapseKey) {
      setCollapsed((prev) => ({ ...prev, [tool.collapseKey]: false }));
    }
    setToolSearch('');
    setToolSearchFocused(false);
    searchInputRef.current?.blur();
    if (typeof window !== 'undefined') window.location.hash = normalizedCategoryId;

    const runScroll = () => {
      if (tool.scrollToId) {
        document.getElementById(tool.scrollToId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (tool.collapseKey) {
        document.querySelector(`[data-admin-tool="${tool.collapseKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const sid = tool.scrollToSectionId || LEGACY_CATEGORY_SECTION_ID[tool.categoryId];
      if (sid) {
        document.getElementById(sid)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => setTimeout(runScroll, 280));
    }
  };
  const [resetOcTimersLoading, setResetOcTimersLoading] = useState(false);
  const [fixLoginFieldsLoading, setFixLoginFieldsLoading] = useState(false);
  const [clearOcInvitesLoading, setClearOcInvitesLoading] = useState(false);
  const [clearCrimeTimersLoading, setClearCrimeTimersLoading] = useState(false);
  const [inspectCrimesLoading, setInspectCrimesLoading] = useState(false);
  const [inspectCrimesData, setInspectCrimesData] = useState(null);
  const [dedupCrimesLoading, setDedupCrimesLoading] = useState(false);
  const [clearMinigameRecordsLoading, setClearMinigameRecordsLoading] = useState(false);
  const [minigameLbStripLoading, setMinigameLbStripLoading] = useState(false);
  const [minigameLbAddLoading, setMinigameLbAddLoading] = useState(false);
  const [minigameLbWeekScope, setMinigameLbWeekScope] = useState('current');
  const [minigameLbStripWeekly, setMinigameLbStripWeekly] = useState(true);
  const [minigameLbStripPerGame, setMinigameLbStripPerGame] = useState(true);
  const [minigameLbStripGames, setMinigameLbStripGames] = useState('');
  const [minigameLbAddGame, setMinigameLbAddGame] = useState('gauntlet');
  const [minigameLbAddScore, setMinigameLbAddScore] = useState('100');
  const [minigameLbAddWeekly, setMinigameLbAddWeekly] = useState(true);
  const [minigameLbAddPerGame, setMinigameLbAddPerGame] = useState(false);
  const [mainLbStripLoading, setMainLbStripLoading] = useState(false);
  const [mainLbScope, setMainLbScope] = useState('current');
  const [mainLbRespect, setMainLbRespect] = useState(true);
  const [mainLbMelt, setMainLbMelt] = useState(true);
  const [mainLbStock, setMainLbStock] = useState(true);
  const [mainLbBooze, setMainLbBooze] = useState(true);
  const [mainLbKills, setMainLbKills] = useState(false);
  const [mainLbCrimes, setMainLbCrimes] = useState(false);
  const [mainLbGta, setMainLbGta] = useState(false);
  const [mainLbJail, setMainLbJail] = useState(false);
  const [mainLbResetBoozeLoading, setMainLbResetBoozeLoading] = useState(false);
  const [userLbScores, setUserLbScores] = useState(null);
  const [userLbScoresLoading, setUserLbScoresLoading] = useState(false);
  const [userLbAdjustMetric, setUserLbAdjustMetric] = useState('crimes');
  const [userLbAdjustPeriod, setUserLbAdjustPeriod] = useState('weekly');
  const [userLbAdjustRemoveCount, setUserLbAdjustRemoveCount] = useState('10');
  const [userLbAdjustDryRun, setUserLbAdjustDryRun] = useState(false);
  const [userLbAdjustLoading, setUserLbAdjustLoading] = useState(false);
  const [userHubMoneyDelta, setUserHubMoneyDelta] = useState(0);
  const [userHubMoneyLoading, setUserHubMoneyLoading] = useState(false);
  const [gamePassInspectList, setGamePassInspectList] = useState(null);
  const [gamePassInspectLoading, setGamePassInspectLoading] = useState(false);
  const [gamePassInspectQuery, setGamePassInspectQuery] = useState('');
  const [gamePassInspectDetail, setGamePassInspectDetail] = useState(null);
  const [gamePassInspectDetailLoading, setGamePassInspectDetailLoading] = useState(false);
  const [gamePassStuck, setGamePassStuck] = useState(null);
  const [gamePassStuckLoading, setGamePassStuckLoading] = useState(false);
  const [deletedMsgs, setDeletedMsgs] = useState(null);
  const [deletedMsgsLoading, setDeletedMsgsLoading] = useState(false);
  const [deletedMsgsFilter, setDeletedMsgsFilter] = useState('');
  const [resetDailyRewardsLoading, setResetDailyRewardsLoading] = useState(false);
  const [pointsProvSessionId, setPointsProvSessionId] = useState('');
  const [pointsProvUserId, setPointsProvUserId] = useState('');
  const [pointsProvPreviewLoading, setPointsProvPreviewLoading] = useState(false);
  const [pointsProvExecuteLoading, setPointsProvExecuteLoading] = useState(false);
  const [pointsProvUserLoading, setPointsProvUserLoading] = useState(false);
  const [pointsProvPaymentLoading, setPointsProvPaymentLoading] = useState(false);
  const [pointsProvPreview, setPointsProvPreview] = useState(null);
  const [pointsProvUserData, setPointsProvUserData] = useState(null);
  const [pointsProvPaymentData, setPointsProvPaymentData] = useState(null);
  const [pointsSourcesReport, setPointsSourcesReport] = useState(null);
  const [pointsSourcesLoading, setPointsSourcesLoading] = useState(false);
  const [viewRegistrationInfo, setViewRegistrationInfo] = useState(null);
  const [adminUserSessions, setAdminUserSessions] = useState(null);
  const [adminUserSessionsLoading, setAdminUserSessionsLoading] = useState(false);
  const [sessionStats, setSessionStats] = useState(null);
  const [sessionStatsLoading, setSessionStatsLoading] = useState(false);
  const [revokeOldSessionsLoading, setRevokeOldSessionsLoading] = useState(false);
  const [revokeOldUserSessionsLoading, setRevokeOldUserSessionsLoading] = useState(false);
  const [viewRegistrationLoading, setViewRegistrationLoading] = useState(false);
  const [userInspectEmail, setUserInspectEmail] = useState('');
  const [userInspectResult, setUserInspectResult] = useState(null);
  const [userInspectLoading, setUserInspectLoading] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [allUsersList, setAllUsersList] = useState(null);
  const [allUsersTotal, setAllUsersTotal] = useState(null);
  const [allUsersFilter, setAllUsersFilter] = useState('non_npc');
  const [allUsersSort, setAllUsersSort] = useState('username_asc');
  const [allUsersLoading, setAllUsersLoading] = useState(false);
  const [lockedAccounts, setLockedAccounts] = useState([]);
  const [lockedAccountsLoading, setLockedAccountsLoading] = useState(false);
  const [lockedMessageByUser, setLockedMessageByUser] = useState({});
  const [sendingMessageTo, setSendingMessageTo] = useState(null);
  const [userDetailData, setUserDetailData] = useState(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [exclusiveLootOwners, setExclusiveLootOwners] = useState(null);
  const [exclusiveLootLoading, setExclusiveLootLoading] = useState(false);

  // Security state
  const [securitySummary, setSecuritySummary] = useState(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [loginIssues, setLoginIssues] = useState(null);
  const [loginIssuesLoading, setLoginIssuesLoading] = useState(false);
  const [profileLoadErrors, setProfileLoadErrors] = useState(null);
  const [profileLoadErrorsLoading, setProfileLoadErrorsLoading] = useState(false);
  const [rateLimits, setRateLimits] = useState(null);
  const [rateLimitEdits, setRateLimitEdits] = useState({});
  const [rateLimitLog, setRateLimitLog] = useState(null);
  const [rateLimitLogLoading, setRateLimitLogLoading] = useState(false);
  const [rateLimitLogUsername, setRateLimitLogUsername] = useState('');
  const [ipBans, setIpBans] = useState([]);
  const [ipBansLoading, setIpBansLoading] = useState(false);
  const [ipBanUsername, setIpBanUsername] = useState('');
  const [ipBanReason, setIpBanReason] = useState('');
  const [ipBanHours, setIpBanHours] = useState('');
  const [ipUnbanUsername, setIpUnbanUsername] = useState('');
  const [accountBans, setAccountBans] = useState([]);
  const [cheatDetectionConfig, setCheatDetectionConfig] = useState(null);
  const [cheatDetectionConfigLoading, setCheatDetectionConfigLoading] = useState(false);

  // Crime analytics
  const [crimeAnalyticsDays, setCrimeAnalyticsDays] = useState(7);
  const [crimeAnalytics, setCrimeAnalytics] = useState(null);
  const [crimeAnalyticsLoading, setCrimeAnalyticsLoading] = useState(false);

  // Attack analytics
  const [attackAnalyticsDays, setAttackAnalyticsDays] = useState(7);
  const [attackAnalytics, setAttackAnalytics] = useState(null);
  const [attackAnalyticsLoading, setAttackAnalyticsLoading] = useState(false);
  const [attackUserId, setAttackUserId] = useState('');
  const [attackUserProfile, setAttackUserProfile] = useState(null);
  const [attackUserLoading, setAttackUserLoading] = useState(false);
  const [casinoAnalyticsDays, setCasinoAnalyticsDays] = useState(7);
  const [casinoAnalytics, setCasinoAnalytics] = useState(null);
  const [casinoAnalyticsLoading, setCasinoAnalyticsLoading] = useState(false);
  const [ownershipProfits, setOwnershipProfits] = useState(null);
  const [ownershipProfitsLoading, setOwnershipProfitsLoading] = useState(false);
  const [swissBankList, setSwissBankList] = useState(null);
  const [swissBankLoading, setSwissBankLoading] = useState(false);
  const [swissBankWiping, setSwissBankWiping] = useState('');
  const [interestBankByPlayer, setInterestBankByPlayer] = useState(null);
  const [interestBankByPlayerLoading, setInterestBankByPlayerLoading] = useState(false);
  const [interestBankIncludeStaff, setInterestBankIncludeStaff] = useState(false);
  const [pointsStoreSpends, setPointsStoreSpends] = useState(null);
  const [pointsStoreSpendsLoading, setPointsStoreSpendsLoading] = useState(false);
  const [pointsStoreRetractingKey, setPointsStoreRetractingKey] = useState(null);
  const [pointsStoreSpendsUsernameQuery, setPointsStoreSpendsUsernameQuery] = useState('');
  const [tradesAnalyticsDays, setTradesAnalyticsDays] = useState(7);
  const [tradesAnalytics, setTradesAnalytics] = useState(null);
  const [tradesAnalyticsLoading, setTradesAnalyticsLoading] = useState(false);
  const [hitlistBodyguardsAnalyticsDays, setHitlistBodyguardsAnalyticsDays] = useState(7);
  const [hitlistBodyguardsAnalytics, setHitlistBodyguardsAnalytics] = useState(null);
  const [hitlistBodyguardsAnalyticsLoading, setHitlistBodyguardsAnalyticsLoading] = useState(false);
  const [economyAnalyticsDays, setEconomyAnalyticsDays] = useState(7);
  const [economyAnalytics, setEconomyAnalytics] = useState(null);
  const [economyAnalyticsLoading, setEconomyAnalyticsLoading] = useState(false);
  const [analyticsV2Bucket, setAnalyticsV2Bucket] = useState('daily');
  const [analyticsV2Periods, setAnalyticsV2Periods] = useState(14);
  const [analyticsV2Domain, setAnalyticsV2Domain] = useState('');
  const [analyticsV2Overview, setAnalyticsV2Overview] = useState(null);
  const [analyticsV2Trends, setAnalyticsV2Trends] = useState(null);
  const [analyticsV2Leaders, setAnalyticsV2Leaders] = useState(null);
  const [analyticsV2Loading, setAnalyticsV2Loading] = useState(false);
  const [analyticsV2RollupLoading, setAnalyticsV2RollupLoading] = useState(false);
  const [boozeRunAnalyticsDays, setBoozeRunAnalyticsDays] = useState(30);
  const [boozeRunUserDays, setBoozeRunUserDays] = useState(90);
  const [boozeRunOverview, setBoozeRunOverview] = useState(null);
  const [boozeRunOverviewLoading, setBoozeRunOverviewLoading] = useState(false);
  const [boozeRunLeaders, setBoozeRunLeaders] = useState(null);
  const [boozeRunLeadersLoading, setBoozeRunLeadersLoading] = useState(false);
  const [boozeRunLeadersSort, setBoozeRunLeadersSort] = useState('profit');
  const [boozeRunLeadersLimit, setBoozeRunLeadersLimit] = useState(50);
  const [boozeRunUserQuery, setBoozeRunUserQuery] = useState('');
  const [boozeRunUserProfile, setBoozeRunUserProfile] = useState(null);
  const [boozeRunUserLoading, setBoozeRunUserLoading] = useState(false);
  const [referralsReport, setReferralsReport] = useState(null);
  const [referralsReportLoading, setReferralsReportLoading] = useState(false);
  const [referralsFilterUsername, setReferralsFilterUsername] = useState('');
  const [referralsHealLoading, setReferralsHealLoading] = useState(false);
  const [referralsHealResult, setReferralsHealResult] = useState(null);
  const [manualReferee, setManualReferee] = useState('');
  const [manualReferrer, setManualReferrer] = useState('');
  const [manualForce, setManualForce] = useState(false);
  const [manualGrantReferee, setManualGrantReferee] = useState(true);
  const [manualReferrerRespect, setManualReferrerRespect] = useState('500');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState(null);
  const [removeRefereeUsername, setRemoveRefereeUsername] = useState('');
  const [removeReferrerUsername, setRemoveReferrerUsername] = useState('');
  const [removeReferralLoading, setRemoveReferralLoading] = useState(false);
  const [removeReferralResult, setRemoveReferralResult] = useState(null);
  const [removeReferralRowLoading, setRemoveReferralRowLoading] = useState(null);
  const [loginPageVisitors, setLoginPageVisitors] = useState(null);
  const [loginPageViews, setLoginPageViews] = useState(null);
  const [loginPageVisitorsLoading, setLoginPageVisitorsLoading] = useState(false);
  const [attackLogsUsername, setAttackLogsUsername] = useState('');
  const [attackLogsLimit, setAttackLogsLimit] = useState(200);
  const [attackLogsData, setAttackLogsData] = useState(null);
  const [attackLogsLoading, setAttackLogsLoading] = useState(false);
  const [attackLogsLive, setAttackLogsLive] = useState(false);
  const attackLogsDataRef = useRef(null);
  attackLogsDataRef.current = attackLogsData;
  const [attackLogViewRow, setAttackLogViewRow] = useState(null);
  const [crimeLogsUsername, setCrimeLogsUsername] = useState('');
  const [crimeLogsLimit, setCrimeLogsLimit] = useState(500);
  const [crimeLogsData, setCrimeLogsData] = useState(null);
  const [crimeLogsLoading, setCrimeLogsLoading] = useState(false);
  const [gtaLogsUsername, setGtaLogsUsername] = useState('');
  const [gtaLogsLimit, setGtaLogsLimit] = useState(500);
  const [gtaLogsData, setGtaLogsData] = useState(null);
  const [gtaLogsLoading, setGtaLogsLoading] = useState(false);
  const [gtaExclusiveReleased, setGtaExclusiveReleased] = useState(null);
  const [gtaExclusiveLoading, setGtaExclusiveLoading] = useState(false);
  const [gtaExclusiveDropWeight, setGtaExclusiveDropWeight] = useState(0.000006);
  const [gtaExclusiveApproxOneIn, setGtaExclusiveApproxOneIn] = useState(166667);
  const [gtaExclusiveDropWeightInput, setGtaExclusiveDropWeightInput] = useState('0.000006');
  const [giveEveryoneExclusiveLoading, setGiveEveryoneExclusiveLoading] = useState(false);
  const [exclusiveCarValues, setExclusiveCarValues] = useState([]);
  const [exclusiveCarValuesLoading, setExclusiveCarValuesLoading] = useState(false);
  const [editCarId, setEditCarId] = useState('');
  const [editCarValue, setEditCarValue] = useState('');
  const [editCarTravel, setEditCarTravel] = useState('');
  const [editCarSaving, setEditCarSaving] = useState(false);
  const [jailLogsUsername, setJailLogsUsername] = useState('');
  const [jailLogsLimit, setJailLogsLimit] = useState(500);
  const [jailLogsData, setJailLogsData] = useState(null);
  const [jailLogsLoading, setJailLogsLoading] = useState(false);
  const [bankLogsUsername, setBankLogsUsername] = useState('');
  const [bankLogsLimit, setBankLogsLimit] = useState(100);
  const [bankLogsData, setBankLogsData] = useState(null);
  const [donationsLogData, setDonationsLogData] = useState(null);
  const [donationsLogLoading, setDonationsLogLoading] = useState(false);
  const [bankLogsLoading, setBankLogsLoading] = useState(false);
  const [stockLogsUsername, setStockLogsUsername] = useState('');
  const [stockLogsLimit, setStockLogsLimit] = useState(500);
  const [stockLogsData, setStockLogsData] = useState(null);
  const [stockLogsLoading, setStockLogsLoading] = useState(false);

  // Activity & Gambling logs
  const [activityLog, setActivityLog] = useState({ entries: [] });
  const [activityLogLoading, setActivityLogLoading] = useState(false);
  const [activityLogUsername, setActivityLogUsername] = useState('');
  const [activityFeed, setActivityFeed] = useState(null);
  const [activityFeedLoading, setActivityFeedLoading] = useState(false);
  const [activityFeedMinutes, setActivityFeedMinutes] = useState(60);
  const [activityFeedFilter, setActivityFeedFilter] = useState('');
  const [activityFeedUsername, setActivityFeedUsername] = useState('');
  const [activityFeedUsernameMode, setActivityFeedUsernameMode] = useState('exact');
  const [activityFeedMinAmount, setActivityFeedMinAmount] = useState('');
  const [activityFeedSources, setActivityFeedSources] = useState({
    activity: true,
    gambling: true,
    minigame: true,
  });
  const [activityFeedAutoRefresh, setActivityFeedAutoRefresh] = useState(false);
  const activityFeedIntervalRef = useRef(null);
  const [minigamePayouts, setMinigamePayouts] = useState({ entries: [] });
  const [minigamePayoutsLoading, setMinigamePayoutsLoading] = useState(false);
  const [minigamePayoutsUsername, setMinigamePayoutsUsername] = useState('');
  const [minigamePayoutsGame, setMinigamePayoutsGame] = useState('');
  const [weeklyLeaderboardPayouts, setWeeklyLeaderboardPayouts] = useState({ entries: [] });
  const [weeklyLeaderboardPayoutsLoading, setWeeklyLeaderboardPayoutsLoading] = useState(false);
  const [weeklyLeaderboardPayoutsUsername, setWeeklyLeaderboardPayoutsUsername] = useState('');
  const [weeklyLeaderboardPayoutsCategory, setWeeklyLeaderboardPayoutsCategory] = useState('all');
  const [weeklyLeaderboardPayoutsLimit, setWeeklyLeaderboardPayoutsLimit] = useState(200);
  const [gamblingLog, setGamblingLog] = useState({ entries: [] });
  const [gamblingLogLoading, setGamblingLogLoading] = useState(false);
  const [gamblingLogUsername, setGamblingLogUsername] = useState('');
  const [gamblingLogGameType, setGamblingLogGameType] = useState('');
  const [respectLogUserId, setRespectLogUserId] = useState('');
  const [respectLogLimit, setRespectLogLimit] = useState(200);
  const [respectLogData, setRespectLogData] = useState(null);
  const [respectLogLoading, setRespectLogLoading] = useState(false);
  const [currencySpendAuditData, setCurrencySpendAuditData] = useState(null);
  const [currencySpendAuditLoading, setCurrencySpendAuditLoading] = useState(false);
  const [clearGamblingDays, setClearGamblingDays] = useState(30);
  const [clearGamblingLoading, setClearGamblingLoading] = useState(false);

  // State Heads management
  const [stateHeads, setStateHeads] = useState(null);
  const [stateHeadsLoading, setStateHeadsLoading] = useState(false);

  // Racket cooldown reset
  const [racketResetFamilyId, setRacketResetFamilyId] = useState('');
  const [racketResetRacketId, setRacketResetRacketId] = useState('protection');
  const [racketResetLoading, setRacketResetLoading] = useState(false);

  // Casino Max Bets
  const [casinoMaxBets, setCasinoMaxBets] = useState(null);
  const [casinoMaxBetsLoading, setCasinoMaxBetsLoading] = useState(false);
  const [casinoMaxBetGameType, setCasinoMaxBetGameType] = useState('all');
  const [casinoMaxBetLocation, setCasinoMaxBetLocation] = useState('');
  const [casinoMaxBetValue, setCasinoMaxBetValue] = useState('');
  const [casinoMaxBetSaving, setCasinoMaxBetSaving] = useState(false);

  // Cheat detection
  const [cheatSameIp, setCheatSameIp] = useState(null);
  const [cheatSameDeviceIps, setCheatSameDeviceIps] = useState(null);
  const [cheatLoginEvents, setCheatLoginEvents] = useState(null);
  const [cheatDuplicates, setCheatDuplicates] = useState(null);
  const [cheatDupeIntelligent, setCheatDupeIntelligent] = useState(null);
  const [cheatLoading, setCheatLoading] = useState(false);
  const [gamblingAnomalies, setGamblingAnomalies] = useState(null);
  const [gamblingAnomaliesLoading, setGamblingAnomaliesLoading] = useState(false);
  const [duplicateSuspectsUsername, setDuplicateSuspectsUsername] = useState('');
  const [botInvestQuery, setBotInvestQuery] = useState('');
  const [botInvestProfile, setBotInvestProfile] = useState(null);
  const [botInvestActivity, setBotInvestActivity] = useState(null);
  const [botInvestDupe, setBotInvestDupe] = useState(null);
  const [botInvestRateLimit, setBotInvestRateLimit] = useState(null);
  const [botInvestBlocks, setBotInvestBlocks] = useState(null);
  const [botInvestLoading, setBotInvestLoading] = useState(false);

  const [adminOnlineColor, setAdminOnlineColor] = useState('#a78bfa');
  const [modDefaultOnlineColor, setModDefaultOnlineColor] = useState('#1e3a5f');
  const [requireEmailVerification, setRequireEmailVerification] = useState(false);
  const [blockProxyVpnLogin, setBlockProxyVpnLogin] = useState(true);
  const [blockScriptUserAgentLogin, setBlockScriptUserAgentLogin] = useState(true);
  const [blockScriptUserAgentGameActions, setBlockScriptUserAgentGameActions] = useState(true);
  const [blockScriptUaSaving, setBlockScriptUaSaving] = useState(false);
  const [blockScriptGameActionsSaving, setBlockScriptGameActionsSaving] = useState(false);
  const [gameActionsClientStrict, setGameActionsClientStrict] = useState(false);
  const [gameActionsTurnstileEnabled, setGameActionsTurnstileEnabled] = useState(false);
  const [minigameTurnstileEnabled, setMinigameTurnstileEnabled] = useState(false);
  const [minigameTurnstileSiteKey, setMinigameTurnstileSiteKey] = useState('');
  const [loginTurnstileEnabled, setLoginTurnstileEnabled] = useState(false);
  const [captchaFailModalOpen, setCaptchaFailModalOpen] = useState(false);
  const [captchaFailRows, setCaptchaFailRows] = useState([]);
  const [captchaFailTotal, setCaptchaFailTotal] = useState(0);
  const [captchaFailLoading, setCaptchaFailLoading] = useState(false);
  const [captchaFailUserDraft, setCaptchaFailUserDraft] = useState('');
  const [captchaFailUserQuery, setCaptchaFailUserQuery] = useState('');
  const [spotifyFeatureEnabled, setSpotifyFeatureEnabled] = useState(false);
  const [landingBannerEnabled, setLandingBannerEnabled] = useState(false);
  const [landingBannerMessage, setLandingBannerMessage] = useState('');
  const [stockMarketMaxPoints, setStockMarketMaxPoints] = useState(3000);
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [loginLockFrom, setLoginLockFrom] = useState('');
  const [loginLockUntil, setLoginLockUntil] = useState('');
  const [loginLockMessage, setLoginLockMessage] = useState('');
  const [preregisterLandingBannerEnabled, setPreregisterLandingBannerEnabled] = useState(true);
  const [preregisterBannerPreviewOpen, setPreregisterBannerPreviewOpen] = useState(false);
  const [preorderReleaseDate, setPreorderReleaseDate] = useState('');
  const [storePointsAutoCredit, setStorePointsAutoCredit] = useState(true);
  const [storePointsManualCreditEta, setStorePointsManualCreditEta] = useState('');
  const [launchSettingsSaving, setLaunchSettingsSaving] = useState(false);
  const [preorderReleaseLoading, setPreorderReleaseLoading] = useState(false);
  const [manualCreditLoading, setManualCreditLoading] = useState(null);
  const [stripeSessionInput, setStripeSessionInput] = useState('');
  const [checkStripeLoading, setCheckStripeLoading] = useState(false);
  const [stripeCheckResult, setStripeCheckResult] = useState(null);
  const [casinoGlobalMaxBet, setCasinoGlobalMaxBet] = useState(1000000000);
  const [casinoBuybackMaxPoints, setCasinoBuybackMaxPoints] = useState(15000);
  const [mpPokerMaxBlind, setMpPokerMaxBlind] = useState(2500000);
  const [casinoCapsSaving, setCasinoCapsSaving] = useState(false);
  const [claimCosts, setClaimCosts] = useState({
    dice_cash: 0,
    dice_points: 0,
    roulette: 0,
    blackjack: 0,
    horseracing: 0,
    video_poker: 0,
    airport: 0,
    armoury: 0,
  });
  const [claimCostsLoading, setClaimCostsLoading] = useState(false);
  const [claimCostsSaving, setClaimCostsSaving] = useState(false);
  const [pageLocks, setPageLocks] = useState({});
  const [pageLockPath, setPageLockPath] = useState('');
  const [pageLockMessage, setPageLockMessage] = useState('Down for maintenance');
  const [pageLockUnlockAt, setPageLockUnlockAt] = useState('');
  const [pageLockSaving, setPageLockSaving] = useState(false);

  const [moderatorsList, setModeratorsList] = useState([]);
  const [moderatorsLoading, setModeratorsLoading] = useState(false);
  const [modOnlineColor, setModOnlineColor] = useState('#1e3a5f');
  const [modColorSaving, setModColorSaving] = useState(false);
  const [promoteModUsername, setPromoteModUsername] = useState('');
  const [promoteModLoading, setPromoteModLoading] = useState(false);
  const [hdosList, setHdosList] = useState([]);
  const [hdosLoading, setHdosLoading] = useState(false);
  const [promoteHdoUsername, setPromoteHdoUsername] = useState('');
  const [promoteHdoLoading, setPromoteHdoLoading] = useState(false);
  const [modVisibleCategoriesSaving, setModVisibleCategoriesSaving] = useState(false);

  const [economyOverview, setEconomyOverview] = useState(null);
  const [economyOverviewLoading, setEconomyOverviewLoading] = useState(false);
  const [cashHolders, setCashHolders] = useState(null);
  const [cashHoldersLoading, setCashHoldersLoading] = useState(false);
  const [cashHoldersOffset, setCashHoldersOffset] = useState(0);
  const [cashHoldersSearchInput, setCashHoldersSearchInput] = useState('');
  const [cashHoldersSort, setCashHoldersSort] = useState('money_desc');
  const [capitalBreakdown, setCapitalBreakdown] = useState(null);
  const [capitalBreakdownLoading, setCapitalBreakdownLoading] = useState(false);
  const [playerActivity, setPlayerActivity] = useState(null);
  const [playerActivityLoading, setPlayerActivityLoading] = useState(false);
  const [compareUser1, setCompareUser1] = useState('');
  const [compareUser2, setCompareUser2] = useState('');
  const [compareResult, setCompareResult] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [systemHealth, setSystemHealth] = useState(null);
  const [systemHealthLoading, setSystemHealthLoading] = useState(false);
  const [maintenanceBanner, setMaintenanceBanner] = useState(null);
  const [maintenanceBannerLoading, setMaintenanceBannerLoading] = useState(false);
  const [releaseSoftLaunchAdmin, setReleaseSoftLaunchAdmin] = useState(null);
  const [releaseSoftLaunchLoading, setReleaseSoftLaunchLoading] = useState(false);
  const [releaseSoftLaunchUnlockAt, setReleaseSoftLaunchUnlockAt] = useState('2026-04-04T17:00:00+00:00');
  const [releaseSoftLaunchPvpUnlockAt, setReleaseSoftLaunchPvpUnlockAt] = useState('2026-04-04T17:00:00+00:00');
  const [maintenanceMsg, setMaintenanceMsg] = useState('');
  const [maintenanceDuration, setMaintenanceDuration] = useState(60);
  const [bulkUsernames, setBulkUsernames] = useState('');
  const [bulkAction, setBulkAction] = useState('give_points');
  const [bulkValue, setBulkValue] = useState(100);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [redeemCodesList, setRedeemCodesList] = useState([]);
  const [redeemCodesLoading, setRedeemCodesLoading] = useState(false);
  const [redeemCodeCreateLoading, setRedeemCodeCreateLoading] = useState(false);
  const [tokenTypes, setTokenTypes] = useState([]);
  const [redeemForm, setRedeemForm] = useState({
    code: '',
    max_uses: '',
    money: '',
    points: '',
    respect_points: '',
    loot_box_pieces: '',
    cars: [],
    tokenEntries: [], // [{ type, amount }]
  });

  const toggleSection = (key) => {
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveCollapsed(next);
      return next;
    });
  };

  const checkAdmin = async () => {
    try {
      const response = await api.get('/admin/check');
      const admin = !!response.data.is_admin;
      const mod = !!response.data.is_moderator;
      setIsAdmin(admin);
      setIsModerator(mod);
      if (mod && Array.isArray(response.data.mod_visible_category_ids) && response.data.mod_visible_category_ids.length > 0) {
        setModVisibleCategoryIds(response.data.mod_visible_category_ids);
      }
      if (admin) {
        fetchMeta();
        fetchEventsStatus();
        fetchBoozeRotation();
        fetchBoozeJailChances();
        fetchBoozeListedPrice();
        fetchAdminSettings();
        fetchModerators();
        fetchCfBotBlockStatus();
        fetchCfAutoBlockStatus();
        fetchPageLocks();
        fetchClaimCosts();
        fetchStateHeads();  // Auto-load state heads to show duplicate warnings
      }
      if (admin || mod) {
        fetchHdos();
      }
      if (mod && !admin) {
        fetchPageLocks();  // Mods need page locks for Mod Tools Lock page
      }
    } catch {
      setIsAdmin(false);
      setIsModerator(false);
    }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!isModerator) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/auth/me');
        if (!cancelled && res.data?.mod_online_color != null && (res.data.mod_online_color || '').trim())
          setModOnlineColor((res.data.mod_online_color || '').trim());
        else if (!cancelled && res.data && !res.data.mod_online_color) setModOnlineColor('#1e3a5f');
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [isModerator]);

  const fetchModerators = async () => {
    setModeratorsLoading(true);
    try {
      const res = await api.get('/admin/moderators');
      setModeratorsList(res.data?.moderators ?? []);
    } catch {
      setModeratorsList([]);
    } finally {
      setModeratorsLoading(false);
    }
  };

  const handlePromoteModerator = async () => {
    const username = (promoteModUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    setPromoteModLoading(true);
    try {
      const res = await api.post('/admin/promote-moderator', null, { params: { target_username: username } });
      toast.success(res.data?.message ?? 'Promoted');
      setPromoteModUsername('');
      fetchModerators();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed');
    } finally {
      setPromoteModLoading(false);
    }
  };

  const handleDemoteModerator = async (username) => {
    try {
      const res = await api.post('/admin/demote-moderator', null, { params: { target_username: username } });
      toast.success(res.data?.message ?? 'Demoted');
      fetchModerators();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed');
    }
  };

  const handleSaveModVisibleCategories = async () => {
    setModVisibleCategoriesSaving(true);
    try {
      await api.patch('/admin/settings', { mod_visible_category_ids: modVisibleCategoryIds });
      toast.success('Mod visible categories saved');
    } catch (e) {
      toast.error(e?.response?.data?.detail ?? 'Failed to save');
    } finally {
      setModVisibleCategoriesSaving(false);
    }
  };

  const fetchHdos = async () => {
    setHdosLoading(true);
    try {
      const res = await api.get('/admin/help-desk-operators');
      setHdosList(res.data?.help_desk_operators ?? []);
    } catch {
      setHdosList([]);
    } finally {
      setHdosLoading(false);
    }
  };

  const handlePromoteHdo = async () => {
    const username = (promoteHdoUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    setPromoteHdoLoading(true);
    try {
      const res = await api.post('/admin/promote-hdo', null, { params: { target_username: username } });
      toast.success(res.data?.message ?? 'Promoted');
      setPromoteHdoUsername('');
      fetchHdos();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed');
    } finally {
      setPromoteHdoLoading(false);
    }
  };

  const handleDemoteHdo = async (username) => {
    try {
      const res = await api.post('/admin/demote-hdo', null, { params: { target_username: username } });
      toast.success(res.data?.message ?? 'Demoted');
      fetchHdos();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed');
    }
  };

  const handleSaveModOnlineColor = async () => {
    const hex = (modOnlineColor || '').trim() || '#1e3a5f';
    if (!/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) {
      toast.error('Enter a valid hex colour (e.g. #1e3a5f)');
      return;
    }
    setModColorSaving(true);
    try {
      await api.patch('/profile/mod-online-color', { color: hex });
      toast.success('Mod online colour saved');
      const res = await api.get('/auth/me');
      if (res.data?.mod_online_color != null) setModOnlineColor((res.data.mod_online_color || '').trim() || '#1e3a5f');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setModColorSaving(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkAdmin(); }, []);

  useEffect(() => {
    if (activeCategoryId === 'admin-world-systems' && isAdmin) {
      api.get('/admin/families-list').then((res) => setAdminFamiliesList(res.data?.families || [])).catch(() => {});
    }
  }, [activeCategoryId, isAdmin]);

  // Auto-load rate limit status for admin
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const response = await api.get('/admin/security/rate-limits');
        setRateLimits(response.data);
      } catch (e) {
        // Silent fail - just don't show status
      }
    })();
  }, [isAdmin]);

  // When navigating from Profile staff buttons with state (e.g. activity log / gambling log / target user)
  useEffect(() => {
    const s = location.state;
    if (!s || typeof s !== 'object') return;
    if (s.targetUsername != null && s.targetUsername !== '') {
      setFormData((prev) => ({ ...prev, targetUsername: String(s.targetUsername) }));
    }
    if (s.activityLogUsername != null && s.activityLogUsername !== '') {
      setActivityLogUsername(String(s.activityLogUsername));
      setActiveCategoryId('admin-analytics-monitoring');
      setCollapsed((prev) => ({ ...prev, activityLog: false }));
      if (typeof window !== 'undefined') window.location.hash = 'admin-analytics-monitoring';
    }
    if (s.gamblingLogUsername != null && s.gamblingLogUsername !== '') {
      setGamblingLogUsername(String(s.gamblingLogUsername));
      setActiveCategoryId('admin-analytics-monitoring');
      setCollapsed((prev) => ({ ...prev, gamblingLog: false }));
      if (typeof window !== 'undefined') window.location.hash = 'admin-analytics-monitoring';
    }
    if (s.respectLogUserId != null && String(s.respectLogUserId).trim()) {
      const rid = String(s.respectLogUserId).trim();
      setRespectLogUserId(rid);
      setActiveCategoryId('admin-operations');
      setCollapsed((prev) => ({ ...prev, respectPointsLog: false }));
      if (typeof window !== 'undefined') window.location.hash = 'admin-operations';
      const lim = Math.max(1, Math.min(1000, parseInt(String(respectLogLimit), 10) || 200));
      setRespectLogLoading(true);
      setRespectLogData(null);
      api.get('/admin/respect-points-log', { params: { user_id: rid, limit: lim } })
        .then((res) => {
          setRespectLogData(res.data);
          toast.success('Respect log loaded');
        })
        .catch((e) => {
          toast.error(e.response?.data?.detail || 'Failed to load respect log');
        })
        .finally(() => setRespectLogLoading(false));
    }
  }, [location.state]);

  const fetchEventsStatus = async () => {
    try {
      const res = await api.get('/admin/events');
      setEventsEnabled(!!res.data?.events_enabled);
      setAllEventsForTesting(!!res.data?.all_events_for_testing);
      setTodayEvent(res.data?.today_event ?? null);
      setEventList(res.data?.events ?? []);
      setOverrideEventId(res.data?.override_event_id ?? null);
    } catch {
      setEventsEnabled(true);
      setAllEventsForTesting(false);
      setTodayEvent(null);
      setEventList([]);
      setOverrideEventId(null);
    }
  };

  const fetchBoozeRotation = async () => {
    try {
      const res = await api.get('/admin/booze-rotation');
      setBoozeRotationSeconds(res.data?.rotation_seconds ?? null);
    } catch {
      setBoozeRotationSeconds(null);
    }
  };

  const fetchBoozeListedPrice = async () => {
    try {
      const res = await api.get('/admin/booze-listed-price');
      setBoozeListedPrice(res.data ?? null);
    } catch {
      setBoozeListedPrice(null);
    }
  };

  const handleBoozeListedPriceNudge = async (delta) => {
    setBoozePriceSaving(true);
    try {
      const res = await api.post('/admin/booze-listed-price', { delta_percent_off: delta });
      const prem = res.data?.percent_premium;
      const off = res.data?.percent_off;
      let label = 'Full listed prices (no discount / premium)';
      if (prem != null && Number(prem) > 0) {
        label = `Listed +${Number(prem).toFixed(2).replace(/\.?0+$/, '')}% vs rotation baseline`;
      } else if (off != null && Number(off) > 0) {
        label = `Now ${Number(off).toFixed(2).replace(/\.?0+$/, '')}% off listed prices`;
      }
      toast.success(label);
      await fetchBoozeListedPrice();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update booze prices');
    } finally {
      setBoozePriceSaving(false);
    }
  };

  const handleBoozeListedPriceReset = async () => {
    setBoozePriceSaving(true);
    try {
      await api.post('/admin/booze-listed-price', { reset: true });
      toast.success('Booze listed prices restored to full (no global discount)');
      await fetchBoozeListedPrice();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reset');
    } finally {
      setBoozePriceSaving(false);
    }
  };

  const fetchBoozeJailChances = async () => {
    try {
      const res = await api.get('/admin/booze-jail-chances');
      const d = res.data;
      setBoozeJailChances(d ?? null);
      if (d) {
        const fmt = (x) => (x != null ? (Number(x) * 100).toFixed(2).replace(/\.?0+$/, '') : '');
        setBoozeJailMinPct(fmt(d.effective_jail_chance_min));
        setBoozeJailMaxPct(fmt(d.effective_jail_chance_max));
      }
    } catch {
      setBoozeJailChances(null);
    }
  };

  const handleBoozeJailSave = async () => {
    const min = parseFloat(String(boozeJailMinPct).replace(',', '.'));
    const max = parseFloat(String(boozeJailMaxPct).replace(',', '.'));
    if (Number.isNaN(min) || Number.isNaN(max)) {
      toast.error('Enter min and max as percentages (e.g. 5 and 15)');
      return;
    }
    if (min < 0 || max > 100 || min > max) {
      toast.error('Percentages must be 0–100 and min ≤ max');
      return;
    }
    setBoozeJailSaving(true);
    try {
      await api.post('/admin/booze-jail-chances', { jail_chance_min: min / 100, jail_chance_max: max / 100 });
      toast.success('Booze jail chances updated');
      await fetchBoozeJailChances();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update jail chances');
    } finally {
      setBoozeJailSaving(false);
    }
  };

  const handleBoozeJailReset = async () => {
    setBoozeJailSaving(true);
    try {
      await api.post('/admin/booze-jail-chances', { reset: true });
      toast.success('Booze jail chances reset to code defaults');
      await fetchBoozeJailChances();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reset');
    } finally {
      setBoozeJailSaving(false);
    }
  };

  const fetchPresenceSim = async () => {
    setPresenceSimLoading(true);
    try {
      const res = await api.get('/admin/presence-simulator');
      const d = res.data;
      setPresenceSim(d);
      if (d) {
        setPsForm({
          intervalMin: String(Math.round(((Number(d.interval_seconds) || 300) / 60) * 100) / 100),
          minAdd: String(d.min_add_per_tick ?? 1),
          maxAdd: String(d.max_add_per_tick ?? 3),
          maxRemove: String(d.max_remove_per_tick ?? 2),
          maxPool: String(d.max_pool ?? 25),
          skipUsernames: Array.isArray(d.skip_usernames) ? d.skip_usernames.join('\n') : '',
          gradualAdd: d.gradual_add !== false,
          secondsBetweenAdds: String(d.seconds_between_adds ?? 25),
        });
      }
    } catch {
      setPresenceSim(null);
    } finally {
      setPresenceSimLoading(false);
    }
  };

  const handlePresenceSimToggle = async () => {
    if (!presenceSim) return;
    setPresenceSimLoading(true);
    try {
      const res = await api.post('/admin/presence-simulator', { enabled: !presenceSim.enabled });
      setPresenceSim(res.data);
      toast.success(res.data?.enabled ? 'Presence simulator on' : 'Presence simulator off');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setPresenceSimLoading(false);
    }
  };

  const handlePresenceSimSave = async () => {
    const intervalMin = parseFloat(String(psForm.intervalMin).replace(',', '.'));
    const minAdd = parseInt(psForm.minAdd, 10);
    const maxAdd = parseInt(psForm.maxAdd, 10);
    const maxRemove = parseInt(psForm.maxRemove, 10);
    const maxPool = parseInt(psForm.maxPool, 10);
    if (Number.isNaN(intervalMin) || Number.isNaN(minAdd) || Number.isNaN(maxAdd) || Number.isNaN(maxRemove) || Number.isNaN(maxPool)) {
      toast.error('Enter valid numbers');
      return;
    }
    const skipUsernames = String(psForm.skipUsernames || '')
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const secBetween = parseInt(String(psForm.secondsBetweenAdds).replace(/\D/g, ''), 10);
    setPresenceSimLoading(true);
    try {
      const res = await api.post('/admin/presence-simulator', {
        interval_minutes: intervalMin,
        min_add_per_tick: minAdd,
        max_add_per_tick: maxAdd,
        max_remove_per_tick: maxRemove,
        max_pool: maxPool,
        skip_usernames: skipUsernames,
        gradual_add: !!psForm.gradualAdd,
        seconds_between_adds: Number.isNaN(secBetween) ? 25 : secBetween,
      });
      setPresenceSim(res.data);
      toast.success('Presence simulator settings saved');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setPresenceSimLoading(false);
    }
  };

  const handlePresenceSimRunNow = async () => {
    setPresenceSimLoading(true);
    try {
      const res = await api.post('/admin/presence-simulator', { run_now: true });
      setPresenceSim(res.data);
      toast.success('Ran one tick');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setPresenceSimLoading(false);
    }
  };

  const loadCaptchaTurnstileFailures = useCallback(async (filterUserId) => {
    setCaptchaFailLoading(true);
    try {
      const uid =
        filterUserId !== undefined && filterUserId !== null
          ? String(filterUserId).trim()
          : captchaFailUserQuery.trim();
      const params = { limit: 200, skip: 0 };
      if (uid) params.user_id = uid;
      const r = await api.get('/admin/captcha-turnstile-failures', { params });
      setCaptchaFailRows(Array.isArray(r.data?.items) ? r.data.items : []);
      setCaptchaFailTotal(typeof r.data?.total === 'number' ? r.data.total : 0);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || 'Failed to load captcha failures');
    } finally {
      setCaptchaFailLoading(false);
    }
  }, [captchaFailUserQuery]);

  useEffect(() => {
    if (!captchaFailModalOpen) return;
    loadCaptchaTurnstileFailures();
  }, [captchaFailModalOpen, loadCaptchaTurnstileFailures]);

  const fetchAdminSettings = async () => {
    try {
      const res = await api.get('/admin/settings');
      const hex = res.data?.admin_online_color || '#a78bfa';
      setAdminOnlineColor(hex.startsWith('#') ? hex : '#' + hex);
      const modHex = res.data?.mod_default_online_color || '#1e3a5f';
      setModDefaultOnlineColor(modHex.startsWith('#') ? modHex : '#' + modHex);
      setRequireEmailVerification(!!res.data?.require_email_verification);
      setBlockProxyVpnLogin(res.data?.block_proxy_vpn_login !== false);
      setBlockScriptUserAgentLogin(res.data?.block_script_user_agent_login !== false);
      setBlockScriptUserAgentGameActions(res.data?.block_script_user_agent_game_actions !== false);
      setGameActionsClientStrict(!!res.data?.game_actions_client_strict);
      setGameActionsTurnstileEnabled(!!res.data?.game_actions_turnstile_enabled);
      setMinigameTurnstileEnabled(!!res.data?.minigame_turnstile_enabled);
      setMinigameTurnstileSiteKey((res.data?.minigame_turnstile_site_key ?? '').trim());
      setLoginTurnstileEnabled(!!res.data?.login_turnstile_enabled);
      setSpotifyFeatureEnabled(!!res.data?.spotify_feature_enabled);
      setLandingBannerEnabled(!!res.data?.landing_banner_enabled);
      setLandingBannerMessage(res.data?.landing_banner_message ?? '');
      setStockMarketMaxPoints(Math.max(1, parseInt(res.data?.stock_market_max_points, 10) || 3000));
      setLoginLockFrom(res.data?.login_lock_from || '');
      setLoginLockUntil(res.data?.login_lock_until || '');
      setLoginLockMessage(res.data?.login_lock_message || '');
      setPreregisterLandingBannerEnabled(
        res.data?.preregister_landing_banner_enabled !== undefined
          ? !!res.data.preregister_landing_banner_enabled
          : true,
      );
      setPreregisterBannerPreviewOpen(!!res.data?.preregister_landing_banner_preview_open);
      setPreorderReleaseDate(res.data?.preorder_points_release_date || '');
      setStorePointsAutoCredit(res.data?.store_points_auto_credit !== false);
      setStorePointsManualCreditEta(res.data?.store_points_manual_credit_eta || '');
      setCasinoGlobalMaxBet(res.data?.casino_global_max_bet || 1000000000);
      setCasinoBuybackMaxPoints(res.data?.casino_buyback_max_points || 15000);
      setMpPokerMaxBlind(res.data?.mp_poker_max_blind || 2500000);
      if (Array.isArray(res.data?.mod_visible_category_ids)) {
        const mapped = Array.from(
          new Set(
            (res.data.mod_visible_category_ids || [])
              .map((id) => normalizeCategoryId(String(id || '').trim()))
              .filter((id) => ADMIN_CATEGORIES.some((c) => c.id === id)),
          ),
        );
        setModVisibleCategoryIds(mapped.length ? mapped : [...MOD_ONLY_CATEGORY_IDS]);
      }
    } catch {
      setAdminOnlineColor('#a78bfa');
      setModDefaultOnlineColor('#1e3a5f');
      setRequireEmailVerification(false);
      setBlockProxyVpnLogin(true);
      setBlockScriptUserAgentLogin(true);
      setBlockScriptUserAgentGameActions(true);
      setGameActionsClientStrict(false);
      setGameActionsTurnstileEnabled(false);
      setMinigameTurnstileEnabled(false);
      setMinigameTurnstileSiteKey('');
      setLoginTurnstileEnabled(false);
      setSpotifyFeatureEnabled(false);
      setLandingBannerMessage('');
      setStockMarketMaxPoints(3000);
      setLoginLockFrom('');
      setLoginLockUntil('');
      setLoginLockMessage('');
      setPreregisterLandingBannerEnabled(true);
      setPreregisterBannerPreviewOpen(false);
      setPreorderReleaseDate('');
      setStorePointsAutoCredit(true);
      setStorePointsManualCreditEta('');
      setCasinoGlobalMaxBet(1000000000);
      setCasinoBuybackMaxPoints(15000);
      setMpPokerMaxBlind(2500000);
    }
  };

  const fetchPageLocks = async () => {
    try {
      const res = await api.get('/admin/page-locks');
      setPageLocks(res.data?.paths ?? {});
    } catch {
      setPageLocks({});
    }
  };

  const handlePageLockToggle = async (path, locked, message, unlockAt) => {
    setPageLockSaving(true);
    try {
      await api.patch('/admin/page-locks', {
        path,
        message: message || 'Down for maintenance',
        locked,
        unlock_at: (unlockAt || '').trim() || null,
      });
      await fetchPageLocks();
      toast.success(locked ? `Locked ${path}` : `Unlocked ${path}`);
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed');
    } finally {
      setPageLockSaving(false);
    }
  };

  const handleSaveAdminSettings = async () => {
    setAdminSettingsSaving(true);
    try {
      const res = await api.patch('/admin/settings', {
        admin_online_color: adminOnlineColor,
        mod_default_online_color: modDefaultOnlineColor,
        require_email_verification: requireEmailVerification,
        block_proxy_vpn_login: blockProxyVpnLogin,
        block_script_user_agent_login: blockScriptUserAgentLogin,
        block_script_user_agent_game_actions: blockScriptUserAgentGameActions,
        game_actions_client_strict: gameActionsClientStrict,
        game_actions_turnstile_enabled: gameActionsTurnstileEnabled,
        minigame_turnstile_enabled: minigameTurnstileEnabled,
        minigame_turnstile_site_key: minigameTurnstileSiteKey.trim(),
        login_turnstile_enabled: loginTurnstileEnabled,
        spotify_feature_enabled: spotifyFeatureEnabled,
        landing_banner_enabled: landingBannerEnabled,
        landing_banner_message: landingBannerMessage,
        stock_market_max_points: Math.max(1, parseInt(stockMarketMaxPoints, 10) || 3000),
      });
      setAdminOnlineColor(res.data?.admin_online_color || adminOnlineColor);
      setModDefaultOnlineColor(res.data?.mod_default_online_color || modDefaultOnlineColor);
      setRequireEmailVerification(!!res.data?.require_email_verification);
      setBlockProxyVpnLogin(res.data?.block_proxy_vpn_login !== false);
      setBlockScriptUserAgentLogin(res.data?.block_script_user_agent_login !== false);
      setBlockScriptUserAgentGameActions(res.data?.block_script_user_agent_game_actions !== false);
      if (res.data?.game_actions_client_strict !== undefined) setGameActionsClientStrict(!!res.data.game_actions_client_strict);
      if (res.data?.game_actions_turnstile_enabled !== undefined) {
        setGameActionsTurnstileEnabled(!!res.data.game_actions_turnstile_enabled);
      }
      setMinigameTurnstileEnabled(!!res.data?.minigame_turnstile_enabled);
      if (res.data?.minigame_turnstile_site_key !== undefined) {
        setMinigameTurnstileSiteKey((res.data.minigame_turnstile_site_key ?? '').trim());
      }
      setLoginTurnstileEnabled(!!res.data?.login_turnstile_enabled);
      setSpotifyFeatureEnabled(!!res.data?.spotify_feature_enabled);
      setLandingBannerEnabled(!!res.data?.landing_banner_enabled);
      if (res.data?.landing_banner_message !== undefined) setLandingBannerMessage(res.data.landing_banner_message ?? '');
      setStockMarketMaxPoints(Math.max(1, res.data?.stock_market_max_points ?? 3000));
      toast.success('Settings saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setAdminSettingsSaving(false);
    }
  };

  const applyBlockScriptUserAgentLogin = async (enabled) => {
    setBlockScriptUaSaving(true);
    try {
      const res = await api.patch('/admin/settings', { block_script_user_agent_login: !!enabled });
      setBlockScriptUserAgentLogin(res.data?.block_script_user_agent_login !== false);
      setBlockScriptUserAgentGameActions(res.data?.block_script_user_agent_game_actions !== false);
      toast.success(enabled ? 'Bot/script blocking enabled' : 'Bot/script blocking disabled');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to update');
    } finally {
      setBlockScriptUaSaving(false);
    }
  };

  const applyBlockScriptUserAgentGameActions = async (enabled) => {
    setBlockScriptGameActionsSaving(true);
    try {
      const res = await api.patch('/admin/settings', { block_script_user_agent_game_actions: !!enabled });
      setBlockScriptUserAgentLogin(res.data?.block_script_user_agent_login !== false);
      setBlockScriptUserAgentGameActions(res.data?.block_script_user_agent_game_actions !== false);
      toast.success(enabled ? 'Gameplay bot blocking enabled' : 'Gameplay bot blocking disabled');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to update');
    } finally {
      setBlockScriptGameActionsSaving(false);
    }
  };

  const handleSaveLoginLock = async () => {
    setLaunchSettingsSaving(true);
    try {
      await api.patch('/admin/settings', {
        login_lock_from: loginLockFrom || null,
        login_lock_until: loginLockUntil || null,
        login_lock_message: loginLockMessage || null,
      });
      toast.success('Login lock settings saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save login lock');
    } finally {
      setLaunchSettingsSaving(false);
    }
  };

  const handleTogglePreregisterBanner = async () => {
    setLaunchSettingsSaving(true);
    const next = !preregisterLandingBannerEnabled;
    try {
      const res = await api.patch('/admin/settings', {
        preregister_landing_banner_enabled: next,
      });
      setPreregisterLandingBannerEnabled(!!res.data?.preregister_landing_banner_enabled);
      if (!next) {
        setPreregisterBannerPreviewOpen(!!res.data?.preregister_landing_banner_preview_open);
      }
      toast.success(next ? 'Pre-register banner on' : 'Pre-register banner off');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to update banner');
    } finally {
      setLaunchSettingsSaving(false);
    }
  };

  const handleTogglePreregisterBannerPreview = async () => {
    setLaunchSettingsSaving(true);
    const next = !preregisterBannerPreviewOpen;
    try {
      const res = await api.patch('/admin/settings', {
        preregister_landing_banner_preview_open: next,
      });
      setPreregisterBannerPreviewOpen(!!res.data?.preregister_landing_banner_preview_open);
      toast.success(
        next
          ? 'Mini banner preview on (visible on /login while logins are open)'
          : 'Mini banner preview off',
      );
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to update preview');
    } finally {
      setLaunchSettingsSaving(false);
    }
  };

  const handleSavePreorder = async () => {
    setLaunchSettingsSaving(true);
    try {
      await api.patch('/admin/settings', {
        preorder_points_release_date: preorderReleaseDate || null,
      });
      toast.success('Preorder settings saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save preorder settings');
    } finally {
      setLaunchSettingsSaving(false);
    }
  };

  const handleSaveStorePointsCredit = async () => {
    setLaunchSettingsSaving(true);
    try {
      const res = await api.patch('/admin/settings', {
        store_points_auto_credit: storePointsAutoCredit,
        store_points_manual_credit_eta: storePointsManualCreditEta || null,
      });
      setStorePointsAutoCredit(res.data?.store_points_auto_credit !== false);
      setStorePointsManualCreditEta(res.data?.store_points_manual_credit_eta || '');
      toast.success('Store crediting settings saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save store crediting');
    } finally {
      setLaunchSettingsSaving(false);
    }
  };

  const handleClearStoreManualEta = async () => {
    setLaunchSettingsSaving(true);
    try {
      const res = await api.patch('/admin/settings', {
        store_points_manual_credit_eta: null,
      });
      setStorePointsManualCreditEta(res.data?.store_points_manual_credit_eta || '');
      toast.success('Manual credit time cleared');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to clear');
    } finally {
      setLaunchSettingsSaving(false);
    }
  };

  const handleSaveCasinoCaps = async () => {
    setCasinoCapsSaving(true);
    try {
      await api.patch('/admin/settings', {
        casino_global_max_bet: Math.max(1000000, parseInt(String(casinoGlobalMaxBet).replace(/\D/g, ''), 10) || 1000000000),
        casino_buyback_max_points: Math.max(0, parseInt(String(casinoBuybackMaxPoints).replace(/\D/g, ''), 10) || 15000),
        mp_poker_max_blind: Math.max(1000, parseInt(String(mpPokerMaxBlind).replace(/\D/g, ''), 10) || 2500000),
      });
      toast.success('Casino caps saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save casino caps');
    } finally {
      setCasinoCapsSaving(false);
    }
  };

  const fetchClaimCosts = async () => {
    setClaimCostsLoading(true);
    try {
      const res = await api.get('/admin/claim-costs');
      const d = res.data || {};
      const n = (k) => Math.max(0, parseInt(String(d[k] ?? 0).replace(/\D/g, ''), 10) || 0);
      setClaimCosts({
        dice_cash: n('dice_cash'),
        dice_points: n('dice_points'),
        roulette: n('roulette'),
        blackjack: n('blackjack'),
        horseracing: n('horseracing'),
        video_poker: n('video_poker'),
        airport: n('airport'),
        armoury: n('armoury'),
      });
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to load claim costs');
    } finally {
      setClaimCostsLoading(false);
    }
  };

  const handleSaveClaimCosts = async () => {
    const parseN = (v) => Math.max(0, parseInt(String(v).replace(/\D/g, ''), 10) || 0);
    setClaimCostsSaving(true);
    try {
      const res = await api.patch('/admin/claim-costs', {
        dice_cash: parseN(claimCosts.dice_cash),
        dice_points: parseN(claimCosts.dice_points),
        roulette: parseN(claimCosts.roulette),
        blackjack: parseN(claimCosts.blackjack),
        horseracing: parseN(claimCosts.horseracing),
        video_poker: parseN(claimCosts.video_poker),
        airport: parseN(claimCosts.airport),
        armoury: parseN(claimCosts.armoury),
      });
      const d = res.data || {};
      const n = (k) => Math.max(0, parseInt(String(d[k] ?? 0).replace(/\D/g, ''), 10) || 0);
      setClaimCosts({
        dice_cash: n('dice_cash'),
        dice_points: n('dice_points'),
        roulette: n('roulette'),
        blackjack: n('blackjack'),
        horseracing: n('horseracing'),
        video_poker: n('video_poker'),
        airport: n('airport'),
        armoury: n('armoury'),
      });
      toast.success('Claim costs saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save claim costs');
    } finally {
      setClaimCostsSaving(false);
    }
  };

  const handleClearLoginLock = async () => {
    setLaunchSettingsSaving(true);
    try {
      await api.patch('/admin/settings', {
        login_lock_from: null,
        login_lock_until: null,
        login_lock_message: null,
      });
      setLoginLockFrom('');
      setLoginLockUntil('');
      setLoginLockMessage('');
      toast.success('Login lock cleared');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to clear');
    } finally {
      setLaunchSettingsSaving(false);
    }
  };

  const handleClearPreorder = async () => {
    setLaunchSettingsSaving(true);
    try {
      await api.patch('/admin/settings', {
        preorder_points_release_date: null,
      });
      setPreorderReleaseDate('');
      toast.success('Preorder mode cleared');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to clear');
    } finally {
      setLaunchSettingsSaving(false);
    }
  };

  const handleReleaseAllPreorder = async () => {
    if (!window.confirm('Release all pending preorder points to users? This will credit points and send notifications to all users with pending preorders.')) return;
    setPreorderReleaseLoading(true);
    try {
      const res = await api.post('/admin/payments/release-all-preorder');
      toast.success(res.data?.message || 'Released');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to release');
    } finally {
      setPreorderReleaseLoading(false);
    }
  };

  const handleBoozeRotation15s = async () => {
    try {
      await api.post('/admin/booze-rotation', { seconds: 15 });
      setBoozeRotationSeconds(15);
      toast.success('Booze rotation set to 15 seconds');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set rotation');
    }
  };

  const handleBoozeRotationReset = async () => {
    try {
      await api.post('/admin/booze-rotation', { seconds: null });
      setBoozeRotationSeconds(null);
      toast.success('Booze rotation reset to 3 hours');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reset rotation');
    }
  };

  const handleSlotsDraw1Min = async () => {
    try {
      await api.post('/admin/slots/set-draw-in-minutes', null, { params: { minutes: 1 } });
      toast.success('Slots next draw set to 1 minute (all states)');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set draw time');
    }
  };

  const handleSlotsDrawReset = async () => {
    try {
      await api.post('/admin/slots/reset-draw-default');
      toast.success('Slots draw reset to default (3h)');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reset draw');
    }
  };

  const handleSlotsClearCooldowns = async () => {
    try {
      const res = await api.post('/admin/slots/clear-cooldowns');
      toast.success(res.data?.message || 'Slots cooldowns cleared');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear cooldowns');
    }
  };

  const fetchCrackSafeJackpot = async () => {
    setCrackSafeJackpotLoading(true);
    try {
      const res = await api.get('/admin/crack-safe/jackpot');
      setCrackSafeInfo(res.data);
      if (res.data?.jackpot != null) {
        setCrackSafeJackpotInput(String(res.data.jackpot));
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load Crack the Safe jackpot');
    } finally {
      setCrackSafeJackpotLoading(false);
    }
  };

  const handleSetCrackSafeJackpot = async () => {
    const n = parseInt(String(crackSafeJackpotInput).replace(/\D/g, ''), 10);
    if (Number.isNaN(n) || n < 0) {
      toast.error('Enter a valid amount (0 or more)');
      return;
    }
    setCrackSafeJackpotSaving(true);
    try {
      const res = await api.post('/admin/crack-safe/set-jackpot', { jackpot: n });
      toast.success(res.data?.message || 'Jackpot updated');
      await fetchCrackSafeJackpot();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set jackpot');
    } finally {
      setCrackSafeJackpotSaving(false);
    }
  };

  const fetchStateHeads = async () => {
    setStateHeadsLoading(true);
    try {
      const res = await api.get('/admin/state-heads');
      setStateHeads(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to fetch state heads');
    } finally {
      setStateHeadsLoading(false);
    }
  };

  const handleClearStateHead = async (state) => {
    if (!window.confirm(`Clear head family from ${state}?`)) return;
    try {
      const res = await api.post('/admin/state-heads/clear', { state });
      toast.success(res.data?.message || 'State head cleared');
      fetchStateHeads();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear state head');
    }
  };

  const handleResetRacketCooldown = async () => {
    const fid = (racketResetFamilyId || '').trim();
    if (!fid) {
      toast.error('Enter family ID');
      return;
    }
    setRacketResetLoading(true);
    try {
      const res = await api.post('/admin/rackets/reset-cooldown', null, { params: { family_id: fid, racket_id: racketResetRacketId } });
      toast.success(res.data?.message || 'Racket cooldown reset');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reset racket cooldown');
    } finally {
      setRacketResetLoading(false);
    }
  };

  const fetchCasinoMaxBets = async () => {
    setCasinoMaxBetsLoading(true);
    try {
      const res = await api.get('/admin/casino-max-bets');
      setCasinoMaxBets(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to fetch casino max bets');
    } finally {
      setCasinoMaxBetsLoading(false);
    }
  };

  const handleSetCasinoMaxBet = async () => {
    const val = parseInt(casinoMaxBetValue.replace(/,/g, ''), 10);
    if (!val || val < 1) {
      toast.error('Enter a valid max bet value');
      return;
    }
    const loc = casinoMaxBetLocation.trim() || null;
    const confirmMsg = loc
      ? `Set max bet to $${val.toLocaleString()} for ${casinoMaxBetGameType === 'all' ? 'all casino types' : casinoMaxBetGameType} in ${loc}?`
      : `Set max bet to $${val.toLocaleString()} for ${casinoMaxBetGameType === 'all' ? 'ALL casinos everywhere' : `all ${casinoMaxBetGameType} casinos`}?`;
    if (!window.confirm(confirmMsg)) return;
    setCasinoMaxBetSaving(true);
    try {
      const res = await api.post('/admin/set-casino-max-bet', {
        game_type: casinoMaxBetGameType,
        location: loc,
        max_bet: val,
      });
      toast.success(res.data?.message || 'Max bet updated');
      fetchCasinoMaxBets();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set max bet');
    } finally {
      setCasinoMaxBetSaving(false);
    }
  };

  const handleToggleEvents = async () => {
    try {
      const res = await api.post('/admin/events/toggle', { enabled: !eventsEnabled });
      setEventsEnabled(!!res.data?.events_enabled);
      toast.success(res.data?.message || 'Events toggled');
      fetchEventsStatus();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const handleToggleAllEventsForTesting = async () => {
    try {
      const res = await api.post('/admin/events/all-for-testing', { enabled: !allEventsForTesting });
      setAllEventsForTesting(!!res.data?.all_events_for_testing);
      toast.success(res.data?.message || 'Toggled');
      fetchEventsStatus();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const handleToggleEvent = async (eventId, enabled) => {
    setEventToggleLoadingId(eventId);
    try {
      await api.post('/admin/events/toggle-event', { event_id: eventId, enabled });
      toast.success(`Event ${enabled ? 'enabled' : 'disabled'}`);
      await fetchEventsStatus();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle event');
    } finally {
      setEventToggleLoadingId(null);
    }
  };

  const handleRandomEvent = async (fromSelected) => {
    setEventRandomLoading(true);
    try {
      const body = fromSelected
        ? { event_ids: eventList.filter((ev) => selectedForRandomPool[ev.id]).map((ev) => ev.id) }
        : {};
      if (fromSelected && (!body.event_ids || body.event_ids.length === 0)) {
        toast.error('Select at least one event for the random pool');
        return;
      }
      const res = await api.post('/admin/events/random-event', body.event_ids?.length ? body : {});
      toast.success(res.data?.message || 'Random event set');
      await fetchEventsStatus();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set random event');
    } finally {
      setEventRandomLoading(false);
    }
  };

  const handleClearEventOverride = async () => {
    setEventClearOverrideLoading(true);
    try {
      await api.post('/admin/events/clear-override');
      toast.success('Override cleared; daily rotation applies');
      await fetchEventsStatus();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear override');
    } finally {
      setEventClearOverrideLoading(false);
    }
  };

  const toggleRandomPoolSelection = (eventId) => {
    setSelectedForRandomPool((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const fetchCfBotBlockStatus = async () => {
    try {
      const res = await api.get('/admin/cloudflare/bot-block-status');
      if (res.data?.error) {
        setCfBotBlockError(res.data.error);
        setCfBotBlockEnabled(null);
      } else {
        setCfBotBlockEnabled(res.data?.enabled ?? null);
        setCfBotBlockError(null);
      }
    } catch (e) {
      setCfBotBlockError('Failed to fetch status');
    }
  };

  const handleToggleCfBotBlock = async () => {
    setCfBotBlockLoading(true);
    try {
      const newVal = !cfBotBlockEnabled;
      const res = await api.post(`/admin/cloudflare/bot-block-toggle?enabled=${newVal}`);
      setCfBotBlockEnabled(res.data?.enabled ?? newVal);
      toast.success(res.data?.message || `Bot blocking ${newVal ? 'enabled' : 'disabled'}`);
      setCfBotBlockError(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle');
    } finally {
      setCfBotBlockLoading(false);
    }
  };

  const fetchCfAutoBlockStatus = async () => {
    try {
      const res = await api.get('/admin/cloudflare/automation-block-status');
      if (res.data?.error) {
        setCfAutoBlockError(res.data.error);
        setCfAutoBlockEnabled(null);
      } else {
        setCfAutoBlockEnabled(res.data?.enabled ?? null);
        setCfAutoBlockError(null);
      }
    } catch (e) {
      setCfAutoBlockError('Failed to fetch status');
    }
  };

  const handleToggleCfAutoBlock = async () => {
    setCfAutoBlockLoading(true);
    try {
      const newVal = !cfAutoBlockEnabled;
      const res = await api.post(`/admin/cloudflare/automation-block-toggle?enabled=${newVal}`);
      setCfAutoBlockEnabled(res.data?.enabled ?? newVal);
      toast.success(res.data?.message || `Automation blocking ${newVal ? 'enabled' : 'disabled'}`);
      setCfAutoBlockError(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to toggle');
    } finally {
      setCfAutoBlockLoading(false);
    }
  };

  const fetchMeta = async () => {
    try {
      const [ranksRes, carsRes] = await Promise.all([api.get('/meta/ranks'), api.get('/meta/cars')]);
      setRanks(Array.isArray(ranksRes.data?.ranks) ? ranksRes.data.ranks : []);
      setCars(Array.isArray(carsRes.data?.cars) ? carsRes.data.cars : []);
    } catch { setRanks([]); setCars([]); }
  };

  const fetchRedeemCodes = useCallback(async () => {
    setRedeemCodesLoading(true);
    try {
      const [codesOut, typesOut] = await Promise.allSettled([
        api.get('/admin/redeem-codes'),
        api.get('/admin/token-types'),
      ]);
      if (codesOut.status === 'fulfilled') {
        setRedeemCodesList(codesOut.value.data?.codes ?? []);
      } else {
        const e = codesOut.reason;
        const d = e?.response?.data?.detail;
        toast.error(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x?.msg || String(x)).join('; ') : 'Failed to load redeem codes');
        setRedeemCodesList([]);
      }
      if (typesOut.status === 'fulfilled' && Array.isArray(typesOut.value.data?.token_types)) {
        setTokenTypes(typesOut.value.data.token_types);
      } else {
        if (typesOut.status === 'rejected') toast.error('Could not load token types for redeem codes');
        setTokenTypes([]);
      }
    } finally {
      setRedeemCodesLoading(false);
    }
  }, []);

  const handleCreateRedeemCode = async () => {
    const parseRewardInt = (v) => {
      const t = String(v ?? '').replace(/,/g, '').trim();
      if (!t) return 0;
      const x = parseInt(t, 10);
      return Number.isFinite(x) && x > 0 ? x : 0;
    };
    const code = (redeemForm.code || '').trim();
    if (!code) {
      toast.error('Code is required');
      return;
    }
    const rewards = {};
    const m = parseRewardInt(redeemForm.money);
    const pts = parseRewardInt(redeemForm.points);
    const rsp = parseRewardInt(redeemForm.respect_points);
    const loot = parseRewardInt(redeemForm.loot_box_pieces);
    if (m > 0) rewards.money = m;
    if (pts > 0) rewards.points = pts;
    if (rsp > 0) rewards.respect_points = rsp;
    if (loot > 0) rewards.loot_box_pieces = loot;
    if (redeemForm.cars && redeemForm.cars.length > 0) rewards.cars = redeemForm.cars;
    const tokenEntries = redeemForm.tokenEntries.filter((e) => e.type && Number(e.amount) > 0);
    if (tokenEntries.length > 0) {
      rewards.tokens = {};
      tokenEntries.forEach((e) => { rewards.tokens[e.type] = (rewards.tokens[e.type] || 0) + parseInt(e.amount, 10); });
    }
    if (Object.keys(rewards).length === 0) {
      toast.error('At least one reward is required');
      return;
    }
    setRedeemCodeCreateLoading(true);
    try {
      await api.post('/admin/redeem-codes', {
        code,
        max_uses: redeemForm.max_uses ? parseInt(redeemForm.max_uses, 10) : null,
        rewards,
      });
      toast.success('Redeem code created');
      setRedeemForm({ code: '', max_uses: '', money: '', points: '', respect_points: '', loot_box_pieces: '', cars: [], tokenEntries: [] });
      await fetchRedeemCodes();
    } catch (e) {
      const d = e.response?.data?.detail;
      const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x?.msg || JSON.stringify(x)).join('; ') : e.response?.data?.message;
      toast.error(msg || 'Failed to create code');
    } finally {
      setRedeemCodeCreateLoading(false);
    }
  };

  const handleDeactivateRedeemCode = async (code) => {
    if (!code) return;
    try {
      await api.patch(`/admin/redeem-codes/${encodeURIComponent(code)}`, { active: false });
      toast.success('Code deactivated; forum topic removed');
      await fetchRedeemCodes();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to deactivate');
    }
  };

  const handleDeleteRedeemCode = async (code) => {
    if (!code) return;
    if (!window.confirm(`Delete redeem code ${code}? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/redeem-codes/${encodeURIComponent(code)}`);
      toast.success('Redeem code deleted');
      await fetchRedeemCodes();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to delete');
    }
  };

  useEffect(() => {
    if (activeCategoryId !== 'admin-economy-progression' || !isAdmin) return;
    if (collapsed.redeemCodes) return;
    fetchRedeemCodes();
  }, [activeCategoryId, isAdmin, collapsed.redeemCodes, fetchRedeemCodes]);

  const handleChangeRank = async () => {
    const username = (formData.targetUsername || '').trim();
    const rank = formData.newRank != null ? parseInt(formData.newRank, 10) : NaN;
    const prestigeLevel = formData.prestigeLevel != null ? parseInt(formData.prestigeLevel, 10) : 0;
    if (!username) {
      toast.error('Enter a target username');
      return;
    }
    const maxRank = ranks.length > 0 ? Math.max(...ranks.map((r) => r.id)) : 11;
    if (Number.isNaN(rank) || rank < 1 || rank > maxRank) {
      toast.error(`Select a valid rank (1–${maxRank})`);
      return;
    }
    if (prestigeLevel < 0 || prestigeLevel > 5) {
      toast.error('Prestige must be 0–5');
      return;
    }
    try {
      const params = new URLSearchParams({ target_username: username, new_rank: String(rank), prestige_level: String(prestigeLevel) });
      const response = await api.post(`/admin/change-rank?${params.toString()}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleAddPoints = async () => {
    try {
      const response = await api.post(`/admin/add-points?target_username=${formData.targetUsername}&points=${formData.points}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleLoadPointsSources = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username above');
      return;
    }
    setPointsSourcesLoading(true);
    setPointsSourcesReport(null);
    try {
      const res = await api.get(`/admin/points/sources/${encodeURIComponent(username)}`);
      setPointsSourcesReport(res.data || null);
      toast.success('Point sources loaded');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load point sources');
    } finally {
      setPointsSourcesLoading(false);
    }
  };

  const handleLoadCurrencySpendAudit = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username above');
      return;
    }
    setCurrencySpendAuditLoading(true);
    setCurrencySpendAuditData(null);
    try {
      const res = await api.get(`/admin/currency-spend-audit/${encodeURIComponent(username)}`, {
        params: { ledger_limit: 500, respect_limit: 500 },
      });
      setCurrencySpendAuditData(res.data || null);
      toast.success('Spend audit loaded');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load spend audit');
    } finally {
      setCurrencySpendAuditLoading(false);
    }
  };

  const handleRemovePoints = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username above');
      return;
    }
    const amt = Math.max(0, parseInt(String(formData.pointsRemove), 10) || 0);
    if (amt <= 0) {
      toast.error('Enter a positive amount to remove');
      return;
    }
    if (!window.confirm(`Remove up to ${amt.toLocaleString()} points from ${username}? (Cannot remove more than they have.)`)) return;
    try {
      const params = new URLSearchParams({ target_username: username, amount: String(amt) });
      const response = await api.post(`/admin/remove-points?${params.toString()}`);
      toast.success(response.data?.message || 'Done');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleAddRespectPoints = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username above');
      return;
    }
    const amt = Math.max(0, parseInt(String(formData.respectAdd), 10) || 0);
    if (amt <= 0) {
      toast.error('Enter a positive amount to add');
      return;
    }
    if (!window.confirm(`Add ${amt.toLocaleString()} respect to ${username}?`)) return;
    try {
      const params = new URLSearchParams({ target_username: username, amount: String(amt) });
      const response = await api.post(`/admin/add-respect-points?${params.toString()}`);
      toast.success(response.data?.message || 'Done');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleRemoveRespectPoints = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username above');
      return;
    }
    const amt = Math.max(0, parseInt(String(formData.respectRemove), 10) || 0);
    if (amt <= 0) {
      toast.error('Enter a positive amount to remove');
      return;
    }
    if (!window.confirm(`Remove up to ${amt.toLocaleString()} respect from ${username}? (Cannot remove more than they have.)`)) return;
    try {
      const params = new URLSearchParams({ target_username: username, amount: String(amt) });
      const response = await api.post(`/admin/remove-respect-points?${params.toString()}`);
      toast.success(response.data?.message || 'Done');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handlePointsPreview = async () => {
    const sid = (pointsProvSessionId || '').trim();
    if (!sid) { toast.error('Enter payment session id'); return; }
    setPointsProvPreviewLoading(true);
    try {
      const res = await api.get(`/admin/points/chargeback/preview/${encodeURIComponent(sid)}`);
      setPointsProvPreview(res.data || null);
      toast.success('Chargeback preview loaded');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load preview');
    } finally {
      setPointsProvPreviewLoading(false);
    }
  };

  const handlePointsPaymentProvenance = async () => {
    const sid = (pointsProvSessionId || '').trim();
    if (!sid) { toast.error('Enter payment session id'); return; }
    setPointsProvPaymentLoading(true);
    try {
      const res = await api.get(`/admin/points/provenance/payment/${encodeURIComponent(sid)}`);
      setPointsProvPaymentData(res.data || null);
      toast.success('Payment provenance loaded');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load payment provenance');
    } finally {
      setPointsProvPaymentLoading(false);
    }
  };

  const handlePointsExecuteChargeback = async () => {
    const sid = (pointsProvSessionId || '').trim();
    if (!sid) { toast.error('Enter payment session id'); return; }
    if (!window.confirm(`Execute best-effort chargeback for ${sid}?`)) return;
    setPointsProvExecuteLoading(true);
    try {
      const res = await api.post('/admin/points/chargeback/execute', { payment_session_id: sid });
      setPointsProvPreview(res.data || null);
      toast.success(`Chargeback executed. Reclaimed ${res.data?.reclaimed ?? 0}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to execute chargeback');
    } finally {
      setPointsProvExecuteLoading(false);
    }
  };

  const handlePointsUserProvenance = async () => {
    const uid = (pointsProvUserId || '').trim();
    if (!uid) { toast.error('Enter username'); return; }
    setPointsProvUserLoading(true);
    try {
      const res = await api.get(`/admin/points/provenance/user/${encodeURIComponent(uid)}`);
      setPointsProvUserData(res.data || null);
      toast.success('User provenance loaded');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load user provenance');
    } finally {
      setPointsProvUserLoading(false);
    }
  };

  const handleSetFoundingMember = async (isFounding) => {
    try {
      const response = await api.post(`/admin/set-founding-member?target_username=${formData.targetUsername}&is_founding=${isFounding}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleAddTokens = async () => {
    try {
      const response = await api.post(`/admin/add-tokens?target_username=${formData.targetUsername}&token_type=${formData.tokenType}&amount=${formData.tokenAmount}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handlePoolClearCueUpgrades = async () => {
    if (!(formData.targetUsername || '').trim()) {
      toast.error('Enter target username');
      return;
    }
    if (!window.confirm(`Reset ALL 8-ball pool cue upgrades for ${formData.targetUsername}? Every owned cue goes to 0/250.`)) return;
    try {
      const response = await api.post(`/admin/pool-clear-cue-upgrades?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(response.data?.message || 'Done');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleGrantGamePass = async () => {
    try {
      const qs = new URLSearchParams({
        target_username: formData.targetUsername,
        force: 'true',
      });
      const snapRaw = String(formData.gamePassTierSnapshot ?? '').trim();
      if (snapRaw) {
        const snap = parseInt(snapRaw, 10);
        if (Number.isFinite(snap) && snap > 0) qs.set('tier_snapshot', String(snap));
      }
      const response = await api.post(`/admin/grant-game-pass?${qs.toString()}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleRemoveGamePass = async () => {
    if (!(formData.targetUsername || '').trim()) {
      toast.error('Enter target username');
      return;
    }
    if (!window.confirm(`Remove Game Pass state for ${formData.targetUsername}? Unactivated tokens, active bonus, and tier snapshots are cleared. They can buy or receive a pass again.`)) return;
    try {
      const qs = new URLSearchParams({ target_username: formData.targetUsername.trim() });
      const response = await api.post(`/admin/remove-game-pass?${qs.toString()}`);
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleReconcileGamePassTiers = async (ignoreTokenExpiry = false) => {
    const u = (formData.targetUsername || '').trim();
    if (!u) {
      toast.error('Enter target username');
      return;
    }
    if (
      ignoreTokenExpiry &&
      !window.confirm(
        `Grant missing VIP tier rewards for ${u} even if their Game Pass token date has expired? Only use for support / bug recovery.`,
      )
    ) {
      return;
    }
    try {
      const qs = new URLSearchParams({
        target_username: u,
        ignore_token_expiry: ignoreTokenExpiry ? 'true' : 'false',
      });
      const response = await api.post(`/admin/reconcile-game-pass-tiers?${qs.toString()}`);
      toast.success(response.data?.message || 'Reconciled');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleForceGrantGamePassRewards = async () => {
    const u = (formData.targetUsername || '').trim();
    if (!u) { toast.error('Enter target username'); return; }
    if (!window.confirm(`Force-grant ALL VIP Game Pass rewards for ${u}'s completed tiers? This directly credits cash/tokens/points to their account, bypassing all guards.`)) return;
    try {
      const res = await api.post(`/admin/force-grant-game-pass-rewards?target_username=${encodeURIComponent(u)}`);
      const d = res.data;
      const credited = Object.entries(d.total_credited || {}).map(([k,v]) => `${k}: ${v.toLocaleString()}`).join(', ');
      toast.success(`${d.message}\nCredited: ${credited || 'none'}`, { duration: 8000 });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const loadDeletedMessages = async () => {
    const u = (formData.targetUsername || '').trim();
    if (!u) { toast.error('Enter a target username'); return; }
    setDeletedMsgsLoading(true);
    try {
      const qs = new URLSearchParams({ limit_count: '100' });
      if (deletedMsgsFilter) qs.set('source_filter', deletedMsgsFilter);
      const res = await api.get(`/admin/deleted-messages/${encodeURIComponent(u)}?${qs.toString()}`);
      setDeletedMsgs(res.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load deleted messages');
    } finally {
      setDeletedMsgsLoading(false);
    }
  };

  const loadGamePassStuck = async (fix = false) => {
    setGamePassStuckLoading(true);
    try {
      const res = await api.get(`/admin/game-pass/stuck-cursors?fix=${fix}`);
      setGamePassStuck(res.data);
      if (fix && res.data?.fixed_count > 0) {
        toast.success(`Fixed ${res.data.fixed_count} stuck user(s): ${res.data.fixed_users.join(', ')}`);
      } else if (fix) {
        toast.success('No stuck users to fix');
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to check stuck cursors');
    } finally {
      setGamePassStuckLoading(false);
    }
  };

  const loadGamePassInspectList = async () => {
    setGamePassInspectLoading(true);
    try {
      const qs = new URLSearchParams({ skip: '0', limit: '100' });
      const q = (gamePassInspectQuery || '').trim();
      if (q) qs.set('q', q);
      const res = await api.get(`/admin/game-pass/users?${qs.toString()}`);
      setGamePassInspectList(res.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load Game Pass users');
    } finally {
      setGamePassInspectLoading(false);
    }
  };

  const loadGamePassInspectUser = async (username) => {
    const u = (username || formData.targetUsername || '').trim();
    if (!u) {
      toast.error('Enter target username or pick a row');
      return;
    }
    setGamePassInspectDetailLoading(true);
    try {
      const res = await api.get(`/admin/game-pass/user?target_username=${encodeURIComponent(u)}`);
      setGamePassInspectDetail(res.data);
      setFormData((prev) => ({ ...prev, targetUsername: u }));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Inspect failed');
    } finally {
      setGamePassInspectDetailLoading(false);
    }
  };

  const handleAddBullets = async () => {
    try {
      const response = await api.post(`/admin/add-bullets?target_username=${formData.targetUsername}&bullets=${formData.bullets}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleAddCar = async () => {
    try {
      const response = await api.post(`/admin/add-car?target_username=${formData.targetUsername}&car_id=${formData.carId}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleAddRandomCars = async (count = 1000) => {
    try {
      const u = (formData.targetUsername || '').trim();
      if (!u) { toast.error('Enter target username'); return; }
      const response = await api.post(`/admin/add-random-cars?target_username=${encodeURIComponent(u)}&count=${encodeURIComponent(String(count))}`);
      toast.success(response.data?.message || `Added ${Number(count).toLocaleString()} random car(s)`);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleAddLootPieces = async () => {
    try {
      const response = await api.post(`/admin/add-loot-pieces?target_username=${encodeURIComponent(formData.targetUsername)}&pieces=${formData.lootPieces}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleLockPlayer = async () => {
    try {
      const response = await api.post(`/admin/lock-player?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(response.data.message);
      fetchLockedAccounts();
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleUnlockAccount = async (username) => {
    const target = username || formData.targetUsername;
    if (!target) { toast.error('Enter target username'); return; }
    try {
      const response = await api.post(`/admin/unlock-account?target_username=${encodeURIComponent(target)}`);
      toast.success(response.data.message);
      fetchLockedAccounts();
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const fetchLockedAccounts = async () => {
    setLockedAccountsLoading(true);
    try {
      const res = await api.get('/admin/locked-accounts');
      setLockedAccounts(res.data?.locked || []);
    } catch {
      setLockedAccounts([]);
    } finally {
      setLockedAccountsLoading(false);
    }
  };

  const handleSendLockedMessage = async (username) => {
    const message = (lockedMessageByUser[username] || '').trim();
    if (!message) { toast.error('Enter a message'); return; }
    setSendingMessageTo(username);
    try {
      await api.post('/admin/locked-account-message', { target_username: username, message });
      toast.success('Message sent');
      setLockedMessageByUser((prev) => ({ ...prev, [username]: '' }));
      fetchLockedAccounts();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSendingMessageTo(null);
    }
  };

  const handleTestLockSelf = async () => {
    try {
      const res = await api.post('/admin/test-lock-self');
      toast.success(res.data?.message || 'Locked for 60s. Redirecting...');
      window.location.href = '/locked';
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const handleKillPlayer = async () => {
    try {
      const response = await api.post(`/admin/kill-player?target_username=${formData.targetUsername}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleRevivePlayer = async () => {
    try {
      const response = await api.post(`/admin/revive-player?target_username=${formData.targetUsername}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleGiveAutoRank = async () => {
    try {
      const response = await api.post(`/admin/give-auto-rank?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(response.data?.message || 'Auto rank given');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleRemoveAutoRank = async () => {
    try {
      const response = await api.post(`/admin/remove-auto-rank?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(response.data?.message || 'Auto rank removed');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleChangeEmail = async () => {
    const email = (formData.adminNewEmail || '').trim();
    if (!email) { toast.error('Enter new email'); return; }
    try {
      const response = await api.post('/admin/change-email', { new_email: email }, { params: { target_username: formData.targetUsername } });
      toast.success(response.data?.message || 'Email updated');
      setFormData(prev => ({ ...prev, adminNewEmail: '' }));
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleLogOutUser = async () => {
    if (!window.confirm(`Log out ${formData.targetUsername || 'this user'}? All their sessions will be invalidated.`)) return;
    try {
      const response = await api.post(`/admin/log-out-user?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(response.data?.message || 'User logged out');
      setAdminUserSessions(null);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleLoadUserSessions = async () => {
    if (!(formData.targetUsername || '').trim()) { toast.error('Enter target username'); return; }
    setAdminUserSessionsLoading(true);
    setAdminUserSessions(null);
    try {
      const res = await api.get('/admin/user-sessions', { params: { target_username: formData.targetUsername } });
      setAdminUserSessions(res.data?.sessions ?? []);
      toast.success(res.data?.sessions?.length ? `${res.data.sessions.length} session(s)` : 'No sessions');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load sessions');
      setAdminUserSessions([]);
    } finally {
      setAdminUserSessionsLoading(false);
    }
  };

  const handleAdminRevokeSession = async (sessionId) => {
    if (!(formData.targetUsername || '').trim()) return;
    if (!window.confirm('Revoke this session? That device will be logged out.')) return;
    try {
      await api.post('/admin/sessions/revoke', { target_username: formData.targetUsername, session_id: sessionId });
      toast.success('Session revoked');
      handleLoadUserSessions();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const handleLoadSessionStats = async () => {
    setSessionStatsLoading(true);
    try {
      const res = await api.get('/admin/sessions/stats');
      setSessionStats(res.data ?? null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load session stats');
      setSessionStats(null);
    } finally {
      setSessionStatsLoading(false);
    }
  };

  const handleRevokeOldSessions = async () => {
    if (!window.confirm('Log out all sessions older than 24 hours (site-wide)?')) return;
    setRevokeOldSessionsLoading(true);
    try {
      const res = await api.post('/admin/sessions/revoke-old', {});
      toast.success(res.data?.message ?? 'Done');
      handleLoadSessionStats();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setRevokeOldSessionsLoading(false);
    }
  };

  const handleRevokeOldUserSessions = async () => {
    if (!(formData.targetUsername || '').trim()) { toast.error('Enter target username'); return; }
    if (!window.confirm(`Log out sessions older than 24h for ${formData.targetUsername}?`)) return;
    setRevokeOldUserSessionsLoading(true);
    try {
      const res = await api.post('/admin/sessions/revoke-old', { target_username: formData.targetUsername });
      toast.success(res.data?.message ?? 'Done');
      if (adminUserSessions) handleLoadUserSessions();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setRevokeOldUserSessionsLoading(false);
    }
  };

  const handleSetPassword = async () => {
    const pwd = (formData.adminNewPassword || '').trim();
    if (pwd.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (!window.confirm(`Set password for ${formData.targetUsername || 'this user'}? They will be logged out and must sign in with the new password.`)) return;
    try {
      const response = await api.post('/admin/set-password', { new_password: pwd }, { params: { target_username: formData.targetUsername } });
      toast.success(response.data?.message || 'Password set');
      setFormData(prev => ({ ...prev, adminNewPassword: '' }));
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleClearLoginLockout = async () => {
    try {
      const response = await api.post(`/admin/clear-login-lockout?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(response.data?.message || 'Lockout cleared');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleViewRegistration = async () => {
    if (!(formData.targetUsername || '').trim()) { toast.error('Enter target username'); return; }
    setViewRegistrationLoading(true);
    setViewRegistrationInfo(null);
    try {
      const response = await api.get('/admin/user-registration', { params: { target_username: formData.targetUsername } });
      setViewRegistrationInfo(response.data?.user || null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load');
      setViewRegistrationInfo(null);
    } finally {
      setViewRegistrationLoading(false);
    }
  };

  const handleUserInspect = async () => {
    const email = (userInspectEmail || '').trim().toLowerCase();
    if (!email) { toast.error('Enter user email'); return; }
    setUserInspectLoading(true);
    setUserInspectResult(null);
    try {
      const res = await api.get('/admin/user-inspect', { params: { email } });
      setUserInspectResult(res.data);
      toast.success(res.data?.found ? 'User document inspected' : 'No user with this email');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to inspect');
      setUserInspectResult(null);
    } finally {
      setUserInspectLoading(false);
    }
  };

  const handleFetchExclusiveLoot = async () => {
    setExclusiveLootLoading(true);
    setExclusiveLootOwners(null);
    try {
      const res = await api.get('/admin/exclusive-loot');
      setExclusiveLootOwners(res.data?.owners ?? []);
      toast.success(`${res.data?.owners?.length ?? 0} user(s) with exclusive loot`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load');
      setExclusiveLootOwners(null);
    } finally {
      setExclusiveLootLoading(false);
    }
  };

  const handleUserSearch = async () => {
    const q = (userSearchQuery || '').trim();
    if (!q) { toast.error('Enter username or email to search'); return; }
    setUserSearchLoading(true);
    setUserSearchResults(null);
    try {
      const res = await api.get('/admin/users/search', { params: { q, limit: 50 } });
      setUserSearchResults(res.data?.users || []);
      toast.success(res.data?.users?.length ? `${res.data.users.length} user(s) found` : 'No users found');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Search failed');
      setUserSearchResults([]);
    } finally {
      setUserSearchLoading(false);
    }
  };

  const setTargetFromSearch = (username) => {
    setFormData((prev) => ({ ...prev, targetUsername: username || '' }));
    toast.success(`Target set to ${username || ''}`);
  };

  const openUserDetail = async (u) => {
    const uid = u?.id || u?.user_id;
    if (!uid) { toast.error('No user ID'); return; }
    setUserDetailLoading(true);
    setUserDetailData(null);
    try {
      const res = await api.get(`/admin/user-details/${encodeURIComponent(uid)}`);
      setUserDetailData(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load user details');
    } finally {
      setUserDetailLoading(false);
    }
  };

  const fetchAllUsers = async () => {
    setAllUsersLoading(true);
    setAllUsersList(null);
    setAllUsersTotal(null);
    try {
      const res = await api.get('/admin/users/list', { params: { filter_type: allUsersFilter, sort: allUsersSort, limit: 1000 } });
      setAllUsersList(res.data?.users || []);
      setAllUsersTotal(res.data?.total ?? res.data?.users?.length ?? 0);
      toast.success(`${res.data?.users?.length ?? 0} user(s) loaded`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load users');
      setAllUsersList([]);
    } finally {
      setAllUsersLoading(false);
    }
  };

  const fetchIpBans = async () => {
    setIpBansLoading(true);
    try {
      const res = await api.get('/admin/security/ip-bans');
      setIpBans(res.data?.ip_bans || []);
      toast.success('IP bans loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load IP bans');
      setIpBans([]);
    } finally {
      setIpBansLoading(false);
    }
  };

  const fetchAccountBans = async () => {
    setIpBansLoading(true);
    try {
      const res = await api.get('/admin/security/bans');
      setAccountBans(res.data?.bans || []);
      toast.success('Account bans loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load account bans');
      setAccountBans([]);
    } finally {
      setIpBansLoading(false);
    }
  };

  const fetchAllBansLists = async () => {
    setIpBansLoading(true);
    try {
      const [ipRes, accRes] = await Promise.all([
        api.get('/admin/security/ip-bans'),
        api.get('/admin/security/bans'),
      ]);
      setIpBans(ipRes.data?.ip_bans || []);
      setAccountBans(accRes.data?.bans || []);
      toast.success('IP and account bans loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load bans');
    } finally {
      setIpBansLoading(false);
    }
  };

  const resolveUsernameForBanActions = async (raw) => {
    const q = (raw || '').trim();
    if (!q) return { error: 'Enter a username' };
    try {
      const res = await api.get('/admin/users/search', { params: { q, limit: 40 } });
      const users = res.data?.users || [];
      const lower = q.toLowerCase();
      const exact = users.find((u) => (u.username || '').toLowerCase() === lower);
      if (exact) return { user: exact };
      if (users.length === 1) return { user: users[0] };
      if (users.length === 0) return { error: 'No user found for that search' };
      return { error: 'Several users match — type the exact username' };
    } catch (e) {
      return { error: e.response?.data?.detail || 'User lookup failed' };
    }
  };

  const handleUnbanAccountByUsername = async () => {
    const resolved = await resolveUsernameForBanActions(ipUnbanUsername);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const { id: userId, username: un } = resolved.user;
    setIpBansLoading(true);
    try {
      const res = await api.post('/admin/security/unban', { user_id: userId });
      toast.success(res.data?.message || `Account unbanned: ${un}`);
      fetchAccountBans();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unban account');
    } finally {
      setIpBansLoading(false);
    }
  };

  const handleUnbanAccountFromList = async (userId, usernameLabel) => {
    setIpBansLoading(true);
    try {
      const res = await api.post('/admin/security/unban', { user_id: userId });
      toast.success(res.data?.message || `Unbanned ${usernameLabel || userId}`);
      fetchAccountBans();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unban account');
    } finally {
      setIpBansLoading(false);
    }
  };

  const handleRestoreLoginFull = async () => {
    const resolved = await resolveUsernameForBanActions(ipUnbanUsername);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const { id: userId, username: un } = resolved.user;
    const enc = encodeURIComponent(un);
    if (!window.confirm(`Restore login for ${un}? This will unban the account, clear linked IP bans, and clear login lockout for this username.`)) return;
    setIpBansLoading(true);
    try {
      const skip404 = (e, fragment) => {
        const d = String(e.response?.data?.detail || '');
        return e.response?.status === 404 && d.includes(fragment);
      };
      try {
        await api.post('/admin/security/unban', { user_id: userId });
      } catch (e) {
        if (!skip404(e, 'No active ban')) throw e;
      }
      try {
        await api.post('/admin/security/unban-ip', { username: un });
      } catch (e) {
        if (!skip404(e, 'No active IP ban')) throw e;
      }
      try {
        await api.post(`/admin/clear-login-lockout?target_username=${enc}`);
      } catch (e) {
        /* lockout may already be clear */
      }
      toast.success(`Login restored for ${un} (account, IP bans, lockout)`);
      setIpUnbanUsername('');
      await fetchAllBansLists();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Restore login failed');
    } finally {
      setIpBansLoading(false);
    }
  };

  const handleClearLoginLockoutOnly = async () => {
    const resolved = await resolveUsernameForBanActions(ipUnbanUsername);
    if (resolved.error) {
      toast.error(resolved.error);
      return;
    }
    const { username: un } = resolved.user;
    setIpBansLoading(true);
    try {
      const res = await api.post(`/admin/clear-login-lockout?target_username=${encodeURIComponent(un)}`);
      toast.success(res.data?.message || `Login lockout cleared for ${un}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear lockout');
    } finally {
      setIpBansLoading(false);
    }
  };

  const handleBanIp = async () => {
    const raw = (ipBanUsername || '').trim();
    const reason = (ipBanReason || '').trim() || 'Banned by admin';
    if (!raw) {
      toast.error('Enter a username (ban all known IPs) or a single IP address');
      return;
    }
    const hoursRaw = (ipBanHours || '').trim();
    const hoursParsed = hoursRaw ? parseInt(hoursRaw.replace(/[^\d]/g, ''), 10) : null;
    const durationHours = hoursRaw && !Number.isNaN(hoursParsed) && hoursParsed > 0 ? hoursParsed : null;

    const looksLikeIp =
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw) || (raw.includes(':') && raw.length >= 3);

    setIpBansLoading(true);
    try {
      const body = { reason };
      if (durationHours != null) body.duration_hours = durationHours;
      if (looksLikeIp) body.ip = raw;
      else body.username = raw;

      const res = await api.post('/admin/security/ban-ip', body);
      toast.success(res.data?.message || (looksLikeIp ? `IP ${raw} banned` : 'Ban applied'));
      setIpBanUsername('');
      setIpBanReason('');
      setIpBanHours('');
      fetchIpBans();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to ban IP');
    } finally {
      setIpBansLoading(false);
    }
  };

  const handleUnbanIp = async (ip) => {
    try {
      await api.post('/admin/security/unban-ip', { ip });
      toast.success(`IP ${ip} unbanned`);
      fetchIpBans();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unban IP');
    }
  };

  const handleUnbanAllIpsForUser = async () => {
    const u = (ipUnbanUsername || '').trim();
    if (!u) {
      toast.error('Enter a username');
      return;
    }
    setIpBansLoading(true);
    try {
      const res = await api.post('/admin/security/unban-ip', { username: u });
      toast.success(res.data?.message || `IP bans cleared for ${u}`);
      setIpUnbanUsername('');
      fetchIpBans();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unban IPs for user');
    } finally {
      setIpBansLoading(false);
    }
  };

  const handleBanIpQuick = async (ip) => {
    if (!ip || !window.confirm(`Ban IP ${ip}?`)) return;
    setIpBansLoading(true);
    try {
      await api.post('/admin/security/ban-ip', { ip, reason: 'Ban from cheat detection' });
      toast.success(`IP ${ip} banned`);
      fetchIpBans();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to ban IP'); }
    finally { setIpBansLoading(false); }
  };

  const handleViewUserFromCheat = (username) => {
    setFormData((prev) => ({ ...prev, targetUsername: (username || '').trim() }));
    setActiveCategoryId('admin-operations');
    setCollapsed((prev) => ({ ...prev, searchUsers: false }));
    if (typeof window !== 'undefined') window.location.hash = 'admin-operations';
  };

  const handleFetchGamblingAnomalies = async () => {
    setGamblingAnomaliesLoading(true);
    setGamblingAnomalies(null);
    try {
      const res = await api.get('/admin/casinos/gambling-anomalies', { params: { days: 7, min_plays: 20 } });
      setGamblingAnomalies(res.data);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setGamblingAnomaliesLoading(false); }
  };

  const handleTestIpBan = async () => {
    if (!window.confirm('Ban your current IP for 30 seconds? You will get 403 on all requests until it auto-unbans.')) return;
    setIpBansLoading(true);
    try {
      const res = await api.post('/admin/security/test-ip-ban');
      toast.success(res.data?.message || 'Test ban active. Wait 30s or refresh.');
      fetchIpBans();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setIpBansLoading(false);
    }
  };

  const handleSetSearchTime = async () => {
    try {
      const response = await api.post(`/admin/set-search-time?target_username=${formData.targetUsername}&search_minutes=${formData.searchMinutes}`);
      toast.success(response.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleSetAllSearchTime5 = async () => {
    if (!window.confirm('Set every user\'s search timer to 5 minutes?')) return;
    try {
      const res = await api.post('/admin/set-all-search-time?search_minutes=5');
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleSetAllSearchTime1 = async () => {
    if (!window.confirm('Set every user\'s search timer to 1 minute?')) return;
    try {
      const res = await api.post('/admin/set-all-search-time?search_minutes=1');
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleClearAllSearches = async () => {
    if (!window.confirm('Delete ALL attack searches?')) return;
    setClearSearchesLoading(true);
    try {
      const res = await api.post('/admin/clear-all-searches');
      toast.success(res.data?.message || 'Cleared');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setClearSearchesLoading(false); }
  };

  const handleResetAllOcTimers = async () => {
    if (!window.confirm('Reset all OC timers for everyone? Everyone will be able to run Organised Crime immediately.')) return;
    setResetOcTimersLoading(true);
    try {
      const res = await api.post('/admin/oc/reset-all-timers');
      toast.success(res.data?.message || 'Reset');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setResetOcTimersLoading(false); }
  };

  const handleFixLoginFields = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    if (!window.confirm(`Repair login fields and clear lockout for ${username}?`)) return;
    setFixLoginFieldsLoading(true);
    try {
      const res = await api.post(`/admin/auth/fix-login-fields?target_username=${encodeURIComponent(username)}`);
      toast.success(res.data?.message || 'Login fields repaired');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setFixLoginFieldsLoading(false); }
  };

  const handleClearUserOcInvites = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    if (!window.confirm(`Clear all OC invites for ${username}?`)) return;
    setClearOcInvitesLoading(true);
    try {
      const res = await api.post(`/admin/oc/clear-user-invites?target_username=${encodeURIComponent(username)}`);
      toast.success(res.data?.message || 'OC invites cleared');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setClearOcInvitesLoading(false); }
  };

  const handleClearUserCrimeTimers = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    if (!window.confirm(`Clear all crime cooldown timers for ${username}?`)) return;
    setClearCrimeTimersLoading(true);
    try {
      const res = await api.post(`/admin/crimes/reset-timers?target_username=${encodeURIComponent(username)}`);
      toast.success(res.data?.message || 'Crime timers cleared');
      setInspectCrimesData(null);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setClearCrimeTimersLoading(false); }
  };

  const handleInspectCrimes = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    setInspectCrimesLoading(true);
    setInspectCrimesData(null);
    try {
      const res = await api.get(`/admin/crimes/inspect/${encodeURIComponent(username)}`);
      setInspectCrimesData(res.data);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed to inspect'); }
    finally { setInspectCrimesLoading(false); }
  };

  const handleDedupCrimes = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    if (!window.confirm(`Remove duplicate crime rows for ${username}? This keeps the best row per crime.`)) return;
    setDedupCrimesLoading(true);
    try {
      const res = await api.post(`/admin/crimes/dedup?target_username=${encodeURIComponent(username)}`);
      toast.success(`${res.data?.message || 'Done'} Removed ${res.data?.rows_removed || 0} duplicates.`);
      setInspectCrimesData(null);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed to dedup'); }
    finally { setDedupCrimesLoading(false); }
  };

  const handleClearUserMinigameRecords = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    if (!window.confirm(`Clear all minigame records for ${username}?`)) return;
    setClearMinigameRecordsLoading(true);
    try {
      const res = await api.post(`/admin/minigames/clear-user-records?target_username=${encodeURIComponent(username)}`);
      toast.success(res.data?.message || 'Minigame records cleared');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setClearMinigameRecordsLoading(false); }
  };

  const handleMinigameLbStrip = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter target username'); return; }
    if (!minigameLbStripWeekly && !minigameLbStripPerGame) { toast.error('Select at least one: weekly plays or per-game scores'); return; }
    if (!window.confirm(`Strip minigame leaderboard data for ${username}?`)) return;
    setMinigameLbStripLoading(true);
    try {
      const games = (minigameLbStripGames || '').trim()
        ? minigameLbStripGames.split(/[\s,]+/).map((g) => g.trim().toLowerCase()).filter(Boolean)
        : null;
      const res = await api.post('/admin/minigames/leaderboard/strip-user', {
        target_username: username,
        remove_weekly_plays: minigameLbStripWeekly,
        weekly_scope: minigameLbWeekScope,
        remove_per_game_scores: minigameLbStripPerGame,
        games,
      });
      toast.success(res.data?.message || 'Stripped');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setMinigameLbStripLoading(false);
    }
  };

  const handleMinigameLbAddPlay = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter target username'); return; }
    const score = parseInt(String(minigameLbAddScore), 10);
    if (Number.isNaN(score) || score < 0) { toast.error('Invalid score'); return; }
    if (!minigameLbAddWeekly && !minigameLbAddPerGame) { toast.error('Select weekly play and/or per-game row'); return; }
    setMinigameLbAddLoading(true);
    try {
      const res = await api.post('/admin/minigames/leaderboard/add-play', {
        target_username: username,
        game: minigameLbAddGame,
        score,
        record_weekly_play: minigameLbAddWeekly,
        record_per_game_score: minigameLbAddPerGame,
      });
      toast.success(res.data?.message || 'Recorded');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setMinigameLbAddLoading(false);
    }
  };

  const handleMainLeaderboardStrip = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter target username'); return; }
    if (!mainLbRespect && !mainLbMelt && !mainLbStock && !mainLbBooze && !mainLbKills && !mainLbCrimes && !mainLbGta && !mainLbJail) {
      toast.error('Select at least one category');
      return;
    }
    const scopeLabel = mainLbScope === 'all' ? 'ALL HISTORY' : 'this week (Mon UTC) only';
    if (!window.confirm(`Strip main /leaderboards/top inputs for ${username}? Scope: ${scopeLabel}. This cannot be undone.`)) return;
    setMainLbStripLoading(true);
    try {
      const res = await api.post('/admin/leaderboards/strip-user-inputs', {
        target_username: username,
        scope: mainLbScope,
        respect_events: mainLbRespect,
        melt_events: mainLbMelt,
        stock_profit_rows: mainLbStock,
        booze_run_events: mainLbBooze,
        kills: mainLbKills,
        crimes: mainLbCrimes,
        gta: mainLbGta,
        jail_busts: mainLbJail,
      });
      const extra = res.data?.deleted_counts || res.data?.adjusted;
      toast.success(res.data?.message || 'Stripped');
      if (extra && typeof window !== 'undefined' && window.console) console.log('strip-user-inputs', extra);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setMainLbStripLoading(false);
    }
  };

  const fetchUserLeaderboardScores = async (silent) => {
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username');
      return;
    }
    setUserLbScoresLoading(true);
    try {
      const res = await api.get('/admin/leaderboards/user-scores', { params: { target_username: username } });
      setUserLbScores(res.data);
      if (!silent) toast.success('Scores loaded');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load scores');
      setUserLbScores(null);
    } finally {
      setUserLbScoresLoading(false);
    }
  };

  const handleUserLeaderboardPartialAdjust = async (opts) => {
    const dryRun = opts?.dryRun === true;
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username');
      return;
    }
    const n = parseInt(String(userLbAdjustRemoveCount), 10);
    if (!Number.isFinite(n) || n < 1 || n > 50000) {
      toast.error('Remove count must be 1–50,000');
      return;
    }
    const useDry = dryRun || userLbAdjustDryRun;
    if (!useDry && !window.confirm(`Remove oldest ${n} row(s): ${userLbAdjustMetric} (${userLbAdjustPeriod}) for ${username}? This cannot be undone.`)) return;
    setUserLbAdjustLoading(true);
    try {
      const res = await api.post('/admin/leaderboards/adjust-user', {
        target_username: username,
        metric: userLbAdjustMetric,
        period: userLbAdjustPeriod,
        remove_count: n,
        dry_run: useDry,
      });
      toast.success(res.data?.message || 'Done');
      if (!useDry && (res.data?.deleted_count ?? 0) > 0) {
        await fetchUserLeaderboardScores(true);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setUserLbAdjustLoading(false);
    }
  };

  const handleUserHubAdjustMoney = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username');
      return;
    }
    const amt = parseInt(String(userHubMoneyDelta), 10);
    if (!Number.isFinite(amt) || amt === 0) {
      toast.error('Enter a non-zero dollar amount (negative removes)');
      return;
    }
    const label = amt < 0
      ? `Remove $${Math.abs(amt).toLocaleString()} from ${username}?`
      : `Add $${amt.toLocaleString()} to ${username}?`;
    if (!window.confirm(label)) return;
    setUserHubMoneyLoading(true);
    try {
      const res = await api.post(`/admin/adjust-money?target_username=${encodeURIComponent(username)}&amount=${amt}`);
      toast.success(res.data?.message || 'Done');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setUserHubMoneyLoading(false);
    }
  };

  const handleResetWeeklyBoozeProfit = async () => {
    if (!window.confirm('Reset THIS WEEK booze-run leaderboard profit for ALL users to 0?')) return;
    setMainLbResetBoozeLoading(true);
    try {
      const res = await api.post('/admin/leaderboards/reset-weekly-booze-profit');
      toast.success(res.data?.message || 'Weekly booze-run profit reset');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setMainLbResetBoozeLoading(false);
    }
  };

  const handleResetDailyRewardsTimerAll = async () => {
    if (!window.confirm('Reset Daily Rewards timer for everyone? All users will get 3 plays again (6h window).')) return;
    setResetDailyRewardsLoading(true);
    try {
      const res = await api.post('/admin/daily-rewards/reset-timer');
      toast.success(res.data?.message || 'Reset');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setResetDailyRewardsLoading(false); }
  };

  const handleResetDailyRewardsTimerUser = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    setResetDailyRewardsLoading(true);
    try {
      const res = await api.post(`/admin/daily-rewards/reset-timer?target_username=${encodeURIComponent(username)}`);
      toast.success(res.data?.message || 'Reset');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setResetDailyRewardsLoading(false); }
  };

  const handleForceOnline = async () => {
    try {
      const res = await api.post('/admin/force-online');
      setForceOnlineInfo(res.data);
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleClearBodyguards = async () => {
    try {
      const res = await api.post(`/admin/bodyguards/clear?target_username=${encodeURIComponent(formData.targetUsername)}`);
      toast.success(res.data?.message || 'Cleared', { duration: 10000 });
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed', { duration: 10000 }); }
  };

  const handleDropAllHumanBodyguards = async () => {
    if (!window.confirm('Remove ALL bodyguards from EVERY user?')) return;
    setDropHumanBgLoading(true);
    try {
      const res = await api.post('/admin/bodyguards/drop-all');
      toast.success(res.data?.message || 'Dropped', { duration: 10000 });
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed', { duration: 10000 }); }
    finally { setDropHumanBgLoading(false); }
  };

  const handleTestBodyguardPayout = async () => {
    setTestPayoutLoading(true);
    try {
      const res = await api.post('/admin/bodyguards/test-payout');
      toast.success(res.data?.message ?? `Test payout: ${res.data?.paid_count ?? 0} paid`, { duration: 8000 });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed', { duration: 8000 });
    } finally {
      setTestPayoutLoading(false);
    }
  };

  const [seedHumanBgLoading, setSeedHumanBgLoading] = useState(false);
  const handleSeedHumanBodyguards = async () => {
    setSeedHumanBgLoading(true);
    try {
      const res = await api.post('/admin/bodyguards/seed-humans');
      toast.success(res.data?.message ?? 'Created 4 human bodyguards', { duration: 8000 });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed', { duration: 8000 });
    } finally {
      setSeedHumanBgLoading(false);
    }
  };

  const [seedRandomBgLoading, setSeedRandomBgLoading] = useState(false);
  const handleSeedRandomBodyguards = async () => {
    setSeedRandomBgLoading(true);
    try {
      const res = await api.post('/admin/bodyguards/seed-random');
      const data = res.data || {};
      toast.success(data.message ?? 'Created random bodyguards', { duration: 8000 });
      if (data.slots?.length) {
        toast.info(data.slots.join(' | '), { duration: 10000 });
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed', { duration: 8000 });
    } finally {
      setSeedRandomBgLoading(false);
    }
  };

  const handleResetBgCooldown = async () => {
    try {
      const res = await api.post('/admin/bodyguards/reset-cooldown');
      toast.success(res.data?.message ?? 'Cooldown reset', { duration: 5000 });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed', { duration: 5000 });
    }
  };

  const [bodyguardSpeedsLoading, setBodyguardSpeedsLoading] = useState(false);
  const [bodyguardSpeedsResult, setBodyguardSpeedsResult] = useState(null);
  const handleCheckBodyguardSpeeds = async () => {
    const username = (formData.targetUsername || '').trim();
    if (!username) {
      toast.error('Enter target username above');
      return;
    }
    setBodyguardSpeedsLoading(true);
    setBodyguardSpeedsResult(null);
    try {
      const res = await api.get('/admin/bodyguards/hire-intervals', {
        params: { target_username: username },
      });
      const data = res.data || {};
      setBodyguardSpeedsResult(data);
      if (Array.isArray(data.intervals_between_robot_bodyguards_ms) && data.intervals_between_robot_bodyguards_ms.length > 0) {
        const msStr = data.intervals_between_robot_bodyguards_ms.map((ms) => `${Number(ms).toFixed(3)} ms`).join(', ');
        const totalS = (data.total_seconds != null ? Number(data.total_seconds).toFixed(3) : (data.total_ms != null ? (Number(data.total_ms) / 1000).toFixed(3) : '—'));
        const totalMs = data.total_ms != null ? Number(data.total_ms).toFixed(3) : '—';
        toast.success(`Intervals: ${msStr}. Total: ${totalS} s (${totalMs} ms)`, { duration: 12000 });
      } else {
        toast.info(data.robot_count === 0 ? 'No robot bodyguards' : 'Only one robot (no intervals)', { duration: 5000 });
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed', { duration: 5000 });
    } finally {
      setBodyguardSpeedsLoading(false);
    }
  };

  const handleGenerateBodyguards = async () => {
    try {
      const res = await api.post('/admin/bodyguards/generate', {
        target_username: formData.targetUsername,
        count: bgTestCount,
        replace_existing: true,
      });
      const data = res.data || {};
      const msg = data.message || 'Generated';
      const intervals = data.intervals_between_robot_bodyguards_ms;
      toast.success(msg, { duration: 10000 });
      if (Array.isArray(intervals) && intervals.length > 0) {
        const msStr = intervals.map((ms) => `${Number(ms).toFixed(3)} ms`).join(', ');
        toast.info(`Time between robot bodyguards: ${msStr}`, { duration: 12000 });
      }
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed', { duration: 10000 }); }
  };

  const handleFindDuplicates = async () => {
    setDbLoading(true);
    try {
      const url = searchUsername.trim() ? '/admin/find-duplicates?username=' + encodeURIComponent(searchUsername.trim()) : '/admin/find-duplicates';
      const res = await api.get(url);
      setSearchResults(res.data);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setDbLoading(false); }
  };

  const IMAGE_HOST_ADMIN_PAGE = 50;
  const [imageHostAdminData, setImageHostAdminData] = useState({ items: [], total: 0 });
  const [imageHostAdminLoading, setImageHostAdminLoading] = useState(false);
  const [imageHostAdminUsername, setImageHostAdminUsername] = useState('');
  const [imageHostAdminUserId, setImageHostAdminUserId] = useState('');
  const [imageHostAdminSkip, setImageHostAdminSkip] = useState(0);

  const fetchImageHostAdmin = useCallback(async (overrideSkip) => {
    const skip = overrideSkip != null ? overrideSkip : imageHostAdminSkip;
    setImageHostAdminLoading(true);
    try {
      const p = new URLSearchParams();
      p.set('limit', String(IMAGE_HOST_ADMIN_PAGE));
      p.set('skip', String(skip));
      const uid = imageHostAdminUserId.trim();
      const un = imageHostAdminUsername.trim();
      if (uid) p.set('user_id', uid);
      else if (un) p.set('username', un);
      const res = await api.get(`/image-host/admin/uploads?${p}`);
      setImageHostAdminData({ items: res.data.items || [], total: res.data.total ?? 0 });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load image host list');
    } finally {
      setImageHostAdminLoading(false);
    }
  }, [imageHostAdminSkip, imageHostAdminUserId, imageHostAdminUsername]);

  const handleImageHostAdminDelete = async (publicId) => {
    if (!window.confirm(`Delete hosted image ${publicId}? Links will stop working.`)) return;
    try {
      await api.delete(`/image-host/admin/item/${encodeURIComponent(publicId)}`);
      toast.success('Deleted');
      fetchImageHostAdmin();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Delete failed');
    }
  };

  useEffect(() => {
    if (!isAdmin || activeCategoryId !== 'admin-world-systems' || collapsed.imageHostAdmin) return;
    fetchImageHostAdmin();
  }, [imageHostAdminSkip, collapsed.imageHostAdmin, activeCategoryId, isAdmin, fetchImageHostAdmin]);

  const handleFetchSameIp = async () => {
    setCheatLoading(true);
    setCheatSameIp(null);
    try {
      const res = await api.get('/admin/cheat-detection/same-ip');
      setCheatSameIp(res.data);
      toast.success(res.data?.total_groups ? `${res.data.total_groups} IP group(s) with 2+ accounts` : 'No shared IPs found');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setCheatLoading(false);
    }
  };

  const handleFetchLoginAttempts = async () => {
    setCheatLoading(true);
    setCheatLoginEvents(null);
    try {
      const res = await api.get('/admin/cheat-detection/login-attempts');
      setCheatLoginEvents(res.data);
      const count = res.data?.events?.length ?? 0;
      toast.success(count ? `${count} suspicious login attempt(s) loaded` : 'No suspicious login attempts found');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setCheatLoading(false);
    }
  };

  const handleFetchDuplicateSuspects = async () => {
    setCheatLoading(true);
    setCheatDuplicates(null);
    try {
      const url = duplicateSuspectsUsername.trim()
        ? '/admin/cheat-detection/duplicate-suspects?username=' + encodeURIComponent(duplicateSuspectsUsername.trim())
        : '/admin/cheat-detection/duplicate-suspects';
      const res = await api.get(url);
      setCheatDuplicates(res.data);
      toast.success('Duplicate suspects loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setCheatLoading(false);
    }
  };

  const handleFetchSameDeviceDifferentIps = async () => {
    setCheatLoading(true);
    setCheatSameDeviceIps(null);
    try {
      const res = await api.get('/admin/cheat-detection/same-device-different-ips');
      setCheatSameDeviceIps(res.data);
      const n = res.data?.total_groups ?? 0;
      toast.success(n ? `${n} group(s): same device, different IPs` : 'No same-device / different-IP groups found');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setCheatLoading(false);
    }
  };

  const handleFetchDupeIntelligent = async () => {
    setCheatLoading(true);
    setCheatDupeIntelligent(null);
    try {
      const params = new URLSearchParams();
      if (duplicateSuspectsUsername.trim()) params.set('username', duplicateSuspectsUsername.trim());
      params.set('check_vpn', 'true');
      const res = await api.get('/admin/cheat-detection/dupe-check-intelligent?' + params.toString());
      setCheatDupeIntelligent(res.data);
      const ipGroups = res.data?.total_same_ip_groups ?? 0;
      const uaGroups = res.data?.total_same_ua_groups ?? 0;
      const ad = res.data?.total_alive_dead_ip_groups ?? 0;
      const susp = res.data?.total_suspicious_ip_correlations ?? 0;
      toast.success(
        `Loaded: ${ipGroups} same-IP, ${uaGroups} same-UA, ${ad} alive/dead IP, ${susp} suspicious-IP correlation(s)` +
          (Object.keys(res.data?.ip_vpn || {}).length ? ', VPN checked' : '')
      );
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setCheatLoading(false);
    }
  };

  const resolveBotInvestParams = (raw) => {
    const t = (raw || '').trim();
    if (!t) return {};
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRe.test(t)) return { user_id: t };
    return { username: t };
  };

  const loadBotInvestigationProfile = async () => {
    const params = resolveBotInvestParams(botInvestQuery);
    if (!params.user_id && !params.username) {
      toast.error('Enter a username or user id');
      return;
    }
    setBotInvestLoading(true);
    setBotInvestActivity(null);
    setBotInvestDupe(null);
    setBotInvestRateLimit(null);
    setBotInvestBlocks(null);
    try {
      const search = new URLSearchParams();
      if (params.user_id) search.set('user_id', params.user_id);
      if (params.username) search.set('username', params.username);
      const res = await api.get(`/admin/investigate/user-profile?${search.toString()}`);
      setBotInvestProfile(res.data);
      toast.success('Investigation profile loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load investigation profile');
      setBotInvestProfile(null);
    } finally {
      setBotInvestLoading(false);
    }
  };

  const loadBotInvestigationActivity = async () => {
    const u = botInvestProfile?.user?.username;
    if (!u) {
      toast.error('Load profile first');
      return;
    }
    setBotInvestLoading(true);
    try {
      const res = await api.get(`/admin/activity-feed?username=${encodeURIComponent(u)}&since_minutes=1440&limit=200`);
      setBotInvestActivity(res.data);
      toast.success('Activity feed loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load activity');
    } finally {
      setBotInvestLoading(false);
    }
  };

  const loadBotInvestigationDupe = async () => {
    const u = botInvestProfile?.user?.username;
    if (!u) {
      toast.error('Load profile first');
      return;
    }
    setCheatLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('username', u);
      params.set('check_vpn', 'true');
      const res = await api.get(`/admin/cheat-detection/dupe-check-intelligent?${params.toString()}`);
      setBotInvestDupe(res.data);
      toast.success('Intelligent dupe check loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setCheatLoading(false);
    }
  };

  const loadBotInvestigationRateLimit = async () => {
    const uid = botInvestProfile?.user?.id;
    if (!uid) {
      toast.error('Load profile first');
      return;
    }
    setBotInvestLoading(true);
    try {
      const res = await api.get(`/admin/rate-limit-log?user_id=${encodeURIComponent(uid)}&limit=100`);
      setBotInvestRateLimit(res.data);
      toast.success('Rate limit log loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setBotInvestLoading(false);
    }
  };

  const loadBotInvestigationBlocksForUser = async () => {
    const uid = botInvestProfile?.user?.id;
    if (!uid) {
      toast.error('Load profile first');
      return;
    }
    setBotInvestLoading(true);
    try {
      const res = await api.get(`/admin/investigate/bot-blocks?user_id=${encodeURIComponent(uid)}&limit=100`);
      setBotInvestBlocks(res.data);
      toast.success('Bot block history loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setBotInvestLoading(false);
    }
  };

  const loadBotInvestigationBlocksRecent = async () => {
    setBotInvestLoading(true);
    try {
      const res = await api.get('/admin/investigate/bot-blocks?limit=100');
      setBotInvestBlocks(res.data);
      toast.success('Recent bot-block events loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setBotInvestLoading(false);
    }
  };

  const handleBroadcastSystemMessage = async () => {
    const title = (broadcastTitle || '').trim() || 'System message';
    const msg = (broadcastMessage || '').trim();
    if (!msg) {
      toast.error('Enter a message to broadcast');
      return;
    }
    if (!window.confirm('Send this system message to all users?')) return;
    setBroadcastSending(true);
    try {
      const res = await api.post('/notifications/admin/broadcast', { title, message: msg });
      toast.success(res.data?.message || 'System message sent');
      setBroadcastTitle('');
      setBroadcastMessage('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send system message');
    } finally {
      setBroadcastSending(false);
    }
  };

  const handleFetchCrimeAnalytics = async () => {
    setCrimeAnalyticsLoading(true);
    try {
      const res = await api.get('/admin/crimes/analytics/summary', {
        params: { days: crimeAnalyticsDays, limit: 100 },
      });
      setCrimeAnalytics(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load crime analytics');
    } finally {
      setCrimeAnalyticsLoading(false);
    }
  };

  const handleFetchCasinoAnalytics = async () => {
    setCasinoAnalyticsLoading(true);
    try {
      const res = await api.get('/admin/casinos/analytics/summary', { params: { days: casinoAnalyticsDays } });
      setCasinoAnalytics(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load casino analytics');
    } finally {
      setCasinoAnalyticsLoading(false);
    }
  };

  const handleFetchOwnershipProfits = async () => {
    setOwnershipProfitsLoading(true);
    try {
      const res = await api.get('/admin/casinos/ownership-profits');
      const data = res.data || {};
      setOwnershipProfits(data);
      if (data.errors?.length) toast.error(`Partial errors: ${data.errors.join(', ')}`);
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || 'Failed to load ownership profits';
      toast.error(detail);
      setOwnershipProfits({ items: [], grand_total_profit: 0, grand_total_earnings: 0 });
    } finally {
      setOwnershipProfitsLoading(false);
    }
  };

  const handleFetchSwissBank = async () => {
    setSwissBankLoading(true);
    try {
      const res = await api.get('/admin/swiss-bank/list', { params: { min_balance: 1 } });
      setSwissBankList(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load Swiss Bank data');
    } finally {
      setSwissBankLoading(false);
    }
  };

  const handleWipeSwissBank = async (username) => {
    if (!window.confirm(`Wipe ALL Swiss Bank funds from ${username}?`)) return;
    setSwissBankWiping(username);
    try {
      const res = await api.post('/admin/swiss-bank/wipe', null, { params: { target_username: username } });
      toast.success(res.data?.message || 'Wiped');
      handleFetchSwissBank();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to wipe');
    } finally {
      setSwissBankWiping('');
    }
  };

  const handleFetchPointsStoreSpends = async () => {
    setPointsStoreSpendsLoading(true);
    try {
      const params = { limit: 200 };
      if ((pointsStoreSpendsUsernameQuery || '').trim()) params.username = pointsStoreSpendsUsernameQuery.trim();
      const res = await api.get('/admin/points/spend-store', { params });
      setPointsStoreSpends(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load points store spends');
      setPointsStoreSpends({ spends: [], count: 0 });
    } finally {
      setPointsStoreSpendsLoading(false);
    }
  };

  const handleRetractStoreSpend = async (userId, storeEventRef) => {
    const key = `${userId}:${storeEventRef}`;
    if (pointsStoreRetractingKey === key) return;
    if (!window.confirm(`Remove store entitlement for ${storeEventRef} on this user.\n\n- Item will be removed.\n- Points will only be deducted if you previously clicked Refund for this same row.\n- No automatic refunds happen.`)) return;
    setPointsStoreRetractingKey(key);
    try {
      const res = await api.post('/admin/points/retract-store-spend', null, {
        params: { user_id: userId, store_event_ref: storeEventRef },
      });
      toast.success(res.data?.message || 'Removed');
      await handleFetchPointsStoreSpends();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to remove item');
    } finally { setPointsStoreRetractingKey(null); }
  };

  const handleFetchInterestBankPlayers = async (opts) => {
    const includeStaff = opts?.include_staff !== undefined ? opts.include_staff : interestBankIncludeStaff;
    setInterestBankByPlayerLoading(true);
    try {
      const res = await api.get('/admin/interest-bank/players', {
        params: { include_staff: includeStaff, limit: 500 },
      });
      setInterestBankByPlayer(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load interest bank data');
    } finally {
      setInterestBankByPlayerLoading(false);
    }
  };

  const handleJumpToInterestBankPlayers = () => {
    setActiveCategoryId('admin-analytics-monitoring');
    if (typeof window !== 'undefined') window.location.hash = 'admin-analytics-monitoring';
    setCollapsed((prev) => ({ ...prev, interestBankPlayers: false }));
    handleFetchInterestBankPlayers({ include_staff: false });
    setTimeout(() => {
      document.getElementById('admin-interest-bank-players')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 200);
  };

  const handleFetchTradesAnalytics = async () => {
    setTradesAnalyticsLoading(true);
    try {
      const res = await api.get('/admin/trades/analytics/summary', { params: { days: tradesAnalyticsDays } });
      setTradesAnalytics(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load trades analytics');
    } finally {
      setTradesAnalyticsLoading(false);
    }
  };

  const handleFetchHitlistBodyguardsAnalytics = async () => {
    setHitlistBodyguardsAnalyticsLoading(true);
    try {
      const res = await api.get('/admin/hitlist-bodyguards/analytics/summary', { params: { days: hitlistBodyguardsAnalyticsDays } });
      setHitlistBodyguardsAnalytics(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load hitlist/bodyguards analytics');
    } finally {
      setHitlistBodyguardsAnalyticsLoading(false);
    }
  };

  const handleFetchEconomyAnalytics = async () => {
    setEconomyAnalyticsLoading(true);
    try {
      const res = await api.get('/admin/economy/analytics/summary', { params: { days: economyAnalyticsDays } });
      setEconomyAnalytics(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load economy analytics');
    } finally {
      setEconomyAnalyticsLoading(false);
    }
  };

  const handleFetchAnalyticsV2 = async () => {
    setAnalyticsV2Loading(true);
    try {
      const params = { bucket: analyticsV2Bucket, periods: analyticsV2Periods };
      const domain = (analyticsV2Domain || '').trim();
      const [overviewRes, trendsRes] = await Promise.all([
        api.get('/admin/analytics/v2/overview', { params }),
        api.get('/admin/analytics/v2/trends', { params: { ...params, ...(domain ? { domain } : {}) } }),
      ]);
      setAnalyticsV2Overview(overviewRes.data || null);
      setAnalyticsV2Trends(trendsRes.data || null);
      if (domain) {
        const leadersRes = await api.get('/admin/analytics/v2/leaders', { params: { ...params, domain, limit: 25 } });
        setAnalyticsV2Leaders(leadersRes.data || null);
      } else {
        setAnalyticsV2Leaders(null);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load v2 analytics');
    } finally {
      setAnalyticsV2Loading(false);
    }
  };

  const handleRunAnalyticsV2Rollup = async () => {
    setAnalyticsV2RollupLoading(true);
    try {
      await api.post('/admin/analytics/v2/rollups/run', null, { params: { days_back: 31 } });
      toast.success('Analytics rollups refreshed');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to run analytics rollups');
    } finally {
      setAnalyticsV2RollupLoading(false);
    }
  };

  const handleFetchBoozeRunOverview = async () => {
    setBoozeRunOverviewLoading(true);
    try {
      const res = await api.get('/admin/booze-run/analytics/overview', { params: { days: boozeRunAnalyticsDays } });
      setBoozeRunOverview(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load booze-run overview');
    } finally {
      setBoozeRunOverviewLoading(false);
    }
  };

  const handleFetchBoozeRunLeaders = async () => {
    setBoozeRunLeadersLoading(true);
    try {
      const res = await api.get('/admin/booze-run/analytics/leaders', {
        params: { limit: boozeRunLeadersLimit, sort: boozeRunLeadersSort },
      });
      setBoozeRunLeaders(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load booze-run leaders');
    } finally {
      setBoozeRunLeadersLoading(false);
    }
  };

  const handleFetchBoozeRunUser = async () => {
    const q = (boozeRunUserQuery || '').trim();
    if (!q) {
      toast.error('Enter a username or user ID');
      return;
    }
    setBoozeRunUserLoading(true);
    setBoozeRunUserProfile(null);
    try {
      const res = await api.get(`/admin/booze-run/analytics/user/${encodeURIComponent(q)}`, {
        params: { days: boozeRunUserDays },
      });
      setBoozeRunUserProfile(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load booze-run user');
    } finally {
      setBoozeRunUserLoading(false);
    }
  };

  const handleFetchReferralsReport = async () => {
    setReferralsReportLoading(true);
    try {
      const u = (referralsFilterUsername || '').trim();
      const params = u ? { referrer_username: u } : {};
      const res = await api.get('/admin/referrals/report', { params });
      setReferralsReport(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load referrals report');
      setReferralsReport(null);
    } finally {
      setReferralsReportLoading(false);
    }
  };

  const runPreregHeal = async (dryRun) => {
    setReferralsHealLoading(true);
    try {
      const res = await api.post('/admin/referrals/heal-prereg', {
        dry_run: dryRun,
        max_scan: 5000,
        max_detail_rows: 500,
      });
      setReferralsHealResult(res.data || null);
      toast.success(res.data?.message || (dryRun ? 'Dry run complete' : 'Heal complete'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Heal failed');
      setReferralsHealResult(null);
    } finally {
      setReferralsHealLoading(false);
    }
  };

  const clearManualReferralForm = () => {
    setManualReferee('');
    setManualReferrer('');
    setManualForce(false);
    setManualGrantReferee(true);
    setManualReferrerRespect('500');
    setManualResult(null);
  };

  const handleManualReferralAssign = async () => {
    const refU = (manualReferee || '').trim();
    const rerU = (manualReferrer || '').trim();
    if (!refU || !rerU) {
      toast.error('Enter both referee username (new player) and referrer username');
      return;
    }
    setManualLoading(true);
    try {
      const n = Math.min(5000, Math.max(0, parseInt(String(manualReferrerRespect).replace(/\D/g, ''), 10) || 0));
      const res = await api.post('/admin/referrals/manual-assign', {
        referee_username: refU,
        referrer_username: rerU,
        force: manualForce,
        grant_referee_signup_bonuses: manualGrantReferee,
        grant_referrer_welcome_respect: n,
      });
      setManualResult(res.data || null);
      toast.success('Referral link saved');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Manual assign failed');
      setManualResult(null);
    } finally {
      setManualLoading(false);
    }
  };

  const clearRemoveReferralForm = () => {
    setRemoveRefereeUsername('');
    setRemoveReferrerUsername('');
    setRemoveReferralResult(null);
  };

  const handleManualReferralRemove = async () => {
    const refU = (removeRefereeUsername || '').trim();
    if (!refU) {
      toast.error('Enter referee username (account to unlink)');
      return;
    }
    setRemoveReferralLoading(true);
    try {
      const rerU = (removeReferrerUsername || '').trim();
      const res = await api.post('/admin/referrals/remove', {
        referee_username: refU,
        referrer_username: rerU || null,
      });
      setRemoveReferralResult(res.data || null);
      toast.success(res.data?.cleared_all ? 'All referral links removed' : 'Referral link removed');
      await handleFetchReferralsReport();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Remove referral failed');
      setRemoveReferralResult(null);
    } finally {
      setRemoveReferralLoading(false);
    }
  };

  const scrollToReferralRemove = () => {
    document.getElementById('admin-referral-remove')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleUnlinkRefereeFromReportRow = async (refereeUsername, referrerUsername, refereeUserId) => {
    if (!window.confirm(`Unlink referee "${refereeUsername}" from referrer "${referrerUsername}"?`)) return;
    setRemoveReferralRowLoading(refereeUserId || refereeUsername);
    try {
      await api.post('/admin/referrals/remove', {
        referee_username: refereeUsername,
        referrer_username: referrerUsername,
      });
      toast.success('Referral unlinked');
      await handleFetchReferralsReport();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Unlink failed');
    } finally {
      setRemoveReferralRowLoading(null);
    }
  };

  const handleFetchAttackAnalytics = async () => {
    setAttackAnalyticsLoading(true);
    try {
      const res = await api.get('/admin/attacks/analytics/summary', {
        params: { days: attackAnalyticsDays, limit: 100 },
      });
      setAttackAnalytics(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load attack analytics');
    } finally {
      setAttackAnalyticsLoading(false);
    }
  };

  const handleFetchAttackUserProfile = async () => {
    const id = (attackUserId || '').trim();
    if (!id) {
      toast.error('Enter a username or user ID');
      return;
    }
    setAttackUserLoading(true);
    setAttackUserProfile(null);
    try {
      const res = await api.get(`/admin/attacks/user/${encodeURIComponent(id)}`);
      setAttackUserProfile(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load attack profile');
    } finally {
      setAttackUserLoading(false);
    }
  };

  const handleFetchAttackLogs = async () => {
    const un = (attackLogsUsername || '').trim();
    if (!un) {
      toast.error('Enter a username');
      return;
    }
    setAttackLogsLoading(true);
    setAttackLogsData(null);
    try {
      const res = await api.get('/admin/attacks/logs', { params: { username: un, limit: attackLogsLimit } });
      setAttackLogsData(res.data || null);
      toast.success(`Loaded ${(res.data?.logs?.length ?? 0)} attack log entries`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load attack logs');
    } finally {
      setAttackLogsLoading(false);
    }
  };

  useEffect(() => {
    if (!attackLogsLive || !(attackLogsUsername || '').trim()) return;
    const un = (attackLogsUsername || '').trim();
    const limit = attackLogsLimit;
    const run = async () => {
      try {
        const prev = attackLogsDataRef.current;
        const since = prev?.logs?.length ? prev.logs[0].created_at : null;
        const params = { username: un, limit: since ? 100 : limit };
        if (since) params.since = since;
        const res = await api.get('/admin/attacks/logs', { params });
        const data = res.data;
        if (!data) return;
        if (since && prev?.logs?.length && data.logs?.length) {
          const seen = new Set(prev.logs.map((l) => l.id));
          const added = data.logs.filter((l) => !seen.has(l.id));
          const merged = [...added, ...prev.logs]
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .slice(0, limit);
          setAttackLogsData({ ...data, logs: merged });
        } else {
          setAttackLogsData(data);
        }
      } catch { /* ignore */ }
    };
    const t = setInterval(run, 5000);
    run();
    return () => clearInterval(t);
  }, [attackLogsLive, attackLogsUsername, attackLogsLimit]);

  useEffect(() => {
    if (!attackLogViewRow?.id || !attackLogsData?.logs?.length) return;
    const found = attackLogsData.logs.find((l) => l.id === attackLogViewRow.id);
    if (found) setAttackLogViewRow(found);
  }, [attackLogsData, attackLogViewRow?.id]);

  const handleFetchCrimeLogs = async () => {
    const un = (crimeLogsUsername || '').trim();
    if (!un) {
      toast.error('Enter a username');
      return;
    }
    setCrimeLogsLoading(true);
    setCrimeLogsData(null);
    try {
      const res = await api.get('/admin/crimes/logs', { params: { username: un, limit: crimeLogsLimit } });
      setCrimeLogsData(res.data || null);
      toast.success(`Loaded ${(res.data?.logs?.length ?? 0)} crime log entries`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load crime logs');
    } finally {
      setCrimeLogsLoading(false);
    }
  };

  const handleFetchGtaLogs = async () => {
    const un = (gtaLogsUsername || '').trim();
    if (!un) {
      toast.error('Enter a username');
      return;
    }
    setGtaLogsLoading(true);
    setGtaLogsData(null);
    try {
      const res = await api.get('/admin/gta/logs', { params: { username: un, limit: gtaLogsLimit } });
      setGtaLogsData(res.data || null);
      toast.success(`Loaded ${(res.data?.logs?.length ?? 0)} GTA log entries`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load GTA logs');
    } finally {
      setGtaLogsLoading(false);
    }
  };

  const fetchGtaExclusivePool = async () => {
    try {
      const res = await api.get('/admin/gta/exclusive-pool');
      setGtaExclusiveReleased(!!res.data?.released);
      const w = Number(res.data?.drop_weight ?? 0.000006);
      setGtaExclusiveDropWeight(Number.isFinite(w) ? w : 0.000006);
      setGtaExclusiveDropWeightInput(String(Number.isFinite(w) ? w : 0.000006));
      setGtaExclusiveApproxOneIn(Number(res.data?.approx_one_in ?? 0));
    } catch {
      setGtaExclusiveReleased(false);
      setGtaExclusiveDropWeight(0.000006);
      setGtaExclusiveDropWeightInput('0.000006');
      setGtaExclusiveApproxOneIn(166667);
    }
  };

  const handleSetGtaExclusivePool = async (released, dropWeightOverride) => {
    setGtaExclusiveLoading(true);
    try {
      const payload = { released };
      if (dropWeightOverride != null) payload.drop_weight = dropWeightOverride;
      const res = await api.post('/admin/gta/exclusive-pool', payload);
      setGtaExclusiveReleased(!!res.data?.released);
      const w = Number(res.data?.drop_weight ?? gtaExclusiveDropWeight);
      if (Number.isFinite(w)) {
        setGtaExclusiveDropWeight(w);
        setGtaExclusiveDropWeightInput(String(w));
      }
      if (res.data?.approx_one_in != null) setGtaExclusiveApproxOneIn(Number(res.data.approx_one_in) || 0);
      toast.success(res.data?.message || (released ? 'Al Capone exclusive released into GTA pool' : 'Al Capone exclusive retracted from GTA pool'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setGtaExclusiveLoading(false);
    }
  };

  const handleSetGtaExclusiveOdds = async () => {
    const next = Number(String(gtaExclusiveDropWeightInput || '').trim());
    if (!Number.isFinite(next) || next <= 0) {
      toast.error('Enter a valid drop weight');
      return;
    }
    await handleSetGtaExclusivePool(!!gtaExclusiveReleased, next);
  };

  useEffect(() => {
    const showingPanel = !collapsed.gtaPool || !collapsed.gtaLogs;
    const inCategory = activeCategoryId === 'admin-world-systems' || activeCategoryId === 'admin-analytics-monitoring';
    if (!isAdmin || !inCategory || !showingPanel) return;
    fetchGtaExclusivePool();
    if (!collapsed.gtaPool) fetchExclusiveCarValues();
  }, [isAdmin, activeCategoryId, collapsed.gtaPool, collapsed.gtaLogs]);

  const handleGiveEveryoneExclusiveCars = async (lootExclusive, alCapone) => {
    setGiveEveryoneExclusiveLoading(true);
    try {
      const res = await api.post('/admin/give-everyone-exclusive-cars', {
        loot_exclusive: lootExclusive,
        al_capone: alCapone,
      });
      toast.success(res.data?.message || 'Done');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setGiveEveryoneExclusiveLoading(false);
    }
  };

  const fetchExclusiveCarValues = async () => {
    setExclusiveCarValuesLoading(true);
    try {
      const res = await api.get('/admin/cars/values');
      setExclusiveCarValues(res.data?.cars || []);
      if (res.data?.cars?.length && !editCarId) {
        const first = res.data.cars[0];
        setEditCarId(first.id);
        setEditCarValue(String(first.value));
        setEditCarTravel(String(first.travel_bonus));
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load car values');
    } finally {
      setExclusiveCarValuesLoading(false);
    }
  };

  const handleEditCarValue = async (carId, value, travel) => {
    if (!carId) return;
    const val = parseInt(value, 10);
    if (isNaN(val) || val < 0) { toast.error('Enter a valid value'); return; }
    setEditCarId(carId);
    setEditCarSaving(true);
    try {
      const payload = { car_id: carId, value: val };
      if (travel != null && String(travel).trim() !== '') payload.travel_bonus = parseInt(travel, 10) || 0;
      const res = await api.post('/admin/cars/edit-value', payload);
      toast.success(res.data?.message || 'Updated');
      await fetchExclusiveCarValues();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update');
    } finally {
      setEditCarSaving(false);
    }
  };

  const handleFetchJailLogs = async () => {
    const un = (jailLogsUsername || '').trim();
    if (!un) {
      toast.error('Enter a username');
      return;
    }
    setJailLogsLoading(true);
    setJailLogsData(null);
    try {
      const res = await api.get('/admin/jail/logs', { params: { username: un, limit: jailLogsLimit } });
      setJailLogsData(res.data || null);
      toast.success(`Loaded ${(res.data?.logs?.length ?? 0)} jail bust log entries`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load jail logs');
    } finally {
      setJailLogsLoading(false);
    }
  };

  const handleFetchBankLogs = async () => {
    const un = (bankLogsUsername || '').trim();
    if (!un) {
      toast.error('Enter a username');
      return;
    }
    setBankLogsLoading(true);
    setBankLogsData(null);
    try {
      const res = await api.get('/admin/bank/logs', { params: { username: un, limit: bankLogsLimit } });
      setBankLogsData(res.data || null);
      const t = (res.data?.transfers?.length ?? 0);
      const d = (res.data?.deposits?.length ?? 0);
      toast.success(`Loaded ${t} transfers, ${d} deposits`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load bank logs');
    } finally {
      setBankLogsLoading(false);
    }
  };

  const handleFetchDonationsLog = async () => {
    setDonationsLogLoading(true);
    setDonationsLogData(null);
    try {
      const res = await api.get('/admin/payments');
      setDonationsLogData(res.data?.transactions || []);
      toast.success(`Loaded ${(res.data?.transactions?.length ?? 0)} payment transactions`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load donations log');
    } finally {
      setDonationsLogLoading(false);
    }
  };

  const handleManualCreditTransaction = async (sessionId) => {
    if (!window.confirm('Manually credit this transaction? Points will be added to the user immediately.')) return;
    setManualCreditLoading(sessionId);
    try {
      const res = await api.post('/admin/payments/manual-credit', { session_id: sessionId });
      toast.success(res.data?.message || 'Transaction credited');
      handleFetchDonationsLog();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to credit transaction');
    } finally {
      setManualCreditLoading(null);
    }
  };

  const handleCheckStripeSession = async () => {
    const sid = stripeSessionInput.trim();
    if (!sid) return;
    setCheckStripeLoading(true);
    setStripeCheckResult(null);
    try {
      const res = await api.post('/admin/payments/check-stripe-session', { session_id: sid });
      setStripeCheckResult(res.data);
      if (res.data?.credit_result?.credited) {
        toast.success(res.data.message || 'Payment processed!');
        handleFetchDonationsLog();
      } else {
        toast.info(res.data?.message || 'Check result');
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to check session');
      setStripeCheckResult({ error: e.response?.data?.detail || 'Failed' });
    } finally {
      setCheckStripeLoading(false);
    }
  };

  const handleFetchStockLogs = async () => {
    const un = (stockLogsUsername || '').trim();
    if (!un) {
      toast.error('Enter a username');
      return;
    }
    setStockLogsLoading(true);
    setStockLogsData(null);
    try {
      const res = await api.get('/admin/stock/logs', { params: { username: un, limit: stockLogsLimit } });
      setStockLogsData(res.data || null);
      toast.success(`Loaded ${(res.data?.logs?.length ?? 0)} stock log entries`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load stock logs');
    } finally {
      setStockLogsLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUserId.trim()) { toast.error('Enter a user ID or username'); return; }
    if (!window.confirm('DELETE this user?')) return;
    setDbLoading(true);
    try {
      const res = await api.post('/admin/delete-user/' + encodeURIComponent(deleteUserId.trim()));
      toast.success(res.data?.message || 'Deleted');
      setDeleteUserId('');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setDbLoading(false); }
  };

  const handleFetchAdminFamilies = async () => {
    try {
      const res = await api.get('/admin/families-list');
      setAdminFamiliesList(res.data?.families || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load families');
    }
  };

  const handleDeleteFamily = async () => {
    if (!deleteFamilyId) { toast.error('Select a family'); return; }
    if (!window.confirm('DELETE this family? All members will be removed from the crew. Cannot be undone.')) return;
    setDbLoading(true);
    try {
      const res = await api.post('/admin/delete-family', { family_id: deleteFamilyId });
      toast.success(res.data?.message || 'Family deleted');
      setDeleteFamilyId('');
      handleFetchAdminFamilies();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setDbLoading(false); }
  };

  const handleWipeAllFamilies = async () => {
    if (wipeAllFamiliesConfirmText !== 'WIPE ALL FAMILIES') { toast.error('Type "WIPE ALL FAMILIES" to confirm'); return; }
    if (!window.confirm('FINAL WARNING: Delete ALL families? Every user will be removed from their crew. Cannot be undone.')) return;
    setDbLoading(true);
    try {
      const res = await api.post('/admin/wipe-all-families', { confirmation_text: 'WIPE ALL FAMILIES' });
      toast.success(res.data?.message || 'All families wiped');
      setWipeAllFamiliesConfirmText('');
      handleFetchAdminFamilies();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setDbLoading(false); }
  };

  const handleDropAllCasinosProperties = async () => {
    if (dropAllCasinosConfirmText !== 'DROP ALL CASINOS PROPERTIES') {
      toast.error('Type "DROP ALL CASINOS PROPERTIES" to confirm');
      return;
    }
    if (!window.confirm('Drop ALL casinos and properties for EVERYONE? Every dice, blackjack, slots, airport, armoury, etc. will become unclaimed.')) return;
    setDbLoading(true);
    try {
      const res = await api.post('/admin/drop-all-casinos-properties', { confirmation_text: 'DROP ALL CASINOS PROPERTIES' });
      toast.success(res.data?.message || 'All casinos and properties dropped.');
      setDropAllCasinosConfirmText('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setDbLoading(false);
    }
  };

  const handleWipeAllUsers = async () => {
    if (wipeConfirmText !== 'WIPE ALL') { toast.error('Type "WIPE ALL" to confirm'); return; }
    if (!window.confirm('FINAL WARNING: Delete ALL users?')) return;
    setDbLoading(true);
    try {
      const res = await api.post('/admin/wipe-all-users', { confirmation_text: 'WIPE ALL DATA' });
      toast.success(res.data?.message || 'Database wiped.');
      setWipeConfirmText('');
      // Current user no longer exists; clear token and send to login so the app doesn't break
      localStorage.removeItem('token');
      window.location.href = '/login';
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setDbLoading(false);
    }
  };

  const handleDatabaseFresh = async () => {
    if (freshConfirmText !== 'NEW RELEASE') { toast.error('Type "NEW RELEASE" to confirm'); return; }
    if (!window.confirm('FINAL WARNING: Wipe ENTIRE database and re-seed from scratch? Game starts from zero. You will be logged out.')) return;
    setDbFreshLoading(true);
    try {
      const res = await api.post('/admin/database-fresh', { confirmation_text: 'NEW RELEASE' });
      toast.success(res.data?.message || 'Database reset. New release ready.');
      setFreshConfirmText('');
      localStorage.removeItem('token');
      window.location.href = '/login';
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setDbFreshLoading(false);
    }
  };

  const handleDropAllCars = async () => {
    if (!window.confirm('Delete ALL cars for ALL users? Every garage will be empty. This cannot be undone.')) return;
    setDbLoading(true);
    try {
      const res = await api.post('/admin/cars/delete-all');
      toast.success(res.data?.message || 'All cars deleted');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setDbLoading(false); }
  };

  const handleCreateTestUsers = async () => {
    if (!window.confirm('Create 30 real test users (random ranks, crews, casino/property owners)? Password: test1234')) return;
    try {
      const res = await api.post('/admin/create-test-users');
      toast.success(res.data?.message || 'Created');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleTestUsersAutoRank = async (enabled) => {
    try {
      const res = await api.post('/admin/test-users-auto-rank', { enabled });
      toast.success(res.data?.message || (enabled ? 'Enabled' : 'Disabled'));
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleSeededUsersAutoRank = async (enabled) => {
    try {
      const res = await api.post('/admin/seeded-users-auto-rank', { enabled });
      toast.success(res.data?.message || (enabled ? 'Enabled' : 'Disabled'));
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleGiveAllPoints = async () => {
    if (!window.confirm(`Give ${giveAllPoints} points to ALL?`)) return;
    try {
      const res = await api.post(`/admin/give-all-points?points=${giveAllPoints}`);
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleRemoveAllPoints = async () => {
    if (!window.confirm('FINAL WARNING: Remove ALL points from alive accounts? This is irreversible.')) return;
    setRemoveAllPointsLoading(true);
    try {
      const res = await api.post('/admin/remove-all-points?max_users=100000');
      toast.success(res.data?.message || 'Points removed');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to remove all points');
    } finally {
      setRemoveAllPointsLoading(false);
    }
  };

  const handleZeroAllPoints = async () => {
    if (!window.confirm('FINAL WARNING: Set ALL points=0 for alive accounts? This is irreversible.')) return;
    setZeroAllPointsLoading(true);
    try {
      const res = await api.post('/admin/zero-all-points?max_users=100000');
      toast.success(res.data?.message || 'Points set to 0');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to zero out all points');
    } finally {
      setZeroAllPointsLoading(false);
    }
  };

  const handleGiveAllMoney = async () => {
    if (!window.confirm(`Give $${giveAllMoney.toLocaleString()} to ALL?`)) return;
    try {
      const res = await api.post(`/admin/give-all-money?amount=${giveAllMoney}`);
      toast.success(res.data?.message || 'Done');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const handleFetchSecuritySummary = async () => {
    setSecurityLoading(true);
    try {
      const response = await api.get('/admin/security/summary?limit=50');
      setSecuritySummary(response.data);
      toast.success('Security summary loaded');
    } catch (e) { 
      toast.error(e.response?.data?.detail || 'Failed to fetch security summary'); 
      setSecuritySummary(null);
    }
    finally { setSecurityLoading(false); }
  };

  const fetchLoginIssues = async () => {
    setLoginIssuesLoading(true);
    setLoginIssues(null);
    try {
      const response = await api.get('/admin/login-issues', { params: { limit: 100 } });
      setLoginIssues(response.data?.lockouts || []);
      toast.success(response.data?.count === 0 ? 'No login lockouts' : `${response.data?.count} lockout(s) loaded`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load login issues');
      setLoginIssues([]);
    } finally {
      setLoginIssuesLoading(false);
    }
  };

  const clearLoginLockoutByEmail = async (email) => {
    try {
      await api.post('/admin/clear-login-lockout-by-email', null, { params: { email } });
      toast.success('Lockout cleared');
      if (loginIssues) setLoginIssues(loginIssues.filter((r) => r.email !== email));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear');
    }
  };

  const fetchProfileLoadErrors = async () => {
    setProfileLoadErrorsLoading(true);
    setProfileLoadErrors(null);
    try {
      const res = await api.get('/admin/profile-load-errors', { params: { limit: 50 } });
      setProfileLoadErrors(res.data?.errors || []);
      toast.success(res.data?.count === 0 ? 'No profile load errors recorded' : `Loaded ${res.data?.count} error(s)`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load');
      setProfileLoadErrors([]);
    } finally {
      setProfileLoadErrorsLoading(false);
    }
  };

  const fetchActivityFeed = async (silent = false) => {
    if (!silent) setActivityFeedLoading(true);
    try {
      const mins = activityFeedAutoRefresh ? 15 : activityFeedMinutes;
      const params = { since_minutes: mins, limit: 200 };
      if (activityFeedUsername.trim()) params.username = activityFeedUsername.trim();
      if (activityFeedUsernameMode) params.username_mode = activityFeedUsernameMode;
      if (activityFeedFilter.trim()) params.action = activityFeedFilter.trim();
      if (activityFeedMinAmount !== '' && Number(activityFeedMinAmount) >= 0) {
        params.min_amount = Math.max(0, parseInt(String(activityFeedMinAmount), 10) || 0);
      }
      const selectedSources = Object.entries(activityFeedSources)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([name]) => name);
      if (selectedSources.length > 0) {
        params.sources = selectedSources.join(',');
      }
      const res = await api.get('/admin/activity-feed', { params });
      setActivityFeed(res.data);
    } catch (e) {
      if (!silent) toast.error(e.response?.data?.detail || 'Failed to load activity feed');
      if (!silent) setActivityFeed(null);
    } finally {
      if (!silent) setActivityFeedLoading(false);
    }
  };

  useEffect(() => {
    if (activityFeedAutoRefresh) {
      fetchActivityFeed(true);
      activityFeedIntervalRef.current = setInterval(() => fetchActivityFeed(true), 5000);
    } else if (activityFeedIntervalRef.current) {
      clearInterval(activityFeedIntervalRef.current);
      activityFeedIntervalRef.current = null;
    }
    return () => {
      if (activityFeedIntervalRef.current) {
        clearInterval(activityFeedIntervalRef.current);
        activityFeedIntervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityFeedAutoRefresh, activityFeedUsername, activityFeedUsernameMode, activityFeedFilter, activityFeedMinAmount, activityFeedSources]);

  const fetchActivityLog = async () => {
    setActivityLogLoading(true);
    try {
      const params = { limit: 100 };
      if (activityLogUsername.trim()) params.username = activityLogUsername.trim();
      const res = await api.get('/admin/activity-log', { params });
      setActivityLog(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load activity log');
      setActivityLog({ entries: [] });
    } finally {
      setActivityLogLoading(false);
    }
  };

  const fetchMinigamePayouts = async () => {
    setMinigamePayoutsLoading(true);
    try {
      const params = { limit: 200 };
      if (minigamePayoutsUsername.trim()) params.username = minigamePayoutsUsername.trim();
      if (minigamePayoutsGame.trim()) params.game = minigamePayoutsGame.trim();
      const res = await api.get('/admin/minigame-payouts', { params });
      setMinigamePayouts(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load minigame payouts');
      setMinigamePayouts({ entries: [] });
    } finally {
      setMinigamePayoutsLoading(false);
    }
  };

  const fetchWeeklyLeaderboardPayouts = async () => {
    setWeeklyLeaderboardPayoutsLoading(true);
    try {
      const params = {
        limit: weeklyLeaderboardPayoutsLimit,
      };
      if (weeklyLeaderboardPayoutsUsername.trim()) params.username = weeklyLeaderboardPayoutsUsername.trim();
      if (weeklyLeaderboardPayoutsCategory && weeklyLeaderboardPayoutsCategory !== 'all') params.category = weeklyLeaderboardPayoutsCategory;
      const res = await api.get('/admin/leaderboard-weekly-payouts', { params });
      setWeeklyLeaderboardPayouts(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load leaderboard weekly payouts');
      setWeeklyLeaderboardPayouts({ entries: [] });
    } finally {
      setWeeklyLeaderboardPayoutsLoading(false);
    }
  };

  const fetchGamblingLog = async () => {
    setGamblingLogLoading(true);
    try {
      const params = { limit: 100 };
      if (gamblingLogUsername.trim()) params.username = gamblingLogUsername.trim();
      if (gamblingLogGameType.trim()) params.game_type = gamblingLogGameType.trim();
      const res = await api.get('/admin/gambling-log', { params });
      setGamblingLog(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load gambling log');
      setGamblingLog({ entries: [] });
    } finally {
      setGamblingLogLoading(false);
    }
  };

  const fetchRespectPointsLog = async () => {
    const uid = respectLogUserId.trim();
    if (!uid) {
      toast.error('Enter user ID');
      return;
    }
    const lim = Math.max(1, Math.min(1000, parseInt(String(respectLogLimit), 10) || 200));
    setRespectLogLoading(true);
    setRespectLogData(null);
    try {
      const res = await api.get('/admin/respect-points-log', { params: { user_id: uid, limit: lim } });
      setRespectLogData(res.data);
      toast.success('Respect log loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load respect log');
      setRespectLogData(null);
    } finally {
      setRespectLogLoading(false);
    }
  };

  const jumpToRespectPointsLog = (userId) => {
    const id = String(userId || '').trim();
    if (!id) return;
    setUserDetailData(null);
    setRespectLogUserId(id);
    setActiveCategoryId('admin-operations');
    setCollapsed((prev) => ({ ...prev, respectPointsLog: false }));
    if (typeof window !== 'undefined') {
      window.location.hash = 'admin-operations';
      setTimeout(() => document.getElementById('admin-respect-points-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }
    const lim = Math.max(1, Math.min(1000, parseInt(String(respectLogLimit), 10) || 200));
    setRespectLogLoading(true);
    setRespectLogData(null);
    api.get('/admin/respect-points-log', { params: { user_id: id, limit: lim } })
      .then((res) => {
        setRespectLogData(res.data);
        toast.success('Respect log loaded');
      })
      .catch((e) => {
        toast.error(e.response?.data?.detail || 'Failed to load respect log');
      })
      .finally(() => setRespectLogLoading(false));
  };

  const handleClearGamblingLog = async () => {
    if (!window.confirm(`Delete gambling log entries older than ${clearGamblingDays} days?`)) return;
    setClearGamblingLoading(true);
    try {
      const res = await api.post('/admin/gambling-log/clear', null, { params: { days: clearGamblingDays } });
      toast.success(res.data?.message || 'Cleared');
      fetchGamblingLog();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear');
    } finally {
      setClearGamblingLoading(false);
    }
  };

  const handleClearOldFlags = async () => {
    if (!window.confirm('Clear security flags older than 30 days?')) return;
    setSecurityLoading(true);
    try {
      const response = await api.post('/admin/security/clear-old-flags', { days: 30 });
      toast.success(response.data.message || 'Old flags cleared');
      setSecuritySummary(null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setSecurityLoading(false); }
  };

  const fetchCheatDetectionConfig = async () => {
    setCheatDetectionConfigLoading(true);
    try {
      const res = await api.get('/admin/security/cheat-detection-config');
      setCheatDetectionConfig(res.data);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); setCheatDetectionConfig(null); }
    finally { setCheatDetectionConfigLoading(false); }
  };

  const updateCheatDetectionConfig = async (updates) => {
    setCheatDetectionConfigLoading(true);
    try {
      const res = await api.post('/admin/security/cheat-detection-config', null, { params: updates });
      setCheatDetectionConfig((prev) => ({ ...prev, ...res.data }));
      toast.success(res.data.message || 'Updated');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setCheatDetectionConfigLoading(false); }
  };

  const handleViewRateLimits = async () => {
    setSecurityLoading(true);
    try {
      const response = await api.get('/admin/security/rate-limits');
      setRateLimits(response.data);
      setRateLimitEdits({});
      toast.success('Rate limits loaded');
    } catch (e) { 
      toast.error(e.response?.data?.detail || 'Failed to fetch rate limits'); 
      setRateLimits(null);
    }
    finally { setSecurityLoading(false); }
  };

  const handleToggleRateLimit = async (endpoint, currentEnabled) => {
    try {
      const response = await api.post(`/admin/security/rate-limits/toggle?endpoint=${encodeURIComponent(endpoint)}&enabled=${!currentEnabled}`);
      toast.success(response.data.message);
      // Refresh the rate limits
      await handleViewRateLimits();
    } catch (e) { 
      toast.error(e.response?.data?.detail || 'Failed to toggle rate limit'); 
    }
  };

  const handleUpdateRateLimit = async (endpoint, newLimitMs) => {
    const num = Number(newLimitMs);
    if (Number.isNaN(num) || num < 0 || num > 60000) {
      toast.error('Limit must be between 0 and 60000 ms');
      return;
    }
    try {
      const response = await api.post(`/admin/security/rate-limits/update?endpoint=${encodeURIComponent(endpoint)}&min_interval_ms=${num}`);
      toast.success(response.data.message);
      await handleViewRateLimits();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update rate limit');
    }
  };

  const handleDisableAllLimits = async () => {
    if (!window.confirm('⚠️ Disable ALL rate limits? This removes all protection against spam and exploits.')) return;
    setSecurityLoading(true);
    try {
      const response = await api.post('/admin/security/rate-limits/disable-all');
      toast.success(response.data.message);
      // Refresh the rate limits
      await handleViewRateLimits();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to disable rate limits');
    }
    finally { setSecurityLoading(false); }
  };

  const handleEnableAllLimits = async () => {
    if (!window.confirm('Enable ALL rate limits? This will turn on protection for all endpoints.')) return;
    setSecurityLoading(true);
    try {
      const response = await api.post('/admin/security/rate-limits/enable-all');
      toast.success(response.data.message);
      await handleViewRateLimits();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to enable rate limits');
    }
    finally { setSecurityLoading(false); }
  };

  const handleSetAllRateLimitInterval = async (intervalMs) => {
    if (!window.confirm(`Set ALL endpoints to ${intervalMs}ms between clicks?`)) return;
    setSecurityLoading(true);
    try {
      const response = await api.post(`/admin/security/rate-limits/set-all-interval?min_interval_ms=${intervalMs}`);
      toast.success(response.data.message);
      await handleViewRateLimits();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set rate limits');
    }
    finally { setSecurityLoading(false); }
  };

  const fetchRateLimitLog = async () => {
    setRateLimitLogLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('limit', '200');
      if (rateLimitLogUsername.trim()) params.append('username', rateLimitLogUsername.trim());
      const res = await api.get(`/admin/rate-limit-log?${params.toString()}`);
      setRateLimitLog(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to fetch rate limit log');
    } finally {
      setRateLimitLogLoading(false);
    }
  };

  const handleClearRateLimitLogUser = async (userId, username) => {
    if (!window.confirm(`Clear rate limit flags for ${username}?`)) return;
    try {
      const res = await api.post(`/admin/rate-limit-log/clear-user?user_id=${userId}`);
      toast.success(res.data?.message || 'Cleared');
      fetchRateLimitLog();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear');
    }
  };

  const handleClearAllRateLimitLog = async () => {
    if (!window.confirm('Clear ALL rate limit flags? This cannot be undone.')) return;
    try {
      const res = await api.post('/admin/rate-limit-log/clear-all');
      toast.success(res.data?.message || 'Cleared all');
      fetchRateLimitLog();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear');
    }
  };

  const handleFetchEconomyOverview = async () => {
    setEconomyOverviewLoading(true);
    try {
      const res = await api.get('/admin/economy/overview');
      setEconomyOverview(res.data ?? null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load economy overview'); }
    finally { setEconomyOverviewLoading(false); }
  };

  const CASH_HOLDERS_PAGE = 50;
  const fetchCashHolders = async (pageOffset = 0, sort = cashHoldersSort) => {
    setCashHoldersLoading(true);
    try {
      const params = new URLSearchParams({
        offset: String(pageOffset),
        limit: String(CASH_HOLDERS_PAGE),
        sort: sort || 'money_desc',
      });
      const s = cashHoldersSearchInput.trim();
      if (s) params.set('search', s);
      const res = await api.get(`/admin/economy/cash-holders?${params}`);
      setCashHolders(res.data ?? null);
      setCashHoldersOffset(pageOffset);
      setCashHoldersSort(sort || 'money_desc');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load cash holders'); }
    finally { setCashHoldersLoading(false); }
  };

  const handleFetchCapitalBreakdown = async () => {
    setCapitalBreakdownLoading(true);
    try {
      const res = await api.get('/admin/economy/capital-breakdown');
      setCapitalBreakdown(res.data ?? null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load capital breakdown'); }
    finally { setCapitalBreakdownLoading(false); }
  };

  const handleFetchLoginPageVisitors = async () => {
    setLoginPageVisitorsLoading(true);
    try {
      const res = await api.get('/admin/stats/login-page-unique-visitors');
      setLoginPageVisitors(res.data?.unique_visitors ?? null);
      setLoginPageViews(res.data?.total_views ?? null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load login page visitors'); }
    finally { setLoginPageVisitorsLoading(false); }
  };

  const handleFetchPlayerActivity = async () => {
    setPlayerActivityLoading(true);
    try {
      const res = await api.get('/admin/players/activity-summary');
      setPlayerActivity(res.data ?? null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load player activity'); }
    finally { setPlayerActivityLoading(false); }
  };

  const handleCompareUsers = async () => {
    if (!compareUser1.trim() || !compareUser2.trim()) { toast.error('Enter two usernames'); return; }
    setCompareLoading(true);
    try {
      const res = await api.get(`/admin/players/compare?user1=${encodeURIComponent(compareUser1.trim())}&user2=${encodeURIComponent(compareUser2.trim())}`);
      setCompareResult(res.data ?? null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to compare users'); }
    finally { setCompareLoading(false); }
  };

  const handleFetchSystemHealth = async () => {
    setSystemHealthLoading(true);
    try {
      const res = await api.get('/admin/system/health');
      setSystemHealth(res.data ?? null);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load system health'); }
    finally { setSystemHealthLoading(false); }
  };

  const handleFetchMaintenanceBanner = async () => {
    setMaintenanceBannerLoading(true);
    try {
      const res = await api.get('/admin/maintenance-banner');
      setMaintenanceBanner(res.data ?? null);
      if (res.data?.message) setMaintenanceMsg(res.data.message);
      if (res.data?.duration_minutes) setMaintenanceDuration(res.data.duration_minutes);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load banner'); }
    finally { setMaintenanceBannerLoading(false); }
  };

  const handleSetMaintenanceBanner = async (enabled) => {
    setMaintenanceBannerLoading(true);
    try {
      const res = await api.post('/admin/maintenance-banner', {
        enabled,
        message: maintenanceMsg || 'Scheduled maintenance in progress.',
        duration_minutes: maintenanceDuration || 60,
      });
      setMaintenanceBanner(res.data ?? null);
      toast.success(res.data?.message || (enabled ? 'Banner enabled' : 'Banner disabled'));
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to update banner'); }
    finally { setMaintenanceBannerLoading(false); }
  };

  const handleFetchReleaseSoftLaunch = async () => {
    setReleaseSoftLaunchLoading(true);
    try {
      const res = await api.get('/admin/release-soft-launch');
      setReleaseSoftLaunchAdmin(res.data ?? null);
      const u = res.data?.game_pass_unlock_at || res.data?.stored?.game_pass_unlock_at;
      if (u) setReleaseSoftLaunchUnlockAt(String(u));
      const pv = res.data?.pvp_kills_unlock_at || res.data?.stored?.pvp_kills_unlock_at;
      if (pv) setReleaseSoftLaunchPvpUnlockAt(String(pv));
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load release soft-launch'); }
    finally { setReleaseSoftLaunchLoading(false); }
  };

  const handleSetReleaseSoftLaunch = async (enabled) => {
    setReleaseSoftLaunchLoading(true);
    try {
      const res = await api.post('/admin/release-soft-launch', {
        enabled,
        game_pass_unlock_at: releaseSoftLaunchUnlockAt.trim() || undefined,
        pvp_kills_unlock_at: releaseSoftLaunchPvpUnlockAt.trim() || undefined,
      });
      setReleaseSoftLaunchAdmin(res.data ?? null);
      toast.success(res.data?.message || 'Updated release soft-launch');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to update release soft-launch'); }
    finally { setReleaseSoftLaunchLoading(false); }
  };

  const handleBulkAction = async () => {
    const names = bulkUsernames.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
    if (!names.length) { toast.error('Enter at least one username'); return; }
    if (!window.confirm(`Apply "${bulkAction}" to ${names.length} user(s)?`)) return;
    setBulkLoading(true);
    try {
      const res = await api.post('/admin/bulk-action', { usernames: names, action: bulkAction, value: bulkValue || null });
      toast.success(res.data?.message || 'Bulk action applied');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBulkLoading(false); }
  };

  if (loading) {
    return (
      <div className={`${styles.pageContent} mobile-page-root admin-mobile-shell pb-6 md:pb-0`}>
        <style>{ADMIN_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Settings size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading…</span>
        </div>
      </div>
    );
  }

  if (!isAdmin && !isModerator) {
    return <Navigate to="/account/dashboard" replace />;
  }

  const Input = AdminInput;
  const Select = AdminSelect;

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root admin-mobile-shell pb-6 md:pb-0 flex flex-col max-md:min-h-[min(calc(100dvh-5.5rem),100%)]`} data-testid="admin-page">
      <style>{ADMIN_STYLES}</style>
      <div className="relative admin-fade-in flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] text-zinc-500 font-heading italic">Use with caution</p>
        {isModerator && !isAdmin && (
          <span className="text-[9px] font-heading font-bold uppercase tracking-wider text-amber-400 border border-amber-500/40 rounded px-2 py-0.5 bg-amber-500/10">
            Moderator view (limited tools)
          </span>
        )}
      </div>

      {/* Prominent warning for duplicate state heads */}
      {stateHeads?.has_duplicates && (
        <div className="admin-fade-in rounded-lg border-2 border-red-500/60 bg-red-500/15 p-3 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-heading font-bold text-red-400 uppercase tracking-wider mb-1">Duplicate State Heads Detected!</p>
            {stateHeads.duplicates?.map((d) => (
              <p key={d.family_id} className="text-[11px] text-red-300">
                <strong>{d.family_name}</strong> is head of {d.states_headed.join(', ')} ({d.count} states)
              </p>
            ))}
            <button
              onClick={() => { setActiveCategoryId('admin-world-systems'); setCollapsed((prev) => ({ ...prev, stateHeads: false })); if (typeof window !== 'undefined') window.location.hash = 'admin-world-systems'; }}
              className="mt-2 text-[10px] font-heading font-bold text-red-400 underline hover:text-red-300"
            >
              → Go to State Heads section to fix
            </button>
          </div>
        </div>
      )}

      {/* Sidebar + main layout: stack on mobile, side-by-side on desktop */}
      <div className="flex flex-col md:flex-row gap-2 md:gap-4 flex-1 min-h-0 min-w-0 max-md:flex-1 max-md:min-h-0">
        {/* Sidebar: search + categories (mobile: full-bleed strip like Crimes panels; desktop: vertical nav) */}
        <aside className="admin-aside-nav mobile-panel w-full md:w-[220px] shrink-0 flex flex-col gap-3 border-r-0 md:border-r border-primary/20 pr-0 md:pr-4">
          <div className="sticky top-0 z-20 md:static md:z-auto space-y-2 pb-1 px-3 md:px-0 mx-0 md:mx-0 bg-background/95 md:bg-transparent backdrop-blur md:backdrop-blur-none border-b border-primary/25 md:border-b-0">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mutedForeground" />
              <input
                ref={searchInputRef}
                type="text"
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredTools.length > 0) {
                    e.preventDefault();
                    handleToolSelect(filteredTools[0]);
                  }
                }}
                onFocus={() => setToolSearchFocused(true)}
                onBlur={() => setTimeout(() => setToolSearchFocused(false), 150)}
                placeholder="Search tools… (Enter = first match)"
                className="w-full pl-8 pr-3 py-2 md:py-1.5 rounded-md border border-primary/30 bg-zinc-900/80 text-[11px] font-heading text-foreground placeholder:text-mutedForeground focus:border-primary/60 focus:outline-none"
              />
              {toolSearch && (
                <button
                  type="button"
                  onClick={() => { setToolSearch(''); searchInputRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-mutedForeground hover:text-foreground"
                >
                  <X size={12} />
                </button>
              )}
              {toolSearchFocused && filteredTools.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-primary/30 rounded-md shadow-lg max-h-64 overflow-y-auto z-30">
                  {filteredTools.map((tool, idx) => {
                    const category = ADMIN_CATEGORIES.find(c => c.id === tool.categoryId);
                    return (
                      <button
                        key={tool.label + idx}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); handleToolSelect(tool); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary/20 transition-colors border-b border-zinc-800 last:border-b-0"
                      >
                        {category?.icon && <category.icon size={12} className="text-primary shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-heading font-bold text-foreground truncate">{tool.label}</div>
                          <div className="text-[9px] text-mutedForeground">{category?.label || ''}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {toolSearchFocused && toolSearch && filteredTools.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-primary/30 rounded-md shadow-lg p-3 z-30">
                  <p className="text-[10px] text-mutedForeground text-center">No tools found for &quot;{toolSearch}&quot;</p>
                </div>
              )}
            </div>
            <div className="md:hidden">
              <label htmlFor="admin-category-jump" className="sr-only">Jump to admin section</label>
              <select
                id="admin-category-jump"
                value={activeCategoryId}
                onChange={(e) => {
                  const id = e.target.value;
                  setActiveCategoryId(id);
                  if (typeof window !== 'undefined') window.location.hash = id;
                }}
                className="w-full px-2 py-2 rounded-md border border-primary/30 bg-zinc-900/90 text-[11px] font-heading font-bold text-foreground"
              >
                {visibleCategories.map(({ id, label }) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex md:hidden gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory mx-0 px-0 touch-pan-x">
              {visibleCategories.map(({ id, icon: Icon }) => {
                const shortLabel = ADMIN_CATEGORY_MOBILE_SHORT[id] || id.replace(/^admin-/, '');
                const active = activeCategoryId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { setActiveCategoryId(id); if (typeof window !== 'undefined') window.location.hash = id; }}
                    className={`snap-center shrink-0 flex items-center gap-1.5 px-2.5 py-2 min-h-[40px] rounded-md text-[10px] font-heading font-bold uppercase tracking-wide border transition-colors ${
                      active
                        ? 'border-primary bg-primary/25 text-primary'
                        : 'border-primary/30 bg-primary/10 text-primary/90 hover:bg-primary/20'
                    }`}
                  >
                    <Icon size={14} className="shrink-0 opacity-90" />
                    <span className="whitespace-nowrap">{shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <nav className="hidden md:flex flex-col gap-1">
            {visibleCategories.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => { setActiveCategoryId(id); if (typeof window !== 'undefined') window.location.hash = id; }}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px] font-heading font-bold uppercase tracking-wide border transition-colors text-left ${
                  activeCategoryId === id
                    ? 'border-primary bg-primary/20 text-primary'
                    : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main: target username + scrollable tools (mobile); desktop unchanged scroll */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-visible md:block md:overflow-y-auto md:max-h-[min(100vh-10rem,100dvh-10rem)] md:overflow-x-hidden md:space-y-4">
          <div id="admin-target-username" className={`shrink-0 z-10 relative admin-module admin-focus-block ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bg-background/95 backdrop-blur mobile-panel md:sticky md:top-0 scroll-mt-24`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <button
              type="button"
              className="md:pointer-events-none w-full px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2 text-left"
              onClick={() => setAdminMobileTargetOpen((o) => !o)}
              aria-expanded={adminMobileTargetOpen}
            >
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Target Username</span>
              <span className="md:hidden text-primary/80 shrink-0" aria-hidden>
                {adminMobileTargetOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
            </button>
            {!adminMobileTargetOpen && (
              <div className="md:hidden px-3 py-2 text-[10px] font-heading text-mutedForeground border-b border-primary/10">
                Target: <span className="text-foreground font-medium">{(formData.targetUsername || '').trim() || '—'}</span>
              </div>
            )}
            <div className={`${adminMobileTargetOpen ? '' : 'hidden '}md:block p-3`}>
              <input
                type="text"
                value={formData.targetUsername}
                onChange={(e) => setFormData((prev) => ({ ...prev, targetUsername: e.target.value }))}
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                placeholder="Enter username for actions below"
              />
            </div>
            <div className="admin-art-line text-primary mx-3" />
          </div>

          <div className="flex-1 min-h-0 overflow-visible overscroll-y-contain space-y-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:contents md:overflow-visible md:pb-0">
          {activeCategoryId === 'admin-operations' && (
          <>
      {/* Search users (username or email) */}
      <div id="admin-search-users" data-admin-tool="searchUsers" className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel scroll-mt-24`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Search users (username or email)</span>
        </div>
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUserSearch()}
              className="flex-1 min-w-[160px] bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              placeholder="Type username or email (substring)"
            />
            <BtnPrimary onClick={handleUserSearch} disabled={userSearchLoading}>{userSearchLoading ? '...' : 'Search'}</BtnPrimary>
          </div>
          {userSearchResults && (
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              {userSearchResults.length === 0 ? (
                <p className="text-[10px] text-mutedForeground font-heading">No users found.</p>
              ) : (
                <table className="w-full text-left border-collapse text-[10px] font-heading">
                  <thead>
                    <tr className="border-b border-zinc-700/50">
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Username</th>
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Email</th>
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Dead</th>
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Created</th>
                      <th className="py-1.5 font-bold text-mutedForeground uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userSearchResults.map((u) => (
                      <tr key={u.id || u.username} className="border-b border-zinc-700/30">
                        <td className="py-1.5 pr-2 text-foreground font-medium">{u.username ?? '—'}</td>
                        <td className="py-1.5 pr-2 text-mutedForeground truncate max-w-[180px]">{u.email ?? '—'}</td>
                        <td className="py-1.5 pr-2">{u.is_dead ? <span className="text-red-400">Yes</span> : 'No'}</td>
                        <td className="py-1.5 pr-2 text-mutedForeground">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                        <td className="py-1.5 flex flex-wrap gap-1">
                          <button type="button" onClick={() => openUserDetail(u)} disabled={userDetailLoading} className="px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-zinc-500/50 bg-zinc-700/40 text-zinc-200 hover:bg-zinc-600/50 disabled:opacity-50 flex items-center gap-0.5" title="View full user details">
                            <Info size={10} /> Details
                          </button>
                          <button type="button" onClick={() => setTargetFromSearch(u.username)} className="px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30">Set target</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
        <div className="admin-art-line text-primary mx-3" />
      </div>

      {(isAdmin || isModerator) && (
      <div id="admin-respect-points-log" className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel scroll-mt-24`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Award}
          title="Respect points log"
          badge={
            respectLogData?.summary ? (
              <span className="text-[10px] font-heading text-mutedForeground">
                {respectLogData.summary.events_in_view} events · {Number(respectLogData.summary.total_amount_in_view || 0).toLocaleString()} pts (view)
              </span>
            ) : null
          }
          toolAnchor="respectPointsLog"
          isCollapsed={collapsed.respectPointsLog}
          onToggle={() => toggleSection('respectPointsLog')}
        />
        {!collapsed.respectPointsLog && (
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground font-heading">
              <span className="text-foreground">respect_events</span> — positive amounts are earned respect; negative amounts are spends/removals (e.g. store purchases paid with respect, admin_remove). Enter the user&apos;s ID from User details or search.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={respectLogUserId}
                onChange={(e) => setRespectLogUserId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchRespectPointsLog()}
                placeholder="User ID"
                className="flex-1 min-w-[160px] bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-xs font-mono text-foreground focus:border-primary/50 focus:outline-none"
              />
              <span className="text-[10px] text-mutedForeground font-heading shrink-0">Limit</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={respectLogLimit}
                onChange={(e) => setRespectLogLimit(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 200)))}
                className="w-20 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-2 text-xs font-mono text-foreground focus:border-primary/50 focus:outline-none"
              />
              <BtnPrimary onClick={fetchRespectPointsLog} disabled={respectLogLoading}>
                {respectLogLoading ? '...' : 'Load'}
              </BtnPrimary>
            </div>
            {respectLogData && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['Username', respectLogData.username ?? '—'],
                    ['Current balance', Number(respectLogData.current_respect_balance ?? 0).toLocaleString()],
                    ['Events (this load)', String(respectLogData.summary?.events_in_view ?? 0)],
                    ['Respect sum (this load)', Number(respectLogData.summary?.total_amount_in_view ?? 0).toLocaleString()],
                    ['Unique sources', String(respectLogData.summary?.unique_sources ?? 0)],
                    ['Total rows in DB', String(respectLogData.summary?.total_events_in_db ?? 0)],
                  ].map(([k, v]) => (
                    <div key={k} className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                      <div className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider">{k}</div>
                      <div className="text-[11px] font-heading font-bold text-primary truncate" title={v}>{v}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider mb-1">By source</div>
                  <div className="max-h-48 overflow-y-auto rounded border border-zinc-700/50">
                    <table className="w-full text-[10px] font-heading">
                      <thead className="bg-zinc-800/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2 text-mutedForeground uppercase">Source</th>
                          <th className="text-right p-2 text-mutedForeground uppercase">Events</th>
                          <th className="text-right p-2 text-mutedForeground uppercase">Respect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(respectLogData.by_source || []).map((row) => (
                          <tr key={row.source} className="border-t border-zinc-700/30">
                            <td className="p-2 text-foreground font-mono text-[9px] break-all">{row.source}</td>
                            <td className="p-2 text-right">{Number(row.events || 0).toLocaleString()}</td>
                            <td className="p-2 text-right text-primary font-bold">{Number(row.total_amount || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(respectLogData.by_source || []).length === 0 && (
                    <p className="text-[10px] text-mutedForeground font-heading py-2">No events in this window.</p>
                  )}
                </div>
                <div>
                  <div className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider mb-1">Recent events</div>
                  <div className="max-h-64 overflow-y-auto rounded border border-zinc-700/50">
                    <table className="w-full text-[10px] font-heading">
                      <thead className="bg-zinc-800/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2 text-mutedForeground uppercase">Time</th>
                          <th className="text-left p-2 text-mutedForeground uppercase">Source</th>
                          <th className="text-right p-2 text-mutedForeground uppercase">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(respectLogData.events || []).map((ev, idx) => (
                          <tr key={`${ev.at}-${idx}`} className="border-t border-zinc-700/30">
                            <td className="p-2 text-mutedForeground whitespace-nowrap">{ev.at ? new Date(ev.at).toLocaleString() : '—'}</td>
                            <td className="p-2 text-foreground font-mono text-[9px] break-all">{ev.source ?? '—'}</td>
                            <td className="p-2 text-right text-primary font-bold">{Number(ev.amount ?? 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {!respectLogData && !respectLogLoading && (
              <p className="text-[10px] text-mutedForeground font-heading">Load to see earned-respect entries for that user.</p>
            )}
          </div>
        )}
        <div className="admin-art-line text-primary mx-3" />
      </div>
      )}

      {/* All registered users (admin only) */}
      {isAdmin && (
      <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">All registered users</span>
        </div>
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-heading text-mutedForeground shrink-0">Filter:</label>
            <select
              value={allUsersFilter}
              onChange={(e) => setAllUsersFilter(e.target.value)}
              className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="alive">Alive only</option>
              <option value="dead">Dead only</option>
              <option value="npc">NPC only</option>
              <option value="non_npc">Non-NPC only</option>
            </select>
            <label className="text-[10px] font-heading text-mutedForeground shrink-0 ml-2">Sort:</label>
            <select
              value={allUsersSort}
              onChange={(e) => setAllUsersSort(e.target.value)}
              className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
            >
              <option value="username_asc">Username A–Z</option>
              <option value="username_desc">Username Z–A</option>
              <option value="alive_first">Alive first</option>
              <option value="dead_first">Dead first</option>
              <option value="npc_first">NPC first</option>
              <option value="non_npc_first">Non-NPC first</option>
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
            </select>
            <BtnPrimary onClick={fetchAllUsers} disabled={allUsersLoading} className="ml-2">{allUsersLoading ? '...' : 'Load'}</BtnPrimary>
          </div>
          {allUsersTotal != null && allUsersList && (
            <p className="text-[10px] text-mutedForeground font-heading">Showing {allUsersList.length} of {allUsersTotal} user(s)</p>
          )}
          {allUsersList && (
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              {allUsersList.length === 0 ? (
                <p className="text-[10px] text-mutedForeground font-heading">No users match the filter.</p>
              ) : (
                <table className="w-full text-left border-collapse text-[10px] font-heading">
                  <thead className="sticky top-0 bg-zinc-900/95 z-10">
                    <tr className="border-b border-zinc-700/50">
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Username</th>
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Email</th>
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Verified</th>
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Dead</th>
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">NPC</th>
                      <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Created</th>
                      <th className="py-1.5 font-bold text-mutedForeground uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsersList.map((u) => (
                      <tr key={u.id || u.username} className="border-b border-zinc-700/30 hover:bg-zinc-800/30">
                        <td className="py-1.5 pr-2 text-foreground font-medium">{u.username ?? '—'}</td>
                        <td className="py-1.5 pr-2 text-mutedForeground truncate max-w-[180px]">{u.email ?? '—'}</td>
                        <td className="py-1.5 pr-2">{u.email_verified === false ? <span className="text-amber-400">No</span> : <span className="text-emerald-400">Yes</span>}</td>
                        <td className="py-1.5 pr-2">{u.is_dead ? <span className="text-red-400">Yes</span> : 'No'}</td>
                        <td className="py-1.5 pr-2">{(u.is_npc || u.is_bodyguard) ? <span className="text-amber-400">Yes</span> : 'No'}</td>
                        <td className="py-1.5 pr-2 text-mutedForeground">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                        <td className="py-1.5 flex flex-wrap gap-1">
                          <button type="button" onClick={() => openUserDetail(u)} disabled={userDetailLoading} className="px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-zinc-500/50 bg-zinc-700/40 text-zinc-200 hover:bg-zinc-600/50 disabled:opacity-50 flex items-center gap-0.5" title="View full user details">
                            <Info size={10} /> Details
                          </button>
                          {!(u.is_npc || u.is_bodyguard) && (
                            <button type="button" onClick={() => setTargetFromSearch(u.username)} className="px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30">Set target</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
        <div className="admin-art-line text-primary mx-3" />
      </div>
      )}

      {/* User detail modal */}
      {userDetailData && (() => {
        const u = userDetailData.user || {};
        const fmtDate = (v) => (v ? new Date(v).toLocaleString() : '—');
        const fmtNum = (v) => {
          if (v == null || v === '') return '—';
          const n = Number(v);
          return Number.isFinite(n) ? n.toLocaleString() : '—';
        };
        const Section = ({ title, children }) => (
          <div className="space-y-1.5">
            <div className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider border-b border-zinc-700/50 pb-0.5">{title}</div>
            {children}
          </div>
        );
        const Row = ({ label, value, fullWidth }) => {
          if (value == null || value === '' || (typeof value === 'string' && value === '—')) value = '—';
          return (
            <div className={fullWidth ? 'col-span-2' : ''}>
              <span className="text-mutedForeground">{label}:</span>{' '}
              <span className="text-foreground">{value}</span>
            </div>
          );
        };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setUserDetailData(null)}>
            <div className="bg-zinc-900 border border-primary/30 rounded-lg shadow-xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between shrink-0">
                <h3 className="text-sm font-heading font-bold text-primary">User details: {u.username ?? '—'}</h3>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setTargetFromSearch(u.username)} className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30">Set target</button>
                  <button type="button" onClick={() => setUserDetailData(null)} className="p-1 rounded border border-zinc-600 text-zinc-400 hover:bg-zinc-700 hover:text-foreground"><X size={14} /></button>
                </div>
              </div>
              <div className="p-4 overflow-y-auto flex-1 text-[10px] font-heading space-y-4">
                <Section title="Identity">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Username" value={u.username} />
                    <Row label="Email" value={u.email} />
                    <Row label="User ID" value={u.id} fullWidth />
                    <Row label="Created" value={fmtDate(u.created_at)} />
                    <Row label="Email verified" value={u.email_verified === false ? 'No' : 'Yes'} />
                    <Row label="Dead" value={u.is_dead ? 'Yes' : 'No'} />
                    <Row label="NPC" value={u.is_npc ? 'Yes' : 'No'} />
                    <Row label="Bodyguard" value={u.is_bodyguard ? 'Yes' : 'No'} />
                  </div>
                </Section>
                <Section title="Device & IPs">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Device (last login)" value={u.last_device_type} />
                    <Row label="Registration IP" value={u.registration_ip} />
                    <Row label="Last login IP" value={u.last_login_ip} />
                    <Row label="User-Agent (last login)" value={u.last_user_agent ? <span className="font-mono text-[9px] break-all text-mutedForeground">{u.last_user_agent}</span> : '—'} fullWidth />
                    <Row label="Login IPs" value={Array.isArray(u.login_ips) && u.login_ips.length ? u.login_ips.join(', ') : '—'} fullWidth />
                  </div>
                </Section>
                <Section title="Wealth & resources">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Money" value={fmtNum(u.money)} />
                    <Row label="Points" value={fmtNum(u.points)} />
                    <Row label="Rank points" value={fmtNum(u.rank_points)} />
                    <Row label="Prestige" value={u.prestige_level != null ? `P${u.prestige_level}` : '—'} />
                    <Row label="Bullets" value={fmtNum(u.bullets)} />
                    <Row label="Health" value={fmtNum(u.health)} />
                    <Row label="Armour level" value={fmtNum(u.armour_level)} />
                    <Row
                      label="Respect points"
                      value={
                        <span className="inline-flex items-center gap-2 flex-wrap">
                          {fmtNum(u.respect_points)}
                          {u.id ? (
                            <button
                              type="button"
                              onClick={() => jumpToRespectPointsLog(u.id)}
                              className="px-2 py-0.5 text-[10px] font-heading uppercase border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 rounded"
                            >
                              Respect log
                            </button>
                          ) : null}
                        </span>
                      }
                    />
                    <Row label="Loot box pieces" value={fmtNum(u.loot_box_pieces)} />
                    <Row label="Swiss balance" value={fmtNum(u.swiss_balance)} />
                    <Row label="Swiss limit" value={fmtNum(u.swiss_limit)} />
                  </div>
                </Section>
                <Section title="Combat & activity">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Total kills" value={fmtNum(u.total_kills)} />
                    <Row label="Total deaths" value={fmtNum(u.total_deaths)} />
                    <Row label="Total crimes" value={fmtNum(u.total_crimes)} />
                    <Row label="Crime profit" value={fmtNum(u.crime_profit)} />
                    <Row label="Jail busts" value={fmtNum(u.jail_busts)} />
                    <Row label="Total GTA" value={fmtNum(u.total_gta)} />
                    <Row label="Bodyguard slots" value={fmtNum(u.bodyguard_slots)} />
                  </div>
                </Section>
                <Section title="Location & state">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Current state (city)" value={u.current_state} />
                    <Row label="In jail" value={u.in_jail ? 'Yes' : 'No'} />
                    <Row label="Jail until" value={fmtDate(u.jail_until)} />
                    <Row
                      label="Jail bust reward (stored)"
                      value={
                        <span className="inline-flex items-center gap-2 flex-wrap">
                          ${fmtNum(u.bust_reward_cash ?? 0)}
                          {Number(u.bust_reward_cash ?? 0) > 0 && (
                            <button
                              type="button"
                              onClick={async () => {
                                const amt = Number(u.bust_reward_cash ?? 0);
                                if (!window.confirm(`Clear jail bust reward ($${amt.toLocaleString()}) to $0 for ${u.username}?`)) return;
                                try {
                                  await api.post('/admin/clear-user-jail-bust-reward', { user_id: u.id });
                                  toast.success('Jail bust reward cleared');
                                  if (userDetailData?.user?.id) openUserDetail({ id: userDetailData.user.id });
                                } catch (e) {
                                  toast.error(e.response?.data?.detail || 'Failed to clear jail bust reward');
                                }
                              }}
                              className="px-2 py-0.5 text-[10px] font-heading uppercase border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 rounded"
                            >
                              Clear to $0
                            </button>
                          )}
                        </span>
                      }
                      fullWidth
                    />
                    <Row label="Last seen" value={fmtDate(u.last_seen)} />
                    <Row label="Forced online until" value={fmtDate(u.forced_online_until)} />
                    <Row label="Travels this hour" value={fmtNum(u.travels_this_hour)} />
                    <Row label="Extra airmiles" value={fmtNum(u.extra_airmiles)} />
                    <Row label="Garage batch limit" value={fmtNum(u.garage_batch_limit)} />
                  </div>
                </Section>
                <Section title="Family & social">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Family ID" value={u.family_id} />
                    <Row label="Family role" value={u.family_role} />
                    <Row label="Telegram chat ID" value={u.telegram_chat_id ? 'Set' : '—'} />
                    <Row label="Auto Rank enabled" value={u.auto_rank_enabled ? 'Yes' : 'No'} />
                  </div>
                </Section>
                <Section title="Tribute & missions">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Mission 1 bonus" value={u.has_mission_1_bonus ? 'Yes' : 'No'} />
                    <Row label="Mission 2 bonus" value={u.has_mission_2_bonus ? 'Yes' : 'No'} />
                    <Row label="Mission 3 bonus" value={u.has_mission_3_bonus ? 'Yes' : 'No'} />
                    <Row label="Mission 4 bonus" value={u.has_mission_4_bonus ? 'Yes' : 'No'} />
                  </div>
                </Section>
                <Section title="Moderation & lock">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Account locked" value={u.account_locked_at ? `Yes (${fmtDate(u.account_locked_at)})` : 'No'} />
                    <Row label="Lock until" value={fmtDate(u.account_locked_until)} />
                    {u.account_locked_comment && <Row label="Lock comment (user)" value={u.account_locked_comment} fullWidth />}
                    {u.account_locked_admin_message && <Row label="Lock message (admin)" value={u.account_locked_admin_message} fullWidth />}
                    {u.account_locked_user_reply && <Row label="Lock reply (user)" value={u.account_locked_user_reply} fullWidth />}
                  </div>
                </Section>
                <Section title="Other">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <Row label="Token version" value={fmtNum(u.token_version)} />
                    <Row label="Premium rank bar" value={u.premium_rank_bar ? 'Yes' : 'No'} />
                    <Row label="Has silencer" value={u.has_silencer ? 'Yes' : 'No'} />
                    <Row label="OC timer reduced" value={u.oc_timer_reduced ? 'Yes' : 'No'} />
                    <Row label="Crew OC timer reduced" value={u.crew_oc_timer_reduced ? 'Yes' : 'No'} />
                    <Row label="Casino profit" value={fmtNum(u.casino_profit)} />
                    <Row label="Property profit" value={fmtNum(u.property_profit)} />
                    <Row label="Booze profit today" value={fmtNum(u.booze_profit_today)} />
                    <Row label="Booze profit total" value={fmtNum(u.booze_profit_total)} />
                    <Row label="Lifetime points spent" value={fmtNum(u.lifetime_points_spent)} />
                  </div>
                </Section>
                {(userDetailData.casinos_owned?.length > 0 || userDetailData.user?.id) && (
                  <Section title="Casinos & properties">
                    {(userDetailData.casinos_owned?.length > 0) && (
                      <ul className="text-foreground space-y-1 mb-2">
                        {userDetailData.casinos_owned.map((c, i) => (
                          <li key={i} className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px]">{c.game_type} · {c.location}</span>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`Drop ${c.game_type} (${c.location}) from this user?`)) return;
                                try {
                                  await api.post('/admin/drop-user-casino', { user_id: userDetailData.user?.id, game_type: c.game_type, location: c.location });
                                  toast.success('Casino dropped');
                                  if (userDetailData?.user?.id) openUserDetail({ id: userDetailData.user.id });
                                } catch (e) {
                                  toast.error(e.response?.data?.detail || 'Failed to drop casino');
                                }
                              }}
                              className="px-2 py-0.5 text-[10px] font-heading uppercase border border-red-500/50 text-red-500 hover:bg-red-500/10 rounded"
                            >
                              Drop
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Drop ALL casinos and properties for this user? They will lose every casino and property (airport/armoury).')) return;
                        try {
                          const res = await api.post('/admin/drop-user-casinos-properties', { user_id: userDetailData.user?.id });
                          toast.success(res.data?.message || 'Dropped all casinos & properties');
                          if (userDetailData?.user?.id) openUserDetail({ id: userDetailData.user.id });
                        } catch (e) {
                          toast.error(e.response?.data?.detail || 'Failed');
                        }
                      }}
                      className="px-2 py-1 text-[10px] font-heading uppercase border border-red-500/50 text-red-500 hover:bg-red-500/10 rounded"
                    >
                      Drop all this user's casinos & properties
                    </button>
                  </Section>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Attack log row detail modal */}
      {attackLogViewRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setAttackLogViewRow(null)}>
          <div className="bg-zinc-900 border border-primary/30 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-heading font-bold text-primary">Attack log entry</h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[10px] font-heading text-mutedForeground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attackLogsLive}
                    onChange={(e) => setAttackLogsLive(e.target.checked)}
                    className="rounded border border-input"
                  />
                  Live
                </label>
                {attackLogsLive && (attackLogsUsername || '').trim() && (
                  <span className="text-[9px] text-primary font-heading">Refreshing every 5s</span>
                )}
                <button type="button" onClick={() => setAttackLogViewRow(null)} className="p-1 rounded border border-zinc-600 text-zinc-400 hover:bg-zinc-700 hover:text-foreground"><X size={14} /></button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-[10px] font-heading space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div><span className="text-mutedForeground">Attacker:</span> {attackLogViewRow.attacker_username ?? '—'}</div>
                <div><span className="text-mutedForeground">Target:</span> {attackLogViewRow.target_username ?? '—'}</div>
                <div><span className="text-mutedForeground">Outcome:</span> {attackLogViewRow.outcome ?? '—'}</div>
                <div><span className="text-mutedForeground">Location:</span> {attackLogViewRow.location_state ?? attackLogViewRow.state ?? '—'}</div>
                <div><span className="text-mutedForeground">IP:</span> <span className="font-mono">{attackLogViewRow.client_ip ?? '—'}</span></div>
                <div><span className="text-mutedForeground">Bullets used:</span> {attackLogViewRow.bullets_used != null ? Number(attackLogViewRow.bullets_used).toLocaleString() : '—'}</div>
                <div><span className="text-mutedForeground">Bodyguard kill:</span> {attackLogViewRow.is_bodyguard_kill ? 'Yes' : attackLogViewRow.outcome === 'bodyguard' ? 'Blocked' : '—'}</div>
                <div><span className="text-mutedForeground">Bot?</span> {attackLogViewRow.attacker_is_bot === true ? 'Yes' : attackLogViewRow.attacker_is_bot === false ? 'No' : '—'}</div>
                {attackLogViewRow.attacker_bot_label && (
                  <div className="col-span-2"><span className="text-mutedForeground">Bot type:</span> <span className="text-amber-400 font-medium">{attackLogViewRow.attacker_bot_label}</span></div>
                )}
                <div><span className="text-mutedForeground">Time:</span> {formatAttackLogTime(attackLogViewRow.created_at)}</div>
              </div>
              {(attackLogViewRow.attacker_is_bot || attackLogViewRow.attacker_bot_label) && (
                <div>
                  <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">Bot info</div>
                  <p className="text-foreground text-[10px]">
                    {attackLogViewRow.attacker_bot_label && <><span className="text-amber-400 font-medium">Type/language: </span>{attackLogViewRow.attacker_bot_label}</>}
                  </p>
                </div>
              )}
              <div>
                <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">Player message</div>
                <p className="text-foreground whitespace-pre-wrap break-words">{attackLogViewRow.player_message ?? '—'}</p>
              </div>
              <div>
                <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">User-Agent</div>
                <p className="text-foreground font-mono text-[9px] break-all">{attackLogViewRow.user_agent ?? '—'}</p>
              </div>
              {attackLogViewRow.first_bodyguard && (
                <div>
                  <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">First bodyguard</div>
                  <pre className="text-foreground font-mono text-[9px] whitespace-pre-wrap break-words">{JSON.stringify(attackLogViewRow.first_bodyguard, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Players (admin only) ─── */}
      {isAdmin && (
      <section id="admin-players" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <UserCog size={12} />
          Player Management
        </h2>

        <div id="admin-user-adjust-hub" className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-amber-500/30 mobile-panel scroll-mt-24`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
          <SectionHeader
            icon={Trophy}
            title="User give / take & leaderboards"
            toolAnchor="userAdjustHub"
            isCollapsed={collapsed.userAdjustHub}
            onToggle={() => toggleSection('userAdjustHub')}
          />
          {!collapsed.userAdjustHub && (
            <div className="p-3 space-y-4">
              <p className="text-[9px] text-mutedForeground font-heading">
                Shared <span className="text-foreground font-bold">target username</span> for this panel (syncs with the command bar). Preview main-board metrics, partially remove oldest event rows, strip full categories, and run common money/points/bullet tools without opening the dossier.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider">Username</span>
                <input
                  type="text"
                  value={formData.targetUsername}
                  onChange={(e) => setFormData((prev) => ({ ...prev, targetUsername: e.target.value }))}
                  placeholder="Target username"
                  className="flex-1 min-w-[160px] max-w-sm px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
              </div>

              <div className="rounded-md border border-primary/25 bg-primary/5 p-3 space-y-2">
                <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Quick give / take</div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                  <span className="text-mutedForeground shrink-0">Money ($)</span>
                  <input
                    type="number"
                    value={userHubMoneyDelta}
                    onChange={(e) => setUserHubMoneyDelta(parseInt(e.target.value, 10) || 0)}
                    placeholder="e.g. -50000"
                    className="w-28 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs"
                  />
                  <BtnPrimary type="button" onClick={handleUserHubAdjustMoney} disabled={userHubMoneyLoading || !(formData.targetUsername || '').trim()}>
                    {userHubMoneyLoading ? '…' : userHubMoneyDelta < 0 ? 'Remove' : 'Add'}
                  </BtnPrimary>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                  <span className="text-mutedForeground shrink-0">Points</span>
                  <AdminInput type="number" value={formData.points} onChange={(e) => setFormData((p) => ({ ...p, points: parseInt(e.target.value, 10) || 0 }))} className="w-20" />
                  <BtnPrimary type="button" onClick={handleAddPoints}>Add</BtnPrimary>
                  <AdminInput type="number" value={formData.pointsRemove} onChange={(e) => setFormData((p) => ({ ...p, pointsRemove: parseInt(e.target.value, 10) || 0 }))} className="w-20" />
                  <BtnSecondary type="button" onClick={handleRemovePoints}>Remove</BtnSecondary>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                  <span className="text-mutedForeground shrink-0">Bullets</span>
                  <AdminInput type="number" value={formData.bullets} onChange={(e) => setFormData((p) => ({ ...p, bullets: parseInt(e.target.value, 10) || 0 }))} className="w-24" />
                  <BtnPrimary type="button" onClick={handleAddBullets}>Give</BtnPrimary>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                  <span className="text-mutedForeground shrink-0">Respect</span>
                  <AdminInput type="number" value={formData.respectAdd} onChange={(e) => setFormData((p) => ({ ...p, respectAdd: parseInt(e.target.value, 10) || 0 }))} className="w-20" />
                  <BtnPrimary type="button" onClick={handleAddRespectPoints}>Add</BtnPrimary>
                  <AdminInput type="number" value={formData.respectRemove} onChange={(e) => setFormData((p) => ({ ...p, respectRemove: parseInt(e.target.value, 10) || 0 }))} className="w-20" />
                  <BtnSecondary type="button" onClick={handleRemoveRespectPoints}>Remove</BtnSecondary>
                </div>
              </div>

              <div className="rounded-md border border-cyan-500/25 bg-cyan-500/5 p-3 space-y-2">
                <div className="text-[10px] font-heading font-bold text-cyan-300/90 uppercase tracking-wider">Leaderboard scores (main /leaderboards/top)</div>
                <div className="flex flex-wrap items-center gap-2">
                  <BtnPrimary type="button" onClick={() => fetchUserLeaderboardScores(false)} disabled={userLbScoresLoading || !(formData.targetUsername || '').trim()}>
                    {userLbScoresLoading ? '…' : 'Load scores'}
                  </BtnPrimary>
                </div>
                {userLbScores && (
                  <div className="space-y-2 text-[10px] font-heading">
                    <div className="text-[9px] text-mutedForeground">
                      Week (UTC): <span className="text-foreground font-mono">{userLbScores.week_start_utc}</span>
                      {' → '}
                      <span className="text-foreground font-mono">{userLbScores.week_end_utc}</span>
                    </div>
                    <div className="overflow-x-auto rounded border border-cyan-500/20 max-h-72 overflow-y-auto">
                      <table className="w-full text-left text-[9px] border-collapse">
                        <thead>
                          <tr className="border-b border-zinc-700/60 text-mutedForeground uppercase sticky top-0 bg-zinc-900/95">
                            <th className="py-1 px-2">Metric</th>
                            <th className="py-1 px-2 text-right">Weekly</th>
                            <th className="py-1 px-2 text-right">All-time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ['Crimes', userLbScores.weekly?.crimes, userLbScores.alltime?.total_crimes],
                            ['GTA', userLbScores.weekly?.gta, userLbScores.alltime?.total_gta],
                            ['Jail busts', userLbScores.weekly?.jail_busts, userLbScores.alltime?.jail_busts],
                            ['Kills', userLbScores.weekly?.kills, userLbScores.alltime?.total_kills],
                            ['Stock profit (pts)', userLbScores.weekly?.stock_profit_points, userLbScores.alltime?.stock_market_profit_total],
                            ['Booze profit', userLbScores.weekly?.booze_profit, userLbScores.alltime?.booze_run_profit_total],
                            ['Respect', userLbScores.weekly?.respect_earned, userLbScores.alltime?.respect_points],
                            ['Melt (bullets)', userLbScores.weekly?.melt_bullets, userLbScores.alltime?.bullets_melted],
                            ['Points spent', '—', userLbScores.alltime?.lifetime_points_spent],
                          ].map(([label, w, a]) => (
                            <tr key={label} className="border-b border-zinc-800/50">
                              <td className="py-1 px-2 text-foreground">{label}</td>
                              <td className="py-1 px-2 text-right font-mono text-zinc-300">{w === '—' ? '—' : Number(w ?? 0).toLocaleString()}</td>
                              <td className="py-1 px-2 text-right font-mono text-zinc-300">{a === '—' ? '—' : Number(a ?? 0).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-md border border-amber-600/30 bg-amber-950/20 p-3 space-y-2">
                <div className="text-[10px] font-heading font-bold text-amber-200/90 uppercase tracking-wider">Partial remove (oldest rows first)</div>
                <p className="text-[9px] text-mutedForeground font-heading">
                  Crimes / GTA: user totals decrement only for deleted rows with <code className="text-[8px] bg-zinc-800/80 px-1 rounded">success: true</code>. Cap 50,000 per request.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                  <AdminSelect value={userLbAdjustMetric} onChange={(e) => setUserLbAdjustMetric(e.target.value)}>
                    <option value="crimes">crimes</option>
                    <option value="gta">gta</option>
                    <option value="jail_busts">jail_busts</option>
                    <option value="kills">kills</option>
                  </AdminSelect>
                  <AdminSelect value={userLbAdjustPeriod} onChange={(e) => setUserLbAdjustPeriod(e.target.value)}>
                    <option value="weekly">weekly (Mon UTC)</option>
                    <option value="alltime">all-time</option>
                  </AdminSelect>
                  <input
                    type="number"
                    min={1}
                    max={50000}
                    value={userLbAdjustRemoveCount}
                    onChange={(e) => setUserLbAdjustRemoveCount(e.target.value)}
                    className="w-24 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs"
                  />
                  <label className="flex items-center gap-1 cursor-pointer text-mutedForeground">
                    <input type="checkbox" checked={userLbAdjustDryRun} onChange={(e) => setUserLbAdjustDryRun(e.target.checked)} />
                    Dry run (apply button)
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <BtnSecondary type="button" onClick={() => handleUserLeaderboardPartialAdjust({ dryRun: true })} disabled={userLbAdjustLoading || !(formData.targetUsername || '').trim()}>
                    {userLbAdjustLoading ? '…' : 'Dry run only'}
                  </BtnSecondary>
                  <BtnDanger type="button" onClick={() => handleUserLeaderboardPartialAdjust({})} disabled={userLbAdjustLoading || !(formData.targetUsername || '').trim()}>
                    {userLbAdjustLoading ? '…' : userLbAdjustDryRun ? 'Apply (dry run)' : 'Apply remove'}
                  </BtnDanger>
                </div>
              </div>

              <div className={`relative rounded-lg overflow-hidden border border-amber-500/25`}>
                <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
                <SectionHeader
                  icon={BarChart3}
                  title="Minigame leaderboards & records"
                  toolAnchor="minigameLbAdmin"
                  isCollapsed={collapsed.minigameLbAdmin}
                  onToggle={() => toggleSection('minigameLbAdmin')}
                />
                {!collapsed.minigameLbAdmin && (
                  <div className="p-2 space-y-1 bg-zinc-950/40">
                    <ActionRow icon={Trash2} label="Clear minigame records (user)" description="Delete minigame scores/history rows across all minigame collections" color="text-red-400">
                      <BtnDanger onClick={handleClearUserMinigameRecords} disabled={clearMinigameRecordsLoading || !(formData.targetUsername || '').trim()}>
                        {clearMinigameRecordsLoading ? '...' : 'Clear'}
                      </BtnDanger>
                    </ActionRow>

                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 ml-0 sm:ml-0">
                      <div className="text-[10px] font-heading text-amber-200/90 uppercase tracking-wider">Weekly board + per-game tables</div>
                      <p className="text-[9px] text-mutedForeground font-heading">
                        Strip: remove <code className="text-[8px] bg-zinc-800/80 px-1 rounded">minigame_plays</code> (combined weekly points) and/or per-game score collections. Does not delete{' '}
                        <code className="text-[8px] bg-zinc-800/80 px-1 rounded">minigame_run_sessions</code> — use &quot;Clear minigame records&quot; for a full wipe.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={minigameLbStripWeekly} onChange={(e) => setMinigameLbStripWeekly(e.target.checked)} />
                          Weekly plays
                        </label>
                        <select
                          value={minigameLbWeekScope}
                          onChange={(e) => setMinigameLbWeekScope(e.target.value)}
                          disabled={!minigameLbStripWeekly}
                          className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1 text-xs"
                        >
                          <option value="current">This week (Mon UTC)</option>
                          <option value="all">All weeks</option>
                        </select>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={minigameLbStripPerGame} onChange={(e) => setMinigameLbStripPerGame(e.target.checked)} />
                          Per-game scores
                        </label>
                      </div>
                      <input
                        type="text"
                        placeholder="Optional: gauntlet, snake (comma-separated slugs; empty = all)"
                        value={minigameLbStripGames}
                        onChange={(e) => setMinigameLbStripGames(e.target.value)}
                        className="w-full max-w-md bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs"
                      />
                      <div>
                        <BtnDanger type="button" onClick={handleMinigameLbStrip} disabled={minigameLbStripLoading || !(formData.targetUsername || '').trim()}>
                          {minigameLbStripLoading ? '…' : 'Strip leaderboard rows'}
                        </BtnDanger>
                      </div>
                      <hr className="border-zinc-700/50 my-2" />
                      <p className="text-[9px] text-mutedForeground font-heading">
                        Add: append one synthetic play for combined weekly points and/or one high-score row. No cash/respect payout. Per-game row supported for snake, gauntlet, shooting_range, mafia_rpg, family_run, whack_a_copper only.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                        <select
                          value={minigameLbAddGame}
                          onChange={(e) => setMinigameLbAddGame(e.target.value)}
                          className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1 text-xs"
                        >
                          <option value="gauntlet">gauntlet (Flappy)</option>
                          <option value="snake">snake</option>
                          <option value="shooting_range">shooting_range</option>
                          <option value="mafia_rpg">mafia_rpg</option>
                          <option value="family_run">family_run</option>
                          <option value="whack_a_copper">whack_a_copper</option>
                          <option value="minesweeper">minesweeper (weekly only)</option>
                          <option value="battleships">battleships (weekly only)</option>
                          <option value="the_getaway">the_getaway (weekly only)</option>
                          <option value="pool_8ball">pool_8ball (weekly only)</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          value={minigameLbAddScore}
                          onChange={(e) => setMinigameLbAddScore(e.target.value)}
                          className="w-24 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs"
                        />
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={minigameLbAddWeekly} onChange={(e) => setMinigameLbAddWeekly(e.target.checked)} />
                          Weekly points
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={minigameLbAddPerGame} onChange={(e) => setMinigameLbAddPerGame(e.target.checked)} />
                          Per-game row
                        </label>
                        <BtnPrimary type="button" onClick={handleMinigameLbAddPlay} disabled={minigameLbAddLoading || !(formData.targetUsername || '').trim()}>
                          {minigameLbAddLoading ? '…' : 'Add play / score'}
                        </BtnPrimary>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className={`relative rounded-lg overflow-hidden border border-cyan-500/25`}>
                <div className="h-0.5 bg-gradient-to-r from-transparent via-cyan-500/35 to-transparent" />
                <SectionHeader
                  icon={Trophy}
                  title="Main game leaderboards (weekly / top boards)"
                  toolAnchor="mainLbStrip"
                  isCollapsed={collapsed.mainLbStrip}
                  onToggle={() => toggleSection('mainLbStrip')}
                />
                {!collapsed.mainLbStrip && (
                  <div className="p-2 space-y-2 bg-zinc-950/40">
                    <p className="text-[9px] text-mutedForeground font-heading pl-1">
                      Clears inputs for <span className="text-foreground">/leaderboards/top?period=weekly</span> (respect earned, bullets melted, stock profit, booze profit, etc.). Stock/booze: zeros stored profit on rows and adjusts lifetime totals on the user so all-time totals stay consistent.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                      <span className="text-mutedForeground">Scope</span>
                      <select
                        value={mainLbScope}
                        onChange={(e) => setMainLbScope(e.target.value)}
                        className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1 text-xs"
                      >
                        <option value="current">This week (Mon UTC)</option>
                        <option value="all">All history</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px] font-heading rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={mainLbRespect} onChange={(e) => setMainLbRespect(e.target.checked)} />
                        Respect earned (<code className="text-[8px] bg-zinc-800/80 px-1 rounded">respect_events</code>)
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={mainLbMelt} onChange={(e) => setMainLbMelt(e.target.checked)} />
                        Bullets melted (<code className="text-[8px] bg-zinc-800/80 px-1 rounded">melt_events</code>)
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={mainLbStock} onChange={(e) => setMainLbStock(e.target.checked)} />
                        Stock profit (<code className="text-[8px] bg-zinc-800/80 px-1 rounded">profit_points</code> → 0)
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={mainLbBooze} onChange={(e) => setMainLbBooze(e.target.checked)} />
                        Booze run profit (<code className="text-[8px] bg-zinc-800/80 px-1 rounded">economy_events</code> sell)
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400">
                        <input type="checkbox" checked={mainLbKills} onChange={(e) => setMainLbKills(e.target.checked)} />
                        Kills (attack_attempts killed)
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400">
                        <input type="checkbox" checked={mainLbCrimes} onChange={(e) => setMainLbCrimes(e.target.checked)} />
                        Crimes (<code className="text-[8px] bg-zinc-800/80 px-1 rounded">crime_events</code>)
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400">
                        <input type="checkbox" checked={mainLbGta} onChange={(e) => setMainLbGta(e.target.checked)} />
                        GTA (<code className="text-[8px] bg-zinc-800/80 px-1 rounded">gta_events</code>)
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400">
                        <input type="checkbox" checked={mainLbJail} onChange={(e) => setMainLbJail(e.target.checked)} />
                        Jail busts (success)
                      </label>
                    </div>
                    <BtnDanger type="button" onClick={handleMainLeaderboardStrip} disabled={mainLbStripLoading || !(formData.targetUsername || '').trim()}>
                      {mainLbStripLoading ? '…' : 'Strip from main leaderboards'}
                    </BtnDanger>
                    <BtnDanger type="button" onClick={handleResetWeeklyBoozeProfit} disabled={mainLbResetBoozeLoading}>
                      {mainLbResetBoozeLoading ? '…' : 'Reset weekly booze profit (all users)'}
                    </BtnDanger>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div id="admin-referrals" className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel scroll-mt-24`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Users}
          title="Referrals & prereg heal"
          toolAnchor="referralsReport"
          isCollapsed={collapsed.referralsReport}
          onToggle={() => { toggleSection('referralsReport'); if (collapsed.referralsReport && !referralsReport) handleFetchReferralsReport(); }}
        />
        {!collapsed.referralsReport && (
          <div className="p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-primary/15">
              <span className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider w-full sm:w-auto">Quick actions</span>
              <BtnPrimary onClick={handleFetchReferralsReport} disabled={referralsReportLoading}>
                {referralsReportLoading ? '…' : 'Load referral report'}
              </BtnPrimary>
              <BtnSecondary onClick={() => runPreregHeal(true)} disabled={referralsHealLoading}>
                {referralsHealLoading ? '…' : 'Prereg dry run'}
              </BtnSecondary>
              <BtnPrimary onClick={() => runPreregHeal(false)} disabled={referralsHealLoading}>
                {referralsHealLoading ? '…' : 'Prereg apply heal'}
              </BtnPrimary>
              <BtnSecondary type="button" onClick={scrollToReferralRemove}>
                Remove referral (form)
              </BtnSecondary>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading">
              <span className="text-foreground font-bold">Report:</span> who referred whom (referees can have multiple referrers; payouts split the % across them). Pooled earnings per referrer. Optional filter by referrer username. Use <span className="text-foreground">Unlink</span> on a row to remove that link, or <span className="text-foreground">Remove referral (form)</span> below for bulk / clear-all.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={referralsFilterUsername}
                onChange={(e) => setReferralsFilterUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFetchReferralsReport(); }}
                placeholder="Referrer username (optional)"
                className="flex-1 min-w-[160px] max-w-xs px-2 py-1 rounded border border-input bg-transparent text-[11px]"
              />
              <BtnPrimary onClick={handleFetchReferralsReport} disabled={referralsReportLoading}>
                {referralsReportLoading ? 'Loading…' : 'Load report'}
              </BtnPrimary>
              <BtnSecondary type="button" onClick={() => setReferralsFilterUsername('')}>Clear filter</BtnSecondary>
            </div>
            {referralsReport && (
              <div className="space-y-2 text-[10px] font-heading">
                <div className="text-mutedForeground">
                  Prereg docs with stored ref code: <span className="text-foreground">{referralsReport.preregistrations_with_referral_code_stored ?? 0}</span>
                  {' · '}
                  Total referee links: <span className="text-foreground">{referralsReport.total_referee_links ?? 0}</span>
                </div>
                {referralsReport.note && (
                  <p className="text-[9px] text-zinc-500 italic">{referralsReport.note}</p>
                )}
                <div className="max-h-[480px] overflow-y-auto rounded border border-primary/20 bg-zinc-900/40 divide-y divide-primary/10">
                  {(referralsReport.groups || []).map((g) => (
                    <div key={g.referrer_id} className="p-2 space-y-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <span className="text-primary font-bold">{g.referrer_username}</span>
                          <span className="text-mutedForeground ml-2">({g.referee_count} referees)</span>
                        </div>
                        <div className="text-[9px] text-mutedForeground">
                          cash-like: <span className="text-foreground">{(g.referral_cash_like_total ?? 0).toLocaleString()}</span>
                          {' · '}
                          melt bullets: <span className="text-foreground">{(g.referral_bullets_from_melt ?? 0).toLocaleString()}</span>
                        </div>
                      </div>
                      {g.referral_earnings && (
                        <div className="font-mono text-[9px] text-zinc-400 pl-1">
                          {Object.entries(g.referral_earnings).map(([k, v]) => (
                            <span key={k} className="mr-2">{k.replace('referral_earnings_', '')}: {Number(v).toLocaleString()}</span>
                          ))}
                        </div>
                      )}
                      <div className="pl-2 border-l border-primary/25 space-y-0.5 max-h-32 overflow-y-auto">
                        {(g.referees || []).map((r) => (
                          <div key={r.user_id} className="flex flex-wrap items-center gap-x-2 gap-y-0">
                            <Link to={`/profile/${encodeURIComponent(r.username)}`} className="text-primary hover:underline">{r.username}</Link>
                            <span className="text-mutedForeground">{r.email || '—'}</span>
                            <span className="text-zinc-500">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</span>
                            <button
                              type="button"
                              className="text-[9px] font-heading uppercase tracking-wide px-1.5 py-0.5 rounded border border-destructive/40 text-destructive/90 hover:bg-destructive/10 disabled:opacity-40"
                              disabled={removeReferralRowLoading != null || removeReferralLoading}
                              title="Remove this referee–referrer link only"
                              onClick={() => handleUnlinkRefereeFromReportRow(r.username, g.referrer_username, r.user_id)}
                            >
                              {removeReferralRowLoading === (r.user_id || r.username) ? '…' : 'Unlink'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {(referralsReport.groups || []).length === 0 && (
                  <p className="text-mutedForeground">No referral links found{referralsFilterUsername.trim() ? ' for this referrer' : ''}.</p>
                )}
              </div>
            )}
            <div className="border-t border-primary/20 pt-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">
                <span className="text-foreground font-bold">Prereg heal:</span> backfill <span className="text-foreground">referred_by</span> for accounts where prereg stored a referral code but signup missed it. Use <span className="text-foreground">Prereg dry run</span> first, then <span className="text-foreground">Prereg apply heal</span> (same buttons in the bar above).
              </p>
              <div className="flex flex-wrap items-center gap-2 w-full">
                <BtnSecondary onClick={() => runPreregHeal(true)} disabled={referralsHealLoading}>
                  {referralsHealLoading ? '…' : 'Dry run (preview only)'}
                </BtnSecondary>
                <BtnPrimary onClick={() => runPreregHeal(false)} disabled={referralsHealLoading}>
                  {referralsHealLoading ? '…' : 'Apply heal (write DB)'}
                </BtnPrimary>
              </div>
              {referralsHealResult && (
                <div className="rounded border border-primary/25 bg-primary/5 p-2 text-[10px] font-heading space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-1">
                    <div><span className="text-mutedForeground">Users matched:</span> {referralsHealResult.users_matched ?? '—'}</div>
                    <div><span className="text-mutedForeground">Eligible:</span> {referralsHealResult.eligible_for_heal ?? '—'}</div>
                    <div><span className="text-mutedForeground">Healed:</span> {referralsHealResult.healed ?? 0}</div>
                    <div><span className="text-mutedForeground">Rows in list:</span> {(referralsHealResult.dry_run ? (referralsHealResult.would_heal?.length ?? 0) : (referralsHealResult.healed_rows?.length ?? 0))}</div>
                  </div>
                  {(referralsHealResult.detail_truncated ?? 0) > 0 && (
                    <p className="text-[9px] text-amber-400/90">… and {referralsHealResult.detail_truncated} more not listed (raise max_detail_rows on API if needed)</p>
                  )}
                  <div className="text-[9px] text-zinc-500">{referralsHealResult.message}</div>
                  {(referralsHealResult.would_heal?.length > 0 || referralsHealResult.healed_rows?.length > 0) && (
                    <div className="max-h-56 overflow-auto rounded border border-zinc-700/40">
                      <table className="w-full text-left text-[9px] border-collapse">
                        <thead>
                          <tr className="border-b border-zinc-700/50 text-mutedForeground uppercase">
                            <th className="py-1 px-2">Referee</th>
                            <th className="py-1 px-2">Referrer</th>
                            <th className="py-1 px-2">Referrer ID</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(referralsHealResult.dry_run ? referralsHealResult.would_heal : referralsHealResult.healed_rows)?.map((row, i) => (
                            <tr key={`${row.referee_id}-${i}`} className="border-b border-zinc-800/50">
                              <td className="py-1 px-2 text-foreground">{row.referee_username ?? row.referee_id}</td>
                              <td className="py-1 px-2 text-primary">{row.referrer_username ?? '—'}</td>
                              <td className="py-1 px-2 font-mono text-zinc-500">{row.referrer_id ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="border-t border-primary/20 pt-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">
                <span className="text-foreground font-bold">Manual link:</span> adds a referrer to the referee&apos;s list (multiple allowed). With bonuses on, referee top-up matches the normal referred package. Welcome respect applies when this referrer was not already on the list. <span className="text-foreground font-bold">Force</span> replaces the whole list with only the referrer you enter.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={manualReferee}
                  onChange={(e) => setManualReferee(e.target.value)}
                  placeholder="Referee username (new player)"
                  className="flex-1 min-w-[140px] max-w-xs px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
                <input
                  type="text"
                  value={manualReferrer}
                  onChange={(e) => setManualReferrer(e.target.value)}
                  placeholder="Referrer username"
                  className="flex-1 min-w-[140px] max-w-xs px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
              </div>
              <label className="flex items-center gap-2 text-[10px] font-heading text-mutedForeground cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualGrantReferee}
                  onChange={(e) => setManualGrantReferee(e.target.checked)}
                  className="rounded border border-input"
                />
                Grant referee signup bonuses (top-up to full referred package)
              </label>
              <label className="flex items-center gap-2 text-[10px] font-heading text-mutedForeground cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualForce}
                  onChange={(e) => setManualForce(e.target.checked)}
                  className="rounded border border-input"
                />
                Force: replace all referrers with only this one
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-mutedForeground font-heading">Referrer welcome respect (default 500; 0–5000, 0 = off):</span>
                <input
                  type="number"
                  min={0}
                  max={5000}
                  value={manualReferrerRespect}
                  onChange={(e) => setManualReferrerRespect(e.target.value)}
                  className="w-24 px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
                <BtnPrimary onClick={handleManualReferralAssign} disabled={manualLoading}>
                  {manualLoading ? '…' : 'Apply manual link'}
                </BtnPrimary>
                <BtnSecondary type="button" onClick={clearManualReferralForm} disabled={manualLoading}>
                  Clear manual form
                </BtnSecondary>
              </div>
              {manualResult && (
                <div className="rounded border border-primary/25 bg-primary/5 p-2 text-[10px] font-heading space-y-1">
                  <div><span className="text-mutedForeground">Referee:</span> <span className="text-foreground">{manualResult.referee_username}</span> → <span className="text-primary">{manualResult.referrer_username}</span></div>
                  <div><span className="text-mutedForeground">Referee signup bonuses:</span> {manualResult.referee_signup_bonuses_applied ? 'Yes' : 'No'}</div>
                  <div><span className="text-mutedForeground">Referrer welcome respect:</span> {manualResult.referrer_welcome_respect_applied ? `${manualResult.referrer_welcome_respect_amount ?? 0} applied` : 'Not applied (already linked / duplicate, or set to 0)'}</div>
                  {manualResult.replaced_existing_referrer && <div className="text-amber-400 text-[9px]">Replaced entire referrer list with this single link.</div>}
                </div>
              )}
            </div>
            <div id="admin-referral-remove" className="border-t border-primary/20 pt-3 space-y-2 scroll-mt-24">
              <p className="text-[10px] text-mutedForeground font-heading">
                <span className="text-foreground font-bold">Remove link:</span> clears <span className="text-foreground">referred_by</span> on the referee. Leave referrer blank to remove <span className="text-foreground">all</span> referrers; or enter a referrer username to remove only that one (keeps others). Does not claw back cash, bullets, tokens, or referrer lifetime <span className="text-foreground">referral_earnings_*</span>.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={removeRefereeUsername}
                  onChange={(e) => setRemoveRefereeUsername(e.target.value)}
                  placeholder="Referee username (unlink this account)"
                  className="flex-1 min-w-[140px] max-w-xs px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
                <input
                  type="text"
                  value={removeReferrerUsername}
                  onChange={(e) => setRemoveReferrerUsername(e.target.value)}
                  placeholder="Referrer to remove (optional)"
                  className="flex-1 min-w-[140px] max-w-xs px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <BtnDanger onClick={handleManualReferralRemove} disabled={removeReferralLoading}>
                  {removeReferralLoading ? '…' : 'Remove referral link(s)'}
                </BtnDanger>
                <BtnSecondary type="button" onClick={clearRemoveReferralForm} disabled={removeReferralLoading}>
                  Clear remove form
                </BtnSecondary>
              </div>
              {removeReferralResult && (
                <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-[10px] font-heading space-y-1">
                  <div><span className="text-mutedForeground">Referee:</span> <span className="text-foreground">{removeReferralResult.referee_username}</span></div>
                  <div><span className="text-mutedForeground">Cleared all:</span> {removeReferralResult.cleared_all ? 'Yes' : 'No'}</div>
                  <div><span className="text-mutedForeground">Removed referrer id(s):</span> <span className="font-mono text-zinc-400">{(removeReferralResult.removed_referrer_ids || []).join(', ') || '—'}</span></div>
                  <div><span className="text-mutedForeground">Remaining links:</span> <span className="font-mono text-zinc-400">{(removeReferralResult.referred_by_remaining || []).length ? (removeReferralResult.referred_by_remaining || []).join(', ') : 'none'}</span></div>
                </div>
              )}
            </div>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Activity}
          title="System Health"
          badge={systemHealth ? <span className={`text-[10px] font-heading ${systemHealth.status === 'healthy' ? 'text-emerald-400' : 'text-amber-400'}`}>{systemHealth.status}</span> : null}
          toolAnchor="systemHealth"
          isCollapsed={collapsed.systemHealth}
          onToggle={() => { toggleSection('systemHealth'); if (collapsed.systemHealth && !systemHealth) handleFetchSystemHealth(); }}
        />
        {!collapsed.systemHealth && (
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <BtnPrimary onClick={handleFetchSystemHealth} disabled={systemHealthLoading}>{systemHealthLoading ? 'Loading...' : 'Refresh'}</BtnPrimary>
            </div>
            {systemHealth && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-heading">
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                  <div className="text-mutedForeground uppercase">Status</div>
                  <div className={`font-bold ${systemHealth.status === 'healthy' ? 'text-emerald-400' : 'text-amber-400'}`}>{systemHealth.status}</div>
                </div>
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                  <div className="text-mutedForeground uppercase">Users (alive)</div>
                  <div className="font-bold text-foreground">{(systemHealth.users_alive ?? 0).toLocaleString()} / {(systemHealth.users_total ?? 0).toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                  <div className="text-mutedForeground uppercase">Online (5m)</div>
                  <div className="font-bold text-primary">{(systemHealth.users_online ?? 0).toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                  <div className="text-mutedForeground uppercase">Cars</div>
                  <div className="font-bold text-foreground">{(systemHealth.cars ?? 0).toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                  <div className="text-mutedForeground uppercase">Families</div>
                  <div className="font-bold text-foreground">{(systemHealth.families ?? 0).toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                  <div className="text-mutedForeground uppercase">Unresolved Flags</div>
                  <div className={`font-bold ${(systemHealth.unresolved_flags ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{systemHealth.unresolved_flags ?? 0}</div>
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={UserCog}
          title="Player Actions"
          toolAnchor="player"
          isCollapsed={collapsed.player}
          onToggle={() => toggleSection('player')}
        />
        {!collapsed.player && (
          <div className="p-2 space-y-1">
            <ActionRow icon={Gift} label="Who has exclusive loot" description="Cars (car20/car21), Colt Monitor, Steel Vest 1922, Speakeasy">
              <BtnPrimary onClick={handleFetchExclusiveLoot} disabled={exclusiveLootLoading}>{exclusiveLootLoading ? '...' : 'View'}</BtnPrimary>
            </ActionRow>
            {exclusiveLootOwners && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] font-heading space-y-1 max-h-64 overflow-y-auto">
                <div className="font-bold text-primary mb-1">Exclusive loot owners ({exclusiveLootOwners.length})</div>
                {exclusiveLootOwners.map((o, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5 border-b border-primary/10 last:border-0">
                    <Link to={`/profile/${encodeURIComponent(o.username)}`} className="text-primary hover:underline font-bold">{o.username}</Link>
                    <span className="text-mutedForeground">{o.items?.map((it) => `${it.item} (${it.category})`).join(', ') ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
            <ActionRow icon={User} label="View registration info" description="Email, username, created at, IPs for target user">
              <BtnPrimary onClick={handleViewRegistration} disabled={viewRegistrationLoading}>{viewRegistrationLoading ? '...' : 'View'}</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Shield} label="User profile & dossier" description="Open user's profile and staff dossier (Details panel opens there, not in Admin)">
              <Link
                to={(formData.targetUsername || '').trim() ? `/account/profile/${encodeURIComponent((formData.targetUsername || '').trim())}?details=1` : '#'}
                className={`inline-block bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 font-heading touch-manipulation ${(formData.targetUsername || '').trim() ? '' : 'pointer-events-none opacity-50'}`}
              >
                Open profile
              </Link>
            </ActionRow>
            {!(formData.targetUsername || '').trim() && (
              <p className="text-[9px] text-mutedForeground font-heading pl-6">Enter target username above.</p>
            )}
            {viewRegistrationInfo && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] font-heading space-y-1">
                <div className="font-bold text-primary mb-1">Registration info</div>
                <div><span className="text-mutedForeground">Username:</span> {viewRegistrationInfo.username ?? '—'}</div>
                <div><span className="text-mutedForeground">Email:</span> {viewRegistrationInfo.email ?? '—'}</div>
                <div><span className="text-mutedForeground">User ID:</span> {viewRegistrationInfo.id ?? '—'}</div>
                <div><span className="text-mutedForeground">Created:</span> {viewRegistrationInfo.created_at ? new Date(viewRegistrationInfo.created_at).toLocaleString() : '—'}</div>
                <div><span className="text-mutedForeground">Registration IP:</span> {viewRegistrationInfo.registration_ip || '—'}</div>
                <div><span className="text-mutedForeground">Last login IP:</span> {viewRegistrationInfo.last_login_ip || '—'}</div>
                {viewRegistrationInfo.is_dead && <div className="text-red-400 font-bold">Account is dead</div>}
              </div>
            )}
            <ActionRow icon={AlertTriangle} label="Login 500 diagnosis" description="Inspect user document by email (keys & types). Compare with a working user to find missing/wrong fields.">
              <input
                type="email"
                value={userInspectEmail}
                onChange={(e) => setUserInspectEmail(e.target.value)}
                placeholder="user@example.com"
                className="flex-1 min-w-0 max-w-[200px] px-2 py-1 rounded border border-input bg-transparent text-[11px]"
              />
              <BtnPrimary onClick={handleUserInspect} disabled={userInspectLoading}>{userInspectLoading ? '...' : 'Inspect'}</BtnPrimary>
            </ActionRow>
            {userInspectResult && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] font-heading space-y-2 pl-6">
                <div className="font-bold text-primary">User inspect: {userInspectResult.email}</div>
                {userInspectResult.found ? (
                  <>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <div><span className="text-mutedForeground">Username:</span> {userInspectResult.username ?? '—'}</div>
                      <div><span className="text-mutedForeground">User ID:</span> {userInspectResult.user_id ?? '—'}</div>
                      <div><span className="text-mutedForeground">has_id:</span> <span className={userInspectResult.has_id ? 'text-emerald-400' : 'text-red-400'}>{String(userInspectResult.has_id)}</span></div>
                      <div><span className="text-mutedForeground">id_type:</span> {userInspectResult.id_type ?? '—'}</div>
                      <div><span className="text-mutedForeground">Device:</span> {userInspectResult.last_device_type ?? '—'}</div>
                      {userInspectResult.last_user_agent && (
                        <div className="col-span-2"><span className="text-mutedForeground">User-Agent:</span> <span className="font-mono text-[9px] break-all">{userInspectResult.last_user_agent}</span></div>
                      )}
                    </div>
                    <div><span className="text-mutedForeground">Keys ({userInspectResult.keys?.length ?? 0}):</span> <span className="text-foreground font-mono">{userInspectResult.keys?.join(', ') ?? '—'}</span></div>
                    <div>
                      <span className="text-mutedForeground">Value types:</span>
                      <pre className="mt-1 p-1.5 rounded bg-zinc-900/60 text-[9px] overflow-x-auto max-h-40 overflow-y-auto">{JSON.stringify(userInspectResult.value_types || {}, null, 2)}</pre>
                    </div>
                  </>
                ) : (
                  <div className="text-mutedForeground">{userInspectResult.message ?? 'Not found.'}</div>
                )}
              </div>
            )}
            <div className="pt-1 pl-6">
              <div className="text-[9px] font-heading font-bold uppercase tracking-wider text-mutedForeground">Economy & rewards</div>
            </div>
            <ActionRow icon={UserCog} label="Change Rank">
              {ranks.length > 0 ? (
                <Select value={String(formData.newRank)} onChange={(e) => setFormData((prev) => ({ ...prev, newRank: parseInt(e.target.value) }))}>
                  {ranks.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
                </Select>
              ) : (
                <Input type="number" min="1" max="11" value={formData.newRank} onChange={(e) => setFormData((prev) => ({ ...prev, newRank: parseInt(e.target.value) }))} />
              )}
              <span className="text-[10px] text-zinc-500 font-heading shrink-0">Prestige</span>
              <Select value={String(formData.prestigeLevel ?? 0)} onChange={(e) => setFormData((prev) => ({ ...prev, prestigeLevel: parseInt(e.target.value) }))} className="w-16">
                {[0, 1, 2, 3, 4, 5].map((p) => (
                  <option key={p} value={String(p)}>{p === 0 ? 'None' : `P${p}`}</option>
                ))}
              </Select>
              <BtnPrimary onClick={handleChangeRank}>Set</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Coins} label="Add Points">
              <FormattedNumberInput value={formData.points != null ? String(formData.points) : ''} onChange={(raw) => setFormData((prev) => ({ ...prev, points: raw === '' ? 0 : parseInt(raw, 10) }))} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              <BtnPrimary onClick={handleAddPoints}>Add</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Coins} label="Remove points" description="Deducts up to this amount (clamped to current balance). Uses target username above.">
              <FormattedNumberInput value={formData.pointsRemove != null ? String(formData.pointsRemove) : ''} onChange={(raw) => setFormData((prev) => ({ ...prev, pointsRemove: raw === '' ? 0 : parseInt(raw, 10) }))} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              <BtnDanger onClick={handleRemovePoints}>Remove</BtnDanger>
            </ActionRow>

            <ActionRow icon={Clock} label="Reset crime cooldown timers" description="Clears all crime timers for target username above.">
              <BtnDanger onClick={handleClearUserCrimeTimers} disabled={clearCrimeTimersLoading}>
                {clearCrimeTimersLoading ? 'Clearing…' : 'Clear timers'}
              </BtnDanger>
              <BtnSecondary onClick={handleInspectCrimes} disabled={inspectCrimesLoading}>
                {inspectCrimesLoading ? 'Loading…' : 'Inspect data'}
              </BtnSecondary>
            </ActionRow>
            {inspectCrimesData && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] font-heading space-y-2 pl-6">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-primary">Crime data — {inspectCrimesData.username}</span>
                    <span className="ml-2 text-mutedForeground">{inspectCrimesData.total_rows} rows, {inspectCrimesData.unique_crimes} crimes</span>
                    {inspectCrimesData.total_duplicates > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">{inspectCrimesData.total_duplicates} duplicates!</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {inspectCrimesData.total_duplicates > 0 && (
                      <button onClick={handleDedupCrimes} disabled={dedupCrimesLoading} className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 text-[10px] font-bold">
                        {dedupCrimesLoading ? 'Deduping…' : `Remove ${inspectCrimesData.total_duplicates} duplicates`}
                      </button>
                    )}
                    <button onClick={() => setInspectCrimesData(null)} className="text-mutedForeground hover:text-foreground text-xs">✕</button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead><tr className="text-mutedForeground border-b border-zinc-700/40">
                      <th className="text-left p-1">Crime</th>
                      <th className="text-right p-1">Dupes</th>
                      <th className="text-left p-1">CD Type</th>
                      <th className="text-left p-1">Cooldown Value</th>
                      <th className="text-center p-1">Expired?</th>
                      <th className="text-right p-1">Attempts</th>
                      <th className="text-right p-1">Successes</th>
                      <th className="text-right p-1">Progress</th>
                    </tr></thead>
                    <tbody>
                      {inspectCrimesData.crimes.map((c, i) => (
                        <tr key={i} className={`border-b border-zinc-800/40 ${c.duplicates > 1 ? 'bg-red-500/10' : ''} ${c.cooldown_expired === false ? 'bg-amber-500/10' : ''}`}>
                          <td className="p-1 text-foreground">{c.crime_id}</td>
                          <td className="p-1 text-right">{c.duplicates > 1 ? <span className="text-red-400 font-bold">{c.duplicates}</span> : '1'}</td>
                          <td className="p-1"><span className={`px-1 rounded ${c.cooldown_until_type === 'str' ? 'bg-green-500/20 text-green-400' : c.cooldown_until_type === 'unset' ? 'text-mutedForeground' : 'bg-red-500/20 text-red-400'}`}>{c.cooldown_until_type}</span></td>
                          <td className="p-1 text-mutedForeground font-mono truncate max-w-[180px]">{c.cooldown_until_raw || '—'}</td>
                          <td className="p-1 text-center">{c.cooldown_expired === true ? '✓' : c.cooldown_expired === false ? <span className="text-amber-400 font-bold">ACTIVE</span> : '—'}</td>
                          <td className="p-1 text-right">{c.attempts}</td>
                          <td className="p-1 text-right">{c.successes}</td>
                          <td className="p-1 text-right">{c.progress ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <ActionRow
              icon={BarChart3}
              label="Point sources (full audit)"
              description="Uses target username above. Summarizes store points: provenance lots, ledger, Stripe purchases, player transfers, and key profile counters."
            >
              <BtnSecondary type="button" onClick={handleLoadPointsSources} disabled={pointsSourcesLoading}>
                {pointsSourcesLoading ? 'Loading…' : 'Load breakdown'}
              </BtnSecondary>
            </ActionRow>
            {pointsSourcesReport && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] font-heading space-y-2 pl-6">
                <div className="font-bold text-primary">Point sources — {pointsSourcesReport.user?.username || '?'}</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/40">
                    <div className="text-mutedForeground uppercase text-[9px]">Balance</div>
                    <div className="text-foreground font-bold">{(pointsSourcesReport.user?.points ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/40">
                    <div className="text-mutedForeground uppercase text-[9px]">Lots sum</div>
                    <div className="text-foreground font-bold">{(pointsSourcesReport.lots_remaining_sum ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/40">
                    <div className="text-mutedForeground uppercase text-[9px]">Stripe (completed)</div>
                    <div className="text-foreground font-bold">{(pointsSourcesReport.stripe_purchases_completed?.total_points ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/40">
                    <div className="text-mutedForeground uppercase text-[9px]">Transfers in</div>
                    <div className="text-foreground font-bold">{(pointsSourcesReport.points_transfers_received?.total_points ?? 0).toLocaleString()}</div>
                  </div>
                </div>
                {pointsSourcesReport.balance_matches_lots === false && (
                  <div className="text-amber-400 text-[9px]">
                    Lots total does not match balance (expected when legacy seed has not run or data is mid-migration).
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-1.5 rounded bg-zinc-900/40 border border-zinc-700/30">
                    <div className="text-mutedForeground text-[9px]">Lifetime points spent (store)</div>
                    <div className="text-foreground">{(pointsSourcesReport.user_stats?.lifetime_points_spent ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/40 border border-zinc-700/30">
                    <div className="text-mutedForeground text-[9px]">Redeem codes (points total)</div>
                    <div className="text-foreground">{(pointsSourcesReport.user_stats?.redeem_codes_points_total ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/40 border border-zinc-700/30">
                    <div className="text-mutedForeground text-[9px]">Stock market profit (points)</div>
                    <div className="text-foreground">{(pointsSourcesReport.user_stats?.stock_market_profit_total_points ?? 0).toLocaleString()}</div>
                  </div>
                </div>
                <div className="text-[9px] text-mutedForeground">
                  Transfers out: {(pointsSourcesReport.points_transfers_sent?.total_points ?? 0).toLocaleString()} across {pointsSourcesReport.points_transfers_sent?.transfer_count ?? 0} sends
                </div>
                <div className="overflow-x-auto max-h-48 border border-zinc-700/30 rounded">
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="text-left text-mutedForeground border-b border-zinc-700/40">
                        <th className="p-1 font-heading">Lot origin</th>
                        <th className="p-1 font-heading">Remaining</th>
                        <th className="p-1 font-heading"># lots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pointsSourcesReport.lots_remaining_by_origin || []).map((row, i) => (
                        <tr key={`${row.origin_type}-${i}`} className="border-b border-zinc-800/50">
                          <td className="p-1 font-mono text-emerald-200/90">{String(row.origin_type ?? '—')}</td>
                          <td className="p-1">{(row.remaining_points ?? 0).toLocaleString()}</td>
                          <td className="p-1">{row.lot_count ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <div className="text-[9px] font-bold text-primary mb-0.5">Ledger inflows (+)</div>
                    <div className="overflow-x-auto max-h-36 border border-zinc-700/30 rounded">
                      <table className="w-full text-[9px]">
                        <thead>
                          <tr className="text-left text-mutedForeground border-b border-zinc-700/40">
                            <th className="p-1">Event</th>
                            <th className="p-1">Pts</th>
                            <th className="p-1">#</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(pointsSourcesReport.ledger_inflows_by_event || []).map((row, i) => (
                            <tr key={`in-${i}`} className="border-b border-zinc-800/50">
                              <td className="p-1 font-mono">{String(row.event_type ?? '—')}</td>
                              <td className="p-1">{(row.points ?? 0).toLocaleString()}</td>
                              <td className="p-1">{row.events ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold text-primary mb-0.5">Ledger outflows (−)</div>
                    <div className="overflow-x-auto max-h-36 border border-zinc-700/30 rounded">
                      <table className="w-full text-[9px]">
                        <thead>
                          <tr className="text-left text-mutedForeground border-b border-zinc-700/40">
                            <th className="p-1">Event</th>
                            <th className="p-1">Pts</th>
                            <th className="p-1">#</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(pointsSourcesReport.ledger_outflows_by_event || []).map((row, i) => (
                            <tr key={`out-${i}`} className="border-b border-zinc-800/50">
                              <td className="p-1 font-mono">{String(row.event_type ?? '—')}</td>
                              <td className="p-1">{(row.points ?? 0).toLocaleString()}</td>
                              <td className="p-1">{row.events ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                {(pointsSourcesReport.stripe_purchases_completed?.recent || []).length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold text-primary mb-0.5">Recent completed Stripe credits</div>
                    <div className="overflow-x-auto max-h-32 border border-zinc-700/30 rounded">
                      <table className="w-full text-[9px]">
                        <thead>
                          <tr className="text-left text-mutedForeground border-b border-zinc-700/40">
                            <th className="p-1">Session</th>
                            <th className="p-1">Package</th>
                            <th className="p-1">Pts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(pointsSourcesReport.stripe_purchases_completed.recent || []).map((row, ri) => (
                            <tr key={row.session_id || `stripe-${ri}`} className="border-b border-zinc-800/50">
                              <td className="p-1 font-mono break-all max-w-[140px]">{row.session_id ?? '—'}</td>
                              <td className="p-1">{row.package_id ?? '—'}</td>
                              <td className="p-1">{(row.points ?? 0).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {(pointsSourcesReport.notes || []).length > 0 && (
                  <ul className="list-disc pl-4 text-[9px] text-mutedForeground space-y-0.5">
                    {pointsSourcesReport.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <ActionRow
              icon={Receipt}
              label="Points & respect spend audit"
              description="Ledger outflows (points leaving the account), store purchases by origin (e.g. buy-custom-car), and negative respect_events (store respect spend from deploy forward; admin removes)."
            >
              <BtnSecondary type="button" onClick={handleLoadCurrencySpendAudit} disabled={currencySpendAuditLoading}>
                {currencySpendAuditLoading ? 'Loading…' : 'Load spend audit'}
              </BtnSecondary>
            </ActionRow>
            {currencySpendAuditData && (
              <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2 text-[10px] font-heading space-y-2 pl-6">
                <div className="font-bold text-amber-200/90">
                  Spend audit — {currencySpendAuditData.user?.username || '?'}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/40">
                    <div className="text-mutedForeground uppercase text-[9px]">Points balance</div>
                    <div className="text-foreground font-bold">{(currencySpendAuditData.user?.points ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/40">
                    <div className="text-mutedForeground uppercase text-[9px]">Respect balance</div>
                    <div className="text-foreground font-bold">{(currencySpendAuditData.user?.respect_points ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/40">
                    <div className="text-mutedForeground uppercase text-[9px]">Lifetime points spent</div>
                    <div className="text-foreground font-bold">{(currencySpendAuditData.user?.lifetime_points_spent ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/40">
                    <div className="text-mutedForeground uppercase text-[9px]">Lifetime respect spent</div>
                    <div className="text-foreground font-bold">{(currencySpendAuditData.user?.lifetime_respect_points_spent ?? 0).toLocaleString()}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[9px]">
                  <div className="p-1.5 rounded bg-zinc-900/40 border border-zinc-700/30">
                    <span className="text-mutedForeground">Custom car</span>{' '}
                    <span className="text-foreground font-mono">{currencySpendAuditData.user?.custom_car_name || '—'}</span>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/40 border border-zinc-700/30">
                    <span className="text-mutedForeground">Auto Rank</span>{' '}
                    <span className="text-foreground">{currencySpendAuditData.user?.auto_rank_purchased ? 'yes' : 'no'}</span>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/40 border border-zinc-700/30">
                    <span className="text-mutedForeground">Silencer / Anti-snitch</span>{' '}
                    <span className="text-foreground">
                      {currencySpendAuditData.user?.has_silencer ? 'S' : '—'} / {currencySpendAuditData.user?.anti_snitch ? 'A' : '—'}
                    </span>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/40 border border-zinc-700/30">
                    <span className="text-mutedForeground">Garage batch limit</span>{' '}
                    <span className="text-foreground">{currencySpendAuditData.user?.garage_batch_limit ?? '—'}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <div className="text-[9px] font-bold text-amber-200/80 mb-0.5">Point outflows by ledger type</div>
                    <div className="overflow-x-auto max-h-40 border border-zinc-700/30 rounded">
                      <table className="w-full text-[9px]">
                        <thead>
                          <tr className="text-left text-mutedForeground border-b border-zinc-700/40">
                            <th className="p-1">Event</th>
                            <th className="p-1">Pts (sum)</th>
                            <th className="p-1">#</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(currencySpendAuditData.points_spent_by_ledger_event_type || []).map((row, i) => (
                            <tr key={`spend-${row.event_type}-${i}`} className="border-b border-zinc-800/50">
                              <td className="p-1 font-mono">{String(row.event_type ?? '—')}</td>
                              <td className="p-1">{(row.total_points ?? 0).toLocaleString()}</td>
                              <td className="p-1">{row.events ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold text-amber-200/80 mb-0.5">Store (points) by origin_ref</div>
                    <div className="overflow-x-auto max-h-40 border border-zinc-700/30 rounded">
                      <table className="w-full text-[9px]">
                        <thead>
                          <tr className="text-left text-mutedForeground border-b border-zinc-700/40">
                            <th className="p-1">origin_ref</th>
                            <th className="p-1">Pts</th>
                            <th className="p-1">#</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(currencySpendAuditData.store_point_spends_by_origin_ref || []).map((row, i) => (
                            <tr key={`store-${row.origin_ref}-${i}`} className="border-b border-zinc-800/50">
                              <td className="p-1 font-mono break-all">{String(row.origin_ref ?? '—')}</td>
                              <td className="p-1">{(row.total_points_spent ?? 0).toLocaleString()}</td>
                              <td className="p-1">{row.purchase_count ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-amber-200/80 mb-0.5">Respect spent (negative rows)</div>
                  <div className="overflow-x-auto max-h-32 border border-zinc-700/30 rounded">
                    <table className="w-full text-[9px]">
                      <thead>
                        <tr className="text-left text-mutedForeground border-b border-zinc-700/40">
                          <th className="p-1">Time</th>
                          <th className="p-1">Source</th>
                          <th className="p-1">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(currencySpendAuditData.respect_spent_events || []).length === 0 ? (
                          <tr>
                            <td className="p-2 text-mutedForeground" colSpan={3}>
                              None logged (older store respect spend may only be in lifetime total).
                            </td>
                          </tr>
                        ) : (
                          (currencySpendAuditData.respect_spent_events || []).map((ev, idx) => (
                            <tr key={`r-spend-${idx}`} className="border-b border-zinc-800/50">
                              <td className="p-1 text-mutedForeground whitespace-nowrap">
                                {ev.at ? new Date(ev.at).toLocaleString() : '—'}
                              </td>
                              <td className="p-1 font-mono break-all">{ev.source ?? '—'}</td>
                              <td className="p-1 text-right font-bold">{Number(ev.amount ?? 0).toLocaleString()}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-amber-200/80 mb-0.5">Recent point ledger outflows</div>
                  <div className="overflow-x-auto max-h-48 border border-zinc-700/30 rounded">
                    <table className="w-full text-[9px]">
                      <thead>
                        <tr className="text-left text-mutedForeground border-b border-zinc-700/40">
                          <th className="p-1">Time</th>
                          <th className="p-1">Type</th>
                          <th className="p-1">Pts</th>
                          <th className="p-1">origin_ref</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(currencySpendAuditData.points_ledger_recent || []).map((row, i) => (
                          <tr key={row.id || `ledger-${i}`} className="border-b border-zinc-800/50">
                            <td className="p-1 text-mutedForeground whitespace-nowrap">
                              {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                            </td>
                            <td className="p-1 font-mono">{row.event_type ?? '—'}</td>
                            <td className="p-1">{(row.points ?? 0).toLocaleString()}</td>
                            <td className="p-1 font-mono break-all max-w-[140px]">{row.origin_ref ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {(currencySpendAuditData.notes || []).length > 0 && (
                  <ul className="list-disc pl-4 text-[9px] text-mutedForeground space-y-0.5">
                    {currencySpendAuditData.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <ActionRow icon={Award} label="Add respect points" description="Grants respect to the target user. Logged as admin_add. Uses target username above.">
              <FormattedNumberInput value={formData.respectAdd != null ? String(formData.respectAdd) : ''} onChange={(raw) => setFormData((prev) => ({ ...prev, respectAdd: raw === '' ? 0 : parseInt(raw, 10) }))} className="flex h-9 w-24 min-w-[5rem] rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              <BtnPrimary onClick={handleAddRespectPoints}>Add</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Award} label="Remove respect points" description="Deducts up to this amount (clamped to current balance). Uses target username above.">
              <FormattedNumberInput value={formData.respectRemove != null ? String(formData.respectRemove) : ''} onChange={(raw) => setFormData((prev) => ({ ...prev, respectRemove: raw === '' ? 0 : parseInt(raw, 10) }))} className="flex h-9 w-24 min-w-[5rem] rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              <BtnDanger onClick={handleRemoveRespectPoints}>Remove</BtnDanger>
            </ActionRow>

            <ActionRow icon={Zap} label="Add Tokens" description="Give consumable tokens (crime XP, GTA XP, melt, etc.)">
              <Select value={formData.tokenType} onChange={(e) => setFormData((prev) => ({ ...prev, tokenType: e.target.value }))}>
                <option value="xp_crimes">Crime XP</option>
                <option value="xp_gta">GTA XP</option>
                <option value="auto_rank_2h">Auto Rank (2h)</option>
                <option value="melt">Melt Speed</option>
                <option value="oc_reduced">OC Reduced</option>
                <option value="booze">Booze</option>
                <option value="racket">Racket</option>
                <option value="travel">Travel</option>
                <option value="properties">Properties</option>
                <option value="jailbust_bonus">Jailbust Bonus</option>
              </Select>
              <Input type="number" min="1" value={formData.tokenAmount} onChange={(e) => setFormData((prev) => ({ ...prev, tokenAmount: parseInt(e.target.value) || 1 }))} className="w-20" />
              <BtnPrimary onClick={handleAddTokens}>Give</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Layers} label="Clear pool cue upgrades" description="8-ball minigame: reset power/curve/luck/aim/control on every owned cue (target username above)">
              <BtnDanger onClick={handlePoolClearCueUpgrades}>Clear all</BtnDanger>
            </ActionRow>

            <ActionRow
              icon={Gift}
              label="Grant Game Pass"
              description="Grants an unactivated Game Pass token; user activates it in My Inventory. Remove clears all pass state so they can buy again."
            >
              <Input
                type="number"
                min="1"
                value={String(formData.gamePassTierSnapshot ?? '')}
                onChange={(e) => setFormData((prev) => ({ ...prev, gamePassTierSnapshot: e.target.value ? parseInt(e.target.value, 10) || '' : '' }))}
                className="w-28"
                placeholder="Tier snapshot (optional)"
              />
              <BtnPrimary onClick={handleGrantGamePass}>Add</BtnPrimary>
              <BtnDanger onClick={handleRemoveGamePass}>Remove</BtnDanger>
            </ActionRow>

            <ActionRow
              icon={Gift}
              label="Reconcile Game Pass tiers"
              description="Grants missing VIP micro-tier rewards for their current rank XP (same as login). Rewind cursor (e.g. 0) first if tier advanced with no payout, then Reconcile."
            >
              <Input
                type="number"
                min={0}
                value={String(formData.gamePassRewindCursor ?? '')}
                onChange={(e) => setFormData((prev) => ({ ...prev, gamePassRewindCursor: e.target.value }))}
                className="w-16"
                placeholder="0"
                title="Optional: set last granted micro tier before reconcile (0 = re-run from start)"
              />
              <BtnPrimary onClick={() => handleReconcileGamePassTiers(false)}>Reconcile</BtnPrimary>
              <BtnSecondary onClick={() => handleReconcileGamePassTiers(true)}>Ignore expiry</BtnSecondary>
              <BtnDanger onClick={handleForceGrantGamePassRewards}>Force grant rewards</BtnDanger>
            </ActionRow>

            <div id="admin-game-pass-inspector" className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 space-y-2 scroll-mt-24">
              <div className="flex flex-wrap items-center gap-2">
                <Eye size={14} className="text-violet-300 shrink-0" />
                <span className="text-[10px] font-heading font-bold text-violet-300 uppercase tracking-wider">Game Pass inspector</span>
              </div>
              <p className="text-[9px] text-mutedForeground font-heading">
                Lists users with any Game Pass–related DB state. Stripe purchase times come from completed <span className="font-mono">rank_xp_pass_499</span> transactions; points buys have no row—detail view shows <span className="font-mono">purchase_source</span> and an optional estimate from token expiry.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={gamePassInspectQuery}
                  onChange={(e) => setGamePassInspectQuery(e.target.value)}
                  placeholder="Filter username (substring)"
                  className="flex-1 min-w-[140px] max-w-xs px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
                <BtnPrimary type="button" onClick={loadGamePassInspectList} disabled={gamePassInspectLoading}>
                  {gamePassInspectLoading ? '…' : 'Load users with Game Pass state'}
                </BtnPrimary>
                <BtnSecondary type="button" onClick={() => loadGamePassInspectUser()} disabled={gamePassInspectDetailLoading}>
                  {gamePassInspectDetailLoading ? '…' : 'Inspect target'}
                </BtnSecondary>
              </div>
              {gamePassInspectList && (
                <div className="space-y-1">
                  <div className="text-[9px] text-mutedForeground font-heading">
                    {(gamePassInspectList.total ?? 0).toLocaleString()} match(es); showing {(gamePassInspectList.items || []).length} (limit {(gamePassInspectList.limit ?? 100)})
                  </div>
                  <div className="overflow-x-auto max-h-64 border border-violet-500/20 rounded">
                    <table className="w-full text-left text-[9px] border-collapse min-w-[720px]">
                      <thead>
                        <tr className="text-mutedForeground border-b border-zinc-700/50 sticky top-0 bg-zinc-900/95">
                          <th className="p-1 font-heading">User</th>
                          <th className="p-1 font-heading text-right">Rank XP</th>
                          <th className="p-1 font-heading text-right">Micro</th>
                          <th className="p-1 font-heading text-right">Tok</th>
                          <th className="p-1 font-heading">Expires</th>
                          <th className="p-1 font-heading">VIP</th>
                          <th className="p-1 font-heading text-right">Last Δ</th>
                          <th className="p-1 font-heading text-right">Free</th>
                          <th className="p-1 font-heading">Status</th>
                          <th className="p-1 font-heading">Stripe entitled</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(gamePassInspectList.items || []).map((row) => (
                          <tr
                            key={row.id || row.username}
                            className="border-b border-zinc-800/50 cursor-pointer hover:bg-violet-500/10"
                            onClick={() => loadGamePassInspectUser(row.username)}
                            title="Click to inspect"
                          >
                            <td className="p-1 font-bold text-foreground">{row.username ?? '—'}</td>
                            <td className="p-1 text-right font-mono">{(row.rank_points ?? 0).toLocaleString()}</td>
                            <td className="p-1 text-right font-mono">{row.current_micro_tier ?? '—'}</td>
                            <td className="p-1 text-right font-mono">{row.rank_xp_pass_tokens ?? 0}</td>
                            <td className="p-1 font-mono text-[8px] max-w-[100px] truncate" title={row.rank_xp_pass_token_expires_at || ''}>
                              {row.rank_xp_pass_token_expires_at ? String(row.rank_xp_pass_token_expires_at).slice(0, 16) : '—'}
                            </td>
                            <td className="p-1">{row.rank_xp_pass_rewards_granted ? 'yes' : 'no'}</td>
                            <td className="p-1 text-right font-mono">{row.rank_xp_pass_last_granted_micro_tier ?? 0}</td>
                            <td className="p-1 text-right font-mono">{row.rank_xp_pass_free_last_micro_tier_granted ?? 0}</td>
                            <td className="p-1 font-mono text-violet-200/90">{row.game_pass_status ?? '—'}</td>
                            <td className="p-1 font-mono text-[8px] max-w-[120px] truncate" title={row.last_stripe_pass_entitled_at || ''}>
                              {row.last_stripe_pass_entitled_at
                                ? new Date(row.last_stripe_pass_entitled_at).toLocaleString()
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {gamePassInspectDetail && (
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2 space-y-1">
                  <div className="text-[9px] font-heading font-bold text-violet-300 uppercase tracking-wider flex items-center justify-between gap-2">
                    <span>Detail — {gamePassInspectDetail.user?.username ?? formData.targetUsername}</span>
                    <button type="button" className="text-mutedForeground hover:text-foreground text-[10px]" onClick={() => setGamePassInspectDetail(null)}>Clear</button>
                  </div>
                  <pre className="text-[9px] font-mono whitespace-pre-wrap break-words max-h-80 overflow-y-auto text-zinc-200/90">
                    {JSON.stringify(gamePassInspectDetail, null, 2)}
                  </pre>
                </div>
              )}

              <div className="border-t border-violet-500/20 pt-2 space-y-2">
                <div className="text-[10px] font-heading font-bold text-amber-300 uppercase tracking-wider">Stuck Cursor Detector</div>
                <p className="text-[9px] text-mutedForeground font-heading">
                  Finds VIP users whose reward cursor is ahead of their actual tier progress (rewards won't grant). "Fix all" force-grants missing rewards directly to each stuck user's account.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <BtnPrimary type="button" onClick={() => loadGamePassStuck(false)} disabled={gamePassStuckLoading}>
                    {gamePassStuckLoading ? '...' : 'Scan for stuck users'}
                  </BtnPrimary>
                  {gamePassStuck && gamePassStuck.stuck_count > 0 && (
                    <BtnDanger type="button" onClick={() => { if (window.confirm(`Force-grant rewards for ${gamePassStuck.stuck_count} stuck user(s)? This directly credits cash/tokens/points to their accounts.`)) loadGamePassStuck(true); }} disabled={gamePassStuckLoading}>
                      {gamePassStuckLoading ? '...' : `Fix all ${gamePassStuck.stuck_count} stuck`}
                    </BtnDanger>
                  )}
                </div>
                {gamePassStuck && (
                  <div className="space-y-1">
                    {gamePassStuck.stuck_count === 0 ? (
                      <div className="text-[10px] text-green-400 font-heading">No stuck users found.</div>
                    ) : (
                      <>
                        <div className="text-[10px] text-amber-300 font-heading">
                          {gamePassStuck.stuck_count} stuck user(s) found
                          {gamePassStuck.fixed_count > 0 && <span className="text-green-400 ml-2">({gamePassStuck.fixed_count} fixed)</span>}
                        </div>
                        <div className="overflow-x-auto max-h-64 border border-amber-500/20 rounded">
                          <table className="w-full text-left text-[9px] border-collapse">
                            <thead>
                              <tr className="text-mutedForeground border-b border-zinc-700/50 sticky top-0 bg-zinc-900/95">
                                <th className="px-2 py-1">User</th>
                                <th className="px-2 py-1">Rank Points</th>
                                <th className="px-2 py-1">Actual Tier</th>
                                <th className="px-2 py-1">Cursor At</th>
                                <th className="px-2 py-1">Gap</th>
                                {gamePassStuck.fixed_count > 0 && <th className="px-2 py-1">Credited</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {(gamePassStuck.stuck_users || []).map((u) => (
                                <tr key={u.username} className="border-b border-zinc-800/50 align-top">
                                  <td className="px-2 py-1 font-semibold">{u.username}</td>
                                  <td className="px-2 py-1">{(u.rank_points || 0).toLocaleString()}</td>
                                  <td className="px-2 py-1">{u.current_micro}</td>
                                  <td className="px-2 py-1 text-red-400">{u.last_granted}</td>
                                  <td className="px-2 py-1 text-amber-400">+{u.gap}</td>
                                  {gamePassStuck.fixed_count > 0 && (
                                    <td className="px-2 py-1 text-green-400 text-[8px]">
                                      {u.credited ? Object.entries(u.credited).map(([k,v]) => `${k}: ${v.toLocaleString()}`).join(', ') : u.fix_result || '—'}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div id="admin-deleted-messages" className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 space-y-2 scroll-mt-24">
              <div className="flex flex-wrap items-center gap-2">
                <Eye size={14} className="text-orange-300 shrink-0" />
                <span className="text-[10px] font-heading font-bold text-orange-300 uppercase tracking-wider">Deleted Messages</span>
              </div>
              <p className="text-[9px] text-mutedForeground font-heading">
                View a user's last 100 deleted messages (forum comments, forum topics, game chat, DMs/notifications). Uses the target username above.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={deletedMsgsFilter}
                  onChange={(e) => setDeletedMsgsFilter(e.target.value)}
                  className="px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                >
                  <option value="">All sources</option>
                  <option value="forum_comment">Forum comments</option>
                  <option value="forum_topic">Forum topics</option>
                  <option value="game_chat">Game chat</option>
                  <option value="notification">Notifications / DMs</option>
                </select>
                <BtnPrimary type="button" onClick={loadDeletedMessages} disabled={deletedMsgsLoading}>
                  {deletedMsgsLoading ? '...' : 'Load deleted messages'}
                </BtnPrimary>
              </div>
              {deletedMsgs && (
                <div className="space-y-1">
                  <div className="text-[9px] text-mutedForeground font-heading">
                    {deletedMsgs.username}: {deletedMsgs.count} deleted message(s) found
                  </div>
                  {deletedMsgs.count === 0 ? (
                    <div className="text-[10px] text-green-400 font-heading">No deleted messages in archive.</div>
                  ) : (
                    <div className="overflow-x-auto max-h-80 border border-orange-500/20 rounded">
                      <table className="w-full text-left text-[9px] border-collapse min-w-[600px]">
                        <thead>
                          <tr className="text-mutedForeground border-b border-zinc-700/50 sticky top-0 bg-zinc-900/95">
                            <th className="px-2 py-1">Source</th>
                            <th className="px-2 py-1">Deleted At</th>
                            <th className="px-2 py-1">Deleted By</th>
                            <th className="px-2 py-1">Reason</th>
                            <th className="px-2 py-1 max-w-xs">Content Preview</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(deletedMsgs.messages || []).map((m, i) => (
                            <tr key={i} className="border-b border-zinc-800/50 align-top">
                              <td className="px-2 py-1">
                                <span className={`inline-block px-1 rounded text-[8px] font-bold ${
                                  m.source === 'forum_comment' ? 'bg-blue-500/20 text-blue-300' :
                                  m.source === 'forum_topic' ? 'bg-purple-500/20 text-purple-300' :
                                  m.source === 'game_chat' ? 'bg-green-500/20 text-green-300' :
                                  'bg-zinc-500/20 text-zinc-300'
                                }`}>{m.source}</span>
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">{m.deleted_at ? new Date(m.deleted_at).toLocaleString() : '—'}</td>
                              <td className="px-2 py-1">{m.deleted_by_username || '—'}</td>
                              <td className="px-2 py-1">{m.reason || '—'}</td>
                              <td className="px-2 py-1 max-w-xs truncate" title={m.content_preview}>{m.content_preview || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <ActionRow icon={Award} label="Founding Member" description="Grant or remove Founding Member badge">
              <BtnPrimary onClick={() => handleSetFoundingMember(true)}>Grant</BtnPrimary>
              <BtnDanger onClick={() => handleSetFoundingMember(false)}>Remove</BtnDanger>
            </ActionRow>

            <ActionRow icon={Crosshair} label="Give Bullets">
              <Input type="number" min="1" value={formData.bullets} onChange={(e) => setFormData((prev) => ({ ...prev, bullets: parseInt(e.target.value) }))} />
              <BtnPrimary onClick={handleAddBullets}>Give</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Car} label="Add Car">
              <Select value={formData.carId} onChange={(e) => setFormData((prev) => ({ ...prev, carId: e.target.value }))}>
                {cars.length > 0 ? cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>) : Array.from({ length: 20 }, (_, i) => <option key={i} value={`car${i + 1}`}>Car {i + 1}</option>)}
              </Select>
              <BtnPrimary onClick={handleAddCar}>Add</BtnPrimary>
              <BtnSecondary onClick={() => handleAddRandomCars(1000)} title="Adds 1000 random cars to the target user's garage (bulk insert).">
                +1000 random
              </BtnSecondary>
            </ActionRow>

            <ActionRow icon={Gift} label="Give Loot Box Pieces" description="Add pieces for Loot Box (100 = 1 open)">
              <Input type="number" min="0" value={formData.lootPieces} onChange={(e) => setFormData((prev) => ({ ...prev, lootPieces: parseInt(e.target.value, 10) || 0 }))} />
              <BtnPrimary onClick={handleAddLootPieces}>Give</BtnPrimary>
            </ActionRow>

            <div className="pt-1 pl-6">
              <div className="text-[9px] font-heading font-bold uppercase tracking-wider text-mutedForeground">Account access</div>
            </div>
            <ActionRow icon={Bot} label="Auto Rank" description="Give or remove auto rank for the target user">
              <button type="button" onClick={handleGiveAutoRank} className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30">Give</button>
              <button type="button" onClick={handleRemoveAutoRank} className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border bg-zinc-700/60 border-zinc-500/40 text-zinc-300 hover:bg-zinc-600">Remove</button>
            </ActionRow>
            <ActionRow icon={Mail} label="Change Email" description="Set a new email for the target user">
              <Input type="email" value={formData.adminNewEmail} onChange={(e) => setFormData((prev) => ({ ...prev, adminNewEmail: e.target.value }))} placeholder="new@email.com" className="flex-1 min-w-0 text-[11px]" />
              <BtnPrimary onClick={handleChangeEmail}>Set</BtnPrimary>
            </ActionRow>
            <ActionRow icon={LogOut} label="Log Out User" description="Invalidate all sessions; they must log in again">
              <BtnPrimary onClick={handleLogOutUser}>Log out</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Users} label="Sessions" description="View and revoke individual sessions (IP, device, last used)">
              <BtnPrimary onClick={handleLoadUserSessions} disabled={adminUserSessionsLoading}>
                {adminUserSessionsLoading ? '...' : 'View sessions'}
              </BtnPrimary>
              <button
                type="button"
                onClick={handleRevokeOldUserSessions}
                disabled={revokeOldUserSessionsLoading || !(formData.targetUsername || '').trim()}
                className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
              >
                {revokeOldUserSessionsLoading ? '...' : 'Log out >24h'}
              </button>
            </ActionRow>
            {adminUserSessions && (
              <div className="pl-6 pr-2 py-2 space-y-1 border-l-2 border-primary/20 ml-1">
                <div className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider mb-1">
                  {adminUserSessions.length ? `${adminUserSessions.length} session(s)` : 'No sessions'}
                </div>
                {adminUserSessions.length === 0 ? (
                  <div className="text-[10px] text-mutedForeground">No sessions (or legacy token).</div>
                ) : (
                  adminUserSessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-1.5 px-2 rounded text-[10px] font-heading bg-zinc-800/50"
                    >
                      <span className="text-foreground">{s.ip || '—'}</span>
                      <span className="text-mutedForeground">{s.device_type || '—'}</span>
                      <span className="text-mutedForeground">
                        Last used: {s.last_used_at ? new Date(s.last_used_at).toLocaleString() : '—'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAdminRevokeSession(s.id)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-heading uppercase border border-amber-500/40 text-amber-400 hover:bg-amber-500/20"
                      >
                        <LogOut size={10} />
                        Revoke
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
            <ActionRow icon={KeyRound} label="Set Password" description="Set a new password (min 6 chars); user is logged out">
              <Input type="password" value={formData.adminNewPassword} onChange={(e) => setFormData((prev) => ({ ...prev, adminNewPassword: e.target.value }))} placeholder="New password" className="flex-1 min-w-0 text-[11px]" autoComplete="off" />
              <BtnPrimary onClick={handleSetPassword}>Set</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Lock} label="Clear Login Lockout" description="Remove lockout so they can try logging in again">
              <BtnPrimary onClick={handleClearLoginLockout}>Clear</BtnPrimary>
            </ActionRow>
          </div>
        )}
        </div>
      </section>
      )}
          </>
          )}

      {activeCategoryId === 'admin-operations' && (isAdmin || isModerator) && (
      <section id="admin-moderation" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Lock size={12} />
          Moderation
        </h2>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Lock}
            title="Player enforcement"
            badge={lockedAccounts.length > 0 ? <span className="text-[10px] font-heading text-amber-400">{lockedAccounts.length} locked</span> : null}
            toolAnchor="moderationPlayer"
            isCollapsed={collapsed.moderationPlayer}
            onToggle={() => toggleSection('moderationPlayer')}
          />
          {!collapsed.moderationPlayer && (
            <div className="p-2 space-y-1">
              <ActionRow icon={User} label="Target username" description="User to lock, unlock, modkill, or revive">
                <input
                  type="text"
                  value={formData.targetUsername}
                  onChange={(e) => setFormData((prev) => ({ ...prev, targetUsername: e.target.value }))}
                  placeholder="Username"
                  className="flex-1 min-w-0 max-w-[220px] px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
                />
              </ActionRow>
              <ActionRow icon={Lock} label="Lock player (investigation)" description="User can only access /locked page and submit one comment until unlocked" color="text-red-400">
                <BtnDanger onClick={handleLockPlayer}>Lock</BtnDanger>
              </ActionRow>
              <ActionRow icon={Lock} label="Unlock account" description="Restore access after investigation">
                <BtnPrimary onClick={() => handleUnlockAccount()}>Unlock</BtnPrimary>
              </ActionRow>
              <ActionRow icon={Skull} label="Modkill" description="Permanently kill the target account. They cannot log in until revived." color="text-red-400">
                <BtnDanger onClick={handleKillPlayer}>Kill</BtnDanger>
              </ActionRow>
              <ActionRow icon={Zap} label="Revive" description="Restore a dead or modkilled account so they can log in again">
                <BtnPrimary onClick={handleRevivePlayer}>Revive</BtnPrimary>
              </ActionRow>
              {isAdmin && (
                <ActionRow icon={Lock} label="Test lock (60s)" description="Lock yourself for 60 seconds to test the locked page">
                  <button type="button" onClick={handleTestLockSelf} className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30">
                    Test lock
                  </button>
                </ActionRow>
              )}
              <ActionRow icon={Lock} label="Locked accounts" description="Users under investigation and their comment">
                <button type="button" onClick={fetchLockedAccounts} disabled={lockedAccountsLoading} className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border bg-zinc-700/60 border-zinc-500/40 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50">
                  {lockedAccountsLoading ? '...' : 'Refresh'}
                </button>
              </ActionRow>
              {lockedAccounts.length > 0 && (
                <div className="mt-1 pl-6 space-y-2 border-l-2 border-amber-500/30">
                  {lockedAccounts.map((u) => (
                    <div key={u.username} className="text-[10px] font-heading rounded border border-zinc-600/50 bg-zinc-800/30 p-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-bold text-amber-400">{u.username}</span>
                        <button type="button" onClick={() => handleUnlockAccount(u.username)} className="px-1.5 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">Unlock</button>
                      </div>
                      {u.account_locked_at && <div className="text-zinc-500 mt-0.5">Locked: {new Date(u.account_locked_at).toLocaleString()}</div>}
                      {u.account_locked_comment ? <div className="mt-1 text-foreground whitespace-pre-wrap">{u.account_locked_comment}</div> : <div className="mt-1 text-zinc-500 italic">No comment yet.</div>}
                      {u.account_locked_comment_at && <div className="text-zinc-500 text-[9px]">Submitted: {new Date(u.account_locked_comment_at).toLocaleString()}</div>}
                      {u.account_locked_admin_message && (
                        <div className="mt-2 pt-2 border-t border-zinc-600/50">
                          <span className="text-primary font-bold">Staff message:</span>
                          <div className="text-foreground whitespace-pre-wrap mt-0.5">{u.account_locked_admin_message}</div>
                          {u.account_locked_admin_message_at && <div className="text-zinc-500 text-[9px]">{new Date(u.account_locked_admin_message_at).toLocaleString()}</div>}
                        </div>
                      )}
                      {u.account_locked_user_reply && (
                        <div className="mt-1">
                          <span className="text-emerald-400 font-bold">Their reply:</span>
                          <div className="text-foreground whitespace-pre-wrap mt-0.5">{u.account_locked_user_reply}</div>
                          {u.account_locked_user_reply_at && <div className="text-zinc-500 text-[9px]">{new Date(u.account_locked_user_reply_at).toLocaleString()}</div>}
                        </div>
                      )}
                      <div className="mt-2 pt-2 border-t border-zinc-600/50">
                        <textarea
                          value={lockedMessageByUser[u.username] ?? ''}
                          onChange={(e) => setLockedMessageByUser((prev) => ({ ...prev, [u.username]: e.target.value }))}
                          placeholder="Leave message for user (they can reply once)"
                          rows={2}
                          className="w-full px-2 py-1 rounded border border-zinc-600 bg-zinc-800/50 text-[10px] font-heading placeholder:text-zinc-500 focus:border-primary/50 focus:outline-none resize-y"
                          maxLength={2000}
                          disabled={sendingMessageTo === u.username}
                        />
                        <button type="button" onClick={() => handleSendLockedMessage(u.username)} disabled={sendingMessageTo === u.username || !(lockedMessageByUser[u.username] || '').trim()} className="mt-1 px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed">
                          {sendingMessageTo === u.username ? 'Sending...' : 'Send message'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Lock}
            title="Page locks"
            badge={Object.keys(pageLocks).length > 0 ? <span className="text-[10px] font-heading text-amber-400">{Object.keys(pageLocks).length} locked</span> : null}
            toolAnchor="moderationPageLocks"
            isCollapsed={collapsed.moderationPageLocks}
            onToggle={() => { toggleSection('moderationPageLocks'); if (collapsed.moderationPageLocks) fetchPageLocks(); }}
          />
          {!collapsed.moderationPageLocks && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground">When a page is locked, users see &quot;Down for maintenance&quot; (or your message) and cannot access it. Admins can still access.</p>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2">
                <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wider">Lock buying points (Points tab only) until</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="datetime-local" value={pageLockUnlockAt} onChange={(e) => setPageLockUnlockAt(e.target.value)} className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs font-mono" />
                  <BtnPrimary onClick={() => handlePageLockToggle('/store/points', true, pageLockUnlockAt ? `Points purchase closed until ${new Date(pageLockUnlockAt).toLocaleString()}` : 'Points purchase temporarily unavailable', pageLockUnlockAt ? new Date(pageLockUnlockAt).toISOString() : null)} disabled={pageLockSaving || !pageLockUnlockAt}>Lock until date</BtnPrimary>
                  {pageLocks['/store/points'] && (
                    <BtnSecondary onClick={() => handlePageLockToggle('/store/points', false)} disabled={pageLockSaving}>Unlock now</BtnSecondary>
                  )}
                </div>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {['/dashboard', '/game/users-online', '/bank', '/stock-market', '/stats', '/jail', '/organised-crime', '/crimes', '/gta', '/attack', '/hitlist', '/families', '/casino', '/store', '/store/points', '/forum', '/inbox', '/help-desk', '/profile'].map((path) => {
                  const entry = pageLocks[path];
                  const isLocked = !!entry;
                  const msg = typeof entry === 'object' ? (entry?.message ?? '') : (entry || '');
                  return (
                    <div key={path} className="flex flex-wrap items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/30 border border-transparent hover:border-primary/20">
                      <span className="text-[11px] font-heading font-mono min-w-[120px]">{path}</span>
                      {isLocked && <span className="text-[10px] text-mutedForeground truncate max-w-[180px]" title={msg}>{msg || 'Down for maintenance'}</span>}
                      <div className="flex gap-1 ml-auto">
                        {isLocked ? (
                          <BtnSecondary onClick={() => handlePageLockToggle(path, false)} disabled={pageLockSaving}>Unlock</BtnSecondary>
                        ) : (
                          <BtnPrimary onClick={() => handlePageLockToggle(path, true, pageLockMessage)} disabled={pageLockSaving}>Lock</BtnPrimary>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="pt-2 border-t border-white/10">
                <p className="text-[10px] font-heading font-bold text-primary mb-2">Custom path</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="text" value={pageLockPath} onChange={(e) => setPageLockPath(e.target.value)} placeholder="/any/path" className="w-40 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs font-mono" />
                  <input type="text" value={pageLockMessage} onChange={(e) => setPageLockMessage(e.target.value)} placeholder="Down for maintenance" className="w-48 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs" />
                  <BtnPrimary onClick={() => handlePageLockToggle((pageLockPath || '').trim() || '/', true, pageLockMessage)} disabled={pageLockSaving || !(pageLockPath || '').trim()}>Lock</BtnPrimary>
                  <BtnSecondary onClick={() => handlePageLockToggle((pageLockPath || '').trim() || '/', false)} disabled={pageLockSaving || !(pageLockPath || '').trim()}>Unlock</BtnSecondary>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={AlertTriangle}
            title="Related shortcuts"
            toolAnchor="moderationRelated"
            isCollapsed={collapsed.moderationRelated}
            onToggle={() => toggleSection('moderationRelated')}
          />
          {!collapsed.moderationRelated && (
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">Quick jump to adjacent moderation surfaces.</p>
              <div className="flex flex-wrap gap-2">
                <BtnSecondary onClick={() => { setActiveCategoryId('admin-operations'); setCollapsed(prev => ({ ...prev, cheat: false })); if (typeof window !== 'undefined') window.location.hash = 'admin-operations'; }}>
                  Open Cheat Detection
                </BtnSecondary>
                {isAdmin && (
                  <BtnSecondary onClick={() => { setActiveCategoryId('admin-operations'); if (typeof window !== 'undefined') window.location.hash = 'admin-operations'; }}>
                    Open Security & Cloudflare
                  </BtnSecondary>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      )}

      {activeCategoryId === 'admin-economy-progression' && isAdmin && (
      <section id="admin-donations" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <HandCoins size={12} />
          Donations
        </h2>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-sky-500/30 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-sky-500/50 to-transparent" />
          <SectionHeader
            icon={DollarSign}
            title="Store Point Crediting & Preorder"
            color="text-sky-300"
            toolAnchor="donationsStore"
            isCollapsed={collapsed.donationsStore}
            onToggle={() => toggleSection('donationsStore')}
          />
          {!collapsed.donationsStore && (
            <div className="p-3 space-y-4">
              <div className="space-y-3">
                <p className="text-[10px] font-heading font-bold text-sky-400 uppercase tracking-wider">Store point crediting</p>
                <p className="text-[10px] text-mutedForeground">
                  When automatic crediting is off, paid purchases stay as <span className="text-sky-400/90">manual credit pending</span> until staff uses Credit in the payments log. Set an optional date/time below so players see when you plan to process credits (informational only).
                </p>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setStorePointsAutoCredit(!storePointsAutoCredit)}
                    disabled={launchSettingsSaving}
                    className={`shrink-0 px-3 py-1.5 text-[10px] font-heading font-bold uppercase rounded border disabled:opacity-50 ${
                      storePointsAutoCredit
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/25'
                        : 'bg-sky-500/15 text-sky-300 border-sky-500/40 hover:bg-sky-500/25'
                    }`}
                  >
                    {storePointsAutoCredit ? 'Auto credit: on' : 'Auto credit: off'}
                  </button>
                  <p className="text-[10px] text-mutedForeground flex-1">
                    {storePointsAutoCredit
                      ? 'Successful payments credit points immediately (or follow preorder rules below).'
                      : 'Successful payments do not add points until staff credits them.'}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="datetime-local"
                    value={storePointsManualCreditEta ? storePointsManualCreditEta.slice(0, 16) : ''}
                    onChange={(e) =>
                      setStorePointsManualCreditEta(e.target.value ? new Date(e.target.value).toISOString() : '')
                    }
                    disabled={storePointsAutoCredit}
                    className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-sky-500/50 focus:outline-none disabled:opacity-40"
                  />
                  <button
                    type="button"
                    onClick={handleClearStoreManualEta}
                    disabled={launchSettingsSaving || storePointsAutoCredit || !storePointsManualCreditEta}
                    className="px-3 py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-50"
                  >
                    Clear time
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSaveStorePointsCredit}
                  disabled={launchSettingsSaving}
                  className="w-full py-2 text-[10px] font-heading font-bold uppercase rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 hover:bg-sky-500/30 disabled:opacity-50"
                >
                  {launchSettingsSaving ? 'Saving...' : 'Save store crediting'}
                </button>
              </div>

              <div className="h-px bg-zinc-700/30" />

              <div className="space-y-3">
                <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wider">Preorder Points Release</p>
                <p className="text-[10px] text-mutedForeground">
                  Only when automatic store crediting is on: points purchased before this date are held until the date passes, then credit immediately or on claim. If auto crediting is off, purchases use manual crediting instead.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="datetime-local"
                    value={preorderReleaseDate ? preorderReleaseDate.slice(0, 16) : ''}
                    onChange={(e) => setPreorderReleaseDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
                    className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleClearPreorder}
                    disabled={launchSettingsSaving || !preorderReleaseDate}
                    className="px-3 py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSavePreorder}
                  disabled={launchSettingsSaving}
                  className="w-full py-2 text-[10px] font-heading font-bold uppercase rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {launchSettingsSaving ? 'Saving...' : 'Save Preorder Settings'}
                </button>
                <div className="h-px bg-zinc-700/30 my-2" />
                <p className="text-[10px] text-mutedForeground">If release date has passed, click below to manually credit all pending preorder points to users (sends notifications).</p>
                <button
                  type="button"
                  onClick={handleReleaseAllPreorder}
                  disabled={preorderReleaseLoading}
                  className="w-full py-2 text-[10px] font-heading font-bold uppercase rounded bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30 disabled:opacity-50"
                >
                  {preorderReleaseLoading ? 'Releasing...' : 'Release All Pending Preorder Points'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Layers}
            title="Points Provenance / Chargeback"
            toolAnchor="donationsProvenance"
            isCollapsed={collapsed.donationsProvenance}
            onToggle={() => toggleSection('donationsProvenance')}
          />
          {!collapsed.donationsProvenance && (
            <div className="p-2 space-y-1">
              <ActionRow icon={Layers} label="Points Provenance / Chargeback" description="Trace purchased points by payment session and execute best-effort clawback.">
                <div className="flex flex-wrap items-center gap-2 w-full min-w-0 sm:min-w-[min(100%,320px)] sm:flex-1 sm:justify-end">
                  <Input value={pointsProvSessionId} onChange={(e) => setPointsProvSessionId(e.target.value)} placeholder="payment session id (cs_...)" className="flex-1 min-w-[200px] text-[11px]" />
                  <BtnSecondary onClick={handlePointsPreview} disabled={pointsProvPreviewLoading}>{pointsProvPreviewLoading ? '...' : 'Preview'}</BtnSecondary>
                  <BtnSecondary onClick={handlePointsPaymentProvenance} disabled={pointsProvPaymentLoading}>{pointsProvPaymentLoading ? '...' : 'Payment Tree'}</BtnSecondary>
                  <BtnDanger onClick={handlePointsExecuteChargeback} disabled={pointsProvExecuteLoading}>{pointsProvExecuteLoading ? '...' : 'Execute'}</BtnDanger>
                </div>
              </ActionRow>
              <ActionRow icon={Users} label="User Points Lots" description="Inspect one user's point lots and recent ledger events.">
                <div className="flex flex-wrap items-center gap-2 w-full min-w-0 sm:min-w-[min(100%,240px)] sm:flex-1 sm:justify-end">
                  <Input value={pointsProvUserId} onChange={(e) => setPointsProvUserId(e.target.value)} placeholder="username" className="flex-1 min-w-[160px] text-[11px]" />
                  <BtnSecondary onClick={handlePointsUserProvenance} disabled={pointsProvUserLoading}>{pointsProvUserLoading ? '...' : 'Load'}</BtnSecondary>
                </div>
              </ActionRow>
              {(pointsProvPreview || pointsProvPaymentData || pointsProvUserData) && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] font-heading space-y-2 pl-6">
                  {pointsProvPreview && (
                    <div>
                      <div className="font-bold text-primary">Chargeback Preview</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                        <div><span className="text-mutedForeground">Session:</span> {pointsProvPreview.payment_session_id || pointsProvSessionId}</div>
                        <div><span className="text-mutedForeground">Requested:</span> {pointsProvPreview.requested ?? 0}</div>
                        <div><span className="text-mutedForeground">Eligible:</span> {pointsProvPreview.eligible_remaining ?? 0}</div>
                        <div><span className="text-mutedForeground">Reclaimed:</span> {pointsProvPreview.reclaimed ?? 0}</div>
                        <div><span className="text-mutedForeground">Unrecoverable:</span> {pointsProvPreview.unrecoverable ?? 0}</div>
                        <div><span className="text-mutedForeground">Owners:</span> {Array.isArray(pointsProvPreview.owners) ? pointsProvPreview.owners.length : 0}</div>
                      </div>
                    </div>
                  )}
                  {pointsProvPaymentData && (
                    <div>
                      <div className="font-bold text-primary">Payment Provenance</div>
                      <div className="mt-1"><span className="text-mutedForeground">Lots:</span> {Array.isArray(pointsProvPaymentData.lots) ? pointsProvPaymentData.lots.length : 0} | <span className="text-mutedForeground">Ledger:</span> {Array.isArray(pointsProvPaymentData.ledger) ? pointsProvPaymentData.ledger.length : 0}</div>
                    </div>
                  )}
                  {pointsProvUserData && (
                    <div>
                      <div className="font-bold text-primary">User Provenance</div>
                      <div className="mt-1"><span className="text-mutedForeground">User:</span> {pointsProvUserData.user?.username || '?'} ({pointsProvUserData.user?.id || '—'})</div>
                      <div><span className="text-mutedForeground">Balance:</span> {pointsProvUserData.user?.points ?? 0} | <span className="text-mutedForeground">Lots:</span> {Array.isArray(pointsProvUserData.lots) ? pointsProvUserData.lots.length : 0} | <span className="text-mutedForeground">Ledger:</span> {Array.isArray(pointsProvUserData.ledger) ? pointsProvUserData.ledger.length : 0}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Zap}
            title="Donations / Payments (Stripe)"
            badge={donationsLogData ? <span className="text-[10px] font-heading text-primary">{donationsLogData.length} entries</span> : null}
            toolAnchor="donationsPayments"
            isCollapsed={collapsed.donationsPayments}
            onToggle={() => toggleSection('donationsPayments')}
          />
          {!collapsed.donationsPayments && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">Stripe point purchases. Status shows whether Stripe reports paid or unpaid. "Credit" only appears when the payment succeeded in Stripe but points are not credited yet. Use "Check &amp; Process" for a session id if a row looks stuck.</p>
              <div className="flex flex-wrap gap-2 items-center">
                <BtnPrimary onClick={handleFetchDonationsLog} disabled={donationsLogLoading}>
                  {donationsLogLoading ? 'Loading…' : 'Load payments log'}
                </BtnPrimary>
                <input
                  type="text"
                  value={stripeSessionInput}
                  onChange={(e) => setStripeSessionInput(e.target.value)}
                  placeholder="Stripe session ID (cs_test_...)"
                  className="flex-1 min-w-[200px] px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
                />
                <BtnSecondary onClick={handleCheckStripeSession} disabled={checkStripeLoading || !stripeSessionInput.trim()}>
                  {checkStripeLoading ? '...' : 'Check & Process'}
                </BtnSecondary>
              </div>
              {stripeCheckResult && (
                <div className="mt-2 p-2 rounded bg-zinc-800/50 border border-zinc-700/50 text-[9px] font-mono overflow-x-auto">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(stripeCheckResult, null, 2)}</pre>
                </div>
              )}
              {donationsLogData && donationsLogData.length > 0 && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-[9px] font-heading">
                    <thead className="sticky top-0 bg-zinc-900/95 z-10">
                      <tr className="border-b border-zinc-700/50">
                        <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Date</th>
                        <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Session</th>
                        <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Lot ID</th>
                        <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">User</th>
                        <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Package</th>
                        <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Points</th>
                        <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Status</th>
                        <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donationsLogData.map((row, idx) => {
                        const added = row.preorder_points || row.points || 0;
                        const isPending = row.payment_status !== 'completed';
                        const canCredit = row.allow_manual_credit === true
                          || (row.allow_manual_credit === undefined && isPending && row.session_id && row.payment_status !== 'pending' && row.payment_status !== 'abandoned');
                        const statusLabel = row.status_display || (
                          row.payment_status === 'completed' ? 'Credited'
                            : row.payment_status === 'preorder_pending' ? 'Pre-order'
                              : row.payment_status === 'manual_credit_pending' ? 'Manual credit'
                                : row.payment_status || 'Pending'
                        );
                        const statusClass = row.allow_manual_credit
                          ? 'text-emerald-400'
                          : (statusLabel || '').startsWith('Unpaid')
                            ? 'text-red-400/90'
                            : row.payment_status === 'completed'
                              ? 'text-green-400'
                              : 'text-amber-400';
                        const sessionId = row.session_id || '—';
                        const lotId = row.provenance_lot_id || (row.session_id ? `purchase:${row.session_id}` : '—');
                        return (
                          <tr key={row.session_id || idx} className="border-b border-zinc-700/30">
                            <td className="py-1 pr-1 text-mutedForeground" title={row.created_at}>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1 font-mono text-[8px] align-top break-all whitespace-normal min-w-[12rem] max-w-[28rem]" title={sessionId}>{sessionId}</td>
                            <td className="py-1 pr-1 font-mono text-[8px] align-top break-all whitespace-normal min-w-[12rem] max-w-[28rem]" title={lotId}>{lotId}</td>
                            <td className="py-1 pr-1">{row.username ?? row.user_id ?? '—'}</td>
                            <td className="py-1 pr-1 capitalize">{row.package_id ?? '—'}</td>
                            <td className="py-1 pr-1 font-mono">{Number(added).toLocaleString()}</td>
                            <td className="py-1 pr-1">
                              <span className={statusClass}>{statusLabel}</span>
                              {row.stripe_payment_status && row.payment_status === 'pending' ? (
                                <span className="block text-[8px] text-mutedForeground mt-0.5 font-mono" title="Stripe payment_status">Stripe: {row.stripe_payment_status}</span>
                              ) : null}
                            </td>
                            <td className="py-1 pr-1">
                              {canCredit && row.session_id ? (
                                <button
                                  type="button"
                                  onClick={() => handleManualCreditTransaction(row.session_id)}
                                  disabled={manualCreditLoading === row.session_id}
                                  className="px-2 py-0.5 text-[8px] font-heading font-bold uppercase rounded bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30 disabled:opacity-50"
                                >
                                  {manualCreditLoading === row.session_id ? '...' : 'Credit'}
                                </button>
                              ) : (
                                <span className="text-mutedForeground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {donationsLogData && donationsLogData.length === 0 && (
                <p className="text-[10px] text-mutedForeground font-heading">No payment transactions.</p>
              )}
            </div>
          )}
        </div>
      </section>
      )}

      {activeCategoryId === 'admin-world-systems' && staffCanAccessWorldSystems && (
      <section id="admin-gameworld" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <LayoutGrid size={12} />
          Game World
        </h2>

        {/* Launch Settings — admin only */}
        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-amber-500/30 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Launch Settings"
          color="text-amber-400"
          badge={
            <span className="text-[10px] font-heading">
              {(loginLockFrom || loginLockUntil) ? <span className="text-amber-400">Login locked</span> : null}
              {(loginLockFrom || loginLockUntil) && !preregisterLandingBannerEnabled ? (
                <span className="text-mutedForeground"> · Strip off</span>
              ) : null}
              {!(loginLockFrom || loginLockUntil) ? (
                <span className="text-mutedForeground">Not set</span>
              ) : null}
            </span>
          }
          toolAnchor="launchSettings"
          isCollapsed={collapsed.launchSettings}
          onToggle={() => toggleSection('launchSettings')}
        />
        {!collapsed.launchSettings && (
          <div className="p-3 space-y-4">
            <div className="space-y-3">
              <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wider">Login Lock (Launch Date)</p>
              <p className="text-[10px] text-mutedForeground">Block all logins from a start date till an end date. Users can still register. Staff can login via /staff-login.</p>
              <div className="flex flex-col sm:flex-row gap-2 items-end">
                <div className="flex-1 min-w-0">
                  <label className="block text-[9px] font-heading font-bold uppercase tracking-wider text-mutedForeground mb-1">From</label>
                  <input
                    type="datetime-local"
                    value={loginLockFrom ? loginLockFrom.slice(0, 16) : ''}
                    onChange={(e) => setLoginLockFrom(e.target.value ? new Date(e.target.value).toISOString() : '')}
                    className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-[9px] font-heading font-bold uppercase tracking-wider text-mutedForeground mb-1">Till</label>
                  <input
                    type="datetime-local"
                    value={loginLockUntil ? loginLockUntil.slice(0, 16) : ''}
                    onChange={(e) => setLoginLockUntil(e.target.value ? new Date(e.target.value).toISOString() : '')}
                    className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleClearLoginLock}
                  disabled={launchSettingsSaving || (!loginLockFrom && !loginLockUntil)}
                  className="px-3 py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
              <input
                type="text"
                placeholder="Custom lock message (shown on login page)"
                value={loginLockMessage}
                onChange={(e) => setLoginLockMessage(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveLoginLock}
                disabled={launchSettingsSaving}
                className="w-full py-2 text-[10px] font-heading font-bold uppercase rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50"
              >
                {launchSettingsSaving ? 'Saving...' : 'Save Login Lock'}
              </button>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                <p className="text-[10px] text-mutedForeground flex-1">
                  When login is locked, show the slim pre-register banner on the public login page (founding member + <span className="font-mono text-[9px]">?ref=</span> note + countdown).
                </p>
                <button
                  type="button"
                  onClick={handleTogglePreregisterBanner}
                  disabled={launchSettingsSaving}
                  className={`shrink-0 px-3 py-1.5 text-[10px] font-heading font-bold uppercase rounded border disabled:opacity-50 ${
                    preregisterLandingBannerEnabled
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/25'
                      : 'bg-zinc-800/80 text-mutedForeground border-zinc-600/50 hover:bg-zinc-700/80'
                  }`}
                >
                  {preregisterLandingBannerEnabled ? 'Banner: on' : 'Banner: off'}
                </button>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-zinc-700/20 mt-2 pt-3">
                <p className="text-[10px] text-mutedForeground flex-1">
                  <span className="text-amber-400/90 font-heading font-bold uppercase tracking-wider">Preview while logins open</span>
                  {' — '}Show the same slim strip on <span className="font-mono text-[9px]">/</span> and <span className="font-mono text-[9px]">/login</span> even when the login lock is off (no countdown). Turn off before launch if you only want the strip during a real lock.
                </p>
                <button
                  type="button"
                  onClick={handleTogglePreregisterBannerPreview}
                  disabled={launchSettingsSaving || !preregisterLandingBannerEnabled}
                  title={!preregisterLandingBannerEnabled ? 'Turn the banner on first' : undefined}
                  className={`shrink-0 px-3 py-1.5 text-[10px] font-heading font-bold uppercase rounded border disabled:opacity-50 ${
                    preregisterBannerPreviewOpen
                      ? 'bg-sky-500/15 text-sky-300 border-sky-500/40 hover:bg-sky-500/25'
                      : 'bg-zinc-800/80 text-mutedForeground border-zinc-600/50 hover:bg-zinc-700/80'
                  }`}
                >
                  {preregisterBannerPreviewOpen ? 'Preview: on' : 'Preview: off'}
                </button>
              </div>
            </div>

          </div>
        )}
        </div>
        )}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={DollarSign}
          title="Casino Limits"
          badge={
            <span className="text-[10px] font-heading text-mutedForeground">
              Max bet: ${(casinoGlobalMaxBet || 1000000000).toLocaleString()} · Buy-back: {(casinoBuybackMaxPoints || 15000).toLocaleString()} pts · MP poker blind: ${(mpPokerMaxBlind || 2500000).toLocaleString()}
            </span>
          }
          toolAnchor="casinoLimits"
          isCollapsed={collapsed.casinoLimits}
          onToggle={() => toggleSection('casinoLimits')}
        />
        {!collapsed.casinoLimits && (
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground">Set global caps that apply to all casinos. Owners cannot set values higher than these limits.</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-mutedForeground w-32 shrink-0">Global Max Bet ($)</span>
                <input
                  type="text"
                  value={casinoGlobalMaxBet.toLocaleString()}
                  onChange={(e) => setCasinoGlobalMaxBet(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                  className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none font-mono"
                  placeholder="1,000,000,000"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-mutedForeground w-32 shrink-0">Buy-back Max (pts)</span>
                <input
                  type="text"
                  value={casinoBuybackMaxPoints.toLocaleString()}
                  onChange={(e) => setCasinoBuybackMaxPoints(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                  className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none font-mono"
                  placeholder="15,000"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-mutedForeground w-32 shrink-0">MP Poker Blind ($)</span>
                <input
                  type="text"
                  value={mpPokerMaxBlind.toLocaleString()}
                  onChange={(e) => setMpPokerMaxBlind(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                  className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none font-mono"
                  placeholder="2,500,000"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleSaveCasinoCaps}
              disabled={casinoCapsSaving}
              className="w-full py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
            >
              {casinoCapsSaving ? 'Saving...' : 'Save Casino Limits'}
            </button>
          </div>
        )}
        </div>

        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={HandCoins}
          title="Claim costs"
          badge={
            <span className="text-[10px] font-heading text-mutedForeground">
              {claimCostsLoading ? 'Loading…' : 'Casino · airport · armoury'}
            </span>
          }
          toolAnchor="claimCosts"
          isCollapsed={collapsed.claimCosts}
          onToggle={() => toggleSection('claimCosts')}
        />
        {!collapsed.claimCosts && (
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground">
              Cash (and dice points where used) to claim each property type. Values persist in <span className="font-mono text-[9px]">game_settings</span> until changed again.
            </p>
            <div className="space-y-2">
              {[
                { key: 'dice_cash', label: 'Dice (cash $)' },
                { key: 'dice_points', label: 'Dice (points)' },
                { key: 'roulette', label: 'Roulette ($)' },
                { key: 'blackjack', label: 'Blackjack ($)' },
                { key: 'horseracing', label: 'Horse racing ($)' },
                { key: 'video_poker', label: 'Video poker ($)' },
                { key: 'airport', label: 'Airport ($)' },
                { key: 'armoury', label: 'Armoury / bullet factory ($)' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[10px] text-mutedForeground w-40 sm:w-44 shrink-0">{label}</span>
                  <input
                    type="text"
                    value={typeof claimCosts[key] === 'number' ? claimCosts[key].toLocaleString() : String(claimCosts[key] ?? '')}
                    onChange={(e) =>
                      setClaimCosts((prev) => ({
                        ...prev,
                        [key]: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0,
                      }))
                    }
                    disabled={claimCostsLoading || claimCostsSaving}
                    className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none font-mono min-w-0"
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={fetchClaimCosts}
                disabled={claimCostsLoading || claimCostsSaving}
                className="flex-1 py-2 text-[10px] font-heading font-bold uppercase rounded bg-zinc-800/80 text-mutedForeground border border-zinc-600/50 hover:bg-zinc-700/80 disabled:opacity-50"
              >
                {claimCostsLoading ? 'Loading…' : 'Reload'}
              </button>
              <button
                type="button"
                onClick={handleSaveClaimCosts}
                disabled={claimCostsLoading || claimCostsSaving}
                className="flex-1 py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
              >
                {claimCostsSaving ? 'Saving…' : 'Save claim costs'}
              </button>
            </div>
          </div>
        )}
        </div>
        )}

        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Zap}
          title="Game Events"
          badge={
            <span className="text-[10px] font-heading">
              <span className={eventsEnabled ? 'text-emerald-400' : 'text-red-400'}>{eventsEnabled ? 'On' : 'Off'}</span>
              {todayEvent?.name && <span className="text-mutedForeground"> · {todayEvent.name}</span>}
            </span>
          }
          toolAnchor="events"
          isCollapsed={collapsed.events}
          onToggle={() => toggleSection('events')}
        />
        {!collapsed.events && (
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <BtnPrimary onClick={handleToggleEvents}>{eventsEnabled ? 'Disable' : 'Enable'} Events</BtnPrimary>
              <BtnSecondary onClick={handleToggleAllEventsForTesting}>
                {allEventsForTesting ? 'Disable' : 'Enable'} All (Testing)
              </BtnSecondary>
            </div>
            <p className="text-[10px] text-mutedForeground">All events (testing): applies every multiplier at once.</p>
            <div className="pt-2 border-t border-primary/20 space-y-2">
              <p className="text-xs font-medium text-foreground">Choose random event</p>
              <div className="flex flex-wrap gap-2 items-center">
                <BtnSecondary onClick={() => handleRandomEvent(false)} disabled={eventRandomLoading}>
                  {eventRandomLoading ? '...' : 'Random (from all)'}
                </BtnSecondary>
                <BtnSecondary onClick={() => handleRandomEvent(true)} disabled={eventRandomLoading}>
                  {eventRandomLoading ? '...' : 'Random (from selected)'}
                </BtnSecondary>
                <span className="text-[10px] text-mutedForeground">Tick &quot;In pool&quot; below to choose from specific events only.</span>
              </div>
              {overrideEventId && (
                <div className="flex flex-wrap gap-2 items-center py-1.5 px-2 rounded bg-primary/10 border border-primary/30">
                  <span className="text-xs text-foreground">Overridden: {eventList.find((e) => e.id === overrideEventId)?.name ?? overrideEventId}</span>
                  <BtnSecondary onClick={handleClearEventOverride} disabled={eventClearOverrideLoading}>
                    {eventClearOverrideLoading ? '...' : 'Clear override'}
                  </BtnSecondary>
                </div>
              )}
            </div>
            <div className="pt-2 border-t border-primary/20">
              <p className="text-xs font-medium text-foreground mb-1">Global events</p>
              <p className="text-[10px] text-mutedForeground mb-2">Enable or disable each event type. Disabled events are skipped on their day (no event that day). Event types are defined in code (GAME_EVENTS).</p>
              <div className="flex flex-wrap gap-2 items-center mb-2">
                <span className="text-[10px] text-mutedForeground">In pool for Random (from selected):</span>
                <BtnSecondary onClick={() => setSelectedForRandomPool(Object.fromEntries((eventList || []).map((ev) => [ev.id, true])))}>
                  Select all
                </BtnSecondary>
                <BtnSecondary onClick={() => setSelectedForRandomPool({})}>
                  Deselect all
                </BtnSecondary>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {eventList.map((ev) => (
                  <div key={ev.id} className="flex flex-wrap items-center gap-2 py-1.5 px-2 rounded bg-black/20">
                    <label className="flex items-center gap-1 shrink-0 cursor-pointer" title="Include in random pool (when using Random from selected)">
                      <input type="checkbox" checked={!!selectedForRandomPool[ev.id]} onChange={() => toggleRandomPoolSelection(ev.id)} className="rounded border-primary/50" />
                      <span className="text-[10px] text-mutedForeground">In pool</span>
                    </label>
                    <span className="text-xs font-medium text-foreground min-w-0 truncate flex-1">{ev.name}</span>
                    {todayEvent?.id === ev.id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/30 text-primary font-medium shrink-0">Today</span>}
                    <span className="text-[10px] text-mutedForeground truncate max-w-[200px]" title={ev.message}>{ev.message || ev.id}</span>
                    <BtnSecondary
                      onClick={() => handleToggleEvent(ev.id, !ev.enabled)}
                      disabled={eventToggleLoadingId !== null}
                    >
                      {eventToggleLoadingId === ev.id ? '...' : ev.enabled ? 'Disable' : 'Enable'}
                    </BtnSecondary>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        </div>
        )}

        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Booze Run rotation"
          badge={
            <span className="text-[10px] font-heading flex flex-wrap items-center gap-x-2 gap-y-0.5 justify-end max-w-[min(100%,14rem)]">
              {boozeRotationSeconds != null ? (
                <span className="text-amber-400">{boozeRotationSeconds}s (test)</span>
              ) : (
                <span className="text-mutedForeground">3h (normal)</span>
              )}
              {boozeListedPrice != null && Number(boozeListedPrice.percent_off) > 0 && (
                <span className="text-emerald-400 font-bold whitespace-nowrap">
                  −{Number(boozeListedPrice.percent_off).toFixed(1).replace(/\.0$/, '')}% global
                </span>
              )}
              {boozeListedPrice != null && Number(boozeListedPrice.percent_premium) > 0 && (
                <span className="text-amber-400 font-bold whitespace-nowrap">
                  +{Number(boozeListedPrice.percent_premium).toFixed(1).replace(/\.0$/, '')}% vs base
                </span>
              )}
            </span>
          }
          toolAnchor="boozeRun"
          isCollapsed={collapsed.boozeRun}
          onToggle={() => {
            toggleSection('boozeRun');
            if (collapsed.boozeRun) {
              fetchBoozeRotation();
              fetchBoozeJailChances();
              fetchBoozeListedPrice();
            }
          }}
        />
        {!collapsed.boozeRun && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground">
              Set rotation to 15 seconds for testing; prices and best routes will update every 15s. Reset to use normal 3h. Persists in{' '}
              <code className="text-[9px] bg-zinc-800/80 px-0.5 rounded">game_settings</code> until changed.
            </p>
            <div className="flex flex-wrap gap-2">
              <BtnPrimary onClick={handleBoozeRotation15s}>Set rotation to 15s</BtnPrimary>
              <BtnSecondary onClick={handleBoozeRotationReset}>Reset to 3h</BtnSecondary>
            </div>
            <div className="border-t border-zinc-700/40 pt-3 mt-3 space-y-2">
              <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wide">Listed price discount (global)</div>
              <p className="text-[10px] text-mutedForeground">
                Nudge the <strong className="text-foreground/90">global discount</strong> on rotation buy/sell listed prices (all cities &amp; types). Persists in{' '}
                <code className="text-[9px] bg-zinc-800/80 px-0.5 rounded">game_settings</code>.{' '}
                <strong className="text-foreground/90">−1% / −5%</strong> = one more point off listed prices (cheaper);{' '}
                <strong className="text-foreground/90">+1% / +5%</strong> = one fewer point off, or above full price up to +50% vs rotation. Max 99% off; max +50% premium.
              </p>
              {boozeListedPrice && (
                <p className="text-[9px] text-mutedForeground font-heading">
                  Active:{' '}
                  {Number(boozeListedPrice.percent_off) > 0
                    ? `${Number(boozeListedPrice.percent_off).toFixed(2).replace(/\.?0+$/, '')}% off`
                    : Number(boozeListedPrice.percent_premium) > 0
                      ? `+${Number(boozeListedPrice.percent_premium).toFixed(2).replace(/\.?0+$/, '')}% vs rotation`
                      : 'no discount / premium'}
                  {' '}(×{Number(boozeListedPrice.listed_price_mult).toFixed(4)})
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[9px] text-mutedForeground font-heading uppercase w-full sm:w-auto">Nudge</span>
                <BtnSecondary type="button" onClick={() => handleBoozeListedPriceNudge(5)} disabled={boozePriceSaving}>−5%</BtnSecondary>
                <BtnSecondary type="button" onClick={() => handleBoozeListedPriceNudge(1)} disabled={boozePriceSaving}>−1%</BtnSecondary>
                <BtnSecondary type="button" onClick={() => handleBoozeListedPriceNudge(-1)} disabled={boozePriceSaving}>+1%</BtnSecondary>
                <BtnSecondary type="button" onClick={() => handleBoozeListedPriceNudge(-5)} disabled={boozePriceSaving}>+5%</BtnSecondary>
                <BtnSecondary onClick={handleBoozeListedPriceReset} disabled={boozePriceSaving}>Full price</BtnSecondary>
                <BtnSecondary type="button" onClick={fetchBoozeListedPrice} disabled={boozePriceSaving}>Refresh</BtnSecondary>
              </div>
            </div>
            <div className="border-t border-zinc-700/40 pt-3 mt-3 space-y-2">
              <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wide">Jail bust chance (buy &amp; sell)</div>
              <p className="text-[10px] text-mutedForeground">
                Each leg rolls a uniform probability between min and max. Defaults in code: {(boozeJailChances?.default_jail_chance_min != null ? (Number(boozeJailChances.default_jail_chance_min) * 100).toFixed(1) : '5')}%–{(boozeJailChances?.default_jail_chance_max != null ? (Number(boozeJailChances.default_jail_chance_max) * 100).toFixed(1) : '15')}%. Overrides persist in{' '}
                <code className="text-[9px] bg-zinc-800/80 px-0.5 rounded">game_settings</code> (same doc as listed price &amp; rotation) until reset or changed.
              </p>
              {boozeJailChances && (
                <p className="text-[9px] text-mutedForeground font-heading">
                  Effective now: {(Number(boozeJailChances.effective_jail_chance_min) * 100).toFixed(2)}% – {(Number(boozeJailChances.effective_jail_chance_max) * 100).toFixed(2)}% · Jail duration {boozeJailChances.jail_seconds}s · Top-3 profit leaders +{(Number(boozeJailChances.top_leader_extra_probability) * 100).toFixed(1)}% (cap {(Number(boozeJailChances.top_leader_probability_cap_after_extra) * 100).toFixed(0)}% after bonus)
                </p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-0.5 text-[10px] font-heading">
                  <span className="text-mutedForeground">Min %</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={boozeJailMinPct}
                    onChange={(e) => setBoozeJailMinPct(e.target.value)}
                    className="w-20 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[10px] font-heading">
                  <span className="text-mutedForeground">Max %</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={boozeJailMaxPct}
                    onChange={(e) => setBoozeJailMaxPct(e.target.value)}
                    className="w-20 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                  />
                </label>
                <BtnPrimary onClick={handleBoozeJailSave} disabled={boozeJailSaving}>{boozeJailSaving ? 'Saving…' : 'Apply jail %'}</BtnPrimary>
                <BtnSecondary onClick={handleBoozeJailReset} disabled={boozeJailSaving}>Reset to defaults</BtnSecondary>
                <BtnSecondary type="button" onClick={fetchBoozeJailChances} disabled={boozeJailSaving}>Refresh</BtnSecondary>
              </div>
            </div>
          </div>
        )}
        </div>
        )}

        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={UserCircle}
          title="Presence simulator"
          badge={
            presenceSim?.enabled ? (
              <span className="text-[10px] font-heading text-green-400">on · pool {presenceSim.active_user_ids?.length ?? 0}</span>
            ) : (
              <span className="text-[10px] text-mutedForeground font-heading">off</span>
            )
          }
          toolAnchor="presenceSimulator"
          isCollapsed={collapsed.presenceSimulator}
          onToggle={() => {
            toggleSection('presenceSimulator');
            if (collapsed.presenceSimulator) fetchPresenceSim();
          }}
        />
        {!collapsed.presenceSimulator && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground font-heading">
              On each tick, removes up to “max remove” sim users from the pool (they then drift off Users Online as{' '}
              <code className="text-[9px] bg-zinc-800/80 px-1 rounded">last_seen</code> ages) and adds up to “max add” new offline players.{' '}
              <code className="text-[9px] bg-zinc-800/80 px-1 rounded">last_seen</code> is staggered per user so counts don’t jump in one instant; use an interval under ~5 minutes so pool members stay inside the online window. Overlapping ticks (loop + Run tick now) are deduped unless you use Run tick now (that always runs). Auto-rank (non-idle) accounts are skipped.{' '}
              <span className="text-mutedForeground/90">Usernames listed below are never added and are dropped from the pool if present. With “Gradual adds”, new pool members get their first bump spaced apart (capped so one tick stays within most of the interval).</span>
            </p>
            {presenceSimLoading && !presenceSim ? (
              <p className="text-[10px] text-mutedForeground font-heading">Loading…</p>
            ) : presenceSim ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading">
                  <BtnPrimary type="button" onClick={handlePresenceSimToggle} disabled={presenceSimLoading}>
                    {presenceSim.enabled ? 'Turn off' : 'Turn on'}
                  </BtnPrimary>
                  <BtnSecondary type="button" onClick={fetchPresenceSim} disabled={presenceSimLoading}>Refresh</BtnSecondary>
                  <BtnSecondary type="button" onClick={handlePresenceSimRunNow} disabled={presenceSimLoading || !presenceSim.enabled}>Run tick now</BtnSecondary>
                </div>
                <p className="text-[9px] text-mutedForeground">
                  Ticks: {presenceSim.ticks_total ?? 0}
                  {presenceSim.last_tick_at ? ` · last ${new Date(presenceSim.last_tick_at).toLocaleString()}` : ''}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-heading">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-mutedForeground">Interval (minutes)</span>
                    <input
                      value={psForm.intervalMin}
                      onChange={(e) => setPsForm((f) => ({ ...f, intervalMin: e.target.value }))}
                      className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-mutedForeground">Min add / tick</span>
                    <input
                      value={psForm.minAdd}
                      onChange={(e) => setPsForm((f) => ({ ...f, minAdd: e.target.value }))}
                      className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-mutedForeground">Max add / tick</span>
                    <input
                      value={psForm.maxAdd}
                      onChange={(e) => setPsForm((f) => ({ ...f, maxAdd: e.target.value }))}
                      className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-mutedForeground">Max remove / tick</span>
                    <input
                      value={psForm.maxRemove}
                      onChange={(e) => setPsForm((f) => ({ ...f, maxRemove: e.target.value }))}
                      className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-mutedForeground">Max pool size</span>
                    <input
                      value={psForm.maxPool}
                      onChange={(e) => setPsForm((f) => ({ ...f, maxPool: e.target.value }))}
                      className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 sm:col-span-2">
                    <span className="text-mutedForeground">Seconds between new adds (gradual)</span>
                    <input
                      value={psForm.secondsBetweenAdds}
                      onChange={(e) => setPsForm((f) => ({ ...f, secondsBetweenAdds: e.target.value }))}
                      disabled={!psForm.gradualAdd}
                      className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground disabled:opacity-50"
                    />
                  </label>
                  <label className="flex flex-row sm:col-span-3 items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!psForm.gradualAdd}
                      onChange={(e) => setPsForm((f) => ({ ...f, gradualAdd: e.target.checked }))}
                      className="rounded border-zinc-600"
                    />
                    <span className="text-mutedForeground">Gradual adds (space new pool members over time)</span>
                  </label>
                  <label className="flex flex-col gap-0.5 sm:col-span-3">
                    <span className="text-mutedForeground">Skip usernames (one per line; never simulated)</span>
                    <textarea
                      rows={4}
                      value={psForm.skipUsernames}
                      onChange={(e) => setPsForm((f) => ({ ...f, skipUsernames: e.target.value }))}
                      placeholder={'player_one\nOtherAccount'}
                      className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground font-mono min-h-[4rem]"
                    />
                  </label>
                </div>
                <BtnPrimary type="button" onClick={handlePresenceSimSave} disabled={presenceSimLoading}>Save settings</BtnPrimary>
              </>
            ) : (
              <p className="text-[10px] text-red-400 font-heading">Could not load (admin only).</p>
            )}
          </div>
        )}
        </div>
        )}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Coins}
          title="Slots draw (testing)"
          badge={<span className="text-[10px] text-mutedForeground font-heading">Next draw time</span>}
          toolAnchor="slotsDraw"
          isCollapsed={collapsed.slotsDraw}
          onToggle={() => toggleSection('slotsDraw')}
        />
        {!collapsed.slotsDraw && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground font-heading">Set the next lottery draw to 1 minute for all states, or reset to default 3 hours. Clear cooldowns so everyone can enter/win the draw (testing).</p>
            <div className="flex flex-wrap gap-2">
              <BtnPrimary onClick={handleSlotsDraw1Min}>Set next draw in 1 min</BtnPrimary>
              <BtnSecondary onClick={handleSlotsDrawReset}>Reset to default (3h)</BtnSecondary>
              <BtnSecondary onClick={handleSlotsClearCooldowns}>Clear slots cooldowns</BtnSecondary>
            </div>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Lock}
          title="Crack the Safe jackpot"
          badge={
            crackSafeInfo != null ? (
              <span className="text-[10px] font-heading text-yellow-400">${Number(crackSafeInfo.jackpot).toLocaleString()}</span>
            ) : (
              <span className="text-[10px] text-mutedForeground font-heading">Global pot</span>
            )
          }
          toolAnchor="crackSafeJackpot"
          isCollapsed={collapsed.crackSafeJackpot}
          onToggle={() => {
            toggleSection('crackSafeJackpot');
            if (collapsed.crackSafeJackpot) fetchCrackSafeJackpot();
          }}
        />
        {!collapsed.crackSafeJackpot && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground">
              Set the global jackpot shown on Crack the Safe (lowers or raises the pot without a win). Code default seed is shown for reference.
            </p>
            {crackSafeJackpotLoading ? (
              <p className="text-xs text-mutedForeground">Loading...</p>
            ) : crackSafeInfo ? (
              <div className="space-y-2">
                <p className="text-[10px] text-mutedForeground">
                  Total attempts (all-time): <span className="text-foreground font-heading">{Number(crackSafeInfo.total_attempts || 0).toLocaleString()}</span>
                  {' · '}
                  Code seed default:{' '}
                  <span className="text-foreground font-heading">${Number(crackSafeInfo.seed_default || 0).toLocaleString()}</span>
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-[9px] text-mutedForeground uppercase font-heading block mb-1">New jackpot ($)</label>
                    <FormattedNumberInput
                      value={crackSafeJackpotInput}
                      onChange={(v) => setCrackSafeJackpotInput(v)}
                      className="w-44 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none tabular-nums"
                    />
                  </div>
                  <BtnPrimary onClick={handleSetCrackSafeJackpot} disabled={crackSafeJackpotSaving}>
                    {crackSafeJackpotSaving ? '...' : 'Apply'}
                  </BtnPrimary>
                  <BtnSecondary
                    type="button"
                    onClick={() => {
                      if (crackSafeInfo?.seed_default != null) {
                        setCrackSafeJackpotInput(String(crackSafeInfo.seed_default));
                      }
                    }}
                  >
                    Use seed default
                  </BtnSecondary>
                  <BtnSecondary type="button" onClick={fetchCrackSafeJackpot}>
                    Refresh
                  </BtnSecondary>
                </div>
              </div>
            ) : (
              <BtnPrimary onClick={fetchCrackSafeJackpot}>Load jackpot</BtnPrimary>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Building2}
          title="State Heads"
          badge={stateHeads?.has_duplicates ? <span className="text-[10px] font-heading text-red-400">Duplicates found!</span> : null}
          toolAnchor="stateHeads"
          isCollapsed={collapsed.stateHeads}
          onToggle={() => { toggleSection('stateHeads'); if (collapsed.stateHeads && !stateHeads) fetchStateHeads(); }}
        />
        {!collapsed.stateHeads && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground">Manage which family controls each state. A family can only be head of ONE state.</p>
            {stateHeadsLoading ? (
              <p className="text-xs text-mutedForeground">Loading...</p>
            ) : stateHeads ? (
              <div className="space-y-2">
                {stateHeads.duplicates?.length > 0 && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2">
                    <p className="text-[10px] font-heading font-bold text-red-400 uppercase tracking-wider mb-1">Duplicate Detected</p>
                    {stateHeads.duplicates.map((d) => (
                      <p key={d.family_id} className="text-xs text-red-300">
                        <strong>{d.family_name}</strong> is head of {d.states_headed.join(', ')} ({d.count} states)
                      </p>
                    ))}
                  </div>
                )}
                <div className="grid gap-1.5">
                  {Object.entries(stateHeads.state_heads || {}).map(([state, info]) => (
                    <div key={state} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-zinc-800/50 border border-zinc-700/30">
                      <div className="min-w-0">
                        <span className="text-xs font-heading font-bold text-foreground">{state}</span>
                        {info ? (
                          <span className="text-[10px] text-primary ml-2">[{info.family_tag}] {info.family_name}</span>
                        ) : (
                          <span className="text-[10px] text-mutedForeground ml-2">Unclaimed</span>
                        )}
                      </div>
                      {info && (
                        <BtnDanger onClick={() => handleClearStateHead(state)}>Clear</BtnDanger>
                      )}
                    </div>
                  ))}
                </div>
                <BtnSecondary onClick={fetchStateHeads}>Refresh</BtnSecondary>
              </div>
            ) : (
              <BtnPrimary onClick={fetchStateHeads}>Load State Heads</BtnPrimary>
            )}
          </div>
        )}
        </div>

        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Reset Racket Cooldown"
          toolAnchor="racketReset"
          isCollapsed={collapsed.racketReset}
          onToggle={() => toggleSection('racketReset')}
        />
        {!collapsed.racketReset && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground">Reset a family racket&apos;s cooldown so it can be collected immediately. Enter the family ID and select the racket.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-[9px] text-mutedForeground uppercase font-heading block mb-1">Family ID</label>
                <input
                  type="text"
                  value={racketResetFamilyId}
                  onChange={(e) => setRacketResetFamilyId(e.target.value)}
                  placeholder="e.g. fam_abc123"
                  className="w-40 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[9px] text-mutedForeground uppercase font-heading block mb-1">Racket</label>
                <select
                  value={racketResetRacketId}
                  onChange={(e) => setRacketResetRacketId(e.target.value)}
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                >
                  <option value="protection">Protection Racket</option>
                  <option value="gambling">Gambling Operation</option>
                  <option value="loansharking">Loan Sharking</option>
                  <option value="labour">Labour Racketeering</option>
                  <option value="distillery">Distillery</option>
                  <option value="warehouse">Warehouse</option>
                  <option value="restaurant_bar">Restaurant &amp; Bar</option>
                  <option value="funeral_home">Funeral Home</option>
                  <option value="garment_shop">Garment Shop</option>
                </select>
              </div>
              <BtnPrimary onClick={handleResetRacketCooldown} disabled={racketResetLoading || !racketResetFamilyId.trim()}>
                {racketResetLoading ? '...' : 'Reset Cooldown'}
              </BtnPrimary>
            </div>
          </div>
        )}
        </div>
        )}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Dice5}
          title="Casino Max Bets"
          badge={casinoMaxBets ? <span className="text-[10px] font-heading text-mutedForeground">{Object.keys(casinoMaxBets).length} types</span> : null}
          toolAnchor="casinoMaxBets"
          isCollapsed={collapsed.casinoMaxBets}
          onToggle={() => { toggleSection('casinoMaxBets'); if (collapsed.casinoMaxBets && !casinoMaxBets) fetchCasinoMaxBets(); }}
        />
        {!collapsed.casinoMaxBets && (
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground">Change max bet for all casinos or a specific game type/location. This overrides owner-set max bets.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-[9px] text-mutedForeground uppercase font-heading block mb-1">Game Type</label>
                <select
                  value={casinoMaxBetGameType}
                  onChange={(e) => setCasinoMaxBetGameType(e.target.value)}
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                >
                  <option value="all">All Types</option>
                  <option value="dice">Dice</option>
                  <option value="roulette">Roulette</option>
                  <option value="blackjack">Blackjack</option>
                  <option value="horseracing">Horse Racing</option>
                  <option value="videopoker">Video Poker</option>
                  <option value="slots">Slots</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] text-mutedForeground uppercase font-heading block mb-1">Location (optional)</label>
                <input
                  type="text"
                  value={casinoMaxBetLocation}
                  onChange={(e) => setCasinoMaxBetLocation(e.target.value)}
                  placeholder="e.g. New York"
                  className="w-32 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[9px] text-mutedForeground uppercase font-heading block mb-1">New Max Bet</label>
                <input
                  type="text"
                  value={casinoMaxBetValue}
                  onChange={(e) => setCasinoMaxBetValue(e.target.value)}
                  placeholder="e.g. 50,000,000"
                  className="w-32 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>
              <BtnPrimary onClick={handleSetCasinoMaxBet} disabled={casinoMaxBetSaving || !casinoMaxBetValue}>
                {casinoMaxBetSaving ? '...' : 'Set Max Bet'}
              </BtnPrimary>
            </div>
            {casinoMaxBetsLoading ? (
              <p className="text-xs text-mutedForeground">Loading...</p>
            ) : casinoMaxBets && (
              <div className="space-y-2 mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-mutedForeground uppercase font-heading">Current Max Bets by Type</span>
                  <BtnSecondary onClick={fetchCasinoMaxBets}>Refresh</BtnSecondary>
                </div>
                {Object.entries(casinoMaxBets).map(([gameType, locations]) => (
                  <details key={gameType} className="rounded border border-zinc-700/30 bg-zinc-800/30 overflow-hidden">
                    <summary className="px-2.5 py-2 cursor-pointer text-xs font-heading font-bold text-primary uppercase tracking-wider hover:bg-zinc-700/30 list-none flex items-center justify-between">
                      <span>{gameType}</span>
                      <span className="text-[10px] text-mutedForeground font-normal normal-case">{locations.length} location{locations.length !== 1 ? 's' : ''}</span>
                    </summary>
                    <div className="px-2.5 py-2 border-t border-zinc-700/30 max-h-48 overflow-y-auto">
                      <div className="grid gap-1">
                        {locations.map((loc, i) => (
                          <div key={i} className="flex items-center justify-between text-[10px] font-heading px-1.5 py-1 rounded bg-zinc-900/30">
                            <span className="text-foreground">{loc.location}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-primary font-mono">${(loc.max_bet || 0).toLocaleString()}</span>
                              {loc.owner && <span className="text-mutedForeground">({loc.owner})</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Lock}
          title="Lock page"
          badge={Object.keys(pageLocks).length > 0 ? <span className="text-[10px] font-heading text-amber-400">{Object.keys(pageLocks).length} locked</span> : null}
          toolAnchor="pageLocks"
          isCollapsed={collapsed.pageLocks}
          onToggle={() => toggleSection('pageLocks')}
        />
        {!collapsed.pageLocks && (
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground">When a page is locked, users see &quot;Down for maintenance&quot; (or your message) and cannot access it. Admins can still access.</p>
            <div className=" rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2">
              <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wider">Lock buying points (Points tab only) until</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="datetime-local" value={pageLockUnlockAt} onChange={(e) => setPageLockUnlockAt(e.target.value)} className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs font-mono" />
                <BtnPrimary onClick={() => handlePageLockToggle('/store/points', true, pageLockUnlockAt ? `Points purchase closed until ${new Date(pageLockUnlockAt).toLocaleString()}` : 'Points purchase temporarily unavailable', pageLockUnlockAt ? new Date(pageLockUnlockAt).toISOString() : null)} disabled={pageLockSaving || !pageLockUnlockAt}>Lock until date</BtnPrimary>
                {pageLocks['/store/points'] && (
                  <BtnSecondary onClick={() => handlePageLockToggle('/store/points', false)} disabled={pageLockSaving}>Unlock now</BtnSecondary>
                )}
              </div>
              <p className="text-[9px] text-mutedForeground">Locks only the Points tab (buy pts with £). Upgrades, bullets, send pts remain available. Unlocks automatically when the time passes.</p>
            </div>
            <div className="space-y-2">
              {[
                '/dashboard',
                '/game/users-online',
                '/bank',
                '/stock-market',
                '/stats',
                '/my-stats',
                '/jail',
                '/organised-crime',
                '/objectives',
                '/account/missions',
                '/inventory',
                '/loot-box',
                '/ranking',
                '/crimes',
                '/gta',
                '/view-car',
                '/garage',
                '/sell-cars',
                '/buy-cars',
                '/auto-rank',
                '/attack',
                '/attempts',
                '/hitlist',
                '/bodyguards',
                '/families',
                '/properties',
                '/casino',
                '/casino/dice',
                '/casino/rlt',
                '/casino/blackjack',
                '/casino/horseracing',
                '/casino/slots',
                '/casino/videopoker',
                '/casino/mdg',
                '/casino/mp-blackjack',
                '/casino/mp-poker',
                '/sports-betting',
                '/prestige',
                '/crack-safe',
                '/daily-rewards',
                '/flappygangster',
                '/boxing',
                '/armour-weapons',
                '/shooting-range',
                '/leaderboard',
                '/store',
                '/store/points',
                '/money/quick-trade',
                '/travel',
                '/states',
                '/my-properties',
                '/booze-run',
                '/racket',
                '/forum',
                '/inbox',
                '/help-desk',
                '/dead-alive',
                '/profile',
                '/ip-rules',
              ].map((path) => {
                const entry = pageLocks[path];
                const isLocked = !!entry;
                const msg = typeof entry === 'object' ? (entry?.message ?? '') : (entry || '');
                const unlockAt = typeof entry === 'object' ? entry?.unlock_at : null;
                return (
                  <div key={path} className="flex flex-wrap items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/30 border border-transparent hover:border-primary/20">
                    <span className="text-[11px] font-heading font-mono min-w-[140px]">{path}</span>
                    {isLocked && <span className="text-[10px] text-mutedForeground truncate max-w-[200px]" title={msg}>{msg || 'Down for maintenance'}</span>}
                    {unlockAt && <span className="text-[9px] text-amber-400">until {new Date(unlockAt).toLocaleString()}</span>}
                    <div className="flex gap-1 ml-auto">
                      {isLocked ? (
                        <BtnSecondary onClick={() => handlePageLockToggle(path, false)} disabled={pageLockSaving}>Unlock</BtnSecondary>
                      ) : (
                        <BtnPrimary onClick={() => handlePageLockToggle(path, true, pageLockMessage)} disabled={pageLockSaving}>Lock</BtnPrimary>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pt-2 border-t border-white/10">
              <p className="text-[10px] font-heading font-bold text-primary mb-2">Custom path</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={pageLockPath} onChange={(e) => setPageLockPath(e.target.value)} placeholder="/any/path" className="w-40 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs font-mono" />
                <input type="text" value={pageLockMessage} onChange={(e) => setPageLockMessage(e.target.value)} placeholder="Down for maintenance" className="w-48 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs" />
                <BtnPrimary onClick={() => handlePageLockToggle((pageLockPath || '').trim() || '/', true, pageLockMessage)} disabled={pageLockSaving || !(pageLockPath || '').trim()}>Lock</BtnPrimary>
                <BtnSecondary onClick={() => handlePageLockToggle((pageLockPath || '').trim() || '/', false)} disabled={pageLockSaving || !(pageLockPath || '').trim()}>Unlock</BtnSecondary>
              </div>
            </div>
          </div>
        )}
        </div>

        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Palette}
          title="Admin display"
          badge={
            <span className="text-[10px] font-heading flex items-center gap-2">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full border border-primary/30 shrink-0" style={{ backgroundColor: adminOnlineColor }} />
                <span className="text-mutedForeground">Admin</span>
              </span>
              <span className="flex items-center gap-1 text-mutedForeground">
                <span className="text-[9px]">Mod = set in Mod display</span>
              </span>
            </span>
          }
          toolAnchor="adminDisplay"
          isCollapsed={collapsed.adminDisplay}
          onToggle={() => toggleSection('adminDisplay')}
        />
        {!collapsed.adminDisplay && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground font-heading">Colours used for usernames and badges on the Users Online page. Admin colour is set here. Mods set their own colour in Mod display (same page).</p>
              <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={adminOnlineColor}
                  onChange={(e) => setAdminOnlineColor(e.target.value)}
                  className="h-9 w-12 rounded border border-input bg-transparent cursor-pointer"
                  aria-label="Admin colour"
                />
                <Input
                  type="text"
                  value={adminOnlineColor}
                  onChange={(e) => setAdminOnlineColor(e.target.value)}
                  placeholder="#a78bfa"
                  className="w-24 font-mono text-[11px]"
                />
                <span className="text-[10px] text-mutedForeground font-heading">Admin</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={modDefaultOnlineColor}
                  onChange={(e) => setModDefaultOnlineColor(e.target.value)}
                  className="h-9 w-12 rounded border border-input bg-transparent cursor-pointer"
                  aria-label="Mod default colour"
                />
                <Input
                  type="text"
                  value={modDefaultOnlineColor}
                  onChange={(e) => setModDefaultOnlineColor(e.target.value)}
                  placeholder="#1e3a5f"
                  className="w-24 font-mono text-[11px]"
                />
                <span className="text-[10px] text-mutedForeground font-heading">Mod default (fallback if mod has not set a colour in Mod display)</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-primary/10">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-heading">
                <input
                  type="checkbox"
                  checked={requireEmailVerification}
                  onChange={(e) => setRequireEmailVerification(e.target.checked)}
                  className="rounded border-input"
                />
                <span>Require email verification for new signups</span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-primary/10">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-heading">
                <input
                  type="checkbox"
                  checked={blockProxyVpnLogin}
                  onChange={(e) => setBlockProxyVpnLogin(e.target.checked)}
                  className="rounded border-input"
                />
                <span>Block proxy/VPN on login and signup</span>
              </label>
            </div>
            <div className="space-y-2 pt-2 border-t border-primary/10">
              <p className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground">Anti-bot / script clients</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-heading">
                  <input
                    type="checkbox"
                    checked={blockScriptUserAgentLogin}
                    onChange={(e) => setBlockScriptUserAgentLogin(e.target.checked)}
                    className="rounded border-input"
                  />
                  <span>
                    Block script-like clients on login, register, preregister, and minigames (User-Agent markers, browser-shaped UA, Sec-Fetch headers)
                  </span>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-6">
                <button
                  type="button"
                  disabled={blockScriptUaSaving || blockScriptUserAgentLogin}
                  onClick={() => applyBlockScriptUserAgentLogin(true)}
                  className="px-2.5 py-1 rounded border border-primary/40 bg-primary/10 text-[11px] font-heading text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {blockScriptUaSaving ? '…' : 'Enable blocking'}
                </button>
                <button
                  type="button"
                  disabled={blockScriptUaSaving || !blockScriptUserAgentLogin}
                  onClick={() => applyBlockScriptUserAgentLogin(false)}
                  className="px-2.5 py-1 rounded border border-zinc-600 bg-zinc-800/80 text-[11px] font-heading text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {blockScriptUaSaving ? '…' : 'Disable blocking'}
                </button>
                <span className="text-[10px] text-mutedForeground font-heading">Applies immediately. Also saved with &quot;Save settings&quot; below.</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-heading">
                  <input
                    type="checkbox"
                    checked={blockScriptUserAgentGameActions}
                    onChange={(e) => setBlockScriptUserAgentGameActions(e.target.checked)}
                    className="rounded border-input"
                  />
                  <span>
                    Block script-like clients on crimes, GTA, jail, OC (crew + organised crime), bodyguards, and attack (same
                    User-Agent / Sec-Fetch checks as above; independent toggle)
                  </span>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-6">
                <button
                  type="button"
                  disabled={blockScriptGameActionsSaving || blockScriptUserAgentGameActions}
                  onClick={() => applyBlockScriptUserAgentGameActions(true)}
                  className="px-2.5 py-1 rounded border border-primary/40 bg-primary/10 text-[11px] font-heading text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {blockScriptGameActionsSaving ? '…' : 'Enable gameplay blocking'}
                </button>
                <button
                  type="button"
                  disabled={blockScriptGameActionsSaving || !blockScriptUserAgentGameActions}
                  onClick={() => applyBlockScriptUserAgentGameActions(false)}
                  className="px-2.5 py-1 rounded border border-zinc-600 bg-zinc-800/80 text-[11px] font-heading text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {blockScriptGameActionsSaving ? '…' : 'Disable gameplay blocking'}
                </button>
              </div>
              <label className="flex items-start gap-2 cursor-pointer text-sm font-heading pt-1">
                <input
                  type="checkbox"
                  checked={gameActionsClientStrict}
                  onChange={(e) => setGameActionsClientStrict(e.target.checked)}
                  className="rounded border-input mt-0.5"
                />
                <span>
                  Strict client headers on gameplay actions (Sec-Fetch mode/dest/site + JSON Accept on writes). Off by default;
                  QA on Safari iOS / Chrome Android before enabling in production.
                </span>
              </label>
            </div>
            <div className="space-y-2 pt-2 border-t border-primary/10">
              <p className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground">Minigames — Cloudflare Turnstile</p>
              <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
                Require a captcha before each minigame run (and gauntlet). Set <code className="text-[9px] bg-muted px-1 rounded">TURNSTILE_SECRET_KEY</code> in the server environment; optionally override the public site key here or via <code className="text-[9px] bg-muted px-1 rounded">TURNSTILE_SITE_KEY</code>. Login Turnstile uses the same public site key and secret.
              </p>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-heading">
                <input
                  type="checkbox"
                  checked={minigameTurnstileEnabled}
                  onChange={(e) => setMinigameTurnstileEnabled(e.target.checked)}
                  className="rounded border-input"
                />
                <span>Enable Turnstile before minigame / gauntlet runs</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-heading">
                <input
                  type="checkbox"
                  checked={loginTurnstileEnabled}
                  onChange={(e) => setLoginTurnstileEnabled(e.target.checked)}
                  className="rounded border-input"
                />
                <span>Require Turnstile on login</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-sm font-heading">
                <input
                  type="checkbox"
                  checked={gameActionsTurnstileEnabled}
                  onChange={(e) => setGameActionsTurnstileEnabled(e.target.checked)}
                  className="rounded border-input mt-0.5"
                />
                <span>
                  Require Turnstile before GTA melt/scrap and booze sell (same public site key as minigames; not used on crime
                  commits)
                </span>
              </label>
              <div className="flex flex-col gap-1 max-w-md">
                <label className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground">Site key (public)</label>
                <input
                  type="text"
                  value={minigameTurnstileSiteKey}
                  onChange={(e) => setMinigameTurnstileSiteKey(e.target.value)}
                  placeholder="0x4AAAA…"
                  className="w-full px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-mono font-heading"
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCaptchaFailModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-primary/40 bg-primary/10 text-[11px] font-heading text-primary hover:bg-primary/20"
                >
                  <Eye size={14} />
                  View captcha failures
                </button>
                <span className="text-[10px] text-mutedForeground font-heading">
                  Users who hit Turnstile without a token, failed verify, or triggered misconfig (logged with IP, path, UA, Cloudflare codes).
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-primary/10">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-heading">
                <input
                  type="checkbox"
                  checked={spotifyFeatureEnabled}
                  onChange={(e) => setSpotifyFeatureEnabled(e.target.checked)}
                  className="rounded border-input"
                />
                <span>Enable Spotify feature for players (admins can always test)</span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-primary/10">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-heading">
                <input
                  type="checkbox"
                  checked={landingBannerEnabled}
                  onChange={(e) => setLandingBannerEnabled(e.target.checked)}
                  className="rounded border-input"
                />
                <span>Show beta/release banner on login page</span>
              </label>
            </div>
            <div className="pt-2 border-t border-primary/10">
              <label className="block text-[10px] font-heading uppercase tracking-wider text-mutedForeground mb-1">Banner message (supports newlines)</label>
              <textarea
                value={landingBannerMessage}
                onChange={(e) => setLandingBannerMessage(e.target.value)}
                placeholder="Beta round end: March 24 6pm. Full release March 28th 6pm. Beta is for trying the game and features."
                rows={3}
                className="w-full px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading resize-y"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-primary/10">
              <label className="text-sm font-heading text-foreground">Stock market max points (per user cap)</label>
              <input
                type="number"
                min={1}
                value={stockMarketMaxPoints}
                onChange={(e) => setStockMarketMaxPoints(Math.max(1, parseInt(e.target.value, 10) || 3000))}
                className="w-24 px-2 py-1 rounded border border-input bg-background text-foreground font-mono text-sm"
              />
              <span className="text-mutedForeground text-xs">Total points in open positions cannot exceed this.</span>
            </div>
            <BtnPrimary onClick={handleSaveAdminSettings} disabled={adminSettingsSaving}>
              {adminSettingsSaving ? 'Saving...' : 'Save settings'}
            </BtnPrimary>
          </div>
        )}
        </div>
        )}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Bell}
          title="Maintenance Banner"
          badge={maintenanceBanner?.enabled ? <span className="text-[10px] font-heading text-amber-400">Active</span> : null}
          toolAnchor="maintenanceBanner"
          isCollapsed={collapsed.maintenanceBanner}
          onToggle={() => { toggleSection('maintenanceBanner'); if (collapsed.maintenanceBanner && !maintenanceBanner) handleFetchMaintenanceBanner(); }}
        />
        {!collapsed.maintenanceBanner && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground font-heading">Set a maintenance banner visible to all players. They see a countdown and your message.</p>
            <div className="flex flex-wrap items-center gap-2">
              <BtnPrimary onClick={handleFetchMaintenanceBanner} disabled={maintenanceBannerLoading}>
                {maintenanceBannerLoading ? '...' : 'Refresh status'}
              </BtnPrimary>
              <span className="text-[10px] font-heading">
                {maintenanceBanner?.enabled ? <span className="text-amber-400 font-bold">Banner is ON</span> : <span className="text-mutedForeground">Banner is OFF</span>}
              </span>
            </div>
            <div className="space-y-1">
              <input
                type="text"
                value={maintenanceMsg}
                onChange={(e) => setMaintenanceMsg(e.target.value)}
                placeholder="Maintenance message..."
                className="w-full px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={maintenanceDuration}
                  onChange={(e) => setMaintenanceDuration(parseInt(e.target.value, 10) || 60)}
                  className="w-24 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono"
                />
                <span className="text-[10px] text-mutedForeground">minutes duration</span>
              </div>
              <div className="flex gap-2">
                <BtnPrimary onClick={() => handleSetMaintenanceBanner(true)} disabled={maintenanceBannerLoading}>Enable banner</BtnPrimary>
                <BtnDanger onClick={() => handleSetMaintenanceBanner(false)} disabled={maintenanceBannerLoading}>Disable</BtnDanger>
              </div>
            </div>
          </div>
        )}
        </div>

        {isAdmin && (
        <>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={AlertTriangle}
          title="Release soft-launch"
          badge={releaseSoftLaunchAdmin?.release_soft_launch_enabled ? <span className="text-[10px] font-heading text-amber-400">Active</span> : null}
          toolAnchor="releaseSoftLaunch"
          isCollapsed={collapsed.releaseSoftLaunch}
          onToggle={() => { toggleSection('releaseSoftLaunch'); if (collapsed.releaseSoftLaunch && !releaseSoftLaunchAdmin) handleFetchReleaseSoftLaunch(); }}
        />
        {!collapsed.releaseSoftLaunch && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground font-heading">
              While enabled, each feature stays off until its own unlock time (below). Game Pass / points use the first field; PvP kills on real players use the second (often later). Hitlist NPCs are unaffected. Leave this enabled if you still want banners until staff disable it.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <BtnPrimary onClick={handleFetchReleaseSoftLaunch} disabled={releaseSoftLaunchLoading}>
                {releaseSoftLaunchLoading ? '…' : 'Refresh status'}
              </BtnPrimary>
              <span className="text-[10px] font-heading text-mutedForeground">
                {releaseSoftLaunchAdmin?.pvp_kills_disabled ? <span className="text-amber-400 font-bold">Player PvP kills paused</span> : <span>Player PvP kills allowed</span>}
              </span>
            </div>
            {releaseSoftLaunchAdmin && (
              <div className="text-[10px] text-mutedForeground font-heading space-y-1">
                <p>
                  Game Pass / points:{' '}
                  <span className={releaseSoftLaunchAdmin.game_pass_purchase_locked ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                    {releaseSoftLaunchAdmin.game_pass_purchase_locked ? 'locked' : 'unlocked'}
                  </span>
                  {releaseSoftLaunchAdmin.game_pass_unlock_at && (
                    <span className="text-foreground font-mono text-[9px] ml-1">{releaseSoftLaunchAdmin.game_pass_unlock_at}</span>
                  )}
                </p>
                <p>
                  PvP kills:{' '}
                  <span className={releaseSoftLaunchAdmin.pvp_kills_disabled ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                    {releaseSoftLaunchAdmin.pvp_kills_disabled ? 'paused' : 'allowed'}
                  </span>
                  {releaseSoftLaunchAdmin.pvp_kills_unlock_at && (
                    <span className="text-foreground font-mono text-[9px] ml-1">{releaseSoftLaunchAdmin.pvp_kills_unlock_at}</span>
                  )}
                </p>
              </div>
            )}
            <div>
              <label className="block text-[10px] font-heading uppercase tracking-wider text-mutedForeground mb-1">Unlock — points store / Game Pass (ISO 8601, UTC)</label>
              <input
                type="text"
                value={releaseSoftLaunchUnlockAt}
                onChange={(e) => setReleaseSoftLaunchUnlockAt(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-mono text-foreground"
                placeholder="2026-04-01T12:00:00+00:00"
              />
            </div>
            <div>
              <label className="block text-[10px] font-heading uppercase tracking-wider text-mutedForeground mb-1">Unlock — PvP kills on players (ISO 8601, UTC)</label>
              <input
                type="text"
                value={releaseSoftLaunchPvpUnlockAt}
                onChange={(e) => setReleaseSoftLaunchPvpUnlockAt(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-mono text-foreground"
                placeholder="2026-04-04T17:00:00+00:00"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <BtnPrimary onClick={() => handleSetReleaseSoftLaunch(true)} disabled={releaseSoftLaunchLoading}>Enable soft-launch</BtnPrimary>
              <BtnDanger onClick={() => handleSetReleaseSoftLaunch(false)} disabled={releaseSoftLaunchLoading}>Disable soft-launch</BtnDanger>
            </div>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Car}
            title="Drop exclusive into GTA pool"
            badge={
              gtaExclusiveReleased === null ? null : (
                <span className={`text-[10px] font-heading font-bold ${gtaExclusiveReleased ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {gtaExclusiveReleased ? 'In pool' : 'Retracted'}
                </span>
              )
            }
            toolAnchor="gtaPool"
            isCollapsed={collapsed.gtaPool}
            onToggle={() => {
              toggleSection('gtaPool');
              if (collapsed.gtaPool) fetchGtaExclusivePool();
            }}
          />
          {!collapsed.gtaPool && (
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-zinc-700/50">
                <span className="text-[10px] font-heading text-mutedForeground">Al Capone exclusive (car20) in GTA pool:</span>
                {gtaExclusiveReleased === null ? (
                  <span className="text-[10px] text-mutedForeground">…</span>
                ) : (
                  <>
                    <span className={`text-[10px] font-heading font-bold ${gtaExclusiveReleased ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {gtaExclusiveReleased ? 'Released (very rare drop)' : 'Retracted'}
                    </span>
                    <button
                      type="button"
                      disabled={gtaExclusiveLoading}
                      onClick={() => handleSetGtaExclusivePool(!gtaExclusiveReleased)}
                      className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-[10px] font-heading font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {gtaExclusiveLoading ? '…' : gtaExclusiveReleased ? 'Retract from pool' : 'Release into pool'}
                    </button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-zinc-700/50">
                <span className="text-[10px] font-heading text-mutedForeground">Current drop weight:</span>
                <span className="text-[10px] font-heading font-bold text-primary">{Number(gtaExclusiveDropWeight || 0).toExponential(3)}</span>
                <span className="text-[10px] text-mutedForeground">(about 1 in {Number(gtaExclusiveApproxOneIn || 0).toLocaleString()})</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step="0.0000001"
                  min="0.0000001"
                  max="0.05"
                  value={gtaExclusiveDropWeightInput}
                  onChange={(e) => setGtaExclusiveDropWeightInput(e.target.value)}
                  className="w-36 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono"
                  placeholder="0.000006"
                />
                <button
                  type="button"
                  disabled={gtaExclusiveLoading}
                  onClick={handleSetGtaExclusiveOdds}
                  className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-[10px] font-heading font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  {gtaExclusiveLoading ? '…' : 'Set odds'}
                </button>
                <span className="text-[10px] text-mutedForeground">Range: 0.0000001 to 0.05</span>
              </div>
              <p className="text-[10px] text-mutedForeground font-heading">When released, the Al Capone exclusive can drop from GTA (very rare). Only one in game at a time. GTA logs are in the &quot;GTA logs (post data)&quot; section further down.</p>

              {/* Edit exclusive car values — inline */}
              <div className="pt-3 border-t border-zinc-700/50 space-y-2">
                <span className="text-[10px] font-heading text-mutedForeground block">Edit exclusive car values:</span>
                {exclusiveCarValuesLoading && <span className="text-[10px] text-mutedForeground">Loading...</span>}
                {exclusiveCarValues.map((c) => {
                  const valId = `car-val-${c.id}`;
                  const travId = `car-trav-${c.id}`;
                  return (
                    <div key={c.id} className="flex flex-wrap items-center gap-2 p-2 rounded border border-zinc-700/30 bg-zinc-900/30">
                      <span className="text-[10px] font-heading text-foreground min-w-[140px]">{c.name}</span>
                      <span className="text-[9px] text-primary font-heading">{c.rarity}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-mutedForeground">Value $</span>
                        <input id={valId} type="number" min="0" key={`v-${c.id}-${c.value}`} defaultValue={c.value} className="w-36 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-mutedForeground">Travel</span>
                        <input id={travId} type="number" min="0" max="100" key={`t-${c.id}-${c.travel_bonus}`} defaultValue={c.travel_bonus} className="w-16 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                      </div>
                      <button
                        type="button"
                        disabled={editCarSaving && editCarId === c.id}
                        onClick={() => {
                          const v = document.getElementById(valId)?.value;
                          const t = document.getElementById(travId)?.value;
                          handleEditCarValue(c.id, v, t);
                        }}
                        className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-[10px] font-heading font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        {editCarSaving && editCarId === c.id ? '...' : 'Save'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-zinc-700/50 space-y-2">
                <span className="text-[10px] font-heading text-mutedForeground block">Give every user an exclusive car (if they don&apos;t already have it):</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={giveEveryoneExclusiveLoading}
                    onClick={() => handleGiveEveryoneExclusiveCars(true, false)}
                    className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-[10px] font-heading font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                  >
                    {giveEveryoneExclusiveLoading ? '…' : 'Give everyone loot exclusive (car21)'}
                  </button>
                  <button
                    type="button"
                    disabled={giveEveryoneExclusiveLoading}
                    onClick={() => handleGiveEveryoneExclusiveCars(false, true)}
                    className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-[10px] font-heading font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                  >
                    {giveEveryoneExclusiveLoading ? '…' : 'Give everyone Al Capone (car20)'}
                  </button>
                  <button
                    type="button"
                    disabled={giveEveryoneExclusiveLoading}
                    onClick={() => handleGiveEveryoneExclusiveCars(true, true)}
                    className="px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-[10px] font-heading font-bold text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {giveEveryoneExclusiveLoading ? '…' : 'Give everyone both'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        </>
        )}
      </section>
      )}

      {activeCategoryId === 'admin-operations' && isAdmin && (
      <section id="admin-security" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Globe size={12} />
          Security & Cloudflare
        </h2>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Users}
          title="Session stats"
          badge={
            <span className="text-[10px] font-heading">
              {sessionStatsLoading ? (
                <span className="text-mutedForeground">Loading...</span>
              ) : sessionStats != null ? (
                <span className="text-foreground">{sessionStats.total_sessions ?? 0} active session(s)</span>
              ) : (
                <span className="text-mutedForeground">—</span>
              )}
            </span>
          }
          toolAnchor="sessionStats"
          isCollapsed={collapsed.sessionStats}
          onToggle={() => toggleSection('sessionStats')}
        />
        {!collapsed.sessionStats && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground">
              Total active sessions across all users. Revoke all sessions that have had no activity for 24+ hours.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <BtnPrimary onClick={handleLoadSessionStats} disabled={sessionStatsLoading}>
                {sessionStatsLoading ? '...' : 'Refresh'}
              </BtnPrimary>
              {sessionStats != null && (
                <span className="text-[10px] text-mutedForeground">
                  {sessionStats.users_with_sessions ?? 0} user(s) with sessions
                </span>
              )}
              <button
                type="button"
                onClick={handleRevokeOldSessions}
                disabled={revokeOldSessionsLoading}
                className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
              >
                {revokeOldSessionsLoading ? '...' : 'Log out sessions older than 24h'}
              </button>
            </div>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Shield}
          title="Cloudflare Bot Blocking"
          badge={
            <span className="text-[10px] font-heading">
              {cfBotBlockError ? (
                <span className="text-amber-400">Not configured</span>
              ) : cfBotBlockEnabled === null ? (
                <span className="text-mutedForeground">Loading...</span>
              ) : cfBotBlockEnabled ? (
                <span className="text-emerald-400">Blocking bots</span>
              ) : (
                <span className="text-red-400">Allowing bots</span>
              )}
            </span>
          }
          toolAnchor="cfBotBlock"
          isCollapsed={collapsed.cfBotBlock}
          onToggle={() => toggleSection('cfBotBlock')}
        />
        {!collapsed.cfBotBlock && (
          <div className="p-3 space-y-2">
            {cfBotBlockError ? (
              <p className="text-[10px] text-amber-400">{cfBotBlockError}</p>
            ) : (
              <>
                <p className="text-[10px] text-mutedForeground">
                  Toggle the &quot;Block All Bots&quot; rule in Cloudflare. When enabled, known bots (Google, SEO tools, AI crawlers) are blocked.
                </p>
                <div className="flex flex-wrap gap-2">
                  <BtnPrimary
                    onClick={handleToggleCfBotBlock}
                    disabled={cfBotBlockLoading || cfBotBlockEnabled === null}
                  >
                    {cfBotBlockLoading ? 'Updating...' : cfBotBlockEnabled ? 'Disable Bot Blocking' : 'Enable Bot Blocking'}
                  </BtnPrimary>
                </div>
              </>
            )}
          </div>
        )}
        </div>


        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Bot}
          title="Block Automation Scripts"
          badge={
            <span className="text-[10px] font-heading">
              {cfAutoBlockError ? (
                <span className="text-amber-400">Not configured</span>
              ) : cfAutoBlockEnabled === null ? (
                <span className="text-mutedForeground">Loading...</span>
              ) : cfAutoBlockEnabled ? (
                <span className="text-emerald-400">Blocking scripts</span>
              ) : (
                <span className="text-red-400">Allowing scripts</span>
              )}
            </span>
          }
          toolAnchor="cfAutoBlock"
          isCollapsed={collapsed.cfAutoBlock}
          onToggle={() => toggleSection('cfAutoBlock')}
        />
        {!collapsed.cfAutoBlock && (
          <div className="p-3 space-y-2">
            {cfAutoBlockError ? (
              <p className="text-[10px] text-amber-400">{cfAutoBlockError}</p>
            ) : (
              <>
                <p className="text-[10px] text-mutedForeground">
                  Toggle the &quot;Block Automation Scripts&quot; rule. Blocks Python, Java, Selenium, Puppeteer, curl, and other automation tools players might use to cheat.
                </p>
                <div className="flex flex-wrap gap-2">
                  <BtnPrimary
                    onClick={handleToggleCfAutoBlock}
                    disabled={cfAutoBlockLoading || cfAutoBlockEnabled === null}
                  >
                    {cfAutoBlockLoading ? 'Updating...' : cfAutoBlockEnabled ? 'Disable Script Blocking' : 'Enable Script Blocking'}
                  </BtnPrimary>
                </div>
              </>
            )}
          </div>
        )}
        </div>


            {isAdmin && (
              <div>
                <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Broadcast system message</div>
                <p className="text-xs text-mutedForeground mb-2">
                  Send a one-off system notification to all users (respects their notification preferences for system messages).
                </p>
                <div className="space-y-1">
                  <input
                    type="text"
                    value={broadcastTitle}
                    onChange={(e) => setBroadcastTitle(e.target.value)}
                    placeholder="Title (optional, defaults to 'System message')"
                    className="w-full px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
                  />
                  <textarea
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="Message to send to all users..."
                    rows={3}
                    className="w-full px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading resize-y"
                  />
                  <button
                    type="button"
                    onClick={handleBroadcastSystemMessage}
                    disabled={broadcastSending}
                    className="px-3 py-1.5 rounded text-[10px] font-heading font-bold uppercase border bg-primary/20 border-primary/40 text-primary hover:bg-primary/30 disabled:opacity-50"
                  >
                    {broadcastSending ? 'Sending…' : 'Send to all users'}
                  </button>
                </div>
              </div>
            )}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Shield}
          title="Security & Anti-Cheat"
          badge={
            securitySummary && (
              <span className="text-[10px] font-heading text-mutedForeground">
                {securitySummary.total_flags || 0} flags · {securitySummary.unique_users_flagged || 0} users
              </span>
            )
          }
          toolAnchor="security"
          isCollapsed={collapsed.security}
          onToggle={() => toggleSection('security')}
        />
        {!collapsed.security && (
          <div className="p-2 space-y-1">
            <ActionRow icon={Shield} label="View Security Summary" description="Load recent security flags">
              <BtnPrimary onClick={handleFetchSecuritySummary} disabled={securityLoading}>
                {securityLoading ? '...' : 'Load'}
              </BtnPrimary>
            </ActionRow>

            <ActionRow icon={Lock} label="Login issues (lockouts)" description="Users locked out after too many failed login attempts">
              <BtnPrimary onClick={fetchLoginIssues} disabled={loginIssuesLoading}>
                {loginIssuesLoading ? '...' : 'Load'}
              </BtnPrimary>
            </ActionRow>
            <ActionRow icon={AlertTriangle} label="Profile load errors" description="Failed to load profile (auth/me 500) – see what went wrong for which user">
              <BtnPrimary onClick={fetchProfileLoadErrors} disabled={profileLoadErrorsLoading}>
                {profileLoadErrorsLoading ? '...' : 'Load'}
              </BtnPrimary>
            </ActionRow>
            {profileLoadErrors && profileLoadErrors.length > 0 && (
              <div className="mt-2 p-3 rounded bg-zinc-900/50 border border-zinc-700/50">
                <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Recent profile load errors ({profileLoadErrors.length})</div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {profileLoadErrors.map((row, i) => (
                    <div key={row.id || i} className="text-[10px] p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                      <div className="flex justify-between gap-2 mb-1">
                        <span className="font-bold text-foreground">@{row.username || row.user_id || '?'}</span>
                        <span className="text-mutedForeground">{row.created_at ? new Date(row.created_at).toLocaleString() : ''}</span>
                      </div>
                      <div className="text-amber-400 font-mono break-all">{row.error}</div>
                      {row.traceback && (
                        <pre className="mt-1 p-1 rounded bg-black/40 text-[9px] overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto">{row.traceback}</pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {profileLoadErrors && profileLoadErrors.length === 0 && (
              <div className="text-[10px] text-mutedForeground font-heading">No profile load errors recorded.</div>
            )}
            {loginIssues && loginIssues.length > 0 && (
              <div className="mt-2 p-3 rounded bg-zinc-900/50 border border-zinc-700/50">
                <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Locked-out emails ({loginIssues.length})</div>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {loginIssues.map((row, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-[10px] p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                      <div className="min-w-0">
                        <div className="font-mono text-foreground truncate">{row.email}</div>
                        <div className="flex items-center gap-2 mt-0.5 text-mutedForeground">
                          {row.username && <span>@{row.username}</span>}
                          <span>Failed: {row.failed_count}</span>
                          {row.still_locked && <span className="text-amber-400 font-bold">Locked</span>}
                          {row.locked_until && <span>Until: {new Date(row.locked_until).toLocaleString()}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => clearLoginLockoutByEmail(row.email)}
                        className="shrink-0 px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30"
                      >
                        Clear
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {loginIssues && loginIssues.length === 0 && (
              <div className="text-[10px] text-mutedForeground font-heading">No login lockouts.</div>
            )}

            {securitySummary && (
              <div className="mt-2 p-3 rounded bg-zinc-900/50 border border-zinc-700/50 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-mutedForeground">Total Flags:</span>
                    <span className="ml-2 text-foreground font-bold">{securitySummary.total_flags}</span>
                  </div>
                  <div>
                    <span className="text-mutedForeground">Users Flagged:</span>
                    <span className="ml-2 text-foreground font-bold">{securitySummary.unique_users_flagged}</span>
                  </div>
                  <div>
                    <span className="text-mutedForeground">Telegram:</span>
                    <span className={`ml-2 font-bold ${securitySummary.telegram_configured ? 'text-emerald-400' : 'text-red-400'}`}>
                      {securitySummary.telegram_configured ? 'Active' : 'Not Configured'}
                    </span>
                  </div>
                </div>

                {securitySummary.by_type && Object.keys(securitySummary.by_type).length > 0 && (
                  <div>
                    <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Flags by Type:</div>
                    <div className="space-y-1">
                      {Object.entries(securitySummary.by_type).map(([type, count]) => (
                        <div key={type} className="flex justify-between text-[10px]">
                          <span className="text-foreground">{type}</span>
                          <span className="text-primary font-bold">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {securitySummary.recent_flags && securitySummary.recent_flags.length > 0 && (
                  <div>
                    <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Recent Flags:</div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {securitySummary.recent_flags.slice(0, 10).map((flag, i) => (
                        <div key={i} className="text-[10px] p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                          <div className="flex justify-between mb-1">
                            <span className="text-primary font-bold">{flag.username}</span>
                            <span className="text-mutedForeground">{flag.flag_type}</span>
                          </div>
                          <div className="text-mutedForeground">{flag.reason}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <ActionRow icon={Shield} label="Rate Limits (Cooldown)" description={rateLimits?.global_enabled ? "ENABLED - Users see cooldown when clicking too fast" : "DISABLED - No cooldown protection"}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${rateLimits?.global_enabled ? 'text-green-400' : 'text-red-400'}`}>
                  {rateLimits?.global_enabled ? 'ON' : 'OFF'}
                </span>
                <BtnPrimary onClick={handleViewRateLimits} disabled={securityLoading}>
                  {securityLoading ? '...' : 'Refresh'}
                </BtnPrimary>
                {rateLimits?.global_enabled ? (
                  <BtnDanger onClick={handleDisableAllLimits} disabled={securityLoading}>
                    {securityLoading ? '...' : 'Disable'}
                  </BtnDanger>
                ) : (
                  <BtnPrimary onClick={handleEnableAllLimits} disabled={securityLoading}>
                    {securityLoading ? '...' : 'Enable'}
                  </BtnPrimary>
                )}
              </div>
            </ActionRow>

            <ActionRow icon={Shield} label="Set All Rate Limits" description="Set all endpoints to the same interval">
              <div className="flex items-center gap-1 flex-wrap">
                {[500, 1000, 1500, 2000, 3000, 5000].map(ms => (
                  <button
                    key={ms}
                    onClick={() => handleSetAllRateLimitInterval(ms)}
                    disabled={securityLoading}
                    className="px-2 py-1 text-[10px] rounded bg-zinc-700/50 hover:bg-zinc-600 text-foreground border border-zinc-600/30 transition-colors"
                  >
                    {ms >= 1000 ? `${ms/1000}s` : `${ms}ms`}
                  </button>
                ))}
              </div>
            </ActionRow>

            {rateLimits && rateLimits.rate_limits && (
              <div className="mt-2 p-3 rounded bg-zinc-900/50 border border-zinc-700/50 space-y-2">
                <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Rate limit (ms between clicks):</div>
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {Object.entries(rateLimits.rate_limits).map(([endpoint, val]) => {
                    const minIntervalMs = Array.isArray(val) ? val[0] : (val?.min_interval_ms ?? 1000);
                    const enabled = Array.isArray(val) ? val[1] : (val?.enabled ?? false);
                    const editValue = rateLimitEdits[endpoint] !== undefined ? rateLimitEdits[endpoint] : minIntervalMs;
                    const hasChanged = Number(editValue) !== Number(minIntervalMs);
                    const displayLabel = Number(editValue) >= 1000 ? `${(Number(editValue) / 1000).toFixed(1)}s` : `${Number(editValue)}ms`;

                    return (
                      <div key={endpoint} className="flex flex-col gap-2 text-[10px] p-2 rounded bg-zinc-800/50 border border-zinc-700/30 hover:border-primary/30 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground font-mono text-[11px] truncate mb-0.5">{endpoint}</div>
                          </div>
                          <button
                            onClick={() => handleToggleRateLimit(endpoint, enabled)}
                            className={`shrink-0 px-2 py-1 rounded text-[9px] font-bold transition-all ${
                              enabled
                                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30'
                                : 'bg-zinc-700/50 text-mutedForeground hover:bg-zinc-700 border border-zinc-600/30'
                            }`}
                          >
                            {enabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="60000"
                            step="50"
                            value={editValue}
                            onChange={(e) => setRateLimitEdits({...rateLimitEdits, [endpoint]: parseFloat(e.target.value) || 0})}
                            className="flex-1 bg-zinc-900/70 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-foreground focus:border-primary/50 focus:outline-none"
                          />
                          <span className="text-mutedForeground text-[9px] whitespace-nowrap">ms ({displayLabel})</span>
                          {hasChanged && (
                            <button
                              onClick={() => handleUpdateRateLimit(endpoint, editValue)}
                              className="px-2 py-1 rounded text-[9px] font-bold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-all"
                            >
                              SAVE
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {rateLimits.note && (
                  <p className="text-[9px] text-mutedForeground italic mt-2">{rateLimits.note}</p>
                )}
                {rateLimits.endpoint_rl_policy?.summary && (
                  <p className="text-[9px] text-zinc-400 mt-1.5 font-heading leading-relaxed">
                    {rateLimits.endpoint_rl_policy.summary}
                    {rateLimits.endpoint_rl_policy.burst_tokens != null && (
                      <span className="block mt-0.5 text-mutedForeground">
                        Burst {rateLimits.endpoint_rl_policy.burst_tokens} · sustain {rateLimits.endpoint_rl_policy.sustain_min_violations}+
                        hits in {rateLimits.endpoint_rl_policy.sustain_window_sec}s spanning ≥{rateLimits.endpoint_rl_policy.sustain_min_span_sec}s → hard cooldown{' '}
                        {Array.isArray(rateLimits.endpoint_rl_policy.hard_cooldown_sec_range)
                          ? `${rateLimits.endpoint_rl_policy.hard_cooldown_sec_range[0]}–${rateLimits.endpoint_rl_policy.hard_cooldown_sec_range[1]}s`
                          : ''}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}

            {/* Rate Limit Log */}
            <div className="mt-3 pt-3 border-t border-zinc-700/50">
              <div className="text-[10px] font-heading text-primary uppercase tracking-wider mb-2">Rate Limit Violations Log</div>
              <p className="text-[10px] text-mutedForeground mb-2">Users who hit rate limits. Shows why they got cooldown and which endpoints.</p>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={rateLimitLogUsername}
                  onChange={(e) => setRateLimitLogUsername(e.target.value)}
                  placeholder="Filter by username"
                  className="w-40 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnPrimary onClick={fetchRateLimitLog} disabled={rateLimitLogLoading}>
                  {rateLimitLogLoading ? '...' : 'Load Log'}
                </BtnPrimary>
                {rateLimitLog && rateLimitLog.count > 0 && (
                  <BtnDanger onClick={handleClearAllRateLimitLog} disabled={rateLimitLogLoading}>Clear All</BtnDanger>
                )}
              </div>
              {rateLimitLog && (
                <div className="space-y-2">
                  <div className="flex items-center gap-4 text-[10px] text-mutedForeground">
                    <span>Total violations: <span className="text-foreground font-bold">{rateLimitLog.count}</span></span>
                    <span>Unique users: <span className="text-foreground font-bold">{rateLimitLog.unique_users}</span></span>
                  </div>
                  {rateLimitLog.by_user && rateLimitLog.by_user.length > 0 && (
                    <div className="rounded bg-zinc-900/50 border border-zinc-700/50 p-2">
                      <div className="text-[9px] font-heading text-mutedForeground uppercase mb-2">By User (top offenders)</div>
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {rateLimitLog.by_user.map((u, i) => (
                          <div key={i} className="flex items-start justify-between gap-2 text-[10px] py-2 px-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-primary">{u.username}</span>
                                <span className="text-amber-400 font-mono">{u.count} violation{u.count !== 1 ? 's' : ''}</span>
                              </div>
                              <div className="text-[9px] text-mutedForeground mb-1">
                                First: {u.first_at ? new Date(u.first_at).toLocaleString() : '—'} · Last: {u.last_at ? new Date(u.last_at).toLocaleString() : '—'}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(u.endpoints || {}).map(([ep, cnt]) => (
                                  <span key={ep} className="px-1.5 py-0.5 rounded bg-zinc-700/50 text-[8px] font-mono">
                                    {ep.replace('/api/', '')} <span className="text-amber-400">×{cnt}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {rateLimitLog.entries && rateLimitLog.entries.length > 0 && (
                    <details className="rounded border border-zinc-700/30 bg-zinc-800/30 overflow-hidden">
                      <summary className="px-2.5 py-2 cursor-pointer text-[10px] font-heading font-bold text-mutedForeground uppercase tracking-wider hover:bg-zinc-700/30 list-none">
                        Detailed Log ({rateLimitLog.entries.length} entries)
                      </summary>
                      <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                        {rateLimitLog.entries.map((e, i) => (
                          <div key={i} className="text-[9px] py-1.5 px-2 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className="font-bold text-primary">{e.username}</span>
                              <span className="text-mutedForeground">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</span>
                            </div>
                            <div className="text-foreground mb-0.5">{e.reason}</div>
                            {e.details && (
                              <div className="text-mutedForeground">
                                Path: <span className="font-mono text-amber-400">{e.details.path}</span>
                                {e.details.min_interval_sec && <span className="ml-2">Limit: {e.details.min_interval_sec}s</span>}
                                {e.details.elapsed_sec !== undefined && <span className="ml-2">Actual: {e.details.elapsed_sec}s</span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>

            <ActionRow icon={Trash2} label="Clear Old Flags" description="Remove flags older than 30 days" color="text-red-400">
              <BtnDanger onClick={handleClearOldFlags} disabled={securityLoading}>
                {securityLoading ? '...' : 'Clear'}
              </BtnDanger>
            </ActionRow>

            {/* Cheat Detection Config */}
            <div className="mt-3 pt-3 border-t border-zinc-700/50">
              <div className="text-[10px] font-heading text-primary uppercase tracking-wider mb-2">Cheat Detection Toggles</div>
              <p className="text-[10px] text-mutedForeground mb-2">Enable/disable exploit checks. Duplicate request and negative balance are off by default.</p>
              <BtnSecondary onClick={fetchCheatDetectionConfig} disabled={cheatDetectionConfigLoading} className="mb-2">
                {cheatDetectionConfigLoading ? '...' : 'Load config'}
              </BtnSecondary>
              {cheatDetectionConfig && (
                <div className="space-y-2 p-2 rounded bg-zinc-900/50 border border-zinc-700/50">
                  <label className="flex items-center gap-2 text-[10px] cursor-pointer">
                    <input type="checkbox" checked={!!cheatDetectionConfig.detect_duplicate_requests} onChange={(e) => updateCheatDetectionConfig({ detect_duplicate_requests: e.target.checked })} className="rounded" />
                    Detect duplicate requests (200-500ms window)
                  </label>
                  <label className="flex items-center gap-2 text-[10px] cursor-pointer">
                    <input type="checkbox" checked={!!cheatDetectionConfig.detect_negative_balance} onChange={(e) => updateCheatDetectionConfig({ detect_negative_balance: e.target.checked })} className="rounded" />
                    Detect negative balance
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span>Impossible gain threshold:</span>
                    <input type="number" defaultValue={cheatDetectionConfig.detect_impossible_gain ? Math.round(cheatDetectionConfig.detect_impossible_gain / 1e6) : 50} onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1 && v <= 1000) updateCheatDetectionConfig({ detect_impossible_gain: v * 1e6 }); }} placeholder="50" className="w-16 bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1" />
                    <span className="text-mutedForeground">M (flag gains above this)</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span>Duplicate window:</span>
                    <input type="number" defaultValue={cheatDetectionConfig.duplicate_request_window_ms ?? 300} onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 100 && v <= 1000) updateCheatDetectionConfig({ duplicate_request_window_ms: v }); }} min="100" max="1000" className="w-16 bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1" />
                    <span className="text-mutedForeground">ms</span>
                  </div>
                </div>
              )}
            </div>

            {/* Account & IP bans */}
            <div className="mt-3 pt-3 border-t border-zinc-700/50">
              <div className="text-[10px] font-heading text-primary uppercase tracking-wider mb-2">Bans &amp; login restore</div>
              <p className="text-[10px] text-mutedForeground mb-2">
                Account bans block login after password succeeds. IP bans block the whole API for that address. Use <span className="text-foreground font-heading">Restore login (full)</span> to clear account ban, linked IP bans, and login lockout in one step.
              </p>

              <div className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Load lists</div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <BtnSecondary onClick={fetchAccountBans} disabled={ipBansLoading}>{ipBansLoading ? '...' : 'Load account bans'}</BtnSecondary>
                <BtnSecondary onClick={fetchIpBans} disabled={ipBansLoading}>{ipBansLoading ? '...' : 'Load IP bans'}</BtnSecondary>
                <BtnSecondary onClick={fetchAllBansLists} disabled={ipBansLoading}>{ipBansLoading ? '...' : 'Load both'}</BtnSecondary>
                <BtnSecondary onClick={handleTestIpBan} disabled={ipBansLoading} title="Bans your IP for 30s to test middleware">Test IP ban (30s)</BtnSecondary>
              </div>

              {accountBans.length > 0 && (
                <div className="mb-3">
                  <div className="text-[9px] font-heading text-amber-400/90 uppercase tracking-wider mb-1">Active account bans</div>
                  <div className="max-h-32 overflow-y-auto space-y-1 rounded bg-zinc-900/50 border border-zinc-700/50 p-2">
                    {accountBans.map((b, i) => (
                      <div key={b.id || `${b.user_id}-${i}`} className="flex items-center justify-between gap-2 text-[10px] py-1.5 px-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                        <div className="min-w-0">
                          <span className="font-heading font-bold text-foreground">{b.username || '?'}</span>
                          <span className="ml-2 text-mutedForeground truncate">{b.reason || '—'}</span>
                          {b.expires_at && <span className="ml-2 text-amber-400/80">expires {String(b.expires_at).slice(0, 10)}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUnbanAccountFromList(b.user_id, b.username)}
                          className="shrink-0 bg-zinc-700/50 hover:bg-zinc-600/50 text-foreground rounded px-2 py-1 text-[9px] font-bold border border-zinc-600/50"
                        >
                          Unban account
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Ban by username / IP</div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={ipBanUsername}
                  onChange={(e) => setIpBanUsername(e.target.value)}
                  placeholder="Username"
                  className="w-36 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <input
                  type="text"
                  value={ipBanReason}
                  onChange={(e) => setIpBanReason(e.target.value)}
                  placeholder="Reason"
                  className="flex-1 min-w-24 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <input
                  type="number"
                  value={ipBanHours}
                  onChange={(e) => setIpBanHours(e.target.value)}
                  placeholder="Hours (empty=permanent)"
                  min="1"
                  className="w-24 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnPrimary onClick={handleBanIp} disabled={ipBansLoading}>Ban user IPs</BtnPrimary>
              </div>

              <div className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-1">Actions by username</div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={ipUnbanUsername}
                  onChange={(e) => setIpUnbanUsername(e.target.value)}
                  placeholder="Target username"
                  className="w-44 min-w-[10rem] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnSecondary onClick={handleUnbanAllIpsForUser} disabled={ipBansLoading}>Clear IP bans</BtnSecondary>
                <BtnSecondary onClick={handleUnbanAccountByUsername} disabled={ipBansLoading}>Unban account</BtnSecondary>
                <BtnPrimary onClick={handleRestoreLoginFull} disabled={ipBansLoading}>Restore login (full)</BtnPrimary>
                <BtnSecondary onClick={handleClearLoginLockoutOnly} disabled={ipBansLoading}>Clear login lockout</BtnSecondary>
              </div>

              {ipBans.length > 0 && (
                <div>
                  <div className="text-[9px] font-heading text-red-400/90 uppercase tracking-wider mb-1">Active IP bans</div>
                  <div className="max-h-40 overflow-y-auto space-y-1 rounded bg-zinc-900/50 border border-zinc-700/50 p-2">
                    {ipBans.map((b, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[10px] py-1.5 px-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                        <div className="min-w-0">
                          <span className="font-mono font-bold text-foreground">{b.ip}</span>
                          {b.source_username && <span className="ml-2 text-[9px] text-amber-400/90 font-heading">via {b.source_username}</span>}
                          {b.reason && <span className="ml-2 text-mutedForeground truncate">{b.reason}</span>}
                          {b.expires_at && <span className="ml-2 text-amber-400/80">expires {b.expires_at.slice(0, 10)}</span>}
                        </div>
                        <button type="button" onClick={() => handleUnbanIp(b.ip)} className="shrink-0 bg-zinc-700/50 hover:bg-zinc-600/50 text-foreground rounded px-2 py-1 text-[9px] font-bold border border-zinc-600/50">Unban IP</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </section>
      )}

      {activeCategoryId === 'admin-operations' && (
      <section id="admin-cheat" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <AlertTriangle size={12} />
          Cheat Detection
        </h2>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-violet-500/25 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
          <SectionHeader
            icon={Bot}
            title="Bot / script investigation"
            badge={botInvestProfile?.user?.username ? <span className="text-[10px] font-heading text-violet-400">{botInvestProfile.user.username}</span> : null}
            toolAnchor="botInvestigation"
            isCollapsed={collapsed.botInvestigation}
            onToggle={() => toggleSection('botInvestigation')}
          />
          {!collapsed.botInvestigation && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">
                One place to review automation signals: aggregated profile, activity, intelligent dupe check, rate limits, and script-client block history. Moderators can use all actions here.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={botInvestQuery}
                  onChange={(e) => setBotInvestQuery(e.target.value)}
                  placeholder="Username or user id (UUID)"
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs w-56 max-w-full"
                  autoComplete="off"
                />
                <BtnPrimary onClick={loadBotInvestigationProfile} disabled={botInvestLoading}>
                  {botInvestLoading ? '…' : 'Load profile'}
                </BtnPrimary>
                <BtnSecondary type="button" onClick={loadBotInvestigationBlocksRecent} disabled={botInvestLoading}>
                  Recent bot blocks (all users)
                </BtnSecondary>
              </div>
              {botInvestProfile && (
                <div className="space-y-3 rounded border border-zinc-700/50 bg-zinc-900/40 p-2">
                  <div className="text-[10px] font-heading text-primary uppercase">Summary</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-heading text-mutedForeground">
                    <div>
                      <span className="text-foreground font-bold">{botInvestProfile.user?.username}</span>
                      <span className="ml-2 font-mono text-[9px]">{botInvestProfile.user?.id}</span>
                    </div>
                    <div>Dead: {botInvestProfile.user?.is_dead ? 'yes' : 'no'} · NPC: {botInvestProfile.user?.is_npc ? 'yes' : 'no'}</div>
                    <div className="sm:col-span-2 font-mono break-all">Reg IP: {botInvestProfile.user?.registration_ip || '—'} · Last req IP: {botInvestProfile.user?.last_request_ip || '—'}</div>
                    <div className="sm:col-span-2 font-mono break-all text-[9px]" title={botInvestProfile.user?.last_user_agent || ''}>
                      UA: {botInvestProfile.user?.last_user_agent ? `${String(botInvestProfile.user.last_user_agent).slice(0, 160)}…` : '—'}
                    </div>
                    <div className="sm:col-span-2 font-mono break-all text-[9px]">Fingerprint: {botInvestProfile.user?.device_fingerprint || '—'}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-600/50">
                      Security flags (30d): <span className="text-foreground font-bold">{botInvestProfile.security_flags_summary?.total_last_30d ?? 0}</span>
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-600/50">
                      Activity ({botInvestProfile.activity?.window_hours ?? '—'}h): <span className="text-foreground font-bold">{botInvestProfile.activity?.total_actions ?? 0}</span> actions
                    </span>
                    {botInvestProfile.minigame_timing?.inter_arrival_seconds_mean != null && (
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-600/50" title="Minigame plays — seconds between consecutive plays (lower variance can suggest automation)">
                        Minigame Δt mean: {Number(botInvestProfile.minigame_timing.inter_arrival_seconds_mean).toFixed(1)}s
                        {botInvestProfile.minigame_timing.inter_arrival_seconds_stddev != null && (
                          <> · σ {Number(botInvestProfile.minigame_timing.inter_arrival_seconds_stddev).toFixed(1)}s</>
                        )}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-600/50">
                      Suspicious logins (30d): <span className="text-foreground font-bold">{botInvestProfile.suspicious_logins?.count_30d ?? 0}</span>
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-600/50">
                      Auto-rank Telegram: {botInvestProfile.auto_rank?.telegram_linked ? 'linked' : 'not linked'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <BtnSecondary type="button" onClick={loadBotInvestigationActivity} disabled={botInvestLoading}>
                      Load 24h activity feed
                    </BtnSecondary>
                    <BtnSecondary type="button" onClick={loadBotInvestigationDupe} disabled={cheatLoading}>
                      Load intelligent dupe check
                    </BtnSecondary>
                    <BtnSecondary type="button" onClick={loadBotInvestigationRateLimit} disabled={botInvestLoading}>
                      Load rate limits (this user)
                    </BtnSecondary>
                    <BtnSecondary type="button" onClick={loadBotInvestigationBlocksForUser} disabled={botInvestLoading}>
                      Load bot blocks (this user)
                    </BtnSecondary>
                  </div>
                  {(botInvestProfile.security_flags_recent?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-amber-400/90 uppercase mb-1">Recent security flags (sample)</div>
                      <div className="max-h-40 overflow-y-auto space-y-1 text-[9px] font-mono">
                        {botInvestProfile.security_flags_recent.slice(0, 12).map((f, i) => (
                          <div key={i} className="border-b border-zinc-800/80 pb-1">
                            {f.flag_type || '—'} · {f.created_at || '—'} · {JSON.stringify(f.details || {}).slice(0, 120)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {botInvestActivity && (
                <div>
                  <div className="text-[10px] font-heading text-primary uppercase mb-1">Activity feed (24h)</div>
                  <pre className="text-[9px] p-2 rounded bg-zinc-950/80 border border-zinc-700/50 text-mutedForeground overflow-auto max-h-72 whitespace-pre-wrap break-words">
                    {JSON.stringify(botInvestActivity, null, 2)}
                  </pre>
                </div>
              )}
              {botInvestDupe && (
                <div>
                  <div className="text-[10px] font-heading text-primary uppercase mb-1">Intelligent dupe check (filtered to this username cohort)</div>
                  <pre className="text-[9px] p-2 rounded bg-zinc-950/80 border border-zinc-700/50 text-mutedForeground overflow-auto max-h-96 whitespace-pre-wrap break-words">
                    {JSON.stringify(botInvestDupe, null, 2)}
                  </pre>
                </div>
              )}
              {botInvestRateLimit && (
                <div>
                  <div className="text-[10px] font-heading text-primary uppercase mb-1">Rate limit log (this user)</div>
                  <pre className="text-[9px] p-2 rounded bg-zinc-950/80 border border-zinc-700/50 text-mutedForeground overflow-auto max-h-64 whitespace-pre-wrap break-words">
                    {JSON.stringify(botInvestRateLimit, null, 2)}
                  </pre>
                </div>
              )}
              {botInvestBlocks && (
                <div>
                  <div className="text-[10px] font-heading text-primary uppercase mb-1">Script / bot client blocks (audit)</div>
                  <pre className="text-[9px] p-2 rounded bg-zinc-950/80 border border-zinc-700/50 text-mutedForeground overflow-auto max-h-64 whitespace-pre-wrap break-words">
                    {JSON.stringify(botInvestBlocks, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Users}
          title="Quick Player Comparison"
          badge={compareResult?.same_ip ? <span className="text-[10px] font-heading text-red-400">Same IP!</span> : compareResult?.same_device ? <span className="text-[10px] font-heading text-amber-400">Same device!</span> : null}
          toolAnchor="playerCompare"
          isCollapsed={collapsed.playerCompare}
          onToggle={() => toggleSection('playerCompare')}
        />
        {!collapsed.playerCompare && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground font-heading">Compare two players side-by-side: stats, IPs, devices, registration dates. Essential for alt-account investigation.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="text" value={compareUser1} onChange={(e) => setCompareUser1(e.target.value)} placeholder="Username 1" className="w-36 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading" />
              <span className="text-[10px] text-mutedForeground">vs</span>
              <input type="text" value={compareUser2} onChange={(e) => setCompareUser2(e.target.value)} placeholder="Username 2" className="w-36 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading" />
              <BtnPrimary onClick={handleCompareUsers} disabled={compareLoading}>{compareLoading ? 'Loading...' : 'Compare'}</BtnPrimary>
            </div>
            {compareResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 text-[10px] font-heading">
                  {compareResult.same_ip && <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-bold border border-red-500/30">SAME REGISTRATION IP</span>}
                  {compareResult.same_device && <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">SAME DEVICE</span>}
                  {!compareResult.same_ip && !compareResult.same_device && <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">No matches found</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[compareResult.user1, compareResult.user2].map((u, idx) => u && (
                    <div key={u.username || idx} className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30 text-[10px] font-heading space-y-0.5">
                      <div className="font-bold text-primary text-[11px]">{u.username ?? '—'}</div>
                      <div className="text-mutedForeground">Email: {u.email ?? '—'}</div>
                      <div>Cash: ${formatWholeCash(u.money)} · Bank: ${formatWholeCash(u.bank_balance)}</div>
                      <div>Points: {(u.points ?? 0).toLocaleString()} · Prestige: {u.prestige ?? 0}</div>
                      <div className="text-mutedForeground">Registered: {u.created_at ? new Date(u.created_at).toLocaleString() : '—'}</div>
                      <div className="text-mutedForeground">Last login: {u.last_login ? new Date(u.last_login).toLocaleString() : '—'}</div>
                      <div className="font-mono text-[9px]">Reg IP: {u.registration_ip ?? '—'}</div>
                      <div className="font-mono text-[9px]">Login IP: {u.last_login_ip ?? '—'}</div>
                      <div className="font-mono text-[9px] truncate" title={u.device_fingerprint ?? ''}>Device: {u.device_fingerprint ? u.device_fingerprint.substring(0, 24) + '...' : '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        <div className={`${styles.panel} rounded-md overflow-hidden border border-amber-500/30 mobile-panel`}>
        <SectionHeader
          icon={AlertTriangle}
          title="Cheat Detection"
          badge={
            ((cheatDupeIntelligent?.total_same_ip_groups ?? 0) > 0 || (cheatDupeIntelligent?.total_same_ua_groups ?? 0) > 0 ||
             (cheatDupeIntelligent?.total_same_subnet_groups ?? 0) > 0 || (cheatDupeIntelligent?.total_same_fingerprint_groups ?? 0) > 0 ||
             (cheatDupeIntelligent?.total_proxy_users ?? 0) > 0 ||
             (cheatDupeIntelligent?.total_alive_dead_ip_groups ?? 0) > 0 || (cheatDupeIntelligent?.total_suspicious_ip_correlations ?? 0) > 0 ||
             (cheatDupeIntelligent?.total_registration_burst_groups ?? 0) > 0 || (cheatDupeIntelligent?.total_referral_same_ip_groups ?? 0) > 0 ||
             (cheatDupeIntelligent?.total_heavy_transfer_pairs ?? 0) > 0 || (cheatDupeIntelligent?.total_prereg_ip_cross_accounts ?? 0) > 0 ||
             (cheatDupeIntelligent?.total_alive_dead_fingerprint_groups ?? 0) > 0 || (cheatDupeIntelligent?.total_users_with_security_flags ?? 0) > 0 ||
             (cheatDupeIntelligent?.total_password_reset_heavy_users ?? 0) > 0 ||
             (cheatSameIp?.total_groups ?? 0) > 0 || (cheatSameDeviceIps?.total_groups ?? 0) > 0 ||
             ((cheatDuplicates?.by_domain?.length ?? 0) + (cheatDuplicates?.by_similar_username?.length ?? 0) + (cheatDuplicates?.by_similar_email?.length ?? 0) + (cheatDuplicates?.by_same_day_same_ip?.length ?? 0) + (cheatDuplicates?.by_fuzzy_username?.length ?? 0)) > 0) && (
              <span className="text-[10px] font-heading text-amber-400">Review below</span>
            )
          }
          toolAnchor="cheat"
          isCollapsed={collapsed.cheat}
          onToggle={() => toggleSection('cheat')}
        />
        {!collapsed.cheat && (
          <div className="p-3 space-y-4">
            <div>
              <div className="text-[10px] font-heading text-primary uppercase mb-2">Intelligent dupe check</div>
              <p className="text-xs text-mutedForeground mb-2">One report: shared IPs (full history + optional session IPs + VPN check), alive/dead IP overlap, suspicious-login hotspots, registration bursts, referral+IP, heavy transfers, plus domain/username/email signals.</p>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={duplicateSuspectsUsername}
                  onChange={(e) => setDuplicateSuspectsUsername(e.target.value)}
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs w-40"
                  placeholder="Filter by username"
                />
                <BtnPrimary onClick={handleFetchDupeIntelligent} disabled={cheatLoading}>Run intelligent dupe check</BtnPrimary>
              </div>
              {cheatDupeIntelligent && (
                <div className="mt-3 space-y-4">
                  {(cheatDupeIntelligent.same_ip_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-amber-400 uppercase mb-2">Same IP ({cheatDupeIntelligent.total_same_ip_groups} group(s)) — full IP history per account</div>
                      <div className="max-h-80 overflow-y-auto space-y-2">
                        {cheatDupeIntelligent.same_ip_groups.slice(0, 40).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-amber-500/20">
                            {(() => {
                              const networkType = g.ip_network_type || 'unknown';
                              const networkLabel = networkType === 'consumer_paid_isp'
                                ? 'Paid ISP'
                                : networkType === 'datacenter_or_hosting'
                                  ? 'Hosting'
                                  : networkType === 'vpn_or_proxy'
                                    ? 'VPN/Proxy'
                                    : 'Unknown';
                              const networkClass = networkType === 'consumer_paid_isp'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : networkType === 'datacenter_or_hosting'
                                  ? 'bg-orange-500/20 text-orange-300'
                                  : networkType === 'vpn_or_proxy'
                                    ? 'bg-purple-500/20 text-purple-300'
                                    : 'bg-zinc-600/40 text-zinc-300';
                              const ispParts = [g.ip_isp, g.ip_org, g.ip_as].filter(Boolean);
                              return (
                                <>
                            <div className="text-[10px] font-heading text-amber-400 mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span>IP: {g.ip}</span>
                              <span>— {g.count} account(s)</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50" title="Risk score 0-100">Score: {g.risk_score}</span>}
                              {g.confidence && <span className={`px-1 rounded text-[9px] ${g.confidence === 'high' ? 'bg-red-500/20 text-red-300' : g.confidence === 'medium' ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-600/40 text-zinc-300'}`}>Confidence: {g.confidence}</span>}
                              {typeof g.evidence_count === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-700/50 text-zinc-200">Evidence: {g.evidence_count}</span>}
                              {g.risk && <span className={`px-1 rounded text-[9px] ${g.risk === 'high' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>{g.risk}</span>}
                              <span className={`px-1 rounded text-[9px] ${networkClass}`} title="Network type from VPN/proxy + ISP enrichment">
                                {networkLabel}
                              </span>
                              {g.ip_vpn && <span className="px-1 rounded text-[9px] bg-purple-500/20 text-purple-400" title="IP detected as VPN/proxy">VPN</span>}
                              <button type="button" onClick={() => handleBanIpQuick(g.ip)} className="ml-auto shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded px-2 py-0.5 text-[9px] font-bold border border-red-500/40">Ban IP</button>
                            </div>
                            {ispParts.length > 0 && (
                              <div className="text-[9px] font-mono text-zinc-500 mb-1">
                                {ispParts.join(' | ')}
                              </div>
                            )}
                            {g.ip_accuracy_note && (
                              <div className="text-[9px] text-zinc-500 mb-1">{g.ip_accuracy_note}</div>
                            )}
                            <div className="space-y-1">
                              {(g.accounts || []).map((a, j) => (
                                <div key={j} className="text-[10px] pl-1 border-l border-zinc-600/50 flex flex-wrap items-center gap-x-2">
                                  <span className="text-foreground font-bold">{a.username}</span>
                                  <span className="text-mutedForeground"> · {a.email}</span>
                                  {a.role_at_this_ip && <span className="text-zinc-500 text-[9px]">({a.role_at_this_ip})</span>}
                                  <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                                  <div className="w-full text-[9px] font-mono text-mutedForeground mt-0.5">IPs: {(a.all_ips || []).join(', ') || '—'}</div>
                                </div>
                              ))}
                            </div>
                                </>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {cheatDupeIntelligent.ip_union_includes_sessions && (
                    <p className="text-[10px] text-mutedForeground font-heading">IP union includes recent JWT session IPs (same-IP / subnet / VPN / correlations).</p>
                  )}
                  {(cheatDupeIntelligent.alive_dead_ip_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-red-400 uppercase mb-2">Alive + dead same IP ({cheatDupeIntelligent.total_alive_dead_ip_groups} group(s))</div>
                      <div className="max-h-72 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.alive_dead_ip_groups || []).slice(0, 30).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-red-500/25">
                            <div className="text-[10px] font-heading text-red-400 mb-1 flex flex-wrap items-center gap-x-2">
                              <span>IP: {g.ip}</span>
                              <span>— {g.alive_count ?? (g.alive_accounts || []).length} alive · {g.dead_count ?? (g.dead_accounts || []).length} dead</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                              <button type="button" onClick={() => handleBanIpQuick(g.ip)} className="ml-auto shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded px-2 py-0.5 text-[9px] font-bold border border-red-500/40">Ban IP</button>
                            </div>
                            <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Living</div>
                            <div className="space-y-0.5 mb-2">
                              {(g.alive_accounts || []).slice(0, 8).map((a, j) => (
                                <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                  <span className="font-bold">{a.username}</span>
                                  <span className="text-mutedForeground">{a.email}</span>
                                  {a.role_at_this_ip && <span className="text-zinc-500 text-[9px]">({a.role_at_this_ip})</span>}
                                  <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                                </div>
                              ))}
                            </div>
                            <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Dead</div>
                            <div className="space-y-0.5">
                              {(g.dead_accounts || []).slice(0, 8).map((d, j) => (
                                <div key={j} className="text-[10px] pl-1 text-mutedForeground">
                                  {d.username ?? d.id}{d.dead_at && <span className="text-zinc-500"> · {new Date(d.dead_at).toLocaleString()}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.suspicious_ip_correlations?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-amber-400 uppercase mb-2">Suspicious logins vs living IPs ({cheatDupeIntelligent.total_suspicious_ip_correlations} hotspot(s))</div>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.suspicious_ip_correlations || []).slice(0, 25).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-amber-500/20">
                            <div className="text-[10px] font-heading text-amber-400 mb-1 flex flex-wrap gap-x-2">
                              <span>{g.ip}</span>
                              <span>— {g.event_count} event(s)</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                            </div>
                            <div className="text-[9px] text-mutedForeground mb-1">
                              {(g.sample_events || []).slice(0, 4).map((e, k) => (
                                <span key={k} className="mr-2 inline-block">{e.reason}{e.login_input ? ` · ${e.login_input}` : ''}</span>
                              ))}
                            </div>
                            <div className="space-y-0.5">
                              {(g.correlated_alive_accounts || []).slice(0, 6).map((a, j) => (
                                <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                  <span className="font-bold">{a.username}</span>
                                  <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.registration_burst_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Registration burst (same reg IP, tight window) ({cheatDupeIntelligent.total_registration_burst_groups} group(s))</div>
                      <div className="max-h-56 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.registration_burst_groups || []).slice(0, 20).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading mb-0.5 flex flex-wrap gap-x-2">
                              <span className="font-mono">{g.registration_ip}</span>
                              <span>— {g.count} account(s)</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                            </div>
                            {(g.accounts || []).slice(0, 6).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{a.username}</span>
                                <span className="text-mutedForeground">{a.created_at && new Date(a.created_at).toLocaleString()}</span>
                                <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.referral_same_ip_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Same referrer + same registration IP ({cheatDupeIntelligent.total_referral_same_ip_groups} group(s))</div>
                      <div className="max-h-56 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.referral_same_ip_groups || []).slice(0, 20).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading mb-0.5 flex flex-wrap gap-x-2">
                              <span>Referrer: {g.referred_by_username || g.referred_by || '—'}</span>
                              <span className="font-mono">{g.registration_ip}</span>
                              <span>— {g.count} account(s)</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                            </div>
                            {(g.accounts || []).slice(0, 6).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{a.username}</span>
                                <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.heavy_transfer_pairs?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Heavy money transfers (recent) ({cheatDupeIntelligent.total_heavy_transfer_pairs} pair(s))</div>
                      <div className="max-h-56 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.heavy_transfer_pairs || []).slice(0, 25).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading mb-0.5 flex flex-wrap gap-x-2">
                              <span>{g.from_username || g.from_user_id} → {g.to_username || g.to_user_id}</span>
                              <span>— {g.transfer_count} transfer(s)</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                            </div>
                            <div className="text-[9px] font-mono text-mutedForeground">
                              Shared IPs ({g.shared_ip_count ?? (g.shared_ips || []).length}): {(g.shared_ips || []).join(', ') || '—'}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {g.from_username && <button type="button" onClick={() => handleViewUserFromCheat(g.from_username)} className="bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View sender</button>}
                              {g.to_username && <button type="button" onClick={() => handleViewUserFromCheat(g.to_username)} className="bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View recipient</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.same_user_agent_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Same device (user-agent), different IPs ({cheatDupeIntelligent.total_same_ua_groups} group(s))</div>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {cheatDupeIntelligent.same_user_agent_groups.slice(0, 25).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading mb-0.5 flex flex-wrap items-center gap-x-2">
                              {g.account_count} account(s) · {g.distinct_ip_count} IP(s)
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                            </div>
                            <div className="text-[9px] font-mono text-mutedForeground mb-1 truncate" title={g.user_agent_full}>{g.user_agent}</div>
                            {(g.accounts || []).slice(0, 8).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{a.username}</span>
                                <span className="text-mutedForeground font-mono">{(a.all_ips || []).join(', ') || '—'}</span>
                                <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.same_subnet_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Same subnet /24 ({cheatDupeIntelligent.total_same_subnet_groups ?? 0} group(s))</div>
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.same_subnet_groups || []).slice(0, 20).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading mb-0.5 flex flex-wrap items-center gap-x-2">
                              {g.subnet} — {g.count} account(s)
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                            </div>
                            {(g.accounts || []).slice(0, 5).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{a.username}</span>
                                <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.same_fingerprint_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Same device fingerprint ({cheatDupeIntelligent.total_same_fingerprint_groups ?? 0} group(s))</div>
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.same_fingerprint_groups || []).slice(0, 20).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading mb-0.5 flex flex-wrap items-center gap-x-2">
                              {g.account_count} account(s)
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                            </div>
                            {(g.accounts || []).slice(0, 5).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{a.username}</span>
                                <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.proxy_users?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-purple-400 uppercase mb-2">Possible proxy/VPN users ({cheatDupeIntelligent.total_proxy_users ?? 0}) — registered or logged in from VPN/proxy IP</div>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.proxy_users || []).slice(0, 50).map((u, i) => (
                          <div key={i} className="p-2 rounded bg-purple-500/10 border border-purple-500/30">
                            <div className="text-[10px] font-heading flex flex-wrap items-center gap-x-2">
                              <span className="font-bold text-foreground">{u.username}</span>
                              <span className="text-mutedForeground">· {u.email}</span>
                              {u.registration_from_vpn && <span className="px-1 rounded text-[9px] bg-red-500/20 text-red-400">Reg from VPN</span>}
                              <button type="button" onClick={() => handleViewUserFromCheat(u.username)} className="ml-auto shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                            </div>
                            <div className="text-[9px] font-mono text-mutedForeground mt-0.5">VPN IPs: {(u.vpn_ips || []).join(', ') || '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.prereg_ip_cross_accounts?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Prereg IP overlaps another account ({cheatDupeIntelligent.total_prereg_ip_cross_accounts} row(s))</div>
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {(cheatDupeIntelligent.prereg_ip_cross_accounts || []).slice(0, 25).map((r, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-zinc-700/30 text-[10px] font-heading flex flex-wrap items-center gap-x-2">
                            <span className="font-bold">{r.username}</span>
                            <span className="text-mutedForeground font-mono">{r.prereg_ip}</span>
                            <span className="text-zinc-500 text-[9px]">others: {(r.other_user_ids || []).length}</span>
                            {typeof r.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {r.risk_score}</span>}
                            <button type="button" onClick={() => handleViewUserFromCheat(r.username)} className="ml-auto shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.alive_dead_fingerprint_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-red-400 uppercase mb-2">Alive + dead same fingerprint ({cheatDupeIntelligent.total_alive_dead_fingerprint_groups} group(s))</div>
                      <div className="max-h-56 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.alive_dead_fingerprint_groups || []).slice(0, 15).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-red-500/20">
                            <div className="text-[10px] text-amber-400 font-heading mb-0.5 flex flex-wrap gap-x-2">
                              <span className="font-mono truncate max-w-[200px]" title={g.device_fingerprint}>{g.device_fingerprint}</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                            </div>
                            <div className="text-[9px] text-zinc-500 mb-0.5">Living</div>
                            {(g.alive_accounts || []).slice(0, 4).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{a.username}</span>
                                <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                              </div>
                            ))}
                            <div className="text-[9px] text-zinc-500 mt-1 mb-0.5">Dead</div>
                            {(g.dead_accounts || []).slice(0, 4).map((d, j) => (
                              <div key={j} className="text-[10px] pl-1 text-mutedForeground">{d.username ?? d.id}</div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.users_with_security_flags?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-orange-400 uppercase mb-2">Security flags (batch users, recent) ({cheatDupeIntelligent.total_users_with_security_flags})</div>
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {(cheatDupeIntelligent.users_with_security_flags || []).slice(0, 30).map((r, i) => (
                          <div key={i} className="p-2 rounded bg-orange-500/10 border border-orange-500/25 text-[10px]">
                            <div className="font-heading flex flex-wrap items-center gap-x-2 mb-0.5">
                              <span className="font-bold">{r.username}</span>
                              <span className="text-mutedForeground">{r.flag_count} flag(s)</span>
                              {typeof r.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {r.risk_score}</span>}
                              {r.username && <button type="button" onClick={() => handleViewUserFromCheat(r.username)} className="ml-auto shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>}
                            </div>
                            <div className="text-[9px] text-mutedForeground space-y-0.5">
                              {(r.flags || []).slice(0, 4).map((f, k) => (
                                <div key={k}>{f.flag_type}: {f.reason}</div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.password_reset_heavy_users?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Frequent password resets (batch, recent) ({cheatDupeIntelligent.total_password_reset_heavy_users})</div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {(cheatDupeIntelligent.password_reset_heavy_users || []).slice(0, 25).map((r, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-zinc-700/30 text-[10px] font-heading flex flex-wrap items-center gap-x-2">
                            <span className="font-bold">{r.username}</span>
                            <span className="text-mutedForeground">{r.reset_count} request(s)</span>
                            {typeof r.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {r.risk_score}</span>}
                            {r.username && <button type="button" onClick={() => handleViewUserFromCheat(r.username)} className="ml-auto shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.transfer_ring_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-red-400 uppercase mb-2">Transfer rings ({cheatDupeIntelligent.total_transfer_ring_groups ?? 0})</div>
                      <div className="max-h-56 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.transfer_ring_groups || []).slice(0, 25).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-red-500/10 border border-red-500/25">
                            <div className="text-[10px] font-heading flex flex-wrap items-center gap-x-2">
                              <span className="text-red-300">{g.member_count} accounts</span>
                              <span className="text-zinc-300">edges: {g.edge_total}</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-700/50">Score: {g.risk_score}</span>}
                              {g.confidence && <span className={`px-1 rounded text-[9px] ${g.confidence === 'high' ? 'bg-red-500/20 text-red-300' : g.confidence === 'medium' ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-600/40 text-zinc-300'}`}>{g.confidence}</span>}
                              {typeof g.evidence_count === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-700/50">Evidence: {g.evidence_count}</span>}
                            </div>
                            <div className="text-[9px] text-zinc-500 mt-0.5">Reasons: {(g.evidence_reasons || []).join(', ') || '—'}</div>
                            <div className="space-y-0.5 mt-1">
                              {(g.members || []).slice(0, 6).map((m, j) => (
                                <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                  <span className="font-bold">{m.username || m.user_id}</span>
                                  {m.username && <button type="button" onClick={() => handleViewUserFromCheat(m.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.overlapping_session_device_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-amber-400 uppercase mb-2">Session overlap on same device ({cheatDupeIntelligent.total_overlapping_session_device_groups ?? 0})</div>
                      <div className="max-h-56 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.overlapping_session_device_groups || []).slice(0, 25).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-amber-500/25">
                            <div className="text-[10px] font-heading flex flex-wrap items-center gap-x-2">
                              <span className="text-amber-300">{g.account_count} accounts</span>
                              <span className="text-zinc-300">overlaps: {g.overlap_hits}</span>
                              {g.shared_ip && <span className="px-1 rounded text-[9px] bg-red-500/20 text-red-300">shared IP</span>}
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-700/50">Score: {g.risk_score}</span>}
                              {g.confidence && <span className={`px-1 rounded text-[9px] ${g.confidence === 'high' ? 'bg-red-500/20 text-red-300' : g.confidence === 'medium' ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-600/40 text-zinc-300'}`}>{g.confidence}</span>}
                            </div>
                            <div className="text-[9px] text-zinc-500 mt-0.5">Reasons: {(g.evidence_reasons || []).join(', ') || '—'}</div>
                            {(g.members || []).slice(0, 6).map((m, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{m.username || m.user_id}</span>
                                {m.username && <button type="button" onClick={() => handleViewUserFromCheat(m.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.automation_cadence_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-orange-400 uppercase mb-2">Automation cadence clusters ({cheatDupeIntelligent.total_automation_cadence_groups ?? 0})</div>
                      <div className="max-h-56 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.automation_cadence_groups || []).slice(0, 25).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-orange-500/10 border border-orange-500/25">
                            <div className="text-[10px] font-heading flex flex-wrap items-center gap-x-2">
                              <span>{g.account_count} accounts</span>
                              <span>{g.cadence_seconds}s cadence</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-700/50">Score: {g.risk_score}</span>}
                              {g.confidence && <span className={`px-1 rounded text-[9px] ${g.confidence === 'high' ? 'bg-red-500/20 text-red-300' : g.confidence === 'medium' ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-600/40 text-zinc-300'}`}>{g.confidence}</span>}
                            </div>
                            <div className="text-[9px] text-zinc-500 mt-0.5">Intervals: {(g.sample_intervals || []).join(', ') || '—'}</div>
                            {(g.members || []).slice(0, 6).map((m, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{m.username || m.user_id}</span>
                                {m.username && <button type="button" onClick={() => handleViewUserFromCheat(m.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(cheatDupeIntelligent.referral_abuse_groups?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[10px] font-heading text-primary uppercase mb-2">Referral abuse clusters ({cheatDupeIntelligent.total_referral_abuse_groups ?? 0})</div>
                      <div className="max-h-56 overflow-y-auto space-y-2">
                        {(cheatDupeIntelligent.referral_abuse_groups || []).slice(0, 25).map((g, i) => (
                          <div key={i} className="p-2 rounded bg-zinc-900/50 border border-primary/30">
                            <div className="text-[10px] font-heading flex flex-wrap items-center gap-x-2">
                              <span className="text-primary">Referrer: {g.referrer_username || g.referrer_user_id}</span>
                              <span>{g.referee_count} referees</span>
                              <span>shared with referrer: {g.shared_ip_with_referrer_count}</span>
                              {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-700/50">Score: {g.risk_score}</span>}
                              {g.confidence && <span className={`px-1 rounded text-[9px] ${g.confidence === 'high' ? 'bg-red-500/20 text-red-300' : g.confidence === 'medium' ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-600/40 text-zinc-300'}`}>{g.confidence}</span>}
                            </div>
                            <div className="text-[9px] text-zinc-500 mt-0.5">Reasons: {(g.evidence_reasons || []).join(', ') || '—'}</div>
                            {(g.members || []).slice(0, 6).map((m, j) => (
                              <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2">
                                <span className="font-bold">{m.username || m.user_id}</span>
                                {m.username && <button type="button" onClick={() => handleViewUserFromCheat(m.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(cheatDupeIntelligent.by_domain?.length ?? 0) > 0 && (
                      <div>
                        <div className="text-[10px] font-heading text-primary uppercase mb-1">Same email domain (gmail/icloud/outlook excluded)</div>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {(cheatDupeIntelligent.by_domain || []).slice(0, 15).map((g, i) => (
                            <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                              <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">{g.domain} — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                              {g.accounts?.slice(0, 4).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(cheatDupeIntelligent.by_similar_username?.length ?? 0) > 0 && (
                      <div>
                        <div className="text-[10px] font-heading text-primary uppercase mb-1">Similar usernames</div>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {(cheatDupeIntelligent.by_similar_username || []).slice(0, 15).map((g, i) => (
                            <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                              <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">&quot;{g.base}&quot; — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                              {g.accounts?.slice(0, 4).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(cheatDupeIntelligent.by_similar_email?.length ?? 0) > 0 && (
                      <div>
                        <div className="text-[10px] font-heading text-primary uppercase mb-1">Similar email</div>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {(cheatDupeIntelligent.by_similar_email || []).slice(0, 10).map((g, i) => (
                            <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                              <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">{g.local_base}@{g.domain} — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                              {g.accounts?.slice(0, 4).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(cheatDupeIntelligent.by_same_day_same_ip?.length ?? 0) > 0 && (
                      <div>
                        <div className="text-[10px] font-heading text-primary uppercase mb-1">Same day + same reg IP</div>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {(cheatDupeIntelligent.by_same_day_same_ip || []).slice(0, 10).map((g, i) => (
                            <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                              <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">{g.registration_ip} · {g.created_day} — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                              {g.accounts?.slice(0, 4).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(cheatDupeIntelligent.by_fuzzy_username?.length ?? 0) > 0 && (
                      <div>
                        <div className="text-[10px] font-heading text-primary uppercase mb-1">Fuzzy similar usernames</div>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {(cheatDupeIntelligent.by_fuzzy_username || []).slice(0, 10).map((g, i) => (
                            <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                              <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">&quot;{g.base}&quot; — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                              {g.accounts?.slice(0, 4).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {!(cheatDupeIntelligent.same_ip_groups?.length || cheatDupeIntelligent.same_user_agent_groups?.length || cheatDupeIntelligent.same_subnet_groups?.length || cheatDupeIntelligent.same_fingerprint_groups?.length || cheatDupeIntelligent.proxy_users?.length || cheatDupeIntelligent.alive_dead_ip_groups?.length || cheatDupeIntelligent.suspicious_ip_correlations?.length || cheatDupeIntelligent.registration_burst_groups?.length || cheatDupeIntelligent.referral_same_ip_groups?.length || cheatDupeIntelligent.heavy_transfer_pairs?.length || cheatDupeIntelligent.transfer_ring_groups?.length || cheatDupeIntelligent.overlapping_session_device_groups?.length || cheatDupeIntelligent.automation_cadence_groups?.length || cheatDupeIntelligent.referral_abuse_groups?.length || cheatDupeIntelligent.prereg_ip_cross_accounts?.length || cheatDupeIntelligent.alive_dead_fingerprint_groups?.length || cheatDupeIntelligent.users_with_security_flags?.length || cheatDupeIntelligent.password_reset_heavy_users?.length || cheatDupeIntelligent.by_domain?.length || cheatDupeIntelligent.by_similar_username?.length || cheatDupeIntelligent.by_similar_email?.length || cheatDupeIntelligent.by_same_day_same_ip?.length || cheatDupeIntelligent.by_fuzzy_username?.length) && (
                    <p className="text-xs text-mutedForeground">No duplicate suspects in this report (try without username filter).</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Accounts on same IP</div>
              <p className="text-xs text-mutedForeground mb-2">Find users who registered or logged in from the same IP (possible multi-accounts).</p>
              <BtnPrimary onClick={handleFetchSameIp} disabled={cheatLoading}>Load same-IP report</BtnPrimary>
              {cheatSameIp && (
                <div className="mt-3 max-h-64 overflow-y-auto space-y-2">
                  {cheatSameIp.total_groups === 0 ? (
                    <p className="text-xs text-mutedForeground">No IP shared by 2+ accounts.</p>
                  ) : (
                    cheatSameIp.groups?.slice(0, 30).map((g, i) => (
                      <div key={i} className="p-2 rounded bg-zinc-900/50 border border-amber-500/20">
                        <div className="text-[10px] font-heading text-amber-400 mb-1 flex flex-wrap items-center gap-x-2">
                          IP: {g.ip} — {g.count} account(s)
                          {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                          {g.risk && <span className={`px-1 rounded text-[9px] ${g.risk === 'high' ? 'bg-red-500/20 text-red-400' : g.risk === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-500/20 text-zinc-400'}`}>{g.risk}</span>}
                          {g.label && <span className="text-mutedForeground text-[9px]">({g.label})</span>}
                          <button type="button" onClick={() => handleBanIpQuick(g.ip)} className="ml-auto shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded px-2 py-0.5 text-[9px] font-bold border border-red-500/40">Ban IP</button>
                        </div>
                        <div className="space-y-0.5">
                          {g.accounts.map((a, j) => (
                            <div key={j} className="flex flex-wrap items-center gap-x-2 text-[10px]">
                              <span className="text-foreground font-bold">{a.username}</span>
                              <span className="text-mutedForeground">{a.email}</span>
                              <span className="text-mutedForeground">{a.source}</span>
                              <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Same device, different IPs</div>
              <p className="text-xs text-mutedForeground mb-2">Find users who share the same browser/device (User-Agent) but log in from different IPs. Possible multi-account or same device on VPN / different networks.</p>
              <BtnPrimary onClick={handleFetchSameDeviceDifferentIps} disabled={cheatLoading}>Load same-device report</BtnPrimary>
              {cheatSameDeviceIps && (
                <div className="mt-3 max-h-72 overflow-y-auto space-y-2">
                  {cheatSameDeviceIps.total_groups === 0 ? (
                    <p className="text-xs text-mutedForeground">No groups with same device and different IPs.</p>
                  ) : (
                    (cheatSameDeviceIps.groups || []).map((g, i) => (
                      <div key={i} className="p-2 rounded bg-zinc-900/50 border border-amber-500/20">
                        <div className="text-[10px] font-heading text-amber-400 mb-1 flex flex-wrap items-center gap-x-2">
                          {g.account_count} account(s) · {g.distinct_ip_count} different IP(s)
                          {typeof g.risk_score === 'number' && <span className="px-1 rounded text-[9px] bg-zinc-600/50">Score: {g.risk_score}</span>}
                        </div>
                        <div className="text-[9px] font-mono text-mutedForeground mb-1 truncate" title={g.user_agent_full}>{g.user_agent}</div>
                        <div className="space-y-0.5">
                          {(g.users || []).map((a, j) => (
                            <div key={j} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                              <span className="text-foreground font-bold">{a.username}</span>
                              <span className="text-mutedForeground">{a.email}</span>
                              <span className="text-mutedForeground font-mono">IPs: {(a.ips || []).join(', ') || '—'}</span>
                              <button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold">View</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs text-mutedForeground mb-2">
                Failed logins (wrong password or unknown account) from an IP that already has at least one other alive account.
                Useful for spotting users trying to access multiple accounts from the same IP.
              </p>
              <BtnPrimary onClick={handleFetchLoginAttempts} disabled={cheatLoading}>Load hacking attempts</BtnPrimary>
              {cheatLoginEvents && (
                <div className="mt-3 max-h-64 overflow-y-auto space-y-1.5">
                  {(cheatLoginEvents.events || []).length === 0 ? (
                    <p className="text-xs text-mutedForeground">No suspicious login attempts recorded.</p>
                  ) : (
                    (cheatLoginEvents.events || []).map((e, idx) => (
                      <div key={idx} className="p-2 rounded bg-zinc-900/60 border border-red-500/30 text-[10px] font-heading">
                        <div className="flex justify-between gap-2 flex-wrap mb-1">
                          <span className="text-amber-400">IP: {e.ip}</span>
                          <span className="text-zinc-500">{e.at && new Date(e.at).toLocaleString()}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-400">
                          {e.username && <span>Username: <span className="text-foreground font-bold">{e.username}</span></span>}
                          {e.email && <span>Email: <span className="text-foreground">{e.email}</span></span>}
                          {e.login_input && <span>Login input: <span className="text-foreground">{e.login_input}</span></span>}
                          {typeof e.same_ip_alive_count === 'number' && (
                            <span>Alive accounts on IP: <span className="text-foreground">{e.same_ip_alive_count}</span></span>
                          )}
                          {typeof e.same_ip_other_alive_count === 'number' && (
                            <span>Other alive accounts on IP: <span className="text-foreground">{e.same_ip_other_alive_count}</span></span>
                          )}
                          {e.reason && <span className="text-red-400">Reason: {e.reason}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Duplicate account suspects</div>
              <p className="text-xs text-mutedForeground mb-2">Same email domain (gmail/icloud/outlook excluded) or similar usernames (e.g. name1, name2).</p>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={duplicateSuspectsUsername}
                  onChange={(e) => setDuplicateSuspectsUsername(e.target.value)}
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs w-40"
                  placeholder="Filter by username"
                />
                <BtnPrimary onClick={handleFetchDuplicateSuspects} disabled={cheatLoading}>Load duplicate suspects</BtnPrimary>
              </div>
              {cheatDuplicates && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  <div>
                    <div className="text-[10px] font-heading text-primary uppercase mb-1">Same email domain (gmail/icloud excluded)</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {(cheatDuplicates.by_domain || []).length === 0 ? (
                        <p className="text-xs text-mutedForeground">None</p>
                      ) : (
                        (cheatDuplicates.by_domain || []).map((g, i) => (
                          <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">{g.domain} — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                            {g.accounts?.slice(0, 5).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-heading text-primary uppercase mb-1">Similar usernames</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {(cheatDuplicates.by_similar_username || []).length === 0 ? (
                        <p className="text-xs text-mutedForeground">None</p>
                      ) : (
                        (cheatDuplicates.by_similar_username || []).map((g, i) => (
                          <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">&quot;{g.base}&quot; — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                            {g.accounts?.slice(0, 5).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  {(cheatDuplicates.by_similar_email?.length > 0 || cheatDuplicates.by_same_day_same_ip?.length > 0 || cheatDuplicates.by_fuzzy_username?.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                      {cheatDuplicates.by_similar_email?.length > 0 && (
                        <div>
                          <div className="text-[10px] font-heading text-primary uppercase mb-1">Similar email (local+domain)</div>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {(cheatDuplicates.by_similar_email || []).map((g, i) => (
                              <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                                <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">{g.local_base}@{g.domain} — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                                {g.accounts?.slice(0, 5).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {cheatDuplicates.by_same_day_same_ip?.length > 0 && (
                        <div>
                          <div className="text-[10px] font-heading text-primary uppercase mb-1">Same day + same reg IP</div>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {(cheatDuplicates.by_same_day_same_ip || []).map((g, i) => (
                              <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                                <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">{g.registration_ip} · {g.created_day} — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                                {g.accounts?.slice(0, 5).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {cheatDuplicates.by_fuzzy_username?.length > 0 && (
                        <div>
                          <div className="text-[10px] font-heading text-primary uppercase mb-1">Fuzzy similar usernames</div>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {(cheatDuplicates.by_fuzzy_username || []).map((g, i) => (
                              <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                                <div className="text-[10px] text-amber-400 font-heading flex flex-wrap items-center gap-x-2">&quot;{g.base}&quot; — {g.count}{typeof g.risk_score === 'number' && <span className="text-[9px] text-zinc-500">Score: {g.risk_score}</span>}</div>
                                {g.accounts?.slice(0, 5).map((a, j) => <div key={j} className="text-[10px] pl-1 flex flex-wrap items-center gap-x-2"><span>{a.username} · {a.email}</span><button type="button" onClick={() => handleViewUserFromCheat(a.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-1 py-0.5 text-[9px] font-bold">View</button></div>)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-heading text-mutedForeground uppercase mb-2">Gambling anomalies</div>
              <p className="text-xs text-mutedForeground mb-2">Users with profit far above expected (&gt;3 std dev) — possible RNG manipulation.</p>
              <BtnPrimary onClick={handleFetchGamblingAnomalies} disabled={gamblingAnomaliesLoading}>Load gambling anomalies</BtnPrimary>
              {gamblingAnomalies && (
                <div className="mt-3 space-y-2">
                  {gamblingAnomalies.anomalies?.length === 0 ? (
                    <p className="text-xs text-mutedForeground">No anomalies in last {gamblingAnomalies.days} days.</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1.5">
                      <div className="text-[10px] text-mutedForeground">Mean: {gamblingAnomalies.mean_profit?.toLocaleString()} · Std: {gamblingAnomalies.std_profit?.toLocaleString()}</div>
                      {(gamblingAnomalies.anomalies || []).map((u, i) => (
                        <div key={i} className="p-2 rounded bg-zinc-900/50 border border-amber-500/20 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-foreground font-bold">{u.username}</span>
                          <span className="text-amber-400">Profit: {Number(u.total_profit).toLocaleString()} (z-score: {u.z_score})</span>
                          <button type="button" onClick={() => handleViewUserFromCheat(u.username)} className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary rounded px-2 py-0.5 text-[9px] font-bold">View</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        )}
        </div>

      </section>
      )}

      {activeCategoryId === 'admin-analytics-monitoring' && isAdmin && (
      <section id="admin-analytics" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <BarChart3 size={12} />
          Analytics
        </h2>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={User}
          title="Login page unique visitors"
          badge={loginPageVisitors != null ? <span className="text-[10px] font-heading text-primary">{loginPageVisitors.toLocaleString()} unique</span> : null}
          toolAnchor="loginPageVisitors"
          isCollapsed={collapsed.loginPageVisitors}
          onToggle={() => { toggleSection('loginPageVisitors'); if (collapsed.loginPageVisitors && loginPageVisitors === null) handleFetchLoginPageVisitors(); }}
        />
        {!collapsed.loginPageVisitors && (
          <div className="p-3 space-y-2">
            <BtnPrimary onClick={handleFetchLoginPageVisitors} disabled={loginPageVisitorsLoading}>{loginPageVisitorsLoading ? 'Loading…' : 'Refresh'}</BtnPrimary>
            {loginPageVisitors != null && (
              <div className="space-y-1">
                <p className="text-[10px] font-heading text-mutedForeground">
                  Unique visitors to the login page (by IP): <span className="font-bold text-foreground">{loginPageVisitors.toLocaleString()}</span>
                </p>
                {loginPageViews != null && (
                  <p className="text-[10px] font-heading text-mutedForeground">
                    Total tracked landing views: <span className="font-bold text-foreground">{loginPageViews.toLocaleString()}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Coins}
          title="Economy Overview"
          toolAnchor="economyOverview"
          isCollapsed={collapsed.economyOverview}
          onToggle={() => { toggleSection('economyOverview'); if (collapsed.economyOverview && !economyOverview) handleFetchEconomyOverview(); }}
        />
        {!collapsed.economyOverview && (
          <div className="p-3 space-y-2">
            <BtnPrimary onClick={handleFetchEconomyOverview} disabled={economyOverviewLoading}>{economyOverviewLoading ? 'Loading...' : 'Refresh'}</BtnPrimary>
            {economyOverview && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-heading">
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Cash in circulation</div>
                    <div className="font-bold text-foreground">${formatWholeCash(economyOverview.total_money)}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Banked + Swiss</div>
                    <div className="font-bold text-foreground">${formatWholeCash(economyOverview.total_banked ?? ((economyOverview.total_bank ?? 0) + (economyOverview.total_swiss ?? 0)))}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Total Points</div>
                    <div className="font-bold text-primary">{(economyOverview.total_points ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Avg Cash / Player</div>
                    <div className="font-bold text-foreground">${formatWholeCash(economyOverview.avg_money)}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Avg Points / Player</div>
                    <div className="font-bold text-primary">{(economyOverview.avg_points ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Alive Players</div>
                    <div className="font-bold text-foreground">{(economyOverview.player_count ?? 0).toLocaleString()}</div>
                  </div>
                </div>
                {economyOverview.top5_richest?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Top 5 Richest</div>
                    <div className="space-y-0.5 text-[10px] font-heading">
                      {economyOverview.top5_richest.map((u, i) => (
                        <div key={u.username || i} className="flex justify-between px-1">
                          <span className="font-bold text-foreground">{i + 1}. {u.username}</span>
                          <span className="text-mutedForeground">${formatWholeCash(u.money)} cash · ${formatWholeCash((u.banked_total ?? ((u.bank ?? 0) + (u.swiss ?? 0))) || 0)} banked · ${formatWholeCash(u.swiss)} swiss · {(u.points ?? 0).toLocaleString()} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {economyOverview.top5_points?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Top 5 by Points</div>
                    <div className="space-y-0.5 text-[10px] font-heading">
                      {economyOverview.top5_points.map((u, i) => (
                        <div key={u.username || i} className="flex justify-between px-1">
                          <span className="font-bold text-foreground">{i + 1}. {u.username}</span>
                          <span className="text-primary">{(u.points ?? 0).toLocaleString()} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="border-t border-zinc-700/40 pt-3 mt-3 space-y-2">
                  <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wide">Cash on hand — who holds it</div>
                  <p className="text-[10px] text-mutedForeground leading-snug">
                    Wallet cash (<span className="font-mono text-[9px]">users.money</span>) for the same segment as <strong className="text-foreground">Cash in circulation</strong> above: alive accounts, excluding moderators and admin-email accounts.
                    Includes NPC wallet rows if any. Sum below should match the headline when not searching.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-0.5 text-[10px] font-heading min-w-[8rem]">
                      <span className="text-mutedForeground">Search username</span>
                      <input
                        type="text"
                        value={cashHoldersSearchInput}
                        onChange={(e) => setCashHoldersSearchInput(e.target.value)}
                        placeholder="Contains…"
                        className="w-full max-w-[14rem] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[10px] font-heading">
                      <span className="text-mutedForeground">Sort</span>
                      <AdminSelect
                        value={cashHoldersSort}
                        onChange={(e) => {
                          const v = e.target.value;
                          setCashHoldersSort(v);
                          if (cashHolders) fetchCashHolders(0, v);
                        }}
                      >
                        <option value="money_desc">Cash (high → low)</option>
                        <option value="money_asc">Cash (low → high)</option>
                        <option value="username_asc">Username A–Z</option>
                      </AdminSelect>
                    </label>
                    <BtnPrimary type="button" onClick={() => fetchCashHolders(0, cashHoldersSort)} disabled={cashHoldersLoading}>
                      {cashHoldersLoading ? 'Loading…' : (cashHolders ? 'Refresh' : 'Load full list')}
                    </BtnPrimary>
                  </div>
                  {cashHolders && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-mutedForeground font-heading">
                        <span>
                          Total wallet cash (segment): <strong className="text-foreground">${formatWholeCash(cashHolders.total_cash_on_hand)}</strong>
                        </span>
                        <span>
                          Accounts: <strong className="text-foreground">{(cashHolders.total_accounts ?? 0).toLocaleString()}</strong>
                        </span>
                        {economyOverview?.total_money != null && !cashHoldersSearchInput.trim() && (
                          <span className={Math.abs(Number(cashHolders.total_cash_on_hand) - Number(economyOverview.total_money)) > 1 ? 'text-amber-400' : ''}>
                            Overview card: ${formatWholeCash(economyOverview.total_money)}
                          </span>
                        )}
                      </div>
                      <div className="overflow-x-auto rounded border border-zinc-700/40">
                        <table className="w-full text-[9px] font-heading text-left border-collapse">
                          <thead>
                            <tr className="border-b border-zinc-700/50 text-mutedForeground uppercase">
                              <th className="py-1 px-2">User</th>
                              <th className="py-1 px-2 text-right">Wallet</th>
                              <th className="py-1 px-2 text-right hidden sm:table-cell">Bank</th>
                              <th className="py-1 px-2 text-right hidden sm:table-cell">Swiss</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(cashHolders.rows || []).map((r) => (
                              <tr key={r.id || r.username} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                <td className="py-1 px-2 font-bold text-foreground">
                                  {r.username}
                                  {r.is_npc ? <span className="ml-1 text-[8px] text-amber-500/90 font-heading">NPC</span> : null}
                                </td>
                                <td className="py-1 px-2 text-right tabular-nums">${formatWholeCash(r.money)}</td>
                                <td className="py-1 px-2 text-right tabular-nums hidden sm:table-cell">${formatWholeCash(r.bank_balance)}</td>
                                <td className="py-1 px-2 text-right tabular-nums hidden sm:table-cell">${formatWholeCash(r.swiss_balance)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <BtnSecondary
                          type="button"
                          disabled={cashHoldersLoading || cashHoldersOffset <= 0}
                          onClick={() => fetchCashHolders(Math.max(0, cashHoldersOffset - CASH_HOLDERS_PAGE), cashHoldersSort)}
                        >
                          Previous
                        </BtnSecondary>
                        <span className="text-[9px] text-mutedForeground font-heading">
                          {cashHolders.total_accounts ? (
                            <>
                              Showing {cashHoldersOffset + 1}–{cashHoldersOffset + (cashHolders.rows?.length ?? 0)} of {(cashHolders.total_accounts ?? 0).toLocaleString()}
                            </>
                          ) : (
                            'No rows'
                          )}
                        </span>
                        <BtnSecondary
                          type="button"
                          disabled={
                            cashHoldersLoading
                            || !cashHolders.rows?.length
                            || cashHoldersOffset + (cashHolders.rows?.length ?? 0) >= (cashHolders.total_accounts ?? 0)
                          }
                          onClick={() => fetchCashHolders(cashHoldersOffset + CASH_HOLDERS_PAGE, cashHoldersSort)}
                        >
                          Next
                        </BtnSecondary>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Landmark}
          title="Capital breakdown"
          badge={capitalBreakdown?.totals ? <span className="text-[10px] font-heading text-mutedForeground">where cash sits</span> : null}
          toolAnchor="capitalBreakdown"
          isCollapsed={collapsed.capitalBreakdown}
          onToggle={() => { toggleSection('capitalBreakdown'); if (collapsed.capitalBreakdown && !capitalBreakdown) handleFetchCapitalBreakdown(); }}
        />
        {!collapsed.capitalBreakdown && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground font-heading">
              Same rules as public <strong className="text-foreground">Stats → Game capital</strong> for the three headline numbers; extra rows show bank balances, dead/NPC/staff wallets, families, and trade escrow.
            </p>
            <BtnPrimary onClick={handleFetchCapitalBreakdown} disabled={capitalBreakdownLoading}>{capitalBreakdownLoading ? 'Loading...' : 'Load breakdown'}</BtnPrimary>
            {capitalBreakdown && (
              <div className="space-y-3 text-[10px] font-heading">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Stats total cash</div>
                    <div className="font-bold text-foreground">${(capitalBreakdown.public_stats_alignment?.total_cash ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Stats Swiss total</div>
                    <div className="font-bold text-foreground">${(capitalBreakdown.public_stats_alignment?.swiss_total ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30 flex flex-col gap-1.5">
                    <div className="text-mutedForeground uppercase">Stats interest bank</div>
                    <div className="font-bold text-foreground">${(capitalBreakdown.public_stats_alignment?.interest_bank_total ?? 0).toLocaleString()}</div>
                    <BtnSecondary type="button" onClick={handleJumpToInterestBankPlayers} className="self-start mt-0.5">
                      By player
                    </BtnSecondary>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2 rounded bg-primary/10 border border-primary/25">
                    <div className="text-mutedForeground uppercase">Alive players (cash+bank+Swiss)</div>
                    <div className="font-bold text-primary">${(capitalBreakdown.totals?.alive_players_liquid_cash_bank_swiss ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Rough sum (all buckets below)</div>
                    <div className="font-bold text-foreground">${(capitalBreakdown.totals?.approximate_all_locations_summed ?? 0).toLocaleString()}</div>
                    <div className="text-[9px] text-mutedForeground mt-0.5">Includes NPC/staff/dead/escrow; use rows to see double-counting vs wallets.</div>
                  </div>
                </div>
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-[10px] font-heading">
                    <thead>
                      <tr>
                        <th className="text-left p-1.5 text-mutedForeground">Location</th>
                        <th className="text-right p-1.5 text-mutedForeground">Amount</th>
                        <th className="text-left p-1.5 text-mutedForeground">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(capitalBreakdown.buckets || []).map((b) => (
                        <tr key={b.id} className="border-b border-zinc-700/30">
                          <td className="py-1.5 pr-2 font-medium text-foreground">{b.label}</td>
                          <td className="py-1.5 text-right whitespace-nowrap">${(b.amount ?? 0).toLocaleString()}</td>
                          <td className="py-1.5 text-mutedForeground text-[9px]">{b.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {capitalBreakdown.top_combined_liquid?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Top 15 by cash + bank + Swiss (alive, excl. staff)</div>
                    <div className="overflow-x-auto max-h-48">
                      <table className="w-full text-[9px] font-heading">
                        <thead>
                          <tr>
                            <th className="text-left p-1 text-mutedForeground">User</th>
                            <th className="text-right p-1 text-mutedForeground">Cash</th>
                            <th className="text-right p-1 text-mutedForeground">Bank</th>
                            <th className="text-right p-1 text-mutedForeground">Swiss</th>
                            <th className="text-right p-1 text-mutedForeground">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {capitalBreakdown.top_combined_liquid.map((u, i) => (
                            <tr key={u.username || i} className="border-b border-zinc-700/20">
                              <td className="py-1 pr-1 font-medium">{u.username}</td>
                              <td className="py-1 text-right">${formatWholeCash(u.money)}</td>
                              <td className="py-1 text-right">${formatWholeCash(u.bank_balance)}</td>
                              <td className="py-1 text-right">${formatWholeCash(u.swiss_balance)}</td>
                              <td className="py-1 text-right font-bold text-primary">${formatWholeCash(u.liquid)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {capitalBreakdown.top_cash_on_hand?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Top 20 cash on hand only</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px]">
                      {capitalBreakdown.top_cash_on_hand.map((u, i) => (
                        <span key={u.username || i} className="text-foreground"><span className="font-bold">{u.username}</span> ${formatWholeCash(u.money)}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Activity}
          title="Online Player Activity"
          badge={playerActivity ? <span className="text-[10px] font-heading text-primary">{playerActivity.total_online} online</span> : null}
          toolAnchor="playerActivity"
          isCollapsed={collapsed.playerActivity}
          onToggle={() => { toggleSection('playerActivity'); if (collapsed.playerActivity && !playerActivity) handleFetchPlayerActivity(); }}
        />
        {!collapsed.playerActivity && (
          <div className="p-3 space-y-2">
            <BtnPrimary onClick={handleFetchPlayerActivity} disabled={playerActivityLoading}>{playerActivityLoading ? 'Loading...' : 'Refresh'}</BtnPrimary>
            {playerActivity && (
              <div className="space-y-2">
                <div className="text-[10px] font-heading text-foreground">
                  <span className="text-primary font-bold">{playerActivity.total_online}</span> players active in the last 5 minutes
                </div>
                {playerActivity.by_page?.length > 0 && (
                  <div className="space-y-0.5 text-[10px] font-heading">
                    {playerActivity.by_page.map((item, i) => (
                      <div key={item.page || i} className="flex justify-between px-1 py-0.5 rounded bg-zinc-800/30">
                        <span className="text-foreground">{item.page}</span>
                        <span className="text-primary font-bold">{item.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Attack Analytics"
            toolAnchor="attackAnalytics"
            isCollapsed={collapsed.attackAnalytics}
            onToggle={() => toggleSection('attackAnalytics')}
          />
          {!collapsed.attackAnalytics && (
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-heading text-mutedForeground uppercase tracking-widest">Per-weapon stats</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setAttackAnalyticsDays(1)}
                    className={`px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border ${
                      attackAnalyticsDays === 1 ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'
                    }`}
                  >
                    1d
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttackAnalyticsDays(7)}
                    className={`px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border ${
                      attackAnalyticsDays === 7 ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'
                    }`}
                  >
                    7d
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttackAnalyticsDays(30)}
                    className={`px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border ${
                      attackAnalyticsDays === 30 ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'
                    }`}
                  >
                    30d
                  </button>
                </div>
                <BtnPrimary onClick={handleFetchAttackAnalytics} disabled={attackAnalyticsLoading}>
                  {attackAnalyticsLoading ? 'Loading…' : 'Load stats'}
                </BtnPrimary>
              </div>
              {attackAnalytics && (
                <div className="space-y-2">
                  <p className="text-[10px] font-heading text-mutedForeground">
                    Global: {attackAnalytics.global?.attempts ?? 0} attempts, {attackAnalytics.global?.kills ?? 0} kills,{' '}
                    {attackAnalytics.global?.kill_rate != null ? `${(attackAnalytics.global.kill_rate * 100).toFixed(1)}% kill rate` : '—'}
                  </p>
                  <div className="overflow-x-auto max-h-72">
                    {(!attackAnalytics.items || attackAnalytics.items.length === 0) ? (
                      <p className="text-[10px] text-mutedForeground font-heading">No attack attempts in this window.</p>
                    ) : (
                      <table className="w-full text-left border-collapse text-[10px] font-heading">
                        <thead className="sticky top-0 bg-zinc-900/95 z-10">
                          <tr className="border-b border-zinc-700/50">
                            <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Weapon</th>
                            <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Attempts</th>
                            <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Kills</th>
                            <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Kill %</th>
                            <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Avg bullets</th>
                            <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Avg damage</th>
                            <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Usage %</th>
                            <th className="py-1.5 font-bold text-mutedForeground uppercase">Last used</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attackAnalytics.items.map((item, idx) => (
                            <tr key={`${item.weapon_id || item.weapon_name || idx}`} className="border-b border-zinc-700/30">
                              <td className="py-1.5 pr-2 text-foreground font-medium">
                                {item.weapon_name || 'Unknown'}
                              </td>
                              <td className="py-1.5 pr-2">{item.attempts?.toLocaleString?.() ?? item.attempts}</td>
                              <td className="py-1.5 pr-2">{item.kills?.toLocaleString?.() ?? item.kills}</td>
                              <td className="py-1.5 pr-2">
                                {item.kill_rate != null ? `${(item.kill_rate * 100).toFixed(1)}%` : '—'}
                              </td>
                              <td className="py-1.5 pr-2">
                                {item.avg_bullets_per_attempt != null ? Math.round(item.avg_bullets_per_attempt).toLocaleString() : '—'}
                              </td>
                              <td className="py-1.5 pr-2">
                                {item.avg_damage != null ? item.avg_damage.toFixed(1) : '—'}
                              </td>
                              <td className="py-1.5 pr-2">
                                {item.usage_share != null ? `${(item.usage_share * 100).toFixed(1)}%` : '—'}
                              </td>
                              <td className="py-1.5">
                                {item.last_at ? new Date(item.last_at).toLocaleString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t border-zinc-700/50 pt-3 mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-heading text-mutedForeground uppercase tracking-widest">Per-user attack profile</span>
                  <Input
                    type="text"
                    value={attackUserId}
                    onChange={(e) => setAttackUserId(e.target.value)}
                    placeholder="Username or user ID"
                    className="w-48 text-[11px]"
                  />
                  <BtnSecondary onClick={handleFetchAttackUserProfile} disabled={attackUserLoading}>
                    {attackUserLoading ? 'Loading…' : 'Load user'}
                  </BtnSecondary>
                </div>
                {attackUserProfile && (
                  <div className="text-[10px] font-heading space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-mutedForeground">User:</span>
                      <span className="text-foreground font-bold">{attackUserProfile.user?.username ?? '—'}</span>
                      <span className="text-zinc-500 font-mono text-[9px]">{attackUserProfile.user?.id}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-[9px] font-heading text-mutedForeground uppercase mb-1">As attacker</div>
                        <div className="space-y-0.5 text-[10px]">
                          <div>Attempts: {attackUserProfile.attacker_summary?.attempts ?? 0}</div>
                          <div>Kills: {attackUserProfile.attacker_summary?.kills ?? 0}</div>
                          <div>
                            Kill %:{' '}
                            {attackUserProfile.attacker_summary?.kill_rate != null
                              ? `${(attackUserProfile.attacker_summary.kill_rate * 100).toFixed(1)}%`
                              : '—'}
                          </div>
                          <div>
                            Avg bullets / attempt:{' '}
                            {attackUserProfile.attacker_summary?.avg_bullets_per_attempt != null
                              ? Math.round(attackUserProfile.attacker_summary.avg_bullets_per_attempt).toLocaleString()
                              : '—'}
                          </div>
                          <div>
                            Avg damage / attempt:{' '}
                            {attackUserProfile.attacker_summary?.avg_damage_per_attempt != null
                              ? attackUserProfile.attacker_summary.avg_damage_per_attempt.toFixed(1)
                              : '—'}
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] font-heading text-mutedForeground uppercase mb-1">As target</div>
                        <div className="space-y-0.5 text-[10px]">
                          <div>Times attacked: {attackUserProfile.target_summary?.times_attacked ?? 0}</div>
                          <div>Times killed: {attackUserProfile.target_summary?.times_killed ?? 0}</div>
                          <div>
                            Death %:{' '}
                            {attackUserProfile.target_summary?.death_rate != null
                              ? `${(attackUserProfile.target_summary.death_rate * 100).toFixed(1)}%`
                              : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                    {attackUserProfile.top_weapons?.length > 0 && (
                      <div>
                        <div className="text-[9px] font-heading text-mutedForeground uppercase mb-1">Top weapons</div>
                        <div className="overflow-x-auto max-h-40">
                          <table className="w-full text-left border-collapse text-[10px] font-heading">
                            <thead>
                              <tr className="border-b border-zinc-700/50">
                                <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Weapon</th>
                                <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Attempts</th>
                                <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Kills</th>
                                <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Kill %</th>
                              </tr>
                            </thead>
                            <tbody>
                              {attackUserProfile.top_weapons.map((w, idx) => (
                                <tr key={`${w.weapon_id || w.weapon_name || idx}`} className="border-b border-zinc-700/30">
                                  <td className="py-1.5 pr-2">{w.weapon_name || 'Unknown'}</td>
                                  <td className="py-1.5 pr-2">{w.attempts?.toLocaleString?.() ?? w.attempts}</td>
                                  <td className="py-1.5 pr-2">{w.kills?.toLocaleString?.() ?? w.kills}</td>
                                  <td className="py-1.5 pr-2">
                                    {w.kill_rate != null ? `${(w.kill_rate * 100).toFixed(1)}%` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Crime Analytics */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Crime Analytics"
            badge={
              crimeAnalytics?.items
                ? <span className="text-[10px] font-heading text-mutedForeground">{crimeAnalytics.items.length} crimes</span>
                : null
            }
            toolAnchor="crimeAnalytics"
            isCollapsed={collapsed.crimeAnalytics}
            onToggle={() => toggleSection('crimeAnalytics')}
          />
          {!collapsed.crimeAnalytics && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-heading text-mutedForeground uppercase tracking-widest">Window</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCrimeAnalyticsDays(1)}
                    className={`px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border ${
                      crimeAnalyticsDays === 1 ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'
                    }`}
                  >
                    1d
                  </button>
                  <button
                    type="button"
                    onClick={() => setCrimeAnalyticsDays(7)}
                    className={`px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border ${
                      crimeAnalyticsDays === 7 ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'
                    }`}
                  >
                    7d
                  </button>
                  <button
                    type="button"
                    onClick={() => setCrimeAnalyticsDays(30)}
                    className={`px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border ${
                      crimeAnalyticsDays === 30 ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'
                    }`}
                  >
                    30d
                  </button>
                </div>
                <BtnPrimary onClick={handleFetchCrimeAnalytics} disabled={crimeAnalyticsLoading}>
                  {crimeAnalyticsLoading ? 'Loading…' : 'Load crime stats'}
                </BtnPrimary>
              </div>
              {crimeAnalytics && (
                <p className="text-[10px] text-mutedForeground font-heading">
                  Generated at {crimeAnalytics.generated_at ? new Date(crimeAnalytics.generated_at).toLocaleString() : '—'} for last {crimeAnalytics.days} day(s).
                </p>
              )}
              <div className="overflow-x-auto max-h-72">
                {!crimeAnalytics || !crimeAnalytics.items || crimeAnalytics.items.length === 0 ? (
                  <p className="text-[10px] text-mutedForeground font-heading">No crime attempts in this window.</p>
                ) : (
                  <table className="w-full text-left border-collapse text-[10px] font-heading">
                    <thead className="sticky top-0 bg-zinc-900/95 z-10">
                      <tr className="border-b border-zinc-700/50">
                        <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Crime</th>
                        <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Type</th>
                        <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Attempts</th>
                        <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Successes</th>
                        <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Success %</th>
                        <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Avg profit</th>
                        <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Total profit</th>
                        <th className="py-1.5 pr-2 font-bold text-mutedForeground uppercase">Usage %</th>
                        <th className="py-1.5 font-bold text-mutedForeground uppercase">Last used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crimeAnalytics.items.map((item) => (
                        <tr key={item.crime_id} className="border-b border-zinc-700/30">
                          <td className="py-1.5 pr-2 text-foreground font-medium">{item.crime_name || item.crime_id}</td>
                          <td className="py-1.5 pr-2 text-mutedForeground">{item.crime_type || 'normal'}</td>
                          <td className="py-1.5 pr-2">{item.attempts?.toLocaleString?.() ?? item.attempts}</td>
                          <td className="py-1.5 pr-2">{item.successes?.toLocaleString?.() ?? item.successes}</td>
                          <td className="py-1.5 pr-2">
                            {item.success_rate != null ? `${(item.success_rate * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td className="py-1.5 pr-2">
                            {item.avg_profit != null ? `$${Math.round(item.avg_profit).toLocaleString()}` : '—'}
                          </td>
                          <td className="py-1.5 pr-2">
                            {item.total_profit != null ? `$${Number(item.total_profit).toLocaleString()}` : '—'}
                          </td>
                          <td className="py-1.5 pr-2">
                            {item.usage_share != null ? `${(item.usage_share * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td className="py-1.5">
                            {item.last_at ? new Date(item.last_at).toLocaleString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>


        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Casino Analytics"
            badge={casinoAnalytics?.items ? <span className="text-[10px] font-heading text-mutedForeground">{casinoAnalytics.items.length} games</span> : null}
            toolAnchor="casinoAnalytics"
            isCollapsed={collapsed.casinoAnalytics}
            onToggle={() => toggleSection('casinoAnalytics')}
          />
          {!collapsed.casinoAnalytics && (
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {[1, 7, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setCasinoAnalyticsDays(d)}
                    className={`px-2 py-1 rounded border text-[10px] font-heading ${casinoAnalyticsDays === d ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}
                  >
                    {d}d
                  </button>
                ))}
                <BtnPrimary onClick={handleFetchCasinoAnalytics} disabled={casinoAnalyticsLoading}>
                  {casinoAnalyticsLoading ? 'Loading…' : 'Load stats'}
                </BtnPrimary>
              </div>
              {casinoAnalytics && (
                <>
                  <p className="text-[10px] text-mutedForeground font-heading">Generated at {casinoAnalytics.generated_at ? new Date(casinoAnalytics.generated_at).toLocaleString() : '—'} for last {casinoAnalytics.days} day(s).</p>
                  {casinoAnalytics.totals && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                        <div className="text-[9px] text-mutedForeground font-heading uppercase">Total Bets</div>
                        <div className="text-sm font-heading font-bold">{casinoAnalytics.totals.total_attempts?.toLocaleString() || 0}</div>
                      </div>
                      <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                        <div className="text-[9px] text-mutedForeground font-heading uppercase">Total Staked</div>
                        <div className="text-sm font-heading font-bold">${casinoAnalytics.totals.total_stake?.toLocaleString() || 0}</div>
                      </div>
                      <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                        <div className="text-[9px] text-mutedForeground font-heading uppercase">Total Paid Out</div>
                        <div className="text-sm font-heading font-bold">${casinoAnalytics.totals.total_payout?.toLocaleString() || 0}</div>
                      </div>
                      <div className={`rounded p-2 border ${(casinoAnalytics.totals.total_house_profit || 0) >= 0 ? 'bg-green-900/30 border-green-700/40' : 'bg-red-900/30 border-red-700/40'}`}>
                        <div className="text-[9px] text-mutedForeground font-heading uppercase">House Profit</div>
                        <div className={`text-sm font-heading font-bold ${(casinoAnalytics.totals.total_house_profit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>${casinoAnalytics.totals.total_house_profit?.toLocaleString() || 0}</div>
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto max-h-80">
                    {(!casinoAnalytics.items || casinoAnalytics.items.length === 0) ? (
                      <p className="text-[10px] text-mutedForeground font-heading">No casino activity in this window.</p>
                    ) : (
                      <table className="w-full text-[10px] font-heading">
                        <thead><tr>
                          <th className="text-left p-1.5 text-mutedForeground">Game</th>
                          <th className="text-right p-1.5 text-mutedForeground">Bets</th>
                          <th className="text-right p-1.5 text-mutedForeground">Wins</th>
                          <th className="text-right p-1.5 text-mutedForeground">Win %</th>
                          <th className="text-right p-1.5 text-mutedForeground">Staked</th>
                          <th className="text-right p-1.5 text-mutedForeground">Paid Out</th>
                          <th className="text-right p-1.5 text-mutedForeground">House Profit</th>
                          <th className="text-right p-1.5 text-mutedForeground">Share</th>
                        </tr></thead>
                        <tbody>
                          {casinoAnalytics.items.map((item, idx) => (
                            <tr key={idx} className="border-b border-zinc-700/30">
                              <td className="py-1.5 pr-2 font-medium">{CASINO_ANALYTICS_GAME_LABELS[item.game_type] || item.game_type || '—'}</td>
                              <td className="py-1.5 text-right">{item.attempts != null ? item.attempts.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.wins != null ? item.wins.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.win_rate != null ? `${(item.win_rate * 100).toFixed(1)}%` : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_stake != null ? `$${Number(item.total_stake).toLocaleString()}` : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_payout != null ? `$${Number(item.total_payout).toLocaleString()}` : '—'}</td>
                              <td className={`py-1.5 text-right ${(item.house_profit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{item.house_profit != null ? `$${Number(item.house_profit).toLocaleString()}` : '—'}</td>
                              <td className="py-1.5 text-right">{item.usage_share != null ? `${(item.usage_share * 100).toFixed(1)}%` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Casino Ownership Profits */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Casino Ownership Profits"
            badge={ownershipProfits?.items ? <span className="text-[10px] font-heading text-mutedForeground">{ownershipProfits.items.length} casinos</span> : null}
            toolAnchor="ownershipProfits"
            isCollapsed={collapsed.ownershipProfits}
            onToggle={() => toggleSection('ownershipProfits')}
          />
          {!collapsed.ownershipProfits && (
            <div className="p-3 space-y-2">
              <BtnPrimary onClick={handleFetchOwnershipProfits} disabled={ownershipProfitsLoading}>
                {ownershipProfitsLoading ? 'Loading…' : 'Load ownership profits'}
              </BtnPrimary>
              {ownershipProfits && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className={`rounded p-2 border ${(ownershipProfits.grand_total_profit || 0) >= 0 ? 'bg-green-900/30 border-green-700/40' : 'bg-red-900/30 border-red-700/40'}`}>
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Total Owner Profit</div>
                      <div className={`text-sm font-heading font-bold ${(ownershipProfits.grand_total_profit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>${ownershipProfits.grand_total_profit?.toLocaleString() || 0}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Total Earnings</div>
                      <div className="text-sm font-heading font-bold">${ownershipProfits.grand_total_earnings?.toLocaleString() || 0}</div>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-80">
                    {(!ownershipProfits.items || ownershipProfits.items.length === 0) ? (
                      <p className="text-[10px] text-mutedForeground font-heading">No casino ownerships found.</p>
                    ) : (
                      <table className="w-full text-[10px] font-heading">
                        <thead><tr>
                          <th className="text-left p-1.5 text-mutedForeground">Game</th>
                          <th className="text-left p-1.5 text-mutedForeground">City</th>
                          <th className="text-left p-1.5 text-mutedForeground">Owner</th>
                          <th className="text-right p-1.5 text-mutedForeground">Profit</th>
                          <th className="text-right p-1.5 text-mutedForeground">Total Earnings</th>
                        </tr></thead>
                        <tbody>
                          {ownershipProfits.items.map((item, idx) => (
                            <tr key={idx} className="border-b border-zinc-700/30">
                              <td className="py-1.5 pr-2 font-medium">{item.game || '—'}</td>
                              <td className="py-1.5 pr-2">{item.city || '—'}</td>
                              <td className="py-1.5 pr-2">{item.owner_username || '—'}</td>
                              <td className={`py-1.5 text-right ${(item.profit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>${Number(item.profit || 0).toLocaleString()}</td>
                              <td className="py-1.5 text-right">${Number(item.total_earnings || 0).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Trades Analytics */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Trades (Quicktrade) Analytics"
            badge={tradesAnalytics?.items ? <span className="text-[10px] font-heading text-mutedForeground">{tradesAnalytics.items.length} types</span> : null}
            toolAnchor="tradesAnalytics"
            isCollapsed={collapsed.tradesAnalytics}
            onToggle={() => toggleSection('tradesAnalytics')}
          />
          {!collapsed.tradesAnalytics && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {[1, 7, 30].map((d) => (
                  <button key={d} type="button" onClick={() => setTradesAnalyticsDays(d)} className={`px-2 py-1 rounded border text-[10px] font-heading ${tradesAnalyticsDays === d ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}>{d}d</button>
                ))}
                <BtnPrimary onClick={handleFetchTradesAnalytics} disabled={tradesAnalyticsLoading}>{tradesAnalyticsLoading ? 'Loading…' : 'Load stats'}</BtnPrimary>
              </div>
              {tradesAnalytics && (
                <>
                  <p className="text-[10px] text-mutedForeground font-heading">Last {tradesAnalytics.days} day(s).</p>
                  <div className="overflow-x-auto max-h-72">
                    {(!tradesAnalytics.items || tradesAnalytics.items.length === 0) ? <p className="text-[10px] text-mutedForeground font-heading">No trade events.</p> : (
                      <table className="w-full text-[10px] font-heading">
                        <thead><tr><th className="text-left p-1.5 text-mutedForeground">Type</th><th className="text-left p-1.5 text-mutedForeground">Direction</th><th className="text-right p-1.5 text-mutedForeground">Count</th><th className="text-right p-1.5 text-mutedForeground">Points</th><th className="text-right p-1.5 text-mutedForeground">Money</th><th className="text-right p-1.5 text-mutedForeground">Share</th></tr></thead>
                        <tbody>
                          {tradesAnalytics.items.map((item, idx) => (
                            <tr key={idx} className="border-b border-zinc-700/30">
                              <td className="py-1.5 pr-2 font-medium">{item.event_type || '—'}</td>
                              <td className="py-1.5">{item.direction || '—'}</td>
                              <td className="py-1.5 text-right">{item.count != null ? item.count.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_points != null ? item.total_points.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_money != null ? item.total_money.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.usage_share != null ? `${(item.usage_share * 100).toFixed(1)}%` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Hitlist & Bodyguards Analytics */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Hitlist & Bodyguards Analytics"
            badge={hitlistBodyguardsAnalytics?.items ? <span className="text-[10px] font-heading text-mutedForeground">{hitlistBodyguardsAnalytics.items.length} event types</span> : null}
            toolAnchor="hitlistBodyguardsAnalytics"
            isCollapsed={collapsed.hitlistBodyguardsAnalytics}
            onToggle={() => toggleSection('hitlistBodyguardsAnalytics')}
          />
          {!collapsed.hitlistBodyguardsAnalytics && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {[1, 7, 30].map((d) => (
                  <button key={d} type="button" onClick={() => setHitlistBodyguardsAnalyticsDays(d)} className={`px-2 py-1 rounded border text-[10px] font-heading ${hitlistBodyguardsAnalyticsDays === d ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}>{d}d</button>
                ))}
                <BtnPrimary onClick={handleFetchHitlistBodyguardsAnalytics} disabled={hitlistBodyguardsAnalyticsLoading}>{hitlistBodyguardsAnalyticsLoading ? 'Loading…' : 'Load stats'}</BtnPrimary>
              </div>
              {hitlistBodyguardsAnalytics && (
                <>
                  <p className="text-[10px] text-mutedForeground font-heading">Last {hitlistBodyguardsAnalytics.days} day(s).</p>
                  <div className="overflow-x-auto max-h-72">
                    {(!hitlistBodyguardsAnalytics.items || hitlistBodyguardsAnalytics.items.length === 0) ? <p className="text-[10px] text-mutedForeground font-heading">No events.</p> : (
                      <table className="w-full text-[10px] font-heading">
                        <thead><tr><th className="text-left p-1.5 text-mutedForeground">Event type</th><th className="text-right p-1.5 text-mutedForeground">Count</th><th className="text-right p-1.5 text-mutedForeground">Cost cash</th><th className="text-right p-1.5 text-mutedForeground">Cost pts</th><th className="text-right p-1.5 text-mutedForeground">Hire cost</th><th className="text-right p-1.5 text-mutedForeground">Share</th></tr></thead>
                        <tbody>
                          {hitlistBodyguardsAnalytics.items.map((item, idx) => (
                            <tr key={idx} className="border-b border-zinc-700/30">
                              <td className="py-1.5 pr-2 font-medium">{item.event_type || '—'}</td>
                              <td className="py-1.5 text-right">{item.count != null ? item.count.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_cost_cash != null ? item.total_cost_cash.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_cost_points != null ? item.total_cost_points.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_hire_cost != null ? item.total_hire_cost.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.usage_share != null ? `${(item.usage_share * 100).toFixed(1)}%` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Economy Analytics (cars, properties, loot, booze) */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Economy Analytics"
            badge={economyAnalytics?.items ? <span className="text-[10px] font-heading text-mutedForeground">{economyAnalytics.items.length} types</span> : null}
            toolAnchor="economyAnalytics"
            isCollapsed={collapsed.economyAnalytics}
            onToggle={() => toggleSection('economyAnalytics')}
          />
          {!collapsed.economyAnalytics && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {[1, 7, 30].map((d) => (
                  <button key={d} type="button" onClick={() => setEconomyAnalyticsDays(d)} className={`px-2 py-1 rounded border text-[10px] font-heading ${economyAnalyticsDays === d ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}>{d}d</button>
                ))}
                <BtnPrimary onClick={handleFetchEconomyAnalytics} disabled={economyAnalyticsLoading}>{economyAnalyticsLoading ? 'Loading…' : 'Load stats'}</BtnPrimary>
              </div>
              {economyAnalytics && (
                <>
                  <p className="text-[10px] text-mutedForeground font-heading">Car trades, property buys, loot drops, loot box opens, booze runs. Last {economyAnalytics.days} day(s).</p>
                  <div className="overflow-x-auto max-h-72">
                    {(!economyAnalytics.items || economyAnalytics.items.length === 0) ? <p className="text-[10px] text-mutedForeground font-heading">No economy events.</p> : (
                      <table className="w-full text-[10px] font-heading">
                        <thead><tr><th className="text-left p-1.5 text-mutedForeground">Type</th><th className="text-right p-1.5 text-mutedForeground">Count</th><th className="text-right p-1.5 text-mutedForeground">Price/Cost</th><th className="text-right p-1.5 text-mutedForeground">Profit</th><th className="text-right p-1.5 text-mutedForeground">Revenue</th><th className="text-right p-1.5 text-mutedForeground">Pieces</th><th className="text-right p-1.5 text-mutedForeground">Share</th></tr></thead>
                        <tbody>
                          {economyAnalytics.items.map((item, idx) => (
                            <tr key={idx} className="border-b border-zinc-700/30">
                              <td className="py-1.5 pr-2 font-medium">{item.event_type || '—'}</td>
                              <td className="py-1.5 text-right">{item.count != null ? item.count.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{(item.total_price || item.total_cost) != null ? (item.total_price || item.total_cost).toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_profit != null ? item.total_profit.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_revenue != null ? item.total_revenue.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_pieces != null ? item.total_pieces.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.usage_share != null ? `${(item.usage_share * 100).toFixed(1)}%` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Unified analytics workspace (v2) */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Analytics Workspace (V2)"
            badge={analyticsV2Overview?.items ? <span className="text-[10px] font-heading text-mutedForeground">{analyticsV2Overview.items.length} domains</span> : null}
            toolAnchor="analyticsWorkspaceV2"
            isCollapsed={collapsed.analyticsWorkspaceV2}
            onToggle={() => toggleSection('analyticsWorkspaceV2')}
          />
          {!collapsed.analyticsWorkspaceV2 && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <AdminSelect value={analyticsV2Bucket} onChange={(e) => setAnalyticsV2Bucket(e.target.value)} className="w-28">
                  <option value="realtime_5m">5m</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </AdminSelect>
                <AdminInput type="number" min="1" max="365" value={analyticsV2Periods} onChange={(e) => setAnalyticsV2Periods(Number(e.target.value) || 14)} className="w-20" />
                <AdminInput value={analyticsV2Domain} onChange={(e) => setAnalyticsV2Domain(e.target.value)} placeholder="optional domain" className="w-36" />
                <BtnPrimary onClick={handleFetchAnalyticsV2} disabled={analyticsV2Loading}>{analyticsV2Loading ? 'Loading…' : 'Load v2'}</BtnPrimary>
                <BtnSecondary onClick={handleRunAnalyticsV2Rollup} disabled={analyticsV2RollupLoading}>{analyticsV2RollupLoading ? 'Running…' : 'Run rollups'}</BtnSecondary>
              </div>
              {analyticsV2Overview && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40"><div className="text-[9px] text-mutedForeground font-heading uppercase">Events</div><div className="text-sm font-heading font-bold">{(analyticsV2Overview.total_events || 0).toLocaleString()}</div></div>
                  <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40"><div className="text-[9px] text-mutedForeground font-heading uppercase">Total value</div><div className="text-sm font-heading font-bold">{Math.round(analyticsV2Overview.total_value || 0).toLocaleString()}</div></div>
                  <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40"><div className="text-[9px] text-mutedForeground font-heading uppercase">Bucket</div><div className="text-sm font-heading font-bold">{analyticsV2Overview.bucket}</div></div>
                  <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40"><div className="text-[9px] text-mutedForeground font-heading uppercase">Periods</div><div className="text-sm font-heading font-bold">{analyticsV2Overview.periods}</div></div>
                </div>
              )}
              {analyticsV2Overview?.items?.length > 0 && (
                <div className="overflow-x-auto max-h-56">
                  <table className="w-full text-[10px] font-heading">
                    <thead><tr><th className="text-left p-1.5 text-mutedForeground">Domain</th><th className="text-right p-1.5 text-mutedForeground">Events</th><th className="text-right p-1.5 text-mutedForeground">Value</th><th className="text-right p-1.5 text-mutedForeground">Users</th></tr></thead>
                    <tbody>
                      {analyticsV2Overview.items.map((it) => (
                        <tr key={it.domain} className="border-b border-zinc-700/30">
                          <td className="py-1.5 pr-2 font-medium">{it.domain || '—'}</td>
                          <td className="py-1.5 text-right">{(it.events || 0).toLocaleString()}</td>
                          <td className="py-1.5 text-right">{Math.round(it.total_value || 0).toLocaleString()}</td>
                          <td className="py-1.5 text-right">{(it.unique_users || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {analyticsV2Leaders?.leaders?.length > 0 && (
                <div className="overflow-x-auto max-h-48">
                  <p className="text-[10px] text-mutedForeground font-heading mb-1">Top users for domain: {(analyticsV2Leaders.domain || '').trim()}</p>
                  <table className="w-full text-[10px] font-heading">
                    <thead><tr><th className="text-left p-1.5 text-mutedForeground">User</th><th className="text-right p-1.5 text-mutedForeground">Events</th><th className="text-right p-1.5 text-mutedForeground">Value</th></tr></thead>
                    <tbody>
                      {analyticsV2Leaders.leaders.map((it) => (
                        <tr key={it.user_id || it.username} className="border-b border-zinc-700/30">
                          <td className="py-1.5 pr-2 font-medium">{it.username || '—'}</td>
                          <td className="py-1.5 text-right">{(it.events || 0).toLocaleString()}</td>
                          <td className="py-1.5 text-right">{Math.round(it.total_value || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Booze-run analytics (economy_events + user counters) */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Wine}
            title="Booze-run analytics"
            badge={boozeRunOverview?.booze_run_sell ? <span className="text-[10px] font-heading text-mutedForeground">{boozeRunOverview.days}d window</span> : null}
            toolAnchor="boozeRunAnalytics"
            isCollapsed={collapsed.boozeRunAnalytics}
            onToggle={() => toggleSection('boozeRunAnalytics')}
          />
          {!collapsed.boozeRunAnalytics && (
            <div className="p-3 space-y-3">
              <div className="text-[10px] text-mutedForeground font-heading space-y-1 leading-relaxed">
                <p>
                  <span className="text-foreground/90 font-semibold">How to read this</span>
                  {' — '}
                  Numbers in the overview are summed from <code className="text-[9px] bg-zinc-800/80 px-1 rounded">economy_events</code> in the selected window.
                  <strong className="text-foreground/80"> Sell revenue</strong> is cash from completed runs; <strong className="text-foreground/80">sell profit</strong> is net after buy cost and run rules (badges, multiplier).
                  They are <em>not</em> supposed to match confiscation — jail rows track inventory cost lost separately.
                </p>
                <p>
                  Leaderboard rows use lifetime fields on <code className="text-[9px] bg-zinc-800/80 px-1 rounded">users</code>.
                  <strong className="text-foreground/80"> Run profit (LB)</strong> is <code className="text-[9px]">booze_run_profit_total</code> (leaderboard);
                  <strong className="text-foreground/80"> Net profit (stored)</strong> is <code className="text-[9px]">booze_profit_total</code> (same sell logic, not double-counted by Auto Rank).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[9px] text-mutedForeground font-heading uppercase">Overview / leaders</span>
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setBoozeRunAnalyticsDays(d)}
                    className={`px-2 py-1 rounded border text-[10px] font-heading ${boozeRunAnalyticsDays === d ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}
                  >
                    {d}d
                  </button>
                ))}
                <BtnPrimary onClick={handleFetchBoozeRunOverview} disabled={boozeRunOverviewLoading}>
                  {boozeRunOverviewLoading ? 'Loading…' : 'Load overview'}
                </BtnPrimary>
                <AdminSelect
                  value={String(boozeRunLeadersLimit)}
                  onChange={(e) => setBoozeRunLeadersLimit(Number(e.target.value) || 50)}
                  className="w-20"
                >
                  <option value="25">Top 25</option>
                  <option value="50">Top 50</option>
                  <option value="100">Top 100</option>
                  <option value="200">Top 200</option>
                </AdminSelect>
                <AdminSelect
                  value={boozeRunLeadersSort}
                  onChange={(e) => setBoozeRunLeadersSort(e.target.value)}
                  className="w-36"
                >
                  <option value="profit">Sort: profit</option>
                  <option value="runs">Sort: runs</option>
                  <option value="jails">Sort: jails</option>
                </AdminSelect>
                <BtnPrimary onClick={handleFetchBoozeRunLeaders} disabled={boozeRunLeadersLoading}>
                  {boozeRunLeadersLoading ? 'Loading…' : 'Load leaders'}
                </BtnPrimary>
              </div>
              {boozeRunOverview && (
                <div className="space-y-2">
                  <div className="text-[9px] font-heading text-primary/90 uppercase tracking-wide">Completed sells (window)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Completed sells</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">economy_events booze_run_sell</div>
                      <div className="text-sm font-heading font-bold">{boozeRunOverview.booze_run_sell?.count?.toLocaleString?.() ?? '—'}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Sell revenue</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Cash in from sales</div>
                      <div className="text-sm font-heading font-bold">${(boozeRunOverview.booze_run_sell?.total_revenue ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Net sell profit</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">After buy cost &amp; rules</div>
                      <div className="text-sm font-heading font-bold text-green-400">${(boozeRunOverview.booze_run_sell?.total_profit ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Buy cost (approx.)</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Revenue − profit (sum)</div>
                      <div className="text-sm font-heading font-bold">${(boozeRunOverview.booze_run_sell?.total_buy_cost_approx ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Profit / revenue</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Aggregate margin</div>
                      <div className="text-sm font-heading font-bold">{(boozeRunOverview.booze_run_sell?.profit_pct_of_revenue ?? 0).toLocaleString()}%</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Avg / sell</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Profit · Revenue</div>
                      <div className="text-xs font-heading font-bold">
                        ${(boozeRunOverview.booze_run_sell?.avg_profit_per_sell ?? 0).toLocaleString()}
                        <span className="text-mutedForeground font-normal"> · </span>
                        ${(boozeRunOverview.booze_run_sell?.avg_revenue_per_sell ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Unique sellers</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Users with ≥1 sell</div>
                      <div className="text-sm font-heading font-bold">{boozeRunOverview.booze_run_sell?.unique_users?.toLocaleString?.() ?? '—'}</div>
                    </div>
                  </div>
                  <div className="text-[9px] font-heading text-amber-400/90 uppercase tracking-wide pt-1">Jails (window)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-zinc-800/60 rounded p-2 border border-amber-700/30">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Jail events</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">booze_run_jail</div>
                      <div className="text-sm font-heading font-bold text-amber-400">{boozeRunOverview.booze_run_jail?.count?.toLocaleString?.() ?? '—'}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-amber-700/30">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Confiscation basis</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Inventory cost lost</div>
                      <div className="text-sm font-heading font-bold text-amber-400">${(boozeRunOverview.booze_run_jail?.total_inventory_loss_basis ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Jail at buy / sell</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Phase counts</div>
                      <div className="text-sm font-heading font-bold">
                        {(boozeRunOverview.booze_run_jail?.buy_phase_count ?? 0).toLocaleString()} / {(boozeRunOverview.booze_run_jail?.sell_phase_count ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Unique jailed</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Users with ≥1 jail</div>
                      <div className="text-sm font-heading font-bold">{boozeRunOverview.booze_run_jail?.unique_users?.toLocaleString?.() ?? '—'}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="bg-zinc-900/40 rounded p-2 border border-zinc-700/30">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Distinct users (sell or jail)</div>
                      <div className="text-[8px] text-mutedForeground font-heading normal-case">Union of seller and jailed user ids</div>
                      <div className="text-sm font-heading font-bold">{boozeRunOverview.unique_users_any?.toLocaleString?.() ?? '—'}</div>
                    </div>
                  </div>
                </div>
              )}
              {boozeRunLeaders?.leaders && (
                <div className="overflow-x-auto max-h-64">
                  <p className="text-[10px] text-mutedForeground font-heading mb-1">
                    Leaders — sort: {boozeRunLeaders.sort}; lifetime fields from <code className="text-[9px] bg-zinc-800/80 px-0.5 rounded">users</code>. Run profit (LB) = leaderboard total; net profit = stored stats field.
                  </p>
                  {boozeRunLeaders.leaders.length === 0 ? (
                    <p className="text-[10px] text-mutedForeground font-heading">No users with booze runs or jails.</p>
                  ) : (
                    <table className="w-full text-[10px] font-heading">
                      <thead>
                        <tr>
                          <th className="text-left p-1.5 text-mutedForeground">User</th>
                          <th className="text-right p-1.5 text-mutedForeground">Runs</th>
                          <th className="text-right p-1.5 text-mutedForeground">Jails</th>
                          <th className="text-right p-1.5 text-mutedForeground" title="booze_run_profit_total">Run profit (LB)</th>
                          <th className="text-right p-1.5 text-mutedForeground" title="booze_profit_total">Net profit (stored)</th>
                          <th className="text-right p-1.5 text-mutedForeground">Avg/run</th>
                          <th className="text-right p-1.5 text-mutedForeground">Auto runs</th>
                          <th className="text-right p-1.5 text-mutedForeground">Auto profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boozeRunLeaders.leaders.map((row) => (
                          <tr key={row.id || row.username} className="border-b border-zinc-700/30">
                            <td className="py-1.5 pr-2 font-medium">{row.username || '—'}</td>
                            <td className="py-1.5 text-right">{row.booze_runs_count != null ? row.booze_runs_count.toLocaleString() : '—'}</td>
                            <td className="py-1.5 text-right">{row.booze_jail_count != null ? row.booze_jail_count.toLocaleString() : '—'}</td>
                            <td className="py-1.5 text-right text-green-400/90">${(row.booze_run_profit_total ?? 0).toLocaleString()}</td>
                            <td className="py-1.5 text-right">${(row.booze_profit_total ?? 0).toLocaleString()}</td>
                            <td className="py-1.5 text-right">${(row.avg_profit_per_run_lifetime ?? 0).toLocaleString()}</td>
                            <td className="py-1.5 text-right">{(row.auto_rank_total_booze_runs ?? 0).toLocaleString()}</td>
                            <td className="py-1.5 text-right">${(row.auto_rank_total_booze_profit ?? 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              <div className="border-t border-zinc-700/40 pt-2 space-y-2">
                <div className="text-[9px] text-mutedForeground font-heading uppercase">Per-user report</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={boozeRunUserQuery}
                    onChange={(e) => setBoozeRunUserQuery(e.target.value)}
                    placeholder="Username or user ID"
                    className="min-w-[12rem] flex-1 max-w-md bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                  />
                  {[30, 90, 365].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setBoozeRunUserDays(d)}
                      className={`px-2 py-1 rounded border text-[10px] font-heading ${boozeRunUserDays === d ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}
                    >
                      {d}d
                    </button>
                  ))}
                  <BtnPrimary onClick={handleFetchBoozeRunUser} disabled={boozeRunUserLoading}>
                    {boozeRunUserLoading ? 'Loading…' : 'Load user'}
                  </BtnPrimary>
                </div>
                {boozeRunUserProfile && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-heading font-bold text-primary">
                      {boozeRunUserProfile.username} <span className="text-mutedForeground font-normal">({boozeRunUserProfile.user_id})</span>
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      <div className="bg-zinc-800/50 rounded p-2 border border-zinc-700/30">
                        <div className="text-[9px] text-mutedForeground uppercase">Lifetime runs</div>
                        <div className="text-sm font-bold">{boozeRunUserProfile.lifetime?.booze_runs_count?.toLocaleString?.() ?? 0}</div>
                      </div>
                      <div className="bg-zinc-800/50 rounded p-2 border border-zinc-700/30">
                        <div className="text-[9px] text-mutedForeground uppercase">Lifetime jails</div>
                        <div className="text-sm font-bold text-amber-400">{boozeRunUserProfile.lifetime?.booze_jail_count?.toLocaleString?.() ?? 0}</div>
                      </div>
                      <div className="bg-zinc-800/50 rounded p-2 border border-zinc-700/30">
                        <div className="text-[9px] text-mutedForeground uppercase">Run profit (LB)</div>
                        <div className="text-[8px] text-mutedForeground normal-case">booze_run_profit_total</div>
                        <div className="text-sm font-bold text-green-400">${(boozeRunUserProfile.lifetime?.booze_run_profit_total ?? 0).toLocaleString()}</div>
                      </div>
                      <div className="bg-zinc-800/50 rounded p-2 border border-zinc-700/30">
                        <div className="text-[9px] text-mutedForeground uppercase">Net profit (stored)</div>
                        <div className="text-[8px] text-mutedForeground normal-case">booze_profit_total</div>
                        <div className="text-sm font-bold">${(boozeRunUserProfile.lifetime?.booze_profit_total ?? 0).toLocaleString()}</div>
                      </div>
                      <div className="bg-zinc-800/50 rounded p-2 border border-zinc-700/30">
                        <div className="text-[9px] text-mutedForeground uppercase">Avg / completed run</div>
                        <div className="text-sm font-bold">${(boozeRunUserProfile.lifetime?.avg_profit_per_completed_run ?? 0).toLocaleString()}</div>
                      </div>
                      <div className="bg-zinc-800/50 rounded p-2 border border-zinc-700/30">
                        <div className="text-[9px] text-mutedForeground uppercase">Auto rank</div>
                        <div className="text-[8px] text-mutedForeground normal-case">runs / profit</div>
                        <div className="text-xs font-bold">
                          {(boozeRunUserProfile.lifetime?.auto_rank_total_booze_runs ?? 0).toLocaleString()}
                          <span className="text-mutedForeground font-normal"> · </span>
                          ${(boozeRunUserProfile.lifetime?.auto_rank_total_booze_profit ?? 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] text-mutedForeground font-heading space-y-1 leading-relaxed border border-zinc-700/30 rounded p-2 bg-zinc-900/30">
                      <div className="text-[9px] text-primary/90 uppercase tracking-wide">Window (economy_events)</div>
                      <p>
                        Last <strong className="text-foreground/90">{boozeRunUserProfile.window_days}d</strong>:{' '}
                        <strong className="text-foreground/90">{boozeRunUserProfile.window?.completed_runs ?? 0}</strong> completed sells;{' '}
                        revenue <strong className="text-foreground/90">${(boozeRunUserProfile.window?.total_revenue ?? 0).toLocaleString()}</strong>,{' '}
                        net profit <strong className="text-green-400/90">${(boozeRunUserProfile.window?.total_profit ?? 0).toLocaleString()}</strong>,{' '}
                        buy cost (approx.) <strong className="text-foreground/90">${(boozeRunUserProfile.window?.total_buy_cost_approx ?? 0).toLocaleString()}</strong>{' '}
                        (revenue − profit); avg profit/sell <strong className="text-foreground/90">${(boozeRunUserProfile.window?.avg_profit_per_run ?? 0).toLocaleString()}</strong>.
                      </p>
                      <p>
                        Jails in window: <strong className="text-amber-400/90">{boozeRunUserProfile.window?.jail_events ?? 0}</strong> events;{' '}
                        confiscation basis (inventory cost) <strong className="text-amber-400/90">${(boozeRunUserProfile.window?.total_confiscation_basis ?? 0).toLocaleString()}</strong>{' '}
                        — separate from sell revenue/profit above.
                      </p>
                    </div>
                    <div className="overflow-x-auto max-h-40">
                      <div className="text-[9px] text-mutedForeground font-heading mb-1">Recent booze history (last 10)</div>
                      {(!boozeRunUserProfile.booze_run_history || boozeRunUserProfile.booze_run_history.length === 0) ? (
                        <p className="text-[10px] text-mutedForeground font-heading">No history rows.</p>
                      ) : (
                        <table className="w-full text-[10px] font-heading">
                          <thead>
                            <tr>
                              <th className="text-left p-1 text-mutedForeground">When</th>
                              <th className="text-left p-1 text-mutedForeground">Action</th>
                              <th className="text-left p-1 text-mutedForeground">Booze</th>
                              <th className="text-right p-1 text-mutedForeground">Amt</th>
                              <th className="text-right p-1 text-mutedForeground">Profit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {boozeRunUserProfile.booze_run_history.map((h, i) => (
                              <tr key={i} className="border-b border-zinc-700/20">
                                <td className="py-1 pr-1 whitespace-nowrap">{h.at ? new Date(h.at).toLocaleString() : '—'}</td>
                                <td className="py-1 pr-1">{h.action || '—'}{h.is_run ? ' (run)' : ''}</td>
                                <td className="py-1 pr-1">{h.booze_name || '—'}</td>
                                <td className="py-1 text-right">{h.amount != null ? h.amount.toLocaleString() : '—'}</td>
                                <td className="py-1 text-right">{h.profit != null ? `$${Number(h.profit).toLocaleString()}` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    <div className="overflow-x-auto max-h-48">
                      <div className="text-[9px] text-mutedForeground font-heading mb-1">Economy events in window (up to 100)</div>
                      {(!boozeRunUserProfile.recent_events || boozeRunUserProfile.recent_events.length === 0) ? (
                        <p className="text-[10px] text-mutedForeground font-heading">No sell/jail events in window.</p>
                      ) : (
                        <table className="w-full text-[9px] font-heading">
                          <thead>
                            <tr>
                              <th className="text-left p-1 text-mutedForeground">When</th>
                              <th className="text-left p-1 text-mutedForeground">Type</th>
                              <th className="text-right p-1 text-mutedForeground">Profit</th>
                              <th className="text-right p-1 text-mutedForeground">Rev</th>
                              <th className="text-left p-1 text-mutedForeground">Phase / loss</th>
                            </tr>
                          </thead>
                          <tbody>
                            {boozeRunUserProfile.recent_events.map((ev, i) => (
                              <tr key={i} className="border-b border-zinc-700/20">
                                <td className="py-1 pr-1 whitespace-nowrap">{ev.at ? new Date(ev.at).toLocaleString() : '—'}</td>
                                <td className="py-1 pr-1">{ev.type || '—'}</td>
                                <td className="py-1 text-right">{ev.profit != null ? ev.profit.toLocaleString() : '—'}</td>
                                <td className="py-1 text-right">{ev.revenue != null ? ev.revenue.toLocaleString() : '—'}</td>
                                <td className="py-1 pr-1">
                                  {ev.phase ? ev.phase : '—'}
                                  {ev.inventory_loss_basis != null ? ` · basis ${ev.inventory_loss_basis.toLocaleString()}` : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Interest bank — active deposits by player */}
        <div
          id="admin-interest-bank-players"
          className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}
        >
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Landmark}
            title="Interest bank (active deposits)"
            badge={
              interestBankByPlayer?.players ? (
                <span className="text-[10px] font-heading text-mutedForeground">
                  {interestBankByPlayer.count} players — ${(interestBankByPlayer.totals?.total_locked ?? 0).toLocaleString()} locked
                </span>
              ) : null
            }
            toolAnchor="interestBankPlayers"
            isCollapsed={collapsed.interestBankPlayers}
            onToggle={() => toggleSection('interestBankPlayers')}
          />
          {!collapsed.interestBankPlayers && (
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">
                Unclaimed time deposits only (principal + accrued interest). Excludes staff by default — same as capital breakdown.
              </p>
              <label className="flex items-center gap-2 cursor-pointer text-[10px] font-heading text-foreground">
                <input
                  type="checkbox"
                  checked={interestBankIncludeStaff}
                  onChange={(e) => setInterestBankIncludeStaff(e.target.checked)}
                  className="rounded border-input"
                />
                <span>Include staff deposits</span>
              </label>
              <BtnPrimary onClick={() => handleFetchInterestBankPlayers()} disabled={interestBankByPlayerLoading}>
                {interestBankByPlayerLoading ? 'Loading…' : 'Load interest bank by player'}
              </BtnPrimary>
              {interestBankByPlayer && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Players</div>
                      <div className="text-sm font-heading font-bold">{interestBankByPlayer.count ?? 0}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Principal</div>
                      <div className="text-sm font-heading font-bold">${(interestBankByPlayer.totals?.principal ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Accrued interest</div>
                      <div className="text-sm font-heading font-bold text-emerald-400/90">
                        ${(interestBankByPlayer.totals?.interest ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Total locked</div>
                      <div className="text-sm font-heading font-bold text-primary">
                        ${(interestBankByPlayer.totals?.total_locked ?? 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[400px]">
                    {(!interestBankByPlayer.players || interestBankByPlayer.players.length === 0) ? (
                      <p className="text-[10px] text-mutedForeground font-heading">No active interest deposits.</p>
                    ) : (
                      <table className="w-full text-[10px] font-heading">
                        <thead>
                          <tr>
                            <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Username</th>
                            <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">#</th>
                            <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Principal</th>
                            <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Interest</th>
                            <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {interestBankByPlayer.players.map((u) => (
                            <tr key={u.user_id} className="border-b border-zinc-700/30 hover:bg-zinc-800/30">
                              <td className="p-1.5 font-medium">{u.username || '—'}</td>
                              <td className="p-1.5 text-right text-mutedForeground">{u.deposit_count ?? 0}</td>
                              <td className="p-1.5 text-right">${Number(u.principal ?? 0).toLocaleString()}</td>
                              <td className="p-1.5 text-right text-emerald-400/90">${Number(u.interest_amount ?? 0).toLocaleString()}</td>
                              <td className="p-1.5 text-right font-bold text-primary">${Number(u.total_locked ?? 0).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Swiss Bank Overview */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Swiss Bank Overview"
            badge={swissBankList?.users ? <span className="text-[10px] font-heading text-mutedForeground">{swissBankList.count} users — ${swissBankList.total_swiss?.toLocaleString()}</span> : null}
            toolAnchor="swissBank"
            isCollapsed={collapsed.swissBank}
            onToggle={() => toggleSection('swissBank')}
          />
          {!collapsed.swissBank && (
            <div className="p-3 space-y-2">
              <BtnPrimary onClick={handleFetchSwissBank} disabled={swissBankLoading}>
                {swissBankLoading ? 'Loading…' : 'Load Swiss Bank balances'}
              </BtnPrimary>
              {swissBankList && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Users with Swiss Funds</div>
                      <div className="text-sm font-heading font-bold">{swissBankList.count}</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2 border border-zinc-700/40">
                      <div className="text-[9px] text-mutedForeground font-heading uppercase">Total Swiss Money</div>
                      <div className="text-sm font-heading font-bold text-amber-400">${swissBankList.total_swiss?.toLocaleString() || 0}</div>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[400px]">
                    {(!swissBankList.users || swissBankList.users.length === 0) ? (
                      <p className="text-[10px] text-mutedForeground font-heading">No users with Swiss Bank funds.</p>
                    ) : (
                      <table className="w-full text-[10px] font-heading">
                        <thead><tr>
                          <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Username</th>
                          <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Balance</th>
                          <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Limit</th>
                          <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Action</th>
                        </tr></thead>
                        <tbody>
                          {swissBankList.users.map((u) => (
                            <tr key={u.id} className="border-b border-zinc-700/30 hover:bg-zinc-800/30">
                              <td className="p-1.5 font-medium">{u.username || '—'}</td>
                              <td className="p-1.5 text-right text-amber-400 font-bold">${Number(u.swiss_balance || 0).toLocaleString()}</td>
                              <td className="p-1.5 text-right text-mutedForeground">${Number(u.swiss_limit || 0).toLocaleString()}</td>
                              <td className="p-1.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleWipeSwissBank(u.username)}
                                  disabled={swissBankWiping === u.username}
                                  className="px-2 py-0.5 rounded border border-red-600/40 bg-red-900/20 text-red-400 text-[9px] font-heading hover:bg-red-900/40 disabled:opacity-50"
                                >
                                  {swissBankWiping === u.username ? '...' : 'Wipe'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Points purchases (store spends) */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Coins}
            title="Points purchases (store spends)"
            badge={pointsStoreSpends?.spends ? <span className="text-[10px] font-heading text-mutedForeground">{pointsStoreSpends.count} rows</span> : null}
            toolAnchor="pointsStoreSpends"
            isCollapsed={collapsed.pointsStoreSpends}
            onToggle={() => toggleSection('pointsStoreSpends')}
          />
          {!collapsed.pointsStoreSpends && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={pointsStoreSpendsUsernameQuery}
                  onChange={(e) => setPointsStoreSpendsUsernameQuery(e.target.value)}
                  placeholder="Filter username (optional)"
                  className="w-full sm:flex-1 sm:min-w-[120px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnPrimary onClick={handleFetchPointsStoreSpends} disabled={pointsStoreSpendsLoading}>
                  {pointsStoreSpendsLoading ? 'Loading…' : 'Load'}
                </BtnPrimary>
              </div>
              <p className="text-[10px] text-mutedForeground font-heading">
                No automatic refunds. Use the per-row <strong>Remove</strong> button to retract the store entitlement. Points are only re-deducted if you previously clicked <strong>Refund</strong> for the same row.
              </p>

              {pointsStoreSpends && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  {(!pointsStoreSpends.spends || pointsStoreSpends.spends.length === 0) ? (
                    <p className="text-[10px] text-mutedForeground font-heading">No store point spends found.</p>
                  ) : (
                    <table className="w-full text-[10px] font-heading">
                      <thead>
                        <tr>
                          <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">User</th>
                          <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Item</th>
                          <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Points spent</th>
                          <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">#</th>
                          <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Last</th>
                          <th className="text-right p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pointsStoreSpends.spends.map((s) => {
                          const refundKey = `${s.user_id}:${s.store_event_ref}`;
                          return (
                            <tr key={refundKey} className="border-b border-zinc-700/30 hover:bg-zinc-800/30">
                              <td className="p-1.5 font-medium">{s.username || '—'}</td>
                              <td className="p-1.5 text-mutedForeground font-mono max-w-[120px] truncate">{s.store_event_ref || '—'}</td>
                              <td className="p-1.5 text-right">{Number(s.total_points_spent || 0).toLocaleString()}</td>
                              <td className="p-1.5 text-right text-mutedForeground">{Number(s.spend_count || 0).toLocaleString()}</td>
                              <td className="p-1.5 text-right text-mutedForeground whitespace-nowrap">
                                {s.last_at ? new Date(s.last_at).toLocaleString() : '—'}
                              </td>
                              <td className="p-1.5 text-right">
                                <button
                                  type="button"
                                onClick={() => handleRetractStoreSpend(s.user_id, s.store_event_ref)}
                                  disabled={pointsStoreRetractingKey === refundKey}
                                  className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 text-[9px] font-heading hover:bg-emerald-500/30 disabled:opacity-50"
                                >
                                  {pointsStoreRetractingKey === refundKey ? '...' : 'Remove'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

      </section>
      )}

      {activeCategoryId === 'admin-analytics-monitoring' && (
      <section id="admin-logs" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <ScrollText size={12} />
          Logs
        </h2>
        {/* Live Activity Feed */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={ScrollText}
            title="Live Activity Feed"
            badge={activityFeed?.entries ? <span className="text-[10px] font-heading text-primary">{activityFeed.count} events</span> : null}
            toolAnchor="activityFeed"
            isCollapsed={collapsed.activityFeed}
            onToggle={() => toggleSection('activityFeed')}
          />
          {!collapsed.activityFeed && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 w-full">
                <input
                  type="text"
                  value={activityFeedUsername}
                  onChange={(e) => setActivityFeedUsername(e.target.value)}
                  placeholder="Username filter"
                  className="w-full sm:flex-1 sm:min-w-[100px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <select
                  value={activityFeedUsernameMode}
                  onChange={(e) => setActivityFeedUsernameMode(e.target.value)}
                  className="px-2 py-1.5 text-xs rounded border border-zinc-700/50 bg-zinc-900/50 text-foreground"
                >
                  <option value="exact">Exact user</option>
                  <option value="contains">Contains user</option>
                </select>
                <input
                  type="text"
                  value={activityFeedFilter}
                  onChange={(e) => setActivityFeedFilter(e.target.value)}
                  placeholder="Action filter (e.g. bank, dice)"
                  className="w-full sm:flex-1 sm:min-w-[120px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <input
                  type="number"
                  min="0"
                  value={activityFeedMinAmount}
                  onChange={(e) => setActivityFeedMinAmount(e.target.value)}
                  placeholder="Min $/pts"
                  className="w-full sm:w-24 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                {[
                  ['activity', 'Actions'],
                  ['gambling', 'Casino'],
                  ['minigame', 'Minigames'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActivityFeedSources((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className={`px-2 py-1 rounded border text-[10px] font-heading ${activityFeedSources[key] ? 'bg-primary/30 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}
                  >
                    {label}
                  </button>
                ))}
                {[15, 60, 360, 1440].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setActivityFeedMinutes(m)}
                    className={`px-2 py-1 rounded border text-[10px] font-heading ${activityFeedMinutes === m ? 'bg-primary/40 border-primary/60 text-primary-foreground' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}
                  >
                    {m < 60 ? `${m}m` : `${m / 60}h`}
                  </button>
                ))}
                <BtnPrimary onClick={() => fetchActivityFeed(false)} disabled={activityFeedLoading}>
                  {activityFeedLoading ? 'Loading…' : 'Load feed'}
                </BtnPrimary>
                <button
                  type="button"
                  onClick={() => setActivityFeedAutoRefresh(prev => !prev)}
                  className={`px-2 py-1 rounded border text-[10px] font-heading flex items-center gap-1 ${activityFeedAutoRefresh ? 'bg-green-900/50 border-green-500/60 text-green-400' : 'bg-zinc-800/60 border-zinc-600 text-mutedForeground'}`}
                >
                  {activityFeedAutoRefresh && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                  {activityFeedAutoRefresh ? 'Live' : 'Auto-refresh'}
                </button>
              </div>
              {activityFeed && (
                <div className="overflow-x-auto max-h-[500px]">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-heading">
                    <span className="text-mutedForeground">Window: {activityFeed?.window_start ? new Date(activityFeed.window_start).toLocaleTimeString() : '—'} - {activityFeed?.window_end ? new Date(activityFeed.window_end).toLocaleTimeString() : '—'}</span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800/60 border border-zinc-700/40 text-primary">{activityFeed?.count ?? 0} total</span>
                    <span className="px-1.5 py-0.5 rounded bg-blue-900/30 border border-blue-700/40 text-blue-300">Actions: {activityFeed?.counts_by_source?.activity ?? 0}</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-700/40 text-amber-300">Casino: {activityFeed?.counts_by_source?.gambling ?? 0}</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-900/30 border border-emerald-700/40 text-emerald-300">Minigames: {activityFeed?.counts_by_source?.minigame ?? 0}</span>
                  </div>
                  {(!activityFeed.entries || activityFeed.entries.length === 0) ? (
                    <p className="text-[10px] text-mutedForeground font-heading">
                      {(activityFeed?.applied_filters?.username || activityFeed?.applied_filters?.action || activityFeed?.applied_filters?.min_amount) ?
                        'No events matched your filters in this window.' :
                        `No activity in the last ${activityFeedMinutes < 60 ? `${activityFeedMinutes} minutes` : `${activityFeedMinutes / 60} hours`}.`}
                    </p>
                  ) : (
                    <table className="w-full text-[10px] font-heading">
                      <thead><tr>
                        <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Time</th>
                        <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Source</th>
                        <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">User</th>
                        <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Action</th>
                        <th className="text-left p-1.5 text-mutedForeground sticky top-0 bg-zinc-900">Details</th>
                      </tr></thead>
                      <tbody>
                        {activityFeed.entries.map((e, idx) => (
                          <tr key={idx} className="border-b border-zinc-700/30 hover:bg-zinc-800/30">
                            <td className="p-1.5 text-mutedForeground whitespace-nowrap">{e.created_at ? new Date(e.created_at).toLocaleTimeString() : '—'}</td>
                            <td className="p-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${e.source === 'gambling' ? 'bg-amber-900/40 text-amber-400' : e.source === 'minigame' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-blue-900/40 text-blue-400'}`}>
                                {e.source === 'gambling' ? 'CASINO' : e.source === 'minigame' ? 'MINIGAME' : (e.category === 'bank_transfer' ? 'BANK/TRANSFER' : 'ACTION')}
                              </span>
                            </td>
                            <td className="p-1.5 font-medium">{e.username || '—'}</td>
                            <td className="p-1.5">{e.action || '—'}</td>
                            <td className="p-1.5 text-mutedForeground max-w-xs truncate">
                              {e.details ? (() => {
                                const d = e.details;
                                if (e.source === 'minigame') {
                                  return `${d.game || 'game'} | score ${Number(d.score || 0).toLocaleString()} | cash $${Number(d.cash || 0).toLocaleString()} | respect ${Number(d.respect || 0).toLocaleString()} | points ${Number(d.points || 0).toLocaleString()}`;
                                }
                                if (d.stake != null && d.payout != null) return `Stake: $${Number(d.stake).toLocaleString()} → Payout: $${Number(d.payout).toLocaleString()}`;
                                if (d.amount != null && d.recipient) return `$${Number(d.amount).toLocaleString()} → ${d.recipient}`;
                                if (d.amount != null) return `$${Number(d.amount).toLocaleString()}`;
                                if (d.profit != null) return `Profit: $${Number(d.profit).toLocaleString()}`;
                                if (d.income != null) return `Income: $${Number(d.income).toLocaleString()}`;
                                return JSON.stringify(d).slice(0, 120);
                              })() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Minigame Payouts */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Trophy}
            title="Minigame Payouts"
            badge={minigamePayouts.entries?.length ? <span className="text-[10px] font-heading text-primary">{minigamePayouts.count} entries</span> : null}
            toolAnchor="minigamePayouts"
            isCollapsed={collapsed.minigamePayouts}
            onToggle={() => toggleSection('minigamePayouts')}
          />
          {!collapsed.minigamePayouts && (
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">Every individual minigame play and what rewards were paid out.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={minigamePayoutsUsername}
                  onChange={(e) => setMinigamePayoutsUsername(e.target.value)}
                  placeholder="Filter by username"
                  className="flex-1 min-w-[120px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <select
                  value={minigamePayoutsGame}
                  onChange={(e) => setMinigamePayoutsGame(e.target.value)}
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                >
                  <option value="">All Games</option>
                  <option value="family_run">Family Run</option>
                  <option value="snake">Package Run</option>
                  <option value="gauntlet">Flappy Gangster</option>
                  <option value="famiglia">Famiglia</option>
                  <option value="battleships">Battleships</option>
                  <option value="minesweeper">Minesweeper</option>
                  <option value="whack_a_copper">Whack a Copper</option>
                  <option value="the_getaway">The Getaway</option>
                  <option value="shooting_range">Shooting Range</option>
                </select>
                <BtnPrimary onClick={fetchMinigamePayouts} disabled={minigamePayoutsLoading}>
                  {minigamePayoutsLoading ? '...' : 'Load'}
                </BtnPrimary>
              </div>
              {minigamePayouts.entries?.length > 0 && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="sticky top-0 bg-zinc-900/90">
                      <tr className="text-left text-mutedForeground">
                        <th className="p-2">Time</th>
                        <th className="p-2">User</th>
                        <th className="p-2">Game</th>
                        <th className="p-2">Score</th>
                        <th className="p-2">Cash</th>
                        <th className="p-2">Respect</th>
                        <th className="p-2">Other</th>
                      </tr>
                    </thead>
                    <tbody>
                      {minigamePayouts.entries.map((e) => {
                        const r = e.rewards || {};
                        const cash = r.money || 0;
                        const respect = r.respect_points || 0;
                        const other = Object.entries(r).filter(([k]) => k !== 'money' && k !== 'respect_points' && k !== 'missions').filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ');
                        return (
                          <tr key={e.id} className="border-t border-zinc-700/30 hover:bg-zinc-800/30">
                            <td className="p-2 text-mutedForeground whitespace-nowrap">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</td>
                            <td className="p-2 text-foreground">{e.username}</td>
                            <td className="p-2 text-primary">{e.game}</td>
                            <td className="p-2 text-foreground">{Number(e.score).toLocaleString()}</td>
                            <td className="p-2 text-green-400">{cash > 0 ? `$${cash.toLocaleString()}` : '—'}</td>
                            <td className="p-2 text-blue-400">{respect > 0 ? respect.toLocaleString() : '—'}</td>
                            <td className="p-2 text-mutedForeground">{other || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {minigamePayouts.entries?.length === 0 && !minigamePayoutsLoading && (
                <p className="text-[10px] text-mutedForeground font-heading">No payout records found. Load data or adjust filters.</p>
              )}
            </div>
          )}
        </div>

        {/* Weekly Leaderboard Payouts */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Trophy}
            title="Weekly Leaderboard Payouts"
            badge={weeklyLeaderboardPayouts.entries?.length ? <span className="text-[10px] font-heading text-primary">{weeklyLeaderboardPayouts.count} entries</span> : null}
            toolAnchor="weeklyLeaderboardPayouts"
            isCollapsed={collapsed.weeklyLeaderboardPayouts}
            onToggle={() => toggleSection('weeklyLeaderboardPayouts')}
          />
          {!collapsed.weeklyLeaderboardPayouts && (
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">
                Audit trail for the automatic Monday weekly leaderboard payout (which user got how many points, per category).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={weeklyLeaderboardPayoutsUsername}
                  onChange={(e) => setWeeklyLeaderboardPayoutsUsername(e.target.value)}
                  placeholder="Filter by username"
                  className="flex-1 min-w-[120px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <select
                  value={weeklyLeaderboardPayoutsCategory}
                  onChange={(e) => setWeeklyLeaderboardPayoutsCategory(e.target.value)}
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                >
                  <option value="all">All categories</option>
                  <option value="kills">Kills</option>
                  <option value="crimes">Crimes</option>
                  <option value="gta">GTA</option>
                  <option value="jail_busts">Jail Busts</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={weeklyLeaderboardPayoutsLimit}
                  onChange={(e) => setWeeklyLeaderboardPayoutsLimit(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 200)))}
                  className="w-20 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none font-mono"
                />
                <BtnPrimary onClick={fetchWeeklyLeaderboardPayouts} disabled={weeklyLeaderboardPayoutsLoading}>
                  {weeklyLeaderboardPayoutsLoading ? '...' : 'Load'}
                </BtnPrimary>
              </div>

              {weeklyLeaderboardPayouts.entries?.length > 0 && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="sticky top-0 bg-zinc-900/90">
                      <tr className="text-left text-mutedForeground">
                        <th className="p-2">Time</th>
                        <th className="p-2">Week</th>
                        <th className="p-2">User</th>
                        <th className="p-2">Category</th>
                        <th className="p-2">Rank</th>
                        <th className="p-2">Event Count</th>
                        <th className="p-2">Points</th>
                        <th className="p-2">User Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyLeaderboardPayouts.entries.map((e) => {
                        const catLabel = (
                          e.category === 'kills' ? 'Kills' :
                          e.category === 'crimes' ? 'Crimes' :
                          e.category === 'gta' ? 'GTA' :
                          e.category === 'jail_busts' ? 'Jail Busts' :
                          e.category
                        );
                        return (
                          <tr key={`${e.week_start || 'w'}:${e.paid_at || 't'}:${e.category || 'c'}:${e.user_id || 'u'}:${e.rank || 0}`} className="border-t border-zinc-700/30 hover:bg-zinc-800/30">
                            <td className="p-2 text-mutedForeground whitespace-nowrap">{e.paid_at ? new Date(e.paid_at).toLocaleString() : '—'}</td>
                            <td className="p-2 text-mutedForeground whitespace-nowrap">{e.week_start || '—'}</td>
                            <td className="p-2 text-foreground">{e.username}</td>
                            <td className="p-2 text-primary">{catLabel}</td>
                            <td className="p-2 text-foreground">{Number(e.rank).toLocaleString()}</td>
                            <td className="p-2 text-foreground">{Number(e.event_value).toLocaleString()}</td>
                            <td className="p-2 text-blue-400">{Number(e.points_awarded).toLocaleString()}</td>
                            <td className="p-2 text-mutedForeground">{Number(e.user_week_total_points).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {weeklyLeaderboardPayouts.entries?.length === 0 && !weeklyLeaderboardPayoutsLoading && (
                <p className="text-[10px] text-mutedForeground font-heading">No weekly payout entries found. Load data or adjust filters.</p>
              )}
            </div>
          )}
        </div>

        {/* Attack logs (post data) — admin and mod */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Crosshair}
            title="Attack logs (post data)"
            badge={attackLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{attackLogsData.logs.length} entries</span> : null}
            toolAnchor="attackLogs"
            isCollapsed={collapsed.attackLogs}
            onToggle={() => toggleSection('attackLogs')}
          />
          {!collapsed.attackLogs && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">Search by username to load that user&apos;s attack attempts (as attacker or target). Full post data: who shot whom, outcome, bodyguard, bullets, location, etc.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={attackLogsUsername}
                  onChange={(e) => setAttackLogsUsername(e.target.value)}
                  placeholder="Username"
                  className="w-40 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
                />
                <span className="text-[10px] text-mutedForeground">Limit</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={attackLogsLimit}
                  onChange={(e) => setAttackLogsLimit(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 500)))}
                  className="w-20 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono"
                />
                <BtnPrimary onClick={handleFetchAttackLogs} disabled={attackLogsLoading}>
                  {attackLogsLoading ? 'Loading…' : 'Load attack logs'}
                </BtnPrimary>
                <label className="flex items-center gap-1.5 text-[10px] font-heading text-mutedForeground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attackLogsLive}
                    onChange={(e) => setAttackLogsLive(e.target.checked)}
                    className="rounded border border-input"
                  />
                  Live
                </label>
                {attackLogsLive && (attackLogsUsername || '').trim() && (
                  <span className="text-[9px] text-primary font-heading">Refreshing every 5s</span>
                )}
              </div>
              {attackLogsData && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <p className="text-[10px] font-heading text-primary mb-1">Attack log for: <strong>{attackLogsData.username ?? '—'}</strong></p>
                  {(!attackLogsData.logs || attackLogsData.logs.length === 0) ? (
                    <p className="text-[10px] text-mutedForeground font-heading">No attack attempts found.</p>
                  ) : (
                    <table className="w-full text-left border-collapse text-[9px] font-heading">
                      <thead className="sticky top-0 bg-zinc-900/95 z-10">
                        <tr className="border-b border-zinc-700/50">
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Attacker</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Target</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Outcome</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Player message</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">IP</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">User-Agent</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Device</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Bot?</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Bodyguard?</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Bullets</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Location</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Time</th>
                          <th className="py-1 font-bold text-mutedForeground uppercase">View</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attackLogsData.logs.map((row, idx) => {
                          const { device, bot: uaBot } = parseAttackLogUA(row.user_agent);
                          const botLabel = row.attacker_is_bot === true
                            ? (row.attacker_bot_label ? `Yes · ${row.attacker_bot_label}` : 'Yes')
                            : (row.attacker_is_bot === false ? 'No' : (uaBot || '—'));
                          return (
                          <tr key={row.id || idx} className="border-b border-zinc-700/30">
                            <td className="py-1 pr-1 text-foreground">{row.attacker_username ?? '—'}</td>
                            <td className="py-1 pr-1 text-foreground">{row.target_username ?? '—'}</td>
                            <td className="py-1 pr-1">
                              {row.outcome === 'killed' && <span className="text-red-400">Killed</span>}
                              {row.outcome === 'failed' && <span className="text-amber-400">Failed</span>}
                              {row.outcome === 'bodyguard' && <span className="text-amber-500">Bodyguard</span>}
                              {row.outcome === 'error' && <span className="text-orange-400">Error</span>}
                              {!['killed','failed','bodyguard','error'].includes(row.outcome) && (row.outcome ? <span className="text-mutedForeground">{row.outcome}</span> : '—')}
                            </td>
                            <td className="py-1 pr-1 max-w-[200px] truncate text-mutedForeground" title={row.player_message ?? ''}>{row.player_message ?? '—'}</td>
                            <td className="py-1 pr-1 text-mutedForeground font-mono text-[9px]">{row.client_ip ?? '—'}</td>
                            <td className="py-1 pr-1 max-w-[140px] truncate text-mutedForeground font-mono text-[8px]" title={row.user_agent ?? ''}>{row.user_agent ?? '—'}</td>
                            <td className="py-1 pr-1 text-mutedForeground">{device}</td>
                            <td className="py-1 pr-1">{botLabel ? <span className="text-amber-400 font-medium">{botLabel}</span> : '—'}</td>
                            <td className="py-1 pr-1">{row.is_bodyguard_kill ? 'Yes' : row.outcome === 'bodyguard' ? 'Blocked' : '—'}</td>
                            <td className="py-1 pr-1">{row.bullets_used != null ? Number(row.bullets_used).toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1 text-mutedForeground">{row.location_state ?? row.state ?? '—'}</td>
                            <td className="py-1 pr-1 text-mutedForeground font-mono">{formatAttackLogTime(row.created_at)}</td>
                            <td className="py-1">
                              <button
                                type="button"
                                onClick={() => setAttackLogViewRow(row)}
                                className="px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary text-[9px] font-heading hover:bg-primary/20"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={ScrollText}
            title="Activity Log"
          badge={activityLog.entries?.length != null && <span className="text-[10px] font-heading text-mutedForeground">{activityLog.entries.length} entries</span>}
          toolAnchor="activityLog"
          isCollapsed={collapsed.activityLog}
          onToggle={() => toggleSection('activityLog')}
        />
        {!collapsed.activityLog && (
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={activityLogUsername}
                onChange={(e) => setActivityLogUsername(e.target.value)}
                placeholder="Filter by username"
                className="flex-1 min-w-[120px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
              />
              <BtnPrimary onClick={fetchActivityLog} disabled={activityLogLoading}>
                {activityLogLoading ? '...' : 'Load'}
              </BtnPrimary>
            </div>
            <div className="max-h-64 overflow-y-auto rounded border border-zinc-700/50">
              <table className="w-full text-[10px] font-heading">
                <thead className="bg-zinc-800/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 text-mutedForeground uppercase">Time</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">User</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">Action</th>
                    <th className="text-left p-2 text-mutedForeground uppercase">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(activityLog.entries || []).map((e) => (
                    <tr key={e.id} className="border-t border-zinc-700/30 hover:bg-zinc-800/30">
                      <td className="p-2 text-mutedForeground whitespace-nowrap">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</td>
                      <td className="p-2 text-primary font-bold">{e.username || '—'}</td>
                      <td className="p-2">{e.action || '—'}</td>
                      <td className="p-2 text-mutedForeground max-w-[200px] truncate" title={JSON.stringify(e.details || {})}>{e.details ? JSON.stringify(e.details) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(activityLog.entries || []).length === 0 && !activityLogLoading && <p className="text-xs text-mutedForeground">Load to see crimes, forum topics/comments.</p>}
          </div>
        )}
        </div>

        {/* Betting Log — all casino and sports bets */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Dice5}
            title="Betting Log"
            badge={gamblingLog.entries?.length != null && <span className="text-[10px] font-heading text-mutedForeground">{gamblingLog.entries.length} entries</span>}
            toolAnchor="gamblingLog"
            isCollapsed={collapsed.gamblingLog}
            onToggle={() => toggleSection('gamblingLog')}
          />
          {!collapsed.gamblingLog && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={gamblingLogUsername}
                  onChange={(e) => setGamblingLogUsername(e.target.value)}
                  placeholder="Filter by username"
                  className="min-w-[100px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <select
                  value={gamblingLogGameType}
                  onChange={(e) => setGamblingLogGameType(e.target.value)}
                  className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                >
                  <option value="">All games</option>
                  <option value="dice">Dice</option>
                  <option value="roulette">Roulette</option>
                  <option value="blackjack">Blackjack</option>
                  <option value="slots">Slots</option>
                  <option value="videopoker">Video Poker</option>
                  <option value="horseracing">Horse Racing</option>
                  <option value="sports_bet">Sports</option>
                  <option value="mdg">MDG (Pot)</option>
                </select>
                <BtnPrimary onClick={fetchGamblingLog} disabled={gamblingLogLoading}>
                  {gamblingLogLoading ? '...' : 'Load'}
                </BtnPrimary>
              </div>
              <div className="max-h-64 overflow-y-auto rounded border border-zinc-700/50">
                <table className="w-full text-[10px] font-heading">
                  <thead className="bg-zinc-800/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 text-mutedForeground uppercase">Time</th>
                      <th className="text-left p-2 text-mutedForeground uppercase">User</th>
                      <th className="text-left p-2 text-mutedForeground uppercase">Game</th>
                      <th className="text-left p-2 text-mutedForeground uppercase">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gamblingLog.entries || []).map((e) => (
                      <tr key={e.id} className="border-t border-zinc-700/30 hover:bg-zinc-800/30">
                        <td className="p-2 text-mutedForeground whitespace-nowrap">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</td>
                        <td className="p-2 text-primary font-bold">{e.username || '—'}</td>
                        <td className="p-2">{e.game_type || '—'}</td>
                        <td className="p-2 text-mutedForeground max-w-[220px] truncate" title={JSON.stringify(e.details || {})}>{e.details ? JSON.stringify(e.details) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-700/30">
                <span className="text-[10px] text-mutedForeground">Clear logs older than</span>
                <input
                  type="number"
                  min={1}
                  value={clearGamblingDays}
                  onChange={(e) => setClearGamblingDays(parseInt(e.target.value) || 30)}
                  className="w-14 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs"
                />
                <span className="text-[10px] text-mutedForeground">days</span>
                <BtnDanger onClick={handleClearGamblingLog} disabled={clearGamblingLoading}>
                  {clearGamblingLoading ? '...' : 'Clear old'}
                </BtnDanger>
              </div>
              {(gamblingLog.entries || []).length === 0 && !gamblingLogLoading && <p className="text-xs text-mutedForeground">Load to see all casino activity (dice, roulette, blackjack, slots, video poker, horseracing, sports, MDG).</p>}
            </div>
          )}
        </div>

        {/* Casino Analytics */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Skull}
            title="Crime logs (post data)"
            badge={crimeLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{crimeLogsData.logs.length} entries</span> : null}
            toolAnchor="crimeLogs"
            isCollapsed={collapsed.crimeLogs}
            onToggle={() => toggleSection('crimeLogs')}
          />
          {!collapsed.crimeLogs && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">Search by username to load that user&apos;s crime attempts. Full post data: crime name, success/fail, profit, city, time.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={crimeLogsUsername}
                  onChange={(e) => setCrimeLogsUsername(e.target.value)}
                  placeholder="Username"
                  className="w-40 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
                />
                <span className="text-[10px] text-mutedForeground">Limit</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={crimeLogsLimit}
                  onChange={(e) => setCrimeLogsLimit(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 500)))}
                  className="w-20 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono"
                />
                <BtnPrimary onClick={handleFetchCrimeLogs} disabled={crimeLogsLoading}>
                  {crimeLogsLoading ? 'Loading…' : 'Load crime logs'}
                </BtnPrimary>
              </div>
              {crimeLogsData && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <p className="text-[10px] font-heading text-primary mb-1">Crime log for: <strong>{crimeLogsData.username ?? '—'}</strong></p>
                  {(!crimeLogsData.logs || crimeLogsData.logs.length === 0) ? (
                    <p className="text-[10px] text-mutedForeground font-heading">No crime attempts found.</p>
                  ) : (
                    <table className="w-full text-left border-collapse text-[9px] font-heading">
                      <thead className="sticky top-0 bg-zinc-900/95 z-10">
                        <tr className="border-b border-zinc-700/50">
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Crime</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Type</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Success</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Profit</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">City</th>
                          <th className="py-1 font-bold text-mutedForeground uppercase">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {crimeLogsData.logs.map((row, idx) => (
                          <tr key={idx} className="border-b border-zinc-700/30">
                            <td className="py-1 pr-1 text-foreground">{row.crime_name ?? row.crime_id ?? '—'}</td>
                            <td className="py-1 pr-1 text-mutedForeground">{row.crime_type ?? '—'}</td>
                            <td className="py-1 pr-1">{row.success ? <span className="text-emerald-400">Yes</span> : <span className="text-amber-400">No</span>}</td>
                            <td className="py-1 pr-1">{row.profit != null ? `$${Number(row.profit).toLocaleString()}` : '—'}</td>
                            <td className="py-1 pr-1 text-mutedForeground">{row.city ?? '—'}</td>
                            <td className="py-1 text-mutedForeground">{row.at ? new Date(row.at).toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* GTA Logs (Post Data) */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Car}
            title="GTA logs (post data)"
            badge={gtaLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{gtaLogsData.logs.length} entries</span> : null}
            toolAnchor="gtaLogs"
            isCollapsed={collapsed.gtaLogs}
            onToggle={() => {
              toggleSection('gtaLogs');
              if (collapsed.gtaLogs && isAdmin) fetchGtaExclusivePool();
            }}
          />
          {!collapsed.gtaLogs && (
            <div className="p-3 space-y-3">
              {isAdmin && (
              <>
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-zinc-700/50">
                <span className="text-[10px] font-heading text-mutedForeground">Al Capone exclusive (car20) in GTA pool:</span>
                {gtaExclusiveReleased === null ? (
                  <span className="text-[10px] text-mutedForeground">…</span>
                ) : (
                  <>
                    <span className={`text-[10px] font-heading font-bold ${gtaExclusiveReleased ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {gtaExclusiveReleased ? 'Released (very rare drop)' : 'Retracted'}
                    </span>
                    <button
                      type="button"
                      disabled={gtaExclusiveLoading}
                      onClick={() => handleSetGtaExclusivePool(!gtaExclusiveReleased)}
                      className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-[10px] font-heading font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {gtaExclusiveLoading ? '…' : gtaExclusiveReleased ? 'Retract from pool' : 'Release into pool'}
                    </button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-zinc-700/50">
                <span className="text-[10px] font-heading text-mutedForeground">Current drop weight:</span>
                <span className="text-[10px] font-heading font-bold text-primary">{Number(gtaExclusiveDropWeight || 0).toExponential(3)}</span>
                <span className="text-[10px] text-mutedForeground">(about 1 in {Number(gtaExclusiveApproxOneIn || 0).toLocaleString()})</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step="0.0000001"
                  min="0.0000001"
                  max="0.05"
                  value={gtaExclusiveDropWeightInput}
                  onChange={(e) => setGtaExclusiveDropWeightInput(e.target.value)}
                  className="w-36 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono"
                  placeholder="0.000006"
                />
                <button
                  type="button"
                  disabled={gtaExclusiveLoading}
                  onClick={handleSetGtaExclusiveOdds}
                  className="px-2 py-1 rounded border border-primary/40 bg-primary/10 text-[10px] font-heading font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  {gtaExclusiveLoading ? '…' : 'Set odds'}
                </button>
                <span className="text-[10px] text-mutedForeground">Range: 0.0000001 to 0.05</span>
              </div>
              </>
              )}
              <p className="text-[10px] text-mutedForeground font-heading">Search by username to load that user&apos;s GTA attempts. Full post data: option, car, success, profit, jailed.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={gtaLogsUsername} onChange={(e) => setGtaLogsUsername(e.target.value)} placeholder="Username" className="w-40 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading" />
                <span className="text-[10px] text-mutedForeground">Limit</span>
                <input type="number" min={1} max={1000} value={gtaLogsLimit} onChange={(e) => setGtaLogsLimit(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 500)))} className="w-20 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                <BtnPrimary onClick={handleFetchGtaLogs} disabled={gtaLogsLoading}>{gtaLogsLoading ? 'Loading…' : 'Load GTA logs'}</BtnPrimary>
              </div>
              {gtaLogsData && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <p className="text-[10px] font-heading text-primary mb-1">GTA log for: <strong>{gtaLogsData.username ?? '—'}</strong></p>
                  {(!gtaLogsData.logs || gtaLogsData.logs.length === 0) ? (
                    <p className="text-[10px] text-mutedForeground font-heading">No GTA attempts found.</p>
                  ) : (
                    <table className="w-full text-left border-collapse text-[9px] font-heading">
                      <thead className="sticky top-0 bg-zinc-900/95 z-10">
                        <tr className="border-b border-zinc-700/50">
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Time</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Option</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Success</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Car</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Profit</th>
                          <th className="py-1 font-bold text-mutedForeground uppercase">Jailed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gtaLogsData.logs.map((row, idx) => (
                          <tr key={idx} className="border-b border-zinc-700/30">
                            <td className="py-1 pr-1 text-mutedForeground">{row.at ? new Date(row.at).toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1">{row.option_name ?? row.option_id ?? '—'}</td>
                            <td className="py-1 pr-1">{row.success ? <span className="text-emerald-400">Yes</span> : <span className="text-amber-400">No</span>}</td>
                            <td className="py-1 pr-1">{row.car_name ?? row.car_id ?? '—'}</td>
                            <td className="py-1 pr-1">{row.profit != null ? `$${Number(row.profit).toLocaleString()}` : '—'}</td>
                            <td className="py-1">{row.jailed ? `Yes (${row.jail_seconds ?? '?'}s)` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Jail Bust Logs (Post Data) */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Lock}
            title="Jail bust logs (post data)"
            badge={jailLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{jailLogsData.logs.length} entries</span> : null}
            toolAnchor="jailLogs"
            isCollapsed={collapsed.jailLogs}
            onToggle={() => toggleSection('jailLogs')}
          />
          {!collapsed.jailLogs && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">Search by username to load that user&apos;s jail bust attempts. Full post data: target, NPC vs player, success, profit.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={jailLogsUsername} onChange={(e) => setJailLogsUsername(e.target.value)} placeholder="Username" className="w-40 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading" />
                <span className="text-[10px] text-mutedForeground">Limit</span>
                <input type="number" min={1} max={1000} value={jailLogsLimit} onChange={(e) => setJailLogsLimit(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 500)))} className="w-20 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                <BtnPrimary onClick={handleFetchJailLogs} disabled={jailLogsLoading}>{jailLogsLoading ? 'Loading…' : 'Load jail logs'}</BtnPrimary>
              </div>
              {jailLogsData && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <p className="text-[10px] font-heading text-primary mb-1">Jail bust log for: <strong>{jailLogsData.username ?? '—'}</strong></p>
                  {(!jailLogsData.logs || jailLogsData.logs.length === 0) ? (
                    <p className="text-[10px] text-mutedForeground font-heading">No bust attempts found.</p>
                  ) : (
                    <table className="w-full text-left border-collapse text-[9px] font-heading">
                      <thead className="sticky top-0 bg-zinc-900/95 z-10">
                        <tr className="border-b border-zinc-700/50">
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Time</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Target</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">NPC</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Success</th>
                          <th className="py-1 font-bold text-mutedForeground uppercase">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jailLogsData.logs.map((row, idx) => (
                          <tr key={idx} className="border-b border-zinc-700/30">
                            <td className="py-1 pr-1 text-mutedForeground">{row.at ? new Date(row.at).toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1">{row.target_username ?? '—'}</td>
                            <td className="py-1 pr-1">{row.is_npc ? 'Yes' : 'No'}</td>
                            <td className="py-1 pr-1">{row.success ? <span className="text-emerald-400">Yes</span> : <span className="text-amber-400">No</span>}</td>
                            <td className="py-1">{row.profit != null ? `$${Number(row.profit).toLocaleString()}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Coins}
            title="Bank logs (post data)"
            badge={bankLogsData ? <span className="text-[10px] font-heading text-primary">{(bankLogsData.transfers?.length ?? 0) + (bankLogsData.deposits?.length ?? 0)} entries</span> : null}
            toolAnchor="bankLogs"
            isCollapsed={collapsed.bankLogs}
            onToggle={() => toggleSection('bankLogs')}
          />
          {!collapsed.bankLogs && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">Search by username: money transfers (sent/received) and interest deposits.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={bankLogsUsername} onChange={(e) => setBankLogsUsername(e.target.value)} placeholder="Username" className="w-40 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading" />
                <span className="text-[10px] text-mutedForeground">Limit</span>
                <input type="number" min={1} max={500} value={bankLogsLimit} onChange={(e) => setBankLogsLimit(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 100)))} className="w-20 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                <BtnPrimary onClick={handleFetchBankLogs} disabled={bankLogsLoading}>{bankLogsLoading ? 'Loading…' : 'Load bank logs'}</BtnPrimary>
              </div>
              {bankLogsData && (
                <div className="space-y-4">
                  <p className="text-[10px] font-heading text-primary">Bank activity for: <strong>{bankLogsData.username ?? '—'}</strong></p>
                  <div>
                    <p className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Transfers</p>
                    <div className="overflow-x-auto max-h-48">
                      {(!bankLogsData.transfers || bankLogsData.transfers.length === 0) ? <p className="text-[10px] text-mutedForeground font-heading">No transfers.</p> : (
                        <table className="w-full text-left border-collapse text-[9px] font-heading">
                          <thead className="sticky top-0 bg-zinc-900/95 z-10"><tr className="border-b border-zinc-700/50"><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Time</th><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Direction</th><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">From</th><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">To</th><th className="py-1 font-bold text-mutedForeground uppercase">Amount</th></tr></thead>
                          <tbody>
                            {bankLogsData.transfers.map((row, idx) => (
                              <tr key={idx} className="border-b border-zinc-700/30">
                                <td className="py-1 pr-1 text-mutedForeground">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                                <td className="py-1 pr-1">{row.direction === 'sent' ? <span className="text-amber-400">Sent</span> : <span className="text-emerald-400">Received</span>}</td>
                                <td className="py-1 pr-1">{row.from_username ?? '—'}</td>
                                <td className="py-1 pr-1">{row.to_username ?? '—'}</td>
                                <td className="py-1">${row.amount != null ? Number(row.amount).toLocaleString() : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-heading text-mutedForeground uppercase mb-1">Interest deposits</p>
                    <div className="overflow-x-auto max-h-48">
                      {(!bankLogsData.deposits || bankLogsData.deposits.length === 0) ? <p className="text-[10px] text-mutedForeground font-heading">No deposits.</p> : (
                        <table className="w-full text-left border-collapse text-[9px] font-heading">
                          <thead className="sticky top-0 bg-zinc-900/95 z-10"><tr className="border-b border-zinc-700/50"><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Created</th><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Principal</th><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Hours</th><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Interest</th><th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Matures</th><th className="py-1 font-bold text-mutedForeground uppercase">Claimed</th></tr></thead>
                          <tbody>
                            {bankLogsData.deposits.map((row, idx) => (
                              <tr key={idx} className="border-b border-zinc-700/30">
                                <td className="py-1 pr-1 text-mutedForeground">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                                <td className="py-1 pr-1">${row.principal != null ? Number(row.principal).toLocaleString() : '—'}</td>
                                <td className="py-1 pr-1">{row.duration_hours ?? '—'}</td>
                                <td className="py-1 pr-1">${row.interest_amount != null ? Number(row.interest_amount).toLocaleString() : '—'}</td>
                                <td className="py-1 pr-1">{row.matures_at ? new Date(row.matures_at).toLocaleString() : '—'}</td>
                                <td className="py-1">{row.claimed_at ? new Date(row.claimed_at).toLocaleString() : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Stock Logs (Post Data) */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Stock market logs (post data)"
            badge={stockLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{stockLogsData.logs.length} entries</span> : null}
            toolAnchor="stockLogs"
            isCollapsed={collapsed.stockLogs}
            onToggle={() => toggleSection('stockLogs')}
          />
          {!collapsed.stockLogs && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">Search by username: buy, sell, short, cover transactions.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={stockLogsUsername} onChange={(e) => setStockLogsUsername(e.target.value)} placeholder="Username" className="w-40 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading" />
                <span className="text-[10px] text-mutedForeground">Limit</span>
                <input type="number" min={1} max={1000} value={stockLogsLimit} onChange={(e) => setStockLogsLimit(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 500)))} className="w-20 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono" />
                <BtnPrimary onClick={handleFetchStockLogs} disabled={stockLogsLoading}>{stockLogsLoading ? 'Loading…' : 'Load stock logs'}</BtnPrimary>
              </div>
              {stockLogsData && (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <p className="text-[10px] font-heading text-primary mb-1">Stock log for: <strong>{stockLogsData.username ?? '—'}</strong></p>
                  {(!stockLogsData.logs || stockLogsData.logs.length === 0) ? (
                    <p className="text-[10px] text-mutedForeground font-heading">No stock transactions.</p>
                  ) : (
                    <table className="w-full text-left border-collapse text-[9px] font-heading">
                      <thead className="sticky top-0 bg-zinc-900/95 z-10">
                        <tr className="border-b border-zinc-700/50">
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Time</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Type</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Stock</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Side</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Units</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Price</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Spent</th>
                          <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Received</th>
                          <th className="py-1 font-bold text-mutedForeground uppercase">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockLogsData.logs.map((row, idx) => (
                          <tr key={idx} className="border-b border-zinc-700/30">
                            <td className="py-1 pr-1 text-mutedForeground">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1">{row.type ?? '—'}</td>
                            <td className="py-1 pr-1">{row.stock_name ?? row.stock_id ?? '—'}</td>
                            <td className="py-1 pr-1">{row.side ?? '—'}</td>
                            <td className="py-1 pr-1">{row.units != null ? row.units.toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1">{row.price != null ? row.price.toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1">{row.points_spent != null ? row.points_spent.toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1">{row.points_received != null ? row.points_received.toLocaleString() : '—'}</td>
                            <td className="py-1">{row.profit_points != null ? row.profit_points.toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      )}

      {activeCategoryId === 'admin-world-systems' && staffCanAccessWorldSystems && (
      <section id="admin-testing" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Wrench size={12} />
          Testing Tools
        </h2>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Search & Attack Tools"
          toolAnchor="search"
          isCollapsed={collapsed.search}
          onToggle={() => toggleSection('search')}
        />
        {!collapsed.search && (
          <div className="p-2 space-y-1">
            {isAdmin && (
            <>
            <ActionRow icon={Settings} label="Set Search Time" description="Per user: 1–999 mins, or 0 to clear override">
              <Input type="number" min={0} max={999} value={formData.searchMinutes} onChange={(e) => setFormData((prev) => ({ ...prev, searchMinutes: parseInt(e.target.value) || 0 }))} placeholder="Mins" />
              <BtnPrimary onClick={handleSetSearchTime}>Set</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Settings} label="Set All to 1 min" description="Affects all users">
              <BtnPrimary onClick={handleSetAllSearchTime1}>Set All 1 min</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Settings} label="Set All to 5 mins" description="Affects all users">
              <BtnPrimary onClick={handleSetAllSearchTime5}>Set All 5 min</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Trash2} label="Clear All Searches" description="Delete all attack searches" color="text-red-400">
              <BtnDanger onClick={handleClearAllSearches} disabled={clearSearchesLoading}>
                {clearSearchesLoading ? '...' : 'Clear'}
              </BtnDanger>
            </ActionRow>
            </>
            )}

            <ActionRow icon={Clock} label="Reset All OC Timers" description="Clear OC cooldown for everyone; all can run Organised Crime immediately">
              <BtnPrimary onClick={handleResetAllOcTimers} disabled={resetOcTimersLoading}>
                {resetOcTimersLoading ? '...' : 'Reset'}
              </BtnPrimary>
            </ActionRow>

            <ActionRow icon={Wrench} label="Fix login fields (user)" description="Target Username: repair malformed sessions/login IP fields and clear login lockout">
              <BtnPrimary onClick={handleFixLoginFields} disabled={fixLoginFieldsLoading || !(formData.targetUsername || '').trim()}>
                {fixLoginFieldsLoading ? '...' : 'Fix'}
              </BtnPrimary>
            </ActionRow>

            <ActionRow icon={Users} label="Clear OC invites (user)" description="Target Username: remove incoming/outgoing OC invites and pending heist links">
              <BtnDanger onClick={handleClearUserOcInvites} disabled={clearOcInvitesLoading || !(formData.targetUsername || '').trim()}>
                {clearOcInvitesLoading ? '...' : 'Clear'}
              </BtnDanger>
            </ActionRow>

            <ActionRow icon={Clock} label="Reset Daily Rewards Timer" description="Clear 6h play window: all users get 3 plays again (RPS / Noughts & Crosses)">
              <BtnPrimary onClick={handleResetDailyRewardsTimerAll} disabled={resetDailyRewardsLoading}>
                {resetDailyRewardsLoading ? '...' : 'Reset all'}
              </BtnPrimary>
            </ActionRow>
            <ActionRow icon={Clock} label="Reset Daily Rewards for one user" description="Use Target Username above; clears their plays and any in-progress game">
              <BtnPrimary onClick={handleResetDailyRewardsTimerUser} disabled={resetDailyRewardsLoading}>
                {resetDailyRewardsLoading ? '...' : 'Reset user'}
              </BtnPrimary>
            </ActionRow>
          </div>
        )}
        </div>

        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-zinc-600/35 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
          <div className="p-3 text-[10px] text-mutedForeground font-heading space-y-2">
            <p>
              <span className="text-foreground font-bold">Minigame & main leaderboard tools</span>
              {' '}live under{' '}
              <button
                type="button"
                className="text-primary hover:underline font-bold"
                onClick={() => {
                  setActiveCategoryId('admin-players');
                  setCollapsed((prev) => ({ ...prev, userAdjustHub: false }));
                  if (typeof window !== 'undefined') {
                    window.location.hash = 'admin-players';
                    document.getElementById('admin-user-adjust-hub')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
              >
                Player Management → User give / take & leaderboards
              </button>
              . Search still finds them via the same keywords.
            </p>
          </div>
        </div>
        )}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Shield}
            title="Bodyguard Tools"
            toolAnchor="bodyguards"
            isCollapsed={collapsed.bodyguards}
            onToggle={() => toggleSection('bodyguards')}
          />
          {!collapsed.bodyguards && (
            <div className="p-2 space-y-1">
              <ActionRow icon={Shield} label="Generate Robots" description="For target user">
                <Input type="number" min="1" max="4" value={bgTestCount} onChange={(e) => setBgTestCount(parseInt(e.target.value) || 1)} />
                <BtnPrimary onClick={handleGenerateBodyguards}>Generate</BtnPrimary>
              </ActionRow>

              <ActionRow icon={Activity} label="Check bodyguard speeds" description="Total amount of seconds and milliseconds for all bodyguards. Enter username in Target Username above, then click Log.">
                <BtnPrimary onClick={handleCheckBodyguardSpeeds} disabled={bodyguardSpeedsLoading || !(formData.targetUsername || '').trim()}>
                  {bodyguardSpeedsLoading ? '…' : 'Log'}
                </BtnPrimary>
              </ActionRow>
              {bodyguardSpeedsResult && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] font-heading font-mono space-y-0.5 ml-6 sm:ml-0">
                  <div className="font-bold text-primary">
                    {bodyguardSpeedsResult.username ?? '—'} · {bodyguardSpeedsResult.robot_count ?? 0} robot(s)
                  </div>
                  {Array.isArray(bodyguardSpeedsResult.intervals_between_robot_bodyguards_ms) && bodyguardSpeedsResult.intervals_between_robot_bodyguards_ms.length > 0 ? (
                    <>
                      <div className="text-foreground">
                        Intervals: {bodyguardSpeedsResult.intervals_between_robot_bodyguards_ms.map((ms) => `${Number(ms).toFixed(3)} ms`).join(', ')}
                      </div>
                      <div className="text-foreground font-bold">
                        Total: {bodyguardSpeedsResult.total_seconds != null ? Number(bodyguardSpeedsResult.total_seconds).toFixed(3) : (bodyguardSpeedsResult.total_ms != null ? (Number(bodyguardSpeedsResult.total_ms) / 1000).toFixed(3) : '—')} s
                        {bodyguardSpeedsResult.total_ms != null && (
                          <span className="text-mutedForeground font-normal"> ({Number(bodyguardSpeedsResult.total_ms).toFixed(3)} ms)</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-mutedForeground">No intervals (0 or 1 robot)</div>
                  )}
                </div>
              )}

              <ActionRow icon={Trash2} label="Clear Target's BGs" description="Remove all bodyguards" color="text-red-400">
                <BtnDanger onClick={handleClearBodyguards}>Clear</BtnDanger>
              </ActionRow>

              <ActionRow icon={Trash2} label="Drop ALL Bodyguards" description="Remove from every user" color="text-red-400">
                <BtnDanger onClick={handleDropAllHumanBodyguards} disabled={dropHumanBgLoading}>
                  {dropHumanBgLoading ? '...' : 'Drop All'}
                </BtnDanger>
              </ActionRow>

              <ActionRow icon={Shield} label="Test bodyguard payout" description="Run weekly payout job once (human BGs only)">
                <BtnPrimary onClick={handleTestBodyguardPayout} disabled={testPayoutLoading}>
                  {testPayoutLoading ? '...' : 'Run test payout'}
                </BtnPrimary>
              </ActionRow>

              <ActionRow icon={Shield} label="Seed 4 Human Bodyguards" description="Clears robots, creates 4 test humans for you" color="text-emerald-400">
                <BtnPrimary onClick={handleSeedHumanBodyguards} disabled={seedHumanBgLoading}>
                  {seedHumanBgLoading ? '...' : 'Seed Humans'}
                </BtnPrimary>
              </ActionRow>

              <ActionRow icon={Bot} label="Seed Random Mix" description="4 random bodyguards (mix of robots/humans)" color="text-cyan-400">
                <BtnPrimary onClick={handleSeedRandomBodyguards} disabled={seedRandomBgLoading}>
                  {seedRandomBgLoading ? '...' : 'Seed Random'}
                </BtnPrimary>
              </ActionRow>

              <ActionRow icon={Shield} label="Reset Drop Cooldown" description="Clear your bodyguard drop timer" color="text-amber-400">
                <BtnPrimary onClick={handleResetBgCooldown}>Reset</BtnPrimary>
              </ActionRow>
            </div>
          )}
        </div>

      </section>
      )}

      {activeCategoryId === 'admin-economy-progression' && isAdmin && (
      <section id="admin-quick" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Gift size={12} />
          Quick & Bulk
        </h2>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Zap}
          title="Quick Actions"
          toolAnchor="quick"
          isCollapsed={collapsed.quick}
          onToggle={() => toggleSection('quick')}
        />
        {!collapsed.quick && (
          <div className="p-2 space-y-1">
            <ActionRow icon={Gift} label="Give All Points" description="Give points to all alive accounts">
              <FormattedNumberInput value={String(giveAllPoints)} onChange={(raw) => setGiveAllPoints(parseInt(raw, 10) || 1)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              <BtnPrimary onClick={handleGiveAllPoints}>Give</BtnPrimary>
            </ActionRow>
                <ActionRow icon={Trash2} label="Remove All Points" description="Remove ALL points from alive accounts. Items granted by those points are not auto-removed; use the store spends table + Remove button to retract entitlements.">
                  <BtnDanger onClick={handleRemoveAllPoints} disabled={removeAllPointsLoading}>
                    {removeAllPointsLoading ? 'Removing…' : 'Remove All'}
                  </BtnDanger>
                </ActionRow>
                <ActionRow icon={Trash2} label="Set All Points to 0" description="Emergency fix: force users.points = 0 for alive accounts (prevents negative balances).">
                  <BtnDanger onClick={handleZeroAllPoints} disabled={zeroAllPointsLoading}>
                    {zeroAllPointsLoading ? 'Setting…' : 'Set to 0'}
                  </BtnDanger>
                </ActionRow>
            <ActionRow icon={Gift} label="Give All Money" description="Give money to all alive accounts">
              <FormattedNumberInput value={String(giveAllMoney)} onChange={(raw) => setGiveAllMoney(parseInt(raw, 10) || 10000)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              <BtnPrimary onClick={handleGiveAllMoney}>Give</BtnPrimary>
            </ActionRow>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Layers}
          title="Bulk User Action"
          toolAnchor="bulkAction"
          isCollapsed={collapsed.bulkAction}
          onToggle={() => toggleSection('bulkAction')}
        />
        {!collapsed.bulkAction && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground font-heading">Apply an action to multiple users at once. Enter usernames separated by commas or newlines (max 50).</p>
            <textarea
              value={bulkUsernames}
              onChange={(e) => setBulkUsernames(e.target.value)}
              placeholder="user1, user2, user3..."
              rows={3}
              className="w-full px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading resize-y"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value)} className="px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading">
                <option value="give_points">Give Points</option>
                <option value="give_money">Give Money</option>
                <option value="lock">Lock Accounts</option>
                <option value="unlock">Unlock Accounts</option>
                <option value="reset_daily_rewards">Reset Daily Rewards</option>
              </select>
              {(bulkAction === 'give_points' || bulkAction === 'give_money') && (
                <FormattedNumberInput value={String(bulkValue)} onChange={(raw) => setBulkValue(parseInt(raw, 10) || 0)} className="flex h-9 w-24 rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              )}
              <BtnPrimary onClick={handleBulkAction} disabled={bulkLoading}>{bulkLoading ? '...' : 'Apply to all'}</BtnPrimary>
            </div>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={KeyRound}
          title="Redeem Codes"
          toolAnchor="redeemCodes"
          isCollapsed={collapsed.redeemCodes}
          onToggle={() => { toggleSection('redeemCodes'); if (collapsed.redeemCodes) fetchRedeemCodes(); }}
        />
        {!collapsed.redeemCodes && (
          <div className="p-3 space-y-4">
            <p className="text-[10px] text-mutedForeground leading-relaxed">Players redeem once per account on the Referral / Redeem page. Leave max uses empty for unlimited total redemptions.</p>

            <div className="rounded-md border border-primary/15 bg-black/25 p-3 space-y-3">
              <p className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground">Code &amp; limit</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-mutedForeground font-heading uppercase block mb-1">Code</label>
                  <input type="text" value={redeemForm.code} onChange={(e) => setRedeemForm((p) => ({ ...p, code: e.target.value }))} placeholder="e.g. WELCOME2025" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-transparent text-xs font-heading" />
                </div>
                <div>
                  <label className="text-[10px] text-mutedForeground font-heading uppercase block mb-1">Max uses <span className="normal-case text-mutedForeground/80">(optional)</span></label>
                  <input type="number" min="1" value={redeemForm.max_uses} onChange={(e) => setRedeemForm((p) => ({ ...p, max_uses: e.target.value }))} placeholder="Unlimited" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-transparent text-xs font-heading" />
                </div>
              </div>
            </div>

            <div className="rounded-md border border-primary/15 bg-black/25 p-3 space-y-4">
              <p className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground">Rewards</p>
              <div>
                <p className="text-[10px] text-mutedForeground mb-2">Currency (leave blank for none)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] text-mutedForeground font-heading uppercase block mb-1">Cash</label>
                    <FormattedNumberInput value={redeemForm.money} onChange={(v) => setRedeemForm((p) => ({ ...p, money: v }))} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-transparent text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-mutedForeground font-heading uppercase block mb-1">Points</label>
                    <FormattedNumberInput value={redeemForm.points} onChange={(v) => setRedeemForm((p) => ({ ...p, points: v }))} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-transparent text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-mutedForeground font-heading uppercase block mb-1">Respect</label>
                    <FormattedNumberInput value={redeemForm.respect_points} onChange={(v) => setRedeemForm((p) => ({ ...p, respect_points: v }))} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-transparent text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-mutedForeground font-heading uppercase block mb-1">Loot pieces</label>
                    <input type="number" min="0" value={redeemForm.loot_box_pieces} onChange={(e) => setRedeemForm((p) => ({ ...p, loot_box_pieces: e.target.value }))} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-transparent text-xs font-heading" />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-mutedForeground font-heading uppercase block mb-1">Cars</label>
                <p className="text-[9px] text-mutedForeground/90 mb-1.5">Hold Ctrl (Windows) or Cmd (Mac) to select multiple.</p>
                <select multiple value={redeemForm.cars} onChange={(e) => setRedeemForm((p) => ({ ...p, cars: Array.from(e.target.selectedOptions, (o) => o.value) }))} className="w-full px-2 py-1.5 rounded-md border border-input bg-transparent text-xs font-heading max-h-32 overflow-y-auto">
                  {cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
                  <div>
                    <label className="text-[10px] text-mutedForeground font-heading uppercase block">Armoury tokens</label>
                    <p className="text-[9px] text-mutedForeground/90 mt-0.5">Each row is one token type and how many to grant.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRedeemForm((p) => {
                      const opts = tokenTypes.length ? tokenTypes : ['xp_crimes'];
                      return { ...p, tokenEntries: [...p.tokenEntries, { type: opts[0] || 'xp_crimes', amount: 1 }] };
                    })}
                    className="shrink-0 text-primary text-[10px] font-heading uppercase hover:underline"
                  >
                    + Add token
                  </button>
                </div>
                {!redeemCodesLoading && tokenTypes.length === 0 && (
                  <p className="text-[9px] text-amber-400/90 mb-2">Token list failed to load; refresh the list or reopen this section. You can still add rows (defaults to crime XP token).</p>
                )}
                <div className="space-y-2">
                  {redeemForm.tokenEntries.length === 0 ? (
                    <p className="text-[10px] text-mutedForeground italic py-1">No tokens on this code. Use &quot;Add token&quot; to include armoury tokens.</p>
                  ) : redeemForm.tokenEntries.map((entry, i) => {
                    const opts = tokenTypes.length ? tokenTypes : ['xp_crimes'];
                    return (
                      <div key={`redeem-token-${i}`} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem_auto] gap-2 items-center rounded-md border border-input/60 bg-black/30 px-2 py-2">
                        <div>
                          <span className="text-[9px] text-mutedForeground uppercase font-heading block mb-0.5 sm:hidden">Type</span>
                          <select value={entry.type} onChange={(e) => setRedeemForm((p) => ({ ...p, tokenEntries: p.tokenEntries.map((t, j) => (j === i ? { ...t, type: e.target.value } : t)) }))} className="w-full px-2 py-1.5 rounded-md border border-input bg-transparent text-[11px] font-heading">
                            {opts.map((tt) => <option key={tt} value={tt}>{tt.replace(/_/g, ' ')}</option>)}
                          </select>
                        </div>
                        <div>
                          <span className="text-[9px] text-mutedForeground uppercase font-heading block mb-0.5 sm:hidden">Amount</span>
                          <FormattedNumberInput value={String(entry.amount !== undefined && entry.amount !== null && entry.amount !== '' ? entry.amount : '')} onChange={(v) => setRedeemForm((p) => ({ ...p, tokenEntries: p.tokenEntries.map((t, j) => (j === i ? { ...t, amount: v === '' ? 0 : (parseInt(v, 10) || 0) } : t)) }))} className="w-full min-w-0 px-2 py-1.5 rounded-md border border-input bg-transparent text-xs tabular-nums" />
                        </div>
                        <div className="flex sm:justify-end">
                          <button type="button" onClick={() => setRedeemForm((p) => ({ ...p, tokenEntries: p.tokenEntries.filter((_, j) => j !== i) }))} className="inline-flex items-center gap-1 text-red-400 hover:text-red-300 text-[10px] font-heading uppercase px-2 py-1 rounded-md hover:bg-red-500/10" title="Remove row">
                            <Trash2 size={12} className="shrink-0" />
                            <span className="sm:hidden">Remove</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <BtnPrimary onClick={handleCreateRedeemCode} disabled={redeemCodeCreateLoading}>{redeemCodeCreateLoading ? '...' : 'Create code'}</BtnPrimary>

            <div className="rounded-md border border-primary/15 bg-black/25 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">Existing codes</p>
                <button type="button" onClick={() => fetchRedeemCodes()} disabled={redeemCodesLoading} className="text-[10px] font-heading uppercase text-primary hover:underline disabled:opacity-50">Refresh list</button>
              </div>
              {redeemCodesLoading ? <p className="text-[10px] text-mutedForeground">Loading…</p> : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                  {redeemCodesList.length === 0 ? <p className="text-[10px] text-mutedForeground">No redeem codes yet.</p> : redeemCodesList.map((rc, i) => {
                    const used = Number(rc.used_count) || 0;
                    const cap = rc.max_uses != null ? Number(rc.max_uses) : null;
                    const usesLabel = cap != null ? `${used} / ${cap} uses` : `${used} use${used === 1 ? '' : 's'} (no limit)`;
                    const exhausted = cap != null && used >= cap;
                    const rewardLine = summarizeRedeemRewardsForAdmin(rc.rewards);
                    return (
                      <div key={`${rc.code}-${i}`} className="rounded-md border border-input/50 bg-black/30 p-2.5 text-[10px] space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-mono font-medium text-foreground">{rc.code}</span>
                          {rc.active ? <span className="text-emerald-400 font-heading uppercase">Active</span> : <span className="text-red-400 font-heading uppercase">Inactive</span>}
                          <span className={`tabular-nums ${exhausted ? 'text-amber-400' : 'text-mutedForeground'}`}>{usesLabel}{exhausted && rc.active ? ' · exhausted' : ''}</span>
                          <span className="flex flex-wrap gap-x-2 gap-y-0.5 sm:ml-auto">
                            {rc.active && (
                              <button type="button" onClick={() => handleDeactivateRedeemCode(rc.code)} className="text-amber-400 hover:underline text-[10px] font-heading uppercase">Deactivate</button>
                            )}
                            <button type="button" onClick={() => handleDeleteRedeemCode(rc.code)} className="text-red-400 hover:underline text-[10px] font-heading uppercase">Delete</button>
                          </span>
                        </div>
                        <p className="text-[10px] text-mutedForeground leading-snug break-words" title={JSON.stringify(rc.rewards || {})}>{rewardLine}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </section>
      )}

      {activeCategoryId === 'admin-world-systems' && isAdmin && (
      <section id="admin-database" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Skull size={12} />
          Database
        </h2>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Image}
            title="Image host (user uploads)"
            badge={typeof imageHostAdminData.total === 'number' ? <span className="text-[10px] font-heading text-mutedForeground tabular-nums">{imageHostAdminData.total} active</span> : null}
            toolAnchor="imageHostAdmin"
            isCollapsed={collapsed.imageHostAdmin}
            onToggle={() => toggleSection('imageHostAdmin')}
          />
          {!collapsed.imageHostAdmin && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">List images players uploaded or imported on Image host. Filter by username or user ID. Deleting removes the file and breaks public links.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Username (optional)"
                  value={imageHostAdminUsername}
                  onChange={(e) => setImageHostAdminUsername(e.target.value)}
                  className="w-36 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
                />
                <input
                  type="text"
                  placeholder="User ID (optional)"
                  value={imageHostAdminUserId}
                  onChange={(e) => setImageHostAdminUserId(e.target.value)}
                  className="w-40 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono"
                />
                <BtnPrimary
                  type="button"
                  onClick={() => {
                    setImageHostAdminSkip(0);
                    fetchImageHostAdmin(0);
                  }}
                  disabled={imageHostAdminLoading}
                >
                  {imageHostAdminLoading ? 'Loading…' : 'Refresh'}
                </BtnPrimary>
              </div>
              <p className="text-[9px] text-mutedForeground font-heading">If user ID is set, it takes precedence over username.</p>
              {imageHostAdminData.items.length === 0 && !imageHostAdminLoading ? (
                <p className="text-[10px] text-mutedForeground font-heading">No rows. Open this section or click Refresh to load.</p>
              ) : (
                <div className="overflow-x-auto max-h-[min(70vh,520px)] overflow-y-auto rounded border border-zinc-700/40">
                  <table className="w-full text-left border-collapse text-[9px] font-heading">
                    <thead className="sticky top-0 bg-zinc-900/95 z-10">
                      <tr className="border-b border-zinc-700/50">
                        <th className="py-1.5 px-1 font-bold text-mutedForeground uppercase">Preview</th>
                        <th className="py-1.5 px-1 font-bold text-mutedForeground uppercase">User</th>
                        <th className="py-1.5 px-1 font-bold text-mutedForeground uppercase">Public ID</th>
                        <th className="py-1.5 px-1 font-bold text-mutedForeground uppercase">Size</th>
                        <th className="py-1.5 px-1 font-bold text-mutedForeground uppercase">Max side</th>
                        <th className="py-1.5 px-1 font-bold text-mutedForeground uppercase">Created</th>
                        <th className="py-1.5 px-1 font-bold text-mutedForeground uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {imageHostAdminData.items.map((row) => {
                        const url = imageHostPublicUrl(row.public_id);
                        return (
                          <tr key={row.public_id} className="border-b border-zinc-700/30 align-top">
                            <td className="py-1 px-1 w-20">
                              <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                                <img src={url} alt="" className="max-h-14 max-w-[72px] object-contain rounded border border-zinc-600/50 bg-black/40" loading="lazy" />
                              </a>
                            </td>
                            <td className="py-1 px-1 max-w-[140px]">
                              <div className="text-foreground truncate" title={row.username || row.user_id}>{row.username || '—'}</div>
                              <div className="text-mutedForeground font-mono truncate text-[8px]" title={row.user_id}>{row.user_id}</div>
                            </td>
                            <td className="py-1 px-1 font-mono text-[8px] max-w-[100px] break-all">{row.public_id}</td>
                            <td className="py-1 px-1 tabular-nums">{row.size_bytes != null ? `${Math.round(row.size_bytes / 1024)} KB` : '—'}</td>
                            <td className="py-1 px-1 tabular-nums text-mutedForeground">{row.resize_max_edge != null ? `${row.resize_max_edge}px` : '—'}</td>
                            <td className="py-1 px-1 whitespace-nowrap text-mutedForeground">{row.created_at ? String(row.created_at).slice(0, 19).replace('T', ' ') : '—'}</td>
                            <td className="py-1 px-1 whitespace-nowrap">
                              <BtnDanger type="button" onClick={() => handleImageHostAdminDelete(row.public_id)}>Delete</BtnDanger>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {imageHostAdminData.total > IMAGE_HOST_ADMIN_PAGE && (
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-heading text-mutedForeground">
                  <span>Page {Math.floor(imageHostAdminSkip / IMAGE_HOST_ADMIN_PAGE) + 1} · {imageHostAdminData.items.length} shown</span>
                  <BtnSecondary type="button" disabled={imageHostAdminSkip <= 0 || imageHostAdminLoading} onClick={() => setImageHostAdminSkip((s) => Math.max(0, s - IMAGE_HOST_ADMIN_PAGE))}>Previous</BtnSecondary>
                  <BtnSecondary type="button" disabled={imageHostAdminSkip + imageHostAdminData.items.length >= imageHostAdminData.total || imageHostAdminLoading} onClick={() => setImageHostAdminSkip((s) => s + IMAGE_HOST_ADMIN_PAGE)}>Next</BtnSecondary>
                </div>
              )}
            </div>
          )}
        </div>
        <div className={`${styles.panel} rounded-md overflow-hidden border border-red-500/30 mobile-panel`}>
          <SectionHeader
            icon={Skull}
            title="Database Management"
            color="text-red-400"
            toolAnchor="database"
            isCollapsed={collapsed.database}
            onToggle={() => toggleSection('database')}
          />
          {!collapsed.database && (
          <div className="p-3 space-y-3">
            {/* Find Duplicates */}
            <div className="space-y-2">
              <label className="text-[10px] text-mutedForeground font-heading uppercase">Find Duplicate Users</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Username (optional)"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  className="flex-1 min-w-0 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnPrimary onClick={handleFindDuplicates} disabled={dbLoading} className="w-full sm:w-auto">
                  {dbLoading ? '...' : 'Search'}
                </BtnPrimary>
              </div>
              {searchResults && (
                <pre className="max-h-32 overflow-y-auto overflow-x-auto text-[10px] p-2 rounded bg-zinc-900/50 border border-zinc-700/50 text-mutedForeground">
                  {JSON.stringify(searchResults, null, 2)}
                </pre>
              )}
            </div>

            {/* Delete User */}
            <div className="space-y-2">
              <label className="text-[10px] text-mutedForeground font-heading uppercase">Delete Single User</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="User ID or username"
                  value={deleteUserId}
                  onChange={(e) => setDeleteUserId(e.target.value)}
                  className="flex-1 min-w-0 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnDanger onClick={handleDeleteUser} disabled={dbLoading} className="w-full sm:w-auto">
                  {dbLoading ? '...' : 'Delete'}
                </BtnDanger>
              </div>
            </div>

            {/* Delete Family */}
            <div className="space-y-2">
              <label className="text-[10px] text-mutedForeground font-heading uppercase">Delete Family</label>
              <div className="flex gap-2 flex-wrap items-center">
                <select
                  value={deleteFamilyId}
                  onChange={(e) => setDeleteFamilyId(e.target.value)}
                  className="flex-1 min-w-[160px] bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                >
                  <option value="">Select family...</option>
                  {adminFamiliesList.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} [{f.tag}]{f.wiped ? ' (wiped)' : ''}
                    </option>
                  ))}
                </select>
                <BtnDanger onClick={handleDeleteFamily} disabled={dbLoading || !deleteFamilyId}>
                  {dbLoading ? '...' : 'Delete'}
                </BtnDanger>
              </div>
            </div>

            {/* Wipe All Families */}
            <div className="space-y-2 p-2 rounded border border-red-500/50 bg-red-500/5">
              <label className="text-[10px] text-red-400 font-heading uppercase font-bold">⚠️ Wipe All Families</label>
              <p className="text-[10px] text-red-400/80">Delete ALL families. Every user removed from their crew. State heads cleared.</p>
              <div className="flex gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder='Type "WIPE ALL FAMILIES"'
                  value={wipeAllFamiliesConfirmText}
                  onChange={(e) => setWipeAllFamiliesConfirmText(e.target.value)}
                  className="flex-1 min-w-[180px] bg-zinc-900/50 border border-red-500/50 rounded px-2 py-1 text-xs text-foreground focus:border-red-500 focus:outline-none"
                />
                <BtnDanger onClick={handleWipeAllFamilies} disabled={dbLoading || wipeAllFamiliesConfirmText !== 'WIPE ALL FAMILIES'}>
                  {dbLoading ? '...' : 'Wipe all'}
                </BtnDanger>
              </div>
            </div>

            {/* Drop everyone's cars */}
            <div className="space-y-2 p-2 rounded border border-amber-500/50 bg-amber-500/5">
              <label className="text-[10px] text-amber-400 font-heading uppercase font-bold">Drop everyone&apos;s cars</label>
              <p className="text-[10px] text-mutedForeground">Permanently delete all cars for all users (every garage emptied).</p>
              <BtnDanger onClick={handleDropAllCars} disabled={dbLoading}>
                {dbLoading ? '...' : 'Delete all cars'}
              </BtnDanger>
            </div>

            {/* Drop all casinos and properties */}
            <div className="space-y-2 p-2 rounded border border-amber-500/50 bg-amber-500/5">
              <label className="text-[10px] text-amber-400 font-heading uppercase font-bold">Drop all casinos & properties</label>
              <p className="text-[10px] text-mutedForeground">Unclaim every casino (dice, blackjack, slots, etc.) and every property (airport, armoury) globally.</p>
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  type="text"
                  placeholder='Type "DROP ALL CASINOS PROPERTIES"'
                  value={dropAllCasinosConfirmText}
                  onChange={(e) => setDropAllCasinosConfirmText(e.target.value)}
                  className="flex-1 min-w-[180px] bg-zinc-900/50 border border-amber-500/50 rounded px-2 py-1 text-xs text-foreground focus:border-amber-500 focus:outline-none"
                />
                <BtnDanger onClick={handleDropAllCasinosProperties} disabled={dbLoading || dropAllCasinosConfirmText !== 'DROP ALL CASINOS PROPERTIES'}>
                  {dbLoading ? '...' : 'Drop all'}
                </BtnDanger>
              </div>
            </div>

            {/* Wipe All */}
            <div className="space-y-2 p-2 rounded border border-red-500/50 bg-red-500/5">
              <label className="text-[10px] text-red-400 font-heading uppercase font-bold">⚠️ WIPE ALL USERS</label>
              <p className="text-[10px] text-red-400/80">Permanently deletes ALL users and game data. Cannot be undone.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder='Type "WIPE ALL"'
                  value={wipeConfirmText}
                  onChange={(e) => setWipeConfirmText(e.target.value)}
                  className="flex-1 min-w-0 bg-zinc-900/50 border border-red-500/50 rounded px-2 py-1 text-xs text-foreground focus:border-red-500 focus:outline-none"
                />
                <BtnDanger onClick={handleWipeAllUsers} disabled={dbLoading || dbFreshLoading || wipeConfirmText !== 'WIPE ALL'} className="w-full sm:w-auto">
                  {dbLoading ? '...' : 'WIPE'}
                </BtnDanger>
              </div>
            </div>

            {/* Database fresh / New release */}
            <div className="space-y-2 p-2 rounded border border-red-500/50 bg-red-500/5">
              <label className="text-[10px] text-red-400 font-heading uppercase font-bold">🔄 NEW RELEASE (full reset)</label>
              <p className="text-[10px] text-red-400/80">Wipe entire database and re-seed weapons, properties, crimes. Game starts from the very beginning. You will be logged out.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder='Type "NEW RELEASE"'
                  value={freshConfirmText}
                  onChange={(e) => setFreshConfirmText(e.target.value)}
                  className="flex-1 min-w-0 bg-zinc-900/50 border border-red-500/50 rounded px-2 py-1 text-xs text-foreground focus:border-red-500 focus:outline-none"
                />
                <BtnDanger onClick={handleDatabaseFresh} disabled={dbLoading || dbFreshLoading || freshConfirmText !== 'NEW RELEASE'} className="w-full sm:w-auto">
                  {dbFreshLoading ? '...' : 'New release'}
                </BtnDanger>
              </div>
            </div>
          </div>
          )}
        </div>
      </section>
      )}


      {activeCategoryId === 'admin-operations' && (isAdmin || isModerator) && (
      <section id="admin-staff" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Shield size={12} />
          Staff Management
        </h2>
        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Promote / demote moderators</span>
          </div>
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground font-heading">Only admins can promote or demote moderators. Mods see a limited Admin page (Moderation, Logs, HDO, Moderators only).</p>

            <details className="rounded border border-primary/20 bg-primary/5 overflow-hidden">
              <summary className="px-2.5 py-2 cursor-pointer text-[10px] font-heading font-bold text-primary uppercase tracking-wider hover:bg-primary/10 list-none flex items-center gap-2">
                <Info size={12} />
                View moderator tools (what mods can / cannot do)
              </summary>
              <div className="px-2.5 py-2 border-t border-primary/20 grid grid-cols-1 sm:grid-cols-2 gap-4 text-[10px] font-heading">
                <div>
                  <div className="text-emerald-400/90 font-bold uppercase tracking-wider mb-1.5">Mods can</div>
                  <ul className="space-y-0.5 text-mutedForeground">
                    <li>• Activity log (view)</li>
                    <li>• Gambling log (view)</li>
                    <li>• Lock / unlock user</li>
                    <li>• Locked accounts list & message</li>
                    <li>• User search (username/email)</li>
                    <li>• User details & registration info</li>
                    <li>• User inspect (by email)</li>
                    <li>• Login issues & clear lockout</li>
                    <li>• Find duplicates</li>
                    <li>• Cheat detection (same IP, duplicate suspects)</li>
                  </ul>
                </div>
                <div>
                  <div className="text-red-400/90 font-bold uppercase tracking-wider mb-1.5">Mods cannot</div>
                  <ul className="space-y-0.5 text-mutedForeground">
                    <li>• Change rank / add points or cash</li>
                    <li>• Add bullets, cars, loot pieces</li>
                    <li>• Kill or revive player</li>
                    <li>• Set email, password, log out user</li>
                    <li>• Clear gambling log (bulk)</li>
                    <li>• Wipe / delete user / database</li>
                    <li>• Events, NPCs, game world settings</li>
                    <li>• Security (IP bans, rate limits)</li>
                    <li>• Promote or demote moderators</li>
                    <li>• Ghost mode, act as normal</li>
                  </ul>
                </div>
              </div>
            </details>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={promoteModUsername}
                onChange={(e) => setPromoteModUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePromoteModerator()}
                placeholder="Username to promote"
                className="flex-1 min-w-[140px] bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              <BtnPrimary onClick={handlePromoteModerator} disabled={promoteModLoading}>
                {promoteModLoading ? '...' : 'Promote to moderator'}
              </BtnPrimary>
            </div>
            <div>
              <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1.5">Current moderators</div>
              {moderatorsLoading ? (
                <p className="text-[10px] text-mutedForeground">Loading…</p>
              ) : moderatorsList.length === 0 ? (
                <p className="text-[10px] text-mutedForeground font-heading">None. Promote a user above.</p>
              ) : (
                <ul className="space-y-1.5">
                  {moderatorsList.map((m) => (
                    <li key={m.id || m.username} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-zinc-800/40 border border-zinc-700/50">
                      <span className="text-sm font-heading font-medium text-foreground">{m.username ?? '—'}</span>
                      <span className="text-[10px] text-mutedForeground truncate max-w-[180px]">{m.email ?? '—'}</span>
                      <BtnDanger onClick={() => handleDemoteModerator(m.username)} className="shrink-0">Demote</BtnDanger>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="admin-art-line text-primary mx-3" />
        </div>
        )}

        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Categories visible to moderators</span>
          </div>
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground font-heading">Choose which Admin Tool categories moderators can see in the sidebar. Mods only see categories you tick below.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ADMIN_CATEGORIES.map(({ id, label }) => (
                <label key={id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modVisibleCategoryIds.includes(id)}
                    onChange={() => {
                      setModVisibleCategoryIds((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                      );
                    }}
                    className="rounded border-primary/50 bg-zinc-900/50 text-primary focus:ring-primary/50"
                  />
                  <span className="text-[11px] font-heading text-foreground">{label}</span>
                </label>
              ))}
            </div>
            <BtnPrimary onClick={handleSaveModVisibleCategories} disabled={modVisibleCategoriesSaving}>
              {modVisibleCategoriesSaving ? 'Saving...' : 'Save mod visible categories'}
            </BtnPrimary>
          </div>
          <div className="admin-art-line text-primary mx-3" />
        </div>
        )}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Promote / demote Help Desk Operators</span>
          </div>
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-mutedForeground font-heading">HDOs can reply to and close Help Desk tickets. They appear in dark green on Users Online. Admins and mods can promote or demote.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={promoteHdoUsername}
                onChange={(e) => setPromoteHdoUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePromoteHdo()}
                placeholder="Username to promote"
                className="flex-1 min-w-[140px] bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              <BtnPrimary onClick={handlePromoteHdo} disabled={promoteHdoLoading}>
                {promoteHdoLoading ? '...' : 'Promote to HDO'}
              </BtnPrimary>
            </div>
            <div>
              <div className="text-[10px] font-heading text-mutedForeground uppercase mb-1.5">Current Help Desk Operators</div>
              {hdosLoading ? (
                <p className="text-[10px] text-mutedForeground">Loading…</p>
              ) : hdosList.length === 0 ? (
                <p className="text-[10px] text-mutedForeground font-heading">None. Promote a user above.</p>
              ) : (
                <ul className="space-y-1.5">
                  {hdosList.map((h) => (
                    <li key={h.id || h.username} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-zinc-800/40 border border-zinc-700/50">
                      <span className="text-sm font-heading font-medium text-foreground">{h.username ?? '—'}</span>
                      <span className="text-[10px] text-mutedForeground truncate max-w-[180px]">{h.email ?? '—'}</span>
                      <BtnDanger onClick={() => handleDemoteHdo(h.username)} className="shrink-0">Demote</BtnDanger>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="admin-art-line text-primary mx-3" />
        </div>
      </section>
      )}

      {activeCategoryId === 'admin-operations' && isModerator && (
      <section id="admin-mod-tools" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Palette size={12} />
          Mod Tools
        </h2>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Palette}
            title="Your mod online colour"
            badge={
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full border border-primary/30 shrink-0" style={{ backgroundColor: modOnlineColor }} />
                <span className="text-mutedForeground text-[10px] font-heading">Users Online</span>
              </span>
            }
            toolAnchor="modDisplay"
            isCollapsed={collapsed.modDisplay}
            onToggle={() => toggleSection('modDisplay')}
          />
          {!collapsed.modDisplay && (
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">Set the colour for your username on the Users Online page. Same as admins setting their colour in Admin display.</p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={modOnlineColor}
                    onChange={(e) => setModOnlineColor(e.target.value)}
                    className="h-9 w-12 rounded border border-input bg-transparent cursor-pointer"
                    aria-label="Mod colour"
                  />
                  <Input
                    type="text"
                    value={modOnlineColor}
                    onChange={(e) => setModOnlineColor(e.target.value)}
                    placeholder="#1e3a5f"
                    className="w-24 font-mono text-[11px]"
                  />
                  <span className="text-[10px] text-mutedForeground font-heading">Your colour</span>
                </div>
              </div>
              <BtnPrimary onClick={handleSaveModOnlineColor} disabled={modColorSaving}>
                {modColorSaving ? 'Saving...' : 'Save mod colour'}
              </BtnPrimary>
            </div>
          )}
        </div>

        {/* Dupe check (Find Duplicates) */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Users}
            title="Dupe check"
            badge={searchResults?.duplicates?.length > 0 || searchResults?.users?.length > 0 ? <span className="text-[10px] font-heading text-amber-400">Found</span> : null}
            toolAnchor="dupeCheckMod"
            isCollapsed={collapsed.dupeCheckMod}
            onToggle={() => toggleSection('dupeCheckMod')}
          />
          {!collapsed.dupeCheckMod && (
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">Exact duplicate usernames (case-insensitive) or search by username. For IPs, user-agents, VPN and full dupe signals use Cheat Detection → Intelligent dupe check.</p>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="text"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  placeholder="Optional username filter"
                  className="flex-1 min-w-[140px] px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
                />
                <BtnPrimary onClick={handleFindDuplicates} disabled={dbLoading}>
                  {dbLoading ? 'Loading…' : 'Search'}
                </BtnPrimary>
              </div>
              {searchResults && (
                <div className="max-h-48 overflow-y-auto">
                  {searchResults.duplicates?.length > 0 ? (
                    <div className="space-y-1.5 text-[10px] font-heading">
                      <p className="text-amber-400 font-bold">{searchResults.duplicates.length} duplicate group(s)</p>
                      {searchResults.duplicates.slice(0, 10).map((g, i) => (
                        <div key={i} className="p-2 rounded bg-zinc-800/50 border border-amber-500/20">
                          {g.users?.map((u, j) => (
                            <div key={j}>{u.username} · {u.email}</div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : searchResults.users?.length > 0 ? (
                    <pre className="text-[10px] p-2 rounded bg-zinc-900/50 border border-zinc-700/50 text-mutedForeground overflow-x-auto">
                      {JSON.stringify(searchResults.users.slice(0, 20), null, 2)}
                    </pre>
                  ) : (
                    <p className="text-[10px] text-mutedForeground">No duplicates found.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cheat detection – shortcut to admin-cheat */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={AlertTriangle}
            title="Cheat detection"
            toolAnchor="cheatDetectionMod"
            isCollapsed={collapsed.cheatDetectionMod}
            onToggle={() => toggleSection('cheatDetectionMod')}
          />
          {!collapsed.cheatDetectionMod && (
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-mutedForeground font-heading">Same-IP report, same-device report, login attempts, duplicate suspects.</p>
              <BtnPrimary
                onClick={() => {
                  setActiveCategoryId('admin-operations');
                  setCollapsed(prev => ({ ...prev, cheat: false }));
                  if (typeof window !== 'undefined') window.location.hash = 'admin-operations';
                }}
              >
                Open Cheat Detection
              </BtnPrimary>
            </div>
          )}
        </div>
      </section>
      )}

          </div>

      {/* Captcha failures: outside category sections so "View captcha failures" works from Security & Cloudflare */}
      {captchaFailModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75"
          onClick={() => setCaptchaFailModalOpen(false)}
          role="presentation"
        >
          <div
            className="bg-zinc-900 border border-primary/30 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="captcha-fail-title"
          >
            <div className="px-3 py-2.5 border-b border-zinc-700/50 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <h3 id="captcha-fail-title" className="text-sm font-heading font-bold text-primary">
                Turnstile / minigame captcha failures
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={captchaFailUserDraft}
                  onChange={(e) => setCaptchaFailUserDraft(e.target.value)}
                  placeholder="Filter by user id"
                  className="w-40 sm:w-52 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-mono"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => {
                    const u = captchaFailUserDraft.trim();
                    setCaptchaFailUserQuery(u);
                    loadCaptchaTurnstileFailures(u);
                  }}
                  className="px-2 py-1 rounded border border-zinc-600 text-[10px] font-heading text-zinc-200 hover:bg-zinc-800"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCaptchaFailUserDraft('');
                    setCaptchaFailUserQuery('');
                    loadCaptchaTurnstileFailures('');
                  }}
                  className="px-2 py-1 rounded border border-zinc-600 text-[10px] font-heading text-zinc-200 hover:bg-zinc-800"
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={captchaFailLoading}
                  onClick={() => loadCaptchaTurnstileFailures()}
                  className="px-2 py-1 rounded border border-primary/40 bg-primary/15 text-[10px] font-heading text-primary hover:bg-primary/25 disabled:opacity-40"
                >
                  {captchaFailLoading ? '…' : 'Refresh'}
                </button>
                <button
                  type="button"
                  onClick={() => setCaptchaFailModalOpen(false)}
                  className="p-1 rounded border border-zinc-600 text-zinc-400 hover:bg-zinc-800 hover:text-foreground"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="px-3 py-2 text-[10px] text-mutedForeground font-heading border-b border-zinc-800/80 shrink-0">
              Total matching: <span className="text-foreground tabular-nums">{captchaFailTotal}</span>
              {' · '}
              <span className="text-zinc-500">missing_token</span> = no token sent;{' '}
              <span className="text-zinc-500">verify_failed</span> = Cloudflare rejected;{' '}
              <span className="text-zinc-500">misconfigured</span> = keys missing while toggle on.
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              {captchaFailLoading && captchaFailRows.length === 0 ? (
                <div className="p-8 text-center text-mutedForeground text-xs font-heading">Loading…</div>
              ) : captchaFailRows.length === 0 ? (
                <div className="p-8 text-center text-mutedForeground text-xs font-heading">No rows yet.</div>
              ) : (
                <table className="w-full text-left text-[9px] sm:text-[10px] font-heading border-collapse">
                  <thead className="sticky top-0 bg-zinc-900/95 border-b border-zinc-700 z-10">
                    <tr className="text-mutedForeground uppercase tracking-wider">
                      <th className="py-2 px-2 font-semibold">When (UTC)</th>
                      <th className="py-2 px-2 font-semibold">User</th>
                      <th className="py-2 px-2 font-semibold">Reason</th>
                      <th className="py-2 px-2 font-semibold">Path</th>
                      <th className="py-2 px-2 font-semibold">IP</th>
                      <th className="py-2 px-2 font-semibold">Turnstile codes</th>
                      <th className="py-2 px-2 font-semibold">Detail / UA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {captchaFailRows.map((row) => (
                      <tr key={row.id} className="border-b border-zinc-800/80 hover:bg-zinc-800/40 align-top">
                        <td className="py-1.5 px-2 text-zinc-300 whitespace-nowrap">{row.at || '—'}</td>
                        <td className="py-1.5 px-2">
                          <div className="text-foreground">{row.username || '—'}</div>
                          <div className="font-mono text-[9px] text-zinc-500 break-all">{row.user_id || '—'}</div>
                        </td>
                        <td className="py-1.5 px-2 text-amber-200/90">{row.reason || '—'}</td>
                        <td className="py-1.5 px-2 font-mono text-zinc-400 break-all max-w-[140px] sm:max-w-[200px]">
                          {row.method ? `${row.method} ` : ''}
                          {row.path || '—'}
                        </td>
                        <td className="py-1.5 px-2 font-mono text-zinc-400 whitespace-nowrap">{row.ip || '—'}</td>
                        <td className="py-1.5 px-2 font-mono text-zinc-400 break-all max-w-[120px]">
                          {Array.isArray(row.turnstile_error_codes) && row.turnstile_error_codes.length
                            ? row.turnstile_error_codes.join(', ')
                            : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-zinc-500 break-all max-w-[200px] sm:max-w-[280px]">
                          {row.detail ? <div className="text-rose-300/90 mb-1">{row.detail}</div> : null}
                          <div className="opacity-80">{row.user_agent || '—'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

        </main>
      </div>
    </div>
  );
}
