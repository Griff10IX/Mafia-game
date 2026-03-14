import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShoppingBag, Zap, Shield, Star, Car, Crosshair, VolumeX, Clock, Bot, Heart, Send, ArrowRightLeft, ChevronDown, ChevronUp } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const STORE_STYLES = `
  .store-fade-in { animation: store-fade-in 0.4s ease-out both; }
  @keyframes store-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .store-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const PACKAGES = [
  { id: 'starter', name: '2,500 pts', points: 2500, price: 4.99, popular: false },
  { id: 'bronze', name: '5,000 pts', points: 5000, price: 8.99, popular: false },
  { id: 'silver', name: '10,000 pts', points: 10000, price: 15.99, popular: true },
  { id: 'gold', name: '25,000 pts', points: 25000, price: 36.99, popular: false },
  { id: 'platinum', name: '50,000 pts', points: 50000, price: 67.99, popular: false },
  { id: 'diamond', name: '100,000 pts', points: 100000, price: 135.98, popular: false },
];

const BULLET_PACKS = [
  { bullets: 5000, cost: 100 },
  { bullets: 10000, cost: 175 },
  { bullets: 50000, cost: 775 },
  { bullets: 100000, cost: 1525 },
];
const CUSTOM_BULLETS_MAX = 250_000;

const VALID_TABS = ['points', 'sendpts', 'upgrades', 'bullets'];
const bulletCost = (bullets) => bullets < 5000 ? Math.max(1, Math.floor(bullets * 0.02)) : 100 + Math.ceil((bullets - 5000) * 75 / 5000);

const UPGRADES = [
  { id: 'health', title: 'Full Health', Icon: Heart, price: 15, path: '/store/buy-health', ownedKey: null, desc: 'Restore health to 100%', extra: (u) => ({ line: 'Health', value: `${Number(u?.health ?? 100).toFixed(0)}%` }) },
  { id: 'rank-bar', title: 'Premium Rank Bar', Icon: Star, price: 50, path: '/store/buy-rank-bar', ownedKey: 'premium_rank_bar', desc: 'Exact numbers & amounts for next rank' },
  { id: 'auto-rank', title: 'Auto Rank', Icon: Bot, price: 5000, path: '/store/buy-auto-rank', ownedKey: 'auto_rank_purchased', desc: 'Auto-commit crimes, GTA, busts, OC. Optional: set Telegram in Profile for notifications.' },
  { id: 'silencer', title: 'Silencer', Icon: VolumeX, price: 150, path: '/store/buy-silencer', ownedKey: 'has_silencer', desc: 'Fewer witness statements when you kill' },
  { id: 'anti-snitch', title: 'Anti Snitch', Icon: Shield, price: 120, path: '/store/buy-anti-snitch', ownedKey: 'anti_snitch', desc: 'Cannot be snitched on when others are in jail' },
  { id: 'oc-timer', title: 'OC Timer', Icon: Clock, price: 300, path: '/store/buy-oc-timer', ownedKey: 'oc_timer_reduced', desc: 'Heist cooldown 4h instead of 6h' },
  { id: 'crew-oc-timer', title: 'Crew OC Timer', Icon: Clock, price: 350, path: '/store/buy-crew-oc-timer', ownedKey: 'crew_oc_timer_reduced', desc: 'Family Crew OC 6h when you commit' },
  { id: 'garage', title: 'Garage Batch', Icon: Zap, price: 25, path: '/store/upgrade-garage-batch', ownedKey: null, desc: '+10 melt/scrap at once', extra: (u) => ({ line: 'Limit', value: u?.garage_batch_limit ?? 6 }) },
  { id: 'booze', title: 'Booze Capacity', Icon: ShoppingBag, price: 30, path: '/store/buy-booze-capacity', ownedKey: null, desc: '+100 capacity (max 1000)', extra: (u, cfg) => cfg && ({ line: 'Capacity', value: cfg.capacity ?? '—' }) },
];

const Tab = ({ active, onClick, children, disabled, className = '' }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`flex-1 min-w-0 min-h-[44px] py-2.5 px-3 rounded-md text-[10px] sm:text-[9px] font-heading font-bold uppercase tracking-wider transition-all border touch-manipulation ${
      active
        ? 'text-primary bg-primary/10 border-primary/20'
        : 'text-zinc-500 hover:text-zinc-300 border-transparent'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`.trim()}
  >
    {children}
  </button>
);

const StoreCard = ({ title, Icon, desc, price, respectPrice, owned, onBuy, loading, disabled, user, children }) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
    <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
      <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">{title}</span>
      {Icon && <Icon className="text-primary shrink-0" size={14} />}
    </div>
    <div className="p-2.5">
      <p className="text-[10px] text-mutedForeground font-heading mb-1.5">{desc}</p>
      {children}
      {owned ? (
        <div className="py-1.5 text-center text-[10px] font-heading font-bold text-primary uppercase">Owned</div>
      ) : (
        <button
          type="button"
          onClick={() => onBuy()}
          disabled={loading || disabled || (user && respectPrice != null && (user.points ?? 0) < price && (user.respect_points ?? 0) < respectPrice)}
          className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 mt-1 touch-manipulation"
        >
          {loading ? '...' : respectPrice != null ? `${price} pts or ${respectPrice} resp` : `${price} pts`}
        </button>
      )}
    </div>
    <div className="store-art-line text-primary mx-3" />
  </div>
);

export default function Store() {
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [user, setUser] = useState(null);
  const [boozeConfig, setBoozeConfig] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [customCarName, setCustomCarName] = useState('');
  const [activeTab, setActiveTab] = useState('upgrades');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  useEffect(() => {
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);
  const [pointsTransfers, setPointsTransfers] = useState([]);
  const [adminTransfers, setAdminTransfers] = useState([]);
  const [adminTransfersOpen, setAdminTransfersOpen] = useState(false);
  const [sendToUsername, setSendToUsername] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [customBullets, setCustomBullets] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [pointsTabLocked, setPointsTabLocked] = useState(false);
  const [pointsTabLockMessage, setPointsTabLockMessage] = useState('');
  const [paymentTransactions, setPaymentTransactions] = useState([]);
  const [preorderActive, setPreorderActive] = useState(false);
  const [preorderReleaseDate, setPreorderReleaseDate] = useState(null);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [claimingPending, setClaimingPending] = useState(false);

  const handleClaimPendingPoints = async () => {
    setClaimingPending(true);
    try {
      const res = await api.post('/payments/check-release');
      if (res.data?.released > 0) {
        toast.success(res.data?.message || 'Points released!');
        setPendingPoints(0);
        fetchData();
      } else {
        toast.info(res.data?.message || 'No points to release');
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to release points');
    } finally {
      setClaimingPending(false);
    }
  };

  const fetchPaymentTransactions = useCallback(async () => {
    try {
      const res = await api.get('/payments/my-transactions');
      setPaymentTransactions(res.data?.transactions || []);
    } catch {
      setPaymentTransactions([]);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [userRes, boozeRes, eventsRes, adminRes, locksRes, launchRes, pendingRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/booze-run/config').catch(() => ({ data: null })),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/admin/check').catch(() => ({ data: { is_admin: false } })),
        api.get('/page-locks').catch(() => ({ data: { paths: {} } })),
        api.get('/auth/launch-status').catch(() => ({ data: {} })),
        api.get('/payments/pending-points').catch(() => ({ data: { pending_points: 0 } })),
      ]);
      setUser(userRes.data);
      setBoozeConfig(boozeRes?.data || null);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
      setIsAdmin(!!adminRes.data?.is_admin);
      const paths = locksRes?.data?.paths ?? {};
      setPointsTabLocked(!!paths['/store/points']);
      setPointsTabLockMessage(paths['/store/points'] || 'Points purchase temporarily unavailable');
      setPreorderActive(!!launchRes.data?.preorder_active);
      setPreorderReleaseDate(launchRes.data?.preorder_release_date || null);
      setPendingPoints(pendingRes.data?.pending_points || 0);
      await fetchPaymentTransactions();
    } catch {
      toast.error('Failed to load data');
    }
  }, [fetchPaymentTransactions]);

  const fetchPointsTransfers = useCallback(async () => {
    try {
      const res = await api.get('/store/points-transfers');
      setPointsTransfers(res.data?.transfers || []);
    } catch {
      setPointsTransfers([]);
    }
  }, []);

  const fetchAdminTransfers = useCallback(async () => {
    try {
      const res = await api.get('/store/points-transfers/admin', { params: { limit: 500 } });
      setAdminTransfers(res.data?.transfers || []);
    } catch {
      toast.error('Failed to load admin log');
      setAdminTransfers([]);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (sessionId) checkPaymentStatus(sessionId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'sendpts') fetchPointsTransfers();
  }, [activeTab, fetchPointsTransfers]);

  const checkPaymentStatus = async (sessionId, attempt = 0) => {
    if (attempt >= 5) {
      toast.error('Payment verification timed out.');
      window.history.replaceState({}, '', '/store');
      return;
    }
    setCheckingPayment(true);
    try {
      const res = await api.get(`/payments/status/${sessionId}`);
      if (res.data.payment_status === 'paid') {
        if (res.data.preorder) {
          const releaseDate = res.data.preorder_release_date ? new Date(res.data.preorder_release_date).toLocaleDateString() : 'launch';
          toast.success(`Payment received. ${res.data.points_added} points will be credited on ${releaseDate}.`);
        } else {
          toast.success(`${res.data.points_added} points added.`);
        }
        refreshUser();
        fetchData();
        fetchPaymentTransactions();
      } else if (res.data.status === 'expired') {
        toast.error('Session expired.');
      } else {
        setTimeout(() => checkPaymentStatus(sessionId, attempt + 1), 2000);
        return;
      }
    } catch {
      toast.error('Error checking payment');
    }
    window.history.replaceState({}, '', '/store');
    setCheckingPayment(false);
  };

  const apiBuy = async (path, body, successMsg) => {
    if (loading) return;
    setLoading(true);
    try {
      await api.post(path, body || {});
      toast.success(successMsg || 'Done');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async (id) => {
    setLoading(true);
    try {
      const res = await api.post('/payments/checkout', { package_id: id, origin_url: window.location.origin + '/store' });
      window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
      setLoading(false);
    }
  };

  const handleCustomBulletsPurchase = async () => {
    const b = parseInt(String(customBullets).replace(/\D/g, ''), 10);
    if (!Number.isFinite(b) || b < 1 || b > CUSTOM_BULLETS_MAX) {
      toast.error(`Enter 1–${CUSTOM_BULLETS_MAX.toLocaleString()} bullets`);
      return;
    }
    const cost = bulletCost(b);
    const respectCost = cost * 5;
    if (user && (user.points ?? 0) < cost && (user.respect_points ?? 0) < respectCost) {
      toast.error(`Need ${cost} pts or ${respectCost} respect`);
      return;
    }
    setLoading(true);
    try {
      await api.post(`/store/buy-bullets?bullets=${b}`);
      toast.success(`Bought ${b.toLocaleString()} bullets`);
      setCustomBullets('');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (checkingPayment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <ShoppingBag size={28} className="text-primary/40 animate-pulse" />
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Verifying payment…</span>
      </div>
    );
  }

  return (
    <div className={`space-y-4 sm:space-y-6 ${styles.pageContent} px-3 sm:px-4 pb-6`} data-testid="store-page">
      <style>{STORE_STYLES}</style>
      <div className="relative store-fade-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] text-zinc-500 font-heading italic">Points, upgrades & bullets</p>
        </div>
        {user != null && (
          <span className="text-sm font-heading font-bold text-primary">
            {Number(user.points ?? 0).toLocaleString()} pts
            <span className="text-mutedForeground font-normal ml-2">· Respect: {Number(user.respect_points ?? 0).toLocaleString()}</span>
          </span>
        )}
      </div>

      {eventsEnabled && event?.name && (
        <div className="relative rounded-lg border border-primary/20 overflow-hidden">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-3 bg-primary/8 border-b border-primary/20">
            <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{event.name}</p>
            <p className="text-[10px] text-zinc-500 font-heading italic mt-0.5">{event.message}</p>
          </div>
          <div className="store-art-line text-primary mx-3" />
        </div>
      )}

      {preorderActive && (
        <div className="relative rounded-lg border border-amber-500/30 overflow-hidden bg-amber-500/5">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
          <div className="px-4 py-3">
            <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-[0.15em]">Pre-Order Mode Active</p>
            <p className="text-[10px] text-zinc-400 font-heading mt-1">
              Points purchased now will be credited on{' '}
              <span className="text-amber-400 font-bold">
                {preorderReleaseDate ? new Date(preorderReleaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'launch date'}
              </span>
            </p>
            {pendingPoints > 0 && (
              <p className="text-[10px] text-amber-400 font-heading font-bold mt-2">
                You have {pendingPoints.toLocaleString()} points pending release
              </p>
            )}
          </div>
          <div className="h-px bg-amber-500/20 mx-3" />
        </div>
      )}

      {!preorderActive && pendingPoints > 0 && (
        <div className="relative rounded-lg border border-green-500/30 overflow-hidden bg-green-500/5">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-green-500/50 to-transparent" />
          <div className="px-4 py-3">
            <p className="text-[10px] font-heading font-bold text-green-400 uppercase tracking-[0.15em]">Pending Points Ready</p>
            <p className="text-[10px] text-zinc-400 font-heading mt-1">
              You have <span className="text-green-400 font-bold">{pendingPoints.toLocaleString()}</span> points ready to be credited.
            </p>
            <button
              type="button"
              onClick={handleClaimPendingPoints}
              disabled={claimingPending}
              className="mt-2 px-3 py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30 disabled:opacity-50"
            >
              {claimingPending ? 'Releasing...' : 'Claim Pending Points'}
            </button>
          </div>
          <div className="h-px bg-green-500/20 mx-3" />
        </div>
      )}

      <div className="relative flex gap-1 p-1.5 sm:p-1 rounded-lg overflow-x-auto store-fade-in border border-primary/20 bg-primary/5 scrollbar-thin">
        <div className="h-0.5 absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-t-lg pointer-events-none" aria-hidden />
        <Tab
          active={activeTab === 'points'}
          onClick={() => { setActiveTab('points'); setSearchParams({ tab: 'points' }); }}
          disabled={pointsTabLocked}
        >Points</Tab>
        <Tab active={activeTab === 'sendpts'} onClick={() => { setActiveTab('sendpts'); setSearchParams({ tab: 'sendpts' }); }}>Send pts</Tab>
        <Tab active={activeTab === 'upgrades'} onClick={() => { setActiveTab('upgrades'); setSearchParams({ tab: 'upgrades' }); }}>Upgrades</Tab>
        <Tab active={activeTab === 'bullets'} onClick={() => { setActiveTab('bullets'); setSearchParams({ tab: 'bullets' }); }}>Bullets</Tab>
      </div>

      {activeTab === 'points' && (
        <div className="space-y-3">
          {pointsTabLocked ? (
            <div className={`${styles.panel} rounded-lg border border-primary/20 p-6 text-center`}>
              <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">{pointsTabLockMessage}</p>
              <p className="text-[9px] text-mutedForeground mt-1">Points purchase is temporarily unavailable. Upgrades, bullets, and send pts remain available.</p>
            </div>
          ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            {PACKAGES.map((pkg) => (
              <div
                key={pkg.id}
                data-testid={`package-${pkg.id}`}
                className={`relative rounded-lg border border-primary/20 overflow-hidden transition-all ${
                  pkg.popular ? 'bg-primary/5' : 'bg-zinc-900/50'
                }`}
              >
                <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="p-3 text-center">
                  <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{pkg.name}</p>
                  <p className="text-lg font-heading font-bold text-primary mt-1">{Number(pkg.points ?? 0).toLocaleString()}</p>
                  <p className="text-[10px] text-zinc-500 font-heading italic">£{pkg.price.toFixed(2)}</p>
                </div>
                <div className="px-3 pb-3">
                  <button
                    type="button"
                    onClick={() => handlePurchase(pkg.id)}
                    data-testid={`buy-package-${pkg.id}`}
                    disabled={loading}
                    className="w-full min-h-[44px] py-2.5 sm:py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                  >
                    {loading ? '...' : 'Buy'}
                  </button>
                </div>
                <div className="store-art-line text-primary mx-3" />
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {activeTab === 'sendpts' && (
        <div className="space-y-4 store-fade-in">
          <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 sm:px-4 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <Send size={14} className="text-primary shrink-0" />
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Send points to player</span>
            </div>
            <div className="p-3 sm:p-4 space-y-3">
              <input
                type="text"
                placeholder="Recipient username"
                value={sendToUsername}
                onChange={(e) => setSendToUsername(e.target.value)}
                className="w-full px-3 py-2.5 sm:py-2 text-sm sm:text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none min-h-[44px] sm:min-h-0"
              />
              <FormattedNumberInput
                value={sendAmount}
                onChange={setSendAmount}
                placeholder="Amount"
                className="w-full px-3 py-2.5 sm:py-2 text-sm sm:text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none min-h-[44px] sm:min-h-0 text-foreground font-heading"
              />
              <button
                type="button"
                onClick={async () => {
                  const to = sendToUsername.trim();
                  const amt = parseInt(String(sendAmount).replace(/\D/g, ''), 10);
                  if (!to || !Number.isFinite(amt) || amt < 1) {
                    toast.error('Enter username and amount (min 1)');
                    return;
                  }
                  setLoading(true);
                  try {
                    await api.post('/store/send-points', { to_username: to, amount: amt });
                    toast.success(`Sent ${amt.toLocaleString()} points`);
                    setSendToUsername('');
                    setSendAmount('');
                    refreshUser();
                    fetchData();
                    fetchPointsTransfers();
                  } catch (e) {
                    toast.error(e.response?.data?.detail || 'Failed to send');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading || !user || (user?.points ?? 0) < 1}
                className="w-full min-h-[44px] py-3 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
              >
                {loading ? '...' : 'Send'}
              </button>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center gap-2">
              <ArrowRightLeft size={14} className="text-primary shrink-0" />
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Last 10 points transactions</span>
            </div>
            <div className="p-3">
              {pointsTransfers.length === 0 ? (
                <p className="text-[10px] text-zinc-500 font-heading italic">No transfers yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {pointsTransfers.map((t) => (
                    <li key={t.id} className="text-[10px] font-heading flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 py-1 border-b border-zinc-800/50 last:border-0">
                      <span className="text-mutedForeground truncate min-w-0">
                        <Link to={`/profile/${encodeURIComponent(t.from_username)}`} className="text-primary hover:underline">{t.from_username}</Link>
                        {' → '}
                        <Link to={`/profile/${encodeURIComponent(t.to_username)}`} className="text-primary hover:underline">{t.to_username}</Link>
                      </span>
                      <span className="text-primary shrink-0">{Number(t.amount).toLocaleString()} pts</span>
                      {t.created_at && (
                        <span className="text-[9px] text-zinc-600 w-full shrink-0">
                          {new Date(t.created_at).toLocaleString()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          {isAdmin && (
            <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
              <button
                type="button"
                onClick={() => {
                  if (!adminTransfersOpen && adminTransfers.length === 0) fetchAdminTransfers();
                  setAdminTransfersOpen((v) => !v);
                }}
                className="w-full px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2"
              >
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Admin: last 500 transfers</span>
                {adminTransfersOpen ? <ChevronUp size={14} className="text-primary shrink-0" /> : <ChevronDown size={14} className="text-primary shrink-0" />}
              </button>
              {adminTransfersOpen && (
                <div className="p-3 max-h-80 overflow-y-auto">
                  {adminTransfers.length === 0 ? (
                    <p className="text-[10px] text-zinc-500 font-heading italic">Loading…</p>
                  ) : (
                    <ul className="space-y-1">
                      {adminTransfers.map((t) => (
                        <li key={t.id} className="text-[10px] font-heading flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 py-0.5 border-b border-zinc-800/50 last:border-0">
                          <span className="text-mutedForeground truncate min-w-0">
                            <Link to={`/profile/${encodeURIComponent(t.from_username)}`} className="text-primary hover:underline">{t.from_username}</Link>
                            {' → '}
                            <Link to={`/profile/${encodeURIComponent(t.to_username)}`} className="text-primary hover:underline">{t.to_username}</Link>
                          </span>
                          <span className="text-primary shrink-0">{Number(t.amount).toLocaleString()} pts</span>
                          {t.created_at && (
                            <span className="text-[9px] text-zinc-600 w-full shrink-0">{new Date(t.created_at).toLocaleString()}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {adminTransfers.length > 0 && (
                    <p className="text-[9px] text-zinc-600 font-heading italic mt-2">{adminTransfers.length} transfers (most recent first).</p>
                  )}
                </div>
              )}
              <div className="store-art-line text-primary mx-3" />
            </div>
          )}
        </div>
      )}

      {activeTab === 'upgrades' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
          {UPGRADES.filter((u) => {
            const owned = u.ownedKey && user?.[u.ownedKey];
            if (owned) return false;
            // Hide Garage Batch when already at max (100)
            if (u.id === 'garage' && (user?.garage_batch_limit ?? 0) >= 100) return false;
            // Hide Booze Capacity when already at max
            if (u.id === 'booze' && boozeConfig?.capacity_bonus_max != null && (user?.booze_capacity_bonus ?? 0) >= boozeConfig.capacity_bonus_max) return false;
            return true;
          }).map((u) => {
            const extra = u.extra?.(user, boozeConfig);
            const disabled = (u.id === 'booze' && boozeConfig?.capacity_bonus_max != null && (user?.booze_capacity_bonus ?? 0) >= boozeConfig.capacity_bonus_max) || (u.id === 'health' && Number(user?.health ?? 100) >= 100);
            return (
              <StoreCard
                key={u.id}
                title={u.title}
                Icon={u.Icon}
                desc={u.desc}
                price={u.price}
                respectPrice={u.price * 5}
                owned={false}
                loading={loading}
                disabled={disabled}
                user={user}
                onBuy={() => apiBuy(u.path, {}, 'Purchased')}
              >
                {extra && (
                  <p className="text-[10px] text-mutedForeground mb-1">Current: {extra.value}</p>
                )}
              </StoreCard>
            );
          })}
          {/* Custom Car — always show (can buy multiple) */}
          {(
            <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Custom Car</span>
                <Car className="text-primary shrink-0" size={14} />
              </div>
              <div className="p-2.5">
                <p className="text-[10px] text-mutedForeground font-heading mb-1.5">Named car, 20s travel, below Exclusive.</p>
                <input
                  type="text"
                  placeholder="Name (2–30 chars)"
                  value={customCarName}
                  onChange={(e) => setCustomCarName(e.target.value)}
                  maxLength={30}
                  className="w-full px-2 py-1.5 text-xs bg-zinc-900/50 border border-zinc-700/50 rounded mb-1.5 focus:border-primary/50 focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!customCarName.trim() || customCarName.trim().length < 2) {
                        toast.error('Name 2+ characters');
                        return;
                      }
                      apiBuy('/store/buy-custom-car', { car_name: customCarName.trim() }, 'Custom car purchased').then(() => setCustomCarName(''));
                    }}
                    disabled={!user || ((user.points ?? 0) < 500 && (user.respect_points ?? 0) < 2500) || !customCarName.trim()}
                    className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                  >
                    500 pts or 2500 resp
                  </button>
                </div>
              </div>
              <div className="store-art-line text-primary mx-3" />
            </div>
          )}
        </div>
      )}

      {activeTab === 'bullets' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-2">
            {BULLET_PACKS.map((pack) => {
              const respectCost = pack.cost * 5;
              return (
                <div key={pack.bullets} className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
                  <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                  <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-center gap-1.5">
                    <Crosshair size={14} className="text-primary shrink-0" />
                    <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{(pack.bullets / 1000).toFixed(0)}k bullets</span>
                  </div>
                  <div className="p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500 font-heading mb-2">{pack.cost} pts or {respectCost} resp</p>
                    <button
                      type="button"
                      onClick={() => apiBuy(`/store/buy-bullets?bullets=${pack.bullets}`, null, `Bought ${pack.bullets.toLocaleString()} bullets`)}
                      disabled={!user || ((user.points ?? 0) < pack.cost && (user.respect_points ?? 0) < respectCost)}
                      className="w-full min-h-[44px] py-2.5 sm:py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                    >
                      Buy
                    </button>
                  </div>
                  <div className="store-art-line text-primary mx-3" />
                </div>
              );
            })}
          </div>
          <div className={`relative rounded-lg border border-primary/20 overflow-hidden bg-zinc-900/50`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="p-3 text-center">
              <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Custom amount</p>
              <FormattedNumberInput
                value={customBullets}
                onChange={setCustomBullets}
                placeholder={`Up to ${CUSTOM_BULLETS_MAX.toLocaleString()}`}
                className="w-full mt-1 px-3 py-2 text-lg font-heading font-bold text-primary bg-zinc-900/80 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none text-center"
              />
              <p className="text-[10px] text-zinc-500 font-heading italic mt-1">
                {customBullets ? (
                  (() => {
                    const b = parseInt(String(customBullets).replace(/\D/g, ''), 10);
                    if (!Number.isFinite(b) || b < 1) return null;
                    if (b > CUSTOM_BULLETS_MAX) return '—';
                    const c = bulletCost(b);
                    return `${c} pts or ${c * 5} resp`;
                  })() || '—'
                ) : (
                  '—'
                )}
              </p>
            </div>
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={handleCustomBulletsPurchase}
                disabled={loading || !customBullets || (() => {
                  const b = parseInt(String(customBullets).replace(/\D/g, ''), 10);
                  return !Number.isFinite(b) || b < 1 || b > CUSTOM_BULLETS_MAX;
                })()}
                className="w-full min-h-[44px] py-2.5 sm:py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
              >
                {loading ? '...' : 'Buy'}
              </button>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>
        </div>
      )}

      <div className="relative rounded-lg border border-primary/20 overflow-hidden">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 sm:px-4 py-2.5 bg-primary/8 border-b border-primary/20">
          <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Payments</p>
        </div>
        <div className="px-3 sm:px-4 py-3 space-y-2">
          <p className="text-[10px] text-zinc-500 font-heading italic">
            Payments via Stripe. {preorderActive ? 'Pre-order points will be credited on release date.' : 'Points added after purchase.'}
          </p>
          {paymentTransactions.length > 0 ? (
            <div className="rounded border border-primary/20 bg-zinc-900/50 overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 text-[9px] font-heading font-bold text-primary uppercase tracking-wider border-b border-primary/20">
                <span>Date</span>
                <span>Package</span>
                <span className="text-right">Points</span>
                <span>Status</span>
              </div>
              {paymentTransactions.slice(0, 15).map((t, i) => {
                const statusClass = t.payment_status === 'completed' ? 'text-green-400' : t.payment_status === 'preorder_pending' ? 'text-amber-400' : 'text-zinc-400';
                const statusText = t.payment_status === 'completed' ? 'Credited' : t.payment_status === 'preorder_pending' ? 'Pre-order' : t.payment_status || 'Pending';
                return (
                  <div key={t.session_id || i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 text-[10px] font-heading border-b border-zinc-800/50 last:border-0">
                    <span className="text-mutedForeground truncate" title={t.created_at}>{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</span>
                    <span className="capitalize">{t.package_id || '—'}</span>
                    <span className="text-right font-mono">+{Number(t.points || 0).toLocaleString()}</span>
                    <span className={statusClass}>{statusText}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-zinc-600 font-heading italic">No purchases yet.</p>
          )}
        </div>
        <div className="store-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
