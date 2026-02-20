import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  TrendingUp,
  Target,
  Shield,
  MapPin,
  ChevronRight,
  User,
  Swords,
  Building2,
  Dice5,
  Landmark,
  ShoppingBag,
  Car,
  Trophy,
  Zap,
  LayoutDashboard,
} from 'lucide-react';
import api, { getApiErrorMessage } from '../utils/api';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import styles from '../styles/noir.module.css';

const DASH_STYLES = `
  @keyframes dash-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .dash-fade-in { animation: dash-fade-in 0.4s ease-out both; }
  @keyframes dash-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .dash-scale-in { animation: dash-scale-in 0.35s ease-out both; }
  @keyframes dash-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .dash-glow { animation: dash-glow 4s ease-in-out infinite; }
  .dash-corner::before, .dash-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .dash-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .dash-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .dash-card { transition: all 0.3s ease; }
  .dash-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .dash-stat-card { transition: all 0.3s ease; }
  .dash-stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .dash-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
    <LayoutDashboard size={22} className="text-primary/40 animate-pulse" />
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading command center...</span>
  </div>
);

const RankProgressCard = ({ rankProgress, hasPremiumBar }) => {
  const current = Number(rankProgress.rank_points_current) || 0;
  const needed = Number(rankProgress.rank_points_needed) || 0;
  const total = current + needed;
  const pctFromApi = Number(rankProgress.rank_points_progress);
  const progressPct = (typeof pctFromApi === 'number' && !Number.isNaN(pctFromApi) && pctFromApi > 0)
    ? Math.min(100, Math.max(0, pctFromApi))
    : (total > 0 ? Math.min(100, (current / total) * 100) : needed === 0 ? 100 : 0);
  const progressLabel = hasPremiumBar ? progressPct.toFixed(2) : progressPct.toFixed(0);

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 dash-corner dash-scale-in`}>
      <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none dash-glow" />
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          Rank Progress
        </h2>
        {!hasPremiumBar && (
          <Link 
            to="/store" 
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
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-heading">
            <span className="text-mutedForeground">Rank Points</span>
            <span className="font-bold text-primary tabular-nums">
              {(rankProgress.rank_points_current || 0).toLocaleString()}
              {hasPremiumBar && rankProgress.next_rank && (
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
              {rankProgress.rank_points_needed.toLocaleString()} RP to next rank
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
  const valueEl = stat.tooltip ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="text-sm font-heading font-bold text-foreground truncate cursor-default underline decoration-dotted decoration-primary/50 underline-offset-2">
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
    <p className="text-sm font-heading font-bold text-foreground truncate">{stat.value}</p>
  );

  return (
    <div
      className={`relative ${styles.surface} rounded-md overflow-hidden p-2 border border-primary/20 dash-stat-card dash-corner dash-scale-in`}
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

const QuickActionCard = ({ action, delay = 0 }) => {
  const Icon = action.icon;

  return (
    <Link
      to={action.to}
      data-testid={`quick-action-${action.id}`}
      className={`group relative ${styles.panel} border border-primary/20 rounded-md p-2 flex items-center gap-2 dash-card dash-fade-in touch-manipulation overflow-hidden`}
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent pointer-events-none" />
      <div className="p-1 rounded bg-primary/20 border border-primary/30 group-hover:bg-primary/30 shrink-0 transition-colors">
        <Icon className="text-primary" size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-heading font-bold text-foreground group-hover:text-primary transition-colors">
          {action.title}
        </p>
        <p className="text-[9px] text-mutedForeground truncate mt-0.5">
          {action.desc}
        </p>
      </div>
      <ChevronRight 
        className="text-mutedForeground group-hover:text-primary shrink-0 transition-colors" 
        size={12} 
      />
    </Link>
  );
};

const GameSystemsCard = () => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 dash-fade-in`} style={{ animationDelay: '0.1s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1">
      <Zap size={9} className="text-primary" />
      <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        Game Systems
      </span>
    </div>
    <div className="p-2 grid sm:grid-cols-2 gap-1.5">
      <div>
        <p className="font-bold text-primary text-[10px] mb-0.5 flex items-center gap-0.5">
          <span className="text-primary">▸</span> Ranks
        </p>
        <p className="text-mutedForeground text-[9px] leading-tight">
          Rise from Rat to Godfather. Each rank unlocks crimes, weapons, and opportunities.
        </p>
      </div>
      <div>
        <p className="font-bold text-primary text-[10px] mb-0.5 flex items-center gap-0.5">
          <span className="text-primary">▸</span> Bodyguards
        </p>
        <p className="text-mutedForeground text-[9px] leading-tight">
          Hire up to 4 bodyguards (points). Human or robot guards protect you from attacks.
        </p>
      </div>
    </div>
    <div className="dash-art-line text-primary mx-2" />
  </div>
);

// Main component
export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [rankProgress, setRankProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    try {
      const [userRes, progressRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/user/rank-progress'),
      ]);
      setUser(userRes.data);
      setRankProgress(progressRes.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || 'Failed to load profile');
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  const stats = [
    { 
      id: 'money', 
      label: 'Cash', 
      icon: DollarSign, 
      value: `$${Number(user?.money ?? 0).toLocaleString()}`, 
      testId: 'stat-money' 
    },
    { 
      id: 'rank', 
      label: 'Rank', 
      icon: TrendingUp, 
      value: user?.rank_name ?? '—', 
      sub: `#${user?.rank ?? 0}`, 
      testId: 'stat-rank' 
    },
    {
      id: 'wealth',
      label: 'Wealth tier',
      icon: DollarSign,
      value: user?.wealth_rank_name ?? '—',
      tooltip: user?.wealth_rank_range ?? '$0',
      testId: 'stat-wealth',
    },
    { 
      id: 'rp', 
      label: 'Rank points', 
      icon: Target, 
      value: Number(user?.rank_points ?? 0).toLocaleString(), 
      testId: 'stat-rank-points' 
    },
    { 
      id: 'location', 
      label: 'Location', 
      icon: MapPin, 
      value: user?.current_state ?? '—', 
      testId: 'stat-location' 
    },
    { 
      id: 'kills', 
      label: 'Kills', 
      icon: Swords, 
      value: user?.total_kills ?? 0, 
      testId: 'stat-kills' 
    },
  ];

  const quickActions = [
    { id: 'profile', to: '/profile', title: 'Profile', desc: 'View & edit your gangster', icon: User },
    { id: 'ranking', to: '/ranking', title: 'Ranking', desc: 'Crimes, GTA, Jail', icon: Target },
    { id: 'attack', to: '/attack', title: 'Attack', desc: 'Search and hit rivals', icon: Shield },
    { id: 'families', to: '/families', title: 'Families & Rackets', desc: 'Crew, rackets, raid enemies', icon: Building2 },
    { id: 'casino', to: '/casino', title: 'Casino', desc: 'Dice, blackjack, horses', icon: Dice5 },
    { id: 'bank', to: '/bank', title: 'Bank', desc: 'Deposits & Swiss account', icon: Landmark },
    { id: 'store', to: '/store', title: 'Store', desc: 'Points shop & upgrades', icon: ShoppingBag },
    { id: 'bodyguards', to: '/bodyguards', title: 'Bodyguards', desc: 'Hire protection', icon: Shield },
    { id: 'travel', to: '/travel', title: 'Travel', desc: 'Move between states', icon: Car },
    { id: 'leaderboard', to: '/leaderboard', title: 'Leaderboard', desc: 'Top players', icon: Trophy },
  ];

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="dashboard-page">
      <style>{DASH_STYLES}</style>

      <p className="text-[9px] text-zinc-500 font-heading italic">At a glance and quick actions — your empire starts here.</p>

      {rankProgress && (
        <RankProgressCard 
          rankProgress={rankProgress} 
          hasPremiumBar={!!user?.premium_rank_bar} 
        />
      )}

      {/* Stats grid */}
      <section>
        <div className="flex items-center gap-1.5 mb-1.5">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
            At a Glance
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-primary/40 via-primary/20 to-transparent" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 md:gap-2">
          {stats.map((stat, i) => (
            <StatCard key={stat.id} stat={stat} delay={i * 0.04} />
          ))}
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <div className="flex items-center gap-1.5 mb-1.5">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
            Quick Actions
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-primary/40 via-primary/20 to-transparent" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 md:gap-2">
          {quickActions.map((action, i) => (
            <QuickActionCard key={action.id} action={action} delay={i * 0.03} />
          ))}
        </div>
      </section>

      <GameSystemsCard />
    </div>
  );
}
