import { useState, useEffect, useCallback } from 'react';
import { X, Zap } from 'lucide-react';
import api from '../utils/api';
import styles from '../styles/noir.module.css';

const STORAGE_PREFIX = 'active_event_banner_dismissed_v1';

function utcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function dismissStorageKey(eventId) {
  return `${STORAGE_PREFIX}_${eventId}_${utcDateString()}`;
}

export default function ActiveEventBanner({ fetchEnabled }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

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

  useEffect(() => {
    if (!data?.event?.id || data.event.id === 'none') {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(localStorage.getItem(dismissStorageKey(data.event.id)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [data?.event?.id]);

  if (!fetchEnabled || loading) return null;
  if (!data?.events_enabled || !data?.event || data.event.id === 'none') return null;
  if (dismissed) return null;

  const event = data.event;
  const title = event.name || 'Daily event';
  const body = event.message || `Today: ${title}`;

  const onDismiss = () => {
    try {
      localStorage.setItem(dismissStorageKey(event.id), '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      className={`mb-3 rounded-md overflow-hidden border border-primary/35 ${styles.panel} bg-primary/[0.07]`}
      role="status"
      aria-label="Daily game event"
    >
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="flex items-start gap-2 px-3 py-2">
        <Zap size={16} className="text-primary shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-heading font-bold text-primary uppercase tracking-[0.12em]">{title}</p>
          <p className="text-[11px] md:text-xs font-heading text-foreground/95 leading-snug line-clamp-3 md:line-clamp-none">{body}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-1 rounded hover:bg-primary/15 text-mutedForeground hover:text-foreground transition-colors"
          aria-label="Dismiss daily event banner"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
