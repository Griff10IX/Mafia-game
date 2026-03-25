import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../utils/api';

const RULES_PREVIEW = [
  'No bots, scripts, macros, or third-party tools that perform gameplay actions for you.',
  'Auto refresh and screen recording are allowed; custom coded automation is not.',
  'One person, one account (unless staff gave written approval). No account sharing.',
  'Do not assist users who are BOS/site banned in returning or moving assets.',
  'Fraudulent or chargeback-linked assets can be removed, including indirect transfers (e.g. Quick Trade).',
  'No exploit abuse. Report bugs to staff immediately.',
  'Breaking rules may result in warnings, reversals, suspension, or permanent ban.',
];

export default function RulesAccept() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.get('/auth/me');
        if (cancelled) return;
        if (me.data?.rules_accepted) {
          navigate('/account/dashboard', { replace: true });
          return;
        }
      } catch (_) {
        localStorage.removeItem('token');
        navigate('/', { replace: true });
        return;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const onAccept = async () => {
    if (!confirmed || submitting) return;
    setSubmitting(true);
    try {
      await api.post('/auth/accept-rules');
      toast.success('Rules accepted. Welcome.');
      navigate('/account/dashboard', { replace: true });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not record acceptance');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-8">
      <div className="max-w-3xl mx-auto rounded-lg border border-primary/25 bg-card/70 p-5 sm:p-7">
        <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary uppercase tracking-wide">Game Rules Acceptance</h1>
        <p className="text-sm text-mutedForeground mt-2">
          You must read and accept the rules once before accessing gameplay.
        </p>

        <div className="mt-4 rounded-md border border-primary/20 bg-background/60 p-4">
          <p className="text-[11px] font-heading uppercase tracking-[0.16em] text-primary mb-2">Key Rules</p>
          <ul className="list-disc pl-5 space-y-2 text-sm">
            {RULES_PREVIEW.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <label className="mt-5 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          <span>I have read and agree to follow the game rules.</span>
        </label>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onAccept}
            disabled={!confirmed || submitting}
            className="px-4 py-2 rounded bg-primary/20 border border-primary/40 text-primary font-heading uppercase text-[11px] disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'I Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
