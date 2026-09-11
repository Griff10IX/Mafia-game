import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Crosshair, Flame, Shield, ZoomIn, X, Crown, Sparkles } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const BAR_ID = 'weapon_loot_bar';

export default function ViewWeapon() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = (searchParams.get('id') || BAR_ID).trim();
  const [weapon, setWeapon] = useState(null);
  const [onProfile, setOnProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

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
  const heroSrc = '/images/weapons/weapon_loot_bar/mafia-exclusive.png';

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
        <button
          type="button"
          onClick={() => setPhotoOpen(true)}
          className="group relative block w-full aspect-[16/9] overflow-hidden bg-black text-left"
          aria-label={`Enlarge ${name}`}
        >
          <img
            src={heroSrc}
            alt={name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25 pointer-events-none" />
          <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded border border-amber-300/45 bg-black/65 px-2.5 py-1 text-[9px] font-heading font-bold uppercase tracking-[0.14em] text-amber-300 shadow-lg backdrop-blur-sm">
            <Crown size={11} />
            Loot Exclusive
          </div>
          <div className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white/80 backdrop-blur-sm transition-colors group-hover:border-amber-300/60 group-hover:text-amber-300">
            <ZoomIn size={14} />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 md:p-4">
            <div>
              <div className="mb-1 flex items-center gap-1 text-[8px] font-heading font-bold uppercase tracking-[0.18em] text-amber-300/90">
                <Sparkles size={10} />
                The Commissioner’s Private Reserve
              </div>
              <div className="text-sm md:text-lg font-heading font-bold text-white drop-shadow-lg">{name}</div>
            </div>
            <span className="shrink-0 text-[8px] font-heading uppercase tracking-wider text-white/60">Click to inspect</span>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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
      </div>

      <div className={`relative overflow-hidden p-3 ${styles.panel} border border-amber-500/20 rounded-md`}>
        <div className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-transparent via-amber-400/70 to-transparent" />
        <p className="text-[10px] md:text-[11px] leading-relaxed text-mutedForeground font-heading">
          A full-power military BAR finished in blued steel and walnut. Kept off every public rack and issued only through
          the Commissioner’s private loot reserve.
        </p>
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

      {photoOpen ? (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-black/95 p-2 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={name}
          onClick={() => setPhotoOpen(false)}
        >
          <button
            type="button"
            onClick={() => setPhotoOpen(false)}
            className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white hover:border-amber-300/70 hover:text-amber-300"
            aria-label="Close image"
          >
            <X size={20} />
          </button>
          <div className="relative max-h-full max-w-7xl overflow-hidden rounded-md border border-amber-400/35 shadow-[0_0_80px_rgba(217,164,65,0.14)]" onClick={(e) => e.stopPropagation()}>
            <img src={heroSrc} alt={name} className="block max-h-[92vh] max-w-full object-contain" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 pt-12">
              <div className="text-[9px] font-heading font-bold uppercase tracking-[0.18em] text-amber-300">Loot Exclusive</div>
              <div className="text-base md:text-xl font-heading font-bold text-white">{name}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
