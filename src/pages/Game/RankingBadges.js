import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Award } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';

const BADGE_STYLES = `
  @keyframes badge-gold-shimmer {
    0%, 100% { opacity: 0.22; }
    50% { opacity: 0.45; }
  }
  @keyframes badge-diamond-sparkle {
    0%, 100% { opacity: 0.18; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.08); }
  }
  @keyframes badge-obsidian-pulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.6; }
  }
  .badge-gold-shimmer { animation: badge-gold-shimmer 2.5s ease-in-out infinite; }
  .badge-diamond-sparkle { animation: badge-diamond-sparkle 2s ease-in-out infinite; }
  .badge-obsidian-pulse { animation: badge-obsidian-pulse 1.8s ease-in-out infinite; }
`;

const CATEGORY_COLORS = {
  crimes:         { color: '#d4af37', glow: 'rgba(212,175,55,0.35)' },
  gta:            { color: '#a78bfa', glow: 'rgba(167,139,250,0.35)' },
  jail_busts:     { color: '#60a5fa', glow: 'rgba(96,165,250,0.35)' },
  kills:          { color: '#f87171', glow: 'rgba(248,113,113,0.35)' },
  oc_heists:      { color: '#34d399', glow: 'rgba(52,211,153,0.35)' },
  bullets_melted: { color: '#fb923c', glow: 'rgba(251,146,60,0.35)' },
  booze_runs:     { color: '#2dd4bf', glow: 'rgba(45,212,191,0.35)' },
  hitlist_npc:    { color: '#f472b6', glow: 'rgba(244,114,182,0.35)' },
};

const MASTERY_TIERS = {
  gold:     { color: '#ffd700', glow: 'rgba(255,215,0,0.5)', label: 'Gold' },
  diamond:  { color: '#b9f2ff', glow: 'rgba(185,242,255,0.5)', label: 'Diamond' },
  obsidian: { color: '#c084fc', glow: 'rgba(192,132,252,0.6)', label: 'Obsidian', accent: '#ef4444' },
};

const SPECIAL_MILESTONES = {
  crimes:         { 100000: 'gold', 1000000: 'diamond', 15000000: 'obsidian' },
  gta:            { 10000: 'gold', 100000: 'diamond', 1000000: 'obsidian' },
  jail_busts:     { 10000: 'gold', 100000: 'diamond', 1000000: 'obsidian' },
  kills:          { 1000: 'gold', 10000: 'diamond', 100000: 'obsidian' },
  oc_heists:      { 1000: 'gold', 10000: 'diamond', 100000: 'obsidian' },
  bullets_melted: { 100000: 'gold', 1000000: 'diamond', 5000000: 'obsidian' },
  booze_runs:     { 1000: 'gold', 10000: 'diamond', 100000: 'obsidian' },
  hitlist_npc:    { 500: 'gold', 2500: 'diamond', 10000: 'obsidian' },
};

const LOCKED_COLOR = '#3f3f46';

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
      <polygon points="4,4 7,1 10,4" fill={`${color}80`} stroke={color} strokeWidth="0.6" />
      <line x1="5.5" y1="2.5" x2="5.5" y2="4.2" stroke={color} strokeWidth="0.7" />
      <line x1="8.5" y1="2.5" x2="8.5" y2="4.2" stroke={color} strokeWidth="0.7" />
    </>
  );
}

function CrownRoyal({ color }) {
  return (
    <>
      <path d="M2 4.5 L4 2.5 L7 4 L10 2.5 L12 4.5" fill="none" stroke={color} strokeWidth="0.75" strokeLinejoin="round" />
      <circle cx="4" cy="2.5" r="0.85" fill={color} />
      <circle cx="7" cy="1.5" r="0.85" fill={color} />
      <circle cx="10" cy="2.5" r="0.85" fill={color} />
    </>
  );
}

