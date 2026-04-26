import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../utils/api';
import { toast } from 'sonner';
import { formatAdminDateTime } from '../../../utils/adminDateTime';

const PAGE_SIZE = 50;

export default function AdminSustainedRlEventsTable() {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchSlice = useCallback(async (startSkip, append) => {
    setLoading(true);
    try {
      const res = await api.get('/admin/security/sustained-page-rl-events', {
        params: { limit: PAGE_SIZE, skip: startSkip },
      });
      const rows = res.data?.events || [];
      const tot = Number(res.data?.total) || 0;
      setTotal(tot);
      if (append) setEvents((prev) => [...prev, ...rows]);
      else setEvents(rows);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load pacing events');
      if (!append) setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSlice(0, false);
  }, [fetchSlice]);

  const hasMore = events.length < total;

  return (
    <div className="p-3 space-y-3">
      <p className="text-[10px] text-mutedForeground leading-relaxed">
        HTTP 429 incidents from sustained page pacing (per-scope throttling). These are no longer sent to staff inboxes.
        Configure toggles under{' '}
        <Link to="/staffrole/admin/liveops" className="text-primary underline hover:no-underline">
          LiveOps → Sustained page pacing
        </Link>
        .
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fetchSlice(0, false)}
          disabled={loading}
          className="px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
      {events.length === 0 && !loading ? (
        <p className="text-[10px] text-mutedForeground">No events in the retention window.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-700/60 max-h-[min(420px,50vh)] overflow-y-auto">
          <table className="w-full text-left text-[9px] font-heading">
            <thead className="sticky top-0 bg-zinc-900/95 border-b border-zinc-700 text-mutedForeground uppercase tracking-wider">
              <tr>
                <th className="p-2">Time (UK)</th>
                <th className="p-2">User</th>
                <th className="p-2">Scope</th>
                <th className="p-2">Reason</th>
                <th className="p-2 text-right">Retry s</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={`${ev.created_at}-${ev.user_id}-${ev.page_key}-${i}`} className="border-b border-zinc-800/80 hover:bg-zinc-800/40">
                  <td className="p-2 text-mutedForeground whitespace-nowrap">
                    {ev.created_at ? formatAdminDateTime(ev.created_at) : '—'}
                  </td>
                  <td className="p-2 text-foreground">
                    <span className="font-medium">{ev.username || '?'}</span>
                    <span className="text-mutedForeground block truncate max-w-[140px]" title={ev.user_id}>
                      {ev.user_id}
                    </span>
                  </td>
                  <td className="p-2 text-foreground">{ev.label || ev.page_key || '—'}</td>
                  <td className="p-2 text-mutedForeground">{ev.reason || '—'}</td>
                  <td className="p-2 text-right text-foreground">{ev.retry_after_sec ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={() => fetchSlice(events.length, true)}
          disabled={loading}
          className="px-2 py-1 rounded text-[9px] font-heading border border-zinc-600 text-mutedForeground hover:bg-zinc-800/50 disabled:opacity-50"
        >
          {loading ? '…' : 'Load more'}
        </button>
      )}
      {total > 0 && (
        <p className="text-[9px] text-mutedForeground">
          Showing {events.length} of {total} (newest first; older rows expire after ~21 days).
        </p>
      )}
    </div>
  );
}
