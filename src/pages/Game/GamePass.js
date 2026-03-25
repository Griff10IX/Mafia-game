import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Package, ShoppingBag, Clock } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const GAME_PASS_PACKAGE_ID = 'rank_xp_pass_499';

// Must stay in sync with backend `routers/kill/armoury.py` (RANK_XP_PASS_REWARD_TIERS).
// We only display; activation/entitlement is still handled by the existing rank_xp_pass flow.
const GAME_PASS_REWARD_TIERS = [
  { threshold: 2000, rewards: { money: 25_000_000 } },
  { threshold: 4000, rewards: { bullets: 2_500 } },
  { threshold: 8000, rewards: { xp_crimes_tokens: 2, xp_gta_tokens: 2 } },
  { threshold: 10_000, rewards: { points: 50 } },
  { threshold: 12_000, rewards: { respect_points: 50 } },
  { threshold: 14_000, rewards: { melt_tokens: 2 } },
  { threshold: 16_000, rewards: { jailbust_tokens: 2 } },
  { threshold: 18_000, rewards: { travel_tokens: 1 } },
  { threshold: 20_000, rewards: { properties_tokens: 1 } },
];

const REWARD_DISPLAY_ORDER = [
  'money',
  'bullets',
  'xp_crimes_tokens',
  'xp_gta_tokens',
  'points',
  'respect_points',
  'melt_tokens',
  'jailbust_tokens',
  'travel_tokens',
  'properties_tokens',
];

const TOKEN_REWARD_NAMES = {
  xp_crimes_tokens: 'Crimes XP Token',
  xp_gta_tokens: 'GTA XP Token',
  melt_tokens: 'Melt Token',
  jailbust_tokens: 'Jailbust Token',
  travel_tokens: 'Travel Token',
  properties_tokens: 'Properties Token',
};

function formatTierRewardItem(key, value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (key === 'money') return `$${n.toLocaleString()} cash`;
  if (key === 'bullets') return `${n.toLocaleString()} bullets`;
  if (key === 'points') return `${n.toLocaleString()} points`;
  if (key === 'respect_points') return `${n.toLocaleString()} respect`;
  const tokenName = TOKEN_REWARD_NAMES[key] || key;
  return `${n.toLocaleString()}x ${tokenName}`;
}

function TierRewards({ rewards }) {
  return (
    <div className="space-y-1">
      {REWARD_DISPLAY_ORDER.map((k) => {
        const v = rewards?.[k];
        const text = formatTierRewardItem(k, v);
        if (!text) return null;
        return (
          <div key={k} className="text-[9px] text-zinc-300 font-heading">
            {text}
          </div>
        );
      })}
    </div>
  );
}

const LoadingSpinner = () => (
  <div className={`${styles.pageContent} p-4 mobile-page-root`}>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
      <Package size={24} className="text-primary/50 animate-pulse" />
      <span className="text-primary text-[10px] font-heading uppercase tracking-wider">Loading game pass…</span>
    </div>
  </div>
);

