import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Factory, Package, User, ShoppingCart, Flame, Gauge, Shield, Crosshair, Swords, DollarSign } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { formatMasteryTrainCooldownLabel, useMasteryCooldownTick } from '../../utils/shootingRangeCooldown';
import { useMinigameCaptcha } from '../../hooks/useMinigameCaptcha';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const formatMoney = (n) => `$${Number(n ?? 0).toLocaleString()}`;

/** Worst → best for combat (same as bullets-to-kill tier): non-loot by damage, loot-exclusive last. */
function sortWeaponsByPower(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const la = a.loot_exclusive ? 1 : 0;
    const lb = b.loot_exclusive ? 1 : 0;
    if (la !== lb) return la - lb;
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
    <div className="relative w-full h-10 overflow-hidden rounded" style={{ background: 'linear-gradient(180deg, #2a2218 0%, #3d3225 40%, #2a2218 100%)' }}>
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
      <div className="absolute inset-x-0 top-0 h-[3px] z-10" style={{ background: 'linear-gradient(90deg, #555 0%, #888 50%, #555 100%)' }} />
      <div className="absolute inset-x-0 bottom-0 h-[3px] z-10" style={{ background: 'linear-gradient(90deg, #555 0%, #888 50%, #555 100%)' }} />
      <div className="absolute inset-0 animate-belt-treads" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 28px, rgba(0,0,0,0.3) 28px, rgba(0,0,0,0.3) 30px)', backgroundSize: '30px 100%' }} />
      <div className="absolute top-0 left-0 h-full flex items-center animate-belt-bullets" style={{ width: setWidth * 2 }}>
        {items.map((type, i) => (
          <div key={i} className="shrink-0 flex items-center justify-center" style={{ width: ITEM_WIDTH }}>
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
   Tab Component
   ═══════════════════════════════════════════════════════ */
const Tab = ({ active, onClick, icon: Icon, children }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider transition-all border-b-2 ${
      active ? 'text-primary border-primary bg-primary/5' : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-primary/30'
    }`}
  >
    <Icon size={11} className="sm:w-3 sm:h-3" />
    {children}
  </button>
);

/* ═══════════════════════════════════════════════════════
   Stat Card Component
   ═══════════════════════════════════════════════════════ */
const StatCard = ({ icon: Icon, label, value, highlight, pulseActive }) => (
  <div className="rounded-lg p-2 sm:p-3 relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-900/60 border border-zinc-700/40">
    {pulseActive && (
      <div className="absolute top-1 right-1 w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-primary animate-pulse" />
    )}
    <div className="flex items-center gap-1 sm:gap-1.5 mb-0.5 sm:mb-1">
      <Icon size={10} className="text-zinc-500 sm:w-[11px] sm:h-[11px]" />
      <span className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase">{label}</span>
    </div>
    <div className={`text-xs sm:text-sm font-heading font-bold ${highlight ? 'text-primary' : 'text-foreground'}`}>
      {value}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Main BulletFactory Component
   ═══════════════════════════════════════════════════════ */
export default function BulletFactory({ me: meProp, ownedArmouryState }) {
  const { getCaptchaToken, captchaModal } = useMinigameCaptcha();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
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
    } finally {
      setLoading(false);
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
    let body = { weapon_id: weaponId, mode: 'auto_sim' };
    try {
      const token = await getCaptchaToken();
      if (token) body = { ...body, captcha_token: token };
    } catch {
      return;
    }
    setTrainingWeaponId(weaponId);
    try {
      const res = await api.post('/shooting-range/train', body);
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
    setClaiming(true);
    try {
      await api.post('/bullet-factory/claim', { state: data?.state || currentState });
      toast.success('You now own the Armoury!');
      refreshUser();
      const meRes = await api.get('/auth/me').catch(() => ({}));
      if (meRes.data) setMe(meRes.data);
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim armoury');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary font-heading text-xs sm:text-sm uppercase tracking-widest">Loading...</span>
        </div>
      </div>
    );
  }

  const hasOwner = !!data?.owner_id;
  const isOwner = data?.is_owner ?? false;
  const canBuy = data?.can_buy ?? false;
  const accumulated = data?.accumulated_bullets ?? 0;
  const productionPer24h = data?.production_per_24h ?? 5000;
  const productionTickMins = data?.production_tick_minutes ?? 20;
  const production = data?.production_per_hour ?? productionPer24h / 24;
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
      {captchaModal}
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
          0%, 100% { opacity: 0.4; filter: blur(12px); }
          50% { opacity: 0.8; filter: blur(18px); }
        }
        .animate-furnace { animation: furnace-pulse 3s ease-in-out infinite; }
        @keyframes smoke-rise {
          0% { transform: translateY(0) scaleX(1); opacity: 0.5; }
          100% { transform: translateY(-30px) scaleX(2); opacity: 0; }
        }
      `}</style>

      {/* Factory Header */}
      <div className="armoury-main-card relative rounded-lg sm:rounded-xl overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-900/90 border border-zinc-700/40 shadow-lg">
        {/* Corner rivets */}
        {[{ top: 6, left: 6 }, { top: 6, right: 6 }, { bottom: 6, left: 6 }, { bottom: 6, right: 6 }].map((pos, i) => (
          <div key={i} className="armoury-rivet absolute w-2 h-2 sm:w-3 sm:h-3 rounded-full z-10" style={{
            ...pos,
            background: 'radial-gradient(circle at 40% 30%, #666, #333)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.1)',
          }} />
        ))}

        {/* Warning stripe */}
        <div className="armoury-stripe h-1.5 sm:h-2" style={{
          background: 'repeating-linear-gradient(135deg, var(--noir-primary) 0px, var(--noir-primary) 6px, #1a1a1a 6px, #1a1a1a 12px)',
          opacity: 0.6,
        }} />

        {/* Title */}
        <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-3 border-b border-zinc-700/50">
          <div className="relative">
            <Factory size={20} className="text-primary sm:w-6 sm:h-6" />
            <div className="absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg md:text-xl font-heading font-bold text-primary tracking-wider uppercase">
              Armoury
            </h1>
            <p className="text-[8px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-widest truncate">
              {data?.state || 'Unknown'} — Bullets, Armour & Weapons
            </p>
          </div>
          <div className="hidden sm:flex items-end gap-1 mr-2">
            {[0, 0.5, 0.2].map((d, i) => (
              <div key={i} className="relative">
                <div className="w-2.5 sm:w-3 rounded-t" style={{ height: 14 + i * 5, background: 'linear-gradient(180deg, #555 0%, #333 100%)' }} />
                <div className="absolute -top-2 sm:-top-3 left-1/2 -translate-x-1/2 w-3 sm:w-4 h-3 sm:h-4 rounded-full bg-zinc-500/30"
                  style={{
                    animation: 'smoke-rise 3s ease-out infinite',
                    animationDelay: `${d}s`,
                  }} />
              </div>
            ))}
          </div>
        </div>

        {/* Conveyor Belt */}
        <div className="px-3 sm:px-4 pt-2 sm:pt-3">
          <ConveyorBelt />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-700/50 px-2 sm:px-4">
          <Tab active={activeTab === 'shop'} onClick={() => setActiveTab('shop')} icon={ShoppingCart}>
            Shop
          </Tab>
          <Tab active={activeTab === 'shooting-range'} onClick={() => setActiveTab('shooting-range')} icon={Crosshair}>
            Shooting range
          </Tab>
          {(!hasOwner || isOwner) && (
            <Tab active={activeTab === 'production'} onClick={() => setActiveTab('production')} icon={Factory}>
              Production
            </Tab>
          )}
        </div>

        {/* Tab Content */}
        <div className="p-3 sm:p-4">
          {activeTab === 'shop' && (
            <div className="space-y-3 sm:space-y-4">
              {data?.is_unowned && (
                <div className="rounded-lg p-2.5 sm:p-3 bg-amber-950/30 border border-amber-700/40">
                  <p className="text-[9px] sm:text-[10px] text-amber-200/90 font-heading leading-relaxed">
                    <strong className="text-amber-400">Unclaimed armoury:</strong> bullet stock caps at{' '}
                    <strong className="text-primary">{(data?.production_per_24h ?? 1000).toLocaleString()}</strong> per 24h. You can only buy{' '}
                    <strong>basic armour (level 1)</strong> and <strong>Brass Knuckles</strong> here — claim this armoury (or use another state&apos;s owned shop) for higher tiers.
                  </p>
                </div>
              )}
              {/* Buy Bullets Section */}
              {canBuy && pricePerBullet != null && (
                <div className="rounded-lg p-2.5 sm:p-3 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
                  <div className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Crosshair size={10} className="sm:w-[11px] sm:h-[11px]" />
                    Buy Bullets
                  </div>
                  
                  <div className="flex flex-wrap gap-1 sm:gap-1.5 mb-2">
                    {QUICK_BUYS.filter((amt) => amt <= buyMaxPerPurchase).map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setBuyAmount(String(Math.min(amt, effectiveBuyMax)))}
                        disabled={inBuyCooldown || amt > effectiveBuyMax}
                        className={`px-2 sm:px-2.5 py-1 rounded text-[10px] sm:text-[11px] font-heading font-bold border transition-all ${
                          buyAmountNum === amt
                            ? 'bg-primary/25 border-primary/60 text-primary'
                            : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:border-zinc-600 disabled:opacity-50'
                        }`}
                      >
                        {amt.toLocaleString()}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={buyBullets} className="space-y-2">
                    <input
                      type="number"
                      min={1}
                      max={effectiveBuyMax}
                      placeholder={`Up to ${effectiveBuyMax.toLocaleString()}`}
                      value={buyAmount}
                      onChange={(e) => setBuyAmount(e.target.value)}
                      className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 bg-zinc-900/80 border border-zinc-600/40 rounded text-foreground font-heading text-xs sm:text-sm focus:border-primary/50 focus:outline-none"
                    />
                    
                    {buyAmountNum > 0 && (
                      <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-heading px-1">
                        <span className="text-zinc-500">{buyAmountNum.toLocaleString()} × {formatMoney(pricePerBullet)}</span>
                        <span className="text-primary font-bold">= {formatMoney(buyTotal)}</span>
                      </div>
                    )}
                    
                    {inBuyCooldown && (
                      <p className="text-[10px] sm:text-[11px] text-amber-500/90 font-heading">
                        Next purchase in {minutesUntilCanBuy} min
                      </p>
                    )}
                    
                    <button
                      type="submit"
                      disabled={buying || buyAmountNum <= 0 || !canAffordBuy || buyAmountNum > effectiveBuyMax || inBuyCooldown}
                      className={`w-full px-3 sm:px-4 py-2 sm:py-2.5 font-heading font-bold text-[10px] sm:text-xs uppercase rounded border-2 transition-all ${
                        canAffordBuy && buyAmountNum > 0 && buyAmountNum <= effectiveBuyMax && !inBuyCooldown
                          ? 'bg-gradient-to-b from-emerald-900/40 to-emerald-900/20 border-emerald-600/50 text-emerald-400 hover:from-emerald-900/50 active:scale-95'
                          : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 cursor-not-allowed'
                      } disabled:opacity-50`}
                    >
                      {buying ? 'Buying...' : `Buy ${buyAmountNum > 0 ? buyAmountNum.toLocaleString() : ''} Bullets`}
                    </button>
                  </form>
                  
                  <p className="text-[9px] sm:text-[10px] text-zinc-500 mt-1.5">
                    {accumulated.toLocaleString()} in stock · Max {buyMaxPerPurchase.toLocaleString()} per {buyCooldownMinutes}min
                  </p>
                </div>
              )}

              {hasOwner && !isOwner && (pricePerBullet == null || accumulated === 0) && (
                <div className="rounded-lg p-3 text-center bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
                  <p className="text-[10px] sm:text-[11px] text-zinc-500 font-heading">
                    {pricePerBullet == null ? 'Owner has not set a price yet.' : 'No bullets in stock right now.'}
                  </p>
                </div>
              )}

              {/* Buy Armour & Weapons Combined */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {/* Armour */}
                <div className="rounded-lg p-2.5 sm:p-3 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
                  <div className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Shield size={10} className="sm:w-[11px] sm:h-[11px]" />
                    Buy Armour ({armourOptions.filter(o => o.armoury_stock > 0).length} in stock)
                  </div>
                  <div className="flex flex-wrap gap-1 sm:gap-1.5 items-center">
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
                            <div key={opt.level} className="flex items-center gap-0.5">
                              {opt.owned ? (
                                <>
                                  <span className={`px-1.5 py-1 rounded text-[9px] sm:text-[10px] font-heading border border-zinc-600/50 bg-zinc-800/50 text-foreground truncate max-w-[120px] sm:max-w-[140px] ${opt.loot_exclusive ? 'shadow-[0_0_10px_rgba(251,191,36,0.45)]' : ''}`} title={opt.name}>
                                    {opt.name}{opt.equipped ? ' ✓' : ''}
                                    {opt.loot_exclusive && <span className="text-amber-400 ml-0.5">(excl)</span>}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={equipping}
                                    onClick={() => opt.equipped ? unequipArmour() : equipArmour(opt.level)}
                                    className="px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                                  >
                                    {equipping ? '...' : opt.equipped ? 'Unequip' : 'Equip'}
                                  </button>
                                </>
                              ) : opt.loot_exclusive ? (
                                <span className="px-1.5 py-1 rounded text-[9px] sm:text-[10px] font-heading border border-zinc-600/50 bg-zinc-800/30 text-zinc-500 shadow-[0_0_10px_rgba(251,191,36,0.45)]" title="Obtain from loot box">
                                  {opt.name} <span className="text-amber-400/80">(Loot exclusive)</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={buyingArmourLevel != null || !canAffordArmour || opt.unowned_restricted}
                                  onClick={() => buyArmour(opt.level)}
                                  className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded text-[9px] sm:text-[10px] font-heading font-bold border transition-all truncate max-w-[140px] sm:max-w-[160px] ${
                                    inStock && !opt.unowned_restricted ? 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 active:scale-95' : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500'
                                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                                  title={opt.unowned_restricted ? 'Claim an owned armoury for higher tiers' : opt.name}
                                >
                                  {opt.name} {isPoints ? `${Number(cost).toLocaleString()}p` : formatMoney(cost)}
                                  {inStock && <span className="ml-1 text-[7px] text-emerald-400">({opt.armoury_stock})</span>}
                                </button>
                              )}
                            </div>
                          );
                        })
                      : <span className="text-[9px] sm:text-[10px] text-zinc-500">Loading...</span>}
                  </div>
                </div>

                {/* Weapons */}
                <div className="rounded-lg p-2.5 sm:p-3 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
                  <div className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Swords size={10} className="sm:w-[11px] sm:h-[11px]" />
                    Buy Weapons ({weaponsList.filter(w => w.armoury_stock > 0).length} in stock)
                  </div>
                  <div className="flex flex-wrap gap-1 sm:gap-1.5 items-center">
                    {weaponsList.length
                      ? weaponsList.map((w) => {
                          const priceMoney = w.effective_price_money ?? w.price_money;
                          const pricePoints = w.effective_price_points ?? w.price_points;
                          const canAffordMoney = priceMoney != null && (me?.money ?? 0) >= priceMoney;
                          const canAffordPoints = pricePoints != null && (me?.points ?? 0) >= pricePoints;
                          const canBuyW = !w.owned && !w.locked && (canAffordMoney || canAffordPoints);
                          const inStock = w.armoury_stock > 0;
                          const nameShort = (w.name?.replace(/\s*\(.*\)/, '') || w.id).trim();
                          const equipping = equippingWeaponId === w.id || (equippingWeaponId === '' && w.equipped);
                          return (
                            <div key={w.id} className="flex items-center gap-0.5 flex-wrap">
                              {w.owned ? (
                                <>
                                  <span className={`px-1.5 py-1 rounded text-[9px] sm:text-[10px] font-heading border border-zinc-600/50 bg-zinc-800/50 text-foreground truncate max-w-[100px] sm:max-w-[110px] ${w.loot_exclusive ? 'shadow-[0_0_10px_rgba(251,191,36,0.45)]' : ''}`} title={w.name}>
                                    {nameShort}{w.equipped ? ' ✓' : ''}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={equipping}
                                    onClick={() => w.equipped ? unequipWeapon() : equipWeapon(w.id)}
                                    className="px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 shrink-0"
                                  >
                                    {equipping ? '...' : w.equipped ? 'Unequip' : 'Equip'}
                                  </button>
                                </>
                              ) : (
                                <>
                                  {priceMoney != null && (
                                    <button
                                      type="button"
                                      disabled={w.locked || buyingWeaponId != null || !canAffordMoney}
                                      onClick={() => buyWeapon(w.id, 'money')}
                                      className={`px-1.5 sm:px-2 py-1 rounded text-[8px] sm:text-[9px] font-heading border transition-all truncate max-w-[100px] sm:max-w-[110px] ${
                                        inStock ? 'bg-zinc-800/50 border-zinc-600/50 text-foreground hover:border-primary/40' : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500'
                                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                                      title={w.name}
                                    >
                                      {nameShort} {formatMoney(priceMoney)}
                                    </button>
                                  )}
                                  {pricePoints != null && (
                                    <button
                                      type="button"
                                      disabled={w.locked || buyingWeaponId != null || !canAffordPoints}
                                      onClick={() => buyWeapon(w.id, 'points')}
                                      className={`px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-heading border transition-all shrink-0 ${
                                        inStock ? 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/20' : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500'
                                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                                      title={`${w.name} — ${Number(pricePoints).toLocaleString()} points`}
                                    >
                                      {priceMoney != null ? `${Number(pricePoints).toLocaleString()}p` : `${nameShort} ${Number(pricePoints).toLocaleString()}p`}
                                    </button>
                                  )}
                                  {inStock && !w.owned && <span className="text-[7px] text-emerald-400">({w.armoury_stock})</span>}
                                </>
                              )}
                            </div>
                          );
                        })
                      : <span className="text-[9px] sm:text-[10px] text-zinc-500">Loading...</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shooting-range' && (
            <div className="space-y-3 sm:space-y-4">
              <div className="rounded-lg p-2.5 sm:p-3 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
                <div className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Crosshair size={10} className="sm:w-[11px] sm:h-[11px]" />
                  Weapon mastery
                </div>
                <p className="text-[10px] sm:text-[11px] text-zinc-400 font-heading mb-3">
                  Master a weapon here to reduce bullets needed when attacking with it (up to 10% at full mastery). Guns are ordered weakest → strongest. Train guns you own; each must reach 100% before the next stronger gun you own. Weapons you don&apos;t own never block progress.
                </p>
                {masteryData?.weapons?.length
                  ? (
                      <div className="space-y-2">
                        {masteryData.weapons.map((w) => {
                          if (w.id === 'weapon1') return null;
                          const info = masteryData.mastery?.[w.id] || { mastery_pct: 0 };
                          const pct = Number(info.mastery_pct) || 0;
                          const canTrain = info.can_train !== false;
                          const owned = weaponsList.some((x) => x.id === w.id && x.owned);
                          const training = trainingWeaponId === w.id;
                          const cooldownLabel = formatMasteryTrainCooldownLabel(info.next_train_at);
                          const onCooldown = Boolean(cooldownLabel);
                          const disabled = !owned || training || pct >= 100 || !canTrain || onCooldown;
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
                                disabled={disabled}
                                title={
                                  onCooldown
                                    ? '5 min cooldown after each train on this weapon'
                                    : !canTrain
                                      ? 'Master weaker owned guns to 100% first (in list order)'
                                      : undefined
                                }
                                onClick={() => trainWeapon(w.id)}
                                className="px-2 py-1 rounded text-[9px] sm:text-[10px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                              >
                                {training
                                  ? 'Training...'
                                  : pct >= 100
                                    ? 'Mastered'
                                    : !canTrain
                                      ? 'Master previous first'
                                      : cooldownLabel
                                        ? `Wait ${cooldownLabel}`
                                        : 'Train 5 min'}
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
          )}

          {activeTab === 'production' && (!hasOwner || isOwner) && (
            <div className="space-y-3 sm:space-y-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <StatCard
                  icon={User}
                  label="Owner"
                  value={hasOwner ? (
                    <Link to={`/profile/${encodeURIComponent(data.owner_username)}`} className="text-primary hover:underline flex items-center gap-1 text-[10px] sm:text-xs">
                      <Shield size={10} className="shrink-0 sm:w-3 sm:h-3" />
                      <span className="truncate">{data.owner_username}</span>
                    </Link>
                  ) : (
                    <span className="text-zinc-400 italic text-[10px] sm:text-xs">Unclaimed</span>
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
                      <span className="text-[8px] sm:text-[9px] text-zinc-500 font-normal">/ea</span>
                    </>
                  }
                  highlight
                />
                
                <StatCard
                  icon={Flame}
                  label={hasOwner ? 'Status' : 'Claim Cost'}
                  value={hasOwner ? (
                    <span className="text-green-400 flex items-center gap-1 text-[10px] sm:text-xs">
                      <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-green-400 inline-block" /> Active
                    </span>
                  ) : (
                    formatMoney(claimCost)
                  )}
                />
              </div>

              {/* Production Gauges - 3 Columns */}
              {isOwner && (
                <div className="rounded-lg p-2.5 sm:p-3 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
                  <div className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Gauge size={10} className="sm:w-[11px] sm:h-[11px]" />
                    Production Overview
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-3">
                    {/* Bullets Gauge */}
                    <div className="rounded-lg p-2 sm:p-2.5 bg-zinc-900/50 border border-zinc-700/30">
                      <div className="text-center mb-2">
                        <div className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                          <Crosshair size={9} className="sm:w-2.5 sm:h-2.5" />
                          Bullets
                        </div>
                        <ProductionGauge production={production} maxProduction={productionPer24h / 24} />
                      </div>
                      <div className="text-center space-y-0.5">
                        <p className="text-[10px] sm:text-xs font-heading font-bold text-primary">
                          <AnimatedCounter target={accumulated} />
                        </p>
                        <p className="text-[8px] sm:text-[9px] text-zinc-500 font-heading">in stock</p>
                        <p className="text-[8px] sm:text-[9px] text-emerald-400 font-heading">{production.toFixed(0)}/hr</p>
                      </div>
                    </div>

                    {/* Armour Gauge */}
                    <div className="rounded-lg p-2 sm:p-2.5 bg-zinc-900/50 border border-zinc-700/30">
                      <div className="text-center mb-2">
                        <div className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                          <Shield size={9} className="sm:w-2.5 sm:h-2.5" />
                          Armour
                        </div>
                        <ProductionGauge production={armourProductionRate} maxProduction={data?.armour_rate_per_hour ?? 5} />
                      </div>
                      <div className="text-center space-y-0.5">
                        <p className="text-[10px] sm:text-xs font-heading font-bold text-primary">
                          {armourStock} units
                        </p>
                        <p className="text-[8px] sm:text-[9px] text-zinc-500 font-heading">
                          {armourHoursRemaining > 0 ? `${armourHoursRemaining.toFixed(1)}h left` : 'idle'}
                        </p>
                        <p className="text-[8px] sm:text-[9px] text-emerald-400 font-heading">
                          {armourProductionRate > 0 ? `${armourProductionRate}/hr` : 'stopped'}
                        </p>
                      </div>
                    </div>

                    {/* Weapons Gauge */}
                    <div className="rounded-lg p-2 sm:p-2.5 bg-zinc-900/50 border border-zinc-700/30">
                      <div className="text-center mb-2">
                        <div className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                          <Swords size={9} className="sm:w-2.5 sm:h-2.5" />
                          Weapons
                        </div>
                        <ProductionGauge production={weaponProductionRate} maxProduction={data?.weapon_rate_per_hour ?? 5} />
                      </div>
                      <div className="text-center space-y-0.5">
                        <p className="text-[10px] sm:text-xs font-heading font-bold text-primary">
                          {weaponStock} units
                        </p>
                        <p className="text-[8px] sm:text-[9px] text-zinc-500 font-heading">
                          {weaponHoursRemaining > 0 ? `${weaponHoursRemaining.toFixed(1)}h left` : 'idle'}
                        </p>
                        <p className="text-[8px] sm:text-[9px] text-emerald-400 font-heading">
                          {weaponProductionRate > 0 ? `${weaponProductionRate}/hr` : 'stopped'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Info Text */}
                  <div className="rounded-lg p-2 sm:p-2.5 bg-primary/5 border border-primary/20 mb-3">
                    <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading leading-relaxed">
                      <strong className="text-primary">Rate:</strong> 5/hr per item · 
                      <strong className="text-primary"> Max Stock:</strong> 15/item · 
                      <strong className="text-primary"> Duration:</strong> 1hr batches · 
                      <strong className="text-primary"> Markup:</strong> 35%
                    </p>
                  </div>

                  {/* Detailed Stock Breakdown */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="rounded bg-zinc-900/50 p-2 border border-zinc-700/30">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Shield size={10} className="text-zinc-500 sm:w-[11px] sm:h-[11px]" />
                        <p className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase">Armour Stock</p>
                      </div>
                      <div className="text-[9px] sm:text-[10px] font-heading text-foreground space-y-0.5">
                        {Object.entries(data?.armour_stock || {}).filter(([, q]) => Number(q || 0) > 0).length > 0
                          ? Object.entries(data.armour_stock).filter(([, q]) => Number(q || 0) > 0).map(([lv, q]) => (
                              <div key={lv} className="flex justify-between">
                                <span className="text-zinc-500">Level {lv}:</span>
                                <span className="text-primary font-bold">{Number(q)}</span>
                              </div>
                            ))
                          : <span className="text-zinc-600 italic">No stock</span>}
                      </div>
                    </div>

                    <div className="rounded bg-zinc-900/50 p-2 border border-zinc-700/30">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Swords size={10} className="text-zinc-500 sm:w-[11px] sm:h-[11px]" />
                        <p className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase">Weapon Stock</p>
                      </div>
                      <div className="text-[9px] sm:text-[10px] font-heading text-foreground">
                        {Object.entries(data?.weapon_stock || {}).filter(([, q]) => Number(q || 0) > 0).length > 0
                          ? (
                              <div className="flex justify-between">
                                <span className="text-zinc-500">Total:</span>
                                <span className="text-primary font-bold">
                                  {weaponStock} units
                                </span>
                              </div>
                            )
                          : <span className="text-zinc-600 italic">No stock</span>}
                      </div>
                    </div>
                  </div>

                  {/* Production Buttons - Enhanced */}
                  <div className="space-y-2">
                    <p className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase tracking-widest">Start Production (1 hour)</p>
                    
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
                            className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded text-[10px] sm:text-xs font-heading font-bold border transition-all flex items-center justify-center gap-1.5 ${
                              isProducing
                                ? 'bg-primary/10 border-primary/40 text-primary/60 cursor-not-allowed'
                                : canAfford
                                ? 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 active:scale-95'
                                : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-600 cursor-not-allowed'
                            } disabled:opacity-50`}
                          >
                            <Shield size={12} className="sm:w-3.5 sm:h-3.5" />
                            <div className="flex flex-col items-start text-left">
                              <span className="text-[9px] sm:text-[10px] leading-tight">
                                {isProducing ? 'Producing...' : 'All Armour (5 lvls)'}
                              </span>
                              <span className="text-[8px] sm:text-[9px] opacity-75">{parts.join(' + ') || '—'}</span>
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
                            className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded text-[10px] sm:text-xs font-heading font-bold border transition-all flex items-center justify-center gap-1.5 ${
                              isProducing
                                ? 'bg-zinc-800/50 border-zinc-600/50 text-zinc-500 cursor-not-allowed'
                                : canAfford
                                ? 'bg-zinc-800/50 border-zinc-600/50 text-foreground hover:border-primary/40 active:scale-95'
                                : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-600 cursor-not-allowed'
                            } disabled:opacity-50`}
                          >
                            <Swords size={12} className="sm:w-3.5 sm:h-3.5" />
                            <div className="flex flex-col items-start text-left">
                              <span className="text-[9px] sm:text-[10px] leading-tight">
                                {isProducing ? 'Producing...' : 'All Weapons'}
                              </span>
                              <span className="text-[8px] sm:text-[9px] opacity-75">{parts.join(' + ') || '—'}</span>
                            </div>
                          </button>
                        );
                      })()}
                    </div>

                    {/* Single tier / single weapon (1 hr each) — pay only what you start */}
                    {(data?.armour_produce_tier_costs?.length > 0 || data?.weapon_produce_costs?.length > 0) && (
                      <div className="space-y-2 pt-2 border-t border-zinc-700/40">
                        <p className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase tracking-widest">
                          Or produce one item (1 hr)
                        </p>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div className="rounded bg-zinc-900/40 p-2 border border-zinc-700/30 space-y-1.5">
                            <p className="text-[8px] text-zinc-500 font-heading uppercase">Armour by level</p>
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
                                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[9px] sm:text-[10px] font-heading border ${
                                    busy
                                      ? 'border-amber-700/40 text-amber-500/80 cursor-not-allowed'
                                      : canAffordOne
                                        ? 'border-zinc-600/50 text-foreground hover:border-primary/40'
                                        : 'border-zinc-700/30 text-zinc-600 cursor-not-allowed'
                                  } disabled:opacity-50`}
                                >
                                  <span>Lv.{row.level}{busy ? ` (${hrs.toFixed(1)}h left)` : ''}</span>
                                  <span className="text-zinc-400 truncate">{producingArmourLevel === row.level ? '…' : label}</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="rounded bg-zinc-900/40 p-2 border border-zinc-700/30 space-y-1.5 max-h-56 overflow-y-auto">
                            <p className="text-[8px] text-zinc-500 font-heading uppercase sticky top-0 bg-zinc-900/95 pb-1">Weapons (one at a time)</p>
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
                                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[8px] sm:text-[9px] font-heading border ${
                                    busy
                                      ? 'border-amber-700/40 text-amber-500/80 cursor-not-allowed'
                                      : canAffordOne
                                        ? 'border-zinc-600/50 text-foreground hover:border-primary/40'
                                        : 'border-zinc-700/30 text-zinc-600 cursor-not-allowed'
                                  } disabled:opacity-50`}
                                >
                                  <span className="truncate text-left">{shortName}{busy ? ` (${hrs.toFixed(1)}h)` : ''}</span>
                                  <span className="text-zinc-400 shrink-0">{producingWeaponOneId === w.id ? '…' : label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bullet Price & Claim */}
              {isOwner && (
                <>
                  <div className="rounded-lg p-2.5 sm:p-3 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
                    <div className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Crosshair size={10} className="sm:w-[11px] sm:h-[11px]" />
                      Set Sell Price
                    </div>
                    <form onSubmit={setPrice} className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
                        <input
                          type="number"
                          min={priceMin}
                          max={priceMax}
                          placeholder={pricePerBullet != null ? String(pricePerBullet) : 'Price'}
                          value={priceInput}
                          onChange={(e) => setPriceInput(e.target.value)}
                          className="w-full pl-5 pr-2 py-1.5 sm:py-2 bg-zinc-900/80 border border-zinc-600/40 rounded text-foreground font-heading text-xs sm:text-sm focus:border-primary/50 focus:outline-none"
                        />
                      </div>
                      <span className="text-[9px] sm:text-[10px] text-zinc-500 shrink-0">/bullet</span>
                      <button
                        type="submit"
                        disabled={settingPrice}
                        className="px-3 sm:px-4 py-1.5 sm:py-2 bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-[10px] sm:text-xs uppercase rounded hover:bg-primary/30 active:scale-95 disabled:opacity-50 transition-all"
                      >
                        {settingPrice ? '...' : 'Set'}
                      </button>
                    </form>
                    {pricePerBullet != null && (
                      <p className="text-[9px] sm:text-[10px] text-zinc-500 mt-1.5">Current: {formatMoney(pricePerBullet)}/bullet</p>
                    )}
                  </div>

                  {(data?.armour_money_price_defaults?.length > 0 || data?.weapon_money_price_defaults?.length > 0) && (
                    <div className="rounded-lg p-2.5 sm:p-3 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40">
                      <div className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <Package size={10} className="sm:w-[11px] sm:h-[11px]" />
                        Cash list prices (armour L1–3 & money guns)
                      </div>
                      <p className="text-[8px] sm:text-[9px] text-zinc-500 mb-2 font-heading">
                        List price before event multiplier. Points armour (L4–5) and points weapons stay on the default formula. Max{' '}
                        {formatMoney(data?.armoury_item_money_price_max ?? 5_000_000)} each. Clear a field + save to reset to default.
                      </p>
                      <form onSubmit={saveItemPrices} className="space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <p className="text-[8px] text-zinc-600 font-heading uppercase">Armour (cash tiers)</p>
                            {(data?.armour_money_price_defaults || []).map((d) => (
                              <label key={d.level} className="flex items-center gap-2 text-[9px] sm:text-[10px] font-heading">
                                <span className="text-zinc-500 w-14 shrink-0">L{d.level}</span>
                                <span className="text-zinc-600 truncate flex-1" title={d.name}>{d.name}</span>
                                <span className="text-zinc-600">$</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={data?.armoury_item_money_price_max ?? 5_000_000}
                                  value={armourPriceInputs[d.level] ?? ''}
                                  onChange={(e) => setArmourPriceInputs((prev) => ({ ...prev, [d.level]: e.target.value }))}
                                  className="w-24 sm:w-28 px-1.5 py-1 bg-zinc-900/80 border border-zinc-600/40 rounded text-foreground text-[9px] sm:text-[10px]"
                                />
                              </label>
                            ))}
                          </div>
                          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                            <p className="text-[8px] text-zinc-600 font-heading uppercase sticky top-0 bg-zinc-900/0">Weapons (cash)</p>
                            {(data?.weapon_money_price_defaults || []).map((d) => (
                              <label key={d.id} className="flex items-center gap-2 text-[8px] sm:text-[9px] font-heading">
                                <span className="text-zinc-600 truncate flex-1" title={d.name}>{d.name}</span>
                                <span className="text-zinc-600">$</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={data?.armoury_item_money_price_max ?? 5_000_000}
                                  value={weaponPriceInputs[d.id] ?? ''}
                                  onChange={(e) => setWeaponPriceInputs((prev) => ({ ...prev, [d.id]: e.target.value }))}
                                  className="w-24 sm:w-28 px-1.5 py-1 bg-zinc-900/80 border border-zinc-600/40 rounded text-foreground"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={settingItemPrices}
                          className="w-full sm:w-auto px-3 py-1.5 bg-primary/15 border border-primary/45 text-primary font-heading font-bold text-[9px] sm:text-[10px] uppercase rounded hover:bg-primary/25 disabled:opacity-50"
                        >
                          {settingItemPrices ? 'Saving…' : 'Save item prices'}
                        </button>
                      </form>
                    </div>
                  )}
                </>
              )}

              {!hasOwner && (
                <div className="rounded-lg p-3 sm:p-4 bg-gradient-to-br from-zinc-800/60 to-zinc-800/40 border border-zinc-700/40 relative overflow-hidden">
                  <div className="absolute -bottom-6 -right-6 w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-orange-500/20 animate-furnace pointer-events-none" />
                  
                  <div className="relative z-10 space-y-3">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <ProductionGauge production={production} />
                      
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Gauge size={11} className="text-primary sm:w-3 sm:h-3" />
                          <span className="text-[9px] sm:text-[10px] text-zinc-500 font-heading uppercase tracking-widest">Production Info</span>
                        </div>
                        
                        <p className="text-[10px] sm:text-xs text-zinc-400 font-heading leading-relaxed">
                          Produces <strong className="text-primary">{productionPer24h.toLocaleString()}</strong> bullets per 24h (every {productionTickMins} min).
                          {!hasOwner && claimCost > 0 && (
                            <span className="block mt-1">
                              Pay <strong className="text-primary">{formatMoney(claimCost)}</strong> to claim ownership.
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Claim Button */}
                    <button
                      type="button"
                      onClick={claim}
                      disabled={claiming || !canAffordClaim}
                      className={`w-full flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 font-heading font-bold text-[10px] sm:text-xs uppercase tracking-wider rounded border-2 transition-all ${
                        canAffordClaim
                          ? 'bg-gradient-to-b from-primary/30 to-primary/10 border-primary/60 text-primary hover:from-primary/40 hover:shadow-lg active:scale-95'
                          : 'bg-zinc-800/50 border-zinc-600/30 text-zinc-500 cursor-not-allowed'
                      } disabled:opacity-50`}
                    >
                      <Factory size={16} className="sm:w-[18px] sm:h-[18px]" />
                      {claiming ? 'Claiming...' : canAffordClaim ? `Claim Armoury — ${formatMoney(claimCost)}` : `Need ${formatMoney(claimCost)}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom warning stripe */}
        <div className="armoury-stripe h-1.5 sm:h-2" style={{
          background: 'repeating-linear-gradient(135deg, var(--noir-primary) 0px, var(--noir-primary) 6px, #1a1a1a 6px, #1a1a1a 12px)',
          opacity: 0.6,
        }} />
      </div>
    </div>
  );
}
