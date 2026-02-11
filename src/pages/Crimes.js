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
  const [committingId, setCommittingId] = useState(null);

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

  const commitCrime = async (crimeId, isRetry = false) => {
    if (committingId) return;
    setCommittingId(crimeId);
    let willRetry = false;
    try {
      const response = await api.post(`/crimes/${crimeId}/commit`);
      if (response.data.success) {
        toast.success(response.data.message);
        refreshUser();
      } else {
        toast(response.data.message, { description: 'Attempt was recorded — wait for cooldown to try again.' });
      }
      fetchCrimes();
    } catch (error) {
      const status = error.response?.status;
      const d = error.response?.data?.detail;
      const backendMsg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg || x.loc?.join('.')).join('; ') : null;
      const reason = error.code === 'ECONNABORTED' ? 'Request timed out' : error.message === 'Network Error' ? 'Network error' : backendMsg || (status ? `${status} error` : 'Request failed');
      toast.error(`Failed to commit crime: ${reason}`);
      willRetry = !isRetry && (error.code === 'ECONNABORTED' || error.message === 'Network Error' || (status && status >= 500));
      if (willRetry) {
        await new Promise((r) => setTimeout(r, 800));
        setCommittingId(null);
        commitCrime(crimeId, true);
        return;
      }
    } finally {
      if (!willRetry) setCommittingId(null);
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
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="crimes-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider">Crimes</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Commit Crimes</p>
      </div>

      {eventsEnabled && event && (event.kill_cash !== 1 || event.rank_points !== 1) && event.name && (
        <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border border-primary/30 rounded-sm p-4">
          <p className="text-sm font-heading font-bold text-primary">Today&apos;s event: {event.name}</p>
          <p className="text-xs text-mutedForeground font-heading mt-1">{event.message}</p>
        </div>
      )}

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
          <div className={`grid grid-cols-12 ${styles.surfaceMuted} text-xs uppercase tracking-widest font-heading text-primary/80 px-4 py-2 border-b ${styles.borderGoldLight}`}>
            <div className="col-span-6">Crime</div>
            <div className="col-span-2 text-right">Risk</div>
            <div className="col-span-2 text-right">Status</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          {rows.map((crime) => {
            const unavailable = !crime.can_commit && (!crime.remaining || crime.remaining <= 0);
            const onCooldown = !crime.can_commit && crime.remaining && crime.remaining > 0;
            const statusText = crime.can_commit ? 'Available' : onCooldown ? 'Cooldown' : 'Unavailable';

            return (
              <div
                key={crime.id}
                className={`w-full text-left grid grid-cols-12 px-4 py-2.5 border-b border-primary/10 items-center transition-smooth bg-transparent ${styles.raisedHover} ${!crime.can_commit ? 'opacity-90' : ''}`}
                data-testid={`crime-row-${crime.id}`}
              >
                <div className="col-span-6 min-w-0">
                  <div className="text-sm font-heading font-bold text-foreground truncate">{crime.name}</div>
                  <div className="text-xs text-mutedForeground font-heading truncate">{crime.description}</div>
                </div>

                <div className={`col-span-2 text-right text-sm font-heading ${crime.can_commit ? 'text-red-400' : 'text-mutedForeground'}`}>
                  {unavailable ? (
                    <span className="inline-flex items-center justify-end gap-1">
                      <span>—</span>
                      <HelpCircle size={14} className="text-mutedForeground" />
                    </span>
                  ) : (
                    `${crime.risk}%`
                  )}
                </div>

                <div className="col-span-2 text-right">
                  <span
                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded-sm text-[11px] uppercase tracking-wider font-heading font-bold ${
                      crime.can_commit
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : onCooldown
                          ? `${styles.surface} text-mutedForeground border border-primary/10`
                          : `${styles.surface} text-mutedForeground border border-primary/10 opacity-90`
                    }`}
                    data-testid={`crime-status-${crime.id}`}
                  >
                    {statusText}
                  </span>
                </div>

                <div className="col-span-2 text-right">
                  {crime.can_commit ? (
                    <button
                      type="button"
                      onClick={() => commitCrime(crime.id)}
                      disabled={committingId !== null}
                      className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50 transition-smooth disabled:opacity-60 disabled:cursor-not-allowed"
                      data-testid={`commit-crime-${crime.id}`}
                    >
                      {committingId === crime.id ? '...' : 'Commit'}
                    </button>
                  ) : onCooldown ? (
                    <span className="inline-flex items-center justify-end gap-1 text-xs text-mutedForeground font-heading">
                      <Clock size={14} className="text-primary" />
                      {crime.wait}
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1 text-xs text-mutedForeground font-heading">
                      <HelpCircle size={14} className="text-mutedForeground" />
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
        <div className={`w-full max-w-3xl ${styles.panel} rounded-sm px-4 py-3`}>
          <div className="text-xs font-heading text-mutedForeground flex items-center justify-center gap-6">
            <span><span className="text-primary font-bold">◆</span> Crimes: <span className="text-foreground font-bold">{user?.total_crimes ?? 0}</span></span>
            <span className="text-primary/50">|</span>
            <span><span className="text-primary font-bold">◆</span> Profit: <span className="text-foreground font-bold">${Number(user?.crime_profit ?? 0).toLocaleString()}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
