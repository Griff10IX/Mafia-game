import { useEffect, useState } from 'react';
import api from '../../../utils/api';
import { toast } from 'sonner';

const fieldClass = 'w-20 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none font-mono';
const primaryBtn = 'bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 touch-manipulation font-heading';
const secondaryBtn = 'bg-zinc-700/50 hover:bg-zinc-600/50 text-foreground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 transition-all disabled:opacity-50 touch-manipulation';

function draftFrom(difficulties) {
  const next = {};
  for (const row of difficulties || []) {
    next[row.id] = {
      survive_pct: row.survive_pct,
      early_survive_pct: row.early_survive_pct,
    };
  }
  return next;
}

export default function AdminChickenCrossOdds() {
  const [meta, setMeta] = useState([]);
  const [draft, setDraft] = useState({});
  const [custom, setCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const apply = (data) => {
    const rows = data?.difficulties || [];
    setMeta(rows);
    setDraft(draftFrom(rows));
    setCustom(!!data?.custom);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/casinos/chicken-cross-odds');
      apply(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load Chicken Cross odds');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setPct = (id, field, raw) => {
    const n = String(raw).replace(/[^\d]/g, '').slice(0, 2);
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], [field]: n } }));
  };

  const save = async () => {
    const difficulties = {};
    for (const row of meta) {
      const values = draft[row.id] || {};
      const survive = Number(values.survive_pct);
      if (!Number.isInteger(survive) || survive < 1 || survive > 99) {
        toast.error(`${row.label} needs a whole percent from 1 to 99`);
        return;
      }
      const item = { survive_pct: survive };
      if (row.early_lanes) {
        const early = Number(values.early_survive_pct);
        if (!Number.isInteger(early) || early < 1 || early > 99) {
          toast.error(`${row.label} first lanes need a whole percent from 1 to 99`);
          return;
        }
        item.early_survive_pct = early;
      }
      difficulties[row.id] = item;
    }
    setSaving(true);
    try {
      const res = await api.patch('/admin/casinos/chicken-cross-odds', { difficulties });
      apply(res.data);
      toast.success('Chicken Cross hop chances saved');
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to save Chicken Cross odds');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const res = await api.patch('/admin/casinos/chicken-cross-odds', { reset: true });
      apply(res.data);
      toast.success('Chicken Cross hop chances reset');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reset Chicken Cross odds');
    } finally {
      setSaving(false);
    }
  };

  if (loading && meta.length === 0) {
    return <div className="p-3"><p className="text-xs text-mutedForeground">Loading...</p></div>;
  }

  return (
    <div className="p-3 space-y-3">
      <p className="text-[10px] text-mutedForeground">
        Hidden hop chance for new rounds. Players still see the same lane multipliers. A round already in progress keeps the odds it started with.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryBtn} onClick={load} disabled={loading || saving}>{loading ? '…' : 'Refresh'}</button>
        <button type="button" className={primaryBtn} onClick={save} disabled={saving || loading}>{saving ? '…' : 'Save'}</button>
        <button type="button" className={secondaryBtn} onClick={reset} disabled={saving || loading || !custom}>Use code defaults</button>
      </div>
      <div className="space-y-2">
        {meta.map((row) => {
          const values = draft[row.id] || {};
          return (
            <div key={row.id} className="rounded-md border border-zinc-700/50 bg-zinc-900/40 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-heading font-bold text-foreground uppercase tracking-wider">{row.label}</div>
                <span className="text-[9px] text-mutedForeground font-heading">Board priced at {row.pay_pct}%</span>
              </div>
              {row.early_lanes ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] text-mutedForeground uppercase font-heading block">First {row.early_lanes} lanes %</span>
                    <input className={fieldClass} inputMode="numeric" value={values.early_survive_pct ?? ''} onChange={(e) => setPct(row.id, 'early_survive_pct', e.target.value)} />
                    <span className="text-[9px] text-mutedForeground block">Code default {row.default_early_survive_pct}%</span>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] text-mutedForeground uppercase font-heading block">After that %</span>
                    <input className={fieldClass} inputMode="numeric" value={values.survive_pct ?? ''} onChange={(e) => setPct(row.id, 'survive_pct', e.target.value)} />
                    <span className="text-[9px] text-mutedForeground block">Code default {row.default_survive_pct}%</span>
                  </label>
                </div>
              ) : (
                <label className="space-y-1 block">
                  <span className="text-[9px] text-mutedForeground uppercase font-heading block">Survive each hop %</span>
                  <input className={fieldClass} inputMode="numeric" value={values.survive_pct ?? ''} onChange={(e) => setPct(row.id, 'survive_pct', e.target.value)} />
                  <span className="text-[9px] text-mutedForeground block">Code default {row.default_survive_pct}%</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
