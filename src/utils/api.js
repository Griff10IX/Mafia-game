import axios from 'axios';
import {
  clearStaffPortalSession,
  clearStaffPortalToken,
  getOrCreateStaffPortalDeviceId,
  getStaffPortalToken,
  isStaffPortalTokenValid,
} from './staffPortalSession';
import { clearProfileSessionLastMeUsername } from './prefetchCache';
import { inFlightGet, clearInFlightGets } from './inFlightGet';
import { parseIpBanFromError } from './ipBan';

// Empty or unset = same origin (e.g. Linode: Nginx serves app and proxies /api)
const raw = (process.env.REACT_APP_BACKEND_URL && process.env.REACT_APP_BACKEND_URL.trim())
  ? process.env.REACT_APP_BACKEND_URL.replace(/\/+$/, '')
  : '';
const API_URL = raw ? raw.replace(/\/api\/?$/, '') : '';
const API = API_URL ? `${API_URL}/api` : '/api';

const api = axios.create({
  baseURL: API,
});

/** Fired when an /admin/* request returns 403: re-fetch staff flags so UI cannot stay spoofed via devtools. */
export const STAFF_ADMIN_API_FORBIDDEN_EVENT = 'staff-admin-api-forbidden';

/** SPA navigate from non-React code (axios interceptors). Layout listens with useNavigate. */
export const APP_NAVIGATE_EVENT = 'app:navigate';

/**
 * Client-side route change without a full document reload (avoids theme/layout flash).
 * Falls back to location.assign if no listener is mounted.
 */
export function navigateApp(path, { replace = false } = {}) {
  if (typeof window === 'undefined' || !path) return;
  try {
    const cur = (window.location.pathname || '').replace(/\/+/g, '/') || '/';
    const target = String(path).split('?')[0].replace(/\/+/g, '/') || '/';
    if (cur === target) return;
    let handled = false;
    const markHandled = () => { handled = true; };
    window.dispatchEvent(
      new CustomEvent(APP_NAVIGATE_EVENT, {
        detail: { to: path, replace: !!replace, markHandled },
      }),
    );
    if (!handled) {
      if (replace) window.location.replace(path);
      else window.location.assign(path);
    }
  } catch (_) {
    try {
      if (replace) window.location.replace(path);
      else window.location.assign(path);
    } catch (_e) { /* ignore */ }
  }
}

let _staffAdminForbiddenDispatchAt = 0;

const _rawGet = api.get.bind(api);

api.get = function dedupingGet(url, config) {
  return inFlightGet(_rawGet, url, config);
};

/** Clear in-flight GET dedupe so the next fetch is not tied to a stale promise (logout, token change). */
export function invalidateApiCache() {
  clearInFlightGets();
}

