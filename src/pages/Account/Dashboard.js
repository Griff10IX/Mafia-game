import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  TrendingUp,
  Target,
  Shield,
  MapPin,
  User,
  Swords,
  Landmark,
  Car,
  Trophy,
  Bot,
  Settings,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { useAuthUser } from '../../context/AuthContext';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import {
  DASHBOARD_SESSION_CACHE_KEY,
  DEFAULT_AT_A_GLANCE_STATS,
  DEFAULT_SECTION_ORDER,
  readDashboardSessionCache,
  mergeDashboardPreferences,
  sanitizeDashboardUser,
} from '../../utils/dashboardSessionCache';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible';
import styles from '../../styles/noir.module.css';
import DailyRewardsWidget from '../../components/dashboard/DailyRewardsWidget';
import ObjectivesWidget from '../../components/dashboard/ObjectivesWidget';
import NotificationsWidget from '../../components/dashboard/NotificationsWidget';
import EventOrStoreSlot from '../../components/dashboard/EventOrStoreSlot';
import AutoRankStatusWidget from '../../components/dashboard/AutoRankStatusWidget';
import BodyguardsWidget from '../../components/dashboard/BodyguardsWidget';
import MyPropertiesWidget from '../../components/dashboard/MyPropertiesWidget';

const DASH_STYLES = `
  @keyframes dash-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .dash-fade-in { animation: dash-fade-in 0.4s ease-out both; }
  .dash-scale-in { animation: dash-scale-in 0.35s ease-out both; }
  @keyframes dash-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  @keyframes dash-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .dash-glow { animation: dash-glow 4s ease-in-out infinite; }
  .dash-stat-card { transition: all 0.3s ease; }
  .dash-stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .dash-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const RankProgressCard = ({ rankProgress, hasPremiumBar }) => {
  const current = Number(rankProgress.rank_points_current) || 0;
  const needed = Number(rankProgress.rank_points_needed) || 0;
  const total = current + needed;
  const pctFromApi = Number(rankProgress.rank_points_progress);
  const progressPct = (typeof pctFromApi === 'number' && !Number.isNaN(pctFromApi) && pctFromApi >= 0)
    ? Math.min(100, Math.max(0, pctFromApi))
    : (total > 0 ? Math.min(100, (current / total) * 100) : 0);
  const progressLabel = hasPremiumBar ? progressPct.toFixed(2) : progressPct.toFixed(0);
  const progressKind = rankProgress.progress_kind || (rankProgress.next_rank ? 'street' : needed > 0 ? 'prestige' : 'max');
  const isPrestigeBar = progressKind === 'prestige';
  const showPremiumTotal = hasPremiumBar && (rankProgress.next_rank || (isPrestigeBar && needed > 0));

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 dash-scale-in mobile-panel`}>
      <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none dash-glow" />
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          {isPrestigeBar ? 'Prestige RP (Godfather)' : 'Rank Progress'}
        </h2>
        {!hasPremiumBar && (
          <Link
            to="/game/store"
            className="text-[9px] font-heading font-bold text-primary hover:text-primary/80 transition-colors"
          >
            Premium bar →
          </Link>
        )}
      </div>
      <div className="px-2.5 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-heading text-foreground">
            {rankProgress.current_rank_name}
            {rankProgress.next_rank && (
              <span className="text-mutedForeground"> → {rankProgress.next_rank_name}</span>
            )}
            {isPrestigeBar && (
              <span className="text-mutedForeground text-[10px] block mt-0.5 font-normal">
                Bar is total RP for the next prestige gate (lower ranks already earned separately).
              </span>
            )}
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-heading">
            <span className="text-mutedForeground">Rank Points</span>
            <span className="font-bold text-primary tabular-nums">
              {(rankProgress.rank_points_current || 0).toLocaleString()}
              {showPremiumTotal && (
                <span className="text-mutedForeground">
                  {' / '}{((rankProgress.rank_points_current || 0) + (rankProgress.rank_points_needed || 0)).toLocaleString()}
                </span>
              )}
              <span className="text-mutedForeground font-normal ml-1">({progressLabel}%)</span>
            </span>
          </div>
          <div className="relative w-full h-2 bg-secondary rounded-full overflow-hidden border border-primary/20">
            <div
              className="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, minWidth: progressPct > 0 ? '4px' : 0, background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))' }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {hasPremiumBar && rankProgress.rank_points_needed > 0 && (
            <p className="text-[9px] font-heading text-mutedForeground text-right">
              {rankProgress.rank_points_needed.toLocaleString()} RP {isPrestigeBar ? 'to next prestige' : 'to next rank'}
            </p>
          )}
        </div>
      </div>
      <div className="dash-art-line text-primary mx-3" />
    </div>
  );
};

