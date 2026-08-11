/**
 * Background warm for Users Online: same GET + session key as `UsersOnline.js`.
 * Layout already hits `/users/online` for the sidebar badge — reuse that payload.
 */
import api from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

/** Must match boot key used by `pages/Game/UsersOnline.js`. */
export const USERS_ONLINE_CACHE_KEY = 'mafia_users_online_v4';

let lastWarmAt = 0;
let inFlight = null;
let _memBoot = null;

export function readUsersOnlineBoot() {
  if (_memBoot && Array.isArray(_memBoot.users)) return _memBoot;
  const stored = readSessionJson(USERS_ONLINE_CACHE_KEY);
  if (stored && Array.isArray(stored.users)) {
    _memBoot = stored;
    return stored;
  }
  return null;
}

export function writeUsersOnlineBoot(boot) {
  if (!boot || !Array.isArray(boot.users)) return;
  _memBoot = boot;
  writeSessionJson(USERS_ONLINE_CACHE_KEY, boot);
}

/** Persist a full `/users/online` response (e.g. from Layout sidebar poll). */
export function cacheUsersOnlineResponse(data) {
  if (!data || typeof data !== 'object') return null;
  const boot = {
    total_online: data.total_online ?? 0,
    active_last_hour: data.active_last_hour ?? 0,
    active_last_day: data.active_last_day ?? 0,
    active_last_week: data.active_last_week ?? 0,
    countries_roster: Array.isArray(data.countries_roster) ? data.countries_roster : [],
    countries_hour: Array.isArray(data.countries_hour) ? data.countries_hour : [],
    countries_day: Array.isArray(data.countries_day) ? data.countries_day : [],
    countries_week: Array.isArray(data.countries_week) ? data.countries_week : [],
    users: Array.isArray(data.users) ? data.users : [],
    admin_online_color: data.admin_online_color,
    mod_default_online_color: data.mod_default_online_color,
    hdo_online_color: data.hdo_online_color,
    _ts: Date.now(),
  };
  writeUsersOnlineBoot(boot);
  lastWarmAt = Date.now();
  return boot;
}

/**
 * @param {{ force?: boolean }} [options]
 */
export async function prefetchUsersOnlineData(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && now - lastWarmAt < 20_000) {
    return readUsersOnlineBoot();
  }
  if (inFlight) return inFlight;
  lastWarmAt = now;
  inFlight = (async () => {
    try {
      const res = await api.get('/users/online');
      return cacheUsersOnlineResponse(res.data) || readUsersOnlineBoot();
    } catch {
      return readUsersOnlineBoot();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
