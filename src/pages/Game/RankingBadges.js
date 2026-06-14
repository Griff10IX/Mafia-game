import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Award } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import styles from '../../styles/noir.module.css';

const BADGES_CACHE_KEY = 'mafia_ranking_badges_v1';

// ─── Tier Definitions ─────────────────────────────────────────────────────────
export const TIER_DEFS = {
  bronze: {
    id: 'bronze', label: 'Bronze', nameColor: '#cd7f32',
    bodyFill: '#3d1f08', bodyStroke: '#cd7f32', innerStroke: '#a05a20', textFill: '#e8a060',
    crownColor: '#cd7f32', crownType: 'single', decor: null,
    animClass: 'badge-anim-bronze', size: 32, stars: false,
  },
  silver: {
    id: 'silver', label: 'Silver', nameColor: '#c0cfe0',
    bodyFill: '#1a2030', bodyStroke: '#a0b0c8', innerStroke: '#7090b0', textFill: '#d0e0f0',
    crownColor: '#c0d0e8', crownType: 'single', decor: null,
    animClass: 'badge-anim-silver', size: 34, stars: false,
  },
  gold: {
    id: 'gold', label: 'Gold', nameColor: '#ffd700',
    bodyFill: '#251800', bodyStroke: '#ffd700', innerStroke: '#c8a000', textFill: '#ffe060',
    crownColor: '#ffd700', crownType: 'double', decor: 'laurel',
    animClass: 'badge-anim-gold', size: 36, stars: false,
  },
  platinum: {
    id: 'platinum', label: 'Platinum', nameColor: '#b8e8ff',
    bodyFill: '#0a1a25', bodyStroke: '#70c8f0', innerStroke: '#40a0d0', textFill: '#c0eaff',
    crownColor: '#90d8ff', crownType: 'double', decor: 'diamonds',
    animClass: 'badge-anim-platinum', size: 38, stars: false,
  },
  diamond: {
    id: 'diamond', label: 'Diamond', nameColor: '#a0ffff',
    bodyFill: '#051520', bodyStroke: '#00e8ff', innerStroke: '#00a8cc', textFill: '#b0ffff',
    crownColor: '#00e8ff', crownType: 'royal', decor: 'facets',
    animClass: 'badge-anim-diamond', size: 42, stars: false,
    grad: { stops: ['#a0f8ff', '#e8feff', '#40c8e8'] },
  },
  galaxy: {
    id: 'galaxy', label: 'Galaxy', nameColor: '#d090ff',
    bodyFill: '#0d0520', bodyStroke: '#9040ff', innerStroke: '#6020c0', textFill: '#e0b0ff',
    crownColor: '#d090ff', crownType: 'royal', decor: 'galaxy',
    animClass: 'badge-anim-galaxy', size: 46, stars: true,
    grad: { stops: ['#1a0a3a', '#4a1080', '#8020c0', '#c040a0', '#ff6080'] },
  },
  obsidian: {
    id: 'obsidian', label: 'Obsidian', nameColor: '#d060ff',
    bodyFill: '#080010', bodyStroke: '#8000ff', innerStroke: '#500090', textFill: '#e080ff',
    crownColor: '#ff4080', crownType: 'royal', decor: 'obsidian',
    animClass: 'badge-anim-obsidian', size: 50, stars: true,
    grad: { stops: ['#0d0020', '#3a0060', '#8000c0', '#c00060', '#ff2040'] },
  },
  void: {
    id: 'void', label: 'Void', nameColor: '#80ffee',
    bodyFill: '#000408', bodyStroke: '#00ffcc', innerStroke: '#005540', textFill: '#a0fff0',
    crownColor: '#00ffcc', crownType: 'royal', decor: 'void',
    animClass: 'badge-anim-void', size: 54, stars: true,
    grad: { stops: ['#000814', '#001a2a', '#002060', '#4a0080', '#800040', '#001a40', '#00102a'] },
  },
};

