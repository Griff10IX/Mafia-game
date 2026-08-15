import { useState, useEffect, useRef } from 'react';
import styles from '../styles/noir.module.css';

async function apiIsBack() {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    return res.status !== 502 && res.status !== 503 && res.status !== 504;
  } catch {
    return false;
  }
}

export default function ServerUnavailableOverlay() {
  const [visible, setVisible] = useState(false);
  const lastShownRef = useRef(0);
  const reloadingRef = useRef(false);
  const DEBOUNCE_MS = 8000;

  useEffect(() => {
    const handler = () => {
      const now = Date.now();
      if (visible || now - lastShownRef.current < DEBOUNCE_MS) return;
      lastShownRef.current = now;
      setVisible(true);
    };
    window.addEventListener('app:server-unavailable', handler);
    return () => {
      window.removeEventListener('app:server-unavailable', handler);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || reloadingRef.current) return;
      if (await apiIsBack()) {
        reloadingRef.current = true;
        window.location.reload();
      }
    };
    const id = setInterval(tick, 3000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        fontFamily: 'var(--font-heading, system-ui)',
        backgroundColor: '#0a0a0a',
      }}
    >
      <div
        className={`${styles.panel} text-center max-w-sm mx-6 p-6 rounded-xl border border-primary/30 shadow-2xl`}
        style={{
          boxShadow: '0 0 0 1px rgba(var(--noir-primary-rgb), 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        <p className={`${styles.textGold} text-lg font-heading font-bold mb-2 uppercase tracking-wider`}>
          Updating Game
        </p>
        <p className={`${styles.textMuted} text-sm mb-1`}>
          We&apos;re pushing a fresh update to the streets.
        </p>
        <p className={`${styles.textMuted} text-sm mb-4`}>
          Hang tight — this page will come back on its own.
        </p>
        <div className="w-48 h-1 mx-auto mb-4 rounded-full overflow-hidden" style={{ background: '#333' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: '40%',
              background: 'linear-gradient(to right, #d4af37, #ca8a04)',
              animation: 'mafia-maint-bar 1.5s ease-in-out infinite',
            }}
          />
        </div>
        <style>{`@keyframes mafia-maint-bar { 0% { width: 0%; margin-left: 0; } 50% { width: 40%; margin-left: 30%; } 100% { width: 0%; margin-left: 100%; } }`}</style>
        <p className={`${styles.textMuted} text-[11px] opacity-80`}>
          Checking every 3 seconds
        </p>
      </div>
    </div>
  );
}
