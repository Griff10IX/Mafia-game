import { useState, useEffect, useRef } from 'react';
import { Gift, X, Package, Swords, Car, Shield, Building2, Coins, Zap, Save, Puzzle, Leaf, Gem } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import {
  apiPostWithCivilianProtectionConfirm,
  isCivilianProtectionConfirmCancelled,
} from '../../utils/civilianProtectionConfirm';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const LOOT_BOX_STYLES = `
  @keyframes lb-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .lb-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  @keyframes lb-idle-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
  @keyframes lb-shimmer-band { 0% { background-position: -120% 0; } 100% { background-position: 220% 0; } }
  .lb-loot-ready-glow { animation: goldPulse 2.2s ease-in-out infinite; border-radius: 0.5rem; }
  @keyframes lb-jackpot-flash {
    0%, 100% { box-shadow: 0 0 0 rgba(234, 179, 8, 0); border-color: rgba(234, 179, 8, 0.25); }
    50% { box-shadow: 0 0 18px rgba(234, 179, 8, 0.45); border-color: rgba(234, 179, 8, 0.65); }
  }
  @keyframes lb-reward-glow-3 { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.15); } }
  @keyframes lb-reward-glow-4 { 0%, 100% { box-shadow: 0 0 6px rgba(251, 191, 36, 0.2); } 50% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.55); } }
  @keyframes lb-reward-glow-5 { 0%, 100% { transform: scale(1); } 40% { transform: scale(1.03); } 100% { transform: scale(1); } }
  @keyframes lb-vignette { from { opacity: 0; } 30% { opacity: 0.55; } to { opacity: 0; } }
  .lb-jackpot-flash { animation: lb-jackpot-flash 0.65s ease-out 1; }
  .lb-reward-glow-3 { animation: lb-reward-glow-3 0.8s ease-out 1; }
  .lb-reward-glow-4 { animation: lb-reward-glow-4 0.9s ease-out 1; }
  .lb-reward-glow-5 { animation: lb-reward-glow-5 0.55s ease-out 1; }
  .lb-vignette-pulse { animation: lb-vignette 0.45s ease-out 1; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) {
    .lb-fade-in, .lb-loot-ready-glow, .lb-jackpot-flash, .lb-reward-glow-3, .lb-reward-glow-4, .lb-reward-glow-5, .lb-vignette-pulse { animation: none !important; }
  }
`;
// Entrance fade is injected only on the first visit per session so revisits
// don't look like a full page reload.
const LOOT_FADE_STYLES = `
  .lb-fade-in { animation: lb-fade-in 0.4s ease-out both; }
`;
let _lbIntroPlayed = false;

const PAID_TIERS = ['common', 'uncommon', 'rare', 'ultra_rare'];
const DEFAULT_OPEN_COST_BY_TIER = { common: 50, uncommon: 100, rare: 500, ultra_rare: 1000 };
const TIER_RANK = { common: 0, uncommon: 1, rare: 2, ultra_rare: 3, loot_exclusive: 4, exclusive: 4 };

const LOOT_TIER_THEME = {
  common: {
    label: 'Common',
    tagline: 'Starter vault — jackpots possible',
    pieceCost: 50,
    prizeHint: '1–2 prizes',
    accent: 'text-zinc-300',
    accentMuted: 'text-zinc-500',
    ring: 'ring-zinc-500/50',
    glow: 'shadow-[0_0_12px_rgba(113,113,122,0.25)]',
    card: 'border-zinc-600/50 bg-zinc-900/50',
    cardSelected: 'border-zinc-400/70 bg-zinc-800/60 ring-1 ring-zinc-400/40 scale-[1.02]',
    particleColors: ['#71717a', '#a1a1aa', '#d4d4d8'],
    chest: {
      lidBorder: 'rgba(161, 161, 170, 0.85)',
      bodyBorder: 'rgba(82, 82, 91, 0.9)',
      shimmer: 'rgba(212, 212, 216, 0.75)',
    },
    shakeMul: 1,
  },
  uncommon: {
    label: 'Uncommon',
    tagline: 'Better odds — rare jackpots',
    pieceCost: 100,
    prizeHint: '1–3 prizes',
    accent: 'text-green-300',
    accentMuted: 'text-green-600/80',
    ring: 'ring-green-500/45',
    glow: 'shadow-[0_0_16px_rgba(34,197,94,0.22)]',
    card: 'border-green-700/40 bg-green-950/25',
    cardSelected: 'border-green-400/60 bg-green-950/40 ring-1 ring-green-400/35 scale-[1.02]',
    particleColors: ['#22c55e', '#4ade80', '#86efac'],
    chest: {
      lidBorder: 'rgba(74, 222, 128, 0.75)',
      bodyBorder: 'rgba(21, 128, 61, 0.85)',
      shimmer: 'rgba(74, 222, 128, 0.8)',
    },
    shakeMul: 1.08,
  },
  rare: {
    label: 'Rare',
    tagline: '2+ rare-tier prizes guaranteed',
    pieceCost: 500,
    prizeHint: '2–5 prizes',
    accent: 'text-blue-300',
    accentMuted: 'text-blue-500/80',
    ring: 'ring-blue-500/50',
    glow: 'shadow-[0_0_20px_rgba(59,130,246,0.28)]',
    card: 'border-blue-600/40 bg-blue-950/30',
    cardSelected: 'border-blue-400/65 bg-blue-950/45 ring-1 ring-blue-400/40 scale-[1.02]',
    particleColors: ['#3b82f6', '#60a5fa', '#93c5fd'],
    chest: {
      lidBorder: 'rgba(96, 165, 250, 0.9)',
      bodyBorder: 'rgba(37, 99, 235, 0.85)',
      shimmer: 'rgba(147, 197, 253, 0.9)',
    },
    shakeMul: 1.18,
  },
  ultra_rare: {
    label: 'Ultra Rare',
    tagline: 'Cash + points guaranteed — 2+ rare+ prizes',
    pieceCost: 1000,
    prizeHint: '3–6 prizes',
    accent: 'text-purple-300',
    accentMuted: 'text-purple-500/80',
    ring: 'ring-purple-500/55',
    glow: 'shadow-[0_0_28px_rgba(168,85,247,0.35)]',
    card: 'border-purple-600/45 bg-purple-950/35',
    cardSelected: 'border-purple-300/70 bg-purple-950/50 ring-1 ring-purple-400/45 scale-[1.02]',
    particleColors: ['#a855f7', '#c084fc', '#eab308', '#f5d0fe'],
    chest: {
      lidBorder: 'rgba(192, 132, 252, 0.95)',
      bodyBorder: 'rgba(126, 34, 206, 0.9)',
      shimmer: 'rgba(233, 213, 255, 0.95)',
    },
    shakeMul: 1.28,
  },
};

function tierRank(tier) {
  return TIER_RANK[tier] ?? TIER_RANK[String(tier || '').replace(/ /g, '_')] ?? 0;
}

function resolveOpenCost(status, tier) {
  const fromApi = status?.open_cost_by_tier?.[tier];
  if (fromApi != null) return Number(fromApi);
  return LOOT_TIER_THEME[tier]?.pieceCost ?? DEFAULT_OPEN_COST_BY_TIER[tier] ?? 100;
}

function getRewardAnimLevel(reward, paidTier) {
  if (!reward) return 0;
  let level = 0;
  const rt = reward.reward_tier || reward.rarity;
  if (rt === 'loot_exclusive' || rt === 'exclusive' || ['weapon', 'car', 'armour', 'property', 'weed_strain'].includes(reward.type)) {
    if (reward.type && ['weapon', 'car', 'armour', 'property'].includes(reward.type)) return 4;
    if (rt === 'loot_exclusive') return 4;
  }
  if (reward.type === 'cars' && reward.items?.length) {
    level = Math.max(level, tierRank(reward.items[0].rarity));
  }
  level = Math.max(level, tierRank(rt));
  if (tierRank(rt) > tierRank(paidTier)) level = Math.max(level, 3);
  const cash = Number(reward.amount ?? 0);
  const pts = Number(reward.amount ?? reward.points ?? 0);
  if (reward.type === 'cash' && cash >= 50_000_000) level = Math.min(5, level + 1);
  if (reward.type === 'points' && pts >= 8000) level = Math.min(5, level + 1);
  return Math.min(5, Math.max(0, level));
}

