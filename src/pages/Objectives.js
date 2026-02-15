import { useState, useEffect } from 'react';
import { ListChecks, Calendar, CalendarDays, CalendarRange, CheckCircle2, Circle, Gift } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatReward(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.rank_points) parts.push(`${reward.rank_points} RP`);
  if (reward.money) parts.push(`$${Number(reward.money).toLocaleString()}`);
  if (reward.points) parts.push(`${reward.points} pts`);
  return parts.join(', ') || '—';
}

const ObjectiveRow = ({ obj }) => {
  const progressPct = obj.target > 0 ? Math.min(100, (obj.current / obj.target) * 100) : 0;
  return (
    <div
      className={`flex items-start gap-3 px-3 py-2 rounded-md border transition-colors ${
        obj.done ? 'bg-primary/10 border-primary/30' : 'bg-zinc-800/20 border-zinc-700/30'
      }`}
    >
      <span className="shrink-0 pt-0.5">
        {obj.done ? <CheckCircle2 className="w-5 h-5 text-primary" /> : <Circle className="w-5 h-5 text-mutedForeground" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-heading text-foreground truncate">{obj.label}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <div className="relative flex-1 min-w-0 h-2.5 bg-secondary rounded-full overflow-hidden border border-primary/20" style={{ maxWidth: 120 }}>
            <div
              className="absolute top-0 left-0 h-full rounded-full transition-all duration-300"
              style={{
                width: `${progressPct}%`,
                minWidth: progressPct > 0 ? 6 : 0,
                background: 'linear-gradient(to right, #d4af37, #ca8a04)',
              }}
              role="progressbar"
              aria-valuenow={obj.current}
              aria-valuemin={0}
              aria-valuemax={obj.target}
            />
          </div>
          <span className="text-xs font-heading font-bold text-primary tabular-nums shrink-0">
            {Number(obj.current).toLocaleString()}/{Number(obj.target).toLocaleString()}
          </span>
        </div>
        {obj.reward && (
          <p className="text-xs text-primary/80 font-heading mt-1">Reward: {formatReward(obj.reward)}</p>
        )}
      </div>
    </div>
  );
};

export default function Objectives() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [claiming, setClaiming] = useState(null);

  const fetchObjectives = async () => {
    setLoading(true);
    try {
      const res = await api.get('/objectives');
      setData(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load objectives');
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (type) => {
    setClaiming(type);
    try {
      const res = await api.post('/objectives/claim', { type });
      if (res.data?.claimed && res.data?.reward) {
        toast.success(`Rewards claimed! ${formatReward(res.data.reward)}`);
      }
      await fetchObjectives();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim');
    } finally {
      setClaiming(null);
    }
  };

  useEffect(() => {
    fetchObjectives();
  }, []);

  if (loading && !data) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <div className="flex items-center gap-3">
          <ListChecks className="w-8 h-8 text-primary" />
          <h1 className="text-2xl font-heading font-bold text-primary">Objectives</h1>
        </div>
        <div className="text-primary font-heading">Loading...</div>
      </div>
    );
  }

  const daily = data?.daily ?? {};
  const weekly = data?.weekly ?? {};
  const monthly = data?.monthly ?? {};

  const formatMonthStart = (str) => {
    if (!str) return '—';
    try {
      const [y, m] = str.split('-');
      const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
      return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    } catch { return str; }
  };

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="objectives-page">
      <div className="flex items-center gap-3">
        <ListChecks className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary">Objectives</h1>
          <p className="text-sm text-mutedForeground">Complete daily, weekly, and monthly goals for extra rewards.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {/* Today */}
        <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 flex flex-col min-w-0`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              <h2 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Today</h2>
            </div>
            <span className="text-xs text-mutedForeground font-heading shrink-0">{daily.date ?? '—'}</span>
          </div>
          <div className="p-4 space-y-2 flex-1 min-h-0 overflow-auto">
            {daily.claimed && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/20 border border-primary/30 text-sm font-heading text-primary">
                <Gift className="w-4 h-4 shrink-0" />
                <span>All daily objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!daily.claimed && daily.all_complete && daily.claim_reward && Object.keys(daily.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/30">
                <span className="text-sm font-heading text-foreground">Reward: {formatReward(daily.claim_reward)}</span>
                <button
                  type="button"
                  onClick={() => handleClaim('daily')}
                  disabled={claiming === 'daily'}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-heading font-bold hover:bg-primary/90 disabled:opacity-50"
                >
                  {claiming === 'daily' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {daily.objectives?.length ? (
              daily.objectives.map((obj) => <ObjectiveRow key={obj.id + obj.label} obj={obj} />)
            ) : (
              <p className="text-sm text-mutedForeground">No objectives for today.</p>
            )}
          </div>
        </section>

        {/* This week */}
        <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 flex flex-col min-w-0`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" />
              <h2 className="text-base font-heading font-bold text-primary uppercase tracking-wider">This week</h2>
            </div>
            <span className="text-xs text-mutedForeground font-heading shrink-0">Week of {weekly.week_start ?? '—'}</span>
          </div>
          <div className="p-4 space-y-2 flex-1 min-h-0 overflow-auto">
            {weekly.claimed && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/20 border border-primary/30 text-sm font-heading text-primary">
                <Gift className="w-4 h-4 shrink-0" />
                <span>All weekly objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!weekly.claimed && weekly.all_complete && weekly.claim_reward && Object.keys(weekly.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/30">
                <span className="text-sm font-heading text-foreground">Reward: {formatReward(weekly.claim_reward)}</span>
                <button
                  type="button"
                  onClick={() => handleClaim('weekly')}
                  disabled={claiming === 'weekly'}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-heading font-bold hover:bg-primary/90 disabled:opacity-50"
                >
                  {claiming === 'weekly' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {weekly.objectives?.length ? (
              weekly.objectives.map((obj) => <ObjectiveRow key={obj.id + obj.label} obj={obj} />)
            ) : (
              <p className="text-sm text-mutedForeground">No objectives for this week.</p>
            )}
          </div>
        </section>

        {/* This month */}
        <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 flex flex-col min-w-0`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-primary" />
              <h2 className="text-base font-heading font-bold text-primary uppercase tracking-wider">This month</h2>
            </div>
            <span className="text-xs text-mutedForeground font-heading shrink-0">{formatMonthStart(monthly.month_start)}</span>
          </div>
          <div className="p-4 space-y-2 flex-1 min-h-0 overflow-auto">
            {monthly.claimed && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/20 border border-primary/30 text-sm font-heading text-primary">
                <Gift className="w-4 h-4 shrink-0" />
                <span>All monthly objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!monthly.claimed && monthly.all_complete && monthly.claim_reward && Object.keys(monthly.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/30">
                <span className="text-sm font-heading text-foreground">Reward: {formatReward(monthly.claim_reward)}</span>
                <button
                  type="button"
                  onClick={() => handleClaim('monthly')}
                  disabled={claiming === 'monthly'}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-heading font-bold hover:bg-primary/90 disabled:opacity-50"
                >
                  {claiming === 'monthly' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {monthly.objectives?.length ? (
              monthly.objectives.map((obj) => <ObjectiveRow key={obj.id + obj.label} obj={obj} />)
            ) : (
              <p className="text-sm text-mutedForeground">No objectives for this month.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
