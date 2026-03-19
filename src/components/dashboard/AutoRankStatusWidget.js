import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bot, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';

function formatCountdown(seconds) {
  if (seconds == null || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function secondsUntil(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return Math.max(0, Math.floor((d - new Date()) / 1000));
  } catch { return null; }
}

export default function AutoRankStatusWidget({ user }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const hasAutoRank = user?.auto_rank_purchased || user?.auto_rank_enabled;

  useEffect(() => {
    if (!hasAutoRank) {
      setLoading(false);
      return;
    }
    api.get('/auto-rank/stats')
      .then((res) => setStats(res.data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [hasAutoRank]);

  const lastRefetchRef = useRef(0);
  useEffect(() => {
    if (!hasAutoRank || !stats) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      const next = secondsUntil(stats?.auto_rank_next_run_at);
      if (next != null && next <= 0 && Date.now() - lastRefetchRef.current > 30_000) {
        lastRefetchRef.current = Date.now();
        api.get('/auto-rank/stats').then((r) => setStats(r.data)).catch(() => {});
      }
    }, 1000);
    return () => clearInterval(id);
  }, [hasAutoRank, stats]);

  if (!hasAutoRank || loading) return null;

  const inJail = stats?.in_jail ?? false;
  const activityDetail = stats?.activity_detail;
  const jailUntil = stats?.jail_until;
  const nextRunAt = stats?.auto_rank_next_run_at;
  const jailSeconds = secondsUntil(jailUntil);
  const nextCycleSeconds = secondsUntil(nextRunAt);

  let statusText = activityDetail || (inJail ? 'In jail — paused' : 'Running');
  if (inJail && jailSeconds != null && jailSeconds > 0) {
    statusText += ` · out in ${formatCountdown(jailSeconds)}`;
  } else if (!inJail && nextCycleSeconds != null && nextCycleSeconds > 0) {
    statusText += ` · next in ${formatCountdown(nextCycleSeconds)}`;
  }

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <Bot size={10} />
          Auto Rank
        </h2>
        <Link to="/account/autorank" className="text-[9px] font-heading text-primary hover:text-primary/80 flex items-center gap-0.5">
          Settings <ChevronRight size={10} />
        </Link>
      </div>
      <div className="px-2.5 py-2">
        <p className={`text-[11px] font-heading ${inJail ? 'text-amber-400' : (activityDetail || '').toLowerCase().includes('idle') ? 'text-mutedForeground' : 'text-emerald-400'}`}>
          {statusText}
        </p>
      </div>
    </div>
  );
}
