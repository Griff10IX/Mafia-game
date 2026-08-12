import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Swords, Shield, Gift, Car, Building2, Zap, Target, ArrowLeftRight, Users, Clock, Minus, Plus } from 'lucide-react';
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

/** Keep in sync with backend armoury.AUTO_RANK_EXCHANGE_MAX_COUNT. */
const AUTO_RANK_EXCHANGE_MAX = 50;

/** Keep in sync with backend armoury.TOKEN_TYPES (+ jail_bailout which is count-only, used on the Jail page). */
const TOKEN_TYPES = [
  'xp_crimes', 'xp_gta', 'auto_rank_2h', 'crew_oc_auto_3h', 'melt', 'oc_reduced', 'booze', 'racket',
  'travel', 'properties', 'jailbust_bonus',
  'auto_collect_12h', 'auto_collect_24h',
  'cooldown_skip_crime', 'cooldown_skip_gta', 'cooldown_skip_booze', 'cooldown_skip_properties',
  'jail_bailout',
  'mission_skip',
  'robot_bodyguard_hire',
  'rank_xp_pass',
];
// Backend: all TOKEN_TYPES except rank_xp_pass / crew_oc_auto_3h; jail_bailout is not giftable either.
const GIFTABLE_TOKEN_TYPES = TOKEN_TYPES.filter((k) => !['rank_xp_pass', 'crew_oc_auto_3h', 'jail_bailout', 'mission_skip', 'robot_bodyguard_hire'].includes(k));
// Cooldown skip vouchers activate one at a time (backend rejects use_all).
const NO_USE_ALL_TOKEN_TYPES = new Set(['cooldown_skip_crime', 'cooldown_skip_gta', 'cooldown_skip_booze', 'cooldown_skip_properties']);
// Count-only tokens have no Use button here (spent from their own page).
const COUNT_ONLY_TOKEN_TYPES = new Set(['jail_bailout', 'mission_skip', 'robot_bodyguard_hire']);
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
  auto_collect_12h: { name: 'Auto-collect (12h)', icon: Building2, desc: `Auto-collect family rackets when cooldowns allow (properties have their own Auto Collect perk). 12h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  auto_collect_24h: { name: 'Auto-collect (24h)', icon: Building2, desc: `Auto-collect family rackets when cooldowns allow (properties have their own Auto Collect perk). 24h per token (stack up to ${TOKEN_MAX_STACK_LABEL})` },
  cooldown_skip_crime: { name: 'Crime cooldown skip', icon: Zap, desc: 'Activate to skip one crime cooldown (max 5,000 activations/day; other skip types 200/day).' },
  cooldown_skip_gta: { name: 'GTA cooldown skip', icon: Zap, desc: 'Activate to skip one GTA cooldown (1,000/day cap).' },
  cooldown_skip_booze: { name: 'Booze travel skip', icon: Zap, desc: 'Activate to skip one booze-run travel wait (200/day cap).' },
  cooldown_skip_properties: { name: 'Properties collect skip', icon: Zap, desc: 'Skip property collect cooldowns — ⚡ Skip Collect All covers every business for 1 token (3/day).' },
  jail_bailout: { name: 'Jail bailout token', icon: Target, desc: 'Instant leave jail — use it from the Jail page (500 uses/day UTC; does not bypass OC lockdown).' },
  mission_skip: { name: 'Mission Skip', icon: Zap, desc: 'Ultra rare — instantly complete your current open mission and claim its rewards. Use from the Missions page. Wheel of Fortune only.' },
  robot_bodyguard_hire: { name: 'Free Robot Bodyguard', icon: Shield, desc: 'Rare — hire one robot bodyguard for free (instead of paying points). Auto-used on Kill → Bodyguards when you hire. Wheel of Fortune only.' },
  rank_xp_pass: { name: 'Game Pass', icon: Package, desc: 'Activate in Armoury/My Inventory to claim one-time Game Pass rewards. Expires in 1 month if unused.' },
};

import {
  fmtPerkMoney,
  fmtPerkNum,
  fmtPerkDuration,
  buildPerkStatChipsForType,
} from '../../utils/perkStatChips';

/* ---- Perks-in-use card helpers ---- */
const fmtMoney = fmtPerkMoney;
const fmtNum = fmtPerkNum;
const fmtDuration = fmtPerkDuration;

const autoCollectStatChips = (t, data, { active = false } = {}) => {
  const chips = [];
  const s = t?.auto_collect_stats || {};
  if (Number(s.property_cash) > 0) {
    chips.push({ label: 'Collected to you', value: fmtMoney(s.property_cash), cls: 'text-emerald-300' });
  }
  if (Number(s.racket_cash) > 0) {
    chips.push({ label: 'To family vault', value: fmtMoney(s.racket_cash), cls: 'text-emerald-300' });
  }
  if (Number(s.collects) > 0) {
    chips.push({ label: 'Collects', value: fmtNum(s.collects), cls: 'text-foreground' });
  }
  if (s.last_collected_at) {
    chips.push({
      label: 'Last collect',
      value: `${new Date(s.last_collected_at).toLocaleTimeString(undefined, {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })} UTC`,
      cls: 'text-zinc-300',
    });
  }
  if (Number(s.last_cash) > 0) {
    chips.push({ label: 'Last payout', value: `+${fmtMoney(s.last_cash).slice(1)}`, cls: 'text-emerald-300' });
  }
  if (active) {
    const nextAt = data?.auto_collect?.next_check_at;
    const mins = Math.max(1, Math.round((data?.auto_collect?.interval_seconds || 300) / 60));
    chips.push({
      label: 'Next check',
      value:
        nextAt && new Date(nextAt) > new Date()
          ? `${new Date(nextAt).toLocaleTimeString(undefined, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC`
          : `≤${mins} min`,
      cls: 'text-sky-300',
    });
    chips.push({ label: 'Check every', value: `${mins} min`, cls: 'text-zinc-400' });
  }
  if (chips.length === 0 && active) {
    chips.push({ label: 'Status', value: 'Waiting for first collect', cls: 'text-zinc-400' });
  }
  return chips;
};

const renderStatChips = (chips) => {
  if (!chips?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {chips.map((c) => (
        <div key={c.label} className="rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2.5 py-2 min-w-0">
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground truncate">{c.label}</div>
          <div className={`text-[11px] font-heading font-bold truncate ${c.cls || 'text-foreground'}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
};

const countdownLabel = (until) => {
  const diff = new Date(until) - Date.now();
  if (diff <= 0) return 'Expired';
  const mins = Math.floor(diff / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m left`;
  return '<1m left';
};

export default function MyInventory() {
  const [hasLoaded, setHasLoaded] = useState(Boolean(_cachedInventory));
  const [data, setData] = useState(_cachedInventory);
  const [activeTab, setActiveTab] = useState(() => {
    try { return sessionStorage.getItem('inv_tab') || 'weapons'; } catch (_) { return 'weapons'; }
  });
  const switchTab = (id) => {
    setActiveTab(id);
    try { sessionStorage.setItem('inv_tab', id); } catch (_) {}
  };
  const [equipping, setEquipping] = useState({ weapon: null, armour: null });
  const [usingToken, setUsingToken] = useState(null);
  const [autoRankRunning, setAutoRankRunning] = useState(null);
  const [collectingSpeakeasy, setCollectingSpeakeasy] = useState(false);
  const [exchangingAutoRank, setExchangingAutoRank] = useState(false);
  const [autoRankExchangeCount, setAutoRankExchangeCount] = useState('1');
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

  // Re-render every 30s so the In-use countdown pills stay fresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
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
    const amt = Math.max(1, Math.min(held, rem, parseInt(String(giftAmount), 10) || 1));
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

  if (hasLoaded && !data) {
    return (
      <div className={`${styles.pageContent} p-4 mobile-page-root`}>
        <p className="text-mutedForeground">Failed to load inventory.</p>
      </div>
    );
  }

  const weapons = (data?.weapons || []).filter((w) => w.owned);
  const armourOptions = (data?.armour?.options || []).filter((o) => o.owned);
  const loot = data?.loot_exclusives || {};
  const exclusiveCars = loot.exclusive_cars || [];
  const hasSpeakeasy = loot.has_speakeasy === true;
  const speakeasyInfo = loot.speakeasy || null;
  const isAdmin = data?.is_admin === true;
  const tokens = data?.tokens || {};

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

  const tokenGiftDaily = data?.token_gift_daily || TOKEN_GIFT_DAILY_DEFAULT;
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
    const held = tokens.auto_rank_2h?.count ?? 0;
    const count = Math.max(1, Math.min(AUTO_RANK_EXCHANGE_MAX, held, parseInt(String(autoRankExchangeCount).replace(/\D/g, ''), 10) || 1));
    if (held < 1) {
      toast.error('No Auto Rank (2h) tokens to exchange.');
      return;
    }
    if (count > held) {
      toast.error(`You only have ${held} Auto Rank (2h) token${held === 1 ? '' : 's'}.`);
      return;
    }
    setExchangingAutoRank(true);
    try {
      const res = await api.post('/inventory/tokens/exchange-auto-rank', { count });
      if (res?.data?.tokens) setData((d) => (d ? { ...d, tokens: res.data.tokens } : d));
      const ex = res?.data?.exchange;
      const consumed = Number(ex?.consumed_auto_rank_2h || count) || count;
      const summary = ex?.granted_summary || [];
      const rows = summary.length
        ? summary
        : (ex?.granted_tokens || []);
      const n = summary.length
        ? summary.reduce((s, g) => s + (Number(g.amount) || 0), 0)
        : rows.length;
      const names = summary.length
        ? summary.map((g) => `${g.amount || 1}× ${tokenLabels[g.type]?.name || g.type}`).join(', ')
        : rows.map((g) => tokenLabels[g.type]?.name || g.type).join(', ');
      if (n > 0 && names) {
        toast.success(
          `Traded ${consumed} Auto Rank (2h) for ${n} boost token${n === 1 ? '' : 's'}`,
          { description: names },
        );
      } else {
        toast.success(res?.data?.message || 'Exchange complete.');
      }
      const nextHeld = Math.max(0, held - consumed);
      setAutoRankExchangeCount(String(Math.min(count, Math.max(1, nextHeld || 1))));
      refreshUser();
      fetchInventory();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to exchange');
    } finally {
      setExchangingAutoRank(false);
    }
  };

  const nowDate = new Date();
  const heldTokenKeys = TOKEN_TYPES.filter(
    (key) => (tokens[key]?.count ?? 0) > 0 || (key === 'rank_xp_pass' && tokens[key]?.expires_at),
  );
  const activeTokenKeys = TOKEN_TYPES.filter((key) => {
    if (key === 'rank_xp_pass') return false;
    // Count-only tokens (jail bailout): show while held so AR/manual use stats stay visible.
    if (COUNT_ONLY_TOKEN_TYPES.has(key)) {
      return (tokens[key]?.count ?? 0) > 0 || Number(tokens[key]?.perk_stats?.uses || 0) > 0;
    }
    // Cooldown skip tokens count as "in use" while activated credits are waiting to be spent.
    if ((tokens[key]?.credits ?? 0) > 0) return true;
    const until = tokens[key]?.active_until;
    return until && new Date(until) > nowDate;
  });
  const hasExclusives = exclusiveCars.length > 0 || hasSpeakeasy;

  const tabs = [
    { id: 'weapons', label: 'Weapons', icon: Swords, count: weapons.length },
    { id: 'armour', label: 'Armour', icon: Shield, count: armourOptions.length },
    { id: 'tokens', label: 'Tokens', icon: Zap, count: heldTokenKeys.length },
    { id: 'active', label: 'In use', icon: Clock, count: activeTokenKeys.length },
    ...(hasExclusives
      ? [{ id: 'exclusives', label: 'Exclusives', icon: Gift, count: exclusiveCars.length + (hasSpeakeasy ? 1 : 0) }]
      : []),
  ];
  const currentTab = tabs.some((t) => t.id === activeTab) ? activeTab : 'weapons';

  const renderTokenRow = (key) => {
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
      <div key={key} className="rounded-lg border border-primary/20 bg-zinc-900/40 p-2.5 space-y-2 inv-fade-in">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <Icon size={14} className="text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-heading font-bold text-foreground truncate">{name}</span>
                <span className="text-[9px] text-mutedForeground shrink-0">×{t.count} held</span>
              </div>
              {desc && <div className="text-[9px] text-mutedForeground mt-0.5 leading-snug">{desc}</div>}
            </div>
          </div>
          {untilLive && t.active_until && (
            <span
              className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-heading font-bold ${
                crewWindowNoCap
                  ? 'border-amber-500/45 bg-amber-500/10 text-amber-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              <Clock size={9} className="shrink-0" />
              {countdownLabel(t.active_until)}
            </span>
          )}
        </div>
        <div className="min-w-0">
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
          {(key === 'auto_collect_12h' || key === 'auto_collect_24h') && (active || Number(t.auto_collect_stats?.collects || 0) > 0) && (
            <div className="mt-1.5">
              {renderStatChips(autoCollectStatChips(t, data, { active }))}
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
        {renderStatChips(buildPerkStatChipsForType(key, t.perk_stats))}
        {renderTokenActions(key, t, { active, untilLive, crewWindowNoCap, expired })}
      </div>
    );
  };

  const renderGearCard = ({ key, Icon, name, badge, equipped, chips, onAction, actionBusy, actionLabel }) => (
    <div key={key} className="rounded-lg border border-primary/20 bg-zinc-900/40 p-2.5 space-y-2 inv-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <Icon size={14} className="text-primary" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-heading font-bold text-foreground truncate block">{name}</span>
            {badge && (
              <span className="text-[8px] font-heading font-bold uppercase tracking-wider text-amber-300 border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 rounded-full inline-block mt-0.5">
                {badge}
              </span>
            )}
          </div>
        </div>
        {equipped && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-heading font-bold text-emerald-300">
            ✓ Equipped
          </span>
        )}
      </div>
      {chips.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {chips.map((c) => (
            <div key={c.label} className="rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2.5 py-2 min-w-0">
              <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground truncate">{c.label}</div>
              <div className={`text-[11px] font-heading font-bold truncate ${c.cls || 'text-foreground'}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={actionBusy}
          onClick={onAction}
          className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );

  const renderTokenActions = (key, t, { active, untilLive, crewWindowNoCap, expired }) => (
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
      {COUNT_ONLY_TOKEN_TYPES.has(key) ? (
        <Link
          to={
            key === 'mission_skip'
              ? '/account/missions'
              : key === 'robot_bodyguard_hire'
                ? '/kill/bodyguards'
                : '/crime/jail'
          }
          className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
        >
          {key === 'mission_skip'
            ? 'Use on Missions →'
            : key === 'robot_bodyguard_hire'
              ? 'Use on Bodyguards →'
              : 'Use on Jail page →'}
        </Link>
      ) : (
        <button
          type="button"
          disabled={t.count < 1 || usingToken !== null || expired || (key === 'crew_oc_auto_3h' && crewOcModal)}
          onClick={() => (key === 'crew_oc_auto_3h' ? openCrewOcModal(false) : activateToken(key, false))}
          className="px-2 py-1 rounded text-[9px] font-heading font-bold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {usingToken === key ? '...' : 'Use'}
        </button>
      )}
      {key !== 'rank_xp_pass' && !NO_USE_ALL_TOKEN_TYPES.has(key) && !COUNT_ONLY_TOKEN_TYPES.has(key) && (
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
  );

  const renderActivePerkCard = (key) => {
    const t = tokens[key] || { count: 0, active_until: null, expires_at: null };
    const { name, icon: Icon } = tokenLabels[key] || { name: key, icon: Zap };
    const untilLive = t.active_until ? new Date(t.active_until) > new Date() : false;
    const active = untilLive && (key !== 'crew_oc_auto_3h' || t.auto_apply_ready);
    const crewWindowNoCap = key === 'crew_oc_auto_3h' && untilLive && !t.auto_apply_ready;

    const chips = buildPerkStatChipsForType(key, t.perk_stats);
    if (key === 'auto_collect_12h' || key === 'auto_collect_24h') {
      chips.push(...autoCollectStatChips(t, data, { active }));
    }
    if (key === 'crew_oc_auto_3h' && active && t.max_join_fee != null) {
      chips.push({ label: 'Max join fee cap', value: fmtMoney(t.max_join_fee), cls: 'text-amber-300' });
    }

    return (
      <div key={key} className="rounded-lg border border-primary/20 bg-zinc-900/40 p-2.5 space-y-2 inv-fade-in">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <Icon size={14} className="text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-heading font-bold text-foreground truncate">{name}</span>
                {t.count > 0 && <span className="text-[9px] text-mutedForeground shrink-0">×{t.count} held</span>}
              </div>
              {t.active_until && (
                <div className="text-[8px] text-mutedForeground mt-0.5">
                  Until {new Date(t.active_until).toLocaleString(undefined, { timeZone: 'UTC' })} UTC
                </div>
              )}
            </div>
          </div>
          {t.active_until ? (
            <span
              className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-heading font-bold ${
                crewWindowNoCap
                  ? 'border-amber-500/45 bg-amber-500/10 text-amber-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              <Clock size={9} className="shrink-0" />
              {countdownLabel(t.active_until)}
            </span>
          ) : Number(t.credits || 0) > 0 ? (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-heading font-bold text-emerald-300">
              <Zap size={9} className="shrink-0" />
              {Number(t.credits)} credit{Number(t.credits) === 1 ? '' : 's'} ready
            </span>
          ) : null}
        </div>
        {crewWindowNoCap && (
          <p className="text-[9px] text-amber-300/90 leading-snug">
            Set a max join fee to enable auto-apply — no extra token is consumed.
          </p>
        )}
        {chips.length > 0 ? (
          renderStatChips(chips)
        ) : (
          <div className="rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2.5 py-2 inline-block">
            <div className="text-[9px] font-heading text-mutedForeground">Builds as you play</div>
          </div>
        )}
        {renderTokenActions(key, t, { active, untilLive, crewWindowNoCap, expired: false })}
      </div>
    );
  };

  const crewOcModalPanel = crewOcModal ? (
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
  ) : null;

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}>
      <style>{INV_STYLES}</style>
      <div className="max-w-4xl mx-auto space-y-3">
        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 inv-fade-in" style={{ animationDelay: '0.05s', scrollbarWidth: 'none' }}>
          {tabs.map(({ id, label, icon: TabIcon, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-heading font-bold uppercase tracking-wider transition-all touch-manipulation ${
                currentTab === id
                  ? 'bg-primary/20 border-primary/50 text-primary'
                  : 'bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
              }`}
            >
              <TabIcon size={11} className="shrink-0" />
              {label}
              {count > 0 && (
                <span className={`text-[8px] px-1 rounded-full border ${currentTab === id ? 'border-primary/40 text-primary' : 'border-zinc-600/50 text-zinc-500'}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Weapons tab */}
        {currentTab === 'weapons' && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 min-w-0 inv-fade-in mobile-panel`}>
            <div className="px-2 py-1.5 sm:px-2.5 sm:py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-1.5">
              <Swords size={12} className="text-primary shrink-0" />
              <h2 className="text-[9px] sm:text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Weapons</h2>
            </div>
            <div className="p-2 sm:p-2.5 space-y-2">
              {weapons.length === 0 ? (
                <div className="py-3 text-[9px] text-mutedForeground font-heading text-center">No weapons owned</div>
              ) : (
                weapons.map((w) =>
                  renderGearCard({
                    key: w.id,
                    Icon: Swords,
                    name: w.name,
                    badge: w.loot_exclusive ? 'Loot exclusive' : w.store_exclusive ? 'Store exclusive' : null,
                    equipped: w.equipped,
                    chips: [
                      { label: 'Damage', value: fmtNum(w.damage), cls: 'text-red-300' },
                      ...(Number(w.quantity) > 1 ? [{ label: 'Owned', value: `×${fmtNum(w.quantity)}` }] : []),
                    ],
                    onAction: () => (w.equipped ? unequipWeapon() : equipWeapon(w.id)),
                    actionBusy: equipping.weapon !== null,
                    actionLabel:
                      equipping.weapon === w.id || (equipping.weapon === '' && w.equipped)
                        ? '...'
                        : w.equipped
                          ? 'Unequip'
                          : 'Equip',
                  })
                )
              )}
            </div>
          </div>
        )}

        {/* Armour tab */}
        {currentTab === 'armour' && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 min-w-0 inv-fade-in mobile-panel`}>
            <div className="px-2 py-1.5 sm:px-2.5 sm:py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-1.5">
              <Shield size={12} className="text-primary shrink-0" />
              <h2 className="text-[9px] sm:text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Armour</h2>
            </div>
            <div className="p-2 sm:p-2.5 space-y-2">
              {armourOptions.length === 0 ? (
                <div className="py-3 text-[9px] text-mutedForeground font-heading text-center">No armour owned</div>
              ) : (
                armourOptions.map((o) =>
                  renderGearCard({
                    key: o.level,
                    Icon: Shield,
                    name: o.name,
                    badge: o.loot_exclusive ? 'Loot exclusive' : o.store_exclusive ? 'Store exclusive' : null,
                    equipped: o.equipped,
                    chips: [{ label: 'Level', value: `Lv. ${o.level}`, cls: 'text-sky-300' }],
                    onAction: () => (o.equipped ? unequipArmour() : equipArmour(o.level)),
                    actionBusy: equipping.armour !== null,
                    actionLabel:
                      equipping.armour === o.level || (equipping.armour === 0 && o.equipped)
                        ? '...'
                        : o.equipped
                          ? 'Unequip'
                          : 'Equip',
                  })
                )
              )}
            </div>
          </div>
        )}

        {(currentTab === 'weapons' || currentTab === 'armour') && (
          <div className="inv-fade-in" style={{ animationDelay: '0.1s' }}>
            <Link to="/armour-weapons" className="text-[10px] font-heading text-mutedForeground hover:text-primary transition-colors">
              Buy more weapons & armour at the Armoury →
            </Link>
          </div>
        )}

        {/* Tokens in use tab */}
        {currentTab === 'active' && (
          <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in mobile-panel`}>
            <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Clock size={14} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Perks in use</h2>
            </div>
            {crewOcModalPanel}
            <div className="p-2.5 space-y-2">
              {activeTokenKeys.length === 0 ? (
                <p className="py-3 text-[9px] text-mutedForeground font-heading text-center">
                  No perks active right now — activate one from the Tokens tab.
                </p>
              ) : (
                activeTokenKeys.map(renderActivePerkCard)
              )}
            </div>
          </div>
        )}

        {/* Tokens tab */}
        {currentTab === 'tokens' && (
          <>
            <div className={`${styles.panel} rounded-lg overflow-hidden border border-primary/20 inv-fade-in mobile-panel`}>
              <div className="px-2.5 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
                <Zap size={14} className="text-primary" />
                <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Consumables</h2>
              </div>
              {crewOcModalPanel}
              <div className="p-2.5 space-y-2">
                <p className="text-[8px] text-mutedForeground font-heading leading-snug border-b border-zinc-700/30 pb-2 mb-1">
                  Use all only spends tokens that add a full token duration toward this row&apos;s max stack (or until you run out). Tiny leftover headroom is not filled, and extra tokens stay in your inventory.
                </p>
                {heldTokenKeys.length === 0 ? (
                  <p className="py-3 text-[9px] text-mutedForeground font-heading text-center">
                    No tokens held — earn them in-game or buy them in the Points Store.
                  </p>
                ) : (
                  heldTokenKeys.map(renderTokenRow)
                )}
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
                Trade <span className="text-foreground">1× Auto Rank (2h)</span> for <span className="text-foreground">2 random</span> other boost tokens (each). No cash or rank points.{' '}
                <Link to="/money/quick-trade" className="text-primary hover:underline">Sell on Quick Trade →</Link>
              </p>
              {(() => {
                const held = tokens.auto_rank_2h?.count ?? 0;
                const maxEx = Math.max(1, Math.min(AUTO_RANK_EXCHANGE_MAX, held));
                const n = Math.max(1, Math.min(maxEx, parseInt(String(autoRankExchangeCount).replace(/\D/g, ''), 10) || 1));
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="autoRankExchangeCount" className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground whitespace-nowrap">
                      Amount
                    </label>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Fewer tokens"
                        disabled={exchangingAutoRank || n <= 1}
                        onClick={() => setAutoRankExchangeCount(String(Math.max(1, n - 1)))}
                        className="inline-flex items-center justify-center w-8 h-8 rounded border border-zinc-600/60 bg-zinc-800/50 text-foreground touch-manipulation disabled:opacity-40"
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        id="autoRankExchangeCount"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        value={autoRankExchangeCount}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
                          if (digits === '') {
                            setAutoRankExchangeCount('');
                            return;
                          }
                          const parsed = parseInt(digits, 10);
                          if (!Number.isFinite(parsed)) return;
                          setAutoRankExchangeCount(String(Math.min(maxEx, parsed)));
                        }}
                        onBlur={() => setAutoRankExchangeCount(String(Math.max(1, Math.min(maxEx, parseInt(String(autoRankExchangeCount), 10) || 1))))}
                        className="w-12 min-h-[32px] bg-zinc-900/50 border border-zinc-700/50 rounded px-1 text-[11px] text-foreground font-heading text-center touch-manipulation"
                      />
                      <button
                        type="button"
                        aria-label="More tokens"
                        disabled={exchangingAutoRank || n >= maxEx}
                        onClick={() => setAutoRankExchangeCount(String(Math.min(maxEx, n + 1)))}
                        className="inline-flex items-center justify-center w-8 h-8 rounded border border-zinc-600/60 bg-zinc-800/50 text-foreground touch-manipulation disabled:opacity-40"
                      >
                        <Plus size={13} />
                      </button>
                      {held > 1 && (
                        <button
                          type="button"
                          disabled={exchangingAutoRank}
                          onClick={() => setAutoRankExchangeCount(String(maxEx))}
                          className="px-2 min-h-[32px] rounded border border-primary/30 bg-primary/10 text-[8px] font-heading font-bold uppercase tracking-wider text-primary touch-manipulation disabled:opacity-50"
                        >
                          Max ({maxEx})
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={exchangingAutoRank || held < 1}
                      onClick={exchangeAutoRank}
                      className="px-2.5 py-1.5 rounded text-[9px] font-heading font-bold border border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {exchangingAutoRank ? '…' : `Exchange ${n} token${n === 1 ? '' : 's'} → ${n * 2} boosts`}
                    </button>
                  </div>
                );
              })()}
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
                  max={Math.min(heldForGift || 1, dailyRemaining || 1)}
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
          </>
        )}

        {/* Loot Exclusives */}
        {currentTab === 'exclusives' && hasExclusives && (
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

      </div>
    </div>
  );
}
