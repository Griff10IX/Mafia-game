import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, RefreshCw, Search, Skull } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function fmtInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString();
}

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${v.toLocaleString()}`;
}

function linkReasonLabel(reason) {
  if (reason === 'same_email') return 'same email';
  if (reason === 'replacement_registration') return 'email reused on signup';
  if (reason === 'registration_ip_after_death') return 'same IP after death';
  return reason || 'unlinked';
}

function TotalsLine({ totals }) {
  return (
    <span className="text-[10px] font-heading text-mutedForeground">
      <span className="text-foreground font-bold">{fmtInt(totals?.points)}</span> pts
      {' · '}
      <span className="text-foreground font-bold">{fmtMoney(totals?.cash)}</span>
      {' · '}
      <span className="text-foreground font-bold">{fmtMoney(totals?.swiss)}</span> Swiss
    </span>
  );
}

function DeadRows({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="overflow-x-auto border border-zinc-700/40 rounded">
      <table className="w-full text-left text-[10px] font-heading">
        <thead>
          <tr className="border-b border-zinc-700/50 text-mutedForeground uppercase">
            <th className="p-2">Dead account</th>
            <th className="p-2">Died</th>
            <th className="p-2 text-right">Points</th>
            <th className="p-2 text-right">Cash</th>
            <th className="p-2 text-right">Swiss</th>
            <th className="p-2">Link</th>
            <th className="p-2">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id || row.username} className="border-b border-zinc-800/60">
              <td className="p-2 text-primary font-bold">
                <Link to={`/profile/${encodeURIComponent(row.username || '')}`} className="hover:underline">
                  {row.username || '—'}
                </Link>
              </td>
              <td className="p-2 text-mutedForeground whitespace-nowrap">{formatAdminDateTime(row.dead_at)}</td>
              <td className="p-2 text-right text-foreground">{fmtInt(row.points)}</td>
              <td className="p-2 text-right text-foreground">{fmtMoney(row.cash)}</td>
              <td className="p-2 text-right text-foreground">{fmtMoney(row.swiss)}</td>
              <td className="p-2 text-mutedForeground">{linkReasonLabel(row.link_reason)}</td>
              <td className="p-2 text-mutedForeground">
                {row.account_locked ? 'locked ' : ''}
                {row.retrieval_used ? 'cash claimed ' : ''}
                {row.swiss_retrieval_used ? 'swiss claimed' : ''}
                {!row.account_locked && !row.retrieval_used && !row.swiss_retrieval_used ? '—' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminDeadEstates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlUsername = searchParams.get('username') || '';
  const [username, setUsername] = useState(urlUsername);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [openIds, setOpenIds] = useState({});

  const load = useCallback(async (name) => {
    setLoading(true);
    try {
      const q = String(name || '').trim();
      const res = await api.get('/admin/dead-estates', {
        params: q ? { username: q } : {},
      });
      setData(res.data || null);
      const nextOpen = {};
      const clusters = res.data?.clusters || [];
      if (q && clusters[0]?.current?.id) nextOpen[clusters[0].current.id] = true;
      else if (clusters.length === 1 && clusters[0]?.current?.id) nextOpen[clusters[0].current.id] = true;
      setOpenIds(nextOpen);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Scan failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUsername(urlUsername);
    load(urlUsername);
  }, [load, urlUsername]);

  const onSearch = (e) => {
    e.preventDefault();
    const q = username.trim();
    setSearchParams(q ? { username: q } : {});
  };

  const summary = data?.summary || {};
  const clusters = data?.clusters || [];
  const unlinked = data?.unlinked || [];

  const headerNote = useMemo(() => {
    if (data?.query?.username) {
      return `Showing leftover estates linked to ${data.query.username} (email chain, reused signup email, or same registration IP after death).`;
    }
    return 'Every living player with linked dead accounts that still hold points, cash (after the 0.05% tithe), or Swiss.';
  }, [data]);

  return (
    <div
      className={`space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
      style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
      data-testid="admin-dead-estates-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Skull className="w-6 h-6 text-primary shrink-0" />
          <div>
            <h1 className="text-lg font-heading font-bold text-foreground">Dead estates</h1>
            <p className="text-[10px] text-mutedForeground font-heading max-w-2xl">{headerNote}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => load(searchParams.get('username') || '')}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-primary/40 text-[10px] font-heading font-bold uppercase tracking-wide text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Scanning…' : 'Rescan'}
        </button>
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-mutedForeground" />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Player username (e.g. Hazey)"
            className="w-full pl-7 pr-2 py-1.5 rounded border border-border bg-background text-[11px] font-heading text-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-2.5 py-1.5 rounded border border-primary/50 bg-primary/10 text-[10px] font-heading font-bold uppercase tracking-wide text-primary disabled:opacity-50"
        >
          Search
        </button>
        {searchParams.get('username') ? (
          <button
            type="button"
            onClick={() => {
              setUsername('');
              setSearchParams({});
            }}
            className="px-2.5 py-1.5 rounded border border-border text-[10px] font-heading uppercase tracking-wide text-mutedForeground hover:text-foreground"
          >
            All players
          </button>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-3 text-[10px] font-heading">
        <span className="rounded border border-border px-2 py-1">
          Players <strong className="text-foreground">{fmtInt(summary.player_count || 0)}</strong>
        </span>
        <span className="rounded border border-border px-2 py-1">
          Dead with loot <strong className="text-foreground">{fmtInt(summary.dead_count || 0)}</strong>
        </span>
        <span className="rounded border border-border px-2 py-1">
          Points <strong className="text-foreground">{fmtInt(summary.points || 0)}</strong>
        </span>
        <span className="rounded border border-border px-2 py-1">
          Cash <strong className="text-foreground">{fmtMoney(summary.cash || 0)}</strong>
        </span>
        <span className="rounded border border-border px-2 py-1">
          Swiss <strong className="text-foreground">{fmtMoney(summary.swiss || 0)}</strong>
        </span>
        {summary.unlinked_count ? (
          <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">
            Unlinked {fmtInt(summary.unlinked_count)}
          </span>
        ) : null}
      </div>

      {!loading && clusters.length === 0 && unlinked.length === 0 && (
        <p className="text-[10px] text-mutedForeground font-heading">
          {data?.query?.username
            ? `No leftover points, cash, or Swiss on dead accounts linked to ${data.query.username}.`
            : 'No leftover dead-account estates found.'}
        </p>
      )}

      <div className="space-y-2">
        {clusters.map((cluster) => {
          const id = cluster.current?.id || cluster.current?.username;
          const open = !!openIds[id];
          return (
            <div key={id} className={`relative ${styles.panel} rounded-lg overflow-hidden border border-zinc-700/50`}>
              <button
                type="button"
                onClick={() => setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }))}
                className="w-full flex flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="text-[11px] font-heading font-bold text-primary">
                  {cluster.current?.username || 'Unknown'}
                </span>
                <span className="text-[10px] text-mutedForeground">
                  {cluster.totals?.dead_count || 0} dead account{(cluster.totals?.dead_count || 0) === 1 ? '' : 's'}
                </span>
                <span className="ml-auto">
                  <TotalsLine totals={cluster.totals} />
                </span>
              </button>
              {open && (
                <div className="px-3 pb-3 space-y-2">
                  {cluster.current?.email ? (
                    <p className="text-[10px] text-mutedForeground font-heading">
                      Live email: <span className="text-foreground">{cluster.current.email}</span>
                    </p>
                  ) : null}
                  <DeadRows rows={cluster.dead_accounts} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unlinked.length > 0 && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-amber-500/25`}>
          <div className="px-3 py-2 border-b border-amber-500/20">
            <h2 className="text-[11px] font-heading font-bold text-amber-200 uppercase tracking-wide">
              Unlinked dead accounts
            </h2>
            <p className="text-[10px] text-mutedForeground">
              Still holding loot, but no living email match or a unique post-death registration IP.
            </p>
          </div>
          <div className="p-3">
            <DeadRows rows={unlinked} />
          </div>
        </div>
      )}
    </div>
  );
}
