/** Session cache + silent warm for GET /leaderboards/top (main game leaderboard). */

export const LB_BOARD_KEYS = new Set([
  'rank_points', 'kills', 'crimes', 'gta', 'jail_busts', 'points_spent',
  'respect_points', 'bullets_melted', 'stock_market_profit', 'booze_run_profit',
]);

export function boardsCacheLooksValid(boards) {
  if (!boards || typeof boards !== 'object') return false;
  for (const k of LB_BOARD_KEYS) {
    if (!Array.isArray(boards[k])) return false;
  }
  return true;
}

export const EMPTY_BOARDS = {
  rank_points: [],
  kills: [], crimes: [], gta: [], jail_busts: [], points_spent: [],
  respect_points: [], bullets_melted: [], stock_market_profit: [], booze_run_profit: [],
};

const LB_CACHE_STORAGE_KEY = 'mafia_lb_top_v1';
export const LB_PERIOD_STORAGE_KEY = 'mafia_lb_period_v1';
const LB_CACHE_MAX_KEYS = 12;

function weekStartUTCString() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7;
  const mondayUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - diff,
    0, 0, 0, 0
  ));
  return mondayUTC.toISOString().slice(0, 10);
}

function lbCacheKey(period, topLimit, dead) {
  const p = (period || '').toLowerCase();
  const weekStart = p === 'weekly' ? weekStartUTCString() : '';
  return `${p}|${weekStart}|${topLimit}|${dead ? '1' : '0'}`;
}

export function readPersistedPeriod() {
  try {
    const s = sessionStorage.getItem(LB_PERIOD_STORAGE_KEY);
    if (s === 'weekly' || s === 'alltime') return s;
  } catch (_) {}
  return 'weekly';
}

export function readLbEntry(period, topLimit, dead) {
  try {
    const raw = sessionStorage.getItem(LB_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw);
    if (!all || typeof all !== 'object') return null;
    return all[lbCacheKey(period, topLimit, dead)] || null;
  } catch {
    return null;
  }
}

export function writeLbEntry(period, topLimit, dead, boards, lastRewardWinners) {
  try {
    const raw = sessionStorage.getItem(LB_CACHE_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    if (!all || typeof all !== 'object') return;
    all[lbCacheKey(period, topLimit, dead)] = {
      boards,
      last_reward_winners: lastRewardWinners,
      t: Date.now(),
    };
    const keys = Object.keys(all);
    if (keys.length > LB_CACHE_MAX_KEYS) {
      keys.sort((a, b) => (all[a]?.t || 0) - (all[b]?.t || 0));
      for (let i = 0; i < keys.length - LB_CACHE_MAX_KEYS; i++) delete all[keys[i]];
    }
    sessionStorage.setItem(LB_CACHE_STORAGE_KEY, JSON.stringify(all));
  } catch (_) {}
}

let warmInFlight = null;

async function fetchAndWriteTop(api, params) {
  const response = await api.get('/leaderboards/top', {
    params: { limit: params.limit, dead: params.dead, period: params.period },
  });
  const d = response.data || {};
  const { last_reward_winners, ...rest } = d;
  const nextBoards = { ...EMPTY_BOARDS };
  for (const k of LB_BOARD_KEYS) {
    if (Array.isArray(rest[k])) nextBoards[k] = rest[k];
  }
  writeLbEntry(params.period, params.limit, params.dead, nextBoards, last_reward_winners ?? null);
}

/**
 * Refresh sessionStorage for the default sidebar view (persisted period, top 10, alive),
 * then fill missing opposite period / top-dead caches. Silent; dedupes concurrent calls.
 */
export function warmLeaderboardCaches(api) {
  if (warmInFlight) return warmInFlight;
  warmInFlight = (async () => {
    try {
      const topLimit = 10;
      const period = readPersistedPeriod();
      const dead = false;
      try {
        await fetchAndWriteTop(api, { period, limit: topLimit, dead });
      } catch {
        /* silent */
      }
      const extras = [];
      if (!boardsCacheLooksValid(readLbEntry(period, topLimit, true)?.boards)) {
        extras.push({ period, limit: topLimit, dead: true });
      }
      const oppPeriod = period === 'weekly' ? 'alltime' : 'weekly';
      if (!boardsCacheLooksValid(readLbEntry(oppPeriod, topLimit, false)?.boards)) {
        extras.push({ period: oppPeriod, limit: topLimit, dead: false });
      }
      for (const p of extras) {
        try {
          await fetchAndWriteTop(api, p);
        } catch {
          /* silent */
        }
      }
    } finally {
      warmInFlight = null;
    }
  })();
  return warmInFlight;
}
