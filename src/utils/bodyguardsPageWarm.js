/**
 * Background warm for Kill → Bodyguards: same GET bundle as `Bodyguards.js` fetchData.
 */
import api, { apiRequestWith429Retry } from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

export const BODYGUARDS_PAGE_WARM_KEY = 'mafia_bodyguards_page_w1';
const MAX_WARM_AGE_MS = 90_000;

let lastPrefetchAt = 0;

function noCacheGetConfig() {
  return {
    params: { _: Date.now() },
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  };
}

/** @returns {object | null} */
export function readBodyguardsPageWarm() {
  const row = readSessionJson(BODYGUARDS_PAGE_WARM_KEY);
  if (!row || Date.now() - (row.ts || 0) > MAX_WARM_AGE_MS) return null;
  return row;
}

/**
 * @param {{
 *   userId?: string,
 *   main: unknown,
 *   user: unknown,
 *   event: unknown,
 *   eventsEnabled: boolean,
 *   inflation: unknown,
 *   stats: unknown,
 *   invites: unknown,
 * }} payload
 */
export function writeBodyguardsPageWarm(payload) {
  writeSessionJson(BODYGUARDS_PAGE_WARM_KEY, {
    ts: Date.now(),
    userId: payload.userId ?? null,
    main: payload.main,
    user: payload.user,
    event: payload.event ?? null,
    eventsEnabled: !!payload.eventsEnabled,
    inflation: payload.inflation ?? null,
    stats: payload.stats ?? null,
    invites: payload.invites ?? { sent: [], received: [] },
  });
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function prefetchBodyguardsPageData(options = {}) {
  const force = options.force !== false;
  const now = Date.now();
  if (!force && now - lastPrefetchAt < 45_000) return;
  lastPrefetchAt = now;
  try {
    const meRes = await api.get('/auth/me');
    const uid = meRes.data?.id;
    if (!uid) return;

    const nc = noCacheGetConfig();
    const [bodyguardsRes, eventsRes, inflationRes, statsRes, invitesRes] = await Promise.all([
      apiRequestWith429Retry(() => api.get('/bodyguards', nc)),
      apiRequestWith429Retry(() => api.get('/events/active')).catch(() => ({ data: { event: null, events_enabled: false } })),
      apiRequestWith429Retry(() => api.get('/bodyguards/inflation', nc)).catch(() => ({ data: { next_hire_inflation_pct: 0 } })),
      apiRequestWith429Retry(() => api.get('/bodyguards/stats')).catch(() => ({ data: null })),
      apiRequestWith429Retry(() => api.get('/bodyguards/invites')).catch(() => ({ data: { sent: [], received: [] } })),
    ]);

    if (bodyguardsRes.status >= 400 || meRes.status >= 400) return;

    const bgData = bodyguardsRes.data;
    writeBodyguardsPageWarm({
      userId: uid,
      main: bgData,
      user: meRes.data,
      event: eventsRes.data?.event ?? null,
      eventsEnabled: !!eventsRes.data?.events_enabled,
      inflation: inflationRes.data ?? null,
      stats: statsRes.data ?? null,
      invites: invitesRes.data ?? { sent: [], received: [] },
    });
  } catch {
    /* Page loads normally */
  }
}
