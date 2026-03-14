import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Swords, Shield, Gift, Car, Building2, Zap, Target } from 'lucide-react';
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

let _cachedInventory = null;
let _invLastFetch = 0;
const INV_REFRESH = 30_000;

export default function MyInventory() {
  const [data, setData] = useState(_cachedInventory);
  const [loading, setLoading] = useState(!_cachedInventory);
  const [equipping, setEquipping] = useState({ weapon: null, armour: null });
  const [usingToken, setUsingToken] = useState(null);

  const fetchInventory = (silent = false) => {
    if (!silent) setLoading(true);
    api
      .get('/inventory')
      .then((res) => {
        if (res?.data) {
          _cachedInventory = res.data;
          _invLastFetch = Date.now();
          setData(res.data);
        }
      })
      .catch(() => {
        if (!silent) setData({ weapons: [], armour: { options: [] }, loot_exclusives: {}, tokens: {} });
      })
      .finally(() => { if (!silent) setLoading(false); });
  };

  useEffect(() => {
    const stale = Date.now() - _invLastFetch > INV_REFRESH;
    if (!_cachedInventory) fetchInventory(false);
    else if (stale) fetchInventory(true);
    const id = setInterval(() => fetchInventory(true), INV_REFRESH);
    return () => clearInterval(id);
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

  const activateToken = async (tokenType) => {
    setUsingToken(tokenType);
    try {
      const res = await api.post('/inventory/tokens/use', { token_type: tokenType });
      if (res?.data?.tokens) setData((d) => (d ? { ...d, tokens: res.data.tokens } : d));
      toast.success(res?.data?.message || 'Token used.');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to use token');
    } finally {
      setUsingToken(null);
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
  const tokens = data.tokens || {};

  const TOKEN_TYPES = ['xp_crimes', 'xp_gta', 'melt', 'oc_reduced', 'booze', 'racket', 'travel', 'properties', 'jailbust_bonus'];
  const tokenLabels = {
    xp_crimes: { name: 'Crimes XP', icon: Zap, desc: 'Double XP from crimes, 1h per token (stack up to 6h)' },
    xp_gta: { name: 'GTA XP', icon: Zap, desc: 'Double XP from GTA, 1h per token (stack up to 6h)' },
    melt: { name: 'Melt', icon: Zap, desc: 'Reduced melt (bullets) cooldown, 1h per token (stack up to 6h)' },
    oc_reduced: { name: 'OC Reduced', icon: Zap, desc: 'Reduced OC cooldown, setup cost & higher payout, 1h per token (6h)' },
    booze: { name: 'Booze', icon: Zap, desc: 'Booze costs less to buy, 1h per token (6h)' },
    racket: { name: 'Racket', icon: Zap, desc: 'Increased racket (illegal business) profit, 1h per token (6h)' },
    travel: { name: 'Travel', icon: Zap, desc: 'Lower airport cost & 2% car travel time reduction, 1h per token (2h)' },
    properties: { name: 'Properties', icon: Building2, desc: '3× property income, 1h per token (stack up to 3h)' },
    jailbust_bonus: { name: 'Jailbust bonus', icon: Target, desc: '+10% jail bust success, less chance of jail on fail, 1h (6h)' },
  };

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

        {/* Weapons & Armour side by side — always 2 columns */}
        <div className="grid grid-cols-2 gap-3 inv-fade-in" style={{ animationDelay: '0.1s' }}>
          {/* Weapons */}
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 min-w-0`}>
            <div className="px-2 py-1.5 sm:px-2.5 sm:py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-1.5">
              <Swords size={12} className="text-primary shrink-0" />
              <h2 className="text-[9px] sm:text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Weapons</h2>
            </div>
            <div className="p-2 sm:p-2.5 divide-y divide-zinc-700/30">
              {weapons.length === 0 ? (
                <div className="py-3 text-[9px] text-mutedForeground font-heading text-center">No weapons owned</div>
              ) : (
                weapons.map((w) => (
                  <div key={w.id} className="inv-item flex items-center justify-between py-1.5 gap-1">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-heading font-medium text-foreground truncate block">
                        {w.name}
                        {w.equipped && <span className="text-primary ml-1">✓</span>}
                      </span>
                      {w.loot_exclusive && <span className="text-[8px] text-amber-400 block">Loot Exclusive</span>}
                    </div>
                    <button
                      type="button"
                      disabled={equipping.weapon !== null}
                      onClick={() => (w.equipped ? unequipWeapon() : equipWeapon(w.id))}
                      className="px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 shrink-0"
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
            <div className="px-2 py-1.5 sm:px-2.5 sm:py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-1.5">
              <Shield size={12} className="text-primary shrink-0" />
              <h2 className="text-[9px] sm:text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Armour</h2>
            </div>
            <div className="p-2 sm:p-2.5 divide-y divide-zinc-700/30">
              {armourOptions.length === 0 ? (
                <div className="py-3 text-[9px] text-mutedForeground font-heading text-center">No armour owned</div>
              ) : (
                armourOptions.map((o) => (
                  <div key={o.level} className="inv-item flex items-center justify-between py-1.5 gap-1">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-heading font-medium text-foreground truncate block">
                        Lv.{o.level} {o.name}
                        {o.equipped && <span className="text-primary ml-1">✓</span>}
                      </span>
                      {o.loot_exclusive && <span className="text-[8px] text-amber-400 block">Loot Exclusive</span>}
                    </div>
                    <button
                      type="button"
                      disabled={equipping.armour !== null}
                      onClick={() => (o.equipped ? unequipArmour() : equipArmour(o.level))}
                      className="px-1.5 py-1 rounded text-[8px] sm:text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 shrink-0"
                    >
                      {equipping.armour === o.level || (equipping.armour === 0 && o.equipped) ? '...' : o.equipped ? 'Unequip' : 'Equip'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Consumables / Tokens */}
        {TOKEN_TYPES.some((k) => (tokens[k]?.count ?? 0) > 0 || tokens[k]?.active_until) && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in`} style={{ animationDelay: '0.18s' }}>
            <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Zap size={14} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Consumables</h2>
            </div>
            <div className="p-2.5 space-y-2">
              {TOKEN_TYPES.filter((key) => (tokens[key]?.count ?? 0) > 0 || tokens[key]?.active_until).map((key) => {
                const t = tokens[key] || { count: 0, active_until: null };
                const { name, icon: Icon, desc } = tokenLabels[key] || { name: key, icon: Zap, desc: '' };
                const active = t.active_until ? new Date(t.active_until) > new Date() : false;
                return (
                  <div key={key} className="inv-item flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Icon size={12} className="text-primary shrink-0" />
                        <span className="text-[11px] font-heading font-medium text-foreground">{name}</span>
                        <span className="text-[9px] text-mutedForeground">×{t.count}</span>
                      </div>
                      {desc && <div className="text-[9px] text-mutedForeground mt-0.5">{desc}</div>}
                      {active && t.active_until && (
                        <div className="text-[9px] text-primary mt-0.5">Active until {new Date(t.active_until).toLocaleString()}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={t.count < 1 || usingToken !== null}
                      onClick={() => activateToken(key)}
                      className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 shrink-0"
                    >
                      {usingToken === key ? '...' : 'Use'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Loot Exclusives */}
        {(exclusiveCars.length > 0 || hasSpeakeasy) && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in`} style={{ animationDelay: '0.2s' }}>
            <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Gift size={14} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Loot Exclusives</h2>
            </div>
            <div className="p-2.5 space-y-2">
              {exclusiveCars.map((c) => (
                <div key={c.id || c.car_id || c.name} className="inv-item flex items-center gap-2 py-2">
                  <Car size={12} className="text-amber-400 shrink-0" />
                  <span className="text-[11px] font-heading text-foreground">{c.name ?? 'Car'}</span>
                  <span className="text-[9px] text-amber-400">Loot Exclusive</span>
                  <Link to="/cars/garage" className="ml-auto text-[9px] text-primary hover:underline">View in Garage →</Link>
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
