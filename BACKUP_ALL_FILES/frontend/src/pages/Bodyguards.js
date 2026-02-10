import { useState, useEffect } from 'react';
import { Shield, Plus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { toast } from 'sonner';

function getRobotBodyguardImageUrl(slotNumber) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '') || '';
  const name = slotNumber === 1 ? 'avatar' : String(Math.min(slotNumber, 4));
  return `${base}/robot-bodyguard-${name}.png`;
}

const BODYGUARD_SLOT_COSTS = [100, 200, 300, 400];

export default function Bodyguards() {
  const [bodyguards, setBodyguards] = useState([]);
  const [user, setUser] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [bodyguardsRes, userRes, eventsRes] = await Promise.all([
        api.get('/bodyguards'),
        api.get('/auth/me'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } }))
      ]);
      setBodyguards(bodyguardsRes.data);
      setUser(userRes.data);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
    } catch (error) {
      toast.error('Failed to load bodyguards');
    } finally {
      setLoading(false);
    }
  };

  const buySlot = async () => {
    try {
      const response = await api.post('/bodyguards/slot/buy');
      toast.success(response.data.message);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to buy slot');
    }
  };

  const hireBodyguard = async (slot, isRobot) => {
    try {
      const response = await api.post('/bodyguards/hire', { slot, is_robot: isRobot });
      toast.success(response.data.message);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to hire bodyguard');
    }
  };

  const upgradeArmour = async (slot) => {
    try {
      const res = await api.post(`/bodyguards/armour/upgrade?slot=${slot}`);
      toast.success(res.data?.message || 'Armour upgraded');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to upgrade armour');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="bodyguards-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-primary mb-2">Bodyguards</h1>
        <p className="text-mutedForeground">Protect yourself from rival attacks</p>
      </div>

      {eventsEnabled && event?.name && (
        <div className="bg-primary/15 border border-primary rounded-sm p-4">
          <p className="text-sm font-semibold text-primary">Today&apos;s event: {event.name}</p>
          <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
        </div>
      )}

      <div className="bg-card border border-border rounded-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-heading font-semibold text-foreground">Available Slots</h2>
          <span className="text-primary font-mono font-bold" data-testid="bodyguard-slots">
            {user?.bodyguard_slots} / 4
          </span>
        </div>
        <p className="text-sm text-mutedForeground mb-4">
          You have {user?.bodyguard_slots} bodyguard slots available. Purchase more slots to hire additional protection.
        </p>
        {user?.bodyguard_slots < 4 && (
          <button
            onClick={buySlot}
            data-testid="buy-slot-button"
            className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm font-bold uppercase tracking-widest px-6 py-3 transition-smooth gold-glow"
          >
            <div className="flex items-center gap-2">
              <Plus size={20} />
              Buy Slot ({getSlotCost(user.bodyguard_slots + 1)} points)
            </div>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {bodyguards.map((bg) => (
          <div
            key={bg.slot_number}
            data-testid={`bodyguard-slot-${bg.slot_number}`}
            className="bg-card border border-border rounded-sm p-6"
          >
            <div className="flex items-start gap-4 mb-4">
              {bg.bodyguard_username && bg.is_robot ? (
                <div className="w-14 h-14 rounded-sm overflow-hidden border border-border bg-secondary flex-shrink-0 relative">
                  <img
                    src={getRobotBodyguardImageUrl(bg.slot_number)}
                    alt="Robot bodyguard"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      const fallback = e.target.nextElementSibling;
                      if (fallback) fallback.classList.remove('hidden');
                    }}
                  />
                  <div className="absolute inset-0 hidden flex items-center justify-center bg-secondary text-mutedForeground">
                    <Shield size={24} />
                  </div>
                </div>
              ) : null}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-heading font-bold text-foreground mb-1">
                  Slot {bg.slot_number}
                </h3>
                {bg.bodyguard_username && (
                  <Link
                    to={`/profile/${encodeURIComponent(bg.bodyguard_username)}`}
                    className="text-sm text-mutedForeground hover:text-primary hover:underline transition-smooth"
                    data-testid={`bodyguard-profile-${bg.slot_number}`}
                  >
                    {bg.bodyguard_username}
                  </Link>
                )}
              </div>
              <Shield className="text-primary flex-shrink-0" size={28} />
            </div>

            {bg.bodyguard_username ? (
              <div className="bg-secondary/50 border border-border rounded-sm p-4">
                <div className="flex items-center gap-2 text-sm">
                  <Users size={16} className="text-primary" />
                  <span className="text-foreground font-medium">
                    {bg.is_robot ? 'Robot Guard' : 'Human Guard'}
                  </span>
                </div>
                {bg.bodyguard_rank_name && (
                  <p className="text-xs text-mutedForeground mt-2">
                    Rank: <span className="text-foreground font-semibold">{bg.bodyguard_rank_name}</span>
                  </p>
                )}
                <p className="text-xs text-mutedForeground mt-1">
                  Armour: <span className="text-foreground font-mono">{bg.armour_level || 0}/5</span>
                </p>
                <p className="text-xs text-mutedForeground mt-2">
                  Hired: {new Date(bg.hired_at).toLocaleDateString()}
                </p>

                <div className="mt-3">
                  <button
                    onClick={() => upgradeArmour(bg.slot_number)}
                    disabled={(bg.armour_level || 0) >= 5}
                    className="w-full bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm font-bold uppercase tracking-wider py-2 text-xs transition-smooth disabled:opacity-50"
                    data-testid={`upgrade-armour-${bg.slot_number}`}
                  >
                    Upgrade Armour
                  </button>
                </div>
              </div>
            ) : bg.slot_number <= (user?.bodyguard_slots || 0) ? (
              <div className="space-y-2">
                <button
                  onClick={() => hireBodyguard(bg.slot_number, false)}
                  data-testid={`hire-human-${bg.slot_number}`}
                  className="w-full bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm font-bold uppercase tracking-wider py-2 text-sm transition-smooth"
                >
                  Hire Human ({getHireCost(bg.slot_number, false)} pts)
                </button>
                <button
                  onClick={() => hireBodyguard(bg.slot_number, true)}
                  data-testid={`hire-robot-${bg.slot_number}`}
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

      <div className="bg-card border border-border rounded-sm p-6">
        <h3 className="text-xl font-heading font-semibold text-primary mb-3">About Bodyguards</h3>
        <ul className="space-y-2 text-sm text-mutedForeground">
          <li>• Bodyguards protect you from rival attacks</li>
          <li>• Purchase slots with points (base: 100, 200, 300, 400){eventsEnabled && event?.bodyguard_cost !== 1 ? ` — today: ${event.bodyguard_cost < 1 ? 'discount' : 'premium'} applies` : ''}</li>
          <li>• Robot bodyguards cost 50% more but are always loyal</li>
          <li>• Attackers must defeat your bodyguards before reaching you</li>
        </ul>
      </div>
    </div>
  );
}
