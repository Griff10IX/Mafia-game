import { useState, useEffect } from 'react';
import { Shield, ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const BG_STYLES = `
  @keyframes bg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .bg-fade-in { animation: bg-fade-in 0.4s ease-out both; }
  @keyframes bg-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .bg-glow { animation: bg-glow 4s ease-in-out infinite; }
  .bg-corner::before, .bg-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .bg-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .bg-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .bg-card { transition: all 0.3s ease; }
  .bg-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .bg-row { transition: all 0.2s ease; }
  .bg-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .bg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

const BODYGUARD_SLOT_COSTS = [100, 200, 300, 400];

export default function Bodyguards() {
  const [bodyguards, setBodyguards] = useState([]);
  const [user, setUser] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedSlot, setExpandedSlot] = useState(null);

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
      toast.error('Failed to load bodyguards', { duration: 10000 });
    } finally {
      setLoading(false);
    }
  };

  const hireBodyguard = async (slot, isRobot) => {
    try {
      const response = await api.post('/bodyguards/hire', { slot, is_robot: isRobot });
      toast.success(response.data.message, { duration: 10000 });
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to hire bodyguard', { duration: 10000 });
    }
  };

  const upgradeArmour = async (slot) => {
    try {
      const res = await api.post(`/bodyguards/armour/upgrade?slot=${slot}`);
      toast.success(res.data?.message || 'Armour upgraded', { duration: 10000 });
      refreshUser();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to upgrade armour', { duration: 10000 });
    }
  };

  const getHireCost = (slotNumber, isRobot) => {
    const base = BODYGUARD_SLOT_COSTS[slotNumber - 1] * (isRobot ? 1.5 : 1);
    const mult = event?.bodyguard_cost ?? 1;
    return Math.round(base * mult);
  };

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <style>{BG_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Shield size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading bodyguards...</span>
        </div>
      </div>
    );
  }

  const activeCount = bodyguards.filter(bg => bg.bodyguard_username).length;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="bodyguards-page">
      <style>{BG_STYLES}</style>

      {/* Page header */}
      <div className="relative bg-fade-in">
        <p className="text-[10px] text-zinc-500 font-heading italic">Hire robot bodyguards (up to 4). Armour and who&apos;s watching your back.</p>
      </div>
      
      {/* Stats row */}
      <div className="flex flex-wrap items-center justify-end gap-4 bg-fade-in" style={{ animationDelay: '0.05s' }}>
        <div className="flex items-center gap-3 text-xs font-heading">
          <div className="flex items-center gap-1.5">
            <span className="text-mutedForeground">Active:</span>
            <span className="text-emerald-400 font-bold" data-testid="bodyguard-active">{activeCount}/4</span>
          </div>
        </div>
      </div>

      {/* Event Banner */}
      {eventsEnabled && event?.name && event?.bodyguard_cost !== 1 && (
        <div className="px-3 py-2 bg-primary/8 border border-primary/20 rounded-lg bg-fade-in">
          <p className="text-xs font-heading">
            <span className="text-primary font-bold">✨ {event.name}</span>
            <span className="text-mutedForeground ml-2">{event.message}</span>
          </p>
        </div>
      )}

      {/* Bodyguard Slots */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bg-card bg-corner bg-fade-in`} style={{ animationDelay: '0.05s' }}>
        <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl pointer-events-none bg-glow" />
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
            Your Bodyguards
          </span>
        </div>
        
        <div className="p-2 space-y-1">
          {bodyguards.map((bg) => {
            const isUnlocked = true;
            const hasGuard = !!bg.bodyguard_username;
            const isExpanded = expandedSlot === bg.slot_number;
            
            return (
              <div
                key={bg.slot_number}
                data-testid={`bodyguard-slot-${bg.slot_number}`}
                className={`bg-row rounded-lg transition-all ${
                  hasGuard
                    ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20'
                    : isUnlocked
                    ? 'bg-zinc-800/30 border border-transparent hover:border-primary/20'
                    : 'bg-zinc-800/20 border border-transparent opacity-60'
                }`}
              >
                {/* Main row */}
                <div 
                  className={`flex items-center justify-between gap-3 px-3 py-2 ${
                    (hasGuard || (!hasGuard && isUnlocked)) ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => {
                    if (hasGuard) {
                      setExpandedSlot(isExpanded ? null : bg.slot_number);
                    } else if (isUnlocked) {
                      hireBodyguard(bg.slot_number, true);
                    }
                  }}
                >
                  {/* Slot info */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-primary/50 text-xs">
                      {hasGuard ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : '▸'}
                    </span>
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
                      {/* Desktop: show description inline */}
                      <div className="text-[10px] text-mutedForeground truncate hidden sm:block">
                        {hasGuard ? (
                          <>
                            <Link
                              to={`/profile/${encodeURIComponent(bg.bodyguard_username)}`}
                              className="hover:text-primary"
                              data-testid={`bodyguard-profile-${bg.slot_number}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {bg.bodyguard_username}
                            </Link>
                            {bg.bodyguard_rank_name && <span> • {bg.bodyguard_rank_name}</span>}
                          </>
                        ) : isUnlocked ? (
                          'Empty — hire a robot bodyguard'
                        ) : null}
                      </div>
                      {/* Mobile: show tap hint */}
                      {hasGuard && (
                        <div className="text-[10px] text-mutedForeground sm:hidden">
                          Tap to {isExpanded ? 'collapse' : 'view details'}
                        </div>
                      )}
                      {!hasGuard && isUnlocked && (
                        <div className="text-[10px] text-mutedForeground sm:hidden">
                          Tap to hire
                        </div>
                      )}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          upgradeArmour(bg.slot_number);
                        }}
                        disabled={(bg.armour_level || 0) >= 5}
                        className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed font-heading"
                        data-testid={`upgrade-armour-${bg.slot_number}`}
                      >
                        🛡️ Upgrade
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          hireBodyguard(bg.slot_number, true);
                        }}
                        data-testid={`hire-robot-${bg.slot_number}`}
                        className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation font-heading"
                      >
                        🤖 Hire ({getHireCost(bg.slot_number, true)} pts)
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded details (mobile-friendly) */}
                {hasGuard && isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-zinc-700/30 mt-1 mx-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-zinc-900/50 rounded p-2">
                        <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Guard</div>
                        <Link
                          to={`/profile/${encodeURIComponent(bg.bodyguard_username)}`}
                          className="text-foreground font-bold hover:text-primary"
                          data-testid={`bodyguard-profile-expanded-${bg.slot_number}`}
                        >
                          {bg.bodyguard_username}
                        </Link>
                      </div>
                      <div className="bg-zinc-900/50 rounded p-2">
                        <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Type</div>
                        <div className={`font-bold ${bg.is_robot ? 'text-blue-400' : 'text-emerald-400'}`}>
                          {bg.is_robot ? '🤖 Robot' : '👤 Human'}
                        </div>
                      </div>
                      {bg.bodyguard_rank_name && (
                        <div className="bg-zinc-900/50 rounded p-2">
                          <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Rank</div>
                          <div className="text-foreground font-bold">{bg.bodyguard_rank_name}</div>
                        </div>
                      )}
                      <div className="bg-zinc-900/50 rounded p-2">
                        <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Armour</div>
                        <div className="text-primary font-bold">{bg.armour_level || 0}/5</div>
                      </div>
                      <div className="bg-zinc-900/50 rounded p-2 col-span-2">
                        <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Hired</div>
                        <div className="text-foreground font-bold">
                          {new Date(bg.hired_at).toLocaleDateString(undefined, { 
                            year: 'numeric', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="bg-art-line text-primary mx-4" />
      </div>

      {/* Info */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bg-fade-in`} style={{ animationDelay: '0.1s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
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
              <span>Each robot costs points (1st: 150, 2nd: 300, 3rd: 450, 4th: 600 pts)</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Robots are always loyal</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Attackers must defeat guards first</span>
            </li>
          </ul>
        </div>
        <div className="bg-art-line text-primary mx-4" />
      </div>
    </div>
  );
}
