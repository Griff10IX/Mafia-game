import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Factory, Package, User, ShoppingCart, Flame, Gauge, Shield, Crosshair, Swords, DollarSign } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { formatMasteryTrainCooldownLabel, useMasteryCooldownTick } from '../../utils/shootingRangeCooldown';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const formatMoney = (n) => `$${Number(n ?? 0).toLocaleString()}`;

/** Worst → best for combat (same as bullets-to-kill tier): non-loot by damage, loot-exclusive last. */
function sortWeaponsByPower(list) {
  if (!Array.isArray(list)) return [];
  const tier = (w) => (w.loot_exclusive ? 2 : w.store_exclusive ? 1 : 0);
  return [...list].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    const da = Number(a.damage) || 0;
    const db = Number(b.damage) || 0;
    if (da !== db) return da - db;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}
const QUICK_BUYS = [100, 500, 1000, 2000, 3000];
const ITEM_WIDTH = 32;

/* ═══════════════════════════════════════════════════════
   Conveyor Belt Components (same as before)
   ═══════════════════════════════════════════════════════ */
function BulletCasing() {
  return (
    <div className="shrink-0 flex items-center justify-center" style={{ width: ITEM_WIDTH }}>
      <svg viewBox="0 0 12 22" className="w-3 h-5" style={{ filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.25))' }}>
        <path d="M2 6 L2 20 L10 20 L10 6 Q10 3 6 3 Q2 3 2 6 Z" fill="url(#belt-brass)" stroke="url(#belt-brass-edge)" strokeWidth="0.35" />
        <path d="M2 6 Q6 0 10 6 L10 7 Q6 3 2 7 Z" fill="url(#belt-lead)" stroke="rgba(0,0,0,0.15)" strokeWidth="0.25" />
      </svg>
    </div>
  );
}

function BeltWeapon() {
  return (
    <div className="shrink-0 flex items-center justify-center" style={{ width: ITEM_WIDTH }}>
      <svg viewBox="0 0 24 14" className="w-6 h-4" style={{ filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.4))' }}>
        <ellipse cx="4" cy="7" rx="2.5" ry="3" fill="url(#belt-gun-metal)" />
        <rect x="2" y="5.5" width="14" height="3" rx="0.8" fill="url(#belt-gun-metal)" />
        <rect x="14" y="6" width="6" height="2" rx="0.5" fill="url(#belt-gun-dark)" />
        <path d="M16 6.5 L16 12 L20 12 L20 8.5 Q18 6.5 16 6.5 Z" fill="url(#belt-gun-grip)" stroke="#2a2a2a" strokeWidth="0.4" />
        <circle cx="18" cy="7" r="0.6" fill="#1a1a1a" />
      </svg>
    </div>
  );
}

function BeltArmour() {
  return (
    <div className="shrink-0 flex items-center justify-center" style={{ width: ITEM_WIDTH }}>
      <svg viewBox="0 0 20 18" className="w-5 h-4" style={{ filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.3))' }}>
        <path d="M4 2 L8 2 L8 5 L12 5 L12 2 L16 2 L16 6 L18 8 L18 14 Q18 17 10 17 Q2 17 2 14 L2 8 L4 6 Z" fill="url(#belt-vest-fabric)" stroke="url(#belt-armour-edge)" strokeWidth="0.5" />
        <path d="M8 5 L10 8 L12 5" fill="none" stroke="#1a1a1a" strokeWidth="0.5" />
        <line x1="10" y1="8" x2="10" y2="14" stroke="rgba(0,0,0,0.35)" strokeWidth="0.4" />
        <path d="M5 7 L8 10 L8 14 M15 7 L12 10 L12 14" stroke="rgba(0,0,0,0.2)" strokeWidth="0.35" fill="none" />
      </svg>
    </div>
  );
}

const BELT_BLOCK = [...Array(6).fill('bullet'), 'weapon', ...Array(6).fill('bullet'), 'armour'];
const BELT_ITEM_COUNT = 40;

