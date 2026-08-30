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
        background: '#0a0a0a',
        fontFamily: "'Playfair Display', Georgia, serif",
        color: '#f5f5f5',
      }}
    >
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap" />
      <div className="text-center w-full" style={{ maxWidth: 480, padding: '2rem' }}>
        <div
          style={{
            fontSize: 48,
            marginBottom: '1.5rem',
            lineHeight: 1,
            animation: 'mafia-maint-pulse 2s ease-in-out infinite',
          }}
        >
          &#9876;
        </div>
        <h1
          style={{
            color: '#d4af37',
            fontSize: '1.8rem',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            marginBottom: '0.75rem',
            fontWeight: 700,
          }}
        >
          Updating Game
        </h1>
        <div
          style={{
            width: 120,
            height: 1,
            margin: '1rem auto',
            background: 'linear-gradient(to right, transparent, #d4af37, transparent)',
          }}
        />
        <p style={{ color: '#a1a1aa', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 8 }}>
          We&apos;re pushing a fresh update to the streets.
        </p>
        <p style={{ color: '#a1a1aa', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 8 }}>
          Hang tight, the game will be back shortly.
        </p>
        <div style={{ color: '#d4af37', fontWeight: 700, fontSize: '1.1rem', marginTop: '1.5rem' }}>
          ~ 30 seconds
        </div>
        <div
          style={{
            width: 200,
            height: 4,
            background: '#333',
            borderRadius: 99,
            margin: '1.5rem auto 0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              background: 'linear-gradient(to right, #d4af37, #ca8a04)',
              borderRadius: 99,
              animation: 'mafia-maint-bar 1.5s ease-in-out infinite',
            }}
          />
        </div>
        <div
          style={{
            marginTop: '2.5rem',
            color: '#555',
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          The Commission will return
        </div>
        <p style={{ marginTop: '1.25rem', color: '#666', fontSize: '0.75rem' }}>
          This page will automatically refresh in 5 seconds...
        </p>
        <style>{`
          @keyframes mafia-maint-pulse {
            0%, 100% { opacity: 0.6; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.05); }
          }
          @keyframes mafia-maint-bar {
            0% { width: 0%; margin-left: 0; }
            50% { width: 40%; margin-left: 30%; }
            100% { width: 0%; margin-left: 100%; }
          }
          @media (prefers-reduced-motion: reduce) {
            * { animation: none !important; }
          }
        `}</style>
      </div>
    </div>
  );
}
