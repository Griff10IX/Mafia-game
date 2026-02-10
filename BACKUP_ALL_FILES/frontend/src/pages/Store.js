import { useState, useEffect } from 'react';
import { ShoppingBag, Zap, Check, Shield, Star } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

const PACKAGES = [
  { id: 'starter', name: 'Starter Pack', points: 100, price: 4.99, popular: false },
  { id: 'bronze', name: 'Bronze Pack', points: 250, price: 9.99, popular: false },
  { id: 'silver', name: 'Silver Pack', points: 600, price: 19.99, popular: true },
  { id: 'gold', name: 'Gold Pack', points: 1500, price: 49.99, popular: false },
  { id: 'platinum', name: 'Platinum Pack', points: 3500, price: 99.99, popular: false },
];

const BODYGUARD_SLOT_COSTS = [100, 200, 300, 400];

export default function Store() {
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [user, setUser] = useState(null);
  const [bodyguards, setBodyguards] = useState([]);
  const [boozeConfig, setBoozeConfig] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);

  useEffect(() => {
    fetchData();
    
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    
    if (sessionId) {
      checkPaymentStatus(sessionId);
    }
  }, []);

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
          <div className="text-primary text-xl font-heading mb-2">Verifying payment...</div>
          <p className="text-mutedForeground text-sm">Please wait while we confirm your purchase</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="store-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Points Store</h1>
        <p className="text-mutedForeground">Purchase points and upgrades to expand your empire</p>
      </div>

      {eventsEnabled && event?.name && (
        <div className="bg-primary/15 border border-primary rounded-sm p-4">
          <p className="text-sm font-semibold text-primary">Today&apos;s event: {event.name}</p>
          <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
        </div>
      )}

      {user && (
        <div className="bg-card border border-border rounded-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-heading font-semibold text-foreground mb-1">Your Points</h3>
              <p className="text-sm text-mutedForeground">Use points to unlock premium features</p>
            </div>
            <div className="text-3xl font-mono font-bold text-primary">{user.points} pts</div>
          </div>
        </div>
      )}

      {/* Premium Upgrades */}
      <div>
        <h2 className="text-2xl font-heading font-semibold text-foreground mb-4">Premium Upgrades</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Premium Rank Bar */}
          <div className="bg-card border border-primary rounded-sm p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-heading font-bold text-foreground mb-2">Premium Rank Bar</h3>
                <p className="text-sm text-mutedForeground mb-4">
                  Get detailed progress tracking with exact numbers and amounts needed for next rank
                </p>
              </div>
              <Star className="text-primary" size={32} />
            </div>

            <div className="flex items-center gap-2 mb-4">
              <Check size={16} className="text-primary" />
              <span className="text-sm text-mutedForeground">Detailed money progress</span>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <Check size={16} className="text-primary" />
              <span className="text-sm text-mutedForeground">Exact rank points tracking</span>
            </div>
            <div className="flex items-center gap-2 mb-6">
              <Check size={16} className="text-primary" />
              <span className="text-sm text-mutedForeground">Shows amounts needed</span>
            </div>

            {user?.premium_rank_bar ? (
              <div className="bg-secondary border border-border rounded-sm py-3 text-center text-primary font-bold uppercase">
                Owned
              </div>
            ) : (
              <button
                onClick={buyPremiumRankBar}
                className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth gold-glow"
              >
                Buy for 50 Points
              </button>
            )}
          </div>

          {/* Garage Batch Limit */}
          <div className="bg-card border border-border rounded-sm p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-heading font-bold text-foreground mb-2">Garage Batch Upgrade</h3>
                <p className="text-sm text-mutedForeground mb-4">
                  Increase how many cars you can melt/scrap at once from the Garage.
                </p>
              </div>
              <Zap className="text-primary" size={32} />
            </div>

            <div className="flex items-center justify-between text-sm mb-6">
              <span className="text-mutedForeground">Current limit:</span>
              <span className="text-primary font-mono font-bold">{user?.garage_batch_limit ?? 6}</span>
            </div>

            <button
              onClick={upgradeGarageBatch}
              className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth gold-glow"
            >
              Upgrade (+10) for 25 Points
            </button>
          </div>

          {/* Booze Run capacity */}
          <div className="bg-card border border-border rounded-sm p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-heading font-bold text-foreground mb-2">Booze Run Capacity</h3>
                <p className="text-sm text-mutedForeground mb-4">
                  Carry more units of booze on supply runs. Higher rank also increases base capacity.
                </p>
              </div>
              <ShoppingBag className="text-primary" size={32} />
            </div>
            <div className="flex items-center justify-between text-sm mb-6">
              <span className="text-mutedForeground">Current capacity:</span>
              <span className="text-primary font-mono font-bold">{boozeConfig?.capacity ?? '—'} units</span>
            </div>
            <button
              onClick={buyBoozeCapacity}
              disabled={!user || user.points < 30}
              className="w-full bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth gold-glow disabled:opacity-50"
            >
              +50 capacity for 30 Points
            </button>
          </div>
        </div>
      </div>

      {/* Bodyguards */}
      {user && (
        <div>
          <h2 className="text-2xl font-heading font-semibold text-foreground mb-4">Bodyguards</h2>
          {eventsEnabled && event?.bodyguard_cost !== 1 && event?.name && (
            <div className="bg-primary/15 border border-primary rounded-sm p-4 mb-4">
              <p className="text-sm font-semibold text-primary">Today&apos;s event: {event.name}</p>
              <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
            </div>
          )}
          <div className="bg-card border border-border rounded-sm p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-heading font-semibold text-foreground mb-1">Bodyguard Slots</h3>
                <p className="text-sm text-mutedForeground">Purchase slots to hire protection</p>
              </div>
              <span className="text-primary font-mono font-bold text-xl">
                {user.bodyguard_slots} / 4
              </span>
            </div>
            {user.bodyguard_slots < 4 && (
              <button
                onClick={buySlot}
                className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest px-6 py-3 transition-smooth gold-glow"
              >
                Buy Slot {user.bodyguard_slots + 1} ({getSlotCost(user.bodyguard_slots + 1)} points)
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {bodyguards.map((bg) => (
              <div
                key={bg.slot_number}
                className="bg-card border border-border rounded-sm p-6"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-heading font-bold text-foreground mb-1">
                      Slot {bg.slot_number}
                    </h3>
                    {bg.bodyguard_username && (
                      <p className="text-sm text-mutedForeground">{bg.bodyguard_username}</p>
                    )}
                  </div>
                  <Shield className="text-primary" size={28} />
                </div>

                {bg.bodyguard_username ? (
                  <div className="bg-secondary/50 border border-border rounded-sm p-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Shield size={16} className="text-primary" />
                      <span className="text-foreground font-medium">
                        {bg.is_robot ? 'Robot Guard' : 'Human Guard'}
                      </span>
                    </div>
                    <p className="text-xs text-mutedForeground mt-2">
                      Hired: {new Date(bg.hired_at).toLocaleDateString()}
                    </p>
                  </div>
                ) : bg.slot_number <= user.bodyguard_slots ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => hireBodyguard(bg.slot_number, false)}
                      className="w-full bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm font-bold uppercase tracking-wider py-2 text-sm transition-smooth"
                    >
                      Hire Human ({getHireCost(bg.slot_number, false)} pts)
                    </button>
                    <button
                      onClick={() => hireBodyguard(bg.slot_number, true)}
                      className="w-full bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm font-bold uppercase tracking-wider py-2 text-sm transition-smooth"
                    >
                      Hire Robot ({getHireCost(bg.slot_number, true)} pts)
                    </button>
                  </div>
                ) : (
                  <div className="bg-secondary/50 border border-border rounded-sm p-4 text-center">
                    <p className="text-sm text-mutedForeground">Purchase this slot first</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Purchase Points */}
      <div>
        <h2 className="text-2xl font-heading font-semibold text-foreground mb-4">Purchase Points</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {PACKAGES.map((pkg) => (
            <div
              key={pkg.id}
              data-testid={`package-${pkg.id}`}
              className={`relative bg-card border rounded-sm p-6 transition-smooth ${
                pkg.popular
                  ? 'border-primary shadow-lg gold-glow'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              {pkg.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-primary text-primaryForeground px-3 py-1 rounded-sm text-xs font-bold uppercase tracking-wider">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="text-center mb-6">
                <ShoppingBag className="text-primary mx-auto mb-3" size={40} />
                <h3 className="text-2xl font-heading font-bold text-foreground mb-2">{pkg.name}</h3>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Zap className="text-primary" size={20} />
                  <span className="text-3xl font-mono font-bold text-primary">{pkg.points}</span>
                  <span className="text-mutedForeground">points</span>
                </div>
                <div className="text-2xl font-bold text-foreground">${pkg.price}</div>
              </div>

              <button
                onClick={() => handlePurchase(pkg.id)}
                data-testid={`buy-package-${pkg.id}`}
                disabled={loading}
                className={`w-full rounded-sm font-bold uppercase tracking-widest py-3 transition-smooth disabled:opacity-50 ${
                  pkg.popular
                    ? 'bg-primary text-primaryForeground hover:opacity-90 gold-glow'
                    : 'bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground'
                }`}
              >
                {loading ? 'Processing...' : 'Purchase'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm p-6">
        <h3 className="text-xl font-heading font-semibold text-primary mb-3">Secure Payment</h3>
        <p className="text-sm text-mutedForeground">
          All payments are processed securely through Stripe. Your payment information is never stored on our servers. 
          After successful payment, points will be instantly added to your account.
        </p>
      </div>
    </div>
  );
}
