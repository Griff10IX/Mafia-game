import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, RefreshCw, Search, Skull, Wine } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import AdminDistilleryProgress from './AdminDistilleryProgress';

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

function IbmPresetPreviewPanel({ preview, onApply, onDismiss, applying }) {
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
      {preview.last_completed_mission && (
        <p className="text-[9px] text-mutedForeground">
          Last completed: #{preview.last_completed_mission.display_index}{' '}
          {preview.last_completed_mission.title}
        </p>
      )}
      <table className="w-full text-[9px] font-heading border-collapse">
        <thead>
          <tr className="text-mutedForeground">
            <th className="text-left font-normal pb-1">Stat</th>
            <th className="text-right font-normal pb-1">Now</th>
            <th className="text-right font-normal pb-1">After apply</th>
          </tr>
        </thead>
        <tbody>
          {row('Income / hr', cur.income_per_hour, after.income_per_hour, fmtMoney)}
          {row('Vault', cur.vault, after.vault, fmtMoney)}
          {row('Guard slots', cur.guard_slots, after.guard_slots)}
          {row('Guards hired', cur.active_guards, after.guards_placed)}
          {row('Security level', cur.security_level, after.security_level)}
          {row('Income cap (hrs)', cur.income_cap_hours, after.income_cap_hours)}
          {row('Defender bonus', cur.defender_strength_bonus, after.defender_strength_bonus)}
          {row('Raid limit / day', cur.raid_daily_limit, after.raid_daily_limit)}
        </tbody>
      </table>
      {after.security_upgrade_names?.length > 0 && (
        <p className="text-[9px] text-mutedForeground">
          Security upgrades ({after.security_level}):{' '}
          <span className="text-foreground">{after.security_upgrade_names.join(', ')}</span>
        </p>
      )}
      {after.distillery && (
        <p className="text-[9px] text-mutedForeground">
          Distillery: avg equip lvl {after.distillery.equipment_avg_level}, worker cap{' '}
          {after.distillery.worker_cap}, maintenance {Math.round(after.distillery.maintenance)}%
        </p>
      )}
      {after.ibm_counters_boosted && (
        <p className="text-[9px] text-mutedForeground">
          IBM activity counters (collections, raids, crimes-in-state, etc.) will be set high so the next mission is not
          soft-locked.
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Btn
          onClick={onApply}
          disabled={applying}
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
        >
          {applying ? '…' : `Apply ${preview.progress_percent}%`}
        </Btn>
      </div>
    </div>
  );
}

export default function AdminCrewRecovery() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(false);

  const [familyQuery, setFamilyQuery] = useState(searchParams.get('family') || 'ALLEGIANCE');
  const [familyPreview, setFamilyPreview] = useState(null);
  const [familyLoading, setFamilyLoading] = useState(false);
  const [bossUsername, setBossUsername] = useState('');
  const [treasury, setTreasury] = useState('');
  const [treasuryBullets, setTreasuryBullets] = useState('');
  const [racketsJson, setRacketsJson] = useState('');
  const [confirmFamilyName, setConfirmFamilyName] = useState('');
  const [reviveLoading, setReviveLoading] = useState(false);

  const [ibUsername, setIbUsername] = useState(searchParams.get('user') || 'Moey');
  const [ibData, setIbData] = useState(null);
  const [ibLoading, setIbLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(null);
  const [ibmData, setIbmData] = useState(null);
  const [ibmLoading, setIbmLoading] = useState(false);
  const [ibmSaving, setIbmSaving] = useState(false);
  const [ibmNextDisplay, setIbmNextDisplay] = useState('');
  const [ibmPresetPct, setIbmPresetPct] = useState('50');
  const [ibmPresetLoading, setIbmPresetLoading] = useState(false);
  const [ibmPresetPreview, setIbmPresetPreview] = useState(null);

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

  const loadFamilyPreview = useCallback(async (override) => {
    const q = (override != null ? String(override) : familyQuery).trim();
    if (!q) {
      toast.error('Enter family name or id');
      return;
    }
    setFamilyLoading(true);
    setFamilyPreview(null);
    try {
      const params = q.length > 20 && !q.includes(' ') ? { family_id: q } : { family_name: q };
      const res = await api.get('/admin/families/revive-preview', { params });
      setFamilyPreview(res.data || null);
      const suggested = res.data?.suggested_boss_usernames?.[0];
      if (suggested) setBossUsername(suggested);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('family', q);
        return next;
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load family');
    } finally {
      setFamilyLoading(false);
    }
  }, [familyQuery, setSearchParams]);

  const loadIllegalBusiness = useCallback(async (override) => {
    const un = (override != null ? String(override) : ibUsername).trim();
    if (!un) {
      toast.error('Enter username');
      return;
    }
    setIbLoading(true);
    setIbData(null);
    try {
      const res = await api.get('/admin/illegal-business/recovery', { params: { username: un } });
      setIbData(res.data || null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('user', un);
        return next;
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load illegal business');
    } finally {
      setIbLoading(false);
    }
  }, [ibUsername, setSearchParams]);

  useEffect(() => {
    if (!accessChecked) return;
    const f = searchParams.get('family');
    const u = searchParams.get('user');
    if (f) loadFamilyPreview(f);
    if (u) loadIllegalBusiness(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessChecked]);

  const handleReviveFamily = async (dryRun) => {
    if (!familyPreview?.family_id) return;
    const name = familyPreview.name || familyPreview.tag;
    if (!dryRun && confirmFamilyName.trim().toLowerCase() !== String(name || '').toLowerCase()) {
      toast.error(`Type the family name "${name}" in the confirm box`);
      return;
    }
    let rackets = undefined;
    if (racketsJson.trim()) {
      try {
        rackets = JSON.parse(racketsJson);
      } catch {
        toast.error('Rackets JSON is invalid');
        return;
      }
    }
    const body = {
      family_id: familyPreview.family_id,
      boss_username: bossUsername.trim() || undefined,
      treasury: treasury.trim() !== '' ? parseInt(treasury, 10) : undefined,
      treasury_bullets: treasuryBullets.trim() !== '' ? parseInt(treasuryBullets, 10) : undefined,
      rackets,
      dry_run: dryRun,
      confirm_family_name: dryRun ? undefined : confirmFamilyName.trim(),
    };
    setReviveLoading(true);
    try {
      const res = await api.post('/admin/families/revive', body);
      if (dryRun) {
        toast.success(res.data?.message || 'Preview OK');
      } else {
        toast.success(res.data?.message || 'Family revived');
        await loadFamilyPreview(familyPreview.name || familyQuery);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Revive failed');
    } finally {
      setReviveLoading(false);
    }
  };

  const loadIbmMissions = useCallback(async (override) => {
    const un = (override != null ? String(override) : ibUsername).trim();
    if (!un) {
      toast.error('Enter username');
      return;
    }
    setIbmLoading(true);
    setIbmData(null);
    try {
      const res = await api.get(`/admin/illegal-business/missions/user/${encodeURIComponent(un)}`);
      setIbmData(res.data || null);
      setIbmNextDisplay(String(res.data?.next_mission_display ?? ''));
      setIbmPresetPreview(null);
      if (res.data && !res.data.has_business) {
        loadIllegalBusiness(un);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load racket progress');
    } finally {
      setIbmLoading(false);
    }
  }, [ibUsername, loadIllegalBusiness]);

  const previewIbmPreset = async (pctOverride) => {
    const un = (ibmData?.username || ibUsername).trim();
    const pct = pctOverride != null ? Number(pctOverride) : parseInt(String(ibmPresetPct).trim(), 10);
    if (!un || Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Enter username and percent 0–100');
      return;
    }
    if (!ibmData?.has_business) {
      toast.error('Restore or create a business first');
      return;
    }
    setIbmPresetLoading(true);
    try {
      const res = await api.post(
        `/admin/illegal-business/apply-progress/${encodeURIComponent(un)}`,
        { progress_percent: pct, dry_run: true },
      );
      const p = res.data?.preview;
      if (!p) {
        toast.error('No preview returned');
        return;
      }
      setIbmPresetPreview(p);
      setIbmPresetPct(String(pct));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load preview');
      setIbmPresetPreview(null);
    } finally {
      setIbmPresetLoading(false);
    }
  };

  const applyIbmPresetFromPreview = async () => {
    if (!ibmPresetPreview) return;
    const un = (ibmData?.username || ibUsername).trim();
    const pct = ibmPresetPreview.progress_percent;
    if (!window.confirm(`Apply ~${pct}% progress to ${un}?`)) return;
    setIbmPresetLoading(true);
    try {
      const res = await api.post(
        `/admin/illegal-business/apply-progress/${encodeURIComponent(un)}`,
        { progress_percent: pct, dry_run: false },
      );
      setIbmData(res.data || null);
      setIbmNextDisplay(String(res.data?.next_mission_display ?? ''));
      setIbmPresetPreview(null);
      toast.success(res.data?.message || 'Progress applied');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to apply preset');
    } finally {
      setIbmPresetLoading(false);
    }
  };

  const handleSetIbmProgress = async () => {
    const un = (ibmData?.username || ibUsername).trim();
    const n = parseInt(String(ibmNextDisplay).trim(), 10);
    const max = (ibmData?.missions_total || 100) + 1;
    if (!un || Number.isNaN(n) || n < 1 || n > max) {
      toast.error(`Enter next mission 1–${max} (${max} = all complete)`);
      return;
    }
    if (!window.confirm(`Set ${un}'s next racket progress step to #${n}?`)) return;
    setIbmSaving(true);
    try {
      const res = await api.patch(`/admin/illegal-business/missions/user/${encodeURIComponent(un)}`, {
        next_mission_display: n,
      });
      setIbmData(res.data || null);
      setIbmNextDisplay(String(res.data?.next_mission_display ?? n));
      toast.success('Racket progress updated');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set IBM progress');
    } finally {
      setIbmSaving(false);
    }
  };

  const handleRestoreIb = async (holderUsername, dryRun, targetOverride) => {
    const target = (targetOverride || ibData?.username || ibUsername).trim();
    const key = `${holderUsername || 'json'}:${dryRun}`;
    setRestoreLoading(key);
    try {
      const body = {
        target_username: target,
        holder_username: holderUsername || undefined,
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
      await loadIllegalBusiness(target);
      await loadIbmMissions(target);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Restore failed');
    } finally {
      setRestoreLoading(null);
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
    <div className="space-y-6 max-w-3xl" data-testid="admin-crew-recovery-page">
      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
        <div className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Building2 className="text-amber-400" size={18} />
            <h1 className="text-sm font-heading font-bold uppercase tracking-wider">Crew & racket recovery</h1>
          </div>
          <p className="text-[10px] text-mutedForeground font-heading leading-relaxed">
            Fair recovery after cheater wipes: revive the <strong className="text-foreground">family</strong> (not players — use
            Revive player for that) and restore <strong className="text-foreground">illegal businesses</strong> from kill snapshots.
          </p>
          <Link to="/tjjeujr3wa/overview" className="text-[10px] text-primary hover:underline font-heading">
            ← Admin home
          </Link>
        </div>
      </div>

      <section className={`${styles.panel} rounded-lg border border-amber-500/25 p-4 space-y-3`}>
        <h2 className="text-[11px] font-heading font-bold uppercase text-amber-200/90 flex items-center gap-2">
          <Skull size={14} /> Revive wiped crew
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={familyQuery}
            onChange={(e) => setFamilyQuery(e.target.value)}
            placeholder="Family name e.g. ALLEGIANCE"
            className="flex-1 min-w-[160px] px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
          />
          <Btn onClick={() => loadFamilyPreview()} disabled={familyLoading} className="border-primary/40 bg-primary/10 text-primary">
            <Search size={12} className="inline mr-1" />
            {familyLoading ? '…' : 'Load'}
          </Btn>
        </div>

        {familyPreview && (
          <div className="text-[10px] font-heading space-y-2 border-t border-zinc-700/50 pt-3">
            <p>
              <span className="text-foreground font-bold">{familyPreview.name}</span>
              {familyPreview.tag ? <span className="text-mutedForeground"> [{familyPreview.tag}]</span> : null}
              {familyPreview.wiped ? (
                <span className="text-red-400 ml-2">WIPED</span>
              ) : (
                <span className="text-emerald-400 ml-2">Active</span>
              )}
            </p>
            {familyPreview.wiped_by_family_name ? (
              <p className="text-amber-200/80">Wiped by: {familyPreview.wiped_by_family_name}</p>
            ) : null}
            <p className="text-mutedForeground">
              Vault now: ${Number(familyPreview.treasury || 0).toLocaleString()} ·{' '}
              {Number(familyPreview.treasury_bullets || 0).toLocaleString()} bullets · rackets:{' '}
              {Object.keys(familyPreview.rackets || {}).length}
            </p>
            <p>
              Living: {(familyPreview.living_members || []).map((m) => m.username).join(', ') || '—'}
            </p>
            {familyPreview.last_ended_war ? (
              <p className="text-[9px] text-mutedForeground">
                Last war prize treasury (reference): $
                {Number(familyPreview.last_ended_war.prize_treasury || 0).toLocaleString()}
              </p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-[9px] uppercase text-mutedForeground">Don (boss)</span>
                <input
                  type="text"
                  value={bossUsername}
                  onChange={(e) => setBossUsername(e.target.value)}
                  className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
              </label>
              <label className="block">
                <span className="text-[9px] uppercase text-mutedForeground">Restore treasury $</span>
                <input
                  type="number"
                  min="0"
                  value={treasury}
                  onChange={(e) => setTreasury(e.target.value)}
                  placeholder="optional"
                  className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
              </label>
              <label className="block">
                <span className="text-[9px] uppercase text-mutedForeground">Restore vault bullets</span>
                <input
                  type="number"
                  min="0"
                  value={treasuryBullets}
                  onChange={(e) => setTreasuryBullets(e.target.value)}
                  placeholder="optional"
                  className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px]"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-[9px] uppercase text-mutedForeground">Rackets JSON (optional)</span>
                <textarea
                  value={racketsJson}
                  onChange={(e) => setRacketsJson(e.target.value)}
                  rows={3}
                  placeholder='{"gambling": {"level": 10, "last_collected_at": "2026-05-20T12:00:00+00:00"}}'
                  className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-mono"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[9px] uppercase text-mutedForeground">
                Confirm family name to revive
              </span>
              <input
                type="text"
                value={confirmFamilyName}
                onChange={(e) => setConfirmFamilyName(e.target.value)}
                placeholder={familyPreview.name || ''}
                className="w-full mt-0.5 px-2 py-1 rounded border border-red-500/30 bg-transparent text-[11px]"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Btn
                onClick={() => handleReviveFamily(true)}
                disabled={reviveLoading}
                className="border-zinc-600/50 text-mutedForeground"
              >
                Preview
              </Btn>
              <Btn
                onClick={() => handleReviveFamily(false)}
                disabled={reviveLoading}
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              >
                {reviveLoading ? '…' : 'Revive crew'}
              </Btn>
            </div>
          </div>
        )}
      </section>

      <section className={`${styles.panel} rounded-lg border border-primary/25 p-4 space-y-3`}>
        <h2 className="text-[11px] font-heading font-bold uppercase text-primary flex items-center gap-2">
          <Wine size={14} /> Illegal business restore
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={ibUsername}
            onChange={(e) => setIbUsername(e.target.value)}
            placeholder="Victim username e.g. Moey"
            className="flex-1 min-w-[140px] px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
          />
          <Btn onClick={() => loadIllegalBusiness()} disabled={ibLoading} className="border-primary/40 bg-primary/10 text-primary">
            {ibLoading ? '…' : 'Load'}
          </Btn>
        </div>

        {ibData && (
          <div className="text-[10px] font-heading space-y-2 border-t border-zinc-700/50 pt-3">
            {ibData.has_business ? (
              <p className="text-emerald-400">
                Already has a business: {ibData.business?.name} (lvl {ibData.business?.level}, $
                {Number(ibData.business?.vault || 0).toLocaleString()} vault)
              </p>
            ) : (
              <p className="text-amber-300/90">No illegal business on account — restore from snapshot below.</p>
            )}

            {(ibData.pending_on_other_accounts || []).length === 0 ? (
              <p className="text-mutedForeground">No kill snapshots found on other accounts.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-amber-200/90 font-bold">Snapshots on other accounts (cheater may hold these):</p>
                {ibData.pending_on_other_accounts.map((p, i) => (
                  <div key={i} className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2">
                    <p>
                      Holder: <span className="text-foreground font-bold">{p.holder_username}</span>
                      {p.has_snapshot ? (
                        <span className="text-emerald-400 ml-1">· full snapshot</span>
                      ) : (
                        <span className="text-red-400 ml-1">· no snapshot</span>
                      )}
                    </p>
                    {p.snapshot_summary ? (
                      <p className="text-[9px] text-mutedForeground mt-1">
                        {p.snapshot_summary.name} · lvl {p.snapshot_summary.level} · $
                        {Number(p.snapshot_summary.income_per_hour || 0).toLocaleString()}/hr · vault $
                        {Number(p.snapshot_summary.vault || 0).toLocaleString()} · {p.guards_count} guards
                      </p>
                    ) : null}
                    {p.has_snapshot ? (
                      <div className="flex gap-2 mt-2">
                        <Btn
                          onClick={() => handleRestoreIb(p.holder_username, true)}
                          disabled={!!restoreLoading}
                          className="border-zinc-600/50 text-mutedForeground"
                        >
                          Preview
                        </Btn>
                        <Btn
                          onClick={() => handleRestoreIb(p.holder_username, false)}
                          disabled={!!restoreLoading}
                          className="border-primary/40 bg-primary/10 text-primary"
                        >
                          {restoreLoading === `${p.holder_username}:false` ? '…' : 'Restore to victim'}
                        </Btn>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => loadIllegalBusiness(ibData.username)}
              className="text-[9px] text-primary hover:underline flex items-center gap-1"
            >
              <RefreshCw size={10} /> Refresh
            </button>
          </div>
        )}
      </section>

      <section className={`${styles.panel} rounded-lg border border-primary/25 p-4 space-y-3`}>
        <h2 className="text-[11px] font-heading font-bold uppercase text-primary flex items-center gap-2">
          <Wine size={14} /> Racket &amp; business progress
        </h2>
        <p className="text-[9px] text-mutedForeground font-heading">
          Restore the business above first. To change progress, use{' '}
          <Link to="/tjjeujr3wa/racket-progress" className="text-primary underline underline-offset-2">
            Racket progress
          </Link>
          .
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={ibUsername}
            onChange={(e) => setIbUsername(e.target.value)}
            placeholder="Username"
            className="flex-1 min-w-[140px] px-2 py-1.5 rounded border border-input bg-transparent text-[11px] font-heading"
          />
          <Btn onClick={() => loadIbmMissions()} disabled={ibmLoading} className="border-primary/40 bg-primary/10 text-primary">
            {ibmLoading ? '…' : 'Load progress'}
          </Btn>
        </div>
        {ibmData && (
          <div className="text-[10px] font-heading space-y-2 border-t border-zinc-700/50 pt-3">
            <p>
              <span className="text-foreground font-bold">{ibmData.username}</span>
              {' · '}
              {ibmData.missions_completed_count}/{ibmData.missions_total} done
              {!ibmData.has_business && (
                <span className="text-amber-300/90 ml-1">· no business doc</span>
              )}
            </p>
            {!ibmData.has_business && (
              <div className="rounded border border-amber-500/35 bg-amber-950/25 p-2 space-y-2">
                <p className="text-[9px] font-heading font-bold uppercase text-amber-200">Restore racket</p>
                {ibLoading ? (
                  <p className="text-[9px] text-mutedForeground">Loading kill snapshots…</p>
                ) : !ibData || String(ibData.username || '').toLowerCase() !== String(ibmData.username || '').toLowerCase() ? (
                  <Btn
                    onClick={() => loadIllegalBusiness(ibmData.username)}
                    disabled={ibLoading}
                    className="border-amber-500/40 bg-amber-500/10 text-amber-200"
                  >
                    Load snapshots
                  </Btn>
                ) : (ibData.pending_on_other_accounts || []).length === 0 ? (
                  <p className="text-[9px] text-mutedForeground">No kill snapshots found on other accounts.</p>
                ) : (
                  <div className="space-y-2">
                    {ibData.pending_on_other_accounts.map((p, i) => (
                      p.has_snapshot ? (
                        <div key={i} className="rounded border border-zinc-700/40 bg-zinc-900/40 p-2">
                          <p className="text-[9px]">
                            From <span className="text-foreground font-bold">{p.holder_username}</span>
                            {p.snapshot_summary ? (
                              <span className="text-mutedForeground">
                                {' '}
                                · {p.snapshot_summary.name} · lvl {p.snapshot_summary.level} · vault $
                                {Number(p.snapshot_summary.vault || 0).toLocaleString()}
                              </span>
                            ) : null}
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Btn
                              onClick={() => handleRestoreIb(p.holder_username, true, ibmData.username)}
                              disabled={!!restoreLoading}
                              className="border-zinc-600/50 text-mutedForeground"
                            >
                              Preview
                            </Btn>
                            <Btn
                              onClick={() => handleRestoreIb(p.holder_username, false, ibmData.username)}
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
            )}
            {ibmData.active_mission && (
              <p className="text-mutedForeground">
                Active: #{ibmData.active_mission.display_index} {ibmData.active_mission.title}
              </p>
            )}
            {ibmData.all_missions_complete && (
              <p className="text-emerald-400">All business progress complete.</p>
            )}
            {ibmData.business_summary && (
              <p className="text-[9px] text-mutedForeground">
                Business: ${Number(ibmData.business_summary.vault || 0).toLocaleString()} vault ·{' '}
                {Number(ibmData.business_summary.income_per_hour || 0).toLocaleString()}/hr ·{' '}
                {ibmData.business_summary.security_level} security ·{' '}
                {ibmData.business_summary.active_guards}/{ibmData.business_summary.guard_slots} guards
              </p>
            )}
            <div className="rounded border border-primary/20 bg-primary/5 p-2 space-y-2">
              <p className="text-[9px] uppercase text-primary font-bold">Overall progress preset</p>
              <p className="text-[9px] text-mutedForeground">
                Pick a % to preview changes (now vs after). Nothing is saved until you click Apply in the preview box.
              </p>
              <div className="flex flex-wrap gap-1">
                {[25, 50, 75, 100].map((p) => (
                  <Btn
                    key={p}
                    onClick={() => previewIbmPreset(p)}
                    disabled={ibmPresetLoading || !ibmData.has_business}
                    className="border-primary/30 text-primary"
                  >
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
                    value={ibmPresetPct}
                    onChange={(e) => {
                      setIbmPresetPct(e.target.value);
                      setIbmPresetPreview(null);
                    }}
                    className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px] tabular-nums"
                  />
                </label>
                <Btn
                  onClick={() => previewIbmPreset(null)}
                  disabled={ibmPresetLoading || !ibmData.has_business}
                  className="border-primary/40 bg-primary/10 text-primary"
                >
                  {ibmPresetLoading ? '…' : 'Preview'}
                </Btn>
              </div>
              <IbmPresetPreviewPanel
                preview={ibmPresetPreview}
                onApply={applyIbmPresetFromPreview}
                onDismiss={() => setIbmPresetPreview(null)}
                applying={ibmPresetLoading}
              />
            </div>
            <label className="block">
              <span className="text-[9px] uppercase text-mutedForeground">Next progress step (1–{ibmData.missions_total + 1})</span>
              <input
                type="number"
                min={1}
                max={ibmData.missions_total + 1}
                value={ibmNextDisplay}
                onChange={(e) => setIbmNextDisplay(e.target.value)}
                className="w-full mt-0.5 px-2 py-1 rounded border border-input bg-transparent text-[11px] tabular-nums"
              />
            </label>
            <Btn
              onClick={handleSetIbmProgress}
              disabled={ibmSaving}
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            >
              {ibmSaving ? '…' : 'Apply progress'}
            </Btn>
          </div>
        )}
      </section>

      <section className={`${styles.panel} rounded-lg border border-violet-500/25 p-4 space-y-3`}>
        <h2 className="text-[11px] font-heading font-bold uppercase text-violet-300 flex items-center gap-2">
          <Wine size={14} /> Distillery progress
        </h2>
        <p className="text-[9px] text-mutedForeground font-heading">
          Set still upgrades and special track % for booze rackets. Restore the business above first if missing.
        </p>
        <AdminDistilleryProgress embedded initialUsername={ibUsername.trim()} />
      </section>
    </div>
  );
}
