import { useState, useEffect, useRef } from 'react';
import { Gift, X, Package, Swords, Car, Shield, Building2, Coins, Zap, Save, Puzzle } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const LOOT_BOX_STYLES = `
  @keyframes lb-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .lb-fade-in { animation: lb-fade-in 0.4s ease-out both; }
  .lb-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  @keyframes lb-idle-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
  @keyframes lb-shimmer-band { 0% { background-position: -120% 0; } 100% { background-position: 220% 0; } }
  .lb-loot-ready-glow { animation: goldPulse 2.2s ease-in-out infinite; border-radius: 0.5rem; }
`;

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
function Particles({ active }) {
  if (!active) return null;
  const particles = Array.from({ length: 20 }, (_, i) => {
    const angle = (i / 20) * 360;
    const dist = 60 + Math.random() * 80;
    const px = `${Math.cos((angle * Math.PI) / 180) * dist}px`;
    const py = `${Math.sin((angle * Math.PI) / 180) * dist}px`;
    const colors = ['#eab308', '#f59e0b', '#fcd34d', '#fff7ed', '#dc2626'];
    return { px, py, color: colors[i % colors.length], delay: Math.random() * 0.2 };
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
function Embers() {
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
            background: 'radial-gradient(circle, #fbbf24, #92400e)',
            animation: `emberFloat ${e.duration} ${e.delay} ease-in infinite`,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Reward Icon ─── */
function RewardIcon({ type, rarity }) {
  const isExclusive = rarity === 'exclusive' || rarity === 'loot_exclusive' || rarity === 'ultra_rare';
  const isBoxTier = rarity === 'common' || rarity === 'uncommon' || rarity === 'rare';
  const iconMap = {
    weapon: Swords, car: Car, armour: Shield,
    property: Building2, cash: Coins,
    points: Zap, rank_points: Zap, perk: Zap,
    bullets: Package, cars: Car, token: Gift, loot_pieces: Puzzle,
  };
  const Icon = iconMap[type] || Gift;
  const wrap =
    isExclusive
      ? 'bg-primary/30 border-primary'
      : isBoxTier && rarity === 'rare'
        ? 'bg-blue-500/15 border-blue-400/35'
        : 'bg-primary/10 border-primary/30';
  return (
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${wrap}`}>
      <Icon size={16} className={isExclusive ? 'text-primary' : isBoxTier && rarity === 'rare' ? 'text-blue-200' : 'text-primary/90'} />
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
    case 'token':     return `${fmtInt(reward.amount ?? reward.value ?? 1)} ${(reward.token_type || 'bonus').replace(/_/g, ' ')} token(s)`;
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
  const { pieces_per_open, standard_prize_types, standard_note, exclusives, exclusive_note, tiers } = rewardInfo;
  const tierOrder = [
    { key: 'common', title: 'Common box', color: 'text-zinc-400 border-zinc-600/40 bg-zinc-900/30' },
    { key: 'uncommon', title: 'Uncommon box', color: 'text-green-400 border-green-600/35 bg-green-950/20' },
    { key: 'rare', title: 'Rare box', color: 'text-blue-300 border-blue-500/35 bg-blue-950/25' },
  ];
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
        <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">What you can win</span>
      </div>
      <div className="p-2 space-y-2">
        <p className="text-[8px] text-mutedForeground font-heading leading-snug">
          Opens cost <span className="text-primary font-bold">{fmtInt(pieces_per_open)}</span> pieces. Amounts below are min–max per prize when that category rolls for your box tier.
        </p>
        {odds && (
          <p className="text-[8px] text-mutedForeground font-heading leading-snug border border-primary/15 rounded px-1.5 py-1 bg-primary/5">
            <span className="text-amber-200/90">~{Number(odds.exclusive_chance_pct).toFixed(1)}%</span> per prize for a loot exclusive (if still claimable).
            {' '}Box tier:{' '}
            <span className="text-zinc-400">Common {odds.common_box_pct}%</span>
            {' · '}
            <span className="text-green-400/90">Uncommon {odds.uncommon_box_pct}%</span>
            {' · '}
            <span className="text-blue-300/90">Rare {odds.rare_box_pct}%</span>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          {tierOrder.map(({ key, title, color }) => {
            const t = tiers[key];
            if (!t) return null;
            const [pLo, pHi] = t.prize_count || [1, 1];
            const tok = t.tokens || {};
            const [taLo, taHi] = tok.amount || [1, 1];
            const cars = t.cars || {};
            const [cLo, cHi] = cars.count || [1, 1];
            return (
              <div key={key} className={`rounded border px-1.5 py-1.5 ${color}`}>
                <div className="text-[9px] font-heading font-bold uppercase tracking-wider mb-1">{title}</div>
                <div className="text-[7px] opacity-90 mb-1">{fmtInt(pLo)}–{fmtInt(pHi)} prizes</div>
                <ul className="list-none p-0 m-0 space-y-0.5 text-[7px] font-heading leading-tight opacity-95">
                  <li>Cash {formatCashRange(t.cash[0], t.cash[1])}</li>
                  <li>Points {formatNumRange(t.points[0], t.points[1])}</li>
                  <li>Rank pts {formatNumRange(t.rank_points[0], t.rank_points[1])}</li>
                  <li>Bullets {formatNumRange(t.bullets[0], t.bullets[1])}</li>
                  <li>Pieces {formatNumRange(t.loot_pieces[0], t.loot_pieces[1])}</li>
                  <li>Tokens {formatNumRange(taLo, taHi)} (random type)</li>
                  <li>Cars {formatNumRange(cLo, cHi)} · {(cars.rarities || []).join(', ')}</li>
                </ul>
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
          <ul className="mt-1 max-h-24 overflow-y-auto list-disc pl-4 text-mutedForeground space-y-0.5 text-[7px]">
            {(tiers.common?.tokens?.types || []).map((x) => (
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
function PiecesBar({ pieces }) {
  const pct = Math.min((pieces / 100) * 100, 100);
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden border border-primary/20">
        <div className="h-full bg-primary/80 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─── Chest icon (layered “proper” loot box) ─── */
function ChestIcon({ shaking, exploding, ready }) {
  const motion =
    exploding ? 'boxExplode 0.6s ease-out forwards' : shaking ? 'boxShake 0.5s ease-in-out infinite' : 'lb-idle-float 3.2s ease-in-out infinite';

  return (
    <div
      className={`relative mx-auto mb-4 flex flex-col items-center justify-end ${ready && !shaking && !exploding ? 'lb-loot-ready-glow p-1 -m-1' : ''}`}
      style={{ width: '7.75rem', height: '9.25rem', animation: motion }}
    >
      <Particles active={exploding} />
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
            borderColor: 'rgba(212, 165, 92, 0.95)',
            boxShadow: 'inset 0 3px 10px rgba(255,255,255,0.18), inset 0 -14px 20px rgba(0,0,0,0.45), 0 -2px 0 rgba(0,0,0,0.25)',
            background: 'linear-gradient(165deg, #e8c896 0%, #b8894a 28%, #7a4f24 62%, #4a2c12 100%)',
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
            borderColor: 'rgba(180, 130, 70, 0.9)',
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
              background: 'linear-gradient(90deg, transparent, rgba(234,179,8,0.25) 12%, rgba(250,204,21,0.85) 50%, rgba(234,179,8,0.25) 88%, transparent)',
              backgroundSize: '200% 100%',
              animation: ready && !shaking && !exploding ? 'lb-shimmer-band 2.8s linear infinite' : undefined,
            }}
          />
          <div
            className="absolute top-[58%] left-0 right-0 h-[2px] opacity-90 pointer-events-none"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(234,179,8,0.2) 10%, rgba(212,175,55,0.75) 50%, rgba(234,179,8,0.2) 90%, transparent)',
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
function ScarcityRow({ icon: Icon, label, claimed, cap }) {
  const full = claimed >= cap;
  return (
    <li className={`flex items-center gap-2 py-1.5 px-2 rounded border ${full ? 'bg-red-500/10 border-red-500/25' : 'bg-primary/5 border-primary/15'}`}>
      <Icon size={12} className={full ? 'text-red-400 shrink-0' : 'text-primary shrink-0'} />
      <span className="flex-1 text-[10px] font-heading text-foreground">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: cap }, (_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full border ${i < claimed ? (full ? 'bg-red-400 border-red-400' : 'bg-primary border-primary') : 'bg-zinc-600 border-zinc-500'}`} />
        ))}
      </div>
      <span className={`text-[9px] font-heading min-w-[2rem] text-right ${full ? 'text-red-400' : 'text-mutedForeground'}`}>{claimed}/{cap}</span>
    </li>
  );
}

