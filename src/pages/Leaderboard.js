import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Target, Flame, Car, Lock, RefreshCw, Medal, Award, Skull, History } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const LB_STYLES = `
  .lb-fade-in { animation: lb-fade-in 0.4s ease-out both; }
  @keyframes lb-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .lb-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const TOP_OPTIONS = [5, 10, 20, 50, 100];

function StatBoard({ title, icon: Icon, entries, valueLabel, topLabel }) {
  const list = entries || [];
  return (
    <section className={`relative ${styles.panel} rounded-lg overflow-hidden shadow-lg shadow-primary/5`}>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-3 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center gap-1.5">
        <Icon className="text-primary shrink-0" size={14} />
        <div>
          <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">{title}</h2>
          <p className="text-[9px] text-zinc-500 font-heading italic leading-tight">{topLabel}</p>
        </div>
      </div>
      <div className="p-2 space-y-1">
        {list.length === 0 ? (
          <p className="text-[10px] text-mutedForeground italic py-3 text-center font-heading">No data yet.</p>
        ) : (
          list.map((entry) => (
            <div
              key={`${title}-${entry.rank}-${entry.username}`}
              className={`flex items-center gap-2 p-1.5 rounded-sm border transition-colors ${
                entry.is_current_user
                  ? 'bg-primary/15 border-primary/40'
                  : `${styles.surfaceMuted} border-primary/10 hover:border-primary/30`
              }`}
              data-testid={`leaderboard-${title.toLowerCase().replace(/\s+/g, '-')}-${entry.rank}`}
            >
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-sm font-heading font-bold text-[10px] shrink-0 ${
                  entry.rank === 1
                    ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                    : entry.rank === 2
                    ? 'bg-gradient-to-b from-zinc-400 to-zinc-600 text-zinc-900'
                    : entry.rank === 3
                    ? 'bg-gradient-to-b from-amber-600 to-amber-800 text-amber-100'
                    : `${styles.surface} text-mutedForeground border border-primary/20`
                }`}
              >
                {entry.rank}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-heading font-medium text-foreground truncate text-xs">
                  <Link
                    to={`/profile/${encodeURIComponent(entry.username)}`}
                    className="hover:text-primary"
                    data-testid={`leaderboard-profile-link-${title}-${entry.username}`}
                  >
                    {entry.username}
                  </Link>
                  {entry.is_current_user && (
                    <span className="ml-1 text-[10px] text-primary font-normal">(You)</span>
                  )}
                </div>
                <div className="text-[10px] text-primary font-heading">
                  {typeof entry.value === 'number' ? entry.value.toLocaleString() : (entry.value ?? '—')} {valueLabel}
                </div>
              </div>
              {entry.rank <= 3 && (
                <span className="shrink-0" aria-hidden>
                  {entry.rank === 1 ? (
                    <Trophy className="text-primary" size={14} />
                  ) : entry.rank === 2 ? (
                    <Medal className="text-zinc-400" size={14} />
                  ) : (
                    <Award className="text-amber-500" size={14} />
                  )}
                </span>
              )}
            </div>
          ))
        )}
      </div>
      <div className="lb-art-line text-primary mx-2" />
    </section>
  );
}

