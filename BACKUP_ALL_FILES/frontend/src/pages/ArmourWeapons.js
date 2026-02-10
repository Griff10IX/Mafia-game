import { useEffect, useMemo, useState } from 'react';
import { Shield, Sword, DollarSign, Gem, Lock } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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
    <div className="max-w-4xl mx-auto w-full space-y-8" data-testid="armour-weapons-page">
      <div className="flex items-center justify-center relative">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Gear</div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">Armour & Weapons</h1>
        </div>
        <div className="absolute right-0 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-3 text-xs text-mutedForeground">
          <span className="inline-flex items-center gap-1">
            <DollarSign size={14} className="text-primary" /> ${Number(me?.money ?? 0).toLocaleString()}
          </span>
          <span className="text-mutedForeground/60">|</span>
          <span className="inline-flex items-center gap-1">
            <Gem size={14} className="text-primary" /> {Number(me?.points ?? 0).toLocaleString()} pts
          </span>
        </div>
      </div>

      {eventsEnabled && event && event.armour_weapon_cost !== 1 && event?.name && (
        <div className="bg-primary/15 border border-primary rounded-sm p-4">
          <p className="text-sm font-semibold text-primary">Today&apos;s event: {event.name}</p>
          <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
        </div>
      )}

      {/* Armour section */}
      <div>
        <h2 className="text-xl font-heading font-semibold text-foreground mb-3 flex items-center justify-center gap-2">
          <Shield size={20} className="text-primary" /> Armour
        </h2>
        <div className="flex justify-center">
          <div className="w-full max-w-3xl bg-card border border-border rounded-sm overflow-hidden">
            <div className="grid grid-cols-12 bg-secondary/40 text-xs uppercase tracking-wider text-mutedForeground px-4 py-3">
              <div className="col-span-6">Set</div>
              <div className="col-span-2 text-right">Level</div>
              <div className="col-span-2 text-right">Cost</div>
              <div className="col-span-2 text-right">Action</div>
            </div>
            {armourRows.map((o) => {
              const CostIcon = o.cost_points != null ? Gem : DollarSign;
              return (
                <div
                  key={o.level}
                  className="grid grid-cols-12 px-4 py-3 border-t border-border items-center transition-smooth bg-background/30 hover:bg-background/50"
                  data-testid={`armour-row-${o.level}`}
                >
                  <div className="col-span-6 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{o.name}</div>
                        <div className="text-xs text-mutedForeground truncate">{o.description}</div>
                      </div>
                      <Shield className="text-primary shrink-0" size={18} />
                    </div>
                  </div>
                  <div className="col-span-2 text-right text-sm font-mono text-foreground">Lv.{o.level}</div>
                  <div className="col-span-2 text-right text-sm font-mono text-mutedForeground">
                    <span className="inline-flex items-center justify-end gap-1">
                      <CostIcon size={14} className="text-primary" />
                      <span>{formatCost(o)}</span>
                    </span>
                  </div>
                  <div className="col-span-2 text-right flex flex-wrap gap-1.5 justify-end">
                    {o.equipped ? (
                      <button
                        type="button"
                        onClick={unequipArmour}
                        disabled={equippingLevel != null}
                        className="bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth disabled:opacity-50"
                        data-testid={`armour-unequip-${o.level}`}
                      >
                        {equippingLevel === 0 ? '...' : 'Unequip'}
                      </button>
                    ) : o.owned ? (
                      <button
                        type="button"
                        onClick={() => equipArmour(o.level)}
                        disabled={equippingLevel != null}
                        className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth gold-glow disabled:opacity-50"
                        data-testid={`armour-equip-${o.level}`}
                      >
                        {equippingLevel === o.level ? '...' : 'Equip'}
                      </button>
                    ) : o.canBuy ? (
                      <button
                        type="button"
                        onClick={() => buyArmour(o.level)}
                        disabled={buyingLevel != null}
                        className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth gold-glow disabled:opacity-50"
                        data-testid={`armour-buy-${o.level}`}
                      >
                        {buyingLevel === o.level ? '...' : 'Buy'}
                      </button>
                    ) : (
                      <span className="inline-flex items-center justify-end gap-1 text-xs text-mutedForeground font-mono">
                        <Lock size={14} className="text-mutedForeground" /> {o.status}
                      </span>
                    )}
                    {o.owned && o.level === armourData.owned_max && armourData.owned_max >= 1 && (
                      <button
                        type="button"
                        onClick={sellArmour}
                        className="bg-destructive/90 text-destructiveForeground hover:bg-destructive rounded-sm px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-smooth"
                        data-testid={`armour-sell-${o.level}`}
                      >
                        Sell (50%)
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Weapons section */}
      <div>
        <h2 className="text-xl font-heading font-semibold text-foreground mb-3 flex items-center justify-center gap-2">
          <Sword size={20} className="text-primary" /> Weapons
        </h2>
        <div className="flex justify-center">
          <div className="w-full max-w-3xl space-y-4">
            <div className="bg-card border border-border rounded-sm p-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Combat Loadout</div>
                  <div className="text-lg font-heading font-bold text-foreground mt-1 truncate">
                    {equippedWeapon ? equippedWeapon.name : bestOwned ? bestOwned.name : 'Brass Knuckles'}
                  </div>
                  <div className="text-xs text-mutedForeground mt-1">
                    {equippedWeapon
                      ? 'Equipped weapon is used for kills and the bullet calculator.'
                      : bestOwned
                        ? 'No weapon equipped — your best owned weapon is used automatically.'
                        : "You don't own a weapon yet — you'll use Brass Knuckles until you buy one."}
                  </div>
                  <div className="text-xs text-mutedForeground mt-2 flex items-center gap-2">
                    <Shield size={14} className="text-primary shrink-0" />
                    <span>
                      Armour: {equippedArmourOption ? `Lv.${equippedArmourOption.level} ${equippedArmourOption.name}` : 'None'}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                  <Sword size={16} />
                  {equippedWeapon ? 'Equipped' : bestOwned ? 'Auto' : 'Default'}
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <div className="grid grid-cols-12 bg-secondary/40 text-xs uppercase tracking-wider text-mutedForeground px-4 py-3">
                <div className="col-span-8">Weapon</div>
                <div className="col-span-4 text-right">Action</div>
              </div>
              {weaponRows.map((w) => {
                const showOwned = !!w.owned;
                const canBuy = !w.owned && (w.canBuyMoney || w.canBuyPoints);
                const usingPoints = w.canBuyPoints;
                const CostIcon = usingPoints ? Gem : DollarSign;
                const costText = formatWeaponCost(w);
                const isEquipped = !!w.equipped;
                return (
                  <div
                    key={w.id}
                    data-testid={`weapon-row-${w.id}`}
                    className="grid grid-cols-12 px-4 py-3 border-t border-border items-center transition-smooth bg-background/30 hover:bg-background/50"
                  >
                    <div className="col-span-8 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground truncate">{w.name}</div>
                          <div className="text-xs text-mutedForeground truncate">{w.description}</div>
                          {showOwned && (
                            <div className="mt-1 text-xs text-mutedForeground">
                              Owned: <span className="text-primary font-mono font-bold">{w.quantity}</span>
                              {isEquipped && (
                                <span className="ml-2 inline-flex px-2 py-0.5 rounded-sm bg-primary/15 text-primary text-[10px] uppercase tracking-wider font-bold">Equipped</span>
                              )}
                            </div>
                          )}
                        </div>
                        <Sword className="text-primary shrink-0" size={18} />
                      </div>
                    </div>
                    <div className="col-span-4 text-right flex flex-wrap gap-1.5 justify-end">
                      {w.owned ? (
                        <>
                          {w.equipped ? (
                            <button
                              type="button"
                              onClick={unequipWeapon}
                              disabled={buyingId != null}
                              className="bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth disabled:opacity-50"
                              data-testid={`unequip-weapon-${w.id}`}
                            >
                              {buyingId === 'unequip' ? '...' : 'Unequip'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => equipWeapon(w.id)}
                              disabled={buyingId != null}
                              className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth gold-glow disabled:opacity-50"
                              data-testid={`equip-weapon-${w.id}`}
                            >
                              {buyingId === w.id ? '...' : 'Equip'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => sellWeapon(w.id)}
                            disabled={buyingId != null}
                            className="bg-destructive/90 text-destructiveForeground hover:bg-destructive rounded-sm px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-smooth disabled:opacity-50"
                            data-testid={`sell-weapon-${w.id}`}
                          >
                            {buyingId === `sell-${w.id}` ? '...' : 'Sell (50%)'}
                          </button>
                        </>
                      ) : canBuy ? (
                        <button
                          type="button"
                          onClick={() => buyWeapon(w.id, usingPoints ? 'points' : 'money')}
                          disabled={buyingId != null}
                          className={`rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth disabled:opacity-50 ${
                            usingPoints ? 'bg-primary text-primaryForeground hover:opacity-90 gold-glow' : 'bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground'
                          }`}
                          data-testid={`buy-weapon-${w.id}`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <CostIcon size={14} />
                            {buyingId === w.id ? '...' : costText}
                          </span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1 text-xs text-mutedForeground font-mono">
                          <Lock size={14} className="text-mutedForeground" /> Locked
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-card border border-border rounded-sm p-6">
          <h3 className="text-xl font-heading font-semibold text-primary mb-3">Armour & Weapons</h3>
          <ul className="space-y-2 text-sm text-mutedForeground">
            <li>• Armour has 5 tiers (Lv.1 → Lv.5). First 3 cost cash; top 2 cost points. Higher armour increases bullets needed to kill you.</li>
            <li>• Buy weapons to build your arsenal. Equipped weapon is used for kills and the bullet calculator.</li>
            <li>• Events can reduce or increase armour and weapon costs for the day.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
