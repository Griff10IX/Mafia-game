import { Fragment, useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, ShieldAlert, EyeOff, AlertTriangle } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import CountryFlagThumb from '../../components/CountryFlagThumb';
import StaffIpReputationCard, { maskIp } from '../../components/StaffIpReputationCard';
import {
  AdminPage, Badge, Button, Card, EmptyState, ErrorBlock, KpiGrid, KpiTile, LoadingBlock, ToggleButton, fmtNum, touchClass,
} from './kit/AdminKit';

const ADMIN_BASE = '/tjjeujr3wa';

let _regionNamesEn;
function countryDisplayName(code) {
  if (!code) return 'Unknown';
  try {
    _regionNamesEn = _regionNamesEn || new Intl.DisplayNames(['en'], { type: 'region' });
    return _regionNamesEn.of(code) || code;
  } catch {
    return code;
  }
}

const FLAG_LABELS = {
  same_ip_online: 'Same IP online',
  shared_ip_alive: 'Shared IP (alive)',
  shared_ip_dead_only: 'Shared IP (dead)',
  shared_fingerprint: 'Shared fingerprint',
  same_fingerprint_online: 'Same FP online',
  likely_proxy: 'Likely proxy',
  suspicious_ip: 'Suspicious IP',
  proxy: 'Proxy/VPN',
  hosting: 'Hosting/DC',
  bad_registration_ip: 'Bad reg IP',
  bad_last_login_ip: 'Bad login IP',
};

const SEVERITY_TONE = { critical: 'bad', warn: 'warn', watch: 'info', clean: 'neutral' };
const SEVERITY_LABEL = { critical: 'Critical', warn: 'Warning', watch: 'Watch', clean: 'Clean' };

const SEVERITY_ORDER = { critical: 0, warn: 1, watch: 2, clean: 3 };

function severityRank(u) {
  const s = u?.screen?.severity || 'clean';
  return SEVERITY_ORDER[s] ?? 9;
}

