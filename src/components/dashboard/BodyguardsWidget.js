import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import styles from '../../styles/noir.module.css';

const WIDGET_KEY = 'bodyguards';

export default function BodyguardsWidget({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchBodyguards = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get('/bodyguards');
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
    fetchBodyguards();
  }, [userId, fetchBodyguards]);

  if (loading) {
    return (
      <div className={`${styles.panel} rounded-md border border-primary/20 p-2.5 mobile-panel`}>
        <div className="flex items-center gap-2 text-mutedForeground">
          <Shield size={14} className="animate-pulse" />
          <span className="text-[10px] font-heading">Loading...</span>
        </div>
      </div>
    );
  }

  const bodyguards = data?.bodyguards ?? [];
  const bodyguardFor = data?.bodyguard_for;
  const filled = bodyguards.filter((b) => b.bodyguard_username || b.is_robot).length;
  const total = bodyguards.length || 4;

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <Shield size={10} />
          Bodyguards
        </h2>
        <Link to="/kill/bodyguards" className="text-[9px] font-heading text-primary hover:text-primary/80 flex items-center gap-0.5">
          Manage <ChevronRight size={10} />
        </Link>
      </div>
      <div className="p-2 space-y-1.5">
        {bodyguardFor && (
          <p className="text-[10px] font-heading text-amber-400">
            Working for {bodyguardFor.owner_username}
          </p>
        )}
        <p className="text-[10px] font-heading text-mutedForeground">
          {filled}/{total} slots filled
        </p>
        {bodyguards.slice(0, 4).map((bg) => (
          <div
            key={bg.slot_number}
            className="flex items-center gap-1.5 px-2 py-1 rounded border bg-zinc-800/20 border-zinc-700/30"
          >
            <span className="text-[9px] font-heading text-mutedForeground w-4">#{bg.slot_number}</span>
            <span className="text-[10px] font-heading text-foreground truncate">
              {bg.bodyguard_username || (bg.is_robot ? 'Robot' : '—')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
