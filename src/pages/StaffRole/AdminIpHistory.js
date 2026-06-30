import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Globe, RefreshCw, Search, User, ShieldAlert, Smartphone, AlertTriangle, CheckCircle2, Info, EyeOff } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import StaffIpReputationCard, { maskIp } from '../../components/StaffIpReputationCard';

const TAG_STYLES = {
  registration_ip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  new_ip: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  shared_ip: 'border-red-500/40 bg-red-500/10 text-red-200',
  hosting: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  proxy: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  mobile: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
};

const SEV_ICON = {
  critical: AlertTriangle,
  warn: AlertTriangle,
  info: Info,
};

const SEV_BORDER = {
  critical: 'border-red-500/50 bg-red-500/10',
  warn: 'border-amber-500/50 bg-amber-500/10',
  info: 'border-zinc-600/50 bg-zinc-800/40',
};

function TagBadges({ tags }) {
  if (!tags?.length) return <span className="text-mutedForeground">—</span>;
  return (
    <span className="flex flex-wrap gap-0.5">
      {tags.map((t) => (
        <span
          key={t}
          className={`rounded px-1 py-0.5 text-[8px] font-heading uppercase tracking-wide border ${TAG_STYLES[t] || 'border-zinc-600 text-zinc-400'}`}
        >
          {t.replace(/_/g, ' ')}
        </span>
      ))}
    </span>
  );
}