const compareLink = (a, b) => `${ADMIN_BASE}/account-compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
const accessLink = (name) => `${ADMIN_BASE}/ip-history?user=${encodeURIComponent(name)}`;

/** Everything a row needs, derived once so the table and the phone cards stay in sync. */
function rowInfo(u, ipChecks) {
  const reasons = [];
  if (u.is_npc) reasons.push({ label: 'Bot', tone: 'info', title: 'Marked as NPC (is_npc=true)' });
  if (!u.last_seen_recent && u.auto_rank_enabled && !u.auto_rank_idle) reasons.push({ label: 'Auto-rank', tone: 'info', title: 'Online via auto_rank_enabled' });
  if (!u.last_seen_recent && u.forced_online) reasons.push({ label: 'Forced online', tone: 'warn', title: 'Online via forced_online_until' });
  const checked = u.ip ? ipChecks[u.ip] : null;
  const screen = u.screen || {};
  const cur = screen.current_ip;
  return {
    reasons,
    checked,
    screen,
    severity: screen.severity || 'clean',
    linkedCount: screen.linked_on_ip?.count ?? 0,
    likelyReal: screen.likely_real_account,
    possibleDupes: screen.possible_dupes || [],
    clusterRole: screen.cluster_role || 'unknown',
    geoForCard: checked?.geo || (cur ? {
      city: cur.city,
      country: cur.country_code,
      countryCode: cur.country_code,
      regionName: cur.region,
      isp: cur.isp,
      org: cur.org,
      as_field: cur.network,
      proxy: cur.proxy,
      hosting: cur.hosting,
      mobile: cur.mobile,
      geo_ok: true,
    } : null),
  };
}

function UserCell({ u, info }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link to={`/profile/${encodeURIComponent(u.username)}`} className="font-medium text-zinc-50 hover:underline">
        {u.username}
      </Link>
      {u.same_ip_online_count > 0 && (
        <span className="text-xs text-amber-300" title={`${u.same_ip_online_count} other account(s) online from same IP`}>
          +{u.same_ip_online_count} on IP
        </span>
      )}
      {info.reasons.map((r) => (
        <span key={r.label} title={r.title}><Badge tone={r.tone}>{r.label}</Badge></span>
      ))}
    </div>
  );
}

function SeverityBadge({ severity }) {
  return <Badge tone={SEVERITY_TONE[severity] || 'neutral'}>{SEVERITY_LABEL[severity] || severity}</Badge>;
}

function PairingCell({ u, info }) {
  const { clusterRole, likelyReal, possibleDupes } = info;
  if (clusterRole === 'possible_alt' && likelyReal?.username) {
    return (
      <div className="text-sm">
        <Link to={compareLink(likelyReal.username, u.username)} className="font-medium text-emerald-300 hover:underline" title={(likelyReal.why_likely_real || []).join(', ')}>
          → {likelyReal.username}
        </Link>
        <div className="text-xs text-zinc-500">Online main</div>
      </div>
    );
  }
  if (clusterRole === 'possible_main' && possibleDupes[0]?.username) {
    return (
      <div className="text-sm">
        <span className="font-medium text-sky-300">Main?</span>
        <div className="text-xs text-zinc-500">
          Dupe:{' '}
          <Link to={compareLink(u.username, possibleDupes[0].username)} className="text-amber-300 hover:underline">
            {possibleDupes[0].username}
          </Link>
        </div>
      </div>
    );
  }
  if (likelyReal?.username) {
    return <Link to={compareLink(likelyReal.username, u.username)} className="text-sm text-zinc-300 hover:underline">~{likelyReal.username}</Link>;
  }
  return <span className="text-zinc-500">—</span>;
}

function FlagsCell({ screen }) {
  const flags = screen.flags || [];
  if (!flags.length) return <span className="text-zinc-500">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.slice(0, 4).map((f) => <Badge key={f}>{FLAG_LABELS[f] || f}</Badge>)}
      {flags.length > 4 && <span className="text-xs text-zinc-500">+{flags.length - 4}</span>}
    </div>
  );
}

function LinkedCell({ info }) {
  const fp = info.screen.fingerprint_matches?.count;
  return (
    <div className="text-sm">
      {info.linkedCount > 0 ? <span className="font-medium text-amber-300">{info.linkedCount}</span> : <span className="text-zinc-500">—</span>}
      {fp > 0 && <span className="block text-xs text-violet-300">Device ×{fp}</span>}
    </div>
  );
}

function CountryCell({ code }) {
  if (!code) return <Badge tone="warn">Unknown</Badge>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-zinc-200" title={countryDisplayName(code)}>
      <CountryFlagThumb code={code} />
      <span className="font-mono">{code}</span>
    </span>
  );
}

function RowActions({ u, info, screenEnabled, expanded, onToggle, checkingIp, onIpCheck, touch = false }) {
  const extra = touch ? `${touchClass} flex-1` : '';
  return (
    <>
      {screenEnabled && (
        <Button size="sm" variant={expanded ? 'primary' : 'secondary'} icon={AlertTriangle} className={extra} onClick={() => onToggle(u.username)}>
          {expanded ? 'Hide' : 'Screen'}
        </Button>
      )}
      {u.ip && (
        <Button size="sm" variant={info.checked ? 'primary' : 'secondary'} className={extra} loading={checkingIp === u.ip} onClick={() => void onIpCheck(u.ip)}>
          {info.checked ? 'Hide IP' : 'IP proof'}
        </Button>
      )}
    </>
  );
}

function AccountChips({ title, accounts, tone }) {
  if (!accounts?.length) return null;
  const chip = tone === 'device'
    ? 'border-violet-500/30 bg-violet-500/10 text-violet-200'
    : 'border-zinc-700 bg-zinc-800/60 text-zinc-200';
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-zinc-400">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {accounts.map((a) => (
          <Link key={a.id || a.username} to={accessLink(a.username)} className={`rounded-md border px-2 py-1 text-sm hover:underline ${chip}`}>
            {a.username}{a.is_dead ? ' (dead)' : ''}
          </Link>
        ))}
      </div>
    </div>
  );
}

function RowDetails({ u, info, expanded, screenEnabled, blurIps }) {
  const { screen, checked, clusterRole, geoForCard, linkedCount } = info;
  return (
    <div className="space-y-3">
      {expanded && screenEnabled && (
        <>
          {(screen.account_links?.length ?? 0) > 0 && (
            <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
              <div className="text-xs font-medium text-emerald-300">Online pairing (alive and online only)</div>
              {screen.account_links.map((link) => (
                <div key={`${link.role}-${link.id || link.username}`} className="flex flex-wrap items-center gap-2">
                  <Badge tone={link.role === 'likely_real' ? 'good' : 'warn'}>{link.role === 'likely_real' ? 'Online main' : 'Online alt'}</Badge>
                  <Link to={`/profile/${encodeURIComponent(link.username)}`} className="font-medium text-zinc-50 hover:underline">{link.username}</Link>
                  <span className="text-xs text-zinc-500">{link.confidence || 'low'} confidence</span>
                  {(link.why || []).length > 0 && <span className="text-xs text-zinc-400">{link.why.join(', ')}</span>}
                  <Link
                    to={compareLink(link.role === 'likely_real' ? link.username : u.username, link.role === 'likely_real' ? u.username : link.username)}
                    className="text-xs text-sky-300 hover:underline"
                  >
                    Compare
                  </Link>
                </div>
              ))}
              {clusterRole === 'possible_alt' && (
                <p className="text-xs text-amber-200">
                  This session looks like a <strong>possible alt</strong>. Compare it against the older or main account above.
                </p>
              )}
            </div>
          )}
          {geoForCard && (
            <StaffIpReputationCard ip={u.ip} geo={geoForCard} accountCount={linkedCount || checked?.account_count} blurIp={blurIps} compact />
          )}
          <AccountChips title="Accounts on this IP" accounts={screen.linked_on_ip?.accounts} />
          <AccountChips title="Same device fingerprint" accounts={screen.fingerprint_matches?.accounts} tone="device" />
          {(screen.same_fingerprint_online?.length ?? 0) > 0 && (
            <p className="text-sm text-rose-300">Same fingerprint also online now: {screen.same_fingerprint_online.join(', ')}</p>
          )}
          <Link to={accessLink(u.username)} className="inline-block text-sm text-amber-300 hover:underline">
            Open full account access check →
          </Link>
        </>
      )}
      {checked && !expanded && (
        <StaffIpReputationCard ip={checked.ip || u.ip} geo={checked.geo} accountCount={checked.account_count} blurIp={blurIps} />
      )}
    </div>
  );
}

export default function AdminUsersOnline() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [screenSummary, setScreenSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [unknownOnly, setUnknownOnly] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(true);
  const [blurIps, setBlurIps] = useState(false);
  const [ipChecks, setIpChecks] = useState({});
  const [checkingIp, setCheckingIp] = useState('');
  const [expandedUser, setExpandedUser] = useState(null);

  useEffect(() => {
    const u = searchParams.get('unknown');
    if (u === '1' || u === 'true') setUnknownOnly(true);
    const f = searchParams.get('flagged');
    if (f === '1' || f === 'true') setFlaggedOnly(true);
  }, [searchParams]);

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

  const fetchLive = async () => {
    if (!accessChecked) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/admin/users-online-live', { params: { screen: screenEnabled } });
      setUsers(res.data?.users ?? []);
      setScreenSummary(res.data?.screen_summary ?? null);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load';
      setError(msg);
      setUsers([]);
      setScreenSummary(null);
      if (e.response?.status === 403) {
        toast.error('Admin or moderator access required');
        navigate('/dashboard', { replace: true });
        return;
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessChecked) {
      fetchLive();
      const interval = setInterval(fetchLive, 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [accessChecked, screenEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const unknownCount = useMemo(
    () => users.reduce((acc, u) => acc + (u && !u.country ? 1 : 0), 0),
    [users],
  );

  const flaggedCount = useMemo(
    () => users.filter((u) => u?.screen?.severity && u.screen.severity !== 'clean').length,
    [users],
  );

  const visibleUsers = useMemo(() => {
    let rows = users;
    if (unknownOnly) rows = rows.filter((u) => !u.country);
    if (flaggedOnly) rows = rows.filter((u) => u?.screen?.severity && u.screen.severity !== 'clean');
    if (screenEnabled) {
      rows = [...rows].sort((a, b) => {
        const sr = severityRank(a) - severityRank(b);
        if (sr !== 0) return sr;
        return (b.last_seen || '').localeCompare(a.last_seen || '');
      });
    }
    return rows;
  }, [users, unknownOnly, flaggedOnly, screenEnabled]);

  const loadIpCheck = async (ip) => {
    const ipn = String(ip || '').trim();
    if (!ipn) return;
    if (ipChecks[ipn]) {
      setIpChecks((prev) => {
        const next = { ...prev };
        delete next[ipn];
        return next;
      });
      return;
    }
    setCheckingIp(ipn);
    try {
      const res = await api.get('/admin/investigate/accounts-by-ip', { params: { ip: ipn } });
      setIpChecks((prev) => ({ ...prev, [ipn]: res.data || null }));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'IP reputation check failed');
    } finally {
      setCheckingIp('');
    }
  };

  const toggleExpand = (username) => {
    setExpandedUser((cur) => (cur === username ? null : username));
  };

  const pageProps = {
    title: 'Who\'s online',
    subtitle: 'Live dupe and proxy screen on everyone online: shared IPs, device fingerprints, VPN and hosting flags.',
    icon: ShieldAlert,
  };

  if (!accessChecked || (loading && users.length === 0)) {
    return <div data-testid="admin-users-online-page"><AdminPage {...pageProps}><LoadingBlock /></AdminPage></div>;
  }

  if (error && users.length === 0) {
    return (
      <div data-testid="admin-users-online-page">
        <AdminPage {...pageProps}>
          <ErrorBlock message={error} onRetry={fetchLive} />
          <Link to={`${ADMIN_BASE}/overview`} className="inline-block text-sm text-zinc-400 hover:text-zinc-100">← Back to admin</Link>
        </AdminPage>
      </div>
    );
  }

  const emptyText = flaggedOnly
    ? 'No flagged accounts on the live roster.'
    : unknownOnly
      ? 'No "Unknown country" accounts on the live roster.'
      : 'No one online in the last 5 minutes.';
  const colCount = screenEnabled ? 10 : 6;
  const s = screenSummary;

  return (
    <div data-testid="admin-users-online-page">
      <AdminPage
        {...pageProps}
        actions={<Button icon={RefreshCw} loading={loading} onClick={fetchLive} className={touchClass}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
      >
        <KpiGrid cols={5}>
          <KpiTile label="Online now" value={fmtNum(users.length)} hint={s ? `${fmtNum(s.clean ?? 0)} clean` : 'Refreshes every 60s'} />
          <KpiTile label="Critical" value={s ? fmtNum(s.critical ?? 0) : '—'} tone={s?.critical ? 'bad' : 'default'} hint={s ? undefined : 'Dupe screen off'} />
          <KpiTile label="Warnings" value={s ? fmtNum(s.warn ?? 0) : '—'} tone={s?.warn ? 'warn' : 'default'} />
          <KpiTile label="Watch" value={s ? fmtNum(s.watch ?? 0) : '—'} />
          <KpiTile label="Unknown country" value={fmtNum(unknownCount)} tone={unknownCount ? 'warn' : 'default'} />
        </KpiGrid>

        <Card>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <ToggleButton on={screenEnabled} onClick={() => setScreenEnabled((v) => !v)}>Dupe screen {screenEnabled ? 'on' : 'off'}</ToggleButton>
            <ToggleButton on={flaggedOnly} disabled={!screenEnabled} onClick={() => setFlaggedOnly((v) => !v)}>Flagged only ({fmtNum(flaggedCount)})</ToggleButton>
            <ToggleButton on={unknownOnly} onClick={() => setUnknownOnly((v) => !v)}>Unknown country ({fmtNum(unknownCount)})</ToggleButton>
            <ToggleButton on={blurIps} icon={EyeOff} title="Mask IPs for screenshots shown to players" onClick={() => setBlurIps((v) => !v)}>
              {blurIps ? 'IPs blurred' : 'Blur IPs'}
            </ToggleButton>
          </div>
        </Card>

        <Card
          title={`Online roster (${fmtNum(visibleUsers.length)})`}
          subtitle={screenEnabled ? 'Sorted by risk, then most recent click' : 'Most recent first'}
          padded={false}
        >
          {visibleUsers.length === 0 ? <EmptyState>{emptyText}</EmptyState> : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs text-zinc-400">
                      <th className="px-3 py-2 font-medium">Player</th>
                      {screenEnabled && (
                        <>
                          <th className="px-3 py-2 font-medium">Risk</th>
                          <th className="px-3 py-2 font-medium">Online main / alt</th>
                          <th className="px-3 py-2 font-medium">Flags</th>
                          <th className="px-3 py-2 font-medium">Linked</th>
                        </>
                      )}
                      <th className="px-3 py-2 font-medium">Country</th>
                      <th className="px-3 py-2 font-medium">Last click</th>
                      <th className="px-3 py-2 font-medium">Last page</th>
                      <th className="px-3 py-2 font-medium">IP</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((u) => {
                      const info = rowInfo(u, ipChecks);
                      const expanded = expandedUser === u.username;
                      const tint = info.severity === 'critical' ? 'bg-rose-950/20' : info.severity === 'warn' || !u.country ? 'bg-amber-950/10' : '';
                      return (
                        <Fragment key={u.id || u.username}>
                          <tr className={`border-b border-zinc-800/60 align-top hover:bg-zinc-800/30 ${tint}`}>
                            <td className="px-3 py-2.5"><UserCell u={u} info={info} /></td>
                            {screenEnabled && (
                              <>
                                <td className="px-3 py-2.5"><SeverityBadge severity={info.severity} /></td>
                                <td className="px-3 py-2.5"><PairingCell u={u} info={info} /></td>
                                <td className="max-w-[240px] px-3 py-2.5"><FlagsCell screen={info.screen} /></td>
                                <td className="px-3 py-2.5"><LinkedCell info={info} /></td>
                              </>
                            )}
                            <td className="whitespace-nowrap px-3 py-2.5"><CountryCell code={u.country} /></td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400">{formatAdminDateTime(u.last_seen)}</td>
                            <td className="max-w-[160px] truncate px-3 py-2.5 font-mono text-xs text-zinc-300" title={u.last_path || '—'}>{u.last_path || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-zinc-400">{blurIps ? maskIp(u.ip) : (u.ip || '—')}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right">
                              <div className="inline-flex justify-end gap-1.5">
                                <RowActions u={u} info={info} screenEnabled={screenEnabled} expanded={expanded} onToggle={toggleExpand} checkingIp={checkingIp} onIpCheck={loadIpCheck} />
                              </div>
                            </td>
                          </tr>
                          {(expanded || info.checked) && (
                            <tr className="border-b border-zinc-800/60 bg-zinc-950/50">
                              <td colSpan={colCount} className="px-3 py-3">
                                <RowDetails u={u} info={info} expanded={expanded} screenEnabled={screenEnabled} blurIps={blurIps} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-zinc-800 md:hidden">
                {visibleUsers.map((u) => {
                  const info = rowInfo(u, ipChecks);
                  const expanded = expandedUser === u.username;
                  return (
                    <li key={u.id || u.username} className={`space-y-3 p-4 ${info.severity === 'critical' ? 'bg-rose-950/20' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <UserCell u={u} info={info} />
                        {screenEnabled && <SeverityBadge severity={info.severity} />}
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                        <div><dt className="text-xs text-zinc-500">Country</dt><dd><CountryCell code={u.country} /></dd></div>
                        <div><dt className="text-xs text-zinc-500">Last click</dt><dd className="text-zinc-300">{formatAdminDateTime(u.last_seen)}</dd></div>
                        <div className="col-span-2 min-w-0"><dt className="text-xs text-zinc-500">Last page</dt><dd className="truncate font-mono text-xs text-zinc-300">{u.last_path || '—'}</dd></div>
                        <div><dt className="text-xs text-zinc-500">IP</dt><dd className="break-all font-mono text-xs text-zinc-300">{blurIps ? maskIp(u.ip) : (u.ip || '—')}</dd></div>
                        {screenEnabled && (
                          <>
                            <div><dt className="text-xs text-zinc-500">Linked</dt><dd><LinkedCell info={info} /></dd></div>
                            <div className="col-span-2"><dt className="text-xs text-zinc-500">Online main / alt</dt><dd><PairingCell u={u} info={info} /></dd></div>
                            {(info.screen.flags || []).length > 0 && (
                              <div className="col-span-2"><dt className="mb-1 text-xs text-zinc-500">Flags</dt><dd><FlagsCell screen={info.screen} /></dd></div>
                            )}
                          </>
                        )}
                      </dl>
                      <div className="flex gap-2">
                        <RowActions u={u} info={info} screenEnabled={screenEnabled} expanded={expanded} onToggle={toggleExpand} checkingIp={checkingIp} onIpCheck={loadIpCheck} touch />
                      </div>
                      {(expanded || info.checked) && <RowDetails u={u} info={info} expanded={expanded} screenEnabled={screenEnabled} blurIps={blurIps} />}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>

        <p className="text-xs leading-relaxed text-zinc-500">
          The dupe screen uses cached IP geo (proxy and hosting flags) plus database links: shared IPs, fingerprints, and who else is online from the same address.
          <strong className="text-zinc-300"> Online main / alt</strong> only pairs alive accounts that are online right now on the same IP or device; dead accounts still appear in the linked IP and fingerprint lists.
          Use <span className="text-zinc-300">Screen</span> for details, or open the full <span className="text-zinc-300">account access</span> check for the VPN timeline and login history. Refreshes every 60s.
        </p>
      </AdminPage>
    </div>
  );
}