function BadgeShield({ label, unlocked, categoryId, target, size = 38 }) {
  const catMeta = CATEGORY_COLORS[categoryId] || CATEGORY_COLORS.crimes;
  const mastery = (SPECIAL_MILESTONES[categoryId] || {})[target] || null;

  const isMastery = unlocked && mastery;
  const masteryMeta = isMastery ? MASTERY_TIERS[mastery] : null;

  const c = isMastery ? masteryMeta.color : unlocked ? catMeta.color : LOCKED_COLOR;
  const badgeSize = isMastery ? size * 1.15 : size;
  const h = badgeSize * 1.22;
  const fontSize = label.length > 3 ? 3.2 : label.length > 2 ? 3.6 : 4.2;

  const animClass = isMastery
    ? mastery === 'obsidian' ? 'badge-obsidian-pulse'
    : mastery === 'diamond' ? 'badge-diamond-sparkle'
    : 'badge-gold-shimmer'
    : '';

  const lockedMastery = !unlocked && mastery;

  const titleText = isMastery
    ? `${masteryMeta.label} Mastery: ${label}`
    : lockedMastery
    ? `Locked ${MASTERY_TIERS[mastery].label} Mastery: ${label}`
    : unlocked ? `Unlocked: ${label}` : `Locked: ${label}`;

  return (
    <span
      title={titleText}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0, cursor: 'default', position: 'relative' }}
    >
      <svg
        width={badgeSize}
        height={h}
        viewBox="0 0 14 17"
        style={{ flexShrink: 0, display: 'block' }}
        aria-hidden="true"
        className={unlocked ? animClass : ''}
      >
        <defs>
          {isMastery && mastery === 'diamond' && (
            <linearGradient id={`dg-${target}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#b9f2ff" />
              <stop offset="50%" stopColor="#e0f7ff" />
              <stop offset="100%" stopColor="#7dd3fc" />
            </linearGradient>
          )}
          {isMastery && mastery === 'obsidian' && (
            <linearGradient id={`og-${target}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="40%" stopColor="#c084fc" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          )}
        </defs>

        {/* Outer glow */}
        {(unlocked || lockedMastery) && (
          <path
            d="M1 4.5 L1 10 Q1 15 7 16.5 Q13 15 13 10 L13 4.5 L7 3 Z"
            fill="none"
            stroke={isMastery ? masteryMeta.color : lockedMastery ? MASTERY_TIERS[mastery].color : c}
            strokeWidth={isMastery ? '3' : lockedMastery ? '2' : '2.5'}
            opacity={isMastery ? 0.3 : lockedMastery ? 0.08 : 0.18}
          />
        )}

        {/* Shield body */}
        <path
          d="M1 4.5 L1 10 Q1 15 7 16.5 Q13 15 13 10 L13 4.5 L7 3 Z"
          fill={
            isMastery && mastery === 'obsidian' ? `url(#og-${target})`
            : isMastery && mastery === 'diamond' ? `url(#dg-${target})`
            : isMastery ? `${c}40`
            : unlocked ? `${c}30` : `${c}18`
          }
          fillOpacity={isMastery ? 0.3 : 1}
          stroke={isMastery ? masteryMeta.color : lockedMastery ? MASTERY_TIERS[mastery].color : c}
          strokeWidth={isMastery ? '1.2' : '0.9'}
          strokeOpacity={lockedMastery && !unlocked ? 0.25 : 1}
        />

        {/* Inner bevel */}
        <path
          d="M3 6 L3 10 Q3 13 7 14.2 Q11 13 11 10 L11 6 L7 5 Z"
          fill="none"
          stroke={isMastery ? masteryMeta.color : lockedMastery ? MASTERY_TIERS[mastery].color : c}
          strokeWidth={isMastery ? '0.6' : '0.5'}
          opacity={isMastery ? 0.5 : unlocked ? 0.35 : lockedMastery ? 0.12 : 0.15}
        />

        {/* Laurel wreath for gold mastery */}
        {isMastery && mastery === 'gold' && (
          <>
            <path d="M2.2 7 Q0.5 10 2.5 13" fill="none" stroke={c} strokeWidth="0.4" opacity="0.5" />
            <path d="M11.8 7 Q13.5 10 11.5 13" fill="none" stroke={c} strokeWidth="0.4" opacity="0.5" />
            <circle cx="2.5" cy="8" r="0.4" fill={c} opacity="0.4" />
            <circle cx="2" cy="10" r="0.4" fill={c} opacity="0.4" />
            <circle cx="2.3" cy="12" r="0.4" fill={c} opacity="0.4" />
            <circle cx="11.5" cy="8" r="0.4" fill={c} opacity="0.4" />
            <circle cx="12" cy="10" r="0.4" fill={c} opacity="0.4" />
            <circle cx="11.7" cy="12" r="0.4" fill={c} opacity="0.4" />
          </>
        )}

        {/* Diamond facets */}
        {isMastery && mastery === 'diamond' && (
          <>
            <line x1="3" y1="6" x2="7" y2="10" stroke={c} strokeWidth="0.3" opacity="0.3" />
            <line x1="11" y1="6" x2="7" y2="10" stroke={c} strokeWidth="0.3" opacity="0.3" />
            <line x1="7" y1="5" x2="7" y2="14.2" stroke={c} strokeWidth="0.3" opacity="0.2" />
            <circle cx="4" cy="7" r="0.35" fill="#fff" opacity="0.5" />
            <circle cx="10" cy="8" r="0.25" fill="#fff" opacity="0.4" />
            <circle cx="7" cy="13" r="0.3" fill="#fff" opacity="0.35" />
          </>
        )}

        {/* Obsidian fire wisps */}
        {isMastery && mastery === 'obsidian' && (
          <>
            <path d="M3 13 Q2 11 3.5 9" fill="none" stroke="#ef4444" strokeWidth="0.5" opacity="0.45" />
            <path d="M11 13 Q12 11 10.5 9" fill="none" stroke="#ef4444" strokeWidth="0.5" opacity="0.45" />
            <circle cx="3.5" cy="9" r="0.4" fill="#ef4444" opacity="0.5" />
            <circle cx="10.5" cy="9" r="0.4" fill="#ef4444" opacity="0.5" />
            <circle cx="7" cy="14.5" r="0.3" fill="#ef4444" opacity="0.4" />
          </>
        )}

        {/* Crown */}
        {unlocked && isMastery && mastery === 'obsidian' && <CrownRoyal color={masteryMeta.accent || c} />}
        {unlocked && isMastery && mastery === 'diamond' && <CrownDouble color={c} />}
        {unlocked && isMastery && mastery === 'gold' && <CrownDouble color={c} />}
        {unlocked && !isMastery && <CrownSingle color={c} />}

        {/* Stars flanking crown for diamond/obsidian */}
        {isMastery && (mastery === 'diamond' || mastery === 'obsidian') && (
          <>
            <polygon points="2.5,3.5 2.8,2.8 3.3,3.2 2.9,3.7 2.2,3.6" fill={c} opacity="0.6" />
            <polygon points="11.5,3.5 11.2,2.8 10.7,3.2 11.1,3.7 11.8,3.6" fill={c} opacity="0.6" />
          </>
        )}

        {/* Label */}
        <text
          x="7"
          y="11.5"
          textAnchor="middle"
          fontFamily="Cinzel, serif"
          fontSize={fontSize}
          fontWeight="700"
          fill={isMastery ? masteryMeta.color : lockedMastery ? MASTERY_TIERS[mastery].color : c}
          letterSpacing="0.2"
          opacity={isMastery ? 1 : unlocked ? 1 : lockedMastery ? 0.3 : 0.5}
        >
          {label}
        </text>
      </svg>
      {mastery && (
        <span
          style={{
            fontSize: 7,
            fontFamily: 'var(--font-heading, Cinzel, serif)',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: unlocked ? MASTERY_TIERS[mastery].color : LOCKED_COLOR,
            opacity: unlocked ? 0.9 : 0.35,
            textTransform: 'uppercase',
            marginTop: -2,
          }}
        >
          {MASTERY_TIERS[mastery].label}
        </span>
      )}
    </span>
  );
}