function _sleep429Retry(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry transient sustained page RL 429s (server sets Retry-After). Same behaviour as Jail.js jailGetWith429Retry.
 * @param {() => Promise<any>} requestFn
 * @param {number} [maxAttempts=3]
 */
export async function apiRequestWith429Retry(requestFn, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await requestFn();
    } catch (e) {
      lastErr = e;
      const st = e?.response?.status;
      if (st === 429 && attempt < maxAttempts - 1) {
        const h = e?.response?.headers;
        const raw = h?.['retry-after'] ?? h?.['Retry-After'];
        const sec = parseInt(String(raw), 10);
        // Sustained-RL 429s carry Retry-After (server-told cooldown, typically 10-15s) — honor that, capped at 2s
        // so we never freeze the UI longer than that on a single retry. Headerless 429s (transient Mongo / gateway
        // hiccups under kill load) fall through to a quick 250ms retry instead of the old 2,500ms freeze.
        let ms;
        if (Number.isFinite(sec) && sec > 0 && sec <= 120) {
          ms = Math.min(sec * 1000, 2000);
        } else {
          ms = 250;
        }
        await _sleep429Retry(ms);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

const _RESUME_GET_MAX_ATTEMPTS = 5;

function _sleepResumeRetry(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when a short backoff + retry may help (e.g. mobile tab waking from background). Not for 401/403. */
export function isTransientResumeLoadError(error) {
  if (!error?.response) {
    const code = error?.code;
    if (code === 'ERR_CANCELED' || error?.name === 'CanceledError') return false;
    if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
    const msg = String(error?.message || '').toLowerCase();
    return msg.includes('network error') || msg.includes('timeout');
  }
  const st = error.response.status;
  if (st === 0) return true; // normalized network error
  if (st === 401 || st === 403 || st === 404) return false;
  return st === 408 || st === 502 || st === 503 || st === 504;
}

/** True for ~45s after tab/app returns from background (Safari wake grace). */
export function isInResumeGracePeriod() {
  if (_lastForegroundAt <= 0) return false;
  return (Date.now() - _lastForegroundAt) < _SERVER_UNAVAILABLE_RESUME_GRACE_MS;
}

/**
 * Suppress noisy "Connection problem" toasts while the device radio is still waking.
 * Callers: `if (!shouldSuppressResumeNetworkToast(e)) toast.error(...)`
 */
export function shouldSuppressResumeNetworkToast(error) {
  if (!isInResumeGracePeriod()) return false;
  if (isTransientResumeLoadError(error)) return true;
  const detail = String(error?.response?.data?.detail || error?.message || '');
  return detail === NETWORK_ERROR_MSG || /connection problem|network error|failed to fetch/i.test(detail);
}

/**
 * GET with 429-aware inner retries plus outer retries for wake-from-idle network/gateway failures.
 * @param {string} path
 * @param {import('axios').AxiosRequestConfig} [config]
 * @param {number} [maxAttempts=5]
 */
export async function apiGetWithResumeRetries(path, config, maxAttempts = _RESUME_GET_MAX_ATTEMPTS) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await apiRequestWith429Retry(() => inFlightGet(_rawGet, path, config));
    } catch (e) {
      lastErr = e;
      if (isTransientResumeLoadError(e) && i < maxAttempts - 1) {
        // Longer backoff — Safari/iOS often needs 1–3s for networking after wake.
        await _sleepResumeRetry(600 + i * 700);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// ── Rate-limit cooldown state (shared across the app) ──
let _cooldownUntil = 0;        // timestamp (ms) when cooldown expires
let _cooldownTimerId = null;
const _cooldownListeners = new Set();

export function onCooldownChange(fn) {
  _cooldownListeners.add(fn);
  return () => _cooldownListeners.delete(fn);
}
function _notifyCooldown(secondsLeft) {
  _cooldownListeners.forEach(fn => { try { fn(secondsLeft); } catch(_){} });
}
function _startCooldown(seconds) {
  const now = Date.now();
  const newExpiry = now + seconds * 1000;
  if (newExpiry <= _cooldownUntil) return;
  _cooldownUntil = newExpiry;
  if (_cooldownTimerId) clearInterval(_cooldownTimerId);
  _notifyCooldown(seconds);
  _cooldownTimerId = setInterval(() => {
    const left = Math.ceil((_cooldownUntil - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(_cooldownTimerId);
      _cooldownTimerId = null;
      _cooldownUntil = 0;
      _notifyCooldown(0);
    } else {
      _notifyCooldown(left);
    }
  }, 1000);
}
export function getCooldownRemaining() {
  return Math.max(0, Math.ceil((_cooldownUntil - Date.now()) / 1000));
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const pt = getStaffPortalToken();
  if (pt && isStaffPortalTokenValid(pt)) {
    config.headers['X-Staff-Portal-Token'] = pt;
    const did = getOrCreateStaffPortalDeviceId();
    if (did) {
      config.headers['X-Staff-Portal-Device-Id'] = did;
    }
  }
  if (typeof window !== 'undefined') {
    const p = (window.location?.pathname || '/').replace(/\/+/g, '/');
    config.headers['X-Current-Path'] = p.length > 500 ? p.slice(0, 500) : p;
  }
  return config;
});

// On 401 (e.g. backend restarted, token expired), clear token and auto-redirect to login once. Don't redirect if already on login (stops refresh loop).
let hasRedirectedOnAuthFailure = false;
const isPublicPath = () => {
  const p = (typeof window !== 'undefined' && window.location?.pathname) || '';
  return p === '/' || p === '/preregister' || p === '/register' || p === '/login' || p === '/forgot-password' || p === '/reset-password' || p === '/staff-entrance' || p === '/verify-email' || p === '/verify-complete';
};

// Friendly messages for 502/503/504 and network errors so pages don't show raw "Bad Gateway" or break
const SERVER_UNAVAILABLE_MSG = 'Server temporarily unavailable. Please try again in a moment.';
const NETWORK_ERROR_MSG = 'Connection problem. Please check your network and try again.';

/** Key used to pass profile/auth error to login page after redirect (e.g. session invalidated). */
export const AUTH_ERROR_KEY = 'auth_profile_error';

/** Event to show full-screen "server restarted" overlay with auto-refresh. Dispatched on 502/503/504 or network error. */
export const SERVER_UNAVAILABLE_EVENT = 'app:server-unavailable';

let _lastServerUnavailableDispatch = 0;
const _SERVER_UNAVAILABLE_THROTTLE_MS = 30_000; // Only dispatch once per 30s to avoid overlay + toast spam
const _SERVER_UNAVAILABLE_STRIKE_WINDOW_MS = 20_000; // Require repeated failures in a short window
const _SERVER_UNAVAILABLE_MIN_STRIKES = 3; // Need multiple failures before full-screen overlay
const _SERVER_UNAVAILABLE_RESUME_GRACE_MS = 45_000; // Suppress overlay briefly after returning from idle/background
const _SERVER_UNAVAILABLE_INTERACTION_WINDOW_MS = 30_000; // Only show full-screen overlay after recent user interaction
let _serverUnavailableStrikeCount = 0;
let _serverUnavailableFirstStrikeAt = 0;
let _lastForegroundAt = Date.now();
let _lastUserInteractionAt = Date.now();

function _resetServerUnavailableStrikes() {
  _serverUnavailableStrikeCount = 0;
  _serverUnavailableFirstStrikeAt = 0;
}

function _recordServerUnavailableStrike(nowMs) {
  if (_serverUnavailableFirstStrikeAt <= 0 || (nowMs - _serverUnavailableFirstStrikeAt) > _SERVER_UNAVAILABLE_STRIKE_WINDOW_MS) {
    _serverUnavailableFirstStrikeAt = nowMs;
    _serverUnavailableStrikeCount = 1;
    return _serverUnavailableStrikeCount;
  }
  _serverUnavailableStrikeCount += 1;
  return _serverUnavailableStrikeCount;
}

function _shouldSuppressServerUnavailableOverlay() {
  if (typeof document !== 'undefined' && document.hidden) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (_lastForegroundAt > 0 && (Date.now() - _lastForegroundAt) < _SERVER_UNAVAILABLE_RESUME_GRACE_MS) return true;
  if (_lastUserInteractionAt > 0 && (Date.now() - _lastUserInteractionAt) > _SERVER_UNAVAILABLE_INTERACTION_WINDOW_MS) return true;
  return false;
}

/** Optional/captcha/bootstrap calls must not trigger the full-screen server-down overlay. */
function _shouldIgnoreServerUnavailableStrike(config) {
  if (config?.suppressServerUnavailable) return true;
  const url = String(config?.url || '').toLowerCase();
  if (!url) return false;
  return (
    url.includes('/attack/turnstile-nonce')
    || url.includes('/attack/turnstile-config')
    || url.includes('/minigame/turnstile')
  );
}

// Full reload / tab close / external navigation tears down in-flight XHRs; those often look like
// "network" errors (no response) and must not trigger the server-unavailable overlay.
let _pageUnloading = false;
if (typeof window !== 'undefined') {
  const markUnloading = () => {
    _pageUnloading = true;
  };
  const markForeground = () => {
    _lastForegroundAt = Date.now();
    _lastUserInteractionAt = Date.now();
    _resetServerUnavailableStrikes();
  };
  const markUserInteraction = () => {
    _lastUserInteractionAt = Date.now();
  };
  // pagehide only — beforeunload blocks iOS Safari bfcache and forces cold reloads
  // (blank page until chunks download again after AFK).
  window.addEventListener('pagehide', markUnloading);
  window.addEventListener('pageshow', () => {
    // Always clear — Safari often fires pagehide without bfcache restore (persisted=false).
    _pageUnloading = false;
    markForeground();
  });
  window.addEventListener('focus', markForeground);
  window.addEventListener('online', markForeground);
  window.addEventListener('pointerdown', markUserInteraction, { passive: true });
  window.addEventListener('keydown', markUserInteraction, { passive: true });
  window.addEventListener('touchstart', markUserInteraction, { passive: true });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        _pageUnloading = false;
        markForeground();
      }
    });
  }
}

/** Booze run: 403 jail on follow-up requests (e.g. /booze-run/config) used to replace location immediately and hide the prohibition toast. Defer once. */
let _boozeJailRedirectTimer = null;
function _scheduleBoozeRunJailRedirect() {
  if (typeof window === 'undefined' || _boozeJailRedirectTimer) return;
  _boozeJailRedirectTimer = setTimeout(() => {
    _boozeJailRedirectTimer = null;
    try {
      const cur = (window.location.pathname || '').replace(/\/+/g, '/');
      const onBooze =
        cur === '/money/booze-run' ||
        cur.startsWith('/money/booze-run/') ||
        cur === '/booze-run' ||
        cur.startsWith('/booze-run/');
      if (onBooze) navigateApp('/crime/jail', { replace: true });
    } catch (_) { /* ignore */ }
  }, 4000);
}

function isRequestCanceled(error) {
  if (!error) return false;
  if (axios.isCancel?.(error)) return true;
  if (error.code === 'ERR_CANCELED') return true;
  if (error.name === 'CanceledError' || error.name === 'AbortError') return true;
  try {
    if (error.config?.signal?.aborted) return true;
  } catch (_) {}
  const msg = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return msg.includes('canceled') || msg.includes('cancelled');
}

api.interceptors.response.use(
  (response) => {
    _resetServerUnavailableStrikes();
    return response;
  },
  (error) => {
    // Aborted in-flight requests (e.g. Attack page replaces poll) must not look like "server down"
    if (isRequestCanceled(error)) {
      return Promise.reject(error);
    }

    // ── 429 Rate Limit → global cooldown overlay (NEVER log out) ──
    // Soft endpoint RL returns cooldown_seconds: 0, is_cooldown: false — do not coerce to 15 or show overlay.
    // Boxing etc. use detail.suppress_global_cooldown with nested message/cooldown_seconds.
    if (error.response?.status === 429) {
      const data = error.response.data || {};
      const rawDetail = data.detail;
      let suppressOverlay = false;
      if (rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail)) {
        suppressOverlay = Boolean(rawDetail.suppress_global_cooldown);
      }
      const isSoftEndpointRl =
        data.is_cooldown === false && data.endpoint_rate_limit_hard !== true;

      let seconds;
      if (isSoftEndpointRl) {
        seconds = data.cooldown_seconds != null ? Number(data.cooldown_seconds) : 0;
        if (Number.isNaN(seconds)) seconds = 0;
      } else {
        seconds = data.cooldown_seconds != null ? Number(data.cooldown_seconds) : 15;
        if (rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail) && rawDetail.cooldown_seconds != null) {
          const s = Number(rawDetail.cooldown_seconds);
          if (s >= 1 && !Number.isNaN(s)) seconds = s;
        }
        if (Number.isNaN(seconds) || seconds < 1) {
          seconds = suppressOverlay ? 0 : 15;
        }
      }

      let detailStr;
      if (rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail)) {
        const waitFallback = seconds >= 1 ? seconds : 15;
        detailStr = typeof rawDetail.message === 'string'
          ? rawDetail.message
          : `Rate limited. Please wait ${waitFallback} seconds.`;
      } else if (typeof rawDetail === 'string') {
        detailStr = rawDetail;
      } else {
        detailStr =
          seconds >= 1
            ? `Rate limited. Please wait ${seconds} seconds.`
            : isSoftEndpointRl
              ? 'Rate limit exceeded. Please slow down.'
              : 'Rate limited. Please wait 15 seconds.';
      }

      const shouldStartGlobalCooldown =
        !suppressOverlay && !isSoftEndpointRl && seconds >= 1;
      if (shouldStartGlobalCooldown) {
        _startCooldown(seconds);
      }

      let outCooldown = seconds;
      if (!shouldStartGlobalCooldown && rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail) && rawDetail.cooldown_seconds != null) {
        const cs = Number(rawDetail.cooldown_seconds);
        if (!Number.isNaN(cs)) outCooldown = cs;
      }

      error.response.data = {
        ...data,
        detail: detailStr,
        is_cooldown: shouldStartGlobalCooldown,
        cooldown_seconds: outCooldown,
      };
      return Promise.reject(error);
    }

    // ── 403 Account under investigation → redirect to lock page immediately (no delay until next /auth/me) ──
    if (error.response?.status === 403 && !isPublicPath() && typeof window !== 'undefined') {
      const detail = error.response?.data?.detail;
      const isAccountLocked = typeof detail === 'string' && (
        detail.toLowerCase().includes('under investigation') || detail.toLowerCase().includes('account status page')
      );
      if (isAccountLocked) {
        if (window.location.pathname !== '/locked') {
          window.location.replace('/locked');
        }
        return Promise.reject(error);
      }
    }

    // ── 403 In jail → mark jailed everywhere (stops crime/GTA/booze retries in other tabs)
    //     then redirect only if this tab is on a blocked page ──
    if (error.response?.status === 403 && typeof window !== 'undefined') {
      const detail = error.response?.data?.detail;
      if (typeof detail === 'string' && detail.toLowerCase().includes('while in jail')) {
        try {
          window.dispatchEvent(
            new CustomEvent('app:refresh-user', {
              detail: { in_jail: true },
            }),
          );
        } catch (_) { /* ignore */ }
        const p = window.location.pathname;
        const jailBlocked = [
          '/crime/crimes', '/crimes',
          '/crime/gta', '/gta',
          '/organised-crime', '/oc',
          '/money/booze-run', '/booze-run',
        ];
        if (jailBlocked.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
          const onBooze =
            p === '/money/booze-run' ||
            p.startsWith('/money/booze-run/') ||
            p === '/booze-run' ||
            p.startsWith('/booze-run/');
          if (onBooze) {
            _scheduleBoozeRunJailRedirect();
          } else {
            navigateApp('/crime/jail', { replace: true });
          }
        }
        return Promise.reject(error);
      }
    }

    // ── 403 Staff portal (second factor): clear portal session only; do not log out of main account ──
    if (error.response?.status === 403 && typeof window !== 'undefined') {
      const detail = error.response?.data?.detail;
      if (typeof detail === 'string' && detail.includes('Staff portal')) {
        clearStaffPortalToken();
        try {
          window.dispatchEvent(new CustomEvent('staff-portal-expired'));
        } catch (_) {
          /* ignore */
        }
        return Promise.reject(error);
      }
    }

    // ── 403 Admin tools: server denied access (roles come from DB per request; client-only UI edits cannot grant powers) ──
    if (error.response?.status === 403 && typeof window !== 'undefined') {
      const cfg = error.config || {};
      const rawUrl = String(cfg.url || '');
      const pathOnly = rawUrl.split('?')[0].replace(/^\/+/, '');
      const withBase = `${cfg.baseURL || ''}/${rawUrl}`.replace(/\/+/g, '/');
      const isAdminApi =
        pathOnly.startsWith('admin/') ||
        pathOnly === 'admin' ||
        withBase.includes('/admin/');
      if (isAdminApi && !/^admin\/check$/i.test(pathOnly)) {
        const d = error.response?.data?.detail;
        const detailStr = typeof d === 'string' ? d : '';
        const looksStaffGate =
          detailStr.includes('Admin access required') ||
          detailStr.includes('Staff login required') ||
          detailStr === 'Not authorized';
        if (looksStaffGate) {
          const now = Date.now();
          if (now - _staffAdminForbiddenDispatchAt >= 1200) {
            _staffAdminForbiddenDispatchAt = now;
            try {
              window.dispatchEvent(new CustomEvent(STAFF_ADMIN_API_FORBIDDEN_EVENT));
            } catch (_) {
              /* ignore */
            }
          }
        }
      }
    }

    if ((error.response?.status === 401 || error.response?.status === 403) && !hasRedirectedOnAuthFailure && !isPublicPath()) {
      const isAuthMe = error.config?.url?.includes('/auth/me');
      if (error.response?.status === 401 || (error.response?.status === 403 && isAuthMe)) {
        hasRedirectedOnAuthFailure = true;
        const detail = error.response?.data?.detail;
        const msg = typeof detail === 'string' ? detail : (error.response?.status === 403 ? 'Access denied.' : 'Your session expired due to inactivity or the login time limit. Please log in again.');
        try {
          sessionStorage.setItem(AUTH_ERROR_KEY, msg);
        } catch (_) {}
        localStorage.removeItem('token');
        clearProfileSessionLastMeUsername();
        clearStaffPortalSession();
        window.location.replace('/');
      }
    }
    // Normalize 502/503/504 and network errors so pages can show a friendly message instead of breaking
    const isServerUnavailable = (status) => status === 502 || status === 503 || status === 504;
    if (error.response) {
      const status = error.response.status;
      if (isServerUnavailable(status)) {
        error.response.data = { ...error.response.data, detail: SERVER_UNAVAILABLE_MSG };
      }
    } else {
      // No response: network error, timeout, or server unreachable (often after server restart)
      error.response = { status: 0, data: { detail: NETWORK_ERROR_MSG } };
    }
    // Full-screen overlay only for real gateway outages — not transient mobile/network blips (status 0).
    const status = error.response?.status;
    const shouldCountAsServerDownSignal = isServerUnavailable(status);
    if (
      shouldCountAsServerDownSignal &&
      typeof window !== 'undefined' &&
      !isPublicPath() &&
      !_pageUnloading &&
      !_shouldSuppressServerUnavailableOverlay() &&
      !_shouldIgnoreServerUnavailableStrike(error.config)
    ) {
      const now = Date.now();
      const strikes = _recordServerUnavailableStrike(now);
      // Avoid false positives from transient wake/reconnect failures.
      if (strikes >= _SERVER_UNAVAILABLE_MIN_STRIKES && now - _lastServerUnavailableDispatch >= _SERVER_UNAVAILABLE_THROTTLE_MS) {
        _lastServerUnavailableDispatch = now;
        _resetServerUnavailableStrikes();
        window.dispatchEvent(new CustomEvent(SERVER_UNAVAILABLE_EVENT, {
          detail: {
            status,
            method: String(error.config?.method || 'get').toUpperCase(),
            url: String(error.config?.url || ''),
            message: String(error.response?.data?.detail || ''),
          },
        }));
      }
    }
    return Promise.reject(error);
  }
);

