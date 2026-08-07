/**
 * Background warm for Missions: same GET bundle + session key as `Missions.js`.
 */
import api, { apiRequestWith429Retry } from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

/** Must match `MISSIONS_CACHE_KEY` in `pages/Account/Missions.js`. */
export const MISSIONS_CACHE_KEY = 'mafia_missions_v1';

let lastWarmAt = 0;
let inFlight = null;
/** In-memory boot shared with Missions page (module-level in Missions.js reads session first). */
let _memMissionsBoot = null;

export function readMissionsBoot() {
  if (_memMissionsBoot?.data) return _memMissionsBoot;
  const stored = readSessionJson(MISSIONS_CACHE_KEY);
  if (stored?.data) {
    _memMissionsBoot = stored;
    return stored;
  }
  return null;
}

export function writeMissionsBoot(boot) {
  if (!boot?.data) return;
  _memMissionsBoot = boot;
  writeSessionJson(MISSIONS_CACHE_KEY, boot);
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function prefetchMissionsPageData(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && now - lastWarmAt < 30_000) {
    return readMissionsBoot();
  }
  if (inFlight) return inFlight;
  lastWarmAt = now;
  inFlight = (async () => {
    try {
      const [mapRes, listRes] = await Promise.all([
        apiRequestWith429Retry(() => api.get('/missions/map')),
        apiRequestWith429Retry(() => api.get('/missions')),
      ]);
      const nextData = mapRes.data;
      const nextMissions = listRes.data?.missions || [];
      const prev = readMissionsBoot();
      const nextCity =
        prev?.city || nextData?.current_city || nextData?.unlocked_cities?.[0] || 'Start';
      const boot = {
        data: nextData,
        missions: nextMissions,
        city: nextCity,
      };
      writeMissionsBoot(boot);
      return boot;
    } catch {
      return readMissionsBoot();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
