import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Swords, Shield, Gift, Car, Building2, Zap, Target } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const INV_STYLES = `
  @keyframes inv-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .inv-fade-in { animation: inv-fade-in 0.3s ease-out both; }
  .inv-item { transition: all 0.2s ease; }
  .inv-item:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
`;

const LoadingSpinner = () => (
  <div className={`${styles.pageContent} p-4 mobile-page-root`}>
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
  const [collectingSpeakeasy, setCollectingSpeakeasy] = useState(false);

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

  const activateToken = async (tokenType, useAll = false) => {
    setUsingToken(useAll ? `${tokenType}:all` : tokenType);
    try {
      const res = await api.post('/inventory/tokens/use', { token_type: tokenType, use_all: useAll });
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

  const collectSpeakeasy = async () => {
    setCollectingSpeakeasy(true);
    try {
      const res = await api.post('/loot-box/speakeasy/collect');
      toast.success(res?.data?.message || 'Collected from Speakeasy!');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to collect');
    } finally {
      setCollectingSpeakeasy(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!data) {
    return (
      <div className={`${styles.pageContent} p-4 mobile-page-root`}>
        <p className="text-mutedForeground">Failed to load inventory.</p>
      </div>
    );
  }

  const weapons = (data.weapons || []).filter((w) => w.owned);
  const armourOptions = (data.armour?.options || []).filter((o) => o.owned);
  const loot = data.loot_exclusives || {};
  const exclusiveCars = loot.exclusive_cars || [];
  const hasSpeakeasy = loot.has_speakeasy === true;
  const speakeasyInfo = loot.speakeasy || null;
  const tokens = data.tokens || {};

  const getSpeakeasyCooldownText = () => {
    if (!speakeasyInfo?.next_collect_at) return null;
    try {
      const next = new Date(speakeasyInfo.next_collect_at);
      const now = new Date();
      const diff = next - now;
      if (diff <= 0) return null;
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      return `${hours}h ${mins}m`;
    } catch {
      return null;
    }
  };

  const TOKEN_TYPES = ['xp_crimes', 'xp_gta', 'auto_rank_2h', 'melt', 'oc_reduced', 'booze', 'racket', 'travel', 'properties', 'jailbust_bonus', 'rank_xp_pass'];
  const tokenLabels = {
    xp_crimes: { name: 'Crimes XP', icon: Zap, desc: 'Double XP from crimes, 1h per token (stack up to 24h)' },
    xp_gta: { name: 'GTA XP', icon: Zap, desc: 'Double XP from GTA, 1h per token (stack up to 24h)' },
    auto_rank_2h: { name: 'Auto Rank (2h)', icon: Zap, desc: 'Temporary Auto Rank access, 2h per token (stack up to 24h)' },
    melt: { name: 'Melt', icon: Zap, desc: 'Reduced melt (bullets) cooldown, 1h per token (stack up to 24h)' },
    oc_reduced: { name: 'OC Reduced', icon: Zap, desc: 'Reduced OC cooldown, setup cost & higher payout, 1h per token (stack up to 24h)' },
    booze: { name: 'Booze', icon: Zap, desc: 'Booze costs less to buy, 1h per token (stack up to 24h)' },
    racket: { name: 'Racket', icon: Zap, desc: 'Increased racket (illegal business) profit, 1h per token (stack up to 24h)' },
    travel: { name: 'Travel', icon: Zap, desc: 'Lower airport cost & 2% car travel time reduction, 1h per token (stack up to 24h)' },
    properties: { name: 'Properties', icon: Building2, desc: '3× property income, 1h per token (stack up to 24h)' },
    jailbust_bonus: { name: 'Jailbust bonus', icon: Target, desc: '+10% jail bust success, less chance of jail on fail, 1h per token (stack up to 24h)' },
    rank_xp_pass: { name: 'Game Pass', icon: Package, desc: 'Activate in Armoury/My Inventory to claim one-time Game Pass rewards. Expires in 1 month if unused.' },
  };

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}>
      <style>{INV_STYLES}</style>
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-[10px] sm:text-xs text-mutedForeground font-heading inv-fade-in" style={{ animationDelay: '0.05s' }}>
          Equip your armour and weapons. View your loot-exclusive items.
        </p>

        {/* Weapons & Armour side by side — always 2 columns */}
        <div className="grid grid-cols-2 gap-3 inv-fade-in" style={{ animationDelay: '0.1s' }}>
          {/* Weapons */}
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 min-w-0 mobile-panel`}>
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
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 min-w-0 mobile-panel`}>
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
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in mobile-panel`} style={{ animationDelay: '0.18s' }}>
            <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Zap size={14} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Consumables</h2>
            </div>
            <div className="p-2.5 space-y-2">
              <p className="text-[8px] text-mutedForeground font-heading leading-snug border-b border-zinc-700/30 pb-2 mb-1">
                Use all spends every token needed to reach this row&apos;s max stack (or until you run out). Extra tokens stay in your inventory.
              </p>
              {TOKEN_TYPES.filter((key) => (tokens[key]?.count ?? 0) > 0 || tokens[key]?.active_until).map((key) => {
                const t = tokens[key] || { count: 0, active_until: null, expires_at: null };
                const { name, icon: Icon, desc } = tokenLabels[key] || { name: key, icon: Zap, desc: '' };
                // Game Pass is now one-time tier rewards (no 24h "active until" window).
                // Older DB rows may still have rank_xp_pass_bonus_until set, so we explicitly ignore it in UI.
                const active = key !== 'rank_xp_pass' && t.active_until ? new Date(t.active_until) > new Date() : false;
                const expired = key === 'rank_xp_pass' && t.expires_at ? new Date(t.expires_at) <= new Date() : false;
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
                      {!active && key === 'rank_xp_pass' && t.expires_at && (
                        <div className="text-[9px] text-amber-300 mt-0.5">
                          {expired ? 'Expired' : `Expires ${new Date(t.expires_at).toLocaleDateString()}`}
                        </div>
                      )}
                      {!active && key === 'rank_xp_pass' && !t.expires_at && (
                        <div className="text-[9px] text-emerald-300 mt-0.5">Rewards claimed</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={t.count < 1 || usingToken !== null || expired}
                        onClick={() => activateToken(key, false)}
                        className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        {usingToken === key ? '...' : 'Use'}
                      </button>
                      {key !== 'rank_xp_pass' && (
                        <button
                          type="button"
                          disabled={t.count < 1 || usingToken !== null}
                          onClick={() => activateToken(key, true)}
                          className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-teal-500/40 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 disabled:opacity-50"
                        >
                          {usingToken === `${key}:all` ? '...' : 'Use all'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Loot Exclusives */}
        {(exclusiveCars.length > 0 || hasSpeakeasy) && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in mobile-panel`} style={{ animationDelay: '0.2s' }}>
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
              {hasSpeakeasy && speakeasyInfo && (
                <div className="inv-item p-3 rounded-md bg-amber-500/5 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 size={14} className="text-amber-400 shrink-0" />
                    <span className="text-[12px] font-heading font-bold text-foreground">Speakeasy</span>
                    <span className="text-[9px] text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded">Loot Exclusive</span>
                  </div>
                  <div className="text-[10px] text-mutedForeground mb-2">
                    Daily payout: <span className="text-emerald-400 font-bold">${speakeasyInfo.daily_cash?.toLocaleString()}</span> + <span className="text-blue-400 font-bold">{speakeasyInfo.daily_bullets} bullets</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {speakeasyInfo.can_collect ? (
                      <button
                        type="button"
                        onClick={collectSpeakeasy}
                        disabled={collectingSpeakeasy}
                        className="px-3 py-1.5 rounded text-[10px] font-heading font-bold border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
                      >
                        {collectingSpeakeasy ? 'Collecting...' : '$ Collect Daily'}
                      </button>
                    ) : (
                      <span className="text-[9px] text-mutedForeground">
                        Next collect in <span className="text-amber-400 font-bold">{getSpeakeasyCooldownText() || '...'}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
              {hasSpeakeasy && !speakeasyInfo && (
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
