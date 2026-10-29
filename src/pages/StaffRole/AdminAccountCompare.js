import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, EyeOff, Fingerprint, Link2, Search } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import StaffIpReputationCard, { maskIp } from '../../components/StaffIpReputationCard';
import {
  AdminPage, Badge, Button, Card, DataTable, EmptyState, KpiGrid, KpiTile, LoadingBlock, TextInput, ToggleButton,
  fmtNum, inputClass, touchClass,
} from './kit/AdminKit';

function fmtMoney(n) {
  return `$${fmtNum(n)}`;
}

function safeVal(v) {
  return v === null || v === undefined || v === '' ? '—' : v;
}

function maskEmail(email) {
  if (!email) return '—';
  const em = String(email).trim();
  if (!em.includes('@')) return '••••••••';
  if (em.startsWith('dead_') && em.endsWith('@deleted')) return 'freed / tomb address';
  const [local, domain] = em.split('@');
  if (!local || !domain) return '••••••••';
  const head = local[0] || '';
  const tail = local.length > 1 ? local.slice(-1) : '';
  const mid = '*'.repeat(Math.min(Math.max(local.length - 2, 1), 6));
  return `${head}${mid}${tail}@${domain}`;
}

/** Shows the first and last 4 characters only; used for user ids and device fingerprints. */
function maskMiddle(value) {
  if (!value) return '—';
  const s = String(value);
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function displayEmail(email, blurSensitive) {
  return blurSensitive ? maskEmail(email) : safeVal(email);
}

function displayUserId(id, blurSensitive) {
  return blurSensitive ? maskMiddle(id) : safeVal(id);
}

function displayFingerprint(fp, blurSensitive) {
  return blurSensitive ? maskMiddle(fp) : safeVal(fp);
}

function userLabel(user) {
  if (!user) return '—';
  return `${user.username || '?'} (${user.id || 'no id'})`;
}

function severityClass(sev) {
  if (sev === 'critical') return 'border-rose-500/40 bg-rose-500/5';
  if (sev === 'warn') return 'border-amber-500/40 bg-amber-500/5';
  return 'border-zinc-800 bg-zinc-950/40';
}

const ACCOUNT_A_STYLE = {
  border: 'border-sky-500/30 bg-sky-500/5',
  dot: 'bg-sky-400',
  text: 'text-sky-200',
};

const ACCOUNT_B_STYLE = {
  border: 'border-amber-500/30 bg-amber-500/5',
  dot: 'bg-amber-400',
  text: 'text-amber-200',
};

const IP_SOURCE_LABELS = {
  registration: 'Registered from this IP',
  last_login: 'Last login from this IP',
  last_request: 'Last request from this IP',
  login_ips: 'Saved login IP',
  login_history: 'Login history',
  session: 'Session IP',
  attack_attacker: 'Attacked someone from this IP',
  attack_target: 'Was attacked on this IP',
};

function accountSideStyle(side) {
  return side === 'a' ? ACCOUNT_A_STYLE : ACCOUNT_B_STYLE;
}

function accountSideLabel(side, user) {
  const name = user?.username || (side === 'a' ? 'Account A' : 'Account B');
  return side === 'a' ? `Account A — ${name}` : `Account B — ${name}`;
}

function formatIpSources(sources) {
  return (sources || []).map((source) => IP_SOURCE_LABELS[source] || source.replace(/_/g, ' '));
}

const RELATION_LABELS = {
  primary: 'Primary account',
  replacement_registration: 'Registered on freed email',
  prior_dead_account: 'Prior dead account',
  dead_account: 'Dead account',
  same_email_chain: 'Same email chain',
  prior_email_on_chain: 'Prior email on chain',
  linked_account: 'Linked account',
};

function SideName({ side, name }) {
  const style = accountSideStyle(side);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-sm font-medium ${style.text}`}>
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
      <span className="truncate">{name}</span>
    </span>
  );
}

function SideLegend({ userA, userB }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SideName side="a" name={userA?.username || 'Account A'} />
      <SideName side="b" name={userB?.username || 'Account B'} />
    </div>
  );
}

function AccountCard({ side, user, blurSensitive }) {
  if (!user) return null;
  const style = accountSideStyle(side);
  const item = (label, value, cls = 'text-zinc-100') => (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`break-all ${cls}`}>{value}</dd>
    </div>
  );
  return (
    <section className={`min-w-0 rounded-xl border p-4 ${style.border}`}>
      <SideName side={side} name={accountSideLabel(side, user)} />
      <div className="mt-2 truncate text-lg font-semibold text-zinc-50">{user.username}</div>
      <div className="break-all font-mono text-xs text-zinc-500">{displayUserId(user.id, blurSensitive)}</div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        {item('Email', displayEmail(user.email, blurSensitive))}
        {item('Created', formatAdminDateTime(user.created_at))}
        {item('Registration IP', blurSensitive ? maskIp(user.registration_ip) : safeVal(user.registration_ip), 'font-mono text-xs text-zinc-100')}
        {item('Last login IP', blurSensitive ? maskIp(user.last_login_ip) : safeVal(user.last_login_ip), 'font-mono text-xs text-zinc-100')}
        {item('Device', safeVal(user.last_device_type))}
        {item('Sessions', fmtNum(user.sessions_count))}
      </dl>
    </section>
  );
}

function SummaryCards({ summary, userA, userB }) {
  if (!summary) return null;
  const dir = `${userA?.username || 'A'} → ${userB?.username || 'B'}`;
  return (
    <KpiGrid cols={6}>
      <KpiTile label="Shared IPs" value={fmtNum(summary.shared_ip_count)} hint={summary.shared_registration_ip ? 'Registration IP matches' : 'Exact address overlap'} tone={summary.shared_ip_count ? 'warn' : 'default'} />
      <KpiTile label="Shared ISPs" value={fmtNum(summary.shared_isp_count)} hint="Same provider, even on different IPs" />
      <KpiTile label="Possible links" value={fmtNum(summary.account_link_count)} hint="Family, referral, kills, transfers" />
      <KpiTile label="Cash moved" value={fmtMoney(summary.cash_moved_total)} hint={`${fmtMoney(summary.cash_by_direction?.a_to_b)} ${dir}`} />
      <KpiTile label="Points moved" value={fmtNum(summary.points_moved_total)} hint={`${fmtNum(summary.points_by_direction?.a_to_b)} ${dir}`} />
      <KpiTile label="Quick Trade rows" value={fmtNum(summary.quicktrade_transfer_count)} hint="Cash/points rows marked as QT" />
    </KpiGrid>
  );
}

function PossibleLinksSection({ links }) {
  if (!links?.length) {
    return <EmptyState>No direct relationship signals found between these accounts in the selected window.</EmptyState>;
  }
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {links.map((link, idx) => (
        <div key={`${link.code}-${idx}`} className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${severityClass(link.severity)}`}>
          <Link2 size={15} className="mt-0.5 shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <div className="font-medium text-zinc-100">{link.title || link.code}</div>
            <div className="mt-0.5 leading-snug text-zinc-400">{link.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderIpList({ ips, blurSensitive, style }) {
  if (!ips?.length) return <span className="text-zinc-500">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ips.map((ip) => (
        <span key={ip} className={`rounded-md border px-1.5 py-0.5 font-mono text-xs ${style.border} ${style.text}`}>
          {blurSensitive ? maskIp(ip) : ip}
        </span>
      ))}
    </div>
  );
}

