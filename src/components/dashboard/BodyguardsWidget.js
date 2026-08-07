import { useState, useEffect, useCallback } from 'react';
import { Shield } from 'lucide-react';
import api, { apiRequestWith429Retry } from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import dash from '../../styles/dashboard.module.css';
import { DashPanel, DashHeader, DashBody, DashLoading } from './dashChrome';

const WIDGET_KEY = 'bodyguards';

export default function BodyguardsWidget({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchBodyguards = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await apiRequestWith429Retry(() => api.get('/bodyguards'));
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
    return <DashLoading icon={Shield} />;
  }

  const bodyguards = data?.bodyguards ?? [];
  const bodyguardFor = data?.bodyguard_for;
  const filled = bodyguards.filter((b) => b.bodyguard_username || b.is_robot).length;
  const total = bodyguards.length || 4;

  return (
    <DashPanel>
      <DashHeader title="Bodyguards" icon={Shield} actionTo="/kill/bodyguards" actionLabel="Manage" />
      <DashBody className="space-y-1.5" compact>
        {bodyguardFor && (
          <p className="text-[10px] font-heading text-amber-400">
            Working for {bodyguardFor.owner_username}
          </p>
        )}
        <p className="text-[10px] font-heading text-mutedForeground">
          {filled}/{total} slots filled
        </p>
        {bodyguards.slice(0, 4).map((bg) => (
          <div key={bg.slot_number} className={`${dash.rowMuted} font-heading`}>
            <span className="text-[9px] text-mutedForeground w-4">#{bg.slot_number}</span>
            <span className="text-[10px] text-foreground truncate">
              {bg.bodyguard_username || (bg.is_robot ? 'Robot' : '—')}
            </span>
          </div>
        ))}
      </DashBody>
    </DashPanel>
  );
}
