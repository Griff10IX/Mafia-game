/**
 * Background warm for My Stats (`/stats/me`) and Objectives (`/objectives`).
 * Writes the same sessionStorage keys those pages read so first visit is mostly cache + cached JS.
 */
import api from './api';
import { writeSessionJson } from './sessionPageCache';

/** Must match `MY_STATS_CACHE_KEY` in `pages/Account/MyStats.js`. */
const MY_STATS_CACHE_KEY = 'mafia_stats_me_v1';
/** Must match `OBJ_CACHE_KEY` in `pages/Account/Objectives.js`. */
const OBJECTIVES_CACHE_KEY = 'mafia_objectives_v1';

let lastWarmAt = 0;
let inFlight = null;

/**
 * @param {{ force?: boolean }} [options]
 */
export async function prefetchStatsAndObjectivesData(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && now - lastWarmAt < 45_000) return;
  if (inFlight) return inFlight;
  lastWarmAt = now;
  inFlight = (async () => {
    try {
      const [statsRes, objRes] = await Promise.all([
        api.get('/stats/me').catch(() => null),
        api.get('/objectives').catch(() => null),
      ]);

      if (statsRes?.data && typeof statsRes.data === 'object') {
        writeSessionJson(MY_STATS_CACHE_KEY, statsRes.data);
      }
      if (objRes?.data && typeof objRes.data === 'object') {
        writeSessionJson(OBJECTIVES_CACHE_KEY, objRes.data);
      }
    } catch {
      /* Pages load normally */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