export const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'galaxy', 'obsidian', 'void'];

// ─── Milestone → Tier mapping (bronze < silver < gold, gold well above 1K for crimes) ───
export const MILESTONE_TIERS = {
  crimes:         { 500: 'bronze', 2500: 'silver', 10000: 'gold', 50000: 'platinum', 250000: 'diamond', 500000: 'galaxy', 1000000: 'obsidian', 5000000: 'void' },
  gta:            { 50: 'bronze', 250: 'silver', 1000: 'gold', 5000: 'platinum', 25000: 'diamond', 100000: 'galaxy', 250000: 'obsidian', 500000: 'void' },
  jail_busts:     { 50: 'bronze', 250: 'silver', 1000: 'gold', 5000: 'platinum', 25000: 'diamond', 100000: 'galaxy', 250000: 'obsidian', 500000: 'void' },
  kills:          { 50: 'bronze', 100: 'silver', 250: 'gold', 500: 'platinum', 750: 'diamond', 1000: 'galaxy', 1500: 'void' },
  oc_heists:      { 50: 'bronze', 250: 'silver', 1000: 'gold', 5000: 'platinum', 25000: 'diamond', 50000: 'galaxy', 100000: 'obsidian', 250000: 'void' },
  bullets_melted: { 5000: 'bronze', 25000: 'silver', 100000: 'gold', 500000: 'platinum', 1000000: 'diamond', 2500000: 'galaxy', 5000000: 'void' },
  booze_runs:     { 50: 'bronze', 250: 'silver', 1000: 'gold', 5000: 'platinum', 25000: 'diamond', 50000: 'galaxy', 100000: 'obsidian', 250000: 'void' },
  hitlist_npc:    { 50: 'bronze', 250: 'silver', 1000: 'gold', 2500: 'platinum', 5000: 'diamond', 7500: 'galaxy', 10000: 'void' },
};

// Resolve tier for a given target so order is always Bronze → … → Void (no Platinum then Bronze)
function getTierForTarget(categoryId, target) {
  const tierMap = MILESTONE_TIERS[categoryId] || {};
  const thresholds = Object.keys(tierMap).map(Number).filter((t) => t <= target).sort((a, b) => a - b);
  const best = thresholds[thresholds.length - 1];
  return best != null ? tierMap[best] : 'bronze';
}

// ─── Category accent colours ──────────────────────────────────────────────────
export const CATEGORY_COLORS = {
  crimes:         { color: 'var(--noir-primary)', bg: '#201600', stroke: '#b8960c' },
  gta:            { color: '#a78bfa', bg: '#150d28', stroke: '#7c4dcc' },
  jail_busts:     { color: '#60a5fa', bg: '#0a1528', stroke: '#2255aa' },
  kills:          { color: '#f87171', bg: '#200808', stroke: '#cc3333' },
  oc_heists:      { color: '#34d399', bg: '#051a10', stroke: '#158848' },
  bullets_melted: { color: '#fb923c', bg: '#1a0d00', stroke: '#aa5010' },
  booze_runs:     { color: '#2dd4bf', bg: '#051818', stroke: '#108888' },
  hitlist_npc:    { color: '#f472b6', bg: '#1a0510', stroke: '#aa2266' },
};

// What each badge category is for (shown under category name)
export const CATEGORY_DESCRIPTIONS = {
  crimes:         'Crimes committed',
  gta:            'GTA car thefts',
  jail_busts:     'Jail busts completed',
  kills:          'Kills (attack wins)',
  oc_heists:      'Organised crime & Crew OC heists',
  bullets_melted: 'Bullets melted at armoury',
  booze_runs:     'Booze runs completed',
  hitlist_npc:    'Hitlist NPC kills',
};

