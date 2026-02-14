import { useState, useEffect } from 'react';
import { ShoppingBag, Zap, Check, Shield, Star, Car, Crosshair, VolumeX, Clock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const PACKAGES = [
  { id: 'starter', name: 'Starter Pack', points: 100, price: 4.99, popular: false },
  { id: 'bronze', name: 'Bronze Pack', points: 250, price: 9.99, popular: false },
  { id: 'silver', name: 'Silver Pack', points: 600, price: 19.99, popular: true },
  { id: 'gold', name: 'Gold Pack', points: 1500, price: 49.99, popular: false },
  { id: 'platinum', name: 'Platinum Pack', points: 3500, price: 99.99, popular: false },
];

const BODYGUARD_SLOT_COSTS = [100, 200, 300, 400];

const BULLET_PACKS = [
  { bullets: 5000, cost: 500 },
  { bullets: 10000, cost: 1000 },
  { bullets: 50000, cost: 5000 },
  { bullets: 100000, cost: 10000 },
];

export default function Store() {
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [user, setUser] = useState(null);
  const [bodyguards, setBodyguards] = useState([]);
  const [boozeConfig, setBoozeConfig] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [customCarName, setCustomCarName] = useState('');

  useEffect(() => {
    fetchData();
    
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    
    if (sessionId) {
      checkPaymentStatus(sessionId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      const [userRes, bodyguardsRes, boozeRes, eventsRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/bodyguards'),
        api.get('/booze-run/config').catch(() => ({ data: null })),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } }))
      ]);
      setUser(userRes.data);
      setBodyguards(bodyguardsRes.data);
      setBoozeConfig(boozeRes?.data || null);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
    } catch (error) {
      toast.error('Failed to load data');
    }
  };

  const checkPaymentStatus = async (sessionId, attempt = 0) => {
    if (attempt >= 5) {
      toast.error('Payment verification timed out. Please check your account.');
      window.history.replaceState({}, '', '/store');
      return;
    }

    setCheckingPayment(true);
    try {
      const response = await api.get(`/payments/status/${sessionId}`);
      
      if (response.data.payment_status === 'paid') {
        toast.success(`Payment successful! ${response.data.points_added} points added to your account.`);
        refreshUser();
        window.history.replaceState({}, '', '/store');
        setCheckingPayment(false);
      } else if (response.data.status === 'expired') {
        toast.error('Payment session expired. Please try again.');
        window.history.replaceState({}, '', '/store');
        setCheckingPayment(false);
      } else {
        setTimeout(() => checkPaymentStatus(sessionId, attempt + 1), 2000);
      }
    } catch (error) {
      toast.error('Error checking payment status');
      setCheckingPayment(false);
      window.history.replaceState({}, '', '/store');
    }
  };

  const handlePurchase = async (packageId) => {
    setLoading(true);
    try {
      const originUrl = window.location.origin + '/store';
      const response = await api.post('/payments/checkout', {
        package_id: packageId,
        origin_url: originUrl,
      });
      
      window.location.href = response.data.url;
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create checkout session');
      setLoading(false);
    }
  };

  const buySlot = async () => {
    try {
      const response = await api.post('/bodyguards/slot/buy');
      toast.success(response.data.message);
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy slot');
    }
  };

  const hireBodyguard = async (slot, isRobot) => {
    try {
      const response = await api.post('/bodyguards/hire', { slot, is_robot: isRobot });
      toast.success(response.data.message);
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to hire bodyguard');
    }
  };

  const buySilencer = async () => {
    try {
      await api.post('/store/buy-silencer');
      toast.success('Silencer purchased! Fewer witness statements when you kill.');
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy silencer');
    }
  };

  const buyPremiumRankBar = async () => {
    try {
      const response = await api.post('/store/buy-rank-bar');
      toast.success(response.data.message);
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy premium rank bar');
    }
  };

  const buyOcTimer = async () => {
    try {
      await api.post('/store/buy-oc-timer');
      toast.success('OC timer reduced! Heist cooldown is now 4 hours.');
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy OC timer');
    }
  };

  const upgradeGarageBatch = async () => {
    try {
      const response = await api.post('/store/upgrade-garage-batch');
      toast.success(response.data.message);
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to upgrade garage limit');
    }
  };

  const buyBoozeCapacity = async () => {
    try {
      const response = await api.post('/store/buy-booze-capacity');
      toast.success(response.data.message);
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy booze capacity');
    }
  };

  const buyBullets = async (bullets) => {
    try {
      const response = await api.post(`/store/buy-bullets?bullets=${bullets}`);
      toast.success(response.data.message);
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy bullets');
    }
  };

  const buyCustomCar = async () => {
    if (!customCarName.trim() || customCarName.trim().length < 2) {
      toast.error('Car name must be at least 2 characters');
      return;
    }
    try {
      const response = await api.post('/store/buy-custom-car', { car_name: customCarName.trim() });
      toast.success(response.data.message);
      setCustomCarName('');
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy custom car');
    }
  };

  const getSlotCost = (slotNumber) => {
    const base = BODYGUARD_SLOT_COSTS[slotNumber - 1];
    const mult = event?.bodyguard_cost ?? 1;
    return Math.round(base * mult);
  };
  const getHireCost = (slotNumber, isRobot) => {
    const base = BODYGUARD_SLOT_COSTS[slotNumber - 1] * (isRobot ? 1.5 : 1);
    const mult = event?.bodyguard_cost ?? 1;
    return Math.round(base * mult);
  };

  if (checkingPayment) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="text-primary text-xl font-heading font-bold mb-2">Verifying payment...</div>
          <p className="text-mutedForeground text-sm font-heading">Please wait while we confirm your purchase</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-8 ${styles.pageContent}`} data-testid="store-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-4xl font-heading font-bold text-primary uppercase tracking-wider">Points Store</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Purchase points and upgrades</p>
      </div>

      {eventsEnabled && event?.name && (
        <div className={`${styles.panel} rounded-md overflow-hidden`}>
          <div className={`${styles.panelHeader} px-3 py-2 sm:px-4`}>
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Today&apos;s event</span>
          </div>
          <div className="p-3 sm:p-4">
            <p className="text-sm font-heading font-bold text-primary">{event.name}</p>
            <p className={`text-xs font-heading mt-1 ${styles.textMuted}`}>{event.message}</p>
          </div>
        </div>
      )}

      {user && (
        <div className={`${styles.panel} rounded-sm overflow-hidden p-6`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-heading font-bold text-primary mb-1">Your Points</h3>
              <p className="text-xs font-heading text-mutedForeground uppercase tracking-wider">Use points to unlock premium features</p>
            </div>
            <div className="text-3xl font-heading font-bold text-primary">{user.points} pts</div>
          </div>
        </div>
      )}

      {/* Premium Upgrades */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-px bg-primary/50" />
          <h2 className="text-sm font-heading font-bold text-primary/80 uppercase tracking-widest">Premium Upgrades</h2>
          <div className="flex-1 h-px bg-primary/30" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Premium Rank Bar */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Premium Rank Bar</span>
              <Star className="text-primary" size={20} />
            </div>
            <div className="p-6">
              <p className="text-xs font-heading text-mutedForeground mb-4">
                Detailed progress with exact numbers and amounts needed for next rank
              </p>
              <div className="space-y-2 mb-6 font-heading text-xs text-mutedForeground">
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Detailed money progress</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Exact rank points tracking</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Shows amounts needed</div>
              </div>
              {user?.premium_rank_bar ? (
                <div className={`${styles.surface} border border-primary/20 rounded-sm py-3 text-center text-primary font-heading font-bold uppercase tracking-wider`}>
                  Owned
                </div>
              ) : (
                <button
                  onClick={buyPremiumRankBar}
                  className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth"
                >
                  Buy for 50 Points
                </button>
              )}
            </div>
          </div>

          {/* Silencer */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Silencer</span>
              <VolumeX className="text-primary" size={20} />
            </div>
            <div className="p-6">
              <p className="text-xs font-heading text-mutedForeground mb-4">
                Reduces witness statements sent to inbox when you kill. Better weapons already attract fewer witnesses; silencer cuts the chance further.
              </p>
              <div className="space-y-2 mb-6 font-heading text-xs text-mutedForeground">
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Requires at least one weapon</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Witness statements are sent to random users&apos; inboxes</div>
              </div>
              {user?.has_silencer ? (
                <div className={`${styles.surface} border border-primary/20 rounded-sm py-3 text-center text-primary font-heading font-bold uppercase tracking-wider`}>
                  Owned
                </div>
              ) : (
                <button
                  onClick={buySilencer}
                  disabled={loading}
                  className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth disabled:opacity-50"
                >
                  Buy for 150 Points
                </button>
              )}
            </div>
          </div>

          {/* Reduce OC Timer */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Reduce OC Timer</span>
              <Clock className="text-primary" size={20} />
            </div>
            <div className="p-6">
              <p className="text-xs font-heading text-mutedForeground mb-4">
                Organised Crime heist cooldown drops from 6 hours to 4 hours. One-time purchase.
              </p>
              <div className="space-y-2 mb-6 font-heading text-xs text-mutedForeground">
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> 4h cooldown instead of 6h</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Use from Ranking → Organised Crime</div>
              </div>
              {user?.oc_timer_reduced ? (
                <div className={`${styles.surface} border border-primary/20 rounded-sm py-3 text-center text-primary font-heading font-bold uppercase tracking-wider`}>
                  Owned
                </div>
              ) : (
                <button
                  onClick={buyOcTimer}
                  disabled={loading}
                  className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth disabled:opacity-50"
                >
                  Buy for 300 Points
                </button>
              )}
            </div>
          </div>

          {/* Garage Batch Limit */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Garage Batch Upgrade</span>
              <Zap className="text-primary" size={20} />
            </div>
            <div className="p-6">
              <p className="text-xs font-heading text-mutedForeground mb-4">
                Increase how many cars you can melt/scrap at once from the Garage.
              </p>
              <div className="flex items-center justify-between text-sm font-heading mb-6">
                <span className="text-mutedForeground">Current limit:</span>
                <span className="text-primary font-bold">{user?.garage_batch_limit ?? 6}</span>
              </div>
              <button
                onClick={upgradeGarageBatch}
                className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth"
              >
                Upgrade (+10) for 25 Points
              </button>
            </div>
          </div>

          {/* Booze Run capacity */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Booze Run Capacity</span>
              <ShoppingBag className="text-primary" size={20} />
            </div>
            <div className="p-6">
              <p className="text-xs font-heading text-mutedForeground mb-4">
                Carry more units on supply runs. Higher rank also increases base capacity.
              </p>
              <div className="flex items-center justify-between text-sm font-heading mb-2">
                <span className="text-mutedForeground">Current capacity:</span>
                <span className="text-primary font-bold">{boozeConfig?.capacity ?? '—'} units</span>
              </div>
              {(boozeConfig?.capacity_bonus_max != null) && (
                <div className="text-xs text-mutedForeground font-heading mb-4">
                  Bonus from store: {boozeConfig.capacity_bonus ?? 0} / {boozeConfig.capacity_bonus_max} (max)
                </div>
              )}
              <button
                onClick={buyBoozeCapacity}
                disabled={!user || user.points < 30 || (boozeConfig?.capacity_bonus_max != null && (boozeConfig?.capacity_bonus ?? 0) >= boozeConfig.capacity_bonus_max)}
                className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth disabled:opacity-50"
              >
                +100 capacity for 30 Points (up to 1000)
              </button>
            </div>
          </div>
          {/* Custom Car */}
          <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Custom Car</span>
              <Car className="text-primary" size={20} />
            </div>
            <div className="p-6">
              <p className="text-xs font-heading text-mutedForeground mb-4">
                Buy a custom-named car. Sits just below Exclusive rarity. Travels in 20s. Appears in your Garage.
              </p>
              <div className="space-y-2 mb-4 font-heading text-xs text-mutedForeground">
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Name your own car</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Custom rarity (below Exclusive)</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> 20s travel time</div>
                <div className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" /> Value: $40,000</div>
              </div>
              {user?.custom_car_name && (
                <div className={`${styles.surface} border border-primary/20 rounded-sm py-2 text-center font-heading mb-3`}>
                  <span className="text-primary font-bold uppercase tracking-wider">Owned</span>
                </div>
              )}
              <input
                type="text"
                placeholder="Name your car (2-30 chars)"
                value={customCarName}
                onChange={(e) => setCustomCarName(e.target.value)}
                maxLength={30}
                className={`${styles.input} w-full h-10 px-3 text-sm font-heading mb-3`}
              />
              <button
                onClick={buyCustomCar}
                disabled={!user || user.points < 500 || !customCarName.trim()}
                className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth disabled:opacity-50"
              >
                Buy for 500 Points
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Buy Bullets */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-px bg-primary/50" />
          <h2 className="text-sm font-heading font-bold text-primary/80 uppercase tracking-widest">Buy Bullets</h2>
          <div className="flex-1 h-px bg-primary/30" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {BULLET_PACKS.map((pack) => (
            <div key={pack.bullets} className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
              <div className="px-3 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-center gap-2">
                <Crosshair className="text-primary" size={14} />
                <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">{(pack.bullets / 1000).toFixed(0)}k Bullets</span>
              </div>
              <div className="p-4 text-center">
                <div className="text-2xl font-heading font-bold text-foreground mb-1">{pack.bullets.toLocaleString()}</div>
                <div className="text-xs text-mutedForeground font-heading mb-4">{pack.cost.toLocaleString()} points</div>
                <button
                  onClick={() => buyBullets(pack.bullets)}
                  disabled={!user || user.points < pack.cost}
                  className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs border border-yellow-600/50 transition-smooth disabled:opacity-50"
                >
                  Buy
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bodyguards */}
      {user && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-px bg-primary/50" />
            <h2 className="text-sm font-heading font-bold text-primary/80 uppercase tracking-widest">Bodyguards</h2>
            <div className="flex-1 h-px bg-primary/30" />
          </div>
          {eventsEnabled && event?.bodyguard_cost !== 1 && event?.name && (
            <div className={`${styles.panel} rounded-md overflow-hidden mb-4`}>
              <div className={`${styles.panelHeader} px-3 py-2 sm:px-4`}>
                <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Today&apos;s event</span>
              </div>
              <div className="p-3 sm:p-4">
                <p className="text-sm font-heading font-bold text-primary">{event.name}</p>
                <p className={`text-xs font-heading mt-1 ${styles.textMuted}`}>{event.message}</p>
              </div>
            </div>
          )}
          <div className={`${styles.panel} rounded-sm overflow-hidden p-6 mb-6`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-heading font-bold text-primary mb-1">Bodyguard Slots</h3>
                <p className="text-xs font-heading text-mutedForeground uppercase tracking-wider">Purchase slots to hire protection</p>
              </div>
              <span className="text-primary font-heading font-bold text-xl">
                {user.bodyguard_slots} / 4
              </span>
            </div>
            {user.bodyguard_slots < 4 && (
              <button
                onClick={buySlot}
                className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider px-6 py-3 border border-yellow-600/50 transition-smooth"
              >
                Buy Slot {user.bodyguard_slots + 1} ({getSlotCost(user.bodyguard_slots + 1)} points)
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {bodyguards.map((bg) => (
              <div
                key={bg.slot_number}
                className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}
              >
                <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
                  <span className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Slot {bg.slot_number}</span>
                  <Shield className="text-primary" size={20} />
                </div>
                <div className="p-6">
                  {bg.bodyguard_username && (
                    <p className="text-sm font-heading text-mutedForeground mb-4">{bg.bodyguard_username}</p>
                  )}
                  {bg.bodyguard_username ? (
                    <div className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-4`}>
                      <div className="flex items-center gap-2 text-sm font-heading">
                        <Shield size={16} className="text-primary" />
                        <span className="text-foreground font-bold">
                          {bg.is_robot ? 'Robot Guard' : 'Human Guard'}
                        </span>
                      </div>
                      <p className="text-xs text-mutedForeground font-heading mt-2">
                        Hired: {new Date(bg.hired_at).toLocaleDateString()}
                      </p>
                    </div>
                  ) : bg.slot_number <= user.bodyguard_slots ? (
                    <div className="space-y-2">
                      <button
                        onClick={() => hireBodyguard(bg.slot_number, false)}
                        className={`w-full ${styles.surface} ${styles.raisedHover} border border-primary/30 text-foreground rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-sm transition-smooth`}
                      >
                        Hire Human ({getHireCost(bg.slot_number, false)} pts)
                      </button>
                      <button
                        onClick={() => hireBodyguard(bg.slot_number, true)}
                        className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 border border-yellow-600/50 rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-sm transition-smooth"
                      >
                        Hire Robot ({getHireCost(bg.slot_number, true)} pts)
                      </button>
                    </div>
                  ) : (
                    <div className="bg-zinc-800/50 border border-primary/20 rounded-sm p-4 text-center">
                      <p className="text-sm text-mutedForeground font-heading">Purchase this slot first</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Purchase Points */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-px bg-primary/50" />
          <h2 className="text-sm font-heading font-bold text-primary/80 uppercase tracking-widest">Purchase Points</h2>
          <div className="flex-1 h-px bg-primary/30" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {PACKAGES.map((pkg) => (
            <div
              key={pkg.id}
              data-testid={`package-${pkg.id}`}
              className={`relative ${styles.panel} border rounded-sm overflow-hidden p-6 transition-smooth shadow-lg ${
                pkg.popular
                  ? 'border-primary/50 shadow-primary/10'
                  : 'border-primary/30 hover:border-primary/50 hover:shadow-primary/5'
              }`}
            >
              {pkg.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-primary text-primaryForeground px-3 py-1 rounded-sm text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="text-center mb-6">
                <ShoppingBag className="text-primary mx-auto mb-3" size={40} />
                <h3 className="text-xl font-heading font-bold text-foreground mb-2">{pkg.name}</h3>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Zap className="text-primary" size={20} />
                  <span className="text-3xl font-heading font-bold text-primary">{pkg.points}</span>
                  <span className="text-mutedForeground font-heading text-sm">points</span>
                </div>
                <div className="text-2xl font-heading font-bold text-foreground">${pkg.price}</div>
              </div>

              <button
                onClick={() => handlePurchase(pkg.id)}
                data-testid={`buy-package-${pkg.id}`}
                disabled={loading}
                className={`w-full rounded-sm font-heading font-bold uppercase tracking-wider py-3 transition-smooth disabled:opacity-50 ${
                  pkg.popular
                    ? 'bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 border border-yellow-600/50'
                    : `${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary`
                }`}
              >
                {loading ? 'Processing...' : 'Purchase'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Secure Payment</h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-6">
          <p className="text-sm text-mutedForeground font-heading leading-relaxed">
            All payments are processed securely through Stripe. Your payment information is never stored on our servers.
            After successful payment, points will be instantly added to your account.
          </p>
        </div>
      </div>
    </div>
  );
}
