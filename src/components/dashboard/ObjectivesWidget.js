import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function formatReward(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.rank_points) parts.push(`${Number(reward.rank_points).toLocaleString()} RP`);
  if (reward.money) parts.push(`$${Number(reward.money).toLocaleString()}`);
  if (reward.points) parts.push(`${Number(reward.points).toLocaleString()} pts`);
  if (reward.respect_points) parts.push(`${Number(reward.respect_points).toLocaleString()} respect`);
  if (reward.bullets) parts.push(`${Number(reward.bullets).toLocaleString()} bullets`);
  return parts.join(', ') || '—';
}

const ObjectiveRow = ({ obj }) => {
  const progressPct = obj.target > 0 ? Math.min(100, (obj.current / obj.target) * 100) : 0;
  const labelText = (obj.label && String(obj.label).trim()) || 'Objective';
  return (
    <div
      className={`flex min-w-0 flex-col gap-2 rounded border px-2.5 py-1.5 ${
        obj.done ? 'bg-primary/10 border-primary/30' : 'bg-zinc-800/20 border-zinc-700/30'
      }`}
    >
      <div className="flex min-w-0 gap-2">
        <span className="flex h-[18px] w-5 shrink-0 items-center justify-center pt-0.5">
          {obj.done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-mutedForeground" />}
        </span>
        <p className="min-w-0 flex-1 break-words font-heading text-[11px] leading-snug text-foreground line-clamp-2">{labelText}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-7">
        <div className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full border border-primary/20 bg-secondary sm:w-[5.5rem]">
          <div
            className="absolute top-0 left-0 h-full rounded-full transition-all duration-300"
            style={{
              width: `${progressPct}%`,
              minWidth: progressPct > 0 ? 2 : 0,
              background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))',
            }}
            role="progressbar"
            aria-valuenow={obj.current}
            aria-valuemin={0}
            aria-valuemax={obj.target}
          />
        </div>
        <span className="inline-block w-[10.5rem] shrink-0 text-right font-heading text-[10px] font-bold tabular-nums text-primary sm:w-[11rem]">
          {Number(obj.current).toLocaleString()}/{Number(obj.target).toLocaleString()}
        </span>
      </div>
    </div>
  );
};

const WIDGET_KEY = 'objectives';

export default function ObjectivesWidget({ onRefresh, userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  const fetchObjectives = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get('/objectives');
      const d = res.data;
      setData(d);
      if (d) setDashboardWidget(userId, WIDGET_KEY, d);
    } catch {
      // keep cached snapshot on failure
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setData(null);
      setLoading(true);
      return;
    }
    const cached = getDashboardWidget(userId, WIDGET_KEY);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    fetchObjectives();
  }, [userId, fetchObjectives]);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const res = await api.post('/objectives/claim', { type: 'daily' });
      if (res.data?.claimed && res.data?.reward) {
        toast.success(`Rewards claimed! ${formatReward(res.data.reward)}`);
        refreshUser();
        onRefresh?.();
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      }
      await fetchObjectives();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim');
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div className={`${styles.panel} rounded-md border border-primary/20 p-2.5 mobile-panel flex flex-col min-w-0`}>
        <div className="flex items-center gap-2 text-mutedForeground">
          <ListChecks size={14} className="animate-pulse" />
          <span className="text-[10px] font-heading">Loading...</span>
        </div>
      </div>
    );
  }

  const daily = data?.daily?.objectives ?? [];
  const allDone = data?.daily?.all_complete ?? false;
  const claimed = data?.daily?.claimed ?? true;
  const canClaim = allDone && !claimed;

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 flex flex-col min-w-0 mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 shrink-0 min-w-0 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5 min-w-0 truncate">
          <ListChecks size={12} className="shrink-0 text-primary" />
          Today&apos;s Objectives
        </h2>
        <Link to="/account/objectives" className="text-[10px] font-heading text-primary hover:text-primary/80 flex items-center gap-0.5 shrink-0">
          All <ChevronRight size={10} />
        </Link>
      </div>
      <div className="px-3 py-2 space-y-1.5 flex-1 min-h-0 overflow-auto min-w-0">
        {daily.length === 0 ? (
          <p className="text-[10px] font-heading text-mutedForeground">No objectives today</p>
        ) : (
          daily.slice(0, 3).map((obj, i) => (
            <ObjectiveRow key={obj.id || i} obj={obj} />
          ))
        )}
        {canClaim && (
          <button
            type="button"
            onClick={handleClaim}
            disabled={claiming}
            className="w-full mt-1.5 px-3 py-2 rounded border border-primary/50 bg-primary/20 text-primary text-[10px] font-heading font-bold hover:bg-primary/30 disabled:opacity-50 transition-all"
          >
            {claiming ? 'Claiming...' : 'Claim rewards'}
          </button>
        )}
      </div>
    </div>
  );
}
