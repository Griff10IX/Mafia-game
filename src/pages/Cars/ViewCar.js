import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Car, ArrowLeft, Clock, DollarSign, Sparkles, User, Wrench, UserCircle, Image as ImageIcon } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import CustomCarImageModal from '../../components/CustomCarImageModal';

const VIEW_CAR_STYLES = `
  @keyframes vc-enter { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .vc-enter { animation: vc-enter 0.42s ease-out both; }
  .vc-enter-delay { animation: vc-enter 0.45s ease-out 0.06s both; }
  @keyframes vc-shimmer { 0% { opacity: 0.35; } 50% { opacity: 0.65; } 100% { opacity: 0.35; } }
  .vc-shimmer { animation: vc-shimmer 1.4s ease-in-out infinite; }
  .vc-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.14; }
`;

const RARITY_COLORS = {
  common: 'text-zinc-400',
  uncommon: 'text-emerald-400',
  rare: 'text-sky-400',
  ultra_rare: 'text-violet-400',
  legendary: 'text-amber-400',
  custom: 'text-primary',
  exclusive: 'text-rose-400',
};

const RARITY_BORDER = {
  common: 'border-zinc-600/50',
  uncommon: 'border-emerald-500/35',
  rare: 'border-sky-500/35',
  ultra_rare: 'border-violet-500/35',
  legendary: 'border-amber-500/40',
  custom: 'border-primary/45',
  exclusive: 'border-rose-500/45',
};