/* ─── Result modal ─── */
function ResultModal({ result, onClose }) {
  const rewards = result.rewards || (result.reward ? [result.reward] : []);
  const quality = result.box_quality;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      style={{ animation: 'overlayIn 0.25s ease-out' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${styles.panel} rounded-lg border border-primary/30 max-w-md w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl`}
        style={{ animation: 'modalIn 0.35s cubic-bezier(0.22,1,0.36,1)' }}
      >
        <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="px-4 pt-4 pb-2 flex justify-between items-start">
          <div>
            <h3 className="text-lg font-heading font-bold text-primary">The Envelope, Please</h3>
            {quality && (
              <p className="text-[11px] text-mutedForeground font-heading italic mt-0.5 capitalize">
                {quality} box — {rewards.length} prize{rewards.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded border border-primary/20 bg-primary/5 text-mutedForeground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="h-px bg-primary/20 mx-4" />
        <ul className="list-none p-0 m-0 overflow-y-auto flex-1 flex flex-col gap-2 p-4">
          {rewards.map((r, i) => (
            <li
              key={i}
              className="flex items-center gap-2 p-2 rounded border border-primary/15 bg-primary/5"
              style={{ animation: `rewardPop 0.45s ${i * 0.12}s cubic-bezier(0.22,1,0.36,1) both` }}
            >
              <RewardIcon type={r.type} rarity={r.rarity} />
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
                            {idx < r.items.length - 1 ? ', ' : null}
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    rewardLabel(r)
                  )}
                </div>
                {r.rarity && <div className="mt-1"><RarityBadge rarity={r.rarity} /></div>}
              </div>
            </li>
          ))}
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
  const [status, setStatus] = useState(_cachedLootStatus);
  const [phase, setPhase] = useState('idle'); // idle | shaking | exploding | done
  const [result, setResult] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rarityConfig, setRarityConfig] = useState(null);
  const [rarityForm, setRarityForm] = useState({ exclusive_chance_pct: 10, common_pct: 55, uncommon_pct: 32, rare_pct: 13 });
  const [raritySaving, setRaritySaving] = useState(false);

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
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
    if (pieces < 100) return;
    setResult(null);
    setPhase('shaking');
    try {
      const [res] = await Promise.all([
        api.post('/loot-box/open', { tier: 'standard' }),
        new Promise((r) => setTimeout(r, 900)),
      ]);
      setPhase('exploding');
      await new Promise((r) => setTimeout(r, 600));
      setPhase('done');
      setResult(res.data);
      await refreshUser();
      await loadStatus();
      toast.success('The don smiles upon you.');
    } catch (e) {
      setPhase('idle');
      const detail = e.response?.data?.detail ?? e.message ?? 'Failed to open loot box';
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

  const closeModal = () => { setResult(null); setPhase('idle'); };

  const pieces = status?.loot_box_pieces ?? 0;
  const claimed = status?.claimed_counts ?? { weapon: 0, car: 0, armour: 0, property: 0 };
  const exclusiveCaps = status?.exclusive_caps ?? { weapon: 1, car: 1, armour: 1, property: 1 };
  const canOpen = pieces >= 100 && phase === 'idle';

  if (!status) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root`}>
        <style>{LOOT_BOX_STYLES}</style>
      </div>
    );
  }

  const last10 = status?.last_10_wins ?? [];

  return (
    <>
      <style>{globalStyles}</style>
      <style>{LOOT_BOX_STYLES}</style>

      <div className={`space-y-1.5 ${styles.pageContent} mobile-page-root flex flex-col items-center`} data-testid="lootbox-page">
        <div className="w-full max-w-xl space-y-1.5">
            {/* Header */}
            <div className="relative lb-fade-in">
              <p className="text-[9px] text-zinc-500 font-heading italic">Earn pieces from <Link to="/account/missions" className="text-primary underline">the Consigliere's Ledger</Link>. One hundred pieces open a box. Exclusives are scarce.</p>
            </div>

            <LootRewardGuide rewardInfo={status.reward_info} odds={status.loot_rarity_odds} />

            {/* Chest card */}
            <div className={`relative ${styles.panel} rounded-md border border-primary/20 lb-fade-in mobile-panel ${phase === 'exploding' ? 'overflow-visible' : 'overflow-hidden'} ${canOpen ? 'ring-1 ring-primary/30' : ''}`} style={{ animationDelay: '0.03s' }}>
              <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">The Vault</span>
              </div>
              <div className="p-3 relative">
                <Embers />
                <ChestIcon shaking={phase === 'shaking'} exploding={phase === 'exploding'} ready={canOpen} />
                <div className="text-center mb-2">
                  <div className="flex items-baseline justify-center gap-1.5">
                    <span className="text-2xl font-heading font-bold text-primary">{fmtInt(pieces)}</span>
                    <span className="text-[10px] text-mutedForeground font-heading">/100</span>
                  </div>
                  <p className="text-[9px] text-mutedForeground font-heading italic mt-0.5">pieces collected</p>
                </div>
                <PiecesBar pieces={pieces} />
                <button
                  type="button"
                  onClick={handleOpen}
                  disabled={!canOpen}
                  className={`w-full mt-2 py-1.5 px-2.5 rounded font-heading font-bold uppercase tracking-wider text-[10px] border flex items-center justify-center gap-2 transition-all ${
                    canOpen
                      ? 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30'
                      : 'bg-zinc-800/50 text-zinc-500 border-zinc-600/50 cursor-not-allowed'
                  }`}
                >
                  <Package size={14} />
                  {phase === 'shaking' ? 'RATTLING THE LOCK…' : phase === 'exploding' ? 'THE VAULT OPENS…' : canOpen ? 'CRACK THE VAULT' : `${fmtInt(Math.max(0, 100 - pieces))} PIECES NEEDED`}
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
                  <ScarcityRow icon={Car} label="Exclusive Vehicle" claimed={claimed.car} cap={exclusiveCaps.car} />
                  <ScarcityRow icon={Shield} label="Exclusive Armour" claimed={claimed.armour} cap={exclusiveCaps.armour} />
                  <ScarcityRow icon={Building2} label="Speakeasy" claimed={claimed.property} cap={exclusiveCaps.property} />
                </ul>
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
                  <p className="text-[8px] text-mutedForeground italic leading-tight">Exclusive % = chance per prize for a loot exclusive on that roll. Box quality: set one, other two auto-fill to 100.</p>
                  <button
                    type="button"
                    onClick={saveRarity}
                    disabled={raritySaving}
                    className="w-full py-1 px-1.5 rounded border border-primary/40 bg-primary/15 text-primary font-heading text-[9px] uppercase tracking-wider flex items-center justify-center gap-1 hover:bg-primary/25 disabled:opacity-50"
                  >
                    <Save size={12} />
                    {raritySaving ? 'Saving…' : 'Save rarity'}
                  </button>
                </div>
                <div className="lb-art-line text-primary mx-2.5" />
              </div>
            )}

            {/* Active rewards */}
            {(status?.active_rewards?.length > 0) && (
              <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 lb-fade-in mobile-panel`} style={{ animationDelay: '0.07s' }}>
                <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                  <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Active rewards</span>
                </div>
                <ul className="p-1.5 list-none m-0 flex flex-col gap-0.5">
                  {status.active_rewards.map((ar, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-[9px] font-heading text-foreground bg-primary/5 border border-primary/15 rounded px-1.5 py-1">
                      <Zap size={12} className="text-primary shrink-0" />
                      <span>
                        {ar.name}
                        {ar.expires_at && (() => {
                          try {
                            const until = new Date(ar.expires_at.replace('Z', 'Z'));
                            const ms = until - new Date();
                            if (ms <= 0) return null;
                            const h = Math.floor(ms / 3600000);
                            const m = Math.floor((ms % 3600000) / 60000);
                            return <span className="text-mutedForeground italic ml-1">({h}h {m}m left)</span>;
                          } catch { return null; }
                        })()}
                        {ar.attempts_remaining != null && <span className="text-mutedForeground italic ml-1">({ar.attempts_remaining} attempts left)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
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

        {result && <ResultModal result={result} onClose={closeModal} />}
      </div>
    </>
  );
}
