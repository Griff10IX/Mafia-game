import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TrendingUp } from 'lucide-react';
import api from '../utils/api';
import styles from '../styles/noir.module.css';

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
  return d.toLocaleString();
}

function StatCard({ title, rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
      <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
        <div className="flex items-center gap-2">
          <div className="w-6 h-px bg-primary/50" />
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">{title}</span>
          <div className="flex-1 h-px bg-primary/50" />
        </div>
      </div>
      <div className="divide-y divide-primary/10">
        {safeRows.map((r) => (
          <div key={r.label} className={`grid grid-cols-12 px-4 py-2.5 text-xs font-heading ${styles.raisedHover} transition-smooth`}>
            <div className="col-span-7 text-mutedForeground">{r.label}</div>
            <div className="col-span-5 text-right font-bold text-foreground">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildGameCapitalRows(data) {
  const gc = data?.game_capital;
  return [
    { label: 'Total cash', value: formatMoney(gc?.total_cash) },
    { label: 'Swiss bank cash', value: formatMoney(gc?.swiss_total) },
    { label: 'Interest bank cash', value: formatMoney(gc?.interest_bank_total) },
    { label: 'Sportsbook profit', value: '—' },
    { label: 'Stock exchange profit', value: '—' },
    {
      label: 'Points in circulation',
      value: `${formatNumber(gc?.points_total)} Points`,
    },
  ];
}

function buildUserStatsRows(data) {
  const us = data && data.user_stats ? data.user_stats : null;
  return [
    { label: 'Total users', value: formatNumber(us ? us.total_users : null) },
    { label: 'Alive / Dead', value: `${formatNumber(us ? us.alive_users : null)} / ${formatNumber(us ? us.dead_users : null)}` },
    { label: 'Crimes', value: formatNumber(us ? us.total_crimes : null) },
    { label: 'GTAs', value: formatNumber(us ? us.total_gta : null) },
    { label: 'Jailbusts', value: formatNumber(us ? us.total_jail_busts : null) },
    { label: 'Bullets melted', value: formatNumber(us && us.bullets_melted_total != null ? us.bullets_melted_total : 0) },
  ];
}

function buildMiscRows() {
  return [
    { label: 'Swiss bank limit', value: '—' },
    { label: 'Interest bank limit', value: '—' },
    { label: 'Crew bank limit', value: '—' },
    { label: 'Entertainer pay per hr', value: '—' },
  ];
}

function buildVehicleRows(data) {
  const vs = data && data.vehicle_stats ? data.vehicle_stats : null;
  return [
    { label: 'Total vehicles', value: formatNumber(vs ? vs.total_vehicles : null) },
    { label: 'Exclusives', value: formatNumber(vs ? vs.exclusive_vehicles : null) },
    { label: 'Rares', value: formatNumber(vs ? vs.rare_vehicles : null) },
  ];
}

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
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [usersOnlyKills]);

  const gameCapitalRows = buildGameCapitalRows(data);
  const userStatsRows = buildUserStatsRows(data);
  const miscRows = buildMiscRows();
  const vehicleRows = buildVehicleRows(data);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="stats-loading">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="stats-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <TrendingUp size={24} className="text-primary" />
            Stats
          </h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Economy · users · ranks · recent kills</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatCard title="Game Capital" rows={gameCapitalRows} />
        <StatCard title="User Stats" rows={userStatsRows} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="grid grid-cols-1 gap-4">
          <StatCard title="Miscellaneous" rows={miscRows} />
          <StatCard title="Vehicle Stats" rows={vehicleRows} />
        </div>

        <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <div className="flex items-center gap-2">
              <div className="w-6 h-px bg-primary/50" />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Rank Stats</span>
              <div className="flex-1 h-px bg-primary/50" />
            </div>
          </div>
          <div className="divide-y divide-primary/10">
            {rankStats.map((r) => (
              <div key={r.rank_id} className={`grid grid-cols-12 px-4 py-2.5 text-xs font-heading ${styles.raisedHover} transition-smooth`}>
                <div className="col-span-6 text-foreground font-bold truncate">{r.rank_name}</div>
                <div className="col-span-3 text-center text-emerald-400 font-bold">{formatNumber(r.alive)}</div>
                <div className="col-span-3 text-right text-mutedForeground">{formatNumber(r.dead)}</div>
              </div>
            ))}
            {rankStats.length === 0 && (
              <div className="px-4 py-4 text-sm text-mutedForeground font-heading">No rank data yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className={`px-4 py-2 ${styles.surfaceMuted} border-b border-primary/20 flex items-center justify-between flex-wrap gap-2`}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStatsListTab('kills')}
              className={`text-xs font-heading font-bold uppercase tracking-widest px-3 py-1.5 rounded-sm transition-smooth ${statsListTab === 'kills' ? 'bg-primary/20 text-primary' : 'text-mutedForeground hover:text-foreground'}`}
            >
              Last 15 Kills
            </button>
            <button
              type="button"
              onClick={() => setStatsListTab('dead')}
              className={`text-xs font-heading font-bold uppercase tracking-widest px-3 py-1.5 rounded-sm transition-smooth ${statsListTab === 'dead' ? 'bg-primary/20 text-primary' : 'text-mutedForeground hover:text-foreground'}`}
            >
              Top Dead Users
            </button>
          </div>
          {statsListTab === 'kills' && (
            <label className="inline-flex items-center gap-2 text-xs text-mutedForeground font-heading select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary rounded border-primary/30"
                checked={usersOnlyKills}
                onChange={(e) => setUsersOnlyKills(e.target.checked)}
              />
              show users only
            </label>
          )}
        </div>

        <div>
          {statsListTab === 'kills' && (
            <>
              <div className={`grid grid-cols-12 ${styles.surfaceMuted} text-xs font-heading font-bold text-primary/80 uppercase tracking-wider px-4 py-2 border-b border-primary/20`}>
                <div className="col-span-4">Victim</div>
                <div className="col-span-3">Rank</div>
                <div className="col-span-3">Killer</div>
                <div className="col-span-2 text-right">Time</div>
              </div>
              {recentKills.length === 0 ? (
                <div className="px-4 py-4 text-sm text-mutedForeground font-heading">No kills yet.</div>
              ) : (
                recentKills.map((k) => (
                  <div key={k.id} className={`grid grid-cols-12 px-4 py-2.5 border-b border-primary/10 text-xs font-heading ${styles.raisedHover} transition-smooth`}>
                    <div className="col-span-4 text-foreground font-bold truncate">{k.victim_username}</div>
                    <div className="col-span-3 text-mutedForeground truncate">{k.victim_rank_name || '—'}</div>
                    <div className="col-span-3 text-mutedForeground truncate">
                      {k.killer_username ? `Killed by ${k.killer_username}` : 'Killed by (private)'}
                    </div>
                    <div className="col-span-2 text-right text-mutedForeground">{formatDateTime(k.created_at)}</div>
                  </div>
                ))
              )}
            </>
          )}
          {statsListTab === 'dead' && (
            <>
              <div className={`grid grid-cols-12 ${styles.surfaceMuted} text-xs font-heading font-bold text-primary/80 uppercase tracking-wider px-4 py-2 border-b border-primary/20`}>
                <div className="col-span-5">Username</div>
                <div className="col-span-2 text-center">Kills</div>
                <div className="col-span-3">Rank</div>
                <div className="col-span-2 text-right">Died</div>
              </div>
              {topDeadUsers.length === 0 ? (
                <div className="px-4 py-4 text-sm text-mutedForeground font-heading">No dead users yet.</div>
              ) : (
                topDeadUsers.map((u, i) => (
                  <div key={u.username + (u.dead_at || '')} className={`grid grid-cols-12 px-4 py-2.5 border-b border-primary/10 text-xs font-heading ${styles.raisedHover} transition-smooth`}>
                    <div className="col-span-5 text-foreground font-bold truncate">{u.username}</div>
                    <div className="col-span-2 text-center text-mutedForeground">{formatNumber(u.total_kills)}</div>
                    <div className="col-span-3 text-mutedForeground truncate">{u.rank_name || '—'}</div>
                    <div className="col-span-2 text-right text-mutedForeground">{formatDateTime(u.dead_at)}</div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

