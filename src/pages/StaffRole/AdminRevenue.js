import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PoundSterling, RefreshCw } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../../utils/api';
import {
  AdminPage, Badge, Button, Card, DataTable, ErrorBlock, KpiGrid, KpiTile, LoadingBlock, RANGE_OPTIONS, Segmented, Tabs,
  fmtCash, fmtCompact, fmtDateTime, fmtGBP, fmtNum, pctChange,
} from './kit/AdminKit';

const CHART_COLORS = ['#a5b4fc', '#6ee7b7', '#fcd34d', '#f9a8d4', '#7dd3fc', '#c4b5fd', '#fda4af'];
const AXIS = { stroke: '#52525b', fontSize: 11, tickLine: false, axisLine: false };
const TOOLTIP_STYLE = { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12, color: '#e4e4e7' };

function rangeLabel(days) {
  return days === 0 ? 'all time' : `last ${days === 365 ? 'year' : `${days} days`}`;
}

function errText(e) {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : 'Could not load revenue data.';
}

function PlayerLink({ name }) {
  if (!name || name === '?') return <span className="text-zinc-400">?</span>;
  return (
    <Link to={`/tjjeujr3wa/players?target=${encodeURIComponent(name)}`} className="text-zinc-100 hover:underline">
      {name}
    </Link>
  );
}

