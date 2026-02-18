import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { TrendingUp } from 'lucide-react';
import api from '../utils/api';
import styles from '../styles/noir.module.css';

const STATS_STYLES = `
  @keyframes stat-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .stat-fade-in { animation: stat-fade-in 0.4s ease-out both; }
  @keyframes stat-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .stat-scale-in { animation: stat-scale-in 0.35s ease-out both; }
  @keyframes stat-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .stat-glow { animation: stat-glow 4s ease-in-out infinite; }
  .stat-corner::before, .stat-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .stat-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .stat-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .stat-card { transition: all 0.3s ease; }
  .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .stat-row { transition: all 0.2s ease; }
  .stat-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .stat-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

// Utility functions
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
  return `$${num.toLocaleString()}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// Subcomponents
const LoadingSpinner = () => (
  <div className={`space-y-2 ${styles.pageContent}`}>
    <style>{STATS_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2" data-testid="stats-loading">
      <TrendingUp size={20} className="text-primary/40 animate-pulse" />
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[9px] font-heading uppercase tracking-wider">Loading stats...</span>
    </div>
  </div>
);

const StatCard = ({ title, rows, delay = 0 }) => {
  const safeRows = Array.isArray(rows) ? rows : [];

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 stat-card stat-corner stat-fade-in`} style={{ animationDelay: `${delay}s` }}>
      <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none stat-glow" />
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
        <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
          {title}
        </h2>
      </div>
      {safeRows.length === 0 ? (
        <div className="px-2 py-3 text-[10px] text-mutedForeground font-heading text-center">
          No data available
        </div>
      ) : (
        <div className="divide-y divide-zinc-700/30">
          {safeRows.map((r) => (
            <div
              key={r.label}
              className="stat-row flex items-center justify-between px-2 py-1.5 text-[10px] font-heading"
            >
              <span className="text-mutedForeground">{r.label}</span>
              <span className="font-bold text-foreground tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="stat-art-line text-primary mx-2" />
    </div>
  );
};

const RankStatsCard = ({ rankStats }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 stat-card stat-corner stat-fade-in`} style={{ animationDelay: '0.05s' }}>
    <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none stat-glow" />
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
        Rank Stats
      </h2>
    </div>
    {rankStats.length === 0 ? (
      <div className="px-2 py-3 text-[10px] text-mutedForeground font-heading text-center">
        No rank data yet.
      </div>
    ) : (
      <div className="divide-y divide-zinc-700/30">
        {rankStats.map((r) => (
          <div
            key={r.rank_id}
            className="stat-row flex items-center justify-between px-2 py-1.5 text-[10px] font-heading"
          >
            <span className="font-bold text-foreground flex-1 truncate">{r.rank_name}</span>
            <span className="text-emerald-400 font-bold tabular-nums w-12 text-center">
              {formatNumber(r.alive)}
            </span>
            <span className="text-mutedForeground tabular-nums w-12 text-right">
              {formatNumber(r.dead)}
            </span>
          </div>
        ))}
      </div>
    )}
    <div className="stat-art-line text-primary mx-2" />
  </div>
);

