import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Swords, Shield, Gift, Car, Building2 } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const INV_STYLES = `
  @keyframes inv-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .inv-fade-in { animation: inv-fade-in 0.3s ease-out both; }
  .inv-item { transition: all 0.2s ease; }
  .inv-item:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
`;

const LoadingSpinner = () => (
  <div className={`${styles.pageContent} p-4`}>
    <style>{INV_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
      <Package size={24} className="text-primary/50 animate-pulse" />
      <span className="text-primary text-[10px] font-heading uppercase tracking-wider">Loading inventory...</span>
    </div>
  </div>
);

export default function MyInventory() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [equipping, setEquipping] = useState({ weapon: null, armour: null });

  const fetchInventory = () => {
    api
      .get('/inventory')
      .then((res) => {
        if (res?.data) setData(res.data);
      })
      .catch(() => setData({ weapons: [], armour: { options: [] }, loot_exclusives: {} }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const equipWeapon = async (weaponId) => {
    setEquipping((e) => ({ ...e, weapon: weaponId }));
    try {
      await api.post('/weapons/equip', { weapon_id: weaponId });
      toast.success('Weapon equipped');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to equip weapon');
    } finally {
      setEquipping((e) => ({ ...e, weapon: null }));
    }
  };

  const unequipWeapon = async () => {
    setEquipping((e) => ({ ...e, weapon: '' }));
    try {
      await api.post('/weapons/unequip');
      toast.success('Weapon unequipped');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unequip weapon');
    } finally {
      setEquipping((e) => ({ ...e, weapon: null }));
    }
  };

  const equipArmour = async (level) => {
    setEquipping((e) => ({ ...e, armour: level }));
    try {
      await api.post('/armour/equip', { level });
      toast.success('Armour equipped');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to equip armour');
    } finally {
      setEquipping((e) => ({ ...e, armour: null }));
    }
  };

  const unequipArmour = async () => {
    setEquipping((e) => ({ ...e, armour: 0 }));
    try {
      await api.post('/armour/unequip');
      toast.success('Armour unequipped');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unequip armour');
    } finally {
      setEquipping((e) => ({ ...e, armour: null }));
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!data) {
    return (
      <div className={`${styles.pageContent} p-4`}>
        <p className="text-mutedForeground">Failed to load inventory.</p>
      </div>
    );
  }

  const weapons = (data.weapons || []).filter((w) => w.owned);
  const armourOptions = (data.armour?.options || []).filter((o) => o.owned);
  const loot = data.loot_exclusives || {};
  const exclusiveCars = loot.exclusive_cars || [];
  const hasSpeakeasy = loot.has_speakeasy === true;

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4`}>
      <style>{INV_STYLES}</style>
      <div className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-lg sm:text-xl font-heading font-bold text-primary flex items-center gap-2 inv-fade-in">
          <Package size={22} />
          My Inventory
        </h1>
        <p className="text-[10px] sm:text-xs text-mutedForeground font-heading inv-fade-in" style={{ animationDelay: '0.05s' }}>
          Equip your armour and weapons. View your loot-exclusive items.
        </p>

        {/* Weapons & Armour side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 inv-fade-in" style={{ animationDelay: '0.1s' }}>
          {/* Weapons */}
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 min-w-0`}>
          <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
            <Swords size={14} className="text-primary" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Weapons</h2>
          </div>
          <div className="p-2.5 divide-y divide-zinc-700/30">
            {weapons.length === 0 ? (
              <div className="py-3 text-[10px] text-mutedForeground font-heading text-center">No weapons owned</div>
            ) : (
              weapons.map((w) => (
                <div key={w.id} className="inv-item flex items-center justify-between py-2 gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] sm:text-xs font-heading font-medium text-foreground truncate block">
                      {w.name}
                      {w.equipped && <span className="text-primary ml-1">✓</span>}
                      {w.loot_exclusive && <span className="text-amber-400 ml-1">Loot Exclusive</span>}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={equipping.weapon !== null}
                    onClick={() => (w.equipped ? unequipWeapon() : equipWeapon(w.id))}
                    className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 shrink-0"
                  >
                    {equipping.weapon === w.id || (equipping.weapon === '' && w.equipped) ? '...' : w.equipped ? 'Unequip' : 'Equip'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Armour */}
        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 min-w-0`}>
          <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
            <Shield size={14} className="text-primary" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Armour</h2>
          </div>
          <div className="p-2.5 divide-y divide-zinc-700/30">
            {armourOptions.length === 0 ? (
              <div className="py-3 text-[10px] text-mutedForeground font-heading text-center">No armour owned</div>
            ) : (
              armourOptions.map((o) => (
                <div key={o.level} className="inv-item flex items-center justify-between py-2 gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] sm:text-xs font-heading font-medium text-foreground truncate block">
                      Lv.{o.level} {o.name}
                      {o.equipped && <span className="text-primary ml-1">✓</span>}
                    </span>
                    {o.loot_exclusive && <span className="text-[9px] text-amber-400">Loot Exclusive</span>}
                  </div>
                  <button
                    type="button"
                    disabled={equipping.armour !== null}
                    onClick={() => (o.equipped ? unequipArmour() : equipArmour(o.level))}
                    className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 shrink-0"
                  >
                    {equipping.armour === o.level || (equipping.armour === 0 && o.equipped) ? '...' : o.equipped ? 'Unequip' : 'Equip'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        </div>

        {/* Loot Exclusives */}
        {(exclusiveCars.length > 0 || hasSpeakeasy) && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in`} style={{ animationDelay: '0.2s' }}>
            <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Gift size={14} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Loot Exclusives</h2>
            </div>
            <div className="p-2.5 space-y-2">
              {exclusiveCars.map((c) => (
                <div key={c.id || c.car_id} className="inv-item flex items-center gap-2 py-2">
                  <Car size={12} className="text-amber-400 shrink-0" />
                  <span className="text-[11px] font-heading text-foreground">{c.name}</span>
                  <span className="text-[9px] text-amber-400">Loot Exclusive</span>
                  <Link to="/garage" className="ml-auto text-[9px] text-primary hover:underline">View in Garage →</Link>
                </div>
              ))}
              {hasSpeakeasy && (
                <div className="inv-item flex items-center gap-2 py-2">
                  <Building2 size={12} className="text-amber-400 shrink-0" />
                  <span className="text-[11px] font-heading text-foreground">Speakeasy</span>
                  <span className="text-[9px] text-amber-400">Loot Exclusive</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="inv-fade-in" style={{ animationDelay: '0.25s' }}>
          <Link to="/armour-weapons" className="text-[10px] font-heading text-mutedForeground hover:text-primary transition-colors">
            Buy more weapons & armour at the Armoury →
          </Link>
        </div>
      </div>
    </div>
  );
}
