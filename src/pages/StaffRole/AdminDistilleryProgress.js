import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Wine } from 'lucide-react';
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

function fmtMoney(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString()}` : '—';
}

function fmtLane(lane) {
  return String(lane || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const EQUIPMENT_LANES = ['stills', 'condensers', 'mash_tun', 'barrels', 'bottling', 'tunnel', 'bribe_office', 'fake_labels', 'quality_lab'];
const SPECIAL_TRACKS = ['production', 'aging', 'logistics', 'stealth', 'labor', 'black_market'];
const EQUIPMENT_MAX = 20;
const SPECIAL_MAX_TIER = 30;

function UpgradesPreviewPanel({ preview, onApply, onDismiss, applying }) {
  if (!preview) return null;
  const before = preview.before || {};
  const after = preview.after || {};
  const changes = preview.changes || [];
  return (
    <div className="rounded border border-emerald-500/35 bg-emerald-950/20 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[10px] font-heading font-bold text-emerald-200">
          Upgrade preview · {changes.length} change{changes.length === 1 ? '' : 's'}
        </p>
        <button type="button" onClick={onDismiss} className="text-[9px] text-mutedForeground hover:text-foreground uppercase">
          Dismiss
        </button>
      </div>
      {preview.provision?.message ? (
        <p className="text-[9px] text-amber-200/90">{preview.provision.message}</p>
      ) : null}
      {changes.length > 0 ? (
        <ul className="text-[9px] font-heading text-emerald-100/90 space-y-0.5 max-h-32 overflow-y-auto">
          {changes.map((line) => (
            <li key={line}>• {line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[9px] text-mutedForeground">No changes.</p>
      )}
      <div className="grid grid-cols-2 gap-2 text-[9px] font-heading">
        <div>
          <span className="text-mutedForeground">Progress:</span>{' '}
          {before.progress_pct ?? '—'}% → <span className="text-emerald-200 font-semibold">{after.progress_pct ?? '—'}%</span>
        </div>
        <div>
          <span className="text-mutedForeground">Specials:</span>{' '}
          {before.special_steps ?? 0} → <span className="text-emerald-200 font-semibold">{after.special_steps ?? 0}</span>
        </div>
      </div>
      {(preview.equipment_changes || []).length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-0.5 text-[9px] font-heading">
          {preview.equipment_changes.map(({ lane, before: b, after: a }) => (
            <div key={lane}>
              <span className="text-mutedForeground">{fmtLane(lane)}:</span>{' '}
              <span className="tabular-nums">{b}</span>
              <span className="text-mutedForeground"> → </span>
              <span className="tabular-nums text-emerald-200 font-semibold">{a}</span>
            </div>
          ))}
        </div>
      ) : null}
      <Btn
        onClick={onApply}
        disabled={applying || changes.length === 0}
        className="w-full border-emerald-400/45 bg-emerald-500/15 text-emerald-200"
      >
        {applying ? '…' : 'Apply upgrades'}
      </Btn>
    </div>
  );
}

function AdminDistilleryUpgradesPanel({
  data,
  username,
  upgradesLoading,
  upgradesPreview,
  trackTiers,
  setTrackTiers,
  onPreview,
  onApply,
  onDismiss,
}) {
  const detail = data?.distillery_detail;
  if (!detail) return null;

  return (
    <section className="rounded-lg border border-emerald-500/25 p-3 space-y-3 mt-3">
      <h2 className="text-[11px] font-heading font-bold uppercase text-emerald-300">Add distillery upgrades</h2>
      <p className="text-[9px] text-mutedForeground leading-snug">
        Grant equipment levels and special track unlocks free (no vault cost). Preview before applying.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-[9px] font-heading">
        {EQUIPMENT_LANES.map((lane) => {
          const lvl = detail.equipment?.[lane] ?? 0;
          return (
            <div key={lane} className="flex items-center justify-between gap-1">
              <span className="text-mutedForeground truncate">{fmtLane(lane)}</span>
              <span className="tabular-nums text-foreground font-semibold">{lvl}/{EQUIPMENT_MAX}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-mutedForeground">
        Special upgrades unlocked: <span className="text-emerald-300 font-semibold">{detail.special_steps ?? 0}</span>
        {' · '}
        Workers: {detail.workers_total ?? 0}/{detail.worker_cap ?? '—'}
      </p>

      <div className="space-y-2 border-t border-zinc-700/40 pt-2">
        <p className="text-[9px] font-heading font-bold uppercase text-emerald-300/90">Equipment</p>
        <div className="flex flex-wrap gap-1">
          <Btn onClick={() => onPreview({ add_all_equipment: 1 })} disabled={upgradesLoading} className="border-emerald-500/30 text-emerald-300">
            +1 all lanes
          </Btn>
          <Btn onClick={() => onPreview({ add_all_equipment: 5 })} disabled={upgradesLoading} className="border-emerald-500/30 text-emerald-300">
            +5 all lanes
          </Btn>
          {EQUIPMENT_LANES.map((lane) => (
            <Btn
              key={lane}
              onClick={() => onPreview({ equipment_add: { [lane]: 1 } })}
              disabled={upgradesLoading}
              className="border-zinc-600/50 text-zinc-300"
              title={fmtLane(lane)}
            >
              +1 {fmtLane(lane).split(' ')[0]}
            </Btn>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-zinc-700/40 pt-2">
        <p className="text-[9px] font-heading font-bold uppercase text-emerald-300/90">Special tracks</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {[1, 5, 10, 15, 30].map((t) => (
            <Btn
              key={t}
              onClick={() => onPreview({ unlock_all_special_tier: t })}
              disabled={upgradesLoading}
              className="border-emerald-500/30 text-emerald-300"
            >
              All tracks → tier {t}
            </Btn>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SPECIAL_TRACKS.map((track) => (
            <div key={track} className="flex flex-wrap items-center gap-1">
              <span className="text-[9px] text-mutedForeground w-20 shrink-0">{fmtLane(track)}</span>
              <input
                type="number"
                min={0}
                max={SPECIAL_MAX_TIER}
                value={trackTiers[track] ?? 1}
                onChange={(e) => setTrackTiers((p) => ({ ...p, [track]: e.target.value }))}
                className="w-14 px-1.5 py-0.5 rounded border border-input bg-transparent text-[10px] tabular-nums"
              />
              <Btn
                onClick={() => {
                  const tier = parseInt(String(trackTiers[track] ?? 1), 10);
                  if (Number.isNaN(tier) || tier < 0 || tier > SPECIAL_MAX_TIER) {
                    toast.error('Tier 0–30');
                    return;
                  }
                  onPreview({ unlock_special_tracks: { [track]: tier } });
                }}
                disabled={upgradesLoading}
                className="border-emerald-500/30 text-emerald-300 text-[9px]"
              >
                Unlock
              </Btn>
            </div>
          ))}
        </div>
      </div>

      <UpgradesPreviewPanel
        preview={upgradesPreview}
        onApply={onApply}
        onDismiss={onDismiss}
        applying={upgradesLoading}
      />
    </section>
  );
}

function PreviewCompareTable({ rows }) {
  if (!rows.length) return null;
  return (
    <table className="w-full text-[9px] font-heading border-collapse">
      <thead>
        <tr className="text-mutedForeground">
          <th className="text-left font-normal pb-1">Stat</th>
          <th className="text-right font-normal pb-1">Now</th>
          <th className="text-right font-normal pb-1">After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, before, after, fmt = (x) => String(x ?? '—') }) => {
          const b = fmt(before);
          const a = fmt(after);
          const changed = b !== a;
          return (
            <tr key={label} className={changed ? 'text-foreground' : 'text-mutedForeground'}>
              <td className="py-0.5 pr-2 text-[9px] uppercase text-mutedForeground align-top">{label}</td>
              <td className="py-0.5 pr-2 tabular-nums text-right align-top">{b}</td>
              <td className={`py-0.5 tabular-nums text-right align-top font-semibold ${changed ? 'text-violet-200' : ''}`}>
                {a}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DistilleryPreviewPanel({ preview, onApply, onDismiss, applying }) {
  if (!preview) return null;
  const before = preview.before || {};
  const after = preview.after || {};
  const provision = preview.provision;
  const racket = preview.racket || {};
  const racketBefore = racket.before;
  const racketAfter = racket.after;
  const distBefore = preview.distillery_detail?.before || {};
  const distAfter = preview.distillery_detail?.after || {};
  const equipmentChanges = preview.equipment_changes || [];
  const isNewRacket = provision?.would_create_business || provision?.created_business;
  const isNewDistillery = provision?.would_add_distillery || provision?.added_distillery;

  const summaryRows = [
    { label: 'Progress %', before: before.progress_pct, after: after.progress_pct, fmt: (x) => (x != null ? `${x}%` : '—') },
    { label: 'Total steps', before: `${before.total_steps ?? 0}/${before.max_steps ?? 0}`, after: `${after.total_steps ?? 0}/${after.max_steps ?? 0}` },
    { label: 'Equipment steps', before: before.equipment_steps, after: after.equipment_steps },
    { label: 'Special upgrades', before: before.special_steps, after: after.special_steps },
  ];

  const racketRows = [];
  if (racketAfter) {
    racketRows.push(
      { label: 'Racket name', before: racketBefore?.name, after: racketAfter?.name },
      { label: 'Type', before: racketBefore?.type_id, after: racketAfter?.type_id },
      { label: 'City', before: racketBefore?.state, after: racketAfter?.state },
      { label: 'Level', before: racketBefore?.level, after: racketAfter?.level },
      { label: 'Income/hr', before: racketBefore?.income_per_hour, after: racketAfter?.income_per_hour, fmt: fmtMoney },
      { label: 'Booze/hr', before: racketBefore?.booze_per_hour, after: racketAfter?.booze_per_hour },
      { label: 'Guard slots', before: racketBefore?.guard_slots, after: racketAfter?.guard_slots },
      { label: 'Vault', before: racketBefore?.vault, after: racketAfter?.vault, fmt: fmtMoney },
    );
  }

  const distilleryRows = [
    { label: 'Avg equip level', before: distBefore.equipment_avg_level, after: distAfter.equipment_avg_level },
    { label: 'Workers', before: distBefore.workers_total, after: distAfter.workers_total },
    { label: 'Worker cap', before: distBefore.worker_cap, after: distAfter.worker_cap },
    { label: 'Maintenance', before: distBefore.maintenance, after: distAfter.maintenance, fmt: (x) => (x != null ? `${x}%` : '—') },
    { label: 'Heat', before: distBefore.heat, after: distAfter.heat },
    { label: 'Auto-sell', before: distBefore.auto_sell_enabled ? 'On' : 'Off', after: distAfter.auto_sell_enabled ? 'On' : 'Off' },
    { label: 'Auto-aging', before: distBefore.auto_aging_enabled ? 'On' : 'Off', after: distAfter.auto_aging_enabled ? 'On' : 'Off' },
  ];

  const allEquipment = distAfter.equipment || distBefore.equipment || {};
  const equipmentLanes = Object.keys(allEquipment).length
    ? Object.keys(allEquipment)
    : equipmentChanges.map((c) => c.lane);

  return (
    <div className="rounded border border-violet-500/35 bg-violet-950/25 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[10px] font-heading font-bold text-violet-200">
          Preview · target ~{preview.progress_percent}%
        </p>
        <button type="button" onClick={onDismiss} className="text-[9px] text-mutedForeground hover:text-foreground uppercase">
          Dismiss
        </button>
      </div>
      {provision?.message && (
        <p className="text-[9px] text-amber-200/90 leading-snug">{provision.message}</p>
      )}
      {(isNewRacket || isNewDistillery) && (
        <p className="text-[9px] text-emerald-300/90 leading-snug">
          {isNewRacket && 'Player will receive a new booze-making racket (no cost). '}
          {isNewDistillery && 'Distillery doc will be created. '}
          IBM mission ladder is unchanged.
        </p>
      )}

      {racketRows.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-heading font-bold uppercase text-violet-300/90">Racket</p>
          <PreviewCompareTable rows={racketRows} />
        </div>
      )}

      <div className="space-y-1">
        <p className="text-[9px] font-heading font-bold uppercase text-violet-300/90">Distillery summary</p>
        <PreviewCompareTable rows={summaryRows} />
      </div>

      <div className="space-y-1">
        <p className="text-[9px] font-heading font-bold uppercase text-violet-300/90">Distillery stats</p>
        <PreviewCompareTable rows={distilleryRows} />
      </div>

      {equipmentLanes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-heading font-bold uppercase text-violet-300/90">Equipment levels</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-[9px] font-heading">
            {equipmentLanes.map((lane) => {
              const b = distBefore.equipment?.[lane] ?? 0;
              const a = distAfter.equipment?.[lane] ?? 0;
              const changed = b !== a;
              return (
                <div key={lane} className={changed ? 'text-foreground' : 'text-mutedForeground'}>
                  <span className="text-mutedForeground">{fmtLane(lane)}:</span>{' '}
                  <span className="tabular-nums">{b}</span>
                  <span className="text-mutedForeground"> → </span>
                  <span className={`tabular-nums font-semibold ${changed ? 'text-violet-200' : ''}`}>{a}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(distAfter.workers || distBefore.workers) && (
        <div className="space-y-1">
          <p className="text-[9px] font-heading font-bold uppercase text-violet-300/90">Workers by role</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] font-heading">
            {Object.keys({ ...distBefore.workers, ...distAfter.workers }).map((role) => {
              const b = distBefore.workers?.[role] ?? 0;
              const a = distAfter.workers?.[role] ?? 0;
              const changed = b !== a;
              return (
                <span key={role} className={changed ? 'text-foreground' : 'text-mutedForeground'}>
                  {fmtLane(role)}: <span className="tabular-nums">{b}</span>
                  <span className="text-mutedForeground"> → </span>
                  <span className={`tabular-nums font-semibold ${changed ? 'text-violet-200' : ''}`}>{a}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <Btn
        onClick={onApply}
        disabled={applying}
        className="w-full border-violet-400/45 bg-violet-500/15 text-violet-200"
      >
        {applying ? '…' : 'Apply distillery progress'}
      </Btn>
    </div>
  );
}

function ProvisionBoozePanel({ distilleryPct, setDistilleryPct, distilleryLoading, onPreview, onApply, distilleryPreview, onDismiss }) {
  return (
    <div className="rounded border border-violet-500/35 bg-violet-950/25 p-2 space-y-2">
      <p className="text-[9px] font-heading font-bold uppercase text-violet-200">Create booze racket + set distillery</p>
      <p className="text-[9px] text-mutedForeground leading-snug">
        No kill snapshot needed. Creates a minimal booze-making racket with distillery (free to the player), then sets progress.
        Racket mission ladder is unchanged — use Racket progress for that.
      </p>
      <div className="flex flex-wrap gap-1">
        {[1, 25, 50, 75, 100].map((p) => (
          <Btn key={p} onClick={() => onPreview(p)} disabled={distilleryLoading} className="border-violet-500/30 text-violet-300">
            Preview {p}%
          </Btn>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[80px]">
          <span className="text-[9px] uppercase text-mutedForeground">Custom %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={distilleryPct}
            onChange={(e) => {
              setDistilleryPct(e.target.value);
              onDismiss();
            }}
            className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px] tabular-nums"
          />
        </label>
        <Btn onClick={() => onPreview(null)} disabled={distilleryLoading} className="border-violet-400/40 bg-violet-500/10 text-violet-200">
          {distilleryLoading ? '…' : 'Preview'}
        </Btn>
      </div>
      <DistilleryPreviewPanel
        preview={distilleryPreview}
        onApply={onApply}
        onDismiss={onDismiss}
        applying={distilleryLoading}
      />
    </div>
  );
}

function RestoreRacketPanel({
  username,
  recoveryData,
  recoveryLoading,
  restoreLoading,
  onLoadRecovery,
  onRestore,
}) {
  return (
    <div className="rounded border border-amber-500/35 bg-amber-950/25 p-2 space-y-2">
      <p className="text-[9px] font-heading font-bold uppercase text-amber-200">Restore booze racket first</p>
      <p className="text-[9px] text-mutedForeground leading-snug">
        Distillery requires a booze-making illegal business. Restore from a kill snapshot if the player lost theirs.
      </p>
      {recoveryLoading ? (
        <p className="text-[9px] text-mutedForeground">Loading kill snapshots…</p>
      ) : !recoveryData || String(recoveryData.username || '').toLowerCase() !== String(username || '').toLowerCase() ? (
        <Btn onClick={() => onLoadRecovery(username)} disabled={recoveryLoading} className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          Load snapshots
        </Btn>
      ) : (recoveryData.pending_on_other_accounts || []).length === 0 ? (
        <p className="text-[9px] text-mutedForeground">No kill snapshots found on other accounts.</p>
      ) : (
        <div className="space-y-2">
          {recoveryData.pending_on_other_accounts.map((p, i) => (
            p.has_snapshot ? (
              <div key={i} className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2">
                <p className="text-[9px]">
                  From <span className="text-foreground font-bold">{p.holder_username}</span>
                  {p.snapshot_summary ? (
                    <span className="text-mutedForeground">
                      {' '}
                      · {p.snapshot_summary.name} · lvl {p.snapshot_summary.level}
                      {p.snapshot_summary.type_id === 'booze_making' ? (
                        <span className="text-violet-300"> · booze racket</span>
                      ) : (
                        <span className="text-amber-300"> · not booze type</span>
                      )}
                    </span>
                  ) : null}
                </p>
                <div className="flex gap-2 mt-2">
                  <Btn
                    onClick={() => onRestore(p.holder_username, true, username)}
                    disabled={!!restoreLoading}
                    className="border-zinc-600/50 text-mutedForeground"
                  >
                    Preview
                  </Btn>
                  <Btn
                    onClick={() => onRestore(p.holder_username, false, username)}
                    disabled={!!restoreLoading}
                    className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  >
                    {restoreLoading === `${p.holder_username}:false` ? '…' : 'Restore racket'}
                  </Btn>
                </div>
              </div>
            ) : null
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDistilleryProgress({ embedded = false, initialUsername = '' }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(embedded);

  const [username, setUsername] = useState(searchParams.get('user') || initialUsername || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [distilleryPct, setDistilleryPct] = useState('1');
  const [distilleryPreview, setDistilleryPreview] = useState(null);
  const [distilleryLoading, setDistilleryLoading] = useState(false);

  const [upgradesPreview, setUpgradesPreview] = useState(null);
  const [upgradesLoading, setUpgradesLoading] = useState(false);
  const [upgradesBody, setUpgradesBody] = useState(null);
  const [trackTiers, setTrackTiers] = useState(() =>
    Object.fromEntries(SPECIAL_TRACKS.map((t) => [t, '1']))
  );

  const [recoveryData, setRecoveryData] = useState(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(null);

  useEffect(() => {
    if (embedded) return;
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
  }, [navigate, embedded]);

  useEffect(() => {
    if (initialUsername && !searchParams.get('user')) {
      setUsername(initialUsername);
    }
  }, [initialUsername, searchParams]);

  const loadRecovery = useCallback(async (override) => {
    const un = (override != null ? String(override) : username).trim();
    if (!un) return;
    setRecoveryLoading(true);
    try {
      const res = await api.get('/admin/illegal-business/recovery', { params: { username: un } });
      setRecoveryData(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load restore snapshots');
      setRecoveryData(null);
    } finally {
      setRecoveryLoading(false);
    }
  }, [username]);

  const loadProgress = useCallback(async (override) => {
    const un = (override != null ? String(override) : username).trim();
    if (!un) {
      toast.error('Enter username');
      return;
    }
    setLoading(true);
    setDistilleryPreview(null);
    setUpgradesPreview(null);
    setUpgradesBody(null);
    try {
      const res = await api.get(`/admin/illegal-business/missions/user/${encodeURIComponent(un)}`);
      setData(res.data || null);
      if (!embedded) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('user', un);
          return next;
        });
      }
      if (res.data && !res.data.has_business) {
        loadRecovery(un);
      } else {
        setRecoveryData(null);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load distillery');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [username, setSearchParams, embedded, loadRecovery]);

  const handleRestore = async (holderUsername, dryRun, targetOverride) => {
    const target = (targetOverride || data?.username || username).trim();
    const key = `${holderUsername}:${dryRun}`;
    setRestoreLoading(key);
    try {
      const body = {
        target_username: target,
        holder_username: holderUsername,
        remove_from_holder_pending: true,
        dry_run: true,
      };
      const preview = await api.post('/admin/illegal-business/restore', body);
      if (dryRun) {
        toast.success(preview.data?.message || 'Preview OK');
        return;
      }
      if (!window.confirm(preview.data?.message || 'Restore this illegal business?')) return;
      const res = await api.post('/admin/illegal-business/restore', { ...body, dry_run: false });
      toast.success(res.data?.message || 'Restored');
      await loadRecovery(target);
      await loadProgress(target);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Restore failed');
    } finally {
      setRestoreLoading(null);
    }
  };

  useEffect(() => {
    if (!accessChecked || embedded) return;
    const u = searchParams.get('user');
    if (u) {
      setUsername(u);
      loadProgress(u);
    }
  }, [accessChecked, embedded, searchParams, loadProgress]);

  const previewDistillery = async (pctOverride, { ensureBooze = false } = {}) => {
    const un = (data?.username || username).trim();
    const pct = pctOverride != null ? Number(pctOverride) : parseInt(String(distilleryPct).trim(), 10);
    if (!un || Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Enter username and percent 0–100');
      return;
    }
    const needsProvision =
      data && (!data.has_business || (data.has_business && data.business_type_id === 'booze_making' && !data.distillery));
    const ensure = ensureBooze || needsProvision;
    if (!ensure && (!data?.has_business || data?.business_type_id !== 'booze_making')) {
      toast.error('Player needs a booze-making racket with a distillery');
      return;
    }
    setDistilleryLoading(true);
    try {
      const res = await api.post(`/admin/illegal-business/distillery-progress/${encodeURIComponent(un)}`, {
        progress_percent: pct,
        dry_run: true,
        ensure_booze_racket: !!ensure,
      });
      setDistilleryPreview(res.data?.preview || null);
      setDistilleryPct(String(pct));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Distillery preview failed');
      setDistilleryPreview(null);
    } finally {
      setDistilleryLoading(false);
    }
  };

  const applyDistillery = async () => {
    if (!distilleryPreview) return;
    const un = (data?.username || username).trim();
    const pct = distilleryPreview.progress_percent;
    const prov = distilleryPreview.provision;
    const createNote = prov?.would_create_business || prov?.created_business
      ? ' This will also create a booze racket.'
      : prov?.would_add_distillery || prov?.added_distillery
        ? ' This will also add a distillery doc.'
        : '';
    if (!window.confirm(`Set ${un}'s distillery to ~${pct}%?${createNote} Equipment and special upgrades only — racket ladder unchanged.`)) return;
    setDistilleryLoading(true);
    try {
      const needsProvision =
        data && (!data.has_business || (data.has_business && data.business_type_id === 'booze_making' && !data.distillery));
      const res = await api.post(`/admin/illegal-business/distillery-progress/${encodeURIComponent(un)}`, {
        progress_percent: pct,
        dry_run: false,
        ensure_booze_racket: !!needsProvision || !!(prov?.would_create_business || prov?.would_add_distillery),
      });
      setData(res.data || null);
      setDistilleryPreview(null);
      setRecoveryData(null);
      toast.success(res.data?.message || 'Distillery updated');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Apply failed');
    } finally {
      setDistilleryLoading(false);
    }
  };

  const previewUpgrades = async (bodyPartial) => {
    const un = (data?.username || username).trim();
    if (!un) {
      toast.error('Enter username');
      return;
    }
    const body = { dry_run: true, ...bodyPartial };
    setUpgradesLoading(true);
    try {
      const res = await api.post(`/admin/illegal-business/distillery-upgrades/${encodeURIComponent(un)}`, body);
      setUpgradesPreview(res.data?.preview || null);
      setUpgradesBody(bodyPartial);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Upgrade preview failed');
      setUpgradesPreview(null);
      setUpgradesBody(null);
    } finally {
      setUpgradesLoading(false);
    }
  };

  const applyUpgrades = async () => {
    if (!upgradesBody) return;
    const un = (data?.username || username).trim();
    if (!window.confirm(`Apply distillery upgrades for ${un}?`)) return;
    setUpgradesLoading(true);
    try {
      const res = await api.post(`/admin/illegal-business/distillery-upgrades/${encodeURIComponent(un)}`, {
        dry_run: false,
        ...upgradesBody,
      });
      setData(res.data || null);
      setUpgradesPreview(null);
      setUpgradesBody(null);
      toast.success(res.data?.message || 'Upgrades applied');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Apply failed');
    } finally {
      setUpgradesLoading(false);
    }
  };

  if (!accessChecked) {
    return embedded ? null : (
      <div className={`${styles.pageContent} p-4 text-[11px] text-mutedForeground font-heading`}>
        Checking access…
      </div>
    );
  }

  const dist = data?.distillery;
  const canEditDistillery = data?.has_business && data?.business_type_id === 'booze_making' && dist;

  const inner = (
    <>
      {!embedded && (
        <div>
          <h1 className="text-sm font-heading font-bold text-violet-300 uppercase tracking-wider flex items-center gap-2">
            <Wine size={16} /> Distillery progress
          </h1>
          <p className="text-[10px] text-mutedForeground font-heading mt-1 leading-snug">
            Set still upgrades and special track progress on the{' '}
            <Link to="/money/distillery" className="text-violet-300 underline underline-offset-2">Distillery</Link>{' '}
            page. Requires a booze-making racket — does not change the racket progress ladder (
            <Link to="/tjjeujr3wa/racket-progress" className="text-primary underline underline-offset-2">Racket progress</Link>).
          </p>
        </div>
      )}

      {embedded && (
        <p className="text-[10px] text-mutedForeground font-heading mb-3 leading-snug">
          Set distillery equipment and special-upgrade progress (0–100%). Racket ladder unchanged.
        </p>
      )}

      <section className={`${embedded ? '' : styles.panel} ${embedded ? 'space-y-3' : 'rounded-lg border border-violet-500/25 p-4 space-y-3'}`}>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadProgress()}
            placeholder="Username"
            className="flex-1 min-w-[160px] px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
          />
          <Btn onClick={() => loadProgress()} disabled={loading} className="border-violet-400/40 bg-violet-500/10 text-violet-200">
            {loading ? '…' : 'Load'}
          </Btn>
          {data && (
            <Btn onClick={() => loadProgress()} disabled={loading} className="border-zinc-600 text-zinc-400">
              <RefreshCw size={10} className="inline mr-1" /> Refresh
            </Btn>
          )}
        </div>

        {data && (
          <div className="text-[10px] font-heading space-y-2 border-t border-zinc-700/50 pt-3">
            <p>
              <span className="text-foreground font-bold">{data.username}</span>
              {data.business_name ? (
                <span className="text-mutedForeground"> · {data.business_name}</span>
              ) : null}
            </p>
            {!data.has_business && (
              <>
                <ProvisionBoozePanel
                  distilleryPct={distilleryPct}
                  setDistilleryPct={setDistilleryPct}
                  distilleryLoading={distilleryLoading}
                  onPreview={(p) => previewDistillery(p, { ensureBooze: true })}
                  onApply={applyDistillery}
                  distilleryPreview={distilleryPreview}
                  onDismiss={() => setDistilleryPreview(null)}
                />
                <RestoreRacketPanel
                  username={data.username}
                  recoveryData={recoveryData}
                  recoveryLoading={recoveryLoading}
                  restoreLoading={restoreLoading}
                  onLoadRecovery={loadRecovery}
                  onRestore={handleRestore}
                />
              </>
            )}
            {data.has_business && data.business_type_id !== 'booze_making' && (
              <p className="text-amber-300/90 text-[9px]">
                Racket type is <span className="font-bold">{data.business_type_id || 'unknown'}</span> — distillery only applies to{' '}
                <span className="font-bold">booze_making</span> rackets.
              </p>
            )}
            {data.has_business && data.business_type_id === 'booze_making' && !dist && (
              <ProvisionBoozePanel
                distilleryPct={distilleryPct}
                setDistilleryPct={setDistilleryPct}
                distilleryLoading={distilleryLoading}
                onPreview={(p) => previewDistillery(p, { ensureBooze: true })}
                onApply={applyDistillery}
                distilleryPreview={distilleryPreview}
                onDismiss={() => setDistilleryPreview(null)}
              />
            )}
            {dist && (
              <p className="text-violet-300/90 flex items-center gap-1">
                <Wine size={10} />
                {dist.progress_pct}% · {dist.total_steps}/{dist.max_steps} steps
                {' · '}
                {dist.equipment_steps} equipment · {dist.special_steps} specials
              </p>
            )}
          </div>
        )}
      </section>

      {canEditDistillery && (
        <section className={`${embedded ? 'rounded-lg border border-violet-500/25 p-3 mt-3' : `${styles.panel} rounded-lg border border-violet-500/25 p-4 mt-4`} space-y-3`}>
          <h2 className="text-[11px] font-heading font-bold uppercase text-violet-300">Set distillery progress</h2>
          <p className="text-[9px] text-mutedForeground leading-snug">
            Scales equipment levels and special track unlocks toward the target %. Preview before applying.
          </p>
          <div className="flex flex-wrap gap-1">
            {[0, 25, 50, 75, 100].map((p) => (
              <Btn key={p} onClick={() => previewDistillery(p)} disabled={distilleryLoading} className="border-violet-500/30 text-violet-300">
                Preview {p}%
              </Btn>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="flex-1 min-w-[80px]">
              <span className="text-[9px] uppercase text-mutedForeground">Custom %</span>
              <input
                type="number"
                min={0}
                max={100}
                value={distilleryPct}
                onChange={(e) => {
                  setDistilleryPct(e.target.value);
                  setDistilleryPreview(null);
                }}
                className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px] tabular-nums"
              />
            </label>
            <Btn onClick={() => previewDistillery(null)} disabled={distilleryLoading} className="border-violet-400/40 bg-violet-500/10 text-violet-200">
              {distilleryLoading ? '…' : 'Preview'}
            </Btn>
          </div>
          <DistilleryPreviewPanel
            preview={distilleryPreview}
            onApply={applyDistillery}
            onDismiss={() => setDistilleryPreview(null)}
            applying={distilleryLoading}
          />
          <AdminDistilleryUpgradesPanel
            data={data}
            username={username}
            upgradesLoading={upgradesLoading}
            upgradesPreview={upgradesPreview}
            trackTiers={trackTiers}
            setTrackTiers={setTrackTiers}
            onPreview={previewUpgrades}
            onApply={applyUpgrades}
            onDismiss={() => {
              setUpgradesPreview(null);
              setUpgradesBody(null);
            }}
          />
        </section>
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-0">{inner}</div>;
  }

  return (
    <div className={`${styles.pageContent} space-y-4 max-w-3xl`}>
      {inner}
    </div>
  );
}
