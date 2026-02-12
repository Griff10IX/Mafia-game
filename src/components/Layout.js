import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, Home, Target, Shield, Building, Building2, Dice5, Sword, Trophy, ShoppingBag, DollarSign, User, LogOut, TrendingUp, Car, Settings, Users, Lock, Crosshair, Skull, Plane, Mail, ChevronDown, ChevronRight, Landmark, Wine, AlertTriangle, Newspaper, MapPin } from 'lucide-react';
import api from '../utils/api';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import styles from '../styles/noir.module.css';

export default function Layout({ children }) {
  const [user, setUser] = useState(null);
  const [rankProgress, setRankProgress] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const [casinoOpen, setCasinoOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rankingCounts, setRankingCounts] = useState({ crimes: 0, gta: 0, jail: 0 });
  const [atWar, setAtWar] = useState(false);
  const [flashNews, setFlashNews] = useState([]);
  const [flashIndex, setFlashIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    fetchData();
    checkAdmin();
    fetchUnreadCount();
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail || {};
      if (detail.money != null && detail.money !== undefined) {
        setUser((prev) => (prev ? { ...prev, money: Number(detail.money) } : null));
      }
      fetchData();
      fetchUnreadCount();
      fetchWarStatus();
    };
    window.addEventListener('app:refresh-user', handler);
    return () => window.removeEventListener('app:refresh-user', handler);
  }, []);

  useEffect(() => {
    // Refetch on route change so top bar is fresh when navigating
    fetchData();
    fetchUnreadCount();
    fetchWarStatus();
  }, [location.pathname]);

  useEffect(() => {
    fetchWarStatus();
    const id = setInterval(fetchWarStatus, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Lightweight polling so the sidebar badges stay fresh
    fetchRankingCounts();
    const id = setInterval(fetchRankingCounts, 15000);
    return () => clearInterval(id);
  }, []);

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
  }, []);

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

  const checkAdmin = async () => {
    try {
      const response = await api.get('/admin/check');
      setIsAdmin(response.data.is_admin);
    } catch (error) {
      setIsAdmin(false);
    }
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

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/');
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

  const navItems = [
    { path: '/dashboard', icon: Home, label: 'Dashboard' },
    { path: '/stats', icon: TrendingUp, label: 'Stats' },
    { path: '/bank', icon: Landmark, label: 'Bank' },
    { path: '/inbox', icon: Mail, label: 'Inbox', badge: unreadCount },
    { path: '/travel', icon: Plane, label: 'Travel' },
    { path: '/states', icon: MapPin, label: 'States' },
    { path: '/booze-run', icon: Wine, label: 'Booze Run' },
    { path: '/users-online', icon: Users, label: 'Users Online' },
    { path: '/profile', icon: User, label: 'Profile' },
    { path: '/ranking', icon: Target, label: 'Ranking' }, // rendered as dropdown group below
    { path: '/garage', icon: Car, label: 'Garage' },
    { path: '/attack', icon: Sword, label: 'Attack' },
    { path: '/attempts', icon: Crosshair, label: 'Attempts' },
    { path: '/bodyguards', icon: Shield, label: 'Bodyguards' },
    { path: '/families', icon: Building2, label: 'Families' },
    { path: '/properties', icon: Building, label: 'Properties' },
    { path: '/casino', icon: Dice5, label: 'Casino' }, // rendered as dropdown group below
    { path: '/armour-weapons', icon: Sword, label: 'Armour & Weapons' },
    { path: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
    { path: '/store', icon: ShoppingBag, label: 'Store' },
    { path: '/dead-alive', icon: Skull, label: 'Dead > Alive' },
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
      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 h-full w-64 ${styles.sidebar} z-50 transform transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
        style={sidebarBgStyle}
      >
        <div className="flex flex-col h-full">
          {/* Logo – thin gold line under header (match reference) */}
          <div className={`p-4 border-b ${styles.borderGoldLight}`}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-px" style={{ backgroundColor: 'var(--gm-gold)', opacity: 0.5 }} />
              <h1 className={`text-xl font-heading font-bold tracking-widest ${styles.sidebarHeaderTitle}`} data-testid="app-logo">MAFIA WARS</h1>
              <div className="flex-1 h-px" style={{ backgroundColor: 'var(--gm-gold)', opacity: 0.5 }} />
            </div>
            <p className={`text-xs mt-1 font-heading tracking-wider text-center ${styles.sidebarHeaderSub}`}>Chicago, 1927</p>
          </div>

          {/* Navigation */}
          <nav className={`flex-1 overflow-y-auto p-3 ${styles.sidebarNav}`}>
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
                    location.pathname === '/jail';

                  return (
                    <div key="nav-ranking-group" className="space-y-0.5">
                      <button
                        type="button"
                        data-testid="nav-ranking-group"
                        onClick={() => setRankingOpen((v) => !v)}
                        className={`w-full flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-sm transition-smooth ${
                          isAnyRankingActive ? styles.navItemActive : styles.sidebarNavLink
                        }`}
                        style={isAnyRankingActive ? sidebarActiveGroupStyle : undefined}
                      >
                        <Icon size={16} style={{ color: 'var(--gm-gold)' }} />
                        <span className="uppercase tracking-widest text-xs font-heading flex-1 text-left">{item.label}</span>
                        {rankingOpen ? <ChevronDown size={14} style={{ color: 'var(--gm-gold)', opacity: 0.7 }} /> : <ChevronRight size={14} style={{ color: 'var(--gm-gold)', opacity: 0.7 }} />}
                      </button>

                      {rankingOpen && (
                        <div className={`ml-4 pl-2 space-y-0.5 ${styles.sidebarSubmenuBorder}`}>
                          <Link
                            to="/crimes"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                        className={`w-full flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-sm transition-smooth ${
                          isAnyCasinoActive ? styles.navItemActive : styles.sidebarNavLink
                        }`}
                        style={isAnyCasinoActive ? sidebarActiveGroupStyle : undefined}
                      >
                        <Icon size={16} style={{ color: 'var(--gm-gold)' }} />
                        <span className="uppercase tracking-widest text-xs font-heading flex-1 text-left">{item.label}</span>
                        {casinoOpen ? <ChevronDown size={14} style={{ color: 'var(--gm-gold)', opacity: 0.7 }} /> : <ChevronRight size={14} style={{ color: 'var(--gm-gold)', opacity: 0.7 }} />}
                      </button>

                      {casinoOpen && (
                        <div className={`ml-4 pl-2 space-y-0.5 ${styles.sidebarSubmenuBorder}`}>
                          <Link
                            to="/casino"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                            className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-sm transition-smooth text-xs ${
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
                    className={`flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-sm transition-smooth ${
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
                    <Icon size={16} className={isFamiliesAtWar ? '' : undefined} style={isFamiliesAtWar ? { color: '#f87171' } : isActive ? { color: 'var(--gm-gold)' } : { color: 'var(--gm-gold)' }} />
                    <span className="uppercase tracking-widest text-xs font-heading flex-1">{item.label}</span>
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
                    data-testid={`nav-${item.label.toLowerCase()}`}
                    className={`flex items-center gap-2 px-3 py-2 rounded-sm transition-smooth border-t border-primary/20 mt-2 pt-2 ${
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
            </div>
          </nav>

          {/* User Info */}
          {user && (
            <div className={`p-3 border-t ${styles.borderGoldLight} bg-gradient-to-t from-noir-bg to-transparent`}>
              <div className={`${styles.userBox} p-3 rounded-sm`}>
                <div className={`flex items-center gap-2 mb-2 pb-2 border-b ${styles.borderGoldLight}`}>
                  <User size={14} style={{ color: 'var(--gm-gold)' }} />
                  <span className={`text-sm font-heading font-bold ${styles.sidebarHeaderTitle}`} data-testid="user-username">{user.username}</span>
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className={`${styles.sidebarHeaderSub} font-heading`}>Rank:</span>
                    <span className={`${styles.sidebarHeaderTitle} font-heading font-bold`} data-testid="user-rank">{user.rank_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={`${styles.sidebarHeaderSub} font-heading`}>Wealth:</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={`${styles.sidebarHeaderTitle} font-heading cursor-default underline decoration-dotted underline-offset-1`} style={{ textDecorationColor: 'var(--gm-gold)' }} data-testid="user-wealth-rank">{user.wealth_rank_name ?? '—'}</span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className={`${styles.surface} ${styles.textGold} ${styles.borderGold} rounded-sm px-3 py-2 text-sm font-heading shadow-lg`}>
                          {user.wealth_rank_range ?? '$0'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="flex justify-between">
                    <span className={`${styles.sidebarHeaderSub} font-heading`}>Money:</span>
                    <span className={`${styles.sidebarHeaderTitle} font-heading`} data-testid="user-money">${user.money.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={`${styles.sidebarHeaderSub} font-heading`}>Points:</span>
                    <span className={`${styles.sidebarHeaderTitle} font-heading`} data-testid="user-points">{user.points}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={`${styles.sidebarHeaderSub} font-heading`}>Health:</span>
                    <span className={`${styles.sidebarHeaderTitle} font-heading`} data-testid="user-health">{user.health ?? 100}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={`${styles.sidebarHeaderSub} font-heading`}>Armour:</span>
                    <span className={`${styles.sidebarHeaderTitle} font-heading`} data-testid="user-armour">Lv.{user.armour_level ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={`${styles.sidebarHeaderSub} font-heading`}>Bullets:</span>
                    <span className={`${styles.sidebarHeaderTitle} font-heading`} data-testid="user-bullets">{user.bullets ?? 0}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                data-testid="logout-button"
                className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-red-700 to-red-900 text-white border border-red-600/50 rounded-sm hover:opacity-90 transition-smooth uppercase tracking-widest text-xs font-heading font-bold"
              >
                <LogOut size={14} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Top bar */}
      <div className={`fixed top-0 right-0 left-0 md:left-64 min-h-[48px] h-12 ${styles.topBar} backdrop-blur-md z-30 flex items-center px-4 gap-3`}>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          data-testid="mobile-menu-toggle"
          className="md:hidden shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -m-2"
          style={{ color: 'var(--gm-gold)' }}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        >
          {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

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

        {user && (
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Rank Progress Mini Bar */}
            {rankProgress && (
              <div
                className="hidden sm:flex items-center gap-2 bg-noir-surface/90 border border-primary/20 px-2 py-1 rounded-sm"
                title={`Rank progress: ${(Number(rankProgress.rank_points_progress || 0)).toFixed(2)}%`}
              >
                <TrendingUp size={12} className="text-primary" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-mutedForeground leading-none font-heading">{rankProgress.current_rank_name}</span>
                  <div className="w-16 h-1 bg-noir-raised rounded-full mt-0.5 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-primary to-yellow-600 transition-all duration-300" 
                      style={{ width: `${rankProgress.rank_points_progress || 0}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-[10px] text-primary font-heading">
                  {(Number(rankProgress.rank_points_progress || 0)).toFixed(1)}%
                </span>
              </div>
            )}
            
            {/* Bullets */}
            <div className="hidden md:flex items-center gap-1 bg-noir-surface/90 border border-primary/20 px-2 py-1 rounded-sm" title="Bullets">
              <Crosshair size={12} className="text-red-400" />
              <span className="font-heading text-xs text-foreground" data-testid="topbar-bullets">{formatInt(user.bullets)}</span>
            </div>
            
            {/* Kills */}
            <div className="hidden md:flex items-center gap-1 bg-noir-surface/90 border border-primary/20 px-2 py-1 rounded-sm" title="Kills">
              <Skull size={12} className="text-red-400" />
              <span className="font-heading text-xs text-foreground" data-testid="topbar-kills">{formatInt(user.total_kills)}</span>
            </div>
            
            {/* Money */}
            <div className="flex items-center gap-1 bg-noir-surface/90 border border-primary/20 px-2 py-1 rounded-sm" title="Cash">
              <DollarSign size={12} className="text-primary" />
              <span className="font-heading text-xs text-primary" data-testid="topbar-money">{formatMoney(user.money)}</span>
            </div>
            
            {/* Points */}
            <div className="flex items-center gap-1 bg-noir-surface/90 border border-primary/20 px-2 py-1 rounded-sm" title="Premium Points">
              <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
              <span className="font-heading text-xs text-foreground" data-testid="topbar-points">{formatInt(user.points)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <main className="md:ml-64 mt-12 min-h-screen p-4 md:p-6 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
