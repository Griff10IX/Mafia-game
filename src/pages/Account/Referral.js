import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Copy, Crosshair, DollarSign, Car, Building2, BarChart3, Link2 } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const REF_STYLES = `
  @keyframes ref-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .ref-fade-in { animation: ref-fade-in 0.4s ease-out both; }
`;

function formatMoney(n) {
  return `$${Number(n).toLocaleString()}`;
}

const StatCard = ({ label, value, valueColor = 'text-foreground', icon: Icon }) => (
  <div className="rounded bg-zinc-800/50 border border-zinc-700/40 p-2 sm:p-3 text-center">
    <div className={`text-base sm:text-lg font-heading font-bold ${valueColor}`}>{value}</div>
    <div className="text-[9px] sm:text-[10px] font-heading text-zinc-400 uppercase tracking-wider flex items-center justify-center gap-1 mt-0.5">
      {Icon && <Icon size={10} className="sm:w-3 sm:h-3" />}
      {label}
    </div>
  </div>
);

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
        <style>{REF_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-zinc-300">
          <UserPlus size={28} className="text-primary/60 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-[9px] sm:text-[10px] font-heading uppercase tracking-[0.3em]">Loading…</span>
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
  const hasAnyEarnings =
    (earnings.melt_bullets || 0) > 0 ||
    (earnings.crime_profit || 0) > 0 ||
    (earnings.oc_profit || 0) > 0 ||
    (earnings.garage_scrap || 0) > 0;

  const cardClass = 'relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 ref-fade-in';
  const cardHeaderClass = 'px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20';
  const cardTitleClass = 'text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5';

  return (
    <div className={styles.pageContent}>
      <style>{REF_STYLES}</style>
      <div className="max-w-2xl mx-auto space-y-4 p-4">
        <div className="flex items-center gap-2 border-b border-zinc-700/50 pb-2">
          <UserPlus size={20} className="text-amber-500 shrink-0" />
          <h1 className="text-sm sm:text-base font-heading font-bold text-zinc-100">Referral</h1>
        </div>

        {/* Your link */}
        <div className={cardClass} style={{ animationDelay: '0.05s' }}>
          <div className={cardHeaderClass}>
            <h2 className={cardTitleClass}>
              <Link2 size={14} className="sm:w-4 sm:h-4" />
              Your referral link
            </h2>
          </div>
          <div className="p-2.5 sm:p-3 space-y-2">
            <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
              When someone signs up with this link, they&apos;re linked as referred by you. You earn rewards when they play (game-paid, not taken from them).
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                readOnly
                value={referralUrl}
                className="flex-1 min-w-0 px-2.5 py-2 rounded bg-zinc-800/50 border border-zinc-700/40 text-foreground text-[11px] sm:text-sm font-mono"
              />
              <button
                type="button"
                onClick={copyLink}
                className="px-3 py-2 rounded-md bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-[10px] sm:text-xs hover:bg-primary/30 flex items-center gap-1.5"
              >
                <Copy size={12} className="sm:w-3.5 sm:h-3.5" /> Copy link
              </button>
            </div>
          </div>
        </div>

        {/* Referred by + signup bonus */}
        {(data?.referred_by_username || data?.signup_bonus) && (
          <div className={cardClass} style={{ animationDelay: '0.1s' }}>
            <div className={cardHeaderClass}>
              <h2 className={cardTitleClass}>
                <UserPlus size={14} className="sm:w-4 sm:h-4" />
                Your referrer
              </h2>
            </div>
            <div className="p-2.5 sm:p-3 space-y-1">
              {data.referred_by_username && (
                <p className="text-[10px] sm:text-xs font-heading text-zinc-300">
                  Referred by: <span className="font-semibold text-foreground">{data.referred_by_username}</span>
                </p>
              )}
              {data.signup_bonus && (
                <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">{data.signup_bonus}</p>
              )}
            </div>
          </div>
        )}

        {/* What you earn */}
        <div className={cardClass} style={{ animationDelay: '0.15s' }}>
          <div className={cardHeaderClass}>
            <h2 className={cardTitleClass}>
              <DollarSign size={14} className="sm:w-4 sm:h-4" />
              When someone uses your link you earn
            </h2>
          </div>
          <div className="p-2.5 sm:p-3">
            <ul className="text-[9px] sm:text-[10px] text-zinc-400 font-heading space-y-1 list-disc list-inside">
              <li>10% of their bullets from melting cars</li>
              <li>5% of their crime profit (cash)</li>
              <li>5% of their OC heist profit (cash)</li>
              <li>5% of their garage scrap profit (cash)</li>
            </ul>
          </div>
        </div>

        {/* Your earnings so far — same style as Auto Rank Stats */}
        <div className={cardClass} style={{ animationDelay: '0.2s' }}>
          <div className={cardHeaderClass}>
            <h2 className={cardTitleClass}>
              <BarChart3 size={14} className="sm:w-4 sm:h-4" />
              Your earnings
            </h2>
          </div>
          <div className="p-2.5 sm:p-3 space-y-3">
            {!hasAnyEarnings ? (
              <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">No referral earnings yet. Share your link to start earning.</p>
            ) : (
              <>
                <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">Lifetime totals from referred users</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatCard
                    label="Melt bullets"
                    value={Number(earnings.melt_bullets || 0).toLocaleString()}
                    valueColor="text-amber-400"
                    icon={Crosshair}
                  />
                  <StatCard label="Crime profit" value={formatMoney(earnings.crime_profit || 0)} valueColor="text-emerald-400" icon={DollarSign} />
                  <StatCard label="OC profit" value={formatMoney(earnings.oc_profit || 0)} valueColor="text-emerald-400" icon={Building2} />
                  <StatCard label="Garage scrap" value={formatMoney(earnings.garage_scrap || 0)} valueColor="text-emerald-400" icon={Car} />
                </div>
              </>
            )}
          </div>
        </div>

        <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading">
          <Link to="/account/profile" className="text-primary underline hover:no-underline">Edit Profile</Link> also has a short referral section.
        </p>
      </div>
    </div>
  );
}