// Short labels for compact display (e.g. on profile)
export const CATEGORY_LABELS = {
  crimes:         'Crimes',
  gta:            'GTA',
  jail_busts:     'Jail busts',
  kills:          'Kills',
  oc_heists:      'OC & Crew OC',
  bullets_melted: 'Melt',
  booze_runs:     'Booze',
  hitlist_npc:    'Hitlist',
};

// ─── CSS animations (injected once via <style>) ───────────────────────────────
export const BADGE_STYLES = `
  @keyframes badge-bronze   { 0%,100%{ filter:drop-shadow(0 0 2px rgba(180,100,30,.4)); }  50%{ filter:drop-shadow(0 0 5px rgba(220,140,60,.7)); } }
  @keyframes badge-silver   { 0%,100%{ filter:drop-shadow(0 0 2px rgba(180,190,210,.4)); } 50%{ filter:drop-shadow(0 0 6px rgba(210,220,240,.85)); } }
  @keyframes badge-gold     { 0%,100%{ filter:drop-shadow(0 0 3px rgba(255,200,0,.5)); }   50%{ filter:drop-shadow(0 0 8px rgba(255,220,50,.9)); } }
  @keyframes badge-plat     { 0%,100%{ filter:drop-shadow(0 0 4px rgba(180,230,255,.5)); } 50%{ filter:drop-shadow(0 0 10px rgba(200,240,255,1)); } }
  @keyframes badge-diamond  { 0%,100%{ filter:drop-shadow(0 0 5px rgba(150,240,255,.6)) brightness(1); } 50%{ filter:drop-shadow(0 0 14px rgba(180,255,255,1)) brightness(1.15); } }
  @keyframes badge-galaxy   { 0%{ filter:drop-shadow(0 0 6px rgba(130,80,255,.7)) hue-rotate(0deg); } 50%{ filter:drop-shadow(0 0 14px rgba(200,100,255,1)) hue-rotate(30deg); } 100%{ filter:drop-shadow(0 0 6px rgba(130,80,255,.7)) hue-rotate(0deg); } }
  @keyframes badge-obsidian { 0%,100%{ filter:drop-shadow(0 0 6px rgba(180,0,255,.6)); } 33%{ filter:drop-shadow(0 0 14px rgba(255,50,100,.9)); } 66%{ filter:drop-shadow(0 0 12px rgba(180,0,255,1)); } }
  @keyframes badge-void     { 0%{ filter:drop-shadow(0 0 8px rgba(0,200,255,.5)) hue-rotate(0deg) brightness(1); } 25%{ filter:drop-shadow(0 0 18px rgba(100,0,255,.9)) hue-rotate(-20deg) brightness(1.2); } 50%{ filter:drop-shadow(0 0 12px rgba(0,255,180,.7)) hue-rotate(15deg) brightness(1.1); } 75%{ filter:drop-shadow(0 0 20px rgba(255,0,150,1)) hue-rotate(-10deg) brightness(1.25); } 100%{ filter:drop-shadow(0 0 8px rgba(0,200,255,.5)) hue-rotate(0deg) brightness(1); } }
  .badge-anim-bronze   { animation: badge-bronze   3s   ease-in-out infinite; }
  .badge-anim-silver   { animation: badge-silver   2.5s ease-in-out infinite; }
  .badge-anim-gold     { animation: badge-gold     2.2s ease-in-out infinite; }
  .badge-anim-platinum { animation: badge-plat     2s   ease-in-out infinite; }
  .badge-anim-diamond  { animation: badge-diamond  1.8s ease-in-out infinite; }
  .badge-anim-galaxy   { animation: badge-galaxy   3s   ease-in-out infinite; }
  .badge-anim-obsidian { animation: badge-obsidian 2s   ease-in-out infinite; }
  .badge-anim-void     { animation: badge-void     2.5s ease-in-out infinite; }
`;

// ─── Crown components ─────────────────────────────────────────────────────────
function CrownSingle({ color }) {
  return (
    <>
      <polygon points="4,4 7,1 10,4" fill={`${color}80`} stroke={color} strokeWidth="0.6" />
      <line x1="7" y1="1" x2="7" y2="4.2" stroke={color} strokeWidth="0.7" />
    </>
  );
}