function computeOpenAnimLevel(rewards, paidTier) {
  const floor = { common: 0, uncommon: 1, rare: 2, ultra_rare: 3 }[paidTier] ?? 0;
  const best = (rewards || []).reduce((m, r) => Math.max(m, getRewardAnimLevel(r, paidTier)), 0);
  return Math.min(5, Math.max(floor, best));
}

function explodeDurationMs(level) {
  if (level >= 5) return 2000;
  if (level >= 3) return 1600;
  return 1200;
}

function sortRewardsForReveal(rewards, paidTier) {
  return [...(rewards || [])].sort(
    (a, b) => getRewardAnimLevel(a, paidTier) - getRewardAnimLevel(b, paidTier),
  );
}

function rewardPopDelay(index, level) {
  return 0.08 + index * (0.1 + level * 0.02);
}

function rewardPopDuration(level) {
  if (level >= 5) return 0.65;
  if (level >= 3) return 0.52;
  return 0.42;
}

/* GTA-style rarity text colors for cars */
const RARITY_COLORS = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  ultra_rare: 'text-purple-400',
  legendary: 'text-yellow-400',
  custom: 'text-orange-400',
  exclusive: 'text-red-400',
  loot_exclusive: 'text-amber-400',
};
function getRarityColor(rarity) {
  return RARITY_COLORS[rarity] || 'text-gray-400';
}

