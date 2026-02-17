import { useState, useEffect } from 'react';
import { ListChecks, Calendar, CalendarDays, CalendarRange, CheckCircle2, Circle, Gift } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const OBJ_STYLES = `
  @keyframes obj-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .obj-fade-in { animation: obj-fade-in 0.4s ease-out both; }
  @keyframes obj-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .obj-scale-in { animation: obj-scale-in 0.35s ease-out both; }
  @keyframes obj-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .obj-glow { animation: obj-glow 4s ease-in-out infinite; }
  .obj-corner::before, .obj-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .obj-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .obj-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .obj-card { transition: all 0.3s ease; }
  .obj-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .obj-row { transition: all 0.2s ease; }
  .obj-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .obj-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatReward(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.rank_points) parts.push(`${reward.rank_points} RP`);
  if (reward.money) parts.push(`$${Number(reward.money).toLocaleString()}`);
  if (reward.points) parts.push(`${reward.points} pts`);
  return parts.join(', ') || '—';
}

const ObjectiveRow = ({ obj, delay = 0 }) => {
  const progressPct = obj.target > 0 ? Math.min(100, (obj.current / obj.target) * 100) : 0;
  return (
    <div
      className={`obj-row flex items-start gap-3 px-3 py-2 rounded-lg border obj-fade-in ${
        obj.done ? 'bg-primary/10 border-primary/30' : 'bg-zinc-800/20 border-zinc-700/30'
      }`}
      style={{ animationDelay: `${delay}s` }}
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
                background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))',
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
        refreshUser();
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
        <style>{OBJ_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <ListChecks size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading objectives...</span>
        </div>
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
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="objectives-page">
      <style>{OBJ_STYLES}</style>

      <p className="text-[9px] text-zinc-500 font-heading italic">Complete daily, weekly, and monthly goals for extra rewards. New objectives each period.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Today */}
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 flex flex-col min-w-0 obj-card obj-corner obj-fade-in`} style={{ animationDelay: '0s' }}>
          <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl pointer-events-none obj-glow" />
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Today</h2>
              </div>
              <span className="text-xs text-mutedForeground font-heading shrink-0">{daily.date ?? '—'}</span>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading mt-1">Resets midnight UTC · New objectives & rewards each day</p>
          </div>
          <div className="p-4 space-y-2 flex-1 min-h-0 overflow-auto">
            {daily.claimed && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm font-heading text-primary obj-fade-in">
                <Gift className="w-4 h-4 shrink-0" />
                <span>All daily objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!daily.claimed && daily.all_complete && daily.claim_reward && Object.keys(daily.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 obj-fade-in">
                <span className="text-sm font-heading text-foreground">Reward: {formatReward(daily.claim_reward)}</span>
                <button
                  type="button"
                  onClick={() => handleClaim('daily')}
                  disabled={claiming === 'daily'}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-heading font-bold hover:bg-primary/90 disabled:opacity-50 border border-primary/30"
                >
                  {claiming === 'daily' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {daily.objectives?.length ? (
              daily.objectives.map((obj, i) => <ObjectiveRow key={obj.id + obj.label} obj={obj} delay={i * 0.04} />)
            ) : (
              <p className="text-sm text-mutedForeground">No objectives for today.</p>
            )}
          </div>
          <div className="obj-art-line text-primary mx-4" />
        </section>

        {/* This week */}
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 flex flex-col min-w-0 obj-card obj-corner obj-fade-in`} style={{ animationDelay: '0.05s' }}>
          <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl pointer-events-none obj-glow" />
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-primary" />
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">This week</h2>
              </div>
              <span className="text-xs text-mutedForeground font-heading shrink-0">Week of {weekly.week_start ?? '—'}</span>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading mt-1">Resets Monday 00:00 UTC · New objectives & rewards each week</p>
          </div>
          <div className="p-4 space-y-2 flex-1 min-h-0 overflow-auto">
            {weekly.claimed && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm font-heading text-primary obj-fade-in">
                <Gift className="w-4 h-4 shrink-0" />
                <span>All weekly objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!weekly.claimed && weekly.all_complete && weekly.claim_reward && Object.keys(weekly.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 obj-fade-in">
                <span className="text-sm font-heading text-foreground">Reward: {formatReward(weekly.claim_reward)}</span>
                <button
                  type="button"
                  onClick={() => handleClaim('weekly')}
                  disabled={claiming === 'weekly'}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-heading font-bold hover:bg-primary/90 disabled:opacity-50 border border-primary/30"
                >
                  {claiming === 'weekly' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {weekly.objectives?.length ? (
              weekly.objectives.map((obj, i) => <ObjectiveRow key={obj.id + obj.label} obj={obj} delay={i * 0.04} />)
            ) : (
              <p className="text-sm text-mutedForeground">No objectives for this week.</p>
            )}
          </div>
          <div className="obj-art-line text-primary mx-4" />
        </section>

        {/* This month - full width below Today & Week */}
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 flex flex-col min-w-0 md:col-span-2 obj-card obj-corner obj-fade-in`} style={{ animationDelay: '0.1s' }}>
          <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl pointer-events-none obj-glow" />
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarRange className="w-5 h-5 text-primary" />
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">This month</h2>
              </div>
              <span className="text-xs text-mutedForeground font-heading shrink-0">{formatMonthStart(monthly.month_start)}</span>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading mt-1">Resets 1st of month 00:00 UTC · New objectives & rewards each month</p>
          </div>
          <div className="p-4 space-y-2 flex-1 min-h-0 overflow-auto">
            {monthly.claimed && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm font-heading text-primary obj-fade-in">
                <Gift className="w-4 h-4 shrink-0" />
                <span>All monthly objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!monthly.claimed && monthly.all_complete && monthly.claim_reward && Object.keys(monthly.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 obj-fade-in">
                <span className="text-sm font-heading text-foreground">Reward: {formatReward(monthly.claim_reward)}</span>
                <button
                  type="button"
                  onClick={() => handleClaim('monthly')}
                  disabled={claiming === 'monthly'}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-heading font-bold hover:bg-primary/90 disabled:opacity-50 border border-primary/30"
                >
                  {claiming === 'monthly' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {monthly.objectives?.length ? (
              monthly.objectives.map((obj, i) => <ObjectiveRow key={obj.id + obj.label} obj={obj} delay={i * 0.04} />)
            ) : (
              <p className="text-sm text-mutedForeground">No objectives for this month.</p>
            )}
          </div>
          <div className="obj-art-line text-primary mx-4" />
        </section>
      </div>
    </div>
  );
}
