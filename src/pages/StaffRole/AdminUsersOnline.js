import { Fragment, useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Users, RefreshCw, ShieldAlert, EyeOff, AlertTriangle } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import CountryFlagThumb from '../../components/CountryFlagThumb';
import StaffIpReputationCard, { maskIp } from '../../components/StaffIpReputationCard';

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

const SEVERITY_STYLES = {
  critical: 'border-red-500/50 bg-red-500/20 text-red-200',
  warn: 'border-amber-500/50 bg-amber-500/20 text-amber-200',
  watch: 'border-sky-500/50 bg-sky-500/20 text-sky-200',
  clean: 'border-zinc-600/40 bg-zinc-700/30 text-zinc-400',
};

const SEVERITY_ORDER = { critical: 0, warn: 1, watch: 2, clean: 3 };

function severityRank(u) {
  const s = u?.screen?.severity || 'clean';
  return SEVERITY_ORDER[s] ?? 9;
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

  if (!accessChecked || (loading && users.length === 0)) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`} style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Users size={22} className="text-primary/40 animate-pulse" />
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.2em]">Loading…</span>
        </div>
      </div>
    );
  }

  if (error && users.length === 0) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`} style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}>
        <div className={`${styles.panel} rounded-lg border border-amber-500/30 p-4 mobile-panel`}>
          <p className="text-amber-400 font-heading">{error}</p>
          <Link to="/tjjeujr3wa/overview" className="text-primary text-sm font-heading hover:underline mt-2 inline-block">← Back to Admin</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`} style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }} data-testid="admin-users-online-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert size={18} />
            Users online (live)
          </h1>
          <p className="text-[10px] text-mutedForeground font-heading mt-0.5">
            Dupe / proxy screen on everyone online — shared IPs, fingerprints, VPN/hosting flags
          </p>
          {screenSummary ? (
            <p className="text-[9px] text-mutedForeground font-heading mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="text-red-300">{screenSummary.critical ?? 0} critical</span>
              <span className="text-amber-300">{screenSummary.warn ?? 0} warn</span>
              <span className="text-sky-300">{screenSummary.watch ?? 0} watch</span>
              <span>{screenSummary.clean ?? 0} clean</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setScreenEnabled((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border font-heading font-bold text-[10px] uppercase tracking-wide ${
              screenEnabled
                ? 'border-emerald-500/60 bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/35'
                : 'border-zinc-600/50 bg-zinc-800/40 text-mutedForeground hover:bg-zinc-700/40'
            }`}
          >
            {screenEnabled ? '✓ ' : ''}Dupe screen
          </button>
          <button
            type="button"
            onClick={() => setFlaggedOnly((v) => !v)}
            disabled={!screenEnabled}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border font-heading font-bold text-[10px] uppercase tracking-wide disabled:opacity-40 ${
              flaggedOnly
                ? 'border-red-500/60 bg-red-500/30 text-red-200 hover:bg-red-500/40'
                : 'border-zinc-600/50 bg-zinc-800/40 text-mutedForeground hover:bg-zinc-700/40'
            }`}
          >
            {flaggedOnly ? '✓ ' : ''}Flagged ({flaggedCount})
          </button>
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
          <button
            type="button"
            onClick={() => setUnknownOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border font-heading font-bold text-[10px] uppercase tracking-wide ${
              unknownOnly
                ? 'border-amber-500/60 bg-amber-500/30 text-amber-300 hover:bg-amber-500/40'
                : 'border-zinc-600/50 bg-zinc-800/40 text-mutedForeground hover:bg-zinc-700/40'
            }`}
          >
            {unknownOnly ? '✓ ' : ''}Unknown ({unknownCount})
          </button>
          <button
            type="button"
            onClick={fetchLive}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 bg-primary/20 text-primary font-heading font-bold text-[10px] uppercase tracking-wide hover:bg-primary/30 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-heading min-w-[900px]">
            <thead>
              <tr className="bg-primary/10 text-primary border-b border-primary/20">
                <th className="py-2 px-3 font-bold uppercase tracking-wider">User</th>
                {screenEnabled ? (
                  <>
                    <th className="py-2 px-3 font-bold uppercase tracking-wider">Risk</th>
                    <th className="py-2 px-3 font-bold uppercase tracking-wider">Likely real</th>
                    <th className="py-2 px-3 font-bold uppercase tracking-wider">Flags</th>
                    <th className="py-2 px-3 font-bold uppercase tracking-wider">Linked</th>
                  </>
                ) : null}
                <th className="py-2 px-3 font-bold uppercase tracking-wider">Country</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">Last click</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">Last page</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">IP</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700/30">
              {visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={screenEnabled ? 11 : 7} className="py-6 text-center text-mutedForeground">
                    {flaggedOnly
                      ? 'No flagged accounts on the live roster.'
                      : unknownOnly
                        ? 'No "Unknown country" accounts on the live roster.'
                        : 'No one online in the last 5 minutes.'}
                  </td>
                </tr>
              ) : (
                visibleUsers.map((u) => {
                  const reasons = [];
                  if (u.is_npc) reasons.push({ label: 'BOT', cls: 'border-fuchsia-500/40 bg-fuchsia-500/20 text-fuchsia-300', title: 'Marked as NPC (is_npc=true)' });
                  if (!u.last_seen_recent && u.auto_rank_enabled && !u.auto_rank_idle) reasons.push({ label: 'AUTO-RANK', cls: 'border-sky-500/40 bg-sky-500/20 text-sky-300', title: 'Online via auto_rank_enabled' });
                  if (!u.last_seen_recent && u.forced_online) reasons.push({ label: 'FORCED', cls: 'border-orange-500/40 bg-orange-500/20 text-orange-300', title: 'Online via forced_online_until' });
                  const checked = u.ip ? ipChecks[u.ip] : null;
                  const screen = u.screen || {};
                  const severity = screen.severity || 'clean';
                  const isExpanded = expandedUser === u.username;
                  const linkedCount = screen.linked_on_ip?.count ?? 0;
                  const likelyReal = screen.likely_real_account;
                  const possibleDupes = screen.possible_dupes || [];
                  const clusterRole = screen.cluster_role || 'unknown';
                  const geoForCard = checked?.geo || (screen.current_ip ? {
                    city: screen.current_ip.city,
                    country: screen.current_ip.country_code,
                    countryCode: screen.current_ip.country_code,
                    regionName: screen.current_ip.region,
                    isp: screen.current_ip.isp,
                    org: screen.current_ip.org,
                    as_field: screen.current_ip.network,
                    proxy: screen.current_ip.proxy,
                    hosting: screen.current_ip.hosting,
                    mobile: screen.current_ip.mobile,
                    geo_ok: true,
                  } : null);

                  return (
                    <Fragment key={u.id || u.username}>
                      <tr className={`hover:bg-zinc-800/30 ${!u.country ? 'bg-amber-950/10' : ''} ${severity === 'critical' ? 'bg-red-950/15' : severity === 'warn' ? 'bg-amber-950/10' : ''}`}>
                        <td className="py-2 px-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link to={`/profile/${encodeURIComponent(u.username)}`} className="text-primary font-bold hover:underline">
                              {u.username}
                              {u.same_ip_online_count > 0 && (
                                <span className="ml-1 text-amber-400 font-normal" title={`${u.same_ip_online_count} other account(s) online from same IP`}>
                                  ({u.same_ip_online_count})
                                </span>
                              )}
                            </Link>
                            {reasons.map((r) => (
                              <span key={r.label} className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[8px] font-heading font-bold uppercase tracking-wider ${r.cls}`} title={r.title}>
                                {r.label}
                              </span>
                            ))}
                          </div>
                        </td>
                        {screenEnabled ? (
                          <>
                            <td className="py-2 px-3">
                              <span className={`inline-flex px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.clean}`}>
                                {severity}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-[9px]">
                              {clusterRole === 'possible_alt' && likelyReal?.username ? (
                                <div>
                                  <Link
                                    to={`/tjjeujr3wa/account-compare?a=${encodeURIComponent(likelyReal.username)}&b=${encodeURIComponent(u.username)}`}
                                    className="text-emerald-300 font-bold hover:underline"
                                    title={(likelyReal.why_likely_real || []).join(', ')}
                                  >
                                    → {likelyReal.username}
                                  </Link>
                                  <div className="text-mutedForeground text-[8px]">likely main</div>
                                </div>
                              ) : clusterRole === 'possible_main' && possibleDupes[0]?.username ? (
                                <div>
                                  <span className="text-sky-300 font-bold">Main?</span>
                                  <div className="text-mutedForeground text-[8px]">
                                    dupe:{' '}
                                    <Link
                                      to={`/tjjeujr3wa/account-compare?a=${encodeURIComponent(u.username)}&b=${encodeURIComponent(possibleDupes[0].username)}`}
                                      className="text-amber-300 hover:underline"
                                    >
                                      {possibleDupes[0].username}
                                    </Link>
                                  </div>
                                </div>
                              ) : likelyReal?.username ? (
                                <Link
                                  to={`/tjjeujr3wa/account-compare?a=${encodeURIComponent(likelyReal.username)}&b=${encodeURIComponent(u.username)}`}
                                  className="text-zinc-300 hover:underline"
                                >
                                  ~{likelyReal.username}
                                </Link>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-2 px-3 max-w-[200px]">
                              <div className="flex flex-wrap gap-0.5">
                                {(screen.flags || []).slice(0, 4).map((f) => (
                                  <span key={f} className="text-[8px] px-1 py-0.5 rounded bg-zinc-800/80 text-zinc-300 border border-zinc-600/40" title={FLAG_LABELS[f] || f}>
                                    {(FLAG_LABELS[f] || f).split(' ')[0]}
                                  </span>
                                ))}
                                {(screen.flags || []).length > 4 ? (
                                  <span className="text-[8px] text-mutedForeground">+{screen.flags.length - 4}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-mutedForeground">
                              {linkedCount > 0 ? (
                                <span className="text-amber-300 font-bold">{linkedCount}</span>
                              ) : (
                                '—'
                              )}
                              {screen.fingerprint_matches?.count > 0 ? (
                                <span className="text-purple-300/90 text-[9px] block">FP×{screen.fingerprint_matches.count}</span>
                              ) : null}
                            </td>
                          </>
                        ) : null}
                        <td className="py-2 px-3 whitespace-nowrap">
                          {u.country ? (
                            <span className="inline-flex items-center gap-1.5 text-foreground/90 text-[10px]" title={countryDisplayName(u.country)}>
                              <CountryFlagThumb code={u.country} />
                              <span className="font-mono">{u.country}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-amber-500/50 bg-amber-500/15 text-amber-300 text-[9px] font-heading font-bold uppercase">Unknown</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-mutedForeground whitespace-nowrap">{formatAdminDateTime(u.last_seen)}</td>
                        <td className="py-2 px-3 text-foreground font-mono text-[10px] max-w-[140px] truncate" title={u.last_path || '—'}>{u.last_path || '—'}</td>
                        <td className="py-2 px-3 font-mono text-[10px] text-mutedForeground">{blurIps ? maskIp(u.ip) : (u.ip || '—')}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            {screenEnabled ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(u.username)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 text-[9px] font-heading font-bold uppercase"
                              >
                                <AlertTriangle size={10} />
                                {isExpanded ? 'Hide' : 'Screen'}
                              </button>
                            ) : null}
                            {u.ip ? (
                              <button
                                type="button"
                                onClick={() => void loadIpCheck(u.ip)}
                                disabled={checkingIp === u.ip}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/40 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 text-[9px] font-heading font-bold uppercase disabled:opacity-50"
                              >
                                {checkingIp === u.ip ? '…' : checked ? 'Hide IP' : 'IP proof'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {(isExpanded || checked) ? (
                        <tr className="bg-zinc-950/40">
                          <td colSpan={screenEnabled ? 11 : 7} className="px-3 py-2 space-y-2">
                            {isExpanded && screenEnabled ? (
                              <div className="space-y-2">
                                {(screen.account_links?.length ?? 0) > 0 ? (
                                  <div className="rounded border border-emerald-500/25 bg-emerald-500/5 p-2 text-[9px] space-y-1.5">
                                    <div className="text-emerald-300/90 uppercase font-bold">Account pairing (guess)</div>
                                    {screen.account_links.map((link) => (
                                      <div key={`${link.role}-${link.id || link.username}`} className="flex flex-wrap items-center gap-2">
                                        <span className={`px-1 py-0.5 rounded border text-[8px] uppercase font-bold ${
                                          link.role === 'likely_real'
                                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                                            : 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                                        }`}>
                                          {link.role === 'likely_real' ? 'Likely real' : 'Likely dupe'}
                                        </span>
                                        <Link
                                          to={`/profile/${encodeURIComponent(link.username)}`}
                                          className="text-primary font-bold hover:underline"
                                        >
                                          {link.username}
                                        </Link>
                                        <span className="text-mutedForeground">({link.confidence || 'low'})</span>
                                        {(link.why || []).length > 0 ? (
                                          <span className="text-zinc-500">— {(link.why || []).join(', ')}</span>
                                        ) : null}
                                        <Link
                                          to={`/tjjeujr3wa/account-compare?a=${encodeURIComponent(
                                            link.role === 'likely_real' ? link.username : u.username,
                                          )}&b=${encodeURIComponent(
                                            link.role === 'likely_real' ? u.username : link.username,
                                          )}`}
                                          className="text-sky-300 hover:underline uppercase text-[8px]"
                                        >
                                          Compare
                                        </Link>
                                      </div>
                                    ))}
                                    {clusterRole === 'possible_alt' ? (
                                      <div className="text-amber-200/90">
                                        This session looks like a <strong>possible alt</strong> — compare against the older/main account above.
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                                {geoForCard ? (
                                  <StaffIpReputationCard
                                    ip={u.ip}
                                    geo={geoForCard}
                                    accountCount={linkedCount || checked?.account_count}
                                    blurIp={blurIps}
                                    compact
                                  />
                                ) : null}
                                {(screen.linked_on_ip?.accounts?.length ?? 0) > 0 ? (
                                  <div className="text-[9px]">
                                    <div className="text-amber-300/90 uppercase font-bold mb-1">Accounts on this IP</div>
                                    <div className="flex flex-wrap gap-1">
                                      {screen.linked_on_ip.accounts.map((a) => (
                                        <Link
                                          key={a.id || a.username}
                                          to={`/tjjeujr3wa/ip-history?user=${encodeURIComponent(a.username)}`}
                                          className="px-1.5 py-0.5 rounded border border-zinc-600/50 bg-zinc-800/50 text-primary hover:underline"
                                        >
                                          {a.username}{a.is_dead ? ' (dead)' : ''}
                                        </Link>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                {(screen.fingerprint_matches?.accounts?.length ?? 0) > 0 ? (
                                  <div className="text-[9px]">
                                    <div className="text-purple-300/90 uppercase font-bold mb-1">Same device fingerprint</div>
                                    <div className="flex flex-wrap gap-1">
                                      {screen.fingerprint_matches.accounts.map((a) => (
                                        <Link
                                          key={a.id || a.username}
                                          to={`/tjjeujr3wa/ip-history?user=${encodeURIComponent(a.username)}`}
                                          className="px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-200 hover:underline"
                                        >
                                          {a.username}{a.is_dead ? ' (dead)' : ''}
                                        </Link>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                {(screen.same_fingerprint_online?.length ?? 0) > 0 ? (
                                  <div className="text-[9px] text-red-300">
                                    Same fingerprint also online now: {screen.same_fingerprint_online.join(', ')}
                                  </div>
                                ) : null}
                                <Link
                                  to={`/tjjeujr3wa/ip-history?user=${encodeURIComponent(u.username)}`}
                                  className="inline-block text-[9px] font-heading uppercase text-amber-300 hover:underline"
                                >
                                  Open full account access check →
                                </Link>
                              </div>
                            ) : null}
                            {checked && !isExpanded ? (
                              <StaffIpReputationCard ip={checked.ip || u.ip} geo={checked.geo} accountCount={checked.account_count} blurIp={blurIps} />
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[9px] text-mutedForeground font-heading">
        Dupe screen uses cached IP geo (proxy/hosting flags) plus DB links — shared IPs, fingerprints, and who else is online from the same address.
        Click <span className="text-primary">Screen</span> for details or open full <span className="text-amber-300/90">Account access</span> for VPN timeline / login history.
        Refreshes every 60s.
      </p>
    </div>
  );
}
