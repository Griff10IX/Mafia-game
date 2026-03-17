/**
 * Short-lived in-memory cache for /stats/overview responses.
 * Keyed by users_only_kills ('true' | 'false') so both filter variants are stored.
 */

const cache = new Map();

/** @param {boolean} usersOnlyKills */
function key(usersOnlyKills) {
  return usersOnlyKills ? 'true' : 'false';
}

/**
 * @param {boolean} usersOnlyKills
 * @returns {object | null} Cached response data or null
 */
export function getStatsOverview(usersOnlyKills) {
  return cache.get(key(usersOnlyKills)) ?? null;
}

/**
 * @param {boolean} usersOnlyKills
 * @param {object} data Response data from /stats/overview
 */
export function setStatsOverview(usersOnlyKills, data) {
  if (data != null) cache.set(key(usersOnlyKills), data);
}
