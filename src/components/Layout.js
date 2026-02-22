import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, Home, Target, Shield, Building, Building2, Dice5, Sword, Trophy, ShoppingBag, DollarSign, User, LogOut, TrendingUp, Car, Settings, Users, Lock, Crosshair, Skull, Plane, Mail, ChevronDown, ChevronUp, ChevronRight, Landmark, Wine, AlertTriangle, Newspaper, MapPin, Map, ScrollText, ArrowLeftRight, MessageSquare, Bell, ListChecks, Palette, Bot, Search, Zap, LayoutGrid } from 'lucide-react';
import api, { getApiErrorMessage } from '../utils/api';
import { setCrimesPrefetch } from '../utils/prefetchCache';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useTheme } from '../context/ThemeContext';
import ThemePicker from './ThemePicker';
import styles from '../styles/noir.module.css';

/** Bottom bar: 6 icons. Rank = crimes/rank; Misc = everything that doesn't fit elsewhere. */
function getMobileBottomNavItems(isAdmin, hasCasinoOrProperty) {
  const goItems = [
    { path: '/travel', label: 'Travel' },
    { path: '/states', label: 'States' },
    ...(hasCasinoOrProperty ? [{ path: '/my-properties', label: 'My Properties' }] : []),
    { path: '/properties', label: 'Properties' },
    { path: '/garage', label: 'Garage' },
    { path: '/sell-cars', label: 'Sell Cars' },
    { path: '/buy-cars', label: 'Buy Cars' },
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
        { path: '/attack', label: 'Attack' },
        { path: '/attempts', label: 'Attempts' },
        { path: '/hitlist', label: 'Hitlist' },
        { path: '/bodyguards', label: 'Bodyguards' },
        { path: '/armour-weapons', label: 'Armoury' },
      ],
    },
    {
      type: 'group',
      id: 'rank',
      icon: Target,
      label: 'Rank',
      items: [
        { path: '/crimes', label: 'Crimes' },
        { path: '/gta', label: 'GTA' },
        { path: '/jail', label: 'Jail' },
        { path: '/organised-crime', label: 'Organised Crime' },
        { path: '/prestige', label: 'Prestige' },
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
        { path: '/casino/videopoker', label: 'Video Poker' },
        { path: '/sports-betting', label: 'Sports Betting' },
      ],
    },
    {
      type: 'group',
      id: 'you',
      icon: User,
      label: 'You',
      items: [
        { path: '/dashboard', label: 'Dashboard' },
        { path: '/objectives', label: 'Objectives' },
        { path: '/missions', label: 'Missions' },
        { path: '/profile', label: 'Profile' },
        { path: '/stats', label: 'Stats' },
        { path: '/dead-alive', label: 'Dead > Alive' },
        { path: '/bank', label: 'Bank' },
        { action: 'theme', label: 'Theme' },
        { action: 'logout', label: 'Logout' },
        { path: '/auto-rank', label: 'Auto Rank' },
        ...(isAdmin ? [{ path: '/admin', label: 'Admin Tools' }, { path: '/admin/locked', label: 'Locked accounts' }] : []),
      ],
    },
    {
      type: 'group',
      id: 'misc',
      icon: LayoutGrid,
      label: 'Misc',
      items: [
        { path: '/forum', label: 'Forum' },
        { path: '/forum', label: 'Entertainer Forum', state: { category: 'entertainer' } },
        { path: '/inbox', label: 'Inbox' },
        { path: '/booze-run', label: 'Booze Run' },
        { path: '/users-online', label: 'Users Online' },
        { path: '/families', label: 'Families' },
        { path: '/leaderboard', label: 'Leaderboard' },
        { path: '/store', label: 'Store' },
        { path: '/quick-trade', label: 'Quick Trade' },
      ],
    },
  ];
}

const TOPBAR_STAT_ORDER_KEY = 'topbar_stat_order';
const DEFAULT_STAT_ORDER = ['rank', 'bullets', 'kills', 'money', 'points', 'property', 'notifications'];
const TOPBAR_STAT_LABELS = { rank: 'Rank', bullets: 'Bullets', kills: 'Kills', money: 'Cash', points: 'Points', property: 'Casino & Property', notifications: 'Notifications' };
const TOPBAR_GAP_KEY = 'topbar_gap';
const TOPBAR_SIZE_KEY = 'topbar_size';
const NOTIFICATION_BALL_POSITION_KEY = 'notification_ball_position';

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
    // Merge in any stats from default that are missing (e.g. 'property' added later) so casino/prop profit always can show
    const seen = new Set(parsed);
    const added = DEFAULT_STAT_ORDER.filter((id) => !seen.has(id));
    if (added.length) return [...parsed, ...added];
    return parsed;
  } catch (_) {}
  return DEFAULT_STAT_ORDER;
}

function loadTopBarGap() {
  try {
    const v = localStorage.getItem(TOPBAR_GAP_KEY);
    if (v === 'compact' || v === 'normal' || v === 'spread') return v;
  } catch (_) {}
  return 'normal';
}

function loadTopBarSize() {
  try {
    const v = localStorage.getItem(TOPBAR_SIZE_KEY);
    if (v === 'small' || v === 'medium' || v === 'large') return v;
  } catch (_) {}
  return 'medium';
}

