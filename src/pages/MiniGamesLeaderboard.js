import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Medal, Award, RefreshCw, Gamepad2, Clock, Gift, DollarSign, Heart, Package, Crosshair, Bomb } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const LB_STYLES = `
  .mg-fade-in { animation: mg-fade-in 0.4s ease-out both; }
  @keyframes mg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .mg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .mg-shine { position: relative; overflow: hidden; }
  .mg-shine::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%); animation: mg-shine-move 3s ease-in-out infinite; }
  @keyframes mg-shine-move { 0%, 100% { transform: translateX(-100%); } 50% { transform: translateX(100%); } }
`;

const GAME_ICONS = {
  snake: Package,
  gauntlet: Gamepad2,
  shooting_range: Crosshair,
  minesweeper: Bomb,
};

const GAME_LABELS = {
  snake: 'Snake (Package Run)',
  gauntlet: 'Flappy Gangster',
  shooting_range: 'Shooting Range',
  minesweeper: 'Minefield',
};

function formatTimeUntil(isoDate) {
  if (!isoDate) return '—';
  const now = new Date();
  const target = new Date(isoDate);
  const diff = target - now;
  if (diff <= 0) return 'Now!';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

function RewardBadge({ reward, rank }) {
  if (!reward) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reward.cash > 0 && (
        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-sm bg-green-900/30 text-green-400 text-[8px] font-heading">
          <DollarSign size={8} />${(reward.cash / 1000000).toFixed(1)}M
        </span>
      )}
      {reward.respect > 0 && (
        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-sm bg-pink-900/30 text-pink-400 text-[8px] font-heading">
          <Heart size={8} />{reward.respect}
        </span>
      )}
      {reward.loot_pieces > 0 && (
        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-sm bg-purple-900/30 text-purple-400 text-[8px] font-heading">
          <Gift size={8} />{reward.loot_pieces}
        </span>
      )}
      {reward.bullets > 0 && (
        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-sm bg-amber-900/30 text-amber-400 text-[8px] font-heading">
          <Crosshair size={8} />{reward.bullets}
        </span>
      )}
    </div>
  );
}

