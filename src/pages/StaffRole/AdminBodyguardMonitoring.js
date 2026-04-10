import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, RefreshCw, Crosshair } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(typeof iso === 'string' ? iso : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatAt(row) {
  const raw = row?.at;
  if (raw == null) return '—';
  if (typeof raw === 'string') return formatDateTime(raw);
  if (typeof raw === 'object' && raw !== null && typeof raw.toISOString === 'function') {
    return formatDateTime(raw.toISOString());
  }
  return formatDateTime(String(raw));
}

export default function AdminBodyguardMonitoring() {
  const navigate = useNavigate();
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState(null);

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

  const fetchAll = useCallback(async () => {
    if (!accessChecked) return;
    setLoading(true);
    setError(null);
    setAnalyticsError(null);
    try {
      const [monRes, anRes] = await Promise.all([
        api.get('/admin/bodyguards/monitoring/summary', { params: { days: 7, token_limit: 200, recent_limit: 120 } }),
        api.get('/admin/hitlist-bodyguards/analytics/summary', { params: { days: 7 } }).catch((e) => ({
          error: e,
          data: null,
        })),
      ]);
      setSummary(monRes.data || null);
      if (anRes.error) {
        setAnalytics(null);
        setAnalyticsError(anRes.error.response?.data?.detail || anRes.error.message || 'Failed to load analytics');
      } else {
        setAnalytics(anRes.data || null);
      }
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load';
      setError(msg);
      setSummary(null);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [accessChecked]);

  useEffect(() => {
    if (accessChecked) fetchAll();
  }, [accessChecked, fetchAll]);

  if (!accessChecked || (loading && !summary && !error)) {
    return (
      <div
        className={`space-y-3 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
        style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
        data-testid="admin-bodyguard-monitoring-page"
      >
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Shield className="w-10 h-10 text-primary/60" />
          <p className="text-sm text-mutedForeground font-heading">Loading bodyguard monitoring…</p>
        </div>
      </div>
    );
  }

  const fails = Array.isArray(summary?.token_failures) ? summary.token_failures : [];
  const recent = Array.isArray(summary?.recent_events) ? summary.recent_events : [];
  const analyticsItems = Array.isArray(analytics?.items) ? analytics.items : [];

  return (
    <div
      className={`space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
      style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
      data-testid="admin-bodyguard-monitoring-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-6 h-6 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-heading font-bold text-foreground truncate">Bodyguard monitoring</h1>
            <p className="text-[10px] text-mutedForeground font-heading">
              Robot session-token failures (staff are notified when these occur), recent bodyguard lifecycle events, and hitlist/bodyguard analytics.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/staffrole/attack-logs"
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded border border-border bg-card/50 text-[10px] font-heading uppercase tracking-wider text-mutedForeground hover:text-foreground"
          >
            <Crosshair className="w-3.5 h-3.5" />
            Attack logs
          </Link>
          <button
            type="button"
            onClick={() => fetchAll()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded border border-border bg-secondary hover:bg-secondary/80 text-[10px] font-heading uppercase tracking-wider disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 font-heading">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Token fails (7d)</div>
          <div className="text-xl font-heading font-bold text-red-400 tabular-nums">
            {(summary?.token_failure_count_period ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Event types (7d)</div>
          <div className="text-xl font-heading font-bold text-primary tabular-nums">{analyticsItems.length.toLocaleString()}</div>
        </div>
        <div className="rounded border border-border bg-card/40 px-3 py-2 sm:col-span-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Snapshot</div>
          <div className="text-[10px] text-mutedForeground font-heading mt-1">{formatDateTime(summary?.generated_at)}</div>
        </div>
      </div>

      {analyticsError && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 font-heading">{analyticsError}</div>
      )}

      {analyticsItems.length > 0 && (
        <section className="rounded border border-border overflow-hidden">
          <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary">
            Hitlist / bodyguard events by type (7d)
          </div>
          <div className="overflow-x-auto max-h-[220px] overflow-y-auto">
            <table className="w-full text-[10px] font-heading">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr className="text-left text-mutedForeground">
                  <th className="p-2">Type</th>
                  <th className="p-2 text-right">Count</th>
                  <th className="p-2 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {analyticsItems.map((row) => (
                  <tr key={row.event_type} className="border-b border-border/60">
                    <td className="p-2 text-foreground font-mono">{row.event_type}</td>
                    <td className="p-2 text-right tabular-nums">{Number(row.count || 0).toLocaleString()}</td>
                    <td className="p-2 text-right text-mutedForeground">
                      {row.usage_share != null ? `${(Number(row.usage_share) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded border border-border overflow-hidden border-red-500/25">
        <div className="px-2 py-1.5 bg-red-500/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-red-300 flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" />
          Session token failures (robot hire / armour / drop)
        </div>
        <div className="overflow-x-auto max-h-[min(50vh,420px)] overflow-y-auto">
          {fails.length === 0 ? (
            <p className="p-3 text-[11px] text-mutedForeground font-heading">No failures in this window.</p>
          ) : (
            <table className="w-full text-[10px] font-heading">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr className="text-left text-mutedForeground">
                  <th className="p-2 whitespace-nowrap">When</th>
                  <th className="p-2">User</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Slot</th>
                  <th className="p-2">Reason</th>
                  <th className="p-2">IP</th>
                  <th className="p-2 min-w-[120px]">UA</th>
                </tr>
              </thead>
              <tbody>
                {fails.map((row, idx) => (
                  <tr key={`${row.owner_id}-${formatAt(row)}-${idx}`} className="border-b border-border/60 align-top">
                    <td className="p-2 whitespace-nowrap text-mutedForeground">{formatAt(row)}</td>
                    <td className="p-2">
                      <span className="text-foreground font-bold">{row.owner_username || '—'}</span>
                      {row.owner_id && (
                        <span className="block text-[9px] text-mutedForeground font-mono truncate max-w-[140px]">{row.owner_id}</span>
                      )}
                    </td>
                    <td className="p-2 text-foreground">{row.action || '—'}</td>
                    <td className="p-2 tabular-nums">{row.slot != null ? row.slot : '—'}</td>
                    <td className="p-2 text-amber-200/90">{row.reason || '—'}</td>
                    <td className="p-2 font-mono text-[9px]">{row.client_ip || '—'}</td>
                    <td className="p-2 text-[9px] text-mutedForeground break-all max-w-[200px]">{row.user_agent_short || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary">
          Recent bodyguard-related events (excl. token rows above)
        </div>
        <div className="overflow-x-auto max-h-[min(45vh,360px)] overflow-y-auto p-2 space-y-2">
          {recent.length === 0 ? (
            <p className="text-[11px] text-mutedForeground font-heading">No events in this window.</p>
          ) : (
            recent.map((row, idx) => (
              <pre
                key={idx}
                className="text-[9px] font-mono whitespace-pre-wrap break-words border border-border/50 rounded p-2 bg-muted/20 text-foreground"
              >
                {JSON.stringify(row, null, 2)}
              </pre>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