/** Get a user-friendly error message from an API error (use in catch blocks and toasts). */
export function getApiErrorMessage(error) {
  if (!error) return 'Something went wrong.';
  const ban = parseIpBanFromError(error);
  if (ban) {
    return ban.reason ? `${ban.detail} Reason: ${ban.reason}` : ban.detail;
  }
  const data = error.response?.data;
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) return detail.map((x) => x.msg || x.loc?.join('.')).join('; ') || 'Validation error';
  if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message;
  if (detail && typeof detail === 'object' && typeof detail.msg === 'string') return detail.msg;
  if (typeof data?.message === 'string') return data.message;
  if (error.response?.status === 502 || error.response?.status === 503 || error.response?.status === 504) return SERVER_UNAVAILABLE_MSG;
  if (error.response?.status === 401) return 'Your session expired due to inactivity or the login time limit. Please log in again.';
  if (error.response?.status === 403) return 'Not allowed.';
  if (!error.response) return error.message || NETWORK_ERROR_MSG;
  return error.response.status ? `Error (${error.response.status}). Please try again.` : 'Something went wrong. Please try again.';
}

/** For error messages: display the actual backend base URL (same-origin shows as /api). */
export function getBaseURL() {
  return API || '/api';
}

/** Public URL for a hosted image (same origin or full backend URL). */
export function imageHostPublicUrl(publicId) {
  if (!publicId) return '';
  const base = (getBaseURL() || '/api').replace(/\/$/, '');
  const path = `${base}/image-host/i/${encodeURIComponent(publicId)}`;
  if (path.startsWith('http')) return path;
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
  }
  return path;
}

