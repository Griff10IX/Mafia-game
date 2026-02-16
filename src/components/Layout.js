import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, Home, Target, Shield, Building, Building2, Dice5, Sword, Trophy, ShoppingBag, DollarSign, User, LogOut, TrendingUp, Car, Settings, Users, Lock, Crosshair, Skull, Plane, Mail, ChevronDown, ChevronRight, Landmark, Wine, AlertTriangle, Newspaper, MapPin, ScrollText, ArrowLeftRight, MessageSquare, Bell, ListChecks, Palette, Bot } from 'lucide-react';
import api from '../utils/api';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useTheme } from '../context/ThemeContext';
import ThemePicker from './ThemePicker';
import styles from '../styles/noir.module.css';

/** Bottom bar: direct links or expandable groups (tap icon → sub-menu above bar). No "More" – all links live in bar groups. */
function getMobileBottomNavItems(isAdmin, hasCasinoOrProperty) {
  const goItems = [
    { path: '/travel', label: 'Travel' },
    { path: '/states', label: 'States' },
    ...(hasCasinoOrProperty ? [{ path: '/my-properties', label: 'My Properties' }] : []),
    { path: '/properties', label: 'Properties' },
    { path: '/garage', label: 'Garage' },
  ];
  return [
    {
      type: 'group',
      id: 'you',
      icon: User,
      label: 'You',
      items: [
        { path: '/dashboard', label: 'Dashboard' },
        { path: '/objectives', label: 'Objectives' },
        { path: '/profile', label: 'Profile' },
        { path: '/stats', label: 'Stats' },
        { path: '/dead-alive', label: 'Dead > Alive' },
        { path: '/bank', label: 'Bank' },
      ],
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
        { path: '/armour-weapons', label: 'Armour & Weapons' },
      ],
    },
    {
      type: 'group',
      id: 'ranking',
      icon: Target,
      label: 'Ranking',
      items: [
        { path: '/crimes', label: 'Crimes' },
        { path: '/gta', label: 'GTA' },
        { path: '/jail', label: 'Jail' },
        { path: '/organised-crime', label: 'Organised Crime' },
      ],
    },
    {
      type: 'group',
      id: 'go',
      icon: Plane,
      label: 'Go',
      items: goItems,
    },
    {
      type: 'group',
      id: 'social',
      icon: Users,
      label: 'Social',
      items: [
        { path: '/forum', label: 'Forum' },
        { path: '/forum', label: 'Entertainer Forum', state: { category: 'entertainer' } },
        { path: '/inbox', label: 'Inbox' },
        { path: '/booze-run', label: 'Booze Run' },
        { path: '/users-online', label: 'Users Online' },
        { path: '/families', label: 'Families' },
        { path: '/leaderboard', label: 'Leaderboard' },
      ],
    },
    {
      type: 'group',
      id: 'casino',
      icon: Dice5,
      label: 'Casino',
      items: [
        { path: '/casino', label: 'Casino' },
        { path: '/casino/dice', label: 'Dice' },
        { path: '/casino/rlt', label: 'Roulette' },
        { path: '/casino/blackjack', label: 'Blackjack' },
        { path: '/casino/horseracing', label: 'Horse Racing' },
        { path: '/sports-betting', label: 'Sports Betting' },
      ],
    },
    {
      type: 'group',
      id: 'shop',
      icon: ShoppingBag,
      label: 'Shop',
      items: [
        { path: '/store', label: 'Store' },
        { path: '/quick-trade', label: 'Quick Trade' },
      ],
    },
    {
      type: 'group',
      id: 'account',
      icon: Settings,
      label: 'Account',
      items: [
        { action: 'theme', label: 'Theme' },
        { action: 'logout', label: 'Logout' },
        { path: '/auto-rank', label: 'Auto Rank' },
        ...(isAdmin ? [{ path: '/admin', label: 'Admin Tools' }] : []),
      ],
    },
  ];
}

