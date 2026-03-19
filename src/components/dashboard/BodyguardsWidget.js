import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';

export default function BodyguardsWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchBodyguards = useCallback(async () => {
    try {
      const res = await api.get('/bodyguards');
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBodyguards(); }, [fetchBodyguards]);

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
