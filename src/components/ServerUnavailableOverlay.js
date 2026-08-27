import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { setServerMaintenanceOverlayActive } from '../utils/api';

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

  useEffect(() => {
    const handler = () => {
      const now = Date.now();
      if (visible || now - lastShownRef.current < 400) return;
      lastShownRef.current = now;
      setServerMaintenanceOverlayActive(true);
      try {
        toast.dismiss();
      } catch (_) { /* ignore */ }
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
    const id = setInterval(tick, 5000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-5"
      style={{
        zIndex: 2147483646,
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)',
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      }}
    >
      <div
        className="text-center max-w-xl w-full px-8 py-14 rounded-[20px]"
        style={{
          background: 'rgba(26, 26, 26, 0.8)',
          border: '2px solid #d4af37',
          boxShadow: '0 20px 60px rgba(212, 175, 55, 0.3)',
        }}
      >
        <div
          style={{
            fontSize: 80,
            marginBottom: 24,
            lineHeight: 1,
            animation: 'mafia-maint-pulse 2s ease-in-out infinite',
          }}
        >
          🛠️
        </div>
        <h1
          style={{
            fontSize: 40,
            color: '#d4af37',
            marginBottom: 16,
            textShadow: '0 0 20px rgba(212, 175, 55, 0.5)',
            fontWeight: 700,
          }}
        >
          Under Maintenance
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: '#cccccc', marginBottom: 12 }}>
          Mafia Wars is currently being updated with new features and improvements.
        </p>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: '#cccccc', marginBottom: 24 }}>
          We&apos;ll be back online shortly. Thank you for your patience!
        </p>
        <div
          style={{
            width: 50,
            height: 50,
            margin: '0 auto 24px',
            border: '4px solid rgba(212, 175, 55, 0.2)',
            borderTop: '4px solid #d4af37',
            borderRadius: '50%',
            animation: 'mafia-maint-spin 1s linear infinite',
          }}
        />
        <style>{`
          @keyframes mafia-maint-spin { to { transform: rotate(360deg); } }
          @keyframes mafia-maint-pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
          }
        `}</style>
        <p style={{ fontSize: 14, color: '#888' }}>
          This page will automatically refresh in 5 seconds...
        </p>
      </div>
    </div>
  );
}
