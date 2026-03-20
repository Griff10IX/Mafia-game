import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Copy, Crosshair, DollarSign, Car, Building2, BarChart3, Link2, Wine, KeyRound, Gift } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const REF_STYLES = `
  @keyframes ref-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .ref-fade-in { animation: ref-fade-in 0.4s ease-out both; }
`;

function formatMoney(n) {
  return `$${Math.round(Number(n)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const StatCard = ({ label, value, valueColor = 'text-foreground', icon: Icon }) => (
  <div className={`${styles.surface} rounded border p-2 sm:p-3 text-center min-w-0 w-full overflow-hidden`}>
    <div
      className={`text-sm sm:text-base md:text-lg font-heading font-bold ${valueColor} leading-snug tabular-nums max-w-full [overflow-wrap:anywhere]`}
      title={typeof value === 'string' ? value : undefined}
    >
      {value}
    </div>
    <div className={`${styles.gmStatLabel} text-[9px] sm:text-[10px] font-heading uppercase tracking-wider flex items-center justify-center gap-1 mt-0.5`}>
      {Icon && <Icon size={10} className="sm:w-3 sm:h-3 shrink-0" />}
      <span className="min-w-0">{label}</span>
    </div>
  </div>
);

export default function Referral() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);

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

  const handleRedeem = async () => {
    const code = (redeemCodeInput || '').trim();
    if (!code) {
      toast.error('Enter a code');
      return;
    }
    setRedeemLoading(true);
    try {
      const res = await api.post('/account/redeem', { code });
      const granted = res.data?.granted?.length ? res.data.granted.join(', ') : 'Rewards granted';
      toast.success(`Redeemed: ${granted}`);
      setRedeemCodeInput('');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Invalid or already used code');
    } finally {
      setRedeemLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
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
      <div className={`${styles.pageContent} mobile-page-root`}>
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
    (earnings.garage_scrap || 0) > 0 ||
    (earnings.booze_profit || 0) > 0;

  const cardClass = `relative ${styles.panel} rounded-lg overflow-hidden ref-fade-in mobile-panel`;
  const cardHeaderClass = `${styles.panelHeader} px-2.5 sm:px-3 py-2`;
  const cardTitleClass = `${styles.gmTitle} text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider flex items-center gap-1.5`;

  return (
    <div className={`${styles.pageContent} mobile-page-root`}>
      <style>{REF_STYLES}</style>
      <div className="max-w-2xl mx-auto space-y-2 sm:space-y-4 px-0 sm:px-4 py-2 sm:py-4">
        <div className={`flex items-center gap-2 border-b ${styles.panelHeader} pb-2 px-2 sm:px-0`} style={{ borderBottomColor: 'var(--gm-border)' }}>
          <UserPlus size={20} className="shrink-0" style={{ color: 'var(--gm-gold)' }} />
          <h1 className={`text-sm sm:text-base font-heading font-bold ${styles.gmTitle}`}>Referral & Redeem</h1>
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
            <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>
              When someone signs up with this link, they&apos;re linked as referred by you. You earn rewards when they play (game-paid, not taken from them).
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                readOnly
                value={referralUrl}
                className={`flex-1 min-w-0 px-2.5 py-2 rounded ${styles.input} text-foreground text-[11px] sm:text-sm font-mono`}
              />
              <button
                type="button"
                onClick={copyLink}
                className={`px-3 py-2 rounded-md ${styles.btnGoldDarkText} font-heading font-bold text-[10px] sm:text-xs flex items-center gap-1.5`}
              >
                <Copy size={12} className="sm:w-3.5 sm:h-3.5" /> Copy link
              </button>
            </div>
          </div>
        </div>

        {/* Redeem a code */}
        <div className={cardClass} style={{ animationDelay: '0.06s' }}>
          <div className={cardHeaderClass}>
            <h2 className={cardTitleClass}>
              <KeyRound size={14} className="sm:w-4 sm:h-4" />
              Redeem a code
            </h2>
          </div>
          <div className="p-2.5 sm:p-3 space-y-2">
            <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>
              Enter a reward code to claim cash, points, cars, tokens, or loot pieces. Each code can only be used once per account.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={redeemCodeInput}
                onChange={(e) => setRedeemCodeInput(e.target.value)}
                placeholder="Enter code"
                className={`flex-1 min-w-0 px-2.5 py-2 rounded ${styles.input} text-foreground text-[11px] sm:text-sm font-mono`}
              />
              <button
                type="button"
                onClick={handleRedeem}
                disabled={redeemLoading}
                className={`px-3 py-2 rounded-md ${styles.btnGoldDarkText} font-heading font-bold text-[10px] sm:text-xs flex items-center gap-1.5 disabled:opacity-50`}
              >
                {redeemLoading ? '...' : 'Redeem'}
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
                <p className={`text-[10px] sm:text-xs font-heading ${styles.gmMuted}`}>
                  Referred by: <span className="font-semibold text-foreground">{data.referred_by_username}</span>
                </p>
              )}
              {data.signup_bonus && (
                <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>{data.signup_bonus}</p>
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
            <ul className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading space-y-1 list-disc list-inside`}>
              <li>10% of their bullets from melting cars</li>
              <li>5% of their crime profit (cash)</li>
              <li>5% of their OC heist profit (cash)</li>
              <li>5% of their garage scrap profit (cash)</li>
              <li>2% of their booze profit (cash)</li>
            </ul>
          </div>
        </div>

        {/* What referred users get — for referrers and referred users */}
        <div className={cardClass} style={{ animationDelay: '0.18s' }}>
          <div className={cardHeaderClass}>
            <h2 className={cardTitleClass}>
              <UserPlus size={14} className="sm:w-4 sm:h-4" />
              What referred users get
            </h2>
          </div>
          <div className="p-2.5 sm:p-3">
            <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>
              People who sign up with your link get: free premium rank bar, 500 respect, 18 tokens (non-tradeable), 2% higher crime payouts, and a slight GTA rare car boost.
            </p>
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
              <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>No referral earnings yet. Share your link to start earning.</p>
            ) : (
              <>
                <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>Lifetime totals from referred users</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <StatCard
                    label="Melt bullets"
                    value={Number(earnings.melt_bullets || 0).toLocaleString()}
                    valueColor="text-amber-400"
                    icon={Crosshair}
                  />
                  <StatCard label="Crime profit" value={formatMoney(earnings.crime_profit || 0)} valueColor="text-emerald-400" icon={DollarSign} />
                  <StatCard label="OC profit" value={formatMoney(earnings.oc_profit || 0)} valueColor="text-emerald-400" icon={Building2} />
                  <StatCard label="Garage scrap" value={formatMoney(earnings.garage_scrap || 0)} valueColor="text-emerald-400" icon={Car} />
                  <StatCard label="Booze profit" value={formatMoney(earnings.booze_profit || 0)} valueColor="text-emerald-400" icon={Wine} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* From redeemed codes — lifetime totals */}
        <div className={cardClass} style={{ animationDelay: '0.22s' }}>
          <div className={cardHeaderClass}>
            <h2 className={cardTitleClass}>
              <KeyRound size={14} className="sm:w-4 sm:h-4" />
              From redeemed codes
            </h2>
          </div>
          <div className="p-2.5 sm:p-3 space-y-3">
            <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>Lifetime totals from codes you have redeemed</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <StatCard label="Cash" value={formatMoney(data?.redeem_stats?.total_money || 0)} valueColor="text-emerald-400" icon={DollarSign} />
              <StatCard label="Points" value={Number(data?.redeem_stats?.total_points || 0).toLocaleString()} valueColor="text-primary" icon={BarChart3} />
              <StatCard label="Respect" value={Number(data?.redeem_stats?.total_respect_points || 0).toLocaleString()} valueColor="text-amber-400" icon={UserPlus} />
              <StatCard label="Loot pieces" value={Number(data?.redeem_stats?.total_loot_box_pieces || 0).toLocaleString()} valueColor="text-foreground" icon={Gift} />
              <StatCard label="Cars" value={Number(data?.redeem_stats?.total_cars || 0).toLocaleString()} valueColor="text-foreground" icon={Car} />
              <StatCard label="Tokens" value={Number(data?.redeem_stats?.total_tokens || 0).toLocaleString()} valueColor="text-foreground" icon={KeyRound} />
            </div>
          </div>
        </div>

        <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>
          <Link to="/account/profile" className="text-primary underline hover:no-underline">Edit Profile</Link> also has a short referral section.
        </p>
      </div>
    </div>
  );
}
