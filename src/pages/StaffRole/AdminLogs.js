import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, RefreshCw, ScrollText, Search } from 'lucide-react';
import api from '../../utils/api';
import { AdminPage, Badge, Button, Card, DataTable, EmptyState, ErrorBlock, LoadingBlock, fmtDateTime, fmtNum } from './kit/AdminKit';

const ADMIN_BASE = '/tjjeujr3wa';

/**
 * Every log the explorer can read. `rows` picks the list out of the response; `what`/`amount`/`who`
 * pull a short label, a number and the player from one row. Sources sharing a path are fetched once.
 */
const SOURCES = [
  {
    id: 'activity', label: 'Activity', path: '/admin/activity-log', rows: (d) => d.entries, optionalUser: true,
    params: (u, limit) => ({ username: u || undefined, limit }), what: (r) => r.action,
  },
  {
    id: 'gambling', label: 'Gambling', path: '/admin/gambling-log', rows: (d) => d.entries, optionalUser: true,
    params: (u, limit) => ({ username: u || undefined, limit }), what: (r) => r.game_type,
    amount: (r) => r.details?.payout ?? r.details?.winnings ?? r.details?.bet,
  },
  {
    id: 'crimes', label: 'Crimes', path: '/admin/crimes/logs', rows: (d) => d.logs,
    params: (u, limit) => ({ username: u, limit }), what: (r) => r.crime_name || r.crime_id, amount: (r) => r.profit, ok: (r) => r.success,
  },
  {
    id: 'gta', label: 'GTA', path: '/admin/gta/logs', rows: (d) => d.logs,
    params: (u, limit) => ({ username: u, limit }), what: (r) => [r.option_name, r.car_name].filter(Boolean).join(' · '), amount: (r) => r.car_value ?? r.profit, ok: (r) => r.success,
  },
  {
    id: 'jail', label: 'Jail busts', path: '/admin/jail/logs', rows: (d) => d.logs,
    params: (u, limit) => ({ username: u, limit }), what: (r) => `Bust ${r.target_username || ''}${r.is_npc ? ' (NPC)' : ''}`, amount: (r) => r.profit, ok: (r) => r.success,
  },
  {
    id: 'transfers', label: 'Money transfers', path: '/admin/bank/logs', rows: (d) => d.transfers,
    params: (u, limit) => ({ username: u, limit: Math.min(limit, 500) }),
    what: (r) => `${r.direction === 'sent' ? 'Sent to' : 'Received from'} ${r.direction === 'sent' ? r.to_username : r.from_username}${r.transfer_kind ? ` (${r.transfer_kind})` : ''}`,
    amount: (r) => (r.direction === 'sent' ? -1 : 1) * Number(r.amount || 0),
  },
  {
    id: 'deposits', label: 'Interest deposits', path: '/admin/bank/logs', rows: (d) => d.deposits,
    params: (u, limit) => ({ username: u, limit: Math.min(limit, 500) }),
    what: (r) => `Deposit ${r.duration_hours}h at ${r.interest_rate}${r.claimed_at ? ' · claimed' : ''}`, amount: (r) => r.principal,
  },
  {
    id: 'stock', label: 'Stocks', path: '/admin/stock/logs', rows: (d) => d.logs,
    params: (u, limit) => ({ username: u, limit }), what: (r) => [r.action || r.type, r.stock_name || r.symbol].filter(Boolean).join(' '), amount: (r) => r.total ?? r.amount,
  },
  {
    id: 'attacks', label: 'Attacks', path: '/admin/attacks/logs', rows: (d) => d.logs,
    params: (u, limit) => ({ username: u, limit }), who: (r) => r.attacker_username,
    what: (r) => `${r.outcome || 'attack'} → ${r.target_username || '?'}`, amount: (r) => r.bullets_used,
  },
  {
    id: 'hitman', label: 'Hitman', path: '/admin/hitman/logs', rows: (d) => d.events,
    params: (u) => ({ username: u }), who: (r) => r.hirer_username,
    what: (r) => `${r.tier_label || 'Hit'} on ${r.target_username || '?'}`, amount: (r) => r.cost, ok: (r) => r.success,
  },
  {
    id: 'points', label: 'Points ledger', path: (u) => `/admin/currency-spend-audit/${encodeURIComponent(u)}`, rows: (d) => d.points_ledger_recent,
    params: (u, limit) => ({ ledger_limit: limit, respect_limit: 50 }), what: (r) => r.event_type, amount: (r) => r.points,
  },
  {
    id: 'respect', label: 'Respect spent', path: (u) => `/admin/currency-spend-audit/${encodeURIComponent(u)}`, rows: (d) => d.respect_spent_events,
    params: (u, limit) => ({ ledger_limit: 50, respect_limit: limit }), what: (r) => r.source, amount: (r) => -Math.abs(Number(r.amount || 0)),
  },
  {
    id: 'forum-mutes', label: 'Forum mutes', path: '/admin/forum-mutes-log', rows: (d) => d.log, optionalUser: true, global: true,
    params: () => ({}), what: (r) => r.action || (r.muted ? 'mute' : 'unmute'),
  },
];

