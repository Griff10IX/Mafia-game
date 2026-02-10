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
          <div className="text-primary text-xl font-heading font-bold mb-2">Verifying payment...</div>
          <p className="text-mutedForeground text-sm font-heading">Please wait while we confirm your purchase</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="store-page">
      <div className="flex items-center justify-center flex-col gap-2 text-center">
        <div className="flex items-center gap-3 w-full justify-center">
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-r from-transparent to-primary/60" />
          <h1 className="text-2xl md:text-4xl font-heading font-bold text-primary uppercase tracking-wider">Points Store</h1>
          <div className="h-px flex-1 max-w-[80px] md:max-w-[120px] bg-gradient-to-l from-transparent to-primary/60" />
        </div>
        <p className="text-xs font-heading text-mutedForeground uppercase tracking-widest">Purchase points and upgrades</p>
      </div>

      {eventsEnabled && event?.name && (
        <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border border-primary/30 rounded-sm p-4">
          <p className="text-sm font-heading font-bold text-primary">Today&apos;s event: {event.name}</p>
          <p className="text-xs text-mutedForeground font-heading mt-1">{event.message}</p>
        </div>
      )}

      {user && (
        <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-6">
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
          <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
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
                <div className="bg-zinc-800 border border-primary/20 rounded-sm py-3 text-center text-primary font-heading font-bold uppercase tracking-wider">
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

          {/* Garage Batch Limit */}
          <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
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
          <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5">
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Booze Run Capacity</span>
              <ShoppingBag className="text-primary" size={20} />
            </div>
            <div className="p-6">
              <p className="text-xs font-heading text-mutedForeground mb-4">
                Carry more units on supply runs. Higher rank also increases base capacity.
              </p>
              <div className="flex items-center justify-between text-sm font-heading mb-6">
                <span className="text-mutedForeground">Current capacity:</span>
                <span className="text-primary font-bold">{boozeConfig?.capacity ?? '—'} units</span>
              </div>
              <button
                onClick={buyBoozeCapacity}
                disabled={!user || user.points < 30}
                className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-3 border border-yellow-600/50 transition-smooth disabled:opacity-50"
              >
                +50 capacity for 30 Points
              </button>
            </div>
          </div>
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
            <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border border-primary/30 rounded-sm p-4 mb-4">
              <p className="text-sm font-heading font-bold text-primary">Today&apos;s event: {event.name}</p>
              <p className="text-xs text-mutedForeground font-heading mt-1">{event.message}</p>
            </div>
          )}
          <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden p-6 mb-6">
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
                className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden shadow-lg shadow-primary/5"
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
                    <div className="bg-zinc-800/50 border border-primary/20 rounded-sm p-4">
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
                        className="w-full bg-zinc-800 border border-primary/30 text-foreground hover:bg-zinc-700 rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-sm transition-smooth"
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
              className={`relative bg-gradient-to-b from-zinc-900 to-black border rounded-sm overflow-hidden p-6 transition-smooth shadow-lg ${
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
                    : 'bg-zinc-800 border border-primary/30 text-primary hover:bg-zinc-700 hover:text-primaryForeground'
                }`}
              >
                {loading ? 'Processing...' : 'Purchase'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gradient-to-b from-zinc-900 to-black border border-primary/30 rounded-sm overflow-hidden">
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
