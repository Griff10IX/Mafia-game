import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, RefreshCw, ShieldAlert, ExternalLink } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const ABUSEIPDB_CHECK_URL = 'https://www.abuseipdb.com/check/';

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function AdminUsersOnline() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLive = async () => {
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
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading && users.length === 0) {
    return (
      <div className={`space-y-3 ${styles.pageContent}`}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Users size={22} className="text-primary/40 animate-pulse" />
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.2em]">Loading live users…</span>
        </div>
      </div>
    );
  }

  if (error && users.length === 0) {
    return (
      <div className={`space-y-3 ${styles.pageContent}`}>
        <div className={`${styles.panel} rounded-lg border border-amber-500/30 p-4`}>
          <p className="text-amber-400 font-heading">{error}</p>
          <Link to="/admin" className="text-primary text-sm font-heading hover:underline mt-2 inline-block">← Back to Admin</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="admin-users-online-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert size={18} />
            Users online (live)
          </h1>
          <p className="text-[10px] text-mutedForeground font-heading mt-0.5">
            Everyone actually online · last click, last page, IP · same-IP count in brackets
          </p>
        </div>
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

      <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-heading">
            <thead>
              <tr className="bg-primary/10 text-primary border-b border-primary/20">
                <th className="py-2 px-3 font-bold uppercase tracking-wider">User</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">Last click</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">Last page</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider">IP</th>
                <th className="py-2 px-3 font-bold uppercase tracking-wider text-right">Check IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700/30">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-mutedForeground">
                    No one online in the last 5 minutes.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id || u.username} className="hover:bg-zinc-800/30">
                    <td className="py-2 px-3">
                      <Link to={`/profile/${encodeURIComponent(u.username)}`} className="text-primary font-bold hover:underline">
                        {u.username}
                        {u.same_ip_online_count > 0 && (
                          <span className="ml-1 text-amber-400 font-normal" title={`${u.same_ip_online_count} other account(s) online from same IP`}>
                            ({u.same_ip_online_count})
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-mutedForeground whitespace-nowrap">
                      {formatDateTime(u.last_seen)}
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[9px] text-mutedForeground font-heading">
        &quot;Check reputation&quot; opens AbuseIPDB in a new tab. Refreshes every 60s.
      </p>
    </div>
  );
}
