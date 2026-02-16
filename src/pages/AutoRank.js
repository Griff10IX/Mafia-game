import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Clock, Play, Square, Shield, Car, Crosshair, Lock, Users, Edit2, Ban, RefreshCw, BarChart3, TrendingUp, Briefcase } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const MIN_INTERVAL = 30;

export default function AutoRank() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [prefs, setPrefs] = useState({
    auto_rank_enabled: false,
    auto_rank_crimes: true,
    auto_rank_gta: true,
    auto_rank_bust_every_5_sec: false,
    auto_rank_oc: false,
    auto_rank_purchased: false,
    telegram_chat_id_set: false,
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(120);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [inputValue, setInputValue] = useState('120');
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [editingChatId, setEditingChatId] = useState({});
  const [editingToken, setEditingToken] = useState({});
  const [savingUser, setSavingUser] = useState(null);
  const [stats, setStats] = useState({
    total_busts: 0,
    total_crimes: 0,
    total_gtas: 0,
    total_cash: 0,
    running_seconds: 0,
    best_cars: [],
  });

  const formatRunningTime = (seconds) => {
    if (seconds <= 0) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(' ');
  };

  useEffect(() => {
    const run = async () => {
      try {
        const [meRes, checkRes, intervalRes, statsRes] = await Promise.all([
          api.get('/auto-rank/me').catch(() => ({ data: null })),
          api.get('/admin/check').catch(() => ({ data: {} })),
          api.get('/auto-rank/interval').catch(() => ({ data: null })),
          api.get('/auto-rank/stats').catch(() => ({ data: null })),
        ]);
        setIsAdmin(!!checkRes.data?.is_admin);
        if (meRes?.data) {
          setPrefs({
            auto_rank_enabled: meRes.data.auto_rank_enabled !== false,
            auto_rank_crimes: meRes.data.auto_rank_crimes !== false,
            auto_rank_gta: meRes.data.auto_rank_gta !== false,
            auto_rank_bust_every_5_sec: !!meRes.data.auto_rank_bust_every_5_sec,
            auto_rank_oc: !!meRes.data.auto_rank_oc,
            auto_rank_purchased: !!meRes.data.auto_rank_purchased,
            telegram_chat_id_set: !!meRes.data.telegram_chat_id_set,
          });
        }
        if (statsRes?.data) {
          setStats({
            total_busts: statsRes.data.total_busts ?? 0,
            total_crimes: statsRes.data.total_crimes ?? 0,
            total_gtas: statsRes.data.total_gtas ?? 0,
            total_cash: statsRes.data.total_cash ?? 0,
            running_seconds: statsRes.data.running_seconds ?? 0,
            best_cars: statsRes.data.best_cars ?? [],
          });
        }
        if (checkRes.data?.is_admin) {
          if (intervalRes?.data) {
            setIntervalSeconds(intervalRes.data.interval_seconds ?? 120);
            setInputValue(String(intervalRes.data.interval_seconds ?? 120));
            setGlobalEnabled(intervalRes.data.enabled !== false);
          }
          api.get('/admin/auto-rank/users').then((r) => setAdminUsers(r.data?.users ?? [])).catch(() => setAdminUsers([]));
        }
      } catch {
        setPrefs((p) => ({ ...p, auto_rank_purchased: false }));
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const updatePref = async (key, value) => {
    setSavingPrefs(true);
    try {
      const payload = { [key]: value };
      const res = await api.patch('/auto-rank/me', payload);
      setPrefs((p) => ({
        ...p,
        auto_rank_enabled: res.data?.auto_rank_enabled ?? p.auto_rank_enabled,
        auto_rank_crimes: res.data?.auto_rank_crimes ?? p.auto_rank_crimes,
        auto_rank_gta: res.data?.auto_rank_gta ?? p.auto_rank_gta,
        auto_rank_bust_every_5_sec: res.data?.auto_rank_bust_every_5_sec ?? p.auto_rank_bust_every_5_sec,
        auto_rank_oc: res.data?.auto_rank_oc ?? p.auto_rank_oc,
      }));
      toast.success('Saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleSaveInterval = async () => {
    const val = parseInt(inputValue, 10);
    if (Number.isNaN(val) || val < MIN_INTERVAL) {
      toast.error(`Interval must be at least ${MIN_INTERVAL} seconds`);
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch('/auto-rank/interval', { interval_seconds: val });
      setIntervalSeconds(res.data.interval_seconds);
      setInputValue(String(res.data.interval_seconds));
      toast.success(res.data?.message ?? 'Saved');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleStartGlobal = async () => {
    setToggling(true);
    try {
      const res = await api.post('/auto-rank/start');
      setGlobalEnabled(res.data?.enabled !== false);
      toast.success(res.data?.message ?? 'Auto Rank started');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to start');
    } finally {
      setToggling(false);
    }
  };

  const handleStopGlobal = async () => {
    setToggling(true);
    try {
      const res = await api.post('/auto-rank/stop');
      setGlobalEnabled(res.data?.enabled !== false);
      toast.success(res.data?.message ?? 'Auto Rank stopped');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to stop');
    } finally {
      setToggling(false);
    }
  };

  const fetchAdminUsers = () => {
    if (!isAdmin) return;
    setAdminUsersLoading(true);
    api.get('/admin/auto-rank/users').then((r) => setAdminUsers(r.data?.users ?? [])).catch(() => setAdminUsers([])).finally(() => setAdminUsersLoading(false));
  };

  const handleSaveUserChatId = async (username, newChatId) => {
    setSavingUser(username);
    try {
      await api.patch(`/admin/auto-rank/users/${encodeURIComponent(username)}`, { telegram_chat_id: newChatId || null });
      toast.success('Chat ID updated');
      setEditingChatId((p) => ({ ...p, [username]: false }));
      fetchAdminUsers();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to update');
    } finally {
      setSavingUser(null);
    }
  };

  const handleSaveUserToken = async (username, newToken) => {
    setSavingUser(username);
    try {
      await api.patch(`/admin/auto-rank/users/${encodeURIComponent(username)}`, { telegram_bot_token: newToken || null });
      toast.success('Bot token updated');
      setEditingToken((p) => ({ ...p, [username]: false }));
      fetchAdminUsers();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to update');
    } finally {
      setSavingUser(null);
    }
  };

  const handleDisableUser = async (username) => {
    setSavingUser(username);
    try {
      await api.patch(`/admin/auto-rank/users/${encodeURIComponent(username)}`, { auto_rank_enabled: false });
      toast.success(`${username}'s Auto Rank disabled`);
      fetchAdminUsers();
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to disable');
    } finally {
      setSavingUser(null);
    }
  };

  if (loading) {
    return (
      <div className={styles.pageContent}>
        <div className="font-heading text-primary text-lg">Loading...</div>
      </div>
    );
  }

  const canEnable = prefs.auto_rank_purchased;

  return (
    <div className={styles.pageContent}>
      <div className="max-w-md mx-auto space-y-4">
        {/* Your Auto Rank — for all users */}
        <div className={`${styles.panel} rounded-md overflow-hidden border-2 border-primary/20`}>
          <div className="px-3 py-2 md:px-4 md:py-3 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <span className="text-sm md:text-base font-heading font-bold text-primary uppercase tracking-wider">Your Auto Rank</span>
          </div>
          <div className="p-4 space-y-4">
            {!prefs.telegram_chat_id_set && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-heading">
                Set your <Link to="/profile" className="underline">Telegram chat ID in Profile → Settings</Link> to receive results. Get it from @userinfobot on Telegram.
              </p>
            )}
            {!canEnable && (
              <p className="text-sm text-mutedForeground font-heading">
                Buy Auto Rank from the <Link to="/store" className="text-primary underline">Store</Link> to enable automatic crimes, GTA, and jail busts. Results are sent to your Telegram.
              </p>
            )}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-heading text-foreground">Enable Auto Rank</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.auto_rank_enabled}
                  disabled={savingPrefs || (prefs.auto_rank_enabled ? false : !canEnable)}
                  onClick={() => updatePref('auto_rank_enabled', !prefs.auto_rank_enabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs.auto_rank_enabled ? 'bg-primary border-primary/50' : 'bg-secondary border-border'} ${savingPrefs || (!canEnable && !prefs.auto_rank_enabled) ? 'opacity-60' : ''}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${prefs.auto_rank_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-sm font-heading flex items-center gap-1.5 ${prefs.auto_rank_bust_every_5_sec ? 'text-mutedForeground' : 'text-foreground'}`}>
                  <Crosshair className="w-4 h-4 text-primary" /> Run crimes
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.auto_rank_crimes}
                  disabled={savingPrefs || !prefs.auto_rank_enabled || prefs.auto_rank_bust_every_5_sec}
                  onClick={() => updatePref('auto_rank_crimes', !prefs.auto_rank_crimes)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs.auto_rank_crimes ? 'bg-primary border-primary/50' : 'bg-secondary border-border'} ${savingPrefs || prefs.auto_rank_bust_every_5_sec ? 'opacity-60' : ''}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${prefs.auto_rank_crimes ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-sm font-heading flex items-center gap-1.5 ${prefs.auto_rank_bust_every_5_sec ? 'text-mutedForeground' : 'text-foreground'}`}>
                  <Car className="w-4 h-4 text-primary" /> Run GTA
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.auto_rank_gta}
                  disabled={savingPrefs || !prefs.auto_rank_enabled || prefs.auto_rank_bust_every_5_sec}
                  onClick={() => updatePref('auto_rank_gta', !prefs.auto_rank_gta)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs.auto_rank_gta ? 'bg-primary border-primary/50' : 'bg-secondary border-border'} ${savingPrefs || prefs.auto_rank_bust_every_5_sec ? 'opacity-60' : ''}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${prefs.auto_rank_gta ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-heading text-foreground flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-primary" /> Jail bust every 5 seconds
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.auto_rank_bust_every_5_sec}
                  disabled={savingPrefs || !prefs.auto_rank_enabled}
                  onClick={() => updatePref('auto_rank_bust_every_5_sec', !prefs.auto_rank_bust_every_5_sec)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs.auto_rank_bust_every_5_sec ? 'bg-primary border-primary/50' : 'bg-secondary border-border'} ${savingPrefs ? 'opacity-60' : ''}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${prefs.auto_rank_bust_every_5_sec ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-heading text-foreground flex items-center gap-1.5">
                  <Briefcase className="w-4 h-4 text-primary" /> Run Organised Crime (NPC only)
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.auto_rank_oc}
                  disabled={savingPrefs || !prefs.auto_rank_enabled}
                  onClick={() => updatePref('auto_rank_oc', !prefs.auto_rank_oc)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs.auto_rank_oc ? 'bg-primary border-primary/50' : 'bg-secondary border-border'} ${savingPrefs ? 'opacity-60' : ''}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${prefs.auto_rank_oc ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
            {prefs.auto_rank_oc && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-heading">
                Runs when your OC timer is ready. Only the best job you can afford is run, with NPC crew only. If you can&apos;t afford any job, it retries in 10 minutes.
              </p>
            )}
            {prefs.auto_rank_bust_every_5_sec && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-heading">
                With this on, busts are tried every 5 seconds (even when you&apos;re in jail). When jail is empty, crimes and GTA run instead, then busting resumes. Run crimes / Run GTA are disabled here since this mode handles them.
              </p>
            )}
            <p className="text-xs text-mutedForeground font-heading">
              When enabled, each cycle can run jail busts, then crimes (if on), then GTA (if on). Results are sent to your Telegram.
            </p>
          </div>
        </div>

        {/* Stats card */}
        {canEnable && (
          <div className={`${styles.panel} rounded-md overflow-hidden border-2 border-primary/20`}>
            <div className="px-3 py-2 md:px-4 md:py-3 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <span className="text-sm md:text-base font-heading font-bold text-primary uppercase tracking-wider">Auto Rank stats</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <div className="rounded-md bg-secondary/50 border border-border/50 p-3 text-center">
                  <div className="text-lg font-heading font-bold text-foreground">{stats.total_busts.toLocaleString()}</div>
                  <div className="text-xs font-heading text-mutedForeground uppercase tracking-wider">Busts</div>
                </div>
                <div className="rounded-md bg-secondary/50 border border-border/50 p-3 text-center">
                  <div className="text-lg font-heading font-bold text-foreground">{stats.total_crimes.toLocaleString()}</div>
                  <div className="text-xs font-heading text-mutedForeground uppercase tracking-wider">Crimes</div>
                </div>
                <div className="rounded-md bg-secondary/50 border border-border/50 p-3 text-center">
                  <div className="text-lg font-heading font-bold text-foreground">{stats.total_gtas.toLocaleString()}</div>
                  <div className="text-xs font-heading text-mutedForeground uppercase tracking-wider">GTAs</div>
                </div>
                <div className="rounded-md bg-secondary/50 border border-border/50 p-3 text-center">
                  <div className="text-lg font-heading font-bold text-emerald-500 dark:text-emerald-400">${stats.total_cash.toLocaleString()}</div>
                  <div className="text-xs font-heading text-mutedForeground uppercase tracking-wider">Cash made</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm font-heading">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-primary" />
                  <span className="text-mutedForeground">Running:</span>
                  <span className="text-foreground font-medium">{formatRunningTime(stats.running_seconds)}</span>
                </div>
              </div>
              {stats.best_cars && stats.best_cars.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <span className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-wider">Top 3 cars stolen</span>
                  </div>
                  <ul className="space-y-1">
                    {stats.best_cars.map((car, i) => (
                      <li key={i} className="flex items-center justify-between text-sm">
                        <span className="text-foreground font-medium">{car.name}</span>
                        <span className="text-emerald-500 dark:text-emerald-400 font-mono">${(car.value || 0).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Admin only: global loop */}
        {isAdmin && (
          <div className={`${styles.panel} rounded-md overflow-hidden border-2 border-primary/20`}>
            <div className="px-3 py-2 md:px-4 md:py-3 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <span className="text-sm md:text-base font-heading font-bold text-primary uppercase tracking-wider">Admin — Global loop</span>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className="text-sm font-heading text-foreground">
                  Loop: <span className={globalEnabled ? 'text-emerald-400 font-bold' : 'text-mutedForeground'}>{globalEnabled ? 'Running' : 'Stopped'}</span>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleStartGlobal}
                    disabled={toggling || globalEnabled}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-heading font-bold text-sm hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-4 h-4" /> Start
                  </button>
                  <button
                    type="button"
                    onClick={handleStopGlobal}
                    disabled={toggling || !globalEnabled}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-red-500/20 border border-red-500/50 text-red-400 font-heading font-bold text-sm hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Square className="w-4 h-4" /> Stop
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <Clock className="w-4 h-4" /> Interval between cycles (seconds)
                </label>
                <p className="text-xs text-mutedForeground mb-2">Minimum: {MIN_INTERVAL}s. Current: {intervalSeconds}s</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={MIN_INTERVAL}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-md bg-secondary border border-border text-foreground font-heading focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    type="button"
                    onClick={handleSaveInterval}
                    disabled={saving}
                    className="px-4 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-mutedForeground font-heading">
                Each cycle runs for all users who have Auto Rank enabled; then the next cycle starts after this interval.
              </p>
            </div>
          </div>
        )}

        {/* Admin: list all alive users with Auto Rank purchased */}
        {isAdmin && (
          <div className={`${styles.panel} rounded-md overflow-hidden border-2 border-primary/20`}>
            <div className="px-3 py-2 md:px-4 md:py-3 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <span className="text-sm md:text-base font-heading font-bold text-primary uppercase tracking-wider">Auto Rank users (alive)</span>
              </div>
              <button
                type="button"
                onClick={fetchAdminUsers}
                disabled={adminUsersLoading}
                className="p-1.5 rounded bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 disabled:opacity-50"
                title="Refresh list"
              >
                <RefreshCw className={`w-4 h-4 ${adminUsersLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="p-4 overflow-x-auto">
              {adminUsersLoading ? (
                <p className="text-sm text-mutedForeground font-heading">Loading...</p>
              ) : adminUsers.length === 0 ? (
                <p className="text-sm text-mutedForeground font-heading">No alive users with Auto Rank purchased.</p>
              ) : (
                <table className="w-full text-left border-collapse text-sm font-heading">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-2 pr-2 font-bold text-mutedForeground uppercase text-xs">Username</th>
                      <th className="py-2 pr-2 font-bold text-mutedForeground uppercase text-xs">Enabled</th>
                      <th className="py-2 pr-2 font-bold text-mutedForeground uppercase text-xs">Crimes</th>
                      <th className="py-2 pr-2 font-bold text-mutedForeground uppercase text-xs">GTA</th>
                      <th className="py-2 pr-2 font-bold text-mutedForeground uppercase text-xs">Bust 5s</th>
                      <th className="py-2 pr-2 font-bold text-mutedForeground uppercase text-xs">OC</th>
                      <th className="py-2 pr-2 font-bold text-mutedForeground uppercase text-xs">Chat ID</th>
                      <th className="py-2 pr-2 font-bold text-mutedForeground uppercase text-xs">Token</th>
                      <th className="py-2 font-bold text-mutedForeground uppercase text-xs">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((u) => (
                      <tr key={u.id || u.username} className="border-b border-border/50">
                        <td className="py-2 pr-2 text-foreground font-medium">{u.username}</td>
                        <td className="py-2 pr-2">
                          <span className={u.auto_rank_enabled ? 'text-emerald-400' : 'text-mutedForeground'}>{u.auto_rank_enabled ? 'Yes' : 'No'}</span>
                        </td>
                        <td className="py-2 pr-2">{u.auto_rank_crimes ? 'On' : 'Off'}</td>
                        <td className="py-2 pr-2">{u.auto_rank_gta ? 'On' : 'Off'}</td>
                        <td className="py-2 pr-2">{u.auto_rank_bust_every_5_sec ? 'On' : 'Off'}</td>
                        <td className="py-2 pr-2">{u.auto_rank_oc ? 'On' : 'Off'}</td>
                        <td className="py-2 pr-2">
                          {editingChatId[u.username] ? (
                            <div className="flex gap-1 items-center">
                              <input
                                type="text"
                                defaultValue={u.telegram_chat_id}
                                id={`chat-${u.username}`}
                                placeholder="Chat ID"
                                className="w-28 px-2 py-1 rounded bg-secondary border border-border text-foreground text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const val = document.getElementById(`chat-${u.username}`)?.value ?? '';
                                  handleSaveUserChatId(u.username, val.trim() || null);
                                }}
                                disabled={savingUser === u.username}
                                className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-bold disabled:opacity-50"
                              >
                                {savingUser === u.username ? '...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingChatId((p) => ({ ...p, [u.username]: false }))}
                                className="px-2 py-1 rounded bg-secondary border border-border text-mutedForeground text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className="text-mutedForeground font-mono text-xs">{u.telegram_chat_id || '—'}</span>
                          )}
                          {!editingChatId[u.username] && (
                            <button
                              type="button"
                              onClick={() => setEditingChatId((p) => ({ ...p, [u.username]: true }))}
                              className="ml-1 p-0.5 rounded text-primary hover:bg-primary/20"
                              title="Edit chat ID"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          {editingToken[u.username] ? (
                            <div className="flex gap-1 items-center">
                              <input
                                type="password"
                                defaultValue={u.telegram_bot_token}
                                id={`token-${u.username}`}
                                placeholder="Bot token"
                                className="w-32 px-2 py-1 rounded bg-secondary border border-border text-foreground text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const val = document.getElementById(`token-${u.username}`)?.value ?? '';
                                  handleSaveUserToken(u.username, val.trim() || null);
                                }}
                                disabled={savingUser === u.username}
                                className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-bold disabled:opacity-50"
                              >
                                {savingUser === u.username ? '...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingToken((p) => ({ ...p, [u.username]: false }))}
                                className="px-2 py-1 rounded bg-secondary border border-border text-mutedForeground text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className="text-mutedForeground font-mono text-xs">{u.telegram_bot_token ? '•••' : '—'}</span>
                          )}
                          {!editingToken[u.username] && (
                            <button
                              type="button"
                              onClick={() => setEditingToken((p) => ({ ...p, [u.username]: true }))}
                              className="ml-1 p-0.5 rounded text-primary hover:bg-primary/20"
                              title="Edit bot token"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                        <td className="py-2">
                          {u.auto_rank_enabled && (
                            <button
                              type="button"
                              onClick={() => handleDisableUser(u.username)}
                              disabled={savingUser === u.username}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 border border-red-500/50 text-red-400 text-xs font-bold hover:bg-red-500/30 disabled:opacity-50"
                            >
                              <Ban className="w-3.5 h-3.5" /> Disable
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
