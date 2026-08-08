import api from './api';
import { getProfilePrefetch, setProfilePrefetch } from './prefetchCache';
import { preloadRoute } from './routePreload';

const inflight = new Set();

/**
 * Fire-and-forget: load the profile shell and honours into the same in-memory cache
 * Profile.js reads on mount, so opening /profile/:user from Users Online / Attack /
 * Jail can paint immediately after hover / pointer intent.
 */
export function warmProfilePrefetchFromUsername(username) {
  const u = String(username || '').trim();
  if (!u || u === '?' || u === '—') return;
  try {
    preloadRoute('/account/profile');
  } catch {
    /* ignore */
  }
  const key = u.toLowerCase();
  const cached = getProfilePrefetch(u);
  if (cached?._honoursLoaded) return;
  if (inflight.has(key)) return;
  inflight.add(key);
  const encodedUsername = encodeURIComponent(u);
  const profileRequest = cached
    ? Promise.resolve({ data: cached })
    : api.get(`/users/${encodedUsername}/profile`, { params: { include_honours: false } });
  Promise.all([
    profileRequest,
    api.get(`/users/${encodedUsername}/profile/honours`),
  ])
    .then(([profileRes, honoursRes]) => {
      setProfilePrefetch(u, {
        ...profileRes.data,
        honours: honoursRes.data?.honours ?? [],
        _honoursLoaded: true,
      });
    })
    .catch(() => {})
    .finally(() => {
      inflight.delete(key);
    });
}
