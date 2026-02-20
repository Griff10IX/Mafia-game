import { useEffect, useMemo, useState } from 'react';
import { Shield, Swords, Check, Lock, Factory } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import BulletFactory from './BulletFactory';
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

export default function ArmourWeapons() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [ownedArmouryState, setOwnedArmouryState] = useState(null);
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
      const state = ownedArmouryState || me?.current_state;
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
      const state = ownedArmouryState || me?.current_state;
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
          <BulletFactory me={me} ownedArmouryState={ownedArmouryState} />

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
