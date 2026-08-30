import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Car, ArrowLeft, Clock, DollarSign, Sparkles, User, Wrench, UserCircle, Image as ImageIcon, X, ZoomIn } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import CustomCarImageModal from '../../components/CustomCarImageModal';
import { readViewCarCache, writeViewCarCache } from '../../utils/viewCarWarm';

const VIEW_CAR_STYLES = `
  @keyframes vc-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .vc-enter { animation: vc-enter 0.35s ease-out both; }
  .vc-page { display: flex; flex-direction: column; gap: 10px; max-width: 52rem; margin-left: auto; margin-right: auto; }
  .vc-section { overflow: hidden; }
  .vc-section-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--gm-border, var(--noir-border));
  }
  .vc-section-title {
    display: flex; align-items: center; gap: 7px;
    font-size: 10px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--noir-primary);
  }
  .vc-section-title svg { color: var(--noir-primary); flex-shrink: 0; }
  .vc-body { padding: 12px; }
  .vc-layout {
    display: flex; flex-direction: column; gap: 10px;
  }
  @media (min-width: 1024px) {
    .vc-layout { flex-direction: row; align-items: stretch; gap: 12px; }
    .vc-photo-col { width: 42%; max-width: 22rem; }
  }
  .vc-photo-col { width: 100%; }
  .vc-photo {
    position: relative;
    overflow: hidden;
    width: 100%;
    aspect-ratio: 4 / 3;
    min-height: 12rem;
    background: var(--noir-content, #0a0a0a);
    border: 1px solid var(--gm-border, var(--noir-border));
    border-radius: var(--app-surface-radius, 8px);
  }
  @media (min-width: 1024px) {
    .vc-photo { aspect-ratio: auto; height: 100%; min-height: 16rem; }
  }
  .vc-photo img {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    object-fit: cover; object-position: center;
    transform: scale(1.08);
  }
  .vc-photo-zoom {
    position: absolute; inset: 0;
    border: 0; padding: 0; margin: 0;
    background: transparent;
    cursor: zoom-in;
  }
  .vc-photo-zoom:focus-visible {
    outline: 2px solid var(--noir-primary);
    outline-offset: -2px;
  }
  .vc-photo-hint {
    position: absolute; top: 8px; right: 8px;
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    border-radius: 999px;
    border: 1px solid rgba(var(--noir-primary-rgb), 0.4);
    background: rgba(0, 0, 0, 0.55);
    color: var(--noir-primary);
    pointer-events: none;
  }
  .vc-photo-change {
    position: absolute; inset-inline: 0; bottom: 0; z-index: 2;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 8px 10px;
    border: 0; border-top: 1px solid rgba(var(--noir-primary-rgb), 0.35);
    background: linear-gradient(180deg, transparent, rgba(0,0,0,0.88) 40%);
    color: var(--noir-primary);
    font-size: 9px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
    cursor: pointer;
  }
  .vc-stats { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .vc-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .vc-stat {
    padding: 10px 11px;
    background: var(--gm-card-hover, var(--noir-surface));
    border: 1px solid var(--gm-border, var(--noir-border));
    border-radius: var(--app-surface-radius, 8px);
  }
  .vc-stat-label {
    display: flex; align-items: center; gap: 6px;
    margin-bottom: 4px;
    font-size: 9px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--noir-muted);
  }
  .vc-stat-label svg { color: var(--noir-primary); flex-shrink: 0; }
  .vc-stat-val {
    font-size: 18px; font-weight: 800; line-height: 1.15;
    color: var(--noir-foreground);
    font-variant-numeric: tabular-nums;
  }
  .vc-stat-val.accent { color: var(--noir-primary); }
  .vc-hero-row {
    display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px;
    padding: 12px;
  }
  .vc-name { font-size: 1.35rem; font-weight: 800; line-height: 1.15; color: var(--noir-foreground); }
  .vc-kicker {
    font-size: 9px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--noir-primary);
  }
  .vc-appraised {
    padding: 8px 12px; text-align: right;
    background: var(--gm-card-hover, var(--noir-surface));
    border: 1px solid var(--gm-border, var(--noir-border));
    border-radius: var(--app-surface-radius, 8px);
  }
  .vc-appraised-label {
    font-size: 8px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--noir-muted);
  }
  .vc-appraised-val {
    font-size: 1.25rem; font-weight: 800; color: var(--noir-primary);
    font-variant-numeric: tabular-nums;
  }
  .vc-back {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px;
    color: var(--noir-primary);
    text-decoration: none;
  }
  .vc-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 34px; padding: 0 12px;
    font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    cursor: pointer;
  }
  .vc-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .vc-empty { font-size: 12px; color: var(--noir-muted); }
  .vc-skel {
    background: rgba(var(--noir-primary-rgb), 0.08);
    border-radius: 4px;
  }
  body[data-theme-variant="old_school"] .vc-photo,
  body[data-theme-variant="old_school"] .vc-stat,
  body[data-theme-variant="old_school"] .vc-appraised {
    border-radius: 0;
    box-shadow: var(--os-bevel);
  }
  body[data-theme-variant="old_school"] .vc-section-head {
    background: var(--os-metal-face);
    border-bottom-color: var(--os-chrome);
  }
  @media (prefers-reduced-motion: reduce) {
    .vc-enter { animation: none !important; }
  }
`;

