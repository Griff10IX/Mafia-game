import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skull, RefreshCw, Search, ArrowRight, Coins, Star } from 'lucide-react';
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
  if (!Number.isFinite(v) || v <= 0) return null;
  return `$${v.toLocaleString()}`;
}

function EventBadge({ type, supplemental }) {
  if (type === 'revive') {
    return (
      <span className="rounded px-1.5 py-0.5 text-[8px] font-heading uppercase tracking-wide border border-amber-500/40 bg-amber-500/10 text-amber-200">
        Revive
      </span>
    );
  }
  if (supplemental) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[8px] font-heading uppercase tracking-wide border border-violet-500/40 bg-violet-500/10 text-violet-200">
        Retrieve+
      </span>
    );
  }
  return (
    <span className="rounded px-1.5 py-0.5 text-[8px] font-heading uppercase tracking-wide border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
      Retrieve
    </span>
  );
}

function TransferDetail({ row }) {
  const tokens = row.tokens_restored && Object.keys(row.tokens_restored).length > 0
    ? Object.entries(row.tokens_restored).map(([k, v]) => `${v}× ${k.replace(/_/g, ' ')}`).join(', ')
    : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-heading">
      {row.event_type === 'retrieve' && (
        <>
          <div>
            <span className="text-mutedForeground">Dead account points before:</span>{' '}
            <span className="text-foreground font-bold">{fmtInt(row.dead_points_before)}</span>
            <span className="text-mutedForeground"> → after: </span>
            <span className="text-emerald-300 font-bold">{fmtInt(row.dead_points_after ?? 0)}</span>
          </div>
          <div>
            <span className="text-mutedForeground">Snapshot at death:</span>{' '}
            <span className="text-foreground">{fmtInt(row.points_at_death_snapshot)}</span>
          </div>
        </>
      )}
      {row.event_type === 'revive' && (
        <>
          <div>
            <span className="text-mutedForeground">Revive cost:</span>{' '}
            <span className="text-red-300 font-bold">{fmtInt(row.revive_cost)} pts</span>
          </div>
          <div>
            <span className="text-mutedForeground">Reviver had:</span>{' '}
            <span className="text-foreground">{fmtInt(row.reviver_points_before)} pts</span>
            <span className="text-mutedForeground"> + dead carry </span>
            <span className="text-foreground">{fmtInt(row.dead_carry_points)}</span>
          </div>
        </>
      )}
      {fmtMoney(row.money_transferred) && (
        <div>
          <span className="text-mutedForeground">Cash:</span>{' '}
          <span className="text-green-300">{fmtMoney(row.money_transferred)}</span>
        </div>
      )}
      {(row.swiss_transferred || 0) > 0 && (
        <div>
          <span className="text-mutedForeground">Swiss:</span>{' '}
          <span className="text-green-300">{fmtMoney(row.swiss_transferred)}</span>
        </div>
      )}
      {(row.tax_money || 0) > 0 && (
        <div>
          <span className="text-mutedForeground">State head tax (cash):</span>{' '}
          <span className="text-amber-300">{fmtMoney(row.tax_money)}</span>
        </div>
      )}
      {row.game_pass_merged && (
        <div className="text-sky-300">Game Pass progression merged</div>
      )}
      {tokens && (
        <div className="sm:col-span-2">
          <span className="text-mutedForeground">Tokens restored:</span>{' '}
          <span className="text-foreground">{tokens}</span>
        </div>
      )}
      {row.dead_state && (
        <div>
          <span className="text-mutedForeground">Dead state:</span>{' '}
          <span className="text-foreground">{row.dead_state}</span>
        </div>
      )}
    </div>
  );
}

