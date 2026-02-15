import { useEffect, useMemo, useState } from 'react';
import { Shield, Swords, Check, Lock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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

export default function ArmourWeapons() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [armourData, setArmourData] = useState({ current_level: 0, options: [] });
  const [weapons, setWeapons] = useState([]);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [buyingLevel, setBuyingLevel] = useState(null);
  const [equippingLevel, setEquippingLevel] = useState(null);
  const [buyingId, setBuyingId] = useState(null);
  const [activeTab, setActiveTab] = useState('weapons');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [meRes, optRes, weaponsRes, eventsRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/armour/options'),
        api.get('/weapons'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      ]);
      setMe(meRes.data);
      setArmourData(optRes.data);
      setWeapons(weaponsRes.data || []);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
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
      const res = await api.post('/armour/buy', { level });
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
      const response = await api.post(`/weapons/${weaponId}/buy`, { currency });
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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="armour-weapons-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
            ⚔️ Arsenal
          </h1>
          <p className="text-xs text-mutedForeground">
            Equip weapons and armour for combat
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-heading">
          <span className="text-mutedForeground">Cash: <span className="text-primary font-bold">{formatMoney(me?.money)}</span></span>
          <span className="text-mutedForeground">Points: <span className="text-primary font-bold">{(me?.points ?? 0).toLocaleString()}</span></span>
        </div>
      </div>

      {/* Event Banner */}
      {eventsEnabled && event && event.armour_weapon_cost !== 1 && event?.name && (
        <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded-md">
          <p className="text-xs font-heading">
            <span className="text-primary font-bold">✨ {event.name}</span>
            <span className="text-mutedForeground ml-2">{event.message}</span>
          </p>
        </div>
      )}

      {/* Loadout Summary */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Current Loadout</span>
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
      </div>

      {/* Tabbed Content */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="flex border-b border-primary/20 bg-zinc-900/30">
          <Tab active={activeTab === 'weapons'} onClick={() => setActiveTab('weapons')} icon={Swords}>
            Weapons
          </Tab>
          <Tab active={activeTab === 'armour'} onClick={() => setActiveTab('armour')} icon={Shield}>
            Armour
          </Tab>
        </div>

        <div className="p-3">
          {activeTab === 'weapons' && (
            <div className="space-y-1">
              {/* Table Header */}
              <div className="grid grid-cols-[1fr_5rem_5rem_7rem] gap-2 px-2 py-1 text-[10px] text-mutedForeground uppercase font-heading border-b border-zinc-700/50">
                <span>Weapon</span>
                <span className="text-right">Damage</span>
                <span className="text-right">Cost</span>
                <span className="text-right">Action</span>
              </div>
              
              {/* Weapon Rows */}
              <div className="max-h-80 overflow-y-auto space-y-0.5">
                {weaponRows.map((w) => {
                  const isEquipped = !!w.equipped;
                  const isOwned = !!w.owned;
                  const canBuy = !!w.canBuy;
                  const usingPoints = w.canBuyPoints && (canBuy ? w.canAffordPoints : w.price_points != null);
                  const buyDisabled = !canBuy || buyingId != null;

                  return (
                    <div
                      key={w.id}
                      className={`grid grid-cols-[1fr_5rem_5rem_7rem] gap-2 px-2 py-2 rounded items-center transition-all ${
                        isEquipped ? 'bg-primary/10 border border-primary/30' : 'hover:bg-zinc-800/30'
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
                      <span className="text-xs text-primary font-bold text-right">{w.damage}</span>
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
                                className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[9px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50"
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
                                ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border-yellow-600/50'
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
          )}

          {activeTab === 'armour' && (
            <div className="space-y-1">
              {/* Table Header */}
              <div className="grid grid-cols-[1fr_4rem_5rem_7rem] gap-2 px-2 py-1 text-[10px] text-mutedForeground uppercase font-heading border-b border-zinc-700/50">
                <span>Armour</span>
                <span className="text-center">Level</span>
                <span className="text-right">Cost</span>
                <span className="text-right">Action</span>
              </div>
              
              {/* Armour Rows */}
              <div className="max-h-80 overflow-y-auto space-y-0.5">
                {armourRows.map((o) => {
                  const isEquipped = !!o.equipped;
                  const isOwned = !!o.owned;
                  const canSell = isOwned && o.level === armourData.owned_max && armourData.owned_max >= 1;
                  const buyDisabled = !o.canBuy || buyingLevel != null;

                  return (
                    <div
                      key={o.level}
                      className={`grid grid-cols-[1fr_4rem_5rem_7rem] gap-2 px-2 py-2 rounded items-center transition-all ${
                        isEquipped ? 'bg-primary/10 border border-primary/30' : 'hover:bg-zinc-800/30'
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
                              className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[9px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50"
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
                                ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border-yellow-600/50'
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
          )}
        </div>
      </div>

      {/* Info Panel */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Info</span>
        </div>
        <div className="p-3 space-y-1.5 text-xs text-mutedForeground">
          <p>• <span className="text-foreground">Weapons</span> increase your damage in combat. Higher damage = fewer bullets needed.</p>
          <p>• <span className="text-foreground">Armour</span> protects you from bullets. 5 tiers available (Lv.1-3 cash, Lv.4-5 points).</p>
          <p>• Your <span className="text-primary">best owned weapon</span> is auto-selected if none equipped.</p>
        </div>
      </div>
    </div>
  );
}
