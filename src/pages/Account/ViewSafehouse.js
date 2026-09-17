import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Clock, Coins, Eye, Package, Shield, Sparkles, Trophy, ZoomIn, X, Crown } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const HERO_SRC = '/images/properties/safehouse/hero.png';

export default function ViewSafehouse() {
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [onProfile, setOnProfile] = useState(true);
  const [owns, setOwns] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [invRes, prefRes] = await Promise.all([
          api.get('/inventory').catch(() => ({ data: {} })),
          api.get('/profile/safehouse-preferences').catch(() => ({ data: {} })),
        ]);
        const le = invRes.data?.loot_exclusives || {};
        if (!cancelled) {
          setOwns(Boolean(le.has_safehouse) || Boolean(prefRes.data?.has_safehouse));
          setInfo(le.safehouse || null);
          setOnProfile(Boolean(prefRes.data?.show_safehouse_on_profile));
        }
      } catch {
        if (!cancelled) setOwns(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleProfile = async () => {
    if (!owns) {
      toast.error('You do not own the Safehouse');
      return;
    }
    setSaving(true);
    try {
      const next = !onProfile;
      await api.patch('/profile/safehouse-preferences', { show_safehouse_on_profile: next });
      setOnProfile(next);
      toast.success(next ? 'Shown on profile' : 'Hidden from profile');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const name = info?.name || 'Safehouse';
  const weeklyCash = info?.weekly_cash ?? 150_000_000;
  const weeklyRespect = info?.weekly_respect ?? 5_000;
  const intervalDays = info?.interval_days ?? 3;
  const hideHours = info?.hide_hours ?? 3;

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} style={{ padding: '12px 14px', maxWidth: '52rem', margin: '0 auto' }}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center justify-center w-9 h-9 text-primary" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="text-[9px] font-heading font-bold uppercase tracking-[0.16em] text-rose-300">Loot exclusive</div>
          <h1 className="text-lg md:text-xl font-heading font-bold text-foreground leading-tight">{name}</h1>
        </div>
      </div>

      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-rose-500/35`}>
        <div className="h-px bg-gradient-to-r from-transparent via-rose-400/50 to-transparent" />
        <button
          type="button"
          onClick={() => setPhotoOpen(true)}
          className="group relative block w-full aspect-[16/9] overflow-hidden bg-black text-left"
          aria-label={`Enlarge ${name}`}
        >
          <img
            src={HERO_SRC}
            alt={name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />
          <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded border border-rose-300/45 bg-black/65 px-2.5 py-1 text-[9px] font-heading font-bold uppercase tracking-[0.14em] text-rose-200 shadow-lg backdrop-blur-sm">
            <Crown size={11} />
            Loot Exclusive
          </div>
          <div className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white/80 backdrop-blur-sm transition-colors group-hover:border-rose-300/60 group-hover:text-rose-200">
            <ZoomIn size={14} />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 md:p-4">
            <div>
              <div className="mb-1 flex items-center gap-1 text-[8px] font-heading font-bold uppercase tracking-[0.18em] text-rose-200/90">
                <Sparkles size={10} />
                Private lakeside estate
              </div>
              <div className="text-sm md:text-lg font-heading font-bold text-white drop-shadow-lg">{name}</div>
            </div>
            <span className="shrink-0 text-[8px] font-heading uppercase tracking-wider text-white/60">Click to inspect</span>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className={`p-2.5 ${styles.panel} border border-primary/20 rounded-md`}>
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground flex items-center gap-1"><Coins size={11} className="text-emerald-400" /> Weekly cash</div>
          <div className="text-base md:text-lg font-heading font-bold text-emerald-400 tabular-nums">${Number(weeklyCash).toLocaleString()}</div>
        </div>
        <div className={`p-2.5 ${styles.panel} border border-primary/20 rounded-md`}>
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground flex items-center gap-1"><Trophy size={11} className="text-violet-300" /> Weekly respect</div>
          <div className="text-base md:text-lg font-heading font-bold text-violet-300 tabular-nums">{Number(weeklyRespect).toLocaleString()}</div>
        </div>
        <div className={`p-2.5 ${styles.panel} border border-primary/20 rounded-md`}>
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground flex items-center gap-1"><Clock size={11} className="text-rose-300" /> Hide</div>
          <div className="text-base md:text-lg font-heading font-bold text-foreground">{hideHours}h / day</div>
        </div>
        <div className={`p-2.5 ${styles.panel} border border-primary/20 rounded-md`}>
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground flex items-center gap-1"><Package size={11} className="text-sky-300" /> Every {intervalDays}d</div>
          <div className="text-[11px] font-heading font-bold text-sky-300 leading-snug">BG + mission + 100 pieces</div>
        </div>
      </div>

      <div className={`relative overflow-hidden p-3 ${styles.panel} border border-rose-500/20 rounded-md`}>
        <div className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-transparent via-rose-400/70 to-transparent" />
        <p className="text-[10px] md:text-[11px] leading-relaxed text-mutedForeground font-heading">
          A fortified lakeside estate kept off every public ledger. Enter once per day to vanish from kill searches for {hideHours} hours.
          Collectors earn serious weekly cash and respect, plus robot bodyguard / mission tokens and loot pieces every {intervalDays} days.
          If the owner dies, the Safehouse returns to the loot pool.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {owns ? (
          <button
            type="button"
            disabled={saving}
            onClick={toggleProfile}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-primary/40 bg-primary/15 text-primary text-[10px] font-heading font-bold uppercase tracking-wide"
          >
            <Shield size={12} />
            {onProfile ? 'Hide from profile' : 'Show on profile'}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[10px] font-heading text-mutedForeground">
            <Eye size={12} />
            Viewing showcase
          </span>
        )}
        <Link
          to="/account/inventory"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[10px] font-heading font-bold uppercase tracking-wide text-mutedForeground hover:text-foreground"
        >
          <Building2 size={12} />
          Inventory
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
            className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white hover:border-rose-300/70 hover:text-rose-200"
            aria-label="Close image"
          >
            <X size={20} />
          </button>
          <div className="relative max-h-full max-w-7xl overflow-hidden rounded-md border border-rose-400/35 shadow-[0_0_80px_rgba(244,63,94,0.14)]" onClick={(e) => e.stopPropagation()}>
            <img src={HERO_SRC} alt={name} className="block max-h-[92vh] max-w-full object-contain" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 pt-12">
              <div className="text-[9px] font-heading font-bold uppercase tracking-[0.18em] text-rose-200">Loot Exclusive</div>
              <div className="text-base md:text-xl font-heading font-bold text-white">{name}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
