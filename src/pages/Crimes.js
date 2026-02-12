import { useMemo, useState, useEffect } from 'react';
import { Flame, HelpCircle, Clock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function getSuccessRate(crimeType) {
  if (crimeType === 'petty') return 0.7;
  if (crimeType === 'medium') return 0.5;
  return 0.3; // major
}

function formatWaitFromMinutes(cooldownMinutes) {
  if (cooldownMinutes >= 1) return `${Math.round(cooldownMinutes)} min`;
  return `${Math.round(cooldownMinutes * 60)} seconds`;
}

function secondsUntil(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

export default function Crimes() {
  const [crimes, setCrimes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [tick, setTick] = useState(0);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);

  const fetchCrimes = async () => {
    try {
      const [crimesRes, meRes, eventsRes] = await Promise.all([
        api.get('/crimes'),
        api.get('/auth/me'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } }))
      ]);
      setCrimes(crimesRes.data);
      setUser(meRes.data);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
    } catch (error) {
      toast.error('Failed to load crimes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCrimes();
  }, []);

  useEffect(() => {
    const hasCooldown = crimes.some((c) => c.next_available && secondsUntil(c.next_available) > 0);
    if (!hasCooldown) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [crimes]);

  const commitCrime = async (crimeId) => {
    try {
      const response = await api.post(`/crimes/${crimeId}/commit`);
      if (response.data.success) {
        toast.success(response.data.message);
        refreshUser();
      } else {
        toast.error(response.data.message);
      }
      fetchCrimes();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to commit crime');
    }
  };

  const rows = useMemo(() => {
    // touch tick so countdown updates
    void tick;
    return crimes.map((crime) => {
      const successRate = getSuccessRate(crime.crime_type);
      const risk = Math.round((1 - successRate) * 100);
      const remaining = crime.next_available ? secondsUntil(crime.next_available) : null;
      const wait =
        crime.can_commit
          ? formatWaitFromMinutes(crime.cooldown_minutes)
          : remaining && remaining > 0
            ? `${remaining} seconds`
            : 'Unavailable';
      return { ...crime, risk, wait, remaining };
    });
  }, [crimes, tick]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 sm:space-y-6 ${styles.pageContent}`} data-testid="crimes-page">
      <div className="flex items-center justify-center flex-col gap-1 sm:gap-2 text-center">
        <div className="flex items-center gap-2 sm:gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[60px] sm:max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-xl sm:text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Crimes</h1>
          <div className="h-px flex-1 max-w-[60px] sm:max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-[11px] sm:text-xs font-heading text-mutedForeground uppercase tracking-widest">Commit Crimes</p>
      </div>

      {eventsEnabled && event && (event.kill_cash !== 1 || event.rank_points !== 1) && event.name && (
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className={`${styles.panelHeader} px-3 py-2 sm:px-4`}>
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Today&apos;s event</span>
          </div>
          <div className="p-3 sm:p-4">
            <p className="text-sm font-heading font-bold text-primary">{event.name}</p>
            <p className={`text-xs font-heading mt-1 ${styles.textMuted}`}>{event.message}</p>
          </div>
        </div>
      )}

      <div className="flex justify-center min-w-0">
        <div className={`w-full max-w-3xl min-w-0 ${styles.panel} rounded-md overflow-hidden`}>
          <div className="grid grid-cols-12 gap-1 bg-zinc-800/50 text-[10px] sm:text-xs uppercase tracking-widest font-heading text-primary/80 px-2 sm:px-4 py-1.5 sm:py-2 border-b border-primary/20">
            <div className="col-span-5 sm:col-span-6 min-w-0">Crime</div>
            <div className="col-span-2 text-right">Risk</div>
            <div className="col-span-2 text-right hidden sm:block">Status</div>
            <div className="col-span-5 sm:col-span-2">
              <div className="flex items-center justify-end gap-1">
                <span className="sm:hidden">Status</span>
                <span>Action</span>
              </div>
            </div>
          </div>

          {rows.map((crime) => {
            const unavailable = !crime.can_commit && (!crime.remaining || crime.remaining <= 0);
            const onCooldown = !crime.can_commit && crime.remaining && crime.remaining > 0;
            const statusText = crime.can_commit ? 'Available' : onCooldown ? 'Cooldown' : 'Unavailable';

            return (
              <div
                key={crime.id}
                className={`grid grid-cols-12 gap-1 px-2 sm:px-4 py-2 border-b border-primary/10 items-center transition-smooth bg-transparent hover:bg-zinc-800/30 ${!crime.can_commit ? 'opacity-90' : ''}`}
                data-testid={`crime-row-${crime.id}`}
              >
                <div className="col-span-5 sm:col-span-6 min-w-0">
                  <div className="text-xs sm:text-sm font-heading font-bold text-foreground truncate">{crime.name}</div>
                  <div className="text-[10px] sm:text-xs text-mutedForeground font-heading truncate">{crime.description}</div>
                </div>

                <div className={`col-span-2 text-right text-xs sm:text-sm font-heading shrink-0 ${crime.can_commit ? 'text-red-400' : 'text-mutedForeground'}`}>
                  {unavailable ? '—' : `${crime.risk}%`}
                </div>

                <div className="col-span-2 text-right shrink-0 hidden sm:block">
                  <span
                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-heading font-bold ${
                      crime.can_commit
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : onCooldown
                          ? 'bg-zinc-800 text-mutedForeground border border-primary/10'
                          : 'bg-zinc-800/80 text-mutedForeground border border-primary/10'
                    }`}
                    data-testid={`crime-status-${crime.id}`}
                  >
                    {statusText}
                  </span>
                </div>

                <div className="col-span-5 sm:col-span-2 flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1">
                  <span
                    className={`sm:hidden inline-flex items-center justify-center px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider font-heading font-bold ${
                      crime.can_commit
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : 'bg-zinc-800 text-mutedForeground border border-primary/10'
                    }`}
                  >
                    {statusText}
                  </span>
                  {crime.can_commit ? (
                    <button
                      type="button"
                      onClick={() => commitCrime(crime.id)}
                      className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50 transition-smooth touch-manipulation"
                      data-testid={`commit-crime-${crime.id}`}
                    >
                      Commit
                    </button>
                  ) : onCooldown ? (
                    <span className="inline-flex items-center justify-end gap-1 text-[10px] sm:text-xs text-mutedForeground font-heading">
                      <Clock size={11} className="text-primary shrink-0" />
                      <span className="truncate">{crime.wait}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1 text-[10px] sm:text-xs text-mutedForeground font-heading">
                      <HelpCircle size={11} className="text-mutedForeground shrink-0" />
                      Locked
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md px-3 py-2 sm:px-4 sm:py-3`}>
          <div className="text-[11px] sm:text-xs font-heading text-mutedForeground flex items-center justify-center gap-3 sm:gap-6">
            <span><span className="text-primary font-bold">◆</span> Crimes: <span className="text-foreground font-bold">{user?.total_crimes ?? 0}</span></span>
            <span className="text-primary/50">|</span>
            <span><span className="text-primary font-bold">◆</span> Profit: <span className="text-foreground font-bold">${Number(user?.crime_profit ?? 0).toLocaleString()}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
