import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Copy, Crosshair, DollarSign, Car, Building2 } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

function formatMoney(n) {
  return `$${Number(n).toLocaleString()}`;
}

export default function Referral() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/account/referral')
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.detail || 'Failed to load referral data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const referralUrl = typeof window !== 'undefined' && data?.username
    ? `${window.location.origin}/?ref=${encodeURIComponent(data.username)}`
    : '';

  const copyLink = () => {
    if (referralUrl && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(referralUrl).then(() => toast.success('Link copied')).catch(() => toast.error('Copy failed'));
    } else {
      toast.error('Copy not supported');
    }
  };

  if (loading) {
    return (
      <div className={styles.pageContent}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground text-sm font-heading">Loading referral...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.pageContent}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <p className="text-destructive font-heading">{error}</p>
          <Link to="/account/dashboard" className="text-primary font-heading underline">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  const earnings = data?.earnings || {};
  const totalCash = (earnings.crime_profit || 0) + (earnings.oc_profit || 0) + (earnings.garage_scrap || 0);
  const hasAnyEarnings = (earnings.melt_bullets || 0) > 0 || totalCash > 0;

  return (
    <div className={styles.pageContent}>
      <div className="max-w-2xl mx-auto space-y-6 p-4">
        <div className="flex items-center gap-2">
          <UserPlus className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-heading font-bold uppercase tracking-wider text-foreground">Referral</h1>
        </div>

        {/* Your link */}
        <div className={styles.panel} style={{ padding: '1rem', borderRadius: 8 }}>
          <h2 className="text-xs font-heading font-bold uppercase tracking-wider text-primary mb-2">Your referral link</h2>
          <p className="text-[11px] text-muted-foreground font-heading mb-2">
            When someone signs up with this link, they&apos;re linked as referred by you. You earn rewards when they play (game-paid, not taken from them).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              readOnly
              value={referralUrl}
              className="flex-1 min-w-0 px-3 py-2 rounded border border-input bg-secondary text-foreground text-sm font-mono"
            />
            <button
              type="button"
              onClick={copyLink}
              className="px-4 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-sm hover:bg-primary/30 flex items-center gap-1.5"
            >
              <Copy className="w-4 h-4" /> Copy link
            </button>
          </div>
        </div>

        {/* Referred by + signup bonus */}
        {(data?.referred_by_username || data?.signup_bonus) && (
          <div className={styles.panel} style={{ padding: '1rem', borderRadius: 8 }}>
            {data.referred_by_username && (
              <p className="text-sm text-muted-foreground font-heading mb-1">
                Referred by: <span className="text-foreground font-semibold">{data.referred_by_username}</span>
              </p>
            )}
            {data.signup_bonus && (
              <p className="text-[11px] text-muted-foreground font-heading">
                Your signup bonus: {data.signup_bonus}
              </p>
            )}
          </div>
        )}

        {/* What you earn */}
        <div className={styles.panel} style={{ padding: '1rem', borderRadius: 8 }}>
          <h2 className="text-xs font-heading font-bold uppercase tracking-wider text-primary mb-2">When someone uses your link you earn</h2>
          <ul className="text-sm text-muted-foreground font-heading space-y-1 list-disc list-inside">
            <li>10% of their bullets from melting cars</li>
            <li>5% of their crime profit (cash)</li>
            <li>5% of their OC heist profit (cash)</li>
            <li>5% of their garage scrap profit (cash)</li>
          </ul>
        </div>

        {/* Your earnings so far */}
        <div className={styles.panel} style={{ padding: '1rem', borderRadius: 8 }}>
          <h2 className="text-xs font-heading font-bold uppercase tracking-wider text-primary mb-3">Your earnings so far</h2>
          {!hasAnyEarnings ? (
            <p className="text-sm text-muted-foreground font-heading">No referral earnings yet. Share your link to start earning.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 p-3 rounded border border-border bg-secondary/50">
                <div className="p-2 rounded bg-primary/10">
                  <Crosshair className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">Melt bullets</p>
                  <p className="text-lg font-bold text-foreground">{Number(earnings.melt_bullets || 0).toLocaleString()} bullets</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded border border-border bg-secondary/50">
                <div className="p-2 rounded bg-primary/10">
                  <DollarSign className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">Crime profit</p>
                  <p className="text-lg font-bold text-foreground">{formatMoney(earnings.crime_profit || 0)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded border border-border bg-secondary/50">
                <div className="p-2 rounded bg-primary/10">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">OC profit</p>
                  <p className="text-lg font-bold text-foreground">{formatMoney(earnings.oc_profit || 0)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded border border-border bg-secondary/50">
                <div className="p-2 rounded bg-primary/10">
                  <Car className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">Garage scrap</p>
                  <p className="text-lg font-bold text-foreground">{formatMoney(earnings.garage_scrap || 0)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground font-heading">
          <Link to="/account/profile" className="text-primary underline hover:no-underline">Edit Profile</Link> also has a short referral section.
        </p>
      </div>
    </div>
  );
}
