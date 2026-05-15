import api from './api';
import { getProfilePrefetch, setProfilePrefetch } from './prefetchCache';

const inflight = new Set();

/**
 * Fire-and-forget: load GET /users/:username/profile (include_honours=false) into the
 * same in-memory cache Profile.js reads on mount, so opening /profile/:user from
 * Users Online can paint immediately after hover / pointer intent.
 */
export function warmProfilePrefetchFromUsername(username) {
  const u = String(username || '').trim();
  if (!u) return;
  const key = u.toLowerCase();
  if (getProfilePrefetch(u)) return;
  if (inflight.has(key)) return;
  inflight.add(key);
  api
    .get(`/users/${encodeURIComponent(u)}/profile`, { params: { include_honours: false } })
    .then((res) => {
      const base = { ...res.data, honours: res.data?.honours ?? [] };
      setProfilePrefetch(u, base);
    })
    .catch(() => {})
    .finally(() => {
      inflight.delete(key);
    });
}
