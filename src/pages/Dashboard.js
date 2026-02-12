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
    <div className={`space-y-8 ${styles.pageContent}`} data-testid="dashboard-page">
      {/* Header */}
      <header className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider" data-testid="dashboard-title">
            Welcome, {user?.username}
          </h1>
          <div className="h-px flex-1 max-w-[60px] md:max-w-[100px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">
          {user?.rank_name ?? '—'} · {user?.current_state ?? '—'}
        </p>
      </header>

      {/* Rank progress */}
      {rankProgress && (
        <section className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-px bg-primary/50" />
              <h2 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Rank progress</h2>
              <div className="flex-1 h-px bg-primary/50" />
            </div>
            {!user?.premium_rank_bar && (
              <Link to="/store" className="text-xs font-heading font-bold text-primary hover:text-primary/80">
                Premium bar in Store
              </Link>
            )}
          </div>
          <div className="p-4 space-y-2">
            <p className="text-xs font-heading text-mutedForeground">
              {rankProgress.current_rank_name}
              {rankProgress.next_rank && ` → ${rankProgress.next_rank_name}`}
            </p>
            <div className="flex justify-between text-xs font-heading text-mutedForeground">
              <span>Rank points</span>
              <span className="font-bold text-foreground">
                {(rankProgress.rank_points_current || 0).toLocaleString()}
                {user?.premium_rank_bar && rankProgress.next_rank && (
                  <> / {((rankProgress.rank_points_current || 0) + (rankProgress.rank_points_needed || 0)).toLocaleString()}</>
                )}
              </span>
            </div>
            {(() => {
              const current = Number(rankProgress.rank_points_current) || 0;
              const needed = Number(rankProgress.rank_points_needed) || 0;
              const total = current + needed;
              const pctFromApi = Number(rankProgress.rank_points_progress);
              const progressPct = (typeof pctFromApi === 'number' && !Number.isNaN(pctFromApi))
                ? Math.min(100, Math.max(0, pctFromApi))
                : (total > 0 ? Math.min(100, (current / total) * 100) : needed === 0 ? 100 : 0);
              return (
                <div className={`h-2.5 w-full ${styles.raised} rounded-full overflow-hidden border border-primary/20`} style={{ minHeight: 10 }}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-yellow-600 transition-all duration-500"
                    style={{
                      width: `${progressPct}%`,
                      minWidth: progressPct > 0 ? 8 : 0,
                      height: '100%',
                      display: 'block',
                      boxSizing: 'border-box'
                    }}
                    role="progressbar"
                    aria-valuenow={progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
              );
            })()}
            {user?.premium_rank_bar && rankProgress.rank_points_needed > 0 && (
              <p className="text-xs font-heading text-mutedForeground">{rankProgress.rank_points_needed.toLocaleString()} RP to next rank</p>
            )}
          </div>
        </section>
      )}

      {/* Stats grid */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-px bg-primary/50" />
          <h2 className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">At a glance</h2>
          <div className="flex-1 h-px bg-primary/30" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.id}
                className={`${styles.panel} rounded-sm p-4 flex items-start gap-3 shadow-lg shadow-primary/5`}
                data-testid={s.testId}
              >
                <div className="p-1.5 rounded-sm bg-primary/20 border border-primary/30 shrink-0">
                  <Icon className="text-primary shrink-0" size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-heading text-mutedForeground uppercase tracking-wider">{s.label}</p>
                  {s.tooltip ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-base font-heading font-bold text-foreground truncate cursor-default underline decoration-dotted decoration-primary/50 underline-offset-1">
                            {s.value}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent side="top" className={`${styles.surface} ${styles.textForeground} ${styles.borderGold} rounded-md px-3 py-2 text-sm font-heading`}>
                          {s.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <p className="text-base font-heading font-bold text-foreground truncate">{s.value}</p>
                  )}
                  {s.sub && <p className="text-xs font-heading text-mutedForeground">{s.sub}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-px bg-primary/50" />
          <h2 className="text-xs font-heading font-bold text-primary/80 uppercase tracking-widest">Quick actions</h2>
          <div className="flex-1 h-px bg-primary/30" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.id}
                to={a.to}
                data-testid={`quick-action-${a.id}`}
                className={`group ${styles.panel} rounded-sm p-4 flex items-center gap-4 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-smooth`}
              >
                <div className="p-2 rounded-sm bg-primary/20 border border-primary/30 group-hover:bg-primary/30 shrink-0">
                  <Icon className="text-primary shrink-0" size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-heading font-bold text-foreground group-hover:text-primary transition-colors">{a.title}</p>
                  <p className="text-xs font-heading text-mutedForeground truncate">{a.desc}</p>
                </div>
                <ChevronRight className="text-mutedForeground group-hover:text-primary shrink-0 transition-colors" size={18} />
              </Link>
            );
          })}
        </div>
      </section>

      {/* Game systems (compact) */}
      <section className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center gap-2">
          <Zap size={16} className="text-primary" />
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Game systems</span>
          <div className="flex-1 h-px bg-primary/50" />
        </div>
        <div className="p-4 grid sm:grid-cols-2 gap-4 text-sm font-heading">
          <div>
            <p className="font-bold text-primary mb-1 flex items-center gap-2"><span className="text-primary">◆</span> Ranks</p>
            <p className="text-mutedForeground leading-relaxed text-xs">
              Rise from Street Thug to The Commission. Each rank unlocks crimes, weapons, and opportunities.
            </p>
          </div>
          <div>
            <p className="font-bold text-primary mb-1 flex items-center gap-2"><span className="text-primary">◆</span> Bodyguards</p>
            <p className="text-mutedForeground leading-relaxed text-xs">
              Hire up to 4 bodyguards (points). Human or robot guards protect you from attacks.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