const TOPBAR_STAT_ORDER_KEY = 'topbar_stat_order';
const DEFAULT_STAT_ORDER = ['rank', 'bullets', 'kills', 'money', 'points', 'property', 'notifications'];

function loadStatOrder() {
  try {
    const raw = localStorage.getItem(TOPBAR_STAT_ORDER_KEY);
    if (!raw) return DEFAULT_STAT_ORDER;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (_) {}
  return DEFAULT_STAT_ORDER;
}

export default function Layout({ children }) {
  const [user, setUser] = useState(null);
  const [rankProgress, setRankProgress] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [statOrder, setStatOrder] = useState(loadStatOrder);
  const [draggingStatId, setDraggingStatId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const [casinoOpen, setCasinoOpen] = useState(false);
  const [mobileBottomMenuOpen, setMobileBottomMenuOpen] = useState(null); // which bottom bar group sub-menu is open
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasAdminEmail, setHasAdminEmail] = useState(false);
  const [rankingCounts, setRankingCounts] = useState({ crimes: 0, gta: 0, jail: 0 });
  const [atWar, setAtWar] = useState(false);
  const [autoRankPrefs, setAutoRankPrefs] = useState({ auto_rank_enabled: false, auto_rank_crimes: false, auto_rank_gta: false, auto_rank_oc: false, auto_rank_bust_every_5_sec: false });
  const [flashNews, setFlashNews] = useState([]);
  const [flashIndex, setFlashIndex] = useState(0);
  const [travelStatus, setTravelStatus] = useState(null); // { traveling: bool, destination, seconds_remaining }
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationList, setNotificationList] = useState([]);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
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
      if (notificationPanelRef.current && !notificationPanelRef.current.contains(e.target)) {
        setNotificationPanelOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [notificationPanelOpen]);

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
      });
    } catch {
      setAutoRankPrefs({ auto_rank_enabled: false, auto_rank_crimes: false, auto_rank_gta: false, auto_rank_oc: false, auto_rank_bust_every_5_sec: false });
    }
  };

  useEffect(() => {
    if (user) fetchAutoRankPrefs();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Refetch on route change so top bar and sidebar badges are fresh when navigating
    fetchData();
    fetchUnreadCount();
    fetchWarStatus();
    fetchRankingCounts();
    if (user) fetchAutoRankPrefs();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchWarStatus();
    const id = setInterval(fetchWarStatus, 15000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Lightweight polling so the sidebar badges stay fresh
    fetchRankingCounts();
    const id = setInterval(fetchRankingCounts, 15000);
    return () => clearInterval(id);
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
    pollNotifications();
    const id = setInterval(pollNotifications, 5000);
    return () => clearInterval(id);
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
      setUser(userRes.data);
      setRankProgress(progressRes.data);
      // Trigger objectives endpoint so backend can auto-reset daily/weekly/monthly without user opening Objectives page
      api.get('/objectives').catch(() => {});
    } catch (error) {
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
    fetchTravelStatus();
    const id = setInterval(fetchTravelStatus, 1000);
    return () => clearInterval(id);
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
    { path: '/properties', icon: Building, label: 'Properties' },
    { path: '/armour-weapons', icon: Sword, label: 'Armour & Weapons' },
    { path: '/casino', icon: Dice5, label: 'Casino' },
    { path: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
    { path: '/store', icon: ShoppingBag, label: 'Store' },
    { path: '/quick-trade', icon: ArrowLeftRight, label: 'Quick Trade' },
    { path: '/families', icon: Building2, label: 'Families' },
    { path: '/dead-alive', icon: Skull, label: 'Dead > Alive' },
    { path: '/auto-rank', icon: Bot, label: 'Auto Rank' },
  ];

  const adminNavItems = isAdmin ? [
    { path: '/admin', icon: Settings, label: 'Admin Tools' }
  ] : [];

  /* Inline theme styles so sidebar/active state always match (no CSS override) */
  const sidebarBgStyle = { backgroundColor: 'var(--gm-bg-top)' };
  const sidebarActiveStyle = { background: 'var(--gm-card-hover)', backgroundImage: 'none', borderLeft: '3px solid var(--gm-gold)', color: 'var(--gm-gold)' };
  const sidebarActiveGroupStyle = { background: 'var(--gm-card)', backgroundImage: 'none', borderLeft: '3px solid var(--gm-gold)', color: 'var(--gm-gold)' };

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
                      <span className="shrink-0 flex items-center justify-center" style={{ color: 'var(--gm-gold)' }} aria-label="Auto Rank on">
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
                    location.pathname === '/organised-crime';

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
                        <Icon size={14} style={{ color: 'var(--gm-gold)' }} className="shrink-0" />
                        <span className="uppercase tracking-widest text-[10px] font-heading flex-1 text-left truncate">{item.label}</span>
                        {rankingOpen ? <ChevronDown size={12} style={{ color: 'var(--gm-gold)', opacity: 0.7 }} className="shrink-0" /> : <ChevronRight size={12} style={{ color: 'var(--gm-gold)', opacity: 0.7 }} className="shrink-0" />}
                      </button>

                      {rankingOpen && (
                        <div className={`ml-3 pl-1.5 space-y-0.5 ${styles.sidebarSubmenuBorder}`}>
                          <Link
                            to="/crimes"
                            onClick={() => setSidebarOpen(false)}
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
                        <Icon size={14} style={{ color: 'var(--gm-gold)' }} className="shrink-0" />
                        <span className="uppercase tracking-widest text-[10px] font-heading flex-1 text-left truncate">{item.label}</span>
                        {casinoOpen ? <ChevronDown size={12} style={{ color: 'var(--gm-gold)', opacity: 0.7 }} className="shrink-0" /> : <ChevronRight size={12} style={{ color: 'var(--gm-gold)', opacity: 0.7 }} className="shrink-0" />}
                      </button>

                      {casinoOpen && (
                        <div className={`ml-4 pl-2 space-y-0.5 ${styles.sidebarSubmenuBorder}`}>
                          <Link
                            to="/casino"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-sm transition-smooth text-[10px] ${
                              location.pathname === '/casino' ? styles.navItemActivePage : styles.sidebarNavLink
                            }`}
                            style={location.pathname === '/casino' ? sidebarActiveStyle : undefined}
                            data-testid="nav-casino"
                          >
                            <span className="uppercase tracking-widest font-heading flex-1">Casino</span>
                          </Link>
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
                    <Icon size={14} className="shrink-0" style={isFamiliesAtWar ? { color: '#f87171' } : { color: 'var(--gm-gold)' }} />
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
      <div className={`fixed top-0 right-0 left-0 md:left-48 min-h-[48px] md:h-12 ${styles.topBar} backdrop-blur-md z-30 flex flex-col md:flex-row md:items-center px-4 gap-2 md:gap-3 py-2 md:py-0`}>
        <div className="flex items-center gap-3 flex-1 min-w-0 shrink-0">
        {mobileNavStyle !== 'bottom' && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            data-testid="mobile-menu-toggle"
            className="md:hidden shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -m-2"
            style={{ color: 'var(--gm-gold)' }}
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
          const casinoProfit = user.casino_profit ?? 0;
          const propertyProfit = user.property_profit ?? 0;
          const renderStat = (statId) => {
            const chipClass = 'flex items-center gap-1 bg-noir-surface/90 border border-primary/20 px-2 py-1 rounded-sm shrink-0 cursor-grab active:cursor-grabbing';
            if (statId === 'rank') {
              if (!rankProgress) return null;
              const pct = Number(rankProgress.rank_points_progress);
              const current = Number(rankProgress.rank_points_current) || 0;
              const needed = Number(rankProgress.rank_points_needed) || 0;
              const total = current + needed;
              const progress = (typeof pct === 'number' && !Number.isNaN(pct) && pct > 0)
                ? Math.min(100, Math.max(0, pct))
                : (total > 0 ? Math.min(100, (current / total) * 100) : needed === 0 ? 100 : 0);
              return (
                <div className={`${chipClass} gap-1.5 sm:gap-2 px-1.5 py-1 sm:px-2 sm:py-1 min-w-0`} title={`${rankProgress.current_rank_name}: ${progress.toFixed(2)}%`}>
                  <TrendingUp size={12} className="text-primary shrink-0" />
                  <div className="flex flex-col min-w-0 flex-1 sm:flex-initial">
                    <span className="hidden sm:inline text-[10px] text-mutedForeground leading-none font-heading">{rankProgress.current_rank_name}</span>
                    <div className="w-10 sm:w-16" style={{ position: 'relative', height: 6, backgroundColor: '#333333', borderRadius: 9999, overflow: 'hidden', marginTop: 2 }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${progress}%`, minWidth: progress > 0 ? 4 : 0, background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))', borderRadius: 9999, transition: 'width 0.3s ease' }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} />
                    </div>
                  </div>
                  <span className="text-[10px] text-primary font-heading shrink-0">{progress.toFixed(0)}%</span>
                </div>
              );
            }
            if (statId === 'bullets') {
              return (
                <div className={`${chipClass} hidden md:flex`} title="Bullets">
                  <Crosshair size={12} className="text-red-400" />
                  <span className="font-heading text-xs text-foreground" data-testid="topbar-bullets">{formatInt(user.bullets)}</span>
                </div>
              );
            }
            if (statId === 'kills') {
              return (
                <div className={`${chipClass} hidden md:flex`} title="Kills">
                  <Skull size={12} className="text-red-400" />
                  <span className="font-heading text-xs text-foreground" data-testid="topbar-kills">{formatInt(user.total_kills)}</span>
                </div>
              );
            }
            if (statId === 'money') {
              return (
                <div className={chipClass} title={`Cash: ${formatMoney(user.money)}`}>
                  <DollarSign size={12} className="text-primary shrink-0" />
                  <span className="font-heading text-xs text-primary md:hidden" data-testid="topbar-money">{formatMoneyCompact(user.money)}</span>
                  <span className="font-heading text-xs text-primary hidden md:inline" data-testid="topbar-money-full">{formatMoney(user.money)}</span>
                </div>
              );
            }
            if (statId === 'points') {
              return (
                <div className={chipClass} title={`Premium Points: ${formatInt(user.points)}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span className="font-heading text-xs text-foreground md:hidden" data-testid="topbar-points">{formatCompact(user.points)}</span>
                  <span className="font-heading text-xs text-foreground hidden md:inline" data-testid="topbar-points-full">{formatInt(user.points)}</span>
                </div>
              );
            }
            if (statId === 'property') {
              const casinoStr = `$${Number(casinoProfit).toLocaleString()}`;
              const propertyStr = `${Number(propertyProfit).toLocaleString()} pts`;
              const casinoShort = formatMoneyCompact(casinoProfit);
              const propertyShort = formatCompact(propertyProfit) + ' pts';
              return (
                <div className={chipClass} title={`Casino ${casinoStr} · Property ${propertyStr}`}>
                  <Building2 size={12} className="text-emerald-400 shrink-0" />
                  <span className="font-heading text-[11px] text-foreground whitespace-nowrap">
                    <span className="text-mutedForeground md:inline hidden">Casino </span>
                    <span className="text-mutedForeground md:hidden">C </span>
                    <span className={casinoProfit >= 0 ? 'text-emerald-500' : 'text-red-400'}><span className="md:hidden">{casinoShort}</span><span className="hidden md:inline">{casinoStr}</span></span>
                    <span className="text-mutedForeground mx-0.5">·</span>
                    <span className="text-mutedForeground md:inline hidden">Property </span>
                    <span className="text-mutedForeground md:hidden">P </span>
                    <span className={propertyProfit >= 0 ? 'text-emerald-500' : 'text-red-400'}><span className="md:hidden">{propertyShort}</span><span className="hidden md:inline">{propertyStr}</span></span>
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
            <div className="flex items-center gap-1.5 shrink-0 flex-nowrap md:flex-wrap overflow-x-auto md:overflow-visible gap-2 md:gap-1.5 -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0">
              {statOrder.map((statId) => {
                if (statId === 'notifications') {
                  return (
                    <div key="notifications" className={`relative shrink-0 cursor-grab active:cursor-grabbing transition-all duration-150 ease-out ${draggingStatId === 'notifications' ? 'opacity-50 scale-95' : ''}`} ref={notificationPanelRef} draggable onDragStart={(e) => handleDragStart(e, 'notifications')} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'notifications')} onDragEnd={handleDragEnd}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openNotificationPanel(); }}
                        className="flex items-center justify-center gap-1 bg-noir-surface/90 border border-primary/20 px-2 py-1 rounded-sm text-primary hover:bg-noir-raised/90 transition-colors"
                        aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'}
                      >
                        <Bell size={12} strokeWidth={2} />
                        {unreadCount > 0 && (
                          <span className="min-w-[14px] h-3.5 px-1 flex items-center justify-center rounded-full bg-primary text-noir-bg text-[10px] font-heading font-bold">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                      </button>
                      {notificationPanelOpen && (
                        <div
                          className="absolute top-full right-0 mt-1 w-[320px] max-h-[400px] flex flex-col rounded border shadow-xl z-50"
                          style={{ backgroundColor: 'var(--noir-content)', borderColor: 'var(--noir-border-mid)' }}
                        >
                          <div className="p-3 border-b shrink-0" style={{ borderColor: 'var(--noir-border)' }}>
                            <h3 className="font-heading font-semibold text-sm" style={{ color: 'var(--noir-primary)' }}>Notifications</h3>
                            <p className="text-xs mt-0.5 font-heading" style={{ color: 'var(--noir-muted)' }}>View & manage your notifications</p>
                          </div>
                          <div className="overflow-y-auto flex-1 min-h-0">
                            {notificationList.length === 0 ? (
                              <div className="p-4 text-center font-heading text-sm" style={{ color: 'var(--noir-muted)' }}>No notifications</div>
                            ) : (
                              notificationList.slice(0, 12).map((n) => (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => { setNotificationPanelOpen(false); navigate('/inbox'); }}
                                  className="w-full text-left px-3 py-2 border-b font-heading text-sm hover:bg-noir-raised/80 transition-colors"
                                  style={{ borderColor: 'var(--noir-border)', color: n.read ? 'var(--noir-muted)' : 'var(--noir-foreground)', backgroundColor: n.read ? 'transparent' : 'rgba(var(--noir-primary-rgb), 0.06)' }}
                                >
                                  <span className="font-semibold block truncate">{n.title}</span>
                                  <span className="block truncate text-xs mt-0.5 opacity-90">{n.message}</span>
                                </button>
                              ))
                            )}
                          </div>
                          <div className="p-2 border-t shrink-0 flex gap-2" style={{ borderColor: 'var(--noir-border)' }}>
                            <button type="button" onClick={() => { setNotificationPanelOpen(false); navigate('/inbox'); }} className="flex-1 py-1.5 rounded text-xs font-heading border transition-colors" style={{ borderColor: 'var(--noir-primary)', color: 'var(--noir-primary)' }}>View all</button>
                            <button type="button" onClick={() => { markAllNotificationsRead(); }} className="flex-1 py-1.5 rounded text-xs font-heading border transition-colors" style={{ borderColor: 'var(--noir-border-mid)', color: 'var(--noir-foreground)' }}>Clear all</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                const content = renderStat(statId);
                if (!content) return null;
                return (
                  <div key={statId} draggable onDragStart={(e) => handleDragStart(e, statId)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, statId)} onDragEnd={handleDragEnd} className={`shrink-0 cursor-grab active:cursor-grabbing transition-all duration-150 ease-out ${draggingStatId === statId ? 'opacity-50 scale-95' : ''}`}>
                    {content}
                  </div>
                );
              })}
            </div>
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
                style={{ backgroundColor: 'var(--gm-card)', borderBottom: '1px solid var(--noir-border-mid)' }}
                role="menu"
              >
                <div className="py-2">
                  {group.items.map((sub, idx) => {
                    if (sub.action === 'theme') {
                      return (
                        <button
                          key="theme"
                          type="button"
                          onClick={() => { setThemePickerOpen(true); setMobileBottomMenuOpen(null); }}
                          role="menuitem"
                          className="block w-full px-4 py-2.5 text-left text-sm font-heading uppercase tracking-wider transition-colors hover:bg-primary/10"
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
                          className="block w-full px-4 py-2.5 text-left text-sm font-heading uppercase tracking-wider transition-colors bg-red-900/30 text-red-300 hover:bg-red-900/50"
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
                          className="block w-full px-4 py-2.5 text-left text-sm font-heading uppercase tracking-wider transition-colors text-amber-400 hover:bg-amber-500/10"
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
                    return (
                      <Link
                        key={sub.path ? `${sub.path}-${sub.label}` : idx}
                        to={to}
                        onClick={() => setMobileBottomMenuOpen(null)}
                        role="menuitem"
                        className={`block w-full px-4 py-2.5 text-left text-sm font-heading uppercase tracking-wider transition-colors ${
                          isActive ? 'bg-primary/20' : ''
                        }`}
                        style={isActive ? { color: 'var(--gm-gold)' } : { color: 'var(--noir-foreground)' }}
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
            className="flex items-center gap-1 overflow-x-auto overflow-y-hidden py-2 px-2 safe-area-pb scrollbar-thin"
            style={{ backgroundColor: 'var(--gm-bg-top)', borderTop: '1px solid var(--noir-border-mid)' }}
            aria-label="Mobile navigation"
          >
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
                    className={`flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-lg transition-colors ${
                      isActive ? 'bg-primary/25 border border-primary/50' : ''
                    }`}
                    style={isActive ? { color: 'var(--gm-gold)' } : { color: 'var(--noir-foreground)' }}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.label}
                  >
                    <span className="relative inline-flex">
                      <Icon size={22} strokeWidth={2} />
                      {isInbox && unreadCount > 0 && (
                        <span className="absolute -top-1 -right-2 min-w-[14px] h-[14px] rounded-full bg-red-600 text-[10px] font-bold text-white flex items-center justify-center px-0.5">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="text-[9px] font-heading uppercase tracking-wider truncate max-w-[52px]">{item.label}</span>
                  </Link>
                );
              }
              if (item.type === 'group') {
                const isOpen = mobileBottomMenuOpen === item.id;
                const isActive = item.items.some((sub) => {
                  if (sub.state) return location.pathname === sub.path && location.state?.category === sub.state?.category;
                  return location.pathname === sub.path || (sub.path !== '/casino' && sub.path !== '/forum' && location.pathname.startsWith(sub.path + '/'));
                });
                const showInboxBadge = item.id === 'social' && unreadCount > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMobileBottomMenuOpen(isOpen ? null : item.id); }}
                    className={`flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-lg transition-colors ${
                      isOpen || isActive ? 'bg-primary/25 border border-primary/50' : ''
                    }`}
                    style={isOpen || isActive ? { color: 'var(--gm-gold)' } : { color: 'var(--noir-foreground)' }}
                    aria-expanded={isOpen}
                    aria-haspopup="true"
                    title={item.label}
                  >
                    <span className="relative inline-flex">
                      <Icon size={22} strokeWidth={2} />
                      {showInboxBadge && (
                        <span className="absolute -top-1 -right-2 min-w-[14px] h-[14px] rounded-full bg-red-600 text-[10px] font-bold text-white flex items-center justify-center px-0.5">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="text-[9px] font-heading uppercase tracking-wider truncate max-w-[52px]">{item.label}</span>
                  </button>
                );
              }
              return null;
            })}
          </nav>
        </div>
      )}

      <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
    </div>
  );
}
