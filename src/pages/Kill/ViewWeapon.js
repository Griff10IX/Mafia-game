import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Crosshair, Flame, Shield } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import BarM1918A2Viewer from '../../components/BarM1918A2Viewer';

const BAR_ID = 'weapon_loot_bar';

export default function ViewWeapon() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = (searchParams.get('id') || BAR_ID).trim();
  const [weapon, setWeapon] = useState(null);
  const [onProfile, setOnProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rounds, setRounds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wRes, pRes] = await Promise.all([
          api.get('/weapons').catch(() => ({ data: [] })),
          api.get('/profile/weapon-preferences').catch(() => ({ data: {} })),
        ]);
        const list = Array.isArray(wRes.data) ? wRes.data : wRes.data?.weapons || [];
        const found = list.find((w) => w.id === id) || {
          id,
          name: 'Browning Automatic Rifle M1918A2',
          damage: 175,
          bullets_needed: 30,
          loot_exclusive: true,
        };
        if (!cancelled) {
          setWeapon(found);
          setOnProfile(Boolean(pRes.data?.show_weapon_on_profile) && pRes.data?.profile_weapon_id === id);
        }
      } catch {
        if (!cancelled) {
          setWeapon({
            id,
            name: 'Browning Automatic Rifle M1918A2',
            damage: 175,
            bullets_needed: 30,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggleProfile = async () => {
    setSaving(true);
    try {
      const next = !onProfile;
      await api.patch('/profile/weapon-preferences', {
        show_weapon_on_profile: next,
        profile_weapon_id: next ? id : '',
      });
      setOnProfile(next);
      toast.success(next ? 'Shown on profile' : 'Hidden from profile');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const name = weapon?.name || 'Browning Automatic Rifle M1918A2';

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} style={{ padding: '12px 14px', maxWidth: '52rem', margin: '0 auto' }}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center justify-center w-9 h-9 text-primary" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="text-[9px] font-heading font-bold uppercase tracking-[0.16em] text-amber-400">Loot exclusive</div>
          <h1 className="text-lg md:text-xl font-heading font-bold text-foreground leading-tight">{name}</h1>
        </div>
      </div>

      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-amber-500/30`}>
        <div className="h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />
        <div className="relative aspect-[16/11] md:aspect-[16/9] bg-black min-h-[18rem]">
          {id === BAR_ID ? (
            <BarM1918A2Viewer onShot={() => setRounds((n) => n + 1)} />
          ) : (
            <p className="p-6 text-[11px] text-mutedForeground font-heading">No 3D model for this weapon.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className={`p-2.5 ${styles.panel} border border-primary/20 rounded-md`}>
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground flex items-center gap-1"><Flame size={11} className="text-primary" /> Damage</div>
          <div className="text-lg font-heading font-bold text-foreground tabular-nums">{weapon?.damage ?? 175}</div>
        </div>
        <div className={`p-2.5 ${styles.panel} border border-primary/20 rounded-md`}>
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground flex items-center gap-1"><Crosshair size={11} className="text-primary" /> Bullets</div>
          <div className="text-lg font-heading font-bold text-foreground tabular-nums">{weapon?.bullets_needed ?? 30}</div>
        </div>
        <div className={`p-2.5 ${styles.panel} border border-primary/20 rounded-md`}>
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground">Attack cost</div>
          <div className="text-lg font-heading font-bold text-emerald-400">−30%</div>
        </div>
        <div className={`p-2.5 ${styles.panel} border border-primary/20 rounded-md`}>
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground">Rounds fired</div>
          <div className="text-lg font-heading font-bold text-amber-300 tabular-nums">{rounds}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={toggleProfile}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading font-bold uppercase tracking-wide"
        >
          <Shield size={12} />
          {onProfile ? 'Hide from profile' : 'Show on profile'}
        </button>
        <Link
          to="/kill/armour-weapons"
          className="inline-flex items-center h-9 px-3 rounded-md border border-border text-[10px] font-heading font-bold uppercase tracking-wide text-mutedForeground hover:text-foreground"
        >
          Armoury
        </Link>
      </div>
    </div>
  );
}
