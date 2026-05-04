import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { SAME_ROUTE_NAV_CLICK } from '../constants/navigationEvents';
import { Menu, X, Home, Target, Shield, Building, Building2, Dice5, Sword, Trophy, ShoppingBag, DollarSign, User, LogOut, TrendingUp, Car, Settings, Users, Lock, Crosshair, Skull, Plane, Mail, ChevronDown, ChevronUp, ChevronRight, Landmark, Wine, Newspaper, MapPin, Map, ScrollText, FileText, ArrowLeftRight, MessageSquare, Bell, ListChecks, Palette, Bot, Search, Zap, LayoutGrid, Grid3x3, Heart, Gift, Globe, HelpCircle, Headphones, PanelRight, BarChart3, Package, Gamepad2, UserPlus, Award, Activity, CircleDot, Spade, Flag, SquareStack, Video, Sparkles, Crown, LineChart, Image, Ticket, Mic2, Lightbulb } from 'lucide-react';
import api, { getApiErrorMessage, onCooldownChange, invalidateApiCache, apiRequestWith429Retry, apiGetWithResumeRetries } from '../utils/api';
import { getThemeUiPlatform } from '../utils/themePlatform';
import { readSessionJson } from '../utils/sessionPageCache';
import { DASHBOARD_SESSION_CACHE_KEY } from '../utils/dashboardSessionCache';
import { warmLeaderboardCaches } from '../utils/leaderboardTopCache';
import { setCrimesPrefetch, getCrimesPrefetch } from '../utils/prefetchCache';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useTheme } from '../context/ThemeContext';
import ThemePicker from './ThemePicker';
import FirstTimeThemeModal from './FirstTimeThemeModal';
import { getThemePreset } from '../constants/themes';
import ErrorBoundary from './ErrorBoundary';
import ActiveEventBanner from './ActiveEventBanner';
import FindWordHuntLayer from './entertainer/FindWordHuntLayer';
import { NotificationMessage } from './NotificationMessage';
import GameChat from './GameChat';
import DeathScreen from './DeathScreen';
import FamilyEmblem from './FamilyEmblem';
import styles from '../styles/noir.module.css';

function readLayoutBootFromDashboardCache() {
  const row = readSessionJson(DASHBOARD_SESSION_CACHE_KEY);
  if (!row?.user?.id) return { user: null, rankProgress: null };
  return { user: row.user, rankProgress: row.rankProgress ?? null };
}

/** Bottom bar: 6 icons. Rank = crimes/rank; Misc = everything that doesn't fit elsewhere. */
function getMobileBottomNavItems(isAdmin, hasCasinoOrProperty, isModerator, isEntertainer, isHelpDeskOperator) {
  const goItems = [
    { path: '/game/travel', label: 'Travel' },
    { path: '/game/states', label: 'States' },
    { path: '/my-properties', label: 'My Properties' },
    { path: '/money/property', label: 'Properties' },
    { path: '/money/booze-run', label: 'Booze Run' },
    { path: '/money/distillery', label: 'Distillery' },
    { path: '/cars/garage', label: 'Garage' },
  ];
  return [
    {
      type: 'group',
      id: 'go',
      icon: ChevronRight,
      label: 'Go',
      items: goItems,
    },
    {
      type: 'group',
      id: 'combat',
      icon: Sword,
      label: 'Combat',
      items: [
        { path: '/kill/attack', label: 'Attack' },
        { path: '/kill/witness-statements', label: 'Witness statements' },
        { path: '/kill/attempts', label: 'Attempts' },
        { path: '/kill/hitlist', label: 'Hitlist' },
        { path: '/kill/bodyguards', label: 'Bodyguards' },
        { path: '/kill/armour-weapons', label: 'Armoury' },
      ],
    },
    {
      type: 'group',
      id: 'money',
      icon: DollarSign,
      label: 'Money',
      items: [
        { path: '/game/daily-rewards', label: 'Daily Rewards' },
        { path: '/money/bank', label: 'Bank' },
        { path: '/money/quick-trade', label: 'Quick Trade' },
        { path: '/money/stocks', label: 'Stock Market' },
        { path: '/money/racket', label: 'Racket' },
        { path: '/cars/buy', label: 'Buy Cars' },
        { path: '/cars/sell', label: 'Sell Cars' },
        { path: '/money/lottery', label: 'Lottery' },
        { path: '/money/loot-box', label: 'Loot Box' },
        { path: '/money/crack-safe', label: 'Crack the Safe' },
        { path: '/money/grave-robber', label: 'Grave Robber' },
        { path: '/game-pass', label: 'Game Pass' },
        { path: '/game/store', label: 'Store' },
      ],
    },
    {
      type: 'group',
      id: 'rank',
      icon: Target,
      label: 'Rank',
      items: [
        { path: '/crime/crimes', label: 'Crimes' },
        { path: '/crime/gta', label: 'GTA' },
        { path: '/crime/jail', label: 'Jailbust' },
        { path: '/organised-crime', label: 'Organised Crime' },
        { path: '/game/ranking/badges', label: 'Badges' },
        { path: '/account/prestige', label: 'Prestige' },
      ],
    },
    {
      type: 'group',
      id: 'casinos',
      icon: Dice5,
      label: 'Casinos',
      items: [
        { path: '/casino/dice', label: 'Dice' },
        { path: '/casino/rlt', label: 'Roulette' },
        { path: '/casino/blackjack', label: 'Blackjack' },
        { path: '/casino/horseracing', label: 'Horse Racing' },
        { path: '/casino/slots', label: 'Slots' },
        { path: '/casino/keno', label: 'Keno' },
        { path: '/casino/videopoker', label: 'Video Poker' },
        { path: '/casino/mdg', label: 'MDG' },
        { path: '/casino/mp-blackjack', label: 'MP Blackjack' },
        { path: '/casino/mp-poker', label: 'Poker' },
        { path: '/sports-betting', label: 'Sports Betting' },
        { path: '/my-properties', label: 'My Properties' },
      ],
    },
    {
      type: 'group',
      id: 'you',
      icon: User,
      label: 'You',
      items: [
        { path: '/account/dashboard', label: 'Dashboard' },
        { path: '/account/objectives', label: 'Objectives' },
        { path: '/account/missions', label: 'Missions' },
        { path: '/account/inventory', label: 'My Inventory' },
        { path: '/account/profile', label: 'Edit Profile' },
        { path: '/account/referral', label: 'Referral & Redeem' },
        { path: '/account/settings', label: 'IP & Devices' },
        { path: '/game/stats', label: 'Stats' },
        { path: '/account/stats', label: 'My Stats' },
        { path: '/game/dead-alive', label: 'Dead > Alive' },
        { action: 'theme', label: 'Theme' },
        { action: 'logout', label: 'Logout' },
        { path: '/account/autorank', label: 'Auto Rank' },
        ...(isAdmin ? [{ path: '/staffrole/admin/overview', label: 'Admin Tools' }, { path: '/staffrole/admin/locked', label: 'Locked accounts' }] : []),
        ...(isModerator && !isAdmin ? [{ path: '/staffrole/admin/overview', label: 'Moderator tools' }] : []),
      ],
    },
    {
      type: 'group',
      id: 'minigames',
      icon: Gamepad2,
      label: 'Mini games',
      mobileShortLabel: 'Mini',
      items: [
        { path: '/casino/mini-games/racing', label: 'Racing' },
        { path: '/casino/mini-games/boxing', label: 'Boxing' },
        { path: '/casino/mini-games/flappy', label: 'Flappy Gangster' },
        { path: '/casino/mini-games/shooting-range', label: 'Shooting range' },
        { path: '/casino/mini-games/snake', label: 'Package Run' },
        { path: '/casino/mini-games/minesweeper', label: 'Minefield' },
        { path: '/casino/mini-games/battleships', label: 'Rum Runner' },
        { path: '/casino/mini-games/the-getaway', label: 'The Getaway' },
        { path: '/casino/mini-games/whack-a-copper', label: 'Whack-A-Copper' },
        { path: '/casino/mini-games/famiglia', label: 'Famiglia' },
        { path: '/casino/mini-games/8-ball-pool', label: '8-Ball Pool' },
        { path: '/casino/mini-games/leaderboard', label: 'Leaderboard' },
      ],
    },
    {
      type: 'group',
      id: 'misc',
      icon: LayoutGrid,
      label: 'Misc',
      items: [
        { path: '/social/forum', label: 'Forum' },
        { path: '/social/forum', label: 'Entertainer Forum', search: '?tab=entertainer' },
        ...(isEntertainer ? [{ path: '/game/entertainer', label: 'Entertainer Hub' }] : []),
        { path: '/social/forum', label: 'Designer forum', search: '?tab=designer' },
        { path: '/social/forum', label: 'Game Ideas', search: '?tab=game_ideas' },
        { path: '/social/forum', label: 'Crew OC', search: '?tab=crew_oc' },
        { path: '/social/inbox', label: 'Inbox' },
        { path: '/social/image-host', label: 'Image host' },
        { path: '/game/help-desk', label: 'Help Desk' },
        ...(isHelpDeskOperator ? [{ path: '/game/help-desk-hub', label: 'Help Desk Hub' }] : []),
        { path: '/game/users-online', label: 'Users Online' },
        { path: '/game/family/list', label: 'Families' },
        { path: '/game/leaderboard', label: 'Leaderboard' },
      ],
    },
  ];
}

const TOPBAR_STAT_ORDER_KEY = 'topbar_stat_order';
const DEFAULT_STAT_ORDER = ['rank', 'health', 'bullets', 'kills', 'money', 'points', 'respect_points', 'notifications'];
const TOPBAR_STAT_LABELS = { rank: 'Rank', health: 'Health', bullets: 'Bullets', kills: 'Kills', money: 'Cash', points: 'Points', respect_points: 'Respect', property: 'Casino & Property', notifications: 'Notifications' };
const TOPBAR_GAP_KEY = 'topbar_gap';
const TOPBAR_SIZE_KEY = 'topbar_size';
const TOPBAR_CHIP_SCALE_KEY = 'topbar_chip_scale';
const TOPBAR_CHIP_WIDTH_SCALE_KEY = 'topbar_chip_width_scale';
const TOPBAR_CHIP_HEIGHT_SCALE_KEY = 'topbar_chip_height_scale';
const NOTIFICATION_BALL_POSITION_KEY = 'notification_ball_position';
const MOBILE_STATS_DISPLAY_KEY = 'mobile_stats_display';
const SIDEBAR_SHOW_DIVIDERS_KEY = 'sidebar_show_dividers';
const SIDEBAR_DIVIDER_STYLE_KEY = 'sidebar_divider_style';
const SIDEBAR_SPACING_KEY = 'sidebar_spacing';
const SIDEBAR_LAYOUT_KEY = 'sidebar_layout';
const BOTTOM_NAV_SHOW_DIVIDERS_KEY = 'bottom_nav_show_dividers';

const TOPBAR_STAT_ORDER_PATCH_MS = 450;
let topBarStatOrderPatchTimer = null;
function schedulePatchTopBarStatOrder(order) {
  if (topBarStatOrderPatchTimer) clearTimeout(topBarStatOrderPatchTimer);
  topBarStatOrderPatchTimer = setTimeout(() => {
    topBarStatOrderPatchTimer = null;
    api.patch('/profile/theme', { top_bar_stat_order: order, theme_platform: getThemeUiPlatform() }).catch(() => {});
  }, TOPBAR_STAT_ORDER_PATCH_MS);
}

function loadSidebarShowDividers() {
  try { const v = localStorage.getItem(SIDEBAR_SHOW_DIVIDERS_KEY); if (v === 'true') return true; } catch (_) {}
  return false;
}
function loadSidebarDividerStyle() {
  try { const v = localStorage.getItem(SIDEBAR_DIVIDER_STYLE_KEY); if (v === 'solid' || v === 'dotted' || v === 'dashed') return v; } catch (_) {}
  return 'solid';
}
function loadSidebarSpacing() {
  try { const v = localStorage.getItem(SIDEBAR_SPACING_KEY); if (v === 'compact' || v === 'normal' || v === 'relaxed') return v; } catch (_) {}
  return 'normal';
}
function loadSidebarLayout() {
  try { const v = localStorage.getItem(SIDEBAR_LAYOUT_KEY); if (v === 'categorized' || v === 'categorized_classic' || v === 'default') return v; } catch (_) {}
  return 'default';
}
function loadBottomNavShowDividers() {
  try { const v = localStorage.getItem(BOTTOM_NAV_SHOW_DIVIDERS_KEY); if (v === 'true') return true; } catch (_) {}
  return false;
}
function loadMobileStatsDisplay() {
  try { const v = localStorage.getItem(MOBILE_STATS_DISPLAY_KEY); if (v === 'top_bar' || v === 'touch_ball' || v === 'right_sidebar') return v; } catch (_) {}
  return 'touch_ball';
}
function loadNotificationBallPosition() {
  try {
    const raw = localStorage.getItem(NOTIFICATION_BALL_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return { x: parsed.x, y: parsed.y };
  } catch (_) {}
  return null;
}
function loadStatOrder() {
  try {
    const raw = localStorage.getItem(TOPBAR_STAT_ORDER_KEY);
    if (!raw) return DEFAULT_STAT_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_STAT_ORDER;
    const seen = new Set(parsed);
    const added = DEFAULT_STAT_ORDER.filter((id) => !seen.has(id));
    if (added.length) return [...parsed, ...added];
    return parsed;
  } catch (_) {}
  return DEFAULT_STAT_ORDER;
}
function loadTopBarGap() {
  try { const v = localStorage.getItem(TOPBAR_GAP_KEY); if (v === 'compact' || v === 'normal' || v === 'spread') return v; } catch (_) {}
  return 'normal';
}
function loadTopBarSize() {
  try { const v = localStorage.getItem(TOPBAR_SIZE_KEY); if (v === 'small' || v === 'medium' || v === 'large') return v; } catch (_) {}
  return 'medium';
}
const CHIP_SCALE_MIN = 20;
const CHIP_SCALE_MAX = 100;
function loadTopBarChipScale() {
  try { const v = parseInt(localStorage.getItem(TOPBAR_CHIP_SCALE_KEY), 10); if (Number.isFinite(v) && v >= CHIP_SCALE_MIN && v <= CHIP_SCALE_MAX) return v; } catch (_) {}
  return 50;
}
function loadTopBarChipWidthScale() {
  try {
    const v = parseInt(localStorage.getItem(TOPBAR_CHIP_WIDTH_SCALE_KEY), 10);
    if (Number.isFinite(v) && v >= CHIP_SCALE_MIN && v <= CHIP_SCALE_MAX) return v;
    const fallback = parseInt(localStorage.getItem(TOPBAR_CHIP_SCALE_KEY), 10);
    if (Number.isFinite(fallback) && fallback >= CHIP_SCALE_MIN && fallback <= CHIP_SCALE_MAX) return fallback;
  } catch (_) {}
  return 50;
}
function loadTopBarChipHeightScale() {
  try {
    const v = parseInt(localStorage.getItem(TOPBAR_CHIP_HEIGHT_SCALE_KEY), 10);
    if (Number.isFinite(v) && v >= CHIP_SCALE_MIN && v <= CHIP_SCALE_MAX) return v;
    const fallback = parseInt(localStorage.getItem(TOPBAR_CHIP_SCALE_KEY), 10);
    if (Number.isFinite(fallback) && fallback >= CHIP_SCALE_MIN && fallback <= CHIP_SCALE_MAX) return fallback;
  } catch (_) {}
  return 50;
}

// ── IMPROVEMENT 2: Ornamental category header for sidebar ──────────────────
// classic: thin gold lines + gold label (original look). Default: lines + muted label.
function SidebarCatHeader({ label, classic }) {
  const labelColor = classic ? 'var(--noir-primary)' : 'var(--noir-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px 3px 10px', marginTop: 3 }}>
      <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
      <span style={{ fontFamily: 'var(--font-heading, "Cinzel", serif)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: labelColor, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
    </div>
  );
}

function SameRouteAwareLink({ to, onClick, ...rest }) {
  const location = useLocation();
  const mergeClick = (e) => {
    const path = typeof to === 'string' ? to : (to.pathname || '/');
    const search = typeof to === 'string' ? '' : (to.search || '');
    if (location.pathname === path && (location.search || '') === search) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent(SAME_ROUTE_NAV_CLICK, { detail: { pathname: path, search } }));
    }
    if (onClick) onClick(e);
  };
  return <Link to={to} {...rest} onClick={mergeClick} />;
}

