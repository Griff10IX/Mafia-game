import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Target, Sword, Dice5, Trophy, DollarSign, TrendingUp, Wine, Bot, RotateCcw, Clock } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import styles from '../../styles/noir.module.css';
import { SLOTS_FEATURE_ENABLED } from '../../config/gameFeatures';

const STATS_STYLES = `
  @keyframes stat-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .stat-fade-in { animation: stat-fade-in 0.4s ease-out both; }
  .stat-card { transition: all 0.3s ease; }
  .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .stat-row { transition: all 0.2s ease; }
  .stat-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .stat-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatNumber(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return num.toLocaleString();
}

function formatMoney(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  const sign = num >= 0 ? '' : '-';
  return `${sign}$${Math.abs(num).toLocaleString()}`;
}

function formatDuration(seconds) {
  if (seconds == null || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

const GAME_LABELS = {
  dice: 'Dice',
  roulette: 'Roulette',
  blackjack: 'Blackjack',
  horseracing: 'Horse Racing',
  videopoker: 'Video Poker',
  slots: 'Slots',
  mdg: 'MDG',
  mp_blackjack: 'MP Blackjack',
  mp_poker: 'Poker (legacy)',
  mp_poker_vs_dealer: 'Poker (vs dealer)',
  mp_poker_vs_players: 'Poker (multiplayer)',
  sports_bet: 'Sports',
};

/** All casino games in display order (for Gambling section to show every casino). */
const ALL_CASINO_GAMES = ['dice', 'roulette', 'blackjack', 'horseracing', 'videopoker', ...(SLOTS_FEATURE_ENABLED ? ['slots'] : []), 'mdg', 'mp_blackjack', 'mp_poker_vs_dealer', 'mp_poker_vs_players', 'mp_poker'];

const MY_STATS_CACHE_KEY = 'mafia_stats_me_v1';

function readMyStatsCache() {
  try {
    const raw = sessionStorage.getItem(MY_STATS_CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

function writeMyStatsCache(data) {
  if (data == null || typeof data !== 'object') return;
  try {
    sessionStorage.setItem(MY_STATS_CACHE_KEY, JSON.stringify(data));
  } catch (_) {}
}

/** Safe placeholder so the page can render before the first /stats/me response. */
const EMPTY_MY_STATS = {
  combat: {},
  rank: {},
  rank_period: {},
  bodyguards: {},
  casinos: {},
  gambling: {},
  sports_betting: {},
  booze: {},
  auto_rank: {},
  stock_market: {},
  bank: {},
  points: {},
  prestige: {},
};

const StatCard = ({ title, icon: Icon, rows, delay = 0, headerAction }) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 stat-card stat-fade-in mobile-panel`} style={{ animationDelay: `${delay}s` }}>
      <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1.5">
        {Icon && <Icon size={12} className="text-primary" />}
        <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">{title}</h2>
        {headerAction && <div className="ml-auto">{headerAction}</div>}
      </div>
      {safeRows.length === 0 ? (
        <div className="px-2 py-3 text-[10px] text-mutedForeground font-heading text-center">No data yet</div>
      ) : (
        <div className="divide-y divide-zinc-700/30">
          {safeRows.map((r) => (
            <div key={r.label} className="stat-row flex items-center justify-between px-2 py-1.5 text-[10px] font-heading">
              <span className="text-mutedForeground">{r.label}</span>
              <span className={`font-bold tabular-nums ${r.valueColor || 'text-foreground'}`}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="stat-art-line text-primary mx-2" />
    </div>
  );
};

const REFRESH_INTERVAL = 30_000;

export default function MyStats() {
  const [stats, setStats] = useState(() => readMyStatsCache() ?? EMPTY_MY_STATS);
  const [resetGamblingLoading, setResetGamblingLoading] = useState(false);

  const fetchStats = useCallback((silentError = false) => {
    const cached = readMyStatsCache();
    if (cached) setStats(cached);
    return api
      .get('/stats/me')
      .then((res) => {
        if (res?.data) {
          setStats(res.data);
          writeMyStatsCache(res.data);
        }
      })
      .catch((e) => {
        if (!silentError) toast.error(e.response?.data?.detail || 'Failed to load your stats');
      });
  }, []);

  const resetGamblingDisplay = useCallback(async () => {
    if (
      !window.confirm(
        'Reset your gambling & sports stats display to zero? Your all-time totals stay on record and will still show as "Lifetime".',
      )
    ) {
      return;
    }
    setResetGamblingLoading(true);
    try {
      await api.post('/stats/me/reset-gambling-display');
      toast.success('Gambling stats display reset. Lifetime totals unchanged.');
      await fetchStats(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not reset stats');
    } finally {
      setResetGamblingLoading(false);
    }
  }, [fetchStats]);

  useEffect(() => {
    fetchStats(false);
    const id = setInterval(() => fetchStats(true), REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStats]);

  const combat = stats.combat || {};
  const rank = stats.rank || {};
  const bodyguards = stats.bodyguards || {};
  const casinos = stats.casinos || {};
  const gambling = stats.gambling || {};
  const sports = stats.sports_betting || {};
  const booze = stats.booze || {};
  const autoRank = stats.auto_rank || {};
  const stockMarket = stats.stock_market || {};
  const bank = stats.bank || {};
  const points = stats.points || {};
  const prestige = stats.prestige || {};
  const rankPeriod = stats.rank_period || {};

  const periodCrime = rankPeriod.crimes || {};
  const periodGta = rankPeriod.gta || {};
  const periodJail = rankPeriod.jail || {};
  const recentActivityRows = [
    { label: 'Crimes today', value: formatNumber(periodCrime.count_today) },
    { label: 'Successful crimes today', value: formatNumber(periodCrime.success_today) },
    { label: 'Crimes this week', value: formatNumber(periodCrime.count_week) },
    { label: 'Crime profit today', value: formatMoney(periodCrime.profit_today), valueColor: 'text-emerald-400' },
    { label: 'Crime profit (24h)', value: formatMoney(periodCrime.profit_24h), valueColor: 'text-emerald-400' },
    { label: 'GTAs today', value: formatNumber(periodGta.count_today) },
    { label: 'Successful GTAs today', value: formatNumber(periodGta.success_today) },
    { label: 'GTAs this week', value: formatNumber(periodGta.count_week) },
    { label: 'GTA profit today', value: formatMoney(periodGta.profit_today), valueColor: 'text-emerald-400' },
    { label: 'Jailbusts today', value: formatNumber(periodJail.count_today) },
    { label: 'Jailbusts this week', value: formatNumber(periodJail.count_week) },
  ].filter((r) => r.value !== '—' && r.value !== '0' && r.value !== '$0');

  const kdRatio = combat.total_deaths > 0 ? (combat.total_kills / combat.total_deaths).toFixed(2) : combat.total_kills > 0 ? '∞' : '0.00';
  const combatRows = [
    { label: 'Total Kills', value: formatNumber(combat.total_kills) },
    { label: 'Total Deaths', value: formatNumber(combat.total_deaths) },
    { label: 'K/D Ratio', value: kdRatio, valueColor: parseFloat(kdRatio) >= 1 ? 'text-emerald-400' : 'text-rose-400' },
    { label: 'Player Kills', value: formatNumber(combat.user_kills) },
    { label: 'Hitlist NPC Kills', value: formatNumber(combat.hitlist_npc_kills) },
    { label: 'Robot BG Kills', value: formatNumber(combat.robot_bodyguard_kills) },
    { label: 'Bodyguard Slots', value: formatNumber(bodyguards.slots_purchased) },
    { label: 'Bodyguards Hired', value: formatNumber(bodyguards.total_hired) },
    { label: 'Human BGs Hired', value: formatNumber(bodyguards.human_hired) },
    { label: 'Longest BG Survived', value: formatDuration(bodyguards.longest_surviving_seconds) },
  ];

  const rankRows = [
    { label: 'Rank Points', value: formatNumber(rank.rank_points) },
    { label: 'Prestige Level', value: formatNumber(prestige.level), valueColor: prestige.level > 0 ? 'text-amber-400' : 'text-foreground' },
    { label: 'Crimes Committed', value: formatNumber(rank.total_crimes) },
    { label: 'Crime Profit', value: formatMoney(rank.crime_profit), valueColor: rank.crime_profit > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'GTAs Completed', value: formatNumber(rank.total_gta) },
    { label: 'Jail Busts', value: formatNumber(rank.jail_busts) },
    { label: 'Bust Attempts', value: formatNumber(rank.jail_bust_attempts) },
    { label: 'NPC Busts', value: formatNumber(rank.jail_busts_npc) },
    { label: 'Current Bust Streak', value: formatNumber(rank.current_consecutive_busts), valueColor: rank.current_consecutive_busts > 0 ? 'text-cyan-400' : 'text-foreground' },
    { label: 'Best Bust Streak', value: formatNumber(rank.consecutive_busts_record), valueColor: rank.consecutive_busts_record > 0 ? 'text-amber-400' : 'text-foreground' },
  ];

  const economyRows = [
    { label: 'Lifetime Points Spent', value: formatNumber(points.lifetime_spent) },
    { label: 'Points on BG Hires', value: formatNumber(bodyguards.total_spent_hires) },
    { label: 'Points on BG Upgrades', value: formatNumber(bodyguards.total_spent_upgrades) },
    { label: 'Bank Interest Earned', value: formatMoney(bank.interest_earned), valueColor: bank.interest_earned > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'Stock Trades', value: formatNumber(stockMarket.total_trades) },
    { label: 'Stock Profit/Loss', value: formatNumber(stockMarket.total_profit_points), valueColor: (stockMarket.total_profit_points || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
    { label: 'OC Heists', value: formatNumber(rank.total_oc_heists) },
    { label: 'Bullets Melted', value: formatNumber(rank.bullets_melted) },
    { label: 'Booze Capacity', value: formatNumber(booze.capacity) },
    { label: 'Booze Profits', value: formatMoney(booze.profit_total), valueColor: (booze.profit_total || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
  ];

  const casinoTypeLabel = (t) => (t && { dice: 'Dice', roulette: 'Roulette', blackjack: 'Blackjack', horseracing: 'Horse Racing', videopoker: 'Video Poker', slots: 'Slots' }[t]) || '—';
  const propertyTypeLabel = (t) => (t && { airport: 'Airport', bullet_factory: 'Armoury' }[t]) || '—';
  const casinoRows = [
    { label: 'Casino Owned', value: casinos.owned_casino ? `${casinoTypeLabel(casinos.owned_casino.type)} (${casinos.owned_casino?.location ?? '—'})` : '—', valueColor: casinos.owned_casino ? 'text-emerald-400' : 'text-mutedForeground' },
    { label: 'Property Owned', value: casinos.owned_property ? `${propertyTypeLabel(casinos.owned_property.type)} (${casinos.owned_property?.location ?? '—'})` : '—', valueColor: casinos.owned_property ? 'text-emerald-400' : 'text-mutedForeground' },
    { label: 'Profit from Casino (lifetime)', value: formatMoney(casinos.casino_profit), valueColor: casinos.casino_profit > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'Profit from Property', value: formatNumber(casinos.property_profit), valueColor: casinos.property_profit > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'Casinos Won', value: formatNumber(casinos.casinos_seized), valueColor: casinos.casinos_seized > 0 ? 'text-amber-400' : 'text-foreground' },
    { label: 'Casinos Lost', value: formatNumber(casinos.casinos_lost), valueColor: casinos.casinos_lost > 0 ? 'text-rose-400' : 'text-foreground' },
    { label: 'Properties Won', value: formatNumber(casinos.properties_seized), valueColor: casinos.properties_seized > 0 ? 'text-amber-400' : 'text-foreground' },
    { label: 'Properties Lost', value: formatNumber(casinos.properties_lost), valueColor: casinos.properties_lost > 0 ? 'text-rose-400' : 'text-foreground' },
    { label: 'Total Payouts (as Owner)', value: formatMoney(casinos.total_casino_payouts), valueColor: casinos.total_casino_payouts > 0 ? 'text-rose-400' : 'text-foreground' },
    { label: 'Biggest Payout', value: formatMoney(casinos.biggest_casino_payout), valueColor: casinos.biggest_casino_payout > 0 ? 'text-rose-400' : 'text-foreground' },
  ];

  const boozeAvgProfit = booze.runs_count > 0 ? Math.round(booze.profit_total / booze.runs_count) : 0;
  const boozeSuccessRate = booze.runs_count > 0 ? ((booze.runs_count - booze.jail_count) / booze.runs_count * 100).toFixed(1) : 0;
  const boozeRows = [
    { label: 'Total Profit', value: formatMoney(booze.profit_total), valueColor: (booze.profit_total || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
    { label: 'Runs Completed', value: formatNumber(booze.runs_count) },
    { label: 'Avg Profit/Run', value: formatMoney(boozeAvgProfit), valueColor: boozeAvgProfit >= 0 ? 'text-emerald-400' : 'text-rose-400' },
    { label: 'Success Rate', value: `${boozeSuccessRate}%`, valueColor: parseFloat(boozeSuccessRate) >= 80 ? 'text-emerald-400' : parseFloat(boozeSuccessRate) >= 50 ? 'text-amber-400' : 'text-rose-400' },
    { label: 'Times Jailed', value: formatNumber(booze.jail_count), valueColor: booze.jail_count > 0 ? 'text-rose-400' : 'text-foreground' },
    { label: 'Current Capacity', value: formatNumber(booze.capacity) },
    { label: 'Best Booze Type', value: booze.best_booze_name || '—', valueColor: booze.best_booze_name ? 'text-amber-400' : 'text-mutedForeground' },
    { label: 'Best Booze Profit', value: formatMoney(booze.best_booze_profit || 0), valueColor: (booze.best_booze_profit || 0) > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'Auto Rank Runs', value: formatNumber(autoRank.total_booze_runs) },
    { label: 'Auto Rank Booze Profit', value: formatMoney(autoRank.total_booze_profit), valueColor: (autoRank.total_booze_profit || 0) > 0 ? 'text-emerald-400' : 'text-foreground' },
  ];

  const autoRankRows = [
    { label: 'Busts', value: formatNumber(autoRank.total_busts) },
    { label: 'Crimes', value: formatNumber(autoRank.total_crimes) },
    { label: 'GTAs', value: formatNumber(autoRank.total_gtas) },
    { label: 'Cash Made', value: formatMoney(autoRank.total_cash), valueColor: (autoRank.total_cash || 0) > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'Booze Runs', value: formatNumber(autoRank.total_booze_runs) },
    { label: 'Booze Profit', value: formatMoney(autoRank.total_booze_profit), valueColor: (autoRank.total_booze_profit || 0) > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'Cars Melted', value: formatNumber(autoRank.total_cars_melted) },
    { label: 'Bullets from Melt', value: formatNumber(autoRank.total_bullets_from_melt), valueColor: (autoRank.total_bullets_from_melt || 0) > 0 ? 'text-amber-400' : 'text-foreground' },
    { label: 'Cars Scrapped', value: formatNumber(autoRank.total_cars_scrapped) },
    { label: 'Cash from Scrap', value: formatMoney(autoRank.total_cash_from_scrap), valueColor: (autoRank.total_cash_from_scrap || 0) > 0 ? 'text-emerald-400' : 'text-foreground' },
  ];

  const gamblingByGame = gambling.by_game || {};
  const totalProfit = gambling.total_profit ?? 0;
  const lifetimeGamblingProfit = gambling.lifetime_total_profit;
  const gamblingHadReset = Boolean(gambling.display_reset_at);
  const gamblingRows = [
    ...(gamblingHadReset && lifetimeGamblingProfit != null
      ? [
          {
            label: 'Lifetime net (all-time)',
            value: formatMoney(lifetimeGamblingProfit),
            valueColor: lifetimeGamblingProfit >= 0 ? 'text-amber-400' : 'text-rose-400',
          },
        ]
      : []),
    {
      label: gamblingHadReset ? 'Since reset (net)' : 'Total',
      value: formatMoney(totalProfit),
      valueColor: totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400',
    },
    ...ALL_CASINO_GAMES.map((gt) => {
      const profit = gamblingByGame[gt] ?? 0;
      return {
        label: GAME_LABELS[gt] || gt,
        value: formatMoney(profit),
        valueColor: profit >= 0 ? 'text-emerald-400' : 'text-rose-400',
      };
    }),
  ];

  const totalBets = (sports.total_bets_won || 0) + (sports.total_bets_lost || 0);
  const sportsAvgReturn = totalBets > 0 ? Math.round((sports.profit_loss || 0) / totalBets) : 0;
  const sportsHadReset = Boolean(sports.display_since);
  const sportsRows = [
    ...(sportsHadReset && sports.lifetime_profit_loss != null
      ? [
          { label: 'Lifetime P/L (all-time)', value: formatMoney(sports.lifetime_profit_loss), valueColor: (sports.lifetime_profit_loss || 0) >= 0 ? 'text-amber-400' : 'text-rose-400' },
          { label: 'Lifetime bets W / L', value: `${formatNumber(sports.lifetime_total_bets_won)} / ${formatNumber(sports.lifetime_total_bets_lost)}`, valueColor: 'text-mutedForeground' },
          { label: 'Lifetime win rate', value: sports.lifetime_win_pct != null ? `${sports.lifetime_win_pct}%` : '—', valueColor: (sports.lifetime_win_pct || 0) >= 50 ? 'text-emerald-400' : 'text-rose-400' },
        ]
      : []),
    { label: sportsHadReset ? 'Bets placed (since reset)' : 'Total Bets Placed', value: formatNumber(sports.total_bets_placed || totalBets) },
    { label: 'Bets Won', value: formatNumber(sports.total_bets_won), valueColor: (sports.total_bets_won || 0) > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'Bets Lost', value: formatNumber(sports.total_bets_lost), valueColor: (sports.total_bets_lost || 0) > 0 ? 'text-rose-400' : 'text-foreground' },
    { label: 'Win Rate', value: sports.win_pct != null ? `${sports.win_pct}%` : '—', valueColor: (sports.win_pct || 0) >= 50 ? 'text-emerald-400' : 'text-rose-400' },
    { label: sportsHadReset ? 'P/L (since reset)' : 'Profit / Loss', value: formatMoney(sports.profit_loss), valueColor: (sports.profit_loss || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
    { label: 'Avg Return/Bet', value: formatMoney(sportsAvgReturn), valueColor: sportsAvgReturn >= 0 ? 'text-emerald-400' : 'text-rose-400' },
    { label: sportsHadReset ? 'Biggest win (since reset)' : 'Biggest Win', value: formatMoney(sports.biggest_win || 0), valueColor: (sports.biggest_win || 0) > 0 ? 'text-amber-400' : 'text-foreground' },
    { label: sportsHadReset ? 'Biggest loss (since reset)' : 'Biggest Loss', value: formatMoney(sports.biggest_loss || 0), valueColor: (sports.biggest_loss || 0) > 0 ? 'text-rose-400' : 'text-foreground' },
    {
      label: sportsHadReset ? 'Current win streak (all-time)' : 'Current Win Streak',
      value: formatNumber(sports.current_win_streak || 0),
      valueColor: (sports.current_win_streak || 0) > 0 ? 'text-cyan-400' : 'text-foreground',
    },
    {
      label: sportsHadReset ? 'Best win streak (all-time)' : 'Best Win Streak',
      value: formatNumber(sports.best_win_streak || 0),
      valueColor: (sports.best_win_streak || 0) > 0 ? 'text-amber-400' : 'text-foreground',
    },
  ];

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}>
      <style>{STATS_STYLES}</style>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg sm:text-xl font-heading font-bold text-primary flex items-center gap-2">
            <BarChart3 size={22} />
            My Stats
          </h1>
          <Link to="/stats" className="text-[10px] font-heading text-mutedForeground hover:text-primary transition-colors">
            Global Stats →
          </Link>
        </div>
        <p className="text-[10px] sm:text-xs text-mutedForeground font-heading">
          Lifetime totals and recent crime/GTA/jail activity. World buffs and loot perks are on Game Events. Gambling and sports can be reset to a fresh window; all-time nets stay as &quot;Lifetime&quot;.
        </p>
        <AutoRefreshNote seconds={30} />

        {recentActivityRows.length > 0 && (
          <StatCard title="Recent activity" icon={Clock} rows={recentActivityRows} delay={0} />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard title="Combat & Bodyguards" icon={Sword} rows={combatRows} delay={0} />
          <StatCard title="Rank & Activities" icon={Target} rows={rankRows} delay={0.05} />
          <StatCard title="Economy & Points" icon={TrendingUp} rows={economyRows} delay={0.1} />
          <StatCard title="Casino & Property (Owning)" icon={DollarSign} rows={casinoRows} delay={0.15} />
          <StatCard
            title="Gambling (Playing)"
            icon={Dice5}
            rows={gamblingRows.length ? gamblingRows : [{ label: 'Total', value: formatMoney(0), valueColor: 'text-mutedForeground' }]}
            delay={0.2}
            headerAction={
              <button
                type="button"
                onClick={resetGamblingDisplay}
                disabled={resetGamblingLoading}
                className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-heading text-primary hover:bg-primary/15 disabled:opacity-50"
              >
                <RotateCcw size={10} />
                {resetGamblingLoading ? '…' : 'Reset'}
              </button>
            }
          />
          <StatCard
            title="Sports Betting"
            icon={Trophy}
            rows={sportsRows.some((r) => r.value !== '—') ? sportsRows : [{ label: 'No bets yet', value: '—' }]}
            delay={0.25}
          />
          <StatCard title="Booze Run" icon={Wine} rows={boozeRows} delay={0.27} />
          <StatCard title="Auto Rank" icon={Bot} rows={autoRankRows} delay={0.28} />
        </div>
      </div>
    </div>
  );
}
