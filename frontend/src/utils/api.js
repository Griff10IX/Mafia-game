import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API = `${API_URL.replace(/\/$/, '')}/api`;

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

/** Dispatch to refresh top bar / user data in Layout (money, points, rank, etc.). Pass newMoney to update cash immediately. */
export function refreshUser(newMoney) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:refresh-user', {
      detail: newMoney != null && newMoney !== undefined ? { money: Number(newMoney) } : {}
    }));
  }
}

export default api;
