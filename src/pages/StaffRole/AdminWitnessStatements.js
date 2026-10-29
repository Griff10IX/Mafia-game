import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import {
  AdminPage, Badge, Button, Card, DataTable, ErrorBlock, Field, KpiGrid, KpiTile, LoadingBlock, TextInput,
  fmtCash, fmtNum, touchClass,
} from './kit/AdminKit';

function ProfileLink({ name }) {
  return <Link to={`/profile/${encodeURIComponent(name)}`} className="font-medium text-zinc-50 hover:underline">{name}</Link>;
}

const when = (iso) => <span className="whitespace-nowrap tabular-nums text-zinc-400">{formatAdminDateTime(iso)}</span>;

export default function AdminWitnessStatements() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [reconcileUsername, setReconcileUsername] = useState('');
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);

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

  const runReconcile = async (dryRun) => {
    const u = reconcileUsername.trim();
    if (!u) {
      toast.error('Enter a username');
      return;
    }
    setReconcileBusy(true);
    setReconcileResult(null);
    try {
      const res = await api.post('/admin/witness-statements-reconcile', {
        username: u,
        dry_run: dryRun,
      });
      setReconcileResult(res.data);
      if (dryRun) {
        toast.message('Preview ready');
      } else if (res.data?.applied) {
        toast.success('Balance updated');
        fetchOverview();
      } else {
        toast.message(res.data?.message || 'No change');
      }
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Request failed';
      toast.error(typeof msg === 'string' ? msg : 'Request failed');
    } finally {
      setReconcileBusy(false);
    }
  };

  const pageProps = {
    title: 'Witness statements',
    subtitle: 'Circulating balances, Quick Trade listings and recent inbox deliveries. New statements only go to players who are online (last 5 minutes or forced online).',
    icon: FileText,
  };

  if (!accessChecked || (loading && !data)) {
    return <div data-testid="admin-witness-statements-page"><AdminPage {...pageProps}><LoadingBlock label="Loading witness statement data…" /></AdminPage></div>;
  }

  const top = Array.isArray(data?.top_holders) ? data.top_holders : [];
  const listings = Array.isArray(data?.active_listings) ? data.active_listings : [];
  const recent = Array.isArray(data?.recent_witness_notifications) ? data.recent_witness_notifications : [];
  const r = reconcileResult;
  const applyDisabled = reconcileBusy
    || !r
    || !r.dry_run
    || (r.delta === 0 && r.witness_nav_red_before === r.witness_nav_red_after);

  return (
    <div data-testid="admin-witness-statements-page">
      <AdminPage
        {...pageProps}
        actions={<Button icon={RefreshCw} loading={loading} onClick={() => fetchOverview()} className={touchClass}>Refresh</Button>}
      >
        {error && <ErrorBlock message={error} onRetry={fetchOverview} />}

        <KpiGrid cols={3}>
          <KpiTile label="Circulating (players)" value={fmtNum(data?.circulating_total)} hint={`Snapshot ${formatAdminDateTime(data?.generated_at)}`} />
          <KpiTile label="Holders with a balance" value={fmtNum(data?.holders_with_balance)} />
          <KpiTile label="Active listings" value={fmtNum(data?.active_listings_count)} />
        </KpiGrid>

        <Card
          title="Reconcile stored balance"
          subtitle="Preview first, then apply."
        >
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-zinc-400">
              Sets <span className="font-mono text-zinc-200">witness_statements</span> to match witness inbox rows minus lines held in
              {' '}<strong className="text-zinc-200">active</strong> listings (escrow). Use it when the UI shows a balance but the witness log is
              empty (for example the old attack-mute bug, or deleted inbox rows).
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Username" className="flex-1">
                <TextInput value={reconcileUsername} onChange={setReconcileUsername} placeholder="Player username" autoComplete="off" />
              </Field>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button disabled={reconcileBusy} onClick={() => runReconcile(true)} className={touchClass}>Preview</Button>
                <Button variant="danger" disabled={applyDisabled} onClick={() => runReconcile(false)} className={touchClass}>Apply fix</Button>
              </div>
            </div>
            {reconcileBusy && <LoadingBlock label="Working…" />}
            {r && (
              <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.dry_run ? 'info' : r.applied ? 'good' : 'neutral'}>{r.dry_run ? 'Preview' : r.applied ? 'Applied' : 'No change'}</Badge>
                  <span className="break-all font-mono text-xs text-zinc-500">{r.user_id}</span>
                </div>
                <dl className="grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-4">
                  <div><dt className="text-xs text-zinc-500">Stored → new</dt><dd className="text-zinc-100">{r.witness_statements_before} → {r.witness_statements_after}</dd></div>
                  <div><dt className="text-xs text-zinc-500">Inbox total</dt><dd className="text-zinc-100">{r.witness_notifications_total}</dd></div>
                  <div><dt className="text-xs text-zinc-500">In escrow</dt><dd className="text-zinc-100">{r.witness_notifications_in_escrow}</dd></div>
                  <div><dt className="text-xs text-zinc-500">Nav badge before → after</dt><dd className="text-zinc-100">{r.witness_nav_red_before} → {r.witness_nav_red_after}</dd></div>
                </dl>
                {r.message && <p className="border-t border-zinc-800 pt-2 text-zinc-400">{r.message}</p>}
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Top balances" padded={false}>
            <DataTable
              rows={top}
              rowKey={(row) => row.user_id}
              pageSize={15}
              empty="No player holds witness statements."
              initialSort={{ key: 'balance', dir: 'desc' }}
              columns={[
                { key: 'username', label: 'Player', render: (row) => <ProfileLink name={row.username} /> },
                { key: 'balance', label: 'Balance', align: 'right', render: (row) => fmtNum(row.balance) },
                { key: 'is_dead', label: 'Status', render: (row) => (row.is_dead ? <Badge tone="bad">Dead</Badge> : <Badge tone="good">Alive</Badge>) },
                { key: 'last_seen', label: 'Last seen', render: (row) => when(row.last_seen), sortValue: (row) => row.last_seen || '' },
              ]}
            />
          </Card>

          <Card title="Quick Trade listings" subtitle="Witness statements for sale" padded={false}>
            <DataTable
              rows={listings}
              rowKey={(row) => row.id}
              pageSize={15}
              empty="No active listings."
              columns={[
                {
                  key: 'seller_username',
                  label: 'Seller',
                  render: (row) => (
                    <div>
                      <ProfileLink name={row.seller_username} />
                      <div className="font-mono text-xs text-zinc-500">{row.seller_id}</div>
                    </div>
                  ),
                },
                { key: 'quantity', label: 'Qty', align: 'right', render: (row) => fmtNum(row.quantity) },
                { key: 'price_cash', label: 'Price', align: 'right', render: (row) => fmtCash(row.price_cash, { compact: false }) },
                { key: 'created_at', label: 'Listed', render: (row) => when(row.created_at), sortValue: (row) => row.created_at || '' },
              ]}
            />
          </Card>
        </div>

        <Card title="Recent witness inbox deliveries" padded={false}>
          <DataTable
            rows={recent}
            rowKey={(row) => row.id}
            pageSize={20}
            empty="No witness notifications in history (or collection empty)."
            columns={[
              { key: 'username', label: 'Recipient', render: (row) => <ProfileLink name={row.username} /> },
              { key: 'created_at', label: 'Time', render: (row) => when(row.created_at), sortValue: (row) => row.created_at || '' },
              { key: 'message_preview', label: 'Preview', sortable: false, render: (row) => <span className="block min-w-[260px] max-w-xl whitespace-normal break-words text-zinc-400">{row.message_preview}</span> },
            ]}
          />
        </Card>
      </AdminPage>
    </div>
  );
}