function CrownDouble({ color }) {
  return (
    <>
      <polygon points="4,4 7,1 10,4" fill={`${color}80`} stroke={color} strokeWidth="0.65" />
      <line x1="5.5" y1="2.5" x2="5.5" y2="4.2" stroke={color} strokeWidth="0.7" />
      <line x1="8.5" y1="2.5" x2="8.5" y2="4.2" stroke={color} strokeWidth="0.7" />
    </>
  );
}

function CrownRoyal({ color }) {
  return (
    <>
      <path d="M2 4.5 L4 2.5 L7 4 L10 2.5 L12 4.5" fill="none" stroke={color} strokeWidth="0.9" strokeLinejoin="round" />
      <circle cx="4"  cy="2.5" r="0.85" fill={color} />
      <circle cx="7"  cy="1.5" r="0.95" fill={color} />
      <circle cx="10" cy="2.5" r="0.85" fill={color} />
    </>
  );
}

// ─── Decorative elements per tier ────────────────────────────────────────────
function Decor({ type, color }) {
  if (!type) return null;

  if (type === 'laurel') return (
    <>
      <path d="M2.2 7 Q0.4 10.2 2.6 13.2" fill="none" stroke={color} strokeWidth="0.4" opacity="0.6" />
      <path d="M11.8 7 Q13.6 10.2 11.4 13.2" fill="none" stroke={color} strokeWidth="0.4" opacity="0.6" />
      {[8, 10.2, 12.2].map(y => (
        <g key={y}>
          <circle cx="2"  cy={y} r="0.4" fill={color} opacity="0.5" />
          <circle cx="12" cy={y} r="0.4" fill={color} opacity="0.5" />
        </g>
      ))}
    </>
  );

  if (type === 'diamonds') return (
    <>
      <circle cx="4"  cy="6.5"  r="0.5"  fill={color} opacity="0.5" />
      <circle cx="10" cy="8"    r="0.4"  fill={color} opacity="0.5" />
      <circle cx="3"  cy="11"   r="0.35" fill={color} opacity="0.45" />
      <circle cx="11" cy="11.5" r="0.35" fill={color} opacity="0.45" />
      <polygon points="7,13.8 7.3,13.1 7,12.8 6.7,13.1" fill={color} opacity="0.6" />
    </>
  );

  if (type === 'facets') return (
    <>
      <line x1="3"  y1="6"    x2="7" y2="10.5" stroke="white" strokeWidth="0.3"  opacity="0.3" />
      <line x1="11" y1="6"    x2="7" y2="10.5" stroke="white" strokeWidth="0.3"  opacity="0.3" />
      <line x1="7"  y1="5"    x2="7" y2="14.5" stroke="white" strokeWidth="0.25" opacity="0.18" />
      <circle cx="4.2" cy="6.8"  r="0.5"  fill="white" opacity="0.7" />
      <circle cx="9.8" cy="7.5"  r="0.35" fill="white" opacity="0.55" />
      <circle cx="7"   cy="13.8" r="0.4"  fill="white" opacity="0.5" />
    </>
  );

  if (type === 'galaxy') return (
    <>
      <circle cx="3"    cy="7"    r="0.5"  fill="white"   opacity="0.7" />
      <circle cx="11"   cy="8"    r="0.4"  fill="white"   opacity="0.6" />
      <circle cx="4.5"  cy="12"   r="0.35" fill="#ff80ff" opacity="0.6" />
      <circle cx="10"   cy="11"   r="0.3"  fill="#80ffff" opacity="0.55" />
      <circle cx="2.5"  cy="10"   r="0.3"  fill="#ffff80" opacity="0.5" />
      <circle cx="11.5" cy="13"   r="0.4"  fill="white"   opacity="0.5" />
      <circle cx="5"    cy="7.5"  r="0.25" fill="#c0a0ff" opacity="0.6" />
      <circle cx="9"    cy="13.5" r="0.3"  fill="#ff80a0" opacity="0.55" />
      <path d="M3.5 9 Q7 8 10.5 10" fill="none" stroke="rgba(200,150,255,0.35)" strokeWidth="0.5" />
    </>
  );

  if (type === 'obsidian') return (
    <>
      <path d="M3 13.5 Q1.5 10.5 3.5 8"   fill="none" stroke="#ff3060" strokeWidth="0.6" opacity="0.6" />
      <path d="M11 13.5 Q12.5 10.5 10.5 8" fill="none" stroke="#ff3060" strokeWidth="0.6" opacity="0.6" />
      <circle cx="3.5"  cy="8"    r="0.5" fill="#ff3060" opacity="0.7" />
      <circle cx="10.5" cy="8"    r="0.5" fill="#ff3060" opacity="0.7" />
      <circle cx="7"    cy="14.8" r="0.4" fill="#ff3060" opacity="0.6" />
      <polygon
        points="7,6 7.5,7.5 9,7.5 7.8,8.3 8.2,9.8 7,9 5.8,9.8 6.2,8.3 5,7.5 6.5,7.5"
        fill="#ff3060" opacity="0.5" stroke="#ff6090" strokeWidth="0.2"
      />
    </>
  );

  if (type === 'void') return (
    <>
      <path d="M3 9 Q7 6.5 11 9"    fill="none" stroke="#00ffcc" strokeWidth="0.4"  opacity="0.4" />
      <path d="M3 11 Q7 13.5 11 11" fill="none" stroke="#6040ff" strokeWidth="0.35" opacity="0.4" />
      <circle cx="3"    cy="7.5"  r="0.5"  fill="#00ffcc" opacity="0.7" />
      <circle cx="11"   cy="7.5"  r="0.5"  fill="#ff00aa" opacity="0.7" />
      <circle cx="7"    cy="5"    r="0.5"  fill="#4080ff" opacity="0.65" />
      <circle cx="3.5"  cy="12.5" r="0.35" fill="#ff80ff" opacity="0.55" />
      <circle cx="10.5" cy="12.5" r="0.35" fill="#80ffaa" opacity="0.55" />
      <polygon
        points="7,13.5 7.5,12 9,12 7.8,13 8.2,14.5 7,13.8 5.8,14.5 6.2,13 5,12 6.5,12"
        fill="#00ffcc" opacity="0.45" stroke="#40ffee" strokeWidth="0.2"
      />
    </>
  );

  return null;
}

