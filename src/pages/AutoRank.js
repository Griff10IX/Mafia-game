import { useState, useEffect } from 'react';
import { Bot, Clock, Play, Square } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const MIN_INTERVAL = 30;

export default function AutoRank() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(120);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [inputValue, setInputValue] = useState('120');

  useEffect(() => {
    const run = async () => {
      try {
        const [checkRes, intervalRes] = await Promise.all([
          api.get('/admin/check'),
          api.get('/auto-rank/interval').catch(() => ({ data: { interval_seconds: 120, min_interval_seconds: MIN_INTERVAL, enabled: true } })),
        ]);
        setIsAdmin(!!checkRes.data?.is_admin);
        if (checkRes.data?.is_admin && intervalRes?.data) {
          const sec = intervalRes.data.interval_seconds ?? 120;
          setIntervalSeconds(sec);
          setInputValue(String(sec));
          setEnabled(intervalRes.data.enabled !== false);
        }
      } catch {
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const handleSave = async () => {
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

  const handleStart = async () => {
    setToggling(true);
    try {
      const res = await api.post('/auto-rank/start');
      setEnabled(res.data?.enabled !== false);
      toast.success(res.data?.message ?? 'Auto Rank started');
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to start');
    } finally {
      setToggling(false);
    }
  };

  const handleStop = async () => {
    setToggling(true);
    try {
      const res = await api.post('/auto-rank/stop');
      setEnabled(res.data?.enabled !== false);
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

  if (!isAdmin) {
    return (
      <div className={styles.pageContent}>
        <div className={`${styles.panel} rounded-md border border-border p-4`}>
          <p className="font-heading text-foreground">Admin access required to view Auto Rank settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContent}>
      <div className="max-w-md mx-auto space-y-4">
        <div className={`${styles.panel} rounded-md overflow-hidden border-2 border-primary/20`}>
          <div className="px-3 py-2 md:px-4 md:py-3 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <span className="text-sm md:text-base font-heading font-bold text-primary uppercase tracking-wider">Auto Rank</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-sm font-heading text-foreground">
                Status: <span className={enabled ? 'text-emerald-400 font-bold' : 'text-mutedForeground'}>{enabled ? 'Running' : 'Stopped'}</span>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={toggling || enabled}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-heading font-bold text-sm hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" /> Start Auto Rank
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={toggling || !enabled}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-red-500/20 border border-red-500/50 text-red-400 font-heading font-bold text-sm hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Square className="w-4 h-4" /> Stop Auto Rank
                </button>
              </div>
            </div>
            <p className="text-sm text-mutedForeground font-heading">
              Each cycle runs for all enabled users (crimes + GTA, results to Telegram). The next cycle starts only after the current one finishes, then waits the interval below. When stopped, the current cycle completes then no new cycles run until started.
            </p>
            <div>
              <label className="text-xs font-heading font-bold text-mutedForeground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Clock className="w-4 h-4" />
                Interval between cycles (seconds)
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
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
