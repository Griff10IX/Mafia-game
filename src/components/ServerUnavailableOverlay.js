import { useState, useEffect, useRef } from 'react';
import styles from '../styles/noir.module.css';

export default function ServerUnavailableOverlay() {
  const [visible, setVisible] = useState(false);
  const [meta, setMeta] = useState(null);
  const lastShownRef = useRef(0);
  const DEBOUNCE_MS = 8000; // Avoid re-showing overlay when many requests fail in quick succession

  useEffect(() => {
    const handler = (event) => {
      const now = Date.now();
      if (visible || now - lastShownRef.current < DEBOUNCE_MS) return;
      lastShownRef.current = now;
      setMeta(event?.detail || null);
      setVisible(true);
    };
    window.addEventListener('app:server-unavailable', handler);
    return () => {
      window.removeEventListener('app:server-unavailable', handler);
    };
  }, [visible]);

  const refresh = () => window.location.reload();
  const dismiss = () => setVisible(false);

  const statusLabel = meta?.status ? `Code ${meta.status}` : 'Code unknown';
  const endpointLabel = meta?.url ? `${meta?.method || 'GET'} ${meta.url}` : 'Endpoint unknown';

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        fontFamily: 'var(--font-heading, system-ui)',
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
      }}
    >
      <div
        className={`${styles.panel} text-center max-w-sm mx-6 p-6 rounded-xl border border-primary/30 shadow-2xl`}
        style={{
          boxShadow: '0 0 0 1px rgba(var(--noir-primary-rgb), 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        <p className={`${styles.textGold} text-lg font-heading font-bold mb-2 uppercase tracking-wider`}>
          Server unavailable
        </p>
        <p className={`${styles.textMuted} text-sm mb-4`}>
          We hit repeated connection errors. You can retry now.
        </p>
        <p className={`${styles.textMuted} text-[11px] mb-4 opacity-80 break-all`}>
          {statusLabel} · {endpointLabel}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="px-4 py-2.5 rounded-lg border border-primary/30 text-mutedForeground font-heading font-bold uppercase tracking-wider hover:border-primary/50 hover:text-foreground transition-colors"
          >
            Keep playing
          </button>
          <button
            type="button"
            onClick={refresh}
            className={`${styles.btnPrimary} px-5 py-2.5 font-heading font-bold uppercase tracking-wider transition-opacity hover:opacity-90`}
          >
            Refresh now
          </button>
        </div>
      </div>
    </div>
  );
}