export default function Layout({ children }) {
  const layoutBootRef = useRef(null);
  if (layoutBootRef.current === null) {
    layoutBootRef.current = readLayoutBootFromDashboardCache();
  }
  const [user, setUser] = useState(() => layoutBootRef.current.user);
  const [rankProgress, setRankProgress] = useState(() => layoutBootRef.current.rankProgress);
  const [unreadCount, setUnreadCount] = useState(0);
  const [helpDeskOpenCount, setHelpDeskOpenCount] = useState(0);
  /** Sidebar: total from GET /users/online (null = unknown / failed). */
  const [usersOnlineCount, setUsersOnlineCount] = useState(null);
  const [statOrder, setStatOrder] = useState(loadStatOrder);
  const [topBarGap, setTopBarGap] = useState(loadTopBarGap);
  const [topBarSize, setTopBarSize] = useState(loadTopBarSize);
  const [topBarChipScale, setTopBarChipScale] = useState(loadTopBarChipScale);
  const [topBarChipWidthScale, setTopBarChipWidthScale] = useState(loadTopBarChipWidthScale);
  const [topBarChipHeightScale, setTopBarChipHeightScale] = useState(loadTopBarChipHeightScale);
  const [mobileStatsDisplay, setMobileStatsDisplay] = useState(loadMobileStatsDisplay);
  const [showSidebarDividers, setShowSidebarDividers] = useState(loadSidebarShowDividers);
  const [sidebarDividerStyle, setSidebarDividerStyle] = useState(loadSidebarDividerStyle);
  const [sidebarSpacing, setSidebarSpacing] = useState(loadSidebarSpacing);
  const [sidebarLayout, setSidebarLayout] = useState(loadSidebarLayout);
  const [showBottomNavDividers, setShowBottomNavDividers] = useState(loadBottomNavShowDividers);
  const [draggingStatId, setDraggingStatId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navSectionKey = (key) => `nav-${key}-open`;
  const getNavSectionOpen = (key) => {
    try { return sessionStorage.getItem(navSectionKey(key)) === '1'; } catch { return false; }
  };
  const setNavSectionOpen = (key, value) => {
    try { sessionStorage.setItem(navSectionKey(key), value ? '1' : '0'); } catch {}
  };
  const [rankingOpen, setRankingOpen] = useState(() => getNavSectionOpen('ranking'));
  const [casinoOpen, setCasinoOpen] = useState(() => getNavSectionOpen('casino'));
  const [miniGamesOpen, setMiniGamesOpen] = useState(() => getNavSectionOpen('minigames'));
  const [combatOpen, setCombatOpen] = useState(() => getNavSectionOpen('combat'));
  const [messagingMenuOpen, setMessagingMenuOpen] = useState(() => getNavSectionOpen('messaging-menu'));
  const [categoryOpen, setCategoryOpen] = useState(() => ({ information: true, travel: true, messaging: true, money: true, other: true }));
  const [mobileBottomMenuOpen, setMobileBottomMenuOpen] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [hasAdminEmail, setHasAdminEmail] = useState(false);
  const [rankingCounts, setRankingCounts] = useState({ crimes: 0, gta: 0, jail: 0 });
  const [sportsBettingEventCount, setSportsBettingEventCount] = useState(0);
  const [gtaExclusiveInPool, setGtaExclusiveInPool] = useState(false);
  const [ocStatus, setOcStatus] = useState(null);
  const [atWar, setAtWar] = useState(false);
  const [autoRankPrefs, setAutoRankPrefs] = useState({ auto_rank_enabled: false, auto_rank_crimes: false, auto_rank_gta: false, auto_rank_oc: false, auto_rank_bust_every_5_sec: false, auto_rank_booze: false });
  const [flashNews, setFlashNews] = useState([]);
  const [flashIndex, setFlashIndex] = useState(0);
  const [travelStatus, setTravelStatus] = useState(null);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationList, setNotificationList] = useState([]);
  const [notificationBallPosition, setNotificationBallPosition] = useState(null);
  const notificationBallRef = useRef(null);
  const notificationDragRef = useRef({ isDragging: false, startX: 0, startY: 0, ballX: 0, ballY: 0 });
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [showInitialThemeModal, setShowInitialThemeModal] = useState(false);
  const [topBarCustomizeOpen, setTopBarCustomizeOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [findUserQuery, setFindUserQuery] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  /** Width ≥ md but short landscape (typical phone sideways) — keep drawer nav, no persistent sidebar. */
  const [isLandscapeCompactLayout, setIsLandscapeCompactLayout] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearchExpanded, setUserSearchExpanded] = useState(false);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [pageLocks, setPageLocks] = useState({});
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  /** Remount `{children}` after the tab was backgrounded long enough (mobile browsers often freeze or drop XHR; UI stays blank until refresh). */
  const [contentResumeKey, setContentResumeKey] = useState(0);
  const userSearchRef = useRef(null);
  const userSearchInputRef = useRef(null);
  const userSearchDebounceRef = useRef(null);
  const userSearchQueryRef = useRef('');
  userSearchQueryRef.current = (userSearchQuery || '').trim();
  const notificationPanelRef = useRef(null);
  const notificationPanelOpenRef = useRef(false);
  notificationPanelOpenRef.current = notificationPanelOpen;
  const fetchDataRef = useRef(async () => {});
  const mobileBottomNavRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    mobileNavStyle,
    themeVariant,
    setColour,
    setTexture,
    setButtonColour,
    setAccentLineColour,
    setWritingColour,
    setMutedWritingColour,
    setButtonStyle,
    setFont,
    setTextStyle,
    setToastTextColour,
    setMobileNavStyle,
    setThemeVariant,
    themeServerHydrated,
  } = useTheme();
  const closeRightSidebar = useCallback(() => {
    setRightSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!user || typeof localStorage === 'undefined') {
      setShowInitialThemeModal(false);
      return;
    }
    if (!themeServerHydrated) return;
    if (localStorage.getItem('app_initial_theme_chosen') === '1') {
      setShowInitialThemeModal(false);
      return;
    }
    setShowInitialThemeModal(true);
  }, [user, themeServerHydrated]);

  useEffect(() => {
    if (!showInitialThemeModal) return;
    const onChosen = () => setShowInitialThemeModal(false);
    window.addEventListener('app-initial-theme-chosen', onChosen);
    return () => window.removeEventListener('app-initial-theme-chosen', onChosen);
  }, [showInitialThemeModal]);

  const handleInitialThemeChoose = useCallback((presetId) => {
    const p = getThemePreset(presetId);
    setColour(p.colourId);
    setTexture(p.textureId);
    setButtonColour(p.buttonColourId ?? null);
    setAccentLineColour(p.accentLineColourId ?? null);
    if (p.writingColourId != null) setWritingColour(p.writingColourId);
    if (p.mutedWritingColourId !== undefined) setMutedWritingColour(p.mutedWritingColourId ?? null);
    if (p.buttonStyleId != null) setButtonStyle(p.buttonStyleId);
    if (p.fontId != null) setFont(p.fontId);
    if (p.textStyleId != null) setTextStyle(p.textStyleId);
    if (p.toastTextColourId !== undefined) setToastTextColour(p.toastTextColourId ?? null);
    if (p.mobileNavStyle != null) setMobileNavStyle(p.mobileNavStyle);
    if (p.themeVariant != null) setThemeVariant(p.themeVariant);
    try {
      localStorage.setItem(MOBILE_STATS_DISPLAY_KEY, p.mobileStatsDisplay ?? 'touch_ball');
      window.dispatchEvent(new Event('mobile-stats-display-changed'));
    } catch (_) {}
    try {
      localStorage.setItem('app_initial_theme_chosen', '1');
    } catch (_) {}
    setShowInitialThemeModal(false);
  }, [setColour, setTexture, setButtonColour, setAccentLineColour, setWritingColour, setMutedWritingColour, setButtonStyle, setFont, setTextStyle, setToastTextColour, setMobileNavStyle, setThemeVariant]);

  const hasCasinoOrProperty = Boolean(user?.has_casino_or_property);
  const mobileBottomNavItems = useMemo(() => {
    let items = getMobileBottomNavItems(isAdmin, hasCasinoOrProperty, isModerator, !!user?.is_entertainer, !!user?.is_help_desk_operator);
    if (hasAdminEmail && !isAdmin) {
      items = items.map((i) =>
        i.type === 'group' && i.id === 'you'
          ? { ...i, items: [...i.items, { action: 'promoteAdmin', label: 'Use admin powers' }] }
          : i
      );
    }
    return items.map((i) => {
      if (i.type === 'group' && i.id === 'misc') {
        return { ...i, items: i.items.map((sub) => {
          if (sub.path === '/game/help-desk') return { ...sub, badge: helpDeskOpenCount };
          if (sub.path === '/social/inbox') return { ...sub, badge: unreadCount };
          if (sub.path === '/game/users-online') return { ...sub, onlineCountBadge: usersOnlineCount };
          return sub;
        }) };
      }
      if (i.type === 'group' && i.id === 'rank') {
        return {
          ...i,
          items: i.items.map((sub) => {
            if (sub.path === '/crime/crimes') return { ...sub, badge: rankingCounts.crimes };
            if (sub.path === '/crime/gta') return { ...sub, badge: rankingCounts.gta };
            if (sub.path === '/crime/jail') return { ...sub, badge: rankingCounts.jail };
            return sub;
          }),
        };
      }
      if (i.type === 'group' && i.id === 'casinos') {
        return {
          ...i,
          items: i.items.map((sub) => (
            sub.path === '/sports-betting'
              ? { ...sub, badge: sportsBettingEventCount, badgeTone: 'emerald' }
              : sub
          )),
        };
      }
      if (i.type === 'group' && i.id === 'combat') {
        const wsRed = Math.max(0, Math.floor(Number(user?.witness_nav_red ?? 0)));
        const wsGreen = Math.max(0, Math.floor(Number(user?.witness_nav_green ?? 0)));
        return {
          ...i,
          items: i.items.map((sub) => {
            if (sub.path !== '/kill/witness-statements') return sub;
            if (wsRed > 0) return { ...sub, badge: wsRed };
            if (wsGreen > 0) return { ...sub, badge: wsGreen, badgeTone: 'emerald' };
            return sub;
          }),
        };
      }
      return i;
    });
  }, [isAdmin, isModerator, hasAdminEmail, hasCasinoOrProperty, helpDeskOpenCount, unreadCount, usersOnlineCount, rankingCounts.crimes, rankingCounts.gta, rankingCounts.jail, sportsBettingEventCount, user?.witness_nav_red, user?.witness_nav_green, user?.is_entertainer, user?.is_help_desk_operator]);

  useEffect(() => onCooldownChange(setCooldownSeconds), []);

  useEffect(() => {
    const onTopBarPrefs = () => {
      setTopBarGap(loadTopBarGap());
      setTopBarSize(loadTopBarSize());
      setTopBarChipScale(loadTopBarChipScale());
      setTopBarChipWidthScale(loadTopBarChipWidthScale());
      setTopBarChipHeightScale(loadTopBarChipHeightScale());
    };
    const onMobileStatsDisplay = () => setMobileStatsDisplay(loadMobileStatsDisplay());
    const onSidebarDividers = () => setShowSidebarDividers(loadSidebarShowDividers());
    const onSidebarLayout = () => {
      setSidebarDividerStyle(loadSidebarDividerStyle());
      setSidebarSpacing(loadSidebarSpacing());
      setSidebarLayout(loadSidebarLayout());
    };
    const onBottomNavDividers = () => setShowBottomNavDividers(loadBottomNavShowDividers());
    window.addEventListener('topbar-prefs-changed', onTopBarPrefs);
    window.addEventListener('mobile-stats-display-changed', onMobileStatsDisplay);
    window.addEventListener('sidebar-dividers-changed', onSidebarDividers);
    window.addEventListener('sidebar-layout-changed', onSidebarLayout);
    window.addEventListener('bottom-nav-dividers-changed', onBottomNavDividers);
    const onStatOrderSync = () => setStatOrder(loadStatOrder());
    const onNotificationBallSync = () => {
      const saved = loadNotificationBallPosition();
      if (!saved) return;
      const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
      setNotificationBallPosition({
        x: clamp(saved.x, 0, typeof window !== 'undefined' ? window.innerWidth - 56 : 300),
        y: clamp(saved.y, 0, typeof window !== 'undefined' ? window.innerHeight - 56 : 400),
      });
    };
    window.addEventListener('topbar-stat-order-changed', onStatOrderSync);
    window.addEventListener('notification-ball-changed', onNotificationBallSync);
    return () => {
      window.removeEventListener('topbar-prefs-changed', onTopBarPrefs);
      window.removeEventListener('mobile-stats-display-changed', onMobileStatsDisplay);
      window.removeEventListener('sidebar-dividers-changed', onSidebarDividers);
      window.removeEventListener('sidebar-layout-changed', onSidebarLayout);
      window.removeEventListener('bottom-nav-dividers-changed', onBottomNavDividers);
      window.removeEventListener('topbar-stat-order-changed', onStatOrderSync);
      window.removeEventListener('notification-ball-changed', onNotificationBallSync);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const fn = () => setIsMobileViewport(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px) and (orientation: landscape) and (max-height: 520px)');
    const fn = () => setIsLandscapeCompactLayout(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    const saved = loadNotificationBallPosition();
    if (saved) {
      const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
      setNotificationBallPosition({
        x: clamp(saved.x, 0, typeof window !== 'undefined' ? window.innerWidth - 56 : 300),
        y: clamp(saved.y, 0, typeof window !== 'undefined' ? window.innerHeight - 56 : 400),
      });
    } else if (typeof window !== 'undefined') {
      setNotificationBallPosition({ x: window.innerWidth - 72, y: window.innerHeight - 120 });
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || mobileStatsDisplay !== 'touch_ball') return;
    const saved = loadNotificationBallPosition();
    if (saved) return;
    setNotificationBallPosition({ x: window.innerWidth - 72, y: window.innerHeight - 120 });
  }, [mobileStatsDisplay]);

  useEffect(() => { setMobileBottomMenuOpen(null); }, [location.pathname]);

  useEffect(() => {
    if (!mobileBottomMenuOpen) return;
    const handleClickOutside = (e) => {
      if (mobileBottomNavRef.current && !mobileBottomNavRef.current.contains(e.target)) setMobileBottomMenuOpen(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [mobileBottomMenuOpen]);

  useEffect(() => {
    if (!notificationPanelOpen) return;
    const handleClickOutside = (e) => {
      const ballEl = notificationBallRef.current;
      if (ballEl && !ballEl.contains(e.target)) setNotificationPanelOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [notificationPanelOpen]);

  useEffect(() => {
    if (!userSearchOpen) return;
    const handleClickOutside = (e) => {
      if (userSearchRef.current && !userSearchRef.current.contains(e.target)) {
        setUserSearchOpen(false);
        setUserSearchExpanded(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [userSearchOpen]);

  useEffect(() => {
    const q = (userSearchQuery || '').trim();
    if (!q || q.length < 1) { setUserSearchResults([]); return; }
    if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    userSearchDebounceRef.current = setTimeout(async () => {
      setUserSearchLoading(true);
      setUserSearchResults([]);
      try {
        const res = await api.get('/users/search', { params: { q, limit: 15 } });
        if (userSearchQueryRef.current === q) {
          const list = res.data?.users;
          setUserSearchResults(Array.isArray(list) ? list : []);
        }
      } catch (err) {
        if (userSearchQueryRef.current === q) {
          setUserSearchResults([]);
          const msg = getApiErrorMessage(err);
          if (err?.response?.status === 401 || err?.response?.status === 403) toast.error(msg || 'Please log in again.');
          else toast.error(msg || 'Search failed.');
        }
      } finally {
        if (userSearchQueryRef.current === q) setUserSearchLoading(false);
      }
    }, 280);
    return () => { if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current); };
  }, [userSearchQuery]);

  useEffect(() => { fetchData(); checkAdmin(); fetchUnreadCount(); }, []); // eslint-disable-line

  const refreshUserDebounceRef = useRef(null);
  useEffect(() => {
    const runRefresh = async () => {
      invalidateApiCache();
      fetchData(); fetchUnreadCount(); fetchHelpDeskOpenCount(); fetchWarStatus(); fetchRankingCounts();
      api.get('/oc/status').then((r) => setOcStatus(r.data)).catch(() => setOcStatus(null));
      if (notificationPanelOpenRef.current) {
        try {
          const response = await apiGetWithResumeRetries('/notifications');
          setNotificationList(response.data.notifications || []);
        } catch { /* keep list */ }
      }
    };
    const handler = (event) => {
      const detail = event.detail || {};
      if (detail.money != null) {
        setUser((prev) => (prev ? { ...prev, money: Number(detail.money) } : null));
      }
      if (detail.points != null) {
        setUser((prev) => (prev ? { ...prev, points: Number(detail.points) } : null));
      }
      if (detail.pointsDelta != null) {
        setUser((prev) => (prev ? { ...prev, points: Number(prev.points || 0) + Number(detail.pointsDelta) } : null));
      }
      if (refreshUserDebounceRef.current) clearTimeout(refreshUserDebounceRef.current);
      refreshUserDebounceRef.current = setTimeout(() => runRefresh(), 150);
    };
    window.addEventListener('app:refresh-user', handler);
    return () => { window.removeEventListener('app:refresh-user', handler); if (refreshUserDebounceRef.current) clearTimeout(refreshUserDebounceRef.current); };
  }, []); // eslint-disable-line

  // Only after a longer hidden stint: remount the current page so its data effects run again (fixes blank/stuck content without a manual refresh). Quick app switches stay under this threshold so scroll/state is preserved.
  const contentResumeTimerRef = useRef(null);
  const tabHiddenAtRef = useRef(null);
  useEffect(() => {
    const MIN_HIDDEN_MS = 60_000;
    const scheduleResume = () => {
      if (contentResumeTimerRef.current) clearTimeout(contentResumeTimerRef.current);
      contentResumeTimerRef.current = setTimeout(() => {
        contentResumeTimerRef.current = null;
        try {
          invalidateApiCache();
        } catch (_) { /* ignore */ }
        setContentResumeKey((k) => k + 1);
        window.dispatchEvent(new CustomEvent('app:refresh-user', { detail: {} }));
      }, 350);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden' || document.hidden) {
        if (!tabHiddenAtRef.current) tabHiddenAtRef.current = Date.now();
        return;
      }
      const t0 = tabHiddenAtRef.current;
      tabHiddenAtRef.current = null;
      if (!t0) return;
      if (Date.now() - t0 >= MIN_HIDDEN_MS) scheduleResume();
    };

    const onPageShow = (e) => {
      if (e.persisted) scheduleResume();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      if (contentResumeTimerRef.current) clearTimeout(contentResumeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handler = () => checkAdmin();
    window.addEventListener('app:admin-changed', handler);
    return () => window.removeEventListener('app:admin-changed', handler);
  }, []); // eslint-disable-line

  const fetchAutoRankPrefs = async () => {
    if (!user) return;
    try {
      const res = await api.get('/auto-rank/me');
      setAutoRankPrefs({ auto_rank_enabled: !!res.data?.auto_rank_enabled, auto_rank_crimes: !!res.data?.auto_rank_crimes, auto_rank_gta: !!res.data?.auto_rank_gta, auto_rank_oc: !!res.data?.auto_rank_oc, auto_rank_bust_every_5_sec: !!res.data?.auto_rank_bust_every_5_sec, auto_rank_booze: !!res.data?.auto_rank_booze });
    } catch { setAutoRankPrefs({ auto_rank_enabled: false, auto_rank_crimes: false, auto_rank_gta: false, auto_rank_oc: false, auto_rank_bust_every_5_sec: false, auto_rank_booze: false }); }
  };

  useEffect(() => { if (user) fetchAutoRankPrefs(); }, [user]); // eslint-disable-line

  const prefetchMainLeaderboard = useCallback(() => {
    warmLeaderboardCaches(api);
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) warmLeaderboardCaches(api);
    };
    const t0 = setTimeout(run, 0);
    const interval = setInterval(run, 60_000);
    return () => {
      cancelled = true;
      clearTimeout(t0);
      clearInterval(interval);
    };
  }, [userId]);
  const casinoPropertyFetchedRef = useRef(false);
  if (!userId) casinoPropertyFetchedRef.current = false;
  useEffect(() => {
    if (!userId) return;
    if (!casinoPropertyFetchedRef.current) {
      casinoPropertyFetchedRef.current = true;
      const t = setTimeout(() => fetchCasinoProperty(), 80);
      return () => clearTimeout(t);
    }
  }, [userId]); // eslint-disable-line
  useEffect(() => { if (location.pathname === '/my-properties') fetchCasinoProperty(); }, [location.pathname]); // eslint-disable-line
  const showCasinoProfitLive = hasCasinoOrProperty && (location.pathname === '/my-properties' || (mobileStatsDisplay === 'right_sidebar' && (!isMobileViewport || rightSidebarOpen)));
  useEffect(() => {
    if (!showCasinoProfitLive || !userId) return;
    const intervalId = setInterval(fetchCasinoProperty, 10000);
    return () => clearInterval(intervalId);
  }, [showCasinoProfitLive, userId]); // eslint-disable-line
  // On pathname change: only refresh ranking counts (debounced); do not refetch user/rank (handled by mount, 60s interval, app:refresh-user)
  const rankingDebounceRef = useRef(null);
  useEffect(() => {
    const path = location.pathname;
    // Match real routes: /crime/crimes, /crime/gta, /crime/jail, /game/ranking, etc. (old list used /gta, /crimes which never matched)
    const needRanking =
      path.startsWith('/crime/') ||
      path.startsWith('/game/ranking') ||
      path === '/ranking' ||
      path === '/sports-betting' ||
      (userId && mobileStatsDisplay === 'right_sidebar');
    if (rankingDebounceRef.current) clearTimeout(rankingDebounceRef.current);
    rankingDebounceRef.current = setTimeout(() => {
      if (needRanking) fetchRankingCounts();
      if (userId && mobileStatsDisplay === 'right_sidebar') api.get('/oc/status').then((r) => setOcStatus(r.data)).catch(() => setOcStatus(null));
    }, 350);
    return () => {
      if (rankingDebounceRef.current) clearTimeout(rankingDebounceRef.current);
    };
  }, [location.pathname, userId, mobileStatsDisplay]); // eslint-disable-line

  // Refresh vendetta flag when opening family UI (war may have started; /families/war is cheap).
  useEffect(() => {
    const p = location.pathname;
    if (p === '/game/family/list' || p.startsWith('/families')) fetchWarStatus();
  }, [location.pathname]); // eslint-disable-line

  useEffect(() => {
    let intervalId;
    const deferred = setTimeout(() => { fetchWarStatus(); intervalId = setInterval(fetchWarStatus, 45000); }, 150);
    return () => { clearTimeout(deferred); if (intervalId) clearInterval(intervalId); };
  }, []); // eslint-disable-line

  useEffect(() => {
    const pollNotifications = async () => {
      try {
        const response = await apiGetWithResumeRetries('/notifications');
        setUnreadCount(response.data.unread_count ?? 0);
        if (notificationPanelOpenRef.current) setNotificationList(response.data.notifications || []);
      } catch { }
    };
    let intervalId;
    const deferred = setTimeout(() => { pollNotifications(); intervalId = setInterval(pollNotifications, 30000); }, 50);
    return () => { clearTimeout(deferred); if (intervalId) clearInterval(intervalId); };
  }, []); // eslint-disable-line

  useEffect(() => {
    let intervalId;
    // Random 0–45s so clients do not all hit /help-desk/open-count on the same wall-clock second every minute.
    const jitterMs = Math.floor(Math.random() * 45000);
    const deferred = setTimeout(() => {
      fetchHelpDeskOpenCount();
      intervalId = setInterval(fetchHelpDeskOpenCount, 60000);
    }, 300 + jitterMs);
    return () => { clearTimeout(deferred); if (intervalId) clearInterval(intervalId); };
  }, []); // eslint-disable-line

  useEffect(() => {
    let intervalId;
    const deferred = setTimeout(() => { fetchUsersOnlineCount(); intervalId = setInterval(fetchUsersOnlineCount, 30000); }, 500);
    return () => { clearTimeout(deferred); if (intervalId) clearInterval(intervalId); };
  }, []); // eslint-disable-line

  // Periodic refresh of user data (bullets, cash, etc.) every 60 seconds for Auto Rank updates
  useEffect(() => {
    let intervalId;
    const deferred = setTimeout(() => { intervalId = setInterval(fetchData, 60000); }, 5000);
    return () => { clearTimeout(deferred); if (intervalId) clearInterval(intervalId); };
  }, []); // eslint-disable-line

  const fetchFlashNews = async () => {
    try {
      const res = await apiRequestWith429Retry(() => api.get('/news/flash'));
      setFlashNews(res.data?.items || []);
    } catch {
      setFlashNews([]);
    }
  };

  useEffect(() => { const t = setTimeout(() => { api.get('/objectives').catch(() => {}); }, 500); return () => clearTimeout(t); }, []);

  useEffect(() => { fetchFlashNews(); const id = setInterval(fetchFlashNews, 60000); return () => clearInterval(id); }, []); // eslint-disable-line

  useEffect(() => {
    const onSameRoute = () => {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (_) {}
    };
    window.addEventListener(SAME_ROUTE_NAV_CLICK, onSameRoute);
    return () => window.removeEventListener(SAME_ROUTE_NAV_CLICK, onSameRoute);
  }, []);

  useEffect(() => {
    if (flashNews.length <= 1) return;
    // 45s on mobile so marquee can fully scroll before next message; 8s on desktop
    const ms = isMobileViewport ? 45000 : 8000;
    const t = setInterval(() => setFlashIndex((i) => (i + 1) % flashNews.length), ms);
    return () => clearInterval(t);
  }, [flashNews.length, isMobileViewport]);

  const fetchData = async () => {
    try {
      const sinkProgress = (p) => {
        p.catch(() => {});
      };
      const progressPromise = apiRequestWith429Retry(() => api.get('/user/rank-progress'));
      const userRes = await apiGetWithResumeRetries('/auth/me');
      if (userRes.data?.account_locked) {
        sinkProgress(progressPromise);
        if (window.location.pathname !== '/locked') {
          window.location.replace('/locked');
        }
        return;
      }
      if (!userRes.data?.rules_accepted && location.pathname !== '/account/rules-acceptance') {
        sinkProgress(progressPromise);
        setUser((prev) => ({ ...userRes.data, ...prev }));
        navigate('/account/rules-acceptance', { replace: true });
        return;
      }
      const progressRes = await progressPromise;
      setUser((prev) => ({
        ...userRes.data,
        casino_profit: prev?.casino_profit ?? userRes.data.casino_profit,
        property_profit: prev?.property_profit ?? userRes.data.property_profit,
        has_casino_or_property: prev?.has_casino_or_property ?? userRes.data.has_casino_or_property,
      }));
      setRankProgress(progressRes.data);
    } catch (error) {
      const status = error?.response?.status;
      if (status === 401 || (status === 403 && error.config?.url?.includes('/auth/me'))) {
        const msg = getApiErrorMessage(error);
        toast.error(msg || 'Session expired. Please log in again.');
        console.error('Auth failure, logging out:', error);
        localStorage.removeItem('token');
        navigate('/');
      } else {
        console.error('Failed to fetch user (non-auth):', error);
      }
    }
  };
  fetchDataRef.current = fetchData;

  useEffect(() => {
    let debounceTimer = null;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        (async () => {
          try {
            const r = await apiGetWithResumeRetries('/notifications');
            setUnreadCount(r.data?.unread_count ?? 0);
            if (notificationPanelOpenRef.current) {
              setNotificationList(r.data?.notifications || []);
            }
          } catch (_) { /* badge unchanged */ }
          try {
            await fetchDataRef.current?.();
          } catch (_) { /* fetchData handles auth */ }
        })();
      }, 450);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const fetchWarStatus = async () => {
    try {
      const res = await apiRequestWith429Retry(() => api.get('/families/war'));
      setAtWar(!!(res.data?.wars?.length > 0));
    } catch {
      setAtWar(false);
    }
  };
  const fetchUnreadCount = async () => {
    try {
      const response = await apiGetWithResumeRetries('/notifications');
      setUnreadCount(response.data.unread_count ?? 0);
    } catch (error) {
      console.error('Failed to fetch notifications');
    }
  };
  const fetchHelpDeskOpenCount = async () => {
    try { const res = await api.get('/help-desk/open-count'); setHelpDeskOpenCount(res.data?.open_tickets_count ?? 0); } catch { setHelpDeskOpenCount(0); }
  };
  const fetchUsersOnlineCount = async () => {
    try {
      const res = await api.get('/users/online');
      const n = res.data?.total_online;
      setUsersOnlineCount(typeof n === 'number' ? n : 0);
    } catch {
      setUsersOnlineCount(null);
    }
  };
  const fetchCasinoProperty = async () => {
    try { const res = await api.get('/user/casino-property'); if (res.data) setUser((prev) => (prev ? { ...prev, ...res.data } : prev)); } catch { }
  };

  const openNotificationPanel = async () => {
    const next = !notificationPanelOpen;
    setNotificationPanelOpen(next);
    if (next) {
      try {
        const response = await apiGetWithResumeRetries('/notifications');
        setNotificationList(response.data.notifications || []);
      } catch {
        setNotificationList([]);
      }
    }
  };

  const markAllNotificationsRead = async () => {
    try { await api.post('/notifications/read-all'); setUnreadCount(0); setNotificationList((prev) => prev.map((n) => ({ ...n, read: true }))); } catch (_) {}
  };

  const checkAdmin = async () => {
    try {
      const response = await api.get('/admin/check');
      setIsAdmin(!!response.data.is_admin); setIsModerator(!!response.data.is_moderator); setHasAdminEmail(!!response.data.has_admin_email);
    } catch (error) { setIsAdmin(false); setIsModerator(false); setHasAdminEmail(false); }
  };

  useEffect(() => {
    api.get('/page-locks').then((r) => {
      const paths = r.data?.paths;
      setPageLocks(typeof paths === 'object' && paths !== null ? paths : {});
    }).catch(() => setPageLocks({}));
  }, []);

  const promoteToAdmin = async () => {
    try { await api.post('/admin/act-as-normal', null, { params: { acting: false } }); await checkAdmin(); window.dispatchEvent(new CustomEvent('app:refresh-user')); } catch (_) {}
  };

  const fetchRankingCounts = async () => {
    try {
      const crimesPrefetchData = getCrimesPrefetch();
      const crimesPromise = crimesPrefetchData != null
        ? Promise.resolve({ data: crimesPrefetchData })
        : api.get('/crimes');
      const onJailPage = location.pathname === '/crime/jail';
      const settled = await Promise.allSettled([
        crimesPromise,
        api.get('/gta/playable-count'),
        onJailPage ? Promise.resolve({ data: null }) : api.get('/jail/players'),
        api.get('/sports-betting/events'),
      ]);
      const crimesRes = settled[0].status === 'fulfilled' ? settled[0].value : null;
      const gtaPcRes = settled[1].status === 'fulfilled' ? settled[1].value : null;
      const jailPlayersRes = settled[2].status === 'fulfilled' ? settled[2].value : null;
      const crimesAvailable = crimesRes && Array.isArray(crimesRes.data) ? crimesRes.data.filter((c) => c?.can_commit).length : 0;
      const pc = gtaPcRes?.data?.playable_count;
      const gtaAvailable = typeof pc === 'number' ? pc : 0;
      if (gtaPcRes?.data && typeof gtaPcRes.data.exclusive_in_pool !== 'undefined') {
        setGtaExclusiveInPool(!!gtaPcRes.data.exclusive_in_pool);
      }
      const jailCount = onJailPage
        ? undefined
        : (jailPlayersRes && Array.isArray(jailPlayersRes.data?.players) ? jailPlayersRes.data.players.length : 0);
      setRankingCounts((prev) => ({
        crimes: crimesAvailable,
        gta: gtaAvailable,
        jail: jailCount === undefined ? prev.jail : jailCount,
      }));
      if (settled[3].status === 'fulfilled') {
        const ev = settled[3].value?.data?.events;
        setSportsBettingEventCount(Array.isArray(ev) ? ev.length : 0);
      } else {
        setSportsBettingEventCount(0);
      }
    } catch (error) { }
  };

  useEffect(() => {
    if (!userId) {
      setGtaExclusiveInPool(false);
      setSportsBettingEventCount(0);
      return;
    }
    fetchRankingCounts();
  }, [userId]); // eslint-disable-line

  useEffect(() => {
    if (!userId) return;
    const id = setInterval(async () => {
      try {
        const res = await api.get('/sports-betting/events');
        const ev = res.data?.events;
        if (Array.isArray(ev)) setSportsBettingEventCount(ev.length);
      } catch { /* keep last count */ }
    }, 120000);
    return () => clearInterval(id);
  }, [userId]);

  const fetchTravelStatus = useCallback(async () => {
    try {
      const res = await apiRequestWith429Retry(() => api.get('/travel/status'));
      const data = res.data || {};
      if (data.traveling && data.seconds_remaining > 0) {
        setTravelStatus({ traveling: true, destination: data.destination || data.current_state || '?', seconds_remaining: data.seconds_remaining });
      } else { setTravelStatus(null); }
    } catch { setTravelStatus(null); }
  }, []);

  useEffect(() => {
    const isTravelPage = location.pathname === '/travel';
    const isTraveling = travelStatus?.traveling === true;
    if (!isTravelPage && !isTraveling) { fetchTravelStatus(); return () => {}; }
    fetchTravelStatus();
    const intervalId = setInterval(fetchTravelStatus, 3000);
    return () => clearInterval(intervalId);
  }, [location.pathname, travelStatus?.traveling, fetchTravelStatus]);

  const handleLogout = () => { localStorage.removeItem('token'); window.location.href = '/'; };

  const formatInt = (n) => { const num = Number(n ?? 0); if (Number.isNaN(num)) return '0'; return Math.trunc(num).toLocaleString(); };
  const formatMoney = (n) => { const num = Number(n ?? 0); if (Number.isNaN(num)) return '$0'; return `$${Math.trunc(num).toLocaleString()}`; };
  const formatCompact = (n) => {
    const num = Number(n ?? 0); if (Number.isNaN(num)) return '0';
    const abs = Math.abs(num);
    if (abs >= 1e12) return (num / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
    if (abs >= 1e9) return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (abs >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return Math.trunc(num).toLocaleString();
  };
  const formatMoneyCompact = (n) => {
    const num = Number(n ?? 0); if (Number.isNaN(num)) return '$0';
    const abs = Math.abs(num); const sign = num < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1).replace(/\.0$/, '')}T`;
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return `$${Math.trunc(num).toLocaleString()}`;
  };

  // Staff accounts bypass the email verification requirement.
  const needsEmailVerification = user && user.email_verified === false && !isAdmin && !isModerator;

  const isCategorizedClassic = sidebarLayout === 'categorized_classic';
  const PATH_TO_CATEGORY = isCategorizedClassic
    ? {
        '/account/dashboard': 'information', '/verify-email': 'information', '/account/objectives': 'information', '/account/missions': 'information',
        '/account/profile': 'information', '/account/referral': 'information', '/account/settings': 'information', '/game/stats': 'information', '/account/stats': 'information',
        '/game/users-online': 'information', '/money/property': 'information', '/game/help-desk': 'information', '/game/help-desk-hub': 'information', '/game/leaderboard': 'information',
        '/game/ranking': 'ranking', '/account/prestige': 'ranking',
        '__combat__': 'combat', '/kill/attack': 'combat', '/kill/witness-statements': 'combat', '/kill/attempts': 'combat', '/kill/hitlist': 'combat', '/kill/bodyguards': 'combat', '/kill/armour-weapons': 'combat', '/casino/mini-games/shooting-range': 'combat',
        '/game/travel': 'travel', '/game/states': 'travel', '/my-properties': 'travel', '/money/booze-run': 'travel',
        '__messaging__': 'messaging',
        '/money/bank': 'money', '/money/stocks': 'money', '/money/quick-trade': 'money', '/game/store': 'money', '/game-pass': 'money', '/game/daily-rewards': 'money', '/game/entertainer': 'casino', '/money/distillery': 'money',
        '/cars/garage': 'money', '/cars/buy': 'money', '/cars/sell': 'money', '/money/crack-safe': 'money', '/money/grave-robber': 'money', '/money/lottery': 'money', '/money/loot-box': 'money',
        '/casino': 'casino',
        '/game/family/list': 'other', '/game/dead-alive': 'other', '/account/autorank': 'other',
        '/mini-games': 'minigames',
      }
    : {
        '/account/dashboard': 'information', '/verify-email': 'information', '/account/objectives': 'information', '/account/missions': 'information',
        '/account/inventory': 'information', '/account/profile': 'information', '/account/referral': 'information', '/account/settings': 'information', '/game/stats': 'information', '/account/stats': 'information',
        '/game/users-online': 'information', '/money/property': 'information', '/game/help-desk': 'information', '/game/help-desk-hub': 'information',
        '/game/ranking': 'ranking', '/account/prestige': 'ranking',
        '__combat__': 'combat', '/kill/attack': 'combat', '/kill/witness-statements': 'combat', '/kill/attempts': 'combat', '/kill/hitlist': 'combat', '/kill/bodyguards': 'combat', '/kill/armour-weapons': 'combat', '/casino/mini-games/shooting-range': 'combat',
        '/game/travel': 'travel', '/game/states': 'travel', '/my-properties': 'travel', '/money/booze-run': 'travel',
        '__messaging__': 'messaging',
        '/money/bank': 'money', '/money/stocks': 'money', '/money/quick-trade': 'money', '/game/store': 'money', '/game-pass': 'money', '/game/daily-rewards': 'money', '/game/entertainer': 'casino', '/casino/mini-games/flappy': 'money', '/money/distillery': 'money',
        '/cars/garage': 'money', '/cars/buy': 'money', '/cars/sell': 'money', '/money/crack-safe': 'money', '/money/grave-robber': 'money', '/money/lottery': 'money', '/money/loot-box': 'money', '/game/leaderboard': 'money',
        '/casino': 'casino',
        '/game/family/list': 'other', '/game/dead-alive': 'other', '/account/autorank': 'other',
        '/mini-games': 'minigames',
      };
  const SIDEBAR_CATEGORIES = isCategorizedClassic
    ? [
        { id: 'information', label: 'INFORMATION' }, { id: 'combat', label: 'COMBAT' }, { id: 'travel', label: 'TRAVEL' },
        { id: 'ranking', label: 'RANKING' }, { id: 'messaging', label: 'MESSAGING' }, { id: 'money', label: 'MONEY' }, { id: 'casino', label: 'CASINO' },
        { id: 'other', label: 'OTHER' }, { id: 'minigames', label: 'MINI GAMES' },
      ]
    : [
        { id: 'information', label: 'You' }, { id: 'combat', label: 'Combat' }, { id: 'travel', label: 'Travel' },
        { id: 'ranking', label: 'Ranking' }, { id: 'messaging', label: 'Messages' }, { id: 'money', label: 'Money' }, { id: 'casino', label: 'Casino' },
        { id: 'other', label: 'Other' }, { id: 'minigames', label: 'Mini Games' },
      ];

  const navItems = [
    { path: '/account/dashboard', icon: Home, label: 'Dashboard' },
    ...(needsEmailVerification ? [{ path: '/verify-email', icon: Mail, label: 'Verify email' }] : []),
    { path: '/account/objectives', icon: ListChecks, label: 'Objectives' },
    { path: '/account/missions', icon: Map, label: 'Missions' },
    { path: '/account/inventory', icon: Package, label: 'My Inventory' },
    { path: '/account/profile', icon: User, label: 'Edit Profile' },
    { path: '/account/referral', icon: UserPlus, label: 'Referral & Redeem' },
    { path: '/account/settings', icon: Globe, label: 'IP & Devices' },
    { path: '__combat__', icon: Sword, label: 'Combat' },
    { path: '/game/stats', icon: TrendingUp, label: 'Stats' },
    { path: '/account/stats', icon: BarChart3, label: 'My Stats' },
    { path: '/money/bank', icon: Landmark, label: 'Bank' },
    { path: '/money/lottery', icon: Ticket, label: 'Lottery' },
    { path: '/money/loot-box', icon: Gift, label: 'Loot Box' },
    { path: '/money/stocks', icon: TrendingUp, label: 'Stock Market' },
    { path: '/game/travel', icon: Plane, label: 'Travel' },
    { path: '/game/states', icon: MapPin, label: 'States' },
    { path: '/my-properties', icon: Building2, label: 'My Properties' },
    { path: '/money/booze-run', icon: Wine, label: 'Booze Run' },
    { path: '/money/distillery', icon: Wine, label: 'Distillery' },
    { path: '/money/racket', icon: Building2, label: 'Racket' },
    { path: '/game/users-online', icon: Users, label: 'Users Online', countBadge: usersOnlineCount },
    { path: '__messaging__', icon: MessageSquare, label: 'Forum & inbox' },
    { path: '/game/help-desk', icon: HelpCircle, label: 'Help Desk', badge: helpDeskOpenCount },
    { path: '/game/ranking', icon: Target, label: 'Ranking' },
    { path: '/cars/garage', icon: Car, label: 'Garage' },
    { path: '/cars/buy', icon: ShoppingBag, label: 'Buy Cars' },
    { path: '/cars/sell', icon: DollarSign, label: 'Sell Cars' },
    { path: '/money/property', icon: Building, label: 'Properties' },
    { path: '/mini-games', icon: Gamepad2, label: 'Mini games' },
    { path: '/casino', icon: Dice5, label: 'Casino' },
    { path: '/money/crack-safe', icon: Lock, label: 'Crack the Safe' },
    { path: '/money/grave-robber', icon: Skull, label: 'Grave Robber' },
    { path: '/game/daily-rewards', icon: Gift, label: 'Daily Rewards' },
    ...(user?.is_entertainer ? [{ path: '/game/entertainer', icon: Mic2, label: 'Entertainer Hub' }] : []),
    ...(user?.is_help_desk_operator ? [{ path: '/game/help-desk-hub', icon: Headphones, label: 'Help Desk Hub' }] : []),
    { path: '/game/leaderboard', icon: Trophy, label: 'Leaderboard' },
    { path: '/game/store', icon: ShoppingBag, label: 'Store' },
    { path: '/game-pass', icon: Package, label: 'Game Pass' },
    { path: '/money/quick-trade', icon: ArrowLeftRight, label: 'Quick Trade' },
    { path: '/game/family/list', icon: Building2, label: 'Families' },
    { path: '/game/dead-alive', icon: Skull, label: 'Dead > Alive' },
    { path: '/account/autorank', icon: Bot, label: 'Auto Rank' },
  ];

  const adminNavItems = isAdmin ? [
    { path: '/staffrole/admin/overview', icon: Settings, label: 'Admin Tools' },
    { path: '/staffrole/admin/locked', icon: Lock, label: 'Locked accounts' },
    { path: '/staffrole/admin/users-online', icon: Users, label: 'Users online (live)' },
    { path: '/staffrole/admin/witness-statements', icon: FileText, label: 'Witness statements' },
    { path: '/staffrole/admin/attack-logs', icon: Crosshair, label: 'Attack logs' },
  ] : [];
  const moderatorNavItems = isModerator && !isAdmin ? [
    { path: '/staffrole/admin/overview', icon: Shield, label: 'Moderator tools' },
    { path: '/staffrole/admin/users-online', icon: Users, label: 'Users online (live)' },
    { path: '/staffrole/admin/witness-statements', icon: FileText, label: 'Witness statements' },
    { path: '/staffrole/admin/attack-logs', icon: Crosshair, label: 'Attack logs' },
  ] : [];

  const sidebarBgStyle = { backgroundColor: 'var(--noir-content)' };
  const sidebarActiveStyle = { background: 'var(--noir-raised)', backgroundImage: 'none', borderLeft: '3px solid var(--noir-primary)', color: 'var(--noir-primary)' };
  const sidebarActiveGroupStyle = { background: 'var(--noir-surface)', backgroundImage: 'none', borderLeft: '3px solid var(--noir-primary)', color: 'var(--noir-primary)' };
  const dividerMarginClass = sidebarSpacing === 'compact' ? 'my-0.5' : sidebarSpacing === 'relaxed' ? 'my-1.5' : 'my-1';
  const dividerStyle = sidebarDividerStyle === 'solid'
    ? { height: '1px', backgroundColor: 'rgba(var(--noir-primary-rgb), 0.35)' }
    : { height: 0, borderTop: `1px ${sidebarDividerStyle} rgba(var(--noir-primary-rgb), 0.35)` };
  const categoryHeaderStyle = { backgroundColor: 'rgba(var(--noir-primary-rgb), 0.12)', color: 'var(--noir-primary)' };
  const navDividerEl = (key) => showSidebarDividers ? <div key={key} className={`${dividerMarginClass} mx-1 shrink-0`} style={dividerStyle} aria-hidden="true" /> : null;

  const isRankingPath = (p) => p === '/game/ranking' || (p && (p.startsWith('/game/ranking/') || p.startsWith('/crime/') || p === '/organised-crime' || p === '/account/prestige'));
  const rankingNavBlock = (
    <div className="space-y-0.5">
      <button type="button" data-testid="nav-ranking-group" onClick={() => setRankingOpen((v) => { const next = !v; setNavSectionOpen('ranking', next); return next; })}
        className={`w-full flex items-center gap-1.5 rounded-sm transition-smooth cursor-pointer border-0 bg-transparent ${isRankingPath(location.pathname) ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`}
        style={{ padding: '5px 8px 3px 10px', marginTop: 3 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
        <span style={{ fontFamily: 'var(--font-heading, "Cinzel", serif)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: isRankingPath(location.pathname) ? 'var(--noir-primary)' : 'var(--noir-muted)', whiteSpace: 'nowrap' }}>Ranking</span>
        {!rankingOpen && (rankingCounts.crimes > 0 || rankingCounts.gta > 0) && (
          <span className="bg-emerald-600/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/30 shrink-0">
            {rankingCounts.crimes + rankingCounts.gta}
          </span>
        )}
        {rankingOpen ? <ChevronDown size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" /> : <ChevronRight size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" />}
        <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
      </button>
      {rankingOpen && (
        <div className={`space-y-0 ${styles.sidebarSubmenuBorder}`}>
          <SameRouteAwareLink to="/crime/crimes" onClick={() => setSidebarOpen(false)} onMouseEnter={() => { api.get('/crimes').then((r) => setCrimesPrefetch(r.data)).catch(() => {}); }} onFocus={() => { api.get('/crimes').then((r) => setCrimesPrefetch(r.data)).catch(() => {}); }}
            className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${location.pathname === '/crime/crimes' ? styles.navItemActivePage : styles.sidebarNavLink}`}
            style={location.pathname === '/crime/crimes' ? sidebarActiveStyle : undefined} data-testid="nav-crimes">
            <ListChecks size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
            <span className="uppercase tracking-widest font-heading flex-1">Crimes</span>
            {rankingCounts.crimes > 0 && <span className="bg-emerald-600/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/30">{rankingCounts.crimes}</span>}
          </SameRouteAwareLink>
          {showSidebarDividers && navDividerEl('rd1')}
          <SameRouteAwareLink
            to="/crime/gta"
            onClick={() => setSidebarOpen(false)}
            className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${location.pathname === '/crime/gta' ? styles.navItemActivePage : styles.sidebarNavLink} ${gtaExclusiveInPool ? 'gta-exclusive-flash' : ''}`}
            style={gtaExclusiveInPool
              ? { background: 'var(--noir-raised)', backgroundImage: 'none', borderLeft: '3px solid #a78bfa', color: '#a78bfa' }
              : (location.pathname === '/crime/gta' ? sidebarActiveStyle : undefined)}
            data-testid="nav-gta"
            title={gtaExclusiveInPool ? 'Exclusive car in GTA pool!' : undefined}
          >
            <Car size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
            <span className="uppercase tracking-widest font-heading flex-1">GTA</span>
            {gtaExclusiveInPool && <span className="text-[9px] text-violet-400 font-bold shrink-0" title="Exclusive in pool">★</span>}
            {rankingCounts.gta > 0 && <span className="bg-emerald-600/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/30">{rankingCounts.gta}</span>}
          </SameRouteAwareLink>
          {showSidebarDividers && navDividerEl('rd2')}
          <SameRouteAwareLink to="/crime/jail" onClick={() => setSidebarOpen(false)} className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${location.pathname === '/crime/jail' ? styles.navItemActivePage : styles.sidebarNavLink}`} style={location.pathname === '/crime/jail' ? sidebarActiveStyle : undefined} data-testid="nav-jail">
            <Lock size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
            <span className="uppercase tracking-widest font-heading flex-1">Jail</span>
            {rankingCounts.jail > 0 && <span className="bg-red-600/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-red-500/30">{rankingCounts.jail}</span>}
          </SameRouteAwareLink>
          {showSidebarDividers && navDividerEl('rd3')}
          <SameRouteAwareLink to="/organised-crime" onClick={() => setSidebarOpen(false)} className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${location.pathname === '/organised-crime' ? styles.navItemActivePage : styles.sidebarNavLink}`} style={location.pathname === '/organised-crime' ? sidebarActiveStyle : undefined} data-testid="nav-organised-crime">
            <Users size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
            <span className="uppercase tracking-widest font-heading flex-1">Organised Crime</span>
          </SameRouteAwareLink>
          {showSidebarDividers && navDividerEl('rd4')}
          <SameRouteAwareLink to="/game/ranking/badges" onClick={() => setSidebarOpen(false)} className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${location.pathname === '/game/ranking/badges' ? styles.navItemActivePage : styles.sidebarNavLink}`} style={location.pathname === '/game/ranking/badges' ? sidebarActiveStyle : undefined} data-testid="nav-badges">
            <Award size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
            <span className="uppercase tracking-widest font-heading flex-1">Badges</span>
          </SameRouteAwareLink>
          {showSidebarDividers && navDividerEl('rd5')}
          <SameRouteAwareLink to="/account/prestige" onClick={() => setSidebarOpen(false)} data-testid="nav-prestige"
            className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${location.pathname === '/account/prestige' ? styles.navItemActivePage : styles.sidebarNavLink}`}
            style={location.pathname === '/account/prestige' ? sidebarActiveStyle : undefined}>
            <Trophy size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
            <span className="uppercase tracking-widest font-heading flex-1">Prestige</span>
            {rankProgress?.current_rank >= 11 && (user?.prestige_level ?? 0) < 5 && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" title="You can prestige!" />}
          </SameRouteAwareLink>
        </div>
      )}
    </div>
  );

  const isCombatPath = (p) => ['/kill/attack', '/kill/attempts', '/kill/hitlist', '/kill/bodyguards', '/kill/armour-weapons'].includes(p) || p?.startsWith('/kill/');
  const combatNavBlock = (
    <div className="space-y-0.5">
      <button type="button" data-testid="nav-combat-group" onClick={() => setCombatOpen((v) => { const next = !v; setNavSectionOpen('combat', next); return next; })}
        className={`w-full flex items-center gap-1.5 rounded-sm transition-smooth cursor-pointer border-0 bg-transparent ${isCombatPath(location.pathname) ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`}
        style={{ padding: '5px 8px 3px 10px', marginTop: 3 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
        <span style={{ fontFamily: 'var(--font-heading, "Cinzel", serif)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: isCombatPath(location.pathname) ? 'var(--noir-primary)' : 'var(--noir-muted)', whiteSpace: 'nowrap' }}>Combat</span>
        {combatOpen ? <ChevronDown size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" /> : <ChevronRight size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" />}
        <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
      </button>
      {combatOpen && (
        <div className={`space-y-0 ${styles.sidebarSubmenuBorder}`}>
          {[
            { to: '/kill/attack', label: 'Attack', testId: 'nav-attack', Icon: Sword },
            { to: '/kill/witness-statements', label: 'Witness statements', testId: 'nav-witness-statements', Icon: FileText },
            { to: '/kill/attempts', label: 'Attempts', testId: 'nav-attempts', Icon: Crosshair },
            { to: '/kill/hitlist', label: 'Hitlist', testId: 'nav-hitlist', Icon: ScrollText },
            { to: '/kill/bodyguards', label: 'Bodyguards', testId: 'nav-bodyguards', Icon: Shield },
            { to: '/kill/armour-weapons', label: 'Armoury', testId: 'nav-armoury', Icon: Sword },
          ].map((item, idx) => {
            const isActive = location.pathname === item.to;
            const Icon = item.Icon;
            const wsRed =
              item.to === '/kill/witness-statements'
                ? Math.max(0, Math.floor(Number(user?.witness_nav_red ?? 0)))
                : 0;
            const wsGreen =
              item.to === '/kill/witness-statements'
                ? Math.max(0, Math.floor(Number(user?.witness_nav_green ?? 0)))
                : 0;
            const wsBadge = wsRed > 0 ? wsRed : wsGreen;
            const wsEmerald = wsRed <= 0 && wsGreen > 0;
            return (
              <Fragment key={item.to}>
                {showSidebarDividers && idx > 0 && navDividerEl(`cb${idx}`)}
                <SameRouteAwareLink to={item.to} onClick={() => setSidebarOpen(false)} className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${isActive ? styles.navItemActivePage : styles.sidebarNavLink}`} style={isActive ? sidebarActiveStyle : undefined} data-testid={item.testId}>
                  <Icon size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
                  <span className="uppercase tracking-widest font-heading flex-1">{item.label}</span>
                  {wsBadge > 0 && (
                    wsEmerald ? (
                      <span className="shrink-0 min-w-[16px] h-[16px] rounded-full border border-emerald-500/40 bg-emerald-600/30 text-[9px] font-bold text-emerald-200 flex items-center justify-center px-0.5 tabular-nums font-heading">
                        {wsBadge > 99 ? '99+' : wsBadge}
                      </span>
                    ) : (
                      <span className="shrink-0 min-w-[16px] h-[16px] rounded-full bg-red-600 text-[9px] font-bold text-white flex items-center justify-center px-0.5 tabular-nums font-heading">
                        {wsBadge > 99 ? '99+' : wsBadge}
                      </span>
                    )
                  )}
                </SameRouteAwareLink>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );

  const isMessagingPath = (p) => p === '/social/forum' || p === '/social/inbox' || p === '/social/image-host';
  const messagingNavBlock = (() => {
    const forumTab = new URLSearchParams(location.search || '').get('tab') || '';
    const SUB_FORUM_TABS = ['entertainer', 'designer', 'crew_oc', 'game_ideas'];
    const rows = [
      { key: 'forum-general', kind: 'forum', forumTab: null, to: '/social/forum', label: 'Forum', testId: 'nav-forum-general', Icon: MessageSquare },
      { key: 'forum-entertainer', kind: 'forum', forumTab: 'entertainer', to: { pathname: '/social/forum', search: '?tab=entertainer' }, label: 'Entertainer Forum', testId: 'nav-forum-entertainer', Icon: Mic2 },
      { key: 'forum-designer', kind: 'forum', forumTab: 'designer', to: { pathname: '/social/forum', search: '?tab=designer' }, label: 'Designer forum', testId: 'nav-forum-designer', Icon: Palette },
      { key: 'forum-game-ideas', kind: 'forum', forumTab: 'game_ideas', to: { pathname: '/social/forum', search: '?tab=game_ideas' }, label: 'Game Ideas', testId: 'nav-forum-game-ideas', Icon: Lightbulb },
      { key: 'forum-crew-oc', kind: 'forum', forumTab: 'crew_oc', to: { pathname: '/social/forum', search: '?tab=crew_oc' }, label: 'Crew OC', testId: 'nav-forum-crew-oc', Icon: Users },
      { key: 'inbox', kind: 'inbox', to: '/social/inbox', label: 'Inbox', testId: 'nav-inbox', Icon: Mail },
      { key: 'image-host', kind: 'image', to: '/social/image-host', label: 'Image host', testId: 'nav-image-host', Icon: Image },
    ];
    return (
      <div className="space-y-0.5">
        <button
          type="button"
          data-testid="nav-messaging-menu-group"
          onClick={() => setMessagingMenuOpen((v) => { const next = !v; setNavSectionOpen('messaging-menu', next); return next; })}
          className={`w-full flex items-center gap-1.5 rounded-sm transition-smooth cursor-pointer border-0 bg-transparent ${isMessagingPath(location.pathname) ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`}
          style={{ padding: '5px 8px 3px 10px', marginTop: 3 }}
        >
          <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
          <span
            style={{
              fontFamily: 'var(--font-heading, "Cinzel", serif)',
              fontSize: 8,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: isMessagingPath(location.pathname) ? 'var(--noir-primary)' : 'var(--noir-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            Forum & inbox
          </span>
          {!messagingMenuOpen && unreadCount > 0 && (
            <span className="shrink-0 rounded border border-red-500/30 bg-red-600/20 px-1.5 py-0.5 font-heading text-[10px] font-bold text-red-400">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          {messagingMenuOpen ? <ChevronDown size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" /> : <ChevronRight size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" />}
          <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
        </button>
        {messagingMenuOpen && (
          <div className={`space-y-0 ${styles.sidebarSubmenuBorder}`}>
            {rows.map((row, idx) => {
              let isActive = false;
              if (row.kind === 'forum') {
                if (row.forumTab == null) {
                  isActive = location.pathname === '/social/forum' && !SUB_FORUM_TABS.includes(forumTab);
                } else {
                  isActive = location.pathname === '/social/forum' && forumTab === row.forumTab;
                }
              } else if (row.kind === 'inbox') {
                isActive = location.pathname === '/social/inbox';
              } else {
                isActive = location.pathname === '/social/image-host';
              }
              const IconComp = row.Icon;
              return (
                <Fragment key={row.key}>
                  {showSidebarDividers && idx > 0 && navDividerEl(`msg${idx}`)}
                  <SameRouteAwareLink
                    to={row.to}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${isActive ? styles.navItemActivePage : styles.sidebarNavLink}`}
                    style={isActive ? sidebarActiveStyle : undefined}
                    data-testid={row.testId}
                  >
                    <IconComp size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
                    <span className="uppercase tracking-widest font-heading flex-1">{row.label}</span>
                    {row.kind === 'inbox' && unreadCount > 0 && (
                      <span className="shrink-0 rounded border border-red-500/30 bg-red-600/20 px-1.5 py-0.5 font-heading text-[10px] font-bold text-red-400">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    )}
                  </SameRouteAwareLink>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    );
  })();

  const isCasinoPath = (p) => p === '/casino' || (p && (p.startsWith('/casino/') || p === '/sports-betting' || p === '/my-properties'));
  const casinoNavBlock = (
    <div className="space-y-0.5">
      <button type="button" data-testid="nav-casino-group" onClick={() => setCasinoOpen((v) => { const next = !v; setNavSectionOpen('casino', next); return next; })}
        className={`w-full flex items-center gap-1.5 rounded-sm transition-smooth cursor-pointer border-0 bg-transparent ${isCasinoPath(location.pathname) ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`}
        style={{ padding: '5px 8px 3px 10px', marginTop: 3 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
        <span style={{ fontFamily: 'var(--font-heading, "Cinzel", serif)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: isCasinoPath(location.pathname) ? 'var(--noir-primary)' : 'var(--noir-muted)', whiteSpace: 'nowrap' }}>Casino</span>
        {casinoOpen ? <ChevronDown size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" /> : <ChevronRight size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" />}
        <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
      </button>
      {casinoOpen && (
        <div className={`space-y-0 ${styles.sidebarSubmenuBorder}`}>
          {[
            { to: '/casino/dice', label: 'Dice', testId: 'nav-dice', Icon: Dice5 },
            { to: '/casino/rlt', label: 'Roulette', testId: 'nav-roulette', Icon: CircleDot },
            { to: '/casino/blackjack', label: 'Blackjack', testId: 'nav-blackjack', Icon: Spade },
            { to: '/casino/horseracing', label: 'Horse Racing', testId: 'nav-horseracing', Icon: Flag },
            { to: '/casino/slots', label: 'Slots', testId: 'nav-slots', Icon: SquareStack },
            { to: '/casino/keno', label: 'Keno', testId: 'nav-keno', Icon: Grid3x3 },
            { to: '/casino/videopoker', label: 'Video Poker', testId: 'nav-videopoker', Icon: Video },
            { to: '/casino/mdg', label: 'MDG', testId: 'nav-mdg', Icon: Sparkles },
            { to: '/casino/mp-blackjack', label: 'MP Blackjack', testId: 'nav-mp-blackjack', matchPrefix: true, Icon: Users },
            { to: '/casino/mp-poker', label: 'Poker', testId: 'nav-mp-poker', matchPrefix: true, Icon: Crown },
            { to: '/sports-betting', label: 'Sports Betting', testId: 'nav-sports-betting', Icon: LineChart },
            { to: '/my-properties', label: 'My Properties', testId: 'nav-my-properties', Icon: Building2 },
          ].map((item, idx) => {
            const isActive = item.matchPrefix ? (location.pathname === item.to || location.pathname.startsWith(item.to + '/')) : location.pathname === item.to;
            const IconComp = item.Icon;
            return (
              <Fragment key={item.to}>
                {showSidebarDividers && idx > 0 && navDividerEl(`cd${idx}`)}
                <SameRouteAwareLink to={item.to} onClick={() => setSidebarOpen(false)} className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${isActive ? styles.navItemActivePage : styles.sidebarNavLink}`} style={isActive ? sidebarActiveStyle : undefined} data-testid={item.testId}>
                  {IconComp && <IconComp size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />}
                  <span className="uppercase tracking-widest font-heading flex-1">{item.label}</span>
                  {item.to === '/sports-betting' && sportsBettingEventCount > 0 && (
                    <span
                      className="shrink-0 rounded border border-emerald-500/30 bg-emerald-600/20 px-1.5 py-0.5 font-heading text-[10px] font-bold tabular-nums text-emerald-400"
                      title="Listed sports book events"
                    >
                      {sportsBettingEventCount > 99 ? '99+' : sportsBettingEventCount}
                    </span>
                  )}
                </SameRouteAwareLink>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );

  const isMiniGamesPath = (p) => p && p.startsWith('/casino/mini-games/');
  const miniGamesNavBlock = (
    <div className="space-y-0.5">
      <button type="button" data-testid="nav-minigames-group" onClick={() => setMiniGamesOpen((v) => { const next = !v; setNavSectionOpen('minigames', next); return next; })}
        className={`w-full flex items-center gap-1.5 rounded-sm transition-smooth cursor-pointer border-0 bg-transparent ${isMiniGamesPath(location.pathname) ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`}
        style={{ padding: '5px 8px 3px 10px', marginTop: 3 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
        <span style={{ fontFamily: 'var(--font-heading, "Cinzel", serif)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: isMiniGamesPath(location.pathname) ? 'var(--noir-primary)' : 'var(--noir-muted)', whiteSpace: 'nowrap' }}>Mini games</span>
        {miniGamesOpen ? <ChevronDown size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" /> : <ChevronRight size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" />}
        <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
      </button>
      {miniGamesOpen && (
        <div className={`space-y-0 ${styles.sidebarSubmenuBorder}`}>
          {[
            { to: '/casino/mini-games/racing', label: 'Racing', testId: 'nav-racing', Icon: Car },
            { to: '/casino/mini-games/boxing', label: 'Boxing', testId: 'nav-boxing', matchPrefix: true, Icon: Activity },
            { to: '/casino/mini-games/flappy', label: 'Flappy Gangster', testId: 'nav-flappygangster', Icon: Gamepad2 },
            { to: '/casino/mini-games/shooting-range', label: 'Shooting range', testId: 'nav-shooting-range', matchPrefix: true, Icon: Crosshair },
            { to: '/casino/mini-games/snake', label: 'Package Run', testId: 'nav-snake', Icon: Package },
            { to: '/casino/mini-games/minesweeper', label: 'Minefield', testId: 'nav-minesweeper', Icon: LayoutGrid },
            { to: '/casino/mini-games/battleships', label: 'Rum Runner', testId: 'nav-battleships', Icon: Wine },
            { to: '/casino/mini-games/the-getaway', label: 'The Getaway', testId: 'nav-the-getaway', Icon: Plane },
            { to: '/casino/mini-games/whack-a-copper', label: 'Whack-A-Copper', testId: 'nav-whack-a-copper', Icon: Zap },
            { to: '/casino/mini-games/famiglia', label: 'Famiglia', testId: 'nav-famiglia', Icon: Landmark },
            { to: '/casino/mini-games/8-ball-pool', label: '8-Ball Pool', testId: 'nav-8-ball-pool', Icon: CircleDot },
            { to: '/casino/mini-games/leaderboard', label: 'Leaderboard', testId: 'nav-minigames-leaderboard', Icon: Trophy },
          ].map((item, idx) => {
            const IconComp = item.Icon;
            const isActive = item.matchPrefix ? (location.pathname === item.to || location.pathname.startsWith(item.to + '/')) : location.pathname === item.to;
            return (
              <Fragment key={item.to}>
                {showSidebarDividers && idx > 0 && navDividerEl(`mg${idx}`)}
                <SameRouteAwareLink to={item.to} onClick={() => setSidebarOpen(false)} className={`flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-sm transition-smooth text-[10px] ${isActive ? styles.navItemActivePage : styles.sidebarNavLink}`} style={isActive ? sidebarActiveStyle : undefined} data-testid={item.testId}>
                  {IconComp && <IconComp size={13} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />}
                  <span className="uppercase tracking-widest font-heading flex-1">{item.label}</span>
                </SameRouteAwareLink>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderNavItem = (item, showDivider, compact = false) => {
    const itemKey = item.navKey || item.path;
    const navDivider = showDivider ? navDividerEl(`div-${itemKey}`) : null;
    if (item.path === '/game/ranking') return <Fragment key="nav-ranking-group">{navDivider}{rankingNavBlock}</Fragment>;
    if (item.path === '__combat__') return <Fragment key="nav-combat-group">{navDivider}{combatNavBlock}</Fragment>;
    if (item.path === '__messaging__') return <Fragment key="nav-messaging-group">{navDivider}{messagingNavBlock}</Fragment>;
    if (item.path === '/casino') return <Fragment key="nav-casino-group">{navDivider}{casinoNavBlock}</Fragment>;
    if (item.path === '/mini-games') return <Fragment key="nav-minigames-group">{navDivider}{miniGamesNavBlock}</Fragment>;
    const Icon = item.icon;
    const isActive = location.pathname === item.path;
    const isFamiliesAtWar = item.path === '/game/family/list' && atWar;
    const sizeClass = compact ? 'py-0.5 min-h-[22px]' : 'py-2 md:py-1 min-h-[44px] md:min-h-[26px]';
    return (
      <Fragment key={itemKey}>
        {navDivider}
        <SameRouteAwareLink to={item.path} data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`} data-at-war={atWar && item.path === '/game/family/list' ? 'true' : undefined}
          className={`flex items-center gap-1 px-2 ${sizeClass} rounded-sm transition-smooth touch-manipulation ${isFamiliesAtWar ? (isActive ? 'bg-red-500/20 text-red-400 border-l-2 border-red-500' : 'text-red-400 hover:bg-red-500/10') : (isActive ? styles.navItemActivePage : styles.sidebarNavLink)}`}
          style={isFamiliesAtWar ? { color: '#f87171' } : isActive ? sidebarActiveStyle : undefined}
          onClick={() => setSidebarOpen(false)}
          onMouseEnter={item.path === '/game/leaderboard' ? prefetchMainLeaderboard : undefined}
          onFocus={item.path === '/game/leaderboard' ? prefetchMainLeaderboard : undefined}
        >
          <Icon size={13} className="shrink-0" style={isFamiliesAtWar ? { color: '#f87171' } : { color: 'var(--noir-primary)' }} />
          <span className="uppercase tracking-widest text-[10px] font-heading flex-1 truncate">{item.label}</span>
          {isFamiliesAtWar && (
            <span
              className="text-[8px] font-heading font-bold uppercase tracking-tight text-red-400 bg-red-500/15 border border-red-500/35 rounded px-1 py-0.5 shrink-0 leading-none"
              title="Your family has an active vendetta"
            >
              At war
            </span>
          )}
          {typeof item.countBadge === 'number' && (
            <span
              className="bg-emerald-600/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/30 tabular-nums shrink-0"
              title="Players online"
            >
              {item.countBadge.toLocaleString()}
            </span>
          )}
          {item.badge > 0 && <span className="bg-red-600/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-red-500/30">{item.badge > 9 ? '9+' : item.badge}</span>}
        </SameRouteAwareLink>
      </Fragment>
    );
  };

  // ── IMPROVEMENT 1: Top bar stat renderers ──────────────────────────────────
  const renderTopBarStat = (statId, { topBarChipStyle, topBarChipMinHeight, topBarIconSizeEffectiveMobile, topBarTextClass, rankBarWidthPx, rankColMinWidthPx, chipWidthScale, chipHeightScale, isMobileViewport: isMobile }) => {
    const casinoProfit = user?.casino_profit ?? 0;
    const propertyProfit = user?.property_profit ?? 0;
    const chipBase = `flex items-center gap-1 rounded-md shrink-0 touch-manipulation transition-colors duration-150 border-0 bg-white/[0.04] hover:bg-white/[0.08]${isMobile ? '' : ' cursor-grab active:cursor-grabbing'}`;

    if (statId === 'rank') {
      const pct = rankProgress ? Number(rankProgress.rank_points_progress) : 0;
      const current = rankProgress ? (Number(rankProgress.rank_points_current) || 0) : 0;
      const needed = rankProgress ? (Number(rankProgress.rank_points_needed) || 0) : 0;
      const total = current + needed;
      const progress = rankProgress
        ? ((typeof pct === 'number' && !Number.isNaN(pct) && pct > 0) ? Math.min(100, Math.max(0, pct)) : (total > 0 ? Math.min(100, (current / total) * 100) : needed === 0 ? 100 : 0))
        : 0;
      const hasPremiumBar = !!user?.premium_rank_bar;
      const progressLabel = rankProgress ? (hasPremiumBar ? progress.toFixed(2) : progress.toFixed(0)) : '—';
      const rankName = rankProgress?.current_rank_name ?? 'Rank';
      const pk = rankProgress?.progress_kind;
      const needR = Number(rankProgress?.rank_points_needed) || 0;
      const tipExtra = pk === 'prestige' && needR > 0 ? ` — ${needR.toLocaleString()} RP to next prestige` : '';
      return (
        <div className={`${chipBase} gap-1 sm:gap-1.5 min-w-0`} style={{ ...topBarChipStyle, minHeight: topBarChipMinHeight }} title={rankProgress ? `${rankName}: ${progressLabel}%${tipExtra}` : 'Rank progress'}>
          <TrendingUp size={topBarIconSizeEffectiveMobile} className="text-primary shrink-0" aria-hidden />
          {/* IMPROVEMENT 1: rank bar always visible (not just md+) */}
          <div className="flex flex-col flex-1 shrink-0 min-w-0" style={{ minWidth: isMobile ? 28 : rankColMinWidthPx }}>
            <span className="hidden sm:inline text-[10px] text-mutedForeground leading-none font-heading truncate">{rankName}</span>
            <div className="shrink-0" style={{ width: isMobile ? Math.max(20, rankBarWidthPx) : rankBarWidthPx, position: 'relative', height: Math.max(4, Math.round(6 * chipHeightScale)), backgroundColor: 'var(--noir-raised)', borderRadius: 9999, overflow: 'hidden', marginTop: 2 }}>
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${progress}%`, minWidth: progress > 0 ? 2 : 0, background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))', borderRadius: 9999, transition: 'width 0.3s ease' }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} />
            </div>
          </div>
          <span className={`${topBarTextClass} text-primary font-heading shrink-0 tabular-nums text-right`} style={{ minWidth: Math.round(24 * chipWidthScale) }}>{progressLabel}{rankProgress ? '%' : ''}</span>
        </div>
      );
    }

    if (statId === 'health') {
      const healthVal = Number(user.health);
      const healthStr = Number.isFinite(healthVal) ? Math.max(0, Math.min(100, Math.round(healthVal))).toString() : '100';
      const healthNum = parseInt(healthStr, 10) || 100;
      // IMPROVEMENT 1: colour-coded health
      const healthColor = healthNum > 50 ? 'text-emerald-400' : healthNum > 25 ? 'text-amber-400' : 'text-red-400';
      const heartColor = healthNum > 50 ? '#34d399' : healthNum > 25 ? '#fbbf24' : '#f87171';
      return (
        <div className={`${chipBase} flex min-w-0`} style={{
          ...topBarChipStyle, minHeight: topBarChipMinHeight,
          ...(isMobile && healthNum <= 50 ? { backgroundColor: healthNum <= 25 ? 'rgba(248,113,113,0.12)' : 'rgba(251,191,36,0.1)' } : {}),
          ...(!isMobile && healthNum <= 25 ? { boxShadow: 'inset 0 0 0 1px rgba(248,113,113,0.22)' } : !isMobile && healthNum <= 50 ? { boxShadow: 'inset 0 0 0 1px rgba(251,191,36,0.18)' } : {}),
        }} title={`Health: ${healthStr}%`}>
          <Heart size={topBarIconSizeEffectiveMobile} style={{ color: heartColor, flexShrink: 0 }} aria-hidden />
          <span className={`font-heading ${topBarTextClass} ${healthColor} tabular-nums truncate max-w-[4rem]`} data-testid="topbar-health">{healthStr}%</span>
        </div>
      );
    }

    if (statId === 'bullets') {
      const bulletsStr = formatInt(user.bullets);
      return (
        <div className={`${chipBase} flex min-w-0`} style={{ ...topBarChipStyle, minHeight: topBarChipMinHeight }} title={`Bullets: ${bulletsStr}`}>
          <Crosshair size={topBarIconSizeEffectiveMobile} className="text-red-400 shrink-0" aria-hidden />
          <span className={`font-heading ${topBarTextClass} text-foreground tabular-nums truncate max-w-[6rem]`} data-testid="topbar-bullets">{bulletsStr}</span>
        </div>
      );
    }

    if (statId === 'kills') {
      const killsStr = formatInt(user.total_kills);
      return (
        <div className={`${chipBase} flex min-w-0`} style={{ ...topBarChipStyle, minHeight: topBarChipMinHeight }} title={`Kills: ${killsStr}`}>
          <Skull size={topBarIconSizeEffectiveMobile} className="text-red-400 shrink-0" aria-hidden />
          <span className={`font-heading ${topBarTextClass} text-foreground tabular-nums min-w-[1.5rem] text-right`} data-testid="topbar-kills">{killsStr}</span>
        </div>
      );
    }

    if (statId === 'money') {
      const moneyFull = formatMoney(user.money);
      const moneyLabel = Math.trunc(Number(user.money ?? 0)).toLocaleString();
      return (
        <div className={`${chipBase} min-w-0`} style={{ ...topBarChipStyle, minHeight: topBarChipMinHeight }} title={`Cash: ${moneyFull}`}>
          <DollarSign size={topBarIconSizeEffectiveMobile} className="text-primary shrink-0" aria-hidden />
          <span className={`font-heading ${topBarTextClass} text-primary tabular-nums truncate max-w-[12rem]`} data-testid="topbar-money">{moneyLabel}</span>
        </div>
      );
    }

    if (statId === 'points') {
      const pointsFull = formatInt(user.points);
      const pointsCompact = formatCompact(user.points);
      const useCompactDesktop = pointsFull.length > 12;
      return (
        <div className={`${chipBase} min-w-0`} style={{ ...topBarChipStyle, minHeight: topBarChipMinHeight }} title={`Premium Points: ${pointsFull}`}>
          <Zap size={topBarIconSizeEffectiveMobile} className="text-primary shrink-0" aria-hidden />
          <span className={`font-heading ${topBarTextClass} text-foreground md:hidden tabular-nums`} data-testid="topbar-points">{pointsFull}</span>
          <span className={`font-heading text-xs text-foreground hidden md:inline tabular-nums ${useCompactDesktop ? '' : 'truncate max-w-[6rem]'}`} data-testid="topbar-points-full">{useCompactDesktop ? `${pointsCompact} pts` : pointsFull}</span>
        </div>
      );
    }

    if (statId === 'respect_points') {
      const respectFull = formatInt(user.respect_points ?? 0);
      const respectCompact = formatCompact(user.respect_points ?? 0);
      const useCompactDesktop = respectFull.length > 12;
      return (
        <div className={`${chipBase} min-w-0`} style={{ ...topBarChipStyle, minHeight: topBarChipMinHeight }} title={`Respect: ${respectFull}`}>
          <Trophy size={topBarIconSizeEffectiveMobile} className="text-primary shrink-0" aria-hidden />
          <span className={`font-heading ${topBarTextClass} text-foreground md:hidden tabular-nums`} data-testid="topbar-respect">{respectFull}</span>
          <span className={`font-heading text-xs text-foreground hidden md:inline tabular-nums ${useCompactDesktop ? '' : 'truncate max-w-[6rem]'}`} data-testid="topbar-respect-full">{useCompactDesktop ? `${respectCompact} resp` : respectFull}</span>
        </div>
      );
    }

    if (statId === 'property') {
      if (!hasCasinoOrProperty) return null;
      const casinoNum = Number(casinoProfit);
      const propertyNum = Number(propertyProfit);
      const casinoStr = `$${(Number.isFinite(casinoNum) ? casinoNum : 0).toLocaleString()}`;
      const propertyStr = `${(Number.isFinite(propertyNum) ? propertyNum : 0).toLocaleString()} pts`;
      const casinoShort = formatMoneyCompact(casinoProfit);
      const propertyShort = formatCompact(propertyProfit) + ' pts';
      const casinoColor = (Number.isFinite(casinoNum) ? casinoNum : 0) >= 0 ? 'text-emerald-500' : 'text-red-400';
      const propertyColor = (Number.isFinite(propertyNum) ? propertyNum : 0) >= 0 ? 'text-emerald-500' : 'text-red-400';
      const useCompactOnDesktop = casinoStr.length > 11 || propertyStr.length > 14;
      return (
        <div className={`${chipBase} min-w-0`} style={{ ...topBarChipStyle, minHeight: topBarChipMinHeight }} title={`Casino ${casinoStr} · Property ${propertyStr}`}>
          <Building2 size={topBarIconSizeEffectiveMobile} className="text-emerald-400 shrink-0" aria-hidden />
          <span className={`font-heading ${topBarTextClass} text-foreground whitespace-nowrap tabular-nums min-w-0 flex items-center gap-0.5`}>
            <span className="text-mutedForeground md:inline hidden shrink-0">Casino</span>
            <span className="text-mutedForeground md:hidden shrink-0">C</span>
            <span className={`${casinoColor} tabular-nums`}><span className="md:hidden">{casinoShort}</span><span className="hidden md:inline">{useCompactOnDesktop ? casinoShort : casinoStr}</span></span>
            <span className="text-mutedForeground shrink-0">·</span>
            <span className="text-mutedForeground md:inline hidden shrink-0">Property</span>
            <span className="text-mutedForeground md:hidden shrink-0">P</span>
            <span className={`${propertyColor} tabular-nums`}><span className="md:hidden">{propertyShort}</span><span className="hidden md:inline">{useCompactOnDesktop ? propertyShort : propertyStr}</span></span>
          </span>
        </div>
      );
    }

    return null;
  };

  if (user?.is_dead) {
    return <DeathScreen user={user} onLogout={handleLogout} />;
  }

  return (
    <div className={`min-h-screen ${styles.page} ${styles.themeGangsterModern} transition-colors`}>
      <style>{`
        @keyframes gtaExclusivePulse {
          0%, 100% { border-left-color: #a78bfa; color: #a78bfa; }
          50% { border-left-color: #c4b5fd; color: #e9d5ff; }
        }
        .gta-exclusive-flash {
          animation: gtaExclusivePulse 1.6s ease-in-out infinite;
        }
        @keyframes flash-marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        .flash-marquee {
          display: inline-block;
          white-space: nowrap;
          animation: flash-marquee 15s linear infinite;
        }
        @media (min-width: 768px) {
          .flash-marquee { animation: none; }
        }
      `}</style>
      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <div
        data-layout="sidebar"
        className={`fixed left-0 top-0 h-full ${themeVariant === 'modern' ? 'w-40' : 'w-48'} ${styles.sidebar} z-50 transform transition-transform duration-300 ${mobileNavStyle === 'bottom' ? 'hidden md:translate-x-0 md:block' : `${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}`}
        style={sidebarBgStyle}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className={`h-12 flex items-center px-2.5 border-b ${styles.borderGoldLight} shrink-0`}>
            <div className="flex items-center gap-1.5 w-full">
              <div className="w-4 h-px shrink-0" style={{ backgroundColor: 'var(--noir-accent-line)', opacity: 0.5 }} />
              <h1 className={`text-base font-heading font-bold tracking-widest truncate ${styles.sidebarHeaderTitle}`} data-testid="app-logo">MAFIA WARS</h1>
              {autoRankPrefs.auto_rank_enabled && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="shrink-0 flex items-center justify-center" style={{ color: 'var(--noir-primary)' }} aria-label="Auto Rank on">
                        <Bot size={16} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[200px]">
                      <p className="font-heading text-xs">Auto Rank is on</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <div className="flex-1 min-w-0 h-px" style={{ backgroundColor: 'var(--noir-accent-line)', opacity: 0.5 }} />
            </div>
          </div>

          {/* Navigation */}
          <nav className={`flex-1 overflow-y-auto px-2 py-1 ${styles.sidebarNav} min-h-0`}>
            <div className="space-y-0">
              {(sidebarLayout === 'categorized' || sidebarLayout === 'categorized_classic') ? (
                <>
                  {SIDEBAR_CATEGORIES.map((cat) => {
                    let items = navItems.filter((i) => (PATH_TO_CATEGORY[i.path] || 'other') === cat.id);
                    if (cat.id === 'money' && items.length) {
                      items = [...items].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
                    }
                    if (!items.length) return null;
                    const useClassicHeader = sidebarLayout === 'categorized_classic';
                    const isBlockCategory = ['combat', 'ranking', 'messaging', 'minigames', 'casino'].includes(cat.id);
                    const open = isBlockCategory ? true : (categoryOpen[cat.id] !== false);
                    const setOpen = (v) => setCategoryOpen((prev) => ({ ...prev, [cat.id]: typeof v === 'function' ? v(prev[cat.id]) : v }));
                    return (
                      <Fragment key={cat.id}>
                        {isBlockCategory ? null : (
                          <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1.5 rounded-sm transition-smooth cursor-pointer border-0 bg-transparent opacity-90 hover:opacity-100" style={{ padding: '5px 8px 3px 10px', marginTop: 3 }} aria-expanded={open}>
                            <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
                            <span style={{ fontFamily: 'var(--font-heading, "Cinzel", serif)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--noir-muted)', whiteSpace: 'nowrap' }}>{cat.label}</span>
                            {open ? <ChevronDown size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" /> : <ChevronRight size={9} style={{ color: 'var(--noir-primary)', opacity: 0.5 }} className="shrink-0" />}
                            <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.18)' }} />
                          </button>
                        )}
                        {open && (
                          <>
                            {items.map((item, idx) => renderNavItem(item, idx > 0, true))}
                          </>
                        )}
                      </Fragment>
                    );
                  })}
                </>
              ) : (
                <>
                  {navItems.map((item, index) => renderNavItem(item, index > 0))}
                </>
              )}

              {/* Admin */}
              {adminNavItems.length > 0 && (
                <>
                  {showSidebarDividers && <div className={`${dividerMarginClass} mx-1 shrink-0`} style={dividerStyle} aria-hidden="true" />}
                  {adminNavItems.map((item) => {
                    const Icon = item.icon; const isActive = location.pathname === item.path;
                    return (
                      <SameRouteAwareLink key={item.path} to={item.path} data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                        className={`flex items-center gap-1 px-2 py-1 rounded-sm transition-smooth border-t border-primary/20 mt-1 pt-1 ${isActive ? 'bg-red-600/20 text-red-400 border-l-2 border-red-500' : 'text-red-400 hover:bg-red-500/10'}`}
                        onClick={() => setSidebarOpen(false)}>
                        <Icon size={14} /><span className="uppercase tracking-widest text-xs font-heading">{item.label}</span>
                      </SameRouteAwareLink>
                    );
                  })}
                </>
              )}
              {/* Moderator */}
              {moderatorNavItems.length > 0 && (
                <>
                  {showSidebarDividers && <div className={`${dividerMarginClass} mx-1 shrink-0`} style={dividerStyle} aria-hidden="true" />}
                  {moderatorNavItems.map((item) => {
                    const Icon = item.icon; const isActive = location.pathname === item.path;
                    return (
                      <SameRouteAwareLink key={item.path} to={item.path} data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                        className={`flex items-center gap-1 px-2 py-1 rounded-sm transition-smooth border-t border-primary/20 mt-1 pt-1 ${isActive ? 'bg-primary/20 border-l-2 border-primary text-primary' : 'text-primary hover:bg-primary/10'}`}
                        onClick={() => setSidebarOpen(false)}>
                        <Icon size={14} /><span className="uppercase tracking-widest text-xs font-heading">{item.label}</span>
                      </SameRouteAwareLink>
                    );
                  })}
                </>
              )}
              {hasAdminEmail && !isAdmin && (
                <button type="button" onClick={() => { promoteToAdmin(); setSidebarOpen(false); }} className="flex items-center gap-1 px-2 py-1 rounded-sm transition-smooth border-t border-primary/20 mt-1 pt-1 w-full text-left text-amber-400 hover:bg-amber-500/10 text-[10px]">
                  <Shield size={14} /><span className="uppercase tracking-widest text-xs font-heading">Use admin powers</span>
                </button>
              )}
            </div>
          </nav>

          {/* Theme & Logout */}
          {user && (
            <div className={`px-2 py-1 border-t ${styles.borderGoldLight} shrink-0 space-y-0.5`}>
              <button type="button" onClick={() => setThemePickerOpen(true)}
              className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded-sm transition-smooth uppercase tracking-widest text-[10px] font-heading font-bold border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                data-testid="theme-picker-button">
                <Palette size={12} />Theme
              </button>
              <button onClick={handleLogout} data-testid="logout-button"
                className="w-full flex items-center justify-center gap-1 px-2 py-1 bg-gradient-to-r from-red-700 to-red-900 text-white border border-red-600/50 rounded-sm hover:opacity-90 transition-smooth uppercase tracking-widest text-[10px] font-heading font-bold">
                <LogOut size={12} />Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && mobileNavStyle !== 'bottom' && (
        <div className={`fixed inset-0 bg-black/50 z-40 ${!isLandscapeCompactLayout ? 'md:hidden' : ''}`} onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <div data-layout="topbar" className={`fixed top-0 right-0 left-0 safe-area-pt ${!isLandscapeCompactLayout ? (themeVariant === 'modern' ? 'md:left-40' : 'md:left-48') : ''} min-h-[36px] md:min-h-0 md:h-12 ${styles.topBar} backdrop-blur-md z-30 flex flex-col md:flex-row md:items-center px-2 py-1 md:px-3 md:py-0 gap-1 md:gap-2 ${user && mobileStatsDisplay === 'right_sidebar' && !isLandscapeCompactLayout ? (themeVariant === 'modern' ? 'md:right-60' : 'md:right-52') : ''}`}>
        <div className="flex items-center gap-1 md:gap-2 flex-1 min-w-0 overflow-hidden md:justify-end">
          {mobileNavStyle !== 'bottom' && (
            <button onClick={() => setSidebarOpen(!sidebarOpen)} data-testid="mobile-menu-toggle"
              className={`${!isLandscapeCompactLayout ? 'md:hidden' : ''} shrink-0 min-h-[34px] min-w-[34px] flex items-center justify-center -m-1 rounded-lg hover:bg-white/[0.06] active:bg-white/[0.1] transition-colors order-last`}
              style={{ color: 'var(--noir-primary)' }} aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}>
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          )}

          {/* Flash news — show on desktop; on mobile hide when top bar stats selected (moved to bottom). */}
          <div className={`${(!isMobileViewport || (mobileNavStyle === 'bottom' && mobileStatsDisplay !== 'top_bar')) ? 'flex' : 'hidden'} items-center flex-1 min-w-0 max-w-sm md:max-w-md`}>
            {flashNews.length > 0 && (
              <div className="flex items-center gap-1 md:gap-2 min-w-0 w-full min-h-[1.5rem] md:min-h-[2rem] rounded px-1.5 py-0.5 md:px-2 md:py-1 border border-primary/15 bg-primary/5">
                <Newspaper className="shrink-0 text-primary/70 self-center w-3 h-3 md:w-3.5 md:h-3.5" aria-hidden />
                <div className="flex items-baseline gap-1 min-w-0 flex-1 overflow-hidden">
                  <span className="flash-marquee text-[10px] md:text-xs text-mutedForeground md:truncate font-heading leading-none min-w-0" title={flashNews[flashIndex]?.message}>{flashNews[flashIndex]?.message}</span>
                  {flashNews.length > 1 && <span className="text-[9px] md:text-[10px] text-primary/50 shrink-0 font-heading leading-none tabular-nums">{flashIndex + 1}/{flashNews.length}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Casino & property profit — show on mobile when bottom bar, but not when top bar stats selected */}
          {isMobileViewport && mobileNavStyle === 'bottom' && mobileStatsDisplay !== 'top_bar' && user && hasCasinoOrProperty && (
            <SameRouteAwareLink
              to="/my-properties"
              className="flex items-center gap-1 min-h-[1.5rem] rounded px-1.5 py-0.5 border border-primary/15 bg-primary/5 shrink-0 hover:bg-primary/10 hover:border-primary/25 transition-colors"
            >
              <Building2 className="shrink-0 text-primary/70 self-center w-3 h-3" aria-hidden />
              <span className={`font-heading text-[10px] tabular-nums ${(user.casino_profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>C {formatMoneyCompact(user.casino_profit ?? 0)}</span>
              <span className="text-primary/50 text-[9px]">·</span>
              <span className="font-heading text-[10px] text-mutedForeground tabular-nums">P {formatCompact(user.property_profit ?? 0)} pts</span>
            </SameRouteAwareLink>
          )}

          {/* IMPROVEMENT 1: Improved travel indicator — 2-line compact card */}
          {travelStatus && travelStatus.traveling && travelStatus.seconds_remaining > 0 && (
            <div
              className="flex items-center gap-1.5 border border-primary/35 px-2 py-1 rounded-sm cursor-pointer shrink-0"
              style={{ background: 'rgba(var(--noir-primary-rgb), 0.07)', animation: 'pulse 2s ease-in-out infinite' }}
              onClick={() => navigate('/travel')}
              title={`Traveling to ${travelStatus.destination}`}
            >
              <span className="text-base leading-none">🚗</span>
              <div className="flex flex-col leading-none gap-0.5">
                <span className="font-heading text-[9px] text-primary/75 tracking-wider truncate max-w-[72px]">→ {travelStatus.destination}</span>
                <span className="font-heading text-[11px] font-bold" style={{ color: 'var(--noir-primary)' }}>{travelStatus.seconds_remaining}s</span>
              </div>
            </div>
          )}

          {user && (() => {
            const handleDragStart = (e, statId) => { e.dataTransfer.setData('text/plain', statId); e.dataTransfer.effectAllowed = 'move'; setDraggingStatId(statId); };
            const handleDragEnd = () => setDraggingStatId(null);
            const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
            const handleDrop = (e, targetId) => {
              e.preventDefault();
              const draggedId = e.dataTransfer.getData('text/plain');
              if (!draggedId || draggedId === targetId) return;
              setStatOrder((prev) => {
                const next = prev.filter((id) => id !== draggedId);
                const idx = next.indexOf(targetId);
                next.splice(idx < 0 ? next.length : idx, 0, draggedId);
                try { localStorage.setItem(TOPBAR_STAT_ORDER_KEY, JSON.stringify(next)); } catch (_) {}
                schedulePatchTopBarStatOrder(next);
                return next;
              });
              setDraggingStatId(null);
            };
            const moveStat = (fromIndex, direction) => {
              const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
              if (toIndex < 0 || toIndex >= statOrder.length) return;
              setStatOrder((prev) => {
                const next = [...prev];
                [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
                try { localStorage.setItem(TOPBAR_STAT_ORDER_KEY, JSON.stringify(next)); } catch (_) {}
                schedulePatchTopBarStatOrder(next);
                return next;
              });
            };
            const setTopBarGapPersist = (v) => {
              try { localStorage.setItem(TOPBAR_GAP_KEY, v); } catch (_) {}
              window.dispatchEvent(new Event('topbar-prefs-changed'));
              api.patch('/profile/theme', { top_bar_gap: v, theme_platform: getThemeUiPlatform() }).catch(() => {});
            };
            const setTopBarSizePersist = (v) => {
              try { localStorage.setItem(TOPBAR_SIZE_KEY, v); } catch (_) {}
              window.dispatchEvent(new Event('topbar-prefs-changed'));
              api.patch('/profile/theme', { top_bar_size: v, theme_platform: getThemeUiPlatform() }).catch(() => {});
            };
            const setTopBarChipWidthScalePersist = (v) => {
              const n = Math.max(CHIP_SCALE_MIN, Math.min(CHIP_SCALE_MAX, Number(v)));
              try { localStorage.setItem(TOPBAR_CHIP_WIDTH_SCALE_KEY, String(n)); } catch (_) {}
              setTopBarChipWidthScale(n);
              window.dispatchEvent(new Event('topbar-prefs-changed'));
              api.patch('/profile/theme', { top_bar_chip_width_scale: n, theme_platform: getThemeUiPlatform() }).catch(() => {});
            };
            const setTopBarChipHeightScalePersist = (v) => {
              const n = Math.max(CHIP_SCALE_MIN, Math.min(CHIP_SCALE_MAX, Number(v)));
              try { localStorage.setItem(TOPBAR_CHIP_HEIGHT_SCALE_KEY, String(n)); } catch (_) {}
              setTopBarChipHeightScale(n);
              window.dispatchEvent(new Event('topbar-prefs-changed'));
              api.patch('/profile/theme', { top_bar_chip_height_scale: n, theme_platform: getThemeUiPlatform() }).catch(() => {});
            };

            const topBarGapClass = topBarGap === 'compact' ? 'gap-1 md:gap-2' : topBarGap === 'spread' ? 'gap-2 md:gap-4' : 'gap-1 md:gap-2';
            const topBarIconSize = topBarSize === 'small' ? 12 : topBarSize === 'large' ? 20 : 16;
            const chipWidthScale = topBarChipWidthScale / 100;
            const chipHeightScale = topBarChipHeightScale / 100;
            const chipScaleAvg = (chipWidthScale + chipHeightScale) / 2;
            const topBarIconSizeEffective = Math.max(8, Math.min(20, Math.round(topBarIconSize * chipScaleAvg)));
            const topBarIconSizeEffectiveMobile = isMobileViewport ? Math.min(12, topBarIconSizeEffective) : topBarIconSizeEffective;
            const topBarChipStyle = {
              paddingTop: Math.round((isMobileViewport ? 2 : 3) * chipHeightScale),
              paddingBottom: Math.round((isMobileViewport ? 2 : 3) * chipHeightScale),
              paddingLeft: Math.round((isMobileViewport ? 4 : 5) * chipWidthScale),
              paddingRight: Math.round((isMobileViewport ? 4 : 5) * chipWidthScale),
            };
            // Mobile: slimmer row but keep ≥32px for tap targets; desktop: no fixed min
            const topBarChipMinHeight = isMobileViewport ? Math.max(32, Math.round(28 * chipHeightScale)) : undefined;
            const rankBarWidthPx = Math.max(isMobileViewport ? 18 : 20, Math.round((isMobileViewport ? 24 : 44) * chipWidthScale));
            const rankColMinWidthPx = Math.max(isMobileViewport ? 28 : 36, Math.round((isMobileViewport ? 44 : 52) * chipWidthScale));
            const topBarTextClass = topBarSize === 'small' ? 'text-[11px] md:text-[10px]' : topBarSize === 'large' ? 'text-sm' : (isMobileViewport ? 'text-[11px]' : 'text-xs');

            const statRenderProps = { topBarChipStyle, topBarChipMinHeight, topBarIconSizeEffectiveMobile, topBarTextClass, rankBarWidthPx, rankColMinWidthPx, chipWidthScale, chipHeightScale, isMobileViewport };

            return (
              <>
                {/* IMPROVEMENT 6: scroll fade mask on mobile */}
                <div
                  className={`${(isMobileViewport && mobileStatsDisplay === 'touch_ball') || mobileStatsDisplay === 'right_sidebar' ? 'hidden' : 'flex'} md:flex items-center ${topBarGapClass} flex-1 min-w-0 py-0 md:py-0 md:mx-0 md:px-0 overflow-x-auto overflow-y-hidden scrollbar-hide scroll-smooth touch-pan-x min-h-0`}
                  style={isMobileViewport ? { WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 8px, black 90%, transparent 100%)', maskImage: 'linear-gradient(to right, transparent 0, black 8px, black 90%, transparent 100%)' } : undefined}
                >
                  {(!isMobileViewport || mobileStatsDisplay === 'top_bar') && mobileStatsDisplay !== 'right_sidebar' && (
                    <div className="flex items-center gap-0.5 md:gap-2 min-w-full w-max justify-evenly md:min-w-0 md:w-auto md:justify-start md:shrink-0">
                      {/* Search — desktop only (mobile: find users elsewhere, e.g. social) */}
                      {!isMobileViewport && (
                      <div className="relative shrink-0 z-10" ref={userSearchRef}>
                        {!userSearchExpanded ? (
                          <button type="button" draggable={false}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setUserSearchExpanded(true); setUserSearchOpen(true); setTimeout(() => userSearchInputRef.current?.focus(), 0); }}
                            className="flex items-center justify-center gap-1 text-primary active:scale-95 transition-colors cursor-pointer touch-manipulation rounded-md border-0 bg-white/[0.04] hover:bg-white/[0.08]"
                            style={{ ...topBarChipStyle, minHeight: topBarChipMinHeight }}
                            aria-label="Search user" title="Find any made man">
                            <Search size={topBarIconSizeEffectiveMobile} strokeWidth={2} />
                          </button>
                        ) : (
                          <div
                            className={`flex items-center gap-1 rounded-md px-2 py-1 min-w-[140px] max-w-[180px] md:min-w-[120px] md:py-0.5 md:px-1.5 ${isMobileViewport ? 'bg-white/[0.06] border border-white/12' : 'bg-noir-surface/90 border border-primary/30'}`}
                            style={isMobileViewport ? undefined : { boxShadow: '0 0 0 2px rgba(var(--noir-primary-rgb), 0.08)' }}
                          >
                            <Search size={14} className="text-primary/50 shrink-0 md:w-3 md:h-3" aria-hidden />
                            <input ref={userSearchInputRef} type="text" value={userSearchQuery}
                              onChange={(e) => { setUserSearchQuery(e.target.value); setUserSearchOpen(true); }}
                              onFocus={() => setUserSearchOpen(true)}
                              placeholder="Find made man..."
                              className="flex-1 min-w-0 py-0.5 bg-transparent font-heading text-foreground placeholder:text-mutedForeground focus:outline-none border-0 text-[16px] md:text-[11px]"
                              data-testid="topbar-user-search" autoComplete="off" />
                          </div>
                        )}
                        {userSearchExpanded && userSearchOpen && (
                          <div className="absolute top-full left-0 mt-1 w-[min(calc(100vw-2rem),260px)] max-w-[260px] max-h-[min(60vh,280px)] overflow-y-auto rounded border shadow-xl z-[100] flex flex-col"
                            style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-border-mid)' }}>
                            <div className="p-2.5 border-b shrink-0 md:p-2" style={{ borderColor: 'var(--noir-border)' }}>
                              <p className="text-xs font-heading text-mutedForeground md:text-[10px]">Find any user — online, offline, or dead</p>
                            </div>
                            <div className="flex-1 min-h-0">
                              {userSearchLoading ? (
                                <div className="p-4 text-center text-sm font-heading text-mutedForeground md:p-3 md:text-[11px]">Searching...</div>
                              ) : userSearchResults.length === 0 ? (
                                <div className="p-4 text-center text-sm font-heading text-mutedForeground md:p-3 md:text-[11px]">{userSearchQuery.trim().length < 1 ? 'Type to search' : 'No users found'}</div>
                              ) : (
                                userSearchResults.map((u) => (
                                  <SameRouteAwareLink key={u.username} to={`/profile/${encodeURIComponent(u.username)}`}
                                    onClick={() => { setUserSearchOpen(false); setUserSearchExpanded(false); setUserSearchQuery(''); setUserSearchResults([]); }}
                                    className="flex items-center justify-between gap-2 w-full text-left px-3 py-3 min-h-[44px] border-b font-heading text-sm hover:bg-noir-raised/80 active:bg-noir-raised/90 transition-colors touch-manipulation md:py-2 md:min-h-0"
                                    style={{ borderColor: 'var(--noir-border)', color: 'var(--noir-foreground)' }}>
                                    <span className="truncate font-semibold">{u.username}</span>
                                    <div className="flex gap-1 shrink-0">
                                      {u.is_dead && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 md:text-[9px] md:px-1">Dead</span>}
                                      {u.in_jail && !u.is_dead && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 md:text-[9px] md:px-1">Jail</span>}
                                      {u.is_bodyguard && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 md:text-[9px] md:px-1">Robot</span>}
                                    </div>
                                  </SameRouteAwareLink>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      )}

                      {statOrder.filter((statId) => statId !== 'notifications' && statId !== 'property' && (!isMobileViewport || (statId !== 'kills' && statId !== 'respect_points'))).map((statId) => {
                        const content = renderTopBarStat(statId, statRenderProps);
                        if (!content) return null;
                        return (
                          <div key={statId} draggable={!isMobileViewport} onDragStart={(e) => handleDragStart(e, statId)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, statId)} onDragEnd={handleDragEnd}
                            className={`shrink-0 snap-start transition-all duration-150 ease-out ${isMobileViewport ? '' : 'cursor-grab active:cursor-grabbing'} ${draggingStatId === statId ? 'opacity-50 scale-95' : ''}`}>
                            {content}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Mobile top bar customize sheet */}
                {topBarCustomizeOpen && (
                  <>
                    <div className="fixed inset-0 z-50 bg-black/50 md:hidden" aria-hidden onClick={() => setTopBarCustomizeOpen(false)} />
                    <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-xl border-t shadow-2xl md:hidden safe-area-pb" style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-border-mid)' }}>
                      <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--noir-border-mid)', backgroundColor: 'var(--noir-content)' }}>
                        <h3 className="font-heading font-semibold text-sm" style={{ color: 'var(--noir-primary)' }}>Customize top bar</h3>
                        <button type="button" onClick={() => setTopBarCustomizeOpen(false)} className="p-2 rounded-lg font-heading text-xs border transition-colors" style={{ borderColor: 'var(--noir-primary)', color: 'var(--noir-primary)' }}>Done</button>
                      </div>
                      <div className="p-4 space-y-4">
                        <div>
                          <p className="text-[10px] font-heading uppercase tracking-wider mb-2" style={{ color: 'var(--noir-muted)' }}>Order</p>
                          <ul className="space-y-1">
                            {statOrder.map((statId, idx) => (
                              <li key={statId} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                                <span className="font-heading text-sm truncate" style={{ color: 'var(--noir-foreground)' }}>{TOPBAR_STAT_LABELS[statId] ?? statId}</span>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button type="button" onClick={() => moveStat(idx, 'up')} disabled={idx === 0} className="p-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation" style={{ borderColor: 'var(--noir-border-mid)' }} aria-label="Move up"><ChevronUp size={18} strokeWidth={2} style={{ color: 'var(--noir-foreground)' }} /></button>
                                  <button type="button" onClick={() => moveStat(idx, 'down')} disabled={idx === statOrder.length - 1} className="p-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation" style={{ borderColor: 'var(--noir-border-mid)' }} aria-label="Move down"><ChevronDown size={18} strokeWidth={2} style={{ color: 'var(--noir-foreground)' }} /></button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-[10px] font-heading uppercase tracking-wider mb-2" style={{ color: 'var(--noir-muted)' }}>Chip width</p>
                          <div className="flex flex-wrap items-center gap-3">
                            <input type="range" min={CHIP_SCALE_MIN} max={CHIP_SCALE_MAX} value={topBarChipWidthScale} onChange={(e) => setTopBarChipWidthScalePersist(Number(e.target.value))} className="flex-1 min-w-[120px] h-2 rounded-full accent-primary" aria-label="Chip width" />
                            <span className="text-xs font-heading tabular-nums shrink-0" style={{ color: 'var(--noir-foreground)' }}>{topBarChipWidthScale}%</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-heading uppercase tracking-wider mb-2" style={{ color: 'var(--noir-muted)' }}>Chip height</p>
                          <div className="flex flex-wrap items-center gap-3">
                            <input type="range" min={CHIP_SCALE_MIN} max={CHIP_SCALE_MAX} value={topBarChipHeightScale} onChange={(e) => setTopBarChipHeightScalePersist(Number(e.target.value))} className="flex-1 min-w-[120px] h-2 rounded-full accent-primary" aria-label="Chip height" />
                            <span className="text-xs font-heading tabular-nums shrink-0" style={{ color: 'var(--noir-foreground)' }}>{topBarChipHeightScale}%</span>
                          </div>
                        </div>
                        <p className="text-[9px] font-heading" style={{ color: 'var(--noir-muted)' }}>Lower = more compact. Rank bar shortens with width.</p>
                        <div>
                          <p className="text-[10px] font-heading uppercase tracking-wider mb-2" style={{ color: 'var(--noir-muted)' }}>Base size</p>
                          <div className="flex flex-wrap gap-2">
                            {['small', 'medium', 'large'].map((v) => (
                              <button key={v} type="button" onClick={() => setTopBarSizePersist(v)} className={`px-4 py-2.5 rounded-lg border-2 text-sm font-heading uppercase tracking-wider transition-colors touch-manipulation ${topBarSize === v ? 'border-primary' : ''}`} style={topBarSize === v ? { backgroundColor: 'rgba(var(--noir-primary-rgb), 0.2)', color: 'var(--noir-primary)' } : { borderColor: 'var(--noir-border-mid)', color: 'var(--noir-muted)' }}>
                                {v.charAt(0).toUpperCase() + v.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-heading uppercase tracking-wider mb-2" style={{ color: 'var(--noir-muted)' }}>Spacing</p>
                          <div className="flex flex-wrap gap-2">
                            {['compact', 'normal', 'spread'].map((v) => (
                              <button key={v} type="button" onClick={() => setTopBarGapPersist(v)} className={`px-4 py-2.5 rounded-lg border-2 text-sm font-heading uppercase tracking-wider transition-colors touch-manipulation ${topBarGap === v ? 'border-primary' : ''}`} style={topBarGap === v ? { backgroundColor: 'rgba(var(--noir-primary-rgb), 0.2)', color: 'var(--noir-primary)' } : { borderColor: 'var(--noir-border-mid)', color: 'var(--noir-muted)' }}>
                                {v === 'compact' ? 'Close' : v === 'spread' ? 'Spread' : 'Normal'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      <main data-layout="main" className={`${!isLandscapeCompactLayout ? (themeVariant === 'modern' ? 'md:ml-40' : 'md:ml-48') : ''} mt-main-below-topbar min-h-screen p-4 md:p-6 overflow-x-hidden ${mobileNavStyle === 'bottom' ? 'pb-safe-bottom-nav md:pb-6' : ''} ${(isMobileViewport || isLandscapeCompactLayout) && mobileStatsDisplay === 'top_bar' && (flashNews.length > 0 || (user && hasCasinoOrProperty)) && mobileNavStyle !== 'bottom' ? 'pb-16 md:pb-6' : ''} ${user && mobileStatsDisplay === 'right_sidebar' && !isLandscapeCompactLayout ? (themeVariant === 'modern' ? 'md:mr-60' : 'md:mr-52') : ''}`}>
        <ActiveEventBanner fetchEnabled={!!user} />
        {needsEmailVerification && (
          <div className="mb-3 px-3 py-2 rounded-sm flex items-center gap-2 flex-wrap" style={{ backgroundColor: 'rgba(var(--noir-primary-rgb), 0.15)', border: '1px solid rgba(var(--noir-primary-rgb), 0.4)' }}>
            <Mail size={16} style={{ color: 'var(--noir-primary)' }} className="shrink-0" />
            <span className="text-sm font-heading" style={{ color: 'var(--noir-foreground)' }}>Verify your email to use crimes, GTA, OC, bank, gambling, dead-alive, and other features.</span>
            <SameRouteAwareLink to="/verify-email" className="text-sm font-heading font-bold uppercase tracking-wider shrink-0" style={{ color: 'var(--noir-primary)' }}>Verify email</SameRouteAwareLink>
          </div>
        )}
        {(() => {
          const pathNorm = (location.pathname || '').replace(/\/$/, '') || '/';
          let lockedMessage = pageLocks[pathNorm];
          if (!lockedMessage && typeof pageLocks === 'object') {
            const matchingKeys = Object.keys(pageLocks).filter(
              (k) => pathNorm === k || pathNorm.startsWith(k + '/')
            );
            if (matchingKeys.length > 0) {
              const longest = matchingKeys.sort((a, b) => b.length - a.length)[0];
              lockedMessage = pageLocks[longest];
            }
          }
          const msg = typeof lockedMessage === 'object' ? lockedMessage?.message : lockedMessage;
          // Admins with "act as normal" are not isAdmin but still have hasAdminEmail — allow bodyguards
          // (points purchases) when combat/store-style locks are on so staff can test or play guards.
          const isBodyguardsPage = pathNorm === '/kill/bodyguards' || pathNorm.startsWith('/kill/bodyguards/');
          const bypassMaintenanceLock = isAdmin || (hasAdminEmail && isBodyguardsPage);
          if (msg && !bypassMaintenanceLock) {
            return (
              <div className="flex flex-col items-center justify-center min-h-[50vh] px-4 text-center">
                <div className="rounded-xl border-2 p-8 max-w-md w-full" style={{ borderColor: 'var(--noir-primary)', backgroundColor: 'rgba(var(--noir-primary-rgb), 0.08)' }}>
                  <p className="text-lg font-heading font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--noir-primary)' }}>Down for maintenance</p>
                  <p className="text-sm font-heading text-muted-foreground mb-6">{msg}</p>
                  <SameRouteAwareLink to="/account/dashboard" className="text-sm font-heading font-bold uppercase tracking-wider" style={{ color: 'var(--noir-primary)' }}>Back to Dashboard</SameRouteAwareLink>
                </div>
              </div>
            );
          }
          return (
            <ErrorBoundary>
              <div className="relative">
                <Fragment key={contentResumeKey}>{children}</Fragment>
                {user ? <FindWordHuntLayer /> : null}
              </div>
            </ErrorBoundary>
          );
        })()}
      </main>

      {/* ── RIGHT SIDEBAR ────────────────────────────────────────────────────── */}
      {user && mobileStatsDisplay === 'right_sidebar' && (
        <>
          {isMobileViewport && rightSidebarOpen && (
            <div className="fixed inset-0 bg-black/50 z-40 md:hidden cursor-pointer touch-manipulation" aria-label="Close stats" role="button" tabIndex={-1}
              onClick={closeRightSidebar} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') closeRightSidebar(); }} />
          )}
          {isMobileViewport && (
            <button type="button" onClick={() => setRightSidebarOpen(true)}
              className={`fixed right-0 top-1/2 -translate-y-1/2 z-50 min-w-[44px] w-11 min-h-[56px] h-14 flex items-center justify-center rounded-l-lg border border-l-0 shadow-lg md:hidden transition-opacity touch-manipulation ${rightSidebarOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
              style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-primary)' }}
              aria-label="Open stats sidebar">
              <PanelRight size={18} style={{ color: 'var(--noir-primary)' }} />
            </button>
          )}
          <div data-layout="right-sidebar" className={`fixed right-0 w-52 flex flex-col z-40 overflow-y-auto border-l ${styles.sidebar} transition-transform duration-300 ${isMobileViewport ? (rightSidebarOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none') : 'translate-x-0'} ${isMobileViewport ? 'top-0 h-full' : 'md:top-0 md:h-full'}`} style={sidebarBgStyle}>

            {/* IMPROVEMENT 4: username + rank in header; page + user for logs */}
            <div className={`flex flex-col px-2.5 py-1.5 border-b ${styles.borderGoldLight} shrink-0 gap-0.5`}>
              <div className="flex items-center justify-between gap-2 min-h-[28px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <User size={13} style={{ color: 'var(--noir-primary)', flexShrink: 0 }} />
                  <span className="text-[11px] font-heading font-bold truncate" style={{ color: 'var(--noir-primary)' }}>{user.username || 'Profile'}</span>
                </div>
                <span className="text-[9px] font-heading uppercase tracking-wider shrink-0" style={{ color: 'var(--noir-muted)' }}>{user.rank_name || rankProgress?.current_rank_name || ''}</span>
                {isMobileViewport && (
                  <button type="button" onClick={closeRightSidebar}
                    onPointerUp={(e) => { e.preventDefault(); closeRightSidebar(); }}
                    onTouchEnd={(e) => { e.preventDefault(); closeRightSidebar(); }}
                    className="min-w-[44px] min-h-[44px] -m-1 flex items-center justify-center rounded touch-manipulation active:scale-95 transition-transform"
                    style={{ color: 'var(--noir-primary)' }} aria-label="Close stats panel"><X size={22} /></button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-0">
              {/* IMPROVEMENT 4: rank progress at top */}
              {rankProgress && (
                <div className="pt-1 pb-2 border-b" style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.12)' }}>
                  <p className="text-[9px] font-heading uppercase tracking-wider mb-1.5" style={{ color: 'var(--noir-muted)' }}>Rank Progress</p>
                  <div className="h-1.5 w-full rounded-full overflow-hidden mb-1" style={{ backgroundColor: 'var(--noir-raised)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, Number(rankProgress.rank_points_progress) || 0))}%`, background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))' }} />
                  </div>
                  <p className="text-[9px] font-heading" style={{ color: 'var(--noir-primary)' }}>{(user?.premium_rank_bar ? (Number(rankProgress.rank_points_progress) || 0).toFixed(2) : (Number(rankProgress.rank_points_progress) || 0).toFixed(0))}% · {rankProgress.current_rank_name}</p>
                </div>
              )}

              {/* Stat rows — IMPROVEMENT 4: hover highlight, colour-coded values */}
              <div className="space-y-0">
                {[
                  { label: 'Cash', value: formatMoney(user.money), className: 'text-primary', isLink: true, to: '/bank' },
                  { label: 'Points', value: formatInt(user.points), isLink: true, to: '/game/store?tab=points' },
                  { label: 'Respect', value: formatInt(user.respect_points ?? 0), isLink: true, to: '/game/store?tab=upgrades' },
                  { label: 'Bullets', value: formatInt(user.bullets), isLink: true, to: '/game/store?tab=bullets' },
                  { label: 'Health', value: Number.isFinite(Number(user.health)) ? `${Math.max(0, Math.min(100, Math.round(Number(user.health))))}%` : '100%', className: Number(user.health) > 50 ? 'text-emerald-400' : Number(user.health) > 25 ? 'text-amber-400' : 'text-red-400', isLink: true, to: '/game/store?tab=upgrades' },
                  { label: 'Kills', value: formatInt(user.total_kills), className: 'text-red-400', isLink: true, to: '/kill/attack' },
                  { label: 'Weapon', value: user.gun_name || 'None', isLink: true, to: '/kill/armour-weapons' },
                  { label: 'Armour', value: user.armour_name || 'None', isLink: true, to: '/kill/armour-weapons' },
                  { label: 'Location', value: user.current_state || user.location || '—', truncate: true, isLink: true, to: '/travel' },
                  {
                    label: 'Family',
                    value: (
                      <span className="inline-flex items-center justify-end gap-1.5 w-full">
                        {(user.family_emblem_preset_id || user.family_emblem_avatar_url) ? (
                          <FamilyEmblem
                            emblemPresetId={user.family_emblem_preset_id}
                            avatarUrl={user.family_emblem_avatar_url}
                            size={14}
                            className="shrink-0"
                          />
                        ) : null}
                        <span className="min-w-0 break-words leading-snug">{user.gang_name || 'None'}</span>
                      </span>
                    ),
                    wrapValue: true,
                    isLink: true,
                    to: '/game/family/list',
                  },
                  { label: 'Guards', value: typeof user.bodyguard_count === 'number' ? `${user.bodyguard_count}/${user.bodyguard_slots ?? 1}` : '—', isLink: true, to: '/kill/bodyguards' },
                  ...(hasCasinoOrProperty ? [
                    { label: 'Casino', value: formatMoney(user.casino_profit ?? 0), className: (user.casino_profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400', isLink: true, to: '/my-properties' },
                    { label: 'Property', value: `${formatInt(user.property_profit ?? 0)} pts`, isLink: true, to: '/my-properties' },
                  ] : []),
                ].map((row, i) => {
                  if (row.isLink) {
                    return (
                      <SameRouteAwareLink key={i} to={row.to} onClick={() => isMobileViewport && setRightSidebarOpen(false)}
                        className={`flex justify-between gap-1 text-[9px] font-heading px-1 py-1 rounded-sm transition-colors min-w-0 ${row.wrapValue ? 'items-start' : 'items-center'}`}
                        style={{ color: 'var(--noir-foreground)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.05)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                        <span className="shrink-0 pt-px" style={{ color: 'var(--noir-muted)' }}>{row.label}</span>
                        <span
                          className={
                            row.wrapValue
                              ? `flex-1 min-w-0 text-right break-words leading-snug ${row.className || ''}`
                              : `shrink min-w-0 text-right ${row.truncate ? 'truncate max-w-[72px]' : 'truncate'} ${row.className || ''}`
                          }
                          style={row.className ? undefined : { color: 'var(--noir-primary)' }}
                          title={row.wrapValue || typeof row.value !== 'string' ? undefined : row.value}
                        >
                          {row.value}
                        </span>
                      </SameRouteAwareLink>
                    );
                  }
                  return (
                    <div key={i} className="flex justify-between items-center gap-1 text-[9px] font-heading px-1 py-1 rounded-sm transition-colors min-w-0"
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb), 0.04)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                      <span className="shrink-0" style={{ color: 'var(--noir-muted)' }}>{row.label}</span>
                      <span className={`shrink min-w-0 text-right ${row.truncate ? 'truncate max-w-[72px]' : ''} ${row.className || ''}`} style={!row.className ? { color: 'var(--noir-foreground)' } : undefined} title={typeof row.value === 'string' ? row.value : undefined}>{row.value}</span>
                    </div>
                  );
                })}
              </div>

              {/* Find user — under stats / property */}
              <div className="pt-1.5">
                <label className="block text-[8px] font-heading font-bold text-primary/70 uppercase tracking-[0.2em] mb-1" style={{ color: 'var(--noir-muted)' }}>Find user</label>
                <form
                  className="flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = findUserQuery.trim();
                    if (!q) return;
                    if (isMobileViewport) setRightSidebarOpen(false);
                    navigate(`/profile/${encodeURIComponent(q)}`);
                    setFindUserQuery('');
                  }}
                >
                  <input
                    type="text"
                    value={findUserQuery}
                    onChange={(e) => setFindUserQuery(e.target.value)}
                    placeholder="Username"
                    className="flex-1 min-w-0 px-1.5 py-1 rounded text-[9px] font-heading bg-secondary border border-border placeholder:text-mutedForeground focus:outline-none focus:ring-1 focus:ring-primary/50"
                    style={{ color: 'var(--noir-foreground)' }}
                    aria-label="Search for user by username"
                  />
                  <button
                    type="submit"
                    disabled={!findUserQuery.trim()}
                    className="shrink-0 p-1 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Go to profile"
                    title="Go to profile"
                  >
                    <Search size={12} />
                  </button>
                </form>
              </div>

              <div className="h-px shrink-0" style={dividerStyle} />

              <div className="space-y-1 pt-1">
                <SameRouteAwareLink to="/game/leaderboard" onClick={() => isMobileViewport && setRightSidebarOpen(false)}
                  onMouseEnter={prefetchMainLeaderboard}
                  onFocus={prefetchMainLeaderboard}
                  className="flex items-center gap-1.5 text-[10px] font-heading font-bold py-0.5 px-1 rounded-sm"
                  style={{ color: 'var(--noir-primary)' }}>
                  <Trophy size={12} /> Leaderboard
                </SameRouteAwareLink>
                <SameRouteAwareLink to="/social/inbox" onClick={() => isMobileViewport && setRightSidebarOpen(false)}
                  className="flex items-center justify-between gap-1 text-[10px] font-heading py-0.5 px-1 rounded-sm"
                  style={{ color: 'var(--noir-foreground)' }}>
                  <span className="flex items-center gap-1.5">
                    <Newspaper size={12} style={{ color: 'var(--noir-primary)' }} /> Notifications
                    {unreadCount > 0 && <span className="text-[9px] font-bold" style={{ color: 'var(--noir-primary)' }}>({unreadCount} new)</span>}
                  </span>
                </SameRouteAwareLink>
              </div>

              {/* IMPROVEMENT 4: Theme button in right sidebar too */}
              <button type="button" onClick={() => { setThemePickerOpen(true); isMobileViewport && setRightSidebarOpen(false); }}
                className="w-full flex justify-between items-center gap-1 text-[10px] font-heading py-1 px-1 rounded-sm mt-1"
                style={{ color: 'var(--noir-primary)' }}>
                <span className="flex items-center gap-1.5"><Palette size={12} /> Theme</span>
                <span>Change</span>
              </button>

              {/* Game Chat: whole game can talk; family-only toggle and block list in settings */}
              <GameChat myUserId={user.id} onCloseSidebar={() => isMobileViewport && setRightSidebarOpen(false)} censorProfanity={user.censor_profanity} canClearChat={isAdmin || isModerator} />
            </div>

            {isMobileViewport && (
              <div className={`px-2 py-3 border-t ${styles.borderGoldLight} shrink-0`}>
                <button type="button" onClick={closeRightSidebar}
                  onPointerUp={(e) => { e.preventDefault(); closeRightSidebar(); }}
                  onTouchEnd={(e) => { e.preventDefault(); closeRightSidebar(); }}
                  className="w-full flex items-center justify-center gap-2 min-h-[44px] py-3 px-4 rounded-sm border border-primary/40 bg-primary/10 text-primary font-heading font-bold uppercase tracking-wider text-[11px] hover:bg-primary/20 active:scale-[0.98] transition-all touch-manipulation"
                  aria-label="Close stats panel">
                  <X size={18} /> Close
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── MOBILE BOTTOM AREA (nav + news/casino bar when top bar stats) ─────── */}
      {isMobileViewport && (mobileNavStyle === 'bottom' || (mobileStatsDisplay === 'top_bar' && (flashNews.length > 0 || (user && hasCasinoOrProperty)))) && (
        <>
      {mobileNavStyle === 'bottom' && mobileBottomMenuOpen && (
        <div
          role="presentation"
          aria-hidden
          className="fixed inset-0 z-[49] bg-black/45 md:hidden touch-manipulation"
          onClick={() => setMobileBottomMenuOpen(null)}
        />
      )}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col-reverse touch-manipulation">
          {/* News + casino bar — above nav when top bar stats selected */}
          {mobileStatsDisplay === 'top_bar' && (flashNews.length > 0 || (user && hasCasinoOrProperty)) && (
            <div data-layout="mobile-bottom-bar" className="flex items-stretch gap-2 px-3 py-2 safe-area-pb"
              style={{ backgroundColor: 'var(--noir-content)', borderTop: '1px solid var(--noir-border-mid)' }}>
              {flashNews.length > 0 && (
                <div className="flex min-w-0 flex-1 basis-0 items-center gap-1 overflow-hidden rounded px-2 py-1.5 border border-primary/15 bg-primary/5">
                  <Newspaper className="shrink-0 text-primary/70 self-center w-3 h-3" aria-hidden />
                  <div className="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden">
                    <span className="flash-marquee min-w-0 text-[10px] font-heading leading-none text-mutedForeground" title={flashNews[flashIndex]?.message}>{flashNews[flashIndex]?.message}</span>
                    {flashNews.length > 1 && <span className="shrink-0 font-heading text-[9px] tabular-nums leading-none text-primary/50">{flashIndex + 1}/{flashNews.length}</span>}
                  </div>
                </div>
              )}
              {user && hasCasinoOrProperty && (
                <SameRouteAwareLink
                  to="/my-properties"
                  className="flex min-h-[1.5rem] min-w-0 flex-1 basis-0 items-center justify-start gap-1 rounded border border-primary/15 bg-primary/5 px-2 py-1.5 font-heading text-[10px] tabular-nums transition-colors hover:border-primary/25 hover:bg-primary/10"
                >
                  <Building2 className="h-3 w-3 shrink-0 self-center text-primary/70" aria-hidden />
                  <span className={`min-w-0 truncate ${(user.casino_profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>C {formatMoneyCompact(user.casino_profit ?? 0)}</span>
                  <span className="shrink-0 text-[9px] text-primary/50">·</span>
                  <span className="min-w-0 truncate text-mutedForeground">P {formatCompact(user.property_profit ?? 0)} pts</span>
                </SameRouteAwareLink>
              )}
            </div>
          )}
          {/* Bottom nav */}
          {mobileNavStyle === 'bottom' && (
        <div ref={mobileBottomNavRef} data-layout="bottom-nav" className="relative z-[51]">
          {/* IMPROVEMENT 3: 3-column grid submenu */}
          {mobileBottomMenuOpen && (() => {
            const group = mobileBottomNavItems.find((i) => i.type === 'group' && i.id === mobileBottomMenuOpen);
            if (!group || group.type !== 'group') return null;
            return (
              <div data-layout="bottom-nav-submenu" className="absolute bottom-full left-0 right-0 z-[52] border-t border-primary/20 shadow-2xl max-h-[60vh] overflow-y-auto"
                style={{ backgroundColor: 'var(--noir-content)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--noir-border-mid)', touchAction: 'manipulation' }}
                role="menu"
                onClick={(e) => e.stopPropagation()}>
                {/* Group title */}
                <div className="flex items-center justify-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.15)' }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.2)' }} />
                  <span className="font-heading text-[9px] uppercase tracking-widest" style={{ color: 'var(--noir-primary)' }}>{group.label}</span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(var(--noir-primary-rgb), 0.2)' }} />
                </div>
                {/* 3-col grid */}
                <div className="p-2 grid grid-cols-3 gap-1.5">
                  {group.items.map((sub, idx) => {
                    if (sub.action === 'theme') {
                      return (
                        <button key="theme" type="button" onClick={() => { setThemePickerOpen(true); setMobileBottomMenuOpen(null); }} role="menuitem"
                          className="flex items-center justify-center px-2 py-3 rounded-md border font-heading text-[10px] uppercase tracking-wider transition-colors"
                          style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.2)', backgroundColor: 'rgba(var(--noir-primary-rgb), 0.06)', color: 'var(--noir-primary)' }}>
                          {sub.label}
                        </button>
                      );
                    }
                    if (sub.action === 'logout') {
                      return (
                        <button key="logout" type="button" onClick={() => { handleLogout(); setMobileBottomMenuOpen(null); }} role="menuitem"
                          className="col-span-3 flex items-center justify-center px-2 py-2.5 rounded-md border font-heading text-[10px] uppercase tracking-wider transition-colors"
                          style={{ borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                          {sub.label}
                        </button>
                      );
                    }
                    if (sub.action === 'promoteAdmin') {
                      return (
                        <button key="promoteAdmin" type="button" onClick={() => { promoteToAdmin(); setMobileBottomMenuOpen(null); }} role="menuitem"
                          className="col-span-3 flex items-center justify-center px-2 py-2.5 rounded-md border font-heading text-[10px] uppercase tracking-wider transition-colors"
                          style={{ borderColor: 'rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.06)', color: '#fbbf24' }}>
                          {sub.label}
                        </button>
                      );
                    }
                    const to = sub.search ? { pathname: sub.path, search: sub.search } : sub.state ? { pathname: sub.path, state: sub.state } : sub.path;
                    const isActive = sub.search
                      ? location.pathname === sub.path && location.search === sub.search
                      : sub.state ? location.pathname === sub.path && location.state?.category === sub.state?.category
                      : sub.path === '/social/forum'
                        ? (sub.search
                          ? location.pathname === '/social/forum' && location.search === sub.search
                          : location.pathname === '/social/forum'
                            && !location.search?.includes('tab=entertainer')
                            && !location.search?.includes('tab=designer')
                            && !location.search?.includes('tab=game_ideas')
                            && !location.search?.includes('tab=crew_oc'))
                      : location.pathname === sub.path || location.pathname.startsWith(sub.path + '/');
                    const prefetchCrimes = sub.path === '/crime/crimes' ? () => { api.get('/crimes').then((r) => setCrimesPrefetch(r.data)).catch(() => {}); } : undefined;
                    const isGtaExclusive = sub.path === '/crime/gta' && gtaExclusiveInPool;
                    return (
                      <SameRouteAwareLink key={sub.path ? `${sub.path}-${sub.label}` : idx} to={to}
                        onClick={() => setMobileBottomMenuOpen(null)}
                        onMouseEnter={prefetchCrimes} onFocus={prefetchCrimes}
                        role="menuitem"
                        className="flex items-center justify-center text-center px-1 py-3 rounded-md border font-heading text-[9px] uppercase tracking-wider transition-all gap-1 min-h-[44px] touch-manipulation"
                        style={isActive
                          ? { borderColor: 'rgba(var(--noir-primary-rgb), 0.5)', backgroundColor: 'rgba(var(--noir-primary-rgb), 0.14)', color: 'var(--noir-primary)' }
                          : { borderColor: 'rgba(var(--noir-primary-rgb), 0.12)', backgroundColor: 'var(--noir-content)', color: 'var(--noir-foreground)' }}
                        title={isGtaExclusive ? 'Exclusive car in GTA pool!' : undefined}>
                        {isGtaExclusive && <span className="text-violet-400 font-bold shrink-0" aria-hidden>★</span>}
                        <span className="leading-tight">{sub.label}</span>
                        {typeof sub.onlineCountBadge === 'number' && (
                          <span className="shrink-0 min-w-[16px] h-[16px] rounded px-0.5 bg-emerald-600/25 text-emerald-400 text-[9px] font-bold border border-emerald-500/40 flex items-center justify-center tabular-nums">
                            {sub.onlineCountBadge.toLocaleString()}
                          </span>
                        )}
                        {sub.badge > 0 && (
                          sub.badgeTone === 'emerald' ? (
                            <span className="shrink-0 min-w-[16px] h-[16px] rounded-full border border-emerald-500/40 bg-emerald-600/30 text-[9px] font-bold text-emerald-200 flex items-center justify-center px-0.5 tabular-nums">
                              {sub.badge > 99 ? '99+' : sub.badge}
                            </span>
                          ) : (
                            <span className="shrink-0 min-w-[16px] h-[16px] rounded-full bg-red-600 text-[9px] font-bold text-white flex items-center justify-center px-0.5">{sub.badge > 9 ? '9+' : sub.badge}</span>
                          )
                        )}
                      </SameRouteAwareLink>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <nav className="flex items-center justify-between gap-1 overflow-x-auto overflow-y-hidden py-1.5 px-1 safe-area-pb scrollbar-thin"
            style={{ backgroundColor: 'var(--noir-content)', borderTop: '1px solid var(--noir-border-mid)', touchAction: 'manipulation' }}
            aria-label="Mobile navigation">
            {mobileBottomNavItems.map((item, index) => {
              const Icon = item.icon;
              const boxBase = 'flex flex-1 flex-col items-center justify-center gap-0 min-w-0 min-h-[44px] rounded border transition-all touch-manipulation';
              const boxInactive = { borderColor: 'var(--noir-border-mid)', backgroundColor: 'var(--noir-surface)', color: 'var(--noir-foreground)' };
              const boxActive = { borderColor: 'rgba(var(--noir-primary-rgb), 0.5)', backgroundColor: 'rgba(var(--noir-primary-rgb), 0.14)', color: 'var(--noir-primary)' };
              const bottomNavDividerStyle = { width: 1, minWidth: 1, alignSelf: 'stretch', borderLeft: sidebarDividerStyle === 'solid' ? '1px solid rgba(var(--noir-primary-rgb), 0.35)' : `1px ${sidebarDividerStyle} rgba(var(--noir-primary-rgb), 0.35)` };
              return (
                <Fragment key={item.path || item.id}>
                  {index > 0 && showBottomNavDividers && <div className="shrink-0 min-h-[24px]" style={bottomNavDividerStyle} aria-hidden="true" />}
                  {item.type === 'link' && (() => {
                    const isActive = location.pathname === item.path || (item.path !== '/account/dashboard' && location.pathname.startsWith(item.path + '/'));
                    const isInbox = item.path === '/social/inbox';
                    return (
                      <SameRouteAwareLink key={item.path} to={item.path} onClick={() => { setSidebarOpen(false); setMobileBottomMenuOpen(null); }}
                        className={boxBase} style={isActive ? boxActive : boxInactive} aria-current={isActive ? 'page' : undefined} title={item.label}>
                        <span className="relative inline-flex leading-none">
                          <Icon size={13} strokeWidth={2} />
                          {isInbox && unreadCount > 0 && <span className="absolute -top-0.5 -right-1 min-w-[10px] h-[10px] rounded-full bg-red-600 text-[8px] font-bold text-white flex items-center justify-center px-0.5">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                        </span>
                        <span className="text-[7px] font-heading uppercase tracking-wider truncate max-w-[44px] leading-tight">{item.mobileShortLabel ?? item.label}</span>
                      </SameRouteAwareLink>
                    );
                  })()}
                  {item.type === 'group' && (() => {
                    const isOpen = mobileBottomMenuOpen === item.id;
                    const isActive = item.items.some((sub) => {
                      if (sub.search) return location.pathname === sub.path && location.search === sub.search;
                      if (sub.state) return location.pathname === sub.path && location.state?.category === sub.state?.category;
                      return location.pathname === sub.path || (sub.path !== '/casino' && sub.path !== '/social/forum' && location.pathname.startsWith(sub.path + '/'));
                    });
                    const showInboxBadge = item.items.some((sub) => sub.path === '/social/inbox') && unreadCount > 0;
                    const showGtaExclusiveStar = item.id === 'rank' && gtaExclusiveInPool;
                    return (
                      <button key={item.id} type="button" onClick={(e) => { e.stopPropagation(); setMobileBottomMenuOpen(isOpen ? null : item.id); }}
                        className={boxBase} style={isOpen || isActive ? boxActive : boxInactive}
                        aria-expanded={isOpen} aria-haspopup="true" title={showGtaExclusiveStar ? `${item.label} — Exclusive car in GTA pool!` : item.label}>
                        <span className="relative inline-flex leading-none">
                          <Icon size={13} strokeWidth={2} />
                          {showInboxBadge && <span className="absolute -top-0.5 -right-1 min-w-[10px] h-[10px] rounded-full bg-red-600 text-[8px] font-bold text-white flex items-center justify-center px-0.5">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                          {showGtaExclusiveStar && <span className="absolute -top-0.5 -left-1 text-violet-400 text-[10px] font-bold" aria-hidden title="Exclusive car in GTA pool">★</span>}
                        </span>
                        <span className="text-[7px] font-heading uppercase tracking-wider truncate max-w-[44px] leading-tight">{item.mobileShortLabel ?? item.label}</span>
                      </button>
                    );
                  })()}
                </Fragment>
              );
            })}
          </nav>
        </div>
          )}
        </div>
        </>
      )}

      {/* ── TOUCH BALL ───────────────────────────────────────────────────────── */}
      {user && notificationBallPosition && isMobileViewport && mobileStatsDisplay === 'touch_ball'
        && !String(location.pathname || '').startsWith('/staffrole') && (
        <div ref={notificationBallRef} data-layout="touch-ball" className="fixed z-50 touch-none" style={{ left: notificationBallPosition.x, top: notificationBallPosition.y, width: 56, height: 56 }}>
          <button type="button"
            className="relative w-full h-full rounded-full flex items-center justify-center shadow-xl border-2 transition-transform active:scale-95 select-none"
            style={{
              backgroundColor: 'var(--noir-content)',
              borderColor: 'var(--noir-primary)',
              color: 'var(--noir-primary)',
              // IMPROVEMENT 5: outer glow ring
              boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 0 4px rgba(var(--noir-primary-rgb), 0.1)',
            }}
            aria-label="Stats and notifications"
            onPointerDown={(e) => {
              e.preventDefault();
              const ballX = notificationBallPosition.x; const ballY = notificationBallPosition.y;
              notificationDragRef.current = { isDragging: false, startX: e.clientX, startY: e.clientY, ballX, ballY, lastX: ballX, lastY: ballY };
              const onMove = (e2) => {
                const r = notificationDragRef.current; if (!r) return;
                const dx = e2.clientX - r.startX; const dy = e2.clientY - r.startY;
                if (!r.isDragging && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) r.isDragging = true;
                if (r.isDragging) {
                  const w = window.innerWidth; const h = window.innerHeight; const size = 56;
                  const nextX = Math.max(0, Math.min(w - size, r.ballX + dx));
                  const nextY = Math.max(0, Math.min(h - size, r.ballY + dy));
                  r.lastX = nextX; r.lastY = nextY;
                  setNotificationBallPosition({ x: nextX, y: nextY });
                }
              };
              const onUp = () => {
                const r = notificationDragRef.current; if (!r) return;
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
                if (r.isDragging) {
                  try { localStorage.setItem(NOTIFICATION_BALL_POSITION_KEY, JSON.stringify({ x: r.lastX, y: r.lastY })); } catch (_) {}
                  api.patch('/profile/theme', {
                    notification_ball_position: { x: Math.round(r.lastX), y: Math.round(r.lastY) },
                    theme_platform: getThemeUiPlatform(),
                  }).catch(() => {});
                }
                else { openNotificationPanel(); }
                notificationDragRef.current = null;
              };
              document.addEventListener('pointermove', onMove);
              document.addEventListener('pointerup', onUp);
              document.addEventListener('pointercancel', onUp);
            }}>
            <div className="flex flex-col items-center justify-center gap-0 leading-none">
              <LayoutGrid size={22} strokeWidth={2} className="shrink-0" />
              {(() => {
                const healthVal = Number(user?.health);
                const healthNum = Number.isFinite(healthVal) ? Math.max(0, Math.min(100, Math.round(healthVal))) : 100;
                // IMPROVEMENT 5: colour-coded health on ball
                const healthColor = healthNum > 50 ? 'text-emerald-400' : healthNum > 25 ? 'text-amber-400' : 'text-red-400';
                return (
                  <span className={`font-heading text-[10px] font-bold tabular-nums ${healthColor}`} title="Health">
                    <Heart size={10} className="inline-block align-middle mr-0.5" />
                    {healthNum}%
                  </span>
                );
              })()}
            </div>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-heading font-bold text-black"
                style={{ backgroundColor: 'var(--noir-primary)' }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notificationPanelOpen && (
            <div data-layout="touch-ball-panel" className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[min(340px,calc(100vw-1.5rem))] max-h-[min(85vh,520px)] flex flex-col rounded-xl border-2 shadow-xl overflow-hidden"
              style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-border-mid)' }}>
              <div className="p-3 border-b shrink-0 flex items-center gap-2" style={{ borderColor: 'var(--noir-border)' }}>
                <h3 className="font-heading font-semibold text-sm shrink-0" style={{ color: 'var(--noir-primary)' }}>Stats & Notifications</h3>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 p-2 space-y-2">
                {/* User search */}
                <div className="flex items-center gap-2">
                  <Search size={16} className="shrink-0" style={{ color: 'var(--noir-muted)' }} />
                  <input type="text" value={userSearchQuery}
                    onChange={(e) => { setUserSearchQuery(e.target.value); setUserSearchOpen(true); }}
                    onFocus={() => setUserSearchOpen(true)}
                    placeholder="Find made man..."
                    className="flex-1 min-w-0 py-2 px-3 rounded-lg border font-heading text-sm bg-noir-surface border-primary/20"
                    style={{ color: 'var(--noir-foreground)' }} autoComplete="off" />
                </div>
                {userSearchOpen && userSearchQuery.trim().length > 0 && (
                  <div className="rounded-lg border overflow-hidden max-h-40 overflow-y-auto" style={{ borderColor: 'var(--noir-border-mid)', backgroundColor: 'var(--noir-surface)' }}>
                    {userSearchLoading ? (
                      <div className="p-3 text-center text-xs font-heading" style={{ color: 'var(--noir-muted)' }}>Searching...</div>
                    ) : userSearchResults.length === 0 ? (
                      <div className="p-3 text-center text-xs font-heading" style={{ color: 'var(--noir-muted)' }}>No users found</div>
                    ) : (
                      userSearchResults.map((u) => (
                        <SameRouteAwareLink key={u.username} to={`/profile/${encodeURIComponent(u.username)}`}
                          onClick={() => { setUserSearchOpen(false); setUserSearchQuery(''); setUserSearchResults([]); setNotificationPanelOpen(false); }}
                          className="block w-full text-left px-3 py-2.5 border-b font-heading text-sm"
                          style={{ borderColor: 'var(--noir-border)', color: 'var(--noir-foreground)' }}>
                          {u.username}
                        </SameRouteAwareLink>
                      ))
                    )}
                  </div>
                )}
                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2">
                  {rankProgress && (
                    <div className="col-span-2 flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                      <TrendingUp size={18} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-heading text-xs truncate" style={{ color: 'var(--noir-muted)' }}>{rankProgress.current_rank_name}</p>
                        <div className="h-1.5 w-full rounded-full mt-1 overflow-hidden" style={{ backgroundColor: 'var(--noir-raised)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, Number(rankProgress.rank_points_progress) || 0))}%`, background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))' }} />
                        </div>
                      </div>
                      <span className="font-heading text-xs font-bold shrink-0" style={{ color: 'var(--noir-primary)' }}>
                        {(user?.premium_rank_bar ? (Number(rankProgress.rank_points_progress) || 0).toFixed(2) : (Number(rankProgress.rank_points_progress) || 0).toFixed(0))}%
                      </span>
                    </div>
                  )}
                  {[
                    { icon: <DollarSign size={18} style={{ color: 'var(--noir-primary)' }} />, value: formatMoney(user.money) },
                    { icon: <Zap size={18} style={{ color: 'var(--noir-foreground)' }} />, value: `${formatInt(user.points)} pts` },
                    { icon: <Trophy size={18} style={{ color: 'var(--noir-foreground)' }} />, value: `${formatInt(user.respect_points ?? 0)} resp` },
                    { icon: <Crosshair size={18} className="text-red-400" />, value: formatInt(user.bullets) },
                    { icon: <Skull size={18} className="text-red-400" />, value: formatInt(user.total_kills) },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                      {s.icon}
                      <span className="font-heading text-sm truncate" style={{ color: 'var(--noir-foreground)' }}>{s.value}</span>
                    </div>
                  ))}
                  {hasCasinoOrProperty && (
                  <div className="col-span-2 flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                    <Building2 size={18} className="shrink-0 text-emerald-400" />
                    <span className="font-heading text-xs truncate" style={{ color: 'var(--noir-foreground)' }}>C {formatMoneyCompact(user.casino_profit ?? 0)} · P {formatCompact(user.property_profit ?? 0)} pts</span>
                  </div>
                  )}
                </div>
                {/* Game Chat — same as right sidebar, bounded height in touch ball panel */}
                <div className="pt-2 border-t flex flex-col min-h-0 overflow-hidden" style={{ borderColor: 'var(--noir-border)', maxHeight: '320px' }}>
                  <GameChat myUserId={user.id} onCloseSidebar={() => setNotificationPanelOpen(false)} censorProfanity={user.censor_profanity} canClearChat={isAdmin || isModerator} />
                </div>
                {/* Notifications */}
                <div className="pt-1 border-t" style={{ borderColor: 'var(--noir-border)' }}>
                  <p className="font-heading text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--noir-muted)' }}>Notifications</p>
                  {notificationList.length === 0 ? (
                    <div className="py-3 text-center font-heading text-xs" style={{ color: 'var(--noir-muted)' }}>No notifications</div>
                  ) : (
                    <div className="space-y-0 rounded-lg overflow-hidden border" style={{ borderColor: 'var(--noir-border)' }}>
                      {notificationList.slice(0, 8).map((n) => (
                        <div
                          key={n.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => { setNotificationPanelOpen(false); navigate('/social/inbox'); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setNotificationPanelOpen(false);
                              navigate('/social/inbox');
                            }
                          }}
                          className="w-full text-left px-3 py-2 border-b font-heading text-xs last:border-b-0 cursor-pointer"
                          style={{ borderColor: 'var(--noir-border)', color: n.read ? 'var(--noir-muted)' : 'var(--noir-foreground)', backgroundColor: n.read ? 'transparent' : 'rgba(var(--noir-primary-rgb), 0.08)' }}>
                          <span className="font-semibold block truncate">{n.title}</span>
                          <span className="block truncate mt-0.5 opacity-90">
                            <NotificationMessage
                              message={n.message}
                              actorUsername={n.actor_username}
                              topicId={n.topic_id}
                              topicTitle={n.topic_title}
                              commentId={n.comment_id}
                              messageLinkTo={n.message_link_to}
                              messageLinkLabel={n.message_link_label}
                              className="text-inherit"
                              onLinkNavigate={() => setNotificationPanelOpen(false)}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="p-2 border-t shrink-0 flex flex-wrap gap-2" style={{ borderColor: 'var(--noir-border)' }}>
                <button type="button" onClick={() => { setNotificationPanelOpen(false); navigate('/social/inbox'); }} className="py-1.5 px-3 rounded-lg text-xs font-heading border" style={{ borderColor: 'var(--noir-primary)', color: 'var(--noir-primary)' }}>View inbox</button>
                <button type="button" onClick={() => markAllNotificationsRead()} className="py-1.5 px-3 rounded-lg text-xs font-heading border" style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-foreground)' }}>Clear all</button>
                <button type="button" onClick={() => { setNotificationPanelOpen(false); setTopBarCustomizeOpen(true); }} className="py-1.5 px-3 rounded-lg text-xs font-heading border ml-auto" style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-muted)' }}>Customize bar</button>
              </div>
            </div>
          )}
        </div>
      )}

      <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
      <FirstTimeThemeModal
        open={showInitialThemeModal}
        onClose={() => setShowInitialThemeModal(false)}
        onChoose={handleInitialThemeChoose}
      />

      {cooldownSeconds > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            textAlign: 'center', padding: '32px 48px', borderRadius: 16,
            border: '1px solid rgba(var(--noir-primary-rgb), 0.3)',
            backgroundColor: 'var(--noir-content)',
            boxShadow: '0 0 40px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontSize: 48, fontFamily: 'var(--font-heading, "Cinzel", serif)', fontWeight: 700, color: 'var(--noir-primary)', lineHeight: 1 }}>
              {cooldownSeconds}s
            </div>
            <div style={{ marginTop: 12, fontSize: 14, fontFamily: 'var(--font-heading, "Cinzel", serif)', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--noir-foreground)', opacity: 0.85 }}>
              Cooldown
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--noir-muted)' }}>
              You're clicking too fast. Please wait.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
