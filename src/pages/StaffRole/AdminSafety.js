import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import {
  AdminPage, Badge, Button, Card, DataTable, EmptyState, ErrorBlock, KpiGrid, KpiTile, LoadingBlock, Segmented, Tabs,
  fmtDateTime, fmtNum,
} from './kit/AdminKit';

const ADMIN_BASE = '/tjjeujr3wa';
const HIGH_RISK = 70;

const GROUP_KINDS = {
  same_ip_groups: 'Same IP',
  same_subnet_groups: 'Same network (/24)',
  same_fingerprint_groups: 'Same device fingerprint',
  same_user_agent_groups: 'Same browser & device',
  alive_dead_ip_groups: "Alive on a dead account's IP",
  alive_dead_fingerprint_groups: "Alive on a dead account's device",
  by_same_day_same_ip: 'Signed up same day, same IP',
  by_domain: 'Same email domain',
  by_similar_email: 'Similar emails',
  by_similar_username: 'Similar usernames',
  by_fuzzy_username: 'Similar usernames (fuzzy)',
  registration_burst_groups: 'Sign-up burst',
  suspicious_ip_correlations: 'Suspicious logins from shared IP',
  referral_same_ip_groups: 'Referral from same IP',
  referral_abuse_groups: 'Referral abuse',
  heavy_transfer_pairs: 'Heavy transfers between accounts',
  transfer_ring_groups: 'Transfer ring',
  overlapping_session_device_groups: 'Overlapping sessions, same device',
  automation_cadence_groups: 'Automation-like timing',
  prereg_ip_cross_accounts: 'Pre-registration IP match',
  proxy_users: 'Proxy / VPN user',
};

const BAN_UNITS = [
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'permanent', label: 'Permanent' },
];

function errText(e, fallback) {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg).join('; ');
  return fallback;
}

function riskTone(score) {
  const s = Number(score) || 0;
  if (s >= HIGH_RISK) return 'bad';
  if (s >= 45) return 'warn';
  return 'neutral';
}

function groupAccounts(g) {
  if (Array.isArray(g.accounts)) return g.accounts;
  if (Array.isArray(g.users)) return g.users;
  if (g.alive_accounts || g.dead_accounts) {
    return [...(g.alive_accounts || []), ...(g.dead_accounts || []).map((d) => ({ ...d, is_dead: true }))];
  }
  if (g.from_user_id || g.to_user_id) {
    return [
      { id: g.from_user_id, username: g.from_username },
      { id: g.to_user_id, username: g.to_username },
    ];
  }
  if (g.user_id || g.username) return [{ id: g.user_id || g.id, username: g.username }];
  return [];
}

function groupEvidence(kind, g) {
  if (kind === 'heavy_transfer_pairs') return `${fmtNum(g.transfer_count)} transfers · ${fmtNum(g.shared_ip_count)} shared IPs`;
  if (kind === 'same_user_agent_groups') return `${(g.user_agent || '').slice(0, 48)} · ${fmtNum(g.distinct_ip_count)} IPs`;
  const v = g.ip || g.subnet || g.fingerprint || g.user_agent || g.domain || g.base || g.email_base || g.referrer_username || g.window_start;
  if (v) return String(v).slice(0, 60);
  if (Array.isArray(g.evidence_reasons)) return g.evidence_reasons.join(', ').replace(/_/g, ' ');
  return '';
}

/** Flatten every group type from the intelligent dupe check into one list of links. */
function normalizeGroups(data) {
  if (!data) return [];
  const out = [];
  for (const [kind, label] of Object.entries(GROUP_KINDS)) {
    const list = data[kind];
    if (!Array.isArray(list)) continue;
    list.forEach((g, i) => {
      const accounts = groupAccounts(g).filter((a) => a && a.username && !String(a.id || '').startsWith('__'));
      if (kind !== 'proxy_users' && accounts.length < 2) return;
      out.push({
        key: `${kind}-${i}`,
        kind,
        label,
        risk: Number(g.risk_score ?? (g.risk === 'high' ? 80 : g.risk === 'medium' ? 50 : 30)) || 0,
        evidence: groupEvidence(kind, g),
        accounts,
      });
    });
  }
  return out.sort((a, b) => b.risk - a.risk);
}

