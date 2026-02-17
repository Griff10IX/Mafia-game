import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Factory, Package, User, ShoppingCart, Flame, Gauge, Shield, Crosshair } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const formatMoney = (n) => `$${Number(n ?? 0).toLocaleString()}`;

const QUICK_BUYS = [100, 500, 1000, 5000, 10000];

/* ═══════════════════════════════════════════════════════
   Conveyor Belt — bullets, weapons, armour (armoury)
   ═══════════════════════════════════════════════════════ */
const ITEM_WIDTH = 32;

function BulletCasing() {
  return (
    <div className="shrink-0 flex items-center" style={{ width: ITEM_WIDTH }}>
      <div className="w-2 h-4 rounded-t-full mx-auto" style={{ background: 'linear-gradient(135deg, #c9a84c, #8b6914, #d4af37)' }} />
      <div className="w-2 h-3 -ml-2" style={{ background: 'linear-gradient(135deg, #b87333, #8b4513, #cd7f32)' }} />
    </div>
  );
}

function BeltWeapon() {
  return (
    <div className="shrink-0 flex items-center justify-center" style={{ width: ITEM_WIDTH }}>
      <div className="w-3 h-4 rounded-sm rotate-[-30deg]" style={{ background: 'linear-gradient(180deg, #4a4a4a, #2a2a2a)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' }} />
    </div>
  );
}

