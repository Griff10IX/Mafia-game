import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Search, User, ChevronDown, ChevronRight, Users, Lock, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import api, { STAFF_ADMIN_API_FORBIDDEN_EVENT } from '../../utils/api';
import { getAdminPresenceTabId } from '../../utils/adminPresence';
import {
  clearStaffPortalToken,
  getOrCreateStaffPortalDeviceId,
  isStaffPortalTokenValid,
  setStaffPortalToken,
} from '../../utils/staffPortalSession';
import {
  ADMIN_CATEGORIES,
  ADMIN_ROUTE_GROUP_MAP,
  ADMIN_ROUTE_GROUPS,
  ADMIN_ROUTE_GROUP_MOBILE_SHORT,
  ADMIN_CATEGORY_MOBILE_SHORT,
  HUB_ADMIN_SECTIONS,
  MOD_STAFF_ROUTE_IDS,
  STANDALONE_ADMIN_SECTIONS,
  modStaffRouteGroups,
  routesByCategory,
} from './adminToolMap';
import { StaffAccessVerifyContext } from './staffAccessVerifyContext';

const Admin = lazy(() => import('./Admin'));
const AdminOverview = lazy(() => import('./AdminOverview'));
const AdminUsersOnline = lazy(() => import('./AdminUsersOnline'));
const AdminAttackLogs = lazy(() => import('./AdminAttackLogs'));
const AdminBodyguardHireLogs = lazy(() => import('./AdminBodyguardHireLogs'));
const AdminIpHistory = lazy(() => import('./AdminIpHistory'));
const AdminDeadAliveLog = lazy(() => import('./AdminDeadAliveLog'));
const AdminAccountCompare = lazy(() => import('./AdminAccountCompare'));
const AdminExclusiveCars = lazy(() => import('./AdminExclusiveCars'));
const AdminVipCars = lazy(() => import('./AdminVipCars'));
const AdminMolotovs = lazy(() => import('./AdminMolotovs'));
const AdminEntGames = lazy(() => import('./AdminEntGames'));
const AdminCrewRecovery = lazy(() => import('./AdminCrewRecovery'));
const AdminRacketProgress = lazy(() => import('./AdminRacketProgress'));
const AdminDistilleryProgress = lazy(() => import('./AdminDistilleryProgress'));
const AdminWeedSellAudit = lazy(() => import('./AdminWeedSellAudit'));
const AdminPropertyTransfer = lazy(() => import('./AdminPropertyTransfer'));
const AdminWitnessStatements = lazy(() => import('./AdminWitnessStatements'));
const AdminLocked = lazy(() => import('./AdminLocked'));

function routeFor(groupId) {
  return `/tjjeujr3wa/${groupId}`;
}

function AdminLazyFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[30vh] gap-2 py-8">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
      <span className="text-[10px] font-heading uppercase tracking-[0.2em] text-mutedForeground">Loading tool…</span>
    </div>
  );
}

const STANDALONE_PAGE = {
  'users-online': AdminUsersOnline,
  'attack-logs': AdminAttackLogs,
  'bodyguard-hire-logs': AdminBodyguardHireLogs,
  'ip-history': AdminIpHistory,
  'dead-alive-log': AdminDeadAliveLog,
  'account-compare': AdminAccountCompare,
  'exclusive-cars': AdminExclusiveCars,
  'vip-cars': AdminVipCars,
  molotovs: AdminMolotovs,
  'ent-games': AdminEntGames,
  'crew-recovery': AdminCrewRecovery,
  'racket-progress': AdminRacketProgress,
  'distillery-progress': AdminDistilleryProgress,
  'weed-sell-audit': AdminWeedSellAudit,
  'property-transfer': AdminPropertyTransfer,
  'witness-statements': AdminWitnessStatements,
  locked: AdminLocked,
};

/** Relative time from ISO last_seen_at (re-renders periodically while the panel is open). */
function formatSeenAgo(iso, refreshKey = 0) {
  void refreshKey;
  if (!iso) return '—';
  const t = Date.parse(String(iso));
  if (Number.isNaN(t)) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 12) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function staffCapsFromAdminCheck(data) {
  return !!(data?.is_admin || data?.is_moderator || data?.has_admin_email);
}

function staffShellAllowedFromCheck(data) {
  return staffCapsFromAdminCheck(data) && !!data?.staff_login_session;
}

function isFullAdminShellFromCheck(data) {
  if (data?.is_admin) return true;
  if (data?.has_admin_email && !data?.admin_preview_as_mod) return true;
  return false;
}

const LEGACY_HASH_TO_ROUTE_GROUP = {
  'admin-players': 'players',
  'admin-moderation': 'moderation',
  'admin-donations': 'commerce',
  'admin-quick': 'commerce',
  'admin-gameworld': 'liveops',
  'admin-testing': 'engineering',
  'admin-database': 'engineering',
  'admin-security': 'safety',
  'admin-cheat': 'safety',
  'admin-analytics': 'analytics',
  'admin-logs': 'logs',
  'admin-staff': 'staff',
};