function PlayerLink({ name, dead }) {
  if (!name) return <span className="text-zinc-500">—</span>;
  return (
    <Link
      to={`${ADMIN_BASE}/player?u=${encodeURIComponent(name)}`}
      className={`hover:text-zinc-50 hover:underline ${dead ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}
    >
      {name}
    </Link>
  );
}

function TextInput({ value, onChange, placeholder, onEnter, className = '', ...rest }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
      placeholder={placeholder}
      className={`h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none ${className}`}
      {...rest}
    />
  );
}

function LinksTable({ rows, pageSize = 15 }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.key}
      pageSize={pageSize}
      empty="No linked accounts found."
      columns={[
        { key: 'risk', label: 'Risk', render: (r) => <Badge tone={riskTone(r.risk)}>{r.risk}</Badge> },
        { key: 'label', label: 'Why they look linked', render: (r) => <span className="text-zinc-300">{r.label}</span> },
        { key: 'evidence', label: 'Evidence', sortable: false, render: (r) => <span className="font-mono text-xs text-zinc-400">{r.evidence || '—'}</span> },
        {
          key: 'accounts',
          label: 'Accounts',
          sortValue: (r) => r.accounts.length,
          render: (r) => (
            <div className="flex max-w-md flex-wrap gap-x-2 gap-y-0.5 text-sm">
              {r.accounts.slice(0, 8).map((a) => <PlayerLink key={a.id || a.username} name={a.username} dead={a.is_dead} />)}
              {r.accounts.length > 8 && <span className="text-zinc-500">+{r.accounts.length - 8} more</span>}
            </div>
          ),
        },
        {
          key: 'compare',
          label: '',
          sortable: false,
          render: (r) => (r.accounts.length >= 2 ? (
            <Link
              to={`${ADMIN_BASE}/account-compare?a=${encodeURIComponent(r.accounts[0].username)}&b=${encodeURIComponent(r.accounts[1].username)}`}
              className="text-xs text-zinc-400 hover:text-zinc-100"
            >
              Compare
            </Link>
          ) : null),
        },
      ]}
    />
  );
}

function OverviewTab({ goTo }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const [summary, bans, ipBans, logins, dupes] = await Promise.allSettled([
      api.get('/admin/security/summary', { params: { limit: 50 } }),
      api.get('/admin/security/bans'),
      api.get('/admin/security/ip-bans'),
      api.get('/admin/cheat-detection/login-attempts', { params: { limit: 500 } }),
      api.get('/admin/cheat-detection/dupe-check-intelligent', { params: { check_vpn: false } }),
    ]);
    const ok = (r) => (r.status === 'fulfilled' ? r.value.data : null);
    if ([summary, bans, ipBans, logins, dupes].every((r) => r.status === 'rejected')) {
      setState({ loading: false, data: null, error: errText(summary.reason, 'Could not load safety data') });
      return;
    }
    setState({
      loading: false,
      error: null,
      data: { summary: ok(summary), bans: ok(bans)?.bans, ipBans: ok(ipBans)?.ip_bans, logins: ok(logins)?.events, links: normalizeGroups(ok(dupes)) },
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state.loading && !state.data) return <LoadingBlock />;
  if (state.error) return <ErrorBlock message={state.error} onRetry={load} />;
  const d = state.data;
  const dayAgo = Date.now() - 86400000;
  const logins24h = (d.logins || []).filter((e) => Date.parse(e.at) >= dayAgo).length;
  const highLinks = d.links.filter((l) => l.risk >= HIGH_RISK);
  const na = (v) => (v == null ? '—' : fmtNum(v));
  return (
    <div className="space-y-4">
      <KpiGrid cols={3}>
        <KpiTile label="High-risk account links" value={fmtNum(highLinks.length)} hint={`${fmtNum(d.links.length)} links in total`} tone={highLinks.length ? 'warn' : 'default'} />
        <KpiTile label="Open security flags" value={na(d.summary?.total_flags)} hint={d.summary ? `${fmtNum(d.summary.unique_users_flagged)} players flagged` : 'Admin only'} />
        <KpiTile label="Suspicious logins (24h)" value={d.logins ? fmtNum(logins24h) : '—'} hint={d.logins ? `${fmtNum(d.logins.length)} recent in total` : undefined} />
        <KpiTile label="Banned accounts" value={na(d.bans?.length)} hint={d.bans ? undefined : 'Admin only'} />
        <KpiTile label="Banned IPs" value={na(d.ipBans?.length)} hint={d.ipBans?.length >= 100 ? 'Showing first 100' : undefined} />
        <KpiTile label="Alive on dead accounts' IPs" value={fmtNum(d.links.filter((l) => l.kind === 'alive_dead_ip_groups').length)} hint="Possible returning players or dupes" />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Highest-risk account links"
          subtitle="Accounts sharing IPs, devices, emails or heavy transfers"
          actions={<Button size="sm" onClick={() => goTo('multi')}>See all</Button>}
          padded={false}
        >
          <LinksTable rows={d.links.slice(0, 10)} pageSize={10} />
        </Card>
        <Card title="Flagged players" subtitle="From the exploit and wealth checks" padded={false}>
          <DataTable
            rows={d.summary?.top_offenders || []}
            pageSize={10}
            empty={d.summary ? 'No open flags.' : 'Admin only.'}
            columns={[
              { key: 'username', label: 'Player', render: (r) => <PlayerLink name={r.username} /> },
              { key: 'flag_types', label: 'Flags', sortable: false, render: (r) => <span className="text-xs text-zinc-400">{(r.flag_types || []).join(', ').replace(/_/g, ' ')}</span> },
              { key: 'flag_count', label: 'Count', align: 'right', render: (r) => fmtNum(r.flag_count) },
            ]}
          />
        </Card>
      </div>
      <Card title="Other safety tools">
        <div className="flex flex-wrap gap-2">
          <Link to={`${ADMIN_BASE}/users-online`}><Button size="sm" icon={ExternalLink}>Who's online now (live dupe screen)</Button></Link>
          <Link to={`${ADMIN_BASE}/ip-history`}><Button size="sm" icon={ExternalLink}>Account access report</Button></Link>
          <Link to={`${ADMIN_BASE}/account-compare`}><Button size="sm" icon={ExternalLink}>Compare two accounts</Button></Link>
          <Link to={`${ADMIN_BASE}/attack-logs`}><Button size="sm" icon={ExternalLink}>Attack logs</Button></Link>
          <Link to={`${ADMIN_BASE}/safety`}><Button size="sm" icon={ExternalLink}>Bot investigation & Cloudflare (classic)</Button></Link>
        </div>
      </Card>
    </div>
  );
}

function ProxyFarmCard({ username }) {
  const [state, setState] = useState({ loading: false, data: null });
  useEffect(() => { setState({ loading: false, data: null }); }, [username]);
  const run = async () => {
    setState({ loading: true, data: null });
    try {
      const { data } = await api.get('/admin/cheat-detection/proxy-farm', { params: { username } });
      setState({ loading: false, data });
    } catch (e) {
      toast.error(errText(e, 'Proxy check failed'));
      setState({ loading: false, data: null });
    }
  };
  const d = state.data;
  return (
    <Card
      title="Proxy farm check"
      subtitle="Looks up every IP this player used. Slow: about 30 seconds."
      actions={<Button size="sm" loading={state.loading} onClick={run}>{d ? 'Run again' : 'Run check'}</Button>}
    >
      {state.loading ? <LoadingBlock label="Checking IPs…" /> : !d ? (
        <p className="text-sm text-zinc-500">Not run yet.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {d.likely_proxy_farm ? <Badge tone="bad">Likely proxy farm</Badge> : <Badge tone="good">No proxy farm pattern</Badge>}
            <Badge tone={riskTone(d.combined_risk_score)}>Risk {d.combined_risk_score ?? 0}</Badge>
            {d.worst_ip_verdict && <Badge>Worst IP: {String(d.worst_ip_verdict).replace(/_/g, ' ')}</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div><dt className="text-xs text-zinc-500">Linked accounts</dt><dd className="tabular-nums">{fmtNum(d.linked_account_count)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Countries</dt><dd className="tabular-nums">{fmtNum(d.countries?.by_country?.length)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Network neighbours</dt><dd className="tabular-nums">{fmtNum(d.subnet_peer_count)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Points received in cluster</dt><dd className="tabular-nums">{fmtNum(d.seed_points_summary?.points_received_in_cluster)}</dd></div>
          </dl>
          {Array.isArray(d.linked_accounts) && d.linked_accounts.length > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {d.linked_accounts.slice(0, 30).map((a) => <PlayerLink key={a.id || a.username} name={a.username} dead={a.is_dead} />)}
            </div>
          )}
          {d.note && <p className="text-xs text-zinc-500">{d.note}</p>}
        </div>
      )}
    </Card>
  );
}

function MultiTab({ initialUser, onUserChange }) {
  const [query, setQuery] = useState(initialUser || '');
  const [player, setPlayer] = useState(initialUser || '');
  const [checkVpn, setCheckVpn] = useState('no');
  const [minRisk, setMinRisk] = useState('all');
  const [kind, setKind] = useState('');
  const [state, setState] = useState({ loading: false, data: null, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const params = { check_vpn: checkVpn === 'yes' };
      if (player) params.username = player;
      const { data } = await api.get('/admin/cheat-detection/dupe-check-intelligent', { params });
      setState({ loading: false, data: normalizeGroups(data), error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: errText(e, 'Scan failed') });
    }
  }, [player, checkVpn]);

  useEffect(() => { load(); }, [load]);

  const submit = () => {
    const v = query.trim();
    setPlayer(v);
    onUserChange(v);
  };

  const kinds = useMemo(() => {
    const seen = new Map();
    (state.data || []).forEach((r) => seen.set(r.kind, (seen.get(r.kind) || 0) + 1));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [state.data]);

  const rows = (state.data || []).filter((r) => (minRisk === 'high' ? r.risk >= HIGH_RISK : true) && (!kind || r.kind === kind));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full gap-2 lg:w-96">
            <TextInput value={query} onChange={setQuery} onEnter={submit} placeholder="Player (leave empty to scan everyone)" className="flex-1" />
            <Button variant="primary" icon={Search} onClick={submit}>Scan</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>VPN check</span>
            <Segmented size="sm" value={checkVpn} onChange={setCheckVpn} options={[{ value: 'no', label: 'Off' }, { value: 'yes', label: 'On (slower)' }]} />
            <Segmented size="sm" value={minRisk} onChange={setMinRisk} options={[{ value: 'all', label: 'All' }, { value: 'high', label: `High risk (${HIGH_RISK}+)` }]} />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="h-7 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200 focus:outline-none"
            >
              <option value="">All reasons</option>
              {kinds.map(([k, n]) => <option key={k} value={k}>{GROUP_KINDS[k]} ({n})</option>)}
            </select>
          </div>
        </div>
      </Card>
      <Card
        title={player ? `Accounts linked to ${player}` : 'Linked accounts across the game'}
        subtitle="Shared IPs, networks, devices, emails, sign-ups and transfers in one list. Dead accounts are struck through."
        actions={<Button size="sm" icon={RefreshCw} loading={state.loading} onClick={load}>Refresh</Button>}
        padded={false}
      >
        {state.error ? <div className="p-4"><ErrorBlock message={state.error} onRetry={load} /></div>
          : state.loading && !state.data ? <LoadingBlock label="Scanning…" />
            : <LinksTable rows={rows} />}
      </Card>
      {player && <ProxyFarmCard username={player} />}
    </div>
  );
}

function BansTab({ prefill }) {
  const [state, setState] = useState({ loading: true, bans: [], ipBans: [], error: null });
  const [mode, setMode] = useState('ip');
  const [target, setTarget] = useState(prefill || '');
  const [unit, setUnit] = useState('permanent');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoreName, setRestoreName] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [a, b] = await Promise.all([api.get('/admin/security/bans'), api.get('/admin/security/ip-bans')]);
      setState({ loading: false, bans: a.data?.bans || [], ipBans: b.data?.ip_bans || [], error: null });
    } catch (e) {
      setState({ loading: false, bans: [], ipBans: [], error: errText(e, 'Could not load bans') });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (prefill) setTarget(prefill); }, [prefill]);
  useEffect(() => { setConfirming(false); }, [mode, target, unit, amount, reason]);

  const valid = target.trim() && reason.trim().length >= 3 && (unit === 'permanent' || Number(amount) >= 1);

  const submitBan = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const body = { reason: reason.trim(), duration_unit: unit };
      if (unit !== 'permanent') body.duration_amount = parseInt(amount, 10);
      if (mode === 'ip') body.ip = target.trim();
      else body.username = target.trim();
      const { data } = await api.post('/admin/security/ban-ip', body);
      toast.success(data?.message || 'Ban applied');
      setTarget('');
      setReason('');
      load();
    } catch (e) {
      toast.error(errText(e, 'Ban failed'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const unbanAccount = async (row) => {
    if (!window.confirm(`Unban ${row.username}'s account?`)) return;
    try {
      const { data } = await api.post('/admin/security/unban', { user_id: row.user_id });
      toast.success(data?.message || 'Unbanned');
      load();
    } catch (e) {
      toast.error(errText(e, 'Unban failed'));
    }
  };

  const unbanIp = async (ip) => {
    if (!window.confirm(`Unban IP ${ip}?`)) return;
    try {
      const { data } = await api.post('/admin/security/unban-ip', { ip });
      toast.success(data?.message || 'IP unbanned');
      load();
    } catch (e) {
      toast.error(errText(e, 'Unban failed'));
    }
  };

  const restoreLogin = async () => {
    const name = restoreName.trim();
    if (!name) return;
    if (!window.confirm(`Restore login for ${name}? This unbans the account, removes IP bans linked to it, and clears any login lockout. Stats wiped by the ban are not restored.`)) return;
    setBusy(true);
    const steps = [];
    try {
      const { data: found } = await api.get('/admin/users/search', { params: { q: name, limit: 40 } });
      const users = found?.users || [];
      const user = users.find((u) => (u.username || '').toLowerCase() === name.toLowerCase()) || (users.length === 1 ? users[0] : null);
      if (!user) throw new Error(users.length ? 'Several players match — type the exact username' : 'Player not found');
      const attempt = async (label, fn) => {
        try {
          await fn();
          steps.push(label);
        } catch (e) {
          if (e?.response?.status !== 404) throw e;
        }
      };
      await attempt('account unbanned', () => api.post('/admin/security/unban', { user_id: user.id }));
      await attempt('IP bans removed', () => api.post('/admin/security/unban-ip', { username: user.username }));
      await attempt('lockout cleared', () => api.post('/admin/clear-login-lockout', null, { params: { target_username: user.username } }));
      toast.success(`${user.username}: ${steps.length ? steps.join(', ') : 'nothing to restore'}`);
      setRestoreName('');
      load();
    } catch (e) {
      toast.error(e?.response ? errText(e, 'Restore failed') : e.message);
    } finally {
      setBusy(false);
    }
  };

  const durationText = unit === 'permanent' ? 'permanently' : `for ${amount} ${unit}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ban" subtitle="Admin only. A reason is required and is shown on the ban list.">
          <div className="grid gap-3">
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[{ value: 'ip', label: 'One IP address' }, { value: 'player', label: 'Whole player (account + all their IPs)' }]}
            />
            <TextInput value={target} onChange={setTarget} placeholder={mode === 'ip' ? 'IP address' : 'Username'} />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-200 focus:outline-none"
              >
                {BAN_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
              {unit !== 'permanent' && (
                <TextInput value={amount} onChange={(v) => setAmount(v.replace(/[^\d]/g, ''))} inputMode="numeric" className="w-24" />
              )}
            </div>
            <TextInput value={reason} onChange={setReason} placeholder="Reason (required)" maxLength={300} />
            {mode === 'player' && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-200">
                Banning a whole player bans their account and every IP they have used, ends their sessions, and wipes their stats and leaderboard entries. Unbanning later does not bring the stats back.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="danger" disabled={!valid} loading={busy} onClick={submitBan}>
                {confirming ? `Confirm: ban ${target.trim()} ${durationText}` : mode === 'ip' ? 'Ban IP' : 'Ban player'}
              </Button>
              {confirming && <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>}
            </div>
          </div>
        </Card>
        <Card title="Restore login" subtitle="For a player who was banned or locked out by mistake.">
          <div className="grid gap-3">
            <TextInput value={restoreName} onChange={setRestoreName} onEnter={restoreLogin} placeholder="Username" />
            <div>
              <Button disabled={!restoreName.trim()} loading={busy} onClick={restoreLogin}>Restore login</Button>
            </div>
            <p className="text-xs text-zinc-500">Unbans the account, removes the IP bans that came from banning that player, and clears failed-login lockouts.</p>
          </div>
        </Card>
      </div>
      {state.error ? <ErrorBlock message={state.error} onRetry={load} /> : (
        <>
          <Card title={`Banned accounts (${fmtNum(state.bans.length)})`} actions={<Button size="sm" icon={RefreshCw} loading={state.loading} onClick={load}>Refresh</Button>} padded={false}>
            <DataTable
              rows={state.bans}
              pageSize={15}
              empty="No banned accounts."
              columns={[
                { key: 'username', label: 'Player', render: (r) => <PlayerLink name={r.username} /> },
                { key: 'reason', label: 'Reason', render: (r) => <span className="text-zinc-300">{r.reason}</span> },
                { key: 'banned_by', label: 'By' },
                { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at || '' },
                { key: 'expires_at', label: 'Ends', render: (r) => (r.expires_at ? fmtDateTime(r.expires_at) : 'Never') },
                { key: 'unban', label: '', sortable: false, render: (r) => <Button size="sm" variant="ghost" onClick={() => unbanAccount(r)}>Unban</Button> },
              ]}
            />
          </Card>
          <Card title={`Banned IPs (${fmtNum(state.ipBans.length)}${state.ipBans.length >= 100 ? '+' : ''})`} subtitle="Newest first" padded={false}>
            <DataTable
              rows={state.ipBans}
              pageSize={20}
              empty="No banned IPs."
              columns={[
                { key: 'ip', label: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip}</span> },
                { key: 'source_username', label: 'From player', render: (r) => (r.source_username ? <PlayerLink name={r.source_username} /> : '—') },
                { key: 'reason', label: 'Reason', render: (r) => <span className="text-zinc-300">{r.reason}</span> },
                { key: 'duration_label', label: 'Length', render: (r) => r.duration_label || (r.expires_at ? 'timed' : 'permanent') },
                { key: 'banned_by', label: 'By' },
                { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at || '' },
                { key: 'unban', label: '', sortable: false, render: (r) => <Button size="sm" variant="ghost" onClick={() => unbanIp(r.ip)}>Unban</Button> },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function IpTab({ initialIp, onIpChange, onBanIp }) {
  const [query, setQuery] = useState(initialIp || '');
  const [state, setState] = useState({ loading: false, lookup: null, accounts: null, error: null });

  const run = useCallback(async (ipRaw) => {
    const ip = (ipRaw || '').trim();
    if (!ip) return;
    setState({ loading: true, lookup: null, accounts: null, error: null });
    const [lookup, accounts] = await Promise.allSettled([
      api.get('/admin/investigate/ip-lookup', { params: { ip } }),
      api.get('/admin/investigate/accounts-by-ip', { params: { ip } }),
    ]);
    if (lookup.status === 'rejected' && accounts.status === 'rejected') {
      setState({ loading: false, lookup: null, accounts: null, error: errText(lookup.reason, 'Lookup failed') });
      return;
    }
    setState({
      loading: false,
      error: null,
      lookup: lookup.status === 'fulfilled' ? lookup.value.data : null,
      accounts: accounts.status === 'fulfilled' ? accounts.value.data : null,
    });
  }, []);

  useEffect(() => {
    if (initialIp) {
      setQuery(initialIp);
      run(initialIp);
    }
  }, [initialIp, run]);

  const submit = () => {
    const v = query.trim();
    if (v === (initialIp || '')) run(v);
    else onIpChange(v);
  };

  const a = state.lookup?.game_assessment;
  const api1 = state.lookup?.ip_api || {};
  const api2 = state.lookup?.ipapi_is || {};
  const flags = [
    (api1.proxy || api2.is_proxy) && 'Proxy',
    api2.is_vpn && 'VPN',
    api2.is_tor && 'Tor',
    (api1.hosting || api2.is_datacenter) && 'Hosting / datacenter',
    (api1.mobile || api2.is_mobile) && 'Mobile network',
    api2.is_abuser && 'Known abuser',
    state.lookup?.known_proxy_asn && 'Known proxy provider',
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex w-full gap-2 sm:w-96">
          <TextInput value={query} onChange={setQuery} onEnter={submit} placeholder="IP address" className="flex-1 font-mono" />
          <Button variant="primary" icon={Search} loading={state.loading} onClick={submit}>Look up</Button>
        </div>
      </Card>
      {state.error && <ErrorBlock message={state.error} />}
      {state.loading && <LoadingBlock label="Looking up…" />}
      {(state.lookup || state.accounts) && !state.loading && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card
            title={state.lookup?.ip || state.accounts?.ip || query}
            subtitle="Network and proxy checks"
            actions={<Button size="sm" variant="danger" onClick={() => onBanIp(state.lookup?.ip || query.trim())}>Ban this IP</Button>}
          >
            {a ? (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={a.verdict === 'clean' ? 'good' : riskTone(Math.max(a.risk_score || 0, 45))}>{String(a.verdict || '?').replace(/_/g, ' ')}</Badge>
                  <Badge tone={riskTone(a.risk_score)}>Risk {a.risk_score ?? 0}</Badge>
                  {a.block_signup && <Badge tone="bad">Sign-ups blocked</Badge>}
                  {a.block_auth && <Badge tone="bad">Logins blocked</Badge>}
                  {flags.map((f) => <Badge key={f} tone="warn">{f}</Badge>)}
                </div>
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-2"><dt className="text-zinc-400">Location</dt><dd className="truncate">{[api1.city, a.country].filter(Boolean).join(', ') || '—'}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-zinc-400">Provider</dt><dd className="truncate">{a.isp || api1.isp || '—'}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-zinc-400">Network (ASN)</dt><dd className="truncate">{api1.as || '—'}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-zinc-400">Alive accounts on this /24</dt><dd className="tabular-nums">{fmtNum(state.lookup.subnet24_alive_accounts)}</dd></div>
                </dl>
                {Array.isArray(a.reasons) && a.reasons.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-zinc-400">{a.reasons.map((r) => <li key={r}>{String(r).replace(/_/g, ' ')}</li>)}</ul>
                )}
              </div>
            ) : <EmptyState>Network check unavailable.</EmptyState>}
          </Card>
          <Card className="lg:col-span-2" title={`Accounts that used this IP (${fmtNum(state.accounts?.accounts?.length)})`} padded={false}>
            <DataTable
              rows={state.accounts?.accounts || []}
              pageSize={15}
              empty="No accounts have used this IP."
              columns={[
                { key: 'username', label: 'Player', render: (r) => <PlayerLink name={r.username} dead={r.is_dead} /> },
                { key: 'roles', label: 'Seen as', sortable: false, render: (r) => <span className="text-xs text-zinc-400">{(r.roles || []).join(', ').replace(/_/g, ' ')}</span> },
                { key: 'created_at', label: 'Joined', render: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at || '' },
                { key: 'is_dead', label: 'Status', render: (r) => (r.is_dead ? <Badge tone="bad">Dead</Badge> : r.is_dead === false ? <Badge tone="good">Alive</Badge> : '—') },
              ]}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

function LoginsTab({ onIp }) {
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get('/admin/cheat-detection/login-attempts', { params: { limit: 500 } });
      setState({ loading: false, rows: data?.events || [], error: null });
    } catch (e) {
      setState({ loading: false, rows: [], error: errText(e, 'Could not load login attempts') });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = filter.trim().toLowerCase();
  const rows = q ? state.rows.filter((r) => `${r.ip} ${r.login_input} ${r.reason}`.toLowerCase().includes(q)) : state.rows;
  return (
    <Card
      title="Suspicious login attempts"
      subtitle="Wrong password or unknown account, from an IP that already has another live account."
      actions={(
        <>
          <TextInput value={filter} onChange={setFilter} placeholder="Filter by IP, name or reason" className="h-7 w-56 text-xs" />
          <Button size="sm" icon={RefreshCw} loading={state.loading} onClick={load}>Refresh</Button>
        </>
      )}
      padded={false}
    >
      {state.error ? <div className="p-4"><ErrorBlock message={state.error} onRetry={load} /></div>
        : state.loading && !state.rows.length ? <LoadingBlock />
          : (
            <DataTable
              rows={rows}
              pageSize={25}
              empty="No suspicious logins."
              columns={[
                { key: 'at', label: 'When', render: (r) => fmtDateTime(r.at), sortValue: (r) => r.at || '' },
                { key: 'login_input', label: 'Tried to log in as', render: (r) => <span className="text-zinc-300">{String(r.login_input || '').slice(0, 40)}</span> },
                { key: 'ip', label: 'IP', render: (r) => <button type="button" onClick={() => onIp(r.ip)} className="font-mono text-xs text-zinc-300 hover:text-zinc-50 hover:underline">{r.ip}</button> },
                { key: 'reason', label: 'Why flagged', render: (r) => <span className="text-xs text-zinc-400">{String(r.reason || '').replace(/_/g, ' ')}</span> },
                { key: 'same_ip_alive_count', label: 'Live accounts on IP', align: 'right', render: (r) => fmtNum(r.same_ip_alive_count) },
              ]}
            />
          )}
    </Card>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'multi', label: 'Multi-accounts' },
  { id: 'bans', label: 'Bans' },
  { id: 'ip', label: 'IP lookup' },
  { id: 'logins', label: 'Suspicious logins' },
];

export default function AdminSafety() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const user = searchParams.get('u') || '';
  const ip = searchParams.get('ip') || '';
  const [banPrefill, setBanPrefill] = useState('');

  const update = (patch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      return next;
    });
  };

  return (
    <AdminPage title="Safety centre" subtitle="Multi-accounts, bans, IPs and suspicious logins in one place." icon={ShieldCheck}>
      <Tabs tabs={TABS} value={tab} onChange={(id) => update({ tab: id })} />
      {tab === 'overview' && <OverviewTab goTo={(id) => update({ tab: id })} />}
      {tab === 'multi' && <MultiTab initialUser={user} onUserChange={(v) => update({ u: v })} />}
      {tab === 'bans' && <BansTab prefill={banPrefill} />}
      {tab === 'ip' && (
        <IpTab
          initialIp={ip}
          onIpChange={(v) => update({ ip: v })}
          onBanIp={(v) => { setBanPrefill(v); update({ tab: 'bans' }); }}
        />
      )}
      {tab === 'logins' && <LoginsTab onIp={(v) => update({ tab: 'ip', ip: v })} />}
    </AdminPage>
  );
}
