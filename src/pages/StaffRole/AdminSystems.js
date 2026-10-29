import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Boxes, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import { AdminPage, Button, Card, DataTable, LoadingBlock, Segmented, Tabs, fmtNum } from './kit/AdminKit';

const ADMIN_BASE = '/tjjeujr3wa';

const AdminExclusiveCars = lazy(() => import('./AdminExclusiveCars'));
const AdminVipCars = lazy(() => import('./AdminVipCars'));
const AdminPropertyTransfer = lazy(() => import('./AdminPropertyTransfer'));
const AdminCrewRecovery = lazy(() => import('./AdminCrewRecovery'));
const AdminRacketProgress = lazy(() => import('./AdminRacketProgress'));
const AdminDistilleryProgress = lazy(() => import('./AdminDistilleryProgress'));
const AdminMolotovs = lazy(() => import('./AdminMolotovs'));

function errText(e, fallback) {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
}

function DeadOwnerProperties() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/casinos-on-dead-owners');
      setRows(Array.isArray(data?.entries) ? data.entries : []);
    } catch (e) {
      toast.error(errText(e, 'Scan failed'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toKiller = async (row) => {
    const assetKind = row.asset_kind || row.game_type;
    const key = `${row.owner_id}:${assetKind}:${row.location}`;
    const payload = {
      from_username: row.username || row.owner_username,
      asset_kind: assetKind,
      location: row.location,
      dry_run: true,
      allow_recipient_already_owns: true,
      notify: true,
    };
    setBusyKey(key);
    try {
      const preview = await api.post('/admin/transfer-dead-owner-property', payload);
      if (!window.confirm(preview.data?.message || `Give ${assetKind} in ${row.location} to ${row.killed_by_username}?`)) return;
      const { data } = await api.post('/admin/transfer-dead-owner-property', { ...payload, dry_run: false });
      toast.success(data?.message || 'Transferred');
      load();
    } catch (e) {
      toast.error(errText(e, 'Transfer failed'));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Card
      title="Properties still owned by dead players"
      subtitle="Dead players can't hold casinos, armouries or airports. Give each one to the recorded killer, or open the owner to handle it by hand."
      actions={<Button size="sm" icon={RefreshCw} loading={loading} onClick={load}>Scan again</Button>}
      padded={false}
    >
      {!rows ? <LoadingBlock label="Scanning…" /> : (
        <DataTable
          rows={rows}
          pageSize={20}
          empty="None. Every property has a living owner."
          columns={[
            { key: 'asset', label: 'Property', sortValue: (r) => r.asset_kind || r.game_type, render: (r) => <span className="capitalize">{r.asset_kind || r.game_type || '—'}</span> },
            { key: 'location', label: 'Where', render: (r) => `${r.location || '—'}${r.slot ? ` · slot ${r.slot}` : ''}` },
            { key: 'username', label: 'Dead owner', render: (r) => <Link to={`${ADMIN_BASE}/player?u=${encodeURIComponent(r.username || r.owner_id)}`} className="text-zinc-200 hover:underline">{r.username || r.owner_id}</Link> },
            { key: 'killed_by_username', label: 'Killer', render: (r) => r.killed_by_username || <span className="text-zinc-500">unknown</span> },
            {
              key: 'buyback',
              label: 'Buy-back',
              align: 'right',
              sortValue: (r) => Number(r.buy_back_reward || 0) + Number(r.buy_back_points_held || 0),
              render: (r) => ((r.buy_back_reward > 0 || r.buy_back_points_held > 0) ? `${fmtNum(r.buy_back_reward)} reward · ${fmtNum(r.buy_back_points_held)} held` : ''),
            },
            {
              key: 'action',
              label: '',
              sortable: false,
              render: (r) => {
                const key = `${r.owner_id}:${r.asset_kind || r.game_type}:${r.location}`;
                return r.killed_by_username ? <Button size="sm" loading={busyKey === key} onClick={() => toKiller(r)}>Give to {r.killed_by_username}</Button> : null;
              },
            },
          ]}
        />
      )}
    </Card>
  );
}

const TABS = [
  {
    id: 'cars',
    label: 'Special cars',
    tools: [
      { id: 'exclusive', label: 'Exclusive cars', Component: AdminExclusiveCars },
      { id: 'vip', label: 'VIP Pass cars', Component: AdminVipCars },
    ],
    classic: { label: 'GTA exclusive pool & dealer (classic)', to: 'liveops' },
  },
  {
    id: 'properties',
    label: 'Properties',
    tools: [
      { id: 'dead-owners', label: 'Dead owners', Component: DeadOwnerProperties },
      { id: 'transfer', label: 'Armoury / airport transfer', Component: AdminPropertyTransfer },
    ],
  },
  {
    id: 'families',
    label: 'Families & crews',
    tools: [
      { id: 'recovery', label: 'Crew recovery', Component: AdminCrewRecovery },
      { id: 'racket', label: 'Racket progress', Component: AdminRacketProgress },
      { id: 'distillery', label: 'Distillery progress', Component: AdminDistilleryProgress },
    ],
  },
  {
    id: 'ammo',
    label: 'Ammo',
    tools: [{ id: 'ammo', label: 'Bullets & molotovs', Component: AdminMolotovs }],
  },
];

export default function AdminSystems() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === searchParams.get('view')) || TABS[0];
  const tool = tab.tools.find((t) => t.id === searchParams.get('tool')) || tab.tools[0];

  const go = (view, toolId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      next.set('view', view);
      if (toolId) next.set('tool', toolId);
      ['user', 'family', 'from', 'to'].forEach((k) => { if (prev.get(k) && view === tab.id) next.set(k, prev.get(k)); });
      return next;
    });
  };

  const Tool = tool.Component;
  return (
    <AdminPage title="Game systems" subtitle="Special cars, properties, families and ammo in one place." icon={Boxes}>
      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab.id} onChange={(id) => go(id)} />
      {(tab.tools.length > 1 || tab.classic) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {tab.tools.length > 1 ? (
            <Segmented size="sm" value={tool.id} onChange={(id) => go(tab.id, id)} options={tab.tools.map((t) => ({ value: t.id, label: t.label }))} />
          ) : <span />}
          {tab.classic && (
            <Link to={`${ADMIN_BASE}/${tab.classic.to}`}><Button size="sm" icon={ExternalLink}>{tab.classic.label}</Button></Link>
          )}
        </div>
      )}
      <Suspense fallback={<LoadingBlock label="Loading tool…" />}>
        <Tool key={`${tab.id}-${tool.id}`} />
      </Suspense>
    </AdminPage>
  );
}