// ─── Gradient defs helper ─────────────────────────────────────────────────────
function GradDef({ tier, id }) {
  if (!tier.grad) return null;
  const stops = tier.grad.stops;
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        {stops.map((c, i) => (
          <stop key={i} offset={`${Math.round((i / (stops.length - 1)) * 100)}%`} stopColor={c} />
        ))}
      </linearGradient>
    </defs>
  );
}

// ─── Shield body (shared between BadgeShield and MiniBadge) ───────────────────
function ShieldBody({ tier, gradId, unlocked, bStroke, innerS }) {
  return (
    <>
      {unlocked && (
        <path
          d="M0.5 4.5 L0.5 10.2 Q0.5 15.5 7 17 Q13.5 15.5 13.5 10.2 L13.5 4.5 L7 2.8 Z"
          fill="none" stroke={bStroke} strokeWidth="3.5" opacity="0.25"
        />
      )}
      <path
        d="M1 4.5 L1 10 Q1 15 7 16.5 Q13 15 13 10 L13 4.5 L7 3 Z"
        fill={tier.grad && unlocked ? `url(#${gradId})` : (unlocked ? tier.bodyFill : '#111111')}
        stroke={bStroke}
        strokeWidth={unlocked ? 1.2 : 0.7}
        strokeOpacity={unlocked ? 1 : 0.3}
      />
      <path
        d="M2.5 5.5 L2.5 10 Q2.5 13.5 7 14.8 Q11.5 13.5 11.5 10 L11.5 5.5 L7 4.2 Z"
        fill="none" stroke={innerS} strokeWidth="0.5" opacity={unlocked ? 0.6 : 0.15}
      />
    </>
  );
}

