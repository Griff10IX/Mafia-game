import { useState, useEffect } from 'react';
import { Shield, Plus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="bodyguards-page">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary tracking-wider uppercase">Bodyguards</h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-mutedForeground font-heading tracking-wide">Protect yourself from rival attacks</p>
      </div>

      {eventsEnabled && event?.name && (
        <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border border-primary/50 rounded-sm p-3">
          <p className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Today&apos;s Event: {event.name}</p>
          <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
        </div>
      )}

      {/* Available Slots Card */}
      <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-px bg-primary/50" />
              <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Available Slots</h2>
              <div className="w-6 h-px bg-primary/50" />
            </div>
            <span className="text-primary font-heading font-bold" data-testid="bodyguard-slots">
              {user?.bodyguard_slots} / 4
            </span>
          </div>
        </div>
        <div className="p-4">
          <p className="text-sm text-mutedForeground mb-4">
            You have <span className="text-primary font-bold">{user?.bodyguard_slots}</span> bodyguard slots. Purchase more for additional protection.
          </p>
          {user?.bodyguard_slots < 4 && (
            <button
              onClick={buySlot}
              data-testid="buy-slot-button"
              className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest px-5 py-2 text-sm transition-smooth border border-yellow-600/50 shadow-lg shadow-primary/20"
            >
              <div className="flex items-center gap-2">
                <Plus size={16} />
                Buy Slot ({getSlotCost(user.bodyguard_slots + 1)} pts)
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Bodyguard Slots Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {bodyguards.map((bg) => (
          <div
            key={bg.slot_number}
            data-testid={`bodyguard-slot-${bg.slot_number}`}
            className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}
          >
            {/* Slot Header */}
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-start gap-3">
                {bg.bodyguard_username && bg.is_robot ? (
                  <div className={`w-10 h-10 rounded-sm overflow-hidden border border-primary/30 ${styles.surface} flex-shrink-0 relative`}>
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
                    <div className={`absolute inset-0 hidden flex items-center justify-center ${styles.surface} text-primary/60`}>
                      <Shield size={18} />
                    </div>
                  </div>
                ) : null}
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-heading font-bold text-primary tracking-wide">
                    Slot {bg.slot_number}
                  </h3>
                  {bg.bodyguard_username && (
                    <Link
                      to={`/profile/${encodeURIComponent(bg.bodyguard_username)}`}
                      className="text-xs text-mutedForeground hover:text-primary transition-smooth"
                      data-testid={`bodyguard-profile-${bg.slot_number}`}
                    >
                      {bg.bodyguard_username}
                    </Link>
                  )}
                </div>
                <Shield className="text-primary/60 flex-shrink-0" size={22} />
              </div>
            </div>

            {/* Slot Body */}
            <div className="p-4">
              {bg.bodyguard_username ? (
                <div className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <Users size={14} className="text-primary" />
                    <span className="text-foreground font-heading font-medium">
                      {bg.is_robot ? 'Robot Guard' : 'Human Guard'}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs">
                    {bg.bodyguard_rank_name && (
                      <div className="flex justify-between py-1 border-b border-primary/10">
                        <span className="text-mutedForeground font-heading uppercase tracking-wider">Rank</span>
                        <span className="text-foreground font-heading">{bg.bodyguard_rank_name}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1 border-b border-primary/10">
                      <span className="text-mutedForeground font-heading uppercase tracking-wider">Armour</span>
                      <span className="text-primary font-heading font-bold">{bg.armour_level || 0}/5</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-mutedForeground font-heading uppercase tracking-wider">Hired</span>
                      <span className="text-foreground font-heading">{new Date(bg.hired_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="mt-3">
                    <button
                      onClick={() => upgradeArmour(bg.slot_number)}
                      disabled={(bg.armour_level || 0) >= 5}
                      className={`w-full ${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs transition-smooth disabled:opacity-50`}
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
                    className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs transition-smooth border border-yellow-600/50"
                  >
                    Hire Human ({getHireCost(bg.slot_number, false)} pts)
                  </button>
                  <button
                    onClick={() => hireBodyguard(bg.slot_number, true)}
                    data-testid={`hire-robot-${bg.slot_number}`}
                    className={`w-full ${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary rounded-sm font-heading font-bold uppercase tracking-wider py-2 text-xs transition-smooth`}
                  >
                    Hire Robot ({getHireCost(bg.slot_number, true)} pts)
                  </button>
                </div>
              ) : (
                <div className={`${styles.surfaceMuted} border border-primary/10 rounded-sm p-4 text-center`}>
                  <p className="text-xs text-mutedForeground font-heading uppercase tracking-wider">Purchase this slot first</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">About Bodyguards</h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4">
          <ul className="space-y-1 text-xs text-mutedForeground font-heading">
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Bodyguards protect you from rival attacks</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Purchase slots with points (base: 100, 200, 300, 400){eventsEnabled && event?.bodyguard_cost !== 1 ? ` — today: ${event.bodyguard_cost < 1 ? 'discount' : 'premium'}` : ''}</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Robot bodyguards cost 50% more but are always loyal</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Attackers must defeat your bodyguards before reaching you</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