const KillsListView = ({ kills, usersOnly, onToggleUsersOnly }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 stat-card stat-corner stat-fade-in`} style={{ animationDelay: '0.1s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2 py-1 bg-primary/8 border-b border-primary/20 flex items-center justify-between flex-wrap gap-1">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
        Last 15 Kills
      </h2>
      <label className="inline-flex items-center gap-1 text-[9px] text-mutedForeground font-heading select-none cursor-pointer">
        <input
          type="checkbox"
          className="h-3 w-3 accent-primary rounded border-primary/30 cursor-pointer"
          checked={usersOnly}
          onChange={(e) => onToggleUsersOnly(e.target.checked)}
        />
        show users only
      </label>
    </div>

    {/* Desktop view */}
    <div className="hidden md:block">
      <div className="px-2 py-1 bg-zinc-800/50 text-[8px] font-heading font-bold text-zinc-500 uppercase tracking-wider grid grid-cols-12 gap-1 border-b border-zinc-700/40">
        <div className="col-span-4">Victim</div>
        <div className="col-span-3">Rank</div>
        <div className="col-span-3">Killer</div>
        <div className="col-span-2 text-right">Time</div>
      </div>
      {kills.length === 0 ? (
        <div className="px-2 py-4 text-[10px] text-mutedForeground font-heading text-center">
          No kills yet.
        </div>
      ) : (
        <div className="divide-y divide-zinc-700/30">
          {kills.map((k) => (
            <div
              key={k.id}
              className="stat-row grid grid-cols-12 gap-1 px-2 py-1.5 text-[10px] font-heading"
            >
              <div className="col-span-4 text-foreground font-bold truncate">{k.victim_username}</div>
              <div className="col-span-3 text-mutedForeground truncate">{k.victim_rank_name || '—'}</div>
              <div className="col-span-3 text-mutedForeground truncate">
                {k.killer_username ? k.killer_username : '(private)'}
              </div>
              <div className="col-span-2 text-right text-mutedForeground tabular-nums">
                {formatDateTime(k.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Mobile view */}
    <div className="md:hidden divide-y divide-zinc-700/30">
      {kills.length === 0 ? (
        <div className="px-2 py-4 text-[10px] text-mutedForeground font-heading text-center">
          No kills yet.
        </div>
      ) : (
        kills.map((k) => (
          <div key={k.id} className="stat-row p-2 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-heading font-bold text-foreground truncate">
                  {k.victim_username}
                </div>
                <div className="text-[9px] text-mutedForeground mt-0.5">
                  {k.victim_rank_name || '—'}
                </div>
              </div>
              <div className="text-[9px] text-mutedForeground tabular-nums">
                {formatDateTime(k.created_at)}
              </div>
            </div>
            <div className="text-[9px] text-mutedForeground">
              Killed by {k.killer_username || '(private)'}
            </div>
          </div>
        ))
      )}
    </div>
    <div className="stat-art-line text-primary mx-2" />
  </div>
);

const DeadUsersListView = ({ users }) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 stat-card stat-corner stat-fade-in`} style={{ animationDelay: '0.1s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
        Top Dead Users
      </h2>
    </div>

    {/* Desktop view */}
    <div className="hidden md:block">
      <div className="px-2 py-1 bg-zinc-800/50 text-[8px] font-heading font-bold text-zinc-500 uppercase tracking-wider grid grid-cols-12 gap-1 border-b border-zinc-700/40">
        <div className="col-span-5">Username</div>
        <div className="col-span-2 text-center">Kills</div>
        <div className="col-span-3">Rank</div>
        <div className="col-span-2 text-right">Died</div>
      </div>
      {users.length === 0 ? (
        <div className="px-2 py-4 text-[10px] text-mutedForeground font-heading text-center">
          No dead users yet.
        </div>
      ) : (
        <div className="divide-y divide-zinc-700/30">
          {users.map((u) => (
            <div
              key={u.username + (u.dead_at || '')}
              className="stat-row grid grid-cols-12 gap-1 px-2 py-1.5 text-[10px] font-heading"
            >
              <div className="col-span-5 text-foreground font-bold truncate"><Link to={`/profile/${encodeURIComponent(u.username)}`} className="text-primary hover:underline">{u.username}</Link></div>
              <div className="col-span-2 text-center text-mutedForeground tabular-nums">
                {formatNumber(u.total_kills)}
              </div>
              <div className="col-span-3 text-mutedForeground truncate">{u.rank_name || '—'}</div>
              <div className="col-span-2 text-right text-mutedForeground tabular-nums">
                {formatDateTime(u.dead_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Mobile view */}
    <div className="md:hidden divide-y divide-zinc-700/30">
      {users.length === 0 ? (
        <div className="px-2 py-4 text-[10px] text-mutedForeground font-heading text-center">
          No dead users yet.
        </div>
      ) : (
        users.map((u) => (
          <div key={u.username + (u.dead_at || '')} className="stat-row p-2 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-heading font-bold text-foreground truncate">
                  <Link to={`/profile/${encodeURIComponent(u.username)}`} className="text-primary hover:underline">{u.username}</Link>
                </div>
                <div className="text-[9px] text-mutedForeground mt-0.5">
                  {u.rank_name || '—'}
                </div>
              </div>
              <div className="text-[9px] text-emerald-400 font-bold tabular-nums">
                {formatNumber(u.total_kills)} kills
              </div>
            </div>
            <div className="text-[9px] text-mutedForeground tabular-nums">
              Died {formatDateTime(u.dead_at)}
            </div>
          </div>
        ))
      )}
    </div>
    <div className="stat-art-line text-primary mx-2" />
  </div>
);

// Data builders
function buildGameCapitalRows(data) {
  const gc = data?.game_capital;
  return [
    { label: 'Total cash', value: formatMoney(gc?.total_cash) },
    { label: 'Swiss bank cash', value: formatMoney(gc?.swiss_total) },
    { label: 'Interest bank cash', value: formatMoney(gc?.interest_bank_total) },
    { label: 'Points in circulation', value: `${formatNumber(gc?.points_total)} Points` },
  ];
}

function buildUserStatsRows(data) {
  const us = data?.user_stats;
  return [
    { label: 'Total users', value: formatNumber(us?.total_users) },
    { label: 'Alive / Dead', value: `${formatNumber(us?.alive_users)} / ${formatNumber(us?.dead_users)}` },
    { label: 'Crimes', value: formatNumber(us?.total_crimes) },
    { label: 'GTAs', value: formatNumber(us?.total_gta) },
    { label: 'Jailbusts', value: formatNumber(us?.total_jail_busts) },
    { label: 'Bullets melted', value: formatNumber(us?.bullets_melted_total ?? 0) },
  ];
}

function buildVehicleRows(data) {
  const vs = data?.vehicle_stats;
  return [
    { label: 'Total vehicles', value: formatNumber(vs?.total_vehicles) },
    { label: 'Common', value: formatNumber(vs?.common_vehicles) },
    { label: 'Uncommon', value: formatNumber(vs?.uncommon_vehicles) },
    { label: 'Rare', value: formatNumber(vs?.rare_vehicles) },
    { label: 'Ultra rare', value: formatNumber(vs?.ultra_rare_vehicles) },
    { label: 'Legendary', value: formatNumber(vs?.legendary_vehicles) },
    { label: 'Custom', value: formatNumber(vs?.custom_vehicles) },
    { label: 'Exclusives', value: formatNumber(vs?.exclusive_vehicles) },
  ];
}

// Main component
export default function Stats() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [usersOnlyKills, setUsersOnlyKills] = useState(true);
  const [statsListTab, setStatsListTab] = useState('kills'); // 'kills' | 'dead'

  const rankStats = Array.isArray(data?.rank_stats) ? data.rank_stats : [];
  const recentKills = Array.isArray(data?.recent_kills) ? data.recent_kills : [];
  const topDeadUsers = Array.isArray(data?.top_dead_users) ? data.top_dead_users : [];

  useEffect(() => {
    let cancelled = false;
    
    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/stats/overview?users_only_kills=${usersOnlyKills ? 'true' : 'false'}`);
        if (!cancelled) setData(res.data);
      } catch (e) {
        if (!cancelled) {
          toast.error('Failed to load stats');
          console.error('Error fetching stats:', e);
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    
    return () => { cancelled = true; };
  }, [usersOnlyKills]);

  if (loading) {
    return <LoadingSpinner />;
  }

  const gameCapitalRows = buildGameCapitalRows(data);
  const userStatsRows = buildUserStatsRows(data);
  const vehicleRows = buildVehicleRows(data);

  return (
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="stats-page">
      <style>{STATS_STYLES}</style>

      <p className="text-[9px] text-zinc-500 font-heading italic">Game capital, users, vehicles, ranks — and the body count.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
        <StatCard title="Game Capital" rows={gameCapitalRows} delay={0} />
        <StatCard title="User Stats" rows={userStatsRows} delay={0.04} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
        <StatCard title="Vehicle Stats" rows={vehicleRows} delay={0.05} />
        <RankStatsCard rankStats={rankStats} />
      </div>

      <div className="flex items-center gap-0 border-b-2 border-zinc-700/50">
        <button
          type="button"
          onClick={() => setStatsListTab('kills')}
          className={`flex items-center gap-1 px-2 py-1.5 text-[9px] font-heading font-bold uppercase tracking-wider transition-all border-b-2 -mb-0.5 touch-manipulation ${
            statsListTab === 'kills'
              ? 'text-primary border-primary bg-primary/5'
              : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-600'
          }`}
        >
          Last 15 Kills
        </button>
        <button
          type="button"
          onClick={() => setStatsListTab('dead')}
          className={`flex items-center gap-1 px-2 py-1.5 text-[9px] font-heading font-bold uppercase tracking-wider transition-all border-b-2 -mb-0.5 touch-manipulation ${
            statsListTab === 'dead'
              ? 'text-primary border-primary bg-primary/5'
              : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-600'
          }`}
        >
          Top Dead Users
        </button>
      </div>

      {/* List views */}
      {statsListTab === 'kills' && (
        <KillsListView
          kills={recentKills}
          usersOnly={usersOnlyKills}
          onToggleUsersOnly={setUsersOnlyKills}
        />
      )}

      {statsListTab === 'dead' && (
        <DeadUsersListView users={topDeadUsers} />
      )}
    </div>
  );
}
