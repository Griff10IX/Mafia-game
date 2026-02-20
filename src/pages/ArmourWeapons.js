import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Swords, Check, Lock, Factory, Package, User, ShoppingCart, Flame, Gauge, Crosshair } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const AW_STYLES = `
  @keyframes aw-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .aw-fade-in { animation: aw-fade-in 0.4s ease-out both; }
  .aw-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .aw-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const formatMoney = (n) => `$${Number(n ?? 0).toLocaleString()}`;

const formatCost = (opt, useEffective = true) => {
  const money = useEffective && opt.effective_cost_money != null ? opt.effective_cost_money : opt.cost_money;
  const points = useEffective && opt.effective_cost_points != null ? opt.effective_cost_points : opt.cost_points;
  if (points != null) return `${points.toLocaleString()} pts`;
  if (money != null) return formatMoney(money);
  return '—';
};

const formatWeaponCost = (w, useEffective = true) => {
  const money = useEffective && w.effective_price_money != null ? w.effective_price_money : w.price_money;
  const points = useEffective && w.effective_price_points != null ? w.effective_price_points : w.price_points;
  if (points != null) return `${points.toLocaleString()} pts`;
  if (money != null) return formatMoney(money);
  return '—';
};

// Tab component
const Tab = ({ active, onClick, icon: Icon, children }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider transition-all border-b-2 ${
      active
        ? 'text-primary border-primary bg-primary/5'
        : 'text-mutedForeground border-transparent hover:text-foreground hover:border-primary/30'
    }`}
  >
    <Icon size={14} />
    {children}
  </button>
);

/* ═══ Bullet Factory (inlined) ═══ */
const QUICK_BUYS = [100, 500, 1000, 2000, 3000];
const ITEM_WIDTH = 32;

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
        <path
          d="M4 2 L8 2 L8 5 L12 5 L12 2 L16 2 L16 6 L18 8 L18 14 Q18 17 10 17 Q2 17 2 14 L2 8 L4 6 Z"
          fill="url(#belt-vest-fabric)"
          stroke="url(#belt-armour-edge)"
          strokeWidth="0.5"
        />
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
    <div className="relative w-24 h-24 sm:w-28 sm:h-28 mx-auto">
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
        <line x1="50" y1="50" x2={needle.x} y2={needle.y}
          stroke="#d4af37" strokeWidth="2" strokeLinecap="round"
          style={{ transition: 'all 1s ease-out' }}
        />
        <circle cx="50" cy="50" r="4" fill="#d4af37" />
        <circle cx="50" cy="50" r="2" fill="#1a1a1a" />
        <defs>
          <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d4af37" />
            <stop offset="60%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
        <div className="text-[10px] text-zinc-500 font-heading uppercase">Per Hour</div>
        <div className="text-sm sm:text-base font-heading font-bold text-primary">{production.toLocaleString()}</div>
      </div>
    </div>
  );
}

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