export default function Layout({ children }) {
  const [user, setUser] = useState(null);
  const [rankProgress, setRankProgress] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [statOrder, setStatOrder] = useState(loadStatOrder);
  const [topBarGap, setTopBarGap] = useState(loadTopBarGap);
  const [topBarSize, setTopBarSize] = useState(loadTopBarSize);
  const [draggingStatId, setDraggingStatId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const [casinoOpen, setCasinoOpen] = useState(false);
  const [mobileBottomMenuOpen, setMobileBottomMenuOpen] = useState(null); // which bottom bar group sub-menu is open
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasAdminEmail, setHasAdminEmail] = useState(false);
  const [rankingCounts, setRankingCounts] = useState({ crimes: 0, gta: 0, jail: 0 });
  const [atWar, setAtWar] = useState(false);
  const [autoRankPrefs, setAutoRankPrefs] = useState({ auto_rank_enabled: false, auto_rank_crimes: false, auto_rank_gta: false, auto_rank_oc: false, auto_rank_bust_every_5_sec: false, auto_rank_booze: false });
  const [flashNews, setFlashNews] = useState([]);
  const [flashIndex, setFlashIndex] = useState(0);
  const [travelStatus, setTravelStatus] = useState(null); // { traveling: bool, destination, seconds_remaining }
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationList, setNotificationList] = useState([]);
  const [notificationBallPosition, setNotificationBallPosition] = useState(null);
  const notificationBallRef = useRef(null);
  const notificationDragRef = useRef({ isDragging: false, startX: 0, startY: 0, ballX: 0, ballY: 0 });
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [topBarCustomizeOpen, setTopBarCustomizeOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [userSearchExpanded, setUserSearchExpanded] = useState(false);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const userSearchRef = useRef(null);
  const userSearchInputRef = useRef(null);
  const userSearchDebounceRef = useRef(null);
  const userSearchQueryRef = useRef('');
  userSearchQueryRef.current = (userSearchQuery || '').trim();
  const notificationPanelRef = useRef(null);
  const notificationPanelOpenRef = useRef(false);
  notificationPanelOpenRef.current = notificationPanelOpen;
  const mobileBottomNavRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { mobileNavStyle } = useTheme();

  const hasCasinoOrProperty = Boolean(user?.has_casino_or_property);
  const mobileBottomNavItems = useMemo(() => {
    const items = getMobileBottomNavItems(isAdmin, hasCasinoOrProperty);
    if (hasAdminEmail && !isAdmin) {
      return items.map((i) =>
        i.type === 'group' && i.id === 'account'
          ? { ...i, items: [...i.items, { action: 'promoteAdmin', label: 'Use admin powers' }] }
          : i
      );
    }
    return items;
  }, [isAdmin, hasAdminEmail, hasCasinoOrProperty]);

  useEffect(() => {
    const onTopBarPrefs = () => {
      setTopBarGap(loadTopBarGap());
      setTopBarSize(loadTopBarSize());
    };
    window.addEventListener('topbar-prefs-changed', onTopBarPrefs);
    return () => window.removeEventListener('topbar-prefs-changed', onTopBarPrefs);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const fn = () => setIsMobileViewport(mq.matches);
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
    setMobileBottomMenuOpen(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileBottomMenuOpen) return;
    const handleClickOutside = (e) => {
      if (mobileBottomNavRef.current && !mobileBottomNavRef.current.contains(e.target)) {
        setMobileBottomMenuOpen(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [mobileBottomMenuOpen]);

  useEffect(() => {
    if (!notificationPanelOpen) return;
    const handleClickOutside = (e) => {
      const ballEl = notificationBallRef.current;
      if (ballEl && !ballEl.contains(e.target)) {
        setNotificationPanelOpen(false);
      }
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
    if (!q || q.length < 1) {
      setUserSearchResults([]);
      return;
    }
    if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    userSearchDebounceRef.current = setTimeout(async () => {
      setUserSearchLoading(true);
      setUserSearchResults([]); // clear previous results so we don't show stale list while loading
      try {
        const res = await api.get('/users/search', { params: { q, limit: 15 } });
        // Only apply results if the query hasn't changed (avoid stale response overwriting "No users found")
        if (userSearchQueryRef.current === q) {
          setUserSearchResults(res.data?.users || []);
        }
      } catch {
        if (userSearchQueryRef.current === q) {
          setUserSearchResults([]);
        }
      } finally {
        if (userSearchQueryRef.current === q) {
          setUserSearchLoading(false);
        }
      }
    }, 280);
    return () => {
      if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    };
  }, [userSearchQuery]);

  useEffect(() => {
    fetchData();
    checkAdmin();
    fetchUnreadCount();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = async (event) => {
      const detail = event.detail || {};
      if (detail.money != null && detail.money !== undefined) {
        setUser((prev) => (prev ? { ...prev, money: Number(detail.money) } : null));
      }
      fetchData();
      fetchUnreadCount();
      fetchWarStatus();
      fetchRankingCounts();
      if (notificationPanelOpenRef.current) {
        try {
          const response = await api.get('/notifications');
          setNotificationList(response.data.notifications || []);
        } catch {
          // keep existing list
        }
      }
    };
    window.addEventListener('app:refresh-user', handler);
    return () => window.removeEventListener('app:refresh-user', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => checkAdmin();
    window.addEventListener('app:admin-changed', handler);
    return () => window.removeEventListener('app:admin-changed', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAutoRankPrefs = async () => {
    if (!user) return;
    try {
      const res = await api.get('/auto-rank/me');
      setAutoRankPrefs({
        auto_rank_enabled: !!res.data?.auto_rank_enabled,
        auto_rank_crimes: !!res.data?.auto_rank_crimes,
        auto_rank_gta: !!res.data?.auto_rank_gta,
        auto_rank_oc: !!res.data?.auto_rank_oc,
        auto_rank_bust_every_5_sec: !!res.data?.auto_rank_bust_every_5_sec,
        auto_rank_booze: !!res.data?.auto_rank_booze,
      });
    } catch {
      setAutoRankPrefs({ auto_rank_enabled: false, auto_rank_crimes: false, auto_rank_gta: false, auto_rank_oc: false, auto_rank_bust_every_5_sec: false, auto_rank_booze: false });
    }
  };

  useEffect(() => {
    if (user) fetchAutoRankPrefs();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Shell ready: only auth/me + rank-progress so user and rank appear ASAP
    fetchData();
    // Defer badge/notification and casino-property fetches to after first paint so they don't block shell
    const deferred = setTimeout(() => {
      fetchUnreadCount();
      fetchWarStatus();
      fetchRankingCounts();
      fetchCasinoProperty();
    }, 0);
    return () => clearTimeout(deferred);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let intervalId;
    const deferred = setTimeout(() => {
      fetchWarStatus();
      intervalId = setInterval(fetchWarStatus, 15000);
    }, 0);
    return () => {
      clearTimeout(deferred);
      if (intervalId) clearInterval(intervalId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let intervalId;
    const deferred = setTimeout(() => {
      fetchRankingCounts();
      intervalId = setInterval(fetchRankingCounts, 15000);
    }, 0);
    return () => {
      clearTimeout(deferred);
      if (intervalId) clearInterval(intervalId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pollNotifications = async () => {
      try {
        const response = await api.get('/notifications');
        setUnreadCount(response.data.unread_count ?? 0);
        if (notificationPanelOpenRef.current) {
          setNotificationList(response.data.notifications || []);
        }
      } catch {
        // keep existing state
      }
    };
    let intervalId;
    const deferred = setTimeout(() => {
      pollNotifications();
      intervalId = setInterval(pollNotifications, 5000);
    }, 0);
    return () => {
      clearTimeout(deferred);
      if (intervalId) clearInterval(intervalId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchFlashNews = async () => {
    try {
      const res = await api.get('/news/flash');
      setFlashNews(res.data?.items || []);
    } catch {
      setFlashNews([]);
    }
  };

  useEffect(() => {
    fetchFlashNews();
    const id = setInterval(fetchFlashNews, 60000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (flashNews.length <= 1) return;
    const t = setInterval(() => setFlashIndex((i) => (i + 1) % flashNews.length), 6000);
    return () => clearInterval(t);
  }, [flashNews.length]);

  const fetchData = async () => {
    try {
      const [userRes, progressRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/user/rank-progress')
      ]);
      // Locked (under investigation): only allow /locked page
      if (userRes.data?.account_locked) {
        navigate('/locked', { replace: true });
        return;
      }
      // Keep previous casino/property flags so "My Properties" doesn't flicker when auth/me (which returns placeholders) overwrites
      setUser((prev) => ({
        ...userRes.data,
        casino_profit: prev?.casino_profit ?? userRes.data.casino_profit,
        property_profit: prev?.property_profit ?? userRes.data.property_profit,
        has_casino_or_property: prev?.has_casino_or_property ?? userRes.data.has_casino_or_property,
      }));
      setRankProgress(progressRes.data);
      // Trigger objectives endpoint so backend can auto-reset daily/weekly/monthly without user opening Objectives page
      api.get('/objectives').catch(() => {});
    } catch (error) {
      const msg = getApiErrorMessage(error);
      toast.error(msg || 'Failed to load profile. Please log in again.');
      console.error('Failed to fetch user:', error);
      localStorage.removeItem('token');
      navigate('/');
    }
  };

  const fetchWarStatus = async () => {
    try {
      const res = await api.get('/families/war');
      setAtWar(!!(res.data?.wars?.length > 0));
    } catch {
      setAtWar(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const response = await api.get('/notifications');
      setUnreadCount(response.data.unread_count);
    } catch (error) {
      console.error('Failed to fetch notifications');
    }
  };

  const fetchCasinoProperty = async () => {
    try {
      const res = await api.get('/user/casino-property');
      if (res.data) {
        setUser((prev) => (prev ? { ...prev, ...res.data } : prev));
      }
    } catch {
      // optional; nav and header fall back to has_casino_or_property false
    }
  };

  const openNotificationPanel = async () => {
    const next = !notificationPanelOpen;
    setNotificationPanelOpen(next);
    if (next) {
      try {
        const response = await api.get('/notifications');
        setNotificationList(response.data.notifications || []);
      } catch {
        setNotificationList([]);
      }
    }
  };

  const markAllNotificationsRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setUnreadCount(0);
      setNotificationList((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (_) {}
  };

  const checkAdmin = async () => {
    try {
      const response = await api.get('/admin/check');
      setIsAdmin(!!response.data.is_admin);
      setHasAdminEmail(!!response.data.has_admin_email);
    } catch (error) {
      setIsAdmin(false);
      setHasAdminEmail(false);
    }
  };

  const promoteToAdmin = async () => {
    try {
      await api.post('/admin/act-as-normal', null, { params: { acting: false } });
      await checkAdmin();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (_) {}
  };

  const fetchRankingCounts = async () => {
    try {
      const [crimesRes, gtaRes, jailPlayersRes] = await Promise.all([
        api.get('/crimes'),
        api.get('/gta/options'),
        api.get('/jail/players')
      ]);

      const now = new Date();
      const crimesAvailable = Array.isArray(crimesRes.data) ? crimesRes.data.filter((c) => c?.can_commit).length : 0;
      const gtaAvailable = Array.isArray(gtaRes.data)
        ? gtaRes.data.filter((o) => {
            if (!o?.unlocked) return false;
            if (!o?.cooldown_until) return true;
            const t = new Date(o.cooldown_until);
            return !Number.isNaN(t.getTime()) && t <= now;
          }).length
        : 0;
      const jailCount = Array.isArray(jailPlayersRes.data?.players) ? jailPlayersRes.data.players.length : 0;

      setRankingCounts({ crimes: crimesAvailable, gta: gtaAvailable, jail: jailCount });
    } catch (error) {
      // silent failure; badges are optional
    }
  };

  const fetchTravelStatus = async () => {
    try {
      const res = await api.get('/travel/status');
      const data = res.data || {};
      if (data.traveling && data.seconds_remaining > 0) {
        setTravelStatus({
          traveling: true,
          destination: data.destination || data.current_state || '?',
          seconds_remaining: data.seconds_remaining
        });
      } else {
        setTravelStatus(null);
      }
    } catch {
      setTravelStatus(null);
    }
  };

  useEffect(() => {
    let intervalId;
    const deferred = setTimeout(() => {
      fetchTravelStatus();
      intervalId = setInterval(fetchTravelStatus, 1000);
    }, 0);
    return () => {
      clearTimeout(deferred);
      if (intervalId) clearInterval(intervalId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  const formatInt = (n) => {
    const num = Number(n ?? 0);
    if (Number.isNaN(num)) return '0';
    return Math.trunc(num).toLocaleString();
  };

  const formatMoney = (n) => {
    const num = Number(n ?? 0);
    if (Number.isNaN(num)) return '$0';
    return `$${Math.trunc(num).toLocaleString()}`;
  };

  const formatCompact = (n) => {
    const num = Number(n ?? 0);
    if (Number.isNaN(num)) return '0';
    const abs = Math.abs(num);
    if (abs >= 1e12) return (num / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
    if (abs >= 1e9) return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (abs >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return Math.trunc(num).toLocaleString();
  };

  const formatMoneyCompact = (n) => {
    const num = Number(n ?? 0);
    if (Number.isNaN(num)) return '$0';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1).replace(/\.0$/, '')}T`;
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return `$${Math.trunc(num).toLocaleString()}`;
  };

  // Order: Home → You → Money → Combat → Travel → Social → Ranking → Assets → Casino → Shop → Other. My Properties only if user has casino or property.
  const navItems = [
    { path: '/dashboard', icon: Home, label: 'Dashboard' },
    { path: '/objectives', icon: ListChecks, label: 'Objectives' },
    { path: '/missions', icon: Map, label: 'Missions' },
    { path: '/profile', icon: User, label: 'Profile' },
    { path: '/stats', icon: TrendingUp, label: 'Stats' },
    { path: '/bank', icon: Landmark, label: 'Bank' },
    { path: '/attack', icon: Sword, label: 'Attack' },
    { path: '/attempts', icon: Crosshair, label: 'Attempts' },
    { path: '/hitlist', icon: ScrollText, label: 'Hitlist' },
    { path: '/bodyguards', icon: Shield, label: 'Bodyguards' },
    { path: '/travel', icon: Plane, label: 'Travel' },
    { path: '/states', icon: MapPin, label: 'States' },
    ...(hasCasinoOrProperty ? [{ path: '/my-properties', icon: Building2, label: 'My Properties' }] : []),
    { path: '/booze-run', icon: Wine, label: 'Booze Run' },
    { path: '/users-online', icon: Users, label: 'Users Online' },
    { path: '/forum', icon: MessageSquare, label: 'Forum' },
    { path: '/inbox', icon: Mail, label: 'Inbox', badge: unreadCount },
    { path: '/ranking', icon: Target, label: 'Ranking' },
    { path: '/garage', icon: Car, label: 'Garage' },
    { path: '/sell-cars', icon: DollarSign, label: 'Sell Cars' },
    { path: '/buy-cars', icon: ShoppingBag, label: 'Buy Cars' },
    { path: '/properties', icon: Building, label: 'Properties' },
    { path: '/armour-weapons', icon: Sword, label: 'Armoury' },
    { path: '/casino', icon: Dice5, label: 'Casino' },
    { path: '/crack-safe', icon: Lock, label: 'Crack the Safe' },
    { path: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
    { path: '/store', icon: ShoppingBag, label: 'Store' },
    { path: '/quick-trade', icon: ArrowLeftRight, label: 'Quick Trade' },
    { path: '/families', icon: Building2, label: 'Families' },
    { path: '/dead-alive', icon: Skull, label: 'Dead > Alive' },
    { path: '/auto-rank', icon: Bot, label: 'Auto Rank' },
  ];

  const adminNavItems = isAdmin ? [
    { path: '/admin', icon: Settings, label: 'Admin Tools' },
    { path: '/admin/locked', icon: Lock, label: 'Locked accounts' },
  ] : [];

  /* Inline theme styles – same noir variables as other pages */
  const sidebarBgStyle = { backgroundColor: 'var(--noir-content)' };
  const sidebarActiveStyle = { background: 'var(--noir-raised)', backgroundImage: 'none', borderLeft: '3px solid var(--noir-primary)', color: 'var(--noir-primary)' };
  const sidebarActiveGroupStyle = { background: 'var(--noir-surface)', backgroundImage: 'none', borderLeft: '3px solid var(--noir-primary)', color: 'var(--noir-primary)' };

  return (
    <div className={`min-h-screen ${styles.page} ${styles.themeGangsterModern}`}>
      {/* Sidebar: hidden on mobile when bottom bar is selected; otherwise slide-out on mobile, always on md */}
      <div
        className={`fixed left-0 top-0 h-full w-48 ${styles.sidebar} z-50 transform transition-transform duration-300 ${
          mobileNavStyle === 'bottom' ? 'hidden md:translate-x-0 md:block' : `${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`
        }`}
        style={sidebarBgStyle}
      >
        <div className="flex flex-col h-full">
          {/* Logo – compact header */}
          <div className={`px-2.5 py-2 border-b ${styles.borderGoldLight} shrink-0`}>
            <div className="flex items-center gap-1.5">
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
            <p className={`text-[10px] mt-0.5 font-heading tracking-wider text-center ${styles.sidebarHeaderSub}`}>Chicago, 1927</p>
          </div>

          {/* Navigation – compact list */}
          <nav className={`flex-1 overflow-y-auto px-2 py-1.5 ${styles.sidebarNav} min-h-0`}>
            <div className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;

                // Ranking dropdown group
                if (item.path === '/ranking') {
                  const isAnyRankingActive =
                    location.pathname === '/ranking' ||
                    location.pathname === '/crimes' ||
                    location.pathname === '/gta' ||
                    location.pathname === '/jail' ||
                    location.pathname === '/organised-crime' ||
                    location.pathname === '/prestige';

                  return (
                    <div key="nav-ranking-group" className="space-y-0.5">
                      <button
                        type="button"
                        data-testid="nav-ranking-group"
                        onClick={() => setRankingOpen((v) => !v)}
                        className={`w-full flex items-center gap-1.5 px-2 py-1.5 min-h-[32px] rounded-sm transition-smooth ${
                          isAnyRankingActive ? styles.navItemActive : styles.sidebarNavLink
                        }`}
                        style={isAnyRankingActive ? sidebarActiveGroupStyle : undefined}
                      >
                        <Icon size={14} style={{ color: 'var(--noir-primary)' }} className="shrink-0" />
                        <span className="uppercase tracking-widest text-[10px] font-heading flex-1 text-left truncate">{item.label}</span>
                        {rankingOpen ? <ChevronDown size={12} style={{ color: 'var(--noir-primary)', opacity: 0.7 }} className="shrink-0" /> : <ChevronRight size={12} style={{ color: 'var(--noir-primary)', opacity: 0.7 }} className="shrink-0" />}
                      </button>

                      {rankingOpen && (
                        <div className={`ml-3 pl-1.5 space-y-0.5 ${styles.sidebarSubmenuBorder}`}>
                          <Link
                            to="/crimes"
                            onClick={() => setSidebarOpen(false)}
                            onMouseEnter={() => { api.get('/crimes').then((r) => setCrimesPrefetch(r.data)).catch(() => {}); }}
                            onFocus={() => { api.get('/crimes').then((r) => setCrimesPrefetch(r.data)).catch(() => {}); }}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/crimes' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/crimes' ? sidebarActiveStyle : undefined}
                            data-testid="nav-crimes"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Crimes</span>
                            {rankingCounts.crimes > 0 && (
                              <span
                                className="bg-emerald-600/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/30"
                                data-testid="badge-crimes-available"
                                title="Crimes available"
                              >
                                {rankingCounts.crimes}
                              </span>
                            )}
                          </Link>
                          <Link
                            to="/gta"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/gta' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/gta' ? sidebarActiveStyle : undefined}
                            data-testid="nav-gta"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">GTA</span>
                            {rankingCounts.gta > 0 && (
                              <span
                                className="bg-emerald-600/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/30"
                                data-testid="badge-gta-available"
                                title="GTA options available"
                              >
                                {rankingCounts.gta}
                              </span>
                            )}
                          </Link>
                          <Link
                            to="/jail"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/jail' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/jail' ? sidebarActiveStyle : undefined}
                            data-testid="nav-jail"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Jail</span>
                            {rankingCounts.jail > 0 && (
                              <span
                                className="bg-red-600/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-red-500/30"
                                data-testid="badge-jail-count"
                                title="Players in jail"
                              >
                                {rankingCounts.jail}
                              </span>
                            )}
                          </Link>
                          <Link
                            to="/organised-crime"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/organised-crime' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/organised-crime' ? sidebarActiveStyle : undefined}
                            data-testid="nav-organised-crime"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Organised Crime</span>
                          </Link>
                        </div>
                      )}
                    </div>
                  );
                }

                // Casino dropdown group
                if (item.path === '/casino') {
                  const isAnyCasinoActive =
                    location.pathname === '/casino' ||
                    location.pathname === '/casino/dice' ||
                    location.pathname === '/casino/rlt' ||
                    location.pathname === '/casino/blackjack' ||
                    location.pathname === '/casino/horseracing' ||
                    location.pathname === '/casino/slots' ||
                    location.pathname === '/casino/videopoker' ||
                    location.pathname === '/sports-betting';

                  return (
                    <div key="nav-casino-group" className="space-y-0.5">
                      <button
                        type="button"
                        data-testid="nav-casino-group"
                        onClick={() => setCasinoOpen((v) => !v)}
                        className={`w-full flex items-center gap-1.5 px-2 py-1.5 min-h-[32px] rounded-sm transition-smooth ${
                          isAnyCasinoActive ? styles.navItemActive : styles.sidebarNavLink
                        }`}
                        style={isAnyCasinoActive ? sidebarActiveGroupStyle : undefined}
                      >
                        <Icon size={14} style={{ color: 'var(--noir-primary)' }} className="shrink-0" />
                        <span className="uppercase tracking-widest text-[10px] font-heading flex-1 text-left truncate">{item.label}</span>
                        {casinoOpen ? <ChevronDown size={12} style={{ color: 'var(--noir-primary)', opacity: 0.7 }} className="shrink-0" /> : <ChevronRight size={12} style={{ color: 'var(--noir-primary)', opacity: 0.7 }} className="shrink-0" />}
                      </button>

                      {casinoOpen && (
                        <div className={`ml-4 pl-2 space-y-0.5 ${styles.sidebarSubmenuBorder}`}>
                          <Link
                            to="/casino/dice"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/casino/dice' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/casino/dice' ? sidebarActiveStyle : undefined}
                            data-testid="nav-dice"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Dice</span>
                          </Link>
                          <Link
                            to="/casino/rlt"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/casino/rlt' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/casino/rlt' ? sidebarActiveStyle : undefined}
                            data-testid="nav-roulette"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Roulette</span>
                          </Link>
                          <Link
                            to="/casino/blackjack"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/casino/blackjack' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/casino/blackjack' ? sidebarActiveStyle : undefined}
                            data-testid="nav-blackjack"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Blackjack</span>
                          </Link>
                          <Link
                            to="/casino/horseracing"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/casino/horseracing' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/casino/horseracing' ? sidebarActiveStyle : undefined}
                            data-testid="nav-horseracing"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Horse Racing</span>
                          </Link>
                          <Link
                            to="/casino/slots"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/casino/slots' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/casino/slots' ? sidebarActiveStyle : undefined}
                            data-testid="nav-slots"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Slots</span>
                          </Link>
                          <Link
                            to="/casino/videopoker"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/casino/videopoker' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/casino/videopoker' ? sidebarActiveStyle : undefined}
                            data-testid="nav-videopoker"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Video Poker</span>
                          </Link>
                          <Link
                            to="/sports-betting"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/sports-betting' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/sports-betting' ? sidebarActiveStyle : undefined}
                            data-testid="nav-sports-betting"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Sports Betting</span>
                          </Link>
                        </div>
                      )}
                    </div>
                  );
                }

                const isFamiliesAtWar = item.path === '/families' && atWar;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                    data-at-war={atWar && item.path === '/families' ? 'true' : undefined}
                    className={`flex items-center gap-1.5 px-2 py-1.5 min-h-[32px] rounded-sm transition-smooth ${
                      isFamiliesAtWar
                        ? isActive
                          ? 'bg-red-500/20 text-red-400 border-l-2 border-red-500'
                          : 'text-red-400 hover:bg-red-500/10'
                        : isActive
                          ? styles.navItemActivePage
                          : styles.sidebarNavLink
                    }`}
                    style={isFamiliesAtWar ? { color: '#f87171' } : isActive ? sidebarActiveStyle : undefined}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Icon size={14} className="shrink-0" style={isFamiliesAtWar ? { color: '#f87171' } : { color: 'var(--noir-primary)' }} />
                    <span className="uppercase tracking-widest text-[10px] font-heading flex-1 truncate">{item.label}</span>
                    {isFamiliesAtWar && <AlertTriangle size={14} className="shrink-0" style={{ color: '#f87171' }} aria-hidden />}
                    {item.badge > 0 && (
                      <span className="bg-red-600/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-red-500/30">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}

              {/* Prestige — always visible */}
              <Link
                to="/prestige"
                data-testid="nav-prestige"
                className={`flex items-center gap-1.5 px-2 py-1.5 min-h-[32px] rounded-sm transition-smooth mt-0.5 ${
                  location.pathname === '/prestige' ? styles.navItemActivePage : styles.sidebarNavLink
                }`}
                style={location.pathname === '/prestige' ? sidebarActiveStyle : { borderTop: '1px solid rgba(var(--noir-primary-rgb),0.12)', marginTop: 4, paddingTop: 8 }}
                onClick={() => setSidebarOpen(false)}
              >
                <Trophy size={14} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
                <span className="uppercase tracking-widest text-[10px] font-heading flex-1 truncate">Prestige</span>
                {rankProgress?.current_rank >= 11 && (user?.prestige_level ?? 0) < 5 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" title="You can prestige!" />
                )}
              </Link>

              {/* Admin Section */}
              {adminNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-sm transition-smooth border-t border-primary/20 mt-1.5 pt-1.5 ${
                      isActive
                        ? 'bg-red-600/20 text-red-400 border-l-2 border-red-500'
                        : 'text-red-400 hover:bg-red-500/10'
                    }`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Icon size={16} />
                    <span className="uppercase tracking-widest text-xs font-heading">{item.label}</span>
                  </Link>
                );
              })}
              {hasAdminEmail && !isAdmin && (
                <button
                  type="button"
                  onClick={() => { promoteToAdmin(); setSidebarOpen(false); }}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-sm transition-smooth border-t border-primary/20 mt-1.5 pt-1.5 w-full text-left text-amber-400 hover:bg-amber-500/10 text-[10px]"
                >
                  <Shield size={16} />
                  <span className="uppercase tracking-widest text-xs font-heading">Use admin powers</span>
                </button>
              )}
            </div>
          </nav>

          {/* Theme & Logout – compact */}
          {user && (
            <div className={`px-2 py-1.5 border-t ${styles.borderGoldLight} shrink-0 space-y-1`}>
              <button
                type="button"
                onClick={() => setThemePickerOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-sm transition-smooth uppercase tracking-widest text-[10px] font-heading font-bold border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                data-testid="theme-picker-button"
              >
                <Palette size={12} />
                Theme
              </button>
              <button
                onClick={handleLogout}
                data-testid="logout-button"
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-gradient-to-r from-red-700 to-red-900 text-white border border-red-600/50 rounded-sm hover:opacity-90 transition-smooth uppercase tracking-widest text-[10px] font-heading font-bold"
              >
                <LogOut size={12} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile overlay (only when sidebar mode and menu open) */}
      {sidebarOpen && mobileNavStyle !== 'bottom' && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Top bar */}
      <div className={`fixed top-0 right-0 left-0 md:left-48 min-h-[48px] md:h-12 ${styles.topBar} backdrop-blur-md z-30 flex flex-col md:flex-row md:items-center px-3 md:px-3 gap-2 md:gap-2 py-2 md:py-0`}>
        <div className="flex items-center gap-2 md:gap-2 flex-1 min-w-0 shrink-0 overflow-hidden md:justify-end">
        {mobileNavStyle !== 'bottom' && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            data-testid="mobile-menu-toggle"
            className="md:hidden shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -m-2"
            style={{ color: 'var(--noir-primary)' }}
            aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          >
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        )}

        {/* Flash news ticker */}
        <div className="flex-1 min-w-0 overflow-hidden hidden sm:flex items-center gap-2">
          {flashNews.length > 0 ? (
            <div className="flex items-center gap-2 min-w-0">
              <Newspaper size={14} className="shrink-0 text-primary/70" aria-hidden />
              <span className="text-xs text-mutedForeground truncate font-heading" title={flashNews[flashIndex]?.message}>
                {flashNews[flashIndex]?.message}
              </span>
              {flashNews.length > 1 && (
                <span className="text-[10px] text-primary/50 shrink-0 font-heading">
                  {flashIndex + 1}/{flashNews.length}
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* Travel Countdown Indicator */}
        {travelStatus && travelStatus.traveling && travelStatus.seconds_remaining > 0 && (
          <div 
            className="flex items-center gap-1.5 bg-amber-900/40 border border-amber-500/40 px-2 py-1 rounded-sm animate-pulse cursor-pointer shrink-0"
            onClick={() => navigate('/travel')}
            title={`Traveling to ${travelStatus.destination}`}
          >
            <span className="text-base">🚗</span>
            <span className="font-heading text-xs text-amber-400 font-bold">
              {travelStatus.seconds_remaining}s
            </span>
            <span className="hidden sm:inline font-heading text-[10px] text-amber-300/80 truncate max-w-[80px]">
              → {travelStatus.destination}
            </span>
          </div>
        )}

        {user && (() => {
          const handleDragStart = (e, statId) => {
            e.dataTransfer.setData('text/plain', statId);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.dropEffect = 'move';
            setDraggingStatId(statId);
          };
          const handleDragEnd = () => {
            setDraggingStatId(null);
          };
          const handleDragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          };
          const handleDrop = (e, targetId) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId || draggedId === targetId) return;
            setStatOrder((prev) => {
              const next = prev.filter((id) => id !== draggedId);
              const idx = next.indexOf(targetId);
              next.splice(idx < 0 ? next.length : idx, 0, draggedId);
              try { localStorage.setItem(TOPBAR_STAT_ORDER_KEY, JSON.stringify(next)); } catch (_) {}
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
              return next;
            });
          };
          const setTopBarGapPersist = (v) => {
            try { localStorage.setItem(TOPBAR_GAP_KEY, v); } catch (_) {}
            window.dispatchEvent(new Event('topbar-prefs-changed'));
          };
          const setTopBarSizePersist = (v) => {
            try { localStorage.setItem(TOPBAR_SIZE_KEY, v); } catch (_) {}
            window.dispatchEvent(new Event('topbar-prefs-changed'));
          };
          const casinoProfit = user.casino_profit ?? 0;
          const propertyProfit = user.property_profit ?? 0;
          const topBarGapClass = topBarGap === 'compact' ? 'gap-1 md:gap-2' : topBarGap === 'spread' ? 'gap-3 md:gap-4' : 'gap-2 md:gap-2';
          const topBarIconSize = topBarSize === 'small' ? 12 : topBarSize === 'large' ? 20 : 16;
          const topBarIconSizeEffective = isMobileViewport ? Math.max(16, topBarIconSize) : topBarIconSize;
          const topBarChipPadding = topBarSize === 'small' ? 'px-2 py-1.5 md:px-1.5 md:py-0.5' : topBarSize === 'large' ? 'px-2.5 py-1.5 md:px-2.5 md:py-1.5' : 'px-2 py-1.5 md:px-2 md:py-1';
          const topBarTextClass = topBarSize === 'small' ? 'text-xs md:text-[10px]' : topBarSize === 'large' ? 'text-sm' : 'text-xs';
          const renderStat = (statId) => {
            const chipClass = `flex items-center gap-1 bg-noir-surface/90 border border-primary/20 ${topBarChipPadding} rounded-sm shrink-0 min-h-[40px] md:min-h-0 cursor-grab active:cursor-grabbing touch-manipulation`;
            if (statId === 'rank') {
              const pct = rankProgress ? Number(rankProgress.rank_points_progress) : 0;
              const current = rankProgress ? (Number(rankProgress.rank_points_current) || 0) : 0;
              const needed = rankProgress ? (Number(rankProgress.rank_points_needed) || 0) : 0;
              const total = current + needed;
              const progress = rankProgress
                ? ((typeof pct === 'number' && !Number.isNaN(pct) && pct > 0)
                  ? Math.min(100, Math.max(0, pct))
                  : (total > 0 ? Math.min(100, (current / total) * 100) : needed === 0 ? 100 : 0))
                : 0;
              const hasPremiumBar = !!user?.premium_rank_bar;
              const progressLabel = rankProgress ? (hasPremiumBar ? progress.toFixed(2) : progress.toFixed(0)) : '—';
              const rankName = rankProgress?.current_rank_name ?? 'Rank';
              return (
                <div className={`${chipClass} gap-1.5 sm:gap-2 min-w-0`} title={rankProgress ? `${rankName}: ${progressLabel}%` : 'Rank progress'}>
                  <TrendingUp size={topBarIconSizeEffective} className="text-primary shrink-0" aria-hidden />
                  <div className="flex flex-col min-w-[5rem] flex-1 sm:flex-initial shrink-0">
                    <span className="hidden sm:inline text-[10px] text-mutedForeground leading-none font-heading truncate">{rankName}</span>
                    <div className="w-10 sm:w-16 shrink-0" style={{ position: 'relative', height: 6, backgroundColor: '#333333', borderRadius: 9999, overflow: 'hidden', marginTop: 2 }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${progress}%`, minWidth: progress > 0 ? 4 : 0, background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))', borderRadius: 9999, transition: 'width 0.3s ease' }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} />
                    </div>
                  </div>
                  <span className={`${topBarTextClass} text-primary font-heading shrink-0 tabular-nums min-w-[2.5rem] text-right`}>{progressLabel}{rankProgress ? '%' : ''}</span>
                </div>
              );
            }
            if (statId === 'bullets') {
              const bulletsStr = formatInt(user.bullets);
              return (
                <div className={`${chipClass} hidden md:flex min-w-0`} title={`Bullets: ${bulletsStr}`}>
                  <Crosshair size={topBarIconSizeEffective} className="text-red-400 shrink-0" aria-hidden />
                  <span className={`font-heading ${topBarTextClass} text-foreground tabular-nums truncate max-w-[6rem]`} data-testid="topbar-bullets">{bulletsStr}</span>
                </div>
              );
            }
            if (statId === 'kills') {
              const killsStr = formatInt(user.total_kills);
              return (
                <div className={`${chipClass} hidden md:flex min-w-0`} title={`Kills: ${killsStr}`}>
                  <Skull size={topBarIconSizeEffective} className="text-red-400 shrink-0" aria-hidden />
                  <span className={`font-heading ${topBarTextClass} text-foreground tabular-nums min-w-[1.5rem] text-right`} data-testid="topbar-kills">{killsStr}</span>
                </div>
              );
            }
            if (statId === 'money') {
              const moneyFull = formatMoney(user.money);
              const moneyCompact = formatMoneyCompact(user.money);
              const useCompact = moneyFull.length > 14;
              return (
                <div className={`${chipClass} min-w-0`} title={`Cash: ${moneyFull}`}>
                  <DollarSign size={topBarIconSizeEffective} className="text-primary shrink-0" aria-hidden />
                  <span className={`font-heading ${topBarTextClass} text-primary md:hidden`} data-testid="topbar-money">{moneyCompact}</span>
                  <span className={`font-heading text-xs text-primary hidden md:inline tabular-nums ${useCompact ? '' : 'truncate max-w-[7rem]'}`} data-testid="topbar-money-full">{useCompact ? moneyCompact : moneyFull}</span>
                </div>
              );
            }
            if (statId === 'points') {
              const pointsFull = formatInt(user.points);
              const pointsCompact = formatCompact(user.points);
              const useCompactDesktop = pointsFull.length > 12;
              return (
                <div className={`${chipClass} min-w-0`} title={`Premium Points: ${pointsFull}`}>
                  <Zap size={topBarIconSizeEffective} className="text-primary shrink-0" aria-hidden />
                  <span className={`font-heading ${topBarTextClass} text-foreground md:hidden tabular-nums`} data-testid="topbar-points">{pointsFull}</span>
                  <span className={`font-heading text-xs text-foreground hidden md:inline tabular-nums ${useCompactDesktop ? '' : 'truncate max-w-[6rem]'}`} data-testid="topbar-points-full">{useCompactDesktop ? `${pointsCompact} pts` : pointsFull}</span>
                </div>
              );
            }
            if (statId === 'property') {
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
                <div className={`${chipClass} min-w-0`} title={`Casino ${casinoStr} · Property ${propertyStr}`}>
                  <Building2 size={topBarIconSizeEffective} className="text-emerald-400 shrink-0" aria-hidden />
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
            if (statId === 'notifications') {
              return null;
            }
            return null;
          };
          return (
            <>
            <div className={`hidden md:flex items-center ${topBarGapClass} shrink-0 py-1 md:py-0 md:mx-0 md:px-0`}>
              {/* Search + rank + stats cluster aligned right */}
              <div className="flex items-center shrink-0 gap-1 md:gap-1.5">
                <div className="relative shrink-0 z-10" ref={userSearchRef}>
                  {!userSearchExpanded ? (
                    <button
                      type="button"
                      draggable={false}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setUserSearchExpanded(true);
                        setUserSearchOpen(true);
                        setTimeout(() => userSearchInputRef.current?.focus(), 0);
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      className={`flex items-center justify-center gap-1 bg-noir-surface/90 border border-primary/20 rounded-sm text-primary hover:bg-noir-raised/90 active:scale-95 transition-colors cursor-pointer touch-manipulation ${topBarChipPadding}`}
                      aria-label="Search user"
                      title="Search user"
                    >
                      <Search size={topBarIconSizeEffective} strokeWidth={2} />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 bg-noir-surface/90 border border-primary/20 rounded-sm px-2 py-1.5 min-w-[140px] max-w-[180px] md:min-w-[120px] md:py-0.5 md:px-1.5">
                      <Search size={14} className="text-primary/50 shrink-0 md:w-3 md:h-3" aria-hidden />
                      <input
                        ref={userSearchInputRef}
                        type="text"
                        value={userSearchQuery}
                        onChange={(e) => { setUserSearchQuery(e.target.value); setUserSearchOpen(true); }}
                        onFocus={() => setUserSearchOpen(true)}
                        placeholder="Search user..."
                        className="flex-1 min-w-0 py-0.5 bg-transparent font-heading text-foreground placeholder:text-mutedForeground focus:outline-none border-0 text-[16px] md:text-[11px]"
                        data-testid="topbar-user-search"
                        autoComplete="off"
                      />
                    </div>
                  )}
                  {userSearchExpanded && userSearchOpen && (
                    <div
                      className="absolute top-full left-0 mt-1 w-[min(calc(100vw-2rem),260px)] max-w-[260px] max-h-[min(60vh,280px)] overflow-y-auto rounded border shadow-xl z-[100] flex flex-col"
                      style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-border-mid)' }}
                    >
                      <div className="p-2.5 border-b shrink-0 md:p-2" style={{ borderColor: 'var(--noir-border)' }}>
                        <p className="text-xs font-heading text-mutedForeground md:text-[10px]">Find any user — online, offline, or dead</p>
                      </div>
                      <div className="flex-1 min-h-0">
                        {userSearchLoading ? (
                          <div className="p-4 text-center text-sm font-heading text-mutedForeground md:p-3 md:text-[11px]">Searching...</div>
                        ) : userSearchResults.length === 0 ? (
                          <div className="p-4 text-center text-sm font-heading text-mutedForeground md:p-3 md:text-[11px]">
                            {userSearchQuery.trim().length < 1 ? 'Type to search' : 'No users found'}
                          </div>
                        ) : (
                          userSearchResults.map((u) => (
                            <Link
                              key={u.username}
                              to={`/profile/${encodeURIComponent(u.username)}`}
                              onClick={() => { setUserSearchOpen(false); setUserSearchExpanded(false); setUserSearchQuery(''); setUserSearchResults([]); }}
                              className="flex items-center justify-between gap-2 w-full text-left px-3 py-3 min-h-[44px] border-b font-heading text-sm hover:bg-noir-raised/80 active:bg-noir-raised/90 transition-colors touch-manipulation md:py-2 md:min-h-0"
                              style={{ borderColor: 'var(--noir-border)', color: 'var(--noir-foreground)' }}
                            >
                              <span className="truncate font-semibold">{u.username}</span>
                              <div className="flex gap-1 shrink-0">
                                {u.is_dead && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 md:text-[9px] md:px-1">Dead</span>}
                                {u.in_jail && !u.is_dead && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 md:text-[9px] md:px-1">Jail</span>}
                                {u.is_bodyguard && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 md:text-[9px] md:px-1">Robot</span>}
                              </div>
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {statOrder.includes('rank') && (() => {
                  const content = renderStat('rank');
                  if (!content) return null;
                  return (
                    <div key="rank" draggable={!isMobileViewport} onDragStart={(e) => handleDragStart(e, 'rank')} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'rank')} onDragEnd={handleDragEnd} className={`shrink-0 transition-all duration-150 ease-out ${isMobileViewport ? '' : 'cursor-grab active:cursor-grabbing'} ${draggingStatId === 'rank' ? 'opacity-50 scale-95' : ''}`}>
                      {content}
                    </div>
                  );
                })()}
              </div>
              {/* Scrollable right: other stats */}
              <div className={`flex items-center ${topBarGapClass} flex-1 min-w-0 justify-end overflow-x-auto overflow-y-hidden scrollbar-thin scroll-smooth touch-pan-x snap-x snap-mandatory [scrollbar-width:thin]`}>
                {statOrder.filter((statId) => statId !== 'rank' && statId !== 'notifications').map((statId) => {
                  const content = renderStat(statId);
                  if (!content) return null;
                  return (
                    <div key={statId} draggable={!isMobileViewport} onDragStart={(e) => handleDragStart(e, statId)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, statId)} onDragEnd={handleDragEnd} className={`shrink-0 snap-start transition-all duration-150 ease-out ${isMobileViewport ? '' : 'cursor-grab active:cursor-grabbing'} ${draggingStatId === statId ? 'opacity-50 scale-95' : ''}`}>
                      {content}
                    </div>
                  );
                })}
                {isMobileViewport && (
                  <button
                    type="button"
                    onClick={() => setTopBarCustomizeOpen(true)}
                    className="shrink-0 flex items-center justify-center gap-1 min-h-[40px] px-2 py-1.5 rounded-sm bg-noir-surface/90 border border-primary/20 text-primary hover:bg-noir-raised/90 transition-colors touch-manipulation"
                    aria-label="Customize top bar"
                    title="Reorder, size & spacing"
                  >
                    <Settings size={topBarIconSizeEffective} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
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
                              <button type="button" onClick={() => moveStat(idx, 'up')} disabled={idx === 0} className="p-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation" style={{ borderColor: 'var(--noir-border-mid)' }} aria-label="Move up">
                                <ChevronUp size={18} strokeWidth={2} style={{ color: 'var(--noir-foreground)' }} />
                              </button>
                              <button type="button" onClick={() => moveStat(idx, 'down')} disabled={idx === statOrder.length - 1} className="p-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation" style={{ borderColor: 'var(--noir-border-mid)' }} aria-label="Move down">
                                <ChevronDown size={18} strokeWidth={2} style={{ color: 'var(--noir-foreground)' }} />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] font-heading uppercase tracking-wider mb-2" style={{ color: 'var(--noir-muted)' }}>Chip size</p>
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

      {/* Main content */}
      <main className={`md:ml-48 mt-12 min-h-screen p-4 md:p-6 overflow-x-hidden ${mobileNavStyle === 'bottom' ? 'pb-24 md:pb-6' : ''}`}>
        {children}
      </main>

      {/* Mobile bottom nav (only when theme set to "Bottom bar" and on small screens) */}
      {mobileNavStyle === 'bottom' && (
        <div ref={mobileBottomNavRef} className="md:hidden fixed bottom-0 left-0 right-0 z-40">
          {/* Sub-menu panel above bar when Ranking or Casino is opened */}
          {mobileBottomMenuOpen && (() => {
            const group = mobileBottomNavItems.find((i) => i.type === 'group' && i.id === mobileBottomMenuOpen);
            if (!group || group.type !== 'group') return null;
            return (
              <div
                className="absolute bottom-full left-0 right-0 border-t border-primary/20 shadow-lg max-h-[60vh] overflow-y-auto"
                style={{ backgroundColor: 'var(--noir-surface)', borderBottom: '1px solid var(--noir-border-mid)' }}
                role="menu"
              >
                <div className="py-2 grid grid-cols-2 gap-px">
                  {group.items.map((sub, idx) => {
                    if (sub.action === 'theme') {
                      return (
                        <button
                          key="theme"
                          type="button"
                          onClick={() => { setThemePickerOpen(true); setMobileBottomMenuOpen(null); }}
                          role="menuitem"
                          className="block w-full px-3 py-2.5 text-left text-xs font-heading uppercase tracking-wider transition-colors hover:bg-primary/10"
                          style={{ color: 'var(--noir-foreground)' }}
                        >
                          {sub.label}
                        </button>
                      );
                    }
                    if (sub.action === 'logout') {
                      return (
                        <button
                          key="logout"
                          type="button"
                          onClick={() => { handleLogout(); setMobileBottomMenuOpen(null); }}
                          role="menuitem"
                          className="block w-full px-3 py-2.5 text-left text-xs font-heading uppercase tracking-wider transition-colors bg-red-900/30 text-red-300 hover:bg-red-900/50 col-span-2"
                        >
                          {sub.label}
                        </button>
                      );
                    }
                    if (sub.action === 'promoteAdmin') {
                      return (
                        <button
                          key="promoteAdmin"
                          type="button"
                          onClick={() => { promoteToAdmin(); setMobileBottomMenuOpen(null); }}
                          role="menuitem"
                          className="block w-full px-3 py-2.5 text-left text-xs font-heading uppercase tracking-wider transition-colors text-amber-400 hover:bg-amber-500/10 col-span-2"
                        >
                          {sub.label}
                        </button>
                      );
                    }
                    const to = sub.state ? { pathname: sub.path, state: sub.state } : sub.path;
                    const isActive = sub.state
                      ? location.pathname === sub.path && location.state?.category === sub.state?.category
                      : sub.path === '/forum'
                        ? location.pathname === '/forum' && !location.state?.category
                        : location.pathname === sub.path || location.pathname.startsWith(sub.path + '/');
                    const prefetchCrimes = sub.path === '/crimes' ? () => { api.get('/crimes').then((r) => setCrimesPrefetch(r.data)).catch(() => {}); } : undefined;
                    return (
                      <Link
                        key={sub.path ? `${sub.path}-${sub.label}` : idx}
                        to={to}
                        onClick={() => setMobileBottomMenuOpen(null)}
                        onMouseEnter={prefetchCrimes}
                        onFocus={prefetchCrimes}
                        role="menuitem"
                        className={`block w-full px-3 py-2.5 text-left text-xs font-heading uppercase tracking-wider transition-colors ${
                          isActive ? 'bg-primary/20' : ''
                        }`}
                        style={isActive ? { color: 'var(--noir-primary)' } : { color: 'var(--noir-foreground)' }}
                      >
                        {sub.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <nav
            className="flex items-center justify-between gap-0 overflow-x-auto overflow-y-hidden py-1.5 px-1 safe-area-pb scrollbar-thin"
            style={{ backgroundColor: 'var(--noir-content)', borderTop: '1px solid var(--noir-border-mid)' }}
            aria-label="Mobile navigation"
          >
            {hasCasinoOrProperty && typeof user?.casino_profit === 'number' && (
              <div
                className="shrink-0 flex items-center px-2 py-1 rounded-md border font-heading text-[10px] font-bold tabular-nums"
                style={{
                  borderColor: 'var(--noir-border-mid)',
                  backgroundColor: 'var(--noir-surface)',
                  color: user.casino_profit >= 0 ? 'var(--emerald-400, #34d399)' : 'var(--red-400, #f87171)',
                }}
                title={user.casino_profit >= 0 ? 'Casino profit (players losing)' : 'Casino loss (players winning)'}
              >
                {user.casino_profit >= 0 ? '+' : ''}{formatMoney(user.casino_profit)}
              </div>
            )}
            {mobileBottomNavItems.map((item) => {
              const Icon = item.icon;
              if (item.type === 'link') {
                const isActive = location.pathname === item.path || (item.path !== '/dashboard' && location.pathname.startsWith(item.path + '/'));
                const isInbox = item.path === '/inbox';
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => { setSidebarOpen(false); setMobileBottomMenuOpen(null); }}
                    className={`flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 min-h-[40px] rounded-lg transition-colors ${
                      isActive ? 'bg-primary/25 border border-primary/50' : ''
                    }`}
                    style={isActive ? { color: 'var(--noir-primary)' } : { color: 'var(--noir-foreground)' }}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.label}
                  >
                    <span className="relative inline-flex">
                      <Icon size={15} strokeWidth={2} />
                      {isInbox && unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-1.5 min-w-[12px] h-[12px] rounded-full bg-red-600 text-[9px] font-bold text-white flex items-center justify-center px-0.5">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="text-[8px] font-heading uppercase tracking-wider truncate max-w-[52px]">{item.label}</span>
                  </Link>
                );
              }
              if (item.type === 'group') {
                const isOpen = mobileBottomMenuOpen === item.id;
                const isActive = item.items.some((sub) => {
                  if (sub.state) return location.pathname === sub.path && location.state?.category === sub.state?.category;
                  return location.pathname === sub.path || (sub.path !== '/casino' && sub.path !== '/forum' && location.pathname.startsWith(sub.path + '/'));
                });
                const showInboxBadge = item.items.some((sub) => sub.path === '/inbox') && unreadCount > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMobileBottomMenuOpen(isOpen ? null : item.id); }}
                    className={`flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 min-h-[40px] rounded-lg transition-colors ${
                      isOpen || isActive ? 'bg-primary/25 border border-primary/50' : ''
                    }`}
                    style={isOpen || isActive ? { color: 'var(--noir-primary)' } : { color: 'var(--noir-foreground)' }}
                    aria-expanded={isOpen}
                    aria-haspopup="true"
                    title={item.label}
                  >
                    <span className="relative inline-flex">
                      <Icon size={15} strokeWidth={2} />
                      {showInboxBadge && (
                        <span className="absolute -top-0.5 -right-1.5 min-w-[12px] h-[12px] rounded-full bg-red-600 text-[9px] font-bold text-white flex items-center justify-center px-0.5">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="text-[8px] font-heading uppercase tracking-wider truncate max-w-[52px]">{item.label}</span>
                  </button>
                );
              }
              return null;
            })}
          </nav>
        </div>
      )}

      {/* Floating mobile menu ball: all stats, search, notifications; draggable, position persisted */}
      {user && notificationBallPosition && isMobileViewport && (
        <div
          ref={notificationBallRef}
          className="fixed z-50 touch-none"
          style={{
            left: notificationBallPosition.x,
            top: notificationBallPosition.y,
            width: 56,
            height: 56,
          }}
        >
          <button
            type="button"
            className="relative w-full h-full rounded-full flex items-center justify-center shadow-lg border-2 transition-transform active:scale-95 select-none"
            style={{
              backgroundColor: 'var(--noir-content)',
              borderColor: 'var(--noir-primary)',
              color: 'var(--noir-primary)',
            }}
            aria-label="Stats and notifications"
            onPointerDown={(e) => {
              e.preventDefault();
              const ballX = notificationBallPosition.x;
              const ballY = notificationBallPosition.y;
              notificationDragRef.current = { isDragging: false, startX: e.clientX, startY: e.clientY, ballX, ballY, lastX: ballX, lastY: ballY };
              const onMove = (e2) => {
                const r = notificationDragRef.current;
                if (!r) return;
                const dx = e2.clientX - r.startX;
                const dy = e2.clientY - r.startY;
                if (!r.isDragging && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) r.isDragging = true;
                if (r.isDragging) {
                  const w = window.innerWidth;
                  const h = window.innerHeight;
                  const size = 56;
                  const nextX = Math.max(0, Math.min(w - size, r.ballX + dx));
                  const nextY = Math.max(0, Math.min(h - size, r.ballY + dy));
                  r.lastX = nextX;
                  r.lastY = nextY;
                  setNotificationBallPosition({ x: nextX, y: nextY });
                }
              };
              const onUp = () => {
                const r = notificationDragRef.current;
                if (!r) return;
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
                if (r.isDragging) {
                  try {
                    localStorage.setItem(NOTIFICATION_BALL_POSITION_KEY, JSON.stringify({ x: r.lastX, y: r.lastY }));
                  } catch (_) {}
                } else {
                  openNotificationPanel();
                }
                notificationDragRef.current = null;
              };
              document.addEventListener('pointermove', onMove);
              document.addEventListener('pointerup', onUp);
              document.addEventListener('pointercancel', onUp);
            }}
          >
            <LayoutGrid size={26} strokeWidth={2} className="shrink-0" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[20px] h-[20px] rounded-full flex items-center justify-center text-[11px] font-heading font-bold text-white"
                style={{ backgroundColor: 'var(--noir-primary)' }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {notificationPanelOpen && (
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[min(340px,calc(100vw-1.5rem))] max-h-[min(85vh,520px)] flex flex-col rounded-xl border-2 shadow-xl overflow-hidden"
              style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-border-mid)' }}
            >
              <div className="p-3 border-b shrink-0 flex items-center gap-2" style={{ borderColor: 'var(--noir-border)' }}>
                <h3 className="font-heading font-semibold text-sm shrink-0" style={{ color: 'var(--noir-primary)' }}>Stats & Notifications</h3>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 p-2 space-y-2">
                {/* User search */}
                <div className="flex items-center gap-2">
                  <Search size={16} className="shrink-0" style={{ color: 'var(--noir-muted)' }} />
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => { setUserSearchQuery(e.target.value); setUserSearchOpen(true); }}
                    onFocus={() => { setUserSearchOpen(true); }}
                    placeholder="Search user..."
                    className="flex-1 min-w-0 py-2 px-3 rounded-lg border font-heading text-sm bg-noir-surface border-primary/20"
                    style={{ color: 'var(--noir-foreground)' }}
                    autoComplete="off"
                  />
                </div>
                {userSearchOpen && userSearchQuery.trim().length > 0 && (
                  <div className="rounded-lg border overflow-hidden max-h-40 overflow-y-auto" style={{ borderColor: 'var(--noir-border-mid)', backgroundColor: 'var(--noir-surface)' }}>
                    {userSearchLoading ? (
                      <div className="p-3 text-center text-xs font-heading" style={{ color: 'var(--noir-muted)' }}>Searching...</div>
                    ) : userSearchResults.length === 0 ? (
                      <div className="p-3 text-center text-xs font-heading" style={{ color: 'var(--noir-muted)' }}>No users found</div>
                    ) : (
                      userSearchResults.map((u) => (
                        <Link
                          key={u.username}
                          to={`/profile/${encodeURIComponent(u.username)}`}
                          onClick={() => { setUserSearchOpen(false); setUserSearchQuery(''); setUserSearchResults([]); setNotificationPanelOpen(false); }}
                          className="block w-full text-left px-3 py-2.5 border-b font-heading text-sm"
                          style={{ borderColor: 'var(--noir-border)', color: 'var(--noir-foreground)' }}
                        >
                          {u.username}
                        </Link>
                      ))
                    )}
                  </div>
                )}
                {/* Stats rows */}
                <div className="grid grid-cols-2 gap-2">
                  {rankProgress && (
                    <div className="col-span-2 flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                      <TrendingUp size={18} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-heading text-xs truncate" style={{ color: 'var(--noir-muted)' }}>{rankProgress.current_rank_name}</p>
                        <div className="h-1.5 w-full rounded-full mt-1 overflow-hidden" style={{ backgroundColor: '#333' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, Number(rankProgress.rank_points_progress) || 0))}%`, background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))' }} />
                        </div>
                      </div>
                      <span className="font-heading text-xs font-bold shrink-0" style={{ color: 'var(--noir-primary)' }}>
                        {(user?.premium_rank_bar ? (Number(rankProgress.rank_points_progress) || 0).toFixed(2) : (Number(rankProgress.rank_points_progress) || 0).toFixed(0))}%
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                    <DollarSign size={18} className="shrink-0" style={{ color: 'var(--noir-primary)' }} />
                    <span className="font-heading text-sm truncate" style={{ color: 'var(--noir-foreground)' }}>{formatMoney(user.money)}</span>
                  </div>
                  <div className="flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                    <Zap size={18} className="shrink-0" style={{ color: 'var(--noir-foreground)' }} />
                    <span className="font-heading text-sm truncate" style={{ color: 'var(--noir-foreground)' }}>{formatInt(user.points)} pts</span>
                  </div>
                  <div className="flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                    <Crosshair size={18} className="shrink-0 text-red-400" />
                    <span className="font-heading text-sm" style={{ color: 'var(--noir-foreground)' }}>{formatInt(user.bullets)}</span>
                  </div>
                  <div className="flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                    <Skull size={18} className="shrink-0 text-red-400" />
                    <span className="font-heading text-sm" style={{ color: 'var(--noir-foreground)' }}>{formatInt(user.total_kills)}</span>
                  </div>
                  <div className="col-span-2 flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ borderColor: 'var(--noir-border)', backgroundColor: 'var(--noir-surface)' }}>
                    <Building2 size={18} className="shrink-0 text-emerald-400" />
                    <span className="font-heading text-xs truncate" style={{ color: 'var(--noir-foreground)' }}>
                      C {formatMoneyCompact(user.casino_profit ?? 0)} · P {formatCompact(user.property_profit ?? 0)} pts
                    </span>
                  </div>
                </div>
                {/* Notifications */}
                <div className="pt-1 border-t" style={{ borderColor: 'var(--noir-border)' }}>
                  <p className="font-heading text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--noir-muted)' }}>Notifications</p>
                  {notificationList.length === 0 ? (
                    <div className="py-3 text-center font-heading text-xs" style={{ color: 'var(--noir-muted)' }}>No notifications</div>
                  ) : (
                    <div className="space-y-0 rounded-lg overflow-hidden border" style={{ borderColor: 'var(--noir-border)' }}>
                      {notificationList.slice(0, 8).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => { setNotificationPanelOpen(false); navigate('/inbox'); }}
                          className="w-full text-left px-3 py-2 border-b font-heading text-xs last:border-b-0"
                          style={{ borderColor: 'var(--noir-border)', color: n.read ? 'var(--noir-muted)' : 'var(--noir-foreground)', backgroundColor: n.read ? 'transparent' : 'rgba(var(--noir-primary-rgb), 0.08)' }}
                        >
                          <span className="font-semibold block truncate">{n.title}</span>
                          <span className="block truncate mt-0.5 opacity-90">{n.message}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="p-2 border-t shrink-0 flex flex-wrap gap-2" style={{ borderColor: 'var(--noir-border)' }}>
                <button type="button" onClick={() => { setNotificationPanelOpen(false); navigate('/inbox'); }} className="py-1.5 px-3 rounded-lg text-xs font-heading border" style={{ borderColor: 'var(--noir-primary)', color: 'var(--noir-primary)' }}>View inbox</button>
                <button type="button" onClick={() => { markAllNotificationsRead(); }} className="py-1.5 px-3 rounded-lg text-xs font-heading border" style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-foreground)' }}>Clear all</button>
                <button type="button" onClick={() => { setNotificationPanelOpen(false); setTopBarCustomizeOpen(true); }} className="py-1.5 px-3 rounded-lg text-xs font-heading border ml-auto" style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-muted)' }}>Customize bar</button>
              </div>
            </div>
          )}
        </div>
      )}

      <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
    </div>
  );
}