function RealMoney({ data, days }) {
  const t = data.totals;
  const prev = data.previous;
  const deltaLabel = prev ? 'vs previous period' : undefined;
  const series = (data.series || []).map((s) => ({ ...s, pounds: s.gross_minor / 100 }));
  const cats = (data.by_category || []).map((c) => ({ ...c, pounds: c.gross_minor / 100 }));
  return (
    <div className="space-y-4">
      <KpiGrid cols={4}>
        <KpiTile label="Gross revenue" value={fmtGBP(t.gross_minor)} delta={prev ? pctChange(t.gross_minor, prev.gross_minor) : null} deltaLabel={deltaLabel} />
        <KpiTile label="Payments" value={fmtNum(t.payments)} delta={prev ? pctChange(t.payments, prev.payments) : null} deltaLabel={deltaLabel} />
        <KpiTile label="Paying players" value={fmtNum(t.payers)} hint={`${fmtNum(t.new_payers)} new · ${fmtNum(t.returning_payers)} returning`} />
        <KpiTile label="Average per payer" value={fmtGBP(t.arppu_minor)} hint={`avg order ${fmtGBP(t.avg_order_minor)}`} />
        <KpiTile label="Net after refunds" value={fmtGBP(t.net_minor)} tone={t.refunded_minor ? 'warn' : 'default'} hint={t.refunded_minor ? `${fmtGBP(t.refunded_minor)} refunded` : 'no refunds recorded'} />
        <KpiTile label="Disputes" value={fmtNum(t.disputes)} tone={t.disputes ? 'bad' : 'default'} hint={t.disputes ? fmtGBP(t.disputed_minor) : 'none recorded'} />
        <KpiTile label="New signups" value={fmtNum(t.signups)} hint={t.payer_conversion_pct != null ? `${t.payer_conversion_pct}% became first-time payers` : undefined} />
        <KpiTile label="Unfinished checkouts" value={fmtNum(t.pending + t.abandoned)} hint={`${fmtNum(t.abandoned)} abandoned · ${fmtNum(t.pending)} pending`} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Revenue over time" subtitle={`Gross £ per ${data.bucket} · ${rangeLabel(days)}`} className="lg:col-span-2">
          {series.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a5b4fc" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#a5b4fc" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#27272a" vertical={false} />
                  <XAxis dataKey="period" {...AXIS} />
                  <YAxis {...AXIS} width={52} tickFormatter={(v) => `£${fmtCompact(v)}`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n, p) => [`£${Number(v).toFixed(2)} · ${p.payload.payments} payments`, 'Gross']} />
                  <Area type="monotone" dataKey="pounds" stroke="#a5b4fc" strokeWidth={2} fill="url(#revFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-10 text-center text-sm text-zinc-500">No payments in this period.</p>}
        </Card>
        <Card title="By category" subtitle="Share of gross revenue">
          {cats.length ? (
            <>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={cats} dataKey="pounds" nameKey="label" innerRadius={42} outerRadius={70} paddingAngle={2} stroke="none">
                      {cats.map((c, i) => <Cell key={c.category} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => `£${Number(v).toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {cats.map((c, i) => (
                  <li key={c.category} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-zinc-300">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      {c.label}
                    </span>
                    <span className="tabular-nums text-zinc-100">{fmtGBP(c.gross_minor)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="py-10 text-center text-sm text-zinc-500">No payments in this period.</p>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Products" subtitle="Ranked by gross revenue" padded={false}>
          <DataTable
            rows={data.by_product}
            rowKey={(r) => r.product_id}
            pageSize={12}
            initialSort={{ key: 'gross_minor', dir: 'desc' }}
            columns={[
              { key: 'label', label: 'Product' },
              { key: 'payments', label: 'Sales', align: 'right', render: (r) => fmtNum(r.payments) },
              { key: 'payers', label: 'Buyers', align: 'right', render: (r) => fmtNum(r.payers) },
              { key: 'gross_minor', label: 'Gross', align: 'right', render: (r) => fmtGBP(r.gross_minor) },
            ]}
          />
        </Card>
        <Card title="Top spenders" subtitle={rangeLabel(days)} padded={false}>
          <DataTable
            rows={data.top_spenders}
            rowKey={(r) => r.user_id}
            pageSize={15}
            initialSort={{ key: 'gross_minor', dir: 'desc' }}
            columns={[
              { key: 'username', label: 'Player', render: (r) => <PlayerLink name={r.username} /> },
              { key: 'payments', label: 'Payments', align: 'right', render: (r) => fmtNum(r.payments) },
              { key: 'last_at', label: 'Last paid', align: 'right', render: (r) => fmtDateTime(r.last_at), sortValue: (r) => r.last_at || '' },
              { key: 'gross_minor', label: 'Spent', align: 'right', render: (r) => fmtGBP(r.gross_minor) },
            ]}
          />
        </Card>
      </div>

      <Card title="Recent payments" subtitle="Latest 25 paid checkouts" padded={false}>
        <DataTable
          rows={data.recent}
          rowKey={(r, i) => `${r.created_at}-${i}`}
          pageSize={25}
          columns={[
            { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
            { key: 'username', label: 'Player', render: (r) => <PlayerLink name={r.username} /> },
            { key: 'product', label: 'Product' },
            {
              key: 'status', label: 'Status', render: (r) => (
                <span className="flex gap-1">
                  <Badge tone={r.status === 'completed' ? 'good' : 'warn'}>{r.status.replace(/_/g, ' ')}</Badge>
                  {r.refunded_minor > 0 && <Badge tone="warn">refunded {fmtGBP(r.refunded_minor)}</Badge>}
                  {r.dispute_status && <Badge tone="bad">dispute: {r.dispute_status}</Badge>}
                </span>
              ),
            },
            { key: 'amount_minor', label: 'Amount', align: 'right', render: (r) => fmtGBP(r.amount_minor) },
          ]}
        />
      </Card>

      <p className="text-xs text-zinc-500">
        All time: {fmtGBP(data.all_time.gross_minor)} from {fmtNum(data.all_time.payments)} payments by {fmtNum(data.all_time.payers)} players
        {data.all_time.first_payment_at ? ` since ${new Date(data.all_time.first_payment_at).toLocaleDateString()}` : ''}. {data.notes}
      </p>
    </div>
  );
}

function Economy({ data, days }) {
  const s = data.supply || {};
  const p = data.points || {};
  const casino = data.casino || {};
  const lottery = data.lottery || {};
  const games = (casino.by_game || []).slice(0, 10).map((g) => ({ ...g, label: g.game.replace(/_/g, ' ') }));
  return (
    <div className="space-y-4">
      <KpiGrid cols={4}>
        <KpiTile label="Cash held by players" value={fmtCash(s.cash)} hint={`${fmtNum(s.players)} alive players`} />
        <KpiTile label="Swiss bank" value={fmtCash(s.swiss)} />
        <KpiTile label="Points held" value={fmtCompact(s.points)} />
        <KpiTile label="Casino house profit" value={fmtCash(casino.house_profit_cash)} tone={casino.house_profit_cash >= 0 ? 'good' : 'bad'} hint={`${fmtNum(casino.plays)} plays · ${rangeLabel(days)}`} />
        <KpiTile label="Points created" value={fmtCompact(p.created)} hint={rangeLabel(days)} />
        <KpiTile label="Points removed" value={fmtCompact(p.removed)} hint={rangeLabel(days)} />
        <KpiTile label="Net points change" value={`${p.net >= 0 ? '+' : ''}${fmtCompact(p.net)}`} tone={p.net > 0 ? 'warn' : 'good'} hint={p.net > 0 ? 'more created than removed' : 'more removed than created'} />
        <KpiTile label="Bank interest paid" value={fmtCash(data.bank?.interest_paid)} hint={`${fmtNum(data.bank?.claims)} claims`} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Casino house profit by game" subtitle={`Cash only · ${rangeLabel(days)}`}>
          {games.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={games} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#27272a" horizontal={false} />
                  <XAxis type="number" {...AXIS} tickFormatter={(v) => `$${fmtCompact(v)}`} />
                  <YAxis type="category" dataKey="label" {...AXIS} width={110} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n, item) => [`$${fmtNum(v)} · ${fmtNum(item.payload.plays)} plays`, 'House profit']} />
                  <Bar dataKey="house_profit" radius={[0, 4, 4, 0]}>
                    {games.map((g) => <Cell key={g.game} fill={g.house_profit >= 0 ? '#6ee7b7' : '#fda4af'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-10 text-center text-sm text-zinc-500">No casino plays in this period.</p>}
        </Card>
        <Card title="Points by source" subtitle="Created and removed per system" padded={false}>
          <DataTable
            rows={p.by_source}
            rowKey={(r) => r.source}
            pageSize={10}
            initialSort={{ key: 'created', dir: 'desc' }}
            columns={[
              {
                key: 'source', label: 'Source', render: (r) => (
                  <span className="flex items-center gap-1.5">
                    {r.source.replace(/_/g, ' ')}
                    {(p.transfer_sources || []).includes(r.source) && <Badge>transfer</Badge>}
                  </span>
                ),
              },
              { key: 'created', label: 'Created', align: 'right', render: (r) => fmtCompact(r.created) },
              { key: 'removed', label: 'Removed', align: 'right', render: (r) => fmtCompact(r.removed) },
              {
                key: 'net', label: 'Net', align: 'right', render: (r) => (
                  <span className={r.net > 0 ? 'text-amber-300' : r.net < 0 ? 'text-emerald-400' : 'text-zinc-400'}>
                    {r.net > 0 ? '+' : ''}{fmtCompact(r.net)}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Lottery" subtitle={rangeLabel(days)}>
          <dl className="space-y-2 text-sm">
            {[
              ['Draws', fmtNum(lottery.rounds)],
              ['Tax removed (cash)', fmtCash(lottery.tax_cash)],
              ['Tax removed (points)', fmtNum(lottery.tax_points)],
              ['Paid to winners (cash)', fmtCash(lottery.paid_cash)],
              ['Paid to winners (points)', fmtNum(lottery.paid_points)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><dt className="text-zinc-400">{k}</dt><dd className="tabular-nums text-zinc-100">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card title="Store spend (points)" subtitle={`${fmtNum(data.store?.points_spent)} points · ${rangeLabel(days)}`} padded={false}>
          <DataTable
            rows={data.store?.points_by_item}
            rowKey={(r) => r.item}
            pageSize={8}
            columns={[
              { key: 'item', label: 'Item' },
              { key: 'purchases', label: 'Buys', align: 'right', render: (r) => fmtNum(r.purchases) },
              { key: 'points', label: 'Points', align: 'right', render: (r) => fmtNum(r.points) },
            ]}
          />
        </Card>
        <Card title="Store spend (cash)" subtitle={`${fmtCash(data.store?.cash_spent)} · ${rangeLabel(days)}`} padded={false}>
          <DataTable
            rows={data.store?.cash_by_kind}
            rowKey={(r) => r.kind}
            pageSize={8}
            columns={[
              { key: 'kind', label: 'Purchase', render: (r) => r.kind.replace(/_/g, ' ') },
              { key: 'purchases', label: 'Buys', align: 'right', render: (r) => fmtNum(r.purchases) },
              { key: 'cash', label: 'Cash', align: 'right', render: (r) => fmtCash(r.cash) },
            ]}
          />
        </Card>
      </div>
      <p className="text-xs text-zinc-500">{data.notes}</p>
    </div>
  );
}

export default function AdminRevenue() {
  const [tab, setTab] = useState('money');
  const [days, setDays] = useState(30);
  const [state, setState] = useState({ loading: true, error: null, money: null, economy: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const path = tab === 'money' ? '/admin/revenue/summary' : '/admin/revenue/economy';
      const { data } = await api.get(path, { params: { days } });
      setState((s) => ({ ...s, loading: false, [tab]: { days, data } }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errText(e) }));
    }
  }, [tab, days]);

  useEffect(() => { load(); }, [load]);

  const current = state[tab];
  const ready = current && current.days === days;

  return (
    <AdminPage
      title="Revenue"
      subtitle="Real-money income and the health of the in-game economy."
      icon={PoundSterling}
      actions={(
        <>
          <Segmented options={RANGE_OPTIONS} value={days} onChange={setDays} size="sm" />
          <Button size="sm" icon={RefreshCw} loading={state.loading} onClick={load}>Refresh</Button>
        </>
      )}
    >
      <Tabs
        tabs={[{ id: 'money', label: 'Real money' }, { id: 'economy', label: 'In-game economy' }]}
        value={tab}
        onChange={setTab}
      />
      {state.error && !ready ? (
        <ErrorBlock message={state.error} onRetry={load} />
      ) : !ready ? (
        <LoadingBlock />
      ) : tab === 'money' ? (
        <RealMoney data={current.data} days={days} />
      ) : (
        <Economy data={current.data} days={days} />
      )}
    </AdminPage>
  );
}