const StatCard = ({ stat, delay = 0 }) => {
  const Icon = stat.icon;
  const valueStyle = stat.valueColor && /^#[0-9A-Fa-f]{6}$/.test(String(stat.valueColor).trim())
    ? { color: String(stat.valueColor).trim() }
    : undefined;
  const valueClass =
    stat.valueColor && valueStyle
      ? 'text-sm font-heading font-bold truncate cursor-default underline decoration-dotted decoration-primary/50 underline-offset-2'
      : 'text-sm font-heading font-bold text-foreground truncate cursor-default underline decoration-dotted decoration-primary/50 underline-offset-2';
  const valueEl = stat.tooltip ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <p className={valueClass} style={valueStyle}>
            {stat.value}
          </p>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className={`${styles.panel} text-foreground border-primary/30 rounded-md px-3 py-2 text-xs font-heading`}
        >
          {stat.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    <p className={valueClass} style={valueStyle}>{stat.value}</p>
  );

  return (
    <div
      className={`relative ${styles.surface} rounded-md overflow-hidden p-2 border border-primary/20 dash-stat-card dash-scale-in`}
      style={{ animationDelay: `${delay}s` }}
      data-testid={stat.testId}
    >
      <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-[0.12em] mb-1 font-heading">
        <Icon size={9} className="text-primary" />
        {stat.label}
      </div>
      {valueEl}
      {stat.sub && (
        <p className="text-[9px] text-mutedForeground mt-0.5">{stat.sub}</p>
      )}
    </div>
  );
};