// ─── BadgeShield ───────────────────────────────────────────────────────────────
export function BadgeShield({ label, unlocked, categoryId, target, size: sizeProp }) {
  const tierId   = getTierForTarget(categoryId, target);
  const tier     = TIER_DEFS[tierId];

  const bStroke  = unlocked ? tier.bodyStroke  : '#3a3a3a';
  const cc       = unlocked ? tier.crownColor   : '#3a3a3a';
  const innerS   = unlocked ? tier.innerStroke  : '#222222';
  const tf       = unlocked ? tier.textFill     : '#444444';

  const displaySize = sizeProp || (unlocked ? tier.size : Math.round(tier.size * 0.9));
  const h           = (displaySize * 1.22).toFixed(1);
  const nl          = label || '';
  const nlFs        = nl.length > 4 ? 2.5 : nl.length > 3 ? 2.9 : nl.length > 2 ? 3.3 : 3.7;
  const gradId      = `grad-${tierId}-${target}-${categoryId}`;

  const categoryDesc = categoryId && CATEGORY_DESCRIPTIONS[categoryId];
  const titleParts = [categoryDesc, tier.label].filter(Boolean);
  if (nl) titleParts.push(nl);
  if (!unlocked) titleParts.push('(Locked)');
  const title = titleParts.join(' · ');

  return (
    <span
      title={title}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'default' }}
    >
      <svg
        width={displaySize} height={h} viewBox="0 0 14 17"
        style={{ display: 'block', flexShrink: 0, opacity: unlocked ? 1 : 0.28 }}
        aria-hidden="true"
        className={unlocked ? tier.animClass : ''}
      >
        {tier.grad && unlocked && <GradDef tier={tier} id={gradId} />}
        <ShieldBody tier={tier} gradId={gradId} unlocked={unlocked} bStroke={bStroke} innerS={innerS} />

        {unlocked && <Decor type={tier.decor} color={bStroke} />}
        {unlocked && tier.crownType === 'single' && <CrownSingle color={cc} />}
        {unlocked && tier.crownType === 'double' && <CrownDouble color={cc} />}
        {unlocked && tier.crownType === 'royal'  && <CrownRoyal  color={cc} />}
        {unlocked && tier.stars && (
          <>
            <polygon points="2.2,3.8 2.6,2.8 3.3,3.4 2.8,4 2,3.8"     fill={cc} opacity="0.75" />
            <polygon points="11.8,3.8 11.4,2.8 10.7,3.4 11.2,4 12,3.8" fill={cc} opacity="0.75" />
          </>
        )}

        {nl && (
          <text
            x="7" y="11.4" textAnchor="middle"
            fontFamily="Cinzel, serif" fontSize={nlFs} fontWeight="700"
            fill={unlocked ? tf : '#3a3a3a'} letterSpacing="0.1"
          >
            {nl}
          </text>
        )}
      </svg>

      <span style={{
        fontSize: 7, fontFamily: 'var(--font-heading, Cinzel, serif)', fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: unlocked ? tier.nameColor : '#3f3f46',
        opacity: unlocked ? 0.85 : 0.3,
        whiteSpace: 'nowrap', marginTop: 1,
      }}>
        {tier.label}
      </span>
    </span>
  );
}

