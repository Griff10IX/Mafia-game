import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { TrendingUp } from 'lucide-react';
import api from '../utils/api';
import styles from '../styles/noir.module.css';

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
  <div className="flex items-center justify-center min-h-[60vh]" data-testid="stats-loading">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const StatCard = ({ title, rows }) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  
  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-4 py-2 bg-primary/10 border-b border-primary/30">
        <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
          {title}
        </h2>
      </div>
      {safeRows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-mutedForeground font-heading text-center">
          No data available
        </div>
      ) : (
        <div className="divide-y divide-border">
          {safeRows.map((r) => (
            <div 
              key={r.label} 
              className="flex items-center justify-between px-4 py-2.5 text-sm font-heading hover:bg-secondary/30 transition-colors"
            >
              <span className="text-mutedForeground">{r.label}</span>
              <span className="font-bold text-foreground tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RankStatsCard = ({ rankStats }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-4 py-2 bg-primary/10 border-b border-primary/30">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        Rank Stats
      </h2>
    </div>
    {rankStats.length === 0 ? (
      <div className="px-4 py-6 text-sm text-mutedForeground font-heading text-center">
        No rank data yet.
      </div>
    ) : (
      <div className="divide-y divide-border">
        {rankStats.map((r) => (
          <div 
            key={r.rank_id} 
            className="flex items-center justify-between px-4 py-2.5 text-sm font-heading hover:bg-secondary/30 transition-colors"
          >
            <span className="font-bold text-foreground flex-1 truncate">{r.rank_name}</span>
            <span className="text-emerald-400 font-bold tabular-nums w-16 text-center">
              {formatNumber(r.alive)}
            </span>
            <span className="text-mutedForeground tabular-nums w-16 text-right">
              {formatNumber(r.dead)}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

const KillsListView = ({ kills, usersOnly, onToggleUsersOnly }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between flex-wrap gap-2">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        Last 15 Kills
      </h2>
      <label className="inline-flex items-center gap-2 text-xs text-mutedForeground font-heading select-none cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary rounded border-primary/30 cursor-pointer"
          checked={usersOnly}
          onChange={(e) => onToggleUsersOnly(e.target.checked)}
        />
        show users only
      </label>
    </div>
    
    {/* Desktop view */}
    <div className="hidden md:block">
      <div className="px-4 py-2 bg-secondary/30 text-xs font-heading font-bold text-primary/80 uppercase tracking-wider grid grid-cols-12 gap-2 border-b border-border">
        <div className="col-span-4">Victim</div>
        <div className="col-span-3">Rank</div>
        <div className="col-span-3">Killer</div>
        <div className="col-span-2 text-right">Time</div>
      </div>
      {kills.length === 0 ? (
        <div className="px-4 py-8 text-sm text-mutedForeground font-heading text-center">
          No kills yet.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {kills.map((k) => (
            <div 
              key={k.id} 
              className="grid grid-cols-12 gap-2 px-4 py-3 text-xs font-heading hover:bg-secondary/30 transition-colors"
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
    <div className="md:hidden divide-y divide-border">
      {kills.length === 0 ? (
        <div className="px-4 py-8 text-sm text-mutedForeground font-heading text-center">
          No kills yet.
        </div>
      ) : (
        kills.map((k) => (
          <div key={k.id} className="p-4 space-y-2 hover:bg-secondary/30 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-heading font-bold text-foreground truncate">
                  {k.victim_username}
                </div>
                <div className="text-xs text-mutedForeground mt-0.5">
                  {k.victim_rank_name || '—'}
                </div>
              </div>
              <div className="text-xs text-mutedForeground tabular-nums">
                {formatDateTime(k.created_at)}
              </div>
            </div>
            <div className="text-xs text-mutedForeground">
              Killed by {k.killer_username || '(private)'}
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

const DeadUsersListView = ({ users }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-4 py-2 bg-primary/10 border-b border-primary/30">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        Top Dead Users
      </h2>
    </div>
    
    {/* Desktop view */}
    <div className="hidden md:block">
      <div className="px-4 py-2 bg-secondary/30 text-xs font-heading font-bold text-primary/80 uppercase tracking-wider grid grid-cols-12 gap-2 border-b border-border">
        <div className="col-span-5">Username</div>
        <div className="col-span-2 text-center">Kills</div>
        <div className="col-span-3">Rank</div>
        <div className="col-span-2 text-right">Died</div>
      </div>
      {users.length === 0 ? (
        <div className="px-4 py-8 text-sm text-mutedForeground font-heading text-center">
          No dead users yet.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {users.map((u) => (
            <div 
              key={u.username + (u.dead_at || '')} 
              className="grid grid-cols-12 gap-2 px-4 py-3 text-xs font-heading hover:bg-secondary/30 transition-colors"
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
    <div className="md:hidden divide-y divide-border">
      {users.length === 0 ? (
        <div className="px-4 py-8 text-sm text-mutedForeground font-heading text-center">
          No dead users yet.
        </div>
      ) : (
        users.map((u) => (
          <div key={u.username + (u.dead_at || '')} className="p-4 space-y-2 hover:bg-secondary/30 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-heading font-bold text-foreground truncate">
                  <Link to={`/profile/${encodeURIComponent(u.username)}`} className="text-primary hover:underline">{u.username}</Link>
                </div>
                <div className="text-xs text-mutedForeground mt-0.5">
                  {u.rank_name || '—'}
                </div>
              </div>
              <div className="text-xs text-emerald-400 font-bold tabular-nums">
                {formatNumber(u.total_kills)} kills
              </div>
            </div>
            <div className="text-xs text-mutedForeground tabular-nums">
              Died {formatDateTime(u.dead_at)}
            </div>
          </div>
        ))
      )}
    </div>
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
    { label: 'Exclusives', value: formatNumber(vs?.exclusive_vehicles) },
    { label: 'Rares', value: formatNumber(vs?.rare_vehicles) },
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
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="stats-page">
      {/* Stats grid — items-start so short cards (Game Capital, Vehicle Stats) don't stretch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
        <StatCard title="Game Capital" rows={gameCapitalRows} />
        <StatCard title="User Stats" rows={userStatsRows} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
        <StatCard title="Vehicle Stats" rows={vehicleRows} />
        <RankStatsCard rankStats={rankStats} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setStatsListTab('kills')}
          className={`px-4 py-2 rounded-md text-sm font-heading font-bold uppercase tracking-wide transition-all touch-manipulation ${
            statsListTab === 'kills'
              ? 'bg-primary/20 text-primary border border-primary/40'
              : 'bg-secondary text-mutedForeground border border-border hover:text-foreground'
          }`}
        >
          Last 15 Kills
        </button>
        <button
          type="button"
          onClick={() => setStatsListTab('dead')}
          className={`px-4 py-2 rounded-md text-sm font-heading font-bold uppercase tracking-wide transition-all touch-manipulation ${
            statsListTab === 'dead'
              ? 'bg-primary/20 text-primary border border-primary/40'
              : 'bg-secondary text-mutedForeground border border-border hover:text-foreground'
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
