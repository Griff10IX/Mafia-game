import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Swords, Shield, Gift, Car, Building2, Zap, Target, ArrowLeftRight } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const INV_STYLES = `
  @keyframes inv-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .inv-fade-in { animation: inv-fade-in 0.3s ease-out both; }
  .inv-item { transition: all 0.2s ease; }
  .inv-item:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
`;

let _cachedInventory = null;
let _invLastFetch = 0;
const INV_REFRESH = 30_000;

/** Matches backend STORE_TOKEN_MAX_HELD — max unactivated tokens per type (recipient cap). */
const STORE_TOKEN_MAX_HELD = 15;
const INVENTORY_TOKEN_TYPES = [
  'xp_crimes', 'xp_gta', 'auto_rank_2h', 'melt', 'oc_reduced', 'booze', 'racket', 'travel', 'properties', 'jailbust_bonus', 'rank_xp_pass',
];
const GIFTABLE_TOKEN_KEYS = INVENTORY_TOKEN_TYPES.filter((k) => k !== 'rank_xp_pass');

export default function MyInventory() {
  const [hasLoaded, setHasLoaded] = useState(Boolean(_cachedInventory));
  const [data, setData] = useState(_cachedInventory);
  const [equipping, setEquipping] = useState({ weapon: null, armour: null });
  const [usingToken, setUsingToken] = useState(null);
  const [collectingSpeakeasy, setCollectingSpeakeasy] = useState(false);
  const [exchangingAutoRank, setExchangingAutoRank] = useState(false);
  const [giftTargetUsername, setGiftTargetUsername] = useState('');
  const [giftTokenType, setGiftTokenType] = useState('');
  const [giftAmount, setGiftAmount] = useState(1);
  const [gifting, setGifting] = useState(false);

  const fetchInventory = (silent = false) => {
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
      .finally(() => { setHasLoaded(true); });
  };

  useEffect(() => {
    const stale = Date.now() - _invLastFetch > INV_REFRESH;
    if (!_cachedInventory) fetchInventory(false);
    else if (stale) fetchInventory(true);
    const id = setInterval(() => fetchInventory(true), INV_REFRESH);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tok = data?.tokens;
    if (!tok || typeof tok !== 'object') return;
    const inStock = GIFTABLE_TOKEN_KEYS.filter((k) => (tok[k]?.count ?? 0) > 0);
    setGiftTokenType((cur) => {
      if (inStock.includes(cur)) return cur;
      return inStock[0] || '';
    });
  }, [data]);

  useEffect(() => {
    const tok = data?.tokens;
    if (!tok || typeof tok !== 'object') return;
    const tokenGiftDaily = data.token_gift_daily || { sent_today: 0, limit: 20 };
    const giftDailyRemaining = Math.max(0, (tokenGiftDaily.limit ?? 20) - (tokenGiftDaily.sent_today ?? 0));
    const selGiftCount = giftTokenType ? (tok[giftTokenType]?.count ?? 0) : 0;
    const maxG = Math.max(0, Math.min(selGiftCount, giftDailyRemaining, STORE_TOKEN_MAX_HELD));
    setGiftAmount((a) => {
      if (maxG <= 0) return 1;
      return Math.min(Math.max(1, a), maxG);
    });
  }, [data, giftTokenType]);

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

  if (!hasLoaded) return <div className={`${styles.pageContent} p-4 mobile-page-root`}><style>{INV_STYLES}</style></div>;
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

  const tokenGiftDaily = data.token_gift_daily || { sent_today: 0, limit: 20 };
  const giftDailyRemaining = Math.max(0, (tokenGiftDaily.limit ?? 20) - (tokenGiftDaily.sent_today ?? 0));
  const giftableInStock = GIFTABLE_TOKEN_KEYS.filter((k) => (tokens[k]?.count ?? 0) > 0);
  const selGiftCount = giftTokenType ? (tokens[giftTokenType]?.count ?? 0) : 0;
  const maxGift = Math.max(0, Math.min(selGiftCount, giftDailyRemaining, STORE_TOKEN_MAX_HELD));

  const exchangeAutoRank = async () => {
    setExchangingAutoRank(true);
    try {
      const res = await api.post('/inventory/tokens/exchange-auto-rank', { count: 1 });
      if (res?.data?.tokens) setData((d) => (d ? { ...d, tokens: res.data.tokens } : d));
      const ex = res?.data?.exchange;
      const rows = ex?.granted_tokens || [];
      const n = rows.length;
      const names = rows.map((g) => tokenLabels[g.type]?.name || g.type).join(', ');
      if (n > 0 && names) {
        toast.success(`Traded 1 Auto Rank (2h) for ${n} boost tokens`, { description: names });
      } else {
        toast.success(res?.data?.message || 'Exchange complete.');
      }
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to exchange');
    } finally {
      setExchangingAutoRank(false);
    }
  };

  const sendGiftPerks = async () => {
    const uname = giftTargetUsername.trim();
    if (!uname) {
      toast.error('Enter a username');
      return;
    }
    if (!giftTokenType || maxGift < 1) {
      toast.error('No giftable perks available');
      return;
    }
    const amt = Math.min(Math.max(1, giftAmount), maxGift);
    setGifting(true);
    try {
      const res = await api.post('/inventory/tokens/gift', {
        target_username: uname,
        token_type: giftTokenType,
        amount: amt,
      });
      if (res?.data?.tokens) {
        setData((d) => {
          if (!d) return d;
          const next = { ...d, tokens: res.data.tokens };
          if (res.data.token_gift_daily) next.token_gift_daily = res.data.token_gift_daily;
          return next;
        });
      }
      toast.success(res?.data?.message || 'Gift sent.');
      setGiftTargetUsername('');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send gift');
    } finally {
      setGifting(false);
    }
  };

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}>
      <style>{INV_STYLES}</style>
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-[10px] sm:text-xs text-mutedForeground font-heading inv-fade-in" style={{ animationDelay: '0.05s' }}>
          <span className="text-foreground font-medium">You → My Inventory</span>
          {' — '}
          Equip armour and weapons, use consumables, and send unactivated perk tokens to another player in <span className="text-foreground">Gift perks</span> (first panel below). Loot exclusives are listed further down.
        </p>

        {/* Gift unactivated perk tokens (UTC daily cap on sender) — at top so it is easy to find */}
        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
          <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
            <Gift size={14} className="text-primary" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Gift perks</h2>
          </div>
          <div className="p-2.5 space-y-2">
            <p className="text-[8px] text-mutedForeground font-heading leading-snug">
              Enter their <span className="text-foreground">exact in-game username</span>, choose a perk you hold, amount, then <span className="text-foreground">Send gift</span>. Game Pass tokens cannot be gifted. Recipients can hold at most {STORE_TOKEN_MAX_HELD} of each type. Daily send limit (UTC):{' '}
              <span className="text-foreground font-medium">
                {tokenGiftDaily.sent_today ?? 0}/{tokenGiftDaily.limit ?? 20}
              </span>
              {giftDailyRemaining <= 0 && <span className="text-amber-400"> — limit reached today</span>}
            </p>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 items-stretch sm:items-end">
              <label className="flex flex-col gap-0.5 min-w-0 flex-1 sm:max-w-[11rem]">
                <span className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground">Their username</span>
                <input
                  type="text"
                  value={giftTargetUsername}
                  onChange={(e) => setGiftTargetUsername(e.target.value)}
                  placeholder="Player name"
                  autoComplete="off"
                  className="px-2 py-1 rounded border border-zinc-600/50 bg-background text-[10px] font-heading text-foreground placeholder:text-mutedForeground"
                />
              </label>
              <label className="flex flex-col gap-0.5 min-w-0 flex-1 sm:max-w-[14rem]">
                <span className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground">Perk to send</span>
                <select
                  value={giftTokenType}
                  onChange={(e) => setGiftTokenType(e.target.value)}
                  disabled={giftableInStock.length === 0}
                  className="px-2 py-1 rounded border border-zinc-600/50 bg-background text-[10px] font-heading text-foreground disabled:opacity-50"
                >
                  {giftableInStock.length === 0 ? (
                    <option value="">None in inventory</option>
                  ) : (
                    giftableInStock.map((k) => (
                      <option key={k} value={k}>
                        {(tokenLabels[k]?.name || k)} ×{tokens[k]?.count ?? 0}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 w-full sm:w-20">
                <span className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground">Amount</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, maxGift)}
                  value={maxGift <= 0 ? 1 : Math.min(giftAmount, maxGift)}
                  onChange={(e) => setGiftAmount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  disabled={maxGift <= 0}
                  className="px-2 py-1 rounded border border-zinc-600/50 bg-background text-[10px] font-heading text-foreground disabled:opacity-50 w-full"
                />
              </label>
              <button
                type="button"
                disabled={gifting || maxGift < 1 || giftDailyRemaining < 1 || !giftTargetUsername.trim()}
                onClick={sendGiftPerks}
                className="px-3 py-1.5 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 sm:shrink-0"
              >
                {gifting ? '…' : 'Send gift'}
              </button>
            </div>
          </div>
        </div>

        {/* Stack when .mobile-panel uses negative margins (≤1024px in noir.module.css); two columns only above that so panels do not overlap */}
        <div className="grid grid-cols-1 min-[1025px]:grid-cols-2 gap-3 inv-fade-in" style={{ animationDelay: '0.1s' }}>
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

        {/* Auto Rank (2h) token exchange */}
        {(tokens.auto_rank_2h?.count ?? 0) > 0 && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in mobile-panel`} style={{ animationDelay: '0.16s' }}>
            <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <ArrowLeftRight size={14} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Exchange Auto Rank</h2>
            </div>
            <div className="p-2.5 space-y-2">
              <p className="text-[8px] text-mutedForeground font-heading leading-snug">
                Trade <span className="text-foreground">1× Auto Rank (2h)</span> for <span className="text-foreground">2 random</span> other boost tokens. No cash or rank points.
              </p>
              <button
                type="button"
                disabled={exchangingAutoRank || (tokens.auto_rank_2h?.count ?? 0) < 1}
                onClick={exchangeAutoRank}
                className="px-2.5 py-1.5 rounded text-[9px] font-heading font-bold border border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {exchangingAutoRank ? '…' : 'Exchange 1 token'}
              </button>
            </div>
          </div>
        )}

        {/* Consumables / Tokens */}
        {INVENTORY_TOKEN_TYPES.some((k) => (tokens[k]?.count ?? 0) > 0 || tokens[k]?.active_until) && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in mobile-panel`} style={{ animationDelay: '0.18s' }}>
            <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Zap size={14} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Consumables</h2>
            </div>
            <div className="p-2.5 space-y-2">
              <p className="text-[8px] text-mutedForeground font-heading leading-snug border-b border-zinc-700/30 pb-2 mb-1">
                Use all only spends tokens that add a full token duration toward this row&apos;s max stack (or until you run out). Tiny leftover headroom is not filled, and extra tokens stay in your inventory.
              </p>
              {INVENTORY_TOKEN_TYPES.filter((key) => (tokens[key]?.count ?? 0) > 0 || tokens[key]?.active_until).map((key) => {
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
                        <div className="text-[9px] text-primary mt-0.5">
                          Active until {new Date(t.active_until).toLocaleString(undefined, { timeZone: 'UTC' })} UTC
                        </div>
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
                  <span className="text-[9px] text-amber-400">
                    {(String(c.rarity || '').toLowerCase() === 'exclusive') ? 'Exclusive' : 'Loot Exclusive'}
                  </span>
                  <Link to="/cars/garage" className="ml-auto text-[9px] text-primary hover:underline">View in Garage →</Link>
                </div>
              ))}
              {hasSpeakeasy && speakeasyInfo && (
                <div className="inv-item relative overflow-hidden rounded-lg border-2 border-amber-500/40 bg-amber-950/20 ring-1 ring-amber-500/20 shadow-[0_0_24px_rgba(245,158,11,0.12)] p-3">
                  <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400/70 to-transparent pointer-events-none" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2 mb-3 pt-0.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/20 to-primary/10">
                      <Building2 size={16} className="text-amber-400" />
                    </div>
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-heading font-bold text-amber-400 tracking-wide">Speakeasy</span>
                      <span className="text-[8px] font-heading font-bold uppercase tracking-wider text-amber-300 border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 rounded-full">
                        Loot exclusive
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    <div className="rounded-md border border-emerald-500/25 bg-emerald-950/20 px-2.5 py-2">
                      <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground mb-0.5">Daily cash</div>
                      <div className="text-lg font-heading font-bold text-emerald-400 leading-tight">
                        ${speakeasyInfo.daily_cash != null ? Number(speakeasyInfo.daily_cash).toLocaleString() : '—'}
                      </div>
                    </div>
                    <div className="rounded-md border border-sky-500/25 bg-sky-950/15 px-2.5 py-2">
                      <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground mb-0.5">Daily bullets</div>
                      <div className="text-lg font-heading font-bold text-sky-400 leading-tight">
                        {speakeasyInfo.daily_bullets != null ? speakeasyInfo.daily_bullets : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {speakeasyInfo.can_collect ? (
                      <button
                        type="button"
                        onClick={collectSpeakeasy}
                        disabled={collectingSpeakeasy}
                        className="px-4 py-2 rounded-md text-[9px] font-heading font-bold uppercase tracking-wider border-2 border-amber-500/50 bg-gradient-to-b from-amber-500/15 to-amber-950/30 text-amber-200 hover:border-amber-400/70 hover:shadow-[0_0_16px_rgba(245,158,11,0.25)] disabled:opacity-50 transition-all"
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
                <div className="inv-item flex flex-wrap items-center gap-2 py-2.5 px-2 rounded-lg border border-amber-500/25 ring-1 ring-amber-500/10 bg-amber-950/10">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/10">
                    <Building2 size={12} className="text-amber-400" />
                  </div>
                  <span className="text-[11px] font-heading text-amber-400/90 tracking-wide">Speakeasy</span>
                  <span className="text-[8px] font-heading font-bold uppercase tracking-wider text-amber-300/90 border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                    Loot exclusive
                  </span>
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
