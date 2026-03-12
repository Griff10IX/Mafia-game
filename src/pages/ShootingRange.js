import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Crosshair } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

export default function ShootingRange() {
  const [masteryData, setMasteryData] = useState(null);
  const [weaponsList, setWeaponsList] = useState([]);
  const [trainingWeaponId, setTrainingWeaponId] = useState(null);

  const fetchMastery = useCallback(async () => {
    try {
      const res = await api.get('/shooting-range/mastery');
      setMasteryData(res.data);
    } catch {
      setMasteryData(null);
    }
  }, []);

  useEffect(() => {
    fetchMastery();
  }, [fetchMastery]);

  useEffect(() => {
    let cancelled = false;
    api.get('/weapons').then((res) => {
      if (!cancelled && Array.isArray(res.data)) setWeaponsList(res.data);
    }).catch(() => { if (!cancelled) setWeaponsList([]); });
    return () => { cancelled = true; };
  }, []);

  const trainWeapon = async (weaponId) => {
    setTrainingWeaponId(weaponId);
    try {
      const res = await api.post('/shooting-range/train', { weapon_id: weaponId, mode: 'auto_sim' });
      toast.success(res.data?.message || 'Trained');
      fetchMastery();
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Training failed');
    } finally {
      setTrainingWeaponId(null);
    }
  };

  return (
    <div className={`${styles.pageContent} mx-auto`} style={{ padding: '1rem', maxWidth: 640 }}>
      <div className="flex items-center gap-2 mb-4">
        <Link to="/armour-weapons" className="text-[10px] font-heading uppercase tracking-wider" style={{ color: 'var(--noir-primary)' }}>
          ← Armoury
        </Link>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Crosshair size={22} style={{ color: 'var(--noir-primary)' }} />
        <h1 className="text-lg font-heading font-bold uppercase tracking-wider" style={{ color: 'var(--noir-primary)' }}>
          Shooting range
        </h1>
      </div>
      <p className="text-[11px] text-zinc-400 font-heading mb-4">
        Master a weapon here to reduce bullets needed when attacking with it (up to 10% at full mastery). Train guns you own.
      </p>
      <div className="flex gap-2 mb-4">
        <Link
          to="/shooting-range/play"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-[10px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Crosshair size={14} />
          Play 3D range
        </Link>
      </div>
      <div className="rounded-lg p-3 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
        <div className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Crosshair size={10} className="sm:w-[11px] sm:h-[11px]" />
          Weapon mastery
        </div>
        {masteryData?.weapons?.length
          ? (
              <div className="space-y-2">
                {masteryData.weapons.map((w) => {
                  if (w.id === 'weapon1') return null;
                  const info = masteryData.mastery?.[w.id] || { mastery_pct: 0 };
                  const pct = Number(info.mastery_pct) || 0;
                  const owned = weaponsList.some((x) => x.id === w.id && x.owned);
                  const training = trainingWeaponId === w.id;
                  return (
                    <div key={w.id} className="flex flex-wrap items-center gap-2 py-1.5 border-b border-zinc-700/30 last:border-0">
                      <span className="text-[10px] sm:text-[11px] font-heading text-foreground min-w-[100px] sm:min-w-[120px]">
                        {w.name}
                        {owned && <span className="text-emerald-500 ml-0.5">(owned)</span>}
                      </span>
                      <div className="flex-1 min-w-[80px] h-2 sm:h-2.5 rounded-full bg-zinc-800 overflow-hidden border border-zinc-700/50">
                        <div
                          className="h-full bg-primary/80 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <span className="text-[9px] sm:text-[10px] text-zinc-500 tabular-nums w-8">{pct}%</span>
                      <button
                        type="button"
                        disabled={!owned || training || pct >= 100}
                        onClick={() => trainWeapon(w.id)}
                        className="px-2 py-1 rounded text-[9px] sm:text-[10px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      >
                        {training ? 'Training...' : pct >= 100 ? 'Mastered' : 'Train 5 min'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          : masteryData ? (
              <p className="text-[10px] text-zinc-500">No guns available to train.</p>
            ) : (
              <p className="text-[10px] text-zinc-500">Loading mastery…</p>
            )}
      </div>
    </div>
  );
}
