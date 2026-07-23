import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Crosshair, Flame, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function Btn({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`px-2 py-1 rounded border text-[10px] font-heading font-bold uppercase tracking-wide disabled:opacity-50 touch-manipulation ${className}`}
    >
      {children}
    </button>
  );
}

const TABS = [
  {
    id: 'molotovs',
    label: 'Molotovs',
    endpoint: '/admin/molotovs-overview',
    Icon: Flame,
    empty: 'No molotov holders match.',
    blurb: 'Crime / Game Pass drops; spent on Attack (each molotov ≈ 250 bullets).',
  },
  {
    id: 'bullets',
    label: 'Bullets',
    endpoint: '/admin/bullets-overview',
    Icon: Crosshair,
    empty: 'No bullet holders match.',
    blurb: 'Player bullet balances (armoury, melts, rewards, combat spend).',
  },
];

export default function AdminMolotovs() {
  const navigate = useNavigate();
  const [accessChecked, setAccessChecked] = useState(false);
  const [tab, setTab] = useState('molotovs');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const activeTab = TABS.find((t) => t.id === tab) || TABS[0];

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(activeTab.endpoint, {
        params: {
          status,
          offset,
          limit,
          ...(searchApplied ? { search: searchApplied } : {}),
        },
      });
      setData(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || `Failed to load ${activeTab.label.toLowerCase()}`);
      if (e.response?.status === 403) navigate('/dashboard', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [activeTab.endpoint, activeTab.label, status, offset, searchApplied, navigate]);

  useEffect(() => {
    if (accessChecked) load();
  }, [accessChecked, load]);

  const switchTab = (id) => {
    if (id === tab) return;
    setTab(id);
    setOffset(0);
    setData(null);
  };

  const applySearch = (e) => {
    e?.preventDefault?.();
    setOffset(0);
    setSearchApplied(search.trim());
  };

  if (!accessChecked) {
    return (
      <div className={`${styles.panel} rounded-lg border border-primary/20 p-6 text-center text-mutedForeground font-heading text-sm`}>
        Checking access…
      </div>
    );
  }

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const holders = Number(data?.holders_with_balance || 0);
  const canPrev = offset > 0;
  const canNext = offset + rows.length < holders;
  const TabIcon = activeTab.Icon;

  return (
    <div className="space-y-4 max-w-3xl" data-testid="admin-molotovs-page">
      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TabIcon className="text-primary" size={18} />
            <h1 className="text-sm font-heading font-bold uppercase tracking-wider text-foreground">
              Ammo inventory
            </h1>
            <Btn
              onClick={load}
              disabled={loading}
              className="ml-auto border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            >
              <RefreshCw size={11} className="inline mr-1 -mt-0.5" />
              {loading ? '…' : 'Refresh'}
            </Btn>
          </div>
          <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
            Who holds {activeTab.label.toLowerCase()} and how many are in circulation. {activeTab.blurb} Open a
            player from{' '}
            <Link to="/tjjeujr3wa/players" className="text-primary hover:underline">Players</Link>.
          </p>

          <div className="flex flex-wrap gap-1.5 border-t border-zinc-700/50 pt-3">
            {TABS.map((t) => {
              const Icon = t.Icon;
              const on = t.id === tab;
              return (
                <Btn
                  key={t.id}
                  type="button"
                  onClick={() => switchTab(t.id)}
                  className={
                    on
                      ? 'border-primary/50 bg-primary/20 text-primary'
                      : 'border-zinc-600/50 text-mutedForeground hover:border-primary/30'
                  }
                >
                  <Icon size={11} className="inline mr-1 -mt-0.5" />
                  {t.label}
                </Btn>
              );
            })}
          </div>

          {data && (
            <div className="flex flex-wrap gap-2 text-[9px] font-heading border-t border-zinc-700/50 pt-3">
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                In game:{' '}
                <span className="font-bold text-foreground">
                  {Number(data.circulating_total || 0).toLocaleString()}
                </span>
              </span>
              <span className="rounded border border-emerald-600/40 px-1.5 py-0.5 text-emerald-300/90">
                Alive:{' '}
                <span className="font-bold">
                  {Number(data.alive_circulating || 0).toLocaleString()}
                </span>
              </span>
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5 text-zinc-400">
                Dead:{' '}
                <span className="font-bold text-foreground">
                  {Number(data.dead_circulating || 0).toLocaleString()}
                </span>
              </span>
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                Holders:{' '}
                <span className="font-bold text-foreground">{holders.toLocaleString()}</span>
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t border-zinc-700/50 pt-3">
            <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wide">
              Status
              <select
                value={status}
                onChange={(e) => {
                  setOffset(0);
                  setStatus(e.target.value);
                }}
                className="mt-0.5 block w-full min-w-[7rem] rounded border border-zinc-600/60 bg-zinc-950/60 px-2 py-1 text-[10px] text-foreground"
              >
                <option value="all">All</option>
                <option value="alive">Alive</option>
                <option value="dead">Dead</option>
              </select>
            </label>
            <form onSubmit={applySearch} className="flex flex-wrap items-end gap-1.5 flex-1 min-w-[12rem]">
              <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wide flex-1 min-w-[8rem]">
                Username
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="mt-0.5 block w-full rounded border border-zinc-600/60 bg-zinc-950/60 px-2 py-1 text-[10px] text-foreground"
                />
              </label>
              <Btn type="submit" className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20">
                Search
              </Btn>
              {searchApplied ? (
                <Btn
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setSearchApplied('');
                    setOffset(0);
                  }}
                  className="border-zinc-600/50 text-mutedForeground"
                >
                  Clear
                </Btn>
              ) : null}
            </form>
          </div>
        </div>
      </div>

      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="px-3 py-2 border-b border-zinc-700/50 flex items-center justify-between gap-2">
          <span className="text-[10px] font-heading font-bold uppercase tracking-wider text-primary">
            {activeTab.label} holders{' '}
            {holders ? `(${Math.min(offset + 1, holders)}–${Math.min(offset + rows.length, holders)} of ${holders})` : ''}
          </span>
          <div className="flex gap-1">
            <Btn
              disabled={!canPrev || loading}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              className="border-zinc-600/50 text-mutedForeground"
            >
              Prev
            </Btn>
            <Btn
              disabled={!canNext || loading}
              onClick={() => setOffset((o) => o + limit)}
              className="border-zinc-600/50 text-mutedForeground"
            >
              Next
            </Btn>
          </div>
        </div>
        {loading && !rows.length ? (
          <p className="p-4 text-[10px] text-mutedForeground font-heading">Loading…</p>
        ) : !rows.length ? (
          <p className="p-4 text-[10px] text-mutedForeground font-heading">{activeTab.empty}</p>
        ) : (
          <ul className="divide-y divide-zinc-800/80">
            {rows.map((r) => (
              <li key={r.user_id || r.username} className="px-3 py-2 flex items-center gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      to={`/tjjeujr3wa/players?u=${encodeURIComponent(r.username || '')}`}
                      className="text-[11px] font-heading font-bold text-foreground hover:text-primary truncate"
                    >
                      {r.username}
                    </Link>
                    {r.is_dead ? (
                      <span className="text-[8px] font-heading uppercase tracking-wide rounded border border-zinc-600/50 px-1 py-0.5 text-zinc-400">
                        Dead
                      </span>
                    ) : null}
                  </div>
                  {r.last_seen ? (
                    <p className="text-[9px] text-mutedForeground font-heading">
                      Last seen {formatAdminDateTime(r.last_seen)}
                    </p>
                  ) : null}
                </div>
                <span className="text-[12px] font-heading font-bold text-amber-300 tabular-nums">
                  {Number(r.amount ?? r[tab] ?? 0).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