function formatProtectionCountdown(endsAtIso) {
  if (!endsAtIso) return '—';
  const end = new Date(endsAtIso).getTime();
  const ms = end - Date.now();
  if (Number.isNaN(end)) return '—';
  if (ms <= 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatProtectionDurationLabel(hours) {
  const h = Number(hours) || 168;
  if (h >= 24 && h % 24 === 0) {
    const days = h / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${h} hour${h === 1 ? '' : 's'}`;
}

const QUICK_LINKS = [
  { to: '/account/profile', icon: User, label: 'Profile' },
  { to: '/crime/crimes', icon: Target, label: 'Crimes' },
  { to: '/kill/attack', icon: Shield, label: 'Attack' },
  { to: '/money/bank', icon: Landmark, label: 'Bank' },
  { to: '/game/store', icon: DollarSign, label: 'Store' },
  { to: '/game/travel', icon: Car, label: 'Travel' },
  { to: '/game/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { to: '/account/autorank', icon: Bot, label: 'Auto Rank' },
];

const SECTION_LABELS = {
  rank_progress: 'Rank Progress',
  rewards_objectives: 'Rewards & Objectives',
  notifications_event: 'Notifications & Store',
  bodyguards_properties: 'Bodyguards & Properties',
  auto_rank: 'Auto Rank',
  at_a_glance: 'At a Glance',
  go_to: 'Go to',
};
const STAT_OPTIONS = [
  { id: 'money', label: 'Cash' },
  { id: 'rank', label: 'Rank' },
  { id: 'wealth', label: 'Wealth tier' },
  { id: 'rp', label: 'Rank points' },
  { id: 'location', label: 'Location' },
  { id: 'kills', label: 'Kills' },
];

export default function Dashboard() {
  const authUser = useAuthUser();
  const [rankProgress, setRankProgress] = useState(null);
  const [preferences, setPreferences] = useState(() => {
    const p = readDashboardSessionCache()?.preferences;
    return {
      section_order: p?.section_order || DEFAULT_SECTION_ORDER,
      at_a_glance_visible: p?.at_a_glance_visible !== false,
      at_a_glance_stats: p?.at_a_glance_stats || DEFAULT_AT_A_GLANCE_STATS,
    };
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editPrefs, setEditPrefs] = useState(null);
  const [civilianProtection, setCivilianProtection] = useState(
    () => readDashboardSessionCache()?.civilianProtection ?? null
  );
  const [cpPanelOpen, setCpPanelOpen] = useState(true);
  const [cpTick, setCpTick] = useState(0);
  const [cpTerminating, setCpTerminating] = useState(false);
  const cpExpiredHandled = useRef(false);

  const user = authUser ? sanitizeDashboardUser(authUser) : readDashboardSessionCache()?.user ?? null;

  const fetchData = useCallback(async ({ silentError = false } = {}) => {
    try {
      const [progressRes, dashRes, civRes] = await Promise.all([
        api.get('/user/rank-progress'),
        api.get('/profile/dashboard').catch(() => ({ data: null })),
        api.get('/account/civilian-protection').catch(() => ({ data: null })),
      ]);
      const safeUser = authUser ? sanitizeDashboardUser(authUser) : readDashboardSessionCache()?.user ?? null;
      setRankProgress(progressRes.data);
      setCivilianProtection(civRes?.data ?? null);
      const prev = readDashboardSessionCache();
      const storedPrefs = mergeDashboardPreferences(dashRes?.data ?? null, prev);
      if (dashRes?.data) {
        setPreferences(storedPrefs);
      }
      writeSessionJson(DASHBOARD_SESSION_CACHE_KEY, {
        user: safeUser,
        rankProgress: progressRes.data,
        preferences: storedPrefs,
        civilianProtection: civRes?.data ?? null,
      });
    } catch (error) {
      if (!silentError) toast.error(getApiErrorMessage(error) || 'Failed to load profile');
      console.error('Error fetching dashboard data:', error);
    }
  }, [authUser?.id]);

  useEffect(() => {
    fetchData({ silentError: false });
  }, [fetchData]);

  useEffect(() => {
    const id = setInterval(() => {
      fetchData({ silentError: true });
    }, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  useEffect(() => {
    if (!civilianProtection?.active || !civilianProtection?.ends_at) return undefined;
    const id = setInterval(() => setCpTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [civilianProtection?.active, civilianProtection?.ends_at]);

  useEffect(() => {
    if (!civilianProtection?.active || !civilianProtection?.ends_at) {
      cpExpiredHandled.current = false;
      return;
    }
    const end = new Date(civilianProtection.ends_at).getTime();
    if (Number.isNaN(end) || Date.now() < end) {
      cpExpiredHandled.current = false;
      return;
    }
    if (cpExpiredHandled.current) return;
    cpExpiredHandled.current = true;
    api.get('/account/civilian-protection').then((r) => setCivilianProtection(r.data)).catch(() => {});
  }, [civilianProtection, cpTick]);

  const handleTerminateProtection = useCallback(async () => {
    if (!window.confirm('Terminate new account protection? Other players will be able to attack you.')) return;
    setCpTerminating(true);
    try {
      const r = await api.post('/account/civilian-protection/terminate');
      setCivilianProtection(r.data);
      toast.success('Protection terminated');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to terminate protection');
    } finally {
      setCpTerminating(false);
    }
  }, []);

  const handleWidgetRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('app:refresh-user', { detail: {} }));
    api.get('/account/civilian-protection').then((r) => setCivilianProtection(r.data)).catch(() => {});
  }, []);

  const openSettings = useCallback(() => {
    setEditPrefs({
      section_order: [...preferences.section_order],
      at_a_glance_visible: preferences.at_a_glance_visible,
      at_a_glance_stats: [...preferences.at_a_glance_stats],
    });
    setSettingsOpen(true);
  }, [preferences]);

  const moveSection = useCallback((index, dir) => {
    if (!editPrefs) return;
    const next = [...editPrefs.section_order];
    const ni = dir === 'up' ? index - 1 : index + 1;
    if (ni < 0 || ni >= next.length) return;
    [next[index], next[ni]] = [next[ni], next[index]];
    setEditPrefs((p) => ({ ...p, section_order: next }));
  }, [editPrefs]);

  const toggleStat = useCallback((id) => {
    if (!editPrefs) return;
    const stats = editPrefs.at_a_glance_stats.includes(id)
      ? editPrefs.at_a_glance_stats.filter((s) => s !== id)
      : [...editPrefs.at_a_glance_stats, id];
    setEditPrefs((p) => ({ ...p, at_a_glance_stats: stats }));
  }, [editPrefs]);

  const savePreferences = useCallback(async () => {
    if (!editPrefs || saving) return;
    setSaving(true);
    try {
      const res = await api.patch('/profile/dashboard', {
        section_order: editPrefs.section_order,
        at_a_glance_visible: editPrefs.at_a_glance_visible,
        at_a_glance_stats: editPrefs.at_a_glance_stats,
      });
      const nextPrefs = {
        section_order: res.data.section_order,
        at_a_glance_visible: res.data.at_a_glance_visible,
        at_a_glance_stats: res.data.at_a_glance_stats,
      };
      setPreferences(nextPrefs);
      const cur = readSessionJson(DASHBOARD_SESSION_CACHE_KEY);
      if (cur && typeof cur === 'object') {
        writeSessionJson(DASHBOARD_SESSION_CACHE_KEY, { ...cur, preferences: nextPrefs });
      }
      toast.success('Dashboard layout saved');
      setSettingsOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [editPrefs, saving]);

  const allStats = [
    { id: 'money', label: 'Cash', icon: DollarSign, value: `$${Math.floor(Number(user?.money ?? 0)).toLocaleString()}`, testId: 'stat-money' },
    { id: 'rank', label: 'Rank', icon: TrendingUp, value: user?.rank_name ?? '—', sub: `#${user?.rank ?? 0}`, testId: 'stat-rank' },
    {
      id: 'wealth',
      label: 'Wealth tier',
      icon: DollarSign,
      value: user?.wealth_rank_name ?? '—',
      tooltip: user?.wealth_rank_range ?? '$0',
      valueColor: user?.wealth_rank_color,
      testId: 'stat-wealth',
    },
    { id: 'rp', label: 'Rank points', icon: Target, value: Number(user?.rank_points ?? 0).toLocaleString(), testId: 'stat-rank-points' },
    { id: 'location', label: 'Location', icon: MapPin, value: user?.current_state ?? '—', testId: 'stat-location' },
    { id: 'kills', label: 'Kills', icon: Swords, value: user?.total_kills ?? 0, testId: 'stat-kills' },
  ];
  const stats = allStats.filter((s) => preferences.at_a_glance_stats.includes(s.id));

  const renderSection = (id) => {
    switch (id) {
      case 'rank_progress':
        return rankProgress ? (
          <RankProgressCard key={id} rankProgress={rankProgress} hasPremiumBar={!!user?.premium_rank_bar} />
        ) : null;
      case 'rewards_objectives':
        return (
          <div key={id} className="grid grid-cols-1 lg:grid-cols-2 gap-2 min-w-0">
            <DailyRewardsWidget userId={user?.id} onRefresh={handleWidgetRefresh} />
            <ObjectivesWidget userId={user?.id} onRefresh={handleWidgetRefresh} />
          </div>
        );
      case 'notifications_event':
        return (
          <div key={id} className="grid grid-cols-1 lg:grid-cols-2 gap-2 min-w-0">
            <NotificationsWidget userId={user?.id} onRefresh={handleWidgetRefresh} />
            <EventOrStoreSlot user={user} userId={user?.id} />
          </div>
        );
      case 'bodyguards_properties':
        return (
          <div key={id} className="grid grid-cols-1 lg:grid-cols-2 gap-2 min-w-0">
            <BodyguardsWidget userId={user?.id} />
            <MyPropertiesWidget userId={user?.id} />
          </div>
        );
      case 'auto_rank':
        return <AutoRankStatusWidget key={id} user={user} />;
      case 'at_a_glance':
        if (!preferences.at_a_glance_visible || stats.length === 0) return null;
        return (
          <section key={id} className="mobile-panel">
            <div className="flex items-center gap-1.5 mb-1.5">
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">At a Glance</h2>
              <div className="flex-1 h-px bg-gradient-to-r from-primary/40 via-primary/20 to-transparent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 md:gap-2">
              {stats.map((stat, i) => (
                <StatCard key={stat.id} stat={stat} delay={i * 0.04} />
              ))}
            </div>
          </section>
        );
      case 'go_to':
        return (
          <section key={id} className="mobile-panel">
            <div className="flex items-center gap-1.5 mb-1.5">
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Go to</h2>
              <div className="flex-1 h-px bg-gradient-to-r from-primary/40 via-primary/20 to-transparent" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                  <TooltipProvider key={link.to}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          to={link.to}
                          className="flex items-center justify-center w-10 h-10 rounded-md border border-primary/20 bg-primary/5 hover:bg-primary/15 hover:border-primary/30 transition-all active:scale-95"
                        >
                          <Icon size={16} className="text-primary" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className={`${styles.panel} text-foreground border-primary/30 rounded-md px-2 py-1 text-[10px] font-heading`}>
                        {link.label}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </section>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="dashboard-page">
      <style>{DASH_STYLES}</style>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] text-zinc-500 font-heading italic">Your command center — play, claim, and stay on top.</p>
        <button
          type="button"
          onClick={openSettings}
          className="p-1.5 rounded border border-primary/20 bg-primary/5 hover:bg-primary/15 hover:border-primary/30 transition-all active:scale-95"
          aria-label="Dashboard settings"
        >
          <Settings size={14} className="text-primary" />
        </button>
      </div>

      {civilianProtection?.active && (
        <Collapsible open={cpPanelOpen} onOpenChange={setCpPanelOpen} className="dash-scale-in">
          <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-emerald-500/30`}>
            <div className="h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
            <CollapsibleTrigger className="w-full px-2.5 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between gap-2 text-left hover:bg-emerald-500/15 transition-colors">
              <div className="flex items-center gap-1.5 min-w-0">
                <Shield size={14} className="text-emerald-400 shrink-0" />
                <h2 className="text-[10px] font-heading font-bold text-emerald-400 uppercase tracking-[0.12em] truncate">
                  Current protection
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-heading tabular-nums text-foreground" title="Time remaining">
                  {formatProtectionCountdown(civilianProtection.ends_at)}
                </span>
                {cpPanelOpen ? <ChevronUp size={14} className="text-emerald-400" /> : <ChevronDown size={14} className="text-emerald-400" />}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-2.5 py-2 space-y-2">
                <p className="text-[10px] font-heading text-mutedForeground leading-relaxed">
                  For your first {formatProtectionDurationLabel(civilianProtection.protection_hours)}, other players can't attack you in normal PvP. When the countdown hits zero, protection ends on its own — or it ends immediately if you do any of the following.
                </p>
                <div>
                  <p className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.1em] mb-1">These actions remove protection</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-[10px] font-heading text-foreground/90">
                    {(civilianProtection.rules_bullets || []).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={handleTerminateProtection}
                  disabled={cpTerminating}
                  className="w-full py-1.5 rounded border border-red-500/50 bg-red-950/40 text-red-400 text-[10px] font-heading font-bold hover:bg-red-950/60 hover:border-red-400/60 disabled:opacity-50 transition-colors"
                >
                  {cpTerminating ? 'Terminating…' : 'Terminate protection'}
                </button>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {preferences.section_order.map((id) => renderSection(id)).filter(Boolean)}

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className={`${styles.panel} border-primary/20 w-[min(100vw,320px)]`}>
          <SheetHeader>
            <SheetTitle className="text-primary font-heading text-sm">Dashboard layout</SheetTitle>
          </SheetHeader>
          {editPrefs && (
            <div className="mt-4 space-y-4">
              <div>
                <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] mb-2">Section order</h3>
                <div className="space-y-1">
                  {editPrefs.section_order.map((id, i) => (
                    <div key={id} className="flex items-center gap-1 rounded border border-primary/20 bg-primary/5 px-2 py-1.5">
                      <div className="flex flex-col gap-0">
                        <button type="button" onClick={() => moveSection(i, 'up')} disabled={i === 0} className="p-0.5 disabled:opacity-30">
                          <ChevronUp size={12} className="text-primary" />
                        </button>
                        <button type="button" onClick={() => moveSection(i, 'down')} disabled={i === editPrefs.section_order.length - 1} className="p-0.5 disabled:opacity-30">
                          <ChevronDown size={12} className="text-primary" />
                        </button>
                      </div>
                      <span className="text-[10px] font-heading text-foreground flex-1">{SECTION_LABELS[id] || id}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] mb-2">At a Glance</h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editPrefs.at_a_glance_visible}
                    onChange={(e) => setEditPrefs((p) => ({ ...p, at_a_glance_visible: e.target.checked }))}
                    className="rounded border-primary/30"
                  />
                  <span className="text-[10px] font-heading">Show section</span>
                </label>
                {editPrefs.at_a_glance_visible && (
                  <div className="mt-2 space-y-1 pl-4">
                    {STAT_OPTIONS.map((opt) => (
                      <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editPrefs.at_a_glance_stats.includes(opt.id)}
                          onChange={() => toggleStat(opt.id)}
                          className="rounded border-primary/30"
                        />
                        <span className="text-[10px] font-heading text-mutedForeground">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={savePreferences}
                disabled={saving}
                className="w-full py-2 rounded border border-primary/40 bg-primary/20 text-primary text-[10px] font-heading font-bold hover:bg-primary/30 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save layout'}
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
