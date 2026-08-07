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
  Heart,
  Crosshair,
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
  normalizeDashboardSectionOrder,
} from '../../utils/dashboardSessionCache';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible';
import styles from '../../styles/noir.module.css';
import dash from '../../styles/dashboard.module.css';
import DailyRewardsWidget from '../../components/dashboard/DailyRewardsWidget';
import ObjectivesWidget from '../../components/dashboard/ObjectivesWidget';
import NotificationsWidget from '../../components/dashboard/NotificationsWidget';
import AutoRankStatusWidget from '../../components/dashboard/AutoRankStatusWidget';
import BodyguardsWidget from '../../components/dashboard/BodyguardsWidget';
import MyPropertiesWidget from '../../components/dashboard/MyPropertiesWidget';

function CommandStatusHero({ user, rankProgress, vitals, showVitals }) {
  const current = Number(rankProgress?.rank_points_current) || 0;
  const needed = Number(rankProgress?.rank_points_needed) || 0;
  const total = current + needed;
  const pctFromApi = Number(rankProgress?.rank_points_progress);
  const progressPct = (typeof pctFromApi === 'number' && !Number.isNaN(pctFromApi) && pctFromApi >= 0)
    ? Math.min(100, Math.max(0, pctFromApi))
    : (total > 0 ? Math.min(100, (current / total) * 100) : 0);
  const hasPremiumBar = !!user?.premium_rank_bar;
  const progressLabel = hasPremiumBar ? progressPct.toFixed(2) : progressPct.toFixed(0);
  const progressKind = rankProgress?.progress_kind || (rankProgress?.next_rank ? 'street' : needed > 0 ? 'prestige' : 'max');
  const isPrestigeBar = progressKind === 'prestige';
  const showPremiumTotal = hasPremiumBar && (rankProgress?.next_rank || (isPrestigeBar && needed > 0));

  return (
    <div className={`${dash.panel} ${dash.hero} ${dash.scaleIn} mobile-panel`} data-testid="command-status">
      <div className={dash.heroWash} aria-hidden />
      <div className={dash.heroInner}>
        <div className={dash.heroMeta}>
          <div>
            <p className={`${dash.heroName} font-heading`}>{user?.username || 'Operative'}</p>
            <p className={`${dash.heroSub} font-heading`}>
              {user?.rank_name || '—'}
              {user?.current_state ? ` · ${user.current_state}` : ''}
            </p>
          </div>
          {!hasPremiumBar && (
            <Link to="/game/store" className={`${dash.premiumLink} font-heading`}>
              Premium bar →
            </Link>
          )}
        </div>

        {rankProgress && (
          <div className={dash.rankBlock}>
            <div className={dash.rankRow}>
              <p className={`${dash.rankLabel} font-heading`}>
                {isPrestigeBar ? 'Prestige RP' : 'Rank Progress'}
              </p>
              <span className={`${dash.rankPts} font-heading`}>
                {current.toLocaleString()}
                {showPremiumTotal && (
                  <span className={dash.rankMuted}>
                    {' / '}{(current + needed).toLocaleString()}
                  </span>
                )}
                <span className={`${dash.rankMuted} font-normal`}> ({progressLabel}%)</span>
              </span>
            </div>
            <p className={`${dash.rankNames} font-heading`}>
              {rankProgress.current_rank_name}
              {rankProgress.next_rank && (
                <span className={dash.rankMuted}> → {rankProgress.next_rank_name}</span>
              )}
            </p>
            {isPrestigeBar && (
              <p className={`${dash.neededNote} font-heading`} style={{ textAlign: 'left' }}>
                Bar is total RP for the next prestige gate.
              </p>
            )}
            <div className={dash.progressTrack}>
              <div
                className={dash.progressFill}
                style={{ width: `${progressPct}%`, minWidth: progressPct > 0 ? 4 : 0 }}
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
            {hasPremiumBar && needed > 0 && (
              <p className={`${dash.neededNote} font-heading`}>
                {needed.toLocaleString()} RP {isPrestigeBar ? 'to next prestige' : 'to next rank'}
              </p>
            )}
          </div>
        )}

        {showVitals && vitals.length > 0 && (
          <div className={dash.vitals}>
            {vitals.map((stat) => {
              const Icon = stat.icon;
              const valueStyle = stat.valueColor && /^#[0-9A-Fa-f]{6}$/.test(String(stat.valueColor).trim())
                ? { color: String(stat.valueColor).trim() }
                : undefined;
              const valueEl = (
                <p className={`${dash.vitalValue} font-heading`} style={valueStyle} title={stat.tooltip || undefined}>
                  {stat.value}
                </p>
              );
              return (
                <div key={stat.id} className={dash.vital} data-testid={stat.testId}>
                  <span className={`${dash.vitalLabel} font-heading`}>
                    <Icon size={9} style={{ color: 'var(--noir-primary)' }} aria-hidden />
                    {stat.label}
                  </span>
                  {stat.tooltip ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="min-w-0 cursor-default underline decoration-dotted decoration-primary/40 underline-offset-2">
                            {valueEl}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className={`${styles.panel} text-foreground border-primary/30 rounded-md px-3 py-2 text-xs font-heading`}
                        >
                          {stat.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : valueEl}
                  {stat.sub ? <p className={`${dash.vitalSub} font-heading`}>{stat.sub}</p> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

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
  command_status: 'Command status',
  daily_ops: 'Daily ops',
  intel_assets: 'Intel & assets',
  auto_rank: 'Auto Rank',
  routes: 'Routes',
};

const STAT_OPTIONS = [
  { id: 'money', label: 'Cash' },
  { id: 'rank', label: 'Rank' },
  { id: 'wealth', label: 'Wealth tier' },
  { id: 'rp', label: 'Rank points' },
  { id: 'location', label: 'Location' },
  { id: 'kills', label: 'Kills' },
  { id: 'health', label: 'Health' },
  { id: 'bullets', label: 'Bullets' },
];

export default function Dashboard() {
  const authUser = useAuthUser();
  const [rankProgress, setRankProgress] = useState(null);
  const [preferences, setPreferences] = useState(() => {
    const p = readDashboardSessionCache()?.preferences;
    return {
      section_order: normalizeDashboardSectionOrder(p?.section_order || DEFAULT_SECTION_ORDER),
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
      section_order: normalizeDashboardSectionOrder(preferences.section_order),
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
        section_order: normalizeDashboardSectionOrder(editPrefs.section_order),
        at_a_glance_visible: editPrefs.at_a_glance_visible,
        at_a_glance_stats: editPrefs.at_a_glance_stats,
      });
      const nextPrefs = {
        section_order: normalizeDashboardSectionOrder(res.data.section_order),
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

  const healthPct = Math.max(0, Math.min(100, Math.round(Number(user?.health ?? 100))));
  const allStats = [
    { id: 'money', label: 'Cash', icon: DollarSign, value: `$${Math.floor(Number(user?.money ?? 0)).toLocaleString()}`, testId: 'stat-money' },
    { id: 'rank', label: 'Rank', icon: TrendingUp, value: user?.rank_name ?? '—', sub: `#${user?.rank ?? 0}`, testId: 'stat-rank' },
    {
      id: 'wealth',
      label: 'Wealth',
      icon: DollarSign,
      value: user?.wealth_rank_name ?? '—',
      tooltip: user?.wealth_rank_range ?? '$0',
      valueColor: user?.wealth_rank_color,
      testId: 'stat-wealth',
    },
    { id: 'rp', label: 'RP', icon: Target, value: Number(user?.rank_points ?? 0).toLocaleString(), testId: 'stat-rank-points' },
    { id: 'location', label: 'Location', icon: MapPin, value: user?.current_state ?? '—', testId: 'stat-location' },
    { id: 'kills', label: 'Kills', icon: Swords, value: user?.total_kills ?? 0, testId: 'stat-kills' },
    {
      id: 'health',
      label: 'Health',
      icon: Heart,
      value: `${healthPct}%`,
      testId: 'stat-health',
    },
    {
      id: 'bullets',
      label: 'Bullets',
      icon: Crosshair,
      value: Math.floor(Number(user?.bullets ?? 0)).toLocaleString(),
      testId: 'stat-bullets',
    },
  ];
  // Prefer selected stats; if empty selection but visible, fall back to money/health/bullets/location
  const selectedIds = preferences.at_a_glance_stats?.length
    ? preferences.at_a_glance_stats
    : ['money', 'health', 'bullets', 'location'];
  const vitals = allStats.filter((s) => selectedIds.includes(s.id));

  const renderSection = (id) => {
    switch (id) {
      case 'command_status':
        return (
          <CommandStatusHero
            key={id}
            user={user}
            rankProgress={rankProgress}
            vitals={vitals}
            showVitals={preferences.at_a_glance_visible !== false}
          />
        );
      case 'daily_ops':
        return (
          <div key={id} className={dash.grid2}>
            <DailyRewardsWidget userId={user?.id} onRefresh={handleWidgetRefresh} />
            <ObjectivesWidget userId={user?.id} onRefresh={handleWidgetRefresh} />
          </div>
        );
      case 'intel_assets':
        return (
          <div key={id} className={dash.intelGrid}>
            <NotificationsWidget userId={user?.id} onRefresh={handleWidgetRefresh} />
            <div className={dash.stackCol}>
              <BodyguardsWidget userId={user?.id} />
              <MyPropertiesWidget userId={user?.id} />
            </div>
          </div>
        );
      case 'auto_rank':
        return <AutoRankStatusWidget key={id} user={user} />;
      case 'routes':
        return (
          <section key={id} className={`${dash.routesSection} mobile-panel`}>
            <div className={dash.sectionLabel}>
              <span className="font-heading">Routes</span>
              <span className={dash.sectionRule} aria-hidden />
            </div>
            <div className={dash.routes}>
              {QUICK_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                  <Link key={link.to} to={link.to} className={`${dash.routeChip} font-heading`}>
                    <Icon size={14} className={dash.routeIcon} aria-hidden />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      default:
        return null;
    }
  };

  const sectionOrder = normalizeDashboardSectionOrder(preferences.section_order);

  return (
    <div className={`${dash.page} ${styles.pageContent} mobile-page-root`} data-testid="dashboard-page">
      <div className={`${dash.topBar} ${dash.fadeIn}`}>
        <p className={`${dash.tagline} font-heading`}>Command center — play, claim, stay ahead.</p>
        <button
          type="button"
          onClick={openSettings}
          className={dash.settingsBtn}
          aria-label="Dashboard settings"
        >
          <Settings size={14} />
        </button>
      </div>

      {civilianProtection?.active && (
        <Collapsible open={cpPanelOpen} onOpenChange={setCpPanelOpen} className={dash.scaleIn}>
          <div className={`${dash.panel} ${dash.cpPanel} mobile-panel`}>
            <CollapsibleTrigger className={`w-full ${dash.panelHeader} ${dash.cpHeader} text-left hover:opacity-95 transition-opacity`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <Shield size={14} className="text-emerald-400 shrink-0" />
                <h2 className={`${dash.panelTitle} ${dash.cpTitle} truncate`}>
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
              <div className={`${dash.panelBody} space-y-2`}>
                <p className="text-[10px] font-heading text-mutedForeground leading-relaxed">
                  For your first {formatProtectionDurationLabel(civilianProtection.protection_hours)}, other players can&apos;t attack you in normal PvP. When the countdown hits zero, protection ends on its own — or it ends immediately if you do any of the following.
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

      {sectionOrder.map((id) => renderSection(id)).filter(Boolean)}

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
                <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] mb-2">Status vitals</h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editPrefs.at_a_glance_visible}
                    onChange={(e) => setEditPrefs((p) => ({ ...p, at_a_glance_visible: e.target.checked }))}
                    className="rounded border-primary/30"
                  />
                  <span className="text-[10px] font-heading">Show vitals on command status</span>
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
