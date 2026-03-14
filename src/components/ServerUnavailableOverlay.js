import { useState, useEffect, useRef } from 'react';

const REFRESH_SECONDS = 5;

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

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95"
      style={{ fontFamily: 'var(--font-heading, system-ui)' }}
    >
      <div className="text-center max-w-sm mx-6 p-6 rounded-lg border border-amber-500/40 bg-amber-950/30">
        <p className="text-amber-200 text-base font-semibold mb-2">
          The server has been restarted
        </p>
        <p className="text-amber-200/80 text-sm mb-4">
          Try again in {countdown} second{countdown !== 1 ? 's' : ''}. The page will refresh automatically.
        </p>
        <button
          type="button"
          onClick={refresh}
          className="px-4 py-2 rounded border border-amber-500/60 bg-amber-600/30 text-amber-100 font-bold uppercase tracking-wider hover:bg-amber-600/50 transition-colors"
        >
          Refresh now
        </button>
      </div>
    </div>
  );
}
