import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, Home, Target, Shield, Building, Building2, Dice5, Sword, Trophy, ShoppingBag, DollarSign, User, LogOut, TrendingUp, Car, Settings, Users, Lock, Crosshair, Skull, Plane, Mail, ChevronDown, ChevronRight, Landmark, Wine, AlertTriangle, Newspaper, MapPin } from 'lucide-react';
import api from '../utils/api';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

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

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 h-full w-64 bg-card border-r border-border z-50 transform transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-border">
            <h1 className="text-2xl font-heading font-bold text-primary" data-testid="app-logo">MAFIA WARS</h1>
            <p className="text-xs text-mutedForeground mt-1">Chicago, 1927</p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4">
            <div className="space-y-1">
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
                    <div key="nav-ranking-group" className="space-y-1">
                      <button
                        type="button"
                        data-testid="nav-ranking-group"
                        onClick={() => setRankingOpen((v) => !v)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-sm transition-smooth ${
                          isAnyRankingActive
                            ? 'bg-primary/15 text-foreground font-medium'
                            : 'text-foreground hover:bg-secondary hover:text-primary'
                        }`}
                      >
                        <Icon size={20} />
                        <span className="uppercase tracking-wider text-sm flex-1 text-left">{item.label}</span>
                        {rankingOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>

                      {rankingOpen && (
                        <div className="ml-4 pl-3 border-l border-border space-y-1">
                          <Link
                            to="/crimes"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/crimes'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-crimes"
                          >
                            <span className="uppercase tracking-wider flex-1">Crimes</span>
                            {rankingCounts.crimes > 0 && (
                              <span
                                className="ml-2 bg-emerald-600/20 text-emerald-400 text-xs px-2 py-0.5 rounded-full font-bold border border-emerald-500/30"
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
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/gta'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-gta"
                          >
                            <span className="uppercase tracking-wider flex-1">GTA</span>
                            {rankingCounts.gta > 0 && (
                              <span
                                className="ml-2 bg-emerald-600/20 text-emerald-400 text-xs px-2 py-0.5 rounded-full font-bold border border-emerald-500/30"
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
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/jail'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-jail"
                          >
                            <span className="uppercase tracking-wider flex-1">Jail</span>
                            {rankingCounts.jail > 0 && (
                              <span
                                className="ml-2 bg-destructive/20 text-destructive text-xs px-2 py-0.5 rounded-full font-bold border border-destructive/30"
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
                    <div key="nav-casino-group" className="space-y-1">
                      <button
                        type="button"
                        data-testid="nav-casino-group"
                        onClick={() => setCasinoOpen((v) => !v)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-sm transition-smooth ${
                          isAnyCasinoActive
                            ? 'bg-primary/15 text-foreground font-medium'
                            : 'text-foreground hover:bg-secondary hover:text-primary'
                        }`}
                      >
                        <Icon size={20} />
                        <span className="uppercase tracking-wider text-sm flex-1 text-left">{item.label}</span>
                        {casinoOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>

                      {casinoOpen && (
                        <div className="ml-4 pl-3 border-l border-border space-y-1">
                          <Link
                            to="/casino"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/casino'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-casino"
                          >
                            <span className="uppercase tracking-wider flex-1">Casino</span>
                          </Link>
                          <Link
                            to="/casino/dice"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/casino/dice'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-dice"
                          >
                            <span className="uppercase tracking-wider flex-1">Dice</span>
                          </Link>
                          <Link
                            to="/casino/rlt"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/casino/rlt'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-roulette"
                          >
                            <span className="uppercase tracking-wider flex-1">Roulette</span>
                          </Link>
                          <Link
                            to="/casino/blackjack"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/casino/blackjack'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-blackjack"
                          >
                            <span className="uppercase tracking-wider flex-1">Blackjack</span>
                          </Link>
                          <Link
                            to="/casino/horseracing"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/casino/horseracing'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-horseracing"
                          >
                            <span className="uppercase tracking-wider flex-1">Horse Racing</span>
                          </Link>
                          <Link
                            to="/sports-betting"
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 rounded-sm transition-smooth text-sm ${
                              location.pathname === '/sports-betting'
                                ? 'bg-primary text-primaryForeground font-medium'
                                : 'text-foreground hover:bg-secondary hover:text-primary'
                            }`}
                            data-testid="nav-sports-betting"
                          >
                            <span className="uppercase tracking-wider flex-1">Sports Betting</span>
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
                    className={`flex items-center gap-3 px-4 py-3 rounded-sm transition-smooth ${
                      isFamiliesAtWar
                        ? isActive
                          ? 'bg-red-500/20 text-red-500 font-medium'
                          : 'text-red-500 hover:bg-red-500/10'
                        : isActive
                          ? 'bg-primary text-primaryForeground font-medium'
                          : 'text-foreground hover:bg-secondary hover:text-primary'
                    }`}
                    style={isFamiliesAtWar ? { color: '#ef4444' } : undefined}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Icon size={20} style={isFamiliesAtWar ? { color: '#ef4444' } : undefined} />
                    <span className="uppercase tracking-wider text-sm flex-1">{item.label}</span>
                    {isFamiliesAtWar && <AlertTriangle size={18} className="shrink-0" style={{ color: '#ef4444' }} aria-hidden />}
                    {item.badge > 0 && (
                      <span className="bg-destructive text-destructiveForeground text-xs px-1.5 py-0.5 rounded-full font-bold">
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
                    className={`flex items-center gap-3 px-4 py-3 rounded-sm transition-smooth border-t border-border mt-2 pt-3 ${
                      isActive
                        ? 'bg-destructive text-destructiveForeground font-medium'
                        : 'text-destructive hover:bg-destructive/10'
                    }`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Icon size={20} />
                    <span className="uppercase tracking-wider text-sm">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* User Info */}
          {user && (
            <div className="p-4 border-t border-border">
              <div className="bg-secondary p-3 rounded-sm">
                <div className="flex items-center gap-2 mb-2">
                  <User size={16} className="text-primary" />
                  <span className="text-sm font-medium" data-testid="user-username">{user.username}</span>
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-mutedForeground">Rank:</span>
                    <span className="text-primary font-mono" data-testid="user-rank">{user.rank_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mutedForeground">Wealth:</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-primary font-mono cursor-default underline decoration-dotted decoration-mutedForeground/50 underline-offset-1" data-testid="user-wealth-rank">{user.wealth_rank_name ?? '—'}</span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="bg-zinc-800 text-white border border-zinc-600 rounded-md px-3 py-2 text-sm font-mono shadow-lg">
                          {user.wealth_rank_range ?? '$0'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mutedForeground">Money:</span>
                    <span className="text-primary font-mono" data-testid="user-money">${user.money.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mutedForeground">Points:</span>
                    <span className="text-primary font-mono" data-testid="user-points">{user.points}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mutedForeground">Health:</span>
                    <span className="text-primary font-mono" data-testid="user-health">{user.health ?? 100}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mutedForeground">Armour:</span>
                    <span className="text-primary font-mono" data-testid="user-armour">Lv.{user.armour_level ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mutedForeground">Bullets:</span>
                    <span className="text-primary font-mono" data-testid="user-bullets">{user.bullets ?? 0}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                data-testid="logout-button"
                className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-destructive text-destructiveForeground rounded-sm hover:opacity-80 transition-smooth uppercase tracking-wider text-sm font-bold"
              >
                <LogOut size={16} />
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
      <div className="fixed top-0 right-0 left-0 md:left-64 h-14 bg-card/80 backdrop-blur-md border-b border-border z-30 flex items-center px-4 gap-3">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          data-testid="mobile-menu-toggle"
          className="md:hidden shrink-0 text-foreground"
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {/* Flash news ticker */}
        <div className="flex-1 min-w-0 overflow-hidden hidden sm:flex items-center gap-2">
          {flashNews.length > 0 ? (
            <div className="flex items-center gap-2 min-w-0">
              <Newspaper size={16} className="shrink-0 text-primary" aria-hidden />
              <span className="text-xs sm:text-sm text-mutedForeground truncate" title={flashNews[flashIndex]?.message}>
                {flashNews[flashIndex]?.message}
              </span>
              {flashNews.length > 1 && (
                <span className="text-[10px] text-mutedForeground/70 shrink-0">
                  {flashIndex + 1}/{flashNews.length}
                </span>
              )}
            </div>
          ) : null}
        </div>

        {user && (
          <div className="flex items-center gap-2 shrink-0">
            {/* Rank Progress Mini Bar */}
            {rankProgress && (
              <div
                className="hidden sm:flex items-center gap-2 bg-secondary px-3 py-1 rounded-sm"
                title={`Rank progress: ${(Number(rankProgress.rank_points_progress || 0)).toFixed(2)}%`}
              >
                <TrendingUp size={14} className="text-primary" />
                <div className="flex flex-col">
                  <span className="text-xs text-mutedForeground leading-none">{rankProgress.current_rank_name}</span>
                  <div className="w-20 h-1 bg-background rounded-full mt-0.5 overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300" 
                      style={{ width: `${rankProgress.rank_points_progress || 0}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-[11px] text-mutedForeground font-mono">
                  {(Number(rankProgress.rank_points_progress || 0)).toFixed(2)}%
                </span>
              </div>
            )}
            
            {/* Bullets */}
            <div className="hidden md:flex items-center gap-1.5 bg-secondary px-2 py-1 rounded-sm" title="Bullets">
              <Crosshair size={14} className="text-red-500" />
              <span className="font-mono text-xs sm:text-sm" data-testid="topbar-bullets">{formatInt(user.bullets)}</span>
            </div>
            
            {/* Kills */}
            <div className="hidden md:flex items-center gap-1.5 bg-secondary px-2 py-1 rounded-sm" title="Kills">
              <Skull size={14} className="text-red-400" />
              <span className="font-mono text-xs sm:text-sm" data-testid="topbar-kills">{formatInt(user.total_kills)}</span>
            </div>
            
            {/* Money */}
            <div className="flex items-center gap-1.5 bg-secondary px-2 py-1 rounded-sm" title="Cash">
              <DollarSign size={14} className="text-primary" />
              <span className="font-mono text-xs sm:text-sm" data-testid="topbar-money">{formatMoney(user.money)}</span>
            </div>
            
            {/* Points */}
            <div className="flex items-center gap-1.5 bg-secondary px-2 py-1 rounded-sm" title="Premium Points">
              <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
              <span className="font-mono text-xs sm:text-sm" data-testid="topbar-points">{formatInt(user.points)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <main className="md:ml-64 mt-14 min-h-screen p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
