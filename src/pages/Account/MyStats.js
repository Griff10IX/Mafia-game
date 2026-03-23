import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Target, Sword, Dice5, Trophy, DollarSign, TrendingUp, Wine, Bot, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import AutoRefreshNote from '../../components/AutoRefreshNote';
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

const ALL_CASINO_GAMES = ['dice', 'roulette', 'blackjack', 'horseracing', 'videopoker', 'slots', 'mdg', 'mp_blackjack', 'mp_poker'];

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

const EMPTY_MY_STATS = {
  combat: {},
  rank: {},
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

/** ✅ UPDATED StatCard with rightContent */
const StatCard = ({ title, icon: Icon, rows, delay = 0, rightContent }) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 stat-card stat-fade-in mobile-panel`} style={{ animationDelay: `${delay}s` }}>
      
      {/* HEADER */}
      <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon size={12} className="text-primary" />}
          <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
            {title}
          </h2>
        </div>

        {rightContent && <div>{rightContent}</div>}
      </div>

      {/* BODY */}
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
    return api.get('/stats/me')
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
    if (!window.confirm('Reset your gambling & sports stats display to zero?')) return;

    setResetGamblingLoading(true);
    try {
      await api.post('/stats/me/reset-gambling-display');
      toast.success('Gambling stats display reset.');
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

  const gambling = stats.gambling || {};
  const gamblingByGame = gambling.by_game || {};
  const totalProfit = gambling.total_profit ?? 0;

  const gamblingRows = [
    {
      label: 'Total',
      value: formatMoney(totalProfit),
      valueColor: totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400',
    },
    ...ALL_CASINO_GAMES.map((gt) => {
      const profit = gamblingByGame[gt] ?? 0;
      return {
        label: GAME_LABELS[gt],
        value: formatMoney(profit),
        valueColor: profit >= 0 ? 'text-emerald-400' : 'text-rose-400',
      };
    }),
  ];

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}>
      <style>{STATS_STYLES}</style>

      <div className="max-w-4xl mx-auto space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

          {/* ✅ Gambling card WITH button inside */}
          <StatCard
            title="Gambling (Playing)"
            icon={Dice5}
            rows={gamblingRows}
            rightContent={
              <button
                type="button"
                onClick={resetGamblingDisplay}
                disabled={resetGamblingLoading}
                className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[9px] font-heading text-primary hover:bg-primary/15 disabled:opacity-50"
              >
                <RotateCcw size={10} />
                {resetGamblingLoading ? '…' : 'Reset'}
              </button>
            }
          />

        </div>
      </div>
    </div>
  );
}