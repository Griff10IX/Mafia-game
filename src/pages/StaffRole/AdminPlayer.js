import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, RefreshCw, Search, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import {
  AdminPage, Badge, Button, Card, DataTable, EmptyState, ErrorBlock, KpiGrid, KpiTile, LoadingBlock, Segmented, Tabs,
  fmtCash, fmtCompact, fmtDateTime, fmtGBP, fmtNum,
} from './kit/AdminKit';

const CURRENCIES = [
  { value: 'cash', label: 'Cash' },
  { value: 'points', label: 'Points' },
  { value: 'respect', label: 'Respect' },
  { value: 'bullets', label: 'Bullets' },
  { value: 'loot_pieces', label: 'Loot pieces' },
];

function errText(e, fallback) {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg).join('; ');
  return fallback;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function summarizeDetails(details) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, 5)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? fmtNum(v) : String(v).slice(0, 40)}`)
    .join(' · ');
}

function PlayerSearch({ initial, onOpen }) {
  const [q, setQ] = useState(initial || '');
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  useEffect(() => { setQ(initial || ''); }, [initial]);

  const onChange = (v) => {
    setQ(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/admin/users/search', { params: { q: v.trim(), limit: 8 } });
        setHits(Array.isArray(data?.users) ? data.users : []);
        setOpen(true);
      } catch {
        setHits([]);
      }
    }, 250);
  };

  const submit = (name) => {
    const v = (name ?? q).trim();
    if (!v) return;
    setOpen(false);
    onOpen(v);
  };

  return (
    <div className="relative w-full sm:w-80">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false); }}
            onFocus={() => hits.length && setOpen(true)}
            placeholder="Username or email"
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <Button variant="primary" onClick={() => submit()}>Open</Button>
      </div>
      {open && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => submit(h.username)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
              >
                <span className="truncate">{h.username}</span>
                {h.is_dead && <Badge tone="bad">dead</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadges({ status, profile }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {status.modkilled ? <Badge tone="bad">Modkilled</Badge> : status.dead ? <Badge tone="bad">Dead</Badge> : <Badge tone="good">Alive</Badge>}
      {status.banned && <Badge tone="bad">Banned</Badge>}
      {status.account_locked && <Badge tone="warn">Locked</Badge>}
      {status.in_jail && <Badge tone="warn">In jail</Badge>}
      {status.auto_rank_on && <Badge tone="info">Auto Rank on</Badge>}
      {profile.is_moderator && <Badge tone="info">Moderator</Badge>}
      {profile.founding_member && <Badge>Founding member</Badge>}
      {!profile.email_verified && <Badge tone="warn">Email unverified</Badge>}
    </div>
  );
}

function Overview({ d }) {
  const w = d.wallet;
  const e = d.entitlements;
  return (
    <div className="space-y-4">
      <KpiGrid cols={4}>
        <KpiTile label="Cash" value={fmtCash(w.cash)} hint={fmtNum(w.cash)} />
        <KpiTile label="Bank + Swiss" value={fmtCash(Number(w.bank) + Number(w.swiss))} hint={w.interest_deposits ? `${fmtCash(w.interest_principal)} in ${w.interest_deposits} interest deposit(s)` : undefined} />
        <KpiTile label="Points" value={fmtNum(w.points)} />
        <KpiTile label="Respect" value={fmtNum(w.respect)} />
        <KpiTile label="Bullets" value={fmtCompact(w.bullets)} />
        <KpiTile label="Loot pieces" value={fmtNum(w.loot_pieces)} />
        {d.viewer_is_admin && <KpiTile label="Real money spent" value={fmtGBP(d.spend.total_minor)} hint={`${fmtNum(d.spend.payments)} payments`} />}
        <KpiTile label="Rank" value={d.profile.rank_name} hint={`Prestige ${d.profile.prestige_level} · ${fmtNum(d.profile.rank_points)} RP`} />
      </KpiGrid>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Lifetime stats">
          <dl className="space-y-2 text-sm">
            {[['Kills', d.stats.kills], ['Deaths', d.stats.deaths], ['Crimes', d.stats.crimes], ['GTA', d.stats.gta], ['Jail busts', d.stats.jail_busts]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><dt className="text-zinc-400">{k}</dt><dd className="tabular-nums">{fmtNum(v)}</dd></div>
            ))}
            <div className="flex justify-between"><dt className="text-zinc-400">Booze profit</dt><dd className="tabular-nums">{fmtCash(d.stats.booze_profit)}</dd></div>
          </dl>
        </Card>
        <Card title="Game Pass & Auto Rank">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-400">Game Pass VIP</dt><dd>{e.game_pass_vip ? <Badge tone="good">Active</Badge> : <Badge>No</Badge>}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-400">Pass expires</dt><dd>{fmtDateTime(e.game_pass_expires_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-400">Pass tokens</dt><dd className="tabular-nums">{fmtNum(e.game_pass_tokens)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-400">Auto Rank</dt><dd>{e.auto_rank_permanent ? <Badge tone="good">Permanent</Badge> : e.auto_rank_purchased ? <Badge tone="good">Purchased</Badge> : e.auto_rank_trial_until ? <Badge tone="info">Trial</Badge> : <Badge>No</Badge>}</dd></div>
          </dl>
        </Card>
        <Card title="Family & property">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-zinc-400">Family</dt><dd className="truncate">{d.family ? `${d.family.name} [${d.family.tag}] · ${d.family.role}` : 'None'}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-400">Location</dt><dd>{d.profile.current_state || '—'}</dd></div>
          </dl>
          {d.casinos.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-zinc-800 pt-3 text-sm">
              {d.casinos.map((c) => (
                <li key={`${c.game}-${c.location}`} className="flex justify-between gap-2">
                  <span className="text-zinc-300">{c.game} · {c.location}</span>
                  <span className="tabular-nums text-zinc-400">{c.total_earnings != null ? fmtCash(c.total_earnings) : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function WalletTab({ d, onDone }) {
  const [currency, setCurrency] = useState('points');
  const [direction, setDirection] = useState('give');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = Math.trunc(Number(String(amount).replace(/[,\s]/g, '')) || 0);
  const label = CURRENCIES.find((c) => c.value === currency)?.label.toLowerCase();
  const balanceKey = currency === 'loot_pieces' ? 'loot_pieces' : currency;
  const balance = d.wallet[balanceKey] ?? 0;
  const valid = n > 0 && reason.trim().length >= 3;

  useEffect(() => { setConfirming(false); }, [currency, direction, amount, reason]);

  const submit = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/player360/${encodeURIComponent(d.profile.id)}/wallet`, {
        currency, amount: direction === 'give' ? n : -n, reason: reason.trim(),
      });
      toast.success(data?.message || 'Done');
      setAmount('');
      setReason('');
      onDone();
    } catch (e) {
      toast.error(errText(e, 'Adjustment failed'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!d.viewer_is_admin) return <EmptyState>Wallet changes are admin only.</EmptyState>;
  return (
    <Card title="Give or take" subtitle="Every change is saved to the audit log with your name and the reason.">
      <div className="grid max-w-xl gap-4">
        <div className="flex flex-wrap gap-2">
          <Segmented options={CURRENCIES} value={currency} onChange={setCurrency} size="sm" />
        </div>
        <Segmented options={[{ value: 'give', label: 'Give' }, { value: 'take', label: 'Take' }]} value={direction} onChange={setDirection} size="sm" />
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-400">Amount <span className="text-zinc-500">· current balance {fmtNum(balance)}</span></span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm tabular-nums text-zinc-100 focus:border-zinc-500 focus:outline-none"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-400">Reason (required)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="e.g. Refund for bugged booze run"
            className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button variant={direction === 'take' ? 'danger' : 'primary'} disabled={!valid} loading={busy} onClick={submit}>
            {confirming
              ? `Confirm: ${direction} ${fmtNum(n)} ${label} ${direction === 'give' ? 'to' : 'from'} ${d.profile.username}`
              : `${direction === 'give' ? 'Give' : 'Take'} ${n ? fmtNum(n) : ''} ${label}`}
          </Button>
          {confirming && <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>}
        </div>
        {direction === 'take' && <p className="text-xs text-zinc-500">Taking more than the player has removes their whole balance, never below zero.</p>}
      </div>
    </Card>
  );
}

function ActivityTab({ d }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Points history" subtitle="Latest 40 changes from the points audit" padded={false}>
          <DataTable
            rows={d.points_ledger}
            pageSize={10}
            columns={[
              { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at || '' },
              { key: 'event_type', label: 'Event', render: (r) => <span className="text-zinc-300">{(r.event_type || r.source || '').replace(/_/g, ' ')}</span> },
              { key: 'delta', label: 'Change', align: 'right', render: (r) => <span className={r.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{r.delta >= 0 ? '+' : ''}{fmtNum(r.delta)}</span> },
              { key: 'wallet_points_after', label: 'After', align: 'right', render: (r) => (r.wallet_points_after != null ? fmtNum(r.wallet_points_after) : '—') },
            ]}
          />
        </Card>
        <Card title="Gambling" subtitle="Latest 25 bets" padded={false}>
          <DataTable
            rows={d.gambling}
            pageSize={10}
            columns={[
              { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at || '' },
              { key: 'game', label: 'Game', render: (r) => (r.game || '').replace(/_/g, ' ') },
              { key: 'bet', label: 'Bet', align: 'right', render: (r) => fmtCompact(r.details?.bet ?? r.details?.stake ?? 0), sortValue: (r) => Number(r.details?.bet ?? r.details?.stake ?? 0) },
              { key: 'payout', label: 'Payout', align: 'right', render: (r) => fmtCompact(r.details?.payout ?? r.details?.winnings ?? 0), sortValue: (r) => Number(r.details?.payout ?? 0) },
            ]}
          />
        </Card>
      </div>
      <Card title="Activity log" subtitle="Latest 40 actions (kept 90 days)" padded={false}>
        <DataTable
          rows={d.activity}
          pageSize={15}
          columns={[
            { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at || '' },
            { key: 'action', label: 'Action', render: (r) => (r.action || '').replace(/_/g, ' ') },
            { key: 'details', label: 'Details', sortable: false, render: (r) => <span className="text-xs text-zinc-400">{summarizeDetails(r.details)}</span> },
          ]}
        />
      </Card>
      {d.viewer_is_admin && (
        <Card title="Payments" subtitle={`${fmtGBP(d.spend.total_minor)} lifetime from ${fmtNum(d.spend.payments)} payments`} padded={false}>
          <DataTable
            rows={d.spend.recent}
            pageSize={15}
            columns={[
              { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at || '' },
              { key: 'package_id', label: 'Product', render: (r) => (r.package_id || '').replace(/_/g, ' ') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'completed' ? 'good' : 'neutral'}>{(r.status || '').replace(/_/g, ' ')}</Badge> },
              { key: 'amount_minor', label: 'Amount', align: 'right', render: (r) => fmtGBP(r.amount_minor) },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

function AccessTab({ d, run }) {
  const name = d.profile.username;
  return (
    <div className="space-y-4">
      <Card
        title="Sessions"
        subtitle="Latest 10 logins"
        actions={(
          <>
            <Button size="sm" onClick={() => run('Log out everywhere', () => api.post('/admin/log-out-user', null, { params: { target_username: name } }))}>Log out everywhere</Button>
            <Button size="sm" onClick={() => run('Clear login lockout', () => api.post('/admin/clear-login-lockout', null, { params: { target_username: name } }))}>Clear login lockout</Button>
          </>
        )}
        padded={false}
      >
        <DataTable
          rows={d.sessions}
          pageSize={10}
          columns={[
            { key: 'created_at', label: 'Started', render: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at || '' },
            { key: 'last_used_at', label: 'Last used', render: (r) => timeAgo(r.last_used_at), sortValue: (r) => r.last_used_at || '' },
            ...(d.viewer_is_admin ? [{ key: 'ip', label: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip || '—'}</span> }] : []),
            { key: 'user_agent', label: 'Device', sortable: false, render: (r) => <span className="text-xs text-zinc-400">{r.user_agent || '—'}</span> },
          ]}
        />
      </Card>
      <Card title="Deeper checks">
        <div className="flex flex-wrap gap-2">
          <Link to={`/tjjeujr3wa/ip-history?user=${encodeURIComponent(name)}`}><Button size="sm" icon={ExternalLink}>Account access report (IPs, devices)</Button></Link>
          <Link to={`/tjjeujr3wa/account-compare?a=${encodeURIComponent(name)}`}><Button size="sm" icon={ExternalLink}>Compare with another account</Button></Link>
        </div>
      </Card>
    </div>
  );
}

function ActionsTab({ d, run }) {
  const name = d.profile.username;
  const locked = d.status.account_locked;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Account" subtitle="Investigation lock keeps them on the locked page until unlocked.">
        <div className="flex flex-wrap gap-2">
          {locked ? (
            <Button onClick={() => run('Unlock account', () => api.post('/admin/unlock-account', null, { params: { target_username: name } }))}>Unlock account</Button>
          ) : (
            <Button variant="danger" onClick={() => run('Lock account', () => api.post('/admin/lock-player', null, { params: { target_username: name } }), true)}>Lock account</Button>
          )}
        </div>
        {d.status.ban && (
          <p className="mt-3 text-sm text-rose-300">Banned{d.status.ban.reason ? `: ${d.status.ban.reason}` : ''}{d.status.ban.banned_by ? ` (by ${d.status.ban.banned_by})` : ''}</p>
        )}
        {d.status.modkill_reason && <p className="mt-3 text-sm text-rose-300">Modkill reason: {d.status.modkill_reason}</p>}
      </Card>
      <Card title="Other tools" subtitle="Still in the classic tools while they are rebuilt">
        <div className="flex flex-wrap gap-2">
          <Link to={`/tjjeujr3wa/players?target=${encodeURIComponent(name)}`}><Button size="sm" icon={ExternalLink}>Grants, Game Pass, cars, tokens</Button></Link>
          <Link to={`/tjjeujr3wa/moderation?target=${encodeURIComponent(name)}`}><Button size="sm" icon={ExternalLink}>Modkill, revive, bans</Button></Link>
          <Link to={`/profile/${encodeURIComponent(name)}`}><Button size="sm" icon={ExternalLink}>Player dossier</Button></Link>
        </div>
      </Card>
    </div>
  );
}

export default function AdminPlayer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const userRef = (searchParams.get('u') || '').trim();
  const [tab, setTab] = useState('overview');
  const [state, setState] = useState({ loading: false, error: null, data: null });

  const load = useCallback(async () => {
    if (!userRef) {
      setState({ loading: false, error: null, data: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get(`/admin/player360/${encodeURIComponent(userRef)}`);
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: errText(e, 'Could not load player'), data: null });
    }
  }, [userRef]);

  useEffect(() => { load(); }, [load]);

  const open = (name) => {
    setTab('overview');
    setSearchParams({ u: name });
  };

  const run = async (label, fn, confirm = false) => {
    if (confirm && !window.confirm(`${label} for ${state.data?.profile?.username}?`)) return;
    try {
      const res = await fn();
      toast.success(res?.data?.message || `${label}: done`);
      load();
    } catch (e) {
      toast.error(errText(e, `${label} failed`));
    }
  };

  const d = state.data;
  return (
    <AdminPage
      title="Player"
      subtitle="Everything about one player in one place."
      icon={UserRound}
      actions={(
        <>
          <PlayerSearch initial={userRef} onOpen={open} />
          {d && <Button size="sm" icon={RefreshCw} loading={state.loading} onClick={load}>Refresh</Button>}
        </>
      )}
    >
      {!userRef ? (
        <Card><EmptyState>Search for a player to open their profile.</EmptyState></Card>
      ) : state.error ? (
        <ErrorBlock message={state.error} onRetry={load} />
      ) : !d ? (
        <LoadingBlock />
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-lg font-semibold text-zinc-200">
                  {d.profile.avatar_url ? <img src={d.profile.avatar_url} alt="" className="h-full w-full object-cover" /> : (d.profile.username || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-zinc-50">{d.profile.username}</div>
                  <div className="truncate text-xs text-zinc-400">
                    {d.profile.rank_name} · P{d.profile.prestige_level}
                    {d.family ? ` · ${d.family.name}` : ''}
                    {d.profile.email ? ` · ${d.profile.email}` : ''}
                  </div>
                </div>
              </div>
              <StatusBadges status={d.status} profile={d.profile} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-800 pt-3 text-xs text-zinc-400 sm:grid-cols-4">
              <span>Joined {fmtDateTime(d.profile.created_at)}</span>
              <span>Last seen {timeAgo(d.profile.last_seen)}{d.profile.last_seen_country ? ` · ${d.profile.last_seen_country}` : ''}</span>
              <span className="truncate">Page {d.profile.last_path || '—'}</span>
              {d.status.dead && <span>Died {fmtDateTime(d.status.dead_at)}{d.status.killed_by ? ` · by ${d.status.killed_by}` : ''}</span>}
            </div>
          </Card>
          <Tabs
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'wallet', label: 'Wallet' },
              { id: 'activity', label: 'Activity' },
              { id: 'access', label: 'Access' },
              { id: 'actions', label: 'Actions' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'overview' && <Overview d={d} />}
          {tab === 'wallet' && <WalletTab d={d} onDone={load} />}
          {tab === 'activity' && <ActivityTab d={d} />}
          {tab === 'access' && <AccessTab d={d} run={run} />}
          {tab === 'actions' && <ActionsTab d={d} run={run} />}
        </>
      )}
    </AdminPage>
  );
}
