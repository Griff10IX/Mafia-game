import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import styles from '../../styles/noir.module.css';
import { formatGameDateTime } from '../../utils/gameDateTime';

const DURATIONS = [
  { hours: 12, label: '12 hours' },
  { hours: 24, label: '1 day' },
  { hours: 48, label: '2 days' },
  { hours: 72, label: '3 days' },
];

function formatRemaining(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const NOTICE = (
  <>
    This ban <span className="text-foreground font-semibold">cannot be undone</span>.{' '}
    Admins will <span className="text-foreground font-semibold">not</span> remove it.
    Any Help Desk messages about lifting a gambling ban will be ignored.
  </>
);

export default function GamblingBan() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [durationHours, setDurationHours] = useState(24);
  const [confirmStep, setConfirmStep] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await api.get('/account/gambling-self-ban');
      setStatus(res.data || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load gambling ban status');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!status?.active) return undefined;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status?.active]);

  const remainingSeconds = (() => {
    if (!status?.active || !status?.until) return 0;
    const untilMs = new Date(status.until).getTime();
    if (!Number.isFinite(untilMs)) return Math.max(0, Number(status.remaining_seconds) || 0);
    return Math.max(0, Math.floor((untilMs - nowTick) / 1000));
  })();

  useEffect(() => {
    if (status?.active && remainingSeconds <= 0) {
      load();
    }
  }, [status?.active, remainingSeconds, load]);

  const activate = async () => {
    setSaving(true);
    try {
      const res = await api.post('/account/gambling-self-ban', { duration_hours: durationHours });
      setStatus(res.data || null);
      setConfirmStep(false);
      toast.success('Gambling self-exclusion is now active.');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start gambling ban');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="gambling-ban-page">
      <div className="relative">
        <Link
          to="/casino"
          className="inline-flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-mutedForeground hover:text-primary mb-2"
        >
          <ChevronLeft size={12} /> Casino
        </Link>
        <div className="flex items-center gap-2">
          <Ban size={18} className="text-amber-400 shrink-0" />
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">
            Gambling Ban
          </h1>
        </div>
        <p className="text-[10px] text-zinc-500 font-heading italic mt-1">
          Self-exclude from casinos and sports betting for up to 3 days.
        </p>
      </div>

      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
            {status?.active ? 'Active exclusion' : 'Start self-exclusion'}
          </h2>
        </div>
        <div className="p-3 space-y-3">
          {loading ? (
            <p className="text-[11px] text-mutedForeground font-heading">Loading…</p>
          ) : status?.active ? (
            <>
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-3 space-y-2">
                <p className="text-[11px] font-heading font-bold text-amber-300 uppercase tracking-wider">
                  You are self-excluded
                </p>
                <p className="text-2xl font-heading font-bold text-foreground tabular-nums">
                  {formatRemaining(remainingSeconds)}
                </p>
                <p className="text-[10px] text-mutedForeground font-heading">
                  Expires {formatGameDateTime(status.until)}
                </p>
              </div>
              <p className="text-[10px] text-zinc-400 font-heading leading-relaxed">{NOTICE}</p>
              <p className="text-[9px] text-zinc-500 font-heading">
                Player MDGs are blocked. You can still join MDGs created by admins or mods.
                Buy/sell points, Quick Trade, and casino ownership (claim, relinquish, list, buy-back) still work.
              </p>
            </>
          ) : !confirmStep ? (
            <>
              <p className="text-[10px] text-zinc-400 font-heading leading-relaxed">
                Blocks casino games and sports bets for the time you choose. You can still buy and sell
                points, use Quick Trade, and manage casino ownership (claim / relinquish / list / buy-back).
                Max length is 3 days.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.hours}
                    type="button"
                    onClick={() => setDurationHours(d.hours)}
                    className={`py-2 px-2 text-[10px] font-heading font-bold uppercase rounded border ${
                      durationHours === d.hours
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                        : 'border-primary/20 text-mutedForeground hover:border-primary/40'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setConfirmStep(true)}
                className="w-full min-h-[44px] py-2.5 text-[10px] font-heading font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-3 space-y-2">
                <p className="text-[11px] font-heading font-bold text-red-300 uppercase tracking-wider">
                  Confirm {DURATIONS.find((d) => d.hours === durationHours)?.label || `${durationHours}h`} ban
                </p>
                <p className="text-[10px] text-zinc-300 font-heading leading-relaxed">{NOTICE}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirmStep(false)}
                  className="flex-1 min-h-[44px] py-2.5 text-[10px] font-heading font-bold uppercase rounded border border-primary/25 text-mutedForeground hover:bg-primary/10 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={activate}
                  className="flex-1 min-h-[44px] py-2.5 text-[10px] font-heading font-bold uppercase rounded bg-red-600/80 text-white border border-red-500/60 hover:bg-red-600 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Confirm ban — cannot undo'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
