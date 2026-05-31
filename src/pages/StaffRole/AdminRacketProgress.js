import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, RefreshCw, Wine } from 'lucide-react';
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

function PresetPreviewPanel({ preview, onApply, onDismiss, applying, applyLabel = 'Apply preset' }) {
  if (!preview) return null;
  const cur = preview.current || {};
  const after = preview.after || {};
  const row = (label, before, afterVal, fmt = (x) => String(x ?? '—')) => {
    const b = fmt(before);
    const a = fmt(afterVal);
    const changed = b !== a;
    return (
      <tr key={label} className={changed ? 'text-foreground' : 'text-mutedForeground'}>
        <td className="py-0.5 pr-2 text-[9px] uppercase text-mutedForeground align-top">{label}</td>
        <td className="py-0.5 pr-2 tabular-nums text-right align-top">{b}</td>
        <td className={`py-0.5 tabular-nums text-right align-top font-semibold ${changed ? 'text-emerald-300' : ''}`}>
          {a}
        </td>
      </tr>
    );
  };
  return (
    <div className="rounded border border-amber-500/35 bg-amber-950/25 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[10px] font-heading font-bold text-amber-200">
          Preview · ~{preview.progress_percent}% ({preview.missions_completed_count}/{preview.missions_total}{' '}
          steps complete)
          {preview.distillery_progress_percent != null && preview.distillery_progress_percent !== preview.progress_percent && (
            <span className="text-amber-100/80 font-normal">
              {' '}
              · distillery {preview.distillery_progress_percent}%
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[9px] text-mutedForeground hover:text-foreground uppercase"
        >
          Dismiss
        </button>
      </div>
      {preview.next_mission ? (
        <p className="text-[9px] text-mutedForeground">
          Next step:{' '}
          <span className="text-foreground">
            #{preview.next_mission.display_index} {preview.next_mission.title}
          </span>
        </p>
      ) : preview.all_missions_complete ? (
        <p className="text-[9px] text-emerald-400">All business progress steps will be marked complete.</p>
      ) : null}
      <table className="w-full text-[9px] font-heading border-collapse">
        <thead>
          <tr className="text-mutedForeground">
            <th className="text-left font-normal pb-1">Stat</th>
            <th className="text-right font-normal pb-1">Now</th>
            <th className="text-right font-normal pb-1">After apply</th>
          </tr>
        </thead>
        <tbody>
          {row('Income/hr', cur.income_per_hour, after.income_per_hour, fmtMoney)}
          {row('Vault', cur.vault, after.vault, fmtMoney)}
          {row('Security', cur.security_level, after.security_level)}
          {row('Guards', cur.active_guards, after.guards_placed)}
          {row('Guard slots', cur.guard_slots, after.guard_slots)}
          {after.distillery && (
            <>
              {row('Distillery %', preview.current?.distillery?.progress_pct, after.distillery.progress_pct, (x) => (x != null ? `${x}%` : '—'))}
              {row('Distillery workers cap', null, after.distillery.worker_cap)}
            </>
          )}
        </tbody>
      </table>
      <Btn
        onClick={onApply}
        disabled={applying}
        className="w-full border-emerald-500/45 bg-emerald-500/15 text-emerald-200"
      >
        {applying ? '…' : applyLabel}
      </Btn>
    </div>
  );
}

function DistilleryPreviewPanel({ preview, onApply, onDismiss, applying }) {
  if (!preview) return null;
  const before = preview.before || {};
  const after = preview.after || {};
  return (
    <div className="rounded border border-violet-500/35 bg-violet-950/25 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[10px] font-heading font-bold text-violet-200">
          Distillery preview · target ~{preview.progress_percent}%
        </p>
        <button type="button" onClick={onDismiss} className="text-[9px] text-mutedForeground hover:text-foreground uppercase">
          Dismiss
        </button>
      </div>
      <p className="text-[9px] text-mutedForeground">
        Progress: {before.progress_pct ?? 0}% → <span className="text-violet-200 font-semibold">{after.progress_pct ?? 0}%</span>
        {' · '}
        Steps: {before.total_steps ?? 0}/{before.max_steps ?? 0} → {after.total_steps ?? 0}/{after.max_steps ?? 0}
      </p>
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

export default function AdminRacketProgress() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(false);

  const [username, setUsername] = useState(searchParams.get('user') || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [presetPct, setPresetPct] = useState('50');
  const [distilleryPct, setDistilleryPct] = useState('');
  const [presetPreview, setPresetPreview] = useState(null);
  const [presetLoading, setPresetLoading] = useState(false);

  const [distilleryOnlyPct, setDistilleryOnlyPct] = useState('50');
  const [distilleryPreview, setDistilleryPreview] = useState(null);
  const [distilleryLoading, setDistilleryLoading] = useState(false);

  const [nextStep, setNextStep] = useState('');
  const [stepSaving, setStepSaving] = useState(false);

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

  const loadProgress = useCallback(async (override) => {
    const un = (override != null ? String(override) : username).trim();
    if (!un) {
      toast.error('Enter username');
      return;
    }
    setLoading(true);
    setPresetPreview(null);
    setDistilleryPreview(null);
    try {
      const res = await api.get(`/admin/illegal-business/missions/user/${encodeURIComponent(un)}`);
      setData(res.data || null);
      setNextStep(String(res.data?.next_mission_display ?? ''));
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('user', un);
        return next;
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load progress');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [username, setSearchParams]);

  useEffect(() => {
    if (!accessChecked) return;
    const u = searchParams.get('user');
    if (u) {
      setUsername(u);
      loadProgress(u);
    }
  }, [accessChecked, searchParams, loadProgress]);

  const previewPreset = async (pctOverride) => {
    const un = (data?.username || username).trim();
    const pct = pctOverride != null ? Number(pctOverride) : parseInt(String(presetPct).trim(), 10);
    if (!un || Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Enter username and percent 0–100');
      return;
    }
    if (!data?.has_business) {
      toast.error('Player needs a racket (illegal business) first — use Crew recovery to restore if needed');
      return;
    }
    const distRaw = String(distilleryPct).trim();
    const body = { progress_percent: pct, dry_run: true };
    if (distRaw !== '') {
      const d = parseInt(distRaw, 10);
      if (Number.isNaN(d) || d < 0 || d > 100) {
        toast.error('Distillery percent must be 0–100 or leave blank to match racket %');
        return;
      }
      body.distillery_progress_percent = d;
    }
    setPresetLoading(true);
    try {
      const res = await api.post(`/admin/illegal-business/apply-progress/${encodeURIComponent(un)}`, body);
      const p = res.data?.preview;
      if (!p) {
        toast.error('No preview returned');
        return;
      }
      setPresetPreview(p);
      setPresetPct(String(pct));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Preview failed');
      setPresetPreview(null);
    } finally {
      setPresetLoading(false);
    }
  };

  const applyPreset = async () => {
    if (!presetPreview) return;
    const un = (data?.username || username).trim();
    const pct = presetPreview.progress_percent;
    if (!window.confirm(`Apply ~${pct}% racket progress to ${un}? Updates ladder, vault, guards, security, income${data?.business_type_id === 'booze_making' ? ', and distillery' : ''}.`)) return;
    setPresetLoading(true);
    try {
      const body = { progress_percent: pct, dry_run: false };
      if (presetPreview.distillery_progress_percent != null && presetPreview.distillery_progress_percent !== pct) {
        body.distillery_progress_percent = presetPreview.distillery_progress_percent;
      }
      const res = await api.post(`/admin/illegal-business/apply-progress/${encodeURIComponent(un)}`, body);
      setData(res.data || null);
      setNextStep(String(res.data?.next_mission_display ?? ''));
      setPresetPreview(null);
      toast.success(res.data?.message || 'Progress applied');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Apply failed');
    } finally {
      setPresetLoading(false);
    }
  };

  const previewDistilleryOnly = async (pctOverride) => {
    const un = (data?.username || username).trim();
    const pct = pctOverride != null ? Number(pctOverride) : parseInt(String(distilleryOnlyPct).trim(), 10);
    if (!un || Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Enter username and percent 0–100');
      return;
    }
    if (data?.business_type_id !== 'booze_making') {
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
      setDistilleryOnlyPct(String(pct));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Distillery preview failed');
      setDistilleryPreview(null);
    } finally {
      setDistilleryLoading(false);
    }
  };

  const applyDistilleryOnly = async () => {
    if (!distilleryPreview) return;
    const un = (data?.username || username).trim();
    const pct = distilleryPreview.progress_percent;
    if (!window.confirm(`Set ${un}'s distillery to ~${pct}%? Racket progress ladder unchanged.`)) return;
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

  const applyNextStep = async () => {
    const un = (data?.username || username).trim();
    const n = parseInt(String(nextStep).trim(), 10);
    const max = (data?.missions_total || 100) + 1;
    if (!un || Number.isNaN(n) || n < 1 || n > max) {
      toast.error(`Next step must be 1–${max} (${max} = all complete)`);
      return;
    }
    if (!window.confirm(`Set ${un}'s next progress step to #${n}? Does not grant rewards or change vault/guards.`)) return;
    setStepSaving(true);
    try {
      const res = await api.patch(`/admin/illegal-business/missions/user/${encodeURIComponent(un)}`, {
        next_mission_display: n,
      });
      setData(res.data || null);
      setNextStep(String(res.data?.next_mission_display ?? n));
      toast.success('Progress step updated');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set step');
    } finally {
      setStepSaving(false);
    }
  };

  if (!accessChecked) {
    return (
      <div className={`${styles.pageContent} p-4 text-[11px] text-mutedForeground font-heading`}>
        Checking access…
      </div>
    );
  }

  const biz = data?.business_summary;
  const dist = data?.distillery;

  return (
    <div className={`${styles.pageContent} space-y-4 max-w-3xl`}>
      <div>
        <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
          <Building2 size={16} /> Racket &amp; distillery progress
        </h1>
        <p className="text-[10px] text-mutedForeground font-heading mt-1 leading-snug">
          Set how far a player has progressed on{' '}
          <Link to="/money/racket" className="text-primary underline underline-offset-2">Racket</Link>
          {' '}and{' '}
          <Link to="/money/distillery" className="text-primary underline underline-offset-2">Distillery</Link>.
          Requires an existing illegal business — restore via{' '}
          <Link to="/tjjeujr3wa/crew-recovery" className="text-primary underline underline-offset-2">Crew recovery</Link>{' '}
          if they lost it.
        </p>
      </div>

      <section className={`${styles.panel} rounded-lg border border-primary/25 p-4 space-y-3`}>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadProgress()}
            placeholder="Username"
            className="flex-1 min-w-[160px] px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
          />
          <Btn onClick={() => loadProgress()} disabled={loading} className="border-primary/40 bg-primary/10 text-primary">
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
              {' · '}
              <span className="text-primary tabular-nums">~{data.progress_percent ?? 0}%</span>
              {' · '}
              {data.missions_completed_count}/{data.missions_total} steps complete
              {!data.has_business && (
                <span className="text-amber-300/90 ml-1">· no racket — restore in Crew recovery first</span>
              )}
            </p>
            {data.active_mission && (
              <p className="text-mutedForeground">
                Active: #{data.active_mission.display_index}{' '}
                <span className="text-foreground">{data.active_mission.title}</span>
              </p>
            )}
            {data.all_missions_complete && (
              <p className="text-emerald-400">All business progress steps complete.</p>
            )}
            {biz && (
              <p className="text-[9px] text-mutedForeground">
                Racket: {fmtMoney(biz.vault)} vault · {Number(biz.income_per_hour || 0).toLocaleString()}/hr ·{' '}
                {biz.security_level} security · {biz.active_guards}/{biz.guard_slots} guards
              </p>
            )}
            {dist && (
              <p className="text-[9px] text-violet-300/90 flex items-center gap-1">
                <Wine size={10} />
                Distillery: {dist.progress_pct}% · {dist.total_steps}/{dist.max_steps} steps
              </p>
            )}
          </div>
        )}
      </section>

      {data?.has_business && (
        <>
          <section className={`${styles.panel} rounded-lg border border-primary/25 p-4 space-y-3`}>
            <h2 className="text-[11px] font-heading font-bold uppercase text-primary">Full preset (recommended)</h2>
            <p className="text-[9px] text-mutedForeground leading-snug">
              Sets progress ladder plus vault, income, guards, security, and counters to match. Booze rackets also update distillery unless you override below.
            </p>
            <div className="flex flex-wrap gap-1">
              {[0, 25, 50, 75, 100].map((p) => (
                <Btn key={p} onClick={() => previewPreset(p)} disabled={presetLoading} className="border-primary/30 text-primary">
                  Preview {p}%
                </Btn>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="flex-1 min-w-[80px]">
                <span className="text-[9px] uppercase text-mutedForeground">Racket %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={presetPct}
                  onChange={(e) => {
                    setPresetPct(e.target.value);
                    setPresetPreview(null);
                  }}
                  className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px] tabular-nums"
                />
              </label>
              {data.business_type_id === 'booze_making' && (
                <label className="flex-1 min-w-[80px]">
                  <span className="text-[9px] uppercase text-mutedForeground">Distillery % (optional)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={distilleryPct}
                    onChange={(e) => {
                      setDistilleryPct(e.target.value);
                      setPresetPreview(null);
                    }}
                    placeholder="Same as racket"
                    className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px] tabular-nums"
                  />
                </label>
              )}
              <Btn onClick={() => previewPreset(null)} disabled={presetLoading} className="border-primary/40 bg-primary/10 text-primary">
                {presetLoading ? '…' : 'Preview'}
              </Btn>
            </div>
            <PresetPreviewPanel
              preview={presetPreview}
              onApply={applyPreset}
              onDismiss={() => setPresetPreview(null)}
              applying={presetLoading}
            />
          </section>

          {data.business_type_id === 'booze_making' && (
            <section className={`${styles.panel} rounded-lg border border-violet-500/25 p-4 space-y-3`}>
              <h2 className="text-[11px] font-heading font-bold uppercase text-violet-300 flex items-center gap-2">
                <Wine size={12} /> Distillery only
              </h2>
              <p className="text-[9px] text-mutedForeground leading-snug">
                Change distillery equipment/workers without moving the racket progress ladder.
              </p>
              <div className="flex flex-wrap gap-1">
                {[25, 50, 75, 100].map((p) => (
                  <Btn key={p} onClick={() => previewDistilleryOnly(p)} disabled={distilleryLoading} className="border-violet-500/30 text-violet-300">
                    Preview {p}%
                  </Btn>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="flex-1 min-w-[80px]">
                  <span className="text-[9px] uppercase text-mutedForeground">Distillery %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={distilleryOnlyPct}
                    onChange={(e) => {
                      setDistilleryOnlyPct(e.target.value);
                      setDistilleryPreview(null);
                    }}
                    className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px] tabular-nums"
                  />
                </label>
                <Btn onClick={() => previewDistilleryOnly(null)} disabled={distilleryLoading} className="border-violet-400/40 bg-violet-500/10 text-violet-200">
                  {distilleryLoading ? '…' : 'Preview'}
                </Btn>
              </div>
              <DistilleryPreviewPanel
                preview={distilleryPreview}
                onApply={applyDistilleryOnly}
                onDismiss={() => setDistilleryPreview(null)}
                applying={distilleryLoading}
              />
            </section>
          )}

          <section className={`${styles.panel} rounded-lg border border-zinc-600/40 p-4 space-y-3`}>
            <h2 className="text-[11px] font-heading font-bold uppercase text-zinc-400">Ladder step only</h2>
            <p className="text-[9px] text-mutedForeground leading-snug">
              Jump to a specific progress step number without changing vault, guards, or distillery. Does not grant step rewards.
            </p>
            <label className="block">
              <span className="text-[9px] uppercase text-mutedForeground">
                Next step to complete (1–{(data.missions_total || 100) + 1})
              </span>
              <input
                type="number"
                min={1}
                max={(data.missions_total || 100) + 1}
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px] tabular-nums"
              />
            </label>
            <Btn onClick={applyNextStep} disabled={stepSaving} className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              {stepSaving ? '…' : 'Apply step only'}
            </Btn>
          </section>
        </>
      )}
    </div>
  );
}
