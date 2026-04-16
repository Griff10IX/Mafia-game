import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Zap } from 'lucide-react';
import api from '../utils/api';
import styles from '../styles/noir.module.css';

const STORAGE_PREFIX = 'active_event_banner_dismissed_v4';

/** Normalize expiry so ISO variants (+00:00 vs Z) map to one key. */
function expiryKeyPart(expiresAt) {
  if (!expiresAt) return '';
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) ? String(t) : String(expiresAt);
}

/**
 * Stable per rotation: sorted ids + expiry ms so API string quirks cannot break dismiss.
 * New rotation (different ids or expiry) => new key => banner shows again.
 */
function dismissStorageKey(eventIds, expiresAt) {
  const sorted = [...(eventIds || [])].sort().join('|');
  return `${STORAGE_PREFIX}_${sorted}@${expiryKeyPart(expiresAt)}`;
}

function formatCountdown(expiresAt) {
  if (!expiresAt) return '';
  const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (diff <= 0) return 'rotating soon';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function readDismissed(sig) {
  if (!sig) return false;
  try {
    return localStorage.getItem(sig) === '1';
  } catch {
    return false;
  }
}

export default function ActiveEventBanner({ fetchEnabled }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  /** Bumps after dismiss so we re-read localStorage in the same session without relying on useEffect (avoids flash on remount / route changes). */
  const [dismissTick, setDismissTick] = useState(0);
  const [countdown, setCountdown] = useState('');

  const load = useCallback(() => {
    if (!fetchEnabled) {
      setData(null);
      setLoading(false);
      return;
    }
    api
      .get('/events/active')
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [fetchEnabled]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!fetchEnabled) return undefined;
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(id);
    };
  }, [fetchEnabled, load]);

  const eventDismissSig = useMemo(() => {
    if (!data?.events_enabled || !data?.event || data.event.id === 'none') return '';
    const rawIds = data.active_event_ids;
    const ids =
      Array.isArray(rawIds) && rawIds.length > 0
        ? rawIds
        : data.event?.id && data.event.id !== 'none'
          ? ['__sole__', data.event.id]
          : [];
    if (ids.length === 0) return '';
    return dismissStorageKey(ids, data.expires_at);
  }, [data]);

  const dismissed = useMemo(() => readDismissed(eventDismissSig), [eventDismissSig, dismissTick]);

  useEffect(() => {
    if (!data?.expires_at) return undefined;
    const tick = () => setCountdown(formatCountdown(data.expires_at));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [data?.expires_at]);

  if (!fetchEnabled || loading) return null;
  if (!data?.events_enabled || !data?.event || data.event.id === 'none') return null;
  if (dismissed) return null;

  const names = data.active_event_names || [];
  const title = names.length > 0 ? names.join(' + ') : (data.event.name || 'Game event');
  const body = countdown ? `Changes in ${countdown}` : '';

  const onDismiss = () => {
    if (!eventDismissSig) return;
    try {
      localStorage.setItem(eventDismissSig, '1');
    } catch {
      /* ignore */
    }
    setDismissTick((t) => t + 1);
  };

  return (
    <div
      className={`mb-3 rounded-md overflow-hidden border border-primary/35 ${styles.panel} bg-primary/[0.07]`}
      role="status"
      aria-label="Game event"
    >
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="flex items-start gap-2 px-3 py-2">
        <Zap size={16} className="text-primary shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-heading font-bold text-primary uppercase tracking-[0.12em]">{title}</p>
          {body && <p className="text-[10px] font-heading text-foreground/70 leading-snug">{body}</p>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-1 rounded hover:bg-primary/15 text-mutedForeground hover:text-foreground transition-colors"
          aria-label="Dismiss event banner"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