export default function AdminDeadAliveLog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(false);
  const [userQuery, setUserQuery] = useState(searchParams.get('user') || '');
  const [days, setDays] = useState(Math.min(365, Math.max(1, parseInt(searchParams.get('days') || '90', 10) || 90)));
  const [eventType, setEventType] = useState(searchParams.get('type') || '');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.get('/admin/me');
        if (!cancelled) setAccessChecked(true);
      } catch {
        if (!cancelled) toast.error('Staff access required');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadLog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const q = userQuery.trim();
      if (q) params.set('username', q);
      params.set('days', String(days));
      if (eventType) params.set('event_type', eventType);
      params.set('limit', '150');
      const res = await api.get(`/admin/investigate/dead-alive-transfers?${params.toString()}`);
      setData(res.data);
      const next = new URLSearchParams();
      if (q) next.set('user', q);
      next.set('days', String(days));
      if (eventType) next.set('type', eventType);
      setSearchParams(next, { replace: true });
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to load Dead > Alive log');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userQuery, days, eventType, setSearchParams]);

  useEffect(() => {
    if (!accessChecked) return;
    void loadLog();
  }, [accessChecked, loadLog]);

  const rows = data?.transfers || [];

  return (
    <div
      className={`space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`}
      style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }}
      data-testid="admin-dead-alive-log-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Skull className="w-6 h-6 text-primary shrink-0" />
          <div>
            <h1 className="text-lg font-heading font-bold text-foreground">Dead &gt; Alive transfer log</h1>
            <p className="text-[10px] text-mutedForeground font-heading max-w-2xl">
              Every retrieve (dead estate → living alt) and revive (50k revive swap). Shows points cleared on the dead
              account and what the recipient received.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadLog()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading uppercase tracking-wider hover:bg-primary/25 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-primary/10 border-b border-border text-[10px] font-heading font-bold uppercase tracking-wider text-primary flex items-center gap-2">
          <Search className="w-3.5 h-3.5" />
          Search transfers
        </div>
        <div className="p-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 min-w-[200px] flex-1">
            <span className="text-[9px] uppercase text-mutedForeground font-heading">Username (any role)</span>
            <input
              type="text"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadLog()}
              placeholder="Axel, axelv2, …"
              className="px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-0.5 w-24">
            <span className="text-[9px] uppercase text-mutedForeground font-heading">Days</span>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 90)))}
              className="px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-mono"
            />
          </label>
          <label className="flex flex-col gap-0.5 w-28">
            <span className="text-[9px] uppercase text-mutedForeground font-heading">Type</span>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
            >
              <option value="">All</option>
              <option value="retrieve">Retrieve</option>
              <option value="revive">Revive</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadLog()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading uppercase tracking-wider hover:bg-primary/25 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {loading ? 'Loading…' : 'Search'}
          </button>
        </div>
      </section>

      <section className="rounded border border-border overflow-hidden">
        <div className="px-2 py-1.5 bg-zinc-900/80 border-b border-border flex items-center justify-between gap-2">
          <span className="text-[10px] font-heading font-bold uppercase tracking-wider text-mutedForeground">
            Transfers ({data?.total ?? 0} in window)
          </span>
        </div>
        {!rows.length && !loading && (
          <p className="p-4 text-[10px] text-mutedForeground font-heading">No transfers found for this filter.</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-heading">
              <thead className="bg-zinc-900/60 border-b border-border text-mutedForeground text-left">
                <tr>
                  <th className="p-2">When</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">From (dead)</th>
                  <th className="p-2" />
                  <th className="p-2">To (recipient)</th>
                  <th className="p-2 text-right">Points</th>
                  <th className="p-2 text-right">Cash / Swiss</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isOpen = expandedId === row.id;
                  const toUser = row.event_type === 'revive' ? row.revived_username : row.recipient_username;
                  const fromUser = row.event_type === 'revive' ? row.reviver_username : row.dead_username;
                  return (
                    <tr key={row.id} className="border-b border-zinc-800/80 align-top">
                      <td className="p-2 whitespace-nowrap text-mutedForeground font-mono text-[9px]">
                        {formatAdminDateTime(row.created_at)}
                      </td>
                      <td className="p-2">
                        <EventBadge type={row.event_type} supplemental={row.supplemental} />
                      </td>
                      <td className="p-2">
                        <span className="text-red-300/90 font-bold">{fromUser || '—'}</span>
                        {row.event_type === 'retrieve' && (row.dead_points_before || 0) > 0 && (
                          <div className="text-[9px] text-mutedForeground mt-0.5">
                            had {fmtInt(row.dead_points_before)} pts
                          </div>
                        )}
                      </td>
                      <td className="p-2 text-mutedForeground">
                        <ArrowRight className="w-3.5 h-3.5" />
                      </td>
                      <td className="p-2">
                        <span className="text-emerald-300 font-bold">{toUser || '—'}</span>
                      </td>
                      <td className="p-2 text-right">
                        {(row.points_transferred || 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 text-violet-300 font-bold">
                            <Star className="w-3 h-3" />
                            +{fmtInt(row.points_transferred)}
                          </span>
                        ) : (
                          <span className="text-mutedForeground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-right text-green-300/90">
                        {fmtMoney(row.money_transferred) || fmtMoney(row.swiss_transferred) || '—'}
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isOpen ? null : row.id)}
                          className="text-[9px] uppercase text-primary hover:underline"
                        >
                          {isOpen ? 'Less' : 'More'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.map((row) => expandedId === row.id && (
          <div key={`${row.id}-detail`} className="border-t border-zinc-800/80 bg-zinc-900/40 p-3">
            <TransferDetail row={row} />
          </div>
        ))}
      </section>

      <p className="text-[9px] text-mutedForeground font-heading leading-snug flex items-start gap-1.5">
        <Coins className="w-3 h-3 shrink-0 mt-0.5" />
        Retrieve moves all points currently on the dead account (including post-death refunds), zeros the dead wallet,
        and credits the living account. Supplemental retrieves appear when Swiss, Game Pass, or extra points are claimed
        after the first transfer.
      </p>
    </div>
  );
}
