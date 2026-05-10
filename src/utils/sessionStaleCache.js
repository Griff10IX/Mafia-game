/**
 * TTL + savedAt helpers for stale-while-revalidate session snapshots (sessionStorage).
 */
import { readSessionJson, writeSessionJson } from './sessionPageCache';

export const STORE_PAGE_CACHE_KEY = 'mafia_store_page_v1';
export const QUICKTRADE_SESSION_CACHE_KEY = 'mafia_quicktrade_v1';
export const BOOZE_RUN_MOUNT_CACHE_KEY = 'mafia_booze_run_mount_v1';

/**
 * @param {string} key
 * @param {number} ttlMs
 * @returns {Record<string, unknown> | null}
 */
export function readSessionJsonWithTtl(key, ttlMs) {
  const raw = readSessionJson(key);
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.savedAt !== 'number') return null;
  if (Date.now() - raw.savedAt > ttlMs) return null;
  return raw;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} payload savedAt is overwritten
 */
export function writeSessionJsonWithSavedAt(key, payload) {
  writeSessionJson(key, { ...payload, savedAt: Date.now() });
}
