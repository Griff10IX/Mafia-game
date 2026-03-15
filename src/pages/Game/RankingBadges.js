import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Award } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';

const CATEGORY_COLORS = {
  crimes:         { color: '#d4af37', glow: 'rgba(212,175,55,0.35)' },
  gta:            { color: '#a78bfa', glow: 'rgba(167,139,250,0.35)' },
  jail_busts:     { color: '#60a5fa', glow: 'rgba(96,165,250,0.35)' },
  kills:          { color: '#f87171', glow: 'rgba(248,113,113,0.35)' },
  oc_heists:      { color: '#34d399', glow: 'rgba(52,211,153,0.35)' },
  bullets_melted: { color: '#fb923c', glow: 'rgba(251,146,60,0.35)' },
  booze_runs:     { color: '#2dd4bf', glow: 'rgba(45,212,191,0.35)' },
  hitlist_npc:    { color: '#f472b6', glow: 'rgba(244,114,182,0.35)' },
  rank:           { color: '#d4af37', glow: 'rgba(212,175,55,0.35)' },
};

const LOCKED_COLOR = '#3f3f46';

function BadgeShield({ label, unlocked, categoryId, size = 38 }) {
  const meta = CATEGORY_COLORS[categoryId] || CATEGORY_COLORS.crimes;
  const c = unlocked ? meta.color : LOCKED_COLOR;
  const h = size * 1.22;
  const fontSize = label.length > 3 ? 3.2 : label.length > 2 ? 3.6 : 4.2;

  return (
    <span
      title={unlocked ? `Unlocked: ${label}` : `Locked: ${label}`}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0, cursor: 'default' }}
    >
      <svg
        width={size}
        height={h}
        viewBox="0 0 14 17"
        style={{ flexShrink: 0, display: 'block' }}
        aria-hidden="true"
      >
        {unlocked && (
          <path
            d="M1 4.5 L1 10 Q1 15 7 16.5 Q13 15 13 10 L13 4.5 L7 3 Z"
            fill="none"
            stroke={c}
            strokeWidth="2.5"
            opacity="0.18"
          />
        )}
        <path
          d="M1 4.5 L1 10 Q1 15 7 16.5 Q13 15 13 10 L13 4.5 L7 3 Z"
          fill={unlocked ? `${c}30` : `${c}18`}
          stroke={c}
          strokeWidth="0.9"
        />
        <path
          d="M3 6 L3 10 Q3 13 7 14.2 Q11 13 11 10 L11 6 L7 5 Z"
          fill="none"
          stroke={c}
          strokeWidth="0.5"
          opacity={unlocked ? 0.35 : 0.15}
        />
        {unlocked && (
          <>
            <polygon
              points="4,4 7,1 10,4"
              fill={`${c}80`}
              stroke={c}
              strokeWidth="0.6"
            />
            <line x1="7" y1="1" x2="7" y2="4.2" stroke={c} strokeWidth="0.7" />
          </>
        )}
        <text
          x="7"
          y="11.5"
          textAnchor="middle"
          fontFamily="Cinzel, serif"
          fontSize={fontSize}
          fontWeight="700"
          fill={c}
          letterSpacing="0.2"
          opacity={unlocked ? 1 : 0.5}
        >
          {label}
        </text>
      </svg>
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
                  <div className="flex flex-wrap gap-1.5">
                    {cat.tiers.map((tier) => (
                      <BadgeShield
                        key={tier.target}
                        label={tier.label}
                        unlocked={tier.unlocked}
                        categoryId={cat.id}
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
