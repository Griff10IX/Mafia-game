import { useState, useEffect, useRef } from 'react';

const REFRESH_SECONDS = 30;

export default function ServerUnavailableOverlay() {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const lastShownRef = useRef(0);
  const DEBOUNCE_MS = 3000;

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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95"
      style={{ fontFamily: 'var(--font-heading, system-ui)' }}
    >
      <div className="text-center max-w-sm mx-6 p-6 rounded-xl border-2 border-amber-500/60 bg-amber-950/80 shadow-2xl shadow-amber-950/50 ring-2 ring-amber-400/20">
        <p className="text-amber-100 text-lg font-bold mb-2">
          Server unavailable
        </p>
        <p className="text-amber-200/90 text-sm mb-4">
          Try again in {countdown} second{countdown !== 1 ? 's' : ''}. The page will refresh automatically.
        </p>
        <button
          type="button"
          onClick={refresh}
          className="px-5 py-2.5 rounded-lg border-2 border-amber-500 bg-amber-600/50 text-amber-50 font-bold uppercase tracking-wider hover:bg-amber-600 transition-colors"
        >
          Refresh now
        </button>
      </div>
    </div>
  );
}
