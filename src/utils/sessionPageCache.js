/** Small helpers for stale-while-revalidate page data (sessionStorage). */

export function readSessionJson(key) {
  if (typeof window === 'undefined' || !key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeSessionJson(key, value) {
  if (typeof window === 'undefined' || !key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}
