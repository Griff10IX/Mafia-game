import axios from 'axios';

// Empty or unset = same origin (e.g. Linode: Nginx serves app and proxies /api)
const raw = (process.env.REACT_APP_BACKEND_URL && process.env.REACT_APP_BACKEND_URL.trim())
  ? process.env.REACT_APP_BACKEND_URL.replace(/\/+$/, '')
  : '';
const API_URL = raw ? raw.replace(/\/api\/?$/, '') : '';
const API = API_URL ? `${API_URL}/api` : '/api';

const api = axios.create({
  baseURL: API,
});

// No-op for Layout; kept for API compatibility.
export function invalidateApiCache() {}

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
  if (typeof window !== 'undefined' && window.location?.pathname && config.url?.includes('/auth/me')) {
    config.headers['X-Current-Path'] = window.location.pathname || '/';
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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // ── 429 Rate Limit → cooldown (NEVER log out) ──
    if (error.response?.status === 429) {
      const data = error.response.data || {};
      const seconds = data.cooldown_seconds || 15;
      _startCooldown(seconds);
      const detail = typeof data.detail === 'string' ? data.detail : `Rate limited. Please wait ${seconds} seconds.`;
      error.response.data = { ...data, detail, is_cooldown: true, cooldown_seconds: seconds };
      return Promise.reject(error);
    }

    // ── 403 Account under investigation → redirect to lock page immediately (no delay until next /auth/me) ──
    if (error.response?.status === 403 && !hasRedirectedOnAuthFailure && !isPublicPath() && typeof window !== 'undefined') {
      const detail = error.response?.data?.detail;
      const isAccountLocked = typeof detail === 'string' && (
        detail.toLowerCase().includes('under investigation') || detail.toLowerCase().includes('account status page')
      );
      if (isAccountLocked) {
        hasRedirectedOnAuthFailure = true;
        window.location.replace('/locked');
        return Promise.reject(error);
      }
    }

    // ── 403 In jail → redirect to jail page (only from non-whitelisted pages) ──
    if (error.response?.status === 403 && typeof window !== 'undefined') {
      const detail = error.response?.data?.detail;
      if (typeof detail === 'string' && detail.toLowerCase().includes('while in jail')) {
        const p = window.location.pathname;
        const jailAllowed = [
          '/crime/jail', '/jail',
          '/casino', '/kill', '/game/travel', '/game/states', '/states', '/game/family',
          '/game/users-online', '/account/profile', '/account/autorank',
          '/account/settings', '/social/forum', '/staffrole',
          '/game/daily-rewards', '/game/leaderboard', '/game/help-desk',
        ];
        if (!jailAllowed.some(prefix => p === prefix || p.startsWith(prefix + '/'))) {
          window.location.replace('/crime/jail');
        }
        return Promise.reject(error);
      }
    }

    if ((error.response?.status === 401 || error.response?.status === 403) && !hasRedirectedOnAuthFailure && !isPublicPath()) {
      const isAuthMe = error.config?.url?.includes('/auth/me');
      if (error.response?.status === 401 || (error.response?.status === 403 && isAuthMe)) {
        hasRedirectedOnAuthFailure = true;
        const detail = error.response?.data?.detail;
        const msg = typeof detail === 'string' ? detail : (error.response?.status === 403 ? 'Access denied.' : 'Session expired or invalid. Please log in again.');
        try {
          sessionStorage.setItem(AUTH_ERROR_KEY, msg);
        } catch (_) {}
        localStorage.removeItem('token');
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
    // Show full-screen overlay for server-down scenarios (skip 401/403 — those redirect)
    const status = error.response?.status;
    if ((status === 0 || isServerUnavailable(status)) && typeof window !== 'undefined' && !isPublicPath()) {
      window.dispatchEvent(new CustomEvent(SERVER_UNAVAILABLE_EVENT));
    }
    return Promise.reject(error);
  }
);

/** Get a user-friendly error message from an API error (use in catch blocks and toasts). */
export function getApiErrorMessage(error) {
  if (!error) return 'Something went wrong.';
  const data = error.response?.data;
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) return detail.map((x) => x.msg || x.loc?.join('.')).join('; ') || 'Validation error';
  if (detail && typeof detail === 'object' && typeof detail.msg === 'string') return detail.msg;
  if (typeof data?.message === 'string') return data.message;
  if (error.response?.status === 502 || error.response?.status === 503 || error.response?.status === 504) return SERVER_UNAVAILABLE_MSG;
  if (error.response?.status === 401) return 'Please log in again.';
  if (error.response?.status === 403) return 'Not allowed.';
  if (!error.response) return error.message || NETWORK_ERROR_MSG;
  return error.response.status ? `Error (${error.response.status}). Please try again.` : 'Something went wrong. Please try again.';
}

/** For error messages: display the actual backend base URL (same-origin shows as /api). */
export function getBaseURL() {
  return API || '/api';
}

/** Dispatch to refresh top bar / user data in Layout (money, points, rank, etc.). Pass newMoney to update cash immediately. */
export function refreshUser(newMoney) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:refresh-user', {
      detail: newMoney != null && newMoney !== undefined ? { money: Number(newMoney) } : {}
    }));
  }
}

export default api;
