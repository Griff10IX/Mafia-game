import { useEffect, useMemo, useState } from 'react';
import { Shield, Sword, DollarSign, Gem, Lock } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatCost(opt, useEffective = true) {
  const money = useEffective && opt.effective_cost_money != null ? opt.effective_cost_money : opt.cost_money;
  const points = useEffective && opt.effective_cost_points != null ? opt.effective_cost_points : opt.cost_points;
  if (points != null) return `${points} points`;
  if (money != null) return `$${Number(money).toLocaleString()}`;
  return '—';
}

function formatWeaponCost(w, useEffective = true) {
  const money = useEffective && w.effective_price_money != null ? w.effective_price_money : w.price_money;
  const points = useEffective && w.effective_price_points != null ? w.effective_price_points : w.price_points;
  if (points != null) return `${points} Points`;
  if (money != null) return `$${Number(money).toLocaleString()}`;
  return '—';
}

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
    } catch (e) {
      toast.error('Failed to load armour & weapons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const armourRows = useMemo(() => {
    return (armourData.options || []).map((o) => {
      const status = o.equipped ? 'Equipped' : o.owned ? 'Owned' : o.affordable ? 'Available' : 'Locked';
      const canBuy = !o.owned && o.affordable;
      return { ...o, status, canBuy };
    });
  }, [armourData.options]);

  const buyArmour = async (level) => {
    setBuyingLevel(level);
    try {
      const res = await api.post('/armour/buy', { level });
      toast.success(res.data.message || 'Purchased armour');
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

  const buyWeapon = async (weaponId, currency) => {
    setBuyingId(weaponId);
    try {
      const response = await api.post(`/weapons/${weaponId}/buy`, { currency });
      toast.success(response.data.message);
      fetchAll();
    } catch (error) {
      const detail = error.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg || 'Failed to buy weapon' : 'Failed to buy weapon';
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
      toast.error(typeof error.response?.data?.detail === 'string' ? error.response.data.detail : 'Failed to equip weapon');
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
      toast.error(typeof error.response?.data?.detail === 'string' ? error.response.data.detail : 'Failed to unequip weapon');
    } finally {
      setBuyingId(null);
    }
  };

  const weaponRows = useMemo(() => {
    return (weapons || []).map((w) => {
      const canBuyMoney = w.price_money != null;
      const canBuyPoints = w.price_points != null;
      const status = w.owned ? 'Owned' : (canBuyMoney || canBuyPoints) ? 'Available' : 'Locked';
      return { ...w, status, canBuyMoney, canBuyPoints };
    });
  }, [weapons]);

  const equippedWeapon = useMemo(() => (weapons || []).find((w) => w?.equipped), [weapons]);
  const bestOwned = useMemo(() => {
    const owned = (weapons || []).filter((w) => w?.owned);
    if (owned.length === 0) return null;
    return owned.reduce((best, cur) => (Number(cur?.damage ?? 0) > Number(best?.damage ?? 0) ? cur : best), owned[0]);
  }, [weapons]);
  const equippedArmourOption = useMemo(
    () => (armourData.options || []).find((o) => o.equipped),
    [armourData.options]
  );

  const sellArmour = async () => {
    try {
      const res = await api.post('/armour/sell');
      toast.success(res.data?.message || 'Armour sold');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to sell armour');
    }
  };

  const sellWeapon = async (weaponId) => {
    setBuyingId(`sell-${weaponId}`);
    try {
      const res = await api.post(`/weapons/${weaponId}/sell`);
      toast.success(res.data?.message || 'Weapon sold');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to sell weapon');
    } finally {
      setBuyingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`max-w-4xl mx-auto w-full space-y-5 ${styles.pageContent}`} data-testid="armour-weapons-page">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Shield size={24} className="text-primary/80" />
            <Sword size={24} className="text-primary/80" />
            Armour & Weapons
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <div className="flex items-center justify-center gap-4 text-xs font-heading">
          <span className="inline-flex items-center gap-1 text-primary">
            <DollarSign size={12} /> ${Number(me?.money ?? 0).toLocaleString()}
          </span>
          <span className="text-primary/40">|</span>
          <span className="inline-flex items-center gap-1 text-primary">
            <Gem size={12} /> {Number(me?.points ?? 0).toLocaleString()} pts
          </span>
        </div>
      </div>

      {eventsEnabled && event && event.armour_weapon_cost !== 1 && event?.name && (
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className={`${styles.panelHeader} px-3 py-2 sm:px-4`}>
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Today&apos;s event</span>
          </div>
          <div className="p-3 sm:p-4">
            <p className="text-sm font-heading font-bold text-primary">{event.name}</p>
            <p className={`text-xs font-heading mt-1 ${styles.textMuted}`}>{event.message}</p>
          </div>
        </div>
      )}

      {/* Combat loadout summary */}
      <div className={`${styles.panel} rounded-sm overflow-hidden py-2 px-4`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs font-heading">
          <div className="flex items-center gap-1.5">
            <span className="text-mutedForeground shrink-0">Weapon:</span>
            <span className="text-primary font-bold truncate">{equippedWeapon ? equippedWeapon.name : bestOwned ? bestOwned.name : 'Brass Knuckles'}</span>
            {(equippedWeapon || bestOwned) && <span className="text-mutedForeground shrink-0">{(equippedWeapon ? '· equipped' : '· auto')}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-mutedForeground shrink-0">Armour:</span>
            <span className="text-primary font-bold truncate">{equippedArmourOption ? `Lv.${equippedArmourOption.level} ${equippedArmourOption.name}` : 'None'}</span>
          </div>
        </div>
      </div>

      {/* Side-by-side: Weapon (left) | Vest / Armour (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Weapons */}
        <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5 min-w-0`}>
          <div className="grid grid-cols-[auto_1fr_6rem_7rem] sm:grid-cols-[auto_1fr_5.5rem_8rem] gap-2 px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 items-center">
            <span className="w-4" aria-hidden />
            <span className="text-xs font-heading font-bold text-primary/90 uppercase tracking-wider flex items-center gap-1.5"><Sword size={14} /> Weapon</span>
            <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-wider text-right">Cost</span>
            <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-wider text-right">Action</span>
          </div>
          <div className="overflow-x-auto min-w-0">
            {weaponRows.map((w, idx) => {
              const showOwned = !!w.owned;
              const canBuy = !w.owned && (w.canBuyMoney || w.canBuyPoints);
              const usingPoints = w.canBuyPoints;
              const CostIcon = usingPoints ? Gem : DollarSign;
              const costText = formatWeaponCost(w);
              const isEquipped = !!w.equipped;
              const actionBlock = (
                <div className="flex gap-1.5 justify-end flex-wrap">
                  {w.owned ? (
                    <>
                      {w.equipped ? (
                        <button type="button" onClick={unequipWeapon} disabled={buyingId != null} className={`${styles.surface} ${styles.raisedHover} border border-primary/20 text-foreground rounded-sm px-2 py-1 text-[11px] font-heading font-bold uppercase tracking-wider transition-smooth disabled:opacity-50`} data-testid={`unequip-weapon-${w.id}`}>
                          {buyingId === 'unequip' ? '...' : 'Unequip'}
                        </button>
                      ) : (
                        <button type="button" onClick={() => equipWeapon(w.id)} disabled={buyingId != null} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-2 py-1 text-[11px] font-heading font-bold uppercase tracking-wider border border-yellow-600/50 disabled:opacity-50" data-testid={`equip-weapon-${w.id}`}>
                          {buyingId === w.id ? '...' : 'Equip'}
                        </button>
                      )}
                      <button type="button" onClick={() => sellWeapon(w.id)} disabled={buyingId != null} className="bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 rounded-sm px-2 py-1 text-[10px] font-heading font-bold uppercase disabled:opacity-50" data-testid={`sell-weapon-${w.id}`}>
                        {buyingId === `sell-${w.id}` ? '...' : 'Sell'}
                      </button>
                    </>
                  ) : canBuy ? (
                    <button type="button" onClick={() => buyWeapon(w.id, usingPoints ? 'points' : 'money')} disabled={buyingId != null} className={`rounded-sm px-2 py-1 text-[11px] font-heading font-bold uppercase tracking-wider disabled:opacity-50 ${usingPoints ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 border border-yellow-600/50' : `${styles.surface} ${styles.raisedHover} border border-primary/20 text-foreground`}`} data-testid={`buy-weapon-${w.id}`}>
                      <span className="inline-flex items-center gap-0.5"><CostIcon size={10} />{buyingId === w.id ? '...' : 'Buy'}</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-mutedForeground font-heading"><Lock size={10} /> Locked</span>
                  )}
                </div>
              );
              return (
                <div key={w.id} data-testid={`weapon-row-${w.id}`} className={`grid grid-cols-[auto_1fr_6rem_7rem] sm:grid-cols-[auto_1fr_5.5rem_8rem] gap-2 px-4 py-2 border-b border-primary/10 items-center min-h-[44px] ${idx % 2 === 1 ? 'bg-primary/5' : ''} ${styles.raisedHover}`}>
                  <input type="radio" name="weapon-pick" readOnly checked={isEquipped} className="accent-[#303030] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-heading font-bold text-foreground truncate">{w.name}</div>
                    {showOwned && <div className="text-[10px] text-mutedForeground font-heading">Owned {w.quantity}{isEquipped && ' · Equipped'}</div>}
                  </div>
                  <span className="text-xs font-heading text-foreground text-right truncate">{costText}</span>
                  <div className="flex justify-end min-w-0">{actionBlock}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Armour / Vest */}
        <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5 min-w-0`}>
          <div className="grid grid-cols-[auto_1fr_5rem_7rem] sm:grid-cols-[auto_1fr_5.5rem_8rem] gap-2 px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 items-center">
            <span className="w-4" aria-hidden />
            <span className="text-xs font-heading font-bold text-primary/90 uppercase tracking-wider flex items-center gap-1.5"><Shield size={14} /> Vest</span>
            <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-wider text-right">Cost</span>
            <span className="text-xs font-heading font-bold text-primary/80 uppercase tracking-wider text-right">Action</span>
          </div>
          <div className="overflow-x-auto min-w-0">
            {armourRows.map((o, idx) => {
              const CostIcon = o.cost_points != null ? Gem : DollarSign;
              const actionBlock = (
                <div className="flex gap-1.5 justify-end flex-wrap">
                  {o.equipped ? (
                    <button type="button" onClick={unequipArmour} disabled={equippingLevel != null} className={`${styles.surface} ${styles.raisedHover} border border-primary/20 text-foreground rounded-sm px-2 py-1 text-[11px] font-heading font-bold uppercase tracking-wider transition-smooth disabled:opacity-50`} data-testid={`armour-unequip-${o.level}`}>
                      {equippingLevel === 0 ? '...' : 'Unequip'}
                    </button>
                  ) : o.owned ? (
                    <button type="button" onClick={() => equipArmour(o.level)} disabled={equippingLevel != null} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-2 py-1 text-[11px] font-heading font-bold uppercase tracking-wider border border-yellow-600/50 disabled:opacity-50" data-testid={`armour-equip-${o.level}`}>
                      {equippingLevel === o.level ? '...' : 'Equip'}
                    </button>
                  ) : o.canBuy ? (
                    <button type="button" onClick={() => buyArmour(o.level)} disabled={buyingLevel != null} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-2 py-1 text-[11px] font-heading font-bold uppercase tracking-wider border border-yellow-600/50 disabled:opacity-50" data-testid={`armour-buy-${o.level}`}>
                      {buyingLevel === o.level ? '...' : 'Buy'}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-mutedForeground font-heading"><Lock size={10} /> {o.status}</span>
                  )}
                  {o.owned && o.level === armourData.owned_max && armourData.owned_max >= 1 && (
                    <button type="button" onClick={sellArmour} className="bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 rounded-sm px-2 py-1 text-[10px] font-heading font-bold uppercase" data-testid={`armour-sell-${o.level}`}>Sell</button>
                  )}
                </div>
              );
              return (
                <div key={o.level} data-testid={`armour-row-${o.level}`} className={`grid grid-cols-[auto_1fr_5rem_7rem] sm:grid-cols-[auto_1fr_5.5rem_8rem] gap-2 px-4 py-2 border-b border-primary/10 items-center min-h-[44px] ${idx % 2 === 1 ? 'bg-primary/5' : ''} ${styles.raisedHover}`}>
                  <input type="radio" name="vest-pick" readOnly checked={!!o.equipped} className="accent-[#303030] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-heading font-bold text-foreground truncate">{o.name}</div>
                    <div className="text-[10px] text-mutedForeground font-heading">Lv.{o.level}</div>
                  </div>
                  <span className="text-xs font-heading text-foreground text-right inline-flex items-center justify-end gap-0.5"><CostIcon size={10} className="text-mutedForeground" />{formatCost(o)}</span>
                  <div className="flex justify-end min-w-0">{actionBlock}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Info</h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-3">
          <ul className="space-y-1 text-xs text-mutedForeground font-heading">
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Armour has 5 tiers (Lv.1 → Lv.5). First 3 cost cash; top 2 cost points. Higher armour = more bullets to kill you.</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Buy weapons to build your arsenal. Equipped weapon is used for kills and the bullet calculator.</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Events can reduce or increase armour and weapon costs for the day.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