const RARITY_COLORS = {
  common: 'text-zinc-400',
  uncommon: 'text-emerald-400',
  rare: 'text-sky-400',
  ultra_rare: 'text-violet-400',
  legendary: 'text-amber-400',
  custom: 'text-primary',
  exclusive: 'text-rose-400',
  loot_exclusive: 'text-amber-400',
  vip_exclusive: 'text-cyan-500',
};

export default function ViewCar() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const [car, setCar] = useState(() => (id ? readViewCarCache(id) : null));
  const [hasLoaded, setHasLoaded] = useState(() => !!(id && readViewCarCache(id)));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileCarIds, setProfileCarIds] = useState([]);
  const [customPicOpen, setCustomPicOpen] = useState(false);
  const [customPicUrl, setCustomPicUrl] = useState('');
  const [savingCustomPic, setSavingCustomPic] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  useEffect(() => {
    if (!photoOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPhotoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setCar(null);
      setHasLoaded(true);
      return undefined;
    }
    const cached = readViewCarCache(id);
    if (cached) {
      setCar(cached);
      setHasLoaded(true);
    }
    const fetchCar = async () => {
      try {
        const [carRes, prefsRes] = await Promise.all([
          api.get('/gta/view-car', { params: { id } }),
          api.get('/profile/cars-preferences').catch(() => ({ data: {} })),
        ]);
        if (!cancelled) {
          setCar(carRes.data);
          writeViewCarCache(id, carRes.data);
          setProfileCarIds(prefsRes.data?.profile_car_ids || []);
        }
      } catch (e) {
        if (!cancelled && !cached) {
          toast.error(e.response?.status === 404 ? 'Car not found' : 'Failed to load car');
        }
      } finally {
        if (!cancelled) setHasLoaded(true);
      }
    };
    fetchCar();
    return () => { cancelled = true; };
  }, [id]);

  const garageLink = (
    <Link to="/cars/garage" className={`${styles.btnPrimary} vc-btn`}>
      <ArrowLeft size={14} /> Back to Garage
    </Link>
  );

  if (!id) {
    return (
      <div className={`${styles.pageContent} vc-page mobile-page-root`}>
        <style>{VIEW_CAR_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 vc-enter">
          <Car className="text-primary/40" size={40} />
          <p className="vc-empty text-center px-4">No car id in URL. Open a car from your garage.</p>
          {garageLink}
        </div>
      </div>
    );
  }

  if (!hasLoaded) {
    return (
      <div className={`${styles.pageContent} vc-page mobile-page-root`}>
        <style>{VIEW_CAR_STYLES}</style>
        <section className={`${styles.panel} vc-section mobile-panel`}>
          <div className="vc-hero-row">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <div className={`${styles.surface} vc-back`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="vc-skel h-2 w-24 mb-2" />
                <div className="vc-skel h-6 w-48 max-w-full" />
              </div>
            </div>
            <div className="vc-appraised">
              <div className="vc-skel h-2 w-16 mb-2 ml-auto" />
              <div className="vc-skel h-6 w-24 ml-auto" />
            </div>
          </div>
        </section>
        <section className={`${styles.panel} vc-section mobile-panel`}>
          <div className="vc-section-head">
            <span className="vc-section-title">
              <Car size={13} />
              Vehicle dossier
            </span>
          </div>
          <div className="vc-body">
            <div className="vc-layout">
              <div className="vc-photo-col">
                <div className="vc-photo" />
              </div>
              <div className="vc-stats">
                <div className="vc-stat-grid">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="vc-stat">
                      <div className="vc-skel h-2 w-14 mb-2" />
                      <div className="vc-skel h-5 w-20" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!car) {
    return (
      <div className={`${styles.pageContent} vc-page mobile-page-root`}>
        <style>{VIEW_CAR_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 vc-enter">
          <Car className="text-primary/40" size={40} />
          <p className="vc-empty">Car not found</p>
          {garageLink}
        </div>
      </div>
    );
  }

  const rarityKey = car.rarity || '';
  const rarityLabel = rarityKey.replace(/_/g, ' ');
  const rarityColor = RARITY_COLORS[rarityKey] || 'text-mutedForeground';
  const isOwner = car.owner === 'you';
  const fromProfile = car.owner === 'profile';
  const backTo = isOwner ? '/cars/garage' : (fromProfile ? undefined : '/cars/buy');

  const isOnProfile = profileCarIds.includes(id);
  const profileFull = profileCarIds.length >= 5 && !isOnProfile;
  const isCustomOwned = isOwner && (car.id === 'car_custom' || car.id === 'car22');

  const saveCustomCarPicture = async () => {
    if (!car?.user_car_id) return;
    setSavingCustomPic(true);
    try {
      await api.patch(`/gta/custom-car/${car.user_car_id}`, {
        image_url: customPicUrl.trim() || null,
      });
      toast.success('Picture updated');
      const carRes = await api.get('/gta/view-car', { params: { id } });
      setCar(carRes.data);
      writeViewCarCache(id, carRes.data);
      setCustomPicOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update picture');
    } finally {
      setSavingCustomPic(false);
    }
  };

  const toggleProfileCar = async () => {
    if (!id || !isOwner) return;
    setProfileSaving(true);
    try {
      let newIds;
      if (isOnProfile) {
        newIds = profileCarIds.filter((cid) => cid !== id);
      } else {
        if (profileCarIds.length >= 5) {
          toast.error('You already have 5 cars on your profile. Remove one first.');
          return;
        }
        newIds = [...profileCarIds, id];
      }
      await api.patch('/profile/cars-preferences', { profile_car_ids: newIds });
      setProfileCarIds(newIds);
      toast.success(isOnProfile ? 'Removed from profile' : 'Car added to your profile');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const damageStr =
    car.damage_percent != null
      ? `${Number(car.damage_percent) === Math.floor(car.damage_percent) ? Math.floor(car.damage_percent) : car.damage_percent}%`
      : '—';

  return (
    <div className={`${styles.pageContent} vc-page mobile-page-root`}>
      <style>{VIEW_CAR_STYLES}</style>

      <section className={`${styles.panel} vc-section vc-enter mobile-panel`}>
        <div className="vc-hero-row">
          <div className="flex items-start gap-2.5 min-w-0">
            <Link
              to={backTo || '/cars/garage'}
              className={`${styles.surface} vc-back`}
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0">
              <div className="vc-kicker">Garage — dossier</div>
              <h1 className="vc-name mt-0.5">{car.name}</h1>
              <p className={`mt-1 text-[11px] font-heading font-bold uppercase tracking-wider ${rarityColor}`}>
                {rarityLabel}
              </p>
            </div>
          </div>
          <div className="vc-appraised">
            <div className="vc-appraised-label">Appraised</div>
            <div className="vc-appraised-val">${(car.value || 0).toLocaleString()}</div>
          </div>
        </div>
      </section>

      {(car.owner === 'listing' || car.owner === 'profile') && car.seller_username && (
        <p className="vc-enter text-center text-[11px] font-heading" style={{ color: 'var(--noir-muted)' }}>
          <span className="inline-flex items-center gap-1.5">
            <User size={12} className="text-primary shrink-0" aria-hidden />
            {car.owner === 'profile' ? 'Listed from profile' : 'Seller'}
            <span className="font-bold" style={{ color: 'var(--noir-primary)' }}>{car.seller_username}</span>
          </span>
        </p>
      )}

      <section className={`${styles.panel} vc-section vc-enter mobile-panel`}>
        <div className="vc-section-head">
          <span className="vc-section-title">
            <Car size={13} />
            Vehicle dossier
          </span>
        </div>
        <div className="vc-body">
          <div className="vc-layout">
            <div className="vc-photo-col">
              <div className="vc-photo">
                {car.image ? (
                  <button
                    type="button"
                    className="vc-photo-zoom"
                    onClick={() => setPhotoOpen(true)}
                    aria-label={`Enlarge ${car.name}`}
                  >
                    <img src={car.image} alt={car.name} decoding="async" fetchPriority="high" />
                    <span className="vc-photo-hint" aria-hidden>
                      <ZoomIn size={14} />
                    </span>
                  </button>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Car className="text-primary/25" size={56} />
                  </div>
                )}
                {isCustomOwned && (
                  <button
                    type="button"
                    className="vc-photo-change"
                    onClick={() => {
                      setCustomPicUrl(car.image || '');
                      setCustomPicOpen(true);
                    }}
                  >
                    <ImageIcon size={12} className="shrink-0" />
                    Change picture
                  </button>
                )}
              </div>
            </div>

            <div className="vc-stats">
              <div className="vc-stat-grid">
                <div className="vc-stat">
                  <div className="vc-stat-label"><DollarSign size={13} /> Value</div>
                  <div className="vc-stat-val accent">${(car.value || 0).toLocaleString()}</div>
                </div>
                <div className="vc-stat">
                  <div className="vc-stat-label"><Clock size={13} /> Travel</div>
                  <div className="vc-stat-val">{car.travel_time != null ? `${car.travel_time}s` : '—'}</div>
                </div>
                <div className="vc-stat">
                  <div className="vc-stat-label"><Wrench size={13} /> Damage</div>
                  <div className="vc-stat-val">{damageStr}</div>
                </div>
                <div className="vc-stat">
                  <div className="vc-stat-label"><Sparkles size={13} /> Rarity</div>
                  <div className={`vc-stat-val capitalize ${rarityColor}`}>{rarityLabel}</div>
                </div>
              </div>

              {car.listed_for_sale && car.sale_price != null && (
                <div className="vc-stat" style={{ borderColor: 'rgba(245, 158, 11, 0.4)' }}>
                  <div className="vc-stat-label"><DollarSign size={13} /> On the market</div>
                  <div className="vc-stat-val" style={{ color: '#fbbf24' }}>${(car.sale_price || 0).toLocaleString()}</div>
                </div>
              )}

              {isOwner && (
                <div className="vc-stat">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserCircle size={16} className="text-primary shrink-0" aria-hidden />
                      <div>
                        <div className="vc-kicker">Profile</div>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--noir-muted)' }}>
                          Show this ride on your public profile
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-heading font-bold tabular-nums shrink-0" style={{ color: 'var(--noir-muted)' }}>
                      {profileCarIds.length}/5
                    </span>
                  </div>
                  {isOnProfile ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-heading" style={{ color: 'var(--noir-foreground)' }}>Shown on profile</span>
                      <button
                        type="button"
                        disabled={profileSaving}
                        onClick={toggleProfileCar}
                        className={`${styles.surface} vc-btn`}
                      >
                        {profileSaving ? '…' : 'Remove'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={profileSaving || profileFull}
                      onClick={toggleProfileCar}
                      className={`${styles.btnPrimary} vc-btn`}
                    >
                      {profileSaving ? '…' : profileFull ? 'Profile full (5/5)' : 'Show on profile'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {photoOpen && car.image && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/85"
          role="dialog"
          aria-modal="true"
          aria-label={`${car.name} photo`}
          onClick={() => setPhotoOpen(false)}
        >
          <div
            className={`relative w-full max-w-4xl ${styles.panel} rounded-xl border border-primary/30 shadow-2xl overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
              <p className="text-sm font-heading font-bold text-foreground truncate min-w-0">{car.name}</p>
              <button
                type="button"
                onClick={() => setPhotoOpen(false)}
                className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-secondary text-mutedForeground hover:text-foreground hover:border-primary/40 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3 bg-black/40">
              <img
                src={car.image}
                alt={car.name}
                className="w-full h-auto max-h-[min(80vh,720px)] object-contain mx-auto"
              />
            </div>
          </div>
        </div>
      )}

      {customPicOpen && (
        <CustomCarImageModal
          car={car}
          imageUrl={customPicUrl}
          setImageUrl={setCustomPicUrl}
          onSave={saveCustomCarPicture}
          onClose={() => setCustomPicOpen(false)}
          saving={savingCustomPic}
        />
      )}

      <div className="flex justify-center pb-1 vc-enter">
        {backTo !== undefined ? (
          <Link to={backTo} className={`${styles.btnPrimary} vc-btn`}>
            <ArrowLeft size={14} />
            {isOwner ? 'Back to Garage' : 'Back to Buy Cars'}
          </Link>
        ) : (
          <button type="button" onClick={() => window.history.back()} className={`${styles.btnPrimary} vc-btn`}>
            <ArrowLeft size={14} />
            Back
          </button>
        )}
      </div>
    </div>
  );
}
