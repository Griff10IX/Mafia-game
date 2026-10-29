import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ShieldAlert, AlertTriangle, CheckCircle2, Info, EyeOff } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import StaffIpReputationCard, { maskIp } from '../../components/StaffIpReputationCard';
import {
  AdminPage, Badge, Button, Card, DataTable, EmptyState, Field, KpiGrid, KpiTile, LoadingBlock, TextInput, ToggleButton,
  fmtNum, inputClass, touchClass,
} from './kit/AdminKit';

const TAG_TONES = {
  registration_ip: 'good',
  new_ip: 'warn',
  shared_ip: 'bad',
  hosting: 'warn',
  proxy: 'warn',
  mobile: 'info',
};

const SEV_ICON = {
  critical: AlertTriangle,
  warn: AlertTriangle,
  info: Info,
};

const SEV_BORDER = {
  critical: 'border-rose-500/40 bg-rose-500/5',
  warn: 'border-amber-500/40 bg-amber-500/5',
  info: 'border-zinc-800 bg-zinc-950/40',
};

const SEV_ICON_COLOR = {
  critical: 'text-rose-300',
  warn: 'text-amber-300',
  info: 'text-zinc-400',
};

function TagBadges({ tags }) {
  if (!tags?.length) return <span className="text-zinc-500">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => <Badge key={t} tone={TAG_TONES[t] || 'neutral'}>{t.replace(/_/g, ' ')}</Badge>)}
    </span>
  );
}

