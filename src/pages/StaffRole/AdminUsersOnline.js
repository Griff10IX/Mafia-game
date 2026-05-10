import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Users, RefreshCw, ShieldAlert, ExternalLink } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { formatGameDateTime as formatDateTime } from '../../utils/gameDateTime';
import CountryFlagThumb from '../../components/CountryFlagThumb';

const ABUSEIPDB_CHECK_URL = 'https://www.abuseipdb.com/check/';

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

export default function AdminUsersOnline() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [unknownOnly, setUnknownOnly] = useState(false);

  useEffect(() => {
    const u = searchParams.get('unknown');
    if (u === '1' || u === 'true') setUnknownOnly(true);
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
      const res = await api.get('/admin/users-online-live');
      setUsers(res.data?.users ?? []);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load';
      setError(msg);
      setUsers([]);
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
  }, [accessChecked]); // eslint-disable-line react-hooks/exhaustive-deps

  const unknownCount = useMemo(
    () => users.reduce((acc, u) => acc + (u && !u.country ? 1 : 0), 0),
    [users],
  );
  const visibleUsers = useMemo(
    () => (unknownOnly ? users.filter((u) => !u.country) : users),
    [users, unknownOnly],
  );

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
            Everyone actually online · last click, last page, IP, country · same-IP count in brackets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUnknownOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border font-heading font-bold text-[10px] uppercase tracking-wide ${
              unknownOnly
                ? 'border-amber-500/60 bg-amber-500/30 text-amber-300 hover:bg-amber-500/40'
                : 'border-zinc-600/50 bg-zinc-800/40 text-mutedForeground hover:bg-zinc-700/40'
            }`}
            title="Filter rows where the country header was missing (Cloudflare/Vercel etc.)"
          >
            {unknownOnly ? '✓ ' : ''}Unknown only ({unknownCount})
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
          <table className="w-full text-left text-xs font-heading">
            <thead>
              <tr className="bg-primary/10 text-primary border-b border-primary/20">
                <th className="py-2 px-3 font-bold uppercase tracking-wider">User</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">Country</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">Last click</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">Last page</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">IP</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider text-right">Check IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700/30">
              {visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-mutedForeground">
                    {unknownOnly
                      ? 'No "Unknown country" accounts on the live roster.'
                      : 'No one online in the last 5 minutes.'}
                  </td>
                </tr>
              ) : (
                visibleUsers.map((u) => {
                  const reasons = [];
                  if (u.is_npc) reasons.push({ label: 'BOT', cls: 'border-fuchsia-500/40 bg-fuchsia-500/20 text-fuchsia-300', title: 'Marked as NPC (is_npc=true)' });
                  if (!u.last_seen_recent && u.auto_rank_enabled && !u.auto_rank_idle) reasons.push({ label: 'AUTO-RANK', cls: 'border-sky-500/40 bg-sky-500/20 text-sky-300', title: 'Online via auto_rank_enabled — no recent browser ping' });
                  if (!u.last_seen_recent && u.forced_online) reasons.push({ label: 'FORCED', cls: 'border-orange-500/40 bg-orange-500/20 text-orange-300', title: 'Online via forced_online_until — no recent browser ping' });
                  return (
                    <tr key={u.id || u.username} className={`hover:bg-zinc-800/30 ${!u.country ? 'bg-amber-950/10' : ''}`}>
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
                            <span
                              key={r.label}
                              className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[8px] font-heading font-bold uppercase tracking-wider ${r.cls}`}
                              title={r.title}
                            >
                              {r.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {u.country ? (
                          <span className="inline-flex items-center gap-1.5 text-foreground/90 text-[10px]" title={countryDisplayName(u.country)}>
                            <CountryFlagThumb code={u.country} />
                            <span className="font-mono">{u.country}</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded border border-amber-500/50 bg-amber-500/15 text-amber-300 text-[9px] font-heading font-bold uppercase tracking-wider"
                            title="No edge country header was captured for this account's last request (Cloudflare/Vercel/etc.). Common for NPCs, auto-rank-only sessions, or requests that didn't pass through the edge."
                          >
                            Unknown
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-mutedForeground whitespace-nowrap">
                        {formatAdminDateTime(u.last_seen)}
                      </td>
                      <td className="py-2 px-3 text-foreground font-mono text-[10px] max-w-[180px] truncate" title={u.last_path || '—'}>
                        {u.last_path || '—'}
                      </td>
                      <td className="py-2 px-3 font-mono text-[10px] text-mutedForeground">
                        {u.ip || '—'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {u.ip ? (
                          <a
                            href={`${ABUSEIPDB_CHECK_URL}${encodeURIComponent(u.ip)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/40 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 text-[9px] font-heading font-bold uppercase"
                          >
                            <ExternalLink size={10} />
                            Check reputation
                          </a>
                        ) : (
                          <span className="text-mutedForeground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[9px] text-mutedForeground font-heading">
        &quot;Check reputation&quot; opens AbuseIPDB in a new tab. Refreshes every 60s.
        Country comes from edge headers (Cloudflare / Vercel / CloudFront / Fastly / AppEngine) on the user&apos;s last request.
        <span className="text-amber-300/90"> &quot;Unknown&quot;</span> usually means an NPC, an auto-rank / forced-online account that hasn&apos;t actually pinged the server,
        or a request that didn&apos;t pass through the edge proxy. Use the badges to see why.
      </p>
    </div>
  );
}
