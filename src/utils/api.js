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

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 (e.g. backend restarted, token expired), clear token and auto-redirect to login once. Don't redirect if already on login (stops refresh loop).
let hasRedirectedOnAuthFailure = false;
const isPublicPath = () => {
  const p = (typeof window !== 'undefined' && window.location?.pathname) || '';
  return p === '/' || p === '/forgot-password' || p === '/reset-password';
};

// Friendly messages for 502/503/504 and network errors so pages don't show raw "Bad Gateway" or break
const SERVER_UNAVAILABLE_MSG = 'Server temporarily unavailable. Please try again in a moment.';
const NETWORK_ERROR_MSG = 'Connection problem. Please check your network and try again.';

/** Key used to pass profile/auth error to login page after redirect (e.g. session invalidated). */
export const AUTH_ERROR_KEY = 'auth_profile_error';

api.interceptors.response.use(
  (response) => response,
  (error) => {
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
    if (error.response) {
      const status = error.response.status;
      if (status === 502 || status === 503 || status === 504) {
        error.response.data = { ...error.response.data, detail: SERVER_UNAVAILABLE_MSG };
      }
    } else {
      // No response: network error, timeout, or server unreachable
      error.response = { status: 0, data: { detail: NETWORK_ERROR_MSG } };
    }
    return Promise.reject(error);
  }
);

/** Get a user-friendly error message from an API error (use in catch blocks and toasts). */
export function getApiErrorMessage(error) {
  if (!error) return 'Something went wrong.';
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (error.response?.status === 502 || error.response?.status === 503 || error.response?.status === 504) return SERVER_UNAVAILABLE_MSG;
  if (!error.response) return NETWORK_ERROR_MSG;
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
