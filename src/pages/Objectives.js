import { useState, useEffect } from 'react';
import { ListChecks, Calendar, CalendarDays, CheckCircle2, Circle, Gift } from 'lucide-react';
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

const ObjectiveRow = ({ obj }) => (
  <div
    className={`flex items-center gap-3 px-3 py-2 rounded-md border transition-colors ${
      obj.done ? 'bg-primary/10 border-primary/30' : 'bg-zinc-800/20 border-zinc-700/30'
    }`}
  >
    <span className="shrink-0">
      {obj.done ? <CheckCircle2 className="w-5 h-5 text-primary" /> : <Circle className="w-5 h-5 text-mutedForeground" />}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-heading text-foreground truncate">{obj.label}</p>
      <p className="text-xs text-mutedForeground">
        Progress: {obj.current} / {obj.target}
        {obj.reward && (
          <span className="ml-2 text-primary/80">· Reward: {formatReward(obj.reward)}</span>
        )}
      </p>
    </div>
  </div>
);

export default function Objectives() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchObjectives = async () => {
    setLoading(true);
    try {
      const res = await api.get('/objectives');
      setData(res.data);
      if (res.data?.daily?.claim_reward && Object.keys(res.data.daily.claim_reward).length) {
        toast.success('Daily objectives complete! Rewards claimed.');
      }
      if (res.data?.weekly?.claim_reward && Object.keys(res.data.weekly.claim_reward).length) {
        toast.success('Weekly objectives complete! Rewards claimed.');
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load objectives');
    } finally {
      setLoading(false);
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

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="objectives-page">
      <div className="flex items-center gap-3">
        <ListChecks className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary">Objectives</h1>
          <p className="text-sm text-mutedForeground">Complete daily and weekly goals for extra rewards.</p>
        </div>
      </div>

      {/* Today */}
      <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Today</h2>
          </div>
          <span className="text-xs text-mutedForeground font-heading">{daily.date ?? '—'}</span>
        </div>
        <div className="p-4 space-y-2">
          {daily.claimed && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/20 border border-primary/30 text-sm font-heading text-primary">
              <Gift className="w-4 h-4 shrink-0" />
              <span>All daily objectives complete. Rewards were added automatically.</span>
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
      <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            <h2 className="text-base font-heading font-bold text-primary uppercase tracking-wider">This week</h2>
          </div>
          <span className="text-xs text-mutedForeground font-heading">Week of {weekly.week_start ?? '—'}</span>
        </div>
        <div className="p-4 space-y-2">
          {weekly.claimed && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/20 border border-primary/30 text-sm font-heading text-primary">
              <Gift className="w-4 h-4 shrink-0" />
              <span>All weekly objectives complete. Rewards were added automatically.</span>
            </div>
          )}
          {weekly.objectives?.length ? (
            weekly.objectives.map((obj) => <ObjectiveRow key={obj.id + obj.label} obj={obj} />)
          ) : (
            <p className="text-sm text-mutedForeground">No objectives for this week.</p>
          )}
        </div>
      </section>
    </div>
  );
}