export default function MiniGamesLeaderboard() {
  const [data, setData] = useState(null);
  const [myStats, setMyStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [lbRes, statsRes] = await Promise.all([
        api.get('/minigames/leaderboard'),
        api.get('/minigames/my-stats'),
      ]);
      setData(lbRes.data);
      setMyStats(statsRes.data);
    } catch (error) {
      if (!silent) toast.error('Failed to load mini games leaderboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData(data !== null);
  }, [fetchData]);

  useEffect(() => {
    intervalRef.current = setInterval(() => fetchData(true), 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
        <Gamepad2 size={22} className="text-primary/40 animate-pulse" />
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
        <span className="text-primary text-[9px] font-heading uppercase tracking-wider">Loading…</span>
      </div>
    );
  }

  const { top5 = [], my_rank, my_points = 0, my_games_played = 0, next_payout, rewards = {} } = data || {};

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="minigames-leaderboard-page">
      <style>{LB_STYLES}</style>

      {/* Header */}
      <header className="relative mg-fade-in text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Gamepad2 size={18} className="text-primary" />
          <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">
            Mini Games Leaderboard
          </h1>
        </div>
        <p className="text-[9px] text-zinc-500 font-heading italic">
          Play Snake, Flappy Gangster, Shooting Range, and Minefield to earn points. Top 5 rewarded every Sunday!
        </p>
        <button
          type="button"
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className={`absolute top-0 right-0 p-1 rounded-sm transition-colors ${styles.surface} ${styles.raisedHover} border border-primary/20`}
          title="Refresh"
        >
          <RefreshCw size={12} className={`text-primary ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Countdown & My Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mg-fade-in" style={{ animationDelay: '0.1s' }}>
        {/* Next Payout */}
        <section className={`${styles.panel} rounded-lg p-3`}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-primary" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Next Payout</h2>
          </div>
          <div className="text-center">
            <div className="text-xl font-heading font-bold text-foreground">{formatTimeUntil(next_payout)}</div>
            <p className="text-[9px] text-zinc-500 font-heading">Sunday midnight UTC</p>
          </div>
        </section>

        {/* My Stats */}
        <section className={`${styles.panel} rounded-lg p-3`}>
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={14} className="text-primary" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Your Stats</h2>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-heading font-bold text-primary">{my_rank || '—'}</div>
              <p className="text-[8px] text-zinc-500 font-heading uppercase">Rank</p>
            </div>
            <div>
              <div className="text-lg font-heading font-bold text-foreground">{my_points.toLocaleString()}</div>
              <p className="text-[8px] text-zinc-500 font-heading uppercase">Points</p>
            </div>
            <div>
              <div className="text-lg font-heading font-bold text-foreground">{my_games_played}</div>
              <p className="text-[8px] text-zinc-500 font-heading uppercase">Plays</p>
            </div>
          </div>
        </section>
      </div>

      {/* Top 5 Leaderboard */}
      <section className={`${styles.panel} rounded-lg overflow-hidden mg-fade-in`} style={{ animationDelay: '0.2s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
          <Trophy size={14} className="text-primary" />
          <div>
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Top 5 This Week</h2>
            <p className="text-[8px] text-zinc-500 font-heading">Combined points from all mini games</p>
          </div>
        </div>
        <div className="p-2 space-y-1">
          {top5.length === 0 ? (
            <p className="text-[10px] text-mutedForeground italic py-4 text-center font-heading">
              No plays yet this week. Be the first!
            </p>
          ) : (
            top5.map((entry) => (
              <div
                key={entry.user_id}
                className={`flex items-center gap-2 p-2 rounded-sm border transition-colors ${
                  entry.is_current_user
                    ? 'bg-primary/15 border-primary/40 mg-shine'
                    : `${styles.surfaceMuted} border-primary/10 hover:border-primary/30`
                }`}
              >
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-sm font-heading font-bold text-xs shrink-0 ${
                    entry.rank === 1
                      ? 'bg-gradient-to-b from-yellow-400 to-yellow-600 text-yellow-900'
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
                    >
                      {entry.username}
                    </Link>
                    {entry.is_current_user && (
                      <span className="ml-1 text-[9px] text-primary font-normal">(You)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-zinc-500 font-heading">
                    <span className="text-primary font-bold">{entry.total_points.toLocaleString()} pts</span>
                    <span>•</span>
                    <span>{entry.games_played} plays</span>
                  </div>
                  <RewardBadge reward={rewards[entry.rank] || rewards[String(entry.rank)]} rank={entry.rank} />
                </div>
                {entry.rank <= 3 && (
                  <span className="shrink-0">
                    {entry.rank === 1 ? (
                      <Trophy className="text-yellow-500" size={16} />
                    ) : entry.rank === 2 ? (
                      <Medal className="text-zinc-400" size={16} />
                    ) : (
                      <Award className="text-amber-500" size={16} />
                    )}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        <div className="mg-art-line text-primary mx-2 mb-2" />
      </section>

      {/* My Game Breakdown */}
      {myStats && myStats.by_game && Object.keys(myStats.by_game).length > 0 && (
        <section className={`${styles.panel} rounded-lg overflow-hidden mg-fade-in`} style={{ animationDelay: '0.3s' }}>
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
            <Gamepad2 size={14} className="text-primary" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Your Breakdown</h2>
          </div>
          <div className="p-2 space-y-1">
            {Object.entries(myStats.by_game).map(([game, stats]) => {
              const Icon = GAME_ICONS[game] || Gamepad2;
              return (
                <div
                  key={game}
                  className={`flex items-center gap-2 p-2 rounded-sm border ${styles.surfaceMuted} border-primary/10`}
                >
                  <Icon size={14} className="text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-heading font-medium text-foreground text-xs">{GAME_LABELS[game] || game}</div>
                    <div className="flex items-center gap-2 text-[9px] text-zinc-500 font-heading">
                      <span>{stats.plays} plays</span>
                      <span>•</span>
                      <span className="text-primary">{stats.points} pts</span>
                      <span>•</span>
                      <span>Best: {stats.best_score.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Rewards Info */}
      <section className={`${styles.panel} rounded-lg overflow-hidden mg-fade-in`} style={{ animationDelay: '0.4s' }}>
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
          <Gift size={14} className="text-primary" />
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Weekly Rewards</h2>
        </div>
        <div className="p-2">
          <div className="grid grid-cols-5 gap-1">
            {[1, 2, 3, 4, 5].map((rank) => {
              const reward = rewards[rank] || rewards[String(rank)] || {};
              return (
                <div
                  key={rank}
                  className={`text-center p-2 rounded-sm border ${
                    rank === 1
                      ? 'bg-yellow-900/20 border-yellow-600/40'
                      : rank === 2
                      ? 'bg-zinc-700/20 border-zinc-500/40'
                      : rank === 3
                      ? 'bg-amber-900/20 border-amber-600/40'
                      : `${styles.surfaceMuted} border-primary/10`
                  }`}
                >
                  <div className={`text-sm font-heading font-bold ${
                    rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-zinc-400' : rank === 3 ? 'text-amber-500' : 'text-foreground'
                  }`}>
                    #{rank}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {reward.cash > 0 && (
                      <div className="text-[8px] text-green-400 font-heading">${(reward.cash / 1000000).toFixed(1)}M</div>
                    )}
                    {reward.respect > 0 && (
                      <div className="text-[8px] text-pink-400 font-heading">{reward.respect} Respect</div>
                    )}
                    {reward.loot_pieces > 0 && (
                      <div className="text-[8px] text-purple-400 font-heading">{reward.loot_pieces} Loot</div>
                    )}
                    {reward.bullets > 0 && (
                      <div className="text-[8px] text-amber-400 font-heading">{reward.bullets} Bullets</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[8px] text-zinc-500 font-heading italic text-center mt-2">
            Points: 10 base + score/100 (max 50) per play
          </p>
        </div>
      </section>

      {/* Quick Links */}
      <section className={`${styles.panel} rounded-lg p-3 mg-fade-in`} style={{ animationDelay: '0.5s' }}>
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider mb-2">Play Now</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/snake"
            className={`flex items-center gap-1 px-3 py-1.5 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20 hover:border-primary/40`}
          >
            <Package size={12} className="text-primary" />
            Snake
          </Link>
          <Link
            to="/gauntlet"
            className={`flex items-center gap-1 px-3 py-1.5 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20 hover:border-primary/40`}
          >
            <Gamepad2 size={12} className="text-primary" />
            Flappy Gangster
          </Link>
          <Link
            to="/shooting-range"
            className={`flex items-center gap-1 px-3 py-1.5 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20 hover:border-primary/40`}
          >
            <Crosshair size={12} className="text-primary" />
            Shooting Range
          </Link>
          <Link
            to="/minesweeper"
            className={`flex items-center gap-1 px-3 py-1.5 rounded-sm text-[10px] font-heading font-bold uppercase tracking-wider transition-colors ${styles.surface} ${styles.raisedHover} text-foreground border border-primary/20 hover:border-primary/40`}
          >
            <Bomb size={12} className="text-primary" />
            Minefield
          </Link>
        </div>
      </section>
    </div>
  );
}
