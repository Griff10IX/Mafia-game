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

function DistilleryPreviewPanel({ preview, onApply, onDismiss, applying }) {
  if (!preview) return null;
  const before = preview.before || {};
  const after = preview.after || {};
  const row = (label, b, a) => {
    const changed = String(b ?? '—') !== String(a ?? '—');
    return (
      <tr key={label} className={changed ? 'text-foreground' : 'text-mutedForeground'}>
        <td className="py-0.5 pr-2 text-[9px] uppercase text-mutedForeground align-top">{label}</td>
        <td className="py-0.5 pr-2 tabular-nums text-right align-top">{b ?? '—'}</td>
        <td className={`py-0.5 tabular-nums text-right align-top font-semibold ${changed ? 'text-violet-200' : ''}`}>
          {a ?? '—'}
        </td>
      </tr>
    );
  };
  return (
    <div className="rounded border border-violet-500/35 bg-violet-950/25 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[10px] font-heading font-bold text-violet-200">
          Preview · target ~{preview.progress_percent}%
        </p>
        <button type="button" onClick={onDismiss} className="text-[9px] text-mutedForeground hover:text-foreground uppercase">
          Dismiss
        </button>
      </div>
      <table className="w-full text-[9px] font-heading border-collapse">
        <thead>
          <tr className="text-mutedForeground">
            <th className="text-left font-normal pb-1">Stat</th>
            <th className="text-right font-normal pb-1">Now</th>
            <th className="text-right font-normal pb-1">After</th>
          </tr>
        </thead>
        <tbody>
          {row('Progress %', before.progress_pct, after.progress_pct)}
          {row('Total steps', `${before.total_steps ?? 0}/${before.max_steps ?? 0}`, `${after.total_steps ?? 0}/${after.max_steps ?? 0}`)}
          {row('Equipment steps', before.equipment_steps, after.equipment_steps)}
          {row('Special upgrades', before.special_steps, after.special_steps)}
        </tbody>
      </table>
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

  const [distilleryPct, setDistilleryPct] = useState('50');
  const [distilleryPreview, setDistilleryPreview] = useState(null);
  const [distilleryLoading, setDistilleryLoading] = useState(false);

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

  const previewDistillery = async (pctOverride) => {
    const un = (data?.username || username).trim();
    const pct = pctOverride != null ? Number(pctOverride) : parseInt(String(distilleryPct).trim(), 10);
    if (!un || Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Enter username and percent 0–100');
      return;
    }
    if (!data?.has_business || data?.business_type_id !== 'booze_making') {
      toast.error('Player needs a booze-making racket with a distillery');
      return;
    }
    setDistilleryLoading(true);
    try {
      const res = await api.post(`/admin/illegal-business/distillery-progress/${encodeURIComponent(un)}`, {
        progress_percent: pct,
        dry_run: true,
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
    if (!window.confirm(`Set ${un}'s distillery to ~${pct}%? Equipment and special upgrades only — racket ladder unchanged.`)) return;
    setDistilleryLoading(true);
    try {
      const res = await api.post(`/admin/illegal-business/distillery-progress/${encodeURIComponent(un)}`, {
        progress_percent: pct,
        dry_run: false,
      });
      setData(res.data || null);
      setDistilleryPreview(null);
      toast.success(res.data?.message || 'Distillery updated');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Apply failed');
    } finally {
      setDistilleryLoading(false);
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
              <RestoreRacketPanel
                username={data.username}
                recoveryData={recoveryData}
                recoveryLoading={recoveryLoading}
                restoreLoading={restoreLoading}
                onLoadRecovery={loadRecovery}
                onRestore={handleRestore}
              />
            )}
            {data.has_business && data.business_type_id !== 'booze_making' && (
              <p className="text-amber-300/90 text-[9px]">
                Racket type is <span className="font-bold">{data.business_type_id || 'unknown'}</span> — distillery only applies to{' '}
                <span className="font-bold">booze_making</span> rackets.
              </p>
            )}
            {data.has_business && data.business_type_id === 'booze_making' && !dist && (
              <p className="text-amber-300/90 text-[9px]">Booze racket exists but no distillery doc — player may need to open Distillery once, or restore a booze snapshot.</p>
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