const FactoryTab = ({ active, onClick, icon: Icon, children }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-heading font-bold uppercase tracking-wider transition-all border-b-2 ${
      active ? 'text-primary border-primary bg-primary/5' : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-primary/30'
    }`}
  >
    <Icon size={12} />
    {children}
  </button>
);

function BulletFactoryTab({ me, ownedArmouryState }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('shop');
  const [claiming, setClaiming] = useState(false);
  const [settingPrice, setSettingPrice] = useState(false);
  const [buying, setBuying] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  const [producingArmour, setProducingArmour] = useState(false);
  const [producingWeapon, setProducingWeapon] = useState(false);
  const [armourOptions, setArmourOptions] = useState([]);
  const [weaponsList, setWeaponsList] = useState([]);
  const [buyingArmourLevel, setBuyingArmourLevel] = useState(null);
  const [buyingWeaponId, setBuyingWeaponId] = useState(null);

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
    if (!data || activeTab !== 'production') return;
    const fs = (data.state || '').toLowerCase();
    const inCity = fs && (currentState || '').toLowerCase() === fs;
    const hasOwner = !!data.owner_id;
    const isOwner = data.is_owner === true;
    const show = inCity && (isOwner || !hasOwner);
    if (!show) setActiveTab('shop');
  }, [data, activeTab, currentState]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      try {
        const [armourRes, weaponsRes] = await Promise.all([
          api.get('/armour/options'),
          api.get('/weapons'),
        ]);
        if (!cancelled && armourRes.data?.options) setArmourOptions(armourRes.data.options);
        if (!cancelled && Array.isArray(weaponsRes.data)) setWeaponsList(weaponsRes.data);
      } catch {
        if (!cancelled) setArmourOptions([]);
        if (!cancelled) setWeaponsList([]);
      }
    })();
    return () => { cancelled = true; };
  }, [data]);

  const claim = async () => {
    setClaiming(true);
    try {
      await api.post('/bullet-factory/claim', { state: data?.state || currentState });
      toast.success('You now own the Bullet Factory!');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim factory');
    } finally {
      setClaiming(false);
    }
  };

  const buyArmour = async (level) => {
    setBuyingArmourLevel(level);
    try {
      const state = data?.state || effectiveState || currentState;
      const res = await api.post('/armour/buy', { level, ...(state ? { state } : {}) });
      toast.success(res.data?.message || 'Purchased armour');
      refreshUser();
      fetchData();
      if (armourOptions.length) {
        const optsRes = await api.get('/armour/options', { params: state ? { state } : {} });
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
      const state = data?.state || effectiveState || currentState;
      await api.post(`/weapons/${weaponId}/buy`, { currency, ...(state ? { state } : {}) });
      toast.success('Weapon purchased');
      refreshUser();
      fetchData();
      const weaponsRes = await api.get('/weapons', { params: state ? { state } : {} });
      if (Array.isArray(weaponsRes.data)) setWeaponsList(weaponsRes.data);
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(Array.isArray(detail) ? detail[0]?.msg || 'Failed to buy weapon' : detail || 'Failed to buy weapon');
    } finally {
      setBuyingWeaponId(null);
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

  const startArmourProduction = async (level) => {
    setProducingArmour(true);
    try {
      const res = await api.post('/bullet-factory/start-armour-production', { level, state: data?.state || currentState });
      toast.success(res.data?.message || 'Armour production started');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start armour production');
    } finally {
      setProducingArmour(false);
    }
  };

  const startWeaponProduction = async (weaponId) => {
    setProducingWeapon(true);
    try {
      const res = await api.post('/bullet-factory/start-weapon-production', { weapon_id: weaponId, state: data?.state || currentState });
      toast.success(res.data?.message || 'Weapon production started');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start weapon production');
    } finally {
      setProducingWeapon(false);
    }
  };

  const startArmourProductionAll = async () => {
    setProducingArmour(true);
    try {
      const res = await api.post('/bullet-factory/start-armour-production-all', { state: data?.state || currentState });
      toast.success(res.data?.message || 'Produce all armour started');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to produce all armour');
    } finally {
      setProducingArmour(false);
    }
  };

  const startWeaponProductionAll = async () => {
    setProducingWeapon(true);
    try {
      const res = await api.post('/bullet-factory/start-weapon-production-all', { state: data?.state || currentState });
      toast.success(res.data?.message || 'Produce all weapons started');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to produce all weapons');
    } finally {
      setProducingWeapon(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary font-heading text-sm uppercase tracking-widest">Loading Factory...</span>
        </div>
      </div>
    );
  }

  const hasOwner = !!data?.owner_id;
  const isOwner = data?.is_owner ?? false;
  const factoryState = (data?.state || '').toLowerCase();
  const inArmouryCity = factoryState && (currentState || '').toLowerCase() === factoryState;
  const showProductionTab = inArmouryCity && (isOwner || !hasOwner);
  const canBuy = data?.can_buy ?? false;
  const accumulated = data?.accumulated_bullets ?? 0;
  const productionPer24h = data?.production_per_24h ?? 5000;
  const productionTickMins = data?.production_tick_minutes ?? 20;
  const production = data?.production_per_hour ?? productionPer24h / 24;
  const claimCost = data?.claim_cost ?? 0;
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

  return (
    <div className="space-y-4 relative" data-testid="bullet-factory-tab">
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
        @keyframes factory-particle {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          100% { transform: translateY(-300px) rotate(var(--r, 180deg)) scale(0.3); opacity: 0; }
        }
        .animate-factory-particle { animation: factory-particle ease-out forwards; }
        @keyframes stamp {
          0% { transform: scale(2) rotate(-15deg); opacity: 0; }
          50% { transform: scale(1.1) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        .animate-stamp { animation: stamp 0.5s cubic-bezier(0.2, 0.8, 0.3, 1.1) forwards; }
        @keyframes smoke-rise {
          0% { transform: translateY(0) scaleX(1); opacity: 0.5; }
          100% { transform: translateY(-40px) scaleX(2); opacity: 0; }
        }
        .animate-smoke { animation: smoke-rise 3s ease-out infinite; }
      `}</style>


      {/* Factory Header — industrial steel plate */}
      <div className="relative rounded-xl overflow-hidden" style={{
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a28 30%, #1e1e1c 70%, #141414 100%)',
        border: '2px solid #3a3a38',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>
        {/* Rivets */}
        {[{ t: 8, l: 8 }, { t: 8, r: 8 }, { b: 8, l: 8 }, { b: 8, r: 8 }].map((pos, i) => (
          <div key={i} className="absolute w-3 h-3 rounded-full z-10" style={{
            ...pos,
            background: 'radial-gradient(circle at 40% 30%, #666, #333)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.1)',
          }} />
        ))}

        {/* Warning stripes top bar */}
        <div className="h-2" style={{
          background: 'repeating-linear-gradient(135deg, #d4af37 0px, #d4af37 8px, #1a1a1a 8px, #1a1a1a 16px)',
          opacity: 0.6,
        }} />

        {/* Title bar */}
        <div className="px-4 py-3 flex items-center gap-3 border-b border-zinc-700/50">
          <div className="relative">
            <Factory size={24} className="text-primary" />
            <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-heading font-bold text-primary tracking-wider uppercase">
              Bullet Factory
            </h1>
            <p className="text-[10px] text-zinc-500 font-heading uppercase tracking-widest">
              {data?.state || 'Unknown'} — Industrial Arms Manufacturing
            </p>
          </div>
          {/* Smoke stacks */}
          <div className="hidden sm:flex items-end gap-1 mr-2">
            {[0, 0.5, 0.2].map((d, i) => (
              <div key={i} className="relative">
                <div className="w-3 rounded-t" style={{ height: 16 + i * 6, background: 'linear-gradient(180deg, #555 0%, #333 100%)' }} />
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-zinc-500/30 animate-smoke"
                  style={{ animationDelay: `${d}s` }} />
              </div>
            ))}
          </div>
        </div>

        {/* Conveyor Belt */}
        <div className="px-4 pt-3">
          <ConveyorBelt />
        </div>

        {/* Tabs: Shop (everyone), Production (only when in this armoury's city and you own it or it's unclaimed) */}
        <div className="flex border-b border-zinc-700/50 px-4">
          <FactoryTab active={activeTab === 'shop'} onClick={() => setActiveTab('shop')} icon={ShoppingCart}>
            Shop
          </FactoryTab>
          {showProductionTab && (
            <FactoryTab active={activeTab === 'production'} onClick={() => setActiveTab('production')} icon={Factory}>
              Production
            </FactoryTab>
          )}
        </div>

        {/* Tab content */}
        {activeTab === 'shop' && (
        <div className="p-4 space-y-4">
          {/* Buy Bullets */}
          {canBuy && pricePerBullet != null && (
            <div className="rounded-lg p-3" style={{
              background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
              border: '1px solid #3a3a38',
            }}>
              <div className="text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Crosshair size={11} />
                Buy Bullets
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <p className="text-[10px] text-zinc-500 mb-1">Max {buyMaxPerPurchase.toLocaleString()} per purchase, once every {buyCooldownMinutes} min</p>
                {QUICK_BUYS.filter((amt) => amt <= buyMaxPerPurchase).map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setBuyAmount(String(Math.min(amt, effectiveBuyMax)))}
                    disabled={inBuyCooldown || amt > effectiveBuyMax}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-heading font-bold border transition-all ${
                      buyAmountNum === amt
                        ? 'bg-primary/25 border-primary/60 text-primary shadow-sm shadow-primary/10'
                        : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-50'
                    }`}
                  >
                    {amt.toLocaleString()}
                  </button>
                ))}
              </div>
              <form onSubmit={buyBullets} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={effectiveBuyMax}
                    placeholder={`Up to ${effectiveBuyMax.toLocaleString()}`}
                    value={buyAmount}
                    onChange={(e) => setBuyAmount(e.target.value)}
                    className="flex-1 min-w-[100px] px-3 py-2 bg-zinc-900/80 border border-zinc-600/40 rounded-lg text-foreground font-heading text-sm focus:border-primary/50 focus:outline-none transition-colors"
                  />
                </div>
                {buyAmountNum > 0 && (
                  <div className="flex items-center justify-between text-[11px] font-heading px-1">
                    <span className="text-zinc-500">{buyAmountNum.toLocaleString()} x {formatMoney(pricePerBullet)}</span>
                    <span className="text-primary font-bold">= {formatMoney(buyTotal)}</span>
                  </div>
                )}
                {inBuyCooldown && (
                  <p className="text-[11px] text-amber-500/90 font-heading">Next purchase in {minutesUntilCanBuy} min</p>
                )}
                <button
                  type="submit"
                  disabled={buying || buyAmountNum <= 0 || !canAffordBuy || buyAmountNum > effectiveBuyMax || inBuyCooldown}
                  className={`w-full px-4 py-2.5 font-heading font-bold text-xs uppercase rounded-lg border-2 transition-all ${
                    canAffordBuy && buyAmountNum > 0 && buyAmountNum <= effectiveBuyMax && !inBuyCooldown
                      ? 'bg-gradient-to-b from-emerald-900/40 to-emerald-900/20 border-emerald-600/50 text-emerald-400 hover:from-emerald-900/50 hover:border-emerald-500/60'
                      : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 cursor-not-allowed'
                  } disabled:opacity-50`}
                >
                  {buying ? 'Buying...' : `Buy ${buyAmountNum > 0 ? buyAmountNum.toLocaleString() : ''} Bullets`}
                </button>
              </form>
              <p className="text-[10px] text-zinc-500 mt-1.5">{accumulated.toLocaleString()} in stock (max {buyMaxPerPurchase.toLocaleString()} per purchase)</p>
            </div>
          )}

          {hasOwner && !isOwner && (pricePerBullet == null || accumulated === 0) && (
            <div className="rounded-lg p-3 text-center" style={{
              background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
              border: '1px solid #3a3a38',
            }}>
              <p className="text-[11px] text-zinc-500 font-heading">
                {pricePerBullet == null ? 'Owner has not set a price yet.' : 'No bullets in stock right now.'}
              </p>
            </div>
          )}

          {/* Buy Armour */}
          <div className="rounded-lg p-3" style={{
            background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
            border: '1px solid #3a3a38',
          }}>
            <div className="text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Shield size={11} />
              Buy Armour
            </div>
            <div className="flex flex-wrap gap-1.5">
              {armourOptions.length
                ? armourOptions.map((opt) => {
                    const cost = opt.effective_cost_money != null ? opt.effective_cost_money : opt.effective_cost_points;
                    const isPoints = opt.effective_cost_points != null;
                    const canAffordArmour = opt.affordable && !opt.owned;
                    return (
                      <button
                        key={opt.level}
                        type="button"
                        disabled={opt.owned || buyingArmourLevel != null || !canAffordArmour}
                        onClick={() => buyArmour(opt.level)}
                        className="px-2.5 py-1.5 rounded text-[10px] font-heading font-bold border bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {opt.owned ? `Lv.${opt.level} Owned` : `Lv.${opt.level} ${isPoints ? `${Number(cost).toLocaleString()} pts` : formatMoney(cost)}`}
                      </button>
                    );
                  })
                : <span className="text-[10px] text-zinc-500">Loading...</span>}
            </div>
          </div>

          {/* Buy Weapons */}
          <div className="rounded-lg p-3" style={{
            background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
            border: '1px solid #3a3a38',
          }}>
            <div className="text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Swords size={11} />
              Buy Weapons
            </div>
            <div className="flex flex-wrap gap-1.5">
              {weaponsList.length
                ? weaponsList.slice(0, 8).map((w) => {
                    const priceMoney = w.effective_price_money ?? w.price_money;
                    const pricePoints = w.effective_price_points ?? w.price_points;
                    const canAffordMoney = priceMoney != null && (me?.money ?? 0) >= priceMoney;
                    const canAffordPoints = pricePoints != null && (me?.points ?? 0) >= pricePoints;
                    const canBuyW = !w.owned && !w.locked && (canAffordMoney || canAffordPoints);
                    const usePoints = canBuyW && pricePoints != null && (canAffordPoints || !canAffordMoney);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        disabled={w.owned || w.locked || buyingWeaponId != null || !canBuyW}
                        onClick={() => buyWeapon(w.id, usePoints ? 'points' : 'money')}
                        className="px-2.5 py-1.5 rounded text-[10px] font-heading border bg-zinc-800/50 border-zinc-600/50 text-foreground hover:border-primary/40 truncate max-w-[130px] disabled:opacity-50 disabled:cursor-not-allowed"
                        title={w.name}
                      >
                        {w.owned ? `${w.name?.replace(/\s*\(.*\)/, '')} ✓` : (w.name?.replace(/\s*\(.*\)/, '') || w.id) + (pricePoints != null ? ` ${Number(pricePoints).toLocaleString()} pts` : ` ${formatMoney(priceMoney)}`)}
                      </button>
                    );
                  })
                : <span className="text-[10px] text-zinc-500">Loading...</span>}
            </div>
          </div>
        </div>
        )}

        {activeTab === 'production' && showProductionTab && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Left Column — Stats & Gauge */}
          <div className="space-y-4">
            {/* Production Gauge */}
            <div className="rounded-lg p-3" style={{
              background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
              border: '1px solid #3a3a38',
            }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Gauge size={12} className="text-primary" />
                <span className="text-[10px] text-zinc-500 font-heading uppercase tracking-widest">Production Rate</span>
              </div>
              <ProductionGauge production={production} />
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 gap-2">
              {/* Owner */}
              <div className="rounded-lg p-3 relative overflow-hidden" style={{
                background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                border: '1px solid #3a3a38',
              }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <User size={11} className="text-zinc-500" />
                  <span className="text-[9px] text-zinc-500 font-heading uppercase">Owner</span>
                </div>
                <div className="text-sm font-heading font-bold truncate">
                  {hasOwner ? (
                    <Link to={`/profile/${encodeURIComponent(data.owner_username)}`} className="text-primary hover:underline flex items-center gap-1">
                      <Shield size={12} className="shrink-0" />
                      {data.owner_username}
                    </Link>
                  ) : (
                    <span className="text-zinc-400 italic">Unclaimed</span>
                  )}
                </div>
              </div>

              {/* In stock (for sale) */}
              <div className="rounded-lg p-3 relative overflow-hidden" style={{
                background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                border: '1px solid #3a3a38',
              }}>
                {accumulated > 0 && (
                  <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary animate-pulse" />
                )}
                <div className="flex items-center gap-1.5 mb-1">
                  <Package size={11} className="text-zinc-500" />
                  <span className="text-[9px] text-zinc-500 font-heading uppercase">In stock</span>
                </div>
                <div className="text-sm font-heading font-bold text-foreground">
                  <AnimatedCounter target={accumulated} />
                </div>
              </div>

              {/* Price per bullet */}
              <div className="rounded-lg p-3" style={{
                background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                border: '1px solid #3a3a38',
              }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Crosshair size={11} className="text-zinc-500" />
                  <span className="text-[9px] text-zinc-500 font-heading uppercase">Price</span>
                </div>
                <div className="text-sm font-heading font-bold text-primary">
                  {pricePerBullet != null ? formatMoney(pricePerBullet) : '—'}
                  <span className="text-[9px] text-zinc-500 font-normal">/ea</span>
                </div>
              </div>

              {/* Claim cost */}
              <div className="rounded-lg p-3" style={{
                background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                border: '1px solid #3a3a38',
              }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Flame size={11} className="text-zinc-500" />
                  <span className="text-[9px] text-zinc-500 font-heading uppercase">{hasOwner ? 'Status' : 'Claim Cost'}</span>
                </div>
                <div className="text-sm font-heading font-bold text-foreground">
                  {hasOwner ? (
                    <span className="text-green-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Active
                    </span>
                  ) : (
                    formatMoney(claimCost)
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column — Actions */}
          <div className="space-y-3">

            {/* Furnace glow accent */}
            <div className="relative rounded-lg p-4 overflow-hidden" style={{
              background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
              border: '1px solid #3a3a38',
            }}>
              <div className="absolute -bottom-6 -right-6 w-32 h-32 rounded-full bg-orange-500/20 animate-furnace pointer-events-none" />

              <div className="relative z-10 space-y-3">
                <p className="text-xs text-zinc-400 font-heading leading-relaxed">
                  Produces <strong className="text-primary">{productionPer24h.toLocaleString()}</strong> bullets per 24 hours (every {productionTickMins} mins; sold from stock in Shop).
                  {!hasOwner && claimCost > 0 && (
                    <span> Pay <strong className="text-primary">{formatMoney(claimCost)}</strong> to claim ownership.</span>
                  )}
                </p>

                {/* Claim Button */}
                {!hasOwner && (
                  <button
                    type="button"
                    onClick={claim}
                    disabled={claiming || !canAffordClaim}
                    className="w-full relative overflow-hidden group"
                  >
                    <div className={`flex items-center justify-center gap-2 px-4 py-3 font-heading font-bold uppercase tracking-wider rounded-lg border-2 transition-all ${
                      canAffordClaim
                        ? 'bg-gradient-to-b from-primary/30 to-primary/10 border-primary/60 text-primary hover:from-primary/40 hover:to-primary/20 hover:shadow-lg hover:shadow-primary/10'
                        : 'bg-zinc-800/50 border-zinc-600/30 text-zinc-500 cursor-not-allowed'
                    } disabled:opacity-50`}>
                      <Factory size={18} />
                      {claiming ? 'Claiming...' : canAffordClaim ? `Claim Factory — ${formatMoney(claimCost)}` : `Need ${formatMoney(claimCost)}`}
                    </div>
                  </button>
                )}
              </div>
            </div>

            {/* Owner: Set Price */}
            {isOwner && (
              <div className="rounded-lg p-3" style={{
                background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                border: '1px solid #3a3a38',
              }}>
                <div className="text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Crosshair size={11} />
                  Set Sell Price
                </div>
                <form onSubmit={setPrice} className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[100px]">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
                    <input
                      type="number"
                      min={priceMin}
                      max={priceMax}
                      placeholder={pricePerBullet != null ? String(pricePerBullet) : 'Price'}
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      className="w-full pl-5 pr-2 py-2 bg-zinc-900/80 border border-zinc-600/40 rounded-lg text-foreground font-heading text-sm focus:border-primary/50 focus:outline-none transition-colors"
                    />
                  </div>
                  <span className="text-[10px] text-zinc-500 shrink-0">/bullet</span>
                  <button
                    type="submit"
                    disabled={settingPrice}
                    className="px-4 py-2 bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-xs uppercase rounded-lg hover:bg-primary/30 disabled:opacity-50 transition-all"
                  >
                    {settingPrice ? '...' : 'Set'}
                  </button>
                </form>
                {pricePerBullet != null && (
                  <p className="text-[10px] text-zinc-500 mt-1.5">Current: {formatMoney(pricePerBullet)} per bullet</p>
                )}
              </div>
            )}

            {/* Armoury: Produce armour & weapons (owner only) */}
            {isOwner && (
              <div className="rounded-lg p-3" style={{
                background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                border: '1px solid #3a3a38',
              }}>
                <div className="text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Shield size={11} />
                  Armoury — Produce (pay per hour, stock builds)
                </div>
                <p className="text-[10px] text-zinc-400 font-heading mb-2">
                  {(data?.armour_producing || data?.weapon_producing) ? (
                    <>Producing: {data.armour_producing && `${(data.armour_production_hours_remaining ?? 0).toFixed(1)}h armour (all levels)`}
                      {data.armour_producing && data.weapon_producing && ' · '}
                      {data.weapon_producing && `${(data.weapon_production_hours_remaining ?? 0).toFixed(1)}h weapons`}
                    </>
                  ) : (
                    `${data?.armour_rate_per_hour ?? 5}/hr per armour level, ${data?.weapon_rate_per_hour ?? 5}/hr per weapon. Max 15 per item. Produce all = 1 hr each; sell at 35% margin.`
                  )}
                </p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <p className="text-[9px] text-zinc-500 font-heading uppercase mb-1">Armour stock</p>
                    <div className="text-[11px] font-heading text-foreground">
                      {Object.entries(data?.armour_stock || {}).filter(([, q]) => q > 0).length
                        ? Object.entries(data.armour_stock).filter(([, q]) => q > 0).map(([lv, q]) => <span key={lv} className="mr-1.5">Lv.{lv}: {q}</span>)
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-500 font-heading uppercase mb-1">Weapon stock</p>
                    <div className="text-[11px] font-heading text-foreground">
                      {Object.entries(data?.weapon_stock || {}).filter(([, q]) => q > 0).length
                        ? Object.values(data.weapon_stock).reduce((a, b) => a + b, 0) + ' units'
                        : '—'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div>
                    <p className="text-[9px] text-zinc-500 font-heading mb-1">Produce all armour (1 hr per level)</p>
                    {(() => {
                      const costMoney = data?.produce_all_armour_cost_money ?? 0;
                      const costPoints = data?.produce_all_armour_cost_points ?? 0;
                      const canAfford = (me?.money ?? 0) >= costMoney && (me?.points ?? 0) >= costPoints;
                      const parts = [];
                      if (costMoney > 0) parts.push(formatMoney(costMoney));
                      if (costPoints > 0) parts.push(`${Number(costPoints).toLocaleString()} pts`);
                      return (
                        <button
                          type="button"
                          disabled={producingArmour || !canAfford}
                          onClick={startArmourProductionAll}
                          className="px-3 py-1.5 rounded text-[11px] font-heading font-bold border bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Produce all armour — {parts.length ? parts.join(' + ') : '—'}
                        </button>
                      );
                    })()}
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-500 font-heading mb-1">Produce all weapons (1 hr per weapon)</p>
                    {(() => {
                      const costMoney = data?.produce_all_weapons_cost_money ?? 0;
                      const costPoints = data?.produce_all_weapons_cost_points ?? 0;
                      const canAfford = (me?.money ?? 0) >= costMoney && (me?.points ?? 0) >= costPoints;
                      const parts = [];
                      if (costMoney > 0) parts.push(formatMoney(costMoney));
                      if (costPoints > 0) parts.push(`${Number(costPoints).toLocaleString()} pts`);
                      return (
                        <button
                          type="button"
                          disabled={producingWeapon || !canAfford}
                          onClick={startWeaponProductionAll}
                          className="px-3 py-1.5 rounded text-[11px] font-heading border bg-zinc-800/50 border-zinc-600/50 text-foreground hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Produce all weapons — {parts.length ? parts.join(' + ') : '—'}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
        )}

        {/* Warning stripes bottom bar */}
        <div className="h-2" style={{
          background: 'repeating-linear-gradient(135deg, #d4af37 0px, #d4af37 8px, #1a1a1a 8px, #1a1a1a 16px)',
          opacity: 0.6,
        }} />
      </div>
    </div>
  );
}



export default function ArmourWeapons() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [ownedArmouryState, setOwnedArmouryState] = useState(null);
  const [armouryViewingState, setArmouryViewingState] = useState(null); // state used for list/stock; send with buy so correct armoury decrements
  const [armourData, setArmourData] = useState({ current_level: 0, options: [] });
  const [weapons, setWeapons] = useState([]);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [buyingLevel, setBuyingLevel] = useState(null);
  const [equippingLevel, setEquippingLevel] = useState(null);
  const [buyingId, setBuyingId] = useState(null);
  const [activeTab, setActiveTab] = useState('armoury');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [meRes, eventsRes, myPropsRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/my-properties').catch(() => ({ data: { property: null } })),
      ]);
      const me = meRes.data;
      const prop = myPropsRes?.data?.property;
      const ownedState = prop?.type === 'bullet_factory' ? prop?.state ?? null : null;
      const effectiveState = ownedState || me?.current_state;
      const stateParams = effectiveState ? { state: effectiveState } : {};
      const [optRes, weaponsRes] = await Promise.all([
        api.get('/armour/options', { params: stateParams }),
        api.get('/weapons', { params: stateParams }),
      ]);
      setMe(me);
      setArmourData(optRes.data);
      setWeapons(weaponsRes.data || []);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
      setOwnedArmouryState(ownedState);
      setArmouryViewingState(effectiveState || null);
    } catch {
      toast.error('Failed to load armour & weapons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // Armour actions
  const buyArmour = async (level) => {
    setBuyingLevel(level);
    try {
      const state = armouryViewingState ?? ownedArmouryState ?? me?.current_state;
      const res = await api.post('/armour/buy', { level, ...(state ? { state } : {}) });
      toast.success(res.data.message || 'Purchased armour');
      refreshUser();
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to purchase armour');
    } finally {
      setBuyingLevel(null);
    }
  };

  const equipArmour = async (level) => {
    setEquippingLevel(level);
    try {
      const res = await api.post('/armour/equip', { level });
      toast.success(res.data.message || 'Armour equipped');
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to equip armour');
    } finally {
      setEquippingLevel(null);
    }
  };

  const unequipArmour = async () => {
    setEquippingLevel(0);
    try {
      const res = await api.post('/armour/unequip');
      toast.success(res.data.message || 'Armour unequipped');
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unequip armour');
    } finally {
      setEquippingLevel(null);
    }
  };

  const sellArmour = async () => {
    try {
      const res = await api.post('/armour/sell');
      toast.success(res.data?.message || 'Armour sold');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to sell armour');
    }
  };

  // Weapon actions
  const buyWeapon = async (weaponId, currency) => {
    setBuyingId(weaponId);
    try {
      const state = armouryViewingState ?? ownedArmouryState ?? me?.current_state;
      const response = await api.post(`/weapons/${weaponId}/buy`, { currency, ...(state ? { state } : {}) });
      toast.success(response.data.message);
      refreshUser();
      fetchAll();
    } catch (error) {
      const detail = error.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg || 'Failed' : 'Failed';
      toast.error(msg);
    } finally {
      setBuyingId(null);
    }
  };

  const equipWeapon = async (weaponId) => {
    setBuyingId(weaponId);
    try {
      const res = await api.post('/weapons/equip', { weapon_id: weaponId });
      toast.success(res.data.message || 'Weapon equipped');
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setBuyingId(null);
    }
  };

  const unequipWeapon = async () => {
    setBuyingId('unequip');
    try {
      const res = await api.post('/weapons/unequip');
      toast.success(res.data.message || 'Weapon unequipped');
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    } finally {
      setBuyingId(null);
    }
  };

  const sellWeapon = async (weaponId) => {
    setBuyingId(`sell-${weaponId}`);
    try {
      const res = await api.post(`/weapons/${weaponId}/sell`);
      toast.success(res.data?.message || 'Weapon sold');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setBuyingId(null);
    }
  };

  // Computed data
  const armourRows = useMemo(() => {
    return (armourData.options || []).map((o) => ({
      ...o,
      canBuy: !o.owned && !o.locked && o.affordable,
    }));
  }, [armourData.options]);

  const weaponRows = useMemo(() => {
    const money = Number(me?.money ?? 0);
    const points = Number(me?.points ?? 0);
    return (weapons || []).map((w) => {
      const priceMoney = w.effective_price_money ?? w.price_money ?? 0;
      const pricePoints = w.effective_price_points ?? w.price_points ?? 0;
      const canAffordMoney = w.price_money != null && money >= priceMoney;
      const canAffordPoints = w.price_points != null && points >= pricePoints;
      const canBuy = !w.owned && !w.locked && (canAffordMoney || canAffordPoints);
      return {
        ...w,
        canBuyMoney: w.price_money != null,
        canBuyPoints: w.price_points != null,
        canAffordMoney,
        canAffordPoints,
        canBuy,
      };
    });
  }, [weapons, me?.money, me?.points]);

  const equippedWeapon = useMemo(() => weapons.find((w) => w?.equipped), [weapons]);
  const bestOwned = useMemo(() => {
    const owned = weapons.filter((w) => w?.owned);
    if (!owned.length) return null;
    return owned.reduce((best, cur) => (Number(cur?.damage ?? 0) > Number(best?.damage ?? 0) ? cur : best), owned[0]);
  }, [weapons]);
  const equippedArmour = useMemo(() => armourData.options?.find((o) => o.equipped), [armourData.options]);

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <style>{AW_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Swords size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="armour-weapons-page">
      <style>{AW_STYLES}</style>

      {/* Page header */}
      <div className="relative aw-fade-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Arsenal</p>
          <p className="text-[10px] text-zinc-500 font-heading italic">Equip weapons and armour for combat.</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-heading">
          <span className="text-mutedForeground">Cash: <span className="text-primary font-bold">{formatMoney(me?.money)}</span></span>
          <span className="text-mutedForeground">Points: <span className="text-primary font-bold">{(me?.points ?? 0).toLocaleString()}</span></span>
        </div>
      </div>

      {/* Event Banner */}
      {eventsEnabled && event && event.armour_weapon_cost !== 1 && event?.name && (
        <div className="px-3 py-2 bg-primary/8 border border-primary/20 rounded-lg aw-fade-in">
          <p className="text-xs font-heading">
            <span className="text-primary font-bold">✨ {event.name}</span>
            <span className="text-mutedForeground ml-2">{event.message}</span>
          </p>
        </div>
      )}

      {/* Loadout Summary */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 aw-fade-in`} style={{ animationDelay: '0.03s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Current Loadout</span>
        </div>
        <div className="p-3 grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
              <Swords size={18} className="text-primary" />
            </div>
            <div>
              <div className="text-[10px] text-mutedForeground uppercase">Weapon</div>
              <div className="text-sm font-heading font-bold text-foreground">
                {equippedWeapon?.name || bestOwned?.name || 'Brass Knuckles'}
              </div>
              <div className="text-[10px] text-mutedForeground">
                {equippedWeapon ? 'Equipped' : bestOwned ? 'Auto-selected' : 'Default'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
              <Shield size={18} className="text-primary" />
            </div>
            <div>
              <div className="text-[10px] text-mutedForeground uppercase">Armour</div>
              <div className="text-sm font-heading font-bold text-foreground">
                {equippedArmour ? equippedArmour.name : 'None'}
              </div>
              <div className="text-[10px] text-mutedForeground">
                {equippedArmour ? `Level ${equippedArmour.level}` : 'Unprotected'}
              </div>
            </div>
          </div>
        </div>
        <div className="aw-art-line text-primary mx-3" />
      </div>

      {/* Tabbed Content */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 aw-fade-in`} style={{ animationDelay: '0.04s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="flex border-b border-primary/20 bg-primary/5">
          <Tab active={activeTab === 'armoury'} onClick={() => setActiveTab('armoury')} icon={Factory}>
            Armoury
          </Tab>
        </div>

        <div className="p-3 space-y-6">
          <BulletFactoryTab me={me} ownedArmouryState={ownedArmouryState} />

          {/* Weapons section */}
          <div className="space-y-1">
            <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-zinc-700/50">
              <Swords size={12} /> Weapons
            </div>
            <div className="grid grid-cols-[1fr_5rem_5rem_7rem] gap-2 px-2 py-1 text-[10px] text-mutedForeground uppercase font-heading border-b border-zinc-700/50">
              <span>Weapon</span>
              <span className="text-right">Stock</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Action</span>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-0.5">
                {weaponRows.map((w) => {
                  const isEquipped = !!w.equipped;
                  const isOwned = !!w.owned;
                  const canBuy = !!w.canBuy;
                  const usingPoints = w.canBuyPoints && (canBuy ? w.canAffordPoints : w.price_points != null);
                  const buyDisabled = !canBuy || buyingId != null;
                  const armouryStock = w.armoury_stock ?? 0;

                  return (
                    <div
                      key={w.id}
                      className={`grid grid-cols-[1fr_5rem_5rem_7rem] gap-2 px-2 py-2 rounded-lg items-center transition-all aw-row ${
                        isEquipped ? 'bg-primary/10 border border-primary/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isEquipped && <Check size={12} className="text-emerald-400 shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-sm font-heading font-bold text-foreground truncate">{w.name}</div>
                          {isOwned && <div className="text-[10px] text-mutedForeground">Owned ×{w.quantity}</div>}
                          {!isOwned && w.locked && w.required_weapon_name && (
                            <div className="text-[9px] text-zinc-500">Requires {w.required_weapon_name}</div>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-primary font-bold text-right">{armouryStock > 0 ? armouryStock : '—'}</span>
                      <span className="text-xs text-mutedForeground text-right">{formatWeaponCost(w)}</span>
                      <div className="flex justify-end gap-1">
                        {isOwned ? (
                          <>
                            {isEquipped ? (
                              <button
                                onClick={unequipWeapon}
                                disabled={buyingId != null}
                                className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[9px] font-bold uppercase border border-zinc-600/50 disabled:opacity-50"
                              >
                                {buyingId === 'unequip' ? '...' : 'Unequip'}
                              </button>
                            ) : (
                              <button
                                onClick={() => equipWeapon(w.id)}
                                disabled={buyingId != null}
                                className="bg-primary/20 text-primary rounded px-2 py-1 text-[9px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading"
                              >
                                {buyingId === w.id ? '...' : 'Equip'}
                              </button>
                            )}
                            <button
                              onClick={() => sellWeapon(w.id)}
                              disabled={buyingId != null}
                              className="text-red-400 hover:text-red-300 text-[9px] font-bold px-1"
                            >
                              Sell
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => !buyDisabled && buyWeapon(w.id, usingPoints ? 'points' : 'money')}
                            disabled={buyDisabled}
                            title={w.locked ? `Requires ${w.required_weapon_name ?? 'previous weapon'}` : !canBuy ? 'Not enough cash or points' : ''}
                            className={`rounded px-2 py-1 text-[9px] font-bold uppercase border ${
                              canBuy && buyingId == null
                                ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                                : 'bg-zinc-800/50 text-zinc-500 border-zinc-600/50 opacity-60 cursor-not-allowed'
                            } disabled:opacity-60 disabled:cursor-not-allowed`}
                          >
                            {buyingId === w.id ? '...' : w.locked ? <span className="flex items-center gap-1"><Lock size={10} /> Buy</span> : 'Buy'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Armour section */}
          <div className="space-y-1">
            <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-zinc-700/50">
              <Shield size={12} /> Armour
            </div>
            <div className="grid grid-cols-[1fr_4rem_5rem_5rem_7rem] gap-2 px-2 py-1 text-[10px] text-mutedForeground uppercase font-heading border-b border-zinc-700/50">
              <span>Armour</span>
              <span className="text-center">Level</span>
              <span className="text-right">Stock</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Action</span>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-0.5">
                {armourRows.map((o) => {
                  const isEquipped = !!o.equipped;
                  const isOwned = !!o.owned;
                  const canSell = isOwned && o.level === armourData.owned_max && armourData.owned_max >= 1;
                  const buyDisabled = !o.canBuy || buyingLevel != null;
                  const armouryStock = o.armoury_stock ?? 0;

                  return (
                    <div
                      key={o.level}
                      className={`grid grid-cols-[1fr_4rem_5rem_5rem_7rem] gap-2 px-2 py-2 rounded-lg items-center transition-all aw-row ${
                        isEquipped ? 'bg-primary/10 border border-primary/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isEquipped && <Check size={12} className="text-emerald-400 shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-sm font-heading font-bold text-foreground truncate">{o.name}</div>
                          {isOwned && !isEquipped && <div className="text-[10px] text-mutedForeground">Owned</div>}
                          {isEquipped && <div className="text-[10px] text-emerald-400">Equipped</div>}
                          {!isOwned && o.locked && o.required_armour_name && (
                            <div className="text-[9px] text-zinc-500">Requires {o.required_armour_name}</div>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-primary font-bold text-center">Lv.{o.level}</span>
                      <span className="text-xs text-primary font-bold text-right">{armouryStock > 0 ? armouryStock : '—'}</span>
                      <span className="text-xs text-mutedForeground text-right">{formatCost(o)}</span>
                      <div className="flex justify-end gap-1">
                        {isEquipped ? (
                          <>
                            <button
                              onClick={unequipArmour}
                              disabled={equippingLevel != null}
                              className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[9px] font-bold uppercase border border-zinc-600/50 disabled:opacity-50"
                            >
                              {equippingLevel === 0 ? '...' : 'Unequip'}
                            </button>
                            {canSell && (
                              <button onClick={sellArmour} className="text-red-400 hover:text-red-300 text-[9px] font-bold px-1">
                                Sell
                              </button>
                            )}
                          </>
                        ) : isOwned ? (
                          <>
                            <button
                              onClick={() => equipArmour(o.level)}
                              disabled={equippingLevel != null}
                              className="bg-primary/20 text-primary rounded px-2 py-1 text-[9px] font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 font-heading"
                            >
                              {equippingLevel === o.level ? '...' : 'Equip'}
                            </button>
                            {canSell && (
                              <button onClick={sellArmour} className="text-red-400 hover:text-red-300 text-[9px] font-bold px-1">
                                Sell
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            onClick={() => !buyDisabled && buyArmour(o.level)}
                            disabled={buyDisabled}
                            title={o.locked ? `Requires ${o.required_armour_name ?? 'previous armour'}` : !o.affordable ? 'Not enough cash or points' : ''}
                            className={`rounded px-2 py-1 text-[9px] font-bold uppercase border ${
                              o.canBuy && buyingLevel == null
                                ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                                : 'bg-zinc-800/50 text-zinc-500 border-zinc-600/50 opacity-60 cursor-not-allowed'
                            } disabled:opacity-60 disabled:cursor-not-allowed`}
                          >
                            {buyingLevel === o.level ? '...' : o.locked ? <span className="flex items-center gap-1"><Lock size={10} /> Buy</span> : 'Buy'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
        <div className="aw-art-line text-primary mx-3" />
      </div>

      {/* Info Panel */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 aw-fade-in`} style={{ animationDelay: '0.05s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Info</span>
        </div>
        <div className="p-3 space-y-1.5 text-xs text-mutedForeground">
          <p>• <span className="text-foreground">Weapons</span> increase your damage in combat. Higher damage = fewer bullets needed.</p>
          <p>• <span className="text-foreground">Armour</span> protects you from bullets. 5 tiers available (Lv.1-3 cash, Lv.4-5 points).</p>
          <p>• Your <span className="text-primary">best owned weapon</span> is auto-selected if none equipped.</p>
        </div>
        <div className="aw-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
