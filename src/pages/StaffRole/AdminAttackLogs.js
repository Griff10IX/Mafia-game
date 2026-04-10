import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, RefreshCw, Shield } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import AttackLogsPanel from '../../components/staff/AttackLogsPanel';

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function AdminAttackLogs() {
  const navigate = useNavigate();
  const [accessChecked, setAccessChecked] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(null);
  const [bodyguardData, setBodyguardData] = useState(null);
  const [bodyguardLoading, setBodyguardLoading] = useState(false);
  const [bodyguardError, setBodyguardError] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/admin/check');
        if (cancelled) return;
        if (!res.data?.is_admin && !res.data?.is_moderator) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setAccessChecked(true);
      } catch {
        if (!cancelled) navigate('/dashboard', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const fetchAnalytics = useCallback(async () => {
    if (!accessChecked) return;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await api.get('/admin/attacks/analytics/summary', { params: { days: 7, limit: 100 } });
      setAnalytics(res.data || null);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load';
      setAnalyticsError(msg);
      setAnalytics(null);
      if (e.response?.status === 403) {
        toast.error('Admin or moderator access required');
        navigate('/dashboard', { replace: true });
      }
    } finally {
      setAnalyticsLoading(false);
    }
  }, [accessChecked, navigate]);

  useEffect(() => {
    if (accessChecked) fetchAnalytics();
  }, [accessChecked, fetchAnalytics]);

  const onAttackLogsLoaded = useCallback(async (username) => {
    if (!username) return;
    setBodyguardLoading(true);
    setBodyguardError(null);
    setTimelineOpen(false);
    try {
      const res = await api.get('/admin/bodyguards/audit', {
        params: { username, limit: 500 },
      });
      setBodyguardData(res.data || null);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load bodyguard audit';
      setBodyguardError(msg);
      setBodyguardData(null);
    } finally {
      setBodyguardLoading(false);
    }
  }, []);

  if (!accessChecked || (analyticsLoading && !analytics && !analyticsError)) {
    return (
      <div
        className={`space-y-3 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
        style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
        data-testid="admin-attack-logs-page"
      >
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Crosshair className="w-10 h-10 text-primary/60" />
          <p className="text-sm text-mutedForeground font-heading">Loading attack tools…</p>
        </div>
      </div>
    );
  }

  const g = analytics?.global;
  const owned = Array.isArray(bodyguardData?.owned_bodyguards) ? bodyguardData.owned_bodyguards : [];
  const filledSlots = owned.filter((b) => b.bodyguard_username || b.is_robot).length;
  const u = bodyguardData?.user || {};
  const merged = Array.isArray(bodyguardData?.merged_timeline) ? bodyguardData.merged_timeline : [];

  return (
    <div
      className={`space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
      style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
      data-testid="admin-attack-logs-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Crosshair className="w-6 h-6 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-heading font-bold text-foreground truncate">Attack logs</h1>
            <p className="text-[10px] text-mutedForeground font-heading">
              Per-user raw attack attempts, bodyguard roster and merged hire/kill/payout timeline. Game-wide KPIs below are from the last 7 days.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => fetchAnalytics()}
          disabled={analyticsLoading}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded border border-border bg-secondary hover:bg-secondary/80 text-[10px] font-heading uppercase tracking-wider disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${analyticsLoading ? 'animate-spin' : ''}`} />
          Refresh stats
        </button>
      </div>

      {analyticsError && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 font-heading">{analyticsError}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Attempts (7d, sample)</div>
          <div className="text-xl font-heading font-bold text-primary tabular-nums">{(g?.attempts ?? 0).toLocaleString()}</div>
        </div>
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Kills (7d, sample)</div>
          <div className="text-xl font-heading font-bold text-foreground tabular-nums">{(g?.kills ?? 0).toLocaleString()}</div>
        </div>
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Kill rate</div>
          <div className="text-xl font-heading font-bold text-foreground tabular-nums">
            {g?.kill_rate != null ? `${(Number(g.kill_rate) * 100).toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Avg bullets / attempt</div>
          <div className="text-xl font-heading font-bold text-foreground tabular-nums">
            {g?.avg_bullets_per_attempt != null ? Number(g.avg_bullets_per_attempt).toFixed(1) : '—'}
          </div>
        </div>
      </div>
      <p className="text-[9px] text-mutedForeground font-heading">
        Analytics snapshot: {formatDateTime(analytics?.generated_at)}
      </p>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary flex items-center gap-2">
          <Crosshair className="w-3.5 h-3.5" />
          Attack attempts (post data)
        </div>
        <div className="p-3">
          <AttackLogsPanel
            introText="Load a player by username. Includes incoming and outgoing attempts with IP, user-agent, bodyguard outcomes, and bullets."
            tableMaxHeightClass="max-h-[min(70vh,560px)]"
            onLogsLoaded={onAttackLogsLoaded}
          />
        </div>
      </section>

      {(bodyguardLoading || bodyguardError || bodyguardData) && (
        <section className="rounded border border-border overflow-hidden">
          <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" />
            Bodyguard snapshot and timeline
          </div>
          <div className="p-3 space-y-3 text-[10px] font-heading">
            {bodyguardLoading && <p className="text-mutedForeground">Loading bodyguard audit…</p>}
            {bodyguardError && !bodyguardLoading && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-red-200">{bodyguardError}</div>
            )}
            {bodyguardData && !bodyguardLoading && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <div className="rounded border border-border bg-card/30 px-2 py-1.5">
                    <div className="text-[9px] uppercase text-mutedForeground">User</div>
                    <div className="text-foreground font-bold truncate">{u.username ?? '—'}</div>
                  </div>
                  <div className="rounded border border-border bg-card/30 px-2 py-1.5">
                    <div className="text-[9px] uppercase text-mutedForeground">Filled / slots</div>
                    <div className="text-foreground tabular-nums">
                      {filledSlots} / {u.bodyguard_slots != null ? Number(u.bodyguard_slots) : owned.length || '—'}
                    </div>
                  </div>
                  <div className="rounded border border-border bg-card/30 px-2 py-1.5">
                    <div className="text-[9px] uppercase text-mutedForeground">Inflation level</div>
                    <div className="text-foreground tabular-nums">{u.bodyguard_inflation_level ?? '—'}</div>
                  </div>
                  <div className="rounded border border-border bg-card/30 px-2 py-1.5">
                    <div className="text-[9px] uppercase text-mutedForeground">Merged timeline rows</div>
                    <div className="text-foreground tabular-nums">{merged.length.toLocaleString()}</div>
                  </div>
                </div>
                {u.is_bodyguard && (
                  <p className="text-amber-400">
                    This account is flagged as a bodyguard NPC/player
                    {u.bodyguard_owner_id ? ` (owner id: ${u.bodyguard_owner_id})` : ''}.
                  </p>
                )}
                {bodyguardData.employed_as_guard && (
                  <p className="text-mutedForeground">
                    Employed as guard for another player (slot data in audit payload).
                  </p>
                )}
                <div>
                  <button
                    type="button"
                    onClick={() => setTimelineOpen((v) => !v)}
                    className="text-[10px] uppercase tracking-wider text-primary border border-primary/40 rounded px-2 py-1 hover:bg-primary/10"
                  >
                    {timelineOpen ? 'Hide' : 'Show'} merged timeline (first 40)
                  </button>
                  {timelineOpen && (
                    <div className="mt-2 max-h-[360px] overflow-y-auto space-y-2 border border-border rounded p-2 bg-muted/20">
                      {merged.length === 0 ? (
                        <p className="text-mutedForeground">No merged rows.</p>
                      ) : (
                        merged.slice(0, 40).map((row, idx) => (
                          <pre
                            key={idx}
                            className="text-[8px] font-mono whitespace-pre-wrap break-words border-b border-border/60 pb-2 text-foreground"
                          >
                            {JSON.stringify(row, null, 2)}
                          </pre>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
