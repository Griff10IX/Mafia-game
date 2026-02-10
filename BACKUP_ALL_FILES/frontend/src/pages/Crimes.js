import { useMemo, useState, useEffect } from 'react';
import { Flame, HelpCircle, Clock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

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
    <div className="space-y-6" data-testid="crimes-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Commit Crimes</div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">Crimes</h1>
        </div>
      </div>

      {eventsEnabled && event && (event.kill_cash !== 1 || event.rank_points !== 1) && event.name && (
        <div className="bg-primary/15 border border-primary rounded-sm p-4">
          <p className="text-sm font-semibold text-primary">Today&apos;s event: {event.name}</p>
          <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
        </div>
      )}

      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-card border border-border rounded-sm overflow-hidden">
          <div className="grid grid-cols-12 bg-secondary/40 text-xs uppercase tracking-wider text-mutedForeground px-4 py-3">
            <div className="col-span-6">Crime</div>
            <div className="col-span-2 text-right">Risk</div>
            <div className="col-span-2 text-right">Status</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          {rows.map((crime) => {
            const unavailable = !crime.can_commit && (!crime.remaining || crime.remaining <= 0);
            const onCooldown = !crime.can_commit && crime.remaining && crime.remaining > 0;
            const rowClass = 'bg-background/30 hover:bg-background/50';
            const statusText = crime.can_commit ? 'Available' : onCooldown ? 'Cooldown' : 'Unavailable';

            return (
              <div
                key={crime.id}
                className={`w-full text-left grid grid-cols-12 px-4 py-3 border-t border-border items-center transition-smooth ${rowClass} ${
                  !crime.can_commit ? 'opacity-80' : ''
                }`}
                data-testid={`crime-row-${crime.id}`}
              >
                <div className="col-span-6 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{crime.name}</div>
                  <div className="text-xs text-mutedForeground truncate">{crime.description}</div>
                </div>

                <div className={`col-span-2 text-right text-sm font-mono ${crime.can_commit ? 'text-destructive' : 'text-mutedForeground'}`}>
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
                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded-sm text-[11px] uppercase tracking-wider font-bold ${
                      crime.can_commit
                        ? 'bg-primary text-primaryForeground'
                        : onCooldown
                          ? 'bg-secondary text-mutedForeground'
                          : 'bg-secondary/60 text-mutedForeground'
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
                      className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth gold-glow"
                      data-testid={`commit-crime-${crime.id}`}
                    >
                      Commit
                    </button>
                  ) : onCooldown ? (
                    <span className="inline-flex items-center justify-end gap-1 text-xs text-mutedForeground font-mono">
                      <Clock size={14} className="text-primary" />
                      {crime.wait}
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1 text-xs text-mutedForeground">
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
        <div className="w-full max-w-3xl text-xs text-mutedForeground flex items-center justify-center gap-6">
          <span>
            <span className="text-foreground font-semibold">Crimes Committed:</span> {user?.total_crimes ?? 0}
          </span>
          <span className="text-mutedForeground">|</span>
          <span>
            <span className="text-foreground font-semibold">Crime Profit:</span> ${Number(user?.crime_profit ?? 0).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}
