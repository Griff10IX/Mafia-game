import { useState, useEffect } from 'react';
import { Shield, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const BG_STYLES = `
  @keyframes bg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .bg-fade-in { animation: bg-fade-in 0.4s ease-out both; }
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
  const [bodyguardFor, setBodyguardFor] = useState(null);
  const [bodyguardProfit, setBodyguardProfit] = useState(null);
  const [invites, setInvites] = useState({ sent: [], received: [] });
  const [inviteUsername, setInviteUsername] = useState('');
  const [invitePaymentPoints, setInvitePaymentPoints] = useState(0);
  const [invitePaymentMoney, setInvitePaymentMoney] = useState(0);
  const [invitePayoutWeekday, setInvitePayoutWeekday] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [actingInviteId, setActingInviteId] = useState(null);
  const [cancellingInviteId, setCancellingInviteId] = useState(null);
  const [droppingSlot, setDroppingSlot] = useState(null);
  const [bodyguardLastDropAt, setBodyguardLastDropAt] = useState(null);
  const [hiringSlots, setHiringSlots] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const DROP_COOLDOWN_HOURS = 3;

  const WEEKDAY_OPTIONS = [
    { value: 0, label: 'Monday' },
    { value: 1, label: 'Tuesday' },
    { value: 2, label: 'Wednesday' },
    { value: 3, label: 'Thursday' },
    { value: 4, label: 'Friday' },
    { value: 5, label: 'Saturday' },
    { value: 6, label: 'Sunday' },
  ];

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
        api.get('/events/active').catch((e) => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Bodyguards] events/active failed', e?.response?.status, e?.response?.data);
          }
          return { data: { event: null, events_enabled: false } };
        }),
        api.get('/bodyguards/inflation').catch((e) => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Bodyguards] inflation failed', e?.response?.status, e?.response?.data);
          }
          return { data: { next_hire_inflation_pct: 0 } };
        }),
        api.get('/bodyguards/stats').catch((e) => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Bodyguards] stats failed', e?.response?.status, e?.response?.data);
          }
          return { data: null };
        }),
        api.get('/bodyguards/invites').catch((e) => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Bodyguards] invites failed', e?.response?.status, e?.response?.data);
          }
          return { data: { sent: [], received: [] } };
        })
      ]);
      if (bodyguardsRes.status >= 400) {
        const msg = bodyguardsRes.data?.detail ?? bodyguardsRes.statusText ?? 'Bodyguards request failed';
        console.error('[Bodyguards] /bodyguards bad status', bodyguardsRes.status, bodyguardsRes.data);
        toast.error(`Bodyguards: ${msg}`, { duration: 12000 });
        setLoading(false);
        return;
      }
      if (userRes.status >= 400) {
        const msg = userRes.data?.detail ?? userRes.statusText ?? 'Auth failed';
        if (process.env.NODE_ENV === 'development') {
          console.error('[Bodyguards] /auth/me bad status', userRes.status, userRes.data);
        } else {
          console.error('[Bodyguards] /auth/me bad status', userRes.status);
        }
        toast.error(`Auth: ${msg}`, { duration: 12000 });
        setLoading(false);
        return;
      }
      const bgData = bodyguardsRes.data;
      setBodyguards(Array.isArray(bgData) ? bgData : (bgData?.bodyguards ?? []));
      setBodyguardFor(bgData?.bodyguard_for ?? null);
      setBodyguardProfit(bgData?.bodyguard_profit ?? null);
      setBodyguardLastDropAt(bgData?.bodyguard_last_drop_at ?? null);
      setUser(userRes.data);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
      setNextHireInflationPct(inflationRes.data?.next_hire_inflation_pct ?? 0);
      setInflationWindowEndsAt(inflationRes.data?.inflation_window_ends_at ?? null);
      setBgStats(statsRes.data ?? null);
      setInvites(invitesRes.data ?? { sent: [], received: [] });
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail ?? error.response?.data?.message ?? error.message;
      const which = error.config?.url?.includes('bodyguards') ? 'bodyguards' : error.config?.url?.includes('auth') ? 'auth' : 'request';
      if (process.env.NODE_ENV === 'development') {
        console.error('[Bodyguards] fetchData failed', { which, status, detail, url: error.config?.url, data: error.response?.data });
      } else {
        console.error('[Bodyguards] fetchData failed', { which, status, detail, url: error.config?.url });
      }
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      toast.error(`Failed to load ${which}: ${msg || status || 'Network error'}`, { duration: 12000 });
      setBodyguards([]);
      setUser(null);
      setBodyguardFor(null);
      setBodyguardProfit(null);
      setBodyguardLastDropAt(null);
      setBgStats(null);
      setInvites({ sent: [], received: [] });
      setNextHireInflationPct(0);
      setInflationWindowEndsAt(null);
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchData();
      refreshUser().catch(() => {});
      toast.success('Refreshed');
    } finally {
      setRefreshing(false);
    }
  };

  const hireBodyguard = async (slot, isRobot) => {
    setHiringSlots((prev) => new Set(prev).add(slot));
    try {
      const response = await api.post('/bodyguards/hire', { slot, is_robot: isRobot });
      toast.success(response?.data?.message ?? 'Bodyguard hired', { duration: 10000 });
      refreshUser().catch(() => {});
      await fetchData();
    } catch (error) {
      const raw = error.response?.data?.detail;
      const detail =
        typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? raw.map((x) => (typeof x === 'string' ? x : x?.msg || x?.message || JSON.stringify(x))).join(', ')
            : raw != null
              ? String(raw)
              : 'Failed to hire bodyguard';
      refreshUser().catch(() => {});
      fetchData().catch(() => {});
      if (detail.includes('Slot already occupied')) {
        toast.info('Slot already filled — list updated', { duration: 4000 });
      } else {
        toast.error(detail, { duration: 10000 });
      }
    } finally {
      setHiringSlots((prev) => {
        const next = new Set(prev);
        next.delete(slot);
        return next;
      });
    }
  };

  const upgradeArmour = async (slot) => {
    setUpgradingSlot(slot);
    try {
      const res = await api.post(`/bodyguards/armour/upgrade?slot=${slot}`);
      const newLevel = res.data?.armour_level;
      if (typeof newLevel === 'number') {
        setBodyguards((prev) =>
          prev.map((b) => (b.slot_number === slot ? { ...b, armour_level: newLevel } : b))
        );
      }
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

  const nextEmptySlot = bodyguards.find((b) => !b.bodyguard_username && !hiringSlots.has(b.slot_number))?.slot_number;
  // All active bodyguards sorted by slot number (mixed robots and humans together)
  const activeBodyguards = bodyguards
    .filter((b) => b.bodyguard_username)
    .sort((a, b) => (a.slot_number ?? 0) - (b.slot_number ?? 0));

  const sendInvite = async () => {
    const username = (inviteUsername || '').trim();
    if (!username) {
      toast.error('Enter a username');
      return;
    }
    const pts = Math.max(0, parseInt(invitePaymentPoints, 10) || 0);
    const money = Math.max(0, parseInt(invitePaymentMoney, 10) || 0);
    if (pts === 0 && money === 0) {
      toast.error('Enter points and/or money per week for the bodyguard');
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
        payment_points: pts,
        payment_money: money,
        payout_weekday: invitePayoutWeekday,
        duration_hours: 168,
      });
      toast.success('Bodyguard invite sent');
      setInviteUsername('');
      setInvitePaymentPoints(0);
      setInvitePaymentMoney(0);
      fetchData().catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to send invite', { duration: 10000 });
    } finally {
      setInviting(false);
    }
  };

  const acceptInvite = async (inviteId) => {
    if (actingInviteId) return;
    setActingInviteId(inviteId);
    try {
      await api.post(`/bodyguards/invites/${inviteId}/accept`);
      toast.success('Invite accepted. You are now their bodyguard.');
      await fetchData();
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg || d.message).filter(Boolean).join(', ') || 'Failed to accept invite' : 'Failed to accept invite';
      toast.error(msg, { duration: 8000 });
    } finally {
      setActingInviteId(null);
    }
  };

  const rejectInvite = async (inviteId) => {
    if (actingInviteId) return;
    setActingInviteId(inviteId);
    try {
      await api.post(`/bodyguards/invites/${inviteId}/decline`);
      toast.success('Invite declined.');
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to decline invite', { duration: 8000 });
    } finally {
      setActingInviteId(null);
    }
  };

  const cancelInvite = async (inviteId) => {
    setCancellingInviteId(inviteId);
    try {
      await api.post(`/bodyguards/invites/${inviteId}/cancel`);
      toast.success('Invite cancelled');
      setInvites((prev) => ({
        ...prev,
        sent: (prev.sent || []).filter((inv) => inv.id !== inviteId),
      }));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to cancel invite', { duration: 8000 });
    } finally {
      setCancellingInviteId(null);
      fetchData().catch(() => {});
    }
  };

  const dropBodyguard = async (slot) => {
    if (droppingSlot) return;
    setDroppingSlot(slot);
    try {
      await api.post(`/bodyguards/drop?slot=${slot}`);
      toast.success('Bodyguard dropped. Payments cancelled.');
      setBodyguards((prev) =>
        prev.map((b) =>
          b.slot_number === slot
            ? { ...b, bodyguard_username: null, bodyguard_rank_name: null, armour_level: 0, hired_at: null, payment_points: 0, payment_money: 0, payout_weekday: null }
            : b
        )
      );
      fetchData().catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to drop bodyguard', { duration: 8000 });
    } finally {
      setDroppingSlot(null);
    }
  };

  const getDropCooldownMinsLeft = (lastDropIso) => {
    if (!lastDropIso) return 0;
    try {
      const last = new Date(lastDropIso.replace('Z', '')).getTime();
      const end = last + DROP_COOLDOWN_HOURS * 60 * 60 * 1000;
      return Math.max(0, Math.ceil((end - Date.now()) / 60000));
    } catch {
      return 0;
    }
  };

  const [dropCooldownMins, setDropCooldownMins] = useState(0);
  useEffect(() => {
    if (!bodyguardLastDropAt) {
      setDropCooldownMins(0);
      return;
    }
    const tick = () => setDropCooldownMins(getDropCooldownMinsLeft(bodyguardLastDropAt));
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [bodyguardLastDropAt]);

  const renderBodyguardCard = (bg) => {
    const hasGuard = !!bg.bodyguard_username;
    const isExpanded = expandedSlot === bg.slot_number;
    const dropOnCooldown = dropCooldownMins > 0;
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
                  to={`/profile/${encodeURIComponent(bg.bodyguard_username ?? '')}`}
                  className="hover:text-primary"
                  data-testid={`bodyguard-profile-${bg.slot_number}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {bg.bodyguard_username ?? '—'}
                </Link>
                {bg.bodyguard_rank_name && <span> • {bg.bodyguard_rank_name}</span>}
              </div>
              <div className="text-[10px] text-mutedForeground sm:hidden">
                Tap to {isExpanded ? 'collapse' : 'view details'}
              </div>
            </div>
          </div>
          <div className="shrink-0 w-12 text-center">
            <span className="text-xs font-bold text-primary">
              {bg.is_robot ? `${bg.armour_level ?? 0}/5` : (bg.armour_level ? `${bg.armour_level}/5` : 'None')}
            </span>
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {bg.is_robot ? (
              <button
                onClick={() => upgradeArmour(bg.slot_number)}
                disabled={(bg.armour_level || 0) >= 5}
                className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed font-heading"
                data-testid={`upgrade-armour-${bg.slot_number}`}
              >
                {upgradingSlot === bg.slot_number ? '…' : (bg.armour_level || 0) >= 5 ? '🛡️ Max' : `🛡️ Upgrade (${getUpgradeCost(bg.armour_level)} pts)`}
              </button>
            ) : (
              <span className="text-[10px] text-mutedForeground italic">Your armour</span>
            )}
          </div>
        </div>
        {isExpanded && (
          <div className="px-3 pb-3 pt-1 border-t border-zinc-700/30 mt-1 mx-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-zinc-900/50 rounded p-2">
                <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Guard</div>
                <Link
                  to={`/profile/${encodeURIComponent(bg.bodyguard_username ?? '')}`}
                  className="text-foreground font-bold hover:text-primary"
                  data-testid={`bodyguard-profile-expanded-${bg.slot_number}`}
                >
                  {bg.bodyguard_username ?? '—'}
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
                <div className="text-primary font-bold">
                  {bg.is_robot ? `${bg.armour_level ?? 0}/5` : (bg.armour_level ? `${bg.armour_level}/5 (their armour)` : 'None (their armour)')}
                </div>
              </div>
              <div className="bg-zinc-900/50 rounded p-2 col-span-2">
                <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Hired</div>
                <div className="text-foreground font-bold">
                  {bg.hired_at && new Date(bg.hired_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </div>
              </div>
              {(bg.hire_cost ?? 0) > 0 && (
                <div className="bg-zinc-900/50 rounded p-2 col-span-2">
                  <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Upfront cost</div>
                  <div className="text-foreground font-bold">{(bg.hire_cost ?? 0).toLocaleString()} pts</div>
                </div>
              )}
              {!bg.is_robot && ((bg.payment_points ?? 0) > 0 || (bg.payment_money ?? 0) > 0) && (
                <div className="bg-zinc-900/50 rounded p-2 col-span-2">
                  <div className="text-[10px] text-mutedForeground uppercase mb-0.5">Pay (per week, auto on day)</div>
                  <div className="text-foreground font-bold">
                    {[(bg.payment_points ?? 0) > 0 && `${bg.payment_points ?? 0} pts`, (bg.payment_money ?? 0) > 0 && `$${Number(bg.payment_money ?? 0).toLocaleString()}`].filter(Boolean).join(' + ')}
                    {bg.payout_weekday != null && ` · ${WEEKDAY_OPTIONS[bg.payout_weekday]?.label ?? 'Weekly'}s`}
                  </div>
                </div>
              )}
              {hasGuard && (
                <div className="col-span-2 pt-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); dropBodyguard(bg.slot_number); }}
                    disabled={!!droppingSlot || dropOnCooldown}
                    className="text-[10px] font-heading uppercase tracking-wide text-red-400 hover:text-red-300 border border-red-500/40 rounded px-2 py-1.5 bg-red-500/10 disabled:opacity-50"
                  >
                    {droppingSlot === bg.slot_number ? '…' : dropOnCooldown ? `Drop (in ${dropCooldownMins}m)` : `Drop ${bg.is_robot ? 'robot' : 'bodyguard'}`}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <style>{BG_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Shield size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading bodyguards...</span>
        </div>
      </div>
    );
  }

  const activeCount = bodyguards.filter(bg => bg.bodyguard_username).length + hiringSlots.size;

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="bodyguards-page">
      <style>{BG_STYLES}</style>

      {/* Page header */}
      <div className="relative bg-fade-in">
        <p className="text-[10px] text-zinc-500 font-heading italic">Hire robots or invite humans (4 bodyguards max total). Armour and who&apos;s watching your back.</p>
        {bodyguardFor?.owner_username && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs font-heading">
            <span className="text-mutedForeground">You&apos;re bodyguarding for: </span>
            <Link to={`/profile/${encodeURIComponent(bodyguardFor.owner_username)}`} className="text-emerald-400 font-bold hover:underline">
              {bodyguardFor.owner_username}
            </Link>
            {bodyguardProfit != null && (
              <span className="text-emerald-400/90 block mt-1">
                Total profit from being a bodyguard: {(bodyguardProfit.points || 0).toLocaleString()} pts, ${(bodyguardProfit.money || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            )}
            <span className="text-mutedForeground block mt-1">You cannot hire bodyguards while under contract.</span>
          </div>
        )}
        {!bodyguardFor?.owner_username && bodyguardProfit != null && ((bodyguardProfit.points || 0) > 0 || (bodyguardProfit.money || 0) > 0) && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-xs font-heading">
            <span className="text-mutedForeground">Total profit from being a bodyguard (all time): </span>
            <span className="text-primary font-medium">
              {(bodyguardProfit.points || 0).toLocaleString()} pts, ${(bodyguardProfit.money || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        )}
      </div>
      
      {/* Stats row */}
      <div className="flex flex-wrap items-center justify-end gap-4 bg-fade-in" style={{ animationDelay: '0.05s' }}>
        <div className="flex items-center gap-3 text-xs font-heading">
          {activeCount < 4 && nextEmptySlot && !bodyguardFor?.owner_username && (
            <button
              onClick={() => hireBodyguard(nextEmptySlot, true)}
              data-testid="hire-robot-next"
              className="bg-primary/20 text-primary rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation font-heading shrink-0"
            >
              {`🤖 Hire robot (${getHireCost(nextEmptySlot)} pts${nextHireInflationPct > 0 ? ` +${nextHireInflationPct}%` : ''})`}
            </button>
          )}
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
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bg-card bg-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
            Your Bodyguards
          </span>
        </div>

        <div className="p-2 space-y-4">
          {/* Sent invitations */}
          {invites.sent?.length > 0 && (
            <div>
              <h4 className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-wider px-1 mb-1.5">Your invites (sent)</h4>
              <div className="space-y-1.5">
                {invites.sent.map((inv, idx) => {
                  const payParts = [];
                  if (inv.payment_points) payParts.push(`${inv.payment_points} pts`);
                  if (inv.payment_money) payParts.push(`$${Number(inv.payment_money ?? 0).toLocaleString()}`);
                  const payStr = payParts.length ? payParts.join(' + ') + '/week' : '—';
                  const weekdayLabel = WEEKDAY_OPTIONS.find((o) => o.value === (inv.payout_weekday ?? 0))?.label ?? '—';
                  const isCancelling = cancellingInviteId === inv.id;
                  return (
                    <div
                      key={inv.id ?? `sent-${idx}`}
                      className="bg-row rounded-lg bg-zinc-800/30 border border-primary/20 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="text-[11px] text-foreground font-heading min-w-0">
                        <span className="text-mutedForeground">Invite to </span>
                        <span className="font-bold">{inv.invitee_username ?? '?'}</span>
                        <span className="text-mutedForeground">: {payStr}</span>
                        {weekdayLabel !== '—' && <span className="text-mutedForeground"> (paid {weekdayLabel}s)</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => cancelInvite(inv.id)}
                        disabled={isCancelling}
                        className="bg-amber-500/20 text-amber-400 rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide border border-amber-500/40 hover:bg-amber-500/30 font-heading disabled:opacity-60"
                      >
                        {isCancelling ? '…' : 'Cancel'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Received invitations */}
          {invites.received?.length > 0 && (
            <div>
              <h4 className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-wider px-1 mb-1.5">Invitations (received)</h4>
              <div className="space-y-1.5">
                {invites.received.map((inv, idx) => {
                  const payParts = [];
                  if (inv.payment_points) payParts.push(`${inv.payment_points} pts`);
                  if (inv.payment_money) payParts.push(`$${Number(inv.payment_money ?? 0).toLocaleString()}`);
                  const payStr = payParts.length ? payParts.join(' + ') + '/week' : '—';
                  const weekdayLabel = WEEKDAY_OPTIONS.find((o) => o.value === (inv.payout_weekday ?? 0))?.label ?? '—';
                  const isActing = actingInviteId === inv.id;
                  return (
                    <div
                      key={inv.id ?? `received-${idx}`}
                      className="bg-row rounded-lg bg-zinc-800/30 border border-primary/20 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="text-[11px] text-foreground font-heading min-w-0">
                        <span className="font-bold">{inv.inviter_username ?? 'Someone'}</span>
                        <span className="text-mutedForeground"> wants you as bodyguard: </span>
                        <span>{payStr}</span>
                        {weekdayLabel !== '—' && <span className="text-mutedForeground"> (paid {weekdayLabel}s)</span>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => acceptInvite(inv.id)}
                          disabled={isActing}
                          className="bg-emerald-500/20 text-emerald-400 rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide border border-emerald-500/40 hover:bg-emerald-500/30 font-heading disabled:opacity-60"
                        >
                          {isActing ? '…' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectInvite(inv.id)}
                          disabled={isActing}
                          className="bg-red-500/20 text-red-400 rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide border border-red-500/40 hover:bg-red-500/30 font-heading disabled:opacity-60"
                        >
                          {isActing ? '…' : 'Reject'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Your Bodyguards (in slot order) */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1 mb-1.5">
              <h4 className="text-[10px] font-heading font-bold text-primary/80 uppercase tracking-wider">Your Bodyguards</h4>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={refreshing || loading}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading font-bold uppercase tracking-wide border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                title="Refresh list and data"
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? '…' : 'Refresh'}
              </button>
            </div>
            <div className="space-y-1">
              {activeBodyguards.map((bg) => renderBodyguardCard(bg))}
              {activeCount < 4 && nextEmptySlot && !bodyguardFor?.owner_username && (
                <div className="bg-row rounded-lg bg-zinc-800/30 border border-transparent hover:border-primary/20 px-3 py-3 space-y-2">
                  <div className="text-[10px] text-mutedForeground mb-1">
                    One-time hire cost when they accept: <strong className="text-foreground">{Math.floor(getHireCost(nextEmptySlot) * 0.75)} pts</strong> (25% off robot price).
                  </div>
                  <div className="text-[10px] text-mutedForeground mb-1.5">Offer (per week, paid on chosen day):</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="Username"
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
                      className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground w-28 placeholder:text-zinc-500"
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Pts/week"
                      value={invitePaymentPoints || ''}
                      onChange={(e) => setInvitePaymentPoints(e.target.value ? Number(e.target.value) : 0)}
                      className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground w-20 placeholder:text-zinc-500"
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="$ /week"
                      value={invitePaymentMoney || ''}
                      onChange={(e) => setInvitePaymentMoney(e.target.value ? Number(e.target.value) : 0)}
                      className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground w-24 placeholder:text-zinc-500"
                    />
                    <select
                      value={invitePayoutWeekday}
                      onChange={(e) => setInvitePayoutWeekday(Number(e.target.value))}
                      className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground"
                    >
                      {WEEKDAY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>Pay {opt.label}s</option>
                      ))}
                    </select>
                    <button
                      onClick={sendInvite}
                      disabled={inviting}
                      data-testid="invite-human-next"
                      className="bg-primary/20 text-primary rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 font-heading disabled:opacity-60"
                    >
                      {inviting ? '…' : '👤 Invite'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="bg-art-line text-primary mx-4" />
      </div>

      {/* Bodyguard stats */}
      {bgStats && (
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bg-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
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
                <span><strong className="text-foreground">Human bodyguards hired:</strong> {bgStats.human_hired ?? 0}</span>
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
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bg-fade-in mobile-panel`} style={{ animationDelay: '0.1s' }}>
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
              <span>Humans: invite a player; set points and/or $ per week and a payout day (paid automatically that day each week)</span>
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
