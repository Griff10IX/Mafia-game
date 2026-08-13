import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Shield, ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../../utils/api';
import { readBodyguardsPageWarm, writeBodyguardsPageWarm } from '../../utils/bodyguardsPageWarm';
import { robotBodyguardAvatarUrl } from '../../utils/robotBodyguardAvatar';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { formatGameDateTime } from '../../utils/gameDateTime';

const BG_STYLES = `
  @keyframes bg-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .bg-fade-in { animation: bg-fade-in 0.4s ease-out both; }
  .bg-card { transition: all 0.3s ease; }
  .bg-row { transition: background-color 0.2s ease; }
  .bg-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  @media (hover: hover) and (pointer: fine) {
    .bg-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
    .bg-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  }
  @media (max-width: 639px) {
    .bg-slot-row { align-items: flex-start; }
    .bg-slot-actions { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 2px; }
    .bg-slot-upgrade { flex: 1; min-height: 36px; }
  }
`;

// Match backend bodyguards.py: BODYGUARD_SLOT_COSTS = [75, 150, 300, 450]
const BODYGUARD_SLOT_COSTS = [75, 150, 300, 450];
const MAX_BODYGUARD_SLOTS = 4;

function emptyBodyguardSlot(slotNumber) {
  return {
    slot_number: slotNumber,
    is_robot: false,
    bodyguard_username: null,
    bodyguard_rank_name: null,
    armour_level: 0,
    hired_at: null,
    hire_cost: 0,
    payment_points: 0,
    payment_money: 0,
    payout_weekday: null,
  };
}

/** API should always return 4 slots; pad if cache/legacy responses only list filled guards. */
function normalizeBodyguardSlots(list) {
  const rows = Array.isArray(list) ? list : [];
  const bySlot = new Map();
  for (const bg of rows) {
    const slot = Number(bg?.slot_number);
    if (slot >= 1 && slot <= MAX_BODYGUARD_SLOTS) {
      bySlot.set(slot, { ...bg, slot_number: slot });
    }
  }
  return Array.from({ length: MAX_BODYGUARD_SLOTS }, (_, i) => {
    const slotNumber = i + 1;
    return bySlot.get(slotNumber) ?? emptyBodyguardSlot(slotNumber);
  });
}

function isBodyguardSlotFilled(bg) {
  return !!(bg?.bodyguard_username || bg?.pending_hire);
}
// Match backend: BODYGUARD_ARMOUR_UPGRADE_COSTS = {0: 50, 1: 100, 2: 200, 3: 400, 4: 800}
const BODYGUARD_ARMOUR_UPGRADE_COSTS = { 0: 50, 1: 100, 2: 200, 3: 400, 4: 800 };
const ROBOT_BG_AUTO_SEARCH_COST_DEFAULT = 10_000;

