import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useLocation, Navigate } from 'react-router-dom';
import { Settings, UserCog, Coins, Car, Lock, Skull, Bot, Crosshair, Shield, Building2, Zap, Gift, Trash2, Clock, ChevronDown, ChevronRight, ScrollText, Dice5, AlertTriangle, Palette, Users, Mail, LogOut, KeyRound, User, LayoutGrid, Info, X, HelpCircle, BarChart3, Wrench, Database, Globe, Activity, Bell, Layers, DollarSign, Trophy, Search, Award } from 'lucide-react';
import api from '../../utils/api';
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
  { id: 'admin-players', label: 'Player Management', icon: UserCog },
  { id: 'admin-gameworld', label: 'Game World', icon: Zap },
  { id: 'admin-security', label: 'Security & Cloudflare', icon: Globe },
  { id: 'admin-cheat', label: 'Cheat Detection', icon: AlertTriangle },
  { id: 'admin-analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'admin-logs', label: 'Logs', icon: ScrollText },
  { id: 'admin-testing', label: 'Testing Tools', icon: Wrench },
  { id: 'admin-quick', label: 'Quick & Bulk', icon: Gift },
  { id: 'admin-database', label: 'Database', icon: Database },
  { id: 'admin-staff', label: 'Staff Management', icon: Shield },
  { id: 'admin-mod-tools', label: 'Mod Tools', icon: Palette },
];
const MOD_ONLY_CATEGORY_IDS = ['admin-cheat', 'admin-logs', 'admin-staff', 'admin-mod-tools'];

// Searchable tools list - each item has: label (searchable), categoryId (scroll target), collapseKey (optional - to expand section)
const SEARCHABLE_TOOLS = [
  // Player Management
  { label: 'Target Username', categoryId: 'admin-players', keywords: ['target', 'username', 'player'] },
  { label: 'Search Users', categoryId: 'admin-players', collapseKey: 'searchUsers', keywords: ['search', 'users', 'email', 'find'] },
  { label: 'Change Rank', categoryId: 'admin-players', collapseKey: 'rank', keywords: ['rank', 'change', 'prestige', 'level'] },
  { label: 'Add Points', categoryId: 'admin-players', collapseKey: 'points', keywords: ['points', 'add', 'give'] },
  { label: 'Add Tokens', categoryId: 'admin-players', collapseKey: 'tokens', keywords: ['tokens', 'crime', 'gta', 'melt', 'booze', 'travel', 'oc', 'racket', 'jailbust'] },
  { label: 'Founding Member', categoryId: 'admin-players', collapseKey: 'founding', keywords: ['founding', 'member', 'badge', 'founder'] },
  { label: 'Add Money', categoryId: 'admin-players', collapseKey: 'money', keywords: ['money', 'cash', 'add', 'give'] },
  { label: 'Add Bullets', categoryId: 'admin-players', collapseKey: 'bullets', keywords: ['bullets', 'ammo', 'add'] },
  { label: 'Give Car', categoryId: 'admin-players', collapseKey: 'cars', keywords: ['car', 'vehicle', 'give'] },
  { label: 'Ghost Mode', categoryId: 'admin-players', collapseKey: 'ghost', keywords: ['ghost', 'invisible', 'hide'] },
  { label: 'Lock Account', categoryId: 'admin-players', collapseKey: 'lock', keywords: ['lock', 'ban', 'account'] },
  { label: 'Kill Player', categoryId: 'admin-players', collapseKey: 'kill', keywords: ['kill', 'death', 'player'] },
  { label: 'Revive Player', categoryId: 'admin-players', collapseKey: 'revive', keywords: ['revive', 'resurrect', 'alive'] },
  { label: 'User Details', categoryId: 'admin-players', collapseKey: 'userDetails', keywords: ['user', 'details', 'info', 'profile'] },
  { label: 'Gambling Log', categoryId: 'admin-players', collapseKey: 'gamblingLog', keywords: ['gambling', 'log', 'casino', 'bet'] },
  { label: 'Activity Log', categoryId: 'admin-players', collapseKey: 'activityLog', keywords: ['activity', 'log', 'history'] },
  // Game World
  { label: 'Events Toggle', categoryId: 'admin-gameworld', collapseKey: 'events', keywords: ['events', 'toggle', 'enable', 'disable'] },
  { label: 'Beta Round Signup', categoryId: 'admin-gameworld', collapseKey: 'betaSignup', keywords: ['beta', 'signup', 'round', 'points', 'cash', 'testing'] },
  { label: 'Booze Run Rotation', categoryId: 'admin-gameworld', collapseKey: 'boozeRun', keywords: ['booze', 'run', 'rotation', 'prices'] },
  { label: 'Slots Draw', categoryId: 'admin-gameworld', collapseKey: 'slotsDraw', keywords: ['slots', 'draw', 'lottery'] },
  { label: 'State Heads', categoryId: 'admin-gameworld', collapseKey: 'stateHeads', keywords: ['state', 'heads', 'family', 'territory'] },
  { label: 'Hitlist NPCs', categoryId: 'admin-gameworld', collapseKey: 'hitlistNpcs', keywords: ['hitlist', 'npc', 'bounty'] },
  { label: 'Jail NPCs', categoryId: 'admin-gameworld', collapseKey: 'jailNpcs', keywords: ['jail', 'npc', 'prisoner'] },
  { label: 'Casino Settings', categoryId: 'admin-gameworld', collapseKey: 'casinoCaps', keywords: ['casino', 'caps', 'max bet', 'buyback'] },
  { label: 'Admin Settings', categoryId: 'admin-gameworld', collapseKey: 'adminSettings', keywords: ['admin', 'settings', 'config', 'banner', 'stock'] },
  { label: 'Pre-order Settings', categoryId: 'admin-gameworld', collapseKey: 'launchSettings', keywords: ['preorder', 'points', 'release'] },
  { label: 'Release Preorder Points', categoryId: 'admin-gameworld', collapseKey: 'launchSettings', keywords: ['release', 'preorder', 'points', 'credit'] },
  { label: 'Login Lock', categoryId: 'admin-gameworld', collapseKey: 'adminSettings', keywords: ['login', 'lock', 'maintenance'] },
  // Security
  { label: 'Security Summary', categoryId: 'admin-security', collapseKey: 'securitySummary', keywords: ['security', 'summary', 'flags'] },
  { label: 'IP Bans', categoryId: 'admin-security', collapseKey: 'ipBans', keywords: ['ip', 'ban', 'block'] },
  { label: 'Rate Limits', categoryId: 'admin-security', collapseKey: 'rateLimits', keywords: ['rate', 'limit', 'throttle'] },
  { label: 'Cloudflare Bot Block', categoryId: 'admin-security', collapseKey: 'cfBotBlock', keywords: ['cloudflare', 'bot', 'block', 'cf'] },
  // Cheat Detection
  { label: 'Cheat Detection', categoryId: 'admin-cheat', collapseKey: 'cheat', keywords: ['cheat', 'detection', 'suspicious'] },
  { label: 'Find Duplicates', categoryId: 'admin-cheat', collapseKey: 'duplicates', keywords: ['duplicate', 'multi', 'account'] },
  // Analytics
  { label: 'Login page unique visitors', categoryId: 'admin-analytics', collapseKey: 'loginPageVisitors', keywords: ['login', 'visitors', 'unique', 'page', 'stats'] },
  { label: 'User Analytics', categoryId: 'admin-analytics', collapseKey: 'analytics', keywords: ['analytics', 'stats', 'users'] },
  // Logs
  { label: 'Attack Logs', categoryId: 'admin-logs', collapseKey: 'attackLogs', keywords: ['attack', 'log', 'kill'] },
  { label: 'Mod Action Logs', categoryId: 'admin-logs', collapseKey: 'modLogs', keywords: ['mod', 'action', 'log'] },
  // Testing Tools
  { label: 'Search & Attack Tools', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['search', 'attack', 'time'] },
  { label: 'Set Search Time', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['search', 'time', 'minutes'] },
  { label: 'Clear All Searches', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['clear', 'searches', 'delete'] },
  { label: 'Reset Hitlist NPC Timers', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['hitlist', 'npc', 'timer', 'reset'] },
  { label: 'Reset OC Timers', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['oc', 'organised', 'crime', 'timer'] },
  { label: 'Reset Daily Rewards Timer', categoryId: 'admin-testing', collapseKey: 'search', keywords: ['daily', 'rewards', 'timer', 'rps'] },
  { label: 'Bodyguard Tools', categoryId: 'admin-testing', collapseKey: 'bodyguards', keywords: ['bodyguard', 'robot', 'generate'] },
  { label: 'Generate Bodyguards', categoryId: 'admin-testing', collapseKey: 'bodyguards', keywords: ['bodyguard', 'generate', 'robot'] },
  { label: 'Test Bodyguard Payout', categoryId: 'admin-testing', collapseKey: 'bodyguards', keywords: ['bodyguard', 'payout', 'test'] },
  { label: 'Lifetime Objectives Testing', categoryId: 'admin-testing', collapseKey: 'lifetimeObjectives', keywords: ['lifetime', 'objectives', 'completed it', 'test'] },
  // Quick & Bulk
  { label: 'Seed Families', categoryId: 'admin-quick', collapseKey: 'quick', keywords: ['seed', 'families', 'create'] },
  { label: 'Give All Points', categoryId: 'admin-quick', collapseKey: 'quick', keywords: ['give', 'all', 'points', 'bulk'] },
  { label: 'Give All Money', categoryId: 'admin-quick', collapseKey: 'quick', keywords: ['give', 'all', 'money', 'bulk'] },
  { label: 'Bulk User Action', categoryId: 'admin-quick', collapseKey: 'bulkAction', keywords: ['bulk', 'action', 'multiple', 'users'] },
  // Database
  { label: 'Wipe Database', categoryId: 'admin-database', collapseKey: 'wipe', keywords: ['wipe', 'database', 'reset', 'delete'] },
  { label: 'New Release', categoryId: 'admin-database', collapseKey: 'newRelease', keywords: ['new', 'release', 'season'] },
  { label: 'Delete User', categoryId: 'admin-database', collapseKey: 'deleteUser', keywords: ['delete', 'user', 'remove'] },
  { label: 'Create Test Users', categoryId: 'admin-database', collapseKey: 'testUsers', keywords: ['test', 'users', 'create', 'seed'] },
  // Staff Management
  { label: 'Staff Management', categoryId: 'admin-staff', collapseKey: 'staff', keywords: ['staff', 'mod', 'helper', 'promote'] },
  { label: 'Add Moderator', categoryId: 'admin-staff', collapseKey: 'staff', keywords: ['mod', 'moderator', 'add', 'promote'] },
  { label: 'Add Helper', categoryId: 'admin-staff', collapseKey: 'staff', keywords: ['helper', 'help desk', 'add', 'promote'] },
  // Mod Tools
  { label: 'Mod Online Colour', categoryId: 'admin-mod-tools', collapseKey: 'modColour', keywords: ['mod', 'colour', 'color', 'online'] },
  { label: 'Admin Credentials', categoryId: 'admin-mod-tools', collapseKey: 'adminCreds', keywords: ['admin', 'credentials', 'email', 'password'] },
];

