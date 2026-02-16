import { useState, useEffect, useCallback } from 'react';
import { ShoppingBag, Zap, Check, Shield, Star, Car, Crosshair, VolumeX, Clock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const PACKAGES = [
  { id: 'starter', name: 'Starter', points: 100, price: 4.99, popular: false },
  { id: 'bronze', name: 'Bronze', points: 250, price: 9.99, popular: false },
  { id: 'silver', name: 'Silver', points: 600, price: 19.99, popular: true },
  { id: 'gold', name: 'Gold', points: 1500, price: 49.99, popular: false },
  { id: 'platinum', name: 'Platinum', points: 3500, price: 99.99, popular: false },
];

const BODYGUARD_SLOT_COSTS = [100, 200, 300, 400];
const BULLET_PACKS = [
  { bullets: 5000, cost: 500 },
  { bullets: 10000, cost: 1000 },
  { bullets: 50000, cost: 5000 },
  { bullets: 100000, cost: 10000 },
];

const UPGRADES = [
  { id: 'rank-bar', title: 'Premium Rank Bar', Icon: Star, price: 50, path: '/store/buy-rank-bar', ownedKey: 'premium_rank_bar', desc: 'Exact numbers & amounts for next rank' },
  { id: 'silencer', title: 'Silencer', Icon: VolumeX, price: 150, path: '/store/buy-silencer', ownedKey: 'has_silencer', desc: 'Fewer witness statements when you kill' },
  { id: 'oc-timer', title: 'OC Timer', Icon: Clock, price: 300, path: '/store/buy-oc-timer', ownedKey: 'oc_timer_reduced', desc: 'Heist cooldown 4h instead of 6h' },
  { id: 'crew-oc-timer', title: 'Crew OC Timer', Icon: Clock, price: 350, path: '/store/buy-crew-oc-timer', ownedKey: 'crew_oc_timer_reduced', desc: 'Family Crew OC 6h when you commit' },
  { id: 'garage', title: 'Garage Batch', Icon: Zap, price: 25, path: '/store/upgrade-garage-batch', ownedKey: null, desc: '+10 melt/scrap at once', extra: (u) => ({ line: 'Limit', value: u?.garage_batch_limit ?? 6 }) },
  { id: 'booze', title: 'Booze Capacity', Icon: ShoppingBag, price: 30, path: '/store/buy-booze-capacity', ownedKey: null, desc: '+100 capacity (max 1000)', extra: (u, cfg) => cfg && ({ line: 'Capacity', value: cfg.capacity ?? '—' }) },
];

const Tab = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 min-w-0 px-2 py-2 text-[10px] font-heading font-bold uppercase tracking-wider border-b-2 transition-all ${
      active ? 'text-primary border-primary bg-primary/5' : 'text-mutedForeground border-transparent hover:text-foreground'
    }`}
  >
    {children}
  </button>
);

const StoreCard = ({ title, Icon, desc, price, owned, onBuy, loading, disabled, children }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-2">
      <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider truncate">{title}</span>
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
          onClick={onBuy}
          disabled={loading || disabled}
          className="w-full py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary text-primaryForeground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? '...' : `${price} pts`}
        </button>
      )}
    </div>
  </div>
);

export default function Store() {
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [user, setUser] = useState(null);
  const [bodyguards, setBodyguards] = useState([]);
  const [boozeConfig, setBoozeConfig] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [customCarName, setCustomCarName] = useState('');
  const [activeTab, setActiveTab] = useState('points');

  const fetchData = useCallback(async () => {
    try {
      const [userRes, bgRes, boozeRes, eventsRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/bodyguards'),
        api.get('/booze-run/config').catch(() => ({ data: null })),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      ]);
      setUser(userRes.data);
      setBodyguards(bgRes.data || []);
      setBoozeConfig(boozeRes?.data || null);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
    } catch {
      toast.error('Failed to load data');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (sessionId) checkPaymentStatus(sessionId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const getSlotCost = (n) => Math.round((BODYGUARD_SLOT_COSTS[n - 1] || 0) * (event?.bodyguard_cost ?? 1));
  const getHireCost = (n, robot) => Math.round((BODYGUARD_SLOT_COSTS[n - 1] || 0) * (robot ? 1.5 : 1) * (event?.bodyguard_cost ?? 1));

  if (checkingPayment) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-primary font-heading font-bold text-sm">Verifying payment...</p>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="store-page">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShoppingBag className="w-8 h-8 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary">Store</h1>
            <p className="text-sm text-mutedForeground">Points, upgrades, bullets & bodyguards</p>
          </div>
        </div>
        {user != null && (
          <span className="text-sm font-heading font-bold text-primary">{user.points} pts</span>
        )}
      </div>

      {eventsEnabled && event?.name && (
        <div className="px-4 py-3 rounded-md border border-primary/20 bg-primary/10 border-b border-primary/30">
          <p className="text-xs font-heading font-bold text-primary">{event.name}</p>
          <p className="text-[10px] text-mutedForeground font-heading mt-0.5">{event.message}</p>
        </div>
      )}

      <div className="flex border-b border-primary/30 bg-zinc-900/50 overflow-x-auto">
        <Tab active={activeTab === 'points'} onClick={() => setActiveTab('points')}>Points</Tab>
        <Tab active={activeTab === 'upgrades'} onClick={() => setActiveTab('upgrades')}>Upgrades</Tab>
        <Tab active={activeTab === 'bullets'} onClick={() => setActiveTab('bullets')}>Bullets</Tab>
        <Tab active={activeTab === 'bodyguards'} onClick={() => setActiveTab('bodyguards')}>Bodyguards</Tab>
      </div>

      {activeTab === 'points' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {PACKAGES.map((pkg) => (
              <div
                key={pkg.id}
                data-testid={`package-${pkg.id}`}
                className={`relative rounded-md border p-3 transition-all ${
                  pkg.popular ? 'border-primary/50 bg-primary/10' : 'border-primary/20 bg-zinc-900/50'
                }`}
              >
                {pkg.popular && (
                  <span className="absolute -top-1 left-1/2 -translate-x-1/2 bg-primary text-primaryForeground px-2 py-0.5 rounded text-[9px] font-heading font-bold">Popular</span>
                )}
                <div className="text-center">
                  <p className="text-xs font-heading font-bold text-foreground">{pkg.name}</p>
                  <p className="text-lg font-heading font-bold text-primary">{pkg.points}</p>
                  <p className="text-[10px] text-mutedForeground">pts · ${pkg.price}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handlePurchase(pkg.id)}
                  data-testid={`buy-package-${pkg.id}`}
                  disabled={loading}
                  className="w-full mt-2 py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary text-primaryForeground hover:bg-primary/90 disabled:opacity-50"
                >
                  {loading ? '...' : 'Buy'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'upgrades' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {UPGRADES.map((u) => {
            const owned = u.ownedKey && user?.[u.ownedKey];
            const extra = u.extra?.(user, boozeConfig);
            const disabled = u.id === 'booze' && boozeConfig?.capacity_bonus_max != null && (user?.booze_capacity_bonus ?? 0) >= boozeConfig.capacity_bonus_max;
            return (
              <StoreCard
                key={u.id}
                title={u.title}
                Icon={u.Icon}
                desc={u.desc}
                price={u.price}
                owned={owned}
                loading={loading}
                disabled={disabled}
                onBuy={() => apiBuy(u.path, {}, 'Purchased')}
              >
                {extra && (
                  <p className="text-[10px] text-mutedForeground mb-1">Current: {extra.value}</p>
                )}
              </StoreCard>
            );
          })}
          {/* Custom Car */}
          <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
            <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30 flex items-center justify-between gap-2">
              <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Custom Car</span>
              <Car className="text-primary shrink-0" size={14} />
            </div>
            <div className="p-2.5">
              <p className="text-[10px] text-mutedForeground font-heading mb-1.5">Named car, 20s travel, below Exclusive.</p>
              {user?.custom_car_name ? (
                <div className="py-1.5 text-center text-[10px] font-heading font-bold text-primary uppercase">Owned</div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Name (2–30 chars)"
                    value={customCarName}
                    onChange={(e) => setCustomCarName(e.target.value)}
                    maxLength={30}
                    className="w-full px-2 py-1.5 text-xs bg-zinc-900/50 border border-zinc-700/50 rounded mb-1.5 focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!customCarName.trim() || customCarName.trim().length < 2) {
                        toast.error('Name 2+ characters');
                        return;
                      }
                      apiBuy('/store/buy-custom-car', { car_name: customCarName.trim() }, 'Custom car purchased').then(() => setCustomCarName(''));
                    }}
                    disabled={!user || user.points < 500 || !customCarName.trim()}
                    className="w-full py-2 text-[10px] font-heading font-bold uppercase rounded bg-primary text-primaryForeground hover:bg-primary/90 disabled:opacity-50"
                  >
                    500 pts
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'bullets' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {BULLET_PACKS.map((pack) => (
            <div key={pack.bullets} className={`${styles.panel} rounded-md border border-primary/20 p-2.5 text-center`}>
              <Crosshair size={14} className="text-primary mx-auto mb-1" />
              <p className="text-sm font-heading font-bold text-foreground">{(pack.bullets / 1000).toFixed(0)}k</p>
              <p className="text-[10px] text-mutedForeground mb-2">{pack.cost} pts</p>
              <button
                type="button"
                onClick={() => apiBuy(`/store/buy-bullets?bullets=${pack.bullets}`, null, `Bought ${pack.bullets.toLocaleString()} bullets`)}
                disabled={!user || user.points < pack.cost}
                className="w-full py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary text-primaryForeground hover:bg-primary/90 disabled:opacity-50"
              >
                Buy
              </button>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'bodyguards' && user && (
        <div className="space-y-3">
          {user.bodyguard_slots < 4 && (
            <div className="flex items-center justify-between p-2.5 rounded-md border border-primary/20 bg-zinc-900/50">
              <span className="text-xs font-heading text-foreground">Slots: {user.bodyguard_slots}/4</span>
              <button
                type="button"
                onClick={() => apiBuy('/bodyguards/slot/buy', {}, 'Slot purchased')}
                className="py-1.5 px-3 text-[10px] font-heading font-bold uppercase rounded bg-primary text-primaryForeground hover:bg-primary/90"
              >
                Buy slot ({getSlotCost(user.bodyguard_slots + 1)} pts)
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {bodyguards.map((bg) => (
              <div key={bg.slot_number} className={`${styles.panel} rounded-md border border-primary/20 overflow-hidden`}>
                <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
                  <span className="text-[10px] font-heading font-bold text-primary">Slot {bg.slot_number}</span>
                  <Shield size={14} className="text-primary" />
                </div>
                <div className="p-2.5">
                  {bg.bodyguard_username ? (
                    <div className="text-xs font-heading text-mutedForeground">
                      {bg.is_robot ? 'Robot' : 'Human'} · {new Date(bg.hired_at).toLocaleDateString()}
                    </div>
                  ) : bg.slot_number <= user.bodyguard_slots ? (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => apiBuy('/bodyguards/hire', { slot: bg.slot_number, is_robot: false }, 'Hired')}
                        className="flex-1 py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-zinc-800/50 border border-zinc-700/50 text-foreground hover:bg-zinc-700/50"
                      >
                        Human ({getHireCost(bg.slot_number, false)})
                      </button>
                      <button
                        type="button"
                        onClick={() => apiBuy('/bodyguards/hire', { slot: bg.slot_number, is_robot: true }, 'Hired')}
                        className="flex-1 py-1.5 text-[10px] font-heading font-bold uppercase rounded bg-primary text-primaryForeground hover:bg-primary/90"
                      >
                        Robot ({getHireCost(bg.slot_number, true)})
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-mutedForeground font-heading">Buy slot first</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3 rounded-md border border-primary/20 bg-zinc-900/50">
        <p className="text-[10px] text-mutedForeground font-heading">
          Payments via Stripe. Points added after purchase.
        </p>
      </div>
    </div>
  );
}
