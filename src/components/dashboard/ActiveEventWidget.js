import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import api, { apiRequestWith429Retry } from '../../utils/api';
import styles from '../../styles/noir.module.css';

export default function ActiveEventWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequestWith429Retry(() => api.get('/events/active'))
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data?.events_enabled || !data?.event || data?.event?.id === 'none') {
    return null;
  }

  const names = data.active_event_names || [];
  const title = names.length > 0 ? names.join(' + ') : (data.event?.name || 'Event');

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center gap-1">
        <Zap size={10} className="text-primary" />
        <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          Active Event
        </span>
      </div>
      <div className="px-2.5 py-2">
        <p className="text-[11px] font-heading text-foreground">{title}</p>
      </div>
    </div>
  );
}
