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
} from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import styles from '../styles/noir.module.css';

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[40vh]">
    <div className="text-primary text-sm font-heading font-bold">Loading...</div>
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

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
        <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
          Rank Progress
        </h2>
        {!hasPremiumBar && (
          <Link 
            to="/store" 
            className="text-[10px] font-heading font-bold text-primary hover:text-primary/80 transition-colors"
          >
            Premium bar →
          </Link>
        )}
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-heading text-foreground">
            {rankProgress.current_rank_name}
            {rankProgress.next_rank && (
              <span className="text-mutedForeground"> → {rankProgress.next_rank_name}</span>
            )}
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] font-heading">
            <span className="text-mutedForeground">Rank Points</span>
            <span className="font-bold text-primary tabular-nums">
              {(rankProgress.rank_points_current || 0).toLocaleString()}
              {hasPremiumBar && rankProgress.next_rank && (
                <span className="text-mutedForeground">
                  {' / '}{((rankProgress.rank_points_current || 0) + (rankProgress.rank_points_needed || 0)).toLocaleString()}
                </span>
              )}
            </span>
          </div>
          <div className="relative w-full h-2.5 bg-secondary rounded-full overflow-hidden border border-primary/20">
            <div
              className="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, minWidth: progressPct > 0 ? '6px' : 0, background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))' }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {hasPremiumBar && rankProgress.rank_points_needed > 0 && (
            <p className="text-[10px] font-heading text-mutedForeground text-right">
              {rankProgress.rank_points_needed.toLocaleString()} RP to next rank
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ stat }) => {
  const Icon = stat.icon;
  
  return (
    <div
      className={`${styles.panel} border border-border rounded-md p-2.5 flex items-start gap-2 hover:border-primary/30 transition-all`}
      data-testid={stat.testId}
    >
      <div className="p-1.5 rounded bg-primary/20 border border-primary/30 shrink-0">
        <Icon className="text-primary" size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-mutedForeground uppercase tracking-wider mb-0.5">
          {stat.label}
        </p>
        {stat.tooltip ? (
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
          <p className="text-sm font-heading font-bold text-foreground truncate">
            {stat.value}
          </p>
        )}
        {stat.sub && (
          <p className="text-[10px] text-mutedForeground mt-0.5">{stat.sub}</p>
        )}
      </div>
    </div>
  );
};

const QuickActionCard = ({ action }) => {
  const Icon = action.icon;
  
  return (
    <Link
      to={action.to}
      data-testid={`quick-action-${action.id}`}
      className={`group ${styles.panel} border border-border rounded-md p-2.5 flex items-center gap-2 hover:border-primary/50 hover:shadow-md hover:shadow-primary/10 transition-all touch-manipulation`}
    >
      <div className="p-1.5 rounded bg-primary/20 border border-primary/30 group-hover:bg-primary/30 shrink-0 transition-colors">
        <Icon className="text-primary" size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-heading font-bold text-foreground group-hover:text-primary transition-colors">
          {action.title}
        </p>
        <p className="text-[10px] text-mutedForeground truncate mt-0.5">
          {action.desc}
        </p>
      </div>
      <ChevronRight 
        className="text-mutedForeground group-hover:text-primary shrink-0 transition-colors" 
        size={14} 
      />
    </Link>
  );
};

const GameSystemsCard = () => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
      <Zap size={14} className="text-primary" />
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        Game Systems
      </span>
    </div>
    <div className="p-3 grid sm:grid-cols-2 gap-3">
      <div>
        <p className="font-bold text-primary text-xs mb-1 flex items-center gap-1.5">
          <span className="text-primary">▸</span> Ranks
        </p>
        <p className="text-mutedForeground text-[10px] leading-snug">
          Rise from Rat to Godfather. Each rank unlocks crimes, weapons, and opportunities.
        </p>
      </div>
      <div>
        <p className="font-bold text-primary text-xs mb-1 flex items-center gap-1.5">
          <span className="text-primary">▸</span> Bodyguards
        </p>
        <p className="text-mutedForeground text-[10px] leading-snug">
          Hire up to 4 bodyguards (points). Human or robot guards protect you from attacks.
        </p>
      </div>
    </div>
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
      toast.error('Failed to load profile');
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
    <div className={`space-y-3 md:space-y-4 ${styles.pageContent}`} data-testid="dashboard-page">
      {rankProgress && (
        <RankProgressCard 
          rankProgress={rankProgress} 
          hasPremiumBar={!!user?.premium_rank_bar} 
        />
      )}

      {/* Stats grid */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            At a Glance
          </h2>
          <div className="flex-1 h-px opacity-30" style={{ backgroundColor: 'var(--noir-accent-line)' }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
          {stats.map((stat) => (
            <StatCard key={stat.id} stat={stat} />
          ))}
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            Quick Actions
          </h2>
          <div className="flex-1 h-px opacity-30" style={{ backgroundColor: 'var(--noir-accent-line)' }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
          {quickActions.map((action) => (
            <QuickActionCard key={action.id} action={action} />
          ))}
        </div>
      </section>

      <GameSystemsCard />
    </div>
  );
}
