/**
 * Per-user session cache for dashboard widget API payloads (stale-while-revalidate, like statsCache).
 */
import { readSessionJson, writeSessionJson } from './sessionPageCache';

const STORAGE_KEY = 'mafia_dashboard_widgets_v1';

function buckets() {
  const raw = readSessionJson(STORAGE_KEY);
  return raw && typeof raw === 'object' ? raw : {};
}

/** @param {string|number|null|undefined} userId @param {string} name */
export function getDashboardWidget(userId, name) {
  if (userId == null || userId === '') return null;
  const uid = String(userId);
  const all = buckets();
  const row = all[uid];
  if (!row || typeof row !== 'object') return null;
  return row[name] ?? null;
}

/** @param {string|number|null|undefined} userId @param {string} name @param {unknown} data */
export function setDashboardWidget(userId, name, data) {
  if (userId == null || userId === '' || data == null) return;
  const uid = String(userId);
  const all = buckets();
  if (!all[uid] || typeof all[uid] !== 'object') all[uid] = {};
  all[uid][name] = data;
  writeSessionJson(STORAGE_KEY, all);
}
