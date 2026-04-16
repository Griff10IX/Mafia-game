/**
 * Background warm for Crime → GTA: same GET bundle as `GTA.js` fetchData.
 */
import api from './api';
import { writeSessionJson } from './sessionPageCache';

export const GTA_SESSION_CACHE_KEY = 'mafia_gta_v1';

export const DEFAULT_GTA_STATS = {
  count_today: 0,
  count_week: 0,
  success_today: 0,
  success_week: 0,
  profit_today: 0,
  profit_24h: 0,
  profit_week: 0,
};

let lastPrefetchAt = 0;

/**
 * @param {import('axios').AxiosResponse['data']} settled
 */
function buildGtaCacheFromSettled(
  optionsRes,
  recentStolenRes,
  eventsRes,
  statsRes,
  autoRankRes,
  lootStatusRes,
  meRes,
) {
  let nextOptions = [];
  if (optionsRes.status === 'fulfilled' && Array.isArray(optionsRes.value?.data)) {
    nextOptions = optionsRes.value.data;
  }

  let nextRecentStolen = [];
  if (recentStolenRes.status === 'fulfilled' && recentStolenRes.value?.data) {
    nextRecentStolen = Array.isArray(recentStolenRes.value.data.cars)
      ? recentStolenRes.value.data.cars
      : [];
  }

  let nextEvent = null;
  let nextEventsEnabled = false;
  if (eventsRes.status === 'fulfilled' && eventsRes.value?.data) {
    nextEvent = eventsRes.value.data?.event ?? null;
    nextEventsEnabled = !!eventsRes.value.data?.events_enabled;
  }

  let nextGtaStats = { ...DEFAULT_GTA_STATS };
  if (statsRes.status === 'fulfilled' && statsRes.value?.data && typeof statsRes.value.data === 'object') {
    nextGtaStats = { ...DEFAULT_GTA_STATS, ...statsRes.value.data };
  }

  let nextAutoRankGtaDisabled = false;
  if (autoRankRes.status === 'fulfilled' && autoRankRes.value?.data) {
    const ar = autoRankRes.value.data;
    nextAutoRankGtaDisabled = !!(ar.auto_rank_enabled && (ar.auto_rank_gta || ar.auto_rank_bust_every_5_sec));
  }

  let nextActiveLootPerks = [];
  if (lootStatusRes.status === 'fulfilled' && Array.isArray(lootStatusRes.value?.data?.active_rewards)) {
    nextActiveLootPerks = lootStatusRes.value.data.active_rewards.filter(
      (r) => r.type === 'rp_10' || r.type === 'gta_rare_100',
    );
  }

  let nextUser = null;
  if (meRes.status === 'fulfilled' && meRes.value?.data) {
    nextUser = meRes.value.data;
  }

  return {
    options: nextOptions,
    recentStolen: nextRecentStolen,
    event: nextEvent,
    eventsEnabled: nextEventsEnabled,
    gtaStats: nextGtaStats,
    autoRankGtaDisabled: nextAutoRankGtaDisabled,
    activeLootPerks: nextActiveLootPerks,
    user: nextUser,
  };
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function prefetchGtaPageData(options = {}) {
  const force = options.force !== false;
  const now = Date.now();
  if (!force && now - lastPrefetchAt < 45_000) return;
  lastPrefetchAt = now;
  try {
    const meRes = await api.get('/auth/me');
    if (!meRes.data?.id) return;

    const settled = await Promise.allSettled([
      api.get('/gta/options'),
      api.get('/gta/recent-stolen'),
      api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      api.get('/gta/stats').catch(() => ({ data: {} })),
      api.get('/auto-rank/me').catch(() => ({ data: {} })),
      api.get('/loot-box/status').catch(() => ({ data: {} })),
      Promise.resolve(meRes),
    ]);

    if (settled[0].status !== 'fulfilled' || !Array.isArray(settled[0].value?.data)) return;

    const payload = buildGtaCacheFromSettled(
      settled[0],
      settled[1],
      settled[2],
      settled[3],
      settled[4],
      settled[5],
      settled[6],
    );

    writeSessionJson(GTA_SESSION_CACHE_KEY, payload);
  } catch {
    /* GTA page loads normally */
  }
}
