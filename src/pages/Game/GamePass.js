import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Package, ShoppingBag, Clock } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';

import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import {
  GAME_PASS_DEAD_ALIVE_FINE_PRINT,
  GAME_PASS_DURATION_FINE_PRINT,
  GAME_PASS_DURATION_LABEL,
  GAME_PASS_PACKAGE_ID,
  GAME_PASS_POINTS_PRICE,
  GAME_PASS_PRICE_GBP,
  SILVER_PACK_POINTS,
  SILVER_PACK_PRICE_GBP,
  gamePassPurchaseBlockedFinalWindowMessage,
} from '../../constants/gamePassPricing';

// Must stay in sync with backend `utils/game_pass_micro_rewards.py` (used by armoury).
// We only display; activation/entitlement is still handled by the existing rank_xp_pass flow.
const MAX_THRESHOLD_RP = 1_000_000;

const MAX_MICRO_TIER = 100; // 1 micro tier = 1% of MAX_THRESHOLD_RP
const MICRO_TIER_STEP_RP = MAX_THRESHOLD_RP / MAX_MICRO_TIER; // 10,000 RP

// Must match backend `utils/game_pass_micro_rewards.py` REWARD_TIER_PROGRESS_GAMMA.
const REWARD_TIER_PROGRESS_GAMMA = 1.45;

function tierProgressMultiplier(t) {
  if (REWARD_TIER_PROGRESS_GAMMA <= 1) return 1;
  const tt = Math.max(1, Math.min(MAX_MICRO_TIER, Math.floor(t)));
  return (tt / MAX_MICRO_TIER) ** (REWARD_TIER_PROGRESS_GAMMA - 1);
}

function rewardWeight(t, baseTier) {
  return (t / baseTier) * tierProgressMultiplier(t);
}

// UI compression: render 10 band cards, but the details panel lists every micro tier in the band.
const BANDS = Array.from({ length: 10 }, (_, i) => {
  const start = i * 10 + 1;
  const end = (i + 1) * 10;
  return { start, end, index: i };
});

// (Legacy milestone-tier model removed in favor of the 1..100 micro-tier scaling model.)

function microTierToThresholdRp(microTier) {
  const t = Number(microTier || 0);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.max(0, Math.floor(t * MICRO_TIER_STEP_RP));
}

