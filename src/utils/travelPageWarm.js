/**
 * Background warm for Travel page: same GET bundle as `Travel.js` fetchTravelInfo.
 */
import api, { apiRequestWith429Retry } from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';
import { getTravelPrefetch, setTravelPrefetch } from './prefetchCache';

export const TRAVEL_CACHE_KEY = 'mafia_travel_v1';

let lastPrefetchAt = 0;

export function readTravelBoot() {
  const mem = getTravelPrefetch();
  if (mem?.travelInfo) return mem;
  const stored = readSessionJson(TRAVEL_CACHE_KEY);
  return stored?.travelInfo ? stored : null;
}

export function writeTravelBoot(bundle) {
  if (!bundle?.travelInfo) return;
  setTravelPrefetch(bundle);
  writeSessionJson(TRAVEL_CACHE_KEY, bundle);
}

export function buildTravelBundle(infoRes, autoRankRes, userRes, bjRes, mpBjRes) {
  const autoRankBoozeOn = !!(
    autoRankRes?.data?.auto_rank_enabled && autoRankRes?.data?.auto_rank_booze
  );
  let bjTravelBlock = null;
  if (mpBjRes?.data?.in_game && mpBjRes?.data?.game_id) {
    bjTravelBlock = { kind: 'mp', gameId: String(mpBjRes.data.game_id) };
  } else if (bjRes?.data?.hasGame) {
    bjTravelBlock = { kind: 'single' };
  }
  return {
    travelInfo: infoRes?.data ?? null,
    autoRankBoozeOn,
    user: userRes?.data ?? null,
    bjTravelBlock,
  };
}

export async function fetchTravelBundle() {
  const [infoRes, autoRankRes, userRes, bjRes, mpBjRes] = await Promise.all([
    apiRequestWith429Retry(() => api.get('/travel/info')),
    api.get('/auto-rank/me').catch(() => ({ data: {} })),
    api.get('/auth/me').catch(() => ({ data: null })),
    api.get('/casino/blackjack/current-game').catch(() => ({ data: {} })),
    api.get('/casino/mp-blackjack/active-participation').catch(() => ({ data: { in_game: false } })),
  ]);
  return buildTravelBundle(infoRes, autoRankRes, userRes, bjRes, mpBjRes);
}

/** @param {{ force?: boolean }} [options] */
export async function prefetchTravelPageData(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && now - lastPrefetchAt < 30_000) {
    return readTravelBoot();
  }
  lastPrefetchAt = now;
  try {
    const me = await api.get('/auth/me');
    if (!me.data?.id) return readTravelBoot();
    const bundle = await fetchTravelBundle();
    if (bundle.travelInfo) writeTravelBoot(bundle);
    return bundle;
  } catch {
    return readTravelBoot();
  }
}
