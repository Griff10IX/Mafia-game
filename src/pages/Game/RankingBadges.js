import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Award } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';

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
                <span className="font-heading font-bold text-foreground uppercase tracking-wider">{cat.name}</span>
                <span className="text-mutedForeground text-xs">
                  {cat.unlocked_count}/{cat.total_tiers}
                </span>
                <div className="flex-1 min-w-0 ml-2">
                  <div className="h-1.5 bg-zinc-700/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/70 rounded-full transition-all duration-500"
                      style={{ width: `${cat.total_tiers ? (100 * cat.unlocked_count) / cat.total_tiers : 0}%` }}
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
                          className="h-full bg-primary/60 rounded-full transition-all duration-500"
                          style={{ width: `${cat.percent_to_next}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {cat.tiers.map((tier) => (
                      <div
                        key={tier.target}
                        className={`inline-flex items-center justify-center min-w-[44px] h-9 px-2 rounded font-heading text-[10px] font-bold uppercase border transition-smooth ${
                          tier.unlocked
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                            : 'bg-zinc-700/30 text-zinc-500 border-zinc-600/40'
                        }`}
                        title={tier.unlocked ? `Unlocked: ${tier.label}` : `Locked: ${tier.label}`}
                      >
                        {tier.label}
                      </div>
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