export default function AdminShell() {
  const { section } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [targetPlayer, setTargetPlayer] = useState('');
  const [targetContextOpen, setTargetContextOpen] = useState(false);
  /** null = verifying with API; staff UI requires DB caps and a staff-issued JWT (see GET /admin/check staff_login_session). */
  const [staffAllowed, setStaffAllowed] = useState(null);
  const [isFullAdminShell, setIsFullAdminShell] = useState(null);
  /** When STAFF_PORTAL_PASSWORD is set, API requires X-Staff-Portal-Token for /admin/* calls except check. */
  const [staffPortalEnabled, setStaffPortalEnabled] = useState(false);
  const [staffPortalSessionMin, setStaffPortalSessionMin] = useState(30);
  const [portalRefreshTick, setPortalRefreshTick] = useState(0);
  const [portalPassword, setPortalPassword] = useState('');
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState('');

  const staffPortalOk = useMemo(() => {
    void portalRefreshTick;
    if (!staffPortalEnabled) return true;
    return isStaffPortalTokenValid();
  }, [staffPortalEnabled, portalRefreshTick]);

  /** Re-check Admin Tools GET /admin/check + portal before nav or shell actions (caps/session can change while tab stays open). */
  const verifyStaffAccess = useCallback(async () => {
    try {
      const res = await api.get('/admin/check');
      const caps = staffCapsFromAdminCheck(res.data);
      const shellOk = staffShellAllowedFromCheck(res.data);
      setIsFullAdminShell(isFullAdminShellFromCheck(res.data));
      const portalEnabled = !!res.data?.staff_portal_enabled;
      setStaffPortalEnabled(portalEnabled);
      setStaffPortalSessionMin(Number(res.data?.staff_portal_session_minutes) || 30);
      if (!caps) {
        setStaffAllowed(false);
        if (typeof window !== 'undefined') {
          const p = `${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`;
          api.post('/admin/tool-access/report-spa-unauthorized', { path: p }).catch(() => {});
          try {
            const tabId = getAdminPresenceTabId();
            api
              .post('/admin/presence/heartbeat', {
                tab_id: tabId,
                section: (section || 'overview').toLowerCase(),
                path: `${window.location.pathname}${window.location.search || ''}`,
              })
              .catch(() => {});
          } catch {
            /* tab id unavailable; skip live tripwire */
          }
        }
        return false;
      }
      if (!shellOk) {
        setStaffAllowed(false);
        if (typeof window !== 'undefined') {
          const p = window.location.pathname || '';
          if (p.startsWith('/tjjeujr3wa')) navigate('/staff-entrance', { replace: true });
        }
        return false;
      }
      setStaffAllowed(true);
      if (portalEnabled && !isStaffPortalTokenValid()) {
        setPortalRefreshTick((t) => t + 1);
        return false;
      }
      return true;
    } catch {
      setStaffAllowed(false);
      setStaffPortalEnabled(false);
      setStaffPortalSessionMin(30);
      if (typeof window !== 'undefined') {
        const p = window.location.pathname || '';
        if (p.startsWith('/tjjeujr3wa')) navigate('/account/dashboard', { replace: true });
      }
      return false;
    }
  }, [navigate]);

  useEffect(() => {
    const onExpired = () => setPortalRefreshTick((t) => t + 1);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('staff-portal-expired', onExpired);
    return () => window.removeEventListener('staff-portal-expired', onExpired);
  }, []);

  /** iOS Safari: re-check portal JWT after resume (timers may lag; session may have expired in background). */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const bump = () => setPortalRefreshTick((t) => t + 1);
    const onVis = () => {
      if (!document.hidden) bump();
    };
    window.addEventListener('pageshow', bump);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pageshow', bump);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    if (!staffPortalEnabled || staffAllowed !== true) return undefined;
    const id = setInterval(() => setPortalRefreshTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, [staffPortalEnabled, staffAllowed]);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [presenceRows, setPresenceRows] = useState([]);
  const [presenceUniqueAccounts, setPresenceUniqueAccounts] = useState([]);
  const [presenceStaleSec, setPresenceStaleSec] = useState(90);
  /** null = ~90s live; 24 / 168 = heartbeat lookback for overview */
  const [presenceWithinHours, setPresenceWithinHours] = useState(null);
  const [presenceLoading, setPresenceLoading] = useState(false);
  /** Bumps periodically so "Xs ago" stays fresh while the panel is open. */
  const [presenceSeenTick, setPresenceSeenTick] = useState(0);
  const presencePanelRef = useRef(null);
  const shellOpenLoggedRef = useRef(false);

  const fetchPresence = useCallback(async () => {
    setPresenceLoading(true);
    try {
      const params = {};
      if (presenceWithinHours != null && presenceWithinHours > 0) {
        params.within_hours = presenceWithinHours;
      }
      const res = await api.get('/admin/presence', { params });
      setPresenceRows(Array.isArray(res.data?.viewers) ? res.data.viewers : []);
      setPresenceUniqueAccounts(Array.isArray(res.data?.unique_accounts) ? res.data.unique_accounts : []);
      setPresenceStaleSec(Number(res.data?.stale_after_seconds) || 90);
    } catch {
      setPresenceRows([]);
      setPresenceUniqueAccounts([]);
    } finally {
      setPresenceLoading(false);
    }
  }, [presenceWithinHours]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/admin/check');
        if (cancelled) return;
        const caps = staffCapsFromAdminCheck(res.data);
        const shellOk = staffShellAllowedFromCheck(res.data);
        setIsFullAdminShell(isFullAdminShellFromCheck(res.data));
        setStaffPortalEnabled(!!res.data?.staff_portal_enabled);
        setStaffPortalSessionMin(Number(res.data?.staff_portal_session_minutes) || 30);
        if (!caps) {
          setStaffAllowed(false);
          if (typeof window !== 'undefined') {
            const p = `${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`;
            api.post('/admin/tool-access/report-spa-unauthorized', { path: p }).catch(() => {});
            try {
              const tabId = getAdminPresenceTabId();
              api
                .post('/admin/presence/heartbeat', {
                  tab_id: tabId,
                  section: (section || 'overview').toLowerCase(),
                  path: `${window.location.pathname}${window.location.search || ''}`,
                })
                .catch(() => {});
            } catch {
              /* tab id unavailable; skip live tripwire */
            }
          }
          toast.warning('Access denied. Our staff team has been notified of this attempt.', { duration: 6000 });
        } else if (!shellOk) {
          setStaffAllowed(false);
          navigate('/staff-entrance', { replace: true });
        } else {
          setStaffAllowed(true);
        }
      } catch {
        if (!cancelled) {
          setStaffAllowed(false);
          setStaffPortalEnabled(false);
          setStaffPortalSessionMin(30);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    const onForbidden = async () => {
      try {
        const res = await api.get('/admin/check');
        const caps = staffCapsFromAdminCheck(res.data);
        const shellOk = staffShellAllowedFromCheck(res.data);
        setIsFullAdminShell(isFullAdminShellFromCheck(res.data));
        setStaffAllowed(shellOk);
        setStaffPortalEnabled(!!res.data?.staff_portal_enabled);
        setStaffPortalSessionMin(Number(res.data?.staff_portal_session_minutes) || 30);
        if (!shellOk && typeof window !== 'undefined') {
          const p = window.location.pathname || '';
          if (p.startsWith('/tjjeujr3wa')) {
            if (caps) navigate('/staff-entrance', { replace: true });
            else navigate('/account/dashboard', { replace: true });
          }
        }
      } catch {
        setStaffAllowed(false);
        setStaffPortalEnabled(false);
        setStaffPortalSessionMin(30);
        if (typeof window !== 'undefined') {
          const p = window.location.pathname || '';
          if (p.startsWith('/tjjeujr3wa')) navigate('/account/dashboard', { replace: true });
        }
      }
    };
    window.addEventListener(STAFF_ADMIN_API_FORBIDDEN_EVENT, onForbidden);
    return () => window.removeEventListener(STAFF_ADMIN_API_FORBIDDEN_EVENT, onForbidden);
  }, [navigate]);

  useEffect(() => {
    if (staffAllowed !== true) return undefined;
    const id = setInterval(async () => {
      try {
        const res = await api.get('/admin/check');
        const caps = staffCapsFromAdminCheck(res.data);
        const shellOk = staffShellAllowedFromCheck(res.data);
        setIsFullAdminShell(isFullAdminShellFromCheck(res.data));
        setStaffAllowed(shellOk);
        if (!shellOk && typeof window !== 'undefined') {
          const p = window.location.pathname || '';
          if (p.startsWith('/tjjeujr3wa')) {
            if (caps) navigate('/staff-entrance', { replace: true });
            else navigate('/account/dashboard', { replace: true });
          }
        }
      } catch {
        setStaffAllowed(false);
        if (typeof window !== 'undefined') {
          const p = window.location.pathname || '';
          if (p.startsWith('/tjjeujr3wa')) navigate('/account/dashboard', { replace: true });
        }
      }
    }, 180000);
    return () => clearInterval(id);
  }, [staffAllowed, navigate]);

  useEffect(() => {
    if (staffAllowed !== true || !staffPortalOk) return undefined;
    const tabId = getAdminPresenceTabId();
    const send = () => {
      const path = `${location.pathname}${location.search || ''}`;
      api
        .post('/admin/presence/heartbeat', {
          tab_id: tabId,
          section: (section || 'overview').toLowerCase(),
          path,
        })
        .catch(() => {});
    };
    send();
    const hb = setInterval(send, 25000);
    return () => clearInterval(hb);
  }, [staffAllowed, staffPortalOk, section, location.pathname, location.search]);

  useEffect(() => {
    if (staffAllowed !== true || !staffPortalOk) {
      shellOpenLoggedRef.current = false;
      return undefined;
    }
    if (shellOpenLoggedRef.current) return undefined;
    shellOpenLoggedRef.current = true;
    const path = `${location.pathname}${location.search || ''}`;
    api.post('/admin/tool-access/shell-open', { path }).catch(() => {});
    return undefined;
  }, [staffAllowed, staffPortalOk, location.pathname, location.search]);

  useEffect(() => {
    if (!presenceOpen) return undefined;
    void fetchPresence();
    const pollMs = presenceWithinHours ? 45000 : 12000;
    const id = setInterval(() => {
      void fetchPresence();
    }, pollMs);
    return () => clearInterval(id);
  }, [presenceOpen, fetchPresence, presenceWithinHours]);

  useEffect(() => {
    if (!presenceOpen) return undefined;
    const id = setInterval(() => setPresenceSeenTick((n) => n + 1), 8000);
    return () => clearInterval(id);
  }, [presenceOpen]);

  useEffect(() => {
    if (!presenceOpen) return undefined;
    const onDown = (e) => {
      const el = presencePanelRef.current;
      if (!el || el.contains(e.target)) return;
      setPresenceOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [presenceOpen]);

  const hubSection = (section || 'overview').toLowerCase();

  const visibleRouteGroups = useMemo(
    () => (isFullAdminShell ? ADMIN_ROUTE_GROUPS : modStaffRouteGroups()),
    [isFullAdminShell],
  );

  useEffect(() => {
    if (isFullAdminShell !== false) return;
    if (!MOD_STAFF_ROUTE_IDS.includes(hubSection)) {
      navigate('/tjjeujr3wa/overview', { replace: true });
    }
  }, [isFullAdminShell, hubSection, navigate]);

  const routeGroup = useMemo(() => {
    return ADMIN_ROUTE_GROUP_MAP[hubSection] || ADMIN_ROUTE_GROUP_MAP.overview;
  }, [hubSection]);

  const groupedRoutes = useMemo(() => routesByCategory(visibleRouteGroups), [visibleRouteGroups]);

  const [openNavCategories, setOpenNavCategories] = useState(() => new Set(ADMIN_CATEGORIES.map((c) => c.id)));
  const [mobileNavCategory, setMobileNavCategory] = useState('admin-operations');

  useEffect(() => {
    if (routeGroup?.categoryId) {
      setMobileNavCategory(routeGroup.categoryId);
      setOpenNavCategories((prev) => {
        if (prev.has(routeGroup.categoryId)) return prev;
        const next = new Set(prev);
        next.add(routeGroup.categoryId);
        return next;
      });
    }
  }, [routeGroup?.categoryId]);

  const toggleNavCategory = (id) => {
    setOpenNavCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const navigateVerified = async (path) => {
    if (!(await verifyStaffAccess())) return;
    navigate(path);
  };
  const nonStaffPresenceAccounts = useMemo(
    () => presenceUniqueAccounts.filter((acc) => acc?.is_non_staff),
    [presenceUniqueAccounts]
  );
  const staffPresenceAccounts = useMemo(
    () => presenceUniqueAccounts.filter((acc) => !acc?.is_non_staff),
    [presenceUniqueAccounts]
  );
  const nonStaffPresenceRows = useMemo(
    () => presenceRows.filter((row) => row?.is_non_staff),
    [presenceRows]
  );
  const staffPresenceRows = useMemo(
    () => presenceRows.filter((row) => !row?.is_non_staff),
    [presenceRows]
  );

  useEffect(() => {
    if (!section) {
      const hash = (typeof window !== 'undefined' ? (window.location.hash || '').replace('#', '').trim() : '');
      const redirectedSection = LEGACY_HASH_TO_ROUTE_GROUP[hash] || 'overview';
      navigate(`/tjjeujr3wa/${redirectedSection}`, { replace: true });
    }
  }, [section, navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (STANDALONE_ADMIN_SECTIONS.has(hubSection) || hubSection === 'overview') return;
    if (!HUB_ADMIN_SECTIONS.has(hubSection)) return;
    const targetHash = routeGroup?.categoryId || 'admin-operations';
    if (window.location.hash !== `#${targetHash}`) {
      window.location.hash = targetHash;
    }
    const focusGp = new URLSearchParams(location.search).get('focus') === 'game_pass_inspector';
    const scrollId = focusGp ? 'admin-game-pass-inspector' : routeGroup?.anchorId;
    if (scrollId) {
      const delay = focusGp ? 300 : 120;
      window.setTimeout(() => {
        document.getElementById(scrollId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, delay);
    }
  }, [routeGroup, location.pathname, location.search, hubSection]);

  const scrollToTargetUsernameField = () => {
    if (typeof window === 'undefined') return;
    if (hubSection !== 'players') {
      navigate(`${routeFor('players')}${location.search || ''}`);
      window.setTimeout(() => {
        document.getElementById('admin-target-username')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 280);
      return;
    }
    window.location.hash = 'admin-operations';
    window.setTimeout(() => {
      document.getElementById('admin-target-username')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };

  const quickJumpToTarget = async () => {
    if (!(await verifyStaffAccess())) return;
    scrollToTargetUsernameField();
  };

  const applyPlayerContext = async () => {
    if (!(await verifyStaffAccess())) return;
    const next = (targetPlayer || '').trim();
    if (!next) return;
    navigate(`${routeFor('players')}?target=${encodeURIComponent(next)}`);
    scrollToTargetUsernameField();
    setTargetContextOpen(false);
  };

  if (!section) return <Navigate to="/tjjeujr3wa/overview" replace />;

  if (staffAllowed === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[45vh] gap-3 px-4">
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden />
        <span className="text-[10px] font-heading uppercase tracking-[0.2em] text-mutedForeground">Verifying staff access…</span>
      </div>
    );
  }

  if (staffAllowed === false) {
    return <Navigate to="/account/dashboard" replace />;
  }

  const submitStaffPortal = async (e) => {
    e.preventDefault();
    setPortalError('');
    const pwd = (portalPassword || '').trim();
    if (!pwd) {
      setPortalError('Enter the staff password.');
      return;
    }
    setPortalBusy(true);
    try {
      const res = await api.post('/auth/staff-portal-unlock', {
        password: portalPassword,
        client_device_id: getOrCreateStaffPortalDeviceId(),
      });
      const tok = res.data?.staff_portal_token;
      if (!tok) {
        setPortalError('Unexpected response. Try again.');
        return;
      }
      setStaffPortalToken(tok);
      setPortalPassword('');
      setPortalRefreshTick((t) => t + 1);
    } catch (err) {
      const d = err?.response?.data?.detail;
      setPortalError(typeof d === 'string' ? d : 'Unlock failed.');
    } finally {
      setPortalBusy(false);
    }
  };

  const handleLockStaffPortal = async () => {
    if (!(await verifyStaffAccess())) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        'Lock staff tools? Admin API calls will stop until you enter the staff portal password again (your game login stays active).',
      );
      if (!ok) return;
    }
    clearStaffPortalToken();
    setPortalRefreshTick((t) => t + 1);
    try {
      window.dispatchEvent(new CustomEvent('staff-portal-expired'));
    } catch {
      /* ignore */
    }
  };

  if (staffPortalEnabled && !staffPortalOk) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] px-4 py-10">
        <form
          onSubmit={submitStaffPortal}
          className="w-full max-w-sm space-y-4 rounded-xl border border-primary/25 bg-zinc-950/90 p-6 shadow-xl"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <Lock className="w-10 h-10 text-primary opacity-90" aria-hidden />
            <h2 className="font-heading text-sm uppercase tracking-[0.2em] text-primary">Staff unlock</h2>
            <p className="text-[11px] text-mutedForeground leading-relaxed">
              Additional password required for admin tools. Unlocked sessions last about {staffPortalSessionMin} minutes, then you
              must enter the password again.
            </p>
          </div>
          <label className="block">
            <span className="sr-only">Staff password</span>
            <input
              type="password"
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              value={portalPassword}
              onChange={(ev) => setPortalPassword(ev.target.value)}
              placeholder="Staff portal password"
              className="w-full min-h-[44px] rounded border border-zinc-700 bg-zinc-900 px-3 text-base md:text-sm"
              disabled={portalBusy}
            />
          </label>
          {portalError ? (
            <p className="text-[11px] text-red-400 font-heading" role="alert">
              {portalError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={portalBusy}
            className="w-full min-h-[44px] rounded border border-primary/50 bg-primary/20 text-primary text-base md:text-sm font-heading uppercase tracking-wider hover:bg-primary/30 disabled:opacity-50 touch-manipulation"
          >
            {portalBusy ? 'Checking…' : 'Unlock tools'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <StaffAccessVerifyContext.Provider value={verifyStaffAccess}>
      <div className="space-y-3 md:space-y-4">
      <section className="rounded-xl border border-primary/25 bg-gradient-to-br from-zinc-900/85 via-zinc-900/65 to-zinc-800/55 p-3 md:p-4">
        <div className="flex flex-col gap-2 md:gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="font-heading text-primary text-base sm:text-lg md:text-xl tracking-wide uppercase truncate">
                Admin Command Center
              </h1>
              <p className="text-[10px] sm:text-xs text-mutedForeground">
                Route-based tooling with consolidated sections and legacy-compatible anchors. Timestamps use UK time (GMT / BST).
              </p>
              {staffPortalEnabled && staffPortalOk ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleLockStaffPortal()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-1 text-[9px] font-heading font-bold uppercase tracking-wider text-amber-200/95 hover:bg-amber-900/50 touch-manipulation"
                    title="Clear staff portal unlock now so the password is required again (does not log you out of the game)"
                  >
                    <Lock size={12} className="shrink-0 opacity-90" aria-hidden />
                    Lock staff tools
                  </button>
                  <span className="text-[9px] text-mutedForeground leading-snug max-w-[14rem] md:max-w-none">
                    Ends the staff password session early (~{staffPortalSessionMin} min unlock otherwise).
                  </span>
                </div>
              ) : null}
            </div>
            <div ref={presencePanelRef} className="flex flex-col items-end gap-1 shrink-0 relative">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void (async () => {
                    if (presenceOpen) {
                      setPresenceOpen(false);
                      return;
                    }
                    if (!(await verifyStaffAccess())) return;
                    setPresenceOpen(true);
                    void fetchPresence();
                  })()}
                  aria-expanded={presenceOpen}
                  aria-haspopup="dialog"
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/35 bg-zinc-950/80 px-2 py-1 text-[9px] font-heading font-bold uppercase tracking-wider text-primary hover:bg-primary/15"
                  title="Admin presence: staff tabs plus non-staff admin URL hits for breach checks"
                >
                  <Users size={14} className="shrink-0 opacity-90" aria-hidden />
                  Admin presence
                  {nonStaffPresenceAccounts.length > 0 && (
                    <span className="inline-flex min-w-[1rem] justify-center rounded border border-red-500/60 bg-red-500/25 px-1 py-0.5 text-[8px] text-red-100">
                      {nonStaffPresenceAccounts.length}
                    </span>
                  )}
                </button>
                <div className="hidden md:block text-[10px] text-mutedForeground font-heading uppercase tracking-wider">
                  {routeGroup?.label}
                </div>
              </div>
              {presenceOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-[min(100vw-1.5rem,24rem)] rounded-lg border border-primary/25 bg-zinc-950/95 backdrop-blur shadow-xl p-2 text-left">
                  <div className="flex flex-wrap gap-1 mb-1.5 px-0.5" role="tablist" aria-label="Presence time range">
                    <button
                      type="button"
                      onClick={() => void (async () => {
                        if (!(await verifyStaffAccess())) return;
                        setPresenceWithinHours(null);
                      })()}
                      className={`rounded px-1.5 py-0.5 text-[8px] font-heading font-bold uppercase tracking-wider border ${
                        presenceWithinHours == null
                          ? 'border-primary/50 bg-primary/15 text-primary'
                          : 'border-zinc-700/80 text-mutedForeground hover:border-primary/30'
                      }`}
                    >
                      Live
                    </button>
                    <button
                      type="button"
                      onClick={() => void (async () => {
                        if (!(await verifyStaffAccess())) return;
                        setPresenceWithinHours(24);
                      })()}
                      className={`rounded px-1.5 py-0.5 text-[8px] font-heading font-bold uppercase tracking-wider border ${
                        presenceWithinHours === 24
                          ? 'border-primary/50 bg-primary/15 text-primary'
                          : 'border-zinc-700/80 text-mutedForeground hover:border-primary/30'
                      }`}
                    >
                      24h
                    </button>
                    <button
                      type="button"
                      onClick={() => void (async () => {
                        if (!(await verifyStaffAccess())) return;
                        setPresenceWithinHours(168);
                      })()}
                      className={`rounded px-1.5 py-0.5 text-[8px] font-heading font-bold uppercase tracking-wider border ${
                        presenceWithinHours === 168
                          ? 'border-primary/50 bg-primary/15 text-primary'
                          : 'border-zinc-700/80 text-mutedForeground hover:border-primary/30'
                      }`}
                    >
                      7d
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1 px-0.5">
                    <span className="text-[9px] font-heading font-bold uppercase tracking-wider text-mutedForeground">
                      {presenceWithinHours === 168
                        ? 'Last 7 days (heartbeat)'
                        : presenceWithinHours === 24
                          ? 'Last 24 hours (heartbeat)'
                          : `Active (~${presenceStaleSec}s)`}
                    </span>
                    <button
                      type="button"
                      onClick={() => void (async () => {
                        if (!(await verifyStaffAccess())) return;
                        void fetchPresence();
                      })()}
                      className="text-[9px] font-heading uppercase text-primary hover:underline disabled:opacity-50"
                      disabled={presenceLoading}
                    >
                      {presenceLoading ? '…' : 'Refresh'}
                    </button>
                  </div>
                  {nonStaffPresenceAccounts.length > 0 ? (
                    <div className="mb-2 rounded-lg border border-red-500/35 bg-red-500/10 p-1.5">
                      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
                        <span className="inline-flex items-center gap-1 text-[8px] font-heading font-bold uppercase tracking-wider text-red-200">
                          <ShieldAlert size={11} aria-hidden />
                          Non-staff admin hits ({nonStaffPresenceAccounts.length})
                        </span>
                        <span className="text-[8px] font-heading text-red-200/70">
                          Security breach check
                        </span>
                      </div>
                      <ul className="max-h-36 overflow-y-auto space-y-1">
                        {nonStaffPresenceAccounts.map((acc) => {
                          const ips = Array.isArray(acc.ips) ? acc.ips : [];
                          const ipLine =
                            ips.length === 0 ? '—' : ips.length === 1 ? ips[0] : `${ips[0]} +${ips.length - 1}`;
                          return (
                            <li
                              key={`nonstaff-${acc.user_id}`}
                              className="rounded border border-red-500/35 bg-zinc-950/55 px-1.5 py-1 text-[9px] font-heading leading-snug text-red-50"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <span className="font-bold truncate">
                                  {acc.username || '?'}
                                  {acc.is_self ? ' (you)' : ''}
                                </span>
                                <span className="shrink-0 text-red-100/70 tabular-nums">
                                  {acc.tab_count > 1 ? `${acc.tab_count} tabs` : '1 tab'}
                                </span>
                              </div>
                              <div className="text-[8px] text-red-100/70 mt-0.5">
                                Last <span className="text-red-50">{formatSeenAgo(acc.last_seen_at, presenceSeenTick)}</span>
                                {acc.last_section ? <> · <span className="text-red-100">{acc.last_section}</span></> : null}
                              </div>
                              <div className="text-[8px] text-red-100/60 font-mono truncate mt-0.5" title={ips.join(', ')}>
                                {ipLine}
                              </div>
                              {acc.last_route_path ? (
                                <div className="text-[8px] text-red-100/60 truncate mt-0.5" title={acc.last_route_path}>
                                  {acc.last_route_path}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  {presenceUniqueAccounts.length > 0 ? (
                    <div className="mb-2">
                      <div className="text-[8px] font-heading uppercase tracking-wider text-zinc-500 px-0.5 mb-1">
                        Staff accounts ({staffPresenceAccounts.length})
                      </div>
                      <ul className="max-h-36 overflow-y-auto space-y-1 rounded border border-zinc-800/80 bg-zinc-900/40 p-1">
                        {staffPresenceAccounts.length === 0 ? (
                          <li className="px-1.5 py-2 text-[9px] font-heading text-mutedForeground">
                            No staff accounts in this window.
                          </li>
                        ) : staffPresenceAccounts.map((acc) => {
                          const ips = Array.isArray(acc.ips) ? acc.ips : [];
                          const ipLine =
                            ips.length === 0 ? '—' : ips.length === 1 ? ips[0] : `${ips[0]} +${ips.length - 1}`;
                          return (
                            <li
                              key={acc.user_id}
                              className={`rounded px-1.5 py-1 text-[9px] font-heading leading-snug ${
                                acc.is_self ? 'bg-emerald-500/10 text-emerald-100/95' : 'text-foreground'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <span className="font-bold truncate flex items-center gap-1.5 min-w-0">
                                  <span className="truncate">
                                    {acc.username || '?'}
                                    {acc.is_self ? ' (you)' : ''}
                                  </span>
                                </span>
                                <span className="shrink-0 text-mutedForeground tabular-nums">
                                  {acc.tab_count > 1 ? `${acc.tab_count} tabs` : '1 tab'}
                                </span>
                              </div>
                              <div className="text-[8px] text-zinc-500 mt-0.5">
                                Last{' '}
                                <span className="text-mutedForeground">{formatSeenAgo(acc.last_seen_at, presenceSeenTick)}</span>
                              </div>
                              <div className="text-[8px] text-zinc-500 font-mono truncate mt-0.5" title={ips.join(', ')}>
                                {ipLine}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  <div className="text-[8px] font-heading uppercase tracking-wider text-zinc-500 px-0.5 mb-1">
                    Browser tabs ({presenceRows.length})
                    {nonStaffPresenceRows.length > 0 ? ` · ${nonStaffPresenceRows.length} non-staff` : ''}
                  </div>
                  {presenceRows.length === 0 ? (
                    <p className="text-[10px] text-mutedForeground font-heading px-0.5 py-2">
                      {presenceLoading
                        ? 'Loading…'
                        : presenceWithinHours
                          ? 'No admin heartbeats in this range (staff must have had admin open with a live tab).'
                          : 'No heartbeats in window (only this tab may be open).'}
                    </p>
                  ) : (
                    <ul className="max-h-52 overflow-y-auto space-y-1.5">
                      {[...nonStaffPresenceRows, ...staffPresenceRows].map((row) => (
                        <li
                          key={`${row.user_id || ''}-${row.tab_id || ''}`}
                          className={`rounded border px-2 py-1.5 text-[10px] font-heading leading-snug ${
                            row.is_non_staff
                              ? 'border-red-500/55 bg-red-500/15'
                              : row.is_self
                                ? 'border-emerald-500/35 bg-emerald-500/10'
                                : 'border-zinc-700/80 bg-zinc-900/60'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="font-bold text-foreground truncate flex items-center gap-1.5 min-w-0">
                              <span className="truncate">
                                {row.username || '?'}
                                {row.is_self ? ' (you)' : ''}
                              </span>
                              {row.is_non_staff && (
                                <span
                                  className="inline-flex shrink-0 items-center px-1 py-0.5 rounded border border-red-500/60 bg-red-500/30 text-red-200 text-[8px] uppercase tracking-wider"
                                  title="This account does NOT have admin/mod access — it landed on the staff URL and was bounced. Audit log written."
                                >
                                  Non-staff
                                </span>
                              )}
                            </span>
                            <span className="text-mutedForeground shrink-0 text-[9px]">{row.device_type || '—'}</span>
                          </div>
                          <div className="text-[9px] text-zinc-500 mt-0.5">
                            Last seen{' '}
                            <span className="text-mutedForeground tabular-nums">
                              {formatSeenAgo(row.last_seen_at, presenceSeenTick)}
                            </span>
                          </div>
                          <div className="text-[9px] text-mutedForeground mt-0.5 truncate" title={row.route_path || ''}>
                            {row.section ? <span className="text-primary/90">{row.section}</span> : '—'}
                            {row.route_path ? ` · ${row.route_path}` : ''}
                          </div>
                          <div className="text-[9px] text-zinc-500 mt-0.5 font-mono truncate" title={row.ip || ''}>
                            {row.ip || 'IP —'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-primary/25 bg-zinc-950/45 overflow-hidden">
            <button
              type="button"
              className="md:hidden w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left min-h-[44px] border-b border-primary/15"
              onClick={() => void (async () => {
                if (targetContextOpen) {
                  setTargetContextOpen(false);
                  return;
                }
                if (!(await verifyStaffAccess())) return;
                setTargetContextOpen(true);
              })()}
              aria-expanded={targetContextOpen}
            >
              <span className="flex items-center gap-2 min-w-0">
                <User size={16} className="text-primary shrink-0" />
                <span className="text-xs font-heading uppercase text-mutedForeground tracking-wider truncate">
                  Target player
                </span>
              </span>
              <ChevronDown
                size={18}
                className={`text-primary/80 shrink-0 transition-transform ${targetContextOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            <div
              className={`${targetContextOpen ? 'block' : 'hidden'} md:block px-3 pb-3 pt-0 md:p-2.5 md:flex md:flex-row md:items-center md:justify-between md:gap-3`}
            >
              <div className="hidden md:flex items-center gap-2 pt-2.5 md:pt-0">
                <User size={14} className="text-primary" />
                <span className="text-[11px] font-heading uppercase text-mutedForeground tracking-wider">
                  Target Player Context
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 pt-3 md:pt-0 w-full md:w-auto">
                <input
                  type="text"
                  value={targetPlayer}
                  onChange={(e) => setTargetPlayer(e.target.value)}
                  placeholder="username"
                  className="h-11 md:h-8 w-full sm:flex-1 sm:min-w-[12rem] md:w-44 rounded border border-zinc-700 bg-zinc-900 px-3 md:px-2 text-sm md:text-xs"
                />
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={applyPlayerContext}
                    className="h-11 md:h-8 flex-1 sm:flex-none px-4 md:px-3 rounded border border-primary/40 bg-primary/20 text-primary text-sm md:text-xs font-heading min-h-[44px] md:min-h-0"
                  >
                    Set context
                  </button>
                  <button
                    type="button"
                    onClick={quickJumpToTarget}
                    className="h-11 md:h-8 px-4 md:px-3 rounded border border-zinc-700 bg-zinc-900/70 text-sm md:text-xs font-heading inline-flex items-center justify-center gap-1.5 min-h-[44px] md:min-h-0 min-w-[44px] md:min-w-0"
                    title="Scroll to target field"
                  >
                    <Search size={16} className="md:w-3 md:h-3" />
                    <span className="md:inline">Jump</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="md:hidden rounded-lg border border-primary/20 bg-zinc-950/90 p-2 space-y-2" aria-label="Admin categories">
            <div className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {ADMIN_CATEGORIES.filter((c) => (groupedRoutes[c.id] || []).length > 0).map((cat) => {
                const active = mobileNavCategory === cat.id;
                const Icon = cat.icon;
                const short = ADMIN_CATEGORY_MOBILE_SHORT[cat.id] || cat.label;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setMobileNavCategory(cat.id)}
                    className={`snap-start shrink-0 flex items-center gap-1 min-h-[40px] px-2.5 rounded-lg border text-[10px] font-heading font-bold uppercase ${
                      active ? 'border-primary/70 bg-primary/25 text-primary' : 'border-zinc-700/70 bg-zinc-900/55 text-mutedForeground'
                    }`}
                  >
                    {Icon ? <Icon size={14} /> : null}
                    {short}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {(groupedRoutes[mobileNavCategory] || []).map((group) => {
                const active = group.id === routeGroup?.id;
                const Icon = group.icon;
                const short = ADMIN_ROUTE_GROUP_MOBILE_SHORT[group.id] || group.label;
                return (
                  <Link
                    key={group.id}
                    to={routeFor(group.id)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      void navigateVerified(routeFor(group.id));
                    }}
                    className={`snap-start shrink-0 flex flex-col items-center justify-center gap-0.5 min-w-[4.25rem] max-w-[5.25rem] min-h-[48px] px-1.5 py-1 rounded-lg border text-center ${
                      active
                        ? 'border-primary/70 bg-primary/25 text-primary'
                        : 'border-zinc-700/70 bg-zinc-900/55 text-mutedForeground'
                    }`}
                    title={group.description}
                  >
                    {Icon ? <Icon size={16} className="shrink-0" /> : null}
                    <span className="text-[9px] font-heading font-bold uppercase leading-tight line-clamp-2">{short}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-start">
        <aside className="hidden md:flex w-[240px] shrink-0 flex-col gap-1.5 sticky top-2 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-primary/20 bg-zinc-950/85 p-2" aria-label="Admin tool groups">
          {ADMIN_CATEGORIES.map((cat) => {
            const tools = groupedRoutes[cat.id] || [];
            if (!tools.length) return null;
            const open = openNavCategories.has(cat.id);
            const CatIcon = cat.icon;
            const catActive = tools.some((g) => g.id === routeGroup?.id);
            return (
              <div key={cat.id} className="rounded-lg border border-zinc-800/80 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleNavCategory(cat.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 text-left text-[10px] font-heading font-bold uppercase tracking-wide ${
                    catActive ? 'bg-primary/15 text-primary' : 'bg-zinc-900/50 text-mutedForeground hover:text-foreground'
                  }`}
                >
                  {CatIcon ? <CatIcon size={13} className="shrink-0" /> : null}
                  <span className="flex-1 truncate">{cat.label}</span>
                  <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
                {open && (
                  <div className="flex flex-col gap-0.5 p-1 border-t border-zinc-800/80">
                    {tools.map((group) => {
                      const active = group.id === routeGroup?.id;
                      const Icon = group.icon;
                      return (
                        <Link
                          key={group.id}
                          to={routeFor(group.id)}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                            e.preventDefault();
                            void navigateVerified(routeFor(group.id));
                          }}
                          title={group.description}
                          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-heading ${
                            active
                              ? 'bg-primary/20 text-primary border border-primary/40'
                              : 'text-mutedForeground hover:text-foreground hover:bg-zinc-800/60 border border-transparent'
                          }`}
                        >
                          {Icon ? <Icon size={12} className="shrink-0 opacity-90" /> : null}
                          <span className="truncate">{group.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <div className="flex-1 min-w-0 w-full">
          <Suspense fallback={<AdminLazyFallback />}>
            {hubSection === 'overview' && <AdminOverview isFullAdmin={!!isFullAdminShell} />}
            {STANDALONE_ADMIN_SECTIONS.has(hubSection) && (() => {
              const Page = STANDALONE_PAGE[hubSection];
              return Page ? <Page /> : null;
            })()}
            {HUB_ADMIN_SECTIONS.has(hubSection) && <Admin />}
          </Suspense>
        </div>
      </div>
      </div>
    </StaffAccessVerifyContext.Provider>
  );
}
