/**
 * Session cache for /account/dashboard first paint + background prefetch after login.
 */
import api from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

export const DASHBOARD_SESSION_CACHE_KEY = 'mafia_dashboard_v1';

export const DEFAULT_SECTION_ORDER = [
  'rank_progress', 'rewards_objectives', 'notifications_event',
  'bodyguards_properties', 'auto_rank', 'at_a_glance', 'go_to',
];

export const DEFAULT_AT_A_GLANCE_STATS = ['money', 'rank', 'wealth', 'rp', 'location', 'kills'];

/** Align with Dashboard fetchData preference merge (session write path). */
export function mergeDashboardPreferences(dashResData, prevEntry) {
  if (dashResData) {
    return {
      section_order: dashResData.section_order || DEFAULT_SECTION_ORDER,
      at_a_glance_visible: dashResData.at_a_glance_visible !== false,
      at_a_glance_stats: dashResData.at_a_glance_stats || DEFAULT_AT_A_GLANCE_STATS,
    };
  }
  if (prevEntry?.preferences) {
    return {
      section_order: prevEntry.preferences.section_order || DEFAULT_SECTION_ORDER,
      at_a_glance_visible: prevEntry.preferences.at_a_glance_visible !== false,
      at_a_glance_stats: prevEntry.preferences.at_a_glance_stats || DEFAULT_AT_A_GLANCE_STATS,
    };
  }
  return {
    section_order: DEFAULT_SECTION_ORDER,
    at_a_glance_visible: true,
    at_a_glance_stats: [...DEFAULT_AT_A_GLANCE_STATS],
  };
}

let lastDashboardPrefetchAt = 0;

/**
 * Warm sessionStorage so Dashboard can render from cache immediately.
 * @param {{ force?: boolean }} [options] — force=false skips if prefetched recently (nav hover).
 */
export async function prefetchDashboardData(options = {}) {
  const force = options.force !== false;
  const now = Date.now();
  if (!force && now - lastDashboardPrefetchAt < 45_000) return;
  lastDashboardPrefetchAt = now;
  try {
    const [userRes, progressRes, dashRes, civRes] = await Promise.all([
      api.get('/auth/me'),
      api.get('/user/rank-progress'),
      api.get('/profile/dashboard').catch(() => ({ data: null })),
      api.get('/account/civilian-protection').catch(() => ({ data: null })),
    ]);
    const prev = readSessionJson(DASHBOARD_SESSION_CACHE_KEY);
    const storedPrefs = mergeDashboardPreferences(dashRes?.data ?? null, prev);
    writeSessionJson(DASHBOARD_SESSION_CACHE_KEY, {
      user: userRes.data,
      rankProgress: progressRes.data,
      preferences: storedPrefs,
      civilianProtection: civRes?.data ?? null,
    });
  } catch {
    /* Dashboard will fetch on mount */
  }
}