function ConveyorBelt() {
  const setWidth = BELT_ITEM_COUNT * ITEM_WIDTH;
  const items = Array.from({ length: BELT_ITEM_COUNT * 2 }, (_, i) => BELT_BLOCK[i % BELT_BLOCK.length]);
  return (
    <div
      className="relative w-full h-7 sm:h-8 overflow-hidden rounded-md border border-primary/10"
      style={{ background: 'linear-gradient(180deg, rgba(20,16,12,0.9) 0%, rgba(36,28,20,0.95) 50%, rgba(20,16,12,0.9) 100%)' }}
      aria-hidden
    >
      <svg width={0} height={0} className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id="belt-brass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d4a84c" />
            <stop offset="50%" stopColor="#b8860b" />
            <stop offset="100%" stopColor="#8b6914" />
          </linearGradient>
          <linearGradient id="belt-brass-edge" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#c9a227" />
            <stop offset="100%" stopColor="#6b5009" />
          </linearGradient>
          <linearGradient id="belt-lead" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7a7a7a" />
            <stop offset="100%" stopColor="#4a4a4a" />
          </linearGradient>
          <linearGradient id="belt-gun-metal" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6b6b6b" />
            <stop offset="50%" stopColor="#4a4a4a" />
            <stop offset="100%" stopColor="#2e2e2e" />
          </linearGradient>
          <linearGradient id="belt-gun-dark" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3a3a3a" />
            <stop offset="100%" stopColor="#1e1e1e" />
          </linearGradient>
          <linearGradient id="belt-gun-grip" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5c4033" />
            <stop offset="100%" stopColor="#3e2723" />
          </linearGradient>
          <linearGradient id="belt-vest-fabric" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4a4a4a" />
            <stop offset="40%" stopColor="#353535" />
            <stop offset="100%" stopColor="#2a2a2a" />
          </linearGradient>
          <linearGradient id="belt-armour-edge" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8a8a8a" />
            <stop offset="100%" stopColor="#2a2a2a" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 animate-belt-treads opacity-40" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 28px, rgba(0,0,0,0.35) 28px, rgba(0,0,0,0.35) 30px)', backgroundSize: '30px 100%' }} />
      <div className="absolute top-0 left-0 h-full flex items-center animate-belt-bullets opacity-80" style={{ width: setWidth * 2 }}>
        {items.map((type, i) => (
          <div key={i} className="shrink-0 flex items-center justify-center scale-90" style={{ width: ITEM_WIDTH }}>
            {type === 'weapon' ? <BeltWeapon /> : type === 'armour' ? <BeltArmour /> : <BulletCasing />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Production Gauge - Enhanced for Bullets, Armour, Weapons
   ═══════════════════════════════════════════════════════ */
function ProductionGauge({ production, maxProduction = 10000 }) {
  const pct = Math.min(production / maxProduction, 1);
  const startDeg = -120;
  const sweepDeg = 240;
  const needleDeg = startDeg + pct * sweepDeg;
  const toXY = (deg, r) => ({
    x: 50 + r * Math.sin(deg * Math.PI / 180),
    y: 50 - r * Math.cos(deg * Math.PI / 180),
  });
  const arcStart = toXY(startDeg, 42);
  const arcEnd = toXY(sweepDeg + startDeg, 42);
  const arcPath = `M ${arcStart.x.toFixed(1)} ${arcStart.y.toFixed(1)} A 42 42 0 1 1 ${arcEnd.x.toFixed(1)} ${arcEnd.y.toFixed(1)}`;
  const arcLen = 42 * sweepDeg * Math.PI / 180;
  const needle = toXY(needleDeg, 30);
  return (
    <div className="relative w-20 h-20 sm:w-24 sm:h-24 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <path d={arcPath} fill="none" stroke="#333" strokeWidth="6" strokeLinecap="round" />
        <path d={arcPath} fill="none" stroke="url(#gauge-grad)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${pct * arcLen} ${arcLen}`} />
        {[...Array(9)].map((_, i) => {
          const deg = startDeg + (i / 8) * sweepDeg;
          const t1 = toXY(deg, 37);
          const t2 = toXY(deg, 43);
          return <line key={i} x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} stroke="#666" strokeWidth="1" />;
        })}
        <line x1="50" y1="50" x2={needle.x} y2={needle.y} stroke="var(--noir-primary)" strokeWidth="2" strokeLinecap="round" style={{ transition: 'all 1s ease-out' }} />
        <circle cx="50" cy="50" r="4" fill="var(--noir-primary)" />
        <circle cx="50" cy="50" r="2" fill="#1a1a1a" />
        <defs>
          <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--noir-primary)" />
            <stop offset="60%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1.5 sm:pb-2">
        <div className="text-[8px] sm:text-[10px] text-zinc-500 font-heading uppercase">Per Hour</div>
        <div className="text-xs sm:text-sm font-heading font-bold text-primary">{production.toLocaleString()}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Animated Counter
   ═══════════════════════════════════════════════════════ */
function AnimatedCounter({ target, duration = 1200 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => { if (ref.current) cancelAnimationFrame(ref.current); };
  }, [target, duration]);
  return <span>{display.toLocaleString()}</span>;
}

/* ═══════════════════════════════════════════════════════
   Tab / chrome
   ═══════════════════════════════════════════════════════ */
const Tab = ({ active, onClick, icon: Icon, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2.5 sm:py-2 text-[10px] sm:text-[11px] font-heading font-bold uppercase tracking-wide transition-colors rounded-md ${
      active
        ? 'text-primary bg-primary/15 border border-primary/35 shadow-[inset_0_0_0_1px_rgba(var(--noir-primary-rgb),0.12)]'
        : 'text-mutedForeground border border-transparent hover:text-foreground hover:bg-black/25'
    }`}
  >
    <Icon size={13} className="shrink-0 opacity-90" aria-hidden />
    <span className="truncate">{children}</span>
  </button>
);

const StatCard = ({ icon: Icon, label, value, highlight, pulseActive }) => (
  <div className={`relative rounded-lg px-2.5 py-2 ${styles.surface} border border-primary/12`}>
    {pulseActive ? (
      <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
    ) : null}
    <div className="flex items-center gap-1.5 mb-1">
      <Icon size={11} className="text-primary/70 shrink-0" aria-hidden />
      <span className="text-[9px] text-mutedForeground font-heading uppercase tracking-wide">{label}</span>
    </div>
    <div className={`text-[12px] sm:text-sm font-heading font-bold leading-tight ${highlight ? 'text-primary' : 'text-foreground'}`}>
      {value}
    </div>
  </div>
);

function ArmSection({ icon: Icon, title, subtitle, children, className = '' }) {
  return (
    <section className={`rounded-lg overflow-hidden border border-primary/15 bg-black/20 ${className}`}>
      <div className="px-3 py-2 border-b border-primary/10 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent flex items-center gap-2">
        {Icon ? <Icon size={14} className="text-primary shrink-0" aria-hidden /> : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-[11px] font-heading font-bold text-foreground uppercase tracking-wide truncate">{title}</h3>
          {subtitle ? <p className="text-[9px] text-mutedForeground font-heading truncate mt-0.5">{subtitle}</p> : null}
        </div>
      </div>
      <div className="p-2.5 sm:p-3">{children}</div>
    </section>
  );
}

function ShopItemRow({ name, meta, badge, actions, dimmed, glow }) {
  return (
    <div
      className={`flex items-start sm:items-center gap-2 py-2.5 px-1.5 border-b border-white/[0.06] last:border-0 ${
        dimmed ? 'opacity-55' : ''
      } ${glow ? 'rounded-md bg-amber-500/[0.04]' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className={`text-[12px] sm:text-[13px] font-heading font-semibold leading-snug ${glow ? 'text-amber-200' : 'text-foreground'}`}>
          {name}
        </div>
        {meta ? <div className="text-[10px] text-mutedForeground font-heading mt-0.5 leading-snug">{meta}</div> : null}
        {badge}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 max-w-[48%] sm:max-w-none">{actions}</div>
    </div>
  );
}

function ArmActionBtn({ children, onClick, disabled, variant = 'primary', className = '', title }) {
  const variants = {
    primary: 'border-primary/40 bg-primary/12 text-primary hover:bg-primary/20',
    muted: 'border-white/10 bg-black/30 text-foreground hover:border-primary/35',
    danger: 'border-red-500/35 bg-red-500/10 text-red-300 hover:bg-red-500/15',
    ghost: 'border-white/10 bg-transparent text-mutedForeground',
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md text-[10px] sm:text-[11px] font-heading font-bold border transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${variants[variant] || variants.primary} ${className}`}
    >
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   Main BulletFactory Component
   ═══════════════════════════════════════════════════════ */
export default function BulletFactory({ me: meProp, ownedArmouryState }) {
  const [data, setData] = useState(null);
  const [me, setMe] = useState(meProp ?? null);
  const [activeTab, setActiveTab] = useState('shop');
  const [claiming, setClaiming] = useState(false);
  const [settingPrice, setSettingPrice] = useState(false);
  const [settingItemPrices, setSettingItemPrices] = useState(false);
  const [armourPriceInputs, setArmourPriceInputs] = useState({});
  const [weaponPriceInputs, setWeaponPriceInputs] = useState({});
  const [buying, setBuying] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  const [producingArmour, setProducingArmour] = useState(false);
  const [producingWeapon, setProducingWeapon] = useState(false);
  const [producingArmourLevel, setProducingArmourLevel] = useState(null);
  const [producingWeaponOneId, setProducingWeaponOneId] = useState(null);
  const [armourOptions, setArmourOptions] = useState([]);
  const [weaponsList, setWeaponsList] = useState([]);
  const [buyingArmourLevel, setBuyingArmourLevel] = useState(null);
  const [buyingWeaponId, setBuyingWeaponId] = useState(null);
  const [equippingWeaponId, setEquippingWeaponId] = useState(null);
  const [equippingArmourLevel, setEquippingArmourLevel] = useState(null);
  const [masteryData, setMasteryData] = useState(null);
  const [trainingWeaponId, setTrainingWeaponId] = useState(null);
  useMasteryCooldownTick(masteryData);

  useEffect(() => {
    if (meProp?.money != null) {
      setMe(meProp);
      return;
    }
    let cancelled = false;
    api.get('/auth/me').then((res) => {
      if (!cancelled && res.data) setMe(res.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [meProp]);

  const currentState = me?.current_state;
  const effectiveState = ownedArmouryState || currentState;

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/bullet-factory', { params: effectiveState ? { state: effectiveState } : {} });
      setData(res.data);
    } catch {
      toast.error('Failed to load armoury');
      setData(null);
    }
  }, [effectiveState]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!data?.is_owner || !data?.armour_money_price_defaults) return;
    const a = {};
    data.armour_money_price_defaults.forEach((d) => {
      const cur = data.armour_sell_price_money?.[String(d.level)];
      a[d.level] = cur != null ? String(cur) : String(d.default_list_money);
    });
    setArmourPriceInputs(a);
    const w = {};
    (data.weapon_money_price_defaults || []).forEach((d) => {
      const cur = data.weapon_sell_price_money?.[d.id];
      w[d.id] = cur != null ? String(cur) : String(d.default_list_money);
    });
    setWeaponPriceInputs(w);
  }, [data, data?.is_owner, data?.armour_sell_price_money, data?.weapon_sell_price_money, data?.armour_money_price_defaults, data?.weapon_money_price_defaults]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      try {
        const [armourRes, weaponsRes] = await Promise.all([
          api.get('/armour/options', { params: effectiveState ? { state: effectiveState } : {} }),
          api.get('/weapons', { params: effectiveState ? { state: effectiveState } : {} }),
        ]);
        if (!cancelled && armourRes.data?.options) setArmourOptions(armourRes.data.options);
        if (!cancelled && Array.isArray(weaponsRes.data)) setWeaponsList(sortWeaponsByPower(weaponsRes.data));
      } catch {
        if (!cancelled) setArmourOptions([]);
        if (!cancelled) setWeaponsList([]);
      }
    })();
    return () => { cancelled = true; };
  }, [data, effectiveState]);

  const fetchMastery = useCallback(async () => {
    try {
      const res = await api.get('/shooting-range/mastery');
      setMasteryData(res.data);
    } catch {
      setMasteryData(null);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'shooting-range') fetchMastery();
  }, [activeTab, fetchMastery]);

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

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const res = await api.post('/bullet-factory/claim', { state: data?.state || currentState });
      toast.success(res.data?.message || 'You now own the Armoury!');
      refreshUser();
      const meRes = await api.get('/auth/me').catch(() => ({}));
      if (meRes.data) setMe(meRes.data);
      fetchData();
    } catch (e) {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : (Array.isArray(detail) ? (detail[0]?.msg || detail[0]?.message) : null);
      toast.error(msg || 'Failed to claim armoury');
    } finally {
      setClaiming(false);
    }
  };

  const buyArmour = async (level) => {
    setBuyingArmourLevel(level);
    try {
      const res = await api.post('/armour/buy', { level, state: data?.state || effectiveState });
      toast.success(res.data?.message || 'Purchased armour');
      refreshUser();
      fetchData();
      if (armourOptions.length) {
        const optsRes = await api.get('/armour/options', { params: effectiveState ? { state: effectiveState } : {} });
        if (optsRes.data?.options) setArmourOptions(optsRes.data.options);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to purchase armour');
    } finally {
      setBuyingArmourLevel(null);
    }
  };

  const buyWeapon = async (weaponId, currency) => {
    setBuyingWeaponId(weaponId);
    try {
      await api.post(`/weapons/${weaponId}/buy`, { currency, state: data?.state || effectiveState });
      toast.success('Weapon purchased');
      refreshUser();
      fetchData();
      const weaponsRes = await api.get('/weapons', { params: effectiveState ? { state: effectiveState } : {} });
      if (Array.isArray(weaponsRes.data)) setWeaponsList(sortWeaponsByPower(weaponsRes.data));
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(Array.isArray(detail) ? detail[0]?.msg || 'Failed to buy weapon' : detail || 'Failed to buy weapon');
    } finally {
      setBuyingWeaponId(null);
    }
  };

  const equipWeapon = async (weaponId) => {
    setEquippingWeaponId(weaponId);
    try {
      await api.post('/weapons/equip', { weapon_id: weaponId });
      toast.success('Weapon equipped');
      refreshUser();
      const weaponsRes = await api.get('/weapons', { params: effectiveState ? { state: effectiveState } : {} });
      if (Array.isArray(weaponsRes.data)) setWeaponsList(sortWeaponsByPower(weaponsRes.data));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to equip weapon');
    } finally {
      setEquippingWeaponId(null);
    }
  };

  const unequipWeapon = async () => {
    setEquippingWeaponId('');
    try {
      await api.post('/weapons/unequip');
      toast.success('Weapon unequipped');
      refreshUser();
      const weaponsRes = await api.get('/weapons', { params: effectiveState ? { state: effectiveState } : {} });
      if (Array.isArray(weaponsRes.data)) setWeaponsList(sortWeaponsByPower(weaponsRes.data));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unequip weapon');
    } finally {
      setEquippingWeaponId(null);
    }
  };

  const equipArmour = async (level) => {
    setEquippingArmourLevel(level);
    try {
      await api.post('/armour/equip', { level, state: data?.state || effectiveState });
      toast.success('Armour equipped');
      refreshUser();
      const optsRes = await api.get('/armour/options', { params: effectiveState ? { state: effectiveState } : {} });
      if (optsRes.data?.options) setArmourOptions(optsRes.data.options);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to equip armour');
    } finally {
      setEquippingArmourLevel(null);
    }
  };

  const unequipArmour = async () => {
    setEquippingArmourLevel(0);
    try {
      await api.post('/armour/unequip');
      toast.success('Armour unequipped');
      refreshUser();
      const optsRes = await api.get('/armour/options', { params: effectiveState ? { state: effectiveState } : {} });
      if (optsRes.data?.options) setArmourOptions(optsRes.data.options);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unequip armour');
    } finally {
      setEquippingArmourLevel(null);
    }
  };

  const saveItemPrices = async (e) => {
    e.preventDefault();
    if (!data?.armour_money_price_defaults?.length && !data?.weapon_money_price_defaults?.length) return;
    setSettingItemPrices(true);
    try {
      const armour_sell_price_money = {};
      (data.armour_money_price_defaults || []).forEach((d) => {
        const raw = String(armourPriceInputs[d.level] ?? '').trim();
        if (raw === '') {
          armour_sell_price_money[String(d.level)] = null;
        } else {
          const n = parseInt(raw, 10);
          if (Number.isFinite(n)) armour_sell_price_money[String(d.level)] = n;
        }
      });
      const weapon_sell_price_money = {};
      (data.weapon_money_price_defaults || []).forEach((d) => {
        const raw = String(weaponPriceInputs[d.id] ?? '').trim();
        if (raw === '') {
          weapon_sell_price_money[d.id] = null;
        } else {
          const n = parseInt(raw, 10);
          if (Number.isFinite(n)) weapon_sell_price_money[d.id] = n;
        }
      });
      await api.post('/bullet-factory/set-item-prices', {
        state: data?.state || effectiveState,
        armour_sell_price_money,
        weapon_sell_price_money,
      });
      toast.success('Cash item prices saved (points armour & points guns unchanged)');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save item prices');
    } finally {
      setSettingItemPrices(false);
    }
  };

  const setPrice = async (e) => {
    e.preventDefault();
    const p = parseInt(priceInput, 10);
    if (!Number.isInteger(p) || p < (data?.price_min ?? 1) || p > (data?.price_max ?? 100000)) {
      toast.error(`Enter a price between ${data?.price_min ?? 1} and ${(data?.price_max ?? 100000).toLocaleString()}`);
      return;
    }
    setSettingPrice(true);
    try {
      await api.post('/bullet-factory/set-price', { price_per_bullet: p, state: data?.state || currentState });
      toast.success('Price updated');
      setPriceInput('');
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set price');
    } finally {
      setSettingPrice(false);
    }
  };

  const buyBullets = async (e) => {
    e.preventDefault();
    const amount = parseInt(buyAmount, 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setBuying(true);
    try {
      const res = await api.post('/bullet-factory/buy', { amount, state: data?.state || currentState });
      toast.success(res.data?.message || 'Bullets purchased');
      refreshUser();
      setBuyAmount('');
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to buy bullets');
    } finally {
      setBuying(false);
    }
  };

  const startArmourProductionAll = async () => {
    setProducingArmour(true);
    try {
      const res = await api.post('/bullet-factory/start-armour-production-all', { state: data?.state || currentState });
      toast.success(res.data?.message || 'Armour production started');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start armour production');
    } finally {
      setProducingArmour(false);
    }
  };

  const startWeaponProductionAll = async () => {
    setProducingWeapon(true);
    try {
      const res = await api.post('/bullet-factory/start-weapon-production-all', { state: data?.state || currentState });
      toast.success(res.data?.message || 'Weapon production started');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start weapon production');
    } finally {
      setProducingWeapon(false);
    }
  };

  const startArmourProductionOne = async (level) => {
    setProducingArmourLevel(level);
    try {
      const res = await api.post('/bullet-factory/start-armour-production', {
        level,
        state: data?.state || effectiveState,
      });
      toast.success(res.data?.message || 'Armour production started');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start armour production');
    } finally {
      setProducingArmourLevel(null);
    }
  };

  const startWeaponProductionOne = async (weaponId) => {
    setProducingWeaponOneId(weaponId);
    try {
      const res = await api.post('/bullet-factory/start-weapon-production', {
        weapon_id: weaponId,
        state: data?.state || effectiveState,
      });
      toast.success(res.data?.message || 'Weapon production started');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start weapon production');
    } finally {
      setProducingWeaponOneId(null);
    }
  };

  if (!data && !me) {
    return (
      <div className={`space-y-3 sm:space-y-4 relative ${styles.pageContent} mobile-page-root flex items-center justify-center min-h-[40vh]`} data-page="armoury">
        <span className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground">Loading armoury…</span>
      </div>
    );
  }

  const hasOwner = !!data?.owner_id;
  const isOwner = data?.is_owner ?? false;
  const canBuy = data?.can_buy ?? false;
  const accumulated = data?.accumulated_bullets ?? 0;
  const productionPerHourMin = data?.production_per_hour_min ?? 300;
  const productionPerHourMax = data?.production_per_hour_max ?? 600;
  const production = data?.production_per_hour ?? (productionPerHourMin + productionPerHourMax) / 2;
  const claimCost = Number(data?.claim_cost ?? 0);
  const pricePerBullet = data?.price_per_bullet ?? null;
  const priceMin = data?.price_min ?? 1;
  const priceMax = data?.price_max ?? 100000;
  const buyMaxPerPurchase = data?.buy_max_per_purchase ?? 5000;
  const buyCooldownMinutes = data?.buy_cooldown_minutes ?? 15;
  const nextBuyAvailableAt = data?.next_buy_available_at ?? null;
  const effectiveBuyMax = Math.min(accumulated, buyMaxPerPurchase);
  const userMoney = Number(me?.money ?? 0);
  const canAffordClaim = userMoney >= claimCost;
  const buyAmountNum = parseInt(buyAmount, 10) || 0;
  const buyTotal = buyAmountNum > 0 && pricePerBullet != null ? buyAmountNum * pricePerBullet : 0;
  const canAffordBuy = buyTotal > 0 && userMoney >= buyTotal;
  const inBuyCooldown = !!nextBuyAvailableAt;
  const minutesUntilCanBuy = (() => {
    if (!nextBuyAvailableAt) return 0;
    try {
      const next = new Date(nextBuyAvailableAt).getTime();
      const diff = Math.max(0, Math.ceil((next - Date.now()) / 60000));
      return diff;
    } catch { return 0; }
  })();

  // Calculate armour & weapon production rates
  const armourHoursRemaining = data?.armour_production_hours_remaining ?? 0;
  const weaponHoursRemaining = data?.weapon_production_hours_remaining ?? 0;
  const armourProductionRate = armourHoursRemaining > 0 ? (data?.armour_rate_per_hour ?? 5) : 0;
  const weaponProductionRate = weaponHoursRemaining > 0 ? (data?.weapon_rate_per_hour ?? 5) : 0;
  const armourStock = Object.values(data?.armour_stock || {}).reduce((a, b) => a + Number(b || 0), 0);
  const weaponStock = Object.values(data?.weapon_stock || {}).reduce((a, b) => a + Number(b || 0), 0);

  return (
    <div className={`space-y-3 sm:space-y-4 relative ${styles.pageContent} mobile-page-root`} data-page="armoury">
      <style>{`
        @keyframes belt-bullets {
          0% { transform: translateX(0); }
          100% { transform: translateX(-${BELT_ITEM_COUNT * ITEM_WIDTH}px); }
        }
        @keyframes belt-treads {
          0% { background-position-x: 0; }
          100% { background-position-x: -30px; }
        }
        .animate-belt-bullets { animation: belt-bullets 34.13s linear infinite; }
        .animate-belt-treads { animation: belt-treads 0.8s linear infinite; }
        @keyframes furnace-pulse {
          0%, 100% { opacity: 0.35; filter: blur(10px); }
          50% { opacity: 0.7; filter: blur(16px); }
        }
        .animate-furnace { animation: furnace-pulse 3s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .animate-belt-bullets, .animate-belt-treads, .animate-furnace { animation: none !important; }
        }
      `}</style>

      <div className={`armoury-main-card relative ${styles.panel} rounded-xl overflow-hidden border border-primary/20 shadow-lg`}>
        <div className="h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        <div className="px-3 sm:px-4 py-3 flex items-center gap-3 border-b border-primary/10 bg-gradient-to-r from-primary/[0.08] to-transparent">
          <div className="w-10 h-10 rounded-lg border border-primary/25 bg-primary/10 flex items-center justify-center shrink-0">
            <Factory size={20} className="text-primary" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-heading font-bold text-primary tracking-wide uppercase leading-tight">
              Armoury
            </h1>
            <p className="text-[10px] sm:text-[11px] text-mutedForeground font-heading truncate mt-0.5">
              {data?.state || 'Unknown'} · Bullets, armour &amp; weapons
            </p>
          </div>
          <div className="hidden sm:flex flex-col items-end text-right shrink-0">
            <span className="text-[9px] uppercase tracking-wider text-mutedForeground font-heading">Bullet stock</span>
            <span className="text-sm font-heading font-bold text-foreground tabular-nums">{accumulated.toLocaleString()}</span>
          </div>
        </div>

        <div className="px-3 sm:px-4 pt-2.5 pb-2">
          <ConveyorBelt />
        </div>

        <div className="px-2.5 sm:px-3 pb-2.5">
          <div className="flex gap-1 p-1 rounded-lg bg-black/35 border border-white/[0.06]">
            <Tab active={activeTab === 'shop'} onClick={() => setActiveTab('shop')} icon={ShoppingCart}>
              Shop
            </Tab>
            <Tab active={activeTab === 'shooting-range'} onClick={() => setActiveTab('shooting-range')} icon={Crosshair}>
              Range
            </Tab>
            {(!hasOwner || isOwner) && (
              <Tab active={activeTab === 'production'} onClick={() => setActiveTab('production')} icon={Factory}>
                Ops
              </Tab>
            )}
          </div>
        </div>

        <div className="px-3 sm:px-4 pb-4 space-y-3 sm:space-y-4">
          {activeTab === 'shop' && (
            <div className="space-y-3 sm:space-y-4">
              {data?.is_unowned && (
                <div className="rounded-lg px-3 py-2.5 bg-amber-500/10 border border-amber-500/30">
                  <p className="text-[11px] text-amber-100/90 font-heading leading-relaxed">
                    <strong className="text-amber-300">Unclaimed armoury:</strong> bullet stock caps at{' '}
                    <strong className="text-primary">{productionPerHourMin}–{productionPerHourMax}</strong> per hour
                    (max {(data?.production_per_24h_max ?? 14400).toLocaleString()}/24h).
                    Only basic armour (L1) and Brass Knuckles sell here — claim ownership for higher tiers.
                  </p>
                </div>
              )}

              {canBuy && pricePerBullet != null && (
                <ArmSection
                  icon={Crosshair}
                  title="Buy bullets"
                  subtitle={`${accumulated.toLocaleString()} in stock · max ${buyMaxPerPurchase.toLocaleString()} / ${buyCooldownMinutes}min`}
                >
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mb-3">
                    {QUICK_BUYS.filter((amt) => amt <= buyMaxPerPurchase).map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setBuyAmount(String(Math.min(amt, effectiveBuyMax)))}
                        disabled={inBuyCooldown || amt > effectiveBuyMax}
                        className={`py-2 rounded-md text-[11px] font-heading font-bold border tabular-nums transition-colors disabled:opacity-40 ${
                          buyAmountNum === amt
                            ? 'bg-primary/25 border-primary/55 text-primary'
                            : 'bg-black/30 border-white/10 text-mutedForeground hover:border-primary/30 hover:text-foreground'
                        }`}
                      >
                        {amt.toLocaleString()}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={buyBullets} className="space-y-2.5">
                    <input
                      type="number"
                      min={1}
                      max={effectiveBuyMax}
                      inputMode="numeric"
                      placeholder={`Up to ${effectiveBuyMax.toLocaleString()}`}
                      value={buyAmount}
                      onChange={(e) => setBuyAmount(e.target.value)}
                      className={`w-full px-3 py-2.5 ${styles.input} rounded-lg text-foreground font-heading text-sm focus:outline-none`}
                    />

                    {buyAmountNum > 0 && (
                      <div className="flex items-center justify-between text-[11px] font-heading px-0.5">
                        <span className="text-mutedForeground">{buyAmountNum.toLocaleString()} × {formatMoney(pricePerBullet)}</span>
                        <span className="text-primary font-bold tabular-nums">{formatMoney(buyTotal)}</span>
                      </div>
                    )}

                    {inBuyCooldown && (
                      <p className="text-[11px] text-amber-400/90 font-heading">
                        Next purchase in {minutesUntilCanBuy} min
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={buying || buyAmountNum <= 0 || !canAffordBuy || buyAmountNum > effectiveBuyMax || inBuyCooldown}
                      className={`w-full py-3 font-heading font-bold text-[11px] sm:text-xs uppercase tracking-wide rounded-lg border-2 transition-all disabled:opacity-45 ${
                        canAffordBuy && buyAmountNum > 0 && buyAmountNum <= effectiveBuyMax && !inBuyCooldown
                          ? 'bg-emerald-500/15 border-emerald-500/45 text-emerald-300 hover:bg-emerald-500/25 active:scale-[0.99]'
                          : 'bg-black/30 border-white/10 text-mutedForeground cursor-not-allowed'
                      }`}
                    >
                      {buying ? 'Buying…' : `Buy ${buyAmountNum > 0 ? `${buyAmountNum.toLocaleString()} ` : ''}bullets`}
                    </button>
                  </form>
                </ArmSection>
              )}

              {hasOwner && !isOwner && (pricePerBullet == null || accumulated === 0) && (
                <div className="rounded-lg px-3 py-4 text-center border border-primary/15 bg-black/25">
                  <p className="text-[12px] text-mutedForeground font-heading">
                    {pricePerBullet == null ? 'Owner has not set a price yet.' : 'No bullets in stock right now.'}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                <ArmSection
                  icon={Shield}
                  title="Armour"
                  subtitle={`${armourOptions.filter((o) => o.armoury_stock > 0).length} tiers in stock`}
                >
                  <div className="divide-y divide-white/[0.04] -mx-1">
                    {armourOptions.length
                      ? armourOptions.map((opt) => {
                          const costMoney = opt.effective_cost_money;
                          const costPoints = opt.effective_cost_points;
                          const cost = costMoney != null ? costMoney : costPoints;
                          const isPoints = costPoints != null && costMoney == null;
                          const canAffordArmour = opt.affordable && !opt.owned;
                          const inStock = opt.armoury_stock > 0;
                          const equipping = equippingArmourLevel === opt.level || (equippingArmourLevel === 0 && opt.equipped);
                          return (
                            <ShopItemRow
                              key={opt.level}
                              name={opt.name}
                              glow={!!opt.loot_exclusive}
                              dimmed={!opt.owned && !inStock && !opt.store_exclusive && !opt.loot_exclusive}
                              meta={
                                opt.owned
                                  ? (opt.equipped ? 'Equipped' : 'Owned')
                                  : opt.store_exclusive
                                    ? 'Store exclusive — 500 pts'
                                    : opt.loot_exclusive
                                      ? 'Loot exclusive'
                                      : opt.unowned_restricted
                                        ? 'Needs claimed armoury'
                                        : `${isPoints ? `${Number(cost).toLocaleString()} pts` : formatMoney(cost)}${inStock ? ` · ${opt.armoury_stock} left` : ' · out of stock'}`
                              }
                              actions={
                                opt.owned ? (
                                  <ArmActionBtn disabled={equipping} onClick={() => (opt.equipped ? unequipArmour() : equipArmour(opt.level))}>
                                    {equipping ? '…' : opt.equipped ? 'Unequip' : 'Equip'}
                                  </ArmActionBtn>
                                ) : opt.store_exclusive || opt.loot_exclusive ? (
                                  <span className="text-[9px] font-heading text-mutedForeground uppercase tracking-wide px-1">
                                    {opt.store_exclusive ? 'Store' : 'Loot'}
                                  </span>
                                ) : (
                                  <ArmActionBtn
                                    disabled={buyingArmourLevel != null || !canAffordArmour || opt.unowned_restricted || !inStock}
                                    onClick={() => buyArmour(opt.level)}
                                    title={opt.unowned_restricted ? 'Claim an owned armoury for higher tiers' : opt.name}
                                  >
                                    {buyingArmourLevel === opt.level ? '…' : 'Buy'}
                                  </ArmActionBtn>
                                )
                              }
                            />
                          );
                        })
                      : <p className="text-[11px] text-mutedForeground font-heading py-3 text-center">Loading armour…</p>}
                  </div>
                </ArmSection>

                <ArmSection
                  icon={Swords}
                  title="Weapons"
                  subtitle={`${weaponsList.filter((w) => w.armoury_stock > 0).length} in stock`}
                >
                  <div className="divide-y divide-white/[0.04] -mx-1">
                    {weaponsList.length
                      ? weaponsList.map((w) => {
                          const priceMoney = w.effective_price_money ?? w.price_money;
                          const pricePoints = w.effective_price_points ?? w.price_points;
                          const canAffordMoney = priceMoney != null && (me?.money ?? 0) >= priceMoney;
                          const canAffordPoints = pricePoints != null && (me?.points ?? 0) >= pricePoints;
                          const inStock = w.armoury_stock > 0;
                          const nameShort = (w.name?.replace(/\s*\(.*\)/, '') || w.id).trim();
                          const equipping = equippingWeaponId === w.id || (equippingWeaponId === '' && w.equipped);
                          const priceBits = [
                            priceMoney != null ? formatMoney(priceMoney) : null,
                            pricePoints != null ? `${Number(pricePoints).toLocaleString()} pts` : null,
                          ].filter(Boolean).join(' · ');
                          return (
                            <ShopItemRow
                              key={w.id}
                              name={nameShort}
                              glow={!!w.loot_exclusive}
                              dimmed={!w.owned && !inStock && !w.store_exclusive && !w.loot_exclusive}
                              meta={
                                w.owned
                                  ? (w.equipped ? 'Equipped' : 'Owned')
                                  : w.store_exclusive
                                    ? 'Store exclusive — 1,000 pts'
                                    : w.loot_exclusive
                                      ? 'Loot exclusive'
                                      : `${priceBits || '—'}${inStock ? ` · ${w.armoury_stock} left` : ' · out of stock'}`
                              }
                              actions={
                                w.owned ? (
                                  <ArmActionBtn disabled={equipping} onClick={() => (w.equipped ? unequipWeapon() : equipWeapon(w.id))}>
                                    {equipping ? '…' : w.equipped ? 'Unequip' : 'Equip'}
                                  </ArmActionBtn>
                                ) : w.store_exclusive || w.loot_exclusive ? (
                                  <span className="text-[9px] font-heading text-mutedForeground uppercase tracking-wide px-1">
                                    {w.store_exclusive ? 'Store' : 'Loot'}
                                  </span>
                                ) : (
                                  <>
                                    {priceMoney != null && (
                                      <ArmActionBtn
                                        variant="muted"
                                        disabled={w.locked || buyingWeaponId != null || !canAffordMoney || !inStock}
                                        onClick={() => buyWeapon(w.id, 'money')}
                                        title={`${w.name} — cash`}
                                      >
                                        {buyingWeaponId === w.id ? '…' : 'Cash'}
                                      </ArmActionBtn>
                                    )}
                                    {pricePoints != null && (
                                      <ArmActionBtn
                                        disabled={w.locked || buyingWeaponId != null || !canAffordPoints || !inStock}
                                        onClick={() => buyWeapon(w.id, 'points')}
                                        title={`${w.name} — points`}
                                      >
                                        {buyingWeaponId === w.id ? '…' : 'Pts'}
                                      </ArmActionBtn>
                                    )}
                                  </>
                                )
                              }
                            />
                          );
                        })
                      : <p className="text-[11px] text-mutedForeground font-heading py-3 text-center">Loading weapons…</p>}
                  </div>
                </ArmSection>
              </div>
            </div>
          )}

          {activeTab === 'shooting-range' && (
            <div className="space-y-3">
              <ArmSection icon={Crosshair} title="Weapon mastery" subtitle="Up to 10% fewer bullets at 100% · train owned guns in power order">
                <p className="text-[11px] text-mutedForeground font-heading mb-3 leading-relaxed">
                  Train guns you own. Weaker owned guns must hit 100% before stronger ones unlock. Unowned guns never block progress.
                  Colt Monitor appears only after a loot drop — not sold here.
                </p>
                {masteryData?.weapons?.length
                  ? (
                      <div className="space-y-2">
                        {masteryData.weapons.map((w) => {
                          if (w.id === 'weapon1') return null;
                          const info = masteryData.mastery?.[w.id] || { mastery_pct: 0 };
                          const pct = Number(info.mastery_pct) || 0;
                          const canTrain = info.can_train !== false;
                          const owned = typeof w.owned === 'boolean' ? w.owned : weaponsList.some((x) => x.id === w.id && x.owned);
                          const training = trainingWeaponId === w.id;
                          const cooldownLabel = formatMasteryTrainCooldownLabel(info.next_train_at);
                          const onCooldown = Boolean(cooldownLabel);
                          const disabled = !owned || training || pct >= 100 || !canTrain || onCooldown;
                          return (
                            <div key={w.id} className="rounded-lg border border-primary/12 bg-black/25 px-2.5 py-2.5 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[12px] sm:text-[13px] font-heading font-semibold text-foreground truncate">
                                    {w.name}
                                    {owned ? <span className="text-emerald-400 ml-1.5 text-[10px] font-bold">Owned</span> : null}
                                  </div>
                                  {w.loot_box_exclusive ? (
                                    <div className="text-[10px] text-amber-400/90 font-heading mt-0.5">Loot box only</div>
                                  ) : null}
                                </div>
                                <span className="text-[11px] text-mutedForeground tabular-nums font-heading shrink-0">{pct}%</span>
                              </div>
                              <div className="h-2 rounded-full bg-black/50 overflow-hidden border border-white/5">
                                <div
                                  className="h-full bg-primary/85 rounded-full transition-all duration-300"
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <ArmActionBtn
                                className="w-full sm:w-auto"
                                disabled={disabled}
                                title={
                                  onCooldown
                                    ? '5 min cooldown after each train on this weapon'
                                    : !canTrain
                                      ? 'Master weaker owned guns to 100% first (in list order)'
                                      : undefined
                                }
                                onClick={() => trainWeapon(w.id)}
                              >
                                {training
                                  ? 'Training…'
                                  : pct >= 100
                                    ? 'Mastered'
                                    : !canTrain
                                      ? 'Master previous first'
                                      : cooldownLabel
                                        ? `Wait ${cooldownLabel}`
                                        : 'Train 5 min'}
                              </ArmActionBtn>
                            </div>
                          );
                        })}
                      </div>
                    )
                  : masteryData ? (
                      <p className="text-[11px] text-mutedForeground font-heading">No guns available to train.</p>
                    ) : (
                      <p className="text-[11px] text-mutedForeground font-heading">Loading mastery…</p>
                    )}
              </ArmSection>
            </div>
          )}

          {activeTab === 'production' && (!hasOwner || isOwner) && (
            <div className="space-y-3 sm:space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
                <StatCard
                  icon={User}
                  label="Owner"
                  value={hasOwner ? (
                    <Link to={`/profile/${encodeURIComponent(data.owner_username)}`} className="text-primary hover:underline flex items-center gap-1 text-[11px] sm:text-xs">
                      <Shield size={11} className="shrink-0" />
                      <span className="truncate">{data.owner_username}</span>
                    </Link>
                  ) : (
                    <span className="text-mutedForeground italic text-[11px]">Unclaimed</span>
                  )}
                />

                <StatCard
                  icon={Package}
                  label="In Stock"
                  value={<AnimatedCounter target={accumulated} />}
                  pulseActive={accumulated > 0}
                />

                <StatCard
                  icon={DollarSign}
                  label="Price"
                  value={
                    <>
                      {pricePerBullet != null ? formatMoney(pricePerBullet) : '—'}
                      <span className="text-[9px] text-mutedForeground font-normal">/ea</span>
                    </>
                  }
                  highlight
                />

                <StatCard
                  icon={Flame}
                  label={hasOwner ? 'Status' : 'Claim Cost'}
                  value={hasOwner ? (
                    <span className="text-emerald-400 flex items-center gap-1 text-[11px] sm:text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> Active
                    </span>
                  ) : (
                    formatMoney(claimCost)
                  )}
                />
              </div>

              {isOwner && (
                <ArmSection icon={Gauge} title="Production overview" subtitle="Bullets · armour · weapons">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    <div className="rounded-lg p-2.5 bg-black/30 border border-primary/12">
                      <div className="text-center mb-2">
                        <div className="text-[9px] text-mutedForeground font-heading uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                          <Crosshair size={10} />
                          Bullets
                        </div>
                        <ProductionGauge production={production} maxProduction={productionPerHourMax} />
                      </div>
                      <div className="text-center space-y-0.5">
                        <p className="text-sm font-heading font-bold text-primary tabular-nums">
                          <AnimatedCounter target={accumulated} />
                        </p>
                        <p className="text-[10px] text-mutedForeground font-heading">in stock</p>
                        <p className="text-[10px] text-emerald-400 font-heading">{productionPerHourMin}–{productionPerHourMax}/hr</p>
                      </div>
                    </div>

                    <div className="rounded-lg p-2.5 bg-black/30 border border-primary/12">
                      <div className="text-center mb-2">
                        <div className="text-[9px] text-mutedForeground font-heading uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                          <Shield size={10} />
                          Armour
                        </div>
                        <ProductionGauge production={armourProductionRate} maxProduction={data?.armour_rate_per_hour ?? 5} />
                      </div>
                      <div className="text-center space-y-0.5">
                        <p className="text-sm font-heading font-bold text-primary">{armourStock} units</p>
                        <p className="text-[10px] text-mutedForeground font-heading">
                          {armourHoursRemaining > 0 ? `${armourHoursRemaining.toFixed(1)}h left` : 'idle'}
                        </p>
                        <p className="text-[10px] text-emerald-400 font-heading">
                          {armourProductionRate > 0 ? `${armourProductionRate}/hr` : 'stopped'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg p-2.5 bg-black/30 border border-primary/12">
                      <div className="text-center mb-2">
                        <div className="text-[9px] text-mutedForeground font-heading uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                          <Swords size={10} />
                          Weapons
                        </div>
                        <ProductionGauge production={weaponProductionRate} maxProduction={data?.weapon_rate_per_hour ?? 5} />
                      </div>
                      <div className="text-center space-y-0.5">
                        <p className="text-sm font-heading font-bold text-primary">{weaponStock} units</p>
                        <p className="text-[10px] text-mutedForeground font-heading">
                          {weaponHoursRemaining > 0 ? `${weaponHoursRemaining.toFixed(1)}h left` : 'idle'}
                        </p>
                        <p className="text-[10px] text-emerald-400 font-heading">
                          {weaponProductionRate > 0 ? `${weaponProductionRate}/hr` : 'stopped'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg px-2.5 py-2 bg-primary/5 border border-primary/20 mb-3">
                    <p className="text-[10px] sm:text-[11px] text-mutedForeground font-heading leading-relaxed">
                      <strong className="text-primary">Rate:</strong> 5/hr ·{' '}
                      <strong className="text-primary">Max stock:</strong> 15/item ·{' '}
                      <strong className="text-primary">Batches:</strong> 1hr ·{' '}
                      <strong className="text-primary">Markup:</strong> 35%
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="rounded-lg bg-black/30 p-2.5 border border-primary/10">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Shield size={11} className="text-primary/70" />
                        <p className="text-[9px] text-mutedForeground font-heading uppercase">Armour stock</p>
                      </div>
                      <div className="text-[11px] font-heading text-foreground space-y-0.5">
                        {Object.entries(data?.armour_stock || {}).filter(([, q]) => Number(q || 0) > 0).length > 0
                          ? Object.entries(data.armour_stock).filter(([, q]) => Number(q || 0) > 0).map(([lv, q]) => (
                              <div key={lv} className="flex justify-between gap-2">
                                <span className="text-mutedForeground">Level {lv}</span>
                                <span className="text-primary font-bold tabular-nums">{Number(q)}</span>
                              </div>
                            ))
                          : <span className="text-mutedForeground italic">No stock</span>}
                      </div>
                    </div>

                    <div className="rounded-lg bg-black/30 p-2.5 border border-primary/10">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Swords size={11} className="text-primary/70" />
                        <p className="text-[9px] text-mutedForeground font-heading uppercase">Weapon stock</p>
                      </div>
                      <div className="text-[11px] font-heading text-foreground">
                        {Object.entries(data?.weapon_stock || {}).filter(([, q]) => Number(q || 0) > 0).length > 0
                          ? (
                              <div className="flex justify-between gap-2">
                                <span className="text-mutedForeground">Total</span>
                                <span className="text-primary font-bold tabular-nums">{weaponStock}</span>
                              </div>
                            )
                          : <span className="text-mutedForeground italic">No stock</span>}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[9px] text-mutedForeground font-heading uppercase tracking-widest">Start production (1 hour)</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(() => {
                        const costMoney = data?.produce_all_armour_cost_money ?? 0;
                        const costPoints = data?.produce_all_armour_cost_points ?? 0;
                        const canAfford = (me?.money ?? 0) >= costMoney && (me?.points ?? 0) >= costPoints;
                        const parts = [];
                        if (costMoney > 0) parts.push(formatMoney(costMoney));
                        if (costPoints > 0) parts.push(`${Number(costPoints).toLocaleString()}p`);
                        const isProducing = armourHoursRemaining > 0;
                        return (
                          <button
                            type="button"
                            disabled={producingArmour || !canAfford || isProducing}
                            onClick={startArmourProductionAll}
                            className={`px-3 py-2.5 rounded-lg text-[11px] font-heading font-bold border transition-all flex items-center gap-2 ${
                              isProducing
                                ? 'bg-primary/10 border-primary/40 text-primary/60 cursor-not-allowed'
                                : canAfford
                                ? 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 active:scale-[0.99]'
                                : 'bg-black/30 border-white/10 text-mutedForeground cursor-not-allowed'
                            } disabled:opacity-50`}
                          >
                            <Shield size={14} className="shrink-0" />
                            <div className="flex flex-col items-start text-left min-w-0">
                              <span className="leading-tight">{isProducing ? 'Producing…' : 'All armour (5 lvls)'}</span>
                              <span className="text-[10px] opacity-75">{parts.join(' + ') || '—'}</span>
                            </div>
                          </button>
                        );
                      })()}

                      {(() => {
                        const costMoney = data?.produce_all_weapons_cost_money ?? 0;
                        const costPoints = data?.produce_all_weapons_cost_points ?? 0;
                        const canAfford = (me?.money ?? 0) >= costMoney && (me?.points ?? 0) >= costPoints;
                        const parts = [];
                        if (costMoney > 0) parts.push(formatMoney(costMoney));
                        if (costPoints > 0) parts.push(`${Number(costPoints).toLocaleString()}p`);
                        const isProducing = weaponHoursRemaining > 0;
                        return (
                          <button
                            type="button"
                            disabled={producingWeapon || !canAfford || isProducing}
                            onClick={startWeaponProductionAll}
                            className={`px-3 py-2.5 rounded-lg text-[11px] font-heading font-bold border transition-all flex items-center gap-2 ${
                              isProducing
                                ? 'bg-black/30 border-white/10 text-mutedForeground cursor-not-allowed'
                                : canAfford
                                ? 'bg-black/30 border-primary/30 text-foreground hover:border-primary/50 active:scale-[0.99]'
                                : 'bg-black/30 border-white/10 text-mutedForeground cursor-not-allowed'
                            } disabled:opacity-50`}
                          >
                            <Swords size={14} className="shrink-0" />
                            <div className="flex flex-col items-start text-left min-w-0">
                              <span className="leading-tight">{isProducing ? 'Producing…' : 'All weapons'}</span>
                              <span className="text-[10px] opacity-75">{parts.join(' + ') || '—'}</span>
                            </div>
                          </button>
                        );
                      })()}
                    </div>

                    {(data?.armour_produce_tier_costs?.length > 0 || data?.weapon_produce_costs?.length > 0) && (
                      <div className="space-y-2 pt-2 border-t border-primary/10">
                        <p className="text-[9px] text-mutedForeground font-heading uppercase tracking-widest">
                          Or produce one item (1 hr)
                        </p>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div className="rounded-lg bg-black/30 p-2 border border-primary/10 space-y-1.5">
                            <p className="text-[9px] text-mutedForeground font-heading uppercase">Armour by level</p>
                            {(data?.armour_produce_tier_costs || []).map((row) => {
                              const hrs = Number(data?.armour_production_hours?.[String(row.level)] ?? data?.armour_production_hours?.[row.level] ?? 0);
                              const busy = hrs > 0.01;
                              const cm = row.cost_money || 0;
                              const cp = row.cost_points || 0;
                              const canAffordOne = (me?.money ?? 0) >= cm && (me?.points ?? 0) >= cp;
                              const label = [cm > 0 ? formatMoney(cm) : null, cp > 0 ? `${cp.toLocaleString()}p` : null].filter(Boolean).join(' · ') || '—';
                              return (
                                <button
                                  key={row.level}
                                  type="button"
                                  disabled={producingArmourLevel != null || busy || !canAffordOne}
                                  onClick={() => startArmourProductionOne(row.level)}
                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[11px] font-heading border ${
                                    busy
                                      ? 'border-amber-500/35 text-amber-400/80 cursor-not-allowed'
                                      : canAffordOne
                                        ? 'border-white/10 text-foreground hover:border-primary/40'
                                        : 'border-white/5 text-mutedForeground cursor-not-allowed'
                                  } disabled:opacity-50`}
                                >
                                  <span>Lv.{row.level}{busy ? ` (${hrs.toFixed(1)}h left)` : ''}</span>
                                  <span className="text-mutedForeground truncate">{producingArmourLevel === row.level ? '…' : label}</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="rounded-lg bg-black/30 p-2 border border-primary/10 space-y-1.5 max-h-56 overflow-y-auto">
                            <p className="text-[9px] text-mutedForeground font-heading uppercase sticky top-0 bg-[#0c0c0c]/95 pb-1">Weapons (one at a time)</p>
                            {(data?.weapon_produce_costs || []).map((w) => {
                              const hrs = Number(data?.weapon_production_hours?.[w.id] ?? 0);
                              const busy = hrs > 0.01;
                              const cm = w.cost_money || 0;
                              const cp = w.cost_points || 0;
                              const canAffordOne = (me?.money ?? 0) >= cm && (me?.points ?? 0) >= cp;
                              const label = [cm > 0 ? formatMoney(cm) : null, cp > 0 ? `${cp.toLocaleString()}p` : null].filter(Boolean).join(' · ') || '—';
                              const shortName = (w.name || w.id || '').replace(/\s*\(.*\)/, '').trim();
                              return (
                                <button
                                  key={w.id}
                                  type="button"
                                  disabled={producingWeaponOneId != null || busy || !canAffordOne}
                                  onClick={() => startWeaponProductionOne(w.id)}
                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[10px] sm:text-[11px] font-heading border ${
                                    busy
                                      ? 'border-amber-500/35 text-amber-400/80 cursor-not-allowed'
                                      : canAffordOne
                                        ? 'border-white/10 text-foreground hover:border-primary/40'
                                        : 'border-white/5 text-mutedForeground cursor-not-allowed'
                                  } disabled:opacity-50`}
                                >
                                  <span className="truncate text-left">{shortName}{busy ? ` (${hrs.toFixed(1)}h)` : ''}</span>
                                  <span className="text-mutedForeground shrink-0">{producingWeaponOneId === w.id ? '…' : label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </ArmSection>
              )}

              {isOwner && (
                <>
                  <ArmSection icon={Crosshair} title="Set sell price" subtitle="Cash per bullet">
                    <form onSubmit={setPrice} className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mutedForeground text-sm">$</span>
                        <input
                          type="number"
                          min={priceMin}
                          max={priceMax}
                          inputMode="numeric"
                          placeholder={pricePerBullet != null ? String(pricePerBullet) : 'Price'}
                          value={priceInput}
                          onChange={(e) => setPriceInput(e.target.value)}
                          className="w-full pl-7 pr-3 py-2.5 bg-black/40 border border-primary/20 rounded-lg text-foreground font-heading text-sm focus:border-primary/50 focus:outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={settingPrice}
                        className="px-4 py-2.5 bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-[11px] uppercase rounded-lg hover:bg-primary/30 disabled:opacity-50"
                      >
                        {settingPrice ? '…' : 'Set price'}
                      </button>
                    </form>
                    {pricePerBullet != null && (
                      <p className="text-[11px] text-mutedForeground mt-2 font-heading">Current: {formatMoney(pricePerBullet)}/bullet</p>
                    )}
                  </ArmSection>

                  {(data?.armour_money_price_defaults?.length > 0 || data?.weapon_money_price_defaults?.length > 0) && (
                    <ArmSection icon={Package} title="Cash list prices" subtitle="Armour L1–3 & money guns · clear + save resets default">
                      <p className="text-[10px] text-mutedForeground mb-2 font-heading leading-relaxed">
                        Points armour (L4–5) and points weapons stay on the default formula. Max{' '}
                        {formatMoney(data?.armoury_item_money_price_max ?? 5_000_000)} each.
                      </p>
                      <form onSubmit={saveItemPrices} className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <p className="text-[9px] text-mutedForeground font-heading uppercase">Armour (cash tiers)</p>
                            {(data?.armour_money_price_defaults || []).map((d) => (
                              <label key={d.level} className="flex items-center gap-2 text-[11px] font-heading">
                                <span className="text-mutedForeground w-8 shrink-0">L{d.level}</span>
                                <span className="text-mutedForeground truncate flex-1" title={d.name}>{d.name}</span>
                                <span className="text-mutedForeground">$</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={data?.armoury_item_money_price_max ?? 5_000_000}
                                  value={armourPriceInputs[d.level] ?? ''}
                                  onChange={(e) => setArmourPriceInputs((prev) => ({ ...prev, [d.level]: e.target.value }))}
                                  className="w-24 sm:w-28 px-2 py-1.5 bg-black/40 border border-primary/20 rounded-md text-foreground text-[11px]"
                                />
                              </label>
                            ))}
                          </div>
                          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                            <p className="text-[9px] text-mutedForeground font-heading uppercase sticky top-0 bg-[#0c0c0c]/95 pb-1">Weapons (cash)</p>
                            {(data?.weapon_money_price_defaults || []).map((d) => (
                              <label key={d.id} className="flex items-center gap-2 text-[10px] sm:text-[11px] font-heading">
                                <span className="text-mutedForeground truncate flex-1" title={d.name}>{d.name}</span>
                                <span className="text-mutedForeground">$</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={data?.armoury_item_money_price_max ?? 5_000_000}
                                  value={weaponPriceInputs[d.id] ?? ''}
                                  onChange={(e) => setWeaponPriceInputs((prev) => ({ ...prev, [d.id]: e.target.value }))}
                                  className="w-24 sm:w-28 px-2 py-1.5 bg-black/40 border border-primary/20 rounded-md text-foreground"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={settingItemPrices}
                          className="w-full sm:w-auto px-4 py-2 bg-primary/15 border border-primary/45 text-primary font-heading font-bold text-[11px] uppercase rounded-lg hover:bg-primary/25 disabled:opacity-50"
                        >
                          {settingItemPrices ? 'Saving…' : 'Save item prices'}
                        </button>
                      </form>
                    </ArmSection>
                  )}
                </>
              )}

              {!hasOwner && (
                <ArmSection icon={Gauge} title="Claim this armoury" subtitle={`${productionPerHourMin}–${productionPerHourMax} bullets / hour`}>
                  <div className="relative overflow-hidden rounded-lg">
                    <div className="absolute -bottom-8 -right-8 w-28 h-28 rounded-full bg-orange-500/15 animate-furnace pointer-events-none" />
                    <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-4">
                      <ProductionGauge production={production} maxProduction={productionPerHourMax} />
                      <div className="flex-1 space-y-3">
                        <p className="text-[12px] text-mutedForeground font-heading leading-relaxed">
                          Produces <strong className="text-primary">{productionPerHourMin}–{productionPerHourMax}</strong> bullets per hour (random each hour).
                          {claimCost > 0 && (
                            <span className="block mt-1">
                              Pay <strong className="text-primary">{formatMoney(claimCost)}</strong> to claim ownership.
                            </span>
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={claim}
                          disabled={claiming || !canAffordClaim}
                          className={`w-full flex items-center justify-center gap-2 px-4 py-3 font-heading font-bold text-[11px] sm:text-xs uppercase tracking-wide rounded-lg border-2 transition-all ${
                            canAffordClaim
                              ? 'bg-primary/20 border-primary/55 text-primary hover:bg-primary/30 active:scale-[0.99]'
                              : 'bg-black/30 border-white/10 text-mutedForeground cursor-not-allowed'
                          } disabled:opacity-50`}
                        >
                          <Factory size={16} />
                          {claiming ? 'Claiming…' : canAffordClaim ? `Claim — ${formatMoney(claimCost)}` : `Need ${formatMoney(claimCost)}`}
                        </button>
                      </div>
                    </div>
                  </div>
                </ArmSection>
              )}
            </div>
          )}
        </div>

        <div className="h-1 bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
      </div>
    </div>
  );
}