const TIMELINE_IDS = ['activity', 'gambling', 'crimes', 'gta', 'jail', 'transfers', 'attacks', 'points'];
const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
const TIME_KEYS = ['created_at', 'at', 'timestamp', 'last_at', 'set_at'];
const WHO_KEYS = ['username', 'attacker_username', 'hirer_username', 'from_username', 'muted_username', 'target_username'];
const HIDDEN_KEYS = new Set(['id', 'user_id', '_id', 'attacker_id', 'target_id', 'hirer_id', 'from_user_id', 'to_user_id', 'client_header_snapshot', 'attacker_client_signal', 'user_agent']);

function errText(e, fallback) {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
}

const rowTime = (r) => TIME_KEYS.map((k) => r[k]).find(Boolean) || null;
const rowWho = (src, r) => (src.who ? src.who(r) : WHO_KEYS.map((k) => r[k]).find(Boolean)) || '';

function flatten(obj, prefix = '', out = {}) {
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (HIDDEN_KEYS.has(k) || TIME_KEYS.includes(k) || v === null || v === undefined || v === '') return;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (!prefix) flatten(v, key, out);
    } else {
      out[key] = Array.isArray(v) ? v.slice(0, 5).join(', ') : v;
    }
  });
  return out;
}

function detailText(r) {
  return Object.entries(flatten(r))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? fmtNum(v) : String(v).slice(0, 60)}`)
    .join(' · ');
}

function normalize(src, rows) {
  return (rows || []).map((r, i) => ({
    key: `${src.id}-${r.id || i}`,
    source: src.label,
    time: rowTime(r),
    who: rowWho(src, r),
    what: String((src.what && src.what(r)) || '').replace(/_/g, ' '),
    amount: src.amount ? src.amount(r) : null,
    ok: src.ok ? src.ok(r) : null,
    details: detailText(r),
  }));
}

async function fetchSources(ids, user, limit) {
  const byRequest = new Map();
  ids.forEach((id) => {
    const src = SOURCE_BY_ID[id];
    const path = typeof src.path === 'function' ? src.path(user) : src.path;
    const params = src.params(user, limit);
    const reqKey = `${path}?${JSON.stringify(params)}`;
    if (!byRequest.has(reqKey)) byRequest.set(reqKey, { path, params, ids: [] });
    byRequest.get(reqKey).ids.push(id);
  });
  const results = await Promise.allSettled([...byRequest.values()].map((r) => api.get(r.path, { params: r.params })));
  const rows = [];
  const errors = [];
  [...byRequest.values()].forEach((req, i) => {
    const res = results[i];
    req.ids.forEach((id) => {
      const src = SOURCE_BY_ID[id];
      if (res.status === 'fulfilled') rows.push(...normalize(src, src.rows(res.value.data || {})));
      else errors.push(`${src.label}: ${errText(res.reason, 'failed')}`);
    });
  });
  rows.sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
  return { rows, errors };
}

function toCsv(rows) {
  const cols = ['time', 'source', 'who', 'what', 'amount', 'ok', 'details'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const inputClass = 'h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none';

export default function AdminLogs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const source = searchParams.get('source') || 'timeline';
  const user = (searchParams.get('u') || '').trim();
  const [userInput, setUserInput] = useState(user);
  const [limit, setLimit] = useState(200);
  const [filter, setFilter] = useState('');
  const [state, setState] = useState({ loading: false, rows: null, errors: [], error: null });

  const src = SOURCE_BY_ID[source];
  const needsUser = source === 'timeline' || (src && !src.optionalUser);

  useEffect(() => { setUserInput(user); }, [user]);

  const load = useCallback(async () => {
    if (needsUser && !user) {
      setState({ loading: false, rows: null, errors: [], error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const ids = source === 'timeline' ? TIMELINE_IDS : [source];
    const perSource = source === 'timeline' ? Math.min(limit, 100) : limit;
    try {
      const { rows, errors } = await fetchSources(ids, user, perSource);
      setState({ loading: false, rows, errors, error: rows.length || !errors.length ? null : errors.join(' · ') });
    } catch (e) {
      setState({ loading: false, rows: null, errors: [], error: errText(e, 'Could not load logs') });
    }
  }, [source, user, limit, needsUser]);

  useEffect(() => { load(); }, [load]);

  const update = (patch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      return next;
    });
  };

  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () => (state.rows || []).filter((r) => !q || `${r.who} ${r.what} ${r.details} ${r.source}`.toLowerCase().includes(q)),
    [state.rows, q],
  );

  const sourceOptions = [{ id: 'timeline', label: 'Everything for one player' }, ...SOURCES];
  return (
    <AdminPage title="Logs" subtitle="Every game log in one place. Pick a log, or see a player's whole timeline." icon={ScrollText}>
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="grid gap-1 text-sm">
            <span className="text-zinc-400">Log</span>
            <select value={source} onChange={(e) => update({ source: e.target.value })} className={inputClass}>
              {sourceOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="grid flex-1 gap-1 text-sm lg:max-w-xs">
            <span className="text-zinc-400">Player{needsUser ? '' : ' (optional)'}</span>
            <div className="flex gap-2">
              <input
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') update({ u: userInput.trim() }); }}
                placeholder="Username"
                className={`${inputClass} flex-1`}
              />
              <Button variant="primary" icon={Search} onClick={() => update({ u: userInput.trim() })}>Load</Button>
            </div>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-zinc-400">Rows{source === 'timeline' ? ' per log' : ''}</span>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputClass}>
              {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="grid flex-1 gap-1 text-sm">
            <span className="text-zinc-400">Search in results</span>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. casino, Rabbit, 1000000" className={inputClass} />
          </label>
        </div>
      </Card>

      {needsUser && !user ? (
        <Card><EmptyState>Enter a player to load {source === 'timeline' ? 'their full timeline' : `their ${src?.label.toLowerCase()} log`}.</EmptyState></Card>
      ) : state.error ? (
        <ErrorBlock message={state.error} onRetry={load} />
      ) : state.loading && !state.rows ? (
        <LoadingBlock />
      ) : (
        <Card
          title={`${source === 'timeline' ? 'Timeline' : src?.label}${user ? ` · ${user}` : ''}`}
          subtitle={`${fmtNum(rows.length)} rows${q ? ` matching "${filter.trim()}"` : ''}, newest first`}
          actions={(
            <>
              {user && <Link to={`${ADMIN_BASE}/player?u=${encodeURIComponent(user)}`}><Button size="sm">Open player</Button></Link>}
              <Button size="sm" icon={Download} disabled={!rows.length} onClick={() => download(`${source}${user ? `-${user}` : ''}.csv`, toCsv(rows))}>CSV</Button>
              <Button size="sm" icon={RefreshCw} loading={state.loading} onClick={load}>Refresh</Button>
            </>
          )}
          padded={false}
        >
          {state.errors.length > 0 && (
            <p className="border-b border-zinc-800 px-4 py-2 text-xs text-amber-300">Some logs could not load: {state.errors.join(' · ')}</p>
          )}
          <DataTable
            rows={rows}
            rowKey={(r) => r.key}
            pageSize={50}
            empty="No entries."
            columns={[
              { key: 'time', label: 'When', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.time)}</span>, sortValue: (r) => r.time || '' },
              ...(source === 'timeline' ? [{ key: 'source', label: 'Log', render: (r) => <Badge>{r.source}</Badge> }] : []),
              { key: 'who', label: 'Player', render: (r) => (r.who ? <Link to={`${ADMIN_BASE}/player?u=${encodeURIComponent(r.who)}`} className="text-zinc-200 hover:underline">{r.who}</Link> : '—') },
              {
                key: 'what',
                label: 'What',
                render: (r) => (
                  <span className="inline-flex items-center gap-1.5 text-zinc-200">
                    {r.ok === true && <Badge tone="good">ok</Badge>}
                    {r.ok === false && <Badge tone="bad">fail</Badge>}
                    {r.what || '—'}
                  </span>
                ),
              },
              {
                key: 'amount',
                label: 'Amount',
                align: 'right',
                sortValue: (r) => Number(r.amount || 0),
                render: (r) => (r.amount == null || r.amount === '' ? '' : <span className={Number(r.amount) < 0 ? 'text-rose-400' : 'text-zinc-200'}>{fmtNum(r.amount)}</span>),
              },
              { key: 'details', label: 'Details', sortable: false, render: (r) => <span className="block max-w-xl text-xs text-zinc-400">{r.details}</span> },
            ]}
          />
        </Card>
      )}
    </AdminPage>
  );
}
