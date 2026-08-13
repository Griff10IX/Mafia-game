import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { maskIp } from '../../components/StaffIpReputationCard';

const OUTCOME_OPTIONS = [
  { value: '', label: 'All outcomes' },
  { value: 'hired', label: 'Hired (ok)' },
  { value: 'code_invalid', label: 'Gate fail (rvk)' },
  { value: 'legacy_code_attempt', label: 'Legacy bot shape (bgc_/hire_code_name)' },
];

function uaShort(ua) {
  if (!ua) return '—';
  const s = String(ua);
  if (s.length <= 64) return s;
  return `${s.slice(0, 64)}…`;
}

export default function AdminBodyguardHireLogs() {
  const navigate = useNavigate();
  const [accessChecked, setAccessChecked] = useState(false);
  const [username, setUsername] = useState('');
  const [outcome, setOutcome] = useState('');
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);
  const sinceRef = useRef(null);

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

  const fetchLogs = useCallback(
    async ({ append = false } = {}) => {
      if (!accessChecked) return;
      setLoading(true);
      try {
        const params = { limit: append ? 50 : 150 };
        if (username.trim()) params.username = username.trim();
        if (outcome) params.outcome = outcome;
        if (append && sinceRef.current) params.since = sinceRef.current;
        const res = await api.get('/admin/bodyguards/hire-logs', { params });
        const rows = Array.isArray(res.data?.logs) ? res.data.logs : [];
        setSummary(res.data?.summary_24h || {});
        if (append) {
          if (rows.length) {
            setLogs((prev) => {
              const seen = new Set(prev.map((r) => r.id));
              const merged = [...rows.filter((r) => r.id && !seen.has(r.id)), ...prev];
              return merged.slice(0, 400);
            });
          }
        } else {
          setLogs(rows);
        }
        if (rows[0]?.at) sinceRef.current = rows[0].at;
      } catch (e) {
        toast.error(e.response?.data?.detail || e.message || 'Failed to load hire logs');
      } finally {
        setLoading(false);
      }
    },
    [accessChecked, username, outcome],
  );

  useEffect(() => {
    if (accessChecked) {
      sinceRef.current = null;
      fetchLogs({ append: false });
    }
  }, [accessChecked, fetchLogs]);

  useEffect(() => {
    if (!accessChecked || !live) return undefined;
    const id = setInterval(() => fetchLogs({ append: true }), 8000);
    return () => clearInterval(id);
  }, [accessChecked, live, fetchLogs]);

  if (!accessChecked) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} style={{ padding: 14, maxWidth: 1200, margin: '0 auto' }}>
        <p className="text-sm text-mutedForeground font-heading">Loading bodyguard hire logs…</p>
      </div>
    );
  }

  return (
    <div
      className={`space-y-3 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
      style={{ padding: '12px 14px', maxWidth: 1200, margin: '0 auto' }}
      data-testid="admin-bodyguard-hire-logs-page"
    >
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Bodyguard hire logs</h1>
          <span className="text-[9px] text-mutedForeground font-heading">gate=rvk</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-heading text-mutedForeground flex items-center gap-1">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            Live
          </label>
          <button
            type="button"
            onClick={() => {
              sinceRef.current = null;
              fetchLogs({ append: false });
            }}
            className="px-2 py-1 rounded border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading font-bold uppercase"
          >
            <RefreshCw className={`w-3 h-3 inline ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <p className="text-[10px] text-mutedForeground font-heading">
        <b className="text-amber-200/90">legacy_code_attempt</b> = still posting old <code>hire_code_name</code> / <code>bgc_*</code> (bot fingerprint).
        <b className="text-rose-300/90"> code_invalid</b> = missing/stale rvk gate.
      </p>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-[9px] uppercase text-mutedForeground font-heading mb-0.5">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-foreground min-w-[140px]"
            placeholder="optional"
          />
        </div>
        <div>
          <label className="block text-[9px] uppercase text-mutedForeground font-heading mb-0.5">Outcome</label>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-foreground"
          >
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            sinceRef.current = null;
            fetchLogs({ append: false });
          }}
          className="px-3 py-1 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40"
        >
          Apply
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] font-heading">
        {Object.entries(summary).map(([k, n]) => (
          <span key={k} className="px-2 py-1 rounded border border-zinc-700/60 bg-zinc-950/50">
            <span className="text-mutedForeground">{k}</span> <b className="text-foreground">{n}</b>
            <span className="text-mutedForeground"> /24h</span>
          </span>
        ))}
        {!Object.keys(summary).length && <span className="text-mutedForeground">No hire attempts in last 24h</span>}
      </div>

      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full text-[10px] font-heading">
          <thead className="bg-zinc-900/80 text-mutedForeground uppercase tracking-wider">
            <tr>
              <th className="text-left px-2 py-1.5">At</th>
              <th className="text-left px-2 py-1.5">User</th>
              <th className="text-left px-2 py-1.5">Outcome</th>
              <th className="text-left px-2 py-1.5">Slot</th>
              <th className="text-left px-2 py-1.5">IP</th>
              <th className="text-left px-2 py-1.5">UA</th>
              <th className="text-left px-2 py-1.5">Extra</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((row) => (
              <tr key={row.id || `${row.at}-${row.owner_username}`} className="border-t border-zinc-800/80 hover:bg-primary/5">
                <td className="px-2 py-1 whitespace-nowrap text-zinc-400">{formatAdminDateTime(row.at)}</td>
                <td className="px-2 py-1 text-primary font-bold">{row.owner_username || '—'}</td>
                <td className="px-2 py-1">
                  <span
                    className={
                      row.outcome === 'hired'
                        ? 'text-emerald-400'
                        : row.outcome === 'legacy_code_attempt'
                          ? 'text-amber-300'
                          : 'text-rose-300'
                    }
                  >
                    {row.outcome || '—'}
                  </span>
                </td>
                <td className="px-2 py-1">{row.slot ?? '—'}</td>
                <td className="px-2 py-1 font-mono text-zinc-400">{maskIp(row.client_ip) || '—'}</td>
                <td className="px-2 py-1 text-zinc-500 max-w-[220px] truncate" title={row.user_agent || ''}>
                  {uaShort(row.user_agent)}
                </td>
                <td className="px-2 py-1 text-zinc-500">
                  {[
                    row.legacy_shape ? 'legacy_shape' : null,
                    row.code_present === false ? 'no_code' : null,
                    row.used_hire_token ? 'token' : null,
                    row.hire_cost != null ? `${row.hire_cost}pts` : null,
                    row.bodyguard_username || null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
              </tr>
            ))}
            {!logs.length && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-mutedForeground">
                  No rows yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
