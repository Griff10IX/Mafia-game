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

// Match backend bodyguards.py: BODYGUARD_SLOT_COSTS = [75, 150, 300, 450]
const BODYGUARD_SLOT_COSTS = [75, 150, 300, 450];
// Match backend: BODYGUARD_ARMOUR_UPGRADE_COSTS = {0: 50, 1: 100, 2: 200, 3: 400, 4: 800}
const BODYGUARD_ARMOUR_UPGRADE_COSTS = { 0: 50, 1: 100, 2: 200, 3: 400, 4: 800 };

function formatDuration(totalSeconds) {
  if (totalSeconds == null || totalSeconds < 0) return '—';
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function formatInflationCountdown(isoEnd) {
  if (!isoEnd) return null;
  try {
    const end = new Date(isoEnd.replace('Z', ''));
    const now = new Date();
    const ms = Math.max(0, end - now);
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  } catch {
    return null;
  }
}

export default function Bodyguards() {
  const [bodyguards, setBodyguards] = useState([]);
  const [user, setUser] = useState(null);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [nextHireInflationPct, setNextHireInflationPct] = useState(0);
  const [inflationWindowEndsAt, setInflationWindowEndsAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedSlot, setExpandedSlot] = useState(null);
  const [upgradingSlot, setUpgradingSlot] = useState(null);
  const [bgStats, setBgStats] = useState(null);
  const [invites, setInvites] = useState({ sent: [], received: [] });
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const [inflationCountdown, setInflationCountdown] = useState(null);
  useEffect(() => {
    if (!inflationWindowEndsAt) {
      setInflationCountdown(null);
      return;
    }
    const tick = () => setInflationCountdown(formatInflationCountdown(inflationWindowEndsAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [inflationWindowEndsAt]);

  const fetchData = async () => {
    try {
      const [bodyguardsRes, userRes, eventsRes, inflationRes, statsRes, invitesRes] = await Promise.all([
        api.get('/bodyguards'),
        api.get('/auth/me'),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
        api.get('/bodyguards/inflation').catch(() => ({ data: { next_hire_inflation_pct: 0 } })),
        api.get('/bodyguards/stats').catch(() => ({ data: null })),
        api.get('/bodyguards/invites').catch(() => ({ data: { sent: [], received: [] } }))
      ]);
      setBodyguards(bodyguardsRes.data);
      setUser(userRes.data);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
      setNextHireInflationPct(inflationRes.data?.next_hire_inflation_pct ?? 0);
      setInflationWindowEndsAt(inflationRes.data?.inflation_window_ends_at ?? null);
      setBgStats(statsRes.data ?? null);
      setInvites(invitesRes.data ?? { sent: [], received: [] });
    } catch (error) {
      toast.error('Failed to load bodyguards', { duration: 10000 });
    } finally {
      setLoading(false);
    }
  };

  const hireBodyguard = async (slot, isRobot) => {
    try {
      const response = await api.post('/bodyguards/hire', { slot, is_robot: isRobot });
      toast.success(response?.data?.message ?? 'Bodyguard hired', { duration: 10000 });
      const name = response?.data?.bodyguard_name || 'Robot';
      setBodyguards((prev) =>
        prev.map((b) =>
          b.slot_number === slot
            ? { ...b, bodyguard_username: name, is_robot: true, armour_level: 0, hired_at: new Date().toISOString(), bodyguard_rank_name: null }
            : b
        )
      );
      refreshUser().catch(() => {});
      fetchData().catch(() => {});
    } catch (error) {
      const detail = (error.response?.data?.detail || 'Failed to hire bodyguard').toString();
      refreshUser().catch(() => {});
      fetchData().catch(() => {});
      if (detail.includes('Slot already occupied')) {
        toast.info('Slot already filled — list updated', { duration: 4000 });
      } else {
        toast.error(detail, { duration: 10000 });
      }
    }
  };

  const upgradeArmour = async (slot) => {
    setUpgradingSlot(slot);
    try {
      const res = await api.post(`/bodyguards/armour/upgrade?slot=${slot}`);
      toast.success(res.data?.message || 'Armour upgraded', { duration: 10000 });
      refreshUser().catch(() => {});
      fetchData().catch(() => {});
    } catch (error) {
      const detail = (error.response?.data?.detail || 'Failed to upgrade armour').toString();
      refreshUser().catch(() => {});
      fetchData().catch(() => {});
      if (detail.includes('already maxed')) {
        toast.info('Already at max level — list updated', { duration: 4000 });
      } else {
        toast.error(detail, { duration: 10000 });
      }
    } finally {
      setUpgradingSlot(null);
    }
  };

  const getUpgradeCost = (armourLevel) => {
    const base = BODYGUARD_ARMOUR_UPGRADE_COSTS[armourLevel ?? 0] ?? 0;
    const mult = event?.bodyguard_cost ?? 1;
    return Math.floor(base * mult);
  };

  const getHireCost = (slotNumber) => {
    const base = BODYGUARD_SLOT_COSTS[slotNumber - 1];
    const mult = event?.bodyguard_cost ?? 1;
    const inflationMult = 1 + (nextHireInflationPct ?? 0) / 100;
    return Math.round(base * mult * inflationMult);
  };

  /** Human bodyguards are 25% cheaper than robots (invite cost). */
  const getHumanCost = (slotNumber) => Math.floor(getHireCost(slotNumber) * 0.75);

  const nextEmptySlot = bodyguards.find((b) => !b.bodyguard_username)?.slot_number;
  const robotBodyguards = bodyguards.filter((b) => b.is_robot && b.bodyguard_username);
  const humanBodyguards = bodyguards.filter((b) => !b.is_robot && b.bodyguard_username);

  const sendInvite = async () => {
    const username = (inviteUsername || '').trim();
    if (!username) {
      toast.error('Enter a username');
      return;
    }
    if (activeCount >= 4 || !nextEmptySlot) {
      toast.error('No bodyguard slots available');
      return;
    }
    setInviting(true);
    try {
      await api.post('/bodyguards/invite', {
        target_username: username,
        payment_amount: getHumanCost(nextEmptySlot),
        payment_type: 'points',
        duration_hours: 24,
      });
      toast.success('Bodyguard invite sent');
      setInviteUsername('');
      fetchData().catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to send invite', { duration: 10000 });
    } finally {
      setInviting(false);
    }
  };

  const renderBodyguardCard = (bg) => {
    const hasGuard = !!bg.bodyguard_username;
    const isExpanded = expandedSlot === bg.slot_number;
    return (
      <div
        key={bg.slot_number}
        data-testid={`bodyguard-slot-${bg.slot_number}`}
        className="bg-row rounded-lg transition-all bg-zinc-800/30 border border-transparent hover:border-primary/20"
      >
        <div
          className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer"
          onClick={() => setExpandedSlot(isExpanded ? null : bg.slot_number)}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-primary/50 text-xs">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-heading font-bold text-foreground truncate flex items-center gap-2">
                Slot {bg.slot_number}
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                  bg.is_robot ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                }`}>
                  {bg.is_robot ? 'Robot' : 'Human'}
                </span>
              </div>
              <div className="text-[10px] text-mutedForeground truncate hidden sm:block">
                <Link
                  to={`/profile/${encodeURIComponent(bg.bodyguard_username)}`}
                  className="hover:text-primary"
                  data-testid={`bodyguard-profile-${bg.slot_number}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {bg.bodyguard_username}
                </Link>
                {bg.bodyguard_rank_name && <span> • {bg.bodyguard_rank_name}</span>}
              </div>
              <div className="text-[10px] text-mutedForeground sm:hidden">
                Tap to {isExpanded ? 'collapse' : 'view details'}
              </div>
            </div>
          </div>
          <div className="shrink-0 w-12 text-center">
            <span className="text-xs font-bold text-primary">{bg.armour_level || 0}/5</span>
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => upgradeArmour(bg.slot_number)}
              disabled={(bg.armour_level || 0) >= 5}
              className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed font-heading"
              data-testid={`upgrade-armour-${bg.slot_number}`}
            >
              {upgradingSlot === bg.slot_number ? '…' : (bg.armour_level || 0) >= 5 ? '🛡️ Max' : `🛡️ Upgrade (${getUpgradeCost(bg.armour_level)} pts)`}
            </button>
          </div>
        </div>
        {isExpanded && (
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
                  {bg.hired_at && new Date(bg.hired_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
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
        <p className="text-[10px] text-zinc-500 font-heading italic">Hire robots or invite humans (4 bodyguards max total). Armour and who&apos;s watching your back.</p>
      </div>
      
      {/* Stats row */}
      <div className="flex flex-wrap items-center justify-end gap-4 bg-fade-in" style={{ animationDelay: '0.05s' }}>
        <div className="flex items-center gap-3 text-xs font-heading">
          {(nextHireInflationPct > 0 || inflationCountdown) && (
            <div className="flex items-center gap-1.5 text-amber-400/90">
              {nextHireInflationPct > 0 && (
                <span>Next hire: <strong>+{nextHireInflationPct}%</strong></span>
              )}
              {inflationCountdown && (
                <span className="text-mutedForeground">· Resets in {inflationCountdown}</span>
              )}
            </div>
          )}
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

        <div className="p-2 space-y-4">
          {/* Robots */}
          <div>
            <h4 className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-wider px-1 mb-1.5">Robots</h4>
            <div className="space-y-1">
              {robotBodyguards.map((bg) => renderBodyguardCard(bg))}
              {activeCount < 4 && nextEmptySlot && (
                <div className="bg-row rounded-lg bg-zinc-800/30 border border-transparent hover:border-primary/20 px-3 py-2 flex items-center justify-between gap-3">
                  <span className="text-[10px] text-mutedForeground">Empty slot · hire a robot</span>
                  <button
                    onClick={() => hireBodyguard(nextEmptySlot, true)}
                    data-testid="hire-robot-next"
                    className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 font-heading"
                  >
                    {`🤖 Hire (${getHireCost(nextEmptySlot)} pts${nextHireInflationPct > 0 ? ` +${nextHireInflationPct}%` : ''})`}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Humans */}
          <div>
            <h4 className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-wider px-1 mb-1.5">Humans</h4>
            <div className="space-y-1">
              {humanBodyguards.map((bg) => renderBodyguardCard(bg))}
              {activeCount < 4 && nextEmptySlot && (
                <div className="bg-row rounded-lg bg-zinc-800/30 border border-transparent hover:border-primary/20 px-3 py-2 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Username"
                    value={inviteUsername}
                    onChange={(e) => setInviteUsername(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
                    className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground w-32 placeholder:text-zinc-500"
                  />
                  <button
                    onClick={sendInvite}
                    disabled={inviting}
                    data-testid="invite-human-next"
                    className="bg-emerald-500/20 text-emerald-400 rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border border-emerald-500/40 hover:bg-emerald-500/30 font-heading disabled:opacity-60"
                  >
                    {inviting ? '…' : `👤 Invite (${getHumanCost(nextEmptySlot)} pts)`}
                  </button>
                  <span className="text-[10px] text-mutedForeground">25% cheaper than robot</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="bg-art-line text-primary mx-4" />
      </div>

      {/* Bodyguard stats */}
      {bgStats && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bg-fade-in`} style={{ animationDelay: '0.08s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
              📊 Bodyguard Stats
            </h3>
          </div>
          <div className="p-3">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11px] text-mutedForeground font-heading">
              <li className="flex items-start gap-1.5">
                <span className="text-primary shrink-0">•</span>
                <span><strong className="text-foreground">Bodyguards hired:</strong> {bgStats.total_hired ?? 0}</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-primary shrink-0">•</span>
                <span><strong className="text-foreground">Points spent on hires:</strong> {(bgStats.total_spent_hires ?? 0).toLocaleString()}</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-primary shrink-0">•</span>
                <span><strong className="text-foreground">Spent on upgrades:</strong> {(bgStats.total_spent_upgrades ?? 0).toLocaleString()}</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-primary shrink-0">•</span>
                <span>
                  <strong className="text-foreground">Longest surviving:</strong>{' '}
                  {bgStats.longest_surviving_seconds != null && bgStats.longest_surviving_name
                    ? `${formatDuration(bgStats.longest_surviving_seconds)} (${bgStats.longest_surviving_name})`
                    : '—'}
                </span>
              </li>
            </ul>
          </div>
          <div className="bg-art-line text-primary mx-4" />
        </div>
      )}

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
              <span>4 bodyguards max total (robots + humans combined)</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Slot hire (robots): 75, 150, 300, 450 pts{nextHireInflationPct > 0 ? ` (next +${nextHireInflationPct}%)` : ''} · resets 3h after last hire</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Humans: invite a player; cost 25% less than robot for that slot</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-primary shrink-0">•</span>
              <span>Armour upgrade: 50, 100, 200, 400, 800 pts (levels 1→5)</span>
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
