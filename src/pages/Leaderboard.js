import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Target, Flame, Car, Lock, RefreshCw, Medal, Award, Skull } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const TOP_OPTIONS = [5, 10, 20, 50, 100];

function StatBoard({ title, icon: Icon, entries, valueLabel, topLabel }) {
  const list = entries || [];
  return (
    <section className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
      <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center gap-2">
        <Icon className="text-primary shrink-0" size={18} />
        <div>
          <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">{title}</h2>
          <p className="text-xs text-mutedForeground font-heading">{topLabel}</p>
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        {list.length === 0 ? (
          <p className="text-xs text-mutedForeground italic py-6 text-center font-heading">No data yet.</p>
        ) : (
          list.map((entry) => (
            <div
              key={`${title}-${entry.rank}-${entry.username}`}
              className={`flex items-center gap-3 p-2 rounded-sm border transition-colors ${
                entry.is_current_user
                  ? 'bg-primary/15 border-primary/40'
                  : `${styles.surfaceMuted} border-primary/10 hover:border-primary/30`
              }`}
              data-testid={`leaderboard-${title.toLowerCase().replace(/\s+/g, '-')}-${entry.rank}`}
            >
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-sm font-heading font-bold text-sm shrink-0 ${
                  entry.rank === 1
                    ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border border-yellow-600/50'
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
                <div className="font-heading font-medium text-foreground truncate text-sm">
                  <Link
                    to={`/profile/${encodeURIComponent(entry.username)}`}
                    className="hover:text-primary"
                    data-testid={`leaderboard-profile-link-${title}-${entry.username}`}
                  >
                    {entry.username}
                  </Link>
                  {entry.is_current_user && (
                    <span className="ml-1.5 text-xs text-primary font-normal">(You)</span>
                  )}
                </div>
                <div className="text-xs text-primary font-heading">
                  {typeof entry.value === 'number' ? entry.value.toLocaleString() : (entry.value ?? '—')} {valueLabel}
                </div>
              </div>
              {entry.rank <= 3 && (
                <span className="shrink-0" aria-hidden>
                  {entry.rank === 1 ? (
                    <Trophy className="text-primary" size={18} />
                  ) : entry.rank === 2 ? (
                    <Medal className="text-zinc-400" size={18} />
                  ) : (
                    <Award className="text-amber-500" size={18} />
                  )}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function Leaderboard() {
  const [boards, setBoards] = useState({ kills: [], crimes: [], gta: [], jail_busts: [] });
  const [loading, setLoading] = useState(true);
  const [topLimit, setTopLimit] = useState(10);
  const [viewMode, setViewMode] = useState('alive'); // 'alive' | 'dead'

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/leaderboards/top', {
        params: { limit: topLimit, dead: viewMode === 'dead' },
      });
      setBoards(response.data || { kills: [], crimes: [], gta: [], jail_busts: [] });
    } catch (error) {
      toast.error('Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [topLimit, viewMode]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
        <p className="text-mutedForeground text-sm font-medium">Loading leaderboards…</p>
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${styles.pageContent}`} data-testid="leaderboard-page">
      {/* Art Deco Header */}
      <header>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Trophy size={24} className="text-primary/80" />
            Leaderboard
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide mb-4">
          {viewMode === 'alive' ? 'The most powerful players in the underworld' : 'Top dead accounts by stats'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mb-3">
          <span className="text-xs text-mutedForeground font-heading uppercase tracking-wider">View:</span>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setViewMode('alive')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wider transition-colors ${
                viewMode === 'alive'
                  ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border border-yellow-600/50'
                  : `${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20`
              }`}
            >
              <Trophy size={12} />
              Top {topLimit}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('dead')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wider transition-colors ${
                viewMode === 'dead'
                  ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border border-yellow-600/50'
                  : `${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20`
              }`}
            >
              <Skull size={12} />
              Top dead
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-mutedForeground font-heading uppercase tracking-wider">Show:</span>
          <div className="flex flex-wrap gap-1">
            {TOP_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTopLimit(n)}
                className={`px-2.5 py-1.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wider transition-colors ${
                  topLimit === n
                    ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground border border-yellow-600/50'
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
            className="flex items-center gap-1.5 text-xs text-mutedForeground hover:text-primary border border-primary/20 hover:border-primary/40 rounded-sm px-3 py-1.5 transition-colors font-heading"
            title="Refresh leaderboards"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
      <section className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
              <Trophy size={16} /> Weekly Rewards
            </h2>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
          <p className="text-xs text-mutedForeground mt-1 font-heading">
            Top 10 each week receive cash, points, and rare vehicles.
          </p>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-gradient-to-b from-primary/20 to-primary/5 border border-primary/40 rounded-sm p-3">
              <div className="flex items-center gap-2 text-primary font-heading font-bold uppercase tracking-wider mb-1">
                <Trophy size={16} />
                1st Place
              </div>
              <div className="text-xs text-mutedForeground font-heading">
                $500,000 + 1,000 Points + Premium Car
              </div>
            </div>
            <div className="bg-gradient-to-b from-zinc-600/20 to-zinc-800/20 border border-zinc-500/30 rounded-sm p-3">
              <div className="flex items-center gap-2 text-zinc-400 font-heading font-bold uppercase tracking-wider mb-1">
                <Medal size={16} />
                2nd Place
              </div>
              <div className="text-xs text-mutedForeground font-heading">
                $300,000 + 500 Points + Luxury Car
              </div>
            </div>
            <div className="bg-gradient-to-b from-amber-700/20 to-amber-900/20 border border-amber-600/30 rounded-sm p-3">
              <div className="flex items-center gap-2 text-amber-500 font-heading font-bold uppercase tracking-wider mb-1">
                <Award size={16} />
                3rd Place
              </div>
              <div className="text-xs text-mutedForeground font-heading">
                $150,000 + 250 Points + Classic Car
              </div>
            </div>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