/* ─── Inline styles & keyframes ─── */
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');

  @keyframes emberFloat {
    0%   { transform: translateY(0) scale(1); opacity: 0.8; }
    50%  { transform: translateY(-60px) scale(0.7) translateX(10px); opacity: 0.5; }
    100% { transform: translateY(-120px) scale(0.3) translateX(-6px); opacity: 0; }
  }
  @keyframes boxShake {
    0%,100% { transform: rotate(0deg) scale(1); }
    15%  { transform: rotate(-4deg) scale(1.04); }
    30%  { transform: rotate(4deg) scale(1.06); }
    45%  { transform: rotate(-3deg) scale(1.04); }
    60%  { transform: rotate(3deg) scale(1.07); }
    75%  { transform: rotate(-2deg) scale(1.05); }
  }
  @keyframes boxExplode {
    0%   { transform: scale(1); opacity: 1; filter: brightness(1); }
    40%  { transform: scale(1.35); opacity: 1; filter: brightness(2.5); }
    70%  { transform: scale(0.9); opacity: 0.6; filter: brightness(1); }
    100% { transform: scale(1); opacity: 1; filter: brightness(1); }
  }
  @keyframes goldPulse {
    0%,100% { box-shadow: 0 0 8px rgba(234,179,8,0.3); }
    50%      { box-shadow: 0 0 28px rgba(234,179,8,0.7), 0 0 60px rgba(234,179,8,0.2); }
  }
  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes rewardPop {
    0%   { opacity: 0; transform: scale(0.6) translateY(12px); }
    60%  { transform: scale(1.06) translateY(-2px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes overlayIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.85) translateY(24px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes progressFill {
    from { width: 0; }
    to   { width: var(--prog-width); }
  }
  @keyframes crownSpin {
    0%   { transform: rotateY(0deg); }
    100% { transform: rotateY(360deg); }
  }
  @keyframes particleBurst {
    0%   { opacity: 1; transform: translate(0,0) scale(1); }
    100% { opacity: 0; transform: translate(var(--px), var(--py)) scale(0); }
  }
  @keyframes textGlow {
    0%,100% { text-shadow: 0 0 4px rgba(234,179,8,0.4); }
    50%      { text-shadow: 0 0 16px rgba(234,179,8,0.9), 0 0 32px rgba(234,179,8,0.4); }
  }
  @keyframes borderMarch {
    0%   { border-color: rgba(234,179,8,0.3); }
    50%  { border-color: rgba(234,179,8,0.85); }
    100% { border-color: rgba(234,179,8,0.3); }
  }
  @keyframes chestLidOpen {
    0%   { transform: perspective(420px) rotateX(0deg); }
    100% { transform: perspective(420px) rotateX(-88deg); }
  }
  @keyframes tickerBlink {
    0%,100% { opacity: 1; }
    50%      { opacity: 0.35; }
  }
`;

/* ─── Particle burst overlay ─── */
function Particles({ active, colors, count = 20 }) {
  if (!active) return null;
  const palette = colors?.length ? colors : ['#eab308', '#f59e0b', '#fcd34d'];
  const n = Math.max(12, Math.min(36, count));
  const particles = Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * 360;
    const dist = 60 + Math.random() * 80;
    const px = `${Math.cos((angle * Math.PI) / 180) * dist}px`;
    const py = `${Math.sin((angle * Math.PI) / 180) * dist}px`;
    return { px, py, color: palette[i % palette.length], delay: Math.random() * 0.2 };
  });
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: p.color,
            '--px': p.px,
            '--py': p.py,
            animation: `particleBurst 0.8s ${p.delay}s ease-out forwards`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Floating embers background ─── */
function Embers({ colors }) {
  const c0 = colors?.[0] || '#fbbf24';
  const c1 = colors?.[1] || '#92400e';
  const embers = Array.from({ length: 10 }, (_, i) => ({
    left: `${8 + i * 9}%`,
    delay: `${i * 0.6}s`,
    duration: `${2.5 + (i % 4) * 0.8}s`,
    size: 3 + (i % 3) * 2,
  }));
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {embers.map((e, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            bottom: '10%',
            left: e.left,
            width: e.size,
            height: e.size,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${c0}, ${c1})`,
            animation: `emberFloat ${e.duration} ${e.delay} ease-in infinite`,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Reward Icon ─── */
function RewardIcon({ type, rarity, animLevel = 0 }) {
  const isExclusive = rarity === 'exclusive' || rarity === 'loot_exclusive';
  const rt = rarity === 'loot_exclusive' ? 'loot_exclusive' : rarity;
  const iconMap = {
    weapon: Swords, car: Car, armour: Shield,
    property: Building2, cash: Coins,
    points: Zap, rank_points: Zap, perk: Zap,
    bullets: Package, cars: Car, token: Gift, loot_pieces: Puzzle,
    weed_strain: Leaf, reclaimable_passive: Gem,
  };
  const Icon = iconMap[type] || Gift;
  let wrap = 'bg-primary/10 border-primary/30';
  let iconCls = 'text-primary/90';
  if (isExclusive || animLevel >= 4) {
    wrap = 'bg-primary/30 border-primary';
    iconCls = 'text-primary';
  } else if (rt === 'ultra_rare' || animLevel >= 3) {
    wrap = 'bg-purple-500/20 border-purple-400/40';
    iconCls = 'text-purple-200';
  } else if (rt === 'rare' || animLevel >= 2) {
    wrap = 'bg-blue-500/15 border-blue-400/35';
    iconCls = 'text-blue-200';
  } else if (rt === 'uncommon' || animLevel >= 1) {
    wrap = 'bg-green-500/15 border-green-400/35';
    iconCls = 'text-green-200';
  }
  return (
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${wrap} ${animLevel >= 4 ? 'lb-reward-glow-4' : ''}`}>
      <Icon size={16} className={iconCls} />
    </div>
  );
}

function fmtInt(n) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x.toLocaleString() : String(n ?? '');
}

function rewardLabel(reward) {
  if (!reward) return '—';
  const t = String(reward.type || '').toLowerCase();
  switch (t) {
    case 'weapon':    return reward.name || 'Exclusive weapon';
    case 'car':       return reward.name || 'Exclusive car';
    case 'armour':    return reward.name || 'Exclusive armour';
    case 'property':  return reward.name || 'Speakeasy';
    case 'weed_strain': return reward.name || 'Exclusive weed strain';
    case 'reclaimable_passive': {
      const buff = reward.buff_label ? ` — ${reward.buff_label}` : '';
      return `${reward.name || 'Vault relic'}${buff}`;
    }
    case 'points': {
      const amt = reward.amount ?? reward.points ?? reward.value;
      return `${fmtInt(amt)} points`;
    }
    case 'rank_points': {
      const amt = reward.amount ?? reward.rank_points ?? reward.value;
      return `${fmtInt(amt)} rank points`;
    }
    case 'cash':      return `$${Number(reward.amount ?? reward.value ?? 0).toLocaleString()}`;
    case 'cars':
      if (reward.items?.length) return reward.items.map((it) => `${it.name} (${it.rarity ?? 'common'})`).join(', ');
      return `${fmtInt(reward.count)} cars`;
    case 'bullets':   return `${fmtInt(reward.amount ?? reward.value)} bullets`;
    case 'loot_pieces': {
      const amt = reward.amount ?? reward.value ?? 0;
      return `${fmtInt(amt)} loot box piece${Number(amt) === 1 ? '' : 's'}`;
    }
    case 'perk':      return reward.name || 'Perk';
    case 'token': {
      const tokenLabels = {
        mission_skip: 'Mission Skip',
        robot_bodyguard_hire: 'Free Robot Bodyguard',
        auto_rank_2h: 'Auto Rank (2h)',
      };
      const tt = reward.token_type || 'bonus';
      const label = tokenLabels[tt] || String(tt).replace(/_/g, ' ');
      return `${fmtInt(reward.amount ?? reward.value ?? 1)} ${label} token(s)`;
    }
    default:          return JSON.stringify(reward);
  }
}

function formatCashRange(lo, hi) {
  return `$${Number(lo).toLocaleString()}–$${Number(hi).toLocaleString()}`;
}

function formatNumRange(lo, hi) {
  return `${Number(lo).toLocaleString()}–${Number(hi).toLocaleString()}`;
}

function LootRewardGuide({ rewardInfo, odds }) {
  if (!rewardInfo?.tiers) return null;
  const {
    open_cost_by_tier,
    max_points_per_prize,
    max_cash_per_prize,
    rare_plus_minimum,
    jackpot_tier_weights_pct,
    standard_prize_types,
    standard_note,
    exclusives,
    exclusive_note,
    standard_token_note,
    tiers,
  } = rewardInfo;
  const costs = open_cost_by_tier || DEFAULT_OPEN_COST_BY_TIER;
  const tierOrder = PAID_TIERS.map((key) => ({
    key,
    title: `${LOOT_TIER_THEME[key]?.label || key} box`,
    color: LOOT_TIER_THEME[key]?.card || 'border-primary/20',
    cost: costs[key] ?? LOOT_TIER_THEME[key]?.pieceCost,
  }));
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
        <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">What you can win</span>
      </div>
      <div className="p-2 space-y-2">
        <p className="text-[8px] text-mutedForeground font-heading leading-snug">
          Choose a vault tier on open:{' '}
          {PAID_TIERS.map((t, i) => (
            <span key={t}>
              {i > 0 ? ' · ' : ''}
              <span className={LOOT_TIER_THEME[t]?.accent}>{LOOT_TIER_THEME[t]?.label} {fmtInt(costs[t])}</span>
            </span>
          ))}{' '}
          pieces. Max <span className="text-primary">{fmtInt(max_points_per_prize ?? 10000)}</span> points and{' '}
          <span className="text-primary">${fmtInt(max_cash_per_prize ?? 250000000)}</span> cash per prize.
        </p>
        {odds && (
          <p className="text-[8px] text-mutedForeground font-heading leading-snug border border-primary/15 rounded px-1.5 py-1 bg-primary/5">
            <span className="text-amber-200/90">~{Number(odds.exclusive_chance_pct).toFixed(1)}%</span> per prize for a loot exclusive (if still claimable).
          </p>
        )}
        <div>
          <p className="text-[8px] font-heading font-bold text-primary uppercase tracking-wider mb-0.5">Standard prize types</p>
          <p className="text-[7px] text-mutedForeground font-heading italic mb-1">{standard_note}</p>
          <ul className="list-none p-0 m-0 flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] font-heading text-foreground">
            {(standard_prize_types || []).map((p) => (
              <li key={p.id} className="text-primary/90">{p.label}</li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {tierOrder.map(({ key, title, color, cost }) => {
            const t = tiers[key];
            if (!t) return null;
            const [pLo, pHi] = t.prize_count || [1, 1];
            const tok = t.tokens || {};
            const [taLo, taHi] = tok.amount || [1, 1];
            const jackpots = jackpot_tier_weights_pct?.[key];
            return (
              <div key={key} className={`rounded border px-1.5 py-1.5 ${color}`}>
                <div className={`text-[9px] font-heading font-bold uppercase tracking-wider mb-0.5 ${LOOT_TIER_THEME[key]?.accent}`}>
                  {title} · {fmtInt(cost)} pcs
                </div>
                <div className="text-[7px] opacity-90 mb-1">{fmtInt(pLo)}–{fmtInt(pHi)} prizes</div>
                {(key === 'rare' || key === 'ultra_rare') && rare_plus_minimum && (
                  <p className="text-[7px] text-amber-200/85 mb-1">≥{rare_plus_minimum} prizes from Rare / Ultra tables</p>
                )}
                {t.guaranteed_standard_types?.length > 0 && (
                  <p className="text-[7px] text-emerald-200/90 mb-1">
                    Always includes:{' '}
                    {t.guaranteed_standard_types
                      .map((id) => (standard_prize_types || []).find((p) => p.id === id)?.label || id)
                      .join(', ')}
                  </p>
                )}
                <ul className="list-none p-0 m-0 space-y-0.5 text-[7px] font-heading leading-tight opacity-95">
                  <li>Cash {formatCashRange(t.cash[0], t.cash[1])}</li>
                  <li>Points {formatNumRange(t.points[0], t.points[1])}</li>
                  <li>Rank pts {formatNumRange(t.rank_points[0], t.rank_points[1])}</li>
                  <li>Bullets {formatNumRange(t.bullets[0], t.bullets[1])}</li>
                  <li>Pieces {formatNumRange(t.loot_pieces[0], t.loot_pieces[1])}</li>
                  <li>Tokens {formatNumRange(taLo, taHi)}</li>
                </ul>
                {jackpots && Object.keys(jackpots).length > 0 && (
                  <p className="text-[7px] font-heading mt-1 pt-1 border-t border-white/10 text-amber-200/80">
                    Jackpot tiers:{' '}
                    {Object.entries(jackpots).map(([jt, pct]) => `${jt.replace(/_/g, ' ')} ~${pct}%`).join(' · ')}
                  </p>
                )}
                {t.perks?.length > 0 && (
                  <p className="text-[7px] font-heading mt-1 pt-1 border-t border-white/10 leading-tight opacity-90">
                    Perks: {t.perks.join('; ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <details className="text-[8px] font-heading group">
          <summary className="cursor-pointer text-primary/90 hover:text-primary list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
            Token pool (random on roll)
          </summary>
          {standard_token_note && (
            <p className="text-[7px] text-mutedForeground italic mt-1 mb-1">{standard_token_note}</p>
          )}
          <ul className="mt-1 max-h-24 overflow-y-auto list-disc pl-4 text-mutedForeground space-y-0.5 text-[7px]">
            {(tiers.ultra_rare?.tokens?.types || tiers.common?.tokens?.types || []).map((x) => (
              <li key={x.id}>{x.label}</li>
            ))}
          </ul>
        </details>
        <details className="text-[8px] font-heading group">
          <summary className="cursor-pointer text-primary/90 hover:text-primary list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
            Loot exclusives (global caps)
          </summary>
          <p className="text-[7px] text-mutedForeground italic mt-1 mb-1">{exclusive_note}</p>
          <ul className="list-none p-0 m-0 space-y-0.5 text-[7px]">
            {(exclusives || []).map((ex) => (
              <li key={ex.id} className="text-amber-200/85">{ex.label}</li>
            ))}
          </ul>
        </details>
      </div>
      <div className="lb-art-line text-primary mx-2.5" />
    </div>
  );
}

function RarityBadge({ rarity }) {
  if (!rarity) return null;
  const classes = {
    loot_exclusive: 'bg-primary/25 text-primary border border-primary/40',
    exclusive:      'bg-purple-500/25 text-purple-200 border border-purple-400/40',
    ultra_rare:     'bg-purple-500/20 text-purple-200 border border-purple-400/30',
    rare:           'bg-blue-500/20 text-blue-200 border border-blue-400/30',
    uncommon:       'bg-green-500/20 text-green-200 border border-green-400/30',
    common:         'bg-zinc-600/30 text-mutedForeground border border-zinc-500/30',
    standard:       'bg-zinc-600/30 text-mutedForeground border border-zinc-500/30',
  };
  const c = classes[rarity] ?? classes.standard;
  return (
    <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded capitalize font-heading tracking-wider ${c}`}>
      {rarity.replace(/_/g, ' ')}
    </span>
  );
}

/* ─── Progress bar ─── */
function PiecesBar({ pieces, cost }) {
  const target = Math.max(1, Number(cost) || 100);
  const pct = Math.min((pieces / target) * 100, 100);
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden border border-primary/20">
        <div className="h-full bg-primary/80 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─── Chest icon (layered “proper” loot box) ─── */
function ChestIcon({ shaking, exploding, ready, tier = 'common', openAnimLevel = 0 }) {
  const theme = LOOT_TIER_THEME[tier] || LOOT_TIER_THEME.common;
  const chest = theme.chest;
  const shakeDur = `${0.45 / (theme.shakeMul || 1)}s`;
  const explodeDur = `${0.5 + openAnimLevel * 0.1}s`;
  const motion = exploding
    ? `boxExplode ${explodeDur} ease-out forwards`
    : shaking
      ? `boxShake ${shakeDur} ease-in-out infinite`
      : 'lb-idle-float 3.2s ease-in-out infinite';
  const particleCount = 16 + openAnimLevel * 4;

  return (
    <div
      className={`relative mx-auto mb-4 flex flex-col items-center justify-end ${ready && !shaking && !exploding ? `lb-loot-ready-glow p-1 -m-1 ${theme.glow}` : ''}`}
      style={{ width: '7.75rem', height: '9.25rem', animation: motion }}
    >
      {exploding && openAnimLevel >= 3 && (
        <div
          className="lb-vignette-pulse absolute inset-0 z-[3] rounded-lg"
          style={{
            background: `radial-gradient(ellipse at center, ${theme.particleColors[0]}33 0%, transparent 70%)`,
          }}
        />
      )}
      <Particles active={exploding} colors={theme.particleColors} count={particleCount} />
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-0"
        style={{
          bottom: '0.15rem',
          width: '78%',
          height: '0.85rem',
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 55%, transparent 72%)',
        }}
      />
      <div className="relative z-[1] w-full flex flex-col items-center" style={{ perspective: '420px', transformStyle: 'preserve-3d' }}>
        <div
          className="relative z-[2] w-[6.35rem] h-[2.85rem] rounded-t-[10px] border-2 border-b-0"
          style={{
            borderColor: chest.lidBorder,
            boxShadow: 'inset 0 3px 10px rgba(255,255,255,0.18), inset 0 -14px 20px rgba(0,0,0,0.45), 0 -2px 0 rgba(0,0,0,0.25)',
            background: tier === 'ultra_rare'
              ? 'linear-gradient(165deg, #e9d5ff 0%, #a855f7 35%, #6b21a8 70%, #3b0764 100%)'
              : tier === 'rare'
                ? 'linear-gradient(165deg, #bfdbfe 0%, #3b82f6 35%, #1e40af 70%, #1e3a8a 100%)'
                : tier === 'uncommon'
                  ? 'linear-gradient(165deg, #bbf7d0 0%, #22c55e 35%, #15803d 70%, #14532d 100%)'
                  : 'linear-gradient(165deg, #d4d4d8 0%, #71717a 35%, #52525b 70%, #27272a 100%)',
            transformOrigin: 'center bottom',
            transformStyle: 'preserve-3d',
            animation: exploding ? 'chestLidOpen 0.48s 0.06s ease-out forwards' : undefined,
          }}
        >
          <div
            className="absolute inset-x-0 top-0 h-[45%] opacity-35 pointer-events-none"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, transparent 100%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.22] pointer-events-none"
            style={{
              backgroundImage: 'repeating-linear-gradient(95deg, transparent, transparent 5px, rgba(0,0,0,0.12) 5px, rgba(0,0,0,0.12) 6px)',
            }}
          />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[72%] h-[2px] bg-gradient-to-r from-transparent via-amber-950/50 to-transparent rotate-[-34deg]" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[72%] h-[2px] bg-gradient-to-r from-transparent via-amber-950/50 to-transparent rotate-[34deg]" />
          <div
            className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-md border-2 border-amber-950/40 bg-gradient-to-br from-amber-200/90 to-amber-700/90 shadow-md flex items-center justify-center"
            style={{ boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.5), 0 2px 4px rgba(0,0,0,0.35)' }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-amber-950/80 border border-amber-950 shadow-inner" />
          </div>
          <div className="absolute bottom-0 left-2 right-2 h-px bg-gradient-to-r from-transparent via-amber-200/35 to-transparent" />
        </div>
        <div
          className="relative -mt-[2px] w-[6.75rem] h-[5.1rem] rounded-b-[12px] border-2 overflow-hidden"
          style={{
            borderColor: chest.bodyBorder,
            background: `
              linear-gradient(105deg, rgba(255,255,255,0.07) 0%, transparent 42%),
              repeating-linear-gradient(88deg, #2f1f14 0px, #1a100a 3px, #352418 6px),
              linear-gradient(180deg, #4d301c 0%, #1f1209 55%, #0d0805 100%)
            `,
            boxShadow: 'inset 0 0 28px rgba(0,0,0,0.55), 0 10px 22px rgba(0,0,0,0.5)',
          }}
        >
          <div
            className="absolute top-[26%] left-0 right-0 h-[2px] opacity-90 pointer-events-none"
            style={{
              background: `linear-gradient(90deg, transparent, ${chest.shimmer}33 12%, ${chest.shimmer} 50%, ${chest.shimmer}33 88%, transparent)`,
              backgroundSize: '200% 100%',
              animation: ready && !shaking && !exploding ? 'lb-shimmer-band 2.8s linear infinite' : undefined,
            }}
          />
          <div
            className="absolute top-[58%] left-0 right-0 h-[2px] opacity-90 pointer-events-none"
            style={{
              background: `linear-gradient(90deg, transparent, ${chest.shimmer}33 10%, ${chest.shimmer}bb 50%, ${chest.shimmer}33 90%, transparent)`,
            }}
          />
          <div className="absolute left-1 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-amber-600/50 via-amber-500/25 to-amber-900/40" />
          <div className="absolute right-1 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-amber-600/50 via-amber-500/25 to-amber-900/40" />
          {[18, 38, 58, 78].map((top, i) => (
            <span
              key={i}
              className="absolute left-0.5 w-1.5 h-1.5 rounded-full border border-amber-900/60 bg-gradient-to-br from-amber-300/40 to-amber-950/50 shadow-sm"
              style={{ top: `${top}%` }}
            />
          ))}
          {[18, 38, 58, 78].map((top, i) => (
            <span
              key={`r-${i}`}
              className="absolute right-0.5 w-1.5 h-1.5 rounded-full border border-amber-900/60 bg-gradient-to-br from-amber-300/40 to-amber-950/50 shadow-sm"
              style={{ top: `${top}%` }}
            />
          ))}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-12 rounded-md border-2 flex flex-col items-center justify-center gap-0.5"
            style={{
              borderColor: 'rgba(161, 98, 7, 0.85)',
              background: 'linear-gradient(180deg, rgba(55,38,24,0.95) 0%, rgba(24,16,10,0.98) 100%)',
              boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.65), 0 4px 10px rgba(0,0,0,0.45)',
            }}
          >
            <div className="w-6 h-6 rounded-full border-2 border-amber-600/80 bg-gradient-to-b from-zinc-700 to-zinc-950 shadow-inner flex flex-col items-center justify-center pt-0.5">
              <div className="w-1 h-1 rounded-full bg-zinc-950" />
              <div className="w-0.5 h-1.5 bg-zinc-950 rounded-b-[1px] -mt-px" />
            </div>
            <div className="w-5 h-1 rounded-full bg-gradient-to-r from-transparent via-amber-600/50 to-transparent" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Scarcity row ─── */
function ScarcityRow({ icon: Icon, label, claimed, cap, holder }) {
  const full = claimed >= cap;
  const holderLabel = String(holder || '').trim();
  return (
    <li className={`flex items-center gap-2 py-1.5 px-2 rounded border ${full ? 'bg-red-500/10 border-red-500/25' : 'bg-primary/5 border-primary/15'}`}>
      <Icon size={12} className={full ? 'text-red-400 shrink-0' : 'text-primary shrink-0'} />
      <div className="flex-1 min-w-0">
        <span className="block text-[10px] font-heading text-foreground truncate">{label}</span>
        {holderLabel ? (
          <span className={`block text-[8px] font-heading truncate mt-0.5 ${full ? 'text-red-300/90' : 'text-mutedForeground'}`}>
            Held by {holderLabel}
          </span>
        ) : null}
      </div>
      <div className="flex gap-0.5 shrink-0">
        {Array.from({ length: Math.max(1, Number(cap) || 1) }, (_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full border ${i < claimed ? (full ? 'bg-red-400 border-red-400' : 'bg-primary border-primary') : 'bg-zinc-600 border-zinc-500'}`} />
        ))}
      </div>
      <span className={`text-[9px] font-heading min-w-[2rem] text-right shrink-0 ${full ? 'text-red-400' : 'text-mutedForeground'}`}>{claimed}/{cap}</span>
    </li>
  );
}

/* ─── Result modal ─── */
function ResultModal({ result, onClose, openAnimLevel = 0 }) {
  const rewards = result.rewards || (result.reward ? [result.reward] : []);
  const paidTier = result.paid_tier || result.box_quality || 'common';
  const theme = LOOT_TIER_THEME[paidTier] || LOOT_TIER_THEME.common;
  const sorted = sortRewardsForReveal(rewards, paidTier);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      style={{ animation: 'overlayIn 0.25s ease-out' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${styles.panel} rounded-lg border max-w-md w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl ${theme.ring} ${openAnimLevel >= 5 ? 'lb-reward-glow-5' : ''}`}
        style={{ animation: 'modalIn 0.35s cubic-bezier(0.22,1,0.36,1)', borderColor: 'rgba(234,179,8,0.25)' }}
      >
        <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="px-4 pt-4 pb-2 flex justify-between items-start relative">
          {openAnimLevel >= 4 && (
            <Particles active colors={theme.particleColors} count={12} />
          )}
          <div className="relative z-[1]">
            <h3 className={`text-lg font-heading font-bold ${theme.accent} ${openAnimLevel >= 4 ? 'animate-[textGlow_1.2s_ease-in-out_1]' : ''}`}>
              {theme.label} Vault Opened
            </h3>
            <p className="text-[11px] text-mutedForeground font-heading italic mt-0.5">
              {rewards.length} prize{rewards.length !== 1 ? 's' : ''}
              {result.pieces_spent ? ` · ${fmtInt(result.pieces_spent)} pieces spent` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded border border-primary/20 bg-primary/5 text-mutedForeground hover:text-foreground transition-colors relative z-[1] tap-feedback touch-manipulation active:scale-[0.97] min-h-10">
            <X size={16} />
          </button>
        </div>
        <div className="h-px bg-primary/20 mx-4" />
        <ul className="list-none p-0 m-0 overflow-y-auto flex-1 flex flex-col gap-2 p-4">
          {sorted.map((r, i) => {
            const level = getRewardAnimLevel(r, paidTier);
            const rt = r.reward_tier || r.rarity;
            const isJackpot = rt && tierRank(rt) > tierRank(paidTier);
            const glowCls = level >= 5 && i === sorted.length - 1
              ? 'lb-reward-glow-5'
              : level >= 4
                ? 'lb-reward-glow-4'
                : level >= 3
                  ? 'lb-reward-glow-3'
                  : isJackpot
                    ? 'lb-jackpot-flash'
                    : '';
            return (
            <li
              key={`${r.type}-${i}-${rt}`}
              className={`flex items-center gap-2 p-2 rounded border border-primary/15 bg-primary/5 ${glowCls}`}
              style={{
                animation: `rewardPop ${rewardPopDuration(level)}s ${rewardPopDelay(i, level)}s cubic-bezier(0.22,1,0.36,1) both`,
              }}
            >
              <RewardIcon type={r.type} rarity={rt || r.rarity} animLevel={level} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-heading text-foreground leading-snug">
                  {r.type === 'cars' && r.items?.length ? (
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
                      {r.items.map((it, idx) => {
                        const rarity = (it.rarity ?? 'common').replace(/_/g, ' ');
                        const colorClass = getRarityColor(it.rarity ?? 'common');
                        return (
                          <span key={idx}>
                            {it.name}{' '}
                            <span className={`font-bold uppercase tracking-wider ${colorClass}`}>({rarity})</span>
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    rewardLabel(r)
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 items-center">
                  {rt && <RarityBadge rarity={rt} />}
                  {isJackpot && (
                    <span className="text-[8px] font-heading uppercase tracking-wider text-amber-300 border border-amber-500/40 px-1 rounded">
                      Jackpot
                    </span>
                  )}
                </div>
              </div>
            </li>
            );
          })}
        </ul>
        <div className="mt-auto pt-3 px-4 pb-4 border-t border-primary/20 flex justify-between items-center">
          <span className="text-[11px] text-mutedForeground font-heading italic">Pieces remaining</span>
          <span className="text-sm font-heading font-bold text-primary">{fmtInt(result.new_pieces ?? 0)}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Main component ─── */
let _cachedLootStatus = null;
let _lootLastFetch = 0;
const LOOT_REFRESH = 30_000;

export default function LootBox() {
  const animateIn = useRef(!_lbIntroPlayed).current;
  useEffect(() => { _lbIntroPlayed = true; }, []);
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(_cachedLootStatus);
  const [selectedTier, setSelectedTier] = useState(() => {
    const t = (searchParams.get('tier') || '').trim().toLowerCase();
    return PAID_TIERS.includes(t) ? t : 'common';
  });
  const [phase, setPhase] = useState('idle'); // idle | shaking | exploding | done
  const [openAnimLevel, setOpenAnimLevel] = useState(0);
  const [result, setResult] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rarityConfig, setRarityConfig] = useState(null);
  const [rarityForm, setRarityForm] = useState({ exclusive_chance_pct: 10, common_pct: 55, uncommon_pct: 32, rare_pct: 13 });
  const [raritySaving, setRaritySaving] = useState(false);
  const [sjGuarantee, setSjGuarantee] = useState(null);
  const [sjGuaranteeUser, setSjGuaranteeUser] = useState('');
  const [sjGuaranteeBusy, setSjGuaranteeBusy] = useState(false);
  const tutorialLoot = searchParams.get('tutorial') === '1';

  const loadSjGuarantee = async () => {
    try {
      const res = await api.get('/loot-box/admin/sj-guarantee');
      setSjGuarantee(res.data || null);
      if (res.data?.guarantee?.username) {
        setSjGuaranteeUser(res.data.guarantee.username);
      }
    } catch {
      setSjGuarantee(null);
    }
  };

  useEffect(() => {
    const t = (searchParams.get('tier') || '').trim().toLowerCase();
    if (PAID_TIERS.includes(t)) setSelectedTier(t);
  }, [searchParams]);

  const loadStatus = async (silent = false) => {
    try {
      const res = await api.get('/loot-box/status');
      _cachedLootStatus = res.data;
      _lootLastFetch = Date.now();
      setStatus(res.data);
    } catch (e) {
      if (!silent) toast.error(e.response?.data?.detail || 'Failed to load loot box status');
    }
  };

  useEffect(() => {
    const stale = Date.now() - _lootLastFetch > LOOT_REFRESH;
    if (!_cachedLootStatus) loadStatus(false);
    else if (stale) loadStatus(true);
    const id = setInterval(() => loadStatus(true), LOOT_REFRESH);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const adminRes = await api.get('/auth/staff-flags');
        if (!cancelled && adminRes.data?.is_admin) {
          setIsAdmin(true);
          const rRes = await api.get('/loot-box/admin/rarity');
          if (!cancelled && rRes.data) {
            setRarityConfig(rRes.data);
            const excl = Math.max(0, Math.min(100, Number(rRes.data.exclusive_chance_pct) ?? 10));
            const c = rRes.data.common_pct ?? 0;
            const u = rRes.data.uncommon_pct ?? 0;
            const r = rRes.data.rare_pct ?? 0;
            const sum = c + u + r;
            const box = excl >= 100
              ? { common_pct: 0, uncommon_pct: 0, rare_pct: 0 }
              : (sum > 0 ? { common_pct: c, uncommon_pct: u, rare_pct: r } : { common_pct: 55, uncommon_pct: 32, rare_pct: 13 });
            setRarityForm({
              exclusive_chance_pct: excl,
              ...box,
            });
          }
          try {
            const gRes = await api.get('/loot-box/admin/sj-guarantee');
            if (!cancelled) {
              setSjGuarantee(gRes.data || null);
              if (gRes.data?.guarantee?.username) {
                setSjGuaranteeUser(gRes.data.guarantee.username);
              }
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveSjGuarantee = async () => {
    const un = (sjGuaranteeUser || '').trim();
    if (!un) {
      toast.error('Enter a username');
      return;
    }
    setSjGuaranteeBusy(true);
    try {
      const res = await api.post('/loot-box/admin/sj-guarantee', { username: un });
      setSjGuarantee({
        guarantee: res.data?.guarantee || null,
        sj_claimed: !!res.data?.sj_claimed,
      });
      toast.success(res.data?.message || 'Set');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to set');
    } finally {
      setSjGuaranteeBusy(false);
    }
  };

  const clearSjGuarantee = async () => {
    setSjGuaranteeBusy(true);
    try {
      await api.delete('/loot-box/admin/sj-guarantee');
      setSjGuarantee({ guarantee: null, sj_claimed: sjGuarantee?.sj_claimed });
      setSjGuaranteeUser('');
      toast.success('Cleared');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to clear');
    } finally {
      setSjGuaranteeBusy(false);
    }
  };

  const saveRarity = async () => {
    setRaritySaving(true);
    try {
      const rawExclusive = Number(rarityForm.exclusive_chance_pct);
      const exclusivePct = (rawExclusive === rawExclusive) ? Math.max(0, Math.min(100, rawExclusive)) : 2;
      const isExclusive100 = exclusivePct >= 100;
      const c = Math.max(0, Math.min(100, rarityForm.common_pct ?? 0));
      const u = Math.max(0, Math.min(100, rarityForm.uncommon_pct ?? 0));
      const r = Math.max(0, Math.min(100, rarityForm.rare_pct ?? 0));
      const sum = c + u + r;
      const payload = {
        exclusive_chance_pct: exclusivePct,
        common_pct: isExclusive100 ? 0 : (sum > 0 ? c : 55),
        uncommon_pct: isExclusive100 ? 0 : (sum > 0 ? u : 32),
        rare_pct: isExclusive100 ? 0 : (sum > 0 ? r : 13),
      };
      if (!isExclusive100 && sum > 0 && sum !== 100) {
        const scale = 100 / sum;
        payload.common_pct = Math.round(c * scale);
        payload.uncommon_pct = Math.round(u * scale);
        payload.rare_pct = 100 - payload.common_pct - payload.uncommon_pct;
      }
      const res = await api.post('/loot-box/admin/rarity', payload);
      setRarityConfig(res.data);
      setRarityForm({
        exclusive_chance_pct: res.data.exclusive_chance_pct ?? payload.exclusive_chance_pct,
        common_pct: res.data.common_pct ?? payload.common_pct,
        uncommon_pct: res.data.uncommon_pct ?? payload.uncommon_pct,
        rare_pct: res.data.rare_pct ?? payload.rare_pct,
      });
      toast.success(res.data?.message ?? 'Rarity updated');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save rarity');
    } finally {
      setRaritySaving(false);
    }
  };

  // Auto-fill box quality % so Common + Uncommon + Rare = 100 when one is edited
  const updateBoxQuality = (field, value) => {
    const n = Math.max(0, Math.min(100, parseInt(String(value), 10) || 0));
    setRarityForm((f) => {
      const rest = 100 - n;
      const half = Math.floor(rest / 2);
      if (field === 'common_pct') return { ...f, common_pct: n, uncommon_pct: half, rare_pct: rest - half };
      if (field === 'uncommon_pct') return { ...f, uncommon_pct: n, common_pct: half, rare_pct: rest - half };
      if (field === 'rare_pct') return { ...f, rare_pct: n, common_pct: half, uncommon_pct: rest - half };
      return { ...f, [field]: n };
    });
  };

  const handleOpen = async () => {
    const pieces = status?.loot_box_pieces ?? 0;
    const cost = resolveOpenCost(status, selectedTier);
    const freeRare = Number(status?.loot_box_free_rare_opens || 0);
    const canUseFreeRare = selectedTier === 'rare' && freeRare > 0;
    if (pieces < cost && !canUseFreeRare) return;
    setResult(null);
    setOpenAnimLevel(0);
    setPhase('shaking');
    let apiData = null;
    try {
      const [res] = await Promise.all([
        apiPostWithCivilianProtectionConfirm('/loot-box/open', { tier: selectedTier }),
        new Promise((r) => setTimeout(r, 900)),
      ]);
      apiData = res.data;
      const level = computeOpenAnimLevel(apiData?.rewards, selectedTier);
      setOpenAnimLevel(level);
      setPhase('exploding');
      await new Promise((r) => setTimeout(r, explodeDurationMs(level)));
      setPhase('done');
      setResult(apiData);
      // Clear FREE UI immediately when voucher burned (don't wait on status round-trip).
      if (apiData?.used_free_rare_open || typeof apiData?.loot_box_free_rare_opens === 'number') {
        setStatus((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            loot_box_pieces: apiData.new_pieces ?? prev.loot_box_pieces,
            loot_box_free_rare_opens: Number(apiData.loot_box_free_rare_opens ?? 0),
          };
          _cachedLootStatus = next;
          return next;
        });
      }
      await refreshUser();
      await loadStatus();
      toast.success('The don smiles upon you.');
    } catch (e) {
      setPhase('idle');
      setOpenAnimLevel(0);
      if (isCivilianProtectionConfirmCancelled(e)) return;
      const detail = getApiErrorMessage(e) || e.message || 'Failed to open loot box';
      if (process.env.NODE_ENV === 'development') {
        console.error('[Loot box open failed]', {
          detail,
          status: e.response?.status,
          data: e.response?.data,
          error: e,
        });
      } else {
        console.error('[Loot box open failed]', detail, e.response?.status);
      }
      toast.error(detail);
    }
  };

  const closeModal = () => { setResult(null); setPhase('idle'); setOpenAnimLevel(0); };

  const pieces = status?.loot_box_pieces ?? 0;
  const freeRareOpens = Number(status?.loot_box_free_rare_opens || 0);
  const tierCost = resolveOpenCost(status, selectedTier);
  const tierTheme = LOOT_TIER_THEME[selectedTier] || LOOT_TIER_THEME.common;
  const claimed = status?.claimed_counts ?? { weapon: 0, car: 0, car_sj: 0, armour: 0, property: 0, weed_strain: 0 };
  const exclusiveCaps = status?.exclusive_caps ?? { weapon: 1, car: 1, car_sj: 1, armour: 1, property: 1, weed_strain: 5 };
  const reclaimableCatalog = status?.reclaimable_passives_catalog ?? [];
  const reclaimableLive = status?.reclaimable_passives ?? [];
  const reclaimableById = Object.fromEntries(
    (Array.isArray(reclaimableLive) ? reclaimableLive : []).map((r) => [r.id, r]),
  );
  const ownedRelicIds = new Set(status?.owned_reclaimable_passive_ids || []);
  const ownedRelics = reclaimableCatalog.filter((r) => ownedRelicIds.has(r.id));
  const canUseFreeRare = selectedTier === 'rare' && freeRareOpens > 0;
  const canOpen = (pieces >= tierCost || canUseFreeRare) && phase === 'idle';

  const last10 = status?.last_10_wins ?? [];

  return (
    <>
      <style>{globalStyles}</style>
      <style>{LOOT_BOX_STYLES + (animateIn ? LOOT_FADE_STYLES : '')}</style>

      <div className={`space-y-1.5 ${styles.pageContent} mobile-page-root flex flex-col items-center`} data-testid="lootbox-page">
        <div className="w-full max-w-xl space-y-1.5">
            {/* Header */}
            <div className="relative lb-fade-in">
              <p className="text-[9px] text-zinc-500 font-heading italic">
                Earn pieces from <Link to="/account/missions" className="text-primary underline">the Consigliere&apos;s Ledger</Link>.
                Pick a vault tier below (50–1,000 pieces). Better tiers and jackpots mean bigger reveals.
              </p>
              {(tutorialLoot || freeRareOpens > 0) ? (
                <div
                  className="mt-2 rounded-md border px-2.5 py-2"
                  style={{
                    borderColor: freeRareOpens > 0 ? 'rgba(96,165,250,0.45)' : 'rgba(161,161,170,0.35)',
                    background: freeRareOpens > 0 ? 'rgba(59,130,246,0.12)' : 'rgba(39,39,42,0.5)',
                  }}
                  data-testid="lootbox-free-rare-callout"
                >
                  <p className="text-[10px] font-heading font-bold uppercase tracking-wider text-blue-300">
                    {freeRareOpens > 0 ? 'Free Rare box ready' : 'Tutorial loot'}
                  </p>
                  <p className="text-[10px] font-heading text-zinc-300 mt-0.5 leading-snug">
                    {freeRareOpens > 0
                      ? `Open Rare once for free (${freeRareOpens} voucher${freeRareOpens === 1 ? '' : 's'}). After that, Rare costs ${fmtInt(resolveOpenCost(status, 'rare'))} pieces.`
                      : 'Your free Rare voucher was already used. Select Rare and spend pieces for another open.'}
                  </p>
                </div>
              ) : null}
            </div>

            <LootRewardGuide rewardInfo={status?.reward_info} odds={status?.loot_rarity_odds} />

            {/* Tier picker */}
            <div className={`grid grid-cols-2 gap-1.5 lb-fade-in min-h-[7.5rem]`} style={{ animationDelay: '0.02s' }}>
              {PAID_TIERS.map((t) => {
                const th = LOOT_TIER_THEME[t];
                const cost = resolveOpenCost(status, t);
                const afford = pieces >= cost;
                const selected = selectedTier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => phase === 'idle' && setSelectedTier(t)}
                    disabled={phase !== 'idle'}
                    className={`text-left rounded-md border px-2 py-2 transition-all min-h-[44px] ${
                      selected ? th.cardSelected : th.card
                    } ${!afford && !selected ? 'opacity-75' : ''}`}
                  >
                    <div className={`text-[10px] font-heading font-bold uppercase tracking-wider ${th.accent}`}>
                      {th.label}
                    </div>
                    <div className="text-[8px] text-mutedForeground font-heading">
                      {t === 'rare' && freeRareOpens > 0 ? 'FREE open available · ' : ''}
                      {fmtInt(cost)} pieces · {th.prizeHint}
                    </div>
                    <div className="text-[7px] text-mutedForeground/90 font-heading italic mt-0.5 leading-tight">{th.tagline}</div>
                  </button>
                );
              })}
            </div>

            {/* Chest card */}
            <div
              className={`relative ${styles.panel} rounded-md border lb-fade-in mobile-panel ${phase === 'exploding' ? 'overflow-visible' : 'overflow-hidden'} ${tierTheme.card} ${canOpen ? `ring-1 ${tierTheme.ring}` : 'border-primary/20'}`}
              style={{ animationDelay: '0.03s' }}
            >
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                <span className={`text-[9px] font-heading font-bold uppercase tracking-[0.12em] ${tierTheme.accent}`}>
                  {tierTheme.label} Vault
                </span>
              </div>
              <div className="p-3 relative">
                <Embers colors={tierTheme.particleColors} />
                <ChestIcon
                  tier={selectedTier}
                  shaking={phase === 'shaking'}
                  exploding={phase === 'exploding'}
                  ready={canOpen}
                  openAnimLevel={openAnimLevel}
                />
                <div className="text-center mb-2">
                  <div className="flex items-baseline justify-center gap-1.5">
                    <span className={`text-2xl font-heading font-bold ${tierTheme.accent}`}>{fmtInt(pieces)}</span>
                    <span className="text-[10px] text-mutedForeground font-heading">/{fmtInt(tierCost)}</span>
                  </div>
                  <p className="text-[9px] text-mutedForeground font-heading italic mt-0.5">pieces for this tier</p>
                </div>
                <PiecesBar pieces={pieces} cost={tierCost} />
                <button
                  type="button"
                  onClick={handleOpen}
                  disabled={!canOpen}
                  className={`w-full mt-2 py-2 px-2.5 rounded font-heading font-bold uppercase tracking-wider text-[10px] border flex items-center justify-center gap-2 transition-all min-h-[44px] ${
                    canOpen
                      ? `bg-primary/20 ${tierTheme.accent} border-primary/40 hover:bg-primary/30`
                      : 'bg-zinc-800/50 text-zinc-500 border-zinc-600/50 cursor-not-allowed'
                  }`}
                >
                  <Package size={14} />
                  {phase === 'shaking'
                    ? 'RATTLING THE LOCK…'
                    : phase === 'exploding'
                      ? 'THE VAULT OPENS…'
                      : canOpen
                        ? (canUseFreeRare
                          ? `OPEN FREE ${tierTheme.label.toUpperCase()} BOX`
                          : `OPEN ${tierTheme.label.toUpperCase()} — ${fmtInt(tierCost)} PIECES`)
                        : `${fmtInt(Math.max(0, tierCost - pieces))} PIECES NEEDED`}
                </button>
              </div>
              <div className="lb-art-line text-primary mx-2.5" />
            </div>

            {/* Scarcity card */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Exclusive Scarcity</span>
              </div>
              <div className="p-1.5">
                <p className="text-[9px] text-mutedForeground font-heading italic text-center mb-1">
                  Each row is how many exist worldwide vs the cap for that reward (you can still only hold one of each yourself).
                </p>
                <p className="text-[9px] text-amber-200/90 font-heading italic text-center mb-1.5 leading-snug">
                  Loot exclusives are not guaranteed—each vault opening is chance-based, and exclusives still depend on availability and global caps.
                </p>
                <ul className="list-none p-0 m-0 flex flex-col gap-0.5">
                  <ScarcityRow icon={Swords} label="Exclusive Weapon" claimed={claimed.weapon} cap={exclusiveCaps.weapon} />
                  <ScarcityRow icon={Car} label="Model SJ (Rare 5% / UR 10%)" claimed={claimed.car_sj} cap={exclusiveCaps.car_sj ?? 1} />
                  <ScarcityRow icon={Shield} label="Exclusive Armour" claimed={claimed.armour} cap={exclusiveCaps.armour} />
                  <ScarcityRow icon={Building2} label="Speakeasy" claimed={claimed.property} cap={exclusiveCaps.property} />
                  <ScarcityRow icon={Leaf} label="Weed Empire specials" claimed={claimed.weed_strain} cap={exclusiveCaps.weed_strain} />
                </ul>
                {reclaimableCatalog.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-primary/15">
                    <p className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.1em] text-center mb-0.5">
                      Vault Relics
                    </p>
                    <p className="text-[9px] text-mutedForeground font-heading italic text-center mb-1 leading-snug">
                      Globally unique passives (cap 1 each). Returns to vaults if the holder is killed — not transferred.
                    </p>
                    <ul className="list-none p-0 m-0 flex flex-col gap-0.5">
                      {reclaimableCatalog.map((item) => {
                        const live = reclaimableById[item.id] || {};
                        const label = item.buff_label
                          ? `${item.name} (${item.buff_label})`
                          : item.name;
                        const claimedN = Number(live.claimed ?? 0);
                        return (
                          <ScarcityRow
                            key={item.id}
                            icon={Gem}
                            label={label}
                            claimed={claimedN}
                            cap={Number(live.cap ?? item.cap ?? 1)}
                            holder={claimedN > 0 ? (live.owner_username || null) : null}
                          />
                        );
                      })}
                    </ul>
                    {ownedRelics.length > 0 && (
                      <div className="mt-1.5 px-2 py-1 rounded border border-amber-500/25 bg-amber-500/5">
                        <p className="text-[9px] font-heading font-bold text-amber-200/90 uppercase tracking-[0.08em] mb-0.5">
                          Your vault relic
                        </p>
                        {ownedRelics.map((r) => (
                          <p key={r.id} className="text-[10px] font-heading text-foreground leading-snug">
                            {r.name}
                            {r.buff_label ? ` — ${r.buff_label}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="lb-art-line text-primary mx-2.5" />
            </div>

            {/* Admin: Loot box rarity */}
            {isAdmin && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/30 border-dashed lb-fade-in mobile-panel`} style={{ animationDelay: '0.06s' }}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2 py-1 bg-primary/10 border-b border-primary/20 flex items-center gap-1.5">
                  <Shield size={12} className="text-primary shrink-0" />
                  <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Admin — Rarity %</span>
                </div>
                <div className="p-2 space-y-1.5">
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-heading">
                    <label className="flex items-center gap-1.5">
                      <span className="text-mutedForeground w-24">Exclusive %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={rarityForm.exclusive_chance_pct}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setRarityForm((f) => {
                            const next = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : f.exclusive_chance_pct;
                            if (next >= 100) return { ...f, exclusive_chance_pct: 100, common_pct: 0, uncommon_pct: 0, rare_pct: 0 };
                            return { ...f, exclusive_chance_pct: next };
                          });
                        }}
                        className="w-14 px-1.5 py-0.5 rounded border border-primary/30 bg-background text-foreground text-right"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="text-mutedForeground w-24">Common %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={rarityForm.common_pct}
                        onChange={(e) => updateBoxQuality('common_pct', e.target.value)}
                        className="w-14 px-1.5 py-0.5 rounded border border-primary/30 bg-background text-foreground text-right"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="text-mutedForeground w-24">Uncommon %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={rarityForm.uncommon_pct}
                        onChange={(e) => updateBoxQuality('uncommon_pct', e.target.value)}
                        className="w-14 px-1.5 py-0.5 rounded border border-primary/30 bg-background text-foreground text-right"
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <span className="text-mutedForeground w-24">Rare %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={rarityForm.rare_pct}
                        onChange={(e) => updateBoxQuality('rare_pct', e.target.value)}
                        className="w-14 px-1.5 py-0.5 rounded border border-primary/30 bg-background text-foreground text-right"
                      />
                    </label>
                  </div>
                  <p className="text-[8px] text-mutedForeground italic leading-tight">
                    Exclusive % = chance per prize for a loot exclusive. Box quality % no longer affects opens (players choose tier).
                  </p>
                  <button
                    type="button"
                    onClick={saveRarity}
                    disabled={raritySaving}
                    className="w-full py-1 px-1.5 rounded border border-primary/40 bg-primary/15 text-primary font-heading text-[9px] uppercase tracking-wider flex items-center justify-center gap-1 hover:bg-primary/25 disabled:opacity-50 tap-feedback touch-manipulation active:scale-[0.97] min-h-10"
                  >
                    <Save size={12} />
                    {raritySaving ? 'Saving…' : 'Save rarity'}
                  </button>
                  <div className="pt-1.5 mt-1.5 border-t border-primary/20 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[8px] font-heading font-bold text-amber-200/90 uppercase tracking-wider">
                        Secret — next UR → SJ
                      </span>
                      <button
                        type="button"
                        onClick={loadSjGuarantee}
                        disabled={sjGuaranteeBusy}
                        className="text-[8px] text-mutedForeground underline disabled:opacity-50 tap-feedback touch-manipulation active:scale-[0.97] min-h-10"
                      >
                        refresh
                      </button>
                    </div>
                    <p className="text-[7px] text-mutedForeground leading-tight">
                      Username gets Model SJ on their next Ultra Rare open (if still unclaimed). Cleared after grant. Not shown to players.
                    </p>
                    {sjGuarantee?.sj_claimed ? (
                      <p className="text-[8px] text-amber-300">SJ already claimed — guarantee inactive.</p>
                    ) : sjGuarantee?.guarantee?.username ? (
                      <p className="text-[8px] text-emerald-400/90">
                        Armed: <span className="font-bold">{sjGuarantee.guarantee.username}</span>
                        {sjGuarantee.guarantee.set_by ? ` (by ${sjGuarantee.guarantee.set_by})` : ''}
                      </p>
                    ) : (
                      <p className="text-[8px] text-mutedForeground">No guarantee set.</p>
                    )}
                    <div className="flex flex-wrap gap-1 items-center">
                      <input
                        type="text"
                        value={sjGuaranteeUser}
                        onChange={(e) => setSjGuaranteeUser(e.target.value)}
                        placeholder="Username"
                        className="flex-1 min-w-[100px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-background text-foreground text-[10px] font-heading"
                      />
                      <button
                        type="button"
                        onClick={saveSjGuarantee}
                        disabled={sjGuaranteeBusy || !!sjGuarantee?.sj_claimed}
                        className="px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[8px] font-heading uppercase disabled:opacity-50 tap-feedback touch-manipulation active:scale-[0.97] min-h-10"
                      >
                        Arm
                      </button>
                      <button
                        type="button"
                        onClick={clearSjGuarantee}
                        disabled={sjGuaranteeBusy || !sjGuarantee?.guarantee}
                        className="px-1.5 py-0.5 rounded border border-zinc-500/40 text-mutedForeground text-[8px] font-heading uppercase disabled:opacity-50 tap-feedback touch-manipulation active:scale-[0.97] min-h-10"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
                <div className="lb-art-line text-primary mx-2.5" />
              </div>
            )}

            {/* ── Last 10 wins (below, centered) ── */}
            <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Last 10 wins</span>
              </div>
              <div className="p-1.5 max-h-[50vh] overflow-y-auto">
                {last10.length === 0 ? (
                  <p className="text-[9px] text-mutedForeground font-heading italic py-0.5">No opens yet.</p>
                ) : (
                  <ul className="list-none p-0 m-0 space-y-1">
                    {last10.map((win, i) => (
                      <li key={i} className="text-[8px] font-heading border-b border-primary/10 pb-1 last:border-0 last:pb-0 leading-tight">
                        <div className="flex items-center justify-between gap-0.5 text-mutedForeground uppercase tracking-wider">
                          <span>{win.box_quality ?? '—'} · {win.prizes_count ?? 0}</span>
                          <span>{win.opened_at ? new Date(win.opened_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span>
                        </div>
                        <ul className="mt-0.5 space-y-0.5 text-foreground">
                          {(win.rewards || []).slice(0, 4).map((r, j) => (
                            <li key={j} className="truncate">{rewardLabel(r)}</li>
                          ))}
                          {(win.rewards?.length ?? 0) > 4 && <li className="text-mutedForeground text-[7px]">+{(win.rewards?.length ?? 0) - 4}</li>}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="lb-art-line text-primary mx-2.5" />
            </div>
        </div>

        {result && <ResultModal result={result} onClose={closeModal} openAnimLevel={openAnimLevel} />}
      </div>
    </>
  );
}