function StatCell({ icon: Icon, label, children, className = '', compact = false }) {
  return (
    <div className={`flex flex-col justify-center ${compact ? 'min-h-0' : 'min-h-[4.5rem]'} ${className}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary shrink-0">
          <Icon size={14} strokeWidth={2.25} aria-hidden />
        </span>
        <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.14em] text-mutedForeground font-heading font-bold">{label}</span>
      </div>
      <div className={compact ? '' : 'pl-0 sm:pl-9'}>{children}</div>
    </div>
  );
}

export default function ViewCar() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const [car, setCar] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileCarIds, setProfileCarIds] = useState([]);
  const [customPicOpen, setCustomPicOpen] = useState(false);
  const [customPicUrl, setCustomPicUrl] = useState('');
  const [savingCustomPic, setSavingCustomPic] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      if (!cancelled) setHasLoaded(true);
      return;
    }
    const fetchCar = async () => {
      try {
        const [carRes, prefsRes] = await Promise.all([
          api.get('/gta/view-car', { params: { id } }),
          api.get('/profile/cars-preferences'),
        ]);
        if (!cancelled) {
          setCar(carRes.data);
          setProfileCarIds(prefsRes.data?.profile_car_ids || []);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(e.response?.status === 404 ? 'Car not found' : 'Failed to load car');
        }
      } finally {
        if (!cancelled) setHasLoaded(true);
      }
    };
    fetchCar();
    return () => { cancelled = true; };
  }, [id]);

  if (!id) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
        <style>{VIEW_CAR_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 vc-enter">
          <Car className="text-primary/40" size={48} />
          <p className="text-mutedForeground font-heading text-center px-4">No car id in URL. Use /view-car?id=… from your garage.</p>
          <Link
            to="/cars/garage"
            className="rounded-lg border-2 border-primary/40 bg-black/35 px-4 py-2 text-primary font-heading text-xs font-bold uppercase tracking-wider hover:bg-primary/15 transition-colors inline-flex items-center gap-2"
          >
            <ArrowLeft size={14} /> Back to Garage
          </Link>
        </div>
      </div>
    );
  }

  if (!hasLoaded) {
    return (
      <div className={`${styles.pageContent} mobile-page-root space-y-4`}>
        <style>{VIEW_CAR_STYLES}</style>
        <div className="h-28 rounded-lg border border-primary/20 bg-zinc-950/60 vc-shimmer" />
        <div className="h-72 rounded-lg border border-primary/20 bg-zinc-950/50 vc-shimmer" style={{ animationDelay: '0.15s' }} />
      </div>
    );
  }

  if (!car) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
        <style>{VIEW_CAR_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 vc-enter">
          <Car className="text-primary/40" size={48} />
          <p className="text-mutedForeground font-heading">Car not found</p>
          <Link
            to="/cars/garage"
            className="rounded-lg border-2 border-primary/40 bg-black/35 px-4 py-2 text-primary font-heading text-xs font-bold uppercase tracking-wider hover:bg-primary/15 transition-colors inline-flex items-center gap-2"
          >
            <ArrowLeft size={14} /> Back to Garage
          </Link>
        </div>
      </div>
    );
  }

  const rarityKey = car.rarity || '';
  const rarityLabel = rarityKey.replace(/_/g, ' ');
  const rarityColor = RARITY_COLORS[rarityKey] || 'text-mutedForeground';
  const rarityBorder = RARITY_BORDER[rarityKey] || 'border-zinc-600/50';
  const isOwner = car.owner === 'you';
  const fromProfile = car.owner === 'profile';
  const backTo = isOwner ? '/cars/garage' : (fromProfile ? undefined : '/cars/buy');

  const isOnProfile = profileCarIds.includes(id);
  const profileFull = profileCarIds.length >= 5 && !isOnProfile;
  const isCustomOwned = isOwner && car.id === 'car_custom';

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
    <div className={`space-y-5 ${styles.pageContent} mobile-page-root max-w-4xl mx-auto`}>
      <style>{VIEW_CAR_STYLES}</style>

      {/* Hero */}
      <div className={`vc-enter relative rounded-xl overflow-hidden border-2 border-primary/35 shadow-2xl backdrop-blur-sm ${styles.panel}`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/55 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-black/40 pointer-events-none" aria-hidden />
        <div className="relative px-3 py-4 sm:px-5 sm:py-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <Link
              to={backTo || '/cars/garage'}
              className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg border-2 border-primary/35 bg-black/40 text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft size={20} />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-[9px] sm:text-[10px] font-heading font-bold text-primary uppercase tracking-[0.18em]">
                  Garage — dossier
                </span>
                {rarityKey === 'exclusive' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-rose-500/50 bg-rose-950/50 text-[8px] font-heading font-bold uppercase tracking-widest text-rose-300">
                    Exclusive
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-heading font-bold text-foreground leading-tight tracking-tight drop-shadow-[0_2px_18px_rgba(0,0,0,0.65)]">
                {car.name}
              </h1>
              <p className={`mt-1.5 text-[11px] sm:text-xs font-heading font-bold uppercase tracking-wider ${rarityColor}`}>
                {rarityLabel}
              </p>
            </div>
          </div>
          <div className={`shrink-0 rounded-lg border-2 ${rarityBorder} bg-gradient-to-br from-black/55 to-zinc-950/90 px-4 py-3 text-right shadow-inner`}>
            <p className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-[0.14em] mb-0.5">Appraised</p>
            <p className="text-primary font-heading font-bold text-xl sm:text-2xl tabular-nums tracking-tight">
              ${(car.value || 0).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="vc-art-line text-primary mx-4 sm:mx-5" />
      </div>

      {(car.owner === 'listing' || car.owner === 'profile') && car.seller_username && (
        <p className="vc-enter text-center text-[11px] font-heading text-mutedForeground">
          <span className="inline-flex items-center gap-1.5">
            <User size={12} className="text-primary/70 shrink-0" aria-hidden />
            <span className="text-foreground/90">{car.owner === 'profile' ? 'Listed from profile' : 'Seller'}</span>
            <span className="text-primary font-bold">{car.seller_username}</span>
          </span>
        </p>
      )}

      {/* Main panel */}
      <div className={`vc-enter-delay relative rounded-xl overflow-hidden border-2 border-primary/35 shadow-2xl backdrop-blur-sm ${styles.panel}`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
        <div className="px-3 py-2 sm:px-4 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-b border-primary/25 flex items-center justify-between gap-2">
          <span className="text-[10px] sm:text-[11px] font-heading font-bold text-primary uppercase tracking-[0.14em]">
            Vehicle dossier
          </span>
          <Car size={14} className="text-primary/50 shrink-0" aria-hidden />
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row gap-5 lg:gap-6">
            <div className="w-full max-w-md lg:max-w-[min(100%,22rem)] shrink-0 mx-auto lg:mx-0">
              <div
                className="aspect-[4/3] rounded-xl overflow-hidden bg-gradient-to-b from-zinc-900 to-black border-2 border-zinc-700/60 relative ring-1 ring-black/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_16px_48px_rgba(0,0,0,0.55)]"
              >
                {car.image ? (
                  <img
                    src={car.image}
                    alt={car.name}
                    className="w-full h-full object-contain object-center"
                    decoding="async"
                    fetchPriority="high"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-950/80">
                    <Car className="text-primary/25" size={56} />
                  </div>
                )}
                {isCustomOwned && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomPicUrl(car.image || '');
                      setCustomPicOpen(true);
                    }}
                    className="absolute inset-x-0 bottom-0 py-2 px-2 flex items-center justify-center gap-2 bg-gradient-to-t from-black via-black/95 to-transparent text-primary text-[9px] font-heading font-bold uppercase tracking-wider border-t border-primary/35 hover:text-primary/90 transition-colors"
                  >
                    <ImageIcon size={12} className="shrink-0" />
                    Change picture
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-900/80 to-black/50 p-3 sm:p-3.5 ring-1 ring-black/40 shadow-inner">
                  <StatCell icon={DollarSign} label="Value" className="min-h-0" compact>
                    <span className="font-heading font-bold text-primary text-lg sm:text-xl tabular-nums">${(car.value || 0).toLocaleString()}</span>
                  </StatCell>
                </div>
                <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-900/80 to-black/50 p-3 sm:p-3.5 ring-1 ring-black/40 shadow-inner">
                  <StatCell icon={Clock} label="Travel" className="min-h-0" compact>
                    <span className="font-heading font-bold text-foreground text-lg sm:text-xl tabular-nums">
                      {car.travel_time != null ? `${car.travel_time}s` : '—'}
                    </span>
                  </StatCell>
                </div>
                <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-900/80 to-black/50 p-3 sm:p-3.5 ring-1 ring-black/40 shadow-inner">
                  <StatCell icon={Wrench} label="Damage" className="min-h-0" compact>
                    <span className="font-heading font-bold text-foreground text-lg sm:text-xl tabular-nums">{damageStr}</span>
                  </StatCell>
                </div>
                <div className="rounded-lg border border-zinc-700/50 bg-gradient-to-br from-zinc-900/80 to-black/50 p-3 sm:p-3.5 ring-1 ring-black/40 shadow-inner">
                  <StatCell icon={Sparkles} label="Rarity" className="min-h-0" compact>
                    <span className={`font-heading font-bold text-lg sm:text-xl capitalize ${rarityColor}`}>{rarityLabel}</span>
                  </StatCell>
                </div>
              </div>

              {car.listed_for_sale && car.sale_price != null && (
                <div className="rounded-xl border-2 border-amber-500/35 bg-gradient-to-br from-amber-950/35 to-black/40 p-4 shadow-inner">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign size={14} className="text-amber-400" />
                    <span className="text-[10px] uppercase tracking-[0.12em] text-amber-200/95 font-heading font-bold">On the market</span>
                  </div>
                  <p className="font-heading font-bold text-amber-400 text-xl tabular-nums">${(car.sale_price || 0).toLocaleString()}</p>
                </div>
              )}

              {isOwner && (
                <div className="rounded-xl border-2 border-primary/35 bg-gradient-to-r from-primary/12 via-primary/5 to-transparent p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-black/30 text-primary shrink-0">
                        <UserCircle size={16} aria-hidden />
                      </span>
                      <div>
                        <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Profile</p>
                        <p className="text-[9px] text-mutedForeground font-heading">Show this ride on your public dossier</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-mutedForeground font-heading font-bold tabular-nums shrink-0">{profileCarIds.length}/5</span>
                  </div>
                  {isOnProfile ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground font-heading text-sm">Shown on profile</span>
                      <button
                        type="button"
                        disabled={profileSaving}
                        onClick={toggleProfileCar}
                        className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-1.5 text-mutedForeground text-[10px] font-heading font-bold uppercase tracking-wide hover:bg-zinc-800 hover:text-foreground disabled:opacity-50 transition-colors"
                      >
                        {profileSaving ? '…' : 'Remove from profile'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={profileSaving || profileFull}
                      onClick={toggleProfileCar}
                      className="rounded-lg border-2 border-primary/50 bg-primary/20 px-4 py-2 text-primary text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-primary/30 disabled:opacity-50 transition-colors"
                    >
                      {profileSaving ? '…' : profileFull ? 'Profile full (5/5)' : 'Show on profile'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="vc-art-line text-primary mx-4 sm:mx-5 mb-4" />
      </div>

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

      <div className="flex justify-center pb-2 vc-enter-delay">
        {backTo !== undefined ? (
          <Link
            to={backTo}
            className="rounded-lg border-2 border-primary/40 bg-black/35 px-5 py-2.5 text-primary text-xs font-heading font-bold uppercase tracking-[0.12em] hover:bg-primary/15 hover:border-primary/55 transition-colors inline-flex items-center gap-2 shadow-lg"
          >
            <ArrowLeft size={16} />
            {isOwner ? 'Back to Garage' : 'Back to Buy Cars'}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-lg border-2 border-primary/40 bg-black/35 px-5 py-2.5 text-primary text-xs font-heading font-bold uppercase tracking-[0.12em] hover:bg-primary/15 transition-colors inline-flex items-center gap-2"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        )}
      </div>
    </div>
  );
}
