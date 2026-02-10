import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Target, Flame, Car, Lock, RefreshCw, Medal, Award } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

const TOP_OPTIONS = [5, 10, 20, 50, 100];

function StatBoard({ title, icon: Icon, entries, valueLabel, topLabel }) {
  const list = entries || [];
  return (
    <section className="bg-card border border-border rounded-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-secondary/40 border-b border-border flex items-center gap-2">
        <Icon className="text-primary shrink-0" size={20} />
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-mutedForeground">{topLabel}</p>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {list.length === 0 ? (
          <p className="text-sm text-mutedForeground italic py-6 text-center">No data yet.</p>
        ) : (
          list.map((entry) => (
            <div
              key={`${title}-${entry.rank}-${entry.username}`}
              className={`flex items-center gap-3 p-3 rounded-sm border transition-colors ${
                entry.is_current_user
                  ? 'bg-primary/15 border-primary/50'
                  : 'bg-secondary/30 border-border hover:bg-secondary/50'
              }`}
              data-testid={`leaderboard-${title.toLowerCase().replace(/\s+/g, '-')}-${entry.rank}`}
            >
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-sm font-heading font-bold text-lg shrink-0 ${
                  entry.rank === 1
                    ? 'bg-primary text-primaryForeground'
                    : entry.rank === 2
                    ? 'bg-muted text-foreground'
                    : entry.rank === 3
                    ? 'bg-amber-700/80 text-amber-100'
                    : 'bg-secondary text-mutedForeground'
                }`}
              >
                {entry.rank}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-foreground truncate">
                  <Link
                    to={`/profile/${encodeURIComponent(entry.username)}`}
                    className="hover:underline"
                    data-testid={`leaderboard-profile-link-${title}-${entry.username}`}
                  >
                    {entry.username}
                  </Link>
                  {entry.is_current_user && (
                    <span className="ml-1.5 text-xs text-primary font-normal">(You)</span>
                  )}
                </div>
                <div className="text-xs text-mutedForeground font-mono">
                  {typeof entry.value === 'number' ? entry.value.toLocaleString() : (entry.value ?? '—')} {valueLabel}
                </div>
              </div>
              {entry.rank <= 3 && (
                <span className="shrink-0" aria-hidden>
                  {entry.rank === 1 ? (
                    <Trophy className="text-primary" size={20} />
                  ) : entry.rank === 2 ? (
                    <Medal className="text-mutedForeground" size={20} />
                  ) : (
                    <Award className="text-amber-600" size={20} />
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

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/leaderboards/top', { params: { limit: topLimit } });
      setBoards(response.data || { kills: [], crimes: [], gta: [], jail_busts: [] });
    } catch (error) {
      toast.error('Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [topLimit]);

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
    <div className="space-y-6" data-testid="leaderboard-page">
      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-mutedForeground">Rankings</p>
            <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground mt-1 flex items-center gap-2">
              <Trophy size={24} className="text-primary" />
              Leaderboard
            </h1>
            <p className="text-sm text-mutedForeground mt-1">
              The most powerful players. Select how many to show.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-mutedForeground">Show:</span>
            <div className="flex flex-wrap gap-1">
              {TOP_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTopLimit(n)}
                  className={`px-2.5 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                    topLimit === n
                      ? 'bg-primary text-primaryForeground'
                      : 'bg-secondary text-foreground hover:bg-secondary/80 border border-border'
                  }`}
                >
                  Top {n}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={fetchLeaderboard}
              className="flex items-center gap-1.5 text-xs text-mutedForeground hover:text-foreground border border-border hover:border-primary/40 rounded-sm px-3 py-2 transition-colors"
              title="Refresh leaderboards"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatBoard title="Top Kills" icon={Target} entries={boards.kills} valueLabel="kills" topLabel={`Top ${topLimit}`} />
        <StatBoard title="Top Crimes" icon={Flame} entries={boards.crimes} valueLabel="crimes" topLabel={`Top ${topLimit}`} />
        <StatBoard title="Top GTA" icon={Car} entries={boards.gta} valueLabel="GTA" topLabel={`Top ${topLimit}`} />
        <StatBoard title="Top Jail Busts" icon={Lock} entries={boards.jail_busts} valueLabel="busts" topLabel={`Top ${topLimit}`} />
      </div>

      <section className="bg-card border border-border rounded-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-secondary/40 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Trophy size={16} className="text-primary" />
            Weekly rewards
          </h2>
          <p className="text-xs text-mutedForeground mt-0.5">
            Top 10 each week receive cash, points, and rare vehicles.
          </p>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-primary/10 border border-primary/30 rounded-sm p-4">
              <div className="flex items-center gap-2 text-primary font-bold mb-1">
                <Trophy size={18} />
                1st Place
              </div>
              <div className="text-sm text-mutedForeground">
                $500,000 + 1,000 Points + Premium Car
              </div>
            </div>
            <div className="bg-secondary/50 border border-border rounded-sm p-4">
              <div className="flex items-center gap-2 text-foreground font-bold mb-1">
                <Medal size={18} className="text-mutedForeground" />
                2nd Place
              </div>
              <div className="text-sm text-mutedForeground">
                $300,000 + 500 Points + Luxury Car
              </div>
            </div>
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-sm p-4">
              <div className="flex items-center gap-2 text-amber-600 font-bold mb-1">
                <Award size={18} />
                3rd Place
              </div>
              <div className="text-sm text-mutedForeground">
                $150,000 + 250 Points + Classic Car
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
