/**
 * Cache for /stats/overview: memory + sessionStorage so Stats page is instant after first load (incl. remount / refresh).
 * Keyed by users_only_kills ('true' | 'false').
 */

const cache = new Map();
const STORAGE_KEY = 'mafia_stats_overview_v2';

/** @param {boolean} usersOnlyKills */
function key(usersOnlyKills) {
  return usersOnlyKills ? 'true' : 'false';
}

/**
 * @param {boolean} usersOnlyKills
 * @returns {object | null} Cached response data or null
 */
export function getStatsOverview(usersOnlyKills) {
  const k = key(usersOnlyKills);
  const mem = cache.get(k);
  if (mem != null) return mem;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw);
    if (!all || typeof all !== 'object') return null;
    const entry = all[k];
    if (entry != null) cache.set(k, entry);
    return entry ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {boolean} usersOnlyKills
 * @param {object} data Response data from /stats/overview
 */
export function setStatsOverview(usersOnlyKills, data) {
  if (data == null) return;
  const k = key(usersOnlyKills);
  cache.set(k, data);
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    if (!all || typeof all !== 'object') return;
    all[k] = data;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (_) {}
}
