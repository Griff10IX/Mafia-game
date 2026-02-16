import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Clock, Play, Square, Shield, Car, Crosshair, Lock } from 'lucide-react';
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
    auto_rank_purchased: false,
    telegram_chat_id_set: false,
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(120);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [inputValue, setInputValue] = useState('120');

  useEffect(() => {
    const run = async () => {
      try {
        const [meRes, checkRes, intervalRes] = await Promise.all([
          api.get('/auto-rank/me').catch(() => ({ data: null })),
          api.get('/admin/check').catch(() => ({ data: {} })),
          api.get('/auto-rank/interval').catch(() => ({ data: null })),
        ]);
        setIsAdmin(!!checkRes.data?.is_admin);
        if (meRes?.data) {
          setPrefs({
            auto_rank_enabled: meRes.data.auto_rank_enabled !== false,
            auto_rank_crimes: meRes.data.auto_rank_crimes !== false,
            auto_rank_gta: meRes.data.auto_rank_gta !== false,
            auto_rank_bust_every_5_sec: !!meRes.data.auto_rank_bust_every_5_sec,
            auto_rank_purchased: !!meRes.data.auto_rank_purchased,
            telegram_chat_id_set: !!meRes.data.telegram_chat_id_set,
          });
        }
        if (checkRes.data?.is_admin && intervalRes?.data) {
          setIntervalSeconds(intervalRes.data.interval_seconds ?? 120);
          setInputValue(String(intervalRes.data.interval_seconds ?? 120));
          setGlobalEnabled(intervalRes.data.enabled !== false);
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
                <span className="text-sm font-heading text-foreground flex items-center gap-1.5">
                  <Crosshair className="w-4 h-4 text-primary" /> Run crimes
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.auto_rank_crimes}
                  disabled={savingPrefs || !prefs.auto_rank_enabled}
                  onClick={() => updatePref('auto_rank_crimes', !prefs.auto_rank_crimes)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs.auto_rank_crimes ? 'bg-primary border-primary/50' : 'bg-secondary border-border'} ${savingPrefs ? 'opacity-60' : ''}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${prefs.auto_rank_crimes ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-heading text-foreground flex items-center gap-1.5">
                  <Car className="w-4 h-4 text-primary" /> Run GTA
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.auto_rank_gta}
                  disabled={savingPrefs || !prefs.auto_rank_enabled}
                  onClick={() => updatePref('auto_rank_gta', !prefs.auto_rank_gta)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${prefs.auto_rank_gta ? 'bg-primary border-primary/50' : 'bg-secondary border-border'} ${savingPrefs ? 'opacity-60' : ''}`}
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
            </div>
            {prefs.auto_rank_bust_every_5_sec && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-heading">
                With this on, busts are tried every 5 seconds (even when you&apos;re in jail). Crimes and GTA still run at least every 5 minutes.
              </p>
            )}
            <p className="text-xs text-mutedForeground font-heading">
              When enabled, each cycle can run jail busts, then crimes (if on), then GTA (if on). Results are sent to your Telegram.
            </p>
          </div>
        </div>

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
      </div>
    </div>
  );
}