function getBodyguardHireCodePayload(data) {
  // v2 gate: rvk_name + rvk_* field (old hire_code_name / bgc_* intentionally ignored)
  const name = data?.rvk_name;
  if (!name || typeof name !== 'string') return {};
  const value = data?.[name];
  if (!value || typeof value !== 'string' || value.trim().length < 16) return {};
  return {
    rvk_name: name,
    [name]: value.trim(),
  };
}

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
  const [eventMarkupPct, setEventMarkupPct] = useState(0);
  const [inflationLevel, setInflationLevel] = useState(0);
  const [inflationWindowEndsAt, setInflationWindowEndsAt] = useState(null);
  const [slowBodyguardHireInflationActive, setSlowBodyguardHireInflationActive] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
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
  const [hiringSlots, setHiringSlots] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [hireBanner, setHireBanner] = useState(null);
  const [robotBgAutoSearchActive, setRobotBgAutoSearchActive] = useState(false);
  const [robotBgAutoSearchUntil, setRobotBgAutoSearchUntil] = useState(null);
  const [robotBgAutoSearchCost, setRobotBgAutoSearchCost] = useState(ROBOT_BG_AUTO_SEARCH_COST_DEFAULT);
  const [autoSearchBuying, setAutoSearchBuying] = useState(false);
  const [robotHireTokens, setRobotHireTokens] = useState(0);
  const claimedSlotsRef = useRef(new Set());
  const pendingHiresRef = useRef(0);
  const hireCodePayloadRef = useRef({});

  const WEEKDAY_OPTIONS = [
    { value: 0, label: 'Monday' },
    { value: 1, label: 'Tuesday' },
    { value: 2, label: 'Wednesday' },
    { value: 3, label: 'Thursday' },
    { value: 4, label: 'Friday' },
    { value: 5, label: 'Saturday' },
    { value: 6, label: 'Sunday' },
  ];

  useLayoutEffect(() => {
    const w = readBodyguardsPageWarm();
    if (!w) return;
    const bgData = w.main;
    setBodyguards(normalizeBodyguardSlots(Array.isArray(bgData) ? bgData : (bgData?.bodyguards ?? [])));
    setBodyguardFor(bgData?.bodyguard_for ?? null);
    setBodyguardProfit(bgData?.bodyguard_profit ?? null);
    hireCodePayloadRef.current = getBodyguardHireCodePayload(bgData);
    if (w.user) setUser(w.user);
    setEvent(w.event ?? null);
    setEventsEnabled(!!w.eventsEnabled);
    const infl = w.inflation || {};
    setNextHireInflationPct(infl.next_hire_inflation_pct ?? 0);
    setEventMarkupPct(infl.event_markup_pct ?? 0);
    setInflationLevel(infl.inflation_level ?? 0);
    setInflationWindowEndsAt(infl.inflation_window_ends_at ?? null);
    setSlowBodyguardHireInflationActive(!!infl.slow_bodyguard_hire_inflation_active);
    setBgStats(w.stats ?? null);
    setInvites(w.invites ?? { sent: [], received: [] });
    if (typeof bgData?.robot_bodyguard_hire_tokens === 'number') {
      setRobotHireTokens(bgData.robot_bodyguard_hire_tokens);
    }
    setHasLoaded(true);
  }, []);

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

  /** Avoid stale cached GET responses (browser/CDN) so hire price + inflation % update without full page refresh. */
  const noCacheGetConfig = () => ({
    params: { _: Date.now() },
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });

  const fetchData = async () => {
    try {
      const nc = noCacheGetConfig();
      const [bodyguardsRes, userRes, eventsRes, inflationRes, statsRes, invitesRes] = await Promise.all([
        api.get('/bodyguards', nc),
        api.get('/auth/me'),
        api.get('/events/active').catch((e) => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Bodyguards] events/active failed', e?.response?.status, e?.response?.data);
          }
          return { data: { event: null, events_enabled: false } };
        }),
        api.get('/bodyguards/inflation', nc).catch((e) => {
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
        setHasLoaded(true);
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
        setHasLoaded(true);
        return;
      }
      const bgData = bodyguardsRes.data;
      setBodyguards(normalizeBodyguardSlots(Array.isArray(bgData) ? bgData : (bgData?.bodyguards ?? [])));
      setBodyguardFor(bgData?.bodyguard_for ?? null);
      setBodyguardProfit(bgData?.bodyguard_profit ?? null);
      setRobotBgAutoSearchActive(!!bgData?.robot_bg_auto_search_active);
      setRobotBgAutoSearchUntil(bgData?.robot_bg_auto_search_until ?? null);
      setRobotBgAutoSearchCost(Number(bgData?.robot_bg_auto_search_cost) || ROBOT_BG_AUTO_SEARCH_COST_DEFAULT);
      if (typeof bgData?.robot_bodyguard_hire_tokens === 'number') {
        setRobotHireTokens(bgData.robot_bodyguard_hire_tokens);
      } else if (typeof userRes.data?.robot_bodyguard_hire_tokens === 'number') {
        setRobotHireTokens(userRes.data.robot_bodyguard_hire_tokens);
      }
      hireCodePayloadRef.current = getBodyguardHireCodePayload(bgData);
      setUser(userRes.data);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
      setNextHireInflationPct(inflationRes.data?.next_hire_inflation_pct ?? 0);
      setEventMarkupPct(inflationRes.data?.event_markup_pct ?? 0);
      setInflationLevel(inflationRes.data?.inflation_level ?? 0);
      setInflationWindowEndsAt(inflationRes.data?.inflation_window_ends_at ?? null);
      setSlowBodyguardHireInflationActive(!!inflationRes.data?.slow_bodyguard_hire_inflation_active);
      setBgStats(statsRes.data ?? null);
      setInvites(invitesRes.data ?? { sent: [], received: [] });
      writeBodyguardsPageWarm({
        userId: userRes.data?.id,
        main: bgData,
        user: userRes.data,
        event: eventsRes.data?.event ?? null,
        eventsEnabled: !!eventsRes.data?.events_enabled,
        inflation: inflationRes.data ?? null,
        stats: statsRes.data ?? null,
        invites: invitesRes.data ?? { sent: [], received: [] },
      });
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
      setBgStats(null);
      setInvites({ sent: [], received: [] });
      setNextHireInflationPct(0);
      setInflationWindowEndsAt(null);
    } finally {
      setHasLoaded(true);
    }
  };

  // Quiet rvk gate refresh while page is open (keeps hire token fresh; Hire stays one POST).
  useEffect(() => {
    const POLL_MS = 45_000;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const res = await api.get('/bodyguards', noCacheGetConfig());
        if (res?.status < 400 && res.data) {
          hireCodePayloadRef.current = getBodyguardHireCodePayload(res.data);
          if (typeof res.data.robot_bodyguard_hire_tokens === 'number') {
            setRobotHireTokens(res.data.robot_bodyguard_hire_tokens);
          }
        }
      } catch {
        /* ignore quiet poll errors */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

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

  const showHireBanner = (type, message) => {
    setHireBanner({ type, message });
    setTimeout(() => setHireBanner((prev) => (prev?.message === message ? null : prev)), 6000);
  };

  const buyRobotBgAutoSearch = async () => {
    const cost = robotBgAutoSearchCost;
    if ((user?.points ?? 0) < cost) {
      toast.error(`You need ${cost.toLocaleString()} points (you have ${(user?.points ?? 0).toLocaleString()}).`);
      return;
    }
    const ok = window.confirm(
      `Buy robot auto-search for ${cost.toLocaleString()} points?\n\n`
      + 'Keeps Attack searches running for your hired robots — starts missing searches and renews when a row has 3 hours or less left. Lasts 30 days.'
    );
    if (!ok) return;
    setAutoSearchBuying(true);
    try {
      const res = await api.post('/store/buy-robot-bg-auto-search');
      toast.success(res.data?.message || 'Robot auto-search active.');
      if (res.data?.robot_bg_auto_search_until) {
        setRobotBgAutoSearchUntil(res.data.robot_bg_auto_search_until);
        setRobotBgAutoSearchActive(true);
      }
      refreshUser().catch(() => {});
      await fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Purchase failed');
    } finally {
      setAutoSearchBuying(false);
    }
  };

  const claimNextSlot = () => {
    const slot = bodyguards.find(
      (b) => !isBodyguardSlotFilled(b) && !claimedSlotsRef.current.has(b.slot_number),
    )?.slot_number;
    if (slot != null) {
      claimedSlotsRef.current.add(slot);
      setHiringSlots(new Set(claimedSlotsRef.current));
    }
    return slot;
  };

  const hireBodyguard = async (isRobot) => {
    const slot = claimNextSlot();
    if (slot == null) return;
    const estimatedCost = getHireCost(slot);
    pendingHiresRef.current += 1;
    if (isRobot) {
      setBodyguards((prev) =>
        normalizeBodyguardSlots(
          prev.map((b) =>
            b.slot_number === slot
              ? {
                  ...b,
                  is_robot: true,
                  bodyguard_username: 'Hiring robot...',
                  bodyguard_rank_name: null,
                  armour_level: 0,
                  hire_cost: estimatedCost,
                  pending_hire: true,
                }
              : b
          ),
        )
      );
    }
    try {
      const response = await api.post('/bodyguards/hire', {
        slot,
        is_robot: isRobot,
        ...hireCodePayloadRef.current,
      });
      const hiredSlot = response?.data?.slot ?? slot;
      const hiredBodyguard = response?.data?.bodyguard;
      if (hiredBodyguard) {
        setBodyguards((prev) =>
          normalizeBodyguardSlots(
            prev.map((b) =>
              b.slot_number === hiredSlot || b.slot_number === slot
                ? { ...b, ...hiredBodyguard, pending_hire: false }
                : b
            ),
          )
        );
      } else if (response?.data?.bodyguard_name) {
        setBodyguards((prev) =>
          normalizeBodyguardSlots(
            prev.map((b) =>
              b.slot_number === slot
                ? { ...b, bodyguard_username: response.data.bodyguard_name, pending_hire: false }
                : b
            ),
          )
        );
      }
      if (typeof response?.data?.next_hire_inflation_pct === 'number') {
        setNextHireInflationPct(response.data.next_hire_inflation_pct);
      }
      if (typeof response?.data?.event_markup_pct === 'number') {
        setEventMarkupPct(response.data.event_markup_pct);
      }
      if (typeof response?.data?.inflation_level === 'number') {
        setInflationLevel(response.data.inflation_level);
      }
      if (response?.data?.inflation_window_ends_at) {
        setInflationWindowEndsAt(response.data.inflation_window_ends_at);
      }
      if (typeof response?.data?.slow_bodyguard_hire_inflation_active === 'boolean') {
        setSlowBodyguardHireInflationActive(response.data.slow_bodyguard_hire_inflation_active);
      }
      if (typeof response?.data?.robot_bodyguard_hire_tokens === 'number') {
        setRobotHireTokens(response.data.robot_bodyguard_hire_tokens);
      }
      showHireBanner('success', response?.data?.message ?? 'Bodyguard hired');
    } catch (error) {
      claimedSlotsRef.current.delete(slot);
      setHiringSlots(new Set(claimedSlotsRef.current));
      setBodyguards((prev) =>
        normalizeBodyguardSlots(
          prev.map((b) =>
            b.slot_number === slot && b.pending_hire
              ? {
                  ...b,
                  is_robot: false,
                  bodyguard_username: null,
                  bodyguard_rank_name: null,
                  armour_level: 0,
                  hire_cost: 0,
                  pending_hire: false,
                }
              : b
          ),
        ),
      );
      const raw = error.response?.data?.detail;
      const detail =
        typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? raw.map((x) => (typeof x === 'string' ? x : x?.msg || x?.message || JSON.stringify(x))).join(', ')
            : raw?.detail
              ? String(raw.detail)
              : raw != null
                ? String(raw)
                : 'Failed to hire bodyguard';
      if (detail.includes('Slot already occupied')) {
        showHireBanner('info', 'Slot already filled — list updated');
      } else if (raw?.code === 'bodyguard_hire_code_invalid') {
        hireCodePayloadRef.current = {};
        showHireBanner('info', 'Bodyguard hire code refreshed. Click Hire Robot again.');
        fetchData().catch(() => {});
      } else {
        showHireBanner('error', detail);
      }
    } finally {
      pendingHiresRef.current -= 1;
      if (pendingHiresRef.current === 0) {
        claimedSlotsRef.current.clear();
        refreshUser().catch(() => {});
        fetchData().catch(() => {});
      }
    }
  };

  const upgradeArmour = async (slot) => {
    setUpgradingSlot(slot);
    try {
      const res = await api.post(`/bodyguards/armour/upgrade?slot=${slot}`);
      const newLevel = res.data?.armour_level;
      if (typeof newLevel === 'number') {
        setBodyguards((prev) =>
          normalizeBodyguardSlots(
            prev.map((b) => (b.slot_number === slot ? { ...b, armour_level: newLevel } : b)),
          )
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

  const hireRobotButtonLabel = (slotNumber, { emoji = false, short = false } = {}) => {
    const prefix = emoji ? '🤖 ' : '';
    if (robotHireTokens > 0) {
      if (short) return `Hire free (${robotHireTokens})`;
      return `${prefix}Hire robot — free token (${robotHireTokens})`;
    }
    const pts = getHireCost(slotNumber).toLocaleString();
    if (short) return `Hire (${pts})`;
    return `${prefix}Hire robot (${pts} pts)`;
  };

  const nextEmptySlot = bodyguards.find(
    (b) => !isBodyguardSlotFilled(b) && !hiringSlots.has(b.slot_number) && !claimedSlotsRef.current.has(b.slot_number),
  )?.slot_number;
  // All active bodyguards sorted by slot number (mixed robots and humans together)
  const activeBodyguards = bodyguards
    .filter((b) => isBodyguardSlotFilled(b))
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

  const renderBodyguardCard = (bg) => {
    const isExpanded = expandedSlot === bg.slot_number;
    const isPendingHire = !!bg.pending_hire;
    const armourLabel = bg.is_robot
      ? `${bg.armour_level ?? 0}/5`
      : (bg.armour_level ? `${bg.armour_level}/5` : 'None');
    const upgradeCost = getUpgradeCost(bg.armour_level);
    const upgradeLabel = isPendingHire
      ? 'Hiring…'
      : upgradingSlot === bg.slot_number
        ? '…'
        : (bg.armour_level || 0) >= 5
          ? 'Max'
          : `Upg ${upgradeCost}`;
    const upgradeLabelWide = isPendingHire
      ? 'Hiring…'
      : upgradingSlot === bg.slot_number
        ? '…'
        : (bg.armour_level || 0) >= 5
          ? 'Max armour'
          : `Upgrade (${upgradeCost} pts)`;
    return (
      <div
        key={bg.slot_number}
        data-testid={`bodyguard-slot-${bg.slot_number}`}
        className={`bg-row rounded-lg transition-all bg-zinc-800/30 border ${isPendingHire ? 'border-primary/30 animate-pulse' : 'border-transparent sm:hover:border-primary/20'}`}
      >
        <div
          className="bg-slot-row flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1.5 px-2.5 py-2 sm:px-3 cursor-pointer"
          onClick={() => setExpandedSlot(isExpanded ? null : bg.slot_number)}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-primary/50 text-xs shrink-0 pt-0.5">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            {bg.is_robot ? (
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md overflow-hidden border border-primary/30 bg-secondary shrink-0">
                <img
                  src={robotBodyguardAvatarUrl(bg.bodyguard_user_id || bg.bodyguard_username || bg.slot_number)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-heading font-bold text-foreground shrink-0">
                  Slot {bg.slot_number}
                </span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
                  bg.is_robot ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                }`}>
                  {bg.is_robot ? 'Robot' : 'Human'}
                </span>
              </div>
              <div className="text-[10px] text-mutedForeground truncate mt-0.5">
                {isPendingHire ? (
                  <span className="text-primary">{bg.bodyguard_username ?? 'Hiring robot...'}</span>
                ) : (
                  <Link
                    to={`/profile/${encodeURIComponent(bg.bodyguard_username ?? '')}`}
                    className="hover:text-primary"
                    data-testid={`bodyguard-profile-${bg.slot_number}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {bg.bodyguard_username ?? '—'}
                  </Link>
                )}
                {bg.bodyguard_rank_name && <span className="text-mutedForeground/80"> · {bg.bodyguard_rank_name}</span>}
              </div>
            </div>
          </div>
          <div className="bg-slot-actions shrink-0 flex items-center gap-2 sm:gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="shrink-0 min-w-[2.25rem] text-center">
              <div className="text-[9px] uppercase tracking-wide text-mutedForeground leading-none mb-0.5 sm:hidden">Armour</div>
              <span className="text-xs font-bold text-primary tabular-nums">{armourLabel}</span>
            </div>
            {bg.is_robot ? (
              <button
                onClick={() => upgradeArmour(bg.slot_number)}
                disabled={isPendingHire || (bg.armour_level || 0) >= 5}
                className="bg-slot-upgrade bg-primary/20 text-primary rounded px-2.5 py-1.5 sm:px-3 sm:py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed font-heading"
                data-testid={`upgrade-armour-${bg.slot_number}`}
              >
                <span className="sm:hidden">{upgradeLabel}</span>
                <span className="hidden sm:inline">{upgradeLabelWide}</span>
              </button>
            ) : (
              <span className="text-[10px] text-mutedForeground italic px-1">Your armour</span>
            )}
          </div>
        </div>
        {isExpanded && (
          <div className="px-2.5 pb-2.5 pt-2 border-t border-zinc-700/30 mx-2 sm:mx-3 space-y-2">
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 text-xs">
              <div className="bg-zinc-900/50 rounded p-2 col-span-2 sm:col-span-1 min-w-0">
                <div className="text-[9px] text-mutedForeground uppercase tracking-wide mb-1">Guard</div>
                {isPendingHire ? (
                  <div className="text-primary font-bold break-all leading-snug">{bg.bodyguard_username ?? 'Hiring robot...'}</div>
                ) : (
                  <Link
                    to={`/profile/${encodeURIComponent(bg.bodyguard_username ?? '')}`}
                    className="text-foreground font-bold hover:text-primary break-all leading-snug"
                    data-testid={`bodyguard-profile-expanded-${bg.slot_number}`}
                  >
                    {bg.bodyguard_username ?? '—'}
                  </Link>
                )}
              </div>
              <div className="bg-zinc-900/50 rounded p-2">
                <div className="text-[9px] text-mutedForeground uppercase tracking-wide mb-1">Type</div>
                <div className={`font-bold ${bg.is_robot ? 'text-blue-400' : 'text-emerald-400'}`}>
                  {bg.is_robot ? 'Robot' : 'Human'}
                </div>
              </div>
              {bg.bodyguard_rank_name && (
                <div className="bg-zinc-900/50 rounded p-2">
                  <div className="text-[9px] text-mutedForeground uppercase tracking-wide mb-1">Rank</div>
                  <div className="text-foreground font-bold leading-snug">{bg.bodyguard_rank_name}</div>
                </div>
              )}
              <div className="bg-zinc-900/50 rounded p-2">
                <div className="text-[9px] text-mutedForeground uppercase tracking-wide mb-1">Armour</div>
                <div className="text-primary font-bold tabular-nums">
                  {bg.is_robot ? `${bg.armour_level ?? 0}/5` : (bg.armour_level ? `${bg.armour_level}/5 (theirs)` : 'None (theirs)')}
                </div>
              </div>
              <div className="bg-zinc-900/50 rounded p-2">
                <div className="text-[9px] text-mutedForeground uppercase tracking-wide mb-1">Hired</div>
                <div className="text-foreground font-bold">
                  {bg.hired_at
                    ? new Date(bg.hired_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                    : '—'}
                </div>
              </div>
              {(bg.hire_cost ?? 0) > 0 && (
                <div className="bg-zinc-900/50 rounded p-2">
                  <div className="text-[9px] text-mutedForeground uppercase tracking-wide mb-1">Upfront</div>
                  <div className="text-foreground font-bold tabular-nums">{(bg.hire_cost ?? 0).toLocaleString()} pts</div>
                </div>
              )}
              {!bg.is_robot && ((bg.payment_points ?? 0) > 0 || (bg.payment_money ?? 0) > 0) && (
                <div className="bg-zinc-900/50 rounded p-2 col-span-2">
                  <div className="text-[9px] text-mutedForeground uppercase tracking-wide mb-1">Pay (per week)</div>
                  <div className="text-foreground font-bold leading-snug">
                    {[(bg.payment_points ?? 0) > 0 && `${bg.payment_points ?? 0} pts`, (bg.payment_money ?? 0) > 0 && `$${Number(bg.payment_money ?? 0).toLocaleString()}`].filter(Boolean).join(' + ')}
                    {bg.payout_weekday != null && ` · ${WEEKDAY_OPTIONS[bg.payout_weekday]?.label ?? 'Weekly'}s`}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const activeCount = bodyguards.filter(isBodyguardSlotFilled).length;

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="bodyguards-page">
      <style>{BG_STYLES}</style>

      {/* Page header */}
      <div className="relative bg-fade-in">
        <div className="flex items-start gap-2.5 md:gap-3">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden border-2 border-primary/35 bg-secondary shrink-0 ring-1 ring-black/25 shadow-inner">
            <img
              src={robotBodyguardAvatarUrl('bodyguards-page')}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
          <p className="text-[10px] text-zinc-500 font-heading italic pt-0.5 min-w-0 flex-1">
            Hire robots or invite humans (4 bodyguards max total). Armour and who&apos;s watching your back.
          </p>
        </div>
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

      {!bodyguardFor?.owner_username && (
        <div className="px-3 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-heading bg-fade-in" style={{ animationDelay: '0.03s' }}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-cyan-300 font-bold uppercase tracking-wide text-[10px] mb-1">
                <Search size={12} />
                Robot auto-search
              </div>
              <p className="text-[10px] text-mutedForeground leading-snug">
                {robotBgAutoSearchActive
                  ? 'Active — your hired robots stay on the Attack page. Missing searches are re-added when you open Attack or Bodyguards; rows renew when ≤3h left.'
                  : 'Pay once per 30 days to auto-maintain Attack searches for your robot bodyguards so you do not have to re-search manually.'}
              </p>
              {robotBgAutoSearchActive && robotBgAutoSearchUntil ? (
                <p className="text-[9px] text-cyan-400/90 mt-1">
                  Expires: {formatGameDateTime(robotBgAutoSearchUntil)}
                  {formatInflationCountdown(robotBgAutoSearchUntil) ? ` (${formatInflationCountdown(robotBgAutoSearchUntil)} left)` : ''}
                </p>
              ) : null}
            </div>
            {!robotBgAutoSearchActive ? (
            <button
              type="button"
              onClick={buyRobotBgAutoSearch}
              disabled={autoSearchBuying || bodyguardFor?.owner_username}
              className="shrink-0 min-h-[40px] px-3 py-2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 text-[10px] font-bold uppercase disabled:opacity-50 touch-manipulation"
              data-testid="buy-robot-bg-auto-search"
            >
              {autoSearchBuying ? '…' : `Buy (${robotBgAutoSearchCost.toLocaleString()} pts)`}
            </button>
            ) : null}
          </div>
        </div>
      )}
      
      {/* Hire + active — inflation on its own row so the hire button does not jump when markup loads */}
      <div className="space-y-2 bg-fade-in" style={{ animationDelay: '0.05s' }}>
        {(nextHireInflationPct > 0 || eventMarkupPct > 0 || inflationCountdown || slowBodyguardHireInflationActive) && (
          <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[10px] font-heading text-amber-400/90 leading-snug">
            {nextHireInflationPct > 0 && (
              <span>
                3h hire markup: <strong>+{nextHireInflationPct}%</strong>
                {inflationLevel > 0 ? (
                  <span className="text-mutedForeground"> (hire #{inflationLevel + 1} in window)</span>
                ) : null}
              </span>
            )}
            {eventMarkupPct > 0 && (
              <span className="text-primary/90">
                {nextHireInflationPct > 0 ? ' · ' : ''}
                Event on guards: <strong>+{eventMarkupPct}%</strong>
              </span>
            )}
            {slowBodyguardHireInflationActive && (
              <span className="text-emerald-400/90">
                {(nextHireInflationPct > 0 || eventMarkupPct > 0) ? ' · ' : ''}
                Slow hire inflation perk · half markup
              </span>
            )}
            {inflationCountdown && (
              <span className="text-mutedForeground">
                {(nextHireInflationPct > 0 || eventMarkupPct > 0 || slowBodyguardHireInflationActive) ? ' · ' : ''}
                Hire markup resets in {inflationCountdown}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          {activeCount < 4 && nextEmptySlot && !bodyguardFor?.owner_username ? (
            <button
              type="button"
              onClick={() => hireBodyguard(true)}
              data-testid="hire-robot-next"
              className="bg-primary/20 text-primary rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all active:scale-95 touch-manipulation font-heading shrink-0"
            >
              {hireRobotButtonLabel(nextEmptySlot, { emoji: true })}
            </button>
          ) : (
            <span className="shrink-0" aria-hidden="true" />
          )}
          <div className="flex items-center gap-1.5 text-xs font-heading shrink-0 ml-auto">
            <span className="text-mutedForeground">Active:</span>
            <span className="text-emerald-400 font-bold" data-testid="bodyguard-active">{activeCount}/4</span>
          </div>
        </div>
      </div>

      {/* Hire banner */}
      {hireBanner && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-heading animate-in fade-in slide-in-from-top-1 duration-200 ${
          hireBanner.type === 'success' ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
          : hireBanner.type === 'info' ? 'bg-primary/10 border border-primary/30 text-primary'
          : 'bg-red-500/15 border border-red-500/30 text-red-400'
        }`}>
          <span className="shrink-0">{hireBanner.type === 'success' ? '✓' : hireBanner.type === 'info' ? 'ℹ' : '✕'}</span>
          <span className="flex-1 min-w-0">{hireBanner.message}</span>
          <button type="button" onClick={() => setHireBanner(null)} className="shrink-0 opacity-60 hover:opacity-100 text-[10px]">✕</button>
        </div>
      )}

      {/* Bodyguard Slots */}
      <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 bg-card bg-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">
            Your Bodyguards
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {activeCount < 4 && nextEmptySlot && !bodyguardFor?.owner_username && (
              <button
                type="button"
                onClick={() => hireBodyguard(true)}
                data-testid="hire-robot-header"
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading font-bold uppercase tracking-wide border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30 active:scale-95 touch-manipulation"
              >
                {hireRobotButtonLabel(nextEmptySlot, { short: true })}
              </button>
            )}
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-heading font-bold uppercase tracking-wide border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors touch-manipulation"
              title="Refresh list and data"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? '…' : 'Refresh'}
            </button>
          </div>
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
            <div className="space-y-1">
              {activeBodyguards.map((bg) => renderBodyguardCard(bg))}
              {activeCount < 4 && nextEmptySlot && !bodyguardFor?.owner_username && (
                <div className="bg-row rounded-lg bg-zinc-800/30 border border-dashed border-primary/35 px-3 py-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-heading font-bold text-foreground">Slot {nextEmptySlot} — empty</div>
                      <div className="text-[10px] text-mutedForeground">Hire a robot or invite a human for your last open slot.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => hireBodyguard(true)}
                      data-testid="hire-robot-slot"
                      className="bg-primary/20 text-primary rounded px-3 py-2 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 transition-all active:scale-95 touch-manipulation font-heading shrink-0"
                    >
                      {hireRobotButtonLabel(nextEmptySlot)}
                    </button>
                  </div>
                  <div className="text-[10px] text-mutedForeground">
                    One-time hire cost when they accept: <strong className="text-foreground">{Math.floor(getHireCost(nextEmptySlot) * 0.75)} pts</strong> (25% off robot price).
                  </div>
                  <div className="text-[10px] text-mutedForeground">Or invite a human (per week, paid on chosen day):</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="Username"
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
                      className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground w-full sm:w-28 placeholder:text-zinc-500"
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Pts/week"
                      value={invitePaymentPoints || ''}
                      onChange={(e) => setInvitePaymentPoints(e.target.value ? Number(e.target.value) : 0)}
                      className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground w-[calc(50%-4px)] sm:w-20 placeholder:text-zinc-500"
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="$ /week"
                      value={invitePaymentMoney || ''}
                      onChange={(e) => setInvitePaymentMoney(e.target.value ? Number(e.target.value) : 0)}
                      className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground w-[calc(50%-4px)] sm:w-24 placeholder:text-zinc-500"
                    />
                    <select
                      value={invitePayoutWeekday}
                      onChange={(e) => setInvitePayoutWeekday(Number(e.target.value))}
                      className="bg-zinc-900/80 border border-zinc-600 rounded px-2 py-1.5 text-xs text-foreground w-full sm:w-auto"
                    >
                      {WEEKDAY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>Pay {opt.label}s</option>
                      ))}
                    </select>
                    <button
                      onClick={sendInvite}
                      disabled={inviting}
                      data-testid="invite-human-next"
                      className="bg-primary/20 text-primary rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 font-heading disabled:opacity-60 w-full sm:w-auto"
                    >
                      {inviting ? '…' : 'Invite human'}
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