function scrollToCategory(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const SECTIONS_KEY = 'admin_sections_collapsed';

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
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

function SectionHeader({ icon: Icon, title, badge, isCollapsed, onToggle, color = 'text-primary' }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="admin-hud-bar w-full px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between hover:bg-primary/12 transition-colors"
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
      <div className="flex items-center gap-2 ml-6 sm:ml-0 shrink-0">
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
  const [loading, setLoading] = useState(true);
  const [npcData, setNpcData] = useState({ npcs: [], npcs_enabled: false, npc_count: 0 });
  const [npcCount, setNpcCount] = useState(10);
  const [forceOnlineInfo, setForceOnlineInfo] = useState(null);
  const [boozeRotationSeconds, setBoozeRotationSeconds] = useState(null);
  const [ranks, setRanks] = useState([]);
  const [cars, setCars] = useState([]);
  const [bgTestCount, setBgTestCount] = useState(2);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const [formData, setFormData] = useState({
    targetUsername: '',
    newRank: 1,
    prestigeLevel: 0,
    points: 100,
    bullets: 5000,
    lootPieces: 100,
    carId: 'car1',
    lockMinutes: 5,
    searchMinutes: 1,
    adminNewEmail: '',
    adminNewPassword: '',
    tokenType: 'xp_crimes',
    tokenAmount: 5,
  });

  const [eventsEnabled, setEventsEnabled] = useState(true);
  const [allEventsForTesting, setAllEventsForTesting] = useState(false);
  const [todayEvent, setTodayEvent] = useState(null);
  const [betaSignupEnabled, setBetaSignupEnabled] = useState(false);
  
  const [cfBotBlockEnabled, setCfBotBlockEnabled] = useState(null);
  const [cfBotBlockLoading, setCfBotBlockLoading] = useState(false);
  const [cfBotBlockError, setCfBotBlockError] = useState(null);
  
  const [cfAutoBlockEnabled, setCfAutoBlockEnabled] = useState(null);
  const [cfAutoBlockLoading, setCfAutoBlockLoading] = useState(false);
  const [cfAutoBlockError, setCfAutoBlockError] = useState(null);
  
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [deleteUserId, setDeleteUserId] = useState('');
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [freshConfirmText, setFreshConfirmText] = useState('');
  const [dropAllCasinosConfirmText, setDropAllCasinosConfirmText] = useState('');
  const [dbLoading, setDbLoading] = useState(false);
  const [dbFreshLoading, setDbFreshLoading] = useState(false);
  const [giveAllPoints, setGiveAllPoints] = useState(100);
  const [giveAllMoney, setGiveAllMoney] = useState(10000);
  const [clearSearchesLoading, setClearSearchesLoading] = useState(false);
  const [dropHumanBgLoading, setDropHumanBgLoading] = useState(false);
  const [testPayoutLoading, setTestPayoutLoading] = useState(false);
  const [lifetimeTestLoading, setLifetimeTestLoading] = useState(false);
  const [resetNpcTimersLoading, setResetNpcTimersLoading] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [toolSearchFocused, setToolSearchFocused] = useState(false);
  const searchInputRef = useRef(null);

  const filteredTools = useMemo(() => {
    if (!toolSearch.trim()) return [];
    const q = toolSearch.toLowerCase().trim();
    return SEARCHABLE_TOOLS.filter(tool => 
      tool.label.toLowerCase().includes(q) || 
      tool.keywords.some(kw => kw.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [toolSearch]);

  const handleToolSelect = (tool) => {
    scrollToCategory(tool.categoryId);
    if (tool.collapseKey) {
      setCollapsed(prev => ({ ...prev, [tool.collapseKey]: false }));
    }
    setToolSearch('');
    setToolSearchFocused(false);
    searchInputRef.current?.blur();
  };
  const [resetOcTimersLoading, setResetOcTimersLoading] = useState(false);
  const [resetDailyRewardsLoading, setResetDailyRewardsLoading] = useState(false);
  const [viewRegistrationInfo, setViewRegistrationInfo] = useState(null);
  const [adminUserSessions, setAdminUserSessions] = useState(null);
  const [adminUserSessionsLoading, setAdminUserSessionsLoading] = useState(false);
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
  const [ipBanIp, setIpBanIp] = useState('');
  const [ipBanReason, setIpBanReason] = useState('');
  const [ipBanHours, setIpBanHours] = useState('');

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
  const [tradesAnalyticsDays, setTradesAnalyticsDays] = useState(7);
  const [tradesAnalytics, setTradesAnalytics] = useState(null);
  const [tradesAnalyticsLoading, setTradesAnalyticsLoading] = useState(false);
  const [hitlistBodyguardsAnalyticsDays, setHitlistBodyguardsAnalyticsDays] = useState(7);
  const [hitlistBodyguardsAnalytics, setHitlistBodyguardsAnalytics] = useState(null);
  const [hitlistBodyguardsAnalyticsLoading, setHitlistBodyguardsAnalyticsLoading] = useState(false);
  const [economyAnalyticsDays, setEconomyAnalyticsDays] = useState(7);
  const [economyAnalytics, setEconomyAnalytics] = useState(null);
  const [economyAnalyticsLoading, setEconomyAnalyticsLoading] = useState(false);
  const [loginPageVisitors, setLoginPageVisitors] = useState(null);
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
  const [giveEveryoneExclusiveLoading, setGiveEveryoneExclusiveLoading] = useState(false);
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
  const [gamblingLog, setGamblingLog] = useState({ entries: [] });
  const [gamblingLogLoading, setGamblingLogLoading] = useState(false);
  const [gamblingLogUsername, setGamblingLogUsername] = useState('');
  const [gamblingLogGameType, setGamblingLogGameType] = useState('');
  const [clearGamblingDays, setClearGamblingDays] = useState(30);
  const [clearGamblingLoading, setClearGamblingLoading] = useState(false);

  // State Heads management
  const [stateHeads, setStateHeads] = useState(null);
  const [stateHeadsLoading, setStateHeadsLoading] = useState(false);

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
  const [cheatLoading, setCheatLoading] = useState(false);
  const [duplicateSuspectsUsername, setDuplicateSuspectsUsername] = useState('');

  const [adminOnlineColor, setAdminOnlineColor] = useState('#a78bfa');
  const [modDefaultOnlineColor, setModDefaultOnlineColor] = useState('#1e3a5f');
  const [requireEmailVerification, setRequireEmailVerification] = useState(false);
  const [landingBannerEnabled, setLandingBannerEnabled] = useState(false);
  const [landingBannerMessage, setLandingBannerMessage] = useState('');
  const [stockMarketMaxPoints, setStockMarketMaxPoints] = useState(3000);
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [loginLockUntil, setLoginLockUntil] = useState('');
  const [loginLockMessage, setLoginLockMessage] = useState('');
  const [preorderReleaseDate, setPreorderReleaseDate] = useState('');
  const [launchSettingsSaving, setLaunchSettingsSaving] = useState(false);
  const [preorderReleaseLoading, setPreorderReleaseLoading] = useState(false);
  const [manualCreditLoading, setManualCreditLoading] = useState(null);
  const [stripeSessionInput, setStripeSessionInput] = useState('');
  const [checkStripeLoading, setCheckStripeLoading] = useState(false);
  const [stripeCheckResult, setStripeCheckResult] = useState(null);
  const [casinoGlobalMaxBet, setCasinoGlobalMaxBet] = useState(1000000000);
  const [casinoBuybackMaxPoints, setCasinoBuybackMaxPoints] = useState(15000);
  const [casinoCapsSaving, setCasinoCapsSaving] = useState(false);
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

  const [economyOverview, setEconomyOverview] = useState(null);
  const [economyOverviewLoading, setEconomyOverviewLoading] = useState(false);
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
  const [maintenanceMsg, setMaintenanceMsg] = useState('');
  const [maintenanceDuration, setMaintenanceDuration] = useState(60);
  const [bulkUsernames, setBulkUsernames] = useState('');
  const [bulkAction, setBulkAction] = useState('give_points');
  const [bulkValue, setBulkValue] = useState(100);
  const [bulkLoading, setBulkLoading] = useState(false);

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
      if (admin) {
        fetchMeta();
        fetchEventsStatus();
        fetchBetaSignupStatus();
        fetchBoozeRotation();
        fetchAdminSettings();
        fetchModerators();
        fetchCfBotBlockStatus();
        fetchCfAutoBlockStatus();
        fetchPageLocks();
        fetchStateHeads();  // Auto-load state heads to show duplicate warnings
      }
      if (admin || mod) {
        fetchHdos();
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
      setCollapsed((prev) => ({ ...prev, activityLog: false }));
    }
    if (s.gamblingLogUsername != null && s.gamblingLogUsername !== '') {
      setGamblingLogUsername(String(s.gamblingLogUsername));
      setCollapsed((prev) => ({ ...prev, gamblingLog: false }));
    }
  }, [location.state]);

  const fetchEventsStatus = async () => {
    try {
      const res = await api.get('/admin/events');
      setEventsEnabled(!!res.data?.events_enabled);
      setAllEventsForTesting(!!res.data?.all_events_for_testing);
      setTodayEvent(res.data?.today_event ?? null);
    } catch {
      setEventsEnabled(true);
      setAllEventsForTesting(false);
      setTodayEvent(null);
    }
  };

  const fetchBetaSignupStatus = async () => {
    try {
      const res = await api.get('/admin/beta-signup');
      setBetaSignupEnabled(!!res.data?.beta_signup_enabled);
    } catch {
      setBetaSignupEnabled(false);
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

  const fetchAdminSettings = async () => {
    try {
      const res = await api.get('/admin/settings');
      const hex = res.data?.admin_online_color || '#a78bfa';
      setAdminOnlineColor(hex.startsWith('#') ? hex : '#' + hex);
      const modHex = res.data?.mod_default_online_color || '#1e3a5f';
      setModDefaultOnlineColor(modHex.startsWith('#') ? modHex : '#' + modHex);
      setRequireEmailVerification(!!res.data?.require_email_verification);
      setLandingBannerEnabled(!!res.data?.landing_banner_enabled);
      setLandingBannerMessage(res.data?.landing_banner_message ?? '');
      setStockMarketMaxPoints(Math.max(1, parseInt(res.data?.stock_market_max_points, 10) || 3000));
      setLoginLockUntil(res.data?.login_lock_until || '');
      setLoginLockMessage(res.data?.login_lock_message || '');
      setPreorderReleaseDate(res.data?.preorder_points_release_date || '');
      setCasinoGlobalMaxBet(res.data?.casino_global_max_bet || 1000000000);
      setCasinoBuybackMaxPoints(res.data?.casino_buyback_max_points || 15000);
    } catch {
      setAdminOnlineColor('#a78bfa');
      setModDefaultOnlineColor('#1e3a5f');
      setRequireEmailVerification(false);
      setLandingBannerMessage('');
      setStockMarketMaxPoints(3000);
      setLoginLockUntil('');
      setLoginLockMessage('');
      setPreorderReleaseDate('');
      setCasinoGlobalMaxBet(1000000000);
      setCasinoBuybackMaxPoints(15000);
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
        landing_banner_enabled: landingBannerEnabled,
        landing_banner_message: landingBannerMessage,
        stock_market_max_points: Math.max(1, parseInt(stockMarketMaxPoints, 10) || 3000),
      });
      setAdminOnlineColor(res.data?.admin_online_color || adminOnlineColor);
      setModDefaultOnlineColor(res.data?.mod_default_online_color || modDefaultOnlineColor);
      setRequireEmailVerification(!!res.data?.require_email_verification);
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

  const handleSaveLoginLock = async () => {
    setLaunchSettingsSaving(true);
    try {
      await api.patch('/admin/settings', {
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

  const handleSaveCasinoCaps = async () => {
    setCasinoCapsSaving(true);
    try {
      await api.patch('/admin/settings', {
        casino_global_max_bet: Math.max(1000000, parseInt(String(casinoGlobalMaxBet).replace(/\D/g, ''), 10) || 1000000000),
        casino_buyback_max_points: Math.max(0, parseInt(String(casinoBuybackMaxPoints).replace(/\D/g, ''), 10) || 15000),
      });
      toast.success('Casino caps saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save casino caps');
    } finally {
      setCasinoCapsSaving(false);
    }
  };

  const handleClearLoginLock = async () => {
    setLaunchSettingsSaving(true);
    try {
      await api.patch('/admin/settings', {
        login_lock_until: null,
        login_lock_message: null,
      });
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

  const handleToggleBetaSignup = async () => {
    try {
      const res = await api.post('/admin/beta-signup/toggle', { enabled: !betaSignupEnabled });
      setBetaSignupEnabled(!!res.data?.beta_signup_enabled);
      toast.success(res.data?.message || 'Beta signup toggled');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
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

  const fetchNPCs = async () => {
    try {
      const response = await api.get('/admin/npcs');
      setNpcData(response.data);
    } catch {}
  };

  const handleToggleNPCs = async (enabled) => {
    try {
      const response = await api.post('/admin/npcs/toggle', { enabled, count: enabled ? npcCount : 0 });
      toast.success(response.data.message);
      fetchNPCs();
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

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

  const handleBanIp = async () => {
    const ip = (ipBanIp || '').trim();
    const reason = (ipBanReason || '').trim() || 'Banned by admin';
    if (!ip) {
      toast.error('Enter an IP address');
      return;
    }
    setIpBansLoading(true);
    try {
      const body = { ip, reason };
      const hours = ipBanHours.trim() ? parseInt(ipBanHours, 10) : null;
      if (hours != null && !isNaN(hours) && hours > 0) body.duration_hours = hours;
      await api.post('/admin/security/ban-ip', body);
      toast.success(`IP ${ip} banned`);
      setIpBanIp('');
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

  const handleResetHitlistNpcTimers = async () => {
    if (!window.confirm('Reset hitlist NPC timers for everyone?')) return;
    setResetNpcTimersLoading(true);
    try {
      const res = await api.post('/admin/hitlist/reset-npc-timers');
      toast.success(res.data?.message || 'Reset');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setResetNpcTimersLoading(false); }
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

  const handleTestLifetimeObjectivesAlmostComplete = async () => {
    if (!window.confirm('Set your account to almost complete lifetime objectives (5 crimes away)? This will reset your lifetime progress flags.')) return;
    setLifetimeTestLoading(true);
    try {
      const res = await api.post('/admin/test-lifetime-objectives-almost-complete');
      toast.success(res.data?.message ?? 'Lifetime objectives set to almost complete', { duration: 8000 });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed', { duration: 5000 });
    } finally {
      setLifetimeTestLoading(false);
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
    } catch {
      setGtaExclusiveReleased(false);
    }
  };

  const handleSetGtaExclusivePool = async (released) => {
    setGtaExclusiveLoading(true);
    try {
      const res = await api.post('/admin/gta/exclusive-pool', { released });
      setGtaExclusiveReleased(!!res.data?.released);
      toast.success(res.data?.message || (released ? 'Al Capone exclusive released into GTA pool' : 'Al Capone exclusive retracted from GTA pool'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setGtaExclusiveLoading(false);
    }
  };

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

  const handleSeedFamilies = async () => {
    if (!window.confirm('Create 3 test families with 5 users each?')) return;
    try {
      const res = await api.post('/admin/seed-families');
      toast.success(res.data?.message || 'Seeded');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
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

  const handleFetchLoginPageVisitors = async () => {
    setLoginPageVisitorsLoading(true);
    try {
      const res = await api.get('/admin/stats/login-page-unique-visitors');
      setLoginPageVisitors(res.data?.unique_visitors ?? null);
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
      <div className={`${styles.pageContent}`}>
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
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="admin-page">
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
              onClick={() => { scrollToCategory('admin-gameworld'); setCollapsed((prev) => ({ ...prev, stateHeads: false })); }}
              className="mt-2 text-[10px] font-heading font-bold text-red-400 underline hover:text-red-300"
            >
              → Go to State Heads section to fix
            </button>
          </div>
        </div>
      )}

      {/* Sticky category navigation */}
      <nav className="sticky top-0 z-20 -mx-2 px-2 py-2 bg-background/95 border-b border-primary/20 rounded-b-md admin-category-nav admin-command-bar backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-2">
          {/* Search bar */}
          <div className="relative">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mutedForeground" />
              <input
                ref={searchInputRef}
                type="text"
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                onFocus={() => setToolSearchFocused(true)}
                onBlur={() => setTimeout(() => setToolSearchFocused(false), 150)}
                placeholder="Search tools... (e.g. lock, casino, bodyguard)"
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-primary/30 bg-zinc-900/80 text-[11px] font-heading text-foreground placeholder:text-mutedForeground focus:border-primary/60 focus:outline-none"
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
            </div>
            {/* Search suggestions dropdown */}
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
          {/* Category buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(isAdmin ? ADMIN_CATEGORIES : ADMIN_CATEGORIES.filter((c) => MOD_ONLY_CATEGORY_IDS.includes(c.id))).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollToCategory(id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-heading font-bold uppercase tracking-wide border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>
      <div className="admin-scan-line" />

      {/* Target Username */}
      <div className={`relative admin-module admin-focus-block ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎯 Target Username</span>
        </div>
        <div className="p-3">
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

      {/* Search users (username or email) */}
      <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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

      {/* All registered users (admin only) */}
      {isAdmin && (
      <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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
                    <Row label="Respect points" value={fmtNum(u.respect_points)} />
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Activity}
          title="System Health"
          badge={systemHealth ? <span className={`text-[10px] font-heading ${systemHealth.status === 'healthy' ? 'text-emerald-400' : 'text-amber-400'}`}>{systemHealth.status}</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={UserCog}
          title="Player Actions"
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

            <ActionRow icon={Zap} label="Add Tokens" description="Give consumable tokens (crime XP, GTA XP, melt, etc.)">
              <Select value={formData.tokenType} onChange={(e) => setFormData((prev) => ({ ...prev, tokenType: e.target.value }))}>
                <option value="xp_crimes">Crime XP</option>
                <option value="xp_gta">GTA XP</option>
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
            </ActionRow>

            <ActionRow icon={Gift} label="Give Loot Box Pieces" description="Add pieces for Loot Box (100 = 1 open)">
              <Input type="number" min="0" value={formData.lootPieces} onChange={(e) => setFormData((prev) => ({ ...prev, lootPieces: parseInt(e.target.value, 10) || 0 }))} />
              <BtnPrimary onClick={handleAddLootPieces}>Give</BtnPrimary>
            </ActionRow>

            <ActionRow icon={Lock} label="Lock Player (investigation)" description="User can only access /locked page and submit one comment until unlocked" color="text-red-400">
              <BtnDanger onClick={handleLockPlayer}>Lock</BtnDanger>
            </ActionRow>
            <ActionRow icon={Lock} label="Unlock Account" description="Restore access after investigation">
              <BtnPrimary onClick={() => handleUnlockAccount()}>Unlock</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Lock} label="Test lock (60s)" description="Lock yourself for 60 seconds to test the locked page">
              <button type="button" onClick={handleTestLockSelf} className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30">
                Test lock
              </button>
            </ActionRow>
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

            <ActionRow icon={Skull} label="Kill Player (modkill)" description="Account is dead; cannot login until revived" color="text-red-400">
              <BtnDanger onClick={handleKillPlayer}>Kill</BtnDanger>
            </ActionRow>
            <ActionRow icon={Zap} label="Revive Player" description="Restore a dead or modkilled account so they can log in again">
              <BtnPrimary onClick={handleRevivePlayer}>Revive</BtnPrimary>
            </ActionRow>
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


      {/* ─── Game World (admin only) ─── */}
      {isAdmin && (
      <section id="admin-gameworld" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <LayoutGrid size={12} />
          Game World
        </h2>

        {/* Launch Settings */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-amber-500/30`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Launch Settings"
          color="text-amber-400"
          badge={
            <span className="text-[10px] font-heading">
              {loginLockUntil ? <span className="text-amber-400">Login locked</span> : null}
              {loginLockUntil && preorderReleaseDate ? ' · ' : null}
              {preorderReleaseDate ? <span className="text-amber-400">Preorder active</span> : null}
              {!loginLockUntil && !preorderReleaseDate ? <span className="text-mutedForeground">Not set</span> : null}
            </span>
          }
          isCollapsed={collapsed.launchSettings}
          onToggle={() => toggleSection('launchSettings')}
        />
        {!collapsed.launchSettings && (
          <div className="p-3 space-y-4">
            <div className="space-y-3">
              <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wider">Login Lock (Launch Date)</p>
              <p className="text-[10px] text-mutedForeground">Block all logins until this date. Users can still register. Staff can login via /staff-login.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="datetime-local"
                  value={loginLockUntil ? loginLockUntil.slice(0, 16) : ''}
                  onChange={(e) => setLoginLockUntil(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleClearLoginLock}
                  disabled={launchSettingsSaving || !loginLockUntil}
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
            </div>

            <div className="h-px bg-zinc-700/30" />

            <div className="space-y-3">
              <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wider">Preorder Points Release</p>
              <p className="text-[10px] text-mutedForeground">Points purchased before this date will be held and credited when this date arrives. After this date, points are credited immediately.</p>
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={DollarSign}
          title="Casino Limits"
          badge={
            <span className="text-[10px] font-heading text-mutedForeground">
              Max bet: ${(casinoGlobalMaxBet || 1000000000).toLocaleString()} · Buy-back: {(casinoBuybackMaxPoints || 15000).toLocaleString()} pts
            </span>
          }
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Gift}
          title="Beta Round Signup"
          badge={
            <span className="text-[10px] font-heading">
              <span className={betaSignupEnabled ? 'text-emerald-400' : 'text-red-400'}>{betaSignupEnabled ? 'On' : 'Off'}</span>
            </span>
          }
          isCollapsed={collapsed.betaSignup}
          onToggle={() => toggleSection('betaSignup')}
        />
        {!collapsed.betaSignup && (
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <BtnPrimary onClick={handleToggleBetaSignup}>{betaSignupEnabled ? 'Disable' : 'Enable'} Beta Signup</BtnPrimary>
            </div>
            <p className="text-[10px] text-mutedForeground">When enabled, new signups receive:</p>
            <ul className="text-[10px] text-mutedForeground list-disc list-inside ml-2 space-y-0.5">
              <li><span className="text-amber-400 font-bold">15,000</span> Points</li>
              <li><span className="text-emerald-400 font-bold">$1,000,000,000</span> Cash</li>
              <li><span className="text-primary font-bold">15,000</span> Respect Points</li>
            </ul>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Booze Run rotation"
          badge={
            <span className="text-[10px] font-heading">
              {boozeRotationSeconds != null ? (
                <span className="text-amber-400">{boozeRotationSeconds}s (test)</span>
              ) : (
                <span className="text-mutedForeground">3h (normal)</span>
              )}
            </span>
          }
          isCollapsed={collapsed.boozeRun}
          onToggle={() => toggleSection('boozeRun')}
        />
        {!collapsed.boozeRun && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-mutedForeground">Set rotation to 15 seconds for testing; prices and best routes will update every 15s. Reset to use normal 3h.</p>
            <div className="flex flex-wrap gap-2">
              <BtnPrimary onClick={handleBoozeRotation15s}>Set rotation to 15s</BtnPrimary>
              <BtnSecondary onClick={handleBoozeRotationReset}>Reset to 3h</BtnSecondary>
            </div>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Coins}
          title="Slots draw (testing)"
          badge={<span className="text-[10px] text-mutedForeground font-heading">Next draw time</span>}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Building2}
          title="State Heads"
          badge={stateHeads?.has_duplicates ? <span className="text-[10px] font-heading text-red-400">Duplicates found!</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Dice5}
          title="Casino Max Bets"
          badge={casinoMaxBets ? <span className="text-[10px] font-heading text-mutedForeground">{Object.keys(casinoMaxBets).length} types</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Lock}
          title="Lock page"
          badge={Object.keys(pageLocks).length > 0 ? <span className="text-[10px] font-heading text-amber-400">{Object.keys(pageLocks).length} locked</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Bell}
          title="Maintenance Banner"
          badge={maintenanceBanner?.enabled ? <span className="text-[10px] font-heading text-amber-400">Active</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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
              <p className="text-[10px] text-mutedForeground font-heading">When released, the Al Capone exclusive can drop from GTA (very rare). Only one in game at a time. GTA logs are in the &quot;GTA logs (post data)&quot; section further down.</p>
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
      </section>
      )}

      {/* ─── Security & Cloudflare (admin only) ─── */}
      {isAdmin && (
      <section id="admin-security" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Globe size={12} />
          Security & Cloudflare
        </h2>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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


        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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


        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Lock}
            title="Lock player (investigation)"
            badge={lockedAccounts.length > 0 ? <span className="text-[10px] font-heading text-amber-400">{lockedAccounts.length} locked</span> : null}
            isCollapsed={collapsed.lockPlayerMod}
            onToggle={() => toggleSection('lockPlayerMod')}
          />
          {!collapsed.lockPlayerMod && (
            <div className="p-2 space-y-1">
              <ActionRow icon={User} label="Target username" description="User to lock or unlock">
                <input
                  type="text"
                  value={formData.targetUsername}
                  onChange={(e) => setFormData((prev) => ({ ...prev, targetUsername: e.target.value }))}
                  placeholder="Username"
                  className="flex-1 min-w-0 max-w-[180px] px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
                />
              </ActionRow>
              <ActionRow icon={Lock} label="Lock Player (investigation)" description="User can only access /locked page and submit one comment until unlocked" color="text-red-400">
                <BtnDanger onClick={handleLockPlayer}>Lock</BtnDanger>
              </ActionRow>
              <ActionRow icon={Lock} label="Unlock Account" description="Restore access after investigation">
                <BtnPrimary onClick={() => handleUnlockAccount()}>Unlock</BtnPrimary>
              </ActionRow>
              <ActionRow icon={Skull} label="Modkill" description="Permanently kill the target account. They become dead and cannot log in until revived. Use for rule breaks or at player request." color="text-red-400">
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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

            {/* IP Bans */}
            <div className="mt-3 pt-3 border-t border-zinc-700/50">
              <div className="text-[10px] font-heading text-primary uppercase tracking-wider mb-2">IP Bans</div>
              <p className="text-[10px] text-mutedForeground mb-2">Banned IPs cannot access the server (login, API, etc.).</p>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  type="text"
                  value={ipBanIp}
                  onChange={(e) => setIpBanIp(e.target.value)}
                  placeholder="IP address"
                  className="w-32 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
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
                <BtnPrimary onClick={handleBanIp} disabled={ipBansLoading}>Ban IP</BtnPrimary>
                <BtnSecondary onClick={fetchIpBans} disabled={ipBansLoading}>{ipBansLoading ? '...' : 'Load list'}</BtnSecondary>
              </div>
              {ipBans.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1 rounded bg-zinc-900/50 border border-zinc-700/50 p-2">
                  {ipBans.map((b, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[10px] py-1.5 px-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                      <div className="min-w-0">
                        <span className="font-mono font-bold text-foreground">{b.ip}</span>
                        {b.reason && <span className="ml-2 text-mutedForeground truncate">{b.reason}</span>}
                        {b.expires_at && <span className="ml-2 text-amber-400/80">expires {b.expires_at.slice(0, 10)}</span>}
                      </div>
                      <button type="button" onClick={() => handleUnbanIp(b.ip)} className="shrink-0 bg-zinc-700/50 hover:bg-zinc-600/50 text-foreground rounded px-2 py-1 text-[9px] font-bold border border-zinc-600/50">Unban</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </section>
      )}

      {/* ─── Cheat Detection ─── */}
      <section id="admin-cheat" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <AlertTriangle size={12} />
          Cheat Detection
        </h2>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Users}
          title="Quick Player Comparison"
          badge={compareResult?.same_ip ? <span className="text-[10px] font-heading text-red-400">Same IP!</span> : compareResult?.same_device ? <span className="text-[10px] font-heading text-amber-400">Same device!</span> : null}
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
                      <div>Cash: ${(u.money ?? 0).toLocaleString()} · Bank: ${(u.bank_balance ?? 0).toLocaleString()}</div>
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

        <div className={`${styles.panel} rounded-md overflow-hidden border border-amber-500/30`}>
        <SectionHeader
          icon={AlertTriangle}
          title="Cheat Detection"
          badge={
            ((cheatSameIp?.total_groups ?? 0) > 0 || (cheatSameDeviceIps?.total_groups ?? 0) > 0 || ((cheatDuplicates?.by_domain?.length ?? 0) + (cheatDuplicates?.by_similar_username?.length ?? 0)) > 0) && (
              <span className="text-[10px] font-heading text-amber-400">Review below</span>
            )
          }
          isCollapsed={collapsed.cheat}
          onToggle={() => toggleSection('cheat')}
        />
        {!collapsed.cheat && (
          <div className="p-3 space-y-4">
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
                        <div className="text-[10px] font-heading text-amber-400 mb-1">IP: {g.ip} — {g.count} account(s)</div>
                        <div className="space-y-0.5">
                          {g.accounts.map((a, j) => (
                            <div key={j} className="flex justify-between text-[10px]">
                              <span className="text-foreground font-bold">{a.username}</span>
                              <span className="text-mutedForeground">{a.email}</span>
                              <span className="text-mutedForeground">{a.source}</span>
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
                        <div className="text-[10px] font-heading text-amber-400 mb-1">
                          {g.account_count} account(s) · {g.distinct_ip_count} different IP(s)
                        </div>
                        <div className="text-[9px] font-mono text-mutedForeground mb-1 truncate" title={g.user_agent_full}>{g.user_agent}</div>
                        <div className="space-y-0.5">
                          {(g.users || []).map((a, j) => (
                            <div key={j} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                              <span className="text-foreground font-bold">{a.username}</span>
                              <span className="text-mutedForeground">{a.email}</span>
                              <span className="text-mutedForeground font-mono">IPs: {(a.ips || []).join(', ') || '—'}</span>
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
              <p className="text-xs text-mutedForeground mb-2">Same email domain or similar usernames (e.g. name1, name2).</p>
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
                    <div className="text-[10px] font-heading text-primary uppercase mb-1">Same email domain</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {(cheatDuplicates.by_domain || []).length === 0 ? (
                        <p className="text-xs text-mutedForeground">None</p>
                      ) : (
                        (cheatDuplicates.by_domain || []).map((g, i) => (
                          <div key={i} className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/30">
                            <div className="text-[10px] text-amber-400 font-heading">{g.domain} — {g.count}</div>
                            {g.accounts?.slice(0, 5).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1">{a.username} · {a.email}</div>
                            ))}
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
                            <div className="text-[10px] text-amber-400 font-heading">"{g.base}" — {g.count}</div>
                            {g.accounts?.slice(0, 5).map((a, j) => (
                              <div key={j} className="text-[10px] pl-1">{a.username} · {a.email}</div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
        </div>

      </section>

      {/* ─── Analytics (admin only) ─── */}
      {isAdmin && (
      <section id="admin-analytics" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <BarChart3 size={12} />
          Analytics
        </h2>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={User}
          title="Login page unique visitors"
          badge={loginPageVisitors != null ? <span className="text-[10px] font-heading text-primary">{loginPageVisitors.toLocaleString()} unique</span> : null}
          isCollapsed={collapsed.loginPageVisitors}
          onToggle={() => { toggleSection('loginPageVisitors'); if (collapsed.loginPageVisitors && loginPageVisitors === null) handleFetchLoginPageVisitors(); }}
        />
        {!collapsed.loginPageVisitors && (
          <div className="p-3 space-y-2">
            <BtnPrimary onClick={handleFetchLoginPageVisitors} disabled={loginPageVisitorsLoading}>{loginPageVisitorsLoading ? 'Loading…' : 'Refresh'}</BtnPrimary>
            {loginPageVisitors != null && (
              <p className="text-[10px] font-heading text-mutedForeground">
                Unique visitors to the login page (by IP): <span className="font-bold text-foreground">{loginPageVisitors.toLocaleString()}</span>
              </p>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Coins}
          title="Economy Overview"
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
                    <div className="font-bold text-foreground">${(economyOverview.total_money ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Banked</div>
                    <div className="font-bold text-foreground">${(economyOverview.total_bank ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Total Points</div>
                    <div className="font-bold text-primary">{(economyOverview.total_points ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                    <div className="text-mutedForeground uppercase">Avg Cash / Player</div>
                    <div className="font-bold text-foreground">${(economyOverview.avg_money ?? 0).toLocaleString()}</div>
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
                          <span className="text-mutedForeground">${(u.money ?? 0).toLocaleString()} cash · ${(u.bank ?? 0).toLocaleString()} banked · {(u.points ?? 0).toLocaleString()} pts</span>
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
              </div>
            )}
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Activity}
          title="Online Player Activity"
          badge={playerActivity ? <span className="text-[10px] font-heading text-primary">{playerActivity.total_online} online</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Attack Analytics"
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Crime Analytics"
            badge={
              crimeAnalytics?.items
                ? <span className="text-[10px] font-heading text-mutedForeground">{crimeAnalytics.items.length} crimes</span>
                : null
            }
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


        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Casino Analytics"
            badge={casinoAnalytics?.items ? <span className="text-[10px] font-heading text-mutedForeground">{casinoAnalytics.items.length} games</span> : null}
            isCollapsed={collapsed.casinoAnalytics}
            onToggle={() => toggleSection('casinoAnalytics')}
          />
          {!collapsed.casinoAnalytics && (
            <div className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {[1, 7, 30].map((d) => (
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
                  <div className="overflow-x-auto max-h-72">
                    {(!casinoAnalytics.items || casinoAnalytics.items.length === 0) ? (
                      <p className="text-[10px] text-mutedForeground font-heading">No casino activity in this window.</p>
                    ) : (
                      <table className="w-full text-[10px] font-heading">
                        <thead><tr><th className="text-left p-1.5 text-mutedForeground">Game</th><th className="text-right p-1.5 text-mutedForeground">Attempts</th><th className="text-right p-1.5 text-mutedForeground">Wins</th><th className="text-right p-1.5 text-mutedForeground">Profit</th><th className="text-right p-1.5 text-mutedForeground">Share</th></tr></thead>
                        <tbody>
                          {casinoAnalytics.items.map((item, idx) => (
                            <tr key={idx} className="border-b border-zinc-700/30">
                              <td className="py-1.5 pr-2 font-medium">{item.game_type || '—'}</td>
                              <td className="py-1.5 text-right">{item.attempts != null ? item.attempts.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.wins != null ? item.wins.toLocaleString() : '—'}</td>
                              <td className="py-1.5 text-right">{item.total_profit != null ? `$${Number(item.total_profit).toLocaleString()}` : '—'}</td>
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

        {/* Trades Analytics */}

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Trades (Quicktrade) Analytics"
            badge={tradesAnalytics?.items ? <span className="text-[10px] font-heading text-mutedForeground">{tradesAnalytics.items.length} types</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Hitlist & Bodyguards Analytics"
            badge={hitlistBodyguardsAnalytics?.items ? <span className="text-[10px] font-heading text-mutedForeground">{hitlistBodyguardsAnalytics.items.length} event types</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Economy Analytics"
            badge={economyAnalytics?.items ? <span className="text-[10px] font-heading text-mutedForeground">{economyAnalytics.items.length} types</span> : null}
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

        {/* Bank Logs (Post Data) */}
      </section>
      )}

      {/* ─── Logs ─── */}
      <section id="admin-logs" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <ScrollText size={12} />
          Logs
        </h2>
        {/* Attack logs (post data) — admin and mod */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Crosshair}
            title="Attack logs (post data)"
            badge={attackLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{attackLogsData.logs.length} entries</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={ScrollText}
            title="Activity Log"
          badge={activityLog.entries?.length != null && <span className="text-[10px] font-heading text-mutedForeground">{activityLog.entries.length} entries</span>}
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
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Dice5}
            title="Betting Log"
            badge={gamblingLog.entries?.length != null && <span className="text-[10px] font-heading text-mutedForeground">{gamblingLog.entries.length} entries</span>}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Skull}
            title="Crime logs (post data)"
            badge={crimeLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{crimeLogsData.logs.length} entries</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Car}
            title="GTA logs (post data)"
            badge={gtaLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{gtaLogsData.logs.length} entries</span> : null}
            isCollapsed={collapsed.gtaLogs}
            onToggle={() => {
              toggleSection('gtaLogs');
              if (collapsed.gtaLogs) fetchGtaExclusivePool();
            }}
          />
          {!collapsed.gtaLogs && (
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Lock}
            title="Jail bust logs (post data)"
            badge={jailLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{jailLogsData.logs.length} entries</span> : null}
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Coins}
            title="Bank logs (post data)"
            badge={bankLogsData ? <span className="text-[10px] font-heading text-primary">{(bankLogsData.transfers?.length ?? 0) + (bankLogsData.deposits?.length ?? 0)} entries</span> : null}
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

        {/* Donations / Payments (Stripe point purchases) */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Zap}
            title="Donations / Payments (Stripe)"
            badge={donationsLogData ? <span className="text-[10px] font-heading text-primary">{donationsLogData.length} entries</span> : null}
            isCollapsed={collapsed.donationsLog}
            onToggle={() => toggleSection('donationsLog')}
          />
          {!collapsed.donationsLog && (
            <div className="p-3 space-y-3">
              <p className="text-[10px] text-mutedForeground font-heading">Stripe point purchases. Click &quot;Credit&quot; to manually credit pending transactions. Use &quot;Check Stripe&quot; to verify and process a session directly from Stripe.</p>
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
                        return (
                          <tr key={row.session_id || idx} className="border-b border-zinc-700/30">
                            <td className="py-1 pr-1 text-mutedForeground" title={row.created_at}>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                            <td className="py-1 pr-1">{row.username ?? row.user_id ?? '—'}</td>
                            <td className="py-1 pr-1 capitalize">{row.package_id ?? '—'}</td>
                            <td className="py-1 pr-1 font-mono">{Number(added).toLocaleString()}</td>
                            <td className="py-1 pr-1">
                              {row.payment_status === 'completed' ? (
                                <span className="text-green-400">Completed</span>
                              ) : row.payment_status === 'preorder_pending' ? (
                                <span className="text-amber-400">Pre-order</span>
                              ) : (
                                <span className="text-red-400">{row.payment_status || 'Pending'}</span>
                              )}
                            </td>
                            <td className="py-1 pr-1">
                              {isPending && row.session_id && (
                                <button
                                  type="button"
                                  onClick={() => handleManualCreditTransaction(row.session_id)}
                                  disabled={manualCreditLoading === row.session_id}
                                  className="px-2 py-0.5 text-[8px] font-heading font-bold uppercase rounded bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30 disabled:opacity-50"
                                >
                                  {manualCreditLoading === row.session_id ? '...' : 'Credit'}
                                </button>
                              )}
                              {!isPending && <span className="text-mutedForeground">—</span>}
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

        {/* Stock Logs (Post Data) */}
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={BarChart3}
            title="Stock market logs (post data)"
            badge={stockLogsData?.logs?.length != null ? <span className="text-[10px] font-heading text-primary">{stockLogsData.logs.length} entries</span> : null}
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

      {/* ─── Testing Tools (admin only) ─── */}
      {isAdmin && (
      <section id="admin-testing" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Wrench size={12} />
          Testing Tools
        </h2>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Clock}
          title="Search & Attack Tools"
          isCollapsed={collapsed.search}
          onToggle={() => toggleSection('search')}
        />
        {!collapsed.search && (
          <div className="p-2 space-y-1">
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

            <ActionRow icon={Clock} label="Reset Hitlist NPC Timers" description="All users can add NPCs again">
              <BtnPrimary onClick={handleResetHitlistNpcTimers} disabled={resetNpcTimersLoading}>
                {resetNpcTimersLoading ? '...' : 'Reset'}
              </BtnPrimary>
            </ActionRow>

            <ActionRow icon={Clock} label="Reset All OC Timers" description="Clear OC cooldown for everyone; all can run Organised Crime immediately">
              <BtnPrimary onClick={handleResetAllOcTimers} disabled={resetOcTimersLoading}>
                {resetOcTimersLoading ? '...' : 'Reset'}
              </BtnPrimary>
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


        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <SectionHeader
            icon={Shield}
            title="Bodyguard Tools"
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
          <SectionHeader
            icon={Trophy}
            title="Lifetime Objectives Testing"
            isCollapsed={collapsed.lifetimeObjectives}
            onToggle={() => toggleSection('lifetimeObjectives')}
          />
          {!collapsed.lifetimeObjectives && (
            <div className="p-2 space-y-1">
              <ActionRow icon={Trophy} label="Set Almost Complete" description="Sets your account to 5 crimes away from completing 'Completed it'. Triggers admin notification on objectives page." color="text-amber-400">
                <BtnPrimary onClick={handleTestLifetimeObjectivesAlmostComplete} disabled={lifetimeTestLoading}>
                  {lifetimeTestLoading ? '...' : 'Populate'}
                </BtnPrimary>
              </ActionRow>
            </div>
          )}
        </div>

      </section>
      )}

      {/* ─── Quick & Bulk (admin only) ─── */}
      {isAdmin && (
      <section id="admin-quick" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Gift size={12} />
          Quick & Bulk
        </h2>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Zap}
          title="Quick Actions"
          isCollapsed={collapsed.quick}
          onToggle={() => toggleSection('quick')}
        />
        {!collapsed.quick && (
          <div className="p-2 space-y-1">
            <ActionRow icon={Building2} label="Seed Families" description="Create 3 families with 5 users each">
              <BtnPrimary onClick={handleSeedFamilies}>Seed</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Gift} label="Give All Points" description="Give points to all alive accounts">
              <FormattedNumberInput value={String(giveAllPoints)} onChange={(raw) => setGiveAllPoints(parseInt(raw, 10) || 1)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              <BtnPrimary onClick={handleGiveAllPoints}>Give</BtnPrimary>
            </ActionRow>
            <ActionRow icon={Gift} label="Give All Money" description="Give money to all alive accounts">
              <FormattedNumberInput value={String(giveAllMoney)} onChange={(raw) => setGiveAllMoney(parseInt(raw, 10) || 10000)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" />
              <BtnPrimary onClick={handleGiveAllMoney}>Give</BtnPrimary>
            </ActionRow>
          </div>
        )}
        </div>

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <SectionHeader
          icon={Layers}
          title="Bulk User Action"
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
      </section>
      )}

      {/* ─── Database (admin only) ─── */}
      {isAdmin && (
      <section id="admin-database" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Skull size={12} />
          Database
        </h2>
        <div className={`${styles.panel} rounded-md overflow-hidden border border-red-500/30`}>
          <SectionHeader
            icon={Skull}
            title="Database Management"
            color="text-red-400"
            isCollapsed={collapsed.database}
            onToggle={() => toggleSection('database')}
          />
          {!collapsed.database && (
          <div className="p-3 space-y-3">
            {/* Find Duplicates */}
            <div className="space-y-2">
              <label className="text-[10px] text-mutedForeground font-heading uppercase">Find Duplicate Users</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username (optional)"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnPrimary onClick={handleFindDuplicates} disabled={dbLoading}>
                  {dbLoading ? '...' : 'Search'}
                </BtnPrimary>
              </div>
              {searchResults && (
                <pre className="max-h-32 overflow-y-auto text-[10px] p-2 rounded bg-zinc-900/50 border border-zinc-700/50 text-mutedForeground">
                  {JSON.stringify(searchResults, null, 2)}
                </pre>
              )}
            </div>

            {/* Delete User */}
            <div className="space-y-2">
              <label className="text-[10px] text-mutedForeground font-heading uppercase">Delete Single User</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="User ID or username"
                  value={deleteUserId}
                  onChange={(e) => setDeleteUserId(e.target.value)}
                  className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <BtnDanger onClick={handleDeleteUser} disabled={dbLoading}>
                  {dbLoading ? '...' : 'Delete'}
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
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder='Type "WIPE ALL"'
                  value={wipeConfirmText}
                  onChange={(e) => setWipeConfirmText(e.target.value)}
                  className="flex-1 bg-zinc-900/50 border border-red-500/50 rounded px-2 py-1 text-xs text-foreground focus:border-red-500 focus:outline-none"
                />
                <BtnDanger onClick={handleWipeAllUsers} disabled={dbLoading || dbFreshLoading || wipeConfirmText !== 'WIPE ALL'}>
                  {dbLoading ? '...' : 'WIPE'}
                </BtnDanger>
              </div>
            </div>

            {/* Database fresh / New release */}
            <div className="space-y-2 p-2 rounded border border-red-500/50 bg-red-500/5">
              <label className="text-[10px] text-red-400 font-heading uppercase font-bold">🔄 NEW RELEASE (full reset)</label>
              <p className="text-[10px] text-red-400/80">Wipe entire database and re-seed weapons, properties, crimes. Game starts from the very beginning. You will be logged out.</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder='Type "NEW RELEASE"'
                  value={freshConfirmText}
                  onChange={(e) => setFreshConfirmText(e.target.value)}
                  className="flex-1 bg-zinc-900/50 border border-red-500/50 rounded px-2 py-1 text-xs text-foreground focus:border-red-500 focus:outline-none"
                />
                <BtnDanger onClick={handleDatabaseFresh} disabled={dbLoading || dbFreshLoading || freshConfirmText !== 'NEW RELEASE'}>
                  {dbFreshLoading ? '...' : 'New release'}
                </BtnDanger>
              </div>
            </div>
          </div>
          )}
        </div>
      </section>
      )}


      {/* ─── Staff Management ─── */}
      {(isAdmin || isModerator) && (
      <section id="admin-staff" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Shield size={12} />
          Staff Management
        </h2>
        {isAdmin && (
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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

        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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

      {/* ─── Mod Tools ─── */}
      {isModerator && (
      <section id="admin-mod-tools" className="admin-category-nav space-y-4">
        <h2 className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-widest flex items-center gap-2">
          <Palette size={12} />
          Mod Tools
        </h2>
        <div className={`relative admin-module ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
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
      </section>
      )}
    </div>
  );
}
