import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Copy, Crosshair, DollarSign, Car, Building2, BarChart3, Link2, Wine, KeyRound, Gift, RefreshCw } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const REF_CACHE_KEY = 'mafia_account_referral_v1';
const REF_FETCH_TIMEOUT_MS = 25_000;

/** Reject corrupt sessionStorage so we never stick on Loading with a silent refresh loop. */
function isValidReferralCache(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const d = entry.data;
  if (d == null || typeof d !== 'object' || Array.isArray(d)) return false;
  if (typeof d.username !== 'string') return false;
  if (!d.earnings || typeof d.earnings !== 'object' || Array.isArray(d.earnings)) return false;
  if (!d.redeem_stats || typeof d.redeem_stats !== 'object' || Array.isArray(d.redeem_stats)) return false;
  return true;
}

const REF_STYLES = `
  @keyframes ref-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .ref-fade-in { animation: ref-fade-in 0.4s ease-out both; }
`;

function formatMoney(n) {
  return `$${Math.round(Number(n)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Fits tight stat tiles (matches Layout sidebar compact money). */
function formatMoneyCompact(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1).replace(/\.0$/, '')}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `$${Math.trunc(num).toLocaleString()}`;
}

const StatCard = ({ label, value, title, valueColor = 'text-foreground', icon: Icon }) => (
  <div className={`${styles.surface} rounded border p-2 sm:p-3 text-center min-w-0 w-full overflow-hidden`}>
    <div
      className={`text-sm sm:text-base md:text-lg font-heading font-bold ${valueColor} leading-snug tabular-nums w-full min-w-0 max-w-full whitespace-nowrap overflow-hidden text-ellipsis`}
      title={title !== undefined && title !== '' ? title : typeof value === 'string' ? value : undefined}
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
  const initialRef = readSessionJson(REF_CACHE_KEY);
  const cacheOk = isValidReferralCache(initialRef);
  const [data, setData] = useState(() => (cacheOk ? initialRef.data : null));
  const [loading, setLoading] = useState(() => !cacheOk);
  const [refreshing, setRefreshing] = useState(false);
  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const intervalRef = useRef(null);
  const fetchInFlightRef = useRef(false);

  const fetchData = useCallback(async (mode = 'load') => {
    if (mode === 'silent' && fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    if (mode === 'load') setLoading(true);
    if (mode === 'manual') setRefreshing(true);
    const axiosOpts = { timeout: REF_FETCH_TIMEOUT_MS };
    try {
      const res = await api.get('/account/referral', axiosOpts);
      setData(res.data);
      writeSessionJson(REF_CACHE_KEY, { data: res.data });
    } catch (error) {
      const canceled = error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';
      if (canceled) return;
      if (mode === 'load') {
        const msg =
          error?.code === 'ECONNABORTED'
            ? 'Referral data timed out. Check your connection and tap refresh.'
            : getApiErrorMessage(error) || 'Failed to load referral data';
        toast.error(msg);
      }
    } finally {
      fetchInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const c = readSessionJson(REF_CACHE_KEY);
    fetchData(isValidReferralCache(c) ? 'silent' : 'load');
  }, [fetchData]);

  useEffect(() => {
    intervalRef.current = setInterval(() => fetchData('silent'), 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

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
      const res = await api.post('/account/redeem', { code }, { timeout: REF_FETCH_TIMEOUT_MS });
      const granted = res.data?.granted?.length ? res.data.granted.join(', ') : 'Rewards granted';
      toast.success(`Redeemed: ${granted}`);
      setRedeemCodeInput('');
      await fetchData('manual');
      refreshUser();
    } catch (err) {
      const msg =
        err?.code === 'ECONNABORTED'
          ? 'Redeem request timed out. Try again.'
          : err.response?.data?.detail || 'Could not redeem that code';
      toast.error(msg);
    } finally {
      setRedeemLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <UserPlus size={22} className="text-primary/40 animate-pulse" />
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
          <span className="text-primary text-[9px] font-heading uppercase tracking-wider">Loading…</span>
        </div>
      </div>
    );
  }

  const earnings = data?.earnings || {};
  const weeklyPoints = data?.weekly_points || {};

  const cardClass = `relative ${styles.panel} rounded-lg overflow-hidden ref-fade-in mobile-panel`;
  const cardHeaderClass = `${styles.panelHeader} px-2.5 sm:px-3 py-2`;
  const cardTitleClass = `${styles.gmTitle} text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider flex items-center gap-1.5`;

  return (
    <div className={`${styles.pageContent} mobile-page-root`}>
      <style>{REF_STYLES}</style>
      <div className="max-w-2xl mx-auto space-y-2 sm:space-y-4 px-0 sm:px-4 py-2 sm:py-4">
        <div className={`relative flex flex-col gap-1 border-b ${styles.panelHeader} pb-2 px-2 sm:px-0`} style={{ borderBottomColor: 'var(--gm-border)' }}>
          <div className="flex items-center gap-2 pr-10">
            <UserPlus size={20} className="shrink-0" style={{ color: 'var(--gm-gold)' }} />
            <h1 className={`text-sm sm:text-base font-heading font-bold ${styles.gmTitle}`}>Referral & Redeem</h1>
          </div>
          <button
            type="button"
            onClick={() => fetchData('manual')}
            disabled={refreshing}
            className={`absolute top-0 right-0 sm:right-0 p-1.5 rounded-sm transition-colors ${styles.surface} ${styles.raisedHover} border border-primary/20`}
            title="Refresh"
          >
            <RefreshCw size={14} className={`text-primary ${refreshing ? 'animate-spin' : ''}`} />
          </button>
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
        {(data?.referred_by_username || (Array.isArray(data?.referred_by_usernames) && data.referred_by_usernames.length) || data?.signup_bonus) && (
          <div className={cardClass} style={{ animationDelay: '0.1s' }}>
            <div className={cardHeaderClass}>
              <h2 className={cardTitleClass}>
                <UserPlus size={14} className="sm:w-4 sm:h-4" />
                {(Array.isArray(data?.referred_by_usernames) && data.referred_by_usernames.length > 1) ? 'Your referrers' : 'Your referrer'}
              </h2>
            </div>
            <div className="p-2.5 sm:p-3 space-y-1">
              {(Array.isArray(data?.referred_by_usernames) && data.referred_by_usernames.length > 0) ? (
                data.referred_by_usernames.length === 1 ? (
                  <p className={`text-[10px] sm:text-xs font-heading ${styles.gmMuted}`}>
                    Referred by: <span className="font-semibold text-foreground">{data.referred_by_usernames[0]}</span>
                  </p>
                ) : (
                  <div className={`text-[10px] sm:text-xs font-heading ${styles.gmMuted}`}>
                    <span className="block mb-1">Referred by:</span>
                    <ul className="list-disc list-inside text-foreground font-semibold space-y-0.5">
                      {data.referred_by_usernames.map((name, i) => (
                        <li key={`${name}-${i}`}>{name}</li>
                      ))}
                    </ul>
                  </div>
                )
              ) : data.referred_by_username ? (
                <p className={`text-[10px] sm:text-xs font-heading ${styles.gmMuted}`}>
                  Referred by: <span className="font-semibold text-foreground">{data.referred_by_username}</span>
                </p>
              ) : null}
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
              <li>10% of their crime profit (cash)</li>
              <li>10% of their OC heist profit (cash)</li>
              <li>10% of their garage scrap profit (cash)</li>
              <li>10% of their booze profit (cash)</li>
              <li>1,000 points per week for each referred player who is alive, email verified, and online 5+ days that week (max 3,000 points/week from this bonus)</li>
            </ul>
            <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading mt-2`}>
              Referrals must verify their email before crimes, OC, GTA, booze runs, and weekly point bonuses count toward your totals.
            </p>
          </div>
        </div>

        {/* Weekly referral points */}
        {weeklyPoints?.week_start && (
          <div className={cardClass} style={{ animationDelay: '0.17s' }}>
            <div className={cardHeaderClass}>
              <h2 className={cardTitleClass}>
                <BarChart3 size={14} className="sm:w-4 sm:h-4" />
                Weekly referral points
              </h2>
            </div>
            <div className="p-2.5 sm:p-3 space-y-2">
              <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>
                You and each qualifying referred player earn 1,000 points per London week when they are alive, verified, and online at least {weeklyPoints.min_active_days_required ?? 5} days. Capped at {Number(weeklyPoints.weekly_cap || 3000).toLocaleString()} points per week from this bonus.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatCard
                  label="Active days"
                  value={`${Number(weeklyPoints.active_days_this_week || 0)}/${weeklyPoints.min_active_days_required ?? 5}`}
                  valueColor="text-primary"
                  icon={BarChart3}
                />
                <StatCard
                  label="This week"
                  value={Number(weeklyPoints.earned_this_week || 0).toLocaleString()}
                  valueColor="text-primary"
                  icon={Gift}
                />
                <StatCard
                  label="Cap left"
                  value={Number(weeklyPoints.cap_remaining ?? 0).toLocaleString()}
                  valueColor="text-amber-400"
                  icon={KeyRound}
                />
                <StatCard
                  label="Referee status"
                  value={weeklyPoints.referee_qualifies ? 'Qualifies' : 'Not yet'}
                  valueColor={weeklyPoints.referee_qualifies ? 'text-emerald-400' : 'text-foreground'}
                  icon={UserPlus}
                />
              </div>
            </div>
          </div>
        )}

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
              People who sign up with your link get: free premium rank bar, 500 respect, 18 tokens (non-tradeable), 10% higher crime payouts, a 10% GTA rare car boost, and 1,000 points each week they stay alive, verified, and online 5+ days.
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
            <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>
              Lifetime totals from referred users (cash, bullets, and weekly point bonuses are added to your account when they qualify).
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <StatCard
                label="Weekly points"
                value={Number(earnings.weekly_points || 0).toLocaleString()}
                valueColor="text-primary"
                icon={BarChart3}
              />
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
            {(Number(earnings.weekly_points || 0) + Number(earnings.melt_bullets || 0) + Number(earnings.crime_profit || 0) + Number(earnings.oc_profit || 0) + Number(earnings.garage_scrap || 0) + Number(earnings.booze_profit || 0)) === 0 && (
              <p className={`text-[9px] sm:text-[10px] ${styles.gmMuted} font-heading`}>
                All zero so far — earnings appear here once referrals verify email and earn from the activities above.
              </p>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <StatCard label="Cash" value={formatMoneyCompact(data?.redeem_stats?.total_money || 0)} title={formatMoney(data?.redeem_stats?.total_money || 0)} valueColor="text-emerald-400" icon={DollarSign} />
              <StatCard label="Points" value={Number(data?.redeem_stats?.total_points || 0).toLocaleString()} valueColor="text-primary" icon={BarChart3} />
              <StatCard label="Respect" value={Number(data?.redeem_stats?.total_respect_points || 0).toLocaleString()} valueColor="text-amber-400" icon={UserPlus} />
              <StatCard label="Loot pieces" value={Number(data?.redeem_stats?.total_loot_box_pieces || 0).toLocaleString()} valueColor="text-foreground" icon={Gift} />
              <StatCard label="Bullets" value={Number(data?.redeem_stats?.total_bullets || 0).toLocaleString()} valueColor="text-red-400" icon={Crosshair} />
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
