import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building, Plane, RefreshCw, Search } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function Btn({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`px-2 py-1.5 rounded border text-[10px] font-heading font-bold uppercase tracking-wide disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export default function AdminPropertyTransfer() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(false);

  const [fromUser, setFromUser] = useState(searchParams.get('from') || '');
  const [toUser, setToUser] = useState(searchParams.get('to') || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionKey, setActionKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/admin/check');
        if (cancelled) return;
        if (!res.data?.is_admin) {
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

  const loadFrom = useCallback(
    async (override) => {
      const un = (override != null ? String(override) : fromUser).trim();
      if (!un) {
        toast.error('Enter from username');
        return;
      }
      setLoading(true);
      try {
        const res = await api.get('/admin/properties/armoury-airport', { params: { username: un } });
        setData(res.data || null);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('from', un);
          return next;
        });
      } catch (e) {
        toast.error(e.response?.data?.detail || 'Failed to load');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [fromUser, setSearchParams],
  );

  useEffect(() => {
    if (!accessChecked) return;
    const f = searchParams.get('from');
    if (f) {
      setFromUser(f);
      loadFrom(f);
    }
    const t = searchParams.get('to');
    if (t) setToUser(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessChecked]);

  const runTransfer = async (assetKind, location, slot, previewOnly) => {
    const from = (data?.username || fromUser).trim();
    const to = toUser.trim();
    if (!from || !to) {
      toast.error('Set from (loaded) and to username');
      return;
    }
    const key = `${assetKind}:${location}:${slot}:${previewOnly}`;
    setActionKey(key);
    try {
      const base = {
        from_username: from,
        to_username: to,
        asset_kind: assetKind,
        location: location || undefined,
        slot: slot != null ? slot : undefined,
        allow_recipient_already_owns: true,
        notify: true,
      };
      const preview = await api.post('/admin/properties/transfer-armoury-airport', { ...base, dry_run: true });
      if (previewOnly) {
        toast.success(preview.data?.message || 'Preview OK');
        return;
      }
      if (!window.confirm(preview.data?.message || 'Transfer this property?')) return;
      const done = await api.post('/admin/properties/transfer-armoury-airport', { ...base, dry_run: false });
      toast.success(done.data?.message || 'Transferred');
      await loadFrom(from);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Transfer failed');
    } finally {
      setActionKey(null);
    }
  };

  const runRelease = async (assetKind, location, slot) => {
    const un = (data?.username || fromUser).trim();
    if (!un) return;
    if (!window.confirm(`Release ${assetKind} from ${un}?`)) return;
    const key = `release:${assetKind}:${location}`;
    setActionKey(key);
    try {
      const res = await api.post('/admin/properties/release-armoury-airport', {
        username: un,
        asset_kind: assetKind,
        location: location || undefined,
        slot: slot != null ? slot : undefined,
      });
      toast.success(res.data?.message || 'Released');
      await loadFrom(un);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Release failed');
    } finally {
      setActionKey(null);
    }
  };

  if (!accessChecked) {
    return (
      <div className={`${styles.panel} rounded-lg border border-primary/20 p-6 text-center text-mutedForeground text-sm font-heading`}>
        Checking access…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl" data-testid="admin-property-transfer-page">
      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="p-4 space-y-2">
          <h1 className="text-sm font-heading font-bold uppercase tracking-wider">Armoury & airport transfer</h1>
          <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
            Remove armoury (bullet factory) or airport from one player and assign to another. Works for living or dead
            owners. Dead-only casino transfers remain under Admin → Dead owner properties.
          </p>
          <Link to="/tjjeujr3wa/overview#casinosDeadOwners" className="text-[10px] text-primary hover:underline font-heading">
            Dead owner properties (casinos + killer transfer)
          </Link>
          {' · '}
          <Link to="/tjjeujr3wa/overview" className="text-[10px] text-primary hover:underline font-heading">
            Admin home
          </Link>
        </div>
      </div>

      <div className={`${styles.panel} rounded-lg border border-primary/25 p-4 space-y-3`}>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex-1 min-w-[120px]">
            <span className="text-[9px] uppercase text-mutedForeground font-heading">From (current owner)</span>
            <input
              type="text"
              value={fromUser}
              onChange={(e) => setFromUser(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadFrom()}
              className="w-full mt-0.5 px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
            />
          </label>
          <label className="flex-1 min-w-[120px]">
            <span className="text-[9px] uppercase text-mutedForeground font-heading">To (new owner)</span>
            <input
              type="text"
              value={toUser}
              onChange={(e) => setToUser(e.target.value)}
              className="w-full mt-0.5 px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
            />
          </label>
          <Btn onClick={() => loadFrom()} disabled={loading} className="border-primary/40 bg-primary/10 text-primary">
            <Search size={12} className="inline mr-1" />
            {loading ? '…' : 'Load'}
          </Btn>
        </div>

        {data && (
          <div className="text-[10px] font-heading space-y-3 border-t border-zinc-700/50 pt-3">
            <p>
              <span className="text-foreground font-bold">{data.username}</span>
              {data.is_dead ? <span className="text-red-400 ml-2">dead</span> : null}
              {data.is_dead && data.killed_by_username ? (
                <span className="text-mutedForeground ml-2">· killed by {data.killed_by_username}</span>
              ) : null}
            </p>

            <div className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2">
              <div className="flex items-center gap-2 text-primary font-bold uppercase text-[9px] mb-1">
                <Building size={12} /> Armoury
              </div>
              {data.armoury ? (
                <>
                  <p className="text-foreground">
                    {data.armoury.state} · ${Number(data.armoury.price_per_bullet || 0).toLocaleString()}/bullet
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Btn
                      onClick={() => runTransfer('armoury', data.armoury.state, null, true)}
                      disabled={!!actionKey}
                      className="border-zinc-600/50 text-mutedForeground"
                    >
                      Preview
                    </Btn>
                    <Btn
                      onClick={() => runTransfer('armoury', data.armoury.state, null, false)}
                      disabled={!!actionKey || !toUser.trim()}
                      className="border-primary/40 bg-primary/10 text-primary"
                    >
                      → Transfer
                    </Btn>
                    <Btn
                      onClick={() => runRelease('armoury', data.armoury.state, null)}
                      disabled={!!actionKey}
                      className="border-red-500/40 bg-red-500/10 text-red-300"
                    >
                      Release
                    </Btn>
                  </div>
                </>
              ) : (
                <p className="text-mutedForeground">No armoury owned</p>
              )}
            </div>

            <div className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2">
              <div className="flex items-center gap-2 text-sky-300 font-bold uppercase text-[9px] mb-1">
                <Plane size={12} /> Airport
              </div>
              {(data.airports || []).length === 0 ? (
                <p className="text-mutedForeground">No airport owned</p>
              ) : (
                <div className="space-y-2">
                  {(data.airports || []).map((ap) => (
                    <div key={`${ap.state}-${ap.slot}`} className="border-t border-zinc-800/60 pt-2 first:border-0 first:pt-0">
                      <p className="text-foreground">
                        {ap.state} slot {ap.slot ?? 1} · travel ${Number(ap.price_per_travel || 0).toLocaleString()}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <Btn
                          onClick={() => runTransfer('airport', ap.state, ap.slot ?? 1, true)}
                          disabled={!!actionKey}
                          className="border-zinc-600/50 text-mutedForeground"
                        >
                          Preview
                        </Btn>
                        <Btn
                          onClick={() => runTransfer('airport', ap.state, ap.slot ?? 1, false)}
                          disabled={!!actionKey || !toUser.trim()}
                          className="border-primary/40 bg-primary/10 text-primary"
                        >
                          → Transfer
                        </Btn>
                        <Btn
                          onClick={() => runRelease('airport', ap.state, ap.slot ?? 1)}
                          disabled={!!actionKey}
                          className="border-red-500/40 bg-red-500/10 text-red-300"
                        >
                          Release
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => loadFrom(data.username)}
              className="text-[9px] text-primary hover:underline flex items-center gap-1"
            >
              <RefreshCw size={10} /> Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