function FindingsPanel({ findings }) {
  if (!findings?.length) return null;
  return (
    <Card title="Findings and recommendations">
      <div className="space-y-2">
        {findings.map((f, i) => {
          const Icon = SEV_ICON[f.severity] || Info;
          return (
            <div key={`${f.code}-${i}`} className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${SEV_BORDER[f.severity] || SEV_BORDER.info}`}>
              <Icon size={16} className={`mt-0.5 shrink-0 ${SEV_ICON_COLOR[f.severity] || SEV_ICON_COLOR.info}`} />
              <div className="min-w-0">
                <div className="font-medium text-zinc-100">{f.title}</div>
                <div className="mt-0.5 leading-snug text-zinc-400">{f.detail}</div>
                {f.suggested_action ? <div className="mt-1 text-xs leading-snug text-sky-300">→ {f.suggested_action}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const yesNo = (v) => (v ? <Badge tone="warn">Yes</Badge> : <span className="text-zinc-500">No</span>);
const mono = (v) => <span className="break-all font-mono text-xs">{v}</span>;

function IpSummaryTable({ rows, blurIps }) {
  return (
    <DataTable
      rows={rows || []}
      pageSize={15}
      empty="No IPs recorded."
      columns={[
        { key: 'ip', label: 'IP', render: (r) => mono(blurIps ? maskIp(r.ip) : r.ip) },
        { key: 'network', label: 'Network / ISP', sortValue: (r) => r.network || r.isp || r.org || r.lookup || '', render: (r) => <span className="text-zinc-300">{r.network || r.isp || r.org || r.lookup || '—'}</span> },
        { key: 'countryCode', label: 'Country', render: (r) => r.countryCode || '—' },
        { key: 'mobile', label: 'Mobile', render: (r) => (r.lookup ? '—' : yesNo(r.mobile)) },
        { key: 'hosting', label: 'Hosting', render: (r) => yesNo(r.hosting) },
        { key: 'proxy', label: 'Proxy', render: (r) => yesNo(r.proxy) },
      ]}
    />
  );
}

function AccountButton({ name, onPick }) {
  return (
    <button type="button" className="inline-flex items-center py-1 font-medium text-sky-300 hover:underline max-sm:min-h-[40px]" onClick={() => onPick(name)}>
      {name}
    </button>
  );
}

function AddressTile({ label, value, small }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-0.5 break-all font-mono text-zinc-100 ${small ? 'text-xs' : 'text-sm'}`}>{value || '—'}</div>
    </div>
  );
}

export default function AdminIpHistory() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(false);

  const [userQuery, setUserQuery] = useState(searchParams.get('user') || '');
  const [attackDays, setAttackDays] = useState(90);
  const [report, setReport] = useState(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userLoadError, setUserLoadError] = useState(null);
  const [blurIps, setBlurIps] = useState(false);
  const autoLoadAttemptRef = useRef({ user: null, done: false });

  const [ipQuery, setIpQuery] = useState(searchParams.get('ip') || '');
  const [ipData, setIpData] = useState(null);
  const [ipLoading, setIpLoading] = useState(false);

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

  const loadAccessReport = useCallback(async (overrideQuery) => {
    const q = (overrideQuery != null ? String(overrideQuery) : userQuery).trim();
    if (!q) {
      toast.error('Enter a username or user id');
      return;
    }
    setUserLoading(true);
    setReport(null);
    setUserLoadError(null);
    try {
      const params = new URLSearchParams();
      const compact = q.replace(/-/g, '');
      const looksUserId =
        /^[0-9a-f]{24}$/i.test(q) || /^[0-9a-f]{32}$/i.test(compact) || /^[0-9a-f-]{36}$/i.test(q);
      if (looksUserId) params.set('user_id', q);
      else params.set('username', q);
      params.set('attack_days', String(Math.max(1, Math.min(365, attackDays))));
      const res = await api.get(`/admin/investigate/account-access-report?${params.toString()}`);
      setReport(res.data || null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('user', q);
        next.delete('ip');
        return next;
      });
      const findings = res.data?.access?.findings?.length ?? 0;
      const ips = res.data?.ip?.meta?.unique_ip_count_including_attacks ?? 0;
      toast.success(`Access report loaded (${ips} IPs, ${findings} finding(s))`);
    } catch (e) {
      const detail = e.response?.data?.detail || 'Failed to load access report';
      setUserLoadError(detail);
      toast.error(detail);
    } finally {
      setUserLoading(false);
    }
  }, [userQuery, attackDays, setSearchParams]);

  const loadAccountsByIp = useCallback(async () => {
    const ip = ipQuery.trim();
    if (!ip) {
      toast.error('Enter an IP address');
      return;
    }
    setIpLoading(true);
    setIpData(null);
    try {
      const res = await api.get('/admin/investigate/accounts-by-ip', { params: { ip } });
      setIpData(res.data || null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('ip', ip);
        next.delete('user');
        return next;
      });
      toast.success(`Found ${res.data?.account_count ?? 0} linked account(s)`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'IP search failed');
    } finally {
      setIpLoading(false);
    }
  }, [ipQuery, setSearchParams]);

  useEffect(() => {
    if (!accessChecked) return;
    const u = searchParams.get('user');
    const ip = searchParams.get('ip');
    if (u) setUserQuery(u);
    if (ip) setIpQuery(ip);
  }, [accessChecked, searchParams]);

  useEffect(() => {
    if (!accessChecked) return;
    const u = (searchParams.get('user') || '').trim();
    if (autoLoadAttemptRef.current.user !== u) {
      autoLoadAttemptRef.current = { user: u || null, done: false };
    }
    if (!u || report || userLoading || autoLoadAttemptRef.current.done) return;
    autoLoadAttemptRef.current.done = true;
    void loadAccessReport(u);
  }, [accessChecked, searchParams, report, userLoading, loadAccessReport]);

  const pageProps = {
    title: 'Account access check',
    subtitle: 'For reports of unauthorised logins or a hacked account: every IP and device, what matches other accounts, suspicious attempts, and next steps for staff.',
    icon: ShieldAlert,
  };

  if (!accessChecked) {
    return <div data-testid="admin-ip-history-page"><AdminPage {...pageProps}><LoadingBlock /></AdminPage></div>;
  }

  const userData = report?.ip;
  const access = report?.access;
  const sources = userData?.sources || {};
  const attack = userData?.attack_activity;
  const account = access?.account;
  const showIp = (ip) => (blurIps ? maskIp(ip) : (ip || '—'));
  const pickAccount = (name) => {
    setUserQuery(name);
    void loadAccessReport(name);
  };

  return (
    <div data-testid="admin-ip-history-page">
      <AdminPage
        {...pageProps}
        actions={(
          <ToggleButton on={blurIps} icon={EyeOff} title="Mask IPs for screenshots shown to players" onClick={() => setBlurIps((v) => !v)}>
            {blurIps ? 'IPs blurred' : 'Blur IPs'}
          </ToggleButton>
        )}
      >
        <Card title="Player investigation">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Username or user id" className="flex-1">
              <TextInput value={userQuery} onChange={setUserQuery} onEnter={() => loadAccessReport()} placeholder="GhostFace or user id" autoComplete="off" />
            </Field>
            <Field label="Attack IPs (days)" className="sm:w-36">
              <input
                type="number"
                min={1}
                max={365}
                value={attackDays}
                onChange={(e) => setAttackDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 90)))}
                className={`${inputClass} tabular-nums`}
              />
            </Field>
            <Button variant="primary" icon={Search} loading={userLoading} onClick={() => void loadAccessReport()} className={touchClass}>
              {userLoading ? 'Loading…' : 'Run check'}
            </Button>
          </div>
          {userLoadError && !userLoading && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">{userLoadError}</p>
          )}
        </Card>

        {userLoading && <LoadingBlock label="Building access report…" />}

        {access && userData && (
          <>
            <KpiGrid cols={4}>
              <KpiTile label="Account" value={account?.username || '—'} hint={account?.id} />
              <KpiTile label="Unique IPs" value={fmtNum(userData.meta?.unique_ip_count_including_attacks ?? userData.meta?.unique_ip_count ?? 0)} hint="Including attack logs" />
              <KpiTile label="Device profiles" value={fmtNum(access.device_count ?? 0)} />
              <KpiTile label="Last seen" value={<span className="block whitespace-normal text-sm leading-snug sm:text-base">{formatAdminDateTime(account?.last_seen)}</span>} hint={`Token v${account?.token_version ?? 0}`} />
            </KpiGrid>

            <FindingsPanel findings={access.findings} />

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Key addresses">
                <div className="grid gap-2 sm:grid-cols-2">
                  <AddressTile label="Registration IP" value={showIp(account?.registration_ip || sources.registration_ip)} />
                  <AddressTile label="Last login IP" value={showIp(account?.last_login_ip || sources.last_login_ip)} />
                  <AddressTile label="Last request IP" value={showIp(account?.last_request_ip || sources.last_request_ip)} />
                  <AddressTile label="Device fingerprint" value={account?.device_fingerprint} small />
                </div>
                {account?.last_user_agent ? (
                  <p className="mt-3 break-all font-mono text-xs text-zinc-500" title={account.last_user_agent}>
                    Last UA: {account.last_user_agent.slice(0, 220)}
                    {account.last_user_agent.length > 220 ? '…' : ''}
                  </p>
                ) : null}
              </Card>
              {access.staff_checklist?.length > 0 && (
                <Card title={<span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-400" />Staff checklist</span>}>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-300">
                    {access.staff_checklist.map((item) => <li key={item.id}>{item.label}</li>)}
                  </ul>
                </Card>
              )}
            </div>

            {((access.ip_sharing?.length ?? 0) > 0 || (access.fingerprint_matches?.length ?? 0) > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                {(access.ip_sharing?.length ?? 0) > 0 && (
                  <Card title="IPs shared with other accounts" subtitle="Tap a name to run the check on that account">
                    <div className="space-y-3">
                      {access.ip_sharing.map((block) => (
                        <div key={block.ip} className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-sm">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-mono text-zinc-100">{blurIps ? maskIp(block.ip) : block.ip}</span>
                            <span className="text-xs text-zinc-400">{block.other_alive_count} alive / {block.other_account_count} total other account(s)</span>
                          </div>
                          <ul className="mt-2 space-y-1">
                            {(block.accounts || []).slice(0, 8).map((a) => (
                              <li key={a.id} className="text-zinc-400">
                                <AccountButton name={a.username || a.id} onPick={pickAccount} />
                                {a.is_dead ? ' (dead)' : ''} · <span className="text-xs">{(a.roles || []).join(', ')}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
                {(access.fingerprint_matches?.length ?? 0) > 0 && (
                  <Card title="Same device fingerprint as">
                    <ul className="space-y-1.5 text-sm text-zinc-400">
                      {access.fingerprint_matches.map((m) => (
                        <li key={m.id}>
                          <AccountButton name={m.username || m.id} onPick={pickAccount} />
                          {m.is_dead ? ' (dead)' : ''} · <span className="font-mono text-xs">{blurIps ? maskIp(m.last_login_ip) : (m.last_login_ip || '—')}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            )}

            {(access.devices?.length ?? 0) > 0 && (
              <Card title="Devices" subtitle="From login history and sessions" padded={false}>
                <DataTable
                  rows={access.devices}
                  pageSize={10}
                  columns={[
                    { key: 'device_type', label: 'Type' },
                    { key: 'ua_short', label: 'Browser / label', render: (r) => <span className="text-xs text-zinc-300">{r.ua_short || '—'}</span> },
                    { key: 'ips', label: 'IPs', sortable: false, render: (r) => mono(blurIps ? (r.ips || []).map(maskIp).join(', ') : ((r.ips || []).join(', ') || '—')) },
                    { key: 'login_count', label: 'Logins', align: 'right', render: (r) => fmtNum(r.login_count) },
                    { key: 'last_at', label: 'Last seen', render: (r) => <span className="whitespace-nowrap">{formatAdminDateTime(r.last_at)}</span> },
                  ]}
                />
              </Card>
            )}

            <Card
              title="IP reputation proof cards"
              subtitle={(userData.ip_summary || []).length > 8 ? 'Showing the first 8. The full IP table below has every known IP.' : undefined}
            >
              {(userData.ip_summary || []).length === 0 ? <EmptyState>No IPs recorded.</EmptyState> : (
                <div className="grid gap-2 lg:grid-cols-2">
                  {(userData.ip_summary || []).slice(0, 8).map((row) => (
                    <StaffIpReputationCard key={row.ip} ip={row.ip} geo={row} blurIp={blurIps} compact />
                  ))}
                </div>
              )}
            </Card>

            <Card title="All known IPs" padded={false}>
              <IpSummaryTable rows={userData.ip_summary} blurIps={blurIps} />
            </Card>

            <Card title="Login timeline" subtitle="Tags: registration, new, shared, hosting" padded={false}>
              <DataTable
                rows={access.login_timeline_tagged || userData.login_timeline || []}
                pageSize={25}
                empty="No logins recorded."
                columns={[
                  { key: 'at', label: 'When', render: (r) => <span className="whitespace-nowrap">{formatAdminDateTime(r.at)}</span>, sortValue: (r) => r.at || '' },
                  { key: 'ip', label: 'IP', render: (r) => mono(showIp(r.ip)) },
                  { key: 'isp', label: 'ISP', render: (r) => <span className="text-zinc-300">{r.isp || r.org || '—'}</span> },
                  { key: 'device_type', label: 'Device', render: (r) => r.device_type || '—' },
                  { key: 'tags', label: 'Tags', sortable: false, render: (r) => <TagBadges tags={r.tags} /> },
                ]}
              />
            </Card>

            {(access.suspicious_logins?.recent?.length ?? 0) > 0 && (
              <Card title={`Suspicious logins (${fmtNum(access.suspicious_logins.count_30d)} in 30 days)`} padded={false}>
                <DataTable
                  rows={access.suspicious_logins.recent}
                  pageSize={10}
                  columns={[
                    { key: 'at', label: 'When', render: (r) => <span className="whitespace-nowrap">{formatAdminDateTime(r.at)}</span>, sortValue: (r) => r.at || '' },
                    { key: 'ip', label: 'IP', render: (r) => mono(showIp(r.ip)) },
                    { key: 'reason', label: 'Reason', render: (r) => <span className="text-zinc-300">{r.reason || '—'}</span> },
                    { key: 'login_input', label: 'Tried', render: (r) => <span className="break-all">{r.login_input || '—'}</span> },
                  ]}
                />
              </Card>
            )}

            {(userData.sessions?.length ?? 0) > 0 && (
              <Card title="Active sessions" subtitle="Sample" padded={false}>
                <DataTable
                  rows={userData.sessions}
                  pageSize={10}
                  columns={[
                    { key: 'ip', label: 'IP', render: (r) => mono(showIp(r.ip)) },
                    { key: 'device_type', label: 'Device', render: (r) => r.device_type || '—' },
                    { key: 'last_used_at', label: 'Last used', render: (r) => <span className="whitespace-nowrap">{formatAdminDateTime(r.last_used_at)}</span>, sortValue: (r) => r.last_used_at || '' },
                  ]}
                />
              </Card>
            )}

            {attack && (
              <Card title={`Attack log IPs (last ${attack.days} days)`}>
                <div className="grid gap-4 lg:grid-cols-2">
                  {[['As attacker', attack.as_attacker], ['As target', attack.as_target]].map(([label, list]) => (
                    <div key={label}>
                      <div className="mb-1.5 text-xs font-medium text-zinc-400">{label}</div>
                      {(list || []).length === 0 ? <p className="text-sm text-zinc-500">None</p> : (
                        <ul className="space-y-1 text-sm">
                          {list.map((r, i) => (
                            <li key={i} className="text-zinc-300">
                              <span className="font-mono text-xs">{blurIps ? maskIp(r.ip) : r.ip}</span>
                              <span className="text-zinc-500"> · {r.count}× · last {formatAdminDateTime(r.last_at)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        <Card title="Reverse IP lookup" subtitle="Who else uses this address?">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="IP address" className="flex-1">
              <TextInput value={ipQuery} onChange={setIpQuery} onEnter={() => loadAccountsByIp()} placeholder="151.245.84.178" autoComplete="off" className="font-mono" />
            </Field>
            <Button variant="primary" icon={Search} loading={ipLoading} onClick={() => void loadAccountsByIp()} className={touchClass}>
              {ipLoading ? 'Searching…' : 'Find accounts'}
            </Button>
          </div>

          {ipData && (
            <div className="mt-4 space-y-3">
              <StaffIpReputationCard ip={ipData.ip} geo={ipData.geo} accountCount={ipData.account_count} blurIp={blurIps} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-zinc-100">{blurIps ? maskIp(ipData.ip) : ipData.ip}</span>
                {ipData.geo?.isp ? (
                  <span className="text-zinc-400">
                    {ipData.geo.network || ipData.geo.isp}
                    {ipData.geo.countryCode ? ` · ${ipData.geo.countryCode}` : ''}
                  </span>
                ) : null}
                <Badge>{ipData.account_count} account(s)</Badge>
              </div>
              <div className="rounded-lg border border-zinc-800">
                <DataTable
                  rows={ipData.accounts || []}
                  rowKey={(a) => a.id}
                  pageSize={20}
                  empty="No accounts have used this IP."
                  columns={[
                    { key: 'username', label: 'Player', render: (a) => <AccountButton name={a.username || a.id} onPick={pickAccount} /> },
                    { key: 'roles', label: 'Roles at IP', sortable: false, render: (a) => <span className="text-zinc-400">{(a.roles || []).join(', ') || '—'}</span> },
                    { key: 'created_at', label: 'Created', render: (a) => <span className="whitespace-nowrap text-zinc-400">{formatAdminDateTime(a.created_at)}</span>, sortValue: (a) => a.created_at || '' },
                    { key: 'is_dead', label: 'Status', render: (a) => (a.is_dead ? <Badge tone="bad">Dead</Badge> : <Badge tone="good">Alive</Badge>) },
                  ]}
                />
              </div>
            </div>
          )}
        </Card>
      </AdminPage>
    </div>
  );
}