function FindingsPanel({ findings }) {
  if (!findings?.length) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[9px] font-heading text-primary uppercase tracking-wider flex items-center gap-1">
        <ShieldAlert className="w-3.5 h-3.5" />
        Findings & recommendations
      </div>
      {findings.map((f, i) => {
        const Icon = SEV_ICON[f.severity] || Info;
        return (
          <div
            key={`${f.code}-${i}`}
            className={`rounded border px-2 py-1.5 text-[10px] font-heading ${SEV_BORDER[f.severity] || SEV_BORDER.info}`}
          >
            <div className="flex items-start gap-1.5">
              <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-80" />
              <div className="min-w-0">
                <div className="font-bold text-foreground">{f.title}</div>
                <div className="text-mutedForeground leading-snug mt-0.5">{f.detail}</div>
                {f.suggested_action ? (
                  <div className="text-[9px] text-primary/90 mt-1 leading-snug">→ {f.suggested_action}</div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IpSummaryTable({ rows, blurIps }) {
  if (!rows?.length) {
    return <p className="text-[10px] text-mutedForeground font-heading">No IPs recorded.</p>;
  }
  return (
    <div className="max-h-56 overflow-auto border border-zinc-700/50 rounded">
      <table className="w-full text-[9px] font-mono">
        <thead className="sticky top-0 bg-zinc-900/95">
          <tr className="text-left text-mutedForeground border-b border-zinc-700/50">
            <th className="p-1">IP</th>
            <th className="p-1">Network / ISP</th>
            <th className="p-1">CC</th>
            <th className="p-1">Mob</th>
            <th className="p-1">Host</th>
            <th className="p-1">Proxy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-zinc-800/80">
              <td className="p-1 align-top break-all text-primary">{blurIps ? maskIp(row.ip) : row.ip}</td>
              <td className="p-1 align-top break-words text-foreground">
                {row.network || row.isp || row.org || row.lookup || '—'}
              </td>
              <td className="p-1 align-top">{row.countryCode || '—'}</td>
              <td className="p-1 align-top">{row.lookup ? '—' : row.mobile ? 'Y' : 'N'}</td>
              <td className="p-1 align-top">{row.hosting ? 'Y' : 'N'}</td>
              <td className="p-1 align-top">{row.proxy ? 'Y' : 'N'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

  if (!accessChecked) {
    return (
      <div
        className={`space-y-3 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
        style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
      >
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Globe className="w-10 h-10 text-primary/60" />
          <p className="text-sm text-mutedForeground font-heading">Loading…</p>
        </div>
      </div>
    );
  }

  const userData = report?.ip;
  const access = report?.access;
  const sources = userData?.sources || {};
  const attack = userData?.attack_activity;
  const account = access?.account;

  return (
    <div
      className={`space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
      style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
      data-testid="admin-ip-history-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="w-6 h-6 text-primary shrink-0" />
          <div>
            <h1 className="text-lg font-heading font-bold text-foreground">Account access check</h1>
            <p className="text-[10px] text-mutedForeground font-heading max-w-2xl">
              Use when a player reports unauthorized logins or a hacked account: all IPs, devices, what matches other
              accounts, suspicious attempts, and staff next steps.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setBlurIps((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border font-heading font-bold text-[10px] uppercase tracking-wide ${
            blurIps
              ? 'border-sky-500/60 bg-sky-500/25 text-sky-200 hover:bg-sky-500/35'
              : 'border-zinc-600/50 bg-zinc-800/40 text-mutedForeground hover:bg-zinc-700/40'
          }`}
          title="Mask IPs for screenshots shown to players"
        >
          <EyeOff size={12} />
          {blurIps ? 'IPs blurred' : 'Blur IPs'}
        </button>
      </div>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary flex items-center gap-2">
          <User className="w-3.5 h-3.5" />
          Player investigation
        </div>
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 min-w-[200px] flex-1">
              <span className="text-[9px] uppercase text-mutedForeground font-heading">Username or user id</span>
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadAccessReport()}
                placeholder="GhostFace or user id"
                className="px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-0.5 w-28">
              <span className="text-[9px] uppercase text-mutedForeground font-heading">Attack IPs (days)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={attackDays}
                onChange={(e) => setAttackDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 90)))}
                className="px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-mono"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadAccessReport()}
              disabled={userLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading uppercase tracking-wider hover:bg-primary/25 disabled:opacity-50"
            >
              {userLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {userLoading ? 'Loading…' : 'Run check'}
            </button>
          </div>

          {userLoadError && !userLoading && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] font-heading text-amber-200">
              {userLoadError}
            </div>
          )}

          {access && userData && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-[10px] font-heading">
                <span className="rounded border border-zinc-700/50 px-2 py-1">
                  <strong className="text-foreground">{account?.username}</strong>
                  <span className="text-mutedForeground"> · {account?.id}</span>
                </span>
                <span className="rounded border border-zinc-700/50 px-2 py-1 tabular-nums">
                  {userData.meta?.unique_ip_count_including_attacks ?? userData.meta?.unique_ip_count ?? 0} unique IPs
                </span>
                <span className="rounded border border-zinc-700/50 px-2 py-1">
                  {access.device_count ?? 0} device profile(s)
                </span>
                <span className="rounded border border-zinc-700/50 px-2 py-1 text-mutedForeground">
                  token v{account?.token_version ?? 0}
                </span>
                {account?.last_seen ? (
                  <span className="rounded border border-zinc-700/50 px-2 py-1 text-mutedForeground">
                    last seen {formatAdminDateTime(account.last_seen)}
                  </span>
                ) : null}
              </div>

              <FindingsPanel findings={access.findings} />

              {access.staff_checklist?.length > 0 && (
                <div className="rounded border border-zinc-700/40 bg-zinc-900/30 p-2">
                  <div className="text-[9px] font-heading text-primary uppercase mb-1.5 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Staff checklist
                  </div>
                  <ul className="text-[9px] text-mutedForeground font-heading space-y-1 list-disc pl-4">
                    {access.staff_checklist.map((item) => (
                      <li key={item.id}>{item.label}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 text-[10px] font-heading">
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5">
                  <div className="text-[9px] uppercase text-mutedForeground">Registration IP</div>
                  <div className="font-mono text-foreground break-all">{blurIps ? maskIp(account?.registration_ip || sources.registration_ip) : (account?.registration_ip || sources.registration_ip || '—')}</div>
                </div>
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5">
                  <div className="text-[9px] uppercase text-mutedForeground">Last login IP</div>
                  <div className="font-mono text-foreground break-all">{blurIps ? maskIp(account?.last_login_ip || sources.last_login_ip) : (account?.last_login_ip || sources.last_login_ip || '—')}</div>
                </div>
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5">
                  <div className="text-[9px] uppercase text-mutedForeground">Last request IP</div>
                  <div className="font-mono text-foreground break-all">{blurIps ? maskIp(account?.last_request_ip || sources.last_request_ip) : (account?.last_request_ip || sources.last_request_ip || '—')}</div>
                </div>
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5">
                  <div className="text-[9px] uppercase text-mutedForeground">Device fingerprint</div>
                  <div className="font-mono text-[9px] text-foreground break-all">{account?.device_fingerprint || '—'}</div>
                </div>
              </div>

              {(access.devices?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[9px] font-heading text-primary uppercase mb-1 flex items-center gap-1">
                    <Smartphone className="w-3 h-3" />
                    Devices (from login history & sessions)
                  </div>
                  <div className="max-h-48 overflow-auto border border-zinc-700/50 rounded">
                    <table className="w-full text-[9px] font-mono">
                      <thead className="sticky top-0 bg-zinc-900/95">
                        <tr className="text-mutedForeground border-b border-zinc-700/50">
                          <th className="p-1 text-left">Type</th>
                          <th className="p-1 text-left">UA / label</th>
                          <th className="p-1 text-left">IPs</th>
                          <th className="p-1 text-left">Logins</th>
                          <th className="p-1 text-left">Last seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {access.devices.map((d, i) => (
                          <tr key={i} className="border-b border-zinc-800/80">
                            <td className="p-1">{d.device_type}</td>
                            <td className="p-1 break-all max-w-[140px]">{d.ua_short || '—'}</td>
                            <td className="p-1 break-all">
                              {blurIps ? (d.ips || []).map(maskIp).join(', ') : ((d.ips || []).join(', ') || '—')}
                            </td>
                            <td className="p-1 tabular-nums">{d.login_count}</td>
                            <td className="p-1 whitespace-nowrap">{formatAdminDateTime(d.last_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(access.ip_sharing?.length ?? 0) > 0 && (
                <div className="space-y-2 rounded border border-red-500/20 bg-red-500/5 p-2">
                  <div className="text-[9px] font-heading text-red-200 uppercase">IPs shared with other accounts</div>
                  {access.ip_sharing.map((block) => (
                    <div key={block.ip} className="text-[9px] font-heading">
                      <div className="font-mono text-foreground">
                        {blurIps ? maskIp(block.ip) : block.ip}{' '}
                        <span className="text-mutedForeground">
                          — {block.other_alive_count} alive / {block.other_account_count} total other account(s)
                        </span>
                      </div>
                      <ul className="mt-0.5 pl-3 text-mutedForeground font-mono space-y-0.5">
                        {(block.accounts || []).slice(0, 8).map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => {
                                const name = a.username || a.id;
                                setUserQuery(name);
                                void loadAccessReport(name);
                              }}
                            >
                              {a.username || a.id}
                            </button>
                            {a.is_dead ? ' (dead)' : ''} · {(a.roles || []).join(', ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {(access.fingerprint_matches?.length ?? 0) > 0 && (
                <div className="text-[9px] font-heading">
                  <div className="text-primary uppercase mb-1">Same device fingerprint as</div>
                  <ul className="font-mono text-mutedForeground space-y-0.5">
                    {access.fingerprint_matches.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => {
                            setUserQuery(m.username || m.id);
                            void loadAccessReport(m.username || m.id);
                          }}
                        >
                          {m.username || m.id}
                        </button>
                        {m.is_dead ? ' (dead)' : ''} · {blurIps ? maskIp(m.last_login_ip) : (m.last_login_ip || '—')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="text-[9px] font-heading text-primary uppercase mb-1">IP reputation proof cards</div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {(userData.ip_summary || []).slice(0, 8).map((row) => (
                    <StaffIpReputationCard
                      key={row.ip}
                      ip={row.ip}
                      geo={row}
                      blurIp={blurIps}
                      compact
                    />
                  ))}
                </div>
                {(userData.ip_summary || []).length > 8 ? (
                  <p className="mt-1 text-[9px] text-mutedForeground font-heading">
                    Showing first 8 proof cards. Full IP table below still contains all known IPs.
                  </p>
                ) : null}
              </div>

              <div>
                <div className="text-[9px] font-heading text-primary uppercase mb-1">All known IPs (geo)</div>
                <IpSummaryTable rows={userData.ip_summary} blurIps={blurIps} />
              </div>

              <div>
                <div className="text-[9px] font-heading text-primary uppercase mb-1">
                  Login timeline (tags: reg / new / shared / hosting)
                </div>
                <div className="max-h-64 overflow-auto border border-zinc-700/50 rounded">
                  <table className="w-full text-[9px] font-mono">
                    <thead className="sticky top-0 bg-zinc-900/95">
                      <tr className="text-left text-mutedForeground border-b border-zinc-700/50">
                        <th className="p-1">When</th>
                        <th className="p-1">IP</th>
                        <th className="p-1">ISP</th>
                        <th className="p-1">Device</th>
                        <th className="p-1">Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(access.login_timeline_tagged || userData.login_timeline || []).map((row, i) => (
                        <tr key={i} className="border-b border-zinc-800/80">
                          <td className="p-1 whitespace-nowrap">{formatAdminDateTime(row.at)}</td>
                          <td className="p-1 break-all">{blurIps ? maskIp(row.ip) : (row.ip || '—')}</td>
                          <td className="p-1 break-words">{row.isp || row.org || '—'}</td>
                          <td className="p-1">{row.device_type || '—'}</td>
                          <td className="p-1">
                            <TagBadges tags={row.tags} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {(access.suspicious_logins?.recent?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[9px] font-heading text-amber-200 uppercase mb-1">
                    Suspicious logins ({access.suspicious_logins.count_30d} in 30d)
                  </div>
                  <div className="max-h-36 overflow-auto border border-amber-500/20 rounded">
                    <table className="w-full text-[9px] font-mono">
                      <thead>
                        <tr className="text-mutedForeground">
                          <th className="p-1 text-left">When</th>
                          <th className="p-1 text-left">IP</th>
                          <th className="p-1 text-left">Reason</th>
                          <th className="p-1 text-left">Input</th>
                        </tr>
                      </thead>
                      <tbody>
                        {access.suspicious_logins.recent.map((r, i) => (
                          <tr key={i} className="border-t border-zinc-800/60">
                            <td className="p-1 whitespace-nowrap">{formatAdminDateTime(r.at)}</td>
                            <td className="p-1">{blurIps ? maskIp(r.ip) : (r.ip || '—')}</td>
                            <td className="p-1">{r.reason || '—'}</td>
                            <td className="p-1 break-all">{r.login_input || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(userData.sessions?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[9px] font-heading text-primary uppercase mb-1">Active sessions (sample)</div>
                  <div className="max-h-40 overflow-auto border border-zinc-700/50 rounded">
                    <table className="w-full text-[9px] font-mono">
                      <thead>
                        <tr className="text-mutedForeground border-b border-zinc-700/50">
                          <th className="p-1 text-left">IP</th>
                          <th className="p-1 text-left">Device</th>
                          <th className="p-1 text-left">Last used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userData.sessions.map((s, i) => (
                          <tr key={i} className="border-b border-zinc-800/80">
                            <td className="p-1 break-all">{blurIps ? maskIp(s.ip) : (s.ip || '—')}</td>
                            <td className="p-1">{s.device_type || '—'}</td>
                            <td className="p-1 whitespace-nowrap">{formatAdminDateTime(s.last_used_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {attack && (
                <div className="space-y-2 rounded border border-sky-500/25 bg-sky-500/5 p-2">
                  <div className="text-[9px] font-heading text-sky-200 uppercase">
                    Attack log IPs (last {attack.days}d)
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[9px] text-mutedForeground mb-1">As attacker</div>
                      {(attack.as_attacker || []).length === 0 ? (
                        <p className="text-[9px] text-mutedForeground">None</p>
                      ) : (
                        <ul className="text-[9px] font-mono space-y-0.5">
                          {attack.as_attacker.map((r, i) => (
                            <li key={i}>
                              {blurIps ? maskIp(r.ip) : r.ip} · {r.count}× · last {formatAdminDateTime(r.last_at)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <div className="text-[9px] text-mutedForeground mb-1">As target</div>
                      {(attack.as_target || []).length === 0 ? (
                        <p className="text-[9px] text-mutedForeground">None</p>
                      ) : (
                        <ul className="text-[9px] font-mono space-y-0.5">
                          {attack.as_target.map((r, i) => (
                            <li key={i}>
                              {blurIps ? maskIp(r.ip) : r.ip} · {r.count}× · last {formatAdminDateTime(r.last_at)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {account?.last_user_agent ? (
                <p className="text-[9px] text-mutedForeground font-mono break-all" title={account.last_user_agent}>
                  Last UA: {account.last_user_agent.slice(0, 220)}
                  {account.last_user_agent.length > 220 ? '…' : ''}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-violet-500/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-violet-200 flex items-center gap-2">
          <Search className="w-3.5 h-3.5" />
          Reverse IP — who else uses this address?
        </div>
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 min-w-[200px] flex-1">
              <span className="text-[9px] uppercase text-mutedForeground font-heading">IP address</span>
              <input
                type="text"
                value={ipQuery}
                onChange={(e) => setIpQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadAccountsByIp()}
                placeholder="151.245.84.178"
                className="px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-mono"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadAccountsByIp()}
              disabled={ipLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-violet-500/40 bg-violet-500/15 text-violet-200 text-[10px] font-heading uppercase tracking-wider hover:bg-violet-500/25 disabled:opacity-50"
            >
              {ipLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {ipLoading ? 'Searching…' : 'Find accounts'}
            </button>
          </div>

          {ipData && (
            <div className="space-y-2">
              <StaffIpReputationCard
                ip={ipData.ip}
                geo={ipData.geo}
                accountCount={ipData.account_count}
                blurIp={blurIps}
              />
              <div className="flex flex-wrap gap-2 text-[10px] font-heading items-center">
                <span className="font-mono text-foreground text-sm">{blurIps ? maskIp(ipData.ip) : ipData.ip}</span>
                {ipData.geo?.isp ? (
                  <span className="text-mutedForeground">
                    {ipData.geo.network || ipData.geo.isp}
                    {ipData.geo.countryCode ? ` · ${ipData.geo.countryCode}` : ''}
                  </span>
                ) : null}
                <span className="rounded border border-zinc-700/50 px-2 py-0.5 tabular-nums">
                  {ipData.account_count} account(s)
                </span>
              </div>
              <div className="max-h-72 overflow-auto border border-zinc-700/50 rounded">
                <table className="w-full text-[9px] font-heading">
                  <thead className="sticky top-0 bg-zinc-900/95">
                    <tr className="text-mutedForeground border-b border-zinc-700/50">
                      <th className="p-1 text-left">Username</th>
                      <th className="p-1 text-left">Roles at IP</th>
                      <th className="p-1 text-left">Created</th>
                      <th className="p-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ipData.accounts || []).map((a) => (
                      <tr key={a.id} className="border-b border-zinc-800/80">
                        <td className="p-1">
                          <button
                            type="button"
                            className="text-primary hover:underline font-medium"
                            onClick={() => {
                              const name = a.username || a.id;
                              setUserQuery(name);
                              void loadAccessReport(name);
                            }}
                          >
                            {a.username || a.id}
                          </button>
                        </td>
                        <td className="p-1 text-mutedForeground">{(a.roles || []).join(', ') || '—'}</td>
                        <td className="p-1 text-mutedForeground whitespace-nowrap">
                          {formatAdminDateTime(a.created_at)}
                        </td>
                        <td className="p-1">{a.is_dead ? <span className="text-red-400">Dead</span> : 'Alive'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
