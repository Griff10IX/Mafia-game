/**
 * Light mobile prewarm: JS chunks for a few hot routes + one cheap API.
 * Avoids full page bundles (GTA/bodyguards multi-GET) so idle warm stays gentle.
 */
import api from './api';
import { preloadRoute } from './routePreload';
import { getCrimesPrefetch, setCrimesPrefetch } from './prefetchCache';
import { prefetchTravelPageData } from './travelPageWarm';
import { prefetchProfilePageData } from './profilePageWarm';

/** Chunk-only paths — no heavy multi-request page warms. */
const LIGHT_CHUNK_PATHS = [
  '/crime/crimes',
  '/crime/gta',
  '/kill/attack',
  '/crime/jail',
  '/account/profile',
  '/account/objectives',
  '/game/users-online',
];

let ranForUserId = null;

/**
 * @param {string} userId
 * @returns {() => void} cancel
 */
export function scheduleMobileLightPrewarm(userId) {
  if (!userId || ranForUserId === userId) return () => {};
  let cancelled = false;
  let idleId = null;
  let timeoutId = null;
  let stepTimeout = null;

  const run = () => {
    if (cancelled || ranForUserId === userId) return;
    ranForUserId = userId;

    // 1) Preload route chunks only (cheap).
    for (const path of LIGHT_CHUNK_PATHS) {
      try {
        preloadRoute(path);
      } catch {
        /* ignore */
      }
    }

    // 2) One light API if crimes aren’t already cached + soft travel/own-profile warm.
    stepTimeout = setTimeout(() => {
      if (cancelled) return;
      if (!getCrimesPrefetch()) {
        api.get('/crimes').then((r) => setCrimesPrefetch(r.data)).catch(() => {});
      }
      // Soft travel warm (internally throttled / force:false).
      prefetchTravelPageData({ force: false }).catch(() => {});
      // Own profile dossier into memory cache so /profile opens without empty flash.
      prefetchProfilePageData({ force: false }).catch(() => {});
    }, 800);
  };

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    idleId = window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    timeoutId = setTimeout(run, 2000);
  }

  return () => {
    cancelled = true;
    if (idleId != null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId);
    }
    if (timeoutId != null) clearTimeout(timeoutId);
    if (stepTimeout != null) clearTimeout(stepTimeout);
  };
}