export default function Leaderboard() {
  const [period, setPeriod] = useState('weekly'); // 'weekly' | 'alltime'
  const [boards, setBoards] = useState({ kills: [], crimes: [], gta: [], jail_busts: [] });
  const [loading, setLoading] = useState(true);
  const [topLimit, setTopLimit] = useState(10);
  const [viewMode, setViewMode] = useState('alive'); // 'alive' | 'dead'

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/leaderboards/top', {
        params: { limit: topLimit, dead: viewMode === 'dead', period },
      });
      setBoards(response.data || { kills: [], crimes: [], gta: [], jail_busts: [] });
    } catch (error) {
      toast.error('Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [topLimit, viewMode, period]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
        <Trophy size={22} className="text-primary/40 animate-pulse" />
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
        <span className="text-primary text-[9px] font-heading uppercase tracking-wider">Loading…</span>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="leaderboard-page">
      <style>{LB_STYLES}</style>
      <header className="relative lb-fade-in">
        <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider mb-2">Leaderboard</h1>
        <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
          <span className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">Period:</span>
          <button
            type="button"
            onClick={() => setPeriod('weekly')}
            className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${
              period === 'weekly'
                ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                : `${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20`
            }`}
          >
            <Trophy size={10} /> Weekly
          </button>
          <button
            type="button"
            onClick={() => setPeriod('alltime')}
            className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${
              period === 'alltime'
                ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                : `${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20`
            }`}
          >
            <History size={10} /> All-time
          </button>
        </div>
        <p className="text-[9px] text-zinc-500 font-heading italic mb-2 text-center">
          {period === 'weekly'
            ? (viewMode === 'alive' ? 'This week\'s top players (Mon–Sun UTC)' : 'This week\'s top dead by stats')
            : (viewMode === 'alive' ? 'The most powerful players in the underworld' : 'Top dead accounts by stats')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
          <span className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">View:</span>
          <div className="flex flex-wrap gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode('alive')}
              className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${
                viewMode === 'alive'
                  ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                  : `${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20`
              }`}
            >
              <Trophy size={10} />
              Top {topLimit}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('dead')}
              className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${
                viewMode === 'dead'
                  ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                  : `${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20`
              }`}
            >
              <Skull size={10} />
              Top dead
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">Show:</span>
          <div className="flex flex-wrap gap-0.5">
            {TOP_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTopLimit(n)}
                className={`px-2 py-1 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${
                  topLimit === n
                    ? 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30'
                    : `${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20`
                }`}
              >
                Top {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={fetchLeaderboard}
            className="flex items-center gap-1 text-[10px] text-mutedForeground hover:text-primary border border-primary/20 hover:border-primary/40 rounded-sm px-2 py-1 transition-colors font-heading"
            title="Refresh leaderboards"
          >
            <RefreshCw size={10} />
            Refresh
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Kills' : 'Top Kills'}
          icon={Target}
          entries={boards.kills}
          valueLabel="kills"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''}`}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Crimes' : 'Top Crimes'}
          icon={Flame}
          entries={boards.crimes}
          valueLabel="crimes"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''}`}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · GTA' : 'Top GTA'}
          icon={Car}
          entries={boards.gta}
          valueLabel="GTA"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''}`}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Jail Busts' : 'Top Jail Busts'}
          icon={Lock}
          entries={boards.jail_busts}
          valueLabel="busts"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''}`}
        />
      </div>

      {/* Weekly Rewards (alive only) */}
      {viewMode === 'alive' && (
      <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-1.5 bg-primary/8 border-b border-primary/20">
          <div className="flex items-center gap-1.5">
            <Trophy size={14} className="text-primary" />
            <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Weekly Rewards</h2>
          </div>
          <p className="text-[9px] text-zinc-500 font-heading italic mt-0.5 leading-tight">
            Top 10 each week receive cash, points, and rare vehicles.
          </p>
        </div>
        <div className="p-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="bg-gradient-to-b from-primary/20 to-primary/5 border border-primary/40 rounded-sm p-2">
              <div className="flex items-center gap-1.5 text-primary font-heading font-bold uppercase tracking-wider text-[10px] mb-0.5">
                <Trophy size={12} />
                1st Place
              </div>
              <div className="text-[10px] text-mutedForeground font-heading leading-tight">
                $500,000 + 1,000 Points + Premium Car
              </div>
            </div>
            <div className="bg-gradient-to-b from-zinc-600/20 to-zinc-800/20 border border-zinc-500/30 rounded-sm p-2">
              <div className="flex items-center gap-1.5 text-zinc-400 font-heading font-bold uppercase tracking-wider text-[10px] mb-0.5">
                <Medal size={12} />
                2nd Place
              </div>
              <div className="text-[10px] text-mutedForeground font-heading leading-tight">
                $300,000 + 500 Points + Luxury Car
              </div>
            </div>
            <div className="bg-gradient-to-b from-amber-700/20 to-amber-900/20 border border-amber-600/30 rounded-sm p-2">
              <div className="flex items-center gap-1.5 text-amber-500 font-heading font-bold uppercase tracking-wider text-[10px] mb-0.5">
                <Award size={12} />
                3rd Place
              </div>
              <div className="text-[10px] text-mutedForeground font-heading leading-tight">
                $150,000 + 250 Points + Classic Car
              </div>
            </div>
          </div>
        </div>
        <div className="lb-art-line text-primary mx-2" />
      </section>
      )}
    </div>
  );
}