function ordinalSuffix(n) {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

/** e.g. Tuesday, 9th August 2026 — 12:00 (BST) — local timezone */
function formatGamePassEndDateTime(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const dayNum = date.getDate();
  const mon = date.toLocaleDateString('en-GB', { month: 'long' });
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const tz =
    new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName')
      ?.value || '';
  const line = `${weekday}, ${dayNum}${ordinalSuffix(dayNum)} ${mon} ${year} — ${time}`;
  return tz ? `${line} (${tz})` : line;
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Expired';
  const totalSec = Math.floor(ms / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600) % 24;
  const d = Math.floor(totalSec / 86400);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (d > 0 || h > 0) parts.push(`${h}h`);
  if (d > 0 || h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// Reward math / deterministic bucket selection must stay in sync with backend `game_pass_micro_rewards.py`.
const TARGET_CASH_TOTAL = 500_000_000;
const TARGET_POINTS_TOTAL = 10_000;
const TARGET_BULLETS_TOTAL = 250_000;
const TARGET_AUTO_RANK_2H_TOTAL = 75;
const TARGET_RANDOM_TOKENS_TOTAL = 250; // tokens chosen from this "random pool" set

const MONEY_BASE_TIER = 10;
const POINTS_BASE_TIER = 50;
const AUTO_RANK_2H_BASE_TIER = 100;

const SELECTABLE_RANDOM_TOKEN_KEYS = ['melt_tokens', 'jailbust_tokens', 'travel_tokens', 'properties_tokens'];

function normalizeBaseAmountToTotal(baseTier, targetTotal, initialBaseAmount) {
  let base = Number(initialBaseAmount) || 1;
  if (base <= 0) base = 1;
  const weights = Array.from({ length: 100 }, (_, i) => rewardWeight(i + 1, baseTier));
  for (let i = 0; i < 8; i += 1) {
    let s = 0;
    for (const w of weights) s += Math.ceil(base * w);
    if (s <= 0) return base;
    base *= targetTotal / s;
  }
  return base;
}

function normalizeBaseAmountToTotalForTiers(baseTier, targetTotal, tiers, initialBaseAmount) {
  let base = Number(initialBaseAmount) || 1;
  if (base <= 0) base = 1;
  const weights = tiers.map((tt) => rewardWeight(tt, baseTier));
  for (let i = 0; i < 8; i += 1) {
    let s = 0;
    for (const w of weights) s += Math.ceil(base * w);
    if (s <= 0) return base;
    base *= targetTotal / s;
  }
  return base;
}

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    t >>>= 0;
    return t / 4294967296; // 0..1
  };
}

function weightedPick(rng, keys, weightsByKey) {
  let total = 0;
  for (const k of keys) total += Number(weightsByKey[k] || 0);
  if (total <= 0) return null;
  const u = rng() * total;
  let acc = 0;
  for (const k of keys) {
    acc += Number(weightsByKey[k] || 0);
    if (u < acc) return k;
  }
  return keys[keys.length - 1] || null;
}

function distributeTotal(total, keys) {
  const n = Math.max(1, keys.length);
  const base = Math.floor(total / n);
  const rem = total % n;
  const out = {};
  keys.forEach((k, i) => { out[k] = base + (i < rem ? 1 : 0); });
  return out;
}

const TWO_BUCKET_CHANCE = 0.30;
const SEED_CATEGORY = 'game_pass_micro_rewards:category:v2';
const SEED_FREE = 'game_pass_micro_rewards:free:v2';

const SELECTABLE_KEYS = [
  'money',
  'bullets',
  'xp_crimes_tokens',
  'xp_gta_tokens',
  'points',
  ...SELECTABLE_RANDOM_TOKEN_KEYS,
];

const CATEGORY_WEIGHTS = {
  money: 60,
  bullets: 20,
  xp_crimes_tokens: 10,
  xp_gta_tokens: 10,
  points: 12,
  melt_tokens: 2,
  jailbust_tokens: 2,
  travel_tokens: 2,
  properties_tokens: 2,
};

const BASE_TIER_BY_KEY = {
  money: MONEY_BASE_TIER,
  bullets: 20,
  xp_crimes_tokens: 40,
  xp_gta_tokens: 40,
  points: POINTS_BASE_TIER,
  melt_tokens: 70,
  jailbust_tokens: 80,
  travel_tokens: 90,
  properties_tokens: 100,
  auto_rank_2h_tokens: 100,
};

const FIXED_BASE_AMOUNT_BY_KEY = {
  xp_crimes_tokens: 2,
  xp_gta_tokens: 2,
};

const targetRandomByKey = distributeTotal(TARGET_RANDOM_TOKENS_TOTAL, SELECTABLE_RANDOM_TOKEN_KEYS);
const TARGET_TOTAL_BY_KEY = {
  money: TARGET_CASH_TOTAL,
  bullets: TARGET_BULLETS_TOTAL,
  points: TARGET_POINTS_TOTAL,
  ...targetRandomByKey,
};

const SELECTED_KEYS_BY_TIER = Array.from({ length: 101 }, () => []);
const FREE_UNLOCKED_KEY_BY_TIER = Array.from({ length: 101 }, () => null);

const _tiersAssignedByKey = {};
Object.keys(TARGET_TOTAL_BY_KEY).forEach((k) => { _tiersAssignedByKey[k] = []; });

// Precompute deterministic selections and baseAmount normalization.
const BASE_AMOUNT_BY_KEY = {};
const PRECOMPUTED_REWARDS_BY_TIER = Array.from({ length: 101 }, () => ({}));

for (let t = 1; t <= 100; t += 1) {
  const rng = mulberry32(fnv1a32(`${SEED_CATEGORY}:${t}`));
  const wantTwo = rng() < TWO_BUCKET_CHANCE;
  const nBuckets = wantTwo ? 2 : 1;
  let remainingKeys = [...SELECTABLE_KEYS];
  const chosen = [];

  for (let i = 0; i < nBuckets; i += 1) {
    const k = weightedPick(rng, remainingKeys, CATEGORY_WEIGHTS);
    if (!k) break;
    chosen.push(k);
    remainingKeys = remainingKeys.filter((x) => x !== k);
  }

  if (!chosen.length) chosen.push('money');
  const finalChosen = chosen.slice(0, 2);
  SELECTED_KEYS_BY_TIER[t] = finalChosen;

  const freeRng = mulberry32(fnv1a32(`${SEED_FREE}:${t}`));
  const freeKey = finalChosen.length ? finalChosen[Math.floor(freeRng() * finalChosen.length)] : null;
  FREE_UNLOCKED_KEY_BY_TIER[t] = freeKey;

  Object.keys(TARGET_TOTAL_BY_KEY).forEach((key) => {
    if (finalChosen.includes(key)) _tiersAssignedByKey[key].push(t);
  });
}

function initialBaseGuess(tiers, baseTier, targetTotal) {
  const denom = tiers.reduce((acc, tt) => acc + (tt / baseTier), 0);
  if (!denom) return 1;
  return targetTotal / denom;
}

for (const [key, assignedTiers] of Object.entries(_tiersAssignedByKey)) {
  if (!assignedTiers.length) {
    BASE_AMOUNT_BY_KEY[key] = 1;
    continue;
  }
  const baseTier = BASE_TIER_BY_KEY[key];
  const targetTotal = TARGET_TOTAL_BY_KEY[key];
  const guess = initialBaseGuess(assignedTiers, baseTier, targetTotal);
  BASE_AMOUNT_BY_KEY[key] = normalizeBaseAmountToTotalForTiers(baseTier, targetTotal, assignedTiers, guess);
}

// Guaranteed auto_rank_2h_tokens: normalized across all 100 tiers, added as bonus to every tier.
const AUTO_RANK_ALL_TIERS = Array.from({ length: 100 }, (_, i) => i + 1);
const autoRankGuess = initialBaseGuess(AUTO_RANK_ALL_TIERS, AUTO_RANK_2H_BASE_TIER, TARGET_AUTO_RANK_2H_TOTAL);
const AUTO_RANK_BASE_AMOUNT = normalizeBaseAmountToTotalForTiers(
  AUTO_RANK_2H_BASE_TIER, TARGET_AUTO_RANK_2H_TOTAL, AUTO_RANK_ALL_TIERS, autoRankGuess,
);

// Now precompute rewards per tier.
for (let t = 1; t <= 100; t += 1) {
  const rewards = {};
  for (const key of SELECTED_KEYS_BY_TIER[t]) {
    const baseTier = BASE_TIER_BY_KEY[key];
    const baseAmount = FIXED_BASE_AMOUNT_BY_KEY[key] ?? BASE_AMOUNT_BY_KEY[key] ?? 1;
    rewards[key] = Math.ceil(baseAmount * rewardWeight(t, baseTier));
  }
  const arAmt = Math.ceil(AUTO_RANK_BASE_AMOUNT * rewardWeight(t, AUTO_RANK_2H_BASE_TIER));
  if (arAmt > 0) rewards.auto_rank_2h_tokens = arAmt;
  PRECOMPUTED_REWARDS_BY_TIER[t] = rewards;
}

function getRewardsForMicroTier(microTier) {
  const t = Number(microTier || 0);
  if (!Number.isFinite(t) || t < 1) return {};
  const tier = Math.max(1, Math.min(100, Math.floor(t)));
  return PRECOMPUTED_REWARDS_BY_TIER[tier] || {};
}

function getTierRewardObj(microTier) {
  return { levelNumber: microTier, thresholdRp: microTierToThresholdRp(microTier), rewards: getRewardsForMicroTier(microTier) };
}

const REWARD_DISPLAY_ORDER = [
  'money',
  'bullets',
  'xp_crimes_tokens',
  'xp_gta_tokens',
  'points',
  'respect_points',
  'melt_tokens',
  'jailbust_tokens',
  'travel_tokens',
  'properties_tokens',
  'auto_rank_2h_tokens',
];

const TOKEN_REWARD_NAMES = {
  xp_crimes_tokens: 'Crimes XP Token',
  xp_gta_tokens: 'GTA XP Token',
  melt_tokens: 'Melt Token',
  jailbust_tokens: 'Jailbust Token',
  travel_tokens: 'Travel Token',
  properties_tokens: 'Properties Token',
  auto_rank_2h_tokens: 'Auto Rank (2h) Token',
};

function formatTierRewardItem(key, value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (key === 'money') return `$${n.toLocaleString()} cash`;
  if (key === 'bullets') return `${n.toLocaleString()} bullets`;
  if (key === 'points') return `${n.toLocaleString()} points`;
  if (key === 'respect_points') return `${n.toLocaleString()} respect`;
  const tokenName = TOKEN_REWARD_NAMES[key] || key;
  return `${n.toLocaleString()}x ${tokenName}`;
}

function TierRewards({ rewards, isFreeMembership, isTierCompleted, microTier }) {
  const hasAny = !!rewards && Object.values(rewards).some((v) => Number(v || 0) > 0);
  if (!hasAny) return null;

  const freeUnlockedRewardKey = isFreeMembership ? FREE_UNLOCKED_KEY_BY_TIER[microTier] : null;

  return (
    <div className="space-y-1">
      {REWARD_DISPLAY_ORDER.map((k) => {
        const v = rewards?.[k];
        const text = formatTierRewardItem(k, v);
        if (!text) return null;
        const isUnlockedForThisLine =
          !isFreeMembership ||
          (isTierCompleted && k === freeUnlockedRewardKey);
        const lockedForFree = isFreeMembership && !isUnlockedForThisLine;
        return (
          <div key={k} className={`text-[9px] font-heading ${lockedForFree ? 'text-zinc-600/90' : 'text-zinc-300'}`}>
            <span>{text}</span>
            {lockedForFree && (
              <span className="ml-1 text-[9px] text-amber-300/70 uppercase">VIP</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getTierPrimaryLabel(tier, { isFreeMembership, freeUnlockedRewardKey } = {}) {
  const rewards = tier?.rewards || {};

  const getLabelForKey = (key) => {
    const n = Number(rewards[key] || 0);
    if (key === 'money') return `$${n.toLocaleString()} cash`;
    if (key === 'bullets') return `${n.toLocaleString()} Bullets`;
    if (key === 'points') return `${n.toLocaleString()} Points`;
    if (key === 'respect_points') return `${n.toLocaleString()} Respect`;
    if (key === 'melt_tokens') return `${n.toLocaleString()} Melt Tokens`;
    if (key === 'jailbust_tokens') return `${n.toLocaleString()} Jail Immunity`;
    if (key === 'travel_tokens') return `${n.toLocaleString()} Travel Token`;
    if (key === 'properties_tokens') return `${n.toLocaleString()} Properties Token`;
    if (key === 'auto_rank_2h_tokens') return `${n.toLocaleString()} Auto Rank (2h)`;
    if (key === 'xp_crimes_tokens') return `${n.toLocaleString()}x Crimes XP Token`;
    if (key === 'xp_gta_tokens') return `${n.toLocaleString()}x GTA XP Token`;
    return null;
  };

  // Free: show the single bucket this tier unlocks.
  if (isFreeMembership && freeUnlockedRewardKey) {
    const label = getLabelForKey(freeUnlockedRewardKey);
    if (label) return label;
  }

  // VIP: show highest-priority non-zero key.
  if (rewards.money) return `$${Number(rewards.money).toLocaleString()} cash`;
  if (rewards.bullets) return `${Number(rewards.bullets).toLocaleString()} Bullets`;
  if (rewards.xp_crimes_tokens) return `${Number(rewards.xp_crimes_tokens).toLocaleString()}x Crimes XP Token`;
  if (rewards.xp_gta_tokens) return `${Number(rewards.xp_gta_tokens).toLocaleString()}x GTA XP Token`;
  if (rewards.points) return `${Number(rewards.points).toLocaleString()} Points`;
  if (rewards.respect_points) return `${Number(rewards.respect_points).toLocaleString()} Respect`;
  if (rewards.melt_tokens) return `${Number(rewards.melt_tokens).toLocaleString()} Melt Tokens`;
  if (rewards.jailbust_tokens) return `${Number(rewards.jailbust_tokens).toLocaleString()} Jail Immunity`;
  if (rewards.travel_tokens) return `${Number(rewards.travel_tokens).toLocaleString()} Travel Token`;
  if (rewards.auto_rank_2h_tokens) return `${Number(rewards.auto_rank_2h_tokens).toLocaleString()} Auto Rank (2h)`;
  if (rewards.properties_tokens) return `${Number(rewards.properties_tokens).toLocaleString()} Properties Token`;
  return '—';
}

const LoadingSpinner = () => (
  <div className={`${styles.pageContent} p-4 mobile-page-root`}>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
      <Package size={24} className="text-primary/50 animate-pulse" />
      <span className="text-primary text-[10px] font-heading uppercase tracking-wider">Loading game pass…</span>
    </div>
  </div>
);

export default function GamePass() {
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [user, setUser] = useState(null);

  const [selectedBandIndex, setSelectedBandIndex] = useState(null);
  const [selectedMicroTier, setSelectedMicroTier] = useState(null);
  const [tickMs, setTickMs] = useState(() => Date.now());

  const fetchData = useCallback(async () => {
    try {
      const userRes = await api.get('/auth/me');
      setUser(userRes.data);
    } catch {
      toast.error('Failed to load data');
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const expiryIso = user?.rank_xp_pass_token_expires_at;
  useEffect(() => {
    if (!expiryIso) return undefined;
    const end = new Date(expiryIso).getTime();
    if (Number.isNaN(end) || end <= Date.now()) return undefined;
    const id = setInterval(() => setTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiryIso]);

  // When a pass expiry exists, drive "now" off tickMs so VIP/token state flips with the countdown.
  const nowTs = expiryIso ? tickMs : Date.now();
  const passTokensHeld = Number(user?.rank_xp_pass_tokens ?? 0);
  const vipClaimed = user?.rank_xp_pass_rewards_granted === true;
  const pointsBalance = Number(user?.points ?? 0);
  const passExpiryUntil = user?.rank_xp_pass_token_expires_at ? new Date(user.rank_xp_pass_token_expires_at) : null;
  const passIsUnactivatedValid = passTokensHeld > 0 && !!(passExpiryUntil && passExpiryUntil.getTime() > nowTs);
  const passIsUnactivatedExpired = passTokensHeld > 0 && !!(passExpiryUntil && passExpiryUntil.getTime() <= nowTs);
  const passIsUnactivatedUnknownExpiry = passTokensHeld > 0 && !passExpiryUntil;

  const gamePassPurchaseBlockedFinalFortnight = gamePassPurchaseBlockedFinalWindowMessage(user, nowTs);

  const vipGrantingActive = vipClaimed && (!passExpiryUntil || passExpiryUntil.getTime() > nowTs);

  const previewRankPointsRaw = vipGrantingActive
    ? Number(user?.rank_points ?? 0) // when VIP is active, keep preview moving with live rank_points
    : passIsUnactivatedValid
      ? Number(user?.rank_xp_pass_pending_tier_snapshot ?? 0) // pending snapshot before activation
      : vipClaimed
        ? microTierToThresholdRp(Number(user?.rank_xp_pass_last_granted_micro_tier ?? 0))
        : Number(user?.rank_points ?? 0);
  const previewRankPoints = Math.max(0, Math.floor(previewRankPointsRaw));

  const microTierCurrent = Math.min(MAX_MICRO_TIER, Math.max(0, Math.floor((previewRankPoints / MAX_THRESHOLD_RP) * 100)));
  const seasonLevel = microTierCurrent; // Progress bar: 0..100
  const currentBandIndex = microTierCurrent === 0 ? 0 : Math.min(9, Math.floor((microTierCurrent - 1) / 10));

  const membershipType = vipClaimed
    ? vipGrantingActive
      ? 'VIP (Active)'
      : 'VIP (Claimed)'
    : passIsUnactivatedValid
      ? 'VIP (Token Ready)'
      : 'Free';

  const passExpiryEndMs =
    passExpiryUntil && !Number.isNaN(passExpiryUntil.getTime()) ? passExpiryUntil.getTime() : null;
  const passExpiryRemainingMs = passExpiryEndMs != null ? passExpiryEndMs - tickMs : null;
  const showGamePassExpiryPanel = Boolean(expiryIso && passExpiryUntil && !Number.isNaN(passExpiryUntil.getTime()));

  useEffect(() => {
    // Default selection = current band. Keeps selection stable once picked.
    if (selectedBandIndex == null) setSelectedBandIndex(currentBandIndex);
  }, [currentBandIndex, selectedBandIndex]);

  const selectedBand = selectedBandIndex != null ? BANDS[selectedBandIndex] : null;

  useEffect(() => {
    if (!selectedBand) return;
    const suggested = microTierCurrent >= selectedBand.start && microTierCurrent <= selectedBand.end ? microTierCurrent : selectedBand.start;
    if (selectedMicroTier == null || selectedMicroTier < selectedBand.start || selectedMicroTier > selectedBand.end) {
      setSelectedMicroTier(suggested);
    }
  }, [selectedBand, microTierCurrent, selectedMicroTier]);

  const selectedTierObj = selectedMicroTier ? getTierRewardObj(selectedMicroTier) : null;
  const selectedNextTierObj = selectedMicroTier && selectedMicroTier < 100 ? getTierRewardObj(selectedMicroTier + 1) : null;

  const gamePassPurchaseLocked = false;

  const handlePurchase = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.post('/payments/checkout', {
        package_id: GAME_PASS_PACKAGE_ID,
        origin_url: window.location.origin + '/game-pass',
      });
      window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePurchaseWithPoints = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.post('/payments/buy-game-pass-with-points', {
        origin_url: window.location.origin + '/game-pass',
      });
      toast.success(res?.data?.message || 'Game Pass purchased.');
      refreshUser();
      await fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const checkPaymentStatus = async (sessionId, attempt = 0) => {
    if (attempt >= 5) {
      toast.error('Payment verification timed out.');
      setCheckingPayment(false);
      window.history.replaceState({}, '', '/game-pass');
      return;
    }
    setCheckingPayment(true);
    try {
      const res = await api.get(`/payments/status/${sessionId}`);
      if (res.data.status === 'fulfillment_blocked' || res.data.payment_status === 'fulfillment_blocked') {
        toast.error(res.data.detail || 'This purchase could not deliver Game Pass. If you were charged, contact support.');
        refreshUser();
        await fetchData();
      } else if (res.data.payment_status === 'paid') {
        const pts = Number(res.data.points_added || 0);
        if (pts === 0) toast.success('Game Pass purchased — token delivered. Activate in My Inventory.');
        else toast.success(`${pts} points added.`);

        refreshUser();
        await fetchData();
      } else if (res.data.status === 'expired' || res.data.payment_status === 'expired') {
        toast.error('Session expired.');
      } else if (res.data.payment_status === 'unpaid') {
        toast.info('No payment was completed.');
      } else {
        setTimeout(() => checkPaymentStatus(sessionId, attempt + 1), 2000);
        return;
      }

      window.history.replaceState({}, '', '/game-pass');
      setCheckingPayment(false);
    } catch {
      toast.error('Error checking payment');
      setCheckingPayment(false);
    }
  };

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sessionId = sp.get('session_id');
    if (!sessionId) return;
    checkPaymentStatus(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || user == null) {
    // Keep the full spinner when user is unknown; avoid flashing content while redirecting.
    return <LoadingSpinner />;
  }

  return (
    <div
      className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}
      data-testid="game-pass-page"
      data-page="game-pass"
    >
      {checkingPayment ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
          <ShoppingBag size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Verifying payment…</span>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Release soft-launch banner removed — Game Pass is fully open */}
          {/* Membership header + purchase CTA */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">
                Game Pass (£{GAME_PASS_PRICE_GBP})
              </span>
              <Package className="text-primary shrink-0" size={14} />
            </div>
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="p-2 rounded bg-zinc-900/30 border border-primary/10">
                  <div className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider">Membership Type</div>
                  <div className="text-[11px] font-heading font-bold text-primary">{membershipType}</div>
                </div>
                <div className="p-2 rounded bg-zinc-900/30 border border-primary/10">
                  <div className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider">VIP Tier</div>
                  <div className="text-[11px] font-heading font-bold text-primary">{microTierCurrent}</div>
                </div>
                <div className="p-2 rounded bg-zinc-900/30 border border-primary/10">
                  <div className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider">XP</div>
                  <div className="text-[11px] font-heading font-bold text-primary">{previewRankPoints.toLocaleString()}</div>
                </div>
              </div>

              {gamePassPurchaseBlockedFinalFortnight && (
                <p className="text-[10px] text-amber-400/95 font-heading leading-snug border border-amber-500/30 bg-amber-500/10 rounded px-2 py-2">
                  {gamePassPurchaseBlockedFinalFortnight}
                </p>
              )}

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <button
                  type="button"
                  onClick={handlePurchase}
                  disabled={
                    !user
                    || loading
                    || gamePassPurchaseLocked
                    || vipClaimed
                    || passIsUnactivatedValid
                    || passIsUnactivatedUnknownExpiry
                    || !!gamePassPurchaseBlockedFinalFortnight
                  }
                  className="flex-1 w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                >
                  {loading
                    ? '...'
                    : gamePassPurchaseBlockedFinalFortnight
                      ? 'Too close to pass end'
                      : gamePassPurchaseLocked
                        ? 'Unavailable until unlock'
                        : vipClaimed
                          ? 'VIP claimed'
                          : passIsUnactivatedValid
                            ? 'Token ready (activate to claim)'
                            : `Buy for £${GAME_PASS_PRICE_GBP}`}
                </button>
                <Link
                  to="/account/inventory"
                  className="flex items-center justify-center min-h-[44px] px-3 rounded-md text-[10px] font-heading font-bold border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 gap-1.5"
                >
                  <Clock size={14} className="shrink-0" />
                  Activate
                </Link>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <button
                  type="button"
                  onClick={handlePurchaseWithPoints}
                  disabled={
                    !user
                    || loading
                    || gamePassPurchaseLocked
                    || vipClaimed
                    || passIsUnactivatedValid
                    || passIsUnactivatedUnknownExpiry
                    || !!gamePassPurchaseBlockedFinalFortnight
                    || pointsBalance < GAME_PASS_POINTS_PRICE
                  }
                  className="flex-1 w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-50 touch-manipulation"
                >
                  {loading
                    ? '...'
                    : gamePassPurchaseBlockedFinalFortnight
                      ? 'Too close to pass end'
                      : gamePassPurchaseLocked
                        ? 'Unavailable until unlock'
                        : pointsBalance < GAME_PASS_POINTS_PRICE
                          ? `Need ${GAME_PASS_POINTS_PRICE.toLocaleString()} points`
                          : `Buy for ${GAME_PASS_POINTS_PRICE.toLocaleString()} points`}
                </button>
                <div className="text-[9px] text-zinc-400 font-heading italic sm:text-right sm:flex-1">
                  Deducts points to grant an unactivated Game Pass token.
                </div>
              </div>

              <p className="text-[8px] text-zinc-500/90 font-heading leading-relaxed border-t border-primary/10 pt-2">
                Why this isn&apos;t the same as {SILVER_PACK_POINTS.toLocaleString()} pts for £{SILVER_PACK_PRICE_GBP}: that pack adds{' '}
                <span className="text-zinc-400">spendable points</span> to your balance. Game Pass (£{GAME_PASS_PRICE_GBP}) does not credit store points — it
                unlocks <span className="text-zinc-400">rank tier rewards</span> (cash, bullets, tokens, etc.) as you earn rank XP. Different product, different
                price.
              </p>

              <p className="text-[8px] text-zinc-500/90 font-heading leading-relaxed border-t border-primary/10 pt-2">
                <span className="text-zinc-400 font-bold">Duration: {GAME_PASS_DURATION_LABEL}</span> from purchase. {GAME_PASS_DURATION_FINE_PRINT}
              </p>

              <p className="text-[8px] text-zinc-500/90 font-heading leading-relaxed border-t border-primary/10 pt-2">
                {GAME_PASS_DEAD_ALIVE_FINE_PRINT}
              </p>

              <p className="text-[10px] text-mutedForeground font-heading">
                Value estimate for VIP: <span className="text-primary font-bold">~{TARGET_POINTS_TOTAL.toLocaleString()} points</span> +{" "}
                <span className="text-primary font-bold">~${TARGET_CASH_TOTAL.toLocaleString()} cash</span> +{" "}
                <span className="text-primary font-bold">~{TARGET_BULLETS_TOTAL.toLocaleString()} bullets</span> +{" "}
                <span className="text-primary font-bold">~{TARGET_AUTO_RANK_2H_TOTAL} Auto Rank (2h)</span> tokens.
              </p>

              {vipClaimed && (
                <p className="text-[10px] text-emerald-400 font-heading">Rewards claimed.</p>
              )}

              {showGamePassExpiryPanel && (
                <div className="rounded-md border border-primary/30 bg-zinc-950/40 px-2.5 py-2.5 space-y-1.5">
                  <div className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider">Game Pass end date</div>
                  <div className="text-[11px] font-heading font-bold text-primary leading-snug">{formatGamePassEndDateTime(passExpiryUntil)}</div>
                  {passExpiryRemainingMs != null && passExpiryRemainingMs > 0 ? (
                    <>
                      <div className="text-[10px] font-heading text-emerald-300/95">
                        Time remaining:{' '}
                        <span className="text-emerald-200 font-bold tabular-nums tracking-tight">{formatCountdown(passExpiryRemainingMs)}</span>
                      </div>
                      {passIsUnactivatedValid && !vipClaimed && (
                        <p className="text-[9px] text-zinc-400 font-heading">Activate your token before this time.</p>
                      )}
                      {vipGrantingActive && (
                        <p className="text-[9px] text-zinc-400 font-heading">VIP tier rewards run until this time.</p>
                      )}
                    </>
                  ) : (
                    <div className="text-[10px] font-heading text-amber-400/95">This Game Pass window has ended.</div>
                  )}
                </div>
              )}

              {passIsUnactivatedExpired && (
                <p className="text-[10px] text-amber-400 font-heading">Previous token expired — you can buy again.</p>
              )}
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          {/* Season progress */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
              <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">Progress</div>
              <div className="text-[9px] text-zinc-400 font-heading italic mt-0.5">
                Milestones every {MICRO_TIER_STEP_RP.toLocaleString()} rank XP (tier 1 at {MICRO_TIER_STEP_RP.toLocaleString()}, tier 2 at {(MICRO_TIER_STEP_RP * 2).toLocaleString()}, etc.)
              </div>
            </div>
            <div className="p-3 space-y-2">
              <div className="w-full h-2 bg-zinc-900/30 border border-primary/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary via-primary to-primary" style={{ width: `${seasonLevel}%` }} />
              </div>
              {vipGrantingActive && (
                <p className="text-[9px] text-zinc-500 font-heading leading-relaxed">
                  VIP rewards are applied automatically: when you activate the pass, anything you already earned with rank XP is granted immediately; after that, each new tier credits on its own as soon as you pass the next milestone (you don’t need to buy again).
                </p>
              )}
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          {/* Tier grid */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">Tiers</span>
            </div>

            <div className="p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {BANDS.map((band) => {
                  // Completed = reached this band's top micro tier (inclusive).
                  // "Current" = still progressing inside the band (not yet at band.end); at band.end or max pass, show Done — avoids 91–100 staying "Current" at tier 100.
                  const isBandCompleted = microTierCurrent >= band.end;
                  const isBandCurrent = microTierCurrent >= band.start && microTierCurrent < band.end;
                  const isBandPreviousDone = isBandCompleted && !isBandCurrent;
                  const isFreeMembership = membershipType === 'Free';
                  const isClickable = microTierCurrent >= band.start;
                  const bandEndTier = getTierRewardObj(band.end);
                  const freeUnlockedRewardKeyForBand = isFreeMembership ? FREE_UNLOCKED_KEY_BY_TIER[bandEndTier.levelNumber] : null;

                  return (
                    <div
                      key={band.index}
                      className={`relative rounded-lg border overflow-hidden ${
                        isBandCurrent
                          ? 'border-primary/60 bg-primary/5'
                          : isBandPreviousDone
                            ? 'border-primary/30 bg-primary/10'
                            : 'border-primary/20 bg-zinc-900/30'
                      } ${isClickable ? 'cursor-pointer hover:border-primary/80' : 'opacity-60 cursor-not-allowed'}`}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : -1}
                      onClick={() => { if (isClickable) setSelectedBandIndex(band.index); }}
                      onKeyDown={(e) => {
                        if (!isClickable) return;
                        if (e.key === 'Enter' || e.key === ' ') setSelectedBandIndex(band.index);
                      }}
                    >
                      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                      <div className="p-3 space-y-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
                            {band.start}-{band.end}
                          </div>
                          {isBandCurrent ? (
                            <div className="text-[9px] font-heading font-bold text-primary">Current</div>
                          ) : isBandPreviousDone ? (
                            <div className="text-[9px] font-heading font-bold text-primary">Done</div>
                          ) : null}
                        </div>
                        <div className="text-[11px] font-heading font-bold text-foreground tabular-nums">
                          {getTierPrimaryLabel(bandEndTier, {
                            isFreeMembership,
                            freeUnlockedRewardKey: freeUnlockedRewardKeyForBand,
                          })}
                        </div>
                        <div className="text-[9px] text-zinc-500 font-heading">XP Needed: {bandEndTier.thresholdRp.toLocaleString()} XP</div>
                        <TierRewards
                          rewards={bandEndTier.rewards}
                          isFreeMembership={isFreeMembership}
                          isTierCompleted={isBandCompleted}
                          microTier={bandEndTier.levelNumber}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          {/* Band details: list every micro tier inside the selected band */}
          {selectedBand && (
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">
                    Tiers {selectedBand.start}-{selectedBand.end}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-x-3 text-[9px] text-zinc-500 font-heading">
                    <span className="italic">
                      Current tier: <span className="text-primary font-bold not-italic tabular-nums">{microTierCurrent}</span>
                    </span>
                    <span>
                      Current XP:{' '}
                      <span className="text-primary font-bold not-italic tabular-nums">{previewRankPoints.toLocaleString()}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-3 space-y-3">
                <div className="text-[10px] text-zinc-400 font-heading italic">
                  Clicked band rewards preview (VIP shows all; Free unlocks only 1 item per completed tier).
                </div>

                {selectedTierObj && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
                        Selected tier {selectedMicroTier}
                      </div>
                      <div className="text-[9px] text-zinc-500 font-heading text-right space-y-0.5 shrink-0">
                        <div>
                          Current XP:{' '}
                          <span className="text-foreground font-bold tabular-nums">{previewRankPoints.toLocaleString()}</span>
                        </div>
                        <div>
                          XP Needed:{' '}
                          <span className="text-foreground font-bold tabular-nums">{selectedTierObj.thresholdRp.toLocaleString()}</span> XP
                        </div>
                      </div>
                    </div>

                    <TierRewards
                      rewards={selectedTierObj.rewards}
                      isFreeMembership={membershipType === 'Free'}
                      isTierCompleted={microTierCurrent >= selectedMicroTier}
                      microTier={selectedMicroTier}
                    />

                    {selectedNextTierObj && (
                      <div className="pt-2 border-t border-zinc-800/60">
                        <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">
                          Next tier ({selectedMicroTier + 1})
                        </div>
                        <div className="mt-2">
                          <TierRewards
                            rewards={selectedNextTierObj.rewards}
                            isFreeMembership={membershipType === 'Free'}
                            isTierCompleted={false}
                            microTier={selectedMicroTier + 1}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {Array.from({ length: selectedBand.end - selectedBand.start + 1 }, (_, i) => selectedBand.start + i).map((t) => {
                    const tierObj = getTierRewardObj(t);
                    const isMicroCompleted = microTierCurrent >= t;
                    const isCurrent = microTierCurrent === t && t < MAX_MICRO_TIER;
                    const isNext = microTierCurrent + 1 === t;
                    return (
                      <div
                        key={t}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedMicroTier(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelectedMicroTier(t);
                        }}
                        className={`relative rounded-lg border p-2 transition-transform duration-150 hover:scale-[1.02] ${
                          selectedMicroTier === t
                            ? 'border-primary/80 bg-primary/10'
                            : isCurrent
                              ? 'border-primary/60 bg-primary/5'
                              : isMicroCompleted
                                ? 'border-primary/20 bg-primary/10'
                                : 'border-primary/10 bg-zinc-900/25'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
                            Tier {t}
                          </div>
                          {isCurrent ? (
                            <div className="text-[8px] font-heading font-bold text-primary">Current</div>
                          ) : isMicroCompleted ? (
                            <div className="text-[8px] font-heading font-bold text-primary">Done</div>
                          ) : null}
                          {isNext ? (
                            <div className="text-[8px] font-heading font-bold text-amber-300/90">Next</div>
                          ) : null}
                        </div>

                      <div className="mt-1 text-[9px] text-zinc-500 font-heading">
                        XP Needed: {tierObj.thresholdRp.toLocaleString()} XP
                      </div>

                      <div className="mt-1">
                        <TierRewards
                          rewards={tierObj.rewards}
                          isFreeMembership={membershipType === 'Free'}
                          isTierCompleted={isMicroCompleted}
                          microTier={t}
                        />
                      </div>
                      </div>
                    );
                  })}
                </div>

                {/* Next tier preview is shown in the Selected Tier panel above. */}
              </div>
            </div>
          )}

          <div className="text-[9px] text-zinc-500 font-heading italic">
            Your pass uses the existing activation token entitlement (`rank_xp_pass`) and will remain compatible with prior purchases.
          </div>
        </div>
      )}
    </div>
  );
}

