import { useState, useEffect, useCallback } from 'react';
import { Building2, Dice5, Plane, Factory } from 'lucide-react';
import api from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import dash from '../../styles/dashboard.module.css';
import { DashPanel, DashHeader, DashBody, DashLoading } from './dashChrome';

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
    return <DashLoading icon={Building2} />;
  }

  const casinos = Array.isArray(data?.casinos) && data.casinos.length
    ? data.casinos
    : (data?.casino ? [data.casino] : []);
  const airport = data?.airport ?? (data?.property?.type === 'airport' ? data.property : null);
  const armoury = data?.armoury ?? (data?.property?.type === 'bullet_factory' ? data.property : null);
  const hasAny = casinos.length > 0 || airport || armoury;

  return (
    <DashPanel>
      <DashHeader title="My Properties" icon={Building2} actionTo="/my-properties" actionLabel="Manage" />
      <DashBody className="space-y-1.5" compact>
        {!hasAny ? (
          <p className="text-[10px] font-heading text-mutedForeground">No casino or property</p>
        ) : (
          <>
            {casinos.length ? (
              casinos.map((casino) => (
                <div key={`${casino.type}-${casino.city}`} className={`${dash.rowActive} font-heading`}>
                  <Dice5 size={12} className="text-primary shrink-0" />
                  <span className="text-[10px] text-foreground truncate">
                    {CASINO_LABELS[casino.type] || casino.type} in {casino.city || '?'}
                  </span>
                  {casino.profit != null && (
                    <span className="text-[9px] text-mutedForeground ml-auto shrink-0">
                      {formatMoney(casino.profit)}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className={`${dash.rowMuted} font-heading`}>
                <span className="text-[10px] text-mutedForeground">No casino</span>
              </div>
            )}
            {airport ? (
              <div className={`${dash.rowActive} font-heading`}>
                <Plane size={12} className="text-primary shrink-0" />
                <span className="text-[10px] text-foreground truncate">
                  Airport in {airport.state || '?'}
                </span>
                {airport.total_earnings != null && (
                  <span className="text-[9px] text-mutedForeground ml-auto shrink-0">
                    {Number(airport.total_earnings).toLocaleString()} pts
                  </span>
                )}
              </div>
            ) : null}
            {armoury ? (
              <div className={`${dash.rowActive} font-heading`}>
                <Factory size={12} className="text-primary shrink-0" />
                <span className="text-[10px] text-foreground truncate">
                  Armoury in {armoury.state || '?'}
                </span>
              </div>
            ) : null}
            {!airport && !armoury ? (
              <div className={`${dash.rowMuted} font-heading`}>
                <span className="text-[10px] text-mutedForeground">No airport or armoury</span>
              </div>
            ) : null}
          </>
        )}
      </DashBody>
    </DashPanel>
  );
}