function Notice({ children }) {
  return <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">{children}</p>;
}

function SharedProvidersSection({ data, blurSensitive, userA, userB }) {
  const isps = data?.shared_isps || [];
  const asns = data?.shared_asns || [];
  if (!isps.length && !asns.length) {
    return <EmptyState>No shared internet provider or ASN overlap found from the looked-up IP history.</EmptyState>;
  }

  const renderRow = (row, idx) => {
    const label = row.isp || row.asname || row.as_field || 'Unknown provider';
    const badges = [];
    if (row.same_exact_ip) badges.push('Same IP');
    else if (row.different_ips_same_provider) badges.push('Different IPs, same provider');
    if (row.mobile) badges.push('Mobile');
    if (row.hosting) badges.push('Hosting');
    if (row.proxy) badges.push('Proxy/VPN');

    return (
      <div key={`${label}-${idx}`} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-100">{label}</div>
            {row.as_field ? <div className="mt-0.5 text-xs text-zinc-500">{row.as_field}{row.asname ? ` · ${row.asname}` : ''}</div> : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {badges.map((badge) => <Badge key={badge} tone={badge === 'Same IP' ? 'warn' : 'info'}>{badge}</Badge>)}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {[['a', userA, row.user_a_ips], ['b', userB, row.user_b_ips]].map(([side, user, ips]) => (
            <div key={side} className={`rounded-lg border px-2.5 py-2 ${accountSideStyle(side).border}`}>
              <div className={`mb-1 text-xs font-medium ${accountSideStyle(side).text}`}>{user?.username || (side === 'a' ? 'Account A' : 'Account B')}</div>
              <ProviderIpList ips={ips} blurSensitive={blurSensitive} style={accountSideStyle(side)} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {data?.lookup_truncated ? (
        <Notice>Provider lookup capped at {fmtNum(data.lookups_performed)} IP(s). Some provider overlap may be missing.</Notice>
      ) : null}
      {isps.length ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-zinc-400">Shared internet providers (ISP)</div>
          {isps.map(renderRow)}
        </div>
      ) : null}
      {asns.length ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-zinc-400">Shared carrier / ASN networks</div>
          {asns.map(renderRow)}
        </div>
      ) : null}
    </div>
  );
}

function SharedIpSection({ rows, blurSensitive, truncated, userA, userB }) {
  if (!rows?.length) {
    return <EmptyState>No shared IPs found.</EmptyState>;
  }

  const renderAccountEvidence = (side, user, sources) => {
    const style = accountSideStyle(side);
    const labels = formatIpSources(sources);
    return (
      <div className={`rounded-lg border px-2.5 py-2 ${style.border}`}>
        <SideName side={side} name={user?.username || (side === 'a' ? 'Account A' : 'Account B')} />
        {labels.length ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-snug text-zinc-400">
            {labels.map((label) => <li key={label}>{label}</li>)}
          </ul>
        ) : (
          <div className="mt-1 text-xs text-zinc-500">No linked activity on this IP</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {truncated ? <Notice>Shared IP list was capped for geodata lookups. Narrow the window if needed.</Notice> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <div key={row.ip} className="space-y-2">
            <StaffIpReputationCard ip={row.ip} geo={row} blurIp={blurSensitive} compact />
            <div className="grid gap-2 sm:grid-cols-2">
              {renderAccountEvidence('a', userA, row.user_a_sources)}
              {renderAccountEvidence('b', userB, row.user_b_sources)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DevicesSection({ data, userA, userB, blurSensitive }) {
  if (!data) return <EmptyState>No device data.</EmptyState>;
  return (
    <div className="grid gap-3 text-sm md:grid-cols-3">
      <div className={`rounded-lg border p-3 ${data.same_device_fingerprint ? 'border-rose-500/40 bg-rose-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
        <div className="flex items-center gap-1.5 text-xs text-zinc-400"><Fingerprint size={13} /> Fingerprint</div>
        <div className={`mt-1 font-medium ${data.same_device_fingerprint ? 'text-rose-200' : 'text-zinc-100'}`}>{data.same_device_fingerprint ? 'Exact match' : 'No exact match'}</div>
        <div className="mt-1 break-all font-mono text-xs text-zinc-500">{userA?.username || 'A'}: {displayFingerprint(data.device_fingerprint_a, blurSensitive)}</div>
        <div className="break-all font-mono text-xs text-zinc-500">{userB?.username || 'B'}: {displayFingerprint(data.device_fingerprint_b, blurSensitive)}</div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="text-xs text-zinc-400">Shared device types</div>
        <div className="mt-1 text-zinc-100">{(data.shared_device_types || []).join(', ') || '—'}</div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="text-xs text-zinc-400">Shared user agents</div>
        <div className="mt-1 text-zinc-100">{(data.shared_user_agents || []).length ? `${data.shared_user_agents.length} exact UA match(es)` : '—'}</div>
      </div>
    </div>
  );
}

function txAmount(r, kind) {
  if (kind === 'money') return fmtMoney(r.amount);
  if (kind === 'points') return `${fmtNum(r.amount)} pts`;
  if (kind === 'vault') {
    return [
      r.cash_delta ? fmtMoney(r.cash_delta) : null,
      r.points_delta ? `${fmtNum(r.points_delta)} pts` : null,
      r.bullets_delta ? `${fmtNum(r.bullets_delta)} bullets` : null,
      r.loot_delta ? `${fmtNum(r.loot_delta)} loot` : null,
    ].filter(Boolean).join(', ') || '—';
  }
  return r.car_name || r.car_id || r.user_car_id || r.event_type || '—';
}

function TransactionTable({ title, rows, kind, userA, userB }) {
  const directionTitle = `${userLabel(userA)} <-> ${userLabel(userB)}`;
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="text-sm font-medium text-zinc-100">{title}</div>
        <div className="text-xs text-zinc-500">{fmtNum(rows?.length || 0)} row(s)</div>
      </div>
      <DataTable
        rows={rows || []}
        rowKey={(r, idx) => r.id || `${kind}-${idx}`}
        pageSize={10}
        empty="No rows found."
        columns={[
          { key: 'created_at', label: 'When', sortValue: (r) => r.created_at || r.at || '', render: (r) => <span className="whitespace-nowrap text-zinc-400">{formatAdminDateTime(r.created_at || r.at)}</span> },
          { key: 'from', label: 'From', sortValue: (r) => r.from_username || r.actor_username || '', render: (r) => r.from_username || r.actor_username || r.from_user_id || r.actor_user_id || '—' },
          { key: 'to', label: 'To', sortValue: (r) => r.to_username || r.target_username || '', render: (r) => r.to_username || r.target_username || r.to_user_id || r.target_user_id || '—' },
          { key: 'amount', label: 'Amount / asset', align: 'right', sortValue: (r) => Number(r.amount ?? r.cash_delta ?? 0), render: (r) => <span className="font-medium" title={directionTitle}>{txAmount(r, kind)}</span> },
          { key: 'kind', label: 'Kind', sortable: false, render: (r) => <span className="text-zinc-400">{r.transfer_kind || r.transfer_type || r.kind || r.event_type || 'direct'}</span> },
        ]}
      />
    </div>
  );
}

function LineageClusterTable({ side, cluster, blurSensitive }) {
  const style = accountSideStyle(side);
  const rows = (cluster?.related_accounts || []).filter((r) => !r.is_primary);
  return (
    <div className="rounded-lg border border-zinc-800">
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        pageSize={10}
        empty="No prior or replacement accounts on this email chain."
        columns={[
          {
            key: 'username',
            label: 'Account',
            render: (r) => (
              <div>
                <div className={`font-medium ${style.text}`}>{r.username || '—'}</div>
                <div className="font-mono text-xs text-zinc-500">{displayUserId(r.id, blurSensitive)}</div>
              </div>
            ),
          },
          { key: 'relation', label: 'Relation', render: (r) => RELATION_LABELS[r.relation] || r.relation || '—' },
          {
            key: 'is_dead',
            label: 'Status',
            render: (r) => (
              <div className="space-y-0.5">
                {r.is_dead ? <Badge tone="bad">Dead</Badge> : <Badge tone="good">Alive</Badge>}
                {r.email_is_tomb ? <div className="text-xs text-zinc-500">Tomb email</div> : null}
              </div>
            ),
          },
          { key: 'created_at', label: 'Created', render: (r) => <span className="whitespace-nowrap">{formatAdminDateTime(r.created_at)}</span>, sortValue: (r) => r.created_at || '' },
          { key: 'profile_ip_count', label: 'IPs', align: 'right', render: (r) => fmtNum(r.profile_ip_count) },
        ]}
      />
    </div>
  );
}

function LineageMatchList({ title, rows, blurSensitive, emptyText }) {
  if (!rows?.length) {
    return emptyText ? <p className="text-sm text-zinc-500">{emptyText}</p> : null;
  }
  return (
    <div className="space-y-2">
      {title ? <div className="text-xs font-medium text-zinc-400">{title}</div> : null}
      <div className="grid gap-2">
        {rows.map((row, idx) => (
          <div key={`${row.account_a?.id}-${row.account_b?.id}-${idx}`} className={`rounded-lg border px-3 py-2 text-sm ${severityClass(row.severity)}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sky-200">{row.account_a?.username || '?'}</span>
              {row.account_a?.is_dead ? <span className="text-xs text-rose-300">(dead)</span> : null}
              <ArrowLeftRight size={13} className="text-zinc-500" />
              <span className="font-medium text-amber-200">{row.account_b?.username || '?'}</span>
              {row.account_b?.is_dead ? <span className="text-xs text-rose-300">(dead)</span> : null}
            </div>
            {row.same_device_fingerprint ? <div className="mt-1 text-rose-200">Same device fingerprint</div> : null}
            {row.shared_ip_count > 0 ? (
              <div className="mt-1 break-all font-mono text-xs text-zinc-300">
                {(row.shared_ips || []).slice(0, 4).map((ip) => (
                  <span key={ip} className="mr-2 inline-block">{blurSensitive ? maskIp(ip) : ip}</span>
                ))}
                {row.shared_ip_count > 4 ? <span className="text-zinc-500">+{row.shared_ip_count - 4} more</span> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmailLineageSection({ lineage, internalMatches, crossMatches, summary, userA, userB, blurSensitive }) {
  if (!lineage) return null;
  const hasPrior = (summary?.a_related_count || 0) > 0 || (summary?.b_related_count || 0) > 0;
  const hasSignals = (summary?.cross_match_count || 0) > 0
    || (summary?.internal_match_count_a || 0) > 0
    || (summary?.internal_match_count_b || 0) > 0;
  if (!hasPrior && !hasSignals) {
    return (
      <Card title="Related and prior accounts">
        <EmptyState>No prior or replacement accounts were found on either email chain.</EmptyState>
      </Card>
    );
  }
  return (
    <Card
      title="Related and prior accounts"
      subtitle="Includes dead accounts and replacements on the same email chain. Cross-side rows compare any related account on A against any on B."
      actions={(
        <span className="text-xs text-zinc-400">
          {summary?.a_related_count || 0} on {userA?.username || 'A'} · {summary?.b_related_count || 0} on {userB?.username || 'B'}
          {summary?.cross_match_count ? ` · ${summary.cross_match_count} cross-side signal(s)` : ''}
        </span>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <SideName side="a" name={`${userA?.username || 'Account A'} lineage`} />
            <LineageClusterTable side="a" cluster={lineage.a} blurSensitive={blurSensitive} />
          </div>
          <div className="min-w-0 space-y-2">
            <SideName side="b" name={`${userB?.username || 'Account B'} lineage`} />
            <LineageClusterTable side="b" cluster={lineage.b} blurSensitive={blurSensitive} />
          </div>
        </div>
        <LineageMatchList
          title={`Within ${userA?.username || 'A'}: prior accounts vs each other`}
          rows={internalMatches?.a}
          blurSensitive={blurSensitive}
          emptyText={null}
        />
        <LineageMatchList
          title={`Within ${userB?.username || 'B'}: prior accounts vs each other`}
          rows={internalMatches?.b}
          blurSensitive={blurSensitive}
          emptyText={null}
        />
        <LineageMatchList
          title="Cross-side: any related account on A vs any on B"
          rows={crossMatches}
          blurSensitive={blurSensitive}
          emptyText="No shared IP or fingerprint overlap between related accounts on opposite sides."
        />
      </div>
    </Card>
  );
}

export default function AdminAccountCompare() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(false);
  const [userA, setUserA] = useState(searchParams.get('a') || '');
  const [userB, setUserB] = useState(searchParams.get('b') || '');
  const [days, setDays] = useState(Number(searchParams.get('days') || 90));
  const [blurSensitive, setBlurSensitive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

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

  const loadCompare = useCallback(async () => {
    const a = userA.trim();
    const b = userB.trim();
    if (!a || !b) {
      toast.error('Enter both usernames or user ids');
      return;
    }
    setLoading(true);
    setReport(null);
    try {
      const windowDays = Math.max(1, Math.min(365, Number(days) || 90));
      const res = await api.get('/admin/investigate/account-compare', {
        params: { user_a: a, user_b: b, days: windowDays },
      });
      setReport(res.data || null);
      setSearchParams({ a, b, days: String(windowDays) });
      toast.success('Account comparison loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to compare accounts');
    } finally {
      setLoading(false);
    }
  }, [userA, userB, days, setSearchParams]);

  useEffect(() => {
    if (!accessChecked) return;
    const a = searchParams.get('a');
    const b = searchParams.get('b');
    if (a && b && !report && !loading) {
      loadCompare();
    }
  }, [accessChecked, searchParams, report, loading, loadCompare]);

  const userObjA = report?.users?.a;
  const userObjB = report?.users?.b;
  const tx = useMemo(() => report?.transactions || {}, [report?.transactions]);
  const hasReport = !!report;
  const totalTxRows = useMemo(() => (
    (tx.money_transfers?.length || 0)
    + (tx.points_transfers?.length || 0)
    + (tx.family_vault_transactions?.length || 0)
    + (tx.exclusive_car_events?.length || 0)
  ), [tx]);

  const pageProps = {
    title: 'Compare accounts',
    subtitle: 'Shared providers, IPs, device signals, prior email-chain accounts, and direct value movement between two accounts.',
    icon: ArrowLeftRight,
  };

  if (!accessChecked) {
    return <div data-testid="admin-account-compare-page"><AdminPage {...pageProps}><LoadingBlock label="Checking staff access…" /></AdminPage></div>;
  }

  return (
    <div data-testid="admin-account-compare-page">
      <AdminPage
        {...pageProps}
        actions={(
          <ToggleButton on={blurSensitive} icon={EyeOff} onClick={() => setBlurSensitive((v) => !v)}>
            {blurSensitive ? 'Sensitive data blurred' : 'Blur sensitive'}
          </ToggleButton>
        )}
      >
        <Card>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_140px_auto]">
            <TextInput value={userA} onChange={setUserA} onEnter={loadCompare} placeholder="Account A username or id" aria-label="Account A" />
            <TextInput value={userB} onChange={setUserB} onEnter={loadCompare} placeholder="Account B username or id" aria-label="Account B" />
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputClass} aria-label="Window">
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
            <Button variant="primary" icon={Search} loading={loading} onClick={loadCompare} className={touchClass}>Compare</Button>
          </div>
        </Card>

        {hasReport ? (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              <AccountCard side="a" user={userObjA} blurSensitive={blurSensitive} />
              <AccountCard side="b" user={userObjB} blurSensitive={blurSensitive} />
            </div>

            <SummaryCards summary={report.summary} userA={userObjA} userB={userObjB} />

            <EmailLineageSection
              lineage={report.lineage}
              internalMatches={report.lineage_internal_matches}
              crossMatches={report.lineage_cross_matches}
              summary={report.lineage_summary}
              userA={userObjA}
              userB={userObjB}
              blurSensitive={blurSensitive}
            />

            <Card title="Possible links between accounts">
              <PossibleLinksSection links={report.account_links || []} />
            </Card>

            <Card title="Shared internet providers" actions={<SideLegend userA={userObjA} userB={userObjB} />}>
              <SharedProvidersSection data={report.shared_network_providers} blurSensitive={blurSensitive} userA={userObjA} userB={userObjB} />
            </Card>

            <Card title="Shared IP evidence" actions={<SideLegend userA={userObjA} userB={userObjB} />}>
              <SharedIpSection rows={report.shared_ips || []} blurSensitive={blurSensitive} truncated={report.shared_ip_truncated} userA={userObjA} userB={userObjB} />
            </Card>

            <Card title="Shared device evidence">
              <DevicesSection data={report.shared_devices} userA={userObjA} userB={userObjB} blurSensitive={blurSensitive} />
            </Card>

            <Card title="Direct transactions" subtitle={`${fmtNum(totalTxRows)} total row(s) in ${report.window_days} day window`}>
              <div className="grid gap-3 xl:grid-cols-2">
                <TransactionTable title="Cash transfers" rows={tx.money_transfers || []} kind="money" userA={userObjA} userB={userObjB} />
                <TransactionTable title="Points transfers" rows={tx.points_transfers || []} kind="points" userA={userObjA} userB={userObjB} />
                <TransactionTable title="Family vault rows" rows={tx.family_vault_transactions || []} kind="vault" userA={userObjA} userB={userObjB} />
                <TransactionTable title="Exclusive car events" rows={tx.exclusive_car_events || []} kind="cars" userA={userObjA} userB={userObjB} />
              </div>
            </Card>

            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>This tool surfaces evidence only. Shared access or transfers do not automatically prove account ownership or cheating.</span>
            </div>
          </>
        ) : loading ? <LoadingBlock label="Comparing accounts…" /> : (
          <Card>
            <EmptyState>Enter two accounts to compare IPs, device signals, and direct value movement.</EmptyState>
          </Card>
        )}
      </AdminPage>
    </div>
  );
}