/**
 * Dispatch to refresh top bar / user data in Layout (money, points, rank, etc.).
 * - Pass a number to set cash immediately (same as { money }).
 * - Pass { money } for absolute cash, { points } for absolute points, { pointsDelta } to adjust points (e.g. stock long −pts).
 */
export function refreshUser(newMoneyOrDetail) {
  if (typeof window === 'undefined') return;
  let detail = {};
  if (newMoneyOrDetail != null && typeof newMoneyOrDetail === 'object' && !Array.isArray(newMoneyOrDetail)) {
    detail = { ...newMoneyOrDetail };
    if (detail.money != null) detail.money = Number(detail.money);
    if (detail.points != null) detail.points = Number(detail.points);
    if (detail.pointsDelta != null) detail.pointsDelta = Number(detail.pointsDelta);
  } else if (newMoneyOrDetail != null && newMoneyOrDetail !== undefined) {
    detail = { money: Number(newMoneyOrDetail) };
  }
  window.dispatchEvent(new CustomEvent('app:refresh-user', { detail }));
}

/**
 * Fire-and-forget toast event logger for admin observability.
 * Uses sendBeacon when possible, then fetch keepalive fallback.
 */
export function sendToastEvent(payload) {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    const endpoint = `${API}/admin/toast-events/ingest`;
    const body = JSON.stringify(payload || {});

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    const pt = getStaffPortalToken();
    if (pt && isStaffPortalTokenValid(pt)) {
      headers['X-Staff-Portal-Token'] = pt;
      const did = getOrCreateStaffPortalDeviceId();
      if (did) headers['X-Staff-Portal-Device-Id'] = did;
    }

    fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    // Intentionally silent: logging must never break UX.
  }
}

export default api;
