import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Target, Sword, Dice5, Trophy, DollarSign, TrendingUp, Wine, Bot } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';

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
  mp_poker: 'Poker',
  sports_bet: 'Sports',
};

/** All casino games in display order (for Gambling section to show every casino). */
const ALL_CASINO_GAMES = ['dice', 'roulette', 'blackjack', 'horseracing', 'videopoker', 'slots', 'mdg', 'mp_blackjack', 'mp_poker'];

const LoadingSpinner = () => (
  <div className={`space-y-2 ${styles.pageContent}`}>
    <style>{STATS_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
      <BarChart3 size={20} className="text-primary/40 animate-pulse" />
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[9px] font-heading uppercase tracking-wider">Loading your stats...</span>
    </div>
  </div>
);

const StatCard = ({ title, icon: Icon, rows, delay = 0 }) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 stat-card stat-fade-in`} style={{ animationDelay: `${delay}s` }}>
      <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center gap-1.5">
        {Icon && <Icon size={12} className="text-primary" />}
        <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">{title}</h2>
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

let _cachedStats = null;
let _lastFetchTime = 0;
const REFRESH_INTERVAL = 30_000;

export default function MyStats() {
  const [stats, setStats] = useState(_cachedStats);
  const [loading, setLoading] = useState(!_cachedStats);

  const fetchStats = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    api
      .get('/stats/me')
      .then((res) => {
        if (res?.data) {
          _cachedStats = res.data;
          _lastFetchTime = Date.now();
          setStats(res.data);
        }
      })
      .catch((e) => {
        if (!silent) toast.error(e.response?.data?.detail || 'Failed to load your stats');
      })
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => {
    const stale = Date.now() - _lastFetchTime > REFRESH_INTERVAL;
    if (!_cachedStats) {
      fetchStats(false);
    } else if (stale) {
      fetchStats(true);
    }
    const id = setInterval(() => fetchStats(true), REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStats]);

  if (loading && !stats) return <LoadingSpinner />;
  if (!stats) {
    return (
      <div className={`${styles.pageContent} p-4`}>
        <p className="text-mutedForeground mb-2">Failed to load stats.</p>
        <button
          type="button"
          onClick={() => fetchStats()}
          className="px-2 py-1 rounded text-xs font-heading uppercase tracking-wider border border-primary/40 text-primary hover:bg-primary/10"
        >
          Retry
        </button>
      </div>
    );
  }

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
    { label: 'Profit from Casino', value: formatMoney(casinos.casino_profit), valueColor: casinos.casino_profit > 0 ? 'text-emerald-400' : 'text-foreground' },
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
  const gamblingRows = [
    {
      label: 'Total',
      value: formatMoney(totalProfit),
      valueColor: (totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'),
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
  const sportsRows = [
    { label: 'Total Bets Placed', value: formatNumber(sports.total_bets_placed || totalBets) },
    { label: 'Bets Won', value: formatNumber(sports.total_bets_won), valueColor: (sports.total_bets_won || 0) > 0 ? 'text-emerald-400' : 'text-foreground' },
    { label: 'Bets Lost', value: formatNumber(sports.total_bets_lost), valueColor: (sports.total_bets_lost || 0) > 0 ? 'text-rose-400' : 'text-foreground' },
    { label: 'Win Rate', value: sports.win_pct != null ? `${sports.win_pct}%` : '—', valueColor: (sports.win_pct || 0) >= 50 ? 'text-emerald-400' : 'text-rose-400' },
    { label: 'Profit / Loss', value: formatMoney(sports.profit_loss), valueColor: (sports.profit_loss || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
    { label: 'Avg Return/Bet', value: formatMoney(sportsAvgReturn), valueColor: sportsAvgReturn >= 0 ? 'text-emerald-400' : 'text-rose-400' },
    { label: 'Biggest Win', value: formatMoney(sports.biggest_win || 0), valueColor: (sports.biggest_win || 0) > 0 ? 'text-amber-400' : 'text-foreground' },
    { label: 'Biggest Loss', value: formatMoney(sports.biggest_loss || 0), valueColor: (sports.biggest_loss || 0) > 0 ? 'text-rose-400' : 'text-foreground' },
    { label: 'Current Win Streak', value: formatNumber(sports.current_win_streak || 0), valueColor: (sports.current_win_streak || 0) > 0 ? 'text-cyan-400' : 'text-foreground' },
    { label: 'Best Win Streak', value: formatNumber(sports.best_win_streak || 0), valueColor: (sports.best_win_streak || 0) > 0 ? 'text-amber-400' : 'text-foreground' },
  ];

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4`}>
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
          Lifetime totals: bodyguards bought, casino profit/loss, gambling profit, booze, auto rank, stock market, bank interest, and more.
        </p>

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