export default function GamePass() {
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [user, setUser] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const userRes = await api.get('/auth/me');
      setUser(userRes.data);
    } catch {
      toast.error('Failed to load data');
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const nowTs = Date.now();
  const passTokensHeld = Number(user?.rank_xp_pass_tokens ?? 0);
  const passBonusUntil = user?.rank_xp_pass_bonus_until ? new Date(user.rank_xp_pass_bonus_until) : null;
  const passIsActive = !!(passBonusUntil && passBonusUntil.getTime() > nowTs);
  const passExpiryUntil = user?.rank_xp_pass_token_expires_at ? new Date(user.rank_xp_pass_token_expires_at) : null;
  const passIsUnactivatedValid = passTokensHeld > 0 && !!(passExpiryUntil && passExpiryUntil.getTime() > nowTs);
  const passIsUnactivatedExpired = passTokensHeld > 0 && !!(passExpiryUntil && passExpiryUntil.getTime() <= nowTs);

  const handlePurchase = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.post('/payments/checkout', {
        package_id: GAME_PASS_PACKAGE_ID,
        origin_url: window.location.origin + '/game-pass',
      });
      window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const checkPaymentStatus = async (sessionId, attempt = 0) => {
    if (attempt >= 5) {
      toast.error('Payment verification timed out.');
      setCheckingPayment(false);
      window.history.replaceState({}, '', '/game-pass');
      return;
    }
    setCheckingPayment(true);
    try {
      const res = await api.get(`/payments/status/${sessionId}`);
      if (res.data.payment_status === 'paid') {
        const pts = Number(res.data.points_added || 0);
        if (pts === 0) toast.success('Game Pass purchased — token delivered. Activate in My Inventory.');
        else toast.success(`${pts} points added.`);

        refreshUser();
        await fetchData();
      } else if (res.data.status === 'expired' || res.data.payment_status === 'expired') {
        toast.error('Session expired.');
      } else if (res.data.payment_status === 'unpaid') {
        toast.info('No payment was completed.');
      } else {
        setTimeout(() => checkPaymentStatus(sessionId, attempt + 1), 2000);
        return;
      }

      window.history.replaceState({}, '', '/game-pass');
      setCheckingPayment(false);
    } catch {
      toast.error('Error checking payment');
      setCheckingPayment(false);
    }
  };

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sessionId = sp.get('session_id');
    if (!sessionId) return;
    checkPaymentStatus(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || user == null) {
    // Keep the full spinner when user is unknown; avoid flashing content while redirecting.
    return <LoadingSpinner />;
  }

  return (
    <div
      className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}
      data-testid="game-pass-page"
      data-page="game-pass"
    >
      {checkingPayment ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
          <ShoppingBag size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Verifying payment…</span>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto space-y-4">
          <div className={`relative rounded-lg border border-primary/20 overflow-hidden bg-primary/5`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">
                Game Pass (£4.99)
              </span>
              <Package className="text-primary shrink-0" size={14} />
            </div>
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-zinc-400 font-heading">
                Purchase grants an unactivated Game Pass token. Activate it in{' '}
                <span className="text-primary font-bold">
                  <Link to="/account/inventory">My Inventory</Link>
                </span>{' '}
                to start 24h bonuses.
              </p>

              {passIsUnactivatedValid && passExpiryUntil && (
                <p className="text-[10px] text-primary font-heading">
                  Token ready. Expires {passExpiryUntil?.toLocaleDateString('en-GB')}.
                </p>
              )}

              {passIsUnactivatedExpired && (
                <p className="text-[10px] text-amber-400 font-heading">Previous token expired — you can buy again.</p>
              )}

              {passIsActive && passBonusUntil && (
                <p className="text-[10px] text-emerald-400 font-heading">
                  24h bonus active until {passBonusUntil?.toLocaleString('en-GB')}.
                </p>
              )}

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <button
                  type="button"
                  onClick={handlePurchase}
                  disabled={!user || loading || passIsUnactivatedValid}
                  className="flex-1 w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                >
                  {loading ? '...' : passIsUnactivatedValid ? 'Token available (activate to extend)' : 'Buy for £4.99'}
                </button>
                <Link
                  to="/account/inventory"
                  className="flex items-center justify-center min-h-[44px] px-3 rounded-md text-[10px] font-heading font-bold border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 gap-1.5"
                >
                  <Clock size={14} className="shrink-0" />
                  Activate
                </Link>
              </div>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          <div className="space-y-2">
            <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">
              What you get on activation
            </h2>
            <p className="text-[9px] text-zinc-500 font-heading italic max-w-3xl">
              Rewards are based on your rank points at purchase time, and are granted when you activate the Game Pass token.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {GAME_PASS_REWARD_TIERS.map((tier) => (
                <div key={tier.threshold} className="relative rounded-lg border border-primary/20 bg-zinc-900/30 overflow-hidden">
                  <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                  <div className="px-3 py-2.5">
                    <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
                      Tier {tier.threshold.toLocaleString()}+
                    </div>
                    <TierRewards rewards={tier.rewards} />
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[9px] text-zinc-500 font-heading italic">
              You also get the 24h Rank-XP multiplier window once activated.
            </div>
          </div>

          <div className="text-[9px] text-zinc-500 font-heading italic">
            Your pass uses the existing activation token entitlement (`rank_xp_pass`) and will remain compatible with prior purchases.
          </div>
        </div>
      )}
    </div>
  );
}

