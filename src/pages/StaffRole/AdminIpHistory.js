import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Globe, RefreshCw, Search, User } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function RiskBanner({ risks }) {
  if (!risks?.length) return null;
  return (
    <div className="space-y-1">
      {risks.map((r, i) => (
        <div
          key={i}
          className={`text-[10px] font-heading rounded border px-2 py-1 ${
            r.level === 'warn'
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
              : 'border-zinc-600/50 bg-zinc-800/60 text-mutedForeground'
          }`}
        >
          <span className="font-bold uppercase text-[9px]">{r.code}</span>
          <div className="mt-0.5 leading-snug">{r.detail}</div>
        </div>
      ))}
    </div>
  );
}

function IpSummaryTable({ rows }) {
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
              <td className="p-1 align-top break-all text-primary">{row.ip}</td>
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
  const [userData, setUserData] = useState(null);
  const [userLoading, setUserLoading] = useState(false);

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

  const loadUserHistory = useCallback(async (overrideQuery) => {
    const q = (overrideQuery != null ? String(overrideQuery) : userQuery).trim();
    if (!q) {
      toast.error('Enter a username or user id');
      return;
    }
    setUserLoading(true);
    setUserData(null);
    try {
      const params = new URLSearchParams();
      const compact = q.replace(/-/g, '');
      const looksUserId =
        /^[0-9a-f]{24}$/i.test(q) || /^[0-9a-f]{32}$/i.test(compact) || /^[0-9a-f-]{36}$/i.test(q);
      if (looksUserId) params.set('user_id', q);
      else params.set('username', q);
      params.set('attack_days', String(Math.max(1, Math.min(365, attackDays))));
      const res = await api.get(`/admin/investigate/user-ip-history?${params.toString()}`);
      setUserData(res.data || null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('user', q);
        next.delete('ip');
        return next;
      });
      const n = res.data?.meta?.unique_ip_count_including_attacks ?? res.data?.meta?.unique_ip_count ?? 0;
      toast.success(`Loaded IP history (${n} unique IPs)`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load IP history');
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

  const sources = userData?.sources || {};
  const attack = userData?.attack_activity;

  return (
    <div
      className={`space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
      style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
      data-testid="admin-ip-history-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-6 h-6 text-primary shrink-0" />
          <div>
            <h1 className="text-lg font-heading font-bold text-foreground">IP history</h1>
            <p className="text-[10px] text-mutedForeground font-heading max-w-xl">
              Sign-in timeline, stored profile IPs, active sessions, and attack log IPs. Reverse search finds accounts
              tied to an address. Geo labels use ip-api.com (7-day cache).
            </p>
          </div>
        </div>
      </div>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary flex items-center gap-2">
          <User className="w-3.5 h-3.5" />
          Player IP history
        </div>
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 min-w-[200px] flex-1">
              <span className="text-[9px] uppercase text-mutedForeground font-heading">Username or user id</span>
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadUserHistory()}
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
              onClick={() => void loadUserHistory()}
              disabled={userLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading uppercase tracking-wider hover:bg-primary/25 disabled:opacity-50"
            >
              {userLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {userLoading ? 'Loading…' : 'Load history'}
            </button>
          </div>

          {userData && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-[10px] font-heading">
                <span className="rounded border border-zinc-700/50 px-2 py-1">
                  <strong className="text-foreground">{userData.user?.username}</strong>
                  <span className="text-mutedForeground"> · {userData.user?.id}</span>
                </span>
                <span className="rounded border border-zinc-700/50 px-2 py-1 tabular-nums">
                  {userData.meta?.unique_ip_count_including_attacks ?? userData.meta?.unique_ip_count ?? 0} unique IPs
                </span>
                <span className="rounded border border-zinc-700/50 px-2 py-1 text-mutedForeground">
                  {userData.meta?.login_history_entries ?? userData.login_timeline?.length ?? 0} login events
                </span>
                {userData.meta?.truncated_geo_lookups ? (
                  <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">
                    Geo capped at {userData.meta?.looked_up_ips} lookups
                  </span>
                ) : null}
              </div>

              <RiskBanner risks={userData.risks} />

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 text-[10px] font-heading">
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5">
                  <div className="text-[9px] uppercase text-mutedForeground">Registration IP</div>
                  <div className="font-mono text-foreground break-all">{sources.registration_ip || '—'}</div>
                </div>
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5">
                  <div className="text-[9px] uppercase text-mutedForeground">Last login IP</div>
                  <div className="font-mono text-foreground break-all">{sources.last_login_ip || '—'}</div>
                </div>
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5">
                  <div className="text-[9px] uppercase text-mutedForeground">Last request IP</div>
                  <div className="font-mono text-foreground break-all">{sources.last_request_ip || '—'}</div>
                </div>
                <div className="rounded border border-zinc-700/40 bg-zinc-900/40 px-2 py-1.5">
                  <div className="text-[9px] uppercase text-mutedForeground">Device</div>
                  <div className="text-foreground">{userData.last_device_type || '—'}</div>
                </div>
              </div>

              {(sources.login_ips?.length > 0 || sources.session_ips?.length > 0) && (
                <div className="text-[9px] font-heading text-mutedForeground space-y-1">
                  {sources.login_ips?.length > 0 ? (
                    <p>
                      <span className="text-primary uppercase">login_ips:</span>{' '}
                      <span className="font-mono">{sources.login_ips.join(' · ')}</span>
                    </p>
                  ) : null}
                  {sources.session_ips?.length > 0 ? (
                    <p>
                      <span className="text-primary uppercase">Session IPs:</span>{' '}
                      <span className="font-mono">{sources.session_ips.join(' · ')}</span>
                    </p>
                  ) : null}
                </div>
              )}

              <div>
                <div className="text-[9px] font-heading text-primary uppercase mb-1">All known IPs (geo)</div>
                <IpSummaryTable rows={userData.ip_summary} />
              </div>

              <div>
                <div className="text-[9px] font-heading text-primary uppercase mb-1">
                  Login timeline (oldest → newest)
                </div>
                <div className="max-h-64 overflow-auto border border-zinc-700/50 rounded">
                  <table className="w-full text-[9px] font-mono">
                    <thead className="sticky top-0 bg-zinc-900/95">
                      <tr className="text-left text-mutedForeground border-b border-zinc-700/50">
                        <th className="p-1">When</th>
                        <th className="p-1">IP</th>
                        <th className="p-1">ISP / org</th>
                        <th className="p-1">Source</th>
                        <th className="p-1">Device</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(userData.login_timeline || []).map((row, i) => (
                        <tr key={i} className="border-b border-zinc-800/80">
                          <td className="p-1 whitespace-nowrap">{formatAdminDateTime(row.at)}</td>
                          <td className="p-1 break-all">{row.ip || '—'}</td>
                          <td className="p-1 break-words">{row.isp || row.org || '—'}</td>
                          <td className="p-1">{row.source || '—'}</td>
                          <td className="p-1">{row.device_type || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

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
                            <td className="p-1 break-all">{s.ip || '—'}</td>
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
                              {r.ip} · {r.count}× · last {formatAdminDateTime(r.last_at)}
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
                              {r.ip} · {r.count}× · last {formatAdminDateTime(r.last_at)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  {(attack.recent_samples?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[9px] text-mutedForeground mb-1">Recent attempts (sample)</div>
                      <div className="max-h-36 overflow-auto border border-zinc-700/40 rounded">
                        <table className="w-full text-[9px] font-mono">
                          <thead>
                            <tr className="text-mutedForeground">
                              <th className="p-1 text-left">Time</th>
                              <th className="p-1 text-left">IP</th>
                              <th className="p-1 text-left">Role</th>
                              <th className="p-1 text-left">Outcome</th>
                              <th className="p-1 text-left">Parties</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attack.recent_samples.map((r, i) => (
                              <tr key={i} className="border-t border-zinc-800/60">
                                <td className="p-1 whitespace-nowrap">{formatAdminDateTime(r.at)}</td>
                                <td className="p-1">{r.ip}</td>
                                <td className="p-1">{r.role}</td>
                                <td className="p-1">{r.outcome}</td>
                                <td className="p-1">
                                  {r.attacker_username} → {r.target_username}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {userData.last_user_agent ? (
                <p className="text-[9px] text-mutedForeground font-mono break-all" title={userData.last_user_agent}>
                  Last UA: {userData.last_user_agent.slice(0, 200)}
                  {userData.last_user_agent.length > 200 ? '…' : ''}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-violet-500/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-violet-200 flex items-center gap-2">
          <Search className="w-3.5 h-3.5" />
          Reverse IP — accounts on this address
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
              <div className="flex flex-wrap gap-2 text-[10px] font-heading items-center">
                <span className="font-mono text-foreground text-sm">{ipData.ip}</span>
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
                              void loadUserHistory(name);
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
              {(ipData.attack_attackers?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[9px] uppercase text-mutedForeground mb-1">Attack attempts from this IP (by attacker)</div>
                  <ul className="text-[9px] font-mono space-y-0.5">
                    {ipData.attack_attackers.map((a, i) => (
                      <li key={i}>
                        {a.username || a.attacker_id} · {a.count} attempts · last {formatAdminDateTime(a.last_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
