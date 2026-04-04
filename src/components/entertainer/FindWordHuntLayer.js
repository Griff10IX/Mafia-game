import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';

function hashToPos(roundId, pathname) {
  const s = `${roundId}:${pathname || ''}`;
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  const u = Math.abs(h);
  const top = 10 + (u % 5800) / 100;
  const left = 5 + ((u >> 10) % 7000) / 100;
  return { top: Math.min(top, 72), left: Math.min(left, 78) };
}

/**
 * Shows the find-word token on any authenticated page (position varies by route).
 * Mounted inside Layout main content (relative parent).
 */
export default function FindWordHuntLayer() {
  const { pathname } = useLocation();
  const [state, setState] = useState(null);
  const [claiming, setClaiming] = useState(false);

  const fetchActive = useCallback(async () => {
    try {
      const res = await api.get('/forum/entertainer/find-word/active');
      const d = res.data;
      setState(d?.active ? d : { active: false });
    } catch {
      setState({ active: false });
    }
  }, []);

  useEffect(() => {
    fetchActive();
    const t = setInterval(fetchActive, 45000);
    return () => clearInterval(t);
  }, [fetchActive]);

  const pos = useMemo(
    () => (state?.round_id ? hashToPos(state.round_id, pathname) : { top: 24, left: 12 }),
    [state?.round_id, pathname],
  );

  const onClaim = async () => {
    if (!state?.round_id || claiming) return;
    setClaiming(true);
    try {
      const res = await api.post('/forum/entertainer/find-word/claim', { round_id: state.round_id });
      toast.success(res.data?.message || 'You won!');
      refreshUser();
      setState({ active: false });
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Could not claim');
      if (e.response?.status === 409) fetchActive();
    } finally {
      setClaiming(false);
    }
  };

  if (!state?.active || !state.word) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      <button
        type="button"
        onClick={onClaim}
        disabled={claiming}
        className="pointer-events-auto absolute min-h-[44px] min-w-[44px] px-2 py-2 rounded border border-primary/25 bg-background/85 text-foreground/65 font-heading text-[10px] sm:text-[11px] uppercase tracking-widest backdrop-blur-sm opacity-75 hover:opacity-100 hover:border-primary/45 transition-opacity shadow-sm"
        style={{ top: `${pos.top}%`, left: `${pos.left}%`, transform: 'translate(-50%, -50%)' }}
        title="Find the word — click to claim"
      >
        {claiming ? '…' : state.word}
      </button>
    </div>
  );
}
