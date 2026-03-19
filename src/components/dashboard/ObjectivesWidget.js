import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
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
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 rounded border ${
        obj.done ? 'bg-primary/10 border-primary/30' : 'bg-zinc-800/20 border-zinc-700/30'
      }`}
    >
      <span className="shrink-0">
        {obj.done ? <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> : <Circle className="w-3.5 h-3.5 text-mutedForeground" />}
      </span>
      <p className="text-[10px] font-heading text-foreground min-w-0 flex-1 line-clamp-2">{obj.label}</p>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="relative w-12 h-1 bg-secondary rounded-full overflow-hidden border border-primary/20">
          <div
            className="absolute top-0 left-0 h-full rounded-full transition-all duration-300"
            style={{
              width: `${progressPct}%`,
              minWidth: progressPct > 0 ? 2 : 0,
              background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))',
            }}
          />
        </div>
        <span className="text-[9px] font-heading font-bold text-primary tabular-nums">
          {Number(obj.current).toLocaleString()}/{Number(obj.target).toLocaleString()}
        </span>
      </div>
    </div>
  );
};

export default function ObjectivesWidget({ onRefresh }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  const fetchObjectives = useCallback(async () => {
    try {
      const res = await api.get('/objectives');
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchObjectives(); }, [fetchObjectives]);

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
      <div className={`${styles.panel} rounded-md border border-primary/20 p-2.5`}>
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
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <ListChecks size={10} />
          Today&apos;s Objectives
        </h2>
        <Link to="/account/objectives" className="text-[9px] font-heading text-primary hover:text-primary/80 flex items-center gap-0.5">
          All <ChevronRight size={10} />
        </Link>
      </div>
      <div className="p-2 space-y-1.5">
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
            className="w-full mt-1.5 px-2 py-1.5 rounded border border-primary/50 bg-primary/20 text-primary text-[10px] font-heading font-bold hover:bg-primary/30 disabled:opacity-50 transition-all"
          >
            {claiming ? 'Claiming...' : 'Claim rewards'}
          </button>
        )}
      </div>
    </div>
  );
}
