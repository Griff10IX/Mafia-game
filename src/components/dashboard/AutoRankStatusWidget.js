import { useState, useEffect, useRef } from 'react';
import { Bot } from 'lucide-react';
import api from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import dash from '../../styles/dashboard.module.css';
import { DashPanel, DashHeader, DashBody } from './dashChrome';

const WIDGET_KEY = 'auto_rank_stats';

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
  const userId = user?.id;
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const hasAutoRank = user?.auto_rank_purchased || user?.auto_rank_enabled;

  useEffect(() => {
    if (!hasAutoRank) {
      setStats(null);
      setLoading(false);
      return;
    }
    if (!userId) {
      setStats(null);
      setLoading(true);
      return;
    }
    const cached = getDashboardWidget(userId, WIDGET_KEY);
    if (cached) {
      setStats(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    api
      .get('/auto-rank/stats')
      .then((res) => {
        const d = res.data;
        setStats(d);
        if (d) setDashboardWidget(userId, WIDGET_KEY, d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hasAutoRank, userId]);

  const lastRefetchRef = useRef(0);
  useEffect(() => {
    if (!hasAutoRank || !stats || !userId) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      const next = secondsUntil(stats?.auto_rank_next_run_at);
      if (next != null && next <= 0 && Date.now() - lastRefetchRef.current > 30_000) {
        lastRefetchRef.current = Date.now();
        api
          .get('/auto-rank/stats')
          .then((r) => {
            const d = r.data;
            setStats(d);
            if (d) setDashboardWidget(userId, WIDGET_KEY, d);
          })
          .catch(() => {});
      }
    }, 1000);
    return () => clearInterval(id);
  }, [hasAutoRank, stats, userId]);

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
    <DashPanel>
      <DashHeader title="Auto Rank" icon={Bot} actionTo="/account/autorank" actionLabel="Settings" />
      <DashBody className={dash.autoStripBody} compact>
        <p className={`text-[11px] font-heading ${inJail ? 'text-amber-400' : (activityDetail || '').toLowerCase().includes('idle') ? 'text-mutedForeground' : 'text-emerald-400'}`}>
          {statusText}
        </p>
      </DashBody>
    </DashPanel>
  );
}
