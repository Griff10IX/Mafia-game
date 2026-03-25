import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../utils/api';

const RULES_PREVIEW = [
  'No bots, scripts, macros, or third-party tools that perform gameplay actions for you.',
  'Auto refresh and screen recording are allowed; custom coded automation is not.',
  'One person, one account (unless staff gave written approval). No account sharing.',
  'No account piloting, shared logins, or handing your account to another player.',
  'No alt coordination, boosting, funneling assets, or using linked accounts for advantage.',
  'Do not assist users who are BOS/site banned in returning to the game.',
  'Do not trade, loan, hold, or move assets on behalf of BOS/site banned users.',
  'No ban evasion by using another account, device, VPN/proxy setup, or third party.',
  'Fraudulent or chargeback-linked assets can be removed, including indirect transfers (e.g. Quick Trade).',
  'Even if you received those assets in good faith, staff may still reverse/remove them to protect the economy.',
  'If we determine activity is fraudulent or abusive (including chargebacks), we reserve the right to reverse related game effects.',
  'No exploit abuse. Report bugs to staff immediately.',
  'No bypassing cooldowns, limits, rank gates, or intended game mechanics.',
  'No laundering of fraudulent points/cash/items through transfers, markets, or family systems.',
  'Harassment, hate speech, threats, or doxxing are not allowed in any game channels.',
  'Do not impersonate staff or make false staff claims.',
  'Do not submit false reports or make misleading claims to staff, other players, or in the forum/inbox.',
  'Appeals must be respectful and truthful; abusive appeals can lead to extra penalties.',
  'No account resale or selling “boosting” services. Any attempt to profit from cheating is prohibited.',
  'No collusion, cheating crews, or coordinated behaviour intended to manipulate outcomes or bypass safeguards.',
  'If staff request information, cooperate honestly and do not mislead them.',
  'Staff may implement anti-abuse measures (rate limits, locks, throttles). Continuing to evade may lead to further action.',
  'Do not attempt to circumvent bans, locks, or forum restrictions (including through alternate accounts).',
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
