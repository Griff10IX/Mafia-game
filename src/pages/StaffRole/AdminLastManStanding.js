import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';

export default function AdminLastManStanding() {
  const navigate = useNavigate();
  const [ok, setOk] = useState(false);
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('Premier League LMS');
  const [busyId, setBusyId] = useState('');

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
        setOk(true);
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
      const res = await api.get('/admin/lms/seasons');
      setSeasons(res.data?.seasons || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load LMS seasons');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ok) load();
  }, [ok, load]);

  async function createSeason() {
    setBusyId('create');
    try {
      const res = await api.post('/admin/lms/seasons', { name });
      const msg = res.data?.sync?.message;
      toast.success(msg ? `Created. ${msg}` : 'Season created');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Create failed');
    } finally {
      setBusyId('');
    }
  }

  async function act(id, path, label) {
    setBusyId(`${id}:${label}`);
    try {
      const res = await api.post(`/admin/lms/seasons/${id}/${path}`);
      toast.success(res.data?.message || `${label} ok`);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || `${label} failed`);
    } finally {
      setBusyId('');
    }
  }

  async function settle(id, gw) {
    setBusyId(`${id}:settle`);
    try {
      await api.post(`/admin/lms/gameweeks/${id}/${gw}/settle`);
      toast.success(`Settled GW${gw}`);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Settle failed');
    } finally {
      setBusyId('');
    }
  }

  if (!ok) {
    return <p className="text-sm text-mutedForeground font-heading p-4">Loading LMS admin…</p>;
  }

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} style={{ padding: 14, maxWidth: 900, margin: '0 auto' }}>
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Last Man Standing</h1>
        </div>
        <button type="button" onClick={load} className="px-2 py-1 rounded border border-primary/40 text-primary text-[10px] font-heading font-bold uppercase">
          <RefreshCw className={`w-3 h-3 inline ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-[9px] uppercase text-mutedForeground font-heading mb-0.5">Season name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-foreground min-w-[180px]" />
        </div>
        <button
          type="button"
          disabled={!!busyId}
          onClick={createSeason}
          className="px-3 py-1 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40 disabled:opacity-50"
        >
          Create (150k pot / 5k entry)
        </button>
      </div>

      <div className="space-y-2">
        {seasons.map((s) => (
          <div key={s.id} className="rounded border border-zinc-800 p-2 text-[11px] font-heading">
            <div className="flex flex-wrap justify-between gap-1">
              <b className="text-foreground">{s.name}</b>
              <span className="text-zinc-400">{s.status} · pot {Number(s.pot || 0).toLocaleString()} · {s.entered || 0} in / {s.alive || 0} alive</span>
            </div>
            <div className={`mt-1 ${s.gw1_complete ? 'text-emerald-300' : 'text-amber-300'}`}>
              GW1 {s.gw1_complete ? 'complete' : `incomplete — ${s.gw1_fixtures || 0}/10 fixtures (${s.gw1_teams || 0} teams)`}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <button type="button" disabled={!!busyId} onClick={() => act(s.id, 'sync-fixtures', 'Sync')} className="px-2 py-1 rounded border border-zinc-600 text-[10px]">Sync fixtures</button>
              <button type="button" disabled={!!busyId} onClick={() => act(s.id, 'open', 'Open')} className="px-2 py-1 rounded border border-zinc-600 text-[10px]">Open GW1</button>
              <button type="button" disabled={!!busyId} onClick={() => settle(s.id, s.current_gameweek || 1)} className="px-2 py-1 rounded border border-zinc-600 text-[10px]">Force settle current GW</button>
              <button
                type="button"
                disabled={!!busyId}
                onClick={async () => {
                  setBusyId(`${s.id}:tick`);
                  try {
                    await api.post('/admin/lms/tick');
                    toast.success('Tick ok');
                    await load();
                  } catch (e) {
                    toast.error(e.response?.data?.detail || 'Tick failed');
                  } finally {
                    setBusyId('');
                  }
                }}
                className="px-2 py-1 rounded border border-zinc-600 text-[10px]"
              >
                Cron tick
              </button>
              <button type="button" disabled={!!busyId} onClick={() => act(s.id, 'cancel', 'Cancel')} className="px-2 py-1 rounded border border-rose-800 text-rose-300 text-[10px]">Cancel + refund</button>
            </div>
          </div>
        ))}
        {!seasons.length && <p className="text-zinc-500">No seasons yet.</p>}
      </div>
    </div>
  );
}
