import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShoppingBag, Zap, Shield, Star, Car, Crosshair, VolumeX, Clock, Bot, Heart, Send, ArrowRightLeft, ChevronDown, ChevronUp, Package, Copy } from 'lucide-react';
import api, { refreshUser, apiRequestWith429Retry } from '../../utils/api';
import { copyTextToClipboard } from '../../utils/copyToClipboard';
import { toast } from 'sonner';
import { containsProfanity } from '../../utils/profanityFilter';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';
import {
  GAME_PASS_PRICE_GBP,
  GAME_PASS_POINTS_PRICE,
  SILVER_PACK_POINTS,
  SILVER_PACK_PRICE_GBP,
} from '../../constants/gamePassPricing';
import { formatGameDateTime, formatGameDateTimeShort, formatGameDateOnly } from '../../utils/gameDateTime';

const STORE_STYLES = `
  .store-fade-in { animation: store-fade-in 0.4s ease-out both; }
  @keyframes store-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .store-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const CUSTOM_POINTS_PACKAGE = 'custom';

const BULLET_PACKS = [
  { bullets: 5000, cost: 100 },
  { bullets: 10000, cost: 175 },
  { bullets: 50000, cost: 775 },
  { bullets: 100000, cost: 1525 },
];
const CUSTOM_BULLETS_MAX = 250_000;

const VALID_TABS = ['points', 'sendpts', 'upgrades', 'tokens', 'bullets'];
const bulletCost = (bullets) => bullets < 5000 ? Math.max(1, Math.floor(bullets * 0.02)) : 100 + Math.ceil((bullets - 5000) * 75 / 5000);

/** Match backend store._store_respect_cost_for_points: +35% vs old 5:1 → ceil(6.75×pts) = (pts×27+3)//4 */
function storeRespectForPoints(pts) {
  const p = Math.max(0, Math.floor(Number(pts) || 0));
  if (p <= 0) return 0;
  return Math.floor((p * 27 + 3) / 4);
}

const STORE_TOKEN_MAX_HELD = 15;

/** Must match backend AUTO_RANK_COST_POINTS / pricing logic (8× token pts ≈ full unlock pts for 16h only). */
const AUTO_RANK_COST_POINTS = 5000;
const AUTO_RANK_2H_TOKEN_STORE_PTS = Math.ceil(AUTO_RANK_COST_POINTS / 8);

/** Single consumable tokens (armoury); activate from My Inventory */
const TOKEN_STORE_ITEMS = [
  { tokenType: 'xp_crimes', title: 'Crimes XP Token', price: 42, userKey: 'xp_crimes_tokens', desc: '2× crime XP for 1h when activated (stack up to 24h).' },
  { tokenType: 'xp_gta', title: 'GTA XP Token', price: 42, userKey: 'xp_gta_tokens', desc: '2× GTA XP for 1h when activated (stack up to 24h).' },
  { tokenType: 'melt', title: 'Melt Token', price: 42, userKey: 'melt_tokens', desc: 'Melt bonus hour when activated (stack up to 24h).' },
  { tokenType: 'oc_reduced', title: 'OC Token', price: 42, userKey: 'oc_reduced_tokens', desc: 'Reduced OC cooldown hour when activated (stack up to 24h).' },
  { tokenType: 'booze', title: 'Booze Token', price: 42, userKey: 'booze_tokens', desc: 'Booze run bonus hour when activated (stack up to 24h).' },
  { tokenType: 'racket', title: 'Racket Token', price: 42, userKey: 'racket_tokens', desc: 'Racket income bonus hour when activated (stack up to 24h).' },
  { tokenType: 'properties', title: 'Properties Token', price: 48, userKey: 'properties_tokens', desc: 'Property income bonus when activated (stack up to 24h).' },
  { tokenType: 'travel', title: 'Travel Token', price: 55, userKey: 'travel_tokens', desc: 'Travel bonus when activated (stack up to 24h).' },
  { tokenType: 'jailbust_bonus', title: 'Jailbust Token', price: 48, userKey: 'jailbust_tokens', desc: '+10% bust success for 1h when activated.' },
  {
    tokenType: 'auto_rank_2h',
    title: 'Auto Rank (2h) Token',
    price: AUTO_RANK_2H_TOKEN_STORE_PTS,
    userKey: 'auto_rank_2h_tokens',
    desc: `+2h Auto Rank when activated (stack to 24h). ${AUTO_RANK_2H_TOKEN_STORE_PTS} pts each — eight tokens equal ${AUTO_RANK_COST_POINTS.toLocaleString()} pts but only 16h vs permanent unlock.`,
  },
];

const TOKEN_BUNDLES = [
  { id: 'grinder', title: 'Grinder Pack', price: 75, desc: '+1 Crimes XP token and +1 GTA XP token.' },
  { id: 'racket_runner', title: 'Racket Runner Pack', price: 78, desc: '+1 Racket token and +1 Booze token.' },
  { id: 'builder', title: 'Builder Pack', price: 100, desc: '+1 Travel token and +1 Properties token.' },
];

const UPGRADES = [
  { id: 'health', title: 'Full Health', Icon: Heart, price: 15, path: '/store/buy-health', ownedKey: null, desc: 'Restore health to 100%', extra: (u) => ({ line: 'Health', value: `${Number(u?.health ?? 100).toFixed(0)}%` }) },
  { id: 'rank-bar', title: 'Premium Rank Bar', Icon: Star, price: 50, path: '/store/buy-rank-bar', ownedKey: 'premium_rank_bar', desc: 'Exact numbers & amounts for next rank' },
  { id: 'auto-rank', title: 'Auto Rank', Icon: Bot, price: AUTO_RANK_COST_POINTS, path: '/store/buy-auto-rank', ownedKey: 'auto_rank_purchased', desc: 'Auto-commit crimes, GTA, busts, OC. Optional: set Telegram in Profile for notifications.' },
  { id: 'silencer', title: 'Silencer', Icon: VolumeX, price: 150, path: '/store/buy-silencer', ownedKey: 'has_silencer', desc: 'Fewer witness statements when you kill' },
  { id: 'anti-snitch', title: 'Anti Snitch', Icon: Shield, price: 120, path: '/store/buy-anti-snitch', ownedKey: 'anti_snitch', desc: 'Cannot be snitched on when others are in jail' },
  { id: 'oc-timer', title: 'OC Timer', Icon: Clock, price: 300, path: '/store/buy-oc-timer', ownedKey: 'oc_timer_reduced', desc: 'Heist cooldown 4h instead of 6h' },
  { id: 'crew-oc-timer', title: 'Crew OC Timer', Icon: Clock, price: 350, path: '/store/buy-crew-oc-timer', ownedKey: 'crew_oc_timer_reduced', desc: 'Family Crew OC 6h when you commit' },
  { id: 'garage', title: 'Garage Batch', Icon: Zap, price: 75, path: '/store/upgrade-garage-batch', ownedKey: null, desc: '+10 melt/scrap at once', extra: (u) => ({ line: 'Limit', value: u?.garage_batch_limit ?? 6 }) },
  { id: 'booze', title: 'Booze Capacity', Icon: ShoppingBag, price: 100, path: '/store/buy-booze-capacity', ownedKey: null, desc: '+25 capacity (max 1000)', extra: (u, cfg) => cfg && ({ line: 'Capacity', value: cfg.capacity ?? '—' }) },
  {
    id: 'hitlist-npc-cap',
    title: 'Practice Targets',
    Icon: Crosshair,
    price: (u) => (Math.min(3, (Number(u?.hitlist_npc_bonus_slots) || 0) + 1) * 100),
    path: '/store/buy-hitlist-npc-bonus-slot',
    ownedKey: null,
    desc: '+1 max hitlist NPC per 3h window (base 3, max 6). Costs: 4th=100, 5th=200, 6th=300.',
    extra: (u) => ({ line: 'Limit', value: `${3 + (Number(u?.hitlist_npc_bonus_slots) || 0)} per 3h` }),
  },
];

function StorePointsTransferRow({ t, compact }) {
  const amt = Number(t.amount).toLocaleString();
  const when = t.created_at ? formatGameDateTime(t.created_at) : '';
  const summary = `${amt} pts: ${t.from_username} → ${t.to_username}${when ? ` · ${when}` : ''}`;
  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyTextToClipboard(summary);
    if (ok) toast.success('Copied to clipboard');
    else toast.error('Could not copy');
  };
  return (
    <li
      className={`text-[10px] font-heading border-b border-zinc-800/50 last:border-0 ${
        compact ? 'flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 py-0.5' : 'py-1'
      }`}
    >
      <div className={`flex items-center justify-between gap-2 min-w-0 ${compact ? 'w-full' : ''}`}>
        <span className="text-mutedForeground truncate min-w-0 flex-1">
          <Link to={`/profile/${encodeURIComponent(t.from_username)}`} className="text-primary hover:underline">{t.from_username}</Link>
          {' → '}
          <Link to={`/profile/${encodeURIComponent(t.to_username)}`} className="text-primary hover:underline">{t.to_username}</Link>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onCopy}
            className="p-1 rounded-md border border-transparent text-zinc-500 hover:text-primary hover:bg-primary/15 hover:border-primary/25 transition-colors touch-manipulation"
            title="Copy points, users & date"
            aria-label="Copy transfer details"
          >
            <Copy size={compact ? 12 : 14} />
          </button>
          <span className="text-primary whitespace-nowrap">{amt} pts</span>
        </div>
      </div>
      {when ? (
        <span className={`text-[9px] text-zinc-600 w-full shrink-0 block ${compact ? '' : 'mt-0.5'}`}>{when}</span>
      ) : null}
    </li>
  );
}

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

function StorePayWithSelect({ value, onChange, showCash = false }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider">Pay with</span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'cash' && showCash) onChange('cash');
          else if (v === 'respect') onChange('respect');
          else onChange('points');
        }}
        className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-foreground focus:border-primary/50 focus:outline-none"
      >
        <option value="points">Points</option>
        <option value="respect">Respect points</option>
        {showCash && <option value="cash">Cash ($)</option>}
      </select>
    </div>
  );
}

const StoreCard = ({ title, Icon, desc, price, respectPrice, owned, onBuy, loading, disabled, user, payWith = 'auto', cashPrice, children }) => (
  <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
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
          disabled={
            loading
            || disabled
            || (payWith === 'cash'
              ? (!cashPrice || (user && (user.money ?? 0) < cashPrice))
              : (
                user
                && respectPrice != null
                && (
                  payWith === 'points'
                    ? (user.points ?? 0) < price
                    : payWith === 'respect'
                      ? (user.respect_points ?? 0) < respectPrice
                      : ((user.points ?? 0) < price && (user.respect_points ?? 0) < respectPrice)
                )
              )
            )
          }
          className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 mt-1 touch-manipulation"
        >
          {loading
            ? '...'
            : payWith === 'cash'
              ? (cashPrice ? `$${Math.round(cashPrice).toLocaleString()}` : 'Unavailable')
              : respectPrice != null
                ? (
                  payWith === 'points'
                    ? `${price} pts`
                    : payWith === 'respect'
                      ? `${respectPrice} resp`
                      : `${price} pts or ${respectPrice} resp`
                )
                : `${price} pts`}
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
  const [activeTab, setActiveTab] = useState('points');
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
  const [customPurchaseMode, setCustomPurchaseMode] = useState('points');
  const [customPointsInput, setCustomPointsInput] = useState('');
  const [customGbpInput, setCustomGbpInput] = useState('');
  const [customQuote, setCustomQuote] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pointsTabLocked, setPointsTabLocked] = useState(false);
  const [pointsTabLockMessage, setPointsTabLockMessage] = useState('');
  const [paymentTransactions, setPaymentTransactions] = useState([]);
  const [preorderActive, setPreorderActive] = useState(false);
  const [preorderReleaseDate, setPreorderReleaseDate] = useState(null);
  const [storePointsAutoCredit, setStorePointsAutoCredit] = useState(true);
  const [manualCreditEta, setManualCreditEta] = useState(null);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [claimingPending, setClaimingPending] = useState(false);
  const [storePayWith, setStorePayWith] = useState('points');
  const [cashPricePerPoint, setCashPricePerPoint] = useState(0);
  const [cashPriceAvailable, setCashPriceAvailable] = useState(false);
  const [cashPriceUsesQtAvg, setCashPriceUsesQtAvg] = useState(false);
  const [cashMinPricePerPoint, setCashMinPricePerPoint] = useState(150_000);
  const [cashPurchasesToday, setCashPurchasesToday] = useState(0);
  const [cashPurchasesLimit, setCashPurchasesLimit] = useState(25);

  useEffect(() => {
    if (activeTab !== 'tokens' && storePayWith === 'cash') {
      setStorePayWith('points');
    }
  }, [activeTab, storePayWith]);

  useEffect(() => {
    if (activeTab !== 'points' || pointsTabLocked) {
      setCustomQuote(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        if (customPurchaseMode === 'points') {
          const p = parseInt(String(customPointsInput).replace(/\D/g, ''), 10);
          if (!Number.isFinite(p) || p < 1000) {
            setCustomQuote(null);
            return;
          }
          const r = await api.get('/payments/custom-quote', { params: { points: p } });
          setCustomQuote(r.data || null);
        } else {
          const raw = String(customGbpInput).replace(/[^0-9.]/g, '');
          const g = parseFloat(raw);
          if (!Number.isFinite(g) || g < 2.49) {
            setCustomQuote(null);
            return;
          }
          const r = await api.get('/payments/custom-quote', { params: { gbp: g } });
          setCustomQuote(r.data || null);
        }
      } catch {
        setCustomQuote(null);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [activeTab, pointsTabLocked, customPurchaseMode, customPointsInput, customGbpInput]);

  useEffect(() => {
    if (activeTab === 'tokens' && storePayWith === 'cash') {
      api.get('/store/token-cash-price').then(({ data }) => {
        setCashPriceAvailable(!!data.available);
        setCashPricePerPoint(data.price_per_point || 0);
        setCashPriceUsesQtAvg(!!data.used_qt_average);
        setCashMinPricePerPoint(Number(data.min_price_per_point) || 150_000);
        setCashPurchasesToday(data.cash_purchases_today || 0);
        setCashPurchasesLimit(data.cash_purchases_limit || 25);
      }).catch(() => {
        setCashPriceAvailable(false);
        setCashPricePerPoint(0);
        setCashPriceUsesQtAvg(false);
      });
    }
  }, [activeTab, storePayWith]);

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
      const [userRes, boozeRes, eventsRes, adminRes, locksRes, pendingRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/booze-run/config').catch(() => ({ data: null })),
        apiRequestWith429Retry(() => api.get('/events/active')).catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/admin/check').catch(() => ({ data: { is_admin: false } })),
        api.get('/page-locks').catch(() => ({ data: { paths: {} } })),
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
      const pending = pendingRes?.data || {};
      const releaseDate = pending.release_date || null;
      let preorderOn = false;
      if (releaseDate) {
        try {
          preorderOn = new Date(releaseDate).getTime() > Date.now();
        } catch {
          preorderOn = false;
        }
      }
      setPreorderActive(preorderOn);
      setPreorderReleaseDate(releaseDate);
      setStorePointsAutoCredit(pending.store_points_auto_credit !== false);
      setManualCreditEta(pending.manual_credit_eta ?? null);
      setPendingPoints(pending.pending_points || 0);
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
    const sp = new URLSearchParams(window.location.search);
    const sessionId = sp.get('session_id');
    const paymentCancel = sp.get('payment_cancel');
    // Stripe cancel_url: user backed out — mark checkout abandoned (not paid)
    if (paymentCancel === '1' && sessionId) {
      (async () => {
        try {
          await api.post(`/payments/mark-checkout-cancelled/${encodeURIComponent(sessionId)}`);
          toast.info('Checkout was not completed — no charge was made.');
          await fetchPaymentTransactions();
        } catch {
          toast.error('Could not update checkout status');
        }
        const tab = sp.get('tab');
        window.history.replaceState({}, '', tab ? `/game/store?tab=${encodeURIComponent(tab)}` : '/game/store');
        fetchData();
      })();
      return;
    }
    fetchData();
    if (sessionId) checkPaymentStatus(sessionId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'sendpts') fetchPointsTransfers();
  }, [activeTab, fetchPointsTransfers]);

  const checkPaymentStatus = async (sessionId, attempt = 0) => {
    if (attempt >= 5) {
      toast.error('Payment verification timed out.');
      window.history.replaceState({}, '', '/game/store');
      return;
    }
    setCheckingPayment(true);
    try {
      const res = await api.get(`/payments/status/${sessionId}`);
      if (res.data.status === 'fulfillment_blocked' || res.data.payment_status === 'fulfillment_blocked') {
        toast.error(res.data.detail || 'This purchase could not be completed. If you were charged, contact support.');
        refreshUser();
        fetchData();
        fetchPaymentTransactions();
      } else if (res.data.payment_status === 'paid') {
        if (res.data.manual_credit_pending || res.data.status === 'manual_credit_pending') {
          const eta = res.data.manual_credit_eta ? formatGameDateTimeShort(res.data.manual_credit_eta) : null;
          toast.success(
            `Payment received. ${Number(res.data.points_added || 0).toLocaleString()} points will be added manually by staff${eta ? ` (around ${eta})` : ''}.`,
          );
        } else if (res.data.preorder) {
          const releaseDate = res.data.preorder_release_date ? formatGameDateOnly(res.data.preorder_release_date) : 'launch';
          toast.success(`Payment received. ${res.data.points_added} points will be credited on ${releaseDate}.`);
        } else {
          const pts = Number(res.data.points_added || 0);
          if (pts === 0) toast.success('Game Pass purchased — token delivered. Activate in My Inventory.');
          else toast.success(`${pts} points added.`);
        }
        refreshUser();
        fetchData();
        fetchPaymentTransactions();
      } else if (res.data.status === 'expired' || res.data.payment_status === 'expired') {
        toast.error('Session expired.');
      } else if (res.data.payment_status === 'unpaid') {
        toast.info('No payment was completed.');
        fetchPaymentTransactions();
      } else {
        setTimeout(() => checkPaymentStatus(sessionId, attempt + 1), 2000);
        return;
      }
    } catch {
      toast.error('Error checking payment');
    }
    window.history.replaceState({}, '', '/game/store');
    setCheckingPayment(false);
  };

  const apiBuy = async (path, body, successMsg, onSuccess) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await api.post(path, body || {});
      toast.success(successMsg || 'Done');
      refreshUser();
      fetchData();
      if (onSuccess) onSuccess(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCustomPointsPurchase = async () => {
    if (!customQuote?.points || customQuote.points < 1) {
      toast.error('Enter a valid amount and wait for the price preview');
      return;
    }
    setLoading(true);
    try {
      const origin = `${window.location.origin}/game/store`;
      const body =
        customPurchaseMode === 'points'
          ? { package_id: CUSTOM_POINTS_PACKAGE, origin_url: origin, custom_points: customQuote.points }
          : { package_id: CUSTOM_POINTS_PACKAGE, origin_url: origin, custom_gbp: parseFloat(String(customGbpInput).replace(/[^0-9.]/g, '')) || 0 };
      const res = await api.post('/payments/checkout', body);
      window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Checkout failed');
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
    const respectCost = storeRespectForPoints(cost);
    if (storePayWith === 'points' && (user.points ?? 0) < cost) {
      toast.error(`Need ${cost} pts`);
      return;
    }
    if (storePayWith === 'respect' && (user.respect_points ?? 0) < respectCost) {
      toast.error(`Need ${respectCost} respect`);
      return;
    }
    setLoading(true);
    try {
      await api.post(`/store/buy-bullets?bullets=${b}&pay_with=${encodeURIComponent(storePayWith)}`);
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
    <div className={`space-y-4 sm:space-y-6 ${styles.pageContent} mobile-page-root px-3 sm:px-4 pb-6`} data-testid="store-page" data-page="store">
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

      {!storePointsAutoCredit && (
        <div className="relative rounded-lg border border-sky-500/30 overflow-hidden bg-sky-500/5">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-sky-500/50 to-transparent" />
          <div className="px-4 py-3">
            <p className="text-[10px] font-heading font-bold text-sky-400 uppercase tracking-[0.15em]">Pre-order point crediting</p>
            <p className="text-[10px] text-zinc-400 font-heading mt-1">
              This applies only to <span className="text-zinc-300">pre-order</span> point purchases: your payment is recorded and staff add points to your account manually.
              {manualCreditEta ? (
                <>
                  {' '}
                  Planned crediting window:{' '}
                  <span className="text-sky-400 font-bold">
                    {formatGameDateTimeShort(manualCreditEta)}
                  </span>
                </>
              ) : null}
              {preorderReleaseDate ? (
                <>
                  {' '}
                  On or after{' '}
                  <span className="text-zinc-300 font-semibold">
                    {formatGameDateTimeShort(preorderReleaseDate)}
                  </span>
                  , new point purchases are credited <span className="text-emerald-400/90">automatically as soon as payment succeeds</span>.
                </>
              ) : (
                <>
                  {' '}
                  After the release date, new point purchases are credited <span className="text-emerald-400/90">automatically as soon as payment succeeds</span>.
                </>
              )}
            </p>
            {pendingPoints > 0 && (
              <p className="text-[10px] text-sky-400 font-heading font-bold mt-2">
                You have {pendingPoints.toLocaleString()} points waiting to be credited
              </p>
            )}
          </div>
          <div className="h-px bg-sky-500/20 mx-3" />
        </div>
      )}

      {storePointsAutoCredit && preorderActive && (
        <div className="relative rounded-lg border border-amber-500/30 overflow-hidden bg-amber-500/5">
          <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
          <div className="px-4 py-3">
            <p className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-[0.15em]">Pre-Order Mode Active</p>
            <p className="text-[10px] text-zinc-400 font-heading mt-1">
              Points purchased now will be credited on{' '}
              <span className="text-amber-400 font-bold">
                {preorderReleaseDate ? formatGameDateTimeShort(preorderReleaseDate) : 'launch date'}
              </span>
              . Purchases on or after that time are credited <span className="text-emerald-400/90">automatically as soon as payment succeeds</span>.
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

      {storePointsAutoCredit && !preorderActive && pendingPoints > 0 && (
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
        <Tab active={activeTab === 'tokens'} onClick={() => { setActiveTab('tokens'); setSearchParams({ tab: 'tokens' }); }}>Tokens</Tab>
        <Tab active={activeTab === 'bullets'} onClick={() => { setActiveTab('bullets'); setSearchParams({ tab: 'bullets' }); }}>Bullets</Tab>
      </div>
      {['upgrades', 'tokens', 'bullets'].includes(activeTab) && (
        <div className="mb-2">
          <StorePayWithSelect value={storePayWith} onChange={setStorePayWith} showCash={activeTab === 'tokens'} />
        </div>
      )}

      {activeTab === 'points' && (
        <div className="space-y-3">
          {pointsTabLocked ? (
            <div className={`${styles.panel} rounded-lg border border-primary/20 p-6 text-center mobile-panel`}>
              <p className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">{pointsTabLockMessage}</p>
              <p className="text-[9px] text-mutedForeground mt-1">Points purchase is temporarily unavailable. Upgrades, bullets, and send pts remain available.</p>
            </div>
          ) : (
          <>
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2 bg-primary/8 border-b border-primary/20">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Buy points</span>
              <p className="text-[8px] text-mutedForeground font-heading mt-0.5 leading-snug">
                Enter whole points from 1,000–200,000, or a GBP budget — the server prices along the standard store curve (Stripe checkout).
              </p>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => { setCustomPurchaseMode('points'); setCustomQuote(null); }}
                  className={`flex-1 py-1.5 text-[9px] font-heading font-bold uppercase rounded border ${customPurchaseMode === 'points' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-primary/20 text-mutedForeground'}`}
                >
                  By points
                </button>
                <button
                  type="button"
                  onClick={() => { setCustomPurchaseMode('gbp'); setCustomQuote(null); }}
                  className={`flex-1 py-1.5 text-[9px] font-heading font-bold uppercase rounded border ${customPurchaseMode === 'gbp' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-primary/20 text-mutedForeground'}`}
                >
                  By GBP
                </button>
              </div>
              {customPurchaseMode === 'points' ? (
                <FormattedNumberInput
                  value={customPointsInput}
                  onChange={setCustomPointsInput}
                  placeholder="Points (e.g. 160000)"
                  className="w-full px-3 py-2 text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none text-foreground font-heading"
                />
              ) : (
                <input
                  type="text"
                  inputMode="decimal"
                  value={customGbpInput}
                  onChange={(e) => setCustomGbpInput(e.target.value)}
                  placeholder="GBP (e.g. 40)"
                  className="w-full px-3 py-2 text-xs bg-zinc-900/50 border border-zinc-700/50 rounded focus:border-primary/50 focus:outline-none text-foreground font-heading"
                />
              )}
              {customQuote && (
                <p className="text-[10px] font-heading text-zinc-300">
                  {customPurchaseMode === 'points' ? (
                    <>
                      <span className="text-primary font-bold">{Number(customQuote.points).toLocaleString()} pts</span>
                      {' · '}
                      <span className="text-emerald-400/90">£{Number(customQuote.price_gbp).toFixed(2)}</span>
                    </>
                  ) : (
                    <>
                      Pay <span className="text-emerald-400/90 font-bold">£{Number(customQuote.price_gbp).toFixed(2)}</span>
                      {' → '}
                      <span className="text-primary font-bold">{Number(customQuote.points).toLocaleString()} pts</span>
                      <span className="block text-[8px] text-mutedForeground mt-0.5">GBP mode charges the shown amount (largest whole points that fit your budget).</span>
                    </>
                  )}
                </p>
              )}
              <button
                type="button"
                onClick={handleCustomPointsPurchase}
                disabled={loading || !customQuote}
                className="w-full min-h-[44px] py-2.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
              >
                {loading ? '...' : 'Buy with card'}
              </button>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>
          </>
          )}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`} data-testid="store-game-pass-inline">
            <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] truncate">{`Game Pass (£${GAME_PASS_PRICE_GBP})`}</span>
              <Package className="text-primary shrink-0" size={14} />
            </div>
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-zinc-400 font-heading">
                {`Opens the Game Pass page — £${GAME_PASS_PRICE_GBP}, ${GAME_PASS_POINTS_PRICE.toLocaleString()} pts, rewards & status (grouped with Points, not Combat).`}
              </p>
              <Link
                to="/game-pass"
                className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation flex items-center justify-center gap-2"
              >
                Open Game Pass →
              </Link>
              <p className="text-[8px] text-zinc-500/90 font-heading leading-snug pt-1">
                Not the same as {SILVER_PACK_POINTS.toLocaleString()} pts (£{SILVER_PACK_PRICE_GBP}): that adds spendable points; Game Pass unlocks rank tier rewards, not a points balance.
              </p>
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>
        </div>
      )}

      {activeTab === 'sendpts' && (
        <div className="space-y-4 store-fade-in">
          <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
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

          <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
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
                    <StorePointsTransferRow key={t.id} t={t} compact={false} />
                  ))}
                </ul>
              )}
            </div>
            <div className="store-art-line text-primary mx-3" />
          </div>

          {isAdmin && (
            <div className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
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
                        <StorePointsTransferRow key={t.id} t={t} compact />
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
        <div className="space-y-6">
          <div className="space-y-2" id="store-permanent-upgrades">
            <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Permanent upgrades & QoL</h2>
            <p className="text-[9px] text-zinc-500 font-heading leading-snug max-w-2xl">
              Includes <span className="text-primary font-bold">Auto Rank</span> for{' '}
              <span className="text-foreground font-semibold">5,000 pts</span> or the respect equivalent — the buy button shows both prices.
              {' '}Bought upgrades are removed from this list once owned permanently (e.g. Auto Rank after purchase — trial access still shows the buy option).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
          {UPGRADES.filter((u) => {
            if (u.id === 'auto-rank') {
              // Founding/trial sets auto_rank_purchased=true; only hide after permanent unlock (trial cleared).
              if (user?.auto_rank_purchased && !user?.auto_rank_trial) return false;
            } else {
              const owned = u.ownedKey && user?.[u.ownedKey];
              if (owned) return false;
            }
            // Hide Garage Batch when already at max (100)
            if (u.id === 'garage' && (user?.garage_batch_limit ?? 0) >= 100) return false;
            // Hide Booze Capacity when already at max
            if (u.id === 'booze' && boozeConfig?.capacity_bonus_max != null && (user?.booze_capacity_bonus ?? 0) >= boozeConfig.capacity_bonus_max) return false;
            // Hide Practice Targets when already at max (base 3 + bonus 3)
            if (u.id === 'hitlist-npc-cap' && (Number(user?.hitlist_npc_bonus_slots) || 0) >= 3) return false;
            return true;
          }).map((u) => {
            const extra = u.extra?.(user, boozeConfig);
            const priceVal = typeof u.price === 'function' ? Number(u.price(user, boozeConfig)) : Number(u.price);
            const disabled =
              (u.id === 'booze' && boozeConfig?.capacity_bonus_max != null && (user?.booze_capacity_bonus ?? 0) >= boozeConfig.capacity_bonus_max) ||
              (u.id === 'hitlist-npc-cap' && (Number(user?.hitlist_npc_bonus_slots) || 0) >= 3) ||
              (u.id === 'health' && Number(user?.health ?? 100) >= 100) ||
              !!u.disabledWhen?.(user);
            return (
              <div key={u.id} id={u.id === 'auto-rank' ? 'store-auto-rank' : undefined}>
              <StoreCard
                title={u.title}
                Icon={u.Icon}
                desc={u.desc}
                price={priceVal}
                respectPrice={storeRespectForPoints(priceVal)}
                owned={false}
                loading={loading}
                disabled={disabled}
                user={user}
                payWith={storePayWith}
                onBuy={() => apiBuy(`${u.path}?pay_with=${encodeURIComponent(storePayWith)}`, {}, 'Purchased')}
              >
                {extra && (
                  <p className="text-[10px] text-mutedForeground mb-1">Current: {extra.value}</p>
                )}
              </StoreCard>
              </div>
            );
          })}
            </div>
          </div>

          {/* Custom Car — always show (can buy multiple) */}
          <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
                <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Custom Car</span>
                <Car className="text-primary shrink-0" size={14} />
              </div>
              <div className="p-2.5">
                <p className="text-[10px] text-mutedForeground font-heading mb-1.5">Named car, 12s travel, below Exclusive.</p>
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
                      const name = customCarName.trim();
                      if (!name || name.length < 2) {
                        toast.error('Name 2+ characters');
                        return;
                      }
                      if (containsProfanity(name)) {
                        toast.error('Custom car name contains disallowed language.');
                        return;
                      }
                      apiBuy(`/store/buy-custom-car?pay_with=${encodeURIComponent(storePayWith)}`, { car_name: name }, 'Custom car purchased').then(() => setCustomCarName(''));
                    }}
                    disabled={
                      !user
                      || !customCarName.trim()
                      || (
                        storePayWith === 'points'
                          ? (user.points ?? 0) < 500
                          : (user.respect_points ?? 0) < storeRespectForPoints(500)
                      )
                    }
                    className="w-full min-h-[44px] py-2.5 sm:py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                  >
                    {storePayWith === 'points' ? '500 pts' : `${storeRespectForPoints(500)} resp`}
                  </button>
                </div>
              </div>
              <div className="store-art-line text-primary mx-3" />
            </div>
        </div>
      )}

      {activeTab === 'tokens' && (
        <div className="space-y-6">
          {user && (Number(user.token_points_spent || 0) > 0 || Number(user.token_respect_spent || 0) > 0 || Number(user.token_cash_spent || 0) > 0) && (
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded border border-primary/20 bg-primary/5">
              <span className="text-[9px] font-heading text-zinc-400 uppercase tracking-wider">Spent on tokens:</span>
              {Number(user.token_points_spent || 0) > 0 && (
                <span className="text-[9px] font-heading text-zinc-300">
                  <span className="text-primary font-bold">{Number(user.token_points_spent).toLocaleString()}</span> pts
                </span>
              )}
              {Number(user.token_respect_spent || 0) > 0 && (
                <span className="text-[9px] font-heading text-zinc-300">
                  <span className="text-primary font-bold">{Number(user.token_respect_spent).toLocaleString()}</span> respect
                </span>
              )}
              {Number(user.token_cash_spent || 0) > 0 && (
                <span className="text-[9px] font-heading text-zinc-300">
                  <span className="text-primary font-bold">${Number(user.token_cash_spent).toLocaleString()}</span> cash
                </span>
              )}
            </div>
          )}
          {storePayWith === 'cash' && (
            <div className="flex flex-wrap items-center gap-3">
              {cashPriceAvailable ? (
                <>
                  <span className="text-[9px] font-heading text-zinc-500">
                    Price per point: <span className="text-primary font-bold">${Math.round(cashPricePerPoint).toLocaleString()}</span>
                    <span className="text-zinc-600 ml-1">
                      {cashPriceUsesQtAvg
                        ? `(avg of cheapest 3 QT sell offers; min $${Math.round(cashMinPricePerPoint).toLocaleString()}/pt)`
                        : `($${Math.round(cashMinPricePerPoint).toLocaleString()}/pt — fewer than 3 QT sell offers)`}
                    </span>
                  </span>
                  <span className="text-[9px] font-heading text-zinc-500">
                    Daily: <span className={`font-bold ${cashPurchasesToday >= cashPurchasesLimit ? 'text-red-400' : 'text-primary'}`}>{cashPurchasesToday}/{cashPurchasesLimit}</span> used
                  </span>
                </>
              ) : (
                <span className="text-[9px] font-heading text-red-400/80">Could not load cash price — try again.</span>
              )}
            </div>
          )}

          <div className="space-y-2">
            <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Consumable tokens</h2>
            <p className="text-[9px] text-zinc-500 font-heading italic max-w-2xl">
              Buy unactivated tokens (max {STORE_TOKEN_MAX_HELD} stored per type). Activate from My Inventory. Also tradable via Quick Trade — store prices are a points sink for convenience.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
              {TOKEN_STORE_ITEMS.map((t) => {
                const held = Number(user?.[t.userKey] ?? 0);
                const atCap = held >= STORE_TOKEN_MAX_HELD;
                const tokenCashPrice = cashPriceAvailable ? Math.round(t.price * cashPricePerPoint) : 0;
                return (
                  <StoreCard
                    key={t.tokenType}
                    title={t.title}
                    Icon={Package}
                    desc={t.desc}
                    price={t.price}
                    respectPrice={storeRespectForPoints(t.price)}
                    owned={false}
                    loading={loading}
                    disabled={atCap || (storePayWith === 'cash' && cashPurchasesToday >= cashPurchasesLimit)}
                    user={user}
                    payWith={storePayWith}
                    cashPrice={storePayWith === 'cash' ? tokenCashPrice : undefined}
                    onBuy={() => {
                      if (storePayWith === 'cash') {
                        apiBuy('/store/buy-token-cash', { token_type: t.tokenType, amount: 1 }, `+1 ${t.title}`, (d) => {
                          if (d?.cash_purchases_today != null) setCashPurchasesToday(d.cash_purchases_today);
                        });
                      } else {
                        apiBuy(`/store/buy-token?pay_with=${encodeURIComponent(storePayWith)}`, { token_type: t.tokenType, amount: 1 }, `+1 ${t.title}`);
                      }
                    }}
                  >
                    <p className="text-[10px] text-mutedForeground mb-1">Held: {held}/{STORE_TOKEN_MAX_HELD}</p>
                  </StoreCard>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Token bundles</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-2">
              {TOKEN_BUNDLES.map((b) => {
                const bundleCashPrice = cashPriceAvailable ? Math.round(b.price * cashPricePerPoint) : 0;
                return (
                  <StoreCard
                    key={b.id}
                    title={b.title}
                    Icon={Package}
                    desc={b.desc}
                    price={b.price}
                    respectPrice={storeRespectForPoints(b.price)}
                    owned={false}
                    loading={loading}
                    disabled={!user || (storePayWith === 'cash' && cashPurchasesToday >= cashPurchasesLimit)}
                    user={user}
                    payWith={storePayWith}
                    cashPrice={storePayWith === 'cash' ? bundleCashPrice : undefined}
                    onBuy={() => {
                      if (storePayWith === 'cash') {
                        apiBuy('/store/buy-token-bundle-cash', { bundle_id: b.id }, 'Bundle purchased', (d) => {
                          if (d?.cash_purchases_today != null) setCashPurchasesToday(d.cash_purchases_today);
                        });
                      } else {
                        apiBuy(`/store/buy-token-bundle?pay_with=${encodeURIComponent(storePayWith)}`, { bundle_id: b.id }, 'Bundle purchased');
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'bullets' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-2">
            {BULLET_PACKS.map((pack) => {
              const respectCost = storeRespectForPoints(pack.cost);
              const canAfford =
                user
                && (storePayWith === 'points'
                  ? (user.points ?? 0) >= pack.cost
                  : (user.respect_points ?? 0) >= respectCost);
              return (
                <div key={pack.bullets} className={`relative ${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
                  <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                  <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-center gap-1.5">
                    <Crosshair size={14} className="text-primary shrink-0" />
                    <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">{(pack.bullets / 1000).toFixed(0)}k bullets</span>
                  </div>
                  <div className="p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500 font-heading mb-2">
                      {storePayWith === 'points' ? `${pack.cost} pts` : `${respectCost} resp`}
                    </p>
                    <button
                      type="button"
                      onClick={() => apiBuy(`/store/buy-bullets?bullets=${pack.bullets}&pay_with=${encodeURIComponent(storePayWith)}`, null, `Bought ${pack.bullets.toLocaleString()} bullets`)}
                      disabled={!canAfford}
                      className="w-full min-h-[44px] py-2.5 sm:py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
                    >
                      {storePayWith === 'points' ? `Buy · ${pack.cost} pts` : `Buy · ${respectCost} resp`}
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
                    const r = storeRespectForPoints(c);
                    return storePayWith === 'points' ? `${c} pts` : `${r} resp`;
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
                disabled={loading || !user || !customBullets || (() => {
                  const b = parseInt(String(customBullets).replace(/\D/g, ''), 10);
                  if (!Number.isFinite(b) || b < 1 || b > CUSTOM_BULLETS_MAX) return true;
                  const c = bulletCost(b);
                  const r = storeRespectForPoints(c);
                  if (storePayWith === 'points') return (user.points ?? 0) < c;
                  return (user.respect_points ?? 0) < r;
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
            Payments via Stripe.{' '}
            {!storePointsAutoCredit
              ? `Pre-order point purchases are added manually by staff${manualCreditEta ? ` (planned around ${formatGameDateTimeShort(manualCreditEta)}).` : '.'} ${preorderReleaseDate ? `From ${formatGameDateTimeShort(preorderReleaseDate)} onward, new point purchases credit automatically when payment completes.` : 'After release, new point purchases credit automatically when payment completes.'}`
              : preorderActive
                ? 'Pre-order points credit on the release date above; purchases on or after that date credit automatically when payment completes.'
                : 'Point purchases are credited automatically when payment completes.'}
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
                const ui = t.ui_status || '';
                const statusClass =
                  t.payment_status === 'completed'
                    ? 'text-green-400'
                    : t.payment_status === 'preorder_pending'
                      ? 'text-amber-400'
                      : t.payment_status === 'manual_credit_pending'
                        ? 'text-sky-400'
                        : ui.includes('Unpaid')
                          ? 'text-zinc-500'
                          : ui.includes('Paid')
                            ? 'text-emerald-400/90'
                            : 'text-zinc-400';
                const statusText =
                  t.ui_status
                    ? t.ui_status
                    : t.payment_status === 'completed'
                      ? 'Credited'
                      : t.payment_status === 'preorder_pending'
                        ? 'Pre-order'
                        : t.payment_status === 'manual_credit_pending'
                          ? 'Manual credit'
                          : t.payment_status || 'Pending';
                return (
                  <div key={t.session_id || i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 text-[10px] font-heading border-b border-zinc-800/50 last:border-0">
                    <span className="text-mutedForeground truncate" title={t.created_at}>{t.created_at ? formatGameDateTime(t.created_at) : '—'}</span>
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
