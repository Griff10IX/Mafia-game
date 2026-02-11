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
