import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

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

export default function AdminWitnessStatements() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);

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
    return () => { cancelled = true; };
  }, [navigate]);

  const fetchOverview = useCallback(async () => {
    if (!accessChecked) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/admin/witness-statements-overview');
      setData(res.data);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load';
      setError(msg);
      setData(null);
      if (e.response?.status === 403) {
        toast.error('Admin or moderator access required');
        navigate('/dashboard', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [accessChecked, navigate]);

  useEffect(() => {
    if (accessChecked) fetchOverview();
  }, [accessChecked, fetchOverview]);

  if (!accessChecked || (loading && !data)) {
    return (
      <div
        className={`space-y-3 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
        style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
        data-testid="admin-witness-statements-page"
      >
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <FileText className="w-10 h-10 text-primary/60" />
          <p className="text-sm text-mutedForeground font-heading">Loading witness statement data…</p>
        </div>
      </div>
    );
  }

  const top = Array.isArray(data?.top_holders) ? data.top_holders : [];
  const listings = Array.isArray(data?.active_listings) ? data.active_listings : [];
  const recent = Array.isArray(data?.recent_witness_notifications) ? data.recent_witness_notifications : [];

  return (
    <div
      className={`space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
      style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
      data-testid="admin-witness-statements-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-6 h-6 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-heading font-bold text-foreground truncate">Witness statements</h1>
            <p className="text-[10px] text-mutedForeground font-heading">
              Circulating balances, Quick Trade listings, and recent inbox deliveries. New statements are only sent to players online (last 5 min or forced online).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => fetchOverview()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded border border-border bg-secondary hover:bg-secondary/80 text-[10px] font-heading uppercase tracking-wider disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 font-heading">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Circulating (players)</div>
          <div className="text-xl font-heading font-bold text-primary tabular-nums">{(data?.circulating_total ?? 0).toLocaleString()}</div>
        </div>
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Holders (&gt; 0)</div>
          <div className="text-xl font-heading font-bold text-foreground tabular-nums">{(data?.holders_with_balance ?? 0).toLocaleString()}</div>
        </div>
        <div className="rounded border border-border bg-card/40 px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Active listings</div>
          <div className="text-xl font-heading font-bold text-foreground tabular-nums">{(data?.active_listings_count ?? 0).toLocaleString()}</div>
        </div>
      </div>

      <p className="text-[9px] text-mutedForeground font-heading">Snapshot: {formatDateTime(data?.generated_at)}</p>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary">
          Top balances
        </div>
        <div className="hidden md:grid grid-cols-12 gap-1 px-2 py-1 bg-muted/30 text-[8px] font-heading uppercase text-mutedForeground border-b border-border">
          <div className="col-span-4">User</div>
          <div className="col-span-2 text-right">Balance</div>
          <div className="col-span-2">Dead</div>
          <div className="col-span-4">Last seen</div>
        </div>
        <div className="divide-y divide-border max-h-[280px] overflow-y-auto">
          {top.length === 0 ? (
            <div className="px-2 py-4 text-sm text-mutedForeground font-heading text-center">No player holds witness statements.</div>
          ) : (
            top.map((row) => (
              <div
                key={row.user_id}
                className="grid grid-cols-1 md:grid-cols-12 gap-1 px-2 py-2 text-[11px] font-heading items-center"
              >
                <div className="md:col-span-4 truncate">
                  <Link to={`/profile/${encodeURIComponent(row.username)}`} className="text-primary hover:underline font-bold truncate">
                    {row.username}
                  </Link>
                </div>
                <div className="md:col-span-2 md:text-right tabular-nums text-foreground">{row.balance.toLocaleString()}</div>
                <div className="md:col-span-2 text-mutedForeground">{row.is_dead ? 'Yes' : 'No'}</div>
                <div className="md:col-span-4 text-mutedForeground tabular-nums text-[10px]">{formatDateTime(row.last_seen)}</div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary">
          Quick Trade listings (witness statements)
        </div>
        <div className="hidden md:grid grid-cols-12 gap-1 px-2 py-1 bg-muted/30 text-[8px] font-heading uppercase text-mutedForeground border-b border-border">
          <div className="col-span-3">Seller</div>
          <div className="col-span-2 text-right">Qty</div>
          <div className="col-span-3 text-right">Price</div>
          <div className="col-span-4">Listed</div>
        </div>
        <div className="divide-y divide-border max-h-[240px] overflow-y-auto">
          {listings.length === 0 ? (
            <div className="px-2 py-4 text-sm text-mutedForeground font-heading text-center">No active listings.</div>
          ) : (
            listings.map((L) => (
              <div key={L.id} className="grid grid-cols-1 md:grid-cols-12 gap-1 px-2 py-2 text-[11px] font-heading items-center">
                <div className="md:col-span-3 truncate">
                  <Link to={`/profile/${encodeURIComponent(L.seller_username)}`} className="text-primary hover:underline truncate block">
                    {L.seller_username}
                  </Link>
                  <span className="text-[9px] text-mutedForeground block truncate font-mono">{L.seller_id}</span>
                </div>
                <div className="md:col-span-2 md:text-right tabular-nums">{L.quantity.toLocaleString()}</div>
                <div className="md:col-span-3 md:text-right tabular-nums">${L.price_cash.toLocaleString()}</div>
                <div className="md:col-span-4 text-mutedForeground tabular-nums text-[10px]">{formatDateTime(L.created_at)}</div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary">
          Recent witness inbox deliveries
        </div>
        <div className="hidden md:grid grid-cols-12 gap-1 px-2 py-1 bg-muted/30 text-[8px] font-heading uppercase text-mutedForeground border-b border-border">
          <div className="col-span-3">Recipient</div>
          <div className="col-span-2">Time</div>
          <div className="col-span-7">Preview</div>
        </div>
        <div className="divide-y divide-border max-h-[320px] overflow-y-auto">
          {recent.length === 0 ? (
            <div className="px-2 py-4 text-sm text-mutedForeground font-heading text-center">No witness notifications in history (or collection empty).</div>
          ) : (
            recent.map((r) => (
              <div key={r.id} className="grid grid-cols-1 md:grid-cols-12 gap-1 px-2 py-2 text-[10px] font-heading items-start">
                <div className="md:col-span-3 truncate">
                  <Link to={`/profile/${encodeURIComponent(r.username)}`} className="text-primary hover:underline font-bold truncate block">
                    {r.username}
                  </Link>
                </div>
                <div className="md:col-span-2 text-mutedForeground tabular-nums whitespace-nowrap">{formatDateTime(r.created_at)}</div>
                <div className="md:col-span-7 text-mutedForeground break-words">{r.message_preview}</div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
