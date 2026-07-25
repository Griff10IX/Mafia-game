import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Car, RefreshCw, Search, ArrowRightLeft, Trash2, Gift } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const EXCLUSIVE_OPTIONS = [
  { id: 'car20', label: 'car20 — Al Capone (GTA exclusive)' },
  { id: 'car21', label: 'car21 — Cadillac V-16 (legacy loot exclusive)' },
  { id: 'car23', label: 'car23 — Duesenberg Model SJ (loot exclusive, 2s)' },
];

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

export default function AdminExclusiveCars() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(false);

  const [username, setUsername] = useState(searchParams.get('user') || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [grantUsername, setGrantUsername] = useState('');
  const [grantCarId, setGrantCarId] = useState('car21');
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

  const loadUser = useCallback(
    async (overrideUser) => {
      const un = (overrideUser != null ? String(overrideUser) : username).trim();
      if (!un) {
        toast.error('Enter a username');
        return;
      }
      setLoading(true);
      setData(null);
      try {
        const res = await api.get('/admin/cars/user-exclusive', { params: { username: un } });
        setData(res.data || null);
        setGrantUsername(un);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('user', un);
          return next;
        });
        toast.success(`Loaded ${(res.data?.cars || []).length} exclusive car(s) for ${res.data?.username || un}`);
      } catch (e) {
        toast.error(e.response?.data?.detail || 'Failed to load');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [username, setSearchParams],
  );

  useEffect(() => {
    if (!accessChecked) return;
    const u = searchParams.get('user');
    if (u) {
      setUsername(u);
      loadUser(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessChecked]);

  const handleRemove = async (car) => {
    const un = data?.username;
    if (!un || !car?.car_id) return;
    if (!window.confirm(`Remove ${car.car_name} from ${un}? This cannot be undone.`)) return;
    const key = `remove:${car.user_car_id}`;
    setActionKey(key);
    try {
      const res = await api.post(
        `/admin/remove-car?target_username=${encodeURIComponent(un)}&car_id=${encodeURIComponent(car.car_id)}`,
      );
      toast.success(res.data?.message || 'Removed');
      await loadUser(un);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Remove failed');
    } finally {
      setActionKey(null);
    }
  };

  const handleTransfer = async (car, toUser) => {
    const from = data?.username;
    const to = (toUser || transferTo || '').trim();
    if (!from || !to) {
      toast.error('Enter recipient username');
      return;
    }
    const key = `xfer:${car.user_car_id}:${to}`;
    setActionKey(key);
    try {
      const payload = {
        from_username: from,
        to_username: to,
        car_id: car.car_id,
        user_car_id: car.user_car_id,
        dry_run: true,
        replace_recipient_duplicate: true,
        notify: true,
      };
      const preview = await api.post('/admin/cars/transfer-exclusive', payload);
      if (!window.confirm(preview.data?.message || `Transfer ${car.car_name} to ${to}?`)) return;
      const res = await api.post('/admin/cars/transfer-exclusive', { ...payload, dry_run: false });
      toast.success(res.data?.message || 'Transferred');
      await loadUser(from);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Transfer failed');
    } finally {
      setActionKey(null);
    }
  };

  const handleTransferToKiller = async (car) => {
    const killer = data?.killed_by_username;
    if (!killer) {
      toast.error('No recorded killer on this account');
      return;
    }
    await handleTransfer(car, killer);
  };

  const handleGrant = async () => {
    const un = grantUsername.trim();
    if (!un) {
      toast.error('Enter username to grant to');
      return;
    }
    const opt = EXCLUSIVE_OPTIONS.find((o) => o.id === grantCarId);
    if (!window.confirm(`Grant ${opt?.label || grantCarId} to ${un}?`)) return;
    setActionKey(`grant:${grantCarId}:${un}`);
    try {
      const res = await api.post(
        `/admin/add-car?target_username=${encodeURIComponent(un)}&car_id=${encodeURIComponent(grantCarId)}`,
      );
      toast.success(res.data?.message || 'Granted');
      if (data?.username?.toLowerCase() === un.toLowerCase()) {
        await loadUser(un);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Grant failed');
    } finally {
      setActionKey(null);
    }
  };

  if (!accessChecked) {
    return (
      <div className={`${styles.panel} rounded-lg border border-primary/20 p-6 text-center text-mutedForeground font-heading text-sm`}>
        Checking access…
      </div>
    );
  }

  const global = data?.global_owners || {};

  return (
    <div className="space-y-4 max-w-3xl" data-testid="admin-exclusive-cars-page">
      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Car className="text-primary" size={18} />
            <h1 className="text-sm font-heading font-bold uppercase tracking-wider text-foreground">
              Exclusive car manager
            </h1>
          </div>
          <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
            Remove or transfer Al Capone (car20), Cadillac V-16 (car21), and Model SJ (car23). Granting updates global
            caps and the GTA pool automatically. For full timelines use{' '}
            <Link to="/tjjeujr3wa/overview#gtaPool" className="text-primary hover:underline">
              Admin → GTA exclusive pool
            </Link>
            .
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadUser()}
              placeholder="Username"
              className="flex-1 min-w-[140px] px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
            />
            <Btn
              onClick={() => loadUser()}
              disabled={loading}
              className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            >
              <Search size={12} className="inline mr-1 -mt-0.5" />
              {loading ? '…' : 'Load'}
            </Btn>
            <Link to="/tjjeujr3wa/overview" className="text-[10px] text-primary hover:underline font-heading">
              ← Admin home
            </Link>
          </div>

          {data && (
            <div className="text-[10px] font-heading space-y-2 border-t border-zinc-700/50 pt-3">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  <span className="text-mutedForeground">User:</span>{' '}
                  <Link to={`/profile/${encodeURIComponent(data.username)}`} className="text-primary hover:underline font-bold">
                    {data.username}
                  </Link>
                  {data.is_dead ? <span className="text-red-400 ml-1">(dead)</span> : null}
                </span>
                {data.is_dead && data.killed_by_username ? (
                  <span className="text-mutedForeground">
                    killed by <span className="text-foreground">{data.killed_by_username}</span>
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 text-[9px]">
                <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                  Loot car claimed flag: {data.loot_exclusive_car_claimed ? '1' : '0'}
                </span>
                <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                  GTA pool: {data.gta_exclusive_pool_released ? 'open (no car20)' : 'closed (car20 exists)'}
                </span>
                {EXCLUSIVE_OPTIONS.map((o) => {
                  const g = global[o.id] || {};
                  return (
                    <span key={o.id} className="rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-amber-200/90">
                      {o.id}: {g.count ? `held by ${g.holder_username || '?'}` : 'unowned'}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {data && (
        <div className={`${styles.panel} rounded-lg border border-primary/20 p-4 space-y-3`}>
          <div className="text-[10px] font-heading font-bold uppercase text-mutedForeground">Garage — exclusive cars</div>
          {(data.cars || []).length === 0 ? (
            <p className="text-[10px] text-mutedForeground font-heading">No exclusive or loot-exclusive cars in this garage.</p>
          ) : (
            <div className="space-y-2">
              {(data.cars || []).map((car) => (
                <div
                  key={car.user_car_id}
                  className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2 space-y-2"
                >
                  <div className="text-[11px] font-heading text-foreground">
                    {car.car_name}{' '}
                    <span className="text-amber-300/80 text-[9px]">({car.rarity || car.car_id})</span>
                    {car.listed_for_sale ? (
                      <span className="text-emerald-400 text-[9px] ml-1">listed ${Number(car.sale_price || 0).toLocaleString()}</span>
                    ) : null}
                  </div>
                  <div className="text-[9px] text-mutedForeground font-mono">
                    garage id: {car.user_car_id}
                    {car.acquired_at ? ` · ${formatAdminDateTime(car.acquired_at)}` : ''}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Btn
                      onClick={() => handleRemove(car)}
                      disabled={!!actionKey}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                    >
                      <Trash2 size={11} className="inline mr-0.5" />
                      {actionKey === `remove:${car.user_car_id}` ? '…' : 'Remove'}
                    </Btn>
                    <input
                      type="text"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      placeholder="Transfer to username"
                      className="w-36 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
                    />
                    <Btn
                      onClick={() => handleTransfer(car)}
                      disabled={!!actionKey}
                      className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                    >
                      <ArrowRightLeft size={11} className="inline mr-0.5" />
                      {actionKey?.startsWith(`xfer:${car.user_car_id}`) ? '…' : 'Transfer'}
                    </Btn>
                    {data.is_dead && data.killed_by_username ? (
                      <Btn
                        onClick={() => handleTransferToKiller(car)}
                        disabled={!!actionKey}
                        className="border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                      >
                        → killer ({data.killed_by_username})
                      </Btn>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-zinc-700/50 pt-3 space-y-2">
            <div className="text-[10px] font-heading font-bold uppercase text-mutedForeground flex items-center gap-1">
              <Gift size={12} /> Grant exclusive car
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={grantUsername}
                onChange={(e) => setGrantUsername(e.target.value)}
                placeholder="Username"
                className="w-32 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
              />
              <select
                value={grantCarId}
                onChange={(e) => setGrantCarId(e.target.value)}
                className="px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading max-w-[220px]"
              >
                {EXCLUSIVE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Btn
                onClick={handleGrant}
                disabled={!!actionKey}
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              >
                {actionKey?.startsWith('grant:') ? '…' : 'Grant'}
              </Btn>
            </div>
            <p className="text-[9px] text-mutedForeground font-heading">
              Only one of each exclusive id (car20 / car21 / car23) can exist game-wide. Grant fails if another player
              already holds that car.
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadUser(data.username)}
            disabled={loading}
            className="text-[9px] text-primary hover:underline font-heading flex items-center gap-1"
          >
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      )}
    </div>
  );
}
