import { useState, useEffect, useRef } from 'react';
import styles from '../styles/noir.module.css';

const REFRESH_SECONDS = 30;

export default function ServerUnavailableOverlay() {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const lastShownRef = useRef(0);
  const DEBOUNCE_MS = 8000; // Avoid re-showing overlay when many requests fail in quick succession

  useEffect(() => {
    let timerId = null;
    const handler = () => {
      const now = Date.now();
      if (visible || now - lastShownRef.current < DEBOUNCE_MS) return;
      lastShownRef.current = now;
      setVisible(true);
      setCountdown(REFRESH_SECONDS);
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            if (timerId) clearInterval(timerId);
            window.location.reload();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    };
    window.addEventListener('app:server-unavailable', handler);
    return () => {
      window.removeEventListener('app:server-unavailable', handler);
      if (timerId) clearInterval(timerId);
    };
  }, [visible]);

  const refresh = () => window.location.reload();

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
          Try again in {countdown} second{countdown !== 1 ? 's' : ''}. The page will refresh automatically.
        </p>
        <button
          type="button"
          onClick={refresh}
          className={`${styles.btnPrimary} px-5 py-2.5 font-heading font-bold uppercase tracking-wider transition-opacity hover:opacity-90`}
        >
          Refresh now
        </button>
      </div>
    </div>
  );
}
