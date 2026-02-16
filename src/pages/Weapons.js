import { useState, useEffect, useMemo } from 'react';
import { Sword, DollarSign, Zap, Lock, CheckCircle2, Gem } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

export default function Weapons() {
  const [weapons, setWeapons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [buyingId, setBuyingId] = useState(null);

  useEffect(() => {
    fetchWeapons();
  }, []);

  const fetchWeapons = async () => {
    try {
      const [weaponsRes, meRes] = await Promise.all([api.get('/weapons'), api.get('/auth/me')]);
      setWeapons(weaponsRes.data);
      setMe(meRes.data);
    } catch (error) {
      toast.error('Failed to load weapons');
    } finally {
      setLoading(false);
    }
  };

  const buyWeapon = async (weaponId, currency) => {
    setBuyingId(weaponId);
    try {
      const response = await api.post(`/weapons/${weaponId}/buy`, { currency });
      toast.success(response.data.message);
      fetchWeapons();
    } catch (error) {
      const detail = error.response?.data?.detail;
      const msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail[0]?.msg || 'Failed to buy weapon'
            : 'Failed to buy weapon';
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
      fetchWeapons();
    } catch (error) {
      const detail = error.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to equip weapon');
    } finally {
      setBuyingId(null);
    }
  };

  const unequipWeapon = async () => {
    setBuyingId('unequip');
    try {
      const res = await api.post('/weapons/unequip');
      toast.success(res.data.message || 'Weapon unequipped');
      fetchWeapons();
    } catch (error) {
      const detail = error.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to unequip weapon');
    } finally {
      setBuyingId(null);
    }
  };

  const rows = useMemo(() => {
    return (weapons || []).map((w) => {
      const canBuyMoney = w.price_money != null;
      const canBuyPoints = w.price_points != null;
      const costLabel = canBuyPoints ? `${w.price_points} points` : canBuyMoney ? `$${Number(w.price_money).toLocaleString()}` : '—';
      const status = w.owned ? 'Owned' : (canBuyMoney || canBuyPoints) ? 'Available' : 'Locked';
      return { ...w, costLabel, status, canBuyMoney, canBuyPoints };
    });
  }, [weapons]);

  const equippedWeapon = useMemo(() => (weapons || []).find((w) => w?.equipped), [weapons]);
  const bestOwned = useMemo(() => {
    const owned = (weapons || []).filter((w) => w?.owned);
    if (owned.length === 0) return null;
    // damage is still returned by the API, but we don't show it in the shop list
    return owned.reduce((best, cur) => {
      const bd = Number(best?.damage ?? 0);
      const cd = Number(cur?.damage ?? 0);
      return cd > bd ? cur : best;
    }, owned[0]);
  }, [weapons]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="weapons-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Weapons</div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">Weapons Arsenal</h1>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-xs text-mutedForeground">
          <span className="inline-flex items-center gap-1">
            <DollarSign size={14} className="text-primary" /> ${Number(me?.money ?? 0).toLocaleString()}
          </span>
          <span className="text-mutedForeground/60">|</span>
          <span className="inline-flex items-center gap-1">
            <Gem size={14} className="text-primary" /> {Number(me?.points ?? 0).toLocaleString()} pts
          </span>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl space-y-4">
          <div className={`${styles.panel} border border-border rounded-sm p-6`}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Combat Loadout</div>
                <div className="text-lg font-heading font-bold text-foreground mt-1 truncate">
                  {equippedWeapon ? equippedWeapon.name : bestOwned ? bestOwned.name : 'Brass Knuckles'}
                </div>
                <div className="text-xs text-mutedForeground mt-1">
                  {equippedWeapon
                    ? 'Equipped weapon is used for kills and the bullet calculator.'
                    : bestOwned
                      ? 'No weapon equipped — your best owned weapon is used automatically for kills and the bullet calculator.'
                      : "You don't own a weapon yet — you'll use Brass Knuckles until you buy one."}
                </div>
              </div>
              <div className="shrink-0 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                <Sword size={16} />
                {equippedWeapon ? 'Equipped' : bestOwned ? 'Auto' : 'Default'}
              </div>
            </div>
          </div>

          <div className={`${styles.panel} border border-border rounded-sm overflow-hidden`}>
          <div className="grid grid-cols-12 bg-secondary/40 text-xs uppercase tracking-wider text-mutedForeground px-4 py-3">
            <div className="col-span-8">Weapon</div>
            <div className="col-span-4 text-right">Action</div>
          </div>

          {rows.map((w) => {
            const showOwned = !!w.owned;
            const canBuy = !w.owned && (w.canBuyMoney || w.canBuyPoints);
            const usingPoints = w.canBuyPoints;
            const CostIcon = usingPoints ? Zap : DollarSign;
            const costText = w.canBuyPoints
              ? `${w.price_points} Points`
              : w.canBuyMoney
                ? `$${Number(w.price_money).toLocaleString()}`
                : '—';
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
                      {showOwned ? (
                        <div className="mt-1 text-xs text-mutedForeground">
                          Owned: <span className="text-primary font-mono font-bold">{w.quantity}</span>
                          {isEquipped ? (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-sm bg-primary/15 text-primary text-[10px] uppercase tracking-wider font-bold">
                              Equipped
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <Sword className="text-primary shrink-0" size={18} />
                  </div>
                </div>

                <div className="col-span-4 text-right">
                  {w.owned ? (
                    w.equipped ? (
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
                    )
                  ) : canBuy ? (
                    <button
                      type="button"
                      onClick={() => buyWeapon(w.id, usingPoints ? 'points' : 'money')}
                      disabled={buyingId != null}
                      className={`rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth disabled:opacity-50 ${
                        usingPoints
                          ? 'bg-primary text-primaryForeground hover:opacity-90 gold-glow'
                          : 'bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground'
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

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} border border-border rounded-sm p-6`}>
          <h3 className="text-xl font-heading font-semibold text-primary mb-3">Weapon System</h3>
          <ul className="space-y-2 text-sm text-mutedForeground">
            <li>• Buy weapons to build your arsenal</li>
            <li>• Weapon effects will be used by the bullet calculator system</li>
            <li>• Some premium weapons can only be purchased with points</li>
            <li>• Build your arsenal to become the most feared gangster</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
