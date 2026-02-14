import { useState, useEffect } from 'react';
import { Shield, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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
        <div className="text-primary text-xl font-heading font-bold">Loading...</div>
      </div>
    );
  }

  const activeCount = bodyguards.filter(bg => bg.bodyguard_username).length;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="bodyguards-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
            <Shield className="w-6 h-6 sm:w-7 sm:h-7" />
            Bodyguards
          </h1>
          <p className="text-xs text-mutedForeground">
            Protect yourself from rival attacks
          </p>
        </div>
        
        {/* Stats */}
        <div className="flex items-center gap-3 text-xs font-heading">
          <div className="flex items-center gap-1.5">
            <span className="text-mutedForeground">Slots:</span>
            <span className="text-primary font-bold" data-testid="bodyguard-slots">{user?.bodyguard_slots}/4</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-mutedForeground">Active:</span>
            <span className="text-emerald-400 font-bold">{activeCount}</span>
          </div>
          {user?.bodyguard_slots < 4 && (
            <button
              onClick={buySlot}
              data-testid="buy-slot-button"
              className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-2.5 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 transition-all inline-flex items-center gap-1"
            >
              <Plus size={12} />
              Buy Slot ({getSlotCost(user.bodyguard_slots + 1)} pts)
            </button>
          )}
        </div>
      </div>

      {/* Event Banner */}
      {eventsEnabled && event?.name && event?.bodyguard_cost !== 1 && (
        <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded-md">
          <p className="text-xs font-heading">
            <span className="text-primary font-bold">✨ {event.name}</span>
            <span className="text-mutedForeground ml-2">{event.message}</span>
          </p>
        </div>
      )}

      {/* Bodyguard Slots */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            Your Bodyguards
          </span>
        </div>
        
        <div className="p-2 space-y-1">
          {bodyguards.map((bg) => {
            const isUnlocked = bg.slot_number <= (user?.bodyguard_slots || 0);
            const hasGuard = !!bg.bodyguard_username;
            
            return (
              <div
                key={bg.slot_number}
                data-testid={`bodyguard-slot-${bg.slot_number}`}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md transition-all ${
                  hasGuard 
                    ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20 hover:bg-zinc-800/50' 
                    : isUnlocked 
                    ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20 hover:bg-zinc-800/50'
                    : 'bg-zinc-800/20 border border-transparent opacity-60'
                }`}
              >
                {/* Slot info */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-primary/50 text-xs">▸</span>
                  <div className="min-w-0">
                    <div className="text-sm font-heading font-bold text-foreground truncate flex items-center gap-2">
                      Slot {bg.slot_number}
                      {hasGuard && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          bg.is_robot ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {bg.is_robot ? 'Robot' : 'Human'}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-mutedForeground truncate hidden sm:block">
                      {hasGuard ? (
                        <>
                          <Link
                            to={`/profile/${encodeURIComponent(bg.bodyguard_username)}`}
                            className="hover:text-primary"
                            data-testid={`bodyguard-profile-${bg.slot_number}`}
                          >
                            {bg.bodyguard_username}
                          </Link>
                          {bg.bodyguard_rank_name && <span> • {bg.bodyguard_rank_name}</span>}
                        </>
                      ) : isUnlocked ? (
                        'Empty — hire a bodyguard'
                      ) : (
                        'Locked — buy this slot'
                      )}
                    </div>
                  </div>
                </div>

                {/* Armour */}
                <div className="shrink-0 w-12 text-center">
                  {hasGuard ? (
                    <span className="text-xs font-bold text-primary">{bg.armour_level || 0}/5</span>
                  ) : (
                    <span className="text-xs text-mutedForeground">—</span>
                  )}
                </div>

                {/* Action */}
                <div className="shrink-0">
                  {hasGuard ? (
                    <button
                      onClick={() => upgradeArmour(bg.slot_number)}
                      disabled={(bg.armour_level || 0) >= 5}
                      className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide shadow shadow-primary/20 transition-all touch-manipulation border border-yellow-600/50 disabled:opacity-40 disabled:cursor-not-allowed"
                      data-testid={`upgrade-armour-${bg.slot_number}`}
                    >
                      🛡️ Upgrade
                    </button>
                  ) : isUnlocked ? (
                    <button
                      onClick={() => hireBodyguard(bg.slot_number, true)}
                      data-testid={`hire-robot-${bg.slot_number}`}
                      className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide shadow shadow-primary/20 transition-all touch-manipulation border border-yellow-600/50"
                    >
                      🤖 Hire ({getHireCost(bg.slot_number, true)} pts)
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="bg-zinc-800/50 text-mutedForeground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-700/50 cursor-not-allowed"
                    >
                      🔒 Locked
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            ℹ️ How It Works
          </h3>
        </div>
        <div className="p-3">
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Bodyguards protect you from attacks</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Slot costs: 100, 200, 300, 400 pts</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Robots cost 50% more but are always loyal</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Attackers must defeat guards first</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