// ─── Mini badge for category header ──────────────────────────────────────────
function MiniBadge({ tierId, catColor }) {
  const tier = TIER_DEFS[tierId];
  if (!tier) return null;
  const isHigh = ['galaxy', 'obsidian', 'void'].includes(tierId);
  const isMid  = ['diamond', 'platinum'].includes(tierId);
  const useOwn = isHigh || isMid;
  const stroke = useOwn ? tier.bodyStroke : catColor;
  const cc     = useOwn ? tier.crownColor : catColor;
  const innerS = useOwn ? tier.innerStroke : catColor + '88';
  const gradId = `mini-${tierId}`;

  return (
    <svg width="20" height="24" viewBox="0 0 14 17"
      className={tier.animClass}
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      {tier.grad && <GradDef tier={tier} id={gradId} />}
      <ShieldBody tier={tier} gradId={gradId} unlocked={true} bStroke={stroke} innerS={innerS} />
      {tier.crownType === 'single' && <CrownSingle color={cc} />}
      {tier.crownType === 'double' && <CrownDouble color={cc} />}
      {tier.crownType === 'royal'  && <CrownRoyal  color={cc} />}
    </svg>
  );
}

// ─── Legend badge (tier strip) ────────────────────────────────────────────────
function LegendBadge({ tierId }) {
  const tier   = TIER_DEFS[tierId];
  const gradId = `legend-${tierId}`;
  const w      = Math.round(tier.size * 0.75);
  const h      = Math.round(tier.size * 1.22 * 0.75);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <svg width={w} height={h} viewBox="0 0 14 17" className={tier.animClass} aria-label={tier.label}>
        {tier.grad && <GradDef tier={tier} id={gradId} />}
        <ShieldBody tier={tier} gradId={gradId} unlocked={true} bStroke={tier.bodyStroke} innerS={tier.innerStroke} />
        <Decor type={tier.decor} color={tier.bodyStroke} />
        {tier.crownType === 'single' && <CrownSingle color={tier.crownColor} />}
        {tier.crownType === 'double' && <CrownDouble color={tier.crownColor} />}
        {tier.crownType === 'royal'  && <CrownRoyal  color={tier.crownColor} />}
        {tier.stars && (
          <>
            <polygon points="2.2,3.8 2.6,2.8 3.3,3.4 2.8,4 2,3.8"     fill={tier.crownColor} opacity="0.75" />
            <polygon points="11.8,3.8 11.4,2.8 10.7,3.4 11.2,4 12,3.8" fill={tier.crownColor} opacity="0.75" />
          </>
        )}
      </svg>
      <span style={{
        fontSize: 7, fontFamily: 'Cinzel, serif', fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: tier.nameColor, opacity: 0.8,
      }}>
        {tier.label}
      </span>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────
export default function RankingBadges() {
  const [data, setData]           = useState(() => readSessionJson(BADGES_CACHE_KEY));
  const [loading, setLoading]     = useState(() => readSessionJson(BADGES_CACHE_KEY) == null);
  const [openCategories, setOpen] = useState({});

  const loadBadges = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/achievements/me');
      if (res?.data) {
        setData(res.data);
        writeSessionJson(BADGES_CACHE_KEY, res.data);
      }
    } catch (e) {
      if (!silent) toast.error(e.response?.data?.detail || 'Failed to load badges');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const c = readSessionJson(BADGES_CACHE_KEY);
    loadBadges(c != null);
  }, [loadBadges]);

  useEffect(() => {
    const id = setInterval(() => loadBadges(true), 60_000);
    return () => clearInterval(id);
  }, [loadBadges]);

  const toggle = id => setOpen(prev => ({ ...prev, [id]: !prev[id] }));

  if (loading && !data) return (
    <div className={`space-y-8 ${styles.pageContent} mobile-page-root`} data-testid="ranking-badges-page">
      <div className="flex flex-col items-center justify-center min-h-[30vh] gap-2">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-mutedForeground text-xs font-heading uppercase tracking-wider">Loading badges...</span>
      </div>
    </div>
  );

  const categories      = data?.categories     ?? [];
  const totalUnlocked   = data?.total_unlocked ?? 0;
  const totalTiers      = data?.total_tiers    ?? 0;
  const bonusByCategory = (data?.bonuses ?? []).reduce((acc, b) => { acc[b.id] = b; return acc; }, {});

  return (
    <div className={`space-y-6 ${styles.pageContent} mobile-page-root`} data-testid="ranking-badges-page">
      <style>{BADGE_STYLES}</style>
      <AutoRefreshNote seconds={60} />

      {/* Tier legend */}
      <div className={`${styles.panel} rounded-md p-4 border border-primary/20 mobile-panel`}>
        <div className="flex items-center gap-2 mb-3">
          <Award size={16} className="text-primary" />
          <span className="font-heading text-sm font-bold text-foreground tracking-wider uppercase">
            {totalUnlocked} / {totalTiers} unlocked
          </span>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {TIER_ORDER.map(tid => <LegendBadge key={tid} tierId={tid} />)}
        </div>
      </div>

      {/* Category accordions */}
      <div className="space-y-2">
        {categories.map(cat => {
          const isOpen   = openCategories[cat.id] !== false;
          const catMeta  = CATEGORY_COLORS[cat.id] || CATEGORY_COLORS.crimes;
          const catColor = catMeta.color;
          const bonus    = bonusByCategory[cat.id];

          const lastUnlockedTierId = [...(cat.tiers || [])]
            .filter(t => t.unlocked)
            .map(t => getTierForTarget(cat.id, t.target))
            .pop();

          return (
            <div key={cat.id} className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
              <button
                type="button"
                onClick={() => toggle(cat.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 transition-smooth"
              >
                {isOpen
                  ? <ChevronDown  size={14} style={{ color: catColor, flexShrink: 0 }} />
                  : <ChevronRight size={14} style={{ color: catColor, flexShrink: 0 }} />
                }
                <div className="flex flex-col min-w-0">
                  <span className="font-heading font-bold uppercase tracking-wider text-sm" style={{ color: catColor }}>
                    {cat.name}
                  </span>
                  {CATEGORY_DESCRIPTIONS[cat.id] && (
                    <span className="text-[10px] text-mutedForeground font-heading">
                      {CATEGORY_DESCRIPTIONS[cat.id]}
                    </span>
                  )}
                  {bonus && (
                    <span className="text-[10px] text-mutedForeground font-heading">
                      +{bonus.bonus_pct}% {bonus.benefit}
                    </span>
                  )}
                </div>
                <span className="text-mutedForeground text-xs shrink-0 font-heading">
                  {cat.unlocked_count}/{cat.total_tiers}
                </span>
                <div className="flex-1 min-w-0 ml-1">
                  <div className="h-1.5 bg-zinc-700/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${cat.total_tiers ? (100 * cat.unlocked_count) / cat.total_tiers : 0}%`,
                        background: `linear-gradient(90deg, ${catColor}88, ${catColor}cc)`,
                      }}
                    />
                  </div>
                </div>
                {lastUnlockedTierId && (
                  <div className="shrink-0 ml-2">
                    <MiniBadge tierId={lastUnlockedTierId} catColor={catColor} />
                  </div>
                )}
              </button>

              {isOpen && (
                <div className="px-4 pb-5 pt-2">
                  {cat.next_target != null && (
                    <div className="mb-4">
                      <div className="flex justify-between text-[10px] text-mutedForeground mb-1.5 font-heading tracking-wider">
                        <span>Progress → {cat.next_target_label}</span>
                        <span>{cat.progress_display}</span>
                        <span>{cat.percent_to_next}%</span>
                      </div>
                      <div className="h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${cat.percent_to_next}%`,
                            background: `linear-gradient(90deg, ${catColor}66, ${catColor}aa)`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 items-end">
                    {(cat.tiers || []).map(tier => (
                      <BadgeShield
                        key={tier.target}
                        label={tier.label}
                        unlocked={tier.unlocked}
                        categoryId={cat.id}
                        target={tier.target}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
