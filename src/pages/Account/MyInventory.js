import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Swords, Shield, Gift, Car, Building2, Zap, Target, ArrowLeftRight, Users } from 'lucide-react';
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

const TOKEN_TYPES = ['xp_crimes', 'xp_gta', 'auto_rank_2h', 'crew_oc_auto_3h', 'melt', 'oc_reduced', 'booze', 'racket', 'travel', 'properties', 'jailbust_bonus', 'rank_xp_pass'];
const GIFTABLE_TOKEN_TYPES = TOKEN_TYPES.filter((k) => k !== 'rank_xp_pass' && k !== 'crew_oc_auto_3h');
const TOKEN_GIFT_DAILY_DEFAULT = { sent: 0, limit: 20 };
/** Keep in sync with backend armoury.TOKEN_MAX_STACK_HOURS (7 × 24 = 1 week). */
const TOKEN_MAX_STACK_LABEL = '1 week';

const tokenLabels = {
  xp_crimes: { name: 'Crimes XP', icon: Zap, desc: `Double XP from crimes, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  xp_gta: { name: 'GTA XP', icon: Zap, desc: `Double XP from GTA, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  auto_rank_2h: { name: 'Auto Rank (2h)', icon: Zap, desc: `Temporary Auto Rank access, 2h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  crew_oc_auto_3h: {
    name: 'Crew OC auto-apply (3h)',
    icon: Users,
    desc: `Set a max join fee when you use it — auto-apply only runs after that (families above your cap are skipped). 3h per token, stack up to ${TOKEN_MAX_STACK_LABEL}.`,
  },
  melt: { name: 'Melt', icon: Zap, desc: `Reduced melt (bullets) cooldown, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  oc_reduced: { name: 'OC Reduced', icon: Zap, desc: `Reduced OC cooldown, setup cost & higher payout, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  booze: { name: 'Booze', icon: Zap, desc: `Booze costs less to buy, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  racket: { name: 'Racket', icon: Zap, desc: `Increased racket (illegal business) profit, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  travel: { name: 'Travel', icon: Zap, desc: `Lower airport cost & 2% car travel time reduction, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  properties: { name: 'Properties', icon: Building2, desc: `3× property income, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  jailbust_bonus: { name: 'Jailbust bonus', icon: Target, desc: `+10% jail bust success, less chance of jail on fail, 1h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  rank_xp_pass: { name: 'Game Pass', icon: Package, desc: 'Activate in Armoury/My Inventory to claim one-time Game Pass rewards. Expires in 1 month if unused.' },
};

export default function MyInventory() {
  const [hasLoaded, setHasLoaded] = useState(Boolean(_cachedInventory));
  const [data, setData] = useState(_cachedInventory);
  const [equipping, setEquipping] = useState({ weapon: null, armour: null });
  const [usingToken, setUsingToken] = useState(null);
  const [autoRankRunning, setAutoRankRunning] = useState(null);
  const [collectingSpeakeasy, setCollectingSpeakeasy] = useState(false);
  const [exchangingAutoRank, setExchangingAutoRank] = useState(false);
  const [giftUsername, setGiftUsername] = useState('');
  const [giftTokenType, setGiftTokenType] = useState('');
  const [giftAmount, setGiftAmount] = useState(1);
  const [gifting, setGifting] = useState(false);
  const [speakeasyGiftUsername, setSpeakeasyGiftUsername] = useState('');
  const [speakeasyGifting, setSpeakeasyGifting] = useState(false);
  const [crewOcModal, setCrewOcModal] = useState(null);
  const [crewOcMaxFeeStr, setCrewOcMaxFeeStr] = useState('');

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
    if (!tok) return;
    const withStock = GIFTABLE_TOKEN_TYPES.filter((k) => (tok[k]?.count ?? 0) > 0);
    if (withStock.length === 0) {
      setGiftTokenType('');
      return;
    }
    setGiftTokenType((cur) => {
      if (!cur || (tok[cur]?.count ?? 0) < 1) return withStock[0];
      return cur;
    });
  }, [data?.tokens]);

  useEffect(() => {
    const until = data?.tokens?.auto_rank_2h?.active_until;
    if (!until || new Date(until) <= new Date()) {
      setAutoRankRunning(null);
      return;
    }
    api.get('/auto-rank/me')
      .then((res) => setAutoRankRunning(res.data?.auto_rank_enabled === true))
      .catch(() => setAutoRankRunning(null));
  }, [data?.tokens?.auto_rank_2h?.active_until, data?.tokens?.auto_rank_2h?.count]);

  const setAutoRankMaster = async (enabled) => {
    setUsingToken('auto_rank_pause');
    try {
      await api.patch('/auto-rank/me', { auto_rank_enabled: enabled });
      setAutoRankRunning(enabled);
      toast.success(
        enabled
          ? 'Auto Rank resumed'
          : 'Auto Rank paused — your remaining trial time is unchanged',
      );
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update Auto Rank');
    } finally {
      setUsingToken(null);
    }
  };

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
      if (tokenType === 'auto_rank_2h') setAutoRankRunning(true);
      toast.success(res?.data?.message || 'Token used.');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to use token');
    } finally {
      setUsingToken(null);
    }
  };

  const formatCrewOcMaxFeeInput = (raw) => {
    let digits = raw.replace(/\D/g, '').slice(0, 15);
    if (!digits) return '';
    const n = parseInt(digits, 10);
    if (Number.isNaN(n)) return '';
    return n.toLocaleString('en-US');
  };

  const openCrewOcModal = (useAll) => {
    setCrewOcMaxFeeStr('');
    setCrewOcModal({ mode: 'use', useAll });
  };

  const openCrewOcEditModal = (maxFee) => {
    if (maxFee == null || maxFee === '') {
      setCrewOcMaxFeeStr('');
    } else {
      const n = Number(maxFee);
      setCrewOcMaxFeeStr(Number.isFinite(n) ? n.toLocaleString('en-US') : '');
    }
    setCrewOcModal({ mode: 'edit' });
  };

  const submitCrewOcEdit = async () => {
    if (!crewOcModal || crewOcModal.mode !== 'edit') return;
    const n = parseInt(String(crewOcMaxFeeStr).replace(/,/g, '').trim(), 10);
    if (Number.isNaN(n) || n < 0) {
      toast.error('Enter a max join fee (0 or more).');
      return;
    }
    setUsingToken('crew_oc_edit');
    try {
      const res = await api.post('/inventory/tokens/crew-oc-auto-apply-max-fee', {
        crew_oc_auto_apply_max_fee: n,
      });
      if (res?.data?.tokens) setData((d) => (d ? { ...d, tokens: res.data.tokens } : d));
      toast.success(res?.data?.message || 'Max join fee updated.');
      refreshUser();
      fetchInventory();
      setCrewOcModal(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update max join fee');
    } finally {
      setUsingToken(null);
    }
  };

  const submitCrewOcToken = async () => {
    if (!crewOcModal || crewOcModal.mode !== 'use') return;
    const n = parseInt(String(crewOcMaxFeeStr).replace(/,/g, '').trim(), 10);
    if (Number.isNaN(n) || n < 0) {
      toast.error('Enter a max join fee (0 or more). Auto-apply only starts after you set this cap.');
      return;
    }
    const crew_oc_auto_apply_max_fee = n;
    setUsingToken(crewOcModal.useAll ? 'crew_oc_auto_3h:all' : 'crew_oc_auto_3h');
    try {
      const res = await api.post('/inventory/tokens/use', {
        token_type: 'crew_oc_auto_3h',
        use_all: crewOcModal.useAll,
        crew_oc_auto_apply_max_fee,
      });
      if (res?.data?.tokens) setData((d) => (d ? { ...d, tokens: res.data.tokens } : d));
      toast.success(res?.data?.message || 'Token used.');
      refreshUser();
      fetchInventory();
      setCrewOcModal(null);
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

  const giftSpeakeasy = async () => {
    const un = speakeasyGiftUsername.trim();
    if (!un || speakeasyGifting) return;
    setSpeakeasyGifting(true);
    try {
      const res = await api.post('/loot-box/speakeasy/gift', { target_username: un });
      toast.success(res?.data?.message || 'Speakeasy transferred.');
      setSpeakeasyGiftUsername('');
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to gift Speakeasy');
    } finally {
      setSpeakeasyGifting(false);
    }
  };

  const sendGift = async () => {
    const un = giftUsername.trim();
    if (!un || !giftTokenType || !data?.tokens) return;
    const held = data.tokens[giftTokenType]?.count ?? 0;
    const sent = data.token_gift_daily?.sent ?? 0;
    const lim = data.token_gift_daily?.limit ?? 20;
    const rem = Math.max(0, lim - sent);
    const amt = Math.max(1, Math.min(15, held, rem, parseInt(String(giftAmount), 10) || 1));
    if (held < 1 || rem < 1) return;
    setGifting(true);
    try {
      const res = await api.post('/inventory/tokens/gift', {
        target_username: un,
        token_type: giftTokenType,
        amount: amt,
      });
      if (res?.data) {
        setData((d) => (d ? {
          ...d,
          ...(res.data.tokens ? { tokens: res.data.tokens } : {}),
          ...(res.data.token_gift_daily ? { token_gift_daily: res.data.token_gift_daily } : {}),
        } : d));
      }
      toast.success(res?.data?.message || 'Gift sent.');
      setGiftUsername('');
      refreshUser();
      fetchInventory();
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(Array.isArray(d) ? d.map((x) => x.msg || JSON.stringify(x)).join(', ') : (d || 'Failed to send gift'));
    } finally {
      setGifting(false);
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
  const isAdmin = data.is_admin === true;
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

  const tokenGiftDaily = data.token_gift_daily || TOKEN_GIFT_DAILY_DEFAULT;
  const giftableWithStock = GIFTABLE_TOKEN_TYPES.filter((k) => (tokens[k]?.count ?? 0) > 0);
  const heldForGift = giftTokenType ? (tokens[giftTokenType]?.count ?? 0) : 0;
  const dailyRemaining = Math.max(0, (tokenGiftDaily.limit ?? 20) - (tokenGiftDaily.sent ?? 0));
  const sendAmount = Math.max(1, Math.min(15, parseInt(String(giftAmount), 10) || 1));
  const canSendGift =
    Boolean(giftUsername.trim())
    && Boolean(giftTokenType)
    && heldForGift >= sendAmount
    && sendAmount <= dailyRemaining
    && !gifting;

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

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}>
      <style>{INV_STYLES}</style>
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-[10px] sm:text-xs text-mutedForeground font-heading inv-fade-in" style={{ animationDelay: '0.05s' }}>
          Equip your armour and weapons. View your loot-exclusive items.
        </p>

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

        {/* Gift perks (boost tokens only; not Game Pass) */}
        <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in mobile-panel`} style={{ animationDelay: '0.17s' }}>
          <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
            <Gift size={14} className="text-primary shrink-0" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Gift perks</h2>
          </div>
          <div className="p-2.5 space-y-3">
            <p className="text-[8px] text-mutedForeground font-heading leading-relaxed">
              Enter their <span className="text-foreground font-bold">exact in-game username</span>, choose a perk you hold, amount, then{' '}
              <span className="text-foreground font-bold">Send gift</span>. Game Pass tokens cannot be gifted. Recipients can hold at most{' '}
              <span className="text-foreground font-bold">15</span> of each type. Daily send limit (UTC):{' '}
              <span className="text-foreground font-bold">
                {tokenGiftDaily.sent ?? 0}/{tokenGiftDaily.limit ?? 20}
              </span>
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-end gap-2">
              <label className="flex flex-col gap-0.5 min-w-0 flex-1 sm:min-w-[140px]">
                <span className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground">Their username</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="Player name"
                  value={giftUsername}
                  onChange={(ev) => setGiftUsername(ev.target.value)}
                  className="w-full rounded border border-primary/30 bg-background/80 px-2 py-1.5 text-[10px] font-heading text-foreground placeholder:text-mutedForeground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </label>
              <label className="flex flex-col gap-0.5 min-w-0 flex-1 sm:min-w-[160px]">
                <span className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground">Perk to send</span>
                <select
                  value={giftTokenType}
                  onChange={(ev) => setGiftTokenType(ev.target.value)}
                  disabled={giftableWithStock.length === 0}
                  className="w-full rounded border border-primary/30 bg-background/80 px-2 py-1.5 text-[10px] font-heading text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                >
                  {giftableWithStock.length === 0 ? (
                    <option value="">None in inventory</option>
                  ) : (
                    giftableWithStock.map((k) => (
                      <option key={k} value={k}>
                        {tokenLabels[k]?.name || k} (×{tokens[k]?.count ?? 0})
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 w-full sm:w-24 shrink-0">
                <span className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground">Amount</span>
                <input
                  type="number"
                  min={1}
                  max={Math.min(15, heldForGift || 15, dailyRemaining || 15)}
                  value={giftAmount}
                  onChange={(ev) => setGiftAmount(ev.target.value)}
                  disabled={giftableWithStock.length === 0}
                  className="w-full rounded border border-primary/30 bg-background/80 px-2 py-1.5 text-[10px] font-heading text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                />
              </label>
              <button
                type="button"
                disabled={!canSendGift}
                onClick={sendGift}
                className="w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded text-[9px] font-heading font-bold border border-primary/50 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 shrink-0"
              >
                {gifting ? '…' : 'Send gift'}
              </button>
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
            {crewOcModal && (
              <div className="px-2.5 py-2 border-b border-primary/15 bg-zinc-950/40 space-y-2">
                <p className="text-[9px] font-heading text-mutedForeground leading-snug">
                  {crewOcModal.mode === 'edit'
                    ? 'Change your max join fee ($) for the current window. No token is consumed. Families above this cap are skipped; use 0 for free-join only.'
                    : 'Max join fee ($): families charging more than this are skipped. Use 0 to only try free-join crews. The perk does not auto-apply until you confirm a cap.'}
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 5,000,000"
                  value={crewOcMaxFeeStr}
                  onChange={(e) => setCrewOcMaxFeeStr(formatCrewOcMaxFeeInput(e.target.value))}
                  className="w-full rounded border border-primary/30 bg-background/80 px-2 py-1.5 text-[10px] font-heading text-foreground"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={crewOcModal.mode === 'edit' ? submitCrewOcEdit : submitCrewOcToken}
                    disabled={usingToken !== null}
                    className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50"
                  >
                    {usingToken ? '…' : crewOcModal.mode === 'edit' ? 'Save cap' : crewOcModal.useAll ? 'Confirm use all' : 'Confirm use'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCrewOcModal(null)}
                    disabled={usingToken !== null}
                    className="px-2 py-1 rounded text-[9px] font-heading border border-zinc-600 text-mutedForeground hover:bg-zinc-800/50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <div className="p-2.5 space-y-2">
              <p className="text-[8px] text-mutedForeground font-heading leading-snug border-b border-zinc-700/30 pb-2 mb-1">
                Use all only spends tokens that add a full token duration toward this row&apos;s max stack (or until you run out). Tiny leftover headroom is not filled, and extra tokens stay in your inventory.
              </p>
              {TOKEN_TYPES.filter((key) => (tokens[key]?.count ?? 0) > 0 || tokens[key]?.active_until).map((key) => {
                const t = tokens[key] || { count: 0, active_until: null, expires_at: null };
                const { name, icon: Icon, desc } = tokenLabels[key] || { name: key, icon: Zap, desc: '' };
                // Game Pass is now one-time tier rewards (no 24h "active until" window).
                // Older DB rows may still have rank_xp_pass_bonus_until set, so we explicitly ignore it in UI.
                const untilLive =
                  key !== 'rank_xp_pass' && t.active_until ? new Date(t.active_until) > new Date() : false;
                const active =
                  untilLive && (key !== 'crew_oc_auto_3h' || t.auto_apply_ready);
                const crewWindowNoCap =
                  key === 'crew_oc_auto_3h' && untilLive && !t.auto_apply_ready;
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
                      {crewWindowNoCap && t.active_until && (
                        <div className="text-[9px] text-amber-300/90 mt-0.5">
                          Window until {new Date(t.active_until).toLocaleString(undefined, { timeZone: 'UTC' })} UTC — set a
                          max join fee to enable auto-apply (no extra token), or extend the window with Use and set a cap.
                        </div>
                      )}
                      {active && t.active_until && (
                        <div className="text-[9px] text-primary mt-0.5">
                          Active until {new Date(t.active_until).toLocaleString(undefined, { timeZone: 'UTC' })} UTC
                        </div>
                      )}
                      {active && t.max_join_fee != null && (
                        <div className="text-[9px] text-mutedForeground mt-0.5">
                          Max join fee cap:{' '}
                          <span className="text-foreground font-medium">
                            ${Number(t.max_join_fee).toLocaleString('en-US')}
                          </span>
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
                    <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                      {key === 'crew_oc_auto_3h' && active && (
                        <button
                          type="button"
                          disabled={usingToken !== null || crewOcModal}
                          onClick={() => openCrewOcEditModal(t.max_join_fee)}
                          className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-zinc-500/50 bg-zinc-800/40 text-zinc-200 hover:bg-zinc-700/50 disabled:opacity-50"
                        >
                          Edit cap
                        </button>
                      )}
                      {key === 'crew_oc_auto_3h' && crewWindowNoCap && (
                        <button
                          type="button"
                          disabled={usingToken !== null || crewOcModal}
                          onClick={() => openCrewOcEditModal(null)}
                          className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-amber-500/45 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          Set max fee
                        </button>
                      )}
                      {key === 'auto_rank_2h' && untilLive && (
                        <button
                          type="button"
                          disabled={usingToken !== null || autoRankRunning === null}
                          onClick={() => setAutoRankMaster(!autoRankRunning)}
                          className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-amber-500/45 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          {usingToken === 'auto_rank_pause' ? '…' : autoRankRunning ? 'Pause' : 'Resume'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={t.count < 1 || usingToken !== null || expired || (key === 'crew_oc_auto_3h' && crewOcModal)}
                        onClick={() => (key === 'crew_oc_auto_3h' ? openCrewOcModal(false) : activateToken(key, false))}
                        className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        {usingToken === key ? '...' : 'Use'}
                      </button>
                      {key !== 'rank_xp_pass' && (
                        <button
                          type="button"
                          disabled={t.count < 1 || usingToken !== null || (key === 'crew_oc_auto_3h' && crewOcModal)}
                          onClick={() => (key === 'crew_oc_auto_3h' ? openCrewOcModal(true) : activateToken(key, true))}
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
                  {isAdmin && (
                    <div className="mt-3 pt-3 border-t border-amber-500/25 space-y-1.5">
                      <p className="text-[8px] font-heading uppercase tracking-wider text-amber-200/80">Admin — gift Speakeasy</p>
                      <p className="text-[8px] text-mutedForeground leading-snug">Transfers your Speakeasy to their account. They must not already own one.</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={speakeasyGiftUsername}
                          onChange={(e) => setSpeakeasyGiftUsername(e.target.value)}
                          placeholder="Recipient username"
                          className="flex-1 min-w-[8rem] px-2 py-1.5 rounded-md border border-amber-500/30 bg-background/80 text-[10px] font-heading text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-amber-400/50"
                        />
                        <button
                          type="button"
                          onClick={giftSpeakeasy}
                          disabled={speakeasyGifting || !speakeasyGiftUsername.trim()}
                          className="px-3 py-1.5 rounded-md text-[9px] font-heading font-bold uppercase tracking-wider border border-amber-600/50 bg-amber-950/40 text-amber-100 hover:bg-amber-900/50 disabled:opacity-50"
                        >
                          {speakeasyGifting ? 'Sending…' : 'Gift Speakeasy'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {hasSpeakeasy && !speakeasyInfo && (
                <div className="inv-item flex flex-col gap-2 py-2.5 px-2 rounded-lg border border-amber-500/25 ring-1 ring-amber-500/10 bg-amber-950/10">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/10">
                      <Building2 size={12} className="text-amber-400" />
                    </div>
                    <span className="text-[11px] font-heading text-amber-400/90 tracking-wide">Speakeasy</span>
                    <span className="text-[8px] font-heading font-bold uppercase tracking-wider text-amber-300/90 border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                      Loot exclusive
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="space-y-1.5 pl-0.5">
                      <p className="text-[8px] font-heading uppercase tracking-wider text-amber-200/80">Admin — gift Speakeasy</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={speakeasyGiftUsername}
                          onChange={(e) => setSpeakeasyGiftUsername(e.target.value)}
                          placeholder="Recipient username"
                          className="flex-1 min-w-[8rem] px-2 py-1.5 rounded-md border border-amber-500/30 bg-background/80 text-[10px] font-heading"
                        />
                        <button
                          type="button"
                          onClick={giftSpeakeasy}
                          disabled={speakeasyGifting || !speakeasyGiftUsername.trim()}
                          className="px-3 py-1.5 rounded-md text-[9px] font-heading font-bold uppercase border border-amber-600/50 bg-amber-950/40 text-amber-100 disabled:opacity-50"
                        >
                          {speakeasyGifting ? 'Sending…' : 'Gift'}
                        </button>
                      </div>
                    </div>
                  )}
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
