import { useState, useEffect, useCallback } from 'react';
import { ShoppingBag, Zap, Shield, Star, Car, Crosshair, VolumeX, Clock, Bot, Heart, Send, ArrowRightLeft, ChevronDown, ChevronUp } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../components/FormattedNumberInput';
import styles from '../styles/noir.module.css';

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
];
const CUSTOM_POINTS_MAX = 250_000;
const CUSTOM_PRICE_PER_POINT = 67.99 / 50_000; // same rate as platinum

const BULLET_PACKS = [
  { bullets: 5000, cost: 500 },
  { bullets: 10000, cost: 1000 },
  { bullets: 50000, cost: 5000 },
  { bullets: 100000, cost: 10000 },
];

const UPGRADES = [
  { id: 'health', title: 'Full Health', Icon: Heart, price: 15, path: '/store/buy-health', ownedKey: null, desc: 'Restore health to 100%', extra: (u) => ({ line: 'Health', value: `${Number(u?.health ?? 100).toFixed(0)}%` }) },
  { id: 'rank-bar', title: 'Premium Rank Bar', Icon: Star, price: 50, path: '/store/buy-rank-bar', ownedKey: 'premium_rank_bar', desc: 'Exact numbers & amounts for next rank' },
  { id: 'auto-rank', title: 'Auto Rank', Icon: Bot, price: 200, path: '/store/buy-auto-rank', ownedKey: 'auto_rank_purchased', desc: 'Auto-commit crimes, GTA, busts, OC. Optional: set Telegram in Profile for notifications.' },
  { id: 'silencer', title: 'Silencer', Icon: VolumeX, price: 150, path: '/store/buy-silencer', ownedKey: 'has_silencer', desc: 'Fewer witness statements when you kill' },
  { id: 'anti-snitch', title: 'Anti Snitch', Icon: Shield, price: 120, path: '/store/buy-anti-snitch', ownedKey: 'anti_snitch', desc: 'Cannot be snitched on when others are in jail' },
  { id: 'oc-timer', title: 'OC Timer', Icon: Clock, price: 300, path: '/store/buy-oc-timer', ownedKey: 'oc_timer_reduced', desc: 'Heist cooldown 4h instead of 6h' },
  { id: 'crew-oc-timer', title: 'Crew OC Timer', Icon: Clock, price: 350, path: '/store/buy-crew-oc-timer', ownedKey: 'crew_oc_timer_reduced', desc: 'Family Crew OC 6h when you commit' },
  { id: 'garage', title: 'Garage Batch', Icon: Zap, price: 25, path: '/store/upgrade-garage-batch', ownedKey: null, desc: '+10 melt/scrap at once', extra: (u) => ({ line: 'Limit', value: u?.garage_batch_limit ?? 6 }) },
  { id: 'booze', title: 'Booze Capacity', Icon: ShoppingBag, price: 30, path: '/store/buy-booze-capacity', ownedKey: null, desc: '+100 capacity (max 1000)', extra: (u, cfg) => cfg && ({ line: 'Capacity', value: cfg.capacity ?? '—' }) },
];

const Tab = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 min-w-0 min-h-[44px] py-2.5 px-3 rounded-md text-[10px] sm:text-[9px] font-heading font-bold uppercase tracking-wider transition-all border touch-manipulation ${
      active
        ? 'text-primary bg-primary/10 border-primary/20'
        : 'text-zinc-500 hover:text-zinc-300 border-transparent'
    }`}
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
  const [pointsTransfers, setPointsTransfers] = useState([]);
  const [adminTransfers, setAdminTransfers] = useState([]);
  const [adminTransfersOpen, setAdminTransfersOpen] = useState(false);
  const [sendToUsername, setSendToUsername] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [customPoints, setCustomPoints] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [userRes, boozeRes, eventsRes, adminRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/booze-run/config').catch(() => ({ data: null })),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/admin/check').catch(() => ({ data: { is_admin: false } })),
      ]);
      setUser(userRes.data);
      setBoozeConfig(boozeRes?.data || null);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
      setIsAdmin(!!adminRes.data?.is_admin);
    } catch {
      toast.error('Failed to load data');
    }
  }, []);

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
        toast.success(`${res.data.points_added} points added.`);
        refreshUser();
        fetchData();
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
    try {
      await api.post(path, body || {});
      toast.success(successMsg || 'Done');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
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

  const handleCustomPurchase = async () => {
    const pts = parseInt(String(customPoints).replace(/\D/g, ''), 10);
    if (!Number.isFinite(pts) || pts < 1 || pts > CUSTOM_POINTS_MAX) {
      toast.error(`Enter 1–${CUSTOM_POINTS_MAX.toLocaleString()} points`);
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/payments/checkout', { points_custom: pts, origin_url: window.location.origin + '/store' });
      window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
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

      <div className="relative flex gap-1 p-1.5 sm:p-1 rounded-lg overflow-x-auto store-fade-in border border-primary/20 bg-primary/5 scrollbar-thin">
        <div className="h-0.5 absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-t-lg pointer-events-none" aria-hidden />
        <Tab active={activeTab === 'points'} onClick={() => setActiveTab('points')}>Points</Tab>
        <Tab active={activeTab === 'sendpts'} onClick={() => setActiveTab('sendpts')}>Send pts</Tab>
        <Tab active={activeTab === 'upgrades'} onClick={() => setActiveTab('upgrades')}>Upgrades</Tab>
        <Tab active={activeTab === 'bullets'} onClick={() => setActiveTab('bullets')}>Bullets</Tab>
      </div>

      {activeTab === 'points' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
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
          <div className={`relative rounded-lg border border-primary/20 overflow-hidden bg-zinc-900/50`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="p-3 text-center">
              <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Custom amount</p>
              <FormattedNumberInput
                value={customPoints}
                onChange={setCustomPoints}
                placeholder={`Up to ${CUSTOM_POINTS_MAX.toLocaleString()}`}
                className="w-full mt-1 px-3 py-2 text-lg font-heading font-bold text-primary bg-zinc-900/80 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none text-center"
              />
              <p className="text-[10px] text-zinc-500 font-heading italic mt-1">
                {customPoints ? (
                  <>£{(() => {
                    const pts = parseInt(String(customPoints).replace(/\D/g, ''), 10);
                    if (!Number.isFinite(pts) || pts < 1) return '0.00';
                    if (pts > CUSTOM_POINTS_MAX) return '—';
                    return (pts * CUSTOM_PRICE_PER_POINT).toFixed(2);
                  })()}</>
                ) : (
                  '—'
                )}
              </p>
            </div>
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={handleCustomPurchase}
                data-testid="buy-package-custom"
                disabled={loading || !customPoints || parseInt(String(customPoints).replace(/\D/g, ''), 10) < 1 || parseInt(String(customPoints).replace(/\D/g, ''), 10) > CUSTOM_POINTS_MAX}
                className="w-full min-h-[44px] py-2.5 sm:py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
              >
                {loading ? '...' : 'Buy'}
              </button>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>
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
                      <span className="text-mutedForeground truncate min-w-0">{t.from_username} → {t.to_username}</span>
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
                          <span className="text-mutedForeground truncate min-w-0">{t.from_username} → {t.to_username}</span>
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
      )}

      <div className="relative rounded-lg border border-primary/20 overflow-hidden">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 sm:px-4 py-2.5 bg-primary/8 border-b border-primary/20">
          <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Payments</p>
        </div>
        <div className="px-3 sm:px-4 py-3">
          <p className="text-[10px] text-zinc-500 font-heading italic">
            Payments via Stripe. Points added after purchase.
          </p>
        </div>
        <div className="store-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
