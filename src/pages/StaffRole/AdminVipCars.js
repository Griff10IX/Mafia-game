import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Car, RefreshCw, Trash2, Crown } from 'lucide-react';
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

function sourceLabel(src) {
  if (src === 'game_pass_tier_100') return 'Game Pass';
  if (src === 'store_purchase') return 'Store';
  if (src === 'revive_estate_heal') return 'Revive heal';
  return src || '?';
}

export default function AdminVipCars() {
  const navigate = useNavigate();
  const [accessChecked, setAccessChecked] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionKey, setActionKey] = useState(null);
  const [clearGrant, setClearGrant] = useState(false);
  const [removeCounts, setRemoveCounts] = useState({});
  const [expandedUser, setExpandedUser] = useState(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [estateHealBusy, setEstateHealBusy] = useState(false);
  const [estateHealResult, setEstateHealResult] = useState(null);

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

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/vip-pass-car-stats');
      setStats(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load VIP Pass Car stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessChecked) loadStats();
  }, [accessChecked, loadStats]);

  // Group the flat owners list (one row per car) into one row per player.
  const ownersByUser = useMemo(() => {
    const map = new Map();
    for (const o of stats?.owners || []) {
      const key = o.user_id || o.username;
      if (!map.has(key)) {
        map.set(key, {
          user_id: o.user_id,
          username: o.username,
          is_dead: o.is_dead,
          game_pass_vip_car_granted: o.game_pass_vip_car_granted,
          cars: [],
        });
      }
      map.get(key).cars.push(o);
    }
    const list = [...map.values()];
    list.sort((a, b) => b.cars.length - a.cars.length || String(a.username).localeCompare(String(b.username)));
    return list;
  }, [stats]);

  const runDeadAliveBackfill = async (dryRun) => {
    if (!dryRun) {
      const ok = window.confirm(
        'Transfer VIP Pass Cars still on dead accounts to their Dead → Alive recipients and send inbox notifications?'
      );
      if (!ok) return;
    }
    setBackfillBusy(true);
    try {
      const res = await api.post('/admin/vip-pass-car-dead-alive-backfill', null, {
        params: { dry_run: dryRun },
      });
      setBackfillResult(res.data || null);
      toast.success(res.data?.message || (dryRun ? 'Dry run done' : 'Backfill done'));
      if (!dryRun) await loadStats();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Backfill failed');
    } finally {
      setBackfillBusy(false);
    }
  };

  const runEstateHeal = async (dryRun) => {
    if (!dryRun) {
      const ok = window.confirm(
        'Heal Dead → Alive estate gaps: restore missing illegal businesses (both keep), claw back exclusive weed specials, VIP inheritance transfer + missing VIP car re-grants?'
      );
      if (!ok) return;
    }
    setEstateHealBusy(true);
    try {
      const res = await api.post('/admin/dead-alive-estate-heal', null, {
        params: { dry_run: dryRun },
      });
      setEstateHealResult(res.data || null);
      toast.success(res.data?.message || (dryRun ? 'Dry run done' : 'Estate heal done'));
      if (!dryRun) await loadStats();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Estate heal failed');
    } finally {
      setEstateHealBusy(false);
    }
  };

  const removeByCarId = async (owner, car) => {
    const msg = clearGrant
      ? `Remove this VIP Pass Car from ${owner.username} and clear their Game Pass free-grant flag?`
      : `Remove this VIP Pass Car (${sourceLabel(car.grant_source)}, ${formatAdminDateTime(car.acquired_at)}) from ${owner.username}?`;
    if (!window.confirm(msg)) return;
    setActionKey(`car:${car.user_car_id}`);
    try {
      const res = await api.post('/admin/vip-pass-car-remove', {
        user_car_id: car.user_car_id,
        username: owner.username,
        clear_game_pass_grant: clearGrant,
      });
      toast.success(res.data?.message || 'Removed');
      await loadStats();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Remove failed');
    } finally {
      setActionKey(null);
    }
  };

  const removeCountForUser = async (owner, overrideCount) => {
    const total = owner.cars.length;
    const raw = overrideCount != null ? overrideCount : removeCounts[owner.user_id];
    const n = Math.max(1, Math.min(total, parseInt(String(raw ?? '').replace(/\D/g, ''), 10) || 1));
    const removingAll = n >= total;
    const msg = removingAll
      ? `Remove ALL ${total} VIP Pass Car(s) from ${owner.username}?${clearGrant ? ' Their Game Pass free-grant flag will also be cleared.' : ''}`
      : `Remove ${n} of ${total} VIP Pass Car(s) from ${owner.username}? Newest acquired are removed first.${clearGrant ? ' Their Game Pass free-grant flag will also be cleared.' : ''}`;
    if (!window.confirm(msg)) return;
    setActionKey(`user:${owner.user_id}`);
    try {
      const res = await api.post('/admin/vip-pass-car-remove', {
        username: owner.username,
        count: removingAll ? 0 : n,
        clear_game_pass_grant: clearGrant,
      });
      toast.success(res.data?.message || 'Removed');
      setRemoveCounts((prev) => ({ ...prev, [owner.user_id]: '' }));
      await loadStats();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Remove failed');
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

  return (
    <div className="space-y-4 max-w-3xl" data-testid="admin-vip-cars-page">
      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Crown className="text-primary" size={18} />
            <h1 className="text-sm font-heading font-bold uppercase tracking-wider text-foreground">
              VIP Pass car manager
            </h1>
            <Btn
              onClick={loadStats}
              disabled={loading}
              className="ml-auto border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            >
              <RefreshCw size={11} className="inline mr-1 -mt-0.5" />
              {loading ? '…' : 'Refresh'}
            </Btn>
          </div>
          <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
            Everyone holding a VIP Pass Car (car22), grouped per player. Remove a specific car, a chosen number
            (newest acquired removed first), or all of a player&apos;s VIP cars. Store stock limit lives in{' '}
            <Link to="/tjjeujr3wa/overview" className="text-primary hover:underline">Admin → overview</Link>.
          </p>

          {stats && (
            <div className="flex flex-wrap gap-2 text-[9px] font-heading border-t border-zinc-700/50 pt-3">
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                In game: <span className="font-bold text-foreground">{Number(stats.cars_in_game || 0).toLocaleString()}</span>
              </span>
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                Store stock: <span className="font-bold text-foreground">{Number(stats.store_limited_in_game || 0).toLocaleString()}</span>
                /{Number(stats.purchase_limit || 0).toLocaleString()}
              </span>
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                Game Pass free: <span className="font-bold text-foreground">{Number(stats.game_pass_cars_in_game || 0).toLocaleString()}</span>
              </span>
              <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                Owner accounts: <span className="font-bold text-foreground">{Number(stats.owner_accounts || 0).toLocaleString()}</span>
              </span>
            </div>
          )}

          <label className="flex items-center gap-2 text-[10px] font-heading text-mutedForeground cursor-pointer">
            <input
              type="checkbox"
              checked={clearGrant}
              onChange={(e) => setClearGrant(e.target.checked)}
              className="accent-primary"
            />
            Also clear the Game Pass free-grant flag on removal (lets them earn the tier-100 car again)
          </label>

          <div className="border-t border-zinc-700/50 pt-3 space-y-2">
            <div className="text-[10px] font-heading font-bold uppercase tracking-wider text-emerald-300">
              Dead → Alive VIP car backfill
            </div>
            <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
              Moves VIP Pass Cars still on dead accounts to the alive recipient of Claim Inheritance, and sends them an inbox message. Safe to re-run.
            </p>
            <div className="flex flex-wrap gap-2">
              <Btn
                onClick={() => runDeadAliveBackfill(true)}
                disabled={backfillBusy || estateHealBusy || !!actionKey}
                className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              >
                {backfillBusy ? '…' : 'Dry run'}
              </Btn>
              <Btn
                onClick={() => runDeadAliveBackfill(false)}
                disabled={backfillBusy || estateHealBusy || !!actionKey}
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              >
                {backfillBusy ? '…' : 'Apply transfer + notify'}
              </Btn>
            </div>
            {backfillResult && (
              <div className="rounded border border-zinc-700/50 bg-zinc-900/50 p-2 space-y-1 text-[9px] font-heading text-mutedForeground">
                <div className="text-foreground">
                  {backfillResult.dry_run ? 'Dry run' : 'Applied'}:{' '}
                  {Number(backfillResult.transferred_cars || 0)} car(s) →{' '}
                  {Number(backfillResult.transferred_users || 0)} player(s)
                  {Number(backfillResult.skipped || 0) > 0
                    ? ` · skipped ${backfillResult.skipped}`
                    : ''}
                </div>
                {(backfillResult.transfers || []).slice(0, 40).map((t) => (
                  <div key={`${t.dead_username}-${t.recipient_username}`}>
                    {t.dead_username} → {t.recipient_username}: {t.cars} car
                    {t.cars === 1 ? '' : 's'}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-zinc-700/50 pt-3 space-y-2">
            <div className="text-[10px] font-heading font-bold uppercase tracking-wider text-amber-200">
              Dead → Alive estate heal
            </div>
            <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
              Fixes already-broken accounts after past revives: missing illegal business (killer keeps theirs; victim gets a restored copy), exclusive weed special clawback, VIP inheritance transfer, and VIP car re-grant when the grant flag is set but garage has zero car22. Prefer dry run first.
            </p>
            <div className="flex flex-wrap gap-2">
              <Btn
                onClick={() => runEstateHeal(true)}
                disabled={estateHealBusy || backfillBusy || !!actionKey}
                className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              >
                {estateHealBusy ? '…' : 'Dry run'}
              </Btn>
              <Btn
                onClick={() => runEstateHeal(false)}
                disabled={estateHealBusy || backfillBusy || !!actionKey}
                className="border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
              >
                {estateHealBusy ? '…' : 'Apply estate heal'}
              </Btn>
            </div>
            {estateHealResult && (
              <div className="rounded border border-zinc-700/50 bg-zinc-900/50 p-2 space-y-1 text-[9px] font-heading text-mutedForeground">
                <div className="text-foreground">
                  {estateHealResult.dry_run ? 'Dry run' : 'Applied'}: biz{' '}
                  {Number(estateHealResult.totals?.biz_healed || 0)}, weed{' '}
                  {Number(estateHealResult.totals?.weed_healed || 0)}, VIP re-grant{' '}
                  {Number(estateHealResult.totals?.vip_regrant_healed || 0)}, VIP inheritance cars{' '}
                  {Number(estateHealResult.totals?.vip_inheritance_cars || 0)}
                </div>
                {(estateHealResult.illegal_business?.actions || []).slice(0, 20).map((a) => (
                  <div key={`biz-${a.victim_id}-${a.kind}`}>
                    biz · {a.username || a.victim_id}: {a.kind}
                  </div>
                ))}
                {(estateHealResult.exclusive_weed?.actions || []).slice(0, 20).map((a) => (
                  <div key={`weed-${a.victim_id}`}>
                    weed · {a.username || a.victim_id}: {(a.strain_ids || []).join(', ')}
                  </div>
                ))}
                {(estateHealResult.vip_pass_car?.regrant_actions || []).slice(0, 20).map((a) => (
                  <div key={`vip-${a.user_id}`}>
                    vip · {a.username || a.user_id}: re-grant
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`${styles.panel} rounded-lg border border-primary/20 p-4 space-y-3`}>
        <div className="text-[10px] font-heading font-bold uppercase text-mutedForeground">
          Owners {stats ? `(${ownersByUser.length})` : ''}
        </div>

        {loading && !stats ? (
          <p className="text-[10px] text-mutedForeground font-heading">Loading…</p>
        ) : ownersByUser.length === 0 ? (
          <p className="text-[10px] text-mutedForeground font-heading">No VIP Pass Cars in any garage.</p>
        ) : (
          <div className="space-y-2">
            {ownersByUser.map((owner) => {
              const busy = actionKey === `user:${owner.user_id}`;
              const expanded = expandedUser === owner.user_id;
              return (
                <div key={owner.user_id} className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Car size={13} className="text-primary" />
                    <Link
                      to={`/profile/${encodeURIComponent(owner.username)}`}
                      className="text-[11px] font-heading font-bold text-primary hover:underline"
                    >
                      {owner.username}
                    </Link>
                    {owner.is_dead ? <span className="text-red-400 text-[9px] font-heading">(dead)</span> : null}
                    <span className="rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-amber-200/90 text-[9px] font-heading">
                      {owner.cars.length} VIP car{owner.cars.length === 1 ? '' : 's'}
                    </span>
                    {owner.game_pass_vip_car_granted ? (
                      <span className="rounded border border-zinc-600/50 px-1.5 py-0.5 text-[9px] font-heading text-mutedForeground">
                        tier-100 grant used
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setExpandedUser(expanded ? null : owner.user_id)}
                      className="ml-auto text-[9px] text-primary hover:underline font-heading"
                    >
                      {expanded ? 'Hide cars' : 'Show cars'}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[9px] text-mutedForeground font-heading">Remove</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={removeCounts[owner.user_id] ?? ''}
                      onChange={(e) =>
                        setRemoveCounts((prev) => ({ ...prev, [owner.user_id]: e.target.value }))
                      }
                      placeholder="1"
                      className="w-12 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading text-center"
                    />
                    <span className="text-[9px] text-mutedForeground font-heading">of {owner.cars.length}</span>
                    <Btn
                      onClick={() => removeCountForUser(owner)}
                      disabled={!!actionKey}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                    >
                      <Trash2 size={11} className="inline mr-0.5" />
                      {busy ? '…' : 'Remove'}
                    </Btn>
                    <Btn
                      onClick={() => removeCountForUser(owner, owner.cars.length)}
                      disabled={!!actionKey}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                    >
                      Remove all
                    </Btn>
                  </div>

                  {expanded && (
                    <div className="space-y-1 border-t border-zinc-700/50 pt-2">
                      {owner.cars.map((car) => (
                        <div
                          key={car.user_car_id}
                          className="flex flex-wrap items-center gap-2 text-[9px] font-heading text-mutedForeground"
                        >
                          <span className="rounded border border-zinc-600/50 px-1.5 py-0.5">
                            {sourceLabel(car.grant_source)}
                          </span>
                          <span>{car.acquired_at ? formatAdminDateTime(car.acquired_at) : '—'}</span>
                          {car.listed_for_sale ? <span className="text-emerald-400">listed</span> : null}
                          {car.has_custom_image ? <span>custom image</span> : null}
                          <span className="font-mono opacity-60">{car.user_car_id}</span>
                          <Btn
                            onClick={() => removeByCarId(owner, car)}
                            disabled={!!actionKey}
                            className="ml-auto border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                          >
                            {actionKey === `car:${car.user_car_id}` ? '…' : 'Remove this one'}
                          </Btn>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