export default function RankingBadges() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openCategories, setOpenCategories] = useState({});

  useEffect(() => {
    api
      .get('/achievements/me')
      .then((res) => {
        if (res?.data) setData(res.data);
      })
      .catch((e) => toast.error(e.response?.data?.detail || 'Failed to load badges'))
      .finally(() => setLoading(false));
  }, []);

  const toggleCategory = (id) => {
    setOpenCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading) {
    return (
      <div className={`space-y-8 ${styles.pageContent}`} data-testid="ranking-badges-page">
        <div className="flex flex-col items-center justify-center min-h-[30vh] gap-2">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-mutedForeground text-xs font-heading uppercase tracking-wider">Loading badges...</span>
        </div>
      </div>
    );
  }

  const categories = data?.categories ?? [];
  const totalUnlocked = data?.total_unlocked ?? 0;
  const totalTiers = data?.total_tiers ?? 0;
  const bonusByCategory = (data?.bonuses ?? []).reduce((acc, b) => {
    acc[b.id] = b;
    return acc;
  }, {});

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="ranking-badges-page">
      <style>{BADGE_STYLES}</style>
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Ranking Badges</h1>
        <p className="text-mutedForeground">Tiered milestones from early game to endgame</p>
      </div>

      <div className={`${styles.panel} rounded-md p-4 flex items-center justify-between border border-primary/20`}>
        <div className="flex items-center gap-2">
          <Award size={20} className="text-primary" />
          <span className="font-heading font-bold text-foreground">
            {totalUnlocked}/{totalTiers} badges unlocked
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {categories.map((cat) => {
          const isOpen = openCategories[cat.id] !== false;
          const catColor = (CATEGORY_COLORS[cat.id] || CATEGORY_COLORS.crimes).color;
          return (
            <div key={cat.id} className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
              <button
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-primary/5 transition-smooth"
              >
                {isOpen ? (
                  <ChevronDown size={16} className="text-primary shrink-0" />
                ) : (
                  <ChevronRight size={16} className="text-primary shrink-0" />
                )}
                <div className="flex flex-col min-w-0">
                  <span className="font-heading font-bold uppercase tracking-wider" style={{ color: catColor }}>{cat.name}</span>
                  {bonusByCategory[cat.id] && (
                    <span className="text-[10px] text-mutedForeground font-heading">
                      +{bonusByCategory[cat.id].bonus_pct}% {bonusByCategory[cat.id].benefit}
                    </span>
                  )}
                </div>
                <span className="text-mutedForeground text-xs shrink-0">
                  {cat.unlocked_count}/{cat.total_tiers}
                </span>
                <div className="flex-1 min-w-0 ml-2">
                  <div className="h-1.5 bg-zinc-700/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${cat.total_tiers ? (100 * cat.unlocked_count) / cat.total_tiers : 0}%`, backgroundColor: `${catColor}b3` }}
                    />
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-0">
                  {cat.next_target != null && (
                    <div className="mb-3">
                      <div className="flex justify-between text-[10px] text-mutedForeground mb-1 font-heading">
                        <span>Progress to next: {cat.progress_display} → {cat.next_target_label}</span>
                        <span>{cat.percent_to_next}%</span>
                      </div>
                      <div className="h-1.5 bg-zinc-700/50 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${cat.percent_to_next}%`, backgroundColor: `${catColor}99` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 items-end">
                    {cat.tiers.map((tier) => (
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
