/**
 * Session cache for /account/dashboard first paint + background prefetch after login.
 */
import api, { apiGetWithResumeRetries, apiRequestWith429Retry } from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

export const DASHBOARD_SESSION_CACHE_KEY = 'mafia_dashboard_v1';

/** New command-center section IDs (post redesign). */
export const DEFAULT_SECTION_ORDER = [
  'command_status',
  'daily_ops',
  'intel_assets',
  'auto_rank',
  'routes',
];

export const DEFAULT_AT_A_GLANCE_STATS = ['money', 'health', 'bullets', 'location', 'rank', 'kills'];

const LEGACY_SECTION_MAP = {
  rank_progress: 'command_status',
  at_a_glance: 'command_status',
  rewards_objectives: 'daily_ops',
  notifications_event: 'intel_assets',
  bodyguards_properties: 'intel_assets',
  auto_rank: 'auto_rank',
  go_to: 'routes',
  // already-new ids pass through via map miss + include check
  command_status: 'command_status',
  daily_ops: 'daily_ops',
  intel_assets: 'intel_assets',
  routes: 'routes',
};

/**
 * Normalize legacy or partial section orders into the current DEFAULT_SECTION_ORDER set.
 * Preserves relative order of first-seen mapped sections, then appends any missing defaults.
 */
export function normalizeDashboardSectionOrder(order) {
  const seen = new Set();
  const out = [];
  const list = Array.isArray(order) ? order : [];
  for (const raw of list) {
    const mapped = LEGACY_SECTION_MAP[raw] || (DEFAULT_SECTION_ORDER.includes(raw) ? raw : null);
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  for (const id of DEFAULT_SECTION_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

export function sanitizeDashboardUser(user) {
  if (!user || typeof user !== 'object') return user ?? null;
  const safe = { ...user };
  delete safe.email;
  return safe;
}

export function readDashboardSessionCache() {
  const entry = readSessionJson(DASHBOARD_SESSION_CACHE_KEY);
  if (!entry || typeof entry !== 'object') return entry;
  const safeEntry = { ...entry, user: sanitizeDashboardUser(entry.user) };
  if (entry.user?.email) {
    writeSessionJson(DASHBOARD_SESSION_CACHE_KEY, safeEntry);
  }
  return safeEntry;
}

/** Replace session user on login so a prior alive snapshot cannot flash before /auth/me. */
export function seedDashboardSessionFromLogin(user) {
  writeSessionJson(DASHBOARD_SESSION_CACHE_KEY, {
    user: sanitizeDashboardUser(user),
    rankProgress: null,
  });
}

export function clearDashboardSessionCache() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(DASHBOARD_SESSION_CACHE_KEY);
  } catch (_) { /* ignore */ }
}

/** Keep Layout / Dashboard session paint in sync after /auth/me + rank-progress. */
export function writeDashboardSessionUserProgress(user, rankProgress) {
  const prev = readDashboardSessionCache() || {};
  const nextUser = sanitizeDashboardUser(user) ?? prev.user ?? null;
  if (nextUser && prev.user) {
    const incomingProfit = Number(nextUser.casino_profit);
    const incomingHas = !!nextUser.has_casino_or_property;
    const looksLikeAuthMeStub = !incomingHas && (!Number.isFinite(incomingProfit) || incomingProfit === 0);
    if (looksLikeAuthMeStub && (prev.user.has_casino_or_property || Number(prev.user.casino_profit) !== 0 || Number(prev.user.property_profit) !== 0)) {
      nextUser.casino_profit = prev.user.casino_profit;
      nextUser.property_profit = prev.user.property_profit;
      nextUser.has_casino_or_property = prev.user.has_casino_or_property;
    }
  }
  writeSessionJson(DASHBOARD_SESSION_CACHE_KEY, {
    ...prev,
    user: nextUser,
    rankProgress: rankProgress ?? prev.rankProgress ?? null,
  });
}

/** Drop cached rank bar so a full refresh cannot flash stale Godfather 100%. */
export function clearDashboardSessionRankProgress() {
  const prev = readDashboardSessionCache();
  if (!prev || typeof prev !== 'object') return;
  writeSessionJson(DASHBOARD_SESSION_CACHE_KEY, { ...prev, rankProgress: null });
}

/** Align with Dashboard fetchData preference merge (session write path). */
export function mergeDashboardPreferences(dashResData, prevEntry) {
  if (dashResData) {
    return {
      section_order: normalizeDashboardSectionOrder(dashResData.section_order),
      at_a_glance_visible: dashResData.at_a_glance_visible !== false,
      at_a_glance_stats: dashResData.at_a_glance_stats || DEFAULT_AT_A_GLANCE_STATS,
    };
  }
  if (prevEntry?.preferences) {
    return {
      section_order: normalizeDashboardSectionOrder(prevEntry.preferences.section_order),
      at_a_glance_visible: prevEntry.preferences.at_a_glance_visible !== false,
      at_a_glance_stats: prevEntry.preferences.at_a_glance_stats || DEFAULT_AT_A_GLANCE_STATS,
    };
  }
  return {
    section_order: [...DEFAULT_SECTION_ORDER],
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
    const [userRes, progressRes] = await Promise.all([
      apiGetWithResumeRetries('/auth/me'),
      apiRequestWith429Retry(() => api.get('/user/rank-progress')),
    ]);
    const dashRes = await api.get('/profile/dashboard').catch(() => ({ data: null }));
    const civRes = await api.get('/account/civilian-protection').catch(() => ({ data: null }));
    const prev = readSessionJson(DASHBOARD_SESSION_CACHE_KEY);
    const storedPrefs = mergeDashboardPreferences(dashRes?.data ?? null, prev);
    writeSessionJson(DASHBOARD_SESSION_CACHE_KEY, {
      user: sanitizeDashboardUser(userRes.data),
      rankProgress: progressRes.data,
      preferences: storedPrefs,
      civilianProtection: civRes?.data ?? null,
    });
  } catch {
    /* Dashboard will fetch on mount */
  }
}