function BeltArmour() {
  return (
    <div className="shrink-0 flex items-center justify-center" style={{ width: ITEM_WIDTH }}>
      <div className="w-5 h-4 rounded-sm" style={{ background: 'linear-gradient(180deg, #5a5a5a, #3a3a3a)', border: '1px solid #4a4a4a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }} />
    </div>
  );
}

// Pattern: mostly bullets, occasional weapon/armour (armoury mix)
const BELT_ITEM_TYPES = ['bullet', 'bullet', 'bullet', 'weapon', 'bullet', 'bullet', 'armour', 'bullet', 'bullet', 'weapon', 'bullet', 'armour', 'bullet', 'bullet', 'bullet'];

function ConveyorBelt() {
  const bulletCount = 40;
  const setWidth = bulletCount * ITEM_WIDTH;
  const items = Array.from({ length: bulletCount * 2 }, (_, i) => BELT_ITEM_TYPES[i % BELT_ITEM_TYPES.length]);
  return (
    <div className="relative w-full h-10 overflow-hidden rounded" style={{ background: 'linear-gradient(180deg, #2a2218 0%, #3d3225 40%, #2a2218 100%)' }}>
      {/* Belt rollers */}
      <div className="absolute inset-x-0 top-0 h-[3px] z-10" style={{ background: 'linear-gradient(90deg, #555 0%, #888 50%, #555 100%)' }} />
      <div className="absolute inset-x-0 bottom-0 h-[3px] z-10" style={{ background: 'linear-gradient(90deg, #555 0%, #888 50%, #555 100%)' }} />
      {/* Belt treads */}
      <div className="absolute inset-0 animate-belt-treads" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 28px, rgba(0,0,0,0.3) 28px, rgba(0,0,0,0.3) 30px)', backgroundSize: '30px 100%' }} />
      {/* Items — bullets, weapons, armour (two sets for seamless loop) */}
      <div className="absolute top-0 left-0 h-full flex items-center animate-belt-bullets" style={{ width: setWidth * 2 }}>
        {items.map((type, i) => (
          type === 'weapon' ? <BeltWeapon key={i} /> : type === 'armour' ? <BeltArmour key={i} /> : <BulletCasing key={i} />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Production Gauge — circular meter showing output rate
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
    <div className="relative w-24 h-24 sm:w-28 sm:h-28 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {/* Gauge background arc */}
        <path d={arcPath} fill="none" stroke="#333" strokeWidth="6" strokeLinecap="round" />
        {/* Gauge fill arc */}
        <path d={arcPath} fill="none" stroke="url(#gauge-grad)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${pct * arcLen} ${arcLen}`} />
        {/* Tick marks */}
        {[...Array(9)].map((_, i) => {
          const deg = startDeg + (i / 8) * sweepDeg;
          const t1 = toXY(deg, 37);
          const t2 = toXY(deg, 43);
          return <line key={i} x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} stroke="#666" strokeWidth="1" />;
        })}
        {/* Needle */}
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

/* ═══════════════════════════════════════════════════════
   Animated Counter — ticks up to target number
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
   Collect Particles — bullets, weapons, armour, cash on collect (armoury)
   ═══════════════════════════════════════════════════════ */
function CollectParticles({ show }) {
  if (!show) return null;
  const emojis = ['🔫', '💰', '✨', '🎯', '🛡️', '⚔️'];
  const items = Array.from({ length: 24 }).map((_, i) => ({
    id: i,
    emoji: emojis[i % emojis.length],
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    dur: 1.5 + Math.random() * 1.5,
    rot: Math.random() * 360,
  }));
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">
      {items.map((p) => (
        <div key={p.id} className="absolute text-lg animate-factory-particle"
          style={{ left: `${p.left}%`, bottom: '10%', animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, '--r': `${p.rot}deg` }}>
          {p.emoji}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main BulletFactory Component
   ═══════════════════════════════════════════════════════ */
export default function BulletFactory({ me }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [settingPrice, setSettingPrice] = useState(false);
  const [buying, setBuying] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  const [showParticles, setShowParticles] = useState(false);

  const currentState = me?.current_state;

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/bullet-factory', { params: currentState ? { state: currentState } : {} });
      setData(res.data);
    } catch {
      toast.error('Failed to load bullet factory');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [currentState]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  const collect = async () => {
    setCollecting(true);
    try {
      const res = await api.post('/bullet-factory/collect', { state: data?.state || currentState });
      toast.success(res.data?.message || 'Bullets collected');
      setShowParticles(true);
      setTimeout(() => setShowParticles(false), 3000);
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to collect bullets');
    } finally {
      setCollecting(false);
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
  const canCollect = data?.can_collect ?? false;
  const canBuy = data?.can_buy ?? false;
  const accumulated = data?.accumulated_bullets ?? 0;
  const production = data?.production_per_hour ?? 3000;
  const claimCost = data?.claim_cost ?? 0;
  const pricePerBullet = data?.price_per_bullet ?? null;
  const priceMin = data?.price_min ?? 1;
  const priceMax = data?.price_max ?? 100000;
  const userMoney = Number(me?.money ?? 0);
  const canAffordClaim = userMoney >= claimCost;
  const buyAmountNum = parseInt(buyAmount, 10) || 0;
  const buyTotal = buyAmountNum > 0 && pricePerBullet != null ? buyAmountNum * pricePerBullet : 0;
  const canAffordBuy = buyTotal > 0 && userMoney >= buyTotal;

  return (
    <div className="space-y-4 relative" data-testid="bullet-factory-tab">
      <style>{`
        @keyframes belt-bullets {
          0% { transform: translateX(0); }
          100% { transform: translateX(-${40 * 32}px); }
        }
        @keyframes belt-treads {
          0% { background-position-x: 0; }
          100% { background-position-x: -30px; }
        }
        .animate-belt-bullets { animation: belt-bullets 12s linear infinite; }
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

      <CollectParticles show={showParticles} />

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

        {/* Main Content — two column layout */}
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

              {/* Accumulated */}
              <div className="rounded-lg p-3 relative overflow-hidden" style={{
                background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                border: '1px solid #3a3a38',
              }}>
                {accumulated > 0 && (
                  <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary animate-pulse" />
                )}
                <div className="flex items-center gap-1.5 mb-1">
                  <Package size={11} className="text-zinc-500" />
                  <span className="text-[9px] text-zinc-500 font-heading uppercase">{hasOwner ? 'Stock' : 'Available'}</span>
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
                  Produces <strong className="text-primary">{production.toLocaleString()}</strong> bullets per hour.
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

                {/* Collect Button */}
                {canCollect && (
                  <button
                    type="button"
                    onClick={collect}
                    disabled={collecting}
                    className="w-full group"
                  >
                    <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-primary/60 font-heading font-bold uppercase tracking-wider transition-all bg-gradient-to-b from-primary/30 via-primary/20 to-amber-900/20 text-primary hover:from-primary/40 hover:to-amber-900/30 hover:shadow-lg hover:shadow-primary/20 disabled:opacity-50"
                      style={{ boxShadow: '0 0 20px rgba(212,175,55,0.15)' }}>
                      <Package size={18} className="group-hover:animate-bounce" />
                      {collecting ? 'Collecting...' : `Collect ${accumulated.toLocaleString()} Bullets`}
                    </div>
                  </button>
                )}

                {hasOwner && !canCollect && accumulated === 0 && isOwner && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <p className="text-[11px] text-zinc-400 font-heading">
                      Producing... check back later to collect.
                    </p>
                  </div>
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

            {/* Buy Bullets */}
            {canBuy && pricePerBullet != null && (
              <div className="rounded-lg p-3" style={{
                background: 'linear-gradient(135deg, rgba(30,30,28,0.8), rgba(20,20,18,0.9))',
                border: '1px solid #3a3a38',
              }}>
                <div className="text-[10px] text-zinc-500 font-heading uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ShoppingCart size={11} />
                  {hasOwner ? 'Buy Bullets' : 'Buy (System Price)'}
                </div>

                {/* Quick Buy Chips */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {QUICK_BUYS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setBuyAmount(String(amt))}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-heading font-bold border transition-all ${
                        buyAmountNum === amt
                          ? 'bg-primary/25 border-primary/60 text-primary shadow-sm shadow-primary/10'
                          : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
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
                      max={accumulated}
                      placeholder="Custom amount"
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
                  <button
                    type="submit"
                    disabled={buying || buyAmountNum <= 0 || !canAffordBuy || buyAmountNum > accumulated}
                    className={`w-full px-4 py-2.5 font-heading font-bold text-xs uppercase rounded-lg border-2 transition-all ${
                      canAffordBuy && buyAmountNum > 0 && buyAmountNum <= accumulated
                        ? 'bg-gradient-to-b from-emerald-900/40 to-emerald-900/20 border-emerald-600/50 text-emerald-400 hover:from-emerald-900/50 hover:border-emerald-500/60'
                        : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 cursor-not-allowed'
                    } disabled:opacity-50`}
                  >
                    {buying ? 'Buying...' : `Buy ${buyAmountNum > 0 ? buyAmountNum.toLocaleString() : ''} Bullets`}
                  </button>
                </form>
                <p className="text-[10px] text-zinc-500 mt-1.5">{accumulated.toLocaleString()} in stock</p>
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
          </div>
        </div>

        {/* Warning stripes bottom bar */}
        <div className="h-2" style={{
          background: 'repeating-linear-gradient(135deg, #d4af37 0px, #d4af37 8px, #1a1a1a 8px, #1a1a1a 16px)',
          opacity: 0.6,
        }} />
      </div>
    </div>
  );
}
