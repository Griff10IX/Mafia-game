import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Trophy, Target, Flame, Car, Lock, RefreshCw, Medal, Award, Skull, History, DollarSign, Star, Zap, TrendingUp, Wine } from 'lucide-react';
import api from '../../utils/api';
import {
  LB_BOARD_KEYS,
  boardsCacheLooksValid,
  EMPTY_BOARDS,
  LB_PERIOD_STORAGE_KEY,
  readPersistedPeriod,
  readLbEntry,
  writeLbEntry,
} from '../../utils/leaderboardTopCache';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const LB_STYLES = `
  .lb-fade-in { animation: lb-fade-in 0.4s ease-out both; }
  @keyframes lb-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .lb-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .lb-highlight-pulse { animation: lb-highlight-pulse 1.6s ease-out 2; }
  @keyframes lb-highlight-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); } 40% { box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.45); } }
`;

const TOP_OPTIONS = [5, 10, 20, 50, 100];

function StatBoard({ title, boardKey, icon: Icon, entries, valueLabel, topLabel, fetching }) {
  const list = entries || [];
  return (
    <section
      id={boardKey ? `lb-board-${boardKey}` : undefined}
      className={`relative ${styles.panel} rounded-lg overflow-hidden shadow-lg shadow-primary/5 mobile-panel`}
    >
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
          fetching ? (
            <p className="text-[10px] text-primary/80 italic py-3 text-center font-heading animate-pulse">
              Loading…
            </p>
          ) : (
          <p className="text-[10px] text-mutedForeground italic py-3 text-center font-heading">No data yet.</p>
          )
        ) : (
          list.map((entry) => (
            <div
              key={`${title}-${entry.rank}-${entry.username}`}
              id={boardKey ? `lb-row-${boardKey}-${entry.rank}` : undefined}
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
                  {(() => {
                    const formatted =
                      typeof entry.value === 'number' ? entry.value.toLocaleString() : (entry.value ?? '—');
                    if (valueLabel === '$') {
                      return formatted === '—' ? '—' : `$${formatted}`;
                    }
                    return (
                      <>
                        {formatted} {valueLabel}
                      </>
                    );
                  })()}
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
  const [searchParams] = useSearchParams();
  const [period, setPeriod] = useState(readPersistedPeriod);
  const [topLimit, setTopLimit] = useState(10);
  const [viewMode, setViewMode] = useState('alive');
  const [boards, setBoards] = useState(() => {
    const p = readPersistedPeriod();
    const c = readLbEntry(p, 10, false);
    const b = c?.boards;
    return boardsCacheLooksValid(b) ? b : EMPTY_BOARDS;
  });
  const [refreshing, setRefreshing] = useState(false);
  const [fetchingBoards, setFetchingBoards] = useState(false);
  const [lastRewardWinners, setLastRewardWinners] = useState(
    () => readLbEntry(readPersistedPeriod(), 10, false)?.last_reward_winners ?? null,
  );
  const intervalRef = useRef(null);
  const deepLinkConsumedRef = useRef(false);
  const [pendingHighlight, setPendingHighlight] = useState(null);
  /** Monotonic id so an older in-flight request cannot clear loading or overwrite data after a newer fetch started. */
  const fetchGenRef = useRef(0);
  /** Latest UI selection — compared after each fetch so stale in-flight responses cannot overwrite boards. */
  const lbSelectionRef = useRef({ period: readPersistedPeriod(), topLimit: 10, viewMode: 'alive' });
  lbSelectionRef.current = { period, topLimit, viewMode };

  const setPeriodPersist = useCallback((p) => {
    setPeriod(p);
    try {
      sessionStorage.setItem(LB_PERIOD_STORAGE_KEY, p);
    } catch (_) {}
  }, []);

  useLayoutEffect(() => {
    if (deepLinkConsumedRef.current) return;
    const board = (searchParams.get('board') || '').trim();
    const rankRaw = searchParams.get('rank');
    const deadRaw = (searchParams.get('dead') || '').trim().toLowerCase();
    const deepLinkDead = deadRaw === '1' || deadRaw === 'true' || deadRaw === 'dead';
    const rank = rankRaw != null ? parseInt(String(rankRaw), 10) : NaN;
    if (!board || !LB_BOARD_KEYS.has(board) || !Number.isFinite(rank) || rank < 1) return;
    deepLinkConsumedRef.current = true;
    const needTop = TOP_OPTIONS.find((n) => n >= rank) ?? 100;
    setPeriodPersist('alltime');
    setViewMode(deepLinkDead ? 'dead' : 'alive');
    setTopLimit((prev) => Math.max(prev, needTop));
    setPendingHighlight({ board, rank });
  }, [searchParams, setPeriodPersist]);

  const fetchLeaderboard = useCallback(async (showRefreshSpin = false, silentError = false, background = false) => {
    const dead = viewMode === 'dead';
    const requested = { period, topLimit, dead };
    const gen = ++fetchGenRef.current;
    if (!background) {
      const cached = readLbEntry(period, topLimit, dead);
      if (cached?.boards && boardsCacheLooksValid(cached.boards)) {
        setBoards(cached.boards);
        setLastRewardWinners(cached.last_reward_winners ?? null);
      } else {
        setFetchingBoards(true);
      }
    }
    let timeoutId;
    if (showRefreshSpin) {
      setRefreshing(true);
      timeoutId = setTimeout(() => setRefreshing(false), 15000);
    }
    try {
      const response = await api.get('/leaderboards/top', {
        params: { limit: topLimit, dead, period },
      });
      if (gen !== fetchGenRef.current) return;
      const cur = lbSelectionRef.current;
      const curDead = cur.viewMode === 'dead';
      if (cur.period !== requested.period || cur.topLimit !== requested.topLimit || curDead !== requested.dead) {
        return;
      }
      const d = response.data || {};
      const { last_reward_winners, ...rest } = d;
      const nextBoards = { ...EMPTY_BOARDS };
      for (const k of LB_BOARD_KEYS) {
        if (Array.isArray(rest[k])) nextBoards[k] = rest[k];
      }
      setLastRewardWinners(last_reward_winners ?? null);
      setBoards(nextBoards);
      writeLbEntry(period, topLimit, dead, nextBoards, last_reward_winners ?? null);
    } catch (error) {
      if (!silentError) toast.error('Failed to load leaderboard');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (showRefreshSpin) setRefreshing(false);
      if (!background && gen === fetchGenRef.current) setFetchingBoards(false);
    }
  }, [topLimit, viewMode, period]);

  useEffect(() => {
    fetchLeaderboard(false, false);
  }, [fetchLeaderboard]);

  useEffect(() => {
    intervalRef.current = setInterval(() => fetchLeaderboard(false, true, true), 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchLeaderboard]);

  useEffect(() => {
    const dead = viewMode === 'dead';
    let cancelled = false;
    const prewarmTargets = [];
    const flipDead = readLbEntry(period, topLimit, !dead)?.boards;
    if (!boardsCacheLooksValid(flipDead)) {
      prewarmTargets.push({ limit: topLimit, dead: !dead, period });
    }
    const oppPeriod = period === 'weekly' ? 'alltime' : 'weekly';
    const oppBoards = readLbEntry(oppPeriod, topLimit, dead)?.boards;
    if (!boardsCacheLooksValid(oppBoards)) {
      prewarmTargets.push({ limit: topLimit, dead, period: oppPeriod });
    }
    if (!prewarmTargets.length) return;
    (async () => {
      for (const params of prewarmTargets) {
        if (cancelled) return;
        try {
          const response = await api.get('/leaderboards/top', { params });
          if (cancelled) return;
          const d = response.data || {};
          const { last_reward_winners, ...rest } = d;
          const nextBoards = { ...EMPTY_BOARDS };
          for (const k of LB_BOARD_KEYS) {
            if (Array.isArray(rest[k])) nextBoards[k] = rest[k];
          }
          writeLbEntry(params.period, params.limit, params.dead, nextBoards, last_reward_winners ?? null);
        } catch {
          // Silent prewarm only.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [period, topLimit, viewMode]);

  useEffect(() => {
    if (!pendingHighlight || fetchingBoards) return;
    const { board, rank } = pendingHighlight;
    const timer = window.setTimeout(() => {
      const row = document.getElementById(`lb-row-${board}-${rank}`);
      const section = document.getElementById(`lb-board-${board}`);
      const target = row || section;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (row) row.classList.add('lb-highlight-pulse');
      }
      setPendingHighlight(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [pendingHighlight, fetchingBoards, boards]);

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} data-testid="leaderboard-page">
      <style>{LB_STYLES}</style>
      <header className="relative lb-fade-in">
        <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
          <span className="text-[10px] text-mutedForeground font-heading uppercase tracking-wider">Period:</span>
          <button
            type="button"
            onClick={() => setPeriodPersist('weekly')}
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
            onClick={() => setPeriodPersist('alltime')}
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
        <AutoRefreshNote seconds={60} className="mb-2 text-center" />
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
            onClick={() => fetchLeaderboard(true)}
            disabled={refreshing}
            className="flex items-center gap-1 text-[10px] text-mutedForeground hover:text-primary border border-primary/20 hover:border-primary/40 rounded-sm px-2 py-1 transition-colors font-heading disabled:opacity-50"
            title="Refresh leaderboards"
          >
            <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Updating…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Rank Points' : 'Most Rank Points Earned'}
          boardKey="rank_points"
          icon={Medal}
          entries={boards?.rank_points}
          valueLabel="XP"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''} (lifetime — current RP + banked on prestige)`}
          fetching={fetchingBoards}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Kills' : 'Top Kills'}
          boardKey="kills"
          icon={Target}
          entries={boards?.kills}
          valueLabel="kills"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''}`}
          fetching={fetchingBoards}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Crimes' : 'Top Crimes'}
          boardKey="crimes"
          icon={Flame}
          entries={boards?.crimes}
          valueLabel="crimes"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''}`}
          fetching={fetchingBoards}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · GTA' : 'Top GTA'}
          boardKey="gta"
          icon={Car}
          entries={boards?.gta}
          valueLabel="GTA"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''}`}
          fetching={fetchingBoards}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Jail Busts' : 'Top Jail Busts'}
          boardKey="jail_busts"
          icon={Lock}
          entries={boards?.jail_busts}
          valueLabel="busts"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''}`}
          fetching={fetchingBoards}
        />
        {period === 'alltime' && (
          <StatBoard
            title={viewMode === 'dead' ? 'Top dead · Points Spent' : 'Most Points Spent'}
            boardKey="points_spent"
            icon={DollarSign}
            entries={boards?.points_spent}
            valueLabel="pts"
            topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''} (all-time)`}
            fetching={fetchingBoards}
          />
        )}
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Respect Points' : 'Respect Points Earned'}
          boardKey="respect_points"
          icon={Star}
          entries={boards?.respect_points}
          valueLabel="respect"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''} (${period === 'weekly' ? 'this week' : 'lifetime earned'})`}
          fetching={fetchingBoards}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Bullets Melted' : 'Bullets Melted'}
          boardKey="bullets_melted"
          icon={Zap}
          entries={boards?.bullets_melted}
          valueLabel="bullets"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''} (${period === 'weekly' ? 'this week' : 'all-time'})`}
          fetching={fetchingBoards}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Stock Market Profit' : 'Highest Stock Market Profit'}
          boardKey="stock_market_profit"
          icon={TrendingUp}
          entries={boards?.stock_market_profit}
          valueLabel="pts"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''} (${period === 'weekly' ? 'this week' : 'all-time'})`}
          fetching={fetchingBoards}
        />
        <StatBoard
          title={viewMode === 'dead' ? 'Top dead · Booze Run Profit' : 'Booze Run Profit'}
          boardKey="booze_run_profit"
          icon={Wine}
          entries={boards?.booze_run_profit}
          valueLabel="$"
          topLabel={`Top ${topLimit}${viewMode === 'dead' ? ' dead' : ''} (${period === 'weekly' ? 'this week' : 'all-time'})`}
          fetching={fetchingBoards}
        />
      </div>

      {/* Weekly Rewards (alive only) */}
      {viewMode === 'alive' && (
      <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-1.5 bg-primary/8 border-b border-primary/20">
          <div className="flex items-center gap-1.5">
            <Trophy size={14} className="text-primary" />
            <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Weekly Rewards</h2>
          </div>
          <p className="text-[9px] text-zinc-500 font-heading italic mt-0.5 leading-tight">
            Top 10 each week receive cash, respect points, and bullets (by category).
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
                $15,000,000 + 5,000 Respect Points + 10,000 Bullets
              </div>
            </div>
            <div className="bg-gradient-to-b from-zinc-600/20 to-zinc-800/20 border border-zinc-500/30 rounded-sm p-2">
              <div className="flex items-center gap-1.5 text-zinc-400 font-heading font-bold uppercase tracking-wider text-[10px] mb-0.5">
                <Medal size={12} />
                2nd Place
              </div>
              <div className="text-[10px] text-mutedForeground font-heading leading-tight">
                $9,000,000 + 2,500 Respect Points + 6,000 Bullets
              </div>
            </div>
            <div className="bg-gradient-to-b from-amber-700/20 to-amber-900/20 border border-amber-600/30 rounded-sm p-2">
              <div className="flex items-center gap-1.5 text-amber-500 font-heading font-bold uppercase tracking-wider text-[10px] mb-0.5">
                <Award size={12} />
                3rd Place
              </div>
              <div className="text-[10px] text-mutedForeground font-heading leading-tight">
                $4,500,000 + 1,250 Respect Points + 3,000 Bullets
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-w-lg mx-auto">
            <div className="bg-gradient-to-b from-zinc-700/15 to-zinc-900/20 border border-zinc-600/25 rounded-sm p-2">
              <div className="flex items-center gap-1.5 text-zinc-500 font-heading font-bold uppercase tracking-wider text-[10px] mb-0.5">
                <Award size={12} />
                4th Place
              </div>
              <div className="text-[10px] text-mutedForeground font-heading leading-tight">
                $2,250,000 + 625 Respect Points + 1,500 Bullets
              </div>
            </div>
            <div className="bg-gradient-to-b from-zinc-700/15 to-zinc-900/20 border border-zinc-600/25 rounded-sm p-2">
              <div className="flex items-center gap-1.5 text-zinc-500 font-heading font-bold uppercase tracking-wider text-[10px] mb-0.5">
                <Award size={12} />
                5th Place
              </div>
              <div className="text-[10px] text-mutedForeground font-heading leading-tight">
                $1,125,000 + 312 Respect Points + 750 Bullets
              </div>
            </div>
          </div>
        </div>
        <div className="lb-art-line text-primary mx-2" />
      </section>
      )}

      {lastRewardWinners && (
        <section className="mt-6 rounded-sm border border-primary/30 bg-primary/5 p-4">
          <h2 className="text-primary font-heading font-bold uppercase tracking-wider text-sm mb-3 flex items-center gap-2">
            <Trophy size={16} />
            Last reward winners
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(['kills', 'crimes', 'gta', 'jail_busts']).map((key) => {
              const list = lastRewardWinners[key];
              const label = key === 'kills' ? 'Kills' : key === 'crimes' ? 'Crimes' : key === 'gta' ? 'GTA' : 'Jail busts';
              if (!list?.length) return null;
              return (
                <div key={key} className="rounded border border-primary/20 bg-black/20 p-3">
                  <div className="text-primary/80 font-heading text-xs uppercase tracking-wider mb-2">{label}</div>
                  <ol className="space-y-1 text-sm text-mutedForeground">
                    {list.slice(0, 10).map(({ rank, username }) => (
                      <li key={rank} className="flex justify-between gap-2">
                        <span className="text-mutedForeground">#{rank}</span>
                        <span className="truncate font-medium text-foreground">{username || '—'}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
