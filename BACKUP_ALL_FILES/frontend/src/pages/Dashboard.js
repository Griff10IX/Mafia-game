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

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [rankProgress, setRankProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
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
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  const stats = [
    { id: 'money', label: 'Cash', icon: DollarSign, value: `$${Number(user?.money ?? 0).toLocaleString()}`, testId: 'stat-money' },
    { id: 'rank', label: 'Rank', icon: TrendingUp, value: user?.rank_name ?? '—', sub: `#${user?.rank ?? 0}`, testId: 'stat-rank' },
    {
      id: 'wealth',
      label: 'Wealth tier',
      icon: DollarSign,
      value: user?.wealth_rank_name ?? '—',
      tooltip: user?.wealth_rank_range ?? '$0',
      testId: 'stat-wealth',
    },
    { id: 'rp', label: 'Rank points', icon: Target, value: Number(user?.rank_points ?? 0).toLocaleString(), testId: 'stat-rank-points' },
    { id: 'location', label: 'Location', icon: MapPin, value: user?.current_state ?? '—', testId: 'stat-location' },
    { id: 'kills', label: 'Kills', icon: Swords, value: user?.total_kills ?? 0, testId: 'stat-kills' },
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
    <div className="space-y-8" data-testid="dashboard-page">
      {/* Header */}
      <header>
        <p className="text-xs uppercase tracking-[0.25em] text-mutedForeground">Dashboard</p>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-1" data-testid="dashboard-title">
          Welcome, {user?.username}
        </h1>
        <p className="text-sm text-mutedForeground mt-1">
          {user?.rank_name ?? '—'} · {user?.current_state ?? '—'}
        </p>
      </header>

      {/* Rank progress */}
      {rankProgress && (
        <section className="bg-card border border-border rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Rank progress</h2>
              <p className="text-xs text-mutedForeground mt-0.5">
                {rankProgress.current_rank_name}
                {rankProgress.next_rank && ` → ${rankProgress.next_rank_name}`}
              </p>
            </div>
            {!user?.premium_rank_bar && (
              <Link to="/store" className="text-xs text-primary hover:underline">
                Premium bar in Store
              </Link>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-mutedForeground">
              <span>Rank points</span>
              <span className="font-mono text-foreground">
                {(rankProgress.rank_points_current || 0).toLocaleString()}
                {user?.premium_rank_bar && rankProgress.next_rank && (
                  <> / {((rankProgress.rank_points_current || 0) + (rankProgress.rank_points_needed || 0)).toLocaleString()}</>
                )}
              </span>
            </div>
            <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500 rounded-full"
                style={{ width: `${rankProgress.rank_points_progress || 0}%` }}
              />
            </div>
            {user?.premium_rank_bar && rankProgress.rank_points_needed > 0 && (
              <p className="text-xs text-mutedForeground">{rankProgress.rank_points_needed.toLocaleString()} RP to next rank</p>
            )}
          </div>
        </section>
      )}

      {/* Stats grid */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">At a glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.id}
                className="bg-card border border-border rounded-lg p-4 flex items-start gap-3"
                data-testid={s.testId}
              >
                <div className="p-1.5 rounded-md bg-primary/10">
                  <Icon className="text-primary shrink-0" size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-mutedForeground uppercase tracking-wider">{s.label}</p>
                  {s.tooltip ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-base font-semibold text-foreground font-mono truncate cursor-default underline decoration-dotted decoration-muted-foreground/50 underline-offset-1">
                            {s.value}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="bg-zinc-800 text-white border border-zinc-600 rounded-md px-3 py-2 text-sm font-mono">
                          {s.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <p className="text-base font-semibold text-foreground font-mono truncate">{s.value}</p>
                  )}
                  {s.sub && <p className="text-xs text-mutedForeground">{s.sub}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.id}
                to={a.to}
                data-testid={`quick-action-${a.id}`}
                className="group bg-card border border-border rounded-lg p-4 flex items-center gap-4 hover:border-primary/50 hover:bg-card/80 transition-colors"
              >
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Icon className="text-primary shrink-0" size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{a.title}</p>
                  <p className="text-xs text-mutedForeground truncate">{a.desc}</p>
                </div>
                <ChevronRight className="text-mutedForeground group-hover:text-primary shrink-0 transition-colors" size={18} />
              </Link>
            );
          })}
        </div>
      </section>

      {/* Game systems (compact) */}
      <section className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Zap size={16} className="text-primary" /> Game systems
        </h2>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium text-foreground mb-1">Ranks</p>
            <p className="text-mutedForeground leading-relaxed">
              Rise from Street Thug to The Commission. Each rank unlocks crimes, weapons, and opportunities.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">Bodyguards</p>
            <p className="text-mutedForeground leading-relaxed">
              Hire up to 4 bodyguards (points). Human or robot guards protect you from attacks.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
