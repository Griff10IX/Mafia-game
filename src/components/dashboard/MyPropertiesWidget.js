import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronRight, Dice5, Plane, Factory } from 'lucide-react';
import api from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import styles from '../../styles/noir.module.css';

const CASINO_LABELS = { dice: 'Dice', roulette: 'Roulette', blackjack: 'Blackjack', horseracing: 'Horse Racing', videopoker: 'Video Poker', slots: 'Slots' };

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const WIDGET_KEY = 'my_properties';

export default function MyPropertiesWidget({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProperties = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get('/my-properties');
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
    fetchProperties();
  }, [userId, fetchProperties]);

  if (loading) {
    return (
      <div className={`${styles.panel} rounded-md border border-primary/20 p-2.5 mobile-panel`}>
        <div className="flex items-center gap-2 text-mutedForeground">
          <Building2 size={14} className="animate-pulse" />
          <span className="text-[10px] font-heading">Loading...</span>
        </div>
      </div>
    );
  }

  const casino = data?.casino ?? null;
  const airport = data?.airport ?? (data?.property?.type === 'airport' ? data.property : null);
  const armoury = data?.armoury ?? (data?.property?.type === 'bullet_factory' ? data.property : null);
  const hasAny = casino || airport || armoury;

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <Building2 size={10} />
          My Properties
        </h2>
        <Link to="/my-properties" className="text-[9px] font-heading text-primary hover:text-primary/80 flex items-center gap-0.5">
          Manage <ChevronRight size={10} />
        </Link>
      </div>
      <div className="p-2 space-y-1.5">
        {!hasAny ? (
          <p className="text-[10px] font-heading text-mutedForeground">No casino or property</p>
        ) : (
          <>
            {casino ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-primary/5 border-primary/30">
                <Dice5 size={12} className="text-primary shrink-0" />
                <span className="text-[10px] font-heading text-foreground">
                  {CASINO_LABELS[casino.type] || casino.type} in {casino.city || '?'}
                </span>
                {casino.profit != null && (
                  <span className="text-[9px] text-mutedForeground ml-auto">
                    {formatMoney(casino.profit)}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-zinc-800/20 border-zinc-700/30">
                <span className="text-[10px] font-heading text-mutedForeground">No casino</span>
              </div>
            )}
            {airport ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-primary/5 border-primary/30">
                <Plane size={12} className="text-primary shrink-0" />
                <span className="text-[10px] font-heading text-foreground">
                  Airport in {airport.state || '?'}
                </span>
                {airport.total_earnings != null && (
                  <span className="text-[9px] text-mutedForeground ml-auto">
                    {Number(airport.total_earnings).toLocaleString()} pts
                  </span>
                )}
              </div>
            ) : null}
            {armoury ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-primary/5 border-primary/30">
                <Factory size={12} className="text-primary shrink-0" />
                <span className="text-[10px] font-heading text-foreground">
                  Armoury in {armoury.state || '?'}
                </span>
              </div>
            ) : null}
            {!airport && !armoury ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-zinc-800/20 border-zinc-700/30">
                <span className="text-[10px] font-heading text-mutedForeground">No airport or armoury</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
